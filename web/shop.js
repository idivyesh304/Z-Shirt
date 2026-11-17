/* Z-SHIRTS STORE
 * Home, smart search, listing with filters + sort, product page (gallery, size finder, pincode ETA,
 * offers, reviews), wishlist, compare, bag, checkout (saved addresses, prepaid offer, COD), Razorpay,
 * Google account, Z-Club points, order tracking, exchange / return, reviews.
 * Prices, stock, coupons and totals are always worked out again by the database.
 */
(() => {
  'use strict';
  const cfg = window.ZS_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const main = $('main');

  // ================================================================ helpers
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inr = (n) => {
    const v = Number(n) || 0;
    const d = Number.isInteger(Math.round(v * 100) / 100) ? 0 : 2;
    return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* private mode */ } },
  };
  const session = {
    get(k, d) { try { const v = sessionStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* */ } },
  };
  let toastTimer;
  function toast(msg, err = false, html = '') {
    const el = $('toast');
    el.innerHTML = `<span>${esc(msg)}</span>${html}`;
    el.className = 'show' + (err ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = ''; }, err ? 5000 : 2800);
  }
  const errText = (e) => (e && (e.message || e.error_description || e.error)) || String(e);
  const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'];
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const bump = (el) => { if (!el) return; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); };
  const dayName = (d) => new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  const dateOf = (d) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const dropDate = (d) => new Date(d).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  function countdown(to) {
    let s = Math.max(0, Math.floor((new Date(to) - Date.now()) / 1000));
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    const pad = (n) => String(n).padStart(2, '0');
    return `${d ? d + 'd ' : ''}${pad(h)}:${pad(m)}:${pad(s)}`;
  }
  const I = {
    heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-9.3-9A5 5 0 0 1 12 6a5 5 0 0 1 9.3 5C19 15.6 12 20 12 20z"/></svg>',
    bag: '<svg viewBox="0 0 24 24"><path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"/></svg>',
    filter: '<svg viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>',
    truck: '<svg viewBox="0 0 24 24"><path d="M2 7h11v9H2zM13 10h4l4 4v2h-8"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>',
    cash: '<svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/></svg>',
    swap: '<svg viewBox="0 0 24 24"><path d="M4 8h13l-3-3M20 16H7l3 3"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
    tag: '<svg viewBox="0 0 24 24"><path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/></svg>',
    share: '<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>',
    cmp: '<svg viewBox="0 0 24 24"><path d="M9 4v16M15 4v16M4 8h5M15 16h5"/></svg>',
    fabric: '<svg viewBox="0 0 24 24"><path d="M8 3l-5 3 2 4 2-1v12h10V9l2 1 2-4-5-3a4 4 0 0 1-8 0z"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>',
    lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    ruler: '<svg viewBox="0 0 24 24"><path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/></svg>',
    gift: '<svg viewBox="0 0 24 24"><rect x="3" y="8" width="18" height="13" rx="1"/><path d="M12 8v13M3 12h18M12 8S10 3 7.5 4.5 9 8 12 8zM12 8s2-5 4.5-3.5S15 8 12 8z"/></svg>',
  };
  const googleIcon = () => '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3A12 12 0 1 1 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 1 0 44 24c0-1.2-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8A12 12 0 0 1 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 0 0 6.3 14.7z"/><path fill="#4CAF50" d="M24 44a20 20 0 0 0 13.4-5.2l-6.2-5.2A12 12 0 0 1 12.7 28l-6.5 5A20 20 0 0 0 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.3-.4-3.5z"/></svg>';

  // a drawn tee when a product has no photo yet
  function tee(hex = '#111', label = 'Z-SHIRTS tee') {
    const c = /^#[0-9a-f]{6}$/i.test(hex || '') ? hex : '#111111';
    const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
    const light = (r * 299 + g * 587 + b * 114) / 1000 > 150;
    const stroke = light ? 'rgba(0,0,0,.14)' : 'rgba(255,255,255,.14)';
    const mark = light ? '#0e0e10' : '#c6ff00';
    return `<svg viewBox="0 0 400 500" role="img" aria-label="${esc(label)}" style="stroke:none">
      <rect width="400" height="500" fill="${light ? '#e9e9e3' : '#f1f1ec'}"/>
      <ellipse cx="200" cy="452" rx="130" ry="14" fill="rgba(0,0,0,.07)"/>
      <path d="M128 92 L170 74 Q200 98 230 74 L272 92 L352 140 L322 214 L290 198 L292 432 Q200 446 108 432 L110 198 L78 214 L48 140 Z"
        fill="${c}" stroke="${stroke}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M170 74 Q200 112 230 74" fill="none" stroke="${stroke}" stroke-width="5"/>
      <path d="M182 170h36v7l-26 26h26v8h-36v-7l26-26h-26z" fill="${mark}"/>
    </svg>`;
  }
  const firstHex = (p) => (p.variants[0] && p.variants[0].hex) || '#111111';
  const imgOf = (p, i = 0, hex) => (p.images && p.images[i]
    ? `<img src="${esc(p.images[i])}" alt="${esc(p.name)}${i ? ` photo ${i + 1}` : ''}" loading="lazy"${i ? ' class="alt"' : ''}>`
    : i ? '' : tee(hex || firstHex(p), p.name));

  // ================================================================ setup
  if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes('YOUR-PROJECT')) {
    main.innerHTML = '<div class="wrap empty-box"><h3>Shop is being set up</h3><p>Add the Supabase details in config.js.</p></div>';
    return;
  }
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce', storageKey: 'zs-shop-auth' },
  });

  const state = {
    ready: false,
    products: [], bundles: [], offers: [], also: [],
    settings: { shipping_fee: 0, free_shipping_above: 0, cod_enabled: 1, return_window_days: 15, prepaid_discount_pct: 0, prepaid_discount_max: 0, cod_fee: 0, loyalty_points_per_100: 5 },
    bag: store.get('zs_bag', []),
    wish: new Set(store.get('zs_wish', [])),
    cmp: store.get('zs_cmp', []),
    viewed: store.get('zs_viewed', []),
    searches: store.get('zs_searches', []),
    mySize: store.get('zs_my_size', null),
    user: null, account: null,
    reviews: {},
  };
  const byId = (id) => state.products.find((p) => p.id === Number(id));
  const bySlug = (s) => state.products.find((p) => p.slug === s);
  const variantOf = (vid) => { for (const p of state.products) { const v = p.variants.find((x) => x.id === vid); if (v) return { p, v }; } return null; };
  const available = (p) => p.is_preorder || p.total_stock > 0;
  const canBuy = (p, v) => p.is_preorder || v.stock > 0;
  const coloursOf = (p) => [...new Map(p.variants.map((v) => [v.colour, v.hex])).entries()];
  const isNew = (p) => p.published_at && (Date.now() - new Date(p.published_at)) / 864e5 <= 30;
  const S = () => state.settings;

  // marketing source + coupon from the link: ?utm_source=instagram&coupon=ROHAN10
  (() => {
    const q = new URLSearchParams(location.search);
    const attr = session.get('zs_attr', {});
    ['utm_source', 'utm_campaign'].forEach((k) => { if (q.get(k)) attr[k] = q.get(k).slice(0, 80); });
    const code = q.get('coupon') || q.get('code');
    if (code) { attr.coupon = code.toUpperCase().slice(0, 20); store.set('zs_coupon', attr.coupon); }
    session.set('zs_attr', attr);
  })();

  // ================================================================ sheet + zoom
  let lastFocus;
  function openSheet(html, opts = {}) {
    lastFocus = $('sheet').hidden ? document.activeElement : lastFocus;
    $('sheetBody').innerHTML = html;
    $('sheet').className = 'sheet' + (opts.side ? ' side' : '');
    $('sheet').setAttribute('aria-label', opts.title || 'Panel');
    $('sheet').hidden = false; $('scrim').hidden = false;
    document.body.style.overflow = 'hidden';
    $('sheet').scrollTop = 0;
    return $('sheetBody');
  }
  function closeSheet() {
    if ($('sheet').hidden) return;
    $('sheet').hidden = true; $('scrim').hidden = true;
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  $('sheetClose').onclick = closeSheet;
  $('scrim').onclick = closeSheet;
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (document.querySelector('.zoom')) document.querySelector('.zoom').remove();
    else if (!$('searchOv').hidden) closeSearch();
    else closeSheet();
  });
  function zoom(html) {
    const z = document.createElement('div');
    z.className = 'zoom';
    z.innerHTML = `${html}<button aria-label="Close">${I.x}</button>`;
    z.querySelector('button').onclick = () => z.remove();
    document.body.appendChild(z);
  }

  // ================================================================ data
  async function load() {
    const [cat, set, bun, off, also] = await Promise.all([
      sb.from('catalog').select('*'),
      sb.from('public_settings').select('*'),
      sb.from('bundles').select('id, name, qty, price, product_ids').eq('active', true),
      sb.from('public_offers').select('*'),
      sb.from('also_bought').select('*'),
    ]);
    if (cat.error) throw cat.error;
    state.products = (cat.data || []).map((p) => ({ ...p, variants: p.variants || [], rating: Number(p.rating) || 0, rating_count: Number(p.rating_count) || 0 }));
    (set.data || []).forEach((r) => { const n = Number(r.value); state.settings[r.key] = Number.isNaN(n) ? r.value : n; });
    state.bundles = bun.data || [];
    state.offers = off.error ? [] : (off.data || []);
    state.also = also.error ? [] : (also.data || []);
    state.bag = state.bag.filter((b) => variantOf(b.variant_id));
    saveBag(true);
    state.ready = true;
  }

  // ================================================================ search
  const SYN = { tshirt: 'tee', tshirts: 'tee', 't-shirt': 'tee', 't-shirts': 'tee', tees: 'tee', shirt: 'tee', oversize: 'oversized', baggy: 'oversized', loose: 'oversized',
    kala: 'black', kaala: 'black', safed: 'white', grey: 'gray', blk: 'black', wht: 'white', cheap: 'under', sale: 'sale', offer: 'sale' };
  const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9₹ ]+/g, ' ').split(/\s+/).filter(Boolean);
  function lev(a, b) {
    if (Math.abs(a.length - b.length) > 1) return 2;
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return dp[a.length][b.length];
  }
  function indexOf(p) {
    if (p._ix) return p._ix;
    const name = words(p.name);
    const bag = new Set([...name, ...words(p.type), ...words(p.category), ...words(p.fabric), ...(p.tags || []).flatMap(words), ...words(p.drop_name),
      ...p.variants.flatMap((v) => words(v.colour)), 'tee', p.gsm ? `${p.gsm}gsm` : '']);
    p._ix = { all: [...bag].filter(Boolean), name, initials: name.map((w) => w[0]).join('') };
    return p._ix;
  }
  function searchScore(p, q) {
    const tokens = words(q).map((t) => SYN[t] || t);
    if (!tokens.length) return 0;
    const ix = indexOf(p);
    let score = 0;
    for (const t of tokens) {
      if (t === 'under' || /^\d+$/.test(t)) continue;
      let s = 0;
      if (ix.name.includes(t)) s = 6;
      else if (ix.all.includes(t)) s = 4;
      else if (ix.all.some((w) => w.startsWith(t))) s = 3;
      else if (t.length >= 2 && ix.initials.startsWith(t)) s = 3;
      else if (t.length >= 4 && ix.all.some((w) => lev(w, t) <= 1)) s = 2;
      if (!s) return 0;
      score += s;
    }
    const n = q.match(/(?:under|below|<)\s*₹?\s*(\d+)/i);
    if (n && p.price > Number(n[1])) return 0;
    return score + Math.min(p.sold_count || 0, 30) / 30;
  }
  const searchList = (q) => state.products.map((p) => ({ p, s: searchScore(p, q) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.p);

  function openSearch() {
    $('searchOv').hidden = false;
    document.body.style.overflow = 'hidden';
    const inp = $('searchInput');
    inp.value = route.params.q || '';
    renderSuggest(inp.value);
    setTimeout(() => inp.focus(), 30);
  }
  function closeSearch() { $('searchOv').hidden = true; document.body.style.overflow = ''; }
  function rememberSearch(q) {
    q = q.trim(); if (!q) return;
    state.searches = [q, ...state.searches.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 8);
    store.set('zs_searches', state.searches);
  }
  function goSearch(q) { rememberSearch(q); closeSearch(); go(`#/shop?q=${encodeURIComponent(q.trim())}`); }
  const mark = (text, q) => {
    let out = esc(text);
    words(q).forEach((t) => { if (t.length > 1) out = out.replace(new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'), '<mark>$1</mark>'); });
    return out;
  };
  function renderSuggest(q) {
    const box = $('searchBody');
    q = q.trim();
    if (!q) {
      const trending = [...state.products].sort((a, b) => b.sold_count - a.sold_count).slice(0, 6);
      const colours = colourList().slice(0, 8);
      box.innerHTML = `
        ${state.searches.length ? `<div class="s-h">Recent searches</div><div class="chips" style="flex-wrap:wrap">${state.searches.map((s) => `<button class="chip" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}
        <div class="s-h">Popular right now</div>
        ${trending.map((p) => `<a class="s-row" href="#/p/${esc(p.slug)}"><span class="im">${imgOf(p)}</span><span><b>${esc(p.name)}</b><span class="muted small">${esc(inr(p.price))}${p.discount_pct > 0 ? ` · ${p.discount_pct}% off` : ''}</span></span></a>`).join('')}
        <div class="s-h">Shop by colour</div>
        <div class="chips" style="flex-wrap:wrap">${colours.map(([n, h]) => `<button class="chip" data-q="${esc(n)}"><i style="background:${esc(h)}"></i>${esc(n)}</button>`).join('')}</div>`;
    } else {
      const hits = searchList(q).slice(0, 8);
      const cats = [...new Set(state.products.flatMap((p) => [p.category, p.type]).filter(Boolean))].filter((c) => c.toLowerCase().includes(q.toLowerCase())).slice(0, 3);
      const cols = colourList().filter(([n]) => n.toLowerCase().startsWith(q.toLowerCase())).slice(0, 4);
      box.innerHTML = `
        <button class="s-row" data-q="${esc(q)}"><span class="im" style="display:grid;place-items:center">${I.search}</span><span><b>Search "${esc(q)}"</b><span class="muted small">${searchList(q).length} products</span></span></button>
        ${cats.map((c) => `<button class="s-row" data-q="${esc(c)}"><span class="im" style="display:grid;place-items:center">${I.fabric}</span><span><b>${mark(c, q)}</b><span class="muted small">Category</span></span></button>`).join('')}
        ${cols.map(([n, h]) => `<button class="s-row" data-q="${esc(n)}"><span class="im" style="display:grid;place-items:center"><i style="width:24px;height:24px;border-radius:50%;background:${esc(h)};border:1px solid rgba(0,0,0,.15)"></i></span><span><b>${mark(n, q)} tees</b><span class="muted small">Colour</span></span></button>`).join('')}
        ${hits.length ? `<div class="s-h">Products</div>${hits.map((p) => `<a class="s-row" href="#/p/${esc(p.slug)}"><span class="im">${imgOf(p)}</span><span><b>${mark(p.name, q)}</b><span class="muted small">${esc(inr(p.price))}${p.mrp > p.price ? ` <s>${esc(inr(p.mrp))}</s>` : ''} · ${esc(p.type || '')}</span></span></a>`).join('')}`
          : `<div class="empty-box"><h3>No match yet</h3><p>Try "black", "oversized" or a colour.</p></div>`}`;
    }
    box.querySelectorAll('[data-q]').forEach((b) => { b.onclick = () => goSearch(b.dataset.q); });
    box.querySelectorAll('a.s-row').forEach((a) => { a.addEventListener('click', () => { rememberSearch(q); closeSearch(); }); });
  }
  $('btnSearch').onclick = openSearch;
  $('searchBack').onclick = closeSearch;
  $('searchInput').oninput = debounce((e) => renderSuggest(e.target.value), 120);
  $('searchInput').onkeydown = (e) => { if (e.key === 'Enter' && e.target.value.trim()) goSearch(e.target.value); };

  // ================================================================ catalogue helpers
  function colourList() {
    const m = new Map();
    state.products.forEach((p) => p.variants.forEach((v) => { if (!m.has(v.colour)) m.set(v.colour, v.hex); }));
    return [...m.entries()];
  }
  const categoryList = () => [...new Map(state.products.filter((p) => p.category).map((p) => [p.category_slug, p.category])).entries()];
  const typeList = () => [...new Set(state.products.map((p) => p.type).filter(Boolean))];
  // best price with the best public coupon (+ online-payment offer)
  const usedFirst = () => !!(state.account && (state.account.orders || []).some((x) => x.status !== 'cancelled'));
  function bestDeal(p) {
    let best = null;
    for (const o of state.offers) {
      if (Number(o.min_order) > p.price || (o.first_order_only && usedFirst())) continue;
      let d = o.kind === 'percent' ? Math.round(p.price * Number(o.value) / 100) : Number(o.value);
      if (o.max_discount) d = Math.min(d, Number(o.max_discount));
      d = Math.min(d, p.price);
      if (!best || d > best.d) best = { d, code: o.code, first: o.first_order_only };
    }
    const after = p.price - (best ? best.d : 0);
    const pre = S().prepaid_discount_pct > 0 ? Math.min(Math.round(after * S().prepaid_discount_pct / 100), S().prepaid_discount_max || Infinity) : 0;
    if (!best && !pre) return null;
    return { price: after - pre, code: best && best.code, coupon: best ? best.d : 0, prepaid: pre, first: best && best.first };
  }
  function badgeOf(p) {
    if (p.coming_soon) return '<span class="badge dark">Dropping soon</span>';
    if (!available(p)) return '<span class="badge">Sold out</span>';
    if (p.is_preorder) return '<span class="badge dark">Pre-order</span>';
    if (p.limited_qty) return '<span class="badge dark">Limited</span>';
    if (p.sold_count >= 10 && p === bestSellers()[0]) return '<span class="badge lime">#1 Bestseller</span>';
    if (p.sold_count >= 10) return '<span class="badge lime">Bestseller</span>';
    if (isNew(p)) return '<span class="badge">New</span>';
    return '';
  }
  const bestSellers = () => [...state.products].filter((p) => p.sold_count > 0).sort((a, b) => b.sold_count - a.sold_count);

  // ================================================================ product card
  function card(p, i = 0) {
    const cols = coloursOf(p);
    const low = !p.is_preorder && p.total_stock > 0 && p.total_stock <= 5;
    return `<div class="card${available(p) ? '' : ' oos'}" style="animation-delay:${Math.min(i, 12) * 30}ms">
      <a href="#/p/${esc(p.slug)}" class="img" aria-label="${esc(p.name)}">
        ${imgOf(p)}${imgOf(p, 1)}
        ${badgeOf(p)}
        ${p.rating_count ? `<span class="rate">${p.rating.toFixed(1)} <i>★</i><span>${p.rating_count}</span></span>` : ''}
      </a>
      <button class="heart${state.wish.has(p.id) ? ' on' : ''}" data-wish="${p.id}" aria-label="${state.wish.has(p.id) ? 'Remove from wishlist' : 'Add to wishlist'}">${I.heart}</button>
      <button class="cmp-btn${state.cmp.includes(p.id) ? ' on' : ''}" data-cmp="${p.id}" aria-label="Compare">${I.cmp}${state.cmp.includes(p.id) ? 'Added' : 'Compare'}</button>
      <a href="#/p/${esc(p.slug)}" class="body">
        <div class="nm">${esc(p.name)}</div>
        <div class="sub">${esc([p.type, p.gsm ? `${p.gsm} GSM` : '', p.fabric].filter(Boolean).join(' · '))}</div>
        <div class="price"><b>${esc(inr(p.price))}</b>${p.mrp > p.price ? `<s>${esc(inr(p.mrp))}</s><span class="off">${p.discount_pct}% OFF</span>` : ''}</div>
        ${cols.length > 1 ? `<div class="dots">${cols.slice(0, 4).map(([, h]) => `<i style="background:${esc(h)}"></i>`).join('')}${cols.length > 4 ? `+${cols.length - 4}` : ''}</div>` : ''}
        ${p.coming_soon ? `<div class="urgent">Drops ${esc(dropDate(p.drop_at))}</div>` : low ? `<div class="urgent">Only ${p.total_stock} left</div>` : ''}
      </a>
    </div>`;
  }
  function bindCards(root) {
    root.querySelectorAll('[data-wish]').forEach((b) => { b.onclick = (e) => { e.preventDefault(); toggleWish(Number(b.dataset.wish), b); }; });
    root.querySelectorAll('[data-cmp]').forEach((b) => { b.onclick = (e) => { e.preventDefault(); toggleCompare(Number(b.dataset.cmp)); b.classList.toggle('on', state.cmp.includes(Number(b.dataset.cmp))); b.innerHTML = `${I.cmp}${state.cmp.includes(Number(b.dataset.cmp)) ? 'Added' : 'Compare'}`; }; });
  }
  const skeletonGrid = (n = 8) => `<div class="grid g4">${Array.from({ length: n }, () => '<div><div class="skel" style="aspect-ratio:4/5"></div><div class="skel" style="height:14px;margin-top:10px;width:70%"></div><div class="skel" style="height:14px;margin-top:6px;width:40%"></div></div>').join('')}</div>`;

  // ================================================================ wishlist + compare
  function saveWish() {
    store.set('zs_wish', [...state.wish]);
    const n = state.wish.size;
    $('wishCount').textContent = n; $('wishCount').hidden = !n;
  }
  async function toggleWish(id, btn) {
    const on = !state.wish.has(id);
    if (on) state.wish.add(id); else state.wish.delete(id);
    saveWish();
    document.querySelectorAll(`[data-wish="${id}"], [data-wishbtn="${id}"]`).forEach((b) => { b.classList.toggle('on', on); });
    if (btn) bump(btn);
    const p = byId(id);
    toast(on ? `Saved to wishlist` : 'Removed from wishlist', false, on ? ' <a href="#/wishlist">View</a>' : '');
    if (state.account) {
      const { error } = await sb.rpc('toggle_wishlist', { p_product: id, p_on: on });
      if (error) toast(errText(error), true);
    }
    if (route.path === 'wishlist' && !on) render();
    return p;
  }
  function toggleCompare(id) {
    if (state.cmp.includes(id)) state.cmp = state.cmp.filter((x) => x !== id);
    else {
      if (state.cmp.length >= 4) { toast('Compare up to 4 tees at a time', true); return; }
      state.cmp.push(id);
    }
    store.set('zs_cmp', state.cmp);
    paintTray();
  }
  function paintTray() {
    const t = $('compareTray');
    const list = state.cmp.map(byId).filter(Boolean);
    if (!list.length || ['compare', 'bag', 'checkout', 'order'].includes(route.path)) { t.hidden = true; return; }
    t.hidden = false;
    t.innerHTML = `<span class="thumbs">${list.map((p) => `<i>${imgOf(p)}</i>`).join('')}</span><span>${list.length} to compare</span>
      <a class="btn lime sm" href="#/compare">Compare</a><button aria-label="Clear compare" id="cmpClear" style="color:#fff;padding:0 6px">${I.x}</button>`;
    $('cmpClear').onclick = () => { state.cmp = []; store.set('zs_cmp', []); paintTray(); document.querySelectorAll('.cmp-btn.on').forEach((b) => { b.classList.remove('on'); b.innerHTML = `${I.cmp}Compare`; }); };
  }

  // ================================================================ bag
  function saveBag(silent) {
    state.bag = state.bag.filter((b) => b.qty > 0);
    store.set('zs_bag', state.bag);
    const n = state.bag.reduce((s, b) => s + b.qty, 0);
    [$('bagCount'), $('tabBagCount')].forEach((el) => { el.textContent = n; el.hidden = !n; });
    if (!silent) { bump($('hdrBag')); bump(document.querySelector('.tabbar [data-tab="bag"]')); }
  }
  function addToBag(p, v, qty = 1) {
    if (!canBuy(p, v)) { toast('That size is sold out', true); return false; }
    const line = state.bag.find((b) => b.variant_id === v.id);
    const have = line ? line.qty : 0;
    if (!p.is_preorder && have + qty > v.stock) { toast(`Only ${v.stock} left in ${v.size}`, true); return false; }
    if (have + qty > 20) { toast('Max 20 of one size. For bulk orders, WhatsApp us.', true); return false; }
    if (line) line.qty += qty; else state.bag.push({ variant_id: v.id, product_id: p.id, qty });
    saveBag();
    return true;
  }
  const items = () => state.bag.map((b) => ({ variant_id: b.variant_id, qty: b.qty }));
  async function quote(opts = {}) {
    const { data, error } = await sb.rpc('quote_cart', { p_items: items(), p_opts: opts });
    if (error) throw error;
    return data;
  }

  // ================================================================ delivery by pincode
  async function pinLookup(pin) {
    const r = await fetch(`https://api.postalpincode.in/pincode/${pin}`);
    const d = await r.json();
    const po = d && d[0] && d[0].PostOffice && d[0].PostOffice[0];
    return po ? { city: po.District, state: po.State } : null;
  }
  async function deliveryFor(pin) {
    const area = await Promise.race([pinLookup(pin), new Promise((res) => setTimeout(() => res(null), 3500))]).catch(() => null);
    const { data, error } = await sb.rpc('delivery_check', { p_pincode: pin, p_city: area && area.city, p_state: area && area.state });
    if (error) throw error;
    return { ...data, area };
  }

  // ================================================================ router
  const route = { path: '', params: {}, arg: '' };
  const scrollMem = {};
  function parse() {
    const h = location.hash.replace(/^#/, '') || '/';
    const [p0, qs] = h.split('?');
    const [p, anchor] = p0.split('#');
    const parts = p.split('/').filter(Boolean);
    return { path: parts[0] || 'home', arg: decodeURIComponent(parts.slice(1).join('/') || ''), anchor: anchor || '', params: Object.fromEntries(new URLSearchParams(qs || '')) };
  }
  function go(hash, replace) {
    if (replace) { history.replaceState(null, '', hash); render(); } else location.hash = hash;
  }
  window.addEventListener('hashchange', () => { scrollMem[route.key] = window.scrollY; render(true); });
  const PAGES = {};
  function render(fromNav) {
    Object.assign(route, parse());
    route.key = location.hash || '#/';
    closeSheet(); closeSearch();
    clearInterval(route.timer);
    document.body.classList.toggle('no-tabs', ['p', 'bag', 'checkout'].includes(route.path));
    document.querySelectorAll('.tabbar a').forEach((a) => {
      a.classList.toggle('on', a.dataset.tab === ({ home: 'home', shop: 'shop', wishlist: 'wishlist', bag: 'bag', checkout: 'bag', account: 'account', order: 'account' }[route.path]));
    });
    document.querySelectorAll('.topnav a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === route.key));
    $('searchHint').textContent = route.params.q ? route.params.q : 'Search for tees, colours…';
    if (!state.ready) { main.innerHTML = `<div class="wrap" style="margin-top:20px">${skeletonGrid(8)}</div>`; return; }
    const page = PAGES[route.path] || PAGES.home;
    page();
    paintTray();
    const y = fromNav && scrollMem[route.key];
    window.scrollTo({ top: y || 0, behavior: 'instant' });
  }

  // ================================================================ chrome: announcement, nav, footer
  function chrome() {
    const s = S();
    const msgs = [];
    if (s.free_shipping_above > 0) msgs.push(`Free delivery on orders above <b>${esc(inr(s.free_shipping_above))}</b>`);
    else if (!s.shipping_fee) msgs.push('<b>Free delivery</b> across India');
    if (s.prepaid_discount_pct > 0) msgs.push(`Extra <b>${s.prepaid_discount_pct}% off</b> when you pay online`);
    if (s.cod_enabled) msgs.push('<b>Cash on delivery</b> available');
    if (s.return_window_days) msgs.push(`<b>${s.return_window_days}-day</b> easy size exchange`);
    const first = state.offers.find((o) => o.first_order_only) || state.offers[0];
    if (first) msgs.push(`Use code <b>${esc(first.code)}</b>${first.description ? ` · ${esc(first.description)}` : ''}`);
    let i = 0;
    const show = () => { $('announce').innerHTML = `<span>${msgs[i % msgs.length] || 'Big fits. Zero apologies.'}</span>`; i++; };
    show(); setInterval(show, 4000);

    const cats = categoryList();
    $('topnav').innerHTML = `<a href="#/shop?tag=new">New in</a><a href="#/shop?tag=best">Bestsellers</a>
      ${cats.map(([slug, name]) => `<a href="#/shop?c=${esc(slug)}">${esc(name)}</a>`).join('')}
      ${state.bundles.length ? '<a href="#/shop?tag=combo">Combos</a>' : ''}<a class="hot" href="#/shop?tag=sale">Sale</a>`;
    $('btnMenu').onclick = () => {
      const b = openSheet(`<h2>Shop</h2>
        <div style="display:grid;gap:4px">
          ${[['#/shop', 'All tees'], ['#/shop?tag=new', 'New in'], ['#/shop?tag=best', 'Bestsellers'], ...cats.map(([s, n]) => [`#/shop?c=${s}`, n]),
            ...(state.bundles.length ? [['#/shop?tag=combo', 'Combos']] : []), ['#/shop?tag=sale', 'Sale'], ['#/shop?tag=under', 'Under ₹599']]
            .map(([h, l]) => `<a class="s-row" style="font-weight:800;font-size:16px;text-transform:uppercase" href="${h}">${esc(l)}</a>`).join('')}
        </div>
        <div class="s-h">Help</div>
        <a class="s-row" href="#/track">Track my order</a><a class="s-row" href="#/help">Size guide, returns & FAQs</a><a class="s-row" href="#/account">My account</a>`, { title: 'Menu' });
      b.querySelectorAll('a').forEach((a) => { a.onclick = closeSheet; });
    };

    const wa = cfg.STORE_WHATSAPP || s.store_whatsapp;
    if (wa) { $('waFloat').hidden = false; $('waFloat').href = `https://wa.me/${String(wa).replace(/\D/g, '')}?text=${encodeURIComponent('Hi Z-SHIRTS!')}`; }
    const ig = cfg.INSTAGRAM || s.instagram;
    $('foot').innerHTML = `<div class="wrap">
      <div><div class="logo">Z<span>-</span>SHIRTS</div><p>Oversized tees in heavy cotton. Designed in Ahmedabad, delivered across India.</p>
        <div class="paybadges"><span>UPI</span><span>Cards</span><span>Netbanking</span>${s.cod_enabled ? '<span>Cash on delivery</span>' : ''}</div></div>
      <div><h4>Shop</h4><a href="#/shop">All tees</a><a href="#/shop?tag=new">New in</a><a href="#/shop?tag=best">Bestsellers</a><a href="#/shop?tag=sale">Sale</a></div>
      <div><h4>Help</h4><a href="#/track">Track order</a><a href="#/help">Size guide</a><a href="#/help#returns">Returns & exchange</a><a href="#/help#shipping">Shipping</a><a href="#/help">FAQs</a></div>
      <div><h4>Talk to us</h4>${wa ? `<a target="_blank" rel="noopener" href="https://wa.me/${esc(String(wa).replace(/\D/g, ''))}">WhatsApp</a>` : ''}${ig ? `<a target="_blank" rel="noopener" href="https://instagram.com/${esc(ig)}">Instagram</a>` : ''}<a href="#/account">My account</a></div>
    </div>`;
  }

  // ================================================================ HOME
  PAGES.home = () => {
    const s = S();
    const drop = state.products.filter((p) => p.coming_soon).sort((a, b) => new Date(a.drop_at) - new Date(b.drop_at))[0];
    const hero = drop || state.products.find((p) => p.featured) || bestSellers()[0] || state.products[0];
    const best = bestSellers().slice(0, 10);
    const fresh = [...state.products].sort((a, b) => new Date(b.published_at) - new Date(a.published_at)).slice(0, 10);
    const cols = colourList();
    const cats = categoryList();
    const under = state.products.filter((p) => p.price <= 599).length;
    const recent = state.viewed.map(byId).filter(Boolean).slice(0, 10);
    main.innerHTML = `
      <section class="hero">
        <div class="hero-in">
          <div>
            ${drop ? `<div style="color:var(--lime);font-weight:800;letter-spacing:.1em;text-transform:uppercase;font-size:12.5px">Next drop · ${esc(drop.drop_name || drop.name)}</div>` : ''}
            <h1><span>Big fits.</span><span class="stroke">Zero</span><span>apologies.</span></h1>
            <p>${drop ? `Drops in <b id="heroClock" style="color:#fff">${countdown(drop.drop_at)}</b>. Set a reminder and be first in line.` : `Heavyweight oversized tees${hero && hero.gsm ? ` in ${hero.gsm} GSM cotton` : ''}. Cut to drop off the shoulder. Built to last.`}</p>
            <div class="btns"><a class="btn lime" href="#/shop">Shop all tees</a>${best.length ? '<a class="btn line" href="#/shop?tag=best">Bestsellers</a>' : ''}</div>
          </div>
          ${hero ? `<a class="hero-art" href="#/p/${esc(hero.slug)}">${imgOf(hero)}<span class="tag">${esc(hero.name)}<b>${esc(inr(hero.price))}${hero.mrp > hero.price ? ` <s style="color:var(--faint);font-size:13px">${esc(inr(hero.mrp))}</s>` : ''}</b></span></a>` : ''}
        </div>
        <div class="marquee" aria-hidden="true"><div>${Array(2).fill(['Heavy cotton', 'Oversized fit', 'Pre-shrunk', 'Cash on delivery', 'Easy exchange', 'Made in India', 'Big fits zero apologies']).flat().map((t) => `<span>${t} ✦</span>`).join('')}</div></div>
      </section>
      <div class="wrap">
        <div class="trust">
          <div>${I.truck}<span><b>${s.free_shipping_above > 0 ? `Free above ${esc(inr(s.free_shipping_above))}` : 'Free delivery'}</b>Across India</span></div>
          <div>${I.cash}<span><b>${s.cod_enabled ? 'Cash on delivery' : 'Secure payments'}</b>${s.cod_enabled ? 'Pay when it arrives' : 'UPI, cards'}</span></div>
          <div>${I.swap}<span><b>${s.return_window_days || 15}-day exchange</b>Wrong size? Swap it</span></div>
          <div>${I.shield}<span><b>Secure checkout</b>UPI · cards · netbanking</span></div>
        </div>

        <section class="sec">
          <div class="sec-h"><h2>Shop the <em>vibe</em></h2><a href="#/shop">View all</a></div>
          <div class="tiles">
            <a class="tile dark" href="#/shop?tag=new"><span class="big">New<br>in</span><b>Just dropped</b></a>
            ${best[0] ? `<a class="tile" href="#/shop?tag=best"><span class="art">${imgOf(best[0])}</span><b>Bestsellers</b></a>` : ''}
            ${cats.map(([slug, name]) => { const p = state.products.find((x) => x.category_slug === slug); return `<a class="tile" href="#/shop?c=${esc(slug)}"><span class="art">${p ? imgOf(p) : ''}</span><b>${esc(name)}</b></a>`; }).join('')}
            ${under ? '<a class="tile lime" href="#/shop?tag=under"><span class="big">Under<br>₹599</span><b>Steal deals</b></a>' : ''}
            ${state.bundles.length ? `<a class="tile dark" href="#/shop?tag=combo"><span class="big">${esc(state.bundles[0].qty)} for<br>${esc(inr(state.bundles[0].price))}</span><b>Combos</b></a>` : ''}
            <a class="tile" href="#/shop?tag=sale"><span class="art">${fresh[1] ? imgOf(fresh[1]) : ''}</span><b>On sale</b></a>
          </div>
        </section>

        ${best.length ? `<section class="sec"><div class="sec-h"><h2>Bestsellers</h2><a href="#/shop?tag=best">See all</a></div><div class="rail">${best.map(card).join('')}</div></section>` : ''}

        ${state.bundles.length ? `<section class="sec"><div class="combo-band"><div><h3>${esc(state.bundles[0].name)}</h3><p>Mix any ${esc(state.bundles[0].qty)} tees. The combo price applies in your bag automatically.</p></div><a class="btn" href="#/shop?tag=combo">Build your combo</a></div></section>` : ''}

        <section class="sec"><div class="sec-h"><h2>New <em>arrivals</em></h2><a href="#/shop?sort=new">See all</a></div><div class="rail">${fresh.map(card).join('')}</div></section>

        ${cols.length > 1 ? `<section class="sec"><div class="sec-h"><h2>Shop by colour</h2></div><div class="swatch-row">${cols.map(([n, h]) => `<a href="#/shop?col=${encodeURIComponent(n)}"><i style="background:${esc(h)}"></i>${esc(n)}</a>`).join('')}</div></section>` : ''}

        ${state.offers.length ? `<section class="sec"><div class="sec-h"><h2>Offers for you</h2></div><div class="offers">${state.offers.map((o) => `<div class="offer"><div><b>${o.kind === 'percent' ? `${Number(o.value)}% OFF` : `${esc(inr(o.value))} OFF`}</b><div class="muted small">${esc(o.description || '')}${Number(o.min_order) ? ` · on orders above ${esc(inr(o.min_order))}` : ''}${o.first_order_only ? ' · first order' : ''}</div></div><button class="code" data-copy="${esc(o.code)}">${esc(o.code)}</button></div>`).join('')}</div></section>` : ''}

        <section class="sec" id="homeReviews"></section>

        <section class="sec"><div class="club"><div><h3>Join <span>Z-Club</span></h3><ul><li>${s.loyalty_points_per_100 || 5} points per ₹100</li><li>1 point = ₹1 off</li><li>Early access to drops</li><li>Track all orders</li></ul></div>
          <a class="btn lime" href="#/account">${state.account ? `You have ${state.account.points} points` : 'Join free with Google'}</a></div></section>

        ${recent.length ? `<section class="sec"><div class="sec-h"><h2>Recently viewed</h2></div><div class="rail">${recent.map(card).join('')}</div></section>` : ''}
      </div>`;
    bindCards(main);
    main.querySelectorAll('[data-copy]').forEach((b) => { b.onclick = () => { store.set('zs_coupon', b.dataset.copy); try { navigator.clipboard.writeText(b.dataset.copy); } catch (_) { /* */ } toast(`${b.dataset.copy} will be applied in your bag`); }; });
    if (drop) route.timer = setInterval(() => { const c = $('heroClock'); if (c) c.textContent = countdown(drop.drop_at); }, 1000);
    homeReviews();
  };
  async function homeReviews() {
    const { data } = await sb.from('public_reviews').select('*').gte('rating', 4).order('created_at', { ascending: false }).limit(8);
    const box = $('homeReviews');
    if (!box || !data || !data.length) return;
    box.innerHTML = `<div class="sec-h"><h2>Fits that <em>hit</em></h2></div><div class="rev-wall">${data.map((r) => {
      const p = byId(r.product_id);
      return `<a class="rev-card" href="${p ? `#/p/${esc(p.slug)}` : '#/shop'}"><div><span class="rv"><span class="stars">${r.rating} ★</span></span>${r.verified ? '<span class="muted small">Verified buyer</span>' : ''}</div>
        <b style="display:block;margin-top:8px">${esc(r.title || 'Loved it')}</b><p class="small" style="margin:6px 0;color:var(--ink-2)">${esc((r.body || '').slice(0, 140))}</p>
        <div class="muted small">${esc(r.author)}${p ? ` · ${esc(p.name)}` : ''}${r.size_bought ? ` · size ${esc(r.size_bought)}` : ''}</div></a>`;
    }).join('')}</div>`;
  }

  // ================================================================ SHOP (listing)
  const SORTS = [['rec', 'Recommended'], ['pop', 'Popularity'], ['new', 'New arrivals'], ['low', 'Price: low to high'], ['high', 'Price: high to low'], ['off', 'Biggest discount'], ['rating', 'Customer rating']];
  const TAGS = { new: 'New in', best: 'Bestsellers', sale: 'Sale', under: 'Under ₹599', combo: 'Combo eligible', drop: 'Drops & limited', preorder: 'Pre-order' };
  const listParams = () => {
    const pr = route.params;
    const arr = (k) => (pr[k] ? pr[k].split(',').filter(Boolean) : []);
    return { q: pr.q || '', c: arr('c'), t: arr('t'), col: arr('col'), sz: arr('sz'), pmin: Number(pr.pmin) || 0, pmax: Number(pr.pmax) || 0,
      off: Number(pr.off) || 0, r: Number(pr.r) || 0, stock: pr.stock === '1', tag: pr.tag || '', sort: pr.sort || 'rec' };
  };
  function listHash(f) {
    const q = new URLSearchParams();
    if (f.q) q.set('q', f.q);
    ['c', 't', 'col', 'sz'].forEach((k) => { if (f[k].length) q.set(k, f[k].join(',')); });
    ['pmin', 'pmax', 'off', 'r'].forEach((k) => { if (f[k]) q.set(k, f[k]); });
    if (f.stock) q.set('stock', '1');
    if (f.tag) q.set('tag', f.tag);
    if (f.sort && f.sort !== 'rec') q.set('sort', f.sort);
    const s = q.toString();
    return `#/shop${s ? `?${s}` : ''}`;
  }
  function filterProducts(f, skip) {
    let list = f.q ? searchList(f.q) : [...state.products];
    const comboIds = new Set(state.bundles.flatMap((b) => (b.product_ids && b.product_ids.length ? b.product_ids : state.products.map((p) => p.id))));
    const best = new Set(bestSellers().slice(0, 12).map((p) => p.id));
    return list.filter((p) => {
      if (skip !== 'c' && f.c.length && !f.c.includes(p.category_slug)) return false;
      if (skip !== 't' && f.t.length && !f.t.includes(p.type)) return false;
      if (skip !== 'col' && f.col.length && !p.variants.some((v) => f.col.includes(v.colour) && (!f.stock || v.stock > 0 || p.is_preorder))) return false;
      if (skip !== 'sz' && f.sz.length && !p.variants.some((v) => f.sz.includes(v.size) && (v.stock > 0 || p.is_preorder))) return false;
      if (f.pmin && p.price < f.pmin) return false;
      if (f.pmax && p.price > f.pmax) return false;
      if (f.off && p.discount_pct < f.off) return false;
      if (f.r && p.rating < f.r) return false;
      if (f.stock && !available(p)) return false;
      if (f.tag === 'new' && !isNew(p) && ![...state.products].sort((a, b) => new Date(b.published_at) - new Date(a.published_at)).slice(0, 8).includes(p)) return false;
      if (f.tag === 'best' && !best.has(p.id)) return false;
      if (f.tag === 'sale' && !(p.discount_pct > 0)) return false;
      if (f.tag === 'under' && p.price > 599) return false;
      if (f.tag === 'combo' && !comboIds.has(p.id)) return false;
      if (f.tag === 'drop' && !(p.drop_name || p.limited_qty || p.coming_soon)) return false;
      if (f.tag === 'preorder' && !p.is_preorder) return false;
      return true;
    });
  }
  function sortProducts(list, sort, q) {
    const by = {
      rec: (a, b) => (q ? 0 : (b.featured - a.featured) || (available(b) - available(a)) || (b.sold_count - a.sold_count) || (new Date(b.published_at) - new Date(a.published_at))),
      pop: (a, b) => b.sold_count - a.sold_count, new: (a, b) => new Date(b.published_at) - new Date(a.published_at),
      low: (a, b) => a.price - b.price, high: (a, b) => b.price - a.price, off: (a, b) => b.discount_pct - a.discount_pct,
      rating: (a, b) => (b.rating - a.rating) || (b.rating_count - a.rating_count),
    }[sort] || (() => 0);
    return [...list].sort(by);
  }
  function filtersHtml(f) {
    const all = state.products;
    const count = (skip, test) => filterProducts(f, skip).filter(test).length;
    const cats = categoryList(); const types = typeList(); const cols = colourList();
    const sizes = SIZE_ORDER.filter((z) => all.some((p) => p.variants.some((v) => v.size === z)));
    const maxP = Math.max(0, ...all.map((p) => p.price));
    const box = (k, val, label, n, extra = '') => `<label class="fopt"><input type="checkbox" data-f="${k}" value="${esc(val)}" ${f[k].includes(val) ? 'checked' : ''}>${extra}${esc(label)}<small>${n}</small></label>`;
    return `
      ${cats.length > 1 ? `<div class="fgroup"><h4>Category</h4>${cats.map(([s, n]) => box('c', s, n, count('c', (p) => p.category_slug === s))).join('')}</div>` : ''}
      ${types.length > 1 ? `<div class="fgroup"><h4>Style</h4>${types.map((t) => box('t', t, t, count('t', (p) => p.type === t))).join('')}</div>` : ''}
      <div class="fgroup"><h4>Size</h4><div class="fsizes">${sizes.map((z) => `<button type="button" data-sz="${z}" class="${f.sz.includes(z) ? 'on' : ''}">${z}</button>`).join('')}</div></div>
      <div class="fgroup"><h4>Colour</h4>${cols.map(([n, h]) => box('col', n, n, count('col', (p) => p.variants.some((v) => v.colour === n)), `<i style="background:${esc(h)}"></i>`)).join('')}</div>
      <div class="fgroup"><h4>Price</h4>
        ${[[0, 599, 'Under ₹599'], [600, 899, '₹600 – ₹899'], [900, 1299, '₹900 – ₹1,299'], [1300, 0, '₹1,300 and above']].filter(([a]) => a <= maxP)
          .map(([a, b, l]) => `<label class="fopt"><input type="radio" name="pr" data-pr="${a}-${b}" ${f.pmin === a && f.pmax === b ? 'checked' : ''}>${l}<small>${all.filter((p) => p.price >= a && (!b || p.price <= b)).length}</small></label>`).join('')}
        <div class="prange"><input type="number" inputmode="numeric" id="fpmin" placeholder="Min ₹" value="${f.pmin || ''}"><span>–</span><input type="number" inputmode="numeric" id="fpmax" placeholder="Max ₹" value="${f.pmax || ''}"></div></div>
      <div class="fgroup"><h4>Discount</h4>${[10, 20, 30, 40, 50].map((d) => `<label class="fopt"><input type="radio" name="off" data-off="${d}" ${f.off === d ? 'checked' : ''}>${d}% and above<small>${all.filter((p) => p.discount_pct >= d).length}</small></label>`).join('')}</div>
      ${all.some((p) => p.rating_count) ? `<div class="fgroup"><h4>Customer rating</h4>${[4, 3].map((r) => `<label class="fopt"><input type="radio" name="rt" data-r="${r}" ${f.r === r ? 'checked' : ''}>${r}★ & above</label>`).join('')}</div>` : ''}
      <div class="fgroup"><h4>Availability</h4><label class="fopt"><input type="checkbox" id="fstock" ${f.stock ? 'checked' : ''}>In stock only</label></div>`;
  }
  function readFilters(root, f) {
    const n = { ...f, c: [], t: [], col: [] };
    root.querySelectorAll('[data-f]:checked').forEach((i) => n[i.dataset.f].push(i.value));
    n.sz = [...root.querySelectorAll('[data-sz].on')].map((b) => b.dataset.sz);
    const pr = root.querySelector('[data-pr]:checked');
    n.pmin = Number(root.querySelector('#fpmin').value) || 0; n.pmax = Number(root.querySelector('#fpmax').value) || 0;
    if (pr && !root.querySelector('#fpmin').dataset.typed) { const [a, b] = pr.dataset.pr.split('-').map(Number); n.pmin = a; n.pmax = b; }
    const off = root.querySelector('[data-off]:checked'); n.off = off ? Number(off.dataset.off) : 0;
    const r = root.querySelector('[data-r]:checked'); n.r = r ? Number(r.dataset.r) : 0;
    n.stock = root.querySelector('#fstock').checked;
    return n;
  }
  function bindFilters(root, f, live) {
    root.querySelectorAll('[data-sz]').forEach((b) => { b.onclick = () => { b.classList.toggle('on'); if (live) go(listHash(readFilters(root, f))); }; });
    ['#fpmin', '#fpmax'].forEach((s) => { const el = root.querySelector(s); el.oninput = () => { el.dataset.typed = '1'; root.querySelector('#fpmin').dataset.typed = '1'; root.querySelectorAll('[data-pr]').forEach((r) => { r.checked = false; }); }; if (live) el.onchange = () => go(listHash(readFilters(root, f))); });
    if (live) root.querySelectorAll('input[type=checkbox], input[type=radio]').forEach((i) => { i.onchange = () => go(listHash(readFilters(root, f))); });
  }
  PAGES.shop = () => {
    const f = listParams();
    const list = sortProducts(filterProducts(f), f.sort, f.q);
    const cat = f.c.length === 1 ? (categoryList().find(([s]) => s === f.c[0]) || [])[1] : '';
    const title = f.q ? `"${f.q}"` : cat || (f.tag ? TAGS[f.tag] : f.col.length === 1 ? `${f.col[0]} tees` : 'All tees');
    const applied = [
      ...f.c.map((v) => ['c', v, (categoryList().find(([s]) => s === v) || [])[1] || v]), ...f.t.map((v) => ['t', v, v]), ...f.col.map((v) => ['col', v, v]), ...f.sz.map((v) => ['sz', v, `Size ${v}`]),
      ...(f.pmin || f.pmax ? [['price', '', `${f.pmin ? inr(f.pmin) : '₹0'} – ${f.pmax ? inr(f.pmax) : 'any'}`]] : []), ...(f.off ? [['off', '', `${f.off}%+ off`]] : []),
      ...(f.r ? [['r', '', `${f.r}★+`]] : []), ...(f.stock ? [['stock', '', 'In stock']] : []), ...(f.tag ? [['tag', '', TAGS[f.tag]]] : []), ...(f.q ? [['q', '', `"${f.q}"`]] : []),
    ];
    const nf = applied.filter(([k]) => !['q', 'tag'].includes(k)).length;
    const quick = [['stock', 'In stock'], ['sale', 'On sale'], ['new', 'New in'], ['under', 'Under ₹599'], ['best', 'Bestsellers']];
    main.innerHTML = `<div class="wrap">
      <div class="crumb"><a href="#/">Home</a> / <a href="#/shop">Shop</a>${f.q || cat || f.tag ? ` / ${esc(title)}` : ''}</div>
      <div class="list-top"><h1 class="page">${esc(title)}</h1></div>
      <div class="count-line muted small">${list.length} ${list.length === 1 ? 'product' : 'products'}</div>
      <div class="toolbar">
        <button class="tb-btn only-m" id="openF">${I.filter}Filter${nf ? `<span class="n">${nf}</span>` : ''}</button>
        <div class="chips">${quick.map(([k, l]) => `<button class="chip${(k === 'stock' ? f.stock : f.tag === k) ? ' on' : ''}" data-quick="${k}">${l}</button>`).join('')}
          ${SIZE_ORDER.filter((z) => state.products.some((p) => p.variants.some((v) => v.size === z))).map((z) => `<button class="chip${f.sz.includes(z) ? ' on' : ''}" data-qsz="${z}">${z}</button>`).join('')}</div>
        <select class="sort-sel" id="sortSel" aria-label="Sort">${SORTS.map(([k, l]) => `<option value="${k}" ${f.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </div>
      ${applied.length ? `<div class="applied">${applied.map(([k, v, l]) => `<button class="chip" data-rm="${k}" data-v="${esc(v)}">${esc(l)} ${I.x}</button>`).join('')}<button class="link small" id="clearAll">Clear all</button></div>` : ''}
      <div class="list-layout">
        <aside class="side only-d" id="sideF" style="display:block">${filtersHtml(f)}</aside>
        <div>${list.length ? `<div class="grid">${list.map(card).join('')}</div>`
          : `<div class="empty-box"><div class="big-ic">${I.search}</div><h3>Nothing matches</h3><p>Try removing a filter or searching for something else.</p><a class="btn" href="#/shop">See all tees</a></div>`}
          ${list.length && f.q ? '' : ''}</div>
      </div></div>`;
    if (window.innerWidth >= 960) bindFilters($('sideF'), f, true); else $('sideF').remove();
    bindCards(main);
    $('sortSel').onchange = (e) => go(listHash({ ...f, sort: e.target.value }));
    main.querySelectorAll('[data-quick]').forEach((b) => { b.onclick = () => { const k = b.dataset.quick; go(listHash(k === 'stock' ? { ...f, stock: !f.stock } : { ...f, tag: f.tag === k ? '' : k })); }; });
    main.querySelectorAll('[data-qsz]').forEach((b) => { b.onclick = () => { const z = b.dataset.qsz; go(listHash({ ...f, sz: f.sz.includes(z) ? f.sz.filter((x) => x !== z) : [...f.sz, z] })); }; });
    main.querySelectorAll('[data-rm]').forEach((b) => {
      b.onclick = () => {
        const k = b.dataset.rm; const v = b.dataset.v; const n = { ...f };
        if (['c', 't', 'col', 'sz'].includes(k)) n[k] = f[k].filter((x) => x !== v);
        else if (k === 'price') { n.pmin = 0; n.pmax = 0; } else if (k === 'stock') n.stock = false; else n[k] = k === 'tag' || k === 'q' ? '' : 0;
        go(listHash(n));
      };
    });
    if ($('clearAll')) $('clearAll').onclick = () => go(listHash({ ...listParams(), c: [], t: [], col: [], sz: [], pmin: 0, pmax: 0, off: 0, r: 0, stock: false, tag: '', q: '' }));
    if ($('openF')) $('openF').onclick = () => {
      const b = openSheet(`<h2>Filters</h2><div id="fs">${filtersHtml(f)}</div>
        <div class="fsheet-foot"><button class="btn ghost" id="fClear">Clear</button><button class="btn" id="fApply">Show results</button></div>`, { title: 'Filters' });
      const fs = b.querySelector('#fs');
      bindFilters(fs, f, false);
      const upd = () => { const n = filterProducts(readFilters(fs, f)).length; $('fApply').textContent = `Show ${n} result${n === 1 ? '' : 's'}`; };
      fs.addEventListener('change', upd); fs.addEventListener('click', () => setTimeout(upd, 0)); upd();
      $('fApply').onclick = () => go(listHash(readFilters(fs, f)));
      $('fClear').onclick = () => go(listHash({ ...f, c: [], t: [], col: [], sz: [], pmin: 0, pmax: 0, off: 0, r: 0, stock: false }));
    };
  };

  // ================================================================ push + restock
  const b64ToBytes = (s) => {
    const pad = '='.repeat((4 - (s.length % 4)) % 4);
    const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  };
  async function enablePush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      throw new Error(/iPhone|iPad/.test(navigator.userAgent)
        ? 'On iPhone: tap Share → Add to Home Screen, open the shop from there, then try again.'
        : 'This browser cannot show notifications.');
    }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Notifications are blocked. Allow them in your browser settings.');
    const reg = await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const r = await fetch(`${cfg.SUPABASE_URL}/functions/v1/push?key=1`);
      const { key } = await r.json().catch(() => ({}));
      if (!key) throw new Error('Notifications are not switched on yet. Please try later.');
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
    }
    const j = sub.toJSON();
    const { error } = await sb.rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
    if (error) throw error;
    store.set('zs_push', true);
    return j.endpoint;
  }
  async function notifyMe(v) {
    try {
      const endpoint = await enablePush();
      const { error } = await sb.rpc('request_restock', { p_variant: v.id, p_endpoint: endpoint });
      if (error) throw error;
      toast(`We'll ping you when ${v.size} is back`);
    } catch (e) { toast(errText(e), true); }
  }

  // ================================================================ size help
  const guideRows = () => cfg.SIZE_GUIDE || [];
  function suggestSize(h, w, pref) {
    // oversized cut: weight sets the base, height nudges, preference shifts one size
    const ladder = guideRows().map((r) => r.size);
    if (!ladder.length || !h || !w) return null;
    let i = w < 56 ? 0 : w < 66 ? 1 : w < 77 ? 2 : w < 88 ? 3 : 4;
    if (h >= 183 && i < 2) i += 1;
    if (h <= 160 && i > 0 && w < 70) i -= 1;
    if (pref === 'regular') i -= 1;
    if (pref === 'baggy') i += 1;
    return ladder[Math.max(0, Math.min(ladder.length - 1, i))];
  }
  function sizeGuideSheet(p) {
    const rows = guideRows();
    let unit = store.get('zs_unit', 'in');
    const me = state.mySize || {};
    const b = openSheet(`<h2>Size guide</h2>
      <div class="sg">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><span class="muted small">Garment measurements · oversized fit</span>
          <span class="unit-sw"><button data-u="in">in</button><button data-u="cm">cm</button></span></div>
        <div id="sgT" style="margin-top:10px"></div>
        <p class="muted small">Chest is measured armpit to armpit and doubled. Your usual size gives the relaxed, drop-shoulder look. Want it fitted? Go one size down.</p>
      </div>
      <h2 style="margin-top:22px">Find my size</h2>
      <form class="form" id="fitF">
        <div class="form row2"><div><label for="fH">Height (cm)</label><input id="fH" inputmode="numeric" value="${esc(me.h || '')}" placeholder="e.g. 172"></div>
          <div><label for="fW">Weight (kg)</label><input id="fW" inputmode="numeric" value="${esc(me.w || '')}" placeholder="e.g. 68"></div></div>
        <label>How do you like it?</label>
        <div class="chips" style="flex-wrap:wrap">${[['regular', 'Closer fit'], ['oversized', 'Oversized'], ['baggy', 'Extra baggy']].map(([k, l]) => `<button type="button" class="chip${(me.pref || 'oversized') === k ? ' on' : ''}" data-pref="${k}">${l}</button>`).join('')}</div>
        <button class="btn full" style="margin-top:16px" type="submit">Find my size</button>
      </form>
      <div id="fitR"></div>`, { title: 'Size guide' });
    let pref = me.pref || 'oversized';
    const table = (hl) => {
      const f = unit === 'cm' ? (x) => Math.round(x * 2.54) : (x) => x;
      b.querySelector('#sgT').innerHTML = `<table><thead><tr><th>Size</th><th>Chest</th><th>Length</th><th>Shoulder</th></tr></thead><tbody>
        ${rows.map((r) => `<tr class="${r.size === hl ? 'me' : ''}"><td><b>${esc(r.size)}</b></td><td>${f(r.chest)}</td><td>${f(r.length)}</td><td>${f(r.shoulder)}</td></tr>`).join('')}</tbody></table>`;
      b.querySelectorAll('[data-u]').forEach((x) => x.classList.toggle('on', x.dataset.u === unit));
    };
    table(me.size);
    b.querySelectorAll('[data-u]').forEach((x) => { x.onclick = () => { unit = x.dataset.u; store.set('zs_unit', unit); table(state.mySize && state.mySize.size); }; });
    b.querySelectorAll('[data-pref]').forEach((x) => { x.onclick = () => { pref = x.dataset.pref; b.querySelectorAll('[data-pref]').forEach((y) => y.classList.toggle('on', y === x)); }; });
    b.querySelector('#fitF').onsubmit = (e) => {
      e.preventDefault();
      const h = Number(b.querySelector('#fH').value), w = Number(b.querySelector('#fW').value);
      if (h < 120 || h > 220 || w < 30 || w > 180) { b.querySelector('#fitR').innerHTML = '<div class="err">Enter your height in cm and weight in kg.</div>'; return; }
      const size = suggestSize(h, w, pref);
      state.mySize = { h, w, pref, size };
      store.set('zs_my_size', state.mySize);
      table(size);
      b.querySelector('#fitR').innerHTML = `<div class="fit-res"><span class="small">Your Z-SHIRTS size</span><b>${esc(size)}</b><span class="small">Saved. We'll mark it on every tee.</span></div>
        ${p ? '<button class="btn full" id="fitUse" style="margin-top:10px">Select this size</button>' : ''}`;
      if (p && $('fitUse')) $('fitUse').onclick = () => { closeSheet(); const el = document.querySelector(`.sz[data-size="${size}"]`); if (el && !el.disabled) el.click(); };
      if (route.path === 'p') document.querySelectorAll('.sz .mine').forEach((m) => m.remove()), document.querySelectorAll(`.sz[data-size="${size}"]`).forEach((s) => s.insertAdjacentHTML('beforeend', '<span class="mine">You</span>'));
    };
  }

  // ================================================================ PRODUCT PAGE
  function pushViewed(id) {
    state.viewed = [id, ...state.viewed.filter((x) => x !== id)].slice(0, 12);
    store.set('zs_viewed', state.viewed);
  }
  PAGES.p = () => {
    const p = bySlug(route.arg);
    if (!p) { main.innerHTML = '<div class="wrap empty-box"><h3>This tee is not here anymore</h3><p>It may be sold out or renamed.</p><a class="btn" href="#/shop">See all tees</a></div>'; return; }
    pushViewed(p.id);
    document.title = `${p.name} · Z-SHIRTS`;
    const cols = coloursOf(p);
    let colour = route.params.c && cols.some(([n]) => n === route.params.c) ? route.params.c
      : (cols.find(([n]) => p.variants.some((v) => v.colour === n && canBuy(p, v))) || cols[0] || [''])[0];
    let size = null;
    const deal = bestDeal(p);
    const s = S();
    const imgs = (p.images && p.images.length ? p.images : [null]);
    const fitTotal = (p.fit_small || 0) + (p.fit_true || 0) + (p.fit_large || 0);
    const fitPos = fitTotal ? Math.round(((p.fit_true || 0) * 50 + (p.fit_large || 0) * 100) / fitTotal) : 50;
    const reviewable = state.account && (state.account.reviewable || []).find((r) => r.product_id === p.id);
    const pin = store.get('zs_pin', '');
    const crumbCat = p.category ? `<a href="#/shop?c=${esc(p.category_slug)}">${esc(p.category)}</a> / ` : '';
    main.innerHTML = `<div class="wrap">
      <div class="crumb"><a href="#/">Home</a> / ${crumbCat}${esc(p.name)}</div>
      <div class="pdp">
        <div class="gal">
          <div class="gal-main" id="galMain">${imgs.map((src, i) => (src ? `<img src="${esc(src)}" alt="${esc(p.name)} photo ${i + 1}" ${i ? 'loading="lazy"' : ''}>` : `<div>${tee(cols.find(([n]) => n === colour)?.[1] || firstHex(p), p.name)}</div>`)).join('')}</div>
          ${imgs.length > 1 ? `<div class="gal-thumbs">${imgs.map((src, i) => `<button data-th="${i}" class="${i ? '' : 'on'}" aria-label="Photo ${i + 1}">${src ? `<img src="${esc(src)}" alt="">` : tee(firstHex(p))}</button>`).join('')}</div><div class="gal-dots">${imgs.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}
          <button class="heart${state.wish.has(p.id) ? ' on' : ''}" data-wish="${p.id}" aria-label="Wishlist">${I.heart}</button>
          <button class="share" id="share" aria-label="Share">${I.share}</button>
        </div>
        <div class="info">
          <div class="kicker">${esc(p.type || 'Tee')}${p.drop_name ? `<span class="pill">${esc(p.drop_name)}</span>` : ''}${p.limited_qty ? '<span class="pill">Limited</span>' : ''}${isNew(p) ? '<span class="pill">New</span>' : ''}</div>
          <h1>${esc(p.name)}</h1>
          ${p.rating_count ? `<a class="rate-line" href="#reviews" id="toRev">${p.rating.toFixed(1)} <i>★</i><span>${p.rating_count} rating${p.rating_count === 1 ? '' : 's'}</span></a>` : ''}
          <div class="pprice"><b>${esc(inr(p.price))}</b>${p.mrp > p.price ? `<s>MRP ${esc(inr(p.mrp))}</s><span class="off">(${p.discount_pct}% OFF)</span>` : ''}</div>
          <div class="tax">Inclusive of all taxes</div>
          ${deal ? `<div class="best">Best price <b>${esc(inr(deal.price))}</b>${deal.code ? ` with code <span class="code">${esc(deal.code)}</span>${deal.first ? ' (first order)' : ''}` : ''}${deal.prepaid ? `${deal.code ? ' +' : ''} ${s.prepaid_discount_pct}% extra off on online payment` : ''}</div>` : ''}
          ${p.coming_soon ? `<div class="best" style="background:var(--soft);border-color:var(--line)">Drops <b>${esc(dropDate(p.drop_at))}</b> · <b id="dropClock">${countdown(p.drop_at)}</b></div>` : ''}

          ${cols.length ? `<div class="opt-h"><b>Colour <span id="colName">${esc(colour)}</span></b></div>
          <div class="cols">${cols.map(([n, h]) => `<button class="col${n === colour ? ' on' : ''}${p.variants.some((v) => v.colour === n && canBuy(p, v)) ? '' : ' out'}" data-col="${esc(n)}" aria-label="${esc(n)}"><i style="background:${esc(h)}"></i>${esc(n)}</button>`).join('')}</div>` : ''}

          <div class="opt-h"><b>Select size <span id="sizeMsg"></span></b><button class="link" id="sgOpen">${I.ruler && ''}Size guide</button></div>
          <div class="sizes" id="sizes"></div>
          <div class="hint" id="sizeHint">${state.mySize ? `Your size: <b>${esc(state.mySize.size)}</b> · <button class="link" id="refit">change</button>` : `Not sure? <button class="link" id="refit">Find my size in 10 seconds</button>`}</div>
          ${fitTotal ? `<div class="fit-note"><span class="muted">Runs small</span><span class="fit-bar"><i style="left:${fitPos}%"></i></span><span class="muted">Runs large</span></div>
            <div class="hint">${Math.round(((p.fit_true || 0) / fitTotal) * 100)}% of buyers say it fits as expected</div>` : ''}

          <div class="cta-row">
            <button class="btn wish line${state.wish.has(p.id) ? ' on' : ''}" data-wishbtn="${p.id}" aria-label="Wishlist">${I.heart}</button>
            <button class="btn line" id="addBag">${I.bag}Add to bag</button>
            <button class="btn" id="buyNow">Buy now</button>
          </div>

          <div class="deliver">
            <b style="display:flex;gap:8px;align-items:center;font-size:13.5px">${I.pin} Check delivery</b>
            <form id="pinF" style="margin-top:10px"><input id="pinIn" inputmode="numeric" maxlength="6" placeholder="Enter pincode" value="${esc(pin)}" aria-label="Pincode"><button class="btn sm" type="submit">Check</button></form>
            <ul id="pinOut">
              <li>${I.truck}<span>${s.free_shipping_above > 0 ? `Free delivery above ${esc(inr(s.free_shipping_above))}` : 'Free delivery'}</span></li>
              <li>${I.swap}<span>${s.return_window_days || 15}-day easy exchange</span></li>
              ${s.cod_enabled ? `<li>${I.cash}<span>Cash on delivery available${s.cod_fee ? ` (₹${s.cod_fee} fee)` : ''}</span></li>` : ''}
            </ul>
          </div>

          ${state.offers.length || s.prepaid_discount_pct ? `<details class="acc" open><summary>Offers</summary><div class="acc-b offer-list">
            ${state.offers.slice(0, 4).map((o) => `<div>${I.tag}<span><b>${esc(o.code)}</b> · ${o.kind === 'percent' ? `${Number(o.value)}% off` : `${esc(inr(o.value))} off`}${Number(o.min_order) ? ` above ${esc(inr(o.min_order))}` : ''}${o.first_order_only ? ' · first order' : ''}${o.description ? ` · ${esc(o.description)}` : ''}</span></div>`).join('')}
            ${s.prepaid_discount_pct ? `<div>${I.tag}<span><b>Pay online</b> · extra ${s.prepaid_discount_pct}% off${s.prepaid_discount_max ? ` up to ${esc(inr(s.prepaid_discount_max))}` : ''}</span></div>` : ''}
            ${state.bundles.map((b) => `<div>${I.gift}<span><b>${esc(b.name)}</b> · any ${esc(b.qty)} for ${esc(inr(b.price))}, applied in your bag</span></div>`).join('')}
          </div></details>` : ''}
          <details class="acc" open><summary>Product details</summary><div class="acc-b">
            <div class="specs">
              ${[['Fit', p.type || 'Oversized'], ['Fabric', p.fabric], ['Weight', p.gsm ? `${p.gsm} GSM` : ''], ['Neck', 'Round neck'], ['Sleeve', 'Half sleeve, drop shoulder'], ['Wash', 'Machine wash cold, inside out']]
                .filter(([, v]) => v).map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join('')}
            </div>
            ${p.description ? `<p style="white-space:pre-line">${esc(p.description)}</p>` : ''}
          </div></details>
          <details class="acc"><summary>Delivery & returns</summary><div class="acc-b">
            Ships in 1–2 days. Most cities get it in 3–6 days. Track it live with your order number.<br><br>
            Wrong size? Ask for an exchange within ${s.return_window_days || 15} days of delivery from your order page. Keep the tags on.
          </div></details>
        </div>
      </div>

      <section class="sec" id="reviews"></section>
      <section class="sec" id="pairs"></section>
      <section class="sec" id="similar"></section>
      </div>
      <div class="sticky-buy"><button class="btn wish line${state.wish.has(p.id) ? ' on' : ''}" data-wishbtn="${p.id}" aria-label="Wishlist">${I.heart}</button><button class="btn line" id="addBag2">Add to bag</button><button class="btn" id="buyNow2">Buy now</button></div>`;

    // gallery
    const gm = $('galMain');
    gm.addEventListener('scroll', debounce(() => {
      const i = Math.round(gm.scrollLeft / gm.clientWidth);
      main.querySelectorAll('.gal-dots i').forEach((d, j) => d.classList.toggle('on', i === j));
      main.querySelectorAll('[data-th]').forEach((d, j) => d.classList.toggle('on', i === j));
    }, 60));
    main.querySelectorAll('[data-th]').forEach((b) => { b.onclick = () => gm.scrollTo({ left: gm.clientWidth * Number(b.dataset.th), behavior: 'smooth' }); });
    gm.querySelectorAll('img').forEach((im) => { im.onclick = () => zoom(`<img src="${esc(im.src)}" alt="">`); });
    $('share').onclick = async () => {
      const url = `${location.origin}${location.pathname}#/p/${p.slug}`;
      const text = `${p.name} · ${inr(p.price)} on Z-SHIRTS`;
      if (navigator.share) { try { await navigator.share({ title: p.name, text, url }); } catch (_) { /* cancelled */ } }
      else window.open(`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`, '_blank', 'noopener');
    };
    if ($('toRev')) $('toRev').onclick = (e) => { e.preventDefault(); $('reviews').scrollIntoView({ behavior: 'smooth' }); };
    main.querySelectorAll('[data-wish], [data-wishbtn]').forEach((b) => { b.onclick = (e) => { e.preventDefault(); toggleWish(p.id, b); }; });
    if (p.coming_soon) route.timer = setInterval(() => { const c = $('dropClock'); if (c) c.textContent = countdown(p.drop_at); }, 1000);

    // colour + size
    const paintSizes = () => {
      const vs = p.variants.filter((v) => v.colour === colour).sort((a, b) => SIZE_ORDER.indexOf(a.size) - SIZE_ORDER.indexOf(b.size));
      if (size && !vs.some((v) => v.size === size && canBuy(p, v))) size = null;
      $('sizes').innerHTML = vs.map((v) => {
        const ok = canBuy(p, v);
        const low = !p.is_preorder && v.stock > 0 && v.stock <= 3;
        return `<button class="sz${ok ? '' : ' out'}${size === v.size ? ' on' : ''}" data-size="${esc(v.size)}" data-v="${v.id}" aria-label="Size ${esc(v.size)}${ok ? '' : ', sold out'}">${esc(v.size)}${low ? `<small>${v.stock} left</small>` : ''}${state.mySize && state.mySize.size === v.size ? '<span class="mine">You</span>' : ''}</button>`;
      }).join('');
      $('sizes').querySelectorAll('.sz').forEach((b) => {
        b.onclick = () => {
          const v = p.variants.find((x) => x.id === Number(b.dataset.v));
          if (!canBuy(p, v)) {
            const sh = openSheet(`<h2>${esc(v.size)} is sold out</h2><p class="muted">Get a phone alert the moment ${esc(colour)} / ${esc(v.size)} is back in stock.</p>
              <button class="btn full" id="nm">Notify me</button>`, { title: 'Sold out' });
            sh.querySelector('#nm').onclick = () => { closeSheet(); notifyMe(v); };
            return;
          }
          size = v.size;
          $('sizeMsg').textContent = '';
          paintSizes();
        };
      });
    };
    paintSizes();
    main.querySelectorAll('[data-col]').forEach((b) => {
      b.onclick = () => {
        colour = b.dataset.col;
        main.querySelectorAll('[data-col]').forEach((x) => x.classList.toggle('on', x === b));
        $('colName').textContent = colour;
        if (!(p.images && p.images.length)) gm.innerHTML = `<div>${tee(cols.find(([n]) => n === colour)[1], p.name)}</div>`;
        history.replaceState(null, '', `#/p/${p.slug}?c=${encodeURIComponent(colour)}`);
        paintSizes();
      };
    });
    $('sgOpen').onclick = () => sizeGuideSheet(p);
    $('refit').onclick = () => sizeGuideSheet(p);

    const pick = () => {
      if (p.coming_soon) { toast(`Drops ${dropDate(p.drop_at)}. Check back then!`, true); return null; }
      if (!size) {
        $('sizeMsg').innerHTML = '<span style="color:var(--bad)">· please select a size</span>';
        $('sizes').classList.remove('shake'); void $('sizes').offsetWidth; $('sizes').classList.add('shake');
        $('sizes').scrollIntoView({ behavior: 'smooth', block: 'center' });
        return null;
      }
      return p.variants.find((v) => v.colour === colour && v.size === size);
    };
    const add = (buy) => {
      const v = pick(); if (!v) return;
      if (!addToBag(p, v)) return;
      if (buy) go('#/bag');
      else toast(`Added · ${colour} / ${size}`, false, ' <a href="#/bag">View bag</a>');
    };
    $('addBag').onclick = () => add(false); $('addBag2').onclick = () => add(false);
    $('buyNow').onclick = () => add(true); $('buyNow2').onclick = () => add(true);

    // delivery by pincode
    const checkPin = async (v) => {
      const out = $('pinOut');
      out.innerHTML = `<li>${I.clock}<span>Checking ${esc(v)}…</span></li>`;
      try {
        const d = await deliveryFor(v);
        store.set('zs_pin', v);
        out.innerHTML = `<li>${I.truck}<span><b>Delivery by ${esc(d.by_date ? dayName(d.by_date) : `${d.days} days`)}</b>${d.area ? ` to ${esc(d.area.city)}` : ''}${s.free_shipping_above > 0 && p.price < s.free_shipping_above ? ` · free above ${esc(inr(s.free_shipping_above))}` : ' · free'}</span></li>
          <li class="${d.cod ? '' : 'no'}">${d.cod ? I.cash : I.x}<span>${d.cod ? `Cash on delivery available${s.cod_fee ? ` (₹${s.cod_fee} fee)` : ''}` : 'Cash on delivery not available here, pay online'}</span></li>
          <li>${I.swap}<span>${s.return_window_days || 15}-day easy exchange</span></li>`;
      } catch (e) { out.innerHTML = `<li class="no">${I.x}<span>${esc(errText(e))}</span></li>`; }
    };
    $('pinF').onsubmit = (e) => { e.preventDefault(); const v = $('pinIn').value.replace(/\D/g, ''); if (v.length === 6) checkPin(v); else toast('Enter a 6-digit pincode', true); };
    if (pin.length === 6) checkPin(pin);

    productReviews(p, reviewable);
    // pairs well + similar
    const also = state.also.filter((a) => a.product_id === p.id).sort((a, b) => b.n - a.n).map((a) => byId(a.other_id)).filter((x) => x && available(x)).slice(0, 8);
    const sim = state.products.filter((x) => x.id !== p.id && !also.includes(x)).map((x) => ({ x, s: (x.category_slug === p.category_slug ? 3 : 0) + (x.type === p.type ? 2 : 0) + (Math.abs(x.price - p.price) < 200 ? 1 : 0) + (available(x) ? 1 : 0) }))
      .sort((a, b) => b.s - a.s).slice(0, 10).map((y) => y.x);
    if (also.length) $('pairs').innerHTML = `<div class="sec-h"><h2>Bought <em>together</em></h2></div><div class="rail">${also.map(card).join('')}</div>`;
    if (sim.length) $('similar').innerHTML = `<div class="sec-h"><h2>You may also like</h2></div><div class="rail">${sim.map(card).join('')}</div>`;
    const rv = state.viewed.filter((x) => x !== p.id).map(byId).filter(Boolean).slice(0, 8);
    if (rv.length) $('similar').insertAdjacentHTML('afterend', `<section class="sec"><div class="sec-h"><h2>Recently viewed</h2></div><div class="rail">${rv.map(card).join('')}</div></section>`);
    bindCards($('pairs')); bindCards($('similar').parentNode);
  };

  async function productReviews(p, reviewable) {
    const box = $('reviews');
    if (!box) return;
    const { data } = await sb.from('public_reviews').select('*').eq('product_id', p.id).order('created_at', { ascending: false }).limit(50);
    const list = data || [];
    const canWrite = reviewable && !reviewable.reviewed;
    if (!list.length && !canWrite) { box.innerHTML = ''; return; }
    const dist = [5, 4, 3, 2, 1].map((n) => list.filter((r) => r.rating === n).length);
    const photos = list.flatMap((r) => r.photos || []).slice(0, 10);
    const avg = list.length ? list.reduce((a, r) => a + r.rating, 0) / list.length : 0;
    let filter = 0;
    const paint = () => {
      const shown = filter ? list.filter((r) => r.rating === filter) : list;
      box.innerHTML = `<div class="sec-h"><h2>Ratings & <em>reviews</em></h2>${canWrite || reviewable ? '<button class="btn sm line" id="wrRev">Write a review</button>' : ''}</div>
        ${list.length ? `<div class="rv-top">
          <div class="rv-score"><b>${avg.toFixed(1)} <i>★</i></b><div class="muted small">${list.length} verified rating${list.length === 1 ? '' : 's'}</div></div>
          <div class="rv-bars">${dist.map((n, i) => `<div><button class="link small" data-rf="${5 - i}">${5 - i}★</button><span><i style="width:${list.length ? (n / list.length) * 100 : 0}%"></i></span><small class="muted">${n}</small></div>`).join('')}</div>
          ${photos.length ? `<div><div class="muted small" style="font-weight:700;margin-bottom:6px">Customer photos</div><div class="rv-photos">${photos.map((u) => `<img src="${esc(u)}" alt="Customer photo" loading="lazy">`).join('')}</div></div>` : '<div></div>'}
        </div>
        ${filter ? `<div class="applied" style="margin-top:14px"><button class="chip" id="rfClear">${filter}★ only ${I.x}</button></div>` : ''}
        <div style="margin-top:12px">${shown.slice(0, 12).map((r) => `<div class="rv">
          <div><span class="stars">${r.rating} ★</span> <h5 style="display:inline">${esc(r.title || '')}</h5></div>
          ${r.body ? `<p>${esc(r.body)}</p>` : ''}
          ${r.photos && r.photos.length ? `<div class="rv-photos">${r.photos.map((u) => `<img src="${esc(u)}" alt="" loading="lazy">`).join('')}</div>` : ''}
          <div class="meta">${esc(r.author)}${r.verified ? ' · <span class="v">Verified buyer</span>' : ''}${r.size_bought ? ` · bought ${esc(r.size_bought)}` : ''}${r.fit ? ` · ${{ small: 'runs small', true: 'true to size', large: 'runs large' }[r.fit]}` : ''} · ${esc(new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }))}</div>
        </div>`).join('')}</div>` : '<p class="muted">Be the first to review this tee.</p>'}`;
      box.querySelectorAll('[data-rf]').forEach((b) => { b.onclick = () => { filter = Number(b.dataset.rf); paint(); }; });
      if ($('rfClear')) $('rfClear').onclick = () => { filter = 0; paint(); };
      box.querySelectorAll('.rv-photos img').forEach((im) => { im.onclick = () => zoom(`<img src="${esc(im.src)}" alt="">`); });
      if ($('wrRev')) $('wrRev').onclick = () => reviewSheet(p);
    };
    paint();
  }

  function reviewSheet(p) {
    if (!state.account) { toast('Sign in to write a review', true); go('#/account'); return; }
    let rating = 0, fit = '';
    const files = [];
    const b = openSheet(`<h2>Rate ${esc(p.name)}</h2>
      <form class="form" id="rvF">
        <div class="star-input" role="radiogroup" aria-label="Rating">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-st="${n}" aria-label="${n} star">${I.star}</button>`).join('')}</div>
        <label>How did it fit?</label>
        <div class="chips">${[['small', 'Runs small'], ['true', 'True to size'], ['large', 'Runs large']].map(([k, l]) => `<button type="button" class="chip" data-fit="${k}">${l}</button>`).join('')}</div>
        <label for="rvT">Title</label><input id="rvT" maxlength="80" placeholder="e.g. Perfect oversized fit">
        <label for="rvB">Your review</label><textarea id="rvB" maxlength="1000" placeholder="Fabric, fit, colour, how it washed…"></textarea>
        <label for="rvP">Add photos (optional, up to 4)</label><input id="rvP" type="file" accept="image/*" multiple style="padding:10px">
        <div class="err" id="rvE"></div>
        <button class="btn full" style="margin-top:16px" type="submit">Submit review</button>
      </form>`, { title: 'Review' });
    b.querySelectorAll('[data-st]').forEach((x) => { x.onclick = () => { rating = Number(x.dataset.st); b.querySelectorAll('[data-st]').forEach((y) => y.classList.toggle('on', Number(y.dataset.st) <= rating)); }; });
    b.querySelectorAll('[data-fit]').forEach((x) => { x.onclick = () => { fit = x.dataset.fit; b.querySelectorAll('[data-fit]').forEach((y) => y.classList.toggle('on', y === x)); }; });
    b.querySelector('#rvP').onchange = (e) => { files.length = 0; files.push(...[...e.target.files].slice(0, 4)); };
    b.querySelector('#rvF').onsubmit = async (e) => {
      e.preventDefault();
      const err = b.querySelector('#rvE');
      if (!rating) { err.textContent = 'Tap the stars to rate it.'; return; }
      const btn = b.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Sending…';
      const photos = [];
      for (const f of files) {
        if (f.size > 5e6) continue;
        const path = `${state.user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${(f.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')}`;
        const up = await sb.storage.from('reviews').upload(path, f, { contentType: f.type });
        if (!up.error) photos.push(sb.storage.from('reviews').getPublicUrl(path).data.publicUrl);
      }
      const { error } = await sb.rpc('add_review', { p: { product_id: p.id, rating, fit, title: b.querySelector('#rvT').value, body: b.querySelector('#rvB').value, photos } });
      if (error) { err.textContent = errText(error); btn.disabled = false; btn.textContent = 'Submit review'; return; }
      closeSheet();
      if (window.ZSCelebrate) window.ZSCelebrate.confetti(0.6);
      toast('Thanks! Your review is live');
      await refreshAccount();
      if (route.path === 'p') productReviews(p, null);
    };
  }

  // quick size picker (wishlist → bag, bag size change)
  function quickAdd(p, after) {
    const cols = coloursOf(p);
    let colour = (cols.find(([n]) => p.variants.some((v) => v.colour === n && canBuy(p, v))) || cols[0] || [''])[0];
    const b = openSheet(`<div style="display:grid;grid-template-columns:84px 1fr;gap:14px;align-items:center"><div class="bline" style="padding:0;border:0;display:block"><div class="im">${imgOf(p)}</div></div>
        <div><b>${esc(p.name)}</b><div class="price" style="margin-top:4px"><b>${esc(inr(p.price))}</b>${p.mrp > p.price ? ` <s class="muted">${esc(inr(p.mrp))}</s> <span style="color:var(--off);font-weight:800">${p.discount_pct}% OFF</span>` : ''}</div></div></div>
      ${cols.length > 1 ? `<div class="opt-h"><b>Colour</b></div><div class="cols">${cols.map(([n, h]) => `<button class="col${n === colour ? ' on' : ''}" data-qc="${esc(n)}"><i style="background:${esc(h)}"></i>${esc(n)}</button>`).join('')}</div>` : ''}
      <div class="opt-h"><b>Select size</b></div><div class="sizes" id="qs"></div>
      <button class="btn full" style="margin-top:20px" id="qDone" disabled>Select a size</button>`, { title: 'Pick size' });
    let vid = null;
    const paint = () => {
      b.querySelector('#qs').innerHTML = p.variants.filter((v) => v.colour === colour).map((v) => `<button class="sz${canBuy(p, v) ? '' : ' out'}" data-q="${v.id}" ${canBuy(p, v) ? '' : 'disabled'}>${esc(v.size)}${state.mySize && state.mySize.size === v.size ? '<span class="mine">You</span>' : ''}</button>`).join('');
      b.querySelectorAll('[data-q]').forEach((x) => { x.onclick = () => { vid = Number(x.dataset.q); b.querySelectorAll('[data-q]').forEach((y) => y.classList.toggle('on', y === x)); const d = b.querySelector('#qDone'); d.disabled = false; d.textContent = 'Done'; }; });
    };
    paint();
    b.querySelectorAll('[data-qc]').forEach((x) => { x.onclick = () => { colour = x.dataset.qc; vid = null; b.querySelectorAll('[data-qc]').forEach((y) => y.classList.toggle('on', y === x)); paint(); }; });
    b.querySelector('#qDone').onclick = () => { const v = p.variants.find((x) => x.id === vid); if (v) { closeSheet(); after(v); } };
  }

  // ================================================================ WISHLIST
  PAGES.wishlist = () => {
    const list = [...state.wish].map(byId).filter(Boolean);
    main.innerHTML = `<div class="wrap"><div class="list-top"><h1 class="page">Wishlist</h1></div><div class="muted small">${list.length} saved</div>
      ${list.length ? `<div class="grid" style="margin-top:14px">${list.map((p, i) => `<div>${card(p, i)}<button class="btn line sm full" style="margin-top:8px" data-mv="${p.id}" ${available(p) ? '' : 'disabled'}>${available(p) ? 'Move to bag' : 'Sold out'}</button></div>`).join('')}</div>`
        : `<div class="empty-box"><div class="big-ic">${I.heart}</div><h3>Your wishlist is empty</h3><p>Tap the heart on any tee to save it for later.</p><a class="btn" href="#/shop">Explore tees</a></div>`}
      ${!state.account && list.length ? '<p class="muted small" style="text-align:center;margin-top:20px"><a class="link" href="#/account">Sign in</a> to keep your wishlist on every device.</p>' : ''}</div>`;
    bindCards(main);
    main.querySelectorAll('[data-mv]').forEach((b) => {
      b.onclick = () => { const p = byId(Number(b.dataset.mv)); quickAdd(p, (v) => { if (addToBag(p, v)) { toggleWish(p.id); toast('Moved to bag', false, ' <a href="#/bag">View bag</a>'); } }); };
    });
  };

  // ================================================================ COMPARE
  PAGES.compare = () => {
    const list = state.cmp.map(byId).filter(Boolean);
    if (list.length < 2) {
      main.innerHTML = `<div class="wrap"><h1 class="page" style="margin-top:20px">Compare</h1><div class="empty-box"><div class="big-ic">${I.cmp}</div><h3>Pick at least 2 tees</h3><p>Tap "Compare" on any tee card to put it side by side.</p><a class="btn" href="#/shop">Choose tees</a></div>
        ${list.length ? `<div class="grid" style="max-width:300px">${list.map(card).join('')}</div>` : ''}</div>`;
      bindCards(main); return;
    }
    const min = Math.min(...list.map((p) => p.price));
    const maxR = Math.max(...list.map((p) => p.rating));
    const maxG = Math.max(...list.map((p) => p.gsm || 0));
    const maxOff = Math.max(...list.map((p) => p.discount_pct || 0));
    const sizesOf = (p) => SIZE_ORDER.filter((z) => p.variants.some((v) => v.size === z && canBuy(p, v)));
    const row = (label, fn) => `<tr><th>${label}</th>${list.map((p) => `<td>${fn(p)}</td>`).join('')}</tr>`;
    main.innerHTML = `<div class="wrap"><div class="crumb"><a href="#/">Home</a> / Compare</div><h1 class="page">Compare <em>${list.length}</em> tees</h1>
      <div class="cmp"><table>
        <tr><th></th>${list.map((p) => `<td><a href="#/p/${esc(p.slug)}" style="display:block;aspect-ratio:4/5;border-radius:12px;overflow:hidden;background:var(--soft)">${imgOf(p)}</a><b style="display:block;margin-top:8px">${esc(p.name)}</b><button class="link small" data-rmc="${p.id}">Remove</button></td>`).join('')}</tr>
        ${row('Price', (p) => `<span class="${p.price === min ? 'best-v' : ''}">${esc(inr(p.price))}</span>${p.mrp > p.price ? ` <s class="muted small">${esc(inr(p.mrp))}</s>` : ''}`)}
        ${row('Discount', (p) => (p.discount_pct ? `<span class="${p.discount_pct === maxOff ? 'best-v' : ''}">${p.discount_pct}% off</span>` : '—'))}
        ${row('Best price', (p) => { const d = bestDeal(p); return d ? `${esc(inr(d.price))}${d.code ? ` <span class="muted small">with ${esc(d.code)}</span>` : ''}` : '—'; })}
        ${row('Rating', (p) => (p.rating_count ? `<span class="${p.rating === maxR ? 'best-v' : ''}">${p.rating.toFixed(1)} ★</span> <span class="muted small">(${p.rating_count})</span>` : '<span class="muted">No ratings yet</span>'))}
        ${row('Fit', (p) => esc(p.type || '—'))}
        ${row('Fabric', (p) => esc(p.fabric || '—'))}
        ${row('Weight', (p) => (p.gsm ? `<span class="${p.gsm === maxG ? 'best-v' : ''}">${p.gsm} GSM</span>` : '—'))}
        ${row('Colours', (p) => `<div class="dots">${coloursOf(p).map(([n, h]) => `<i title="${esc(n)}" style="background:${esc(h)}"></i>`).join('')}</div>`)}
        ${row('Sizes in stock', (p) => (sizesOf(p).join(', ') || '<span style="color:var(--bad)">Sold out</span>'))}
        ${row('Fit feedback', (p) => { const t = (p.fit_small || 0) + (p.fit_true || 0) + (p.fit_large || 0); return t ? `${Math.round((p.fit_true / t) * 100)}% say true to size` : '—'; })}
        ${row('Bought', (p) => (p.sold_count ? `${p.sold_count}+ times` : 'New'))}
        <tr><th></th>${list.map((p) => `<td><a class="btn sm full" href="#/p/${esc(p.slug)}">View & buy</a></td>`).join('')}</tr>
      </table></div></div>`;
    main.querySelectorAll('[data-rmc]').forEach((b) => { b.onclick = () => { toggleCompare(Number(b.dataset.rmc)); render(); }; });
  };

  // ================================================================ BAG
  function priceDetails(q, opts = {}) {
    if (!q) return '<div class="pd"><div class="muted small">Working out your price…</div></div>';
    const n = q.lines ? q.lines.reduce((a, l) => a + (l.qty || 0), 0) : 0;
    const mrpOff = q.mrp_total - q.subtotal;
    const saved = q.mrp_total - q.total + q.shipping + (q.cod_fee || 0);
    return `<div class="pd">
      <div><span>Total MRP${n ? ` (${n} item${n === 1 ? '' : 's'})` : ''}</span><span>${esc(inr(q.mrp_total))}</span></div>
      ${mrpOff > 0 ? `<div><span>Discount on MRP</span><span class="g">− ${esc(inr(mrpOff))}</span></div>` : ''}
      ${q.bundle_discount > 0 ? `<div><span>Combo · ${esc(q.bundle_name)}</span><span class="g">− ${esc(inr(q.bundle_discount))}</span></div>` : ''}
      ${q.coupon_discount > 0 ? `<div><span>Coupon ${esc(q.coupon_code)}</span><span class="g">− ${esc(inr(q.coupon_discount))}</span></div>` : ''}
      ${q.prepaid_discount > 0 ? `<div><span>Online payment offer</span><span class="g">− ${esc(inr(q.prepaid_discount))}</span></div>` : ''}
      ${q.points_used > 0 ? `<div><span>Z-Club points</span><span class="g">− ${esc(inr(q.points_used))}</span></div>` : ''}
      <div><span>Delivery</span><span>${q.shipping ? esc(inr(q.shipping)) : '<span class="g">FREE</span>'}</span></div>
      ${q.cod_fee > 0 ? `<div><span>Cash on delivery fee</span><span>${esc(inr(q.cod_fee))}</span></div>` : ''}
      <div class="tot"><span>Total amount</span><span>${esc(inr(q.total))}</span></div>
      ${saved > 0 ? `<div class="saved">You save ${esc(inr(saved))} on this order</div>` : ''}
      ${opts.offerHint && q.prepaid_offer > 0 && !q.prepaid_discount ? `<div class="hint good" style="justify-content:flex-start">Pay online and save ${esc(inr(q.prepaid_offer))} more</div>` : ''}
      ${q.points_earn > 0 ? `<div class="hint" style="justify-content:flex-start">${state.account ? `+${q.points_earn} Z-Club points after delivery` : `<span>Sign in to earn <b>${q.points_earn}</b> Z-Club points</span>`}</div>` : ''}
    </div>`;
  }
  function comboNudge(q) {
    if (q && q.bundle_name) return `<div class="ship-note"><b>${esc(q.bundle_name)}</b> applied · you save ${esc(inr(q.bundle_discount))}</div>`;
    for (const b of state.bundles) {
      const n = state.bag.reduce((s, x) => s + ((!b.product_ids || !b.product_ids.length || b.product_ids.includes(x.product_id)) ? x.qty : 0), 0);
      if (n > 0 && n < b.qty) return `<div class="ship-note">Add <b>${b.qty - n} more</b> to unlock <b>${esc(b.name)}</b> · <a class="link" href="#/shop?tag=combo">Add tees</a></div>`;
    }
    return '';
  }
  function couponSave(o, sub) {
    if (o.first_order_only && usedFirst()) return { ok: false, why: 'Only for your first order' };
    if (Number(o.min_order) > sub) return { ok: false, why: `Add ${inr(Number(o.min_order) - sub)} more to use this` };
    let d = o.kind === 'percent' ? Math.round(sub * Number(o.value) / 100) : Number(o.value);
    if (o.max_discount) d = Math.min(d, Number(o.max_discount));
    return { ok: true, d };
  }
  PAGES.bag = async () => {
    const lines = state.bag.map((b, i) => ({ ...b, i, ...(variantOf(b.variant_id) || {}) }));
    if (!lines.length) {
      const wl = [...state.wish].map(byId).filter((p) => p && available(p)).slice(0, 8);
      main.innerHTML = `<div class="wrap"><div class="empty-box" style="margin-top:30px"><div class="big-ic">${I.bag}</div><h3>Your bag is empty</h3><p>There's a fit waiting for you.</p><a class="btn" href="#/shop">Start shopping</a></div>
        ${wl.length ? `<section class="sec"><div class="sec-h"><h2>From your wishlist</h2></div><div class="rail">${wl.map(card).join('')}</div></section>` : ''}</div>`;
      bindCards(main); return;
    }
    const s = S();
    let coupon = store.get('zs_coupon', session.get('zs_attr', {}).coupon || '');
    const qtyOpts = (l) => Array.from({ length: Math.min(10, l.p.is_preorder ? 10 : Math.max(l.v.stock, l.qty)) }, (_, k) => k + 1);
    main.innerHTML = `<div class="wrap">
      <div class="steps-h"><b>Bag</b><i></i><span>Address</span><i></i><span>Payment</span></div>
      <div class="bag-layout">
        <div>
          <div class="box" id="shipBox"></div>
          <div class="box"><h3>${lines.length} item${lines.length === 1 ? '' : 's'} in your bag</h3>
            ${lines.map((l) => `<div class="bline">
              <a class="im" href="#/p/${esc(l.p.slug)}">${imgOf(l.p, 0, l.v.hex)}</a>
              <div>
                <a class="nm" href="#/p/${esc(l.p.slug)}">${esc(l.p.name)}</a>
                <div class="muted small">${esc(l.v.colour)}${l.p.is_preorder ? ' · made to order' : ''}</div>
                <div class="sels">
                  <select data-size="${l.i}" aria-label="Size">${l.p.variants.filter((v) => v.colour === l.v.colour).map((v) => `<option value="${v.id}" ${v.id === l.v.id ? 'selected' : ''} ${canBuy(l.p, v) || v.id === l.v.id ? '' : 'disabled'}>Size: ${esc(v.size)}${canBuy(l.p, v) ? '' : ' (sold out)'}</option>`).join('')}</select>
                  <select data-qty="${l.i}" aria-label="Quantity">${qtyOpts(l).map((n) => `<option ${n === l.qty ? 'selected' : ''}>${n}</option>`).join('')}</select>
                </div>
                <div class="price"><b>${esc(inr(l.p.price * l.qty))}</b>${l.p.mrp > l.p.price ? `<s>${esc(inr(l.p.mrp * l.qty))}</s><span class="off">${l.p.discount_pct}% OFF</span>` : ''}</div>
                ${!l.p.is_preorder && l.v.stock < l.qty ? `<div class="err">Only ${l.v.stock} left in this size</div>` : !l.p.is_preorder && l.v.stock <= 3 ? `<div class="urgent">Only ${l.v.stock} left</div>` : ''}
                <div class="acts"><button data-rm="${l.i}">Remove</button><button data-save="${l.i}">Move to wishlist</button></div>
              </div></div>`).join('')}
          </div>
          <div id="bagErr"></div>
        </div>
        <div class="side">
          <div class="box"><h3>Coupons</h3><div id="cpnBox"></div></div>
          <div class="box"><h3>Price details</h3><div id="pdBox">${priceDetails(null)}</div>
            <a class="btn full hide-m" href="#/checkout" id="toCo" style="margin-top:14px">Place order</a>
            <div class="secure">${I.lock} Safe & secure payments · Easy exchange</div></div>
        </div>
      </div></div>
      <div class="pay-bar"><div class="t"><b id="pbT">…</b><a href="#" id="pbView">View price details</a></div><a class="btn" href="#/checkout">Place order</a></div>`;
    const reload = () => { render(); };
    main.querySelectorAll('[data-size]').forEach((x) => {
      x.onchange = () => {
        const b = state.bag[Number(x.dataset.size)];
        const nv = Number(x.value);
        const dup = state.bag.find((y) => y.variant_id === nv);
        if (dup && dup !== b) { dup.qty += b.qty; state.bag.splice(Number(x.dataset.size), 1); } else b.variant_id = nv;
        saveBag(true); reload();
      };
    });
    main.querySelectorAll('[data-qty]').forEach((x) => { x.onchange = () => { state.bag[Number(x.dataset.qty)].qty = Number(x.value); saveBag(true); reload(); }; });
    main.querySelectorAll('[data-rm]').forEach((x) => {
      x.onclick = () => {
        const [gone] = state.bag.splice(Number(x.dataset.rm), 1); saveBag(true); reload();
        toast('Removed from bag', false, ' <button class="link" id="undo" style="color:var(--lime)">Undo</button>');
        setTimeout(() => { const u = $('undo'); if (u) u.onclick = () => { state.bag.splice(Number(x.dataset.rm), 0, gone); saveBag(true); reload(); $('toast').className = ''; }; }, 0);
      };
    });
    main.querySelectorAll('[data-save]').forEach((x) => {
      x.onclick = () => { const b = state.bag[Number(x.dataset.save)]; if (!state.wish.has(b.product_id)) toggleWish(b.product_id); state.bag.splice(Number(x.dataset.save), 1); saveBag(true); reload(); };
    });
    $('pbView').onclick = (e) => { e.preventDefault(); $('pdBox').scrollIntoView({ behavior: 'smooth', block: 'center' }); };

    const paintCoupons = (q) => {
      const sub = q ? q.subtotal - (q.bundle_discount || 0) : lines.reduce((a, l) => a + l.p.price * l.qty, 0);
      const offers = state.offers.map((o) => ({ o, r: couponSave(o, sub) })).sort((a, b) => (b.r.ok - a.r.ok) || ((b.r.d || 0) - (a.r.d || 0)));
      const box = $('cpnBox');
      box.innerHTML = `${q && q.coupon_code ? `<div class="applied-cpn"><span>${I.check && ''}<b>${esc(q.coupon_code)}</b> applied · you save ${esc(inr(q.coupon_discount))}</span><button class="link" id="cpnRm">Remove</button></div>` : ''}
        ${q && coupon && q.coupon_error ? `<div class="err">${esc(q.coupon_error)}</div>` : ''}
        <form class="coupon-in" id="cpnF" style="margin-top:10px"><input id="cpnIn" placeholder="Enter coupon code" value="${q && q.coupon_code ? '' : esc(coupon)}" aria-label="Coupon code"><button class="btn sm line" type="submit">Apply</button></form>
        ${offers.filter(({ o }) => !q || o.code !== q.coupon_code).slice(0, 5).map(({ o, r }) => `<div class="cpn${r.ok ? '' : ' no'}"><div style="flex:1"><span class="code">${esc(o.code)}</span>
          ${r.ok ? `<span class="save-n"> Save ${esc(inr(r.d))}</span>` : ''}<p>${esc(o.description || (o.kind === 'percent' ? `${Number(o.value)}% off` : `${inr(o.value)} off`))}${o.first_order_only ? ' · first order only' : ''}</p>${r.ok ? '' : `<p class="muted small">${esc(r.why)}</p>`}</div>
          ${r.ok ? `<button class="btn sm" data-cpn="${esc(o.code)}">Apply</button>` : ''}</div>`).join('')}`;
      $('cpnF').onsubmit = (e) => { e.preventDefault(); coupon = $('cpnIn').value.trim().toUpperCase(); store.set('zs_coupon', coupon); refresh(); };
      box.querySelectorAll('[data-cpn]').forEach((b) => { b.onclick = () => { coupon = b.dataset.cpn; store.set('zs_coupon', coupon); refresh(); }; });
      if ($('cpnRm')) $('cpnRm').onclick = () => { coupon = ''; store.set('zs_coupon', ''); refresh(); };
    };
    const paintShip = (q) => {
      const sub = q ? q.total - q.shipping - (q.cod_fee || 0) : 0;
      const left = s.free_shipping_above - sub;
      $('shipBox').innerHTML = `${s.free_shipping_above > 0 ? `<div class="ship-note">${left > 0 ? `Add <b style="color:var(--ink)">${esc(inr(left))}</b> more for <b>FREE delivery</b>` : `${I.check && ''}<b>Yay! FREE delivery unlocked</b>`}</div><div class="meter"><i style="width:${Math.min(100, (sub / s.free_shipping_above) * 100)}%"></i></div>` : '<div class="ship-note"><b>FREE delivery</b> on this order</div>'}
        <div style="margin-top:8px">${comboNudge(q)}</div>`;
    };
    const refresh = async () => {
      paintCoupons(null); paintShip(null);
      try {
        const q = await quote({ coupon: coupon || null, pay: 'online' });
        $('pdBox').innerHTML = priceDetails(q);
        $('pbT').textContent = inr(q.total);
        $('bagErr').innerHTML = q.errors && q.errors.length ? `<div class="err">${q.errors.map(esc).join('<br>')}</div>` : '';
        paintCoupons(q); paintShip(q);
        if (q.coupon_code) store.set('zs_coupon', q.coupon_code);
      } catch (e) { $('pdBox').innerHTML = `<div class="err">${esc(errText(e))}</div>`; }
    };
    refresh();
  };

  // ================================================================ CHECKOUT
  const isPhone = (v) => /^[6-9]\d{9}$/.test(v);
  PAGES.checkout = () => {
    if (!state.bag.length) { go('#/bag', true); return; }
    const s = S();
    const acc = state.account;
    const saved = (acc && acc.addresses) || [];
    const c = store.get('zs_customer', {});
    const a = c.address || {};
    const attr = session.get('zs_attr', {});
    const opts = { coupon: store.get('zs_coupon', attr.coupon || '') || null, points: 0, pay: 'online' };
    let addrId = saved.length ? saved[0].id : null;
    let q = null, codOk = !!s.cod_enabled, area = null;

    main.innerHTML = `<div class="wrap">
      <div class="steps-h"><a href="#/bag">Bag</a><i></i><b>Address</b><i></i><span>Payment</span></div>
      <div class="bag-layout">
        <div>
          ${acc ? '' : `<div class="box"><h3>Faster checkout</h3><button class="google" id="coG" type="button">${googleIcon()} Continue with Google</button>
            <p class="muted small" style="text-align:center;margin:8px 0 0">Earn Z-Club points, save addresses and track orders. Or continue as guest below.</p></div>`}
          <div class="box"><h3>Delivery address ${saved.length ? '<button class="link small" id="addNew" type="button">+ Add new</button>' : ''}</h3>
            <div id="addrList">${saved.map((x) => `<label class="addr${x.id === addrId ? ' on' : ''}"><input type="radio" name="ad" value="${x.id}" ${x.id === addrId ? 'checked' : ''}>
              <span><b>${esc(x.name)}</b><span class="tag">${esc(x.label)}</span><div class="small" style="margin-top:4px">${esc([x.line1, x.line2, x.city, x.state].filter(Boolean).join(', '))} - ${esc(x.pincode)}</div><div class="small muted">Mobile: ${esc(x.phone)}</div></span></label>`).join('')}</div>
            <form class="form" id="adF" novalidate ${saved.length ? 'hidden' : ''}>
              <div class="row2"><div><label for="coName">Full name</label><input id="coName" autocomplete="name" value="${esc(c.name || (acc && acc.name) || '')}"></div>
                <div><label for="coPhone">Mobile number</label><input id="coPhone" inputmode="numeric" autocomplete="tel-national" maxlength="10" value="${esc(c.phone || (acc && acc.phone) || '')}" placeholder="10 digits"></div></div>
              <div class="row2"><div><label for="coPin">Pincode</label><input id="coPin" inputmode="numeric" autocomplete="postal-code" maxlength="6" value="${esc(a.pincode || store.get('zs_pin', ''))}"></div>
                <div><label for="coCity">City</label><input id="coCity" autocomplete="address-level2" value="${esc(a.city || '')}"></div></div>
              <div class="hint" id="pinHint">City and state fill in from the pincode.</div>
              <label for="coLine1">House no., building, street</label><input id="coLine1" autocomplete="address-line1" value="${esc(a.line1 || '')}">
              <label for="coLine2">Area, landmark (optional)</label><input id="coLine2" autocomplete="address-line2" value="${esc(a.line2 || '')}">
              <label for="coState">State</label><input id="coState" autocomplete="address-level1" value="${esc(a.state || '')}">
              ${acc ? '' : `<label for="coEmail">E-mail (optional, for the invoice)</label><input id="coEmail" type="email" autocomplete="email" value="${esc(c.email || '')}">`}
              ${acc ? `<label>Save as</label><div class="chips">${['Home', 'Work', 'Other'].map((l, i) => `<button type="button" class="chip${i ? '' : ' on'}" data-lb="${l}">${l}</button>`).join('')}</div>` : ''}
            </form>
            <div class="hint" id="etaHint"></div>
          </div>
          <div class="box"><h3>Payment method</h3>
            <label class="pay-opt on" id="poOn"><input type="radio" name="pay" value="online" checked><span><b>Pay online <span class="tagg" id="preTag" hidden></span></b><span class="muted small">UPI, cards, wallets, netbanking</span>
              <div class="pay-logos"><span>GPay</span><span>PhonePe</span><span>Paytm</span><span>Visa</span><span>Mastercard</span><span>RuPay</span></div></span></label>
            ${s.cod_enabled ? `<label class="pay-opt" id="poCod"><input type="radio" name="pay" value="cod"><span><b>Cash on delivery</b><span class="muted small" id="codNote">Pay in cash or UPI when it arrives${s.cod_fee ? ` · ₹${s.cod_fee} handling fee` : ''}</span></span></label>` : ''}
            ${acc && acc.points > 0 ? `<label class="pay-opt" style="margin-top:14px"><input type="checkbox" id="coPts"><span><b>Use Z-Club points</b><span class="muted small" id="ptsNote">You have ${acc.points} points (worth ${esc(inr(acc.points))})</span></span></label>` : ''}
          </div>
        </div>
        <div class="side">
          <div class="box"><h3>Price details</h3><div id="pdBox">${priceDetails(null)}</div>
            <div class="err" id="coErr" role="alert"></div>
            <button class="btn full hide-m" id="coGo" style="margin-top:14px">Place order</button>
            <div class="secure">${I.lock} 100% secure payments by Razorpay</div></div>
          <div class="box" style="font-size:13px">${state.bag.map((b) => { const x = variantOf(b.variant_id); return x ? `<div style="display:flex;justify-content:space-between;gap:8px;padding:3px 0"><span>${esc(x.p.name)} · ${esc(x.v.colour)} / ${esc(x.v.size)} × ${b.qty}</span><span>${esc(inr(x.p.price * b.qty))}</span></div>` : ''; }).join('')}</div>
        </div>
      </div></div>
      <div class="pay-bar"><div class="t"><b id="pbT">…</b><a href="#" id="pbView">View price details</a></div><button class="btn" id="coGo2">Place order</button></div>`;

    if ($('coG')) $('coG').onclick = () => signIn('#/checkout');
    $('pbView').onclick = (e) => { e.preventDefault(); $('pdBox').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
    let label = 'Home';
    main.querySelectorAll('[data-lb]').forEach((b) => { b.onclick = () => { label = b.dataset.lb; main.querySelectorAll('[data-lb]').forEach((y) => y.classList.toggle('on', y === b)); }; });
    const usingForm = () => !$('adF').hidden;
    main.querySelectorAll('input[name="ad"]').forEach((r) => {
      r.onchange = () => { addrId = Number(r.value); main.querySelectorAll('.addr').forEach((l) => l.classList.toggle('on', l.contains(r))); const x = saved.find((y) => y.id === addrId); if (x) eta(x.pincode); };
    });
    if ($('addNew')) $('addNew').onclick = () => { $('adF').hidden = false; addrId = null; main.querySelectorAll('.addr').forEach((l) => { l.classList.remove('on'); l.querySelector('input').checked = false; }); $('coName').focus(); };

    const refresh = debounce(async () => {
      try {
        q = await quote(opts);
        if (q.coupon_error && opts.coupon) {
          toast(`${opts.coupon}: ${q.coupon_error}`, true);
          opts.coupon = null; store.set('zs_coupon', '');
          q = await quote(opts);
        }
        $('pdBox').innerHTML = priceDetails(q, { offerHint: true });
        const label2 = `${opts.pay === 'cod' ? 'Place order' : `Pay ${inr(q.total)}`}`;
        $('coGo').textContent = label2; $('coGo2').textContent = opts.pay === 'cod' ? 'Place order' : 'Pay now';
        $('pbT').textContent = inr(q.total);
        if (q.prepaid_offer > 0) { $('preTag').hidden = false; $('preTag').textContent = `Save ${inr(q.prepaid_offer)}`; }
        if ($('ptsNote') && opts.points) $('ptsNote').textContent = `Using ${q.points_used} points (max ${s.loyalty_max_redeem_pct || 20}% of the order)`;
        $('coErr').textContent = (q.errors || []).join(' ');
      } catch (e) { $('coErr').textContent = errText(e); }
    }, 200);
    refresh();
    main.querySelectorAll('input[name="pay"]').forEach((r) => {
      r.onchange = () => {
        opts.pay = r.value;
        main.querySelectorAll('.pay-opt[id]').forEach((l) => l.classList.toggle('on', l.contains(r)));
        refresh();
      };
    });
    if ($('coPts')) $('coPts').onchange = (e) => { opts.points = e.target.checked ? acc.points : 0; if (!e.target.checked) $('ptsNote').textContent = `You have ${acc.points} points`; refresh(); };

    async function eta(pin) {
      try {
        const d = await deliveryFor(pin);
        area = d.area;
        $('etaHint').innerHTML = `${I.truck && ''}<b style="color:var(--save)">Delivery by ${esc(d.by_date ? dayName(d.by_date) : `${d.days} days`)}</b>${d.area ? ` · ${esc(d.area.city)}, ${esc(d.area.state)}` : ''}`;
        codOk = d.cod && !!s.cod_enabled;
        if ($('poCod')) {
          const r = $('poCod').querySelector('input');
          r.disabled = !codOk;
          $('poCod').classList.toggle('off', !codOk);
          $('codNote').textContent = codOk ? `Pay in cash or UPI when it arrives${s.cod_fee ? ` · ₹${s.cod_fee} handling fee` : ''}` : 'Not available for this pincode';
          if (!codOk && r.checked) { const on = main.querySelector('input[name="pay"][value="online"]'); on.checked = true; on.onchange(); }
        }
        return d;
      } catch (_) { $('etaHint').textContent = ''; return null; }
    }
    const pin = $('coPin');
    pin.addEventListener('input', async () => {
      const v = pin.value.replace(/\D/g, '');
      if (v.length !== 6) return;
      $('pinHint').textContent = 'Finding your area…';
      const d = await eta(v);
      if (d && d.area) { $('coCity').value = d.area.city; $('coState').value = d.area.state; $('pinHint').textContent = `${d.area.city}, ${d.area.state}`; }
      else $('pinHint').textContent = 'Fill in city and state.';
    });
    const first = saved.find((x) => x.id === addrId);
    if (first) eta(first.pincode); else if (pin.value.length === 6) pin.dispatchEvent(new Event('input'));

    const place = async () => {
      const err = $('coErr'); err.textContent = '';
      let customer;
      if (!usingForm() && addrId) {
        const x = saved.find((y) => y.id === addrId);
        customer = { name: x.name, phone: x.phone, email: (acc && acc.email) || '', address: { line1: x.line1, line2: x.line2 || '', city: x.city, state: x.state, pincode: x.pincode } };
      } else {
        const phone = $('coPhone').value.replace(/\D/g, '').slice(-10);
        customer = { name: $('coName').value.trim(), phone, email: $('coEmail') ? $('coEmail').value.trim() : (acc && acc.email) || '',
          address: { line1: $('coLine1').value.trim(), line2: $('coLine2').value.trim(), city: $('coCity').value.trim(), state: $('coState').value.trim(), pincode: pin.value.replace(/\D/g, '') } };
        const bad = (id, m) => { err.textContent = m; toast(m, true); $(id).focus(); $(id).scrollIntoView({ behavior: 'smooth', block: 'center' }); return true; };
        if (customer.name.length < 2 && bad('coName', 'Enter your full name.')) return;
        if (!isPhone(phone) && bad('coPhone', 'Enter a valid 10-digit mobile number.')) return;
        if (customer.address.pincode.length !== 6 && bad('coPin', 'Enter a 6-digit pincode.')) return;
        if (customer.address.line1.length < 3 && bad('coLine1', 'Enter your house no. and street.')) return;
        if (!customer.address.city && bad('coCity', 'Enter your city.')) return;
        if (!customer.address.state && bad('coState', 'Enter your state.')) return;
        store.set('zs_customer', customer);
        if (acc) { const r = await sb.rpc('save_address', { p: { label, name: customer.name, phone, ...customer.address, is_default: !saved.length } }); if (!r.error) refreshAccount(); }
      }

      if (opts.pay === 'cod' && !codOk) { err.textContent = 'Cash on delivery is not available for this pincode.'; return; }
      [$('coGo'), $('coGo2')].forEach((b) => { b.disabled = true; b.textContent = 'Placing order…'; });
      const { data, error } = await sb.rpc('place_web_order', {
        p_customer: customer, p_items: items(), p_method: opts.pay,
        p_opts: { coupon: opts.coupon || null, points: opts.points || 0, utm_source: attr.utm_source || null, utm_campaign: attr.utm_campaign || null,
          source: (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone ? 'app' : 'web' },
      });
      if (error) {
        err.textContent = errText(error); toast(errText(error), true);
        [$('coGo'), $('coGo2')].forEach((b) => { b.disabled = false; b.textContent = 'Place order'; });
        load().catch(() => {});
        return;
      }
      store.set('zs_last_order', { order_no: data.order_no, phone: customer.phone });
      store.set('zs_coupon', '');
      state.bag = []; saveBag(true);
      if (opts.pay === 'cod') { go(`#/order/${data.order_no}?new=1`); return; }
      startPayment(data.order_no, customer);
    };
    $('coGo').onclick = place; $('coGo2').onclick = place;
  };

  // ================================================================ payment (Razorpay)
  async function callPay(body) {
    const r = await fetch(`${cfg.SUPABASE_URL}/functions/v1/razorpay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.SUPABASE_ANON_KEY, Authorization: `Bearer ${cfg.SUPABASE_ANON_KEY}` },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Payment service is not reachable.');
    return d;
  }
  function loadRazorpay() {
    if (window.Razorpay) return Promise.resolve();
    return new Promise((res, rej) => {
      const sc = document.createElement('script');
      sc.src = 'https://checkout.razorpay.com/v1/checkout.js';
      sc.onload = res; sc.onerror = () => rej(new Error('Could not open the payment window. Check your internet.'));
      document.head.appendChild(sc);
    });
  }
  async function startPayment(orderNo, customer) {
    try {
      const [o] = await Promise.all([callPay({ action: 'create', order_no: orderNo }), loadRazorpay()]);
      const rz = new window.Razorpay({
        key: o.key, amount: o.amount, currency: o.currency, order_id: o.razorpay_order_id,
        name: 'Z-SHIRTS', description: `Order ${orderNo}`,
        prefill: { name: customer.name, contact: customer.phone, email: customer.email || undefined },
        theme: { color: '#0e0e10' },
        handler: async (resp) => {
          main.innerHTML = '<div class="wrap done"><h1>Confirming…</h1><p class="muted">Checking your payment with the bank.</p></div>';
          try { await callPay({ action: 'verify', order_no: orderNo, ...resp }); } catch (_) { /* webhook will confirm */ }
          go(`#/order/${orderNo}?new=1`);
        },
        modal: { ondismiss: () => go(`#/order/${orderNo}?pay=1`) },
      });
      rz.open();
    } catch (e) {
      toast(errText(e), true);
      go(`#/order/${orderNo}?pay=1`);
    }
  }

  // ================================================================ ORDER + TRACKING
  const STEPS = [['placed', 'Order placed'], ['confirmed', 'Confirmed'], ['packed', 'Packed'], ['shipped', 'Shipped'], ['delivered', 'Delivered']];
  const MAKING = [['queued', 'In the queue'], ['printing', 'Printing'], ['quality_check', 'Quality check'], ['ready', 'Ready to ship']];
  function statusLabel(o) {
    if (o.production_status && ['placed', 'confirmed'].includes(o.status)) return (MAKING.find((m) => m[0] === o.production_status) || [])[1] || 'Making';
    return { placed: 'Placed', confirmed: 'Confirmed', packed: 'Packed', shipped: 'On the way', delivered: 'Delivered', cancelled: 'Cancelled', rto: 'Returned', returned: 'Returned' }[o.status] || o.status;
  }
  function phoneFor(no) {
    const last = store.get('zs_last_order', {});
    if (last.order_no === no && last.phone) return last.phone;
    const o = state.account && (state.account.orders || []).find((x) => x.order_no === no);
    return (o && o.phone) || (state.account && state.account.phone) || '';
  }
  PAGES.order = async () => {
    const no = route.arg.toUpperCase();
    const phone = route.params.ph || phoneFor(no);
    if (!phone) { go(`#/track?no=${encodeURIComponent(no)}`, true); return; }
    main.innerHTML = `<div class="wrap" style="margin-top:24px"><div class="skel" style="height:200px"></div></div>`;
    const { data: o, error } = await sb.rpc('track_order', { p_order_no: no, p_phone: phone });
    if (route.path !== 'order') return;
    if (error) { main.innerHTML = `<div class="wrap empty-box"><h3>Couldn't open this order</h3><p>${esc(errText(error))}</p><a class="btn" href="#/track">Track another order</a></div>`; return; }
    const fresh = route.params.new === '1';
    const ev = o.events || [];
    const at = (st) => { const e = ev.filter((x) => x.status === st).pop(); return e ? dateOf(e.at) : ''; };
    const bad = { cancelled: 'Cancelled', rto: 'Returned to us by the courier', returned: 'Returned' }[o.status];
    const reached = STEPS.findIndex(([x]) => x === o.status);
    const lastGood = bad ? Math.max(...STEPS.map(([x], i) => (at(x) ? i : -1))) : reached;
    const days = Number(o.return_days) || 0;
    const daysLeft = o.delivered_at ? Math.ceil(days - (Date.now() - new Date(o.delivered_at)) / 864e5) : 0;
    const canAsk = o.status === 'delivered' && o.delivered_at && daysLeft > 0 && !(o.requests || []).some((r) => ['open', 'approved'].includes(r.status));
    const waiting = o.payment_method === 'online' && o.payment_status === 'pending' && o.status !== 'cancelled';
    const making = o.production_status && !bad && ['placed', 'confirmed'].includes(o.status);
    const mIdx = MAKING.findIndex(([x]) => x === o.production_status);
    const wa = cfg.STORE_WHATSAPP || S().store_whatsapp;
    const rv = (state.account && state.account.reviewable) || [];
    main.innerHTML = `<div class="wrap" style="max-width:760px">
      ${fresh && !waiting ? `<div class="done"><div class="tick">${I.check}</div><h1>Order placed!</h1>
        <p class="muted">${o.payment_method === 'cod' ? `Keep ${esc(inr(o.total))} ready (cash or UPI) when it arrives.` : `Paid ${esc(inr(o.total))}. Your fit is on its way.`}</p>
        <div class="ono">${esc(o.order_no)}</div><p class="muted small">We've saved this order on this phone. ${state.account ? 'It is also in My account.' : 'Track it any time with your mobile number.'}</p>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:8px">${state.account && !store.get('zs_push', false) ? '<button class="btn line sm" id="sPush">Get delivery updates</button>' : ''}<a class="btn sm" href="#/shop">Continue shopping</a></div></div>`
        : `<div class="crumb"><a href="#/">Home</a> / <a href="#/account">Orders</a> / ${esc(o.order_no)}</div><h1 class="page">${esc(o.order_no)}</h1>`}
      <div class="muted small" style="margin:6px 0 14px">Placed ${esc(dateOf(o.created_at))} · ${esc(inr(o.total))} · ${o.payment_method === 'cod' ? 'Cash on delivery' : o.payment_status === 'paid' ? 'Paid online' : 'Online payment'}${o.payment_status === 'refunded' ? ' · refunded' : ''}${o.coupon_code ? ` · ${esc(o.coupon_code)}` : ''}</div>
      ${waiting ? `<div class="box" style="border-color:var(--warn)"><h3>Payment not finished</h3><p class="small">Your tees are held for 30 minutes. Finish paying to confirm the order.</p><button class="btn full" id="retryPay">Pay ${esc(inr(o.total))}</button></div>` : ''}
      ${making ? `<div class="box"><h3>Your tee is being made</h3><div class="chips" style="flex-wrap:wrap">${MAKING.map(([, l], i) => `<span class="chip${i <= mIdx ? ' on' : ''}">${l}</span>`).join('')}</div></div>` : ''}
      <div class="box"><h3>Status</h3><ol class="track">
        ${STEPS.map(([x, l], i) => `<li class="${i <= lastGood ? 'on' : ''}">${l}${at(x) ? `<small>${esc(at(x))}</small>` : ''}${x === 'shipped' && o.courier && i <= lastGood ? `<small>${esc(o.courier)}${o.tracking_no ? ` · AWB ${esc(o.tracking_no)}` : ''}</small>` : ''}</li>`).join('')}
        ${bad ? `<li class="on bad">${bad}<small>${esc(at(o.status))}</small></li>` : ''}
      </ol></div>
      <div class="box"><h3>Items</h3>${(o.items || []).map((i) => { const p = byId(i.product_id); const r = rv.find((x) => x.product_id === i.product_id); return `<div class="bline" style="grid-template-columns:64px 1fr">
          <div class="im">${p ? imgOf(p) : ''}</div>
          <div><div class="nm">${esc(i.name)}</div><div class="muted small">${esc(i.variant)} × ${i.qty} · ${esc(inr(i.price * i.qty))}</div>
          ${o.status === 'delivered' && p && state.account ? `<button class="link small" data-rv="${p.id}">${r && r.reviewed ? 'Edit your review' : 'Rate this tee ★'}</button>` : ''}
          ${p && available(p) ? ` <a class="link small" href="#/p/${esc(p.slug)}" style="margin-left:10px">Buy again</a>` : ''}</div></div>`; }).join('')}
        <div class="pd" style="margin-top:12px">${o.discount > 0 ? `<div><span>Discounts</span><span class="g">− ${esc(inr(o.discount))}</span></div>` : ''}<div><span>Delivery${o.payment_method === 'cod' && S().cod_fee ? ' & COD fee' : ''}</span><span>${o.shipping ? esc(inr(o.shipping)) : 'FREE'}</span></div><div class="tot"><span>Total</span><span>${esc(inr(o.total))}</span></div></div>
      </div>
      ${(o.requests || []).map((r) => `<div class="box"><b>${r.kind === 'replacement' ? 'Exchange' : 'Return'} request</b> · ${esc(r.status)}${r.resolution ? `<div class="muted small">${esc(r.resolution)}</div>` : ''}</div>`).join('')}
      ${canAsk ? `<div class="box"><h3>Something not right?</h3><div class="cta-row" style="margin-top:0;display:flex"><button class="btn line" id="askEx">${I.swap}Exchange size</button><button class="btn line" id="askRet">Return</button></div>
        <p class="muted small">${daysLeft} day${daysLeft === 1 ? '' : 's'} left to ask for an exchange or return.</p></div>` : ''}
      ${o.status === 'delivered' && !canAsk && days && daysLeft <= 0 ? `<p class="muted small">The ${days}-day exchange window for this order has closed.</p>` : ''}
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px">
        ${['delivered', 'shipped', 'packed', 'confirmed'].includes(o.status) || o.payment_status === 'paid' ? '<button class="btn line sm" id="inv">Download invoice</button>' : ''}
        ${wa ? `<a class="btn line sm" target="_blank" rel="noopener" href="https://wa.me/${esc(String(wa).replace(/\D/g, ''))}?text=${encodeURIComponent(`Hi Z-SHIRTS, about my order ${o.order_no}`)}">Help with this order</a>` : ''}
      </div></div>`;
    if (fresh && !waiting) { if (window.ZSCelebrate) { window.ZSCelebrate.confetti(1.2); if (window.ZSCelebrate.chime) window.ZSCelebrate.chime(); } history.replaceState(null, '', `#/order/${o.order_no}`); }
    if ($('sPush')) $('sPush').onclick = async () => { try { await enablePush(); toast("You'll get updates on this phone"); $('sPush').remove(); } catch (e) { toast(errText(e), true); } };
    if ($('retryPay')) $('retryPay').onclick = () => startPayment(o.order_no, { ...store.get('zs_customer', {}), phone });
    if ($('askEx')) { $('askEx').onclick = () => serviceSheet(o, phone, 'replacement'); $('askRet').onclick = () => serviceSheet(o, phone, 'return'); }
    main.querySelectorAll('[data-rv]').forEach((b) => { b.onclick = () => reviewSheet(byId(Number(b.dataset.rv))); });
    if ($('inv')) $('inv').onclick = () => invoice(o);
    if (waiting && route.params.pay === '1' && !route.params.new) toast('Payment not finished. Tap Pay to try again.', true);
  };

  function invoice(o) {
    const w = window.open('', '_blank');
    if (!w) { toast('Allow pop-ups to download the invoice', true); return; }
    w.document.write(`<!doctype html><title>Invoice ${esc(o.order_no)}</title><style>body{font:14px/1.5 system-ui,sans-serif;max-width:720px;margin:30px auto;padding:0 16px;color:#111}h1{font-size:28px;margin:0}table{width:100%;border-collapse:collapse;margin-top:18px}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left}td:last-child,th:last-child{text-align:right}.t td{font-weight:800;border:0}</style>
      <h1>Z-SHIRTS</h1><p>Tax invoice / bill of supply<br>Order <b>${esc(o.order_no)}</b> · ${esc(dateOf(o.created_at))}<br>${esc(o.customer_name || '')}</p>
      <table><tr><th>Item</th><th>Qty</th><th>Amount</th></tr>${(o.items || []).map((i) => `<tr><td>${esc(i.name)} · ${esc(i.variant)}</td><td>${i.qty}</td><td>${esc(inr(i.price * i.qty))}</td></tr>`).join('')}
      ${o.discount > 0 ? `<tr><td>Discounts</td><td></td><td>− ${esc(inr(o.discount))}</td></tr>` : ''}<tr><td>Delivery</td><td></td><td>${esc(inr(o.shipping || 0))}</td></tr>
      <tr class="t"><td>Total (inclusive of all taxes)</td><td></td><td>${esc(inr(o.total))}</td></tr></table>
      <p>Payment: ${o.payment_method === 'cod' ? 'Cash on delivery' : 'Online'} · ${esc(o.payment_status || '')}</p><script>print()<\/script>`);
    w.document.close();
  }

  function serviceSheet(o, phone, kind) {
    const list = o.items || [];
    const optionsFor = (item) => { const p = byId(item.product_id); return p ? p.variants.filter((v) => v.id !== item.variant_id && v.stock > 0) : []; };
    const b = openSheet(`<h2>${kind === 'replacement' ? 'Exchange a size or colour' : 'Return an item'}</h2>
      <form class="form" id="svF">
        <label for="svItem">Which item?</label>
        <select id="svItem">${list.map((i, n) => `<option value="${n}">${esc(i.name)} · ${esc(i.variant)}</option>`).join('')}</select>
        ${kind === 'replacement' ? '<label for="svNew">Exchange it for</label><select id="svNew"></select><div class="hint">Only sizes and colours in stock are shown.</div>' : ''}
        <label>Reason</label>
        <div class="chips" style="flex-wrap:wrap">${(kind === 'replacement' ? ['Too tight', 'Too loose', 'Want another colour', 'Other'] : ['Defect or damage', 'Different from photo', 'Quality not as expected', 'Other']).map((r) => `<button type="button" class="chip" data-rs="${r}">${r}</button>`).join('')}</div>
        <label for="svReason">Tell us more</label>
        <textarea id="svReason" placeholder="${kind === 'replacement' ? 'e.g. M is too tight on the shoulders' : 'e.g. Colour looks different from the photo'}"></textarea>
        <div class="hint">Keep the tags on. For a defect, WhatsApp us a photo with your order number.</div>
        <div class="err" id="svErr" role="alert"></div>
        <button class="btn full" style="margin-top:14px" type="submit">Send request</button>
      </form>`, { title: 'Request' });
    let reason = '';
    b.querySelectorAll('[data-rs]').forEach((x) => { x.onclick = () => { reason = x.dataset.rs; b.querySelectorAll('[data-rs]').forEach((y) => y.classList.toggle('on', y === x)); }; });
    const fill = () => {
      if (kind !== 'replacement') return;
      const opts = optionsFor(list[Number(b.querySelector('#svItem').value)]);
      b.querySelector('#svNew').innerHTML = opts.length ? opts.map((v) => `<option value="${v.id}">${esc(v.colour)} / ${esc(v.size)}</option>`).join('') : '<option value="">No other size in stock right now</option>';
    };
    fill();
    b.querySelector('#svItem').onchange = fill;
    b.querySelector('#svF').onsubmit = async (e) => {
      e.preventDefault();
      const item = list[Number(b.querySelector('#svItem').value)];
      const txt = [reason, b.querySelector('#svReason').value.trim()].filter(Boolean).join(': ');
      if (!txt) { b.querySelector('#svErr').textContent = 'Pick a reason.'; return; }
      const payload = { order_item_id: item.id, qty: 1 };
      if (kind === 'replacement') {
        if (!b.querySelector('#svNew').value) { b.querySelector('#svErr').textContent = 'No other size is in stock right now. Try a return instead.'; return; }
        payload.new_variant_id = Number(b.querySelector('#svNew').value);
      }
      const { error } = await sb.rpc('request_service', { p_order_no: o.order_no, p_phone: phone, p_kind: kind, p_reason: txt, p_items: [payload] });
      if (error) { b.querySelector('#svErr').textContent = errText(error); return; }
      closeSheet();
      toast('Request sent. We will get back to you soon.');
      render();
    };
  }

  PAGES.track = () => {
    const last = store.get('zs_last_order', {});
    const no = route.params.no || last.order_no || '';
    main.innerHTML = `<div class="wrap" style="max-width:520px"><h1 class="page" style="margin-top:24px">Track order</h1>
      <form class="form box" id="trF" style="margin-top:14px">
        <label for="trNo" style="margin-top:0">Order number</label><input id="trNo" placeholder="ZS1001" autocapitalize="characters" value="${esc(no)}">
        <label for="trPh">Mobile number used for the order</label><input id="trPh" inputmode="numeric" maxlength="10" value="${esc(no === last.order_no ? last.phone || '' : '')}">
        <div class="err" id="trE"></div>
        <button class="btn full" style="margin-top:16px" type="submit">Track</button>
      </form>
      ${state.user ? '<p class="muted small" style="text-align:center"><a class="link" href="#/account">See all my orders</a></p>' : '<p class="muted small" style="text-align:center">Tip: <a class="link" href="#/account">sign in with Google</a> to see every order without typing.</p>'}</div>`;
    $('trF').onsubmit = async (e) => {
      e.preventDefault();
      const n = $('trNo').value.trim().toUpperCase(), ph = $('trPh').value.replace(/\D/g, '').slice(-10);
      if (!n || ph.length !== 10) { $('trE').textContent = 'Enter the order number and the 10-digit mobile number.'; return; }
      const { error } = await sb.rpc('track_order', { p_order_no: n, p_phone: ph });
      if (error) { $('trE').textContent = errText(error); return; }
      store.set('zs_last_order', { order_no: n, phone: ph });
      go(`#/order/${n}`);
    };
  };

  // ================================================================ ACCOUNT
  async function signIn(back) {
    session.set('zs_after_login', back || '#/account');
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: 'select_account' } },
    });
    if (error) toast(/provider is not enabled|Unsupported provider/i.test(errText(error)) ? 'Google sign-in is being set up. Please try again soon.' : errText(error), true);
  }
  async function refreshAccount() {
    if (!state.user) { state.account = null; paintAcc(); return; }
    const { data, error } = await sb.rpc('my_account');
    state.account = error ? null : data;
    if (state.account) {
      const local = [...state.wish];
      const server = (state.account.wishlist || []).map(Number);
      if (local.some((x) => !server.includes(x))) {
        const r = await sb.rpc('merge_wishlist', { p_products: local });
        state.wish = new Set((r.data || [...server, ...local]).map(Number));
      } else state.wish = new Set(server);
      saveWish();
    }
    paintAcc();
  }
  function paintAcc() {
    const a = state.account;
    $('accLabel').textContent = a ? (a.name || 'Account').split(' ')[0] : state.user ? 'Account' : 'Login';
    $('hdrAcc').setAttribute('aria-label', a ? `My account, ${a.points} points` : 'Sign in');
  }
  function profileForm(first) {
    const u = state.user || {};
    const meta = u.user_metadata || {};
    const a = state.account || {};
    return `<h2>${first ? 'Welcome to Z-Club' : 'Your details'}</h2>
      ${first ? '<p class="muted">One last step: your mobile number links your orders, including ones placed on WhatsApp or at the store.</p>' : ''}
      <form class="form" id="pfF">
        <label for="pfN">Name</label><input id="pfN" autocomplete="name" value="${esc(a.name || meta.full_name || meta.name || '')}">
        <label for="pfP">Mobile number</label><input id="pfP" inputmode="numeric" autocomplete="tel-national" maxlength="10" value="${esc(a.phone || '')}">
        <div class="err" id="pfE"></div>
        <button class="btn full" style="margin-top:16px" type="submit">${first ? 'Start earning points' : 'Save'}</button>
      </form>`;
  }
  function bindProfile(root, first) {
    root.querySelector('#pfF').onsubmit = async (e) => {
      e.preventDefault();
      const ph = root.querySelector('#pfP').value.replace(/\D/g, '').slice(-10);
      if (!isPhone(ph)) { root.querySelector('#pfE').textContent = 'Enter a valid 10-digit mobile number.'; return; }
      const { error } = await sb.rpc('save_my_profile', { p_name: root.querySelector('#pfN').value, p_phone: ph });
      if (error) { root.querySelector('#pfE').textContent = errText(error); return; }
      await refreshAccount();
      if (first && window.ZSCelebrate) window.ZSCelebrate.confetti(0.8);
      toast(first ? "You're in Z-Club!" : 'Saved');
      closeSheet();
      const back = session.get('zs_after_login', '');
      session.set('zs_after_login', '');
      if (first && back && back !== '#/account') go(back); else render();
    };
  }
  PAGES.account = () => {
    if (!state.user) {
      const per = S().loyalty_points_per_100 || 5;
      main.innerHTML = `<div class="wrap" style="max-width:520px"><div class="club" style="margin-top:24px"><div><h3>Join <span>Z-Club</span></h3>
        <ul><li>${per} points on every ₹100</li><li>1 point = ₹1 off</li><li>Saved addresses, 1-tap checkout</li><li>All orders & tracking in one place</li><li>Wishlist on every device</li></ul></div></div>
        <div class="box" style="margin-top:14px"><button class="google" id="accG">${googleIcon()} Continue with Google</button>
        <p class="muted small" style="text-align:center;margin:10px 0 0">No password, no OTP wait. We only see your name and e-mail.</p></div>
        <div class="box"><h3>Ordered as a guest?</h3><a class="btn line full" href="#/track">Track with order number</a></div></div>`;
      $('accG').onclick = () => signIn('#/account');
      return;
    }
    if (!state.account) {
      main.innerHTML = `<div class="wrap" style="max-width:520px;margin-top:24px"><div class="box" id="pfBox">${profileForm(true)}</div></div>`;
      bindProfile($('pfBox'), true);
      return;
    }
    const a = state.account;
    const tab = route.params.t || 'orders';
    const orders = a.orders || [];
    const per = S().loyalty_points_per_100 || 5;
    const body = {
      orders: () => (orders.length ? orders.map((o) => `<a class="ord" href="#/order/${esc(o.order_no)}?ph=${esc(o.phone || a.phone || '')}">
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><b>${esc(o.order_no)}</b><span class="st s-${esc(o.status)}">${esc(statusLabel(o))}</span></div>
          <div class="muted small" style="margin-top:4px">${esc(new Date(o.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }))} · ${(o.items || []).map((x) => `${esc(x.name)} ×${x.qty}`).join(', ')}</div>
          <div style="margin-top:6px;font-weight:800">${esc(inr(o.total))}</div></a>`).join('')
        : `<div class="empty-box"><h3>No orders yet</h3><p>Your first fit is waiting.</p><a class="btn" href="#/shop">Shop now</a></div>`),
      addresses: () => `${(a.addresses || []).map((x) => `<div class="addr" style="cursor:default"><span style="flex:1"><b>${esc(x.name)}</b><span class="tag">${esc(x.label)}</span>${x.is_default ? '<span class="tag">Default</span>' : ''}
          <div class="small" style="margin-top:4px">${esc([x.line1, x.line2, x.city, x.state].filter(Boolean).join(', '))} - ${esc(x.pincode)}</div><div class="small muted">Mobile: ${esc(x.phone)}</div>
          <div style="margin-top:8px;display:flex;gap:14px">${x.is_default ? '' : `<button class="link small" data-def="${x.id}">Make default</button>`}<button class="link small" data-del="${x.id}">Delete</button></div></span></div>`).join('')}
        <button class="btn line full" id="addA" style="margin-top:12px">+ Add new address</button>`,
      points: () => `<div class="box"><p style="margin:0"><b>${per} points</b> on every ₹100 you spend. <b>1 point = ₹1</b> off at checkout. Points land when your order is delivered.</p></div>
        ${(a.points_history || []).map((h) => `<div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--line)"><span>${esc(h.note || h.reason)}</span><b style="color:${h.points > 0 ? 'var(--save)' : 'var(--bad)'}">${h.points > 0 ? '+' : ''}${h.points}</b></div>`).join('') || '<p class="muted">No points yet.</p>'}`,
      profile: () => `<div class="box" id="pfBox">${profileForm(false)}</div>
        <div class="box"><h3>Phone alerts</h3><p class="small muted" style="margin-top:0">Get a ping when your order ships or your size is back.</p><button class="btn line sm" id="accPush">${store.get('zs_push', false) ? 'Alerts are on' : 'Turn on alerts'}</button></div>`,
    };
    main.innerHTML = `<div class="wrap" style="max-width:760px">
      <div class="acct-hero"><div><h2>Hey ${esc((a.name || '').split(' ')[0] || 'there')}</h2><div class="small" style="opacity:.7">${esc(a.email || '')} · ${esc(a.phone || '')}</div></div>
        <div class="pts"><b>${a.points}</b><span class="small" style="opacity:.7">Z-Club points · worth ${esc(inr(a.points))}</span></div></div>
      <div class="acct-tabs">${[['orders', `Orders (${orders.length})`], ['addresses', 'Addresses'], ['points', 'Points'], ['profile', 'Profile']].map(([k, l]) => `<a class="chip${tab === k ? ' on' : ''}" href="#/account?t=${k}">${l}</a>`).join('')}
        <a class="chip" href="#/wishlist">Wishlist (${state.wish.size})</a></div>
      <div id="accBody">${body[tab] ? body[tab]() : body.orders()}</div>
      <button class="btn ghost full" id="accOut" style="margin-top:24px">Sign out</button></div>`;
    $('accOut').onclick = async () => {
      await sb.auth.signOut();
      state.user = null; state.account = null; paintAcc(); toast('Signed out'); go('#/');
    };
    if (tab === 'profile') {
      bindProfile($('pfBox'), false);
      $('accPush').onclick = async () => { try { await enablePush(); toast('Phone alerts are on'); $('accPush').textContent = 'Alerts are on'; } catch (e) { toast(errText(e), true); } };
    }
    main.querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => { const { error } = await sb.rpc('delete_address', { p_id: Number(b.dataset.del) }); if (error) toast(errText(error), true); else { await refreshAccount(); render(); } }; });
    main.querySelectorAll('[data-def]').forEach((b) => {
      b.onclick = async () => {
        const x = a.addresses.find((y) => y.id === Number(b.dataset.def));
        const { error } = await sb.rpc('save_address', { p: { ...x, is_default: true } });
        if (error) toast(errText(error), true); else { await refreshAccount(); render(); }
      };
    });
    if ($('addA')) $('addA').onclick = () => addressSheet();
  };
  function addressSheet() {
    const b = openSheet(`<h2>New address</h2><form class="form" id="naF">
      <div class="row2"><div><label for="naN">Full name</label><input id="naN" value="${esc((state.account && state.account.name) || '')}"></div><div><label for="naP">Mobile</label><input id="naP" inputmode="numeric" maxlength="10" value="${esc((state.account && state.account.phone) || '')}"></div></div>
      <div class="row2"><div><label for="naPin">Pincode</label><input id="naPin" inputmode="numeric" maxlength="6"></div><div><label for="naC">City</label><input id="naC"></div></div>
      <label for="naL1">House no., building, street</label><input id="naL1"><label for="naL2">Area, landmark (optional)</label><input id="naL2">
      <label for="naS">State</label><input id="naS">
      <label>Save as</label><div class="chips">${['Home', 'Work', 'Other'].map((l, i) => `<button type="button" class="chip${i ? '' : ' on'}" data-lb="${l}">${l}</button>`).join('')}</div>
      <div class="err" id="naE"></div><button class="btn full" style="margin-top:16px" type="submit">Save address</button></form>`, { title: 'Address' });
    let label = 'Home';
    b.querySelectorAll('[data-lb]').forEach((x) => { x.onclick = () => { label = x.dataset.lb; b.querySelectorAll('[data-lb]').forEach((y) => y.classList.toggle('on', y === x)); }; });
    b.querySelector('#naPin').oninput = async (e) => {
      const v = e.target.value.replace(/\D/g, '');
      if (v.length !== 6) return;
      const ar = await pinLookup(v).catch(() => null);
      if (ar) { b.querySelector('#naC').value = ar.city; b.querySelector('#naS').value = ar.state; }
    };
    b.querySelector('#naF').onsubmit = async (e) => {
      e.preventDefault();
      const g = (id) => b.querySelector(id).value.trim();
      const { error } = await sb.rpc('save_address', { p: { label, name: g('#naN'), phone: g('#naP').replace(/\D/g, ''), pincode: g('#naPin'), city: g('#naC'), line1: g('#naL1'), line2: g('#naL2'), state: g('#naS') } });
      if (error) { b.querySelector('#naE').textContent = errText(error); return; }
      closeSheet(); toast('Address saved'); await refreshAccount(); render();
    };
  }

  // ================================================================ HELP
  PAGES.help = () => {
    const s = S();
    const wa = cfg.STORE_WHATSAPP || s.store_whatsapp;
    const faq = [
      ['How do oversized tees fit?', 'They are cut wide with dropped shoulders. Take your usual size for the relaxed look, or one size down for a closer fit. Use "Find my size" on any product.'],
      ['Will it shrink?', 'Our fabric is pre-shrunk. Wash cold, inside out, and dry in shade to keep the print and colour fresh.'],
      ['Is cash on delivery available?', s.cod_enabled ? `Yes, for most pincodes. Check yours on any product page.${s.cod_fee ? ` A ₹${s.cod_fee} handling fee applies.` : ''}` : 'Right now we accept online payments only: UPI, cards, wallets and netbanking.'],
      ['When will my order arrive?', 'We ship in 1–2 days. Metro cities usually get it in 3–5 days, other places in 5–7 days. Enter your pincode on a product to see the date.'],
      ['How do I exchange a size?', `Open your order (My account or Track order) and tap "Exchange size" within ${s.return_window_days || 15} days of delivery. Keep the tags on.`],
      ['When do I get my refund?', 'For online payments, refunds go back to the same account within 5–7 working days after we receive the return. For COD orders we refund to your UPI.'],
      ['How do Z-Club points work?', `You earn ${s.loyalty_points_per_100 || 5} points per ₹100 once the order is delivered. 1 point = ₹1 off on your next order.`],
    ];
    main.innerHTML = `<div class="wrap" style="max-width:760px"><h1 class="page" style="margin-top:24px">Help</h1>
      <div class="chips" style="margin:14px 0"><a class="chip" href="#/track">Track order</a><a class="chip" href="#/help#size">Size guide</a><a class="chip" href="#/help#returns">Returns</a><a class="chip" href="#/help#shipping">Shipping</a></div>
      <div class="box sg" id="size"><h3>Size guide <button class="link small" id="hFit">Find my size</button></h3><table><thead><tr><th>Size</th><th>Chest (in)</th><th>Length (in)</th><th>Shoulder (in)</th></tr></thead><tbody>
        ${guideRows().map((r) => `<tr class="${state.mySize && state.mySize.size === r.size ? 'me' : ''}"><td><b>${esc(r.size)}</b></td><td>${r.chest}</td><td>${r.length}</td><td>${r.shoulder}</td></tr>`).join('')}</tbody></table></div>
      <div class="box" id="shipping"><h3>Shipping</h3><p class="small" style="margin:0">${s.free_shipping_above > 0 ? `Free delivery on orders above ${esc(inr(s.free_shipping_above))}; below that ${esc(inr(s.shipping_fee || 0))}.` : 'Free delivery across India.'} We ship across India with tracked couriers.</p></div>
      <div class="box" id="returns"><h3>Returns & exchange</h3><p class="small" style="margin:0">${s.return_window_days || 15}-day easy size exchange. Wrong size, defect or damage? Ask from your order page. Custom and pre-order prints can be exchanged only for defects.</p></div>
      <h2 style="margin-top:26px">FAQs</h2>${faq.map(([q, a]) => `<details class="acc"><summary>${esc(q)}</summary><div class="acc-b">${esc(a)}</div></details>`).join('')}
      ${wa ? `<div class="box" style="margin-top:20px;text-align:center"><b>Still need help?</b><p class="small muted">We reply on WhatsApp, usually within an hour.</p><a class="btn" target="_blank" rel="noopener" href="https://wa.me/${esc(String(wa).replace(/\D/g, ''))}">Chat on WhatsApp</a></div>` : ''}</div>`;
    $('hFit').onclick = () => sizeGuideSheet(null);
    if (route.anchor && $(route.anchor)) setTimeout(() => $(route.anchor).scrollIntoView({ behavior: 'smooth' }), 50);
  };

  // ================================================================ boot
  sb.auth.onAuthStateChange((_ev, sess) => {
    const was = state.user && state.user.id;
    state.user = sess ? sess.user : null;
    if ((state.user && state.user.id) === was) return;
    refreshAccount().then(() => {
      const back = session.get('zs_after_login', '');
      if (state.user && back) {
        if (!state.account) { if (route.path !== 'account') go('#/account'); else render(); return; }
        session.set('zs_after_login', '');
        toast(`Welcome back, ${(state.account.name || '').split(' ')[0]}`);
        if (location.hash !== back) go(back); else render();
      } else if (state.ready && ['account', 'checkout', 'p', 'order'].includes(route.path)) render();
    });
  });

  // old links: ?p=slug, ?track=ZS1001
  (() => {
    const q = new URLSearchParams(location.search);
    let h = '';
    if (q.get('p')) h = `#/p/${q.get('p')}`;
    else if (q.get('track')) h = `#/track?no=${encodeURIComponent(q.get('track'))}`;
    if (h) history.replaceState(null, '', location.pathname + h);
  })();

  saveWish(); saveBag(true);
  render();
  load().then(() => {
    chrome();
    render();
    const code = store.get('zs_coupon', '');
    if (code && session.get('zs_attr', {}).coupon === code && !session.get('zs_coupon_told', false)) { session.set('zs_coupon_told', true); toast(`Code ${code} will be applied in your bag`); }
  }).catch((e) => {
    main.innerHTML = `<div class="wrap empty-box"><h3>Couldn't load the shop</h3><p>${esc(errText(e))}</p><button class="btn" onclick="location.reload()">Try again</button></div>`;
  });
})();
