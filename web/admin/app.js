/* Z-SHIRTS Team app · orders, selling, stock, returns, live alerts, approvals and books.
 * Every rule (approvals, stock, refunds, locks) is enforced in the database; this file only shows screens.
 */
(() => {
  'use strict';
  const cfg = window.ZS_CONFIG || {};
  const $app = document.getElementById('app');
  const C = window.ZSCelebrate || { confetti() {}, chime() {}, moment() {}, welcome() { return Promise.resolve(); } };

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
  const istStart = (d) => new Date(`${d}T00:00:00+05:30`).toISOString();
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
    hr_policy: 'HR rules', salary_change: 'Salary', decision: 'Partner decision', discount: 'Big discount',
  };
  const EXP_CAT = [['production', 'Production / blanks / printing'], ['ads', 'Ads (Instagram / Meta / Google)'], ['influencer', 'Influencer'], ['packaging', 'Packaging'],
    ['shipping', 'Courier / shipping'], ['rent', 'Rent & bills'], ['salary', 'Salary'], ['software', 'Apps & software'], ['equipment', 'Equipment (printer, heat press, furniture)'],
    ['interest', 'Loan interest / bank charges'], ['tax', 'Income tax paid'], ['other', 'Other']];
  const STAGES = [['planned', 'Planned'], ['blanks', 'Blanks bought'], ['printing', 'Printing'], ['quality_check', 'Quality check'], ['ready', 'Ready · in stock']];
  const MAKING = [['queued', 'Queued'], ['printing', 'Printing'], ['quality_check', 'Quality check'], ['ready', 'Ready']];
  const KIND = { capital_in: 'Capital in', partner_payout: 'Partner payout', expense: 'Expense', income: 'Income', sale: 'Sale', refund: 'Refund' };
  const RULE = { investment: 'By investment ratio', equal: 'Equally (25% each)', custom: 'Custom %' };
  const CHANNEL = { website: 'Website', app: 'App', instagram: 'Instagram', whatsapp: 'WhatsApp', referral: 'Referral', store: 'Store',
    event: 'Event', stall: 'Event stall', influencer: 'Influencer' };
  const IN_PERSON = ['store', 'event', 'stall'];
  const SELL_CHANNELS = [['store', 'Store'], ['event', 'Event'], ['stall', 'Stall'], ['instagram', 'Instagram'], ['whatsapp', 'WhatsApp'], ['referral', 'Referral'], ['influencer', 'Influencer']];
  const soldByName = (o) => (o.sold_by ? memberName(o.sold_by) : o.sold_by_name || '');
  const STATUS = { placed: 'New', confirmed: 'Confirmed', packed: 'Packed', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled', rto: 'RTO', returned: 'Returned' };
  const NEXT = { placed: ['confirmed', 'Confirm'], confirmed: ['packed', 'Mark packed'], packed: ['shipped', 'Ship'], shipped: ['delivered', 'Mark delivered'] };
  const SETTING_LABEL = {
    employee_petty_limit: 'Spend without approval', all_partner_limit: 'All-partner approval above', shipping_fee: 'Delivery charge',
    free_shipping_above: 'Free delivery above', cod_enabled: 'Cash on delivery (1 on / 0 off)', max_store_discount_pct: 'Max discount on manual orders (%)',
    low_stock_alert: 'Low-stock alert at (pieces)', return_window_days: 'Exchange / return window (days)',
    loyalty_points_per_100: 'Z-Club points per ₹100', loyalty_max_redeem_pct: 'Max % of an order paid by points',
    income_tax_rate_pct: 'Income tax on profit (%)',
  };
  const MONEY_SETTINGS = ['employee_petty_limit', 'all_partner_limit', 'shipping_fee', 'free_shipping_above'];
  const ICON = {
    home: '<svg viewBox="0 0 24 24"><path d="M3 11 12 4l9 7v9h-6v-6H9v6H3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    orders: '<svg viewBox="0 0 24 24"><path d="M5 4h14v16l-3-2-2 2-2-2-2 2-2-2-3 2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 9h6M9 13h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    sales: '<svg viewBox="0 0 24 24"><path d="M3 17l5-5 4 4 8-8M14 8h6v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    finance: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 10h18M7 15h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M7 6V4h10v2" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    reports: '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    store: '<svg viewBox="0 0 24 24"><path d="M3 9l1.5-5h15L21 9M3 9h18M3 9v1a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0V9M5 13v7h14v-7M10 20v-4h4v4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
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
  const errText = (e) => {
    const m = (e && (e.message || e.error_description)) || String(e);
    if (/Could not find the (function|table)|schema cache|PGRST20[25]|does not exist/i.test(m)) return 'This screen needs the latest database update. In Supabase → SQL Editor run STEP-1, STEP-2 and STEP-3, then reopen the app.';
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'No internet connection. Check your network and try again.';
    return m;
  };
  const biz = () => ({ name: (state.settings && state.settings.business_name) || cfg.BUSINESS_NAME || 'Z-SHIRTS', address: (state.settings && state.settings.business_address) || cfg.BUSINESS_ADDRESS || '',
    gstin: (state.settings && state.settings.gstin) || cfg.GSTIN || '' });

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
    sell: { channel: 'store', cart: [], discount: 0, method: 'cash', search: '', customer: {}, coupon: '' },
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
          <input id="password" type="password" autocomplete="current-password" required>
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
      showWelcome().catch(() => {});
    } catch (e) {
      $app.innerHTML = `<div class="login"><div class="card warnbox">Could not load: ${esc(errText(e))}</div></div>`;
    }
  }
  async function loadSettings() {
    const rows = await q(sb.from('settings').select('*'));
    state.settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    state.settingRows = rows;
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
    if (['order', 'sale', 'dispatch', 'client', 'status', 'service', 'payment'].includes(n.kind) && ['home', 'orders', 'sales', 'store'].includes(state.tab) && !panelEl) render();
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
    const ICONS = { order: '₹', payment: '₹', milestone: '★', status: '➜', service: '↺', stock: '!', approval: '✓', sale: '🏪', dispatch: '🚚', launch: '🚀', client: '👋' };
    const seen = state.lastSeen;
    const body = panel(`
      <h1>Alerts</h1>
      <p class="sub">New orders, payments, returns, low stock${isPartner() ? ' and approvals' : ''}.</p>
      ${!NATIVE && 'PushManager' in window && !store.get('zs_team_push', false) ? `<button class="btn cyan block" id="allowN" style="margin:0 0 12px">Turn on phone alerts (even when closed)</button>
        <p class="hint" style="margin-top:-4px">New orders, approvals and low stock will buzz this phone even when the app is closed.</p>` : ''}
      ${NATIVE ? '<p class="hint" style="margin-top:-4px">The Android app alerts you while it is open. For alerts with the app closed, open the team web app in Chrome once and tap "Turn on phone alerts".</p>' : ''}
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
    if (allow) allow.onclick = async () => { try { await enableTeamPush(); toast('Phone alerts on. You will get a buzz for every new order.'); C.chime(); } catch (e) { toast(errText(e), true); } openNotifs(); };
    body.querySelectorAll('[data-order]').forEach((el) => { el.onclick = () => openOrder(Number(el.dataset.order)); });
  }

  // ================================================================ shell
  const ALL_TABS = [['home', 'Home'], ['stock', 'Stock'], ['orders', 'Orders'], ['sales', 'Sales'], ['store', 'Store'], ['finance', 'Finance'], ['reports', 'Reports'], ['more', 'More']];
  const tabsFor = () => ALL_TABS.filter(([k]) => k !== 'finance' || isPartner());

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
      ${state.tab !== 'sell' ? '<button class="fab" id="fabBill" aria-label="New bill">+ Bill</button>' : ''}
      <nav class="tabs">${tabsFor().map(([k, label]) => `
        <button data-tab="${k}" class="${state.tab === k || (k === 'sales' && state.tab === 'sell') ? 'on' : ''}" aria-label="${label}">
          <span class="ico">${ICON[k]}</span>${label}${k === 'orders' || k === 'more' ? `<span class="badge" id="badge-${k}" hidden></span>` : ''}</button>`).join('')}
      </nav>`;
    document.getElementById('bell').onclick = openNotifs;
    const fab = document.getElementById('fabBill'); if (fab) fab.onclick = () => go('sell');
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
    const emp = state.me.role === 'employee';
    const P = isPartner();
    const m0 = monthKey();
    const none = Promise.resolve(null);
    const safe = (p) => p.catch(() => null);
    const [daily, active, svc, summary, reqs, att, pv, leaves, targets, pos, months, mstat, monthOrders, myToday, blanks, pol, held, tDay, tWeek] = await Promise.all([
      q(sb.from('sales_daily').select('*').gte('day', since)),
      q(sb.from('orders').select('id,status,payment_method,payment_status').in('status', ['placed', 'confirmed', 'packed'])),
      q(sb.from('service_requests').select('id,status').in('status', ['open', 'approved'])),
      P ? safe(q(sb.from('business_summary').select('*').single())) : none,
      P ? q(sb.from('request_board').select('id,voters').eq('status', 'pending')) : Promise.resolve([]),
      emp ? safe(q(sb.from('attendance').select('*').eq('member_id', state.me.id).eq('day', todayKey()))) : none,
      safe(q(sb.rpc('cash_day_preview', { p_day: null }))),
      P ? safe(q(sb.from('leave_requests').select('id').eq('status', 'pending'))) : none,
      safe(q(sb.rpc('target_progress', { p_month: m0 }))),
      P ? safe(q(sb.from('partner_positions').select('*'))) : none,
      P ? safe(q(sb.from('monthly_report').select('*').order('month', { ascending: false }).limit(6))) : none,
      P ? safe(q(sb.from('month_status').select('*'))) : none,
      safe(q(sb.from('order_board').select('channel,total,shipping,pieces,status,payment_method,payment_status,sold_by,sold_by_name,created_at')
        .gte('created_at', istStart(m0)).not('status', 'in', '(cancelled,rto,returned)'))),
      safe(q(sb.from('order_board').select('total,shipping,pieces,status,channel').eq('sold_by', state.me.id).gte('created_at', istStart(todayKey())).not('status', 'in', '(cancelled,rto,returned)'))),
      safe(q(sb.from('blank_stock').select('*'))),
      emp ? safe(q(sb.rpc('hr_policy'))) : none,
      P ? safe(q(sb.from('cash_with_partners').select('*'))) : none,
      safe(q(sb.rpc('target_now', { p_period: 'day' }))),
      safe(q(sb.rpc('target_now', { p_period: 'week' }))),
    ]);
    const t = daily.find((d) => d.day === todayKey()) || { orders: 0, value: 0, pieces: 0 };
    const ready = active.filter((o) => !(o.payment_method === 'online' && o.payment_status === 'pending'));
    const count = (s) => ready.filter((o) => o.status === s).length;
    const lim = num(state.settings.low_stock_alert) || 5;
    const low = state.stock.filter((s) => s.active && s.published && s.stock <= lim && !s.is_preorder);
    const lowBlanks = (blanks || []).filter((b) => b.qty <= lim);
    const myApprovals = reqs.filter((r) => !(r.voters || []).some((v) => v.member_id === state.me.id)).length;
    const hour = Number(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }));
    const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const a = att && att[0];
    const paidOrders = (monthOrders || []).filter((o) => !(o.payment_method === 'online' && o.payment_status === 'pending'));

    const actions = [
      [emp && !a ? 1 : 0, 'cyan', 'Check in for today', 'Selfie + time, takes 5 seconds', () => window.scrollTo(0, 0)],
      [pv && !pv.closed && hour >= 20 ? 1 : 0, 'pink', "Close today's cash", 'Count the drawer and add a photo', () => go('store')],
      [(leaves || []).length, 'pink', 'leave requests', 'Mahendra is waiting for an answer', () => go('more', 'hr')],
      [count('placed'), 'lime', 'to confirm', 'New orders waiting', () => go('orders', null, (state.orderFilter = 'placed'))],
      [count('confirmed'), 'lime', 'to pack', 'Confirmed, not packed yet', () => go('orders', null, (state.orderFilter = 'confirmed'))],
      [count('packed'), 'cyan', 'to ship', 'Packed, hand to courier', () => go('orders', null, (state.orderFilter = 'packed'))],
      [svc.length, 'pink', 'exchange / return requests', 'Customers waiting for a reply', () => go('more', 'returns')],
      [myApprovals, 'pink', 'approvals need you', 'Nothing moves until partners approve', () => go('more', 'approvals')],
      [low.length, 'pink', 'printed sizes running low', `At or below ${lim} pieces`, () => go('stock')],
      [lowBlanks.length, 'pink', 'blank tee sizes running low', 'Order plain tees before printing', () => go('stock')],
    ].filter((x) => x[0] > 0);

    // 14-day bars
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const k = new Date(Date.now() - i * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      const d = daily.find((x) => x.day === k);
      days.push({ k, v: d ? Number(d.value) : 0 });
    }
    const max = Math.max(1, ...days.map((d) => d.v));
    const total14 = days.reduce((s, d) => s + d.v, 0);

    // monthly milestone + team targets
    const biz = (targets || []).find((x) => !x.member_id) || { target_pcs: 0, target_amount: 0, pcs: 0, amount: 0, orders: 0 };
    const people = (targets || []).filter((x) => x.member_id).sort((x, y) => Number(y.pcs) - Number(x.pcs) || Number(y.amount) - Number(x.amount));
    const lastDay = new Date(new Date(`${m0}T00:00:00`).getFullYear(), new Date(`${m0}T00:00:00`).getMonth() + 1, 0).getDate();
    const dayNo = Number(todayKey().slice(8, 10));
    const pace = (got, target) => (target ? Math.round((got / target) * 100) : 0);
    const meter = (got, target, money) => `<div class="tgt"><div class="row"><span>${money ? esc(inr(got)) : `${got} pcs`}${target ? ` <span class="muted">of ${money ? esc(inr(target)) : `${target} pcs`}</span>` : ''}</span>
      <b class="${pace(got, target) >= 100 ? 'pos' : ''}">${target ? `${pace(got, target)}%` : '—'}</b></div>
      <div class="meter"><span style="width:${Math.min(100, pace(got, target))}%"></span><i style="left:${(dayNo / lastDay) * 100}%" title="Where you should be today"></i></div></div>`;
    const hit = biz.target_pcs && biz.pcs >= biz.target_pcs;
    if (hit && !store.get(`zs_hit_${m0}`, false)) { store.set(`zs_hit_${m0}`, true); setTimeout(() => C.moment({ title: 'Monthly target smashed!', sub: `${biz.pcs} pieces sold this month`, big: true, kind: 'milestone' }), 600); }
    const milestoneCard = `<div class="card milestone">
        <div class="row"><b>${esc(monthName(m0))} milestone</b><span class="muted">day ${dayNo} of ${lastDay}</span></div>
        ${meter(Number(biz.pcs), Number(biz.target_pcs), false)}${meter(Number(biz.amount), Number(biz.target_amount), true)}
        ${!biz.target_pcs && !biz.target_amount ? `<div class="hint">No target set for this month yet.${P ? '' : ' Partners set it.'}</div>` : ''}
        ${P ? '<button class="btn small outline" id="setTargets" style="margin-top:10px">Set targets</button>' : ''}</div>`;
    const leaderboard = people.length ? `<div class="card">${people.map((p, i) => `<div class="lb-row${p.member_id === state.me.id ? ' me' : ''}">
        <span class="lb-rank">${i + 1}</span><span class="lb-name">${esc(p.name)}<small>${p.orders} orders · ${esc(inr(p.amount))}</small></span>
        <span class="lb-bar"><span style="width:${p.target_pcs ? Math.min(100, pace(p.pcs, p.target_pcs)) : 0}%"></span></span>
        <b>${p.pcs}${p.target_pcs ? `<small>/${p.target_pcs}</small>` : ''}</b></div>`).join('')}
        ${(() => { const others = paidOrders.filter((o) => !o.sold_by && o.sold_by_name); return others.length ? `<div class="muted" style="margin-top:8px">Others: ${[...new Set(others.map((o) => o.sold_by_name))].map(esc).join(', ')}</div>` : ''; })()}</div>` : '';

    // where sales came from this month
    const ch = {};
    paidOrders.forEach((o) => { ch[o.channel] = ch[o.channel] || { n: 0, v: 0, pcs: 0 }; ch[o.channel].n++; ch[o.channel].v += Number(o.total) - Number(o.shipping); ch[o.channel].pcs += Number(o.pieces); });
    const chRows = Object.entries(ch).sort((x, y) => y[1].v - x[1].v);
    const chMax = Math.max(1, ...chRows.map((r) => r[1].v));
    const channelCard = chRows.length ? `<div class="card hbars">${chRows.map(([k, r]) => `<div class="hbar"><span class="l">${esc(CHANNEL[k] || k)}</span>
        <span class="b"><i style="width:${(r.v / chMax) * 100}%"></i></span><span class="v">${esc(inr(r.v))} · ${r.pcs}</span></div>`).join('')}</div>` : '<div class="empty">No sales yet this month.</div>';

    // my share (full partner finance lives in the Finance tab)
    const mine_ = (pos || []).find((p) => p.partner_id === state.me.id);
    const partnerCards = mine_ ? `<div class="card pcard me"><div class="row"><b>My share</b><button class="linkish" data-goto="finance">Finance ›</button></div>
        <div class="row"><span class="muted">I invested</span><span class="amt">${esc(inr(mine_.capital))}</span></div>
        <div class="row"><span class="muted">My profit / loss (${esc(pct(mine_.result_share))})</span>${signed(mine_.result_amount)}</div>
        <div class="row"><span class="muted">If settled today</span>${signed(mine_.settlement_balance)}</div></div>` : '';

    // last 6 month closings
    const closings = (months || []).map((m) => ({ ...m, st: (mstat || []).find((x) => x.month === m.month) }));
    const closingCard = closings.length ? `<div class="card table-wrap"><table><thead><tr><th>Month</th><th class="r">Sales</th><th class="r">Spent</th><th class="r">Net</th><th class="r">Closing</th></tr></thead><tbody>
        ${closings.map((m) => `<tr><td>${esc(shortMonth(m.month))} ${m.st && m.st.locked ? '🔒' : ''}<div class="muted">${m.orders} orders · ${m.pieces} pcs</div></td><td class="r">${esc(inr(Number(m.sales) - Number(m.refunds)))}</td>
          <td class="r">${esc(inr(m.expenses))}</td><td class="r">${signed(m.net_result)}</td><td class="r">${m.st ? esc(inr(m.st.closing_balance)) : '—'}</td></tr>`).join('')}</tbody></table></div>` : '';

    const cashCard = pv && P ? `<div class="card cash-hero small-hero"><div class="row"><div><div class="k">Cash at the store now</div><div class="v">${esc(inr(pv.expected))}</div></div>
        ${pv.closed ? '<span class="pill approved">Closed ✓</span>' : '<button class="btn small" data-hand>I collected cash</button>'}</div>
        <div class="cash-flow"><span>Opening ${esc(inr(pv.opening))}</span><span class="pos">+ cash sales ${esc(inr(pv.cash_sales))}</span><span class="neg">− handed to partners ${esc(inr(pv.handed_over))}</span></div>
        <button class="linkish" id="toCash" style="margin-top:8px">Store cash details ›</button></div>`
      : emp ? `<div class="card cash-hero small-hero"><div class="row"><div><b>Store cash</b><div class="muted">Handing cash to a partner? Record it here.</div></div>
        ${pv && pv.closed ? '<span class="pill approved">Closed ✓</span>' : '<button class="btn small" data-hand>Hand over</button>'}</div>
        <button class="linkish" id="toCash" style="margin-top:8px">Close the day ›</button></div>` : '';

    const mine = myToday || [];
    const mineCard = `<div class="today" style="grid-template-columns:1fr 1fr 1fr">
        <div class="stat"><div class="k">I sold today</div><div class="v">${mine.reduce((s2, o) => s2 + Number(o.pieces), 0)} pcs</div></div>
        <div class="stat"><div class="k">Value</div><div class="v">${esc(inr(mine.reduce((s2, o) => s2 + Number(o.total) - Number(o.shipping), 0)))}</div></div>
        <div class="stat"><div class="k">Bills</div><div class="v">${mine.length}</div></div></div>`;
    const me = people.find((p) => p.member_id === state.me.id);

    view.innerHTML = `
      <h1>${hello}, ${esc(state.me.name.split(' ')[0])}</h1>
      <p class="sub">${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' })}</p>
      ${emp && pol ? `<div id="punchBox">${punchHtml(a, pol)}</div>` : ''}
      ${emp ? `<h2>My sales</h2>${mineCard}${(() => { const md = (tDay || []).find((x) => x.member_id === state.me.id) || {}; const mw = (tWeek || []).find((x) => x.member_id === state.me.id) || {};
        return `<div class="card">${md.target_pcs || md.target_amount ? `<div class="muted">Today</div>${md.target_pcs ? meter(Number(md.pcs), Number(md.target_pcs), false) : ''}${md.target_amount ? meter(Number(md.amount), Number(md.target_amount), true) : ''}` : ''}
          ${mw.target_pcs ? `<div class="muted" style="margin-top:8px">This week</div>${meter(Number(mw.pcs), Number(mw.target_pcs), false)}` : ''}
          ${me ? `<div class="muted" style="margin-top:8px">${esc(monthName(m0))}</div>${meter(Number(me.pcs), Number(me.target_pcs), false)}` : ''}</div>`; })()}` : ''}
      <h2>Today · whole business</h2>
      <div class="today">
        <div class="stat"><div class="k">Sold today</div><div class="v">${esc(inr(t.value))}</div></div>
        <div class="stat"><div class="k">Orders</div><div class="v">${t.orders}</div></div>
        <div class="stat"><div class="k">Pieces</div><div class="v">${t.pieces}</div></div>
      </div>
      ${(() => {
        const d = (tDay || []).find((x) => !x.member_id) || {};
        const w = (tWeek || []).find((x) => !x.member_id) || {};
        const dp = Number(d.target_pcs) || (biz.target_pcs ? Math.ceil(biz.target_pcs / lastDay) : 0);
        const da = Number(d.target_amount) || (biz.target_amount ? Math.ceil(biz.target_amount / lastDay) : 0);
        const people = (tDay || []).filter((x) => x.member_id && (Number(x.target_pcs) || Number(x.target_amount)));
        if (!dp && !da && !w.target_pcs && !people.length) return P ? '<div class="card"><div class="row"><b>No daily target yet</b><button class="linkish" data-more2="targets">Set targets ›</button></div></div>' : '';
        return `<div class="card"><div class="row"><b>Today's target</b>${P ? '<button class="linkish" data-more2="targets">Edit ›</button>' : ''}</div>
          ${dp ? meter(Number(t.pieces), dp, false) : ''}${da ? meter(Number(t.value), da, true) : ''}
          ${w.target_pcs || w.target_amount ? `<div class="muted" style="margin-top:10px">This week</div>${w.target_pcs ? meter(Number(w.pcs), Number(w.target_pcs), false) : ''}${w.target_amount ? meter(Number(w.amount), Number(w.target_amount), true) : ''}` : ''}
          ${people.length ? `<div class="muted" style="margin-top:10px">Each person today</div>${people.map((x) => `<div class="lb-row${x.member_id === state.me.id ? ' me' : ''}" style="grid-template-columns:1fr 70px auto"><span class="lb-name">${esc(x.name)}<small>${esc(inr(x.amount))}${Number(x.target_amount) ? ` of ${esc(inr(x.target_amount))}` : ''}</small></span>
            <span class="lb-bar"><span style="width:${x.target_pcs ? Math.min(100, (x.pcs / x.target_pcs) * 100) : 0}%"></span></span><b>${x.pcs}${x.target_pcs ? `<small>/${x.target_pcs}</small>` : ''}</b></div>`).join('')}` : ''}</div>`;
      })()}
      <button class="btn block" data-goto="sell" style="margin:4px 0 6px">+ New bill</button>
      ${cashCard}
      <h2>Do next</h2>
      ${actions.length ? `<div class="action-list">${actions.map(([n, c, t1, t2], i) => `
        <button class="action ${c}" data-a="${i}"><span class="n">${n}</span><span class="t"><b>${t1}</b><span>${t2}</span></span><span class="go">›</span></button>`).join('')}</div>`
        : `<div class="all-clear"><b>All clear</b>Nothing waiting. Go make some content.</div>`}
      <h2>Best sellers & demand</h2>
      <div id="demandBox"></div>
      <h2>This month</h2>
      ${milestoneCard}
      ${people.length ? `<h2>Who's selling · ${esc(monthName(m0))}</h2>${leaderboard}` : ''}
      ${P ? `<h2>Where sales came from</h2>${channelCard}` : ''}
      <h2>Last 14 days</h2>
      <div class="card">
        <div class="row"><span class="muted">Sales</span><span class="amt">${esc(inr(total14))}</span></div>
        <div class="bars" aria-label="Daily sales for the last 14 days">${days.map((d, i) =>
          `<div class="${i === 13 ? 'today-bar' : d.v ? 'has' : ''}" style="height:${Math.max(4, (d.v / max) * 100)}%" title="${esc(day(d.k))}: ${esc(inr(d.v))}"></div>`).join('')}</div>
        <div class="bars-x"><span>${esc(new Date(days[0].k).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }))}</span><span>Today</span></div>
      </div>
      ${summary ? `
        <h2>Money</h2>
        <div class="grid">
          <div class="stat hero"><div class="k">Money in the business (as per books)</div><div class="v">${esc(inr(summary.cash_balance))}</div></div>
          <div class="stat"><div class="k">Total sales</div><div class="v">${esc(inr(summary.total_sales))}</div></div>
          <div class="stat"><div class="k">Expenses</div><div class="v">${esc(inr(summary.total_expenses))}</div></div>
          <div class="stat" style="grid-column:1/-1"><div class="k">Profit / loss so far</div><div class="v">${signed(summary.business_result)}</div></div>
        </div>` : ''}
      ${partnerCards}
      ${closingCard ? `<h2>Last 6 months</h2>${closingCard}` : ''}
      ${P ? `<h2>All reports</h2><div class="chipset">${REPORTS.map(([k, l]) => `<button data-rep="${k}">${l}</button>`).join('')}<button data-go="production">Production</button><button data-go="hr">Team & HR</button><button data-go="influencers">Influencers</button><button data-go="coupons">Coupons</button></div>` : ''}`;
    view.querySelectorAll('[data-a]').forEach((b) => { b.onclick = actions[Number(b.dataset.a)][4]; });
    view.querySelectorAll('[data-rep]').forEach((b) => { b.onclick = () => { state.report = b.dataset.rep; go('reports'); }; });
    view.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => go('more', b.dataset.go); });
    view.querySelectorAll('[data-goto]').forEach((b) => { b.onclick = () => go(b.dataset.goto); });
    view.querySelectorAll('[data-more2]').forEach((b) => { b.onclick = () => go('more', b.dataset.more2); });
    view.querySelectorAll('[data-hand]').forEach((b) => { b.onclick = () => cashHandover(() => VIEWS.home(view)); });
    const tc = view.querySelector('#toCash'); if (tc) tc.onclick = () => go('store');
    if (emp && pol) wirePunch(view.querySelector('#punchBox'), a, () => VIEWS.home(view));
    demandCard(view.querySelector('#demandBox'));
    const st = view.querySelector('#setTargets'); if (st) st.onclick = () => go('more', 'targets');
  };

  function partnerFinanceHtml(pos, held) {
  let partnerCards = '';
  if (pos && pos.length) {
    const rule = state.settings.profit_rule;
    const split = state.settings.custom_split || {};
    const share = (p) => (rule === 'equal' ? 1 / pos.length : rule === 'investment' ? Number(p.investment_share || 0) : Number(split[p.partner_id] || 0) / 100);
    const netIn = pos.map((p) => ({ p, net: Number(p.capital) - Number(p.payouts) }));
    const total = netIn.reduce((s2, x) => s2 + x.net, 0);
    const diffs = netIn.map((x) => ({ name: x.p.name, d: Math.round(x.net - total * share(x.p)) }));
    const give = diffs.filter((x) => x.d < 0).map((x) => ({ ...x, d: -x.d })), get = diffs.filter((x) => x.d > 0).map((x) => ({ ...x }));
    const moves = [];
    for (const g of give) for (const r of get) { const amt = Math.min(g.d, r.d); if (amt > 0) { moves.push(`${esc(g.name.split(' ')[0])} → ${esc(r.name.split(' ')[0])}: <b>${esc(inr(amt))}</b>`); g.d -= amt; r.d -= amt; } }
    partnerCards = `<div class="partner-grid">${pos.map((p) => `<div class="card pcard${p.partner_id === state.me.id ? ' me' : ''}">
        <b>${esc(p.name)}</b>
        <div class="row"><span class="muted">Invested</span><span class="amt">${esc(inr(p.capital))}</span></div>
        ${Number(p.payouts) ? `<div class="row"><span class="muted">Taken out</span><span class="amt">${esc(inr(p.payouts))}</span></div>` : ''}
        ${(() => { const h = (held || []).find((x) => x.partner_id === p.partner_id); return h && Number(h.collected) ? `<div class="row"><span class="muted">Store cash collected</span><span class="amt">${esc(inr(h.collected))}</span></div>` : ''; })()}
        <div class="row"><span class="muted">Profit / loss (${esc(pct(p.result_share))})</span>${signed(p.result_amount)}</div>
        <div class="row" style="border-top:1px solid var(--line);padding-top:6px;margin-top:6px"><span class="muted">If settled today</span>${signed(p.settlement_balance)}</div></div>`).join('')}</div>
      <div class="card settle"><b>To make every partner equal (${esc(RULE[rule] || rule)})</b>
        ${moves.length ? `<div class="settle-list">${moves.map((m) => `<div>${m}</div>`).join('')}</div><div class="hint">Pay each other directly. When a partner pays the business instead, record it as Capital in.</div>`
          : '<div class="muted" style="margin-top:6px">Everyone has put in their fair share. Nothing to settle ✓</div>'}</div>`;
  }
  return partnerCards;
}

  async function targetsDialog(rows, done) {
    const team = state.members.filter((m) => m.active);
    const cur = (id) => rows.find((r) => (r.member_id || null) === id) || {};
    const v = await ask({ title: `Targets · ${monthName(monthKey())}`, html: '<p class="muted">Month runs from the 1st to the last day. Pieces and amount; leave 0 for no target.</p>',
      fields: [{ name: 'b_pcs', label: 'Whole business · pieces', type: 'number', value: cur(null).target_pcs || 0 }, { name: 'b_amt', label: 'Whole business · sales ₹', type: 'number', value: cur(null).target_amount || 0 }]
        .concat(team.flatMap((m) => [{ name: `p_${m.id}`, label: `${m.name} · pieces`, type: 'number', value: cur(m.id).target_pcs || 0 }, { name: `a_${m.id}`, label: `${m.name} · sales ₹`, type: 'number', value: cur(m.id).target_amount || 0 }])),
      ok: 'Save targets' });
    if (!v) return;
    try {
      await q(sb.rpc('set_target', { p_month: monthKey(), p_member: null, p_pcs: Number(v.b_pcs) || 0, p_amount: num(v.b_amt) || 0 }));
      for (const m of team) await q(sb.rpc('set_target', { p_month: monthKey(), p_member: m.id, p_pcs: Number(v[`p_${m.id}`]) || 0, p_amount: num(v[`a_${m.id}`]) || 0 }));
      toast('Targets saved'); done();
    } catch (e) { toast(errText(e), true); }
  }

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
      <div class="seg">${[['all', 'All channels']].concat(Object.entries(CHANNEL)).map(([k, l]) =>
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
          ${o.production_status && ['placed', 'confirmed'].includes(o.status) ? `<span class="pill" style="color:var(--cyan)">Making · ${esc((MAKING.find((m) => m[0] === o.production_status) || [])[1] || '')}</span>` : ''}
          ${o.coupon_code ? `<span class="pill">${esc(o.coupon_code)}</span>` : ''}
          ${soldByName(o) ? `<span class="pill">by ${esc(soldByName(o).split(' ')[0])}</span>` : ''}
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
      <p class="muted">Placed ${esc(when(o.created_at))}${o.created_by ? ` by ${esc(memberName(o.created_by))}` : ''}${soldByName(o) ? ` · <b style="color:var(--lime)">sale credited to ${esc(soldByName(o))}</b>` : ''}</p>

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
        ${Number(o.bundle_discount) ? `<div class="row"><span class="muted">Combo · ${esc(o.bundle_name)}</span><span class="neg">− ${esc(inr(o.bundle_discount))}</span></div>` : ''}
        ${Number(o.coupon_discount) ? `<div class="row"><span class="muted">Coupon ${esc(o.coupon_code)}</span><span class="neg">− ${esc(inr(o.coupon_discount))}</span></div>` : ''}
        ${Number(o.points_used) ? `<div class="row"><span class="muted">Z-Club points</span><span class="neg">− ${esc(inr(o.points_used))}</span></div>` : ''}
        ${Number(o.discount) - Number(o.bundle_discount || 0) - Number(o.coupon_discount || 0) - Number(o.points_used || 0) > 0 ? `<div class="row"><span class="muted">Discount</span><span class="neg">− ${esc(inr(Number(o.discount) - Number(o.bundle_discount || 0) - Number(o.coupon_discount || 0) - Number(o.points_used || 0)))}</span></div>` : ''}
        ${Number(o.shipping) ? `<div class="row"><span class="muted">Delivery</span><span>${esc(inr(o.shipping))}</span></div>` : ''}
        <div class="row"><b>Total</b><span class="amt">${esc(inr(o.total))}</span></div>
        <div class="muted" style="margin-top:6px">${o.payment_method === 'online' ? 'Paid online (Razorpay)' : o.payment_method === 'cod' ? 'Cash on delivery' : `Paid by ${esc(o.payment_method.toUpperCase())}`}</div>
      </div>

      ${o.courier ? `<div class="card"><div class="row"><span class="muted">Courier</span><b>${esc(o.courier)}</b></div>${o.tracking_no ? `<div class="row"><span class="muted">AWB</span><b>${esc(o.tracking_no)}</b></div>` : ''}</div>` : ''}
      ${o.note ? `<div class="card"><span class="muted">Note</span><div>${esc(o.note)}</div></div>` : ''}
      ${o.account_name || o.utm_campaign ? `<div class="card">${o.account_name ? `<div class="row"><span class="muted">Z-Club member</span><b>${esc(o.account_name)}</b></div>` : ''}${o.utm_source || o.utm_campaign ? `<div class="row"><span class="muted">Came from</span><b>${esc([o.utm_source, o.utm_campaign].filter(Boolean).join(' · '))}</b></div>` : ''}</div>` : ''}
      ${o.production_status ? `<div class="card" style="border-color:rgba(0,229,255,.4)"><b>Made to order · customer sees this</b>
        <div class="chipset" style="margin-top:10px">${MAKING.map(([k, l]) => `<button data-make="${k}" class="${o.production_status === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>` : ''}

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
    body.querySelectorAll('[data-make]').forEach((b) => {
      b.onclick = async () => { try { await q(sb.rpc('set_production_status', { p_order_id: o.id, p_status: b.dataset.make })); toast('Customer updated'); if (b.dataset.make === 'ready') C.confetti(0.4); reopen(); } catch (e) { toast(errText(e), true); } };
    });
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
      `*${biz().name} · Invoice ${o.order_no}*`, day(o.created_at), '',
      ...(o.items || []).map((i) => `${i.qty} × ${i.name} (${i.variant}) — ${inr(i.price * i.qty)}`), '',
      Number(o.discount) ? `Discount: − ${inr(o.discount)}` : '', Number(o.shipping) ? `Delivery: ${inr(o.shipping)}` : '',
      `HSN ${state.settings.hsn_cotton || '61091000'} · GST ${(o.items || []).some((i) => Number(i.gst) > (num(state.settings.gst_rate_low) || 5)) ? 'incl. as per slab' : `${num(state.settings.gst_rate_low) || 5}% included`}`,
      `*Total: ${inr(o.total)}* (inclusive of all taxes)`,
      o.payment_method === 'cod' && o.payment_status !== 'paid' ? `Cash on delivery: ${inr(o.total)}` : 'Paid — thank you!',
      biz().gstin ? `GSTIN: ${biz().gstin}` : '',
    ].filter((l, i, a) => l !== '' || a[i - 1] !== '');
    const text = encodeURIComponent(lines.join('\n'));
    openExternal(o.customer_phone ? `https://wa.me/91${o.customer_phone}?text=${text}` : `https://wa.me/?text=${text}`);
  }

  function printInvoice(o) {
    const a = o.address || {};
    const w = window.open('', '_blank');
    if (!w) return toast('Allow pop-ups to print', true);
    // prices include GST; split each line into taxable value + GST for the invoice
    const factor = Number(o.subtotal) ? (Number(o.total) - Number(o.shipping)) / Number(o.subtotal) : 1;
    let taxable = 0, gstSum = 0;
    const rows = (o.items || []).map((i) => {
      const rate = Number(i.gst || (i.price > (num(state.settings.gst_threshold) || 2500) ? num(state.settings.gst_rate_high) || 18 : num(state.settings.gst_rate_low) || 5));
      const gross = i.price * i.qty * factor;
      const tv = gross / (1 + rate / 100);
      taxable += tv; gstSum += gross - tv;
      return `<tr><td>${esc(i.name)}<br><small>${esc(i.variant)} · HSN ${esc(i.hsn || state.settings.hsn_cotton || '61091000')}</small></td><td>${i.qty}</td><td>${esc(inr(i.price))}</td><td>${rate}%</td><td>${esc(inr(i.price * i.qty))}</td></tr>`;
    }).join('');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(o.order_no)}</title>
      <style>body{font-family:system-ui,sans-serif;color:#000;margin:24px;font-size:13px}h1{margin:0;font-size:22px}table{width:100%;border-collapse:collapse;margin-top:14px}
      td,th{border-bottom:1px solid #ddd;padding:8px 4px;text-align:left}th:nth-child(n+2),td:nth-child(n+2){text-align:right}.tot td{border:0;font-weight:700}
      .label{border:2px dashed #000;padding:16px;margin-top:28px;font-size:15px;page-break-inside:avoid}.big{font-size:20px;font-weight:800}small{color:#555}</style></head><body>
      <h1>${esc(biz().name)}</h1>
      <div>${esc(biz().address || '')}${biz().gstin ? `<br>GSTIN: ${esc(biz().gstin)}` : ''}</div>
      <p><b>Invoice ${esc(o.order_no)}</b> · ${esc(day(o.created_at))}<br>Bill to: ${esc(o.customer_name)}${o.customer_phone ? ` · +91 ${esc(o.customer_phone)}` : ''}</p>
      <table><thead><tr><th>Item</th><th>Qty</th><th>Rate</th><th>GST</th><th>Amount</th></tr></thead><tbody>${rows}</tbody>
      <tfoot>${Number(o.discount) ? `<tr class="tot"><td colspan="4">Discount</td><td>− ${esc(inr(o.discount))}</td></tr>` : ''}
      ${Number(o.shipping) ? `<tr class="tot"><td colspan="4">Delivery</td><td>${esc(inr(o.shipping))}</td></tr>` : ''}
      <tr class="tot"><td colspan="4">Total (inclusive of all taxes)</td><td>${esc(inr(o.total))}</td></tr>
      <tr><td colspan="4"><small>Taxable value ${esc(inr(Math.round(taxable * 100) / 100))} · CGST ${esc(inr(Math.round(gstSum * 50) / 100))} · SGST ${esc(inr(Math.round(gstSum * 50) / 100))} (IGST ${esc(inr(Math.round(gstSum * 100) / 100))} if outside the state)</small></td><td></td></tr></tfoot></table>
      <p>Payment: ${o.payment_method === 'cod' ? `<b>CASH ON DELIVERY · collect ${esc(inr(o.total))}</b>` : 'Paid'}</p>
      ${o.channel !== 'store' ? `<div class="label"><div><small>SHIP TO</small></div><div class="big">${esc(o.customer_name)}</div>
        <div>${esc([a.line1, a.line2].filter(Boolean).join(', '))}</div><div>${esc(a.city || '')}, ${esc(a.state || '')} - <b>${esc(a.pincode || '')}</b></div>
        <div>Phone: +91 ${esc(o.customer_phone || '')}</div><div style="margin-top:8px"><b>${esc(o.order_no)}</b>${o.payment_method === 'cod' ? ` · COD ${esc(inr(o.total))}` : ' · PREPAID'}</div>
        <div style="margin-top:8px"><small>FROM</small> ${esc(biz().name)}${biz().address ? `, ${esc(biz().address)}` : ''}</div></div>` : ''}
      <script>window.onload=()=>window.print()<\/script></body></html>`);
    w.document.close();
  }

  // ================================================================ SELL (store / Instagram / WhatsApp)
  VIEWS.sell = async (view) => {
    await loadStock();
    const s = state.sell;
    const maxDisc = isPartner() ? num(state.settings.max_partner_discount_pct) || 50 : num(state.settings.max_store_discount_pct) || 0;
    const freeDisc = num(state.settings.discount_free_pct) || 10;
    if (isPartner() && s.discount > freeDisc && !state.discReqs) {
      state.discReqs = (await q(sb.from('request_board').select('id,status,payload,description,raised_by').eq('type', 'discount').eq('raised_by', state.me.id).order('id', { ascending: false }).limit(20)).catch(() => []));
    }
    const products = [...new Map(state.stock.filter((v) => v.published && v.product_active && v.active).map((v) => [v.product_id, v])).values()];
    const term = s.search.trim().toLowerCase();
    const shown = products.filter((p) => !term || `${p.product_name}`.toLowerCase().includes(term) ||
      state.stock.some((v) => v.product_id === p.product_id && v.colour.toLowerCase().includes(term)));
    const cart = s.cart.map((c) => ({ ...c, v: state.stock.find((x) => x.variant_id === c.variant_id) })).filter((c) => c.v);
    const sub = cart.reduce((t, c) => t + c.v.price * c.qty, 0);
    const disc = Math.round((sub * s.discount) / 100);
    const store_ = IN_PERSON.includes(s.channel);
    if (s.soldBy === undefined) s.soldBy = state.me.id;
    if (store_ && !['cash', 'upi'].includes(s.method)) s.method = 'cash';
    if (!store_ && !['upi', 'cod'].includes(s.method)) s.method = 'upi';
    const c = s.customer;

    view.innerHTML = `
      <div class="row" style="align-items:center"><h1>New bill</h1><button class="linkish" id="toSales">Today's sales ›</button></div>
      <div class="seg">${SELL_CHANNELS.map(([k, l]) => `<button data-ch="${k}" class="${s.channel === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="row2" style="grid-template-columns:1fr auto;align-items:start"><input class="search-in" id="sSearch" type="search" placeholder="Find a tee or colour" value="${esc(s.search)}">
        <button class="btn cyan" id="sScan" style="height:46px">Scan tag</button></div>
      <div id="picker">${shown.length ? shown.map((p) => {
        const vars = state.stock.filter((v) => v.product_id === p.product_id && v.active).sort((a, b) => a.colour.localeCompare(b.colour) || sizeSort(a.size, b.size));
        return `<div class="card"><div class="row"><b>${esc(p.product_name)}</b><span class="amt pos">${esc(inr(p.price))}</span></div>
          <div class="var-grid">${vars.map((v) => {
            const inCart = (s.cart.find((x) => x.variant_id === v.variant_id) || {}).qty || 0;
            return `<button class="var" data-add="${v.variant_id}" ${v.stock - inCart <= 0 && !v.is_preorder ? 'disabled' : ''}><i style="background:${esc(v.colour_hex)}"></i>${esc(v.colour)} ${esc(v.size)} <small>${v.stock - inCart}</small></button>`;
          }).join('')}</div></div>`;
      }).join('') : '<div class="empty">No live products yet. Add them in Stock.</div>'}</div>

      <h2>This ${store_ ? 'sale' : 'order'}</h2>
      <div class="card">
        ${cart.length ? cart.map((l) => `<div class="cart-line"><div class="grow"><b>${esc(l.v.product_name)}</b><div class="muted">${esc(l.v.colour)} / ${esc(l.v.size)}</div></div>
          <div class="stepper"><button data-dec="${l.variant_id}" aria-label="One less">−</button><span>${l.qty}</span><button data-inc="${l.variant_id}" aria-label="One more">+</button></div>
          <span class="amt" style="min-width:72px;text-align:right">${esc(inr(l.v.price * l.qty))}</span></div>`).join('') : '<div class="muted">Tap a size above to add it.</div>'}
        ${maxDisc && !s.coupon ? `<label>Discount</label><div class="chipset">${[0, 5, 10, 15, 20, 25, 30, 40, 50].filter((d) => d <= maxDisc).map((d) => `<button data-disc="${d}" class="${s.discount === d ? 'on' : ''}">${d ? `${d}%` : 'None'}</button>`).join('')}</div>` : ''}
        ${isPartner() && s.discount > freeDisc ? (() => {
          const ok = (state.discReqs || []).filter((r) => r.status === 'approved' && !(r.payload || {}).used_order && Number((r.payload || {}).pct) >= s.discount);
          const waiting = (state.discReqs || []).filter((r) => r.status === 'pending');
          return `<div class="disc-warn">
            ${ok.length ? `<label for="sDiscReq" style="margin-top:0">Use an approved discount</label><select id="sDiscReq"><option value="">No, charge the extra to me</option>${ok.map((r) => `<option value="${r.id}" ${s.discReq === r.id ? 'selected' : ''}>#${r.id} · ${r.payload.pct}% · ${esc(r.description)}</option>`).join('')}</select>` : ''}
            ${!s.discReq ? `<b>Above ${freeDisc}% is on you.</b> The extra ${s.discount - freeDisc}% of this bill goes to your personal account, not the other partners'.
              <div class="muted" style="margin-top:4px">For a deal of ${num(state.settings.discount_bulk_pcs) || 25}+ tees, or any special case, ask all partners first.</div>
              <button class="btn small outline" id="askDisc" style="margin-top:8px">Ask partners to approve ${s.discount}%</button>${waiting.length ? `<div class="muted" style="margin-top:6px">${waiting.length} request(s) waiting for votes</div>` : ''}`
              : '<b class="pos">Approved by all partners. The business carries this discount.</b>'}</div>`;
        })() : ''}
        <label for="sCoupon">Coupon code</label>
        <div class="row2" style="grid-template-columns:1fr auto"><input id="sCoupon" value="${esc(s.coupon)}" placeholder="e.g. STORE100" style="text-transform:uppercase">
          <button class="btn small outline" id="sCouponBtn">${s.coupon ? 'Remove' : 'Apply'}</button></div>
        <div class="hint" id="sCouponMsg">${s.discount && !s.coupon ? 'A coupon replaces the manual discount.' : ''}</div>
        <label>Sold by (who gets the credit)</label>
        <div class="chipset">${state.members.filter((m) => m.active).map((m) => `<button data-sold="${m.id}" class="${s.soldBy === m.id ? 'on' : ''}">${esc(m.name.split(' ')[0])}</button>`).join('')}
          <button data-sold="other" class="${s.soldBy === 'other' ? 'on' : ''}">Someone else</button></div>
        ${s.soldBy === 'other' ? `<input id="sSoldName" placeholder="Name of the person who brought this sale" value="${esc(s.soldName || '')}" style="margin-top:8px">` : ''}
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
        <div id="sSum"><div class="row" style="margin-top:14px"><span class="muted">Items</span><span>${esc(inr(sub))}</span></div>
        ${disc ? `<div class="row"><span class="muted">Discount ${s.discount}%</span><span class="neg">− ${esc(inr(disc))}</span></div>` : ''}</div>
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
    view.querySelector('#toSales').onclick = () => go('sales');
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
        if (!v.is_preorder && l.qty + 1 > v.stock) return toast(`Only ${v.stock} in stock`, true);
        l.qty++; redraw();
      };
    });
    view.querySelectorAll('[data-dec]').forEach((b) => {
      b.onclick = () => { const l = s.cart.find((x) => x.variant_id === Number(b.dataset.dec)); l.qty--; s.cart = s.cart.filter((x) => x.qty > 0); redraw(); };
    });
    view.querySelectorAll('[data-disc]').forEach((b) => { b.onclick = () => { s.discount = Number(b.dataset.disc); s.discReq = null; state.discReqs = null; redraw(); }; });
    if (view.querySelector('#sDiscReq')) view.querySelector('#sDiscReq').onchange = (e) => { s.discReq = e.target.value ? Number(e.target.value) : null; redraw(); };
    if (view.querySelector('#askDisc')) view.querySelector('#askDisc').onclick = async () => {
      const pcs = s.cart.reduce((t, x) => t + x.qty, 0);
      const v = await ask({ title: `Ask partners for ${s.discount}% off`, html: `<p class="muted">All ${partners().length} partners must approve. Once approved, the business carries the whole discount on one bill.</p>`,
        fields: [{ name: 'pieces', label: 'Tees in this deal', type: 'number', value: pcs || 25, required: true }, { name: 'why', label: 'Who is it for and why?', required: true, placeholder: 'College fest, 40 tees' }], ok: 'Send' });
      if (!v) return;
      try { await q(sb.rpc('raise_request', { p_type: 'discount', p_amount: null, p_description: v.why, p_proof_path: null, p_payload: { pct: s.discount, pieces: Number(v.pieces) } })); state.discReqs = null; toast('Sent. You will get an alert when all partners approve.'); redraw(); } catch (e) { toast(errText(e), true); }
    };
    view.querySelectorAll('[data-pay]').forEach((b) => { b.onclick = () => { s.method = b.dataset.pay; redraw(); }; });
    view.querySelectorAll('[data-sold]').forEach((b) => { b.onclick = () => { s.soldBy = b.dataset.sold; redraw(); }; });
    if (view.querySelector('#sSoldName')) view.querySelector('#sSoldName').oninput = (e) => { s.soldName = e.target.value; };
    view.querySelector('#sCouponBtn').onclick = () => {
      s.coupon = s.coupon ? '' : view.querySelector('#sCoupon').value.trim().toUpperCase();
      if (s.coupon) s.discount = 0;
      redraw();
    };
    view.querySelector('#sScan').onclick = () => scanTag((code) => {
      const v = state.stock.find((x) => x.sku === code || String(x.variant_id) === code.replace(/^ZS:/, ''));
      if (!v) return toast(`Tag ${code} not found`, true);
      const line = s.cart.find((x) => x.variant_id === v.variant_id);
      if ((line ? line.qty : 0) + 1 > v.stock) return toast(`Only ${v.stock} of ${v.size} in stock`, true);
      if (line) line.qty++; else s.cart.push({ variant_id: v.variant_id, qty: 1 });
      C.chime();
      toast(`+1 ${v.product_name} · ${v.colour} / ${v.size}`);
      redraw();
    });
    // live price from the database: combos, coupon, discount
    if (cart.length) {
      sb.rpc('staff_quote', { p_channel: s.channel, p_items: s.cart.map((x) => ({ variant_id: x.variant_id, qty: x.qty })), p_discount_pct: s.discount,
        p_coupon: s.coupon || null, p_phone: (s.customer.phone || '').replace(/\D/g, '').slice(-10) || null }).then(({ data: qt, error }) => {
        if (error || !qt || !view.querySelector('#sSum')) return;
        view.querySelector('#sSum').innerHTML = `
          <div class="row" style="margin-top:14px"><span class="muted">Items</span><span>${esc(inr(qt.subtotal))}</span></div>
          ${qt.bundle_discount > 0 ? `<div class="row"><span class="muted">Combo · ${esc(qt.bundle_name)}</span><span class="neg">− ${esc(inr(qt.bundle_discount))}</span></div>` : ''}
          ${qt.manual_discount > 0 ? `<div class="row"><span class="muted">Discount ${s.discount}%</span><span class="neg">− ${esc(inr(qt.manual_discount))}</span></div>` : ''}
          ${qt.coupon_discount > 0 ? `<div class="row"><span class="muted">Coupon ${esc(qt.coupon_code)}</span><span class="neg">− ${esc(inr(qt.coupon_discount))}</span></div>` : ''}
          ${!store_ && qt.shipping > 0 ? `<div class="row"><span class="muted">Delivery</span><span>${esc(inr(qt.shipping))}</span></div>` : ''}`;
        const msg = view.querySelector('#sCouponMsg');
        if (s.coupon) { msg.textContent = qt.coupon_error || `${qt.coupon_code} applied`; msg.style.color = qt.coupon_error ? 'var(--pink)' : 'var(--lime)'; }
        view.querySelector('#sDone').textContent = `${store_ ? 'Complete sale' : 'Create order'} · ${inr(qt.total)}`;
      });
    }

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
          p_method: s.method, p_discount_pct: s.discount, p_note: view.querySelector('#sNote').value || null, p_coupon: s.coupon || null,
          p_sold_by: s.soldBy && s.soldBy !== 'other' ? s.soldBy : null, p_sold_by_name: s.soldBy === 'other' ? (s.soldName || '').trim() || null : null,
          p_discount_request: s.discReq || null,
        }));
        if (s.soldBy === 'other' && !(s.soldName || '').trim()) toast('Tip: write the seller name next time');
        C.confetti(0.5); C.chime();
        state.sell = { channel: s.channel, cart: [], discount: 0, method: s.method, search: '', customer: {}, coupon: '', soldBy: s.soldBy, soldName: s.soldName };
        toast(`${res.order_no} · ${inr(res.total)} saved`);
        VIEWS.sell(view);
      } catch (err) { btn.disabled = false; toast(errText(err), true); }
    };
  };

  // ================================================================ STOCK + PRODUCTS
  VIEWS.stock = async (view) => {
    await loadStock();
    const [blanks, dtf] = await Promise.all([q(sb.from('blank_stock').select('*')).catch(() => []), q(sb.from('dtf_stock').select('*')).catch(() => [])]);
    const lim = num(state.settings.low_stock_alert) || 5;
    const groups = [...new Map(state.stock.map((v) => [v.product_id, v])).values()].sort((a, b) => a.product_name.localeCompare(b.product_name));
    const totalPieces = state.stock.filter((v) => v.active).reduce((t, v) => t + Math.max(0, v.stock), 0);
    const value = state.stock.filter((v) => v.active).reduce((t, v) => t + Math.max(0, v.stock) * Number(v.price), 0);

    view.innerHTML = `
      <h1>Stock</h1>
      <p class="sub">${totalPieces} pieces in stock · worth ${esc(inr(value))} at selling price. Tap any number to add pieces.
        ${state.stock.some((v) => v.waiting > 0) ? `<br><b style="color:var(--cyan)">${state.stock.reduce((t, v) => t + Number(v.waiting || 0), 0)} customers waiting for a restock alert</b> (sizes marked 🔔).` : ''}</p>
      <button class="btn block" id="newProd" style="margin:0 0 16px">+ New product</button>
      <div class="card blanks-card">
        <div class="row"><div><b>Blank tees (before printing)</b><div class="muted">${blanks.reduce((t, b) => t + Math.max(0, b.qty), 0)} plain pieces · used automatically when a batch starts printing</div></div></div>
        ${blanks.length ? (() => {
          const cols = [...new Map(blanks.map((b) => [b.colour, b.colour_hex])).entries()];
          const sizes = [...new Set(blanks.map((b) => b.size))].sort(sizeSort);
          return `<table class="matrix"><thead><tr><th></th>${sizes.map((z) => `<th>${esc(z)}</th>`).join('')}</tr></thead><tbody>${cols.map(([cn, hex]) => `<tr><th class="c"><span class="dot-c" style="background:${esc(hex || '#000')}"></span>${esc(cn)}</th>${sizes.map((z) => {
            const b = blanks.find((x) => x.colour === cn && x.size === z);
            return b ? `<td><span class="cell ${b.qty <= 0 ? 'zero' : b.qty <= lim ? 'low' : 'ok'}" style="display:grid;place-items:center">${b.qty}</span></td>` : '<td></td>';
          }).join('')}</tr>`).join('')}</tbody></table>`;
        })() : '<div class="muted" style="margin-top:8px">Not tracking blanks yet. Add your first purchase of plain black tees.</div>'}
        <div class="actions"><button class="btn small" data-blank="purchase">+ Bought blanks</button><button class="btn small outline" data-blank="damaged" style="color:var(--pink)">Damaged blanks</button></div>
      </div>
      <div class="card blanks-card">
        <div class="row"><div><b>DTF prints (ready to press)</b><div class="muted">${dtf.reduce((t, d) => t + Math.max(0, d.qty), 0)} prints · used automatically when a batch starts printing</div></div></div>
        ${dtf.length ? dtf.map((d) => `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line)"><span>${esc(d.name)}<div class="muted">${d.bought || 0} bought · ${d.used || 0} used${d.cost_per_print ? ` · ${esc(inr(d.cost_per_print))}/print` : ''}</div></span>
          <b class="${d.qty <= lim ? 'neg' : 'pos'}">${d.qty}</b></div>`).join('') : '<div class="muted" style="margin-top:8px">Not tracking DTF prints yet.</div>'}
        <div class="actions"><button class="btn small" data-dtf="purchase">+ Bought DTF prints</button><button class="btn small outline" data-dtf="damaged" style="color:var(--pink)">Damaged prints</button></div>
      </div>
      <h2>Printed tees (ready to sell)</h2>
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
              return `<td><button class="cell ${cls}" data-v="${v.variant_id}" aria-label="${esc(cn)} ${esc(sz)}: ${v.stock} pieces">${v.stock}${v.waiting > 0 ? '<sup>🔔</sup>' : ''}</button></td>`;
            }).join('')}</tr>`).join('')}</tbody></table>
          <div class="actions">
            <button class="btn small outline" data-edit="${g.product_id}">Edit</button>
            ${!g.published && isPartner() ? `<button class="btn small" data-pub="${g.product_id}">Publish to shop</button>` : ''}
            ${g.published && isPartner() ? `<button class="btn small outline" data-price="${g.product_id}">Change price</button>` : ''}
            ${g.published ? `<a class="btn small outline" target="_blank" rel="noopener" href="${esc(shopUrl())}">View in shop</a>` : ''}
            <button class="btn small outline" data-tags="${g.product_id}">QR tags</button>
            ${g.drop_name ? `<span class="pill" style="align-self:center">${esc(g.drop_name)}${g.drop_at && new Date(g.drop_at) > Date.now() ? ` · ${esc(when(g.drop_at))}` : ''}</span>` : ''}
            ${g.is_preorder ? '<span class="pill" style="align-self:center">Pre-order</span>' : ''}
            ${isPartner() && g.cost_price !== null ? `<span class="pill" style="align-self:center">Cost ${esc(inr(g.cost_price))} · margin ${Number(g.price) ? Math.round((1 - g.cost_price / g.price) * 100) : 0}%</span>` : ''}
          </div>
        </div>`;
      }).join('') : '<div class="empty">No products yet. Add your first tee.</div>'}`;

    view.querySelector('#newProd').onclick = () => openProductForm();
    view.querySelectorAll('[data-dtf]').forEach((b) => {
      b.onclick = async () => {
        const buy = b.dataset.dtf === 'purchase';
        const prods = [...new Map(state.stock.map((x) => [x.product_id, x.product_name])).entries()];
        const v = await ask({ title: buy ? 'DTF prints bought' : 'Damaged DTF prints', fields: [
          { name: 'p', label: 'Design (tee)', type: 'select', options: prods }, { name: 'qty', label: 'Prints', type: 'number', required: true },
          ...(buy ? [{ name: 'cost', label: 'Total cost (₹, optional)', type: 'number' }] : []), { name: 'note', label: buy ? 'Vendor / bill no.' : 'What happened?' }], ok: 'Save' });
        if (!v) return;
        try { const left = await q(sb.rpc('add_dtf', { p_product: Number(v.p), p_qty: Number(v.qty), p_reason: b.dataset.dtf, p_cost: num(v.cost), p_note: v.note || null })); toast(`${left} DTF prints now`); VIEWS.stock(view); } catch (e) { toast(errText(e), true); }
      };
    });
    view.querySelectorAll('[data-blank]').forEach((b) => {
      b.onclick = async () => {
        const buy = b.dataset.blank === 'purchase';
        const v = await ask({ title: buy ? 'Blank tees bought' : 'Damaged blank tees', fields: [
          { name: 'colour', label: 'Colour', value: 'Black', required: true }, { name: 'size', label: 'Size', type: 'select', value: 'L', options: PRESET_SIZES.map((z) => [z, z]) },
          { name: 'qty', label: 'Pieces', type: 'number', required: true }, ...(buy ? [{ name: 'cost', label: 'Total cost (₹, optional)', type: 'number' }] : []),
          { name: 'note', label: buy ? 'Supplier / bill no.' : 'What happened?' }], ok: 'Save' });
        if (!v) return;
        const preset = PRESET_COLOURS.find((c) => c[0].toLowerCase() === v.colour.trim().toLowerCase());
        try { const left = await q(sb.rpc('add_blanks', { p_colour: v.colour, p_hex: preset ? preset[1] : null, p_size: v.size, p_qty: Number(v.qty), p_reason: b.dataset.blank, p_cost: num(v.cost), p_note: v.note || null }));
          toast(`${v.colour} ${v.size}: ${left} blank pieces now`); VIEWS.stock(view); } catch (e) { toast(errText(e), true); }
      };
    });
    view.querySelectorAll('[data-tags]').forEach((b) => {
      b.onclick = () => printTags(state.stock.filter((v) => v.product_id === Number(b.dataset.tags) && v.active && v.stock > 0).map((v) => ({ v, n: v.stock })));
    });
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
      <button class="btn outline block" id="qTag" style="margin-top:14px">Print QR price tags for this size</button>
      <h2>Piece-by-piece history</h2><div id="qHist" class="card"><div class="muted">Loading…</div></div>
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
    q(sb.from('stock_history').select('*').eq('variant_id', vid).order('id', { ascending: false }).limit(50)).then((h) => {
      const RS = { opening: 'Opening stock', production: 'Printed / added', sale: 'Sold', cancel: 'Order cancelled', rto: 'RTO back', return: 'Returned', replacement_out: 'Exchange sent', writeoff: 'Written off' };
      body.querySelector('#qHist').innerHTML = h.length ? h.map((x) => `<div class="row" style="padding:5px 0;border-bottom:1px solid var(--line)"><span>${esc(RS[x.reason] || x.reason)}${x.order_no ? ` · ${esc(x.order_no)}` : ''}${x.note ? ` · ${esc(x.note)}` : ''}
        <div class="muted">${esc(when(x.at))}${x.by_name ? ` · ${esc(x.by_name)}` : ''}</div></span><b class="${x.qty > 0 ? 'pos' : 'neg'}">${x.qty > 0 ? '+' : ''}${x.qty}</b></div>`).join('') : '<div class="muted">No movement yet.</div>';
    }).catch(() => {});
    body.querySelector('#qTag').onclick = async () => {
      const r = await ask({ title: 'How many tags?', fields: [{ name: 'n', label: 'Tags to print', type: 'number', required: true, value: Math.max(1, v.stock) }], ok: 'Print' });
      if (r) printTags([{ v, n: Math.min(200, Math.max(1, Number(r.n) || 1)) }]);
    };
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

        ${isPartner() ? `<div class="card" style="margin-top:16px;border-color:rgba(255,46,136,.4)">
          <b>Drop, limited edition & pre-order</b>
          <label for="pDrop">Drop name (optional)</label><input id="pDrop" value="${esc(prod && prod.drop_name || '')}" placeholder="e.g. Drop 01 · Chrome">
          <label for="pDropAt">Goes on sale at (leave empty = now)</label><input id="pDropAt" type="datetime-local" value="${prod && prod.drop_at ? new Date(new Date(prod.drop_at).getTime() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : ''}">
          <label for="pLimited">Limited to (pieces, optional)</label><input id="pLimited" type="number" inputmode="numeric" value="${prod && prod.limited_qty || ''}" placeholder="e.g. 50">
          <label class="row" style="justify-content:flex-start;gap:10px;color:var(--text)"><input type="checkbox" id="pPre" style="width:auto" ${prod && prod.is_preorder ? 'checked' : ''}> Made to order (customers can buy with 0 stock; you update making status)</label>
          <label for="pFab">Fabric (decides HSN code for GST)</label><select id="pFab"><option value="cotton" ${!prod || prod.fabric_type !== 'synthetic' ? 'selected' : ''}>Cotton · HSN ${esc(state.settings.hsn_cotton || '61091000')}</option><option value="synthetic" ${prod && prod.fabric_type === 'synthetic' ? 'selected' : ''}>Synthetic / silk / wool · HSN ${esc(state.settings.hsn_synthetic || '610990')}</option></select>
          <div class="hint">GST is set by price: up to ${esc(inr(state.settings.gst_threshold || 2500))} a piece ${esc(state.settings.gst_rate_low || 5)}%, above that ${esc(state.settings.gst_rate_high || 18)}%.</div>
          <label for="pCost">Cost per piece (₹) · only partners see this</label><input id="pCost" type="number" inputmode="decimal" value="${prod && Number(prod.cost_price) ? prod.cost_price : ''}" placeholder="Blank + print + packing">
          <div class="hint">Production batches update the cost automatically. Shop shows a countdown until the drop time.</div>
        </div>` : ''}
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
        drop: body.querySelector('#pDrop') ? body.querySelector('#pDrop').value : null,
        dropAt: body.querySelector('#pDropAt') ? body.querySelector('#pDropAt').value : null,
        limited: body.querySelector('#pLimited') ? body.querySelector('#pLimited').value : null,
        pre: body.querySelector('#pPre') ? body.querySelector('#pPre').checked : false,
        cost: body.querySelector('#pCost') ? body.querySelector('#pCost').value : null,
        fab: body.querySelector('#pFab') ? body.querySelector('#pFab').value : null,
      });
      const restore = (k) => {
        const b2 = panelEl.p;
        b2.querySelector('#pName').value = k.name; b2.querySelector('#pCat').value = k.cat; b2.querySelector('#pType').value = k.type;
        b2.querySelector('#pMrp').value = k.mrp; b2.querySelector('#pPrice').value = k.price; b2.querySelector('#pFabric').value = k.fabric;
        b2.querySelector('#pGsm').value = k.gsm; b2.querySelector('#pDesc').value = k.desc; b2.querySelector('#pFeat').checked = k.feat;
        if (b2.querySelector('#pActive')) b2.querySelector('#pActive').checked = k.active;
        if (b2.querySelector('#pDrop')) { b2.querySelector('#pDrop').value = k.drop; b2.querySelector('#pDropAt').value = k.dropAt; b2.querySelector('#pLimited').value = k.limited; b2.querySelector('#pPre').checked = k.pre; b2.querySelector('#pCost').value = k.cost; b2.querySelector('#pFab').value = k.fab; }
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
          if (isPartner() && id) {
            const wasDrop = prod && (prod.drop_name || prod.drop_at || prod.limited_qty || prod.is_preorder);
            if (k.drop || k.dropAt || k.limited || k.pre || wasDrop) {
              await q(sb.rpc('set_product_drop', { p_product: id, p_drop_name: k.drop || null, p_drop_at: k.dropAt ? new Date(k.dropAt).toISOString() : null,
                p_limited: k.limited ? Number(k.limited) : null, p_preorder: !!k.pre }));
            }
            if (k.cost !== null && k.cost !== '' && Number(k.cost) !== Number(prod && prod.cost_price)) await q(sb.rpc('set_cost_price', { p_product: id, p_cost: Number(k.cost) }));
            if (k.fab && k.fab !== ((prod && prod.fabric_type) || 'cotton')) await q(sb.rpc('set_product_tax', { p_product: id, p_fabric_type: k.fab, p_hsn: null }));
          }
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
      ['production', 'Production tracker', 'Batches from blanks to ready stock'],
      ['hr', isPartner() ? 'Team & HR' : 'My attendance', isPartner() ? 'Attendance, leave, salary, HR rules' : 'Check in, leave, my salary'],
      ['coupons', 'Coupons & combos', 'Online and store codes, combo offers'],
      ['influencers', 'Influencers', 'Who promotes us and what it brings'],
      isPartner() && ['decisions', 'Partner voting', 'Big decisions, voted and recorded'],
      isPartner() && ['books', 'Books', 'Every rupee in and out'],
      isPartner() && ['partners', 'Partners', 'Each partner\'s investment and share'],
      isPartner() && ['close', 'Month close', 'Check the bank and lock the month'],
      isPartner() && ['log', 'Activity log', 'Who did what, when'],
      ['settings', 'Settings', 'Everything partners can change: shop, money, HR, targets, codes'],
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
    const P = isPartner();
    const rows = (state.settingRows || []).filter((r) => r.kind !== 'object' && !['custom_split', 'profit_rule', 'loss_rule'].includes(r.key));
    const groups = ['Business', 'Selling', 'Tax & GST', 'Money & approvals', 'Z-Club', 'Shop'];
    const show = (r) => {
      const v = r.value;
      if (r.kind === 'switch') return Number(v) ? 'On' : 'Off';
      if (['employee_petty_limit', 'all_partner_limit', 'shipping_fee', 'free_shipping_above', 'gst_threshold'].includes(r.key)) return inr(v);
      if (/_pct$|gst_rate/.test(r.key)) return `${v}%`;
      return v === '' || v === null ? '—' : String(v);
    };
    const hub = [['targets', 'Sales targets (day / week / month)'], ['costs', 'Cost sheet per tee'], ['fininputs', 'Finance inputs'], ['hr', 'HR rules & salary'],
      ['coupons', 'Coupons & combos'], ['influencers', 'Influencers'], ['partners', 'Profit / loss split'], ['changelog', 'Change log']];
    view.innerHTML = `${backBtn}
      <h1>Settings</h1>
      <p class="sub">${P ? 'Everything that can change lives here. Changes apply straight away, are logged with your name, and all partners get an alert. Rules marked <b>all partners</b> protect you from each other, so they go for approval.' : 'Partners change these.'}</p>
      ${P ? `<div class="hub">${hub.map(([k, l]) => `<button data-hub="${k}"><span>${esc(l)}</span><span class="go">›</span></button>`).join('')}</div>` : ''}
      ${groups.map((g) => { const list = rows.filter((r) => (r.grp || 'Shop') === g); return list.length ? `<h2>${esc(g)}</h2><div class="card">${list.map((r) => `
        <div class="set-row"><span>${esc(r.label)}${r.protected ? ' <span class="pill pending">all partners</span>' : ''}</span>
          <span><b>${esc(show(r))}</b>${P ? ` <button class="linkish" data-k="${esc(r.key)}">Change</button>` : ''}</span></div>`).join('')}</div>` : ''; }).join('')}
      <div id="codPins"></div>`;
    wireBack(view);
    codPins(view.querySelector('#codPins')).catch(() => {});
    view.querySelectorAll('[data-hub]').forEach((b) => {
      b.onclick = () => {
        const k = b.dataset.hub;
        if (k === 'partners') return splitDialog();
        go('more', k);
      };
    });
    view.querySelectorAll('[data-k]').forEach((b) => {
      b.onclick = async () => {
        const r = state.settingRows.find((x) => x.key === b.dataset.k);
        const field = r.kind === 'switch' ? { name: 'value', label: r.label, type: 'select', value: String(Number(r.value)), options: [['1', 'On'], ['0', 'Off']] }
          : { name: 'value', label: r.label, type: r.kind === 'number' ? 'number' : r.kind === 'time' ? 'time' : 'text', required: r.kind === 'number', value: r.value };
        const v = await ask({ title: r.label, html: r.protected ? `<p class="muted">This protects every partner, so all ${partners().length} must approve.</p>` : '<p class="muted">Applies straight away. Logged and all partners are told.</p>',
          fields: r.protected ? [field, { name: 'why', label: 'Why?', required: true }] : [field], ok: r.protected ? 'Send for approval' : 'Save' });
        if (!v) return;
        try {
          if (r.protected) {
            await q(sb.rpc('raise_request', { p_type: 'setting_change', p_amount: null, p_description: v.why, p_proof_path: null, p_payload: { key: r.key, value: num(v.value) } }));
            toast('Sent to partners for approval');
          } else {
            const val = r.kind === 'number' || r.kind === 'switch' ? num(v.value) : v.value;
            await q(sb.rpc('update_setting', { p_key: r.key, p_value: val }));
            toast('Saved'); VIEWS.settings(view);
          }
        } catch (e) { toast(errText(e), true); }
      };
    });
  };

  // ---------------- targets: day / week / month for the business and every person
  VIEWS.targets = async (view) => {
    const [rows, nowD, nowW, nowM] = await Promise.all([q(sb.from('standing_targets').select('*')), q(sb.rpc('target_now', { p_period: 'day' })), q(sb.rpc('target_now', { p_period: 'week' })), q(sb.rpc('target_now', { p_period: 'month' }))]);
    const people = [{ id: null, name: 'Whole business' }].concat(state.members.filter((m) => m.active).map((m) => ({ id: m.id, name: m.name })));
    const cur = (id, per) => rows.find((r) => (r.member_id || null) === id && r.period === per) || {};
    const prog = (id, per) => ({ day: nowD, week: nowW, month: nowM }[per].find((r) => (r.member_id || null) === id) || {});
    view.innerHTML = `${backBtn}
      <h1>Sales targets</h1>
      <p class="sub">Set pieces and ₹ for each person, per day, week (Mon–Sun) and month. They repeat until you change them. Sales count for the person chosen in "Sold by" on the bill.</p>
      ${people.map((p) => `<div class="card tgt-card"><b>${esc(p.name)}</b>
        <div class="tgt-grid"><span></span><span class="muted">Pieces</span><span class="muted">Sales ₹</span><span class="muted">Now</span>
        ${['day', 'week', 'month'].map((per) => { const c = cur(p.id, per); const g = prog(p.id, per); return `<span class="muted">${{ day: 'Daily', week: 'Weekly', month: 'Monthly' }[per]}</span>
          <input type="number" inputmode="numeric" min="0" data-t="${p.id || 'biz'}|${per}|pcs" value="${c.target_pcs || ''}" placeholder="0" ${isPartner() ? '' : 'disabled'}>
          <input type="number" inputmode="numeric" min="0" data-t="${p.id || 'biz'}|${per}|amt" value="${c.target_amount ? Number(c.target_amount) : ''}" placeholder="0" ${isPartner() ? '' : 'disabled'}>
          <span class="tgt-now">${g.pcs || 0} pcs<br><small>${esc(inr(g.amount || 0))}</small></span>`; }).join('')}</div></div>`).join('')}
      ${isPartner() ? '<button class="btn block" id="saveT">Save targets</button>' : ''}`;
    wireBack(view);
    const sv = view.querySelector('#saveT');
    if (sv) sv.onclick = async () => {
      sv.disabled = true;
      try {
        for (const p of people) for (const per of ['day', 'week', 'month']) {
          const pcs = Number(view.querySelector(`[data-t="${p.id || 'biz'}|${per}|pcs"]`).value) || 0;
          const amt = num(view.querySelector(`[data-t="${p.id || 'biz'}|${per}|amt"]`).value) || 0;
          const c = cur(p.id, per);
          if ((c.target_pcs || 0) !== pcs || Number(c.target_amount || 0) !== amt) await q(sb.rpc('set_standing_target', { p_member: p.id, p_period: per, p_pcs: pcs, p_amount: amt }));
        }
        C.confetti(0.5); toast('Targets saved'); VIEWS.targets(view);
      } catch (e) { sv.disabled = false; toast(errText(e), true); }
    };
  };

  // ---------------- cost sheet per tee (partners), feeds cost price + per-tee profit
  VIEWS.costs = async (view) => {
    await loadStock();
    const rows = await q(sb.from('product_costs').select('*'));
    const prods = [...new Map(state.stock.map((v) => [v.product_id, v])).values()].sort((a, b) => a.product_name.localeCompare(b.product_name));
    const F = [['blank', 'Blank tee'], ['dtf', 'DTF print'], ['printing', 'Pressing / printing'], ['packing', 'Packing'], ['tag_label', 'Tag & label'], ['other', 'Other'], ['shipping', 'Shipping (online, not in cost price)']];
    view.innerHTML = `${backBtn}
      <h1>Cost sheet</h1>
      <p class="sub">What one tee costs you. Saving updates the cost price used for profit per tee. Every change is logged.</p>
      ${prods.map((p) => { const c = rows.find((r) => r.product_id === p.product_id) || {}; const tot = F.slice(0, 6).reduce((t, [k]) => t + Number(c[k] || 0), 0);
        return `<div class="card"><div class="row"><b>${esc(p.product_name)}</b><span class="amt">${esc(inr(tot || p.cost_price || 0))}<small class="muted"> / tee</small></span></div>
          <div class="muted">Sells at ${esc(inr(p.price))} · margin ${Number(p.price) ? Math.round((1 - (tot || p.cost_price || 0) / (Number(p.price) / 1.05)) * 100) : 0}% after GST</div>
          <button class="btn small outline" data-cost="${p.product_id}" style="margin-top:8px">Edit costs</button></div>`; }).join('') || '<div class="empty">No products yet.</div>'}`;
    wireBack(view);
    view.querySelectorAll('[data-cost]').forEach((b) => {
      b.onclick = async () => {
        const pid = Number(b.dataset.cost); const c = rows.find((r) => r.product_id === pid) || {};
        const v = await ask({ title: `Cost of one ${productName(pid)}`, fields: F.map(([k, l]) => ({ name: k, label: `${l} (₹)`, type: 'number', value: c[k] ? Number(c[k]) : '' })).concat([{ name: 'notes', label: 'Notes', value: c.notes || '' }]), ok: 'Save' });
        if (!v) return;
        try { const cp = await q(sb.rpc('save_product_costs', { p_product: pid, p: Object.fromEntries(F.map(([k]) => [k, num(v[k]) || 0]).concat([['notes', v.notes || null]])) })); toast(`Cost price now ${inr(cp)}`); VIEWS.costs(view); } catch (e) { toast(errText(e), true); }
      };
    });
  };

  // ---------------- finance inputs (partners add / edit / remove; logged)
  const FIN_KIND = [['depreciation', 'Depreciation (equipment spread over months)'], ['overhead', 'Other running cost not in the books'], ['interest', 'Interest'], ['other_income', 'Other income'], ['tax_paid', 'Tax paid']];
  VIEWS.fininputs = async (view) => {
    const rows = await q(sb.from('finance_inputs').select('*').order('month', { ascending: false }).order('id', { ascending: false }));
    view.innerHTML = `${backBtn}
      <h1>Finance inputs</h1>
      <p class="sub">Numbers the books can't know, like depreciation of a heat press or a yearly cost split by month. They flow into EBITDA, EBIT, PBT and PAT. Any partner can add, edit or remove; every change is logged and everyone is told.</p>
      <button class="btn block" id="addFi" style="margin-bottom:12px">+ Add finance input</button>
      ${rows.length ? `<div class="card">${rows.map((r) => `<div class="set-row"><span>${esc(r.note)}<div class="muted">${esc(monthName(r.month))} · ${esc((FIN_KIND.find((k) => k[0] === r.kind) || [0, r.kind])[1])}</div></span>
        <span><b>${esc(inr(r.amount))}</b> <button class="linkish" data-fe="${r.id}">Edit</button> <button class="linkish" data-fd="${r.id}" style="color:var(--pink)">Remove</button></span></div>`).join('')}</div>` : '<div class="empty">Nothing added yet.</div>'}`;
    wireBack(view);
    const form = async (r = {}) => {
      const v = await ask({ title: r.id ? 'Edit finance input' : 'Add finance input', fields: [
        { name: 'kind', label: 'Type', type: 'select', value: r.kind || 'depreciation', options: FIN_KIND }, { name: 'month', label: 'Month', type: 'month', value: (r.month || monthKey()).slice(0, 7), required: true },
        { name: 'amount', label: 'Amount (₹)', type: 'number', value: r.amount || '', required: true }, { name: 'note', label: 'What is it?', value: r.note || '', required: true, placeholder: 'Heat press ₹36,000 ÷ 36 months' }], ok: 'Save' });
      if (!v) return;
      try { await q(sb.rpc('save_finance_input', { p: { id: r.id || null, kind: v.kind, month: `${v.month}-01`, amount: num(v.amount), note: v.note } })); toast('Saved'); VIEWS.fininputs(view); } catch (e) { toast(errText(e), true); }
    };
    view.querySelector('#addFi').onclick = () => form();
    view.querySelectorAll('[data-fe]').forEach((b) => { b.onclick = () => form(rows.find((r) => r.id === Number(b.dataset.fe))); });
    view.querySelectorAll('[data-fd]').forEach((b) => {
      b.onclick = async () => { const r = rows.find((x) => x.id === Number(b.dataset.fd)); if (!(await ask({ title: 'Remove this entry?', html: `<p class="muted">${esc(r.note)} · ${esc(inr(r.amount))}. The removal is logged.</p>`, ok: 'Remove', okClass: 'bad' }))) return;
        try { await q(sb.rpc('save_finance_input', { p: { id: r.id, note: r.note, delete: true } })); VIEWS.fininputs(view); } catch (e) { toast(errText(e), true); } };
    });
  };

  // ---------------- change log: every change to settings, costs, targets, finance inputs, coupons, products, salary
  VIEWS.changelog = async (view) => {
    const rows = await q(sb.from('change_log').select('*').order('id', { ascending: false }).limit(300));
    const T = { settings: 'Setting', product_costs: 'Cost sheet', standing_targets: 'Target', sales_targets: 'Monthly target', finance_inputs: 'Finance input', coupons: 'Coupon', bundles: 'Combo', products: 'Product', employee_pay: 'Salary', members: 'Team member' };
    const diff = (o, n) => {
      if (!o || !n) return '';
      return Object.keys(n).filter((k) => !['updated_at', 'updated_by'].includes(k) && JSON.stringify(o[k]) !== JSON.stringify(n[k]))
        .map((k) => `${esc(k.replace(/_/g, ' '))}: <s>${esc(typeof o[k] === 'object' ? JSON.stringify(o[k]) : o[k] ?? '—')}</s> → <b>${esc(typeof n[k] === 'object' ? JSON.stringify(n[k]) : n[k] ?? '—')}</b>`).join('<br>');
    };
    view.innerHTML = `${backBtn}
      <h1>Change log</h1>
      <p class="sub">Who changed what and when. Nobody, not even a partner, can edit or delete this list.</p>
      ${rows.map((r) => `<div class="card"><div class="row"><b>${esc(T[r.table_name] || r.table_name)} ${r.action === 'INSERT' ? 'added' : r.action === 'DELETE' ? 'removed' : 'changed'}${r.table_name === 'settings' ? ` · ${esc(r.row_ref)}` : ''}</b><span class="muted">${esc(ago(r.at))}</span></div>
        <div class="muted">${esc(r.actor_name)} · ${esc(when(r.at))}</div>
        ${r.action === 'UPDATE' ? `<div style="margin-top:6px;font-size:13px">${diff(r.old_data, r.new_data) || '—'}</div>` : ''}</div>`).join('') || '<div class="empty">No changes yet.</div>'}`;
    wireBack(view);
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
    if (r.type === 'stock_writeoff') return `${esc(variantLabel(p.variant_id))} · <b>${esc(p.qty)} piece(s)</b>${p.influencer_id ? ' · gift to influencer' : ''}`;
    if (r.type === 'expense' && p.category) return `${esc((EXP_CAT.find((c) => c[0] === p.category) || [0, p.category])[1])}${p.campaign ? ` · campaign <b>${esc(p.campaign)}</b>` : ''}`;
    if (r.type === 'discount') return `<b>${esc(p.pct)}% off</b> on ${esc(p.pieces)} tees${p.used_order ? ` · used on ${esc(p.used_order)}` : ''}`;
    if (r.type === 'salary_change') return `${esc(memberName(p.member_id))} → <b>${esc(inr(p.salary))}</b> / month`;
    if (r.type === 'hr_policy') return Object.entries(p.policy || {}).map(([k, v]) => `${esc(HR_LABEL[k] || k)}: <b>${esc(v ?? '—')}</b>`).join('<br>');
    if (r.type === 'decision') return `${p.rule === 'majority' ? `Majority (${Math.floor(partners().length / 2) + 1} of ${partners().length})` : `All ${partners().length} partners`}${p.details ? `<br>${esc(p.details)}` : ''}`;
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
    if (!state.newCat) state.newCat = 'production';
    if (state.newCat === 'influencer') state.influencers = await q(sb.from('influencers').select('id,name,handle').eq('active', true).order('name'));
    const needsPartner = ['capital_in', 'partner_payout'].includes(type);
    const proofReq = ['expense', 'capital_in', 'partner_payout'].includes(type);
    view.innerHTML = `${backBtn}
      <h1>${isPartner() ? 'New money entry' : 'Expenses'}</h1>
      <form id="newForm" class="card">
        <label for="type" style="margin-top:0">What is this?</label>
        <select id="type">${types.map((t) => `<option value="${t}" ${t === type ? 'selected' : ''}>${TYPE[t]}</option>`).join('')}</select>
        ${needsPartner ? `<label for="partner">Which partner?</label><select id="partner" required><option value="">Choose…</option>${partners().map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select>` : ''}
        ${type === 'expense' ? `<label for="cat">Category</label><select id="cat">${EXP_CAT.map(([k, l]) => `<option value="${k}" ${state.newCat === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
          ${state.newCat === 'ads' ? '<label for="camp">Campaign name</label><input id="camp" placeholder="e.g. diwali (use the same word in the shop link: ?utm_campaign=diwali)">' : ''}
          ${state.newCat === 'influencer' ? `<label for="inf">Which influencer?</label><select id="inf"><option value="">—</option>${(state.influencers || []).map((i) => `<option value="${i.id}">${esc(i.name)}${i.handle ? ` (${esc(i.handle)})` : ''}</option>`).join('')}</select>` : ''}` : ''}
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
    if (view.querySelector('#cat')) view.querySelector('#cat').onchange = (e) => { state.newCat = e.target.value; VIEWS.requests(view); };
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
          p_proof_path: proofPath, p_payload: needsPartner ? { partner_id: view.querySelector('#partner').value }
            : type === 'expense' ? { category: state.newCat, campaign: view.querySelector('#camp') ? view.querySelector('#camp').value.trim().toLowerCase() || null : null,
              influencer_id: view.querySelector('#inf') && view.querySelector('#inf').value ? Number(view.querySelector('#inf').value) : null } : {},
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

  // ================================================================ PHASE 3 · helpers
  const HR_LABEL = {
    shift_start: 'Shift starts', shift_end: 'Shift ends', grace_min: 'Grace (minutes late allowed)', lates_per_half_day: 'Late marks = half day',
    weekly_off: 'Weekly off', paid_leaves_per_month: 'Paid leaves per month', ot_after: 'Overtime after', ot_multiplier: 'Overtime pay × day rate',
    office_lat: 'Store latitude', office_lng: 'Store longitude', office_radius_m: 'Attendance radius (metres)',
    lunch_min: 'Lunch break (minutes)', half_day_allowed: 'Half day allowed',
  };
  const monthKey = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7) + '-01';
  const shortMonth = (s) => new Date(`${s}T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });

  async function uploadProof(file, folder) {
    if (!file) throw new Error('Add the photo first.');
    if (file.size > 10 * 1024 * 1024) throw new Error('Photo is larger than 10 MB.');
    const path = `${state.session.user.id}/${folder}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-40)}`;
    const { error } = await sb.storage.from('proofs').upload(path, file, { upsert: false });
    if (error) throw error;
    return path;
  }
  function loadScript(src) {
    return new Promise((res, rej) => {
      if (document.querySelector(`script[src="${src}"]`)) return res();
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load a helper. Check the internet.'));
      document.head.appendChild(s);
    });
  }
  const b64ToBytes = (s) => {
    const raw = atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  };
  // Phone alerts even when the app is closed (installed web app on Android / iPhone home screen)
  async function enableTeamPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      throw new Error(/iPhone|iPad/.test(navigator.userAgent) ? 'On iPhone: Share → Add to Home Screen, open the app from there, then try again.' : 'This browser cannot do phone alerts.');
    }
    if ((await Notification.requestPermission()) !== 'granted') throw new Error('Alerts are blocked. Allow notifications for this site in browser settings.');
    const reg = await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const { key } = await (await fetch(`${cfg.SUPABASE_URL}/functions/v1/push?key=1`)).json().catch(() => ({}));
      if (!key) throw new Error('Phone alerts are not switched on in the server yet.');
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
    }
    const j = sub.toJSON();
    await q(sb.rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth }));
    store.set('zs_team_push', true);
  }

  // QR price tags: name, colour/size, price and a QR of the SKU. Scan it in Sell to bill in one tap.
  async function printTags(list) {
    if (!list.length) return toast('Nothing in stock to tag', true);
    if (NATIVE) return toast('Print tags from the team web app on a laptop (More → Open the shop → /admin).', true);
    const w = window.open('', '_blank');
    if (!w) return toast('Allow pop-ups to print', true);
    w.document.write('<p style="font-family:sans-serif">Making tags…</p>');
    try { await loadScript('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js'); } catch (e) { w.close(); return toast(errText(e), true); }
    const qr = (txt) => { const g = window.qrcode(0, 'M'); g.addData(txt); g.make(); return g.createSvgTag({ cellSize: 3, margin: 0, scalable: true }); };
    const tags = list.flatMap(({ v, n }) => Array.from({ length: n }, () => `
      <div class="t"><div class="b">Z-SHIRTS</div><div class="n">${esc(v.product_name)}</div><div class="s">${esc(v.colour)} · <b>${esc(v.size)}</b></div>
        <div class="q">${qr(v.sku)}</div><div class="p">${esc(inr(v.price))}${Number(v.mrp) > Number(v.price) ? ` <s>${esc(inr(v.mrp))}</s>` : ''}</div><div class="k">${esc(v.sku)}</div></div>`)).join('');
    w.document.open();
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Z-SHIRTS tags</title><style>
      @page{margin:8mm}body{margin:0;font-family:system-ui,sans-serif;color:#000}.g{display:flex;flex-wrap:wrap;gap:4mm}
      .t{width:38mm;height:62mm;border:1px dashed #999;border-radius:3mm;padding:3mm;box-sizing:border-box;text-align:center;page-break-inside:avoid;display:flex;flex-direction:column;gap:1mm}
      .b{font-weight:900;letter-spacing:.5px;font-size:11px}.n{font-size:9px;line-height:1.15;height:21px;overflow:hidden}.s{font-size:10px}.q svg{width:24mm;height:24mm}
      .p{font-weight:800;font-size:14px}.p s{font-weight:400;font-size:9px;color:#555}.k{font-size:7px;color:#555}</style></head>
      <body><div class="g">${tags}</div><script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`);
    w.document.close();
  }

  // Camera scanner for QR tags. Keeps scanning so Mahendra can scan a pile of tees one after another.
  async function scanTag(onCode) {
    let stream = null, stop = false, last = '', lastAt = 0;
    const body = panel(`<h1 style="margin-top:14px">Scan tag</h1>
      <p class="sub">Point the camera at the QR on the tag. Each scan adds one piece.</p>
      <div class="scan-box"><video id="scanV" playsinline muted></video><div class="scan-frame"></div></div>
      <label for="scanIn">Or type the code under the QR</label>
      <div class="row2" style="grid-template-columns:1fr auto"><input id="scanIn" placeholder="ZS-12-BLA-L" style="text-transform:uppercase"><button class="btn" id="scanAdd">Add</button></div>
      <button class="btn outline block" id="scanDone" style="margin-top:16px">Done</button>`);
    const done = () => { stop = true; if (stream) stream.getTracks().forEach((t) => t.stop()); closePanel(); };
    body.querySelector('#scanDone').onclick = done;
    panelEl.scrim.onclick = done;
    panelEl.p.querySelector('.panel-close').onclick = done;
    body.querySelector('#scanAdd').onclick = () => { const v = body.querySelector('#scanIn').value.trim().toUpperCase(); if (v) { onCode(v); body.querySelector('#scanIn').value = ''; } };
    const hit = (code) => {
      if (!code || (code === last && Date.now() - lastAt < 1500)) return;
      last = code; lastAt = Date.now();
      if (navigator.vibrate) navigator.vibrate(60);
      onCode(code.trim().toUpperCase());
    };
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    } catch (_) { toast('Camera not allowed. Type the code instead.', true); return; }
    const video = body.querySelector('#scanV');
    video.srcObject = stream;
    await video.play().catch(() => {});
    let detector = null;
    if ('BarcodeDetector' in window) { try { detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch (_) { detector = null; } }
    if (!detector) { try { await loadScript('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'); } catch (e) { toast(errText(e), true); } }
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const tick = async () => {
      if (stop || !document.body.contains(video)) return;
      try {
        if (video.readyState >= 2) {
          if (detector) {
            const codes = await detector.detect(video);
            if (codes[0]) hit(codes[0].rawValue);
          } else if (window.jsQR) {
            canvas.width = video.videoWidth; canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const r = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
            if (r) hit(r.data);
          }
        }
      } catch (_) { /* keep scanning */ }
      setTimeout(tick, 180);
    };
    tick();
  }

  function printDoc(title, html) {
    if (NATIVE) {
      // no printer in the phone app: share the text instead
      const txt = html.replace(/<br\s*\/?>/g, '\n').replace(/<\/(tr|div|h1|h2|p)>/g, '\n').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n');
      return openExternal(`https://wa.me/?text=${encodeURIComponent(`${title}\n${txt}`.slice(0, 3500))}`);
    }
    const w = window.open('', '_blank');
    if (!w) return toast('Allow pop-ups to print', true);
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
      body{font-family:system-ui,sans-serif;color:#000;margin:28px;font-size:13px}h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 8px;border-bottom:2px solid #000;padding-bottom:4px}
      table{width:100%;border-collapse:collapse}td,th{padding:6px 4px;border-bottom:1px solid #ddd;text-align:left}td.r,th.r{text-align:right}.big{font-size:20px;font-weight:800}
      .kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.kpi{border:1px solid #ccc;border-radius:8px;padding:10px}.kpi b{display:block;font-size:18px}.muted{color:#666}
      .sig{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:40px}.sig div{border-top:1px solid #000;padding-top:6px;font-size:11px}</style></head>
      <body>${html}<script>window.onload=()=>window.print()<\/script></body></html>`);
    w.document.close();
  }




  // ---------------- what's in demand: best sellers of the week / 15 days / month, by tee, category, colour, size
  async function demandCard(root) {
    const st = state.demand || (state.demand = { days: 7, by: 'products' });
    root.innerHTML = '<div class="card"><div class="muted">Loading best sellers…</div></div>';
    let d;
    try { d = await q(sb.rpc('demand_report', { p_days: st.days })); } catch (e) { root.innerHTML = ''; return; }
    const list = d[st.by] || [];
    const top = list[0];
    const maxU = Math.max(1, ...list.map((x) => Number(x.units)));
    const label = { 7: 'this week', 15: 'last 15 days', 30: 'this month' }[st.days];
    root.innerHTML = `<div class="card demand">
      <div class="seg" style="margin-bottom:8px">${[[7, 'Week'], [15, '15 days'], [30, 'Month']].map(([k, l]) => `<button data-dd="${k}" class="${st.days === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="seg">${[['products', 'Tee'], ['categories', 'Category'], ['colours', 'Colour'], ['sizes', 'Size']].map(([k, l]) => `<button data-db="${k}" class="${st.by === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${top ? `<div class="crown"><span class="crown-ic">👑</span><div><div class="muted">Best seller ${label}</div>
          <b>${esc(top.name)}${st.by === 'products' && top.category ? ` <small class="muted">· ${esc(top.category)}</small>` : ''}</b>
          <div class="muted">${top.units} pcs${top.revenue ? ` · ${esc(inr(top.revenue))}` : ''}${st.by === 'products' && top.by_colour && top.by_colour[0] ? ` · mostly ${esc(top.by_colour[0].c)}` : ''}</div></div></div>
        <div class="hbars" style="margin-top:12px">${list.slice(0, 8).map((x, i) => `<div class="hbar"><span class="l">${i + 1}. ${st.by === 'colours' ? `<span class="dot-c" style="background:${esc(x.hex || '#888')}"></span>` : ''}${esc(x.name)}</span>
          <span class="b"><i style="width:${(x.units / maxU) * 100}%"></i></span><span class="v">${x.units} pcs</span></div>`).join('')}</div>
        ${st.by === 'products' ? list.filter((x) => Number(x.stock_left) <= (num(state.settings.low_stock_alert) || 5) && Number(x.units) > 0).slice(0, 3)
          .map((x) => `<div class="hot">🔥 <b>${esc(x.name)}</b> is selling fast: ${x.units} sold, only ${x.stock_left} left. Plan the next batch.</div>`).join('') : ''}`
        : `<div class="empty" style="padding:16px 0">No sales ${label} yet.</div>`}
      ${d.wanted && d.wanted.length ? `<div class="wanted"><b>Customers waiting for a restock</b>${d.wanted.slice(0, 5).map((w) => `<div class="row"><span>${esc(w.name)} · ${esc(w.colour)} / ${esc(w.size)}</span><b>${w.n} 🔔</b></div>`).join('')}</div>` : ''}
    </div>`;
    root.querySelectorAll('[data-dd]').forEach((b) => { b.onclick = () => { st.days = Number(b.dataset.dd); demandCard(root); }; });
    root.querySelectorAll('[data-db]').forEach((b) => { b.onclick = () => { st.by = b.dataset.db; demandCard(root); }; });
  }

  // ---------------- first login: a personal welcome for each partner and for Mahendra
  async function showWelcome() {
    const w = await q(sb.rpc('my_welcome'));
    if (!w || w.welcomed_at) return;
    const first = (w.name || '').split(' ')[0];
    const others = (w.partners || []).filter((n) => n !== w.name).map((n) => n.split(' ')[0]);
    const list = (a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}` : a[0] || '');
    let opts;
    if (w.role === 'partner') {
      const share = Number(w.total_capital) ? Math.round((Number(w.capital) / Number(w.total_capital)) * 100) : null;
      opts = {
        kicker: `Partner ${w.partner_no || ''} of ${(w.partners || []).length} · welcome to`,
        name: `Hey ${first}, welcome aboard.`,
        lines: [
          `You, ${list(others)} built this together. Every order, every rupee and every decision lives here, open to all four of you.`,
          'Nothing big moves without your OK: payouts, big expenses, price changes and stock write-offs wait for the partners to approve.',
          `${w.employee ? `${w.employee.split(' ')[0]} runs the store day to day. ` : ''}You'll get a buzz for every order, sale, dispatch and milestone.`,
          'Big fits. Zero apologies. Let’s make it big.',
        ],
        chips: [[Number(w.capital) ? inr(w.capital) : '—', 'you invested'], [share !== null ? `${share}%` : '—', 'of the capital'], [String(w.products || 0), 'tees live'], [String(w.orders || 0), 'orders so far']],
        button: "Let's go",
      };
    } else {
      const sh = w.shift || {};
      opts = {
        kicker: 'Welcome to the team',
        name: `Welcome, ${first}!`,
        lines: [
          `You run the Z-SHIRTS store: sales, stock, production and the cash counter. The partners trust you with all of it.`,
          `Your day: ${sh.shift_start || '10:00'} to ${sh.shift_end || '21:00'} with a ${sh.lunch_min || 30}-minute lunch. Punch in with a selfie on the Home screen.`,
          'Tap the big + to bill any sale in seconds. Pick who sold it, add a coupon, done.',
          'Every sale you make shows on the leaderboard. Go top it!',
        ],
        chips: [[String(w.products || 0), 'tees to sell'], [String(w.orders || 0), 'orders so far']],
        button: 'Start my day',
      };
    }
    await C.welcome(opts);
    await q(sb.rpc('mark_welcomed')).catch(() => {});
  }

  // ---------------- attendance punch card (Home + HR): check in → lunch → back → check out
  function punchHtml(a, pol) {
    const step = !a ? 'in' : a.out_at ? 'done' : !a.lunch_out_at ? 'lunch_or_out' : !a.lunch_in_at ? 'lunch_in' : 'out';
    const lunchMins = a && a.lunch_out_at && !a.lunch_in_at ? Math.floor((Date.now() - new Date(a.lunch_out_at)) / 6e4) : null;
    const cell = (k, v, extra = '') => `<div class="stat"><div class="k">${k}</div><div class="v" style="font-size:16px">${esc(v)}</div>${extra}</div>`;
    return `<div class="card punch-card">
      <div class="row"><b>Today · ${esc(new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }))}</b><span class="muted">Shift ${esc(pol.shift_start)}–${esc(pol.shift_end)} · lunch ${esc(pol.lunch_min || 30)} min</span></div>
      <div class="punch-grid">
        ${cell('In', timeOf(a && a.in_at), a && a.late_min ? `<div class="neg" style="font-size:11px">${a.late_min} min late</div>` : '')}
        ${cell('Lunch', timeOf(a && a.lunch_out_at))}
        ${cell('Back', timeOf(a && a.lunch_in_at), a && a.lunch_over_min ? `<div class="neg" style="font-size:11px">${a.lunch_over_min} min over</div>` : '')}
        ${cell('Out', timeOf(a && a.out_at))}
      </div>
      ${step === 'in' ? '<label class="btn block punch-btn" for="selfie">Check in · take selfie</label>' : ''}
      ${step === 'lunch_or_out' ? '<div class="actions"><button class="btn cyan" data-punch="lunch_out">Start lunch</button><label class="btn outline punch-btn" for="selfie">Check out · selfie</label></div>' : ''}
      ${step === 'lunch_in' ? `<button class="btn block ${lunchMins > (pol.lunch_min || 30) ? 'bad' : 'cyan'}" data-punch="lunch_in" style="margin-top:12px">Back from lunch · ${lunchMins} min</button>` : ''}
      ${step === 'out' ? '<label class="btn block outline punch-btn" for="selfie">Check out · take selfie</label>' : ''}
      ${step === 'done' ? '<div class="all-clear" style="margin-top:12px"><b>Done for today ✓</b>See you tomorrow.</div>' : '<input id="selfie" type="file" accept="image/*" capture="user" hidden>'}
    </div>`;
  }
  function wirePunch(root, a, reload) {
    const selfie = root.querySelector('#selfie');
    if (selfie) selfie.onchange = async () => {
      const file = selfie.files[0];
      if (!file) return;
      toast('Saving attendance…');
      try {
        const [path, loc] = await Promise.all([uploadProof(file, 'hr'), locate()]);
        const r = await q(sb.rpc('punch', { p_kind: a ? 'out' : 'in', p_photo: path, p_lat: loc && loc.lat, p_lng: loc && loc.lng }));
        if (!a) { if (r.late_min) toast(`Checked in · ${r.late_min} min late`); else { C.confetti(0.4); toast('Checked in on time. Have a great day!'); } } else toast('Checked out. Good work today!');
        reload();
      } catch (e) { toast(errText(e), true); }
    };
    root.querySelectorAll('[data-punch]').forEach((b) => {
      b.onclick = async () => {
        try {
          const loc = await locate();
          await q(sb.rpc('punch', { p_kind: b.dataset.punch, p_photo: null, p_lat: loc && loc.lat, p_lng: loc && loc.lng }));
          toast(b.dataset.punch === 'lunch_out' ? 'Enjoy your lunch' : 'Welcome back');
          reload();
        } catch (e) { toast(errText(e), true); }
      };
    });
  }

  // ================================================================ DAILY CASH CLOSE
  VIEWS.cash = async (view) => {
    const P = isPartner();
    const [pv, rows, moves, held] = await Promise.all([
      q(sb.rpc('cash_day_preview', { p_day: null })),
      P ? q(sb.from('cash_closes').select('*').order('day', { ascending: false }).limit(31)) : Promise.resolve([]),
      q(sb.from('cash_moves').select('*').eq('kind', 'handover').order('id', { ascending: false }).limit(60)),
      P ? q(sb.from('cash_with_partners').select('*')) : Promise.resolve([]),
    ]);
    const today = moves.filter((m) => m.day === pv.day);
    const handRow = (m) => `<div class="row" style="padding:7px 0;border-bottom:1px solid var(--line)">
        <span><b>${esc(memberName(m.taken_by))}</b> took cash${m.reason && m.reason.includes(' · ') ? ` · ${esc(m.reason.split(' · ').slice(1).join(' · '))}` : ''}
        <div class="muted">${esc(day(m.day))} ${esc(timeOf(m.created_at))} · recorded by ${esc(memberName(m.by_member))}${m.photo_path ? ` · <button class="linkish" data-ph="${esc(m.photo_path)}">photo</button>` : ''}</div></span>
        <b class="neg">${esc(inr(m.amount))}</b></div>`;
    view.innerHTML = `${backBtn}
      <h1>Store cash</h1>
      <p class="sub">Cash comes in only from sales. It leaves only when a partner collects it, and every handover is recorded with that partner's name.${P ? '' : ' Only partners see the drawer amount.'}</p>
      ${P ? `<div class="card cash-hero">
        <div class="k">Cash at the store right now</div>
        <div class="v">${esc(inr(pv.expected))}</div>
        <div class="cash-flow"><span>Opening ${esc(inr(pv.opening))}</span><span class="pos">+ cash sales ${esc(inr(pv.cash_sales))}</span>
          <span class="neg">− handed to partners ${esc(inr(pv.handed_over))}</span>${Number(pv.cash_refunds) ? `<span class="neg">− cash refunds ${esc(inr(pv.cash_refunds))}</span>` : ''}</div>
        ${pv.closed ? '<div class="all-clear" style="margin-top:12px"><b>Today is closed ✓</b></div>' : '<button class="btn block" data-hand style="margin-top:14px">I collected cash from the store</button>'}
      </div>
      <h2>Cash each partner has collected</h2>
      <div class="card">${held.map((h) => `<div class="row" style="padding:6px 0"><span>${esc(h.name)}<div class="muted">${h.handovers} handover${h.handovers === 1 ? '' : 's'}${h.last_at ? ` · last ${esc(ago(h.last_at))}` : ''}</div></span><b>${esc(inr(h.collected))}</b></div>`).join('')}
        <div class="hint">This cash belongs to the business. Deposit it in the bank or use it for approved expenses.</div></div>`
      : `<div class="card cash-hero">${pv.closed ? '<div class="all-clear"><b>Today is closed ✓</b>See you tomorrow.</div>'
        : '<b>Handing cash to a partner?</b><div class="muted" style="margin-top:4px">Record it right away, with the partner\'s name and the amount.</div><button class="btn block" data-hand style="margin-top:14px">Hand over cash to a partner</button>'}</div>`}
      ${today.length ? `<h2>Today's handovers</h2><div class="card">${today.map(handRow).join('')}</div>` : ''}
      ${pv.closed ? '' : `<h2>Close the day</h2>
      <form class="card" id="ccForm">
        <label for="ccCount" style="margin-top:0">Cash you counted in the drawer</label><input id="ccCount" type="number" inputmode="decimal" required>
        <label for="ccPhoto">Photo of the counted cash</label><input id="ccPhoto" type="file" accept="image/*" capture="environment" required>
        <label for="ccNote">Note (optional)</label><input id="ccNote">
        <div class="hint" id="ccDiff">${P ? '' : 'Count carefully. Partners compare it with the sales.'}</div>
        <button class="btn block" type="submit" id="ccBtn">Close today</button>
      </form>`}
      ${moves.length > today.length ? `<h2>Earlier handovers</h2><div class="card">${moves.filter((m) => m.day !== pv.day).slice(0, 30).map(handRow).join('')}</div>` : ''}
      ${P ? `<h2>Daily closes</h2>
      ${rows.length ? `<div class="card table-wrap"><table><thead><tr><th>Day</th><th class="r">Expected</th><th class="r">Counted</th><th class="r">Diff</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td>${esc(day(r.day))}<div class="muted">${esc(memberName(r.by_member))} · sales ${esc(inr(r.cash_sales))} · handed ${esc(inr(r.cash_out))}</div></td><td class="r">${esc(inr(r.expected))}</td><td class="r">${esc(inr(r.counted))}</td>
          <td class="r">${Number(r.difference) ? signed(r.difference) : '<span class="pos">✓</span>'} <button class="linkish" data-ph="${esc(r.photo_path)}">photo</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No closes yet.</div>'}` : ''}`;
    wireBack(view);
    view.querySelectorAll('[data-ph]').forEach((b) => { b.onclick = () => showProof(b.dataset.ph); });
    view.querySelectorAll('[data-hand]').forEach((b) => { b.onclick = () => cashHandover(() => VIEWS.cash(view)); });
    const f = view.querySelector('#ccForm');
    if (!f) return;
    if (P) view.querySelector('#ccCount').oninput = (e) => {
      const d = num(e.target.value) === null ? null : num(e.target.value) - num(pv.expected);
      view.querySelector('#ccDiff').innerHTML = d === null ? '' : d === 0 ? '<b class="pos">Matches exactly.</b>' : `<b class="neg">${d < 0 ? 'Short' : 'Extra'} by ${esc(inr(Math.abs(d)))}</b>`;
    };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const btn = view.querySelector('#ccBtn'); btn.disabled = true; btn.textContent = 'Saving…';
      try {
        const path = await uploadProof(view.querySelector('#ccPhoto').files[0], 'cash');
        const r = await q(sb.rpc('close_cash_day', { p_counted: num(view.querySelector('#ccCount').value), p_cash_out: 0, p_note: view.querySelector('#ccNote').value || null, p_photo: path, p_day: null }));
        if (P) toast(Number(r.difference) === 0 ? 'Cash matches. Day closed.' : 'Day closed. Partners were told about the difference.');
        else { C.confetti(0.4); toast('Day closed. Thank you!'); }
        VIEWS.cash(view);
      } catch (err) { btn.disabled = false; btn.textContent = 'Close today'; toast(errText(err), true); }
    };
  };

  // Cash leaves the store only as a handover to a named partner
  function cashHandover(done) {
    const P = isPartner();
    const body = panel(`<h1 style="margin-top:14px">${P ? 'I collected cash' : 'Hand over cash'}</h1>
      ${P ? `<p class="sub">Recorded in your name: <b>${esc(state.me.name)}</b>. All partners are told.</p>`
        : `<label>Which partner took the cash?</label><div class="chipset" id="hoWho">${partners().map((m) => `<button data-who="${m.id}">${esc(m.name)}</button>`).join('')}</div>`}
      <label for="hoAmt">Amount (₹)</label><input id="hoAmt" type="number" inputmode="decimal" required>
      <label for="hoNote">Note (optional)</label><input id="hoNote" placeholder="e.g. weekly collection, to deposit in bank">
      <label for="hoPhoto">Photo (optional: partner with the cash / counted notes)</label><input id="hoPhoto" type="file" accept="image/*" capture="environment">
      <button class="btn block" id="hoGo" style="margin-top:16px">Record handover</button>`);
    let who = P ? state.me.id : null;
    body.querySelectorAll('[data-who]').forEach((b) => { b.onclick = () => { who = b.dataset.who; body.querySelectorAll('[data-who]').forEach((x) => x.classList.toggle('on', x === b)); }; });
    body.querySelector('#hoGo').onclick = async (e) => {
      if (!who) return toast('Choose the partner who took the cash', true);
      const btn = e.currentTarget; btn.disabled = true;
      try {
        const file = body.querySelector('#hoPhoto').files[0];
        const path = file ? await uploadProof(file, 'cash') : null;
        const r = await q(sb.rpc('cash_handover', { p_amount: num(body.querySelector('#hoAmt').value), p_taken_by: who, p_note: body.querySelector('#hoNote').value || null, p_photo: path }));
        closePanel(); toast(`${inr(r.amount)} handed to ${r.taken_by} · recorded`); done();
      } catch (err) { btn.disabled = false; toast(errText(err), true); }
    };
  }

  // ================================================================ SALES (today's sales, online + offline)
  VIEWS.sales = async (view) => {
    const range = state.salesRange || 'today';
    const from = range === 'today' ? todayKey() : range === 'yesterday' ? new Date(Date.now() - 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
      : new Date(Date.now() - 6 * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const to = range === 'yesterday' ? todayKey() : null;
    let qy = sb.from('order_board').select('*').gte('created_at', istStart(from)).neq('status', 'cancelled').order('created_at', { ascending: false });
    if (to) qy = qy.lt('created_at', istStart(to));
    const rows = (await q(qy)).filter((o) => !(o.payment_method === 'online' && o.payment_status !== 'paid'));
    const off = rows.filter((o) => IN_PERSON.includes(o.channel)), on = rows.filter((o) => !IN_PERSON.includes(o.channel));
    const sum = (a) => a.reduce((t, o) => t + Number(o.total) - Number(o.shipping), 0);
    const pcs = (a) => a.reduce((t, o) => t + Number(o.pieces), 0);
    const by = (key, label) => {
      const m = {};
      rows.forEach((o) => { const k = label(o); m[k] = m[k] || { n: 0, v: 0, p: 0 }; m[k].n++; m[k].v += Number(o.total) - Number(o.shipping); m[k].p += Number(o.pieces); });
      const list = Object.entries(m).sort((a, b) => b[1].v - a[1].v);
      const mx = Math.max(1, ...list.map((x) => x[1].v));
      return list.length ? `<div class="card hbars">${list.map(([k, r]) => `<div class="hbar"><span class="l">${esc(k)}</span><span class="b"><i style="width:${(r.v / mx) * 100}%"></i></span><span class="v">${esc(inr(r.v))} · ${r.p}</span></div>`).join('')}</div>` : '';
    };
    const payMix = (a, m) => sum(a.filter((o) => o.payment_method === m));
    view.innerHTML = `
      <div class="row" style="align-items:center"><h1>Sales</h1><button class="btn small" id="newBill">+ New bill</button></div>
      <div class="seg">${[['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'Last 7 days']].map(([k, l]) => `<button data-r="${k}" class="${range === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="grid">
        <div class="stat hero"><div class="k">Total sales</div><div class="v">${esc(inr(sum(rows)))}</div><div class="muted">${rows.length} bills · ${pcs(rows)} pieces</div></div>
        <div class="stat"><div class="k">🏪 Offline (store, events, stalls)</div><div class="v">${esc(inr(sum(off)))}</div><div class="muted">${off.length} bills · ${pcs(off)} pcs</div></div>
        <div class="stat"><div class="k">🌐 Online (web, app, DMs)</div><div class="v">${esc(inr(sum(on)))}</div><div class="muted">${on.length} orders · ${pcs(on)} pcs</div></div>
      </div>
      ${off.length ? `<div class="cash-flow" style="margin:8px 0 0">Offline paid by: <span>Cash ${esc(inr(payMix(off, 'cash')))}</span><span>UPI ${esc(inr(payMix(off, 'upi')))}</span></div>` : ''}
      ${on.length ? `<div class="cash-flow" style="margin:4px 0 0">Online: <span>Prepaid ${esc(inr(sum(on.filter((o) => o.payment_status === 'paid'))))}</span><span>COD to collect ${esc(inr(sum(on.filter((o) => o.payment_status !== 'paid'))))}</span></div>` : ''}
      <h2>By channel</h2>${by('channel', (o) => CHANNEL[o.channel] || o.channel) || '<div class="empty">No sales yet.</div>'}
      <h2>By person</h2>${by('person', (o) => soldByName(o) || 'Website (no one)')}
      <h2>Bills</h2>${rows.length ? rows.map(orderCard).join('') : '<div class="empty">No sales yet. Tap + New bill.</div>'}`;
    view.querySelector('#newBill').onclick = () => go('sell');
    view.querySelectorAll('[data-r]').forEach((b) => { b.onclick = () => { state.salesRange = b.dataset.r; VIEWS.sales(view); }; });
    view.querySelectorAll('.order').forEach((c) => { c.onclick = (e) => { if (!e.target.closest('[data-next]')) openOrder(Number(c.dataset.id), rows); }; });
    view.querySelectorAll('[data-next]').forEach((b) => { b.onclick = async () => { if (await advance(rows.find((x) => x.id === Number(b.dataset.next)))) VIEWS.sales(view); }; });
  };

  // ================================================================ STORE (day register, cash, petty cash, stock at a glance)
  VIEWS.store = async (view) => {
    const P = isPartner();
    const emp = state.me.role === 'employee';
    const [reg, pol, att, petty, myPetty] = await Promise.all([
      q(sb.rpc('store_register', { p_days: 14 })).catch(() => []),
      emp ? q(sb.rpc('hr_policy')).catch(() => null) : Promise.resolve(null),
      emp ? q(sb.from('attendance').select('*').eq('member_id', state.me.id).eq('day', todayKey())).catch(() => []) : Promise.resolve([]),
      q(sb.from('petty_board').select('*')).catch(() => []),
      q(sb.from('petty_moves').select('*').order('id', { ascending: false }).limit(20)).catch(() => []),
    ]);
    await loadStock();
    const today = reg.find((r) => r.day === todayKey()) || {};
    const pieces = state.stock.filter((v) => v.active).reduce((t, v) => t + Math.max(0, v.stock), 0);
    const lim = num(state.settings.low_stock_alert) || 5;
    const low = state.stock.filter((v) => v.active && v.published && v.stock <= lim && !v.is_preorder).length;
    const myBal = (petty.find((x) => x.holder === state.me.id) || {}).balance;
    view.innerHTML = `
      <h1>Store</h1>
      ${emp && pol ? `<div id="punchBox">${punchHtml(att[0], pol)}</div>` : ''}
      <div class="card store-day">
        <div class="row"><b>Store hours · ${esc(new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }))}</b>
          <span class="pill ${today.closed_at ? 'approved' : today.opened_at ? 'pending' : 'cancelled'}">${today.closed_at ? 'Closed' : today.opened_at ? 'Open' : 'Not opened'}</span></div>
        <div class="punch-grid" style="grid-template-columns:1fr 1fr">
          <div class="stat"><div class="k">Opened</div><div class="v" style="font-size:16px">${esc(timeOf(today.opened_at))}</div><div class="muted" style="font-size:11px">${esc(today.opened_by || '')}</div></div>
          <div class="stat"><div class="k">Closed</div><div class="v" style="font-size:16px">${esc(timeOf(today.closed_at))}</div><div class="muted" style="font-size:11px">${esc(today.closed_by || '')}</div></div>
        </div>
        ${P ? `<div class="punch-grid" style="grid-template-columns:repeat(3,1fr);margin-top:0">
          <div class="stat"><div class="k">Opening balance</div><div class="v" style="font-size:15px">${esc(inr(today.opening))}</div></div>
          <div class="stat"><div class="k">Cash sales</div><div class="v pos" style="font-size:15px">${esc(inr(today.cash_sales))}</div></div>
          <div class="stat"><div class="k">UPI sales</div><div class="v" style="font-size:15px">${esc(inr(today.upi_sales))}</div></div></div>` : ''}
        <div class="muted">${today.bills || 0} bills · ${today.pieces || 0} pieces sold at the store today</div>
        ${!today.opened_at ? '<button class="btn block" id="openStore" style="margin-top:12px">Open the store</button>' : ''}
      </div>
      <div id="cashBox"></div>
      <h2>Petty cash</h2>
      <div class="card">
        ${emp || myBal !== undefined ? `<div class="row"><span>My petty cash</span><b class="amt">${esc(inr(myBal || 0))}</b></div>` : ''}
        ${P ? petty.map((x) => `<div class="row" style="padding:4px 0"><span>${esc(x.name)}</span><b class="amt">${esc(inr(x.balance))}</b></div>`).join('') || '<div class="muted">No petty cash given yet.</div>' : ''}
        <div class="actions">${myBal > 0 ? '<button class="btn small" id="pettySpend">Spend from petty cash</button>' : ''}${P ? '<button class="btn small outline" id="pettyGive">Give petty cash</button><button class="btn small ghost" id="pettyBack">Take back</button>' : ''}</div>
        <div class="hint">Petty cash is separate from the sales drawer. Every spend needs a bill photo and goes into the books as an expense.</div>
        ${myPetty.length ? `<div style="margin-top:10px">${myPetty.slice(0, 8).map((m) => `<div class="row" style="padding:5px 0;border-top:1px solid var(--line)"><span>${esc(m.reason)}<div class="muted">${esc(day(m.day))} · ${esc(memberName(m.holder))}${m.photo_path ? ` · <button class="linkish" data-ph="${esc(m.photo_path)}">bill</button>` : ''}</div></span>
          <b class="${m.kind === 'topup' ? 'pos' : 'neg'}">${m.kind === 'topup' ? '+' : '−'} ${esc(inr(m.amount))}</b></div>`).join('')}</div>` : ''}
      </div>
      <h2>Stock at the store</h2>
      <div class="card"><div class="row"><span>${pieces} printed pieces ready to sell</span><button class="linkish" id="toStock">Stock ›</button></div>
        ${low ? `<div class="neg" style="margin-top:4px">${low} sizes running low</div>` : ''}</div>
      <h2>Day register · last 14 days</h2>
      <div class="card table-wrap"><table><thead><tr><th>Day</th><th>Open</th><th>Close</th>${P ? '<th class="r">Opening</th><th class="r">Cash sales</th><th class="r">Handed</th><th class="r">Closing</th><th class="r">Diff</th>' : '<th class="r">Bills</th>'}</tr></thead><tbody>
        ${reg.map((r) => `<tr><td style="white-space:nowrap">${esc(new Date(`${r.day}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }))}</td><td>${esc(timeOf(r.opened_at))}</td><td>${esc(timeOf(r.closed_at))}</td>
          ${P ? `<td class="r">${esc(inr(r.opening))}</td><td class="r">${esc(inr(r.cash_sales))}</td><td class="r">${esc(inr(r.handed_over))}</td><td class="r">${r.counted !== null ? esc(inr(r.counted)) : '—'}</td>
            <td class="r">${r.difference === null ? '—' : Number(r.difference) ? signed(r.difference) : '<span class="pos">✓</span>'}</td>` : `<td class="r">${r.bills}</td>`}</tr>`).join('')}</tbody></table></div>`;
    if (emp && pol) wirePunch(view.querySelector('#punchBox'), att[0], () => VIEWS.store(view));
    view.querySelectorAll('[data-ph]').forEach((b) => { b.onclick = () => showProof(b.dataset.ph); });
    view.querySelector('#toStock').onclick = () => go('stock');
    const os = view.querySelector('#openStore');
    if (os) os.onclick = async () => { try { await q(sb.rpc('store_open', { p_note: null })); C.chime(); toast('Store is open. Have a great day!'); VIEWS.store(view); } catch (e) { toast(errText(e), true); } };
    const sp = view.querySelector('#pettySpend');
    if (sp) sp.onclick = () => pettySpend(() => VIEWS.store(view));
    const pg = view.querySelector('#pettyGive');
    if (pg) pg.onclick = () => pettyGive(false, () => VIEWS.store(view));
    const pb = view.querySelector('#pettyBack');
    if (pb) pb.onclick = () => pettyGive(true, () => VIEWS.store(view));
    // store cash (handovers + daily close) underneath
    const box = view.querySelector('#cashBox');
    await VIEWS.cash(box);
    const back = box.querySelector('#back'); if (back) back.remove();
    const h1 = box.querySelector('h1'); if (h1) { const h2 = document.createElement('h2'); h2.textContent = 'Store cash'; h1.replaceWith(h2); }
  };

  function pettySpend(done) {
    const body = panel(`<h1 style="margin-top:14px">Spend petty cash</h1>
      <label for="psAmt">Amount (₹)</label><input id="psAmt" type="number" inputmode="decimal">
      <label for="psCat">Category</label><select id="psCat">${EXP_CAT.filter(([k]) => !['equipment', 'interest', 'tax', 'salary'].includes(k)).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select>
      <label for="psWhy">What did you buy?</label><input id="psWhy" placeholder="e.g. Packing tape + 50 courier bags">
      <label for="psPhoto">Photo of the bill</label><input id="psPhoto" type="file" accept="image/*" capture="environment">
      <button class="btn block" id="psGo" style="margin-top:16px">Save</button>`);
    body.querySelector('#psGo').onclick = async (e) => {
      const btn = e.currentTarget; btn.disabled = true;
      try {
        const path = await uploadProof(body.querySelector('#psPhoto').files[0], 'petty');
        const left = await q(sb.rpc('petty_spend', { p_amount: num(body.querySelector('#psAmt').value), p_reason: body.querySelector('#psWhy').value, p_category: body.querySelector('#psCat').value, p_photo: path }));
        closePanel(); toast(`Saved · ${inr(left)} petty cash left`); done();
      } catch (err) { btn.disabled = false; toast(errText(err), true); }
    };
  }
  async function pettyGive(back, done) {
    const v = await ask({ title: back ? 'Take petty cash back' : 'Give petty cash', fields: [
      { name: 'who', label: back ? 'From' : 'To', type: 'select', options: state.members.filter((m) => m.active && m.role === 'employee').map((m) => [m.id, m.name]) },
      { name: 'amt', label: 'Amount (₹)', type: 'number', required: true }, { name: 'note', label: 'Note (optional)' }], ok: back ? 'Take back' : 'Give' });
    if (!v) return;
    try { const bal = await q(sb.rpc('petty_topup', { p_holder: v.who, p_amount: num(v.amt), p_note: v.note || null, p_return: back })); toast(`Petty cash now ${inr(bal)}`); done(); } catch (e) { toast(errText(e), true); }
  }

  // ================================================================ FINANCE (partners)
  const PERIODS = () => {
    const d = new Date(); const y = d.getFullYear(); const mth = d.getMonth();
    const iso = (x) => x.toLocaleDateString('en-CA');
    const fyStart = mth >= 3 ? new Date(y, 3, 1) : new Date(y - 1, 3, 1);
    const qStart = new Date(y, Math.floor(mth / 3) * 3, 1);
    return {
      month: ['This month', iso(new Date(y, mth, 1)), iso(new Date(y, mth + 1, 1))],
      last: ['Last month', iso(new Date(y, mth - 1, 1)), iso(new Date(y, mth, 1))],
      quarter: ['This quarter', iso(qStart), iso(new Date(qStart.getFullYear(), qStart.getMonth() + 3, 1))],
      fy: [`FY ${fyStart.getFullYear()}-${String(fyStart.getFullYear() + 1).slice(2)}`, iso(fyStart), iso(new Date(fyStart.getFullYear() + 1, 3, 1))],
      all: ['Since start', '2020-01-01', iso(new Date(y + 1, 0, 1))],
    };
  };
  VIEWS.finance = async (view) => {
    if (!isPartner()) { view.innerHTML = '<div class="empty">Finance is for partners.</div>'; return; }
    const per = PERIODS();
    const k = state.finPeriod && per[state.finPeriod] ? state.finPeriod : 'month';
    const [label, from, to] = per[k];
    const [f, pos, held, summary] = await Promise.all([
      q(sb.rpc('finance_statement', { p_from: from, p_to: to })),
      q(sb.from('partner_positions').select('*')), q(sb.from('cash_with_partners').select('*')).catch(() => []),
      q(sb.from('business_summary').select('*').single()),
    ]);
    const cat = (c) => (EXP_CAT.find((x) => x[0] === c) || [0, c])[1];
    const line = (l, v, cls = '', note = '') => `<tr class="${cls}"><td>${l}${note ? `<div class="muted">${note}</div>` : ''}</td><td class="r">${typeof v === 'string' ? v : esc(inr(v))}</td></tr>`;
    const pnl = `
      <table class="pnl">
        ${line('Sales (incl. GST)', f.gross_sales)}
        ${line('− Refunds', -f.refunds)}
        ${line(`− GST collected (${f.gst_rate}%)`, -f.output_gst, '', 'Belongs to the government, paid with GSTR-3B')}
        ${line('Net revenue', f.revenue, 'sub')}
        ${line('− Cost of tees sold', -f.cogs, '', f.cogs_basis === 'cost price' ? 'Blank + DTF/print + packing, from cost price' : 'Using production spend (set cost prices for accuracy)')}
        ${line('Gross profit', f.gross_profit, 'sub')}
        ${Object.entries(f.expenses_by_category || {}).filter(([c]) => !['production', 'equipment', 'interest', 'tax'].includes(c)).map(([c, v]) => line(`− ${esc(cat(c))}`, -v)).join('')}
        ${line('EBITDA', f.ebitda, 'sub', 'Earnings before interest, tax, depreciation')}
        ${line('− Equipment written off', -f.depreciation)}
        ${line('EBIT', f.ebit, 'sub', 'Operating profit')}
        ${line('− Interest / bank charges', -f.interest)}
        ${line('+ Other income', f.other_income)}
        ${line('PBT', f.pbt, 'sub', 'Profit before tax')}
        ${line(`− Income tax (${f.tax_rate}%)`, -f.tax, '', 'Estimate. Advance tax is due 15 Jun / Sep / Dec / Mar')}
        ${line('PAT · Net profit', f.pat, 'total', 'Profit after tax')}
      </table>`;
    const fyLabel = per.fy[0];
    const now = new Date();
    const nextDue = (dayOfMonth) => { const x = new Date(now.getFullYear(), now.getMonth(), dayOfMonth); if (x < now) x.setMonth(x.getMonth() + 1); return x.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); };
    view.innerHTML = `
      <h1>Finance</h1>
      <div class="seg">${Object.entries(per).map(([kk, [l]]) => `<button data-p="${kk}" class="${k === kk ? 'on' : ''}">${l}</button>`).join('')}</div>
      <p class="sub">${esc(label)} · ${esc(day(from))} to ${esc(day(f.to))} · ${f.orders} orders</p>
      <div class="kpis">
        <div class="kpi"><span>Net revenue</span><b>${esc(inr(f.revenue))}</b></div>
        <div class="kpi"><span>Gross profit</span><b>${esc(inr(f.gross_profit))}</b><small>${f.gross_margin ?? '—'}% margin</small></div>
        <div class="kpi"><span>EBITDA</span><b class="${f.ebitda < 0 ? 'neg' : 'pos'}">${esc(inr(f.ebitda))}</b><small>${f.ebitda_margin ?? '—'}% margin</small></div>
        <div class="kpi"><span>EBIT</span><b>${esc(inr(f.ebit))}</b><small>${f.ebit_margin ?? '—'}%</small></div>
        <div class="kpi"><span>PBT</span><b>${esc(inr(f.pbt))}</b></div>
        <div class="kpi"><span>PAT · Net profit</span><b class="${f.pat < 0 ? 'neg' : 'pos'}">${esc(inr(f.pat))}</b><small>${f.net_margin ?? '—'}% net margin</small></div>
      </div>
      <h2>Profit & loss</h2>
      <div class="card report">${pnl}<div class="actions"><button class="btn small outline" id="finPrint">${NATIVE ? 'Share' : 'Print / PDF'}</button></div></div>
      <h2>Profit per tee</h2>
      <div id="perTee" class="card"><div class="muted">Loading…</div></div>
      <div class="chipset" style="margin-top:8px"><button data-more="costs">Edit cost sheet</button><button data-more="fininputs">Finance inputs (depreciation, overheads…)</button><button data-more="changelog">Change log</button></div>
      <h2>Partners · invested, profit & settle-up</h2>
      <div class="card"><div class="row"><span class="muted">Money in the business (books)</span><b class="amt">${esc(inr(summary.cash_balance))}</b></div>
        <div class="row"><span class="muted">Profit / loss since start</span>${signed(summary.business_result)}</div></div>
      ${partnerFinanceHtml(pos, held)}
      <h2>Tax & compliance</h2>
      <div class="card">
        <div class="row"><span>GST collected in this period</span><b>${esc(inr(f.output_gst))}</b></div>
        <div class="row"><span class="muted">GST on purchases (input credit)</span><span class="muted">add from bills with your CA</span></div>
        <div class="row"><span>Estimated income tax on profit</span><b>${esc(inr(f.tax))}</b></div>
        <div class="row"><span class="muted">Income tax already paid (expense category "Income tax paid")</span><span>${esc(inr(f.tax_paid))}</span></div>
        <table class="compliance">
          <tr><td>GSTR-1 (sales invoices)</td><td>monthly, by the 11th</td><td class="r">next ${esc(nextDue(11))}</td></tr>
          <tr><td>GSTR-3B (pay GST)</td><td>monthly, by the 20th</td><td class="r">next ${esc(nextDue(20))}</td></tr>
          <tr><td>Advance income tax</td><td>15 Jun · 15 Sep · 15 Dec · 15 Mar</td><td class="r">${esc(fyLabel)}</td></tr>
          <tr><td>Income tax return (firm)</td><td>31 Jul, or 31 Oct if audited</td><td class="r">${esc(fyLabel)}</td></tr>
          <tr><td>Partners' month close</td><td>after each month, in the app</td><td class="r"><button class="linkish" id="toClose">Open ›</button></td></tr>
        </table>
        <div class="hint">Tees up to ₹2,500 a piece carry 5% GST. Small businesses can choose quarterly GST filing (QRMP). Confirm dates and rates with your CA; this is a guide, not tax advice.</div>
        <button class="btn small outline" id="taxRate" style="margin-top:10px">Change income tax %</button>
      </div>
      <h2>Expenses by category</h2>
      ${Object.keys(f.expenses_by_category || {}).length ? `<div class="card hbars">${(() => { const e = Object.entries(f.expenses_by_category).sort((a, b) => b[1] - a[1]); const mx = Math.max(1, ...e.map((x) => x[1]));
        return e.map(([c, v]) => `<div class="hbar"><span class="l">${esc(cat(c))}</span><span class="b"><i class="neg" style="width:${(v / mx) * 100}%"></i></span><span class="v">${esc(inr(v))}</span></div>`).join(''); })()}</div>` : '<div class="empty">No expenses in this period.</div>'}
      <div class="chipset" style="margin-top:14px">${[['books', 'Books'], ['partners', 'Partners'], ['close', 'Month close'], ['approvals', 'Approvals'], ['requests', 'Money entry']].map(([kk, l]) => `<button data-more="${kk}">${l}</button>`).join('')}</div>`;
    view.querySelectorAll('[data-p]').forEach((b) => { b.onclick = () => { state.finPeriod = b.dataset.p; VIEWS.finance(view); }; });
    q(sb.rpc('product_finance', { p_from: from, p_to: to })).then((pf) => {
      const el = view.querySelector('#perTee');
      if (!el) return;
      el.innerHTML = pf.length ? `<div class="table-wrap"><table class="pnl"><thead><tr><th>Tee</th><th class="r">Sold</th><th class="r">Revenue</th><th class="r">Gross</th><th class="r">EBITDA</th><th class="r">EBIT</th><th class="r">PBT</th><th class="r">Net</th><th class="r">Net / tee</th></tr></thead><tbody>
        ${pf.map((r) => `<tr><td>${esc(r.name)}<div class="muted">cost ${esc(inr(r.cost_per_tee))} · ${r.gross_margin ?? '—'}% gross</div></td><td class="r">${r.units}</td><td class="r">${esc(inr(r.revenue))}</td><td class="r">${esc(inr(r.gross_profit))}</td>
          <td class="r">${signed(r.ebitda)}</td><td class="r">${signed(r.ebit)}</td><td class="r">${signed(r.pbt)}</td><td class="r">${signed(r.net_profit)}</td><td class="r">${esc(inr(r.profit_per_tee))}</td></tr>`).join('')}</tbody></table></div>
        <div class="hint">Each tee carries its share of running costs by its share of revenue. Fix costs in the cost sheet.</div>` : '<div class="muted">No sales in this period.</div>';
    }).catch(() => {});
    view.querySelectorAll('[data-more]').forEach((b) => { b.onclick = () => go('more', b.dataset.more); });
    view.querySelector('#toClose').onclick = () => go('more', 'close');
    view.querySelector('#finPrint').onclick = () => printDoc(`Z-SHIRTS P&L ${label}`, `<h1>${esc(biz().name)} · Profit & loss</h1><p class="muted">${esc(label)}: ${esc(day(from))} to ${esc(day(f.to))}</p>${pnl.replace('class="pnl"', '')}`);
    view.querySelector('#taxRate').onclick = async () => {
      const v = await ask({ title: 'Income tax on profit (%)', html: '<p class="muted">Partnership firm: 30% + 4% cess = 31.2% (more if profit crosses ₹1 crore). All partners approve.</p>', fields: [{ name: 'value', label: 'Rate %', type: 'number', value: f.tax_rate, required: true }, { name: 'why', label: 'Why?', required: true, placeholder: 'As advised by CA' }], ok: 'Send for approval' });
      if (!v) return;
      try { await q(sb.rpc('raise_request', { p_type: 'setting_change', p_amount: null, p_description: v.why, p_proof_path: null, p_payload: { key: 'income_tax_rate_pct', value: num(v.value) } })); toast('Sent to partners'); } catch (e) { toast(errText(e), true); }
    };
  };

  // ================================================================ PRODUCTION TRACKER
  VIEWS.production = async (view) => {
    await loadStock();
    const [batches, made] = await Promise.all([
      q(sb.from('batch_board').select('*').order('created_at', { ascending: false }).limit(100)),
      q(sb.from('order_board').select('id,order_no,customer_name,production_status,status,items,created_at').not('production_status', 'is', null).in('status', ['placed', 'confirmed']).order('created_at')),
    ]);
    const open = batches.filter((b) => !['ready', 'cancelled'].includes(b.stage));
    const done = batches.filter((b) => ['ready', 'cancelled'].includes(b.stage));
    const stageIdx = (s) => STAGES.findIndex((x) => x[0] === s);
    const card = (b) => `<div class="card" data-b="${b.id}">
      <div class="row"><div><span class="order-no">${esc(b.code)}</span> <b>${esc(b.product_name)}</b></div><span class="pill ${b.stage === 'ready' ? 'approved' : b.stage === 'cancelled' ? 'cancelled' : 'pending'}">${esc((STAGES.find((s) => s[0] === b.stage) || [0, b.stage])[1])}</span></div>
      <div class="muted" style="margin-top:6px">${(b.item_list || []).map((i) => `${esc(i.label)} ×${i.qty}`).join(' · ')}</div>
      <div class="muted">${b.pieces} pcs${b.supplier ? ` · ${esc(b.supplier)}` : ''}${b.expected_date ? ` · due ${esc(day(b.expected_date))}` : ''}${isPartner() && Number(b.total_cost) ? ` · ${esc(inr(b.total_cost))} (${esc(inr(b.cost_per_piece))}/pc)` : ''}</div>
      ${!['ready', 'cancelled'].includes(b.stage) ? `<div class="stage-track">${STAGES.map(([k, l], i) => `<span class="${i <= stageIdx(b.stage) ? 'on' : ''}">${l}</span>`).join('')}</div>
        <div class="actions"><button class="btn small" data-next-stage="${b.id}">${stageIdx(b.stage) === STAGES.length - 2 ? 'Ready · add to stock' : `Move to ${STAGES[stageIdx(b.stage) + 1][1]}`}</button>
        <button class="btn small outline" data-edit-batch="${b.id}">Edit</button><button class="btn small ghost" data-cancel-batch="${b.id}">Cancel</button></div>` : ''}
    </div>`;
    view.innerHTML = `${backBtn}
      <h1>Production tracker</h1>
      <p class="sub">Every batch from blanks to ready stock. Marking a batch ready adds the pieces to stock and updates the cost per tee.</p>
      <button class="btn block" id="newBatch" style="margin-bottom:16px">+ New batch</button>
      ${made.length ? `<h2>Made-to-order queue · customers can see this</h2>${made.map((o) => `<div class="card">
        <div class="row"><div><span class="order-no">${esc(o.order_no)}</span> ${esc(o.customer_name)}</div><span class="ago">${esc(ago(o.created_at))}</span></div>
        <div class="muted">${(o.items || []).map((i) => `${i.qty}× ${esc(i.name)} (${esc(i.variant)})`).join(', ')}</div>
        <div class="chipset" style="margin-top:10px">${MAKING.map(([k, l]) => `<button data-mk="${o.id}" data-st="${k}" class="${o.production_status === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>`).join('')}` : ''}
      <h2>In progress</h2>${open.length ? open.map(card).join('') : '<div class="empty">No batches in progress.</div>'}
      ${done.length ? `<h2>Finished</h2>${done.slice(0, 20).map(card).join('')}` : ''}`;
    wireBack(view);
    view.querySelector('#newBatch').onclick = () => batchForm(null, () => VIEWS.production(view));
    view.querySelectorAll('[data-mk]').forEach((b) => {
      b.onclick = async () => { try { await q(sb.rpc('set_production_status', { p_order_id: Number(b.dataset.mk), p_status: b.dataset.st })); toast('Customer can see the new status'); VIEWS.production(view); } catch (e) { toast(errText(e), true); } };
    });
    view.querySelectorAll('[data-next-stage]').forEach((b) => {
      b.onclick = async () => {
        const bt = batches.find((x) => x.id === Number(b.dataset.nextStage));
        const next = STAGES[stageIdx(bt.stage) + 1][0];
        if (next === 'ready' && !(await ask({ title: `${bt.code} ready?`, html: `<p class="muted">${bt.pieces} pieces will be added to stock now.</p>`, ok: 'Add to stock' }))) return;
        try { await q(sb.rpc('set_batch_stage', { p_id: bt.id, p_stage: next })); if (next === 'ready') C.moment({ title: `${bt.code} is ready`, sub: `${bt.pieces} pieces added to stock`, kind: 'status' }); else toast('Updated'); VIEWS.production(view); } catch (e) { toast(errText(e), true); }
      };
    });
    view.querySelectorAll('[data-edit-batch]').forEach((b) => { b.onclick = () => batchForm(batches.find((x) => x.id === Number(b.dataset.editBatch)), () => VIEWS.production(view)); });
    view.querySelectorAll('[data-cancel-batch]').forEach((b) => {
      b.onclick = async () => { if (!(await ask({ title: 'Cancel this batch?', ok: 'Cancel batch', okClass: 'bad' }))) return; try { await q(sb.rpc('set_batch_stage', { p_id: Number(b.dataset.cancelBatch), p_stage: 'cancelled' })); VIEWS.production(view); } catch (e) { toast(errText(e), true); } };
    });
  };

  function batchForm(b, done) {
    const products = [...new Map(state.stock.filter((v) => v.product_active).map((v) => [v.product_id, v])).values()];
    let pid = b ? b.product_id : (products[0] || {}).product_id;
    const qty = new Map(b ? (b.items || []).map((i) => [Number(i.variant_id), Number(i.qty)]) : []);
    const draw = () => {
      const vars = state.stock.filter((v) => v.product_id === pid && v.active).sort((x, y) => x.colour.localeCompare(y.colour) || sizeSort(x.size, y.size));
      const body = panel(`<h1 style="margin-top:14px">${b ? `Edit ${esc(b.code)}` : 'New production batch'}</h1>
        <label for="bProd">Product</label><select id="bProd" ${b ? 'disabled' : ''}>${products.map((p) => `<option value="${p.product_id}" ${p.product_id === pid ? 'selected' : ''}>${esc(p.product_name)}</option>`).join('')}</select>
        <label>Pieces per size</label>
        <div class="qty-grid">${vars.map((v) => `<label class="qty-cell"><span><span class="dot-c" style="background:${esc(v.colour_hex)}"></span>${esc(v.colour)} ${esc(v.size)}</span>
          <input type="number" min="0" inputmode="numeric" data-vq="${v.variant_id}" value="${qty.get(v.variant_id) || ''}" placeholder="0"></label>`).join('')}</div>
        <label for="bSup">Printer / supplier</label><input id="bSup" value="${esc(b ? b.supplier || '' : store.get('zs_last_supplier', ''))}" placeholder="e.g. Tiruppur Prints">
        <div class="row2"><div><label for="bBlank">Blanks cost (₹ total)</label><input id="bBlank" type="number" inputmode="decimal" value="${b ? b.blank_cost : ''}"></div>
          <div><label for="bPrint">Printing cost (₹ total)</label><input id="bPrint" type="number" inputmode="decimal" value="${b ? b.print_cost : ''}"></div></div>
        <div class="row2"><div><label for="bOther">Other (₹: tags, bags, transport)</label><input id="bOther" type="number" inputmode="decimal" value="${b ? b.other_cost : ''}"></div>
          <div><label for="bDue">Expected ready</label><input id="bDue" type="date" value="${b && b.expected_date ? b.expected_date : ''}"></div></div>
        <label for="bNotes">Notes</label><input id="bNotes" value="${esc(b ? b.notes || '' : '')}">
        <div class="rule-box" id="bSum"></div>
        <p class="hint">Costs here are for working out profit per tee. Pay the supplier with an Expense entry (bill photo) as usual.</p>
        <button class="btn block" id="bSave">${b ? 'Save' : 'Start batch'}</button>`);
      const upd = () => {
        let pcs = 0; body.querySelectorAll('[data-vq]').forEach((i) => { pcs += Number(i.value) || 0; });
        const cost = ['#bBlank', '#bPrint', '#bOther'].reduce((t, id) => t + (Number(body.querySelector(id).value) || 0), 0);
        body.querySelector('#bSum').innerHTML = `<b>${pcs} pieces</b>${cost && pcs ? ` · ${esc(inr(cost))} → <b>${esc(inr(Math.round((cost / pcs) * 100) / 100))} per tee</b>` : ''}`;
      };
      body.querySelectorAll('input').forEach((i) => { i.addEventListener('input', upd); });
      upd();
      body.querySelector('#bProd').onchange = (e) => { pid = Number(e.target.value); qty.clear(); draw(); };
      body.querySelector('#bSave').onclick = async () => {
        const items = [...body.querySelectorAll('[data-vq]')].map((i) => ({ variant_id: Number(i.dataset.vq), qty: Number(i.value) || 0 })).filter((i) => i.qty > 0);
        if (!items.length) return toast('Enter pieces for at least one size', true);
        store.set('zs_last_supplier', body.querySelector('#bSup').value);
        try {
          await q(sb.rpc('save_batch', { p: { id: b ? b.id : null, product_id: pid, items, supplier: body.querySelector('#bSup').value || null,
            blank_cost: num(body.querySelector('#bBlank').value) || 0, print_cost: num(body.querySelector('#bPrint').value) || 0, other_cost: num(body.querySelector('#bOther').value) || 0,
            expected_date: body.querySelector('#bDue').value || null, notes: body.querySelector('#bNotes').value || null } }));
          closePanel(); toast(b ? 'Saved' : 'Batch started'); done();
        } catch (e) { toast(errText(e), true); }
      };
    };
    if (!products.length) return toast('Add a product in Stock first', true);
    draw();
  }

  // ================================================================ HR · attendance, leave, salary, rules
  function locate() {
    return new Promise((res) => {
      if (!navigator.geolocation) return res(null);
      navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lng: p.coords.longitude }), () => res(null), { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
    });
  }
  const timeOf = (s) => (s ? new Date(s).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—');

  VIEWS.hr = async (view) => {
    const month = state.hrMonth || monthKey();
    const employees = state.members.filter((m) => m.role === 'employee' && m.active);
    const [pol, att, leaves, pay, salaries] = await Promise.all([
      q(sb.rpc('hr_policy')),
      q(sb.from('attendance').select('*').gte('day', month).order('day', { ascending: false })),
      q(sb.from('leave_requests').select('*').order('created_at', { ascending: false }).limit(60)),
      q(sb.rpc('hr_payroll', { p_month: month })).catch(() => []),
      q(sb.from('employee_pay').select('*')),
    ]);
    const today = todayKey();
    const mineToday = att.find((a) => a.member_id === state.me.id && a.day === today);
    const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); return monthKey(d); });
    const payRow = (p) => `<div class="card"><div class="row"><b>${esc(p.name)}</b><span class="amt pos">${esc(inr(p.net_pay))}</span></div>
      <div class="pay-grid">
        <span>Salary</span><b>${esc(inr(p.monthly_salary))}</b><span>Working days so far</span><b>${p.working_days}</b>
        <span>Present</span><b>${p.present_days}</b><span>Paid leave</span><b>${p.paid_leave}</b>
        <span>Unpaid leave</span><b>${p.unpaid_leave}</b><span>Absent</span><b>${p.absent_days}</b>
        <span>Late marks</span><b>${p.late_count} (${p.late_half_days} half-day cut)</b><span>Overtime</span><b>${p.ot_hours} h · ${esc(inr(p.ot_pay))}</b>
        <span>Deductions</span><b class="neg">− ${esc(inr(p.deductions))}</b><span>Day rate</span><b>${esc(inr(p.per_day))}</b>
      </div>${!Number(p.monthly_salary) ? '<div class="hint">Salary not set yet. A partner sets it (all partners approve).</div>' : ''}</div>`;
    const leaveCard = (l) => `<div class="card" data-l="${l.id}"><div class="row"><div><b>${esc(memberName(l.member_id))}</b> · ${esc(day(l.from_day))}${l.to_day !== l.from_day ? ` – ${esc(day(l.to_day))}` : ''}</div><span class="pill ${l.status}">${esc(l.status)}</span></div>
      <div class="muted">${esc(l.kind.replace('_', ' '))} · ${esc(l.reason)}${l.note ? ` · reply: ${esc(l.note)}` : ''}</div>
      ${isPartner() && l.status === 'pending' ? '<div class="actions"><button class="btn small bad" data-lv="reject">Reject</button><button class="btn small good" data-lv="approve">Approve</button></div>' : ''}</div>`;

    view.innerHTML = `${backBtn}
      <h1>${isPartner() ? 'Team & HR' : 'My attendance'}</h1>
      ${state.me.role === 'employee' ? `
        ${punchHtml(mineToday, pol)}
        <h2>Ask for leave</h2>
        <form class="card" id="lvForm">
          <div class="row2"><div><label for="lvFrom" style="margin-top:0">From</label><input id="lvFrom" type="date" required min="${today}"></div><div><label for="lvTo" style="margin-top:0">To</label><input id="lvTo" type="date" required min="${today}"></div></div>
          <label for="lvKind">Type</label><select id="lvKind">${Number(pol.paid_leaves_per_month) ? `<option value="paid">Paid leave (${esc(pol.paid_leaves_per_month)} per month)</option>` : ''}<option value="unpaid">Unpaid leave (salary cut for those days)</option>${pol.half_day_allowed === false ? '' : '<option value="half_day">Half day</option>'}</select>
          <label for="lvWhy">Reason</label><input id="lvWhy" required placeholder="e.g. Family function">
          <button class="btn block" type="submit">Send to partners</button>
        </form>` : ''}
      ${isPartner() ? `
        <h2>Today</h2>
        ${employees.map((e) => { const a = att.find((x) => x.member_id === e.id && x.day === today); return `<div class="card"><div class="row"><b>${esc(e.name)}</b>
          <span class="pill ${a ? (a.out_at ? 'approved' : 'pending') : 'cancelled'}">${a ? (a.out_at ? 'Checked out' : 'At work') : 'Not checked in'}</span></div>
          ${a ? `<div class="muted">In ${esc(timeOf(a.in_at))}${a.late_min ? ` · <span class="neg">${a.late_min} min late</span>` : ''} · Out ${esc(timeOf(a.out_at))}
            ${a.in_photo ? `<button class="linkish" data-ph="${esc(a.in_photo)}">in selfie</button>` : ''} ${a.out_photo ? `<button class="linkish" data-ph="${esc(a.out_photo)}">out selfie</button>` : ''}</div>` : ''}</div>`; }).join('') || '<div class="empty">No employees.</div>'}` : ''}
      ${leaves.filter((l) => l.status === 'pending').length ? `<h2>Leave waiting</h2>${leaves.filter((l) => l.status === 'pending').map(leaveCard).join('')}` : ''}
      <h2>Salary · <select id="hrMonth" class="inline-select">${months.map((m) => `<option value="${m}" ${m === month ? 'selected' : ''}>${esc(monthName(m))}</option>`).join('')}</select></h2>
      ${pay.length ? pay.map(payRow).join('') : '<div class="empty">No salary data yet.</div>'}
      ${isPartner() ? `<div class="actions"><button class="btn small outline" id="hrPrint">Print payslips</button><button class="btn small outline" id="hrSalary">Change salary</button></div>` : ''}
      <h2>Attendance this month</h2>
      ${att.length ? `<div class="card table-wrap"><table><thead><tr><th>Day</th>${isPartner() ? '<th>Who</th>' : ''}<th>In</th><th>Out</th><th>Late</th></tr></thead><tbody>
        ${att.map((a) => `<tr><td>${esc(new Date(`${a.day}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', weekday: 'short' }))}</td>${isPartner() ? `<td>${esc(memberName(a.member_id).split(' ')[0])}</td>` : ''}
          <td>${esc(timeOf(a.in_at))}</td><td>${esc(timeOf(a.out_at))}</td><td>${a.late_min ? `<span class="neg">${a.late_min}m</span>` : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No attendance yet this month.</div>'}
      <h2>HR rules</h2>
      <div class="card">${Object.keys(HR_LABEL).map((k) => `<div class="row" style="padding:5px 0"><span class="muted">${esc(HR_LABEL[k])}</span><b>${esc(pol[k] ?? '—')}</b></div>`).join('')}
        ${isPartner() ? '<button class="btn small outline" id="hrRules" style="margin-top:10px">Change HR rules</button><button class="btn small ghost" id="hrHere" style="margin-top:10px">Set store location to where I am</button>' : '<div class="hint">Partners change these together.</div>'}</div>
      ${leaves.filter((l) => l.status !== 'pending').length ? `<h2>Leave history</h2>${leaves.filter((l) => l.status !== 'pending').slice(0, 20).map(leaveCard).join('')}` : ''}`;
    wireBack(view);
    view.querySelector('#hrMonth').onchange = (e) => { state.hrMonth = e.target.value; VIEWS.hr(view); };
    view.querySelectorAll('[data-ph]').forEach((b) => { b.onclick = () => showProof(b.dataset.ph); });
    wirePunch(view, mineToday, () => VIEWS.hr(view));
    const lf = view.querySelector('#lvForm');
    if (lf) lf.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await q(sb.rpc('request_leave', { p_from: view.querySelector('#lvFrom').value, p_to: view.querySelector('#lvTo').value || view.querySelector('#lvFrom').value, p_kind: view.querySelector('#lvKind').value, p_reason: view.querySelector('#lvWhy').value }));
        toast('Sent to partners'); VIEWS.hr(view);
      } catch (err) { toast(errText(err), true); }
    };
    view.querySelectorAll('[data-lv]').forEach((b) => {
      b.onclick = async () => {
        const id = Number(b.closest('[data-l]').dataset.l);
        const ok = b.dataset.lv === 'approve';
        const v = await ask({ title: ok ? 'Approve leave' : 'Reject leave', fields: [{ name: 'note', label: ok ? 'Note (optional)' : 'Reason', required: !ok }], ok: ok ? 'Approve' : 'Reject', okClass: ok ? 'good' : 'bad' });
        if (!v) return;
        try { await q(sb.rpc('decide_leave', { p_id: id, p_approve: ok, p_note: v.note || null })); toast('Done'); VIEWS.hr(view); } catch (e) { toast(errText(e), true); }
      };
    });
    const hs = view.querySelector('#hrSalary');
    if (hs) hs.onclick = async () => {
      const v = await ask({ title: 'Change salary', html: `<p class="muted">All ${partners().length} partners must approve.</p>`, fields: [
        { name: 'm', label: 'Employee', type: 'select', options: employees.map((e) => [e.id, e.name]) },
        { name: 'salary', label: 'Monthly salary (₹)', type: 'number', required: true, value: (salaries[0] || {}).monthly_salary || '' },
        { name: 'why', label: 'Why?', required: true, placeholder: 'e.g. Joining salary / yearly raise' }], ok: 'Send for approval' });
      if (!v) return;
      try { await q(sb.rpc('raise_request', { p_type: 'salary_change', p_amount: num(v.salary), p_description: v.why, p_proof_path: null, p_payload: { member_id: v.m, salary: num(v.salary) } })); toast('Sent to partners'); } catch (e) { toast(errText(e), true); }
    };
    const hrules = view.querySelector('#hrRules');
    if (hrules) hrules.onclick = async () => {
      const keys = Object.keys(HR_LABEL).filter((k) => !['office_lat', 'office_lng'].includes(k));
      const v = await ask({ title: 'Change HR rules', html: '<p class="muted">Applies straight away. Logged, and all partners are told.</p>',
        fields: keys.map((k) => (k === 'weekly_off' ? { name: k, label: HR_LABEL[k], type: 'select', value: pol[k], options: ['None', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d) => [d, d]) }
          : k === 'half_day_allowed' ? { name: k, label: HR_LABEL[k], type: 'select', value: String(!!pol[k]), options: [['false', 'No'], ['true', 'Yes']] }
          : { name: k, label: HR_LABEL[k], type: /_start|_end|ot_after/.test(k) ? 'time' : 'number', value: pol[k] ?? '' })), ok: 'Save' });
      if (!v) return;
      const changed = {};
      keys.forEach((k) => { const nv = k === 'half_day_allowed' ? v[k] === 'true' : /_start|_end|ot_after|weekly_off/.test(k) ? v[k] : num(v[k]); if (String(nv ?? '') !== String(pol[k] ?? '')) changed[k] = nv; });
      if (!Object.keys(changed).length) return toast('Nothing changed');
      try { await q(sb.rpc('update_setting', { p_key: 'hr_policy', p_value: changed })); toast('HR rules saved'); VIEWS.hr(view); } catch (e) { toast(errText(e), true); }
    };
    const here = view.querySelector('#hrHere');
    if (here) here.onclick = async () => {
      const loc = await locate();
      if (!loc) return toast('Could not get location. Allow location and try at the store.', true);
      const v = await ask({ title: 'Lock attendance to the store?', html: `<p class="muted">Check-in will only work within ${esc(pol.office_radius_m || 200)} m of this spot (${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}). Logged, and all partners are told.</p>`, ok: 'Lock to this spot' });
      if (!v) return;
      try { await q(sb.rpc('update_setting', { p_key: 'hr_policy', p_value: { office_lat: loc.lat, office_lng: loc.lng } })); toast('Attendance locked to the store'); VIEWS.hr(view); } catch (e) { toast(errText(e), true); }
    };
    const hp = view.querySelector('#hrPrint');
    if (hp) hp.onclick = () => printDoc(`Payslips ${monthName(month)}`, pay.map((p) => `<h1>${esc(biz().name)} · Payslip</h1><p>${esc(p.name)} · ${esc(monthName(month))}</p>
      <table>${[['Monthly salary', inr(p.monthly_salary)], ['Working days', p.working_days], ['Present', p.present_days], ['Paid leave', p.paid_leave], ['Unpaid leave', p.unpaid_leave], ['Absent', p.absent_days],
        ['Late marks', `${p.late_count} (${p.late_half_days} half-day cut)`], ['Overtime', `${p.ot_hours} h = ${inr(p.ot_pay)}`], ['Deductions', `− ${inr(p.deductions)}`]].map(([k, val]) => `<tr><td>${k}</td><td class="r">${esc(val)}</td></tr>`).join('')}
      <tr><td><b>Net pay</b></td><td class="r big">${esc(inr(p.net_pay))}</td></tr></table><div class="sig"><div>Employee</div><div>Partner</div><div>Partner</div><div>Date</div></div><div style="page-break-after:always"></div>`).join(''));
  };

  // ================================================================ COUPONS & COMBOS
  VIEWS.coupons = async (view) => {
    await loadStock();
    const [coupons, bundles, infl] = await Promise.all([
      q(sb.from('coupon_board').select('*').order('created_at', { ascending: false })),
      q(sb.from('bundles').select('*').order('created_at', { ascending: false })),
      q(sb.from('influencers').select('id,name').eq('active', true).order('name')),
    ]);
    const products = [...new Map(state.stock.map((v) => [v.product_id, v.product_name])).entries()];
    const chLabel = { online: 'Online only', store: 'In person only (store, events, stalls)', both: 'Online + in person' };
    const live = (c) => c.active && (!c.ends_at || new Date(c.ends_at) > Date.now()) && (!c.usage_limit || c.uses < c.usage_limit);
    view.innerHTML = `${backBtn}
      <h1>Coupons & combos</h1>
      <p class="sub">Customers type coupons at checkout; Mahendra types them in Sell. Combos apply on their own in the bag. One coupon per order.</p>
      ${isPartner() ? '<div class="actions" style="margin:0 0 12px"><button class="btn" id="newCoupon">+ New coupon</button><button class="btn outline" id="newBundle">+ New combo</button><button class="btn outline" id="teamCodes">Codes for every partner + Mahendra</button></div>' : ''}
      <h2>Coupons</h2>
      ${coupons.length ? coupons.map((c) => `<div class="card">
        <div class="row"><div><span class="code-tag">${esc(c.code)}</span> <span class="pill ${live(c) ? 'approved' : 'cancelled'}">${live(c) ? 'Live' : 'Off'}</span></div>
          <b class="amt">${c.kind === 'percent' ? `${Number(c.value)}% off` : `${esc(inr(c.value))} off`}</b></div>
        ${c.owner_name ? `<div style="margin-top:4px;color:var(--lime);font-weight:600;font-size:13px">${esc(c.owner_name)}'s personal code</div>` : ''}
        <div class="muted" style="margin-top:6px">${esc(chLabel[c.channel])}${Number(c.min_order) ? ` · min ${esc(inr(c.min_order))}` : ''}${c.max_discount ? ` · max ${esc(inr(c.max_discount))}` : ''}${c.first_order_only ? ' · first order only' : ''}
          · ${c.per_customer_limit}× per customer${c.usage_limit ? ` · ${c.usage_limit} total` : ''}${c.ends_at ? ` · ends ${esc(day(c.ends_at))}` : ''}${c.influencer_name ? ` · <b>${esc(c.influencer_name)}</b>` : ''}</div>
        ${c.description ? `<div class="muted">${esc(c.description)}</div>` : ''}
        <div class="row" style="margin-top:8px"><span>${c.uses} uses · ${esc(inr(c.revenue))} sales</span><span class="muted">${esc(inr(c.discount_given))} given</span></div>
        <div class="actions">${c.channel !== 'store' ? `<button class="btn small outline" data-share="${esc(c.code)}">Share shop link</button>` : ''}
          ${isPartner() ? `<button class="btn small ${c.active ? 'ghost' : ''}" data-tog="${c.id}" data-on="${c.active ? 0 : 1}">${c.active ? 'Turn off' : 'Turn on'}</button>` : ''}</div>
      </div>`).join('') : '<div class="empty">No coupons yet.</div>'}
      <h2>Combos</h2>
      ${bundles.length ? bundles.map((b) => `<div class="card"><div class="row"><b>${esc(b.name)}</b><span class="pill ${b.active ? 'approved' : 'cancelled'}">${b.active ? 'Live' : 'Off'}</span></div>
        <div class="muted">Any ${b.qty} for ${esc(inr(b.price))} · ${b.product_ids && b.product_ids.length ? b.product_ids.map((id) => esc((products.find((p) => p[0] === id) || [0, `#${id}`])[1])).join(', ') : 'all products'}</div>
        ${isPartner() ? `<div class="actions"><button class="btn small ghost" data-btog="${b.id}">${b.active ? 'Turn off' : 'Turn on'}</button></div>` : ''}</div>`).join('') : '<div class="empty">No combos yet. Try “Any 3 for ₹1,499”.</div>'}`;
    wireBack(view);
    view.querySelectorAll('[data-share]').forEach((b) => {
      b.onclick = async () => {
        const url = `${shopUrl()}?coupon=${encodeURIComponent(b.dataset.share)}`;
        try { if (navigator.share) await navigator.share({ title: 'Z-SHIRTS', text: `Use code ${b.dataset.share} on Z-SHIRTS`, url }); else { await navigator.clipboard.writeText(url); toast('Link copied: the code applies itself at checkout'); } } catch (_) { /* */ }
      };
    });
    view.querySelectorAll('[data-tog]').forEach((b) => { b.onclick = async () => { try { await q(sb.rpc('set_coupon_active', { p_id: Number(b.dataset.tog), p_active: b.dataset.on === '1' })); VIEWS.coupons(view); } catch (e) { toast(errText(e), true); } }; });
    view.querySelectorAll('[data-btog]').forEach((b) => {
      b.onclick = async () => { const x = bundles.find((y) => y.id === Number(b.dataset.btog)); try { await q(sb.rpc('save_bundle', { p: { ...x, product_ids: x.product_ids || [], active: !x.active } })); VIEWS.coupons(view); } catch (e) { toast(errText(e), true); } };
    });
    const tc = view.querySelector('#teamCodes');
    if (tc) tc.onclick = async () => {
      const team = state.members.filter((m) => m.active && !coupons.some((c) => c.member_id === m.id));
      if (!team.length) return toast('Everyone already has a personal code');
      const v = await ask({ title: 'Personal codes for the team', html: `<p class="muted">Creates one code for ${team.map((m) => esc(m.name.split(' ')[0])).join(', ')}. Customers get the discount; the sale is credited to that person (online and at the store).</p>`,
        fields: [{ name: 'value', label: 'Discount %', type: 'number', value: 10, required: true }, { name: 'per', label: 'Uses per customer', type: 'number', value: 1 }], ok: 'Create codes' });
      if (!v) return;
      let made = [];
      for (const m of team) {
        const code = `${m.name.split(' ')[0].toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)}${Number(v.value)}`;
        try { await q(sb.rpc('save_coupon', { p: { code, kind: 'percent', value: num(v.value), channel: 'both', per_customer_limit: num(v.per) || 1, member_id: m.id, description: `${m.name}'s personal code` } })); made.push(code); } catch (e) { toast(`${code}: ${errText(e)}`, true); }
      }
      if (made.length) { C.confetti(0.6); toast(`Created ${made.join(', ')}`); }
      VIEWS.coupons(view);
    };
    const nc = view.querySelector('#newCoupon');
    if (nc) nc.onclick = () => couponDialog({}, infl, () => VIEWS.coupons(view));
    const nb = view.querySelector('#newBundle');
    if (nb) nb.onclick = async () => {
      const v = await ask({ title: 'New combo', html: '<p class="muted">The best combo applies by itself in the bag and at the store counter.</p>', fields: [
        { name: 'qty', label: 'How many tees', type: 'number', required: true, value: 3 },
        { name: 'price', label: 'For (₹ total)', type: 'number', required: true, placeholder: 'e.g. 1499' },
        { name: 'scope', label: 'Which tees', type: 'select', value: '', options: [['', 'Any product']].concat(products.map(([id, n]) => [id, `Only ${n}`])) },
        { name: 'name', label: 'Name customers see', placeholder: 'Any 3 for ₹1,499' }], ok: 'Create combo' });
      if (!v) return;
      try {
        await q(sb.rpc('save_bundle', { p: { name: v.name || `Any ${v.qty} for ${inr(v.price)}`, qty: Number(v.qty), price: num(v.price), product_ids: v.scope ? [Number(v.scope)] : [] } }));
        C.confetti(0.5); toast('Combo is live'); VIEWS.coupons(view);
      } catch (e) { toast(errText(e), true); }
    };
  };

  async function couponDialog(pre, infl, done) {
    const v = await ask({ title: 'New coupon', fields: [
      { name: 'code', label: 'Code', required: true, value: pre.code || '', placeholder: 'e.g. DIWALI15' },
      { name: 'kind', label: 'Type', type: 'select', value: 'percent', options: [['percent', '% off'], ['flat', '₹ off']] },
      { name: 'value', label: 'Value', type: 'number', required: true, placeholder: '15' },
      { name: 'channel', label: 'Where it works', type: 'select', value: pre.channel || 'both', options: [['both', 'Online + in person'], ['online', 'Online only'], ['store', 'In person only (store, events, stalls)']] },
      { name: 'min_order', label: 'Minimum order (₹)', type: 'number', value: 0 },
      { name: 'max_discount', label: 'Maximum discount (₹, optional)', type: 'number' },
      { name: 'per', label: 'Uses per customer', type: 'number', value: 1 },
      { name: 'limit', label: 'Total uses (optional)', type: 'number' },
      { name: 'ends', label: 'Ends on (optional)', type: 'date' },
      { name: 'first', label: 'Only for a first order?', type: 'select', value: 'no', options: [['no', 'No'], ['yes', 'Yes']] },
      { name: 'inf', label: 'Influencer (special influencer discount)', type: 'select', value: pre.influencer_id || '', options: [['', '—']].concat(infl.map((i) => [i.id, i.name])) },
      { name: 'owner', label: 'Personal code of (sales are credited to them)', type: 'select', value: pre.member_id || '', options: [['', '—']].concat(state.members.filter((m) => m.active).map((m) => [m.id, m.name])) },
      { name: 'desc', label: 'Note (optional)', placeholder: 'e.g. Diwali Instagram post' }], ok: 'Create coupon' });
    if (!v) return;
    try {
      await q(sb.rpc('save_coupon', { p: { code: v.code, kind: v.kind, value: num(v.value), channel: v.channel, min_order: num(v.min_order) || 0, max_discount: num(v.max_discount),
        per_customer_limit: num(v.per) || 1, usage_limit: num(v.limit), ends_at: v.ends ? new Date(`${v.ends}T23:59:59+05:30`).toISOString() : null,
        first_order_only: v.first === 'yes', influencer_id: v.inf ? Number(v.inf) : null, member_id: v.owner || null, description: v.desc || null } }));
      C.confetti(0.5); toast(`${v.code.toUpperCase()} is live`); done();
    } catch (e) { toast(errText(e), true); }
  }

  // ================================================================ INFLUENCERS
  VIEWS.influencers = async (view) => {
    await loadStock();
    const rows = await q(sb.from('influencer_report').select('*').order('revenue', { ascending: false }));
    view.innerHTML = `${backBtn}
      <h1>Influencers</h1>
      <p class="sub">Give each creator their own coupon code. Sales with that code, what we paid them and gifted tees are tracked here.</p>
      <button class="btn block" id="newInf" style="margin-bottom:12px">+ Add influencer</button>
      ${rows.length ? rows.map((i) => { const cost = Number(i.paid); const roi = cost ? Number(i.revenue) / cost : null; return `<div class="card" data-i="${i.id}">
        <div class="row"><div><b>${esc(i.name)}</b> <span class="muted">${esc(i.handle || '')}${i.followers ? ` · ${Number(i.followers).toLocaleString('en-IN')} followers` : ''}</span></div>${i.active ? '' : '<span class="pill cancelled">Inactive</span>'}</div>
        <div class="kpi-row"><div><span>Orders</span><b>${i.orders}</b></div><div><span>Sales</span><b>${esc(inr(i.revenue))}</b></div><div><span>Paid</span><b>${esc(inr(cost))}</b></div><div><span>Tees gifted</span><b>${i.gifts}</b></div></div>
        <div class="muted">${i.codes ? `Codes: <b>${esc(i.codes)}</b>` : 'No code yet'}${roi !== null ? ` · <b class="${roi >= 1 ? 'pos' : 'neg'}">${roi.toFixed(1)}× return</b>` : ''}</div>
        <div class="actions">${isPartner() ? '<button class="btn small" data-code="1">Create code</button>' : ''}<button class="btn small outline" data-gift="1">Gift tees</button><button class="btn small outline" data-pay="1">Record payment</button><button class="btn small ghost" data-ed="1">Edit</button></div>
      </div>`; }).join('') : '<div class="empty">No influencers yet.</div>'}`;
    wireBack(view);
    const form = async (i = {}) => {
      const v = await ask({ title: i.id ? 'Edit influencer' : 'Add influencer', fields: [
        { name: 'name', label: 'Name', required: true, value: i.name || '' }, { name: 'handle', label: 'Handle', value: i.handle || '', placeholder: '@name' },
        { name: 'platform', label: 'Platform', type: 'select', value: i.platform || 'Instagram', options: [['Instagram', 'Instagram'], ['YouTube', 'YouTube'], ['Snapchat', 'Snapchat'], ['Other', 'Other']] },
        { name: 'followers', label: 'Followers', type: 'number', value: i.followers || '' }, { name: 'phone', label: 'Phone', value: i.phone || '' },
        { name: 'city', label: 'City', value: i.city || '' }, { name: 'notes', label: 'Notes (deal, deliverables)', type: 'textarea', value: i.notes || '' },
        ...(i.id ? [{ name: 'active', label: 'Status', type: 'select', value: i.active ? '1' : '0', options: [['1', 'Active'], ['0', 'Inactive']] }] : [])], ok: 'Save' });
      if (!v) return;
      try { await q(sb.rpc('save_influencer', { p: { id: i.id || null, ...v, followers: num(v.followers), active: v.active ? v.active === '1' : true } })); VIEWS.influencers(view); } catch (e) { toast(errText(e), true); }
    };
    view.querySelector('#newInf').onclick = () => form();
    view.querySelectorAll('[data-i]').forEach((card) => {
      const i = rows.find((x) => x.id === Number(card.dataset.i));
      card.querySelector('[data-ed]').onclick = () => form(i);
      const cb = card.querySelector('[data-code]');
      if (cb) cb.onclick = () => couponDialog({ code: (i.handle || i.name).replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 14) + '10', channel: 'online', influencer_id: i.id }, [i], () => VIEWS.influencers(view));
      card.querySelector('[data-pay]').onclick = () => { state.newType = 'expense'; state.newCat = 'influencer'; go('more', 'requests'); };
      card.querySelector('[data-gift]').onclick = async () => {
        const vars = state.stock.filter((v) => v.active && v.stock > 0);
        const v = await ask({ title: `Gift tees to ${i.name}`, html: `<p class="muted">Stock goes out only after all ${partners().length} partners approve.</p>`, fields: [
          { name: 'v', label: 'Which tee', type: 'select', options: vars.map((x) => [x.variant_id, `${x.product_name} · ${x.colour} / ${x.size} (${x.stock})`]) },
          { name: 'qty', label: 'Pieces', type: 'number', value: 1, required: true }, { name: 'why', label: 'For what?', required: true, placeholder: 'Reel + 2 stories' }], ok: 'Send for approval' });
        if (!v) return;
        try { await q(sb.rpc('raise_request', { p_type: 'stock_writeoff', p_amount: null, p_description: `Gift to ${i.name}: ${v.why}`, p_proof_path: null, p_payload: { variant_id: Number(v.v), qty: Number(v.qty), influencer_id: i.id } })); toast('Sent to partners'); } catch (e) { toast(errText(e), true); }
      };
    });
  };

  // ================================================================ PARTNER VOTING
  VIEWS.decisions = async (view) => {
    const rows = await q(sb.from('request_board').select('*').eq('type', 'decision').order('created_at', { ascending: false }).limit(100));
    view.innerHTML = `${backBtn}
      <h1>Partner voting</h1>
      <p class="sub">Big calls (a new drop, a second store, hiring, a price strategy) get proposed, voted and stored forever. No more “who agreed to this?”.</p>
      <button class="btn block" id="newDec" style="margin-bottom:12px">+ Propose a decision</button>
      ${rows.length ? rows.map((r) => requestCard(r)).join('') : '<div class="empty">No decisions yet.</div>'}`;
    wireBack(view);
    wireRequestCards(view, () => VIEWS.decisions(view));
    view.querySelector('#newDec').onclick = async () => {
      const n = partners().length;
      const v = await ask({ title: 'Propose a decision', fields: [
        { name: 'title', label: 'Decision', required: true, placeholder: 'Launch Drop 02 with 300 pieces in December' },
        { name: 'details', label: 'Details (budget, dates, who does what)', type: 'textarea' },
        { name: 'rule', label: 'Passes with', type: 'select', value: 'all', options: [['all', `All ${n} partners`], ['majority', `Majority (${Math.floor(n / 2) + 1} of ${n})`]] }], ok: 'Start the vote' });
      if (!v) return;
      try { await q(sb.rpc('raise_request', { p_type: 'decision', p_amount: null, p_description: v.title, p_proof_path: null, p_payload: { rule: v.rule, details: v.details || null } })); toast('Vote started. Your yes is counted.'); VIEWS.decisions(view); } catch (e) { toast(errText(e), true); }
    };
  };

  // ================================================================ REPORTS (partners)
  const REPORTS = [['demand', 'Best sellers'], ['people', 'Sales by person'], ['customers', 'Customers'], ['deadstock', 'Slow stock'], ['returns', 'Returns & RTO'], ['profit', 'Profit per tee'], ['monthly', 'Monthly report'], ['ads', 'Ads & influencers'], ['forecast', 'Cash forecast'], ['investor', 'Investor view']];
  VIEWS.reports = async (view) => {
    const list = isPartner() ? REPORTS : REPORTS.filter(([k]) => k === 'demand');
    const r = list.some(([k]) => k === state.report) ? state.report : 'demand';
    view.innerHTML = `${state.tab === 'more' ? backBtn : ''}<h1>Reports</h1>
      <div class="seg">${list.map(([k, l]) => `<button data-r="${k}" class="${r === k ? 'on' : ''}">${l}</button>`).join('')}</div><div id="rep"><div class="empty">Loading…</div></div>`;
    wireBack(view);
    view.querySelectorAll('[data-r]').forEach((b) => { b.onclick = () => { state.report = b.dataset.r; VIEWS.reports(view); }; });
    const el = view.querySelector('#rep');
    try { await REPORT_VIEWS[r](el); } catch (e) { el.innerHTML = `<div class="card warnbox">${esc(errText(e))}</div>`; }
  };
  const bars = (rows, key, label) => {
    const max = Math.max(1, ...rows.map((x) => Math.abs(Number(x[key]) || 0)));
    return `<div class="hbars">${rows.map((x) => `<div class="hbar"><span class="l">${esc(label(x))}</span><span class="b"><i class="${Number(x[key]) < 0 ? 'neg' : ''}" style="width:${(Math.abs(Number(x[key]) || 0) / max) * 100}%"></i></span><span class="v">${esc(inr(x[key]))}</span></div>`).join('')}</div>`;
  };
  const REPORT_VIEWS = {
    async demand(el) { await demandCard(el); },

    async people(el) {
      const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); return monthKey(d); });
      const m = state.repMonth2 || months[0];
      const rows = await q(sb.rpc('target_progress', { p_month: m }));
      const biz = rows.find((r) => !r.member_id) || {};
      el.innerHTML = `<select id="pm" class="inline-select" style="margin-bottom:10px">${months.map((x) => `<option value="${x}" ${x === m ? 'selected' : ''}>${esc(monthName(x))}</option>`).join('')}</select>
        <div class="card table-wrap"><table><thead><tr><th>Person</th><th class="r">Bills</th><th class="r">Pieces</th><th class="r">Sales</th><th class="r">Target</th></tr></thead><tbody>
        ${rows.filter((r) => r.member_id).sort((a, b) => b.amount - a.amount).map((r) => `<tr><td>${esc(r.name)}<div class="muted">${esc(r.role)}</div></td><td class="r">${r.orders}</td><td class="r">${r.pcs}</td><td class="r">${esc(inr(r.amount))}</td>
          <td class="r">${r.target_pcs ? `${Math.round((r.pcs / r.target_pcs) * 100)}% of ${r.target_pcs}` : '—'}</td></tr>`).join('')}
        <tr><td><b>Whole business</b></td><td class="r"><b>${biz.orders || 0}</b></td><td class="r"><b>${biz.pcs || 0}</b></td><td class="r"><b>${esc(inr(biz.amount))}</b></td><td class="r">${biz.target_pcs ? `${Math.round((biz.pcs / biz.target_pcs) * 100)}%` : '—'}</td></tr></tbody></table></div>`;
      el.querySelector('#pm').onchange = (e) => { state.repMonth2 = e.target.value; REPORT_VIEWS.people(el); };
    },

    async customers(el) {
      const rows = await q(sb.from('customer_board').select('*').order('spend', { ascending: false, nullsFirst: false }).limit(300));
      const repeat = rows.filter((r) => Number(r.orders) > 1);
      el.innerHTML = `<div class="kpis"><div class="kpi"><span>Customers</span><b>${rows.length}</b></div><div class="kpi"><span>Came back</span><b>${repeat.length}</b><small>${rows.length ? Math.round((repeat.length / rows.length) * 100) : 0}% repeat</small></div>
          <div class="kpi"><span>Avg spend</span><b>${esc(inr(rows.length ? Math.round(rows.reduce((t, r) => t + Number(r.spend || 0), 0) / rows.length) : 0))}</b></div></div>
        <h2>Top customers</h2><div class="card table-wrap"><table><thead><tr><th>Customer</th><th class="r">Orders</th><th class="r">Spent</th><th class="r">Last</th></tr></thead><tbody>
        ${rows.slice(0, 50).map((r) => `<tr><td>${esc(r.name)}<div class="muted">${esc(r.phone)}${Number(r.rto) ? ` · <span class="neg">${r.rto} RTO</span>` : ''}${r.points ? ` · ${r.points} pts` : ''}</div></td><td class="r">${r.orders}</td><td class="r">${esc(inr(r.spend))}</td><td class="r">${esc(ago(r.last_order))}</td></tr>`).join('')}</tbody></table></div>
        <p class="hint">Message your repeat customers first when a new drop lands. They buy again.</p>`;
    },

    async deadstock(el) {
      await loadStock();
      const d = await q(sb.rpc('demand_report', { p_days: 30 }));
      const sold = new Map((d.products || []).map((x) => [x.product_id, Number(x.units)]));
      const prods = [...new Map(state.stock.filter((v) => v.active && v.product_active).map((v) => [v.product_id, v])).values()].map((p) => {
        const pcs = state.stock.filter((v) => v.product_id === p.product_id).reduce((t, v) => t + Math.max(0, v.stock), 0);
        const s30 = sold.get(p.product_id) || 0;
        return { ...p, pcs, s30, days: s30 ? Math.round((pcs / s30) * 30) : null };
      }).filter((p) => p.pcs > 0).sort((a, b) => (b.days ?? 9999) - (a.days ?? 9999));
      el.innerHTML = `<p class="sub">Tees with stock that is not moving. "Days of stock" = how long the current stock lasts at the last 30 days' speed.</p>
        <div class="card table-wrap"><table><thead><tr><th>Tee</th><th class="r">In stock</th><th class="r">Sold 30d</th><th class="r">Days of stock</th><th class="r">Money stuck</th></tr></thead><tbody>
        ${prods.map((p) => `<tr><td>${esc(p.product_name)}</td><td class="r">${p.pcs}</td><td class="r">${p.s30}</td><td class="r ${p.days === null || p.days > 90 ? 'neg' : ''}">${p.days === null ? 'not selling' : p.days}</td>
          <td class="r">${esc(inr(p.pcs * Number(p.cost_price || p.price)))}</td></tr>`).join('')}</tbody></table></div>
        <p class="hint">Ideas for slow stock: put it in a combo, give it to an influencer, or run a store-only coupon.</p>`;
    },

    async returns(el) {
      const [orders, svc] = await Promise.all([
        q(sb.from('orders').select('id,status,payment_method,channel,address,total,created_at').gte('created_at', istStart(new Date(Date.now() - 90 * 864e5).toLocaleDateString('en-CA')))),
        q(sb.from('service_board').select('*').order('created_at', { ascending: false }).limit(100)),
      ]);
      const shipped = orders.filter((o) => ['shipped', 'delivered', 'rto', 'returned'].includes(o.status));
      const rto = shipped.filter((o) => o.status === 'rto');
      const rate = (a) => (a.length ? Math.round((a.filter((o) => o.status === 'rto').length / a.length) * 100) : 0);
      const cod = shipped.filter((o) => o.payment_method === 'cod'), pre = shipped.filter((o) => o.payment_method !== 'cod');
      const cities = {};
      rto.forEach((o) => { const c = (o.address && o.address.city) || '—'; cities[c] = (cities[c] || 0) + 1; });
      el.innerHTML = `<p class="sub">Last 90 days of shipped orders.</p>
        <div class="kpis"><div class="kpi"><span>RTO rate</span><b class="${rate(shipped) > 20 ? 'neg' : ''}">${rate(shipped)}%</b><small>${rto.length} of ${shipped.length}</small></div>
          <div class="kpi"><span>COD RTO</span><b>${rate(cod)}%</b></div><div class="kpi"><span>Prepaid RTO</span><b>${rate(pre)}%</b></div>
          <div class="kpi"><span>Exchanges</span><b>${svc.filter((r) => r.kind === 'replacement').length}</b></div><div class="kpi"><span>Returns</span><b>${svc.filter((r) => r.kind === 'return').length}</b></div></div>
        ${Object.keys(cities).length ? `<h2>RTO by city</h2><div class="card">${Object.entries(cities).sort((a, b) => b[1] - a[1]).map(([c, n]) => `<div class="row"><span>${esc(c)}</span><b>${n}</b></div>`).join('')}
          <div class="hint">Cities with many RTOs: block COD for their pincodes in Settings.</div></div>` : ''}
        <h2>Why customers asked for exchange / return</h2><div class="card">${svc.slice(0, 20).map((r) => `<div style="padding:6px 0;border-bottom:1px solid var(--line)">${esc(r.reason)}<div class="muted">${esc(r.order_no)} · ${r.kind === 'replacement' ? 'exchange' : 'return'} · ${esc(r.status)}</div></div>`).join('') || '<div class="muted">None yet.</div>'}</div>`;
    },
    async profit(el) {
      const [prod, drops] = await Promise.all([q(sb.from('product_profit').select('*').order('profit', { ascending: false })), q(sb.from('drop_profit').select('*').order('profit', { ascending: false }))]);
      const noCost = prod.filter((p) => !Number(p.cost_price) && Number(p.units_sold));
      const tot = prod.reduce((a, p) => ({ rev: a.rev + Number(p.revenue), cost: a.cost + Number(p.cost), profit: a.profit + Number(p.profit), units: a.units + Number(p.units_sold) }), { rev: 0, cost: 0, profit: 0, units: 0 });
      el.innerHTML = `<p class="sub">Paid, not returned orders. Revenue is after every discount; cost is what that tee cost when it was sold.</p>
        <div class="grid"><div class="stat"><div class="k">Gross profit</div><div class="v">${signed(tot.profit)}</div></div><div class="stat"><div class="k">Margin</div><div class="v">${tot.rev ? Math.round((tot.profit / tot.rev) * 100) : 0}%</div></div>
          <div class="stat"><div class="k">Profit per tee</div><div class="v">${esc(inr(tot.units ? Math.round(tot.profit / tot.units) : 0))}</div></div><div class="stat"><div class="k">Tees sold</div><div class="v">${tot.units}</div></div></div>
        ${noCost.length ? `<div class="card warnbox" style="margin-top:12px">${noCost.length} product(s) have no cost price, so their profit looks too high: ${noCost.map((p) => esc(p.name)).join(', ')}. Set it in Stock → Edit.</div>` : ''}
        <h2>By drop</h2>${drops.length ? bars(drops, 'profit', (d) => d.drop_name) : '<div class="empty">No sales yet.</div>'}
        <div class="card table-wrap" style="margin-top:10px"><table><thead><tr><th>Drop</th><th class="r">Tees</th><th class="r">Revenue</th><th class="r">Margin</th></tr></thead><tbody>
          ${drops.map((d) => `<tr><td>${esc(d.drop_name)}</td><td class="r">${d.units_sold}</td><td class="r">${esc(inr(d.revenue))}</td><td class="r">${d.margin_pct ?? '—'}%</td></tr>`).join('')}</tbody></table></div>
        <h2>By tee</h2><div class="card table-wrap"><table><thead><tr><th>Tee</th><th class="r">Sold</th><th class="r">Cost/pc</th><th class="r">Profit</th><th class="r">Per tee</th></tr></thead><tbody>
          ${prod.map((p) => `<tr><td>${esc(p.name)}<div class="muted">${esc(inr(p.price))} · ${p.margin_pct ?? '—'}%</div></td><td class="r">${p.units_sold}</td><td class="r">${Number(p.cost_price) ? esc(inr(p.cost_price)) : '<span class="neg">not set</span>'}</td>
            <td class="r">${signed(p.profit)}</td><td class="r">${esc(inr(Number(p.units_sold) ? Math.round(p.profit / p.units_sold) : 0))}</td></tr>`).join('')}</tbody></table></div>`;
    },

    async monthly(el) {
      const [rows, pos] = await Promise.all([q(sb.from('monthly_report').select('*').order('month', { ascending: false })), q(sb.from('partner_positions').select('*'))]);
      if (!rows.length) { el.innerHTML = '<div class="empty">No activity yet.</div>'; return; }
      const m = state.repMonth && rows.find((x) => x.month === state.repMonth) ? state.repMonth : rows[0].month;
      const r = rows.find((x) => x.month === m);
      const end = new Date(`${m}T00:00:00`); end.setMonth(end.getMonth() + 1);
      const [ledger, top] = await Promise.all([
        q(sb.from('ledger').select('kind,amount,category,description').gte('entry_date', m).lt('entry_date', end.toISOString().slice(0, 10))),
        q(sb.from('order_board').select('items,status,created_at').gte('created_at', istStart(m)).lt('created_at', istStart(end.toISOString().slice(0, 10))).neq('status', 'cancelled')),
      ]);
      const byCat = {};
      ledger.filter((x) => x.kind === 'expense').forEach((x) => { const k = x.category || 'other'; byCat[k] = (byCat[k] || 0) - Number(x.amount); });
      const tees = {};
      top.forEach((o) => (o.items || []).forEach((i) => { tees[i.name] = (tees[i.name] || 0) + i.qty; }));
      const topTees = Object.entries(tees).sort((a, b) => b[1] - a[1]).slice(0, 5);
      const net = Number(r.net_result);
      const rule = net >= 0 ? state.settings.profit_rule : state.settings.loss_rule;
      const split = state.settings.custom_split || {};
      const share = (p) => (rule === 'equal' ? 1 / pos.length : rule === 'investment' ? Number(p.investment_share) : Number(split[p.partner_id] || 0) / 100);
      const catName = (k) => (EXP_CAT.find((c) => c[0] === k) || [0, k])[1];
      const html = `
        <h1>${esc(biz().name)} · ${esc(monthName(m))}</h1><p class="muted">Monthly partner report · made ${esc(day(new Date()))}</p>
        <h2>Money</h2><table>
          <tr><td>Sales</td><td class="r">${esc(inr(r.sales))}</td></tr><tr><td>Refunds</td><td class="r">− ${esc(inr(r.refunds))}</td></tr>
          <tr><td>Other income</td><td class="r">${esc(inr(r.other_income))}</td></tr>
          ${Object.entries(byCat).map(([k, v]) => `<tr><td>Expense · ${esc(catName(k))}</td><td class="r">− ${esc(inr(v))}</td></tr>`).join('')}
          <tr><td><b>Net result for the month</b></td><td class="r big">${esc(inr(net))}</td></tr>
          <tr><td class="muted">Cost of the tees sold (for margin, already inside production expenses)</td><td class="r muted">${esc(inr(r.cost_of_goods))}</td></tr></table>
        <h2>Each partner's share of this month (${esc(RULE[rule] || rule)})</h2><table>
          ${pos.map((p) => `<tr><td>${esc(p.name)}</td><td class="r">${(share(p) * 100).toFixed(1)}%</td><td class="r"><b>${esc(inr(Math.round(net * share(p))))}</b></td></tr>`).join('')}</table>
        <h2>Orders & customers</h2><table>
          <tr><td>Orders</td><td class="r">${r.orders}</td></tr><tr><td>Pieces</td><td class="r">${r.pieces}</td></tr><tr><td>Average order</td><td class="r">${esc(inr(r.avg_order_value))}</td></tr>
          <tr><td>New customers</td><td class="r">${r.new_customers}</td></tr><tr><td>Repeat customers</td><td class="r">${r.repeat_customers}</td></tr>
          <tr><td>RTO / returned</td><td class="r">${r.rto_orders} / ${r.returned_orders}${r.orders ? ` (${Math.round(((Number(r.rto_orders) + Number(r.returned_orders)) / r.orders) * 100)}%)` : ''}</td></tr>
          <tr><td>Ad spend</td><td class="r">${esc(inr(r.ad_spend))}${Number(r.ad_spend) && Number(r.new_customers) ? ` · ${esc(inr(Math.round(r.ad_spend / r.new_customers)))} per new customer` : ''}</td></tr></table>
        ${topTees.length ? `<h2>Best sellers</h2><table>${topTees.map(([n, c]) => `<tr><td>${esc(n)}</td><td class="r">${c} pcs</td></tr>`).join('')}</table>` : ''}
        <div class="sig">${pos.map((p) => `<div>${esc(p.name)}</div>`).join('')}</div>`;
      el.innerHTML = `<div class="row" style="align-items:center;margin-bottom:10px"><select id="repM" class="inline-select">${rows.map((x) => `<option value="${x.month}" ${x.month === m ? 'selected' : ''}>${esc(monthName(x.month))}</option>`).join('')}</select>
          <span><button class="btn small outline" id="repPrint">${NATIVE ? 'Share' : 'Print / PDF'}</button> <button class="btn small good" id="repWa">WhatsApp summary</button></span></div>
        <div class="card report">${html}</div>`;
      el.querySelector('#repM').onchange = (e) => { state.repMonth = e.target.value; REPORT_VIEWS.monthly(el); };
      el.querySelector('#repPrint').onclick = () => printDoc(`Z-SHIRTS ${monthName(m)}`, html);
      el.querySelector('#repWa').onclick = () => openExternal(`https://wa.me/?text=${encodeURIComponent([`*Z-SHIRTS · ${monthName(m)}*`, `Sales ${inr(r.sales)} · ${r.orders} orders · ${r.pieces} pcs`,
        `Expenses ${inr(r.expenses)} (ads ${inr(r.ad_spend)})`, `*Net ${inr(net)}*`, ...pos.map((p) => `${p.name}: ${inr(Math.round(net * share(p)))}`),
        `New customers ${r.new_customers} · repeat ${r.repeat_customers} · RTO ${r.rto_orders}`].join('\n'))}`);
    },

    async ads(el) {
      const [ads, infl, months] = await Promise.all([q(sb.from('ad_report').select('*').order('spend', { ascending: false })), q(sb.from('influencer_report').select('*')), q(sb.from('monthly_report').select('month,ad_spend,new_customers,sales').order('month'))]);
      const spend = ads.reduce((t, a) => t + Number(a.spend), 0);
      const rev = ads.reduce((t, a) => t + Number(a.revenue), 0);
      const newC = months.reduce((t, m) => t + Number(m.new_customers), 0);
      el.innerHTML = `<p class="sub">Tag every ad expense with a campaign name, and use the same word in the shop link: <code>${esc(shopUrl())}?utm_campaign=diwali</code>. Orders from that link are counted here.</p>
        <div class="grid"><div class="stat"><div class="k">Ad spend</div><div class="v">${esc(inr(spend))}</div></div><div class="stat"><div class="k">Sales from tagged links</div><div class="v">${esc(inr(rev))}</div></div>
          <div class="stat"><div class="k">Return on ads</div><div class="v ${rev >= spend ? 'pos' : 'neg'}">${spend ? `${(rev / spend).toFixed(1)}×` : '—'}</div></div><div class="stat"><div class="k">Cost per new customer</div><div class="v">${newC && spend ? esc(inr(Math.round(spend / newC))) : '—'}</div></div></div>
        <h2>Campaigns</h2>${ads.length ? `<div class="card table-wrap"><table><thead><tr><th>Campaign</th><th class="r">Spend</th><th class="r">Orders</th><th class="r">Sales</th><th class="r">ROAS</th></tr></thead><tbody>
          ${ads.map((a) => `<tr><td>${esc(a.campaign)}</td><td class="r">${esc(inr(a.spend))}</td><td class="r">${a.orders}</td><td class="r">${esc(inr(a.revenue))}</td><td class="r ${Number(a.revenue) >= Number(a.spend) ? 'pos' : 'neg'}">${Number(a.spend) ? (a.revenue / a.spend).toFixed(1) : '—'}×</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No ad expenses yet. Add one in Money entry → Expense → Ads.</div>'}
        <h2>Monthly ad spend</h2>${months.length ? bars(months.slice(-6), 'ad_spend', (m) => shortMonth(m.month)) : ''}
        <h2>Influencers</h2>${infl.length ? `<div class="card table-wrap"><table><thead><tr><th>Name</th><th class="r">Paid</th><th class="r">Gifts</th><th class="r">Sales</th></tr></thead><tbody>
          ${infl.map((i) => `<tr><td>${esc(i.name)}<div class="muted">${esc(i.codes || '')}</div></td><td class="r">${esc(inr(i.paid))}</td><td class="r">${i.gifts}</td><td class="r">${esc(inr(i.revenue))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No influencers yet.</div>'}`;
    },

    async forecast(el) {
      const [sum, months, pend, cod, pay] = await Promise.all([
        q(sb.from('business_summary').select('*').single()),
        q(sb.from('monthly_report').select('*').order('month')),
        q(sb.from('request_board').select('type,amount').eq('status', 'pending')),
        q(sb.from('orders').select('total').eq('payment_method', 'cod').eq('payment_status', 'pending').in('status', ['confirmed', 'packed', 'shipped'])),
        q(sb.from('employee_pay').select('monthly_salary')),
      ]);
      const thisM = monthKey();
      const past = months.filter((m) => m.month < thisM).slice(-3);
      const basis = past.length ? past : months.slice(-1);
      const avg = (k) => (basis.length ? basis.reduce((t, m) => t + Number(m[k] || 0), 0) / basis.length : 0);
      const inflow = avg('sales') - avg('refunds') + avg('other_income');
      const outflow = avg('expenses');
      const netM = inflow - outflow;
      const bal = Number(sum.cash_balance);
      const pendingOut = pend.filter((r) => ['expense', 'partner_payout'].includes(r.type)).reduce((t, r) => t + Number(r.amount || 0), 0);
      const codIn = cod.reduce((t, o) => t + Number(o.total), 0) * 0.7; // ~30% of COD comes back as RTO
      const salary = pay.reduce((t, p) => t + Number(p.monthly_salary), 0);
      const start = bal + codIn - pendingOut;
      const rows = [1, 2, 3].map((i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + i); return { month: monthKey(d), bal: Math.round(start + netM * i) }; });
      el.innerHTML = `<p class="sub">Based on the average of ${basis.length ? `the last ${basis.length} month(s)` : 'no full month yet'}. A guide, not a promise: drops and big orders change it.</p>
        <div class="grid">
          <div class="stat hero"><div class="k">Money in the business now</div><div class="v">${esc(inr(bal))}</div></div>
          <div class="stat"><div class="k">Avg money in / month</div><div class="v pos">${esc(inr(Math.round(inflow)))}</div></div>
          <div class="stat"><div class="k">Avg money out / month</div><div class="v neg">${esc(inr(Math.round(outflow)))}</div></div>
          <div class="stat"><div class="k">COD on the way (after ~30% RTO)</div><div class="v">${esc(inr(Math.round(codIn)))}</div></div>
          <div class="stat"><div class="k">Waiting for approval to pay</div><div class="v">${esc(inr(pendingOut))}</div></div></div>
        <h2>Next 3 months</h2>${bars(rows, 'bal', (x) => shortMonth(x.month))}
        <div class="card" style="margin-top:12px">${netM >= 0 ? `<b class="pos">Growing about ${esc(inr(Math.round(netM)))} a month.</b>` : `<b class="neg">Spending ${esc(inr(Math.round(-netM)))} more than earning each month.</b>
          ${start > 0 ? ` Money lasts about <b>${Math.max(0, Math.floor(start / -netM))} month(s)</b> at this pace.` : ' Add capital or cut costs.'}`}
          ${salary ? `<div class="muted" style="margin-top:6px">Includes salary of about ${esc(inr(salary))} a month once it is booked as an expense.</div>` : ''}</div>`;
    },

    async investor(el) {
      const [sum, months, prod, cust, pos] = await Promise.all([
        q(sb.from('business_summary').select('*').single()), q(sb.from('monthly_report').select('*').order('month')),
        q(sb.from('product_profit').select('revenue,profit,units_sold')), q(sb.from('customer_board').select('orders,spend,rto')), q(sb.from('partner_positions').select('*')),
      ]);
      const rev = Number(sum.total_sales) - Number(sum.total_refunds);
      const gp = prod.reduce((t, p) => t + Number(p.profit), 0);
      const prodRev = prod.reduce((t, p) => t + Number(p.revenue), 0);
      const orders = months.reduce((t, m) => t + Number(m.orders), 0);
      const rto = months.reduce((t, m) => t + Number(m.rto_orders) + Number(m.returned_orders), 0);
      const ad = months.reduce((t, m) => t + Number(m.ad_spend), 0);
      const newC = months.reduce((t, m) => t + Number(m.new_customers), 0);
      const repeat = cust.length ? cust.filter((c) => Number(c.orders) > 1).length / cust.length : 0;
      const aov = orders ? rev / orders : 0;
      const ordersPerCust = cust.length ? cust.reduce((t, c) => t + Number(c.orders), 0) / cust.length : 0;
      const margin = prodRev ? gp / prodRev : 0;
      const ltv = aov * ordersPerCust * margin;
      const cac = newC ? ad / newC : 0;
      const capital = pos.reduce((t, p) => t + Number(p.capital), 0);
      const last = months.filter((m) => m.month < monthKey()).slice(-2);
      const growth = last.length === 2 && Number(last[0].sales) ? (last[1].sales - last[0].sales) / last[0].sales : null;
      const kpi = (k, v, note = '') => `<div class="kpi"><span>${k}</span><b>${v}</b>${note ? `<small>${note}</small>` : ''}</div>`;
      const html = `<h1>${esc(biz().name)} · key numbers</h1><p class="muted">As of ${esc(day(new Date()))} · from the locked books and order history</p>
        <div class="kpis">
          ${kpi('Net revenue', esc(inr(rev)))}${kpi('Orders', orders)}${kpi('Average order', esc(inr(Math.round(aov))))}
          ${kpi('Gross margin', `${Math.round(margin * 100)}%`, 'after discounts, on tees sold')}${kpi('Repeat customers', `${Math.round(repeat * 100)}%`, `${cust.length} customers`)}${kpi('Returns + RTO', `${orders ? Math.round((rto / orders) * 100) : 0}%`)}
          ${kpi('Cost per new customer', cac ? esc(inr(Math.round(cac))) : '—', 'ad spend ÷ new customers')}${kpi('Customer lifetime profit', esc(inr(Math.round(ltv))))}${kpi('LTV : CAC', cac ? `${(ltv / cac).toFixed(1)}×` : '—', 'above 3× is healthy')}
          ${kpi('Capital invested', esc(inr(capital)))}${kpi('Profit / loss so far', esc(inr(sum.business_result)))}${kpi('Month-on-month sales', growth === null ? '—' : `${growth >= 0 ? '+' : ''}${Math.round(growth * 100)}%`)}
        </div>
        <h2>Monthly net sales</h2>
        <table>${months.slice(-12).map((m) => `<tr><td>${esc(monthName(m.month))}</td><td class="r">${esc(inr(Number(m.sales) - Number(m.refunds)))}</td><td class="r">${m.orders} orders</td><td class="r">${esc(inr(m.net_result))} net</td></tr>`).join('')}</table>
        <h2>Ownership & capital</h2><table>${pos.map((p) => `<tr><td>${esc(p.name)}</td><td class="r">${esc(inr(p.capital))}</td><td class="r">${esc(pct(p.result_share))} of profit</td></tr>`).join('')}</table>
        <p class="muted" style="margin-top:16px">Every rupee is in permanent books: no entry can be edited or deleted, money out needs partner approval, and each month is signed by all partners.</p>`;
      el.innerHTML = `<div class="actions" style="margin:0 0 10px"><button class="btn small outline" id="invPrint">${NATIVE ? 'Share' : 'Print / save PDF'}</button></div>
        <div class="card report investor">${html}</div>
        <h2>Monthly net sales</h2>${months.length ? bars(months.slice(-6).map((m) => ({ ...m, net: Number(m.sales) - Number(m.refunds) })), 'net', (m) => shortMonth(m.month)) : ''}`;
      el.querySelector('#invPrint').onclick = () => printDoc('Z-SHIRTS key numbers', html);
    },
  };

  // ---------------- COD blocked pincodes (in Shop settings)
  async function codPins(root) {
    const rows = await q(sb.from('cod_blocked_pincodes').select('*').order('created_at', { ascending: false }));
    root.innerHTML = `<h2>No-COD pincodes</h2><p class="sub">Pincodes with too many RTOs. Customers there can only pay online.</p>
      <div class="card">${rows.map((r) => `<div class="row" style="padding:6px 0"><span><b>${esc(r.pincode)}</b> <span class="muted">${esc(r.reason || '')}</span></span><button class="linkish" data-unpin="${esc(r.pincode)}">Allow COD</button></div>`).join('') || '<div class="muted">None yet.</div>'}
        <button class="btn small outline" id="addPin" style="margin-top:10px">+ Block COD for a pincode</button></div>`;
    root.querySelectorAll('[data-unpin]').forEach((b) => { b.onclick = async () => { try { await q(sb.rpc('block_cod_pincode', { p_pincode: b.dataset.unpin, p_reason: null, p_block: false })); codPins(root); } catch (e) { toast(errText(e), true); } }; });
    root.querySelector('#addPin').onclick = async () => {
      const v = await ask({ title: 'Block COD', fields: [{ name: 'pin', label: 'Pincode', required: true }, { name: 'why', label: 'Why?', placeholder: '3 RTOs in a month' }], ok: 'Block COD' });
      if (!v) return;
      try { await q(sb.rpc('block_cod_pincode', { p_pincode: v.pin.trim(), p_reason: v.why || null, p_block: true })); codPins(root); } catch (e) { toast(errText(e), true); }
    };
  }

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
