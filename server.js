// // ApnaSweets backend - plain Node.js (v18+), no npm install needed.
// const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
// const PORT = process.env.PORT || 3000;
// const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');   // db.json + uploads/ live here
// const UP = path.join(DATA, 'uploads'), DB = path.join(DATA, 'db.json'), PUB = path.join(__dirname, 'public');
// const STATUS = ['Pending', 'Ongoing', 'Delivered'];
// fs.mkdirSync(UP, { recursive: true });

// const hash = (pw, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
// const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
// const checkPw = (pw, h) => same(hash(pw, h.split(':')[0]), h);

// let db;
// try { db = JSON.parse(fs.readFileSync(DB, 'utf8')); }
// catch {
//   const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed.json'), 'utf8'));
//   db = { ...seed, orders: [], moves: [], seq: 1, v: 1,
//     admin: { email: process.env.ADMIN_EMAIL || 'owner@apnasweets.in', hash: hash(process.env.ADMIN_PASSWORD || 'sweets123') } };
//   save();
// }
// function save() { db.v++; fs.writeFileSync(DB + '.tmp', JSON.stringify(db)); fs.renameSync(DB + '.tmp', DB); }

// const sessions = new Map(), tries = new Map();
// const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
// const readBody = req => new Promise((ok, no) => {
//   let b = '', n = 0;
//   req.on('data', c => { n += c.length; if (n > 8e6) { no('Request too large'); req.destroy(); } else b += c; });
//   req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch { no('Bad JSON'); } });
// });
// const owner = req => { const s = sessions.get((req.headers.authorization || '').slice(7)); return s && s.exp > Date.now() ? s : null; };
// const pub = () => ({ products: db.products, set: db.set });

// const MIME = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.js': 'text/javascript', '.css': 'text/css' };
// const MAGIC = { jpg: b => b[0] === 0xff && b[1] === 0xd8, png: b => b[0] === 0x89 && b[1] === 0x50, webp: b => b.slice(0, 4).toString() === 'RIFF' };

// async function api(req, res, url) {
//   const route = req.method + ' ' + url;
//   if (route === 'GET /api/public') return send(res, 200, pub());

//   if (route === 'POST /api/login') {
//     const ip = req.socket.remoteAddress, t = tries.get(ip) || { n: 0, at: Date.now() };
//     if (Date.now() - t.at > 6e5) { t.n = 0; t.at = Date.now(); }
//     if (t.n >= 8) return send(res, 429, { error: 'Too many attempts. Try again in 10 minutes.' });
//     const { email, password } = await readBody(req);
//     if (String(email || '').trim() !== db.admin.email || !checkPw(String(password || ''), db.admin.hash)) {
//       tries.set(ip, { ...t, n: t.n + 1 }); return send(res, 401, { error: 'Incorrect email or password.' });
//     }
//     const token = crypto.randomBytes(24).toString('hex');
//     sessions.set(token, { email: db.admin.email, exp: Date.now() + 12 * 36e5 });
//     return send(res, 200, { token, email: db.admin.email });
//   }

//   if (route === 'POST /api/orders') {            // customers: server re-checks stock and prices
//     const { cu = {}, items = [], shown } = await readBody(req);
//     const c = { name: String(cu.name || '').trim(), phone: String(cu.phone || ''), addr: String(cu.addr || '').trim(), city: String(cu.city || '').trim(), pin: String(cu.pin || ''), note: String(cu.note || '').slice(0, 300) };
//     if (c.name.length < 2 || !/^[6-9]\d{9}$/.test(c.phone) || c.addr.length < 8 || c.city.length < 2 || !/^\d{6}$/.test(c.pin)) return send(res, 200, { err: 'Please check your name, phone, address, city and PIN.' });
//     const L = []; let sub = 0;
//     for (const it of items) {
//       const p = db.products.find(x => x.id === it.pid), q = Math.floor(+it.q);
//       if (!p || !(q > 0)) continue;
//       if (!p.avail || q > p.stock) return send(res, 200, { err: `${p.name}: only ${p.avail ? p.stock : 0} available. Please update your order.` });
//       L.push({ p, q, t: p.price * q }); sub += p.price * q;
//     }
//     if (!L.length) return send(res, 200, { err: 'Your order is empty.' });
//     const fee = sub >= db.set.freeAbove ? 0 : db.set.fee, total = sub + fee;
//     if (total !== shown) return send(res, 200, { rev: total });
//     const at = Date.now(), d = new Date(at).toISOString().slice(2, 10).replace(/-/g, ''), id = `AS-${d}-${String(db.seq++).padStart(4, '0')}`;
//     const o = { id, at, cu: c, items: L.map(({ p, q, t }) => ({ pid: p.id, name: p.name, unit: p.unit, q, up: p.price, t })), sub, fee, total, status: 'Pending', hist: [{ f: null, t: 'Pending', at, by: 'customer' }] };
//     L.forEach(({ p, q }) => { p.stock -= q; db.moves.unshift({ pid: p.id, n: p.name, chg: -q, why: 'Order ' + id, at }); });
//     db.orders.unshift(o); save();
//     return send(res, 200, { o, products: db.products });
//   }

