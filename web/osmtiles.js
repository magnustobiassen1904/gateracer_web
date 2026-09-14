// osmtiles.js — OpenStreetMaps vektorfliser (Shortbread-skjema): henting med reserve, dekoding og klipping.
// Brukes både av kartbyggeren (worldgen.js, i bakgrunnstråd) og av løypetegningen på startsiden.
export const Z = 14, EXT = 4096;                            // vektorflis-zoom og -oppløsning
const VT = [z => `https://vector.openstreetmap.org/shortbread_v1/${z}`, z => `https://tiles.versatiles.org/tiles/osm/${z}`];
const VT_SUFFIX = ['.mvt', ''];
export const DRIVE = { motorway: 10, trunk: 9, primary: 8, secondary: 8, tertiary: 7, unclassified: 6, residential: 6, living_street: 5, service: 4, track: 3.5, busway: 6 };
export const WALK = { footway: 1.8, cycleway: 2.2, path: 1.5, pedestrian: 4, steps: 1.5, bridleway: 1.5 };
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function fetchWithTimeout(url, opt, ms) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...opt, signal: ac.signal }); } finally { clearTimeout(t); }
}

export function decodeMVT(buf) {
  const b = new Uint8Array(buf), td = new TextDecoder(); let pos = 0;
  const varint = () => { let r = 0, s = 1, c; do { c = b[pos++]; r += (c & 0x7f) * s; s *= 128; } while (c & 0x80); return r; };
  const skip = wt => { if (wt === 0) varint(); else if (wt === 2) { const l = varint(); pos += l; } else if (wt === 5) pos += 4; else if (wt === 1) pos += 8; };
  const str = () => { const l = varint(), v = td.decode(b.subarray(pos, pos + l)); pos += l; return v; };
  const packed = () => { const l = varint(), end = pos + l, out = []; while (pos < end) out.push(varint()); return out; };
  const value = () => {
    const l = varint(), end = pos + l; let v = null;
    while (pos < end) {
      const key = varint(), f = key >> 3, wt = key & 7;
      if (f === 1 && wt === 2) v = str();
      else if (f === 2 && wt === 5) { v = new DataView(b.buffer, b.byteOffset + pos, 4).getFloat32(0, true); pos += 4; }
      else if (f === 3 && wt === 1) { v = new DataView(b.buffer, b.byteOffset + pos, 8).getFloat64(0, true); pos += 8; }
      else if (wt === 0) { const x = varint(); v = f === 6 ? ((x % 2) ? -(x + 1) / 2 : x / 2) : f === 7 ? !!x : x; }
      else skip(wt);
    }
    pos = end; return v;
  };
  const layers = {};
  while (pos < b.length) {
    const key = varint(), f = key >> 3, wt = key & 7;
    if (f !== 3 || wt !== 2) { skip(wt); continue; }
    const llen = varint(), lend = pos + llen, L = { name: '', keys: [], values: [], feats: [], extent: 4096 };
    while (pos < lend) {
      const k2 = varint(), f2 = k2 >> 3, w2 = k2 & 7;
      if (f2 === 1 && w2 === 2) L.name = str();
      else if (f2 === 2 && w2 === 2) {
        const flen = varint(), fend = pos + flen, F = { type: 0, tags: [], geom: [] };
        while (pos < fend) {
          const k3 = varint(), f3 = k3 >> 3, w3 = k3 & 7;
          if (f3 === 2 && w3 === 2) F.tags = packed();
          else if (f3 === 3 && w3 === 0) F.type = varint();
          else if (f3 === 4 && w3 === 2) F.geom = packed();
          else skip(w3);
        }
        pos = fend; L.feats.push(F);
      }
      else if (f2 === 3 && w2 === 2) L.keys.push(str());
      else if (f2 === 4 && w2 === 2) L.values.push(value());
      else if (f2 === 5 && w2 === 0) L.extent = varint();
      else skip(w2);
    }
    pos = lend; layers[L.name] = L;
  }
  return layers;
}
// dekoder geometri-kommandoer til linjer/ringer i flisens pikselrom
export function geomParts(g) {
  const parts = []; let x = 0, y = 0, cur = null, i = 0;
  while (i < g.length) {
    const cmd = g[i] & 7, cnt = g[i] >> 3; i++;
    if (cmd === 7) { if (cur) cur.closed = true; continue; }
    for (let k = 0; k < cnt; k++) {
      const dx = g[i++], dy = g[i++]; x += (dx >> 1) ^ -(dx & 1); y += (dy >> 1) ^ -(dy & 1);
      if (cmd === 1) { cur = []; parts.push(cur); }
      cur.push([x, y]);
    }
  }
  return parts;
}
export const ringArea = r => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return a / 2; };
export function clipRing(ring, lo, hi) {                        // Sutherland–Hodgman mot flisens kanter
  let out = ring;
  for (const [axis, bound, keepGreater] of [[0, lo, true], [0, hi, false], [1, lo, true], [1, hi, false]]) {
    const inp = out; out = []; if (!inp.length) break;
    for (let i = 0; i < inp.length; i++) {
      const a = inp[(i + inp.length - 1) % inp.length], c = inp[i];
      const ina = keepGreater ? a[axis] >= bound : a[axis] <= bound, inc = keepGreater ? c[axis] >= bound : c[axis] <= bound;
      if (inc) { if (!ina) out.push(isect(a, c, axis, bound)); out.push(c); } else if (ina) out.push(isect(a, c, axis, bound));
    }
  }
  return out;
  function isect(a, c, axis, bound) { const t = (bound - a[axis]) / (c[axis] - a[axis]); return axis === 0 ? [bound, a[1] + (c[1] - a[1]) * t] : [a[0] + (c[0] - a[0]) * t, bound]; }
}
export function clipLine(line, lo, hi) {                        // deler en linje i biter som ligger inne i flisen
  const runs = []; let cur = null;
  const inside = p => p[0] >= lo && p[0] <= hi && p[1] >= lo && p[1] <= hi;
  for (let i = 0; i + 1 < line.length; i++) {
    let [a, c] = [line[i], line[i + 1]], t0 = 0, t1 = 1;
    const dx = c[0] - a[0], dy = c[1] - a[1];
    let ok = true;
    for (const [p, q] of [[-dx, a[0] - lo], [dx, hi - a[0]], [-dy, a[1] - lo], [dy, hi - a[1]]]) {
      if (p === 0) { if (q < 0) { ok = false; break; } continue; }
      const t = q / p; if (p < 0) { if (t > t1) { ok = false; break; } if (t > t0) t0 = t; } else { if (t < t0) { ok = false; break; } if (t < t1) t1 = t; }
    }
    if (!ok) { cur = null; continue; }
    const s = [a[0] + dx * t0, a[1] + dy * t0], e = [a[0] + dx * t1, a[1] + dy * t1];
    if (!cur || t0 > 0) { cur = [s]; runs.push(cur); }
    cur.push(e);
    if (t1 < 1 || !inside(c)) cur = null;
  }
  return runs.filter(r => r.length >= 2);
}

