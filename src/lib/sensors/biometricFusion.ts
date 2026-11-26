// Real Multi-Sensor Biometric & Automotive Crash Physics Fusion Engine
// Zero simulated biometrics, zero synthetic RR intervals, zero preset overrides.

export const GRAVITY_MS2 = 9.80665;
export const PANIC_DELTA_HR_BPM = 35;
export const PANIC_SUSTAINED_SECONDS = 15;
export const PANIC_RMSSD_DROP_PCT = 40;
export const PANIC_LINEAR_IMU_MAX_G = 0.15;

export const CRASH_G_PEAK_THRESHOLD = 10.0;
export const CRASH_CAN_DELTA_V_KMH = 25.0;
export const ROLLOVER_TILT_DEG = 60.0;
export const ROLLOVER_OMEGA_DEGS = 90.0;

export interface BleHeartRateReading {
  hrBpm: number;
  rrIntervalsMs: number[];
  sensorContactDetected: boolean | null;
  energyExpendedKj: number | null;
  timestampMs: number;
}

/**
 * Parses standard Bluetooth GATT Heart Rate Measurement characteristic (UUID 0x2A37)
 * per Bluetooth SIG GATT specification.
 */
export function parseBleHeartRateMeasurement(value: DataView): BleHeartRateReading {
  const flags = value.getUint8(0);
  const is16BitHr = (flags & 0x01) !== 0;
  const contactSupported = (flags & 0x04) !== 0;
  const contactDetected = contactSupported ? (flags & 0x02) !== 0 : null;
  const hasEnergyExpended = (flags & 0x08) !== 0;
  const hasRrIntervals = (flags & 0x10) !== 0;

  let offset = 1;
  let hrBpm: number;
  if (is16BitHr) {
    hrBpm = value.getUint16(offset, true);
    offset += 2;
  } else {
    hrBpm = value.getUint8(offset);
    offset += 1;
  }

  let energyExpendedKj: number | null = null;
  if (hasEnergyExpended && offset + 2 <= value.byteLength) {
    energyExpendedKj = value.getUint16(offset, true);
    offset += 2;
  }

  const rrIntervalsMs: number[] = [];
  if (hasRrIntervals) {
    while (offset + 2 <= value.byteLength) {
      const rawRr = value.getUint16(offset, true);
      // Bluetooth SIG encodes RR-Interval in units of 1/1024 seconds
      const rrMs = Number(((rawRr / 1024) * 1000).toFixed(1));
      if (rrMs >= 250 && rrMs <= 2200) {
        rrIntervalsMs.push(rrMs);
      }
      offset += 2;
    }
  }

  return {
    hrBpm,
    rrIntervalsMs,
    sensorContactDetected: contactDetected,
    energyExpendedKj,
    timestampMs: Date.now(),
  };
}

export interface ObdBleTelemetry {
  speedKmh: number;
  deltaVKmh: number;
  imuGPeak: number | null;
  dtcCode: string | null;
  timestampMs: number;
  rawFrame: string;
}

/**
 * Parses real incoming ESP32-S3 OBD-II Lite/Pro BLE UART JSON or CSV packets.
 * Example JSON: {"spd":42,"dv":31.5,"g":11.8,"dtc":"B1001"}
 */
export function parseObdBlePacket(rawText: string, previousSpeedKmh: number | null): ObdBleTelemetry | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const spd = Number(parsed.spd ?? parsed.speed_kmh ?? parsed.speed ?? 0);
    const explicitDv = parsed.dv !== undefined || parsed.can_delta_v !== undefined
      ? Number(parsed.dv ?? parsed.can_delta_v)
      : null;
    const deltaVKmh =
      explicitDv !== null && Number.isFinite(explicitDv)
        ? Math.max(0, explicitDv)
        : previousSpeedKmh !== null
          ? Math.max(0, previousSpeedKmh - spd)
          : 0;
    const imuGPeak =
      parsed.g !== undefined || parsed.g_peak !== undefined
        ? Number(parsed.g ?? parsed.g_peak)
        : null;
    const dtcCode = typeof parsed.dtc === 'string' ? parsed.dtc : null;

    if (!Number.isFinite(spd)) return null;

    return {
      speedKmh: spd,
      deltaVKmh: Number(deltaVKmh.toFixed(1)),
      imuGPeak: imuGPeak !== null && Number.isFinite(imuGPeak) ? Number(imuGPeak.toFixed(2)) : null,
      dtcCode,
      timestampMs: Date.now(),
      rawFrame: trimmed,
    };
  } catch {
    return null;
  }
}

export function computeRmssdMs(rrIntervalsMs: number[]): number {
  if (rrIntervalsMs.length < 2) return 0;
  let sumSqDiff = 0;
  for (let i = 1; i < rrIntervalsMs.length; i++) {
    const diff = rrIntervalsMs[i] - rrIntervalsMs[i - 1];
    sumSqDiff += diff * diff;
  }
  return Number(Math.sqrt(sumSqDiff / (rrIntervalsMs.length - 1)).toFixed(1));
}

export interface PpgSamplePoint {
  tMs: number;
  value: number;
}

