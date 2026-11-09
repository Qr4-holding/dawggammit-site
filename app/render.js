// Builds the public DAWG GAMMIT page from the shop data (collections, products, lookbook).
const fs = require('fs');
const path = require('path');

const TEMPLATE = fs.readFileSync(path.join(__dirname, 'site-template.html'), 'utf8');

// Product lines, in menu order. A line shows on the site only when it has a visible product.
const LINES = ['Hoodies', 'Sweatshirts', 'T-shirt Dresses', 'Tees & Tops', 'Hats', 'Mugs', 'Accessories'];
const LRX = [/hoodie/i, /sweatshirt|crewneck/i, /dress/i, /\btee\b|t-shirt|tank|crop top|\btop\b/i, /\bhat\b|\bcap\b|beanie/i, /\bmug/i, /./];

function lineOf(name) {
  for (let i = 0; i < LRX.length; i++) if (LRX[i].test(name || '')) return LINES[i];
  return 'Accessories';
}
const slugify = s => String(s).toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'line';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => (/^(https:\/\/|\/media\/|\/static\/)/.test(u || '') ? u : '');

function lineOrder(extra) {
  const custom = (extra || []).filter(l => LINES.indexOf(l) < 0).sort();
  return LINES.slice(0, -1).concat(custom, ['Accessories']);
}

function render(state, opts = {}) {
  const cols = (state.cols || []).map(c => ({ ...c, items: (c.items || []).filter(i => i.visible !== false) }))
    .filter(c => c.items.length);
  const items = [];
  cols.forEach(c => c.items.forEach(i => items.push({ ...i, col: c.id, colName: c.name, line: i.line || lineOf(i.name) })));
  const order = lineOrder(state.extraLines);
  const used = order.filter(l => items.some(i => i.line === l));
  items.sort((a, b) => order.indexOf(a.line) - order.indexOf(b.line));   // stable: keeps the admin's order inside each line
  const bySlug = {};
  items.forEach(i => { if (!bySlug[i.slug]) bySlug[i.slug] = i; });

  const look = (state.look || []).map(l => ({ l, p: bySlug[l.slug] })).filter(x => x.p && safeUrl(x.l.src)).slice(0, 12);
  const lookHtml = look.map(({ l, p }) => `<a class="look" href="${esc(p.url)}" target="_blank" rel="noopener">
  <img src="${esc(safeUrl(l.src))}" alt="Model wearing the ${esc(p.name)}" loading="lazy" />
  <span class="look-cap"><span class="look-name">${esc(p.name)}</span><span class="look-buy">${esc(p.price)} · Buy now ↗</span></span></a>`).join('\n');

  const shopHtml = items.map(it => {
    const alt = safeUrl(it.alt) ? `<img class="alt" src="${esc(it.alt)}" alt="" loading="lazy" />` : '';
    return `<article class="card" data-col="${esc(it.col)}" data-line="${slugify(it.line)}">
  <a class="card-img" href="${esc(it.url)}" target="_blank" rel="noopener" aria-label="Buy the ${esc(it.name)}">
    <img class="main" src="${esc(safeUrl(it.img))}" alt="${esc(it.name)}" loading="lazy" />${alt}
    <span class="tag">${esc(it.colName)}</span></a>
  <div class="card-body"><h3>${esc(it.name)}</h3>
    <div class="card-row"><span class="price">${esc(it.price)}</span>
    <a class="buy" href="${esc(it.url)}" target="_blank" rel="noopener">Buy now ↗</a></div></div>
</article>`;
  }).join('\n');

  const colTabs = `<button class="tab" data-g="col" data-v="all" aria-pressed="true">All ${items.length}</button>` +
    cols.map(c => `<button class="tab" data-g="col" data-v="${esc(c.id)}" aria-pressed="false">${esc(c.name)} ${c.items.length}</button>`).join('');
  const lineTabs = `<button class="tab" data-g="line" data-v="all" aria-pressed="true">All</button>` +
    used.map(l => `<button class="tab" data-g="line" data-v="${slugify(l)}" aria-pressed="false">${esc(l)} ${items.filter(i => i.line === l).length}</button>`).join('');
  const navLines = used.map(l => `<a class="hide-md" href="#${slugify(l)}">${esc(l)}</a>`).join('');
  const ogItem = items.find(i => i.photo) || items[0] || {};
  const banner = opts.preview
    ? '<div style="position:sticky;top:0;z-index:50;background:#b0451c;color:#fff;font:600 14px/1.4 system-ui,sans-serif;text-align:center;padding:10px">Draft preview: this is what the site will look like after you press Publish. Visitors still see the published version.</div>'
    : '';

  const fill = {
    '{{LOOK}}': lookHtml, '{{SHOP}}': shopHtml, '{{COL_TABS}}': colTabs, '{{LINE_TABS}}': lineTabs,
    '{{NAV_LINES}}': navLines, '{{LINE_IDS}}': JSON.stringify(used.map(slugify)).replace(/</g, '\\u003c'),
    '{{OG_IMAGE}}': esc(safeUrl(ogItem.photo || ogItem.img) || ''), '{{PREVIEW_BANNER}}': banner,
    '{{ROBOTS}}': opts.preview ? '<meta name="robots" content="noindex">' : '',
  };
  return TEMPLATE.replace(/\{\{[A-Z_]+\}\}/g, k => (k in fill ? fill[k] : k));
}

module.exports = { render, lineOf, LINES };
