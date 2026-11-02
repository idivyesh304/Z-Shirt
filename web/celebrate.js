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

  // A full-screen moment: used for milestones and first orders.
  function moment({ title, sub = '', amount = '', big = false, kind = 'order' }) {
    chime(big ? 'milestone' : kind);
    confetti(big ? 1.8 : 1);
    const el = document.createElement('div');
    el.className = 'zs-moment' + (big ? ' big' : '');
    el.setAttribute('role', 'status');
    el.innerHTML = `<div class="zs-moment-card">
        ${amount ? `<div class="zs-moment-amt"></div>` : ''}
        <div class="zs-moment-title"></div>
        <div class="zs-moment-sub"></div>
        <button type="button">Nice!</button>
      </div>`;
    if (amount) el.querySelector('.zs-moment-amt').textContent = amount;
    el.querySelector('.zs-moment-title').textContent = title;
    el.querySelector('.zs-moment-sub').textContent = sub;
    const close = () => el.remove();
    el.querySelector('button').onclick = close;
    el.addEventListener('click', (e) => { if (e.target === el) close(); });
    document.body.appendChild(el);
    setTimeout(close, big ? 9000 : 5000);
  }

  const css = document.createElement('style');
  css.textContent = `
    .zs-moment{position:fixed;inset:0;z-index:9998;display:grid;place-items:center;background:rgba(0,0,0,.55);padding:24px;animation:zsIn .25s ease-out}
    .zs-moment-card{background:#000;border:2px solid #c6ff00;border-radius:28px;padding:28px 24px;max-width:380px;width:100%;text-align:center;
      box-shadow:0 0 0 6px rgba(198,255,0,.12),0 0 60px rgba(198,255,0,.35);font-family:'Inter Tight',system-ui,sans-serif;color:#fff}
    .zs-moment.big .zs-moment-card{border-color:#ff2e88;box-shadow:0 0 0 6px rgba(255,46,136,.15),0 0 80px rgba(255,46,136,.45)}
    .zs-moment-amt{font-family:Unbounded,system-ui,sans-serif;font-weight:800;font-size:40px;color:#c6ff00;line-height:1.1}
    .zs-moment.big .zs-moment-amt{color:#ff2e88}
    .zs-moment-title{font-family:Unbounded,system-ui,sans-serif;font-weight:700;font-size:22px;margin-top:8px;line-height:1.25}
    .zs-moment-sub{color:#b5b5bd;margin-top:8px;font-size:15px;line-height:1.45}
    .zs-moment button{margin-top:20px;background:#c6ff00;color:#000;border:0;border-radius:999px;padding:12px 28px;font-weight:700;font-size:15px;cursor:pointer}
    .zs-moment.big button{background:#ff2e88;color:#fff}
    @keyframes zsIn{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:none}}
    @media (prefers-reduced-motion: reduce){.zs-moment{animation:none}}`;
  document.head.appendChild(css);

  window.ZSCelebrate = { confetti, chime, moment };
})();
