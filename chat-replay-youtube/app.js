// ===== Chat Replay · ventana de ajustes =====
import { DEFAULTS, PRESETS, loadSettings, saveSettings, onSettings, applyChange, FONT_STACKS } from './shared/settings.js';
import * as DB from './shared/db.js';
import { Sound } from './shared/sounds.js';
import { parseClock, fmtJump } from './shared/util.js';
import { h, fmtTime, fmtSigned, fmtNum, fmtMB, fmtDate, highlightInto, titleScore, debounce } from './shared/util.js';
import { loadFonts } from './shared/util.js';
loadFonts();
import { getFolderFiles, parseLink, folderIdOf } from './shared/drive.js';
import { groupFiles } from './shared/parts.js';
import { parseTwitchLinks, assignLinks } from './shared/twlinks.js';
import { parsePlan, vodsOf, partPlan } from './shared/sincro.js';
import { ACTIONS, DEFAULTS as KDEF, bindings, comboOf, keysOf, fmtCombo, validCombo, RESERVED } from './shared/keys.js';
import { exportBackup, importBackup } from './shared/backup.js';

const qs = new URLSearchParams(location.hash.slice(1));
const SID = qs.get('sid') || 'solo';
const bc = new BroadcastChannel('tcr-' + SID);
const $ = id => document.getElementById(id);
const content = $('content'), nav = $('nav');

let S = { ...DEFAULTS };
let fsw = 380;
chrome.storage.local.get('tcr_fsw').then(o => { if (o.tcr_fsw) fsw = o.tcr_fsw; });
let state = null;            // estado del panel del vídeo actual
let port = null;
let query = '';
let drive = { files: null, busy: false, error: null, at: 0, filter: '' };
let lib = { infos: null, links: null, usage: 0 };
const confirmDel = new Set();

const I = {
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4 3v-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/></svg>',
  layout: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></svg>',
  bolt: '<svg viewBox="0 0 24 24"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>',
  sync: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/></svg>',
  filter: '<svg viewBox="0 0 24 24"><path d="M3 5h18l-7 8v6l-4-2v-4z"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9a4 4 0 0 1 0 6M19.5 6.5a8 8 0 0 1 0 11"/></svg>',
  drive: '<svg viewBox="0 0 24 24"><path d="M8 3h8l6 11-4 7H6l-4-7z"/><path d="M8 3l6 11H2M16 3l-6 11M14 14h8"/></svg>',
  lib: '<svg viewBox="0 0 24 24"><path d="M4 4h4v16H4zM10 4h4v16h-4z"/><path d="M16.5 4.5l3.5 1-4 15-3.5-1"/></svg>',
  key: '<svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/></svg>',
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
  monitor: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>'
};

/* ---------- Definición de ajustes ---------- */
const pct = v => Math.round(v * 100) + ' %';
const SECTIONS = [
  { id: 'account', grp: 'Cuenta', icon: 'user', title: 'Tu cuenta', custom: renderAccount, kw: 'iniciar sesión login nombre byalvaro sincronizar google restablecer publicar github seguir' },
  { id: 'general', grp: 'Configuración', icon: 'gear', title: 'General', groups: [
    { rows: [
      { k: 'advanced', t: 'Opciones avanzadas', d: 'Desactivado: solo se ven los ajustes básicos, para ir más rápido. Actívalo para verlos todos. El buscador siempre encuentra todo.', type: 'toggle', kw: 'avanzado experto todas básico simple' }
    ] },
    { title: 'Apariencia', rows: [
      { k: 'uiTheme', t: 'Tema', type: 'seg', icons: true, opts: [['system', 'monitor', 'Sistema'], ['light', 'sun', 'Claro'], ['dark', 'moon', 'Oscuro']], kw: 'claro oscuro modo' },
      { adv: 1, k: 'uiFont', t: 'Fuente de la interfaz', d: 'Fuente para los menús, barras y paneles.', type: 'select', opts: [['sans', 'Sans (estilo Claude)'], ['serif', 'Serif (estilo Claude)'], ['system', 'Sistema']], font: true },
      { adv: 1, k: 'motion', t: 'Movimiento', d: 'Reduce la animación del chat y de los menús (ahorra recursos).', type: 'seg', opts: [['system', 'Sistema'], ['reduced', 'Reducido']], kw: 'animaciones' },
      { adv: 1, k: 'showCredits', t: 'Animación de bienvenida', d: 'Muestra «Hecho por @byalvaro__» al abrir este menú.', type: 'toggle', kw: 'créditos' }
    ] }
  ] },
  { id: 'chat', grp: 'Configuración', icon: 'chat', title: 'Chat', groups: [
    { title: 'Aspecto del chat', rows: [
      { k: 'chatTheme', t: 'Tema del chat', type: 'select', opts: [['claude', 'Claude oscuro'], ['twitch', 'Twitch'], ['light', 'Claro'], ['oled', 'Negro OLED'], ['glass', 'Cristal (transparente)']], kw: 'colores' },
      { k: 'chatFont', t: 'Fuente del chat', d: 'Por defecto, la serif de Claude.', type: 'select', opts: [['serif', 'Serif (estilo Claude)'], ['sans', 'Sans (estilo Claude)'], ['twitch', 'Twitch (Inter)'], ['system', 'Sistema'], ['mono', 'Monoespaciada']], font: true, kw: 'letra tipografía' },
      { k: 'fontSize', t: 'Tamaño del texto del chat', type: 'seg', opts: [[12, 'Pequeño'], [14, 'Medio'], [17, 'Grande'], [21, 'Enorme']], kw: 'letra' },
      { adv: 1, k: 'fontSize', t: 'Tamaño exacto del texto', type: 'range', min: 10, max: 28, step: 1, fmt: v => v + ' px' },
      { adv: 1, k: 'emoteScale', t: 'Tamaño de los emotes', type: 'range', min: 0.5, max: 2.5, step: 0.1, fmt: v => v.toFixed(1).replace('.', ',') + '×' },
      { adv: 1, k: 'msgGap', t: 'Espacio entre mensajes', type: 'seg', opts: [[1, 'Compacto'], [3, 'Normal'], [7, 'Amplio']] },
      { k: 'showBadges', t: 'Insignias', d: 'Suscriptor, moderador, VIP, Prime…', type: 'toggle' },
      { k: 'showTimestamps', t: 'Marca de tiempo', d: 'Haz clic en la hora de un mensaje para saltar a ese momento.', type: 'toggle', kw: 'hora' },
      { adv: 1, k: 'boldNames', t: 'Nombres en negrita', type: 'toggle' },
      { adv: 1, k: 'readableColors', t: 'Colores de nombre legibles', d: 'Aclara los colores demasiado oscuros, como hace Twitch.', type: 'toggle' },
      { adv: 1, k: 'altBg', t: 'Fondo alterno', d: 'Alterna el fondo de los mensajes para leer mejor.', type: 'toggle' },
      { adv: 1, k: 'separators', t: 'Líneas separadoras', type: 'toggle' },
      { adv: 1, k: 'fetchThird', t: 'Emotes de 7TV, BTTV y FFZ', d: 'Si el JSON no los trae incrustados, se descargan del canal.', type: 'toggle', kw: 'emotes' },
      { adv: 1, k: 'showReplies', t: 'Respuestas en hilo', d: 'Muestra «↪ @usuario: …» encima de cada respuesta. Pulsa para ver el mensaje original.', type: 'toggle', kw: 'responder reply' },
      { adv: 1, k: 'deletedMode', t: 'Mensajes eliminados', d: 'Los que borraron los moderadores (solo si el archivo los incluye).', type: 'seg', opts: [['strike', 'Tachados'], ['show', 'Normales'], ['hide', 'Ocultos']], kw: 'borrados baneos moderación' }
    ] }
  ] },
  { id: 'layout', grp: 'Configuración', icon: 'layout', title: 'Posición y tamaño', groups: [
    { rows: [
      { k: 'mode', t: 'Vista normal', type: 'seg', opts: [['sidebar', 'Al lado'], ['overlay', 'Encima del vídeo']], kw: 'lateral posición' },
      { adv: 1, k: 'theaterMode', t: 'Modo cine', type: 'seg', opts: [['sidebar', 'Al lado'], ['overlay', 'Encima del vídeo']] },
      { k: 'fullscreenMode', t: 'Pantalla completa', d: '«Al lado»: el vídeo se hace más pequeño y el chat queda fijo a la derecha.', type: 'seg', opts: [['side', 'Al lado (fijo)'], ['overlay', 'Encima del vídeo'], ['hide', 'Ocultar']], kw: 'fullscreen fijo' },
      { adv: 1, t: 'Ancho del chat en pantalla completa', d: 'También puedes arrastrar el borde izquierdo del chat.', type: 'fsw' },
      { adv: 1, k: 'sidebarHeight', t: 'Altura del chat lateral', type: 'range', min: 0, max: 1400, step: 20, fmt: v => v ? v + ' px' : 'Igual que el vídeo', kw: 'alto tamaño' },
      { k: 'autoOpen', t: 'Abrir el chat automáticamente', d: 'Desactivado: el chat siempre empieza cerrado y se abre con el botón azul (o Alt+C).', type: 'toggle' },
      { adv: 1, k: 'overlayBg', t: 'Opacidad del fondo (encima del vídeo)', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct, kw: 'transparencia' },
      { adv: 1, k: 'textShadow', t: 'Sombra en el texto (encima del vídeo)', type: 'toggle' },
      { adv: 1, k: 'autoHideHeader', t: 'Ocultar la barra superior (encima del vídeo)', d: 'Aparece al pasar el ratón. Arrástrala para mover el chat.', type: 'toggle' },
      { adv: 1, k: 'ghostChat', t: 'Modo cine total', d: 'Con el chat «Encima del vídeo»: se vuelve translúcido y desaparece cuando no mueves el ratón (igual que los controles de YouTube).', type: 'toggle', kw: 'transparente fantasma inmersivo' },
      { adv: 1, t: 'Ventana superpuesta', d: 'Vuelve a colocar el chat flotante en su sitio inicial.', type: 'button', label: 'Recolocar', act: () => { chrome.storage.local.remove('tcr_overlay'); toast('Posición restablecida'); } }
    ] }
  ] },
  { id: 'perf', grp: 'Configuración', icon: 'bolt', title: 'Rendimiento', groups: [
    { rows: [
      { k: 'perfPreset', t: 'Modo de rendimiento', d: 'Menos FPS y animaciones = más potencia libre para el resto del ordenador.', type: 'seg', opts: [['quality', 'Calidad'], ['balanced', 'Equilibrado'], ['saver', 'Ahorro'], ['ultra', 'Ultra ahorro']], extra: 'custom', kw: 'optimización cpu gpu ordenador' },
      { adv: 1, k: 'fps', t: 'FPS del chat', d: 'Cuántas veces por segundo se actualiza el chat.', type: 'seg', opts: [[8, '8'], [15, '15'], [24, '24'], [30, '30'], [60, '60'], [0, 'Máx']], kw: 'fotogramas' },
      { adv: 1, k: 'maxMessages', t: 'Mensajes en pantalla', d: 'Menos mensajes = menos memoria y menos trabajo.', type: 'range', min: 30, max: 500, step: 10, fmt: v => v + ' msg' },
      { adv: 1, k: 'maxPerSecond', t: 'Límite de mensajes por segundo', d: 'En momentos de spam se saltan mensajes para no saturar.', type: 'range', min: 0, max: 60, step: 1, fmt: v => v ? v + ' /s' : 'Sin límite' },
      { adv: 1, k: 'smoothScroll', t: 'Desplazamiento suave', type: 'toggle', kw: 'animación' },
      { adv: 1, k: 'animatedEmotes', t: 'Emotes animados', d: 'Desactívalo para congelar los GIF: ahorra mucha CPU.', type: 'toggle', kw: 'gif' },
      { adv: 1, k: 'pauseOnHover', t: 'Pausar al pasar el ratón', type: 'toggle' },
      { adv: 1, k: 'fsLite', t: 'Pantalla completa ligera', d: 'En pantalla completa el chat se actualiza como máximo a 30 FPS para que el vídeo vaya fluido.', type: 'toggle', kw: 'fullscreen fluido lag tirones' }
    ] }
  ] },
  { id: 'extras', grp: 'Configuración', icon: 'star', title: 'Extras', groups: [
    { rows: [
      { k: 'listBadges', t: 'Indicador de chat en las listas de YouTube', d: 'Círculo azul junto al nombre del canal (y al verificado) y duración en azul en los vídeos que tienen chat: los ya vinculados o los que coinciden con un archivo de tu Drive según el «Parecido mínimo».', type: 'toggle', kw: 'punto círculo azul búsqueda inicio recomendados' },
      { k: 'ytHeatmap', t: 'Mapa de calor en la barra de YouTube', d: 'Colorea en azul la barra de progreso del vídeo según la actividad del chat.', type: 'toggle', kw: 'picos actividad progreso' },
      { k: 'showGraph', t: 'Gráfica de actividad en el chat', d: 'Barra arriba del chat con los picos. Clic para saltar, clic derecho para ver el top.', type: 'toggle', kw: 'picos' },
      { k: 'bookmarks', t: 'Marcadores', d: 'Botón 🔖 en el chat y Alt+B para guardar momentos con una nota. Salen en la barra de YouTube.', type: 'toggle', kw: 'guardar momentos notas' },
      { k: 'emoteCombo', t: 'Contador de spam de emotes', d: 'Cuando el chat spamea un emote aparece en grande con su contador (KEKW ×350).', type: 'toggle', kw: 'combo' },
      { adv: 1, k: 'comboMin', t: 'Mínimo para el contador', d: 'Veces que tiene que salir un emote en 8 segundos.', type: 'range', min: 5, max: 60, step: 1, fmt: v => v + ' veces' }
    ] }
  ] },
  { id: 'filters', grp: 'Configuración', icon: 'filter', title: 'Filtros y menciones', groups: [
    { title: 'Qué mensajes se ven', rows: [
      { adv: 1, k: 'showRoleStreamer', t: 'Streamer', type: 'toggle', kw: 'modos de chat' },
      { adv: 1, k: 'showRoleMod', t: 'Moderadores', type: 'toggle', kw: 'mods' },
      { adv: 1, k: 'showRoleVip', t: 'VIP', type: 'toggle' },
      { adv: 1, k: 'showRoleSub', t: 'Suscriptores', type: 'toggle', kw: 'subs' },
      { adv: 1, k: 'showRoleOther', t: 'Resto de usuarios', type: 'toggle' },
      { adv: 1, k: 'showEmoteOnly', t: 'Mensajes solo de emotes', type: 'toggle', kw: 'emotes' }
    ] },
    { title: 'Filtros', rows: [
      { k: 'myName', t: 'Tu nombre', d: 'Los mensajes que te mencionen se resaltan y suenan.', type: 'text', ph: 'tu_usuario' },
      { k: 'highlightWords', t: 'Palabras a resaltar', d: 'Separadas por comas.', type: 'area', ph: 'gta, illojuan, jaja' },
      { k: 'blockedWords', t: 'Palabras a ocultar', d: 'Los mensajes que las contengan no se muestran.', type: 'area', ph: 'spoiler, …' },
      { adv: 1, k: 'blockedUsers', t: 'Usuarios ocultos', d: 'También puedes ocultar a alguien desde su tarjeta en el chat.', type: 'area', ph: 'usuario1, usuario2' },
      { k: 'hideBots', t: 'Ocultar bots', d: 'Nightbot, StreamElements, Moobot, Fossabot…', type: 'toggle' },
      { adv: 1, k: 'hideNotices', t: 'Ocultar avisos de suscripción', type: 'toggle', kw: 'subs regalos' }
    ] }
  ] },
  { id: 'sounds', grp: 'Configuración', icon: 'sound', title: 'Sonidos', groups: [
    { rows: [
      { k: 'soundOn', t: 'Sonidos', type: 'toggle' },
      { k: 'soundVol', t: 'Volumen', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct },
      { adv: 1, k: 'soundUi', t: 'Clics y menús', type: 'toggle' },
      { adv: 1, k: 'soundHl', t: 'Menciones y palabras resaltadas', type: 'toggle' },
      { adv: 1, k: 'soundNotice', t: 'Suscripciones y regalos', type: 'toggle' },
      { adv: 1, k: 'soundLoad', t: 'Chat cargado / errores', type: 'toggle' },
      { adv: 1, t: 'Probar', type: 'button', label: '▶ Escuchar todos', act: () => ['click', 'toggle', 'mention', 'notice', 'success', 'error'].forEach((n, i) => setTimeout(() => Sound.play(n), i * 550)) }
    ] }
  ] },
  { id: 'sync', grp: 'Este vídeo', icon: 'sync', title: 'Sincronización', custom: renderSync, kw: 'desfase corte duración retraso adelanto' },
  { id: 'drive', grp: 'Datos', icon: 'drive', title: 'Google Drive', custom: renderDrive, kw: 'carpeta archivos json nube' },
  { id: 'library', grp: 'Datos', icon: 'lib', title: 'Biblioteca', custom: renderLibrary, kw: 'guardados borrar espacio' },
  { id: 'keys', grp: 'Ayuda', icon: 'key', title: 'Atajos', custom: renderKeys, kw: 'teclado atajos personalizados combinación teclas' },
  { id: 'about', grp: 'Ayuda', icon: 'info', title: 'Acerca de', custom: renderAbout, kw: 'créditos byalvaro actualizar actualización versión github release' }
];