//   if (!owner(req)) return send(res, 401, { error: 'Please sign in again.' });   // everything below is owner-only

//   if (route === 'GET /api/admin/state') return send(res, 200, { ...pub(), orders: db.orders, moves: db.moves, seq: db.seq, v: db.v });

//   if (route === 'POST /api/admin/state') {
//     const b = await readBody(req);
//     if (b.v !== db.v) return send(res, 409, { error: 'Data changed on the server (e.g. a new order). Reloaded - please repeat your last change.' });
//     if (!Array.isArray(b.products) || b.products.length > 500) return send(res, 400, { error: 'Invalid products.' });
//     db.products = b.products.map(p => ({ ...p, name: String(p.name).slice(0, 80), price: Math.max(0, Math.round(+p.price)), stock: Math.max(0, Math.floor(+p.stock)), img: /^(\/uploads\/[\w.-]+|https?:\/\/.+)$/.test(p.img || '') ? p.img : '' }));
//     if (b.set && typeof b.set === 'object') db.set = { ...db.set, ...b.set };
//     if (Array.isArray(b.moves)) db.moves = b.moves.slice(0, 500);
//     for (const u of b.orders || []) { const o = db.orders.find(x => x.id === u.id); if (o && STATUS.includes(u.status)) { o.status = u.status; o.hist = u.hist; } }
//     if (typeof b.password === 'string' && b.password.length >= 6) db.admin.hash = hash(b.password);
//     save(); return send(res, 200, { v: db.v });
//   }

//   if (route === 'POST /api/upload') {            // body: { data: "data:image/jpeg;base64,..." }
//     const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec((await readBody(req)).data || '');
//     if (!m) return send(res, 400, { error: 'Send a JPG, PNG or WebP image.' });
//     const ext = m[1] === 'jpeg' ? 'jpg' : m[1], buf = Buffer.from(m[2], 'base64');
//     if (buf.length > 4e6 || !MAGIC[ext](buf)) return send(res, 400, { error: 'Image is invalid or over 4 MB.' });
//     const name = crypto.randomBytes(8).toString('hex') + '.' + ext;
//     fs.writeFileSync(path.join(UP, name), buf);
//     return send(res, 200, { url: '/uploads/' + name });
//   }
//   send(res, 404, { error: 'Not found' });
// }

// http.createServer(async (req, res) => {
//   const url = decodeURIComponent(req.url.split('?')[0]);
//   try {
//     if (url.startsWith('/api/')) return await api(req, res, url);
//     const base = url.startsWith('/uploads/') ? UP : PUB, rel = url.startsWith('/uploads/') ? url.slice(9) : (url === '/' ? 'index.html' : url);
//     const file = path.normalize(path.join(base, rel));
//     if (!file.startsWith(base) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
//     res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': base === UP ? 'public, max-age=31536000, immutable' : 'no-cache' });
//     fs.createReadStream(file).pipe(res);
//   } catch (e) { send(res, 500, { error: typeof e === 'string' ? e : 'Server error' }); }
// }).listen(PORT, () => console.log(`ApnaSweets running at http://localhost:${PORT}`));





require('dotenv').config();

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns');
const { MongoClient } = require('mongodb');

// DNS workaround: Atlas SRV lookup fails on some networks.
dns.setServers(['8.8.8.8', '8.8.4.4']);

