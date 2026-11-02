/* Z-SHIRTS Books · Phase 1 web app
 * All money rules live in the database (supabase/migrations). This file only shows
 * screens and calls the approved functions, so even a modified app cannot break them.
 */
(() => {
  'use strict';

  const cfg = window.ZS_CONFIG || {};
  const $app = document.getElementById('app');

  // ---------------------------------------------------------------- helpers
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
  const inr = (v) => {
    const n = num(v);
    if (n === null || Number.isNaN(n)) return '—';
    const d = Number.isInteger(Math.round(n * 100) / 100) ? 0 : 2;
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
  };
  const signed = (v) => {
    const n = num(v) || 0;
    return `<span class="amt ${n < 0 ? 'neg' : n > 0 ? 'pos' : ''}">${n > 0 ? '+' : ''}${esc(inr(n))}</span>`;
  };
  const pct = (x) => (x === null || x === undefined ? '—' : `${(Number(x) * 100).toFixed(1).replace(/\.0$/, '')}%`);
  const when = (s) => new Date(s).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const day = (s) => new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const monthName = (s) => new Date(`${s}T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  const TYPE = {
    expense: 'Expense', income: 'Income', capital_in: 'Capital in', partner_payout: 'Partner payout',
    reversal: 'Reversal', setting_change: 'Change limit', share_rule: 'Profit / loss rule',
  };
  const KIND = { capital_in: 'Capital in', partner_payout: 'Partner payout', expense: 'Expense', income: 'Income' };
  const RULE = { investment: 'By investment ratio', equal: 'Equally among partners' };
  const SETTING = { employee_petty_limit: 'Employee spending limit', all_partner_limit: 'All-partner approval limit' };

  let toastTimer;
  function toast(msg, isErr = false) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = `show${isErr ? ' err' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = ''; }, isErr ? 6000 : 3000);
  }
  const errText = (e) => (e && (e.message || e.error_description)) || String(e);

  // Simple modal form. fields: [{name, label, type, required, placeholder, hint}]
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
              ? `<textarea id="f_${f.name}" name="${f.name}" ${f.required ? 'required' : ''} placeholder="${esc(f.placeholder || '')}"></textarea>`
              : `<input id="f_${f.name}" name="${f.name}" type="${f.type || 'text'}" ${f.type === 'number' ? 'step="0.01" inputmode="decimal"' : ''} ${f.required ? 'required' : ''} placeholder="${esc(f.placeholder || '')}">`}
            ${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}`).join('')}
          <div class="actions">
            <button type="button" class="btn ghost" value="cancel">Cancel</button>
            <button type="submit" class="btn ${okClass}" value="ok">${esc(ok)}</button>
          </div>
        </form>`;
      document.body.appendChild(dlg);
      const form = dlg.querySelector('form');
      dlg.querySelector('[value=cancel]').onclick = () => { dlg.close(); };
      form.onsubmit = (e) => {
        e.preventDefault();
        const out = Object.fromEntries(new FormData(form).entries());
        resolve(out);
        dlg.close();
      };
      dlg.addEventListener('close', () => { dlg.remove(); resolve(null); });
      dlg.showModal();
    });
  }

  // ---------------------------------------------------------------- setup check
  if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes('YOUR-PROJECT')) {
    $app.innerHTML = `<div class="login"><div class="logo">Z<b>-</b>SHIRTS</div>
      <div class="card warnbox" style="margin-top:24px">
        <b>Almost there.</b><p class="muted">Open <code>web/config.js</code> and paste your Supabase project URL and anon key.
        The README explains where to find them.</p></div></div>`;
    return;
  }

  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const state = { session: null, me: null, members: [], settings: {}, tab: 'home', approvalsFilter: 'mine', booksFilter: 'all' };

  const partners = () => state.members.filter((m) => m.role === 'partner' && m.active);
  const memberName = (id) => (state.members.find((m) => m.id === id) || {}).name || '—';
  const isPartner = () => state.me && state.me.role === 'partner';

  async function q(promise) {
    const { data, error } = await promise;
    if (error) throw error;
    return data;
  }

  // ---------------------------------------------------------------- auth
  function renderLogin(message = '') {
    $app.innerHTML = `
      <div class="login">
        <div class="logo">Z<b>-</b>SHIRTS</div>
        <p class="sub">Partner books · every rupee, visible to all four of you.</p>
        ${message ? `<div class="card">${esc(message)}</div>` : ''}
        <form id="loginForm" class="card">
          <label for="email">E-mail</label>
          <input id="email" type="email" autocomplete="email" required>
          <label for="password">Password</label>
          <input id="password" type="password" autocomplete="current-password" minlength="8" required>
          <button class="btn block" type="submit">Sign in</button>
          <div class="actions">
            <button class="btn ghost small" type="button" id="signup">First time? Create account</button>
            <button class="btn ghost small" type="button" id="forgot">Forgot password</button>
          </div>
          <p class="hint">Use the same e-mail the partners registered for you. Other e-mails get no access.</p>
        </form>
      </div>`;
    const email = () => document.getElementById('email').value.trim();
    const password = () => document.getElementById('password').value;

    document.getElementById('loginForm').onsubmit = async (e) => {
      e.preventDefault();
      const { error } = await sb.auth.signInWithPassword({ email: email(), password: password() });
      if (error) toast(errText(error), true);
    };
    document.getElementById('signup').onclick = async () => {
      if (!email() || password().length < 8) return toast('Enter your e-mail and a password of at least 8 characters.', true);
      const { data, error } = await sb.auth.signUp({ email: email(), password: password() });
      if (error) return toast(errText(error), true);
      if (!data.session) renderLogin('Account created. Check your e-mail and tap the confirmation link, then sign in.');
    };
    document.getElementById('forgot').onclick = async () => {
      if (!email()) return toast('Type your e-mail first.', true);
      const { error } = await sb.auth.resetPasswordForEmail(email(), { redirectTo: location.href.split('#')[0] });
      toast(error ? errText(error) : 'Password reset link sent to your e-mail.', !!error);
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
          <p class="muted">${esc(state.session.user.email)} is not registered as a partner or employee.
          Ask the partners to add this e-mail, then sign in again.</p>
          <button class="btn ghost" id="out">Sign out</button></div></div>`;
        document.getElementById('out').onclick = () => sb.auth.signOut();
        return;
      }
      const rows = await q(sb.from('settings').select('*'));
      state.settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      render();
    } catch (e) {
      $app.innerHTML = `<div class="login"><div class="card warnbox">Could not load: ${esc(errText(e))}</div></div>`;
    }
  }

  // ---------------------------------------------------------------- shell
  const TABS_PARTNER = [
    ['home', '⌂', 'Home'], ['approvals', '✓', 'Approve'], ['new', '+', 'New'],
    ['books', '₹', 'Books'], ['partners', '%', 'Partners'], ['close', '▣', 'Close'], ['log', '≡', 'Log'],
  ];
  const TABS_EMPLOYEE = [['home', '⌂', 'My requests'], ['new', '+', 'New']];

  function render() {
    const tabs = isPartner() ? TABS_PARTNER : TABS_EMPLOYEE;
    if (!tabs.some((t) => t[0] === state.tab)) state.tab = 'home';
    $app.innerHTML = `
      <div class="shell">
        <header class="top">
          <div class="brand">Z<b>-</b>SHIRTS <span class="muted" style="font-family:var(--font);font-weight:500">Books</span></div>
          <div class="who">${esc(state.me.name)} · ${esc(state.me.role)}<br><button id="out">Sign out</button></div>
        </header>
        <main id="view"><div class="empty">Loading…</div></main>
      </div>
      <nav class="tabs">${tabs.map(([k, ico, label]) =>
        `<button data-tab="${k}" class="${state.tab === k ? 'on' : ''}"><span class="ico">${ico}</span>${label}${k === 'approvals' ? '<span class="badge" id="badge" hidden></span>' : ''}</button>`).join('')}
      </nav>`;
    document.getElementById('out').onclick = () => sb.auth.signOut();
    document.querySelectorAll('nav.tabs button').forEach((b) => {
      b.onclick = () => { state.tab = b.dataset.tab; render(); window.scrollTo(0, 0); };
    });
    const view = document.getElementById('view');
    (VIEWS[state.tab] || VIEWS.home)(view).catch((e) => {
      view.innerHTML = `<div class="card warnbox">Something went wrong: ${esc(errText(e))}</div>`;
    });
    if (isPartner()) updateBadge();
  }

  async function updateBadge() {
    try {
      const rows = await q(sb.from('request_board').select('id, voters, raised_by').eq('status', 'pending'));
      const n = rows.filter((r) => !(r.voters || []).some((v) => v.member_id === state.me.id)).length;
      const b = document.getElementById('badge');
      if (b) { b.textContent = n; b.hidden = n === 0; }
    } catch (_) { /* badge is optional */ }
  }

  // ---------------------------------------------------------------- request card
  function requestDetail(r) {
    const p = r.payload || {};
    if (r.type === 'capital_in' || r.type === 'partner_payout') return `Partner: <b>${esc(memberName(p.partner_id))}</b>`;
    if (r.type === 'reversal') return `Reverses books entry <b>#${esc(p.entry_id)}</b>`;
    if (r.type === 'setting_change') return `${esc(SETTING[p.key] || p.key)} → <b>${esc(inr(p.value))}</b>`;
    if (r.type === 'share_rule') return `Profit: <b>${esc(RULE[p.profit_rule])}</b><br>Loss: <b>${esc(RULE[p.loss_rule])}</b>`;
    return '';
  }

  function requestCard(r, { canVote = true } = {}) {
    const voted = (r.voters || []).map((v) => v.member_id);
    const waiting = partners().filter((m) => !voted.includes(m.id));
    const mineVoted = voted.includes(state.me.id);
    const need = r.required_approvals;
    const pctDone = need ? Math.min(100, (r.approvals / need) * 100) : 100;
    const detail = requestDetail(r);
    return `
      <div class="card" data-id="${r.id}">
        <div class="row">
          <div><span class="pill">${esc(TYPE[r.type])}</span> <span class="pill ${r.status}">${esc(r.status)}</span></div>
          <div class="amt">${r.amount ? esc(inr(r.amount)) : ''}</div>
        </div>
        <div style="margin-top:10px;font-weight:600">${esc(r.description)}</div>
        ${detail ? `<div class="muted" style="margin-top:4px">${detail}</div>` : ''}
        <div class="muted" style="margin-top:6px">#${r.id} · by ${esc(r.raised_by_name)} · ${esc(when(r.created_at))}</div>
        ${need ? `
          <div class="progress"><span style="width:${pctDone}%"></span></div>
          <div class="muted">${r.approvals} of ${need} approvals${need === partners().length ? ' (all partners)' : ''}</div>`
          : '<div class="muted" style="margin-top:8px">Within employee limit · recorded instantly</div>'}
        ${isPartner() ? `<div class="voters">
          ${(r.voters || []).map((v) => `<span class="voter ${v.decision}" title="${esc(v.note || '')}">${esc(v.name)}${v.note && v.decision === 'reject' ? `: ${esc(v.note)}` : ''}</span>`).join('')}
          ${r.status === 'pending' ? waiting.map((m) => `<span class="voter wait">${esc(m.name)}</span>`).join('') : ''}
        </div>` : ''}
        <div class="actions">
          ${r.proof_path ? `<button class="btn ghost small" data-act="proof" data-path="${esc(r.proof_path)}">View proof</button>` : ''}
          ${r.status === 'pending' && r.raised_by === state.me.id ? `<button class="btn ghost small" data-act="cancel">Withdraw</button>` : ''}
        </div>
        ${canVote && isPartner() && r.status === 'pending' && !mineVoted ? `
          <div class="actions">
            <button class="btn bad" data-act="reject">Reject</button>
            <button class="btn good" data-act="approve">Approve</button>
          </div>` : ''}
      </div>`;
  }

  function wireRequestCards(root, reload) {
    root.querySelectorAll('[data-act]').forEach((btn) => {
      const card = btn.closest('[data-id]');
      const id = Number(card.dataset.id);
      btn.onclick = async () => {
        const act = btn.dataset.act;
        try {
          if (act === 'proof') return showProof(btn.dataset.path);
          if (act === 'approve') {
            btn.disabled = true;
            const status = await q(sb.rpc('cast_vote', { p_request_id: id, p_decision: 'approve', p_note: null }));
            toast(status === 'approved' ? 'Approved — entry is now in the books.' : 'Your approval is recorded.');
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
          reload();
          if (isPartner()) updateBadge();
        } catch (e) { btn.disabled = false; toast(errText(e), true); }
      };
    });
  }

  async function showProof(path) {
    const { data, error } = await sb.storage.from('proofs').createSignedUrl(path, 300);
    if (error) return toast(errText(error), true);
    const isPdf = /\.pdf$/i.test(path);
    await ask({
      title: 'Proof',
      html: isPdf ? `<p><a class="linkish" href="${esc(data.signedUrl)}" target="_blank" rel="noopener">Open PDF</a></p>`
                  : `<img class="proof" src="${esc(data.signedUrl)}" alt="Proof">`,
      ok: 'Close',
    });
  }

  // ---------------------------------------------------------------- views
  const VIEWS = {};

  VIEWS.home = async (view) => {
    if (!isPartner()) {
      const rows = await q(sb.from('request_board').select('*').order('created_at', { ascending: false }).limit(100));
      view.innerHTML = `
        <h1>Hi ${esc(state.me.name.split(' ')[0])}</h1>
        <p class="sub">Up to ${esc(inr(state.settings.employee_petty_limit))} is recorded instantly with a bill photo.
          Above that, partners approve it here.</p>
        <button class="btn block" id="go-new" style="margin:0 0 16px">+ Record an expense or income</button>
        ${rows.length ? rows.map((r) => requestCard(r, { canVote: false })).join('') : '<div class="empty">Nothing recorded yet.</div>'}`;
      view.querySelector('#go-new').onclick = () => { state.tab = 'new'; render(); };
      wireRequestCards(view, () => VIEWS.home(view));
      return;
    }

    const [summary, positions, pending] = await Promise.all([
      q(sb.from('business_summary').select('*').single()),
      q(sb.from('partner_positions').select('*')),
      q(sb.from('request_board').select('id, voters').eq('status', 'pending')),
    ]);
    const mine = positions.find((p) => p.partner_id === state.me.id) || {};
    const waitingMe = pending.filter((r) => !(r.voters || []).some((v) => v.member_id === state.me.id)).length;
    const ruleSet = state.settings.profit_rule && state.settings.loss_rule;

    view.innerHTML = `
      <h1>Hi ${esc(state.me.name.split(' ')[0])}</h1>
      <p class="sub">Live books — all four partners see exactly these numbers.</p>
      ${!ruleSet ? `<div class="card warnbox"><b>Profit / loss rule not agreed yet.</b>
        <p class="muted">Partner shares can't be calculated until all four approve one rule.</p>
        <button class="btn small" id="go-rule">Propose the rule</button></div>` : ''}
      ${waitingMe ? `<div class="card"><div class="row"><div><b>${waitingMe} request${waitingMe > 1 ? 's' : ''} waiting for you</b>
        <div class="muted">Nothing moves until partners approve.</div></div>
        <button class="btn small" id="go-approve">Review</button></div></div>` : ''}
      <div class="grid">
        <div class="stat hero"><div class="k">Money in the business (as per books)</div><div class="v">${esc(inr(summary.cash_balance))}</div></div>
        <div class="stat"><div class="k">Partner capital</div><div class="v">${esc(inr(summary.total_capital))}</div></div>
        <div class="stat"><div class="k">Paid out to partners</div><div class="v">${esc(inr(summary.total_payouts))}</div></div>
        <div class="stat"><div class="k">Income</div><div class="v">${esc(inr(summary.total_income))}</div></div>
        <div class="stat"><div class="k">Expenses</div><div class="v">${esc(inr(summary.total_expenses))}</div></div>
        <div class="stat" style="grid-column:1/-1"><div class="k">Business profit / loss so far</div><div class="v">${signed(summary.business_result)}</div></div>
      </div>
      <h2>Your position</h2>
      <div class="card">
        <div class="row"><span class="muted">You invested</span><span class="amt">${esc(inr(mine.capital))}</span></div>
        <div class="row"><span class="muted">Your share of capital</span><span class="amt">${esc(pct(mine.investment_share))}</span></div>
        <div class="row"><span class="muted">Paid out to you</span><span class="amt">${esc(inr(mine.payouts))}</span></div>
        <div class="row"><span class="muted">Your share of profit / loss</span>${ruleSet ? signed(mine.result_amount) : '<span class="muted">rule pending</span>'}</div>
        <div class="row" style="border-top:1px solid var(--line);padding-top:10px;margin-top:10px">
          <span><b>If settled today</b><div class="muted">positive = you get back, negative = you owe</div></span>
          ${ruleSet ? signed(mine.settlement_balance) : '<span class="muted">—</span>'}</div>
      </div>`;
    const r = view.querySelector('#go-rule');
    if (r) r.onclick = () => { state.tab = 'new'; state.newType = 'share_rule'; render(); };
    const a = view.querySelector('#go-approve');
    if (a) a.onclick = () => { state.tab = 'approvals'; state.approvalsFilter = 'mine'; render(); };
  };

  VIEWS.approvals = async (view) => {
    const rows = await q(sb.from('request_board').select('*').order('created_at', { ascending: false }).limit(200));
    const f = state.approvalsFilter;
    const list = rows.filter((r) => {
      if (f === 'mine') return r.status === 'pending' && !(r.voters || []).some((v) => v.member_id === state.me.id);
      if (f === 'pending') return r.status === 'pending';
      return r.status !== 'pending';
    });
    view.innerHTML = `
      <h1>Approvals</h1>
      <p class="sub">Expenses above ${esc(inr(state.settings.employee_petty_limit))} need 2 partners; above ${esc(inr(state.settings.all_partner_limit))} they need all ${partners().length}.
        Capital, payouts, reversals and rule changes always need all ${partners().length}.</p>
      <div class="seg">
        ${[['mine', 'Waiting for me'], ['pending', 'All pending'], ['done', 'Decided']].map(([k, l]) =>
          `<button data-f="${k}" class="${f === k ? 'on' : ''}">${l}</button>`).join('')}
      </div>
      ${list.length ? list.map((r) => requestCard(r)).join('') : `<div class="empty">${f === 'mine' ? 'All caught up ✓' : 'Nothing here.'}</div>`}`;
    view.querySelectorAll('.seg button').forEach((b) => {
      b.onclick = () => { state.approvalsFilter = b.dataset.f; VIEWS.approvals(view); };
    });
    wireRequestCards(view, () => VIEWS.approvals(view));
  };

  VIEWS.new = async (view) => {
    const types = isPartner()
      ? ['expense', 'income', 'capital_in', 'partner_payout', 'setting_change', 'share_rule']
      : ['expense', 'income'];
    const type = types.includes(state.newType) ? state.newType : 'expense';
    const petty = num(state.settings.employee_petty_limit);
    const big = num(state.settings.all_partner_limit);
    const n = partners().length;

    const fields = {
      amount: ['expense', 'income', 'capital_in', 'partner_payout'].includes(type),
      partner: ['capital_in', 'partner_payout'].includes(type),
      proof: ['expense', 'capital_in', 'partner_payout', 'income'].includes(type),
      proofRequired: ['expense', 'capital_in', 'partner_payout'].includes(type),
    };

    view.innerHTML = `
      <h1>New entry</h1>
      <p class="sub">Nothing reaches the books until the right partners approve it.</p>
      <form id="newForm" class="card">
        <label for="type">What is this?</label>
        <select id="type">${types.map((t) => `<option value="${t}" ${t === type ? 'selected' : ''}>${TYPE[t]}</option>`).join('')}</select>

        ${fields.partner ? `<label for="partner">Which partner?</label>
          <select id="partner" required><option value="">Choose…</option>
          ${partners().map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select>` : ''}

        ${fields.amount ? `<label for="amount">Amount (₹)</label>
          <input id="amount" type="number" min="1" step="0.01" inputmode="decimal" required>` : ''}

        ${type === 'setting_change' ? `
          <label for="skey">Which limit?</label>
          <select id="skey">
            <option value="employee_petty_limit">${SETTING.employee_petty_limit} (now ${esc(inr(petty))})</option>
            <option value="all_partner_limit">${SETTING.all_partner_limit} (now ${esc(inr(big))})</option>
          </select>
          <label for="svalue">New amount (₹)</label>
          <input id="svalue" type="number" min="1" step="1" inputmode="decimal" required>` : ''}

        ${type === 'share_rule' ? `
          <label for="profit">When the business makes a PROFIT, share it</label>
          <select id="profit"><option value="investment">${RULE.investment}</option><option value="equal">${RULE.equal}</option></select>
          <label for="loss">When the business makes a LOSS, share it</label>
          <select id="loss"><option value="investment">${RULE.investment}</option><option value="equal">${RULE.equal}</option></select>
          <div class="hint">Current: profit ${esc(RULE[state.settings.profit_rule] || 'not set')}, loss ${esc(RULE[state.settings.loss_rule] || 'not set')}.
            This should match your partnership deed.</div>` : ''}

        <label for="desc">Description</label>
        <textarea id="desc" required placeholder="${type === 'expense' ? 'e.g. 200 blank tees from Tiruppur supplier' : 'What is this for?'}"></textarea>

        ${fields.proof ? `<label for="proof">${type === 'expense' ? 'Photo of the bill' : type === 'income' ? 'Proof (optional)' : 'Bank transfer screenshot'}${fields.proofRequired ? '' : ''}</label>
          <input id="proof" type="file" accept="image/*,application/pdf" capture="environment" ${fields.proofRequired ? 'required' : ''}>` : ''}

        <div class="rule-box" id="ruleBox"></div>
        <button class="btn block" type="submit" id="submitBtn">Submit for approval</button>
      </form>`;

    const ruleBox = view.querySelector('#ruleBox');
    const updateRule = () => {
      let text = '';
      if (type === 'expense') {
        const a = num(view.querySelector('#amount').value);
        if (!a) text = `Up to ${inr(petty)}: recorded instantly · up to ${inr(big)}: 2 partners · above: all ${n} partners.`;
        else if (a <= petty) text = 'Within the employee limit — recorded instantly (bill photo required).';
        else if (a <= big) text = 'Needs approval from 2 partners.';
        else text = `Above ${inr(big)} — needs ALL ${n} partners.`;
      } else if (type === 'income') text = 'Needs confirmation from 2 partners.';
      else text = `Needs approval from ALL ${n} partners.`;
      ruleBox.textContent = text;
    };
    updateRule();
    const amountEl = view.querySelector('#amount');
    if (amountEl) amountEl.oninput = updateRule;

    view.querySelector('#type').onchange = (e) => { state.newType = e.target.value; VIEWS.new(view); };

    view.querySelector('#newForm').onsubmit = async (e) => {
      e.preventDefault();
      const btn = view.querySelector('#submitBtn');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        let proofPath = null;
        const file = view.querySelector('#proof')?.files?.[0];
        if (file) {
          if (file.size > 10 * 1024 * 1024) throw new Error('Photo is larger than 10 MB. Please take a smaller photo.');
          const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60);
          proofPath = `${state.session.user.id}/${Date.now()}-${safe}`;
          const { error } = await sb.storage.from('proofs').upload(proofPath, file, { upsert: false });
          if (error) throw error;
        }
        const payload = {};
        if (fields.partner) payload.partner_id = view.querySelector('#partner').value;
        if (type === 'setting_change') {
          payload.key = view.querySelector('#skey').value;
          payload.value = num(view.querySelector('#svalue').value);
        }
        if (type === 'share_rule') {
          payload.profit_rule = view.querySelector('#profit').value;
          payload.loss_rule = view.querySelector('#loss').value;
        }
        const id = await q(sb.rpc('raise_request', {
          p_type: type,
          p_amount: fields.amount ? num(view.querySelector('#amount').value) : null,
          p_description: view.querySelector('#desc').value,
          p_proof_path: proofPath,
          p_payload: payload,
        }));
        toast(`Request #${id} submitted.`);
        state.newType = null;
        state.tab = isPartner() ? 'approvals' : 'home';
        state.approvalsFilter = 'pending';
        if (type === 'setting_change' || type === 'share_rule') await boot(); else render();
      } catch (err) {
        toast(errText(err), true);
        btn.disabled = false;
        btn.textContent = 'Submit for approval';
      }
    };
  };

  VIEWS.books = async (view) => {
    const rows = await q(sb.from('ledger').select('*').order('id', { ascending: false }).limit(1000));
    const reversed = new Set(rows.filter((r) => r.reverses_entry).map((r) => r.reverses_entry));
    const f = state.booksFilter;
    const list = f === 'all' ? rows : rows.filter((r) => r.kind === f);
    view.innerHTML = `
      <h1>Books</h1>
      <p class="sub">Every approved entry. Nothing here can be edited or deleted — mistakes are fixed with a reversal that all partners approve.</p>
      <div class="seg">
        ${[['all', 'All'], ['expense', 'Expenses'], ['income', 'Income'], ['capital_in', 'Capital'], ['partner_payout', 'Payouts']].map(([k, l]) =>
          `<button data-f="${k}" class="${f === k ? 'on' : ''}">${l}</button>`).join('')}
        <button id="csv">⬇ Download CSV</button>
      </div>
      ${list.length ? `<div class="card table-wrap"><table>
        <thead><tr><th>#</th><th>Date</th><th>Entry</th><th class="r">Amount</th></tr></thead>
        <tbody>${list.map((r) => `
          <tr>
            <td class="muted">${r.id}</td>
            <td class="muted" style="white-space:nowrap">${esc(day(r.entry_date))}</td>
            <td>${esc(r.description)}
              <div class="muted">${esc(KIND[r.kind])}${r.partner_id ? ` · ${esc(memberName(r.partner_id))}` : ''}${r.request_id ? ` · request #${r.request_id}` : ''}
              ${reversed.has(r.id) ? ' · <b>reversed</b>' : ''}</div>
              ${!r.reverses_entry && !reversed.has(r.id) ? `<button class="linkish" data-rev="${r.id}">Reverse this entry</button>` : ''}
            </td>
            <td class="r">${signed(r.amount)}</td>
          </tr>`).join('')}</tbody></table></div>` : '<div class="empty">No entries yet.</div>'}`;

    view.querySelectorAll('.seg button[data-f]').forEach((b) => {
      b.onclick = () => { state.booksFilter = b.dataset.f; VIEWS.books(view); };
    });
    view.querySelector('#csv').onclick = () => {
      const head = ['id', 'date', 'type', 'description', 'partner', 'amount', 'request', 'reverses_entry'];
      const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lines = [head.join(',')].concat(rows.slice().reverse().map((r) =>
        [r.id, r.entry_date, KIND[r.kind], r.description, r.partner_id ? memberName(r.partner_id) : '', r.amount, r.request_id, r.reverses_entry].map(cell).join(',')));
      const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: `zshirts-books-${new Date().toISOString().slice(0, 10)}.csv` });
      a.click();
      URL.revokeObjectURL(url);
    };
    view.querySelectorAll('[data-rev]').forEach((b) => {
      b.onclick = async () => {
        const id = Number(b.dataset.rev);
        const entry = rows.find((r) => r.id === id);
        const v = await ask({
          title: `Reverse entry #${id}?`,
          html: `<p class="muted">${esc(entry.description)} · ${esc(inr(entry.amount))}<br>All ${partners().length} partners must approve. The original stays visible.</p>`,
          fields: [{ name: 'reason', label: 'Why is this being reversed?', type: 'textarea', required: true }],
          ok: 'Request reversal',
        });
        if (!v) return;
        try {
          const rid = await q(sb.rpc('raise_request', { p_type: 'reversal', p_amount: null, p_description: v.reason, p_proof_path: null, p_payload: { entry_id: id } }));
          toast(`Reversal request #${rid} sent to partners.`);
          updateBadge();
        } catch (e) { toast(errText(e), true); }
      };
    });
  };

  VIEWS.partners = async (view) => {
    const rows = await q(sb.from('partner_positions').select('*'));
    const ruleSet = state.settings.profit_rule && state.settings.loss_rule;
    const result = rows[0] ? num(rows[0].business_result) : 0;
    view.innerHTML = `
      <h1>Partners</h1>
      <p class="sub">Calculated live from the books using the rule all partners agreed.</p>
      <div class="card">
        <div class="row"><span class="muted">Profit is shared</span><b>${esc(RULE[state.settings.profit_rule] || 'Not agreed yet')}</b></div>
        <div class="row"><span class="muted">Loss is shared</span><b>${esc(RULE[state.settings.loss_rule] || 'Not agreed yet')}</b></div>
        <div class="row"><span class="muted">Business result so far</span>${signed(result)}</div>
        <div class="row"><span class="muted">${esc(SETTING.employee_petty_limit)}</span><b>${esc(inr(state.settings.employee_petty_limit))}</b></div>
        <div class="row"><span class="muted">${esc(SETTING.all_partner_limit)}</span><b>${esc(inr(state.settings.all_partner_limit))}</b></div>
      </div>
      ${rows.map((p) => `
        <div class="card"${p.partner_id === state.me.id ? ' style="border-color:rgba(212,255,58,.5)"' : ''}>
          <div class="row"><b style="font-size:17px">${esc(p.name)}</b><span class="pill">${esc(pct(p.investment_share))} of capital</span></div>
          <div class="row" style="margin-top:10px"><span class="muted">Invested</span><span class="amt">${esc(inr(p.capital))}</span></div>
          <div class="row"><span class="muted">Paid out</span><span class="amt">${esc(inr(p.payouts))}</span></div>
          <div class="row"><span class="muted">Share of profit / loss</span>${ruleSet ? signed(p.result_amount) : '<span class="muted">rule pending</span>'}</div>
          <div class="row" style="border-top:1px solid var(--line);padding-top:10px;margin-top:10px"><b>If settled today</b>${ruleSet ? signed(p.settlement_balance) : '<span class="muted">—</span>'}</div>
        </div>`).join('')}
      <p class="hint">"If settled today" = invested − paid out + share of profit or loss. Positive means the partner gets that much back; negative means they owe it.
        All rows add up to the money in the business.</p>`;
  };

  VIEWS.close = async (view) => {
    const [months, sigs] = await Promise.all([
      q(sb.from('month_status').select('*').order('month', { ascending: false })),
      q(sb.from('month_close_signatures').select('*')),
    ]);
    const thisMonth = new Date(); thisMonth.setDate(1);
    const n = partners().length;
    view.innerHTML = `
      <h1>Month close</h1>
      <p class="sub">After each month ends, every partner checks the bank statement and signs. When all ${n} have signed, that month is locked forever.</p>
      ${months.length ? months.map((m) => {
        const ms = sigs.filter((s) => s.month === m.month);
        const ended = new Date(`${m.month}T00:00:00`) < new Date(thisMonth.getFullYear(), thisMonth.getMonth(), 1);
        const signedByMe = ms.some((s) => s.member_id === state.me.id);
        return `
          <div class="card">
            <div class="row"><b>${esc(monthName(m.month))}</b>
              <span class="pill ${m.locked ? 'approved' : ended ? 'pending' : ''}">${m.locked ? 'locked' : ended ? `${m.signatures} of ${n} signed` : 'in progress'}</span></div>
            <div class="row"><span class="muted">Movement this month</span>${signed(m.month_movement)}</div>
            <div class="row"><span class="muted">Closing balance as per books</span><span class="amt">${esc(inr(m.closing_balance))}</span></div>
            ${ms.length ? `<div class="voters">${ms.map((s) => {
              const diff = num(s.bank_balance) - num(m.closing_balance);
              return `<span class="voter approve">${esc(memberName(s.member_id))}: bank ${esc(inr(s.bank_balance))}${Math.abs(diff) > 0.009 ? ` (diff ${esc(inr(diff))})` : ''}</span>`;
            }).join('')}</div>` : ''}
            ${ended && !m.locked && !signedByMe ? `<div class="actions"><button class="btn" data-sign="${m.month}" data-books="${m.closing_balance}">Check bank & sign</button></div>` : ''}
          </div>`;
      }).join('') : '<div class="empty">No entries yet.</div>'}`;

    view.querySelectorAll('[data-sign]').forEach((b) => {
      b.onclick = async () => {
        const month = b.dataset.sign;
        const v = await ask({
          title: `Sign ${monthName(month)}`,
          html: `<p class="muted">Books say the closing balance is <b>${esc(inr(b.dataset.books))}</b>. Enter what the bank statement + cash counter actually show on the last day of the month.</p>`,
          fields: [
            { name: 'bank', label: 'Actual closing balance (₹)', type: 'number', required: true },
            { name: 'note', label: 'Note (optional)', type: 'textarea' },
          ],
          ok: 'Sign month',
        });
        if (!v) return;
        const diff = num(v.bank) - num(b.dataset.books);
        if (Math.abs(diff) > 0.009) {
          const sure = await ask({ title: 'Balance does not match', html: `<p>There is a difference of <b>${esc(inr(diff))}</b>. Partners should find the reason before signing. Sign anyway?</p>`, ok: 'Sign anyway', okClass: 'bad' });
          if (!sure) return;
        }
        try {
          const count = await q(sb.rpc('sign_month_close', { p_month: month, p_bank_balance: num(v.bank), p_note: v.note || null }));
          toast(count >= n ? 'All partners signed — month locked.' : `Signed (${count} of ${n}).`);
          VIEWS.close(view);
        } catch (e) { toast(errText(e), true); }
      };
    });
  };

  VIEWS.log = async (view) => {
    const rows = await q(sb.from('audit_log').select('*').order('id', { ascending: false }).limit(300));
    const label = (r) => {
      if (r.table_name === 'votes') return `${r.new_data?.decision === 'reject' ? 'Rejected' : 'Approved'} request #${r.new_data?.request_id}`;
      if (r.table_name === 'requests' && r.action === 'INSERT') return `Raised request #${r.row_ref}: ${TYPE[r.new_data?.type] || ''}`;
      if (r.table_name === 'requests') return `Request #${r.row_ref} → ${r.new_data?.status}`;
      if (r.table_name === 'ledger') return `Books entry #${r.row_ref} (${inr(r.new_data?.amount)})`;
      if (r.table_name === 'month_close_signatures') return `Signed month ${r.new_data?.month}`;
      if (r.table_name === 'settings') return `Setting changed: ${r.row_ref}`;
      if (r.table_name === 'members') return `Member ${r.action === 'INSERT' ? 'added' : 'changed'}: ${r.new_data?.name || ''}`;
      return `${r.action} ${r.table_name}`;
    };
    view.innerHTML = `
      <h1>Activity log</h1>
      <p class="sub">Every action by every person, permanently. Changes made outside the app show as “system / database owner”.</p>
      ${rows.map((r) => `
        <div class="card">
          <div class="row"><b>${esc(label(r))}</b><span class="muted" style="white-space:nowrap">${esc(when(r.at))}</span></div>
          <div class="muted" style="margin-top:4px">${r.actor_name === 'system / database owner' ? '⚠ ' : ''}${esc(r.actor_name)}</div>
          <details style="margin-top:6px"><summary class="muted">Details</summary>
            <pre style="white-space:pre-wrap;font-size:12px;color:var(--muted)">${esc(JSON.stringify({ before: r.old_data, after: r.new_data }, null, 2))}</pre>
          </details>
        </div>`).join('') || '<div class="empty">No activity yet.</div>'}`;
  };

  // ---------------------------------------------------------------- start
  let started = false;
  sb.auth.onAuthStateChange((_event, session) => {
    const prev = state.session && state.session.user.id;
    state.session = session;
    if (!started || prev !== (session && session.user.id)) { started = true; boot(); }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.me) render(); });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
