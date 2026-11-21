// Chat Replay · segundo plano: guarda tu configuración en tu cuenta y publica / sigue la de ByAlvaro
import * as A from './shared/account.js';
import * as F from './shared/feed.js';
import { loadSettings, KEY } from './shared/settings.js';
import { getFolderFiles } from './shared/drive.js';
import { groupFiles } from './shared/parts.js';
import { titleScore } from './shared/util.js';
import * as DB from './shared/db.js';
import * as U from './shared/update.js';

/* ---------- Qué vídeos de las listas de YouTube tienen chat (círculo azul) ---------- */
let filesCache = { at: 0, groups: [], folder: '' };
let linksCache = { at: 0, vids: new Set() };

async function groups(S) {
  if (!S.driveFolder) return [];
  if (filesCache.folder === S.driveFolder && Date.now() - filesCache.at < 10 * 60 * 1000) return filesCache.groups;
  try {
    const c = await getFolderFiles(S.driveFolder, { maxAgeMs: 10 * 60 * 1000 });
    filesCache = { at: Date.now(), groups: groupFiles(c.files, ''), folder: S.driveFolder };
  } catch { filesCache = { at: Date.now() - 8 * 60 * 1000, groups: filesCache.groups, folder: S.driveFolder }; }
  return filesCache.groups;
}
async function linkedVids() {
  if (Date.now() - linksCache.at < 20 * 1000) return linksCache.vids;
  const links = await DB.all('links').catch(() => []);
  linksCache = { at: Date.now(), vids: new Set(links.filter(l => l && l.vid && !l.detached && (l.chatKey || (l.chatKeys && l.chatKeys.length))).map(l => l.vid)) };
  return linksCache.vids;
}

async function hasChat(items) {
  const S = await loadSettings();
  if (!S.enabled || !S.listBadges) return { vids: [], off: true };
  const [gs, linked] = await Promise.all([groups(S), linkedVids()]);
  const min = S.driveAutoScore || 0.75;
  const out = [];
  for (const it of items || []) {
    if (!it || !it.vid) continue;
    if (linked.has(it.vid)) { out.push(it.vid); continue; }
    if (!it.title) continue;
    for (const g of gs) if (titleScore(it.title, g.name) >= min) { out.push(it.vid); break; }
  }
  return { vids: out };
}



let busy = Promise.resolve();
const queue = fn => (busy = busy.then(fn, fn));
let pushT = 0, pubT = 0;
function pushSoon(ms = 1500) { clearTimeout(pushT); pushT = setTimeout(() => queue(() => A.push(false)), ms); }
function pubSoon(ms = 4000) { clearTimeout(pubT); pubT = setTimeout(() => queue(async () => { if (await F.isPublisher()) await F.publish(false); }), ms); }
const changed = () => { pushSoon(); pubSoon(); };

/** Avisa a los chats abiertos de que han cambiado vídeos (para recargar su sincronización) */
function tellPanels(vids) { if (vids && vids.length) chrome.runtime.sendMessage({ t: 'tcr-links-updated', vids }).catch(() => {}); }
async function followCheck(force) { const r = await queue(() => F.check({ force })); if (r && r.changed) tellPanels(r.changed.filter(v => v !== 'settings')); return r; }

chrome.storage.onChanged.addListener(async (ch, area) => {
  if (area === 'local') { if (ch[KEY] || ch.tcr_drive) filesCache.at = 0; if (A.LOCAL_KEYS.some(k => k in ch)) changed(); if (A.AKEY in ch && ch[A.AKEY].newValue) queue(() => A.pull()); return; }
  if (area !== 'sync') return;
  const a = await A.getAccount();
  if (!a) return;
  // has cambiado algo en otro ordenador con la misma cuenta: se trae aquí
  if (A.metaKey(a.slug) in ch) queue(() => A.pull());
});

