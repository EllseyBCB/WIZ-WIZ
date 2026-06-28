// Generative, komplett lizenzfreie Hintergrundmusik (Web Audio API).
// Erzeugt einen sanften, mystischen Ambient-Loop direkt im Browser – KEINE
// Audiodatei, kein Download (schont die Ladezeit). Lautstaerke und An/Aus
// werden in localStorage gemerkt. Wegen Autoplay-Regeln startet der Klang
// erst nach der ersten Nutzer-Interaktion.

const LS_ON = 'wizard_music_on';
const LS_VOL = 'wizard_music_vol';
const LS_SFX = 'wizard_sfx_on';
const LS_SFXVOL = 'wizard_sfx_vol';

const clamp01 = v => Math.max(0, Math.min(1, v));

let ctx = null, master = null, lp = null, sfx = null, running = false, timer = null, step = 0;
let enabled = localStorage.getItem(LS_ON) !== '0';                 // Musik – Standard: an
let sfxOn = localStorage.getItem(LS_SFX) !== '0';                  // Effekte – Standard: an
let volume = clamp01(parseFloat(localStorage.getItem(LS_VOL)));
if (Number.isNaN(volume)) volume = 0.4;
let sfxVol = clamp01(parseFloat(localStorage.getItem(LS_SFXVOL)));
if (Number.isNaN(sfxVol)) sfxVol = 0.6;
const sfxLevel = () => sfxVol * 0.55;                             // Gesamtpegel der Effekte

const HZ = m => 440 * Math.pow(2, (m - 69) / 12);                  // MIDI -> Frequenz
// A-Moll Fantasy-Progression: Am – F – C – G  (i – VI – III – VII)
const CHORDS = [
  [45, 57, 60, 64],   // Am: A2 A3 C4 E4
  [41, 53, 57, 60],   // F:  F2 F3 A3 C4
  [48, 55, 60, 64],   // C:  C3 G3 C4 E4
  [43, 55, 59, 62],   // G:  G2 G3 B3 D4
];

function targetGain() { return enabled ? volume * 0.5 : 0; }      // insgesamt dezent

function ensure() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = targetGain();
  lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500; lp.Q.value = 0.3;
  // einfacher Hall (Delay + Feedback) fuer Weite/Atmosphaere
  const delay = ctx.createDelay(1.0); delay.delayTime.value = 0.42;
  const fb = ctx.createGain(); fb.gain.value = 0.33;
  const wet = ctx.createGain(); wet.gain.value = 0.4;
  lp.connect(master);
  lp.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(master);
  master.connect(ctx.destination);
  // Eigener Kanal fuer Klangeffekte (unabhaengig von der Musik-Lautstaerke)
  sfx = ctx.createGain(); sfx.gain.value = sfxLevel(); sfx.connect(ctx.destination);
}

// Stellt sicher, dass ein (laufender) AudioContext existiert – fuer Effekte,
// die auch ohne Musik abgespielt werden. Muss aus einer Nutzergeste kommen.
function ready() {
  ensure();
  if (!ctx) return false;
  if (ctx.state === 'suspended') ctx.resume();
  return true;
}

// Kurzer Ton mit weicher Huellkurve, ueber den Effekt-Kanal.
function tone(freq, start, dur, opts = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = opts.type || 'sine'; o.frequency.setValueAtTime(freq, start);
  if (opts.glide) o.frequency.exponentialRampToValueAtTime(opts.glide, start + dur);
  const v = (opts.vol ?? 0.25);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.linearRampToValueAtTime(v, start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g); g.connect(sfx);
  o.start(start); o.stop(start + dur + 0.02);
}

// --- Klangeffekte -----------------------------------------------------------
export function sfxCard() {            // Karte legen: kurzer "Flick"
  if (!sfxOn || !ready()) return; const t = ctx.currentTime;
  tone(520, t, 0.07, { type: 'triangle', vol: 0.22, glide: 240 });
}
export function sfxBid() {             // Ansage: weicher Blip
  if (!sfxOn || !ready()) return; const t = ctx.currentTime;
  tone(440, t, 0.10, { type: 'sine', vol: 0.22, glide: 560 });
}
export function sfxTap() {             // UI-Klick in der Lobby: kurzer, dezenter Tap
  if (!sfxOn || !ready()) return; const t = ctx.currentTime;
  tone(660, t, 0.045, { type: 'sine', vol: 0.15, glide: 900 });
}
export function sfxTrick() {           // Stich gewonnen: kleines Glocken-Motiv
  if (!sfxOn || !ready()) return; const t = ctx.currentTime;
  [[660, 0], [880, 0.10], [1320, 0.20]].forEach(([f, dt]) => tone(f, t + dt, 0.55, { type: 'sine', vol: 0.20 }));
}
export function sfxTurn() {            // Du bist dran: zarter Zweiklang
  if (!sfxOn || !ready()) return; const t = ctx.currentTime;
  tone(784, t, 0.18, { type: 'sine', vol: 0.20 }); tone(1046, t + 0.14, 0.30, { type: 'sine', vol: 0.18 });
}
export function sfxDeal() {            // Austeilen: schnelle Folge leiser Ticks
  if (!sfxOn || !ready()) return; const t = ctx.currentTime;
  for (let i = 0; i < 6; i++) tone(300 + Math.random() * 120, t + i * 0.06, 0.05, { type: 'triangle', vol: 0.12, glide: 180 });
}
export function sfxWin() {             // Spielende: kurze Fanfare
  if (!sfxOn || !ready()) return; const t = ctx.currentTime;
  [[523, 0], [659, 0.12], [784, 0.24], [1046, 0.40]].forEach(([f, dt]) => tone(f, t + dt, 0.7, { type: 'triangle', vol: 0.22 }));
}

