-- ============================================================================
-- PulseGuard AI - Production PostgreSQL + RLS + Realtime Schema (Supabase)
-- Execute this complete script in your Supabase Project -> SQL Editor.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. PROFILES TABLE (Citizens, NMC/ABDM & BLS Responders, 112 Dispatchers, Admin)
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null,
  role text not null default 'citizen'
    check (role in ('citizen', 'responder', 'dispatcher', 'admin')),
  phone text,
  blood_group text
    check (blood_group is null or blood_group in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
  allergies text default 'None reported',
  medical_conditions text default 'None reported',
  emergency_contact_name text,
  emergency_contact_email text,
  emergency_contact_phone text,
  safeword_hash text,
  safeword_word_count integer default 2 check (safeword_word_count between 1 and 8),
  baseline_hr_bpm integer not null default 72 check (baseline_hr_bpm between 35 and 160),
  baseline_rmssd_ms numeric(6,2) not null default 42.00 check (baseline_rmssd_ms between 5 and 250),
  responder_tier text
    check (responder_tier is null or responder_tier in ('TIER_A_NMC', 'TIER_B_BLS')),
  nmc_registration_id text,
  abdm_hpr_id text,
  bls_certification_id text,
  specialty text,
  is_available boolean not null default false,
  current_lat double precision check (current_lat is null or (current_lat between -90 and 90)),
  current_lng double precision check (current_lng is null or (current_lng between -180 and 180)),
  current_geohash text,
  last_location_at timestamptz,
  ecdh_public_key_jwk jsonb,
  dpdp_consent_granted boolean not null default false,
  dpdp_consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_profiles_role_available
  on public.profiles (role, is_available);
create index if not exists idx_profiles_geohash
  on public.profiles (current_geohash);

-- ----------------------------------------------------------------------------
-- 2. HARDWARE NODES TABLE (OBD-II Lite/Pro Dongles & PulseBox AED Cabinets)
-- ----------------------------------------------------------------------------
create table if not exists public.hardware_nodes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  device_uid text not null unique,
  node_type text not null
    check (node_type in ('OBD_II_LITE', 'OBD_II_PRO', 'PULSEBOX_AED')),
  label text not null,
  firmware_version text not null default '1.0.0',
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  geohash text not null,
  status text not null default 'ONLINE'
    check (status in ('ONLINE', 'OFFLINE', 'ALERT', 'MAINTENANCE')),
  aed_status text default 'N/A'
    check (aed_status in ('READY', 'UNLOCKED', 'IN_USE', 'SERVICE_REQUIRED', 'N/A')),
  battery_pct integer check (battery_pct is null or (battery_pct between 0 and 100)),
  last_telemetry jsonb default '{}'::jsonb,
  last_ping_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_hardware_nodes_type
  on public.hardware_nodes (node_type, status);
create index if not exists idx_hardware_nodes_geohash
  on public.hardware_nodes (geohash);

-- ----------------------------------------------------------------------------
-- 3. INCIDENTS TABLE (Code Blue SOS, Crash Physics, E2EE 52B SMS & Dispatch)
-- ----------------------------------------------------------------------------
create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  victim_id uuid references public.profiles(id) on delete set null,
  hardware_node_id uuid references public.hardware_nodes(id) on delete set null,
  victim_name text not null,
  victim_blood_group text,
  victim_allergies text,
  emergency_contact_email text,
  emergency_contact_phone text,
  trigger_type text not null
    check (trigger_type in (
      'MANUAL_SOS',
      'SAFEWORD_VOICE',
      'PPG_BIOMETRIC_DISTRESS',
      'AUTOMOTIVE_CRASH_OBD',
      'AUTOMOTIVE_ROLLOVER_IMU',
      'PULSEBOX_HARDWARE_SOS'
    )),
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'DISPATCHED', 'EN_ROUTE', 'STABILIZED', 'CLOSED')),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  geohash text not null,
  hr_bpm integer check (hr_bpm is null or (hr_bpm between 0 and 260)),
  spo2_pct integer check (spo2_pct is null or (spo2_pct between 0 and 100)),
  hrv_rmssd_ms numeric(6,2),
  linear_imu_g numeric(6,3),
  crash_g_peak numeric(6,2),
  can_delta_v_kmh numeric(6,2),
  rollover_deg numeric(6,2),
  omega_deg_s numeric(6,2),
  dtc_code text,
  encrypted_payload_b64 text not null,
  sms_frame_52b_b64 text not null,
  payload_sha256 text not null,
  ephemeral_ecdh_pub_jwk jsonb,
  ephemeral_key_revoked boolean not null default false,
  ephemeral_key_revoked_at timestamptz,
  offline_queued boolean not null default false,
  email_notified boolean not null default false,
  responder_id uuid references public.profiles(id) on delete set null,
  responder_name text,
  responder_tier text
    check (responder_tier is null or responder_tier in ('TIER_A_NMC', 'TIER_B_BLS')),
  responder_nmc_id text,
  responder_lat double precision check (responder_lat is null or (responder_lat between -90 and 90)),
  responder_lng double precision check (responder_lng is null or (responder_lng between -180 and 180)),
  responder_updated_at timestamptz,
  good_samaritan_cert_id text,
  indemnity_amount_inr integer not null default 1000000 check (indemnity_amount_inr = 1000000),
  triage_notes jsonb,
  accepted_at timestamptz,
  en_route_at timestamptz,
  stabilized_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_incidents_status_created
  on public.incidents (status, created_at desc);
