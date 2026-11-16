// DAWG GAMMIT site + admin. Plain Node (22+); the only dependency is sharp, used to sort and shrink photos.
// Environment: ADMIN_PASSWORD (required for /admin), SESSION_SECRET, DATA_DIR (default /data), PORT (default 3000).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { render, lineOf } = require('./render');

let sharp = null;
try { sharp = require('sharp'); } catch (e) { console.warn('sharp not available: photos will not be auto-sorted'); }

const PORT = +process.env.PORT || 3000;
const DATA = process.env.DATA_DIR || '/data';
const PASSWORD = process.env.ADMIN_PASSWORD || '';
const SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update('dg:' + PASSWORD).digest('hex');
const UPLOADS = path.join(DATA, 'uploads');
const STORE = path.join(DATA, 'store.json');
const APP = __dirname;
const MSGS = path.join(DATA, 'messages.json');
fs.mkdirSync(UPLOADS, { recursive: true });

// ---------- data: a draft the admin edits, and the published version visitors see ----------
function writeStore(s) { const tmp = STORE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(s)); fs.renameSync(tmp, STORE); }
function loadStore() {
  try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch (e) {
    const seed = JSON.parse(fs.readFileSync(path.join(APP, 'seed.json'), 'utf8'));
    const s = { draft: seed, published: seed, publishedAt: null, savedAt: null };
    writeStore(s); return s;
  }
}
let store = loadStore();
let siteHtml = render(store.published);
const clone = o => JSON.parse(JSON.stringify(o));

// ---------- sign-in ----------
const sign = v => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
function makeToken() { const exp = String(Date.now() + 14 * 864e5); return exp + '.' + sign(exp); }
function cookies(req) { const o = {}; (req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }); return o; }
function authed(req) {
  const t = cookies(req).dg_admin || ''; const [exp, sig] = t.split('.');
  if (!exp || !sig || +exp < Date.now()) return false;
  const good = sign(exp);
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
}
const fails = new Map();   // ip -> { n, until }
function clientIp(req) { return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(); }
function pwOk(given) {
  const a = crypto.createHash('sha256').update(String(given)).digest(), b = crypto.createHash('sha256').update(PASSWORD).digest();
  return PASSWORD.length > 0 && crypto.timingSafeEqual(a, b);
}

