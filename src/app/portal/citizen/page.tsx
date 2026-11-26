'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertOctagon,
  BatteryCharging,
  CheckCircle2,
  KeyRound,
  Lock,
  MapPin,
  Navigation,
  ShieldCheck,
  UserCheck,
  XCircle,
} from 'lucide-react';
import AppNavbar from '@/components/AppNavbar';
import LiveMapClient from '@/components/LiveMapClient';
import type { MapMarkerPoint } from '@/components/LiveIncidentMap';
import EdgeAudioSentinelPanel from '@/components/citizen/EdgeAudioSentinelPanel';
import BiometricCrashPanel, {
  type LiveBiometricTelemetry,
} from '@/components/citizen/BiometricCrashPanel';
import BleRelayConsole from '@/components/citizen/BleRelayConsole';
import { useSupabaseProfile } from '@/hooks/useSupabaseProfile';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  sealEmergencyPacket,
  verifyAndUnpack52ByteFrame,
  type EphemeralEcdhSession,
} from '@/lib/crypto/e2ee';
import {
  encodeGeoHash,
  estimateEtaSeconds,
  formatDistance,
  formatEta,
  haversineMeters,
} from '@/lib/geohash';
import { enqueueOfflineSos } from '@/lib/offline/outbox';
import type {
  BloodGroup,
  HardwareNode,
  Incident,
  PowerEngineState,
  TriggerType,
} from '@/types/pulseguard';

