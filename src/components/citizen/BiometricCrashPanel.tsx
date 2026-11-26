'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bluetooth,
  Camera,
  Car,
  HeartPulse,
  Smartphone,
  AlertTriangle,
  Activity,
  CheckCircle2,
} from 'lucide-react';
import {
  BiometricDistressTracker,
  GRAVITY_MS2,
  OpticalPpgProcessor,
  computeRmssdMs,
  evaluateCrashPhysics,
  parseBleHeartRateMeasurement,
  parseObdBlePacket,
  type BiometricFusionAssessment,
  type CrashAssessment,
} from '@/lib/sensors/biometricFusion';
import type { PowerEngineState, TriggerType } from '@/types/pulseguard';

interface BleDeviceLike {
  name?: string;
  gatt?: {
    connect: () => Promise<BleRemoteGattServerLike>;
    disconnect: () => void;
    connected: boolean;
  };
  addEventListener?: (type: string, listener: () => void) => void;
}

interface BleRemoteGattServerLike {
  getPrimaryService: (uuid: string | number) => Promise<{
    getCharacteristic: (uuid: string | number) => Promise<BleCharacteristicLike>;
  }>;
}

interface BleCharacteristicLike {
  startNotifications: () => Promise<void>;
  addEventListener: (
    type: string,
    listener: (event: { target: { value: DataView } }) => void
  ) => void;
}

export interface LiveBiometricTelemetry {
  hrBpm: number | null;
  spo2Pct: number | null;
  hrvRmssdMs: number | null;
  linearImuG: number;
  gPeak: number;
  canDeltaVKmh: number;
  rolloverDeg: number;
  omegaDegSec: number;
  dtcCode: string | null;
}

interface BiometricCrashPanelProps {
  powerState: PowerEngineState;
  baselineHrBpm: number;
  baselineRmssdMs: number;
  onCalibrateBaseline: (hrBpm: number, rmssdMs: number) => Promise<void>;
  onTelemetryChange: (telemetry: LiveBiometricTelemetry) => void;
  onAutonomousTrigger: (triggerType: TriggerType, reason: string) => void;
}

const NORDIC_UART_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NORDIC_UART_TX_CHAR = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

