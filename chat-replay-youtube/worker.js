/* Worker: lee el JSON de TwitchDownloader fuera del hilo principal y lo compacta para que el chat vaya fluido. */
'use strict';
const SEP = '\u0001';
let parsed = null;

const GLOBAL_BADGES = {
  broadcaster: '5527c58c-fb7d-422d-b71b-f309dcb85cc1',
  moderator: '3267646d-33f0-4b17-b3df-f923a41db1d0',
  vip: 'b817aba4-fad8-49e2-b88a-7cc744dfa6ec',
  partner: 'd12a2e27-16f6-41d0-ab77-b780518f00a3',
  staff: 'd97c37bd-a6f5-4c38-8f57-4e4bef88af34',
  premium: 'bbbe0db0-a598-423e-86d0-f9fb98ca1933',
  turbo: 'bd444ec6-8f34-4bf9-91f4-af1e3428d80f'
};
const BADGE_TITLES = { broadcaster: 'Streamer', moderator: 'Moderador', vip: 'VIP', partner: 'Verificado', staff: 'Staff', premium: 'Prime Gaming', turbo: 'Turbo', subscriber: 'Suscriptor', founder: 'Fundador', bits: 'Bits', 'sub-gifter': 'Regalador de subs' };
const NOTICE_RE = /\b(subscribed (at|with)|is gifting|gifted a Tier|gifted \d+|is paying forward|continuing the Gift Sub|converted from a|se ha suscrito|regal[oó] \d+)/i;

const post = (m, t) => self.postMessage(m, t || []);
const progress = (stage, p) => post({ type: 'progress', stage, p: p == null ? null : p });

self.onmessage = async e => {
  const m = e.data;
  try {
    if (m.cmd === 'parse') post({ type: 'parsed', info: await parse(m.buf) });
    else if (m.cmd === 'process') {
      const data = processChat(m.third || []);
      parsed = null;
      post({ type: 'done', data }, [data.T.buffer, data.U.buffer, data.C.buffer, data.B.buffer, data.F.buffer].concat(data.P ? [data.P.buffer] : []));
    }
  } catch (err) {
    post({ type: 'error', message: String((err && err.message) || err) });
  }
};

async function parse(buf) {
  parsed = null;
  let bytes = new Uint8Array(buf);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    progress('Descomprimiendo .gz…');
    const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    bytes = new Uint8Array(await new Response(s).arrayBuffer());
  }
  progress('Leyendo JSON…');
  let text = new TextDecoder('utf-8').decode(bytes);
  bytes = null;
  const c = text.trimStart()[0];
  if (c === '<') throw new Error('Lo descargado es una página web, no un JSON. ¿El archivo de Drive es público?');
  if (c !== '{') throw new Error('El archivo no es un JSON. En TwitchDownloader exporta el chat en formato JSON.');
  const j = JSON.parse(text);
  text = null;
  if (!j || !Array.isArray(j.comments)) throw new Error('Este JSON no es un chat de TwitchDownloader (falta "comments").');
  parsed = j;
  const ed = j.embeddedData || j.emotes || {};
  return {
    streamerId: j.streamer && j.streamer.id != null ? String(j.streamer.id) : null,
    streamer: (j.streamer && j.streamer.name) || '',
    count: j.comments.length,
    hasThird: (ed.thirdParty || []).length,
    hasFirst: (ed.firstParty || []).length,
    hasBadges: (ed.twitchBadges || []).length
  };
}

