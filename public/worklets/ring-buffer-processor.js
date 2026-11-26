// Real AudioWorkletProcessor for Volatile RAM Audio Ingestion
// Downsamples browser AudioContext stream (e.g. 48kHz / 44.1kHz) to 16kHz in-memory
// and emits 160-sample (10ms) frames directly to the main-thread 2.5s Float32Array ring buffer.

class RingBufferCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 16000;
    this.hopSamples = 160;
    this.accum = new Float32Array(this.hopSamples);
    this.accumIdx = 0;
    this.phase = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) {
      return true;
    }

    const channel = input[0];
    const ratio = sampleRate / this.targetRate;

    if (Math.abs(ratio - 1) < 0.001) {
      for (let i = 0; i < channel.length; i++) {
        this.accum[this.accumIdx++] = channel[i];
        if (this.accumIdx >= this.hopSamples) {
          const out = new Float32Array(this.accum);
          this.port.postMessage(out, [out.buffer]);
          this.accumIdx = 0;
        }
      }
      return true;
    }

    while (this.phase < channel.length) {
      const lo = Math.floor(this.phase);
      const hi = Math.min(channel.length - 1, lo + 1);
      const frac = this.phase - lo;
      const sample = channel[lo] * (1 - frac) + channel[hi] * frac;
      this.accum[this.accumIdx++] = sample;

      if (this.accumIdx >= this.hopSamples) {
        const out = new Float32Array(this.accum);
        this.port.postMessage(out, [out.buffer]);
        this.accumIdx = 0;
      }

      this.phase += ratio;
    }

    this.phase -= channel.length;
    return true;
  }
}

registerProcessor('ring-buffer-capture-processor', RingBufferCaptureProcessor);