create index if not exists idx_incidents_geohash
  on public.incidents (geohash);
create index if not exists idx_incidents_victim
  on public.incidents (victim_id);
create index if not exists idx_incidents_responder
  on public.incidents (responder_id);

-- ----------------------------------------------------------------------------
-- 4. DPDP ACT 2023 CONSENT & DATA RIGHTS AUDIT LOGS
-- ----------------------------------------------------------------------------
create table if not exists public.dpdp_consent_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  consent_scope text not null
    check (consent_scope in (
      'BIOMETRIC_PPG_PROCESSING',
      'VOICE_RAM_SAFEWORD',
      'EMERGENCY_LOCATION_SHARING',
      'MEDICAL_PROFILE_DISPATCH',
      'HARDWARE_TELEMETRY_INGEST',
      'ALL_SERVICES_DATA_ERASURE'
    )),
  action text not null
    check (action in ('GRANTED', 'REVOKED', 'EXPORTED', 'ERASED')),
  purpose_description text not null,
  legal_basis text not null default 'DPDP Act 2023 Section 6 (Explicit Consent) & Section 7(a) (Medical Emergency)',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_dpdp_logs_user_created
  on public.dpdp_consent_logs (user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 5. TRIGGERS: UPDATED_AT & AUTOMATIC AUTH PROFILE PROVISIONING
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists trg_hardware_nodes_updated_at on public.hardware_nodes;
create trigger trg_hardware_nodes_updated_at
  before update on public.hardware_nodes
  for each row execute function public.set_updated_at();

drop trigger if exists trg_incidents_updated_at on public.incidents;
create trigger trg_incidents_updated_at
  before update on public.incidents
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role text;
  requested_tier text;
begin
  requested_role := coalesce(new.raw_user_meta_data ->> 'role', 'citizen');
  if requested_role not in ('citizen', 'responder', 'dispatcher', 'admin') then
    requested_role := 'citizen';
  end if;

  requested_tier := new.raw_user_meta_data ->> 'responder_tier';
  if requested_tier not in ('TIER_A_NMC', 'TIER_B_BLS') then
    requested_tier := null;
  end if;

  insert into public.profiles (
    id,
    email,
    full_name,
    role,
    responder_tier,
    nmc_registration_id,
    abdm_hpr_id,
    bls_certification_id,
    specialty
  )
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, 'User'), '@', 1)),
    requested_role,
    requested_tier,
    new.raw_user_meta_data ->> 'nmc_registration_id',
    new.raw_user_meta_data ->> 'abdm_hpr_id',
    new.raw_user_meta_data ->> 'bls_certification_id',
    new.raw_user_meta_data ->> 'specialty'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ----------------------------------------------------------------------------
-- 6. SECURITY-DEFINER HELPER TO AVOID RLS RECURSION
-- ----------------------------------------------------------------------------
create or replace function public.get_my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- ----------------------------------------------------------------------------
-- 7. ROW-LEVEL SECURITY (RLS) POLICIES
-- ----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.hardware_nodes enable row level security;
alter table public.incidents enable row level security;
alter table public.dpdp_consent_logs enable row level security;

