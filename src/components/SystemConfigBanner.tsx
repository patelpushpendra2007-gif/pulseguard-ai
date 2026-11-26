'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Settings2, ChevronDown, ChevronUp } from 'lucide-react';
import type { ConfigHealthStatus } from '@/types/pulseguard';

export default function SystemConfigBanner() {
  const [status, setStatus] = useState<ConfigHealthStatus | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/health/config', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ConfigHealthStatus | null) => {
        if (active && data) setStatus(data);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (!status) return null;

  const missingCount = [
    !status.supabaseUrlConfigured,
    !status.supabaseAnonKeyConfigured,
    !status.resendConfigured,
    !status.geminiConfigured,
    !status.iotWebhookSecretConfigured,
  ].filter(Boolean).length;

  if (missingCount === 0) return null;

  const items = [
    {
      key: 'NEXT_PUBLIC_SUPABASE_URL',
      ok: status.supabaseUrlConfigured,
      detail: 'Required for Supabase Auth, PostgreSQL & Realtime',
    },
    {
      key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      ok: status.supabaseAnonKeyConfigured,
      detail: 'Required for client Row-Level Security queries',
    },
    {
      key: 'RESEND_API_KEY',
      ok: status.resendConfigured,
      detail: 'Required for emergency family Code Blue email dispatch',
    },
    {
      key: 'GEMINI_API_KEY',
      ok: status.geminiConfigured,
      detail: 'Optional for live clinical AHA triage protocol guidance',
    },
    {
      key: 'IOT_WEBHOOK_SECRET',
      ok: status.iotWebhookSecretConfigured,
      detail: 'Required for authenticated ESP32-S3 OBD-II & PulseBox webhooks',
    },
  ];

  return (
    <div className="border-b border-amber-500/30 bg-amber-950/35 text-amber-100">
      <div className="mx-auto max-w-7xl px-4 py-2.5 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs sm:text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
            <span className="font-semibold text-amber-200">System Configuration Status:</span>
            <span className="text-amber-100/90">
              {missingCount} environment variable{missingCount > 1 ? 's' : ''} not yet configured.
              On-device Edge AI &amp; Web Crypto run locally; configure keys in{' '}
              <code className="rounded bg-amber-900/50 px-1.5 py-0.5 font-mono text-xs">.env.local</code>{' '}
              or Vercel Settings for full cloud dispatch.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-900/40 px-2.5 py-1 text-xs font-medium text-amber-200 hover:bg-amber-900/70"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Checklist
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>

        {expanded && (
          <div className="mt-3 grid grid-cols-1 gap-2 border-t border-amber-500/20 pt-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <div
                key={item.key}
                className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-2 text-xs"
              >
                {item.ok ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                )}
                <div>
                  <div className="font-mono font-semibold text-slate-100">{item.key}</div>
                  <div className="text-slate-400">{item.detail}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