// ---------- helpers ----------
function send(res, code, body, type = 'text/html; charset=utf-8', extra = {}) {
  res.writeHead(code, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', ...extra });
  res.end(body);
}
const json = (res, code, obj) => send(res, code, JSON.stringify(obj), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' });
function readBody(req, limit = 12e6) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
const STATIC = { 'hero-bg.webp': 'image/webp', 'hero-man.webp': 'image/webp' };

// ---------- reading KoolTeez ----------
const KT = /^(?:https?:\/\/)?(?:www\.)?koolteez\.com\/(?:[a-z]{2}-[a-z]{3}\/)?(products|collections)\/([a-z0-9-]+)/i;
async function getText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'DawgGammitSite/1.0 (+https://dawggammit.com)' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('KoolTeez answered ' + r.status);
  return r.text();
}
function decode(s) { return String(s).replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }
function cleanName(t) {
  let n = decode(t).replace(/dawg gammit(™)?/ig, '').replace(/super heavyweight/ig, '').replace(/\s+/g, ' ').trim();
  if (n === n.toUpperCase()) n = n.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
  return n.replace(/T-Shirt/g, 'T-shirt').replace(/'S\b/g, "'s");
}
async function classify(url) {          // cut-out product shot, flat shot on white, or a photo of someone wearing it
  if (!sharp) return 'flat';
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) }); if (!r.ok) return 'flat';
    const buf = Buffer.from(await r.arrayBuffer());
    const { data, info } = await sharp(buf).resize(24, 24, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const px = (x, y) => { const i = (y * info.width + x) * 4; return [data[i], data[i + 1], data[i + 2], data[i + 3]]; };
    const corners = [px(0, 0), px(23, 0), px(0, 23), px(23, 23)];
    if (corners.some(c => c[3] < 50)) return 'cut';
    if (corners.every(c => c[0] > 232 && c[1] > 232 && c[2] > 232)) return 'flat';
    return 'photo';
  } catch (e) { return 'flat'; }
}
async function readProduct(slug) {
  const url = 'https://koolteez.com/products/' + slug;
  const h = (await getText(url)).replace(/\\\//g, '/');
  const title = (h.match(/<meta property="og:title" content="([^"]+)"/) || [])[1];
  if (!title) throw new Error('No product on that page');
  const price = ((h.match(/\$[0-9]+(?:\.[0-9]{2})?/) || [''])[0]).replace(/\.00$/, '');
  const og = (h.match(/<meta property="og:image" content="([^"]+)"/) || [])[1];
  // the page lists each photo at several sizes: keep one size per photo (the smallest that is still sharp)
  const groups = new Map();
  [og].concat(h.match(/https:\/\/imgproxy\.fourthwall\.dev\/[^"\\ ]+/g) || []).filter(Boolean).forEach(u => {
    u = decode(u); const key = (u.split('/enc/')[1] || u).split('.')[0]; const w = +((u.match(/\/w:(\d+)\//) || [])[1] || 0);
    if (w < 700) return;                                  // skips logos, icons and thumbnails
    const cur = groups.get(key); if (!cur || w < cur.w) groups.set(key, { u, w });
  });
  const photos = [...groups.values()].map(g => g.u).slice(0, 6);
  const kinds = await Promise.all(photos.map(classify));
  const pick = k => photos[kinds.indexOf(k)];
  const img = pick('cut') || pick('flat') || photos[0] || null;
  const photo = pick('photo') || null;
  const alt = photo || photos.find(p => p !== img) || null;
  const name = cleanName(title);
  // KoolTeez's own first photo (the shop thumbnail Robert sets in Fourthwall), used by "Refresh photos"
  const first = photos[0] || null, firstKind = kinds[0] || null, plain = pick('cut') || pick('flat') || null;
  return { slug, name, price, url, img, alt, photo, line: lineOf(name), visible: true, first, firstKind, plain };
}
async function readLinks(lines) {
  const out = []; const slugs = []; let collection = null;
  for (const raw of lines.map(s => String(s).trim()).filter(Boolean).slice(0, 20)) {
    const m = raw.match(KT);
    if (!m) { out.push({ bad: raw }); continue; }
    if (m[1].toLowerCase() === 'collections') {
      collection = collection || m[2].toLowerCase();
      try {
        const h = await getText('https://koolteez.com/collections/' + m[2]);
        const found = [...new Set((h.match(/\/products\/([a-z0-9-]+)/g) || []).map(s => s.split('/')[2]))].filter(s => s !== 'collections');
        if (!found.length) out.push({ error: raw, message: 'No products found in that collection' });
        found.forEach(s => slugs.push(s));
      } catch (e) { out.push({ error: raw, message: e.message }); }
    } else slugs.push(m[2].toLowerCase());
  }
  const uniq = [...new Set(slugs)].slice(0, 60);
  for (let i = 0; i < uniq.length; i += 4) {            // four pages at a time, gentle on the shop
    const batch = await Promise.all(uniq.slice(i, i + 4).map(s => readProduct(s).catch(e => ({ error: 'koolteez.com/products/' + s, message: e.message }))));
    out.push(...batch);
  }
  return { results: out, collection };
}

// ---------- refreshing every product's photos from KoolTeez ----------
// The shop picture becomes the product's first photo on KoolTeez (its thumbnail there);
// when that is a model photo, the plain product shot shows on hover instead.
// Names, prices, order, product lines and hidden products are left as they are.
async function refreshPhotos(state) {
  const items = state.cols.flatMap(c => c.items);
  const slugs = [...new Set(items.map(i => i.slug).filter(Boolean))];
  const found = {}, failed = [];
  for (let i = 0; i < slugs.length; i += 4) {
    const batch = await Promise.all(slugs.slice(i, i + 4).map(s => readProduct(s).then(r => [s, r]).catch(e => [s, null, e.message])));
    batch.forEach(([s, r, msg]) => { if (r && r.first) found[s] = r; else failed.push({ slug: s, message: msg || 'No photos on the page' }); });
  }
  let changed = 0;
  items.forEach(it => {
    const r = found[it.slug]; if (!r) return;
    const before = JSON.stringify([it.img, it.alt, it.photo, it.mainPhoto]);
    const oldPhoto = it.photo;
    it.mainPhoto = r.firstKind === 'photo';
    it.img = r.first;
    it.alt = it.mainPhoto ? r.plain : r.photo;
    it.photo = it.mainPhoto ? r.first : r.photo;
    // lookbook photos taken from KoolTeez for this product follow the new model photo
    (state.look || []).forEach(l => { if (l.source === 'koolteez' && l.slug === it.slug && it.photo && l.src === oldPhoto) l.src = it.photo; });
    if (JSON.stringify([it.img, it.alt, it.photo, it.mainPhoto]) !== before) changed++;
  });
  return { changed, checked: slugs.length - failed.length, failed };
}

// ---------- uploads ----------
async function saveUpload(dataUrl) {
  const m = String(dataUrl).match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error('Upload a JPG, PNG or WebP photo');
  let buf = Buffer.from(m[2], 'base64');
  if (sharp) buf = await sharp(buf).rotate().resize({ height: 1600, withoutEnlargement: true }).jpeg({ quality: 84 }).toBuffer();
  else if (m[1] !== 'jpeg') throw new Error('Upload a JPG photo');
  const name = crypto.createHash('sha1').update(buf).digest('hex') + '.jpg';
  fs.writeFileSync(path.join(UPLOADS, name), buf);
  return '/media/' + name;
}

// ---------- checking what the admin saves ----------
const str = (v, n = 300) => String(v == null ? '' : v).slice(0, n);
const okUrl = u => (/^(https:\/\/|\/media\/)/.test(u || '') ? str(u, 2000) : null);
function cleanState(s) {
  if (!s || !Array.isArray(s.cols) || !Array.isArray(s.look)) throw new Error('Bad data');
  return {
    cols: s.cols.slice(0, 50).map(c => ({
      id: str(c.id, 60).replace(/[^a-z0-9-]/g, '') || 'collection', name: str(c.name, 60),
      items: (c.items || []).slice(0, 500).map(i => ({
        slug: str(i.slug, 200).replace(/[^a-z0-9-]/g, ''), name: str(i.name, 120), price: str(i.price, 20),
        url: /^https:\/\/koolteez\.com\//.test(i.url || '') ? str(i.url, 300) : 'https://koolteez.com/products/' + str(i.slug, 200).replace(/[^a-z0-9-]/g, ''),
        img: okUrl(i.img), alt: okUrl(i.alt), photo: okUrl(i.photo), mainPhoto: !!i.mainPhoto, visible: i.visible !== false, line: str(i.line, 40) || lineOf(i.name),
      })),
    })),
    look: s.look.slice(0, 24).map(l => ({ src: okUrl(l.src), source: l.source === 'upload' ? 'upload' : 'koolteez', slug: str(l.slug, 200).replace(/[^a-z0-9-]/g, '') })).filter(l => l.src),
    extraLines: (s.extraLines || []).slice(0, 30).map(l => str(l, 40)).filter(Boolean),
  };
}

// ---------- enquiries from the contact form (kept on the server, read in the admin) ----------
const TYPES = { customer: 'Customer', licensing: 'Licensing', wholesale: 'Wholesale or stockist', press: 'Press or other' };
let msgs = []; try { msgs = JSON.parse(fs.readFileSync(MSGS, 'utf8')); } catch (e) {}
function writeMsgs() { const tmp = MSGS + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(msgs)); fs.renameSync(tmp, MSGS); }
const sent = new Map();   // ip -> times of recent messages
function cleanMsg(b) {
  const one = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, n);
  const m = { type: TYPES[b.type] ? b.type : '', name: one(b.name, 100), email: one(b.email, 160), company: one(b.company, 120), order: one(b.order, 60),
    message: String(b.message == null ? '' : b.message).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, 3000) };
  if (!m.type) throw new Error('Choose what your enquiry is about.');
  if (m.name.length < 2) throw new Error('Enter your name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(m.email)) throw new Error('Enter a valid email address so we can reply.');
  if ((m.type === 'licensing' || m.type === 'wholesale') && m.company.length < 2) throw new Error('Enter your company name.');
  if (m.message.length < 10) throw new Error('Write a few words about your enquiry.');
  return m;
}

// ---------- pages ----------
const LOGIN = fs.readFileSync(path.join(APP, 'login.html'), 'utf8');
const ADMIN = fs.readFileSync(path.join(APP, 'admin.html'), 'utf8');
const studio = require('./studio')({ DATA, json, send, readBody, readProduct, getStore: () => store });
const stats = require('./stats')({ DATA, SECRET, send, readBody, clientIp });

const server = http.createServer(async (req, res) => {
  if (req.method === 'HEAD') { req.method = 'GET'; const end = res.end.bind(res); res.write = () => true; res.end = (b, ...a) => end(); }   // link checkers and social previews ask with HEAD
  const url = new URL(req.url, 'http://x'); const p = url.pathname;
  try {
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {   // browsers re-check on every visit, so a publish shows at once
      const tag = '"' + (store.publishedAt || 'seed') + '"';
      if (req.headers['if-none-match'] === tag) return send(res, 304, '', undefined, { ETag: tag, 'Cache-Control': 'no-cache' });
      return send(res, 200, siteHtml, undefined, { ETag: tag, 'Cache-Control': 'no-cache' });
    }
    if (req.method === 'GET' && p.startsWith('/static/')) {
      const f = p.slice(8); if (!STATIC[f]) return send(res, 404, 'Not found', 'text/plain');
      return send(res, 200, fs.readFileSync(path.join(APP, 'public', f)), STATIC[f], { 'Cache-Control': 'public, max-age=604800' });
    }
    if (req.method === 'GET' && p.startsWith('/media/')) {
      const f = p.slice(7); if (!/^[a-f0-9]{40}\.jpg$/.test(f) || !fs.existsSync(path.join(UPLOADS, f))) return send(res, 404, 'Not found', 'text/plain');
      return send(res, 200, fs.readFileSync(path.join(UPLOADS, f)), 'image/jpeg', { 'Cache-Control': 'public, max-age=31536000, immutable' });
    }
    if (p === '/healthz') return send(res, 200, 'ok', 'text/plain');
    if (p === '/api/hit' && req.method === 'POST') return stats.hit(req, res);
    { const g = p.match(/^\/go\/([a-z0-9]{6,24})\/([a-z]+)\/?$/); if (g && req.method === 'GET') return stats.go(req, res, studio.jobInfo, g[1], g[2]); }
    if (p === '/api/contact' && req.method === 'POST') {
      try {
        if (!/application\/json/.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'Expected JSON' });
        const o = req.headers.origin; if (o && new URL(o).host !== req.headers.host) return json(res, 403, { error: 'Send the form from this site.' });
        const b = JSON.parse(await readBody(req, 2e4));
        if (b.website || !(+b.t >= 2500)) return json(res, 200, { ok: true });          // hidden field filled, or sent faster than a person can type: a robot. Say thanks, keep nothing.
        const m = cleanMsg(b);
        const ip = clientIp(req), now = Date.now(), mine = (sent.get(ip) || []).filter(x => now - x < 3600e3);
        if (mine.length >= 5 || msgs.filter(x => now - Date.parse(x.at) < 86400e3).length >= 300) return json(res, 429, { error: 'Too many messages just now. Please try again later.' });
        mine.push(now); sent.set(ip, mine);
        msgs.unshift({ id: crypto.randomBytes(8).toString('hex'), at: new Date().toISOString(), read: false, ...m });
        if (msgs.length > 1000) msgs.length = 1000;
        writeMsgs();
        return json(res, 200, { ok: true });
      } catch (e) { return json(res, 400, { error: /^(Choose|Enter|Write)/.test(e.message) ? e.message : 'That did not send. Check the form and try again.' }); }
    }

    // ----- admin -----
    if (p === '/admin/login' && req.method === 'GET') return send(res, 200, LOGIN.replace('{{MSG}}', PASSWORD ? '' : 'Sign-in is switched off: no admin password is set on the server.'), undefined, { 'Cache-Control': 'no-store' });
    if (p === '/admin/login' && req.method === 'POST') {
      const ip = clientIp(req); const f = fails.get(ip) || { n: 0, until: 0 };
      if (f.until > Date.now()) return send(res, 429, LOGIN.replace('{{MSG}}', 'Too many tries. Wait 15 minutes and try again.'));
      const pw = new URLSearchParams(await readBody(req, 1e4)).get('password') || '';
      if (!pwOk(pw)) {
        f.n += 1; if (f.n >= 8) { f.until = Date.now() + 15 * 60e3; f.n = 0; } fails.set(ip, f);
        return send(res, 401, LOGIN.replace('{{MSG}}', 'That password is not right.'));
      }
      fails.delete(ip);
      return send(res, 303, '', 'text/plain', { Location: '/admin', 'Set-Cookie': `dg_admin=${makeToken()}; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${14 * 86400}` });
    }
    if (p === '/admin/logout') return send(res, 303, '', 'text/plain', { Location: '/admin/login', 'Set-Cookie': 'dg_admin=; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0' });
    if (p === '/admin' || p.startsWith('/admin/')) {
      if (!authed(req)) return p.startsWith('/admin/api/') ? json(res, 401, { error: 'Signed out. Reload the page and sign in again.' }) : send(res, 303, '', 'text/plain', { Location: '/admin/login' });
      const H = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
      if (p === '/admin/videos' || p.startsWith('/admin/studio/') || p.startsWith('/admin/api/studio')) { const r = await studio(req, res, p); if (r !== false) return; }
      if (p === '/admin' && req.method === 'GET') return send(res, 200, ADMIN, undefined, H);
      if (p === '/admin/stats' && req.method === 'GET') {
        const names = {}; (store.published.cols || []).forEach(c => (c.items || []).forEach(i => { names[i.slug] = i.name; }));
        return send(res, 200, stats.page(url.searchParams.get('d') || '7', names, studio.jobInfo), undefined, H);
      }
      if (p === '/admin/preview' && req.method === 'GET') return send(res, 200, render(store.draft, { preview: true }), undefined, H);
      if (p.startsWith('/admin/api/') && req.method !== 'GET' && !/application\/json/.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'Expected JSON' });
      if (p === '/admin/api/state' && req.method === 'GET') return json(res, 200, { draft: store.draft, publishedAt: store.publishedAt, savedAt: store.savedAt, dirty: JSON.stringify(store.draft) !== JSON.stringify(store.published) });
      if (p === '/admin/api/state' && req.method === 'PUT') {
        store.draft = cleanState(JSON.parse(await readBody(req, 4e6))); store.savedAt = new Date().toISOString(); writeStore(store);
        return json(res, 200, { savedAt: store.savedAt, dirty: JSON.stringify(store.draft) !== JSON.stringify(store.published) });
      }
      if (p === '/admin/api/publish' && req.method === 'POST') {
        store.published = clone(store.draft); store.publishedAt = new Date().toISOString(); writeStore(store); siteHtml = render(store.published);
        return json(res, 200, { publishedAt: store.publishedAt });
      }
      if (p === '/admin/api/fetch' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req, 1e5));
        return json(res, 200, await readLinks(Array.isArray(body.urls) ? body.urls : []));
      }
      if (p === '/admin/api/refresh-photos' && req.method === 'POST') {
        const draft = clone(store.draft); const r = await refreshPhotos(draft);
        store.draft = cleanState(draft); store.savedAt = new Date().toISOString(); writeStore(store);
        return json(res, 200, { ...r, draft: store.draft, dirty: JSON.stringify(store.draft) !== JSON.stringify(store.published) });
      }
      if (p === '/admin/api/upload' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        return json(res, 200, { src: await saveUpload(body.dataUrl) });
      }
      if (p === '/admin/api/messages' && req.method === 'GET') return json(res, 200, { messages: msgs, types: TYPES });
      if (p === '/admin/api/messages' && req.method === 'POST') {
        const b = JSON.parse(await readBody(req, 1e4)); const i = msgs.findIndex(m => m.id === b.id);
        if (i < 0) return json(res, 404, { error: 'That message is no longer there.' });
        if (b.action === 'delete') msgs.splice(i, 1); else msgs[i].read = b.action === 'read';
        writeMsgs(); return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: 'Not found' });
    }
    return send(res, 404, '<!doctype html><title>Not found</title><p style="font-family:sans-serif">Page not found. <a href="/">Go to DAWG GAMMIT</a></p>');
  } catch (e) {
    console.error(p, e.message);
    return p.startsWith('/admin/api/') ? json(res, 400, { error: e.message }) : send(res, 500, 'Something went wrong', 'text/plain');
  }
});
server.listen(PORT, () => console.log('DAWG GAMMIT site on port ' + PORT + (PASSWORD ? '' : ' (admin sign-in off: ADMIN_PASSWORD not set)')));