export interface OpticalPpgResult {
  hrBpm: number | null;
  rmssdMs: number | null;
  rrIntervalsMs: number[];
  signalQuality: 'CALIBRATING' | 'GOOD' | 'LOW_CONTACT';
  filteredWaveform: number[];
}

/**
 * Real Camera Optical PPG Signal Processor.
 * Extracts arterial pulse peaks from live rear-camera red-channel intensity values.
 */
export class OpticalPpgProcessor {
  private samples: PpgSamplePoint[] = [];
  private readonly maxWindowMs = 10000;

  reset(): void {
    this.samples = [];
  }

  pushIntensitySample(redMean: number, greenMean: number, blueMean: number, tMs = Date.now()): OpticalPpgResult {
    // Hemoglobin absorption differential highlights arterial pulsatility while rejecting ambient flicker
    const intensity = redMean - 0.3 * greenMean - 0.1 * blueMean;
    this.samples.push({ tMs, value: intensity });

    const cutoff = tMs - this.maxWindowMs;
    while (this.samples.length > 0 && this.samples[0].tMs < cutoff) {
      this.samples.shift();
    }

    const fingerPresent = redMean > 95 && redMean > greenMean * 1.35;
    if (!fingerPresent) {
      return {
        hrBpm: null,
        rmssdMs: null,
        rrIntervalsMs: [],
        signalQuality: 'LOW_CONTACT',
        filteredWaveform: [],
      };
    }

    if (this.samples.length < 45) {
      return {
        hrBpm: null,
        rmssdMs: null,
        rrIntervalsMs: [],
        signalQuality: 'CALIBRATING',
        filteredWaveform: this.samples.slice(-60).map((s) => s.value),
      };
    }

    // Moving-average DC baseline subtraction (~0.5s window)
    const vals = this.samples.map((s) => s.value);
    const maHalf = 8;
    const detrended: number[] = [];
    for (let i = 0; i < vals.length; i++) {
      let sum = 0;
      let count = 0;
      for (let j = Math.max(0, i - maHalf); j <= Math.min(vals.length - 1, i + maHalf); j++) {
        sum += vals[j];
        count++;
      }
      detrended.push(vals[i] - sum / count);
    }

    // Adaptive standard deviation threshold for systolic peaks
    const variance =
      detrended.reduce((acc, v) => acc + v * v, 0) / Math.max(1, detrended.length);
    const std = Math.sqrt(variance);
    const minProminence = Math.max(0.15, std * 0.45);

    const peakTimestamps: number[] = [];
    let lastPeakTs = -Infinity;
    for (let i = 1; i < detrended.length - 1; i++) {
      const cur = detrended[i];
      if (
        cur > detrended[i - 1] &&
        cur >= detrended[i + 1] &&
        cur > minProminence &&
        this.samples[i].tMs - lastPeakTs >= 320 // max ~187 BPM physiological cap
      ) {
        lastPeakTs = this.samples[i].tMs;
        peakTimestamps.push(lastPeakTs);
      }
    }

    const rrIntervalsMs: number[] = [];
    for (let i = 1; i < peakTimestamps.length; i++) {
      const rr = peakTimestamps[i] - peakTimestamps[i - 1];
      if (rr >= 320 && rr <= 1600) {
        rrIntervalsMs.push(Number(rr.toFixed(1)));
      }
    }

    if (rrIntervalsMs.length < 3) {
      return {
        hrBpm: null,
        rmssdMs: null,
        rrIntervalsMs,
        signalQuality: 'CALIBRATING',
        filteredWaveform: detrended.slice(-90),
      };
    }

    const meanRr = rrIntervalsMs.reduce((a, b) => a + b, 0) / rrIntervalsMs.length;
    const hrBpm = Math.round(60000 / meanRr);
    const rmssdMs = computeRmssdMs(rrIntervalsMs);

    return {
      hrBpm,
      rmssdMs,
      rrIntervalsMs,
      signalQuality: 'GOOD',
      filteredWaveform: detrended.slice(-90),
    };
  }
}

export interface ImuState {
  axMs2: number;
  ayMs2: number;
  azMs2: number;
  linearImuG: number;
  gPeak: number;
  tiltDeg: number;
  omegaDegSec: number;
  hasHardwareData: boolean;
  lastSampleAt: number | null;
}

export interface BiometricFusionAssessment {
  classification:
    | 'STANDBY'
    | 'NORMAL_BASELINE'
    | 'EXERTION_FILTERED'
    | 'ELEVATED_MONITORING'
    | 'SUSTAINED_WINDOW_ACCUMULATING'
    | 'PANIC_DISTRESS_TRIGGERED';
  panicTriggered: boolean;
  deltaHrBpm: number;
  rmssdDropPct: number;
  linearImuG: number;
  sustainedSeconds: number;
  predicates: {
    deltaHrGte35: boolean;
    rmssdDropGt40: boolean;
    linearImuLt015g: boolean;
    sustained15s: boolean;
  };
}

