'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  ShieldAlert,
  Activity,
  Stethoscope,
  RadioTower,
  Cpu,
  Wifi,
  WifiOff,
  LogOut,
  LogIn,
} from 'lucide-react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import type { Profile } from '@/types/pulseguard';

interface AppNavbarProps {
  profile: Profile | null;
}

const PORTALS = [
  { href: '/portal/citizen', label: 'A · Citizen Sentinel', icon: Activity },
  { href: '/portal/responder', label: 'B · Responder Mesh', icon: Stethoscope },
  { href: '/portal/command', label: 'C · 112 Command', icon: RadioTower },
  { href: '/portal/governance', label: 'D · IoT & DPDP', icon: Cpu },
];

function subscribeOnlineStatus(callback: () => void): () => void {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

export default function AppNavbar({ profile }: AppNavbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const isOnline = useSyncExternalStore(
    subscribeOnlineStatus,
    () => navigator.onLine,
    () => true
  );

  const handleSignOut = async () => {
    const supabase = getSupabaseBrowserClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
    router.push('/auth');
  };

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800/90 bg-[#05080F]/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2.5 group">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-red-500/40 bg-red-500/10 text-red-400 group-hover:bg-red-500/20">
              <ShieldAlert className="h-5 w-5" />
            </span>
            <div>
              <div className="flex items-center gap-2 text-sm font-bold tracking-tight text-white">
                PulseGuard AI
                <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-300">
                  REALTIME
                </span>
              </div>
              <div className="font-mono text-[10px] text-slate-400">
                EDGE SENTINEL · E2EE 52B · 112 MESH
              </div>
            </div>
          </Link>
        </div>

        <nav className="flex flex-wrap items-center gap-1.5">
          {PORTALS.map((portal) => {
            const Icon = portal.icon;
            const active = pathname === portal.href;
            return (
              <Link
                key={portal.href}
                href={portal.href}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                  active
                    ? 'border border-cyan-500/50 bg-cyan-500/15 text-cyan-200'
                    : 'border border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-700 hover:text-white'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{portal.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] font-medium ${
              isOnline
                ? 'border-emerald-500/30 bg-emerald-950/40 text-emerald-300'
                : 'border-red-500/40 bg-red-950/50 text-red-300'
            }`}
          >
            {isOnline ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {isOnline ? 'ONLINE' : 'OFFLINE FAILOVER'}
          </span>

          {profile ? (
            <div className="flex items-center gap-2">
              <div className="hidden text-right sm:block">
                <div className="text-xs font-semibold text-slate-100">{profile.full_name}</div>
                <div className="font-mono text-[10px] uppercase text-cyan-400">
                  {profile.role}
                  {profile.responder_tier ? ` · ${profile.responder_tier}` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={handleSignOut}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-red-500/50 hover:text-red-300"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign Out
              </button>
            </div>
          ) : (
            <Link
              href="/auth"
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/25"
            >
              <LogIn className="h-3.5 w-3.5" />
              Authenticate
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
