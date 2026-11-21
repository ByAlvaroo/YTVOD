// ===== Chat Replay · app =====
// Hace lo mismo que content.js en YouTube, pero con el reproductor oficial de YouTube incrustado:
// coloca el chat (panel.html de la extensión), le pasa el tiempo del vídeo y abre los ajustes (app.html).
// Además: catálogo SOLO con los vídeos que tienen chat, buscador y detección automática de vídeos nuevos.
const EXT = window.TCR_EXT || new URL('../chat-replay-youtube/', location.href).href;
const [DB, SETM, DRIVE, PARTS, UTIL] = await Promise.all(['db', 'settings', 'drive', 'parts', 'util'].map(n => import(EXT + 'shared/' + n + '.js')));
const { loadSettings, onSettings } = SETM, { getFolderFiles } = DRIVE, { groupFiles } = PARTS, { norm } = UTIL;
const CFG = window.CHAT_REPLAY || {};
const $ = id => document.getElementById(id);
const SID = Math.random().toString(36).slice(2, 10);
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const k in attrs || {}) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
}
let toastT = 0;
function toast(msg, ms = 2800) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms); }
const fmtDur = s => { s = Math.round(s || 0); const hh = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; const p = n => String(n).padStart(2, '0'); return hh ? `${hh}:${p(m)}:${p(x)}` : `${m}:${p(x)}`; };
const decode = t => { const d = document.createElement('textarea'); d.innerHTML = t || ''; return d.value; };

/* ---------- Clave de Google (para leer Drive y buscar en YouTube) ---------- */
function apiKey() { return LS.get('tcr_api_key_user', '') || CFG.apiKey || ''; }
function syncKey() { try { localStorage.setItem('tcr_api_key', apiKey()); } catch {} }
syncKey();

/* ---------- «Segundo plano» de la extensión (cuenta, ByAlvaro, publicar): solo en una pestaña ---------- */
async function startBackground() {
  const run = async () => { await import(EXT + 'background.js'); globalThis.__tcrWebStartup && globalThis.__tcrWebStartup(); };
  if (navigator.locks && navigator.locks.request) navigator.locks.request('tcr-web-background', () => new Promise(() => { run().catch(e => console.error('Segundo plano', e)); }));
  else run().catch(e => console.error('Segundo plano', e));
}
startBackground();

/* ===================================================================== */
/*  Catálogo                                                             */
/* ===================================================================== */
const META_KEY = 'tcr_app_meta', PROG_KEY = 'tcr_app_progress', SEARCH_KEY = 'tcr_app_search', QUOTA_KEY = 'tcr_app_quota';
let meta = LS.get(META_KEY, {});
let catalog = [];          // [{ vid, title, channel, dur, published, linkedAt }]
let pending = [];          // chats de Drive sin vídeo encontrado
let detectState = { busy: false, at: 0, msg: '' };
const keysOf = l => (l && (l.chatKeys && l.chatKeys.length ? l.chatKeys : l.chatKey ? [l.chatKey] : [])) || [];

async function loadCatalog() {
  const links = await DB.all('links').catch(() => []);
  const out = [];
  for (const l of links) {
    if (!l || !l.vid || l.detached || !/^[\w-]{11}$/.test(l.vid)) continue;
    if (!keysOf(l).length && !(l.srcs && l.srcs.length)) continue;
    const m = meta[l.vid] || {};
    out.push({ vid: l.vid, title: m.title || l.ytTitle || 'Vídeo de YouTube', channel: m.channel || '', channelId: m.channelId || '', dur: m.dur || 0, published: m.published || 0, linkedAt: l.linkedAt || 0, embeddable: m.embeddable, srcIds: (l.srcs || []).filter(s => s.type === 'drive').map(s => s.id) });
  }
  catalog = out.sort((a, b) => (b.published || b.linkedAt) - (a.published || a.linkedAt));
  return catalog;
}

/* --- YouTube Data API (con la misma clave) --- */
async function ytApi(path, params) {
  const key = apiKey();
  if (!key) throw new Error('sin clave');
  const r = await fetch(`https://www.googleapis.com/youtube/v3/${path}?` + new URLSearchParams({ ...params, key }), { credentials: 'omit' });
  if (!r.ok) { let m = ''; try { m = ((await r.json()).error || {}).message || ''; } catch {} throw new Error(`YouTube respondió ${r.status}. ${m}`); }
  return r.json();
}
const isoDur = s => { const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(s || ''); return m ? (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0) : 0; };
/** Título, canal, duración y fecha de los vídeos que aún no los tienen (1 unidad de cuota por cada 50 vídeos) */
async function fillMeta() {
  if (!apiKey()) return false;
  const need = catalog.filter(v => !meta[v.vid] || !meta[v.vid].full || Date.now() - (meta[v.vid].at || 0) > 14 * 864e5).map(v => v.vid);
  if (!need.length) return false;
  for (let i = 0; i < need.length; i += 50) {
    const ids = need.slice(i, i + 50);
    try {
      const j = await ytApi('videos', { part: 'snippet,contentDetails,status', id: ids.join(','), fields: 'items(id,snippet(title,channelTitle,channelId,publishedAt),contentDetails/duration,status/embeddable)', maxResults: 50 });
      const got = new Set();
      for (const it of j.items || []) {
        got.add(it.id);
        meta[it.id] = { title: it.snippet.title, channel: it.snippet.channelTitle, channelId: it.snippet.channelId, published: Date.parse(it.snippet.publishedAt) || 0, dur: isoDur(it.contentDetails && it.contentDetails.duration), embeddable: !(it.status && it.status.embeddable === false), full: 1, at: Date.now() };
      }
      for (const id of ids) if (!got.has(id)) meta[id] = { ...(meta[id] || {}), gone: true, full: 1, at: Date.now() };
    } catch (e) { console.warn('Datos de YouTube:', e.message); return false; }
  }
  LS.set(META_KEY, meta);
  await fillAvatars();
  return true;
}
/** Foto de cada canal (1 unidad de cuota por cada 50 canales) */
const CHAN_KEY = 'tcr_app_chan';
let chans = LS.get(CHAN_KEY, {});
async function fillAvatars() {
  const ids = [...new Set(Object.values(meta).map(m => m.channelId).filter(id => id && !chans[id]))];
  for (let i = 0; i < ids.length; i += 50) {
    try {
      const j = await ytApi('channels', { part: 'snippet', id: ids.slice(i, i + 50).join(','), fields: 'items(id,snippet/thumbnails/default/url)', maxResults: 50 });
      for (const it of j.items || []) chans[it.id] = (it.snippet && it.snippet.thumbnails && it.snippet.thumbnails.default && it.snippet.thumbnails.default.url) || '-';
    } catch { break; }
  }
  LS.set(CHAN_KEY, chans);
}
function avatarEl(cls, name, channelId) {
  const url = channelId && chans[channelId] && chans[channelId] !== '-' ? chans[channelId] : '';
  const el = document.createElement('span'); el.className = cls;
  if (url) el.append(h('img', { src: url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }));
  else el.textContent = (name || 'Y').trim().charAt(0).toUpperCase();
  return el;
}

