# PulseGuard AI — Production Edge Sentinel & Clinical Dispatch Mesh

Zero-mock-data **Next.js App Router + TypeScript + Tailwind CSS** Progressive Web App (PWA) backed by **Supabase Auth, PostgreSQL, Row-Level Security (RLS), and Supabase Realtime**.

## Architecture

- **4 Authenticated Role Portals**:
  - **Portal A (`/portal/citizen`)**: Citizen & Women Safety Edge Sentinel — 3-State Low-Power Engine, live 16kHz volatile RAM `AudioWorklet` MFCC/Spectrogram & custom SafeWord detector, Web Bluetooth GATT Heart Rate (`0x180D` / `0x2A37`), OBD-II BLE UART, rear-camera Optical PPG + torch, smartphone `DeviceMotionEvent` crash physics, 5-second cancelable haptic countdown, one-tap Code Blue SOS, and live responder tracking.
  - **Portal B (`/portal/responder`)**: Tier A NMC/NMR and Tier B BLS responder mesh — credential IDs are collected at enrollment but are not independently verified by this app; live availability & GPS, Realtime alerts, nearest PulseBox AED routing, and optional Gemini triage support.
  - **Portal C (`/portal/command`)**: Smart City Police 112 & Triage Command Desk — live Leaflet/OpenStreetMap tactical map, GeoHash clusters, E2EE SHA-256 verification status, dynamic responder ETAs, lifecycle state transitions (`ACTIVE -> DISPATCHED -> EN_ROUTE -> STABILIZED -> CLOSED`), and audit trail.
  - **Portal D (`/portal/governance`)**: Hardware IoT & DPDP Act 2023 Governance Console — register/monitor OBD-II Lite/Pro & PulseBox AED hardware nodes, live webhook pings (`POST /api/iot/telemetry`), explicit consent logs, JSON portability export, and right-to-erasure controls.
- **Cryptography & Offline Failover**: Native Web Crypto API ephemeral **ECDH P-256 + AES-256-GCM** sealing an exact 24-byte packed telemetry buffer + 12-byte IV + 16-byte GCM tag = **52-byte binary frame (72 Base64 chars)**, IndexedDB Service Worker Background Sync (`public/sw.js`), one-tap native `sms:` URI failover, and Web Bluetooth BLE relay console.

## Quick Setup

See [`DEPLOY_GUIDE.md`](./DEPLOY_GUIDE.md) and [`supabase/schema.sql`](./supabase/schema.sql).

Public registration is limited to citizens and responders. Dispatcher and administrator roles must be assigned by a trusted project administrator after account creation; users cannot grant those roles to themselves.

```bash
npm install
cp .env.example .env.local
npm run dev
```
