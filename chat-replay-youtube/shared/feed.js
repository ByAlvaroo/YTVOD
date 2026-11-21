// Configuración de ByAlvaro para todos:
// · ByAlvaro (con su token de GitHub) publica sus ajustes y la sincronización de cada vídeo en un archivo público.
// · Los demás la siguen: lo que no han tocado se actualiza solo; lo que han cambiado ellos se respeta.
import * as DB from './db.js';
import { DEFAULTS } from './settings.js';
import { stable, getAccount, isByAlvaro, LOCAL_KEYS } from './account.js';

// Dónde publica ByAlvaro (los demás lo leen de aquí)
export const FEED = { owner: 'ByAlvaroo', repo: 'chat-replay-config', branch: 'main', path: 'chat-replay/byalvaro-youtube.json' };

export const FOLLOW_KEY = 'tcr_follow';   // { on, base, at, rev, checkedAt, error }   (local)
export const PUB_KEY = 'tcr_pub';         // { owner, repo, branch, path, token, last, sha, at, rev, error } (local, solo ByAlvaro)
// ajustes que son de cada persona y nunca se copian
export const PERSONAL = ['myName', 'v'];

const same = (a, b) => stable(a == null ? null : a) === stable(b == null ? null : b);
const hasSync = l => { const s = (l && l.sync) || {}; return !!((s.delta || 0) || (s.cuts && s.cuts.length) || (s.gaps && s.gaps.some(Boolean)) || (s.parts && s.parts.some(p => p && Object.keys(p).length)) || (s.mode && s.mode !== 'auto') || (l && l.marks && l.marks.length)); };
const okSrcs = s => Array.isArray(s) && s.length && s.every(x => x && (x.type === 'drive' || x.type === 'url')) ? s.map(x => x.type === 'drive' ? { type: 'drive', id: x.id, name: x.name } : { type: 'url', url: x.url }) : undefined;
const vsOf = l => ({ s: (l && l.sync) || null, m: (l && l.marks && l.marks.length) ? l.marks : null });
const vsPub = r => ({ s: (r && r.s) || null, m: (r && r.m && r.m.length) ? r.m : null });

async function getL(k, d) { try { return (await chrome.storage.local.get(k))[k] || d; } catch { return d; } }
const setL = (k, v) => chrome.storage.local.set({ [k]: v });

