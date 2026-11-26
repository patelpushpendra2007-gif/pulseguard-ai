import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';

export const dynamic = 'force-dynamic';

interface DispatchNotifyBody {
  incidentId?: string;
  emergencyEmail?: string;
  victimName?: string;
  triggerType?: string;
  lat?: number;
  lng?: number;
  geohash?: string;
  hrBpm?: number | null;
  spo2Pct?: number | null;
  hrvRmssdMs?: number | null;
  payloadSha256?: string;
  smsFrame52BBase64?: string;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey.trim().length < 5) {
    return NextResponse.json(
      {
        configured: false,
        sent: false,
        message: 'RESEND_API_KEY is not configured — email dispatch skipped gracefully.',
      },
      { status: 200 }
    );
  }

  let body: DispatchNotifyBody;
  try {
    body = (await req.json()) as DispatchNotifyBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
  }

  const emergencyEmail = body.emergencyEmail?.trim();
  if (!emergencyEmail || !emergencyEmail.includes('@')) {
    return NextResponse.json(
      {
        configured: true,
        sent: false,
        message: 'No valid emergency contact email provided on victim profile.',
      },
      { status: 200 }
    );
  }

  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'Valid lat/lng coordinates are required.' }, { status: 400 });
  }

  const victimName = escapeHtml(body.victimName || 'PulseGuard Citizen');
  const triggerType = escapeHtml(body.triggerType || 'MANUAL_SOS');
  const geohash = escapeHtml(body.geohash || 'UNKNOWN');
  const incidentId = escapeHtml(body.incidentId || 'PENDING');
  const payloadHash = escapeHtml(body.payloadSha256 || 'UNAVAILABLE');
  const smsFrame = escapeHtml(body.smsFrame52BBase64 || '');
  const mapsUrl = `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
  const hrStr = body.hrBpm != null ? `${Math.round(body.hrBpm)} BPM` : 'N/A';
  const spo2Str = body.spo2Pct != null ? `${Math.round(body.spo2Pct)}%` : 'N/A';
  const hrvStr = body.hrvRmssdMs != null ? `${Number(body.hrvRmssdMs).toFixed(1)} ms` : 'N/A';

  const resend = new Resend(apiKey);
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'PulseGuard AI <onboarding@resend.dev>';

  try {
    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: [emergencyEmail],
      subject: `CODE BLUE EMERGENCY ALERT: ${victimName} (${triggerType})`,
      text: [
        `PULSEGUARD AI — CODE BLUE EMERGENCY DISPATCH`,
        `Protected Person: ${body.victimName || 'PulseGuard Citizen'}`,
        `Incident ID: ${body.incidentId || 'PENDING'}`,
        `Trigger Mechanism: ${body.triggerType || 'MANUAL_SOS'}`,
        `Live GPS Coordinates: ${lat.toFixed(6)}, ${lng.toFixed(6)} (GeoHash: ${body.geohash || 'UNKNOWN'})`,
        `Live Google Maps: ${mapsUrl}`,
        `Vitals: HR ${hrStr} | SpO2 ${spo2Str} | HRV RMSSD ${hrvStr}`,
        `E2EE Payload SHA-256: ${body.payloadSha256 || 'UNAVAILABLE'}`,
        `52B Binary Frame (Base64): ${body.smsFrame52BBase64 || 'N/A'}`,
      ].join('\n'),
      html: `
        <div style="background:#05080F;color:#F8FAFC;font-family:Inter,system-ui,sans-serif;padding:24px;border-radius:12px;border:1px solid #EF4444;">
          <div style="display:inline-block;background:#991B1B;color:#FEE2E2;font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px;letter-spacing:0.06em;">
            CODE BLUE · AUTONOMOUS EMERGENCY DISPATCH
          </div>
          <h1 style="margin:14px 0 6px;font-size:22px;color:#FFFFFF;">Emergency Alert for ${victimName}</h1>
          <p style="margin:0 0 18px;color:#CBD5E1;font-size:14px;">
            Trigger: <strong style="color:#FCA5A5;">${triggerType}</strong> · Incident ID: <code>${incidentId}</code>
          </p>
          <div style="background:#0F172A;border:1px solid #1E293B;border-radius:10px;padding:16px;margin-bottom:16px;">
            <p style="margin:0 0 8px;font-size:13px;color:#94A3B8;">LIVE TELEMETRY &amp; LOCATION</p>
            <p style="margin:0 0 6px;font-size:15px;"><strong>GPS:</strong> ${lat.toFixed(6)}, ${lng.toFixed(6)} (GeoHash <code>${geohash}</code>)</p>
            <p style="margin:0 0 12px;font-size:15px;"><strong>Vitals:</strong> HR ${hrStr} · SpO2 ${spo2Str} · HRV RMSSD ${hrvStr}</p>
            <a href="${mapsUrl}" style="display:inline-block;background:#EF4444;color:#FFFFFF;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:8px;font-size:14px;">
              Open Live Location in Google Maps
            </a>
          </div>
          <div style="background:#0B1120;border:1px solid #1E293B;border-radius:8px;padding:12px;font-family:monospace;font-size:12px;color:#94A3B8;word-break:break-all;">
            <div>E2EE Verification SHA-256: <span style="color:#38BDF8;">${payloadHash}</span></div>
            <div style="margin-top:6px;">52-Byte AES-256-GCM Frame: <span style="color:#34D399;">${smsFrame}</span></div>
          </div>
        </div>
      `,
    });

    if (error) {
      return NextResponse.json(
        { configured: true, sent: false, error: error.message },
        { status: 502 }
      );
    }

    return NextResponse.json({
      configured: true,
      sent: true,
      emailId: data?.id ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      {
        configured: true,
        sent: false,
        error: err instanceof Error ? err.message : 'Failed to transmit email via Resend.',
      },
      { status: 500 }
    );
  }
}
