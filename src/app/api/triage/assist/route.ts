import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import type { TriageGuidance } from '@/types/pulseguard';

export const dynamic = 'force-dynamic';

interface TriageAssistRequest {
  incidentId?: string;
  triggerType?: string;
  hrBpm?: number | null;
  spo2Pct?: number | null;
  hrvRmssdMs?: number | null;
  crashGPeak?: number | null;
  canDeltaVKmh?: number | null;
  rolloverDeg?: number | null;
  bloodGroup?: string | null;
  allergies?: string | null;
  responderTier?: string | null;
}

export async function POST(req: NextRequest) {
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

  let body: TriageAssistRequest;
  try {
    body = (await req.json()) as TriageAssistRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request payload.' }, { status: 400 });
  }

  const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const ai = new GoogleGenAI({ apiKey });

  const prompt = `You are a clinical emergency triage decision-support system assisting an on-scene responder in India.
Responder Credential Scope: ${body.responderTier === 'TIER_A_NMC' ? 'Tier A Licensed NMC Doctor / Nurse / CRMI (ALS/ACLS capable)' : 'Tier B Certified AHA/Red Cross BLS/CPR Volunteer (strictly BLS/AED/hemorrhage control scope — no invasive pharmacology)'}.

Real Incident Telemetry:
- Trigger Type: ${body.triggerType || 'UNKNOWN'}
- Heart Rate: ${body.hrBpm ?? 'Unavailable'} BPM
- SpO2: ${body.spo2Pct ?? 'Unavailable'}%
- HRV RMSSD: ${body.hrvRmssdMs ?? 'Unavailable'} ms
- Crash Peak G-Force: ${body.crashGPeak ?? 'N/A'} G
- Vehicle CAN Delta-V: ${body.canDeltaVKmh ?? 'N/A'} km/h
- Rollover Tilt: ${body.rolloverDeg ?? 'N/A'} deg
- Victim Blood Group: ${body.bloodGroup || 'Unknown'}
- Reported Allergies: ${body.allergies || 'None reported'}

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

    const rawText = response.text?.trim() || '';
    const parsed = JSON.parse(rawText) as Omit<TriageGuidance, 'generatedAt' | 'model'>;

    const guidance: TriageGuidance = {
      urgencyLevel: parsed.urgencyLevel || 'CRITICAL',
      suspectedCondition: parsed.suspectedCondition || 'Acute emergency requiring rapid primary survey',
      immediateActions: Array.isArray(parsed.immediateActions) ? parsed.immediateActions : [],
      contraindications: Array.isArray(parsed.contraindications) ? parsed.contraindications : [],
      cprOrShockProtocol:
        parsed.cprOrShockProtocol ||
        'Follow ABCDE primary survey, verify airway/breathing, initiate CPR if pulseless, attach AED.',
      handoverSummary108:
        parsed.handoverSummary108 || 'Prepare SBAR summary with baseline vitals and trigger timestamp.',
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
