// Cuenta: tus ajustes y la sincronización de cada vídeo se guardan en tu cuenta de Google de Chrome (chrome.storage.sync),
// así se recuperan solos al reinstalar la extensión o en otro ordenador con la misma cuenta de Chrome.
import * as DB from './db.js';
import { DEFAULTS, loadSettings } from './settings.js';
import { BYALVARO } from './byalvaro.js';

export const AKEY = 'tcr_account';          // { name, slug, at } — SOLO en este navegador (local): nadie empieza con una sesión iniciada
export const STATUS_KEY = 'tcr_acct_status'; // { at, ok, error, bytes } (local)
export const LOCAL_KEYS = ['tcr_settings', 'tcr_overlay', 'tcr_fsw'];
const CH = 1500;          // caracteres por trozo (cada elemento de storage.sync admite 8 KB)
const BUDGET = 92000;     // de los 100 KB que da Chrome
const enc = new TextEncoder();

export const slugOf = n => String(n || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '').slice(0, 32);
export const isByAlvaro = slug => slug === 'byalvaro';
export const hasPreset = () => !!BYALVARO.settings;
const pk = (slug, i) => `tcr_p_${slug}_${i}`;
const mk = slug => `tcr_p_${slug}_n`;
export const metaKey = mk;

/** JSON con las claves ordenadas: así dos perfiles iguales dan el mismo texto */
export function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(x => stable(x === undefined ? null : x)).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}

export async function getAccount() { try { return (await chrome.storage.local.get(AKEY))[AKEY] || null; } catch { return null; } }
/** Versiones anteriores guardaban la sesión en la cuenta de Google de Chrome (se iniciaba sola en cualquier navegador): se quita */
export async function dropSyncedSession() { try { await chrome.storage.sync.remove(AKEY); } catch {} }

