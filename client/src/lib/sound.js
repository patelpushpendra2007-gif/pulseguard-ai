// Clean Web Audio Synthesizer for 110 BPM CPR Metronome, Tactile Countdown & Verification Tones

class ClinicalAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  ensureCtx() {
    if (!this.enabled || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) this.ctx = new Ctx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  tone(freq, duration = 0.08, type = 'sine', gainVal = 0.07) {
    try {
      const ctx = this.ensureCtx();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(gainVal, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch {
      // Ignore browser autoplay gating silently
    }
  }

  cprBeat() {
    this.tone(920, 0.045, 'triangle', 0.09);
  }

  countdownTick() {
    this.tone(660, 0.06, 'sine', 0.06);
  }

  alertChime() {
    this.tone(784, 0.11, 'sine', 0.1);
    setTimeout(() => this.tone(1046.5, 0.16, 'sine', 0.11), 115);
  }

  successChime() {
    this.tone(523.25, 0.08, 'sine', 0.08);
    setTimeout(() => this.tone(659.25, 0.12, 'sine', 0.09), 85);
  }
}

export const clinicalAudio = new ClinicalAudio();
