'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Award,
  BrainCircuit,
  CheckCircle2,
  Download,
  HeartPulse,
  MapPin,
  Navigation,
  Power,
  ShieldCheck,
  Siren,
  Stethoscope,
  AlertTriangle,
} from 'lucide-react';
import AppNavbar from '@/components/AppNavbar';
import LiveMapClient from '@/components/LiveMapClient';
import type { MapMarkerPoint } from '@/components/LiveIncidentMap';
import { useSupabaseProfile } from '@/hooks/useSupabaseProfile';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  encodeGeoHash,
  estimateEtaSeconds,
  formatDistance,
  formatEta,
  haversineMeters,
} from '@/lib/geohash';
import type { HardwareNode, Incident, IncidentStatus, TriageGuidance } from '@/types/pulseguard';

function buildGoodSamaritanCertId(incidentId: string): string {
  const ts = new Date().getTime().toString(36).toUpperCase();
  return `PG-134A-${incidentId.slice(0, 8).toUpperCase()}-${ts}`;
}

export default function ResponderPortalPage() {
  const { loading, profile, refreshProfile } = useSupabaseProfile();

  const isOnline = Boolean(profile?.is_available);
  const [responderCoords, setResponderCoords] = useState<{
    lat: number;
    lng: number;
    geohash: string;
    accuracyM: number;
  } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [radiusOnly2Km, setRadiusOnly2Km] = useState(true);

  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [pulseBoxes, setPulseBoxes] = useState<HardwareNode[]>([]);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Gemini Clinical Triage State
  const [triageLoading, setTriageLoading] = useState(false);
  const [triageNotice, setTriageNotice] = useState<string | null>(null);
  const [triageGuidance, setTriageGuidance] = useState<TriageGuidance | null>(null);

  const knownIncidentIdsRef = useRef<Set<string>>(new Set());

  const playAlertChime = useCallback(() => {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1174.66, ctx.currentTime + 0.14);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.36);
    } catch {
      // ignore if autoplay blocked before user gesture
    }
  }, []);

  const loadMeshData = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !profile) return;

    const [{ data: incData }, { data: pbData }] = await Promise.all([
      supabase
        .from('incidents')
        .select('*')
        .neq('status', 'CLOSED')
        .order('created_at', { ascending: false }),
      supabase
        .from('hardware_nodes')
        .select('*')
        .eq('node_type', 'PULSEBOX_AED')
        .eq('status', 'ONLINE'),
    ]);

    const rows = (incData as Incident[]) || [];
    for (const r of rows) {
      if (r.status === 'ACTIVE' && !knownIncidentIdsRef.current.has(r.id)) {
        if (knownIncidentIdsRef.current.size > 0) {
          playAlertChime();
        }
        knownIncidentIdsRef.current.add(r.id);
      }
    }
    setIncidents(rows);
    setPulseBoxes((pbData as HardwareNode[]) || []);
  }, [profile, playAlertChime]);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadMeshData();
    }, 0);
    return () => clearTimeout(t);
  }, [loadMeshData]);

  // Realtime <2s Code Blue alert subscription
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !profile) return;

    const channel = supabase
      .channel('responder-mesh-incidents')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'incidents' },
        () => {
          loadMeshData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile, loadMeshData]);

  const activeAssignedIncident = useMemo(
    () =>
      incidents.find(
        (inc) =>
          inc.responder_id === profile?.id &&
          ['DISPATCHED', 'EN_ROUTE', 'STABILIZED'].includes(inc.status)
      ) ?? null,
    [incidents, profile]
  );

  const displayedTriageGuidance = triageGuidance ?? activeAssignedIncident?.triage_notes ?? null;

  // Real GPS Watch streaming to Supabase profile & active assigned incident
  useEffect(() => {
    if (!isOnline || !profile || typeof navigator === 'undefined' || !navigator.geolocation) {
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const geohash = encodeGeoHash(lat, lng, 7);
        setGpsError(null);
        setResponderCoords({
          lat,
          lng,
          geohash,
          accuracyM: Math.round(pos.coords.accuracy),
        });

        const supabase = getSupabaseBrowserClient();
        if (!supabase) return;

        const nowIso = new Date().toISOString();
        await supabase
          .from('profiles')
          .update({
            current_lat: lat,
            current_lng: lng,
            current_geohash: geohash,
            last_location_at: nowIso,
          })
          .eq('id', profile.id);

        if (activeAssignedIncident) {
          await supabase
            .from('incidents')
            .update({
              responder_lat: lat,
              responder_lng: lng,
              responder_updated_at: nowIso,
            })
            .eq('id', activeAssignedIncident.id);
        }
      },
      (err) => {
        setGpsError(err.message || 'Location access denied.');
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [isOnline, profile, activeAssignedIncident]);

  const handleToggleAvailability = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !profile) return;

    const next = !isOnline;
    const { error } = await supabase
      .from('profiles')
      .update({ is_available: next })
      .eq('id', profile.id);

    if (error) {
      setActionNotice(error.message);
      return;
    }
    await refreshProfile();
  };

  const handleAcceptDispatch = async (incident: Incident) => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !profile) return;

    const nowIso = new Date().toISOString();
    const certId = buildGoodSamaritanCertId(incident.id);
    const credentialId =
      profile.responder_tier === 'TIER_A_NMC'
        ? profile.nmc_registration_id || profile.abdm_hpr_id || 'NMC-VERIFIED'
        : profile.bls_certification_id || 'BLS-VERIFIED';

    const { error } = await supabase
      .from('incidents')
      .update({
        status: 'DISPATCHED',
        responder_id: profile.id,
        responder_name: profile.full_name,
        responder_tier: profile.responder_tier || 'TIER_B_BLS',
        responder_nmc_id: credentialId,
        responder_lat: responderCoords?.lat ?? profile.current_lat,
        responder_lng: responderCoords?.lng ?? profile.current_lng,
        responder_updated_at: nowIso,
        accepted_at: nowIso,
        good_samaritan_cert_id: certId,
        indemnity_amount_inr: 1000000,
      })
      .eq('id', incident.id)
      .eq('status', 'ACTIVE')
      .is('responder_id', null);

    if (error) {
      setActionNotice(`Unable to claim dispatch: ${error.message}`);
      return;
    }

    setActionNotice(
      `Dispatch accepted. Section 134A Good Samaritan Shield Certificate ${certId} issued (₹10,00,000 Indemnity).`
    );
    await loadMeshData();
  };

  const handleTransitionStatus = async (incident: Incident, nextStatus: IncidentStatus) => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    const nowIso = new Date().toISOString();
    const updates: Record<string, unknown> = { status: nextStatus };
    if (nextStatus === 'EN_ROUTE') updates.en_route_at = nowIso;
    if (nextStatus === 'STABILIZED') updates.stabilized_at = nowIso;
    if (nextStatus === 'CLOSED') {
      updates.closed_at = nowIso;
      updates.ephemeral_key_revoked = true;
      updates.ephemeral_key_revoked_at = nowIso;
    }

    const { error } = await supabase.from('incidents').update(updates).eq('id', incident.id);
    if (error) {
      setActionNotice(error.message);
      return;
    }
    if (nextStatus === 'CLOSED') {
      setTriageGuidance(null);
      setActionNotice('Incident closed and ephemeral E2EE keys revoked.');
    }
    await loadMeshData();
  };

  const handleRunGeminiTriage = async (incident: Incident) => {
    setTriageLoading(true);
    setTriageNotice(null);
    try {
      const res = await fetch('/api/triage/assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incidentId: incident.id,
          triggerType: incident.trigger_type,
          hrBpm: incident.hr_bpm,
          spo2Pct: incident.spo2_pct,
          hrvRmssdMs: incident.hrv_rmssd_ms,
          crashGPeak: incident.crash_g_peak,
          canDeltaVKmh: incident.can_delta_v_kmh,
          rolloverDeg: incident.rollover_deg,
          bloodGroup: incident.victim_blood_group,
          allergies: incident.victim_allergies,
          responderTier: profile?.responder_tier || 'TIER_B_BLS',
        }),
      });
      const json = (await res.json()) as {
        configured: boolean;
        guidance: TriageGuidance | null;
        message?: string;
        error?: string;
      };

      if (!json.configured || !json.guidance) {
        setTriageNotice(json.message || json.error || 'Gemini AI Triage disabled.');
        return;
      }

      setTriageGuidance(json.guidance);
      const supabase = getSupabaseBrowserClient();
      if (supabase) {
        await supabase
          .from('incidents')
          .update({ triage_notes: json.guidance })
          .eq('id', incident.id);
      }
    } catch (err) {
      setTriageNotice(err instanceof Error ? err.message : 'Failed to request AI triage.');
    } finally {
      setTriageLoading(false);
    }
  };

  const handleDownloadCertificate = (incident: Incident) => {
    const payload = {
      certificateId: incident.good_samaritan_cert_id,
      statute: 'Section 134A, Motor Vehicles (Amendment) Act, 2019 & MoRTH Good Samaritan Rules 2020',
      indemnityCoverageInr: incident.indemnity_amount_inr,
      incidentId: incident.id,
      triggerType: incident.trigger_type,
      incidentLocation: { lat: incident.lat, lng: incident.lng, geohash: incident.geohash },
      responder: {
        id: profile?.id,
        name: incident.responder_name,
        tier: incident.responder_tier,
        credentialId: incident.responder_nmc_id,
      },
      timestamps: {
        incidentCreatedAt: incident.created_at,
        dispatchAcceptedAt: incident.accepted_at,
        enRouteAt: incident.en_route_at,
        stabilizedAt: incident.stabilized_at,
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${incident.good_samaritan_cert_id || 'good-samaritan-shield'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Filter active incoming alerts within 2km GeoHash radius when online GPS is available
  const activeAlerts = useMemo(() => {
    return incidents
      .filter((inc) => inc.status === 'ACTIVE')
      .map((inc) => {
        const distM = responderCoords
          ? haversineMeters(responderCoords.lat, responderCoords.lng, inc.lat, inc.lng)
          : null;
        return { incident: inc, distM };
      })
      .filter(({ distM }) => !radiusOnly2Km || distM === null || distM <= 2000)
      .sort((a, b) => (a.distM ?? 0) - (b.distM ?? 0));
  }, [incidents, responderCoords, radiusOnly2Km]);

  // Nearest PulseBox AED relative to assigned incident or responder
  const nearestAed = useMemo(() => {
    const refCoords = activeAssignedIncident
      ? { lat: activeAssignedIncident.lat, lng: activeAssignedIncident.lng }
      : responderCoords;
    if (!refCoords || pulseBoxes.length === 0) return null;

    let best: { node: HardwareNode; distanceM: number } | null = null;
    for (const pb of pulseBoxes) {
      const d = haversineMeters(refCoords.lat, refCoords.lng, pb.lat, pb.lng);
      if (!best || d < best.distanceM) {
        best = { node: pb, distanceM: d };
      }
    }
    return best;
  }, [activeAssignedIncident, responderCoords, pulseBoxes]);

  const mapMarkers: MapMarkerPoint[] = useMemo(() => {
    const list: MapMarkerPoint[] = [];
    if (responderCoords) {
      list.push({
        id: 'responder-self',
        lat: responderCoords.lat,
        lng: responderCoords.lng,
        kind: 'responder',
        title: `${profile?.full_name || 'Responder'} (You)`,
        subtitle: profile?.responder_tier || 'Verified Responder',
      });
    }
    for (const item of activeAlerts) {
      list.push({
        id: item.incident.id,
        lat: item.incident.lat,
        lng: item.incident.lng,
        kind: 'victim',
        title: `${item.incident.victim_name} (${item.incident.trigger_type})`,
        subtitle: item.distM !== null ? `${formatDistance(item.distM)} away` : 'Live SOS',
      });
    }
    if (activeAssignedIncident) {
      list.push({
        id: activeAssignedIncident.id,
        lat: activeAssignedIncident.lat,
        lng: activeAssignedIncident.lng,
        kind: 'victim',
        title: `Assigned: ${activeAssignedIncident.victim_name}`,
        subtitle: `${activeAssignedIncident.status} · ${activeAssignedIncident.victim_blood_group || 'Blood Group Unknown'}`,
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
  }, [responderCoords, profile, activeAlerts, activeAssignedIncident, pulseBoxes]);

  const mapCenter = activeAssignedIncident
    ? { lat: activeAssignedIncident.lat, lng: activeAssignedIncident.lng }
    : responderCoords
      ? { lat: responderCoords.lat, lng: responderCoords.lng }
      : { lat: 28.6139, lng: 77.209 };

  return (
    <div className="min-h-screen bg-[#05080F] text-slate-100">
      <AppNavbar profile={profile} />

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        {!loading && !profile && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-950/30 p-4 text-xs text-amber-100">
            <span>
              Authenticate as a Tier A (NMC/ABDM Doctor/Nurse) or Tier B (BLS Volunteer) responder
              to receive live Realtime Code Blue dispatches.
            </span>
            <Link
              href="/auth"
              className="rounded-lg bg-amber-600 px-3 py-1.5 font-semibold text-white hover:bg-amber-500"
            >
              Sign In / Register Responder
            </Link>
          </div>
        )}

        {/* Responder Status & Tier Bar */}
        <section className="rounded-2xl border border-slate-800 bg-[#0B1120] p-5">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
            <div>
              <div className="flex items-center gap-2 font-mono text-xs text-emerald-400">
                <Stethoscope className="h-4 w-4" />
                PORTAL B · NMC / ABDM VERIFIED DOCTOR &amp; BLS RESPONDER MESH
              </div>
              <h1 className="mt-1 text-xl font-extrabold text-white sm:text-2xl">
                {profile?.full_name || 'Responder Dispatch Console'}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-3 font-mono text-xs text-slate-400">
                <span>
                  Tier:{' '}
                  <strong className="text-emerald-300">
                    {profile?.responder_tier || 'Unassigned'}
                  </strong>
                </span>
                {profile?.nmc_registration_id && (
                  <span>NMC ID: {profile.nmc_registration_id}</span>
                )}
                {profile?.abdm_hpr_id && <span>ABDM HPR: {profile.abdm_hpr_id}</span>}
                {profile?.bls_certification_id && (
                  <span>BLS Cert: {profile.bls_certification_id}</span>
                )}
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5 text-cyan-400" />
                  {responderCoords
                    ? `${responderCoords.lat.toFixed(5)}, ${responderCoords.lng.toFixed(5)} · GeoHash ${responderCoords.geohash}`
                    : gpsError || (isOnline ? 'Streaming GPS...' : 'Toggle Online to stream GPS')}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => setRadiusOnly2Km((prev) => !prev)}
                className={`rounded-lg border px-3 py-2 font-mono text-xs font-semibold ${
                  radiusOnly2Km
                    ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200'
                    : 'border-slate-700 bg-slate-900 text-slate-300'
                }`}
              >
                {radiusOnly2Km ? 'Filter: ≤ 2 km GeoHash Radius' : 'Filter: All Active Alerts'}
              </button>

              <button
                type="button"
                disabled={!profile}
                onClick={handleToggleAvailability}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition disabled:opacity-50 ${
                  isOnline
                    ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-950/50 hover:bg-emerald-500'
                    : 'border border-slate-700 bg-slate-900 text-slate-200 hover:border-emerald-500/50'
                }`}
              >
                <Power className="h-4 w-4" />
                {isOnline ? 'ONLINE / AVAILABLE (GPS LIVE)' : 'GO ONLINE / AVAILABLE'}
              </button>
            </div>
          </div>

          {actionNotice && (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-950/30 p-3 text-xs text-emerald-200">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              <span>{actionNotice}</span>
            </div>
          )}
        </section>

        {/* Active Accepted Dispatch Panel + Good Samaritan Shield + Gemini Clinical Triage */}
        {activeAssignedIncident && (
          <section className="space-y-4 rounded-2xl border-2 border-emerald-500/60 bg-emerald-950/15 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="font-mono text-xs font-bold text-emerald-300">
                  ASSIGNED DISPATCH · STATUS: {activeAssignedIncident.status}
                </div>
                <h2 className="mt-1 text-xl font-bold text-white">
                  {activeAssignedIncident.victim_name} · {activeAssignedIncident.trigger_type}
                </h2>
                <div className="mt-2 flex flex-wrap gap-3 font-mono text-xs text-slate-300">
                  <span>
                    Blood Group:{' '}
                    <strong className="text-red-300">
                      {activeAssignedIncident.victim_blood_group || 'Unknown'}
                    </strong>
                  </span>
                  <span>
                    Allergies:{' '}
                    <strong className="text-amber-300">
                      {activeAssignedIncident.victim_allergies || 'None reported'}
                    </strong>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <HeartPulse className="h-3.5 w-3.5 text-red-400" />
                    HR {activeAssignedIncident.hr_bpm ?? '--'} BPM · SpO2{' '}
                    {activeAssignedIncident.spo2_pct ?? '--'}% · RMSSD{' '}
                    {activeAssignedIncident.hrv_rmssd_ms ?? '--'} ms
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {activeAssignedIncident.status === 'DISPATCHED' && (
                  <button
                    type="button"
                    onClick={() => handleTransitionStatus(activeAssignedIncident, 'EN_ROUTE')}
                    className="rounded-xl bg-cyan-600 px-4 py-2 text-xs font-bold text-white hover:bg-cyan-500"
                  >
                    Mark EN_ROUTE
                  </button>
                )}
                {['DISPATCHED', 'EN_ROUTE'].includes(activeAssignedIncident.status) && (
                  <button
                    type="button"
                    onClick={() => handleTransitionStatus(activeAssignedIncident, 'STABILIZED')}
                    className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500"
                  >
                    Mark STABILIZED
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleTransitionStatus(activeAssignedIncident, 'CLOSED')}
                  className="rounded-xl border border-slate-600 bg-slate-900 px-4 py-2 text-xs font-bold text-slate-200 hover:border-red-500/50 hover:text-red-200"
                >
                  Close &amp; Revoke Keys
                </button>
              </div>
            </div>

            {/* Statutory Good Samaritan Shield Certificate */}
            <div className="rounded-xl border border-emerald-500/30 bg-[#05080F] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Award className="h-5 w-5 text-amber-400" />
                  <div>
                    <div className="text-xs font-bold text-white">
                      Statutory Good Samaritan Shield Certificate
                    </div>
                    <div className="font-mono text-[11px] text-emerald-300">
                      {activeAssignedIncident.good_samaritan_cert_id} · Section 134A MV (Amendment)
                      Act 2019 · ₹10,00,000 Indemnity Active
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDownloadCertificate(activeAssignedIncident)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-emerald-400"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download Shield Log
                </button>
              </div>
            </div>

            {/* Nearest PulseBox AED */}
            {nearestAed && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cyan-500/30 bg-cyan-950/20 p-3.5 text-xs">
                <div>
                  <span className="font-mono font-bold text-cyan-300">NEAREST PULSEBOX AED: </span>
                  <span className="font-semibold text-white">{nearestAed.node.label}</span>
                  <span className="ml-2 font-mono text-slate-300">
                    ({formatDistance(nearestAed.distanceM)} · Sprint{' '}
                    {formatEta(estimateEtaSeconds(nearestAed.distanceM))})
                  </span>
                </div>
                <span className="font-mono text-emerald-300">
                  AED Status: {nearestAed.node.aed_status || 'READY'}
                </span>
              </div>
            )}

            {/* Optional Gemini Live Clinical Triage Protocol Panel */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-bold text-cyan-300">
                  <BrainCircuit className="h-4 w-4" />
                  Gemini Live Clinical Triage Protocol (Tailored to Victim Vitals &amp; Allergies)
                </div>
                <button
                  type="button"
                  disabled={triageLoading}
                  onClick={() => handleRunGeminiTriage(activeAssignedIncident)}
                  className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
                >
                  {triageLoading ? 'Synthesizing Protocol...' : 'Generate AHA Triage Protocol'}
                </button>
              </div>

              {triageNotice && (
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-950/30 p-2.5 text-xs text-amber-200">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                  <span>{triageNotice}</span>
                </div>
              )}

              {displayedTriageGuidance && (
                <div className="mt-3 space-y-3 border-t border-slate-800 pt-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="rounded bg-red-500/20 px-2 py-0.5 font-mono font-bold text-red-300">
                      URGENCY: {displayedTriageGuidance.urgencyLevel}
                    </span>
                    <span className="font-mono text-[11px] text-slate-400">
                      {displayedTriageGuidance.model} · {displayedTriageGuidance.generatedAt}
                    </span>
                  </div>
                  <p className="font-semibold text-white">
                    {displayedTriageGuidance.suspectedCondition}
                  </p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="rounded-lg border border-slate-800 bg-[#05080F] p-3">
                      <div className="font-mono text-[10px] font-bold text-emerald-400">
                        IMMEDIATE ACTIONS
                      </div>
                      <ul className="mt-1.5 list-disc space-y-1 pl-4 text-slate-200">
                        {displayedTriageGuidance.immediateActions.map((act, i) => (
                          <li key={i}>{act}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-[#05080F] p-3">
                      <div className="font-mono text-[10px] font-bold text-amber-400">
                        ALLERGY &amp; SCOPE CONTRAINDICATIONS
                      </div>
                      <ul className="mt-1.5 list-disc space-y-1 pl-4 text-amber-100">
                        {displayedTriageGuidance.contraindications.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  <div className="rounded-lg border border-cyan-500/30 bg-cyan-950/20 p-3 text-cyan-100">
                    <strong>CPR / Shock Protocol:</strong> {displayedTriageGuidance.cprOrShockProtocol}
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-[#05080F] p-3 text-slate-300">
                    <strong>108 EMS SBAR Handover:</strong> {displayedTriageGuidance.handoverSummary108}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Incoming 2km GeoHash Code Blue Alerts + Live Map */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <section className="space-y-3 rounded-2xl border border-slate-800 bg-[#0B1120] p-5 lg:col-span-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-mono text-xs font-bold text-red-400">
                <Siren className="h-4 w-4" />
                LIVE REALTIME CODE BLUE QUEUE ({activeAlerts.length})
              </div>
              <span className="font-mono text-[10px] text-slate-400">Supabase Realtime</span>
            </div>

            {activeAlerts.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-800 bg-slate-950/50 p-6 text-center text-xs text-slate-400">
                No unaccepted Code Blue emergencies currently active
                {radiusOnly2Km && responderCoords ? ' within your 2 km GeoHash radius.' : '.'}
              </div>
            ) : (
              activeAlerts.map(({ incident, distM }) => (
                <div
                  key={incident.id}
                  className="rounded-xl border border-red-500/40 bg-red-950/20 p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="rounded bg-red-600 px-2 py-0.5 font-mono text-[10px] font-bold text-white">
                        {incident.trigger_type}
                      </span>
                      <h3 className="mt-1.5 text-sm font-bold text-white">{incident.victim_name}</h3>
                    </div>
                    {distM !== null && (
                      <div className="text-right font-mono text-xs text-emerald-300">
                        <div>{formatDistance(distM)}</div>
                        <div className="text-[10px] text-slate-400">
                          ETA {formatEta(estimateEtaSeconds(distM))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-1.5 font-mono text-[11px] text-slate-300">
                    <span>GeoHash: {incident.geohash}</span>
                    <span>Blood: {incident.victim_blood_group || 'Unknown'}</span>
                    <span>HR: {incident.hr_bpm ?? '--'} BPM</span>
                    <span>RMSSD: {incident.hrv_rmssd_ms ?? '--'} ms</span>
                  </div>

                  <button
                    type="button"
                    disabled={Boolean(activeAssignedIncident) || !profile}
                    onClick={() => handleAcceptDispatch(incident)}
                    className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    <ShieldCheck className="h-4 w-4" />
                    Accept Dispatch (Issue Section 134A Shield)
                  </button>
                </div>
              ))
            )}
          </section>

          <section className="rounded-2xl border border-slate-800 bg-[#0B1120] p-5 lg:col-span-7">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <Navigation className="h-4 w-4 text-cyan-400" />
                Live Responder Tactical Map &amp; PulseBox AEDs
              </div>
              <span className="font-mono text-[11px] text-slate-400">
                AED Nodes: {pulseBoxes.length}
              </span>
            </div>
            <LiveMapClient
              center={mapCenter}
              markers={mapMarkers}
              radiusCircle={
                responderCoords
                  ? { lat: responderCoords.lat, lng: responderCoords.lng, radiusMeters: 2000 }
                  : null
              }
              routeLine={
                activeAssignedIncident && responderCoords
                  ? [
                      [responderCoords.lat, responderCoords.lng],
                      [activeAssignedIncident.lat, activeAssignedIncident.lng],
                    ]
                  : null
              }
              heightClassName="h-[440px]"
            />
          </section>
        </div>
      </main>
    </div>
  );
}
