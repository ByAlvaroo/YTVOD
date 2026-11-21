import { loadSettings, applyChange, KEY } from './shared/settings.js';

let S = await loadSettings();
const msg = document.getElementById('msg');
const paint = () => {
  document.querySelectorAll('.tg').forEach(b => b.classList.toggle('on', !!S[b.dataset.k]));
  document.querySelectorAll('select[data-k]').forEach(s => { s.value = S[s.dataset.k]; });
};
const save = () => chrome.storage.local.set({ [KEY]: S });
document.querySelectorAll('.tg').forEach(b => b.onclick = () => { S = applyChange(S, b.dataset.k, !S[b.dataset.k]); save(); paint(); });
document.querySelectorAll('select[data-k]').forEach(s => s.onchange = () => { S = applyChange(S, s.dataset.k, s.value); save(); paint(); });
paint();

async function tabCmd(cmd, section) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const r = await chrome.tabs.sendMessage(tab.id, { cmd, section });
    if (r && r.ok) { window.close(); return; }
  } catch {}
  msg.textContent = 'Abre un vídeo de YouTube (youtube.com/watch) y vuelve a pulsar.';
}
document.getElementById('toggle').onclick = () => tabCmd('toggle');
document.getElementById('settings').onclick = () => tabCmd('openSettings');

// Cuenta
const acctTxt = document.getElementById('acctTxt'), acctBtn = document.getElementById('acctBtn');
chrome.runtime.sendMessage({ t: 'acct-get' }).then(r => {
  const a = r && r.account;
  acctTxt.replaceChildren();
  if (a) { acctTxt.append('Sesión: '); const b = document.createElement('b'); b.textContent = a.name; acctTxt.append(b); acctBtn.textContent = 'Cuenta'; }
  else { acctTxt.textContent = 'Sin iniciar sesión'; acctBtn.textContent = 'Iniciar sesión'; }
}).catch(() => {});
acctBtn.onclick = () => tabCmd('openSettings', 'account');
