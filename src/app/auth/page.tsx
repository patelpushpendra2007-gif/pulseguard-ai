'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, Lock, UserPlus, LogIn, AlertCircle, CheckCircle2 } from 'lucide-react';
import AppNavbar from '@/components/AppNavbar';
import { useSupabaseProfile } from '@/hooks/useSupabaseProfile';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import type { ResponderTier, UserRole } from '@/types/pulseguard';

const ROLE_DEFAULT_ROUTE: Record<UserRole, string> = {
  citizen: '/portal/citizen',
  responder: '/portal/responder',
  dispatcher: '/portal/command',
  admin: '/portal/governance',
};

export default function AuthPage() {
  const router = useRouter();
  const { configured, profile, refreshProfile } = useSupabaseProfile();

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<UserRole>('citizen');
  const [responderTier, setResponderTier] = useState<ResponderTier>('TIER_A_NMC');
  const [nmcId, setNmcId] = useState('');
  const [abdmHprId, setAbdmHprId] = useState('');
  const [blsCertId, setBlsCertId] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      router.replace(ROLE_DEFAULT_ROUTE[profile.role]);
    }
  }, [profile, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setErrorMsg(
        'Supabase environment variables (NEXT_PUBLIC_SUPABASE_URL & NEXT_PUBLIC_SUPABASE_ANON_KEY) are not configured.'
      );
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        await refreshProfile();
      } else {
        // Generate real user public ECDH P-256 key on signup
        let ecdhPublicKeyJwk: JsonWebKey | null = null;
        if (window.crypto?.subtle) {
          const kp = await crypto.subtle.generateKey(
            { name: 'ECDH', namedCurve: 'P-256' },
            true,
            ['deriveBits']
          );
          ecdhPublicKeyJwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
        }

        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              full_name: fullName.trim() || email.split('@')[0],
              role,
              responder_tier: role === 'responder' ? responderTier : null,
              nmc_registration_id:
                role === 'responder' && responderTier === 'TIER_A_NMC' ? nmcId.trim() : null,
              abdm_hpr_id:
                role === 'responder' && responderTier === 'TIER_A_NMC' ? abdmHprId.trim() : null,
              bls_certification_id:
                role === 'responder' && responderTier === 'TIER_B_BLS' ? blsCertId.trim() : null,
              specialty: role === 'responder' ? specialty.trim() : null,
            },
          },
        });
        if (error) throw error;

        if (data.session?.user) {
          await supabase
            .from('profiles')
            .update({ ecdh_public_key_jwk: ecdhPublicKeyJwk })
            .eq('id', data.session.user.id);
          await refreshProfile();
        } else {
          setInfoMsg(
            'Account created. Check your email inbox to confirm your address before signing in (or disable email confirmation in Supabase Auth settings for rapid testing).'
          );
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#05080F] text-slate-100">
      <AppNavbar profile={profile} />

      <main className="mx-auto max-w-xl px-4 py-12 sm:px-6">
        <div className="rounded-2xl border border-slate-800 bg-[#0B1120] p-6 sm:p-8">
          <div className="flex items-center gap-2 font-mono text-xs text-cyan-400">
            <Lock className="h-4 w-4" />
            SUPABASE AUTH · ROW-LEVEL SECURITY · MULTI-ROLE
          </div>
          <h1 className="mt-2 text-2xl font-bold text-white">
            {mode === 'signin' ? 'Sign In to PulseGuard AI' : 'Create Authenticated Mesh Identity'}
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            Every account provisions a PostgreSQL profile protected by Supabase RLS policies.
          </p>

          {!configured && (
            <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-950/40 p-3.5 text-xs text-amber-200">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <div>
                Configure <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
                <code className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> and execute{' '}
                <code className="font-mono">supabase/schema.sql</code> to enable live authentication.
              </div>
            </div>
          )}

          <div className="mt-5 grid grid-cols-2 gap-2 rounded-xl border border-slate-800 bg-slate-950 p-1">
            <button
              type="button"
              onClick={() => setMode('signin')}
              className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition ${
                mode === 'signin'
                  ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <LogIn className="h-3.5 w-3.5" />
              Sign In
            </button>
            <button
              type="button"
              onClick={() => setMode('signup')}
              className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition ${
                mode === 'signup'
                  ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <UserPlus className="h-3.5 w-3.5" />
              Register Identity
            </button>
          </div>

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            {mode === 'signup' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-300">Full Legal Name</label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Dr. Priya Sharma"
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300">Operational Role</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as UserRole)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none"
                  >
                    <option value="citizen">Citizen / Safety Sentinel (Portal A)</option>
                    <option value="responder">Doctor / Nurse / BLS Responder (Portal B)</option>
                    <option value="dispatcher">Smart City Police 112 Dispatcher (Portal C)</option>
                    <option value="admin">IoT Hardware &amp; DPDP Governance Admin (Portal D)</option>
                  </select>
                </div>

                {role === 'responder' && (
                  <div className="space-y-3 rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4">
                    <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300">
                      <ShieldCheck className="h-4 w-4" />
                      Responder Clinical Credential Tier
                    </div>
                    <select
                      value={responderTier}
                      onChange={(e) => setResponderTier(e.target.value as ResponderTier)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="TIER_A_NMC">
                        Tier A — Licensed NMC/NMR Doctor, Nurse, or CRMI
                      </option>
                      <option value="TIER_B_BLS">
                        Tier B — AHA / Red Cross Certified BLS/CPR Volunteer
                      </option>
                    </select>

                    {responderTier === 'TIER_A_NMC' ? (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="block text-[11px] text-slate-300">
                            NMC / NMR Registration ID
                          </label>
                          <input
                            type="text"
                            required
                            value={nmcId}
                            onChange={(e) => setNmcId(e.target.value)}
                            placeholder="NMC-DEL-XXXX"
                            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-300">
                            ABDM HPR ID (Optional)
                          </label>
                          <input
                            type="text"
                            value={abdmHprId}
                            onChange={(e) => setAbdmHprId(e.target.value)}
                            placeholder="HPR-XX-XXXX"
                            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
                          />
                        </div>
                      </div>
                    ) : (
                      <div>
                        <label className="block text-[11px] text-slate-300">
                          AHA / Red Cross BLS Certification ID
                        </label>
                        <input
                          type="text"
                          required
                          value={blsCertId}
                          onChange={(e) => setBlsCertId(e.target.value)}
                          placeholder="AHA-BLS-XXXX"
                          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-[11px] text-slate-300">Clinical Specialty</label>
                      <input
                        type="text"
                        value={specialty}
                        onChange={(e) => setSpecialty(e.target.value)}
                        placeholder="e.g. Emergency Medicine / Cardiology / BLS First Aid"
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                  </div>
                )}
              </>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-300">Email Address</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@organization.org"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300">Password</label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 6 characters"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
              />
            </div>

            {errorMsg && (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-950/40 p-3 text-xs text-red-200">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                <span>{errorMsg}</span>
              </div>
            )}

            {infoMsg && (
              <div className="flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-950/40 p-3 text-xs text-emerald-200">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                <span>{infoMsg}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !configured}
              className="w-full rounded-xl bg-cyan-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting
                ? 'Authenticating with Supabase...'
                : mode === 'signin'
                  ? 'Sign In'
                  : 'Register & Provision RLS Profile'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
