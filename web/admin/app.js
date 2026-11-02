/* Z-SHIRTS Team app · orders, selling, stock, returns, live alerts, approvals and books.
 * Every rule (approvals, stock, refunds, locks) is enforced in the database; this file only shows screens.
 */
(() => {
  'use strict';
  const cfg = window.ZS_CONFIG || {};
  const $app = document.getElementById('app');
  const C = window.ZSCelebrate || { confetti() {}, chime() {}, moment() {} };

  // ================================================================ helpers
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
  const inr = (v) => {
    const n = num(v);
    if (n === null || Number.isNaN(n)) return '—';
    const d = Number.isInteger(Math.round(n * 100) / 100) ? 0 : 2;
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
  };
  const signed = (v) => { const n = num(v) || 0; return `<span class="amt ${n < 0 ? 'neg' : n > 0 ? 'pos' : ''}">${n > 0 ? '+' : ''}${esc(inr(n))}</span>`; };
  const pct = (x) => (x === null || x === undefined ? '—' : `${(Number(x) * 100).toFixed(1).replace(/\.0$/, '')}%`);
  const when = (s) => new Date(s).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const day = (s) => new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const monthName = (s) => new Date(`${s}T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const ago = (s) => {
    const m = Math.round((Date.now() - new Date(s)) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} h ago`;
    return day(s);
  };
  const todayKey = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* private mode */ } },
  };
  const NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const Plug = (window.Capacitor && window.Capacitor.Plugins) || {};
  // Links to WhatsApp, phone, the shop: open in the right app (Android hands them to the system)
  const openExternal = (url) => { if (NATIVE) location.href = url; else window.open(url, '_blank'); };
  if (NATIVE) {
    document.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      const href = a.getAttribute('href');
      if (/^(https?:|tel:|mailto:)/i.test(href)) { e.preventDefault(); openExternal(href); }
    });
  }
  const shopUrl = () => cfg.SHOP_URL || location.href.replace(/admin\/.*$/, '').split('?')[0];
  const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'];
  const sizeSort = (a, b) => (SIZE_ORDER.indexOf(a) + 99) % 99 - (SIZE_ORDER.indexOf(b) + 99) % 99 || String(a).localeCompare(String(b));

  const TYPE = {
    expense: 'Expense', income: 'Income', capital_in: 'Capital in', partner_payout: 'Partner payout', reversal: 'Reversal',
    setting_change: 'Change setting', share_rule: 'Profit / loss split', price_change: 'Price change', stock_writeoff: 'Damaged stock',
  };
  const KIND = { capital_in: 'Capital in', partner_payout: 'Partner payout', expense: 'Expense', income: 'Income', sale: 'Sale', refund: 'Refund' };
  const RULE = { investment: 'By investment ratio', equal: 'Equally (25% each)', custom: 'Custom %' };
  const CHANNEL = { website: 'Website', instagram: 'Instagram', whatsapp: 'WhatsApp', store: 'Store' };
  const STATUS = { placed: 'New', confirmed: 'Confirmed', packed: 'Packed', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled', rto: 'RTO', returned: 'Returned' };
  const NEXT = { placed: ['confirmed', 'Confirm'], confirmed: ['packed', 'Mark packed'], packed: ['shipped', 'Ship'], shipped: ['delivered', 'Mark delivered'] };
  const SETTING_LABEL = {
    employee_petty_limit: 'Spend without approval', all_partner_limit: 'All-partner approval above', shipping_fee: 'Delivery charge',
    free_shipping_above: 'Free delivery above', cod_enabled: 'Cash on delivery (1 on / 0 off)', max_store_discount_pct: 'Max discount on manual orders (%)',
    low_stock_alert: 'Low-stock alert at (pieces)', return_window_days: 'Exchange / return window (days)',
  };
  const MONEY_SETTINGS = ['employee_petty_limit', 'all_partner_limit', 'shipping_fee', 'free_shipping_above'];
  const ICON = {
    home: '<svg viewBox="0 0 24 24"><path d="M3 11 12 4l9 7v9h-6v-6H9v6H3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    orders: '<svg viewBox="0 0 24 24"><path d="M5 4h14v16l-3-2-2 2-2-2-2 2-2-2-3 2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 9h6M9 13h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    sell: '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
    stock: '<svg viewBox="0 0 24 24"><path d="M8 4 4 6l1.5 4L8 9v11h8V9l2.5 1L20 6l-4-2a4 4 0 0 1-8 0z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="19" cy="12" r="2" fill="currentColor"/></svg>',
    bell: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  };

  let toastTimer;
  function toast(msg, isErr = false) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = `show${isErr ? ' err' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = ''; }, isErr ? 6000 : 2800);
  }
  const errText = (e) => (e && (e.message || e.error_description)) || String(e);

  // Small form dialog
  function ask({ title, html = '', fields = [], ok = 'Confirm', okClass = '' }) {
    return new Promise((resolve) => {
      const dlg = document.createElement('dialog');
      dlg.innerHTML = `
        <form method="dialog">
          <h2 style="margin-top:0">${esc(title)}</h2>
          ${html}
          ${fields.map((f) => `
            <label for="f_${f.name}">${esc(f.label)}</label>
            ${f.type === 'textarea'
              ? `<textarea id="f_${f.name}" name="${f.name}" ${f.required ? 'required' : ''} placeholder="${esc(f.placeholder || '')}">${esc(f.value || '')}</textarea>`
              : f.type === 'select'
                ? `<select id="f_${f.name}" name="${f.name}">${f.options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(f.value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`
                : `<input id="f_${f.name}" name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" ${f.type === 'number' ? 'step="any" inputmode="decimal"' : ''} ${f.required ? 'required' : ''} placeholder="${esc(f.placeholder || '')}">`}
            ${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}`).join('')}
          <div class="actions">
            <button type="button" class="btn ghost" value="cancel">Cancel</button>
            <button type="submit" class="btn ${okClass}" value="ok">${esc(ok)}</button>
          </div>
        </form>`;
      document.body.appendChild(dlg);
      const form = dlg.querySelector('form');
      let done = false;
      dlg.querySelector('[value=cancel]').onclick = () => dlg.close();
      form.onsubmit = (e) => { e.preventDefault(); done = true; resolve(Object.fromEntries(new FormData(form).entries())); dlg.close(); };
      dlg.addEventListener('close', () => { dlg.remove(); if (!done) resolve(null); });
      dlg.showModal();
      const first = dlg.querySelector('input, textarea, select');
      if (first) first.focus();
    });
  }

  // Full-height detail panel
  let panelEl = null;
  function panel(html) {
    closePanel();
    const scrim = document.createElement('div');
    scrim.className = 'panel-scrim';
    const p = document.createElement('section');
    p.className = 'panel';
    p.setAttribute('role', 'dialog');
    p.setAttribute('aria-modal', 'true');
    p.innerHTML = `<button class="panel-close" aria-label="Close">✕</button><div class="panel-body">${html}</div>`;
    document.body.append(scrim, p);
    scrim.onclick = closePanel;
    p.querySelector('.panel-close').onclick = closePanel;
    p.querySelector('.panel-close').focus();
    panelEl = { scrim, p };
    document.body.style.overflow = 'hidden';
    return p.querySelector('.panel-body');
  }
  function closePanel() {
    if (!panelEl) return;
    panelEl.scrim.remove(); panelEl.p.remove(); panelEl = null;
    document.body.style.overflow = '';
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel(); });

  // ================================================================ setup
  if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes('YOUR-PROJECT')) {
    $app.innerHTML = `<div class="login"><div class="logo">Z<b>-</b>SHIRTS</div>
      <div class="card warnbox" style="margin-top:24px"><b>Almost there.</b><p class="muted">Open <code>web/config.js</code> and paste your Supabase project URL and anon key. The README explains where to find them.</p></div></div>`;
    return;
  }
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const state = {
    session: null, me: null, members: [], settings: {}, tab: 'home', view: null,
    orderFilter: null, orderChannel: 'all', orderSearch: '', approvalsFilter: 'mine', booksFilter: 'all', serviceFilter: 'open',
    stock: [], categories: [], notifs: [], lastSeen: 0, maxNotif: 0,
    sell: { channel: 'store', cart: [], discount: 0, method: 'cash', search: '', customer: {} },
  };
  const partners = () => state.members.filter((m) => m.role === 'partner' && m.active);
  const memberName = (id) => (state.members.find((m) => m.id === id) || {}).name || '—';
  const isPartner = () => state.me && state.me.role === 'partner';
  const variantLabel = (vid) => { const v = state.stock.find((s) => s.variant_id === Number(vid)); return v ? `${v.product_name} · ${v.colour} / ${v.size}` : `#${vid}`; };
  const productName = (pid) => { const v = state.stock.find((s) => s.product_id === Number(pid)); return v ? v.product_name : `#${pid}`; };

  async function q(promise) {
    const { data, error } = await promise;
    if (error) throw error;
    return data;
  }

  // ================================================================ auth
  function renderLogin(message = '') {
    $app.innerHTML = `
      <div class="login">
        <div class="logo">Z<b>-</b>SHIRTS</div>
        <p class="sub">Team app · orders, stock, approvals and books.</p>
        ${message ? `<div class="card">${esc(message)}</div>` : ''}
        <form id="loginForm" class="card">
          <label for="email">E-mail</label>
          <input id="email" type="email" autocomplete="email" required>
          <label for="password">Password</label>
          <input id="password" type="password" autocomplete="current-password" minlength="8" required>
          <button class="btn block" type="submit" id="signinBtn">Sign in</button>
          <p class="hint">Your login is created by Divyesh. Ask him for your e-mail and first password, then change the password from More → My password.</p>
        </form>
      </div>`;
    const email = () => document.getElementById('email').value.trim().toLowerCase();
    const password = () => document.getElementById('password').value;
    document.getElementById('loginForm').onsubmit = async (e) => {
      e.preventDefault();
      const btn = document.getElementById('signinBtn');
      btn.disabled = true; btn.textContent = 'Signing in…';
      const { error } = await sb.auth.signInWithPassword({ email: email(), password: password() });
      if (error) {
        btn.disabled = false; btn.textContent = 'Sign in';
        const m = errText(error);
        toast(/invalid login/i.test(m) ? 'Wrong e-mail or password. Check for typos, or ask Divyesh to reset your login.'
          : /not confirmed/i.test(m) ? 'This login is not activated yet. Ask Divyesh to create it again with "Auto confirm" ticked.'
          : m, true);
      }
    };
  }

  async function boot() {
    if (!state.session) return renderLogin();
    try {
      state.members = await q(sb.from('members').select('*').order('role').order('name'));
      state.me = state.members.find((m) => m.auth_user_id === state.session.user.id) || null;
      if (!state.me) {
        $app.innerHTML = `<div class="login"><div class="logo">Z<b>-</b>SHIRTS</div>
          <div class="card warnbox" style="margin-top:24px"><b>No access yet.</b>
          <p class="muted">${esc(state.session.user.email)} is not registered on the team. Ask a partner to add this e-mail, then sign in again.</p>
          <button class="btn ghost" id="out">Sign out</button></div></div>`;
        document.getElementById('out').onclick = () => sb.auth.signOut();
        return;
      }
      state.lastSeen = store.get(`zs_seen_${state.me.id}`, 0);
      await Promise.all([loadSettings(), loadStock(), loadNotifs(true)]);
      render();
      startLive();
    } catch (e) {
      $app.innerHTML = `<div class="login"><div class="card warnbox">Could not load: ${esc(errText(e))}</div></div>`;
    }
  }
  async function loadSettings() {
    const rows = await q(sb.from('settings').select('*'));
    state.settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }
  async function loadStock() {
    const [stock, cats] = await Promise.all([
      q(sb.from('stock_board').select('*')),
      q(sb.from('categories').select('*').order('sort')),
    ]);
    state.stock = stock;
    state.categories = cats;
  }

  // ================================================================ live alerts + celebrations
  async function loadNotifs(first = false) {
    const rows = await q(sb.from('notifications').select('*').order('id', { ascending: false }).limit(60));
    const fresh = rows.filter((n) => n.id > state.maxNotif);
    state.notifs = rows;
    if (!first && state.maxNotif) fresh.reverse().forEach(react);
    if (rows.length) state.maxNotif = Math.max(state.maxNotif, rows[0].id);
    updateBell();
  }
  function react(n) {
    if (n.celebrate) {
      C.moment({
        title: n.title, sub: n.body || '', amount: n.amount ? inr(n.amount) : '',
        big: n.kind === 'milestone', kind: n.kind,
      });
    } else {
      C.chime('order');
      toast(n.title);
    }
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification(n.title, { body: [n.amount ? inr(n.amount) : '', n.body].filter(Boolean).join(' · '), icon: 'icon.svg', tag: `zs-${n.id}` }); } catch (_) { /* */ }
    }
    if (['order', 'status', 'service', 'payment'].includes(n.kind) && ['home', 'orders'].includes(state.tab) && !panelEl) render();
  }
  function startLive() {
    try {
      sb.channel('zs-notifications')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, (payload) => {
          const n = payload.new;
          if (!n || n.id <= state.maxNotif) return;
          if (n.audience === 'partners' && !isPartner()) return;
          state.maxNotif = n.id;
          state.notifs.unshift(n);
          updateBell();
          react(n);
        })
        .subscribe();
    } catch (_) { /* polling below still works */ }
    setInterval(() => { if (!document.hidden) loadNotifs().catch(() => {}); }, 20000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) loadNotifs().catch(() => {}); });
  }
  function updateBell() {
    const n = state.notifs.filter((x) => x.id > state.lastSeen).length;
    const b = document.getElementById('bellBadge');
    if (b) { b.textContent = n > 9 ? '9+' : n; b.hidden = n === 0; }
  }
  function openNotifs() {
    const ICONS = { order: '₹', payment: '₹', milestone: '★', status: '➜', service: '↺', stock: '!', approval: '✓' };
    const seen = state.lastSeen;
    const body = panel(`
      <h1>Alerts</h1>
      <p class="sub">New orders, payments, returns, low stock${isPartner() ? ' and approvals' : ''}.</p>
      ${'Notification' in window && Notification.permission !== 'granted' ? `<button class="btn cyan block" id="allowN" style="margin:0 0 12px">Turn on phone alerts</button>
        <p class="hint" style="margin-top:-4px">Alerts pop up while this app is open on your phone or laptop.</p>` : ''}
      ${state.notifs.length ? state.notifs.map((n) => `
        <div class="notif ${n.kind}${n.id > seen ? ' unread' : ''}" ${n.order_id ? `data-order="${n.order_id}" style="cursor:pointer"` : ''}>
          <div class="ic">${ICONS[n.kind] || '•'}</div>
          <div style="flex:1;min-width:0"><b>${esc(n.title)}</b>
            <div class="muted">${n.amount ? `${esc(inr(n.amount))} · ` : ''}${esc(n.body || '')}</div>
            <div class="muted" style="font-size:12px">${esc(ago(n.at))}</div></div>
        </div>`).join('') : '<div class="empty">No alerts yet. The first order will show up here.</div>'}`);
    state.lastSeen = state.maxNotif;
    store.set(`zs_seen_${state.me.id}`, state.lastSeen);
    updateBell();
    const allow = body.querySelector('#allowN');
    if (allow) allow.onclick = async () => { const r = await Notification.requestPermission(); toast(r === 'granted' ? 'Phone alerts on' : 'Alerts were blocked in browser settings', r !== 'granted'); openNotifs(); };
    body.querySelectorAll('[data-order]').forEach((el) => { el.onclick = () => openOrder(Number(el.dataset.order)); });
  }

  // ================================================================ shell
  const TABS = [['home', 'Home'], ['orders', 'Orders'], ['sell', 'Sell'], ['stock', 'Stock'], ['more', 'More']];

  function render() {
    $app.innerHTML = `
      <div class="shell">
        <header class="top">
          <div class="brand">Z<b>-</b>SHIRTS<small>Team</small></div>
          <div class="top-right">
            <button class="bell" id="bell" aria-label="Alerts">${ICON.bell}<span class="badge" id="bellBadge" hidden></span></button>
            <button class="me-chip" id="me" title="Sign out">${esc(state.me.name.split(' ')[0])}</button>
          </div>
        </header>
        <main id="view"><div class="empty">Loading…</div></main>
      </div>
      <nav class="tabs">${TABS.map(([k, label]) => `
        <button data-tab="${k}" class="${k === 'sell' ? 'sell ' : ''}${state.tab === k ? 'on' : ''}" aria-label="${label}">
          <span class="ico">${ICON[k]}</span>${label}${k === 'orders' || k === 'more' ? `<span class="badge" id="badge-${k}" hidden></span>` : ''}</button>`).join('')}
      </nav>`;
    document.getElementById('bell').onclick = openNotifs;
    document.getElementById('me').onclick = async () => {
      const ok = await ask({ title: 'Sign out?', html: `<p class="muted">Signed in as ${esc(state.me.name)} (${esc(state.me.role)}).</p>`, ok: 'Sign out', okClass: 'bad' });
      if (ok) sb.auth.signOut();
    };
    document.querySelectorAll('nav.tabs button').forEach((b) => {
      b.onclick = () => { state.tab = b.dataset.tab; state.view = null; render(); window.scrollTo(0, 0); };
    });
    updateBell();
    const view = document.getElementById('view');
    const fn = state.tab === 'more' && state.view ? VIEWS[state.view] : VIEWS[state.tab];
    (fn || VIEWS.home)(view).catch((e) => { view.innerHTML = `<div class="card warnbox">Something went wrong: ${esc(errText(e))}</div>`; });
    updateBadges();
  }
  function go(tab, view = null) { state.tab = tab; state.view = view; closePanel(); render(); window.scrollTo(0, 0); }

  async function updateBadges() {
    try {
      const [orders, svc, reqs] = await Promise.all([
        q(sb.from('orders').select('id,status,payment_method,payment_status').in('status', ['placed', 'confirmed', 'packed'])),
        q(sb.from('service_requests').select('id').in('status', ['open', 'approved'])),
        isPartner() ? q(sb.from('request_board').select('id,voters').eq('status', 'pending')) : Promise.resolve([]),
      ]);
      const act = orders.filter((o) => !(o.payment_method === 'online' && o.payment_status === 'pending')).length;
      const myApprovals = reqs.filter((r) => !(r.voters || []).some((v) => v.member_id === state.me.id)).length;
      const set = (id, n) => { const b = document.getElementById(id); if (b) { b.textContent = n; b.hidden = !n; } };
      set('badge-orders', act);
      set('badge-more', svc.length + myApprovals);
      state.counts = { act, svc: svc.length, approvals: myApprovals };
    } catch (_) { /* badges are optional */ }
  }

  // ================================================================ HOME
  const VIEWS = {};
  const MILESTONES = [10000, 25000, 50000, 100000, 250000, 500000, 1000000, 2500000, 5000000, 10000000];

  VIEWS.home = async (view) => {
    const since = new Date(Date.now() - 13 * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const [daily, active, svc, summary, reqs] = await Promise.all([
      q(sb.from('sales_daily').select('*').gte('day', since)),
      q(sb.from('orders').select('id,status,payment_method,payment_status').in('status', ['placed', 'confirmed', 'packed'])),
      q(sb.from('service_requests').select('id,status').in('status', ['open', 'approved'])),
      isPartner() ? q(sb.from('business_summary').select('*').single()) : Promise.resolve(null),
      isPartner() ? q(sb.from('request_board').select('id,voters').eq('status', 'pending')) : Promise.resolve([]),
    ]);
    const t = daily.find((d) => d.day === todayKey()) || { orders: 0, value: 0, pieces: 0 };
    const ready = active.filter((o) => !(o.payment_method === 'online' && o.payment_status === 'pending'));
    const count = (s) => ready.filter((o) => o.status === s).length;
    const lim = num(state.settings.low_stock_alert) || 5;
    const low = state.stock.filter((s) => s.active && s.published && s.stock <= lim);
    const myApprovals = reqs.filter((r) => !(r.voters || []).some((v) => v.member_id === state.me.id)).length;
    const hour = Number(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }));
    const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

    const actions = [
      [count('placed'), 'lime', 'to confirm', 'New orders waiting', () => go('orders', null, (state.orderFilter = 'placed'))],
      [count('confirmed'), 'lime', 'to pack', 'Confirmed, not packed yet', () => go('orders', null, (state.orderFilter = 'confirmed'))],
      [count('packed'), 'cyan', 'to ship', 'Packed, hand to courier', () => go('orders', null, (state.orderFilter = 'packed'))],
      [svc.length, 'pink', 'exchange / return requests', 'Customers waiting for a reply', () => go('more', 'returns')],
      [myApprovals, 'pink', 'approvals need you', 'Nothing moves until partners approve', () => go('more', 'approvals')],
      [low.length, 'pink', 'sizes running low', `At or below ${lim} pieces`, () => go('stock')],
    ].filter((a) => a[0] > 0);

    // 14-day bars
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const k = new Date(Date.now() - i * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      const d = daily.find((x) => x.day === k);
      days.push({ k, v: d ? Number(d.value) : 0 });
    }
    const max = Math.max(1, ...days.map((d) => d.v));
    const total14 = days.reduce((s, d) => s + d.v, 0);

    let milestone = '';
    if (summary) {
      const sales = Number(summary.total_sales) || 0;
      const next = MILESTONES.find((m) => m > sales);
      const prev = [...MILESTONES].reverse().find((m) => m <= sales) || 0;
      if (next) {
        milestone = `<div class="card milestone"><div class="row"><b>Next milestone: ${esc(inr(next))} in sales</b><span class="amt pos">${esc(inr(next - sales))} to go</span></div>
          <div class="meter"><span style="width:${Math.min(100, ((sales - prev) / (next - prev)) * 100)}%"></span></div>
          <div class="muted" style="margin-top:6px">Total sales so far ${esc(inr(sales))}</div></div>`;
      }
    }

    view.innerHTML = `
      <h1>${hello}, ${esc(state.me.name.split(' ')[0])}</h1>
      <p class="sub">${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' })}</p>
      <div class="today">
        <div class="stat"><div class="k">Sold today</div><div class="v">${esc(inr(t.value))}</div></div>
        <div class="stat"><div class="k">Orders</div><div class="v">${t.orders}</div></div>
        <div class="stat"><div class="k">Pieces</div><div class="v">${t.pieces}</div></div>
      </div>
      <h2>Do next</h2>
      ${actions.length ? `<div class="action-list">${actions.map(([n, c, t1, t2], i) => `
        <button class="action ${c}" data-a="${i}"><span class="n">${n}</span><span class="t"><b>${t1}</b><span>${t2}</span></span><span class="go">›</span></button>`).join('')}</div>`
        : `<div class="all-clear"><b>All clear</b>Nothing waiting. Go make some content.</div>`}
      <h2>Last 14 days</h2>
      <div class="card">
        <div class="row"><span class="muted">Sales</span><span class="amt">${esc(inr(total14))}</span></div>
        <div class="bars" aria-label="Daily sales for the last 14 days">${days.map((d, i) =>
          `<div class="${i === 13 ? 'today-bar' : d.v ? 'has' : ''}" style="height:${Math.max(4, (d.v / max) * 100)}%" title="${esc(day(d.k))}: ${esc(inr(d.v))}"></div>`).join('')}</div>
        <div class="bars-x"><span>${esc(new Date(days[0].k).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }))}</span><span>Today</span></div>
      </div>
      ${milestone}
      ${summary ? `
        <h2>Money</h2>
        <div class="grid">
          <div class="stat hero"><div class="k">Money in the business (as per books)</div><div class="v">${esc(inr(summary.cash_balance))}</div></div>
          <div class="stat"><div class="k">Sales</div><div class="v">${esc(inr(summary.total_sales))}</div></div>
          <div class="stat"><div class="k">Expenses</div><div class="v">${esc(inr(summary.total_expenses))}</div></div>
          <div class="stat" style="grid-column:1/-1"><div class="k">Profit / loss so far</div><div class="v">${signed(summary.business_result)}</div></div>
        </div>
        <button class="btn outline block" id="toPartners">See each partner's share</button>` : ''}`;
    view.querySelectorAll('[data-a]').forEach((b) => { b.onclick = actions[Number(b.dataset.a)][4]; });
    const tp = view.querySelector('#toPartners');
    if (tp) tp.onclick = () => go('more', 'partners');
  };

  // ================================================================ ORDERS
  const ORDER_TABS = [['placed', 'New'], ['confirmed', 'To pack'], ['packed', 'To ship'], ['shipped', 'Shipped'], ['delivered', 'Delivered'], ['rto', 'RTO'], ['returned', 'Returned'], ['cancelled', 'Cancelled'], ['awaiting', 'Awaiting payment'], ['all', 'All']];
  const awaiting = (o) => o.payment_method === 'online' && o.payment_status === 'pending' && o.status !== 'cancelled';
  const payPill = (o) => o.payment_status === 'paid' ? '<span class="pill paid">Paid</span>'
    : o.payment_status === 'refunded' ? '<span class="pill refunded">Refunded</span>'
    : o.payment_method === 'cod' ? '<span class="pill">COD</span>' : '<span class="pill placed">Awaiting payment</span>';

  VIEWS.orders = async (view) => {
    const rows = await q(sb.from('order_board').select('*').order('created_at', { ascending: false }).limit(400));
    const counts = Object.fromEntries(ORDER_TABS.map(([k]) => [k, 0]));
    rows.forEach((o) => { if (awaiting(o)) counts.awaiting++; else counts[o.status]++; counts.all++; });
    if (!state.orderFilter) state.orderFilter = ['placed', 'confirmed', 'packed', 'shipped'].find((k) => counts[k]) || 'all';
    const f = state.orderFilter;
    const s = state.orderSearch.trim().toLowerCase();
    const list = rows.filter((o) => {
      if (f === 'awaiting' ? !awaiting(o) : f !== 'all' && (o.status !== f || awaiting(o))) return false;
      if (state.orderChannel !== 'all' && o.channel !== state.orderChannel) return false;
      if (s && ![o.order_no, o.customer_name, o.customer_phone, o.tracking_no].join(' ').toLowerCase().includes(s)) return false;
      return true;
    });

    view.innerHTML = `
      <h1>Orders</h1>
      <input class="search-in" id="oSearch" type="search" placeholder="Search order no, name, phone, AWB" value="${esc(state.orderSearch)}">
      <div class="seg">${ORDER_TABS.filter(([k]) => counts[k] || ['placed', 'confirmed', 'packed', 'shipped', 'all'].includes(k)).map(([k, l]) =>
        `<button data-f="${k}" class="${f === k ? 'on' : ''}">${l}<span class="c">${counts[k]}</span></button>`).join('')}</div>
      <div class="seg">${[['all', 'All channels'], ['website', 'Website'], ['instagram', 'Instagram'], ['whatsapp', 'WhatsApp'], ['store', 'Store']].map(([k, l]) =>
        `<button data-c="${k}" class="${state.orderChannel === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${list.length ? list.map(orderCard).join('') : `<div class="empty">${f === 'placed' ? 'No new orders right now.' : 'Nothing here.'}</div>`}`;

    view.querySelector('#oSearch').oninput = (e) => {
      state.orderSearch = e.target.value;
      clearTimeout(view._t);
      view._t = setTimeout(() => VIEWS.orders(view).then(() => { const el = view.querySelector('#oSearch'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }), 250);
    };
    view.querySelectorAll('[data-f]').forEach((b) => { b.onclick = () => { state.orderFilter = b.dataset.f; VIEWS.orders(view); }; });
    view.querySelectorAll('[data-c]').forEach((b) => { b.onclick = () => { state.orderChannel = b.dataset.c; VIEWS.orders(view); }; });
    view.querySelectorAll('.order').forEach((c) => { c.onclick = (e) => { if (!e.target.closest('[data-next]')) openOrder(Number(c.dataset.id), rows); }; });
    view.querySelectorAll('[data-next]').forEach((b) => {
      b.onclick = async () => {
        const o = rows.find((x) => x.id === Number(b.dataset.next));
        if (await advance(o)) VIEWS.orders(view);
      };
    });
  };

  function orderCard(o) {
    const items = (o.items || []).map((i) => `${i.qty}× ${i.name} (${i.variant})`).join(', ');
    const nx = NEXT[o.status];
    return `
      <div class="card order" data-id="${o.id}">
        <div class="order-top">
          <span class="order-no">${esc(o.order_no)}</span>
          <span class="ch ${o.channel}">${esc(CHANNEL[o.channel])}</span>
          ${o.open_requests ? '<span class="pill open">Return / exchange</span>' : ''}
          <span class="ago">${esc(ago(o.created_at))}</span>
        </div>
        <div style="margin-top:8px;font-weight:600">${esc(o.customer_name)}${o.address && o.address.city ? ` <span class="muted">· ${esc(o.address.city)}</span>` : ''}</div>
        <div class="order-items">${esc(items)}</div>
        <div class="order-foot">
          <span><span class="amt">${esc(inr(o.total))}</span> ${payPill(o)} <span class="pill ${o.status}">${esc(STATUS[o.status])}</span></span>
          ${nx && !awaiting(o) ? `<button class="btn small ${nx[0] === 'shipped' ? 'cyan' : ''}" data-next="${o.id}">${nx[1]}</button>` : ''}
        </div>
      </div>`;
  }

  // Moves an order one step forward. Asks only what that step needs.
  async function advance(o) {
    const nx = NEXT[o.status];
    if (!nx) return false;
    let courier = null, tracking = null;
    if (nx[0] === 'shipped') {
      const last = store.get('zs_last_courier', '');
      const v = await ask({
        title: `Ship ${o.order_no}`,
        fields: [
          { name: 'courier', label: 'Courier', required: true, value: last, placeholder: 'Delhivery, Shiprocket, DTDC…' },
          { name: 'tracking', label: 'Tracking / AWB number', placeholder: 'Paste from the courier app' },
        ],
        ok: 'Mark shipped', okClass: 'cyan',
      });
      if (!v) return false;
      courier = v.courier; tracking = v.tracking;
      store.set('zs_last_courier', courier);
    }
    try {
      await q(sb.rpc('set_order_status', { p_order_id: o.id, p_status: nx[0], p_note: null, p_courier: courier, p_tracking: tracking }));
      if (nx[0] === 'delivered') { C.confetti(0.6); C.chime(); }
      toast(`${o.order_no} · ${STATUS[nx[0]]}`);
      updateBadges();
      return true;
    } catch (e) { toast(errText(e), true); return false; }
  }

  const waText = (o, status = o.status) => {
    const first = (o.customer_name || '').split(' ')[0];
    const link = `${shopUrl()}?track=${o.order_no}`;
    const m = {
      placed: `Hi ${first}! Thanks for ordering from Z-SHIRTS. Your order ${o.order_no} is received.`,
      confirmed: `Hi ${first}! Your Z-SHIRTS order ${o.order_no} is confirmed. We'll pack it soon.`,
      packed: `Hi ${first}! Your Z-SHIRTS order ${o.order_no} is packed and leaves today.`,
      shipped: `Hi ${first}! Your Z-SHIRTS order ${o.order_no} is on the way${o.courier ? ` with ${o.courier}` : ''}${o.tracking_no ? ` (AWB ${o.tracking_no})` : ''}. Track it here: ${link}`,
      delivered: `Hi ${first}! Your Z-SHIRTS order ${o.order_no} was delivered. Hope you love the fit! Size not right? Request an exchange within ${state.settings.return_window_days || 7} days: ${link}`,
    };
    return m[status] || `Hi ${first}, about your Z-SHIRTS order ${o.order_no}.`;
  };

  async function openOrder(id, rows) {
    let o = rows && rows.find((x) => x.id === id);
    if (!o) o = await q(sb.from('order_board').select('*').eq('id', id).single());
    const a = o.address || {};
    const addr = [a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).join(', ');
    const nx = NEXT[o.status];
    const canCancel = ['placed', 'confirmed', 'packed'].includes(o.status) && (o.payment_status !== 'paid' || isPartner());
    const body = panel(`
      <h1 style="margin-top:14px">${esc(o.order_no)}</h1>
      <div class="order-top"><span class="ch ${o.channel}">${esc(CHANNEL[o.channel])}</span><span class="pill ${o.status}">${esc(STATUS[o.status])}</span>${payPill(o)}</div>
      <p class="muted">Placed ${esc(when(o.created_at))}${o.created_by ? ` by ${esc(memberName(o.created_by))}` : ''}</p>

      <div class="card">
        <b>${esc(o.customer_name)}</b>
        ${o.customer_phone ? `<div class="muted">+91 ${esc(o.customer_phone)}</div>` : ''}
        ${addr ? `<div class="muted" style="margin-top:6px">${esc(addr)}</div>` : ''}
        <div class="actions">
          ${o.customer_phone ? `<a class="btn small outline" href="tel:+91${esc(o.customer_phone)}">Call</a>
            <a class="btn small good" target="_blank" rel="noopener" href="https://wa.me/91${esc(o.customer_phone)}?text=${encodeURIComponent(waText(o))}">WhatsApp update</a>` : ''}
          ${addr ? `<button class="btn small outline" id="copyAddr">Copy address</button>` : ''}
        </div>
      </div>

      <div class="card">
        ${(o.items || []).map((i) => `<div class="row"><span>${i.qty}× ${esc(i.name)} <span class="muted">· ${esc(i.variant)}</span></span><span class="amt">${esc(inr(i.price * i.qty))}</span></div>`).join('')}
        <div class="row" style="border-top:1px solid var(--line);margin-top:10px;padding-top:10px"><span class="muted">Items</span><span>${esc(inr(o.subtotal))}</span></div>
        ${Number(o.discount) ? `<div class="row"><span class="muted">Discount</span><span class="neg">− ${esc(inr(o.discount))}</span></div>` : ''}
        ${Number(o.shipping) ? `<div class="row"><span class="muted">Delivery</span><span>${esc(inr(o.shipping))}</span></div>` : ''}
        <div class="row"><b>Total</b><span class="amt">${esc(inr(o.total))}</span></div>
        <div class="muted" style="margin-top:6px">${o.payment_method === 'online' ? 'Paid online (Razorpay)' : o.payment_method === 'cod' ? 'Cash on delivery' : `Paid by ${esc(o.payment_method.toUpperCase())}`}</div>
      </div>

      ${o.courier ? `<div class="card"><div class="row"><span class="muted">Courier</span><b>${esc(o.courier)}</b></div>${o.tracking_no ? `<div class="row"><span class="muted">AWB</span><b>${esc(o.tracking_no)}</b></div>` : ''}</div>` : ''}
      ${o.note ? `<div class="card"><span class="muted">Note</span><div>${esc(o.note)}</div></div>` : ''}

      <h2>History</h2>
      <ol class="timeline">${(o.events || []).map((e) => `<li>${esc(STATUS[e.status] || e.status)}${e.note ? ` · ${esc(e.note)}` : ''}<small>${esc(when(e.at))}${e.by ? ` · ${esc(e.by)}` : ''}</small></li>`).join('')}</ol>

      <div class="actions">
        ${nx && !awaiting(o) ? `<button class="btn ${nx[0] === 'shipped' ? 'cyan' : ''}" id="oNext">${nx[1]}</button>` : ''}
        ${o.status === 'shipped' ? '<button class="btn bad" id="oRto">Mark RTO</button>' : ''}
      </div>
      <div class="actions">
        ${NATIVE ? `<button class="btn outline" id="oShare">Send invoice on WhatsApp</button>` : '<button class="btn outline" id="oPrint">Print invoice + label</button>'}
        ${canCancel ? '<button class="btn outline" id="oCancel" style="color:var(--pink)">Cancel order</button>' : ''}
      </div>
      ${awaiting(o) ? '<p class="hint">Waiting for the customer to finish paying online. Unpaid orders release their stock after 30 minutes.</p>' : ''}`);

    const reopen = () => openOrder(o.id);
    const cp = body.querySelector('#copyAddr');
    if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(`${o.customer_name}\n${addr}\n${o.customer_phone || ''}`); toast('Address copied'); } catch (_) { toast('Could not copy', true); } };
    const n = body.querySelector('#oNext');
    if (n) n.onclick = async () => { if (await advance(o)) reopen(); };
    const r = body.querySelector('#oRto');
    if (r) r.onclick = async () => {
      const v = await ask({ title: `RTO for ${o.order_no}?`, html: '<p class="muted">Stock goes back on the shelf automatically.</p>', fields: [{ name: 'note', label: 'Reason', placeholder: 'Customer refused / not reachable' }], ok: 'Mark RTO', okClass: 'bad' });
      if (!v) return;
      try { await q(sb.rpc('set_order_status', { p_order_id: o.id, p_status: 'rto', p_note: v.note || null, p_courier: null, p_tracking: null })); toast('Marked RTO · stock restored'); reopen(); } catch (e) { toast(errText(e), true); }
    };
    const c = body.querySelector('#oCancel');
    if (c) c.onclick = async () => {
      const v = await ask({ title: `Cancel ${o.order_no}?`, html: `<p class="muted">Stock goes back automatically.${o.payment_status === 'paid' ? ' This order is paid, so a refund is recorded in the books.' : ''}</p>`,
        fields: [{ name: 'note', label: 'Why?', type: 'textarea', required: true }], ok: 'Cancel order', okClass: 'bad' });
      if (!v) return;
      try { await q(sb.rpc('set_order_status', { p_order_id: o.id, p_status: 'cancelled', p_note: v.note, p_courier: null, p_tracking: null })); toast('Order cancelled'); reopen(); } catch (e) { toast(errText(e), true); }
    };
    const pr = body.querySelector('#oPrint');
    if (pr) pr.onclick = () => printInvoice(o);
    const sh = body.querySelector('#oShare');
    if (sh) sh.onclick = () => shareInvoice(o);
  }

  // In the phone app (no printer): the invoice goes to the customer as a WhatsApp message.
  function shareInvoice(o) {
    const lines = [
      `*${cfg.BUSINESS_NAME || 'Z-SHIRTS'} · Invoice ${o.order_no}*`, day(o.created_at), '',
      ...(o.items || []).map((i) => `${i.qty} × ${i.name} (${i.variant}) — ${inr(i.price * i.qty)}`), '',
      Number(o.discount) ? `Discount: − ${inr(o.discount)}` : '', Number(o.shipping) ? `Delivery: ${inr(o.shipping)}` : '',
      `*Total: ${inr(o.total)}* (inclusive of all taxes)`,
      o.payment_method === 'cod' && o.payment_status !== 'paid' ? `Cash on delivery: ${inr(o.total)}` : 'Paid — thank you!',
      cfg.GSTIN ? `GSTIN: ${cfg.GSTIN}` : '',
    ].filter((l, i, a) => l !== '' || a[i - 1] !== '');
    const text = encodeURIComponent(lines.join('\n'));
    openExternal(o.customer_phone ? `https://wa.me/91${o.customer_phone}?text=${text}` : `https://wa.me/?text=${text}`);
  }

  function printInvoice(o) {
    const a = o.address || {};
    const w = window.open('', '_blank');
    if (!w) return toast('Allow pop-ups to print', true);
    const rows = (o.items || []).map((i) => `<tr><td>${esc(i.name)}<br><small>${esc(i.variant)}</small></td><td>${i.qty}</td><td>${esc(inr(i.price))}</td><td>${esc(inr(i.price * i.qty))}</td></tr>`).join('');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(o.order_no)}</title>
      <style>body{font-family:system-ui,sans-serif;color:#000;margin:24px;font-size:13px}h1{margin:0;font-size:22px}table{width:100%;border-collapse:collapse;margin-top:14px}
      td,th{border-bottom:1px solid #ddd;padding:8px 4px;text-align:left}th:nth-child(n+2),td:nth-child(n+2){text-align:right}.tot td{border:0;font-weight:700}
      .label{border:2px dashed #000;padding:16px;margin-top:28px;font-size:15px;page-break-inside:avoid}.big{font-size:20px;font-weight:800}small{color:#555}</style></head><body>
      <h1>${esc(cfg.BUSINESS_NAME || 'Z-SHIRTS')}</h1>
      <div>${esc(cfg.BUSINESS_ADDRESS || '')}${cfg.GSTIN ? `<br>GSTIN: ${esc(cfg.GSTIN)}` : ''}</div>
      <p><b>Invoice ${esc(o.order_no)}</b> · ${esc(day(o.created_at))}<br>Bill to: ${esc(o.customer_name)}${o.customer_phone ? ` · +91 ${esc(o.customer_phone)}` : ''}</p>
      <table><thead><tr><th>Item</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${rows}</tbody>
      <tfoot>${Number(o.discount) ? `<tr class="tot"><td colspan="3">Discount</td><td>− ${esc(inr(o.discount))}</td></tr>` : ''}
      ${Number(o.shipping) ? `<tr class="tot"><td colspan="3">Delivery</td><td>${esc(inr(o.shipping))}</td></tr>` : ''}
      <tr class="tot"><td colspan="3">Total (inclusive of all taxes)</td><td>${esc(inr(o.total))}</td></tr></tfoot></table>
      <p>Payment: ${o.payment_method === 'cod' ? `<b>CASH ON DELIVERY · collect ${esc(inr(o.total))}</b>` : 'Paid'}</p>
      ${o.channel !== 'store' ? `<div class="label"><div><small>SHIP TO</small></div><div class="big">${esc(o.customer_name)}</div>
        <div>${esc([a.line1, a.line2].filter(Boolean).join(', '))}</div><div>${esc(a.city || '')}, ${esc(a.state || '')} - <b>${esc(a.pincode || '')}</b></div>
        <div>Phone: +91 ${esc(o.customer_phone || '')}</div><div style="margin-top:8px"><b>${esc(o.order_no)}</b>${o.payment_method === 'cod' ? ` · COD ${esc(inr(o.total))}` : ' · PREPAID'}</div>
        <div style="margin-top:8px"><small>FROM</small> ${esc(cfg.BUSINESS_NAME || 'Z-SHIRTS')}${cfg.BUSINESS_ADDRESS ? `, ${esc(cfg.BUSINESS_ADDRESS)}` : ''}</div></div>` : ''}
      <script>window.onload=()=>window.print()<\/script></body></html>`);
    w.document.close();
  }

  // ================================================================ SELL (store / Instagram / WhatsApp)
  VIEWS.sell = async (view) => {
    await loadStock();
    const s = state.sell;
    const maxDisc = num(state.settings.max_store_discount_pct) || 0;
    const products = [...new Map(state.stock.filter((v) => v.published && v.product_active && v.active).map((v) => [v.product_id, v])).values()];
    const term = s.search.trim().toLowerCase();
    const shown = products.filter((p) => !term || `${p.product_name}`.toLowerCase().includes(term) ||
      state.stock.some((v) => v.product_id === p.product_id && v.colour.toLowerCase().includes(term)));
    const cart = s.cart.map((c) => ({ ...c, v: state.stock.find((x) => x.variant_id === c.variant_id) })).filter((c) => c.v);
    const sub = cart.reduce((t, c) => t + c.v.price * c.qty, 0);
    const disc = Math.round((sub * s.discount) / 100);
    const store_ = s.channel === 'store';
    if (store_ && !['cash', 'upi'].includes(s.method)) s.method = 'cash';
    if (!store_ && !['upi', 'cod'].includes(s.method)) s.method = 'upi';
    const c = s.customer;

    view.innerHTML = `
      <h1>Sell</h1>
      <div class="seg">${[['store', 'Store'], ['instagram', 'Instagram'], ['whatsapp', 'WhatsApp']].map(([k, l]) => `<button data-ch="${k}" class="${s.channel === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <input class="search-in" id="sSearch" type="search" placeholder="Find a tee or colour" value="${esc(s.search)}">
      <div id="picker">${shown.length ? shown.map((p) => {
        const vars = state.stock.filter((v) => v.product_id === p.product_id && v.active).sort((a, b) => a.colour.localeCompare(b.colour) || sizeSort(a.size, b.size));
        return `<div class="card"><div class="row"><b>${esc(p.product_name)}</b><span class="amt pos">${esc(inr(p.price))}</span></div>
          <div class="var-grid">${vars.map((v) => {
            const inCart = (s.cart.find((x) => x.variant_id === v.variant_id) || {}).qty || 0;
            return `<button class="var" data-add="${v.variant_id}" ${v.stock - inCart <= 0 ? 'disabled' : ''}><i style="background:${esc(v.colour_hex)}"></i>${esc(v.colour)} ${esc(v.size)} <small>${v.stock - inCart}</small></button>`;
          }).join('')}</div></div>`;
      }).join('') : '<div class="empty">No live products yet. Add them in Stock.</div>'}</div>

      <h2>This ${store_ ? 'sale' : 'order'}</h2>
      <div class="card">
        ${cart.length ? cart.map((l) => `<div class="cart-line"><div class="grow"><b>${esc(l.v.product_name)}</b><div class="muted">${esc(l.v.colour)} / ${esc(l.v.size)}</div></div>
          <div class="stepper"><button data-dec="${l.variant_id}" aria-label="One less">−</button><span>${l.qty}</span><button data-inc="${l.variant_id}" aria-label="One more">+</button></div>
          <span class="amt" style="min-width:72px;text-align:right">${esc(inr(l.v.price * l.qty))}</span></div>`).join('') : '<div class="muted">Tap a size above to add it.</div>'}
        ${maxDisc ? `<label>Discount</label><div class="chipset">${[0, 5, 10, 15, 20, 25, 30].filter((d) => d <= maxDisc).map((d) => `<button data-disc="${d}" class="${s.discount === d ? 'on' : ''}">${d ? `${d}%` : 'None'}</button>`).join('')}</div>` : ''}
      </div>

      ${store_ ? `
        <details class="card"><summary class="muted" style="cursor:pointer">Customer name and phone (optional)</summary>
          <div class="row2"><div><label for="cName">Name</label><input id="cName" value="${esc(c.name || '')}"></div>
          <div><label for="cPhone">Phone</label><input id="cPhone" inputmode="numeric" value="${esc(c.phone || '')}"></div></div></details>` : `
        <div class="card">
          <label for="paste" style="margin-top:0">Paste the customer's message (we pick out phone, pincode and name)</label>
          <textarea id="paste" placeholder="Riya Shah\n12 Sunrise Flats, Bodakdev\nAhmedabad 380054\n98765 43210"></textarea>
          <div class="row2"><div><label for="cName">Name</label><input id="cName" value="${esc(c.name || '')}"></div>
          <div><label for="cPhone">Phone</label><input id="cPhone" inputmode="numeric" value="${esc(c.phone || '')}"></div></div>
          <label for="cLine1">Address</label><input id="cLine1" value="${esc(c.line1 || '')}">
          <div class="row2"><div><label for="cPin">Pincode</label><input id="cPin" inputmode="numeric" maxlength="6" value="${esc(c.pincode || '')}"></div>
          <div><label for="cCity">City</label><input id="cCity" value="${esc(c.city || '')}"></div></div>
          <label for="cState">State</label><input id="cState" value="${esc(c.state || '')}">
        </div>`}

      <div class="card">
        <label style="margin-top:0">Payment</label>
        <div class="chipset">${(store_ ? [['cash', 'Cash'], ['upi', 'UPI']] : [['upi', 'Prepaid (UPI)'], ['cod', 'Cash on delivery']]).map(([k, l]) => `<button data-pay="${k}" class="${s.method === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <label for="sNote">Note (optional)</label><input id="sNote" placeholder="${store_ ? 'e.g. gift wrap' : 'e.g. DM from @username'}">
        <div class="row" style="margin-top:14px"><span class="muted">Items</span><span>${esc(inr(sub))}</span></div>
        ${disc ? `<div class="row"><span class="muted">Discount ${s.discount}%</span><span class="neg">− ${esc(inr(disc))}</span></div>` : ''}
        <button class="btn block" id="sDone" ${cart.length ? '' : 'disabled'}>${store_ ? 'Complete sale' : 'Create order'} · ${esc(inr(sub - disc))}</button>
      </div>`;

    const keepForm = () => {
      ['cName', 'cPhone', 'cLine1', 'cPin', 'cCity', 'cState'].forEach((id) => {
        const el = view.querySelector(`#${id}`);
        if (el) s.customer[{ cName: 'name', cPhone: 'phone', cLine1: 'line1', cPin: 'pincode', cCity: 'city', cState: 'state' }[id]] = el.value;
      });
    };
    const redraw = () => { keepForm(); const y = window.scrollY; VIEWS.sell(view).then(() => window.scrollTo(0, y)); };
    view.querySelectorAll('[data-ch]').forEach((b) => { b.onclick = () => { s.channel = b.dataset.ch; redraw(); }; });
    view.querySelector('#sSearch').oninput = (e) => {
      s.search = e.target.value;
      clearTimeout(view._t);
      view._t = setTimeout(() => { keepForm(); VIEWS.sell(view).then(() => { const el = view.querySelector('#sSearch'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }); }, 200);
    };
    view.querySelectorAll('[data-add]').forEach((b) => {
      b.onclick = () => {
        const id = Number(b.dataset.add);
        const line = s.cart.find((x) => x.variant_id === id);
        if (line) line.qty++; else s.cart.push({ variant_id: id, qty: 1 });
        redraw();
      };
    });
    view.querySelectorAll('[data-inc]').forEach((b) => {
      b.onclick = () => {
        const l = s.cart.find((x) => x.variant_id === Number(b.dataset.inc));
        const v = state.stock.find((x) => x.variant_id === l.variant_id);
        if (l.qty + 1 > v.stock) return toast(`Only ${v.stock} in stock`, true);
        l.qty++; redraw();
      };
    });
    view.querySelectorAll('[data-dec]').forEach((b) => {
      b.onclick = () => { const l = s.cart.find((x) => x.variant_id === Number(b.dataset.dec)); l.qty--; s.cart = s.cart.filter((x) => x.qty > 0); redraw(); };
    });
    view.querySelectorAll('[data-disc]').forEach((b) => { b.onclick = () => { s.discount = Number(b.dataset.disc); redraw(); }; });
    view.querySelectorAll('[data-pay]').forEach((b) => { b.onclick = () => { s.method = b.dataset.pay; redraw(); }; });

    // Paste a DM → fields filled. Saves typing on every Instagram/WhatsApp order.
    const paste = view.querySelector('#paste');
    if (paste) {
      paste.oninput = () => {
        const txt = paste.value;
        const phone = (txt.replace(/[\s-]/g, '').match(/(?:\+?91)?([6-9]\d{9})/) || [])[1];
        const pin = (txt.match(/\b(\d{6})\b/) || [])[1];
        const lines = txt.split(/\n/).map((l) => l.trim()).filter(Boolean)
          .filter((l) => !(phone && l.replace(/\D/g, '').endsWith(phone) && l.replace(/[\d\s+-]/g, '').length < 3));
        if (phone) view.querySelector('#cPhone').value = phone;
        if (pin) { view.querySelector('#cPin').value = pin; lookupPin(pin); }
        if (lines.length && !view.querySelector('#cName').value) view.querySelector('#cName').value = lines[0].replace(/^name\s*[:-]\s*/i, '');
        const rest = lines.slice(1).map((l) => l.replace(new RegExp(`\\b${pin}\\b`), '').replace(/[,\s]+$/, '')).filter(Boolean);
        if (rest.length) view.querySelector('#cLine1').value = rest.join(', ');
      };
      const lookupPin = async (pin) => {
        try {
          const r = await fetch(`https://api.postalpincode.in/pincode/${pin}`);
          const d = await r.json();
          const po = d && d[0] && d[0].PostOffice && d[0].PostOffice[0];
          if (po) { view.querySelector('#cCity').value = po.District; view.querySelector('#cState').value = po.State; }
        } catch (_) { /* fill manually */ }
      };
      view.querySelector('#cPin').oninput = (e) => { if (/^\d{6}$/.test(e.target.value)) lookupPin(e.target.value); };
    }

    view.querySelector('#sDone').onclick = async (e) => {
      keepForm();
      const btn = e.currentTarget;
      const cust = store_
        ? { name: s.customer.name || '', phone: s.customer.phone || '' }
        : { name: s.customer.name, phone: s.customer.phone, address: { line1: s.customer.line1, city: s.customer.city, state: s.customer.state, pincode: s.customer.pincode } };
      btn.disabled = true;
      try {
        const res = await q(sb.rpc('staff_create_order', {
          p_channel: s.channel, p_customer: cust, p_items: s.cart.map((x) => ({ variant_id: x.variant_id, qty: x.qty })),
          p_method: s.method, p_discount_pct: s.discount, p_note: view.querySelector('#sNote').value || null,
        }));
        state.sell = { channel: s.channel, cart: [], discount: 0, method: s.method, search: '', customer: {} };
        toast(`${res.order_no} · ${inr(res.total)} saved`);
        VIEWS.sell(view);
      } catch (err) { btn.disabled = false; toast(errText(err), true); }
    };
  };

  // ================================================================ STOCK + PRODUCTS
  VIEWS.stock = async (view) => {
    await loadStock();
    const lim = num(state.settings.low_stock_alert) || 5;
    const groups = [...new Map(state.stock.map((v) => [v.product_id, v])).values()].sort((a, b) => a.product_name.localeCompare(b.product_name));
    const totalPieces = state.stock.filter((v) => v.active).reduce((t, v) => t + Math.max(0, v.stock), 0);
    const value = state.stock.filter((v) => v.active).reduce((t, v) => t + Math.max(0, v.stock) * Number(v.price), 0);

    view.innerHTML = `
      <h1>Stock</h1>
      <p class="sub">${totalPieces} pieces in stock · worth ${esc(inr(value))} at selling price. Tap any number to add pieces.</p>
      <button class="btn block" id="newProd" style="margin:0 0 16px">+ New product</button>
      ${groups.length ? groups.map((g) => {
        const vars = state.stock.filter((v) => v.product_id === g.product_id && v.active);
        const colours = [...new Map(vars.map((v) => [v.colour, v.colour_hex])).entries()];
        const sizes = [...new Set(vars.map((v) => v.size))].sort(sizeSort);
        const tot = vars.reduce((t, v) => t + Math.max(0, v.stock), 0);
        return `<div class="card">
          <div class="row"><div><b>${esc(g.product_name)}</b>
            <div class="muted">${esc(inr(g.price))}${Number(g.mrp) > Number(g.price) ? ` · MRP ${esc(inr(g.mrp))}` : ''} · ${tot} pcs</div></div>
            <span class="pill ${g.published ? (g.product_active ? 'approved' : 'cancelled') : 'pending'}">${g.published ? (g.product_active ? 'Live' : 'Hidden') : 'Draft'}</span></div>
          <table class="matrix"><thead><tr><th></th>${sizes.map((sz) => `<th>${esc(sz)}</th>`).join('')}</tr></thead>
            <tbody>${colours.map(([cn, hex]) => `<tr><th class="c"><span class="dot-c" style="background:${esc(hex)}"></span>${esc(cn)}</th>${sizes.map((sz) => {
              const v = vars.find((x) => x.colour === cn && x.size === sz);
              if (!v) return '<td></td>';
              const cls = v.stock <= 0 ? 'zero' : v.stock <= lim ? 'low' : 'ok';
              return `<td><button class="cell ${cls}" data-v="${v.variant_id}" aria-label="${esc(cn)} ${esc(sz)}: ${v.stock} pieces">${v.stock}</button></td>`;
            }).join('')}</tr>`).join('')}</tbody></table>
          <div class="actions">
            <button class="btn small outline" data-edit="${g.product_id}">Edit</button>
            ${!g.published && isPartner() ? `<button class="btn small" data-pub="${g.product_id}">Publish to shop</button>` : ''}
            ${g.published && isPartner() ? `<button class="btn small outline" data-price="${g.product_id}">Change price</button>` : ''}
            ${g.published ? `<a class="btn small outline" target="_blank" rel="noopener" href="${esc(shopUrl())}">View in shop</a>` : ''}
          </div>
        </div>`;
      }).join('') : '<div class="empty">No products yet. Add your first tee.</div>'}`;

    view.querySelector('#newProd').onclick = () => openProductForm();
    view.querySelectorAll('[data-v]').forEach((b) => { b.onclick = () => stockCell(Number(b.dataset.v), () => VIEWS.stock(view)); });
    view.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => openProductForm(Number(b.dataset.edit)); });
    view.querySelectorAll('[data-pub]').forEach((b) => {
      b.onclick = async () => { try { await q(sb.rpc('publish_product', { p_id: Number(b.dataset.pub) })); C.confetti(0.7); toast('Live in the shop!'); VIEWS.stock(view); } catch (e) { toast(errText(e), true); } };
    });
    view.querySelectorAll('[data-price]').forEach((b) => {
      b.onclick = async () => {
        const g = state.stock.find((v) => v.product_id === Number(b.dataset.price));
        const v = await ask({
          title: `New price for ${g.product_name}`, html: `<p class="muted">Live prices change only when all ${partners().length} partners approve.</p>`,
          fields: [{ name: 'price', label: 'Selling price (₹)', type: 'number', required: true, value: g.price }, { name: 'mrp', label: 'MRP (₹)', type: 'number', required: true, value: g.mrp },
            { name: 'why', label: 'Why?', required: true, placeholder: 'e.g. Diwali sale' }],
          ok: 'Send for approval',
        });
        if (!v) return;
        try { await q(sb.rpc('raise_request', { p_type: 'price_change', p_amount: null, p_description: v.why, p_proof_path: null, p_payload: { product_id: g.product_id, price: num(v.price), mrp: num(v.mrp) } })); toast('Sent to partners for approval'); } catch (e) { toast(errText(e), true); }
      };
    });
  };

  async function stockCell(vid, done) {
    const v = state.stock.find((x) => x.variant_id === vid);
    const body = panel(`
      <h1 style="margin-top:14px">${esc(v.product_name)}</h1>
      <p class="sub"><span class="dot-c" style="background:${esc(v.colour_hex)}"></span>${esc(v.colour)} / ${esc(v.size)} · <b>${v.stock}</b> in stock · SKU ${esc(v.sku)}</p>
      <h2>Add pieces from production</h2>
      <div class="chipset">${[1, 5, 10, 25, 50].map((n) => `<button data-q="${n}">+${n}</button>`).join('')}</div>
      <label for="qCustom">Or exact number</label>
      <div class="row2"><input id="qCustom" type="number" min="1" inputmode="numeric" placeholder="e.g. 36"><button class="btn" id="qAdd">Add</button></div>
      <label for="qNote">Note (optional)</label><input id="qNote" placeholder="Batch / printer name">
      <h2>Damaged or missing piece?</h2>
      <p class="muted">Removing stock needs all ${partners().length} partners to approve.</p>
      <button class="btn outline block" id="qWo" style="color:var(--pink)">Report damaged stock</button>`);
    const add = async (n) => {
      try {
        const left = await q(sb.rpc('add_stock', { p_variant: vid, p_qty: n, p_reason: 'production', p_note: body.querySelector('#qNote').value || null }));
        toast(`+${n} added · ${left} in stock`);
        closePanel(); done();
      } catch (e) { toast(errText(e), true); }
    };
    body.querySelectorAll('[data-q]').forEach((b) => { b.onclick = () => add(Number(b.dataset.q)); });
    body.querySelector('#qAdd').onclick = () => { const n = Number(body.querySelector('#qCustom').value); if (n > 0) add(n); else toast('Enter a number', true); };
    body.querySelector('#qWo').onclick = async () => {
      const r = await ask({ title: 'Report damaged stock', fields: [{ name: 'qty', label: 'How many pieces?', type: 'number', required: true, value: 1 }, { name: 'why', label: 'What happened?', required: true, placeholder: 'Print smudged, hole, lost…' }], ok: 'Send for approval', okClass: 'bad' });
      if (!r) return;
      try { await q(sb.rpc('raise_request', { p_type: 'stock_writeoff', p_amount: null, p_description: r.why, p_proof_path: null, p_payload: { variant_id: vid, qty: Number(r.qty) } })); toast('Sent to partners'); closePanel(); } catch (e) { toast(errText(e), true); }
    };
  }

  const PRESET_COLOURS = [['Black', '#0b0b0c'], ['White', '#ffffff'], ['Bone', '#e9e4d8'], ['Grey Melange', '#9a9a9f'], ['Navy', '#1b2a4a'], ['Olive', '#5b6236'],
    ['Maroon', '#6b1020'], ['Beige', '#d6c3a1'], ['Lavender', '#b9a6e0'], ['Lime', '#c6ff00'], ['Hot Pink', '#ff2e88'], ['Sky Blue', '#8cc8f0']];
  const PRESET_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];

  async function openProductForm(pid) {
    const prod = pid ? await q(sb.from('products').select('*').eq('id', pid).single()) : null;
    const existing = pid ? state.stock.filter((v) => v.product_id === pid) : [];
    const sel = {
      colours: new Map(existing.length ? existing.map((v) => [v.colour, v.colour_hex]) : []),
      sizes: new Set(existing.length ? existing.map((v) => v.size) : ['S', 'M', 'L', 'XL', 'XXL']),
      images: prod ? [...(prod.images || [])] : [],
    };
    const live = prod && prod.published_at;
    const draw = () => {
      const body = panel(`
        <h1 style="margin-top:14px">${prod ? 'Edit product' : 'New product'}</h1>
        ${!prod && !isPartner() ? '<p class="sub">Saved as a draft. A partner publishes it to the shop.</p>' : ''}
        <label for="pName">Name</label><input id="pName" value="${esc(prod ? prod.name : '')}" placeholder="e.g. Acid Wash Drop">
        <div class="row2">
          <div><label for="pCat">Category</label><select id="pCat"><option value="">—</option>${state.categories.map((c) => `<option value="${c.id}" ${prod && prod.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}<option value="new">+ New category</option></select></div>
          <div><label for="pType">Type</label><input id="pType" value="${esc(prod ? prod.type : 'Oversized Tee')}" list="types"><datalist id="types"><option>Oversized Tee</option><option>Graphic Tee</option><option>Hoodie</option><option>Sweatshirt</option></datalist></div>
        </div>
        <div class="row2">
          <div><label for="pMrp">MRP (₹)</label><input id="pMrp" type="number" inputmode="decimal" value="${prod ? prod.mrp : ''}" ${live ? 'disabled' : ''}></div>
          <div><label for="pPrice">Selling price (₹)</label><input id="pPrice" type="number" inputmode="decimal" value="${prod ? prod.price : ''}" ${live ? 'disabled' : ''}></div>
        </div>
        ${live ? '<div class="hint">Price is locked on live products. Use "Change price" on the Stock screen (all partners approve).</div>' : '<div class="hint" id="offHint"></div>'}
        <div class="row2">
          <div><label for="pFabric">Fabric</label><input id="pFabric" value="${esc(prod ? prod.fabric || '' : '')}" placeholder="100% cotton"></div>
          <div><label for="pGsm">GSM</label><input id="pGsm" type="number" inputmode="numeric" value="${prod && prod.gsm ? prod.gsm : ''}" placeholder="240"></div>
        </div>
        <label for="pDesc">Description</label><textarea id="pDesc" placeholder="Fit, feel, print details">${esc(prod ? prod.description : '')}</textarea>

        <label>Colours</label>
        <div class="chipset" id="pColours">${PRESET_COLOURS.map(([n, h]) => `<button type="button" data-col="${esc(n)}" data-hex="${h}" class="${sel.colours.has(n) ? 'on' : ''}"><i style="background:${h}"></i>${esc(n)}</button>`).join('')}
          ${[...sel.colours.entries()].filter(([n]) => !PRESET_COLOURS.some((p) => p[0] === n)).map(([n, h]) => `<button type="button" data-col="${esc(n)}" data-hex="${esc(h)}" class="on"><i style="background:${esc(h)}"></i>${esc(n)}</button>`).join('')}
          <button type="button" id="addCol">+ Other colour</button></div>
        <label>Sizes</label>
        <div class="chipset" id="pSizes">${PRESET_SIZES.map((s) => `<button type="button" data-size="${s}" class="${sel.sizes.has(s) ? 'on' : ''}">${s}</button>`).join('')}</div>
        <div class="hint">${sel.colours.size} colour(s) × ${sel.sizes.size} size(s) = ${sel.colours.size * sel.sizes.size} variants${existing.length ? '. Existing sizes are never deleted.' : ''}</div>

        <label for="pImgs">Photos</label>
        <input id="pImgs" type="file" accept="image/*" multiple>
        <div class="thumbs">${sel.images.map((src, i) => `<button type="button" class="linkish" data-rmimg="${i}" title="Remove"><img src="${esc(src)}" alt="Photo ${i + 1}"></button>`).join('')}</div>
        <div class="hint">First photo is the cover. Tap a photo to remove it. Without photos the shop draws the tee in its colour.</div>

        <label class="row" style="justify-content:flex-start;gap:10px;color:var(--text)"><input type="checkbox" id="pFeat" style="width:auto" ${prod && prod.featured ? 'checked' : ''}> Feature at the top of the shop</label>
        ${prod ? `<label class="row" style="justify-content:flex-start;gap:10px;color:var(--text)"><input type="checkbox" id="pActive" style="width:auto" ${prod.active ? 'checked' : ''}> Show in the shop</label>` : ''}
        <button class="btn block" id="pSave">${prod ? 'Save changes' : isPartner() ? 'Save and publish' : 'Save draft'}</button>`);

      const offHint = body.querySelector('#offHint');
      const updOff = () => {
        if (!offHint) return;
        const m = num(body.querySelector('#pMrp').value), p = num(body.querySelector('#pPrice').value);
        offHint.textContent = m && p && p <= m ? (p < m ? `Shows ${Math.round((1 - p / m) * 100)}% off in the shop` : 'No discount shown') : '';
      };
      ['#pMrp', '#pPrice'].forEach((s) => { const el = body.querySelector(s); if (el) el.oninput = updOff; });
      updOff();
      const keep = () => ({
        name: body.querySelector('#pName').value, cat: body.querySelector('#pCat').value, type: body.querySelector('#pType').value,
        mrp: body.querySelector('#pMrp').value, price: body.querySelector('#pPrice').value, fabric: body.querySelector('#pFabric').value,
        gsm: body.querySelector('#pGsm').value, desc: body.querySelector('#pDesc').value, feat: body.querySelector('#pFeat').checked,
        active: body.querySelector('#pActive') ? body.querySelector('#pActive').checked : true,
      });
      const restore = (k) => {
        const b2 = panelEl.p;
        b2.querySelector('#pName').value = k.name; b2.querySelector('#pCat').value = k.cat; b2.querySelector('#pType').value = k.type;
        b2.querySelector('#pMrp').value = k.mrp; b2.querySelector('#pPrice').value = k.price; b2.querySelector('#pFabric').value = k.fabric;
        b2.querySelector('#pGsm').value = k.gsm; b2.querySelector('#pDesc').value = k.desc; b2.querySelector('#pFeat').checked = k.feat;
        if (b2.querySelector('#pActive')) b2.querySelector('#pActive').checked = k.active;
      };
      const redraw = () => { const k = keep(); const y = panelEl.p.scrollTop; draw(); restore(k); panelEl.p.scrollTop = y; };

      body.querySelectorAll('[data-col]').forEach((b) => {
        b.onclick = () => { const n = b.dataset.col; if (sel.colours.has(n)) { if (!existing.some((v) => v.colour === n)) sel.colours.delete(n); else toast('Existing colours stay; hide them by editing stock instead'); } else sel.colours.set(n, b.dataset.hex); redraw(); };
      });
      body.querySelector('#addCol').onclick = async () => {
        const v = await ask({ title: 'Add a colour', fields: [{ name: 'name', label: 'Colour name', required: true, placeholder: 'e.g. Acid Grey' }, { name: 'hex', label: 'Colour', type: 'color', value: '#777777' }], ok: 'Add' });
        if (v && v.name.trim()) { sel.colours.set(v.name.trim(), v.hex); redraw(); }
      };
      body.querySelectorAll('[data-size]').forEach((b) => {
        b.onclick = () => { const s = b.dataset.size; if (sel.sizes.has(s)) { if (!existing.some((v) => v.size === s)) sel.sizes.delete(s); } else sel.sizes.add(s); redraw(); };
      });
      body.querySelectorAll('[data-rmimg]').forEach((b) => { b.onclick = () => { sel.images.splice(Number(b.dataset.rmimg), 1); redraw(); }; });
      body.querySelector('#pImgs').onchange = async (e) => {
        const files = [...e.target.files];
        if (!files.length) return;
        toast(`Uploading ${files.length} photo(s)…`);
        for (const f of files) {
          if (f.size > 8 * 1024 * 1024) { toast(`${f.name} is over 8 MB`, true); continue; }
          const path = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${f.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-40)}`;
          const { error } = await sb.storage.from('products').upload(path, f, { upsert: false });
          if (error) { toast(errText(error), true); continue; }
          sel.images.push(sb.storage.from('products').getPublicUrl(path).data.publicUrl);
        }
        redraw();
      };
      body.querySelector('#pSave').onclick = async (e) => {
        const k = keep();
        let catId = k.cat;
        if (!k.name.trim()) return toast('Enter the product name', true);
        if (!sel.colours.size || !sel.sizes.size) return toast('Choose at least one colour and one size', true);
        e.currentTarget.disabled = true;
        try {
          if (catId === 'new') {
            const v = await ask({ title: 'New category', fields: [{ name: 'name', label: 'Name', required: true, placeholder: 'e.g. Graphic Tees' }], ok: 'Create' });
            if (!v) { e.target.disabled = false; return; }
            catId = await q(sb.rpc('upsert_category', { p_name: v.name, p_sort: state.categories.length + 1 }));
          }
          const variants = [];
          sel.colours.forEach((hex, colour) => sel.sizes.forEach((size) => variants.push({ colour, colour_hex: hex, size })));
          const id = await q(sb.rpc('upsert_product', {
            p: {
              id: prod ? prod.id : null, name: k.name.trim(), category_id: catId ? Number(catId) : null, type: k.type,
              description: k.desc, fabric: k.fabric || null, gsm: k.gsm ? Number(k.gsm) : null,
              mrp: num(live ? prod.mrp : k.mrp), price: num(live ? prod.price : k.price), images: sel.images,
              featured: k.feat, active: k.active, publish: true, variants,
            },
          }));
          closePanel();
          if (!prod && isPartner()) C.confetti(0.7);
          toast(prod ? 'Saved' : isPartner() ? 'Live in the shop! Now add stock.' : 'Draft saved. A partner will publish it.');
          await loadStock();
          state.tab = 'stock'; render();
          return id;
        } catch (err) { toast(errText(err), true); if (e.target) e.target.disabled = false; }
      };
    };
    draw();
  }

  // ================================================================ MORE
  VIEWS.more = async (view) => {
    await updateBadges();
    const c = state.counts || {};
    const items = [
      ['returns', 'Returns & exchanges', 'Replacement and return requests from customers', c.svc],
      isPartner() && ['approvals', 'Approvals', 'Expenses, payouts, price changes, damaged stock', c.approvals],
      ['requests', isPartner() ? 'New money entry' : 'Expenses', isPartner() ? 'Expense, income, capital, payout' : 'Record an expense with the bill photo'],
      isPartner() && ['books', 'Books', 'Every rupee in and out'],
      isPartner() && ['partners', 'Partners', 'Each partner\'s investment and share'],
      isPartner() && ['close', 'Month close', 'Check the bank and lock the month'],
      isPartner() && ['log', 'Activity log', 'Who did what, when'],
      ['settings', 'Shop settings', 'Delivery, COD, discounts, limits'],
      ['password', 'My password', 'Change your login password'],
    ].filter(Boolean);
    view.innerHTML = `
      <h1>More</h1>
      <div class="menu">${items.map(([k, t, d, n]) => `<button data-v="${k}"><span><span>${esc(t)}</span><span class="d">${esc(d)}</span></span>${n ? `<span class="badge">${n}</span>` : ''}</button>`).join('')}
        <button id="openShop"><span><span>Open the shop</span><span class="d">See what customers see</span></span></button>
      </div>`;
    view.querySelectorAll('[data-v]').forEach((b) => { b.onclick = () => go('more', b.dataset.v); });
    view.querySelector('#openShop').onclick = () => openExternal(shopUrl());
  };
  const backBtn = '<button class="linkish" id="back" style="margin-top:14px">‹ More</button>';
  const wireBack = (view) => { const b = view.querySelector('#back'); if (b) b.onclick = () => go('more'); };

  // ---------------- returns & exchanges
  VIEWS.returns = async (view) => {
    const rows = await q(sb.from('service_board').select('*').order('created_at', { ascending: false }).limit(200));
    const f = state.serviceFilter;
    const list = rows.filter((r) => (f === 'open' ? ['open', 'approved'].includes(r.status) : f === 'all' || r.status === f));
    view.innerHTML = `${backBtn}
      <h1>Returns & exchanges</h1>
      <p class="sub">Exchanges: anyone on the team can approve. Returns mean a refund, so a partner approves those.</p>
      <div class="seg">${[['open', 'Waiting'], ['completed', 'Done'], ['rejected', 'Rejected'], ['all', 'All']].map(([k, l]) => `<button data-f="${k}" class="${f === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${list.length ? list.map((r) => `
        <div class="card" data-id="${r.id}">
          <div class="row"><div><span class="order-no">${esc(r.order_no)}</span> <span class="pill">${r.kind === 'replacement' ? 'Exchange' : 'Return'}</span> <span class="pill ${r.status}">${esc(r.status)}</span></div><span class="ago">${esc(ago(r.created_at))}</span></div>
          <div style="margin-top:8px;font-weight:600">${esc(r.customer_name)}</div>
          ${(r.item_list || []).map((i) => `<div class="muted">${i.qty}× ${esc(i.item)}${i.new ? ` → <b style="color:var(--cyan)">${esc(i.new)}</b>` : ''}</div>`).join('')}
          <div style="margin-top:8px">“${esc(r.reason)}”</div>
          ${r.resolution ? `<div class="muted" style="margin-top:4px">Reply: ${esc(r.resolution)}</div>` : ''}
          <div class="actions">
            ${r.customer_phone ? `<a class="btn small outline" target="_blank" rel="noopener" href="https://wa.me/91${esc(r.customer_phone)}?text=${encodeURIComponent(`Hi ${(r.customer_name || '').split(' ')[0]}, about your ${r.kind === 'replacement' ? 'exchange' : 'return'} request for Z-SHIRTS order ${r.order_no}: `)}">WhatsApp</a>` : ''}
            ${r.status === 'open' ? `<button class="btn small bad" data-act="reject">Reject</button><button class="btn small" data-act="approve">Approve</button>` : ''}
            ${r.status === 'approved' ? `<button class="btn small cyan" data-act="complete">${r.kind === 'replacement' ? 'Received old · sent new' : 'Received · refunded'}</button>` : ''}
          </div>
        </div>`).join('') : '<div class="empty">No requests here.</div>'}`;
    wireBack(view);
    view.querySelectorAll('[data-f]').forEach((b) => { b.onclick = () => { state.serviceFilter = b.dataset.f; VIEWS.returns(view); }; });
    view.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = async () => {
        const id = Number(b.closest('[data-id]').dataset.id);
        const act = b.dataset.act;
        let note = null;
        if (act === 'reject' || act === 'approve') {
          const v = await ask({ title: act === 'reject' ? 'Reject request' : 'Approve request', fields: [{ name: 'note', label: act === 'reject' ? 'Reason (customer sees this)' : 'Message to customer (optional)', type: 'textarea', required: act === 'reject', placeholder: act === 'approve' ? 'Pickup on Thursday' : '' }], ok: act === 'reject' ? 'Reject' : 'Approve', okClass: act === 'reject' ? 'bad' : '' });
          if (!v) return;
          note = v.note || null;
        }
        if (act === 'complete') {
          const v = await ask({ title: 'Complete this request?', html: '<p class="muted">Stock updates automatically. Returns record the refund in the books.</p>', ok: 'Complete' });
          if (!v) return;
        }
        try { await q(sb.rpc('set_service_status', { p_id: id, p_action: act, p_note: note })); toast('Done'); VIEWS.returns(view); updateBadges(); } catch (e) { toast(errText(e), true); }
      };
    });
  };

  // ---------------- my password (no e-mail needed)
  VIEWS.password = async (view) => {
    view.innerHTML = `${backBtn}
      <h1>My password</h1>
      <p class="sub">Signed in as ${esc(state.session.user.email)}. Choose a new password only you know.</p>
      <form id="pwForm" class="card">
        <label for="pw1" style="margin-top:0">New password</label>
        <input id="pw1" type="password" autocomplete="new-password" minlength="8" required>
        <label for="pw2">Type it again</label>
        <input id="pw2" type="password" autocomplete="new-password" minlength="8" required>
        <div class="hint">At least 8 characters. Mix letters, numbers and a symbol.</div>
        <button class="btn block" type="submit" id="pwBtn">Change password</button>
      </form>`;
    wireBack(view);
    view.querySelector('#pwForm').onsubmit = async (e) => {
      e.preventDefault();
      const a = view.querySelector('#pw1').value, b = view.querySelector('#pw2').value;
      if (a.length < 8) return toast('Use at least 8 characters.', true);
      if (a !== b) return toast('The two passwords are different.', true);
      const btn = view.querySelector('#pwBtn'); btn.disabled = true;
      const { error } = await sb.auth.updateUser({ password: a });
      btn.disabled = false;
      if (error) return toast(errText(error), true);
      view.querySelector('#pwForm').reset();
      toast('Password changed. Use the new one next time.');
    };
  };

  // ---------------- settings
  VIEWS.settings = async (view) => {
    await loadSettings();
    view.innerHTML = `${backBtn}
      <h1>Shop settings</h1>
      <p class="sub">${isPartner() ? `Changing any of these needs all ${partners().length} partners.` : 'Partners can change these.'}</p>
      <div class="card">${Object.keys(SETTING_LABEL).filter((k) => k in state.settings).map((k) => `
        <div class="row" style="padding:8px 0;border-bottom:1px solid var(--line)"><span>${esc(SETTING_LABEL[k])}</span>
          <span><b>${k === 'cod_enabled' ? (Number(state.settings[k]) ? 'On' : 'Off') : MONEY_SETTINGS.includes(k) ? esc(inr(state.settings[k])) : esc(state.settings[k])}</b>
          ${isPartner() ? ` <button class="linkish" data-k="${k}">Change</button>` : ''}</span></div>`).join('')}</div>
      <div class="card"><div class="row"><span>Profit split</span><b>${esc(RULE[state.settings.profit_rule] || '—')}</b></div><div class="row"><span>Loss split</span><b>${esc(RULE[state.settings.loss_rule] || '—')}</b></div>
        ${isPartner() ? '<button class="btn small outline" id="chgSplit" style="margin-top:10px">Change split</button>' : ''}</div>`;
    wireBack(view);
    view.querySelectorAll('[data-k]').forEach((b) => {
      b.onclick = async () => {
        const k = b.dataset.k;
        const v = await ask({ title: SETTING_LABEL[k], fields: [{ name: 'value', label: 'New value', type: 'number', required: true, value: state.settings[k] }, { name: 'why', label: 'Why?', required: true }], ok: 'Send for approval' });
        if (!v) return;
        try { await q(sb.rpc('raise_request', { p_type: 'setting_change', p_amount: null, p_description: v.why, p_proof_path: null, p_payload: { key: k, value: num(v.value) } })); toast('Sent to partners'); } catch (e) { toast(errText(e), true); }
      };
    });
    const cs = view.querySelector('#chgSplit');
    if (cs) cs.onclick = splitDialog;
  };

  async function splitDialog() {
    const split = state.settings.custom_split || {};
    const v = await ask({
      title: 'Profit / loss split',
      html: `<p class="muted">All ${partners().length} partners must approve. Custom % must add up to 100.</p>`,
      fields: [
        { name: 'profit', label: 'Profit is shared', type: 'select', value: state.settings.profit_rule, options: Object.entries(RULE) },
        { name: 'loss', label: 'Loss is shared', type: 'select', value: state.settings.loss_rule, options: Object.entries(RULE) },
        ...partners().map((m) => ({ name: `p_${m.id}`, label: `${m.name} — custom %`, type: 'number', value: split[m.id] ?? (100 / partners().length) })),
        { name: 'why', label: 'Why?', required: true, placeholder: 'As per partnership deed' },
      ],
      ok: 'Send for approval',
    });
    if (!v) return;
    const payload = { profit_rule: v.profit, loss_rule: v.loss };
    if ([v.profit, v.loss].includes('custom')) payload.split = Object.fromEntries(partners().map((m) => [m.id, num(v[`p_${m.id}`])]));
    try { await q(sb.rpc('raise_request', { p_type: 'share_rule', p_amount: null, p_description: v.why, p_proof_path: null, p_payload: payload })); toast('Sent to partners'); } catch (e) { toast(errText(e), true); }
  }

  // ---------------- approvals
  function requestDetail(r) {
    const p = r.payload || {};
    if (r.type === 'capital_in' || r.type === 'partner_payout') return `Partner: <b>${esc(memberName(p.partner_id))}</b>`;
    if (r.type === 'reversal') return `Reverses books entry <b>#${esc(p.entry_id)}</b>`;
    if (r.type === 'setting_change') return `${esc(SETTING_LABEL[p.key] || p.key)} → <b>${esc(MONEY_SETTINGS.includes(p.key) ? inr(p.value) : p.value)}</b>`;
    if (r.type === 'share_rule') {
      const sp = p.split ? `<br>${Object.entries(p.split).map(([id, v]) => `${esc(memberName(id))} ${esc(v)}%`).join(' · ')}` : '';
      return `Profit: <b>${esc(RULE[p.profit_rule])}</b> · Loss: <b>${esc(RULE[p.loss_rule])}</b>${sp}`;
    }
    if (r.type === 'price_change') return `${esc(productName(p.product_id))} → <b>${esc(inr(p.price))}</b> (MRP ${esc(inr(p.mrp))})`;
    if (r.type === 'stock_writeoff') return `${esc(variantLabel(p.variant_id))} · <b>${esc(p.qty)} piece(s)</b>`;
    return '';
  }
  function requestCard(r, { canVote = true } = {}) {
    const voted = (r.voters || []).map((v) => v.member_id);
    const waiting = partners().filter((m) => !voted.includes(m.id));
    const need = r.required_approvals;
    const detail = requestDetail(r);
    return `
      <div class="card" data-id="${r.id}">
        <div class="row"><div><span class="pill">${esc(TYPE[r.type] || r.type)}</span> <span class="pill ${r.status}">${esc(r.status)}</span></div><div class="amt">${r.amount ? esc(inr(r.amount)) : ''}</div></div>
        <div style="margin-top:10px;font-weight:600">${esc(r.description)}</div>
        ${detail ? `<div class="muted" style="margin-top:4px">${detail}</div>` : ''}
        <div class="muted" style="margin-top:6px">#${r.id} · by ${esc(r.raised_by_name)} · ${esc(when(r.created_at))}</div>
        ${need ? `<div class="progress"><span style="width:${Math.min(100, (r.approvals / need) * 100)}%"></span></div><div class="muted">${r.approvals} of ${need} approvals${need === partners().length ? ' (all partners)' : ''}</div>`
          : '<div class="muted" style="margin-top:8px">Within the spending limit · recorded instantly</div>'}
        ${isPartner() ? `<div class="voters">${(r.voters || []).map((v) => `<span class="voter ${v.decision}">${esc(v.name)}${v.note && v.decision === 'reject' ? `: ${esc(v.note)}` : ''}</span>`).join('')}
          ${r.status === 'pending' ? waiting.map((m) => `<span class="voter wait">${esc(m.name)}</span>`).join('') : ''}</div>` : ''}
        <div class="actions">
          ${r.proof_path ? `<button class="btn ghost small" data-act="proof" data-path="${esc(r.proof_path)}">View proof</button>` : ''}
          ${r.status === 'pending' && r.raised_by === state.me.id ? '<button class="btn ghost small" data-act="cancel">Withdraw</button>' : ''}
        </div>
        ${canVote && isPartner() && r.status === 'pending' && !voted.includes(state.me.id) ? `<div class="actions"><button class="btn bad" data-act="reject">Reject</button><button class="btn good" data-act="approve">Approve</button></div>` : ''}
      </div>`;
  }
  function wireRequestCards(root, reload) {
    root.querySelectorAll('[data-act]').forEach((btn) => {
      const card = btn.closest('[data-id]');
      if (!card) return;
      const id = Number(card.dataset.id);
      btn.onclick = async () => {
        const act = btn.dataset.act;
        try {
          if (act === 'proof') return showProof(btn.dataset.path);
          if (act === 'approve') {
            btn.disabled = true;
            const status = await q(sb.rpc('cast_vote', { p_request_id: id, p_decision: 'approve', p_note: null }));
            toast(status === 'approved' ? 'Approved and done.' : 'Your approval is recorded.');
          }
          if (act === 'reject') {
            const v = await ask({ title: 'Reject request', fields: [{ name: 'note', label: 'Reason (everyone will see this)', type: 'textarea', required: true }], ok: 'Reject', okClass: 'bad' });
            if (!v) return;
            const status = await q(sb.rpc('cast_vote', { p_request_id: id, p_decision: 'reject', p_note: v.note }));
            toast(status === 'rejected' ? 'Request rejected.' : 'Your rejection is recorded.');
          }
          if (act === 'cancel') {
            const v = await ask({ title: 'Withdraw this request?', html: '<p class="muted">It stays in the history as cancelled.</p>', ok: 'Withdraw', okClass: 'bad' });
            if (!v) return;
            await q(sb.rpc('cancel_request', { p_request_id: id }));
            toast('Request withdrawn.');
          }
          await loadSettings();
          reload();
          updateBadges();
        } catch (e) { btn.disabled = false; toast(errText(e), true); }
      };
    });
  }
  async function showProof(path) {
    const { data, error } = await sb.storage.from('proofs').createSignedUrl(path, 300);
    if (error) return toast(errText(error), true);
    await ask({ title: 'Proof', html: /\.pdf$/i.test(path) ? `<p><a class="linkish" href="${esc(data.signedUrl)}" target="_blank" rel="noopener">Open PDF</a></p>` : `<img class="proof" src="${esc(data.signedUrl)}" alt="Proof">`, ok: 'Close' });
  }

  VIEWS.approvals = async (view) => {
    await loadStock();
    const rows = await q(sb.from('request_board').select('*').order('created_at', { ascending: false }).limit(200));
    const f = state.approvalsFilter;
    const list = rows.filter((r) => (f === 'mine' ? r.status === 'pending' && !(r.voters || []).some((v) => v.member_id === state.me.id)
      : f === 'pending' ? r.status === 'pending' : r.status !== 'pending'));
    view.innerHTML = `${backBtn}
      <h1>Approvals</h1>
      <p class="sub">Expenses above ${esc(inr(state.settings.employee_petty_limit))} need 2 partners; above ${esc(inr(state.settings.all_partner_limit))}, all ${partners().length}.
        Capital, payouts, price changes, damaged stock and settings always need all ${partners().length}.</p>
      <div class="seg">${[['mine', 'Waiting for me'], ['pending', 'All pending'], ['done', 'Decided']].map(([k, l]) => `<button data-f="${k}" class="${f === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${list.length ? list.map((r) => requestCard(r)).join('') : `<div class="empty">${f === 'mine' ? 'All caught up ✓' : 'Nothing here.'}</div>`}`;
    wireBack(view);
    view.querySelectorAll('[data-f]').forEach((b) => { b.onclick = () => { state.approvalsFilter = b.dataset.f; VIEWS.approvals(view); }; });
    wireRequestCards(view, () => VIEWS.approvals(view));
  };

  // ---------------- money entries (expenses etc.)
  VIEWS.requests = async (view) => {
    const types = isPartner() ? ['expense', 'income', 'capital_in', 'partner_payout'] : ['expense', 'income'];
    const type = types.includes(state.newType) ? state.newType : 'expense';
    const petty = num(state.settings.employee_petty_limit), big = num(state.settings.all_partner_limit), n = partners().length;
    const mine = await q(sb.from('request_board').select('*').eq('raised_by', state.me.id).order('created_at', { ascending: false }).limit(30));
    const needsPartner = ['capital_in', 'partner_payout'].includes(type);
    const proofReq = ['expense', 'capital_in', 'partner_payout'].includes(type);
    view.innerHTML = `${backBtn}
      <h1>${isPartner() ? 'New money entry' : 'Expenses'}</h1>
      <form id="newForm" class="card">
        <label for="type" style="margin-top:0">What is this?</label>
        <select id="type">${types.map((t) => `<option value="${t}" ${t === type ? 'selected' : ''}>${TYPE[t]}</option>`).join('')}</select>
        ${needsPartner ? `<label for="partner">Which partner?</label><select id="partner" required><option value="">Choose…</option>${partners().map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select>` : ''}
        <label for="amount">Amount (₹)</label><input id="amount" type="number" min="1" step="0.01" inputmode="decimal" required>
        <label for="desc">Description</label><textarea id="desc" required placeholder="${type === 'expense' ? 'e.g. 200 blank tees from Tiruppur' : 'What is this for?'}"></textarea>
        <label for="proof">${type === 'expense' ? 'Photo of the bill' : type === 'income' ? 'Proof (optional)' : 'Bank transfer screenshot'}</label>
        <input id="proof" type="file" accept="image/*,application/pdf" capture="environment" ${proofReq ? 'required' : ''}>
        <div class="rule-box" id="ruleBox"></div>
        <button class="btn block" type="submit" id="submitBtn">Submit</button>
      </form>
      <h2>My recent entries</h2>
      ${mine.length ? mine.map((r) => requestCard(r, { canVote: false })).join('') : '<div class="empty">Nothing yet.</div>'}`;
    wireBack(view);
    const ruleBox = view.querySelector('#ruleBox');
    const upd = () => {
      const a = num(view.querySelector('#amount').value);
      ruleBox.textContent = type === 'expense'
        ? (!a ? `Up to ${inr(petty)}: recorded instantly · up to ${inr(big)}: 2 partners · above: all ${n}.` : a <= petty ? 'Recorded instantly (bill photo required).' : a <= big ? 'Needs 2 partners.' : `Needs ALL ${n} partners.`)
        : type === 'income' ? 'Needs 2 partners to confirm.' : `Needs ALL ${n} partners.`;
    };
    upd();
    view.querySelector('#amount').oninput = upd;
    view.querySelector('#type').onchange = (e) => { state.newType = e.target.value; VIEWS.requests(view); };
    view.querySelector('#newForm').onsubmit = async (e) => {
      e.preventDefault();
      const btn = view.querySelector('#submitBtn');
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        let proofPath = null;
        const file = view.querySelector('#proof').files[0];
        if (file) {
          if (file.size > 10 * 1024 * 1024) throw new Error('Photo is larger than 10 MB.');
          proofPath = `${state.session.user.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60)}`;
          const { error } = await sb.storage.from('proofs').upload(proofPath, file, { upsert: false });
          if (error) throw error;
        }
        const id = await q(sb.rpc('raise_request', {
          p_type: type, p_amount: num(view.querySelector('#amount').value), p_description: view.querySelector('#desc').value,
          p_proof_path: proofPath, p_payload: needsPartner ? { partner_id: view.querySelector('#partner').value } : {},
        }));
        toast(`Entry #${id} saved`);
        VIEWS.requests(view);
      } catch (err) { toast(errText(err), true); btn.disabled = false; btn.textContent = 'Submit'; }
    };
    wireRequestCards(view, () => VIEWS.requests(view));
  };

  // ---------------- books
  VIEWS.books = async (view) => {
    const rows = await q(sb.from('ledger').select('*').order('id', { ascending: false }).limit(1500));
    const reversed = new Set(rows.filter((r) => r.reverses_entry).map((r) => r.reverses_entry));
    const f = state.booksFilter;
    const list = f === 'all' ? rows : rows.filter((r) => r.kind === f);
    view.innerHTML = `${backBtn}
      <h1>Books</h1>
      <p class="sub">Every entry, permanent. Sales and refunds are added automatically from orders. Mistakes are fixed with a reversal all partners approve.</p>
      <div class="seg">${[['all', 'All'], ['sale', 'Sales'], ['refund', 'Refunds'], ['expense', 'Expenses'], ['income', 'Income'], ['capital_in', 'Capital'], ['partner_payout', 'Payouts']].map(([k, l]) =>
        `<button data-f="${k}" class="${f === k ? 'on' : ''}">${l}</button>`).join('')}<button id="csv">⬇ CSV</button></div>
      ${list.length ? `<div class="card table-wrap"><table><thead><tr><th>#</th><th>Date</th><th>Entry</th><th class="r">Amount</th></tr></thead><tbody>
        ${list.map((r) => `<tr><td class="muted">${r.id}</td><td class="muted" style="white-space:nowrap">${esc(day(r.entry_date))}</td>
          <td>${esc(r.description)}<div class="muted">${esc(KIND[r.kind])}${r.partner_id ? ` · ${esc(memberName(r.partner_id))}` : ''}${reversed.has(r.id) ? ' · <b>reversed</b>' : ''}</div>
          ${!r.reverses_entry && !reversed.has(r.id) && !['sale', 'refund'].includes(r.kind) ? `<button class="linkish" data-rev="${r.id}">Reverse</button>` : ''}</td>
          <td class="r">${signed(r.amount)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No entries yet.</div>'}`;
    wireBack(view);
    view.querySelectorAll('[data-f]').forEach((b) => { b.onclick = () => { state.booksFilter = b.dataset.f; VIEWS.books(view); }; });
    view.querySelector('#csv').onclick = () => {
      const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lines = ['id,date,type,description,partner,amount,order,reverses_entry'].concat(rows.slice().reverse().map((r) =>
        [r.id, r.entry_date, KIND[r.kind], r.description, r.partner_id ? memberName(r.partner_id) : '', r.amount, r.order_id, r.reverses_entry].map(cell).join(',')));
      const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
      Object.assign(document.createElement('a'), { href: url, download: `zshirts-books-${todayKey()}.csv` }).click();
      URL.revokeObjectURL(url);
    };
    view.querySelectorAll('[data-rev]').forEach((b) => {
      b.onclick = async () => {
        const id = Number(b.dataset.rev);
        const v = await ask({ title: `Reverse entry #${id}?`, html: `<p class="muted">All ${partners().length} partners must approve. The original stays visible.</p>`, fields: [{ name: 'reason', label: 'Why?', type: 'textarea', required: true }], ok: 'Request reversal' });
        if (!v) return;
        try { await q(sb.rpc('raise_request', { p_type: 'reversal', p_amount: null, p_description: v.reason, p_proof_path: null, p_payload: { entry_id: id } })); toast('Sent to partners'); } catch (e) { toast(errText(e), true); }
      };
    });
  };

  // ---------------- partners
  VIEWS.partners = async (view) => {
    const rows = await q(sb.from('partner_positions').select('*'));
    const result = rows[0] ? num(rows[0].business_result) : 0;
    view.innerHTML = `${backBtn}
      <h1>Partners</h1>
      <p class="sub">Calculated live from the books with the split all partners agreed.</p>
      <div class="card">
        <div class="row"><span class="muted">Profit is shared</span><b>${esc(RULE[state.settings.profit_rule] || '—')}</b></div>
        <div class="row"><span class="muted">Loss is shared</span><b>${esc(RULE[state.settings.loss_rule] || '—')}</b></div>
        <div class="row"><span class="muted">Business result so far</span>${signed(result)}</div>
        <button class="btn small outline" id="chgSplit" style="margin-top:10px">Change split</button>
      </div>
      ${rows.map((p) => `
        <div class="card"${p.partner_id === state.me.id ? ' style="border-color:rgba(198,255,0,.5)"' : ''}>
          <div class="row"><b style="font-size:17px">${esc(p.name)}</b><span class="pill">${esc(pct(p.result_share))} share</span></div>
          <div class="row" style="margin-top:10px"><span class="muted">Invested</span><span class="amt">${esc(inr(p.capital))} <span class="muted">(${esc(pct(p.investment_share))})</span></span></div>
          <div class="row"><span class="muted">Paid out</span><span class="amt">${esc(inr(p.payouts))}</span></div>
          <div class="row"><span class="muted">Share of profit / loss</span>${signed(p.result_amount)}</div>
          <div class="row" style="border-top:1px solid var(--line);padding-top:10px;margin-top:10px"><b>If settled today</b>${signed(p.settlement_balance)}</div>
        </div>`).join('')}
      <p class="hint">"If settled today" = invested − paid out + share of profit or loss. Positive: gets back. Negative: owes. All rows add up to the money in the business.</p>`;
    wireBack(view);
    view.querySelector('#chgSplit').onclick = splitDialog;
  };

  // ---------------- month close
  VIEWS.close = async (view) => {
    const [months, sigs] = await Promise.all([q(sb.from('month_status').select('*').order('month', { ascending: false })), q(sb.from('month_close_signatures').select('*'))]);
    const first = new Date(); first.setDate(1); first.setHours(0, 0, 0, 0);
    const n = partners().length;
    view.innerHTML = `${backBtn}
      <h1>Month close</h1>
      <p class="sub">After each month ends, every partner checks the bank and signs. When all ${n} sign, the month locks forever.</p>
      ${months.length ? months.map((m) => {
        const ms = sigs.filter((s) => s.month === m.month);
        const ended = new Date(`${m.month}T00:00:00`) < first;
        const signedByMe = ms.some((s) => s.member_id === state.me.id);
        return `<div class="card">
          <div class="row"><b>${esc(monthName(m.month))}</b><span class="pill ${m.locked ? 'approved' : ended ? 'pending' : ''}">${m.locked ? 'locked' : ended ? `${m.signatures} of ${n} signed` : 'in progress'}</span></div>
          <div class="row"><span class="muted">Movement</span>${signed(m.month_movement)}</div>
          <div class="row"><span class="muted">Closing balance as per books</span><span class="amt">${esc(inr(m.closing_balance))}</span></div>
          ${ms.length ? `<div class="voters">${ms.map((s) => { const diff = num(s.bank_balance) - num(m.closing_balance); return `<span class="voter approve">${esc(memberName(s.member_id))}: ${esc(inr(s.bank_balance))}${Math.abs(diff) > 0.009 ? ` (diff ${esc(inr(diff))})` : ''}</span>`; }).join('')}</div>` : ''}
          ${ended && !m.locked && !signedByMe ? `<div class="actions"><button class="btn" data-sign="${m.month}" data-books="${m.closing_balance}">Check bank & sign</button></div>` : ''}
        </div>`;
      }).join('') : '<div class="empty">No entries yet.</div>'}`;
    wireBack(view);
    view.querySelectorAll('[data-sign]').forEach((b) => {
      b.onclick = async () => {
        const month = b.dataset.sign;
        const v = await ask({ title: `Sign ${monthName(month)}`, html: `<p class="muted">Books say <b>${esc(inr(b.dataset.books))}</b>. Enter what the bank + cash counter actually show on the last day.</p>`,
          fields: [{ name: 'bank', label: 'Actual closing balance (₹)', type: 'number', required: true }, { name: 'note', label: 'Note (optional)', type: 'textarea' }], ok: 'Sign month' });
        if (!v) return;
        const diff = num(v.bank) - num(b.dataset.books);
        if (Math.abs(diff) > 0.009) {
          const sure = await ask({ title: 'Balance does not match', html: `<p>Difference of <b>${esc(inr(diff))}</b>. Find the reason before signing. Sign anyway?</p>`, ok: 'Sign anyway', okClass: 'bad' });
          if (!sure) return;
        }
        try {
          const count = await q(sb.rpc('sign_month_close', { p_month: month, p_bank_balance: num(v.bank), p_note: v.note || null }));
          if (count >= n) C.moment({ title: `${monthName(month)} closed`, sub: 'All partners signed. The month is locked.', kind: 'status' }); else toast(`Signed (${count} of ${n})`);
          VIEWS.close(view);
        } catch (e) { toast(errText(e), true); }
      };
    });
  };

  // ---------------- activity log
  VIEWS.log = async (view) => {
    const rows = await q(sb.from('audit_log').select('*').order('id', { ascending: false }).limit(300));
    const label = (r) => {
      const d = r.new_data || {};
      if (r.table_name === 'votes') return `${d.decision === 'reject' ? 'Rejected' : 'Approved'} request #${d.request_id}`;
      if (r.table_name === 'requests') return r.action === 'INSERT' ? `Raised request #${r.row_ref}: ${TYPE[d.type] || ''}` : `Request #${r.row_ref} → ${d.status}`;
      if (r.table_name === 'ledger') return `Books entry #${r.row_ref}: ${KIND[d.kind] || ''} ${inr(d.amount)}`;
      if (r.table_name === 'orders') return r.action === 'INSERT' ? `Order ${d.order_no} created (${CHANNEL[d.channel] || ''})` : `Order ${d.order_no} → ${STATUS[d.status] || d.status}${(r.old_data || {}).payment_status !== d.payment_status ? ` · ${d.payment_status}` : ''}`;
      if (r.table_name === 'stock_moves') return `Stock ${d.qty > 0 ? '+' : ''}${d.qty} · ${variantLabel(d.variant_id)} (${d.reason})`;
      if (r.table_name === 'products') return `Product ${r.action === 'INSERT' ? 'added' : 'edited'}: ${d.name}`;
      if (r.table_name === 'service_requests') return `${d.kind === 'return' ? 'Return' : 'Exchange'} request #${r.row_ref} → ${d.status}`;
      if (r.table_name === 'month_close_signatures') return `Signed month ${d.month}`;
      if (r.table_name === 'settings') return `Setting changed: ${SETTING_LABEL[r.row_ref] || r.row_ref}`;
      if (r.table_name === 'members') return `Member ${r.action === 'INSERT' ? 'added' : 'changed'}: ${d.name || ''}`;
      return `${r.action} ${r.table_name}`;
    };
    view.innerHTML = `${backBtn}
      <h1>Activity log</h1>
      <p class="sub">Every action by every person, permanently. Changes made outside the app show as “system / database owner”.</p>
      ${rows.map((r) => `<div class="card"><div class="row"><b>${esc(label(r))}</b><span class="muted" style="white-space:nowrap">${esc(ago(r.at))}</span></div>
        <div class="muted" style="margin-top:4px">${r.actor_name === 'system / database owner' ? '⚠ ' : ''}${esc(r.actor_name)}</div>
        <details style="margin-top:6px"><summary class="muted">Details</summary><pre style="white-space:pre-wrap;font-size:12px;color:var(--muted)">${esc(JSON.stringify({ before: r.old_data, after: r.new_data }, null, 2))}</pre></details></div>`).join('') || '<div class="empty">No activity yet.</div>'}`;
    wireBack(view);
  };

  // ================================================================ start
  let started = false;
  sb.auth.onAuthStateChange((_event, session) => {
    const prev = state.session && state.session.user.id;
    state.session = session;
    if (!started || prev !== (session && session.user.id)) { started = true; boot(); }
  });
  if (NATIVE) {
    // Android: black status bar, and the back button closes panels / goes back before leaving the app
    try { Plug.StatusBar && Plug.StatusBar.setBackgroundColor({ color: '#000000' }); Plug.StatusBar && Plug.StatusBar.setStyle({ style: 'DARK' }); } catch (_) { /* */ }
    if (Plug.App) {
      Plug.App.addListener('backButton', () => {
        const dlg = document.querySelector('dialog[open]');
        if (dlg) return dlg.close();
        if (document.querySelector('.zs-moment')) return document.querySelector('.zs-moment').remove();
        if (panelEl) return closePanel();
        if (state.tab === 'more' && state.view) return go('more');
        if (state.me && state.tab !== 'home') return go('home');
        Plug.App.exitApp();
      });
      // coming back to the app refreshes alerts and the current screen
      Plug.App.addListener('resume', () => { if (state.me) { loadNotifs().catch(() => {}); if (!panelEl) render(); } });
    }
  } else if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
