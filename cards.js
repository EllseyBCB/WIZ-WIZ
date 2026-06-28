// Karten: Codierung parsen + Kartenbilder rendern.
// Code: Farbe R/Y/G/B + Rang 1-13 (z.B. R1, B13); Zauberer Z1..Z4; Narr N1..N4.
// Eigene, rechtefreie SVG-Illustrationen im "Deluxe"-Format: Farbrahmen,
// Eckzahlen mit Farbsymbol, zentrales Emblem-Fenster, eigene Zauberer/Narr.
import { CARD_IMAGE_BASE } from './config.js';

export const COLORS = {
  R: { name: 'Rot',   hex: '#e5484d' },
  Y: { name: 'Gelb',  hex: '#f0b429' },
  G: { name: 'Grün', hex: '#34c77b' },
  B: { name: 'Blau',  hex: '#5b8def' }
};

// Erweiterte Palette je Farbe (Rahmen-Dunkel + Tönung).
const SUIT = {
  R: { hex: '#e5484d', dark: '#a31d22' },
  Y: { hex: '#f0b429', dark: '#8a5d00' },
  G: { hex: '#34c77b', dark: '#1f7d4d' },
  B: { hex: '#5b8def', dark: '#2c4fa3' }
};

// -> { type:'color'|'wizard'|'jester', color, rank, code }
export function parseCard(code) {
  const head = code[0];
  if (head === 'Z') return { type: 'wizard', color: null, rank: null, code };
  if (head === 'N') return { type: 'jester', color: null, rank: null, code };
  return { type: 'color', color: head, rank: parseInt(code.slice(1), 10), code };
}

export function colorName(c) { return COLORS[c]?.name ?? '–'; }

export function cardLabel(code) {
  const c = parseCard(code);
  if (c.type === 'wizard') return 'Zauberer';
  if (c.type === 'jester') return 'Narr';
  return `${colorName(c.color)} ${c.rank}`;
}

// Alle 60 Kartenbilder vorab im Hintergrund in den Browser-Cache laden, damit
// sie im Spiel sofort erscheinen statt erst beim Aufdecken nachzuladen. Aendert
// die Bilder NICHT – laedt nur frueher. Idempotent.
let preloaded = false;
export function preloadCards() {
  if (preloaded || !CARD_IMAGE_BASE) return;
  preloaded = true;
  const base = CARD_IMAGE_BASE.replace(/\/$/, '');
  const codes = [];
  for (const c of ['R', 'Y', 'G', 'B']) for (let r = 1; r <= 13; r++) codes.push(c + r);
  for (let i = 1; i <= 4; i++) { codes.push('Z' + i); codes.push('N' + i); }
  // gestaffelt laden, damit der Start nicht ausgebremst wird
  codes.forEach((code, i) => {
    setTimeout(() => { const im = new Image(); im.decoding = 'async'; im.src = `${base}/${code}.png?v=10`; }, i * 40);
  });
}

// Erzeugt das Karten-Element. Bei gesetzter CARD_IMAGE_BASE wird ein Internet-
// Bild versucht; schlaegt es fehl (onerror), wird automatisch SVG gezeichnet.
export function renderCard(code, opts = {}) {
  const el = document.createElement(opts.button ? 'button' : 'div');
  el.className = 'wcard' + (opts.faceDown ? ' face-down' : '') +
                 (opts.disabled ? ' disabled' : '') + (opts.small ? ' small' : '');
  el.dataset.code = code;
  el.setAttribute('aria-label', cardLabel(code));
  if (opts.button) { el.type = 'button'; if (opts.disabled) el.disabled = true; }

  if (opts.faceDown) {
    if (CARD_IMAGE_BASE) {
      const img = document.createElement('img');
      img.className = 'wcard-img';
      img.alt = 'Rückseite';
      img.loading = 'eager';
      img.decoding = 'async';
      img.src = `${CARD_IMAGE_BASE.replace(/\/$/, '')}/back.png?v=1`;
      img.onerror = () => { el.innerHTML = backSvg(); };   // Fallback auf SVG-Rueckseite
      el.appendChild(img);
    } else {
      el.innerHTML = backSvg();
    }
    return el;
  }

  if (CARD_IMAGE_BASE) {
    const img = document.createElement('img');
    img.className = 'wcard-img';
    img.alt = cardLabel(code);
    img.loading = 'eager';        // sichtbare Karten sofort laden (meist schon im Cache)
    img.decoding = 'async';
    img.src = `${CARD_IMAGE_BASE.replace(/\/$/, '')}/${code}.png?v=10`;
    img.onerror = () => { el.innerHTML = faceSvg(code); };   // Fallback auf SVG
    el.appendChild(img);
  } else {
    el.innerHTML = faceSvg(code);
  }
  return el;
}

