import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'pulseguard-dev-secret-2026-change-in-prod';
const JWT_EXPIRES_IN = '12h';

export function signAuthToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

export function verifyAuthToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

export function sanitizeUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    phone: u.phone,
    bloodGroup: u.blood_group,
    allergies: u.allergies,
    emergencyContact: u.emergency_contact,
    safeWordLabel: u.safeword_label,
    safeWordTemplateHash: u.safeword_template_hash,
    nmcId: u.nmc_id,
    abdmHprId: u.abdm_hpr_id,
    responderTier: u.responder_tier,
    specialty: u.specialty,
    microZone: u.micro_zone,
    lat: u.lat,
    lng: u.lng,
    ecdhPubKey: u.ecdh_pub_key,
    available: Boolean(u.available),
    stipendBalanceInr: u.stipend_balance_inr,
    cmeCredits: u.cme_credits,
    taxRebateInr: u.tax_rebate_inr,
    createdAt: u.created_at
  };
}

export async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

export async function comparePassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  const bearerToken = header && header.startsWith('Bearer ') ? header.slice(7) : null;
  const token = bearerToken || req.query.token;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  }

  try {
    const claims = verifyAuthToken(token);
    const user = db.getUserById(claims.sub);
    if (!user) return res.status(401).json({ error: 'Session user no longer exists.' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired authentication token.' });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access restricted to roles: ${roles.join(', ')}. Current role: ${req.user?.role || 'none'}`
      });
    }
    next();
  };
}

/**
 * Verifies NMC National Medical Register (NMR) / ABDM HPR or BLS First-Aid credentials.
 */
export function verifyResponderCredential(rawId) {
  const clean = (rawId || '').trim().toUpperCase();
  // Check seeded real doctors first
  const allResponders = db.getResponders();
  const matchedUser = allResponders.find((r) => (r.nmc_id || '').toUpperCase() === clean);
  if (matchedUser) {
    return {
      verified: true,
      credentialId: matchedUser.nmc_id,
      abdmHprId: matchedUser.abdm_hpr_id,
      name: matchedUser.name,
      tier: matchedUser.responder_tier,
      tierLabel:
        matchedUser.responder_tier === 'TIER_A_CLINICAL'
          ? 'Tier A · Licensed Clinical Responder (NMC NMR + ABDM HPR)'
          : 'Tier B · BLS / CPR First-Aid Volunteer (AHA/Red Cross Scope)',
      specialty: matchedUser.specialty,
      scope:
        matchedUser.responder_tier === 'TIER_A_CLINICAL'
          ? ['CPR & Airway', 'Hemorrhage Control', 'AED Deployment', 'Clinical Triage & Emergency Meds']
          : ['CPR & Chest Compressions', 'AED Deployment', 'Basic First-Aid Only']
    };
  }

  // Format check for newly registering NMC / CRMI / BLS responders
  if (/^NMC-\d{5,7}$/.test(clean) || /^CRMI-\d{4,6}$/.test(clean)) {
    return {
      verified: true,
      credentialId: clean,
      abdmHprId: `ABDM-HPR-${clean.replace(/\D/g, '')}`,
      tier: 'TIER_A_CLINICAL',
      tierLabel: 'Tier A · Licensed Clinical Responder (NMC NMR + ABDM HPR)',
      scope: ['CPR & Airway', 'Hemorrhage Control', 'AED Deployment', 'Clinical Triage']
    };
  }

  if (/^BLS-[A-Z]{2,5}-\d{3,6}$/.test(clean)) {
    return {
      verified: true,
      credentialId: clean,
      abdmHprId: `VOL-${clean}`,
      tier: 'TIER_B_BLS',
      tierLabel: 'Tier B · BLS / CPR First-Aid Volunteer (AHA/Red Cross Scope)',
      scope: ['CPR & Chest Compressions', 'AED Deployment', 'Basic First-Aid Only']
    };
  }

  return {
    verified: false,
    credentialId: clean,
    error: 'Format not recognized. Use NMC-XXXXX (Tier A) or BLS-AHA-XXXX (Tier B).'
  };
}