/* --- Detección automática: chats de tu Drive cuyo título coincide al 100 % con un vídeo de YouTube --- */
function quotaLeft() {
  const day = new Date().toISOString().slice(0, 10);
  const q = LS.get(QUOTA_KEY, {});
  return q.day === day ? Math.max(0, (CFG.searchesPerDay || 40) - (q.n || 0)) : (CFG.searchesPerDay || 40);
}
function useQuota() { const day = new Date().toISOString().slice(0, 10); const q = LS.get(QUOTA_KEY, {}); LS.set(QUOTA_KEY, { day, n: (q.day === day ? q.n || 0 : 0) + 1 }); }

async function detect({ force = false } = {}) {
  if (detectState.busy) return;
  const S = await loadSettings();
  if (!S.driveFolder || !apiKey()) { pending = []; return; }
  detectState = { busy: true, at: Date.now(), msg: 'Mirando tu carpeta de Drive…' };
  if (!force) renderSoon();
  let changed = false;
  try {
    const c = await getFolderFiles(S.driveFolder, { maxAgeMs: force ? 0 : 10 * 60 * 1000, force });
    const groups = groupFiles(c.files, '');
    const links = await DB.all('links').catch(() => []);
    const usedIds = new Set(), usedTitles = new Set();
    for (const l of links) {
      if (!l) continue;
      for (const s of l.srcs || []) if (s.type === 'drive') usedIds.add(s.id);
      if (l.ytTitle) usedTitles.add(norm(l.ytTitle));
      const m = meta[l.vid]; if (m && m.title) usedTitles.add(norm(m.title));
    }
    const cache = LS.get(SEARCH_KEY, {});
    const todo = [];
    pending = [];
    for (const g of groups) {
      if (g.files.some(f => usedIds.has(f.id)) || usedTitles.has(norm(g.name))) continue;
      const k = norm(g.name);
      const hit = cache[k];
      if (hit && hit.vid) { await linkGroup(hit.vid, hit.title, g); changed = true; continue; }
      if (hit && !force && Date.now() - hit.at < 3 * 864e5) { pending.push({ g, why: 'No hay ningún vídeo con este título exacto' }); continue; }
      todo.push(g);
    }
    for (const g of todo) {
      if (quotaLeft() <= 0) { pending.push({ g, why: 'Se buscará mañana (límite diario de búsquedas)' }); continue; }
      detectState.msg = `Buscando en YouTube: ${g.name}`; renderSoon();
      const k = norm(g.name);
      try {
        useQuota();
        const j = await ytApi('search', { part: 'snippet', type: 'video', maxResults: 8, q: g.name, fields: 'items(id/videoId,snippet(title,channelTitle,publishedAt))' });
        const it = (j.items || []).find(x => x.id && x.id.videoId && norm(decode(x.snippet.title)) === k);
        if (it) {
          const title = decode(it.snippet.title);
          cache[k] = { vid: it.id.videoId, title, at: Date.now() };
          meta[it.id.videoId] = { ...(meta[it.id.videoId] || {}), title, channel: decode(it.snippet.channelTitle), published: Date.parse(it.snippet.publishedAt) || 0 };
          await linkGroup(it.id.videoId, title, g); changed = true;
        } else { cache[k] = { vid: null, at: Date.now() }; pending.push({ g, why: 'No hay ningún vídeo con este título exacto' }); }
      } catch (e) { pending.push({ g, why: 'No se pudo buscar: ' + e.message }); if (/403|400/.test(e.message)) break; }
    }
    LS.set(SEARCH_KEY, cache); LS.set(META_KEY, meta);
    detectState = { busy: false, at: Date.now(), msg: '' };
  } catch (e) {
    detectState = { busy: false, at: Date.now(), msg: '', error: e.message };
  }
  if (changed) { await loadCatalog(); await fillMeta(); await loadCatalog(); }
  renderSoon();
  return changed;
}
/** Une un chat (todas sus partes) a un vídeo: se guarda como en la extensión y, si eres ByAlvaro, se publica para todos */
async function linkGroup(vid, title, g) {
  const old = await DB.get('links', vid).catch(() => null);
  if (old && !old.detached && ((old.srcs && old.srcs.length) || keysOf(old).length)) return;
  await DB.put('links', vid, { ...(old || {}), vid, ytTitle: title || g.name, sync: (old && old.sync) || { mode: 'auto', delta: 0, cuts: [] }, marks: (old && old.marks) || [], srcs: g.files.map(f => ({ type: 'drive', id: f.id, name: f.name })), linkedAt: Date.now(), detached: false, noAuto: false });
}