// Vibration (nur Mobil, an den Effekt-Schalter gekoppelt).
// Im nativen iOS/Android-WebView gibt es navigator.vibrate nicht -> Capacitor
// Haptics. Im Browser/PWA unveraendert ueber navigator.vibrate.
export function haptic(pattern) {
  if (!sfxOn) return;
  try {
    const cap = window.Capacitor;
    if (cap && cap.isNativePlatform && cap.isNativePlatform()) {
      const H = cap.Plugins && cap.Plugins.Haptics;
      if (H) {
        const dur = Array.isArray(pattern) ? pattern.reduce((a, b) => a + b, 0) : (pattern || 30);
        H.vibrate({ duration: Math.min(Math.max(dur, 10), 300) }).catch(() => {});
        return;
      }
    }
  } catch (_) {}
  try { navigator.vibrate && navigator.vibrate(pattern); } catch (_) {}
}

export function setSfx(on) { sfxOn = !!on; localStorage.setItem(LS_SFX, sfxOn ? '1' : '0'); }
export function sfxEnabled() { return sfxOn; }
export function setSfxVolume(v) {
  sfxVol = clamp01(v);
  localStorage.setItem(LS_SFXVOL, String(sfxVol));
  if (sfx && ctx) sfx.gain.setTargetAtTime(sfxLevel(), ctx.currentTime, 0.03);
}
export function getSfxVolume() { return sfxVol; }

// Weicher, langer Pad-Ton (zwei leicht verstimmte Oszillatoren).
function pad(freq, t, dur) {
  const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
  o1.type = 'triangle'; o2.type = 'sine'; o2.detune.value = 7;
  o1.frequency.value = freq; o2.frequency.value = freq;
  const peak = 0.10;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + 1.6);
  g.gain.setValueAtTime(peak, t + dur - 1.8);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  o1.connect(g); o2.connect(g); g.connect(lp);
  o1.start(t); o2.start(t); o1.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
}

// Zarte Glocke/Glockenspiel-Note (klingt aus).
function bell(freq, t) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine'; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.13, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
  o.connect(g); g.connect(lp);
  o.start(t); o.stop(t + 2.7);
}

// Einen "Takt" planen: Akkord-Pad + ein paar Glockentoene, dann der naechste.
function scheduleBar() {
  if (!running || !ctx) return;
  const bar = 7.5;
  const t = ctx.currentTime + 0.08;
  const ch = CHORDS[step % CHORDS.length];
  ch.forEach(m => pad(HZ(m), t, bar + 1.2));                       // Pad (mit Ueberlappung)
  const pool = ch.map(m => m + 12).concat(ch[0] + 24, ch[2] + 12); // Toene eine Oktave hoeher
  const count = 4;
  for (let i = 0; i < count; i++) {
    const nt = t + (i * bar / count) + Math.random() * 0.5;
    bell(HZ(pool[Math.floor(Math.random() * pool.length)]), nt);
  }
  step++;
  timer = setTimeout(scheduleBar, bar * 1000);
}

// --- Oeffentliche API -------------------------------------------------------
export function startMusic() {
  if (!enabled) return;
  ensure();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();
  if (master) master.gain.setTargetAtTime(targetGain(), ctx.currentTime, 0.4);
  if (running) return;
  running = true;
  scheduleBar();
}

export function stopMusic() {
  running = false;
  if (timer) { clearTimeout(timer); timer = null; }
  if (master && ctx) master.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
}

export function setEnabled(on) {
  enabled = !!on;
  localStorage.setItem(LS_ON, enabled ? '1' : '0');
  if (enabled) startMusic(); else stopMusic();
}

export function setVolume(v) {
  volume = clamp01(v);
  localStorage.setItem(LS_VOL, String(volume));
  if (master && ctx) master.gain.setTargetAtTime(targetGain(), ctx.currentTime, 0.05);
}

export function isEnabled() { return enabled; }
export function getVolume() { return volume; }
