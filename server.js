import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { nanoid } from 'nanoid';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

// __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// ---- Serve static UI (frontend folder) ----
const frontendPath = path.join(__dirname, 'frontend');
app.use(express.static(frontendPath));
app.get('*', (req, res, next) => {
  // let /api/* be handled below, otherwise send index.html (SPA)
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// ---- LowDB (JSON file persistence) ----
const adapter = new JSONFile('db.json');
const db = new Low(adapter);
await db.read();
await db.defaults({ users: [], incidents: [] }).write();

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key';
const JWT_EXPIRES = '2h';

// ---- JWT middleware ----
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

// ---- Auth routes ----
app.post(
  '/api/register',
  body('email').isEmail(),
  body('password').isLength({ min: 6 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { email, password } = req.body;
    const exists = db.data.users.find(u => u.email === email);
    if (exists) return res.status(409).json({ message: 'User already exists' });
    const hashed = await bcrypt.hash(password, 10);
    const user = { id: nanoid(), email, password: hashed };
    db.data.users.push(user);
    await db.write();
    const token = jwt.sign({ id: user.id, email }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    res.json({ token, email });
  }
);

app.post(
  '/api/login',
  body('email').isEmail(),
  body('password').exists(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { email, password } = req.body;
    const user = db.data.users.find(u => u.email === email);
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ message: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, email }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    res.json({ token, email });
  }
);

// ---- Incident routes (protected) ----
app.get('/api/incidents', authenticateToken, async (req, res) => {
  const inc = db.data.incidents.filter(i => i.userId === req.user.id);
  res.json(inc);
});

app.post(
  '/api/incidents',
  authenticateToken,
  body('type').isString(),
  body('description').isString(),
  body('lat').isFloat({ min: -90, max: 90 }),
  body('lng').isFloat({ min: -180, max: 180 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { type, description, lat, lng } = req.body;
    const incident = {
      id: nanoid(),
      userId: req.user.id,
      type,
      description,
      location: { lat, lng },
      createdAt: new Date().toISOString(),
      status: 'pending'
    };
    db.data.incidents.push(incident);
    await db.write();
    res.status(201).json(incident);
  }
);

app.patch('/api/incidents/:id/status', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const inc = db.data.incidents.find(i => i.id === id && i.userId === req.user.id);
  if (!inc) return res.status(404).json({ message: 'Incident not found' });
  inc.status = status;
  await db.write();
  res.json(inc);
});

// ---- Start server ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 PulseGuard full‑stack listening on http://localhost:${PORT}`));
