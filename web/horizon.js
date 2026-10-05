// horizon.js — fjern utsikt: grovt terreng i ringer rundt det kjørbare området, så fjell og daler
// synes mange kilometer unna uten at kartbyggingen tar lenger tid. Hentes i bakgrunnen etter at løpet har startet.
// Kilde: åpne terrengfliser (Terrarium, Amazon S3), samme reserve som kartbyggeren bruker. Kartverkets WCS
// leverer ikke grove utsnitt av store områder (svarer med tomme filer), derfor ikke derfra.
// Ringene: nærmest 50 m mellom punktene, ytterst 700 m. Jordkrumningen er med, så fjell 40 km unna synker
// riktig ned bak horisonten.
import * as THREE from 'three';
import { fromUTM } from './utm.js';

const LEVELS = [
  { R: 5000, step: 50, z: 11, from: 'middels' },
  { R: 12000, step: 140, z: 11, from: 'middels' },
  { R: 26000, step: 350, z: 9, from: 'lang' },
  { R: 50000, step: 700, z: 9, from: 'ekstrem' },
];
const ORDER = ['kort', 'middels', 'lang', 'ekstrem'];
const EARTH = 6371000 * 7 / 6;                            // effektiv jordradius med lysbrytning
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// naturfarge fra høyde og bratthet. Brukes også på terrenget utenfor området inne i kartet, så overgangen blir lik.
// Tregrensa synker nordover (ca. 1050 m på Østlandet, ca. 300 m i Finnmark).
export function natureColor(h, slope, lat, out, jitter = 0) {
  const tree = 1050 - (lat - 60) * 85, snow = tree + 700;
  let r = 66, g = 104, b = 58;                                                  // skog
  const low = sstep(160, 40, h) * sstep(0.09, 0.03, slope);                     // flatt lavland: jorder og eng
  r += (118 - r) * low; g += (158 - g) * low; b += (86 - b) * low;
  const alp = sstep(tree - 80, tree + 80, h);                                   // over tregrensa: lyng og gras
  r += (128 - r) * alp; g += (138 - g) * alp; b += (96 - b) * alp;
  const rock = clamp(sstep(0.55, 0.95, slope) + alp * sstep(tree + 250, snow, h) * 0.6, 0, 1);
  r += (128 - r) * rock; g += (124 - g) * rock; b += (118 - b) * rock;
  const sn = sstep(snow - 120, snow + 150, h) * sstep(1.0, 0.6, slope);        // snø på toppene, ikke i bratte vegger
  r += (232 - r) * sn; g += (236 - g) * sn; b += (240 - b) * sn;
  const j = 1 + jitter;
  out[0] = r / 255 * j; out[1] = g / 255 * j; out[2] = b / 255 * j;
  return out;
}