export async function fetchTiles(tiles, onTile) {
  const out = new Array(tiles.length); let next = 0;
  const worker = async () => {
    while (next < tiles.length) {
      const idx = next++, [tx, ty] = tiles[idx];
      let layers = null;
      for (let src = 0; src < VT.length && !layers; src++) {
        for (let a = 0; a < 2 && !layers; a++) {
          try {
            const res = await fetchWithTimeout(`${VT[src](Z)}/${tx}/${ty}${VT_SUFFIX[src]}`, {}, 30000);
            if (res.status === 204 || res.status === 404) { layers = {}; break; }   // tom flis (sjø, fjell)
            if (res.ok) layers = decodeMVT(await res.arrayBuffer());
          } catch { /* nytt forsøk / neste kilde */ }
          if (!layers) await sleep(1200 * (a + 1));
        }
      }
      if (!layers) throw new Error('Fant ikke kartdata fra OpenStreetMap. Sjekk nettet og prøv igjen.');
      out[idx] = layers; onTile();
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return out;
}

export const props = (L, F) => { const o = {}; for (let i = 0; i + 1 < F.tags.length; i += 2) o[L.keys[F.tags[i]]] = L.values[F.tags[i + 1]]; return o; };
export const tileX = lon => Math.floor((lon + 180) / 360 * 2 ** Z);
export const tileY = lat => Math.floor((1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2 * 2 ** Z);
// globale flispiksler (zoom 14, 4096 per flis) <-> grader
export const gpxToLL = (gx, gy) => { const n = EXT * 2 ** Z; return [Math.atan(Math.sinh(Math.PI * (1 - 2 * gy / n))) * 180 / Math.PI, gx / n * 360 - 180]; };
export const llToGpx = (lat, lon) => { const n = EXT * 2 ** Z; return [(lon + 180) / 360 * n, (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2 * n]; };
