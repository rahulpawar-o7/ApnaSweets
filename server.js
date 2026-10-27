// ApnaSweets backend - Node.js + MongoDB Atlas (single file, no framework)
try { require('dotenv').config(); } catch { /* dotenv is optional on Render */ }

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');

// Only needed if Atlas SRV lookup fails on your own network. Set DNS_FIX=1 locally.
if (process.env.DNS_FIX === '1') require('dns').setServers(['8.8.8.8', '8.8.4.4']);

const PORT = process.env.PORT || 3000;
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const UP = path.join(DATA, 'uploads');
const DB_FILE = path.join(DATA, 'db.json');          // only used for one-time import
const PUB = path.join(__dirname, 'public');

const STATUS = ['Pending', 'Ongoing', 'Delivered'];
const G = { 'per kg': 1000, 'per 500 g': 500 };       // grams per unit for weight products
const TEMP_PW = 'sweets123';

const n3 = x => Math.round(x * 1000) / 1000;
const okQ = (p, q) =>
  Number.isFinite(q) && (G[p.unit] ? q * G[p.unit] >= 10 : q >= 0.5 && Number.isInteger(q * 2));
// If your frontend rounds line totals differently, change only this one function.
const lineTotal = (p, q) => Math.round(p.price * q);

fs.mkdirSync(UP, { recursive: true });

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'apnasweets';
if (!MONGODB_URI) {
  console.error('MONGODB_URI is missing. Add it in Render > Environment.');
  process.exit(1);
}

const mongoClient = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 20000, connectTimeoutMS: 20000 });
let stateCollection;
let db;
let saveQueue = Promise.resolve();

// ---------- helpers ----------
const hash = (pw, salt = crypto.randomBytes(16).toString('hex')) =>
  salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
const same = (a, b) =>
  typeof a === 'string' && typeof b === 'string' && a.length === b.length &&
  crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const checkPw = (pw, h) => typeof h === 'string' && h.includes(':') && same(hash(pw, h.split(':')[0]), h);
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

// Saves are queued so two requests never write at the same time.
function save() {
  db.v = (Number(db.v) || 0) + 1;
  const snapshot = JSON.parse(JSON.stringify(db));
  saveQueue = saveQueue
    .catch(() => {})
    .then(() => stateCollection.replaceOne({ _id: 'main' }, { _id: 'main', data: snapshot }, { upsert: true }));
  return saveQueue;
}

const send = (res, code, obj) => {
  if (res.headersSent) return;
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};

const readBody = req => new Promise((resolve, reject) => {
  let body = '', size = 0;
  req.on('data', c => {
    size += c.length;
    if (size > 8e6) { reject('Request too large'); req.destroy(); } else body += c;
  });
  req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject('Bad JSON'); } });
  req.on('error', reject);
});

// Sessions live in MongoDB (as token hashes), so owner stays logged in after a restart.
function newSession(email) {
  const token = crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  db.sessions = db.sessions || {};
  for (const k of Object.keys(db.sessions)) if (db.sessions[k].exp < now) delete db.sessions[k];
  db.sessions[sha(token)] = { email, exp: now + 12 * 36e5 };
  return token;
}
const owner = req => {
  const a = req.headers.authorization || '';
  const s = (db.sessions || {})[sha(a.startsWith('Bearer ') ? a.slice(7) : '')];
  return s && s.exp > Date.now() ? s : null;
};
const pub = () => ({ products: db.products, set: db.set });
const tries = new Map();

