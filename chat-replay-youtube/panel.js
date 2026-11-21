// ===== Chat Replay · panel del chat (iframe dentro de YouTube) =====
import { DEFAULTS, loadSettings, saveSettings, onSettings, FONT_STACKS } from './shared/settings.js';
import * as DB from './shared/db.js';
import { Sound } from './shared/sounds.js';
import { parseClock, fmtJump } from './shared/util.js';
import { SEP, fmtTime, fmtSigned, fmtNum, h, debounce, ICONS, highlightInto, escapeRe, titleScore } from './shared/util.js';
import { loadFonts } from './shared/util.js';
loadFonts();
import { parseLink, getFolderFiles } from './shared/drive.js';
import { loadChat, chatKeyOf, estimateSize } from './shared/loader.js';
import { groupFiles, mergeChats, partOf, rawToMerged, mergedToRaw } from './shared/parts.js';
import { parseTwitchLinks, assignLinks } from './shared/twlinks.js';
import { vodsOf, partPlan } from './shared/sincro.js';
import { bindings, comboOf } from './shared/keys.js';

const app = document.getElementById('app');
app.innerHTML = app.innerHTML.replace(/%(\w+)%/g, (m, k) => ICONS[k] || '');
const $ = id => document.getElementById(id);
const chatEl = $('chat'), list = $('list'), resumeBtn = $('resume'), emptyEl = $('empty');
const graphWrap = $('graphWrap'), graphCv = $('graph'), graphMark = $('graphMark'), graphTip = $('graphTip');
const popEl = $('pop'), warnEl = $('warn'), chipEl = $('chip');

const SID = new URLSearchParams(location.hash.slice(1)).get('sid') || 'solo';
const bc = new BroadcastChannel('tcr-' + SID);

let S = { ...DEFAULTS };
let port = null;
const st = { vid: null, ytTitle: '', ytChannel: '', ytDuration: 0, mode: 'sidebar', fullscreen: false };
const clock = { t: 0, rate: 1, paused: true, at: performance.now() };
let chat = null, link = null;
let sync = { base: 0, scale: 1, segs: [{ a: 0, off: 0 }], status: 'none', remaining: 0, chatStart: 0, chatEnd: 0, range: 0, delta: 0, cuts: [], mode: 'auto' };
let curPart = null;
let cursor = 0, lastNow = null, paused = false, hoverPaused = false, newWhilePaused = 0, pendingFlash = -1;
let loadTok = 0, loading = null, pickMode = null;
let drive = { files: null, error: null, busy: false, triedFor: null };
const filt = { hideU: new Set(), bw: [], hw: [], meRe: null, needText: false };
let tokens = 0, tokenAt = performance.now();

/* ---------- Comunicación ---------- */
function send(m) { if (port) try { port.postMessage(m); } catch {} }
window.addEventListener('message', e => {
  if (e.source !== window.parent || (e.origin !== 'https://www.youtube.com' && !(globalThis.__TCR_WEB && e.origin === location.origin))) return;
  const d = e.data;
  if (d && d.type === 'tcr-init' && e.ports && e.ports[0]) {
    port = e.ports[0];
    port.onmessage = ev => onHost(ev.data);
    send({ type: 'ready' });
  }
});
function onHost(m) {
  if (!m) return;
  switch (m.type) {
    case 'video': onVideo(m); break;
    case 'time':
      clock.t = m.t; clock.rate = m.rate || 1; clock.paused = !!m.paused; clock.at = performance.now();
      break;
    case 'layout':
      ignoreScrollUntil = performance.now() + 800;
      if (paused) resume();
      st.mode = m.mode; st.fullscreen = !!m.fullscreen; app.dataset.mode = m.mode;
      app.classList.toggle('ghost', !!m.ghost);
      requestAnimationFrame(() => { buildGraph(); if (!paused) scrollBottom(0); });
      break;
    case 'nudge': nudge(m.d); break;
    case 'mark': if (S.bookmarks) addMark(''); break;
    case 'action': runAction(m.id); break;
    case 'opened': onOpened(); break;
    case 'visibility':
      visible = !!m.visible;
      if (visible) { lastNow = null; requestAnimationFrame(() => { buildGraph(); scrollBottom(0); }); }
      break;
    case 'showLoad': if (!chat) { const i = emptyEl.querySelector('input.inp'); if (i) setTimeout(() => i.focus(), 50); } break;
  }
}
function sendStatus(hasChat, reason) { send({ type: 'status', vid: st.vid, hasChat, reason }); }

let bcT = 0;
function broadcastState() {
  if (bcT) return;
  bcT = setTimeout(() => { bcT = 0; try { bc.postMessage(stateMsg()); } catch {} }, 80);
}
function stateMsg() {
  return {
    t: 'state', s: {
      vid: st.vid, ytTitle: st.ytTitle, ytDuration: st.ytDuration, ytNow: ytNow(),
      hasChat: !!chat, chatKey: chat ? chat.key : null, chatKeys: chat ? chat.keys : null, meta: chat ? { ...chat.meta } : null,
      link: link ? JSON.parse(JSON.stringify(link)) : null,
      sync: chat ? { mode: sync.mode, delta: sync.delta, cuts: sync.cuts, status: sync.status, remaining: sync.remaining, chatStart: sync.chatStart, chatEnd: sync.chatEnd, scale: sync.scale, tol: sync.tol, gaps: gapsOf(link), partsYt: chat.meta.parts ? chat.meta.parts.map(p => ytOf(p.at)) : null, partsInfo: chat.meta.parts ? chat.meta.parts.map(p => ({ n: p.n, vodId: p.vodId, rawEnd: p.rawEnd, name: p.name, dur: p.dur, count: p.count, countAll: p.countAll, rawStart: p.rawStart, off: p.off || 0, from: p.from, to: p.to, atYt: ytOf(p.at), endYt: ytOf(p.end), cuts: (p.cuts || []).map(c => ({ at: c.at, jump: c.jump, yt: partCutYt(p, c) })) })) : null, canRedownload: !!(link && link.srcs && link.srcs.length), curPart } : null,
      loading: loading ? { stage: loading.stage, p: loading.p, name: loading.name } : null
    }
  };
}
bc.onmessage = e => {
  const m = e.data || {};
  switch (m.t) {
    case 'getState': broadcastState(); break;
    case 'load': loadSources([m.src], { force: true }); break;
    case 'link': linkChat(m.chatKeys || m.chatKey); break;
    case 'loadGroup': loadSources(m.srcs, { force: !!m.force }); break;
    case 'refresh': loadSources(m.srcs, { force: true, noLink: true }); break;
    case 'unlink': if (st.vid) DB.get('links', st.vid).then(l => l && DB.put('links', st.vid, { ...l, detached: true, noAuto: true })).then(() => loadForVideo(st.vid)); break;
    case 'sync': if (link) { Object.assign(link.sync, m.patch); saveLink(); } break;
    case 'cutHere': cutHere(m.jump); break;
    case 'importCuts': importCuts(m.plan); break;
    case 'gap': setGap(m.k, m.v); break;
    case 'part': setPart(m.k, m.patch || {}); break;
    case 'partCut': addPartCut(m.k, m.at, m.jump); break;
    case 'redownload': redownload(); break;
    case 'twitchLinks': applyTwitch(m.text); break;
    case 'addCut': addCut(m.at, m.jump); break;
    case 'editCut': editCut(m.i, m.at, m.jump); break;
    case 'delCut': if (link && link.sync.cuts) { link.sync.cuts.splice(m.i, 1); saveLink(); } break;
    case 'pick': startPick(m.mode); break;
    case 'seek': seek(m.yt); break;
    case 'reload': loadForVideo(st.vid); break;
    case 'cancelLoad': if (loading) loading.ctrl.abort(); break;
    case 'driveRefresh': drive.files = null; drive.triedFor = null; if (!chat) refreshDrive(true); break;
  }
};

/* ---------- Configuración de ByAlvaro / cuenta ---------- */
try {
  chrome.runtime.sendMessage({ t: 'feed-soft' }).catch(() => {});
  // si la sincronización de este vídeo ha llegado de tu cuenta o de ByAlvaro, se vuelve a cargar
  chrome.runtime.onMessage.addListener(m => { if (m && m.t === 'tcr-links-updated' && st.vid && (m.vids || []).includes(st.vid) && !loading) loadForVideo(st.vid); });
} catch {}

/* ---------- Ajustes ---------- */
const RENDER_KEYS = ['showReplies', 'deletedMode', 'showRoleStreamer', 'showRoleMod', 'showRoleVip', 'showRoleSub', 'showRoleOther', 'showEmoteOnly', 'showBadges', 'showTimestamps', 'emoteScale', 'readableColors', 'chatTheme', 'animatedEmotes', 'myName', 'highlightWords', 'blockedWords', 'blockedUsers', 'hideBots', 'hideNotices', 'maxMessages'];
function apply(prev) {
  const r = document.documentElement.style;
  r.setProperty('--fs', S.fontSize + 'px');
  r.setProperty('--emote-h', Math.round(28 * S.emoteScale) + 'px');
  r.setProperty('--gap', S.msgGap + 'px');
  r.setProperty('--ov', S.overlayBg);
  r.setProperty('--chat-font', FONT_STACKS[S.chatFont] || FONT_STACKS.serif);
  r.setProperty('--ui-font', FONT_STACKS[S.uiFont] || FONT_STACKS.sans);
  app.dataset.theme = S.chatTheme;
  app.classList.toggle('alt', !!S.altBg);
  app.classList.toggle('sep', !!S.separators);
  app.classList.toggle('shadow', !!S.textShadow);
  app.classList.toggle('autohide', !!S.autoHideHeader);
  app.classList.toggle('bold', !!S.boldNames);
  app.classList.toggle('reduced', S.motion === 'reduced');
  app.classList.toggle('motion-system', S.motion !== 'reduced');
  document.querySelector('[data-act="marks"]').hidden = !S.bookmarks;
  document.querySelector('[data-act="filter"]').classList.toggle('on', !allRolesOn());
  if (!S.emoteCombo) hideCombo(true);
  if (prev && (prev.ytHeatmap !== S.ytHeatmap || prev.bookmarks !== S.bookmarks)) { sendBar(); buildGraph(); }
  Sound.fromSettings(S);
  colorCache.clear();
  if (prev && chat) {
    if (RENDER_KEYS.some(k => prev[k] !== S[k])) { prepFilters(); lastNow = null; }
    if (prev.showGraph !== S.showGraph || prev.chatTheme !== S.chatTheme) buildGraph();
  }
  if (prev && prev.driveFolder !== S.driveFolder) { drive = { files: null, error: null, busy: false, triedFor: null }; if (!chat) refreshDrive(true); }
}
function setS(k, v) { setMany({ [k]: v }); }
function setMany(o) { const prev = S; S = { ...S, ...o }; apply(prev); saveSettings(S); }
onSettings(n => { const prev = S; if (JSON.stringify(prev) === JSON.stringify(n)) return; S = n; apply(prev); });

/* ---------- Reloj / sincronización ---------- */
function ytNow() { let t = clock.t; if (!clock.paused) t += Math.min((performance.now() - clock.at) / 1000, 2.5) * clock.rate; return t; }
function chatAt(yt) { const s = sync.segs; let off = s[0].off; for (let k = 1; k < s.length; k++) { if (yt >= s[k].a) off = s[k].off; else break; } return yt * sync.scale + off; }
function ytOf(T) {
  const s = sync.segs, sc = sync.scale;
  for (let k = 0; k < s.length; k++) {
    const a = k === 0 ? -Infinity : s[k].a, b = k + 1 < s.length ? s[k + 1].a : Infinity;
    if (T >= a * sc + s[k].off && T < b * sc + s[k].off) return (T - s[k].off) / sc;
  }
  return null;
}
const chatNow = () => chatAt(ytNow());