/* ---------- Controles ---------- */
function set(k, v, noRender) {
  const prev = S; S = applyChange(S, k, v); saveSettings(S); applyUi(prev);
  if (!noRender && (PRESET_SENSITIVE.includes(k) || (prev.perfPreset !== S.perfPreset))) renderAll(true);
}
const PRESET_SENSITIVE = ['advanced', 'perfPreset', 'fps', 'maxMessages', 'maxPerSecond', 'smoothScroll', 'animatedEmotes', 'showGraph', 'motion', 'fontSize', 'driveFolder'];

function control(r) {
  const v = S[r.k];
  switch (r.type) {
    case 'seg': {
      const opts = r.opts.slice();
      const seg = h('div', { class: 'seg' + (r.icons ? ' icons' : '') });
      for (const [val, a, b] of opts) {
        const label = r.icons ? h('span', { html: I[a] }) : a;
        seg.append(h('button', { class: v === val ? 'on' : '', title: r.icons ? b : '', 'aria-pressed': v === val ? 'true' : 'false', onclick: () => { Sound.play('click'); set(r.k, val); refreshRow(seg, r); } }, label));
      }
      if (r.extra && v === r.extra) seg.append(h('button', { class: 'on ghost-on', disabled: true }, 'Personalizado'));
      return seg;
    }
    case 'select': {
      const s = h('select', { onchange: () => { Sound.play('click'); set(r.k, s.value); } }, r.opts.map(([val, l]) => h('option', { value: val, selected: v === val }, l)));
      if (r.font) s.style.fontFamily = FONT_STACKS[v] || '';
      return h('div', { class: 'sel' }, s);
    }
    case 'toggle':
      return h('button', { class: 'tg' + (v ? ' on' : ''), role: 'switch', 'aria-checked': v ? 'true' : 'false', onclick: e => { Sound.play('toggle'); set(r.k, !S[r.k]); e.currentTarget.classList.toggle('on', !!S[r.k]); e.currentTarget.setAttribute('aria-checked', S[r.k] ? 'true' : 'false'); } });
    case 'range': {
      const out = h('output', { text: r.fmt ? r.fmt(v) : v });
      const inp = h('input', { type: 'range', min: r.min, max: r.max, step: r.step, value: v });
      const paint = () => inp.style.setProperty('--p', ((inp.value - r.min) / (r.max - r.min) * 100) + '%');
      paint();
      inp.addEventListener('input', () => { const n = +inp.value; out.textContent = r.fmt ? r.fmt(n) : n; paint(); set(r.k, n, true); });
      inp.addEventListener('change', () => { Sound.play('tick'); renderAll(true); });
      return h('div', { class: 'rng' }, inp, out);
    }
    case 'text': {
      const i = h('input', { class: 'txt', type: 'text', value: v || '', placeholder: r.ph || '' });
      i.addEventListener('change', () => set(r.k, i.value.trim()));
      return i;
    }
    case 'area': {
      const i = h('textarea', { class: 'txt', placeholder: r.ph || '' }); i.value = v || '';
      i.addEventListener('change', () => set(r.k, i.value));
      return i;
    }
    case 'fsw': {
      const out = h('output', { text: fsw + ' px' });
      const inp = h('input', { type: 'range', min: 260, max: 900, step: 10, value: fsw });
      const paint = () => inp.style.setProperty('--p', ((inp.value - 260) / 640 * 100) + '%');
      paint();
      inp.addEventListener('input', () => { fsw = +inp.value; out.textContent = fsw + ' px'; paint(); chrome.storage.local.set({ tcr_fsw: fsw }); });
      inp.addEventListener('change', () => Sound.play('tick'));
      return h('div', { class: 'rng' }, inp, out);
    }
    case 'button': return h('button', { class: 'btn', onclick: () => { Sound.play('click'); r.act(); } }, r.label);
  }
  return null;
}
function refreshRow(seg, r) {
  const n = control(r); seg.replaceWith(n);
}
function rowText(r) { return [r.t, r.d, r.kw].filter(Boolean).join(' '); }
function row(r) {
  const lbl = h('div', { class: 'lbl' });
  const t = h('div', { class: 't' }); highlightInto(t, r.t, query); lbl.append(t);
  if (r.adv && !S.advanced) t.append(h('span', { class: 'advtag', text: 'Avanzada' }));
  if (r.d) { const d = h('div', { class: 'd' }); highlightInto(d, r.d, query); lbl.append(d); }
  const isArea = r.type === 'area';
  const el = h('div', { class: 'row' + (isArea ? ' col' : ''), 'data-search': rowText(r).toLowerCase() }, lbl, h('div', { class: 'ctl', style: isArea ? 'width:100%' : '' }, control(r)));
  if (query && rowText(r).toLowerCase().includes(query.toLowerCase())) el.classList.add('match');
  return el;
}
/** fila libre para secciones dinámicas */
function frow(t, d, ...ctl) {
  const lbl = h('div', { class: 'lbl' });
  const tt = h('div', { class: 't' }); highlightInto(tt, t, query); lbl.append(tt);
  if (d) { const dd = h('div', { class: 'd' }); typeof d === 'string' ? highlightInto(dd, d, query) : dd.append(d); lbl.append(dd); }
  const el = h('div', { class: 'row', 'data-search': (t + ' ' + (typeof d === 'string' ? d : '')).toLowerCase() }, lbl, h('div', { class: 'ctl' }, ...ctl));
  if (query && el.dataset.search.includes(query.toLowerCase())) el.classList.add('match');
  return el;
}

