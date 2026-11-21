// Sonidos sintetizados con WebAudio (sin archivos, ocupan 0 KB)
let ctx = null, master = null;
const cfg = { on: true, vol: 0.5, ui: true, hl: true, notice: false, load: true };
const CAT = { click: 'ui', open: 'ui', close: 'ui', tick: 'ui', toggle: 'ui', mention: 'hl', notice: 'notice', success: 'load', error: 'load' };
const last = {};

function ac() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C(); master = ctx.createGain(); master.gain.value = cfg.vol; master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
function tone(f, t0, dur, { type = 'sine', gain = 0.3, to = null, attack = 0.006 } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t0);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.03);
}
const P = {
  click: t => tone(1650, t, 0.045, { type: 'triangle', gain: 0.1 }),
  tick: t => tone(2200, t, 0.03, { type: 'sine', gain: 0.07 }),
  toggle: t => { tone(880, t, 0.05, { type: 'triangle', gain: 0.09 }); tone(1320, t + 0.04, 0.06, { type: 'triangle', gain: 0.08 }); },
  open: t => { tone(520, t, 0.1, { gain: 0.12 }); tone(780, t + 0.06, 0.14, { gain: 0.12 }); },
  close: t => { tone(700, t, 0.08, { gain: 0.1 }); tone(470, t + 0.05, 0.13, { gain: 0.1 }); },
  mention: t => { tone(1318.5, t, 0.35, { gain: 0.2 }); tone(1975.5, t + 0.09, 0.45, { gain: 0.14 }); },
  notice: t => [523.25, 659.25, 783.99, 1046.5].forEach((f, k) => tone(f, t + k * 0.07, 0.3, { gain: 0.12, type: 'triangle' })),
  success: t => [587.33, 739.99, 880, 1174.66].forEach((f, k) => tone(f, t + k * 0.08, 0.28, { gain: 0.14 })),
  error: t => { tone(240, t, 0.18, { type: 'square', gain: 0.06 }); tone(170, t + 0.16, 0.26, { type: 'square', gain: 0.06 }); }
};
export const Sound = {
  config(c) { Object.assign(cfg, c); if (master) master.gain.value = cfg.vol; },
  fromSettings(S) { this.config({ on: S.soundOn, vol: S.soundVol, ui: S.soundUi, hl: S.soundHl, notice: S.soundNotice, load: S.soundLoad }); },
  unlock() { ac(); },
  play(name, minGapMs = 0) {
    if (!cfg.on || !P[name]) return;
    const c = CAT[name]; if (c && !cfg[c]) return;
    const now = performance.now();
    if (minGapMs && last[name] && now - last[name] < minGapMs) return;
    last[name] = now;
    if (!ac()) return;
    try { P[name](ctx.currentTime + 0.01); } catch {}
  }
};
