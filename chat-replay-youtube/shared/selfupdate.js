// Actualización automática: con tu permiso sobre la carpeta de la extensión (se da una vez),
// se baja el zip nuevo de GitHub, se descomprime en memoria y se reemplazan los archivos. No se descarga nada a tu PC.
import { unzip, stripRoot } from './unzip.js';
import { cmpVer } from './update.js';

const DBN = 'tcr-fs', ST = 'h', KEY = 'extDir';
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DBN, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(ST);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction(ST, mode), s = t.objectStore(ST);
    const q = fn(s);
    t.oncomplete = () => { db.close(); res(q && q.result); };
    t.onerror = () => { db.close(); rej(t.error); };
  });
}
/** Carpeta guardada (FileSystemDirectoryHandle) o null */
export const getDir = () => tx('readonly', s => s.get(KEY)).catch(() => null);
export const setDir = h => tx('readwrite', s => s.put(h, KEY));
export const forgetDir = () => tx('readwrite', s => s.delete(KEY));

/** ¿Hay permiso para escribir? Con ask = true lo pide (hace falta que venga de un clic) */
export async function permOf(h, ask) {
  if (!h) return false;
  const o = { mode: 'readwrite' };
  try {
    if ((await h.queryPermission(o)) === 'granted') return true;
    return ask ? (await h.requestPermission(o)) === 'granted' : false;
  } catch { return false; }
}

const me = () => chrome.runtime.getManifest();
const sameExt = m => m && m.name === me().name && (!me().key || m.key === me().key);

/** Comprueba que la carpeta elegida es la de ESTA extensión (la que tiene su manifest.json) */
export async function checkDir(h) {
  let m;
  try { m = JSON.parse(await (await (await h.getFileHandle('manifest.json')).getFile()).text()); }
  catch { throw new Error('En esa carpeta no está el manifest.json de la extensión. Elige la carpeta que cargaste en chrome://extensions (la que tiene manifest.json dentro, normalmente «chat-replay-youtube»).'); }
  if (!sameExt(m)) throw new Error('Esa carpeta es de otra extensión. Elige la de Chat Replay.');
  if (cmpVer(m.version, me().version) < 0) throw new Error(`Esa carpeta tiene la versión ${m.version}, más vieja que la que está funcionando (${me().version}): es otra copia. Elige la carpeta que cargaste en chrome://extensions.`);
  return m;
}

/** Baja y descomprime la versión nueva (en memoria) y comprueba que es de esta extensión */
export async function download(info) {
  const url = info.raw || info.url;
  let r;
  try { r = await fetch(url, { cache: 'no-store' }); } catch { throw new Error('No se ha podido descargar el zip de GitHub.'); }
  if (!r.ok) throw new Error(`GitHub respondió ${r.status} al descargar el zip.`);
  const files = stripRoot(await unzip(await r.arrayBuffer()));
  const mf = files.find(f => f.path === 'manifest.json');
  if (!mf) throw new Error('El zip no tiene manifest.json.');
  const m = JSON.parse(new TextDecoder().decode(mf.data));
  if (!sameExt(m)) throw new Error('El zip de GitHub no es de esta extensión: no se instala.');
  if (cmpVer(m.version, me().version) <= 0) throw new Error(`El zip de GitHub tiene la versión ${m.version} y ya tienes la ${me().version}. Revisa que subiste el zip nuevo.`);
  return { files, manifest: m };
}

/** Reemplaza los archivos en la carpeta (el manifest.json el último, para que nunca quede a medias) */
export async function writeAll(dir, files, onProgress) {
  const ok = files.filter(f => f.path && !f.path.split('/').some(s => s === '..' || s === '' || s === '.'));
  const order = ok.filter(f => f.path !== 'manifest.json').concat(ok.filter(f => f.path === 'manifest.json'));
  let n = 0;
  for (const f of order) {
    const segs = f.path.split('/');
    let d = dir;
    for (const s of segs.slice(0, -1)) d = await d.getDirectoryHandle(s, { create: true });
    const fh = await d.getFileHandle(segs[segs.length - 1], { create: true });
    const w = await fh.createWritable();
    await w.write(f.data);
    await w.close();
    onProgress && onProgress(++n, order.length, f.path);
  }
  return n;
}
