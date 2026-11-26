# PulseGuard AI — 3-Minute Production Deployment Guide

## 1. Supabase Setup (Auth + PostgreSQL + RLS + Realtime)

1. Create a new project in [Supabase](https://supabase.com/dashboard).
2. Open **SQL Editor → New Query**, paste the complete contents of [`supabase/schema.sql`](./supabase/schema.sql), and click **Run**.
   - Creates `profiles`, `hardware_nodes`, `incidents`, and `dpdp_consent_logs` with strict foreign keys, check constraints, and Row-Level Security (RLS) policies.
   - Enables Supabase Realtime on `public.incidents` and `public.profiles`.
   - Provisions an auth trigger (`on_auth_user_created`) that automatically initializes user profiles on sign-up.
3. In **Authentication → Providers → Email**, ensure Email Signups are enabled (you may disable "Confirm email" during rapid field testing or configure SMTP for production verification).
4. Copy your keys from **Project Settings → API**:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` secret key (optional, recommended for `/api/iot/telemetry` hardware webhooks) → `SUPABASE_SERVICE_ROLE_KEY`

---

## 2. Optional Third-Party & Hardware Keys

- **Resend (`RESEND_API_KEY`)**: Create an API key at [resend.com](https://resend.com) so Code Blue SOS dispatches send real emergency email alerts with Google Maps links, vitals, and E2EE fingerprints. Set `RESEND_FROM_EMAIL` to your verified domain sender (defaults to `onboarding@resend.dev` for sandbox testing).
- **Google Gemini (`GEMINI_API_KEY`)**: Create a key in [Google AI Studio](https://aistudio.google.com) to enable the live AHA CPR / shock / hemorrhage triage guidance assistant in Portal B (gracefully disabled when unset).
- **IoT Hardware Webhook (`IOT_WEBHOOK_SECRET`)**: Generate a 64-character random hex string (`openssl rand -hex 32`) so physical ESP32-S3 OBD-II Pro dongles and PulseBox hubs can authenticate `POST /api/iot/telemetry` requests via the `x-iot-secret` header.

---

## 3. Deploy to GitHub & Vercel

1. Push this repository to GitHub:
   ```bash
   git remote add origin https://github.com/<your-org>/pulseguard-ai.git
   git branch -M main
   git push -u origin main
   ```
2. Import the repository into [Vercel](https://vercel.com/new) (Framework Preset: **Next.js**).
3. Add the environment variables from `.env.example` under **Project Settings → Environment Variables**.
4. Click **Deploy**. Next.js App Router, Service Worker PWA (`/sw.js`, `/manifest.json`), `Permissions-Policy` hardware headers, and API Routes deploy automatically with zero custom server configuration.

---

## 4. Physical Hardware Webhook Example (ESP32-S3 / OBD-II Pro)

Register the hardware device UID in **Portal D (`/portal/governance`)**, then configure your ESP32-S3 firmware to `POST` JSON telemetry to `/api/iot/telemetry`:

```bash
curl -X POST https://your-domain.vercel.app/api/iot/telemetry \
  -H "Content-Type: application/json" \
  -H "x-iot-secret: YOUR_IOT_WEBHOOK_SECRET" \
  -d '{
    "device_uid": "OBD-PRO-001",
    "node_type": "OBD_II_PRO",
    "lat": 28.5672,
    "lng": 77.2100,
    "g_peak": 12.4,
    "can_delta_v": 42.0,
    "rollover_deg": 12.0,
    "omega_deg_s": 24.0,
    "dtc_code": "B1001-SRS",
    "battery_pct": 94
  }'
```
