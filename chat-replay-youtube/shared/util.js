// Utilidades compartidas
export const SEP = '\u0001';

export function fmtTime(s) {
  if (s == null || !isFinite(s)) return '--:--';
  const neg = s < 0; s = Math.abs(Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const p = n => String(n).padStart(2, '0');
  return (neg ? '-' : '') + (h ? `${h}:${p(m)}:${p(x)}` : `${m}:${p(x)}`);
}
export function fmtSigned(s) {
  const v = Math.round(s * 10) / 10;
  return (v > 0 ? '+' : '') + v.toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' s';
}
export const fmtNum = n => (n || 0).toLocaleString('es-ES');
export function fmtMB(b) { b = b || 0; return (b / 1048576).toLocaleString('es-ES', { maximumFractionDigits: b > 1e8 ? 0 : 1 }) + ' MB'; }
export function fmtDate(ts) { try { return new Date(ts).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return ''; } }

export function norm(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\.json(\.gz)?$|\.gz$/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
/** Parecido entre título de YouTube y nombre de archivo (0..1) */
export function titleScore(a, b) {
  const A = norm(a), B = norm(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  const ta = new Set(A.split(' ')), tb = new Set(B.split(' '));
  let inter = 0; for (const t of ta) if (tb.has(t)) inter++;
  let s = (2 * inter) / (ta.size + tb.size);
  if (A.includes(B) || B.includes(A)) s = Math.max(s, 0.9);
  return s;
}

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Resalta `query` dentro de `text` creando <mark class="hit"> (búsquedas) */
export function highlightInto(el, text, query) {
  if (!query) { el.append(text); return 0; }
  const re = new RegExp(escapeRe(query), 'gi');
  let last = 0, m, n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) el.append(text.slice(last, m.index));
    el.append(h('mark', { class: 'hit', text: m[0] }));
    last = m.index + m[0].length; n++;
    if (!m[0].length) re.lastIndex++;
  }
  if (last < text.length) el.append(text.slice(last));
  return n;
}

export const ICONS = {
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  sync: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/></svg>',
  chart: '<svg viewBox="0 0 24 24"><path d="M3 20h18"/><path d="M6 16v-5M10 16V6M14 16v-8M18 16v-3"/></svg>',
  drive: '<svg viewBox="0 0 24 24"><path d="M8 3h8l6 11-4 7H6l-4-7z"/><path d="M8 3l6 11H2M16 3l-6 11M14 14h8"/></svg>',
  library: '<svg viewBox="0 0 24 24"><path d="M4 4h4v16H4zM10 4h4v16h-4z"/><path d="M16.5 4.5l3.5 1-4 15-3.5-1"/></svg>',
  cut: '<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.1 8.1L20 20M8.1 15.9L20 4"/></svg>',
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  fire: '<svg viewBox="0 0 24 24"><path d="M12 3s5 4.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 1.5-4S9 12 11 12c0-4 1-6 1-9z"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
  filter: '<svg viewBox="0 0 24 24"><path d="M3 5h18l-7 8v6l-4-2v-4z"/></svg>',
  mark: '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>'
};

/** Carga Google Fonts sin bloquear el pintado (si falla, se usan las fuentes del sistema) */
export function loadFonts() {
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&family=Outfit:wght@700;800&display=swap';
  document.head.append(l);
}

/**
 * Lee un tiempo escrito a mano: «2» = 2 min, «2:30» = 2 min 30 s, «1:02:30», «90s», «10m», «-1:30».
 * Devuelve segundos o NaN.
 */
export function parseClock(str, { minutesDefault = true } = {}) {
  let s = String(str || '').trim().toLowerCase().replace(',', '.').replace(/\s+/g, '');
  if (!s) return NaN;
  let sign = 1;
  if (s[0] === '+') s = s.slice(1); else if (s[0] === '-' || s[0] === '−') { sign = -1; s = s.slice(1); }
  let m;
  if ((m = s.match(/^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m(?:in)?)?(?:(\d+(?:\.\d+)?)s)?$/)) && (m[1] || m[2] || m[3]))
    return sign * ((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0));
  if (/^\d+(\.\d+)?$/.test(s)) return sign * (+s) * (minutesDefault ? 60 : 1);
  if (/^\d+(:\d{1,2}(\.\d+)?){1,2}$/.test(s)) return sign * s.split(':').reduce((a, b) => a * 60 + +b, 0);
  return NaN;
}
/** «+10:00» / «−1:30» para mostrar un salto */
export function fmtJump(s) { return (s < 0 ? '−' : '+') + fmtTime(Math.abs(s)); }
