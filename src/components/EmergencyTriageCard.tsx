'use client';

import { useEffect, useState } from 'react';
import { BrainCircuit } from 'lucide-react';
import { FALLBACK_EMERGENCY_TRIAGE, isEmergencyTriageGuidance } from '@/lib/emergency-triage';
import type { EmergencyTriageGuidance, TriggerType } from '@/types/pulseguard';

interface EmergencyTriageCardProps {
  incidentId: string;
  accessToken: string | null;
  incidentType: TriggerType;
  heartRate: number | null;
  bloodGroup: string | null;
  allergies: string | null;
}

export default function EmergencyTriageCard({
  incidentId,
  accessToken,
  incidentType,
  heartRate,
  bloodGroup,
  allergies,
}: EmergencyTriageCardProps) {
  const [result, setResult] = useState<{
    key: string;
    guidance: EmergencyTriageGuidance;
  } | null>(null);
  const requestKey = JSON.stringify([
    incidentId,
    accessToken,
    incidentType,
    heartRate,
    bloodGroup,
    allergies,
  ]);

  useEffect(() => {
    if (!accessToken) return;

    const controller = new AbortController();

    void fetch('/api/triage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        incidentId,
        incidentType,
        heartRate,
        bloodGroup,
        allergies,
      }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Triage service unavailable.');
        const result: unknown = await response.json();
        if (!isEmergencyTriageGuidance(result)) {
          throw new Error('Triage response was incomplete.');
        }
        setResult({ key: requestKey, guidance: result });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setResult({
            key: requestKey,
            guidance: {
              ...FALLBACK_EMERGENCY_TRIAGE,
              notice: 'AI guidance is unavailable; follow emergency professionals first.',
            },
          });
        }
      })

    return () => controller.abort();
  }, [accessToken, allergies, bloodGroup, heartRate, incidentId, incidentType, requestKey]);

  const currentResult = result?.key === requestKey ? result.guidance : null;
  const guidance = currentResult ??
    (accessToken
      ? FALLBACK_EMERGENCY_TRIAGE
      : {
          ...FALLBACK_EMERGENCY_TRIAGE,
          notice: 'AI guidance is unavailable; follow emergency professionals first.',
        });
  const loading = Boolean(accessToken && !currentResult);

  return (
    <section className="rounded-2xl border border-cyan-700/50 bg-cyan-950/20 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-cyan-100">
          <BrainCircuit className="h-4 w-4 text-cyan-300" />
          Emergency response guidance
        </h2>
        <span className="rounded-full border border-slate-700 px-2.5 py-1 font-mono text-[10px] text-slate-300">
          {loading ? 'PREPARING' : guidance.source === 'gemini' ? 'GEMINI AI' : 'SAFETY FALLBACK'}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-emerald-800/60 bg-slate-950/60 p-4">
          <h3 className="text-xs font-bold uppercase tracking-wide text-emerald-300">
            Responder checklist
          </h3>
          <ul className="mt-2 list-disc space-y-2 pl-4 text-xs leading-relaxed text-slate-200">
            {guidance.responderBullets.map((item, index) => (
              <li key={`${index}-${item}`}>{item}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-blue-800/60 bg-slate-950/60 p-4">
          <h3 className="text-xs font-bold uppercase tracking-wide text-blue-300">
            Calm first-aid steps
          </h3>
          <ul className="mt-2 list-disc space-y-2 pl-4 text-xs leading-relaxed text-slate-200">
            {guidance.citizenSteps.map((item, index) => (
              <li key={`${index}-${item}`}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
        Decision support only, not a diagnosis. Call 112/108 in India and follow dispatcher and
        trained responder instructions.
      </p>
      {guidance.notice && (
        <p className="mt-1 text-[11px] text-amber-300">{guidance.notice}</p>
      )}
    </section>
  );
}
