// Google Drive: listar carpetas públicas y leer archivos directamente en el navegador (no se guardan en tu PC)
const CACHE_KEY = 'tcr_drive';

export function parseLink(raw) {
  raw = (raw || '').trim();
  if (!raw) throw new Error('Pega un enlace.');
  let u;
  try { u = new URL(raw); } catch { if (/^[\w-]{20,}$/.test(raw)) return { type: 'drive', id: raw, url: raw }; throw new Error('El enlace no es válido.'); }
  const host = u.hostname;
  if (/(^|\.)google\.com$/.test(host)) {
    const f = u.pathname.match(/\/folders\/([\w-]{10,})/);
    if (f) return { type: 'folder', id: f[1], url: u.href };
    const m = u.pathname.match(/\/d\/([\w-]{10,})/);
    const id = (m && m[1]) || u.searchParams.get('id');
    if (!id) throw new Error('No encuentro el ID del archivo en el enlace de Drive.');
    return { type: 'drive', id, url: u.href };
  }
  if (/dropbox\.com$/.test(host)) { u.searchParams.set('dl', '1'); return { type: 'url', url: u.href }; }
  return { type: 'url', url: u.href };
}
export function folderIdOf(url) { try { const p = parseLink(url); return p.type === 'folder' ? p.id : null; } catch { return null; } }

const decodeHtml = t => (t || '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|#39|nbsp);/gi, (m, e) => {
  e = e.toLowerCase();
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1));
  return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[e] || m;
});
/** Lee la vista embebida de una carpeta pública (sin DOMParser: funciona también en segundo plano) */
async function fetchFolderPage(id, signal) {
  const r = await fetch(`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(id)}`, { credentials: 'omit', signal });
  if (!r.ok) throw new Error(`Drive respondió ${r.status} al abrir la carpeta. ¿Está compartida como "Cualquier persona con el enlace"?`);
  const html = await r.text();
  const title = decodeHtml(((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '').trim());
  const entries = html.split(/class="flip-entry"/).slice(1).map(chunk => {
    const href = decodeHtml((chunk.match(/<a [^>]*href="([^"]+)"/) || [])[1] || '');
    const fid = (chunk.match(/^[^>]*id="entry-([\w-]+)"/) || chunk.match(/id="entry-([\w-]+)"/) || [])[1] || ((href.match(/\/(?:d|folders)\/([\w-]+)/) || [])[1]);
    return {
      id: fid,
      name: decodeHtml(((chunk.match(/class="flip-entry-title"[^>]*>([^<]*)</) || [])[1] || '').trim()),
      isFolder: /\/folders\//.test(href),
      modified: decodeHtml(((chunk.match(/class="flip-entry-last-modified"[^>]*>\s*<div>([^<]*)</) || [])[1] || '').trim())
    };
  }).filter(e => e.id);
  if (!entries.length && !/flip-entries|folder-view/.test(html)) throw new Error('No puedo leer la carpeta. Compártela como "Cualquier persona con el enlace" (Lector).');
  return { title, entries };
}

/* ---------- Modo app (web): la web no puede leer drive.google.com directamente (Google lo bloquea),
 * así que usa la API de Google Drive con la clave de la app. En la extensión no se usa nada de esto. ---------- */
const WEB = !!globalThis.__TCR_WEB;
const API = 'https://www.googleapis.com/drive/v3/files';
function apiKey() {
  let k = '';
  try { k = localStorage.getItem('tcr_api_key') || ''; } catch {}
  if (!k) throw new Error('Falta la clave de Google (API key) de la app. Ponla en config.js o en el menú de la app → Clave de Google.');
  return k;
}
async function apiJson(url, signal) {
  const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(apiKey()), { signal, credentials: 'omit' });
  if (!r.ok) {
    let msg = ''; try { msg = ((await r.json()).error || {}).message || ''; } catch {}
    if (r.status === 404) throw new Error('Drive no encuentra la carpeta o el archivo. ¿Está compartido como «Cualquier persona con el enlace»?');
    if (r.status === 403 || r.status === 400) throw new Error('Google rechazó la clave de la app (' + r.status + '). Revisa que la API de Google Drive esté activada y que la clave permita esta web. ' + msg);
    throw new Error('Google Drive respondió ' + r.status + '. ' + msg);
  }
  return r.json();
}
async function webListFolder(folderId, { depth = 4, signal, onFolder } = {}) {
  const files = [];
  const seen = new Set();
  async function walk(id, path, d) {
    if (seen.has(id) || d < 0) return;
    seen.add(id);
    let title = path[path.length - 1];
    if (!path.length) { try { title = (await apiJson(`${API}/${encodeURIComponent(id)}?fields=name&supportsAllDrives=true`, signal)).name; } catch (e) { if (/clave|rechaz/.test(e.message)) throw e; title = 'Drive'; } }
    const here = path.length ? path : [title || 'Drive'];
    onFolder && onFolder(here.join(' / '));
    const subs = [];
    let page = '';
    do {
      const q = encodeURIComponent(`'${id}' in parents and trashed = false`);
      const j = await apiJson(`${API}?q=${q}&fields=nextPageToken,files(id,name,mimeType,modifiedTime)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true${page ? '&pageToken=' + encodeURIComponent(page) : ''}`, signal);
      for (const e of j.files || []) {
        if (e.mimeType === 'application/vnd.google-apps.folder') subs.push(e);
        else if (/\.(json|gz)$/i.test(e.name)) files.push({ id: e.id, name: e.name, folder: here.slice(1).join(' / ') || '', modified: e.modifiedTime ? new Date(e.modifiedTime).toLocaleDateString('es-ES') : '' });
      }
      page = j.nextPageToken || '';
    } while (page);
    await Promise.all(subs.map(s => walk(s.id, [...here, s.name], d - 1)));
  }
  await walk(folderId, [], depth);
  files.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  return files;
}

/** Lista recursivamente los .json / .json.gz de una carpeta pública */
export async function listFolder(folderId, { depth = 4, signal, onFolder } = {}) {
  if (WEB) return webListFolder(folderId, { depth, signal, onFolder });
  const files = [];
  const seen = new Set();
  async function walk(id, path, d) {
    if (seen.has(id) || d < 0) return;
    seen.add(id);
    const { title, entries } = await fetchFolderPage(id, signal);
    const here = path.length ? path : [title || 'Drive'];
    onFolder && onFolder(here.join(' / '));
    const subs = [];
    for (const e of entries) {
      if (e.isFolder) subs.push(e);
      else if (/\.(json|gz)$/i.test(e.name)) files.push({ id: e.id, name: e.name, folder: here.slice(1).join(' / ') || '', modified: e.modified });
    }
    await Promise.all(subs.map(s => walk(s.id, [...here, s.name], d - 1)));
  }
  await walk(folderId, [], depth);
  files.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  return files;
}

export async function getDriveCache() {
  try { const o = await chrome.storage.local.get(CACHE_KEY); return o[CACHE_KEY] || null; } catch { return null; }
}
export async function setDriveCache(folderId, files) {
  const v = { folderId, at: Date.now(), files };
  try { await chrome.storage.local.set({ [CACHE_KEY]: v }); } catch {}
  return v;
}
/** Devuelve la lista (de caché si es reciente) */
export async function getFolderFiles(folderUrl, { maxAgeMs = 10 * 60 * 1000, force = false, signal, onFolder } = {}) {
  const id = folderIdOf(folderUrl);
  if (!id) throw new Error('El enlace de la carpeta de Drive no es válido.');
  const c = await getDriveCache();
  if (!force && c && c.folderId === id && Date.now() - c.at < maxAgeMs) return c;
  const files = await listFolder(id, { signal, onFolder });
  return setDriveCache(id, files);
}

const isHtml = r => (r.headers.get('content-type') || '').includes('text/html');

async function readBody(r, onProgress, signal) {
  const total = +r.headers.get('content-length') || 0;
  if (!r.body) return new Uint8Array(await r.arrayBuffer()).buffer;
  const reader = r.body.getReader();
  const chunks = []; let got = 0, lastP = 0;
  for (;;) {
    if (signal && signal.aborted) { reader.cancel().catch(() => {}); throw new DOMException('Cancelado', 'AbortError'); }
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    const now = performance.now();
    if (onProgress && now - lastP > 120) { lastP = now; onProgress(got, total); }
  }
  onProgress && onProgress(got, total);
  const out = new Uint8Array(got); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out.buffer;
}

function confirmUrlFromHtml(html) {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const form = doc.querySelector('form#download-form, form[action*="download"]');
    if (form) {
      const u = new URL(form.getAttribute('action'), 'https://drive.usercontent.google.com/');
      form.querySelectorAll('input[type=hidden]').forEach(i => u.searchParams.set(i.name, i.value));
      return u.href;
    }
    const a = doc.querySelector('a[href*="confirm="]');
    if (a) return new URL(a.getAttribute('href'), 'https://drive.google.com/').href;
  } catch {}
  return null;
}

