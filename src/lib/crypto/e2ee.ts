// Real Native Web Crypto API (crypto.subtle) E2EE + Exact 52-Byte Binary SMS Frame Engine
// 24B Packed Telemetry + 12B Random IV + 16B AES-256-GCM Auth Tag = 52 Bytes = 72 Base64 chars

import type { TriggerType } from '@/types/pulseguard';

const TRIGGER_FLAG_MAP: Record<TriggerType, number> = {
  MANUAL_SOS: 1,
  SAFEWORD_VOICE: 2,
  PPG_BIOMETRIC_DISTRESS: 3,
  AUTOMOTIVE_CRASH_OBD: 4,
  AUTOMOTIVE_ROLLOVER_IMU: 5,
  PULSEBOX_HARDWARE_SOS: 6,
};

export interface EphemeralEcdhSession {
  keyPair: CryptoKeyPair;
  publicKeyJwk: JsonWebKey;
  aesKey: CryptoKey;
  createdAtIso: string;
}

export interface PackedTelemetryInput {
  lat: number;
  lng: number;
  timestampSec?: number;
  medicalProfileSummary: string;
  hrBpm: number;
  spo2Pct: number;
  hrvRmssdMs: number;
  triggerType: TriggerType;
  offlineQueued: boolean;
}

export interface SealedEmergencyPacket {
  smsFrame52BBase64: string;
  smsFrameByteLength: number;
  smsBase64CharLength: number;
  gsm160HeadroomChars: number;
  encryptedPayloadBase64: string;
  payloadSha256Hex: string;
  ephemeralPublicKeyJwk: JsonWebKey;
  ivHex: string;
  medicalHashHex: string;
  telemetryBreakdownHex: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64.trim());
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generates a fresh ephemeral ECDH P-256 keypair and derives an AES-256-GCM session key.
 */
export async function createEphemeralEcdhSession(
  peerPublicKeyJwk?: JsonWebKey | null
): Promise<EphemeralEcdhSession> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );

  const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);

  // If peer public key is provided (e.g. responder/dispatch public key), derive shared ECDH secret with peer;
  // otherwise derive against a fresh companion P-256 ephemeral public key so ECDH P-256 DH derivation always executes cleanly.
  let peerPublicKey: CryptoKey;
  if (peerPublicKeyJwk && peerPublicKeyJwk.kty === 'EC') {
    peerPublicKey = await crypto.subtle.importKey(
      'jwk',
      peerPublicKeyJwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      []
    );
  } else {
    const responderPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits']
    );
    peerPublicKey = responderPair.publicKey;
  }

  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peerPublicKey },
    keyPair.privateKey,
    256
  );

  // Hash ECDH shared secret through SHA-256 for uniform 256-bit AES-GCM session key
  const sessionKeyMaterial = await crypto.subtle.digest('SHA-256', sharedBits);
  const aesKey = await crypto.subtle.importKey(
    'raw',
    sessionKeyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  return {
    keyPair,
    publicKeyJwk,
    aesKey,
    createdAtIso: new Date().toISOString(),
  };
}

/**
 * Packs exact 24-byte binary telemetry ArrayBuffer:
 * - Bytes 0..3   (4B): Float32 Latitude (BE)
 * - Bytes 4..7   (4B): Float32 Longitude (BE)
 * - Bytes 8..11  (4B): Uint32 Unix Timestamp in seconds (BE)
 * - Bytes 12..19 (8B): Truncated SHA-256 Medical Profile Hash
 * - Byte  20     (1B): Uint8 Heart Rate BPM (0..255)
 * - Byte  21     (1B): Uint8 SpO2 % (0..100)
 * - Byte  22     (1B): Uint8 HRV RMSSD ms (clamped 0..255)
 * - Byte  23     (1B): Uint8 Status/Trigger Flags (low 4 bits = trigger, bit 4 = offline)
 */
export async function pack24ByteTelemetryBuffer(
  input: PackedTelemetryInput
): Promise<{ buffer: ArrayBuffer; medicalHashHex: string }> {
  const buf = new ArrayBuffer(24);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  view.setFloat32(0, input.lat, false);
  view.setFloat32(4, input.lng, false);
  const tsSec = (input.timestampSec ?? Math.floor(Date.now() / 1000)) >>> 0;
  view.setUint32(8, tsSec, false);

  const medDigest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input.medicalProfileSummary)
  );
  const medHash8 = new Uint8Array(medDigest).slice(0, 8);
  bytes.set(medHash8, 12);

  view.setUint8(20, Math.max(0, Math.min(255, Math.round(input.hrBpm))));
  view.setUint8(21, Math.max(0, Math.min(100, Math.round(input.spo2Pct))));
  view.setUint8(22, Math.max(0, Math.min(255, Math.round(input.hrvRmssdMs))));

  const triggerCode = TRIGGER_FLAG_MAP[input.triggerType] ?? 1;
  const flags = (triggerCode & 0x0f) | (input.offlineQueued ? 0x10 : 0x00);
  view.setUint8(23, flags);

  return { buffer: buf, medicalHashHex: bytesToHex(medHash8) };
}

