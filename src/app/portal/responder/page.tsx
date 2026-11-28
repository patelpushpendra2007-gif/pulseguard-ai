'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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
  Volume2,
  VolumeX,
} from 'lucide-react';
import AppNavbar from '@/components/AppNavbar';
import EmergencyTriageCard from '@/components/EmergencyTriageCard';
import IncidentStatusStepper from '@/components/IncidentStatusStepper';
import LiveMapClient from '@/components/LiveMapClient';
import type { MapMarkerPoint } from '@/components/LiveIncidentMap';
import { usePortalAccess } from '@/hooks/useSupabaseProfile';
import { useDrivingRoute } from '@/hooks/useDrivingRoute';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  encodeGeoHash,
  estimateEtaSeconds,
  formatDistance,
  formatEta,
  haversineMeters,
} from '@/lib/geohash';
import type { HardwareNode, Incident, IncidentStatus, TriageGuidance } from '@/types/pulseguard';

export default function ResponderPortalPage() {
  const { loading, profile, session, refreshProfile, authorized } = usePortalAccess('responder');

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
  const [recentlyClosedIncident, setRecentlyClosedIncident] = useState<Incident | null>(null);
  const [pulseBoxes, setPulseBoxes] = useState<HardwareNode[]>([]);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Gemini Clinical Triage State
  const [triageLoading, setTriageLoading] = useState(false);
  const [triageNotice, setTriageNotice] = useState<string | null>(null);
  const [triageGuidance, setTriageGuidance] = useState<TriageGuidance | null>(null);

  const knownIncidentIdsRef = useRef<Set<string>>(new Set());
  const hasLoadedIncidentSnapshotRef = useRef(false);
  const alertAudioContextRef = useRef<AudioContext | null>(null);
  const [alertsMuted, setAlertsMuted] = useState(false);

  const getAlertAudioContext = useCallback((): AudioContext | null => {
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    try {
      if (!alertAudioContextRef.current || alertAudioContextRef.current.state === 'closed') {
        alertAudioContextRef.current = new AudioCtx();
      }
      return alertAudioContextRef.current;
    } catch {
      return null;
    }
  }, []);

  const playAlertChime = useCallback(() => {
    if (alertsMuted) return;
    const context = getAlertAudioContext();
    if (!context) return;
    if (context.state === 'suspended') void context.resume().catch(() => undefined);

    [880, 1174.66, 1568].forEach((frequency, index) => {
      const startAt = context.currentTime + index * 0.2;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, startAt);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.14, startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.18);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + 0.19);
    });
  }, [alertsMuted, getAlertAudioContext]);

  useEffect(
    () => () => {
      const context = alertAudioContextRef.current;
      if (context && context.state !== 'closed') void context.close();
    },
    []
  );

  const loadMeshData = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !profile) return;

    const [{ data: incData }, { data: pbData }, { data: closedData }] = await Promise.all([
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
      supabase
        .from('incidents')
        .select('*')
        .eq('responder_id', profile.id)
        .eq('status', 'CLOSED')
        .order('closed_at', { ascending: false })
        .limit(1),
    ]);

    const rows = (incData as Incident[]) || [];
    if (!hasLoadedIncidentSnapshotRef.current) {
      rows
        .filter((incident) => incident.status === 'ACTIVE')
        .forEach((incident) => knownIncidentIdsRef.current.add(incident.id));
      hasLoadedIncidentSnapshotRef.current = true;
    } else {
      for (const incident of rows) {
        if (incident.status === 'ACTIVE' && !knownIncidentIdsRef.current.has(incident.id)) {
          knownIncidentIdsRef.current.add(incident.id);
          playAlertChime();
        }
      }
    }
    setIncidents(rows);
    setRecentlyClosedIncident((closedData?.[0] as Incident | undefined) ?? null);
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

  useEffect(() => {
    if (!profile) return;
    const pollId = window.setInterval(() => {
      void loadMeshData();
    }, 3000);
    return () => window.clearInterval(pollId);
  }, [loadMeshData, profile]);

  const activeAssignedIncident = useMemo(
    () =>
      incidents.find(
        (inc) =>
          inc.responder_id === profile?.id &&
          ['DISPATCHED', 'EN_ROUTE', 'STABILIZED'].includes(inc.status)
      ) ?? null,
    [incidents, profile]
  );

  const assignedResponderOrigin =
    responderCoords ??
    (activeAssignedIncident?.responder_lat != null &&
    activeAssignedIncident.responder_lng != null
      ? {
          lat: activeAssignedIncident.responder_lat,
          lng: activeAssignedIncident.responder_lng,
        }
      : null);
  const drivingRoute = useDrivingRoute(
    activeAssignedIncident ? assignedResponderOrigin : null,
    activeAssignedIncident
      ? { lat: activeAssignedIncident.lat, lng: activeAssignedIncident.lng }
      : null,
    Boolean(activeAssignedIncident && assignedResponderOrigin && activeAssignedIncident.accepted_at)
  );
  const assignedDistanceM =
    drivingRoute.route?.distanceMeters ??
    (activeAssignedIncident && assignedResponderOrigin
      ? haversineMeters(
          assignedResponderOrigin.lat,
          assignedResponderOrigin.lng,
          activeAssignedIncident.lat,
          activeAssignedIncident.lng
        )
      : null);
  const assignedEtaSeconds =
    drivingRoute.route?.durationSeconds ??
    (assignedDistanceM !== null ? estimateEtaSeconds(assignedDistanceM) : null);

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
    const credentialId =
      profile.responder_tier === 'TIER_A_NMC'
        ? profile.nmc_registration_id
        : profile.responder_tier === 'TIER_B_BLS'
          ? profile.bls_certification_id
          : null;
    if (!profile.responder_tier || !credentialId) {
      setActionNotice('A responder tier and credential ID are required before accepting dispatches.');
      return;
    }

    const { error } = await supabase
      .from('incidents')
      .update({
        status: 'DISPATCHED',
        responder_id: profile.id,
        responder_name: profile.full_name,
        responder_tier: profile.responder_tier,
        responder_credential_id: credentialId,
        responder_lat: responderCoords?.lat ?? profile.current_lat,
        responder_lng: responderCoords?.lng ?? profile.current_lng,
        responder_updated_at: nowIso,
        accepted_at: nowIso,
      })
      .eq('id', incident.id)
      .eq('status', 'ACTIVE')
      .is('responder_id', null);

    if (error) {
      setActionNotice(`Unable to claim dispatch: ${error.message}`);
      return;
    }

    setActionNotice(
      'Dispatch accepted and assigned to your responder account.'
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
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ incidentId: incident.id }),
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

  const handleDownloadIncidentReport = (incident: Incident) => {
    const payload = {
      reportType: 'incident_handover',
      incidentId: incident.id,
      triggerType: incident.trigger_type,
      incidentLocation: { lat: incident.lat, lng: incident.lng, geohash: incident.geohash },
      responder: {
        id: profile?.id,
        name: incident.responder_name,
        tier: incident.responder_tier,
        credentialId: incident.responder_credential_id,
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
    a.download = `pulseguard-incident-${incident.id}.json`;
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

  const emergencyTriageIncident = activeAssignedIncident ?? activeAlerts[0]?.incident ?? null;
  const stepperIncident =
    activeAssignedIncident ?? activeAlerts[0]?.incident ?? recentlyClosedIncident;

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
        subtitle: `PulseBox AED (${pb.aed_status || 'N/A'})`,
      });
    }
    return list;
  }, [responderCoords, profile, activeAlerts, activeAssignedIncident, pulseBoxes]);

  const mapCenter = activeAssignedIncident
    ? { lat: activeAssignedIncident.lat, lng: activeAssignedIncident.lng }
    : responderCoords
      ? { lat: responderCoords.lat, lng: responderCoords.lng }
      : mapMarkers[0]
        ? { lat: mapMarkers[0].lat, lng: mapMarkers[0].lng }
        : null;

  if (!authorized) {
    return (
      <div className="min-h-screen bg-[#05080F] p-8 text-center text-sm text-slate-300">
        {loading ? 'Loading your account...' : 'Redirecting to your assigned portal...'}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#05080F] text-slate-100">
      <AppNavbar profile={profile} />

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        {/* Responder Status & Tier Bar */}
        <section className="rounded-2xl border border-slate-800 bg-[#0B1120] p-5">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
            <div>
              <div className="flex items-center gap-2 font-mono text-xs text-emerald-400">
                <Stethoscope className="h-4 w-4" />
                PORTAL B · NMC / NMR TIER A &amp; BLS TIER B RESPONDER MESH
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
                aria-pressed={alertsMuted}
                onClick={() => {
                  if (alertsMuted) {
                    const context = getAlertAudioContext();
                    if (context?.state === 'suspended') {
                      void context.resume().catch(() => undefined);
                    }
                  }
                  setAlertsMuted((muted) => !muted);
                }}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 font-mono text-xs font-semibold ${
                  alertsMuted
                    ? 'border-slate-700 bg-slate-900 text-slate-300'
                    : 'border-amber-500/50 bg-amber-500/10 text-amber-200'
                }`}
              >
                {alertsMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                Alert audio {alertsMuted ? 'muted' : 'on'}
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

        {stepperIncident && <IncidentStatusStepper incident={stepperIncident} />}

        {/* Active dispatch and clinical triage panel */}
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
                      {activeAssignedIncident.victim_allergies || 'Not provided'}
                    </strong>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <HeartPulse className="h-3.5 w-3.5 text-red-400" />
                    HR {activeAssignedIncident.hr_bpm ?? '--'} BPM · SpO2{' '}
                    {activeAssignedIncident.spo2_pct ?? '--'}% · RMSSD{' '}
                    {activeAssignedIncident.hrv_rmssd_ms ?? '--'} ms
                  </span>
                </div>
                {assignedDistanceM !== null && assignedEtaSeconds !== null && (
                  <div className="mt-2 inline-flex items-center gap-1.5 font-mono text-xs text-blue-200">
                    <Navigation className="h-3.5 w-3.5" />
                    {formatEta(assignedEtaSeconds)} • {formatDistance(assignedDistanceM)} away
                    {drivingRoute.route ? ' by road' : ' approx.'}
                  </div>
                )}
                {drivingRoute.loading && (
                  <p className="mt-1 text-[11px] text-slate-400">Refreshing driving route…</p>
                )}
                {drivingRoute.error && (
                  <p className="mt-1 text-[11px] text-amber-300">{drivingRoute.error}</p>
                )}
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

            {/* Incident handover record */}
            <div className="rounded-xl border border-emerald-500/30 bg-[#05080F] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs font-bold text-white">Incident handover record</div>
                <button
                  type="button"
                  onClick={() => handleDownloadIncidentReport(activeAssignedIncident)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-emerald-400"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download Report
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
                  AED Status: {nearestAed.node.aed_status || 'N/A'}
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

        {emergencyTriageIncident && (
          <EmergencyTriageCard
            incidentId={emergencyTriageIncident.id}
            accessToken={session?.access_token ?? null}
            incidentType={emergencyTriageIncident.trigger_type}
            heartRate={emergencyTriageIncident.hr_bpm}
            bloodGroup={emergencyTriageIncident.victim_blood_group}
            allergies={emergencyTriageIncident.victim_allergies}
          />
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
                    Accept Dispatch
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
              routeLine={drivingRoute.route?.coordinates ?? null}
              heightClassName="h-[440px]"
            />
          </section>
        </div>
      </main>
    </div>
  );
}
