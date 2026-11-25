import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import { MICRO_ZONES, HARDWARE_SKUS, FIVE_YEAR_FINANCIALS, UNIT_ECONOMICS, DECK_SLIDES } from '../shared/domainData.js';
import { encodeGeoHash, getGeoHashRing, haversineMeters, estimateEtaSeconds, findBleMeshRoute } from '../shared/geohash.js';
import { db } from './db.js';
import {
  signAuthToken,
  sanitizeUser,
  hashPassword,
  comparePassword,
  requireAuth,
  requireRole,
  verifyResponderCredential
} from './auth.js';
import {
  generateEcdhKeyPair,
  wrapPrivateKeyForStorage,
  sealIncidentEnvelope,
  unsealIncidentEnvelope,
  revokeEnvelopeKeys,
  encodeBinarySms52,
  decodeBinarySms52
} from './cryptoEngine.js';
import { addSseClient, broadcastEvent } from './sseHub.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '../dist');

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Helper to build synthetic BLE relay mesh nodes around a micro-zone
function buildMeshRelayNodes(zoneId) {
  const z = MICRO_ZONES[zoneId] || MICRO_ZONES.aiims_delhi;
  const boxes = db.getPulseBoxes(zoneId);
  const docs = db.getResponders(zoneId).filter((r) => Boolean(r.available));

  const nodes = [
    {
      id: 'NODE-B-WATCH',
      label: 'Pedestrian Smartwatch Relay (BLE 5.0)',
      kind: 'wearable_relay',
      lat: Number((z.lat + 0.00024).toFixed(6)),
      lng: Number((z.lng + 0.00018).toFixed(6)),
      indoor: true,
      hasUplink: false
    },
    {
      id: 'NODE-C-OBD',
      label: 'PulseGuard OBD-II Pro Taxi (eSIM Gateway)',
      kind: 'gateway_cloud',
      lat: Number((z.lat + 0.00052).toFixed(6)),
      lng: Number((z.lng + 0.00042).toFixed(6)),
      indoor: false,
      hasUplink: true
    }
  ];

  for (const box of boxes) {
    nodes.push({
      id: box.id,
      label: `PulseBox Gateway (${box.id})`,
      kind: 'gateway_cloud',
      lat: box.lat,
      lng: box.lng,
      indoor: false,
      hasUplink: true
    });
  }

  for (const doc of docs.slice(0, 2)) {
    nodes.push({
      id: `NODE-DOC-${doc.id.slice(-4).toUpperCase()}`,
      label: `${doc.name} Mobile Gateway`,
      kind: 'gateway_cloud',
      lat: doc.lat,
      lng: doc.lng,
      indoor: false,
      hasUplink: true
    });
  }
  return nodes;
}

function rankZoneResponders(zoneId, lat, lng, greenCorridor = false) {
  const allResponders = db.getResponders(zoneId);
  const ring = getGeoHashRing(lat, lng, 6);
  return allResponders
    .filter((r) => Boolean(r.available))
    .map((r) => {
      const distanceM = Math.round(haversineMeters(lat, lng, r.lat, r.lng));
      const etaSec = estimateEtaSeconds(distanceM, 'foot_sprint');
      const rHash = encodeGeoHash(r.lat, r.lng, 6);
      return {
        id: r.id,
        name: r.name,
        nmcId: r.nmc_id,
        abdmHprId: r.abdm_hpr_id,
        tier: r.responder_tier,
        specialty: r.specialty,
        geohash: rHash,
        inMicroFence: ring.cells.includes(rHash) || distanceM <= 2000,
        distanceM,
        etaSec,
        lat: r.lat,
        lng: r.lng,
        ecdhPubKey: r.ecdh_pub_key
      };
    })
    .sort((a, b) => a.distanceM - b.distanceM);
}

