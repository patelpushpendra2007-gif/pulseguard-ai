import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import http from 'node:http';

import { encodeGeoHash, decodeGeoHashBounds, getGeoHashRing, findBleMeshRoute } from '../shared/geohash.js';
import { SafeWordEdgeModel, synthesizeAcousticPhrase } from '../shared/audioDsp.js';
import { BiometricDistressEngine, synthesizeRrIntervals, computeLinearImuG } from '../shared/biometricModel.js';
import { evaluateCrashTelemetry, CRASH_PRESETS } from '../shared/crashPhysics.js';
import {
  encodeBinarySms52,
  decodeBinarySms52,
  generateEcdhKeyPair,
  wrapPrivateKeyForStorage,
  sealIncidentEnvelope,
  unsealIncidentEnvelope,
  revokeEnvelopeKeys
} from '../server/cryptoEngine.js';
import app from '../server/app.js';

test('GeoHash micro-fencing and BLE 5.0 Coded PHY multi-hop pathfinder', () => {
  const hash = encodeGeoHash(28.5672, 77.2100, 6);
  assert.equal(hash.length, 6);
  const decoded = decodeGeoHashBounds(hash);
  assert.ok(Math.abs(decoded.lat - 28.5672) < 0.01);
  assert.ok(Math.abs(decoded.lng - 77.2100) < 0.01);

  const ring = getGeoHashRing(28.5672, 77.2100, 6);
  assert.ok(ring.cells.length >= 9);

  const route = findBleMeshRoute(
    { lat: 28.5672, lng: 77.2100, indoor: true },
    [
      { id: 'N1', label: 'Watch B', kind: 'wearable_relay', lat: 28.5674, lng: 77.2102, indoor: true, hasUplink: false },
      { id: 'N2', label: 'OBD Gateway C', kind: 'gateway_cloud', lat: 28.5679, lng: 77.2106, indoor: false, hasUplink: true }
    ],
    4
  );
  assert.equal(route.reachable, true);
  assert.equal(route.hops, 2);
  assert.equal(route.zeroKnowledgeVerified, true);
});

test('Edge Audio DSP: Volatile ring buffer, MFCC, INT8 DTW SafeWord matching & rejection', () => {
  const model = new SafeWordEdgeModel('RED LOTUS');
  const matchingSignal = synthesizeAcousticPhrase('RED LOTUS');
  const unrelatedSignal = synthesizeAcousticPhrase('WEATHER REPORT TOMORROW');

  const hit = model.evaluateAudioChunk(matchingSignal, 0.78);
  assert.equal(hit.matched, true);
  assert.ok(hit.confidence >= 0.78);
  assert.equal(hit.diskBytesPersisted, 0);
  assert.equal(hit.logMelBands.length, 40);
  assert.equal(hit.mfccCoeffs.length, 13);
  assert.ok(hit.footprintMb < 1.5);

  model.ringBuffer.wipeVolatileRam();
  const miss = model.evaluateAudioChunk(unrelatedSignal, 0.78);
  assert.equal(miss.matched, false);

  // Also test chunked 1600-sample streaming matching CitizenView.jsx
  model.ringBuffer.wipeVolatileRam();
  let streamBest = null;
  for (let i = 0; i < matchingSignal.length; i += 1600) {
    const slice = matchingSignal.subarray(i, Math.min(matchingSignal.length, i + 1600));
    if (slice.length >= 400) {
      const res = model.evaluateAudioChunk(slice, 0.78);
      if (!streamBest || res.confidence >= streamBest.confidence) streamBest = res;
    }
  }
  assert.equal(streamBest.matched, true);
  assert.ok(streamBest.confidence >= 0.85);
});

test('Biometric Distress Fusion: confirms stationary panic and filters gym exertion', () => {
  const engine = new BiometricDistressEngine();
  engine.reset(74, 46);

  // Gym workout: +70 BPM, RMSSD drops, but linear IMU is 0.62g (>= 0.15g) -> MUST reject
  const gymRes = engine.evaluateSample({
    hrBpm: 144,
    rrIntervalsMs: synthesizeRrIntervals(144, 20, 16, 1),
    linearImuGOverride: 0.62,
    deltaSeconds: 16
  });
  assert.equal(gymRes.classification, 'EXERTION_FILTERED');
  assert.equal(gymRes.panicTriggered, false);

  // Acute stationary panic: +68 BPM, RMSSD 18ms (>40% drop), gravity-free IMU ~0.05g sustained >=15s
  const stillG = computeLinearImuG(0.1, 0.2, 9.81);
  assert.ok(stillG < 0.15);

  const panicRes = engine.evaluateSample({
    hrBpm: 142,
    rrIntervalsMs: synthesizeRrIntervals(142, 18, 16, 2),
    linearImuGOverride: stillG,
    deltaSeconds: 15
  });
  assert.equal(panicRes.classification, 'DISTRESS_CONFIRMED');
  assert.equal(panicRes.panicTriggered, true);
});