// --- Farbsymbole (24x24) ---------------------------------------------------
function suitGlyph(s, fill) {
  switch (s) {
    case 'R': // Flamme
      return `<path d="M12 1.6c1.7 3.9 4.9 5.4 4.9 9.1a4.9 4.9 0 0 1-9.8 0c0-1.8.8-3 1.8-4.1-.2 1.8.8 2.9 1.8 3.1-.8-2.8.3-5.5 1.3-8.1z" fill="${fill}"/>`;
    case 'Y': { // Sonne
      const rays = [...Array(8)].map((_, i) =>
        `<rect x="11.1" y="1" width="1.8" height="3.6" rx=".9" transform="rotate(${i * 45} 12 12)"/>`).join('');
      return `<g fill="${fill}">${rays}<circle cx="12" cy="12" r="4.6"/></g>`;
    }
    case 'G': // Blatt
      return `<path d="M12 21.5C6 18.8 4.3 12.4 5.6 3.8c8 .2 12.8 4.3 12.8 11.1 0 3.4-2.5 5.4-6.4 6.6z" fill="${fill}"/>
              <path d="M11.4 20.5C11 14 10.4 9.4 6.8 6" stroke="#fff" stroke-width="1" fill="none" opacity=".55"/>`;
    case 'B': // Tropfen
      return `<path d="M12 2.6c3.9 5.8 6 8.8 6 11.9a6 6 0 0 1-12 0c0-3.1 2.1-6.1 6-11.9z" fill="${fill}"/>
              <path d="M9 14.5a3 3 0 0 0 2 2.6" stroke="#fff" stroke-width="1" fill="none" opacity=".5"/>`;
  }
  return '';
}

// Eck-Index: Rang + kleines Farbsymbol (oben-links positioniert).
function cornerIndex(rank, s) {
  return `
    <text x="15" y="25" font-size="18" font-weight="800" fill="${SUIT[s].dark}"
          text-anchor="middle" font-family="Georgia,'Times New Roman',serif">${rank}</text>
    <svg x="8.5" y="27" width="13" height="13" viewBox="0 0 24 24">${suitGlyph(s, SUIT[s].hex)}</svg>`;
}

// --- Zahlenkarte -----------------------------------------------------------
function faceSvg(code) {
  const c = parseCard(code);
  if (c.type === 'wizard') return wizardSvg();
  if (c.type === 'jester') return jesterSvg();
  const s = c.color;
  const { hex } = SUIT[s];
  const idx = cornerIndex(c.rank, s);
  return `
  <svg viewBox="0 0 100 140" class="wcard-svg">
    <rect x="1.5" y="1.5" width="97" height="137" rx="12" fill="${hex}"/>
    <rect x="6" y="6" width="88" height="128" rx="8" fill="#f7f3e8"/>
    <!-- Illustrations-Fenster mit Emblem -->
    <rect x="26" y="40" width="48" height="60" rx="7" fill="${hex}" opacity="0.13"/>
    <rect x="26" y="40" width="48" height="60" rx="7" fill="none" stroke="${hex}" stroke-width="1.6" opacity="0.65"/>
    <svg x="33" y="53" width="34" height="34" viewBox="0 0 24 24">${suitGlyph(s, hex)}</svg>
    <!-- Eck-Indizes (oben-links + gespiegelt unten-rechts) -->
    ${idx}
    <g transform="rotate(180 50 70)">${idx}</g>
  </svg>`;
}

