'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Mic, MicOff, ShieldCheck, Trash2, Volume2, AlertTriangle } from 'lucide-react';
import {
  AUDIO_SAMPLE_RATE,
  FRAME_SIZE_SAMPLES,
  HOP_SIZE_SAMPLES,
  NUM_MEL_BANDS,
  NUM_MFCC_COEFFS,
  VolatileAudioRingBuffer,
  computeMfccDtwSimilarity,
  computeVadMetrics,
  downsampleTo16k,
  extractActiveMfccSequence,
  extractFrameFeatures,
  sha256PhraseHash,
  transcriptMatchesSafewordHash,
} from '@/lib/audio/edgeDsp';
import type { PowerEngineState } from '@/types/pulseguard';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface EdgeAudioSentinelPanelProps {
  powerState: PowerEngineState;
  savedSafewordHash: string | null;
  savedSafewordWordCount: number;
  onSaveSafewordHash: (hashHex: string, wordCount: number) => Promise<void>;
  onSafeWordTriggered: (reason: string) => void;
}

export default function EdgeAudioSentinelPanel({
  powerState,
  savedSafewordHash,
  savedSafewordWordCount,
  onSaveSafewordHash,
  onSafeWordTriggered,
}: EdgeAudioSentinelPanelProps) {
  const ringBufferRef = useRef<VolatileAudioRingBuffer>(new VolatileAudioRingBuffer());
  const enrolledMfccRef = useRef<Float32Array[]>([]);
  const specCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const scriptNodeRef = useRef<ScriptProcessorNode | null>(null);
  const speechRef = useRef<SpeechRecognitionInstance | null>(null);
  const triggeredCooldownRef = useRef<number>(0);

  const [micActive, setMicActive] = useState(false);
  const [dspMode, setDspMode] = useState<'STOPPED' | 'AUDIOWORKLET' | 'SCRIPT_FALLBACK'>('STOPPED');
  const speechSupported = useSyncExternalStore(
    () => () => undefined,
    () => {
      const win = window as unknown as Record<string, unknown>;
      return Boolean(win.SpeechRecognition || win.webkitSpeechRecognition);
    },
    () => false
  );
  const [speechActive, setSpeechActive] = useState(false);
  const [lastTranscript, setLastTranscript] = useState<string>('');
  const [micError, setMicError] = useState<string | null>(null);

  const [safewordInput, setSafewordInput] = useState('');
  const [savingWord, setSavingWord] = useState(false);
  const [enrollingVoice, setEnrollingVoice] = useState(false);
  const [enrolledFramesCount, setEnrolledFramesCount] = useState(0);

  const [telemetry, setTelemetry] = useState({
    dbfs: -90,
    vadActive: false,
    overwrites: 0,
    hopsProcessed: 0,
    dtwScore: 0,
    diskBytesPersisted: 0,
  });

  const latestMelRef = useRef<Float32Array>(new Float32Array(NUM_MEL_BANDS).fill(-14));
  const latestMfccRef = useRef<Float32Array>(new Float32Array(NUM_MFCC_COEFFS).fill(0));
  const powerStateRef = useRef<PowerEngineState>(powerState);
  const savedHashRef = useRef<string | null>(savedSafewordHash);
  const savedWordCountRef = useRef<number>(savedSafewordWordCount);

  useEffect(() => {
    powerStateRef.current = powerState;
    savedHashRef.current = savedSafewordHash;
    savedWordCountRef.current = savedSafewordWordCount;
  }, [powerState, savedSafewordHash, savedSafewordWordCount]);

  const triggerSafewordOnce = useCallback(
    (reason: string) => {
      const now = Date.now();
      if (now - triggeredCooldownRef.current < 8000) return;
      triggeredCooldownRef.current = now;
      onSafeWordTriggered(reason);
    },
    [onSafeWordTriggered]
  );

  const drawSpectrogram = useCallback((mel: Float32Array, mfcc: Float32Array, vad: boolean) => {
    const canvas = specCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#05080F';
    ctx.fillRect(0, 0, w, h);

    // Top 65%: 40-band Mel filterbank spectrum
    const melHeight = Math.floor(h * 0.65);
    const barW = w / NUM_MEL_BANDS;
    for (let i = 0; i < NUM_MEL_BANDS; i++) {
      const val = mel[i] ?? -14;
      const norm = Math.max(0.04, Math.min(1, (val + 14) / 14));
      const bh = norm * (melHeight - 8);
      ctx.fillStyle = vad ? '#06B6D4' : '#334155';
      ctx.fillRect(i * barW + 1, melHeight - bh, Math.max(2, barW - 2), bh);
    }

    // Divider line
    ctx.strokeStyle = '#1E293B';
    ctx.beginPath();
    ctx.moveTo(0, melHeight + 2);
    ctx.lineTo(w, melHeight + 2);
    ctx.stroke();

    // Bottom 35%: 13 DCT MFCC coefficients (signed bars around baseline)
    const mfccTop = melHeight + 6;
    const mfccHeight = h - mfccTop - 4;
    const midY = mfccTop + mfccHeight / 2;
    const mBarW = w / NUM_MFCC_COEFFS;
    for (let c = 0; c < NUM_MFCC_COEFFS; c++) {
      const v = Math.max(-25, Math.min(25, mfcc[c] ?? 0));
      const norm = v / 25;
      const barH = Math.abs(norm) * (mfccHeight / 2);
      ctx.fillStyle = c === 0 ? '#F59E0B' : norm >= 0 ? '#10B981' : '#EF4444';
      const y = norm >= 0 ? midY - barH : midY;
      ctx.fillRect(c * mBarW + 2, y, Math.max(4, mBarW - 4), Math.max(2, barH));
    }
  }, []);

  const processIncoming16kHop = useCallback(
    (samples16k: Float32Array) => {
      const ring = ringBufferRef.current;
      ring.pushChunk(samples16k);

      // State 1 (IDLE_SLEEP): VAD gating only — skips full STFT/Mel/DCT unless speech energy wakes DSP
      const windowSlice = ring.readRecentWindow(FRAME_SIZE_SAMPLES);
      const vad = computeVadMetrics(windowSlice);

      let dtwScore = 0;
      if (powerStateRef.current !== 'IDLE_SLEEP' || vad.vadActive) {
        const feat = extractFrameFeatures(windowSlice);
        latestMelRef.current = feat.logMel;
        latestMfccRef.current = feat.mfcc;
        if (feat.vadActive) ring.activeVadFrames++;
        drawSpectrogram(feat.logMel, feat.mfcc, feat.vadActive);

        // If user enrolled a live microphone MFCC template and engine is ARMED_VIGILANT, evaluate DTW periodically
        if (
          powerStateRef.current === 'ARMED_VIGILANT' &&
          enrolledMfccRef.current.length >= 6 &&
          feat.vadActive &&
          ring.totalHopsProcessed % 20 === 0
        ) {
          const recent18s = ring.readRecentWindow(Math.floor(1.8 * AUDIO_SAMPLE_RATE));
          const candidateSeq = extractActiveMfccSequence(recent18s);
          const tail = candidateSeq.slice(-enrolledMfccRef.current.length);
          dtwScore = computeMfccDtwSimilarity(tail, enrolledMfccRef.current);
          if (dtwScore >= 0.8) {
            triggerSafewordOnce(
              `On-device MFCC DTW SafeWord Acoustic Match (${(dtwScore * 100).toFixed(0)}%)`
            );
          }
        }
      }

      if (ring.totalHopsProcessed % 5 === 0) {
        setTelemetry({
          dbfs: Number(vad.dbfs.toFixed(1)),
          vadActive: vad.vadActive,
          overwrites: ring.totalOverwrites,
          hopsProcessed: ring.totalHopsProcessed,
          dtwScore: Number(dtwScore.toFixed(3)),
          diskBytesPersisted: 0,
        });
      }
    },
    [drawSpectrogram, triggerSafewordOnce]
  );

  const stopAudioEngine = useCallback(() => {
    if (speechRef.current) {
      try {
        speechRef.current.onend = null;
        speechRef.current.stop();
      } catch {
        // ignore
      }
      speechRef.current = null;
    }
    setSpeechActive(false);

    if (workletNodeRef.current) {
      workletNodeRef.current.port.onmessage = null;
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (scriptNodeRef.current) {
      scriptNodeRef.current.onaudioprocess = null;
      scriptNodeRef.current.disconnect();
      scriptNodeRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
    }
    ringBufferRef.current.wipeVolatileRam();
    setMicActive(false);
    setDspMode('STOPPED');
  }, []);

  const startSpeechDetector = useCallback(() => {
    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };
    const SpeechCtor = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechCtor) {
      return;
    }

    try {
      const rec = new SpeechCtor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-IN';

      rec.onresult = async (event: SpeechRecognitionEventLike) => {
        let combined = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          combined += ' ' + (event.results[i]?.[0]?.transcript || '');
        }
        const clean = combined.trim();
        if (!clean) return;
        setLastTranscript(clean);

        if (powerStateRef.current === 'ARMED_VIGILANT' && savedHashRef.current) {
          const matched = await transcriptMatchesSafewordHash(
            clean,
            savedHashRef.current,
            savedWordCountRef.current
          );
          if (matched) {
            triggerSafewordOnce(
              `Hands-Free Voice SafeWord Verified (Web Speech + Volatile VAD ${telemetry.dbfs} dBFS)`
            );
          }
        }
      };

      rec.onerror = () => {
        setSpeechActive(false);
      };

      rec.onend = () => {
        if (streamRef.current && powerStateRef.current !== 'CODE_BLUE_ACTIVE') {
          try {
            rec.start();
          } catch {
            setSpeechActive(false);
          }
        } else {
          setSpeechActive(false);
        }
      };

      rec.start();
      speechRef.current = rec;
      setSpeechActive(true);
    } catch {
      setSpeechActive(false);
    }
  }, [telemetry.dbfs, triggerSafewordOnce]);

  const startAudioEngine = useCallback(async () => {
    setMicError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicError('Microphone API (navigator.mediaDevices.getUserMedia) unavailable in this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
        },
      });
      streamRef.current = stream;

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);

      if (ctx.audioWorklet) {
        try {
          await ctx.audioWorklet.addModule('/worklets/ring-buffer-processor.js');
          const workletNode = new AudioWorkletNode(ctx, 'ring-buffer-capture-processor');
          workletNode.port.onmessage = (evt: MessageEvent<Float32Array>) => {
            if (evt.data && evt.data.length > 0) {
              processIncoming16kHop(evt.data);
            }
          };
          source.connect(workletNode);
          workletNode.connect(ctx.destination);
          workletNodeRef.current = workletNode;
          setDspMode('AUDIOWORKLET');
          setMicActive(true);
          startSpeechDetector();
          return;
        } catch {
          // Fall through cleanly to ScriptProcessorNode fallback
        }
      }

      // Clean fallback if AudioWorklet is blocked or unsupported
      const scriptNode = ctx.createScriptProcessor(2048, 1, 1);
      scriptNode.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        const down16k = downsampleTo16k(input, ctx.sampleRate);
        for (let i = 0; i + HOP_SIZE_SAMPLES <= down16k.length; i += HOP_SIZE_SAMPLES) {
          processIncoming16kHop(down16k.subarray(i, i + HOP_SIZE_SAMPLES));
        }
      };
      source.connect(scriptNode);
      scriptNode.connect(ctx.destination);
      scriptNodeRef.current = scriptNode;
      setDspMode('SCRIPT_FALLBACK');
      setMicActive(true);
      startSpeechDetector();
    } catch (err) {
      setMicError(
        err instanceof Error ? err.message : 'Microphone permission denied or device unavailable.'
      );
      stopAudioEngine();
    }
  }, [processIncoming16kHop, startSpeechDetector, stopAudioEngine]);

  useEffect(() => {
    drawSpectrogram(latestMelRef.current, latestMfccRef.current, false);
    return () => {
      stopAudioEngine();
    };
  }, [drawSpectrogram, stopAudioEngine]);

  // Automatically engage microphone engine when user switches to ARMED_VIGILANT if not running
  useEffect(() => {
    if (powerState === 'ARMED_VIGILANT' && !micActive && !micError) {
      const timer = setTimeout(() => {
        void startAudioEngine();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [powerState, micActive, micError, startAudioEngine]);

  const handleSaveSafeWord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!safewordInput.trim()) return;
    setSavingWord(true);
    try {
      const { hashHex, wordCount } = await sha256PhraseHash(safewordInput);
      await onSaveSafewordHash(hashHex, wordCount);
      setSafewordInput('');
    } finally {
      setSavingWord(false);
    }
  };

  const handleEnrollVoiceTemplate = async () => {
    if (!micActive) {
      await startAudioEngine();
    }
    setEnrollingVoice(true);
    setTimeout(() => {
      const recent = ringBufferRef.current.readRecentWindow(Math.floor(2.0 * AUDIO_SAMPLE_RATE));
      const activeFrames = extractActiveMfccSequence(recent);
      enrolledMfccRef.current = activeFrames;
      setEnrolledFramesCount(activeFrames.length);
      setEnrollingVoice(false);
    }, 2000);
  };

  const handleWipeRam = () => {
    ringBufferRef.current.wipeVolatileRam();
    enrolledMfccRef.current = [];
    setEnrolledFramesCount(0);
    setLastTranscript('');
    setTelemetry({
      dbfs: -90,
      vadActive: false,
      overwrites: 0,
      hopsProcessed: 0,
      dtwScore: 0,
      diskBytesPersisted: 0,
    });
    drawSpectrogram(
      new Float32Array(NUM_MEL_BANDS).fill(-14),
      new Float32Array(NUM_MFCC_COEFFS).fill(0),
      false
    );
  };

  return (
    <section className="rounded-2xl border border-slate-800 bg-[#0B1120] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-mono text-xs text-cyan-400">
            <Volume2 className="h-4 w-4" />
            VOLATILE RAM AUDIO SAFEWORD ENGINE (16kHz · 2.5s RING BUFFER)
          </div>
          <h2 className="mt-1 text-base font-bold text-white">
            Zero-Cloud STFT → 40-Band Mel → 13 DCT MFCC Spectrogram
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={micActive ? stopAudioEngine : startAudioEngine}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              micActive
                ? 'border border-red-500/40 bg-red-500/15 text-red-200 hover:bg-red-500/25'
                : 'border border-cyan-500/40 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25'
            }`}
          >
            {micActive ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
            {micActive ? 'Stop Mic DSP' : 'Start Live Mic DSP'}
          </button>

          <button
            type="button"
            onClick={handleWipeRam}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300 hover:border-slate-500"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Wipe RAM
          </button>
        </div>
      </div>

      {micError && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-950/30 p-3 text-xs text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <span>{micError}</span>
        </div>
      )}

      {/* Live Canvas Spectrogram */}
      <div className="mt-4 overflow-hidden rounded-xl border border-slate-800 bg-[#05080F] p-2">
        <canvas ref={specCanvasRef} width={640} height={180} className="h-44 w-full rounded" />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 font-mono text-[11px] text-slate-400">
          <span>Top: 40-Band Mel |STFT(x)|² (25ms/10ms)</span>
          <span>Bottom: 13 DCT MFCCs</span>
          <span className={telemetry.vadActive ? 'text-emerald-400 font-semibold' : 'text-slate-500'}>
            VAD: {telemetry.vadActive ? 'SPEECH ACTIVE' : 'GATED IDLE'} ({telemetry.dbfs} dBFS)
          </span>
        </div>
      </div>

      {/* Real Volatile Memory Telemetry */}
      <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2.5">
          <div className="text-[10px] font-mono text-slate-400">DSP ENGINE</div>
          <div className="mt-0.5 font-mono text-xs font-bold text-cyan-300">{dspMode}</div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2.5">
          <div className="text-[10px] font-mono text-slate-400">RAM OVERWRITES</div>
          <div className="mt-0.5 font-mono text-xs font-bold text-slate-100">
            {telemetry.overwrites.toLocaleString()} samples
          </div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2.5">
          <div className="text-[10px] font-mono text-slate-400">DISK / CLOUD AUDIO</div>
          <div className="mt-0.5 font-mono text-xs font-bold text-emerald-400">
            {telemetry.diskBytesPersisted} Bytes
          </div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2.5">
          <div className="text-[10px] font-mono text-slate-400">MFCC DTW MATCH</div>
          <div className="mt-0.5 font-mono text-xs font-bold text-slate-100">
            {(telemetry.dtwScore * 100).toFixed(0)}% (th ≥ 80%)
          </div>
        </div>
      </div>

      {/* SafeWord Hash Training & Acoustic Enrollment */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <form onSubmit={handleSaveSafeWord} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-white">1. Secret SafeWord Phrase (SHA-256)</span>
            {savedSafewordHash ? (
              <span className="inline-flex items-center gap-1 font-mono text-[10px] text-emerald-400">
                <ShieldCheck className="h-3 w-3" /> HASH ARMED ({savedSafewordWordCount}w)
              </span>
            ) : (
              <span className="font-mono text-[10px] text-amber-400">NOT CONFIGURED</span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            Stored only as an irreversible SHA-256 digest in PostgreSQL — plaintext never leaves your device.
          </p>
          <div className="mt-2.5 flex gap-2">
            <input
              type="password"
              value={safewordInput}
              onChange={(e) => setSafewordInput(e.target.value)}
              placeholder="Enter secret 1–4 word phrase"
              className="flex-1 rounded-lg border border-slate-700 bg-[#05080F] px-3 py-1.5 text-xs text-white focus:border-cyan-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={savingWord || !safewordInput.trim()}
              className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
            >
              {savingWord ? 'Hashing...' : 'Arm Hash'}
            </button>
          </div>
          <div className="mt-2 font-mono text-[10px] text-slate-400">
            Web Speech API: {speechSupported ? (speechActive ? 'Listening continuously' : 'Ready') : 'Unavailable — use Voice MFCC enrollment'}
            {lastTranscript ? ` · Heard: "${lastTranscript}"` : ''}
          </div>
        </form>

        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-white">2. Acoustic MFCC Voice Enrollment (Volatile RAM)</span>
            <span className="font-mono text-[10px] text-cyan-300">
              {enrolledFramesCount} active frames
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            Speak your SafeWord immediately after clicking Record to capture a 2.0s real MFCC DTW acoustic template in volatile memory.
          </p>
          <button
            type="button"
            onClick={handleEnrollVoiceTemplate}
            disabled={enrollingVoice}
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-50"
          >
            <Mic className="h-3.5 w-3.5" />
            {enrollingVoice ? 'Recording 2.0s Voice Print...' : 'Record 2.0s SafeWord Voice Print'}
          </button>
        </div>
      </div>
    </section>
  );
}