/* ---------- Secciones dinámicas ---------- */
function partsSection(sy, m) {
  const parts = sy.partsInfo && sy.partsInfo.length > 1 ? sy.partsInfo : null;
  if (!parts) return [];
  const send = (k, patch) => { Sound.play('tick'); bc.postMessage({ t: 'part', k, patch }); };
  const tIn = (val, ph) => { const i = h('input', { class: 'txt', value: val, placeholder: ph, style: 'min-width:0;width:92px;text-align:center;font-weight:600' }); i.addEventListener('focus', () => i.select()); return i; };
  const rel = (p, raw) => fmtTime(Math.max(0, raw - p.rawStart));
  const card = h('div', { class: 'card' }, parts.map((p, k) => {
    const isNow = sy.curPart === k;
    const mb = d => h('button', { class: 'btn sm', onclick: () => send(k, { off: (p.off || 0) + d }) }, (d > 0 ? '+' : '') + String(d).replace('.', ',') + ' s');
    const fIn = tIn(p.from != null ? rel(p, p.from) : '', 'inicio'), toIn = tIn(p.to != null ? rel(p, p.to) : '', 'final');
    const commit = () => {
      const f = fIn.value.trim() ? parseClock(fIn.value) : null, t = toIn.value.trim() ? parseClock(toIn.value) : null;
      if ((f != null && !isFinite(f)) || (t != null && !isFinite(t)) || (f != null && t != null && t <= f)) { Sound.play('error'); toast('Formato: 5:00 o 1:02:30; «hasta» después de «desde».'); return; }
      send(k, { from: f == null ? null : p.rawStart + f, to: t == null ? null : p.rawStart + t });
    };
    [fIn, toIn].forEach(i => { i.addEventListener('change', commit); i.addEventListener('keydown', e => { if (e.key === 'Enter') i.blur(); }); });
    const cAt = tIn(fmtTime(Math.max(state.ytNow || 0, p.atYt || 0)), '2:00'), cJ = tIn('', '+10:00');
    const addC = () => { const a = parseClock(cAt.value), j = parseClock(cJ.value); if (!isFinite(a) || !isFinite(j) || !j) { Sound.play('error'); toast('Escribe un minuto (2:00) y un salto (+10:00).'); return; } Sound.play('toggle'); bc.postMessage({ t: 'partCut', k, at: a, jump: j }); };
    return h('div', { class: 'item' + (isNow ? ' sugg' : ''), style: 'flex-wrap:wrap;align-items:flex-start' },
      h('div', { class: 'ic', text: `V${p.n}` }),
      h('div', { class: 'meta', style: 'min-width:240px' },
        h('div', { class: 't', title: p.name, text: (p.name || `VOD ${p.n}`).replace(/\.json(\.gz)?$/i, '') }),
        h('div', { class: 'd', text: [`${fmtNum(p.count)}${p.count !== p.countAll ? ' de ' + fmtNum(p.countAll) : ''} mensajes`, p.atYt == null ? '' : `se ve de ${fmtTime(p.atYt)} a ${fmtTime(p.endYt)} del vídeo`, isNow ? 'reproduciéndose ahora' : ''].filter(Boolean).join(' · ') }),
        h('div', { class: 'toolbar', style: 'margin:8px 0 0' }, h('span', { class: 'hint', text: 'Mover' }), mb(-5), mb(-1),
          h('span', { class: 'pill' + ((p.off || 0) ? ' blue' : ''), style: 'min-width:64px;justify-content:center', text: fmtSigned(p.off || 0) }), mb(1), mb(5),
          h('button', { class: 'btn sm', title: 'Ajustar este VOD eligiendo un mensaje suyo', onclick: () => { bc.postMessage({ t: 'pick', mode: 'part:' + k }); close(); } }, '🎯')),
        h('div', { class: 'toolbar', style: 'margin:6px 0 0' }, h('span', { class: 'hint', text: 'Chat desde' }), fIn, h('span', { class: 'hint', text: 'hasta' }), toIn),
        ...(p.cuts || []).map((c, ci) => h('div', { class: 'toolbar', style: 'margin:6px 0 0' },
          h('span', { class: 'pill', text: `✂ en ${fmtTime(c.yt || 0)} del vídeo · chat ${rel(p, c.at)} · ${fmtJump(c.jump)}` }),
          h('button', { class: 'btn sm danger', onclick: () => send(k, { cuts: p.cuts.filter((_, j) => j !== ci).map(x => ({ at: x.at, jump: x.jump })) }) }, 'Quitar'))),
        h('div', { class: 'toolbar', style: 'margin:6px 0 0' }, h('span', { class: 'hint', text: 'Salto en el minuto' }), cAt, h('span', { class: 'hint', text: 'de' }), cJ, h('button', { class: 'btn sm primary', onclick: addC }, '＋ Añadir'))),
      h('div', { class: 'acts' }, h('button', { class: 'btn sm', onclick: () => { if (port && p.atYt != null) port.postMessage({ type: 'seek', t: Math.max(0, p.atYt - 3) }); } }, 'Ir')));
  }));
  return [h('h3', { class: 'grp', text: `VODs del chat (${parts.length})` }),
    h('p', { class: 'hint', text: 'Cada VOD tiene sus propios ajustes y no mueven a los demás. Un VOD no empieza a verse hasta que termina el chat del anterior (lo que se pise se descarta). «Desde/Hasta» van en el tiempo del chat de ese VOD; el salto, en el minuto del vídeo.' }),
    card];
}
function renderSync(box) {
  if (!state || !state.vid) { box.append(h('p', { class: 'hint', text: 'Abre un vídeo de YouTube para ajustar su sincronización.' })); return; }
  if (!state.hasChat) { box.append(h('p', { class: 'hint', text: 'Este vídeo todavía no tiene chat. Elige uno en Google Drive o en la Biblioteca.' })); return; }
  const sy = state.sync, m = state.meta;
  const stTxt = { ok: ['La duración coincide', 'ok'], fixed: ['Ajustado con cortes', 'ok'], wait: ['Midiendo el vídeo…', ''], mismatch: ['Las duraciones no coinciden', 'warn'], manual: ['Ajuste manual', 'blue'] }[sy.status] || ['—', ''];
  box.append(h('div', { class: 'kv' },
    h('div', null, h('div', { class: 'k', text: 'Vídeo de YouTube' }), h('div', { class: 'v', text: fmtTime(state.ytDuration) })),
    h('div', null, h('div', { class: 'k', text: m && m.parts && m.parts.length > 1 ? `Chat de Twitch (${m.parts.length} partes)` : 'Chat de Twitch' }), h('div', { class: 'v', text: fmtTime(sy.chatEnd - sy.chatStart) })),
    h('div', null, h('div', { class: 'k', text: 'Desfase' }), h('div', { class: 'v', text: fmtSigned(sy.delta || 0) })),
    h('div', null, h('div', { class: 'k', text: 'Estado' }), h('div', { class: 'v' }, h('span', { class: 'pill ' + stTxt[1], text: stTxt[0] })))));
  box.append(h('div', { class: 'toolbar' }, h('button', { class: 'btn', disabled: !sy.canRedownload || !!state.loading, title: sy.canRedownload ? 'Descarga otra vez el chat y conserva toda la sincronización' : 'Este chat se cargó desde un archivo de tu PC', onclick: () => { Sound.play('click'); bc.postMessage({ t: 'redownload' }); toast('Volviendo a descargar el chat…'); } }, '↻ Volver a descargar el chat de este vídeo')));
  const mode = (state.link && state.link.sync && state.link.sync.mode) || 'auto';
  const seg = h('div', { class: 'seg' }, ...[['auto', 'Automático'], ['start', 'Alinear inicio'], ['end', 'Alinear final'], ['stretch', 'Estirar']].map(([v, l]) =>
    h('button', { class: mode === v ? 'on' : '', onclick: () => { Sound.play('click'); bc.postMessage({ t: 'sync', patch: { mode: v } }); } }, l)));
  const nb = d => h('button', { class: 'btn sm', onclick: () => { Sound.play('tick'); bc.postMessage({ t: 'sync', patch: { delta: Math.round(((sy.delta || 0) + d) * 10) / 10 } }); } }, (d > 0 ? '+' : '') + String(d).replace('.', ',') + ' s');
  box.append(
    ...(ADV() ? [frow('Modo', 'Automático compara la duración del vídeo con la del chat.', seg)] : []),
    frow('Ajuste fino', 'Mueve todo el chat antes o después. Atajos: Alt+, y Alt+.', nb(-5), nb(-1), nb(-0.5), nb(0.5), nb(1), nb(5), h('button', { class: 'btn sm', onclick: () => bc.postMessage({ t: 'sync', patch: { delta: 0 } }) }, 'Reiniciar')),
    frow('Ajustar con un mensaje', 'Pausa en un momento que reconozcas y pulsa el mensaje que corresponde.', h('button', { class: 'btn', onclick: () => { bc.postMessage({ t: 'pick', mode: 'delta' }); close(); } }, '🎯 Elegir mensaje')),
    ...(ADV() || (m && m.parts && m.parts.length > 1) ? partsSection(sy, m) : []),
    h('h3', { class: 'grp', text: 'Saltos del chat (cortes del vídeo)' }),
    h('p', { class: 'hint', text: 'YouTube no avisa de dónde se recortó un vídeo después de subirlo, pero la extensión sabe cuánto falta comparando duraciones. Ve justo después del corte (donde el chat empieza a ir adelantado) y pulsa «Corte aquí»: a partir de ese punto el chat pegará el mismo salto que el vídeo.' }),
    ...(Math.abs(sy.remaining) > 0.5 ? [h('p', null, h('span', { class: 'pill warn', text: `Sin compensar: ${fmtSigned(sy.remaining)}` }))] : []));
  const cuts = (sy.cuts || []);
  const tIn = (val, ph) => { const i = h('input', { class: 'txt', value: val, placeholder: ph, style: 'min-width:0;width:96px;text-align:center;font-weight:600' }); i.addEventListener('focus', () => i.select()); return i; };
  const listEl = h('div', { class: 'card' }, cuts.length ? cuts.map((c, k) => {
    const at = tIn(fmtTime(c.at), '2:00'), jp = tIn(fmtJump(c.jump), '+10:00');
    const commit = () => {
      const a = parseClock(at.value), j = parseClock(jp.value);
      if (!isFinite(a) || !isFinite(j) || !j) { Sound.play('error'); toast('Formato: 2:00 y +10:00'); at.value = fmtTime(c.at); jp.value = fmtJump(c.jump); return; }
      if (a !== c.at || j !== c.jump) bc.postMessage({ t: 'editCut', i: k, at: a, jump: j });
    };
    [at, jp].forEach(i => { i.addEventListener('change', commit); i.addEventListener('keydown', e => { if (e.key === 'Enter') i.blur(); }); });
    return h('div', { class: 'item' },
      h('div', { class: 'ic', text: '✂' }),
      h('div', { class: 'meta', style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap' }, h('span', { class: 'hint', text: 'En el minuto' }), at, h('span', { class: 'hint', text: 'el chat salta' }), jp,
        h('span', { class: 'hint', text: c.jump > 0 ? `(avanza ${fmtTime(c.jump)})` : `(retrocede ${fmtTime(-c.jump)})` })),
      h('div', { class: 'acts' },
        h('button', { class: 'btn sm', onclick: () => { if (port) port.postMessage({ type: 'seek', t: Math.max(0, c.at - 5) }); } }, 'Ir'),
        h('button', { class: 'btn sm danger', onclick: () => { Sound.play('close'); bc.postMessage({ t: 'delCut', i: k }); } }, 'Quitar')));
  }) : h('div', { class: 'empty', text: 'Sin saltos.' }));
  const nAt = tIn(fmtTime(state.ytNow || 0), '2:00'), nJ = tIn(Math.abs(sy.remaining) > 0.5 ? fmtJump(sy.remaining) : '', '+10:00');
  const add = () => {
    const a = parseClock(nAt.value), j = parseClock(nJ.value);
    if (!isFinite(a) || !isFinite(j) || !j) { Sound.play('error'); toast('Escribe un minuto (2:00) y un salto (+10:00).'); return; }
    bc.postMessage({ t: 'addCut', at: a, jump: j }); Sound.play('toggle'); toast(`Salto añadido en ${fmtTime(a)}`);
  };
  [nAt, nJ].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') add(); }));
  box.append(frow('Añadir salto del chat', 'Ej.: en 2:00 salta +10:00 si recortaste 10 min en el minuto 2. Con − el chat retrocede. Vale 2 (= 2 min), 2:30, 1:02:30, 90s o 10m.',
    h('span', { class: 'hint', text: 'En' }), nAt, h('span', { class: 'hint', text: 'salta' }), nJ, h('button', { class: 'btn primary', onclick: add }, '＋ Añadir')));
  box.append(listEl, h('div', { class: 'toolbar' },
    h('button', { class: 'btn primary', onclick: () => { bc.postMessage({ t: 'cutHere' }); Sound.play('toggle'); } }, `✂ Corte aquí${Math.abs(sy.remaining) > 0.5 ? ' (' + fmtSigned(sy.remaining) + ')' : ''}`),
    h('button', { class: 'btn', onclick: () => { bc.postMessage({ t: 'pick', mode: 'cut' }); close(); } }, '✂ Corte eligiendo un mensaje'),
    ADV() ? h('button', { class: 'btn danger', onclick: () => { bc.postMessage({ t: 'unlink' }); toast('Chat desvinculado · la sincronización se guarda'); } }, 'Desvincular chat') : null));
  box.append(...twitchSection(sy, m));
  box.append(...pasteSection(sy));
  if (m && ADV()) box.append(h('p', { class: 'hint', text: `Chat: ${m.streamer || '—'} · ${fmtNum(m.count)} mensajes · ${fmtNum(m.chatters)} personas${m.title ? ' · «' + m.title + '»' : ''}` }));
}

async function loadDrive(force) {
  if (!S.driveFolder) return;
  drive.busy = true; drive.error = null; renderAll(true);
  try { const c = await getFolderFiles(S.driveFolder, { force }); drive.files = c.files; drive.at = c.at; }
  catch (e) { drive.error = e.message; }
  drive.busy = false; renderAll(true);
}
function renderDrive(box) {
  const inp = h('input', { class: 'txt', value: S.driveFolder || '', placeholder: 'https://drive.google.com/drive/folders/…' });
  const save = () => {
    const v = inp.value.trim();
    if (v && !folderIdOf(v)) { toast('Pega el enlace de una CARPETA de Drive.'); Sound.play('error'); return; }
    set('driveFolder', v); drive.files = null; toast('Carpeta guardada'); loadDrive(true); bc.postMessage({ t: 'driveRefresh' });
  };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
  box.append(
    frow('Carpeta de Drive', 'Compartida como «Cualquier persona con el enlace». Los archivos se leen en el navegador: no se descarga nada a tu PC.', inp, h('button', { class: 'btn', onclick: save }, 'Guardar')),
    row({ k: 'driveAuto', t: 'Cargar automáticamente', d: 'Si el nombre de un .json se parece al título del vídeo de YouTube, se carga solo.', type: 'toggle' }),
    row({ k: 'driveAutoScore', t: 'Parecido mínimo del nombre', type: 'range', min: 0.5, max: 1, step: 0.05, fmt: pct }));
  if (state && state.loading) {
    const p = state.loading.p;
    box.append(h('div', { class: 'card', style: 'padding:14px;margin-top:10px' }, h('div', { text: `${state.loading.name ? state.loading.name + ' — ' : ''}${state.loading.stage}` }),
      h('div', { class: 'prog' }, h('i', { style: `width:${p == null ? 30 : Math.round(p * 100)}%` })),
      h('div', { class: 'toolbar' }, h('button', { class: 'btn sm', onclick: () => bc.postMessage({ t: 'cancelLoad' }) }, 'Cancelar'))));
  }
  const filterInp = h('input', { class: 'txt', type: 'search', placeholder: 'Filtrar archivos…', value: drive.filter });
  filterInp.addEventListener('input', debounce(() => { drive.filter = filterInp.value; renderAll(true); setTimeout(() => { const f = content.querySelector('#driveFilter'); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } }, 0); }, 200));
  filterInp.id = 'driveFilter';
  box.append(h('div', { class: 'toolbar' }, filterInp,
    h('button', { class: 'btn', disabled: drive.busy, onclick: () => { Sound.play('click'); loadDrive(true); } }, drive.busy ? 'Leyendo…' : '↻ Actualizar'),
    S.driveFolder ? h('a', { class: 'btn', href: S.driveFolder, target: '_blank', rel: 'noopener', style: 'text-decoration:none' }, 'Abrir en Drive') : null));
  if (!S.driveFolder) { box.append(h('div', { class: 'card empty', text: 'Pega arriba el enlace de tu carpeta de Drive.' })); return; }
  if (drive.error) { box.append(h('div', { class: 'card empty', style: 'color:var(--warn)', text: drive.error })); return; }
  if (!drive.files) { box.append(h('div', { class: 'card empty', text: drive.busy ? 'Leyendo la carpeta…' : '—' })); if (!drive.busy) loadDrive(false); return; }
  const savedByDrive = new Map((lib.infos || []).filter(i => i.source && i.source.type === 'drive').map(i => [i.source.id, i]));
  const curKeys = (state && (state.chatKeys || (state.chatKey ? [state.chatKey] : []))) || [];
  const busy = !!(state && state.loading);
  let groups = groupFiles(drive.files, state && state.ytTitle);
  const fq = drive.filter.trim().toLowerCase();
  if (fq) groups = groups.filter(g => (g.name + ' ' + g.files.map(f => f.name).join(' ') + ' ' + g.folder).toLowerCase().includes(fq));
  groups.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'es'));
  const card = h('div', { class: 'card' });
  if (!groups.length) card.append(h('div', { class: 'empty', text: fq ? 'Ningún archivo coincide.' : 'No hay archivos .json en la carpeta.' }));
  for (const g of groups) {
    const saved = g.files.map(f => savedByDrive.get(f.id));
    const allSaved = saved.every(Boolean);
    const keys = allSaved ? saved.map(i => i.key) : null;
    const isCur = allSaved && keys.join('|') === curKeys.join('|');
    const sugg = g.score >= 0.5;
    const srcs = g.files.map(f => ({ type: 'drive', id: f.id, name: f.name }));
    const meta = h('div', { class: 'meta' });
    const tt = h('div', { class: 't', title: g.files.map(f => f.name).join('\n') });
    highlightInto(tt, g.multi ? g.name : g.files[0].name.replace(/\.json(\.gz)?$/i, ''), drive.filter.trim()); meta.append(tt);
    const msgs = allSaved ? saved.reduce((a, i) => a + (i.count || 0), 0) : 0;
    meta.append(h('div', { class: 'd', text: [g.folder || 'Carpeta principal', g.multi ? g.files.map(f => f.part != null ? `parte ${f.part}` : 'sin número').join(' + ') : g.modified, allSaved ? `${fmtNum(msgs)} mensajes` : ''].filter(Boolean).join(' · ') }));
    const acts = h('div', { class: 'acts' });
    if (g.multi) acts.append(h('span', { class: 'pill blue', text: `${g.files.length} parte${g.files.length > 1 ? 's' : ''}` }));
    if (sugg && state && state.vid) acts.append(h('span', { class: 'pill blue', text: `Sugerido ${Math.round(g.score * 100)}%` }));
    if (isCur) acts.append(h('span', { class: 'pill ok', text: '✓ En este vídeo' }));
    else if (allSaved) acts.append(h('span', { class: 'pill', text: 'Guardado' }));
    else if (saved.some(Boolean)) acts.append(h('span', { class: 'pill', text: `${saved.filter(Boolean).length}/${g.files.length} guardadas` }));
    if (state && state.vid && !isCur) acts.append(h('button', { class: 'btn sm primary', disabled: busy, onclick: () => { Sound.play('click'); allSaved ? bc.postMessage({ t: 'link', chatKeys: keys }) : bc.postMessage({ t: 'loadGroup', srcs }); } }, 'Usar en este vídeo'));
    if (saved.some(Boolean)) acts.append(h('button', { class: 'btn sm', title: 'Volver a descargar desde Drive', disabled: busy, onclick: () => { Sound.play('click'); bc.postMessage({ t: 'refresh', srcs }); toast('Actualizando…'); } }, '↻'));
    card.append(h('div', { class: 'item' + (sugg ? ' sugg' : '') }, h('div', { class: 'ic', text: g.multi ? `×${g.files.length}` : 'JSON' }), meta, acts));
  }
  box.append(card, h('p', { class: 'hint', text: `${fmtNum(drive.files.length)} archivos · lista actualizada ${drive.at ? fmtDate(drive.at) : ''}. Consejo: nombra cada .json con el título del vídeo de YouTube para que se cargue solo. Si el directo se dividió, añade [[parte1]], [[parte2]]… al final del nombre: se unen en un solo chat.` }));
}

