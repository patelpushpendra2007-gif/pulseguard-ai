// Real On-Device Volatile RAM Edge Audio DSP Engine
// 2.5s Float32Array Ring Buffer @ 16kHz | 25ms Hann Window (400 samples) | 10ms Hop (160 samples)
// Power Spectrum |STFT(x)|^2 -> 40-Band Triangular Mel Filterbank -> Log Energy -> 13-Coeff Type-II DCT MFCC
// Strictly zero audio persisted to disk, IndexedDB, or transmitted to cloud.

export const AUDIO_SAMPLE_RATE = 16000;
export const RING_DURATION_SECONDS = 2.5;
export const RING_BUFFER_SAMPLES = AUDIO_SAMPLE_RATE * RING_DURATION_SECONDS; // 40,000 Float32 samples
export const FRAME_SIZE_SAMPLES = 400; // 25ms
export const HOP_SIZE_SAMPLES = 160; // 10ms
export const FFT_SIZE = 512;
export const NUM_MEL_BANDS = 40;
export const NUM_MFCC_COEFFS = 13;

const HANN_WINDOW = new Float32Array(FRAME_SIZE_SAMPLES);
for (let i = 0; i < FRAME_SIZE_SAMPLES; i++) {
  HANN_WINDOW[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FRAME_SIZE_SAMPLES - 1)));
}

const hzToMel = (hz: number) => 2595 * Math.log10(1 + hz / 700);
const melToHz = (mel: number) => 700 * (Math.pow(10, mel / 2595) - 1);

const MEL_FILTERBANK: Float32Array[] = (() => {
  const numBins = FFT_SIZE / 2 + 1;
  const lowMel = hzToMel(80);
  const highMel = hzToMel(7600);
  const melPoints = new Float32Array(NUM_MEL_BANDS + 2);
  for (let i = 0; i < melPoints.length; i++) {
    melPoints[i] = lowMel + ((highMel - lowMel) * i) / (NUM_MEL_BANDS + 1);
  }
  const bins = Array.from(melPoints, (m) =>
    Math.min(numBins - 1, Math.max(0, Math.floor(((FFT_SIZE + 1) * melToHz(m)) / AUDIO_SAMPLE_RATE)))
  );

  const bank: Float32Array[] = [];
  for (let m = 1; m <= NUM_MEL_BANDS; m++) {
    const weights = new Float32Array(numBins);
    const left = bins[m - 1];
    const center = bins[m];
    const right = bins[m + 1];
    for (let k = left; k < center; k++) {
      weights[k] = (k - left) / Math.max(1, center - left);
    }
    for (let k = center; k <= right; k++) {
      weights[k] = (right - k) / Math.max(1, right - center);
    }
    bank.push(weights);
  }
  return bank;
})();

const DCT_MATRIX: Float32Array[] = (() => {
  const mat: Float32Array[] = [];
  const norm = Math.sqrt(2 / NUM_MEL_BANDS);
  for (let c = 0; c < NUM_MFCC_COEFFS; c++) {
    const row = new Float32Array(NUM_MEL_BANDS);
    const scale = c === 0 ? Math.sqrt(1 / NUM_MEL_BANDS) : norm;
    for (let m = 0; m < NUM_MEL_BANDS; m++) {
      row[m] = scale * Math.cos((Math.PI * c * (m + 0.5)) / NUM_MEL_BANDS);
    }
    mat.push(row);
  }
  return mat;
})();

export function fft512(real: Float32Array, imag: Float32Array): void {
  const n = FFT_SIZE;
  let j = 0;
  for (let i = 0; i < n; i++) {
    if (i < j) {
      const tr = real[i];
      real[i] = real[j];
      real[j] = tr;
      const ti = imag[i];
      imag[i] = imag[j];
      imag[j] = ti;
    }
    let m = n >> 1;
    while (m >= 1 && j >= m) {
      j -= m;
      m >>= 1;
    }
    j += m;
  }

  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const angle = k * step;
        const wr = Math.cos(angle);
        const wi = Math.sin(angle);
        const odd = start + k + half;
        const even = start + k;
        const tr = wr * real[odd] - wi * imag[odd];
        const ti = wr * imag[odd] + wi * real[odd];
        real[odd] = real[even] - tr;
        imag[odd] = imag[even] - ti;
        real[even] += tr;
        imag[even] += ti;
      }
    }
  }
}