function computeSync() {
  if (!chat) return;
  const m = chat.meta;
  const chatStart = m.start || 0;
  const chatEnd = m.end > 0 ? m.end : (m.length > 0 ? m.length : m.lastT);
  const full = m.length > 0 ? m.length : chatEnd;
  const ls = (link && link.sync) || { mode: 'auto', delta: 0, cuts: [] };
  const mode = ls.mode || 'auto', yd = st.ytDuration;
  const range = Math.max(1, chatEnd - chatStart), tol = Math.max(4, Math.min(15, range * 0.00025));
  let base = chatStart, scale = 1, status = 'manual';
  if (mode === 'auto') {
    if (!yd) status = 'wait';
    else if (Math.abs(yd - range) <= tol) status = 'ok';
    else if (chatStart > 0 && Math.abs(yd - full) <= tol) { base = 0; status = 'ok'; }
    else status = 'mismatch';
  } else if (mode === 'end') { if (yd) base = chatEnd - yd; }
  else if (mode === 'stretch') { if (yd) scale = range / yd; }
  const delta = ls.delta || 0;
  const cuts = (ls.cuts || []).slice().sort((a, b) => a.at - b.at);
  const segs = [{ a: 0, off: base + delta }]; let acc = base + delta;
  for (const c of cuts) { acc += c.jump; segs.push({ a: c.at, off: acc }); }
  const remaining = yd ? chatEnd - (yd * scale + acc) : 0;
  if (status === 'mismatch' && Math.abs(remaining) <= tol) status = 'fixed';
  sync = { base, scale, segs, status, remaining, chatStart, chatEnd, range, delta, cuts, mode, tol };
  lastNow = null;
  renderChip(); renderWarn(); buildGraph(); sendBar(); updateMarksBtn(); broadcastState();
}
const saveLinkDb = debounce(() => { if (link && link.vid) DB.put('links', link.vid, link).catch(() => {}); }, 300);
function sortCuts() { if (link && link.sync && link.sync.cuts) link.sync.cuts.sort((a, b) => a.at - b.at); }
/** Salto manual: en el segundo «at» del vídeo, el chat salta «jump» segundos (positivo = adelante) */
function addCut(at, jump) {
  if (!chat || !link) return false;
  at = Math.max(0, Math.round(at * 10) / 10); jump = Math.round(jump * 10) / 10;
  if (!isFinite(at) || !isFinite(jump) || !jump) { toast('Escribe un minuto y un salto válidos.'); Sound.play('error'); return false; }
  (link.sync.cuts = link.sync.cuts || []).push({ at, jump });
  Sound.play('toggle'); saveLink();
  toast(`✂ Salto en ${fmtTime(at)}: el chat ${jump > 0 ? 'avanza' : 'retrocede'} ${fmtTime(Math.abs(jump))}`);
  return true;
}
function editCut(i, at, jump) {
  const c = link && link.sync.cuts && link.sync.cuts[i];
  if (!c) return;
  if (isFinite(at)) c.at = Math.max(0, Math.round(at * 10) / 10);
  if (isFinite(jump) && jump) c.jump = Math.round(jump * 10) / 10;
  Sound.play('tick'); saveLink();
}
function saveLink() { sortCuts(); computeSync(); saveLinkDb(); if (!popEl.hidden && popEl.dataset.kind === 'sync') openSync(); }
function nudge(d) {
  if (!chat || !link) return;
  link.sync.delta = Math.round(((link.sync.delta || 0) + d) * 10) / 10;
  Sound.play('tick'); saveLink(); toast(`Desfase del chat: ${fmtSigned(link.sync.delta)}`);
}
function cutHere(jump) {
  if (!chat || !link) return;
  if (jump == null) jump = sync.remaining;
  jump = Math.round(jump * 10) / 10;
  if (!jump) { toast('No falta tiempo por compensar: usa «Corte con un mensaje».'); return; }
  const at = Math.round(ytNow() * 10) / 10;
  (link.sync.cuts = link.sync.cuts || []).push({ at, jump });
  Sound.play('toggle'); saveLink();
  toast(`✂ Corte en ${fmtTime(at)}: el chat salta ${fmtSigned(jump)}`);
}
/** Sincronización pegada del «Sincronizador YT-Twitch»: cada tramo es (minuto del directo, minuto del vídeo) */
function importCuts(plan) {
  if (!chat || !link || !plan || !plan.segs || !plan.segs.length) { toast('Abre primero el chat de este vídeo.'); return; }
  const segs = plan.segs.slice().sort((a, b) => a.yt - b.yt);
  const parts = chat.meta.parts && chat.meta.parts.length > 1 ? chat.meta.parts : null;
  const vods = vodsOf(segs);
  const r3 = v => Math.round(v * 1000) / 1000;
  if (vods[vods.length - 1] > 1 && !parts) { toast(`El texto es de ${vods[vods.length - 1]} VODs, pero este vídeo tiene un solo chat. Carga las partes ([[parte1]], [[parte2]]…) y vuelve a pegarlo.`, 7000); Sound.play('error'); return; }
  if (parts && segs.some(x => x.vod)) return importPartsPlan(segs, parts);
  // un solo VOD: desfase + cortes generales (como siempre)
  const offs = segs.map(s => s.tw - s.yt);
  link.sync.mode = 'start';                       // el chat se cuenta desde su inicio: así el desfase es exacto
  link.sync.delta = r3(offs[0] - (chat.meta.start || 0));
  link.sync.cuts = segs.slice(1).map((s, k) => ({ at: r3(s.yt), jump: r3(offs[k + 1] - offs[k]) })).filter(c => c.jump);
  link.manual = true;
  Sound.play('success'); saveLink();
  toast(`Sincronización pegada ✓ · ${link.sync.cuts.length} corte${link.sync.cuts.length === 1 ? '' : 's'}`, 3500);
}
/** Texto del Sincronizador con varios VODs: cada tramo va a su VOD (desde/hasta, posición y saltos propios) */
function importPartsPlan(segs, parts) {
  const r = v => Math.round(v * 1000) / 1000, cs = chat.meta.start || 0;
  const byK = parts.map(() => []), bad = new Set();
  for (const x of segs) { const k = (x.vod || 1) - 1; if (k >= 0 && k < parts.length) byK[k].push(x); else bad.add(x.vod); }
  if (bad.size) { toast(`El texto habla del VOD ${[...bad].join(', ')}, pero el chat solo tiene ${parts.length} partes.`, 6000); Sound.play('error'); return; }
  link.sync.mode = 'start';
  link.sync.delta = r(-cs);          // vídeo 0:00 = línea de tiempo 0
  link.sync.cuts = [];               // el texto lo dice todo: fuera los cortes generales
  link.manual = true;
  const P = (link.sync.parts = (link.sync.parts || []).slice());
  while (P.length < parts.length) P.push({});
  let cursor = 0, nCuts = 0, back = 0;
  const msgs = [];
  parts.forEach((p, k) => {
    const base = p.shift - p.off;
    let c = { ...(P[k] || {}) };
    if (!byK[k].length) {
      // este VOD no sale en el texto: entero (o con su desde/hasta), justo detrás del anterior
      const start = Math.max(p.rawStart, c.from != null ? c.from : p.rawStart), end = Math.min(p.rawEnd, c.to != null ? c.to : p.rawEnd);
      c.off = r(cursor - start - base);
      const jumps = (c.cuts || []).filter(x => x.at >= start && x.at < end).reduce((a, x) => a + x.jump, 0);
      cursor += Math.max(0, end - start - jumps);
    } else {
      const pl = partPlan(byK[k]);
      c = { from: pl.from, to: pl.to, cuts: pl.cuts, off: r(pl.pieces[0].y - pl.pieces[0].a - base) };
      cursor = pl.pieces[pl.pieces.length - 1].y2;
      nCuts += pl.cuts.length; back += pl.repeated;
      msgs.push(`VOD ${k + 1}: ${fmtTime(pl.from)} → ${fmtTime(pl.to)}`);
    }
    if (c.from != null && c.from <= p.rawStart) delete c.from;
    if (c.to != null && c.to >= p.rawEnd) delete c.to;
    if (!c.off) delete c.off;
    if (c.cuts && !c.cuts.length) delete c.cuts;
    P[k] = c;
  });
  Sound.play('success'); saveLinkDb(); remerge(); broadcastState();
  toast(`Sincronización pegada ✓ · ${msgs.join(' · ')}${nCuts ? ` · ${nCuts} salto${nCuts === 1 ? '' : 's'}` : ''}${back > 0.05 ? ` · el trozo repetido (${fmtTime(back)}) sale una vez` : ''}`, 6000);
}
function seek(yt) { if (yt == null || !isFinite(yt)) return; send({ type: 'seek', t: Math.max(0, yt) }); clock.t = Math.max(0, yt); clock.at = performance.now(); lastNow = null; }
function seekToMsg(i) {
  const yt = ytOf(chat.T[i]);
  if (yt == null) { toast('Ese mensaje cae en una parte recortada del vídeo.'); return; }
  pendingFlash = i; seek(Math.max(0, yt - 2.5));
}

function renderChip() {
  if (!chat) { chipEl.hidden = true; return; }
  const map = {
    ok: ['✓ Sincronizado', 'ok'], fixed: ['✓ Ajustado', 'ok'], wait: ['Midiendo vídeo…', ''],
    mismatch: ['⚠ Duración distinta', 'warn'],
    manual: [{ start: 'Inicio', end: 'Final', stretch: 'Estirado', auto: 'Auto' }[sync.mode] + (sync.delta ? ' ' + fmtSigned(sync.delta) : '') + (sync.cuts.length ? ` · ✂${sync.cuts.length}` : ''), '']
  };
  const [txt, cls] = map[sync.status] || map.manual;
  chipEl.textContent = sync.status === 'ok' && (sync.delta || sync.cuts.length) ? `✓ ${fmtSigned(sync.delta)}${sync.cuts.length ? ' · ✂' + sync.cuts.length : ''}` : txt;
  chipEl.className = 'chip ' + cls; chipEl.hidden = false;
}
function renderWarn() {
  warnEl.replaceChildren();
  if (!chat || sync.status !== 'mismatch' || (link && link.sync.warnOff)) { warnEl.hidden = true; return; }
  const diff = sync.remaining;
  warnEl.append(
    h('div', null, h('b', { text: '⚠ El vídeo y el chat no duran lo mismo. ' }),
      `YouTube: ${fmtTime(st.ytDuration)} · Chat: ${fmtTime(sync.range)} (${diff > 0 ? 'faltan' : 'sobran'} ${fmtTime(Math.abs(diff))} en YouTube). `,
      diff > 0 ? 'Si recortaron un trozo, ve al punto donde el chat se desfasa y pulsa «Corte aquí».' : 'Puede que el vídeo tenga intro o pantalla final.'),
    h('div', { class: 'row' },
      diff > 0 && h('button', { class: 'btn primary sm', onclick: () => cutHere() }, `✂ Corte aquí (${fmtSigned(diff)})`),
      h('button', { class: 'btn ghost sm', onclick: () => startPick('delta') }, '🎯 Con un mensaje'),
      h('button', { class: 'btn ghost sm', onclick: () => { link.sync.mode = 'end'; saveLink(); } }, 'Alinear final'),
      h('button', { class: 'btn ghost sm', onclick: () => { link.sync.mode = 'stretch'; saveLink(); } }, 'Estirar'),
      h('button', { class: 'btn ghost sm', onclick: () => { link.sync.warnOff = true; saveLink(); } }, 'Ocultar'))
  );
  warnEl.hidden = false;
}