function renderBackup(box) {
  const prog = h('div', { class: 'hint', style: 'min-height:18px' });
  const download = (blob, name) => { const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); };
  const stamp = () => new Date().toISOString().slice(0, 10);
  const doExport = async withChats => {
    try {
      Sound.play('click');
      const r = await exportBackup({ withChats, onStage: t => { prog.textContent = t; } });
      download(r.blob, `chat-replay-${withChats ? 'copia-completa' : 'ajustes'}-${stamp()}.tcrbackup`);
      prog.textContent = `Copia creada ✓ · ${r.chats} chats · ${r.links} vídeos · ${fmtMB(r.blob.size)}`;
      Sound.play('success');
    } catch (e) { prog.textContent = 'Error: ' + e.message; Sound.play('error'); }
  };
  const file = h('input', { type: 'file', accept: '.tcrbackup,.gz,application/gzip', hidden: true, onchange: async () => {
    const f = file.files[0]; if (!f) return;
    try {
      const r = await importBackup(f, { onStage: t => { prog.textContent = t; } });
      prog.textContent = `Copia importada ✓ · ${r.chats} chats · ${r.links} vídeos`;
      Sound.play('success'); bc.postMessage({ t: 'reload' }); loadLibrary();
    } catch (e) { prog.textContent = 'Error: ' + e.message; Sound.play('error'); }
    file.value = '';
  } });
  box.append(h('h3', { class: 'grp', text: 'Copia de seguridad' }),
    frow('Exportar', 'Guarda en un archivo tus ajustes, la sincronización de cada vídeo (desfases, cortes, partes, marcadores) y, si quieres, los chats.',
      h('button', { class: 'btn primary', onclick: () => doExport(true) }, 'Todo (con chats)'),
      h('button', { class: 'btn', onclick: () => doExport(false) }, 'Solo ajustes y vídeos')),
    frow('Importar', 'Restaura una copia en este navegador u otro ordenador. Lo que ya tengas se mantiene; lo repetido se sustituye.',
      h('button', { class: 'btn', onclick: () => file.click() }, 'Importar copia…'), file),
    prog);
}
async function loadLibrary() {
  const [infos, links, usage] = await Promise.all([DB.all('info').catch(() => []), DB.all('links').catch(() => []), DB.usage()]);
  lib = { infos: infos.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)), links, usage };
  renderAll(true);
}
function renderLibrary(box) {
  if (!lib.infos) { box.append(h('div', { class: 'card empty', text: 'Cargando…' })); return; }
  const total = lib.infos.reduce((a, i) => a + (i.size || 0), 0);
  box.append(h('div', { class: 'kv' },
    h('div', null, h('div', { class: 'k', text: 'Chats guardados' }), h('div', { class: 'v', text: fmtNum(lib.infos.length) })),
    h('div', null, h('div', { class: 'k', text: 'Vídeos vinculados' }), h('div', { class: 'v', text: fmtNum(lib.links.length) })),
    h('div', null, h('div', { class: 'k', text: 'Espacio usado' }), h('div', { class: 'v', text: fmtMB(lib.usage || total) }))));
  const lim = S.storageLimit, used = lib.usage || total;
  const pctUsed = lim ? Math.min(100, used / (lim * 1048576) * 100) : 0;
  box.append(
    row({ k: 'storageLimit', t: 'Límite de almacenamiento', d: 'Al llegar al límite se borran los chats guardados (menos el del vídeo que estás viendo). La sincronización, los cortes y los marcadores se conservan, y cada chat se vuelve a descargar de Drive al abrir su vídeo.', type: 'seg', opts: [[512, '512 MB'], [1024, '1 GB'], [2048, '2 GB'], [5120, '5 GB'], [0, 'Sin límite']], kw: 'espacio borrar automático gb' }),
    lim ? h('div', { style: 'margin:6px 0 4px' },
      h('div', { class: 'hint', text: `Usado: ${fmtMB(used)} de ${lim >= 1024 ? (lim / 1024).toLocaleString('es-ES') + ' GB' : lim + ' MB'} (${Math.round(pctUsed)} %)` }),
      h('div', { class: 'prog' }, h('i', { style: `width:${pctUsed}%;${pctUsed > 85 ? 'background:var(--warn)' : ''}` }))) : null,
    h('div', { class: 'toolbar' }, h('button', { class: 'btn', onclick: async () => {
      const keep = (state && (state.chatKeys || (state.chatKey ? [state.chatKey] : []))) || [];
      const n = await DB.clearChatsExcept(keep);
      Sound.play('close'); toast(n ? `Borrados ${n} chats. Se volverán a descargar al abrir cada vídeo.` : 'No había nada que borrar.'); loadLibrary();
    } }, 'Liberar espacio ahora')));
  const card = h('div', { class: 'card', style: 'margin-top:14px' });
  if (!lib.infos.length) card.append(h('div', { class: 'empty', text: 'Todavía no has guardado ningún chat.' }));
  for (const i of lib.infos) {
    const lkeys = l => (l.chatKeys && l.chatKeys.length ? l.chatKeys : [l.chatKey]);
    const vids = lib.links.filter(l => lkeys(l).includes(i.key));
    const curKeys = (state && (state.chatKeys || (state.chatKey ? [state.chatKey] : []))) || [];
    const isCur = curKeys.includes(i.key);
    const meta = h('div', { class: 'meta' });
    const tt = h('div', { class: 't', title: i.title }); highlightInto(tt, i.title || i.fileName || i.key, query); meta.append(tt);
    meta.append(h('div', { class: 'd', text: [i.streamer, `${fmtNum(i.count)} mensajes`, fmtTime(i.length), fmtMB(i.size), fmtDate(i.updatedAt)].filter(Boolean).join(' · ') }));
    if (vids.length) meta.append(h('div', { class: 'd' }, 'En: ', ...vids.slice(0, 4).flatMap((l, k) => [k ? ', ' : '', h('a', { href: `https://www.youtube.com/watch?v=${l.vid}`, target: '_top', text: l.ytTitle || l.vid })])));
    const acts = h('div', { class: 'acts' });
    if (i.part != null) acts.append(h('span', { class: 'pill blue', text: `Parte ${i.part}` }));
    if (isCur) acts.append(h('span', { class: 'pill ok', text: curKeys.length > 1 ? `✓ Parte ${curKeys.indexOf(i.key) + 1} de este vídeo` : '✓ En este vídeo' }));
    else if (state && state.vid) {
      acts.append(h('button', { class: 'btn sm primary', onclick: () => { Sound.play('click'); bc.postMessage({ t: 'link', chatKeys: [i.key] }); } }, 'Usar en este vídeo'));
      if (curKeys.length) acts.append(h('button', { class: 'btn sm', title: 'Este chat empezará cuando acabe el que ya tiene el vídeo', onclick: () => { Sound.play('click'); bc.postMessage({ t: 'link', chatKeys: [...curKeys, i.key] }); } }, `＋ Como parte ${curKeys.length + 1}`));
    }
    if (i.source && i.source.type !== 'file') acts.append(h('button', { class: 'btn sm', title: 'Actualizar desde el origen', onclick: () => { Sound.play('click'); bc.postMessage({ t: 'refresh', srcs: [i.source.type === 'drive' ? { type: 'drive', id: i.source.id, name: i.source.name } : { type: 'url', url: i.source.url }] }); toast('Actualizando…'); } }, '↻'));
    const delBtn = h('button', { class: 'btn sm danger', onclick: async () => {
      if (!confirmDel.has(i.key)) { confirmDel.add(i.key); delBtn.textContent = '¿Seguro?'; setTimeout(() => { confirmDel.delete(i.key); delBtn.textContent = 'Borrar'; }, 3000); return; }
      confirmDel.delete(i.key); await DB.deleteChat(i.key); Sound.play('close'); toast('Chat borrado · la sincronización del vídeo se guarda'); bc.postMessage({ t: 'reload' }); loadLibrary();
    } }, 'Borrar');
    acts.append(delBtn);
    card.append(h('div', { class: 'item' }, h('div', { class: 'ic', text: (i.streamer || '?').slice(0, 2).toUpperCase() }), meta, acts));
  }
  box.append(card);
  if (lib.infos.length) {
    const all = h('button', { class: 'btn danger', onclick: async () => {
      if (all.dataset.c !== '1') { all.dataset.c = '1'; all.textContent = 'Pulsa otra vez para borrarlo TODO'; return; }
      await DB.clearChatsExcept([]); await DB.markAllNoAuto(); toast('Chats borrados · la sincronización de cada vídeo se guarda'); bc.postMessage({ t: 'reload' }); loadLibrary();
    } }, 'Borrar todos los chats');
    const wipe = h('button', { class: 'btn danger', title: 'Borra también los desfases, cortes, partes y marcadores de todos los vídeos', onclick: async () => {
      if (wipe.dataset.c !== '1') { wipe.dataset.c = '1'; wipe.textContent = 'Pulsa otra vez: se pierde TODA la sincronización'; return; }
      await DB.clearAll(); toast('Biblioteca y sincronización borradas'); bc.postMessage({ t: 'reload' }); loadLibrary();
    } }, 'Borrar también la sincronización');
    box.append(h('div', { class: 'toolbar' }, all, wipe));
  }
  renderBackup(box);
  box.append(h('p', { class: 'hint', text: 'Los chats se guardan para siempre en este navegador (IndexedDB) y se cargan al instante al volver a abrir el vídeo. La sincronización de cada vídeo (desfase, cortes, partes y marcadores) se guarda aparte: aunque borres sus chats, se aplica sola al volver a cargarlos. Un mismo chat puede usarse en varios vídeos (por ejemplo, un directo subido en partes).' }));
}
let keyRec = null;   // acción que está grabando una combinación
function renderKeys(box) {
  const B = bindings(S);
  const kb = combo => combo ? h('span', { class: 'kbds' }, ...keysOf(combo).map((x, i) => [i ? h('span', { class: 'plus', text: '+' }) : '', h('kbd', { text: x })]).flat()) : h('span', { class: 'hint', text: 'Sin atajo' });
  const save = map => { const out = {}; for (const a of ACTIONS) if ((map[a.id] || '') !== (KDEF[a.id] || '')) out[a.id] = map[a.id] || ''; set('keys', Object.keys(out).length ? out : null); renderAll(true); };
  box.append(h('p', { class: 'hint', text: 'Pulsa «Cambiar» y luego la combinación que quieras (con Ctrl, Alt o Win, o una tecla F1–F12). Esc cancela. Funcionan en YouTube y con el chat enfocado.' }));
  const card = h('div', { class: 'card keyed' });
  for (const a of ACTIONS) {
    const cur = B[a.id] || '', isDef = cur === (KDEF[a.id] || '');
    const rec = keyRec === a.id;
    const btnC = h('button', { class: 'btn sm' + (rec ? ' primary' : ''), onclick: () => { keyRec = rec ? null : a.id; Sound.play('click'); renderAll(true); } }, rec ? 'Pulsa la combinación…' : 'Cambiar');
    const btnX = h('button', { class: 'btn sm', title: 'Quitar el atajo', disabled: !cur, onclick: () => { save({ ...B, [a.id]: '' }); Sound.play('click'); } }, '✕');
    const btnR = h('button', { class: 'btn sm', title: 'Volver al de siempre' + (KDEF[a.id] ? ' (' + fmtCombo(KDEF[a.id]) + ')' : ' (ninguno)'), disabled: isDef, onclick: () => { save({ ...B, [a.id]: KDEF[a.id] || '' }); Sound.play('click'); } }, '↺');
    card.append(h('div', { class: 'krow' + (rec ? ' rec' : '') }, h('div', { class: 'kt', text: a.t }), h('div', { class: 'kv2' }, kb(cur)), h('div', { class: 'kb' }, btnC, btnX, btnR)));
  }
  box.append(card);
  box.append(h('div', { class: 'toolbar' }, h('button', { class: 'btn', disabled: !S.keys, onclick: () => { set('keys', null); keyRec = null; renderAll(true); toast('Atajos restablecidos'); } }, '↺ Restablecer todos')));
  box.append(h('h3', { class: 'grp', text: 'Otros (fijos)' }));
  const k = (keys, txt) => [h('div', null, ...keys.map((x, i) => [i ? ' ' : '', h('kbd', { text: x })])), h('div', { class: 'hint', style: 'color:var(--fg2)', text: txt })];
  box.append(h('div', { class: 'card', style: 'padding:16px' }, h('div', { class: 'keys' },
    ...k(['Esc'], 'Cerrar menús'),
    ...k(['Espacio', 'K', 'J', 'L', '←', '→', 'M', 'F'], 'Con el chat enfocado: los atajos de YouTube siguen funcionando'),
    ...k(['Clic'], 'En un nombre: tarjeta del usuario · En la hora: saltar a ese momento'),
    ...k(['Clic derecho'], 'En la gráfica: momentos con más chat'))));
}
// grabar la combinación
document.addEventListener('keydown', e => {
  if (!keyRec) return;
  e.preventDefault(); e.stopPropagation();
  if (e.key === 'Escape') { keyRec = null; renderAll(true); return; }
  const c = comboOf(e);
  if (!c) return;
  if (!validCombo(c)) { toast('Usa Ctrl, Alt o Win con otra tecla, o una tecla F1–F12'); Sound.play('error'); return; }
  const B = bindings(S), id = keyRec;
  const other = ACTIONS.find(a => a.id !== id && B[a.id] === c);
  const map = { ...B, [id]: c };
  if (other) map[other.id] = '';
  keyRec = null;
  const out = {}; for (const a of ACTIONS) if ((map[a.id] || '') !== (KDEF[a.id] || '')) out[a.id] = map[a.id] || '';
  set('keys', Object.keys(out).length ? out : null); renderAll(true);
  Sound.play('success');
  toast(other ? `${fmtCombo(c)} ya lo usaba «${other.t}»: se le ha quitado` : RESERVED.includes(c) ? `${fmtCombo(c)} guardado (ojo: el navegador también lo usa)` : `${fmtCombo(c)} guardado`);
}, true);
function renderAbout(box) {
  box.append(h('div', { class: 'card', style: 'padding:22px;display:flex;gap:22px;align-items:center;flex-wrap:wrap' },
    h('div', { class: 'press-card', style: 'padding:18px 20px' }, h('span', { class: 'press-in', style: 'font-size:22px', text: 'HECHO POR' }), h('span', { class: 'stand-out', style: 'font-size:26px', text: '@BYALVARO__' })),
    h('div', null, h('div', { style: 'font-weight:600;font-size:16px', text: 'Chat Replay · Twitch en YouTube' }),
      h('div', { class: 'hint', text: `Versión ${chrome.runtime.getManifest().version}. Chats de TwitchDownloaderWPF sincronizados con YouTube.` }),
      h('div', { class: 'toolbar' }, h('button', { class: 'btn', onclick: () => showSplash(true) }, 'Ver animación')))));
  /* Actualizaciones desde GitHub */
  box.append(h('h3', { class: 'grp', text: 'Actualizaciones' }));
  const stTxt = h('div', { class: 'hint', style: 'white-space:pre-line' });
  const paint = u => {
    if (!u) { stTxt.textContent = '…'; return; }
    const when = u.at ? ` · comprobado ${ago(u.at)}` : '';
    stTxt.textContent = u.error ? `⚠ ${u.error}${when}`
      : u.newer ? `Hay una versión nueva: ${u.latest} (tienes la ${u.current})${when}`
      : u.latest ? `✓ Tienes la última versión (${u.current})${when}` : `Tienes la ${u.current}${when}`;
    dl.hidden = !(u.newer && u.info); rl.hidden = !(u.newer && u.info);
    if (u.info) dl.onclick = () => window.open(u.info.url || u.info.page, '_blank', 'noopener');
  };
  const chk = h('button', { class: 'btn', onclick: async e => { const b = e.currentTarget; b.disabled = true; paint(null); const u = await ask({ cmd: 'updCheck', force: true }); b.disabled = false; paint(u); Sound.play(u && u.ok ? (u.newer ? 'success' : 'click') : 'error'); } }, '↻ Buscar ahora');
  const dl = h('button', { class: 'btn primary', hidden: true }, 'Descargar');
  const rl = h('button', { class: 'btn', hidden: true, onclick: async e => { e.currentTarget.textContent = 'Recargando…'; e.currentTarget.disabled = true; if (port) port.postMessage({ type: 'reloadPage', ms: 1400 }); await ask({ cmd: 'updReload' }); } }, 'Ya está → Recargar');
  box.append(frow('Versión instalada', `Chat Replay ${chrome.runtime.getManifest().version}. Las versiones nuevas salen del repositorio de GitHub de abajo (su version.json).`, chk, dl, rl), stTxt);
  if (ADV()) box.append(row({ k: 'updCheck', t: 'Avisar en YouTube si hay versión nueva', d: 'Al abrir YouTube sale un aviso con «Descargar» y «Recargar». Se comprueba como mucho cada 3 horas.', type: 'toggle' }));
  box.append(row({ k: 'updMode', t: 'Cómo actualizar', d: 'Automática: reemplaza los archivos en la carpeta de la extensión y recarga YouTube en el mismo minuto (sin descargar nada). Manual: bajas el zip y lo descomprimes tú.', type: 'select', opts: [['ask', 'Preguntar cada vez'], ['auto', '⚡ Automática'], ['manual', '📦 Manual']] }));
  const dirTxt = h('span', { class: 'hint', text: '…' });
  const forget = h('button', { class: 'btn', hidden: true, onclick: async () => { const SU = await import('./shared/selfupdate.js'); await SU.forgetDir(); paintDir(); toast('Carpeta olvidada: la próxima vez te la pedirá.'); } }, 'Olvidar carpeta');
  const paintDir = async () => {
    try { const SU = await import('./shared/selfupdate.js'); const d = await SU.getDir(); dirTxt.textContent = d ? `«${d.name}»${(await SU.permOf(d, false)) ? ' · con permiso' : ' · Chrome pedirá confirmar el permiso'}` : 'Aún no elegida (te la pide la primera actualización automática).'; forget.hidden = !d; }
    catch { dirTxt.textContent = 'No disponible.'; }
  };
  if (ADV()) box.append(frow('Carpeta de la extensión', 'La que eliges la primera vez que actualizas en automático. Solo se modifica esa carpeta.', dirTxt, forget));
  paintDir();
  if (ADV()) box.append(row({ k: 'updRepo', t: 'Repositorio de GitHub', d: 'usuario/repositorio (o el enlace). Tiene que ser público y tener el version.json y el .zip (o una «Release»).', type: 'text', ph: 'ByAlvaroo/CHAT-DE-YT' }));
  if (ADV()) box.append(h('p', { class: 'hint', text: 'Para publicar una versión: copia la carpeta y el .zip nuevos en tu repositorio, cambia el número en version.json y haz «Commit» + «Push» en GitHub Desktop. A los que tengan la extensión les saldrá el aviso al abrir YouTube.' }));
  ask({ cmd: 'updStatus' }).then(paint);
}