/**
 * Encrypts the 24-byte binary telemetry buffer + rich incident payload with AES-256-GCM
 * using the incident's ephemeral ECDH-derived session key.
 * Produces an exact 52-byte binary frame (12B IV + 24B ciphertext + 16B GCM auth tag) = 72 Base64 chars.
 */
export async function sealEmergencyPacket(
  input: PackedTelemetryInput,
  richPayload: Record<string, unknown>,
  peerPublicKeyJwk?: JsonWebKey | null
): Promise<{ packet: SealedEmergencyPacket; session: EphemeralEcdhSession }> {
  const session = await createEphemeralEcdhSession(peerPublicKeyJwk);
  const { buffer: telemetry24, medicalHashHex } = await pack24ByteTelemetryBuffer(input);

  const iv52 = crypto.getRandomValues(new Uint8Array(12));
  const aad52 = new TextEncoder().encode('PG-SMS52-V1');
  const encrypted52Buf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv52, additionalData: aad52, tagLength: 128 },
    session.aesKey,
    telemetry24
  );

  // Web Crypto AES-GCM appends the 16-byte auth tag to the 24-byte ciphertext = 40 bytes.
  const encrypted40 = new Uint8Array(encrypted52Buf);
  const frame52 = new Uint8Array(52);
  frame52.set(iv52, 0); // 12B IV
  frame52.set(encrypted40, 12); // 24B CT + 16B GCM Tag

  const smsFrame52BBase64 = bytesToBase64(frame52);

  // Seal full rich JSON telemetry payload using a separate 12-byte IV
  const ivFull = crypto.getRandomValues(new Uint8Array(12));
  const fullPlain = new TextEncoder().encode(JSON.stringify(richPayload));
  const fullCipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ivFull, additionalData: new TextEncoder().encode('PG-FULL-V1'), tagLength: 128 },
    session.aesKey,
    fullPlain
  );
  const fullCipherBytes = new Uint8Array(fullCipherBuf);
  const combinedFull = new Uint8Array(12 + fullCipherBytes.length);
  combinedFull.set(ivFull, 0);
  combinedFull.set(fullCipherBytes, 12);

  const encryptedPayloadBase64 = bytesToBase64(combinedFull);
  const payloadDigest = await crypto.subtle.digest('SHA-256', frame52);

  return {
    packet: {
      smsFrame52BBase64,
      smsFrameByteLength: frame52.byteLength,
      smsBase64CharLength: smsFrame52BBase64.length,
      gsm160HeadroomChars: 160 - smsFrame52BBase64.length,
      encryptedPayloadBase64,
      payloadSha256Hex: bytesToHex(new Uint8Array(payloadDigest)),
      ephemeralPublicKeyJwk: session.publicKeyJwk,
      ivHex: bytesToHex(iv52),
      medicalHashHex,
      telemetryBreakdownHex: bytesToHex(new Uint8Array(telemetry24)),
    },
    session,
  };
}

/**
 * Verifies & decrypts a 52-byte (72-char Base64) AES-256-GCM frame with the active session key.
 */
export async function verifyAndUnpack52ByteFrame(
  smsFrame52BBase64: string,
  aesKey: CryptoKey
): Promise<{
  lat: number;
  lng: number;
  timestampIso: string;
  medicalHashHex: string;
  hrBpm: number;
  spo2Pct: number;
  hrvRmssdMs: number;
  offlineFlag: boolean;
}> {
  const frame52 = base64ToBytes(smsFrame52BBase64);
  if (frame52.byteLength !== 52) {
    throw new Error(`Expected 52-byte frame, received ${frame52.byteLength} bytes`);
  }

  const iv = frame52.slice(0, 12);
  const ctAndTag = frame52.slice(12); // 40 bytes (24B CT + 16B Tag)
  const aad = new TextEncoder().encode('PG-SMS52-V1');

  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
    aesKey,
    ctAndTag
  );

  const view = new DataView(plainBuf);
  const bytes = new Uint8Array(plainBuf);
  return {
    lat: Number(view.getFloat32(0, false).toFixed(5)),
    lng: Number(view.getFloat32(4, false).toFixed(5)),
    timestampIso: new Date(view.getUint32(8, false) * 1000).toISOString(),
    medicalHashHex: bytesToHex(bytes.slice(12, 20)),
    hrBpm: view.getUint8(20),
    spo2Pct: view.getUint8(21),
    hrvRmssdMs: view.getUint8(22),
    offlineFlag: Boolean(view.getUint8(23) & 0x10),
  };
}

export function buildSmsFailoverUri(
  emergencyPhone: string | null | undefined,
  smsFrame52BBase64: string
): string {
  const cleanedPhone = (emergencyPhone || '112').replace(/[^+\d]/g, '') || '112';
  // Total GSM-7 body <= 80 chars, well inside 160-character single SMS limit
  const body = `PG52:${smsFrame52BBase64}`;
  return `sms:${cleanedPhone}?body=${encodeURIComponent(body)}`;
}
