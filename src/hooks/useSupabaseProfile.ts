'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSupabaseBrowserClient, isSupabaseClientConfigured } from '@/lib/supabase/client';
import type { Profile } from '@/types/pulseguard';

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
    } else if (data) {
      setError(null);
      setProfile(data as Profile);
    } else {
      // Ensure profile row exists if auth trigger hasn't fired or user existed prior to schema setup
      const meta = activeSession.user.user_metadata || {};
      const fallbackRole = ['citizen', 'responder', 'dispatcher', 'admin'].includes(meta.role)
        ? meta.role
        : 'citizen';
      const { data: inserted, error: insertErr } = await supabase
        .from('profiles')
        .upsert(
          {
            id: activeSession.user.id,
            email: activeSession.user.email || '',
            full_name: meta.full_name || activeSession.user.email?.split('@')[0] || 'User',
            role: fallbackRole,
            responder_tier: meta.responder_tier || null,
            nmc_registration_id: meta.nmc_registration_id || null,
            abdm_hpr_id: meta.abdm_hpr_id || null,
            bls_certification_id: meta.bls_certification_id || null,
            specialty: meta.specialty || null,
          },
          { onConflict: 'id' }
        )
        .select('*')
        .single();

      if (insertErr) {
        setError(insertErr.message);
      } else {
        setError(null);
        setProfile(inserted as Profile);
      }
    }
    setLoading(false);
  }, []);

  const refreshProfile = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
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
