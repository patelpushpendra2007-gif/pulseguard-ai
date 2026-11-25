import React, { useState } from 'react';
import {
  Car,
  Cpu,
  Package,
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  Wrench,
  Lock,
  Unlock
} from 'lucide-react';
import { evaluateCrashTelemetry, CRASH_PRESETS } from '@shared/crashPhysics';
import { HARDWARE_SKUS, MICRO_ZONES } from '@shared/domainData';
import { apiRequest } from '../lib/api';
import { clinicalAudio } from '../lib/sound';

export default function ModelsLabView({ user, zoneId, zoneSnapshot, onIncidentCreated, onRefreshData }) {
  const [telemetry, setTelemetry] = useState(CRASH_PRESETS.normal);
  const [dispatchStatus, setDispatchStatus] = useState('');

  const crashEval = evaluateCrashTelemetry(telemetry);
  const pulsebox = zoneSnapshot?.pulseboxes?.[0];

  const handleDispatchCrash = async () => {
    setDispatchStatus('');
    try {
      const zone = MICRO_ZONES[zoneId] || MICRO_ZONES.aiims_delhi;
      const res = await apiRequest('/incidents/trigger', {
        method: 'POST',
        body: {
          microZone: zone.id,
          lat: zone.lat,
          lng: zone.lng,
          triggerType: 'CRASH_OBD',
          transportMode: '4G_WS',
          vitals: {
            hrBpm: 136,
            spo2Pct: 95,
            linearImuG: crashEval.metrics.gPeak,
            canDeltaV: crashEval.metrics.canDeltaV,
            rollDeg: crashEval.metrics.maxTiltDeg
          },
          evidenceNote: crashEval.explanation
        }
      });
      clinicalAudio.alertChime();
      onIncidentCreated?.(res.incident);
      setDispatchStatus(`Crash eCall ${res.incident.id} dispatched from OBD-II Pro telemetry!`);
    } catch (err) {
      setDispatchStatus(err.message);
    }
  };

  const handleSupplyAction = async (supplyId, action) => {
    if (!pulsebox) return;
    try {
      await apiRequest(`/pulsebox/${pulsebox.id}/consume-supply`, {
        method: 'POST',
        body: { supplyId, action }
      });
      onRefreshData?.();
    } catch (err) {
      setDispatchStatus(err.message);
    }
  };

  return (
    <div className="space-y-6">
      {dispatchStatus && (
        <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs font-medium flex items-center justify-between">
          <span>{dispatchStatus}</span>
          <button type="button" onClick={() => setDispatchStatus('')} className="font-bold ml-4">
            Dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Real OBD-II CAN-Bus + LSM6DSO Crash Physics Model */}
        <div className="lg:col-span-7 clinical-card p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Car className="w-5 h-5 text-blue-700" />
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  Automotive Collision Physics Model (LSM6DSO IMU + SN65HVD230 CAN-Bus)
                </h2>
                <p className="text-xs text-slate-500">
                  Crash = (G_peak &gt; 10G ≥20ms ∧ CAN Δv ≥ 25 km/h in &lt;150ms) ∨ (Rollover θ &gt; 60° ∨ ω &gt; 90°/s)
                </p>
              </div>
            </div>

            <span
              className={`badge-pill ${
                crashEval.crashTriggered
                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                  : crashEval.verdict === 'POTHOLE_BUMP_REJECTED'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-slate-100 text-slate-700 border-slate-200'
              }`}
            >
              {crashEval.verdict.replaceAll('_', ' ')}
            </span>
          </div>

          {/* Preset Test Scenarios */}
          <div className="flex flex-wrap gap-2">
            {Object.entries(CRASH_PRESETS).map(([key, preset]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTelemetry(preset)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  telemetry.label === preset.label
                    ? 'bg-blue-700 text-white border-blue-700'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Interactive Physics Sliders */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-600">X-Axis Longitudinal Impact (Gx)</span>
                <span className="font-mono font-bold text-slate-900">{telemetry.gx.toFixed(1)} G</span>
              </div>
              <input
                type="range"
                min={0}
                max={18}
                step={0.2}
                value={telemetry.gx}
                onChange={(e) => setTelemetry((p) => ({ ...p, label: 'Custom', gx: Number(e.target.value) }))}
                className="w-full accent-blue-700"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-600">Impact Impulse Duration</span>
                <span className="font-mono font-bold text-slate-900">{telemetry.impactDurationMs} ms</span>
              </div>
              <input
                type="range"
                min={0}
                max={80}
                step={1}
                value={telemetry.impactDurationMs}
                onChange={(e) => setTelemetry((p) => ({ ...p, label: 'Custom', impactDurationMs: Number(e.target.value) }))}
                className="w-full accent-blue-700"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-600">Post-Impact CAN Speed (from {telemetry.speedBeforeKmh} km/h)</span>
                <span className="font-mono font-bold text-slate-900">
                  {telemetry.speedAfterKmh} km/h (Δv {crashEval.metrics.canDeltaV})
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={telemetry.speedBeforeKmh}
                step={1}
                value={telemetry.speedAfterKmh}
                onChange={(e) => setTelemetry((p) => ({ ...p, label: 'Custom', speedAfterKmh: Number(e.target.value) }))}
                className="w-full accent-blue-700"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-600">Vehicle Rollover Tilt (θ) / Rate (ω)</span>
                <span className="font-mono font-bold text-slate-900">
                  {telemetry.rollDeg}° / {telemetry.omegaDegSec}°/s
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={95}
                step={1}
                value={telemetry.rollDeg}
                onChange={(e) =>
                  setTelemetry((p) => ({
                    ...p,
                    label: 'Custom',
                    rollDeg: Number(e.target.value),
                    omegaDegSec: Number(e.target.value) > 60 ? 115 : 18
                  }))
                }
                className="w-full accent-blue-700"
              />
            </div>
          </div>

          {/* Decision Explanation & Predicates */}
          <div
            className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
              crashEval.crashTriggered
                ? 'bg-rose-50 border-rose-200 text-rose-900'
                : 'bg-slate-50 border-slate-200 text-slate-700'
            }`}
          >
            {crashEval.crashTriggered ? (
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            )}
            <div className="space-y-1">
              <div className="font-semibold">{crashEval.explanation}</div>
              <div className="font-mono text-[11px] opacity-85">
                G_peak={crashEval.metrics.gPeak}G · CAN Δv={crashEval.metrics.canDeltaV} km/h · Tilt={crashEval.metrics.maxTiltDeg}°
              </div>
            </div>
          </div>

          {/* Live Decoded OBD-II CAN Frames */}
          <div className="clinical-inset p-3 space-y-2">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              Live Decoded SN65HVD230 OBD-II CAN 2.0B Bus Frames
            </div>
            <div className="space-y-1.5">
              {crashEval.canFrames.map((f, i) => (
                <div key={i} className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono bg-white px-3 py-1.5 rounded-lg border border-slate-200">
                  <span className="text-blue-700 font-bold">{f.arbId}</span>
                  <span className="text-slate-800">{f.raw}</span>
                  <span className="text-slate-500 font-sans">{f.decoded}</span>
                </div>
              ))}
            </div>
          </div>

          {crashEval.crashTriggered && (
            <button
              type="button"
              onClick={handleDispatchCrash}
              className="w-full py-2.5 px-4 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2"
            >
              <ShieldAlert className="w-4 h-4" /> Dispatch Verified eCall Incident to GeoHash Mesh
            </button>
          )}
        </div>

        {/* Right: PulseBox Smart Triage Cabinet Load-Cell Tracker */}
        <div className="lg:col-span-5 clinical-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className="w-5 h-5 text-teal-700" />
              <div>
                <h3 className="text-sm font-bold text-slate-900">PulseBox Smart Triage Cabinet</h3>
                <p className="text-xs text-slate-500">{pulsebox?.name || 'Loading cabinet...'}</p>
              </div>
            </div>
            <span
              className={`badge-pill ${
                pulsebox?.aedUnlocked
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-slate-100 text-slate-700 border-slate-200'
              }`}
            >
              {pulsebox?.aedUnlocked ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
              {pulsebox?.aedUnlocked ? 'AED Open' : 'AED Secured'}
            </span>
          </div>

          <p className="text-xs text-slate-500">
            Live SQLite-backed optical/load-cell inventory. Hospital partners lease the clinical AED bay; cabinet BOM is ₹1,800 (64.0% GM).
          </p>

          <div className="space-y-2.5">
            {(pulsebox?.supplies || []).map((item) => (
              <div key={item.id} className="clinical-inset p-3 flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold text-slate-900">{item.name}</div>
                  <div className="text-[11px] font-mono text-slate-500">
                    Stock: <strong>{item.qty} / {item.max}</strong> · {item.weightGrams * item.qty}g load cell
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={item.qty === 0}
                    onClick={() => handleSupplyAction(item.id, 'consume')}
                    className="px-2.5 py-1 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 disabled:opacity-40 text-xs font-semibold text-slate-800"
                  >
                    Use 1
                  </button>
                  {item.qty < item.max && (
                    <button
                      type="button"
                      onClick={() => handleSupplyAction(item.id, 'restock')}
                      className="px-2.5 py-1 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold"
                    >
                      Restock
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Hardware SKU Ecosystem BOM & Margin Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {HARDWARE_SKUS.map((sku) => (
          <div key={sku.id} className="clinical-card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-blue-700">{sku.sku}</span>
              <span className="badge-pill bg-emerald-50 text-emerald-700 border-emerald-200 tabular-nums">
                {sku.grossMarginPct.toFixed(1)}% GM
              </span>
            </div>
            <div>
              <h4 className="text-sm font-bold text-slate-900">{sku.name}</h4>
              <p className="text-xs text-slate-500">{sku.category}</p>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] font-mono text-slate-700">
              {sku.chipset}
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs tabular-nums">
              <div className="clinical-inset p-2.5">
                <div className="text-slate-500 text-[11px]">Unit BOM</div>
                <div className="font-bold text-slate-900">₹{sku.bomInr.toLocaleString('en-IN')}</div>
              </div>
              <div className="clinical-inset p-2.5">
                <div className="text-slate-500 text-[11px]">Retail / Fleet</div>
                <div className="font-bold text-blue-700">₹{sku.retailInr.toLocaleString('en-IN')}</div>
              </div>
            </div>
            <ul className="space-y-1.5 text-xs text-slate-600 pt-1">
              {sku.features.map((feat, idx) => (
                <li key={idx} className="flex items-start gap-1.5">
                  <Wrench className="w-3 h-3 text-slate-400 shrink-0 mt-1" />
                  <span>{feat}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