/* ---------- Carga del chat de cada vídeo ---------- */
async function onVideo(m) {
  const changed = m.vid !== st.vid;
  const titleChanged = !!m.title && m.title !== st.ytTitle;
  st.vid = m.vid || null;
  if (changed) { st.ytTitle = m.title || ''; st.ytChannel = m.channel || ''; }
  else { if (m.title) st.ytTitle = m.title; if (m.channel) st.ytChannel = m.channel; }
  const dur = m.duration > 0 ? m.duration : 0;
  if (changed) { st.ytDuration = dur; await loadForVideo(st.vid); return; }
  if (dur && Math.abs(dur - st.ytDuration) > 0.5) { st.ytDuration = dur; if (chat) computeSync(); else renderEmpty(); }
  if (titleChanged) { if (chat) verifyLink(); else { renderEmpty(); maybeAutoDrive(); } }
  broadcastState();
}
async function loadForVideo(vid) {
  const tok = ++loadTok;
  unloadChat();
  if (!vid) { renderEmpty(); sendStatus(false); return; }
  const lk = await DB.get('links', vid).catch(() => null);
  if (tok !== loadTok) return;
  st.savedSync = lk && hasSync(lk) ? lk : null;
  if (lk && !lk.detached) {
    if (migrateGaps(lk)) DB.put('links', vid, lk).catch(() => {});
    const data = await dataFor(keysOf(lk), lk);
    if (tok !== loadTok) return;
    if (data) { link = lk; link.sync = link.sync || { mode: 'auto', delta: 0, cuts: [] }; setChat(keysOf(lk), data); sendStatus(true); verifyLink(); enforceLimit(); return; }
  }
  link = null; renderEmpty(); sendStatus(false); broadcastState();
  if (lk && (lk.detached || lk.noAuto)) return;   // lo quitaste tú: no se vuelve a cargar solo
  if (lk && lk.srcs && lk.srcs.length && S.driveAuto) { loadSources(lk.srcs, { auto: true }); return; }
  maybeAutoDrive();
}
function unloadChat() {
  if (chat && chat.urls) for (const u of chat.urls) if (u && u.startsWith('blob:')) URL.revokeObjectURL(u);
  if (chat && chat.statics) for (const u of chat.statics) if (u && u.startsWith('blob:')) URL.revokeObjectURL(u);
  chat = null; list.replaceChildren(); cursor = 0; lastNow = null;
  send({ type: 'bar', heat: null, marks: null }); hideCombo(true);
  graphWrap.hidden = true; warnEl.hidden = true; chipEl.hidden = true; closePop(); closeSearch(); stopPick();
  paused = false; resumeBtn.hidden = true;
}
function hasSync(lk) {
  const s = lk.sync || {};
  return !!((s.delta || 0) || (s.cuts && s.cuts.length) || (s.gaps && s.gaps.some(Boolean)) || (s.parts && s.parts.some(p => p && Object.keys(p).length)) || (s.mode && s.mode !== 'auto') || (lk.marks && lk.marks.length));
}
function describeSync(lk) {
  const s = lk.sync || {}, out = [];
  if (s.delta) out.push(`desfase ${fmtSigned(s.delta)}`);
  if (s.cuts && s.cuts.length) out.push(`${s.cuts.length} corte${s.cuts.length > 1 ? 's' : ''}`);
  if (s.gaps && s.gaps.some(Boolean)) out.push('esperas entre partes');
  if (s.parts && s.parts.some(p => p && Object.keys(p).length)) out.push('ajustes por VOD');
  if (s.mode && s.mode !== 'auto') out.push(`modo ${({ start: 'inicio', end: 'final', stretch: 'estirar' })[s.mode] || s.mode}`);
  if (lk.marks && lk.marks.length) out.push(`${lk.marks.length} marcador${lk.marks.length > 1 ? 'es' : ''}`);
  return out.join(', ');
}
const keysOf = lk => (lk && (lk.chatKeys && lk.chatKeys.length ? lk.chatKeys : lk.chatKey ? [lk.chatKey] : [])) || [];
/** Lee de la biblioteca las partes y las une en un solo chat */
async function dataFor(keys, lk) {
  if (!keys.length) return null;
  const list = await Promise.all(keys.map(k => DB.get('chats', k).catch(() => null)));
  if (list.some(d => !d)) return null;
  if (list.length === 1) return list[0];
  const infos = await Promise.all(keys.map(k => DB.get('info', k).catch(() => null)));
  return mergeChats(list, infos.map(i => (i && (i.fileName || i.title)) || ''), gapsOf(lk), pcfgOf(lk));
}
const gapsOf = lk => (lk && lk.sync && lk.sync.gaps) || [];
const pcfgOf = lk => (lk && lk.sync && lk.sync.parts) || [];
/** Antes «Espera antes» movía esa parte y las siguientes: se pasa a ajustes propios de cada parte */
function migrateGaps(lk) {
  const g = lk && lk.sync && lk.sync.gaps;
  if (!g || !g.some(Boolean)) return false;
  const P = (lk.sync.parts = (lk.sync.parts || []).slice());
  let acc = 0;
  for (let k = 1; k < Math.max(g.length, P.length); k++) { acc += +g[k] || 0; if (acc) P[k] = { ...(P[k] || {}), off: Math.round(((+(P[k] || {}).off || 0) + acc) * 10) / 10 }; }
  lk.sync.gaps = [];
  return true;
}
/** Vuelve a unir las partes con los huecos actuales (sin volver a leer la biblioteca) */
const remerge = debounce(() => {
  if (!chat || !chat.src || !link) return;
  const keys = chat.keys;
  const data = mergeChats(chat.src.list, chat.src.names, gapsOf(link), pcfgOf(link));
  if (chat.urls) for (const u of chat.urls) if (u && u.startsWith('blob:')) URL.revokeObjectURL(u);
  if (chat.statics) for (const u of chat.statics) if (u && u.startsWith('blob:')) URL.revokeObjectURL(u);
  setChat(keys, data);
  lastNow = null;
  if (!popEl.hidden && popEl.dataset.kind === 'sync') openSync();
}, 200);
const openParts = new Set(), closedParts = new Set();   // qué VODs dejaste abiertos en el menú
function setPart(k, patch) {
  if (!link || !chat || !chat.meta.parts || !chat.meta.parts[k]) return;
  const P = (link.sync.parts = (link.sync.parts || []).slice());
  while (P.length <= k) P.push({});
  const c = { ...(P[k] || {}), ...patch };
  for (const x of ['off', 'from', 'to']) if (c[x] == null || (x === 'off' && !c[x])) delete c[x]; else c[x] = Math.round(c[x] * 10) / 10;
  if (c.cuts) { c.cuts = c.cuts.filter(x => x && isFinite(x.at) && x.jump).map(x => ({ at: Math.round(x.at * 10) / 10, jump: Math.round(x.jump * 10) / 10 })).sort((a, b) => a.at - b.at); if (!c.cuts.length) delete c.cuts; }
  P[k] = c;
  saveLinkDb(); remerge(); broadcastState();
}
/** Salto dentro de una parte, escrito como «en el minuto X del vídeo» */
function addPartCut(k, ytMin, jump) {
  const p = chat && chat.meta.parts && chat.meta.parts[k];
  if (!p || !isFinite(ytMin) || !isFinite(jump) || !jump) { toast('Escribe un minuto y un salto válidos.'); Sound.play('error'); return false; }
  const raw = mergedToRaw(p, chatAt(ytMin));
  if (raw < p.rawStart - 1 || raw > p.rawEnd + 1) { toast(`En ${fmtTime(ytMin)} del vídeo no se está viendo la parte ${k + 1}.`, 4000); Sound.play('error'); return false; }
  setPart(k, { cuts: [...(p.cuts || []), { at: raw, jump }] });
  Sound.play('toggle'); toast(`Parte ${k + 1}: salto en ${fmtTime(ytMin)} (${jump > 0 ? '+' : '−'}${fmtTime(Math.abs(jump))})`);
  return true;
}
/** Minuto del vídeo en el que ocurre un salto de una parte */
function partCutYt(p, c) {
  const before = p.cuts.filter(x => x.at < c.at).reduce((a, x) => a + x.jump, 0);
  return ytOf(c.at + p.shift - before);
}
/* ---------- Enlaces de Twitch: dónde empieza y acaba cada VOD → se ajusta todo solo ---------- */
function twParts() {
  if (chat.meta.parts && chat.meta.parts.length > 1) return chat.meta.parts.map(p => ({ vodId: p.vodId, rawStart: p.rawStart, rawEnd: p.rawEnd }));
  const m = chat.meta;
  return [{ vodId: m.vodId, rawStart: m.start || 0, rawEnd: m.end > 0 ? m.end : (m.length > 0 ? m.length : m.lastT) }];
}
let twDraft = '', twOpen = false;
function applyTwitch(text) {
  if (!chat || !link) { toast('Abre primero el chat de este vídeo.'); Sound.play('error'); return false; }
  const entries = parseTwitchLinks(text);
  if (!entries.length) { toast('No encuentro enlaces de Twitch (twitch.tv/videos/…).', 3500); Sound.play('error'); return false; }
  const { map, warn } = assignLinks(entries, twParts());
  const r = v => Math.round(v * 1000) / 1000, cs = chat.meta.start || 0;
  const parts = chat.meta.parts && chat.meta.parts.length > 1 ? chat.meta.parts : null;
  const msgs = [];
  link.sync.mode = 'start';          // el chat se cuenta desde su inicio: así el desfase es exacto
  link.manual = true;
  if (!parts) {
    const e = map[0];
    if (!e) { toast(warn[0] || 'Ningún enlace sirve para este chat.', 4000); Sound.play('error'); return false; }
    const start = e.start != null ? e.start : cs;
    link.sync.delta = r(start - (e.yt || 0) - cs);
    msgs.push(`El vídeo empieza en el minuto ${fmtTime(start)} del directo${e.yt ? ` (en ${fmtTime(e.yt)} de YouTube)` : ''}`);
    Sound.play('success'); saveLink();
  } else {
    link.sync.delta = r(-cs);         // vídeo 0:00 = línea de tiempo 0: cada VOD se coloca con su «Mover»
    const P = (link.sync.parts = (link.sync.parts || []).slice());
    while (P.length < parts.length) P.push({});
    let cursor = 0;
    parts.forEach((p, k) => {
      const e = map[k], c = { ...(P[k] || {}) };
      if (e) {
        if (e.start != null) c.from = e.start; else delete c.from;
        if (e.end != null) c.to = e.end; else delete c.to;
      }
      const start = Math.max(p.rawStart, c.from != null ? c.from : p.rawStart);
      const end = Math.min(p.rawEnd, c.to != null ? c.to : p.rawEnd);
      const target = e && e.yt != null ? e.yt : cursor;     // si no se dice, justo detrás del VOD anterior
      c.off = r(target - start - (p.shift - p.off));
      if (c.from != null && c.from <= p.rawStart) delete c.from;
      if (c.to != null && c.to >= p.rawEnd) delete c.to;
      if (!c.off) delete c.off;
      const jumps = (c.cuts || []).filter(x => x.at >= start && x.at < end).reduce((a, x) => a + x.jump, 0);
      cursor = Math.max(cursor, target + Math.max(0, end - start - jumps));
      P[k] = c;
      if (e) msgs.push(`VOD ${k + 1}: ${fmtTime(start)} → ${fmtTime(end)} (en el vídeo ${fmtTime(target)} → ${fmtTime(target + Math.max(0, end - start - jumps))})`);
    });
    Sound.play('success'); saveLinkDb(); remerge(); broadcastState();
  }
  toast('Ajustado con Twitch ✓ · ' + msgs.join(' · ') + (warn.length ? ' · ⚠ ' + warn.join(' ') : ''), warn.length ? 8000 : 5000);
  return true;
}
/** Vuelve a descargar el chat de este vídeo (Drive / enlace) sin perder la sincronización */
function redownload() {
  if (!link || !link.srcs || !link.srcs.length) { toast('Este chat se cargó desde un archivo de tu PC: vuelve a elegirlo para actualizarlo.', 4500); Sound.play('error'); return; }
  closePop();
  loadSources(link.srcs.map(x => ({ ...x })), { force: true, keepSync: true });
}
function setGap(k, v) {
  if (!link || !chat || !chat.meta.parts || k < 1) return;
  const g = (link.sync.gaps = (link.sync.gaps || []).slice());
  while (g.length <= k) g.push(0);
  g[k] = Math.round(v * 10) / 10;
  saveLinkDb(); remerge();
}
function newLink(keys, old, carry = false) {
  const same = old && keysOf(old).join('|') === keys.join('|');
  const lk = same ? { ...old, chatKey: keys[0], chatKeys: keys, ytTitle: st.ytTitle || old.ytTitle }
    : { vid: st.vid, chatKey: keys[0], chatKeys: keys, ytTitle: st.ytTitle, ytChannel: st.ytChannel, sync: { mode: 'auto', delta: 0, cuts: [] }, linkedAt: Date.now() };
  // el vídeo tenía una sincronización guardada (chat borrado o desvinculado) → se aplica al chat nuevo
  if (!same && carry && old) { lk.sync = JSON.parse(JSON.stringify(old.sync || lk.sync)); if (old.marks) lk.marks = old.marks.slice(); }
  delete lk.noAuto; delete lk.detached;
  return lk;
}
/** ¿El vínculo anterior se quedó sin chat (borrado / desvinculado)? Entonces su sincronización pasa al nuevo */
async function shouldCarry(old, keys) {
  if (!old || keysOf(old).join('|') === keys.join('|')) return false;
  if (old.detached) return true;
  const infos = await Promise.all(keysOf(old).map(k => DB.get('info', k).catch(() => null)));
  return !infos.some(Boolean);
}
function setChat(keys, data) {
  keys = Array.isArray(keys) ? keys : [keys];
  chat = data; chat.key = keys.join('+'); chat.keys = keys; curPart = null;
  prepRoles(); computeReplies(); comboReset();
  chat.urls = new Array(data.images.length);
  chat.statics = new Array(data.emotes.length);
  chat.plainLower = null;
  $('title').textContent = data.meta.streamer ? `Chat · ${data.meta.streamer}` : 'Chat de la emisión';
  emptyEl.hidden = true; chatEl.hidden = false;
  prepFilters(); computeSync();
  broadcastState();
}
async function linkChat(keys, auto = false) {
  if (!st.vid) return;
  keys = Array.isArray(keys) ? keys : [keys];
  const old = await DB.get('links', st.vid).catch(() => null);
  const lk = newLink(keys, old, await shouldCarry(old, keys));
  if (!auto) lk.manual = true;
  if (!lk.srcs) {
    const infos = await Promise.all(keys.map(k => DB.get('info', k).catch(() => null)));
    const ss = infos.map(i => i && i.source);
    lk.srcs = ss.every(x => x && (x.type === 'drive' || x.type === 'url')) ? ss : null;
  }
  migrateGaps(lk);
  const data = await dataFor(keys, lk);
  if (!data) { toast('Ese chat ya no está en la biblioteca.'); return; }
  await DB.put('links', st.vid, lk);
  unloadChat(); link = lk; setChat(keys, data); sendStatus(true, auto ? 'auto' : 'loaded');
  if (!auto) { Sound.play('success'); toast(keys.length > 1 ? `Chat en ${keys.length} partes vinculado ✓` : 'Chat vinculado a este vídeo ✓'); }
  bc.postMessage({ t: 'library' });
}

const srcName = src => src.name || (src.file && src.file.name) || '';
/**
 * Carga una o varias partes (en orden), las guarda en la biblioteca y las vincula a este vídeo.
 * force=false reutiliza las partes de Drive que ya estén guardadas (no se vuelven a descargar).
 */
async function loadSources(srcs, { auto = false, force = false, noLink = false, keepSync = false } = {}) {
  if (loading) { toast('Ya se está cargando un chat.'); return; }
  srcs = (srcs || []).filter(Boolean);
  if (!srcs.length) return;
  const linkVid = st.vid, tok = loadTok, total = srcs.length;
  const ctrl = new AbortController();
  loading = { ctrl, stage: 'Preparando…', p: null, name: total > 1 ? partOf(srcName(srcs[0])).base : srcName(srcs[0]) };
  showLoading(true); broadcastState();
  const keys = [], datas = [];
  let msgs = 0;
  try {
    const infos = force ? [] : await DB.all('info').catch(() => []);
    for (let k = 0; k < total; k++) {
      const src = srcs[k];
      const pre = total > 1 ? `Parte ${k + 1}/${total} · ` : '';
      const have = src.type === 'drive' && infos.find(i => i.source && i.source.type === 'drive' && i.source.id === src.id);
      const cached = have ? await DB.get('chats', have.key).catch(() => null) : null;
      if (cached) { keys.push(have.key); datas.push(cached); msgs += cached.meta.count; continue; }
      const { data } = await loadChat(src, { signal: ctrl.signal, fetchThird: S.fetchThird, onStage: (t, p) => setStage(pre + t, p) });
      setStage(pre + 'Guardando en el navegador…', null);
      const key = chatKeyOf(data.meta);
      const prev = await DB.get('info', key).catch(() => null);
      const source = src.type === 'file' ? { type: 'file', name: src.file.name } : src.type === 'drive' ? { type: 'drive', id: src.id, name: src.name || '' } : { type: 'url', url: src.url };
      const info = {
        key, title: data.meta.title || srcName(src).replace(/\.json(\.gz)?$/i, '') || 'Chat sin título',
        fileName: srcName(src), streamer: data.meta.streamer, vodId: data.meta.vodId,
        count: data.meta.count, chatters: data.meta.chatters, length: data.meta.length || data.meta.end || data.meta.lastT,
        size: estimateSize(data), savedAt: (prev && prev.savedAt) || Date.now(), updatedAt: Date.now(), source,
        part: partOf(srcName(src)).n
      };
      await DB.saveChat(key, data, info, null);
      keys.push(key); datas.push(data); msgs += data.meta.count;
    }
    if (noLink) {
      Sound.play('success'); toast(`Actualizado ✓ · ${fmtNum(msgs)} mensajes`);
      try { bc.postMessage({ t: 'library' }); } catch {}
      if (chat && keys.some(k => chat.keys.includes(k)) && linkVid === st.vid) loadForVideo(st.vid);
      return;
    }
    let lk = null;
    if (linkVid) {
      const old = await DB.get('links', linkVid).catch(() => null);
      lk = { ...newLink(keys, old, keepSync || await shouldCarry(old, keys)), vid: linkVid };
      if (!auto) lk.manual = true; else if (!(old && keysOf(old).join('|') === keys.join('|'))) lk.manual = false;
      const reusable = srcs.every(x => x.type === 'drive' || x.type === 'url');
      lk.srcs = reusable ? srcs.map(x => (x.type === 'drive' ? { type: 'drive', id: x.id, name: x.name || '' } : { type: 'url', url: x.url })) : null;
      await DB.put('links', linkVid, lk);
    }
    Sound.play('success');
    const partsTxt = total > 1 ? ` (${total} partes)` : '';
    toast(auto ? `Chat encontrado en Drive y cargado ✓${partsTxt}` : `Chat guardado ✓ · ${fmtNum(msgs)} mensajes${partsTxt}`);
    try { bc.postMessage({ t: 'library' }); } catch {}
    if (lk && linkVid === st.vid && tok === loadTok) {
      const names = srcs.map(srcName);
      migrateGaps(lk);
      const data = datas.length > 1 ? mergeChats(datas, names, gapsOf(lk), pcfgOf(lk)) : datas[0];
      unloadChat(); link = lk; setChat(keys, data); sendStatus(true, auto ? 'auto' : 'loaded');
    }
    enforceLimit();
  } catch (e) {
    if (e && e.name === 'AbortError') toast('Carga cancelada.');
    else {
      Sound.play('error');
      const msg = e && e.name === 'QuotaExceededError' ? 'No queda espacio en el navegador para guardar el chat.' : (e && e.message) || String(e);
      toast(msg, 7000);
      try { bc.postMessage({ t: 'loadError', message: msg }); } catch {}
    }
  } finally {
    loading = null; showLoading(false); broadcastState();
  }
}
const loadSource = (src, opts = {}) => loadSources([src], { force: true, ...opts });
function setStage(s, p) {
  if (!loading) return;
  loading.stage = s; loading.p = p;
  $('loadStage').textContent = s;
  const bar = $('loadBar').parentElement;
  bar.classList.toggle('indet', p == null);
  if (p != null) $('loadBar').style.width = Math.round(p * 100) + '%';
  broadcastState();
}
function showLoading(on) { $('loading').hidden = !on; if (on) setStage(loading.stage, null); }
$('loadCancel').onclick = () => { if (loading) loading.ctrl.abort(); };

