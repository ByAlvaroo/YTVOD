/* Chat Replay · modo app (web).
 * Dentro de la extensión este archivo NO HACE NADA (Chrome ya da chrome.*).
 * En la app (página web) imita lo que usa la extensión de chrome.*:
 *   storage.local / storage.sync → localStorage (avisos entre ventanas con el evento «storage»)
 *   runtime.sendMessage / onMessage → BroadcastChannel entre la app, el chat y los ajustes
 *   runtime.getURL / getManifest, alarms, tabs (lo justo para que funcione igual)
 */
(function () {
  'use strict';
  try { if (globalThis.chrome && chrome.runtime && chrome.runtime.id) return; } catch {}
  if (globalThis.__TCR_WEB) return;
  globalThis.__TCR_WEB = true;

  const doc = typeof document !== 'undefined' ? document : null;
  const me = doc && doc.currentScript ? doc.currentScript.src : (self.location && self.location.href);
  // raíz de la extensión: …/chat-replay-youtube/
  const ROOT = new URL('../', me).href;

  /* ---------- manifest (síncrono, como chrome.runtime.getManifest) ---------- */
  let MANIFEST = { version: '0.0.0', name: 'Chat Replay' };
  try {
    const x = new XMLHttpRequest();
    x.open('GET', ROOT + 'manifest.json?t=' + Date.now(), false);
    x.send();
    if (x.status === 200) MANIFEST = JSON.parse(x.responseText);
  } catch {}

  /* ---------- eventos ---------- */
  function evt() {
    const ls = new Set();
    return { addListener: f => ls.add(f), removeListener: f => ls.delete(f), hasListener: f => ls.has(f), _fire: (...a) => { const r = []; for (const f of [...ls]) { try { r.push(f(...a)); } catch (e) { console.error(e); } } return r; }, _ls: ls };
  }

  /* ---------- storage ---------- */
  const PFX = { local: 'tcr:l:', sync: 'tcr:s:' };
  const onChanged = evt();
  const read = (area, k) => { try { const v = localStorage.getItem(PFX[area] + k); return v == null ? undefined : JSON.parse(v); } catch { return undefined; } };
  function areaApi(area) {
    const allKeys = () => { const out = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(PFX[area])) out.push(k.slice(PFX[area].length)); } return out; };
    const wrap = (p, cb) => { if (typeof cb === 'function') p.then(cb, () => cb()); return p; };
    return {
      get(keys, cb) {
        const o = {};
        if (keys == null) for (const k of allKeys()) o[k] = read(area, k);
        else if (typeof keys === 'string') { const v = read(area, keys); if (v !== undefined) o[keys] = v; }
        else if (Array.isArray(keys)) for (const k of keys) { const v = read(area, k); if (v !== undefined) o[k] = v; }
        else for (const k of Object.keys(keys)) { const v = read(area, k); o[k] = v !== undefined ? v : keys[k]; }
        return wrap(Promise.resolve(o), cb);
      },
      set(items, cb) {
        const ch = {};
        try {
          for (const [k, v] of Object.entries(items || {})) {
            const old = read(area, k);
            const s = JSON.stringify(v);
            localStorage.setItem(PFX[area] + k, s);
            ch[k] = { oldValue: old, newValue: JSON.parse(s) };
          }
        } catch (e) { return wrap(Promise.reject(new Error('No queda espacio para guardar los ajustes')), cb); }
        if (Object.keys(ch).length) setTimeout(() => onChanged._fire(ch, area), 0);
        return wrap(Promise.resolve(), cb);
      },
      remove(keys, cb) {
        const ch = {};
        for (const k of [].concat(keys || [])) { const old = read(area, k); if (old !== undefined) { localStorage.removeItem(PFX[area] + k); ch[k] = { oldValue: old }; } }
        if (Object.keys(ch).length) setTimeout(() => onChanged._fire(ch, area), 0);
        return wrap(Promise.resolve(), cb);
      },
      clear(cb) { return this.remove(allKeys(), cb); },
      getBytesInUse(_k, cb) { return wrap(Promise.resolve(0), cb); }
    };
  }
  // cambios hechos en OTRA ventana (el chat, los ajustes, otra pestaña de la app)
  if (typeof addEventListener === 'function' && typeof localStorage !== 'undefined') {
    addEventListener('storage', e => {
      if (!e.key) return;
      for (const area of ['local', 'sync']) if (e.key.startsWith(PFX[area])) {
        const k = e.key.slice(PFX[area].length);
        const p = s => { try { return s == null ? undefined : JSON.parse(s); } catch { return undefined; } };
        const c = {}; if (e.oldValue != null) c.oldValue = p(e.oldValue); if (e.newValue != null) c.newValue = p(e.newValue);
        onChanged._fire({ [k]: c }, area);
      }
    });
  }

  /* ---------- runtime: mensajes entre ventanas ---------- */
  const onMessage = evt();
  const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('tcr-web-runtime') : null;
  const waiting = new Map();
  const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  if (bc) bc.onmessage = e => {
    const d = e.data || {};
    if (d.kind === 'msg') {
      let replied = false;
      const reply = r => { if (replied) return; replied = true; try { bc.postMessage({ kind: 'reply', id: d.id, res: r }); } catch {} };
      const sender = { id: 'web', url: d.url, tab: null };
      for (const f of [...onMessage._ls]) {
        let keep = false; // como en Chrome: todos los oyentes reciben el mensaje; vale la primera respuesta
        try { keep = f(d.m, sender, reply) === true; } catch (err) { console.error(err); }
      }
    } else if (d.kind === 'reply') {
      const w = waiting.get(d.id);
      if (w) { waiting.delete(d.id); clearTimeout(w.t); w.res(d.res); }
    }
  };
  function sendMessage(m, cb) {
    if (typeof m === 'string') m = cb, cb = arguments[2]; // (extensionId, msg, cb)
    const id = uid();
    const p = new Promise(res => {
      // sin respuesta en 60 s: como Chrome cuando nadie contesta
      const t = setTimeout(() => { waiting.delete(id); res(undefined); }, 60000);
      waiting.set(id, { res, t });
      try { bc && bc.postMessage({ kind: 'msg', id, m, url: location.href }); } catch { clearTimeout(t); waiting.delete(id); res(undefined); }
    });
    if (typeof cb === 'function') p.then(cb);
    return p;
  }

  /* ---------- alarms (con temporizadores) ---------- */
  const onAlarm = evt();
  const timers = new Map();
  const alarms = {
    create(name, o) {
      if (typeof name === 'object') o = name, name = '';
      clearInterval(timers.get(name));
      const ms = Math.max(0.5, (o && (o.periodInMinutes || o.delayInMinutes)) || 1) * 60000;
      timers.set(name, setInterval(() => onAlarm._fire({ name }), ms));
      return Promise.resolve();
    },
    clear(name) { clearInterval(timers.get(name)); timers.delete(name); return Promise.resolve(true); },
    onAlarm
  };

  const onStartup = evt(), onInstalled = evt();
  const runtime = {
    id: undefined,               // como si la extensión no estuviera: nadie la confunde con la de verdad
    web: true,
    getURL: p => new URL(String(p || '').replace(/^\/+/, ''), ROOT).href,
    getManifest: () => MANIFEST,
    sendMessage,
    onMessage,
    onStartup, onInstalled,
    reload: () => location.reload(),
    lastError: undefined
  };
  const tabs = {
    create: o => { try { window.open(o.url, '_blank', 'noopener'); } catch {} return Promise.resolve({ id: 0 }); },
    query: () => Promise.resolve([]),
    get: () => Promise.reject(new Error('sin pestañas')),
    update: () => Promise.resolve({}),
    reload: () => Promise.resolve(),
    remove: () => Promise.resolve()
  };

  globalThis.chrome = {
    runtime,
    storage: { local: areaApi('local'), sync: areaApi('sync'), onChanged },
    alarms,
    tabs
  };
  // el «segundo plano» de la app lanza esto al arrancar
  globalThis.__tcrWebStartup = () => onStartup._fire();
})();
