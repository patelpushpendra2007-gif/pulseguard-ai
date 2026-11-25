import React, { useEffect, useState } from 'react';
import {
  Stethoscope,
  ShieldCheck,
  Lock,
  Unlock,
  HeartHandshake,
  Activity,
  CheckCircle2,
  Award,
  KeyRound,
  AlertTriangle,
  Moon
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { clinicalAudio } from '../lib/sound';
import { MICRO_ZONES } from '@shared/domainData';

export default function DoctorMeshView({
  user,
  zoneId,
  incidents,
  zoneSnapshot,
  onUserUpdated,
  onRefreshData
}) {
  const [decryptedMap, setDecryptedMap] = useState({});
  const [decryptErrors, setDecryptErrors] = useState({});
  const [cprActive, setCprActive] = useState(false);
  const [cprBeats, setCprBeats] = useState(0);
  const [actionMsg, setActionMsg] = useState('');

  // 110 BPM CPR Compression Metronome (~545ms period)
  useEffect(() => {
    if (!cprActive) return;
    const id = setInterval(() => {
      clinicalAudio.cprBeat();
      setCprBeats((b) => b + 1);
    }, Math.round(60000 / 110));
    return () => clearInterval(id);
  }, [cprActive]);

  const isResponderOrDispatcher = user.role === 'responder' || user.role === 'dispatcher';
  const zoneIncidents = incidents.filter((inc) => inc.microZone === zoneId);
  const pulsebox = zoneSnapshot?.pulseboxes?.[0];

  const handleToggleAvailability = async () => {
    try {
      const res = await apiRequest('/auth/profile', {
        method: 'PATCH',
        body: { available: !user.available }
      });
      onUserUpdated?.(res.user);
    } catch (err) {
      setActionMsg(err.message);
    }
  };

  const handleToggleOvernightSurge = async () => {
    try {
      await apiRequest('/command/zone-controls', {
        method: 'POST',
        body: { microZone: zoneId, overnightSurge: !zoneSnapshot?.overnightSurge }
      });
      onRefreshData?.();
    } catch (err) {
      setActionMsg(err.message);
    }
  };

  const handleDecrypt = async (incId) => {
    setDecryptErrors((prev) => ({ ...prev, [incId]: '' }));
    try {
      const data = await apiRequest(`/incidents/${incId}/decrypt`, { method: 'POST' });
      setDecryptedMap((prev) => ({ ...prev, [incId]: data.payload }));
      clinicalAudio.successChime();
    } catch (err) {
      setDecryptErrors((prev) => ({ ...prev, [incId]: `${err.code || 'ERROR'}: ${err.message}` }));
    }
  };

  const handleAcceptDispatch = async (incId) => {
    try {
      await apiRequest(`/incidents/${incId}/accept`, { method: 'POST' });
      clinicalAudio.successChime();
      setActionMsg(`Dispatched! Section 134A Good Samaritan Shield & ₹10L Indemnity activated for ${incId}.`);
      onRefreshData?.();
    } catch (err) {
      setActionMsg(err.message);
    }
  };

  const handleStatusChange = async (incId, status) => {
    try {
      const res = await apiRequest(`/incidents/${incId}/status`, {
        method: 'POST',
        body: { status }
      });
      if (status === 'STABILIZED') {
        setCprActive(false);
        setDecryptedMap((prev) => {
          const copy = { ...prev };
          delete copy[incId];
          return copy;
        });
        const freshMe = await apiRequest('/auth/me');
        onUserUpdated?.(freshMe.user);
        setActionMsg(
          `Patient stabilized! Credited ₹${res.stipendAwardedInr} stipend + 2 CME points. Ephemeral ECDH keys shredded.`
        );
      }
      clinicalAudio.successChime();
      onRefreshData?.();
    } catch (err) {
      setActionMsg(err.message);
    }
  };

  const handleToggleAed = async (incId) => {
    if (!pulsebox) return;
    try {
      await apiRequest(`/pulsebox/${pulsebox.id}/unlock-aed`, {
        method: 'POST',
        body: { unlock: !pulsebox.aedUnlocked, incidentId: incId }
      });
      clinicalAudio.successChime();
      onRefreshData?.();
    } catch (err) {
      setActionMsg(err.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Responder Credential & Incentive Strip */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7 clinical-card p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Stethoscope className="w-5 h-5 text-blue-700" />
              <h2 className="text-base font-bold text-slate-900">{user.name}</h2>
              {user.nmcId && (
                <span className="badge-pill bg-blue-50 text-blue-700 border-blue-200 font-mono">
                  {user.nmcId}
                </span>
              )}
              <span
                className={`badge-pill ${
                  user.responderTier === 'TIER_B_BLS'
                    ? 'bg-amber-50 text-amber-800 border-amber-200'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                }`}
              >
                {user.responderTier === 'TIER_B_BLS'
                  ? 'Tier B · BLS/AED Scope'
                  : user.role === 'responder'
                    ? 'Tier A · NMC NMR + ABDM HPR'
                    : `Viewing as ${user.role.toUpperCase()}`}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              {user.specialty || 'Clinical Mesh Portal'} · Statutory Immunity under Section 134A MV Act + ₹10L Indemnity
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {user.role === 'responder' && (
              <button
                type="button"
                onClick={handleToggleAvailability}
                className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                  user.available
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-slate-100 text-slate-600 border-slate-300'
                }`}
              >
                {user.available ? '● On Duty (GeoHash Live)' : '○ Off Duty'}
              </button>
            )}
            <button
              type="button"
              onClick={handleToggleOvernightSurge}
              className={`px-3 py-2 rounded-xl text-xs font-semibold border flex items-center gap-1.5 ${
                zoneSnapshot?.overnightSurge
                  ? 'bg-indigo-700 text-white border-indigo-700'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Moon className="w-3.5 h-3.5" />
              {zoneSnapshot?.overnightSurge ? '11PM–6AM 2x Surge ON' : 'Simulate 2 AM 2x Surge'}
            </button>
          </div>
        </div>

        {/* Incentive Ledger */}
        <div className="lg:col-span-5 clinical-card p-5 grid grid-cols-3 gap-3">
          <div>
            <div className="text-[11px] text-slate-500 font-medium">Dispatch Stipends</div>
            <div className="text-lg font-bold text-slate-900 tabular-nums">
              ₹{(user.stipendBalanceInr || 0).toLocaleString('en-IN')}
            </div>
            <div className="text-[10px] text-emerald-700">Day-1 Live Insurer Pool</div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 font-medium">CME Credits</div>
            <div className="text-lg font-bold text-slate-900 tabular-nums">{user.cmeCredits || 0} hrs</div>
            <div className="text-[10px] text-blue-700">State Council Mapped</div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 font-medium">Prop Tax Rebate</div>
            <div className="text-lg font-bold text-slate-900 tabular-nums">
              ₹{(user.taxRebateInr || 0).toLocaleString('en-IN')}
            </div>
            <div className="text-[10px] text-slate-500">Municipal MoU Ledger</div>
          </div>
        </div>
      </div>

      {!isResponderOrDispatcher && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-700" />
          <span>
            You are currently signed in as <strong>{user.name} ({user.role})</strong>. Use the Persona Switcher in the top-right header to switch to{' '}
            <strong>Dr. Sarah Lin, MD (NMC-98421)</strong> to test accepting dispatches, decrypting E2EE vitals, and unlocking PulseBox AED!
          </span>
        </div>
      )}

      {actionMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-medium flex items-center justify-between">
          <span>{actionMsg}</span>
          <button type="button" onClick={() => setActionMsg('')} className="font-bold ml-4">
            Dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Dispatch Queue */}
        <div className="lg:col-span-8 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">
              GeoHash Dispatch Queue · {MICRO_ZONES[zoneId]?.shortName}
            </h3>
            <span className="text-xs text-slate-500">{zoneIncidents.length} recorded incident(s)</span>
          </div>

          {zoneIncidents.length === 0 ? (
            <div className="clinical-card p-8 text-center space-y-2">
              <ShieldCheck className="w-8 h-8 text-emerald-600 mx-auto" />
              <div className="text-sm font-semibold text-slate-900">No Active Emergencies in {MICRO_ZONES[zoneId]?.shortName}</div>
              <p className="text-xs text-slate-500">
                Trigger an SOS from the Citizen Guardian tab (or 52-Byte SMS Gateway) to watch real-time GeoHash dispatch here.
              </p>
            </div>
          ) : (
            zoneIncidents.map((inc) => {
              const decrypted = decryptedMap[inc.id];
              const decryptErr = decryptErrors[inc.id];
              const isOpen = ['ACTIVE', 'DISPATCHED', 'ON_SCENE'].includes(inc.status);
              return (
                <div
                  key={inc.id}
                  className={`clinical-card p-5 space-y-4 ${
                    inc.status === 'ACTIVE' ? 'border-rose-300 ring-1 ring-rose-100' : ''
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-bold text-slate-900">{inc.id}</span>
                        <span
                          className={`badge-pill ${
                            inc.status === 'ACTIVE'
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : inc.status === 'STABILIZED'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-blue-50 text-blue-700 border-blue-200'
                          }`}
                        >
                          {inc.status}
                        </span>
                        <span className="text-xs font-medium text-slate-500">
                          {inc.triggerType} · {inc.transportMode}
                        </span>
                      </div>
                      <div className="text-xs text-slate-600 mt-1">
                        Victim: <strong>{inc.victimName}</strong> · GeoHash{' '}
                        <span className="font-mono">{inc.geohash}</span> ·{' '}
                        {new Date(inc.createdAt).toLocaleTimeString()}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleDecrypt(inc.id)}
                        className="px-3 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 flex items-center gap-1.5"
                      >
                        <KeyRound className="w-3.5 h-3.5 text-blue-700" />
                        {inc.envelopeSummary?.revoked ? 'Verify Key Shredded' : 'ECDH Decrypt Dossier'}
                      </button>

                      {inc.status === 'ACTIVE' && isResponderOrDispatcher && (
                        <button
                          type="button"
                          onClick={() => handleAcceptDispatch(inc.id)}
                          className="px-3.5 py-1.5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold"
                        >
                          Accept &amp; Activate 134A Shield
                        </button>
                      )}

                      {inc.status === 'DISPATCHED' && isResponderOrDispatcher && (
                        <button
                          type="button"
                          onClick={() => handleStatusChange(inc.id, 'ON_SCENE')}
                          className="px-3.5 py-1.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold"
                        >
                          Mark On Scene
                        </button>
                      )}

                      {['DISPATCHED', 'ON_SCENE'].includes(inc.status) && isResponderOrDispatcher && (
                        <button
                          type="button"
                          onClick={() => handleStatusChange(inc.id, 'STABILIZED')}
                          className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> Stabilized (Shred Keys)
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Vitals & Indemnity Summary */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                    <div className="clinical-inset p-2.5">
                      <div className="text-[11px] text-slate-500">Telemetry HR</div>
                      <div className="font-mono font-bold text-slate-900">{inc.vitals?.hrBpm || '--'} BPM</div>
                    </div>
                    <div className="clinical-inset p-2.5">
                      <div className="text-[11px] text-slate-500">SpO₂ / IMU</div>
                      <div className="font-mono font-bold text-slate-900">
                        {inc.vitals?.spo2Pct || '--'}% · {inc.vitals?.linearImuG ?? '--'}g
                      </div>
                    </div>
                    <div className="clinical-inset p-2.5">
                      <div className="text-[11px] text-slate-500">Responder ETA</div>
                      <div className="font-mono font-bold text-emerald-700">
                        {Math.floor((inc.responderEtaSec || 150) / 60)}m {(inc.responderEtaSec || 150) % 60}s
                      </div>
                    </div>
                    <div className="clinical-inset p-2.5">
                      <div className="text-[11px] text-slate-500">Good Samaritan Shield</div>
                      <div className="font-mono font-bold text-blue-700 truncate">
                        {inc.indemnityCertId || 'Auto on Accept'}
                      </div>
                    </div>
                  </div>

                  {/* Decrypted Dossier Output */}
                  {decrypted && (
                    <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs space-y-1.5">
                      <div className="font-bold text-emerald-900 flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5" /> ECDH P-256 + AES-256-GCM Clinical Dossier Unsealed
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-emerald-900">
                        <div><strong>Patient:</strong> {decrypted.victimName} ({decrypted.bloodGroup})</div>
                        <div><strong>Allergies:</strong> {decrypted.allergies}</div>
                        <div><strong>ICE Contact:</strong> {decrypted.emergencyContact}</div>
                      </div>
                      <div className="text-emerald-800">
                        <strong>Exact Coords:</strong> <span className="font-mono">{decrypted.exactLat}, {decrypted.exactLng}</span> · {decrypted.evidenceNote}
                      </div>
                    </div>
                  )}

                  {decryptErr && (
                    <div className="p-3 rounded-xl bg-slate-100 border border-slate-300 text-slate-700 text-xs font-mono">
                      {decryptErr}
                    </div>
                  )}

                  {isOpen && pulsebox && isResponderOrDispatcher && (
                    <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                      <span className="text-slate-600">
                        Nearest AED Cabinet: <strong>{pulsebox.name}</strong>
                      </span>
                      <button
                        type="button"
                        onClick={() => handleToggleAed(inc.id)}
                        className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 ${
                          pulsebox.aedUnlocked
                            ? 'bg-emerald-600 text-white'
                            : 'bg-slate-900 hover:bg-slate-800 text-white'
                        }`}
                      >
                        {pulsebox.aedUnlocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                        {pulsebox.aedUnlocked ? 'AED Solenoid Unlocked' : 'Unlock PulseBox AED Bay'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Right: 110 BPM CPR Metronome & Section 134A Protection */}
        <div className="lg:col-span-4 space-y-5">
          <div className="clinical-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-rose-600" />
                <h3 className="text-sm font-bold text-slate-900">AHA 110 BPM CPR Pacer</h3>
              </div>
              <span className="font-mono text-xs font-bold text-slate-700 tabular-nums">{cprBeats} compressions</span>
            </div>
            <p className="text-xs text-slate-500">
              OHCA survival drops 7–10%/min without CPR. Start continuous 5–6 cm chest compressions synced to 110 BPM.
            </p>
            <button
              type="button"
              onClick={() => {
                if (!cprActive) setCprBeats(0);
                setCprActive((v) => !v);
              }}
              className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold transition-colors ${
                cprActive
                  ? 'bg-rose-600 hover:bg-rose-700 text-white'
                  : 'bg-slate-900 hover:bg-slate-800 text-white'
              }`}
            >
              {cprActive ? 'Stop 110 BPM Metronome' : 'Start 110 BPM CPR Audio Pacer'}
            </button>
          </div>

          <div className="clinical-card p-5 space-y-3">
            <div className="flex items-center gap-2">
              <HeartHandshake className="w-4 h-4 text-blue-700" />
              <h3 className="text-sm font-bold text-slate-900">Statutory Good Samaritan Shield</h3>
            </div>
            <ul className="space-y-2 text-xs text-slate-600">
              <li className="flex items-start gap-2">
                <Award className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                <span><strong>Section 134A MV Act (2019)</strong> &amp; MoRTH 2020 Good Samaritan Rules statutory immunity.</span>
              </li>
              <li className="flex items-start gap-2">
                <ShieldCheck className="w-3.5 h-3.5 text-blue-700 shrink-0 mt-0.5" />
                <span><strong>₹10,00,000 ($12K)</strong> platform professional indemnity policy activated automatically per dispatch.</span>
              </li>
              <li className="flex items-start gap-2">
                <Lock className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
                <span><strong>Tier B Guardrail:</strong> Final-year MBBS &amp; wardens operate strictly within AHA BLS &amp; AED scope.</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