export default function CitizenPortalPage() {
  const { configured, loading, session, profile, error: authError, refreshProfile } =
    useSupabaseProfile();

  const [powerState, setPowerState] = useState<PowerEngineState>('IDLE_SLEEP');
  const [gpsCoords, setGpsCoords] = useState<{
    lat: number;
    lng: number;
    accuracyM: number;
    geohash: string;
    updatedAt: string;
  } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const [liveTelemetry, setLiveTelemetry] = useState<LiveBiometricTelemetry>({
    hrBpm: null,
    spo2Pct: null,
    hrvRmssdMs: null,
    linearImuG: 0,
    gPeak: 1.0,
    canDeltaVKmh: 0,
    rolloverDeg: 0,
    omegaDegSec: 0,
    dtcCode: null,
  });

  // Medical Onboarding State (edits overlaid cleanly over loaded Supabase profile)
  const [profileEdits, setProfileEdits] = useState<{
    fullName?: string;
    bloodGroup?: BloodGroup;
    allergies?: string;
    medicalConditions?: string;
    emName?: string;
    emEmail?: string;
    emPhone?: string;
    dpdpConsent?: boolean;
  }>({});
  const fullName = profileEdits.fullName ?? profile?.full_name ?? '';
  const bloodGroup = profileEdits.bloodGroup ?? profile?.blood_group ?? 'O+';
  const allergies = profileEdits.allergies ?? profile?.allergies ?? '';
  const medicalConditions =
    profileEdits.medicalConditions ?? profile?.medical_conditions ?? '';
  const emName = profileEdits.emName ?? profile?.emergency_contact_name ?? '';
  const emEmail = profileEdits.emEmail ?? profile?.emergency_contact_email ?? '';
  const emPhone = profileEdits.emPhone ?? profile?.emergency_contact_phone ?? '';
  const dpdpConsent = profileEdits.dpdpConsent ?? Boolean(profile?.dpdp_consent_granted);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileNotice, setProfileNotice] = useState<string | null>(null);

  // Active Incidents & PulseBox AEDs
  const [activeIncident, setActiveIncident] = useState<Incident | null>(null);
  const [pulseBoxes, setPulseBoxes] = useState<HardwareNode[]>([]);
  const [latest52BFrame, setLatest52BFrame] = useState<string | null>(null);
  const [latestPayloadHash, setLatestPayloadHash] = useState<string | null>(null);
  const [verifiedUnpackPreview, setVerifiedUnpackPreview] = useState<string | null>(null);

  // Ephemeral session CryptoKey held strictly in volatile memory until incident closure
  const ephemeralSessionRef = useRef<EphemeralEcdhSession | null>(null);

  // 5-Second Cancelable Haptic Countdown State
  const [countdown, setCountdown] = useState<{
    secondsLeft: number;
    triggerType: TriggerType;
    reason: string;
  } | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchNotice, setDispatchNotice] = useState<string | null>(null);

  // Real Geolocation Watch scaled by the 3-State Low-Power Software Engine
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      return;
    }

    const highAccuracy = powerState !== 'IDLE_SLEEP';
    const maxAgeMs = powerState === 'CODE_BLUE_ACTIVE' ? 0 : powerState === 'ARMED_VIGILANT' ? 5000 : 30000;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setGpsError(null);
        setGpsCoords({
          lat,
          lng,
          accuracyM: Math.round(pos.coords.accuracy),
          geohash: encodeGeoHash(lat, lng, 7),
          updatedAt: new Date().toLocaleTimeString(),
        });
      },
      (err) => {
        setGpsError(err.message || 'Location access denied.');
      },
      {
        enableHighAccuracy: highAccuracy,
        maximumAge: maxAgeMs,
        timeout: 15000,
      }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [powerState]);

  // Load user's active incident + PulseBox AEDs + subscribe to Supabase Realtime
  const loadOperationalState = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !profile) return;

    const [{ data: incRows }, { data: aedRows }] = await Promise.all([
      supabase
        .from('incidents')
        .select('*')
        .eq('victim_id', profile.id)
        .neq('status', 'CLOSED')
        .order('created_at', { ascending: false })
        .limit(1),
      supabase
        .from('hardware_nodes')
        .select('*')
        .eq('node_type', 'PULSEBOX_AED')
        .eq('status', 'ONLINE'),
    ]);

    const currentInc = (incRows?.[0] as Incident | undefined) ?? null;
    setActiveIncident(currentInc);
    if (currentInc) {
      setPowerState('CODE_BLUE_ACTIVE');
      setLatest52BFrame(currentInc.sms_frame_52b_b64);
      setLatestPayloadHash(currentInc.payload_sha256);
    }
    setPulseBoxes((aedRows as HardwareNode[]) || []);
  }, [profile]);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadOperationalState();
    }, 0);
    return () => clearTimeout(t);
  }, [loadOperationalState]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !profile) return;

    const channel = supabase
      .channel(`citizen-incidents-${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'incidents',
          filter: `victim_id=eq.${profile.id}`,
        },
        (payload) => {
          const next = payload.new as Incident | undefined;
          if (!next) return;
          if (next.status === 'CLOSED') {
            setActiveIncident(null);
            ephemeralSessionRef.current = null;
            setPowerState('ARMED_VIGILANT');
            setDispatchNotice('Incident closed — ephemeral ECDH P-256 session keys revoked.');
          } else {
            setActiveIncident(next);
            setPowerState('CODE_BLUE_ACTIVE');
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile]);

  // Execute real Code Blue SOS Dispatch
  const executeCodeBlueDispatch = useCallback(
    async (triggerType: TriggerType, reason: string) => {
      if (dispatching) return;
      if (!profile) {
        setDispatchNotice('Sign in first to dispatch SOS to Supabase Realtime responders.');
        return;
      }

      setDispatching(true);
      setDispatchNotice(null);

      try {
        let coords = gpsCoords;
        if (!coords && navigator.geolocation) {
          coords = await new Promise((resolve) => {
            navigator.geolocation.getCurrentPosition(
              (pos) =>
                resolve({
                  lat: pos.coords.latitude,
                  lng: pos.coords.longitude,
                  accuracyM: Math.round(pos.coords.accuracy),
                  geohash: encodeGeoHash(pos.coords.latitude, pos.coords.longitude, 7),
                  updatedAt: new Date().toLocaleTimeString(),
                }),
              () => resolve(null),
              { enableHighAccuracy: true, timeout: 8000 }
            );
          });
        }

        if (!coords) {
          setDispatchNotice(
            'Real GPS coordinates unavailable. Grant Location permission in your browser to transmit Code Blue SOS.'
          );
          setDispatching(false);
          return;
        }

        const medicalSummary = `${profile.id}|${profile.blood_group || 'UNK'}|${profile.allergies || 'NONE'}`;
        const { packet, session: ecdhSession } = await sealEmergencyPacket(
          {
            lat: coords.lat,
            lng: coords.lng,
            medicalProfileSummary: medicalSummary,
            hrBpm: liveTelemetry.hrBpm ?? profile.baseline_hr_bpm,
            spo2Pct: liveTelemetry.spo2Pct ?? 98,
            hrvRmssdMs: liveTelemetry.hrvRmssdMs ?? profile.baseline_rmssd_ms,
            triggerType,
            offlineQueued: !navigator.onLine,
          },
          {
            victimName: profile.full_name,
            bloodGroup: profile.blood_group,
            allergies: profile.allergies,
            medicalConditions: profile.medical_conditions,
            reason,
            telemetry: liveTelemetry,
          }
        );

        ephemeralSessionRef.current = ecdhSession;
        setLatest52BFrame(packet.smsFrame52BBase64);
        setLatestPayloadHash(packet.payloadSha256Hex);

        // Verify local AES-256-GCM decryption round-trip immediately
        const verified = await verifyAndUnpack52ByteFrame(
          packet.smsFrame52BBase64,
          ecdhSession.aesKey
        );
        setVerifiedUnpackPreview(
          `Verified 52B GCM Tag -> (${verified.lat}, ${verified.lng}) · HR ${verified.hrBpm} BPM · RMSSD ${verified.hrvRmssdMs} ms`
        );

        const incidentRow = {
          victim_id: profile.id,
          victim_name: profile.full_name,
          victim_blood_group: profile.blood_group,
          victim_allergies: profile.allergies,
          emergency_contact_email: profile.emergency_contact_email,
          emergency_contact_phone: profile.emergency_contact_phone,
          trigger_type: triggerType,
          status: 'ACTIVE',
          lat: coords.lat,
          lng: coords.lng,
          geohash: coords.geohash,
          hr_bpm: liveTelemetry.hrBpm,
          spo2_pct: liveTelemetry.spo2Pct,
          hrv_rmssd_ms: liveTelemetry.hrvRmssdMs,
          linear_imu_g: liveTelemetry.linearImuG,
          crash_g_peak: liveTelemetry.gPeak > 1.5 ? liveTelemetry.gPeak : null,
          can_delta_v_kmh: liveTelemetry.canDeltaVKmh > 0 ? liveTelemetry.canDeltaVKmh : null,
          rollover_deg: liveTelemetry.rolloverDeg > 0 ? liveTelemetry.rolloverDeg : null,
          omega_deg_s: liveTelemetry.omegaDegSec > 0 ? liveTelemetry.omegaDegSec : null,
          dtc_code: liveTelemetry.dtcCode,
          encrypted_payload_b64: packet.encryptedPayloadBase64,
          sms_frame_52b_b64: packet.smsFrame52BBase64,
          payload_sha256: packet.payloadSha256Hex,
          ephemeral_ecdh_pub_jwk: packet.ephemeralPublicKeyJwk,
          ephemeral_key_revoked: false,
          offline_queued: !navigator.onLine,
          email_notified: false,
        };

        const notifyPayload = {
          emergencyEmail: profile.emergency_contact_email,
          victimName: profile.full_name,
          triggerType,
          lat: coords.lat,
          lng: coords.lng,
          geohash: coords.geohash,
          hrBpm: liveTelemetry.hrBpm,
          spo2Pct: liveTelemetry.spo2Pct,
          hrvRmssdMs: liveTelemetry.hrvRmssdMs,
          payloadSha256: packet.payloadSha256Hex,
          smsFrame52BBase64: packet.smsFrame52BBase64,
        };

        const supabase = getSupabaseBrowserClient();
        if (!navigator.onLine || !supabase) {
          await enqueueOfflineSos({
            localId: `sos-${Date.now()}`,
            createdAt: new Date().toISOString(),
            synced: false,
            supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
            supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
            accessToken: session?.access_token || '',
            incidentRow,
            notifyPayload,
            smsFrame52BBase64: packet.smsFrame52BBase64,
          });
          setPowerState('CODE_BLUE_ACTIVE');
          setDispatchNotice(
            'OFFLINE FAILOVER: 52-byte encrypted SOS frame queued in IndexedDB for Background Sync. Tap the native SMS Failover button below immediately.'
          );
          setDispatching(false);
          return;
        }

        const { data: created, error: insErr } = await supabase
          .from('incidents')
          .insert(incidentRow)
          .select('*')
          .single();

        if (insErr) {
          await enqueueOfflineSos({
            localId: `sos-${Date.now()}`,
            createdAt: new Date().toISOString(),
            synced: false,
            supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
            supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
            accessToken: session?.access_token || '',
            incidentRow,
            notifyPayload,
            smsFrame52BBase64: packet.smsFrame52BBase64,
          });
          setDispatchNotice(`Network/DB fallback queued offline: ${insErr.message}`);
          setDispatching(false);
          return;
        }

        setActiveIncident(created as Incident);
        setPowerState('CODE_BLUE_ACTIVE');

        // Send Resend emergency family alert
        const mailRes = await fetch('/api/dispatch/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...notifyPayload, incidentId: created.id }),
        }).catch(() => null);

        if (mailRes && mailRes.ok) {
          const mailJson = (await mailRes.json()) as { sent?: boolean; message?: string };
          if (mailJson.sent) {
            await supabase
              .from('incidents')
              .update({ email_notified: true })
              .eq('id', created.id);
          }
          setDispatchNotice(
            mailJson.sent
              ? `Code Blue dispatched (${triggerType}) + Resend email alert sent to ${profile.emergency_contact_email}.`
              : `Code Blue dispatched (${triggerType}). ${mailJson.message || ''}`
          );
        } else {
          setDispatchNotice(`Code Blue dispatched (${triggerType}) to GeoHash ${coords.geohash}.`);
        }
      } finally {
        setDispatching(false);
      }
    },
    [dispatching, gpsCoords, liveTelemetry, profile, session?.access_token]
  );

  // Real 5-Second Cancelable Haptic Countdown for autonomous triggers
  const launchHapticCountdown = useCallback(
    (triggerType: TriggerType, reason: string) => {
      if (countdown || activeIncident || dispatching) return;
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate([300, 150, 300, 150, 500, 150, 500]);
      }
      setCountdown({ secondsLeft: 5, triggerType, reason });
    },
    [countdown, activeIncident, dispatching]
  );

  useEffect(() => {
    if (!countdown) return;
    const { secondsLeft, triggerType, reason } = countdown;

    const timer = setTimeout(() => {
      if (secondsLeft <= 1) {
        setCountdown(null);
        void executeCodeBlueDispatch(triggerType, reason);
        return;
      }
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(180);
      }
      setCountdown((prev) =>
        prev ? { ...prev, secondsLeft: prev.secondsLeft - 1 } : null
      );
    }, 1000);

    return () => clearTimeout(timer);
  }, [countdown, executeCodeBlueDispatch]);

  const handleCloseActiveIncident = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !activeIncident) return;

    const nowIso = new Date().toISOString();
    await supabase
      .from('incidents')
      .update({
        status: 'CLOSED',
        closed_at: nowIso,
        ephemeral_key_revoked: true,
        ephemeral_key_revoked_at: nowIso,
      })
      .eq('id', activeIncident.id);

    // Zero out in-memory session key handle
    ephemeralSessionRef.current = null;
    setActiveIncident(null);
    setPowerState('ARMED_VIGILANT');
    setDispatchNotice('Incident closed and ephemeral ECDH P-256 session key revoked.');
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !profile) return;

    setSavingProfile(true);
    setProfileNotice(null);
    try {
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: fullName.trim(),
          blood_group: bloodGroup,
          allergies: allergies.trim() || 'None reported',
          medical_conditions: medicalConditions.trim() || 'None reported',
          emergency_contact_name: emName.trim(),
          emergency_contact_email: emEmail.trim(),
          emergency_contact_phone: emPhone.trim(),
          dpdp_consent_granted: dpdpConsent,
          dpdp_consent_at: dpdpConsent ? nowIso : profile.dpdp_consent_at,
        })
        .eq('id', profile.id);

      if (error) throw error;

      if (dpdpConsent && !profile.dpdp_consent_granted) {
        await supabase.from('dpdp_consent_logs').insert([
          {
            user_id: profile.id,
            consent_scope: 'MEDICAL_PROFILE_DISPATCH',
            action: 'GRANTED',
            purpose_description:
              'Explicit consent to share encrypted blood group, allergies, and live GPS upon Code Blue SOS.',
          },
          {
            user_id: profile.id,
            consent_scope: 'VOICE_RAM_SAFEWORD',
            action: 'GRANTED',
            purpose_description:
              'On-device volatile RAM audio processing (0 bytes stored/transmitted) for SafeWord detection.',
          },
        ]);
      }

      await refreshProfile();
      setProfileNotice('Medical profile & DPDP consent saved to Supabase PostgreSQL.');
    } catch (err) {
      setProfileNotice(err instanceof Error ? err.message : 'Failed to save profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSaveSafewordHash = async (hashHex: string, wordCount: number) => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !profile) return;
    await supabase
      .from('profiles')
      .update({ safeword_hash: hashHex, safeword_word_count: wordCount })
      .eq('id', profile.id);
    await refreshProfile();
  };

  const handleCalibrateBaseline = async (hrBpm: number, rmssdMs: number) => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !profile) return;
    await supabase
      .from('profiles')
      .update({
        baseline_hr_bpm: Math.max(40, Math.min(150, hrBpm)),
        baseline_rmssd_ms: Math.max(10, Math.min(200, rmssdMs)),
      })
      .eq('id', profile.id);
    await refreshProfile();
  };

  // Compute live map markers & responder ETA from real coordinates
  const mapMarkers: MapMarkerPoint[] = useMemo(() => {
    const list: MapMarkerPoint[] = [];
    const baseLat = activeIncident?.lat ?? gpsCoords?.lat;
    const baseLng = activeIncident?.lng ?? gpsCoords?.lng;

    if (baseLat !== undefined && baseLng !== undefined) {
      list.push({
        id: 'victim-self',
        lat: baseLat,
        lng: baseLng,
        kind: activeIncident ? 'victim' : 'self',
        title: activeIncident ? 'Code Blue Victim Location' : 'Your Live GPS Position',
        subtitle: gpsCoords ? `Accuracy ±${gpsCoords.accuracyM}m` : undefined,
      });
    }

    if (
      activeIncident?.responder_lat !== null &&
      activeIncident?.responder_lat !== undefined &&
      activeIncident?.responder_lng !== null &&
      activeIncident?.responder_lng !== undefined
    ) {
      list.push({
        id: 'assigned-responder',
        lat: activeIncident.responder_lat,
        lng: activeIncident.responder_lng,
        kind: 'responder',
        title: activeIncident.responder_name || 'Assigned Responder',
        subtitle: activeIncident.responder_tier || 'Verified Responder',
      });
    }

    for (const pb of pulseBoxes) {
      list.push({
        id: pb.id,
        lat: pb.lat,
        lng: pb.lng,
        kind: 'aed',
        title: pb.label,
        subtitle: `PulseBox AED (${pb.aed_status || 'READY'})`,
      });
    }
    return list;
  }, [activeIncident, gpsCoords, pulseBoxes]);

  const responderDistanceM =
    activeIncident?.responder_lat != null && activeIncident?.responder_lng != null
      ? haversineMeters(
          activeIncident.lat,
          activeIncident.lng,
          activeIncident.responder_lat,
          activeIncident.responder_lng
        )
      : null;

  const mapCenter = activeIncident
    ? { lat: activeIncident.lat, lng: activeIncident.lng }
    : gpsCoords
      ? { lat: gpsCoords.lat, lng: gpsCoords.lng }
      : { lat: 28.6139, lng: 77.209 };

  return (
    <div className="min-h-screen bg-[#05080F] text-slate-100">
      <AppNavbar profile={profile} />

      {/* 5-Second Cancelable Haptic Countdown Overlay */}
      {countdown && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border-2 border-red-500 bg-[#0B1120] p-6 text-center shadow-2xl shadow-red-900/50">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-500/20 text-red-400">
              <AlertOctagon className="h-8 w-8 animate-pulse" />
            </div>
            <h2 className="mt-3 text-xl font-extrabold text-white">
              Autonomous SOS Dispatch in {countdown.secondsLeft}s
            </h2>
            <p className="mt-1 font-mono text-xs text-red-300">{countdown.triggerType}</p>
            <p className="mt-2 text-xs text-slate-300">{countdown.reason}</p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setCountdown(null)}
                className="flex-1 rounded-xl border border-slate-600 bg-slate-800 py-3 text-sm font-bold text-white hover:bg-slate-700"
              >
                CANCEL (FALSE ALARM)
              </button>
              <button
                type="button"
                onClick={() => {
                  const { triggerType, reason } = countdown;
                  setCountdown(null);
                  executeCodeBlueDispatch(triggerType, reason);
                }}
                className="flex-1 rounded-xl bg-red-600 py-3 text-sm font-bold text-white hover:bg-red-500"
              >
                DISPATCH NOW
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        {!loading && !profile && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-500/30 bg-cyan-950/25 p-4 text-xs text-cyan-100">
            <div>
              <strong>Local Sensor Lab Ready:</strong> Edge Audio DSP, Optical PPG, BLE GATT &amp; IMU
              run locally in-browser.{' '}
              {configured
                ? 'Sign in to save your medical profile and enable live Supabase Realtime Code Blue dispatch.'
                : 'Configure Supabase environment variables to persist dispatches.'}
              {authError ? ` (${authError})` : ''}
            </div>
            <Link
              href="/auth"
              className="rounded-lg bg-cyan-600 px-3 py-1.5 font-semibold text-white hover:bg-cyan-500"
            >
              Sign In / Enroll
            </Link>
          </div>
        )}

        {/* Top Header: 3-State Low-Power Engine + One-Tap Manual Code Blue SOS */}
        <section className="rounded-2xl border border-slate-800 bg-[#0B1120] p-5">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
            <div>
              <div className="flex items-center gap-2 font-mono text-xs text-cyan-400">
                <BatteryCharging className="h-4 w-4" />
                PORTAL A · 3-STATE LOW-POWER EDGE SENTINEL
              </div>
              <h1 className="mt-1 text-xl font-extrabold text-white sm:text-2xl">
                Citizen &amp; Women Safety Command Console
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-3 font-mono text-xs text-slate-400">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5 text-emerald-400" />
                  {gpsCoords
                    ? `${gpsCoords.lat.toFixed(5)}, ${gpsCoords.lng.toFixed(5)} · GeoHash ${gpsCoords.geohash} (±${gpsCoords.accuracyM}m)`
                    : gpsError || 'Acquiring live GPS fix...'}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {(['IDLE_SLEEP', 'ARMED_VIGILANT', 'CODE_BLUE_ACTIVE'] as PowerEngineState[]).map(
                (stateKey) => {
                  const active = powerState === stateKey;
                  const disabled = stateKey === 'CODE_BLUE_ACTIVE' && !activeIncident;
                  return (
                    <button
                      key={stateKey}
                      type="button"
                      disabled={disabled}
                      onClick={() => setPowerState(stateKey)}
                      className={`rounded-lg border px-3 py-2 font-mono text-[11px] font-bold transition ${
                        active
                          ? stateKey === 'CODE_BLUE_ACTIVE'
                            ? 'border-red-500 bg-red-600 text-white'
                            : stateKey === 'ARMED_VIGILANT'
                              ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                              : 'border-emerald-400 bg-emerald-500/20 text-emerald-200'
                          : 'border-slate-700 bg-slate-950 text-slate-400 hover:text-slate-200 disabled:opacity-40'
                      }`}
                    >
                      {stateKey === 'IDLE_SLEEP'
                        ? 'STATE 1 · IDLE VAD'
                        : stateKey === 'ARMED_VIGILANT'
                          ? 'STATE 2 · ARMED FUSION'
                          : 'STATE 3 · CODE BLUE'}
                    </button>
                  );
                }
              )}

              <button
                type="button"
                disabled={dispatching}
                onClick={() =>
                  executeCodeBlueDispatch('MANUAL_SOS', 'One-tap manual Code Blue SOS trigger')
                }
                className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-5 py-2.5 text-sm font-extrabold text-white shadow-lg shadow-red-900/40 transition hover:bg-red-500 disabled:opacity-50"
              >
                <AlertOctagon className="h-4 w-4" />
                {dispatching ? 'SEALING E2EE...' : 'ONE-TAP CODE BLUE SOS'}
              </button>
            </div>
          </div>

          {dispatchNotice && (
            <div className="mt-4 rounded-xl border border-cyan-500/40 bg-cyan-950/30 p-3 text-xs text-cyan-100">
              {dispatchNotice}
            </div>
          )}

          {verifiedUnpackPreview && (
            <div className="mt-2 flex items-center gap-2 font-mono text-[11px] text-emerald-300">
              <KeyRound className="h-3.5 w-3.5" />
              {verifiedUnpackPreview}
            </div>
          )}
        </section>

        {/* Active Incident & Incoming Responder Live Tracking */}
        {activeIncident && (
          <section className="rounded-2xl border-2 border-red-500/70 bg-red-950/20 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 font-mono text-xs font-bold text-red-300">
                  <span className="h-2.5 w-2.5 animate-ping rounded-full bg-red-500" />
                  ACTIVE CODE BLUE · STATUS: {activeIncident.status}
                </div>
                <h2 className="mt-1 text-lg font-bold text-white">
                  {activeIncident.responder_name
                    ? `Responder Assigned: ${activeIncident.responder_name} (${activeIncident.responder_tier})`
                    : 'Broadcasting within 2 km GeoHash Radius for NMC/BLS Responders...'}
                </h2>
                {responderDistanceM !== null && (
                  <div className="mt-1 flex items-center gap-3 font-mono text-xs text-emerald-300">
                    <span className="inline-flex items-center gap-1">
                      <Navigation className="h-3.5 w-3.5" />
                      Distance: {formatDistance(responderDistanceM)}
                    </span>
                    <span>
                      Dynamic ETA: {formatEta(estimateEtaSeconds(responderDistanceM))}
                    </span>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={handleCloseActiveIncident}
                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/50 bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500"
              >
                <XCircle className="h-4 w-4" />
                Mark Safe / Close &amp; Revoke Keys
              </button>
            </div>
          </section>
        )}

        {/* Live Tactical OpenStreetMap + Leaflet Map */}
        <section className="rounded-2xl border border-slate-800 bg-[#0B1120] p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-white">
                Live GPS GeoHash Map &amp; Incoming Responder Tracking
              </h2>
              <p className="text-xs text-slate-400">
                Displays real browser coordinates, precision-7 GeoHash bounds, nearest PulseBox AEDs,
                and live responder GPS updates.
              </p>
            </div>
            <div className="flex items-center gap-3 font-mono text-[11px] text-slate-400">
              <span>PulseBox AEDs Online: {pulseBoxes.length}</span>
              <span className="inline-flex items-center gap-1 text-emerald-400">
                <Lock className="h-3 w-3" /> ECDH P-256 Active
              </span>
            </div>
          </div>

          <LiveMapClient
            center={mapCenter}
            markers={mapMarkers}
            geohashCells={
              activeIncident?.geohash
                ? [activeIncident.geohash]
                : gpsCoords?.geohash
                  ? [gpsCoords.geohash]
                  : []
            }
            radiusCircle={
              gpsCoords ? { lat: gpsCoords.lat, lng: gpsCoords.lng, radiusMeters: 2000 } : null
            }
            routeLine={
              activeIncident?.responder_lat != null && activeIncident?.responder_lng != null
                ? [
                    [activeIncident.lat, activeIncident.lng],
                    [activeIncident.responder_lat, activeIncident.responder_lng],
                  ]
                : null
            }
          />
        </section>

        {/* Tier 1 & Tier 2 Edge Audio + Biometric/Crash Sensor Fusion */}
        <EdgeAudioSentinelPanel
          powerState={powerState}
          savedSafewordHash={profile?.safeword_hash ?? null}
          savedSafewordWordCount={profile?.safeword_word_count ?? 2}
          onSaveSafewordHash={handleSaveSafewordHash}
          onSafeWordTriggered={(reason) => launchHapticCountdown('SAFEWORD_VOICE', reason)}
        />

        <BiometricCrashPanel
          powerState={powerState}
          baselineHrBpm={profile?.baseline_hr_bpm ?? 72}
          baselineRmssdMs={profile?.baseline_rmssd_ms ?? 42}
          onCalibrateBaseline={handleCalibrateBaseline}
          onTelemetryChange={setLiveTelemetry}
          onAutonomousTrigger={launchHapticCountdown}
        />

        {/* Tier 3 Offline 52-Byte SMS Failover & BLE Mesh Console */}
        <BleRelayConsole
          emergencyPhone={profile?.emergency_contact_phone ?? null}
          latest52BFrame={latest52BFrame}
          latestPayloadSha256={latestPayloadHash}
        />

        {/* Medical Profile & DPDP Act 2023 Explicit Consent Form */}
        {profile && (
          <section className="rounded-2xl border border-slate-800 bg-[#0B1120] p-5">
            <div className="flex items-center gap-2 font-mono text-xs text-cyan-400">
              <UserCheck className="h-4 w-4" />
              MEDICAL PROFILE ONBOARDING &amp; DPDP ACT 2023 CONSENT
            </div>
            <h2 className="mt-1 text-base font-bold text-white">
              Emergency Clinical Record &amp; Family Alert Targets
            </h2>

            <form onSubmit={handleSaveProfile} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="block text-xs text-slate-300">Full Name</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setProfileEdits((p) => ({ ...p, fullName: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-300">Blood Group</label>
                <select
                  value={bloodGroup}
                  onChange={(e) =>
                    setProfileEdits((p) => ({ ...p, bloodGroup: e.target.value as BloodGroup }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
                >
                  {(['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'] as BloodGroup[]).map((bg) => (
                    <option key={bg} value={bg}>
                      {bg}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-300">Known Drug / Clinical Allergies</label>
                <input
                  type="text"
                  value={allergies}
                  onChange={(e) => setProfileEdits((p) => ({ ...p, allergies: e.target.value }))}
                  placeholder="e.g. Penicillin, Aspirin, None"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-300">Chronic Conditions</label>
                <input
                  type="text"
                  value={medicalConditions}
                  onChange={(e) =>
                    setProfileEdits((p) => ({ ...p, medicalConditions: e.target.value }))
                  }
                  placeholder="e.g. Asthma, Type 1 Diabetes, None"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-300">Emergency Contact Name</label>
                <input
                  type="text"
                  value={emName}
                  onChange={(e) => setProfileEdits((p) => ({ ...p, emName: e.target.value }))}
                  placeholder="Next of kin name"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-300">Emergency Family Email (Resend)</label>
                <input
                  type="email"
                  value={emEmail}
                  onChange={(e) => setProfileEdits((p) => ({ ...p, emEmail: e.target.value }))}
                  placeholder="family@example.com"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-300">Emergency Phone (52B SMS URI)</label>
                <input
                  type="tel"
                  value={emPhone}
                  onChange={(e) => setProfileEdits((p) => ({ ...p, emPhone: e.target.value }))}
                  placeholder="+9198XXXXXXXX"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div className="sm:col-span-2 flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                <input
                  id="dpdp-consent-check"
                  type="checkbox"
                  checked={dpdpConsent}
                  onChange={(e) =>
                    setProfileEdits((p) => ({ ...p, dpdpConsent: e.target.checked }))
                  }
                  className="h-4 w-4 accent-cyan-500"
                />
                <label htmlFor="dpdp-consent-check" className="text-xs text-slate-300">
                  I grant explicit consent under the <strong>DPDP Act 2023</strong> for on-device
                  biometric fusion, volatile RAM audio SafeWord gating, and E2EE emergency medical
                  dispatch to verified NMC/BLS responders &amp; 112.
                </label>
              </div>

              <div className="sm:col-span-2 lg:col-span-3 flex flex-wrap items-center justify-between gap-3">
                {profileNotice ? (
                  <span className="inline-flex items-center gap-1.5 text-xs text-emerald-300">
                    <CheckCircle2 className="h-4 w-4" />
                    {profileNotice}
                  </span>
                ) : (
                  <span className="font-mono text-[11px] text-slate-500">
                    Baseline: {profile.baseline_hr_bpm} BPM · RMSSD {profile.baseline_rmssd_ms} ms
                  </span>
                )}
                <button
                  type="submit"
                  disabled={savingProfile}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-600 px-4 py-2 text-xs font-bold text-white hover:bg-cyan-500 disabled:opacity-50"
                >
                  <ShieldCheck className="h-4 w-4" />
                  {savingProfile ? 'Saving...' : 'Save Medical Profile & Consent'}
                </button>
              </div>
            </form>
          </section>
        )}
      </main>
    </div>
  );
}
