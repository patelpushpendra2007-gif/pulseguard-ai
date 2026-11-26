import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import ngeohash from 'ngeohash';
import { getSupabaseAdminClient, getSupabaseServerClient } from '@/lib/supabase/server';
import { evaluateCrashPhysics } from '@/lib/sensors/biometricFusion';
import type { HardwareNodeType, TriggerType } from '@/types/pulseguard';

export const dynamic = 'force-dynamic';

interface IotTelemetryPayload {
  device_uid: string;
  node_type?: HardwareNodeType;
  lat: number;
  lng: number;
  g_peak?: number;
  can_delta_v?: number;
  rollover_deg?: number;
  omega_deg_s?: number;
  dtc_code?: string;
  battery_pct?: number;
  hr_bpm?: number;
  spo2_pct?: number;
  manual_sos?: boolean;
  aed_status?: 'READY' | 'UNLOCKED' | 'IN_USE' | 'SERVICE_REQUIRED' | 'N/A';
}

function constantTimeSecretValid(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function buildServer52ByteSmsFrame(params: {
  lat: number;
  lng: number;
  deviceUid: string;
  hrBpm: number;
  spo2Pct: number;
  triggerCode: number;
  secretKeySeed: string;
}): { smsFrame52BBase64: string; encryptedPayloadBase64: string; payloadSha256Hex: string } {
  const telemetry = Buffer.alloc(24);
  telemetry.writeFloatBE(params.lat, 0);
  telemetry.writeFloatBE(params.lng, 4);
  telemetry.writeUInt32BE(Math.floor(Date.now() / 1000) >>> 0, 8);
  const idHash8 = crypto.createHash('sha256').update(params.deviceUid).digest().subarray(0, 8);
  idHash8.copy(telemetry, 12);
  telemetry.writeUInt8(Math.max(0, Math.min(255, Math.round(params.hrBpm))), 20);
  telemetry.writeUInt8(Math.max(0, Math.min(100, Math.round(params.spo2Pct))), 21);
  telemetry.writeUInt8(0, 22);
  telemetry.writeUInt8(params.triggerCode & 0x0f, 23);

  const key = crypto.createHash('sha256').update(params.secretKeySeed).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('PG-SMS52-V1'));
  const ct = Buffer.concat([cipher.update(telemetry), cipher.final()]);
  const tag = cipher.getAuthTag();
  const frame52 = Buffer.concat([iv, ct, tag]);
  const smsFrame52BBase64 = frame52.toString('base64');
  const payloadSha256Hex = crypto.createHash('sha256').update(frame52).digest('hex');

  return {
    smsFrame52BBase64,
    encryptedPayloadBase64: smsFrame52BBase64,
    payloadSha256Hex,
  };
}

