// Copia de seguridad: exporta/importa ajustes, vínculos (sincronización, cortes, marcadores) y, si quieres, los chats
import * as DB from './db.js';

const MAGIC = 'TCRBACKUP1';
const SKEYS = ['tcr_settings', 'tcr_overlay', 'tcr_fsw'];
const TYPED = { Float64Array, Uint32Array, Uint16Array, Uint8Array, Int32Array };
const TYPED_KEYS = ['T', 'U', 'C', 'B', 'F', 'P'];

export async function exportBackup({ withChats = true, onStage = () => {} } = {}) {
  onStage('Reuniendo datos…');
  const settings = await chrome.storage.local.get(SKEYS);
  const [infos, links] = await Promise.all([DB.all('info').catch(() => []), DB.all('links').catch(() => [])]);
  const bins = []; let off = 0;
  const addBin = (blob, t) => { bins.push(blob); const ref = { o: off, l: blob.size, t }; off += blob.size; return ref; };
  const chats = [];
  if (withChats) {
    let k = 0;
    for (const info of infos) {
      onStage(`Chat ${++k}/${infos.length}…`);
      const d = await DB.get('chats', info.key).catch(() => null);
      if (!d) continue;
      const { images, ...rest } = d;
      const s = { ...rest };
      for (const key of TYPED_KEYS) if (d[key]) s[key] = { bin: addBin(new Blob([d[key]]), d[key].constructor.name) };
      s.images = images.map(x => (typeof x === 'string' ? { u: x } : { bin: addBin(x, x.type || 'image/png') }));
      delete s.urls; delete s.statics; delete s.src;
      chats.push({ key: info.key, data: s });
    }
  }
  onStage('Comprimiendo…');
  const header = new TextEncoder().encode(JSON.stringify({ magic: MAGIC, version: 1, created: Date.now(), withChats, settings, infos: withChats ? infos : [], links, chats }));
  const raw = new Blob([MAGIC, '\n', String(header.length).padStart(12, '0'), header, ...bins]);
  const gz = await new Response(raw.stream().pipeThrough(new CompressionStream('gzip'))).blob();
  return { blob: gz, chats: chats.length, links: links.length };
}

export async function importBackup(file, { onStage = () => {} } = {}) {
  onStage('Leyendo copia…');
  let bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    onStage('Descomprimiendo…');
    bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  }
  const dec = new TextDecoder();
  if (dec.decode(bytes.subarray(0, MAGIC.length)) !== MAGIC) throw new Error('Este archivo no es una copia de Chat Replay.');
  const p = MAGIC.length + 1;
  const hlen = +dec.decode(bytes.subarray(p, p + 12));
  const head = JSON.parse(dec.decode(bytes.subarray(p + 12, p + 12 + hlen)));
  const base = p + 12 + hlen;
  const slice = ref => bytes.slice(base + ref.o, base + ref.o + ref.l);
  let n = 0;
  for (const c of head.chats || []) {
    onStage(`Guardando chat ${++n}/${head.chats.length}…`);
    const d = { ...c.data };
    for (const key of TYPED_KEYS) if (d[key] && d[key].bin) { const C = TYPED[d[key].bin.t] || Uint8Array; d[key] = new C(slice(d[key].bin).buffer); }
    d.images = (d.images || []).map(x => (x.u != null ? x.u : new Blob([slice(x.bin)], { type: x.bin.t })));
    const info = (head.infos || []).find(i => i.key === c.key) || { key: c.key, title: d.meta && d.meta.title || 'Chat', count: d.T.length, updatedAt: Date.now(), savedAt: Date.now() };
    await DB.saveChat(c.key, d, info, null);
  }
  onStage('Guardando vínculos y ajustes…');
  for (const l of head.links || []) if (l && l.vid) await DB.put('links', l.vid, l);
  const st = {}; for (const k of SKEYS) if (head.settings && head.settings[k] != null) st[k] = head.settings[k];
  if (Object.keys(st).length) await chrome.storage.local.set(st);
  return { chats: (head.chats || []).length, links: (head.links || []).length };
}
