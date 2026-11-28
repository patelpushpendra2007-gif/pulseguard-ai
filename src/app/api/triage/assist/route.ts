import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import type { TriageGuidance } from '@/types/pulseguard';

export const dynamic = 'force-dynamic';

interface TriageAssistRequest {
  incidentId?: string;
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

  let body: TriageAssistRequest;
  try {
    body = (await req.json()) as TriageAssistRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request payload.' }, { status: 400 });
  }

  if (!body.incidentId?.trim()) {
    return NextResponse.json({ error: 'incidentId is required.' }, { status: 400 });
  }

  const [{ data: responder, error: profileError }, { data: incident, error: incidentError }] =
    await Promise.all([
      supabase
        .from('profiles')
        .select('role, responder_tier')
        .eq('id', userData.user.id)
        .maybeSingle(),
      supabase
        .from('incidents')
        .select(
          'id, victim_id, responder_id, status, trigger_type, hr_bpm, spo2_pct, hrv_rmssd_ms, crash_g_peak, can_delta_v_kmh, rollover_deg, victim_blood_group, victim_allergies'
        )
        .eq('id', body.incidentId)
        .maybeSingle(),
    ]);

  if (profileError || incidentError) {
    return NextResponse.json(
      { error: profileError?.message || incidentError?.message || 'Failed to load dispatch context.' },
      { status: 500 }
    );
  }
  if (responder?.role !== 'responder' || !responder.responder_tier) {
    return NextResponse.json({ error: 'A responder role and assigned credential tier are required.' }, { status: 403 });
  }
  if (!incident) {
    return NextResponse.json({ error: 'Incident is unavailable to this responder.' }, { status: 404 });
  }
  if (incident.status === 'CLOSED' || incident.responder_id !== userData.user.id) {
    return NextResponse.json({ error: 'This dispatch is not assigned to your responder account.' }, { status: 403 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim().length < 5) {
    return NextResponse.json(
      {
        configured: false,
        guidance: null,
        message: 'GEMINI_API_KEY is not configured. Live AI triage guidance is disabled.',
      },
      { status: 200 }
    );
  }

  const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const ai = new GoogleGenAI({ apiKey });

  const prompt = `You are a clinical emergency triage decision-support system assisting an on-scene responder in India.
Responder Account Tier: ${responder.responder_tier} (credential details are self-reported and have not been independently verified).

Incident data recorded in PostgreSQL:
- Trigger Type: ${incident.trigger_type}
- Heart Rate: ${incident.hr_bpm ?? 'Not measured'} BPM
- SpO2: ${incident.spo2_pct ?? 'Not measured'}%
- HRV RMSSD: ${incident.hrv_rmssd_ms ?? 'Not measured'} ms
- Crash Peak G-Force: ${incident.crash_g_peak ?? 'Not measured'} G
- Vehicle CAN Delta-V: ${incident.can_delta_v_kmh ?? 'Not measured'} km/h
- Rollover Tilt: ${incident.rollover_deg ?? 'Not measured'} deg
- Victim Blood Group: ${incident.victim_blood_group || 'Not provided'}
- Reported Allergies: ${incident.victim_allergies || 'Not provided'}

Return strictly valid JSON matching this schema:
{
  "urgencyLevel": "CRITICAL" | "HIGH" | "MODERATE",
  "suspectedCondition": "short clinical synthesis",
  "immediateActions": ["step 1", "step 2", "step 3", "step 4"],
  "contraindications": ["allergy or scope warning 1", "warning 2"],
  "cprOrShockProtocol": "concise AHA CPR / hemorrhage / cervical spine / shock stabilization directive tailored to vitals and responder tier",
  "handoverSummary108": "concise SBAR handover note for arriving 108/EMS ambulance"
}`;

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.2,
      },
    });

    const rawText = response.text?.trim();
    if (!rawText) {
      return NextResponse.json(
        { configured: true, guidance: null, error: 'The triage model returned an empty response.' },
        { status: 502 }
      );
    }

    const parsed = JSON.parse(rawText) as Partial<Omit<TriageGuidance, 'generatedAt' | 'model'>>;
    const isText = (value: unknown): value is string =>
      typeof value === 'string' && value.trim().length > 0;
    const isTextList = (value: unknown): value is string[] =>
      Array.isArray(value) && value.every(isText);
    if (
      !['CRITICAL', 'HIGH', 'MODERATE'].includes(parsed.urgencyLevel || '') ||
      !isText(parsed.suspectedCondition) ||
      !isTextList(parsed.immediateActions) ||
      !isTextList(parsed.contraindications) ||
      !isText(parsed.cprOrShockProtocol) ||
      !isText(parsed.handoverSummary108)
    ) {
      return NextResponse.json(
        { configured: true, guidance: null, error: 'The triage model response did not match the required format.' },
        { status: 502 }
      );
    }

    const guidance: TriageGuidance = {
      urgencyLevel: parsed.urgencyLevel as TriageGuidance['urgencyLevel'],
      suspectedCondition: parsed.suspectedCondition,
      immediateActions: parsed.immediateActions,
      contraindications: parsed.contraindications,
      cprOrShockProtocol: parsed.cprOrShockProtocol,
      handoverSummary108: parsed.handoverSummary108,
      generatedAt: new Date().toISOString(),
      model: modelName,
    };

    return NextResponse.json({
      configured: true,
      guidance,
    });
  } catch (err) {
    return NextResponse.json(
      {
        configured: true,
        guidance: null,
        error: err instanceof Error ? err.message : 'Gemini triage generation failed.',
      },
      { status: 502 }
    );
  }
}
