import React, { useEffect, useState } from 'react';
import {
  Radio,
  TrafficCone,
  MessageSquare,
  Bluetooth,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Lock,
  RefreshCw,
  Send
} from 'lucide-react';
import { MICRO_ZONES } from '@shared/domainData';
import { apiRequest } from '../lib/api';
import { clinicalAudio } from '../lib/sound';

export default function CommandView({ user, zoneId, incidents, zoneSnapshot, onRefreshData }) {
  const [smsInput, setSmsInput] = useState('');
  const [smsResult, setSmsResult] = useState(null);
  const [smsError, setSmsError] = useState('');
  const [bleIndoor, setBleIndoor] = useState(true);
  const [bleRoute, setBleRoute] = useState(null);
  const [auditData, setAuditData] = useState({ chainValid: true, totalEntries: 0, entries: [] });
  const [statusMsg, setStatusMsg] = useState('');

  const zone = MICRO_ZONES[zoneId] || MICRO_ZONES.aiims_delhi;
  const activeIncident = incidents.find(
    (i) => i.microZone === zoneId && ['ACTIVE', 'DISPATCHED', 'ON_SCENE'].includes(i.status)
  );
  const latestSmsPacket = activeIncident?.smsPacketB64 || incidents[0]?.smsPacketB64 || '';

  useEffect(() => {
    if (!smsInput && latestSmsPacket) {
      setSmsInput(latestSmsPacket);
    }
  }, [latestSmsPacket]);

  const loadAudit = async () => {
    try {
      const data = await apiRequest('/audit');
      setAuditData(data);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadAudit();
    handleSimulateBle(true);
  }, [zoneId, incidents.length]);

  const handleToggleGreenCorridor = async () => {
    setStatusMsg('');
    try {
      await apiRequest('/command/zone-controls', {
        method: 'POST',
        body: { microZone: zoneId, greenCorridor: !zoneSnapshot?.greenCorridor }
      });
      clinicalAudio.successChime();
      onRefreshData?.();
    } catch (err) {
      setStatusMsg(err.message);
    }
  };

  const handleDecodeSms = async (dispatchNow = false) => {
    setSmsError('');
    setSmsResult(null);
    try {
      const res = await apiRequest('/mesh/sms-gateway', {
        method: 'POST',
        body: { smsPacketB64: smsInput, microZone: zoneId, dispatchNow }
      });
      setSmsResult(res.decoded);
      if (dispatchNow) {
        clinicalAudio.alertChime();
        onRefreshData?.();
      } else {
        clinicalAudio.successChime();
      }
      loadAudit();
    } catch (err) {
      setSmsError(`${err.code || 'ERROR'}: ${err.message}`);
    }
  };

  const handleSimulateBle = async (indoorVal = bleIndoor) => {
    try {
      const res = await apiRequest('/mesh/ble-simulate', {
        method: 'POST',
        body: { microZone: zoneId, indoor: indoorVal }
      });
      setBleRoute(res.route);
    } catch {
      // ignore
    }
  };

  // Map coordinate projection around zone center (±0.008 deg box -> 640x360 SVG)
  const project = (lat, lng) => {
    const span = 0.0085;
    const x = 320 + ((lng - zone.lng) / span) * 260;
    const y = 180 - ((lat - zone.lat) / span) * 150;
    return {
      x: Math.max(28, Math.min(612, x)),
      y: Math.max(28, Math.min(332, y))
    };
  };

  const incPt = activeIncident ? project(activeIncident.lat, activeIncident.lng) : project(zone.lat, zone.lng);
  const ambPt = project(zone.ambulanceStation.lat, zone.ambulanceStation.lng);
  const intersections = Array.from({ length: 12 }, (_, idx) => {
    const col = idx % 4;
    const row = Math.floor(idx / 4);
    return { id: idx + 1, x: 110 + col * 140, y: 75 + row * 105 };
  });

  return (
    <div className="space-y-6">
      {statusMsg && (
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-medium">
          {statusMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: GeoHash Micro-Fence & 108 Green Corridor Map */}
        <div className="lg:col-span-7 clinical-card p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-teal-700" />
                <h2 className="text-sm font-bold text-slate-900">
                  Smart City 112 CAD · GeoHash Tactical Grid ({zone.shortName})
                </h2>
              </div>
              <p className="text-xs text-slate-500">
                GeoHash <span className="font-mono font-semibold">{zone.geohash}</span> · Ground Doctors + 108 EMS Bridge + PulseBox AED (Zero unbudgeted UAVs)
              </p>
            </div>

            <button
              type="button"
              onClick={handleToggleGreenCorridor}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold border flex items-center gap-1.5 transition-colors ${
                zoneSnapshot?.greenCorridor
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-white text-slate-800 border-slate-300 hover:bg-slate-50'
              }`}
            >
              <TrafficCone className="w-3.5 h-3.5" />
              {zoneSnapshot?.greenCorridor ? 'Green Corridor Active (12 Signals)' : 'Activate 112 Green Corridor'}
            </button>
          </div>

          {/* Crisp Clinical Cartographic SVG */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
            <svg viewBox="0 0 640 360" className="w-full h-auto block">
              {/* Road Grid */}
              <g stroke="#E2E8F0" strokeWidth="1.5">
                {[75, 180, 285].map((y) => (
                  <line key={`h-${y}`} x1="0" y1={y} x2="640" y2={y} />
                ))}
                {[110, 250, 390, 530].map((x) => (
                  <line key={`v-${x}`} x1={x} y1="0" x2={x} y2="360" />
                ))}
              </g>

              {/* GeoHash 500m & 1.2km Rings */}
              <circle
                cx={incPt.x}
                cy={incPt.y}
                r="130"
                fill="rgba(29, 78, 216, 0.04)"
                stroke="#93C5FD"
                strokeDasharray="5 4"
                strokeWidth="1.2"
              />
              <circle
                cx={incPt.x}
                cy={incPt.y}
                r="62"
                fill={activeIncident ? 'rgba(220, 38, 38, 0.07)' : 'rgba(15, 118, 110, 0.05)'}
                stroke={activeIncident ? '#FCA5A5' : '#5EEAD4'}
                strokeDasharray="4 3"
                strokeWidth="1.2"
              />

              {/* 12 Smart City Traffic Intersections */}
              {intersections.map((node) => (
                <g key={node.id}>
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r="5"
                    fill={zoneSnapshot?.greenCorridor ? '#10B981' : '#94A3B8'}
                  />
                  <text x={node.x + 8} y={node.y + 3} fontSize="8.5" fill="#64748B" fontFamily="monospace">
                    S{node.id}
                  </text>
                </g>
              ))}

              {/* 108 Ambulance Route */}
              <line
                x1={ambPt.x}
                y1={ambPt.y}
                x2={incPt.x}
                y2={incPt.y}
                stroke={zoneSnapshot?.greenCorridor ? '#059669' : '#D97706'}
                strokeWidth="2.2"
                strokeDasharray="6 4"
              />

              {/* 108 Ambulance Marker */}
              <g transform={`translate(${ambPt.x}, ${ambPt.y})`}>
                <rect x="-12" y="-10" width="24" height="20" rx="5" fill="#D97706" />
                <text x="0" y="3.5" textAnchor="middle" fontSize="9" fill="#FFF" fontWeight="bold">
                  108
                </text>
                <text x="16" y="3" fontSize="10" fill="#334155" fontWeight="600">
                  EMS 108 ({activeIncident ? `${Math.round((activeIncident.ambulanceEtaSec || 1200) / 60)}m` : zoneSnapshot?.greenCorridor ? '9m' : '22m'})
                </text>
              </g>

              {/* PulseBox Cabinet Marker */}
              {(zoneSnapshot?.pulseboxes || []).map((box) => {
                const pt = project(box.lat, box.lng);
                return (
                  <g key={box.id} transform={`translate(${pt.x}, ${pt.y})`}>
                    <rect x="-8" y="-8" width="16" height="16" rx="4" fill={box.aedUnlocked ? '#059669' : '#0F766E'} />
                    <text x="12" y="3" fontSize="9.5" fill="#0F766E" fontWeight="600">
                      {box.id} {box.aedUnlocked ? '(AED Open)' : '(AED)'}
                    </text>
                  </g>
                );
              })}

              {/* NMC Doctor Responders */}
              {(zoneSnapshot?.responders || []).map((doc) => {
                const pt = project(doc.lat, doc.lng);
                return (
                  <g key={doc.id}>
                    {activeIncident && (
                      <line
                        x1={pt.x}
                        y1={pt.y}
                        x2={incPt.x}
                        y2={incPt.y}
                        stroke="#1D4ED8"
                        strokeWidth="1.5"
                        strokeOpacity="0.6"
                      />
                    )}
                    <circle cx={pt.x} cy={pt.y} r="7" fill="#1D4ED8" stroke="#FFFFFF" strokeWidth="2" />
                    <text x={pt.x + 10} y={pt.y + 3} fontSize="10" fill="#0F172A" fontWeight="600">
                      {doc.name.split(',')[0]} ({Math.ceil(doc.etaSec / 60)}m)
                    </text>
                  </g>
                );
              })}

              {/* Center Target / Active Incident Marker */}
              <g transform={`translate(${incPt.x}, ${incPt.y})`}>
                <circle
                  r={activeIncident ? 10 : 7}
                  fill={activeIncident ? '#DC2626' : '#059669'}
                  stroke="#FFFFFF"
                  strokeWidth="2.5"
                />
                <text x="14" y="-4" fontSize="10.5" fill={activeIncident ? '#B91C1C' : '#065F46'} fontWeight="700">
                  {activeIncident ? `CODE BLUE · ${activeIncident.id}` : zone.landmarks.incidentDefault}
                </text>
              </g>
            </svg>
          </div>

          <div className="grid grid-cols-3 gap-3 text-xs">
            <div className="clinical-inset p-3">
              <div className="text-slate-500">NMC Responder ETA</div>
              <div className="text-base font-bold text-emerald-700 tabular-nums">
                {activeIncident ? `${Math.floor((activeIncident.responderEtaSec || 140) / 60)}m ${(activeIncident.responderEtaSec || 140) % 60}s` : '2m 14s avg'}
              </div>
            </div>
            <div className="clinical-inset p-3">
              <div className="text-slate-500">108 Ambulance ETA</div>
              <div className="text-base font-bold text-slate-900 tabular-nums">
                {activeIncident
                  ? `${Math.round((activeIncident.ambulanceEtaSec || 1200) / 60)} min`
                  : zoneSnapshot?.greenCorridor
                    ? '~9 min (Pre-empted)'
                    : '~22 min (Traffic)'}
              </div>
            </div>
            <div className="clinical-inset p-3">
              <div className="text-slate-500">Corridor Signals</div>
              <div className="text-base font-bold text-blue-700">
                {zoneSnapshot?.greenCorridor ? '12 / 12 GREEN' : 'Standard Cycle'}
              </div>
            </div>
          </div>
        </div>

        {/* Right: 52-Byte SMS Gateway & BLE 5.0 Coded PHY Multi-Hop Inspector */}
        <div className="lg:col-span-5 space-y-5">
          {/* 52-Byte Binary SMS Gateway */}
          <div className="clinical-card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-blue-700" />
                <h3 className="text-sm font-bold text-slate-900">52-Byte AES-256-GCM Binary SMS Gateway</h3>
              </div>
              <span className="text-[11px] font-mono text-slate-500">88B Free Headroom</span>
            </div>
            <p className="text-xs text-slate-500">
              Exact packed frame: 8B GPS + 4B TS + 8B ID + 4B Vitals + 12B IV + 16B GCM Tag = <strong>52B (72 Base64 chars)</strong>.
              Try editing 1 char below to verify GCM auth-tag rejection.
            </p>

            <textarea
              rows={2}
              value={smsInput}
              onChange={(e) => setSmsInput(e.target.value)}
              placeholder="Paste 72-char Base64 encrypted SMS frame..."
              className="w-full p-2.5 text-xs font-mono bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:border-blue-600"
            />

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleDecodeSms(false)}
                className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl"
              >
                Verify &amp; Decrypt SMS
              </button>
              <button
                type="button"
                onClick={() => handleDecodeSms(true)}
                className="px-3 py-2 bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold rounded-xl flex items-center gap-1"
              >
                <Send className="w-3.5 h-3.5" /> Ingest &amp; Dispatch
              </button>
              {latestSmsPacket && (
                <button
                  type="button"
                  onClick={() => {
                    setSmsInput(latestSmsPacket);
                    setSmsError('');
                  }}
                  className="px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-xl"
                >
                  Load Latest
                </button>
              )}
            </div>

            {smsError && (
              <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-mono flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{smsError}</span>
              </div>
            )}

            {smsResult && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs space-y-1 font-mono">
                <div className="font-sans font-bold flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" /> 16-Byte GCM Tag Authenticated
                </div>
                <div>GPS: {smsResult.lat}, {smsResult.lng} · Trigger: {smsResult.triggerType}</div>
                <div>Vitals: {smsResult.hrBpm} BPM · SpO₂ {smsResult.spo2Pct}% · IMU {smsResult.linearImuG}g</div>
                <div>MedHash: {smsResult.medicalIdHex}</div>
              </div>
            )}
          </div>

          {/* BLE 5.0 Coded PHY Multi-Hop Router */}
          <div className="clinical-card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bluetooth className="w-4 h-4 text-blue-700" />
                <h3 className="text-sm font-bold text-slate-900">BLE 5.0 Coded PHY Multi-Hop Router</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  const next = !bleIndoor;
                  setBleIndoor(next);
                  handleSimulateBle(next);
                }}
                className="px-2.5 py-1 text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700"
              >
                {bleIndoor ? 'Basement Indoor (30m/hop)' : 'Outdoor (100m+/hop)'}
              </button>
            </div>

            {bleRoute?.reachable ? (
              <div className="space-y-2">
                <div className="text-xs text-slate-600">
                  Routed in <strong>{bleRoute.hops} hops</strong> ({bleRoute.totalDistM}m, ~{bleRoute.estimatedLatencyMs}ms) ·{' '}
                  <span className="text-emerald-700 font-semibold">Zero-Knowledge Relays</span>
                </div>
                <div className="space-y-1.5">
                  {bleRoute.path.map((step) => (
                    <div key={step.id} className="clinical-inset px-3 py-2 flex items-center justify-between text-xs">
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 truncate">
                          Hop {step.hopIndex}: {step.label}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono">
                          {step.hopDistM}m · RSSI {step.rssiDbm} dBm ·{' '}
                          {step.decryptableByRelay ? 'Uplink Cloud Relay' : 'Opaque Ciphertext Only'}
                        </div>
                      </div>
                      <Lock className={`w-3.5 h-3.5 shrink-0 ${step.hasUplink ? 'text-emerald-600' : 'text-slate-400'}`} />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs">
                {bleRoute?.reason || 'Running BLE Coded PHY pathfinder...'}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* SHA-256 Hash-Chained Audit Ledger */}
      <div className="clinical-card p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-700" />
            <h3 className="text-sm font-bold text-slate-900">Tamper-Evident SHA-256 Audit Ledger</h3>
            <span
              className={`badge-pill ${
                auditData.chainValid
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-rose-50 text-rose-700 border-rose-200'
              }`}
            >
              {auditData.chainValid ? `Chain Verified (${auditData.totalEntries} blocks)` : 'Chain Tampered!'}
            </span>
          </div>
          <button
            type="button"
            onClick={loadAudit}
            className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Re-verify Hash Chain
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 pr-3 font-semibold">Event</th>
                <th className="py-2 pr-3 font-semibold">Actor</th>
                <th className="py-2 pr-3 font-semibold">Detail</th>
                <th className="py-2 pr-3 font-semibold">SHA-256 Entry Hash</th>
                <th className="py-2 font-semibold">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {auditData.entries.slice(0, 8).map((row) => (
                <tr key={row.id} className="hover:bg-slate-50/70">
                  <td className="py-2 pr-3 font-mono font-semibold text-blue-700 whitespace-nowrap">{row.action}</td>
                  <td className="py-2 pr-3 text-slate-700 whitespace-nowrap">{row.actor_role}</td>
                  <td className="py-2 pr-3 text-slate-600 max-w-md truncate">{row.detail}</td>
                  <td className="py-2 pr-3 font-mono text-[11px] text-slate-500">{row.entry_hash.slice(0, 14)}…</td>
                  <td className="py-2 text-slate-400 whitespace-nowrap">{new Date(row.created_at).toLocaleTimeString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
