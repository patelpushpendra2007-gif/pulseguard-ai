'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient, isSupabaseClientConfigured } from '@/lib/supabase/client';
import type { Profile, UserRole } from '@/types/pulseguard';

export interface SupabaseProfileState {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  error: string | null;
  refreshProfile: () => Promise<void>;
}

export function useSupabaseProfile(): SupabaseProfileState {
  const [configured] = useState(() => isSupabaseClientConfigured());
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async (activeSession: Session | null) => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !activeSession?.user) {
      setProfile(null);
      setError(null);
      setLoading(false);
      return;
    }

    const { data, error: queryErr } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', activeSession.user.id)
      .maybeSingle();

    if (queryErr) {
      setError(queryErr.message);
      setProfile(null);
    } else if (data) {
      setError(null);
      setProfile(data as Profile);
    } else {
      setProfile(null);
      setError('Your profile was not provisioned. Contact your PulseGuard administrator.');
    }
    setLoading(false);
  }, []);

  const refreshProfile = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    setLoading(true);
    const { data } = await supabase.auth.getSession();
    setSession(data.session);
    await fetchProfile(data.session);
  }, [fetchProfile]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let mounted = true;
    if (!configured || !supabase) {
      Promise.resolve().then(() => {
        if (mounted) setLoading(false);
      });
      return () => {
        mounted = false;
      };
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      fetchProfile(data.session);
    });

    const { data: authSub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      fetchProfile(nextSession);
    });

    return () => {
      mounted = false;
      authSub.subscription.unsubscribe();
    };
  }, [configured, fetchProfile]);

  return {
    configured,
    loading,
    session,
    profile,
    error,
    refreshProfile,
  };
}

const ROLE_DEFAULT_ROUTE: Record<UserRole, string> = {
  citizen: '/portal/citizen',
  responder: '/portal/responder',
  dispatcher: '/portal/command',
  admin: '/portal/governance',
};

export function usePortalAccess(allowedRole: UserRole | readonly UserRole[]) {
  const router = useRouter();
  const state = useSupabaseProfile();
  const allowedRoles = Array.isArray(allowedRole) ? allowedRole : [allowedRole];
  const allowedRoleKey = allowedRoles.join(',');
  const authorized = Boolean(state.profile && allowedRoles.includes(state.profile.role));

  useEffect(() => {
    if (state.loading) return;
    if (!state.profile) {
      router.replace('/auth');
    } else if (!allowedRoleKey.split(',').includes(state.profile.role)) {
      router.replace(ROLE_DEFAULT_ROUTE[state.profile.role]);
    }
  }, [allowedRoleKey, router, state.loading, state.profile]);

  return { ...state, authorized };
}
