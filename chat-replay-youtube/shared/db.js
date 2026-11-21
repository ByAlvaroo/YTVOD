// IndexedDB: los chats se guardan para siempre en este navegador
// chats: datos procesados (clave = chatKey) · info: resumen ligero · links: vídeo de YouTube -> chat + sincronización
const NAME = 'tcr-chat-replay', VER = 1;
let dbp = null;

function open() {
  return dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open(NAME, VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const s of ['chats', 'info', 'links']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s);
    };
    r.onsuccess = () => { const d = r.result; d.onversionchange = () => { d.close(); dbp = null; }; res(d); };
    r.onerror = () => { dbp = null; rej(r.error); };
    r.onblocked = () => rej(new Error('La base de datos está bloqueada por otra pestaña.'));
  }));
}
// avisa al segundo plano de que ha cambiado la sincronización de algún vídeo (para guardarla en tu cuenta / publicarla)
const ping = () => { try { if (typeof window !== 'undefined') chrome.runtime.sendMessage({ t: 'tcr-links' }).catch(() => {}); } catch {} };
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = t => new Promise((res, rej) => {
  t.oncomplete = () => res();
  t.onerror = () => rej(t.error);
  t.onabort = () => rej(t.error || new Error('Transacción cancelada'));
});

export async function get(store, key) { const d = await open(); return req(d.transaction(store).objectStore(store).get(key)); }
export async function all(store) { const d = await open(); return req(d.transaction(store).objectStore(store).getAll()); }
export async function put(store, key, val) { const d = await open(); const t = d.transaction(store, 'readwrite'); t.objectStore(store).put(val, key); await done(t); if (store === 'links') ping(); }
export async function del(store, key) { const d = await open(); const t = d.transaction(store, 'readwrite'); t.objectStore(store).delete(key); await done(t); if (store === 'links') ping(); }

export async function saveChat(key, data, info, link) {
  const d = await open();
  const t = d.transaction(['chats', 'info', 'links'], 'readwrite');
  t.objectStore('chats').put(data, key);
  t.objectStore('info').put(info, key);
  if (link) t.objectStore('links').put(link, link.vid);
  await done(t); if (link) ping();
}
export async function deleteChat(key) {
  const d = await open();
  const t = d.transaction(['chats', 'info', 'links'], 'readwrite');
  t.objectStore('chats').delete(key);
  t.objectStore('info').delete(key);
  const c = t.objectStore('links').openCursor();
  // el vínculo NO se borra: se guarda la sincronización (desfase, cortes, partes, marcadores) para cuando se vuelva a cargar el chat
  c.onsuccess = () => { const cur = c.result; if (!cur) return; const v = cur.value || {}; if (v.chatKey === key || (v.chatKeys && v.chatKeys.includes(key))) cur.update({ ...v, noAuto: true }); cur.continue(); };
  return done(t);
}
/** Borra los chats guardados (menos los indicados) pero conserva los vínculos: sincronización, cortes, partes y marcadores */
export async function clearChatsExcept(keep = []) {
  const keepSet = new Set(keep);
  const keys = (await all('info').catch(() => [])).map(i => i.key).filter(k => !keepSet.has(k));
  const d = await open();
  const ck = await req(d.transaction('chats').objectStore('chats').getAllKeys());
  const doomed = [...new Set([...keys, ...ck.filter(k => !keepSet.has(k))])];
  if (!doomed.length) return 0;
  const t = d.transaction(['chats', 'info'], 'readwrite');
  for (const k of doomed) { t.objectStore('chats').delete(k); t.objectStore('info').delete(k); }
  await done(t);
  return doomed.length;
}
/** Marca todos los vídeos para que no vuelvan a descargar su chat solos (tras borrar la biblioteca a mano) */
export async function markAllNoAuto() {
  const d = await open();
  const t = d.transaction('links', 'readwrite');
  const c = t.objectStore('links').openCursor();
  c.onsuccess = () => { const cur = c.result; if (!cur) return; cur.update({ ...(cur.value || {}), noAuto: true }); cur.continue(); };
  return done(t);
}
export async function clearAll() {
  const d = await open();
  const t = d.transaction(['chats', 'info', 'links'], 'readwrite');
  for (const s of ['chats', 'info', 'links']) t.objectStore(s).clear();
  return done(t);
}
export async function usage() {
  try { const e = await navigator.storage.estimate(); return e.usage || 0; } catch { return 0; }
}
