/* Z-SHIRTS celebrations: neon confetti, a short chime, and a big moment for milestones.
 * window.ZSCelebrate.confetti(), .chime(), .moment({title, sub, amount, big})
 */
(() => {
  const NEON = ['#c6ff00', '#ff2e88', '#00e5ff', '#ffffff', '#ffe600'];
  const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let audioCtx;

  function chime(kind = 'order') {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const notes = kind === 'milestone' ? [523.25, 659.25, 783.99, 1046.5] : [659.25, 987.77];
      notes.forEach((f, i) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'triangle';
        o.frequency.value = f;
        const t = audioCtx.currentTime + i * 0.11;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
        o.connect(g).connect(audioCtx.destination);
        o.start(t);
        o.stop(t + 0.4);
      });
    } catch (_) { /* sound is optional */ }
  }

  function confetti(power = 1) {
    if (reduced()) return;
    const c = document.createElement('canvas');
    c.setAttribute('aria-hidden', 'true');
    Object.assign(c.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: 9999 });
    document.body.appendChild(c);
    const ctx = c.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = (c.width = innerWidth * dpr);
    const H = (c.height = innerHeight * dpr);
    const count = Math.round(140 * power);
    const parts = Array.from({ length: count }, (_, i) => {
      const fromLeft = i % 2 === 0;
      return {
        x: fromLeft ? 0 : W, y: H * 0.75,
        vx: (fromLeft ? 1 : -1) * (6 + Math.random() * 10) * dpr,
        vy: -(12 + Math.random() * 14) * dpr,
        w: (6 + Math.random() * 8) * dpr, h: (3 + Math.random() * 5) * dpr,
        r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4,
        color: NEON[i % NEON.length],
      };
    });
    const start = performance.now();
    (function frame(now) {
      ctx.clearRect(0, 0, W, H);
      parts.forEach((p) => {
        p.vy += 0.45 * dpr; p.vx *= 0.99;
        p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
        ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      if (now - start < 3200) requestAnimationFrame(frame); else c.remove();
    })(start);
  }

  // A full-screen moment. Each kind of win has its own icon and colour.
  const KINDS = {
    order: { icon: '🛍️', color: '#c6ff00', label: 'New order' },
    sale: { icon: '🏪', color: '#00e5ff', label: 'Offline sale' },
    payment: { icon: '💸', color: '#c6ff00', label: 'Payment' },
    dispatch: { icon: '🚚', color: '#00e5ff', label: 'Dispatched' },
    launch: { icon: '🚀', color: '#ff2e88', label: 'New product' },
    client: { icon: '👋', color: '#ffe600', label: 'New customer' },
    milestone: { icon: '🏆', color: '#ff2e88', label: 'Milestone' },
    status: { icon: '✅', color: '#c6ff00', label: 'Update' },
  };
  const queue = [];
  let showing = false;
  function moment(opts) { queue.push(opts); if (!showing) next(); }
  function next() {
    const o = queue.shift();
    if (!o) { showing = false; return; }
    showing = true;
    const { title, sub = '', amount = '', big = false, kind = 'order' } = o;
    const k = KINDS[kind] || KINDS.order;
    chime(big ? 'milestone' : kind);
    confetti(big ? 1.8 : kind === 'launch' || kind === 'client' ? 1.3 : 1);
    const el = document.createElement('div');
    el.className = 'zs-moment' + (big ? ' big' : '');
    el.setAttribute('role', 'status');
    el.style.setProperty('--k', big ? '#ff2e88' : k.color);
    el.innerHTML = `<div class="zs-moment-card">
        <div class="zs-moment-icon" aria-hidden="true"></div>
        <div class="zs-moment-kicker"></div>
        ${amount ? `<div class="zs-moment-amt"></div>` : ''}
        <div class="zs-moment-title"></div>
        <div class="zs-moment-sub"></div>
        <button type="button">Nice!</button>
      </div>`;
    el.querySelector('.zs-moment-icon').textContent = k.icon;
    el.querySelector('.zs-moment-kicker').textContent = big ? 'Milestone unlocked' : k.label;
    if (amount) el.querySelector('.zs-moment-amt').textContent = amount;
    el.querySelector('.zs-moment-title').textContent = title;
    el.querySelector('.zs-moment-sub').textContent = sub;
    let done = false;
    const close = () => { if (done) return; done = true; el.remove(); setTimeout(next, 250); };
    el.querySelector('button').onclick = close;
    el.addEventListener('click', (e) => { if (e.target === el) close(); });
    document.body.appendChild(el);
    setTimeout(close, big ? 9000 : 5500);
  }

  // First login: a personal welcome, revealed line by line.
  function welcome({ name, kicker = 'Welcome to', lines = [], chips = [], button = "Let's go" }) {
    return new Promise((resolve) => {
      const el = document.createElement('div');
      el.className = 'zs-welcome';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      const logo = 'Z-SHIRTS'.split('').map((ch, i) => `<span style="animation-delay:${0.15 + i * 0.08}s">${ch === '-' ? '<b>-</b>' : ch}</span>`).join('');
      el.innerHTML = `<div class="zs-w-glow"></div><div class="zs-w-inner">
        <div class="zs-w-kicker" style="animation-delay:.05s"></div>
        <div class="zs-w-logo">${logo}</div>
        <div class="zs-w-name" style="animation-delay:1s"></div>
        <div class="zs-w-lines">${lines.map((_, i) => `<p style="animation-delay:${1.6 + i * 0.55}s"></p>`).join('')}</div>
        <div class="zs-w-chips" style="animation-delay:${1.8 + lines.length * 0.55}s">${chips.map(() => '<span><b></b><small></small></span>').join('')}</div>
        <button type="button" style="animation-delay:${2.1 + lines.length * 0.55}s"></button></div>`;
      el.querySelector('.zs-w-kicker').textContent = kicker;
      el.querySelector('.zs-w-name').textContent = name;
      el.querySelectorAll('.zs-w-lines p').forEach((p, i) => { p.textContent = lines[i]; });
      el.querySelectorAll('.zs-w-chips span').forEach((c, i) => { c.querySelector('b').textContent = chips[i][0]; c.querySelector('small').textContent = chips[i][1]; });
      el.querySelector('button').textContent = button;
      document.body.appendChild(el);
      setTimeout(() => { confetti(1.4); chime('milestone'); }, 900);
      el.querySelector('button').onclick = () => {
        confetti(1); el.classList.add('out');
        setTimeout(() => { el.remove(); resolve(); }, 450);
      };
      setTimeout(() => el.querySelector('button').focus(), 2500 + lines.length * 550);
    });
  }

  const css = document.createElement('style');
  css.textContent = `
    .zs-moment{position:fixed;inset:0;z-index:9998;display:grid;place-items:center;background:rgba(0,0,0,.55);padding:24px;animation:zsIn .25s ease-out}
    .zs-moment-card{background:#000;border:2px solid var(--k,#c6ff00);animation:zsPop .45s cubic-bezier(.2,1.4,.4,1);border-radius:28px;padding:28px 24px;max-width:380px;width:100%;text-align:center;
      box-shadow:0 0 0 6px rgba(255,255,255,.04),0 0 60px color-mix(in srgb,var(--k,#c6ff00) 45%,transparent);font-family:'Inter Tight',system-ui,sans-serif;color:#fff}
    .zs-moment.big .zs-moment-card{border-color:#ff2e88;box-shadow:0 0 0 6px rgba(255,46,136,.15),0 0 80px rgba(255,46,136,.45)}
    .zs-moment-amt{font-family:Unbounded,system-ui,sans-serif;font-weight:800;font-size:40px;color:#c6ff00;line-height:1.1}
    .zs-moment.big .zs-moment-amt{color:#ff2e88}
    .zs-moment-title{font-family:Unbounded,system-ui,sans-serif;font-weight:700;font-size:22px;margin-top:8px;line-height:1.25}
    .zs-moment-sub{color:#b5b5bd;margin-top:8px;font-size:15px;line-height:1.45}
    .zs-moment button{margin-top:20px;background:#c6ff00;color:#000;border:0;border-radius:999px;padding:12px 28px;font-weight:700;font-size:15px;cursor:pointer}
    .zs-moment.big button{background:#ff2e88;color:#fff}
    @keyframes zsIn{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:none}}
    .zs-moment-icon{font-size:54px;line-height:1;animation:zsBounce 1.2s ease-in-out infinite}
    .zs-moment-kicker{margin-top:10px;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--k,#c6ff00)}
    .zs-moment:not(.big) .zs-moment-amt{color:var(--k,#c6ff00)}
    .zs-moment:not(.big) button{background:var(--k,#c6ff00)}
    @keyframes zsPop{from{transform:scale(.6) rotate(-4deg);opacity:0}to{transform:none;opacity:1}}
    @keyframes zsBounce{0%,100%{transform:translateY(0) rotate(0)}30%{transform:translateY(-10px) rotate(-8deg)}60%{transform:translateY(0) rotate(6deg)}}
    .zs-welcome{position:fixed;inset:0;z-index:10000;background:#000;display:grid;place-items:center;overflow:auto;padding:28px 20px;color:#fff;font-family:'Inter Tight',system-ui,sans-serif;transition:opacity .45s,transform .45s}
    .zs-welcome.out{opacity:0;transform:scale(1.04)}
    .zs-w-glow{position:fixed;inset:-30%;background:radial-gradient(circle at 30% 30%,rgba(198,255,0,.22),transparent 40%),radial-gradient(circle at 70% 70%,rgba(255,46,136,.22),transparent 40%),radial-gradient(circle at 70% 20%,rgba(0,229,255,.16),transparent 35%);animation:zsSpin 14s linear infinite;pointer-events:none}
    .zs-w-inner{position:relative;max-width:460px;width:100%;text-align:center}
    .zs-w-kicker,.zs-w-name,.zs-w-lines p,.zs-w-chips,.zs-welcome button{opacity:0;animation:zsRise .7s cubic-bezier(.2,.8,.2,1) forwards}
    .zs-w-kicker{color:#a3a3ad;letter-spacing:3px;text-transform:uppercase;font-size:12px;font-weight:700}
    .zs-w-logo{font-family:Unbounded,system-ui,sans-serif;font-weight:800;font-size:clamp(40px,13vw,64px);letter-spacing:-2px;margin:6px 0 4px}
    .zs-w-logo span{display:inline-block;opacity:0;animation:zsDrop .6s cubic-bezier(.2,1.5,.4,1) forwards}
    .zs-w-logo b{color:#c6ff00}
    .zs-w-name{font-family:Unbounded,system-ui,sans-serif;font-weight:700;font-size:26px;color:#c6ff00;text-shadow:0 0 24px rgba(198,255,0,.6)}
    .zs-w-lines{margin-top:18px;display:grid;gap:12px}
    .zs-w-lines p{margin:0;font-size:16px;line-height:1.5;color:#e6e6ea}
    .zs-w-chips{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:20px}
    .zs-w-chips span{border:1px solid #2b2b31;border-radius:14px;padding:10px 14px;min-width:96px;background:rgba(255,255,255,.03)}
    .zs-w-chips b{display:block;font-family:Unbounded,system-ui,sans-serif;font-size:18px;color:#00e5ff}
    .zs-w-chips small{color:#a3a3ad;font-size:12px}
    .zs-welcome button{margin-top:26px;background:#c6ff00;color:#000;border:0;border-radius:999px;padding:16px 40px;font-weight:800;font-size:17px;cursor:pointer;box-shadow:0 0 30px rgba(198,255,0,.45)}
    @keyframes zsDrop{from{opacity:0;transform:translateY(-60px) rotate(-12deg)}to{opacity:1;transform:none}}
    @keyframes zsRise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
    @keyframes zsSpin{to{transform:rotate(360deg)}}
    @media (prefers-reduced-motion: reduce){.zs-moment,.zs-moment-card,.zs-moment-icon,.zs-w-glow{animation:none}
      .zs-w-kicker,.zs-w-name,.zs-w-lines p,.zs-w-chips,.zs-welcome button,.zs-w-logo span{animation:none;opacity:1}}`;
  document.head.appendChild(css);

  window.ZSCelebrate = { confetti, chime, moment, welcome };
})();