/* ===================================================================== */
/*  Inicio y buscador                                                    */
/* ===================================================================== */
const home = $('home');
let shuffled = null;
const BUB = '<svg viewBox="0 0 24 24"><path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-6l-4 3.5V17H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/></svg>';
const ago = ts => { if (!ts) return ''; const d = (Date.now() - ts) / 864e5; if (d < 1) return 'hoy'; if (d < 2) return 'ayer'; if (d < 30) return `hace ${Math.floor(d)} días`; if (d < 365) { const m = Math.floor(d / 30); return `hace ${m} ${m === 1 ? 'mes' : 'meses'}`; } const y = Math.floor(d / 365); return `hace ${y} ${y === 1 ? 'año' : 'años'}`; };
function card(v) {
  const p = LS.get(PROG_KEY, {})[v.vid];
  const dur = v.dur || (p && p.d) || 0;
  const pct = p && dur ? Math.min(100, p.t / dur * 100) : 0;
  return h('a', { class: 'card', href: '#/v/' + v.vid, title: v.title },
    h('div', { class: 'thumb' },
      h('img', { src: `https://i.ytimg.com/vi/${v.vid}/mqdefault.jpg`, loading: 'lazy', alt: '' }),
      h('span', { class: 'has', html: BUB + 'Chat' }),
      dur ? h('span', { class: 'dur', text: fmtDur(dur) }) : null,
      pct > 1 ? h('div', { class: 'prog' }, h('i', { style: `width:${pct}%` })) : null),
    h('div', { class: 'meta' }, avatarEl('av', v.channel || v.title, v.channelId),
      h('div', { style: 'min-width:0' }, h('div', { class: 'ct', text: v.title }), h('div', { class: 'cc', text: [v.channel, ago(v.published)].filter(Boolean).join(' · ') || 'Con chat de Twitch' }))));
}
function section(title, n, list, { grid = false, more = null } = {}) {
  return h('section', { class: 'sec' },
    h('div', { class: 'sec-h' }, h('h2', { text: title }), n != null ? h('span', { class: 'n', text: n + (n === 1 ? ' vídeo' : ' vídeos') }) : null, more ? h('button', { class: 'more', onclick: more }, 'Ver todo') : null),
    h('div', { class: grid ? 'grid' : 'row' }, list.map(card)));
}
function notices() {
  const out = [];
  if (!apiKey()) out.push(h('div', { class: 'notice' }, h('span', { style: 'flex:1;min-width:220px' }, '⚠ Falta la clave de Google. Sin ella la app no puede leer los chats de tu Drive ni encontrar los vídeos sola.'), h('button', { class: 'btn sm p', onclick: openKey }, 'Poner la clave')));
  if (detectState.busy && detectState.msg) out.push(h('div', { class: 'notice info' }, '🔎 ' + detectState.msg));
  if (detectState.error) out.push(h('div', { class: 'notice' }, '⚠ ' + detectState.error));
  return out;
}
let renderT = 0;
function renderSoon() { clearTimeout(renderT); renderT = setTimeout(render, 60); }
function render() {
  const r = route();
  if (r.name === 'watch') return;
  const q = r.name === 'search' ? r.q : '';
  if ($('q').value !== q && document.activeElement !== $('q')) $('q').value = q;
  const list = catalog.filter(v => !(meta[v.vid] && meta[v.vid].gone));
  const kids = [...notices()];
  if (r.name === 'search' && q.trim()) {
    const toks = norm(q).split(' ').filter(Boolean);
    const res = list.filter(v => { const t = norm(v.title + ' ' + v.channel); return toks.every(x => t.includes(x)); });
    kids.push(res.length ? section(`Resultados para «${q}»`, res.length, res, { grid: true }) : h('div', { class: 'empty' }, h('h2', { text: 'No hay vídeos con chat que coincidan' }), h('p', { text: 'Solo salen los vídeos que tienen chat de Twitch. Prueba con otras palabras.' })));
  } else if (r.name === 'channel') {
    const res = list.filter(v => (v.channel || 'Otros') === r.ch);
    kids.push(section(r.ch, res.length, res, { grid: true }));
  } else if (!list.length) {
    kids.push(h('div', { class: 'empty' },
      h('img', { class: 'big', src: 'icons/icon-192.png', alt: '' }),
      h('h2', { text: detectState.busy ? 'Buscando vídeos con chat…' : 'Aún no hay vídeos con chat' }),
      h('p', { text: 'Aquí solo aparecen los vídeos que tienen chat de Twitch: los de la configuración de ByAlvaro y los que la app encuentra sola en tu carpeta de Drive (título idéntico al del vídeo).' }),
      h('p', null, h('button', { class: 'btn p', onclick: openAdd }, '＋ Añadir un vídeo'))));
  } else {
    const prog = LS.get(PROG_KEY, {});
    const cont = list.filter(v => { const p = prog[v.vid]; const d = v.dur || (p && p.d); return p && p.t > 30 && (!d || p.t < d - 60); }).sort((a, b) => prog[b.vid].at - prog[a.vid].at);
    if (cont.length) kids.push(section('Continuar viendo', null, cont.slice(0, 20)));
    const by = new Map();
    for (const v of list) { const c = v.channel || 'Otros'; if (!by.has(c)) by.set(c, []); by.get(c).push(v); }
    if (!shuffled || shuffled.length !== list.length) shuffled = list.slice().sort(() => Math.random() - 0.5);
    if (by.size > 1 || list.length > 8) kids.push(section('Para ver', null, shuffled.slice(0, 16)));
    const chans = [...by.entries()].sort((a, b) => (a[0] === 'Otros') - (b[0] === 'Otros') || b[1].length - a[1].length);
    if (chans.length > 1) kids.push(h('div', { class: 'chips' }, chans.map(([c, l]) => h('button', { class: 'chip', onclick: () => go('#/c/' + encodeURIComponent(c)) }, `${c} · ${l.length}`))));
    for (const [c, l] of chans) kids.push(section(c, l.length, l.slice(0, 24), { more: l.length > 24 ? () => go('#/c/' + encodeURIComponent(c)) : null }));
  }
  if (pending.length && r.name === 'home') {
    kids.push(h('section', { class: 'sec' },
      h('div', { class: 'sec-h' }, h('h2', { text: 'Chats sin vídeo' }), h('span', { class: 'n', text: pending.length + ' en tu Drive' })),
      h('div', { class: 'pend' }, pending.slice(0, 60).map(({ g, why }) => h('div', { class: 'pend-i' },
        h('div', { class: 'nm', title: g.name }, g.name, h('div', { class: 'st', text: why })),
        h('a', { class: 'btn sm', href: 'https://www.youtube.com/results?search_query=' + encodeURIComponent(g.name), target: '_blank', rel: 'noopener' }, 'Buscar'),
        h('button', { class: 'btn sm', onclick: () => openLinkPending(g) }, 'Pegar enlace'))))));
  }
  home.replaceChildren(...kids);
}