const PORT = process.env.PORT || 3000;
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const UP = path.join(DATA, 'uploads');
const DB_FILE = path.join(DATA, 'db.json');
const PUB = path.join(__dirname, 'public');
const STATUS = ['Pending', 'Ongoing', 'Delivered'];

fs.mkdirSync(UP, { recursive: true });

const hash = (pw, salt = crypto.randomBytes(16).toString('hex')) =>
  salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');

const same = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  a.length === b.length &&
  crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

const checkPw = (pw, storedHash) => {
  if (typeof storedHash !== 'string' || !storedHash.includes(':')) return false;
  return same(hash(pw, storedHash.split(':')[0]), storedHash);
};

const sessions = new Map();
const tries = new Map();

let db;
let mongoClient;
let stateCollection;
let saveQueue = Promise.resolve();

const send = (res, code, obj) => {
  if (res.headersSent) return;
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify(obj));
};

const readBody = req => new Promise((resolve, reject) => {
  let body = '';
  let size = 0;

  req.on('data', chunk => {
    size += chunk.length;

    if (size > 8e6) {
      reject('Request too large');
      req.destroy();
    } else {
      body += chunk;
    }
  });

  req.on('end', () => {
    try {
      resolve(body ? JSON.parse(body) : {});
    } catch {
      reject('Bad JSON');
    }
  });

  req.on('error', reject);
});

const owner = req => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const session = sessions.get(token);

  return session && session.exp > Date.now() ? session : null;
};

const pub = () => ({
  products: db.products,
  set: db.set
});

// Save complete shop state to MongoDB.
function save() {
  db.v = (Number(db.v) || 0) + 1;

  const snapshot = { ...db, _id: 'main' };

  saveQueue = saveQueue.then(() =>
    stateCollection.replaceOne(
      { _id: 'main' },
      snapshot,
      { upsert: true }
    )
  );

  return saveQueue;
}

function readLocalState() {
  try {
    if (!fs.existsSync(DB_FILE)) return null;

    const value = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));

    if (value && Array.isArray(value.products) && value.set) {
      return value;
    }
  } catch (error) {
    console.error('Could not read local db.json:', error.message);
  }

  return null;
}

function makeSeedState() {
  const seed = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'seed.json'), 'utf8')
  );

  return {
    ...seed,
    orders: [],
    moves: [],
    seq: 1,
    v: 1,
    admin: {
      email: process.env.ADMIN_EMAIL || 'owner@apnasweets.in',
      hash: hash(process.env.ADMIN_PASSWORD || 'sweets123')
    }
  };
}

async function initializeDatabase() {
  if (!process.env.MONGODB_URI) {
    throw new Error(
      'MONGODB_URI is missing. Add it to .env and Render environment variables.'
    );
  }

  mongoClient = new MongoClient(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 20000,
    connectTimeoutMS: 20000
  });

  await mongoClient.connect();

  const database = mongoClient.db(
    process.env.MONGODB_DB || 'apnasweets'
  );

  stateCollection = database.collection('appState');

  // Never overwrite an existing MongoDB state with seed data.
  const existing = await stateCollection.findOne({ _id: 'main' });

  if (existing) {
    const { _id, ...state } = existing;
    db = state;

    if (!Array.isArray(db.orders)) db.orders = [];
    if (!Array.isArray(db.moves)) db.moves = [];

    console.log('MongoDB connected; existing shop data loaded.');
    return;
  }

  // First startup: migrate local JSON if available, otherwise use seed.json.
  const local = readLocalState();
  db = local || makeSeedState();

  if (!Array.isArray(db.orders)) db.orders = [];
  if (!Array.isArray(db.moves)) db.moves = [];
  if (!Number.isFinite(Number(db.seq))) db.seq = 1;
  if (!Number.isFinite(Number(db.v))) db.v = 1;

  if (!db.admin || !db.admin.email || !db.admin.hash) {
    db.admin = {
      email: process.env.ADMIN_EMAIL || 'owner@apnasweets.in',
      hash: hash(process.env.ADMIN_PASSWORD || 'sweets123')
    };
  }

  try {
    await stateCollection.insertOne({ ...db, _id: 'main' });

    console.log(
      local
        ? 'Local JSON data migrated to MongoDB.'
        : 'Initial products loaded from seed.json.'
    );
  } catch (error) {
    if (error.code !== 11000) throw error;

    const winner = await stateCollection.findOne({ _id: 'main' });
    const { _id, ...state } = winner;
    db = state;

    console.log('Shop data initialized by another instance was loaded.');
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8'
};

