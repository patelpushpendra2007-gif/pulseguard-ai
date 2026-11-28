import type { EmergencyTriageGuidance } from '@/types/pulseguard';

export const FALLBACK_EMERGENCY_TRIAGE: EmergencyTriageGuidance = {
  responderBullets: [
    'Confirm scene safety and responsiveness; request emergency medical services (112/108 in India).',
    'Assess breathing and follow dispatcher guidance, your training, and local protocols; use an AED if indicated and available.',
    'Share observed changes, recorded vitals, and reported allergies with EMS; do not delay transport.',
  ],
  citizenSteps: [
    'Help is being contacted. Stay on the emergency call and follow the dispatcher’s instructions.',
    'If it is safe, sit or lie down, avoid walking, and ask someone nearby to meet responders.',
    'Do not take food, drink, or medication unless an emergency professional directs you to.',
  ],
  source: 'fallback',
  notice: 'General safety guidance is shown; follow emergency professionals first.',
};

export function isEmergencyTriageGuidance(value: unknown): value is EmergencyTriageGuidance {
  if (!value || typeof value !== 'object') return false;
  const guidance = value as Partial<EmergencyTriageGuidance>;
  const hasThreeStrings = (items: unknown): items is string[] =>
    Array.isArray(items) &&
    items.length === 3 &&
    items.every((item) => typeof item === 'string' && item.trim().length > 0);

  return (
    hasThreeStrings(guidance.responderBullets) &&
    hasThreeStrings(guidance.citizenSteps) &&
    (guidance.source === 'gemini' || guidance.source === 'fallback') &&
    (guidance.notice === null || typeof guidance.notice === 'string')
  );
}