/* ---------- Leer la configuración publicada ---------- */
export async function feedSource() {
  const p = await getL(PUB_KEY, {});
  const src = { ...FEED };
  // en el navegador de ByAlvaro se usa el repositorio que haya puesto (por si aún no está dentro de la extensión)
  if (!src.owner && p.owner) Object.assign(src, { owner: p.owner, repo: p.repo, branch: p.branch || 'main', path: p.path || FEED.path });
  return src.owner && src.repo ? src : null;
}
export async function fetchFeed() {
  const src = await feedSource();
  if (!src) return null;
  const url = `https://raw.githubusercontent.com/${src.owner}/${src.repo}/${src.branch}/${src.path}?t=${Date.now()}`;
  const r = await fetch(url, { cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('No se pudo leer la configuración de ByAlvaro (' + r.status + ')');
  const j = await r.json();
  if (!j || j.v !== 1 || !j.settings) throw new Error('El archivo de ByAlvaro no es válido');
  return j;
}

export async function isPublisher() {
  const a = await getAccount();
  const p = await getL(PUB_KEY, {});
  return !!(a && isByAlvaro(a.slug) && p.token && p.owner && p.repo);
}

/* ---------- Seguir: aplicar sin pisar lo que has cambiado tú ---------- */
/** Ajustes y vídeos que has cambiado respecto a lo último de ByAlvaro */
export async function overrides(P) {
  const f = await getL(FOLLOW_KEY, {});
  const base = f.base;
  if (!base || !P) return { settings: [], videos: [] };
  const loc = await chrome.storage.local.get(LOCAL_KEYS);
  const S = { ...DEFAULTS, ...(loc.tcr_settings || {}) };
  const settings = Object.keys(P.settings).filter(k => !PERSONAL.includes(k) && k in (base.settings || {}) && !same(S[k], base.settings[k]) && !same(S[k], P.settings[k]));
  const videos = [];
  for (const vid of Object.keys(P.links || {})) {
    const b = base.links && base.links[vid];
    if (!b) continue;
    const old = await DB.get('links', vid).catch(() => null);
    if (old && !same(vsOf(old), vsPub(b)) && !same(vsOf(old), vsPub(P.links[vid]))) videos.push(vid);
  }
  return { settings, videos };
}

/**
 * Aplica la publicación P.
 * scope: 'follow' (solo lo que no has tocado) · 'settings' · 'all' · 'videos' (con vids)
 */
export async function applyFeed(P, scope = 'follow', vids = []) {
  const f = await getL(FOLLOW_KEY, { on: true });
  const base = f.base || null;
  const force = scope !== 'follow';
  const doSettings = scope === 'follow' || scope === 'settings' || scope === 'all';
  const doVideos = scope === 'follow' || scope === 'all' || scope === 'videos';
  const changed = [];

  if (doSettings) {
    const loc = await chrome.storage.local.get(LOCAL_KEYS);
    const cur = loc.tcr_settings || {};
    const S = { ...DEFAULTS, ...cur };
    const next = { ...cur };
    let n = 0;
    for (const [k, v] of Object.entries(P.settings)) {
      if (PERSONAL.includes(k)) continue;
      // sin historial: se sigue lo que esté en su valor de fábrica · con historial: lo que siga igual que la última vez
      const untouched = base && base.settings && k in base.settings ? same(S[k], base.settings[k]) : same(S[k], DEFAULTS[k]) || !(k in cur);
      if ((force || untouched) && !same(S[k], v)) { next[k] = v; n++; }
    }
    const set = {};
    if (n) set.tcr_settings = { ...next, v: DEFAULTS.v };
    for (const [k, fld] of [['tcr_overlay', 'overlay'], ['tcr_fsw', 'fsw']]) {
      if (P[fld] == null) continue;
      const untouched = base ? same(loc[k], base[fld]) : loc[k] == null;
      if ((force || untouched) && !same(loc[k], P[fld])) set[k] = P[fld];
    }
    if (Object.keys(set).length) { await chrome.storage.local.set(set); changed.push('settings'); }
  }

  if (doVideos) {
    const list = scope === 'videos' ? vids : Object.keys(P.links || {});
    for (const vid of list) {
      const r = P.links[vid];
      if (!r) continue;
      const old = await DB.get('links', vid).catch(() => null);
      let nl = null;
      if (!old) {
        // vídeo nuevo de ByAlvaro: se guarda su sincronización y de dónde sale el chat (se descarga solo al abrir el vídeo)
        nl = { vid, ytTitle: r.t || '', sync: r.s || { mode: 'auto', delta: 0, cuts: [] }, marks: r.m || [], srcs: r.r, linkedAt: r.k || Date.now(), fromByAlvaro: true };
      } else {
        const b = base && base.links && base.links[vid];
        const untouched = b ? same(vsOf(old), vsPub(b)) : !hasSync(old);
        if (force || untouched) {
          nl = { ...old, sync: r.s || old.sync, marks: r.m || [] };
          if (force && r.r) { nl.srcs = r.r; nl.detached = false; nl.noAuto = false; }
          else if (!old.srcs && r.r) nl.srcs = r.r;
        } else if (!old.srcs && r.r) nl = { ...old, srcs: r.r };
      }
      if (nl && !same(old, nl)) { await DB.put('links', vid, nl).catch(() => {}); changed.push(vid); }
    }
  }

  // la nueva «base»: lo que has tocado se queda distinto de ella y no se vuelve a pisar
  let nb = P;
  if (scope === 'videos' && base) nb = { ...base, links: { ...(base.links || {}) } }, vids.forEach(v => { if (P.links[v]) nb.links[v] = P.links[v]; });
  else if (scope === 'settings' && base) nb = { ...P, links: base.links || {} };
  await setL(FOLLOW_KEY, { ...f, on: f.on !== false, base: nb, at: P.at, rev: P.rev, checkedAt: Date.now(), error: null });
  return changed;
}

export async function check({ force = false } = {}) {
  if (await isPublisher()) return { ok: true, publisher: true };
  const f = await getL(FOLLOW_KEY, { on: true });
  if (f.on === false && !force) return { ok: true, off: true };
  try {
    const P = await fetchFeed();
    if (!P) { await setL(FOLLOW_KEY, { ...f, checkedAt: Date.now(), error: null }); return { ok: true, none: true }; }
    if (!force && f.rev === P.rev && f.at === P.at && f.base) { await setL(FOLLOW_KEY, { ...f, checkedAt: Date.now(), error: null }); return { ok: true, same: true }; }
    const changed = await applyFeed(P, 'follow');
    return { ok: true, changed, rev: P.rev };
  } catch (e) {
    await setL(FOLLOW_KEY, { ...f, checkedAt: Date.now(), error: e.message });
    return { ok: false, error: e.message };
  }
}

export async function reset(scope, vids) {
  const P = await fetchFeed();
  if (!P) throw new Error('ByAlvaro todavía no ha publicado su configuración.');
  return applyFeed(P, scope, vids || []);
}

/* ---------- Publicar (solo ByAlvaro) ---------- */
async function buildPub() {
  const loc = await chrome.storage.local.get(LOCAL_KEYS);
  const settings = { ...DEFAULTS, ...(loc.tcr_settings || {}) };
  PERSONAL.forEach(k => delete settings[k]);
  const links = {};
  for (const l of await DB.all('links').catch(() => [])) {
    if (!l || !l.vid || l.detached) continue;
    const r = okSrcs(l.srcs);
    if (!hasSync(l) && !r) continue;
    links[l.vid] = { s: l.sync || undefined, m: l.marks && l.marks.length ? l.marks : undefined, r, t: l.ytTitle || undefined, k: l.linkedAt || undefined };
  }
  return { v: 1, name: 'ByAlvaro', settings, overlay: loc.tcr_overlay || null, fsw: loc.tcr_fsw || null, links };
}
const b64 = s => { const b = new TextEncoder().encode(s); let bin = ''; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(bin); };

export async function publish(force) {
  if (!(await isPublisher())) return { ok: false, error: 'Solo ByAlvaro con su token puede publicar.' };
  const p = await getL(PUB_KEY, {});
  const body = await buildPub();
  const sig = stable(body);
  if (!force && p.last === sig) return { ok: true, same: true };
  const rev = (p.rev || 0) + 1;
  const doc = JSON.stringify({ ...body, rev, at: Date.now() }, null, 1);
  const api = `https://api.github.com/repos/${p.owner}/${p.repo}/contents/${(p.path || FEED.path).split('/').map(encodeURIComponent).join('/')}`;
  const H = { Authorization: 'Bearer ' + p.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const getSha = async () => { const r = await fetch(api + '?ref=' + encodeURIComponent(p.branch || 'main'), { headers: H, cache: 'no-store' }); if (r.status === 404) return null; if (!r.ok) throw new Error(ghErr(r.status)); return (await r.json()).sha; };
  try {
    let sha = p.sha || await getSha();
    const put = s => fetch(api, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: `Configuración de ByAlvaro · rev ${rev}`, content: b64(doc), branch: p.branch || 'main', ...(s ? { sha: s } : {}) }) });
    let r = await put(sha);
    if (r.status === 409 || r.status === 422) { sha = await getSha(); r = await put(sha); }
    if (!r.ok) throw new Error(ghErr(r.status));
    const j = await r.json();
    await setL(PUB_KEY, { ...p, last: sig, sha: j.content && j.content.sha, rev, at: Date.now(), error: null });
    return { ok: true, rev };
  } catch (e) {
    await setL(PUB_KEY, { ...p, error: e.message, errorAt: Date.now() });
    return { ok: false, error: e.message };
  }
}
function ghErr(s) {
  return s === 401 ? 'El token de GitHub no es válido o ha caducado'
    : s === 403 ? 'El token no tiene permiso para escribir en ese repositorio'
    : s === 404 ? 'No encuentro el repositorio (revisa usuario, nombre y que el token tenga acceso)'
    : 'GitHub respondió ' + s;
}
export async function savePub(cfg) {
  const p = await getL(PUB_KEY, {});
  const n = { ...p, owner: (cfg.owner || '').trim(), repo: (cfg.repo || '').trim(), branch: (cfg.branch || 'main').trim(), path: (cfg.path || FEED.path).trim() };
  if (cfg.token) n.token = cfg.token.trim();
  if (n.owner !== p.owner || n.repo !== p.repo || n.path !== p.path || n.branch !== p.branch) { n.sha = null; n.last = null; }
  await setL(PUB_KEY, n);
  return publish(true);
}
export async function pubStatus() {
  const p = await getL(PUB_KEY, {});
  return { owner: p.owner || FEED.owner, repo: p.repo || FEED.repo, branch: p.branch || FEED.branch, path: p.path || FEED.path, hasToken: !!p.token, at: p.at || 0, rev: p.rev || 0, error: p.error || null };
}
export async function followStatus() {
  const f = await getL(FOLLOW_KEY, { on: true });
  const base = f.base;
  let ov = { settings: [], videos: [] };
  try { if (base) ov = await overrides(base); } catch {}
  const vids = base ? Object.entries(base.links || {}).map(([vid, r]) => ({ vid, title: r.t || vid, cuts: (r.s && r.s.cuts && r.s.cuts.length) || 0, delta: (r.s && r.s.delta) || 0 })) : [];
  return { on: f.on !== false, at: f.at || 0, rev: f.rev || 0, checkedAt: f.checkedAt || 0, error: f.error || null, has: !!base, overrides: ov, videos: vids, source: await feedSource() };
}
export async function setFollow(on) {
  const f = await getL(FOLLOW_KEY, { on: true });
  await setL(FOLLOW_KEY, { ...f, on: !!on });
  return on ? check({ force: false }) : { ok: true };
}
