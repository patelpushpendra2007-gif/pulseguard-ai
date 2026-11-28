# PulseGuard AI — 3-Minute Production Deployment Guide

## 1. Supabase Setup (Auth + PostgreSQL + RLS + Realtime)

1. Create a new project in [Supabase](https://supabase.com/dashboard).
2. Open **SQL Editor → New Query**, paste the complete contents of [`supabase/schema.sql`](./supabase/schema.sql), and click **Run**.
   - Creates `profiles`, `hardware_nodes`, `incidents`, and `dpdp_consent_logs` with strict foreign keys, check constraints, and Row-Level Security (RLS) policies.
   - Enables Supabase Realtime on `public.incidents` and `public.profiles`.
   - Provisions an auth trigger (`on_auth_user_created`) that automatically initializes user profiles on sign-up.
3. In **Authentication → Providers → Email**, ensure Email Signups are enabled (you may disable "Confirm email" during rapid field testing or configure SMTP for production verification).
4. Create an initial account, then run [`supabase/seed_aeds.sql`](./supabase/seed_aeds.sql) in the SQL Editor to add four online PulseBox AED nodes near the sample coordinates.
5. Copy your keys from **Project Settings → API**:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` secret key (optional, recommended for `/api/iot/telemetry` hardware webhooks) → `SUPABASE_SERVICE_ROLE_KEY`
6. Public registration permits Citizen and Responder accounts. Dispatcher and Hardware/DPDP administrator access must be provisioned by a trusted operator after sign-up. For example, assign a role through the Supabase SQL Editor using the account's verified email:
   ```sql
   update public.profiles
   set role = 'dispatcher'
   where email = '<ACCOUNT_EMAIL>';
   ```
   Use `admin` for the Hardware/DPDP Console. Never expose the Supabase service-role key to the browser. Responder credential IDs are collected at registration but are not independently validated by this application.

---

## 2. Optional Third-Party & Hardware Keys

- **Resend (`RESEND_API_KEY`, `RESEND_FROM_EMAIL`)**: Create an API key at [resend.com](https://resend.com) and set `RESEND_FROM_EMAIL` to a verified sender so Code Blue SOS dispatches can send real emergency email alerts.
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

## 4. Physical Hardware Webhook (ESP32-S3 / OBD-II Pro)

Register the physical device UID and its deployment coordinates in **Portal D (`/portal/governance`)**. Configure the hardware to `POST` its actual measured location and telemetry to `/api/iot/telemetry`, authenticating with the `x-iot-secret` header. Nodes stay offline until their first authenticated heartbeat; do not send fabricated sensor values as telemetry.
