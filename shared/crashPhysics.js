// Real Automotive Collision Physics Model (LSM6DSO IMU + OBD-II CAN-Bus SN65HVD230)
// Implements Slide 6 equation verbatim:
// G_peak = sqrt(Gx² + Gy² + Gz²) > 10G (>= 20ms)
// Crash = (G_peak > 10G AND CAN Δv >= 25 km/h in <150ms) OR (Rollover θ > 60° OR ω > 90°/s)

export const CRASH_G_THRESHOLD = 10.0;
export const CRASH_DURATION_MIN_MS = 20;
export const CAN_DELTA_V_THRESHOLD_KMH = 25;
export const CAN_WINDOW_MAX_MS = 150;
export const ROLLOVER_ANGLE_DEG = 60;
export const ROLLOVER_OMEGA_DEGS = 90;

export function evaluateCrashTelemetry({
  gx = 0.1,
  gy = 0.1,
  gz = 1.0,
  impactDurationMs = 0,
  speedBeforeKmh = 60,
  speedAfterKmh = 60,
  canWindowMs = 100,
  rollDeg = 0,
  pitchDeg = 0,
  omegaDegSec = 0,
  airbagDtc = 'NONE'
}) {
  const gPeak = Number(Math.sqrt(gx * gx + gy * gy + gz * gz).toFixed(2));
  const canDeltaV = Number(Math.max(0, speedBeforeKmh - speedAfterKmh).toFixed(1));
  const maxTiltDeg = Number(Math.max(Math.abs(rollDeg), Math.abs(pitchDeg)).toFixed(1));

  const gForceExceeded = gPeak > CRASH_G_THRESHOLD && impactDurationMs >= CRASH_DURATION_MIN_MS;
  const canDropConfirmed = canDeltaV >= CAN_DELTA_V_THRESHOLD_KMH && canWindowMs < CAN_WINDOW_MAX_MS;
  const linearCollisionConfirmed = gForceExceeded && canDropConfirmed;

  const rolloverConfirmed = maxTiltDeg > ROLLOVER_ANGLE_DEG || Math.abs(omegaDegSec) > ROLLOVER_OMEGA_DEGS;
  const crashTriggered = linearCollisionConfirmed || rolloverConfirmed;

  let verdict = 'NORMAL_DRIVING';
  let explanation = 'Telemetry within normal operating envelope.';

  if (crashTriggered) {
    if (linearCollisionConfirmed && rolloverConfirmed) {
      verdict = 'SEVERE_MULTI_VECTOR_CRASH';
      explanation = `Dual-factor impact (${gPeak}G for ${impactDurationMs}ms + Δv ${canDeltaV} km/h) AND vehicle rollover (${maxTiltDeg}°, ${omegaDegSec}°/s) confirmed.`;
    } else if (linearCollisionConfirmed) {
      verdict = 'COLLISION_CONFIRMED_NON_ROLLOVER';
      explanation = `Head-on/T-Bone collision confirmed without rollover: ${gPeak}G (≥20ms) paired with CAN Δv ${canDeltaV} km/h in ${canWindowMs}ms.`;
    } else {
      verdict = 'ROLLOVER_CONFIRMED';
      explanation = `Vehicle rollover detected via LSM6DSO tilt/gyro (${maxTiltDeg}° tilt, ${omegaDegSec}°/s angular rate).`;
    }
  } else if (gPeak > CRASH_G_THRESHOLD && (!canDropConfirmed || impactDurationMs < CRASH_DURATION_MIN_MS)) {
    verdict = 'POTHOLE_BUMP_REJECTED';
    explanation = `High G-spike (${gPeak}G) rejected: ${impactDurationMs < CRASH_DURATION_MIN_MS ? `impulse duration ${impactDurationMs}ms < 20ms` : `CAN speed drop Δv ${canDeltaV} km/h < 25 km/h`}.`;
  }

  const canFrames = encodeCanFrames({ speedAfterKmh, airbagDtc, crashTriggered });

  return {
    crashTriggered,
    verdict,
    explanation,
    metrics: {
      gPeak,
      impactDurationMs,
      canDeltaV,
      canWindowMs,
      maxTiltDeg,
      omegaDegSec,
      airbagDtc
    },
    predicates: {
      gForceGt10For20ms: gForceExceeded,
      canDeltaVGte25In150ms: canDropConfirmed,
      linearCollisionBranch: linearCollisionConfirmed,
      rolloverBranch: rolloverConfirmed
    },
    canFrames
  };
}