// --- Zauberer --------------------------------------------------------------
function wizardSvg() {
  const stars = [[20, 44], [80, 40], [24, 110], [78, 112], [50, 36]]
    .map(([x, y]) => `<text x="${x}" y="${y}" font-size="8" fill="#ffd66b" opacity=".85" text-anchor="middle">✦</text>`).join('');
  return `
  <svg viewBox="0 0 100 140" class="wcard-svg">
    <defs><linearGradient id="wzf" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#e5484d"/><stop offset=".33" stop-color="#f0b429"/>
      <stop offset=".66" stop-color="#34c77b"/><stop offset="1" stop-color="#5b8def"/>
    </linearGradient></defs>
    <rect x="1.5" y="1.5" width="97" height="137" rx="12" fill="url(#wzf)"/>
    <rect x="6" y="6" width="88" height="128" rx="8" fill="#140f28"/>
    ${stars}
    <text x="50" y="24" font-size="11.5" font-weight="800" fill="#ffd66b"
          text-anchor="middle" letter-spacing="1.5" font-family="Georgia,serif">ZAUBERER</text>
    <g fill="#f3e7c4">
      <path d="M50 32 L61 71 H39 Z"/>                       <!-- Hut -->
      <ellipse cx="50" cy="72" rx="14" ry="2.6"/>           <!-- Krempe -->
      <circle cx="50" cy="83" r="6"/>                        <!-- Kopf -->
      <path d="M44.5 85 Q50 102 55.5 85 Z"/>                 <!-- Bart -->
      <path d="M41 92 Q50 96 59 92 L64 119 H36 Z"/>          <!-- Robe -->
      <rect x="64.5" y="62" width="2.4" height="42" rx="1.2"/> <!-- Stab -->
    </g>
    <circle cx="65.7" cy="60" r="4.2" fill="#ffd66b"/>       <!-- Stab-Kugel -->
    <circle cx="65.7" cy="60" r="7" fill="#ffd66b" opacity=".25"/>
  </svg>`;
}

// --- Narr ------------------------------------------------------------------
function jesterSvg() {
  return `
  <svg viewBox="0 0 100 140" class="wcard-svg">
    <rect x="1.5" y="1.5" width="97" height="137" rx="12" fill="#7c8597"/>
    <rect x="6" y="6" width="88" height="128" rx="8" fill="#eee9dd"/>
    <circle cx="50" cy="84" r="9" fill="#cdd3dc"/>            <!-- Kopf -->
    <path d="M50 79 Q33 71 29 49 Q44 55 50 64 Q56 55 71 49 Q67 71 50 79 Z" fill="#9aa3b2"/>
    <path d="M50 64 Q49 52 40 45" stroke="#9aa3b2" stroke-width="5" fill="none" stroke-linecap="round"/>
    <circle cx="29" cy="49" r="4" fill="#f0b429"/>
    <circle cx="71" cy="49" r="4" fill="#f0b429"/>
    <circle cx="40" cy="45" r="4" fill="#f0b429"/>
    <path d="M40 92 H60 L64 105 H36 Z" fill="#9aa3b2"/>       <!-- Kragen -->
    <text x="50" y="125" font-size="13" font-weight="800" fill="#5b6470"
          text-anchor="middle" letter-spacing="2" font-family="Georgia,serif">NARR</text>
  </svg>`;
}

// --- Rückseite -------------------------------------------------------------
function backSvg() {
  return `
  <svg viewBox="0 0 100 140" class="wcard-svg">
    <rect x="1.5" y="1.5" width="97" height="137" rx="12" fill="#2a2147"/>
    <rect x="7" y="7" width="86" height="126" rx="8" fill="#221a3d" stroke="#5b4b8a" stroke-width="2"/>
    <g fill="none" stroke="#5b4b8a" stroke-width="1.5" opacity=".7">
      <circle cx="50" cy="70" r="23"/><circle cx="50" cy="70" r="15"/>
    </g>
    <text x="50" y="77" font-size="22" text-anchor="middle" fill="#cdb4ff">✦</text>
  </svg>`;
}
