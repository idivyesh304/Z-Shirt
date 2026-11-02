/* Z-SHIRTS shop · catalogue, filters, bag, checkout, payment, tracking, exchanges.
 * Prices, stock and totals are always re-checked by the database at checkout.
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
  let toastTimer;
  function toast(msg, err = false) {
    const el = $('toast');
    el.textContent = msg;
    el.className = 'show' + (err ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = ''; }, err ? 5000 : 2400);
  }
  const errText = (e) => (e && (e.message || e.error)) || String(e);
  const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'];

  // An oversized tee drawn in the variant's own colour — the shop looks complete before photos exist.
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

  // ------------------------------------------------------------ setup check
  if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes('YOUR-PROJECT')) {
    document.querySelector('main').innerHTML = `<div class="setup"><div class="logo">Z<span>-</span>SHIRTS</div>
      <p class="muted">The shop opens once <b>config.js</b> has the Supabase project details. See the README.</p></div>`;
    return;
  }
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: false } });

  const state = {
    products: [],
    settings: { shipping_fee: 0, free_shipping_above: 0, cod_enabled: 1, return_window_days: 7 },
    cat: 'all', q: '',
    f: { price: '', types: new Set(), colours: new Set(), minOff: 0, inStock: false, sort: 'featured' },
    bag: store.get('zs_bag', []),
  };
  const byId = (id) => state.products.find((p) => p.id === id);
  const variantOf = (vid) => {
    for (const p of state.products) {
      const v = p.variants.find((x) => x.id === vid);
      if (v) return { p, v };
    }
    return null;
  };

  // ------------------------------------------------------------ sheet
  let lastFocus;
  function openSheet(html, title = '') {
    lastFocus = document.activeElement;
    $('sheetBody').innerHTML = html;
    $('sheet').setAttribute('aria-label', title);
    $('sheet').hidden = false;
    $('scrim').hidden = false;
    document.body.style.overflow = 'hidden';
    $('sheet').scrollTop = 0;
    $('sheetClose').focus();
  }
  function closeSheet() {
    $('sheet').hidden = true;
    $('scrim').hidden = true;
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  $('sheetClose').onclick = closeSheet;
  $('scrim').onclick = closeSheet;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('sheet').hidden) closeSheet(); });

  // ------------------------------------------------------------ load
  async function load() {
    const [cat, set] = await Promise.all([
      sb.from('catalog').select('*'),
      sb.from('public_settings').select('*'),
    ]);
    if (cat.error) throw cat.error;
    state.products = (cat.data || []).map((p) => ({ ...p, variants: p.variants || [] }));
    (set.data || []).forEach((r) => { state.settings[r.key] = Number(r.value); });
    renderChrome();
    renderGrid();
    deepLink();
  }

  function renderChrome() {
    const s = state.settings;
    const ticks = [];
    if (s.free_shipping_above > 0) ticks.push(`Free delivery above ${inr(s.free_shipping_above)}`);
    else if (s.shipping_fee === 0) ticks.push('Free delivery across India');
    if (s.cod_enabled) ticks.push('Cash on delivery available');
    if (s.return_window_days) ticks.push(`${s.return_window_days}-day size exchange`);
    ticks.push('Pay by UPI, cards or netbanking');
    const gsm = Math.max(0, ...state.products.map((p) => p.gsm || 0));
    if (gsm) ticks.push(`Up to ${gsm} GSM cotton`);
    const half = ticks.map((t) => `<span>${esc(t)}</span>`).join('');
    $('ticker').innerHTML = half + half;

    const cats = [...new Map(state.products.filter((p) => p.category).map((p) => [p.category_slug, p.category])).entries()];
    $('catChips').innerHTML = [['all', 'All']].concat(cats)
      .map(([slug, name]) => `<button class="chip" role="tab" data-cat="${esc(slug)}" aria-pressed="${state.cat === slug}">${esc(name)}</button>`).join('');
    $('catChips').querySelectorAll('.chip').forEach((b) => {
      b.onclick = () => { state.cat = b.dataset.cat; renderChrome(); renderGrid(); };
    });

    const links = [`<button id="lnTrack">Track order</button>`, `<button id="lnGuide">Size guide</button>`];
    if (cfg.INSTAGRAM) links.push(`<a href="https://instagram.com/${esc(cfg.INSTAGRAM)}" target="_blank" rel="noopener">Instagram</a>`);
    if (cfg.STORE_WHATSAPP) links.push(`<a href="https://wa.me/${esc(cfg.STORE_WHATSAPP)}" target="_blank" rel="noopener">WhatsApp</a>`);
    $('footLinks').innerHTML = links.join('');
    $('lnTrack').onclick = () => openTrack();
    $('lnGuide').onclick = () => openSheet(`<h2>Size guide</h2>${guideTable()}`, 'Size guide');
    if (cfg.STORE_WHATSAPP) {
      $('waFloat').href = `https://wa.me/${cfg.STORE_WHATSAPP}?text=${encodeURIComponent('Hi Z-SHIRTS! I have a question.')}`;
      $('waFloat').hidden = false;
    }
    updateBagCount();
  }

  // ------------------------------------------------------------ filters
  function filtered() {
    const { f } = state;
    const q = state.q.trim().toLowerCase();
    let list = state.products.filter((p) => {
      if (state.cat !== 'all' && p.category_slug !== state.cat) return false;
      if (q) {
        const hay = [p.name, p.type, p.category, ...(p.tags || []), ...p.variants.map((v) => v.colour)].join(' ').toLowerCase();
        if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
      }
      if (f.price) {
        const [lo, hi] = f.price.split('-').map(Number);
        if (p.price < lo || (hi && p.price > hi)) return false;
      }
      if (f.types.size && !f.types.has(p.type)) return false;
      if (f.colours.size && !p.variants.some((v) => f.colours.has(v.colour) && (!f.inStock || v.stock > 0))) return false;
      if (f.minOff && p.discount_pct < f.minOff) return false;
      if (f.inStock && p.total_stock <= 0) return false;
      return true;
    });
    const sorts = {
      featured: (a, b) => (b.featured - a.featured) || (new Date(b.published_at) - new Date(a.published_at)),
      new: (a, b) => new Date(b.published_at) - new Date(a.published_at),
      low: (a, b) => a.price - b.price,
      high: (a, b) => b.price - a.price,
      off: (a, b) => b.discount_pct - a.discount_pct,
    };
    list = list.sort(sorts[f.sort] || sorts.featured);
    // sold-out items sink to the bottom
    return list.sort((a, b) => (b.total_stock > 0) - (a.total_stock > 0));
  }
  const activeFilterCount = () => {
    const f = state.f;
    return (f.price ? 1 : 0) + f.types.size + f.colours.size + (f.minOff ? 1 : 0) + (f.inStock ? 1 : 0);
  };

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
      const low = p.total_stock > 0 && p.total_stock <= 5;
      return `
        <button class="card${p.total_stock <= 0 ? ' sold-out' : ''}" data-id="${p.id}" aria-label="${esc(p.name)}, ${esc(inr(p.price))}">
          <div class="card-img">
            ${productArt(p, colours[0] && colours[0][1])}
            <div class="tag"><div class="tag-price">${esc(inr(p.price))}</div>
              ${p.mrp > p.price ? `<div class="tag-mrp">${esc(inr(p.mrp))}</div><span class="tag-off">${p.discount_pct}% off</span>` : ''}</div>
            ${low ? `<span class="stock-flag">Only ${p.total_stock} left</span>` : ''}
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
      <div class="chips" style="flex-wrap:wrap">${[['featured', 'Picked for you'], ['new', 'Newest'], ['low', 'Price: low to high'], ['high', 'Price: high to low'], ['off', 'Biggest discount']]
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

  // ------------------------------------------------------------ product
  function guideTable() {
    const rows = cfg.SIZE_GUIDE || [];
    if (!rows.length) return '<p class="muted">Size guide coming soon.</p>';
    return `<p class="muted small">Oversized fit, garment measurements in inches. Between sizes? Take your usual size for the intended baggy look.</p>
      <table><thead><tr><th>Size</th><th>Chest</th><th>Length</th><th>Shoulder</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td><b>${esc(r.size)}</b></td><td>${esc(r.chest)}</td><td>${esc(r.length)}</td><td>${esc(r.shoulder)}</td></tr>`).join('')}</tbody></table>`;
  }

  function openProduct(id, preColour) {
    const p = byId(id);
    if (!p) return;
    const colours = [...new Map(p.variants.map((v) => [v.colour, v.hex])).entries()];
    const firstInStock = p.variants.find((v) => v.stock > 0);
    const sel = { colour: preColour || (firstInStock ? firstInStock.colour : colours[0] && colours[0][0]), size: null };
    try { history.replaceState(null, '', `?p=${encodeURIComponent(p.slug)}`); } catch (_) { /* file:// */ }

    const draw = () => {
      const hex = (colours.find((c) => c[0] === sel.colour) || [])[1];
      const sizes = p.variants.filter((v) => v.colour === sel.colour)
        .sort((a, b) => SIZE_ORDER.indexOf(a.size) - SIZE_ORDER.indexOf(b.size));
      const chosen = sizes.find((v) => v.size === sel.size);
      const art = p.images && p.images.length
        ? p.images.map((src, i) => `<div><img src="${esc(src)}" alt="${esc(p.name)} photo ${i + 1}"${i ? ' loading="lazy"' : ''}></div>`).join('')
        : `<div>${tee(hex, `${p.name} in ${sel.colour}`)}</div>`;
      openSheet(`
        <div class="gallery${(p.images || []).length > 1 ? '' : ' single'}">${art}</div>
        <h2 id="sheetTitle">${esc(p.name)}</h2>
        <div class="muted small">${esc(p.type)}${p.category ? ` · ${esc(p.category)}` : ''}</div>
        <div class="price-row"><span class="price-big">${esc(inr(p.price))}</span>
          ${p.mrp > p.price ? `<span class="mrp">${esc(inr(p.mrp))}</span><span class="off">${p.discount_pct}% off</span>` : ''}</div>
        ${p.mrp > p.price ? `<div class="save-line">You save ${esc(inr(p.mrp - p.price))}</div>` : ''}

        <h3>Colour: <span class="muted">${esc(sel.colour || '')}</span></h3>
        <div class="swatches">${colours.map(([name, h]) => `<button class="swatch" data-colour="${esc(name)}" aria-pressed="${name === sel.colour}"><i style="background:${esc(h)}"></i>${esc(name)}</button>`).join('')}</div>

        <h3>Size</h3>
        <div class="sizes" id="sizes">${sizes.map((v) => `
          <button class="size" data-size="${esc(v.size)}" aria-pressed="${v.size === sel.size}" ${v.stock <= 0 ? 'disabled aria-label="' + esc(v.size) + ' sold out"' : ''}>
            ${esc(v.size)}${v.stock > 0 && v.stock <= 3 ? `<small>${v.stock} left</small>` : ''}</button>`).join('')}</div>
        <details class="guide"><summary>Size guide</summary>${guideTable()}</details>

        ${p.description ? `<h3>About this tee</h3><p class="muted" style="white-space:pre-line;margin:0">${esc(p.description)}</p>` : ''}
        <div class="facts">
          ${p.fabric ? `<span class="fact">${esc(p.fabric)}</span>` : ''}
          ${p.gsm ? `<span class="fact">${esc(p.gsm)} GSM</span>` : ''}
          ${state.settings.return_window_days ? `<span class="fact">${state.settings.return_window_days}-day size exchange</span>` : ''}
          ${state.settings.cod_enabled ? '<span class="fact">COD available</span>' : ''}
        </div>
        <p style="margin-top:16px"><button class="link" id="shareBtn">Share this tee</button></p>

        <div class="sticky-cta">
          <button class="btn btn-outline" id="addBag" ${p.total_stock <= 0 ? 'disabled' : ''}>Add to bag</button>
          <button class="btn btn-lime" id="buyNow" ${p.total_stock <= 0 ? 'disabled' : ''}>${p.total_stock <= 0 ? 'Sold out' : chosen ? `Buy now · ${esc(inr(p.price))}` : 'Buy now'}</button>
        </div>`, p.name);

      const body = $('sheetBody');
      body.querySelectorAll('[data-colour]').forEach((b) => { b.onclick = () => { sel.colour = b.dataset.colour; sel.size = null; draw(); }; });
      body.querySelectorAll('[data-size]').forEach((b) => { b.onclick = () => { sel.size = b.dataset.size; draw(); }; });
      const add = (go) => {
        const v = sizes.find((x) => x.size === sel.size);
        if (!v) {
          const el = $('sizes');
          el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          toast('Pick your size first');
          return;
        }
        const inBag = state.bag.find((b) => b.variant_id === v.id);
        if ((inBag ? inBag.qty : 0) + 1 > v.stock) { toast(`Only ${v.stock} left in ${v.size}`, true); return; }
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

  // ------------------------------------------------------------ bag
  function saveBag() {
    state.bag = state.bag.filter((b) => b.qty > 0);
    store.set('zs_bag', state.bag);
    updateBagCount();
  }
  function updateBagCount() { $('bagCount').textContent = state.bag.reduce((s, b) => s + b.qty, 0); }

  function bagTotals() {
    let mrp = 0, sub = 0;
    const lines = state.bag.map((b) => {
      const hit = variantOf(b.variant_id);
      if (!hit) return { ...b, missing: true };
      mrp += hit.p.mrp * b.qty; sub += hit.p.price * b.qty;
      return { ...b, p: hit.p, v: hit.v };
    });
    const s = state.settings;
    const ship = s.free_shipping_above > 0 && sub >= s.free_shipping_above ? 0 : (s.shipping_fee || 0);
    return { lines, mrp, sub, ship: sub ? ship : 0, total: sub ? sub + ship : 0 };
  }

  function openBag() {
    const t = bagTotals();
    if (!state.bag.length) {
      openSheet(`<h2>Your bag</h2><div class="empty" style="padding:30px 0"><b>Nothing here yet</b>Find a fit you like.</div>
        <button class="btn btn-lime full" id="goShop">Shop tees</button>`, 'Bag');
      $('goShop').onclick = closeSheet;
      return;
    }
    const s = state.settings;
    const left = s.free_shipping_above - t.sub;
    openSheet(`
      <h2>Your bag</h2>
      ${t.lines.map((l, i) => l.missing ? `<div class="line"><div></div><div class="muted">An item is no longer available</div><button class="link" data-rm="${i}">Remove</button></div>` : `
        <div class="line">
          <div class="line-img">${productArt(l.p, l.v.hex)}</div>
          <div>
            <div class="line-name">${esc(l.p.name)}</div>
            <div class="muted small">${esc(l.v.colour)} / ${esc(l.v.size)}${l.v.stock < l.qty ? ` · <span style="color:var(--pink)">only ${l.v.stock} left</span>` : ''}</div>
            <div class="stepper"><button data-dec="${i}" aria-label="One less">−</button><span>${l.qty}</span><button data-inc="${i}" aria-label="One more">+</button></div>
          </div>
          <div class="line-price">${esc(inr(l.p.price * l.qty))}</div>
        </div>`).join('')}
      ${s.free_shipping_above > 0 ? `<div class="ship-meter">${left > 0 ? `Add <b>${esc(inr(left))}</b> more for free delivery` : '<b style="color:var(--lime)">Free delivery unlocked</b>'}
        <div class="meter"><span style="width:${Math.min(100, (t.sub / s.free_shipping_above) * 100)}%"></span></div></div>` : ''}
      <div class="sum">
        <div><span class="muted">Items</span><span>${esc(inr(t.mrp))}</span></div>
        ${t.mrp > t.sub ? `<div class="save"><span>Discount</span><span>− ${esc(inr(t.mrp - t.sub))}</span></div>` : ''}
        <div><span class="muted">Delivery</span><span>${t.ship ? esc(inr(t.ship)) : 'Free'}</span></div>
        <div class="total"><span>Total</span><span>${esc(inr(t.total))}</span></div>
      </div>
      <button class="btn btn-lime full" id="toCheckout">Checkout · ${esc(inr(t.total))}</button>`, 'Bag');

    const body = $('sheetBody');
    body.querySelectorAll('[data-inc]').forEach((b) => {
      b.onclick = () => {
        const l = t.lines[Number(b.dataset.inc)];
        if (l.qty + 1 > l.v.stock) return toast(`Only ${l.v.stock} left`, true);
        state.bag[Number(b.dataset.inc)].qty += 1; saveBag(); openBag();
      };
    });
    body.querySelectorAll('[data-dec]').forEach((b) => { b.onclick = () => { state.bag[Number(b.dataset.dec)].qty -= 1; saveBag(); openBag(); }; });
    body.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = () => { state.bag.splice(Number(b.dataset.rm), 1); saveBag(); openBag(); }; });
    $('toCheckout').onclick = openCheckout;
  }
  $('btnBag').onclick = openBag;

  // ------------------------------------------------------------ checkout
  function openCheckout() {
    const t = bagTotals();
    if (!t.sub) return openBag();
    const c = store.get('zs_customer', {});
    const a = c.address || {};
    const cod = !!state.settings.cod_enabled;
    openSheet(`
      <h2>Checkout</h2>
      <p class="muted small" style="margin:0">${t.lines.reduce((s, l) => s + (l.qty || 0), 0)} item(s) · ${esc(inr(t.total))}</p>
      <form id="coForm" novalidate>
        <label for="coPhone">Mobile number</label>
        <input id="coPhone" inputmode="numeric" autocomplete="tel-national" maxlength="14" required value="${esc(c.phone || '')}" placeholder="10-digit mobile">
        <div class="hint">Used to track your order. No spam.</div>
        <label for="coName">Full name</label>
        <input id="coName" autocomplete="name" required value="${esc(c.name || '')}">
        <label for="coEmail">E-mail (optional)</label>
        <input id="coEmail" type="email" autocomplete="email" value="${esc(c.email || '')}">
        <label for="coPin">Pincode</label>
        <input id="coPin" inputmode="numeric" autocomplete="postal-code" maxlength="6" required value="${esc(a.pincode || '')}">
        <div class="hint" id="pinHint">City and state fill in automatically.</div>
        <label for="coLine1">House / flat, street, area</label>
        <input id="coLine1" autocomplete="address-line1" required value="${esc(a.line1 || '')}">
        <label for="coLine2">Landmark (optional)</label>
        <input id="coLine2" autocomplete="address-line2" value="${esc(a.line2 || '')}">
        <div class="row2">
          <div><label for="coCity">City</label><input id="coCity" autocomplete="address-level2" required value="${esc(a.city || '')}"></div>
          <div><label for="coState">State</label><input id="coState" autocomplete="address-level1" required value="${esc(a.state || '')}"></div>
        </div>
        <h3>Payment</h3>
        <div class="pay-opts">
          <label class="pay"><input type="radio" name="pay" value="online" checked><span><b>Pay online</b><span class="muted small">UPI, cards, netbanking</span></span></label>
          ${cod ? `<label class="pay"><input type="radio" name="pay" value="cod"><span><b>Cash on delivery</b><span class="muted small">Pay when it arrives</span></span></label>` : ''}
        </div>
        <div class="err" id="coErr" role="alert"></div>
        <button class="btn btn-lime full" id="coSubmit" type="submit">Place order · ${esc(inr(t.total))}</button>
      </form>`, 'Checkout');

    const pin = $('coPin');
    const lookup = async () => {
      const v = pin.value.replace(/\D/g, '');
      if (v.length !== 6) return;
      $('pinHint').textContent = 'Finding your area…';
      try {
        const r = await fetch(`https://api.postalpincode.in/pincode/${v}`);
        const d = await r.json();
        const po = d && d[0] && d[0].PostOffice && d[0].PostOffice[0];
        if (po) {
          if (!$('coCity').value) $('coCity').value = po.District;
          if (!$('coState').value) $('coState').value = po.State;
          $('pinHint').textContent = `${po.District}, ${po.State}`;
        } else $('pinHint').textContent = 'Pincode not found. Please check it or fill city/state yourself.';
      } catch (_) { $('pinHint').textContent = 'Fill in city and state.'; }
    };
    pin.addEventListener('input', () => { if (pin.value.replace(/\D/g, '').length === 6) { $('coCity').value = ''; $('coState').value = ''; lookup(); } });

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
      store.set('zs_customer', customer);

      const method = document.querySelector('input[name="pay"]:checked').value;
      const btn = $('coSubmit');
      btn.disabled = true; btn.textContent = 'Placing order…';
      const { data, error } = await sb.rpc('place_web_order', {
        p_customer: customer,
        p_items: state.bag.map((b) => ({ variant_id: b.variant_id, qty: b.qty })),
        p_method: method,
      });
      if (error) {
        err.textContent = errText(error);
        btn.disabled = false; btn.textContent = 'Place order';
        load().catch(() => {});
        return;
      }
      store.set('zs_last_order', { order_no: data.order_no, phone });
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
    openSheet(`
      <div class="done">
        <div class="big">Order placed!</div>
        <p class="muted">${method === 'cod' ? `Keep ${esc(inr(total))} ready when it arrives.` : `Paid ${esc(inr(total))}. Your fit is on its way.`}</p>
        <div class="order-no">${esc(orderNo)}</div>
        <p class="muted small">Save this number. You can track your order any time with it and your mobile number.</p>
      </div>
      <button class="btn btn-lime full" id="sTrack">Track order</button>
      <button class="btn btn-outline full" id="sShop">Keep shopping</button>`, 'Order placed');
    $('sTrack').onclick = () => openTrack({ order_no: orderNo, phone: last.phone });
    $('sShop').onclick = () => { closeSheet(); load().catch(() => {}); };
  }

  // ------------------------------------------------------------ tracking + exchanges
  const STEPS = [['placed', 'Order placed'], ['confirmed', 'Confirmed'], ['packed', 'Packed'], ['shipped', 'Shipped'], ['delivered', 'Delivered']];
  const dateOf = (d) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

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
      </form>`, 'Track order');
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
    const canAsk = o.status === 'delivered' && o.delivered_at &&
      (Date.now() - new Date(o.delivered_at)) / 864e5 <= days &&
      !(o.requests || []).some((r) => ['open', 'approved'].includes(r.status));
    const waiting = o.payment_method === 'online' && o.payment_status === 'pending' && o.status !== 'cancelled';

    openSheet(`
      <h2>${esc(o.order_no)}</h2>
      <div class="muted small">Placed ${esc(dateOf(o.created_at))} · ${esc(inr(o.total))} · ${o.payment_method === 'cod' ? 'Cash on delivery' : 'Paid online'}${o.payment_status === 'refunded' ? ' · refunded' : ''}</div>
      ${waiting ? `<div class="box" style="border-color:var(--pink)">Payment not completed yet. Unpaid orders are released after 30 minutes.</div>` : ''}
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
        <p class="muted small">Open for ${days} days after delivery.</p>` : ''}
      ${cfg.STORE_WHATSAPP ? `<a class="btn btn-outline full" style="text-decoration:none" target="_blank" rel="noopener"
         href="https://wa.me/${esc(cfg.STORE_WHATSAPP)}?text=${encodeURIComponent(`Hi Z-SHIRTS, about my order ${o.order_no}`)}">Chat about this order</a>` : ''}`, 'Order');
    if (canAsk) {
      $('askEx').onclick = () => openService(o, phone, 'replacement');
      $('askRet').onclick = () => openService(o, phone, 'return');
    }
  }

  function openService(o, phone, kind) {
    const items = o.items || [];
    const optionsFor = (item) => {
      const p = byId(item.product_id);
      if (!p) return [];
      return p.variants.filter((v) => v.id !== item.variant_id && v.stock > 0);
    };
    openSheet(`
      <h2>${kind === 'replacement' ? 'Exchange a size or colour' : 'Return an item'}</h2>
      <form id="svForm">
        <label for="svItem">Which item?</label>
        <select id="svItem">${items.map((i, n) => `<option value="${n}">${esc(i.name)} · ${esc(i.variant)}</option>`).join('')}</select>
        ${kind === 'replacement' ? `<label for="svNew">Exchange it for</label><select id="svNew"></select>
          <div class="hint">Only sizes and colours in stock are shown.</div>` : ''}
        <label for="svReason">What went wrong?</label>
        <textarea id="svReason" required placeholder="${kind === 'replacement' ? 'e.g. M is too tight on the shoulders' : 'e.g. Colour looks different from the photo'}"></textarea>
        <div class="err" id="svErr" role="alert"></div>
        <button class="btn btn-lime full" type="submit">Send request</button>
      </form>`, 'Request');
    const fill = () => {
      if (kind !== 'replacement') return;
      const opts = optionsFor(items[Number($('svItem').value)]);
      $('svNew').innerHTML = opts.length
        ? opts.map((v) => `<option value="${v.id}">${esc(v.colour)} / ${esc(v.size)}</option>`).join('')
        : '<option value="">No other size in stock right now</option>';
    };
    fill();
    $('svItem').onchange = fill;
    $('svForm').onsubmit = async (e) => {
      e.preventDefault();
      const item = items[Number($('svItem').value)];
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

  // ------------------------------------------------------------ deep links (?p=slug, ?track=ZS1001)
  function deepLink() {
    const q = new URLSearchParams(location.search);
    if (q.get('p')) {
      const p = state.products.find((x) => x.slug === q.get('p'));
      if (p) openProduct(p.id);
    } else if (q.get('track')) {
      openTrack({ order_no: q.get('track'), phone: '' });
    }
  }
  $('sheetClose').addEventListener('click', () => { try { history.replaceState(null, '', location.pathname); } catch (_) { /* */ } });

  load().catch((e) => {
    $('grid').innerHTML = `<div class="empty"><b>Couldn't load the shop</b>${esc(errText(e))}<br><br><button class="btn btn-outline" onclick="location.reload()" style="max-width:200px">Try again</button></div>`;
  });
})();
