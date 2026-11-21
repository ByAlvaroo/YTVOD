// Descarga + procesado de un chat (Drive / URL / archivo) usando el worker
import { downloadDrive, downloadUrl } from './drive.js';

const WORKER_URL = chrome.runtime.getURL('worker.js');

function withTimeout(p, ms) { return Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]); }
async function getJSON(url) { const r = await withTimeout(fetch(url, { credentials: 'omit' }), 9000); if (!r.ok) throw new Error(r.status); return r.json(); }

/** Emotes de 7TV / BTTV / FFZ (por si el JSON no los trae incrustados) */
export async function fetchThirdParty(id) {
  const BTTV_ZW = new Set(['SoSnowy', 'IceCold', 'SantaHat', 'TopHat', 'ReinDeer', 'CandyCane', 'cvMask', 'cvHazmat']);
  const from7tv = list => (list || []).map(e => {
    const host = e.data && e.data.host; if (!host) return null;
    const f = (host.files || []).find(x => x.name === '1x.webp') || (host.files || [])[0] || {};
    return { name: e.name, url: 'https:' + host.url + '/2x.webp', w: f.width || 28, h: f.height || 28, zw: (e.flags & 1) || ((e.data.flags || 0) & 256) ? 1 : 0 };
  }).filter(Boolean);
  const fromBttv = list => (list || []).map(e => ({ name: e.code, url: `https://cdn.betterttv.net/emote/${e.id}/2x`, w: e.width || 28, h: e.height || 28, zw: BTTV_ZW.has(e.code) ? 1 : 0 }));
  const fromFfz = sets => {
    const out = [];
    for (const k in sets || {}) for (const e of sets[k].emoticons || []) {
      const url = (e.urls && (e.urls['2'] || e.urls['1'])) || '';
      out.push({ name: e.name, url: url.startsWith('//') ? 'https:' + url : url, w: e.width || 28, h: e.height || 28, zw: 0 });
    }
    return out;
  };
  const jobs = [
    getJSON(`https://7tv.io/v3/users/twitch/${id}`).then(j => from7tv(j.emote_set && j.emote_set.emotes)),
    getJSON(`https://api.betterttv.net/3/cached/users/twitch/${id}`).then(j => fromBttv([...(j.channelEmotes || []), ...(j.sharedEmotes || [])])),
    getJSON(`https://api.frankerfacez.com/v1/room/id/${id}`).then(j => fromFfz(j.sets)),
    getJSON('https://7tv.io/v3/emote-sets/global').then(j => from7tv(j.emotes)),
    getJSON('https://api.betterttv.net/3/cached/emotes/global').then(fromBttv),
    getJSON('https://api.frankerfacez.com/v1/set/global').then(j => fromFfz(j.sets))
  ];
  const res = await Promise.allSettled(jobs);
  const out = []; const seen = new Set();
  for (const r of res) if (r.status === 'fulfilled') for (const e of r.value) {
    if (e.name && e.url && !seen.has(e.name)) { seen.add(e.name); out.push(e); }
  }
  return out;
}

export function chatKeyOf(meta) {
  if (meta.vodId) return 'vod_' + meta.vodId;
  const s = `${meta.streamer}|${meta.count}|${meta.firstId}|${meta.lastT}`;
  let hsh = 2166136261;
  for (let i = 0; i < s.length; i++) { hsh ^= s.charCodeAt(i); hsh = Math.imul(hsh, 16777619); }
  return 'h_' + (hsh >>> 0).toString(36);
}
export function estimateSize(d) {
  let s = d.T.byteLength + d.U.byteLength + d.C.byteLength + d.B.byteLength + d.F.byteLength;
  for (const m of d.M) s += m.length * 2;
  for (const x of d.images) s += typeof x === 'string' ? x.length * 2 : x.size;
  return s;
}

/**
 * src: {type:'drive', id, name?} | {type:'url', url} | {type:'file', file}
 * onStage(texto, progreso0a1|null)
 */
export async function loadChat(src, { onStage = () => {}, signal, fetchThird = true } = {}) {
  let buf;
  const mb = b => (b / 1048576).toFixed(1).replace('.', ',');
  const onProg = (got, total) => onStage(total ? `Descargando ${mb(got)} / ${mb(total)} MB` : `Descargando ${mb(got)} MB`, total ? got / total : null);
  if (src.type === 'file') { onStage('Leyendo archivo…', null); buf = await src.file.arrayBuffer(); }
  else if (src.type === 'drive') { onStage('Conectando con Google Drive…', null); buf = await downloadDrive(src.id, onProg, signal); }
  else { onStage('Descargando…', null); buf = await downloadUrl(src.url, onProg, signal); }
  if (signal && signal.aborted) throw new DOMException('Cancelado', 'AbortError');

  const worker = new Worker(WORKER_URL);
  const call = (msg, transfer) => new Promise((res, rej) => {
    const onAbort = () => { worker.terminate(); rej(new DOMException('Cancelado', 'AbortError')); };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = e => {
      const m = e.data;
      if (m.type === 'progress') onStage(m.stage, m.p);
      else { if (signal) signal.removeEventListener('abort', onAbort); m.type === 'error' ? rej(new Error(m.message)) : res(m); }
    };
    worker.onerror = e => rej(new Error(e.message || 'Error en el procesado'));
    worker.postMessage(msg, transfer || []);
  });
  try {
    onStage('Analizando el chat…', null);
    const { info } = await call({ cmd: 'parse', buf }, [buf]);
    let third = [];
    if (fetchThird && !info.hasThird && info.streamerId) {
      onStage('Descargando emotes de 7TV, BTTV y FFZ…', null);
      try { third = await fetchThirdParty(info.streamerId); } catch {}
    }
    const { data } = await call({ cmd: 'process', third });
    return { data, info };
  } finally { worker.terminate(); }
}