function serializeIncident(inc, viewer) {
  const envelope = JSON.parse(inc.encrypted_envelope_json);
  const vitals = JSON.parse(inc.vitals_json);
  const bleRoute = JSON.parse(inc.ble_route_json);
  const authorizedIds = Object.keys(envelope.wrappedKeys || {});
  const isAuthorizedViewer =
    viewer &&
    (viewer.id === inc.user_id ||
      viewer.role === 'dispatcher' ||
      authorizedIds.includes(viewer.id));

  const matchedResponders = rankZoneResponders(inc.micro_zone, inc.lat, inc.lng, Boolean(inc.green_corridor)).map(
    ({ ecdhPubKey, ...rest }) => rest
  );

  return {
    id: inc.id,
    userId: inc.user_id,
    victimName: isAuthorizedViewer ? inc.victim_name : 'Protected Citizen (ECDH Sealed)',
    microZone: inc.micro_zone,
    geohash: inc.geohash,
    triggerType: inc.trigger_type,
    transportMode: inc.transport_mode,
    lat: inc.lat,
    lng: inc.lng,
    status: inc.status,
    vitals,
    smsPacketB64: inc.sms_packet_b64,
    bleRoute,
    assignedResponderId: inc.assigned_responder_id,
    assignedResponderName: inc.assigned_responder_name,
    responderEtaSec: inc.responder_eta_sec,
    ambulanceEtaSec: inc.ambulance_eta_sec,
    greenCorridor: Boolean(inc.green_corridor),
    pulseboxUnlocked: Boolean(inc.pulsebox_unlocked),
    indemnityCertId: inc.indemnity_cert_id,
    indemnityAmountInr: inc.indemnity_amount_inr,
    stipendAwardedInr: inc.stipend_awarded_inr,
    matchedResponders,
    envelopeSummary: {
      algorithm: envelope.algorithm,
      ephemeralPubKeyHex: envelope.ephemeralPubKeyHex,
      ivHex: envelope.ivHex,
      authTagHex: envelope.authTagHex,
      ciphertextHex: envelope.ciphertextHex,
      authorizedRecipientIds: authorizedIds,
      revoked: Boolean(envelope.revoked),
      revokedAt: envelope.revokedAt
    },
    createdAt: inc.created_at,
    resolvedAt: inc.resolved_at
  };
}

// ============================================================================
// HEALTH & STATIC ARCHITECTURE METADATA
// ============================================================================
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'PulseGuard AI v4.0 Backend',
    storage: db.useSqlite ? 'node:sqlite' : 'json-fallback',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/reference-data', (_req, res) => {
  res.json({
    zones: MICRO_ZONES,
    hardwareSkus: HARDWARE_SKUS,
    financials: FIVE_YEAR_FINANCIALS,
    unitEconomics: UNIT_ECONOMICS,
    slides: DECK_SLIDES
  });
});

// ============================================================================
// AUTHENTICATION & NMC/ABDM PROFILE MANAGEMENT
// ============================================================================
app.get('/api/auth/demo-accounts', (_req, res) => {
  res.json({ accounts: db.listDemoUsers() });
});

app.post('/api/auth/demo-login', (req, res) => {
  const { userId, email } = req.body || {};
  const user = userId ? db.getUserById(userId) : email ? db.getUserByEmail(email) : null;
  if (!user) return res.status(404).json({ error: 'Demo account not found.' });

  const token = signAuthToken(user);
  db.appendAuditLog({
    actorId: user.id,
    actorRole: user.role,
    action: 'DEMO_SESSION_SWITCH',
    detail: `${user.name} (${user.role}) authenticated via sandbox switcher.`
  });

  res.json({ token, user: sanitizeUser(user) });
});