let softAt = 0;
chrome.runtime.onMessage.addListener((m, _s, reply) => {
  if (m && m.cmd === 'hasChat') { hasChat(m.items).then(reply, () => reply({ vids: [] })); return true; }
  if (m && typeof m.cmd === 'string' && m.cmd.startsWith('upd')) {
    const run = async () => {
      switch (m.cmd) {
        case 'updBanner': { const S = await loadSettings(); if (!S.enabled || S.updCheck === false) { const v = await U.status(); return { off: true, updated: v.updated }; } return U.check(false); }
        case 'updCheck': return U.check(!!m.force);
        case 'updStatus': return U.status();
        case 'updSnooze': return U.snooze(m.hours || 24);
        case 'updSkip': return U.skip(m.version);
        case 'updSeen': return U.dismissUpdated();
        case 'updReload': return U.reloadNow();
        case 'updAuto': {
          const t = _s && _s.tab;
          await chrome.tabs.create({ url: chrome.runtime.getURL(`update.html?tab=${t ? t.id : ''}&t=${Math.floor(+m.t || 0)}`), index: t ? t.index + 1 : undefined, openerTabId: t ? t.id : undefined });
          return { ok: true };
        }
        case 'updFinish': {
          // apunta qué pestañas de YouTube hay que recargar cuando vuelva a arrancar la extensión
          const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' }).catch(() => []);
          await chrome.storage.local.set({ tcr_reload_tabs: { at: Date.now(), main: m.tab ? { id: +m.tab, t: Math.floor(+m.t || 0) } : null, others: tabs.map(x => x.id).filter(id => id !== +m.tab) } });
          return U.reloadNow();
        }
        case 'updSetMode': { const S = await loadSettings(); await chrome.storage.local.set({ [KEY]: { ...S, updMode: m.mode } }); return { ok: true }; }
        case 'updOpenExt': await chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id }); return { ok: true };
      }
      return { ok: false };
    };
    run().then(reply, e => reply({ ok: false, error: e.message }));
    return true;
  }
  if (!m || typeof m.t !== 'string') return;
  if (m.t === 'tcr-links') { changed(); return; }
  if (m.t === 'feed-soft') { if (Date.now() - softAt > 10 * 60e3) { softAt = Date.now(); followCheck(false); } return; }
  if (!/^(acct|feed|pub)-/.test(m.t)) return;
  const run = async () => {
    switch (m.t) {
      case 'acct-get': return { ...(await A.status()), follow: await F.followStatus(), pub: await F.pubStatus(), publisher: await F.isPublisher() };
      case 'acct-check': return { ok: true, ...(await A.check(m.name)) };
      case 'acct-pass': return A.changePassword(m.old, m.pass);
      case 'acct-entry': return { ok: true, ...(await A.makeEntry(m.name, m.pass)) };
      case 'acct-forget': await A.forgetKnown(m.slug); return { ok: true };
      case 'acct-remote': return A.remoteAccounts(true);
      case 'acct-login': { const r = await queue(() => A.login(m.name, m.pass, m.mode || 'auto')); followCheck(false); return { ok: true, ...r }; }
      case 'acct-logout': await A.logout(); return { ok: true };
      case 'acct-sync': { await queue(() => A.pull()); return queue(() => A.push(true)); }
      case 'feed-check': return followCheck(true);
      case 'feed-follow': return queue(() => F.setFollow(m.on));
      case 'feed-reset': { const r = await queue(() => F.reset(m.scope, m.vids)); tellPanels((r || []).filter(v => v !== 'settings')); return { ok: true, changed: r }; }
      case 'pub-save': return queue(() => F.savePub(m.cfg || {}));
      case 'pub-now': return queue(() => F.publish(true));
      case 'pub-forget': { await chrome.storage.local.remove(F.PUB_KEY); return { ok: true }; }
    }
  };
  run().then(r => reply(r || { ok: true }), e => reply({ ok: false, error: e.message }));
  return true;
});

// al arrancar Chrome o instalar/actualizar: se recupera tu configuración y se mira si ByAlvaro ha cambiado algo
const boot = () => {
  chrome.alarms.create('tcr-feed', { periodInMinutes: 30 });
  queue(async () => { await A.dropSyncedSession(); await A.verifySession().catch(() => {}); if (await A.getAccount()) { await A.pull(); await A.push(false); } });
  followCheck(false);
};
chrome.runtime.onStartup.addListener(boot);
chrome.runtime.onInstalled.addListener(d => { U.onInstalled(d).catch(() => {}); boot(); });
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'tcr-feed') { followCheck(false); A.verifySession().catch(() => {}); } });

/* ---------- Tras una actualización automática: vuelve a YouTube en el mismo minuto del vídeo ---------- */
(async () => {
  const o = (await chrome.storage.local.get('tcr_reload_tabs').catch(() => ({}))).tcr_reload_tabs;
  if (!o) return;
  await chrome.storage.local.remove('tcr_reload_tabs');
  if (Date.now() - (o.at || 0) > 3 * 60e3) return;
  if (o.main && o.main.id) {
    try {
      const tab = await chrome.tabs.get(o.main.id);
      const u = new URL(tab.url);
      if (u.hostname === 'www.youtube.com') {
        if (o.main.t > 3 && u.pathname === '/watch') u.searchParams.set('t', o.main.t + 's');
        await chrome.tabs.update(o.main.id, { url: u.toString(), active: true });
      }
    } catch {}
  }
  for (const id of o.others || []) chrome.tabs.reload(id).catch(() => {});
  // la pestaña de la actualización ya no sirve (la extensión se ha reiniciado)
  try { const ts = await chrome.tabs.query({ url: chrome.runtime.getURL('update.html') + '*' }); for (const t of ts) chrome.tabs.remove(t.id).catch(() => {}); } catch {}
})();