-- PROFILES POLICIES
drop policy if exists "profiles_select_policy" on public.profiles;
create policy "profiles_select_policy"
  on public.profiles
  for select
  to authenticated
  using (
    auth.uid() = id
    or public.get_my_role() in ('dispatcher', 'admin')
    or (role = 'responder' and is_available = true)
    or exists (
      select 1 from public.incidents i
      where (i.victim_id = profiles.id or i.responder_id = profiles.id)
        and (
          i.victim_id = auth.uid()
          or i.responder_id = auth.uid()
          or (public.get_my_role() = 'responder' and i.status = 'ACTIVE')
        )
    )
  );

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles
  for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- HARDWARE NODES POLICIES
drop policy if exists "hardware_nodes_select_policy" on public.hardware_nodes;
create policy "hardware_nodes_select_policy"
  on public.hardware_nodes
  for select
  to authenticated
  using (
    auth.uid() = owner_id
    or node_type = 'PULSEBOX_AED'
    or public.get_my_role() in ('responder', 'dispatcher', 'admin')
  );

drop policy if exists "hardware_nodes_insert_policy" on public.hardware_nodes;
create policy "hardware_nodes_insert_policy"
  on public.hardware_nodes
  for insert
  to authenticated
  with check (
    auth.uid() = owner_id
    or public.get_my_role() in ('dispatcher', 'admin')
  );

drop policy if exists "hardware_nodes_update_policy" on public.hardware_nodes;
create policy "hardware_nodes_update_policy"
  on public.hardware_nodes
  for update
  to authenticated
  using (
    auth.uid() = owner_id
    or public.get_my_role() in ('dispatcher', 'admin')
  )
  with check (
    auth.uid() = owner_id
    or public.get_my_role() in ('dispatcher', 'admin')
  );

drop policy if exists "hardware_nodes_delete_policy" on public.hardware_nodes;
create policy "hardware_nodes_delete_policy"
  on public.hardware_nodes
  for delete
  to authenticated
  using (
    auth.uid() = owner_id
    or public.get_my_role() = 'admin'
  );

-- INCIDENTS POLICIES
drop policy if exists "incidents_select_policy" on public.incidents;
create policy "incidents_select_policy"
  on public.incidents
  for select
  to authenticated
  using (
    auth.uid() = victim_id
    or auth.uid() = responder_id
    or public.get_my_role() in ('dispatcher', 'admin')
    or (public.get_my_role() = 'responder' and status in ('ACTIVE', 'DISPATCHED', 'EN_ROUTE', 'STABILIZED'))
  );

drop policy if exists "incidents_insert_policy" on public.incidents;
create policy "incidents_insert_policy"
  on public.incidents
  for insert
  to authenticated
  with check (
    auth.uid() = victim_id
    or public.get_my_role() in ('dispatcher', 'admin')
  );

drop policy if exists "incidents_update_policy" on public.incidents;
create policy "incidents_update_policy"
  on public.incidents
  for update
  to authenticated
  using (
    auth.uid() = victim_id
    or auth.uid() = responder_id
    or public.get_my_role() in ('dispatcher', 'admin')
    or (public.get_my_role() = 'responder' and status = 'ACTIVE' and responder_id is null)
  )
  with check (
    auth.uid() = victim_id
    or auth.uid() = responder_id
    or public.get_my_role() in ('dispatcher', 'admin')
  );

-- DPDP CONSENT LOGS POLICIES (Immutable append-only audit trail)
drop policy if exists "dpdp_logs_select_policy" on public.dpdp_consent_logs;
create policy "dpdp_logs_select_policy"
  on public.dpdp_consent_logs
  for select
  to authenticated
  using (
    auth.uid() = user_id
    or public.get_my_role() in ('dispatcher', 'admin')
  );

drop policy if exists "dpdp_logs_insert_own" on public.dpdp_consent_logs;
create policy "dpdp_logs_insert_own"
  on public.dpdp_consent_logs
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 8. REALTIME PUBLICATION
-- ----------------------------------------------------------------------------
alter publication supabase_realtime add table public.incidents, public.profiles;
