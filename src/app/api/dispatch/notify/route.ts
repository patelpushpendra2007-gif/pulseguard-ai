import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { getSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

interface DispatchNotifyBody {
  incidentId?: string;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function POST(req: NextRequest) {
  const accessToken = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!accessToken) {
    return NextResponse.json({ error: 'Authentication is required.' }, { status: 401 });
  }

  const supabase = getSupabaseServerClient(accessToken);
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase is not configured on the server.' }, { status: 503 });
  }

  const { data: userData, error: authError } = await supabase.auth.getUser(accessToken);
  if (authError || !userData.user) {
    return NextResponse.json({ error: 'Invalid or expired authentication session.' }, { status: 401 });
  }

  let body: DispatchNotifyBody;
  try {
    body = (await req.json()) as DispatchNotifyBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
  }
  if (!body.incidentId?.trim()) {
    return NextResponse.json({ error: 'incidentId is required.' }, { status: 400 });
  }

  const { data: incident, error: incidentError } = await supabase
    .from('incidents')
    .select(
      'id, victim_id, victim_name, emergency_contact_email, trigger_type, lat, lng, geohash, hr_bpm, spo2_pct, hrv_rmssd_ms, payload_sha256, sms_frame_52b_b64'
    )
    .eq('id', body.incidentId)
    .eq('victim_id', userData.user.id)
    .maybeSingle();

  if (incidentError) {
    return NextResponse.json({ error: incidentError.message }, { status: 500 });
  }
  if (!incident) {
    return NextResponse.json({ error: 'Incident not found for the authenticated user.' }, { status: 404 });
  }

  const emergencyEmail = incident.emergency_contact_email?.trim();
  if (!emergencyEmail || !emergencyEmail.includes('@')) {
    return NextResponse.json({
      configured: true,
      sent: false,
      message: 'No valid emergency contact email is saved on the incident.',
    });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL?.trim();
  if (!apiKey || apiKey.trim().length < 5 || !fromEmail) {
    return NextResponse.json(
      { configured: false, sent: false, message: 'Configure RESEND_API_KEY and RESEND_FROM_EMAIL to send alerts.' },
      { status: 503 }
    );
  }

  const victimName = escapeHtml(incident.victim_name);
  const triggerType = escapeHtml(incident.trigger_type);
  const incidentId = escapeHtml(incident.id);
  const geohash = escapeHtml(incident.geohash);
  const payloadHash = escapeHtml(incident.payload_sha256);
  const smsFrame = escapeHtml(incident.sms_frame_52b_b64);
  const mapsUrl = `https://www.google.com/maps?q=${incident.lat.toFixed(6)},${incident.lng.toFixed(6)}`;
  const hrStr = incident.hr_bpm != null ? `${incident.hr_bpm} BPM` : 'Not measured';
  const spo2Str = incident.spo2_pct != null ? `${incident.spo2_pct}%` : 'Not measured';
  const hrvStr = incident.hrv_rmssd_ms != null ? `${incident.hrv_rmssd_ms} ms` : 'Not measured';

  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: [emergencyEmail],
      subject: `CODE BLUE EMERGENCY ALERT: ${incident.victim_name} (${incident.trigger_type})`,
      text: [
        'PULSEGUARD AI — CODE BLUE EMERGENCY DISPATCH',
        `Protected Person: ${incident.victim_name}`,
        `Incident ID: ${incident.id}`,
        `Trigger Mechanism: ${incident.trigger_type}`,
        `Live GPS Coordinates: ${incident.lat.toFixed(6)}, ${incident.lng.toFixed(6)} (GeoHash: ${incident.geohash})`,
        `Live Location: ${mapsUrl}`,
        `Vitals: HR ${hrStr} | SpO2 ${spo2Str} | HRV RMSSD ${hrvStr}`,
        `E2EE Payload SHA-256: ${incident.payload_sha256}`,
        `52B Binary Frame (Base64): ${incident.sms_frame_52b_b64}`,
      ].join('\n'),
      html: `
        <div style="background:#05080F;color:#F8FAFC;font-family:Inter,system-ui,sans-serif;padding:24px;border-radius:12px;border:1px solid #EF4444;">
          <h1 style="margin:14px 0 6px;font-size:22px;color:#FFFFFF;">Emergency Alert for ${victimName}</h1>
          <p style="margin:0 0 18px;color:#CBD5E1;font-size:14px;">
            Trigger: <strong style="color:#FCA5A5;">${triggerType}</strong> · Incident ID: <code>${incidentId}</code>
          </p>
          <div style="background:#0F172A;border:1px solid #1E293B;border-radius:10px;padding:16px;margin-bottom:16px;">
            <p style="margin:0 0 6px;font-size:15px;"><strong>GPS:</strong> ${incident.lat.toFixed(6)}, ${incident.lng.toFixed(6)} (GeoHash <code>${geohash}</code>)</p>
            <p style="margin:0 0 12px;font-size:15px;"><strong>Vitals:</strong> HR ${hrStr} · SpO2 ${spo2Str} · HRV RMSSD ${hrvStr}</p>
            <a href="${mapsUrl}">Open live location</a>
          </div>
          <div style="font-family:monospace;font-size:12px;word-break:break-all;">
            <div>E2EE Verification SHA-256: ${payloadHash}</div>
            <div>52-Byte AES-256-GCM Frame: ${smsFrame}</div>
          </div>
        </div>
      `,
    });

    if (error) {
      return NextResponse.json({ configured: true, sent: false, error: error.message }, { status: 502 });
    }

    return NextResponse.json({ configured: true, sent: true, emailId: data?.id ?? null });
  } catch (err) {
    return NextResponse.json(
      { configured: true, sent: false, error: err instanceof Error ? err.message : 'Email dispatch failed.' },
      { status: 500 }
    );
  }
}