const MAGIC = {
  jpg: b => b[0] === 0xff && b[1] === 0xd8,
  png: b => b[0] === 0x89 && b[1] === 0x50,
  webp: b => b.slice(0, 4).toString() === 'RIFF'
};

async function api(req, res, url) {
  const route = req.method + ' ' + url;

  if (route === 'GET /api/public') {
    return send(res, 200, pub());
  }

  if (route === 'POST /api/login') {
    const ip = req.socket.remoteAddress || 'unknown';

    const attempt = tries.get(ip) || {
      n: 0,
      at: Date.now()
    };

    if (Date.now() - attempt.at > 600000) {
      attempt.n = 0;
      attempt.at = Date.now();
    }

    if (attempt.n >= 8) {
      return send(res, 429, {
        error: 'Too many attempts. Try again in 10 minutes.'
      });
    }

    const { email, password } = await readBody(req);

    if (
      String(email || '').trim() !== db.admin.email ||
      !checkPw(String(password || ''), db.admin.hash)
    ) {
      tries.set(ip, { ...attempt, n: attempt.n + 1 });

      return send(res, 401, {
        error: 'Incorrect email or password.'
      });
    }

    tries.delete(ip);

    const token = crypto.randomBytes(24).toString('hex');

    sessions.set(token, {
      email: db.admin.email,
      exp: Date.now() + 12 * 36e5
    });

    return send(res, 200, {
      token,
      email: db.admin.email
    });
  }

  if (route === 'POST /api/orders') {
    const { cu = {}, items = [], shown } = await readBody(req);

    const customer = {
      name: String(cu.name || '').trim(),
      phone: String(cu.phone || ''),
      addr: String(cu.addr || '').trim(),
      city: String(cu.city || '').trim(),
      pin: String(cu.pin || ''),
      note: String(cu.note || '').slice(0, 300)
    };

    if (
      customer.name.length < 2 ||
      !/^[6-9]\d{9}$/.test(customer.phone) ||
      customer.addr.length < 8 ||
      customer.city.length < 2 ||
      !/^\d{6}$/.test(customer.pin)
    ) {
      return send(res, 200, {
        err: 'Please check your name, phone, address, city and PIN.'
      });
    }

    const lines = [];
    let subtotal = 0;

    for (const item of items) {
      const product = db.products.find(p => p.id === item.pid);
      const quantity = Math.floor(+item.q);

      if (!product || !(quantity > 0)) continue;

      if (!product.avail || quantity > product.stock) {
        return send(res, 200, {
          err: `${product.name}: only ${
            product.avail ? product.stock : 0
          } available. Please update your order.`
        });
      }

      lines.push({
        p: product,
        q: quantity,
        t: product.price * quantity
      });

      subtotal += product.price * quantity;
    }

    if (!lines.length) {
      return send(res, 200, { err: 'Your order is empty.' });
    }

    const fee = subtotal >= db.set.freeAbove ? 0 : db.set.fee;
    const total = subtotal + fee;

    if (total !== shown) {
      return send(res, 200, { rev: total });
    }

    const at = Date.now();
    const datePart = new Date(at)
      .toISOString()
      .slice(2, 10)
      .replace(/-/g, '');

    const id = `AS-${datePart}-${String(db.seq++).padStart(4, '0')}`;

    const order = {
      id,
      at,
      cu: customer,
      items: lines.map(({ p, q, t }) => ({
        pid: p.id,
        name: p.name,
        unit: p.unit,
        q,
        up: p.price,
        t
      })),
      sub: subtotal,
      fee,
      total,
      status: 'Pending',
      hist: [{
        f: null,
        t: 'Pending',
        at,
        by: 'customer'
      }]
    };

    lines.forEach(({ p, q }) => {
      p.stock -= q;

      db.moves.unshift({
        pid: p.id,
        n: p.name,
        chg: -q,
        why: 'Order ' + id,
        at
      });
    });

    db.orders.unshift(order);

    await save();

    return send(res, 200, {
      o: order,
      products: db.products
    });
  }

  if (!owner(req)) {
    return send(res, 401, {
      error: 'Please sign in again.'
    });
  }

  if (route === 'GET /api/admin/state') {
    return send(res, 200, {
      ...pub(),
      orders: db.orders,
      moves: db.moves,
      seq: db.seq,
      v: db.v
    });
  }

  if (route === 'POST /api/admin/state') {
    const body = await readBody(req);

    if (body.v !== db.v) {
      return send(res, 409, {
        error: 'Data changed on the server (e.g. a new order). Reloaded - please repeat your last change.'
      });
    }

    if (!Array.isArray(body.products) || body.products.length > 500) {
      return send(res, 400, { error: 'Invalid products.' });
    }

    db.products = body.products.map(p => ({
      ...p,
      name: String(p.name || '').slice(0, 80),
      price: Math.max(0, Math.round(+p.price || 0)),
      stock: Math.max(0, Math.floor(+p.stock || 0)),
      img: /^(\/uploads\/[\w.-]+|https?:\/\/.+)$/.test(p.img || '')
        ? p.img
        : ''
    }));

    if (body.set && typeof body.set === 'object') {
      db.set = { ...db.set, ...body.set };
    }

    if (Array.isArray(body.moves)) {
      db.moves = body.moves.slice(0, 500);
    }

    for (const updated of body.orders || []) {
      const order = db.orders.find(o => o.id === updated.id);

      if (order && STATUS.includes(updated.status)) {
        order.status = updated.status;

        if (Array.isArray(updated.hist)) {
          order.hist = updated.hist;
        }
      }
    }

    if (typeof body.password === 'string' && body.password.length >= 6) {
      db.admin.hash = hash(body.password);
    }

    await save();

    return send(res, 200, { v: db.v });
  }

  if (route === 'POST /api/upload') {
    const body = await readBody(req);

    const match = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(
      body.data || ''
    );

    if (!match) {
      return send(res, 400, {
        error: 'Send a JPG, PNG or WebP image.'
      });
    }

    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const buffer = Buffer.from(match[2], 'base64');

    if (buffer.length > 4e6 || !MAGIC[ext](buffer)) {
      return send(res, 400, {
        error: 'Image is invalid or over 4 MB.'
      });
    }

    const filename = crypto.randomBytes(8).toString('hex') + '.' + ext;

    fs.writeFileSync(path.join(UP, filename), buffer);

    return send(res, 200, {
      url: '/uploads/' + filename
    });
  }

  return send(res, 404, { error: 'Not found' });
}

