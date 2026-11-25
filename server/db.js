import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import { MICRO_ZONES } from '../shared/domainData.js';
import { generateEcdhKeyPair, wrapPrivateKeyForStorage } from './cryptoEngine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const DATA_DIR = isServerless ? '/tmp/pulseguard-data' : path.resolve(__dirname, '../data');

let sqliteModule = null;
try {
  sqliteModule = await import('node:sqlite');
} catch {
  sqliteModule = null;
}

class PulseGuardStore {
  constructor() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    this.useSqlite = Boolean(sqliteModule?.DatabaseSync);
    if (this.useSqlite) {
      this.dbPath = path.join(DATA_DIR, 'pulseguard.db');
      this.sqlite = new sqliteModule.DatabaseSync(this.dbPath);
      this.initSqliteSchema();
    } else {
      this.jsonPath = path.join(DATA_DIR, 'pulseguard.json');
      this.mem = this.loadJson();
    }
    this.seedIfEmpty();
  }

  initSqliteSchema() {
    this.sqlite.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        phone TEXT,
        blood_group TEXT,
        allergies TEXT,
        emergency_contact TEXT,
        safeword_label TEXT,
        safeword_template_hash TEXT,
        nmc_id TEXT,
        abdm_hpr_id TEXT,
        responder_tier TEXT,
        specialty TEXT,
        micro_zone TEXT NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        ecdh_pub_key TEXT NOT NULL,
        ecdh_priv_key_enc TEXT NOT NULL,
        available INTEGER DEFAULT 1,
        stipend_balance_inr INTEGER DEFAULT 0,
        cme_credits INTEGER DEFAULT 0,
        tax_rebate_inr INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS incidents (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        victim_name TEXT NOT NULL,
        micro_zone TEXT NOT NULL,
        geohash TEXT NOT NULL,
        trigger_type TEXT NOT NULL,
        transport_mode TEXT NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        status TEXT NOT NULL,
        vitals_json TEXT NOT NULL,
        encrypted_envelope_json TEXT NOT NULL,
        sms_packet_b64 TEXT NOT NULL,
        ble_route_json TEXT NOT NULL,
        assigned_responder_id TEXT,
        assigned_responder_name TEXT,
        responder_eta_sec INTEGER,
        ambulance_eta_sec INTEGER,
        green_corridor INTEGER DEFAULT 0,
        pulsebox_unlocked INTEGER DEFAULT 0,
        indemnity_cert_id TEXT,
        indemnity_amount_inr INTEGER DEFAULT 1000000,
        stipend_awarded_inr INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );

      CREATE TABLE IF NOT EXISTS pulseboxes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        micro_zone TEXT NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        aed_unlocked INTEGER DEFAULT 0,
        intercom_active INTEGER DEFAULT 0,
        supplies_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL,
        incident_id TEXT,
        actor_id TEXT,
        actor_role TEXT,
        action TEXT NOT NULL,
        detail TEXT NOT NULL,
        prev_hash TEXT NOT NULL,
        entry_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS zone_state (
        micro_zone TEXT PRIMARY KEY,
        green_corridor INTEGER DEFAULT 0,
        overnight_surge INTEGER DEFAULT 0
      );
    `);
  }

  loadJson() {
    if (fs.existsSync(this.jsonPath)) {
      return JSON.parse(fs.readFileSync(this.jsonPath, 'utf8'));
    }
    return { users: [], incidents: [], pulseboxes: [], audit_logs: [], zone_state: [] };
  }

  saveJson() {
    if (!this.useSqlite) {
      fs.writeFileSync(this.jsonPath, JSON.stringify(this.mem, null, 2));
    }
  }

  seedIfEmpty() {
    const count = this.useSqlite
      ? this.sqlite.prepare('SELECT COUNT(*) AS c FROM users').get().c
      : this.mem.users.length;
    if (count > 0) return;

    const demoPasswordHash = bcrypt.hashSync('PulseGuard@2026', 10);
    const now = new Date().toISOString();

    const makeUser = (u) => {
      const keys = generateEcdhKeyPair();
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        password_hash: demoPasswordHash,
        role: u.role,
        phone: u.phone || '+91-98110-00112',
        blood_group: u.blood_group || 'O+',
        allergies: u.allergies || 'None reported',
        emergency_contact: u.emergency_contact || 'Priya Sharma (+91-98110-42910)',
        safeword_label: u.safeword_label || 'RED LOTUS',
        safeword_template_hash: crypto.createHash('sha256').update(u.safeword_label || 'RED LOTUS').digest('hex').slice(0, 16),
        nmc_id: u.nmc_id || null,
        abdm_hpr_id: u.abdm_hpr_id || null,
        responder_tier: u.responder_tier || null,
        specialty: u.specialty || null,
        micro_zone: u.micro_zone,
        lat: u.lat,
        lng: u.lng,
        ecdh_pub_key: keys.pubKeyHex,
        ecdh_priv_key_enc: wrapPrivateKeyForStorage(keys.privKeyHex),
        available: u.available ?? 1,
        stipend_balance_inr: u.stipend_balance_inr ?? 0,
        cme_credits: u.cme_credits ?? 0,
        tax_rebate_inr: u.tax_rebate_inr ?? 0,
        created_at: now
      };
    };

    const seedUsers = [
      makeUser({
        id: 'usr-citizen-ananya',
        name: 'Ananya Sharma',
        email: 'ananya@pulseguard.in',
        role: 'citizen',
        phone: '+91-98114-77201',
        blood_group: 'O+',
        allergies: 'Penicillin',
        emergency_contact: 'Meera Sharma (+91-98114-77200)',
        safeword_label: 'RED LOTUS',
        micro_zone: 'aiims_delhi',
        lat: 28.5672,
        lng: 77.2100
      }),
      makeUser({
        id: 'usr-doc-sarah',
        name: 'Dr. Sarah Lin, MD',
        email: 'dr.sarah@pulseguard.in',
        role: 'responder',
        nmc_id: 'NMC-98421',
        abdm_hpr_id: 'ABDM-HPR-44019',
        responder_tier: 'TIER_A_CLINICAL',
        specialty: 'Cardiology · AIIMS Trauma',
        micro_zone: 'aiims_delhi',
        lat: 28.5692,
        lng: 77.2116,
        stipend_balance_inr: 3400,
        cme_credits: 14,
        tax_rebate_inr: 8450
      }),
      makeUser({
        id: 'usr-doc-amit',
        name: 'Dr. Amit Verma',
        email: 'dr.amit@pulseguard.in',
        role: 'responder',
        nmc_id: 'NMC-74219',
        abdm_hpr_id: 'ABDM-HPR-38210',
        responder_tier: 'TIER_A_CLINICAL',
        specialty: 'Emergency Medicine · AIIMS',
        micro_zone: 'aiims_delhi',
        lat: 28.5635,
        lng: 77.2062,
        stipend_balance_inr: 2200,
        cme_credits: 9,
        tax_rebate_inr: 5200
      }),
      makeUser({
        id: 'usr-bls-rohit',
        name: 'Rohit Mehra',
        email: 'bls.rohit@pulseguard.in',
        role: 'responder',
        nmc_id: 'BLS-AHA-1102',
        abdm_hpr_id: 'VOL-BLS-1102',
        responder_tier: 'TIER_B_BLS',
        specialty: 'Final-Year MBBS · BLS/AED Certified',
        micro_zone: 'aiims_delhi',
        lat: 28.5661,
        lng: 77.2089,
        stipend_balance_inr: 1500,
        cme_credits: 6,
        tax_rebate_inr: 0
      }),
      makeUser({
        id: 'usr-doc-meera',
        name: 'Dr. Meera Kapoor, MD',
        email: 'dr.meera@pulseguard.in',
        role: 'responder',
        nmc_id: 'NMC-61204',
        abdm_hpr_id: 'ABDM-HPR-61204',
        responder_tier: 'TIER_A_CLINICAL',
        specialty: 'Critical Care · PGIMER',
        micro_zone: 'pgimer_chandigarh',
        lat: 30.7668,
        lng: 76.7768,
        stipend_balance_inr: 1800,
        cme_credits: 8,
        tax_rebate_inr: 4100
      }),
      makeUser({
        id: 'usr-doc-priya',
        name: 'Dr. Priya Kulkarni',
        email: 'dr.priya@pulseguard.in',
        role: 'responder',
        nmc_id: 'NMC-55190',
        abdm_hpr_id: 'ABDM-HPR-55190',
        responder_tier: 'TIER_A_CLINICAL',
        specialty: 'Trauma Care · Hinjewadi Cluster',
        micro_zone: 'hinjewadi_pune',
        lat: 18.5934,
        lng: 73.7410,
        stipend_balance_inr: 2600,
        cme_credits: 11,
        tax_rebate_inr: 6100
      }),
      makeUser({
        id: 'usr-doc-kavya',
        name: 'Dr. Kavya Nair, MD',
        email: 'dr.kavya@pulseguard.in',
        role: 'responder',
        nmc_id: 'NMC-91042',
        abdm_hpr_id: 'ABDM-HPR-91042',
        responder_tier: 'TIER_A_CLINICAL',
        specialty: 'Emergency Medicine · Manipal Whitefield',
        micro_zone: 'whitefield_blr',
        lat: 12.9718,
        lng: 77.7521,
        stipend_balance_inr: 2900,
        cme_credits: 12,
        tax_rebate_inr: 7300
      }),
      makeUser({
        id: 'usr-disp-112',
        name: 'Smart City 112 Command Desk',
        email: 'dispatch112@pulseguard.in',
        role: 'dispatcher',
        specialty: 'State 112 CAD & Green Corridor Control',
        micro_zone: 'aiims_delhi',
        lat: 28.5715,
        lng: 77.2135
      })
    ];

    const seedPulseBoxes = Object.values(MICRO_ZONES).map((z, idx) => ({
      id: `PB-${101 + idx}`,
      name: `PulseBox #PB-${101 + idx} · ${z.landmarks.incidentDefault}`,
      micro_zone: z.id,
      lat: Number((z.lat + 0.0012).toFixed(5)),
      lng: Number((z.lng - 0.0009).toFixed(5)),
      aed_unlocked: 0,
      intercom_active: 0,
      supplies_json: JSON.stringify([
        { id: 'gauze', name: 'Hemostatic Combat Gauze', qty: 4, max: 4, weightGrams: 180 },
        { id: 'tq', name: 'CAT Gen-7 Tourniquet', qty: 2, max: 2, weightGrams: 152 },
        { id: 'epi', name: 'Epinephrine Auto-Injector', qty: 2, max: 2, weightGrams: 95 },
        { id: 'aed', name: 'Leased Clinical AED Bay (Hospital Partner)', qty: 1, max: 1, weightGrams: 1400 }
      ]),
      updated_at: now
    }));

    const seedZoneStates = Object.keys(MICRO_ZONES).map((id) => ({
      micro_zone: id,
      green_corridor: 0,
      overnight_surge: 0
    }));

    if (this.useSqlite) {
      const insUser = this.sqlite.prepare(`
        INSERT INTO users (id, name, email, password_hash, role, phone, blood_group, allergies, emergency_contact, safeword_label, safeword_template_hash, nmc_id, abdm_hpr_id, responder_tier, specialty, micro_zone, lat, lng, ecdh_pub_key, ecdh_priv_key_enc, available, stipend_balance_inr, cme_credits, tax_rebate_inr, created_at)
        VALUES (@id, @name, @email, @password_hash, @role, @phone, @blood_group, @allergies, @emergency_contact, @safeword_label, @safeword_template_hash, @nmc_id, @abdm_hpr_id, @responder_tier, @specialty, @micro_zone, @lat, @lng, @ecdh_pub_key, @ecdh_priv_key_enc, @available, @stipend_balance_inr, @cme_credits, @tax_rebate_inr, @created_at)
      `);
      for (const u of seedUsers) insUser.run(u);

      const insBox = this.sqlite.prepare(`
        INSERT INTO pulseboxes (id, name, micro_zone, lat, lng, aed_unlocked, intercom_active, supplies_json, updated_at)
        VALUES (@id, @name, @micro_zone, @lat, @lng, @aed_unlocked, @intercom_active, @supplies_json, @updated_at)
      `);
      for (const b of seedPulseBoxes) insBox.run(b);

      const insZone = this.sqlite.prepare(`
        INSERT INTO zone_state (micro_zone, green_corridor, overnight_surge)
        VALUES (@micro_zone, @green_corridor, @overnight_surge)
      `);
      for (const z of seedZoneStates) insZone.run(z);
    } else {
      this.mem.users = seedUsers;
      this.mem.pulseboxes = seedPulseBoxes;
      this.mem.zone_state = seedZoneStates;
      this.saveJson();
    }

    this.appendAuditLog({
      incidentId: null,
      actorId: 'SYSTEM',
      actorRole: 'system',
      action: 'GENESIS_CLUSTER_INIT',
      detail: 'Initialized PulseGuard AI v4.0 SQLite mesh with ECDH-P256 identities & DPDP audit chain.'
    });
  }

  getUserByEmail(email) {
    const clean = email.trim().toLowerCase();
    return this.useSqlite
      ? this.sqlite.prepare('SELECT * FROM users WHERE lower(email) = ?').get(clean)
      : this.mem.users.find((u) => u.email.toLowerCase() === clean) || null;
  }

  getUserById(id) {
    return this.useSqlite
      ? this.sqlite.prepare('SELECT * FROM users WHERE id = ?').get(id)
      : this.mem.users.find((u) => u.id === id) || null;
  }

  listDemoUsers() {
    const rows = this.useSqlite
      ? this.sqlite.prepare('SELECT id, name, email, role, specialty, nmc_id, responder_tier, micro_zone, available, stipend_balance_inr, cme_credits FROM users').all()
      : this.mem.users;
    return rows.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      specialty: u.specialty,
      nmcId: u.nmc_id,
      responderTier: u.responder_tier,
      microZone: u.micro_zone,
      available: Boolean(u.available)
    }));
  }

  createUser(userObj) {
    if (this.useSqlite) {
      this.sqlite.prepare(`
        INSERT INTO users (id, name, email, password_hash, role, phone, blood_group, allergies, emergency_contact, safeword_label, safeword_template_hash, nmc_id, abdm_hpr_id, responder_tier, specialty, micro_zone, lat, lng, ecdh_pub_key, ecdh_priv_key_enc, available, stipend_balance_inr, cme_credits, tax_rebate_inr, created_at)
        VALUES (@id, @name, @email, @password_hash, @role, @phone, @blood_group, @allergies, @emergency_contact, @safeword_label, @safeword_template_hash, @nmc_id, @abdm_hpr_id, @responder_tier, @specialty, @micro_zone, @lat, @lng, @ecdh_pub_key, @ecdh_priv_key_enc, @available, @stipend_balance_inr, @cme_credits, @tax_rebate_inr, @created_at)
      `).run(userObj);
    } else {
      this.mem.users.push(userObj);
      this.saveJson();
    }
    return this.getUserById(userObj.id);
  }

  updateUserProfile(id, patch) {
    const allowed = ['name', 'phone', 'blood_group', 'allergies', 'emergency_contact', 'safeword_label', 'safeword_template_hash', 'micro_zone', 'lat', 'lng', 'available', 'stipend_balance_inr', 'cme_credits', 'tax_rebate_inr'];
    const entries = Object.entries(patch).filter(([k, v]) => allowed.includes(k) && v !== undefined);
    if (entries.length === 0) return this.getUserById(id);

    if (this.useSqlite) {
      const sets = entries.map(([k]) => `${k} = @${k}`).join(', ');
      const params = Object.fromEntries(entries);
      params.id = id;
      this.sqlite.prepare(`UPDATE users SET ${sets} WHERE id = @id`).run(params);
    } else {
      const u = this.mem.users.find((x) => x.id === id);
      if (u) {
        for (const [k, v] of entries) u[k] = v;
        this.saveJson();
      }
    }
    return this.getUserById(id);
  }

  getResponders(microZone = null) {
    const rows = this.useSqlite
      ? (microZone
        ? this.sqlite.prepare("SELECT * FROM users WHERE role = 'responder' AND micro_zone = ?").all(microZone)
        : this.sqlite.prepare("SELECT * FROM users WHERE role = 'responder'").all())
      : this.mem.users.filter((u) => u.role === 'responder' && (!microZone || u.micro_zone === microZone));
    return rows;
  }

  getDispatchers() {
    return this.useSqlite
      ? this.sqlite.prepare("SELECT * FROM users WHERE role = 'dispatcher'").all()
      : this.mem.users.filter((u) => u.role === 'dispatcher');
  }

  createIncident(inc) {
    if (this.useSqlite) {
      this.sqlite.prepare(`
        INSERT INTO incidents (id, user_id, victim_name, micro_zone, geohash, trigger_type, transport_mode, lat, lng, status, vitals_json, encrypted_envelope_json, sms_packet_b64, ble_route_json, assigned_responder_id, assigned_responder_name, responder_eta_sec, ambulance_eta_sec, green_corridor, pulsebox_unlocked, indemnity_cert_id, indemnity_amount_inr, stipend_awarded_inr, created_at, resolved_at)
        VALUES (@id, @user_id, @victim_name, @micro_zone, @geohash, @trigger_type, @transport_mode, @lat, @lng, @status, @vitals_json, @encrypted_envelope_json, @sms_packet_b64, @ble_route_json, @assigned_responder_id, @assigned_responder_name, @responder_eta_sec, @ambulance_eta_sec, @green_corridor, @pulsebox_unlocked, @indemnity_cert_id, @indemnity_amount_inr, @stipend_awarded_inr, @created_at, @resolved_at)
      `).run(inc);
    } else {
      this.mem.incidents.unshift(inc);
      this.saveJson();
    }
    return this.getIncidentById(inc.id);
  }

  getIncidentById(id) {
    return this.useSqlite
      ? this.sqlite.prepare('SELECT * FROM incidents WHERE id = ?').get(id)
      : this.mem.incidents.find((i) => i.id === id) || null;
  }

  listIncidents(limit = 30) {
    return this.useSqlite
      ? this.sqlite.prepare('SELECT * FROM incidents ORDER BY created_at DESC LIMIT ?').all(limit)
      : this.mem.incidents.slice(0, limit);
  }

  updateIncident(id, patch) {
    const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return this.getIncidentById(id);
    if (this.useSqlite) {
      const sets = entries.map(([k]) => `${k} = @${k}`).join(', ');
      const params = Object.fromEntries(entries);
      params.id = id;
      this.sqlite.prepare(`UPDATE incidents SET ${sets} WHERE id = @id`).run(params);
    } else {
      const inc = this.mem.incidents.find((x) => x.id === id);
      if (inc) {
        for (const [k, v] of entries) inc[k] = v;
        this.saveJson();
      }
    }
    return this.getIncidentById(id);
  }

  getPulseBoxes(microZone = null) {
    return this.useSqlite
      ? (microZone
        ? this.sqlite.prepare('SELECT * FROM pulseboxes WHERE micro_zone = ?').all(microZone)
        : this.sqlite.prepare('SELECT * FROM pulseboxes').all())
      : this.mem.pulseboxes.filter((b) => !microZone || b.micro_zone === microZone);
  }

  getPulseBoxById(id) {
    return this.useSqlite
      ? this.sqlite.prepare('SELECT * FROM pulseboxes WHERE id = ?').get(id)
      : this.mem.pulseboxes.find((b) => b.id === id) || null;
  }

  updatePulseBox(id, patch) {
    const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return this.getPulseBoxById(id);
    if (this.useSqlite) {
      const sets = entries.map(([k]) => `${k} = @${k}`).join(', ');
      const params = Object.fromEntries(entries);
      params.id = id;
      this.sqlite.prepare(`UPDATE pulseboxes SET ${sets} WHERE id = @id`).run(params);
    } else {
      const b = this.mem.pulseboxes.find((x) => x.id === id);
      if (b) {
        for (const [k, v] of entries) b[k] = v;
        this.saveJson();
      }
    }
    return this.getPulseBoxById(id);
  }

  getZoneState(microZone) {
    const row = this.useSqlite
      ? this.sqlite.prepare('SELECT * FROM zone_state WHERE micro_zone = ?').get(microZone)
      : this.mem.zone_state.find((z) => z.micro_zone === microZone);
    return row || { micro_zone: microZone, green_corridor: 0, overnight_surge: 0 };
  }

  updateZoneState(microZone, patch) {
    const current = this.getZoneState(microZone);
    const next = { ...current, ...patch, micro_zone: microZone };
    if (this.useSqlite) {
      this.sqlite.prepare(`
        INSERT INTO zone_state (micro_zone, green_corridor, overnight_surge)
        VALUES (@micro_zone, @green_corridor, @overnight_surge)
        ON CONFLICT(micro_zone) DO UPDATE SET
          green_corridor = @green_corridor,
          overnight_surge = @overnight_surge
      `).run(next);
    } else {
      const idx = this.mem.zone_state.findIndex((z) => z.micro_zone === microZone);
      if (idx >= 0) this.mem.zone_state[idx] = next;
      else this.mem.zone_state.push(next);
      this.saveJson();
    }
    return next;
  }

  appendAuditLog({ incidentId = null, actorId = 'SYSTEM', actorRole = 'system', action, detail }) {
    const createdAt = new Date().toISOString();
    const id = `AUD-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const last = this.useSqlite
      ? this.sqlite.prepare('SELECT entry_hash FROM audit_logs ORDER BY seq DESC LIMIT 1').get()
      : this.mem.audit_logs[this.mem.audit_logs.length - 1];
    const prevHash = last?.entry_hash || '0'.repeat(64);
    const entryHash = crypto
      .createHash('sha256')
      .update(`${prevHash}|${id}|${incidentId || ''}|${actorId}|${action}|${detail}|${createdAt}`)
      .digest('hex');

    const row = {
      id,
      incident_id: incidentId,
      actor_id: actorId,
      actor_role: actorRole,
      action,
      detail,
      prev_hash: prevHash,
      entry_hash: entryHash,
      created_at: createdAt
    };

    if (this.useSqlite) {
      this.sqlite.prepare(`
        INSERT INTO audit_logs (id, incident_id, actor_id, actor_role, action, detail, prev_hash, entry_hash, created_at)
        VALUES (@id, @incident_id, @actor_id, @actor_role, @action, @detail, @prev_hash, @entry_hash, @created_at)
      `).run(row);
    } else {
      row.seq = this.mem.audit_logs.length + 1;
      this.mem.audit_logs.push(row);
      this.saveJson();
    }
    return row;
  }

  getAuditLogs(limit = 50) {
    const all = this.useSqlite
      ? this.sqlite.prepare('SELECT * FROM audit_logs ORDER BY seq ASC').all()
      : this.mem.audit_logs;

    let chainValid = true;
    for (let i = 0; i < all.length; i++) {
      const expectedPrev = i === 0 ? '0'.repeat(64) : all[i - 1].entry_hash;
      const recomputed = crypto
        .createHash('sha256')
        .update(`${expectedPrev}|${all[i].id}|${all[i].incident_id || ''}|${all[i].actor_id}|${all[i].action}|${all[i].detail}|${all[i].created_at}`)
        .digest('hex');
      if (all[i].prev_hash !== expectedPrev || all[i].entry_hash !== recomputed) {
        chainValid = false;
        break;
      }
    }

    return {
      chainValid,
      totalEntries: all.length,
      entries: all.slice(-limit).reverse()
    };
  }
}

export const db = new PulseGuardStore();