app.post('/api/auth/register', async (req, res) => {
  const {
    name,
    email,
    password,
    role = 'citizen',
    phone,
    bloodGroup,
    allergies,
    emergencyContact,
    safeWordLabel,
    nmcId,
    specialty,
    microZone = 'aiims_delhi'
  } = req.body || {};

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return res.status(400).json({ error: 'Full name (min 2 chars) is required.' });
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email address is required.' });
  }
  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }
  if (!['citizen', 'responder', 'dispatcher'].includes(role)) {
    return res.status(400).json({ error: 'Role must be citizen, responder, or dispatcher.' });
  }
  if (db.getUserByEmail(email)) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  let responderTier = null;
  let abdmHprId = null;
  let cleanNmc = null;

  if (role === 'responder') {
    const check = verifyResponderCredential(nmcId);
    if (!check.verified) {
      return res.status(400).json({ error: check.error });
    }
    responderTier = check.tier;
    abdmHprId = check.abdmHprId;
    cleanNmc = check.credentialId;
  }

  const zone = MICRO_ZONES[microZone] || MICRO_ZONES.aiims_delhi;
  const keys = generateEcdhKeyPair();
  const passwordHash = await hashPassword(String(password));
  const cleanSafeWord = (safeWordLabel || 'RED LOTUS').trim().toUpperCase();
  const userId = `usr-${role}-${crypto.randomBytes(4).toString('hex')}`;

  // Offset coordinates slightly inside the micro-zone
  const jitterLat = (Math.random() - 0.5) * 0.004;
  const jitterLng = (Math.random() - 0.5) * 0.004;

  const created = db.createUser({
    id: userId,
    name: name.trim(),
    email: email.trim().toLowerCase(),
    password_hash: passwordHash,
    role,
    phone: phone?.trim() || '+91-98110-00112',
    blood_group: bloodGroup || 'O+',
    allergies: allergies || 'None reported',
    emergency_contact: emergencyContact || 'Family Emergency Desk (+91-112)',
    safeword_label: cleanSafeWord,
    safeword_template_hash: crypto.createHash('sha256').update(cleanSafeWord).digest('hex').slice(0, 16),
    nmc_id: cleanNmc,
    abdm_hpr_id: abdmHprId,
    responder_tier: responderTier,
    specialty: specialty || (role === 'responder' ? 'Verified Responder' : role === 'dispatcher' ? '112 Command' : 'Citizen Guardian'),
    micro_zone: zone.id,
    lat: Number((zone.lat + jitterLat).toFixed(6)),
    lng: Number((zone.lng + jitterLng).toFixed(6)),
    ecdh_pub_key: keys.pubKeyHex,
    ecdh_priv_key_enc: wrapPrivateKeyForStorage(keys.privKeyHex),
    available: 1,
    stipend_balance_inr: 0,
    cme_credits: 0,
    tax_rebate_inr: 0,
    created_at: new Date().toISOString()
  });

  const token = signAuthToken(created);
  db.appendAuditLog({
    actorId: created.id,
    actorRole: created.role,
    action: 'USER_REGISTERED',
    detail: `New ${created.role} enrolled in ${zone.shortName}${cleanNmc ? ` (${cleanNmc})` : ''} with ECDH-P256 identity.`
  });

  res.status(201).json({ token, user: sanitizeUser(created) });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  const user = db.getUserByEmail(email);
  if (!user) return res.status(401).json({ error: 'Invalid email or password.' });

  const ok = await comparePassword(String(password), user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid email or password.' });

  const token = signAuthToken(user);
  db.appendAuditLog({
    actorId: user.id,
    actorRole: user.role,
    action: 'USER_LOGIN',
    detail: `${user.name} signed in via JWT auth.`
  });
  res.json({ token, user: sanitizeUser(user) });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: sanitizeUser(req.user) });
});

app.patch('/api/auth/profile', requireAuth, (req, res) => {
  const {
    name,
    phone,
    bloodGroup,
    allergies,
    emergencyContact,
    safeWordLabel,
    safeWordTemplateHash,
    microZone,
    available
  } = req.body || {};

  const patch = {};
  if (name) patch.name = String(name).trim();
  if (phone) patch.phone = String(phone).trim();
  if (bloodGroup) patch.blood_group = String(bloodGroup).trim();
  if (allergies !== undefined) patch.allergies = String(allergies).trim();
  if (emergencyContact) patch.emergency_contact = String(emergencyContact).trim();
  if (safeWordLabel) {
    const cleanWord = String(safeWordLabel).trim().toUpperCase();
    patch.safeword_label = cleanWord;
    patch.safeword_template_hash =
      safeWordTemplateHash ||
      crypto.createHash('sha256').update(cleanWord).digest('hex').slice(0, 16);
  }
  if (microZone && MICRO_ZONES[microZone]) {
    patch.micro_zone = microZone;
    patch.lat = MICRO_ZONES[microZone].lat;
    patch.lng = MICRO_ZONES[microZone].lng;
  }
  if (available !== undefined) patch.available = available ? 1 : 0;

  const updated = db.updateUserProfile(req.user.id, patch);
  broadcastEvent('responder_updated', { userId: updated.id, available: Boolean(updated.available), microZone: updated.micro_zone });
  res.json({ user: sanitizeUser(updated) });
});

