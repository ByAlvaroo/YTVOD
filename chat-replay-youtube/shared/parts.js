// Directos divididos en varias partes: «Título [[parte1]].json», «Título [[parte2]].json»…
import { SEP, norm, titleScore } from './util.js';

const PART_RE = /\[\[\s*parte\s*[-_ ]?\s*(\d+)\s*\]\]/i;

/** { base, n } — n = número de parte o null si el archivo no es una parte */
export function partOf(name) {
  const clean = (name || '').replace(/\.json(\.gz)?$|\.gz$/i, '');
  const m = clean.match(PART_RE);
  if (!m) return { base: clean.trim(), n: null };
  return { base: clean.replace(PART_RE, ' ').replace(/\s+/g, ' ').trim(), n: +m[1] };
}

/**
 * Agrupa los archivos de Drive: las partes de un mismo directo (misma carpeta y mismo nombre base) van juntas.
 * Devuelve [{ key, name, folder, files: [ordenados por parte], multi, score }]
 */
export function groupFiles(files, ytTitle) {
  const map = new Map();
  for (const f of files || []) {
    const { base, n } = partOf(f.name);
    const key = n == null ? 'f:' + f.id : 'g:' + (f.folder || '') + '|' + norm(base);
    let g = map.get(key);
    if (!g) { g = { key, name: base, folder: f.folder || '', modified: f.modified, files: [] }; map.set(key, g); }
    g.files.push({ ...f, part: n });
  }
  const out = [...map.values()];
  for (const g of out) {
    g.files.sort((a, b) => (a.part || 0) - (b.part || 0));
    g.multi = g.files.length > 1 || g.files[0].part != null;
    g.score = ytTitle ? titleScore(ytTitle, g.name) : 0;
  }
  return out;
}

const endOf = m => (m.end > 0 ? m.end : m.length > 0 ? m.length : m.lastT) || 0;

/* ---------- Ajustes propios de cada parte (VOD) ----------
 * cfg[k] = { off, from, to, cuts: [{ at, jump }] }   (todo en segundos)
 *   off  : mueve SOLO esta parte (+ más tarde, − antes; puede pisar a la anterior)
 *   from : el chat de este VOD empieza en este minuto de SU chat (lo anterior se descarta)
 *   to   : el chat de este VOD termina en este minuto de SU chat (lo posterior se descarta)
 *   cuts : saltos dentro de este VOD; «at» es el minuto de SU chat; jump > 0 salta hacia delante, < 0 espera
 * Regla: una parte no empieza a verse hasta que termina la anterior (lo que se pise se descarta).
 */
export const cfgOf = (cfg, k) => { const c = (cfg && cfg[k]) || {}; return { off: +c.off || 0, from: c.from == null ? null : +c.from, to: c.to == null ? null : +c.to, cuts: (c.cuts || []).filter(x => x && isFinite(x.at) && x.jump).slice().sort((a, b) => a.at - b.at) }; };
/** Minuto del chat de la parte → línea de tiempo unida (null si ese mensaje se descarta) */
export function rawToMerged(p, t) {
  if (p.from != null && t < p.from) return null;
  if (p.to != null && t > p.to) return null;
  let j = 0;
  for (const c of p.cuts) {
    if (t < c.at) break;
    if (c.jump > 0) { if (t < c.at + c.jump) return null; j += c.jump; } else j += c.jump;
  }
  const T = t + p.shift - j;
  return T < p.minT ? null : T;
}
/** Línea de tiempo unida → minuto del chat de la parte (inverso; en zonas saltadas devuelve el borde) */
export function mergedToRaw(p, T) {
  let t = T - p.shift, j = 0;
  for (const c of p.cuts) {
    if (t + j < c.at) break;
    j += c.jump;
  }
  return t + j;
}

/**
 * Une varios chats en una sola línea de tiempo: la parte 2 empieza justo donde acaba la parte 1, etc.
 * Los índices de usuarios, colores, insignias, emotes e imágenes se reajustan.
 */
