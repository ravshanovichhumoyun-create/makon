// Small visual effects: 3D tilt for [data-tilt], confetti. Respects "reduce motion".
export const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let raf = 0;
let lastMove = null;

document.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || reduceMotion()) return;
  lastMove = e;
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    const ev = lastMove;
    const el = ev.target.closest?.('[data-tilt]');
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (ev.clientX - r.left) / r.width;
    const py = (ev.clientY - r.top) / r.height;
    el.style.setProperty('--rx', `${((0.5 - py) * 14).toFixed(2)}deg`);
    el.style.setProperty('--ry', `${((px - 0.5) * 18).toFixed(2)}deg`);
    el.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
    el.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
    el.classList.add('is-tilting');
  });
}, { passive: true });

document.addEventListener('pointerout', (e) => {
  const el = e.target.closest?.('[data-tilt]');
  if (el && !el.contains(e.relatedTarget)) {
    el.classList.remove('is-tilting');
    el.style.removeProperty('--rx');
    el.style.removeProperty('--ry');
  }
}, { passive: true });

const COLORS = ['#a5b4fc', '#c4b5fd', '#86efac', '#fda4af', '#fcd34d', '#7dd3fc', '#f9a8d4'];

export function confetti(x = window.innerWidth / 2, y = window.innerHeight / 3, count = 90) {
  if (reduceMotion()) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  canvas.setAttribute('aria-hidden', 'true');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const parts = Array.from({ length: count }, () => {
    const a = Math.random() * Math.PI * 2;
    const v = 4 + Math.random() * 9;
    return {
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 7, w: 6 + Math.random() * 6, h: 3 + Math.random() * 5,
      r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.35, c: COLORS[Math.floor(Math.random() * COLORS.length)],
      round: Math.random() > 0.6,
    };
  });
  const t0 = performance.now();
  const frame = (now) => {
    const t = now - t0;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (const p of parts) {
      p.vy += 0.32; p.vx *= 0.985; p.vy *= 0.985;
      p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t / 2200);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2.4, 0, Math.PI * 2); ctx.fill(); } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (t < 2200) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

/** Confetti from the element that was clicked. */
export function confettiFrom(el, count) {
  const r = el ? el.getBoundingClientRect() : null;
  confetti(r ? r.left + r.width / 2 : undefined, r ? r.top + r.height / 2 : undefined, count);
}

/** Progress ring (SVG). */
export function ringSvg(pct, { size = 112, stroke = 11, cls = '' } = {}) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return `<svg class="ring ${cls}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"/>
    <circle class="ring-val" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"
      stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - p / 100)).toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
  </svg>`;
}
