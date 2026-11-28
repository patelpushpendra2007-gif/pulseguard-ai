import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let browserClient: SupabaseClient | null = null;
const DEFAULT_SUPABASE_URL = 'https://cdqmwcyvorsopwfcokfg.supabase.co';

function isValidHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      !/your-|placeholder|example/i.test(value)
    );
  } catch {
    return false;
  }
}

function isValidAnonKey(value: string | undefined): value is string {
  return Boolean(value && value.trim().length > 10 && !/your-|placeholder|example/i.test(value));
}

export function isSupabaseClientConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return isValidHttpUrl(url) && isValidAnonKey(anonKey);
}

export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (typeof window === 'undefined') return null;
  if (browserClient) return browserClient;

  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!isValidHttpUrl(configuredUrl) || !isValidAnonKey(anonKey)) {
    return null;
  }

  browserClient = createClient(`${window.location.origin}/supabase-proxy`, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  });

  return browserClient;
}