/* ---------- Cuenta y configuración de ByAlvaro ---------- */
let acct = null;                 // última respuesta del segundo plano
const ui = { name: '', pass: '', tw: '', owner: '', repo: '', token: '', resetOpen: false, pickVids: null, confirmAll: false, paste: '' };
const ask = m => chrome.runtime.sendMessage(m).catch(e => ({ ok: false, error: e.message }));
const refreshAcct = debounce(async () => { acct = await ask({ t: 'acct-get' }); renderAll(true); }, 120);
try {
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'local' && ('tcr_account' in ch || 'tcr_follow' in ch || 'tcr_pub' in ch || 'tcr_acct_status' in ch)) refreshAcct();
  });
} catch {}
const ago = t => {
  if (!t) return '—';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'hace un momento';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return fmtDate(t);
};
const kb = b => (b / 1024).toFixed(1).replace('.', ',') + ' KB';
async function act(btn, msg, okText) {
  if (btn) btn.disabled = true;
  const r = await ask(msg);
  if (btn) btn.disabled = false;
  if (r && r.ok === false) { toast(r.error || 'No se pudo'); Sound.play('error'); }
  else { if (okText) toast(typeof okText === 'function' ? okText(r) : okText); Sound.play('success'); }
  acct = await ask({ t: 'acct-get' }); renderAll(true);
  return r;
}