/* ===================================================================== */
/*  Rutas                                                                */
/* ===================================================================== */
function route() {
  const hs = location.hash.replace(/^#\/?/, '');
  let m;
  if ((m = hs.match(/^v\/([\w-]{11})(?:\?t=(\d+))?/))) return { name: 'watch', vid: m[1], t: m[2] ? +m[2] : null };
  if ((m = hs.match(/^q\/(.*)$/))) return { name: 'search', q: decodeURIComponent(m[1]) };
  if ((m = hs.match(/^c\/(.*)$/))) return { name: 'channel', ch: decodeURIComponent(m[1]) };
  return { name: 'home' };
}
const go = hash => { if (location.hash !== hash) location.hash = hash; else onRoute(); };
function onRoute() {
  const r = route();
  document.body.classList.toggle('watching', r.name === 'watch');
  if (r.name === 'watch') { home.hidden = true; $('watch').hidden = false; openVideo(r.vid, r.t); }
  else { leaveVideo(); $('watch').hidden = true; home.hidden = false; render(); }
}
addEventListener('hashchange', onRoute);
$('q').addEventListener('input', () => {
  const v = $('q').value;
  const target = v.trim() ? '#/q/' + encodeURIComponent(v) : '#/';
  history.replaceState(null, '', target); onRoute();
});
$('q').addEventListener('keydown', e => { if (e.key === 'Enter') $('q').blur(); });

/* ===================================================================== */
/*  Reproductor de YouTube + chat                                        */
/* ===================================================================== */
const stage = $('stage'), panelEl = $('panel');
let player = null, ytReady = null, cur = null; // cur = { vid, durOk, sent }
let port = null, hasChat = false, chatOpen = LS.get('tcr_app_chat', true), barData = null;
let timeIv = 0, progIv = 0, lastSentKey = '', layoutKey = '', lastVisible = null;

function loadYT() {
  if (ytReady) return ytReady;
  ytReady = new Promise(res => {
    window.onYouTubeIframeAPIReady = () => res(window.YT);
    const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; document.head.append(s);
  });
  return ytReady;
}
const post = m => { if (port) try { port.postMessage(m); } catch {} };

// panel del chat (se carga una sola vez y se le van pasando los vídeos, como en YouTube)
panelEl.addEventListener('load', () => {
  const ch = new MessageChannel();
  port = ch.port1;
  port.onmessage = e => onPanel(e.data);
  panelEl.contentWindow.postMessage({ type: 'tcr-init' }, location.origin, [ch.port2]);
});
panelEl.src = EXT + 'panel.html#sid=' + SID;

function onPanel(m) {
  if (!m) return;
  switch (m.type) {
    case 'ready': layoutKey = ''; lastSentKey = ''; lastVisible = null; sendVideo(true); sendTime(); layout(); break;
    case 'status':
      if (cur && m.vid && m.vid !== cur.vid) break;
      hasChat = !!m.hasChat;
      if (m.reason === 'loaded') setChat(true);
      $('bChat').classList.toggle('on', chatOpen);
      if (hasChat) loadCatalog();
      break;
    case 'seek': if (player && isFinite(m.t)) { player.seekTo(Math.max(0, m.t), true); } break;
    case 'close': setChat(false); break;
    case 'openSettings': openModal(m.section); break;
    case 'key': handleKey(m.code, m.alt); break;
    case 'bar': barData = m.heat || m.marks ? { heat: m.heat, marks: m.marks, dur: m.dur } : null; drawHeat(); break;
    case 'resize': if (m.edge === 'l') setChatW(chatW() - m.dx); break;
    case 'dragEnd': LS.set('tcr_app_cw', chatW()); break;
  }
}

function vdata() { try { return player && player.getVideoData ? player.getVideoData() || {} : {}; } catch { return {}; } }
function sendVideo(force) {
  if (!cur) { post({ type: 'video', vid: null, title: '', channel: '', duration: 0 }); return; }
  const d = vdata();
  let dur = 0; try { dur = player.getDuration() || 0; } catch {}
  const ok = d.video_id === cur.vid && d.title;
  const title = ok ? d.title : '';
  const key = `${cur.vid}|${Math.round(ok ? dur : 0)}|${title}`;
  if (!force && key === lastSentKey) return;
  lastSentKey = key;
  post({ type: 'video', vid: cur.vid, title, channel: ok ? d.author || '' : '', duration: ok && dur > 0 ? dur : 0 });
  if (ok) {
    $('vtitle').textContent = d.title; $('vchan').textContent = d.author || '';
    document.title = d.title + ' · YTVOD';
    const m = meta[cur.vid] || {};
    if (m.title !== d.title || (!m.channel && d.author) || (!m.dur && dur)) { if (!m.channel && d.author) $('avatar').textContent = d.author.charAt(0).toUpperCase(); meta[cur.vid] = { ...m, title: d.title, channel: m.channel || d.author || '', dur: m.dur || Math.round(dur) }; LS.set(META_KEY, meta); }
  }
}
function sendTime() {
  if (!player || !cur || !player.getCurrentTime) return;
  let t = 0, rate = 1, s = -1;
  try { t = player.getCurrentTime() || 0; rate = player.getPlaybackRate() || 1; s = player.getPlayerState(); } catch {}
  post({ type: 'time', t, rate, paused: s !== 1, ad: false });
}
function saveProgress() {
  if (!player || !cur) return;
  let t = 0, d = 0, s = -1;
  try { t = player.getCurrentTime() || 0; d = player.getDuration() || 0; s = player.getPlayerState(); } catch {}
  if (s !== 1 || t < 5) return;
  const P = LS.get(PROG_KEY, {});
  P[cur.vid] = { t: Math.floor(t), d: Math.floor(d), at: Date.now() };
  const ks = Object.keys(P); if (ks.length > 300) ks.sort((a, b) => P[a].at - P[b].at).slice(0, ks.length - 300).forEach(k => delete P[k]);
  LS.set(PROG_KEY, P);
}

async function openVideo(vid, t) {
  const same = cur && cur.vid === vid;
  if (same && t == null) { layout(); return; }
  const P = LS.get(PROG_KEY, {})[vid];
  let start = t != null ? t : (P && P.t > 30 && (!P.d || P.t < P.d - 60) ? P.t - 2 : 0);
  cur = { vid };
  hasChat = false; barData = null; drawHeat(); lastSentKey = '';
  const m = meta[vid] || {}, c = catalog.find(x => x.vid === vid);
  $('vtitle').textContent = m.title || (c && c.title) || ''; $('vchan').textContent = m.channel || '';
  $('avatar').replaceWith(Object.assign(avatarEl('', m.channel || m.title, m.channelId), { id: 'avatar' }));
  $('vbox').replaceChildren(...(m.published || m.dur ? [h('b', { text: [m.dur ? fmtDur(m.dur) : '', m.published ? new Date(m.published).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) : ''].filter(Boolean).join(' · ') }), h('br'), 'El chat de Twitch va sincronizado con el vídeo. Pulsa la hora de un mensaje para saltar a ese momento.'] : []));
  renderMore(vid);
  $('bYt').href = `https://www.youtube.com/watch?v=${vid}` + (start > 5 ? `&t=${Math.floor(start)}s` : '');
  $('pbox').querySelector('.blocked')?.remove();
  setChat(chatOpen, true);
  sendVideo(true);
  const YT = await loadYT();
  if (!cur || cur.vid !== vid) return;
  if (player && player.loadVideoById) {
    player.loadVideoById({ videoId: vid, startSeconds: Math.max(0, start) });
  } else {
    await new Promise(res => {
      player = new YT.Player('player', {
        videoId: vid,
        playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1, start: Math.max(0, Math.floor(start)), origin: location.origin, enablejsapi: 1, iv_load_policy: 3 },
        events: {
          onReady: () => res(),
          onStateChange: () => { sendVideo(false); sendTime(); },
          onPlaybackRateChange: sendTime,
          onError: e => onYtError(e.data)
        }
      });
    });
  }
  clearInterval(timeIv); clearInterval(progIv);
  timeIv = setInterval(() => { sendTime(); sendVideo(false); }, 250);
  progIv = setInterval(saveProgress, 5000);
}
function renderMore(vid) {
  const m = meta[vid] || {};
  const others = catalog.filter(v => v.vid !== vid && !(meta[v.vid] && meta[v.vid].gone));
  const same = others.filter(v => m.channel && v.channel === m.channel);
  const rest = others.filter(v => !same.includes(v)).sort(() => Math.random() - 0.5);
  const list = [...same, ...rest].slice(0, 12);
  $('more').replaceChildren(...(list.length ? [h('h2', { text: 'Más vídeos con chat' }), h('div', { class: 'grid' }, list.map(card))] : []));
}
function leaveVideo() {
  if (!cur) return;
  saveProgress();
  cur = null; clearInterval(timeIv); clearInterval(progIv);
  try { player && player.stopVideo && player.stopVideo(); } catch {}
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  sendVideo(true); post({ type: 'visibility', visible: false }); lastVisible = false;
  document.title = 'YTVOD';
  barData = null; drawHeat();
}
function onYtError(code) {
  if (!cur) return;
  const msg = code === 101 || code === 150 || code === 153 ? 'El dueño de este vídeo no deja verlo fuera de YouTube.' : code === 100 ? 'Este vídeo ya no existe o es privado.' : 'YouTube no ha podido cargar el vídeo (' + code + ').';
  $('pbox').querySelector('.blocked')?.remove();
  $('pbox').append(h('div', { class: 'blocked', style: 'position:absolute;inset:0;display:grid;place-items:center;text-align:center;background:#111;padding:20px;z-index:2' },
    h('div', null, h('div', { style: 'font:600 18px/1.3 var(--serif);margin-bottom:8px', text: msg }), h('a', { class: 'btn p', href: `https://www.youtube.com/watch?v=${cur.vid}`, target: '_blank', rel: 'noopener' }, 'Abrir en YouTube'), h('div', { style: 'color:var(--muted);font-size:12.5px;margin-top:10px', text: 'En YouTube, con la extensión Chat Replay, el chat sí funciona.' }))));
}

