import crypto from 'node:crypto';

const MASTER_KEY_HEX =
  process.env.PULSEGUARD_MASTER_SMS_KEY ||
  '9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0';

function getMasterKey32() {
  return crypto.createHash('sha256').update(MASTER_KEY_HEX).digest();
}

export function generateEcdhKeyPair() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    pubKeyHex: ecdh.getPublicKey('hex', 'uncompressed'),
    privKeyHex: ecdh.getPrivateKey('hex')
  };
}

export function wrapPrivateKeyForStorage(privKeyHex) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getMasterKey32(), iv);
  const enc = Buffer.concat([cipher.update(privKeyHex, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    ct: enc.toString('hex')
  });
}

export function unwrapPrivateKeyFromStorage(wrappedJson) {
  const { iv, tag, ct } = JSON.parse(wrappedJson);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getMasterKey32(), Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'hex')), decipher.final()]).toString('utf8');
}

function deriveEcdhAesKey(privKeyHex, peerPubKeyHex, saltBuf) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(privKeyHex, 'hex'));
  const shared = ecdh.computeSecret(Buffer.from(peerPubKeyHex, 'hex'));
  return Buffer.from(crypto.hkdfSync('sha256', shared, saltBuf, Buffer.from('PulseGuard-E2EE-v4'), 32));
}

/**
 * Seals clinical SOS telemetry with a fresh ephemeral ECDH P-256 keypair + AES-256-GCM
 * and wraps the DEK exclusively for authorized responder/112 recipients.
 */
export function sealIncidentEnvelope(payloadObj, authorizedRecipients) {
  const ephemeral = generateEcdhKeyPair();
  const dek = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const salt = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);
  cipher.setAAD(Buffer.from('PulseGuard-Telemetry-v4'));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payloadObj), 'utf8'),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();

  const wrappedKeys = {};
  for (const recipient of authorizedRecipients) {
    if (!recipient?.ecdh_pub_key) continue;
    const kek = deriveEcdhAesKey(ephemeral.privKeyHex, recipient.ecdh_pub_key, salt);
    const wrapIv = crypto.randomBytes(12);
    const wrapCipher = crypto.createCipheriv('aes-256-gcm', kek, wrapIv);
    const wrappedDek = Buffer.concat([wrapCipher.update(dek), wrapCipher.final()]);
    wrappedKeys[recipient.id] = {
      recipientName: recipient.name,
      role: recipient.role,
      nmcId: recipient.nmc_id || null,
      wrapIvHex: wrapIv.toString('hex'),
      wrapTagHex: wrapCipher.getAuthTag().toString('hex'),
      wrappedDekHex: wrappedDek.toString('hex')
    };
  }

  return {
    algorithm: 'ECDH-P256 + HKDF-SHA256 + AES-256-GCM',
    ephemeralPubKeyHex: ephemeral.pubKeyHex,
    saltHex: salt.toString('hex'),
    ivHex: iv.toString('hex'),
    authTagHex: authTag.toString('hex'),
    ciphertextHex: ciphertext.toString('hex'),
    wrappedKeys,
    revoked: false,
    revokedAt: null
  };
}

/**
 * Decrypts incident telemetry strictly for an authorized recipient with a valid wrapped DEK.
 */
export function unsealIncidentEnvelope(envelope, recipientUser) {
  if (!envelope || envelope.revoked) {
    const err = new Error('Ephemeral ECDH keys have been cryptographically shredded upon incident closure.');
    err.code = 'EPHEMERAL_KEYS_REVOKED';
    err.status = 410;
    throw err;
  }

  const grant = envelope.wrappedKeys?.[recipientUser.id];
  if (!grant) {
    const err = new Error('Access denied: recipient public key has no ECDH key-wrap grant for this incident.');
    err.code = 'CRYPTO_SCOPE_DENIED';
    err.status = 403;
    throw err;
  }

  const privKeyHex = unwrapPrivateKeyFromStorage(recipientUser.ecdh_priv_key_enc);
  const kek = deriveEcdhAesKey(privKeyHex, envelope.ephemeralPubKeyHex, Buffer.from(envelope.saltHex, 'hex'));

  const unwrapDecipher = crypto.createDecipheriv('aes-256-gcm', kek, Buffer.from(grant.wrapIvHex, 'hex'));
  unwrapDecipher.setAuthTag(Buffer.from(grant.wrapTagHex, 'hex'));
  const dek = Buffer.concat([
    unwrapDecipher.update(Buffer.from(grant.wrappedDekHex, 'hex')),
    unwrapDecipher.final()
  ]);

  const decipher = crypto.createDecipheriv('aes-256-gcm', dek, Buffer.from(envelope.ivHex, 'hex'));
  decipher.setAAD(Buffer.from('PulseGuard-Telemetry-v4'));
  decipher.setAuthTag(Buffer.from(envelope.authTagHex, 'hex'));
  const plainBuf = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertextHex, 'hex')),
    decipher.final()
  ]);

  return JSON.parse(plainBuf.toString('utf8'));
}

