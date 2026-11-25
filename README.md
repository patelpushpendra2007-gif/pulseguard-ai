# PulseGuard AI v4.0

**Golden Hour Clinical Dispatch & Autonomous Safety Mesh** — Full-stack working prototype featuring real on-device Edge Audio DSP, PPG + HRV (RMSSD) distress fusion, LSM6DSO + OBD-II CAN-Bus collision physics, GeoHash micro-fencing, BLE 5.0 Coded PHY multi-hop pathfinding, ECDH P-256 + AES-256-GCM encryption, and a 52-byte Binary SMS Gateway backed by Express, SQLite (`node:sqlite`), JWT RBAC authentication, and real-time Server-Sent Events (SSE).

---

## Core Architecture & Working Models

| Layer | Implemented Module | Verified Specifications |
| --- | --- | --- |
| **Edge Audio DSP** | [`shared/audioDsp.js`](shared/audioDsp.js) | 2.5s volatile `Float32Array` ring buffer (`16 kHz`), `25ms` Hann window / `10ms` hop, 512-pt Cooley-Tukey FFT, 40-band Mel filterbank, 13-coeff Type-II DCT (`MFCC`), INT8 quantization + Subsequence DTW SafeWord matcher, Hardware VAD duty telemetry (`0 Bytes` saved to disk) |
| **Biometric Fusion** | [`shared/biometricModel.js`](shared/biometricModel.js) | `a_linear = \|a_total - g\| < 0.15g`, beat-to-beat `RMSSD` computation, 15s sustained `ΔHR ≥ +35 BPM` + `RMSSD drop > 40%` gate, automatic gym/running exertion filtering |
| **Crash Physics** | [`shared/crashPhysics.js`](shared/crashPhysics.js) | `G_peak > 10G (≥ 20ms) ∧ CAN Δv ≥ 25 km/h (<150ms)` OR `Rollover θ > 60° ∨ ω > 90°/s`, pothole/speed-bump impulse rejection, Mode 01 OBD-II CAN 2.0B frame encoder/decoder |
| **GeoHash & BLE Mesh** | [`shared/geohash.js`](shared/geohash.js) | Base32 GeoHash encoder/decoder + 8-neighbor micro-fence, Haversine ETA estimation, BLE 5.0 Coded PHY (`30m` indoor / `100m+` outdoor, max 4 hops) zero-knowledge relay router |
| **E2EE & 52B SMS** | [`server/cryptoEngine.js`](server/cryptoEngine.js) | Ephemeral **ECDH P-256** + `HKDF-SHA256` + `AES-256-GCM` envelopes scoped strictly to matched NMC responders & 112 desks, automatic cryptographic key shredding on closure (`410`), and exact **52-byte Binary SMS** (`24B telemetry + 12B IV + 16B GCM Tag` = 72 Base64 chars, 88B headroom in 140B SMS) |
| **Auth, DB & Real-Time** | [`server/app.js`](server/app.js), [`server/db.js`](server/db.js), [`server/auth.js`](server/auth.js) | `node:sqlite` persistence (with serverless JSON fallback), `bcryptjs` + JWT auth, NMC NMR / ABDM HPR credential verification (Tier A vs Tier B BLS), SHA-256 hash-chained audit ledger, and real-time SSE (`/api/events`) |

---

## Quick Start

```bash
npm install
npm run build
npm start
```

Open `http://localhost:4000` in your browser.

For hot-reloading development (runs Express API on `:4000` + Vite React frontend on `:5173`):

```bash
npm run dev
```

Run all automated model, cryptographic, and HTTP API integration tests:

```bash
npm test
```

---

## Pre-Seeded Verified Accounts (or Register Your Own)

All seeded accounts use password `PulseGuard@2026` (or 1-click login from the Sign-In portal / Persona Switcher):

- **Citizen Guardian (`AIIMS Delhi`)**: `ananya@pulseguard.in`
- **NMC Tier-A Cardiologist (`NMC-98421`)**: `dr.sarah@pulseguard.in`
- **NMC Tier-A Emergency Medicine (`NMC-74219`)**: `dr.amit@pulseguard.in`
- **BLS/AED Tier-B Volunteer (`BLS-AHA-1102`)**: `bls.rohit@pulseguard.in`
- **Smart City 112 Command Desk**: `dispatch112@pulseguard.in`

---

## Key API Endpoints

- `POST /api/auth/register` / `POST /api/auth/login` / `POST /api/auth/demo-login`
- `GET /api/auth/me` / `PATCH /api/auth/profile`
- `GET /api/responders/verify-nmc/:nmcId`
- `GET /api/zones/:zoneId/snapshot`
- `POST /api/incidents/trigger` / `GET /api/incidents`
- `POST /api/incidents/:id/decrypt` (ECDH P-256 scoped decryption)
- `POST /api/incidents/:id/accept` (Section 134A Good Samaritan Shield + ₹10L Indemnity)
- `POST /api/incidents/:id/status` (Awards Day-1 stipend + CME credits & shreds ephemeral keys on closure)
- `POST /api/mesh/sms-gateway` & `POST /api/mesh/ble-simulate`
- `POST /api/pulsebox/:id/unlock-aed` & `POST /api/pulsebox/:id/consume-supply`
- `POST /api/command/zone-controls` (112 Green Corridor & 2x overnight surge)
- `GET /api/audit` (SHA-256 hash-chained audit verification)
- `GET /api/events` (Real-time SSE stream)