export default function BiometricCrashPanel({
  powerState,
  baselineHrBpm,
  baselineRmssdMs,
  onCalibrateBaseline,
  onTelemetryChange,
  onAutonomousTrigger,
}: BiometricCrashPanelProps) {
  const ppgProcessorRef = useRef(new OpticalPpgProcessor());
  const distressTrackerRef = useRef(new BiometricDistressTracker());
  const rrWindowRef = useRef<number[]>([]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const ppgStreamRef = useRef<MediaStream | null>(null);
  const ppgRafRef = useRef<number | null>(null);

  const bleHrDeviceRef = useRef<BleDeviceLike | null>(null);
  const bleObdDeviceRef = useRef<BleDeviceLike | null>(null);
  const prevObdSpeedRef = useRef<number | null>(null);
  const lastTriggerAtRef = useRef<number>(0);

  const [sensorSource, setSensorSource] = useState<'NONE' | 'BLE_HEART_RATE' | 'OPTICAL_CAMERA_PPG'>('NONE');
  const [bleStatus, setBleStatus] = useState<string>('Disconnected');
  const [obdStatus, setObdStatus] = useState<string>('Disconnected');
  const [ppgActive, setPpgActive] = useState(false);
  const [ppgQuality, setPpgQuality] = useState<'LOW_CONTACT' | 'CALIBRATING' | 'GOOD'>('LOW_CONTACT');
  const [imuActive, setImuActive] = useState(false);
  const [imuNotice, setImuNotice] = useState<string | null>(null);
  const [sensorError, setSensorError] = useState<string | null>(null);

  const [hrBpm, setHrBpm] = useState<number | null>(null);
  const [rmssdMs, setRmssdMs] = useState<number | null>(null);
  const [spo2Pct] = useState<number | null>(null);

  const [imuMetrics, setImuMetrics] = useState({
    axMs2: 0,
    ayMs2: 0,
    azMs2: 0,
    linearImuG: 0,
    gPeak: 1.0,
    tiltDeg: 0,
    omegaDegSec: 0,
    hasHardwareSamples: false,
  });

  const [obdMetrics, setObdMetrics] = useState({
    speedKmh: 0,
    deltaVKmh: 0,
    dtcCode: null as string | null,
    imuGPeak: null as number | null,
  });

  const [fusionEval, setFusionEval] = useState<BiometricFusionAssessment>({
    classification: 'STANDBY',
    panicTriggered: false,
    deltaHrBpm: 0,
    rmssdDropPct: 0,
    linearImuG: 0,
    sustainedSeconds: 0,
    predicates: {
      deltaHrGte35: false,
      rmssdDropGt40: false,
      linearImuLt015g: true,
      sustained15s: false,
    },
  });

  const [crashEval, setCrashEval] = useState<CrashAssessment>(() =>
    evaluateCrashPhysics({ gPeak: 1.0, canDeltaVKmh: 0, tiltDeg: 0, omegaDegSec: 0 })
  );

  const fireAutonomousTrigger = useCallback(
    (triggerType: TriggerType, reason: string) => {
      if (powerState === 'CODE_BLUE_ACTIVE') return;
      const now = Date.now();
      if (now - lastTriggerAtRef.current < 10000) return;
      lastTriggerAtRef.current = now;
      onAutonomousTrigger(triggerType, reason);
    },
    [powerState, onAutonomousTrigger]
  );

  const drawPpgWaveform = useCallback((points: number[], quality: string) => {
    const canvas = waveformCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#05080F';
    ctx.fillRect(0, 0, w, h);

    if (points.length < 2) {
      ctx.fillStyle = '#64748B';
      ctx.font = '12px monospace';
      ctx.fillText('Awaiting live optical PPG or BLE GATT RR stream...', 14, h / 2 + 4);
      return;
    }

    let min = Infinity;
    let max = -Infinity;
    for (const v of points) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const span = Math.max(0.5, max - min);

    ctx.strokeStyle = quality === 'GOOD' ? '#10B981' : '#F59E0B';
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((v, idx) => {
      const x = (idx / Math.max(1, points.length - 1)) * w;
      const y = h - 10 - ((v - min) / span) * (h - 20);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, []);

  // Recompute biometric distress & crash fusion whenever real sensor metrics change
  useEffect(() => {
    const effectiveGPeak = Math.max(imuMetrics.gPeak, obdMetrics.imuGPeak ?? 0);

    const bio = distressTrackerRef.current.evaluate({
      hrBpm,
      rmssdMs,
      baselineHrBpm,
      baselineRmssdMs,
      linearImuG: imuMetrics.linearImuG,
    });
    setFusionEval(bio);

    const crash = evaluateCrashPhysics({
      gPeak: effectiveGPeak,
      canDeltaVKmh: obdMetrics.deltaVKmh,
      tiltDeg: imuMetrics.tiltDeg,
      omegaDegSec: imuMetrics.omegaDegSec,
    });
    setCrashEval(crash);

    onTelemetryChange({
      hrBpm,
      spo2Pct,
      hrvRmssdMs: rmssdMs,
      linearImuG: imuMetrics.linearImuG,
      gPeak: effectiveGPeak,
      canDeltaVKmh: obdMetrics.deltaVKmh,
      rolloverDeg: imuMetrics.tiltDeg,
      omegaDegSec: imuMetrics.omegaDegSec,
      dtcCode: obdMetrics.dtcCode,
    });

    if (powerState === 'ARMED_VIGILANT') {
      if (bio.panicTriggered) {
        fireAutonomousTrigger(
          'PPG_BIOMETRIC_DISTRESS',
          `Sustained ΔHR +${bio.deltaHrBpm} BPM (≥15s) & RMSSD drop ${bio.rmssdDropPct}% while still (${bio.linearImuG}g)`
        );
      } else if (crash.crashTriggered && crash.triggerType) {
        fireAutonomousTrigger(
          crash.triggerType,
          crash.triggerType === 'AUTOMOTIVE_CRASH_OBD'
            ? `Crash confirmed: ${crash.gPeak}G impact + CAN Δv ${crash.canDeltaVKmh} km/h`
            : `Rollover confirmed: tilt ${crash.tiltDeg}° / ω ${crash.omegaDegSec}°/s`
        );
      }
    }
  }, [
    hrBpm,
    rmssdMs,
    spo2Pct,
    baselineHrBpm,
    baselineRmssdMs,
    imuMetrics,
    obdMetrics,
    powerState,
    onTelemetryChange,
    fireAutonomousTrigger,
  ]);

  // Web Bluetooth Heart Rate Service (0x180D / 0x2A37)
  const connectBleHeartRate = async () => {
    setSensorError(null);
    const nav = navigator as unknown as {
      bluetooth?: { requestDevice: (opts: unknown) => Promise<BleDeviceLike> };
    };
    if (!nav.bluetooth) {
      setSensorError('Web Bluetooth API unavailable. Use Chrome/Edge over HTTPS or Android Chrome.');
      return;
    }

    try {
      const device = await nav.bluetooth.requestDevice({
        filters: [{ services: ['heart_rate'] }],
      });
      bleHrDeviceRef.current = device;
      setBleStatus(`Connecting ${device.name || 'HRM'}...`);

      const server = await device.gatt?.connect();
      if (!server) throw new Error('GATT server unavailable');
      const service = await server.getPrimaryService('heart_rate');
      const char = await service.getCharacteristic('heart_rate_measurement');

      await char.startNotifications();
      char.addEventListener('characteristicvaluechanged', (evt) => {
        const reading = parseBleHeartRateMeasurement(evt.target.value);
        setHrBpm(reading.hrBpm);
        if (reading.rrIntervalsMs.length > 0) {
          rrWindowRef.current = [...rrWindowRef.current, ...reading.rrIntervalsMs].slice(-30);
          if (rrWindowRef.current.length >= 2) {
            setRmssdMs(computeRmssdMs(rrWindowRef.current));
          }
        }
        drawPpgWaveform(rrWindowRef.current, 'GOOD');
      });

      device.addEventListener?.('gattserverdisconnected', () => {
        setBleStatus('Disconnected');
        setSensorSource('NONE');
      });

      setSensorSource('BLE_HEART_RATE');
      setBleStatus(`Streaming ${device.name || 'BLE HRM'} (0x180D)`);
    } catch (err) {
      setBleStatus('Disconnected');
      setSensorError(err instanceof Error ? err.message : 'BLE Heart Rate connection canceled.');
    }
  };

  // Web Bluetooth ESP32-S3 OBD-II Lite/Pro Nordic UART Listener
  const connectBleObdDongle = async () => {
    setSensorError(null);
    const nav = navigator as unknown as {
      bluetooth?: { requestDevice: (opts: unknown) => Promise<BleDeviceLike> };
    };
    if (!nav.bluetooth) {
      setSensorError('Web Bluetooth API unavailable in this browser.');
      return;
    }

    try {
      const device = await nav.bluetooth.requestDevice({
        filters: [{ services: [NORDIC_UART_SERVICE] }],
        optionalServices: [NORDIC_UART_SERVICE],
      });
      bleObdDeviceRef.current = device;
      setObdStatus(`Connecting ${device.name || 'OBD-II'}...`);

      const server = await device.gatt?.connect();
      if (!server) throw new Error('GATT server unavailable');
      const service = await server.getPrimaryService(NORDIC_UART_SERVICE);
      const txChar = await service.getCharacteristic(NORDIC_UART_TX_CHAR);
      await txChar.startNotifications();

      const decoder = new TextDecoder();
      txChar.addEventListener('characteristicvaluechanged', (evt) => {
        const text = decoder.decode(evt.target.value.buffer);
        const packet = parseObdBlePacket(text, prevObdSpeedRef.current);
        if (packet) {
          prevObdSpeedRef.current = packet.speedKmh;
          setObdMetrics({
            speedKmh: packet.speedKmh,
            deltaVKmh: packet.deltaVKmh,
            dtcCode: packet.dtcCode,
            imuGPeak: packet.imuGPeak,
          });
        }
      });

      device.addEventListener?.('gattserverdisconnected', () => {
        setObdStatus('Disconnected');
      });

      setObdStatus(`Linked ${device.name || 'ESP32-S3 OBD-II'}`);
    } catch (err) {
      setObdStatus('Disconnected');
      setSensorError(err instanceof Error ? err.message : 'OBD-II BLE connection canceled.');
    }
  };

  // Real Rear Camera + Torch Optical PPG Mode
  const stopOpticalPpg = useCallback(() => {
    if (ppgRafRef.current !== null) {
      cancelAnimationFrame(ppgRafRef.current);
      ppgRafRef.current = null;
    }
    if (ppgStreamRef.current) {
      ppgStreamRef.current.getTracks().forEach((t) => t.stop());
      ppgStreamRef.current = null;
    }
    ppgProcessorRef.current.reset();
    setPpgActive(false);
    setSensorSource((prev) => (prev === 'OPTICAL_CAMERA_PPG' ? 'NONE' : prev));
  }, []);

  const startOpticalPpg = async () => {
    setSensorError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setSensorError('Camera API unavailable for Optical PPG.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 160 },
          height: { ideal: 120 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });
      ppgStreamRef.current = stream;

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack && typeof videoTrack.applyConstraints === 'function') {
        await videoTrack
          .applyConstraints({
            advanced: [{ torch: true } as unknown as MediaTrackConstraintSet],
          })
          .catch(() => undefined);
      }

      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();

      if (!offscreenCanvasRef.current) {
        const c = document.createElement('canvas');
        c.width = 64;
        c.height = 64;
        offscreenCanvasRef.current = c;
      }

      setPpgActive(true);
      setSensorSource('OPTICAL_CAMERA_PPG');

      const analyzeFrame = () => {
        const v = videoRef.current;
        const c = offscreenCanvasRef.current;
        if (!v || !c || !ppgStreamRef.current) return;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        if (ctx && v.readyState >= 2) {
          ctx.drawImage(v, 0, 0, c.width, c.height);
          const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
          let rSum = 0;
          let gSum = 0;
          let bSum = 0;
          const total = pixels.length / 4;
          for (let i = 0; i < pixels.length; i += 4) {
            rSum += pixels[i];
            gSum += pixels[i + 1];
            bSum += pixels[i + 2];
          }
          const res = ppgProcessorRef.current.pushIntensitySample(
            rSum / total,
            gSum / total,
            bSum / total
          );
          setPpgQuality(res.signalQuality);
          if (res.hrBpm !== null) setHrBpm(res.hrBpm);
          if (res.rmssdMs !== null) setRmssdMs(res.rmssdMs);
          drawPpgWaveform(res.filteredWaveform, res.signalQuality);
        }
        ppgRafRef.current = requestAnimationFrame(analyzeFrame);
      };

      ppgRafRef.current = requestAnimationFrame(analyzeFrame);
    } catch (err) {
      setSensorError(
        err instanceof Error ? err.message : 'Unable to start rear camera for Optical PPG.'
      );
      stopOpticalPpg();
    }
  };

  // Real Smartphone DeviceMotion & DeviceOrientation IMU
  const enableImuSensors = async () => {
    setImuNotice(null);
    setSensorError(null);

    const dmEvent = DeviceMotionEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };

    if (typeof dmEvent?.requestPermission === 'function') {
      try {
        const perm = await dmEvent.requestPermission();
        if (perm !== 'granted') {
          setImuNotice('iOS Motion & Orientation permission denied.');
          return;
        }
      } catch (err) {
        setImuNotice(
          err instanceof Error ? err.message : 'Unable to request iOS motion permission.'
        );
        return;
      }
    }

    setImuActive(true);
    setImuNotice('Listening for hardware DeviceMotion & DeviceOrientation events...');
  };

  useEffect(() => {
    if (!imuActive) return;

    const handleMotion = (event: DeviceMotionEvent) => {
      const acc = event.accelerationIncludingGravity;
      if (!acc || acc.x === null || acc.y === null || acc.z === null) return;

      const ax = acc.x;
      const ay = acc.y;
      const az = acc.z;
      const aTotal = Math.sqrt(ax * ax + ay * ay + az * az);
      const linearImuG = Number((Math.abs(aTotal - GRAVITY_MS2) / GRAVITY_MS2).toFixed(3));
      const gForceTotal = Number((aTotal / GRAVITY_MS2).toFixed(2));

      const rot = event.rotationRate;
      const omega = rot
        ? Math.max(Math.abs(rot.alpha ?? 0), Math.abs(rot.beta ?? 0), Math.abs(rot.gamma ?? 0))
        : 0;

      setImuMetrics((prev) => ({
        ...prev,
        axMs2: Number(ax.toFixed(2)),
        ayMs2: Number(ay.toFixed(2)),
        azMs2: Number(az.toFixed(2)),
        linearImuG,
        gPeak: gForceTotal,
        omegaDegSec: Number(omega.toFixed(1)),
        hasHardwareSamples: true,
      }));
    };

    const handleOrientation = (event: DeviceOrientationEvent) => {
      if (event.beta === null && event.gamma === null) return;
      const tiltDeg = Number(
        Math.max(Math.abs(event.beta ?? 0), Math.abs(event.gamma ?? 0)).toFixed(1)
      );
      setImuMetrics((prev) => ({ ...prev, tiltDeg, hasHardwareSamples: true }));
    };

    window.addEventListener('devicemotion', handleMotion);
    window.addEventListener('deviceorientation', handleOrientation);

    return () => {
      window.removeEventListener('devicemotion', handleMotion);
      window.removeEventListener('deviceorientation', handleOrientation);
    };
  }, [imuActive]);

  useEffect(() => {
    drawPpgWaveform([], 'LOW_CONTACT');
    return () => {
      stopOpticalPpg();
    };
  }, [drawPpgWaveform, stopOpticalPpg]);

  return (
    <section className="rounded-2xl border border-slate-800 bg-[#0B1120] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-mono text-xs text-emerald-400">
            <HeartPulse className="h-4 w-4" />
            BIOMETRIC &amp; AUTOMOTIVE CRASH SENSOR FUSION
          </div>
          <h2 className="mt-1 text-base font-bold text-white">
            Web Bluetooth GATT · Camera Optical PPG · DeviceMotion IMU
          </h2>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={connectBleHeartRate}
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/25"
          >
            <Bluetooth className="h-3.5 w-3.5" />
            BLE Heart Rate (0x180D)
          </button>

          <button
            type="button"
            onClick={ppgActive ? stopOpticalPpg : startOpticalPpg}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${
              ppgActive
                ? 'border border-red-500/40 bg-red-500/15 text-red-200'
                : 'border border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25'
            }`}
          >
            <Camera className="h-3.5 w-3.5" />
            {ppgActive ? 'Stop Camera PPG' : 'Camera Optical PPG'}
          </button>

          <button
            type="button"
            onClick={connectBleObdDongle}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/25"
          >
            <Car className="h-3.5 w-3.5" />
            Pair OBD-II BLE
          </button>

          <button
            type="button"
            onClick={enableImuSensors}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-slate-500"
          >
            <Smartphone className="h-3.5 w-3.5" />
            {imuActive ? 'IMU Active' : 'Enable IMU Motion'}
          </button>
        </div>
      </div>

      {sensorError && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-950/30 p-3 text-xs text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <span>{sensorError}</span>
        </div>
      )}

      {imuNotice && (
        <div className="mt-2 font-mono text-[11px] text-slate-400">
          {imuNotice}
          {imuActive && !imuMetrics.hasHardwareSamples
            ? ' (No hardware accelerometer samples emitted yet — normal on desktop devices without IMU.)'
            : ''}
        </div>
      )}

      {/* Hidden video element for live optical PPG */}
      <video ref={videoRef} playsInline muted className="hidden" />

      {/* Optical / RR Waveform Canvas */}
      <div className="mt-4 overflow-hidden rounded-xl border border-slate-800 bg-[#05080F] p-2">
        <canvas ref={waveformCanvasRef} width={640} height={110} className="h-28 w-full rounded" />
        <div className="mt-1.5 flex flex-wrap items-center justify-between px-1 font-mono text-[11px] text-slate-400">
          <span>Source: {sensorSource}</span>
          <span>BLE HRM: {bleStatus}</span>
          <span>OBD-II: {obdStatus}</span>
          {ppgActive && (
            <span
              className={
                ppgQuality === 'GOOD'
                  ? 'text-emerald-400'
                  : ppgQuality === 'CALIBRATING'
                    ? 'text-amber-300'
                    : 'text-red-300'
              }
            >
              Optical Contact: {ppgQuality} (Cover rear camera + torch gently with fingertip)
            </span>
          )}
        </div>
      </div>

      {/* Live Numeric Sensor Grid */}
      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
          <div className="text-[10px] font-mono text-slate-400">HEART RATE</div>
          <div className="mt-1 font-mono text-lg font-bold text-white">
            {hrBpm !== null ? `${hrBpm} BPM` : '--'}
          </div>
          <div className="font-mono text-[10px] text-slate-500">
            Base {baselineHrBpm} (Δ{fusionEval.deltaHrBpm >= 0 ? `+${fusionEval.deltaHrBpm}` : fusionEval.deltaHrBpm})
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
          <div className="text-[10px] font-mono text-slate-400">HRV RMSSD</div>
          <div className="mt-1 font-mono text-lg font-bold text-white">
            {rmssdMs !== null ? `${rmssdMs} ms` : '--'}
          </div>
          <div className="font-mono text-[10px] text-slate-500">
            Base {baselineRmssdMs}ms (-{fusionEval.rmssdDropPct}%)
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
          <div className="text-[10px] font-mono text-slate-400">LINEAR IMU |a−g|</div>
          <div className="mt-1 font-mono text-lg font-bold text-cyan-300">
            {imuMetrics.hasHardwareSamples ? `${imuMetrics.linearImuG} g` : '--'}
          </div>
          <div className="font-mono text-[10px] text-slate-500">Gate &lt; 0.15g</div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
          <div className="text-[10px] font-mono text-slate-400">PEAK IMPACT G</div>
          <div className="mt-1 font-mono text-lg font-bold text-amber-300">
            {crashEval.gPeak} G
          </div>
          <div className="font-mono text-[10px] text-slate-500">Crash &gt; 10G</div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
          <div className="text-[10px] font-mono text-slate-400">CAN Δv</div>
          <div className="mt-1 font-mono text-lg font-bold text-slate-100">
            {obdMetrics.deltaVKmh} km/h
          </div>
          <div className="font-mono text-[10px] text-slate-500">
            Spd {obdMetrics.speedKmh} km/h
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
          <div className="text-[10px] font-mono text-slate-400">ROLLOVER θ / ω</div>
          <div className="mt-1 font-mono text-lg font-bold text-slate-100">
            {imuMetrics.tiltDeg}° / {imuMetrics.omegaDegSec}°/s
          </div>
          <div className="font-mono text-[10px] text-slate-500">&gt;60° or &gt;90°/s</div>
        </div>
      </div>

      {/* Fusion Status & Baseline Calibration */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
        <div className="flex items-center gap-2.5">
          <Activity
            className={`h-4 w-4 ${
              fusionEval.panicTriggered || crashEval.crashTriggered
                ? 'text-red-400'
                : fusionEval.classification === 'EXERTION_FILTERED'
                  ? 'text-amber-400'
                  : 'text-emerald-400'
            }`}
          />
          <div className="text-xs">
            <span className="font-semibold text-white">Fusion State: </span>
            <span className="font-mono text-cyan-300">{fusionEval.classification}</span>
            {fusionEval.sustainedSeconds > 0 && (
              <span className="ml-2 font-mono text-amber-300">
                Sustained: {fusionEval.sustainedSeconds}s / 15s
              </span>
            )}
          </div>
        </div>

        {hrBpm !== null && rmssdMs !== null && (
          <button
            type="button"
            onClick={() => onCalibrateBaseline(hrBpm, rmssdMs)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Save Current Reading as Baseline ({hrBpm} BPM · {rmssdMs} ms)
          </button>
        )}
      </div>
    </section>
  );
}