export function revokeEnvelopeKeys(envelope) {
  return {
    ...envelope,
    wrappedKeys: {},
    revoked: true,
    revokedAt: new Date().toISOString()
  };
}

const TRIGGER_CODE_MAP = {
  SAFEWORD: 1,
  PPG_DISTRESS: 2,
  CRASH_OBD: 3,
  PULSEBOX_SOS: 4,
  MANUAL_SOS: 5
};
const CODE_TRIGGER_MAP = Object.fromEntries(Object.entries(TRIGGER_CODE_MAP).map(([k, v]) => [v, k]));

/**
 * Encodes exact 52-Byte AES-256-GCM Binary SMS Frame (72 Base64 chars, 88B free headroom in 140B SMS):
 *   24B Packed Telemetry (8B GPS + 4B TS + 8B Medical Hash + 4B Vitals)
 * + 12B Nonce/IV
 * + 16B GCM Integrity Tag
 * = 52 Bytes total
 */
export function encodeBinarySms52({
  lat,
  lng,
  timestampSec = Math.floor(Date.now() / 1000),
  userId = 'demo-user',
  hrBpm = 142,
  spo2Pct = 94,
  triggerType = 'SAFEWORD',
  linearImuG = 0.08,
  bleFallback = true
}) {
  const telemetry = Buffer.alloc(24);
  telemetry.writeFloatBE(lat, 0);
  telemetry.writeFloatBE(lng, 4);
  telemetry.writeUInt32BE(timestampSec >>> 0, 8);

  const idHash8 = crypto.createHash('sha256').update(String(userId)).digest().subarray(0, 8);
  idHash8.copy(telemetry, 12);

  telemetry.writeUInt8(Math.max(0, Math.min(255, Math.round(hrBpm))), 20);
  telemetry.writeUInt8(Math.max(0, Math.min(100, Math.round(spo2Pct))), 21);
  const triggerCode = TRIGGER_CODE_MAP[triggerType] || 5;
  const flags = (triggerCode & 0x0f) | (bleFallback ? 0x10 : 0x00);
  telemetry.writeUInt8(flags, 22);
  telemetry.writeUInt8(Math.max(0, Math.min(255, Math.round(linearImuG * 100))), 23);

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getMasterKey32(), iv);
  cipher.setAAD(Buffer.from('PG-SMS52'));
  const ciphertext = Buffer.concat([cipher.update(telemetry), cipher.final()]);
  const tag = cipher.getAuthTag(); // 16 bytes

  const frame52 = Buffer.concat([ciphertext, iv, tag]); // 24 + 12 + 16 = 52 bytes
  const base64 = frame52.toString('base64');

  return {
    byteLength: frame52.length,
    base64,
    base64Length: base64.length,
    gsm140HeadroomBytes: 140 - frame52.length,
    gsm160CharHeadroom: 160 - base64.length,
    segments: {
      telemetryBytes: 24,
      ivBytes: 12,
      authTagBytes: 16,
      breakdown: '8B GPS + 4B TS + 8B ID + 4B Vitals + 12B IV + 16B Tag'
    },
    hexPreview: frame52.toString('hex')
  };
}

/**
 * Decodes and authenticates a 52-byte (72-char Base64) AES-256-GCM Binary SMS packet.
 */
export function decodeBinarySms52(base64Str) {
  const clean = (base64Str || '').trim();
  const raw = Buffer.from(clean, 'base64');
  if (raw.length !== 52) {
    const err = new Error(`Invalid SMS binary length: expected 52 bytes, got ${raw.length} bytes.`);
    err.code = 'INVALID_SMS_FRAME_LENGTH';
    throw err;
  }

  const ciphertext = raw.subarray(0, 24);
  const iv = raw.subarray(24, 36);
  const tag = raw.subarray(36, 52);

  let telemetry;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', getMasterKey32(), iv);
    decipher.setAAD(Buffer.from('PG-SMS52'));
    decipher.setAuthTag(tag);
    telemetry = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    const err = new Error('AES-256-GCM authentication tag verification failed (tampered or corrupted SMS).');
    err.code = 'GCM_AUTH_TAG_FAILED';
    throw err;
  }

  const lat = Number(telemetry.readFloatBE(0).toFixed(5));
  const lng = Number(telemetry.readFloatBE(4).toFixed(5));
  const timestampSec = telemetry.readUInt32BE(8);
  const medicalIdHex = telemetry.subarray(12, 20).toString('hex');
  const hrBpm = telemetry.readUInt8(20);
  const spo2Pct = telemetry.readUInt8(21);
  const flags = telemetry.readUInt8(22);
  const triggerType = CODE_TRIGGER_MAP[flags & 0x0f] || 'MANUAL_SOS';
  const bleFallback = Boolean(flags & 0x10);
  const linearImuG = Number((telemetry.readUInt8(23) / 100).toFixed(2));

  return {
    verified: true,
    lat,
    lng,
    timestampIso: new Date(timestampSec * 1000).toISOString(),
    medicalIdHex,
    hrBpm,
    spo2Pct,
    triggerType,
    bleFallback,
    linearImuG
  };
}