export interface FrameDspFeatures {
  rms: number;
  dbfs: number;
  zcr: number;
  vadActive: boolean;
  powerSpectrum: Float32Array;
  logMel: Float32Array;
  mfcc: Float32Array;
}

export function computeVadMetrics(frameSamples: Float32Array): {
  rms: number;
  dbfs: number;
  zcr: number;
  vadActive: boolean;
} {
  let energySum = 0;
  let zcrCount = 0;
  let prev = 0;
  const len = Math.min(FRAME_SIZE_SAMPLES, frameSamples.length);

  for (let i = 0; i < len; i++) {
    const s = frameSamples[i] || 0;
    energySum += s * s;
    if (i > 0 && ((s >= 0 && prev < 0) || (s < 0 && prev >= 0))) {
      zcrCount++;
    }
    prev = s;
  }

  const rms = Math.sqrt(energySum / Math.max(1, len));
  const dbfs = 20 * Math.log10(Math.max(1e-6, rms));
  const zcr = zcrCount / Math.max(1, len);
  const vadActive = rms > 0.01 && zcr > 0.008 && zcr < 0.5;
  return { rms, dbfs, zcr, vadActive };
}

export function extractFrameFeatures(frameSamples: Float32Array): FrameDspFeatures {
  const { rms, dbfs, zcr, vadActive } = computeVadMetrics(frameSamples);
  const real = new Float32Array(FFT_SIZE);
  const imag = new Float32Array(FFT_SIZE);

  const len = Math.min(FRAME_SIZE_SAMPLES, frameSamples.length);
  for (let i = 0; i < len; i++) {
    real[i] = (frameSamples[i] || 0) * HANN_WINDOW[i];
  }

  fft512(real, imag);

  const numBins = FFT_SIZE / 2 + 1;
  const powerSpectrum = new Float32Array(numBins);
  for (let k = 0; k < numBins; k++) {
    powerSpectrum[k] = (real[k] * real[k] + imag[k] * imag[k]) / FRAME_SIZE_SAMPLES;
  }

  const logMel = new Float32Array(NUM_MEL_BANDS);
  for (let m = 0; m < NUM_MEL_BANDS; m++) {
    const weights = MEL_FILTERBANK[m];
    let bandEnergy = 1e-9;
    for (let k = 0; k < numBins; k++) {
      if (weights[k] > 0) {
        bandEnergy += powerSpectrum[k] * weights[k];
      }
    }
    logMel[m] = Math.log(bandEnergy);
  }

  const mfcc = new Float32Array(NUM_MFCC_COEFFS);
  for (let c = 0; c < NUM_MFCC_COEFFS; c++) {
    const row = DCT_MATRIX[c];
    let sum = 0;
    for (let m = 0; m < NUM_MEL_BANDS; m++) {
      sum += row[m] * logMel[m];
    }
    mfcc[c] = sum;
  }

  return { rms, dbfs, zcr, vadActive, powerSpectrum, logMel, mfcc };
}

export function downsampleTo16k(input: Float32Array, inputSampleRate: number): Float32Array {
  if (Math.abs(inputSampleRate - AUDIO_SAMPLE_RATE) < 1) return input;
  const ratio = inputSampleRate / AUDIO_SAMPLE_RATE;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const idx = i * ratio;
    const lo = Math.floor(idx);
    const hi = Math.min(input.length - 1, lo + 1);
    const frac = idx - lo;
    out[i] = input[lo] * (1 - frac) + input[hi] * frac;
  }
  return out;
}

export class VolatileAudioRingBuffer {
  private buffer = new Float32Array(RING_BUFFER_SAMPLES);
  private writePtr = 0;
  public totalOverwrites = 0;
  public totalHopsProcessed = 0;
  public activeVadFrames = 0;

  pushChunk(samples: Float32Array): void {
    for (let i = 0; i < samples.length; i++) {
      this.buffer[this.writePtr] = samples[i];
      this.writePtr = (this.writePtr + 1) % RING_BUFFER_SAMPLES;
    }
    this.totalOverwrites += samples.length;
    this.totalHopsProcessed++;
  }

