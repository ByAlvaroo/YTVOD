/* Chat Replay · script de YouTube: coloca el chat, sincroniza el tiempo y añade el botón azul del reproductor. */
(() => {
  'use strict';
  if (window.__tcrContent) return;
  window.__tcrContent = true;

  const PANEL = chrome.runtime.getURL('panel.html');
  const APP = chrome.runtime.getURL('app.html');
  const EXT_ORIGIN = new URL(PANEL).origin;
  const SKEY = 'tcr_settings', OKEY = 'tcr_overlay';
  const SID = Math.random().toString(36).slice(2, 10);
  const D = { listBadges: true, ghostChat: false, enabled: true, autoOpen: false, mode: 'sidebar', theaterMode: 'sidebar', fullscreenMode: 'side', sidebarHeight: 0 };
  const FWKEY = 'tcr_fsw';
  let FW = 380;
  const migrate = o => { const s = { ...D, ...(o || {}) }; if (!(o && o.v >= 2)) s.fullscreenMode = 'side'; if (!(o && o.v >= 3)) s.autoOpen = false; return s; };
  const DR = { x: 0.69, y: 0.05, w: 0.29, h: 0.76 };
  let S = { ...D }, R = { ...DR };

  let host = null, frame = null, port = null, btn = null;
  let modal = null, mframe = null, mport = null, modalSection = '';
  let vid = null, video = null, hasChat = false, open = null;
  let lastRealT = 0, sentKey = '', layoutKey = '', lastVisible = null;
  // Al cambiar de vídeo, YouTube cambia la URL al instante pero el título y la duración tardan en actualizarse:
  // hasta que cambian se consideran «del vídeo anterior» y no se envían (evita vincular el chat equivocado).
  let navAt = 0, prevTitle = '', lastTitle = '', durOk = false, firstVid = true;
  const $ = s => document.querySelector(s);
  const player = () => $('#movie_player');
  const NS = 'http://www.w3.org/2000/svg';

  const alive = () => { try { return !!chrome.runtime.id; } catch { return false; } };
  const post = m => { if (port) try { port.postMessage(m); } catch {} };

  function currentVid() { return location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null; }
  function isAd() { const p = player(); return !!(p && (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting'))); }
  function parseClock(s) { if (!s || !s.trim()) return NaN; const p = s.trim().split(':').map(Number); return p.some(isNaN) ? NaN : p.reduce((a, b) => a * 60 + b, 0); }
  function duration() {
    if (!video || isAd() || !durOk) return 0;
    const d = video.duration;
    if (!isFinite(d) || d <= 0) return 0;
    const ui = parseClock(($('#movie_player .ytp-time-duration') || {}).textContent);
    if (!isNaN(ui) && Math.abs(ui - d) > 2) return 0;
    return d;
  }
  const domTitle = () => (($('ytd-watch-metadata h1 yt-formatted-string') || $('ytd-watch-metadata h1') || {}).textContent || document.title.replace(/ - YouTube$/, '')).trim();
  function ytTitle() {
    const t = domTitle();
    const flexy = $('ytd-watch-flexy');
    const fid = flexy && flexy.getAttribute('video-id');
    if (fid && vid && fid !== vid) return '';
    // mismo título que el vídeo anterior → todavía no se ha actualizado (tras 10 s se acepta: puede ser un título repetido)
    if (prevTitle && t === prevTitle && performance.now() - navAt < 10000) return '';
    return t;
  }
  const ytChannel = () => (($('ytd-watch-metadata ytd-channel-name a') || {}).textContent || '').trim();

  /* ---------- Envío de estado al panel ---------- */
  function sendVideo(force) {
    const v = currentVid(), d = duration(), t = ytTitle();
    const key = `${v}|${Math.round(d)}|${t}`;
    if (!force && key === sentKey) return;
    sentKey = key;
    if (t) lastTitle = t;
    post({ type: 'video', vid: v, title: t, channel: t ? ytChannel() : '', duration: d });
  }
  function sendTime() {
    if (!port || !video) return;
    const ad = isAd();
    if (!ad) lastRealT = video.currentTime;
    const buffering = !video.paused && video.readyState < 3;
    post({ type: 'time', t: lastRealT, rate: video.playbackRate || 1, paused: video.paused || video.ended || ad || buffering || video.seeking, ad });
  }
  const VEV = ['timeupdate', 'seeking', 'seeked', 'play', 'pause', 'playing', 'waiting', 'ratechange', 'loadedmetadata', 'durationchange', 'ended'];
  function onVideoEvent(e) {
    if (e.type === 'durationchange' || e.type === 'loadedmetadata') { if (isFinite(video.duration) && video.duration > 0) durOk = true; sendVideo(false); }
    sendTime();
  }
  function bindVideo() {
    const v = $('#movie_player video.html5-main-video') || $('#movie_player video');
    if (v === video) return;
    if (video) VEV.forEach(ev => video.removeEventListener(ev, onVideoEvent));
    video = v;
    if (video) { VEV.forEach(ev => video.addEventListener(ev, onVideoEvent)); sendTime(); }
  }
  let playerObs = null, observedPlayer = null;
  function observePlayer() {
    const p = player();
    if (!p || p === observedPlayer) return;
    observedPlayer = p;
    if (playerObs) playerObs.disconnect();
    playerObs = new MutationObserver(() => { sendTime(); });
    playerObs.observe(p, { attributes: true, attributeFilter: ['class'] });
    ro.observe(p);
  }
  const ro = new ResizeObserver(() => { if (host && host.classList.contains('tcr-sidebar')) sizeSidebar(); });

  /* ---------- Panel ---------- */
  function ensureHost() {
    if (host) return;
    host = document.createElement('div');
    host.id = 'tcr-host'; host.className = 'tcr-host'; host.style.display = 'none';
    frame = document.createElement('iframe');
    frame.src = PANEL + '#sid=' + SID;
    frame.allow = 'autoplay; clipboard-write';
    frame.setAttribute('allowtransparency', 'true');
    frame.title = 'Chat de Twitch';
    frame.addEventListener('load', () => connect(frame, p => { port = p; port.onmessage = e => onPanel(e.data); }));
    host.append(frame);
  }
  function connect(fr, set) {
    if (!fr.contentWindow) return;
    const ch = new MessageChannel();
    set(ch.port1);
    fr.contentWindow.postMessage({ type: 'tcr-init' }, EXT_ORIGIN, [ch.port2]);
  }
  function place(el, parent, first) {
    if (!parent) return false;
    const before = first ? parent.firstChild : null;
    if (el.parentNode === parent && (!first || parent.firstChild === el)) return true;
    if (before === el) return true;
    try { if (el.isConnected && typeof parent.moveBefore === 'function') { parent.moveBefore(el, before); return true; } } catch {}
    parent.insertBefore(el, before);
    return true;
  }
  function effMode() {
    if (document.fullscreenElement) return S.fullscreenMode;
    const f = $('ytd-watch-flexy');
    if (f && f.hasAttribute('theater')) return S.theaterMode;
    return S.mode;
  }
  function sizeSidebar() {
    const p = player();
    const ph = p ? p.getBoundingClientRect().height : 480;
    host.style.height = (S.sidebarHeight > 0 ? S.sidebarHeight : Math.max(380, Math.round(ph))) + 'px';
  }
  function applyRect() {
    R.w = Math.min(1, Math.max(0.14, R.w)); R.h = Math.min(1, Math.max(0.18, R.h));
    R.x = Math.min(1 - R.w, Math.max(0, R.x)); R.y = Math.min(1 - R.h, Math.max(0, R.y));
    Object.assign(host.style, { left: R.x * 100 + '%', top: R.y * 100 + '%', width: R.w * 100 + '%', height: R.h * 100 + '%' });
  }
  /* Pantalla completa «al lado»: el reproductor se estrecha y el chat queda fijo a la derecha */
  let sideOn = false, sideInPlayer = false;
  const nudgeResize = () => { window.dispatchEvent(new Event('resize')); setTimeout(() => window.dispatchEvent(new Event('resize')), 120); };
  function setSide(on, fs, p) {
    const root = document.documentElement;
    if (on) {
      FW = Math.round(Math.min(Math.max(260, FW), window.innerWidth * 0.6));
      root.style.setProperty('--tcr-w', FW + 'px');
      // si el propio reproductor es el elemento en pantalla completa no se puede estrechar: se encoge el vídeo dentro
      sideInPlayer = fs === p;
      root.classList.toggle('tcr-fs-side', !sideInPlayer);
      p.classList.toggle('tcr-fs-side-in', sideInPlayer);
      if (!sideOn) { sideOn = true; nudgeResize(); }
    } else if (sideOn) {
      sideOn = false;
      root.classList.remove('tcr-fs-side');
      const pl = player(); if (pl) pl.classList.remove('tcr-fs-side-in');
      nudgeResize();
    }
  }
  function layout() {
    if (!S.enabled || !vid) { if (host) host.style.display = 'none'; updateBtn(); return; }
    const p = player();
    if (!p) return;
    ensureHost();
    let mode = effMode();
    const visible = open === true && mode !== 'hide';
    const fs = document.fullscreenElement;
    if (mode === 'side' && fs && visible) {
      setSide(true, fs, p);
      place(host, fs.contains(p) && fs !== p ? fs : p, false);
      host.className = 'tcr-host tcr-fsside';
      host.style.cssText = '';
      host.style.width = FW + 'px';
    } else {
      setSide(false);
      if (mode === 'side') mode = 'overlay';
    }
    if (mode === 'sidebar') {
      const sec = $('ytd-watch-flexy #secondary-inner') || $('ytd-watch-flexy #secondary');
      if (sec && sec.offsetParent !== null) {
        place(host, sec, true);
        host.className = 'tcr-host tcr-sidebar';
        host.style.cssText = '';
        sizeSidebar();
      } else mode = 'overlay';
    }
    if (mode === 'overlay' || mode === 'hide') {
      place(host, p, false);
      host.className = 'tcr-host tcr-overlay';
      host.style.cssText = '';
      applyRect();
      if (S.ghostChat) host.classList.add('tcr-ghost');
    }
    host.style.display = visible ? '' : 'none';
    if (visible !== lastVisible) { lastVisible = visible; post({ type: 'visibility', visible }); }
    const pm = mode === 'sidebar' ? 'sidebar' : mode === 'side' ? 'side' : 'overlay';
    const ghost = pm === 'overlay' && !!S.ghostChat;
    const key = pm + '|' + !!document.fullscreenElement + '|' + ghost;
    if (key !== layoutKey) { layoutKey = key; post({ type: 'layout', mode: pm, fullscreen: !!document.fullscreenElement, ghost }); }
    updateBtn();
  }

  /* ---------- Mapa de calor y marcadores sobre la barra de progreso ---------- */
  let barData = null, barEl = null, barCv = null;
  const barRO = new ResizeObserver(() => drawBar());
  function drawBar() {
    const has = barData && (barData.heat || (barData.marks && barData.marks.length));
    if (!has || !vid) { if (barEl) barEl.remove(); return; }
    const pc = $('#movie_player .ytp-progress-bar-container') || $('#movie_player .ytp-progress-bar');
    if (!pc) return;
    if (!barEl) {
      barEl = document.createElement('div'); barEl.className = 'tcr-bar';
      barCv = document.createElement('canvas'); barEl.append(barCv);
      barRO.observe(barEl);
    }
    if (barEl.parentNode !== pc) pc.append(barEl);
    barEl.classList.toggle('tcr-bar-heat', !!barData.heat);
    const W = barEl.clientWidth, H = barEl.clientHeight, dpr = window.devicePixelRatio || 1;
    if (!W || !H) return;
    barCv.width = Math.round(W * dpr); barCv.height = Math.round(H * dpr);
    const ctx = barCv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const heat = barData.heat;
    if (heat && heat.length) {
      const n = heat.length, top = 2, base = H - 1;
      ctx.beginPath(); ctx.moveTo(0, base);
      // curva suavizada (como el mapa de calor de YouTube), en azul
      let py = base - heat[0] * (base - top);
      ctx.lineTo(0, py);
      for (let k = 1; k < n; k++) {
        const x = (k + 0.5) / n * W, y = base - heat[k] * (base - top), px = (k - 0.5) / n * W;
        ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2); py = y;
      }
      ctx.lineTo(W, py); ctx.lineTo(W, base); ctx.closePath();
      const gr = ctx.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, 'rgba(62,140,255,.55)'); gr.addColorStop(1, 'rgba(62,140,255,.12)');
      ctx.fillStyle = gr; ctx.fill();
      ctx.strokeStyle = 'rgba(143,188,255,.9)'; ctx.lineWidth = 1.2; ctx.stroke();
    }
    if (barData.marks && barData.dur) {
      ctx.fillStyle = '#ffcc4d'; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 1;
      for (const t of barData.marks) {
        const x = Math.round(t / barData.dur * W);
        ctx.beginPath(); ctx.moveTo(x - 4, H - 8); ctx.lineTo(x + 4, H - 8); ctx.lineTo(x + 4, H - 1); ctx.lineTo(x, H - 3.5); ctx.lineTo(x - 4, H - 1); ctx.closePath();
        ctx.fill(); ctx.stroke();
      }
    }
  }

  /* ---------- Círculo azul en las listas de vídeos (búsqueda, inicio, canal, recomendados) ---------- */
  const CARD_SEL = 'ytd-video-renderer, ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer, yt-lockup-view-model, ytd-reel-item-renderer';
  const known = new Map();           // vid|título -> true/false
  let badgeSeq = 0, badgeRetry = 0;
  function cardInfo(card) {
    // listas de reproducción (portada apilada): no son un vídeo
    if (card.tagName === 'YT-LOCKUP-VIEW-MODEL' && card.querySelector('yt-collection-thumbnail-view-model')) return null;
    const a = card.querySelector('a#thumbnail[href*="watch?v="], a#video-title[href*="watch?v="], a#video-title-link[href*="watch?v="], a[href*="watch?v="]');
    if (!a) return null;
    let v = null;
    try { v = new URL(a.getAttribute('href'), location.origin).searchParams.get('v'); } catch {}
    if (!v) return null;
    const t = card.querySelector('#video-title, #video-title-link, h3[title], .ytLockupMetadataViewModelTitle, .yt-lockup-metadata-view-model-wiz__title, .yt-lockup-metadata-view-model__title, h3');
    const title = ((t && (t.getAttribute('title') || t.textContent)) || '').trim().replace(/\s+/g, ' ');
    return { vid: v, title };
  }
  const ROW_SEL = '.ytContentMetadataViewModelMetadataRow, .yt-content-metadata-view-model-wiz__metadata-row, .yt-content-metadata-view-model__metadata-row';
  const ICON_SEL = '.ytContentMetadataViewModelIcon, .yt-content-metadata-view-model-wiz__icon, .yt-content-metadata-view-model__icon';
  /** Dónde va el círculo: justo después del nombre del canal y su verificado (el elemento VISIBLE) */
  function badgeSpot(card) {
    const chs = card.querySelectorAll('ytd-channel-name');
    for (const ch of chs) if (ch.offsetWidth > 0) return { parent: ch, after: null };
    // diseño nuevo: la fila de metadatos que lleva el enlace del canal → detrás del verificado (o del nombre)
    for (const row of card.querySelectorAll(ROW_SEL)) {
      const link = row.querySelector('a[href^="/@"], a[href*="/channel/"], a[href*="/c/"], a[href*="/user/"]');
      if (!link) continue;
      const icon = row.querySelector(ICON_SEL);
      const nameSpan = link.closest('.ytAttributedStringHost, .yt-core-attributed-string, span') || link;
      let after = icon || nameSpan;
      while (after.parentElement && after.parentElement !== row) after = after.parentElement;
      return { parent: row, after };
    }
    // sin enlace al canal (recomendados): la fila con el verificado, o la primera fila en la columna lateral
    const rows = [...card.querySelectorAll(ROW_SEL)];
    const withIcon = rows.find(r => r.querySelector(ICON_SEL));
    if (withIcon) { let after = withIcon.querySelector(ICON_SEL); while (after.parentElement && after.parentElement !== withIcon) after = after.parentElement; return { parent: withIcon, after }; }
    if (rows[0] && card.closest('#secondary, #related, ytd-watch-next-secondary-results-renderer')) {
      const first = rows[0].firstElementChild;
      return first ? { parent: rows[0], after: first } : { parent: rows[0], after: null };
    }
    return null;
  }
  function setBadge(card, on) {
    card.classList.toggle('tcr-card-chat', !!on);
    const old = card.querySelector('.tcr-has-chat');
    if (!on) { if (old) old.remove(); return; }
    const spot = badgeSpot(card);
    if (!spot) return;
    if (old && old.parentNode === spot.parent && (!spot.after || old.previousElementSibling === spot.after)) return;
    if (old) old.remove();
    const dot = document.createElement('span');
    dot.className = 'tcr-has-chat';
    dot.title = 'Este vídeo tiene chat de Twitch';
    dot.setAttribute('aria-label', 'Tiene chat de Twitch');
    if (spot.after) spot.after.after(dot); else spot.parent.append(dot);
  }
  function watchOwnerBadge() {
    const ch = $('ytd-watch-metadata #owner ytd-channel-name') || $('ytd-watch-metadata ytd-channel-name');
    if (!ch) return;
    const want = !!(S.enabled && S.listBadges && vid && (hasChat || known.get(vid + '|' + domTitle())));
    const old = ch.querySelector('.tcr-has-chat');
    if (!want) { if (old) old.remove(); return; }
    if (!old) { const dot = document.createElement('span'); dot.className = 'tcr-has-chat'; dot.title = 'Este vídeo tiene chat de Twitch'; ch.append(dot); }
  }
  async function scanBadges() {
    if (!alive()) return;
    const cards = document.querySelectorAll(CARD_SEL);
    if (!S.enabled || !S.listBadges) { document.querySelectorAll('.tcr-has-chat').forEach(d => d.remove()); document.querySelectorAll('.tcr-card-chat').forEach(c => c.classList.remove('tcr-card-chat')); return; }
    const ask = [], pending = [];
    for (const card of cards) {
      const info = cardInfo(card);
      if (!info) continue;
      const k = info.vid + '|' + info.title;
      if (known.has(k)) setBadge(card, known.get(k));
      else { pending.push([card, k]); if (!ask.some(x => x.vid === info.vid && x.title === info.title)) ask.push(info); }
    }
    watchOwnerBadge();
    if (!ask.length) return;
    const seq = ++badgeSeq;
    let res;
    try { res = await chrome.runtime.sendMessage({ cmd: 'hasChat', items: ask.slice(0, 200) }); } catch { res = null; }
    // el proceso en segundo plano puede estar arrancando: se reintenta (1 s, 2 s, 4 s…)
    if (!res) { badgeRetry = Math.min(badgeRetry ? badgeRetry * 2 : 1000, 15000); setTimeout(scanSoon, badgeRetry); return; }
    badgeRetry = 0;
    if (res.off) return;
    const yes = new Set(res.vids || []);
    for (const it of ask.slice(0, 200)) known.set(it.vid + '|' + it.title, yes.has(it.vid));
    if (seq !== badgeSeq && pending.length === 0) return;
    for (const [card, k] of pending) if (known.has(k) && card.isConnected) setBadge(card, known.get(k));
    watchOwnerBadge();
    if (ask.length > 200) scanSoon();
  }
  let scanT = 0;
  function scanSoon() { if (scanT) return; scanT = setTimeout(() => { scanT = 0; scanBadges(); }, 600); }
  new MutationObserver(muts => {
    for (const m of muts) if (m.addedNodes.length || m.type === 'attributes') { scanSoon(); return; }
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
  // los resultados se refrescan de vez en cuando (por si subes chats nuevos a Drive)
  setInterval(() => { if (alive() && !document.hidden) { known.clear(); scanSoon(); } }, 5 * 60 * 1000);
  scanSoon(); document.addEventListener('yt-navigate-finish', scanSoon);

  /* ---------- Botón azul en el reproductor ---------- */
  function svg(tag, attrs) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }
  function makeBtn() {
    const b = document.createElement('button');
    b.className = 'ytp-button tcr-btn';
    b.setAttribute('aria-label', 'Chat de Twitch (Alt+C)');
    b.setAttribute('data-tooltip-title', 'Chat de Twitch (Alt+C)');
    b.title = 'Chat de Twitch (Alt+C)';
    const s = svg('svg', { viewBox: '0 0 36 36', width: '100%', height: '100%', 'aria-hidden': 'true' });
    s.append(
      svg('path', { class: 'tcr-bubble', d: 'M10.5 9.5h15a2.5 2.5 0 0 1 2.5 2.5v9.5a2.5 2.5 0 0 1-2.5 2.5h-6.6l-4.6 3.6c-.5.4-1.3 0-1.3-.6v-3h-2.5A2.5 2.5 0 0 1 8 21.5V12a2.5 2.5 0 0 1 2.5-2.5z' }),
      svg('path', { class: 'tcr-lines', d: 'M12.8 14.6h10.4M12.8 18.4h6.8' }),
      svg('circle', { class: 'tcr-dot', cx: '27', cy: '10', r: '3' })
    );
    b.append(s);
    b.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); toggle(); });
    return b;
  }
  function ensureBtn() {
    if (!S.enabled || !vid) { if (btn) btn.remove(); return; }
    const rc = $('#movie_player .ytp-right-controls');
    if (!rc) return;
    if (!btn) btn = makeBtn();
    const left = rc.querySelector('.ytp-right-controls-left');
    const parent = left || rc;
    const anchor = parent.querySelector('.ytp-autonav-toggle, .ytp-autonav-toggle-button-container') || parent.querySelector('.ytp-subtitles-button') || parent.firstChild;
    const ref = anchor && anchor.parentNode === parent ? anchor : parent.firstChild;
    if (btn.parentNode !== parent || btn.nextSibling !== ref) parent.insertBefore(btn, ref);
    updateBtn();
  }
  function updateBtn() {
    if (!btn) return;
    btn.classList.toggle('tcr-on', open === true);
    btn.classList.toggle('tcr-has', hasChat);
    btn.setAttribute('aria-pressed', open === true ? 'true' : 'false');
  }
  function toggle(force) {
    if (!vid) return;
    const was = open === true;
    open = typeof force === 'boolean' ? force : open !== true;
    layout();
    // cada vez que se abre el chat se vuelve a comprobar todo con los datos actuales del vídeo
    if (open && !was) { sentKey = ''; sendVideo(true); post({ type: 'opened' }); }
    if (open && !hasChat) post({ type: 'showLoad' });
  }

  /* ---------- Menú de ajustes (ventana estilo Claude) ---------- */
  function openModal(section) {
    modalSection = section || '';
    const parent = document.fullscreenElement || document.body;
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'tcr-modal';
      modal.addEventListener('mousedown', e => { if (e.target === modal) closeModal(); });
      mframe = document.createElement('iframe');
      mframe.src = APP + '#sid=' + SID + (modalSection ? '&section=' + modalSection : '');
      mframe.allow = 'autoplay; clipboard-write';
      mframe.title = 'Ajustes de Chat Replay';
      mframe.addEventListener('load', () => connect(mframe, p => { mport = p; mport.onmessage = e => onModal(e.data); }));
      modal.append(mframe);
    } else if (mport) try { mport.postMessage({ type: 'open', section: modalSection }); } catch {}
    if (modal.parentNode !== parent) parent.append(modal);
    modal.classList.remove('tcr-closing');
    modal.style.display = '';
    requestAnimationFrame(() => { modal.classList.add('tcr-open'); try { mframe.focus(); } catch {} });
  }
  function closeModal() {
    if (!modal || modal.style.display === 'none') return;
    modal.classList.remove('tcr-open'); modal.classList.add('tcr-closing');
    setTimeout(() => { if (modal.classList.contains('tcr-closing')) modal.style.display = 'none'; }, 180);
    try { frame && frame.focus(); } catch {}
  }
  function onModal(m) {
    if (!m) return;
    if (m.type === 'close') closeModal();
    else if (m.type === 'seek' && video && !isAd()) video.currentTime = Math.max(0, m.t);
    else if (m.type === 'showChat') toggle(true);
    else if (m.type === 'reloadPage') setTimeout(() => location.reload(), m.ms || 1400);
  }

  /* ---------- Mensajes del panel ---------- */
  function onPanel(m) {
    if (!m) return;
    switch (m.type) {
      case 'ready': layoutKey = ''; sentKey = ''; lastVisible = null; sendVideo(true); sendTime(); layout(); break;
      case 'status':
        if (m.vid && m.vid !== vid) break;
        hasChat = !!m.hasChat;
        if (hasChat && vid) known.set(vid + '|' + domTitle(), true);
        watchOwnerBadge();
        if (m.reason === 'loaded') open = true;
        else if (open === null) open = hasChat && S.autoOpen;
        layout(); break;
      case 'seek': if (video && !isAd() && isFinite(m.t)) video.currentTime = Math.max(0, m.t); break;
      case 'drag': moveRect(m.dx, m.dy, 0, 0); break;
      case 'resize': if (m.edge === 'l') { FW = Math.round(Math.min(window.innerWidth * 0.6, Math.max(260, FW - m.dx))); document.documentElement.style.setProperty('--tcr-w', FW + 'px'); if (host) host.style.width = FW + 'px'; resizeSoon(); break; } if (m.edge === 'bl') moveRect(m.dx, 0, -m.dx, m.dy); else moveRect(0, 0, m.dx, m.dy); break;
      case 'dragEnd': try { chrome.storage.local.set({ [OKEY]: R, [FWKEY]: FW }); } catch {} break;
      case 'close': open = false; layout(); break;
      case 'openSettings': openModal(m.section); break;
      case 'key': handleKey(m.code, m.alt); break;
      case 'bar': barData = m.heat || m.marks ? { heat: m.heat, marks: m.marks, dur: m.dur } : null; drawBar(); break;
    }
  }
  let rsT = 0;
  function resizeSoon() { clearTimeout(rsT); rsT = setTimeout(() => window.dispatchEvent(new Event('resize')), 60); }
  function moveRect(dx, dy, dw, dh) {
    const p = player(); if (!p || !host) return;
    const r = p.getBoundingClientRect();
    R.x += dx / r.width; R.y += dy / r.height; R.w += dw / r.width; R.h += dh / r.height;
    applyRect();
  }
  function handleKey(code, alt) {
    if (alt && code === 'KeyC') { toggle(); return; }
    if (!video) return;
    switch (code) {
      case 'Space': case 'KeyK': video.paused ? video.play().catch(() => {}) : video.pause(); break;
      case 'KeyJ': video.currentTime = Math.max(0, video.currentTime - 10); break;
      case 'KeyL': video.currentTime += 10; break;
      case 'ArrowLeft': video.currentTime = Math.max(0, video.currentTime - 5); break;
      case 'ArrowRight': video.currentTime += 5; break;
      case 'KeyM': video.muted = !video.muted; break;
      case 'KeyF': { const b = $('#movie_player .ytp-fullscreen-button'); if (b) b.click(); break; }
    }
  }

  /* ---------- Navegación de YouTube (SPA) ---------- */
  function onNavigate() {
    if (!alive()) return;
    const v = currentVid();
    if (v !== vid) {
      prevTitle = vid ? (lastTitle || domTitle()) : '';
      navAt = performance.now();
      vid = v; open = null; hasChat = false; barData = null; drawBar();
      durOk = false; lastRealT = 0;
    }
    bindVideo(); observePlayer(); ensureBtn(); layout();
    // primera carga de la página: el vídeo ya puede traer su duración antes de que llegue la extensión
    if (firstVid && video && video.readyState >= 1 && isFinite(video.duration) && video.duration > 0) durOk = true;
    if (v) firstVid = false;
    sendVideo(true);
  }
  document.addEventListener('yt-navigate-finish', onNavigate);
  document.addEventListener('fullscreenchange', () => {
    layout();
    if (modal && modal.style.display !== 'none') openModal(modalSection);
  });
  let flexyObs = null, obsFlexy = null;
  function observeFlexy() {
    const f = $('ytd-watch-flexy');
    if (!f || f === obsFlexy) return;
    obsFlexy = f;
    if (flexyObs) flexyObs.disconnect();
    flexyObs = new MutationObserver(() => layout());
    flexyObs.observe(f, { attributes: true, attributeFilter: ['theater', 'fullscreen'] });
  }
  setInterval(() => {
    if (!alive()) return;
    if (currentVid() !== vid) { onNavigate(); return; }
    if (!vid) return;
    bindVideo(); observePlayer(); observeFlexy(); ensureBtn();
    if (!host || !host.isConnected) layout();
    if (barData && (!barEl || !barEl.isConnected)) drawBar();
    sendVideo(false);
    if (video && !video.paused) sendTime();
  }, 1000);

  document.addEventListener('keydown', e => {
    if (!S.enabled || !vid) return;
    const t = e.target;
    if (t && t.closest && t.closest('input, textarea, [contenteditable=""], [contenteditable="true"]')) return;
    if (e.key === 'Escape' && modal && modal.style.display !== 'none') { closeModal(); return; }
    // atajos (personalizables en Ajustes → Atajos; copia de shared/keys.js)
    const combo = keyCombo(e);
    if (!combo || combo === 'Ctrl+KeyF') return;          // Ctrl+F en YouTube es el «Buscar» del navegador
    if (!/^(Ctrl|Alt|Meta)\+|\+(Ctrl|Alt|Meta)\+/.test(combo) && !/(^|\+)F\d{1,2}$/.test(combo)) return;
    const B = { ...KEY_DEFAULTS, ...(S.keys || {}) };
    const id = Object.keys(B).find(k => B[k] && B[k] === combo);
    if (!id) return;
    e.preventDefault(); e.stopPropagation();
    if (id === 'toggle') toggle();
    else if (id === 'settings') openModal('');
    else { if (!open && id !== 'redownload') toggle(true); post({ type: 'action', id }); }
  }, true);
  const KEY_DEFAULTS = { toggle: 'Alt+KeyC', back1: 'Alt+Comma', fwd1: 'Alt+Period', back5: 'Alt+Shift+Comma', fwd5: 'Alt+Shift+Period', mark: 'Alt+KeyB', search: 'Ctrl+KeyF', users: 'Alt+KeyU' };
  function keyCombo(e) {
    if (!e.code || ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'OS'].includes(e.key)) return null;
    const p = []; if (e.ctrlKey) p.push('Ctrl'); if (e.altKey) p.push('Alt'); if (e.shiftKey) p.push('Shift'); if (e.metaKey) p.push('Meta');
    p.push(e.code); return p.join('+');
  }

  try {
    chrome.runtime.onMessage.addListener((m, _s, reply) => {
      if (m && m.cmd === 'openSettings') { openModal(m.section || ''); reply({ ok: true }); }
      else if (m && m.cmd === 'toggle') { toggle(); reply({ ok: true, open }); }
      else if (m && m.cmd === 'status') reply({ ok: true, vid, hasChat, open });
    });
  } catch {}


  /* ---------- Aviso de versión nueva (GitHub) ---------- */
  let updEl = null;
  const updMsg = m => { try { return chrome.runtime.sendMessage(m); } catch { return Promise.resolve(null); } };
  function updClose() { if (updEl) { updEl.remove(); updEl = null; } }
  function updCard(build) {
    updClose();
    updEl = document.createElement('div');
    updEl.id = 'tcr-update';
    updEl.style.cssText = 'position:fixed;top:68px;right:20px;z-index:2147482000;';
    const root = updEl.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host{all:initial}
      .c{box-sizing:border-box;width:360px;max-width:calc(100vw - 32px);background:#1f1f1e;color:#ecebe6;border:1px solid rgba(255,255,255,.12);border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.45);padding:16px 16px 14px;font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;animation:in .28s cubic-bezier(.2,.8,.2,1)}
      @keyframes in{from{opacity:0;transform:translateY(-8px) scale(.98)}to{opacity:1;transform:none}}
      .hd{display:flex;align-items:center;gap:10px;margin-bottom:6px}
      .ic{width:26px;height:26px;border-radius:8px;background:#1e6eff;display:grid;place-items:center;flex:none}
      .t{font-weight:650;font-size:14px;flex:1}
      .x{all:unset;cursor:pointer;opacity:.6;padding:2px 6px;border-radius:6px;font-size:16px}.x:hover{opacity:1;background:rgba(255,255,255,.08)}
      .sub{color:#a9a8a1;font-size:12px;margin-bottom:8px}
      .notes{white-space:pre-line;background:rgba(255,255,255,.05);border-radius:8px;padding:8px 10px;max-height:120px;overflow:auto;font-size:12px;color:#cfcec8;margin:6px 0 10px}
      ol{margin:4px 0 10px;padding-left:20px;color:#cfcec8;font-size:12.5px}li{margin:3px 0}
      code{background:rgba(255,255,255,.08);padding:1px 5px;border-radius:5px;font-size:11.5px}
      .warn{background:rgba(255,170,40,.12);color:#ffcf7a;border-radius:8px;padding:8px 10px;font-size:12px;margin:6px 0 10px}
      .row{display:flex;flex-wrap:wrap;gap:8px}
      button.b{all:unset;cursor:pointer;padding:7px 12px;border-radius:9px;font-weight:600;font-size:12.5px;background:rgba(255,255,255,.08);color:#ecebe6}
      button.b:hover{background:rgba(255,255,255,.14)}
      button.p{background:#1e6eff;color:#fff}button.p:hover{background:#3a82ff}
      button.l{background:none;color:#a9a8a1;padding:7px 6px}button.l:hover{color:#ecebe6;background:none}
      .ok .ic{background:#1f9d55}
      .sum{background:rgba(30,110,255,.14);color:#cfe0ff;border-radius:8px;padding:8px 10px;font-weight:600;font-size:12.5px;margin:4px 0 8px}
      details.nd{margin:0 0 8px;font-size:12px;color:#a9a8a1}details.nd summary{cursor:pointer}details.nd .notes{margin:6px 0 0}
      .q{font-weight:650;margin:6px 0 8px}
      .opt{display:flex;gap:10px;align-items:flex-start;margin:0 0 8px}.opt button{flex:none;min-width:112px;text-align:center}.opt span{font-size:12px;color:#a9a8a1;padding-top:2px}
      .rem{display:flex;gap:6px;align-items:center;font-size:12px;color:#a9a8a1;margin:4px 0 2px;cursor:pointer}
    </style><div class="c"></div>`;
    build(root.querySelector('.c'), root);
    document.documentElement.appendChild(updEl);
  }
  const ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>';
  const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const vidT = () => { const v = document.querySelector('video'); return v && isFinite(v.currentTime) ? Math.floor(v.currentTime) : 0; };
  function showUpdate(u, forceView) {
    const i = u.info;
    const view = forceView || (u.stale ? 'manual' : u.mode === 'auto' ? 'auto' : u.mode === 'manual' ? 'manual' : 'ask');
    updCard((c) => {
      const head = `<div class="hd"><div class="ic">${ICON}</div><div class="t">Chat Replay ${esc(i.version)} disponible</div><button class="x" title="Cerrar">✕</button></div>
        <div class="sub">Tienes la ${esc(u.current)}</div>
        ${i.summary ? `<div class="sum">✨ ${esc(i.summary)}</div>` : ''}
        ${i.notes ? `<details class="nd"><summary>Todas las novedades</summary><div class="notes">${esc(i.notes)}</div></details>` : ''}`;
      const foot = `<div class="row" style="margin-top:6px"><button class="b l" data-a="later">Más tarde</button><button class="b l" data-a="skip">Omitir esta versión</button><button class="b l" data-a="page">Ver en GitHub</button></div>`;
      let body = '';
      if (view === 'ask') body = `
        <div class="q">¿Cómo quieres actualizar?</div>
        <div class="opt"><button class="b p" data-a="auto">⚡ Automática</button><span>Reemplaza los archivos en la carpeta de la extensión y recarga YouTube en este minuto. No se descarga nada.</span></div>
        <div class="opt"><button class="b" data-a="manual">📦 Manual</button><span>Descargas el zip, lo descomprimes encima de la carpeta y pulsas «Recargar».</span></div>
        <label class="rem"><input type="checkbox" id="rem"> Recordar mi elección (se cambia en Ajustes → Acerca de)</label>`;
      else if (view === 'auto') body = `
        <div class="row"><button class="b p" data-a="auto">⚡ Actualizar ahora</button><button class="b l" data-a="toManual">Prefiero manual</button></div>
        <div class="sub" style="margin:8px 0 0">Se reemplazan los archivos de la extensión y YouTube vuelve a este mismo minuto. Tus ajustes, chats y sesión no se pierden.</div>`;
      else body = `
        ${u.stale ? `<div class="warn">⚠ Sigue la versión ${esc(u.current)}: los archivos no se han reemplazado. Descomprime el zip <b>en la misma carpeta</b> de antes (la que contiene <code>chat-replay-youtube</code>), acepta <b>reemplazar</b> y vuelve a pulsar «Recargar». O usa ⚡ Automática.</div>` : ''}
        <ol><li>Descarga el zip.</li><li>Descomprímelo encima de la carpeta de la extensión (reemplazar los archivos). Tus ajustes, chats y sesión no se pierden.</li><li>Pulsa <b>Recargar</b>.</li></ol>
        <div class="row"><button class="b p" data-a="dl">Descargar</button><button class="b" data-a="reload">Ya está → Recargar</button><button class="b l" data-a="auto">⚡ Mejor automática</button></div>
        <div class="sub" style="margin:8px 0 0">Si tras recargar no vuelve el chat: <a href="#" data-a="ext" style="color:#7fb0ff">abre las extensiones</a> y pulsa ↻ en Chat Replay.</div>`;
      c.innerHTML = head + body + foot;
      c.addEventListener('click', async e => {
        const a = e.target.closest('[data-a], .x');
        if (!a) return;
        const act = a.classList.contains('x') ? 'later' : a.dataset.a;
        const rem = c.querySelector('#rem');
        if ((act === 'auto' || act === 'manual') && rem && rem.checked) updMsg({ cmd: 'updSetMode', mode: act });
        if (act === 'auto') { a.textContent = 'Abriendo…'; a.disabled = true; await updMsg({ cmd: 'updAuto', t: vidT() }); updClose(); return; }
        if (act === 'manual' || act === 'toManual') { showUpdate(u, 'manual'); return; }
        if (act === 'dl') { window.open(i.url || i.page, '_blank', 'noopener'); return; }
        if (act === 'page') { window.open(i.page, '_blank', 'noopener'); return; }
        if (act === 'ext') { e.preventDefault(); updMsg({ cmd: 'updOpenExt' }); return; }
        if (act === 'later') { updMsg({ cmd: 'updSnooze', hours: 24 }); updClose(); return; }
        if (act === 'skip') { updMsg({ cmd: 'updSkip', version: i.version }); updClose(); return; }
        if (act === 'reload') {
          a.textContent = 'Recargando…'; a.disabled = true;
          const t = vidT();
          await updMsg({ cmd: 'updReload' });
          setTimeout(() => { const url = new URL(location.href); if (t > 3 && url.pathname === '/watch') url.searchParams.set('t', t + 's'); location.replace(url.toString()); }, 1400);
        }
      });
    });
  }
  function showUpdated(up) {
    updCard((c) => {
      c.classList.add('ok');
      c.innerHTML = `<div class="hd"><div class="ic">✓</div><div class="t">Chat Replay actualizado a la ${esc(up.to)}</div><button class="x" title="Cerrar">✕</button></div><div class="sub">Antes tenías la ${esc(up.from)}. Todo se ha conservado.</div>${up.summary ? `<div class="sum">✨ ${esc(up.summary)}</div>` : ''}`;
      c.querySelector('.x').onclick = updClose;
      setTimeout(updClose, 10000);
    });
    updMsg({ cmd: 'updSeen' });
  }
  async function updCheck() {
    if (!alive()) return;
    let u = null;
    try { u = await updMsg({ cmd: 'updBanner' }); } catch { return; }
    if (!u) return;
    if (u.updated && !u.newer) { showUpdated(u.updated); return; }
    if (u.off || !u.newer || !u.info) return;
    if (!u.stale && (u.skipped || Date.now() < (u.snooze || 0))) return;
    showUpdate(u);
  }
  setTimeout(updCheck, 2500);

  /* ---------- Ajustes ---------- */
  try {
    chrome.storage.local.get([SKEY, OKEY, FWKEY], o => {
      S = migrate(o[SKEY]); R = { ...DR, ...(o[OKEY] || {}) }; if (o[FWKEY]) FW = o[FWKEY];
      onNavigate();
    });
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'local') return;
      if (ch[SKEY]) { const prevL = S.listBadges, prevScore = S.driveAutoScore; S = migrate(ch[SKEY].newValue); ensureBtn(); layout(); if (prevL !== S.listBadges || prevScore !== S.driveAutoScore) { known.clear(); scanSoon(); } }
      if (ch.tcr_drive) { known.clear(); scanSoon(); }
      if (ch[FWKEY] && ch[FWKEY].newValue && ch[FWKEY].newValue !== FW) { FW = ch[FWKEY].newValue; if (sideOn) { document.documentElement.style.setProperty('--tcr-w', FW + 'px'); if (host) host.style.width = FW + 'px'; resizeSoon(); } }
      if (ch[OKEY] && ch[OKEY].newValue) { R = { ...DR, ...ch[OKEY].newValue }; if (host && host.classList.contains('tcr-overlay')) applyRect(); }
    });
  } catch { onNavigate(); }
})();