test('Automotive Crash Physics: rejects pothole spike, triggers head-on & rollover', () => {
  const pothole = evaluateCrashTelemetry(CRASH_PRESETS.pothole);
  assert.equal(pothole.crashTriggered, false);
  assert.equal(pothole.verdict, 'POTHOLE_BUMP_REJECTED');

  const headOn = evaluateCrashTelemetry(CRASH_PRESETS.headon);
  assert.equal(headOn.crashTriggered, true);
  assert.equal(headOn.verdict, 'COLLISION_CONFIRMED_NON_ROLLOVER');
  assert.ok(headOn.canFrames.length === 3);

  const rollover = evaluateCrashTelemetry(CRASH_PRESETS.rollover);
  assert.equal(rollover.crashTriggered, true);
  assert.equal(rollover.verdict, 'ROLLOVER_CONFIRMED');
});

test('Crypto Engine: 52-Byte Binary SMS & ECDH P-256 + AES-256-GCM scoped envelope + revocation', () => {
  const sms = encodeBinarySms52({
    lat: 28.5672,
    lng: 77.21,
    userId: 'usr-citizen-ananya',
    hrBpm: 142,
    spo2Pct: 94,
    triggerType: 'SAFEWORD',
    linearImuG: 0.08
  });
  assert.equal(sms.byteLength, 52);
  assert.equal(sms.base64Length, 72);
  assert.equal(sms.gsm140HeadroomBytes, 88);

  const decoded = decodeBinarySms52(sms.base64);
  assert.equal(decoded.hrBpm, 142);
  assert.equal(decoded.spo2Pct, 94);
  assert.equal(decoded.triggerType, 'SAFEWORD');

  // Tamper check (flip first Base64 character to corrupt payload byte)
  const tampered = (sms.base64[0] === 'A' ? 'B' : 'A') + sms.base64.slice(1);
  assert.throws(() => decodeBinarySms52(tampered), /authentication tag/i);

  // ECDH envelope test
  const kpAuth = generateEcdhKeyPair();
  const kpUnauth = generateEcdhKeyPair();
  const authUser = {
    id: 'doc-1',
    name: 'Dr. Auth',
    role: 'responder',
    ecdh_pub_key: kpAuth.pubKeyHex,
    ecdh_priv_key_enc: wrapPrivateKeyForStorage(kpAuth.privKeyHex)
  };
  const unauthUser = {
    id: 'doc-2',
    name: 'Unauthorized Node',
    role: 'responder',
    ecdh_pub_key: kpUnauth.pubKeyHex,
    ecdh_priv_key_enc: wrapPrivateKeyForStorage(kpUnauth.privKeyHex)
  };

  const envelope = sealIncidentEnvelope({ secretPatient: 'Ananya', bloodGroup: 'O+' }, [authUser]);
  const plain = unsealIncidentEnvelope(envelope, authUser);
  assert.equal(plain.secretPatient, 'Ananya');

  assert.throws(() => unsealIncidentEnvelope(envelope, unauthUser), /CRYPTO_SCOPE_DENIED|Access denied/i);

  const revoked = revokeEnvelopeKeys(envelope);
  assert.throws(() => unsealIncidentEnvelope(revoked, authUser), /shredded/i);
});