function b64ToBytes(b64) {
  const bin = atob(b64); const n = bin.length; const u = new Uint8Array(n);
  for (let i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function mimeOf(u) {
  if (u[0] === 0x47 && u[1] === 0x49) return 'image/gif';
  if (u[0] === 0x89 && u[1] === 0x50) return 'image/png';
  if (u[0] === 0x52 && u[1] === 0x49 && u[8] === 0x57) return 'image/webp';
  if (u[4] === 0x66 && u[5] === 0x74 && u[6] === 0x79 && u[7] === 0x70) return 'image/avif';
  if (u[0] === 0xff && u[1] === 0xd8) return 'image/jpeg';
  return 'image/png';
}
function toBlob(data) {
  try {
    if (!data) return null;
    const u = typeof data === 'string' ? b64ToBytes(data) : Array.isArray(data) ? Uint8Array.from(data) : null;
    return u && u.length ? new Blob([u], { type: mimeOf(u) }) : null;
  } catch { return null; }
}
const offOf = c => +c.content_offset_seconds || 0;
const clean = s => (s || '').replace(/\u0001/g, '');

function processChat(third) {
  const j = parsed;
  if (!j) throw new Error('No hay chat que procesar.');
  const ed = j.embeddedData || j.emotes || {};
  progress('Preparando emotes e insignias…');

  const images = []; const urlIdx = new Map();
  const addImg = x => {
    if (typeof x === 'string') { const k = urlIdx.get(x); if (k !== undefined) return k; const i = images.push(x) - 1; urlIdx.set(x, i); return i; }
    return images.push(x) - 1;
  };

  const emotes = []; const firstMap = new Map(); const thirdMap = new Map();
  for (const e of ed.firstParty || []) {
    const b = toBlob(e.data); if (!b) continue;
    firstMap.set(String(e.id), emotes.push({ n: e.name || '', img: addImg(b), w: e.width || 28, h: e.height || 28, zw: 0 }) - 1);
  }
  for (const e of ed.thirdParty || []) {
    if (!e.name || thirdMap.has(e.name)) continue;
    const b = toBlob(e.data); if (!b) continue;
    thirdMap.set(e.name, emotes.push({ n: e.name, img: addImg(b), w: e.width || 28, h: e.height || 28, zw: e.isZeroWidth ? 1 : 0 }) - 1);
  }
  for (const e of third) {
    if (!e.name || thirdMap.has(e.name)) continue;
    thirdMap.set(e.name, emotes.push({ n: e.name, img: addImg(e.url), w: e.w || 28, h: e.h || 28, zw: e.zw ? 1 : 0 }) - 1);
  }
  const firstEmote = (id, name) => {
    id = String(id);
    let i = firstMap.get(id);
    if (i === undefined) {
      i = emotes.push({ n: name || '', img: addImg(`https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/2.0`), w: 56, h: 56, zw: 0 }) - 1;
      firstMap.set(id, i);
    }
    return i;
  };

  const badges = []; const badgeMap = new Map();
  for (const b of ed.twitchBadges || []) {
    const vers = b.versions || {};
    for (const ver in vers) {
      const v = vers[ver];
      const blob = toBlob(typeof v === 'string' ? v : v && (v.bytes || v.data));
      if (!blob) continue;
      const k = b.name + '/' + ver;
      badgeMap.set(k, badges.push({ k, t: (v && v.title) || BADGE_TITLES[b.name] || b.name, img: addImg(blob) }) - 1);
    }
  }
  const badgeIdx = (name, ver) => {
    const k = name + '/' + ver;
    let i = badgeMap.get(k);
    if (i !== undefined) return i;
    const g = GLOBAL_BADGES[name];
    i = badges.push({ k, t: BADGE_TITLES[name] || name, img: g ? addImg(`https://static-cdn.jtvnw.net/badges/v1/${g}/2`) : -1 }) - 1;
    badgeMap.set(k, i);
    return i;
  };

  const sets = [[]]; const setMap = new Map([['', 0]]);
  const names = [], logins = []; const userMap = new Map();
  const colors = ['']; const colorMap = new Map([['', 0]]);

  const cs = j.comments; const n = cs.length;
  let order = null;
  for (let i = 1; i < n; i++) if (offOf(cs[i]) < offOf(cs[i - 1])) { order = true; break; }
  if (order) { order = Array.from({ length: n }, (_, i) => i); order.sort((a, b) => offOf(cs[a]) - offOf(cs[b])); }

  const T = new Float64Array(n), U = new Uint32Array(n), C = new Uint16Array(n), B = new Uint16Array(n), F = new Uint8Array(n);
  const M = new Array(n);
  // respuestas en hilo: solo si el JSON trae el mensaje padre (las versiones nuevas de Twitch lo incluyen)
  const parentIds = new Array(n); let anyParent = false; const ids = new Array(n);

  const textPart = t => {
    t = clean(t);
    if (!thirdMap.size || !t) return t;
    const w = t.split(' '); let ch = false;
    for (let k = 0; k < w.length; k++) { const ix = thirdMap.get(w[k]); if (ix !== undefined) { w[k] = SEP + ix + SEP; ch = true; } }
    return ch ? w.join(' ') : t;
  };

  for (let k = 0; k < n; k++) {
    if (k % 25000 === 0) progress('Procesando mensajes…', k / n);
    const c = cs[order ? order[k] : k];
    const msg = c.message || {};
    const who = c.commenter || {};
    T[k] = offOf(c);

    const login = (who.name || who.display_name || '?').toLowerCase();
    const ukey = who._id || login;
    let u = userMap.get(ukey);
    if (u === undefined) {
      const dn = who.display_name || who.name || '?';
      u = names.push(dn.toLowerCase() === login ? dn : `${dn} (${login})`) - 1;
      logins.push(login);
      userMap.set(ukey, u);
    }
    U[k] = u;

    const col = msg.user_color || '';
    let ci = colorMap.get(col);
    if (ci === undefined) { ci = colors.push(col) - 1; colorMap.set(col, ci); }
    C[k] = Math.min(ci, 65535);

    const ub = msg.user_badges || [];
    if (ub.length) {
      const ids = ub.map(b => badgeIdx(b._id || b.setID || b.name, b.version || '1'));
      const key = ids.join(',');
      let si = setMap.get(key);
      if (si === undefined) { si = sets.push(ids) - 1; setMap.set(key, si); }
      B[k] = Math.min(si, 65535);
    }

    let body = msg.body || '';
    let flags = 0;
    let frags = Array.isArray(msg.fragments) && msg.fragments.length ? msg.fragments : null;
    const hasFragEmote = frags && frags.some(f => f && f.emoticon);
    if (!hasFragEmote && Array.isArray(msg.emoticons) && msg.emoticons.length && body) {
      const chars = Array.from(body); const list = [...msg.emoticons].sort((a, b) => a.begin - b.begin);
      frags = []; let pos = 0;
      for (const em of list) {
        if (em.begin > pos) frags.push({ text: chars.slice(pos, em.begin).join('') });
        frags.push({ text: chars.slice(em.begin, em.end + 1).join(''), emoticon: { emoticon_id: em._id || em.id } });
        pos = em.end + 1;
      }
      if (pos < chars.length) frags.push({ text: chars.slice(pos).join('') });
    }
    if (!frags) frags = [{ text: body }];

    let out = '';
    for (const f of frags) {
      if (!f) continue;
      if (f.emoticon && (f.emoticon.emoticon_id || f.emoticon.id)) out += SEP + firstEmote(f.emoticon.emoticon_id || f.emoticon.id, f.text) + SEP;
      else out += textPart(f.text);
    }
    if (out.startsWith('\u0001ACTION') || body.startsWith('\u0001ACTION')) { out = out.replace(/^\u0001?ACTION ?/, '').replace(/\u0001$/, ''); flags |= 1; }
    const noticeId = msg.user_notice_params && msg.user_notice_params['msg-id'];
    if (noticeId || NOTICE_RE.test(body)) flags |= 2;
    if (msg.bits_spent > 0) flags |= 4;
    // mensajes eliminados por moderación (si el JSON los marca)
    if (c.is_deleted || c.deleted || msg.is_deleted || msg.deleted || noticeId === 'clearmsg') flags |= 8;
    ids[k] = c._id || '';
    const rp = (msg.reply && (msg.reply.parent_msg_id || msg.reply.parentMessageId || (msg.reply.parent && msg.reply.parent.id)))
      || msg.reply_parent_msg_id || c.reply_parent_msg_id || c.reply_parent_id
      || (msg.user_notice_params && msg.user_notice_params['reply-parent-msg-id']);
    if (rp) { parentIds[k] = String(rp); anyParent = true; }
    F[k] = flags;
    M[k] = out;
  }
  progress('Procesando mensajes…', 1);
  let P = null;
  if (anyParent) {
    const pos = new Map(); for (let k = 0; k < n; k++) if (ids[k]) pos.set(ids[k], k);
    P = new Int32Array(n).fill(-1);
    for (let k = 0; k < n; k++) if (parentIds[k]) { const p = pos.get(parentIds[k]); if (p !== undefined && p < k) P[k] = p; }
  }

  const v = j.video || {};
  const lastT = n ? T[n - 1] : 0;
  const meta = {
    streamer: (j.streamer && j.streamer.name) || '',
    streamerId: j.streamer && j.streamer.id != null ? String(j.streamer.id) : null,
    vodId: v.id != null ? String(v.id) : null,
    title: v.title || '',
    createdAt: v.created_at || null,
    start: +v.start || 0,
    end: +v.end || 0,
    length: +v.length || 0,
    count: n,
    chatters: names.length,
    lastT,
    firstId: n ? (cs[order ? order[0] : 0]._id || '') : ''
  };
  const out = { v: 1, meta, names, logins, colors, badges, sets, emotes, images, T, U, C, B, F, M };
  if (P) out.P = P;
  return out;
}
