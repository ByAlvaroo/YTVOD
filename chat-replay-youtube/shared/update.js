// Actualizaciones desde GitHub: mira el version.json (o la última «Release») de tu repositorio y avisa en YouTube si hay una versión nueva.
// Chrome no deja que una extensión «descomprimida» cambie sus propios archivos: se descarga el zip, se descomprime
// encima de la carpeta y el botón «Recargar» reinicia la extensión (el identificador es fijo: no se pierde nada).
import { loadSettings } from './settings.js';

export const UKEY = 'tcr_update';
const EVERY = 3 * 3600e3;                 // como mucho una consulta a GitHub cada 3 h (salvo «Buscar ahora»)

export const current = () => chrome.runtime.getManifest().version;
/** 1.10.0 > 1.9.3 */
export function cmpVer(a, b) {
  const x = String(a || '').split(/[^\d]+/).filter(Boolean).map(Number), y = String(b || '').split(/[^\d]+/).filter(Boolean).map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}
/** «https://github.com/ByAlvaroo/chat-replay/» → «ByAlvaroo/chat-replay» */
export function repoOf(s) {
  const r = String(s || '').trim().replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\.git$/i, '').replace(/\/(releases|tree|blob).*$/i, '').replace(/\/+$/, '');
  return /^[\w.-]+\/[\w.-]+$/.test(r) ? r : '';
}
const getSt = async () => { try { return (await chrome.storage.local.get(UKEY))[UKEY] || {}; } catch { return {}; } };
const setSt = st => chrome.storage.local.set({ [UKEY]: st });

function view(st, S) {
  const cur = current(), info = st.info || null;
  const newer = !!(info && info.version && cmpVer(info.version, cur) > 0);
  return {
    ok: !st.error, error: st.error || null, repo: st.repo || '', at: st.at || 0, current: cur,
    latest: info ? info.version : null, info, newer,
    skipped: !!(info && st.skip === info.version), snooze: st.snooze || 0,
    // pulsaste «Recargar» pero sigue la versión vieja: no se reemplazaron los archivos
    stale: !!(st.expect && cmpVer(cur, st.expect) < 0),
    updated: st.updated || null, auto: S ? S.updCheck !== false : true, mode: (S && S.updMode) || 'ask'
  };
}

export async function status() { return view(await getSt(), await loadSettings()); }

export async function check(force) {
  const S = await loadSettings();
  const repo = repoOf(S.updRepo);
  const st = await getSt();
  if (!repo) { const n = { ...st, repo: '', error: 'Escribe el repositorio de GitHub (usuario/repositorio).', info: null }; await setSt(n); return view(n, S); }
  if (!force && st.repo === repo && Date.now() - (st.at || 0) < EVERY) return view(st, S);
  let info = null, error = null;
  try {
    // 1) version.json en el repositorio (lo más cómodo: subir los archivos con «Commit + Push» y listo)
    const v = await fetch(`https://raw.githubusercontent.com/${repo}/HEAD/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (v.ok) {
      const j = await v.json();
      const zip = String(j.zip || 'chat-replay-youtube.zip').replace(/^\/+/, '');
      info = {
        version: String(j.version || '').replace(/^[^\d]*/, ''),
        title: j.title || '',
        notes: String(j.notes || '').replace(/\r/g, '').trim().slice(0, 1500),
        url: /^https?:/.test(zip) ? zip : `https://github.com/${repo}/raw/HEAD/${zip.split('/').map(encodeURIComponent).join('/')}`,
        raw: /^https?:/.test(zip) ? zip : `https://raw.githubusercontent.com/${repo}/HEAD/${zip.split('/').map(encodeURIComponent).join('/')}`,
        summary: String(j.resumen || j.summary || '').trim().slice(0, 300),
        file: zip.split('/').pop(),
        page: `https://github.com/${repo}`,
        published: j.date || null
      };
      if (!info.version) { error = 'El version.json del repositorio no tiene «version».'; info = null; }
    } else {
      // 2) si no hay version.json: la última «Release» de GitHub
      const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
      if (r.status === 404) error = `No encuentro ${repo}: tiene que ser público y tener un version.json (o una «Release»).`;
      else if (r.status === 403 || r.status === 429) error = 'GitHub limita las consultas: prueba dentro de un rato.';
      else if (!r.ok) error = `GitHub respondió ${r.status}.`;
      else {
        const j = await r.json();
        const assets = (j.assets || []).filter(a => /\.zip$/i.test(a.name));
        const asset = assets.find(a => /chat-?replay/i.test(a.name)) || assets[0];
        info = {
          version: String(j.tag_name || j.name || '').replace(/^[^\d]*/, ''),
          title: j.name || j.tag_name || '',
          notes: String(j.body || '').replace(/\r/g, '').trim().slice(0, 1500),
          url: asset ? asset.browser_download_url : null,
          raw: asset ? asset.browser_download_url : null,
          summary: String(j.body || '').split('\n').map(x => x.replace(/^[-*#\s]+/, '').trim()).find(Boolean) || '',
          file: asset ? asset.name : null,
          page: j.html_url || `https://github.com/${repo}/releases/latest`,
          published: j.published_at || null
        };
        if (!info.version) { error = 'La última versión de GitHub no tiene número (pon la etiqueta así: v1.6.0).'; info = null; }
      }
    }
  } catch { error = 'No hay conexión con GitHub.'; }
  const n = { ...st, repo, at: Date.now(), info: info || (st.repo === repo ? st.info || null : null), error };
  await setSt(n);
  return view(n, S);
}

/** «Más tarde» (24 h) u «Omitir esta versión» */
export async function snooze(hours = 24) { const st = await getSt(); st.snooze = Date.now() + hours * 3600e3; await setSt(st); return { ok: true }; }
export async function skip(version) { const st = await getSt(); st.skip = version; await setSt(st); return { ok: true }; }
export async function dismissUpdated() { const st = await getSt(); delete st.updated; await setSt(st); return { ok: true }; }

/** Ya descomprimido: reinicia la extensión para que lea los archivos nuevos */
export async function reloadNow() {
  const st = await getSt();
  if (st.info && st.info.version && cmpVer(st.info.version, current()) > 0) st.expect = st.info.version;
  await setSt(st);
  setTimeout(() => chrome.runtime.reload(), 200);
  return { ok: true };
}

/** Al arrancar tras una recarga: si ha cambiado la versión, se avisa una vez «✓ Actualizada» */
export async function onInstalled(details) {
  if (!details || details.reason !== 'update') return;
  const st = await getSt();
  const cur = current();
  if (details.previousVersion && cmpVer(cur, details.previousVersion) > 0) st.updated = { from: details.previousVersion, to: cur, at: Date.now(), summary: st.info && st.info.version === cur ? st.info.summary || '' : '' };
  if (st.expect && cmpVer(cur, st.expect) >= 0) delete st.expect;
  delete st.snooze;
  await setSt(st);
}