/* ---------- Comprobar que el chat es de este vídeo ---------- */
// Un vínculo automático hecho con otro título (p. ej. el del vídeo anterior) cuyo archivo no se parece al título actual → se descarta
async function verifyLink() {
  if (!chat || !link || link.manual || !st.ytTitle || !link.ytTitle || link.ytTitle === st.ytTitle) return;
  const vid = st.vid, keys = chat.keys.slice();
  const infos = await Promise.all(keys.map(k => DB.get('info', k).catch(() => null)));
  const names = infos.map(i => i ? partOf(i.fileName || i.title || '').base : '').concat(infos.map(i => (i && i.title) || ''));
  const score = Math.max(0, ...names.filter(Boolean).map(n => titleScore(st.ytTitle, n)));
  if (vid !== st.vid || !chat || chat.keys.join('|') !== keys.join('|')) return;
  if (score >= S.driveAutoScore) { link.ytTitle = st.ytTitle; saveLinkDb(); return; }
  await DB.del('links', vid).catch(() => {});
  toast('Ese chat no era de este vídeo: buscando el correcto…', 3500);
  drive.triedFor = null;
  loadForVideo(vid);
}
/** Al abrir el chat: se vuelve a comprobar todo con los datos actuales del vídeo (y la carpeta de Drive) */
async function onOpened() {
  if (loading) return;
  if (chat) { verifyLink(); return; }
  if (!st.vid) return;
  drive.triedFor = null;
  if (S.driveFolder) {
    try { const c = await getFolderFiles(S.driveFolder, { maxAgeMs: 60 * 1000 }); drive.files = c.files; drive.error = null; } catch (e) { drive.error = e.message; }
  }
  const lk = await DB.get('links', st.vid).catch(() => null);
  if (lk) { loadForVideo(st.vid); return; }
  renderEmpty(); maybeAutoDrive();
}
/* ---------- Límite de almacenamiento ---------- */
let limitBusy = false;
async function enforceLimit() {
  if (!S.storageLimit || limitBusy) return;
  limitBusy = true;
  try {
    const used = await DB.usage();
    if (used <= S.storageLimit * 1048576) return;
    const keep = chat ? chat.keys : [];
    const n = await DB.clearChatsExcept(keep);
    if (n) {
      toast(`Se llegó a ${fmtLimit(S.storageLimit)}: borrados ${n} chats guardados. Se volverán a descargar al abrir cada vídeo.`, 6000);
      try { bc.postMessage({ t: 'library' }); } catch {}
    }
  } finally { limitBusy = false; }
}
const fmtLimit = mb => (mb >= 1024 ? (mb / 1024).toLocaleString('es-ES') + ' GB' : mb + ' MB');

/* ---------- Drive automático ---------- */
async function refreshDrive(force) {
  if (!S.driveFolder || drive.busy) return;
  drive.busy = true; drive.error = null; if (!chat) renderEmpty();
  try { const c = await getFolderFiles(S.driveFolder, { force }); drive.files = c.files; }
  catch (e) { drive.error = e.message; }
  finally { drive.busy = false; if (!chat) renderEmpty(); }
}
function scoredGroups() {
  if (!drive.files) return [];
  return groupFiles(drive.files, st.ytTitle).sort((a, b) => b.score - a.score);
}
const groupSrcs = g => g.files.map(f => ({ type: 'drive', id: f.id, name: f.name }));
async function maybeAutoDrive() {
  if (chat || loading || !S.driveFolder || !st.vid) return;
  if (!drive.files && !drive.busy) await refreshDrive(false);
  if (chat || loading || !drive.files || !st.ytTitle || !S.driveAuto) return;
  if (drive.triedFor === st.vid + '|' + st.ytTitle) return;
  drive.triedFor = st.vid + '|' + st.ytTitle;
  const best = scoredGroups()[0];
  if (!best || best.score < S.driveAutoScore) return;
  const infos = await DB.all('info').catch(() => []);
  const haves = best.files.map(f => infos.find(i => i.source && i.source.type === 'drive' && i.source.id === f.id));
  if (haves.every(Boolean)) { await linkChat(haves.map(i => i.key), true); return; }
  loadSources(groupSrcs(best), { auto: true });
}