async function startServer() {
  // Do not accept requests until MongoDB is connected and state is loaded.
  await initializeDatabase();

  const server = http.createServer(async (req, res) => {
    try {
      const url = decodeURIComponent(req.url.split('?')[0]);

      if (url.startsWith('/api/')) {
        await api(req, res, url);
        return;
      }

      const isUpload = url.startsWith('/uploads/');
      const base = isUpload ? UP : PUB;
      const relative = isUpload
        ? url.slice(9)
        : (url === '/' ? 'index.html' : url);

      const file = path.normalize(path.join(base, relative));

      if (file !== base && !file.startsWith(base + path.sep)) {
        res.writeHead(403);
        return res.end('Forbidden');
      }

      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404);
        return res.end('Not found');
      }

      res.writeHead(200, {
        'Content-Type':
          MIME[path.extname(file).toLowerCase()] ||
          'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': isUpload
          ? 'public, max-age=31536000, immutable'
          : 'no-cache'
      });

      fs.createReadStream(file).pipe(res);
    } catch (error) {
      console.error('Request failed:', error);

      if (!res.headersSent) {
        const code =
          error === 'Bad JSON' ? 400 :
          error === 'Request too large' ? 413 : 500;

        send(res, code, {
          error: typeof error === 'string' ? error : 'Server error'
        });
      } else {
        res.destroy();
      }
    }
  });

  server.listen(PORT, () => {
    console.log(`ApnaSweets running on port ${PORT}`);
  });

  const shutdown = () => {
    console.log('Shutting down ApnaSweets...');

    server.close(async () => {
      try {
        await saveQueue;
        if (mongoClient) await mongoClient.close();
      } catch (error) {
        console.error('Shutdown error:', error.message);
      }

      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer().catch(error => {
  console.error('ApnaSweets startup failed:', error);
  process.exit(1);
});