/* --- Colocación del chat --- */
const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
const chatW = () => parseInt(getComputedStyle(document.documentElement).getPropertyValue('--chat-w')) || 380;
function setChatW(w) { w = Math.round(Math.min(Math.max(260, w), window.innerWidth * 0.6)); document.documentElement.style.setProperty('--chat-w', w + 'px'); }
setChatW(LS.get('tcr_app_cw', 380));
function setChat(on, quiet) {
  chatOpen = !!on; LS.set('tcr_app_chat', chatOpen);
  layout();
  if (on && !quiet) { lastSentKey = ''; sendVideo(true); post({ type: 'opened' }); if (!hasChat) post({ type: 'showLoad' }); }
}
function layout() {
  stage.classList.toggle('nochat', !chatOpen);
  stage.classList.toggle('fs', isFs());
  $('bChat').classList.toggle('on', chatOpen);
  const visible = !!cur && chatOpen;
  if (visible !== lastVisible) { lastVisible = visible; post({ type: 'visibility', visible }); }
  const mode = isFs() ? 'side' : 'sidebar';
  const key = mode + '|' + isFs();
  if (key !== layoutKey) { layoutKey = key; post({ type: 'layout', mode, fullscreen: isFs(), ghost: false }); }
  drawHeat();
}
$('bChat').onclick = () => setChat(!chatOpen);
async function toggleFs() {
  try {
    if (isFs()) { await (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
    const f = stage.requestFullscreen || stage.webkitRequestFullscreen;
    if (!f) { toast('Aquí no se puede: gira la pantalla para ver el vídeo y el chat a la vez'); return; }
    await f.call(stage);
    try { await screen.orientation.lock('landscape'); } catch {}
  } catch { toast('No se ha podido poner en pantalla completa'); }
}
$('bFs').onclick = toggleFs;
$('bShare').onclick = async () => {
  let t = 0; try { t = Math.floor(player.getCurrentTime()); } catch {}
  const url = location.href.split('#')[0] + '#/v/' + (cur && cur.vid) + (t > 5 ? '?t=' + t : '');
  try { if (navigator.share && matchMedia('(pointer: coarse)').matches) { await navigator.share({ title: $('vtitle').textContent, url }); return; } await navigator.clipboard.writeText(url); toast('Enlace copiado (en este minuto)'); } catch {}
};
$('fsx').onclick = toggleFs;
document.addEventListener('fullscreenchange', layout);
document.addEventListener('webkitfullscreenchange', layout);
addEventListener('resize', () => drawHeat());

// arrastrar el borde entre el vídeo y el chat
(() => {
  const sp = $('split'); let x0 = 0, w0 = 0;
  sp.addEventListener('pointerdown', e => { x0 = e.clientX; w0 = chatW(); sp.setPointerCapture(e.pointerId); sp.classList.add('drag'); document.body.classList.add('dragging'); });
  sp.addEventListener('pointermove', e => { if (sp.classList.contains('drag')) setChatW(w0 - (e.clientX - x0)); });
  const end = () => { if (!sp.classList.contains('drag')) return; sp.classList.remove('drag'); document.body.classList.remove('dragging'); LS.set('tcr_app_cw', chatW()); drawHeat(); };
  sp.addEventListener('pointerup', end); sp.addEventListener('pointercancel', end);
})();

/* --- Mapa de calor y marcadores (debajo del vídeo; la barra de YouTube incrustado no se puede tocar) --- */
const heat = $('heat');
function drawHeat() {
  const has = cur && barData && (barData.heat || (barData.marks && barData.marks.length));
  heat.hidden = !has;
  if (!has) return;
  const W = heat.clientWidth, H = heat.clientHeight, dpr = window.devicePixelRatio || 1;
  if (!W || !H) return;
  heat.width = Math.round(W * dpr); heat.height = Math.round(H * dpr);
  const ctx = heat.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  const hv = barData.heat;
  if (hv && hv.length) {
    const n = hv.length, top = 2, base = H - 1;
    ctx.beginPath(); ctx.moveTo(0, base);
    let py = base - hv[0] * (base - top); ctx.lineTo(0, py);
    for (let k = 1; k < n; k++) { const x = (k + 0.5) / n * W, y = base - hv[k] * (base - top), px = (k - 0.5) / n * W; ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2); py = y; }
    ctx.lineTo(W, py); ctx.lineTo(W, base); ctx.closePath();
    const gr = ctx.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, 'rgba(62,140,255,.65)'); gr.addColorStop(1, 'rgba(62,140,255,.12)');
    ctx.fillStyle = gr; ctx.fill(); ctx.strokeStyle = 'rgba(143,188,255,.9)'; ctx.lineWidth = 1.2; ctx.stroke();
  }
  let dur = barData.dur; try { dur = dur || player.getDuration(); } catch {}
  if (barData.marks && dur) {
    ctx.fillStyle = '#ffcc4d'; ctx.strokeStyle = 'rgba(0,0,0,.6)';
    for (const t of barData.marks) { const x = Math.round(t / dur * W); ctx.beginPath(); ctx.moveTo(x - 4, 1); ctx.lineTo(x + 4, 1); ctx.lineTo(x + 4, 9); ctx.lineTo(x, 6); ctx.lineTo(x - 4, 9); ctx.closePath(); ctx.fill(); ctx.stroke(); }
  }
  if (dur) { let t = 0; try { t = player.getCurrentTime(); } catch {} ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(Math.round(t / dur * W), 0, 2, H); }
}
heat.addEventListener('click', e => { let d = 0; try { d = (barData && barData.dur) || player.getDuration(); } catch {} if (!d) return; const r = heat.getBoundingClientRect(); player.seekTo((e.clientX - r.left) / r.width * d, true); });
setInterval(() => { if (cur && !heat.hidden) drawHeat(); }, 1000);

