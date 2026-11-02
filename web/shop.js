/* Z-SHIRTS shop · catalogue, filters, drops, bag, combos, coupons, Z-Club, checkout, payment,
 * Google account + order history, tracking, exchanges, restock alerts.
 * Prices, stock, coupons and totals are always worked out again by the database.
 */
(() => {
  'use strict';
  const cfg = window.ZS_CONFIG || {};
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------ helpers
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inr = (n) => {
    const v = Number(n) || 0;
    const d = Number.isInteger(Math.round(v * 100) / 100) ? 0 : 2;
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
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
  function toast(msg, err = false) {
    const el = $('toast');
    el.textContent = msg;
    el.className = 'show' + (err ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = ''; }, err ? 5000 : 2600);
  }
  const errText = (e) => (e && (e.message || e.error)) || String(e);
  const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'];
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  function tee(hex = '#111', label = 'Z-SHIRTS tee') {
    const c = /^#[0-9a-f]{3,8}$/i.test(hex) ? hex : '#111111';
    const r = parseInt(c.slice(1, 3), 16) || 0, g = parseInt(c.slice(3, 5), 16) || 0, b = parseInt(c.slice(5, 7), 16) || 0;
    const light = (r * 299 + g * 587 + b * 114) / 1000 > 140;
    const stroke = light ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.16)';
    const mark = light ? '#000' : '#c6ff00';
    return `<svg viewBox="0 0 400 500" role="img" aria-label="${esc(label)}">
      <rect width="400" height="500" fill="#16161a"/>
      <path d="M128 92 L170 74 Q200 98 230 74 L272 92 L352 140 L322 214 L290 198 L292 432 Q200 446 108 432 L110 198 L78 214 L48 140 Z"
        fill="${c}" stroke="${stroke}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M170 74 Q200 112 230 74" fill="none" stroke="${stroke}" stroke-width="5"/>
      <path d="M182 170h36v7l-26 26h26v8h-36v-7l26-26h-26z" fill="${mark}"/>
    </svg>`;
  }
  const productArt = (p, hex) => (p.images && p.images.length
    ? `<img src="${esc(p.images[0])}" alt="${esc(p.name)}" loading="lazy">`
    : tee(hex || (p.variants[0] && p.variants[0].hex), p.name));

  // time left until a drop, e.g. "1d 04:12:09"
  function countdown(to) {
    let s = Math.max(0, Math.floor((new Date(to) - Date.now()) / 1000));
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    const pad = (n) => String(n).padStart(2, '0');
    return `${d ? d + 'd ' : ''}${pad(h)}:${pad(m)}:${pad(s)}`;
  }
  const dropDate = (d) => new Date(d).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

  // ------------------------------------------------------------ setup check
  if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes('YOUR-PROJECT')) {
    document.querySelector('main').innerHTML = `<div class="setup"><div class="logo">Z<span>-</span>SHIRTS</div>
      <p class="muted">The shop opens once <b>config.js</b> has the Supabase project details. See the README.</p></div>`;
    return;
  }
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce', storageKey: 'zs-shop-auth' },
  });

  const state = {
    products: [],
    bundles: [],
    settings: { shipping_fee: 0, free_shipping_above: 0, cod_enabled: 1, return_window_days: 15 },
    cat: 'all', q: '',
    f: { price: '', types: new Set(), colours: new Set(), minOff: 0, inStock: false, sort: 'featured' },
    bag: store.get('zs_bag', []),
    user: null,
    account: null,
    viewed: store.get('zs_viewed', []),
  };
  const byId = (id) => state.products.find((p) => p.id === id);
  const variantOf = (vid) => {
    for (const p of state.products) {
      const v = p.variants.find((x) => x.id === vid);
      if (v) return { p, v };
    }
    return null;
  };
  const available = (p) => p.is_preorder || p.total_stock > 0;
  const canBuyVariant = (p, v) => p.is_preorder || v.stock > 0;

  // where the shopper came from: ?utm_source=instagram&utm_campaign=diwali&coupon=ROHAN10
  (() => {
    const q = new URLSearchParams(location.search);
    const attr = session.get('zs_attr', {});
    ['utm_source', 'utm_campaign'].forEach((k) => { if (q.get(k)) attr[k] = q.get(k).slice(0, 80); });
    const code = q.get('coupon') || q.get('code');
    if (code) { attr.coupon = code.toUpperCase().slice(0, 20); store.set('zs_coupon', attr.coupon); }
    session.set('zs_attr', attr);
  })();

  // ------------------------------------------------------------ sheet
  let lastFocus;
  let sheetTimer;
  function openSheet(html, title = '') {
    clearInterval(sheetTimer);
    lastFocus = lastFocus && !$('sheet').hidden ? lastFocus : document.activeElement;
    $('sheetBody').innerHTML = html;
    $('sheet').setAttribute('aria-label', title);
    $('sheet').hidden = false;
    $('scrim').hidden = false;
    document.body.style.overflow = 'hidden';
    $('sheet').scrollTop = 0;
    $('sheetClose').focus();
  }
  function closeSheet() {
    clearInterval(sheetTimer);
    $('sheet').hidden = true;
    $('scrim').hidden = true;
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    lastFocus = null;
  }
  $('sheetClose').onclick = closeSheet;
  $('scrim').onclick = closeSheet;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('sheet').hidden) closeSheet(); });

  // ------------------------------------------------------------ load
  async function load() {
    const [cat, set, bun] = await Promise.all([
      sb.from('catalog').select('*'),
      sb.from('public_settings').select('*'),
      sb.from('bundles').select('id, name, qty, price, product_ids').eq('active', true),
    ]);
    if (cat.error) throw cat.error;
    state.products = (cat.data || []).map((p) => ({ ...p, variants: p.variants || [] }));
    (set.data || []).forEach((r) => { state.settings[r.key] = Number(r.value); });
    state.bundles = bun.data || [];
    renderChrome();
    renderGrid();
    deepLink();
  }

  function renderChrome() {
    const s = state.settings;
    const ticks = [];
    state.bundles.forEach((b) => ticks.push(b.name));
    if (s.free_shipping_above > 0) ticks.push(`Free delivery above ${inr(s.free_shipping_above)}`);
    else if (s.shipping_fee === 0) ticks.push('Free delivery across India');
    if (s.cod_enabled) ticks.push('Cash on delivery available');
    if (s.return_window_days) ticks.push(`${s.return_window_days}-day easy exchange`);
    ticks.push('Earn Z-Club points on every order');
    const gsm = Math.max(0, ...state.products.map((p) => p.gsm || 0));
    if (gsm) ticks.push(`Up to ${gsm} GSM cotton`);
    const half = ticks.map((t) => `<span>${esc(t)}</span>`).join('');
    $('ticker').innerHTML = half + half;

    const cats = [...new Map(state.products.filter((p) => p.category).map((p) => [p.category_slug, p.category])).entries()];
    const chips = [['all', 'All']];
    if (state.products.some((p) => p.drop_name)) chips.push(['drops', 'Drops']);
    $('catChips').innerHTML = chips.concat(cats)
      .map(([slug, name]) => `<button class="chip" role="tab" data-cat="${esc(slug)}" aria-pressed="${state.cat === slug}">${esc(name)}</button>`).join('');
    $('catChips').querySelectorAll('.chip').forEach((b) => {
      b.onclick = () => { state.cat = b.dataset.cat; renderChrome(); renderGrid(); };
    });

    const links = [`<button id="lnTrack">Track order</button>`, `<button id="lnGuide">Size guide</button>`, `<button id="lnClub">Z-Club</button>`];
    if (cfg.INSTAGRAM) links.push(`<a href="https://instagram.com/${esc(cfg.INSTAGRAM)}" target="_blank" rel="noopener">Instagram</a>`);
    if (cfg.STORE_WHATSAPP) links.push(`<a href="https://wa.me/${esc(cfg.STORE_WHATSAPP)}" target="_blank" rel="noopener">WhatsApp</a>`);
    $('footLinks').innerHTML = links.join('');
    $('lnTrack').onclick = () => openTrack();
    $('lnGuide').onclick = () => openSheet(`<h2>Size guide</h2>${guideTable()}`, 'Size guide');
    $('lnClub').onclick = openAccount;
    if (cfg.STORE_WHATSAPP) {
      $('waFloat').href = `https://wa.me/${cfg.STORE_WHATSAPP}?text=${encodeURIComponent('Hi Z-SHIRTS! I have a question.')}`;
      $('waFloat').hidden = false;
    }
    renderDropBanner();
    renderRecent();
    updateBagCount();
  }

  // the next drop, counting down on the home page
  let bannerTimer;
  function renderDropBanner() {
    clearInterval(bannerTimer);
    const next = state.products.filter((p) => p.coming_soon && p.drop_at)
      .sort((a, b) => new Date(a.drop_at) - new Date(b.drop_at))[0];
    const el = $('dropBanner');
    if (!next) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `<div class="drop-kicker">Next drop</div>
      <div class="drop-name">${esc(next.drop_name || next.name)}</div>
      <div class="drop-clock" id="dropClock">${countdown(next.drop_at)}</div>
      <div class="muted small">Lands ${esc(dropDate(next.drop_at))}${next.limited_qty ? ` · only ${next.limited_qty} pieces` : ''}</div>
      <button class="btn btn-outline" id="dropPeek">Peek at it</button>`;
    $('dropPeek').onclick = () => openProduct(next.id);
    bannerTimer = setInterval(() => {
      if (new Date(next.drop_at) <= Date.now()) { clearInterval(bannerTimer); load().catch(() => {}); return; }
      const c = $('dropClock'); if (c) c.textContent = countdown(next.drop_at);
    }, 1000);
  }

  function miniCards(list) {
    return `<div class="mini-row">${list.map((p) => `
      <button class="mini" data-mini="${p.id}">
        <div class="mini-img">${productArt(p)}</div>
        <div class="mini-name">${esc(p.name)}</div>
        <div class="mini-price">${esc(inr(p.price))}</div>
      </button>`).join('')}</div>`;
  }
  function bindMini(root) {
    root.querySelectorAll('[data-mini]').forEach((b) => { b.onclick = () => openProduct(Number(b.dataset.mini)); });
  }
  function renderRecent() {
    const list = state.viewed.map(byId).filter(Boolean).slice(0, 8);
    const el = $('recent');
    if (list.length < 2) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `<h2 class="row-title">Recently viewed</h2>${miniCards(list)}`;
    bindMini(el);
  }

  // ------------------------------------------------------------ filters
  function filtered() {
    const { f } = state;
    const q = state.q.trim().toLowerCase();
    let list = state.products.filter((p) => {
      if (state.cat === 'drops') { if (!p.drop_name) return false; } else if (state.cat !== 'all' && p.category_slug !== state.cat) return false;
      if (q) {
        const hay = [p.name, p.type, p.category, p.drop_name, ...(p.tags || []), ...p.variants.map((v) => v.colour)].join(' ').toLowerCase();
        if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
      }
      if (f.price) {
        const [lo, hi] = f.price.split('-').map(Number);
        if (p.price < lo || (hi && p.price > hi)) return false;
      }
      if (f.types.size && !f.types.has(p.type)) return false;
      if (f.colours.size && !p.variants.some((v) => f.colours.has(v.colour) && (!f.inStock || canBuyVariant(p, v)))) return false;
      if (f.minOff && p.discount_pct < f.minOff) return false;
      if (f.inStock && !available(p)) return false;
      return true;
    });
    const sorts = {
      featured: (a, b) => (b.coming_soon - a.coming_soon) || (b.featured - a.featured) || (new Date(b.published_at) - new Date(a.published_at)),
      new: (a, b) => new Date(b.published_at) - new Date(a.published_at),
      low: (a, b) => a.price - b.price,
      high: (a, b) => b.price - a.price,
      off: (a, b) => b.discount_pct - a.discount_pct,
      popular: (a, b) => b.sold_count - a.sold_count,
    };
    list = list.sort(sorts[f.sort] || sorts.featured);
    return list.sort((a, b) => (available(b) || b.coming_soon) - (available(a) || a.coming_soon));
  }
  const activeFilterCount = () => {
    const f = state.f;
    return (f.price ? 1 : 0) + f.types.size + f.colours.size + (f.minOff ? 1 : 0) + (f.inStock ? 1 : 0);
  };

  function badgeOf(p) {
    if (p.coming_soon) return `<span class="flag flag-drop">Drops ${esc(new Date(p.drop_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }))}</span>`;
    if (p.limited_qty) {
      const left = Math.max(0, p.limited_qty - (p.sold_count || 0));
      return `<span class="flag flag-limited">Limited · ${left}/${p.limited_qty} left</span>`;
    }
    if (p.is_preorder) return '<span class="flag flag-pre">Made to order</span>';
    if (p.total_stock > 0 && p.total_stock <= 5) return `<span class="stock-flag">Only ${p.total_stock} left</span>`;
    return '';
  }

  function renderGrid() {
    const list = filtered();
    const n = activeFilterCount();
    $('filterDot').hidden = n === 0;
    $('resultLine').textContent = state.products.length
      ? `${list.length} ${list.length === 1 ? 'style' : 'styles'}${n ? ` · ${n} filter${n > 1 ? 's' : ''} on` : ''}${state.q ? ` · “${state.q}”` : ''}`
      : '';
    if (!state.products.length) {
      $('grid').innerHTML = `<div class="empty"><b>First drop loading</b>New tees land here soon.</div>`;
      return;
    }
    if (!list.length) {
      $('grid').innerHTML = `<div class="empty"><b>Nothing matches</b>Try fewer filters.<br><br><button class="btn btn-outline" id="clearAll" style="max-width:220px">Clear filters</button></div>`;
      $('clearAll').onclick = () => { resetFilters(); renderGrid(); };
      return;
    }
    $('grid').innerHTML = list.map((p) => {
      const colours = [...new Map(p.variants.map((v) => [v.colour, v.hex])).entries()];
      const soldOut = !available(p) && !p.coming_soon;
      return `
        <button class="card${soldOut ? ' sold-out' : ''}${p.coming_soon ? ' coming' : ''}" data-id="${p.id}" aria-label="${esc(p.name)}, ${esc(inr(p.price))}">
          <div class="card-img">
            ${productArt(p, colours[0] && colours[0][1])}
            <div class="tag"><div class="tag-price">${esc(inr(p.price))}</div>
              ${p.mrp > p.price ? `<div class="tag-mrp">${esc(inr(p.mrp))}</div><span class="tag-off">${p.discount_pct}% off</span>` : ''}</div>
            ${badgeOf(p)}
          </div>
          <div class="card-name">${esc(p.name)}</div>
          <div class="card-meta">${colours.slice(0, 5).map(([name, hex]) => `<span class="swatch-dot" title="${esc(name)}" style="background:${esc(hex)}"></span>`).join('')}
            ${colours.length > 5 ? `<span class="more-col">+${colours.length - 5}</span>` : ''}</div>
        </button>`;
    }).join('');
    $('grid').querySelectorAll('.card').forEach((c) => { c.onclick = () => openProduct(Number(c.dataset.id)); });
  }

  function resetFilters() {
    state.f = { price: '', types: new Set(), colours: new Set(), minOff: 0, inStock: false, sort: state.f.sort };
  }

  function openFilters() {
    const f = state.f;
    const types = [...new Set(state.products.map((p) => p.type))];
    const colours = [...new Map(state.products.flatMap((p) => p.variants.map((v) => [v.colour, v.hex]))).entries()];
    const chip = (group, val, label, on) => `<button class="chip${on ? ' on' : ''}" data-g="${group}" data-v="${esc(val)}" aria-pressed="${on}">${label}</button>`;
    const prices = [['', 'Any'], ['0-799', 'Under ₹800'], ['800-1299', '₹800–1,299'], ['1300-0', '₹1,300+']];
    openSheet(`
      <h2>Filter</h2>
      <h3>Sort by</h3>
      <div class="chips" style="flex-wrap:wrap">${[['featured', 'Picked for you'], ['popular', 'Bestsellers'], ['new', 'Newest'], ['low', 'Price: low to high'], ['high', 'Price: high to low'], ['off', 'Biggest discount']]
        .map(([v, l]) => chip('sort', v, l, f.sort === v)).join('')}</div>
      <h3>Price</h3>
      <div class="chips" style="flex-wrap:wrap">${prices.map(([v, l]) => chip('price', v, l, f.price === v)).join('')}</div>
      ${types.length > 1 ? `<h3>Type</h3><div class="chips" style="flex-wrap:wrap">${types.map((t) => chip('type', t, esc(t), f.types.has(t))).join('')}</div>` : ''}
      <h3>Colour</h3>
      <div class="swatches">${colours.map(([name, hex]) => `<button class="swatch" data-g="colour" data-v="${esc(name)}" aria-pressed="${f.colours.has(name)}"><i style="background:${esc(hex)}"></i>${esc(name)}</button>`).join('')}</div>
      <h3>Discount</h3>
      <div class="chips" style="flex-wrap:wrap">${[[0, 'Any'], [10, '10% or more'], [25, '25% or more'], [40, '40% or more']].map(([v, l]) => chip('off', v, l, f.minOff === v)).join('')}</div>
      <h3>Availability</h3>
      <div class="chips">${chip('stock', '1', 'In stock only', f.inStock)}</div>
      <div class="sticky-cta">
        <button class="btn btn-outline" id="fClear">Clear</button>
        <button class="btn btn-lime" id="fApply">Show ${filtered().length} styles</button>
      </div>`, 'Filter');

    const body = $('sheetBody');
    body.querySelectorAll('[data-g]').forEach((b) => {
      b.onclick = () => {
        const g = b.dataset.g, v = b.dataset.v;
        if (g === 'sort') f.sort = v;
        if (g === 'price') f.price = v;
        if (g === 'off') f.minOff = Number(v);
        if (g === 'stock') f.inStock = !f.inStock;
        if (g === 'type') f.types.has(v) ? f.types.delete(v) : f.types.add(v);
        if (g === 'colour') f.colours.has(v) ? f.colours.delete(v) : f.colours.add(v);
        openFilters();
      };
    });
    $('fClear').onclick = () => { resetFilters(); openFilters(); };
    $('fApply').onclick = () => { closeSheet(); renderGrid(); $('grid').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  }
  $('btnFilter').onclick = openFilters;

  $('btnSearch').onclick = () => {
    $('searchBox').hidden = !$('searchBox').hidden;
    if (!$('searchBox').hidden) $('searchInput').focus();
  };
  let searchTimer;
  $('searchInput').oninput = (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.q = e.target.value; renderGrid(); }, 150);
  };

  // ------------------------------------------------------------ delivery check by pincode
  async function pinLookup(pin) {
    const r = await fetch(`https://api.postalpincode.in/pincode/${pin}`);
    const d = await r.json();
    const po = d && d[0] && d[0].PostOffice && d[0].PostOffice[0];
    return po ? { city: po.District, state: po.State } : null;
  }
  async function deliveryFor(pin) {
    const area = await pinLookup(pin).catch(() => null);
    const { data, error } = await sb.rpc('delivery_check', { p_pincode: pin, p_city: area && area.city, p_state: area && area.state });
    if (error) throw error;
    return { ...data, area };
  }

  // ------------------------------------------------------------ push notifications (browser)
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

  // ------------------------------------------------------------ product
  function guideTable() {
    const rows = cfg.SIZE_GUIDE || [];
    if (!rows.length) return '<p class="muted">Size guide coming soon.</p>';
    return `<p class="muted small">Oversized fit, garment measurements in inches. Between sizes? Take your usual size for the intended baggy look.</p>
      <table><thead><tr><th>Size</th><th>Chest</th><th>Length</th><th>Shoulder</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td><b>${esc(r.size)}</b></td><td>${esc(r.chest)}</td><td>${esc(r.length)}</td><td>${esc(r.shoulder)}</td></tr>`).join('')}</tbody></table>`;
  }

  function bundlesFor(p) {
    return state.bundles.filter((b) => !b.product_ids || !b.product_ids.length || b.product_ids.includes(p.id));
  }

  // "Complete the look": other styles that pair with this one — different type first, then same drop/tags
  function lookFor(p) {
    const tags = new Set(p.tags || []);
    return state.products.filter((x) => x.id !== p.id && available(x))
      .map((x) => ({ x, score: (x.drop_name && x.drop_name === p.drop_name ? 3 : 0) + (x.tags || []).filter((t) => tags.has(t)).length * 2
        + (x.type !== p.type ? 2 : 0) + (x.category_slug === p.category_slug ? 1 : 0) + Math.min(x.sold_count || 0, 20) / 20 }))
      .sort((a, b) => b.score - a.score).slice(0, 6).map((r) => r.x);
  }

  function rememberView(id) {
    state.viewed = [id, ...state.viewed.filter((x) => x !== id)].slice(0, 12);
    store.set('zs_viewed', state.viewed);
  }

  function openProduct(id, preColour) {
    const p = byId(id);
    if (!p) return;
    rememberView(p.id);
    const colours = [...new Map(p.variants.map((v) => [v.colour, v.hex])).entries()];
    const firstInStock = p.variants.find((v) => canBuyVariant(p, v));
    const sel = { colour: preColour || (firstInStock ? firstInStock.colour : colours[0] && colours[0][0]), size: null };
    try { history.replaceState(null, '', `?p=${encodeURIComponent(p.slug)}`); } catch (_) { /* file:// */ }
    let delivery = null;

    const draw = () => {
      const hex = (colours.find((c) => c[0] === sel.colour) || [])[1];
      const sizes = p.variants.filter((v) => v.colour === sel.colour)
        .sort((a, b) => SIZE_ORDER.indexOf(a.size) - SIZE_ORDER.indexOf(b.size));
      const chosen = sizes.find((v) => v.size === sel.size);
      const art = p.images && p.images.length
        ? p.images.map((src, i) => `<div><img src="${esc(src)}" alt="${esc(p.name)} photo ${i + 1}"${i ? ' loading="lazy"' : ''}></div>`).join('')
        : `<div>${tee(hex, `${p.name} in ${sel.colour}`)}</div>`;
      const left = p.limited_qty ? Math.max(0, p.limited_qty - (p.sold_count || 0)) : null;
      const soldOutSel = chosen && !canBuyVariant(p, chosen);
      const buyable = !p.coming_soon && available(p);
      const combos = bundlesFor(p);
      const look = lookFor(p);
      const pin = store.get('zs_pin', '');
      const ctaLabel = p.coming_soon ? `Drops in ${countdown(p.drop_at)}`
        : !available(p) ? 'Sold out' : soldOutSel ? 'Sold out in this size'
        : chosen ? `${p.is_preorder ? 'Pre-order' : 'Buy now'} · ${esc(inr(p.price))}` : p.is_preorder ? 'Pre-order' : 'Buy now';

      openSheet(`
        <div class="gallery${(p.images || []).length > 1 ? '' : ' single'}">${art}</div>
        ${p.drop_name ? `<div class="drop-pill">${esc(p.drop_name)}</div>` : ''}
        <h2 id="sheetTitle">${esc(p.name)}</h2>
        <div class="muted small">${esc(p.type)}${p.category ? ` · ${esc(p.category)}` : ''}${p.sold_count >= 10 ? ` · ${p.sold_count}+ sold` : ''}</div>
        <div class="price-row"><span class="price-big">${esc(inr(p.price))}</span>
          ${p.mrp > p.price ? `<span class="mrp">${esc(inr(p.mrp))}</span><span class="off">${p.discount_pct}% off</span>` : ''}</div>
        ${p.mrp > p.price ? `<div class="save-line">You save ${esc(inr(p.mrp - p.price))}</div>` : ''}

        ${p.coming_soon ? `<div class="box drop-box"><b>Dropping ${esc(dropDate(p.drop_at))}</b>
          <div class="drop-clock small-clock" id="pClock">${countdown(p.drop_at)}</div>
          ${p.limited_qty ? `<div class="muted small">Only ${p.limited_qty} pieces. When they're gone, they're gone.</div>` : ''}</div>` : ''}
        ${!p.coming_soon && left !== null ? `<div class="box limited-box"><b>Limited edition · ${left} of ${p.limited_qty} left</b>
          <div class="meter pink"><span style="width:${Math.min(100, ((p.limited_qty - left) / p.limited_qty) * 100)}%"></span></div></div>` : ''}
        ${p.is_preorder ? `<div class="box pre-box"><b>Made to order</b><div class="muted small">We print it for you after you order. You can watch it being made on the tracking page.</div></div>` : ''}

        <h3>Colour: <span class="muted">${esc(sel.colour || '')}</span></h3>
        <div class="swatches">${colours.map(([name, h]) => `<button class="swatch" data-colour="${esc(name)}" aria-pressed="${name === sel.colour}"><i style="background:${esc(h)}"></i>${esc(name)}</button>`).join('')}</div>

        <h3>Size</h3>
        <div class="sizes" id="sizes">${sizes.map((v) => {
          const ok = canBuyVariant(p, v);
          return `<button class="size${ok ? '' : ' out'}" data-size="${esc(v.size)}" aria-pressed="${v.size === sel.size}" aria-label="${esc(v.size)}${ok ? '' : ' sold out'}">
            ${esc(v.size)}${!p.is_preorder && v.stock > 0 && v.stock <= 3 ? `<small>${v.stock} left</small>` : ''}${ok ? '' : '<small>Notify</small>'}</button>`;
        }).join('')}</div>
        ${soldOutSel ? `<div class="box notify-box"><b>${esc(sel.colour)} / ${esc(sel.size)} is sold out</b>
          <div class="muted small">Get a notification on this phone the moment it's back.</div>
          <button class="btn btn-outline full" id="notifyMe">Notify me when it's back</button></div>` : ''}
        <details class="guide"><summary>Size guide</summary>${guideTable()}</details>

        <h3>Check delivery</h3>
        <form class="pin-check" id="pinForm"><input id="pinIn" inputmode="numeric" maxlength="6" placeholder="Enter pincode" value="${esc(pin)}" aria-label="Pincode">
          <button class="btn btn-outline" type="submit">Check</button></form>
        <div class="pin-out" id="pinOut">${delivery ? deliveryLine(delivery) : ''}</div>

        ${combos.length ? `<div class="combo-box">${combos.map((b) => `<div><b>Combo:</b> ${esc(b.name)}<span class="muted small"> · mix any ${b.qty}, applied in the bag</span></div>`).join('')}</div>` : ''}

        ${p.description ? `<h3>About this tee</h3><p class="muted" style="white-space:pre-line;margin:0">${esc(p.description)}</p>` : ''}
        <div class="facts">
          ${p.fabric ? `<span class="fact">${esc(p.fabric)}</span>` : ''}
          ${p.gsm ? `<span class="fact">${esc(p.gsm)} GSM</span>` : ''}
          ${state.settings.return_window_days ? `<span class="fact">${state.settings.return_window_days}-day exchange</span>` : ''}
          ${state.settings.cod_enabled ? '<span class="fact">COD available</span>' : ''}
          <span class="fact">Earn ${Math.floor(p.price * (state.settings.loyalty_points_per_100 || 5) / 100)} Z-Club points</span>
        </div>
        <p style="margin-top:16px"><button class="link" id="shareBtn">Share this tee</button></p>

        ${look.length ? `<h3>Complete the look</h3>${miniCards(look)}` : ''}
        ${state.viewed.length > 1 ? `<h3>Recently viewed</h3>${miniCards(state.viewed.filter((x) => x !== p.id).map(byId).filter(Boolean).slice(0, 6))}` : ''}

        <div class="sticky-cta">
          <button class="btn btn-outline" id="addBag" ${buyable ? '' : 'disabled'}>Add to bag</button>
          <button class="btn btn-lime" id="buyNow" ${buyable && !soldOutSel ? '' : 'disabled'}>${ctaLabel}</button>
        </div>`, p.name);

      const body = $('sheetBody');
      bindMini(body);
      if (p.coming_soon) {
        sheetTimer = setInterval(() => {
          if (new Date(p.drop_at) <= Date.now()) { clearInterval(sheetTimer); load().then(() => openProduct(p.id)).catch(() => {}); return; }
          const c = $('pClock'); if (c) c.textContent = countdown(p.drop_at);
          const b = $('buyNow'); if (b) b.textContent = `Drops in ${countdown(p.drop_at)}`;
        }, 1000);
      }
      body.querySelectorAll('[data-colour]').forEach((b) => { b.onclick = () => { sel.colour = b.dataset.colour; sel.size = null; draw(); }; });
      body.querySelectorAll('[data-size]').forEach((b) => { b.onclick = () => { sel.size = b.dataset.size; draw(); }; });
      if ($('notifyMe')) {
        $('notifyMe').onclick = async () => {
          const btn = $('notifyMe');
          btn.disabled = true; btn.textContent = 'Turning on…';
          try {
            const endpoint = await enablePush();
            const { error } = await sb.rpc('request_restock', { p_variant: chosen.id, p_endpoint: endpoint });
            if (error) throw error;
            btn.textContent = "Done — we'll notify you";
            toast(`We'll ping you when ${chosen.size} is back`);
          } catch (e) { btn.disabled = false; btn.textContent = 'Notify me when it\'s back'; toast(errText(e), true); }
        };
      }
      $('pinForm').onsubmit = async (e) => {
        e.preventDefault();
        const v = $('pinIn').value.replace(/\D/g, '');
        if (v.length !== 6) { $('pinOut').innerHTML = '<span class="err">Enter a 6-digit pincode.</span>'; return; }
        $('pinOut').innerHTML = '<span class="muted small">Checking…</span>';
        try {
          delivery = await deliveryFor(v);
          store.set('zs_pin', v);
          $('pinOut').innerHTML = deliveryLine(delivery);
        } catch (err) { $('pinOut').innerHTML = `<span class="err">${esc(errText(err))}</span>`; }
      };
      if (pin && !delivery) $('pinForm').requestSubmit();
      const add = (go) => {
        const v = sizes.find((x) => x.size === sel.size);
        if (!v) {
          const el = $('sizes');
          el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          toast('Pick your size first');
          return;
        }
        if (!canBuyVariant(p, v)) { toast('That size is sold out. Tap "Notify me".', true); return; }
        const inBag = state.bag.find((b) => b.variant_id === v.id);
        if (!p.is_preorder && (inBag ? inBag.qty : 0) + 1 > v.stock) { toast(`Only ${v.stock} left in ${v.size}`, true); return; }
        if (inBag) inBag.qty += 1; else state.bag.push({ variant_id: v.id, product_id: p.id, qty: 1 });
        saveBag();
        const btn = $('btnBag');
        btn.classList.remove('bump'); void btn.offsetWidth; btn.classList.add('bump');
        if (go) openCheckout(); else toast(`Added · ${sel.colour} / ${v.size}`);
      };
      $('addBag').onclick = () => add(false);
      $('buyNow').onclick = () => add(true);
      $('shareBtn').onclick = async () => {
        const url = location.href;
        try {
          if (navigator.share) await navigator.share({ title: p.name, text: `${p.name} · ${inr(p.price)} on Z-SHIRTS`, url });
          else { await navigator.clipboard.writeText(url); toast('Link copied'); }
        } catch (_) { /* cancelled */ }
      };
    };
    draw();
  }

  function deliveryLine(d) {
    const where = d.area ? `${d.area.city}, ${d.area.state}` : 'your area';
    return `<div class="deliv"><b>Delivery by ${esc(d.by_date)}</b> <span class="muted small">(${esc(d.days)} days to ${esc(where)})</span></div>
      <div class="muted small">${d.cod ? 'Cash on delivery available' : 'Prepaid only for this pincode'}</div>`;
  }

  // ------------------------------------------------------------ bag + live price from the database
  function saveBag() {
    state.bag = state.bag.filter((b) => b.qty > 0);
    store.set('zs_bag', state.bag);
    updateBagCount();
  }
  function updateBagCount() { $('bagCount').textContent = state.bag.reduce((s, b) => s + b.qty, 0); }

  function bagLines() {
    return state.bag.map((b) => {
      const hit = variantOf(b.variant_id);
      return hit ? { ...b, p: hit.p, v: hit.v } : { ...b, missing: true };
    });
  }
  const items = () => state.bag.map((b) => ({ variant_id: b.variant_id, qty: b.qty }));
  async function quote(opts = {}) {
    const { data, error } = await sb.rpc('quote_cart', { p_items: items(), p_opts: opts });
    if (error) throw error;
    return data;
  }

  function sumHtml(q, opts = {}) {
    if (!q) return '<div class="sum"><div class="muted small">Working out your price…</div></div>';
    return `<div class="sum">
      <div><span class="muted">Items (MRP)</span><span>${esc(inr(q.mrp_total))}</span></div>
      ${q.mrp_total > q.subtotal ? `<div class="save"><span>Discount</span><span>− ${esc(inr(q.mrp_total - q.subtotal))}</span></div>` : ''}
      ${q.bundle_discount > 0 ? `<div class="save"><span>Combo · ${esc(q.bundle_name)}</span><span>− ${esc(inr(q.bundle_discount))}</span></div>` : ''}
      ${q.coupon_discount > 0 ? `<div class="save"><span>Coupon ${esc(q.coupon_code)}</span><span>− ${esc(inr(q.coupon_discount))}</span></div>` : ''}
      ${q.points_used > 0 ? `<div class="save"><span>Z-Club points</span><span>− ${esc(inr(q.points_used))}</span></div>` : ''}
      <div><span class="muted">Delivery</span><span>${q.shipping ? esc(inr(q.shipping)) : 'Free'}</span></div>
      <div class="total"><span>Total</span><span>${esc(inr(q.total))}</span></div>
      ${q.mrp_total - q.total + q.shipping > 0 ? `<div class="saved-all">You save ${esc(inr(q.mrp_total - q.total + q.shipping))} on this order</div>` : ''}
      ${opts.earn !== false && q.points_earn > 0 ? `<div class="earn">${state.account ? `+${q.points_earn} Z-Club points after delivery` : `Sign in with Google to earn ${q.points_earn} Z-Club points`}</div>` : ''}
    </div>`;
  }

  // nudge towards the next combo, e.g. "Add 1 more basic tee to get Any 3 for ₹1,199"
  function comboNudge(q) {
    if (q && q.bundle_name) return '';
    for (const b of state.bundles) {
      const n = state.bag.reduce((s, x) => s + ((!b.product_ids || !b.product_ids.length || b.product_ids.includes(x.product_id)) ? x.qty : 0), 0);
      if (n > 0 && n < b.qty) return `<div class="combo-nudge">Add <b>${b.qty - n} more</b> to unlock <b>${esc(b.name)}</b></div>`;
    }
    return '';
  }

  async function openBag() {
    if (!state.bag.length) {
      openSheet(`<h2>Your bag</h2><div class="empty" style="padding:30px 0"><b>Nothing here yet</b>Find a fit you like.</div>
        <button class="btn btn-lime full" id="goShop">Shop tees</button>`, 'Bag');
      $('goShop').onclick = closeSheet;
      return;
    }
    const lines = bagLines();
    const s = state.settings;
    const render = (q, err) => {
      const sub = q ? q.total - q.shipping : lines.reduce((a, l) => a + (l.p ? l.p.price * l.qty : 0), 0);
      const left = s.free_shipping_above - sub;
      openSheet(`
        <h2>Your bag</h2>
        ${lines.map((l, i) => l.missing ? `<div class="line"><div></div><div class="muted">An item is no longer available</div><button class="link" data-rm="${i}">Remove</button></div>` : `
          <div class="line">
            <div class="line-img">${productArt(l.p, l.v.hex)}</div>
            <div>
              <div class="line-name">${esc(l.p.name)}</div>
              <div class="muted small">${esc(l.v.colour)} / ${esc(l.v.size)}${l.p.is_preorder ? ' · made to order' : l.v.stock < l.qty ? ` · <span style="color:var(--pink)">only ${l.v.stock} left</span>` : ''}</div>
              <div class="stepper"><button data-dec="${i}" aria-label="One less">−</button><span>${l.qty}</span><button data-inc="${i}" aria-label="One more">+</button></div>
            </div>
            <div class="line-price">${esc(inr(l.p.price * l.qty))}</div>
          </div>`).join('')}
        ${comboNudge(q)}
        ${s.free_shipping_above > 0 ? `<div class="ship-meter">${left > 0 ? `Add <b>${esc(inr(left))}</b> more for free delivery` : '<b style="color:var(--lime)">Free delivery unlocked</b>'}
          <div class="meter"><span style="width:${Math.min(100, (sub / s.free_shipping_above) * 100)}%"></span></div></div>` : ''}
        ${err ? `<div class="err">${esc(err)}</div>` : sumHtml(q)}
        ${q && q.errors && q.errors.length ? `<div class="err">${q.errors.map(esc).join('<br>')}</div>` : ''}
        <button class="btn btn-lime full" id="toCheckout">Checkout${q ? ` · ${esc(inr(q.total))}` : ''}</button>`, 'Bag');
      const body = $('sheetBody');
      body.querySelectorAll('[data-inc]').forEach((b) => {
        b.onclick = () => {
          const l = lines[Number(b.dataset.inc)];
          if (!l.p.is_preorder && l.qty + 1 > l.v.stock) return toast(`Only ${l.v.stock} left`, true);
          state.bag[Number(b.dataset.inc)].qty += 1; saveBag(); openBag();
        };
      });
      body.querySelectorAll('[data-dec]').forEach((b) => { b.onclick = () => { state.bag[Number(b.dataset.dec)].qty -= 1; saveBag(); openBag(); }; });
      body.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = () => { state.bag.splice(Number(b.dataset.rm), 1); saveBag(); openBag(); }; });
      $('toCheckout').onclick = openCheckout;
    };
    render(null);
    try { render(await quote()); } catch (e) { render(null, errText(e)); }
  }
  $('btnBag').onclick = openBag;

  // ------------------------------------------------------------ checkout
  function openCheckout() {
    if (!state.bag.length) return openBag();
    const acc = state.account;
    const c = store.get('zs_customer', {});
    const a = c.address || {};
    const attr = session.get('zs_attr', {});
    const pts = acc ? acc.points : 0;
    const opts = { coupon: store.get('zs_coupon', attr.coupon || ''), points: 0 };
    let q = null;
    let codOk = !!state.settings.cod_enabled;

    openSheet(`
      <h2>Checkout</h2>
      ${acc ? `<div class="hello">Hi ${esc((acc.name || '').split(' ')[0] || 'there')} · <b>${pts}</b> Z-Club points</div>`
        : `<button class="google-btn" id="coGoogle" type="button">${googleIcon()} Sign in with Google to earn points & see orders</button>`}
      <form id="coForm" novalidate>
        <label for="coPhone">Mobile number</label>
        <input id="coPhone" inputmode="numeric" autocomplete="tel-national" maxlength="14" required value="${esc(c.phone || (acc && acc.phone) || '')}" placeholder="10-digit mobile">
        <div class="hint">Used to track your order. No spam.</div>
        <label for="coName">Full name</label>
        <input id="coName" autocomplete="name" required value="${esc(c.name || (acc && acc.name) || '')}">
        <label for="coEmail">E-mail (optional)</label>
        <input id="coEmail" type="email" autocomplete="email" value="${esc(c.email || (acc && acc.email) || '')}">
        <label for="coPin">Pincode</label>
        <input id="coPin" inputmode="numeric" autocomplete="postal-code" maxlength="6" required value="${esc(a.pincode || store.get('zs_pin', ''))}">
        <div class="hint" id="pinHint">City and state fill in automatically.</div>
        <label for="coLine1">House / flat, street, area</label>
        <input id="coLine1" autocomplete="address-line1" required value="${esc(a.line1 || '')}">
        <label for="coLine2">Landmark (optional)</label>
        <input id="coLine2" autocomplete="address-line2" value="${esc(a.line2 || '')}">
        <div class="row2">
          <div><label for="coCity">City</label><input id="coCity" autocomplete="address-level2" required value="${esc(a.city || '')}"></div>
          <div><label for="coState">State</label><input id="coState" autocomplete="address-level1" required value="${esc(a.state || '')}"></div>
        </div>

        <h3>Coupon</h3>
        <div class="coupon-row"><input id="coCoupon" placeholder="Have a code?" autocapitalize="characters" value="${esc(opts.coupon)}" aria-label="Coupon code">
          <button class="btn btn-outline" type="button" id="coApply">${opts.coupon ? 'Remove' : 'Apply'}</button></div>
        <div class="hint" id="couponMsg"></div>

        ${pts > 0 ? `<label class="pay points-opt"><input type="checkbox" id="coPoints"><span><b>Use my Z-Club points</b><span class="muted small" id="ptsNote">You have ${pts} points (₹${pts})</span></span></label>` : ''}

        <h3>Payment</h3>
        <div class="pay-opts">
          <label class="pay"><input type="radio" name="pay" value="online" checked><span><b>Pay online</b><span class="muted small">UPI, cards, netbanking</span></span></label>
          ${state.settings.cod_enabled ? `<label class="pay" id="codOpt"><input type="radio" name="pay" value="cod"><span><b>Cash on delivery</b><span class="muted small" id="codNote">Pay when it arrives</span></span></label>` : ''}
        </div>
        <div id="coSum">${sumHtml(null)}</div>
        <div class="err" id="coErr" role="alert"></div>
        <button class="btn btn-lime full" id="coSubmit" type="submit">Place order</button>
      </form>`, 'Checkout');

    if ($('coGoogle')) $('coGoogle').onclick = signIn;
    const refresh = debounce(async () => {
      try {
        q = await quote(opts);
        $('coSum').innerHTML = sumHtml(q);
        const msg = $('couponMsg');
        if (opts.coupon) {
          msg.className = 'hint ' + (q.coupon_error ? 'bad' : 'good');
          msg.textContent = q.coupon_error || `${q.coupon_code} applied · you save ${inr(q.coupon_discount)}`;
        } else { msg.textContent = ''; }
        if ($('ptsNote') && opts.points) $('ptsNote').textContent = `Using ${q.points_used} points (max ${state.settings.loyalty_max_redeem_pct || 20}% of the order)`;
        $('coSubmit').textContent = `${q.lines.some((l) => l.preorder) ? 'Pre-order' : 'Place order'} · ${inr(q.total)}`;
        $('coErr').textContent = (q.errors || []).join(' ');
      } catch (e) { $('coErr').textContent = errText(e); }
    }, 250);
    refresh();

    $('coApply').onclick = () => {
      if (opts.coupon) { opts.coupon = ''; $('coCoupon').value = ''; $('coApply').textContent = 'Apply'; }
      else { opts.coupon = $('coCoupon').value.trim().toUpperCase(); if (opts.coupon) $('coApply').textContent = 'Remove'; }
      store.set('zs_coupon', opts.coupon);
      refresh();
    };
    $('coCoupon').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('coApply').click(); } });
    if ($('coPoints')) $('coPoints').onchange = (e) => { opts.points = e.target.checked ? pts : 0; if (!e.target.checked) $('ptsNote').textContent = `You have ${pts} points (₹${pts})`; refresh(); };

    const pin = $('coPin');
    const lookup = async () => {
      const v = pin.value.replace(/\D/g, '');
      if (v.length !== 6) return;
      $('pinHint').textContent = 'Finding your area…';
      try {
        const d = await deliveryFor(v);
        if (d.area) {
          if (!$('coCity').value) $('coCity').value = d.area.city;
          if (!$('coState').value) $('coState').value = d.area.state;
        }
        $('pinHint').innerHTML = `${d.area ? esc(`${d.area.city}, ${d.area.state}`) + ' · ' : ''}<b style="color:var(--cyan)">Delivery by ${esc(d.by_date)}</b>`;
        codOk = d.cod;
        if ($('codOpt')) {
          const r = $('codOpt').querySelector('input');
          r.disabled = !d.cod;
          $('codOpt').classList.toggle('off', !d.cod);
          $('codNote').textContent = d.cod ? 'Pay when it arrives' : 'Not available for this pincode';
          if (!d.cod && r.checked) document.querySelector('input[name="pay"][value="online"]').checked = true;
        }
      } catch (_) { $('pinHint').textContent = 'Fill in city and state.'; }
    };
    pin.addEventListener('input', () => { if (pin.value.replace(/\D/g, '').length === 6) { $('coCity').value = ''; $('coState').value = ''; lookup(); } });
    if (pin.value.length === 6) lookup();

    $('coForm').onsubmit = async (e) => {
      e.preventDefault();
      const err = $('coErr');
      err.textContent = '';
      const phone = $('coPhone').value.replace(/\D/g, '').slice(-10);
      const customer = {
        name: $('coName').value.trim(), phone, email: $('coEmail').value.trim(),
        address: {
          line1: $('coLine1').value.trim(), line2: $('coLine2').value.trim(),
          city: $('coCity').value.trim(), state: $('coState').value.trim(), pincode: pin.value.replace(/\D/g, ''),
        },
      };
      if (phone.length !== 10) { err.textContent = 'Enter a 10-digit mobile number.'; return $('coPhone').focus(); }
      if (customer.name.length < 2) { err.textContent = 'Enter your name.'; return $('coName').focus(); }
      if (customer.address.pincode.length !== 6) { err.textContent = 'Enter a 6-digit pincode.'; return pin.focus(); }
      if (!customer.address.line1 || !customer.address.city || !customer.address.state) { err.textContent = 'Complete your address.'; return; }
      if (q && q.coupon_error && opts.coupon) { err.textContent = `${q.coupon_error} Remove the code to continue.`; return; }
      store.set('zs_customer', customer);

      const method = document.querySelector('input[name="pay"]:checked').value;
      if (method === 'cod' && !codOk) { err.textContent = 'Cash on delivery is not available for this pincode.'; return; }
      const btn = $('coSubmit');
      btn.disabled = true; btn.textContent = 'Placing order…';
      const { data, error } = await sb.rpc('place_web_order', {
        p_customer: customer,
        p_items: items(),
        p_method: method,
        p_opts: { coupon: opts.coupon || null, points: opts.points || 0, utm_source: attr.utm_source || null, utm_campaign: attr.utm_campaign || null },
      });
      if (error) {
        err.textContent = errText(error);
        btn.disabled = false; btn.textContent = 'Place order';
        load().catch(() => {});
        return;
      }
      store.set('zs_last_order', { order_no: data.order_no, phone });
      store.set('zs_coupon', '');
      if (method === 'cod') return success(data.order_no, data.total, 'cod');
      startPayment(data.order_no, customer, data.total);
    };
  }

  // ------------------------------------------------------------ payment
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
      const s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.onload = res; s.onerror = () => rej(new Error('Could not open the payment window. Check your internet.'));
      document.head.appendChild(s);
    });
  }
  async function startPayment(orderNo, customer, total) {
    try {
      const [o] = await Promise.all([callPay({ action: 'create', order_no: orderNo }), loadRazorpay()]);
      const rz = new window.Razorpay({
        key: o.key, amount: o.amount, currency: o.currency, order_id: o.razorpay_order_id,
        name: 'Z-SHIRTS', description: `Order ${orderNo}`,
        prefill: { name: customer.name, contact: customer.phone, email: customer.email || undefined },
        theme: { color: '#c6ff00' },
        handler: async (resp) => {
          openSheet(`<div class="done"><div class="big">Confirming…</div><p class="muted">Checking your payment with the bank.</p></div>`, 'Confirming');
          try {
            await callPay({ action: 'verify', order_no: orderNo, ...resp });
            success(orderNo, total, 'online');
          } catch (e) {
            pending(orderNo, customer, total, 'We received your payment details and are confirming them. Track your order in a minute.');
          }
        },
        modal: { ondismiss: () => pending(orderNo, customer, total) },
      });
      rz.on('payment.failed', () => {});
      rz.open();
    } catch (e) {
      pending(orderNo, customer, total, errText(e));
    }
  }
  function pending(orderNo, customer, total, msg) {
    openSheet(`
      <div class="done">
        <div class="big" style="color:var(--pink)">Payment not finished</div>
        <p class="muted">${esc(msg || 'Your tees are held for 30 minutes. Finish paying to confirm the order.')}</p>
        <div class="order-no">${esc(orderNo)}</div>
      </div>
      <button class="btn btn-lime full" id="retryPay">Pay ${esc(inr(total))}</button>
      <button class="btn btn-outline full" id="pendTrack">Track order</button>`, 'Payment');
    $('retryPay').onclick = () => startPayment(orderNo, customer, total);
    $('pendTrack').onclick = () => openTrack({ order_no: orderNo, phone: customer.phone });
  }

  function success(orderNo, total, method) {
    state.bag = [];
    saveBag();
    if (window.ZSCelebrate) { window.ZSCelebrate.confetti(1.2); window.ZSCelebrate.chime(); }
    const last = store.get('zs_last_order', {});
    const pushOn = store.get('zs_push', false);
    openSheet(`
      <div class="done">
        <div class="big">Order placed!</div>
        <p class="muted">${method === 'cod' ? `Keep ${esc(inr(total))} ready when it arrives.` : `Paid ${esc(inr(total))}. Your fit is on its way.`}</p>
        <div class="order-no">${esc(orderNo)}</div>
        <p class="muted small">Save this number. Track any time with it and your mobile number${state.account ? ', or open My account' : ''}.</p>
      </div>
      ${state.account && !pushOn ? '<button class="btn btn-outline full" id="sPush">Get delivery updates on this phone</button>' : ''}
      <button class="btn btn-lime full" id="sTrack">Track order</button>
      <button class="btn btn-outline full" id="sShop">Keep shopping</button>`, 'Order placed');
    $('sTrack').onclick = () => openTrack({ order_no: orderNo, phone: last.phone });
    $('sShop').onclick = () => { closeSheet(); load().catch(() => {}); };
    if ($('sPush')) $('sPush').onclick = async () => { try { await enablePush(); toast("You'll get updates on this phone"); $('sPush').remove(); } catch (e) { toast(errText(e), true); } };
    refreshAccount();
  }

  // ------------------------------------------------------------ Google account, Z-Club, order history
  function googleIcon() {
    return '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3A12 12 0 1 1 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 1 0 44 24c0-1.2-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8A12 12 0 0 1 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 0 0 6.3 14.7z"/><path fill="#4CAF50" d="M24 44a20 20 0 0 0 13.4-5.2l-6.2-5.2A12 12 0 0 1 12.7 28l-6.5 5A20 20 0 0 0 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.3-.4-3.5z"/></svg>';
  }
  async function signIn() {
    session.set('zs_after_login', true);
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: 'select_account' } },
    });
    if (error) toast(/provider is not enabled|Unsupported provider/i.test(errText(error)) ? 'Google sign-in is being set up. Please try again soon.' : errText(error), true);
  }
  async function refreshAccount() {
    if (!state.user) { state.account = null; paintAccountBtn(); return; }
    const { data, error } = await sb.rpc('my_account');
    state.account = error ? null : data;
    paintAccountBtn();
  }
  function paintAccountBtn() {
    const b = $('btnAccount');
    b.classList.toggle('in', !!state.account);
    b.querySelector('.pts').textContent = state.account ? state.account.points : '';
    b.setAttribute('aria-label', state.account ? `My account, ${state.account.points} points` : 'Sign in');
  }

  function clubPitch() {
    const per = state.settings.loyalty_points_per_100 || 5;
    return `<div class="club-card">
      <div class="club-logo">Z<span>-</span>CLUB</div>
      <ul class="club-perks">
        <li><b>${per} points</b> on every ₹100 you spend</li>
        <li><b>1 point = ₹1</b> off your next order</li>
        <li>All your orders and tracking in one place</li>
        <li>Phone alerts when your size is back</li>
      </ul></div>`;
  }

  function openAccount() {
    if (!state.user) {
      openSheet(`<h2>Join Z-Club</h2>${clubPitch()}
        <button class="google-btn big" id="accGoogle">${googleIcon()} Continue with Google</button>
        <p class="muted small" style="text-align:center">No password. We only see your name and e-mail.</p>`, 'Account');
      $('accGoogle').onclick = signIn;
      return;
    }
    if (!state.account) return openProfile(true);
    const a = state.account;
    const orders = a.orders || [];
    const per = state.settings.loyalty_points_per_100 || 5;
    openSheet(`
      <h2>Hey ${esc((a.name || '').split(' ')[0] || 'there')}</h2>
      <div class="club-card points">
        <div class="club-logo">Z<span>-</span>CLUB</div>
        <div class="pts-big">${a.points}</div><div class="muted small">points · worth ${esc(inr(a.points))} at checkout</div>
        <div class="muted small" style="margin-top:6px">${per} points on every ₹100. Points land when your order is delivered.</div>
      </div>
      <h3>My orders</h3>
      ${orders.length ? orders.map((o, i) => `
        <button class="order-row" data-o="${i}">
          <div><b>${esc(o.order_no)}</b> <span class="status s-${esc(o.status)}">${esc(statusLabel(o))}</span>
            <div class="muted small">${esc(new Date(o.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }))} · ${(o.items || []).map((x) => `${esc(x.name)} ×${x.qty}`).join(', ')}</div></div>
          <div class="line-price">${esc(inr(o.total))}</div>
        </button>`).join('') : '<div class="empty" style="padding:20px 0"><b>No orders yet</b>Your first fit is waiting.</div>'}
      ${a.points_history && a.points_history.length ? `<details class="guide"><summary>Points history</summary>
        ${a.points_history.map((h) => `<div class="sum"><div><span>${esc(h.note || h.reason)}</span><span style="color:${h.points > 0 ? 'var(--lime)' : 'var(--pink)'}">${h.points > 0 ? '+' : ''}${h.points}</span></div></div>`).join('')}</details>` : ''}
      <h3>Profile</h3>
      <div class="muted small">${esc(a.name || '')} · ${esc(a.phone || 'no phone')} · ${esc(a.email || '')}</div>
      <p><button class="link" id="accEdit">Edit name / phone</button> &nbsp; <button class="link" id="accPush">${store.get('zs_push', false) ? 'Phone alerts on' : 'Turn on phone alerts'}</button></p>
      <button class="btn btn-outline full" id="accOut">Sign out</button>`, 'Account');
    $('sheetBody').querySelectorAll('[data-o]').forEach((b) => {
      b.onclick = async () => {
        const o = orders[Number(b.dataset.o)];
        const { data, error } = await sb.rpc('track_order', { p_order_no: o.order_no, p_phone: o.phone || a.phone || '' });
        if (error) return openTrack({ order_no: o.order_no, phone: '' });
        showTracking(data, o.phone || a.phone);
      };
    });
    $('accEdit').onclick = () => openProfile(false);
    $('accPush').onclick = async () => { try { await enablePush(); toast('Phone alerts are on'); $('accPush').textContent = 'Phone alerts on'; } catch (e) { toast(errText(e), true); } };
    $('accOut').onclick = async () => { await sb.auth.signOut(); state.user = null; state.account = null; paintAccountBtn(); closeSheet(); toast('Signed out'); };
  }

  function openProfile(first) {
    const u = state.user || {};
    const meta = u.user_metadata || {};
    const a = state.account || {};
    openSheet(`
      <h2>${first ? 'Welcome to Z-Club' : 'Your details'}</h2>
      ${first ? '<p class="muted">One last thing: your mobile number links your orders, including ones placed on WhatsApp or at the store.</p>' : ''}
      <form id="pfForm">
        <label for="pfName">Name</label><input id="pfName" autocomplete="name" value="${esc(a.name || meta.full_name || meta.name || '')}" required>
        <label for="pfPhone">Mobile number</label><input id="pfPhone" inputmode="numeric" autocomplete="tel-national" maxlength="14" value="${esc(a.phone || '')}" required>
        <div class="err" id="pfErr" role="alert"></div>
        <button class="btn btn-lime full" type="submit">${first ? 'Start earning points' : 'Save'}</button>
      </form>
      ${first ? '<button class="btn btn-outline full" id="pfOut">Not you? Sign out</button>' : ''}`, 'Profile');
    if ($('pfOut')) $('pfOut').onclick = async () => { await sb.auth.signOut(); state.user = null; paintAccountBtn(); closeSheet(); };
    $('pfForm').onsubmit = async (e) => {
      e.preventDefault();
      const { error } = await sb.rpc('save_my_profile', { p_name: $('pfName').value, p_phone: $('pfPhone').value.replace(/\D/g, '').slice(-10) });
      if (error) { $('pfErr').textContent = errText(error); return; }
      await refreshAccount();
      if (first && window.ZSCelebrate) window.ZSCelebrate.confetti(0.8);
      toast(first ? "You're in Z-Club!" : 'Saved');
      if (state.bag.length && first) openCheckout(); else openAccount();
    };
  }
  $('btnAccount').onclick = openAccount;

  sb.auth.onAuthStateChange((_ev, s) => {
    const was = state.user && state.user.id;
    state.user = s ? s.user : null;
    if ((state.user && state.user.id) !== was) {
      refreshAccount().then(() => {
        if (state.user && session.get('zs_after_login', false)) {
          session.set('zs_after_login', false);
          if (!state.account) openProfile(true);
          else { toast(`Welcome back, ${(state.account.name || '').split(' ')[0]}`); if (state.bag.length) openCheckout(); }
        }
      });
    }
  });

  // ------------------------------------------------------------ tracking + exchanges
  const STEPS = [['placed', 'Order placed'], ['confirmed', 'Confirmed'], ['packed', 'Packed'], ['shipped', 'Shipped'], ['delivered', 'Delivered']];
  const MAKING = [['queued', 'In the queue'], ['printing', 'Printing'], ['quality_check', 'Quality check'], ['ready', 'Ready to ship']];
  const dateOf = (d) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  function statusLabel(o) {
    if (o.production_status && ['placed', 'confirmed'].includes(o.status)) return (MAKING.find((m) => m[0] === o.production_status) || [])[1] || 'Making';
    return { placed: 'Placed', confirmed: 'Confirmed', packed: 'Packed', shipped: 'On the way', delivered: 'Delivered', cancelled: 'Cancelled', rto: 'Returned', returned: 'Returned' }[o.status] || o.status;
  }

  function openTrack(pre) {
    const last = pre || store.get('zs_last_order', {});
    openSheet(`
      <h2>Track your order</h2>
      <form id="trForm">
        <label for="trNo">Order number</label>
        <input id="trNo" required placeholder="ZS1001" value="${esc(last.order_no || '')}" autocapitalize="characters">
        <label for="trPhone">Mobile number used for the order</label>
        <input id="trPhone" inputmode="numeric" required value="${esc(last.phone || '')}">
        <div class="err" id="trErr" role="alert"></div>
        <button class="btn btn-lime full" type="submit">Track</button>
      </form>
      ${state.user ? '' : '<p class="muted small" style="text-align:center;margin-top:16px">Tip: <button class="link" id="trJoin">sign in with Google</button> to see all your orders without typing.</p>'}`, 'Track order');
    if ($('trJoin')) $('trJoin').onclick = signIn;
    $('trForm').onsubmit = async (e) => {
      e.preventDefault();
      const no = $('trNo').value.trim(), phone = $('trPhone').value;
      const { data, error } = await sb.rpc('track_order', { p_order_no: no, p_phone: phone });
      if (error) { $('trErr').textContent = errText(error); return; }
      store.set('zs_last_order', { order_no: data.order_no, phone: phone.replace(/\D/g, '').slice(-10) });
      showTracking(data, phone);
    };
    if (last.order_no && last.phone && pre) $('trForm').requestSubmit();
  }

  function showTracking(o, phone) {
    const ev = o.events || [];
    const at = (st) => { const e = ev.filter((x) => x.status === st).pop(); return e ? dateOf(e.at) : ''; };
    const bad = { cancelled: 'Cancelled', rto: 'Returned to us by the courier', returned: 'Returned' }[o.status];
    const reached = STEPS.findIndex(([s]) => s === o.status);
    const lastGood = bad ? Math.max(...STEPS.map(([s], i) => (at(s) ? i : -1))) : reached;
    const days = Number(o.return_days) || 0;
    const daysLeft = o.delivered_at ? Math.ceil(days - (Date.now() - new Date(o.delivered_at)) / 864e5) : 0;
    const canAsk = o.status === 'delivered' && o.delivered_at && daysLeft > 0 &&
      !(o.requests || []).some((r) => ['open', 'approved'].includes(r.status));
    const waiting = o.payment_method === 'online' && o.payment_status === 'pending' && o.status !== 'cancelled';
    const making = o.production_status && !bad && ['placed', 'confirmed'].includes(o.status);
    const mIdx = MAKING.findIndex(([s]) => s === o.production_status);

    openSheet(`
      <h2>${esc(o.order_no)}</h2>
      <div class="muted small">Placed ${esc(dateOf(o.created_at))} · ${esc(inr(o.total))} · ${o.payment_method === 'cod' ? 'Cash on delivery' : 'Paid online'}${o.payment_status === 'refunded' ? ' · refunded' : ''}${o.coupon_code ? ` · ${esc(o.coupon_code)}` : ''}</div>
      ${waiting ? `<div class="box" style="border-color:var(--pink)">Payment not completed yet. Unpaid orders are released after 30 minutes.</div>` : ''}
      ${making ? `<div class="box making"><b>Your tee is being made</b>
        <div class="make-steps">${MAKING.map(([s, l], i) => `<span class="${i <= mIdx ? 'on' : ''}">${l}</span>`).join('')}</div></div>` : ''}
      <ol class="steps">
        ${STEPS.map(([s, label], i) => `<li class="${i <= lastGood ? 'done-step' : ''}">${label}${at(s) ? `<small>${esc(at(s))}</small>` : ''}
          ${s === 'shipped' && o.courier && i <= lastGood ? `<small>${esc(o.courier)}${o.tracking_no ? ` · AWB ${esc(o.tracking_no)}` : ''}</small>` : ''}</li>`).join('')}
        ${bad ? `<li class="bad done-step">${bad}<small>${esc(at(o.status))}</small></li>` : ''}
      </ol>
      <h3>Items</h3>
      ${(o.items || []).map((i) => `<div class="sum"><div><span>${esc(i.name)} <span class="muted">· ${esc(i.variant)} × ${i.qty}</span></span><span>${esc(inr(i.price * i.qty))}</span></div></div>`).join('')}
      ${(o.requests || []).map((r) => `<div class="box"><b>${r.kind === 'replacement' ? 'Exchange' : 'Return'} request</b> · ${esc(r.status)}${r.resolution ? `<div class="muted small">${esc(r.resolution)}</div>` : ''}</div>`).join('')}
      ${canAsk ? `<h3>Something not right?</h3>
        <div class="sticky-cta" style="position:static;margin:0;padding:0;background:none">
          <button class="btn btn-outline" id="askEx">Exchange size</button>
          <button class="btn btn-outline" id="askRet">Return</button>
        </div>
        <p class="muted small">${daysLeft} day${daysLeft === 1 ? '' : 's'} left to ask for an exchange or return.</p>` : ''}
      ${o.status === 'delivered' && !canAsk && days && daysLeft <= 0 ? `<p class="muted small">The ${days}-day exchange window for this order has closed.</p>` : ''}
      ${cfg.STORE_WHATSAPP ? `<a class="btn btn-outline full" style="text-decoration:none" target="_blank" rel="noopener"
         href="https://wa.me/${esc(cfg.STORE_WHATSAPP)}?text=${encodeURIComponent(`Hi Z-SHIRTS, about my order ${o.order_no}`)}">Chat about this order</a>` : ''}`, 'Order');
    if (canAsk) {
      $('askEx').onclick = () => openService(o, phone, 'replacement');
      $('askRet').onclick = () => openService(o, phone, 'return');
    }
  }

  function openService(o, phone, kind) {
    const list = o.items || [];
    const optionsFor = (item) => {
      const p = byId(item.product_id);
      if (!p) return [];
      return p.variants.filter((v) => v.id !== item.variant_id && v.stock > 0);
    };
    openSheet(`
      <h2>${kind === 'replacement' ? 'Exchange a size or colour' : 'Return an item'}</h2>
      <form id="svForm">
        <label for="svItem">Which item?</label>
        <select id="svItem">${list.map((i, n) => `<option value="${n}">${esc(i.name)} · ${esc(i.variant)}</option>`).join('')}</select>
        ${kind === 'replacement' ? `<label for="svNew">Exchange it for</label><select id="svNew"></select>
          <div class="hint">Only sizes and colours in stock are shown.</div>` : ''}
        <label for="svReason">What went wrong?</label>
        <textarea id="svReason" required placeholder="${kind === 'replacement' ? 'e.g. M is too tight on the shoulders' : 'e.g. Colour looks different from the photo'}"></textarea>
        <div class="hint">Keep the tags on. If there's a defect, send a photo on WhatsApp with your order number.</div>
        <div class="err" id="svErr" role="alert"></div>
        <button class="btn btn-lime full" type="submit">Send request</button>
      </form>`, 'Request');
    const fill = () => {
      if (kind !== 'replacement') return;
      const opts = optionsFor(list[Number($('svItem').value)]);
      $('svNew').innerHTML = opts.length
        ? opts.map((v) => `<option value="${v.id}">${esc(v.colour)} / ${esc(v.size)}</option>`).join('')
        : '<option value="">No other size in stock right now</option>';
    };
    fill();
    $('svItem').onchange = fill;
    $('svForm').onsubmit = async (e) => {
      e.preventDefault();
      const item = list[Number($('svItem').value)];
      const payload = { order_item_id: item.id, qty: 1 };
      if (kind === 'replacement') {
        if (!$('svNew').value) { $('svErr').textContent = 'No other size is in stock right now. Try a return instead.'; return; }
        payload.new_variant_id = Number($('svNew').value);
      }
      const { error } = await sb.rpc('request_service', {
        p_order_no: o.order_no, p_phone: phone, p_kind: kind, p_reason: $('svReason').value, p_items: [payload],
      });
      if (error) { $('svErr').textContent = errText(error); return; }
      toast('Request sent. We will get back to you soon.');
      const { data } = await sb.rpc('track_order', { p_order_no: o.order_no, p_phone: phone });
      if (data) showTracking(data, phone);
    };
  }
  $('btnTrack').onclick = () => openTrack();

  // ------------------------------------------------------------ deep links (?p=slug, ?track=ZS1001, ?coupon=CODE)
  function deepLink() {
    const q = new URLSearchParams(location.search);
    if (q.get('p')) {
      const p = state.products.find((x) => x.slug === q.get('p'));
      if (p) openProduct(p.id);
    } else if (q.get('track')) {
      openTrack({ order_no: q.get('track'), phone: '' });
    } else if (q.get('coupon') || q.get('code')) {
      toast(`Code ${store.get('zs_coupon', '')} will be applied at checkout`);
    }
  }
  $('sheetClose').addEventListener('click', () => { try { history.replaceState(null, '', location.pathname); } catch (_) { /* */ } });

  load().catch((e) => {
    $('grid').innerHTML = `<div class="empty"><b>Couldn't load the shop</b>${esc(errText(e))}<br><br><button class="btn btn-outline" onclick="location.reload()" style="max-width:200px">Try again</button></div>`;
  });
})();
