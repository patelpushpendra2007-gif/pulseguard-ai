import React, { useEffect, useRef, useState } from 'react';
import {
  Mic,
  MicOff,
  HeartPulse,
  ShieldAlert,
  Lock,
  Radio,
  CheckCircle2,
  XCircle,
  Wifi,
  Bluetooth,
  MessageSquare,
  Clock,
  Navigation,
  Sparkles
} from 'lucide-react';
import {
  SafeWordEdgeModel,
  synthesizeAcousticPhrase,
  downsampleTo16k,
  SAMPLE_RATE
} from '@shared/audioDsp';
import {
  BiometricDistressEngine,
  synthesizeRrIntervals,
  ppgPulseSample
} from '@shared/biometricModel';
import { MICRO_ZONES } from '@shared/domainData';
import { apiRequest } from '../lib/api';
import { clinicalAudio } from '../lib/sound';

export default function CitizenView({ user, zoneId, incidents, zoneSnapshot, onUserUpdated, onIncidentCreated, onOpenDoctorTab }) {
  // DSP SafeWord Model instance
  const safeWordModelRef = useRef(null);
  if (!safeWordModelRef.current) {
    safeWordModelRef.current = new SafeWordEdgeModel(user.safeWordLabel || 'RED LOTUS');
  }

  // Biometric Engine instance
  const bioEngineRef = useRef(new BiometricDistressEngine());

  // SafeWord UI State
  const [safeWordInput, setSafeWordInput] = useState(user.safeWordLabel || 'RED LOTUS');
  const [dspStats, setDspStats] = useState({
    matched: false,
    confidence: 0,
    inferenceMs: 3.4,
    footprintMb: 1.13,
    diskBytesPersisted: 0,
    ringBufferOverwrites: 0,
    batteryDrawPctHr: 0.36,
    maxDbfs: -42,
    logMelBands: new Array(40).fill(-12),
    mfccCoeffs: new Array(13).fill(0)
  });
  const [micActive, setMicActive] = useState(false);
  const [micError, setMicError] = useState('');
  const micCleanupRef = useRef(null);

  // Biometric UI State
  const [hrBpm, setHrBpm] = useState(76);
  const [rmssdTarget, setRmssdTarget] = useState(46);
  const [linearAccelG, setLinearAccelG] = useState(0.06);
  const [spo2Pct, setSpo2Pct] = useState(98);
  const [bioEval, setBioEval] = useState(() =>
    bioEngineRef.current.evaluateSample({
      hrBpm: 76,
      spo2Pct: 98,
      rrIntervalsMs: synthesizeRrIntervals(76, 46, 16, 0),
      linearImuGOverride: 0.06,
      deltaSeconds: 1
    })
  );

  // Transport & Countdown State
  const [transportMode, setTransportMode] = useState('4G_WS');
  const [countdown, setCountdown] = useState(null); // { seconds, triggerType, reason }
  const [dispatching, setDispatching] = useState(false);
  const [statusNotice, setStatusNotice] = useState('');

  // Canvas refs
  const specCanvasRef = useRef(null);
  const ppgCanvasRef = useRef(null);
  const ppgPhaseRef = useRef(0);

  // Sync SafeWord if user switches persona
  useEffect(() => {
    const label = user.safeWordLabel || 'RED LOTUS';
    setSafeWordInput(label);
    safeWordModelRef.current.enrollFromSignal(synthesizeAcousticPhrase(label), label);
  }, [user.id, user.safeWordLabel]);

  // Real 1-second Biometric evaluation tick
  useEffect(() => {
    let tickCount = 0;
    const id = setInterval(() => {
      tickCount++;
      const rr = synthesizeRrIntervals(hrBpm, rmssdTarget, 16, tickCount);
      const res = bioEngineRef.current.evaluateSample({
        hrBpm,
        spo2Pct,
        rrIntervalsMs: rr,
        linearImuGOverride: linearAccelG,
        deltaSeconds: 1
      });
      setBioEval(res);
      if (res.panicTriggered && !countdown && !activeUserIncident) {
        startHapticCountdown('PPG_DISTRESS', `Sustained ΔHR +${res.deltaHr} BPM & RMSSD drop ${res.rmssdDropPct}% while still (${res.linearImuG}g)`);
      }
    }, 1000);
    return () => clearInterval(id);
  });

  // Real-time 40-band Mel Spectrogram + 13 MFCC bar canvas
  useEffect(() => {
    const canvas = specCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(0, 0, w, h);

    // Draw 40 Mel Bands
    const bands = dspStats.logMelBands || [];
    const barW = w / Math.max(1, bands.length);
    bands.forEach((val, idx) => {
      const norm = Math.max(0.05, Math.min(1, (val + 14) / 14));
      const barH = norm * (h - 14);
      ctx.fillStyle = dspStats.matched ? '#DC2626' : '#1D4ED8';
      ctx.globalAlpha = 0.25 + norm * 0.7;
      ctx.fillRect(idx * barW + 1, h - barH - 4, Math.max(2, barW - 2), barH);
    });
    ctx.globalAlpha = 1;
  }, [dspStats]);

  // Real-time Arterial PPG Canvas Loop
  useEffect(() => {
    let raf;
    const pts = new Array(160).fill(0.2);
    const render = () => {
      const canvas = ppgCanvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;
        const beatsPerSec = hrBpm / 60;
        ppgPhaseRef.current = (ppgPhaseRef.current + beatsPerSec / 45) % 1;
        pts.push(ppgPulseSample(ppgPhaseRef.current));
        if (pts.length > 160) pts.shift();

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, w, h);

        // Subtle clinical grid
        ctx.strokeStyle = '#F1F5F9';
        ctx.lineWidth = 1;
        for (let x = 0; x < w; x += 24) {
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }
        for (let y = 0; y < h; y += 20) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }

        ctx.beginPath();
        ctx.strokeStyle = bioEval.predicates.deltaHrGte35 && bioEval.predicates.linearImuLt015g ? '#DC2626' : '#0F766E';
        ctx.lineWidth = 2;
        pts.forEach((v, i) => {
          const x = (i / (pts.length - 1)) * w;
          const y = h - 10 - v * (h - 20);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [hrBpm, bioEval.predicates.deltaHrGte35, bioEval.predicates.linearImuLt015g]);

  // Countdown Timer Effect
  useEffect(() => {
    if (!countdown) return;
    if (countdown.seconds <= 0) {
      const { triggerType, reason } = countdown;
      setCountdown(null);
      submitEmergencyDispatch(triggerType, reason);
      return;
    }
    clinicalAudio.countdownTick();
    const t = setTimeout(() => {
      setCountdown((prev) => (prev ? { ...prev, seconds: prev.seconds - 1 } : null));
    }, 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  // Cleanup mic on unmount
  useEffect(() => () => micCleanupRef.current?.(), []);

  const activeUserIncident = incidents.find(
    (inc) => inc.microZone === zoneId && ['ACTIVE', 'DISPATCHED', 'ON_SCENE'].includes(inc.status)
  );

  function startHapticCountdown(triggerType, reason) {
    setCountdown({ seconds: 5, triggerType, reason });
  }

  async function submitEmergencyDispatch(triggerType, reason) {
    setDispatching(true);
    setStatusNotice('');
    try {
      const zone = MICRO_ZONES[zoneId] || MICRO_ZONES.aiims_delhi;
      const res = await apiRequest('/incidents/trigger', {
        method: 'POST',
        body: {
          microZone: zone.id,
          lat: zone.lat,
          lng: zone.lng,
          triggerType,
          transportMode,
          vitals: {
            hrBpm: bioEval.hrBpm,
            deltaHr: bioEval.deltaHr,
            spo2Pct,
            rmssdMs: bioEval.rmssdMs,
            rmssdDropPct: bioEval.rmssdDropPct,
            linearImuG: bioEval.linearImuG,
            reason
          },
          evidenceNote: reason
        }
      });
      clinicalAudio.alertChime();
      onIncidentCreated?.(res.incident);
      setStatusNotice(`Dispatched ${res.incident.id} (${res.smsPacket.byteLength}B SMS + ECDH P-256 sealed).`);
    } catch (err) {
      setStatusNotice(`Dispatch error: ${err.message}`);
    } finally {
      setDispatching(false);
    }
  }

  const handleEnrollSafeWord = async () => {
    const clean = safeWordInput.trim().toUpperCase() || 'RED LOTUS';
    setSafeWordInput(clean);
    const info = safeWordModelRef.current.enrollFromSignal(synthesizeAcousticPhrase(clean), clean);
    try {
      const data = await apiRequest('/auth/profile', {
        method: 'PATCH',
        body: { safeWordLabel: clean }
      });
      onUserUpdated?.(data.user);
      clinicalAudio.successChime();
      setStatusNotice(`Enrolled "${info.safeWord}" (${info.templateFrames} INT8 MFCC frames, ${info.footprintMb} MB footprint).`);
    } catch (err) {
      setStatusNotice(err.message);
    }
  };

  const handleTestAcousticTrigger = () => {
    const phraseSignal = synthesizeAcousticPhrase(safeWordInput);
    safeWordModelRef.current.ringBuffer.wipeVolatileRam();
    // Feed in 100ms chunks (10ms hops) to exercise the exact streaming ring-buffer DSP pipeline
    let bestRes = null;
    const chunkSize = 1600;
    for (let i = 0; i < phraseSignal.length; i += chunkSize) {
      const slice = phraseSignal.subarray(i, Math.min(phraseSignal.length, i + chunkSize));
      if (slice.length >= 400) {
        const res = safeWordModelRef.current.evaluateAudioChunk(slice, 0.78);
        if (!bestRes || res.confidence >= bestRes.confidence) {
          bestRes = {
            ...res,
            ringBufferOverwrites: res.ringBufferOverwrites
          };
        } else {
          bestRes = {
            ...bestRes,
            ringBufferOverwrites: res.ringBufferOverwrites
          };
        }
      }
    }
    if (bestRes) {
      setDspStats(bestRes);
      if (bestRes.matched) {
        startHapticCountdown(
          'SAFEWORD',
          `TinyML INT8 SafeWord "${safeWordInput}" matched (${Math.round(bestRes.confidence * 100)}% conf, ${bestRes.inferenceMs}ms inference)`
        );
      }
    }
  };

  const toggleLiveMic = async () => {
    if (micActive) {
      micCleanupRef.current?.();
      micCleanupRef.current = null;
      setMicActive(false);
      return;
    }
    setMicError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(2048, 1, 1);

      processor.onaudioprocess = (ev) => {
        const input = ev.inputBuffer.getChannelData(0);
        const pcm16k = downsampleTo16k(input, ctx.sampleRate);
        const res = safeWordModelRef.current.evaluateAudioChunk(pcm16k, 0.80);
        setDspStats(res);
      };

      source.connect(processor);
      processor.connect(ctx.destination);

      micCleanupRef.current = () => {
        processor.disconnect();
        source.disconnect();
        stream.getTracks().forEach((t) => t.stop());
        ctx.close().catch(() => {});
      };
      setMicActive(true);
    } catch (err) {
      setMicError('Microphone permission unavailable; use "Test Spoken SafeWord DSP" to run the exact MFCC+DTW pipeline.');
    }
  };

  const applyBiometricPreset = (preset) => {
    if (preset === 'normal') {
      bioEngineRef.current.reset(74, 46);
      setHrBpm(76); setRmssdTarget(46); setLinearAccelG(0.06); setSpo2Pct(98);
    } else if (preset === 'workout') {
      bioEngineRef.current.reset(74, 46);
      setHrBpm(148); setRmssdTarget(22); setLinearAccelG(0.62); setSpo2Pct(97);
    } else if (preset === 'panic') {
      bioEngineRef.current.reset(74, 46);
      bioEngineRef.current.sustainedBreachSeconds = 13; // Fast-forward 13s into 15s window for crisp live verification
      setHrBpm(142); setRmssdTarget(18); setLinearAccelG(0.07); setSpo2Pct(94);
    }
  };

  const handleCancelActiveSos = async (incId) => {
    try {
      await apiRequest(`/incidents/${incId}/status`, {
        method: 'POST',
        body: { status: 'CANCELLED' }
      });
      setStatusNotice(`Incident ${incId} cancelled safely; ephemeral ECDH keys shredded.`);
      onIncidentCreated?.();
    } catch (err) {
      setStatusNotice(err.message);
    }
  };

  const zone = MICRO_ZONES[zoneId] || MICRO_ZONES.aiims_delhi;

  return (
    <div className="space-y-6">
      {/* Active Countdown Overlay Banner */}
      {countdown && (
        <div className="clinical-card border-amber-300 bg-amber-50 p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-amber-600 text-white font-mono text-xl font-bold flex items-center justify-center tabular-nums">
              {countdown.seconds}s
            </div>
            <div>
              <div className="text-sm font-bold text-amber-950">
                Silent Haptic Verification Window · False-Alarm Guard (&lt;0.2% FP)
              </div>
              <div className="text-xs text-amber-800">{countdown.reason}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setCountdown(null)}
              className="px-4 py-2 bg-white hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-xl text-xs font-bold flex items-center gap-1.5"
            >
              <XCircle className="w-4 h-4" /> Cancel False Alarm
            </button>
            <button
              type="button"
              onClick={() => {
                const { triggerType, reason } = countdown;
                setCountdown(null);
                submitEmergencyDispatch(triggerType, reason);
              }}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold"
            >
              Dispatch Now
            </button>
          </div>
        </div>
      )}

      {/* Active Incident Tracker */}
      {activeUserIncident && (
        <div className="clinical-card border-rose-300 bg-rose-50/70 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-600 text-white flex items-center justify-center">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-rose-950">
                    Active SOS Dispatch · {activeUserIncident.id}
                  </span>
                  <span className="badge-pill bg-rose-100 text-rose-800 border-rose-300">
                    {activeUserIncident.status}
                  </span>
                </div>
                <p className="text-xs text-rose-800">
                  GeoHash <span className="font-mono font-semibold">{activeUserIncident.geohash}</span> ·{' '}
                  {activeUserIncident.transportMode} · Encrypted with ECDH-P256 + AES-256-GCM
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onOpenDoctorTab}
                className="px-3.5 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5"
              >
                <Navigation className="w-3.5 h-3.5" /> Inspect Doctor Mesh
              </button>
              {activeUserIncident.userId === user.id && (
                <button
                  type="button"
                  onClick={() => handleCancelActiveSos(activeUserIncident.id)}
                  className="px-3.5 py-2 bg-white hover:bg-rose-100 text-rose-800 border border-rose-300 rounded-xl text-xs font-semibold"
                >
                  Cancel SOS
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(activeUserIncident.matchedResponders || []).slice(0, 2).map((doc) => (
              <div key={doc.id} className="bg-white border border-rose-200/80 rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900">{doc.name}</span>
                  <span className="text-[11px] font-mono font-bold text-emerald-700 tabular-nums">
                    {Math.floor(doc.etaSec / 60)}m {String(doc.etaSec % 60).padStart(2, '0')}s
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {doc.nmcId} · {(doc.distanceM / 1000).toFixed(2)} km away
                </div>
              </div>
            ))}
            <div className="bg-white border border-rose-200/80 rounded-xl p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900">108 EMS Ambulance Bridge</span>
                <span className="text-[11px] font-mono font-bold text-amber-700 tabular-nums">
                  {Math.round((activeUserIncident.ambulanceEtaSec || 1200) / 60)} min
                </span>
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {activeUserIncident.greenCorridor ? 'Green Corridor Active' : 'Standard Urban Traffic'}
              </div>
            </div>
          </div>
        </div>
      )}

      {statusNotice && (
        <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs font-medium flex items-center justify-between">
          <span>{statusNotice}</span>
          <button type="button" onClick={() => setStatusNotice('')} className="text-blue-700 font-bold ml-4">
            Dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Column 1: On-Device Edge Audio DSP & Volatile RAM Guard */}
        <div className="lg:col-span-5 space-y-5">
          <div className="clinical-card p-5 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-slate-900">On-Device Voice SafeWord DSP</span>
                  <span className="badge-pill bg-emerald-50 text-emerald-700 border-emerald-200">
                    <Lock className="w-3 h-3" /> 0B Disk
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  2.5s Volatile Ring Buffer · 512-pt STFT → 40-Band Mel → 13 MFCC → INT8 DTW
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={safeWordInput}
                onChange={(e) => setSafeWordInput(e.target.value.toUpperCase())}
                placeholder="Custom SafeWord..."
                className="flex-1 px-3 py-2 text-xs font-mono font-semibold uppercase bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:border-blue-600"
              />
              <button
                type="button"
                onClick={handleEnrollSafeWord}
                className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl"
              >
                Enroll
              </button>
            </div>

            <div className="clinical-inset p-3 space-y-2">
              <div className="flex items-center justify-between text-[11px] text-slate-600">
                <span className="font-medium">40-Band Mel Filterbank Power Spectrum</span>
                <span className="font-mono text-blue-700 font-semibold">
                  RAM Overwrites: {dspStats.ringBufferOverwrites}
                </span>
              </div>
              <canvas ref={specCanvasRef} width={420} height={84} className="w-full h-20 rounded-lg border border-slate-200" />
              <div className="grid grid-cols-3 gap-2 pt-1 text-[11px] tabular-nums">
                <div>
                  <div className="text-slate-400">Inference</div>
                  <div className="font-mono font-bold text-slate-900">{dspStats.inferenceMs} ms <span className="text-emerald-600 font-sans">(&lt;45)</span></div>
                </div>
                <div>
                  <div className="text-slate-400">DTW Match</div>
                  <div className={`font-mono font-bold ${dspStats.matched ? 'text-rose-600' : 'text-slate-900'}`}>
                    {Math.round(dspStats.confidence * 100)}%
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">VAD Draw</div>
                  <div className="font-mono font-bold text-blue-700">{dspStats.batteryDrawPctHr}%/hr</div>
                </div>
              </div>
            </div>

            {micError && (
              <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[11px]">
                {micError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={handleTestAcousticTrigger}
                className="py-2.5 px-3 bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" /> Test SafeWord DSP
              </button>
              <button
                type="button"
                onClick={toggleLiveMic}
                className={`py-2.5 px-3 text-xs font-semibold rounded-xl border flex items-center justify-center gap-1.5 ${
                  micActive
                    ? 'bg-rose-600 text-white border-rose-600'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
              >
                {micActive ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                {micActive ? 'Stop Live Mic' : 'Live Mic VAD'}
              </button>
            </div>
          </div>

          {/* Resilient Failover & Manual Trigger Card */}
          <div className="clinical-card p-5 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Resilient Uplink Transport</h3>
              <p className="text-xs text-slate-500">
                Select active link path or test basement dead-zone failover (3s auto-switch).
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[
                { id: '4G_WS', label: '4G/5G TLS', icon: Wifi },
                { id: 'BLE_MESH', label: 'BLE 5.0 Mesh', icon: Bluetooth },
                { id: 'BINARY_SMS', label: '52B SMS', icon: MessageSquare }
              ].map((t) => {
                const Icon = t.icon;
                const active = transportMode === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTransportMode(t.id)}
                    className={`p-2.5 rounded-xl border text-center transition-all ${
                      active
                        ? 'bg-blue-50 border-blue-600 text-blue-900 font-semibold'
                        : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <Icon className={`w-4 h-4 mx-auto mb-1 ${active ? 'text-blue-700' : 'text-slate-400'}`} />
                    <div className="text-[11px]">{t.label}</div>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              disabled={dispatching}
              onClick={() =>
                submitEmergencyDispatch(
                  'MANUAL_SOS',
                  `Manual silent SOS triggered in ${zone.shortName} via ${transportMode}`
                )
              }
              className="w-full py-3 px-4 bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white rounded-xl text-sm font-bold shadow-sm flex items-center justify-center gap-2 transition-colors"
            >
              <ShieldAlert className="w-4 h-4" />
              {dispatching ? 'Encrypting & Dispatching...' : `Trigger Instant Code Blue (${zone.shortName})`}
            </button>
          </div>
        </div>

        {/* Column 2: Wearable PPG + HRV (RMSSD) + Gravity-Free IMU Fusion */}
        <div className="lg:col-span-7 space-y-5">
          <div className="clinical-card p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <HeartPulse className="w-5 h-5 text-teal-700" />
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Wearable PPG + HRV (RMSSD) + Gravity-Free IMU Fusion
                  </h3>
                  <p className="text-xs text-slate-500">
                    Panic = (ΔHR ≥ +35 BPM sustained ≥ 15s) ∧ (RMSSD drop &gt; 40%) ∧ (|a_total − g| &lt; 0.15g)
                  </p>
                </div>
              </div>
              <span
                className={`badge-pill ${
                  bioEval.classification === 'DISTRESS_CONFIRMED'
                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                    : bioEval.classification === 'EXERTION_FILTERED'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : bioEval.classification === 'SUSTAINED_WINDOW_ACCUMULATING'
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : 'bg-slate-100 text-slate-700 border-slate-200'
                }`}
              >
                {bioEval.classification.replaceAll('_', ' ')}
              </span>
            </div>

            {/* Live Arterial PPG Waveform */}
            <div className="clinical-inset p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs tabular-nums">
                <span>
                  Heart Rate: <strong className="font-mono text-slate-900">{bioEval.hrBpm} BPM</strong>{' '}
                  <span className="text-slate-500">(Δ {bioEval.deltaHr >= 0 ? `+${bioEval.deltaHr}` : bioEval.deltaHr})</span>
                </span>
                <span>
                  HRV RMSSD: <strong className="font-mono text-slate-900">{bioEval.rmssdMs} ms</strong>{' '}
                  <span className="text-slate-500">(-{bioEval.rmssdDropPct}%)</span>
                </span>
                <span>
                  Linear IMU: <strong className="font-mono text-slate-900">{bioEval.linearImuG}g</strong>
                </span>
                <span>
                  SpO₂: <strong className="font-mono text-slate-900">{spo2Pct}%</strong>
                </span>
              </div>
              <canvas ref={ppgCanvasRef} width={640} height={110} className="w-full h-28 rounded-lg border border-slate-200" />
            </div>

            {/* Scenario Presets */}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => applyBiometricPreset('normal')}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700"
              >
                Resting Baseline (76 BPM · 0.06g)
              </button>
              <button
                type="button"
                onClick={() => applyBiometricPreset('workout')}
                className="px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-xs font-semibold text-emerald-800"
              >
                Gym Workout Filter Test (148 BPM · 0.62g)
              </button>
              <button
                type="button"
                onClick={() => applyBiometricPreset('panic')}
                className="px-3 py-1.5 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-xs font-semibold text-rose-800"
              >
                Acute Stationary Panic (142 BPM · 18ms · 0.07g)
              </button>
            </div>

            {/* Interactive Controls */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-600 font-medium">Heart Rate</span>
                  <span className="font-mono font-bold text-slate-900">{hrBpm} BPM</span>
                </div>
                <input
                  type="range"
                  min={55}
                  max={180}
                  value={hrBpm}
                  onChange={(e) => setHrBpm(Number(e.target.value))}
                  className="w-full accent-blue-700"
                />
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-600 font-medium">HRV (RMSSD)</span>
                  <span className="font-mono font-bold text-slate-900">{rmssdTarget} ms</span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={70}
                  value={rmssdTarget}
                  onChange={(e) => setRmssdTarget(Number(e.target.value))}
                  className="w-full accent-blue-700"
                />
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-600 font-medium">Linear IMU |a−g|</span>
                  <span className="font-mono font-bold text-slate-900">{linearAccelG.toFixed(2)}g</span>
                </div>
                <input
                  type="range"
                  min={0.02}
                  max={1.20}
                  step={0.02}
                  value={linearAccelG}
                  onChange={(e) => setLinearAccelG(Number(e.target.value))}
                  className="w-full accent-blue-700"
                />
              </div>
            </div>

            {/* Boolean Fusion Gate Inspector */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
              {[
                { label: 'ΔHR ≥ +35 BPM', ok: bioEval.predicates.deltaHrGte35, val: `+${bioEval.deltaHr}` },
                { label: 'RMSSD Drop > 40%', ok: bioEval.predicates.rmssdDropGt40, val: `${bioEval.rmssdDropPct}%` },
                { label: 'Linear IMU < 0.15g', ok: bioEval.predicates.linearImuLt015g, val: `${bioEval.linearImuG}g` },
                { label: 'Sustained ≥ 15s', ok: bioEval.predicates.sustained15s, val: `${bioEval.sustainedSeconds}s / 15s` }
              ].map((gate) => (
                <div
                  key={gate.label}
                  className={`p-2.5 rounded-xl border text-xs ${
                    gate.ok ? 'bg-rose-50 border-rose-200 text-rose-900' : 'bg-slate-50 border-slate-200 text-slate-600'
                  }`}
                >
                  <div className="flex items-center justify-between font-semibold">
                    <span className="truncate">{gate.label}</span>
                    {gate.ok ? <CheckCircle2 className="w-3.5 h-3.5 text-rose-600 shrink-0" /> : <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
                  </div>
                  <div className="font-mono text-[11px] font-bold mt-1">{gate.val}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Nearest Verified Responders & PulseBox Bay in Zone */}
          <div className="clinical-card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">
                GeoHash Micro-Fence Supply ({zone.shortName})
              </h3>
              <span className="text-xs font-mono text-slate-500">GeoHash: {zone.geohash} · {zone.density}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(zoneSnapshot?.responders || []).slice(0, 4).map((doc) => (
                <div key={doc.id} className="clinical-inset p-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-900 truncate">{doc.name}</div>
                    <div className="text-[11px] text-slate-500 truncate">{doc.specialty}</div>
                    <div className="text-[10px] font-mono text-blue-700 mt-0.5">{doc.nmcId}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-bold text-emerald-700 tabular-nums">
                      {Math.floor(doc.etaSec / 60)}m {String(doc.etaSec % 60).padStart(2, '0')}s
                    </div>
                    <div className="text-[10px] text-slate-500 tabular-nums">{doc.distanceM} m</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