export interface CrashAssessment {
  crashTriggered: boolean;
  triggerType: 'AUTOMOTIVE_CRASH_OBD' | 'AUTOMOTIVE_ROLLOVER_IMU' | null;
  gPeak: number;
  canDeltaVKmh: number;
  tiltDeg: number;
  omegaDegSec: number;
  predicates: {
    gPeakGt10G: boolean;
    canDeltaVGte25: boolean;
    rolloverTiltGt60: boolean;
    rolloverOmegaGt90: boolean;
  };
}

export class BiometricDistressTracker {
  private sustainedStartMs: number | null = null;

  reset(): void {
    this.sustainedStartMs = null;
  }

  evaluate(params: {
    hrBpm: number | null;
    rmssdMs: number | null;
    baselineHrBpm: number;
    baselineRmssdMs: number;
    linearImuG: number;
    nowMs?: number;
  }): BiometricFusionAssessment {
    const nowMs = params.nowMs ?? Date.now();

    if (params.hrBpm === null || params.rmssdMs === null) {
      this.sustainedStartMs = null;
      return {
        classification: 'STANDBY',
        panicTriggered: false,
        deltaHrBpm: 0,
        rmssdDropPct: 0,
        linearImuG: params.linearImuG,
        sustainedSeconds: 0,
        predicates: {
          deltaHrGte35: false,
          rmssdDropGt40: false,
          linearImuLt015g: params.linearImuG < PANIC_LINEAR_IMU_MAX_G,
          sustained15s: false,
        },
      };
    }

    const deltaHrBpm = Number((params.hrBpm - params.baselineHrBpm).toFixed(1));
    const rmssdDropPct = Number(
      Math.max(
        0,
        ((params.baselineRmssdMs - params.rmssdMs) / Math.max(1, params.baselineRmssdMs)) * 100
      ).toFixed(1)
    );

    const deltaHrGte35 = deltaHrBpm >= PANIC_DELTA_HR_BPM;
    const rmssdDropGt40 = rmssdDropPct > PANIC_RMSSD_DROP_PCT;
    const linearImuLt015g = params.linearImuG < PANIC_LINEAR_IMU_MAX_G;

    if (deltaHrGte35 && rmssdDropGt40 && linearImuLt015g) {
      if (this.sustainedStartMs === null) {
        this.sustainedStartMs = nowMs;
      }
    } else {
      this.sustainedStartMs = null;
    }

    const sustainedSeconds =
      this.sustainedStartMs === null ? 0 : Number(((nowMs - this.sustainedStartMs) / 1000).toFixed(1));
    const sustained15s = sustainedSeconds >= PANIC_SUSTAINED_SECONDS;
    const panicTriggered = deltaHrGte35 && rmssdDropGt40 && linearImuLt015g && sustained15s;

    let classification: BiometricFusionAssessment['classification'] = 'NORMAL_BASELINE';
    if (deltaHrGte35 && !linearImuLt015g) {
      classification = 'EXERTION_FILTERED';
    } else if (panicTriggered) {
      classification = 'PANIC_DISTRESS_TRIGGERED';
    } else if (deltaHrGte35 && rmssdDropGt40 && linearImuLt015g) {
      classification = 'SUSTAINED_WINDOW_ACCUMULATING';
    } else if (deltaHrGte35 || rmssdDropGt40) {
      classification = 'ELEVATED_MONITORING';
    }

    return {
      classification,
      panicTriggered,
      deltaHrBpm,
      rmssdDropPct,
      linearImuG: params.linearImuG,
      sustainedSeconds,
      predicates: {
        deltaHrGte35,
        rmssdDropGt40,
        linearImuLt015g,
        sustained15s,
      },
    };
  }
}

export function evaluateCrashPhysics(params: {
  gPeak: number;
  canDeltaVKmh: number;
  tiltDeg: number;
  omegaDegSec: number;
}): CrashAssessment {
  const gPeakGt10G = params.gPeak > CRASH_G_PEAK_THRESHOLD;
  const canDeltaVGte25 = params.canDeltaVKmh >= CRASH_CAN_DELTA_V_KMH;
  const rolloverTiltGt60 = params.tiltDeg > ROLLOVER_TILT_DEG;
  const rolloverOmegaGt90 = params.omegaDegSec > ROLLOVER_OMEGA_DEGS;

  const linearCrash = gPeakGt10G && canDeltaVGte25;
  const rolloverCrash = rolloverTiltGt60 || rolloverOmegaGt90;

  let triggerType: CrashAssessment['triggerType'] = null;
  if (linearCrash) {
    triggerType = 'AUTOMOTIVE_CRASH_OBD';
  } else if (rolloverCrash) {
    triggerType = 'AUTOMOTIVE_ROLLOVER_IMU';
  }

  return {
    crashTriggered: linearCrash || rolloverCrash,
    triggerType,
    gPeak: Number(params.gPeak.toFixed(2)),
    canDeltaVKmh: Number(params.canDeltaVKmh.toFixed(1)),
    tiltDeg: Number(params.tiltDeg.toFixed(1)),
    omegaDegSec: Number(params.omegaDegSec.toFixed(1)),
    predicates: {
      gPeakGt10G,
      canDeltaVGte25,
      rolloverTiltGt60,
      rolloverOmegaGt90,
    },
  };
}
