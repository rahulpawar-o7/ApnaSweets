// ApnaSweets backend - plain Node.js (v18+), no npm install needed.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');   // db.json + uploads/ live here
const UP = path.join(DATA, 'uploads'), DB = path.join(DATA, 'db.json'), PUB = path.join(__dirname, 'public');
const STATUS = ['Pending', 'Ongoing', 'Delivered'];
fs.mkdirSync(UP, { recursive: true });

const hash = (pw, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const checkPw = (pw, h) => same(hash(pw, h.split(':')[0]), h);

let db;
try { db = JSON.parse(fs.readFileSync(DB, 'utf8')); }
catch {
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed.json'), 'utf8'));
  db = { ...seed, orders: [], moves: [], seq: 1, v: 1,
    admin: { email: process.env.ADMIN_EMAIL || 'owner@apnasweets.in', hash: hash(process.env.ADMIN_PASSWORD || 'sweets123') } };
  save();
}
function save() { db.v++; fs.writeFileSync(DB + '.tmp', JSON.stringify(db)); fs.renameSync(DB + '.tmp', DB); }

const sessions = new Map(), tries = new Map();
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const readBody = req => new Promise((ok, no) => {
  let b = '', n = 0;
  req.on('data', c => { n += c.length; if (n > 8e6) { no('Request too large'); req.destroy(); } else b += c; });
  req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch { no('Bad JSON'); } });
});
const owner = req => { const s = sessions.get((req.headers.authorization || '').slice(7)); return s && s.exp > Date.now() ? s : null; };
const pub = () => ({ products: db.products, set: db.set });

const MIME = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.js': 'text/javascript', '.css': 'text/css' };
const MAGIC = { jpg: b => b[0] === 0xff && b[1] === 0xd8, png: b => b[0] === 0x89 && b[1] === 0x50, webp: b => b.slice(0, 4).toString() === 'RIFF' };

async function api(req, res, url) {
  const route = req.method + ' ' + url;
  if (route === 'GET /api/public') return send(res, 200, pub());

  if (route === 'POST /api/login') {
    const ip = req.socket.remoteAddress, t = tries.get(ip) || { n: 0, at: Date.now() };
    if (Date.now() - t.at > 6e5) { t.n = 0; t.at = Date.now(); }
    if (t.n >= 8) return send(res, 429, { error: 'Too many attempts. Try again in 10 minutes.' });
    const { email, password } = await readBody(req);
    if (String(email || '').trim() !== db.admin.email || !checkPw(String(password || ''), db.admin.hash)) {
      tries.set(ip, { ...t, n: t.n + 1 }); return send(res, 401, { error: 'Incorrect email or password.' });
    }
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, { email: db.admin.email, exp: Date.now() + 12 * 36e5 });
    return send(res, 200, { token, email: db.admin.email });
  }

  if (route === 'POST /api/orders') {            // customers: server re-checks stock and prices
    const { cu = {}, items = [], shown } = await readBody(req);
    const c = { name: String(cu.name || '').trim(), phone: String(cu.phone || ''), addr: String(cu.addr || '').trim(), city: String(cu.city || '').trim(), pin: String(cu.pin || ''), note: String(cu.note || '').slice(0, 300) };
    if (c.name.length < 2 || !/^[6-9]\d{9}$/.test(c.phone) || c.addr.length < 8 || c.city.length < 2 || !/^\d{6}$/.test(c.pin)) return send(res, 200, { err: 'Please check your name, phone, address, city and PIN.' });
    const L = []; let sub = 0;
    for (const it of items) {
      const p = db.products.find(x => x.id === it.pid), q = Math.floor(+it.q);
      if (!p || !(q > 0)) continue;
      if (!p.avail || q > p.stock) return send(res, 200, { err: `${p.name}: only ${p.avail ? p.stock : 0} available. Please update your order.` });
      L.push({ p, q, t: p.price * q }); sub += p.price * q;
    }
    if (!L.length) return send(res, 200, { err: 'Your order is empty.' });
    const fee = sub >= db.set.freeAbove ? 0 : db.set.fee, total = sub + fee;
    if (total !== shown) return send(res, 200, { rev: total });
    const at = Date.now(), d = new Date(at).toISOString().slice(2, 10).replace(/-/g, ''), id = `AS-${d}-${String(db.seq++).padStart(4, '0')}`;
    const o = { id, at, cu: c, items: L.map(({ p, q, t }) => ({ pid: p.id, name: p.name, unit: p.unit, q, up: p.price, t })), sub, fee, total, status: 'Pending', hist: [{ f: null, t: 'Pending', at, by: 'customer' }] };
    L.forEach(({ p, q }) => { p.stock -= q; db.moves.unshift({ pid: p.id, n: p.name, chg: -q, why: 'Order ' + id, at }); });
    db.orders.unshift(o); save();
    return send(res, 200, { o, products: db.products });
  }

  if (!owner(req)) return send(res, 401, { error: 'Please sign in again.' });   // everything below is owner-only

  if (route === 'GET /api/admin/state') return send(res, 200, { ...pub(), orders: db.orders, moves: db.moves, seq: db.seq, v: db.v });

  if (route === 'POST /api/admin/state') {
    const b = await readBody(req);
    if (b.v !== db.v) return send(res, 409, { error: 'Data changed on the server (e.g. a new order). Reloaded - please repeat your last change.' });
    if (!Array.isArray(b.products) || b.products.length > 500) return send(res, 400, { error: 'Invalid products.' });
    db.products = b.products.map(p => ({ ...p, name: String(p.name).slice(0, 80), price: Math.max(0, Math.round(+p.price)), stock: Math.max(0, Math.floor(+p.stock)), img: /^(\/uploads\/[\w.-]+|https?:\/\/.+)$/.test(p.img || '') ? p.img : '' }));
    if (b.set && typeof b.set === 'object') db.set = { ...db.set, ...b.set };
    if (Array.isArray(b.moves)) db.moves = b.moves.slice(0, 500);
    for (const u of b.orders || []) { const o = db.orders.find(x => x.id === u.id); if (o && STATUS.includes(u.status)) { o.status = u.status; o.hist = u.hist; } }
    if (typeof b.password === 'string' && b.password.length >= 6) db.admin.hash = hash(b.password);
    save(); return send(res, 200, { v: db.v });
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
  send(res, 404, { error: 'Not found' });
}

http.createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  try {
    if (url.startsWith('/api/')) return await api(req, res, url);
    const base = url.startsWith('/uploads/') ? UP : PUB, rel = url.startsWith('/uploads/') ? url.slice(9) : (url === '/' ? 'index.html' : url);
    const file = path.normalize(path.join(base, rel));
    if (!file.startsWith(base) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': base === UP ? 'public, max-age=31536000, immutable' : 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch (e) { send(res, 500, { error: typeof e === 'string' ? e : 'Server error' }); }
}).listen(PORT, () => console.log(`ApnaSweets running at http://localhost:${PORT}`));