app.get('/api/responders/verify-nmc/:nmcId', (req, res) => {
  const result = verifyResponderCredential(req.params.nmcId);
  res.status(result.verified ? 200 : 404).json(result);
});

// ============================================================================
// ZONES, LIQUIDITY & REAL-TIME SSE STREAM
// ============================================================================
app.get('/api/zones/:zoneId/snapshot', requireAuth, (req, res) => {
  const zoneId = MICRO_ZONES[req.params.zoneId] ? req.params.zoneId : 'aiims_delhi';
  const zone = MICRO_ZONES[zoneId];
  const zoneState = db.getZoneState(zoneId);
  const responders = rankZoneResponders(zoneId, zone.lat, zone.lng, Boolean(zoneState.green_corridor)).map(
    ({ ecdhPubKey, ...rest }) => rest
  );
  const pulseboxes = db.getPulseBoxes(zoneId).map((b) => ({
    id: b.id,
    name: b.name,
    microZone: b.micro_zone,
    lat: b.lat,
    lng: b.lng,
    aedUnlocked: Boolean(b.aed_unlocked),
    intercomActive: Boolean(b.intercom_active),
    supplies: JSON.parse(b.supplies_json),
    updatedAt: b.updated_at
  }));

  res.json({
    zone,
    greenCorridor: Boolean(zoneState.green_corridor),
    overnightSurge: Boolean(zoneState.overnight_surge),
    responders,
    pulseboxes,
    meshNodes: buildMeshRelayNodes(zoneId)
  });
});

app.get('/api/events', requireAuth, (req, res) => {
  addSseClient(res, req.user);
});