/** Descarga un archivo de Drive a memoria (no a tu PC) */
export async function downloadDrive(id, onProgress, signal) {
  if (WEB) {
    const r = await fetch(`${API}/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true&acknowledgeAbuse=true&key=${encodeURIComponent(apiKey())}`, { signal, credentials: 'omit' });
    if (r.status === 404) throw new Error('Drive no encuentra el archivo (404). Revisa el enlace.');
    if (r.status === 403 && /acknowledgeAbuse|cannotDownloadAbusiveFile/.test(await r.clone().text().catch(() => ''))) {
      const r2 = await fetch(`${API}/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true&key=${encodeURIComponent(apiKey())}`, { signal, credentials: 'omit' });
      if (r2.ok) return readBody(r2, onProgress, signal);
    }
    if (!r.ok) throw new Error('Google Drive no ha entregado el archivo (' + r.status + '). Compártelo como «Cualquier persona con el enlace» y revisa la clave de la app.');
    return readBody(r, onProgress, signal);
  }
  const base = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;
  const tries = [{ url: base, cred: 'omit' }, { url: base, cred: 'include' }];
  for (const t of tries) {
    let r = await fetch(t.url, { credentials: t.cred, signal });
    if (r.ok && isHtml(r)) {
      const next = confirmUrlFromHtml(await r.text());
      if (!next) continue;
      r = await fetch(next, { credentials: t.cred, signal });
    }
    if (r.ok && !isHtml(r)) return readBody(r, onProgress, signal);
    if (r.status === 404) throw new Error('Drive no encuentra el archivo (404). Revisa el enlace.');
  }
  throw new Error('Drive no ha entregado el archivo. Compártelo (o su carpeta) como "Cualquier persona con el enlace".');
}
export async function downloadUrl(url, onProgress, signal) {
  const r = await fetch(url, { credentials: 'omit', signal });
  if (!r.ok) throw new Error(`El servidor respondió ${r.status}.`);
  return readBody(r, onProgress, signal);
}
