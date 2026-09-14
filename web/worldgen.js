// worldgen.js — bygger et kjørbart kart for et hvilket som helst område i Norge, i nettleseren.
// Kjører som Web Worker så siden ikke fryser. Samme metode som tools/build_world.py, men andre kilder:
//   * veier, hus, skog og vann: OpenStreetMaps offisielle vektorfliser (reserve: VersaTiles)
//   * terreng (DTM) og overflate (DOM): Kartverkets nasjonale høydemodell (WCS)
//   * overflate minus terreng = høyde på hvert hus og hvert tre
// Området er en sirkel eller et polygon spilleren har tegnet. Utenfor det tegnes bare terreng.
// Svarer Kartverket ikke (eller stedet mangler dekning), brukes grovere åpne terrengfliser og gjettede hushøyder.
import { toUTM, fromUTM } from './utm.js';
import { Z, EXT, DRIVE, WALK, sleep, fetchWithTimeout, geomParts, ringArea, clipRing, clipLine, fetchTiles, props } from './osmtiles.js';

export const GEN_VERSION = 3;
const CELL = 3;                                            // terrengoppløsning i spillet (m)
const WCS = 'https://wcs.geonorge.no/skwms1/wcs.hoyde-';
export const resFor = side => side <= 1250 ? 1 : side <= 2250 ? 1.5 : side <= 4250 ? 2 : 2.5;   // laseroppløsning (m)

const post = (m, transfer) => self.postMessage(m, transfer || []);
const prog = (step, frac, text) => post({ type: 'progress', step, frac, text });
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

self.onmessage = async e => {
  try {
    const r = await build(e.data);
    post({ type: 'done', world: r.world, tz: r.TZ.buffer, tc: r.TC.buffer, timing: r.timing }, [r.TZ.buffer, r.TC.buffer]);
  } catch (err) {
    post({ type: 'error', message: String((err && err.message) || err) });
  }
};

