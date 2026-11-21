// Atajos de teclado personalizables. Una combinación se guarda como «Ctrl+Alt+Shift+KeyC» (orden fijo, e.code al final).
// content.js (no es módulo) lleva una copia de ACTIONS/DEFAULTS/comboOf: si cambias algo aquí, cámbialo también allí.

export const ACTIONS = [
  { id: 'toggle',   t: 'Mostrar u ocultar el chat' },
  { id: 'back1',    t: 'Chat 1 s antes' },
  { id: 'fwd1',     t: 'Chat 1 s después' },
  { id: 'back5',    t: 'Chat 5 s antes' },
  { id: 'fwd5',     t: 'Chat 5 s después' },
  { id: 'mark',     t: 'Añadir un marcador (si están activados)' },
  { id: 'search',   t: 'Buscar mensajes en el chat' },
  { id: 'users',    t: 'Buscar usuarios del chat' },
  { id: 'sync',     t: 'Abrir el menú de sincronización' },
  { id: 'pick',     t: 'Ajustar con un mensaje (🎯)' },
  { id: 'cutHere',  t: 'Corte aquí (✂)' },
  { id: 'settings', t: 'Abrir los ajustes' },
  { id: 'redownload', t: 'Volver a descargar el chat' },
  { id: 'scrollEnd', t: 'Bajar al último mensaje' }
];
export const DEFAULTS = {
  toggle: 'Alt+KeyC', back1: 'Alt+Comma', fwd1: 'Alt+Period', back5: 'Alt+Shift+Comma', fwd5: 'Alt+Shift+Period',
  mark: 'Alt+KeyB', search: 'Ctrl+KeyF', users: 'Alt+KeyU', sync: '', pick: '', cutHere: '', settings: '', redownload: '', scrollEnd: ''
};
/** Atajos en uso: los tuyos encima de los de siempre ('' = sin atajo) */
export const bindings = S => ({ ...DEFAULTS, ...((S && S.keys) || {}) });

const MODS = ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'OS'];
/** Tecla pulsada → «Alt+Shift+KeyC» (null si solo se pulsó un modificador) */
export function comboOf(e) {
  if (!e || MODS.includes(e.key) || !e.code) return null;
  const p = [];
  if (e.ctrlKey) p.push('Ctrl');
  if (e.altKey) p.push('Alt');
  if (e.shiftKey) p.push('Shift');
  if (e.metaKey) p.push('Meta');
  p.push(e.code);
  return p.join('+');
}
const NICE = { Comma: ',', Period: '.', Slash: '/', Semicolon: 'Ñ', Quote: "'", BracketLeft: '`', BracketRight: '+', Backslash: 'Ç', Minus: "'", Equal: '¡', Backquote: 'º', Space: 'Espacio', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Enter: 'Intro', Escape: 'Esc', Backspace: '⌫', Tab: 'Tab', Delete: 'Supr', Insert: 'Insert', Home: 'Inicio', End: 'Fin', PageUp: 'RePág', PageDown: 'AvPág', IntlBackslash: '<' };
/** «Alt+Shift+KeyC» → ['Alt', 'Shift', 'C'] para pintarlo */
export function keysOf(combo) {
  if (!combo) return [];
  return combo.split('+').map(k => k === 'Ctrl' ? 'Ctrl' : k === 'Meta' ? 'Win' : k.startsWith('Key') ? k.slice(3) : k.startsWith('Digit') ? k.slice(5) : k.startsWith('Numpad') ? 'Num ' + k.slice(6) : NICE[k] || k);
}
export const fmtCombo = c => keysOf(c).join(' + ');
/** ¿Sirve como atajo? (sin modificador solo F1–F12, para no estorbar al escribir ni a los atajos de YouTube) */
export function validCombo(c) {
  if (!c) return false;
  const p = c.split('+'), key = p[p.length - 1];
  if (p.length === 1) return /^F\d{1,2}$/.test(key);
  if (p.length === 2 && p[0] === 'Shift') return /^F\d{1,2}$/.test(key);
  return true;
}
/** Combinaciones del navegador o de YouTube que mejor no tocar */
export const RESERVED = ['Ctrl+KeyW', 'Ctrl+KeyT', 'Ctrl+KeyN', 'Ctrl+Shift+KeyT', 'Ctrl+KeyR', 'Ctrl+KeyL', 'Ctrl+Tab', 'Ctrl+Shift+Tab', 'Alt+F4', 'Ctrl+Shift+KeyN', 'Ctrl+KeyP', 'Ctrl+KeyS', 'Ctrl+KeyC', 'Ctrl+KeyV', 'Ctrl+KeyX', 'Ctrl+KeyA', 'Ctrl+KeyZ'];