/* ---------- Estado vacío ---------- */
function renderEmpty() {
  if (chat) return;
  chatEl.hidden = true; emptyEl.hidden = false;
  $('title').textContent = 'Chat de la emisión';
  const inp = h('input', { class: 'inp', type: 'url', placeholder: 'Enlace de Drive del .json (o de la carpeta)' });
  const go = () => {
    try {
      const p = parseLink(inp.value);
      if (p.type === 'folder') { setS('driveFolder', p.url); toast('Carpeta de Drive guardada ✓'); return; }
      Sound.play('click'); loadSource(p);
    } catch (e) { Sound.play('error'); toast(e.message); }
  };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  inp.addEventListener('paste', () => setTimeout(() => { if (/^https?:\/\//.test(inp.value.trim())) go(); }, 30));
  const file = h('input', { type: 'file', accept: '.json,.gz,application/json,application/gzip', hidden: true, onchange: () => { if (file.files[0]) loadSource({ type: 'file', file: file.files[0] }); } });

  let sugg;
  if (S.driveFolder) {
    const items = scoredGroups().slice(0, 4);
    sugg = h('div', { class: 'sugg' },
      h('div', { class: 'hd' }, h('span', { text: 'Tu carpeta de Drive' }),
        h('span', null, h('button', { class: 'btn ghost sm', onclick: () => refreshDrive(true), title: 'Actualizar lista' }, '↻'), ' ',
          h('button', { class: 'btn ghost sm', onclick: () => openSettings('drive') }, 'Ver todo'))),
      drive.busy ? h('div', { class: 'it' }, h('span', { class: 'nm', text: 'Leyendo carpeta…' })) :
        drive.error ? h('div', { class: 'it' }, h('span', { class: 'nm', text: drive.error, style: 'white-space:normal;color:#f0b34a' })) :
          !items.length ? h('div', { class: 'it' }, h('span', { class: 'nm', text: drive.files ? 'No hay .json en la carpeta.' : '—' })) :
            items.map(g => h('div', { class: 'it' },
              h('span', { class: 'nm', title: g.files.map(f => f.name).join('\n'), text: g.multi ? g.name : g.files[0].name }),
              g.multi && h('span', { class: 'pt', text: `${g.files.length} parte${g.files.length > 1 ? 's' : ''}` }),
              g.score >= 0.5 && h('span', { class: 'sc', text: Math.round(g.score * 100) + '%' }),
              h('button', { class: 'btn primary sm', onclick: () => { Sound.play('click'); loadSources(groupSrcs(g)); } }, 'Usar'))));
  }
  const ss = st.savedSync && st.savedSync.vid === st.vid ? st.savedSync : null;
  emptyEl.replaceChildren(
    h('h3', { text: 'No hay chat para este vídeo' }),
    ss ? h('div', { class: 'saved-sync' }, h('b', { text: '✓ Sincronización guardada' }),
      h('span', { text: ` · ${describeSync(ss)}. Se aplicará sola al volver a cargar el chat de este vídeo.` })) : null,
    h('p', { text: st.ytDuration ? `Duración del vídeo: ${fmtTime(st.ytDuration)}. Elige su chat y se guardará para siempre en este navegador.` : 'Elige el chat de este vídeo y se guardará para siempre en este navegador.' }),
    sugg,
    h('div', { class: 'field' }, inp, h('button', { class: 'btn primary', onclick: go }, 'Cargar')),
    h('div', { class: 'dz' }, 'Arrastra aquí un .json / .json.gz o ', h('a', { href: '#', style: 'color:var(--link)', onclick: e => { e.preventDefault(); file.click(); } }, 'elige un archivo'), file),
    h('div', { class: 'field' }, h('button', { class: 'btn ghost sm', onclick: () => openSettings('library') }, '📚 Biblioteca de chats')),
    h('details', { class: 'tips' }, h('summary', { text: 'Cómo preparar el chat con TwitchDownloaderWPF' }),
      h('ol', null,
        h('li', { text: 'Pestaña «Chat Download», pega el enlace del directo (VOD).' }),
        h('li', { text: 'Formato JSON y marca «Embed Images» para guardar emotes e insignias.' }),
        h('li', { text: 'Sube el .json a tu carpeta de Drive (compartida como «Cualquier persona con el enlace»).' }),
        h('li', { text: 'Si el nombre del archivo es el título del vídeo de YouTube, se cargará solo.' }),
        h('li', { text: '¿El directo se dividió en 2 VODs? Añade [[parte1]] y [[parte2]] al final del nombre: al acabar la parte 1 sigue la 2.' }))),
    h('div', { class: 'credit', html: 'HECHO POR <b>@BYALVARO__</b>' })
  );
  broadcastState();
}
['dragenter', 'dragover'].forEach(ev => app.addEventListener(ev, e => { if (!chat && e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); app.classList.add('dragover'); } }));
['dragleave', 'drop'].forEach(ev => app.addEventListener(ev, () => app.classList.remove('dragover')));
app.addEventListener('drop', e => { if (chat) return; e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) loadSource({ type: 'file', file: f }); });

/* ---------- Filtros ---------- */
const BOTS = new Set(['nightbot', 'streamelements', 'moobot', 'streamlabs', 'fossabot', 'wizebot', 'sery_bot', 'botrixoficial', 'kofistreambot', 'soundalerts', 'pokemoncommunitygame', 'blerp']);
const splitList = s => (s || '').split(/[,\n]/).map(x => x.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
function prepFilters() {
  filt.bw = splitList(S.blockedWords);
  filt.hw = splitList(S.highlightWords);
  const me = (S.myName || '').trim().toLowerCase().replace(/^@/, '');
  filt.meRe = me ? new RegExp('(^|[^\\p{L}\\p{N}_])@?' + escapeRe(me) + '($|[^\\p{L}\\p{N}_])', 'iu') : null;
  filt.needText = !!(filt.bw.length || filt.hw.length || filt.meRe);
  filt.allRoles = allRolesOn();
  const bl = new Set(splitList(S.blockedUsers));
  filt.hideU = new Set();
  if (chat) chat.logins.forEach((l, u) => { if (bl.has(l) || (S.hideBots && BOTS.has(l))) filt.hideU.add(u); });
}
function plain(i) {
  const s = chat.M[i];
  if (s.indexOf(SEP) < 0) return s;
  const p = s.split(SEP);
  for (let k = 1; k < p.length; k += 2) p[k] = (chat.emotes[+p[k]] || {}).n || '';
  return p.join('');
}
/* Modos de chat: rol de cada mensaje (streamer > mod > VIP > sub > resto) */
const ROLE = { streamer: 1, mod: 2, vip: 4, sub: 8 };
function prepRoles() {
  const c = chat;
  c.setRole = new Uint8Array(c.sets.length);
  c.sets.forEach((ids, si) => {
    let r = 0;
    for (const bi of ids || []) {
      const k = ((c.badges[bi] || {}).k || '').split('/')[0];
      if (k === 'broadcaster') r |= ROLE.streamer;
      else if (k === 'moderator' || k === 'staff' || k === 'admin' || k === 'global_mod') r |= ROLE.mod;
      else if (k === 'vip') r |= ROLE.vip;
      else if (k === 'subscriber' || k === 'founder') r |= ROLE.sub;
    }
    c.setRole[si] = r;
  });
  c.streamerU = c.meta.streamer ? c.logins.indexOf(c.meta.streamer.toLowerCase()) : -1;
}
function roleOf(i) {
  const c = chat, r = c.setRole[c.B[i]] | (c.U[i] === c.streamerU ? ROLE.streamer : 0);
  return r & ROLE.streamer ? 'Streamer' : r & ROLE.mod ? 'Mod' : r & ROLE.vip ? 'Vip' : r & ROLE.sub ? 'Sub' : 'Other';
}
const allRolesOn = () => S.showRoleStreamer && S.showRoleMod && S.showRoleVip && S.showRoleSub && S.showRoleOther && S.showEmoteOnly;
function emoteOnly(i) {
  const s = chat.M[i];
  if (s.indexOf(SEP) < 0) return false;
  const p = s.split(SEP);
  for (let k = 0; k < p.length; k += 2) if (p[k].trim()) return false;
  return true;
}
/* Respuestas en hilo: padre real si el JSON lo trae; si no, «@usuario …» → último mensaje de ese usuario (10 min) */
function computeReplies() {
  const c = chat, n = c.T.length;
  const R = new Int32Array(n).fill(-1);
  const byLogin = new Map(); c.logins.forEach((l, u) => byLogin.set(l, u));
  const last = new Int32Array(c.names.length).fill(-1);
  const re = /^@([A-Za-z0-9_]{2,25})/;
  for (let i = 0; i < n; i++) {
    if (c.P && c.P[i] >= 0) R[i] = c.P[i];
    else if (c.M.length && c.M[i].charCodeAt(0) === 64) {
      const m = re.exec(c.M[i]);
      if (m) { const u = byLogin.get(m[1].toLowerCase()); if (u !== undefined && u !== c.U[i]) { const p = last[u]; if (p >= 0 && c.T[i] - c.T[p] < 600) R[i] = p; } }
    }
    last[c.U[i]] = i;
  }
  c.R = R;
}
function hidden(i) {
  if (filt.hideU.has(chat.U[i])) return true;
  if ((chat.F[i] & 8) && S.deletedMode === 'hide') return true;
  if (!filt.allRoles) {
    if (!S['showRole' + roleOf(i)]) return true;
    if (!S.showEmoteOnly && emoteOnly(i)) return true;
  }
  if (S.hideNotices && (chat.F[i] & 2)) return true;
  if (filt.bw.length) { const t = plain(i).toLowerCase(); for (const w of filt.bw) if (t.includes(w)) return true; }
  return false;
}
function isHl(i) {
  if (!filt.hw.length && !filt.meRe) return false;
  const t = plain(i);
  if (filt.meRe && filt.meRe.test(t)) return true;
  if (filt.hw.length) { const l = t.toLowerCase(); for (const w of filt.hw) if (l.includes(w)) return true; }
  return false;
}

/* ---------- Colores de nombres ---------- */
const DEFAULT_COLORS = ['#FF0000', '#0000FF', '#008000', '#B22222', '#FF7F50', '#9ACD32', '#FF4500', '#2E8B57', '#DAA520', '#D2691E', '#5F9EA0', '#1E90FF', '#FF69B4', '#8A2BE2', '#00FF7F'];
const colorCache = new Map();
function hexToRgb(c) {
  c = c.trim();
  if (c[0] === '#') { let x = c.slice(1); if (x.length === 3) x = [...x].map(ch => ch + ch).join(''); const n = parseInt(x.slice(0, 6), 16); return isNaN(n) ? null : [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  const m = c.match(/rgba?\((\d+)\D+(\d+)\D+(\d+)/); return m ? [+m[1], +m[2], +m[3]] : null;
}
function lum([r, g, b]) { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); }
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let hh = 0, s = 0; const l = (mx + mn) / 2;
  if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; hh /= 6; }
  return [hh, s, l];
}
function hslToRgb(hh, s, l) {
  if (!s) return [l * 255, l * 255, l * 255].map(Math.round);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(hh + 1 / 3), f(hh), f(hh - 1 / 3)].map(v => Math.round(v * 255));
}
function nameColor(i) {
  const u = chat.U[i];
  let col = chat.colors[chat.C[i]];
  if (!col) { const l = chat.logins[u] || ''; let x = 0; for (let k = 0; k < l.length; k++) x = (x * 31 + l.charCodeAt(k)) | 0; col = DEFAULT_COLORS[Math.abs(x) % DEFAULT_COLORS.length]; }
  if (!S.readableColors) return col;
  const dark = S.chatTheme !== 'light' || st.mode !== 'sidebar';
  const key = col + (dark ? 'd' : 'l');
  let out = colorCache.get(key);
  if (out) return out;
  const rgb = hexToRgb(col);
  if (!rgb) { colorCache.set(key, col); return col; }
  let [hh, s, l] = rgbToHsl(rgb), cur = rgb;
  for (let k = 0; k < 24; k++) {
    const L = lum(cur);
    if (dark ? L >= 0.2 : L <= 0.3) break;
    l = dark ? Math.min(1, l + 0.04) : Math.max(0, l - 0.04);
    cur = hslToRgb(hh, s, l);
  }
  out = `rgb(${cur[0]},${cur[1]},${cur[2]})`;
  colorCache.set(key, out);
  return out;
}

/* ---------- Imágenes ---------- */
function imgURL(i) {
  let u = chat.urls[i];
  if (u) return u;
  const x = chat.images[i];
  u = typeof x === 'string' ? x : URL.createObjectURL(x);
  chat.urls[i] = u; return u;
}
function emoteSrc(ei) {
  const e = chat.emotes[ei];
  if (S.animatedEmotes) return imgURL(e.img);
  const s = chat.statics[ei];
  if (s) return s === 'x' ? imgURL(e.img) : s;
  const src = imgURL(e.img);
  if (src.includes('/default/')) { chat.statics[ei] = src.replace('/default/', '/static/'); return chat.statics[ei]; }
  chat.statics[ei] = 'x';
  const im = new Image(); im.crossOrigin = 'anonymous';
  const c = chat;
  im.onload = () => {
    try {
      const cv = document.createElement('canvas'); cv.width = im.naturalWidth || 56; cv.height = im.naturalHeight || 56;
      cv.getContext('2d').drawImage(im, 0, 0);
      cv.toBlob(b => { if (b && c === chat) { c.statics[ei] = URL.createObjectURL(b); list.querySelectorAll(`img[data-e="${ei}"]`).forEach(el => { el.src = c.statics[ei]; }); } }, 'image/png');
    } catch {}
  };
  im.src = src;
  return src;
}
function hideSelf() { this.style.display = 'none'; }

/* ---------- Render de mensajes ---------- */
const LINK_RE = /(https?:\/\/[^\s]+|@[\p{L}\p{N}_]+)/u;
function appendText(el, text, query) {
  if (!text) return;
  if (query) { highlightInto(el, text, query); return; }
  if (text.indexOf('http') < 0 && text.indexOf('@') < 0) { el.append(text); return; }
  const parts = text.split(/(https?:\/\/[^\s]+|@[\p{L}\p{N}_]+)/u);
  for (let k = 0; k < parts.length; k++) {
    const p = parts[k]; if (!p) continue;
    if (k % 2 && LINK_RE.test(p)) {
      if (p[0] === '@') {
        const sp = document.createElement('span'); sp.className = 'mention'; sp.textContent = p;
        if (filt.meRe && filt.meRe.test(p)) sp.classList.add('me');
        el.append(sp);
      } else {
        const a = document.createElement('a'); a.href = p; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = p; el.append(a);
      }
    } else el.append(p);
  }
}
function appendEmote(el, ei) {
  const e = chat.emotes[ei]; if (!e) return;
  const H = Math.round(28 * S.emoteScale);
  const img = document.createElement('img');
  img.className = 'emote'; img.alt = img.title = e.n; img.dataset.e = ei;
  img.height = H; img.width = Math.max(1, Math.round(H * ((e.w / e.h) || 1)));
  img.decoding = 'async'; img.src = emoteSrc(ei); img.onerror = hideSelf;
  if (e.zw) {
    let prev = el.lastChild;
    if (prev && prev.nodeType === 3 && !prev.textContent.trim()) prev = prev.previousSibling;
    if (prev && prev.nodeType === 1 && (prev.classList.contains('emote') || prev.classList.contains('estack'))) {
      let stack = prev;
      if (prev.tagName === 'IMG') { stack = document.createElement('span'); stack.className = 'estack'; prev.replaceWith(stack); stack.append(prev); }
      stack.append(img); return;
    }
  }
  el.append(img);
}
function renderMsg(i, live, opt) {
  const c = chat, flags = c.F[i];
  const el = document.createElement('div');
  const del = (flags & 8) && S.deletedMode === 'strike';
  el.className = 'msg' + (i & 1 ? ' odd' : '') + (flags & 2 ? ' notice' : '') + (flags & 4 ? ' cheer' : '') + (del ? ' deleted' : '');
  el.dataset.i = i;
  if (S.showReplies && c.R && c.R[i] >= 0 && !(opt && opt.noReply)) {
    const p = c.R[i];
    const rp = document.createElement('div'); rp.className = 'reply'; rp.dataset.p = p; rp.title = 'Ver el mensaje original';
    const rn = document.createElement('span'); rn.className = 'rname'; rn.textContent = '↪ @' + c.names[c.U[p]]; rn.style.color = nameColor(p);
    const rt = document.createElement('span'); rt.className = 'rtxt'; const t = plain(p); rt.textContent = ': ' + (t.length > 90 ? t.slice(0, 90) + '…' : t);
    rp.append(rn, rt); el.append(rp);
  }
  if (S.showTimestamps || (opt && opt.ts)) {
    const ts = document.createElement('span'); ts.className = 'ts';
    const yt = ytOf(c.T[i]); ts.textContent = yt == null ? '✂' : fmtTime(yt); el.append(ts);
  }
  if (S.showBadges) {
    for (const bi of c.sets[c.B[i]] || []) {
      const b = c.badges[bi]; if (!b || b.img < 0) continue;
      const im = document.createElement('img'); im.className = 'badge'; im.src = imgURL(b.img); im.alt = im.title = b.t; im.onerror = hideSelf; el.append(im);
    }
  }
  const nm = document.createElement('span'); nm.className = 'name'; nm.dataset.u = c.U[i];
  nm.textContent = c.names[c.U[i]]; const col = nameColor(i); nm.style.color = col; el.append(nm);
  el.append(flags & 1 ? ' ' : ': ');
  const body = document.createElement('span'); body.className = 'body';
  if (flags & 1) body.style.color = col;
  const parts = c.M[i].split(SEP);
  for (let k = 0; k < parts.length; k++) k & 1 ? appendEmote(body, +parts[k]) : appendText(body, parts[k], opt && opt.query);
  el.append(body);
  if (del) { const tg = document.createElement('span'); tg.className = 'deltag'; tg.textContent = 'eliminado'; el.append(tg); }
  if (opt && opt.pickBtn) { const pb = document.createElement('button'); pb.className = 'pickbtn'; pb.textContent = '🎯'; pb.title = 'Este mensaje es de ahora: ajustar el chat a este momento del vídeo'; el.append(pb); }
  if (filt.needText && isHl(i)) { el.classList.add('hl'); if (live) Sound.play('mention', 1500); }
  if (live && (flags & 2)) Sound.play('notice', 2500);
  if (i === pendingFlash) { el.classList.add('flash'); pendingFlash = -1; }
  return el;
}

/* ---------- Contador de spam de emotes ---------- */
const combo = { ev: [], head: 0, counts: new Map(), name: null, n: 0, lastGrow: 0, el: $('combo') };
function comboReset() { combo.ev = []; combo.head = 0; combo.counts.clear(); hideCombo(true); }
function hideCombo(now) {
  if (!combo.name) return;
  combo.name = null; combo.n = 0;
  if (now) { combo.el.hidden = true; combo.el.classList.remove('out'); return; }
  combo.el.classList.add('out');
  setTimeout(() => { if (!combo.name) { combo.el.hidden = true; combo.el.classList.remove('out'); } }, 320);
}
function comboFeed(a, b) {
  if (!S.emoteCombo || !chat || b <= a) return;
  const c = chat, WIN = 8;
  for (let i = a; i < b; i++) {
    const s = c.M[i]; if (s.indexOf(SEP) < 0) continue;
    const p = s.split(SEP), seen = new Set();
    for (let k = 1; k < p.length; k += 2) {
      const e = c.emotes[+p[k]]; if (!e || seen.has(e.n)) continue;
      seen.add(e.n); combo.ev.push([c.T[i], e.n, +p[k]]);
      const v = combo.counts.get(e.n); combo.counts.set(e.n, v ? [v[0] + 1, +p[k]] : [1, +p[k]]);
    }
  }
  const tNow = c.T[b - 1];
  while (combo.head < combo.ev.length && combo.ev[combo.head][0] < tNow - WIN) {
    const nm = combo.ev[combo.head][1], v = combo.counts.get(nm);
    if (v) { if (v[0] <= 1) combo.counts.delete(nm); else v[0]--; }
    combo.head++;
  }
  if (combo.head > 5000) { combo.ev = combo.ev.slice(combo.head); combo.head = 0; }
  let best = null, bn = 0, bi = -1;
  for (const [nm, v] of combo.counts) if (v[0] > bn) { bn = v[0]; best = nm; bi = v[1]; }
  if (bn >= S.comboMin) showCombo(best, bn, bi);
}
function showCombo(name, n, ei) {
  if (combo.name === name && n <= combo.n) return;
  if (combo.name && combo.name !== name && n <= combo.n) return;
  const grew = combo.name === name;
  combo.name = name; combo.n = n; combo.lastGrow = performance.now();
  if (!grew) {
    const e = chat.emotes[ei];
    const img = h('img', { src: emoteSrc(ei), alt: name });
    combo.el.replaceChildren(img, h('div', null, h('b', { text: '×' + n }), h('small', { text: name })));
  } else combo.el.querySelector('b').textContent = '×' + n;
  combo.el.style.top = (chatEl.offsetTop + 8) + 'px';
  combo.el.classList.remove('out', 'bump'); void combo.el.offsetWidth;
  if (S.motion !== 'reduced') combo.el.classList.add('bump');
  combo.el.hidden = false;
}

/* ---------- Motor del chat ---------- */
function upper(T, x) { let lo = 0, hi = T.length; while (lo < hi) { const m = (lo + hi) >> 1; if (T[m] <= x) lo = m + 1; else hi = m; } return lo; }
function rebuild(now) {
  if (!chat) return;
  const target = upper(chat.T, now);
  const idx = [];
  for (let i = target - 1; i >= 0 && idx.length < S.maxMessages; i--) if (!hidden(i)) idx.push(i);
  idx.reverse();
  const frag = document.createDocumentFragment();
  for (const i of idx) frag.append(renderMsg(i, false));
  list.replaceChildren(frag);
  cursor = target; lastNow = now;
  comboReset();
  paused = false; newWhilePaused = 0; resumeBtn.hidden = true;
  scrollBottom(0);
}
function appendRange(a, b) {
  const max = S.maxMessages;
  if (b - a > max * 20) a = b - max * 20;
  let idx = [];
  for (let i = a; i < b; i++) if (!hidden(i)) idx.push(i);
  if (S.maxPerSecond > 0) {
    const now = performance.now();
    tokens = Math.min(S.maxPerSecond, tokens + (now - tokenAt) / 1000 * S.maxPerSecond); tokenAt = now;
    const take = Math.floor(tokens);
    if (idx.length > take) idx = idx.slice(idx.length - take);
    tokens -= idx.length;
  }
  if (!idx.length) return;
  if (idx.length > max) idx = idx.slice(-max);
  const frag = document.createDocumentFragment();
  for (const i of idx) frag.append(renderMsg(i, true));
  const before = list.offsetHeight;
  list.append(frag);
  if (paused || hoverPaused) {
    newWhilePaused += idx.length;
    trim(max * 4, true);
    if (paused) updateResume();
  } else {
    trim(max, false);
    scrollBottom(S.smoothScroll && S.motion !== 'reduced' ? list.offsetHeight - before : 0);
  }
}
function trim(limit, keepView) {
  let extra = list.childElementCount - limit;
  if (extra <= 0) return;
  let removedH = 0;
  while (extra-- > 0) { const f = list.firstElementChild; if (keepView) removedH += f.offsetHeight; f.remove(); }
  if (keepView && removedH) chatEl.scrollTop -= removedH;
}
function scrollBottom(delta) {
  chatEl.scrollTop = chatEl.scrollHeight;
  if (delta > 0 && delta < chatEl.clientHeight) {
    list.style.transition = 'none';
    list.style.transform = `translateY(${delta}px)`;
    void list.offsetHeight;
    list.style.transition = 'transform 150ms ease-out';
    list.style.transform = '';
  }
}
const atBottom = () => chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 40;
let ignoreScrollUntil = 0, userIntentAt = 0;
const intent = () => { userIntentAt = performance.now(); };
['pointerdown', 'touchmove', 'keydown'].forEach(ev => chatEl.addEventListener(ev, intent, { passive: true }));
chatEl.addEventListener('scroll', () => {
  const now = performance.now();
  if (atBottom()) { if (paused) resume(); return; }
  // solo se pausa si el desplazamiento lo ha hecho la persona (no la página ni el navegador)
  if (!paused && chat && now - userIntentAt < 1200 && now >= ignoreScrollUntil) { paused = true; newWhilePaused = 0; updateResume(); }
  else if (!paused) scrollBottom(0);
}, { passive: true });
chatEl.addEventListener('wheel', e => { intent(); if (e.deltaY < 0 && chat && !paused && chatEl.scrollHeight > chatEl.clientHeight) { paused = true; newWhilePaused = 0; updateResume(); } }, { passive: true });
chatEl.addEventListener('mouseenter', () => { if (S.pauseOnHover) hoverPaused = true; });
chatEl.addEventListener('mouseleave', () => { if (hoverPaused) { hoverPaused = false; if (!paused) { trim(S.maxMessages, false); scrollBottom(0); } } });
function updateResume() {
  resumeBtn.replaceChildren(h('span', { html: ICONS.down }), newWhilePaused ? `${fmtNum(newWhilePaused)} mensajes nuevos` : 'Chat en pausa por desplazamiento');
  resumeBtn.hidden = false;
}
function resume() { paused = false; newWhilePaused = 0; resumeBtn.hidden = true; trim(S.maxMessages, false); scrollBottom(0); }
resumeBtn.onclick = () => { Sound.play('click'); resume(); };
new ResizeObserver(() => { ignoreScrollUntil = performance.now() + 500; if (!paused) scrollBottom(0); buildGraphSoon(); }).observe(chatEl);

let lastFrame = 0, visible = true;
function effFps() { let f = S.fps || 0; if (st.fullscreen && S.fsLite) f = f ? Math.min(f, 30) : 30; return f; }
function schedule() {
  const f = effFps();
  // a 30 FPS o menos se usa un temporizador: la CPU no se despierta en cada refresco de pantalla (60/144 Hz)
  if (f > 0 && f <= 30) setTimeout(() => loop(performance.now()), 1000 / f);
  else requestAnimationFrame(loop);
}
function loop(ts) {
  schedule();
  if (!chat || !visible || document.hidden) return;
  const f = effFps();
  if (f > 0 && ts - lastFrame < 1000 / f - 4) return;
  lastFrame = ts;
  const now = chatNow();
  const parts = chat.meta.parts;
  if (parts && parts.length > 1) {
    let pi = 0; for (let k = 1; k < parts.length; k++) if (now >= parts[k].at) pi = k;
    if (pi !== curPart) {
      if (curPart !== null && pi === curPart + 1 && lastNow !== null && now - lastNow < 3) { toast(`▶ Parte ${pi + 1} del chat`); Sound.play('toggle'); }
      curPart = pi;
    }
  }
  if (lastNow === null || now < lastNow - 0.3 || now - lastNow > 5) rebuild(now);
  else {
    const target = upper(chat.T, now);
    if (target > cursor) { comboFeed(cursor, target); appendRange(cursor, target); cursor = target; }
    lastNow = now;
    if (combo.name && performance.now() - combo.lastGrow > 3000) hideCombo();
  }
  drawMarker();
}
schedule();

/* ---------- Mapa de calor y marcadores en la barra de progreso de YouTube ---------- */
function binCounts(nb, dur) {
  const counts = new Uint32Array(nb), T = chat.T;
  for (let i = 0; i < T.length; i++) { const yt = ytOf(T[i]); if (yt == null || yt < 0 || yt >= dur) continue; counts[Math.floor(yt / dur * nb)]++; }
  return counts;
}
const sendBar = debounce(() => {
  if (!chat || !st.ytDuration) { send({ type: 'bar', heat: null, marks: null }); return; }
  let heat = null;
  if (S.ytHeatmap) {
    const counts = binCounts(300, st.ytDuration); let max = 1; for (const c of counts) if (c > max) max = c;
    heat = Array.from(counts, c => Math.round(Math.sqrt(c / max) * 1000) / 1000);
  }
  const marks = S.bookmarks && link && link.marks && link.marks.length ? link.marks.map(m => m.t) : null;
  send({ type: 'bar', heat, marks, dur: st.ytDuration });
}, 150);

/* ---------- Marcadores ---------- */
function addMark(note) {
  if (!chat || !link) { toast('Este vídeo todavía no tiene chat.'); return; }
  const t = Math.round(ytNow());
  (link.marks = link.marks || []).push({ t, note: note || '' });
  link.marks.sort((a, b) => a.t - b.t);
  saveLinkDb(); sendBar(); buildGraph();
  Sound.play('toggle'); toast(`🔖 Marcador en ${fmtTime(t)}`);
  if (!popEl.hidden && popEl.dataset.kind === 'marks') openMarks();
  updateMarksBtn();
}
function updateMarksBtn() { document.querySelector('[data-act="marks"]').classList.toggle('has', !!(link && link.marks && link.marks.length)); }
function openMarks() {
  if (!chat || !link) { toast('Este vídeo todavía no tiene chat.'); return; }
  const marks = link.marks || [];
  const note = h('input', { class: 'inp', placeholder: 'Nota (opcional)…', style: 'height:32px' });
  note.addEventListener('keydown', e => { if (e.key === 'Enter') addMark(note.value.trim()); });
  const listEl = h('div', { class: 'marks' }, marks.length ? marks.map((m, k) => {
    const inp = h('input', { value: m.note || '', placeholder: 'Sin nota' });
    inp.addEventListener('change', () => { m.note = inp.value.trim(); saveLinkDb(); });
    return h('div', { class: 'mk' },
      h('span', { class: 't', text: fmtTime(m.t), title: 'Ir a este momento', onclick: () => { Sound.play('click'); seek(Math.max(0, m.t - 2)); } }),
      inp,
      h('button', { class: 'ib', html: ICONS.close, title: 'Quitar', onclick: () => { marks.splice(k, 1); saveLinkDb(); sendBar(); buildGraph(); updateMarksBtn(); Sound.play('close'); openMarks(); } }));
  }) : h('div', { class: 'hint', text: 'Aún no hay marcadores en este vídeo.' }));
  openPop('marks', h('h4', { text: '🔖 Marcadores' }),
    h('div', { class: 'field' }, note, h('button', { class: 'btn primary sm', style: 'height:32px', onclick: () => addMark(note.value.trim()) }, `＋ Aquí (${fmtTime(ytNow())})`)),
    listEl,
    h('div', { class: 'hint', text: 'Atajo: Alt+B añade un marcador al instante. Salen en la gráfica y en la barra de YouTube.' }));
  setTimeout(() => note.focus(), 30);
}

/* ---------- Modos de chat (qué mensajes se ven) ---------- */
function openFilter() {
  const chip = (k, label) => h('button', { class: 'chipt' + (S[k] ? ' on' : ''), onclick: () => { Sound.play('toggle'); setS(k, !S[k]); openFilter(); } }, h('span', { class: 'dot' }), label);
  openPop('filter', h('h4', { text: 'Qué mensajes se ven' }),
    h('div', { class: 'chips' }, chip('showRoleStreamer', 'Streamer'), chip('showRoleMod', 'Moderadores'), chip('showRoleVip', 'VIP'), chip('showRoleSub', 'Suscriptores'), chip('showRoleOther', 'Resto')),
    h('div', { class: 'chips' }, chip('showEmoteOnly', 'Mensajes solo de emotes'), h('button', { class: 'chipt' + (!S.hideNotices ? ' on' : ''), onclick: () => { Sound.play('toggle'); setS('hideNotices', !S.hideNotices); openFilter(); } }, h('span', { class: 'dot' }), 'Avisos de subs')),
    h('div', { class: 'field' },
      h('button', { class: 'btn ghost sm', onclick: () => { Sound.play('click'); setMany({ showRoleStreamer: true, showRoleMod: true, showRoleVip: true, showRoleSub: true, showRoleOther: true, showEmoteOnly: true, hideNotices: false }); openFilter(); } }, 'Ver todo'),
      h('button', { class: 'btn ghost sm', onclick: () => { Sound.play('click'); setMany({ showRoleStreamer: true, showRoleMod: true, showRoleVip: true, showRoleSub: false, showRoleOther: false }); openFilter(); } }, 'Solo streamer, mods y VIP')),
    h('div', { class: 'hint', text: 'El rol se saca de las insignias de cada mensaje. Si quitas un grupo, sus mensajes dejan de verse.' }));
}

/* ---------- Gráfica de actividad ---------- */
let g = null;
const buildGraphSoon = debounce(() => buildGraph(), 200);
function buildGraph() {
  if (!chat || !S.showGraph) { graphWrap.hidden = true; g = null; return; }
  graphWrap.hidden = false;
  const W = graphWrap.clientWidth || 320, H = 38, dpr = window.devicePixelRatio || 1;
  graphCv.width = Math.round(W * dpr); graphCv.height = Math.round(H * dpr);
  const dur = st.ytDuration || Math.max(1, (sync.chatEnd - sync.segs[0].off) / sync.scale);
  const bins = Math.max(30, Math.floor(W / 3));
  const counts = binCounts(bins, dur);
  let max = 1; for (const c of counts) if (c > max) max = c;
  const ctx = graphCv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  const accent = getComputedStyle(app).getPropertyValue('--accent').trim() || '#4c8dff';
  const grad = ctx.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, accent); grad.addColorStop(1, 'transparent');
  ctx.beginPath(); ctx.moveTo(0, H);
  const bw = W / bins;
  for (let k = 0; k < bins; k++) { const y = H - 3 - Math.sqrt(counts[k] / max) * (H - 6); ctx.lineTo(k * bw, y); ctx.lineTo((k + 1) * bw, y); }
  ctx.lineTo(W, H); ctx.closePath(); ctx.globalAlpha = 0.55; ctx.fillStyle = grad; ctx.fill(); ctx.globalAlpha = 1;
  ctx.strokeStyle = '#f0b34a'; ctx.setLineDash([3, 3]);
  for (const c of sync.cuts) { const x = c.at / dur * W; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  ctx.setLineDash([]);
  if (chat.meta.parts && chat.meta.parts.length > 1) {
    ctx.strokeStyle = accent; ctx.lineWidth = 2;
    for (const p of chat.meta.parts.slice(1)) { const yt = ytOf(p.at); if (yt == null) continue; const x = yt / dur * W; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    ctx.lineWidth = 1;
  }
  if (S.bookmarks && link && link.marks) {
    ctx.fillStyle = '#ffcc4d';
    for (const m of link.marks) { const x = m.t / dur * W; ctx.beginPath(); ctx.moveTo(x - 4, 0); ctx.lineTo(x + 4, 0); ctx.lineTo(x, 7); ctx.closePath(); ctx.fill(); }
  }
  g = { dur, bins, counts, W, lastX: -1 };
  drawMarker(true);
}
function drawMarker(force) {
  if (!g) return;
  const x = Math.round(Math.min(1, Math.max(0, ytNow() / g.dur)) * g.W);
  if (!force && x === g.lastX) return;
  g.lastX = x; graphMark.style.transform = `translateX(${x - 1}px)`;
}
graphWrap.addEventListener('mousemove', e => {
  if (!g) return;
  const r = graphWrap.getBoundingClientRect(), x = e.clientX - r.left;
  const yt = x / r.width * g.dur, k = Math.min(g.bins - 1, Math.max(0, Math.floor(x / r.width * g.bins)));
  const perMin = Math.round(g.counts[k] / (g.dur / g.bins) * 60);
  graphTip.textContent = `${fmtTime(yt)} · ${fmtNum(perMin)} msg/min`;
  graphTip.style.left = Math.min(r.width - 60, Math.max(60, x)) + 'px'; graphTip.hidden = false;
});
graphWrap.addEventListener('mouseleave', () => { graphTip.hidden = true; });
graphWrap.addEventListener('click', e => { if (!g) return; const r = graphWrap.getBoundingClientRect(); Sound.play('click'); seek((e.clientX - r.left) / r.width * g.dur); });
graphWrap.addEventListener('contextmenu', e => { e.preventDefault(); openPeaks(); });

/* ---------- Popovers ---------- */
function openPop(kind, title, ...body) {
  popEl.dataset.kind = kind;
  popEl.replaceChildren(
    h('div', { class: 'pop-hd' }, title, h('button', { class: 'ib', html: ICONS.close, title: 'Cerrar', onclick: () => { Sound.play('close'); closePop(); } })),
    h('div', { class: 'pop-bd' }, ...body));
  if (popEl.hidden) Sound.play('open');
  popEl.hidden = false;
}
function closePop() { popEl.hidden = true; popEl.dataset.kind = ''; }

function openUser(u) {
  if (!chat) return;
  const idx = []; for (let i = 0; i < chat.U.length; i++) if (chat.U[i] === u) idx.push(i);
  const login = chat.logins[u];
  const blocked = splitList(S.blockedUsers).includes(login);
  const lastI = idx[idx.length - 1];
  const badges = lastI != null ? (chat.sets[chat.B[lastI]] || []).map(bi => chat.badges[bi]).filter(b => b && b.img >= 0).map(b => h('img', { class: 'badge', src: imgURL(b.img), title: b.t })) : [];
  const listEl = h('div', { class: 'list' });
  for (const i of idx.slice(-250)) listEl.append(renderMsg(i, false, { ts: true }));
  openPop('user', h('h4', null, ...badges, h('span', { style: `color:${lastI != null ? nameColor(lastI) : 'inherit'}`, text: chat.names[u] })),
    h('div', { class: 'kv' }, h('span', { text: 'Mensajes en este directo' }), h('b', { text: fmtNum(idx.length) })),
    idx.length ? h('div', { class: 'kv' }, h('span', { text: 'Primer mensaje' }), h('span', { text: fmtTime(ytOf(chat.T[idx[0]])) })) : null,
    h('div', { class: 'field' },
      h('button', { class: 'btn ghost sm', onclick: () => { const l = splitList(S.blockedUsers).filter(x => x !== login); if (!blocked) l.push(login); setS('blockedUsers', l.join(', ')); Sound.play('toggle'); closePop(); toast(blocked ? `${login} vuelve a verse` : `${login} oculto`); } }, blocked ? 'Mostrar usuario' : 'Ocultar usuario'),
      h('button', { class: 'btn ghost sm', onclick: () => { closePop(); setSearchMode('users'); sUser = u; sUserTab = 'own'; openSearch(); } }, 'Interacciones'),
      h('a', { class: 'btn ghost sm', href: `https://www.twitch.tv/${login}`, target: '_blank', rel: 'noopener', style: 'text-decoration:none' }, 'Ver en Twitch')),
    idx.length > 250 ? h('div', { class: 'hint', text: `Mostrando los últimos 250 de ${fmtNum(idx.length)}` }) : null,
    listEl);
}

function twForm() {
  const ta = h('textarea', { class: 'twl-ta', spellcheck: 'false', placeholder: 'https://www.twitch.tv/videos/111 desde 1:23:26.100 hasta 9:28:30.033 | YouTube desde 0:00:00.000 hasta 8:05:03.934' });
  ta.value = twDraft;
  ta.addEventListener('input', () => { twDraft = ta.value; });
  const go = h('button', { class: 'btn primary sm', onclick: () => { const v = ta.value; twOpen = false; twDraft = ''; if (!applyTwitch(v)) { twOpen = true; twDraft = v; } } }, '🔗 Ajustar');
  const det = h('details', { class: 'twl', open: twOpen || undefined },
    h('summary', { text: '🔗 Ajustar con enlaces de Twitch' }),
    ta,
    h('div', { class: 'hint', text: 'Un enlace por VOD, en orden. Inicio: ?t= del enlace o «desde 5:10»; final: «hasta 3:02:00» (o pega otra vez el enlace con ?t= del final). Opcional «| YouTube desde 0:00:00 hasta 8:05:03» (o «yt 1:30:00») con el minuto del vídeo donde va ese VOD; si no, va justo detrás del anterior.' }),
    h('div', { class: 'toolbar' }, go));
  det.addEventListener('toggle', () => { twOpen = det.open; });
  return det;
}
function openSync() {
  if (!chat || !link) return;
  const ls = link.sync;
  const seg = h('div', { class: 'seg' }, ...[['auto', 'Auto'], ['start', 'Inicio'], ['end', 'Final'], ['stretch', 'Estirar']].map(([v, l]) =>
    h('button', { class: (ls.mode || 'auto') === v ? 'on' : '', onclick: () => { ls.mode = v; Sound.play('click'); saveLink(); } }, l)));
  const nb = d => h('button', { class: 'btn ghost sm', onclick: () => nudge(d) }, (d > 0 ? '+' : '') + String(d).replace('.', ','));
  sortCuts();
  const tIn = (val, ph, title) => { const i = h('input', { class: 'tin', value: val, placeholder: ph, title, spellcheck: 'false' }); i.addEventListener('focus', () => i.select()); return i; };
  const cuts = h('div', { class: 'cuts' }, ...(ls.cuts || []).map((c, k) => {
    const at = tIn(fmtTime(c.at), '2:00', 'Minuto del vídeo'), jp = tIn(fmtJump(c.jump), '+10:00', 'Salto del chat');
    const commit = () => {
      const a = parseClock(at.value), j = parseClock(jp.value);
      if (!isFinite(a) || !isFinite(j) || !j) { Sound.play('error'); toast('Formato: 2:00 y +10:00'); at.value = fmtTime(c.at); jp.value = fmtJump(c.jump); return; }
      if (a !== c.at || j !== c.jump) editCut(k, a, j);
    };
    [at, jp].forEach(i => { i.addEventListener('change', commit); i.addEventListener('keydown', e => { if (e.key === 'Enter') i.blur(); }); });
    return h('div', { class: 'c' }, h('span', { html: ICONS.cut }), h('span', { class: 'lbl', text: 'En' }), at, h('span', { class: 'lbl', text: 'salta' }), jp,
      h('button', { class: 'btn ghost sm', title: 'Ir 5 s antes del salto', onclick: () => seek(Math.max(0, c.at - 5)) }, 'Ir'),
      h('button', { class: 'ib', html: ICONS.close, title: 'Quitar salto', onclick: () => { ls.cuts.splice(k, 1); Sound.play('close'); saveLink(); } }));
  }));
  const newAt = tIn(fmtTime(ytNow()), '2:00', 'Minuto del vídeo donde YouTube recortó');
  const newJump = tIn(Math.abs(sync.remaining) > 0.5 ? fmtJump(sync.remaining) : '', '+10:00', 'Cuánto salta el chat (+ adelante, − atrás)');
  const doAdd = () => { const a = parseClock(newAt.value), j = parseClock(newJump.value); if (addCut(a, j)) { newJump.value = ''; } };
  [newAt, newJump].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); }));
  const addForm = h('div', { class: 'cutform' },
    h('div', { class: 'cutform-hd', text: 'Añadir salto del chat' }),
    h('div', { class: 'cutform-row' }, h('span', { class: 'lbl', text: 'En el minuto' }), newAt,
      h('button', { class: 'btn ghost sm', title: 'Usar el momento actual del vídeo', onclick: () => { newAt.value = fmtTime(ytNow()); } }, 'Ahora')),
    h('div', { class: 'cutform-row' }, h('span', { class: 'lbl', text: 'el chat salta' }), newJump,
      h('button', { class: 'btn primary sm', onclick: doAdd }, '＋ Añadir')),
    h('div', { class: 'hint', text: 'Ej.: en 2:00 salta +10:00 si en YouTube recortaste 10 minutos en el minuto 2. Usa − para que el chat retroceda (p. ej. −1:30). Escribe 2 = 2 minutos, 2:30, 1:02:30, 90s o 10m.' }));
  const parts = chat.meta.parts && chat.meta.parts.length > 1 ? chat.meta.parts : null;
  let partsBox = null;
  if (parts) {
    const rel = (p, raw) => fmtTime(Math.max(0, raw - p.rawStart));
    partsBox = h('div', { class: 'parts' },
      h('div', { class: 'parts-hd', text: `Partes del chat (${parts.length})` }),
      ...parts.map((p, k) => {
        const yt = ytOf(p.at), ytEnd = ytOf(p.end);
        const mb = d => h('button', { class: 'btn ghost sm', onclick: () => { Sound.play('tick'); setPart(k, { off: (p.off || 0) + d }); } }, (d > 0 ? '+' : '') + String(d).replace('.', ','));
        // desde / hasta (en el chat de ESTE VOD)
        const fIn = tIn(p.from != null ? rel(p, p.from) : '', 'inicio', 'Minuto del chat de este VOD donde empieza (vacío = desde el principio)');
        const tIn2 = tIn(p.to != null ? rel(p, p.to) : '', 'final', 'Minuto del chat de este VOD donde termina (vacío = hasta el final)');
        const commitFT = () => {
          const f = fIn.value.trim() ? parseClock(fIn.value) : null, t = tIn2.value.trim() ? parseClock(tIn2.value) : null;
          if ((f != null && !isFinite(f)) || (t != null && !isFinite(t))) { Sound.play('error'); toast('Formato: 5:00 o 1:02:30 (vacío = sin recortar)'); return; }
          if (f != null && t != null && t <= f) { Sound.play('error'); toast('«Hasta» tiene que ser después de «Desde».'); return; }
          setPart(k, { from: f == null ? null : p.rawStart + f, to: t == null ? null : p.rawStart + t }); Sound.play('tick');
        };
        [fIn, tIn2].forEach(i => { i.addEventListener('change', commitFT); i.addEventListener('keydown', e => { if (e.key === 'Enter') i.blur(); }); });
        // saltos dentro de este VOD
        const cutRows = (p.cuts || []).map((c, ci) => h('div', { class: 'c' },
          h('span', { html: ICONS.cut }),
          h('span', { text: `En ${fmtTime(partCutYt(p, c) || 0)} del vídeo (chat ${rel(p, c.at)})` }),
          h('b', { text: fmtJump(c.jump) }),
          h('button', { class: 'btn ghost sm', onclick: () => seek(Math.max(0, (partCutYt(p, c) || 0) - 5)) }, 'Ir'),
          h('button', { class: 'ib', html: ICONS.close, title: 'Quitar salto', onclick: () => { Sound.play('close'); setPart(k, { cuts: p.cuts.filter((_, j) => j !== ci) }); } })));
        const cAt = tIn(fmtTime(Math.min(Math.max(ytNow(), yt || 0), ytEnd || ytNow())), '2:00', 'Minuto del vídeo');
        const cJ = tIn('', '+10:00', 'Cuánto salta el chat de este VOD (+ adelante, − espera)');
        const addC = () => { if (addPartCut(k, parseClock(cAt.value), parseClock(cJ.value))) cJ.value = ''; };
        [cAt, cJ].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') addC(); }));
        const changed = (p.off || 0) !== 0 || p.from != null || p.to != null || (p.cuts && p.cuts.length);
        const det = h('details', { class: 'part' + (curPart === k ? ' cur' : ''), open: (openParts.has(k) || (curPart === k && !closedParts.has(k))) || undefined },
          h('summary', { class: 'part-row' },
            h('span', { class: 'part-n', text: `VOD ${p.n}` }),
            h('span', { class: 'part-meta', text: `${fmtNum(p.count)} msg${p.count !== p.countAll ? ` de ${fmtNum(p.countAll)}` : ''}` }),
            changed ? h('span', { class: 'part-dot', title: 'Esta parte tiene ajustes propios' }) : null,
            h('span', { class: 'part-at', text: yt == null ? '—' : `${fmtTime(yt)} → ${fmtTime(ytEnd)}` }),
            h('button', { class: 'btn ghost sm', title: 'Ir al inicio de esta parte', onclick: e => { e.preventDefault(); seek(Math.max(0, (yt || 0) - 3)); } }, 'Ir')),
          h('div', { class: 'part-row gap' },
            h('span', { class: 'part-lbl', text: 'Mover' }), mb(-5), mb(-1), h('span', { class: 'val', text: fmtSigned(p.off || 0) }), mb(1), mb(5),
            h('button', { class: 'btn ghost sm', title: 'Ajustar este VOD eligiendo un mensaje suyo que se vea ahora', onclick: () => startPick('part:' + k) }, '🎯'),
            (p.off || 0) !== 0 && h('button', { class: 'btn ghost sm', onclick: () => setPart(k, { off: 0 }) }, '0')),
          h('div', { class: 'part-row' }, h('span', { class: 'part-lbl', text: 'Chat desde' }), fIn, h('span', { class: 'part-lbl', text: 'hasta' }), tIn2),
          cutRows.length ? h('div', { class: 'cuts' }, ...cutRows) : null,
          h('div', { class: 'part-row' }, h('span', { class: 'part-lbl', text: 'Salto en' }), cAt, h('span', { class: 'part-lbl', text: 'de' }), cJ,
            h('button', { class: 'btn primary sm', onclick: addC }, '＋')),
          h('div', { class: 'hint', text: k > 0 ? `Solo cambia el VOD ${p.n}. No empieza a verse hasta que termina el chat del VOD ${k}: lo que se pise se descarta.` : 'Solo cambia el VOD 1 (las demás partes no se mueven).' }));
        det.addEventListener('toggle', () => { if (det.open) { openParts.add(k); closedParts.delete(k); } else { openParts.delete(k); closedParts.add(k); } });
        return det;
      }),
      h('div', { class: 'hint', text: '«Mover» y los saltos de cada VOD no tocan a los demás. «Desde/Hasta» se escriben en el tiempo del chat de ese VOD (0:00 = su principio).' }));
  }
  const statusTxt = { ok: '✓ La duración coincide', fixed: '✓ Ajustado con cortes', wait: 'Midiendo el vídeo…', mismatch: '⚠ Las duraciones no coinciden', manual: 'Ajuste manual' }[sync.status];
  const canRe = !!(link.srcs && link.srcs.length);
  openPop('sync', h('h4', { text: 'Sincronización' }),
    h('button', { class: 'btn ghost sm redl', disabled: !!loading, title: canRe ? 'Descarga otra vez el chat (de Drive o del enlace) y conserva toda la sincronización' : 'Este chat se cargó desde un archivo de tu PC', onclick: () => { Sound.play('click'); redownload(); } }, canRe ? `↻ Volver a descargar el chat${chat.keys.length > 1 ? ` (${chat.keys.length} VODs)` : ''}` : '↻ Volver a descargar (cargado desde archivo)'),
    twForm(),
    h('div', { class: 'kv' }, h('span', { text: 'Vídeo de YouTube' }), h('b', { text: fmtTime(st.ytDuration) })),
    h('div', { class: 'kv' }, h('span', { text: 'Chat' }), h('b', { text: `${fmtTime(sync.range)}${parts ? ` en ${parts.length} partes` : ''}${sync.chatStart ? ` (desde ${fmtTime(sync.chatStart)})` : ''}` })),
    h('div', { class: 'kv' }, h('span', { text: 'Estado' }), h('span', { text: statusTxt })),
    Math.abs(sync.remaining) > 1 ? h('div', { class: 'kv' }, h('span', { text: 'Diferencia sin compensar' }), h('b', { text: fmtSigned(sync.remaining) })) : null,
    seg,
    h('div', { class: 'nudge' }, nb(-5), nb(-1), nb(-0.5), h('span', { class: 'val', text: fmtSigned(ls.delta || 0) }), nb(0.5), nb(1), nb(5),
      h('button', { class: 'btn ghost sm', onclick: () => { ls.delta = 0; saveLink(); } }, 'Reiniciar')),
    h('button', { class: 'btn ghost sm', onclick: () => startPick('delta') }, '🎯 Ajustar todo con un mensaje'),
    partsBox,
    h('div', { class: 'hint', text: 'Cortes del vídeo: si al subirlo a YouTube quitaron un trozo, el chat se adelanta desde ese punto. Ve justo después del corte y añade un corte: el chat saltará ahí también.' }),
    cuts,
    addForm,
    h('div', { class: 'field' },
      h('button', { class: 'btn ghost sm', onclick: () => cutHere() }, `✂ Corte aquí${Math.abs(sync.remaining) > 0.5 ? ' (' + fmtSigned(sync.remaining) + ')' : ''}`),
      h('button', { class: 'btn ghost sm', onclick: () => startPick('cut') }, '✂ Corte con un mensaje')),
    h('div', { class: 'hint', text: 'Atajos: Alt+, y Alt+. mueven el chat 1 s (con Shift, 5 s).' }));
}
function openPeaks() {
  if (!chat) return;
  const dur = st.ytDuration || (sync.chatEnd - sync.segs[0].off);
  const nb = Math.max(1, Math.ceil(dur / 60)); const counts = new Uint32Array(nb);
  for (let i = 0; i < chat.T.length; i++) { const yt = ytOf(chat.T[i]); if (yt != null && yt >= 0 && yt < dur) counts[Math.floor(yt / 60)]++; }
  const order = [...counts.keys()].sort((a, b) => counts[b] - counts[a]);
  const picked = [];
  for (const k of order) { if (picked.length >= 10) break; if (picked.every(p => Math.abs(p - k) > 2)) picked.push(k); }
  const topWord = k => {
    const f = new Map();
    for (let i = upper(chat.T, chatAt(k * 60)); i < chat.T.length && chat.T[i] < chatAt(k * 60 + 60); i++)
      for (const w of plain(i).split(/\s+/)) if (w.length > 1) f.set(w, (f.get(w) || 0) + 1);
    let best = '', n = 0; for (const [w, c] of f) if (c > n) { best = w; n = c; }
    return best;
  };
  openPop('peaks', h('h4', { text: '🔥 Momentos con más chat' }),
    h('div', { class: 'list' }, ...picked.map((k, r) => h('div', { class: 'msg', style: 'cursor:pointer', onclick: () => { seek(Math.max(0, k * 60 - 20)); closePop(); } },
      h('span', { class: 'ts', text: fmtTime(k * 60) }), h('b', { text: `#${r + 1} · ${fmtNum(counts[k])} msg/min` }), ' — ', h('span', { style: 'color:var(--muted)', text: topWord(k) })))),
    h('div', { class: 'hint', text: 'Clic derecho en la gráfica para abrir esta lista.' }));
}