async function rawProfile(slug) {
  const meta = (await chrome.storage.sync.get(mk(slug)))[mk(slug)];
  if (!meta || !meta.n) return null;
  const keys = Array.from({ length: meta.n }, (_, i) => pk(slug, i));
  const o = await chrome.storage.sync.get(keys);
  if (keys.some(k => typeof o[k] !== 'string')) return null;   // aún llegando desde otro ordenador
  return keys.map(k => o[k]).join('');
}
export async function readProfile(slug) {
  const s = await rawProfile(slug);
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

/* ---------- Perfil = ajustes + posición + sincronización de cada vídeo ---------- */
const hasSync = l => { const s = l.sync || {}; return !!((s.delta || 0) || (s.cuts && s.cuts.length) || (s.gaps && s.gaps.some(Boolean)) || (s.parts && s.parts.some(p => p && Object.keys(p).length)) || (s.mode && s.mode !== 'auto') || (l.marks && l.marks.length)); };
const okSrcs = s => Array.isArray(s) && s.length && s.every(x => x && (x.type === 'drive' || x.type === 'url')) ? s.map(x => x.type === 'drive' ? { type: 'drive', id: x.id, name: x.name } : { type: 'url', url: x.url }) : undefined;

async function collect() {
  const loc = await chrome.storage.local.get(LOCAL_KEYS);
  const links = await DB.all('links').catch(() => []);
  const L = {};
  for (const l of links) {
    if (!l || !l.vid) continue;
    const r = okSrcs(l.srcs);
    if (!hasSync(l) && !r) continue;
    L[l.vid] = { s: l.sync, m: l.marks && l.marks.length ? l.marks : undefined, r, t: l.ytTitle || undefined, k: l.linkedAt || 0, d: l.detached ? 1 : undefined };
  }
  return { v: 1, settings: loc.tcr_settings || null, overlay: loc.tcr_overlay || null, fsw: loc.tcr_fsw || null, links: L };
}
/** Convierte el perfil en texto; si no cabe en la cuota de Chrome se quitan los vídeos más antiguos */
function fit(prof) {
  let json = stable(prof);
  if (enc.encode(json).length * 1.08 <= BUDGET) return json;
  const vids = Object.keys(prof.links).sort((a, b) => (prof.links[a].k || 0) - (prof.links[b].k || 0));
  const p = { ...prof, links: { ...prof.links } };
  for (const v of vids) {
    delete p.links[v];
    json = stable(p);
    if (enc.encode(json).length * 1.08 <= BUDGET) break;
  }
  return json;
}
async function writeRaw(slug, json) {
  const n = Math.max(1, Math.ceil(json.length / CH));
  const items = { [mk(slug)]: { n, at: Date.now(), bytes: enc.encode(json).length } };
  for (let i = 0; i < n; i++) items[pk(slug, i)] = json.slice(i * CH, (i + 1) * CH);
  const old = (await chrome.storage.sync.get(mk(slug)))[mk(slug)];
  // primero los trozos y al final la cabecera, para que otro ordenador no lea un perfil a medias
  const head = items[mk(slug)]; delete items[mk(slug)];
  await chrome.storage.sync.set(items);
  await chrome.storage.sync.set({ [mk(slug)]: head });
  if (old && old.n > n) await chrome.storage.sync.remove(Array.from({ length: old.n - n }, (_, i) => pk(slug, n + i)));
  return head;
}
async function setStatus(s) { try { await chrome.storage.local.set({ [STATUS_KEY]: { at: Date.now(), ...s } }); } catch {} }

/** Sube a tu cuenta lo que hay en este navegador (solo si ha cambiado algo) */
export async function push(force) {
  const a = await getAccount();
  if (!a) return { ok: false, error: 'Sin sesión' };
  try {
    const json = fit(await collect());
    const cur = await rawProfile(a.slug);
    if (!force && cur === json) return { ok: true, same: true };
    const head = await writeRaw(a.slug, json);
    await setStatus({ ok: true, bytes: head.bytes });
    return { ok: true, bytes: head.bytes };
  } catch (e) {
    const msg = /QUOTA|quota/.test(e.message) ? 'No cabe en tu cuenta (límite de Chrome)' : /MAX_WRITE/.test(e.message) ? 'Demasiados cambios seguidos: se guardará en un momento' : e.message;
    await setStatus({ ok: false, error: msg });
    return { ok: false, error: msg };
  }
}

const same = (a, b) => stable(a == null ? null : a) === stable(b == null ? null : b);
/** Aplica en este navegador lo guardado en tu cuenta */
export async function applyProfile(p) {
  if (!p) return;
  const loc = await chrome.storage.local.get(LOCAL_KEYS);
  const set = {}, rm = [];
  for (const [k, f] of [['tcr_settings', 'settings'], ['tcr_overlay', 'overlay'], ['tcr_fsw', 'fsw']]) {
    if (same(loc[k], p[f])) continue;
    if (p[f] == null) rm.push(k); else set[k] = p[f];
  }
  if (Object.keys(set).length) await chrome.storage.local.set(set);
  if (rm.length) await chrome.storage.local.remove(rm);
  for (const [vid, r] of Object.entries(p.links || {})) {
    const old = await DB.get('links', vid).catch(() => null);
    let nl;
    if (old) {
      // lo de tu cuenta manda (así dos ordenadores no se pisan una y otra vez)
      nl = { ...old, sync: r.s || old.sync, marks: r.m || [], srcs: r.r || old.srcs, ytTitle: r.t || old.ytTitle, linkedAt: r.k != null ? r.k : old.linkedAt, detached: !!r.d };
    } else {
      // vídeo que solo conoce tu cuenta: guarda su sincronización y de dónde sale el chat (se descarga de Drive al abrirlo)
      nl = { vid, ytTitle: r.t || '', sync: r.s || { mode: 'auto', delta: 0, cuts: [] }, marks: r.m, srcs: r.r, linkedAt: r.k != null ? r.k : Date.now(), fromAccount: true, detached: r.d ? true : undefined };
    }
    if (!same(old, nl)) await DB.put('links', vid, nl).catch(() => {});
  }
}
export async function pull() {
  const a = await getAccount();
  if (!a) return false;
  const p = await readProfile(a.slug);
  if (p) { await applyProfile(p); await setStatus({ ok: true, pulled: true }); }
  return !!p;
}

async function isCustomized() {
  const s = (await chrome.storage.local.get('tcr_settings')).tcr_settings;
  if (!s) return false;
  return Object.keys(s).some(k => k !== 'v' && !same(s[k], DEFAULTS[k]));
}
/** Pone la configuración de ByAlvaro en este navegador */
export async function applyByAlvaro() {
  if (!BYALVARO.settings) return false;
  const set = { tcr_settings: { ...DEFAULTS, ...BYALVARO.settings, v: DEFAULTS.v } };
  if (BYALVARO.overlay) set.tcr_overlay = BYALVARO.overlay;
  if (BYALVARO.fsw) set.tcr_fsw = BYALVARO.fsw;
  await chrome.storage.local.set(set);
  if (!BYALVARO.overlay) await chrome.storage.local.remove('tcr_overlay');
  return true;
}

/* ---------- Contraseña de la cuenta ----------
 * Se guarda en tu cuenta de Google de Chrome solo como huella (PBKDF2-SHA256 con sal): la contraseña en sí no se guarda en ningún sitio.
 */
const pwKey = slug => `tcr_pw_${slug}`;
const MIN_PW = 4;
const b64 = u8 => btoa(String.fromCharCode(...u8));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function hashPw(pass, salt, it) {
  const key = await crypto.subtle.importKey('raw', enc.encode(String(pass)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: it }, key, 256);
  return b64(new Uint8Array(bits));
}
async function getPw(slug) { try { return (await chrome.storage.sync.get(pwKey(slug)))[pwKey(slug)] || null; } catch { return null; } }
async function setPw(slug, pass) {
  if (String(pass || '').length < MIN_PW) throw new Error(`La contraseña tiene que tener al menos ${MIN_PW} caracteres.`);
  const salt = crypto.getRandomValues(new Uint8Array(16)), it = 150000;
  await chrome.storage.sync.set({ [pwKey(slug)]: { v: 1, salt: b64(salt), it, hash: await hashPw(pass, salt, it), at: Date.now() } });
}
async function checkPw(rec, pass) {
  if (!rec) return false;
  const h = await hashPw(pass || '', unb64(rec.salt), rec.it || 150000);
  let d = h.length ^ rec.hash.length; for (let i = 0; i < Math.min(h.length, rec.hash.length); i++) d |= h.charCodeAt(i) ^ rec.hash.charCodeAt(i);
  return d === 0;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
/* ---------- Cuentas gestionadas desde GitHub (cuentas.json) ----------
 * En el repositorio de las actualizaciones (Ajustes → Acerca de) puede haber un cuentas.json:
 *   { "cuentas": { "pepe": { "salt": "…", "it": 150000, "hash": "…" }, "ana": { "bloqueada": true } } }
 * Si una cuenta sale ahí, manda su contraseña (el administrador la cambia editando el archivo).
 * Solo se guarda la huella (nunca la contraseña): se genera en Ajustes → Tu cuenta → «Línea para cuentas.json».
 */
export const REMOTE_KEY = 'tcr_remote_accounts';
const repoOfS = s => { const r = String(s || '').trim().replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\.git$/i, '').replace(/\/(releases|tree|blob).*$/i, '').replace(/\/+$/, ''); return /^[\w.-]+\/[\w.-]+$/.test(r) ? r : ''; };
export async function remoteAccounts(force) {
  const S = await loadSettings();
  const repo = repoOfS(S.updRepo);
  let c = null; try { c = (await chrome.storage.local.get(REMOTE_KEY))[REMOTE_KEY] || null; } catch {}
  if (!repo) return { ok: false, error: 'Sin repositorio', map: {} };
  if (!force && c && c.repo === repo && Date.now() - c.at < 10 * 60e3) return c;
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${repo}/HEAD/cuentas.json?t=${Date.now()}`, { cache: 'no-store' });
    if (r.status === 404) { c = { ok: true, none: true, repo, at: Date.now(), map: {} }; }
    else if (!r.ok) throw new Error('GitHub ' + r.status);
    else {
      const j = await r.json();
      const src = (j && (j.cuentas || j.accounts)) || {};
      const map = {};
      for (const [name, v] of Object.entries(src)) { const sl = slugOf(name); if (sl && v && typeof v === 'object') map[sl] = v; }
      c = { ok: true, repo, at: Date.now(), map };
    }
  } catch (e) { c = c && c.repo === repo ? { ...c, stale: true, error: e.message } : { ok: false, repo, at: Date.now(), error: e.message, map: {} }; }
  try { await chrome.storage.local.set({ [REMOTE_KEY]: c }); } catch {}
  return c;
}
/** Línea para pegar en cuentas.json (el administrador) */
export async function makeEntry(name, pass) {
  const slug = slugOf(name);
  if (!slug) throw new Error('Escribe un nombre.');
  if (String(pass || '').length < MIN_PW) throw new Error(`La contraseña tiene que tener al menos ${MIN_PW} caracteres.`);
  const salt = crypto.getRandomValues(new Uint8Array(16)), it = 150000;
  return { slug, entry: { salt: b64(salt), it, hash: await hashPw(pass, salt, it) } };
}

const KNOWN = 'tcr_known_accounts';
async function remember(name, slug) {
  try { const l = ((await chrome.storage.local.get(KNOWN))[KNOWN] || []).filter(x => x.slug !== slug); l.unshift({ name, slug, at: Date.now() }); await chrome.storage.local.set({ [KNOWN]: l.slice(0, 12) }); } catch {}
}
export async function known() { try { return (await chrome.storage.local.get(KNOWN))[KNOWN] || []; } catch { return []; } }
export async function forgetKnown(slug) { try { const l = ((await chrome.storage.local.get(KNOWN))[KNOWN] || []).filter(x => x.slug !== slug); await chrome.storage.local.set({ [KNOWN]: l }); } catch {} }

/** Antes de iniciar sesión: ¿existe esa cuenta? ¿tiene contraseña? ¿la gestiona GitHub? */
export async function check(name) {
  const slug = slugOf(name);
  if (!slug) return { slug: '', exists: false, hasPass: false };
  const [meta, pw, rem] = await Promise.all([chrome.storage.sync.get(mk(slug)).then(o => o[mk(slug)] || null).catch(() => null), getPw(slug), remoteAccounts(false)]);
  const r = rem.map[slug];
  return { slug, exists: !!(meta && meta.n) || !!pw || !!(r && r.hash), hasPass: !!pw || !!(r && r.hash), github: !!(r && r.hash), blocked: !!(r && r.bloqueada) };
}
/** Cambia (o pone por primera vez) la contraseña de la cuenta con la sesión iniciada */
export async function changePassword(oldPass, newPass) {
  const a = await getAccount();
  if (!a) throw new Error('Inicia sesión primero.');
  const rem = await remoteAccounts(true);
  if (rem.map[a.slug] && rem.map[a.slug].hash) throw new Error('La contraseña de esta cuenta la gestiona el administrador en GitHub (cuentas.json): pídele que la cambie.');
  const rec = await getPw(a.slug);
  if (rec && !(await checkPw(rec, oldPass))) { await wait(700); throw new Error('La contraseña actual no es correcta.'); }
  await setPw(a.slug, newPass);
  const cur = await getPw(a.slug);
  await chrome.storage.local.set({ [AKEY]: { ...a, pwh: cur && cur.hash } });
  return { ok: true, created: !rec };
}

/**
 * mode: 'login' (la cuenta tiene que existir) · 'create' (el nombre tiene que estar libre) · 'auto' (como antes)
 */
export async function login(name, pass, mode = 'auto') {
  const clean = String(name || '').trim().slice(0, 40);
  const slug = slugOf(clean);
  if (!slug) throw new Error('Escribe un nombre (letras o números).');
  const rem = await remoteAccounts(true);
  const r = rem.map[slug];
  if (r && r.bloqueada) throw new Error('Esta cuenta está bloqueada por el administrador.');
  const [rec, metaO] = await Promise.all([getPw(slug), chrome.storage.sync.get(mk(slug)).catch(() => ({}))]);
  const hasProfile = !!(metaO && metaO[mk(slug)] && metaO[mk(slug)].n);
  let created = false, viaGithub = false;
  if (r && r.hash) {
    // la contraseña la manda el archivo de GitHub
    if (!pass) throw new Error('Escribe la contraseña de esta cuenta.');
    if (!(await checkPw(r, pass))) { await wait(700); throw new Error('Contraseña incorrecta.'); }
    await chrome.storage.sync.set({ [pwKey(slug)]: { v: 1, salt: r.salt, it: r.it || 150000, hash: r.hash, at: Date.now(), github: true } });
    viaGithub = true;
    if (mode === 'create' && (rec || hasProfile)) throw new Error('Ese nombre ya tiene cuenta: usa «Iniciar sesión».');
  } else if (mode === 'create') {
    if (rec || hasProfile) throw new Error('Ese nombre ya tiene cuenta: usa «Iniciar sesión» (o elige otro nombre).');
    if (String(pass || '').length < MIN_PW) throw new Error(`Elige una contraseña de al menos ${MIN_PW} caracteres.`);
    await setPw(slug, pass); created = true;
  } else if (rec) {
    if (!pass) throw new Error('Escribe la contraseña de esta cuenta.');
    if (!(await checkPw(rec, pass))) { await wait(700); throw new Error('Contraseña incorrecta.'); }
  } else if (hasProfile || mode === 'auto') {
    // cuenta de una versión anterior sin contraseña: se le pone ahora la que escribas
    if (String(pass || '').length < MIN_PW) throw new Error(`Esta cuenta aún no tiene contraseña: elige una (al menos ${MIN_PW} caracteres).`);
    await setPw(slug, pass); created = true;
  } else {
    throw new Error('No hay ninguna cuenta con ese nombre. Créala en «Crear cuenta».');
  }
  const prev = await getAccount();
  if (prev && prev.slug !== slug) await push(false).catch(() => {});      // guarda la cuenta anterior antes de cambiar
  const prof = await readProfile(slug);
  let preset = false;
  if (prof) await applyProfile(prof);
  else if (isByAlvaro(slug) && !(await isCustomized())) preset = await applyByAlvaro();
  const pw = await getPw(slug);
  await chrome.storage.local.set({ [AKEY]: { name: clean, slug, at: Date.now(), pwh: pw && pw.hash } });
  await dropSyncedSession();
  await remember(clean, slug);
  const res = await push(!prof);
  return { slug, name: clean, existed: !!prof, preset, created, github: viaGithub, ...res };
}
/** Si el administrador cambia la contraseña o bloquea la cuenta en GitHub, la sesión abierta se cierra */
export async function verifySession() {
  const a = await getAccount();
  if (!a) return { ok: true };
  const rem = await remoteAccounts(false);
  if (!rem.ok || rem.stale) return { ok: true };
  const r = rem.map[a.slug];
  if (r && (r.bloqueada || (r.hash && a.pwh && r.hash !== a.pwh))) { await logout(); return { ok: false, loggedOut: true, reason: r.bloqueada ? 'blocked' : 'password' }; }
  return { ok: true };
}
export async function logout() { await chrome.storage.local.remove(AKEY); await dropSyncedSession(); await setStatus({ ok: true, loggedOut: true }); }
export async function status() {
  const a = await getAccount();
  const st = (await chrome.storage.local.get(STATUS_KEY))[STATUS_KEY] || null;
  let meta = null;
  if (a) { try { meta = (await chrome.storage.sync.get(mk(a.slug)))[mk(a.slug)] || null; } catch {} }
  const hasPass = a ? !!(await getPw(a.slug)) : false;
  const rem = await remoteAccounts(false).catch(() => ({ map: {} }));
  const github = !!(a && rem.map && rem.map[a.slug] && rem.map[a.slug].hash);
  const knownList = await known();
  return { account: a, status: st, meta, hasPass, github, known: knownList, remote: { ok: rem.ok, none: !!rem.none, n: Object.keys(rem.map || {}).length, error: rem.error || null, repo: rem.repo || '' }, byalvaro: !!(a && isByAlvaro(a.slug)), preset: hasPreset() };
}
