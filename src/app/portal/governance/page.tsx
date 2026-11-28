'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Cpu,
  Download,
  FileCheck2,
  MapPin,
  PlusCircle,
  ShieldAlert,
  Trash2,
  Webhook,
} from 'lucide-react';
import AppNavbar from '@/components/AppNavbar';
import { usePortalAccess } from '@/hooks/useSupabaseProfile';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { encodeGeoHash } from '@/lib/geohash';
import { clearOfflineOutbox } from '@/lib/offline/outbox';
import type {
  ConsentScope,
  DpdpConsentLog,
  HardwareNode,
  HardwareNodeType,
} from '@/types/pulseguard';

const CONSENT_SCOPES: Array<{ scope: ConsentScope; label: string; purpose: string }> = [
  {
    scope: 'BIOMETRIC_PPG_PROCESSING',
    label: 'Biometric PPG & HRV Processing',
    purpose: 'On-device heart rate and RMSSD computation for autonomous distress detection.',
  },
  {
    scope: 'VOICE_RAM_SAFEWORD',
    label: 'Volatile RAM Audio SafeWord',
    purpose: 'In-memory 2.5s ring buffer speech/MFCC detection with 0 bytes stored or uploaded.',
  },
  {
    scope: 'EMERGENCY_LOCATION_SHARING',
    label: 'Emergency GPS & GeoHash Sharing',
    purpose: 'Transmitting precision-7 GeoHash and live GPS coordinates during Code Blue SOS.',
  },
  {
    scope: 'MEDICAL_PROFILE_DISPATCH',
    label: 'Clinical Blood Group & Allergy Dispatch',
    purpose: 'Sharing E2EE emergency medical fields with assigned NMC/BLS responders & 112.',
  },
  {
    scope: 'HARDWARE_TELEMETRY_INGEST',
    label: 'OBD-II & PulseBox IoT Telemetry',
    purpose: 'Ingesting crash physics G-force, CAN Δv, and AED cabinet status webhooks.',
  },
];