/* ---------- Elegir mensaje para sincronizar ---------- */
function startPick(mode) {
  if (!chat) return;
  pickMode = mode; app.classList.add('picking'); closePop();
  const pk = String(mode).startsWith('part:') ? +mode.slice(5) : null;
  const what = mode === 'cut' ? 'Corte: pulsa el mensaje que debería verse ahora'
    : pk ? `Parte ${pk + 1}: pulsa un mensaje de esa parte que se vea ahora` : 'Pulsa el mensaje que coincide con este momento del vídeo';
  $('pick').replaceChildren(
    h('div', { class: 'pick-txt' }, h('b', { text: what }), h('span', { text: ' — en el chat o búscalo con la lupa y púlsalo en los resultados.' })),
    h('div', { class: 'pick-acts' },
      h('button', { class: 'btn ghost sm', onclick: () => { Sound.play('click'); openSearch(); } }, '🔍 Buscar'),
      h('button', { class: 'btn ghost sm', onclick: () => { Sound.play('close'); stopPick(); } }, 'Cancelar')));
  $('pick').hidden = false; Sound.play('open');
  if (paused) resume();
}
function stopPick() { pickMode = null; app.classList.remove('picking'); $('pick').hidden = true; }
function onPick(i) {
  const now = ytNow(); const diff = Math.round((chat.T[i] - chatAt(now)) * 10) / 10;
  if (String(pickMode).startsWith('part:')) {
    const k = +pickMode.slice(5), parts = chat.meta.parts || [];
    const pi = chat.PI ? chat.PI[i] : parts.reduce((a, p, j) => (chat.T[i] >= p.at ? j : a), 0);
    if (pi !== k) { toast(`Ese mensaje es de la parte ${pi + 1}. Elige uno de la parte ${k + 1}.`, 4000); Sound.play('error'); return; }
    setPart(k, { off: (parts[k].off || 0) - diff });
    toast(`Parte ${k + 1} ajustada ${fmtSigned(-diff)}`);
    stopPick(); Sound.play('success'); setTimeout(refreshResults, 300); return;
  }
  if (pickMode === 'cut') { (link.sync.cuts = link.sync.cuts || []).push({ at: Math.round(now * 10) / 10, jump: diff }); toast(`✂ Corte en ${fmtTime(now)} (${fmtSigned(diff)})`); }
  else { link.sync.delta = Math.round(((link.sync.delta || 0) + diff) * 10) / 10; toast(`Chat ajustado ${fmtSigned(diff)}`); }
  stopPick(); Sound.play('success'); saveLink();
  refreshResults();
}
const refreshResults = () => { if (!$('results').hidden) setTimeout(() => runSearch(), 50); };

