// Lector de .zip mínimo (sin librerías): lee el directorio central y descomprime con DecompressionStream.
// Devuelve [{ path, data: Uint8Array }] (solo archivos, no carpetas).

async function inflateRaw(u8) {
  const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

export async function unzip(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  // fin del directorio central (firma 0x06054b50), buscando desde el final
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('El archivo descargado no es un .zip válido.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = [];
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('El .zip está dañado.');
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const loc = dv.getUint32(p + 42, true);
    const nameBytes = u8.subarray(p + 46, p + 46 + nlen);
    const path = (flags & 0x800) ? dec.decode(nameBytes) : dec.decode(nameBytes); // los nombres de este proyecto son ASCII
    p += 46 + nlen + xlen + clen;
    if (path.endsWith('/')) continue;
    if (dv.getUint32(loc, true) !== 0x04034b50) throw new Error('El .zip está dañado.');
    const start = loc + 30 + dv.getUint16(loc + 26, true) + dv.getUint16(loc + 28, true);
    const raw = u8.subarray(start, start + csize);
    let data;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = await inflateRaw(raw);
    else throw new Error(`El .zip usa una compresión que no se puede leer (${method}).`);
    out.push({ path, data });
  }
  return out;
}

/** Quita la carpeta común de arriba («chat-replay-youtube/manifest.json» → «manifest.json») */
export function stripRoot(files) {
  const firsts = new Set(files.map(f => f.path.split('/')[0]));
  if (firsts.size === 1 && files.every(f => f.path.includes('/'))) {
    const root = [...firsts][0] + '/';
    return files.map(f => ({ ...f, path: f.path.slice(root.length) }));
  }
  return files;
}
