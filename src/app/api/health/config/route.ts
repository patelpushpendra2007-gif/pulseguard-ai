import { NextResponse } from 'next/server';
import type { ConfigHealthStatus } from '@/types/pulseguard';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabaseUrlConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_URL.startsWith('http')
  );
  const supabaseAnonKeyConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY.trim().length > 10
  );
  const supabaseServiceRoleConfigured = Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
      process.env.SUPABASE_SERVICE_ROLE_KEY.trim().length > 10
  );
  const resendConfigured = Boolean(
    process.env.RESEND_API_KEY && process.env.RESEND_API_KEY.trim().length > 5
  );
  const geminiConfigured = Boolean(
    process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 5
  );
  const iotWebhookSecretConfigured = Boolean(
    process.env.IOT_WEBHOOK_SECRET && process.env.IOT_WEBHOOK_SECRET.trim().length >= 8
  );

  const status: ConfigHealthStatus = {
    supabaseUrlConfigured,
    supabaseAnonKeyConfigured,
    supabaseServiceRoleConfigured,
    resendConfigured,
    geminiConfigured,
    iotWebhookSecretConfigured,
    allCoreConfigured:
      supabaseUrlConfigured &&
      supabaseAnonKeyConfigured &&
      resendConfigured &&
      iotWebhookSecretConfigured,
  };

  return NextResponse.json(status);
}