export default function GovernancePortalPage() {
  const { loading, profile, refreshProfile, authorized } = usePortalAccess('admin');

  const [nodes, setNodes] = useState<HardwareNode[]>([]);
  const [consentLogs, setConsentLogs] = useState<DpdpConsentLog[]>([]);

  // Register Hardware Node State
  const [deviceUid, setDeviceUid] = useState('');
  const [nodeType, setNodeType] = useState<HardwareNodeType>('OBD_II_PRO');
  const [label, setLabel] = useState('');
  const [firmwareVersion, setFirmwareVersion] = useState('');
  const [latInput, setLatInput] = useState('');
  const [lngInput, setLngInput] = useState('');
  const [submittingNode, setSubmittingNode] = useState(false);

  const [notice, setNotice] = useState<string | null>(null);
  const loadGovernanceData = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !profile) return;

    const [{ data: nodeRows, error: nodeError }, { data: logRows, error: logError }] = await Promise.all([
      supabase.from('hardware_nodes').select('*').order('created_at', { ascending: false }),
      supabase
        .from('dpdp_consent_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    if (nodeError || logError) {
      setNotice(nodeError?.message || logError?.message || 'Failed to load governance data.');
      return;
    }

    setNodes((nodeRows as HardwareNode[]) || []);
    setConsentLogs((logRows as DpdpConsentLog[]) || []);
  }, [profile]);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadGovernanceData();
    }, 0);
    return () => clearTimeout(t);
  }, [loadGovernanceData]);

  const handleUseCurrentGps = () => {
    if (!navigator.geolocation) {
      setNotice('Browser geolocation unavailable.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatInput(pos.coords.latitude.toFixed(6));
        setLngInput(pos.coords.longitude.toFixed(6));
      },
      (err) => setNotice(err.message)
    );
  };

  const handleRegisterNode = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !profile) return;

    const lat = Number(latInput);
    const lng = Number(lngInput);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setNotice('Enter valid numeric latitude and longitude coordinates.');
      return;
    }

    setSubmittingNode(true);
    setNotice(null);
    try {
      const geohash = encodeGeoHash(lat, lng, 7);
      const { error } = await supabase.from('hardware_nodes').insert({
        owner_id: profile.id,
        device_uid: deviceUid.trim(),
        node_type: nodeType,
        label: label.trim(),
        firmware_version: firmwareVersion.trim(),
        lat,
        lng,
        geohash,
        status: 'OFFLINE',
        aed_status: 'N/A',
      });
      if (error) throw error;

      setDeviceUid('');
      setLabel('');
      setNotice(`Registered hardware node (${nodeType}) at GeoHash ${geohash}.`);
      await loadGovernanceData();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Failed to register hardware node.');
    } finally {
      setSubmittingNode(false);
    }
  };

  const handleDeleteNode = async (id: string) => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    const { error } = await supabase.from('hardware_nodes').delete().eq('id', id);
    if (error) {
      setNotice(error.message);
      return;
    }
    await loadGovernanceData();
  };

  const handleConsentAction = async (
    scope: ConsentScope,
    action: 'GRANTED' | 'REVOKED',
    purpose: string
  ) => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !profile) return;

    const { error } = await supabase.from('dpdp_consent_logs').insert({
      user_id: profile.id,
      consent_scope: scope,
      action,
      purpose_description: purpose,
    });
    if (error) {
      setNotice(error.message);
      return;
    }

    setNotice(`DPDP Act 2023 log recorded: ${scope} -> ${action}`);
    await loadGovernanceData();
  };

  const handleExportUserData = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !profile) return;

    const [
      { data: myIncidents, error: incidentError },
      { data: myNodes, error: nodeError },
      { data: myLogs, error: logError },
    ] = await Promise.all([
      supabase.from('incidents').select('*').eq('victim_id', profile.id),
      supabase.from('hardware_nodes').select('*').eq('owner_id', profile.id),
      supabase.from('dpdp_consent_logs').select('*').eq('user_id', profile.id),
    ]);

    if (incidentError || nodeError || logError) {
      setNotice(
        incidentError?.message || nodeError?.message || logError?.message || 'Failed to export data.'
      );
      return;
    }

    const { error: exportLogError } = await supabase.from('dpdp_consent_logs').insert({
      user_id: profile.id,
      consent_scope: 'ALL_SERVICES_DATA_ERASURE',
      action: 'EXPORTED',
      purpose_description: 'DPDP Act 2023 Section 11 Right to Access / Data Portability export.',
    });
    if (exportLogError) {
      setNotice(exportLogError.message);
      return;
    }

    const exportBundle = {
      exportedAt: new Date().toISOString(),
      statute: 'Digital Personal Data Protection Act, 2023 (India)',
      profile,
      incidents: myIncidents || [],
      hardwareNodes: myNodes || [],
      dpdpConsentLogs: myLogs || [],
    };

    const blob = new Blob([JSON.stringify(exportBundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pulseguard-dpdp-export-${profile.id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    await loadGovernanceData();
  };

  const handleRevokeAndEraseData = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !profile) return;

    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        phone: null,
        blood_group: null,
        allergies: null,
        medical_conditions: null,
        emergency_contact_name: null,
        emergency_contact_email: null,
        emergency_contact_phone: null,
        safeword_hash: null,
        baseline_hr_bpm: null,
        baseline_rmssd_ms: null,
        current_lat: null,
        current_lng: null,
        current_geohash: null,
        last_location_at: null,
        dpdp_consent_granted: false,
        dpdp_consent_at: null,
      })
      .eq('id', profile.id);
    if (updateError) {
      setNotice(updateError.message);
      return;
    }

    const { error: logError } = await supabase.from('dpdp_consent_logs').insert({
      user_id: profile.id,
      consent_scope: 'ALL_SERVICES_DATA_ERASURE',
      action: 'ERASED',
      purpose_description:
        'Optional profile and location fields cleared; historical incidents and consent logs retained.',
    });
    if (logError) {
      setNotice(logError.message);
      return;
    }

    await clearOfflineOutbox();
    await refreshProfile();
    await loadGovernanceData();
    setNotice('Optional profile fields cleared. Incident and audit history was retained.');
  };

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
        <section className="rounded-2xl border border-slate-800 bg-[#0B1120] p-5">
          <div className="flex items-center gap-2 font-mono text-xs text-amber-400">
            <Cpu className="h-4 w-4" />
            PORTAL D · HARDWARE IOT &amp; DPDP ACT 2023 GOVERNANCE CONSOLE
          </div>
          <h1 className="mt-1 text-xl font-extrabold text-white sm:text-2xl">
            ESP32-S3 OBD-II Fleet · PulseBox AED Cabinets · DPDP Audit Ledger
          </h1>
          {notice && (
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-950/30 p-3 text-xs text-emerald-200">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              <span>{notice}</span>
            </div>
          )}
        </section>

        {/* Register Physical Hardware Node */}
        {profile && (
          <section className="rounded-2xl border border-slate-800 bg-[#0B1120] p-5">
            <h2 className="flex items-center gap-2 text-base font-bold text-white">
              <PlusCircle className="h-4 w-4 text-cyan-400" />
              Register Physical IoT Node (OBD-II Lite/Pro or PulseBox AED)
            </h2>

            <form
              onSubmit={handleRegisterNode}
              className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            >
              <div>
                <label className="block text-xs text-slate-300">Hardware Device UID</label>
                <input
                  type="text"
                  required
                  value={deviceUid}
                  onChange={(e) => setDeviceUid(e.target.value)}
                  placeholder="Device UID"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-300">Node Type</label>
                <select
                  value={nodeType}
                  onChange={(e) => setNodeType(e.target.value as HardwareNodeType)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
                >
                  <option value="OBD_II_LITE">OBD-II Lite (BLE Smartphone Tethered)</option>
                  <option value="OBD_II_PRO">OBD-II Pro (Standalone Cat-M1 / eSIM)</option>
                  <option value="PULSEBOX_AED">PulseBox Smart Triage AED Cabinet</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-300">Deployment Label / Location</label>
                <input
                  type="text"
                  required
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Deployment label"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-300">Latitude</label>
                <input
                  type="number"
                  step="any"
                  required
                  value={latInput}
                  onChange={(e) => setLatInput(e.target.value)}
                  placeholder="Latitude"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-300">Longitude</label>
                <input
                  type="number"
                  step="any"
                  required
                  value={lngInput}
                  onChange={(e) => setLngInput(e.target.value)}
                  placeholder="Longitude"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-white focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div className="flex items-end gap-2">
                <button
                  type="button"
                  onClick={handleUseCurrentGps}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 hover:border-cyan-500"
                >
                  <MapPin className="h-3.5 w-3.5 text-emerald-400" />
                  Fill Browser GPS
                </button>
                <input
                  type="text"
                  required
                  value={firmwareVersion}
                  onChange={(e) => setFirmwareVersion(e.target.value)}
                  aria-label="Firmware version"
                  placeholder="Firmware version"
                  className="w-28 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 font-mono text-xs text-white"
                />
              </div>

              <div className="sm:col-span-2 lg:col-span-3 flex justify-end">
                <button
                  type="submit"
                  disabled={submittingNode}
                  className="rounded-xl bg-cyan-600 px-4 py-2 text-xs font-bold text-white hover:bg-cyan-500 disabled:opacity-50"
                >
                  {submittingNode ? 'Registering...' : 'Register Hardware Node in PostgreSQL'}
                </button>
              </div>
            </form>
          </section>
        )}

        {/* Registered Nodes & Live Webhook Feed */}
        <section className="rounded-2xl border border-slate-800 bg-[#0B1120] p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-base font-bold text-white">
              <Webhook className="h-4 w-4 text-emerald-400" />
              Registered IoT Nodes &amp; Live Webhook Telemetry ({nodes.length})
            </h2>
            <span className="font-mono text-[11px] text-slate-400">
              Endpoint: POST /api/iot/telemetry (x-iot-secret)
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {nodes.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-800 p-6 text-center text-xs text-slate-400">
                No hardware nodes registered yet. Add an OBD-II Lite/Pro dongle or PulseBox AED above.
              </div>
            ) : (
              nodes.map((node) => (
                <div
                  key={node.id}
                  className="rounded-xl border border-slate-800 bg-slate-950/80 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded border border-cyan-500/40 bg-cyan-500/15 px-2 py-0.5 font-mono text-[10px] font-bold text-cyan-200">
                          {node.node_type}
                        </span>
                        <span className="font-mono text-xs font-bold text-white">
                          {node.device_uid}
                        </span>
                        <span className="text-xs text-slate-300">{node.label}</span>
                        <span
                          className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold ${
                            node.status === 'ALERT'
                              ? 'bg-red-500/20 text-red-300'
                              : 'bg-emerald-500/20 text-emerald-300'
                          }`}
                        >
                          {node.status}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-3 font-mono text-[11px] text-slate-400">
                        <span>
                          GPS: {node.lat.toFixed(5)}, {node.lng.toFixed(5)} ({node.geohash})
                        </span>
                        <span>FW: {node.firmware_version}</span>
                        {node.battery_pct !== null && <span>Battery: {node.battery_pct}%</span>}
                        {node.aed_status && node.aed_status !== 'N/A' && (
                          <span className="text-cyan-300">AED: {node.aed_status}</span>
                        )}
                        <span>
                          Last Ping:{' '}
                          {node.last_ping_at
                            ? new Date(node.last_ping_at).toLocaleString()
                            : 'No webhook ping received yet'}
                        </span>
                      </div>
                      {node.last_telemetry && Object.keys(node.last_telemetry).length > 0 && (
                        <pre className="mt-2 overflow-x-auto rounded bg-[#05080F] p-2 font-mono text-[11px] text-emerald-300">
                          {JSON.stringify(node.last_telemetry)}
                        </pre>
                      )}
                    </div>

                    {profile?.id === node.owner_id && (
                      <button
                        type="button"
                        onClick={() => handleDeleteNode(node.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300 hover:border-red-500/50 hover:text-red-300"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          <p className="mt-4 rounded-xl border border-slate-800 bg-[#05080F] p-3.5 text-xs text-slate-400">
            Configure each device to POST its registered UID and measured telemetry to this
            endpoint. New nodes remain offline until their first authenticated heartbeat.
          </p>
        </section>

        {/* DPDP Act 2023 Explicit Consent & Data Portability / Erasure */}
        {profile && (
          <section className="rounded-2xl border border-slate-800 bg-[#0B1120] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-base font-bold text-white">
                  <FileCheck2 className="h-4 w-4 text-cyan-400" />
                  DPDP Act 2023 Explicit Consent &amp; Data Principal Rights
                </h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  Immutable PostgreSQL audit logs (`dpdp_consent_logs`), data export, and erasure.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleExportUserData}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-500/40 bg-cyan-500/15 px-3.5 py-2 text-xs font-bold text-cyan-200 hover:bg-cyan-500/25"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export My Data (JSON)
                </button>
                <button
                  type="button"
                  onClick={handleRevokeAndEraseData}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-red-500/40 bg-red-500/15 px-3.5 py-2 text-xs font-bold text-red-200 hover:bg-red-500/25"
                >
                  <ShieldAlert className="h-3.5 w-3.5" />
                  Revoke &amp; Erase Medical Data
                </button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              {CONSENT_SCOPES.map((item) => (
                <div
                  key={item.scope}
                  className="flex flex-col justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3.5"
                >
                  <div>
                    <div className="text-xs font-bold text-white">{item.label}</div>
                    <div className="mt-1 text-[11px] text-slate-400">{item.purpose}</div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleConsentAction(item.scope, 'GRANTED', item.purpose)}
                      className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-500/25"
                    >
                      Grant Consent
                    </button>
                    <button
                      type="button"
                      onClick={() => handleConsentAction(item.scope, 'REVOKED', item.purpose)}
                      className="rounded-lg border border-red-500/40 bg-red-500/15 px-2.5 py-1 text-[11px] font-semibold text-red-200 hover:bg-red-500/25"
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5">
              <div className="font-mono text-xs font-bold text-slate-300">
                PostgreSQL `dpdp_consent_logs` ({consentLogs.length})
              </div>
              <div className="mt-2 max-h-64 space-y-2 overflow-y-auto pr-1">
                {consentLogs.length === 0 ? (
                  <p className="text-xs text-slate-500">No DPDP consent log entries recorded yet.</p>
                ) : (
                  consentLogs.map((log) => (
                    <div
                      key={log.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-[#05080F] px-3 py-2 font-mono text-[11px]"
                    >
                      <div>
                        <span
                          className={
                            log.action === 'GRANTED'
                              ? 'text-emerald-400 font-bold'
                              : log.action === 'EXPORTED'
                                ? 'text-cyan-300 font-bold'
                                : 'text-red-400 font-bold'
                          }
                        >
                          {log.action}
                        </span>{' '}
                        <span className="text-white">{log.consent_scope}</span>
                        <div className="text-[10px] text-slate-400">{log.purpose_description}</div>
                      </div>
                      <span className="text-[10px] text-slate-500">
                        {new Date(log.created_at).toLocaleString()}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