function renderAccount(box) {
  if (!acct) { box.append(h('p', { class: 'hint', text: 'Cargando…' })); refreshAcct(); return; }
  const a = acct.account;
  /* Sesión */
  box.append(h('h3', { class: 'grp', text: 'Sesión' }));
  const knownBox = (exclude) => {
    const l = (acct.known || []).filter(x => x.slug !== exclude);
    if (!l.length) return null;
    return h('div', { class: 'accts' }, ...l.map(x => h('div', { class: 'acct' },
      h('button', { class: 'acct-b', title: 'Iniciar sesión con esta cuenta', onclick: () => { ui.name = x.name; ui.pass = ''; ui.amode = 'login'; if (a) { act(null, { t: 'acct-logout' }, `Escribe la contraseña de ${x.name}`); } else renderAll(true); setTimeout(() => { const i = document.querySelector('#sec-account input[type=password]'); if (i) i.focus(); }, 120); } },
        h('span', { class: 'av', text: x.name.slice(0, 1).toUpperCase() }), h('span', { text: x.name })),
      h('button', { class: 'acct-x', title: 'Quitar de esta lista (la cuenta no se borra)', onclick: () => act(null, { t: 'acct-forget', slug: x.slug }, 'Quitada de la lista') }, '✕'))));
  };
  if (!a) {
    const mode = ui.amode || ((acct.known || []).length ? 'login' : 'create');
    const tabs = h('div', { class: 'seg' },
      h('button', { class: mode === 'login' ? 'on' : '', onclick: () => { ui.amode = 'login'; Sound.play('click'); renderAll(true); } }, 'Iniciar sesión'),
      h('button', { class: mode === 'create' ? 'on' : '', onclick: () => { ui.amode = 'create'; Sound.play('click'); renderAll(true); } }, 'Crear cuenta'));
    box.append(h('div', { style: 'margin:4px 0 10px' }, tabs));
    const inp = h('input', { class: 'txt', type: 'text', placeholder: 'Nombre de la cuenta', value: ui.name, maxlength: 40, autocomplete: 'username' });
    const pw = h('input', { class: 'txt', type: 'password', placeholder: mode === 'create' ? 'Elige una contraseña (mín. 4)' : 'Contraseña', value: ui.pass, maxlength: 128, autocomplete: mode === 'create' ? 'new-password' : 'current-password' });
    const pw2 = h('input', { class: 'txt', type: 'password', placeholder: 'Repite la contraseña', value: '', maxlength: 128, autocomplete: 'new-password' });
    const info = h('p', { class: 'hint', style: 'min-height:18px;margin-top:6px' });
    let chk = null, chkT = 0;
    const paintChk = () => {
      const legacy = mode === 'login' && chk && chk.slug && chk.exists && !chk.hasPass;
      pw2.hidden = !(mode === 'create' || legacy);
      if (legacy) pw.placeholder = 'Elige una contraseña (mín. 4)';
      info.textContent = !chk || !chk.slug ? (mode === 'create' ? 'Elige un nombre y una contraseña. Puedes tener varias cuentas y cambiar entre ellas.' : 'Escribe el nombre de tu cuenta y su contraseña.')
        : chk.blocked ? '⚠ Esta cuenta está bloqueada por el administrador.'
        : mode === 'create' ? (chk.exists ? '⚠ Ese nombre ya tiene cuenta: usa «Iniciar sesión» o elige otro.' : chk.github ? 'Este nombre está en el archivo de cuentas de GitHub: usa la contraseña que te dio el administrador.' : '✓ Nombre libre.')
        : chk.github ? 'Cuenta gestionada por el administrador (GitHub): escribe la contraseña que te dio.'
        : chk.hasPass ? 'Escribe la contraseña de esta cuenta.'
        : chk.exists ? 'Esta cuenta es de antes y aún no tiene contraseña: elige una ahora.'
        : '⚠ No hay ninguna cuenta con ese nombre en este navegador. Créala en «Crear cuenta».';
    };
    const doCheck = async () => { const n = inp.value; if (!n.trim()) { chk = null; paintChk(); return; } const r = await ask({ t: 'acct-check', name: n }); if (inp.value === n) { chk = r && r.ok !== false ? r : null; paintChk(); } };
    inp.addEventListener('input', () => { ui.name = inp.value; clearTimeout(chkT); chkT = setTimeout(doCheck, 250); });
    pw.addEventListener('input', () => { ui.pass = pw.value; });
    const go = h('button', { class: 'btn primary', onclick: async () => {
      if (!inp.value.trim()) { inp.focus(); return; }
      if (!pw.value) { pw.focus(); return; }
      await doCheck();
      if (!pw2.hidden && pw2.value !== pw.value) { toast(pw2.value ? 'Las dos contraseñas no coinciden.' : 'Repite la contraseña para confirmarla.'); Sound.play('error'); pw2.focus(); return; }
      const r = await act(go, { t: 'acct-login', name: inp.value, pass: pw.value, mode }, r => r.created && mode === 'create' ? `Cuenta «${r.name}» creada ✓` : r.existed ? `Hola, ${r.name}: tu configuración se ha recuperado ✓` : r.preset ? `Hola, ${r.name}: configuración de ByAlvaro puesta ✓` : `Sesión iniciada como ${r.name} ✓`);
      if (r && r.ok !== false) { ui.name = ''; ui.pass = ''; ui.amode = ''; }
    } }, mode === 'create' ? 'Crear cuenta' : 'Iniciar sesión');
    for (const i of [inp, pw, pw2]) i.addEventListener('keydown', e => { if (e.key === 'Enter') go.click(); });
    const fields = h('div', { style: 'display:flex;flex-direction:column;gap:8px;min-width:220px' }, inp, pw, pw2);
    box.append(frow(mode === 'create' ? 'Crear cuenta' : 'Iniciar sesión', 'Tus ajustes, la posición del chat y la sincronización de cada vídeo se guardan en tu cuenta. Al reinstalar la extensión o en otro ordenador (con la misma cuenta de Chrome), inicia sesión y vuelve todo.', fields, go));
    box.append(info);
    const kb2 = knownBox(null);
    if (kb2) box.append(h('h3', { class: 'grp', text: 'Cuentas en este navegador' }), kb2);
    paintChk(); if (ui.name) doCheck();
  } else {
    const st = acct.status, meta = acct.meta;
    const line = st && st.ok === false ? `⚠ ${st.error}` : meta ? `Guardado en tu cuenta ${ago(meta.at)} · ${kb(meta.bytes || 0)} de 100 KB` : 'Guardando…';
    box.append(h('div', { class: 'card', style: 'padding:16px;display:flex;align-items:center;gap:14px;flex-wrap:wrap' },
      h('div', { style: 'width:44px;height:44px;border-radius:50%;background:var(--accent);color:#fff;display:grid;place-items:center;font-weight:700;font-size:19px;flex:none', text: a.name.slice(0, 1).toUpperCase() }),
      h('div', { style: 'flex:1;min-width:180px' }, h('div', { style: 'font-weight:600;font-size:16px', text: a.name }), h('div', { class: 'hint', style: 'margin:2px 0 0', text: line })),
      h('div', { class: 'toolbar', style: 'margin:0' },
        h('button', { class: 'btn sm', onclick: e => act(e.currentTarget, { t: 'acct-sync' }, 'Sincronizado ✓') }, '↻ Sincronizar ahora'),
        h('button', { class: 'btn sm danger', onclick: e => act(e.currentTarget, { t: 'acct-logout' }, 'Sesión cerrada · tus ajustes siguen guardados en tu cuenta') }, 'Cerrar sesión'))));
    box.append(h('p', { class: 'hint', text: 'Se guarda solo al cambiar cualquier cosa. Para que llegue a otros ordenadores, Chrome tiene que tener activada la sincronización de «Extensiones».' }));
    /* Varias cuentas */
    box.append(h('h3', { class: 'grp', text: 'Otras cuentas' }));
    const kb3 = knownBox(a.slug);
    if (kb3) box.append(kb3);
    box.append(h('div', { class: 'toolbar' }, h('button', { class: 'btn', onclick: () => { ui.amode = 'create'; ui.name = ''; ui.pass = ''; act(null, { t: 'acct-logout' }, 'Tu cuenta queda guardada. Crea la nueva:'); } }, '＋ Crear otra cuenta'), h('button', { class: 'btn', onclick: () => { ui.amode = 'login'; ui.name = ''; ui.pass = ''; act(null, { t: 'acct-logout' }, 'Inicia sesión con otra cuenta'); } }, 'Iniciar sesión con otra')));
    /* Contraseña */
    box.append(h('h3', { class: 'grp', text: 'Contraseña' }));
    if (acct.github) box.append(h('p', { class: 'hint', text: '🔒 La contraseña de esta cuenta la gestiona el administrador en GitHub (cuentas.json). Si la cambia allí, se te pedirá la nueva.' }));
    else {
    const op = h('input', { class: 'txt', type: 'password', placeholder: 'Contraseña actual', maxlength: 128, autocomplete: 'current-password' });
    const np = h('input', { class: 'txt', type: 'password', placeholder: acct.hasPass ? 'Contraseña nueva' : 'Elige una contraseña', maxlength: 128, autocomplete: 'new-password' });
    const np2 = h('input', { class: 'txt', type: 'password', placeholder: 'Repítela', maxlength: 128, autocomplete: 'new-password' });
    op.hidden = !acct.hasPass;
    const save = h('button', { class: 'btn' + (acct.hasPass ? '' : ' primary'), onclick: async e => {
      if (np.value.length < 4) { toast('La contraseña tiene que tener al menos 4 caracteres.'); Sound.play('error'); np.focus(); return; }
      if (np.value !== np2.value) { toast('Las dos contraseñas no coinciden.'); Sound.play('error'); np2.focus(); return; }
      await act(e.currentTarget, { t: 'acct-pass', old: op.value, pass: np.value }, r => r.created ? 'Contraseña puesta ✓' : 'Contraseña cambiada ✓');
    } }, acct.hasPass ? 'Cambiar contraseña' : 'Poner contraseña');
    box.append(frow(acct.hasPass ? 'Cambiar contraseña' : '⚠ Tu cuenta no tiene contraseña', acct.hasPass ? 'Te la pedirá al iniciar sesión en cualquier navegador.' : 'Ponle una: desde entonces hará falta para iniciar sesión con este nombre.',
      h('div', { style: 'display:flex;flex-direction:column;gap:8px;min-width:200px' }, op, np, np2), save));
    }
  }
  /* Administrador: cuentas.json en GitHub */
  if (ADV() || acct.byalvaro) {
    const rm = acct.remote || {};
    box.append(h('h3', { class: 'grp', text: 'Cuentas en GitHub (administrador)' }));
    box.append(h('p', { class: 'hint', text: `Con un cuentas.json en ${rm.repo || 'el repositorio de las actualizaciones'} puedes poner o cambiar la contraseña de cualquier cuenta, o bloquearla. Lo que diga el archivo manda, y si cambias una contraseña se cierra la sesión de quien la tuviera abierta (se comprueba cada 30 min). ` + (rm.error ? `⚠ ${rm.error}` : rm.none ? 'Aún no hay cuentas.json.' : `Ahora tiene ${rm.n} cuenta${rm.n === 1 ? '' : 's'}.`) }));
    const gn = h('input', { class: 'txt', type: 'text', placeholder: 'Nombre de la cuenta', value: ui.gname || '', autocomplete: 'off' });
    const gp = h('input', { class: 'txt', type: 'password', placeholder: 'Contraseña nueva', autocomplete: 'new-password' });
    const out = h('textarea', { class: 'txt', readonly: true, style: 'height:74px;font-family:ui-monospace,Consolas,monospace;font-size:11.5px', placeholder: 'Aquí sale la línea para cuentas.json' });
    gn.addEventListener('input', () => { ui.gname = gn.value; });
    const gen = h('button', { class: 'btn primary', onclick: async e => {
      const r = await ask({ t: 'acct-entry', name: gn.value, pass: gp.value });
      if (!r || r.ok === false) { toast((r && r.error) || 'No se ha podido'); Sound.play('error'); return; }
      out.value = `"${r.slug}": ${JSON.stringify(r.entry)}`; gp.value = '';
      try { await navigator.clipboard.writeText(out.value); toast('Línea copiada ✓ · pégala dentro de "cuentas" en cuentas.json'); } catch { out.select(); toast('Copia la línea y pégala en cuentas.json'); }
      Sound.play('success');
    } }, 'Generar línea');
    box.append(frow('Línea para cuentas.json', 'Escribe el nombre y la contraseña: sale la línea lista (solo la huella cifrada, nunca la contraseña, porque el repositorio es público). Para bloquear una cuenta: "nombre": {"bloqueada": true}.', h('div', { style: 'display:flex;flex-direction:column;gap:8px;min-width:200px' }, gn, gp), gen), out);
    box.append(h('div', { class: 'toolbar' }, h('button', { class: 'btn sm', onclick: e => act(e.currentTarget, { t: 'acct-remote' }, r => r.ok ? (r.none ? 'No hay cuentas.json en el repositorio' : `cuentas.json leído ✓ (${Object.keys(r.map || {}).length} cuentas)`) : '⚠ ' + (r.error || 'Error')) }, '↻ Leer cuentas.json ahora')));
  }

  /* ByAlvaro publica */
  if (acct.byalvaro) {
    const p = acct.pub || {};
    box.append(h('h3', { class: 'grp', text: 'Publicar tu configuración para todos' }));
    const mk = (k, ph, type = 'text') => { const i = h('input', { class: 'txt', type, placeholder: ph, value: ui[k] || (k === 'token' ? '' : p[k] || ''), autocomplete: 'off', spellcheck: 'false' }); i.style.minWidth = '200px'; i.addEventListener('input', () => { ui[k] = i.value; }); return i; };
    const own = mk('owner', 'usuario de GitHub'), rep = mk('repo', 'repositorio'), tok = mk('token', p.hasToken ? '•••••••• (guardado)' : 'token de GitHub', 'password');
    const save = h('button', { class: 'btn primary', onclick: async e => {
      const r = await act(e.currentTarget, { t: 'pub-save', cfg: { owner: own.value, repo: rep.value, token: tok.value } }, r => r.rev ? `Publicado ✓ (versión ${r.rev})` : 'Guardado');
      if (r && r.ok !== false) ui.token = '';
    } }, 'Guardar y publicar');
    const stLine = p.error ? `⚠ ${p.error}` : p.at ? `Publicado ${ago(p.at)} · versión ${p.rev}` : acct.publisher ? 'Listo para publicar' : 'Sin publicar todavía';
    box.append(
      frow('Repositorio de GitHub', 'Público. Ahí se guarda el archivo que leen los demás.', own, rep),
      frow('Token', 'Solo se guarda en este navegador. Es lo que hace que únicamente tú puedas publicar como ByAlvaro (GitHub → Settings → Developer settings → Fine-grained tokens, permiso «Contents: Read and write» en ese repositorio).', tok),
      h('div', { class: 'toolbar' }, save, h('button', { class: 'btn', disabled: !acct.publisher, onclick: e => act(e.currentTarget, { t: 'pub-now' }, r => r.same ? 'Ya estaba publicado' : `Publicado ✓ (versión ${r.rev})`) }, '⇪ Publicar ahora'),
        p.hasToken ? h('button', { class: 'btn danger sm', onclick: e => act(e.currentTarget, { t: 'pub-forget' }, 'Token borrado de este navegador') }, 'Borrar token') : null),
      h('p', { class: 'hint', text: `${stLine}. Cada cambio que hagas (ajustes, desfases, cortes, el chat de cada vídeo) se publica solo a los pocos segundos.` }));
    if (acct.publisher) return;
  }

  /* Los demás siguen a ByAlvaro */
  const f = acct.follow || {};
  box.append(h('h3', { class: 'grp', text: 'Configuración de ByAlvaro' }));
  const tg = h('button', { class: 'tg' + (f.on ? ' on' : ''), role: 'switch', 'aria-checked': f.on ? 'true' : 'false', onclick: e => { Sound.play('toggle'); act(e.currentTarget, { t: 'feed-follow', on: !f.on }); } });
  box.append(frow('Seguir la configuración de ByAlvaro', 'Sus ajustes y la sincronización de sus vídeos te llegan solos. Lo que cambies tú se queda como lo dejes: sus cambios ya no lo pisan.', tg));
  const ov = f.overrides || { settings: [], videos: [] };
  const stTxt = f.error ? `⚠ ${f.error}` : !f.source ? 'Todavía no hay dónde leerla.' : !f.has ? (f.checkedAt ? 'ByAlvaro todavía no ha publicado su configuración.' : 'Comprobando…') : `Versión ${f.rev} de ByAlvaro · actualizada ${ago(f.at)} · comprobado ${ago(f.checkedAt)}`;
  const ovTxt = ov.settings.length || ov.videos.length ? ` Has cambiado ${ov.settings.length} ajuste${ov.settings.length === 1 ? '' : 's'} y ${ov.videos.length} vídeo${ov.videos.length === 1 ? '' : 's'}: esos se quedan como los dejaste.` : '';
  box.append(h('p', { class: 'hint', text: stTxt + ovTxt }));
  box.append(h('div', { class: 'toolbar' },
    h('button', { class: 'btn', onclick: e => act(e.currentTarget, { t: 'feed-check' }, r => r.none ? 'ByAlvaro todavía no ha publicado nada' : r.changed && r.changed.length ? 'Actualizado ✓' : 'Ya tienes lo último ✓') }, '↻ Comprobar ahora'),
    h('button', { class: 'btn primary', disabled: !f.has, onclick: () => { Sound.play('click'); ui.resetOpen = !ui.resetOpen; ui.pickVids = null; ui.confirmAll = false; renderAll(true); } }, '↺ Restablecer a ByAlvaro…')));

  if (ui.resetOpen && f.has) {
    const card = h('div', { class: 'card', style: 'padding:14px' });
    const allBtn = h('button', { class: 'btn' + (ui.confirmAll ? ' danger' : ''), onclick: e => {
      if (!ui.confirmAll) { ui.confirmAll = true; renderAll(true); return; }
      ui.resetOpen = false; ui.confirmAll = false;
      act(e.currentTarget, { t: 'feed-reset', scope: 'all' }, 'Todo como ByAlvaro ✓');
    } }, ui.confirmAll ? '¿Seguro? Pulsa otra vez' : 'Todo: ajustes y todos sus vídeos');
    card.append(
      h('div', { class: 'hint', style: 'margin:0 0 10px', text: '¿Qué quieres dejar igual que ByAlvaro? Lo que elijas vuelve a actualizarse solo con sus cambios.' }),
      h('div', { class: 'toolbar', style: 'margin:0' },
        h('button', { class: 'btn', onclick: e => { ui.resetOpen = false; act(e.currentTarget, { t: 'feed-reset', scope: 'settings' }, 'Ajustes como ByAlvaro ✓'); } }, 'Solo los ajustes'),
        allBtn,
        h('button', { class: 'btn' + (ui.pickVids ? ' primary' : ''), onclick: () => { Sound.play('click'); ui.pickVids = ui.pickVids ? null : new Set(ov.videos); renderAll(true); } }, 'Elegir vídeos…')));
    if (ui.pickVids) {
      const vids = (f.videos || []).slice().sort((x, y) => (ov.videos.includes(y.vid) - ov.videos.includes(x.vid)) || x.title.localeCompare(y.title));
      const listEl = h('div', { class: 'card', style: 'margin-top:12px;max-height:340px;overflow:auto' }, vids.length ? vids.map(v => {
        const cb = h('input', { type: 'checkbox', checked: ui.pickVids.has(v.vid), onchange: () => { cb.checked ? ui.pickVids.add(v.vid) : ui.pickVids.delete(v.vid); } });
        const mine = ov.videos.includes(v.vid);
        return h('label', { class: 'item', style: 'cursor:pointer' }, cb,
          h('div', { class: 'meta' }, h('div', { class: 't', text: v.title }),
            h('div', { class: 'd', text: [v.delta ? `desfase ${fmtSigned(v.delta)}` : '', v.cuts ? `${v.cuts} corte${v.cuts > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ') || 'sincronización y chat' })),
          mine ? h('span', { class: 'pill warn', text: 'cambiado por ti' }) : h('span', { class: 'pill ok', text: 'igual que ByAlvaro' }));
      }) : h('div', { class: 'empty', text: 'ByAlvaro no ha publicado ningún vídeo.' }));
      card.append(listEl, h('div', { class: 'toolbar' },
        h('button', { class: 'btn sm', onclick: () => { vids.forEach(v => ui.pickVids.add(v.vid)); renderAll(true); } }, 'Marcar todos'),
        h('button', { class: 'btn sm', onclick: () => { ui.pickVids.clear(); renderAll(true); } }, 'Ninguno'),
        h('button', { class: 'btn primary', onclick: e => {
          const sel = [...ui.pickVids];
          if (!sel.length) { toast('Marca algún vídeo'); return; }
          ui.resetOpen = false; ui.pickVids = null;
          act(e.currentTarget, { t: 'feed-reset', scope: 'videos', vids: sel }, `${sel.length} vídeo${sel.length > 1 ? 's' : ''} como ByAlvaro ✓`);
        } }, 'Restablecer los marcados')));
    }
    box.append(card);
  }
}

/* ---------- Pegar los enlaces de Twitch de cada VOD ---------- */
function twitchSection(sy, m) {
  const out = [h('h3', { class: 'grp', text: 'Ajustar con enlaces de Twitch' })];
  const ta = h('textarea', { class: 'txt', spellcheck: 'false', style: 'height:110px;font-family:ui-monospace,Consolas,monospace;font-size:12px',
    placeholder: 'Un enlace por VOD, en orden:\nhttps://www.twitch.tv/videos/111 desde 1:23:26.100 hasta 9:28:30.033 | YouTube desde 0:00:00.000 hasta 8:05:03.934\nhttps://www.twitch.tv/videos/222?t=0h5m10s hasta 3:02:00' });
  ta.value = ui.tw;
  const prev = h('div', { class: 'hint', style: 'min-height:18px;white-space:pre-line' });
  const go = h('button', { class: 'btn primary', disabled: true }, '🔗 Ajustar todo');
  const parts = sy.partsInfo && sy.partsInfo.length > 1 ? sy.partsInfo.map(p => ({ vodId: p.vodId, rawStart: p.rawStart, rawEnd: p.rawEnd })) : [{ vodId: m && m.vodId, rawStart: sy.chatStart || 0, rawEnd: sy.chatEnd || 0 }];
  const paint = () => {
    const es = parseTwitchLinks(ta.value);
    go.disabled = !es.length;
    if (!ta.value.trim()) { prev.textContent = 'Pega el enlace de Twitch de cada VOD con dónde empieza («?t=» o «desde 5:10») y dónde acaba («hasta 3:02:00»). Detrás de «| YouTube desde … hasta …» puedes poner el minuto del vídeo de YouTube donde va ese trozo (si no, cada VOD va justo detrás del anterior). Se ajustan solos el VOD 1 y los demás. Los saltos que ya tengas se mantienen.'; return; }
    if (!es.length) { prev.textContent = 'No encuentro enlaces de Twitch (twitch.tv/videos/…).'; return; }
    const { map, warn } = assignLinks(es, parts);
    const lines = map.map((e, k) => e ? `VOD ${k + 1} ← ${e.vodId}: ${e.start != null ? fmtTime(e.start) : 'principio'} → ${e.end != null ? fmtTime(e.end) : 'final'}${e.yt != null ? ` · en el vídeo ${fmtTime(e.yt)}${e.ytEnd != null ? ' → ' + fmtTime(e.ytEnd) : ''}` : ''}` : `VOD ${k + 1}: sin enlace (entero, detrás del anterior)`);
    prev.textContent = lines.join('\n') + (warn.length ? '\n⚠ ' + warn.join('\n⚠ ') : '');
  };
  ta.addEventListener('input', () => { ui.tw = ta.value; paint(); });
  go.onclick = () => {
    if (!parseTwitchLinks(ta.value).length) return;
    bc.postMessage({ t: 'twitchLinks', text: ta.value });
    Sound.play('success'); ui.tw = ''; ta.value = ''; paint();
  };
  paint();
  out.push(ta, prev, h('div', { class: 'toolbar' }, go));
  return out;
}

/* ---------- Pegar la sincronización del «Sincronizador YT-Twitch» ---------- */
function pasteSection(sy) {
  const out = [h('h3', { class: 'grp', text: 'Pegar del Sincronizador' })];
  const ta = h('textarea', { class: 'txt', placeholder: 'Pega aquí el resultado completo, con uno o varios VODs:\nEmpieza: VOD 1 3:57:04.806 → 4:00:56.140   (YouTube 0:00:00.000 → 0:03:51.350)\nCAMBIO DE VOD: …\nEmpieza: VOD 2 1:22:31.159 → 5:12:40.030   (YouTube 0:03:51.350 → 3:54:00.200)\nCORTE: … / SALTO ATRÁS: … / Se reanuda: …', spellcheck: 'false', style: 'height:150px;font-family:ui-monospace,Consolas,monospace;font-size:12px' });
  ta.value = ui.paste;
  const prev = h('div', { class: 'hint', style: 'min-height:18px;white-space:pre-line' });
  const go = h('button', { class: 'btn primary', disabled: true }, '✂ Aplicar todos los cortes');
  const paint = () => {
    const segs = parsePlan(ta.value);
    go.disabled = !segs.length;
    if (!ta.value.trim()) { prev.textContent = 'Sustituye el desfase y los cortes de este vídeo de una vez.'; return; }
    if (!segs.length) { prev.textContent = 'No encuentro líneas «VOD 1 … → … (YouTube … → …)» ni «Twitch … → … (YouTube … → …)».'; return; }
    const nParts = sy.partsInfo && sy.partsInfo.length > 1 ? sy.partsInfo.length : 1, vods = vodsOf(segs), maxV = vods[vods.length - 1];
    if (maxV > nParts) { prev.textContent = `⚠ El texto es de ${maxV} VODs, pero este vídeo tiene ${nParts === 1 ? 'un solo chat' : nParts + ' partes'}. Carga las partes ([[parte1]], [[parte2]]…) y vuelve a pegarlo.`; go.disabled = true; return; }
    if (nParts > 1 && segs.some(x => x.vod)) {
      const lines = vods.map(v => { const pl = partPlan(segs.filter(x => (x.vod || 1) === v)), pc = pl.pieces;
        return `VOD ${v}: chat ${fmtTime(pl.from)} → ${fmtTime(pl.to)} · en el vídeo ${fmtTime(pc[0].y)} → ${fmtTime(pc[pc.length - 1].y2)}${pl.cuts.length ? ` · ${pl.cuts.length} salto${pl.cuts.length === 1 ? '' : 's'}` : ''}${pl.repeated > 0.05 ? ` · repite ${fmtTime(pl.repeated)} (esos mensajes salen una vez)` : ''}`; });
      const miss = Array.from({ length: nParts }, (_, i) => i + 1).filter(v => !vods.includes(v));
      prev.textContent = lines.join('\n') + (miss.length ? `\nVOD ${miss.join(', ')}: no sale en el texto (entero, detrás del anterior)` : '') + '\nSustituye el desfase, los cortes y los ajustes de cada VOD.';
      return;
    }
    const offs = segs.map(s => s.tw - s.yt);
    const skipped = offs.length > 1 ? offs[offs.length - 1] - offs[0] : 0;
    prev.textContent = `El vídeo empieza en el minuto ${fmtTime(segs[0].tw)} del directo · ${segs.length - 1} corte${segs.length - 1 === 1 ? '' : 's'} · ${fmtTime(Math.abs(skipped))} saltados en total.`;
  };
  ta.addEventListener('input', () => { ui.paste = ta.value; paint(); });
  go.onclick = () => {
    const segs = parsePlan(ta.value);
    if (!segs.length) return;
    bc.postMessage({ t: 'importCuts', plan: { segs: segs.map(s => ({ vod: s.vod, tw: s.tw, tw2: s.tw2, yt: s.yt, yt2: s.yt2 })) } });
    Sound.play('success'); ui.paste = ''; ta.value = ''; paint();
  };
  paint();
  out.push(ta, prev, h('div', { class: 'toolbar' }, go));
  return out;
}

/* ---------- Render general ---------- */
let navMatches = {};
/** ¿Se ven las opciones avanzadas? (al buscar, siempre: así se encuentra todo) */
const ADV = () => !!S.advanced || !!query;
function renderAll(keepScroll) {
  const sc = content.scrollTop;
  const frag = document.createDocumentFragment();
  navMatches = {};
  for (const sec of SECTIONS) {
    const el = h('section', { class: 'sec', id: 'sec-' + sec.id }, h('h2', null, h('span', { html: I[sec.icon] }), sec.title));
    if (sec.groups) for (const g of sec.groups) {
      const rows = g.rows.filter(r => !r.adv || ADV());
      if (!rows.length) continue;
      if (g.title) el.append(h('h3', { class: 'grp', text: g.title }));
      for (const r of rows) el.append(row(r));
    }
    if (sec.custom) sec.custom(el);
    if (query) {
      let n = el.querySelectorAll('.row.match').length;
      if (!n && (sec.title + ' ' + (sec.kw || '')).toLowerCase().includes(query.toLowerCase())) n = 1;
      navMatches[sec.id] = n;
    }
    frag.append(el);
  }
  content.replaceChildren(frag);
  renderNav();
  if (keepScroll) content.scrollTop = sc;
}
function paintAdv() { const on = !!S.advanced; const tg = $('advTg'); if (tg) { tg.classList.toggle('on', on); $('advSw').setAttribute('aria-checked', on ? 'true' : 'false'); } }
function renderNav() {
  paintAdv();
  const cur = nav.querySelector('.nav-i.on'); const curId = cur && cur.dataset.id;
  nav.replaceChildren();
  let grp = null;
  for (const sec of SECTIONS) {
    if (sec.grp !== grp) { grp = sec.grp; nav.append(h('div', { class: 'nav-h', text: grp })); }
    const n = navMatches[sec.id];
    nav.append(h('button', { class: 'nav-i' + (sec.id === curId ? ' on' : ''), 'data-id': sec.id, onclick: () => { Sound.play('click'); go(sec.id); } },
      h('span', { html: I[sec.icon] }), sec.title, n ? h('span', { class: 'cnt', text: n }) : null));
  }
}
function go(id) {
  const el = $('sec-' + id); if (!el) return;
  content.scrollTo({ top: el.offsetTop - 16, behavior: S.motion === 'reduced' ? 'auto' : 'smooth' });
  markNav(id);
  if (id === 'library') loadLibrary();
}
function markNav(id) { nav.querySelectorAll('.nav-i').forEach(b => b.classList.toggle('on', b.dataset.id === id)); }
content.addEventListener('scroll', debounce(() => {
  let best = SECTIONS[0].id;
  for (const sec of SECTIONS) { const el = $('sec-' + sec.id); if (el && el.offsetTop - 80 <= content.scrollTop) best = sec.id; }
  if (content.scrollTop + content.clientHeight >= content.scrollHeight - 4) best = SECTIONS[SECTIONS.length - 1].id;
  markNav(best);
}, 60), { passive: true });

/* ---------- Búsqueda (resalta como en Claude) ---------- */
let matchIdx = 0;
const qEl = $('q');
qEl.addEventListener('input', debounce(() => { query = qEl.value.trim(); matchIdx = 0; renderAll(true); focusMatch(); }, 120));
$('advSw').addEventListener('click', () => { Sound.play('toggle'); set('advanced', !S.advanced); toast(S.advanced ? 'Opciones avanzadas: se ven todos los ajustes' : 'Solo los ajustes básicos'); });
qEl.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); matchIdx += e.shiftKey ? -1 : 1; focusMatch(); }
  if (e.key === 'Escape' && qEl.value) { e.stopPropagation(); qEl.value = ''; query = ''; renderAll(true); $('qn').textContent = ''; }
});
function focusMatch() {
  const ms = [...content.querySelectorAll('.row.match')];
  $('qn').textContent = query ? (ms.length ? `${((matchIdx % ms.length) + ms.length) % ms.length + 1}/${ms.length}` : '0') : '';
  content.querySelectorAll('.row.cur').forEach(r => r.classList.remove('cur'));
  if (!ms.length) return;
  const m = ms[((matchIdx % ms.length) + ms.length) % ms.length];
  m.classList.add('cur');
  content.scrollTo({ top: Math.max(0, m.offsetTop - content.clientHeight / 3), behavior: S.motion === 'reduced' ? 'auto' : 'smooth' });
}

/* ---------- Tema / interfaz ---------- */
const mq = window.matchMedia('(prefers-color-scheme: dark)');
function applyUi(prev) {
  const dark = S.uiTheme === 'dark' || (S.uiTheme === 'system' && mq.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.setProperty('--ui-font', FONT_STACKS[S.uiFont] || FONT_STACKS.sans);
  document.documentElement.classList.toggle('reduced', S.motion === 'reduced');
  Sound.fromSettings(S);
  if (prev && prev.uiFont !== S.uiFont) {}
}
mq.addEventListener('change', () => applyUi());
onSettings(n => { if (JSON.stringify(n) === JSON.stringify(S)) return; const prev = S; S = n; applyUi(prev); renderAll(true); });

/* ---------- Bienvenida ---------- */
let splashShown = false;
function showSplash(force) {
  if ((!force && (!S.showCredits || splashShown)) || S.motion === 'reduced') return;
  splashShown = true;
  const sp = $('splash');
  sp.hidden = true; void sp.offsetWidth; sp.hidden = false;
  const p = sp.querySelector('.paper'); p.style.animation = 'none'; void p.offsetWidth; p.style.animation = '';
  sp.style.animation = 'none'; void sp.offsetWidth; sp.style.animation = '';
  Sound.play('open');
  clearTimeout(showSplash.t); showSplash.t = setTimeout(() => { sp.hidden = true; }, 1650);
}
$('splash').addEventListener('click', () => { $('splash').hidden = true; });

/* ---------- Comunicación ---------- */
window.addEventListener('message', e => {
  if (e.source !== window.parent || (e.origin !== 'https://www.youtube.com' && !(globalThis.__TCR_WEB && e.origin === location.origin))) return;
  if (e.data && e.data.type === 'tcr-init' && e.ports && e.ports[0]) {
    port = e.ports[0];
    port.onmessage = ev => { const m = ev.data; if (m && m.type === 'open') onOpen(m.section); };
  }
});
function onOpen(section) {
  bc.postMessage({ t: 'getState' });
  refreshAcct();
  loadLibrary();
  if (section) setTimeout(() => go(section), 60);
  showSplash(false);
  setTimeout(() => qEl.focus(), 50);
}
let rT = 0;
bc.onmessage = e => {
  const m = e.data || {};
  if (m.t === 'state') {
    const prevLoading = state && state.loading;
    state = m.s;
    clearTimeout(rT); rT = setTimeout(() => { if (!document.activeElement || !document.activeElement.matches('input[type=text],textarea,#driveFilter,.txt')) renderAll(true); }, prevLoading || state.loading ? 60 : 30);
  } else if (m.t === 'library') loadLibrary();
  else if (m.t === 'loadError') { toast(m.message); }
};
function close() { Sound.play('close'); if (port) port.postMessage({ type: 'close' }); }
$('x').onclick = close;
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !(e.target === qEl && qEl.value)) close(); });
document.addEventListener('pointerdown', () => Sound.unlock(), { once: true });

let toastT = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600); }

(async () => {
  S = await loadSettings();
  applyUi();
  renderAll();
  markNav('general');
  onOpen(qs.get('section') || '');
})();