// ---------- database ----------
async function initDb() {
  await mongoClient.connect();
  stateCollection = mongoClient.db(MONGODB_DB).collection('app_state');
  const saved = await stateCollection.findOne({ _id: 'main' });

  if (saved && saved.data) {
    db = saved.data;
    console.log('Application data loaded from MongoDB.');
  } else if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));          // throws (and stops) if file is corrupt
    console.log('Existing db.json imported into MongoDB.');
  } else {
    const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed.json'), 'utf8'));
    db = {
      ...seed, orders: [], moves: [], seq: 1, v: 1, created: Date.now(), sessions: {},
      admin: {
        email: (process.env.ADMIN_EMAIL || 'owner@apnasweets.in').toLowerCase(),
        hash: hash(process.env.ADMIN_PASSWORD || TEMP_PW),
        done: !!process.env.ADMIN_PASSWORD
      }
    };
    console.log('New data created from seed.json.');
  }

  db.orders = db.orders || [];
  db.moves = db.moves || [];
  db.sessions = db.sessions || {};
  db.seq = Number(db.seq) || 1;
  db.v = Number(db.v) || 1;
  if (db.admin.done === undefined) db.admin.done = !checkPw(TEMP_PW, db.admin.hash);

  if (process.env.RESET_ADMIN === '1' && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    db.admin = { email: process.env.ADMIN_EMAIL.toLowerCase(), hash: hash(process.env.ADMIN_PASSWORD), done: true, otp: false };
    db.sessions = {};
    console.log('Owner login reset. Now remove RESET_ADMIN from the environment variables.');
  }

  await save();
  console.log('MongoDB connected. Database: ' + MONGODB_DB);
}

// ---------- API ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const MAGIC = { jpg: b => b[0] === 0xff && b[1] === 0xd8, png: b => b[0] === 0x89 && b[1] === 0x50, webp: b => b.slice(0, 4).toString() === 'RIFF' };

async function api(req, res, url) {
  const route = req.method + ' ' + url;

  if (route === 'GET /api/public') return send(res, 200, pub());

  if (route === 'POST /api/login') {
    const ip = req.socket.remoteAddress || 'unknown';
    const t = tries.get(ip) || { n: 0, at: Date.now() };
    if (Date.now() - t.at > 6e5) { t.n = 0; t.at = Date.now(); }
    if (t.n >= 8) return send(res, 429, { error: 'Too many attempts. Try again in 10 minutes.' });
    const { email, password } = await readBody(req);
    if (String(email || '').trim().toLowerCase() !== db.admin.email || !checkPw(String(password || ''), db.admin.hash)) {
      tries.set(ip, { ...t, n: t.n + 1 });
      return send(res, 401, { error: 'Incorrect email or password.' });
    }
    tries.delete(ip);
    const token = newSession(db.admin.email);
    await save();
    return send(res, 200, { token, email: db.admin.email, done: db.admin.done });
  }

  if (route === 'POST /api/orders') {            // customers: server re-checks stock, quantity and prices
    const { cu = {}, items = [], shown } = await readBody(req);
    const c = { name: String(cu.name || '').trim(), phone: String(cu.phone || ''), addr: String(cu.addr || '').trim(), city: String(cu.city || '').trim(), pin: String(cu.pin || ''), note: String(cu.note || '').slice(0, 300) };
    if (c.name.length < 2 || !/^[6-9]\d{9}$/.test(c.phone) || c.addr.length < 8 || c.city.length < 2 || !/^\d{6}$/.test(c.pin))
      return send(res, 200, { err: 'Please check your name, phone, address, city and PIN.' });

    const L = []; let sub = 0;
    for (const it of items) {
      const p = db.products.find(x => x.id === it.pid), q = n3(+it.q);
      if (!p || !(q > 0)) continue;
      if (!okQ(p, q)) return send(res, 200, { err: `${p.name}: invalid quantity. Please update your order.` });
      if (!p.avail || q > p.stock) return send(res, 200, { err: `${p.name}: only ${p.avail ? p.stock : 0} available. Please update your order.` });
      const t = lineTotal(p, q);
      L.push({ p, q, t }); sub += t;
    }
    if (!L.length) return send(res, 200, { err: 'Your order is empty.' });

    const fee = sub >= db.set.freeAbove ? 0 : db.set.fee, total = sub + fee;
    if (total !== shown) return send(res, 200, { rev: total });

    const at = Date.now(), d = new Date(at).toISOString().slice(2, 10).replace(/-/g, '');
    const id = `AS-${d}-${String(db.seq++).padStart(4, '0')}`;
    const o = { id, at, cu: c, items: L.map(({ p, q, t }) => ({ pid: p.id, name: p.name, unit: p.unit, q, up: p.price, t })), sub, fee, total, status: 'Pending', hist: [{ f: null, t: 'Pending', at, by: 'customer' }] };
    L.forEach(({ p, q }) => { p.stock = n3(p.stock - q); db.moves.unshift({ pid: p.id, n: p.name, chg: -q, why: 'Order ' + id, at }); });
    db.orders.unshift(o);
    await save();
    return send(res, 200, { o, products: db.products });
  }

  if (!owner(req)) return send(res, 401, { error: 'Please sign in again.' });   // everything below is owner-only

  if (route === 'GET /api/admin/state')
    return send(res, 200, { ...pub(), orders: db.orders, moves: db.moves, seq: db.seq, v: db.v, done: db.admin.done });

  if (route === 'POST /api/admin/state') {
    const b = await readBody(req);
    if (b.v !== db.v) return send(res, 409, { error: 'Data changed on the server (e.g. a new order). Reloaded - please repeat your last change.' });
    if (!Array.isArray(b.products) || b.products.length > 500) return send(res, 400, { error: 'Invalid products.' });
    db.products = b.products.map(p => ({
      ...p,
      name: String(p.name || '').slice(0, 80),
      price: Math.max(0, Math.round(+p.price || 0)),
      stock: Math.max(0, n3(+p.stock || 0)),
      img: /^(\/uploads\/[\w.-]+|https?:\/\/.+)$/.test(p.img || '') ? p.img : ''
    }));
    if (b.set && typeof b.set === 'object') db.set = { ...db.set, ...b.set };
    if (Array.isArray(b.moves)) db.moves = b.moves.slice(0, 500);
    for (const u of b.orders || []) {
      const o = db.orders.find(x => x.id === u.id);
      if (o && STATUS.includes(u.status)) { o.status = u.status; if (Array.isArray(u.hist)) o.hist = u.hist; }
    }
    if (typeof b.password === 'string' && b.password.length >= 6) { db.admin.hash = hash(b.password); db.admin.done = true; }
    await save();
    return send(res, 200, { v: db.v });
  }

  if (route === 'POST /api/upload') {            // body: { data: "data:image/jpeg;base64,..." }
    const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec((await readBody(req)).data || '');
    if (!m) return send(res, 400, { error: 'Send a JPG, PNG or WebP image.' });
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1], buf = Buffer.from(m[2], 'base64');
    if (buf.length > 4e6 || !MAGIC[ext](buf)) return send(res, 400, { error: 'Image is invalid or over 4 MB.' });
    const name = crypto.randomBytes(8).toString('hex') + '.' + ext;
    fs.writeFileSync(path.join(UP, name), buf);
    return send(res, 200, { url: '/uploads/' + name });
  }

  return send(res, 404, { error: 'Not found' });
}