export function mergeChats(list, names = [], gaps = [], cfg = []) {
  if (list.length === 1) return list[0];
  const total = list.reduce((a, d) => a + d.T.length, 0);
  let T = new Float64Array(total), U = new Uint32Array(total), C = new Uint32Array(total), B = new Uint32Array(total), F = new Uint8Array(total), PI = new Uint8Array(total);
  const M = [];
  const out = { v: 1, names: [], logins: [], colors: [], badges: [], sets: [], emotes: [], images: [] };
  const userIdx = new Map();
  const parts = [];
  const anyP = list.some(d => d.P);
  let P = anyP ? new Int32Array(total).fill(-1) : null;
  let w = 0, acc = 0, prevEnd = -Infinity;
  list.forEach((d, k) => {
    const m = d.meta, start = m.start || 0, end = endOf(m);
    const gap = k === 0 ? 0 : (+gaps[k] || 0);
    if (k) acc += gap;
    const c = cfgOf(cfg, k);
    const base = k === 0 ? 0 : acc - start;            // posición «natural»: justo detrás de la parte anterior
    const p = { n: k + 1, name: names[k] || m.title || '', dur: Math.max(0, end - start), gap, vodId: m.vodId || null,
      rawStart: start, rawEnd: end, shift: base + c.off, off: c.off, from: c.from, to: c.to, cuts: c.cuts, minT: -Infinity, countAll: d.T.length, count: 0 };
    // no se ve hasta que acabe el chat de la parte anterior
    p.minT = k === 0 ? -Infinity : prevEnd;
    const lastRaw = Math.min(p.to != null ? p.to : end, end);
    let effEnd = rawToMerged(p, lastRaw);
    if (effEnd == null) { // el final cae en un salto: el último minuto que sí se ve
      effEnd = p.shift + lastRaw - p.cuts.filter(x => x.at <= lastRaw).reduce((a, x) => a + x.jump, 0);
    }
    const st0 = rawToMerged(p, p.from != null ? Math.max(p.from, start) : start);
    p.at = Math.max(st0 != null ? st0 : p.shift + start, k ? prevEnd : -Infinity);
    p.end = Math.max(effEnd, p.at);
    parts.push(p);
    acc = k === 0 ? end : acc + Math.max(0, end - start);

    const imgOff = out.images.length, emOff = out.emotes.length, bOff = out.badges.length, sOff = out.sets.length, cOff = out.colors.length;
    out.images.push(...d.images);
    for (const e of d.emotes) out.emotes.push({ ...e, img: e.img + imgOff });
    for (const b of d.badges) out.badges.push({ ...b, img: b.img < 0 ? -1 : b.img + imgOff });
    for (const s of d.sets) out.sets.push(s.map(x => x + bOff));
    out.colors.push(...d.colors);
    const uMap = d.names.map((nm, u) => {
      const l = d.logins[u];
      let i = userIdx.get(l);
      if (i === undefined) { i = out.names.push(nm) - 1; out.logins.push(l); userIdx.set(l, i); }
      return i;
    });
    const re = /\u0001(\d+)\u0001/g;
    const idx = new Int32Array(d.T.length).fill(-1);   // posición nueva de cada mensaje (para las respuestas)
    for (let i = 0; i < d.T.length; i++) {
      const t = rawToMerged(p, d.T[i]);
      if (t == null || t > p.end + 0.001) continue;
      idx[i] = w;
      if (P) P[w] = d.P && d.P[i] >= 0 && idx[d.P[i]] >= 0 ? idx[d.P[i]] : -1;
      T[w] = t; U[w] = uMap[d.U[i]]; C[w] = d.C[i] + cOff; B[w] = d.B[i] + sOff; F[w] = d.F[i]; PI[w] = k;
      const s = d.M[i];
      M.push(emOff && s.indexOf(SEP) >= 0 ? s.replace(re, (_, x) => SEP + (+x + emOff) + SEP) : s);
      w++; p.count++;
    }
    prevEnd = Math.max(prevEnd, p.end);
  });
  // la búsqueda binaria necesita los tiempos ordenados (un salto negativo puede desordenar alguno)
  let sorted = true; for (let i = 1; i < w; i++) if (T[i] < T[i - 1]) { sorted = false; break; }
  if (!sorted) {
    const ord = Array.from({ length: w }, (_, i) => i).sort((a, b) => T[a] - T[b] || a - b);
    const inv = new Int32Array(w); ord.forEach((o, n) => { inv[o] = n; });
    const re = (A, Ctor) => { const R = new Ctor(w); ord.forEach((o, n) => { R[n] = A[o]; }); return R; };
    T = re(T, Float64Array); U = re(U, Uint32Array); C = re(C, Uint32Array); B = re(B, Uint32Array); F = re(F, Uint8Array); PI = re(PI, Uint8Array);
    const M2 = ord.map(o => M[o]); M.length = 0; M.push(...M2);
    if (P) { const P2 = new Int32Array(w); ord.forEach((o, n) => { P2[n] = P[o] >= 0 ? inv[P[o]] : -1; }); P = P2; }
  }
  Object.assign(out, { T: T.slice(0, w), U: U.slice(0, w), C: C.slice(0, w), B: B.slice(0, w), F: F.slice(0, w), PI: PI.slice(0, w), M });
  if (P) out.P = P.slice(0, w);
  const f = list[0].meta;
  out.meta = {
    ...f,
    start: f.start || 0, end: parts[parts.length - 1].end, length: 0,
    count: w, chatters: out.names.length, lastT: w ? out.T[w - 1] : 0,
    vodId: list.map(d => d.meta.vodId).filter(Boolean).join('+') || null,
    parts
  };
  out.src = { list, names };
  return out;
}
