// Kleine DOM-Helfer + Screen-Wechsel + Toast.
export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// Screen umschalten: zeigt genau die View mit der gegebenen id.
export function showScreen(id) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === id));
}

let toastTimer = null;
export function toast(msg, kind = 'info') {
  let t = $('#toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = 'show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 3200);
}

export function clearChildren(el) { while (el.firstChild) el.removeChild(el.firstChild); }

// Konfetti-Regen (leichtgewichtig, ohne Bibliothek) – z. B. zum Spielende.
export function confetti(durationMs = 2600) {
  if (document.getElementById('confetti-cv')) return;   // schon aktiv
  const cv = document.createElement('canvas');
  cv.id = 'confetti-cv';
  cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999';
  document.body.appendChild(cv);
  const x = cv.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = cv.width = innerWidth * dpr, H = cv.height = innerHeight * dpr;
  const colors = ['#e9c873', '#c6a24c', '#a78bfa', '#5fe39b', '#ff8a8a', '#8ab0ff', '#ffffff'];
  const N = 150;
  const P = Array.from({ length: N }, () => ({
    x: Math.random() * W, y: -Math.random() * H * 0.5,
    r: (4 + Math.random() * 6) * dpr,
    vx: (-1 + Math.random() * 2) * dpr, vy: (2 + Math.random() * 4) * dpr,
    rot: Math.random() * Math.PI, vr: -0.2 + Math.random() * 0.4,
    c: colors[(Math.random() * colors.length) | 0]
  }));
  const start = performance.now();
  function frame(now) {
    const t = now - start;
    x.clearRect(0, 0, W, H);
    P.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.04 * dpr; p.rot += p.vr;
      x.save(); x.translate(p.x, p.y); x.rotate(p.rot);
      x.fillStyle = p.c; x.globalAlpha = t > durationMs - 600 ? Math.max(0, (durationMs - t) / 600) : 1;
      x.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.6);
      x.restore();
    });
    if (t < durationMs) requestAnimationFrame(frame);
    else cv.remove();
  }
  requestAnimationFrame(frame);
}
