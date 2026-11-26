'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  CheckCircle2,
  Clock,
  Lock,
  LockOpen,
  RadioTower,
  ShieldAlert,
} from 'lucide-react';
import AppNavbar from '@/components/AppNavbar';
import LiveMapClient from '@/components/LiveMapClient';
import type { MapMarkerPoint } from '@/components/LiveIncidentMap';
import { useSupabaseProfile } from '@/hooks/useSupabaseProfile';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  estimateEtaSeconds,
  formatDistance,
  formatEta,
  haversineMeters,
} from '@/lib/geohash';
import type { HardwareNode, Incident, IncidentStatus, Profile } from '@/types/pulseguard';

const STATUS_BADGE: Record<IncidentStatus, string> = {
  ACTIVE: 'border-red-500/50 bg-red-500/20 text-red-300',
  DISPATCHED: 'border-amber-500/50 bg-amber-500/20 text-amber-200',
  EN_ROUTE: 'border-cyan-500/50 bg-cyan-500/20 text-cyan-200',
  STABILIZED: 'border-emerald-500/50 bg-emerald-500/20 text-emerald-200',
  CLOSED: 'border-slate-700 bg-slate-800 text-slate-400',
};

const NEXT_STATUS_OPTIONS: Record<IncidentStatus, IncidentStatus[]> = {
  ACTIVE: ['DISPATCHED', 'EN_ROUTE', 'STABILIZED', 'CLOSED'],
  DISPATCHED: ['EN_ROUTE', 'STABILIZED', 'CLOSED'],
  EN_ROUTE: ['STABILIZED', 'CLOSED'],
  STABILIZED: ['CLOSED'],
  CLOSED: [],
};

