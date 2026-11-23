/* SINDIICAT Team · neon dust behind every screen.
   Very light, slow, 30 fps cap. Pauses in background tabs. Still for reduced motion.
   Each person can switch it off on their own phone (tap your name → Neon dust). */
(function () {
  let off = false; try { off = localStorage.getItem('zs_dust') === 'off'; } catch (_) { /* fine */ }
  const cv = document.createElement('canvas'); cv.className = 'app-dust'; cv.setAttribute('aria-hidden', 'true');
  const ctx = cv.getContext && cv.getContext('2d'); if (!ctx) return;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dpr = Math.min(window.devicePixelRatio || 1, 2); let W = 0, H = 0, dots = [], last = 0;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const make = (y) => { const big = Math.random() < 0.1; return { x: rnd(0, W), y: y ?? rnd(0, H), r: big ? rnd(2.5, 4.5) : rnd(0.6, 1.6), a: big ? rnd(0.05, 0.1) : rnd(0.2, 0.62),
    vy: big ? rnd(0.05, 0.12) : rnd(0.1, 0.32), sw: rnd(0.2, 0.9), ph: rnd(0, 6.28), tw: rnd(0.4, 1.4), big }; };
  const size = () => { W = innerWidth; H = innerHeight; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.max(18, Math.min(60, Math.round((W * H) / 11000))); dots = Array.from({ length: n }, () => make()); };
  const draw = (t) => {
    ctx.clearRect(0, 0, W, H);
    for (const d of dots) {
      if (!still) { d.y -= d.vy; d.x += Math.sin(t / 2400 * d.sw + d.ph) * 0.15; if (d.y < -8) Object.assign(d, make(H + 6)); }
      const a = d.a * (still ? 1 : 0.65 + 0.35 * Math.sin(t / 900 * d.tw + d.ph));
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 6.283);
      ctx.fillStyle = `rgba(199,255,0,${a.toFixed(3)})`; ctx.shadowColor = 'rgba(199,255,0,.8)'; ctx.shadowBlur = d.big ? 12 : 5; ctx.fill();
    }
  };
  const loop = (t) => { requestAnimationFrame(loop); if (off || still || document.hidden || t - last < 33) return; last = t; draw(t); };
  const start = () => {
    document.body.appendChild(cv); size(); draw(0);
    let rt = 0; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { size(); draw(performance.now()); }, 200); });
    // sparkle over the boot loader too, then drop behind the app
    const boot = () => { cv.classList.toggle('over-boot', !!document.getElementById('boot')); };
    boot(); const iv = setInterval(() => { boot(); if (!document.getElementById('boot')) clearInterval(iv); }, 250);
    cv.hidden = off; requestAnimationFrame(loop);
  };
  window.ZSDust = { on: () => !off, set(v) { off = !v; cv.hidden = off; try { localStorage.setItem('zs_dust', off ? 'off' : 'on'); } catch (_) { /* fine */ } } };
  if (document.body) start(); else addEventListener('DOMContentLoaded', start);
})();