export async function POST(req: NextRequest) {
  const expectedSecret = process.env.IOT_WEBHOOK_SECRET;
  if (!expectedSecret || expectedSecret.trim().length < 8) {
    return NextResponse.json(
      { error: 'IOT_WEBHOOK_SECRET is not configured on the server.' },
      { status: 503 }
    );
  }

  const headerSecret =
    req.headers.get('x-iot-secret') ||
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    '';

  if (!headerSecret || !constantTimeSecretValid(headerSecret, expectedSecret)) {
    return NextResponse.json({ error: 'Unauthorized hardware telemetry signature.' }, { status: 401 });
  }

  let body: IotTelemetryPayload;
  try {
    body = (await req.json()) as IotTelemetryPayload;
  } catch {
    return NextResponse.json({ error: 'Malformed JSON telemetry payload.' }, { status: 400 });
  }

  if (!body.device_uid || !Number.isFinite(body.lat) || !Number.isFinite(body.lng)) {
    return NextResponse.json(
      { error: 'Required fields: device_uid, lat, lng.' },
      { status: 400 }
    );
  }

  // Prefer server service-role client for headless ESP32-S3 hardware writes; fallback to forwarded user JWT if provided.
  const userJwt = req.headers.get('x-supabase-auth') || undefined;
  const supabase = getSupabaseAdminClient() ?? getSupabaseServerClient(userJwt);
  if (!supabase) {
    return NextResponse.json(
      { error: 'Supabase URL/key not configured on server.' },
      { status: 503 }
    );
  }

  const geohash = ngeohash.encode(body.lat, body.lng, 7);
  const nowIso = new Date().toISOString();

  const gPeak = Number(body.g_peak ?? 1.0);
  const canDeltaV = Number(body.can_delta_v ?? 0);
  const rolloverDeg = Number(body.rollover_deg ?? 0);
  const omegaDegS = Number(body.omega_deg_s ?? 0);

  const crashEval = evaluateCrashPhysics({
    gPeak,
    canDeltaVKmh: canDeltaV,
    tiltDeg: rolloverDeg,
    omegaDegSec: omegaDegS,
  });

  const isHardwareSos = Boolean(body.manual_sos) || crashEval.crashTriggered;
  const nodeStatus = isHardwareSos ? 'ALERT' : 'ONLINE';

  const { data: existingNode, error: lookupError } = await supabase
    .from('hardware_nodes')
    .select('id, owner_id, label, node_type')
    .eq('device_uid', body.device_uid)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json(
      {
        error: `Database lookup failed (${lookupError.message}). Ensure SUPABASE_SERVICE_ROLE_KEY is set for headless device webhooks.`,
      },
      { status: 500 }
    );
  }

  if (!existingNode) {
    return NextResponse.json(
      {
        error: `Device UID "${body.device_uid}" is not registered in hardware_nodes. Register the node first in Portal D.`,
      },
      { status: 404 }
    );
  }

  const { error: updateErr } = await supabase
    .from('hardware_nodes')
    .update({
      lat: body.lat,
      lng: body.lng,
      geohash,
      status: nodeStatus,
      aed_status: body.aed_status ?? undefined,
      battery_pct: body.battery_pct ?? undefined,
      last_ping_at: nowIso,
      last_telemetry: {
        g_peak: gPeak,
        can_delta_v: canDeltaV,
        rollover_deg: rolloverDeg,
        omega_deg_s: omegaDegS,
        dtc_code: body.dtc_code ?? null,
        manual_sos: Boolean(body.manual_sos),
        received_at: nowIso,
      },
    })
    .eq('id', existingNode.id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  let createdIncidentId: string | null = null;
  if (isHardwareSos) {
    const triggerType: TriggerType = body.manual_sos
      ? 'PULSEBOX_HARDWARE_SOS'
      : crashEval.triggerType ?? 'AUTOMOTIVE_CRASH_OBD';

    const { data: ownerProfile } = await supabase
      .from('profiles')
      .select('full_name, blood_group, allergies, emergency_contact_email, emergency_contact_phone')
      .eq('id', existingNode.owner_id)
      .maybeSingle();

    const triggerCode = triggerType === 'PULSEBOX_HARDWARE_SOS' ? 6 : 4;
    const cryptoPacket = buildServer52ByteSmsFrame({
      lat: body.lat,
      lng: body.lng,
      deviceUid: body.device_uid,
      hrBpm: body.hr_bpm ?? 0,
      spo2Pct: body.spo2_pct ?? 0,
      triggerCode,
      secretKeySeed: `${expectedSecret}:${body.device_uid}:${nowIso}`,
    });

    const { data: incidentRow, error: incErr } = await supabase
      .from('incidents')
      .insert({
        victim_id: existingNode.owner_id,
        hardware_node_id: existingNode.id,
        victim_name: ownerProfile?.full_name || existingNode.label,
        victim_blood_group: ownerProfile?.blood_group ?? null,
        victim_allergies: ownerProfile?.allergies ?? null,
        emergency_contact_email: ownerProfile?.emergency_contact_email ?? null,
        emergency_contact_phone: ownerProfile?.emergency_contact_phone ?? null,
        trigger_type: triggerType,
        status: 'ACTIVE',
        lat: body.lat,
        lng: body.lng,
        geohash,
        hr_bpm: body.hr_bpm ?? null,
        spo2_pct: body.spo2_pct ?? null,
        crash_g_peak: crashEval.gPeak,
        can_delta_v_kmh: crashEval.canDeltaVKmh,
        rollover_deg: crashEval.tiltDeg,
        omega_deg_s: crashEval.omegaDegSec,
        dtc_code: body.dtc_code ?? null,
        encrypted_payload_b64: cryptoPacket.encryptedPayloadBase64,
        sms_frame_52b_b64: cryptoPacket.smsFrame52BBase64,
        payload_sha256: cryptoPacket.payloadSha256Hex,
        offline_queued: false,
      })
      .select('id')
      .single();

    if (incErr) {
      return NextResponse.json({ error: incErr.message }, { status: 500 });
    }
    createdIncidentId = incidentRow.id;
  }

  return NextResponse.json({
    ok: true,
    device_uid: body.device_uid,
    geohash,
    node_status: nodeStatus,
    sos_triggered: isHardwareSos,
    incident_id: createdIncidentId,
    crash_assessment: crashEval,
  });
}