// ---------- server ----------
async function startServer() {
  await initDb();                                  // do not accept requests before the database is ready

  const server = http.createServer(async (req, res) => {
    try {
      const url = decodeURIComponent(req.url.split('?')[0]);
      if (url === '/health') return send(res, 200, { ok: true });
      if (url.startsWith('/api/')) return await api(req, res, url);

      const isUp = url.startsWith('/uploads/');
      const base = isUp ? UP : PUB;
      const rel = isUp ? url.slice(9) : (url === '/' ? 'index.html' : url);
      const file = path.normalize(path.join(base, rel));
      if (file !== base && !file.startsWith(base + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': isUp ? 'public, max-age=31536000, immutable' : 'no-cache'
      });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      console.error('Request failed:', e);
      send(res, e === 'Bad JSON' ? 400 : e === 'Request too large' ? 413 : 500, { error: typeof e === 'string' ? e : 'Server error' });
    }
  });

  server.listen(PORT, '0.0.0.0', () => console.log(`ApnaSweets running on port ${PORT}`));

  const shutdown = () => {
    console.log('Shutting down ApnaSweets...');
    server.close(async () => {
      try { await saveQueue; await mongoClient.close(); } catch (e) { console.error('Shutdown error:', e.message); }
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer().catch(e => { console.error('ApnaSweets startup failed:', e); process.exit(1); });
