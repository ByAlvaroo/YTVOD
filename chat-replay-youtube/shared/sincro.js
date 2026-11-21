// Texto del programa «Sincronizador YT-Twitch» → tramos que se ven en el vídeo de YouTube.
// Formato antiguo (un VOD):   Empieza: Twitch 0:12:03.500 → 1:02:00.000   (YouTube 0:00:00.000 → 0:49:56.500)
// Formato nuevo (varios VODs): Empieza: VOD 1 3:57:04.806 → 4:00:56.140   (YouTube 0:00:00.000 → 0:03:51.350)
//                               Se reanuda: VOD 2 5:11:54.521 → 5:11:56.629 (YouTube 3:54:04.767 → 3:54:06.870)
// Las líneas «CAMBIO DE VOD», «CORTE», «SALTO ATRÁS» y «NO ESTÁ EN EL VOD» solo explican: los tramos ya lo dicen todo.

export const secOf = s => String(s).replace(',', '.').split(':').reduce((a, b) => a * 60 + parseFloat(b), 0);

const T = '(\\d+(?::\\d{1,2}){1,2}(?:[.,]\\d+)?)', AR = '\\s*(?:→|->|=>|—>|➜)\\s*';
const RE = new RegExp('(?:Twitch\\s+VOD\\s*(\\d+)|VOD\\s*(\\d+)|Twitch)\\s+' + T + AR + T + '[^(\\n]*\\(\\s*(?:YouTube|YT|v[ií]deo)\\s+' + T + AR + T, 'i');

/** [{ vod (1, 2… o null si el texto no lo dice), tw, tw2, yt, yt2 }] ordenados por el minuto de YouTube */
export function parsePlan(txt) {
  const segs = [];
  for (const line of String(txt || '').split(/\r?\n/)) {
    const m = line.match(RE);
    if (!m) continue;
    const v = m[1] || m[2];
    segs.push({ vod: v ? +v : null, tw: secOf(m[3]), tw2: secOf(m[4]), yt: secOf(m[5]), yt2: secOf(m[6]) });
  }
  segs.sort((a, b) => a.yt - b.yt);
  return segs;
}

/** ¿Habla de más de un VOD? */
export const vodsOf = segs => [...new Set(segs.map(s => s.vod || 1))].sort((a, b) => a - b);

/**
 * Tramos de UN VOD → lo que se ve por primera vez de su chat.
 * Si el vídeo repite un trozo (SALTO ATRÁS), esos mensajes salen solo la primera vez.
 * Devuelve { pieces:[{a,b,y,y2}], from, to, cuts:[{at, jump}] (en tiempo del chat de ese VOD), repeated (s) }
 */
export function partPlan(segs) {
  const ss = segs.slice().sort((a, b) => a.yt - b.yt);
  const pieces = [];
  let max = -Infinity, repeated = 0;
  for (const s of ss) {
    let a = s.tw, y = s.yt;
    const b = s.tw2;
    if (b <= max) { repeated += b - a; continue; }
    if (a < max) { repeated += max - a; y += max - a; a = max; }
    pieces.push({ a, b, y, y2: s.yt2 });
    max = b;
  }
  const r = v => Math.round(v * 1000) / 1000;
  const cuts = [];
  for (let i = 1; i < pieces.length; i++) {
    const pr = pieces[i - 1], q = pieces[i];
    // salto = lo que avanza el chat − lo que avanza el vídeo entre un tramo y el siguiente
    const jump = r((q.a - pr.b) - (q.y - pr.y2));
    if (jump) cuts.push({ at: r(pr.b), jump });
  }
  return { pieces, from: pieces.length ? pieces[0].a : null, to: pieces.length ? max : null, cuts, repeated };
}
