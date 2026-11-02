/* Z-SHIRTS celebrations: liquid-glass confetti, a short chime, and a big moment for milestones.
 * window.ZSCelebrate.confetti(), .chime(), .moment({title, sub, amount, big})
 */
(() => {
  const NEON = ['#7c5cff', '#ff4f9a', '#ffa53a', '#3a86ff', '#14b8a6', '#ffd66b'];
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
        color: NEON[i % NEON.length], round: i % 3 === 0,
      };
    });
    const start = performance.now();
    (function frame(now) {
      ctx.clearRect(0, 0, W, H);
      parts.forEach((p) => {
        p.vy += 0.45 * dpr; p.vx *= 0.99;
        p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
        ctx.fillStyle = p.color;
        if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.beginPath(); ctx.arc(-p.w / 6, -p.w / 6, p.w / 6, 0, Math.PI * 2); ctx.fill(); }
        else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      if (now - start < 3200) requestAnimationFrame(frame); else c.remove();
    })(start);
  }

  // A full-screen moment. Each kind of win has its own icon and colour.
  const KINDS = {
    order: { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"/></svg>', color: '#7c5cff', color2: '#c05cff', label: 'New order' },
    sale: { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1.5-5h15L21 9M3 9h18v1a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0zM5 13v7h14v-7"/></svg>', color: '#3a86ff', color2: '#7c5cff', label: 'Offline sale' },
    payment: { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h12M6 9h12M6 4h3a5 5 0 0 1 0 10H6l8 7"/></svg>', color: '#10b981', color2: '#14b8a6', label: 'Payment' },
    dispatch: { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 7h11v9H2zM13 10h4l4 4v2h-8"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>', color: '#14b8a6', color2: '#3a86ff', label: 'Dispatched' },
    launch: { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c4 2 6 6 5 11l-3 3h-4l-3-3c-1-5 1-9 5-11z"/><circle cx="12" cy="10" r="2"/><path d="M8 17l-2 4M16 17l2 4"/></svg>', color: '#ff4f9a', color2: '#ffa53a', label: 'New product' },
    client: { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M19 8v6M16 11h6"/></svg>', color: '#ffa53a', color2: '#ff4f9a', label: 'New customer' },
    milestone: { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v4M8 21h8"/></svg>', color: '#ffb020', color2: '#ff4f9a', label: 'Milestone' },
    status: { icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>', color: '#7c5cff', color2: '#3a86ff', label: 'Update' },
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
    el.style.setProperty('--k', big ? '#ff4f9a' : k.color);
    el.style.setProperty('--k2', big ? '#ffa53a' : k.color2);
    el.innerHTML = `<div class="zs-moment-card">
        <div class="zs-moment-icon" aria-hidden="true"><i></i><i></i><i></i></div>
        <div class="zs-moment-kicker"></div>
        ${amount ? `<div class="zs-moment-amt"></div>` : ''}
        <div class="zs-moment-title"></div>
        <div class="zs-moment-sub"></div>
        <button type="button">Nice!</button>
      </div>`;
    el.querySelector('.zs-moment-icon').insertAdjacentHTML('beforeend', (big ? KINDS.milestone : k).icon);
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
      el.innerHTML = `<div class="zs-w-glow"></div><i class="zs-w-orb o1"></i><i class="zs-w-orb o2"></i><i class="zs-w-orb o3"></i><div class="zs-w-inner">
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
    .zs-moment{position:fixed;inset:0;z-index:9998;display:grid;place-items:center;background:rgba(60,40,120,.25);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);padding:24px;animation:zsIn .3s ease-out;perspective:900px}
    .zs-moment-card{position:relative;overflow:hidden;background:linear-gradient(160deg,rgba(255,255,255,.95),rgba(246,242,255,.8));-webkit-backdrop-filter:blur(30px) saturate(180%);backdrop-filter:blur(30px) saturate(180%);
      border:1px solid #fff;animation:zsPop .7s cubic-bezier(.2,1.35,.35,1);border-radius:34px;padding:30px 24px 24px;max-width:380px;width:100%;text-align:center;
      box-shadow:0 30px 80px color-mix(in srgb,var(--k,#7c5cff) 35%,transparent),0 8px 20px rgba(76,52,170,.15),inset 0 1px 0 #fff;font-family:-apple-system,'Inter Tight',system-ui,sans-serif;color:#1e1835}
    .zs-moment-card::before{content:'';position:absolute;width:260px;height:260px;left:50%;top:-150px;transform:translateX(-50%);border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--k) 30%,transparent),transparent 70%);pointer-events:none}
    .zs-moment-card>*{position:relative}
    .zs-moment-icon{width:92px;height:92px;margin:0 auto;border-radius:30px;display:grid;place-items:center;color:#fff;position:relative;
      background:linear-gradient(140deg,var(--k),var(--k2));transform-style:preserve-3d;
      box-shadow:0 18px 36px color-mix(in srgb,var(--k) 45%,transparent),inset 0 2px 0 rgba(255,255,255,.65),inset 0 -6px 14px rgba(0,0,0,.15);
      animation:zsSpinIn .9s cubic-bezier(.2,1.3,.35,1) both,zsBob 2.6s ease-in-out .9s infinite}
    .zs-moment-icon::after{content:'';position:absolute;left:10px;right:10px;top:6px;height:40%;border-radius:22px 22px 40px 40px;background:linear-gradient(180deg,rgba(255,255,255,.6),rgba(255,255,255,0));pointer-events:none}
    .zs-moment-icon svg{width:46px;height:46px;filter:drop-shadow(0 3px 4px rgba(0,0,0,.2))}
    .zs-moment-icon i{position:absolute;inset:-10px;border-radius:38px;border:2px solid var(--k);opacity:0;animation:zsRing 2.2s ease-out infinite}
    .zs-moment-icon i:nth-child(2){animation-delay:.7s}.zs-moment-icon i:nth-child(3){animation-delay:1.4s}
    .zs-moment-kicker{margin-top:18px;font-size:11.5px;font-weight:800;letter-spacing:2.4px;text-transform:uppercase;color:var(--k)}
    .zs-moment-amt{font-family:Unbounded,system-ui,sans-serif;font-weight:800;font-size:42px;line-height:1.1;margin-top:6px;letter-spacing:-1px;
      background:linear-gradient(120deg,var(--k),var(--k2));-webkit-background-clip:text;background-clip:text;color:transparent;animation:zsRise .6s .25s both}
    .zs-moment-title{font-family:Unbounded,system-ui,sans-serif;font-weight:700;font-size:21px;margin-top:8px;line-height:1.25;animation:zsRise .6s .35s both}
    .zs-moment-sub{color:#736c8c;margin-top:8px;font-size:15px;line-height:1.45;animation:zsRise .6s .45s both}
    .zs-moment button{margin-top:22px;background:linear-gradient(120deg,var(--k),var(--k2));color:#fff;border:0;border-radius:999px;padding:13px 32px;font-weight:800;font-size:15px;cursor:pointer;
      box-shadow:0 10px 24px color-mix(in srgb,var(--k) 40%,transparent),inset 0 1px 0 rgba(255,255,255,.5);animation:zsRise .6s .55s both}
    .zs-moment.big .zs-moment-icon{width:110px;height:110px;border-radius:36px;background:linear-gradient(140deg,#ffd66b,#ffa53a 45%,#ff4f9a)}
    .zs-moment.big .zs-moment-icon svg{width:56px;height:56px}
    @keyframes zsIn{from{opacity:0}to{opacity:1}}
    @keyframes zsPop{from{transform:translateY(40px) scale(.7) rotateX(30deg);opacity:0}to{transform:none;opacity:1}}
    @keyframes zsSpinIn{from{transform:scale(0) rotateY(-180deg) rotateZ(-20deg)}to{transform:none}}
    @keyframes zsBob{0%,100%{transform:translateY(0) rotateZ(0)}50%{transform:translateY(-8px) rotateZ(-4deg)}}
    @keyframes zsRing{from{transform:scale(.85);opacity:.6}to{transform:scale(1.5);opacity:0}}
    .zs-welcome{position:fixed;inset:0;z-index:10000;background:linear-gradient(180deg,#f7f4ff,#ece6ff);display:grid;place-items:center;overflow:auto;padding:28px 20px;color:#1e1835;font-family:-apple-system,'Inter Tight',system-ui,sans-serif;transition:opacity .5s,transform .5s;perspective:1000px}
    .zs-welcome.out{opacity:0;transform:scale(1.06)}
    .zs-w-glow{position:fixed;inset:-30%;background:radial-gradient(circle at 30% 30%,rgba(124,92,255,.3),transparent 40%),radial-gradient(circle at 70% 70%,rgba(255,79,154,.25),transparent 40%),radial-gradient(circle at 70% 20%,rgba(255,165,58,.25),transparent 35%);animation:zsSpin 18s linear infinite;pointer-events:none}
    .zs-w-orb{position:fixed;border-radius:50%;pointer-events:none;animation:zsFloat 9s ease-in-out infinite}
    .zs-w-orb.o1{width:160px;height:160px;left:-40px;top:10%;background:radial-gradient(circle at 32% 28%,#fff 0 7%,rgba(255,255,255,.6) 13%,#a58bff 40%,#6a46ff 75%);box-shadow:0 30px 60px rgba(106,70,255,.3)}
    .zs-w-orb.o2{width:110px;height:110px;right:-20px;top:22%;animation-delay:-3s;background:radial-gradient(circle at 32% 28%,#fff 0 7%,rgba(255,255,255,.6) 13%,#ff8cc0 40%,#ff4f9a 75%);box-shadow:0 24px 50px rgba(255,79,154,.3)}
    .zs-w-orb.o3{width:90px;height:90px;right:18%;bottom:6%;animation-delay:-6s;background:radial-gradient(circle at 32% 28%,#fff 0 8%,rgba(255,255,255,.6) 14%,#ffc77a 42%,#ffa53a 75%);box-shadow:0 20px 40px rgba(255,165,58,.3)}
    .zs-w-inner{position:relative;max-width:460px;width:100%;text-align:center;padding:30px 22px;border-radius:36px;background:linear-gradient(160deg,rgba(255,255,255,.75),rgba(255,255,255,.4));
      -webkit-backdrop-filter:blur(26px) saturate(180%);backdrop-filter:blur(26px) saturate(180%);border:1px solid #fff;box-shadow:0 30px 80px rgba(76,52,170,.2),inset 0 1px 0 #fff;animation:zsPop 1s cubic-bezier(.2,1.2,.35,1) both}
    .zs-w-kicker,.zs-w-name,.zs-w-lines p,.zs-w-chips,.zs-welcome button{opacity:0;animation:zsRise .7s cubic-bezier(.2,.8,.2,1) forwards}
    .zs-w-kicker{color:#736c8c;letter-spacing:3px;text-transform:uppercase;font-size:12px;font-weight:800}
    .zs-w-logo{font-family:Unbounded,system-ui,sans-serif;font-weight:800;font-size:clamp(40px,13vw,62px);letter-spacing:-2px;margin:6px 0 4px}
    .zs-w-logo span{display:inline-block;opacity:0;animation:zsDrop .8s cubic-bezier(.2,1.5,.4,1) forwards;background:linear-gradient(120deg,#7c5cff,#ff4f9a 55%,#ffa53a);-webkit-background-clip:text;background-clip:text;color:transparent}
    .zs-w-logo b{color:#ff4f9a}
    .zs-w-name{font-family:Unbounded,system-ui,sans-serif;font-weight:700;font-size:26px;color:#7c5cff}
    .zs-w-lines{margin-top:18px;display:grid;gap:12px}
    .zs-w-lines p{margin:0;font-size:16px;line-height:1.5;color:#3d355a}
    .zs-w-chips{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:20px}
    .zs-w-chips span{border:1px solid #fff;border-radius:18px;padding:10px 14px;min-width:96px;background:rgba(255,255,255,.7);box-shadow:0 8px 20px rgba(76,52,170,.12),inset 0 1px 0 #fff}
    .zs-w-chips b{display:block;font-family:Unbounded,system-ui,sans-serif;font-size:18px;background:linear-gradient(120deg,#3a86ff,#7c5cff);-webkit-background-clip:text;background-clip:text;color:transparent}
    .zs-w-chips small{color:#736c8c;font-size:12px}
    .zs-welcome button{margin-top:26px;background:linear-gradient(120deg,#7c5cff,#ff4f9a 55%,#ffa53a);color:#fff;border:0;border-radius:999px;padding:16px 42px;font-weight:800;font-size:17px;cursor:pointer;box-shadow:0 14px 34px rgba(255,79,154,.35),inset 0 1px 0 rgba(255,255,255,.5)}
    @keyframes zsDrop{from{opacity:0;transform:translateY(-60px) rotateX(90deg)}to{opacity:1;transform:none}}
    @keyframes zsRise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
    @keyframes zsSpin{to{transform:rotate(360deg)}}
    @keyframes zsFloat{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(14px,-22px,0)}}
    @media (prefers-reduced-motion: reduce){.zs-moment,.zs-moment-card,.zs-moment-icon,.zs-moment-icon i,.zs-w-glow,.zs-w-orb,.zs-w-inner,.zs-moment-amt,.zs-moment-title,.zs-moment-sub,.zs-moment button{animation:none}
      .zs-w-kicker,.zs-w-name,.zs-w-lines p,.zs-w-chips,.zs-welcome button,.zs-w-logo span{animation:none;opacity:1}}`;
  document.head.appendChild(css);

  window.ZSCelebrate = { confetti, chime, moment, welcome };
})();
