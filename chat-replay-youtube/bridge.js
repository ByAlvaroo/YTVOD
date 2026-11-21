// Chat Replay · puente con la app YTVOD (solo tus webs: localhost:47821 y byalvaroo.github.io).
// La app abre esta página escondida y pide «pasar todo»: cuentas, ajustes, sincronización de cada vídeo y chats guardados.
// No cambia nada de la extensión: solo lee y se lo da a la app.
import * as DB from './shared/db.js';

const OK = ['http://localhost:47821', 'http://127.0.0.1:47821', 'https://byalvaroo.github.io'];
const parentOrigin = (location.ancestorOrigins && location.ancestorOrigins[0]) || '';
const SKIP = new Set(['tcr_update', 'tcr_reload_tabs', 'tcr_selfupdate']);

if (window.parent !== window && OK.includes(parentOrigin)) {
  const post = (m, t) => window.parent.postMessage(m, parentOrigin, t || []);
  post({ type: 'tcr-bridge-hello', version: chrome.runtime.getManifest().version });
  window.addEventListener('message', async e => {
    const d = e.data || {};
    if (e.source !== window.parent || e.origin !== parentOrigin || d.type !== 'tcr-bridge-export') return;
    try {
      const local = await chrome.storage.local.get(null);
      for (const k of Object.keys(local)) if (SKIP.has(k)) delete local[k];
      const sync = await chrome.storage.sync.get(null);
      const [links, infos] = await Promise.all([DB.all('links').catch(() => []), DB.all('info').catch(() => [])]);
      const chats = [];
      if (d.withChats) for (const i of infos) {
        const c = await DB.get('chats', i.key).catch(() => null);
        if (!c) continue;
        const s = { ...c }; delete s.urls; delete s.statics; delete s.src;
        chats.push({ key: i.key, data: s });
      }
      post({ type: 'tcr-bridge-data', id: d.id, version: chrome.runtime.getManifest().version, local, sync, links, infos, chats });
    } catch (err) {
      post({ type: 'tcr-bridge-error', id: d.id, message: String((err && err.message) || err) });
    }
  });
}