/* ---------- Búsqueda ---------- */
const qEl = $('q');
let sMode = 'msgs', sUser = null, sUserTab = 'own';
function setSearchMode(m) {
  sMode = m; sUser = null;
  document.querySelectorAll('#sMode button').forEach(b => b.classList.toggle('on', b.dataset.m === m));
  qEl.placeholder = m === 'users' ? 'Nombre de usuario' : 'Buscar palabra o from:usuario';
}
function openSearch(mode) {
  if (!chat) return;
  if (mode && mode !== sMode) { setSearchMode(mode); qEl.value = ''; }
  $('searchBar').hidden = false; qEl.focus(); qEl.select(); Sound.play('open'); runSearch();
}
function closeSearch() { $('searchBar').hidden = true; $('results').hidden = true; sUser = null; }
/** Mensajes por usuario (se calcula una vez por chat) */
function userCounts() {
  if (chat.uCount) return chat.uCount;
  const c = new Uint32Array(chat.names.length), first = new Int32Array(chat.names.length).fill(-1), last = new Int32Array(chat.names.length).fill(-1);
  for (let i = 0; i < chat.U.length; i++) { const u = chat.U[i]; c[u]++; if (first[u] < 0) first[u] = i; last[u] = i; }
  return (chat.uCount = { c, first, last });
}
function plainL(i) { if (!chat.plainLower) chat.plainLower = new Array(chat.T.length); let p = chat.plainLower[i]; if (p === undefined) p = chat.plainLower[i] = plain(i).toLowerCase(); return p; }
/** Búsqueda de usuarios: lista por nombre (más activos primero) */
function searchUsers(q) {
  const res = $('results'), { c, first, last } = userCounts();
  const ql = q.toLowerCase().replace(/^@/, '');
  const us = [];
  for (let u = 0; u < chat.names.length; u++) {
    if (!c[u]) continue;
    if (ql && !chat.logins[u].includes(ql) && !String(chat.names[u]).toLowerCase().includes(ql)) continue;
    us.push(u);
  }
  us.sort((a, b) => (ql ? (chat.logins[a] === ql ? -1 : 0) - (chat.logins[b] === ql ? -1 : 0) : 0) || c[b] - c[a]);
  $('qCount').textContent = `${fmtNum(us.length)} usuario${us.length === 1 ? '' : 's'}`;
  const frag = document.createDocumentFragment();
  if (!ql) frag.append(h('div', { class: 'more', text: 'Los que más han escrito en este directo. Escribe un nombre para filtrar.' }));
  for (const u of us.slice(0, 200)) {
    frag.append(h('div', { class: 'urow', onclick: () => { sUser = u; sUserTab = 'own'; Sound.play('click'); runSearch(); } },
      h('span', { class: 'un', style: `color:${nameColor(last[u])}`, text: chat.names[u] }),
      h('span', { class: 'uc', text: `${fmtNum(c[u])} msg` }),
      h('span', { class: 'ut', text: `${fmtTime(ytOf(chat.T[first[u]]))} → ${fmtTime(ytOf(chat.T[last[u]]))}` })));
  }
  if (us.length > 200) frag.append(h('div', { class: 'more', text: `…y ${fmtNum(us.length - 200)} más. Afina el nombre.` }));
  if (!us.length) frag.append(h('div', { class: 'more', text: 'Nadie con ese nombre en este chat.' }));
  res.replaceChildren(frag); res.hidden = false;
}
/** Un usuario: sus mensajes y los que le mencionan o le responden */
function showUser(u) {
  const res = $('results'), login = chat.logins[u], at = '@' + login;
  const own = [], about = [];
  for (let i = 0; i < chat.T.length; i++) {
    if (chat.U[i] === u) { own.push(i); continue; }
    const rep = chat.P && chat.P[i] >= 0 && chat.U[chat.P[i]] === u;
    if (rep || plainL(i).includes(at)) about.push(i);
  }
  const withWho = new Map();
  for (const i of about) withWho.set(chat.U[i], (withWho.get(chat.U[i]) || 0) + 1);
  for (const i of own) { const m = plainL(i).match(/@([a-z0-9_]{3,25})/g); if (m) for (const x of m) { const v = chat.logins.indexOf(x.slice(1)); if (v >= 0 && v !== u) withWho.set(v, (withWho.get(v) || 0) + 1); } }
  const top = [...withWho.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const list = sUserTab === 'own' ? own : about;
  $('qCount').textContent = `${fmtNum(list.length)} mensaje${list.length === 1 ? '' : 's'}`;
  const tab = (id, txt) => h('button', { class: sUserTab === id ? 'on' : '', onclick: () => { sUserTab = id; Sound.play('click'); showUser(u); } }, txt);
  const last = own.length ? own[own.length - 1] : -1;
  const frag = document.createDocumentFragment();
  frag.append(h('div', { class: 'uhead' },
    h('button', { class: 'btn ghost sm', onclick: () => { sUser = null; Sound.play('click'); runSearch(); } }, '← Usuarios'),
    h('b', { style: last >= 0 ? `color:${nameColor(last)}` : '', text: chat.names[u] }),
    h('button', { class: 'btn ghost sm', onclick: () => openUser(u) }, 'Tarjeta')));
  frag.append(h('div', { class: 'useg' }, tab('own', `Sus mensajes (${fmtNum(own.length)})`), tab('about', `Le mencionan o responden (${fmtNum(about.length)})`)));
  if (top.length) frag.append(h('div', { class: 'more' }, 'Habla más con: ', ...top.map(([v, n], k) => [k ? ' · ' : '', h('a', { href: '#', class: 'ulink', onclick: e => { e.preventDefault(); sUser = v; sUserTab = 'own'; runSearch(); }, text: `${chat.names[v]} (${n})` })]).flat()));
  for (const i of list.slice(0, 400)) frag.append(renderMsg(i, false, { ts: true, query: sUserTab === 'about' ? login : '', pickBtn: true }));
  if (list.length > 400) frag.append(h('div', { class: 'more', text: `Mostrando los primeros 400 de ${fmtNum(list.length)}.` }));
  if (!list.length) frag.append(h('div', { class: 'more', text: sUserTab === 'own' ? 'No ha escrito en este chat.' : 'Nadie le ha mencionado ni respondido.' }));
  res.replaceChildren(frag); res.hidden = false;
}
const runSearch = debounce(() => {
  const res = $('results');
  let q = qEl.value.trim();
  if (chat && sMode === 'users') { if (sUser != null) showUser(sUser); else searchUsers(q); return; }
  res.replaceChildren();
  if (!chat || q.length < 2) { $('qCount').textContent = ''; res.hidden = true; return; }
  let from = null; const m = q.match(/^from:(\S+)\s*(.*)$/i);
  if (m) { from = m[1].toLowerCase().replace(/^@/, ''); q = m[2].trim(); }
  const ql = q.toLowerCase(), n = chat.T.length;
  if (!chat.plainLower) chat.plainLower = new Array(n);
  const hits = [];
  for (let i = 0; i < n; i++) {
    if (from && !chat.logins[chat.U[i]].includes(from)) continue;
    if (ql) { let p = chat.plainLower[i]; if (p === undefined) p = chat.plainLower[i] = plain(i).toLowerCase(); if (!p.includes(ql)) continue; }
    hits.push(i);
  }
  $('qCount').textContent = `${fmtNum(hits.length)} resultado${hits.length === 1 ? '' : 's'}`;
  const frag = document.createDocumentFragment();
  for (const i of hits.slice(0, 300)) frag.append(renderMsg(i, false, { ts: true, query: q, pickBtn: true }));
  if (hits.length > 300) frag.append(h('div', { class: 'more', text: `…y ${fmtNum(hits.length - 300)} más. Afina la búsqueda.` }));
  if (!hits.length) frag.append(h('div', { class: 'more', text: 'Sin resultados.' }));
  res.append(frag); res.hidden = false;
}, 220);
qEl.addEventListener('input', () => { if (sMode === 'users') sUser = null; runSearch(); });
document.querySelectorAll('#sMode button').forEach(b => b.addEventListener('click', () => { Sound.play('click'); setSearchMode(b.dataset.m); qEl.focus(); runSearch(); }));
qEl.addEventListener('keydown', e => { if (e.key === 'Escape') { closeSearch(); Sound.play('close'); } });

/* ---------- Clics ---------- */
app.addEventListener('click', e => {
  Sound.unlock();
  const act = e.target.closest('[data-act]');
  if (act) {
    const a = act.dataset.act;
    if (a === 'close') { Sound.play('close'); send({ type: 'close' }); }
    else if (a === 'settings') openSettings();
    else if (a === 'search') { $('searchBar').hidden ? openSearch() : (closeSearch(), Sound.play('close')); }
    else if (a === 'searchClose') { closeSearch(); Sound.play('close'); }
    else if (a === 'sync') { popEl.dataset.kind === 'sync' && !popEl.hidden ? closePop() : openSync(); }
    else if (a === 'filter') { popEl.dataset.kind === 'filter' && !popEl.hidden ? (closePop(), Sound.play('close')) : openFilter(); }
    else if (a === 'marks') { popEl.dataset.kind === 'marks' && !popEl.hidden ? (closePop(), Sound.play('close')) : openMarks(); }
    return;
  }
  if (e.target === chipEl) { openSync(); return; }
  const rp = e.target.closest('.reply');
  if (rp && chat) {
    const p = +rp.dataset.p;
    const inList = list.querySelector(`.msg[data-i="${p}"]`);
    Sound.play('click');
    if (inList && rp.closest('#list')) {
      if (!paused) { paused = true; newWhilePaused = 0; updateResume(); }
      inList.scrollIntoView({ block: 'center', behavior: S.motion === 'reduced' ? 'auto' : 'smooth' });
      inList.classList.remove('flash'); void inList.offsetWidth; inList.classList.add('flash');
    } else openPop('reply', h('h4', { text: 'Mensaje original' }), h('div', { class: 'list' }, renderMsg(p, false, { ts: true, noReply: true })),
      h('div', { class: 'hint', text: 'Pulsa la hora para ir a ese momento del vídeo.' }));
    return;
  }
  const msg = e.target.closest('.msg');
  if (!msg || !chat) return;
  const i = +msg.dataset.i;
  if (e.target.closest('.pickbtn')) { if (!pickMode) pickMode = 'delta'; onPick(i); return; }
  if (pickMode && !e.target.closest('a')) { onPick(i); return; }
  if (e.target.classList.contains('name')) { Sound.play('click'); openUser(+e.target.dataset.u); return; }
  // solo la hora del mensaje lleva a ese minuto del vídeo
  if (e.target.classList.contains('ts')) { Sound.play('click'); seekToMsg(i); }
});
function openSettings(section) { Sound.play('open'); send({ type: 'openSettings', section: section || '' }); }

/* ---------- Teclado ---------- */
/** Acciones de los atajos (personalizables en Ajustes → Atajos) */
function runAction(id) {
  switch (id) {
    case 'toggle': send({ type: 'key', code: 'KeyC', alt: true }); break;
    case 'back1': nudge(-1); break;
    case 'fwd1': nudge(1); break;
    case 'back5': nudge(-5); break;
    case 'fwd5': nudge(5); break;
    case 'mark': if (S.bookmarks) addMark(''); else toast('Activa los marcadores en Ajustes → Extras'); break;
    case 'search': openSearch(); break;
    case 'users': openSearch('users'); break;
    case 'sync': if (chat) { if (popEl.hidden) openSync(); else closePop(); } break;
    case 'pick': if (chat) startPick('delta'); break;
    case 'cutHere': if (chat) cutHere(); break;
    case 'settings': openSettings(''); break;
    case 'redownload': redownload(); break;
    case 'scrollEnd': if (paused) resume(); scrollBottom(0); break;
  }
}
document.addEventListener('keydown', e => {
  const typing = e.target.closest && e.target.closest('input,textarea,select');
  const combo = comboOf(e);
  if (combo && !typing || combo && (e.altKey || e.ctrlKey || e.metaKey || /^F\d/.test(e.code))) {
    const B = bindings(S);
    const id = Object.keys(B).find(k => B[k] && B[k] === combo);
    if (id) { e.preventDefault(); e.stopPropagation(); runAction(id); return; }
  }
  if (e.key === 'Escape') { if (pickMode) stopPick(); else if (!popEl.hidden) closePop(); else if (!$('searchBar').hidden) closeSearch(); return; }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (['Space', 'KeyK', 'KeyJ', 'KeyL', 'ArrowLeft', 'ArrowRight', 'KeyM', 'KeyF'].includes(e.code)) { e.preventDefault(); send({ type: 'key', code: e.code }); }
});

/* ---------- Modo superpuesto: mover y redimensionar ---------- */
function dragWith(el, mk) {
  el.addEventListener('pointerdown', e => {
    if ((st.mode !== 'overlay' && !(st.mode === 'side' && el.id === 'rhL')) || e.button !== 0 || e.target.closest('button,input,a')) return;
    e.preventDefault(); el.setPointerCapture(e.pointerId);
    let lx = e.screenX, ly = e.screenY;
    app.classList.add('pinned');
    const move = ev => { const dx = ev.screenX - lx, dy = ev.screenY - ly; lx = ev.screenX; ly = ev.screenY; if (dx || dy) send(mk(dx, dy)); };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); app.classList.remove('pinned'); send({ type: 'dragEnd' }); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  });
}
dragWith($('bar'), (dx, dy) => ({ type: 'drag', dx, dy }));
document.querySelectorAll('.rh').forEach(el => dragWith(el, (dx, dy) => ({ type: 'resize', dx, dy, edge: el.dataset.edge })));
dragWith($('rhL'), dx => ({ type: 'resize', dx, dy: 0, edge: 'l' }));

/* ---------- Toast ---------- */
let toastT = 0;
function toast(msg, ms = 2600) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms); }

/* ---------- Inicio ---------- */
(async () => {
  S = await loadSettings();
  apply(null);
  if (window.top === window) {
    emptyEl.hidden = false; chatEl.hidden = true;
    emptyEl.replaceChildren(h('h3', { text: 'Abre un vídeo de YouTube' }), h('p', { text: 'El chat aparece al lado del vídeo. Pulsa el icono azul del chat en los controles del reproductor.' }), h('div', { class: 'credit', html: 'HECHO POR <b>@BYALVARO__</b>' }));
  } else renderEmpty();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) lastNow = null; });
})();