async function fetchMosaic(z, lat0, lon0, latR, lonR, signal) {
  const n = 2 ** z, tx = lo => (lo + 180) / 360 * n, ty = la => (1 - Math.log(Math.tan(Math.PI / 4 + la * Math.PI / 360)) / Math.PI) / 2 * n;
  const x0 = Math.floor(tx(lon0 - lonR)), x1 = Math.floor(tx(lon0 + lonR)), y0 = Math.floor(ty(lat0 + latR)), y1 = Math.floor(ty(lat0 - latR));
  const TW = (x1 - x0 + 1) * 256, TH = (y1 - y0 + 1) * 256, elev = new Float32Array(TW * TH);
  const jobs = []; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) jobs.push([x, y]);
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(256, 256) : Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
  const cx = cv.getContext('2d', { willReadFrequently: true });
  let k = 0;
  await Promise.all([0, 1, 2, 3, 4, 5].map(async () => {
    while (k < jobs.length) {
      const [x, y] = jobs[k++];
      const res = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`, { signal });
      if (!res.ok) throw new Error('terrengflis ' + res.status);
      const bmp = await createImageBitmap(await res.blob());
      cx.drawImage(bmp, 0, 0); const px = cx.getImageData(0, 0, 256, 256).data;
      for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) { const p = (j * 256 + i) * 4; elev[((y - y0) * 256 + j) * TW + (x - x0) * 256 + i] = px[p] * 256 + px[p + 1] + px[p + 2] / 256 - 32768; }
    }
  }));
  // høyde i et punkt (bilineært) + om det er vann (havet, eller helt flatt = innsjø)
  const at = (la, lo, o) => {
    const fx = clamp((tx(lo) - x0) * 256 - 0.5, 1, TW - 2.001), fy = clamp((ty(la) - y0) * 256 - 0.5, 1, TH - 2.001);
    const i = fy | 0, j = fx | 0, a = fy - i, b = fx - j, q = i * TW + j;
    const e00 = elev[q], e01 = elev[q + 1], e10 = elev[q + TW], e11 = elev[q + TW + 1];
    o.h = e00 * (1 - a) * (1 - b) + e10 * a * (1 - b) + e01 * (1 - a) * b + e11 * a * b;
    const mx = Math.max(e00, e01, e10, e11), mn = Math.min(e00, e01, e10, e11);
    o.water = o.h <= 0.4 || (mx - mn < 0.12 && Math.abs(elev[q - 1] - e00) < 0.12 && Math.abs(elev[q - TW] - e00) < 0.12);
    return o;
  };
  return at;
}

// bygger horisonten for valgt sikt. world/T gir det detaljerte kartet; terrainZ brukes for å skjøte mot det.
export async function buildHorizon({ world, T, terrainZ, originUTM, distId, mobile, signal }) {
  const lv = LEVELS.filter(L => ORDER.indexOf(distId) >= ORDER.indexOf(L.from));
  if (!lv.length) return null;
  const lat0 = world.origin.lat, lon0 = world.origin.lon;
  const Rmax = lv[lv.length - 1].R, mPerDegLat = 111320, mPerDegLon = 111320 * Math.cos(lat0 * Math.PI / 180);
  const mosaics = {};
  for (const z of [...new Set(lv.map(L => L.z))]) {
    const R = Math.max(...lv.filter(L => L.z === z).map(L => L.R)) + 1500;
    mosaics[z] = await fetchMosaic(z, lat0, lon0, R / mPerDegLat, R / mPerDegLon, signal);
  }
  // høydeforskjell mellom laserdata og de grove flisene langs kanten av kartet: flisene forskyves så skjøten blir jevn
  const smp = { h: 0, water: false };
  let off = 0, cnt = 0;
  for (let k = 0; k < 64; k++) {
    const t = k / 64, side = k % 4, ex = side < 2 ? T.x0 + 15 + (T.x1 - T.x0 - 30) * t : (side === 2 ? T.x0 + 15 : T.x1 - 15), ey = side < 2 ? (side === 0 ? T.y0 + 15 : T.y1 - 15) : T.y0 + 15 + (T.y1 - T.y0 - 30) * t;
    const [la, lo] = fromUTM(originUTM[0] + ex, originUTM[1] + ey); mosaics[lv[0].z](la, lo, smp);
    if (!smp.water) { off += terrainZ(ex, ey) - smp.h; cnt++; }
  }
  off = cnt ? clamp(off / cnt, -25, 25) : 0;
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const col = [0, 0, 0];
  for (let li = 0; li < lv.length; li++) {
    const L = lv[li], step = L.step * (mobile ? 1.6 : 1), at = mosaics[L.z];
    const inner = li === 0 ? null : lv[li - 1].R;
    const n = Math.ceil(L.R / step) * 2 + 1, half = (n - 1) / 2;
    const pos = new Float32Array(n * n * 3), cl = new Float32Array(n * n * 3), hs = new Float32Array(n * n), wat = new Uint8Array(n * n);
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        const x = (b - half) * step, y = (a - half) * step, k = a * n + b;
        const inMap = x > T.x0 && x < T.x1 && y > T.y0 && y < T.y1;
        let h;
        if (inMap) { h = terrainZ(x, y) - 1.5; wat[k] = 0; }        // under det detaljerte kartet, synes ikke
        else {
          const [la, lo] = fromUTM(originUTM[0] + x, originUTM[1] + y); at(la, lo, smp);
          h = smp.water && smp.h <= 0.4 ? 0 : smp.h + off; wat[k] = smp.water ? 1 : 0;
        }
        if (inner && Math.abs(x) < inner - step && Math.abs(y) < inner - step) h -= 4 + li * 6;   // under ringen innenfor
        hs[k] = h;
        const d2 = x * x + y * y;
        pos[k * 3] = x; pos[k * 3 + 1] = h - d2 / (2 * EARTH); pos[k * 3 + 2] = -y;
      }
      if (a % 40 === 0) await new Promise(r => setTimeout(r));      // ikke frys spillet mens ringen bygges
    }
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      const k = a * n + b;
      if (wat[k]) { cl.set([64 / 255, 118 / 255, 170 / 255], k * 3); continue; }
      const ka = clamp(a + 1, 0, n - 1) * n + b, kb = clamp(a - 1, 0, n - 1) * n + b, kc = a * n + clamp(b + 1, 0, n - 1), kd = a * n + clamp(b - 1, 0, n - 1);
      const slope = Math.hypot(hs[ka] - hs[kb], hs[kc] - hs[kd]) / (2 * step);
      natureColor(hs[k], slope, lat0, col, (((a * 7 + b * 13) % 10) - 5) * 0.012);
      cl.set(col, k * 3);
    }
    const idx = [];
    for (let a = 0; a < n - 1; a++) for (let b = 0; b < n - 1; b++) {
      const x0 = (b - half) * step, y0 = (a - half) * step, x1 = x0 + step, y1 = y0 + step;
      if (x0 >= T.x0 && x1 <= T.x1 && y0 >= T.y0 && y1 <= T.y1) continue;                 // dekket av kartet
      if (inner && x0 >= -inner && x1 <= inner && y0 >= -inner && y1 <= inner) continue; // dekket av ringen innenfor
      const p0 = a * n + b, p1 = p0 + 1, p2 = p0 + n, p3 = p2 + 1;
      idx.push(p0, p1, p2, p1, p3, p2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(cl, 3));
    g.setIndex(n * n > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.receiveShadow = false; m.frustumCulled = false; group.add(m);
  }
  group.userData.offset = off;
  return group;
}