/* --- Atajos (los mismos que en YouTube; personalizables en Ajustes → Atajos) --- */
const KEY_DEFAULTS = { toggle: 'Alt+KeyC', back1: 'Alt+Comma', fwd1: 'Alt+Period', back5: 'Alt+Shift+Comma', fwd5: 'Alt+Shift+Period', mark: 'Alt+KeyB', search: 'Ctrl+KeyF', users: 'Alt+KeyU' };
let SET = {};
loadSettings().then(s => { SET = s; }); onSettings(s => { SET = s; });
function keyCombo(e) {
  if (!e.code || ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'OS'].includes(e.key)) return null;
  const p = []; if (e.ctrlKey) p.push('Ctrl'); if (e.altKey) p.push('Alt'); if (e.shiftKey) p.push('Shift'); if (e.metaKey) p.push('Meta');
  p.push(e.code); return p.join('+');
}
function handleKey(code, alt) {
  if (alt && code === 'KeyC') { setChat(!chatOpen); return; }
  if (!player || !cur) return;
  const t = () => player.getCurrentTime() || 0;
  switch (code) {
    case 'Space': case 'KeyK': player.getPlayerState() === 1 ? player.pauseVideo() : player.playVideo(); break;
    case 'KeyJ': player.seekTo(Math.max(0, t() - 10), true); break;
    case 'KeyL': player.seekTo(t() + 10, true); break;
    case 'ArrowLeft': player.seekTo(Math.max(0, t() - 5), true); break;
    case 'ArrowRight': player.seekTo(t() + 5, true); break;
    case 'KeyM': player.isMuted() ? player.unMute() : player.mute(); break;
    case 'KeyF': toggleFs(); break;
  }
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('modal').hidden) { closeModal(); return; }
  if (e.key === 'Escape' && !$('sheet').hidden) { closeSheet(); return; }
  const tg = e.target;
  if (tg && tg.closest && tg.closest('input, textarea, [contenteditable=""], [contenteditable="true"]')) return;
  if (!cur) { if (e.key === '/' ) { e.preventDefault(); $('q').focus(); } return; }
  const combo = keyCombo(e);
  if (!combo) return;
  const B = { ...KEY_DEFAULTS, ...(SET.keys || {}) };
  const id = Object.keys(B).find(k => B[k] && B[k] === combo);
  if (id) {
    e.preventDefault(); e.stopPropagation();
    if (id === 'toggle') setChat(!chatOpen);
    else if (id === 'settings') openModal('');
    else { if (!chatOpen && id !== 'redownload') setChat(true); post({ type: 'action', id }); }
    return;
  }
  if (!e.ctrlKey && !e.altKey && !e.metaKey && ['Space', 'KeyK', 'KeyJ', 'KeyL', 'ArrowLeft', 'ArrowRight', 'KeyM', 'KeyF'].includes(e.code)) { e.preventDefault(); handleKey(e.code, false); }
}, true);

/* ===================================================================== */
/*  Ajustes de la extensión (la misma ventana de siempre)                */
/* ===================================================================== */
let mport = null, mloaded = false, mSection = '';
function openModal(section) {
  mSection = section || '';
  const modal = $('modal'), mf = $('mframe');
  if (!mloaded) {
    mloaded = true;
    mf.addEventListener('load', () => { const ch = new MessageChannel(); mport = ch.port1; mport.onmessage = e => onModal(e.data); mf.contentWindow.postMessage({ type: 'tcr-init' }, location.origin, [ch.port2]); });
    mf.src = EXT + 'app.html#sid=' + SID + (mSection ? '&section=' + mSection : '');
  } else if (mport) try { mport.postMessage({ type: 'open', section: mSection }); } catch {}
  const parent = document.fullscreenElement || document.body;
  if (modal.parentNode !== parent) parent.append(modal);
  modal.hidden = false;
  requestAnimationFrame(() => { modal.classList.add('open'); try { mf.focus(); } catch {} });
}
function closeModal() {
  const modal = $('modal'); if (modal.hidden) return;
  modal.classList.remove('open'); setTimeout(() => { if (!modal.classList.contains('open')) modal.hidden = true; }, 180);
}
function onModal(m) {
  if (!m) return;
  if (m.type === 'close') closeModal();
  else if (m.type === 'seek' && player && cur) player.seekTo(Math.max(0, m.t), true);
  else if (m.type === 'showChat') setChat(true);
  else if (m.type === 'reloadPage') setTimeout(() => location.reload(), m.ms || 1400);
}
$('modal').addEventListener('mousedown', e => { if (e.target === $('modal')) closeModal(); });
$('bSettings').onclick = () => openModal('');

/* ===================================================================== */
/*  Hojas: añadir vídeo, menú, clave                                     */
/* ===================================================================== */
function sheet(...kids) { const s = $('sheet'); s.replaceChildren(h('div', { class: 'sh' }, ...kids)); s.hidden = false; const i = s.querySelector('input'); if (i) setTimeout(() => i.focus(), 40); }
function closeSheet() { $('sheet').hidden = true; }
$('sheet').addEventListener('mousedown', e => { if (e.target === $('sheet')) closeSheet(); });
const vidOf = s => { s = (s || '').trim(); if (/^[\w-]{11}$/.test(s)) return s; try { const u = new URL(s); if (/youtu\.be$/.test(u.hostname)) return u.pathname.slice(1, 12); const v = u.searchParams.get('v'); if (v) return v; const m = u.pathname.match(/\/(?:shorts|live|embed)\/([\w-]{11})/); if (m) return m[1]; } catch {} return null; };