// ============================================================================
// INCIDENT DISPATCH, E2EE ENVELOPE, GOOD SAMARITAN SHIELD & STIPENDS
// ============================================================================
function createIncidentInternal({
  user,
  zoneId,
  lat,
  lng,
  triggerType,
  transportMode,
  vitals,
  evidenceNote
}) {
  const zone = MICRO_ZONES[zoneId] || MICRO_ZONES.aiims_delhi;
  const targetLat = Number(lat ?? zone.lat);
  const targetLng = Number(lng ?? zone.lng);
  const geohash = encodeGeoHash(targetLat, targetLng, 6);
  const zoneState = db.getZoneState(zone.id);

  const rankedResponders = rankZoneResponders(zone.id, targetLat, targetLng, Boolean(zoneState.green_corridor));
  const dispatchers = db.getDispatchers();

  // Compute BLE 5.0 Coded PHY multi-hop path if operating in BLE Mesh / Dead Zone mode
  const meshNodes = buildMeshRelayNodes(zone.id);
  const bleRoute = findBleMeshRoute({ lat: targetLat, lng: targetLng, indoor: transportMode === 'BLE_MESH' }, meshNodes, 4);

  // Seal telemetry strictly for matched micro-zone responders + 112 dispatchers using ephemeral ECDH P-256 + AES-256-GCM
  const authorizedUserObjects = [
    user,
    ...rankedResponders.slice(0, 3).map((r) => db.getUserById(r.id)).filter(Boolean),
    ...dispatchers
  ];

  const sealedPayload = {
    victimId: user.id,
    victimName: user.name,
    phone: user.phone,
    bloodGroup: user.blood_group,
    allergies: user.allergies,
    emergencyContact: user.emergency_contact,
    exactLat: targetLat,
    exactLng: targetLng,
    geohash,
    triggerType,
    transportMode,
    vitals,
    evidenceNote: evidenceNote || 'Edge-verified trigger; post-trigger telemetry stream active.'
  };

  const envelope = sealIncidentEnvelope(sealedPayload, authorizedUserObjects);
  const smsPacket = encodeBinarySms52({
    lat: targetLat,
    lng: targetLng,
    userId: user.id,
    hrBpm: vitals?.hrBpm || 142,
    spo2Pct: vitals?.spo2Pct || 94,
    triggerType,
    linearImuG: vitals?.linearImuG ?? 0.08,
    bleFallback: transportMode !== '4G_WS'
  });

  const ambulanceDistM = haversineMeters(
    zone.ambulanceStation.lat,
    zone.ambulanceStation.lng,
    targetLat,
    targetLng
  );
  const ambulanceEtaSec = estimateEtaSeconds(
    ambulanceDistM,
    zoneState.green_corridor ? 'ambulance_green' : 'ambulance_traffic'
  );

  const incId = `INC-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const created = db.createIncident({
    id: incId,
    user_id: user.id,
    victim_name: user.name,
    micro_zone: zone.id,
    geohash,
    trigger_type: triggerType,
    transport_mode: transportMode,
    lat: targetLat,
    lng: targetLng,
    status: 'ACTIVE',
    vitals_json: JSON.stringify(vitals || {}),
    encrypted_envelope_json: JSON.stringify(envelope),
    sms_packet_b64: smsPacket.base64,
    ble_route_json: JSON.stringify(bleRoute),
    assigned_responder_id: null,
    assigned_responder_name: null,
    responder_eta_sec: rankedResponders[0]?.etaSec || 160,
    ambulance_eta_sec: ambulanceEtaSec,
    green_corridor: zoneState.green_corridor ? 1 : 0,
    pulsebox_unlocked: 0,
    indemnity_cert_id: null,
    indemnity_amount_inr: 1000000,
    stipend_awarded_inr: 0,
    created_at: new Date().toISOString(),
    resolved_at: null
  });

  db.appendAuditLog({
    incidentId: incId,
    actorId: user.id,
    actorRole: user.role,
    action: 'SOS_DISPATCHED_E2EE',
    detail: `Triggered ${triggerType} via ${transportMode} in ${zone.shortName} (GeoHash ${geohash}). ECDH-P256 scoped to ${Object.keys(envelope.wrappedKeys).length} keys; 52B SMS generated.`
  });

  const serialized = serializeIncident(created, user);
  broadcastEvent('incident_created', serialized);
  return { incident: serialized, smsPacket };
}

app.get('/api/incidents', requireAuth, (req, res) => {
  const rows = db.listIncidents(40);
  res.json({
    incidents: rows.map((row) => serializeIncident(row, req.user))
  });
});

app.post('/api/incidents/trigger', requireAuth, (req, res) => {
  const {
    microZone,
    lat,
    lng,
    triggerType = 'SAFEWORD',
    transportMode = '4G_WS',
    vitals = {},
    evidenceNote
  } = req.body || {};

  const validTriggers = ['SAFEWORD', 'PPG_DISTRESS', 'CRASH_OBD', 'PULSEBOX_SOS', 'MANUAL_SOS'];
  const validTransports = ['4G_WS', 'BLE_MESH', 'BINARY_SMS'];
  if (!validTriggers.includes(triggerType)) {
    return res.status(400).json({ error: `Invalid triggerType. Must be one of ${validTriggers.join(', ')}` });
  }
  if (!validTransports.includes(transportMode)) {
    return res.status(400).json({ error: `Invalid transportMode. Must be one of ${validTransports.join(', ')}` });
  }

  const zoneId = MICRO_ZONES[microZone] ? microZone : req.user.micro_zone;
  const result = createIncidentInternal({
    user: req.user,
    zoneId,
    lat,
    lng,
    triggerType,
    transportMode,
    vitals,
    evidenceNote
  });

  res.status(201).json(result);
});

app.post('/api/incidents/:id/decrypt', requireAuth, (req, res) => {
  const inc = db.getIncidentById(req.params.id);
  if (!inc) return res.status(404).json({ error: 'Incident not found.' });

  const envelope = JSON.parse(inc.encrypted_envelope_json);
  try {
    const decryptedPayload = unsealIncidentEnvelope(envelope, req.user);
    db.appendAuditLog({
      incidentId: inc.id,
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'E2EE_TELEMETRY_DECRYPTED',
      detail: `${req.user.name} decrypted ECDH-P256 + AES-256-GCM envelope.`
    });
    res.json({
      verified: true,
      algorithm: envelope.algorithm,
      decryptedBy: { id: req.user.id, name: req.user.name, role: req.user.role },
      payload: decryptedPayload
    });
  } catch (err) {
    db.appendAuditLog({
      incidentId: inc.id,
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'E2EE_DECRYPT_BLOCKED',
      detail: `Blocked decryption attempt by ${req.user.name}: ${err.code || err.message}`
    });
    res.status(err.status || 403).json({ error: err.message, code: err.code || 'CRYPTO_SCOPE_DENIED' });
  }
});

app.post('/api/incidents/:id/accept', requireAuth, requireRole('responder', 'dispatcher'), (req, res) => {
  const inc = db.getIncidentById(req.params.id);
  if (!inc) return res.status(404).json({ error: 'Incident not found.' });
  if (['STABILIZED', 'CANCELLED'].includes(inc.status)) {
    return res.status(409).json({ error: `Incident is already ${inc.status}.` });
  }

  const distM = haversineMeters(req.user.lat, req.user.lng, inc.lat, inc.lng);
  const etaSec = estimateEtaSeconds(distM, 'foot_sprint');
  const certId = `GS-134A-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

  const updated = db.updateIncident(inc.id, {
    status: 'DISPATCHED',
    assigned_responder_id: req.user.id,
    assigned_responder_name: req.user.name,
    responder_eta_sec: etaSec,
    indemnity_cert_id: certId
  });

  db.appendAuditLog({
    incidentId: inc.id,
    actorId: req.user.id,
    actorRole: req.user.role,
    action: 'RESPONDER_ACCEPTED_DISPATCH',
    detail: `${req.user.name} accepted dispatch (${Math.round(distM)}m away, ETA ${etaSec}s). Activated Section 134A Shield & ₹10L Indemnity (${certId}).`
  });

  const serialized = serializeIncident(updated, req.user);
  broadcastEvent('incident_updated', serialized);
  res.json({ incident: serialized });
});

