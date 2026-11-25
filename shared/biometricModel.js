// Real Wearable PPG + HRV (RMSSD) + Gravity-Free Linear IMU Distress Fusion Model
// Implements Slide 6 equation verbatim:
// a_linear = | a_total - g | < 0.15g
// Panic = (ΔHR >= +35 BPM sustained >= 15s) AND (RMSSD drop > 40%) AND (a_linear < 0.15g)

export const GRAVITY_MS2 = 9.80665;
export const DELTA_HR_THRESHOLD_BPM = 35;
export const SUSTAINED_PANIC_SECONDS = 15;
export const RMSSD_DROP_THRESHOLD_PCT = 40;
export const LINEAR_IMU_MAX_G = 0.15;

export function computeLinearImuG(axMs2, ayMs2, azMs2) {
  const totalMs2 = Math.sqrt(axMs2 * axMs2 + ayMs2 * ayMs2 + azMs2 * azMs2);
  const linearG = Math.abs(totalMs2 - GRAVITY_MS2) / GRAVITY_MS2;
  return Number(linearG.toFixed(3));
}

/**
 * Root Mean Square of Successive Differences (RMSSD) of beat-to-beat RR intervals (ms).
 */
export function computeRmssdMs(rrIntervalsMs) {
  if (!rrIntervalsMs || rrIntervalsMs.length < 2) return 0;
  let sumSqDiff = 0;
  for (let i = 1; i < rrIntervalsMs.length; i++) {
    const diff = rrIntervalsMs[i] - rrIntervalsMs[i - 1];
    sumSqDiff += diff * diff;
  }
  return Number(Math.sqrt(sumSqDiff / (rrIntervalsMs.length - 1)).toFixed(1));
}

/**
 * Synthesizes realistic beat-to-beat RR intervals (ms) for a target BPM & vagal HRV state.
 */
export function synthesizeRrIntervals(bpm, targetRmssdMs, count = 16, phase = 0) {
  const meanRr = 60000 / Math.max(40, Math.min(210, bpm));
  const amp = targetRmssdMs * 0.72;
  const intervals = [];
  for (let i = 0; i < count; i++) {
    // Alternating respiratory sinus arrhythmia + slight sympathetic jitter
    const osc = Math.sin((i + phase) * 1.45) * amp + Math.cos((i + phase) * 2.7) * (amp * 0.25);
    intervals.push(Number(Math.max(260, meanRr + osc).toFixed(1)));
  }
  return intervals;
}

export class BiometricDistressEngine {
  constructor() {
    this.baselineHr = 74;
    this.baselineRmssd = 46;
    this.sustainedBreachSeconds = 0;
    this.lastEvalTs = null;
  }

  reset(baselineHr = 74, baselineRmssd = 46) {
    this.baselineHr = baselineHr;
    this.baselineRmssd = baselineRmssd;
    this.sustainedBreachSeconds = 0;
    this.lastEvalTs = null;
  }

  evaluateSample({
    hrBpm,
    spo2Pct = 98,
    rrIntervalsMs,
    axMs2 = 0.2,
    ayMs2 = 0.1,
    azMs2 = 9.81,
    linearImuGOverride = null,
    deltaSeconds = 1
  }) {
    const linearImuG =
      linearImuGOverride !== null
        ? Number(linearImuGOverride.toFixed(3))
        : computeLinearImuG(axMs2, ayMs2, azMs2);

    const rmssdMs = rrIntervalsMs ? computeRmssdMs(rrIntervalsMs) : 42;
    const deltaHr = Number((hrBpm - this.baselineHr).toFixed(1));
    const rmssdDropPct = Number(
      Math.max(0, ((this.baselineRmssd - rmssdMs) / Math.max(1, this.baselineRmssd)) * 100).toFixed(1)
    );

    const hrPredicate = deltaHr >= DELTA_HR_THRESHOLD_BPM;
    const hrvPredicate = rmssdDropPct > RMSSD_DROP_THRESHOLD_PCT;
    const stillPredicate = linearImuG < LINEAR_IMU_MAX_G;

    // Sustained 15-second guard
    if (hrPredicate && hrvPredicate && stillPredicate) {
      this.sustainedBreachSeconds = Math.min(30, this.sustainedBreachSeconds + deltaSeconds);
    } else if (!stillPredicate) {
      // Motion cleanly resets distress timer (gym / running / walking rejection)
      this.sustainedBreachSeconds = 0;
    } else {
      this.sustainedBreachSeconds = Math.max(0, this.sustainedBreachSeconds - deltaSeconds * 2);
    }

    const sustained15s = this.sustainedBreachSeconds >= SUSTAINED_PANIC_SECONDS;
    const panicTriggered = hrPredicate && hrvPredicate && stillPredicate && sustained15s;

    let classification = 'NORMAL_BASELINE';
    if (hrPredicate && !stillPredicate) {
      classification = 'EXERTION_FILTERED';
    } else if (panicTriggered) {
      classification = 'DISTRESS_CONFIRMED';
    } else if (hrPredicate && hrvPredicate && stillPredicate) {
      classification = 'SUSTAINED_WINDOW_ACCUMULATING';
    } else if (hrPredicate || hrvPredicate) {
      classification = 'ELEVATED_MONITORING';
    }

    return {
      classification,
      panicTriggered,
      hrBpm: Math.round(hrBpm),
      baselineHr: this.baselineHr,
      deltaHr,
      spo2Pct,
      rmssdMs,
      baselineRmssd: this.baselineRmssd,
      rmssdDropPct,
      linearImuG,
      sustainedSeconds: Number(this.sustainedBreachSeconds.toFixed(1)),
      requiredSeconds: SUSTAINED_PANIC_SECONDS,
      predicates: {
        deltaHrGte35: hrPredicate,
        rmssdDropGt40: hrvPredicate,
        linearImuLt015g: stillPredicate,
        sustained15s
      }
    };
  }
}

/**
 * Generates an accurate single-beat PPG + arterial dicrotic notch waveform value [0..1] at phase t in [0..1].
 */
export function ppgPulseSample(phase) {
  const p = ((phase % 1) + 1) % 1;
  // Systolic peak around 0.22 + dicrotic notch dip at 0.42 + diastolic wave at 0.54
  const systolic = Math.exp(-Math.pow((p - 0.22) / 0.075, 2));
  const diastolic = 0.42 * Math.exp(-Math.pow((p - 0.52) / 0.11, 2));
  const baseline = 0.08 * Math.sin(2 * Math.PI * p);
  return Math.max(0, Math.min(1, 0.12 + 0.78 * systolic + diastolic + baseline * 0.15));
}