/**
 * Generates authentic OBD-II Mode 01 CAN 2.0B hex frames (ID 0x7E8 ECU response).
 */
export function encodeCanFrames({ speedAfterKmh = 0, airbagDtc = 'NONE', crashTriggered = false }) {
  const speedHex = Math.max(0, Math.min(255, Math.round(speedAfterKmh))).toString(16).toUpperCase().padStart(2, '0');
  const rpm = crashTriggered ? 0 : Math.max(750, Math.round(speedAfterKmh * 38));
  const rpmScaled = rpm * 4;
  const rpmA = ((rpmScaled >> 8) & 0xff).toString(16).toUpperCase().padStart(2, '0');
  const rpmB = (rpmScaled & 0xff).toString(16).toUpperCase().padStart(2, '0');

  const frames = [
    { arbId: '0x7E8', bus: 'SN65HVD230-CAN', raw: `03 41 0D ${speedHex} 00 00 00 00`, decoded: `PID 0x0D Vehicle Speed = ${Math.round(speedAfterKmh)} km/h` },
    { arbId: '0x7E8', bus: 'SN65HVD230-CAN', raw: `04 41 0C ${rpmA} ${rpmB} 00 00 00`, decoded: `PID 0x0C Engine RPM = ${rpm} RPM` }
  ];

  if (crashTriggered || (airbagDtc && airbagDtc !== 'NONE')) {
    frames.push({
      arbId: '0x7EA',
      bus: 'SRS-AIRBAG-DTC',
      raw: '04 43 01 B1 01 00 00 00',
      decoded: `DTC ${airbagDtc !== 'NONE' ? airbagDtc : 'B1001'} Restraint / Crash Event Flagged`
    });
  }
  return frames;
}

export const CRASH_PRESETS = {
  normal: {
    label: 'Normal City Cruise',
    gx: 0.12, gy: 0.08, gz: 1.0, impactDurationMs: 0,
    speedBeforeKmh: 48, speedAfterKmh: 46, canWindowMs: 120,
    rollDeg: 1.5, pitchDeg: 0.5, omegaDegSec: 4, airbagDtc: 'NONE'
  },
  pothole: {
    label: 'Deep Pothole / Speed Bump (Filter Test)',
    gx: 0.8, gy: 1.1, gz: 11.4, impactDurationMs: 14,
    speedBeforeKmh: 42, speedAfterKmh: 36, canWindowMs: 120,
    rollDeg: 4.5, pitchDeg: 6.2, omegaDegSec: 22, airbagDtc: 'NONE'
  },
  headon: {
    label: 'Head-On / T-Bone Collision (Non-Rollover)',
    gx: 13.8, gy: 3.4, gz: 1.2, impactDurationMs: 42,
    speedBeforeKmh: 64, speedAfterKmh: 11, canWindowMs: 105,
    rollDeg: 7.0, pitchDeg: 9.5, omegaDegSec: 34, airbagDtc: 'B1001-SRS'
  },
  rollover: {
    label: 'Highway Embankment Rollover',
    gx: 5.2, gy: 7.4, gz: 4.1, impactDurationMs: 65,
    speedBeforeKmh: 82, speedAfterKmh: 18, canWindowMs: 140,
    rollDeg: 76.0, pitchDeg: 18.0, omegaDegSec: 124, airbagDtc: 'B1004-ROLL'
  }
};