test('Full-Stack HTTP API: Auth, Trigger SOS, ECDH Decrypt, Dispatch Accept, Stabilize & Audit Chain', async () => {
  // In-process Node request/response stream dispatch against Express app (zero socket port needed)
  const reqJson = (path, { method = 'GET', token, body } = {}) =>
    new Promise((resolve, reject) => {
      const payloadStr = body ? JSON.stringify(body) : '';
      const req = new PassThrough();
      req.url = `/api${path}`;
      req.originalUrl = `/api${path}`;
      req.method = method;
      req.headers = { host: 'localhost', 'content-type': 'application/json' };
      if (token) req.headers.authorization = `Bearer ${token}`;
      if (payloadStr) req.headers['content-length'] = String(Buffer.byteLength(payloadStr));
      req.connection = { remoteAddress: '127.0.0.1' };
      req.socket = req.connection;

      const res = new http.ServerResponse({ method, headers: {} });
      const chunks = [];
      const origWrite = res.write.bind(res);
      const origEnd = res.end.bind(res);

      res.write = (chunk, enc, cb) => {
        if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, enc));
        if (typeof enc === 'function') enc();
        else if (typeof cb === 'function') cb();
        return true;
      };
      res.end = (chunk, enc, cb) => {
        if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, enc));
        const raw = Buffer.concat(chunks).toString('utf8');
        if (typeof enc === 'function') enc();
        else if (typeof cb === 'function') cb();
        try {
          resolve({ status: res.statusCode, data: JSON.parse(raw) });
        } catch {
          reject(new Error(`Invalid JSON (${res.statusCode}): ${raw}`));
        }
      };

      app(req, res);
      if (payloadStr) req.push(payloadStr);
      req.push(null);
    });

  // 1. Register a brand-new citizen
  const regEmail = `test.citizen.${Date.now()}@pulseguard.in`;
  const regRes = await reqJson('/auth/register', {
    method: 'POST',
    body: {
      name: 'Test Citizen',
      email: regEmail,
      password: 'StrongPassword123',
      role: 'citizen',
      microZone: 'aiims_delhi',
      bloodGroup: 'A+'
    }
  });
  assert.equal(regRes.status, 201);
  assert.ok(regRes.data.token);
  const citizenToken = regRes.data.token;

  // 2. Trigger SOS incident
  const trigRes = await reqJson('/incidents/trigger', {
    method: 'POST',
    token: citizenToken,
    body: {
      microZone: 'aiims_delhi',
      triggerType: 'SAFEWORD',
      transportMode: 'BLE_MESH',
      vitals: { hrBpm: 144, spo2Pct: 93, linearImuG: 0.06 }
    }
  });
  assert.equal(trigRes.status, 201);
  const incId = trigRes.data.incident.id;
  assert.equal(trigRes.data.smsPacket.byteLength, 52);

  // 3. Sign in as Dr. Sarah Lin (NMC-98421) in AIIMS Delhi -> Decrypt & Accept
  const docLogin = await reqJson('/auth/demo-login', {
    method: 'POST',
    body: { userId: 'usr-doc-sarah' }
  });
  assert.equal(docLogin.status, 200);
  const docToken = docLogin.data.token;

  const decRes = await reqJson(`/incidents/${incId}/decrypt`, {
    method: 'POST',
    token: docToken
  });
  assert.equal(decRes.status, 200);
  assert.equal(decRes.data.payload.bloodGroup, 'A+');

  // 4. Out-of-zone Dr. Meera (PGIMER) cannot decrypt AIIMS incident -> 403
  const outDocLogin = await reqJson('/auth/demo-login', {
    method: 'POST',
    body: { userId: 'usr-doc-meera' }
  });
  const deniedDec = await reqJson(`/incidents/${incId}/decrypt`, {
    method: 'POST',
    token: outDocLogin.data.token
  });
  assert.equal(deniedDec.status, 403);

  // 5. Dr. Sarah accepts, unlocks AED, stabilizes patient -> keys revoked (410)
  const accRes = await reqJson(`/incidents/${incId}/accept`, {
    method: 'POST',
    token: docToken
  });
  assert.equal(accRes.status, 200);
  assert.ok(accRes.data.incident.indemnityCertId.startsWith('GS-134A-'));

  const stabRes = await reqJson(`/incidents/${incId}/status`, {
    method: 'POST',
    token: docToken,
    body: { status: 'STABILIZED' }
  });
  assert.equal(stabRes.status, 200);
  assert.ok(stabRes.data.stipendAwardedInr >= 600);

  const postRevokeDec = await reqJson(`/incidents/${incId}/decrypt`, {
    method: 'POST',
    token: docToken
  });
  assert.equal(postRevokeDec.status, 410);

  // 6. Verify 52-Byte SMS gateway endpoint & audit chain integrity
  const smsRes = await reqJson('/mesh/sms-gateway', {
    method: 'POST',
    token: docToken,
    body: { smsPacketB64: trigRes.data.smsPacket.base64, dispatchNow: false }
  });
  assert.equal(smsRes.status, 200);
  assert.equal(smsRes.data.decoded.hrBpm, 144);

  const auditRes = await reqJson('/audit', { token: docToken });
  assert.equal(auditRes.status, 200);
  assert.equal(auditRes.data.chainValid, true);
});