  readRecentWindow(numSamples = FRAME_SIZE_SAMPLES): Float32Array {
    const count = Math.min(RING_BUFFER_SAMPLES, numSamples);
    const out = new Float32Array(count);
    const start = (this.writePtr - count + RING_BUFFER_SAMPLES) % RING_BUFFER_SAMPLES;
    for (let i = 0; i < count; i++) {
      out[i] = this.buffer[(start + i) % RING_BUFFER_SAMPLES];
    }
    return out;
  }

  wipeVolatileRam(): void {
    this.buffer.fill(0);
    this.writePtr = 0;
    this.totalOverwrites = 0;
    this.totalHopsProcessed = 0;
    this.activeVadFrames = 0;
  }
}

function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function cmvnNormalize(seq: Float32Array[]): Float32Array[] {
  if (seq.length === 0) return [];
  const dims = seq[0].length;
  const mean = new Float32Array(dims);
  const std = new Float32Array(dims);

  for (const frame of seq) {
    for (let d = 0; d < dims; d++) mean[d] += frame[d];
  }
  for (let d = 0; d < dims; d++) mean[d] /= seq.length;

  for (const frame of seq) {
    for (let d = 0; d < dims; d++) {
      const diff = frame[d] - mean[d];
      std[d] += diff * diff;
    }
  }
  for (let d = 0; d < dims; d++) std[d] = Math.max(1e-3, Math.sqrt(std[d] / seq.length));

  return seq.map((frame) => {
    const out = new Float32Array(dims);
    for (let d = 0; d < dims; d++) {
      out[d] = (frame[d] - mean[d]) / std[d];
    }
    return out;
  });
}

export function computeMfccDtwSimilarity(seqA: Float32Array[], seqB: Float32Array[]): number {
  if (seqA.length < 4 || seqB.length < 4) return 0;
  const maxLen = 40;
  const strideA = Math.max(1, Math.floor(seqA.length / maxLen));
  const strideB = Math.max(1, Math.floor(seqB.length / maxLen));
  const A = cmvnNormalize(seqA.filter((_, i) => i % strideA === 0).slice(0, maxLen));
  const B = cmvnNormalize(seqB.filter((_, i) => i % strideB === 0).slice(0, maxLen));

  const n = A.length;
  const m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Float32Array(m + 1).fill(Infinity));
  dp[0][0] = 0;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const dist = 1 - cosineSim(A[i - 1], B[j - 1]);
      dp[i][j] = dist + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  const avgCost = dp[n][m] / (n + m);
  const lenPenalty = Math.abs(seqA.length - seqB.length) / Math.max(seqA.length, seqB.length);
  return Math.max(0, Math.min(1, 1 - avgCost * 0.9 - lenPenalty * 0.3));
}

export function extractActiveMfccSequence(samples16k: Float32Array): Float32Array[] {
  const frames: Float32Array[] = [];
  for (let start = 0; start + FRAME_SIZE_SAMPLES <= samples16k.length; start += HOP_SIZE_SAMPLES) {
    const slice = samples16k.subarray(start, start + FRAME_SIZE_SAMPLES);
    const feat = extractFrameFeatures(slice);
    if (feat.vadActive) {
      frames.push(feat.mfcc.slice(1)); // c1..c12
    }
  }
  return frames;
}

export async function sha256PhraseHash(phrase: string): Promise<{ hashHex: string; wordCount: number }> {
  const normalized = phrase
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = normalized ? normalized.split(' ') : [];
  const data = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hashHex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return { hashHex, wordCount: Math.max(1, words.length) };
}

export async function transcriptMatchesSafewordHash(
  transcript: string,
  targetHashHex: string,
  expectedWordCount: number
): Promise<boolean> {
  if (!targetHashHex || !transcript.trim()) return false;
  const words = transcript
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  if (words.length === 0) return false;
  const win = Math.max(1, expectedWordCount);

  if (words.length < win) {
    const { hashHex } = await sha256PhraseHash(words.join(' '));
    return hashHex === targetHashHex;
  }

  for (let i = 0; i <= words.length - win; i++) {
    const slice = words.slice(i, i + win).join(' ');
    const { hashHex } = await sha256PhraseHash(slice);
    if (hashHex === targetHashHex) {
      return true;
    }
  }
  return false;
}
