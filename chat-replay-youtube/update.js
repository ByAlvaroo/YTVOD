// Página de actualización automática (se abre desde el aviso de YouTube)
import { getDir, setDir, forgetDir, permOf, checkDir, download, writeAll } from './shared/selfupdate.js';

const $ = id => document.getElementById(id);
const q = new URLSearchParams(location.search);
const TAB = +q.get('tab') || null, T = +q.get('t') || 0;
const ask = m => chrome.runtime.sendMessage(m);
let info = null, busy = false;

function step(s, state) { const li = document.querySelector(`[data-s="${s}"]`); if (li) li.className = state || ''; }
function showErr(e) {
  busy = false;
  $('err').hidden = false; $('errRow').hidden = false;
  $('err').textContent = '⚠ ' + (e && e.message || e) + ' No se ha cambiado nada en la extensión.';
  document.querySelectorAll('ol.steps li.on').forEach(li => li.className = '');
}
const manualUrl = () => (info && (info.url || info.page)) || '#';

async function run(dir) {
  if (busy) return;
  busy = true;
  $('pick').hidden = true; $('err').hidden = true; $('errRow').hidden = true; $('steps').hidden = false;
  try {
    await checkDir(dir);
    step('dl', 'on');
    const { files, manifest } = await download(info);
    step('dl', 'ok'); step('chk', 'ok'); step('wr', 'on');
    await writeAll(dir, files, (n, total) => { $('wrTxt').textContent = `Reemplazando los archivos (${n}/${total})`; });
    step('wr', 'ok'); step('rl', 'on');
    $('done').hidden = false;
    $('done').textContent = `Listo: versión ${manifest.version} instalada. Volviendo a YouTube…`;
    await ask({ cmd: 'updFinish', tab: TAB, t: T });   // reinicia la extensión; esta pestaña se cierra sola
  } catch (e) { showErr(e); }
}

async function pickAndRun(forceNew) {
  try {
    let dir = forceNew ? null : await getDir();
    if (!dir) {
      if (!window.showDirectoryPicker) throw new Error('Este navegador no deja elegir carpetas.');
      dir = await window.showDirectoryPicker({ id: 'tcr-ext', mode: 'readwrite' });
    }
    if (!(await permOf(dir, true))) throw new Error('Sin permiso para modificar la carpeta.');
    await checkDir(dir);
    await setDir(dir);
    run(dir);
  } catch (e) {
    if (e && e.name === 'AbortError') return;   // cerró el selector
    showErr(e);
    if (forceNew) forgetDir();
  }
}

async function start() {
  const u = await ask({ cmd: 'updCheck', force: true });
  info = u && u.info;
  $('manual1').href = $('manual2').href = manualUrl();
  if (!u || !u.ok && !info) { $('sub').textContent = (u && u.error) || 'No se ha podido comprobar GitHub.'; return; }
  if (!u.newer) { $('title').textContent = 'Chat Replay está al día'; $('sub').textContent = `Tienes la última versión (${u.current}).`; return; }
  $('title').textContent = `Actualizar a la ${info.version}`;
  $('sub').textContent = `Tienes la ${u.current}`;
  if (info.summary) { $('sum').hidden = false; $('sum').textContent = info.summary; }
  if (info.notes) { $('notesBox').hidden = false; $('notes').textContent = info.notes; }
  const dir = await getDir();
  if (dir && await permOf(dir, false)) { run(dir); return; }       // ya diste permiso «en cada visita»: todo solo
  $('pick').hidden = false;
  if (dir) { $('pickTxt').textContent = 'Chrome pide confirmar otra vez el permiso para modificar la carpeta de la extensión.'; $('pickBtn').textContent = 'Permitir y actualizar'; }
  else $('pickTxt').textContent = 'La primera vez hay que decirle a Chrome en qué carpeta está la extensión. Después ya no hace falta.';
}

$('pickBtn').onclick = () => pickAndRun(false);
$('retry').onclick = async () => { const d = await getDir(); if (d && await permOf(d, true)) run(d); else pickAndRun(false); };
$('other').onclick = () => pickAndRun(true);
start();

// para las pruebas: actualizar en una carpeta dada (OPFS)
window.__tcrRun = async dir => { info = info || (await ask({ cmd: 'updCheck', force: true })).info; return run(dir); };