export default function CommandDeskPortalPage() {
  const { loading, profile } = useSupabaseProfile();

  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [responders, setResponders] = useState<Profile[]>([]);
  const [hardwareNodes, setHardwareNodes] = useState<HardwareNode[]>([]);
  const [statusFilter, setStatusFilter] = useState<'ALL' | IncidentStatus>('ALL');
  const [commandError, setCommandError] = useState<string | null>(null);

  const loadCommandFeed = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !profile) return;

    const [{ data: incRows, error: incErr }, { data: respRows }, { data: nodeRows }] =
      await Promise.all([
        supabase.from('incidents').select('*').order('created_at', { ascending: false }).limit(100),
        supabase
          .from('profiles')
          .select('*')
          .eq('role', 'responder')
          .eq('is_available', true),
        supabase.from('hardware_nodes').select('*'),
      ]);

    if (incErr) {
      setCommandError(incErr.message);
      return;
    }

    setCommandError(null);
    setIncidents((incRows as Incident[]) || []);
    setResponders((respRows as Profile[]) || []);
    setHardwareNodes((nodeRows as HardwareNode[]) || []);
  }, [profile]);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadCommandFeed();
    }, 0);
    return () => clearTimeout(t);
  }, [loadCommandFeed]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !profile) return;

    const channel = supabase
      .channel('command-desk-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'incidents' }, loadCommandFeed)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, loadCommandFeed)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile, loadCommandFeed]);

  const handleLifecycleTransition = async (incident: Incident, targetStatus: IncidentStatus) => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    const nowIso = new Date().toISOString();
    const updates: Record<string, unknown> = { status: targetStatus };
    if (targetStatus === 'DISPATCHED' && !incident.accepted_at) updates.accepted_at = nowIso;
    if (targetStatus === 'EN_ROUTE') updates.en_route_at = nowIso;
    if (targetStatus === 'STABILIZED') updates.stabilized_at = nowIso;
    if (targetStatus === 'CLOSED') {
      updates.closed_at = nowIso;
      updates.ephemeral_key_revoked = true;
      updates.ephemeral_key_revoked_at = nowIso;
    }

    const { error } = await supabase.from('incidents').update(updates).eq('id', incident.id);
    if (error) {
      setCommandError(error.message);
    } else {
      await loadCommandFeed();
    }
  };

  const filteredIncidents = useMemo(
    () =>
      statusFilter === 'ALL'
        ? incidents
        : incidents.filter((inc) => inc.status === statusFilter),
    [incidents, statusFilter]
  );

  // GeoHash cluster summary derived strictly from real DB incidents
  const geohashClusters = useMemo(() => {
    const counts = new Map<string, { geohash: string; active: number; total: number }>();
    for (const inc of incidents) {
      const prefix6 = inc.geohash.slice(0, 6);
      const cur = counts.get(prefix6) || { geohash: prefix6, active: 0, total: 0 };
      cur.total++;
      if (inc.status !== 'CLOSED') cur.active++;
      counts.set(prefix6, cur);
    }
    return Array.from(counts.values()).sort((a, b) => b.active - a.active);
  }, [incidents]);

  // Real Audit Log derived directly from PostgreSQL incident timestamps & hardware pings
  const auditEvents = useMemo(() => {
    const entries: Array<{ ts: string; tag: string; detail: string }> = [];
    for (const inc of incidents.slice(0, 20)) {
      entries.push({
        ts: inc.created_at,
        tag: inc.trigger_type,
        detail: `${inc.victim_name} @ ${inc.geohash} · SHA256:${inc.payload_sha256.slice(0, 12)}`,
      });
      if (inc.accepted_at) {
        entries.push({
          ts: inc.accepted_at,
          tag: 'DISPATCHED',
          detail: `Accepted by ${inc.responder_name || 'Responder'} (${inc.good_samaritan_cert_id || '134A'})`,
        });
      }
      if (inc.en_route_at) {
        entries.push({
          ts: inc.en_route_at,
          tag: 'EN_ROUTE',
          detail: `Responder en route to ${inc.victim_name}`,
        });
      }
      if (inc.stabilized_at) {
        entries.push({
          ts: inc.stabilized_at,
          tag: 'STABILIZED',
          detail: `Patient stabilized (${inc.victim_name})`,
        });
      }
      if (inc.closed_at) {
        entries.push({
          ts: inc.closed_at,
          tag: 'KEYS_REVOKED',
          detail: `Incident closed; ephemeral ECDH P-256 keys shredded`,
        });
      }
    }
    for (const node of hardwareNodes) {
      if (node.last_ping_at) {
        entries.push({
          ts: node.last_ping_at,
          tag: `IOT_${node.node_type}`,
          detail: `${node.device_uid} (${node.status}) @ ${node.geohash}`,
        });
      }
    }
    return entries.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()).slice(0, 25);
  }, [incidents, hardwareNodes]);

  const mapMarkers: MapMarkerPoint[] = useMemo(() => {
    const pts: MapMarkerPoint[] = [];
    for (const inc of filteredIncidents) {
      if (inc.status === 'CLOSED') continue;
      pts.push({
        id: `inc-${inc.id}`,
        lat: inc.lat,
        lng: inc.lng,
        kind: 'victim',
        title: `${inc.victim_name} · ${inc.status}`,
        subtitle: `${inc.trigger_type} · ${inc.geohash}`,
      });
      if (inc.responder_lat != null && inc.responder_lng != null) {
        pts.push({
          id: `inc-resp-${inc.id}`,
          lat: inc.responder_lat,
          lng: inc.responder_lng,
          kind: 'responder',
          title: inc.responder_name || 'Assigned Responder',
          subtitle: `En route to ${inc.victim_name}`,
        });
      }
    }
    for (const resp of responders) {
      if (resp.current_lat != null && resp.current_lng != null) {
        pts.push({
          id: `resp-${resp.id}`,
          lat: resp.current_lat,
          lng: resp.current_lng,
          kind: 'responder',
          title: resp.full_name,
          subtitle: `${resp.responder_tier || 'Responder'} · Available`,
        });
      }
    }
    for (const node of hardwareNodes) {
      pts.push({
        id: `node-${node.id}`,
        lat: node.lat,
        lng: node.lng,
        kind: node.node_type === 'PULSEBOX_AED' ? 'aed' : 'obd',
        title: node.label,
        subtitle: `${node.device_uid} (${node.status})`,
      });
    }
    return pts;
  }, [filteredIncidents, responders, hardwareNodes]);

  const activeCells = useMemo(
    () =>
      Array.from(
        new Set(incidents.filter((i) => i.status !== 'CLOSED').map((i) => i.geohash))
      ),
    [incidents]
  );

  const firstPin = mapMarkers[0];
  const mapCenter = firstPin
    ? { lat: firstPin.lat, lng: firstPin.lng }
    : { lat: 28.6139, lng: 77.209 };

  return (
    <div className="min-h-screen bg-[#05080F] text-slate-100">
      <AppNavbar profile={profile} />

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        {!loading && !profile && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-500/40 bg-cyan-950/30 p-4 text-xs text-cyan-100">
            <span>
              Sign in with a <strong>dispatcher</strong> or <strong>admin</strong> role to inspect
              all citywide incidents and execute 112 lifecycle transitions.
            </span>
            <Link
              href="/auth"
              className="rounded-lg bg-cyan-600 px-3 py-1.5 font-semibold text-white hover:bg-cyan-500"
            >
              Sign In
            </Link>
          </div>
        )}

        {/* Header & Live Counts */}
        <section className="rounded-2xl border border-slate-800 bg-[#0B1120] p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 font-mono text-xs text-cyan-400">
                <RadioTower className="h-4 w-4" />
                PORTAL C · SMART CITY POLICE 112 &amp; TRIAGE COMMAND DESK
              </div>
              <h1 className="mt-1 text-xl font-extrabold text-white sm:text-2xl">
                Real-Time Emergency Command Map &amp; Encrypted Payload Desk
              </h1>
            </div>

            <div className="flex flex-wrap gap-2 font-mono text-xs">
              <div className="rounded-xl border border-red-500/40 bg-red-950/30 px-3 py-2">
                <span className="text-slate-400">OPEN: </span>
                <strong className="text-red-300">
                  {incidents.filter((i) => i.status !== 'CLOSED').length}
                </strong>
              </div>
              <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/30 px-3 py-2">
                <span className="text-slate-400">ONLINE MESH: </span>
                <strong className="text-emerald-300">{responders.length}</strong>
              </div>
              <div className="rounded-xl border border-cyan-500/40 bg-cyan-950/30 px-3 py-2">
                <span className="text-slate-400">IOT NODES: </span>
                <strong className="text-cyan-300">{hardwareNodes.length}</strong>
              </div>
            </div>
          </div>

          {commandError && (
            <div className="mt-3 rounded-lg border border-red-500/40 bg-red-950/30 p-3 text-xs text-red-200">
              {commandError}
            </div>
          )}
        </section>

        {/* Live Map & GeoHash Clusters */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <section className="rounded-2xl border border-slate-800 bg-[#0B1120] p-5 lg:col-span-8">
            <h2 className="mb-3 text-sm font-bold text-white">
              Live Emergency &amp; Responder GeoHash Tactical Map
            </h2>
            <LiveMapClient
              center={mapCenter}
              markers={mapMarkers}
              geohashCells={activeCells}
              heightClassName="h-[420px]"
            />
          </section>

          <section className="space-y-4 rounded-2xl border border-slate-800 bg-[#0B1120] p-5 lg:col-span-4">
            <div className="flex items-center gap-2 font-mono text-xs font-bold text-cyan-300">
              <Activity className="h-4 w-4" />
              GEOHASH CLUSTERS (PRECISION 6)
            </div>
            {geohashClusters.length === 0 ? (
              <p className="text-xs text-slate-400">No incident clusters recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {geohashClusters.map((c) => (
                  <div
                    key={c.geohash}
                    className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2 font-mono text-xs"
                  >
                    <span className="text-cyan-300">{c.geohash}</span>
                    <span>
                      <strong className="text-red-300">{c.active} active</strong> / {c.total} total
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="border-t border-slate-800 pt-3">
              <div className="flex items-center gap-2 font-mono text-xs font-bold text-slate-300">
                <Clock className="h-4 w-4 text-amber-400" />
                LIVE TELEMETRY AUDIT TRAIL
              </div>
              <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1 font-mono text-[11px]">
                {auditEvents.length === 0 ? (
                  <p className="text-slate-500">Awaiting real telemetry events...</p>
                ) : (
                  auditEvents.map((ev, i) => (
                    <div
                      key={`${ev.ts}-${i}`}
                      className="rounded border border-slate-800/80 bg-[#05080F] p-2"
                    >
                      <div className="flex items-center justify-between text-[10px] text-slate-400">
                        <span className="text-cyan-300">{ev.tag}</span>
                        <span>{new Date(ev.ts).toLocaleTimeString()}</span>
                      </div>
                      <div className="mt-0.5 text-slate-200">{ev.detail}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        </div>

        {/* Incident Lifecycle & Payload Verification Table */}
        <section className="rounded-2xl border border-slate-800 bg-[#0B1120] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-base font-bold text-white">
              <ShieldAlert className="h-4 w-4 text-red-400" />
              Incident Lifecycle &amp; E2EE Verification Ledger
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {(['ALL', 'ACTIVE', 'DISPATCHED', 'EN_ROUTE', 'STABILIZED', 'CLOSED'] as const).map(
                (st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStatusFilter(st)}
                    className={`rounded-lg border px-2.5 py-1 font-mono text-[11px] font-semibold ${
                      statusFilter === st
                        ? 'border-cyan-500 bg-cyan-500/20 text-cyan-200'
                        : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {st}
                  </button>
                )
              )}
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {filteredIncidents.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-800 p-6 text-center text-xs text-slate-400">
                No incidents match the selected filter.
              </div>
            ) : (
              filteredIncidents.map((inc) => {
                const respDistM =
                  inc.responder_lat != null && inc.responder_lng != null
                    ? haversineMeters(inc.lat, inc.lng, inc.responder_lat, inc.responder_lng)
                    : null;

                return (
                  <div
                    key={inc.id}
                    className="rounded-xl border border-slate-800 bg-slate-950/80 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded border px-2 py-0.5 font-mono text-[10px] font-bold ${STATUS_BADGE[inc.status]}`}
                          >
                            {inc.status}
                          </span>
                          <span className="font-mono text-xs font-bold text-white">
                            {inc.victim_name}
                          </span>
                          <span className="font-mono text-[11px] text-red-300">
                            {inc.trigger_type}
                          </span>
                          <span className="font-mono text-[11px] text-slate-400">
                            {new Date(inc.created_at).toLocaleString()}
                          </span>
                        </div>

                        <div className="mt-2 flex flex-wrap gap-3 font-mono text-[11px] text-slate-300">
                          <span>
                            GPS: {inc.lat.toFixed(5)}, {inc.lng.toFixed(5)} ({inc.geohash})
                          </span>
                          <span>
                            Vitals: HR {inc.hr_bpm ?? '--'} · SpO2 {inc.spo2_pct ?? '--'}% · RMSSD{' '}
                            {inc.hrv_rmssd_ms ?? '--'}ms
                          </span>
                          {inc.responder_name && (
                            <span className="text-emerald-300">
                              Responder: {inc.responder_name}
                              {respDistM !== null
                                ? ` · ${formatDistance(respDistM)} (ETA ${formatEta(
                                    estimateEtaSeconds(respDistM)
                                  )})`
                                : ''}
                            </span>
                          )}
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-3 font-mono text-[11px]">
                          <span
                            className={`inline-flex items-center gap-1 ${
                              inc.ephemeral_key_revoked ? 'text-slate-400' : 'text-emerald-400'
                            }`}
                          >
                            {inc.ephemeral_key_revoked ? (
                              <Lock className="h-3 w-3" />
                            ) : (
                              <LockOpen className="h-3 w-3" />
                            )}
                            {inc.ephemeral_key_revoked
                              ? `Keys Revoked (${inc.ephemeral_key_revoked_at ? new Date(inc.ephemeral_key_revoked_at).toLocaleTimeString() : 'Closed'})`
                              : 'Ephemeral ECDH Active'}
                          </span>
                          <span className="text-cyan-300">
                            52B Frame: {inc.sms_frame_52b_b64.slice(0, 20)}... ({inc.sms_frame_52b_b64.length} chars)
                          </span>
                          <span className="inline-flex items-center gap-1 text-slate-400">
                            <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                            SHA256: {inc.payload_sha256.slice(0, 16)}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {NEXT_STATUS_OPTIONS[inc.status].map((nextSt) => (
                          <button
                            key={nextSt}
                            type="button"
                            onClick={() => handleLifecycleTransition(inc, nextSt)}
                            className={`rounded-lg border px-2.5 py-1 font-mono text-[11px] font-semibold ${
                              nextSt === 'CLOSED'
                                ? 'border-red-500/40 bg-red-500/15 text-red-200 hover:bg-red-500/25'
                                : 'border-cyan-500/40 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25'
                            }`}
                          >
                            → {nextSt}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
