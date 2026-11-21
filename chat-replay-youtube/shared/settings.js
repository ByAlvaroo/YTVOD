// Ajustes globales (chrome.storage.local, compartidos entre panel, menú, popup y YouTube)
export const KEY = 'tcr_settings';

export const DEFAULTS = {
  v: 4,
  // Aspecto del chat
  chatTheme: 'claude',      // claude | twitch | light | oled | glass
  chatFont: 'serif',        // serif | sans | twitch | system | mono
  fontSize: 14,
  emoteScale: 1,
  msgGap: 3,
  showBadges: true,
  showTimestamps: false,
  altBg: false,
  separators: false,
  readableColors: true,
  boldNames: true,
  showReplies: true,        // «↪ Respondiendo a…» encima de las respuestas
  deletedMode: 'strike',    // strike | show | hide  (mensajes eliminados)
  // Interfaz (menú de ajustes)
  uiTheme: 'dark',          // system | light | dark
  uiFont: 'sans',           // sans | serif
  motion: 'system',         // system | reduced
  showCredits: true,
  advanced: false,          // Opciones avanzadas: false = solo los ajustes básicos
  keys: null,               // atajos personalizados { acción: 'Alt+C' } (null = los de siempre)
  // Posición
  enabled: true,
  autoOpen: false,          // el chat siempre empieza cerrado; se abre con el botón azul
  mode: 'sidebar',          // sidebar | overlay
  theaterMode: 'sidebar',
  fullscreenMode: 'side',   // side | overlay | hide
  sidebarHeight: 0,         // 0 = igual que el vídeo
  overlayBg: 0.55,
  textShadow: true,
  autoHideHeader: true,
  ghostChat: false,         // modo cine total: chat translúcido que desaparece si no mueves el ratón
  // Rendimiento
  perfPreset: 'balanced',   // quality | balanced | saver | ultra | custom
  fps: 30,
  maxMessages: 150,
  maxPerSecond: 0,
  smoothScroll: true,
  animatedEmotes: true,
  showGraph: false,
  pauseOnHover: false,
  fsLite: true,
  // Extras
  listBadges: true,         // círculo azul y duración azul en las listas de YouTube si el vídeo tiene chat
  updCheck: true,           // avisar en YouTube cuando haya una versión nueva en GitHub
  updRepo: 'ByAlvaroo/CHAT-DE-YT', // repositorio de GitHub con las versiones («Releases»)
  updMode: 'ask',           // al actualizar: 'ask' (preguntar), 'auto' (reemplaza la carpeta solo) o 'manual' (bajar el zip)
  ytHeatmap: false,         // mapa de calor en la barra de progreso de YouTube
  bookmarks: false,         // marcadores
  emoteCombo: false,        // contador grande cuando hay spam de un emote
  comboMin: 12,             // en pantalla completa: máx. 30 FPS para priorizar el vídeo
  // Sincronización
  autoSync: true,
  // Filtros
  myName: '',
  highlightWords: '',
  blockedWords: '',
  blockedUsers: '',
  hideBots: false,
  showRoleStreamer: true,   // modos de chat: qué mensajes se ven
  showRoleMod: true,
  showRoleVip: true,
  showRoleSub: true,
  showRoleOther: true,
  showEmoteOnly: true,
  hideNotices: false,
  // Sonidos
  soundOn: true,
  soundVol: 0.5,
  soundUi: true,
  soundHl: true,
  soundNotice: false,
  soundLoad: true,
  // Drive
  driveFolder: 'https://drive.google.com/drive/folders/1e4McCbhZCZQksGsXxfPzNfUtCq9P8EgP',
  driveAuto: true,
  driveAutoScore: 0.75,
  // Emotes
  fetchThird: true,
  // Almacenamiento
  storageLimit: 1024        // MB; al superarlo se borran los chats guardados (0 = sin límite)
};

export const PRESETS = {
  quality:  { fps: 60, maxMessages: 250, maxPerSecond: 0,  smoothScroll: true,  animatedEmotes: true,  motion: 'system' },
  balanced: { fps: 30, maxMessages: 150, maxPerSecond: 0,  smoothScroll: true,  animatedEmotes: true,  motion: 'system' },
  saver:    { fps: 15, maxMessages: 80,  maxPerSecond: 20, smoothScroll: false, animatedEmotes: false, motion: 'reduced' },
  ultra:    { fps: 8,  maxMessages: 50,  maxPerSecond: 8,  smoothScroll: false, animatedEmotes: false, motion: 'reduced' }
};
export const PERF_KEYS = Object.keys(PRESETS.quality);

function migrate(raw, s) {
  if (!(raw.v >= 2)) s.fullscreenMode = 'side';
  if (!(raw.v >= 3)) s.autoOpen = false;
  if (!(raw.v >= 4)) s.showGraph = false;
  s.v = 4;
  return s;
}
export async function loadSettings() {
  try {
    const o = await chrome.storage.local.get(KEY); const raw = o[KEY] || {};
    const s = { ...DEFAULTS, ...raw };
    return migrate(raw, s);
  }
  catch { return { ...DEFAULTS }; }
}
let saveT = null, pending = null;
export function saveSettings(s) {
  pending = s; clearTimeout(saveT);
  saveT = setTimeout(() => { try { chrome.storage.local.set({ [KEY]: pending }); } catch {} }, 150);
}
export function onSettings(cb) {
  try {
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === 'local' && ch[KEY]) { const raw = ch[KEY].newValue || {}; cb(migrate(raw, { ...DEFAULTS, ...raw })); }
    });
  } catch {}
}
/** Cambia un ajuste aplicando la lógica de los modos de rendimiento */
export function applyChange(S, key, value) {
  const n = { ...S, [key]: value };
  if (key === 'perfPreset' && PRESETS[value]) Object.assign(n, PRESETS[value]);
  else if (PERF_KEYS.includes(key)) n.perfPreset = 'custom';
  return n;
}
export const FONT_STACKS = {
  serif: '"Anthropic Serif", "Tiempos Text", "Source Serif 4", "Source Serif Pro", Charter, Georgia, serif',
  sans: '"Anthropic Sans", "Styrene B", Inter, "Segoe UI", system-ui, sans-serif',
  twitch: 'Inter, Roobert, "Helvetica Neue", Helvetica, Arial, sans-serif',
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  mono: '"JetBrains Mono", "Cascadia Code", Consolas, ui-monospace, monospace'
};