app.post('/api/incidents/:id/status', requireAuth, (req, res) => {
  const inc = db.getIncidentById(req.params.id);
  if (!inc) return res.status(404).json({ error: 'Incident not found.' });

  const { status } = req.body || {};
  const allowed = ['ON_SCENE', 'STABILIZED', 'CANCELLED'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${allowed.join(', ')}` });
  }

  // Citizens can cancel their own SOS (false-alarm cancel); responders/dispatchers can progress care
  if (status === 'CANCELLED' && req.user.role === 'citizen' && inc.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the citizen who raised the alert or 112 Command can cancel it.' });
  }
  if (status !== 'CANCELLED' && !['responder', 'dispatcher'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Only verified responders or 112 Command can mark clinical scene progression.' });
  }

  const patch = { status };
  let stipendAwarded = 0;

  if (status === 'STABILIZED' || status === 'CANCELLED') {
    const oldEnvelope = JSON.parse(inc.encrypted_envelope_json);
    const shreddedEnvelope = revokeEnvelopeKeys(oldEnvelope);
    patch.encrypted_envelope_json = JSON.stringify(shreddedEnvelope);
    patch.resolved_at = new Date().toISOString();
  }

  if (status === 'STABILIZED') {
    const zoneState = db.getZoneState(inc.micro_zone);
    const isSurge = Boolean(zoneState.overnight_surge);
    stipendAwarded = isSurge ? 1200 : 600;
    patch.stipend_awarded_inr = stipendAwarded;

    const responderId = inc.assigned_responder_id || (req.user.role === 'responder' ? req.user.id : null);
    if (responderId) {
      const respUser = db.getUserById(responderId);
      if (respUser) {
        db.updateUserProfile(respUser.id, {
          stipend_balance_inr: (respUser.stipend_balance_inr || 0) + stipendAwarded,
          cme_credits: (respUser.cme_credits || 0) + 2,
          tax_rebate_inr: (respUser.tax_rebate_inr || 0) + (isSurge ? 1500 : 750)
        });
      }
    }
  }

  const updated = db.updateIncident(inc.id, patch);
  db.appendAuditLog({
    incidentId: inc.id,
    actorId: req.user.id,
    actorRole: req.user.role,
    action: status === 'STABILIZED' ? 'PATIENT_STABILIZED_KEYS_REVOKED' : `INCIDENT_${status}`,
    detail:
      status === 'STABILIZED'
        ? `Patient stabilized. Awarded ₹${stipendAwarded} insurer stipend + 2 CME credits. Ephemeral ECDH keys cryptographically shredded.`
        : `Incident transitioned to ${status} by ${req.user.name}.${status === 'CANCELLED' ? ' Ephemeral ECDH keys shredded.' : ''}`
  });

  const serialized = serializeIncident(updated, req.user);
  broadcastEvent('incident_updated', serialized);
  res.json({ incident: serialized, stipendAwardedInr: stipendAwarded });
});

// ============================================================================
// OFFLINE RESILIENCE: 52-BYTE BINARY SMS GATEWAY & BLE 5.0 MESH ROUTER
// ============================================================================
app.post('/api/mesh/sms-gateway', requireAuth, (req, res) => {
  const { smsPacketB64, microZone = 'aiims_delhi', dispatchNow = false } = req.body || {};
  try {
    const decoded = decodeBinarySms52(smsPacketB64);
    let createdIncident = null;
    if (dispatchNow) {
      const resInc = createIncidentInternal({
        user: req.user,
        zoneId: microZone,
        lat: decoded.lat,
        lng: decoded.lng,
        triggerType: decoded.triggerType,
        transportMode: 'BINARY_SMS',
        vitals: {
          hrBpm: decoded.hrBpm,
          spo2Pct: decoded.spo2Pct,
          linearImuG: decoded.linearImuG
        },
        evidenceNote: `Ingested via 52-Byte AES-256-GCM Priority SMS Gateway (${smsPacketB64.trim().length} Base64 chars).`
      });
      createdIncident = resInc.incident;
    }

    db.appendAuditLog({
      incidentId: createdIncident?.id || null,
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'SMS_52B_GATEWAY_VERIFIED',
      detail: `Verified 52-byte AES-256-GCM binary SMS (HR ${decoded.hrBpm} BPM, SpO2 ${decoded.spo2Pct}%, trigger ${decoded.triggerType}).`
    });

    res.json({ decoded, createdIncident });
  } catch (err) {
    res.status(400).json({ error: err.message, code: err.code || 'SMS_DECODE_ERROR' });
  }
});

app.post('/api/mesh/ble-simulate', requireAuth, (req, res) => {
  const { microZone = 'aiims_delhi', indoor = true, lat, lng } = req.body || {};
  const zone = MICRO_ZONES[microZone] || MICRO_ZONES.aiims_delhi;
  const originLat = Number(lat ?? zone.lat);
  const originLng = Number(lng ?? zone.lng);
  const nodes = buildMeshRelayNodes(zone.id);
  const route = findBleMeshRoute({ lat: originLat, lng: originLng, indoor }, nodes, 4);
  res.json({ zoneId: zone.id, nodes, route });
});

// ============================================================================
// PULSEBOX SMART TRIAGE HUB & 112 GREEN CORRIDOR CONTROLS
// ============================================================================
app.post('/api/pulsebox/:id/unlock-aed', requireAuth, requireRole('responder', 'dispatcher'), (req, res) => {
  const box = db.getPulseBoxById(req.params.id);
  if (!box) return res.status(404).json({ error: 'PulseBox unit not found.' });

  const nextUnlocked = req.body?.unlock === false ? 0 : 1;
  const updated = db.updatePulseBox(box.id, {
    aed_unlocked: nextUnlocked,
    updated_at: new Date().toISOString()
  });

  if (req.body?.incidentId) {
    const inc = db.getIncidentById(req.body.incidentId);
    if (inc) {
      db.updateIncident(inc.id, { pulsebox_unlocked: nextUnlocked });
    }
  }

  db.appendAuditLog({
    incidentId: req.body?.incidentId || null,
    actorId: req.user.id,
    actorRole: req.user.role,
    action: nextUnlocked ? 'PULSEBOX_AED_UNLOCKED' : 'PULSEBOX_AED_LOCKED',
    detail: `${box.name} AED solenoid ${nextUnlocked ? 'unlocked remotely' : 're-secured'} by ${req.user.name}.`
  });

  const payload = {
    id: updated.id,
    name: updated.name,
    microZone: updated.micro_zone,
    lat: updated.lat,
    lng: updated.lng,
    aedUnlocked: Boolean(updated.aed_unlocked),
    intercomActive: Boolean(updated.intercom_active),
    supplies: JSON.parse(updated.supplies_json),
    updatedAt: updated.updated_at
  };
  broadcastEvent('pulsebox_updated', payload);
  res.json({ pulsebox: payload });
});

app.post('/api/pulsebox/:id/consume-supply', requireAuth, (req, res) => {
  const box = db.getPulseBoxById(req.params.id);
  if (!box) return res.status(404).json({ error: 'PulseBox unit not found.' });

  const { supplyId, action = 'consume' } = req.body || {};
  const supplies = JSON.parse(box.supplies_json);
  const nextSupplies = supplies.map((item) => {
    if (item.id !== supplyId) return item;
    if (action === 'restock') return { ...item, qty: item.max };
    return { ...item, qty: Math.max(0, item.qty - 1) };
  });

  const updated = db.updatePulseBox(box.id, {
    supplies_json: JSON.stringify(nextSupplies),
    updated_at: new Date().toISOString()
  });

  const payload = {
    id: updated.id,
    name: updated.name,
    microZone: updated.micro_zone,
    lat: updated.lat,
    lng: updated.lng,
    aedUnlocked: Boolean(updated.aed_unlocked),
    intercomActive: Boolean(updated.intercom_active),
    supplies: nextSupplies,
    updatedAt: updated.updated_at
  };
  broadcastEvent('pulsebox_updated', payload);
  res.json({ pulsebox: payload });
});

app.post('/api/command/zone-controls', requireAuth, (req, res) => {
  const { microZone = 'aiims_delhi', greenCorridor, overnightSurge } = req.body || {};
  const zone = MICRO_ZONES[microZone] || MICRO_ZONES.aiims_delhi;
  const current = db.getZoneState(zone.id);

  if (greenCorridor !== undefined && !['dispatcher', 'responder'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Green Corridor pre-emption requires 112 Dispatcher or Responder authorization.' });
  }

  const next = db.updateZoneState(zone.id, {
    green_corridor: greenCorridor !== undefined ? (greenCorridor ? 1 : 0) : current.green_corridor,
    overnight_surge: overnightSurge !== undefined ? (overnightSurge ? 1 : 0) : current.overnight_surge
  });

  // Update active incidents in this zone with recalculated 108 ambulance ETA
  const incidents = db.listIncidents(25).filter((i) => i.micro_zone === zone.id && ['ACTIVE', 'DISPATCHED', 'ON_SCENE'].includes(i.status));
  for (const inc of incidents) {
    const ambDist = haversineMeters(zone.ambulanceStation.lat, zone.ambulanceStation.lng, inc.lat, inc.lng);
    const eta = estimateEtaSeconds(ambDist, next.green_corridor ? 'ambulance_green' : 'ambulance_traffic');
    const updated = db.updateIncident(inc.id, { green_corridor: next.green_corridor, ambulance_eta_sec: eta });
    broadcastEvent('incident_updated', serializeIncident(updated, req.user));
  }

  db.appendAuditLog({
    actorId: req.user.id,
    actorRole: req.user.role,
    action: 'ZONE_CONTROL_UPDATED',
    detail: `${zone.shortName}: Green Corridor=${Boolean(next.green_corridor)}, 11PM-6AM 2x Surge=${Boolean(next.overnight_surge)}.`
  });

  broadcastEvent('zone_controls_updated', {
    microZone: zone.id,
    greenCorridor: Boolean(next.green_corridor),
    overnightSurge: Boolean(next.overnight_surge)
  });

  res.json({
    microZone: zone.id,
    greenCorridor: Boolean(next.green_corridor),
    overnightSurge: Boolean(next.overnight_surge)
  });
});

app.get('/api/audit', requireAuth, (req, res) => {
  res.json(db.getAuditLogs(50));
});

// ============================================================================
// PRODUCTION STATIC CLIENT (VITE DIST)
// ============================================================================
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

export default app;