function openAdd() {
  const inp = h('input', { class: 'inp', placeholder: 'https://www.youtube.com/watch?v=…', inputmode: 'url' });
  const err = h('div', { class: 'err' });
  const ok = () => { const v = vidOf(inp.value); if (!v) { err.textContent = 'No reconozco ese enlace de YouTube.'; return; } closeSheet(); go('#/v/' + v); };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
  sheet(h('h3', { text: 'Añadir un vídeo' }),
    h('p', { text: 'Pega el enlace del vídeo de YouTube. Se abre con el chat igual que con la extensión: si en tu Drive hay un chat con el mismo título se pone solo y, si no, puedes elegirlo en el chat. En cuanto tenga chat aparecerá en el inicio.' }),
    inp, err,
    h('div', { class: 'acts' }, h('button', { class: 'btn', onclick: closeSheet }, 'Cancelar'), h('button', { class: 'btn p', onclick: ok }, 'Abrir')));
}
function openLinkPending(g) {
  const inp = h('input', { class: 'inp', placeholder: 'Enlace del vídeo de YouTube' });
  const err = h('div', { class: 'err' });
  const ok = async () => { const v = vidOf(inp.value); if (!v) { err.textContent = 'No reconozco ese enlace de YouTube.'; return; } await linkGroup(v, '', g); pending = pending.filter(p => p.g !== g); closeSheet(); await loadCatalog(); await fillMeta(); await loadCatalog(); toast('Chat unido al vídeo'); go('#/v/' + v); };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
  sheet(h('h3', { text: 'Unir el chat a un vídeo' }), h('p', null, 'Chat: ', h('b', { text: g.name }), g.files.length > 1 ? ` (${g.files.length} partes)` : ''), inp, err,
    h('div', { class: 'acts' }, h('button', { class: 'btn', onclick: closeSheet }, 'Cancelar'), h('button', { class: 'btn p', onclick: ok }, 'Unir y abrir')));
}
function openKey() {
  const inp = h('input', { class: 'inp', placeholder: 'AIza…', value: LS.get('tcr_api_key_user', '') || '', spellcheck: 'false', autocomplete: 'off' });
  const out = h('div', { class: 'err' });
  const save = async () => {
    LS.set('tcr_api_key_user', inp.value.trim()); syncKey(); renderSoon();
    out.style.color = 'var(--muted)'; out.textContent = 'Probando…';
    try {
      await ytApi('videos', { part: 'id', id: 'dQw4w9WgXcQ' });
      const S = await loadSettings();
      if (S.driveFolder) await getFolderFiles(S.driveFolder, { force: true });
      out.style.color = '#7fd3a0'; out.textContent = '✓ Funciona: Drive y YouTube responden.';
      detect({ force: true }); fillMeta().then(loadCatalog).then(renderSoon);
    } catch (e) { out.style.color = ''; out.textContent = '✕ ' + e.message; }
  };
  sheet(h('h3', { text: 'Clave de Google' }),
    h('p', null, 'La app la usa para leer los chats de tu carpeta de Drive y para encontrar en YouTube los vídeos con el mismo título. Es gratis. ', CFG.apiKey ? 'Ya hay una puesta en config.js; aquí puedes poner otra solo para este dispositivo.' : 'Lo mejor es ponerla en config.js (así vale para todos); aquí la puedes probar en este dispositivo.'),
    inp, out,
    h('div', { class: 'acts' }, h('button', { class: 'btn', onclick: closeSheet }, 'Cerrar'), h('button', { class: 'btn p', onclick: save }, 'Guardar y probar')));
}
let installEvt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });
function openMenu() {
  const mi = (icon, t, sub, fn) => h('button', { class: 'mi', onclick: () => { closeSheet(); fn(); } }, h('span', { class: 'ico', text: icon }), h('div', null, t, sub ? h('small', { text: sub }) : null));
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  sheet(h('div', { class: 'brand' }, h('img', { src: 'icons/icon-192.png', alt: '' }), h('div', null, h('h3', { style: 'margin:0', text: 'YTVOD' }), h('div', { class: 'sign', text: 'HECHO POR @BYALVARO__' }))),
    mi('＋', 'Añadir un vídeo', 'Pega un enlace de YouTube', openAdd),
    mi('🔎', 'Buscar vídeos nuevos ahora', 'Mira tu Drive y busca en YouTube los títulos idénticos', async () => { toast('Buscando vídeos nuevos…'); const c = await detect({ force: true }); toast(c ? 'Hay vídeos nuevos en el inicio' : 'No hay vídeos nuevos'); }),
    bridgeV ? mi('⇄', 'Traer todo de la extensión', 'Cuentas, ajustes, sincronización y chats de Chat Replay ' + bridgeV, () => importFromExtension(false)) : null,
    mi('🔑', 'Clave de Google', apiKey() ? 'Puesta ✓' : 'Falta: la app la necesita para leer Drive', openKey),
    !standalone ? mi('⬇', 'Instalar la app', installEvt ? 'Se queda como una aplicación más' : (/iPad|iPhone|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document ? 'Compartir → Añadir a pantalla de inicio' : 'Menú del navegador → Instalar YTVOD'), async () => { if (installEvt) { installEvt.prompt(); installEvt = null; } else toast(/iPad|iPhone/.test(navigator.userAgent) || 'ontouchend' in document ? 'En Safari: botón Compartir → «Añadir a pantalla de inicio»' : 'En Chrome o Edge: menú ⋮ → «Instalar YTVOD»', 5000); }) : null,
    mi('ⓘ', 'Acerca de', `App ${APP_V} · Chat ${chrome.runtime.getManifest().version}`, openAbout));
}
function openAbout() {
  sheet(h('div', { class: 'brand' }, h('img', { src: 'icons/icon-192.png', alt: '' }), h('h3', { style: 'margin:0', text: 'YTVOD' })),
    h('div', { class: 'kv' }, h('b', { text: 'App' }), APP_V, h('b', { text: 'Chat (extensión)' }), chrome.runtime.getManifest().version, h('b', { text: 'Vídeos con chat' }), String(catalog.length), h('b', { text: 'Búsquedas hoy' }), `${(CFG.searchesPerDay || 40) - quotaLeft()} de ${CFG.searchesPerDay || 40}`),
    h('p', { text: 'Se actualiza sola: cada vez que subes una versión nueva de la extensión o de la app a GitHub, la app la coge al abrirla (en el PC, el iPad y el móvil).' }),
    h('p', { class: 'sign', text: 'HECHO POR @BYALVARO__' }),
    h('div', { class: 'acts' }, h('button', { class: 'btn', onclick: closeSheet }, 'Cerrar')));
}
$('bAdd').onclick = openAdd;
$('bMenu').onclick = openMenu;

