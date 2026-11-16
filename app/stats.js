// DAWG GAMMIT key numbers, kept on this server: no cookies, no outside service, no IP addresses stored.
// Counts: site visits, visitors (a daily one-way hash, thrown away the next day), where visitors came from,
// Buy now clicks per product, and clicks on the links in social posts (dawggammit.com/go/<video>/<platform>).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = function stats({ DATA, SECRET, send, readBody, clientIp }) {
  const FILE = path.join(DATA, 'stats.json');
  const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return { days: {}, seen: { date: '', ids: [] } }; } };
  let S = load(); let seen = new Set(S.seen && S.seen.ids || []); let timer = null;
  const save = () => { clearTimeout(timer); timer = setTimeout(() => {
    S.seen = { date: S.seen.date, ids: [...seen] }; const t = FILE + '.tmp'; fs.writeFileSync(t, JSON.stringify(S)); fs.renameSync(t, FILE); }, 3000); };
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
  function day() {
    const d = today();
    if (S.seen.date !== d) { S.seen = { date: d, ids: [] }; seen = new Set(); }
    return S.days[d] || (S.days[d] = { views: 0, visitors: 0, src: {}, buy: {}, go: {}, goJob: {} });
  }
  const bump = (o, k, n = 1) => { k = String(k).slice(0, 80); o[k] = (o[k] || 0) + n; };
  const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|meta-external|pinterest\/|bingpreview|headless|python|curl|wget|httpclient|axios|node-fetch|go-http|lighthouse|monitor/i;
  const isBot = req => BOT.test(req.headers['user-agent'] || '') || !(req.headers['user-agent'] || '').length;
  const recent = new Map();   // ip -> hits in the last hour, to ignore floods
  function tooMany(ip) { const now = Date.now(), a = (recent.get(ip) || []).filter(t => now - t < 3600e3); a.push(now); recent.set(ip, a); return a.length > 300; }

  const PLATFORMS = ['tiktok', 'instagram', 'facebook', 'youtube', 'pinterest'];
  function sourceOf(from, ref, host) {
    from = String(from || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30);
    if (from) return from;
    let h = ''; try { h = new URL(ref).hostname.replace(/^www\.|^m\.|^l\./, ''); } catch (e) {}
    if (!h) return 'direct';
    if (host && h === String(host).replace(/^www\./, '').split(':')[0]) return null;           // moving around the site itself
    if (/tiktok/.test(h)) return 'tiktok'; if (/pinterest|pin\.it/.test(h)) return 'pinterest'; if (/youtube|youtu\.be/.test(h)) return 'youtube';
    if (/instagram/.test(h)) return 'instagram'; if (/facebook|fb\.com|fb\.me/.test(h)) return 'facebook'; if (/koolteez/.test(h)) return 'koolteez';
    if (/google|bing|duckduckgo|yahoo|ecosia|brave/.test(h)) return 'search engines';
    return h.slice(0, 60);
  }

  // POST /api/hit  {t: 'view' | 'buy' | 'look', s: product slug, from, ref}  (sent by the site's own page)
  async function hit(req, res) {
    send(res, 204, '', 'text/plain');
    try {
      if (isBot(req)) return; const ip = clientIp(req); if (tooMany(ip)) return;
      const o = req.headers.origin; if (o && new URL(o).host !== req.headers.host) return;
      const b = JSON.parse(await readBody(req, 4000)); const D = day();
      if (b.t === 'view') {
        D.views++;
        const id = crypto.createHmac('sha256', SECRET).update(S.seen.date + '|' + ip + '|' + (req.headers['user-agent'] || '')).digest('hex').slice(0, 16);
        if (!seen.has(id)) { seen.add(id); D.visitors++; const src = sourceOf(b.from, b.ref, req.headers.host); bump(D.src, src || 'direct'); }
      } else if (b.t === 'buy' || b.t === 'look') bump(D.buy, String(b.s || 'unknown').replace(/[^a-z0-9-]/g, ''));
      save();
    } catch (e) {}
  }

  // GET /go/<video>/<platform>: count, then forward to the product on KoolTeez
  function go(req, res, jobInfo, id, platform) {
    const j = jobInfo(id); let to = (j && j.url) || 'https://dawggammit.com/';
    to = to.replace('/products/dawg-gammittm-', '/products/dawg-gammit-');
    if (!/^https:\/\/(koolteez\.com|dawggammit\.com)\//.test(to)) to = 'https://dawggammit.com/';
    if (j && PLATFORMS.includes(platform) && !isBot(req) && !tooMany(clientIp(req))) {
      const D = day(); bump(D.go, platform); bump(D.goJob, id); save();
    }
    res.writeHead(302, { Location: to, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer-when-downgrade' }); res.end();
  }

  // ---------- the admin page ----------
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const LABEL = { tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', pinterest: 'Pinterest', direct: 'Typed in or bookmarked', koolteez: 'KoolTeez' };
  function page(range, names, jobInfo) {
    const n = range === 'all' ? 3650 : +range || 7;
    const dates = Object.keys(S.days).sort().reverse(); const cut = new Date(Date.now() - (n - 1) * 864e5); const cutS = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(cut);
    const use = dates.filter(d => d >= cutS);
    const T = { views: 0, visitors: 0, src: {}, buy: {}, go: {}, goJob: {} };
    use.forEach(d => { const D = S.days[d]; T.views += D.views; T.visitors += D.visitors;
      for (const k of ['src', 'buy', 'go', 'goJob']) for (const [a, v] of Object.entries(D[k] || {})) T[k][a] = (T[k][a] || 0) + v; });
    const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
    const rows = (o, label, empty) => { const e = Object.entries(o).sort((a, b) => b[1] - a[1]);
      return e.length ? e.map(([k, v]) => `<tr><td>${esc(label(k))}</td><td class="n">${v}</td></tr>`).join('') : `<tr><td colspan="2" class="none">${empty}</td></tr>`; };
    const card = (big, what, note) => `<div class="card"><b>${big}</b><span>${what}</span><em>${note}</em></div>`;
    const tabs = [['1', 'Today'], ['7', '7 days'], ['30', '30 days'], ['all', 'All time']].map(([v, l]) => `<a href="?d=${v}" class="${String(range || '7') === v ? 'on' : ''}">${l}</a>`).join('');
    const daily = use.slice(0, 31).map(d => { const D = S.days[d]; return `<tr><td>${esc(new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }))}</td><td class="n">${D.visitors}</td><td class="n">${D.views}</td><td class="n">${sum(D.buy || {})}</td><td class="n">${sum(D.go || {})}</td></tr>`; }).join('')
      || '<tr><td colspan="5" class="none">Nothing counted yet. Numbers start with the first visit after this was switched on.</td></tr>';
    return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>DAWG GAMMIT · Key numbers</title>
<style>
:root{--bg:#f6f1e7;--card:#fffdf8;--ink:#2b1a0e;--mute:#7a6650;--line:#e4d8c4;--brand:#9a4a17}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;padding:16px;border-bottom:1px solid var(--line);background:var(--card)}
header b{font:800 1.3rem Georgia,serif;color:var(--brand);letter-spacing:.02em}header nav{display:flex;gap:8px;flex-wrap:wrap}
a.btn,header nav a{padding:8px 14px;border:1px solid var(--line);border-radius:6px;color:var(--ink);text-decoration:none;font-weight:600;background:#fff}
main{max-width:1000px;margin:0 auto;padding:16px}.tabs{display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 16px}.tabs a{padding:6px 12px;border-radius:20px;border:1px solid var(--line);text-decoration:none;color:var(--ink)}.tabs a.on{background:var(--brand);color:#fff;border-color:var(--brand)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:20px}.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px 16px;display:flex;flex-direction:column}
.card b{font-size:2rem;line-height:1.1}.card span{font-weight:700}.card em{font-style:normal;color:var(--mute);font-size:.88rem}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}section{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px 16px;margin-bottom:16px}
h2{font-size:1.05rem;margin:0 0 4px}p.how{color:var(--mute);font-size:.88rem;margin:0 0 8px}table{width:100%;border-collapse:collapse}td,th{padding:6px 4px;border-top:1px solid var(--line);text-align:left;font-size:.95rem}th{color:var(--mute);font-weight:600;font-size:.82rem;border-top:0}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}td.none{color:var(--mute)}
</style></head><body>
<header><b>DAWG GAMMIT™ <small style="font:600 .8rem system-ui;color:var(--mute);letter-spacing:.1em">KEY NUMBERS</small></b><nav><a href="/admin">Shop admin</a><a href="/admin/videos">Videos</a></nav></header>
<main><div class="tabs">${tabs}</div>
<div class="cards">
${card(T.visitors, 'Visitors', 'Different people on DawgGammit.com')}
${card(T.views, 'Page views', 'Every time the home page was opened')}
${card(sum(T.buy), 'Buy now clicks', 'Clicks from DawgGammit.com to a product on KoolTeez')}
${card(sum(T.go), 'Clicks on post links', 'Links in YouTube, Pinterest and Facebook posts, straight to KoolTeez')}
</div>
<div class="grid">
<section><h2>Where visitors came from</h2><p class="how">TikTok visits are counted when your TikTok bio link is <b>dawggammit.com/?from=tiktok</b>.</p><table><tr><th>Source</th><th class="n">Visitors</th></tr>${rows(T.src, k => LABEL[k] || k, 'No visitors yet.')}</table></section>
<section><h2>Buy now clicks by product</h2><p class="how">From the shop and lookbook on DawgGammit.com.</p><table><tr><th>Product</th><th class="n">Clicks</th></tr>${rows(T.buy, k => names[k] || k, 'No clicks yet.')}</table></section>
<section><h2>Post link clicks by platform</h2><p class="how">People who tapped the link in a post and went to KoolTeez.</p><table><tr><th>Platform</th><th class="n">Clicks</th></tr>${rows(T.go, k => LABEL[k] || k, 'No clicks yet.')}</table></section>
<section><h2>Post link clicks by video</h2><p class="how">Your best videos at sending people to the shop.</p><table><tr><th>Video</th><th class="n">Clicks</th></tr>${rows(T.goJob, k => { const j = jobInfo(k); return j ? j.name + ' (' + k.slice(-4) + ')' : 'Deleted video'; }, 'No clicks yet.')}</table></section>
</div>
<section><h2>Day by day</h2><table><tr><th>Day</th><th class="n">Visitors</th><th class="n">Views</th><th class="n">Buy now</th><th class="n">Post links</th></tr>${daily}</table></section>
<p class="how">Counted on your own server. No cookies, and no IP addresses are kept. Robots and link checkers are left out. Views, likes and follows on each platform are in TikTok, YouTube Studio, Pinterest Analytics or Postiz; sales are in Fourthwall.</p>
</main></body></html>`;
  }
  return { hit, go, page };
};