// ------------------------------------------------------------------ Kartverket GeoTIFF
function readTiff(buf) {
  const dv = new DataView(buf), le = dv.getUint16(0) === 0x4949;
  if (dv.getUint16(2, le) !== 42) throw new Error('ikke TIFF');
  const ifd = dv.getUint32(4, le), n = dv.getUint16(ifd, le), tags = {};
  const size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8 };
  for (let i = 0; i < n; i++) {
    const o = ifd + 2 + i * 12, tag = dv.getUint16(o, le), type = dv.getUint16(o + 2, le), count = dv.getUint32(o + 4, le);
    const vo = (size[type] || 1) * count <= 4 ? o + 8 : dv.getUint32(o + 8, le), vals = [];
    if ([3, 4, 16].includes(type)) for (let k = 0; k < count; k++) vals.push(type === 3 ? dv.getUint16(vo + 2 * k, le) : type === 4 ? dv.getUint32(vo + 4 * k, le) : Number(dv.getBigUint64(vo + 8 * k, le)));
    tags[tag] = vals;
  }
  const W = tags[256][0], H = tags[257][0];
  if ((tags[259] || [1])[0] !== 1) throw new Error('komprimert TIFF');
  if (tags[258][0] !== 32 || (tags[339] || [1])[0] !== 3) throw new Error('uventet TIFF-format');
  const out = new Float32Array(W * H), len = buf.byteLength;
  // «glisne» filer: deler uten data (typisk over vann) har adresse 0 og lengde 0 og skal bare stå som 0
  const present = (off, bytes, need) => off > 0 && bytes > 0 && off + need <= len;
  if (tags[324]) {
    const TW = tags[322][0], TH = tags[323][0], across = Math.ceil(W / TW), counts = tags[325] || [];
    tags[324].forEach((off, t) => {
      if (!present(off, counts[t] ?? 1, TW * TH * 4)) return;
      const tx = (t % across) * TW, ty = Math.floor(t / across) * TH;
      for (let y = 0; y < TH && ty + y < H; y++) for (let x = 0; x < TW; x++) { if (tx + x < W) out[(ty + y) * W + tx + x] = dv.getFloat32(off + (y * TW + x) * 4, le); }
    });
  } else {
    const rps = (tags[278] || [H])[0], counts = tags[279] || [];
    tags[273].forEach((off, s) => {
      const rows = Math.min(rps, H - s * rps); if (!present(off, counts[s] ?? 1, rows * W * 4)) return;
      for (let y = 0; y < rows; y++) for (let x = 0; x < W; x++) out[(s * rps + y) * W + x] = dv.getFloat32(off + (y * W + x) * 4, le);
    });
  }
  return { W, H, data: out };
}
async function kartverket(model, E0, N0, g, onTile) {
  const TP = 1000, out = new Float32Array(g.W * g.H), jobs = [];
  for (let ry = 0; ry < g.H; ry += TP) for (let cx = 0; cx < g.W; cx += TP) jobs.push([cx, ry, Math.min(g.W, cx + TP), Math.min(g.H, ry + TP)]);
  let next = 0, failed = null;
  const worker = async () => {
    while (next < jobs.length && !failed) {
      const [c0, r0, c1, r1] = jobs[next++];
      const bbox = [E0 + g.X0 + c0 * g.r, N0 + g.Y0 + r0 * g.r, E0 + g.X0 + c1 * g.r, N0 + g.Y0 + r1 * g.r].map(v => v.toFixed(2)).join(',');
      const url = `${WCS}${model}-nhm-25833?service=WCS&version=1.0.0&request=GetCoverage&coverage=nhm_${model}_topo_25833&format=GeoTIFF&crs=EPSG:25833&response_crs=EPSG:25833&bbox=${bbox}&width=${c1 - c0}&height=${r1 - r0}`;
      let tif = null;
      for (let a = 0; a < 3 && !tif; a++) {
        try { const res = await fetchWithTimeout(url, {}, 120000); if (res.ok) tif = readTiff(await res.arrayBuffer()); } catch { /* nytt forsøk */ }
        if (!tif) await sleep(3000 * (a + 1));
      }
      if (!tif) { failed = new Error('Kartverket svarte ikke'); return; }
      for (let k = 0; k < tif.H; k++) {                       // tiff rad 0 = nord, vårt rutenett rad 0 = sør
        const gy = r1 - 1 - k; if (gy < r0) continue;
        out.set(tif.data.subarray(k * tif.W, k * tif.W + Math.min(tif.W, c1 - c0)), gy * g.W + c0);
      }
      onTile();
    }
  };
  await Promise.all([worker(), worker()]);                 // 2 samtidige per modell = 4 mot Kartverket
  if (failed) throw failed;
  return out;
}
async function terrariumDTM(E0, N0, g) {                   // reserve: åpne terrengfliser, ca. 5 m i Norge
  const z = 14, n = 2 ** z, corner = (x, y) => fromUTM(E0 + x, N0 + y);
  const cs = [corner(g.X0, g.Y0), corner(g.X1, g.Y0), corner(g.X0, g.Y1), corner(g.X1, g.Y1)];
  const lats = cs.map(c => c[0]), lons = cs.map(c => c[1]);
  const tx = lon => (lon + 180) / 360 * n, ty = lat => { const s = Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)); return (1 - s / Math.PI) / 2 * n; };
  const x0 = Math.floor(tx(Math.min(...lons))), x1 = Math.floor(tx(Math.max(...lons))), y0 = Math.floor(ty(Math.max(...lats))), y1 = Math.floor(ty(Math.min(...lats)));
  const TW = (x1 - x0 + 1) * 256, TH = (y1 - y0 + 1) * 256, elev = new Float32Array(TW * TH);
  const jobs = []; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) jobs.push([x, y]);
  let k = 0;
  await Promise.all([0, 1, 2, 3].map(async () => {
    while (k < jobs.length) {
      const [x, y] = jobs[k++];
      const res = await fetchWithTimeout(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`, {}, 60000);
      if (!res.ok) throw new Error('Fant ikke terrengdata');
      const bmp = await createImageBitmap(await res.blob()), oc = new OffscreenCanvas(256, 256), cx = oc.getContext('2d');
      cx.drawImage(bmp, 0, 0); const px = cx.getImageData(0, 0, 256, 256).data;
      for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) { const p = (j * 256 + i) * 4; elev[((y - y0) * 256 + j) * TW + (x - x0) * 256 + i] = px[p] * 256 + px[p + 1] + px[p + 2] / 256 - 32768; }
    }
  }));
  const out = new Float32Array(g.W * g.H);
  for (let r = 0; r < g.H; r++) for (let c = 0; c < g.W; c++) {
    const u = (c + 0.5) / g.W, v = (r + 0.5) / g.H;
    const lat = (cs[0][0] * (1 - u) + cs[1][0] * u) * (1 - v) + (cs[2][0] * (1 - u) + cs[3][0] * u) * v;
    const lon = (cs[0][1] * (1 - u) + cs[1][1] * u) * (1 - v) + (cs[2][1] * (1 - u) + cs[3][1] * u) * v;
    const fx = clamp((tx(lon) - x0) * 256 - 0.5, 0, TW - 1.001), fy = clamp((ty(lat) - y0) * 256 - 0.5, 0, TH - 1.001);
    const i = fy | 0, j = fx | 0, a = fy - i, b = fx - j, q = i * TW + j;
    const z = elev[q] * (1 - a) * (1 - b) + elev[q + TW] * a * (1 - b) + elev[q + 1] * (1 - a) * b + elev[q + TW + 1] * a * b;
    out[r * g.W + c] = z > 0 && z < 3000 ? z : 0;
  }
  return out;
}

// ------------------------------------------------------------------ geometri
function fillPoly(poly, ox, oy, step, nx, ny, cb) {     // cb(i, j) for rutenettpunkt (ox + j*step, oy + i*step) inne i polygonet
  let minY = Infinity, maxY = -Infinity;
  for (const p of poly) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
  const i0 = Math.max(0, Math.ceil((minY - oy) / step)), i1 = Math.min(ny - 1, Math.floor((maxY - oy) / step)), xs = [];
  for (let i = i0; i <= i1; i++) {
    const y = oy + i * step; xs.length = 0;
    for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) { const ya = poly[a][1], yb = poly[b][1]; if ((ya > y) !== (yb > y)) xs.push(poly[a][0] + (y - ya) * (poly[b][0] - poly[a][0]) / (yb - ya)); }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) { const j0 = Math.max(0, Math.ceil((xs[k] - ox) / step)), j1 = Math.min(nx - 1, Math.floor((xs[k + 1] - ox) / step)); for (let j = j0; j <= j1; j++) cb(i, j); }
  }
}
function pip(x, y, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ------------------------------------------------------------------ tabeller
const PAL = ['#b93c32', '#f0ece0', '#e6c85a', '#78828c', '#aa503c', '#ebebeb', '#c8aa78', '#5a646e', '#d9d2c5', '#8c1c1c'];
const LAND = {
  forest: 'forest', wood: 'forest',
  grass: 'park', meadow: 'park', park: 'park', village_green: 'park', recreation_ground: 'park', playground: 'park', garden: 'park', cemetery: 'park', grave_yard: 'park', golf_course: 'park', pitch: 'park',
  farmland: 'farm', farmyard: 'farm', orchard: 'farm', vineyard: 'farm', allotments: 'farm', greenhouse_horticulture: 'farm', plant_nursery: 'farm',
  scrub: 'scrub', heath: 'scrub', bog: 'scrub', marsh: 'scrub', swamp: 'scrub', wet_meadow: 'scrub', reedbed: 'scrub', fell: 'scrub',
  quarry: 'rock', bare_rock: 'rock', scree: 'rock', sand: 'rock', beach: 'rock', shingle: 'rock', glacier: 'rock',
  industrial: 'industrial', commercial: 'industrial', retail: 'industrial', railway: 'industrial', landfill: 'industrial', brownfield: 'industrial', construction: 'industrial',
};
const CLASSES = { grass: 0, forest: 1, water: 2, farm: 3, park: 4, scrub: 5, rock: 6, industrial: 7, outside: 8 };
const WATER_W = { river: 14, canal: 8, stream: 3, ditch: 2, drain: 2 };

// ------------------------------------------------------------------ bygging
async function build({ lat, lon, shape, name }) {
  const T0 = performance.now(), timing = {};
  const [E0, N0] = toUTM(lat, lon);
  const loc = (la, lo) => { const [e, n] = toUTM(la, lo); return [Math.round((e - E0) * 100) / 100, Math.round((n - N0) * 100) / 100]; };

  // område: sirkel eller tegnet polygon, i meter rundt midtpunktet
  let bound;
  if (shape.type === 'circle') { const R = shape.d * 500; bound = Array.from({ length: 96 }, (_, k) => [Math.round(R * Math.cos(k / 96 * 2 * Math.PI) * 10) / 10, Math.round(R * Math.sin(k / 96 * 2 * Math.PI) * 10) / 10]); }
  else bound = shape.pts.map(([la, lo]) => loc(la, lo));
  const bx = bound.map(p => p[0]), by = bound.map(p => p[1]);
  const side = Math.max(Math.max(...bx) - Math.min(...bx), Math.max(...by) - Math.min(...by));
  const r = resFor(side), PAD = 30;
  const X0 = Math.floor(Math.min(...bx) - PAD), Y0 = Math.floor(Math.min(...by) - PAD);
  const W = Math.ceil((Math.max(...bx) + PAD - X0) / r), H = Math.ceil((Math.max(...by) + PAD - Y0) / r);
  const X1 = X0 + W * r, Y1 = Y0 + H * r;
  const inBound = (x, y) => pip(x, y, bound);

  // ---- 1) vektorfliser fra OpenStreetMap
  const n2 = 2 ** Z;
  const cornersLL = [[X0, Y0], [X1, Y0], [X0, Y1], [X1, Y1]].map(([x, y]) => fromUTM(E0 + x, N0 + y));
  const txOf = lo => Math.floor((lo + 180) / 360 * n2), tyOf = la => Math.floor((1 - Math.log(Math.tan(Math.PI / 4 + la * Math.PI / 360)) / Math.PI) / 2 * n2);
  const tx0 = txOf(Math.min(...cornersLL.map(c => c[1]))), tx1 = txOf(Math.max(...cornersLL.map(c => c[1])));
  const ty0 = tyOf(Math.max(...cornersLL.map(c => c[0]))), ty1 = tyOf(Math.min(...cornersLL.map(c => c[0])));
  const tiles = []; for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) tiles.push([tx, ty]);
  let tdone = 0;
  prog(0, 0, `Henter kartdata fra OpenStreetMap (${tiles.length} fliser)`);
  const tileData = await fetchTiles(tiles, () => { tdone++; prog(0, tdone / tiles.length, `Henter kartdata fra OpenStreetMap (${tdone} av ${tiles.length} fliser)`); });
  timing.osm = performance.now() - T0;

  const buildings = [], roads = [], areas = [], waterLines = [], labels = [];
  const nodeIds = new Map(); let nodeSeq = 1;
  const nodeId = (x, y) => { const k = Math.round(x * 2) + ',' + Math.round(y * 2); let id = nodeIds.get(k); if (id == null) { id = 1e12 + nodeSeq++; nodeIds.set(k, id); } return id; };
  tiles.forEach(([tx, ty], ti) => {
    const layers = tileData[ti] || {};
    const toLocal = ([px, py]) => { const lo = (tx + px / EXT) / n2 * 360 - 180, la = Math.atan(Math.sinh(Math.PI * (1 - 2 * (ty + py / EXT) / n2))) * 180 / Math.PI; return loc(la, lo); };
    let bIdx = 0;
    const B = layers.buildings;
    if (B) for (const F of B.feats) {
      if (F.type !== 3) continue;
      for (const ring of geomParts(F.geom)) {
        if (ring.length < 3 || ringArea(ring) <= 0) continue;                    // bare ytterringer (hull ignoreres)
        const clipped = clipRing(ring, 0, B.extent);                            // skjær bort buffersonen så nabofliser ikke dobles
        if (clipped.length < 3 || Math.abs(ringArea(clipped)) < 8) continue;
        const poly = clipped.map(toLocal);
        let cx = 0, cy = 0; for (const p of poly) { cx += p[0]; cy += p[1]; } cx /= poly.length; cy /= poly.length;
        if (!inBound(cx, cy)) continue;
        const pr = props(B, F);
        buildings.push({ id: (tx * 20000 + ty) * 100000 + (bIdx++), poly, hTag: typeof pr.height === 'number' ? pr.height : null });
      }
    }
    const S = layers.streets;
    if (S) for (const F of S.feats) {
      if (F.type !== 2) continue;
      const pr = props(S, F), k = pr.kind;
      if (pr.tunnel || pr.rail || !(DRIVE[k] || WALK[k])) continue;             // tunneler under fjellet tas ikke med
      for (const line of geomParts(F.geom)) for (const run of clipLine(line, 0, S.extent)) {
        const pts = run.map(toLocal);
        let cur = [];                                                          // behold bare delene inne i området
        const flush = () => { if (cur.length >= 2) roads.push({ k, w: DRIVE[k] || WALK[k], drive: !!DRIVE[k], n: '', p: cur, nodes: cur.map(q => nodeId(q[0], q[1])) }); cur = []; };
        for (const q of pts) { if (inBound(q[0], q[1])) cur.push(q); else flush(); }
        flush();
      }
    }
    const SL = layers.street_labels;
    if (SL) for (const F of SL.feats) { const pr = props(SL, F); if (!pr.name) continue; for (const line of geomParts(F.geom)) { const m = line[line.length >> 1]; if (m) labels.push({ name: pr.name, kind: pr.kind, at: toLocal(m) }); } }
    for (const [lname, kindOf] of [['land', pr => LAND[pr.kind]], ['water_polygons', () => 'water'], ['ocean', () => 'water']]) {
      const Lr = layers[lname]; if (!Lr) continue;
      for (const F of Lr.feats) {
        if (F.type !== 3) continue;
        const kind = kindOf(props(Lr, F)); if (!kind) continue;
        for (const ring of geomParts(F.geom)) if (ring.length >= 3 && ringArea(ring) > 0) areas.push({ k: kind, p: ring.map(toLocal) });
      }
    }
    const WL = layers.water_lines;
    if (WL) for (const F of WL.feats) { const pr = props(WL, F); if (pr.tunnel || !WATER_W[pr.kind]) continue; for (const line of geomParts(F.geom)) waterLines.push({ w: WATER_W[pr.kind], p: line.map(toLocal) }); }
  });
  // gatenavn: hvert navn festes til nærmeste gate av samme type
  const RG = 40, rgrid = new Map();
  roads.forEach((rd, i) => { for (const q of rd.p) { const key = Math.floor(q[0] / RG) + ',' + Math.floor(q[1] / RG); (rgrid.get(key) || rgrid.set(key, []).get(key)).push(i); } });
  for (const lb of labels) {
    const [x, y] = lb.at; let best = -1, bd = 400;
    for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) for (const i of rgrid.get((Math.floor(x / RG) + a) + ',' + (Math.floor(y / RG) + c)) || []) {
      if (roads[i].k !== lb.kind) continue;
      for (const q of roads[i].p) { const d = (q[0] - x) ** 2 + (q[1] - y) ** 2; if (d < bd) { bd = d; best = i; } }
    }
    if (best >= 0 && !roads[best].n) roads[best].n = lb.name;
  }
  roads.forEach((rd, i) => { rd.id = 2e12 + i; });
  prog(0, 1, `${buildings.length} hus og ${roads.length} veibiter`);

  // ---- 2) høydedata fra Kartverket
  const g = { X0, Y0, X1, Y1, W, H, r };
  const perModel = Math.ceil(W / 1000) * Math.ceil(H / 1000);
  let done = 0, lidar = true, dtm, dom;
  const tick = () => { done++; prog(1, done / (perModel * 2), `Henter laserdata fra Kartverket (${done} av ${perModel * 2} deler)`); };
  prog(1, 0, 'Henter laserdata fra Kartverket');
  const T1 = performance.now();
  try {
    [dtm, dom] = await Promise.all([kartverket('dtm', E0, N0, g, tick), kartverket('dom', E0, N0, g, tick)]);
    // manglende data: Kartverket bruker et enormt negativt tall (float32-minimum) eller NaN, typisk over sjø
    for (let k = 0; k < dtm.length; k++) { const z = dtm[k]; if (!(z > -500 && z < 3000)) dtm[k] = 0; const s2 = dom[k]; if (!(s2 > -500 && s2 < 3500) || (s2 === 0 && dtm[k] > 1)) dom[k] = dtm[k]; }   // overflate 0 over land/innsjø = mangler
    let zeros = 0, tot = 0; for (let k = 0; k < dtm.length; k += 7) { tot++; if (dtm[k] === 0) zeros++; }
    if (zeros / tot > 0.97) throw new Error('ingen dekning');                // hav eller utenfor Norge gir bare 0
  } catch {
    lidar = false; dom = null;
    prog(1, 0.5, 'Kartverket svarte ikke. Bruker grovere åpne terrengdata, hushøydene blir gjettet.');
    dtm = await terrariumDTM(E0, N0, g);
  }
  timing.heights = performance.now() - T1;
  prog(1, 1, lidar ? 'Laserdata mottatt' : 'Terrengdata mottatt');
  const T2 = performance.now();
  const terrainAt = (x, y) => {
    const fc = clamp((x - X0) / r - 0.5, 0, W - 1.001), fr = clamp((y - Y0) / r - 0.5, 0, H - 1.001);
    const i = fr | 0, j = fc | 0, a = fr - i, b = fc - j, k = i * W + j;
    return dtm[k] * (1 - a) * (1 - b) + dtm[k + W] * a * (1 - b) + dtm[k + 1] * (1 - a) * b + dtm[k + W + 1] * a * b;
  };

  // ---- 3) hushøyder
  prog(2, 0, 'Beregner hushøyder');
  const bmask = new Uint8Array(W * H), vals = new Float32Array(400000), outB = [];
  buildings.forEach((bd, bi) => {
    if (bi % 1500 === 0) prog(2, bi / Math.max(1, buildings.length), `Beregner hushøyder (${bi} av ${buildings.length})`);
    const poly = bd.poly; let cnt = 0;
    fillPoly(poly, X0 + r / 2, Y0 + r / 2, r, W, H, (i, j) => { const k = i * W + j; bmask[k] = 1; if (dom && cnt < vals.length) vals[cnt++] = dom[k]; });
    const zs = poly.map(([x, y]) => terrainAt(x, y)), zmax = Math.max(...zs);
    let h = null, top = null, fromLidar = false;
    if (dom && cnt * r * r >= 6 && cnt >= 2) {
      const s = vals.subarray(0, cnt).sort(); top = s[Math.min(cnt - 1, Math.floor(0.8 * (cnt - 1)))]; h = top - zmax;
      if (h < 2.2) { h = null; top = null; } else fromLidar = true;
    }
    if (h == null) h = bd.hTag ?? 6.5;
    h = clamp(h, 2.4, 45); if (top == null) top = zmax + h;
    outB.push({ id: bd.id, p: poly, h: Math.round(h * 10) / 10, zb: Math.round(Math.min(...zs) * 10) / 10, zt: Math.round(zmax * 10) / 10, top: Math.round(top * 10) / 10, t: 'yes', c: PAL[bd.id % PAL.length], src: fromLidar ? 'lidar' : 'tag/guess' });
  });
  prog(2, 1, `${outB.length} hus`);

  // ---- 4) terreng, arealklasser og trær
  prog(3, 0, 'Legger terreng og vann');
  const nx = Math.ceil((X1 - X0) / CELL), ny = Math.ceil((Y1 - Y0) / CELL), cls = new Uint8Array(nx * ny);
  for (const a of areas.slice().sort((p, q) => (p.k !== 'forest') - (q.k !== 'forest'))) {
    const v = CLASSES[a.k];
    fillPoly(a.p, X0, Y0, CELL, nx, ny, (i, j) => { const k = i * nx + j; if (a.k === 'water') cls[k] = 2; else if (cls[k] === 0 || cls[k] === 1) cls[k] = v; });
  }
  for (const wl of waterLines) {
    const rad = Math.max(wl.w / 2, 1.6), rc = Math.ceil(rad / CELL);
    for (let s = 0; s + 1 < wl.p.length; s++) {
      const [ax, ay] = wl.p[s], [bx2, by2] = wl.p[s + 1], steps = Math.max(1, Math.ceil(Math.hypot(bx2 - ax, by2 - ay) / (CELL / 2)));
      for (let u = 0; u <= steps; u++) {
        const x = ax + (bx2 - ax) * u / steps, y = ay + (by2 - ay) * u / steps, ci = Math.round((y - Y0) / CELL), cj = Math.round((x - X0) / CELL);
        for (let di = -rc; di <= rc; di++) for (let dj = -rc; dj <= rc; dj++) { const i = ci + di, j = cj + dj; if (i >= 0 && j >= 0 && i < ny && j < nx && Math.hypot(X0 + j * CELL - x, Y0 + i * CELL - y) <= rad) cls[i * nx + j] = 2; }
      }
    }
  }
  for (let i = 0; i < ny; i++) for (let j = 0; j < nx; j++) { const k = i * nx + j; if (cls[k] !== 2 && !inBound(X0 + j * CELL, Y0 + i * CELL)) cls[k] = 8; }   // utenfor området
  const isWater = (x, y) => cls[clamp(Math.round((y - Y0) / CELL), 0, ny - 1) * nx + clamp(Math.round((x - X0) / CELL), 0, nx - 1)] === 2;

  const NR = 15, nrx = Math.ceil((X1 - X0) / NR) + 1, nry = Math.ceil((Y1 - Y0) / NR) + 1, near = new Uint8Array(nrx * nry);
  for (const rd of roads) {
    if (!rd.drive) continue;
    for (let s = 0; s + 1 < rd.p.length; s++) {
      const [ax, ay] = rd.p[s], [bx2, by2] = rd.p[s + 1], steps = Math.max(1, Math.ceil(Math.hypot(bx2 - ax, by2 - ay) / 7));
      for (let u = 0; u <= steps; u++) {
        const ci = Math.round((ay + (by2 - ay) * u / steps - Y0) / NR), cj = Math.round((ax + (bx2 - ax) * u / steps - X0) / NR);
        for (let di = -3; di <= 3; di++) for (let dj = -3; dj <= 3; dj++) { const i = ci + di, j = cj + dj; if (i >= 0 && j >= 0 && i < nry && j < nrx) near[i * nrx + j] = 1; }
      }
    }
  }
  const nearRoad = (x, y) => near[clamp(Math.round((y - Y0) / NR), 0, nry - 1) * nrx + clamp(Math.round((x - X0) / NR), 0, nrx - 1)] === 1;

  prog(3, 0.3, 'Finner trær');
  const trees = [], MAXT = 90000;
  if (lidar) {
    const d = Math.ceil(3 / r), tmp = new Uint8Array(W * H), bl = new Uint8Array(W * H);
    for (let i = 0; i < H; i++) { let run = -1e9; for (let j = 0; j < W; j++) { if (bmask[i * W + j]) run = j; if (j - run <= d) tmp[i * W + j] = 1; } run = 1e9; for (let j = W - 1; j >= 0; j--) { if (bmask[i * W + j]) run = j; if (run - j <= d) tmp[i * W + j] = 1; } }
    for (let j = 0; j < W; j++) { let run = -1e9; for (let i = 0; i < H; i++) { if (tmp[i * W + j]) run = i; if (i - run <= d) bl[i * W + j] = 1; } run = 1e9; for (let i = H - 1; i >= 0; i--) { if (tmp[i * W + j]) run = i; if (run - i <= d) bl[i * W + j] = 1; } }
    const veg = new Float32Array(W * H);
    for (let k = 0; k < W * H; k++) { if (bl[k]) continue; const hgt = dom[k] - dtm[k]; if (hgt >= 3) veg[k] = Math.min(hgt, 60); }
    const hw = Math.max(1, Math.round(3 / r)), mx = new Float32Array(W * H), my = new Float32Array(W * H);
    for (let i = 0; i < H; i++) for (let j = 0; j < W; j++) { let m = 0; for (let t2 = Math.max(0, j - hw); t2 <= Math.min(W - 1, j + hw); t2++) { const v = veg[i * W + t2]; if (v > m) m = v; } mx[i * W + j] = m; }
    prog(3, 0.55, 'Finner trær');
    for (let j = 0; j < W; j++) for (let i = 0; i < H; i++) { let m = 0; for (let t2 = Math.max(0, i - hw); t2 <= Math.min(H - 1, i + hw); t2++) { const v = mx[t2 * W + j]; if (v > m) m = v; } my[i * W + j] = m; }
    const dense = new Map(), forest = new Map();
    for (let i = 0; i < H; i++) for (let j = 0; j < W; j++) {
      const k = i * W + j, v = veg[k]; if (v < 3 || v !== my[k]) continue;
      const x = X0 + (j + 0.5) * r, y = Y0 + (i + 0.5) * r;
      if (isWater(x, y) || !inBound(x, y)) continue;
      const nearR = nearRoad(x, y); if (!nearR && v < 5.5) continue;
      const sp = nearR ? 4 : 10, key = Math.floor((x - X0) / sp) * 100000 + Math.floor((y - Y0) / sp), map = nearR ? dense : forest;
      const prev = map.get(key); if (!prev || prev[2] < v) map.set(key, [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(v * 10) / 10]);
    }
    trees.push(...dense.values());
    const rest = [...forest.values()], rnd = mulberry(1);
    for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
    trees.push(...rest.slice(0, Math.max(0, MAXT - trees.length)));
    trees.length = Math.min(trees.length, MAXT);
  } else {
    const rnd = mulberry(3), samples = Math.min(1500000, Math.round((X1 - X0) * (Y1 - Y0) / 30));
    for (let s = 0; s < samples && trees.length < MAXT; s++) {
      const x = X0 + rnd() * (X1 - X0), y = Y0 + rnd() * (Y1 - Y0);
      const c = cls[clamp(Math.round((y - Y0) / CELL), 0, ny - 1) * nx + clamp(Math.round((x - X0) / CELL), 0, nx - 1)];
      const keep = { 1: 0.28, 5: 0.08, 0: 0.012, 4: 0.02 }[c] || 0;
      const k = clamp(Math.floor((y - Y0) / r), 0, H - 1) * W + clamp(Math.floor((x - X0) / r), 0, W - 1);
      if (!bmask[k] && rnd() < keep) trees.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round((c === 1 ? 6 + rnd() * 9 : 4 + rnd() * 6) * 10) / 10]);
    }
  }

  // ---- 5) terrengrutenett til spillet
  prog(4, 0.2, 'Setter sammen kartet');
  let zmin = Infinity; const zg = new Float32Array(nx * ny);
  for (let i = 0; i < ny; i++) for (let j = 0; j < nx; j++) { let z = terrainAt(X0 + j * CELL, Y0 + i * CELL); if (cls[i * nx + j] === 2 && z < 0) z = 0; zg[i * nx + j] = z; if (z < zmin) zmin = z; }   // havbunn under vann legges på havflaten
  zmin = Math.floor(zmin);
  const TZ = new Uint16Array(nx * ny); for (let k = 0; k < TZ.length; k++) TZ[k] = clamp(Math.round((zg[k] - zmin) * 10), 0, 65535);
  timing.process = performance.now() - T2; timing.total = performance.now() - T0;
  const world = {
    origin: { lat, lon, z: Math.round(terrainAt(0, 0) * 10) / 10, name }, lidar, gen: GEN_VERSION, bound,
    terrain: { x0: X0, y0: Y0, x1: X1, y1: Y1, cell: CELL, nx, ny, zmin },
    buildings: outB, roads, trees, areas,
  };
  prog(4, 1, `${outB.length} hus, ${roads.length} veier, ${trees.length} trær`);
  return { world, TZ, TC: cls, timing: { ...timing, tiles: tiles.length, pixels: W * H } };
}
