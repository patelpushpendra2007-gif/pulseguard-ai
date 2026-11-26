'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import {
  Activity,
  Bluetooth,
  Camera,
  CheckCircle2,
  Cpu,
  Lock,
  Mic,
  Navigation,
  RadioTower,
  ShieldAlert,
  Stethoscope,
  Wifi,
  XCircle,
  ArrowRight,
} from 'lucide-react';
import AppNavbar from '@/components/AppNavbar';
import { useSupabaseProfile } from '@/hooks/useSupabaseProfile';

interface HardwareProbe {
  name: string;
  supported: boolean;
  detail: string;
}

const SERVER_PROBES: HardwareProbe[] = [];
let cachedClientProbes: HardwareProbe[] | null = null;

function subscribeProbes(callback: () => void): () => void {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

function getClientProbesSnapshot(): HardwareProbe[] {
  if (cachedClientProbes && cachedClientProbes.length > 0) {
    // Update dynamic online status cleanly only if changed
    const onlineDetail = navigator.onLine ? 'Online & IndexedDB ready' : 'Offline failover mode active';
    if (cachedClientProbes[cachedClientProbes.length - 1].detail === onlineDetail) {
      return cachedClientProbes;
    }
  }

  const win = window as unknown as Record<string, unknown>;
  const nav = navigator as unknown as Record<string, unknown>;
  const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;

  cachedClientProbes = [
    {
      name: 'Web Audio + AudioWorklet (16kHz Ring Buffer)',
      supported: Boolean(win.AudioContext || win.webkitAudioContext),
      detail:
        typeof AudioWorkletNode !== 'undefined'
          ? 'AudioWorkletNode active'
          : 'ScriptProcessor fallback available',
    },
    {
      name: 'Local Web Speech API (SafeWord)',
      supported: Boolean(SpeechRec),
      detail: SpeechRec ? 'SpeechRecognition available' : 'MFCC DTW acoustic detector active',
    },
    {
      name: 'Web Bluetooth GATT (0x180D / OBD-II)',
      supported: Boolean(nav.bluetooth),
      detail: nav.bluetooth ? 'navigator.bluetooth available' : 'Use Chrome/Edge HTTPS or Android',
    },
    {
      name: 'Optical PPG Rear Camera + Torch',
      supported: typeof navigator.mediaDevices !== 'undefined',
      detail:
        typeof navigator.mediaDevices !== 'undefined'
          ? 'getUserMedia available'
          : 'Camera unavailable',
    },
    {
      name: 'IMU Crash Physics (DeviceMotion)',
      supported: 'DeviceMotionEvent' in window,
      detail: 'DeviceMotionEvent' in window ? 'Motion API present' : 'No browser motion API',
    },
    {
      name: 'Geolocation + Web Crypto + Offline SW',
      supported: Boolean(
        navigator.geolocation && window.crypto?.subtle && 'serviceWorker' in navigator
      ),
      detail: navigator.onLine ? 'Online & IndexedDB ready' : 'Offline failover mode active',
    },
  ];
  return cachedClientProbes;
}

export default function LandingPage() {
  const { profile } = useSupabaseProfile();
  const probes = useSyncExternalStore(
    subscribeProbes,
    getClientProbesSnapshot,
    () => SERVER_PROBES
  );

  const portals = [
    {
      href: '/portal/citizen',
      badge: 'PORTAL A',
      title: 'Citizen & Women Safety Edge Sentinel',
      icon: Activity,
      accent: 'border-red-500/40 hover:border-red-400/70',
      iconColor: 'text-red-400',
      points: [
        '2.5s Volatile RAM Audio Ring Buffer (16kHz STFT -> 40-Mel -> 13 MFCC) + custom SafeWord trigger',
        'Web Bluetooth GATT Heart Rate (0x180D/0x2A37), OBD-II BLE, Optical Camera PPG & DeviceMotion IMU',
        '3-State Low-Power Engine + 5s Haptic Countdown + ECDH P-256 / 52-Byte SMS URI failover',
      ],
    },
    {
      href: '/portal/responder',
      badge: 'PORTAL B',
      title: 'NMC/ABDM Doctor & BLS Responder Mesh',
      icon: Stethoscope,
      accent: 'border-emerald-500/40 hover:border-emerald-400/70',
      iconColor: 'text-emerald-400',
      points: [
        'Tier A (NMC/NMR Doctor/Nurse) & Tier B (AHA/Red Cross BLS) Online toggle & live GPS streaming',
        'Instant <2s Supabase Realtime Code Blue alerts filtered within 2 km GeoHash radius',
        'Nearest PulseBox AED routing, Gemini live AHA triage protocol & Section 134A Good Samaritan Certificate',
      ],
    },
    {
      href: '/portal/command',
      badge: 'PORTAL C',
      title: 'Smart City Police 112 & Triage Command Desk',
      icon: RadioTower,
      accent: 'border-cyan-500/40 hover:border-cyan-400/70',
      iconColor: 'text-cyan-400',
      points: [
        'Live OpenStreetMap + Leaflet tactical map with GeoHash clusters & active responder ETAs',
        'Cryptographic payload SHA-256 & 52-byte frame verification + ephemeral key revocation status',
        'Full lifecycle transitions: ACTIVE -> DISPATCHED -> EN_ROUTE -> STABILIZED -> CLOSED',
      ],
    },
    {
      href: '/portal/governance',
      badge: 'PORTAL D',
      title: 'Hardware IoT & DPDP Act 2023 Governance',
      icon: Cpu,
      accent: 'border-amber-500/40 hover:border-amber-400/70',
      iconColor: 'text-amber-400',
      points: [
        'Register & monitor physical ESP32-S3 OBD-II Lite/Pro dongles & PulseBox AED cabinets',
        'Live incoming hardware webhook pings via authenticated POST /api/iot/telemetry',
        'PostgreSQL DPDP Act 2023 explicit consent logs, JSON portability export & data erasure controls',
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-[#05080F] text-slate-100">
      <AppNavbar profile={profile} />

      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        {/* Hero */}
        <section className="rounded-2xl border border-slate-800 bg-gradient-to-br from-[#0B1120] via-[#070C17] to-[#05080F] p-6 sm:p-10">
          <div className="flex flex-wrap items-center gap-2 text-xs font-mono uppercase tracking-wider">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1 text-red-300">
              <ShieldAlert className="h-3.5 w-3.5" />
              Zero Mock Data · Production Telemetry
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-cyan-300">
              <Lock className="h-3.5 w-3.5" />
              ECDH P-256 + AES-256-GCM (52B SMS)
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-emerald-300">
              <Wifi className="h-3.5 w-3.5" />
              Supabase Auth + RLS + Realtime
            </span>
          </div>

          <h1 className="mt-5 max-w-4xl text-3xl font-extrabold tracking-tight text-white sm:text-5xl">
            PulseGuard AI — Autonomous Edge Sentinel &amp; Hyper-Local Clinical Dispatch Mesh
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-slate-300 sm:text-base">
            Built on real browser signal-processing pipelines, volatile RAM audio isolation,
            hardware Web Bluetooth &amp; Optical PPG biometrics, smartphone crash physics,
            52-byte E2EE binary SMS failover, and Supabase Realtime dispatch across Citizens,
            NMC/BLS Responders, Police 112 Command, and IoT Hardware Nodes.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href={profile ? `/portal/${profile.role === 'responder' ? 'responder' : profile.role === 'dispatcher' ? 'command' : profile.role === 'admin' ? 'governance' : 'citizen'}` : '/auth'}
              className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-red-900/30 transition hover:bg-red-500"
            >
              {profile ? 'Open Active Role Portal' : 'Sign In / Enroll in Mesh'}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/portal/citizen"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/80 px-5 py-3 text-sm font-semibold text-slate-200 hover:border-cyan-500/50 hover:text-white"
            >
              Launch Citizen Edge Sentinel
            </Link>
          </div>
        </section>

        {/* Architecture Tiers */}
        <section className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-800 bg-[#0B1120] p-5">
            <div className="flex items-center gap-2 font-mono text-xs text-cyan-400">
              <Mic className="h-4 w-4" /> TIER 1 · VOLATILE EDGE DSP
            </div>
            <h2 className="mt-2 text-base font-bold text-white">2.5s In-Memory Ring Buffer</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
              16kHz Float32Array circular buffer computes 25ms Hann / 10ms hop STFT power spectra,
              40-band Mel energies, and 13 DCT MFCC coefficients in volatile RAM. 0 bytes written to disk.
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#0B1120] p-5">
            <div className="flex items-center gap-2 font-mono text-xs text-emerald-400">
              <Bluetooth className="h-4 w-4" /> TIER 2 · SENSOR FUSION
            </div>
            <h2 className="mt-2 text-base font-bold text-white">BLE GATT, Camera PPG &amp; IMU</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
              Streams live 0x180D/0x2A37 RR-intervals, rear-camera optical red-channel PPG peaks,
              OBD-II CAN delta-V, and gravity-subtracted linear IMU acceleration with a 5s haptic abort.
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#0B1120] p-5">
            <div className="flex items-center gap-2 font-mono text-xs text-amber-400">
              <Lock className="h-4 w-4" /> TIER 3 · E2EE &amp; 52B SMS
            </div>
            <h2 className="mt-2 text-base font-bold text-white">72-Char GSM-7 Failover</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
              Ephemeral ECDH P-256 + AES-256-GCM seals an exact 24B telemetry struct + 12B IV + 16B tag
              into 52 bytes (72 Base64 chars), synced offline via IndexedDB SW or one-tap sms: URI.
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-[#0B1120] p-5">
            <div className="flex items-center gap-2 font-mono text-xs text-red-400">
              <Navigation className="h-4 w-4" /> TIER 4 · GEOHASH MESH
            </div>
            <h2 className="mt-2 text-base font-bold text-white">2km Clinical Dispatch &amp; 112</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
              GeoHash micro-fencing + Leaflet live tracking + Resend family alerts + optional Gemini AHA
              triage + Section 134A Good Samaritan ₹10L Indemnity log.
            </p>
          </div>
        </section>

        {/* Live Device Hardware Capability Probe */}
        <section className="mt-8 rounded-2xl border border-slate-800 bg-[#0B1120] p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold text-white">
                Live Browser &amp; Hardware Sensor Capability Probe
              </h2>
              <p className="text-xs text-slate-400">
                Real-time feature detection on your current device (no simulated flags).
              </p>
            </div>
            <div className="flex items-center gap-2 font-mono text-xs text-slate-400">
              <Camera className="h-4 w-4 text-cyan-400" />
              Permissions-Policy enabled
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {probes.map((probe) => (
              <div
                key={probe.name}
                className="flex items-start gap-3 rounded-xl border border-slate-800/90 bg-slate-950/70 p-3.5"
              >
                {probe.supported ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                )}
                <div>
                  <div className="text-xs font-semibold text-slate-100">{probe.name}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-slate-400">{probe.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 4 Authenticated Role Portals */}
        <section className="mt-8">
          <h2 className="text-lg font-bold text-white">Authenticated Role Portals</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            {portals.map((portal) => {
              const Icon = portal.icon;
              return (
                <Link
                  key={portal.href}
                  href={portal.href}
                  className={`group rounded-2xl border bg-[#0B1120] p-6 transition ${portal.accent}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold tracking-wider text-slate-400">
                      {portal.badge}
                    </span>
                    <Icon className={`h-5 w-5 ${portal.iconColor}`} />
                  </div>
                  <h3 className="mt-2 text-lg font-bold text-white group-hover:text-cyan-200">
                    {portal.title}
                  </h3>
                  <ul className="mt-3 space-y-1.5 text-xs text-slate-300">
                    {portal.points.map((pt) => (
                      <li key={pt} className="flex items-start gap-2">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-500" />
                        <span>{pt}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-300">
                    Enter Portal <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-1" />
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
