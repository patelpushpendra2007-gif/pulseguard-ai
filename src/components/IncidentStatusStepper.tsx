import { Check, KeyRound, MapPin, Siren, Truck } from 'lucide-react';
import type { Incident } from '@/types/pulseguard';

interface IncidentStatusStepperProps {
  incident: Incident;
}

function formatTimestamp(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function IncidentStatusStepper({ incident }: IncidentStatusStepperProps) {
  const assigned = Boolean(incident.accepted_at || incident.responder_id);
  const enRoute = Boolean(
    incident.en_route_at ||
      ['EN_ROUTE', 'STABILIZED', 'CLOSED'].includes(incident.status)
  );
  const stabilized = Boolean(
    incident.stabilized_at || ['STABILIZED', 'CLOSED'].includes(incident.status)
  );
  const revoked = Boolean(incident.ephemeral_key_revoked || incident.ephemeral_key_revoked_at);
  const steps = [
    { label: 'SOS Triggered', complete: Boolean(incident.created_at), time: incident.created_at, icon: Siren },
    { label: 'Responder Assigned', complete: assigned, time: incident.accepted_at, icon: MapPin },
    { label: 'En Route', complete: enRoute, time: incident.en_route_at, icon: Truck },
    { label: 'Stabilized', complete: stabilized, time: incident.stabilized_at, icon: Check },
    {
      label: 'Keys Revoked',
      complete: revoked,
      time: incident.ephemeral_key_revoked_at ?? incident.closed_at,
      icon: KeyRound,
    },
  ];
  const activeIndex = steps.findIndex((step) => !step.complete);

  return (
    <section
      className="overflow-hidden rounded-2xl border border-slate-800 bg-[#0B1120] p-4 sm:p-5"
      aria-label="Incident response timeline"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-white">Live response timeline</h2>
        <span className="font-mono text-[10px] text-slate-400">
          {incident.status.replace(/_/g, ' ')}
        </span>
      </div>
      <div className="mt-4 overflow-x-auto pb-2">
        <ol className="flex min-w-[680px]">
          {steps.map((step, index) => {
            const Icon = step.icon;
            const isCurrent = index === activeIndex;
            const timestamp = formatTimestamp(step.time);
            return (
              <li
                key={step.label}
                aria-current={isCurrent ? 'step' : undefined}
                className="flex flex-1 flex-col items-center text-center"
              >
                <div className="flex w-full items-center">
                  <span
                    className={`h-0.5 flex-1 ${
                      index === 0 || steps[index - 1].complete ? 'bg-cyan-500' : 'bg-slate-700'
                    }`}
                  />
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${
                      step.complete
                        ? 'border-cyan-400 bg-cyan-500 text-slate-950'
                        : isCurrent
                          ? 'border-cyan-400 bg-cyan-950 text-cyan-200 ring-4 ring-cyan-500/10'
                          : 'border-slate-700 bg-slate-900 text-slate-500'
                    }`}
                  >
                    {step.complete ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                  </span>
                  <span
                    className={`h-0.5 flex-1 ${
                      step.complete && steps[index + 1]?.complete
                        ? 'bg-cyan-500'
                        : 'bg-slate-700'
                    }`}
                  />
                </div>
                <span
                  className={`mt-2 px-1 text-[11px] font-semibold ${
                    step.complete || isCurrent ? 'text-slate-100' : 'text-slate-500'
                  }`}
                >
                  {step.label}
                </span>
                <span className="mt-0.5 font-mono text-[10px] text-slate-500">
                  {timestamp || (step.complete ? 'Complete' : isCurrent ? 'In progress' : 'Pending')}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
