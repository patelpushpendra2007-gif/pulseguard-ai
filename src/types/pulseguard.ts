export type UserRole = 'citizen' | 'responder' | 'dispatcher' | 'admin';

export type ResponderTier = 'TIER_A_NMC' | 'TIER_B_BLS';

export type BloodGroup = 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-';

export type IncidentStatus = 'ACTIVE' | 'DISPATCHED' | 'EN_ROUTE' | 'STABILIZED' | 'CLOSED';

export type TriggerType =
  | 'MANUAL_SOS'
  | 'SAFEWORD_VOICE'
  | 'PPG_BIOMETRIC_DISTRESS'
  | 'AUTOMOTIVE_CRASH_OBD'
  | 'AUTOMOTIVE_ROLLOVER_IMU'
  | 'PULSEBOX_HARDWARE_SOS';

export type HardwareNodeType = 'OBD_II_LITE' | 'OBD_II_PRO' | 'PULSEBOX_AED';

export type HardwareStatus = 'ONLINE' | 'OFFLINE' | 'ALERT' | 'MAINTENANCE';

export type AedStatus = 'READY' | 'UNLOCKED' | 'IN_USE' | 'SERVICE_REQUIRED' | 'N/A';

export type ConsentScope =
  | 'BIOMETRIC_PPG_PROCESSING'
  | 'VOICE_RAM_SAFEWORD'
  | 'EMERGENCY_LOCATION_SHARING'
  | 'MEDICAL_PROFILE_DISPATCH'
  | 'HARDWARE_TELEMETRY_INGEST'
  | 'ALL_SERVICES_DATA_ERASURE';

export type ConsentAction = 'GRANTED' | 'REVOKED' | 'EXPORTED' | 'ERASED';

export type PowerEngineState = 'IDLE_SLEEP' | 'ARMED_VIGILANT' | 'CODE_BLUE_ACTIVE';

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  phone: string | null;
  blood_group: BloodGroup | null;
  allergies: string | null;
  medical_conditions: string | null;
  emergency_contact_name: string | null;
  emergency_contact_email: string | null;
  emergency_contact_phone: string | null;
  safeword_hash: string | null;
  safeword_word_count: number | null;
  baseline_hr_bpm: number;
  baseline_rmssd_ms: number;
  responder_tier: ResponderTier | null;
  nmc_registration_id: string | null;
  abdm_hpr_id: string | null;
  bls_certification_id: string | null;
  specialty: string | null;
  is_available: boolean;
  current_lat: number | null;
  current_lng: number | null;
  current_geohash: string | null;
  last_location_at: string | null;
  ecdh_public_key_jwk: JsonWebKey | null;
  dpdp_consent_granted: boolean;
  dpdp_consent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TriageGuidance {
  urgencyLevel: 'CRITICAL' | 'HIGH' | 'MODERATE';
  suspectedCondition: string;
  immediateActions: string[];
  contraindications: string[];
  cprOrShockProtocol: string;
  handoverSummary108: string;
  generatedAt: string;
  model: string;
}

export interface Incident {
  id: string;
  victim_id: string | null;
  hardware_node_id: string | null;
  victim_name: string;
  victim_blood_group: string | null;
  victim_allergies: string | null;
  emergency_contact_email: string | null;
  emergency_contact_phone: string | null;
  trigger_type: TriggerType;
  status: IncidentStatus;
  lat: number;
  lng: number;
  geohash: string;
  hr_bpm: number | null;
  spo2_pct: number | null;
  hrv_rmssd_ms: number | null;
  linear_imu_g: number | null;
  crash_g_peak: number | null;
  can_delta_v_kmh: number | null;
  rollover_deg: number | null;
  omega_deg_s: number | null;
  dtc_code: string | null;
  encrypted_payload_b64: string;
  sms_frame_52b_b64: string;
  payload_sha256: string;
  ephemeral_ecdh_pub_jwk: JsonWebKey | null;
  ephemeral_key_revoked: boolean;
  ephemeral_key_revoked_at: string | null;
  offline_queued: boolean;
  email_notified: boolean;
  responder_id: string | null;
  responder_name: string | null;
  responder_tier: ResponderTier | null;
  responder_nmc_id: string | null;
  responder_lat: number | null;
  responder_lng: number | null;
  responder_updated_at: string | null;
  good_samaritan_cert_id: string | null;
  indemnity_amount_inr: number;
  triage_notes: TriageGuidance | null;
  accepted_at: string | null;
  en_route_at: string | null;
  stabilized_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface HardwareNode {
  id: string;
  owner_id: string;
  device_uid: string;
  node_type: HardwareNodeType;
  label: string;
  firmware_version: string;
  lat: number;
  lng: number;
  geohash: string;
  status: HardwareStatus;
  aed_status: AedStatus | null;
  battery_pct: number | null;
  last_telemetry: Record<string, unknown> | null;
  last_ping_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DpdpConsentLog {
  id: string;
  user_id: string;
  consent_scope: ConsentScope;
  action: ConsentAction;
  purpose_description: string;
  legal_basis: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ConfigHealthStatus {
  supabaseUrlConfigured: boolean;
  supabaseAnonKeyConfigured: boolean;
  supabaseServiceRoleConfigured: boolean;
  resendConfigured: boolean;
  geminiConfigured: boolean;
  iotWebhookSecretConfigured: boolean;
  allCoreConfigured: boolean;
}