/* ===================================================================== */
/*  Traer todo de la extensión (cuentas, ajustes, sincronización, chats) */
/* ===================================================================== */
const EXT_ID = CFG.extensionId || 'heimiajbpknkogchnefpcdelmgmenhgd';
const EXT_ORIGIN = 'chrome-extension://' + EXT_ID;
let bridge = null, bridgeV = null, bridgeWait = null;
function startBridge() {
  if (!/Chrome|Edg\//.test(navigator.userAgent) || /Mobile|Android|iPad|iPhone/.test(navigator.userAgent)) return;
  bridge = h('iframe', { src: EXT_ORIGIN + '/bridge.html', style: 'display:none', title: 'Chat Replay' });
  document.body.append(bridge);
}
addEventListener('message', e => {
  if (e.origin !== EXT_ORIGIN || !bridge || e.source !== bridge.contentWindow) return;
  const d = e.data || {};
  if (d.type === 'tcr-bridge-hello') {
    bridgeV = d.version;
    if (!LS.get('tcr_app_imported', null)) importFromExtension(true);
  } else if ((d.type === 'tcr-bridge-data' || d.type === 'tcr-bridge-error') && bridgeWait && bridgeWait.id === d.id) {
    const w = bridgeWait; bridgeWait = null; d.type === 'tcr-bridge-data' ? w.res(d) : w.rej(new Error(d.message));
  }
});
async function importFromExtension(auto) {
  if (!bridgeV) { toast('No encuentro la extensión Chat Replay 1.9 o más nueva en este navegador'); return; }
  toast('Trayendo tus cuentas, ajustes y chats de la extensión…', 6000);
  try {
    const id = Math.random().toString(36).slice(2);
    const d = await new Promise((res, rej) => { bridgeWait = { id, res, rej }; bridge.contentWindow.postMessage({ type: 'tcr-bridge-export', id, withChats: true }, EXT_ORIGIN); setTimeout(() => { if (bridgeWait && bridgeWait.id === id) { bridgeWait = null; rej(new Error('la extensión no ha contestado')); } }, 120000); });
    let skipped = 0;
    for (const [k, v] of Object.entries(d.local || {})) { try { await chrome.storage.local.set({ [k]: v }); } catch { skipped++; } }
    for (const [k, v] of Object.entries(d.sync || {})) { try { await chrome.storage.sync.set({ [k]: v }); } catch { skipped++; } }
    for (const c of d.chats || []) {
      const info = (d.infos || []).find(i => i.key === c.key) || { key: c.key, title: 'Chat', savedAt: Date.now() };
      try { await DB.saveChat(c.key, c.data, info, null); } catch { skipped++; }
    }
    for (const l of d.links || []) if (l && l.vid) { try { await DB.put('links', l.vid, l); } catch { skipped++; } }
    LS.set('tcr_app_imported', { at: Date.now(), version: d.version });
    const acc = d.local && d.local.tcr_account;
    toast(`✓ Traído de la extensión: ${(d.links || []).length} vídeos, ${(d.chats || []).length} chats${acc ? ', cuenta ' + acc.name : ''}${skipped ? ` (${skipped} cosas no cabían)` : ''}`, 5000);
    setTimeout(() => location.reload(), 2200);
  } catch (e) { if (!auto) toast('No se ha podido traer: ' + e.message, 5000); else console.warn(e); }
}

/* ===================================================================== */
/*  Actualizaciones automáticas                                          */
/* ===================================================================== */
let APP_V = '?', APP_INFO = {};
const EXT_V = chrome.runtime.getManifest().version;
async function fetchJson(u) { const r = await fetch(u + (u.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw new Error(r.status); return r.json(); }
async function checkUpdate() {
  let a, e;
  try { [a, e] = await Promise.all([fetchJson('version.json'), fetchJson(EXT + 'manifest.json')]); } catch { return; }
  if (a.version === APP_V && e.version === EXT_V) return;
  let summary = a.version !== APP_V ? a.resumen : '';
  if (!summary) { try { summary = (await fetchJson(EXT + '../version.json')).resumen || ''; } catch {} }
  const info = { from: `${APP_V} · ${EXT_V}`, to: `${a.version} · ${e.version}`, summary, at: Date.now() };
  const apply = () => {
    try { sessionStorage.setItem('tcr_app_updated', JSON.stringify(info)); } catch {}
    let t = 0; try { t = cur && player ? Math.floor(player.getCurrentTime()) : 0; } catch {}
    if (cur) location.hash = `#/v/${cur.vid}?t=${t}`;
    setTimeout(() => location.reload(), 50);
  };
  // en el inicio se actualiza sola; viendo un vídeo, pregunta
  if (!cur && $('sheet').hidden && $('modal').hidden && document.activeElement !== $('q')) { apply(); return; }
  const u = $('upd');
  u.className = ''; u.replaceChildren(h('div', { class: 't' }, h('span', { class: 'ic', text: '↓' }), 'Hay una versión nueva'), summary ? h('div', { class: 'sum', text: '✨ ' + summary }) : null,
    h('div', { class: 'a' }, h('button', { class: 'btn sm', onclick: () => { u.hidden = true; } }, 'Más tarde'), h('button', { class: 'btn sm p', onclick: apply }, 'Actualizar (sigue en este minuto)')));
  u.hidden = false;
}
function showUpdated() {
  let info = null; try { info = JSON.parse(sessionStorage.getItem('tcr_app_updated') || 'null'); sessionStorage.removeItem('tcr_app_updated'); } catch {}
  if (!info) return;
  const u = $('upd');
  u.className = 'ok'; u.replaceChildren(h('div', { class: 't' }, h('span', { class: 'ic', text: '✓' }), 'YTVOD actualizado'), info.summary ? h('div', { class: 'sum', text: '✨ ' + info.summary }) : null);
  u.hidden = false; setTimeout(() => { u.hidden = true; }, 9000);
}

/* ===================================================================== */
/*  Arranque                                                             */
/* ===================================================================== */
// si la sincronización llega de ByAlvaro o de otro chat, se refresca el catálogo
let refT = 0;
const refreshSoon = () => { clearTimeout(refT); refT = setTimeout(async () => { await loadCatalog(); if (await fillMeta()) await loadCatalog(); renderSoon(); }, 400); };
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && (ch.tcr_follow || ch.tcr_settings)) refreshSoon(); });
chrome.runtime.onMessage.addListener(m => { if (m && (m.t === 'tcr-links' || m.t === 'tcr-links-updated')) refreshSoon(); });

// la app de Windows (ChatReplay.exe) se cierra sola cuando cierras la ventana
if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) setInterval(() => fetch('/__ping', { cache: 'no-store' }).catch(() => {}), 15000), fetch('/__ping').catch(() => {});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('../sw.js', { scope: '../' }).catch(() => {});

startBridge();
(async () => {
  try { APP_INFO = await fetchJson('version.json'); APP_V = APP_INFO.version || '?'; } catch {}
  showUpdated();
  await loadCatalog();
  onRoute();
  if (await fillMeta()) { await loadCatalog(); renderSoon(); }
  // deja que el segundo plano traiga antes la configuración de ByAlvaro (así no se busca lo que él ya encontró)
  setTimeout(async () => { await loadCatalog(); await detect(); }, 3500);
  setInterval(checkUpdate, 10 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });
  setTimeout(checkUpdate, 20000);
})();
