// DAWG GAMMIT video studio: the admin side. Jobs live in DATA/videos/jobs/<id>/job.json (written here);
// the render worker (studio/worker.py) writes status.json, video.mp4 and cover.jpg beside it.
// Approving a video uploads it to Postiz and schedules one post per connected channel.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = function studio({ DATA, json, send, readBody, readProduct, getStore }) {
  const VID = path.join(DATA, 'videos'), JOBS = path.join(VID, 'jobs'), THUMBS = path.join(VID, 'thumbs');
  const LIB = path.join(DATA, 'studio-library'), SETTINGS = path.join(VID, 'settings.json');
  [JOBS, THUMBS, path.join(LIB, 'tracks'), path.join(LIB, 'vo'), path.join(LIB, 'posters')].forEach(d => fs.mkdirSync(d, { recursive: true }));
  const FONT = ((fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8').match(/@font-face\{font-family:"ChunkFive";[^}]*\}/) || [''])[0]);
  const PAGE = fs.readFileSync(path.join(__dirname, 'videos.html'), 'utf8').replace('/*CHUNKFIVE*/', () => FONT);
  const POSTIZ = (process.env.POSTIZ_API_URL || 'https://api.postiz.com').replace(/\/$/, '');
  const rj = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
  const wj = (f, o) => { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(o, null, 1)); fs.renameSync(t, f); };
  const okId = id => /^[a-z0-9]{6,24}$/.test(String(id || ''));
  const CHANNELS = ['tiktok', 'instagram', 'facebook', 'youtube', 'pinterest'];

  // ---------- settings ----------
  const DEFAULTS = { postizKey: '', channels: {}, pinterestBoard: '', slots: ['11:30', '15:30', '18:30', '21:00'], tz: 'Europe/London',
    startDate: '', xmasTags: true, aiLabel: true, header: 'WESTERN COLLECTION', tagline: 'Nobody Moves, Nobody Gets Hurt' };
  const settings = () => ({ ...DEFAULTS, ...rj(SETTINGS, {}) });
  const publicSettings = () => { const s = settings(); return { ...s, postizKey: s.postizKey ? '••••' + s.postizKey.slice(-4) : '', hasKey: !!s.postizKey }; };

  // ---------- jobs ----------
  const jobDir = id => path.join(JOBS, id);
  const readJob = id => rj(path.join(jobDir(id), 'job.json'), null);
  const saveJob = j => { fs.mkdirSync(jobDir(j.id), { recursive: true }); wj(path.join(jobDir(j.id), 'job.json'), j); };
  function allJobs() {
    return fs.readdirSync(JOBS).filter(okId).map(id => {
      const j = readJob(id); if (!j || j.deleted) return null;
      const st = rj(path.join(jobDir(id), 'status.json'), {}) || {};
      const render = st.rev === j.rev ? st : { state: 'queued', step: 'Waiting for the renderer' };
      return { ...j, render };
    }).filter(Boolean).sort((a, b) => b.created.localeCompare(a.created));
  }
  const nextSeq = () => { const f = path.join(VID, 'seq.json'); const n = (rj(f, { n: 0 }).n || 0) + 1; wj(f, { n }); return n; };

  // ---------- captions, hashtags and links ----------
  const BREEDS = { 'bulldawg': 'bulldog', 'bulldog': 'bulldog', 'german shepherd': 'germanshepherd', 'cane corso': 'canecorso', 'yorkshire terrier': 'yorkie',
    'yorkie': 'yorkie', 'doberman': 'doberman', 'rottweiler': 'rottweiler', 'chihuahua': 'chihuahua', 'great dane': 'greatdane', 'shih-tzu': 'shihtzu',
    'shih tzu': 'shihtzu', 'poodle': 'poodle', 'biewer': 'biewerterrier', 'pit bull': 'pitbull', 'pitbull': 'pitbull', 'french bulldawg': 'frenchie', 'husky': 'husky' };
  const HOOKS = [
    'When you want to say it… but you can\'t. Now you can. 🐾',
    'Nobody moves, nobody gets hurt. 🤠',
    'The outlaw gift they didn\'t see coming. 🎁',
    'Say it out loud. Nobody gets in trouble. 🐾',
    'Hammer, meet thumb… DAWG GAMMIT! 🔨',
    'Christmas sorted for the outlaw in your life. 🎄',
    'Fast on the paw. 🐾',
    'For the dog lover with a bit of baddie-tude. 😏',
  ];
  function tagsFor(j, s) {
    const n = j.name.toLowerCase(); const t = [];
    for (const k of Object.keys(BREEDS)) if (n.includes(k)) { t.push('#' + BREEDS[k]); break; }
    if (/hoodie/.test(n)) t.push('#hoodie'); else if (/dress/.test(n)) t.push('#tshirtdress'); else if (/tee|t-shirt|shirt/.test(n)) t.push('#graphictee');
    return { brand: ['#DawgGammit', '#K9sBarkItAllTheTime'], product: t, style: ['#streetwear', '#westernstyle', '#doglover'],
      xmas: s.xmasTags ? ['#ChristmasGifts', '#GiftIdeas', '#DogLoverGifts'] : [] };
  }
  function captionsFor(j) {
    const s = settings(); const T = tagsFor(j, s); const hook = HOOKS[(j.seq || 0) % HOOKS.length];
    const price = j.price ? ' · ' + j.price : ''; const url = j.url;
    const tk = [...T.brand, ...T.product, ...T.xmas.slice(0, 1)].slice(0, 5);
    const ig = [...T.brand, ...T.product, ...T.style, ...T.xmas].slice(0, 10);
    const fb = [...T.brand.slice(0, 1), ...T.product.slice(0, 1), ...T.xmas.slice(0, 1)];
    const yt = [...T.brand.slice(0, 1), ...T.product.slice(0, 1), '#Shorts'];
    return {
      tiktok: `${hook}\n\n${j.name} — DAWG GAMMIT™, K9's Bark It All The Time™\nGet yours at DawgGammit.com (link in bio)\n\n${tk.join(' ')}`,
      instagram: `${hook}\n\n${j.name}${price}\nDAWG GAMMIT™ — K9's Bark It All The Time™\n👉 Tap the link in bio: DawgGammit.com\n\n${ig.join(' ')}`,
      facebook: `${hook}\n\n${j.name}${price}\nDAWG GAMMIT™ — K9's Bark It All The Time™\nGet yours: ${url}\n\n${fb.join(' ')}`,
      youtubeTitle: `${j.name} | DAWG GAMMIT™ #Shorts`.slice(0, 100),
      youtube: `${hook}\n\n${j.name}${price}\nGet yours: ${url}\nMore at DawgGammit.com\n\nDAWG GAMMIT™ — K9's Bark It All The Time™\n${yt.join(' ')}`,
      pinterestTitle: `${j.name} – DAWG GAMMIT™`.slice(0, 100),
      pinterest: `${j.name}${price}. ${hook} DAWG GAMMIT™ western streetwear for dog lovers with a sense of humour — K9's Bark It All The Time™. ${s.xmasTags ? 'A Christmas gift idea for the outlaw in your life. ' : ''}${[...T.brand, ...T.product, ...T.xmas.slice(0, 2)].join(' ')}`.slice(0, 500),
    };
  }
  const ytTags = j => ['dawg gammit', 'k9s bark it all the time', 'western streetwear', 'dog lover gifts', 'christmas gift', ...tagsFor(j, settings()).product.map(t => t.slice(1))]
    .map(t => ({ value: t, label: t }));

  // ---------- schedule slots (Robert's local time, sent to Postiz in UTC) ----------
  function tzOffsetMs(utcMs, tz) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(utcMs)).filter(x => x.type !== 'literal').map(x => [x.type, +x.value]));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - utcMs;
  }
  function localToUtc(y, m, d, hh, mm, tz) { const g = Date.UTC(y, m - 1, d, hh, mm); return g - tzOffsetMs(g - tzOffsetMs(g, tz), tz); }
  function nextSlot(taken, s = settings()) {
    const slots = (s.slots || []).map(x => x.split(':').map(Number)).filter(x => x.length === 2).sort((a, b) => a[0] * 60 + a[1] - (b[0] * 60 + b[1]));
    if (!slots.length) return null;
    let base = Date.now() + 30 * 60e3;
    if (s.startDate && /^\d{4}-\d{2}-\d{2}$/.test(s.startDate)) base = Math.max(base, localToUtc(...s.startDate.split('-').map(Number), 0, 0, s.tz));
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: s.tz }).format(new Date(base)).split('-').map(Number);
    for (let day = 0; day < 120; day++) {
      const dt = new Date(Date.UTC(today[0], today[1] - 1, today[2] + day));
      for (const [hh, mm] of slots) {
        const t = localToUtc(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(), hh, mm, s.tz);
        if (t >= base && !taken.has(t)) return t;
      }
    }
    return null;
  }
  const takenSlots = (except) => new Set(allJobs().filter(j => j.id !== except && j.post && ['scheduled', 'posted', 'scheduling'].includes(j.post.state)).map(j => Date.parse(j.post.date)));

  // ---------- Postiz ----------
  async function pz(pathname, opt = {}) {
    const key = settings().postizKey; if (!key) throw new Error('Add your Postiz API key in Settings first.');
    const r = await fetch(POSTIZ + pathname, { ...opt, headers: { Authorization: key, ...(opt.body && !(opt.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(opt.headers || {}) }, signal: AbortSignal.timeout(opt.timeout || 60000) });
    const text = await r.text(); let body; try { body = JSON.parse(text); } catch (e) { body = text; }
    if (!r.ok) throw new Error('Postiz answered ' + r.status + ': ' + (typeof body === 'string' ? body : JSON.stringify(body)).slice(0, 400));
    return body;
  }
  async function pzUpload(file, name, type) {
    const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync(file)], { type }), name);
    return pz('/public/v1/upload', { method: 'POST', body: fd, timeout: 300000 });
  }
  function channelFor(identifier) {
    const id = String(identifier || '').toLowerCase();
    if (id.startsWith('tiktok')) return 'tiktok'; if (id.startsWith('instagram')) return 'instagram';
    if (id === 'facebook') return 'facebook'; if (id.startsWith('youtube')) return 'youtube'; if (id.startsWith('pinterest')) return 'pinterest';
    return null;
  }
  async function schedule(j, dateMs) {
    const s = settings(); const c = j.captions;
    const ids = Object.fromEntries(CHANNELS.map(k => [k, (s.channels || {})[k]]).filter(([, v]) => v));
    if (!Object.keys(ids).length) throw new Error('No channels are connected yet. Open Settings and press "Load my channels".');
    if (ids.pinterest && !/^\d+$/.test(s.pinterestBoard || '')) throw new Error('Choose a Pinterest board in Settings (or untick Pinterest).');
    const video = await pzUpload(path.join(jobDir(j.id), 'video.mp4'), `dawggammit-${j.slug}-${j.id}.mp4`, 'video/mp4');
    const cover = await pzUpload(path.join(jobDir(j.id), 'cover.jpg'), `dawggammit-${j.slug}-${j.id}-cover.jpg`, 'image/jpeg');
    const V = { id: video.id || crypto.randomBytes(4).toString('hex'), path: video.path };
    const C = { id: cover.id || crypto.randomBytes(4).toString('hex'), path: cover.path };
    const post = (ch, content, settingsObj, media = [V]) => ({ integration: { id: ids[ch] }, value: [{ content, image: media }], settings: settingsObj });
    const posts = [];
    if (ids.tiktok) posts.push(post('tiktok', c.tiktok, { title: j.name.slice(0, 90), privacy_level: 'PUBLIC_TO_EVERYONE', duet: true, stitch: true, comment: true,
      autoAddMusic: 'no', brand_content_toggle: false, brand_organic_toggle: true, video_made_with_ai: !!s.aiLabel, content_posting_method: 'DIRECT_POST' }));
    if (ids.instagram) posts.push(post('instagram', c.instagram, { post_type: 'post', collaborators: [] }));
    if (ids.facebook) posts.push(post('facebook', c.facebook, { post_type: 'post', title: j.name }));
    if (ids.youtube) posts.push(post('youtube', c.youtube, { title: c.youtubeTitle.slice(0, 100), type: 'public', selfDeclaredMadeForKids: 'no', tags: ytTags(j), thumbnail: C }));
    if (ids.pinterest) posts.push(post('pinterest', c.pinterest, { board: s.pinterestBoard, title: c.pinterestTitle.slice(0, 100), link: j.url }, [V, C]));
    const res = await pz('/public/v1/posts', { method: 'POST', body: JSON.stringify({ type: 'schedule', date: new Date(dateMs).toISOString(), shortLink: false, tags: [], creationMethod: 'API', posts }) });
    return { res, media: { video: V.path, cover: C.path }, channels: Object.keys(ids) };
  }
  const postIdsOf = res => (Array.isArray(res) ? res : (res && res.posts) || []).map(x => x && (x.postId || x.id)).filter(Boolean);

  // ---------- request handling ----------
  function sendFile(req, res, file, type) {
    if (!fs.existsSync(file)) return send(res, 404, 'Not found', 'text/plain');
    const size = fs.statSync(file).size; const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    const H = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (m) {
      const start = m[1] ? +m[1] : size - +m[2]; const end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
      if (start > end || start < 0) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
      res.writeHead(206, { ...H, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...H, 'Content-Length': size }); fs.createReadStream(file).pipe(res);
  }
  function readRaw(req, limit) {
    return new Promise((resolve, reject) => { let n = 0; const c = []; req.on('data', d => { n += d.length; if (n > limit) { reject(new Error('That file is too large')); req.destroy(); } else c.push(d); }); req.on('end', () => resolve(Buffer.concat(c))); req.on('error', reject); });
  }
  function library() {
    const tj = rj(path.join(LIB, 'tracks', 'tracks.json'), {}) || {};
    const tracks = fs.readdirSync(path.join(LIB, 'tracks')).filter(f => f.endsWith('.mp3')).map(f => f.slice(0, -4)).map(n => ({ name: n, label: (tj[n] || {}).label || n, drop: (tj[n] || {}).drop || 0 }));
    const posters = fs.readdirSync(path.join(LIB, 'posters')).filter(f => f.endsWith('.jpg')).map(f => f.slice(0, -4));
    const vo = fs.readdirSync(path.join(LIB, 'vo')).filter(f => f.endsWith('.wav')).map(f => f.slice(0, -4));
    return { tracks, posters, vo, status: rj(path.join(LIB, 'library-status.json'), null), pending: fs.existsSync(path.join(LIB, 'incoming.zip')) };
  }
  function shopProducts() {
    const st = getStore(); const out = [];
    for (const c of (st.published || st.draft).cols || []) for (const i of c.items || []) if (i.visible !== false) out.push({ slug: i.slug, name: i.name, price: i.price, url: i.url, collection: c.name, img: i.img, photos: [i.img, i.alt].filter(Boolean) });
    return out;
  }
  const rotate = (list, n) => list.length ? list[n % list.length] : undefined;
  // KoolTeez renamed product pages (dawg-gammittm-… became dawg-gammit-…): find the page that is really there
  const linkCache = new Map();
  async function liveLink(url) {
    if (linkCache.has(url)) return linkCache.get(url);
    const tryUrl = async u => { try { const r = await fetch(u, { headers: { 'User-Agent': 'DawgGammitSite/1.0 (+https://dawggammit.com)' }, signal: AbortSignal.timeout(15000) }); return r.status; } catch (e) { return 0; } };
    const cands = [url]; if (/gammittm/.test(url)) cands.push(url.replace('gammittm', 'gammit'));
    let out = { url, ok: null };
    for (const u of cands) { const st = await tryUrl(u); if (st === 200) { out = { url: u, ok: true }; break; } if (st === 404) out = { url, ok: false }; }
    linkCache.set(url, out); return out;
  }

  return async function handle(req, res, p) {
    if (p === '/admin/videos' && req.method === 'GET') return send(res, 200, PAGE, undefined, { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    let m = p.match(/^\/admin\/studio\/file\/([a-z0-9]+)\/(video\.mp4|cover\.jpg)$/);
    if (m && req.method === 'GET') { if (!okId(m[1])) return send(res, 404, 'Not found', 'text/plain'); return sendFile(req, res, path.join(jobDir(m[1]), m[2]), m[2].endsWith('.mp4') ? 'video/mp4' : 'image/jpeg'); }
    m = p.match(/^\/admin\/studio\/thumb\/([a-f0-9]{40}\.jpg)$/);
    if (m && req.method === 'GET') return sendFile(req, res, path.join(THUMBS, m[1]), 'image/jpeg');
    if (!p.startsWith('/admin/api/studio')) return false;

    // binary uploads first (they are not JSON)
    if (p === '/admin/api/studio/library' && req.method === 'POST') {
      const buf = await readRaw(req, 200e6);
      if (buf.slice(0, 2).toString() !== 'PK') return json(res, 400, { error: 'That is not a .zip file. Upload the library pack you were sent.' });
      fs.writeFileSync(path.join(LIB, 'incoming.zip'), buf); return json(res, 200, { ok: true, message: 'Uploaded. The renderer unpacks it within a few seconds.' });
    }
    if (p === '/admin/api/studio/track' && req.method === 'POST') {
      const u = new URL(req.url, 'http://x'); const name = (u.searchParams.get('name') || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (!name) return json(res, 400, { error: 'Give the track a name.' });
      const buf = await readRaw(req, 40e6); if (!(buf.slice(0, 3).toString() === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0))) return json(res, 400, { error: 'Upload an MP3 file.' });
      fs.writeFileSync(path.join(LIB, 'tracks', name + '.mp3'), buf);
      const tf = path.join(LIB, 'tracks', 'tracks.json'); const tj = rj(tf, {}) || {};
      tj[name] = { label: (u.searchParams.get('label') || name).slice(0, 60), drop: Math.max(0, +u.searchParams.get('drop') || 0) }; wj(tf, tj);
      return json(res, 200, { ok: true, library: library() });
    }
    if (req.method !== 'GET' && !/application\/json/.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'Expected JSON' });
    const body = req.method === 'GET' ? {} : JSON.parse((await readBody(req, 14e6)) || '{}');

    if (p === '/admin/api/studio' && req.method === 'GET') {
      const jobs = allJobs(); const s = settings();
      return json(res, 200, { jobs, settings: publicSettings(), library: library(), products: shopProducts(), nextSlot: nextSlot(takenSlots()), channels: CHANNELS,
        elevenlabs: !!process.env.ELEVENLABS_API_KEY_SET, now: Date.now(), tz: s.tz });
    }
    if (p === '/admin/api/studio/settings' && req.method === 'PUT') {
      const s = settings(); const b = body;
      if (typeof b.postizKey === 'string' && b.postizKey && !b.postizKey.startsWith('••••')) s.postizKey = b.postizKey.trim().slice(0, 200);
      if (b.clearKey) s.postizKey = '';
      if (b.channels && typeof b.channels === 'object') s.channels = Object.fromEntries(CHANNELS.map(k => [k, String(b.channels[k] || '').slice(0, 80)]).filter(([, v]) => v));
      if ('pinterestBoard' in b) s.pinterestBoard = String(b.pinterestBoard || '').replace(/\D/g, '').slice(0, 40);
      if (Array.isArray(b.slots)) s.slots = b.slots.map(String).filter(x => /^([01]\d|2[0-3]):[0-5]\d$/.test(x)).slice(0, 12);
      if ('startDate' in b) s.startDate = /^\d{4}-\d{2}-\d{2}$/.test(b.startDate || '') ? b.startDate : '';
      for (const k of ['xmasTags', 'aiLabel']) if (k in b) s[k] = !!b[k];
      for (const k of ['header', 'tagline']) if (typeof b[k] === 'string' && b[k].trim()) s[k] = b[k].trim().slice(0, 60);
      wj(SETTINGS, s); return json(res, 200, { settings: publicSettings(), nextSlot: nextSlot(takenSlots()) });
    }
    if (p === '/admin/api/studio/postiz/channels' && req.method === 'GET') {
      const list = await pz('/public/v1/integrations');
      return json(res, 200, { channels: (Array.isArray(list) ? list : []).map(i => ({ id: i.id, name: i.name, identifier: i.identifier, picture: i.picture, disabled: i.disabled, kind: channelFor(i.identifier) })) });
    }
    if (p === '/admin/api/studio/postiz/boards' && req.method === 'POST') {
      const out = await pz('/public/v1/integration-trigger/' + encodeURIComponent(String(body.id || '')), { method: 'POST', body: JSON.stringify({ methodName: 'boards', data: {} }) });
      return json(res, 200, { boards: (out && out.output) || [] });
    }
    if (p === '/admin/api/studio/thumb' && req.method === 'POST') {
      const mm = String(body.dataUrl || '').match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
      if (!mm) return json(res, 400, { error: 'Upload a JPG, PNG or WebP image.' });
      const buf = Buffer.from(mm[2], 'base64'); const name = crypto.createHash('sha1').update(buf).digest('hex') + '.jpg';
      fs.writeFileSync(path.join(THUMBS, name), buf);           // the renderer converts any of the three formats
      return json(res, 200, { thumb: name });
    }
    if (p === '/admin/api/studio/create' && req.method === 'POST') {
      const lib = library(); const s = settings();
      const per = Math.max(1, Math.min(6, +body.perProduct || 1));
      const voices = body.voice && body.voice !== 'rotate' ? [body.voice] : ['andray', 'cowboy', 'andray', 'cowgirl'];
      const trackList = body.track && body.track !== 'rotate' ? [body.track] : lib.tracks.map(t => t.name);
      const bgList = body.background && body.background !== 'rotate' ? [body.background] : (lib.posters.length ? lib.posters : ['blank-parchment']);
      const shop = shopProducts(); const items = []; const errors = [];
      for (const it of (Array.isArray(body.items) ? body.items : []).slice(0, 60)) {
        let prod = it.slug && shop.find(x => x.slug === it.slug);
        if (!prod && it.url) {
          const mm2 = String(it.url).match(/koolteez\.com\/(?:[a-z]{2}-[a-z]{3}\/)?products\/([a-z0-9-]+)/i);
          if (!mm2) { errors.push(it.url + ': not a KoolTeez product link'); continue; }
          prod = shop.find(x => x.slug === mm2[1].toLowerCase());
          if (!prod) { try { const r = await readProduct(mm2[1].toLowerCase()); prod = { slug: r.slug, name: r.name, price: r.price, url: r.url, collection: '', photos: [r.img, r.alt, r.photo].filter(Boolean) }; } catch (e) { errors.push(it.url + ': ' + e.message); continue; } }
        }
        if (prod) { const L = await liveLink(prod.url); items.push({ ...prod, url: L.url, slug: (L.url.match(/products\/([a-z0-9-]+)/) || [])[1] || prod.slug, linkDead: L.ok === false }); }
      }
      const made = [];
      for (const prod of items) for (let k = 0; k < per; k++) {
        const seq = nextSeq();
        const j = { id: crypto.randomBytes(6).toString('hex'), seq, rev: 1, created: new Date().toISOString(), slug: prod.slug, url: prod.url, name: prod.name,
          price: prod.price || '', showPrice: body.showPrice !== false, collection: s.header, tagline: s.tagline, photos: prod.photos || [],
          linkDead: !!prod.linkDead, voice: rotate(voices, seq), track: rotate(trackList, seq), background: rotate(bgList, Math.floor(seq / 2)), length: 'full',
          thumb: body.thumb && /^[a-f0-9]{40}\.jpg$/.test(body.thumb) ? body.thumb : '', autoThumb: body.autoThumb !== false, post: { state: 'review' } };
        j.captions = captionsFor(j); saveJob(j); made.push(j.id);
      }
      return json(res, 200, { made: made.length, errors });
    }
    if (p === '/admin/api/studio/job' && req.method === 'POST') {
      const j = readJob(body.id); if (!okId(body.id) || !j || j.deleted) return json(res, 404, { error: 'That video is no longer there.' });
      if (j.post && ['scheduled', 'posted', 'scheduling'].includes(j.post.state)) return json(res, 409, { error: 'This video is already scheduled. Unschedule it first to change it.' });
      const P = body.patch || {}; let rerender = false;
      if (P.captions && typeof P.captions === 'object') for (const k of Object.keys(j.captions)) if (typeof P.captions[k] === 'string') j.captions[k] = P.captions[k].slice(0, k.endsWith('Title') ? 100 : 2200);
      for (const k of ['voice', 'track', 'background', 'front', 'back', 'thumb', 'thumbUrl', 'name', 'price']) if (typeof P[k] === 'string' && P[k] !== j[k]) { j[k] = P[k].slice(0, 2000); rerender = true; }
      for (const k of ['showPrice', 'autoThumb']) if (typeof P[k] === 'boolean' && P[k] !== j[k]) { j[k] = P[k]; rerender = true; }
      if (typeof P.thumb === 'string' && P.thumb) j.thumbUrl = '';            // an upload replaces a KoolTeez cover
      if (P.resetCaptions) j.captions = captionsFor(j);
      if (rerender || body.rerender) { j.rev = (j.rev || 1) + 1; j.post = { state: 'review' }; }
      saveJob(j); return json(res, 200, { ok: true, rerender: rerender || !!body.rerender });
    }
    if (p === '/admin/api/studio/delete' && req.method === 'POST') {
      const j = readJob(body.id); if (!okId(body.id) || !j) return json(res, 404, { error: 'That video is no longer there.' });
      if (j.post && ['scheduled', 'scheduling'].includes(j.post.state)) return json(res, 409, { error: 'Unschedule this video before deleting it.' });
      j.deleted = true; saveJob(j); for (const f of ['video.mp4', 'cover.jpg']) fs.rmSync(path.join(jobDir(j.id), f), { force: true }); fs.rmSync(path.join(jobDir(j.id), 'work'), { recursive: true, force: true });
      return json(res, 200, { ok: true });
    }
    if (p === '/admin/api/studio/approve' && req.method === 'POST') {
      const j = readJob(body.id); if (!okId(body.id) || !j || j.deleted) return json(res, 404, { error: 'That video is no longer there.' });
      const st = rj(path.join(jobDir(j.id), 'status.json'), {}) || {};
      if (st.rev !== j.rev || st.state !== 'ready') return json(res, 409, { error: 'This video is not rendered yet.' });
      if (j.post && ['scheduled', 'scheduling', 'posted'].includes(j.post.state)) return json(res, 409, { error: 'This video is already scheduled.' });
      if (j.linkDead) { const L = await liveLink(j.url); if (L.ok) { j.url = L.url; j.linkDead = false; j.captions = captionsFor(j); saveJob(j); } else return json(res, 400, { error: 'The KoolTeez page for this product was not found, so the buy link would be dead. Check the product on KoolTeez, then make the video again from a working link.' }); }
      let date = body.date ? Date.parse(body.date) : nextSlot(takenSlots(j.id));
      if (!date || isNaN(date)) return json(res, 400, { error: 'No free posting time found. Check the posting times in Settings.' });
      if (date < Date.now() + 5 * 60e3) return json(res, 400, { error: 'Choose a time at least 5 minutes from now.' });
      j.post = { state: 'scheduling', date: new Date(date).toISOString() }; saveJob(j);
      try {
        const r = await schedule(j, date);
        j.post = { state: 'scheduled', date: new Date(date).toISOString(), at: new Date().toISOString(), channels: r.channels, ids: postIdsOf(r.res), raw: r.res, media: r.media };
        saveJob(j); return json(res, 200, { ok: true, post: j.post });
      } catch (e) {
        j.post = { state: 'review', error: e.message, triedAt: new Date().toISOString() }; saveJob(j);
        return json(res, 400, { error: e.message });
      }
    }
    if (p === '/admin/api/studio/unschedule' && req.method === 'POST') {
      const j = readJob(body.id); if (!okId(body.id) || !j) return json(res, 404, { error: 'That video is no longer there.' });
      if (!j.post || j.post.state !== 'scheduled') return json(res, 409, { error: 'This video is not scheduled.' });
      const errs = [];
      for (const id of j.post.ids || []) { try { await pz('/public/v1/posts/' + encodeURIComponent(id), { method: 'DELETE' }); } catch (e) { errs.push(e.message); } }
      if (errs.length && errs.length === (j.post.ids || []).length) return json(res, 400, { error: 'Postiz did not remove it: ' + errs[0] });
      j.post = { state: 'review' }; saveJob(j); return json(res, 200, { ok: true });
    }
    if (p === '/admin/api/studio/check' && req.method === 'POST') {
      // read back what Postiz did with each scheduled video
      const jobs = allJobs().filter(j => j.post && j.post.state === 'scheduled' && (j.post.ids || []).length);
      if (!jobs.length) return json(res, 200, { checked: 0 });
      const times = jobs.map(j => Date.parse(j.post.date));
      const list = await pz('/public/v1/posts?' + new URLSearchParams({ startDate: new Date(Math.min(...times) - 864e5).toISOString(), endDate: new Date(Math.max(...times) + 864e5).toISOString() }));
      const posts = (list && list.posts) || (Array.isArray(list) ? list : []);
      let changed = 0;
      for (const j of jobs) {
        const mine = posts.filter(x => (j.post.ids || []).includes(x.id));
        if (!mine.length) continue;
        j.post.channelState = mine.map(x => ({ id: x.id, channel: channelFor((x.integration || {}).providerIdentifier) || (x.integration || {}).name, state: x.state || x.status, url: x.releaseURL || null, error: x.error || null }));
        if (mine.every(x => /publish|done|sent/i.test(x.state || x.status || ''))) j.post.state = 'posted';
        saveJob(readJob(j.id) && { ...readJob(j.id), post: j.post }); changed++;
      }
      return json(res, 200, { checked: changed });
    }
    return json(res, 404, { error: 'Not found' });
  };
};
