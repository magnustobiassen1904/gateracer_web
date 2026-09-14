import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { obtainWorld, AREA, areaQuery, worldReady } from './intro.js';

// ------------------------------------------------------------------ data
window.addEventListener('error', e => { document.getElementById('hint').textContent = 'Feil: ' + e.message; });
const { world, TZ, TC } = await obtainWorld();              // introsiden, lagret kart, eller ferdigbygd Kongsberg
const T = world.terrain;
if (qs0().get('dump')) {                                          // testkrok: statistikk om kartet
  const hs = world.buildings.filter(b => b.src === 'lidar').map(b => b.h).sort((a, b) => a - b);
  let zs = 0; for (let k = 0; k < TZ.length; k++) zs += TZ[k];
  console.log('WORLD ' + JSON.stringify({ navn: world.origin.name, lidar: world.lidar, hus: world.buildings.length, hus_laser: hs.length, median_h: hs[hs.length >> 1], veier: world.roads.length, kjørbare: world.roads.filter(r => r.drive).length, trær: world.trees.length, arealer: world.areas.length, vann_celler: TC.reduce((a, c) => a + (c === 2), 0), nx: T.nx, ny: T.ny, zmin: T.zmin, z_snitt: +(T.zmin + zs / TZ.length / 10).toFixed(1), origo_z: world.origin.z }));
}
function qs0() { return new URLSearchParams(location.search); }
const NS = AREA.prebuilt ? '' : AREA.id + ':';                 // lagrede løyper og tider hører til ett sted
const $ = id => document.getElementById(id);
const qs = new URLSearchParams(location.search);
const hint = $('hint');

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function clsAt(x, y) {
  const j = Math.round(clamp((x - T.x0) / T.cell, 0, T.nx - 1)), i = Math.round(clamp((y - T.y0) / T.cell, 0, T.ny - 1));
  return TC[i * T.nx + j];
}
function terrainZ(x, y) {
  const fx = clamp((x - T.x0) / T.cell, 0, T.nx - 1.001), fy = clamp((y - T.y0) / T.cell, 0, T.ny - 1.001);
  const i = fy | 0, j = fx | 0, a = fy - i, b = fx - j, k = i * T.nx + j;
  const z = (kk) => T.zmin + TZ[kk] / 10;
  return z(k) * (1 - a) * (1 - b) + z(k + T.nx) * a * (1 - b) + z(k + 1) * (1 - a) * b + z(k + T.nx + 1) * a * b;
}
const store = { get: (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

// ------------------------------------------------------------------ veigraf (kjørbare veier)
const G = new Map();
for (const r of world.roads) {
  if (!r.drive) continue;
  for (let i = 0; i < r.nodes.length; i++) {
    const id = r.nodes[i], p = r.p[i]; if (!p) continue;
    if (!G.has(id)) G.set(id, { x: p[0], y: p[1], adj: [] });
    if (i > 0 && r.p[i - 1]) {
      const pid = r.nodes[i - 1], q = r.p[i - 1], len = Math.hypot(p[0] - q[0], p[1] - q[1]);
      G.get(id).adj.push([pid, len]); G.get(pid).adj.push([id, len]);
    }
  }
}
function nearestNode(x, y, maxD = 60) {
  let best = null, bd = maxD * maxD;
  for (const [id, n] of G) { const d = (n.x - x) ** 2 + (n.y - y) ** 2; if (d < bd) { bd = d; best = id; } }
  return best;
}
function dijkstra(src, dst) {
  const dist = new Map([[src, 0]]), prev = new Map(), done = new Set();
  const heap = [[0, src]];
  const up = (i) => { while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [d, u] = pop();
    if (done.has(u)) continue; done.add(u);
    if (u === dst) break;
    for (const [v, w] of G.get(u).adj) { const nd = d + w; if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); heap.push([nd, v]); up(heap.length - 1); } }
  }
  if (!dist.has(dst)) return null;
  const path = [dst]; let u = dst; while (u !== src) { u = prev.get(u); path.push(u); }
  return path.reverse();
}

// ------------------------------------------------------------------ bygninger: romlig indeks, skjulte hus
const BC = 25, bGrid = new Map();
world.buildings.forEach((b, k) => {
  const xs = b.p.map(p => p[0]), ys = b.p.map(p => p[1]);
  b.bb = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  for (let i = Math.floor(b.bb[0] / BC); i <= Math.floor(b.bb[2] / BC); i++) for (let j = Math.floor(b.bb[1] / BC); j <= Math.floor(b.bb[3] / BC); j++) {
    const key = `${i},${j}`; (bGrid.get(key) || bGrid.set(key, []).get(key)).push(k);
  }
});
function pip(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function polyDist(x, y, poly) {
  if (pip(x, y, poly)) return 0;
  let bd = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ax = poly[j][0], ay = poly[j][1], bx = poly[i][0], by = poly[i][1], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const t = L ? clamp(((x - ax) * dx + (y - ay) * dy) / L, 0, 1) : 0;
    bd = Math.min(bd, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
  }
  return bd;
}
function candidates(x, y, pad = 0) {
  const out = [];
  for (let i = Math.floor((x - pad) / BC); i <= Math.floor((x + pad) / BC); i++) for (let j = Math.floor((y - pad) / BC); j <= Math.floor((y + pad) / BC); j++) { const a = bGrid.get(`${i},${j}`); if (a) out.push(...a); }
  return out;
}
const removedManual = new Set(store.get('gateracer_removed', []));   // bygnings-id-er brukeren har fjernet
let hidden = new Set();                                                 // indeks-sett som ikke tegnes/kolliderer i aktiv bane
function buildingAt(x, y) { for (const k of candidates(x, y)) { const b = world.buildings[k]; if (x >= b.bb[0] && x <= b.bb[2] && y >= b.bb[1] && y <= b.bb[3] && pip(x, y, b.p)) return k; } return -1; }
function hitsBuilding(x, y) {
  for (const k of candidates(x, y)) { if (hidden.has(k)) continue; const b = world.buildings[k]; if (x < b.bb[0] || x > b.bb[2] || y < b.bb[1] || y > b.bb[3]) continue; if (pip(x, y, b.p)) return true; }
  return false;
}

// ------------------------------------------------------------------ veiflate (for dekke + fotgjengere + free roam)
const RC = 40, rGrid = new Map(), rSegs = [];
for (const r of world.roads) {
  if (!r.drive) continue;
  for (let i = 0; i < r.p.length - 1; i++) {
    const a = r.p[i], b = r.p[i + 1]; if (!a || !b) continue;
    const k = rSegs.length; rSegs.push([a[0], a[1], b[0], b[1], r.w / 2]);
    const i0 = Math.floor(Math.min(a[0], b[0]) / RC), i1 = Math.floor(Math.max(a[0], b[0]) / RC);
    const j0 = Math.floor(Math.min(a[1], b[1]) / RC), j1 = Math.floor(Math.max(a[1], b[1]) / RC);
    for (let i2 = i0; i2 <= i1; i2++) for (let j2 = j0; j2 <= j1; j2++) { const key = `${i2},${j2}`; (rGrid.get(key) || rGrid.set(key, []).get(key)).push(k); }
  }
}
function segDist(px, py, a, b, c, d) {
  const dx = c - a, dy = d - b, L = dx * dx + dy * dy;
  const t = L ? clamp(((px - a) * dx + (py - b) * dy) / L, 0, 1) : 0;
  return Math.hypot(px - (a + t * dx), py - (b + t * dy));
}
function roadClear(x, y) {            // < 0 = på veien
  let best = 99;
  const ci = Math.floor(x / RC), cj = Math.floor(y / RC);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const arr = rGrid.get(`${ci + i},${cj + j}`); if (!arr) continue;
    for (const k of arr) { const g = rSegs[k]; const d = segDist(x, y, g[0], g[1], g[2], g[3]) - g[4]; if (d < best) best = d; }
  }
  return best;
}
function randomRoadSeg(x, y, minR, maxR) {
  const ci = Math.floor(x / RC), cj = Math.floor(y / RC), R = Math.ceil(maxR / RC), pool = [];
  for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) {
    const arr = rGrid.get(`${ci + i},${cj + j}`); if (!arr) continue;
    for (const k of arr) { const g = rSegs[k]; const d = Math.hypot((g[0] + g[2]) / 2 - x, (g[1] + g[3]) / 2 - y); if (d > minR && d < maxR) pool.push(k); }
  }
  return pool.length ? rSegs[pool[Math.floor(Math.random() * pool.length)]] : null;
}

// ------------------------------------------------------------------ tegnemodus
const mapC = $('map'), mctx = mapC.getContext('2d');
let view = { cx: (T.x0 + T.x1) / 2, cy: (T.y0 + T.y1) / 2, scale: 0 };
let waypoints = [], routePts = [], loopMode = true, clickMode = 'route', freeLine = false, mode = 'race';
function resizeMap() {
  mapC.width = mapC.clientWidth * devicePixelRatio; mapC.height = mapC.clientHeight * devicePixelRatio;
  if (!view.scale) view.scale = Math.min(mapC.clientWidth / (T.x1 - T.x0), mapC.clientHeight / (T.y1 - T.y0)) * (world.bound ? 0.92 : 0.98);
  drawMap();
}
function w2s(x, y) { return [(x - view.cx) * view.scale + mapC.clientWidth / 2, -(y - view.cy) * view.scale + mapC.clientHeight / 2]; }
function s2w(sx, sy) { return [(sx - mapC.clientWidth / 2) / view.scale + view.cx, -(sy - mapC.clientHeight / 2) / view.scale + view.cy]; }
const AREA_COL = { forest: '#1f3a25', water: '#1c3a5e', farm: '#3a3a22', park: '#22402a', scrub: '#2b3a24', rock: '#2e2e34', industrial: '#2a2c38' };
function drawMap() {
  const ctx = mctx; ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  const W = mapC.clientWidth, H = mapC.clientHeight, s = view.scale;
  ctx.fillStyle = '#161a2c'; ctx.fillRect(0, 0, W, H);
  const poly = (pts) => { ctx.beginPath(); for (let i = 0; i < pts.length; i++) { const q = w2s(pts[i][0], pts[i][1]); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); } };
  const vis = (bb) => { const a = w2s(bb[0], bb[3]), b = w2s(bb[2], bb[1]); return b[0] > -20 && a[0] < W + 20 && b[1] > -20 && a[1] < H + 20; };
  for (const a of world.areas) { poly(a.p); ctx.closePath(); ctx.fillStyle = AREA_COL[a.k] || '#1e2436'; ctx.fill(); }
  if (s > 0.35) for (let k = 0; k < world.buildings.length; k++) { const b = world.buildings[k]; if (!vis(b.bb)) continue; poly(b.p); ctx.closePath(); ctx.fillStyle = removedManual.has(b.id) ? '#6b2a2a' : '#3a4058'; ctx.fill(); }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const r of world.roads) {
    if (!r.drive && s < 0.6) continue;
    poly(r.p);
    if (r.drive) { ctx.strokeStyle = r.k === 'service' || r.k === 'track' ? '#5f6684' : '#8f96b4'; ctx.lineWidth = Math.max(1.5, r.w * s); ctx.setLineDash([]); }
    else { ctx.strokeStyle = '#4a5068'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  if (s > 0.9) { ctx.fillStyle = '#c9cee4'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; const seen = new Set();
    for (const r of world.roads) if (r.drive && r.n && !seen.has(r.n)) { const m = r.p[Math.floor(r.p.length / 2)]; const q = w2s(m[0], m[1]); if (q[0] > 0 && q[0] < W && q[1] > 0 && q[1] < H) { ctx.fillText(r.n, q[0], q[1] - 6); seen.add(r.n); } } }
  if (world.bound) {                                              // område valgt på introsiden
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); poly(world.bound); ctx.closePath();
    ctx.fillStyle = 'rgba(8,10,18,.62)'; ctx.fill('evenodd');
    poly(world.bound); ctx.closePath(); ctx.strokeStyle = '#e0333a'; ctx.lineWidth = 2; ctx.setLineDash([8, 6]); ctx.stroke(); ctx.setLineDash([]); ctx.restore();
  }
  const o = w2s(0, 0); ctx.strokeStyle = '#ffd14a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(o[0], o[1], 7, 0, Math.PI * 2); ctx.stroke();
  if (routePts.length > 1) {
    ctx.beginPath();
    routePts.forEach((q0, i) => { const q = w2s(q0[0], q0[1]); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); });
    if (loopMode) ctx.closePath();
    ctx.strokeStyle = '#e0333a'; ctx.lineWidth = Math.max(4, 7 * s); ctx.stroke();
  }
  ctx.textAlign = 'center';
  waypoints.forEach((w, i) => {
    const q = w2s(w.x, w.y);
    ctx.fillStyle = i === 0 ? '#3ad66a' : (!loopMode && i === waypoints.length - 1 ? '#ffd14a' : (w.id == null ? '#7fd4ff' : '#fff'));
    ctx.beginPath(); ctx.arc(q[0], q[1], 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#000'; ctx.font = 'bold 11px sans-serif'; ctx.fillText(String(i + 1), q[0], q[1] + 4);
  });
}
function routeLength(pts, closed) {
  let len = 0; const m = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < m; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; len += Math.hypot(a[0] - b[0], a[1] - b[1]); }
  return len;
}
let jumps = 0;
function rebuildRoute() {
  routePts = []; jumps = 0;
  if (waypoints.length >= 2) {
    const m = loopMode ? waypoints.length : waypoints.length - 1;
    for (let i = 0; i < m; i++) {
      const a = waypoints[i], b = waypoints[(i + 1) % waypoints.length];
      let seg = null;
      if (a.id != null && b.id != null && a.id !== b.id) {
        const path = dijkstra(a.id, b.id);
        if (path) seg = path.map(id => { const n = G.get(id); return [n.x, n.y]; });
      }
      if (!seg) { seg = [[a.x, a.y], [b.x, b.y]]; jumps++; }   // ingen vei? kjør rett fram over terrenget
      routePts.push(...(i < m - 1 || loopMode ? seg.slice(0, -1) : seg));
    }
    routePts = routePts.filter((q, i) => i === 0 || Math.hypot(q[0] - routePts[i - 1][0], q[1] - routePts[i - 1][1]) > 0.2);
  }
  const len = routePts.length > 1 ? routeLength(routePts, loopMode) : 0;
  const ok = routePts.length >= 3 && len > 120;
  $('btnRace').disabled = !ok;
  if (clickMode === 'house') hint.textContent = 'Husmodus: klikk på hus for å fjerne (eller hente tilbake). Trykk «Fjern hus» igjen for å gå tilbake til løypetegning.';
  else if (waypoints.length === 0) hint.textContent = 'Klikk på veier for å legge punkter. Med «Rett linje» kan du tegne snarveier og hopp utenfor veinettet.';
  else hint.textContent = `${loopMode ? 'Sløyfe' : 'Sprint'}: ${Math.round(len)} m, ${waypoints.length} punkter${jumps ? `, ${jumps} luftstrekk` : ''}. ${ok ? 'Trykk Kjør!' : 'Legg til flere punkter (minst 120 m).'}`;
  drawMap();
}
let pdown = null, dragged = false; const ptrs = new Map(); let pinch = null;
mapC.addEventListener('pointerdown', e => {
  ptrs.set(e.pointerId, [e.clientX, e.clientY]); mapC.setPointerCapture(e.pointerId);
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), scale: view.scale }; pdown = null; return; }
  pdown = [e.clientX, e.clientY, view.cx, view.cy]; dragged = false;
});
mapC.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  if (pinch && ptrs.size === 2) {
    const [a, b] = [...ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const rect = mapC.getBoundingClientRect(); const mx = (a[0] + b[0]) / 2 - rect.left, my = (a[1] + b[1]) / 2 - rect.top;
    const [wx, wy] = s2w(mx, my); view.scale = clamp(pinch.scale * d / pinch.d, 0.15, 14); const [nx, ny] = s2w(mx, my); view.cx += wx - nx; view.cy += wy - ny; drawMap(); return;
  }
  if (!pdown) return;
  const dx = e.clientX - pdown[0], dy = e.clientY - pdown[1];
  if (Math.hypot(dx, dy) > 4) dragged = true;
  if (dragged) { view.cx = pdown[2] - dx / view.scale; view.cy = pdown[3] + dy / view.scale; drawMap(); }
});
const endPtr = e => {
  if (pdown && !dragged && !pinch) {
    const rect = mapC.getBoundingClientRect();
    const [x, y] = s2w(e.clientX - rect.left, e.clientY - rect.top);
    if (clickMode === 'house') {
      const k = buildingAt(x, y);
      if (k >= 0) { const id = world.buildings[k].id; removedManual.has(id) ? removedManual.delete(id) : removedManual.add(id); store.set('gateracer_removed', [...removedManual]); drawMap(); }
    } else {
      const id = freeLine ? null : nearestNode(x, y, 80 / Math.max(1, view.scale));
      const n = id !== null ? G.get(id) : null;
      const wp = n ? { x: n.x, y: n.y, id } : { x: Math.round(x), y: Math.round(y), id: null };
      const last = waypoints[waypoints.length - 1];
      if (!last || Math.hypot(last.x - wp.x, last.y - wp.y) > 3) { waypoints.push(wp); rebuildRoute(); }
    }
  }
  ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; pdown = null;
};
mapC.addEventListener('pointerup', endPtr); mapC.addEventListener('pointercancel', endPtr);
mapC.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = mapC.getBoundingClientRect();
  const [wx, wy] = s2w(e.clientX - rect.left, e.clientY - rect.top);
  view.scale = clamp(view.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 0.15, 14);
  const [nx, ny] = s2w(e.clientX - rect.left, e.clientY - rect.top);
  view.cx += wx - nx; view.cy += wy - ny; drawMap();
}, { passive: false });
$('btnUndo').onclick = () => { waypoints.pop(); rebuildRoute(); };
$('btnClear').onclick = () => { waypoints = []; rebuildRoute(); };
$('loopChk').onchange = () => { loopMode = $('loopChk').checked; rebuildRoute(); };
$('btnHouse').onclick = () => { clickMode = clickMode === 'house' ? 'route' : 'house'; $('btnHouse').classList.toggle('active', clickMode === 'house'); rebuildRoute(); };
function setRoute(pts, loop, maxD = 200) {
  waypoints = pts.map(p => { const id = nearestNode(p[0], p[1], maxD); const n = id !== null ? G.get(id) : null; return n ? { x: n.x, y: n.y, id } : { x: p[0], y: p[1], id: null }; });
  loopMode = loop; $('loopChk').checked = loop; rebuildRoute();
  const xs = waypoints.map(w => w.x), ys = waypoints.map(w => w.y);
  view.cx = (Math.min(...xs) + Math.max(...xs)) / 2; view.cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  view.scale = clamp(Math.min(mapC.clientWidth / (Math.max(...xs) - Math.min(...xs) + 300), mapC.clientHeight / (Math.max(...ys) - Math.min(...ys) + 300)), 0.15, 3); drawMap();
}
$('btnDemo').onclick = () => setRoute([[0, 0], [0, -220], [170, -220], [170, 0]], true);
$('btnDemo2').onclick = () => setRoute([[0, 0], [-1191, -498], [-1750, -690]], false);
$('btnDemo3').onclick = () => setRoute([[340, -1140], [535, -1817], [900, -1500], [700, -900]], true);
// lagrede løyper
function refreshTrackList() {
  const sel = $('trackList'); sel.innerHTML = '<option value="">Mine løyper…</option>';
  store.get('gateracer_tracks' + NS, []).forEach((t, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = `${t.name} (${t.loop ? 'sløyfe' : 'sprint'})`; sel.appendChild(o); });
}
$('btnSave').onclick = () => {
  const name = $('trackName').value.trim(); if (!name || waypoints.length < 2) { hint.textContent = 'Gi løypa et navn og tegn minst to punkter først.'; return; }
  const list = store.get('gateracer_tracks' + NS, []).filter(t => t.name !== name); list.push({ name, waypoints, loop: loopMode }); store.set('gateracer_tracks' + NS, list); refreshTrackList(); hint.textContent = `Lagret «${name}».`;
};
$('trackList').onchange = () => {
  const t = store.get('gateracer_tracks' + NS, [])[Number($('trackList').value)]; if (!t) return;
  waypoints = t.waypoints.map(wpFromAny).filter(Boolean); loopMode = t.loop; $('loopChk').checked = t.loop; $('trackName').value = t.name;
  rebuildRoute(); if (waypoints[0]) { view.cx = waypoints[0].x; view.cy = waypoints[0].y; drawMap(); }
};
$('lineChk').onchange = () => { freeLine = $('lineChk').checked; rebuildRoute(); };
refreshTrackList();
function trackKey() { return (loopMode ? 'L' : 'S') + waypoints.map(w => w.id != null ? w.id : `${Math.round(w.x)}_${Math.round(w.y)}`).join('-'); }
function shareUrl() { const name = $('trackName').value.trim(); return location.origin + location.pathname + areaQuery() + '#t=' + (loopMode ? 'L' : 'S') + waypoints.map(w => `${Math.round(w.x)}.${Math.round(w.y)}`).join('_') + (name ? '&n=' + encodeURIComponent(name) : ''); }
$('btnShare').onclick = async () => {
  if (waypoints.length < 2) { hint.textContent = 'Tegn en løype først.'; return; }
  const url = shareUrl(); history.replaceState(null, '', url);
  try { await navigator.clipboard.writeText(url); hint.textContent = 'Lenke kopiert! Send den til noen, så får de løypa ferdig tegnet.'; }
  catch { hint.textContent = 'Lenken ligger nå i adressefeltet. Kopier den derfra.'; }
};
function wpFromAny(v) {           // tåler både gammelt (node-id) og nytt (x.y) format
  if (typeof v === 'object' && v && 'x' in v) return G.has(v.id) ? v : { x: v.x, y: v.y, id: null };
  if (typeof v === 'string' && v.includes('.')) { const [x, y] = v.split('.').map(Number); const id = nearestNode(x, y, 12); const n = id !== null ? G.get(id) : null; return n ? { x: n.x, y: n.y, id } : { x, y, id: null }; }
  const id = Number(v); const n = G.get(id); return n ? { x: n.x, y: n.y, id } : null;
}
function loadFromHash() {
  const m = location.hash.match(/t=([LS])([\d\-_.]+)/); if (!m) return;
  const raw = m[2].includes('_') || m[2].includes('.') ? m[2].split('_') : m[2].split('-');
  const wps = raw.map(wpFromAny).filter(Boolean); if (wps.length < 2) return;
  waypoints = wps; loopMode = m[1] === 'L'; $('loopChk').checked = loopMode;
  const n = location.hash.match(/n=([^&]+)/); if (n) $('trackName').value = decodeURIComponent(n[1]);
  rebuildRoute();
  const xs = waypoints.map(w => w.x), ys = waypoints.map(w => w.y);
  view.cx = (Math.min(...xs) + Math.max(...xs)) / 2; view.cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  view.scale = clamp(Math.min(mapC.clientWidth / (Math.max(...xs) - Math.min(...xs) + 300), mapC.clientHeight / (Math.max(...ys) - Math.min(...ys) + 300)), 0.15, 3);
  hint.textContent = 'Løype fra lenke lastet: ' + ($('trackName').value || (loopMode ? 'sløyfe' : 'sprint')) + '. Trykk Kjør!';
}
window.addEventListener('resize', () => { resizeMap(); if (renderer) resizeRace(); });
resizeMap(); rebuildRoute(); loadFromHash(); drawMap();
worldReady();

// ------------------------------------------------------------------ kjøretøy
// top = km/h, acc = akselerasjon*10, grip = maks rattutslag*100, brake = m/s^2, mass = relativ*100
// wb = akselavstand (lavere = mer vridbar), fall = hvor godt styringen holder i fart, off = straff utenfor asfalt
const VEHICLES = [
  { id: 'f1',    name: 'Formel 1',     kind: 'f1',    top: 330, acc: 127, grip: 62, brake: 55, mass: 80,  wb: 3.0, fall: 30, off: 2.6, lean: 0 },
  { id: 'gt',    name: 'Rask bil',     kind: 'gt',    top: 280, acc: 98,  grip: 50, brake: 32, mass: 100, wb: 2.7, fall: 24, off: 1.7, lean: 0 },
  { id: 'truck', name: 'Tung bil',     kind: 'truck', top: 130, acc: 59,  grip: 34, brake: 15, mass: 230, wb: 4.2, fall: 15, off: 1.0, lean: 0, camH: 1.7 },
  { id: 'moto',  name: 'Motorsykkel',  kind: 'moto',  top: 300, acc: 113, grip: 68, brake: 34, mass: 45,  wb: 1.5, fall: 26, off: 2.0, lean: 0.85 },
  { id: 'bike',  name: 'Sykkel',       kind: 'bike',  top: 45,  acc: 27,  grip: 82, brake: 12, mass: 25,  wb: 1.1, fall: 11, off: 0.6, lean: 0.5 },
];
const SL = [['Top', 'top'], ['Acc', 'acc'], ['Grip', 'grip'], ['Brake', 'brake'], ['Mass', 'mass']];
let vehId = store.get('gateracer_veh', 'f1');
let custom = store.get('gateracer_custom', null);
let P = null;
function vehDef(id) { return id === 'custom' ? (custom || { ...VEHICLES[0], id: 'custom', name: 'Egen bil', base: 'f1' }) : (VEHICLES.find(v => v.id === id) || VEHICLES[0]); }
function applyVeh() {
  const d = vehDef(vehId);
  P = { kind: d.kind, name: d.name, vmax: d.top / 3.6, acc: d.acc / 10, grip: d.grip / 100, brake: d.brake,
        mass: d.mass / 100, wb: d.wb, fall: d.fall, off: d.off, lean: d.lean, camH: d.camH || 0 };
  store.set('gateracer_veh', vehId);
  if (scene && carGroup) { scene.remove(carGroup); carGroup = buildVehicle(P.kind); scene.add(carGroup); }
  $('vehName').textContent = d.name;
  drawGarage();
}
function refreshVehSel() {
  const sel = $('vehSel'); sel.innerHTML = '';
  for (const v of VEHICLES) { const o = document.createElement('option'); o.value = v.id; o.textContent = v.name; sel.appendChild(o); }
  const o = document.createElement('option'); o.value = 'custom'; o.textContent = custom ? 'Egen bil ★' : 'Egen bil…'; sel.appendChild(o);
  sel.value = vehId;
}
function drawGarage() {
  const d = vehDef(vehId);
  $('garageTitle').textContent = d.name;
  $('garageSub').textContent = vehId === 'custom' ? 'Din egen. Dra i spakene.' : 'Dra i en spake for å lage din egen versjon.';
  const fmtv = { top: v => v + ' km/h', acc: v => (v / 10).toFixed(1) + ' m/s²', grip: v => v + '%', brake: v => v + ' m/s²', mass: v => (v / 100).toFixed(2) + '×' };
  for (const [ui, key] of SL) {
    const inp = $('s' + ui); inp.value = d[key];
    $('v' + ui).textContent = fmtv[key](Number(d[key]));
    const bars = $('b' + ui), frac = (d[key] - inp.min) / (inp.max - inp.min);
    bars.innerHTML = ''; for (let i = 0; i < 10; i++) { const b = document.createElement('i'); if (i / 10 < frac) b.className = 'on'; bars.appendChild(b); }
  }
}
for (const [ui, key] of SL) $('s' + ui).addEventListener('input', () => {
  const base = vehDef(vehId);
  custom = { ...base, id: 'custom', name: 'Egen bil', base: base.base || base.id, kind: base.kind };
  custom[key] = Number($('s' + ui).value);
  store.set('gateracer_custom', custom); vehId = 'custom'; refreshVehSel(); applyVeh();
});
$('vehSel').onchange = () => { vehId = $('vehSel').value; if (vehId === 'custom' && !custom) { const b = vehDef('f1'); custom = { ...b, id: 'custom', name: 'Egen bil', base: 'f1' }; store.set('gateracer_custom', custom); refreshVehSel(); } applyVeh(); };
$('btnGarage').onclick = () => { const g = $('garage'); g.style.display = g.style.display === 'block' ? 'none' : 'block'; $('btnGarage').classList.toggle('active', g.style.display === 'block'); };
$('btnGarageClose').onclick = () => { $('garage').style.display = 'none'; $('btnGarage').classList.remove('active'); };
$('btnGarageReset').onclick = () => { const b = vehDef(vehId).base || 'f1'; custom = null; store.set('gateracer_custom', null); vehId = b; refreshVehSel(); applyVeh(); };
refreshVehSel();

// ------------------------------------------------------------------ 3D-scene
const raceDiv = $('race');
let renderer, scene, camera, sun, carGroup, trackGroup = null, bldMesh = null;
const terrainChunks = []; let makeHi = null;
const MOBILE = new URLSearchParams(location.search).get('mobile') === '1' || matchMedia('(pointer: coarse)').matches || innerWidth < 900;
const HI_RADIUS = MOBILE ? 330 : 700;
const V = (x, y, z) => new THREE.Vector3(x, z, -y);
const CLS_COL = [[118, 158, 86], [66, 104, 58], [64, 118, 170], [176, 172, 96], [110, 168, 80], [120, 140, 70], [150, 142, 132], [150, 150, 140], [88, 96, 90]];
function buildStaticScene() {
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, MOBILE ? 1 : 2));
  renderer.shadowMap.enabled = !MOBILE; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  raceDiv.appendChild(renderer.domElement);
  scene = new THREE.Scene(); scene.background = new THREE.Color(0x8fc1ea); scene.fog = new THREE.Fog(0xb9d3ea, 300, 1600);
  camera = new THREE.PerspectiveCamera(70, 1, 0.5, 5000);
  scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x3f4a30, 0.85));
  sun = new THREE.DirectionalLight(0xfff2dc, 1.6); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera; sc.left = -160; sc.right = 160; sc.top = 160; sc.bottom = -160; sc.near = 10; sc.far = 800; sun.shadow.bias = -0.0008;
  scene.add(sun); scene.add(sun.target);
  // terreng i biter med to detaljnivåer (nær bilen: full oppløsning, ellers 1/4)
  const CH = 150, tmat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const chunkMesh = (i0, j0, i1, j1, step) => {
    const rows = [], cols = [];
    for (let i = i0; i < i1; i += step) rows.push(i); rows.push(i1);
    for (let j = j0; j < j1; j += step) cols.push(j); cols.push(j1);
    const nr = rows.length, nc = cols.length, pos = new Float32Array(nr * nc * 3), col = new Float32Array(nr * nc * 3);
    for (let a = 0; a < nr; a++) for (let b = 0; b < nc; b++) {
      const i = rows[a], j = cols[b], k = i * T.nx + j, o = (a * nc + b) * 3, c = CLS_COL[TC[k]] || CLS_COL[0], nz = 1 + (((i * 7 + j * 13) % 10) - 5) * 0.008;
      pos[o] = T.x0 + j * T.cell; pos[o + 1] = T.zmin + TZ[k] / 10; pos[o + 2] = -(T.y0 + i * T.cell);
      col[o] = c[0] / 255 * nz; col[o + 1] = c[1] / 255 * nz; col[o + 2] = c[2] / 255 * nz;
    }
    const idx = new Uint32Array((nr - 1) * (nc - 1) * 6); let q = 0;
    for (let a = 0; a < nr - 1; a++) for (let b = 0; b < nc - 1; b++) { const p0 = a * nc + b, p1 = p0 + 1, p2 = p0 + nc, p3 = p2 + 1; idx[q++] = p0; idx[q++] = p1; idx[q++] = p2; idx[q++] = p1; idx[q++] = p3; idx[q++] = p2; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, tmat); mesh.receiveShadow = true; return mesh;
  };
  for (let ci = 0; ci < T.ny - 1; ci += CH) for (let cj = 0; cj < T.nx - 1; cj += CH) {
    const i1 = Math.min(T.ny - 1, ci + CH), j1 = Math.min(T.nx - 1, cj + CH);
    const lo = chunkMesh(ci, cj, i1, j1, MOBILE ? 6 : 4); scene.add(lo);
    terrainChunks.push({ ci, cj, i1, j1, hi: null, lo, cx: T.x0 + (cj + j1) / 2 * T.cell, cy: T.y0 + (ci + i1) / 2 * T.cell });
  }
  makeHi = c => chunkMesh(c.ci, c.cj, c.i1, c.j1, 1);
  // veier
  const roadGeos = world.roads.map(r => ribbon(r.p, r.w, 0.08, r.drive ? [0.30, 0.31, 0.34] : [0.62, 0.58, 0.50], false)).filter(Boolean);
  const roads = new THREE.Mesh(mergeGeometries(roadGeos), new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })); roads.receiveShadow = true; scene.add(roads);
  // trær
  const treeList = MOBILE ? world.trees.filter((_, i) => i % 2 === 0) : world.trees;
  const n = treeList.length;
  const cone = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 6), new THREE.MeshLambertMaterial({ flatShading: true }), n);
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 5), new THREE.MeshLambertMaterial({ color: 0x5a4030 }), n);
  const m = new THREE.Matrix4(), qq = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), tmpc = new THREE.Color();
  treeList.forEach((t, i) => {
    const [x, y, h] = t; const z = terrainZ(x, y); const r = Math.max(1.0, h * 0.22);
    p.set(x, z + h * 0.2 + h * 0.4, -y); s.set(r, h * 0.8, r); m.compose(p, qq, s); cone.setMatrixAt(i, m);
    tmpc.setHSL(0.30 + Math.random() * 0.06, 0.45, 0.22 + Math.random() * 0.1); cone.setColorAt(i, tmpc);
    p.set(x, z + h * 0.1, -y); s.set(Math.max(0.3, h * 0.05), h * 0.22, Math.max(0.3, h * 0.05)); m.compose(p, qq, s); trunk.setMatrixAt(i, m);
  });
  cone.castShadow = true; trunk.castShadow = true; scene.add(cone); scene.add(trunk);
  carGroup = buildVehicle(P.kind); scene.add(carGroup);
  initSmoke();
  resizeRace();
  $('stats').textContent = `${world.origin.name} · ${world.buildings.length} bygninger · ${n} trær · ${world.lidar === false ? 'hushøyder gjettet (Kartverket svarte ikke)' : 'høyder fra Kartverket laser'} · Kart © OpenStreetMap`;
}
// ------------------------------------------------------------------ kjøretøymodeller
const M = (c, opt) => new THREE.MeshLambertMaterial({ color: c, flatShading: true, ...opt });
function wheel(g, r, w, x, z, rim) {
  const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 14), M(0x14141a));
  t.rotation.x = Math.PI / 2; t.position.set(x, r, z); g.add(t);
  const h = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w * 1.02, 10), M(rim ?? 0x8d94ab));
  h.rotation.x = Math.PI / 2; h.position.set(x, r, z); g.add(h);
}
function buildVehicle(kind, ghost) {
  const g = new THREE.Group();
  const RED = 0xe0333a, DARK = 0x15151c, CARBON = 0x23252e;
  const add = (geo, col, x, y, z, ry) => { const m = new THREE.Mesh(geo, M(col)); m.position.set(x, y, z); if (ry) m.rotation.y = ry; g.add(m); return m; };
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  if (kind === 'f1') {
    // dekk: brede bak, smalere foran (slicks)
    wheel(g, 0.34, 0.32, 1.72, 0.78); wheel(g, 0.34, 0.32, 1.72, -0.78);
    wheel(g, 0.36, 0.42, -1.62, 0.80); wheel(g, 0.36, 0.42, -1.62, -0.80);
    add(box(4.9, 0.12, 1.15), CARBON, 0.2, 0.14, 0);                       // gulv
    add(box(2.2, 0.34, 0.78), RED, 0.35, 0.38, 0);                          // monocoque
    add(box(1.5, 0.26, 0.42), RED, 2.15, 0.34, 0);                          // nese
    add(box(0.5, 0.16, 0.3), RED, 2.95, 0.26, 0);                           // nesetipp
    add(box(0.75, 0.05, 1.9), CARBON, 3.05, 0.13, 0);                       // frontvinge
    add(box(0.8, 0.34, 0.06), RED, 3.05, 0.28, 0.95); add(box(0.8, 0.34, 0.06), RED, 3.05, 0.28, -0.95);
    add(box(1.9, 0.46, 0.4), RED, -0.15, 0.45, 0.62); add(box(1.9, 0.46, 0.4), RED, -0.15, 0.45, -0.62);  // sidekasser
    add(box(1.5, 0.5, 0.62), RED, -1.15, 0.5, 0);                           // motordeksel
    add(box(1.2, 0.42, 0.14), RED, -1.3, 0.86, 0);                          // haifinne
    add(box(0.5, 0.34, 0.42), DARK, -0.42, 0.78, 0);                        // luftinntak
    add(box(0.62, 0.3, 0.64), DARK, 0.72, 0.62, 0);                         // cockpit
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.045, 6, 14), M(DARK));
    halo.rotation.y = Math.PI / 2; halo.position.set(0.78, 0.85, 0); g.add(halo);
    add(box(0.36, 0.05, 0.1), DARK, 1.16, 0.86, 0);
    add(new THREE.SphereGeometry(0.19, 10, 8), 0xffd14a, 0.62, 0.86, 0);    // hjelm
    add(box(0.14, 0.55, 0.14), CARBON, -2.15, 0.72, 0);                     // vingepylon
    add(box(0.42, 0.07, 1.05), RED, -2.35, 1.02, 0);                        // bakvinge
    add(box(0.5, 0.46, 0.06), RED, -2.35, 0.85, 0.54); add(box(0.5, 0.46, 0.06), RED, -2.35, 0.85, -0.54);
    add(box(0.3, 0.05, 0.9), CARBON, -2.5, 0.42, 0);                        // beam wing
    for (const sx of [1.72, -1.62]) for (const sz of [1, -1]) {             // opphengsarmer
      add(box(0.9, 0.05, 0.05), CARBON, sx, 0.3, sz * 0.5, 0);
      add(box(0.9, 0.05, 0.05), CARBON, sx, 0.52, sz * 0.5, 0);
    }
  } else if (kind === 'gt') {
    wheel(g, 0.35, 0.3, 1.35, 0.82); wheel(g, 0.35, 0.3, 1.35, -0.82);
    wheel(g, 0.35, 0.34, -1.35, 0.84); wheel(g, 0.35, 0.34, -1.35, -0.84);
    add(box(4.3, 0.48, 1.78), 0x2f6fd8, 0, 0.5, 0);
    add(box(2.1, 0.42, 1.6), 0x2a3040, -0.25, 0.92, 0);
    add(box(1.0, 0.3, 1.5), 0x2f6fd8, 1.7, 0.5, 0);
    add(box(0.9, 0.06, 1.5), 0x1a1d26, -2.0, 1.12, 0);
    add(box(0.12, 0.22, 0.1), 0x1a1d26, -1.75, 1.02, 0.6); add(box(0.12, 0.22, 0.1), 0x1a1d26, -1.75, 1.02, -0.6);
    add(box(0.1, 0.2, 0.4), 0xfff3cf, 2.16, 0.55, 0.55); add(box(0.1, 0.2, 0.4), 0xfff3cf, 2.16, 0.55, -0.55);
  } else if (kind === 'truck') {
    wheel(g, 0.55, 0.4, 1.8, 1.0); wheel(g, 0.55, 0.4, 1.8, -1.0);
    wheel(g, 0.55, 0.45, -1.5, 1.02); wheel(g, 0.55, 0.45, -1.5, -1.02);
    wheel(g, 0.55, 0.45, -2.6, 1.02); wheel(g, 0.55, 0.45, -2.6, -1.02);
    add(box(2.2, 1.35, 2.15), 0xd8d8dc, 1.55, 1.32, 0);                     // førerhus
    add(box(1.8, 0.5, 1.95), 0x5a6b8c, 1.8, 1.9, 0);                        // vindu
    add(box(3.6, 1.45, 2.2), 0x8c3a32, -1.5, 1.35, 0);                      // kasse
    add(box(3.6, 0.12, 2.3), 0x6e2b25, -1.5, 2.1, 0);                       // tak
    add(box(0.22, 0.8, 0.22), 0x9aa0b0, 0.45, 2.2, 0.9);
  } else if (kind === 'moto') {
    wheel(g, 0.34, 0.16, 0.72, 0); wheel(g, 0.34, 0.2, -0.72, 0);
    add(box(1.5, 0.3, 0.3), 0x1b1e28, 0, 0.6, 0);
    add(box(0.7, 0.34, 0.42), 0xe0333a, 0.25, 0.82, 0);                     // tank
    add(box(0.55, 0.4, 0.34), 0xe0333a, 0.85, 0.78, 0);                     // frontfairing
    add(box(0.6, 0.14, 0.36), 0x1b1e28, -0.55, 0.88, 0);                    // sete
    add(box(0.34, 0.55, 0.3), 0x2b3040, -0.15, 1.2, 0);                     // rytter
    add(box(0.7, 0.12, 0.12), 0x2b3040, 0.35, 1.28, 0.18); add(box(0.7, 0.12, 0.12), 0x2b3040, 0.35, 1.28, -0.18);
    add(new THREE.SphereGeometry(0.17, 10, 8), 0xffd14a, -0.02, 1.56, 0);
  } else { // bike
    wheel(g, 0.34, 0.06, 0.55, 0, 0xcfd4e2); wheel(g, 0.34, 0.06, -0.55, 0, 0xcfd4e2);
    add(box(1.0, 0.07, 0.07), 0x2fa34a, 0, 0.62, 0);
    add(box(0.07, 0.5, 0.07), 0x2fa34a, -0.4, 0.5, 0);
    add(box(0.07, 0.55, 0.07), 0x2fa34a, 0.5, 0.55, 0);
    add(box(0.3, 0.08, 0.2), 0x1b1e28, -0.34, 0.86, 0);                     // sal
    add(box(0.08, 0.08, 0.5), 0x1b1e28, 0.52, 0.9, 0);                      // styre
    add(box(0.3, 0.6, 0.28), 0x3b6fd8, -0.2, 1.16, 0);                      // syklist
    add(box(0.62, 0.1, 0.1), 0x3b6fd8, 0.15, 1.2, 0.14); add(box(0.62, 0.1, 0.1), 0x3b6fd8, 0.15, 1.2, -0.14);
    add(new THREE.SphereGeometry(0.16, 10, 8), 0xf2c744, -0.12, 1.52, 0);
  }
  if (ghost) g.traverse(o => { if (o.material) { o.material = new THREE.MeshBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.3, depthWrite: false }); } });
  else g.traverse(o => { o.castShadow = true; });
  return g;
}

// ------------------------------------------------------------------ røyk/støv
const SMOKE = []; let smokeGeo = null;
function initSmoke() {
  smokeGeo = new THREE.IcosahedronGeometry(0.5, 0);
  for (let i = 0; i < 40; i++) {
    const m = new THREE.Mesh(smokeGeo, new THREE.MeshBasicMaterial({ color: 0xdedede, transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false; scene.add(m); SMOKE.push({ m, life: 0, vx: 0, vy: 0, vz: 0 });
  }
}
function puff(x, y, col) {
  const s = SMOKE.find(q => q.life <= 0); if (!s) return;
  s.life = 1; s.m.visible = true; s.m.material.color.setHex(col);
  s.m.position.set(x, terrainZ(x, y) + 0.25, -y); s.m.scale.setScalar(0.4);
  s.vx = (Math.random() - 0.5) * 2.5; s.vy = (Math.random() - 0.5) * 2.5; s.vz = 1.2 + Math.random();
}
function updateSmoke(dt) {
  for (const s of SMOKE) {
    if (s.life <= 0) continue;
    s.life -= dt * 0.85;
    if (s.life <= 0) { s.m.visible = false; s.m.material.opacity = 0; continue; }
    s.m.position.x += s.vx * dt; s.m.position.z -= s.vy * dt; s.m.position.y += s.vz * dt * 0.6;
    s.m.scale.setScalar(0.4 + (1 - s.life) * 2.4); s.m.material.opacity = s.life * 0.45;
  }
}

function resizeRace() { const w = raceDiv.clientWidth, h = raceDiv.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
const bGeoCache = [];
function buildingGeo(k) {
  if (bGeoCache[k]) return bGeoCache[k];
  const b = world.buildings[k];
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(b.p.map(p => new THREE.Vector2(p[0], p[1]))), { depth: (b.top ?? b.zt + b.h) - (b.zb - 1.5), bevelEnabled: false });
  g.rotateX(-Math.PI / 2); g.translate(0, b.zb - 1.5, 0);
  const c = new THREE.Color(b.c), roof = c.clone().multiplyScalar(0.55), n = g.attributes.position.count, cc = new Float32Array(n * 3), nrm = g.attributes.normal;
  for (let i = 0; i < n; i++) { const k2 = nrm.getY(i) > 0.9 ? roof : c; cc[i * 3] = k2.r; cc[i * 3 + 1] = k2.g; cc[i * 3 + 2] = k2.b; }
  g.setAttribute('color', new THREE.BufferAttribute(cc, 3)); g.deleteAttribute('uv');
  return (bGeoCache[k] = g);
}
function rebuildBuildings() {
  if (bldMesh) { scene.remove(bldMesh); bldMesh.geometry.dispose(); }
  const geos = []; for (let k = 0; k < world.buildings.length; k++) if (!hidden.has(k)) geos.push(buildingGeo(k));
  bldMesh = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  bldMesh.castShadow = true; bldMesh.receiveShadow = true; scene.add(bldMesh);
}
function ribbon(pts, width, lift, color, closed, colorFn) {
  const n = pts.length; if (n < 2) return null;
  const pos = [], col = [], idx = [], segs = closed ? n : n - 1;
  for (let i = 0; i < n; i++) {
    const a = closed ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)], b = closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
    const wd = typeof width === 'function' ? width(i) : width;
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, nxv = -dy / L * wd / 2, nyv = dx / L * wd / 2, p = pts[i], c = colorFn ? colorFn(i) : color;
    for (const sgn of [-1, 1]) { const x = p[0] + nxv * sgn, y = p[1] + nyv * sgn; pos.push(x, terrainZ(x, y) + lift, -y); col.push(c[0], c[1], c[2]); }
  }
  for (let i = 0; i < segs; i++) { const a = i * 2, b = ((i + 1) % n) * 2; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g.toNonIndexed();
}

// ------------------------------------------------------------------ løype -> bane
let track = null, gantry = null, gantryLamps = [];
const TRACK_W = 7, MIN_W = 4.2;
function resample(pts, step, closed) {
  const out = []; let carry = 0; const n = pts.length, m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const a = pts[i], b = pts[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-6) continue;
    let s = carry; while (s < L) { const t = s / L; out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); s += step; } carry = s - L;
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}
function smooth(pts, r, closed) {
  const n = pts.length;
  return pts.map((_, i) => { let x = 0, y = 0, c = 0; for (let k = -r; k <= r; k++) { let j = i + k; if (closed) j = (j + n) % n; else if (j < 0 || j >= n) continue; x += pts[j][0]; y += pts[j][1]; c++; } return [x / c, y / c]; });
}
function smoothArr(a, r, closed) {
  const n = a.length, out = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0, c = 0; for (let k = -r; k <= r; k++) { let j = i + k; if (closed) j = (j + n) % n; else if (j < 0 || j >= n) continue; s += a[j]; c++; } out[i] = s / c; }
  a.set(out);
}
function blockAt(x, y) {      // hus som faktisk sperrer (manuelt fjernede teller ikke)
  for (const k of candidates(x, y)) {
    const b = world.buildings[k]; if (removedManual.has(b.id)) continue;
    if (x >= b.bb[0] && x <= b.bb[2] && y >= b.bb[1] && y <= b.bb[3] && pip(x, y, b.p)) return k;
  }
  return -1;
}
function clearTrack() {
  if (trackGroup) { scene.remove(trackGroup); trackGroup.traverse(o => o.geometry && o.geometry.dispose()); trackGroup = null; }
  if (gantry) { scene.remove(gantry); gantry = null; gantryLamps = []; }
  track = null;
  hidden = new Set(); world.buildings.forEach((b, k) => { if (removedManual.has(b.id)) hidden.add(k); });
  rebuildBuildings();
}
function buildTrack(rawPts, closed) {
  let pts = resample(rawPts, 1.5, closed);
  for (let k = 0; k < 3; k++) pts = smooth(pts, 5, closed);
  pts = resample(pts, 2, closed);
  const n = pts.length;
  const dirIn = (arr, i) => { const m = arr.length, a = closed ? arr[(i - 1 + m) % m] : arr[Math.max(0, i - 1)], b = closed ? arr[(i + 1) % m] : arr[Math.min(m - 1, i + 1)]; const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return [dx / L, dy / L]; };
  const probe = (x, y, nx, ny) => { for (let d = 0.6; d <= 7; d += 0.6) if (blockAt(x + nx * d, y + ny * d) >= 0) return d; return 7.6; };
  // 1) skyv midtlinja mot midten av korridoren mellom husene
  const shift = new Float32Array(n), w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const d = dirIn(pts, i), nx = -d[1], ny = d[0], p = pts[i];
    const cl = probe(p[0], p[1], nx, ny), cr = probe(p[0], p[1], -nx, -ny);
    shift[i] = clamp((cl - cr) / 2, -2.4, 2.4); w[i] = clamp(cl + cr - 1.2, MIN_W, TRACK_W);
  }
  smoothArr(shift, 7, closed); smoothArr(w, 7, closed);
  pts = pts.map((p, i) => { const d = dirIn(pts, i); return [p[0] - d[1] * shift[i], p[1] + d[0] * shift[i]]; });
  // 2) gjør banen smalere der det fortsatt er trangt (i stedet for å fjerne hus)
  for (let i = 0; i < n; i++) {
    const d = dirIn(pts, i), nx = -d[1], ny = d[0], p = pts[i];
    const cl = probe(p[0], p[1], nx, ny), cr = probe(p[0], p[1], -nx, -ny);
    w[i] = Math.min(w[i], clamp(Math.min(cl, cr) * 2 - 0.8, MIN_W, TRACK_W));
  }
  smoothArr(w, 5, closed);
  // 3) bare hus som står rett i kjørelinja må vike
  hidden = new Set(); world.buildings.forEach((b, k) => { if (removedManual.has(b.id)) hidden.add(k); });
  const CLEAR = MIN_W / 2 + 0.45;
  for (let i = 0; i < n; i += 2) {
    const p = pts[i];
    for (const k of candidates(p[0], p[1], 8)) {
      if (hidden.has(k)) continue;
      if (polyDist(p[0], p[1], world.buildings[k].p) < CLEAR) hidden.add(k);
    }
  }
  rebuildBuildings();
  const grid = new Map(), cell = 8;
  pts.forEach((p, i) => { const key = `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`; (grid.get(key) || grid.set(key, []).get(key)).push(i); });
  track = { pts, n, grid, cell, closed, w, dirAt: i => dirIn(pts, clamp(i, 0, n - 1)), sectors: [Math.floor(n / 3), Math.floor(2 * n / 3)] };
  // ---- geometri
  if (trackGroup) { scene.remove(trackGroup); trackGroup.traverse(o => o.geometry && o.geometry.dispose()); }
  trackGroup = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  trackGroup.add(new THREE.Mesh(ribbon(pts, i => w[i], 0.2, [0.17, 0.17, 0.19], closed), mat));
  const edge = (sgn, off, wid, col, colFn) => {
    const o = pts.map((p, i) => { const d = track.dirAt(i), q = (w[i] / 2 + off) * sgn; return [p[0] - d[1] * q, p[1] + d[0] * q]; });
    trackGroup.add(new THREE.Mesh(ribbon(o, wid, 0.22, col, closed, colFn), mat));
  };
  for (const sgn of [-1, 1]) {
    edge(sgn, -0.25, 0.16, [0.92, 0.92, 0.9]);                                                  // hvit kantlinje
    edge(sgn, 0.5, 0.9, null, i => (Math.floor(i / 4) % 2 === 0) ? [0.85, 0.15, 0.15] : [0.92, 0.92, 0.9]);  // kantstein
  }
  const cross = (i0, rows, colorFn) => {
    const pos = [], col = [], cols = 8;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const quad = [];
      for (const [ri, ci] of [[r, c], [r, c + 1], [r + 1, c + 1], [r + 1, c]]) {
        const ii = clamp(i0 + ri, 0, n - 1), p = pts[ii], d = track.dirAt(ii), cw = w[ii] / cols, off = -w[ii] / 2 + ci * cw;
        const x = p[0] - d[1] * off, y = p[1] + d[0] * off; quad.push([x, terrainZ(x, y) + 0.27, -y]);
      }
      const k = colorFn(r, c); for (const t of [0, 1, 2, 0, 2, 3]) { pos.push(...quad[t]); col.push(k, k, k); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
    trackGroup.add(new THREE.Mesh(g, mat));
  };
  cross(0, 2, (r, c) => ((r + c) % 2 === 0) ? 0.06 : 0.95);
  if (!closed) cross(n - 3, 2, (r, c) => ((r + c) % 2 === 0) ? 0.06 : 0.95);
  const blueMat = new THREE.MeshLambertMaterial({ color: 0x3a8cff, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  for (const sIdx of track.sectors) {
    const p = pts[sIdx], d = track.dirAt(sIdx), hw = w[sIdx] / 2 + 1, pos = [];
    for (const [ri, off] of [[0, -hw], [0, hw], [1, hw], [1, -hw]]) { const pp = pts[Math.min(n - 1, sIdx + ri)]; const x = pp[0] - d[1] * off, y = pp[1] + d[0] * off; pos.push(x, terrainZ(x, y) + 0.3, -y); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex([0, 2, 1, 0, 3, 2]); g.computeVertexNormals();
    trackGroup.add(new THREE.Mesh(g, blueMat));
    for (const sgn of [-1, 1]) { const x = p[0] - d[1] * hw * sgn, y = p[1] + d[0] * hw * sgn, z = terrainZ(x, y); const pole = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3, 0.3), blueMat); pole.position.set(x, z + 1.5, -y); trackGroup.add(pole); }
  }
  trackGroup.traverse(o => { o.receiveShadow = true; }); scene.add(trackGroup);
  buildGantry();
  buildMinimapBase(); buildPeds(); buildSpectators();
}
// ---- startportal med fem lyspar (som i Formel 1)
const LAMP_OFF = new THREE.MeshLambertMaterial({ color: 0x2a1418 }), LAMP_ON = new THREE.MeshBasicMaterial({ color: 0xff2020 });
function buildGantry() {
  if (gantry) { scene.remove(gantry); }
  gantry = new THREE.Group(); gantryLamps = [];
  const i0 = Math.min(6, track.n - 1), p = track.pts[i0], d = track.dirAt(i0), hw = track.w[i0] / 2 + 1.6, z = terrainZ(p[0], p[1]);
  const steel = new THREE.MeshLambertMaterial({ color: 0x9aa3b8 }), dark = new THREE.MeshLambertMaterial({ color: 0x1a1c24 });
  const put = (mesh, off, h) => { mesh.position.set(p[0] - d[1] * off, z + h, -(p[1] + d[0] * off)); mesh.rotation.y = Math.atan2(-d[1], -d[0]); gantry.add(mesh); return mesh; };
  for (const sgn of [-1, 1]) put(new THREE.Mesh(new THREE.BoxGeometry(0.34, 5.4, 0.34), steel), hw * sgn, 2.7);
  put(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.45, hw * 2 + 0.34), steel), 0, 5.15);
  put(new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.0, hw * 1.5), dark), 0, 4.35);
  const lampGeo = new THREE.SphereGeometry(0.22, 10, 8);
  for (let c = 0; c < 5; c++) for (let r = 0; r < 2; r++) {
    const off = (c - 2) * Math.min(1.1, hw * 0.45);
    const m = new THREE.Mesh(lampGeo, LAMP_OFF);
    m.position.set(p[0] - d[1] * off - d[0] * 0.26, z + 4.62 - r * 0.52, -(p[1] + d[0] * off - d[1] * 0.26));
    gantry.add(m); gantryLamps.push(m);
  }
  scene.add(gantry);
}
function nearestTrack(x, y, hint, hdg) {
  if (!track) return { i: -1, d: 99 };
  if (hint != null && hint >= 0) {
    // smalt vindu framover, og retningen må stemme: banen kan gå tilbake langs samme gate
    let b = -1, best0 = Infinity, bd = Infinity;
    const hx = hdg != null ? Math.cos(hdg) : 0, hy = hdg != null ? Math.sin(hdg) : 0;
    for (let k = -3; k <= 40; k++) {
      let i = hint + k; if (track.closed) i = (i + track.n) % track.n; else if (i < 0 || i >= track.n) continue;
      const p = track.pts[i], d = (p[0] - x) ** 2 + (p[1] - y) ** 2;
      let sc = d;
      if (hdg != null) { const t = track.dirAt(i); if (t[0] * hx + t[1] * hy < 0) sc += 3000; }
      if (sc < best0) { best0 = sc; bd = d; b = i; }
    }
    if (b >= 0 && bd < 625) return { i: b, d: Math.sqrt(bd) };
  }
  const cx = Math.floor(x / track.cell), cy = Math.floor(y / track.cell); let best = -1, bd = Infinity;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const arr = track.grid.get(`${cx + a},${cy + b}`); if (!arr) continue; for (const i of arr) { const p = track.pts[i]; const d = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (d < bd) { bd = d; best = i; } } }
  return { i: best, d: Math.sqrt(bd) };
}

// ------------------------------------------------------------------ fotgjengere (går langs veiene, overalt)
const PEDS = []; let PED_N = MOBILE ? 30 : 72, hits = 0;
const SWEATER = [0x3b6fd8, 0xe04848, 0x2fa34a, 0xf2c744, 0xffffff, 0xff7ab3, 0x8b5cf6, 0xff8c1a, 0x1fb6c9];
const TROUSERS = [0x24304a, 0x555555, 0x7a5a3a, 0x1a1a1a, 0xc9b99a], SHOES = [0xffffff, 0x8b4a1c, 0xd62828, 0x1a1a1a];
const PED_MAT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
function tintedBox(w, h, d, x, y, z, col, rz) {
  const g = new THREE.BoxGeometry(w, h, d); if (rz) g.rotateZ(rz); g.translate(x, y, z);
  const n = g.attributes.position.count, c = new Float32Array(n * 3), k = new THREE.Color(col);
  for (let i = 0; i < n; i++) { c[i * 3] = k.r; c[i * 3 + 1] = k.g; c[i * 3 + 2] = k.b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.deleteAttribute('uv'); return g;
}
function makePed() {
  const pick = a => a[Math.floor(Math.random() * a.length)], BL = 0x0e0e12;
  const sw = pick(SWEATER), tr = pick(TROUSERS), sh = pick(SHOES);
  const m = new THREE.Mesh(mergeGeometries([
    tintedBox(0.16, 0.1, 0.3, 0.11, 0.05, 0.03, sh), tintedBox(0.16, 0.1, 0.3, -0.11, 0.05, 0.03, sh),
    tintedBox(0.36, 0.72, 0.26, 0, 0.46, 0, tr),
    tintedBox(0.5, 0.62, 0.3, 0, 1.13, 0, sw), tintedBox(0.8, 0.14, 0.14, 0, 1.32, 0, sw),
    tintedBox(0.1, 0.1, 0.12, 0.44, 1.22, 0, BL), tintedBox(0.1, 0.1, 0.12, -0.44, 1.22, 0, BL),
    tintedBox(0.12, 0.1, 0.12, 0, 1.48, 0, BL), tintedBox(0.3, 0.3, 0.3, 0, 1.67, 0, BL),
  ]), PED_MAT);
  m.castShadow = !MOBILE; return m;
}
function spawnPed(p, cx, cy, near) {
  const seg = randomRoadSeg(cx, cy, near ? 22 : 25, near ? 150 : 190);
  if (!seg) { p.mode = 'idle'; p.g.visible = false; p.t = 0; return; }
  p.seg = seg; p.len = Math.hypot(seg[2] - seg[0], seg[3] - seg[1]) || 1;
  p.u = Math.random(); p.dir = Math.random() < 0.5 ? -1 : 1; p.speed = 0.9 + Math.random() * 0.9;
  p.off = (Math.random() < 0.5 ? -1 : 1) * (seg[4] + 0.7 + Math.random() * 1.3); p.cross = 0;
  p.mode = 'walk'; p.t = Math.random() * 10; p.g.visible = true; p.g.rotation.set(0, 0, 0); p.g.scale.set(1, 1, 1);
}
function buildPeds() {
  while (PEDS.length < PED_N) { const g = makePed(); scene.add(g); PEDS.push({ g }); }
  for (const p of PEDS) spawnPed(p, car.x, car.y, false);
  hits = 0;
}
function updatePeds(dt) {
  const cdx = Math.cos(car.hdg), cdy = Math.sin(car.hdg);
  for (const p of PEDS) {
    p.t += dt;
    if (p.mode === 'idle') { if (p.t > 1.5) spawnPed(p, car.x, car.y, true); continue; }
    if (p.mode === 'walk') {
      const s = p.seg, dx = (s[2] - s[0]) / p.len, dy = (s[3] - s[1]) / p.len;
      p.u += p.dir * p.speed * dt / p.len;
      if (p.u < 0 || p.u > 1) { spawnPed(p, car.x, car.y, true); continue; }
      if (!p.cross && Math.random() < dt * 0.04) p.cross = -Math.sign(p.off);
      if (p.cross) { p.off += p.cross * 1.2 * dt; if (Math.abs(p.off) > s[4] + 0.7 && Math.sign(p.off) === p.cross) p.cross = 0; }
      p.x = s[0] + (s[2] - s[0]) * p.u - dy * p.off; p.y = s[1] + (s[3] - s[1]) * p.u + dx * p.off;
      p.z = terrainZ(p.x, p.y);
      const wx = p.cross ? -dy * p.cross : dx * p.dir, wy = p.cross ? dx * p.cross : dy * p.dir;
      p.g.position.set(p.x, p.z + 0.05 * Math.abs(Math.sin(p.t * 9)), -p.y);
      p.g.rotation.y = Math.atan2(wx, -wy); p.g.rotation.z = Math.sin(p.t * 9) * 0.06;
      const ddx = car.x - p.x, ddy = car.y - p.y, dist = Math.hypot(ddx, ddy);
      if (dist > 280) { spawnPed(p, car.x, car.y, true); continue; }
      if (dist < 1.9 && Math.abs(car.v) > 1.5) {
        const sp = car.v, boost = clamp(1.6 / Math.max(0.35, P.mass), 0.6, 3.2);
        p.mode = 'fly'; p.t = 0; p.bounces = 0;
        p.vx = (cdx * sp * 0.9 - ddx * 0.5 + (Math.random() - 0.5) * 3) * boost;
        p.vy = (cdy * sp * 0.9 - ddy * 0.5 + (Math.random() - 0.5) * 3) * boost;
        p.vz = (4 + Math.abs(sp) * 0.45) * Math.min(2, boost);
        p.wx = (Math.random() - 0.5) * 16; p.wz = (Math.random() - 0.5) * 16; p.wy = (Math.random() - 0.5) * 7;
        hits++;                                  // ingen fartstap: du skal ikke bremses av folk
        showMsg(['AU!', 'OI!', 'NEEEI!', 'HEI!', 'ÅÅÅ!', 'SORRY!'][hits % 6], 700);
      }
    } else if (p.mode === 'fly') {
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vz -= 22 * dt;
      const g = terrainZ(p.x, p.y);
      if (p.z < g) {
        p.z = g; p.vz = -p.vz * 0.45; p.vx *= 0.62; p.vy *= 0.62; p.wx *= 0.6; p.wz *= 0.6; p.bounces++;
        if (p.bounces > 3 || (Math.abs(p.vz) < 1.5 && Math.hypot(p.vx, p.vy) < 1.2)) { p.mode = 'down'; p.t = 0; }
      }
      p.g.position.set(p.x, p.z + 0.6, -p.y);
      p.g.rotation.x += p.wx * dt; p.g.rotation.z += p.wz * dt; p.g.rotation.y += p.wy * dt;
      const j = 1 + 0.5 * Math.sin(p.t * 24) * Math.exp(-p.t * 0.55);
      p.g.scale.set(1 / Math.sqrt(j), j, 1 / Math.sqrt(j));
    } else {
      const j = 1 + 0.25 * Math.sin(p.t * 18) * Math.exp(-p.t * 1.5); p.g.scale.set(1 / Math.sqrt(j), j, 1 / Math.sqrt(j));
      p.g.rotation.x = Math.PI / 2; p.g.position.y = p.z + 0.35;
      if (p.t > 5) spawnPed(p, car.x, car.y, true);
    }
  }
}

// ------------------------------------------------------------------ publikum (står i grupper og heier)
const SPECS = [];
const FLAGC = [0xe04848, 0x3b6fd8, 0xf2c744, 0xffffff, 0x2fa34a, 0xff7ab3, 0x8b5cf6, 0xff8c1a];
function cheerPerson(dx, dz, col) {
  const pick = a => a[Math.floor(Math.random() * a.length)], BL = 0x0e0e12;
  const sw = col ?? pick(SWEATER), tr = pick(TROUSERS), sh = pick(SHOES), up = Math.random() < 0.65;
  const g = [
    tintedBox(0.16, 0.1, 0.3, dx + 0.11, 0.05, dz + 0.03, sh), tintedBox(0.16, 0.1, 0.3, dx - 0.11, 0.05, dz + 0.03, sh),
    tintedBox(0.36, 0.72, 0.26, dx, 0.46, dz, tr),
    tintedBox(0.5, 0.62, 0.3, dx, 1.13, dz, sw),
    tintedBox(0.12, 0.1, 0.12, dx, 1.48, dz, BL), tintedBox(0.3, 0.3, 0.3, dx, 1.67, dz, BL),
  ];
  if (up) {   // armer i været
    g.push(tintedBox(0.13, 0.62, 0.13, dx + 0.3, 1.5, dz, sw, 0.35), tintedBox(0.13, 0.62, 0.13, dx - 0.3, 1.5, dz, sw, -0.35));
  } else {
    g.push(tintedBox(0.8, 0.14, 0.14, dx, 1.32, dz, sw));
  }
  return g;
}
function buildSpectators() {
  for (const s of SPECS) { scene.remove(s.g); s.g.traverse(o => o.geometry && o.geometry.dispose()); }
  SPECS.length = 0;
  if (!track) return;
  const n = track.n;
  let i = 12;
  while (i < n - 8) {
    i += Math.round(20 + Math.random() * 45);                       // ca. 40–130 m mellom gruppene
    if (i >= n - 8) break;
    const p = track.pts[i], d = track.dirAt(i), nx = -d[1], ny = d[0];
    let x = 0, y = 0, ok = false, side = Math.random() < 0.5 ? -1 : 1;
    for (const sg of [side, -side]) for (const dd of [2.4, 3.6, 5.0, 6.5]) {
      const off = (track.w[i] / 2 + dd) * sg, tx = p[0] + nx * off, ty = p[1] + ny * off;
      if (clsAt(tx, ty) === 2 || blockAt(tx, ty) >= 0 || roadClear(tx, ty) < 0.4) continue;
      x = tx; y = ty; side = sg; ok = true; break;
    }
    if (!ok) continue;
    const cnt = 3 + Math.floor(Math.random() * 6);
    const parts = [], g = new THREE.Group(), flags = [];
    const ang = Math.atan2(-nx * side, ny * side);                  // se mot banen
    for (let k = 0; k < cnt; k++) parts.push(...cheerPerson((k - (cnt - 1) / 2) * (0.7 + Math.random() * 0.35), (Math.random() - 0.5) * 1.1));
    if (Math.random() < 0.45) {                                     // banner mellom to stolper
      const bw = Math.min(3.4, cnt * 0.75), col = FLAGC[Math.floor(Math.random() * FLAGC.length)];
      parts.push(tintedBox(bw, 0.62, 0.07, 0, 1.75, -0.45, col));
      parts.push(tintedBox(0.09, 1.9, 0.09, -bw / 2, 0.95, -0.45, 0x7a5a3a), tintedBox(0.09, 1.9, 0.09, bw / 2, 0.95, -0.45, 0x7a5a3a));
    }
    const body = new THREE.Mesh(mergeGeometries(parts), PED_MAT); body.castShadow = !MOBILE; g.add(body);
    const nFlags = Math.random() < 0.6 ? 1 + Math.floor(Math.random() * 2) : 0;
    for (let k = 0; k < nFlags; k++) {
      const fx = (Math.random() - 0.5) * cnt * 0.7, col = FLAGC[Math.floor(Math.random() * FLAGC.length)];
      const f = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.5, 0.06), M(0x6b5436)); pole.position.set(0, 0.75, 0); f.add(pole);
      const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.42, 0.04), M(col)); cloth.position.set(0.34, 1.35, 0); f.add(cloth);
      f.position.set(fx, 1.25, 0.25); f.userData.ph = Math.random() * 7;
      g.add(f); flags.push(f);
    }
    g.position.set(x, terrainZ(x, y), -y); g.rotation.y = ang;
    scene.add(g); SPECS.push({ g, x, y, z: terrainZ(x, y), ph: Math.random() * 7, flags });
  }
}
function updateSpectators(t) {
  for (const s of SPECS) {
    const near = Math.abs(s.x - car.x) < 230 && Math.abs(s.y - car.y) < 230;
    s.g.visible = near; if (!near) continue;
    s.g.position.y = s.z + Math.abs(Math.sin(t * 5.5 + s.ph)) * 0.13;
    for (const f of s.flags) { f.rotation.z = Math.sin(t * 7 + f.userData.ph) * 0.45; f.rotation.y = Math.sin(t * 3 + f.userData.ph) * 0.3; }
  }
}

// ------------------------------------------------------------------ minikart
const mm = $('minimap'), mmx = mm.getContext('2d'); let mmBase = null, mmT = null, worldMap = null;
function buildWorldMap() {
  const sc = 0.2, c = document.createElement('canvas');
  c.width = Math.round((T.x1 - T.x0) * sc); c.height = Math.round((T.y1 - T.y0) * sc);
  const g = c.getContext('2d'), t = (x, y) => [(x - T.x0) * sc, (T.y1 - y) * sc];
  g.fillStyle = '#141827'; g.fillRect(0, 0, c.width, c.height);
  const path = p => { g.beginPath(); p.forEach((q, i) => { const s = t(q[0], q[1]); i ? g.lineTo(s[0], s[1]) : g.moveTo(s[0], s[1]); }); };
  g.fillStyle = '#1c3a5e'; for (const a of world.areas) if (a.k === 'water') { path(a.p); g.closePath(); g.fill(); }
  g.strokeStyle = '#7a8299'; g.lineWidth = 1.4; g.lineCap = 'round';
  for (const r of world.roads) if (r.drive) { path(r.p); g.stroke(); }
  worldMap = { c, sc };
}
function buildMinimapBase() {
  const S = Math.round(mm.clientWidth * devicePixelRatio) || 210; mm.width = S; mm.height = S;
  if (!track) { if (!worldMap) buildWorldMap(); mmBase = null; return; }
  const xs = track.pts.map(p => p[0]), ys = track.pts.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const sc = (S - 24 * devicePixelRatio) / Math.max(x1 - x0, y1 - y0, 50);
  mmT = (x, y) => [S / 2 + (x - (x0 + x1) / 2) * sc, S / 2 - (y - (y0 + y1) / 2) * sc];
  mmBase = document.createElement('canvas'); mmBase.width = S; mmBase.height = S;
  const c = mmBase.getContext('2d');
  c.strokeStyle = '#3a4058'; c.lineWidth = 1.5 * devicePixelRatio; c.lineCap = 'round';
  for (const r of world.roads) {
    if (!r.drive || !r.p.some(p => p[0] > x0 - 200 && p[0] < x1 + 200 && p[1] > y0 - 200 && p[1] < y1 + 200)) continue;
    c.beginPath(); r.p.forEach((p, i) => { const q = mmT(p[0], p[1]); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); }); c.stroke();
  }
  c.strokeStyle = '#e0333a'; c.lineWidth = 4 * devicePixelRatio;
  c.beginPath(); track.pts.forEach((p, i) => { const q = mmT(p[0], p[1]); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); }); if (track.closed) c.closePath(); c.stroke();
  c.fillStyle = '#3a8cff'; for (const s of track.sectors) { const q = mmT(...track.pts[s]); c.beginPath(); c.arc(q[0], q[1], 4 * devicePixelRatio, 0, 7); c.fill(); }
  c.fillStyle = '#fff'; const q0 = mmT(...track.pts[0]); c.beginPath(); c.arc(q0[0], q0[1], 4.5 * devicePixelRatio, 0, 7); c.fill();
  if (!track.closed) { c.fillStyle = '#ffd14a'; const q1 = mmT(...track.pts[track.n - 1]); c.beginPath(); c.arc(q1[0], q1[1], 4.5 * devicePixelRatio, 0, 7); c.fill(); }
}
function drawMinimap() {
  const S = mm.width; mmx.clearRect(0, 0, S, S);
  if (mmBase) mmx.drawImage(mmBase, 0, 0);
  else if (worldMap) {
    const span = 520, sc = worldMap.sc, sw = span * sc;
    const sx = (car.x - T.x0) * sc - sw / 2, sy = (T.y1 - car.y) * sc - sw / 2;
    mmx.drawImage(worldMap.c, sx, sy, sw, sw, 0, 0, S, S);
    mmT = (x, y) => [S / 2 + (x - car.x) * (S / span), S / 2 - (y - car.y) * (S / span)];
  }
  if (ghost && ghostGroup && ghostGroup.visible) { const q = mmT(ghostPos[0], ghostPos[1]); mmx.fillStyle = '#7fd4ff'; mmx.beginPath(); mmx.arc(q[0], q[1], 4 * devicePixelRatio, 0, 7); mmx.fill(); }
  const q = mmT(car.x, car.y);
  mmx.save(); mmx.translate(q[0], q[1]); mmx.rotate(-car.hdg); mmx.fillStyle = '#fff'; mmx.strokeStyle = '#000'; mmx.lineWidth = devicePixelRatio;
  const r = 6 * devicePixelRatio; mmx.beginPath(); mmx.moveTo(r, 0); mmx.lineTo(-r * 0.7, r * 0.6); mmx.lineTo(-r * 0.7, -r * 0.6); mmx.closePath(); mmx.fill(); mmx.stroke(); mmx.restore();
}

// ------------------------------------------------------------------ styring
const car = { x: 0, y: 0, z: 0, hdg: 0, v: 0, steer: 0, dist: 0 };
const AUTO = qs.get('auto') ? Number(qs.get('auto')) : 0;
const SIM = Number(qs.get('sim') || 0);
let simT = 0;
const NOW = () => SIM ? simT : performance.now();
const keys = {};
window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase(); keys[k] = true;
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
  if (k === 'r' && racing) resetCar();
  if (k === 'g') $('btnGarage').click();
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
// Berøringsknapper. På telefoner brukes touch-hendelser med preventDefault: da avbryter ikke iOS knappen ved langt
// trykk (tekstmeny/forstørrelse), som ellers slipper gassen etter et halvt sekund. Mus og penn bruker pointer-hendelser.
const HAS_TOUCH = 'ontouchstart' in window;
for (const [id, key] of [['tLeft', 'arrowleft'], ['tRight', 'arrowright'], ['tGas', 'arrowup'], ['tBrake', 'arrowdown']]) {
  const el = $(id), fingers = new Set();
  const press = () => { keys[key] = true; el.classList.add('down'); };
  const release = () => { if (fingers.size) return; keys[key] = false; el.classList.remove('down'); };
  el.addEventListener('touchstart', e => { e.preventDefault(); for (const t of e.changedTouches) fingers.add(t.identifier); press(); }, { passive: false });
  const lift = e => { e.preventDefault(); for (const t of e.changedTouches) fingers.delete(t.identifier); release(); };
  el.addEventListener('touchend', lift, { passive: false }); el.addEventListener('touchcancel', lift, { passive: false });
  const isFingerPointer = e => HAS_TOUCH && e.pointerType === 'touch';
  el.addEventListener('pointerdown', e => { if (isFingerPointer(e)) return; e.preventDefault(); el.setPointerCapture(e.pointerId); press(); });
  const pUp = e => { if (isFingerPointer(e)) return; keys[key] = false; el.classList.remove('down'); };
  el.addEventListener('pointerup', pUp); el.addEventListener('pointercancel', pUp);
  el.addEventListener('contextmenu', e => e.preventDefault());
}
$('tReset').addEventListener('touchstart', e => { e.preventDefault(); if (racing) resetCar(); }, { passive: false });
$('tReset').addEventListener('pointerdown', e => { if (HAS_TOUCH && e.pointerType === 'touch') return; e.preventDefault(); if (racing) resetCar(); });
// slipp alle kjøretaster hvis appen mister fokus (telefonen låses, varsel dukker opp), så gassen ikke henger
const releaseAll = () => { for (const k of ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', ' ']) keys[k] = false; document.querySelectorAll('.tb.down').forEach(b => b.classList.remove('down')); };
window.addEventListener('blur', releaseAll); document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });
if (MOBILE) { $('touch').style.display = 'flex'; document.body.classList.add('mobile'); }

// ------------------------------------------------------------------ startlys
let lights = { phase: 'off', n: 0, t0: 0, hold: 0 };
(function buildLightDom() {
  const el = $('lights');
  for (let c = 0; c < 5; c++) { const col = document.createElement('div'); col.className = 'col'; for (let r = 0; r < 2; r++) { const l = document.createElement('div'); l.className = 'lamp'; col.appendChild(l); } el.appendChild(col); }
})();
function paintLights() {
  const lamps = $('lights').querySelectorAll('.lamp');
  lamps.forEach((l, i) => l.classList.toggle('on', Math.floor(i / 2) < lights.n));
  gantryLamps.forEach((m, i) => { m.material = Math.floor(i / 2) < lights.n ? LAMP_ON : LAMP_OFF; });
  $('lights').style.display = lights.phase === 'off' || lights.phase === 'go' ? 'none' : 'flex';
}
const LIGHT_STEP = Number(qs.get('lightstep') || 900);
let jumped = false, penalty = 0;
function startLights() {
  jumped = false; penalty = 0;
  if (mode === 'free') { lights = { phase: 'go', n: 0, t0: NOW(), hold: 0 }; paintLights(); onGo(); return; }
  jumped = false; penalty = 0;
  lights = { phase: 'fill', n: 0, t0: NOW(), hold: Number(qs.get('hold') || (300 + Math.random() * 2700)) };
  paintLights(); showMsg('', 1);
}
function updateLights() {
  if (lights.phase === 'off' || lights.phase === 'go') return;
  const e = NOW() - lights.t0;
  if (lights.phase === 'fill') {
    const n = Math.min(5, Math.floor(e / LIGHT_STEP));
    if (n !== lights.n) { lights.n = n; paintLights(); }
    if (e >= LIGHT_STEP * 5) { lights.phase = 'hold'; lights.t0 = NOW(); }
  } else if (NOW() - lights.t0 >= lights.hold) {
    lights.phase = 'go'; lights.n = 0; paintLights(); onGo();
  }
}
function onGo() {
  const now = NOW() - penalty;
  lapStart = secStart = now; secTimes = []; secDelta = []; secNew = []; secIdx = 0; finished = false;
  prevP = nearestTrack(car.x, car.y, ti).i; rec = []; recAcc = 0;
  showMsg(mode === 'free' ? 'KJØR!' : 'GO!', 900);
}
function jumpStart() { if (jumped) return; jumped = true; penalty = 2000; showMsg('TJUVSTART! +2 sekunder', 2200); }

// ------------------------------------------------------------------ ghost
const GH_DT = 0.05;
let ghost = null, ghostGroup = null, ghostIdxT = null, ghostPos = [0, 0], rec = null, recAcc = 0;
function ghostKey() { return 'gateracer_ghost_' + NS + trackKey(); }
function loadGhost() {
  if (ghostGroup) { scene.remove(ghostGroup); ghostGroup = null; }
  ghost = mode === 'race' ? store.get(ghostKey(), null) : null;
  ghostIdxT = null;
  if (!ghost || !ghost.s || ghost.s.length < 30) { ghost = null; return; }
  ghostGroup = buildVehicle(ghost.kind || 'f1', true); ghostGroup.visible = false; scene.add(ghostGroup);
  ghostIdxT = new Float64Array(track.n).fill(-1);
  let gi = 0;
  for (let k = 0; k * 3 + 2 < ghost.s.length; k++) {
    const nt = nearestTrack(ghost.s[k * 3] / 20, ghost.s[k * 3 + 1] / 20, k ? gi : 0);
    if (nt.i >= 0) { gi = nt.i; if (ghostIdxT[nt.i] < 0) ghostIdxT[nt.i] = k * GH_DT * 1000; }
  }
  let last = 0; for (let i = 0; i < track.n; i++) { if (ghostIdxT[i] < 0) ghostIdxT[i] = last; else last = ghostIdxT[i]; }
}
function updateGhost(lapT) {
  if (!ghost || !ghostGroup) return;
  const fi = lapT / 1000 / GH_DT, i = Math.floor(fi), t = fi - i, m = Math.floor(ghost.s.length / 3);
  if (i < 0 || i + 1 >= m) { ghostGroup.visible = false; return; }
  const a = i * 3, b = (i + 1) * 3;
  const x = (ghost.s[a] + (ghost.s[b] - ghost.s[a]) * t) / 20, y = (ghost.s[a + 1] + (ghost.s[b + 1] - ghost.s[a + 1]) * t) / 20;
  const h0 = ghost.s[a + 2] / 500, h1 = ghost.s[b + 2] / 500, dh = ((h1 - h0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  ghostPos = [x, y];
  ghostGroup.visible = true; ghostGroup.position.set(x, terrainZ(x, y) + 0.2, -y); ghostGroup.rotation.set(0, h0 + dh * t, 0);
}

// ------------------------------------------------------------------ runder og tider
let racing = false, lap = 1, lapStart = 0, lastLap = null, best = null, bestKey = '', prevP = 0, finished = false, ti = -1;
let secTimes = [], secStart = 0, secIdx = 0, secDelta = [], secNew = [], freeStart = null;
function resetCar() {
  if (mode === 'free' && freeStart) { car.x = freeStart.x; car.y = freeStart.y; car.hdg = freeStart.hdg; }
  else { const p0 = track.pts[0], p1 = track.pts[Math.min(4, track.n - 1)]; car.x = p0[0]; car.y = p0[1]; car.hdg = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]); }
  car.v = 0; car.steer = 0; car.dist = 0; car.blockT = 0; ti = mode === 'race' ? 0 : -1;
  car.z = terrainZ(car.x, car.y) + 0.18;
  camera.position.copy(V(car.x - Math.cos(car.hdg) * 11, car.y - Math.sin(car.hdg) * 11, car.z + 4));
  lapStart = secStart = NOW(); secTimes = []; secDelta = []; secNew = []; secIdx = 0; finished = false;
  startLights();
}
function rescue() {
  if (track && ti >= 0) {
    const p = track.pts[ti], d = track.dirAt(ti);
    car.x = p[0]; car.y = p[1]; car.hdg = Math.atan2(d[1], d[0]);
  } else {
    let bs = null, bd = Infinity, bt = 0;
    const ci = Math.floor(car.x / RC), cj = Math.floor(car.y / RC);
    for (let r = 1; r <= 8 && !bs; r++) {
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
        const arr = rGrid.get(`${ci + i},${cj + j}`); if (!arr) continue;
        for (const k of arr) {
          const g = rSegs[k], dx = g[2] - g[0], dy = g[3] - g[1], L = dx * dx + dy * dy;
          const t = L ? clamp(((car.x - g[0]) * dx + (car.y - g[1]) * dy) / L, 0, 1) : 0;
          const d = Math.hypot(car.x - (g[0] + t * dx), car.y - (g[1] + t * dy));
          if (d < bd) { bd = d; bs = g; bt = t; }
        }
      }
    }
    if (bs) { car.x = bs[0] + (bs[2] - bs[0]) * bt; car.y = bs[1] + (bs[3] - bs[1]) * bt; car.hdg = Math.atan2(bs[3] - bs[1], bs[2] - bs[0]); }
  }
  car.v = 0; car.steer = 0; car.blockT = 0;
  car.z = terrainZ(car.x, car.y) + 0.18;
  showMsg('Tilbake på veien', 1200);
}
function showMsg(t, ms = 1500) { const m = $('msg'); m.textContent = t; m.style.opacity = t ? 1 : 0; clearTimeout(m._t); m._t = setTimeout(() => m.style.opacity = 0, ms); }
function fmt(ms) { const s = Math.max(0, ms) / 1000; return `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`; }
function fmtD(ms) { return (ms >= 0 ? '+' : '−') + (Math.abs(ms) / 1000).toFixed(2); }
function sectorHud() {
  if (mode === 'free') { $('sectors').innerHTML = `Kjørt ${(car.dist / 1000).toFixed(2)} km`; return; }
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const bs = best && best.sectors ? best.sectors[i] : null;
    if (secTimes[i] != null) parts.push(`S${i + 1} <b class="${secNew[i] ? 'purple' : (secDelta[i] != null && secDelta[i] <= 0.001 ? 'green' : 'yellow')}">${fmt(secTimes[i])}</b>`);
    else parts.push(`S${i + 1} ${bs != null ? '<span style="opacity:.5">' + fmt(bs) + '</span>' : '–'}`);
  }
  $('sectors').innerHTML = parts.join(' &nbsp; ');
}
function passSector(i, now) {
  const t = now - secStart; secTimes[i] = t; secStart = now;
  const bs = best && best.sectors ? best.sectors[i] : null;
  secDelta[i] = bs != null ? t - bs : null; secNew[i] = bs == null || t < bs;
  if (i < 2) showMsg(`Sektor ${i + 1}: ${fmt(t)}${bs != null ? '  ' + fmtD(t - bs) : ''}`, 1500);
}
function finishLap(now) {
  const total = now - lapStart; lastLap = total; passSector(2, now);
  const bestSectors = best && best.sectors ? best.sectors.map((s, i) => Math.min(s ?? Infinity, secTimes[i] ?? Infinity)) : secTimes.slice();
  const isBest = !best || total < best.lap;
  if (isBest) {
    best = { lap: total, sectors: bestSectors };
    showMsg((track.closed ? 'NY BESTETID ' : 'MÅL! NY BESTETID ') + fmt(total), 2600);
    if (rec && rec.length > 60) { store.set(ghostKey(), { kind: P.kind, dur: total, s: rec }); loadGhost(); }
  } else { best.sectors = bestSectors; showMsg((track.closed ? 'Runde ' : 'MÅL! ') + fmt(total) + '  ' + fmtD(total - best.lap), 2600); }
  store.set(bestKey, best);
  if (track.closed) { lap++; lapStart = secStart = now; secTimes = []; secDelta = []; secNew = []; secIdx = 0; rec = []; recAcc = 0; }
  else finished = true;
}

// ------------------------------------------------------------------ dash
const REV_N = 15;
(function buildRevs() { const el = $('revs'); for (let i = 0; i < REV_N; i++) el.appendChild(document.createElement('i')); })();
function paintDash(v, frac) {
  const gears = P.kind === 'bike' ? 1 : (P.kind === 'f1' ? 8 : 6);
  let g = clamp(Math.floor(Math.pow(frac, 0.75) * gears) + 1, 1, gears), rpm = 0;
  if (gears > 1) {
    const lo = Math.pow((g - 1) / gears, 1 / 0.75), hi = Math.pow(g / gears, 1 / 0.75);
    rpm = clamp((frac - lo) / Math.max(0.001, hi - lo), 0, 1);
  } else rpm = frac;
  $('gear').textContent = v < -0.5 ? 'R' : (Math.abs(v) < 0.6 ? 'N' : String(g));
  const flash = rpm > 0.94 && (NOW() % 160 < 80);
  const els = $('revs').children;
  for (let i = 0; i < REV_N; i++) {
    const on = i / REV_N < rpm;
    els[i].style.background = flash ? '#7aa2ff' : (on ? (i < 7 ? '#3ad66a' : i < 12 ? '#ff3b30' : '#7aa2ff') : '#20243a');
  }
}

// ------------------------------------------------------------------ fysikk + bilde
function step(dt) {
  updateLights();
  const locked = lights.phase === 'fill' || lights.phase === 'hold';
  let th = (keys['arrowup'] || keys['w'] ? 1 : 0) - (keys['arrowdown'] || keys['s'] ? 1 : 0);
  let st = (keys['arrowleft'] || keys['a'] ? 1 : 0) - (keys['arrowright'] || keys['d'] ? 1 : 0);
  if (AUTO && track) {                                   // testautopilot (bare med ?auto=)
    const here = nearestTrack(car.x, car.y, ti, car.hdg);
    if (here.i >= 0) {
      const spd = Math.abs(car.v);
      const la = track.pts[(here.i + Math.round(5 + spd * 0.6)) % track.n];
      const e = ((Math.atan2(la[1] - car.y, la[0] - car.x) - car.hdg + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      st = clamp(e * 2.5, -1, 1);
      const d0 = track.dirAt(here.i), d1 = track.dirAt((here.i + 22) % track.n);
      const turn = Math.abs(((Math.atan2(d1[1], d1[0]) - Math.atan2(d0[1], d0[0]) + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      const vT = Math.min(AUTO, 8 + 24 / (1 + turn * 3.5));
      th = spd < vT ? 1 : -0.9;
      if (spd < 2) { car.stuck = (car.stuck || 0) + dt; } else car.stuck = 0;
      if (car.stuck > 1.0) { th = -1; st = -st; if (car.stuck > 2.4) car.stuck = 0; }
    }
  }
  const brake = keys[' '] && !locked;
  if (locked) { if (th > 0) jumpStart(); th = 0; st = 0; car.v = 0; }
  const nt = nearestTrack(car.x, car.y, ti, car.hdg);
  if (nt.i >= 0) ti = nt.i;
  const onTrack = track ? (nt.i >= 0 && nt.d < track.w[nt.i] / 2 + 1.0) : false;
  const paved = roadClear(car.x, car.y) < 0;                  // faktisk asfalt (bare for støv)
  const onRoad = mode === 'free' ? true : (onTrack || paved);
  car.paved = paved;
  let v = car.v;
  if (th > 0) v += (v < -0.2 ? P.brake : P.acc * (1 - Math.abs(v) / P.vmax)) * dt;
  else if (th < 0) v -= (v > 0.5 ? P.brake : P.acc * 0.35) * dt;
  const drag = v * v * 0.0035 + 0.9 + (onRoad ? 0 : Math.abs(v) * 0.5 * P.off + 2 * P.off) + (brake ? P.brake * 0.8 : 0);
  v -= Math.sign(v) * Math.min(Math.abs(v), drag * dt);
  v = clamp(v, -P.vmax * 0.18, P.vmax);
  const sp = Math.abs(v);
  const maxSteer = (onRoad ? P.grip : P.grip * 0.72) / (1 + sp / P.fall);
  car.steer += (st * maxSteer - car.steer) * Math.min(1, dt * 9);
  car.hdg += (v / P.wb) * Math.tan(car.steer) * dt * (brake && sp > 5 ? 1.5 : 1);
  const cs = Math.cos(car.hdg), sn = Math.sin(car.hdg);
  const nx = car.x + cs * v * dt, ny = car.y + sn * v * dt;
  const blockedAt = (px, py) => {
    for (const [fx, fy] of [[0, 0], [2.1, 0.75], [2.1, -0.75], [-2.1, 0.75], [-2.1, -0.75]]) if (hitsBuilding(px + cs * fx - sn * fy, py + sn * fx + cs * fy)) return true;
    return false;
  };
  const outside = nx < T.x0 + 6 || nx > T.x1 - 6 || ny < T.y0 + 6 || ny > T.y1 - 6 || (world.bound && !pip(nx, ny, world.bound));
  let movedOk = false;
  if (!outside && !blockedAt(nx, ny)) { car.dist += Math.abs(v) * dt; car.x = nx; car.y = ny; movedOk = true; }
  else {
    if (!outside) for (const lat of [0.45, -0.45, 0.95, -0.95, 1.5, -1.5]) {   // skrap langs veggen i stedet for å stoppe
      const ax = nx - sn * lat, ay = ny + cs * lat;
      if (!blockedAt(ax, ay)) { car.x = ax; car.y = ay; car.dist += Math.abs(v) * dt; v *= 0.93; movedOk = true; if (sp > 10 && Math.random() < 0.4) puff(car.x - sn * lat, car.y + cs * lat, 0xd8d0c4); break; }
    }
    if (!movedOk) {
      v = -v * 0.22; if (Math.abs(v) < 1) v = 0;
      if (sp > 12) { showMsg('SMELL!', 700); for (let i = 0; i < 3; i++) puff(car.x + cs * 2, car.y + sn * 2, 0xbbbbbb); }
    }
  }
  // kilt fast: prøver spilleren å kjøre uten å komme noe sted, settes bilen tilbake på veien
  if (movedOk || (th === 0 && Math.abs(v) < 0.5)) car.blockT = 0; else car.blockT = (car.blockT || 0) + dt;
  if (car.blockT > 1.2) { rescue(); v = 0; }
  car.v = v;
  // bilen følger bakken hele tiden, uansett hvor ulendt det er
  car.z = terrainZ(car.x, car.y) + 0.18;
  // sektorer og mål
  if (mode === 'race' && lights.phase === 'go' && nt.i >= 0 && !finished) {
    const now = NOW(), n = track.n, p = nt.i, [s1, s2] = track.sectors;
    if (Math.abs(p - prevP) < n / 4) {
      if (secIdx === 0 && prevP < s1 && p >= s1) { passSector(0, now); secIdx = 1; }
      else if (secIdx === 1 && prevP < s2 && p >= s2) { passSector(1, now); secIdx = 2; }
      else if (secIdx === 2 && !track.closed && p >= n - 4) finishLap(now);
    }
    if (track.closed && prevP > n * 0.85 && p < n * 0.15) { if (secIdx === 2) finishLap(now); else { lapStart = secStart = now; secTimes = []; secDelta = []; secNew = []; secIdx = 0; rec = []; recAcc = 0; } }
    prevP = p;
  }
  // ghost-opptak
  const lapT = lights.phase === 'go' ? NOW() - lapStart : 0;
  if (mode === 'race' && lights.phase === 'go' && !finished && rec) {
    recAcc += dt;
    if (recAcc >= GH_DT) { recAcc -= GH_DT; rec.push(Math.round(car.x * 20), Math.round(car.y * 20), Math.round(car.hdg * 500)); }
  }
  updateGhost(lapT);
  // bilen i scenen
  const zf = terrainZ(car.x + cs * 2, car.y + sn * 2), zb = terrainZ(car.x - cs * 2, car.y - sn * 2), zl = terrainZ(car.x - sn, car.y + cs), zr = terrainZ(car.x + sn, car.y - cs);
  carGroup.position.set(car.x, car.z, -car.y);
  const lean = P.lean ? -car.steer * P.lean * clamp(sp / 14, 0, 1.6) : 0;
  carGroup.rotation.set(Math.atan2(zr - zl, 2) + lean, car.hdg, Math.atan2(zf - zb, 4), 'YZX');
  // røyk: låste hjul, gress og luft
  if ((brake && sp > 6) || (th < 0 && sp > 20) || (!paved && !onTrack && sp > 14)) {
    const col = paved || onTrack ? 0xe8e8e8 : 0xbfae8e;
    if (Math.random() < dt * 40) puff(car.x - cs * 1.6 + sn * 0.8, car.y - sn * 1.6 - cs * 0.8, col);
    if (Math.random() < dt * 40) puff(car.x - cs * 1.6 - sn * 0.8, car.y - sn * 1.6 + cs * 0.8, col);
  }
  updateSmoke(dt);
  // kamera: senker seg og trekkes ut med farten, rister litt
  const frac = clamp(sp / P.vmax, 0, 1);
  const fovT = 64 + 22 * frac; camera.fov += (fovT - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix();
  const back = 7.6 + sp * 0.105 + P.camH * 1.2, high = 3.5 + P.camH - frac * 0.9;
  camera.position.lerp(V(car.x - cs * back, car.y - sn * back, car.z + high), 1 - Math.exp(-dt * 5.5));
  const sh = frac * (onRoad ? 0.035 : 0.16);
  camera.position.x += (Math.random() - 0.5) * sh; camera.position.y += (Math.random() - 0.5) * sh; camera.position.z += (Math.random() - 0.5) * sh;
  camera.lookAt(V(car.x + cs * 7, car.y + sn * 7, car.z + 1.1));
  if (qs.get('top')) { camera.position.set(car.x, car.z + Number(qs.get('top')), -car.y + 1); camera.lookAt(V(car.x, car.y, car.z)); }
  sun.position.set(car.x - 120, car.z + 220, -car.y - 80); sun.target.position.set(car.x, car.z, -car.y);
  if (!SIM) for (const c of terrainChunks) {
    const d = Math.hypot(car.x - c.cx, car.y - c.cy);
    if (d < HI_RADIUS && !c.hi) { c.hi = makeHi(c); scene.add(c.hi); }
    else if (d > HI_RADIUS * 1.6 && c.hi) { scene.remove(c.hi); c.hi.geometry.dispose(); c.hi = null; }
    if (c.hi) { c.hi.visible = d < HI_RADIUS; c.lo.visible = !c.hi.visible; } else c.lo.visible = true;
  }
  // HUD
  $('spd').textContent = Math.round(sp * 3.6);
  paintDash(v, frac);
  $('streaks').style.opacity = String(clamp((frac - 0.45) / 0.55, 0, 1) * 0.9);
  if (mode === 'free') {
    $('lapTime').textContent = fmt(NOW() - lapStart);
    $('lapNo').textContent = 'Free roam';
    $('lastLap').textContent = ''; $('bestLap').textContent = ''; $('delta').textContent = '';
  } else {
    $('lapTime').textContent = fmt(finished ? lastLap : lapT);
    $('lapNo').textContent = (track.closed ? `Runde ${lap}` : (finished ? 'I mål · R for ny start' : 'Sprint')) + (onTrack || paved ? '' : ' · utenfor banen');
    $('lastLap').textContent = 'Sist: ' + (lastLap ? fmt(lastLap) : '–');
    $('bestLap').textContent = 'Best: ' + (best ? fmt(best.lap) : '–');
    if (ghost && ghostIdxT && nt.i >= 0 && lights.phase === 'go' && !finished) {
      const d = lapT - ghostIdxT[nt.i]; const el = $('delta');
      el.textContent = fmtD(d); el.className = d <= 0 ? 'neg' : 'pos';
    } else $('delta').textContent = '';
  }
  updatePeds(dt); if (!SIM) { updateSpectators(NOW() / 1000); drawMinimap(); } sectorHud();
  $('hits').textContent = hits ? `Folk truffet: ${hits}` : '';
}
let lastT = 0;
function loop(t) { if (!racing) return; const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016); lastT = t; step(dt); renderer.render(scene, camera); requestAnimationFrame(loop); }

// ------------------------------------------------------------------ modusbytte
const DRAW_BTNS = ['btnPlace', 'btnRace', 'btnFree', 'btnUndo', 'btnClear', 'btnShare', 'btnHouse', 'btnSave', 'trackList', 'trackName'].concat(AREA.prebuilt ? ['btnDemo', 'btnDemo2', 'btnDemo3'] : []);
if (!AREA.prebuilt) for (const id of ['btnDemo', 'btnDemo2', 'btnDemo3']) $(id).style.display = 'none';
$('btnPlace').onclick = () => { location.href = location.pathname; };
function startRace(m) {
  mode = m;
  PED_N = MOBILE ? 30 : (m === 'free' ? 96 : 72);
  $('garage').style.display = 'none'; $('btnGarage').classList.remove('active');
  if (!renderer) buildStaticScene();
  if (m === 'race') {
    buildTrack(routePts, loopMode);
    bestKey = 'gateracer_best_' + NS + trackKey();
    const b = store.get(bestKey, null); best = b && typeof b === 'object' ? b : (b ? { lap: Number(b), sectors: null } : null);
    loadGhost();
    hint.textContent = `${loopMode ? 'Sløyfe' : 'Sprint'} · ${P.name}${hidden.size ? ` · ${hidden.size} hus i veien fjernet` : ''}${ghost ? ' · ghost på' : ''}`;
  } else {
    clearTrack(); loadGhost(); buildSpectators();
    const from = waypoints[0] || { x: view.cx, y: view.cy };
    let bs = null, bd = Infinity;
    for (const g of rSegs) {                                   // nærmeste ordentlige gate (ikke smug)
      if (g[4] < 2.8) continue;
      const d = Math.hypot((g[0] + g[2]) / 2 - from.x, (g[1] + g[3]) / 2 - from.y);
      if (d < bd) { bd = d; bs = g; }
    }
    bs = bs || rSegs[0];
    freeStart = { x: (bs[0] + bs[2]) / 2, y: (bs[1] + bs[3]) / 2, hdg: Math.atan2(bs[3] - bs[1], bs[2] - bs[0]) };
    buildMinimapBase(); buildPeds();
    hint.textContent = `Free roam · ${P.name} · kjør hvor du vil`;
  }
  lastLap = null; lap = 1; best = m === 'free' ? null : best;
  $('draw').style.display = 'none'; raceDiv.style.display = 'block';
  for (const id of DRAW_BTNS) $(id).style.display = 'none';
  $('loopChk').parentElement.style.display = 'none'; $('lineChk').parentElement.style.display = 'none';
  $('btnBack').style.display = '';
  if (MOBILE) {
    $('topbar').style.display = 'none'; $('btnBackM').style.display = '';
    try { document.documentElement.requestFullscreen?.().then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {}); } catch {}
  }
  resizeRace(); resetCar(); racing = true; lastT = performance.now(); step(0.016); requestAnimationFrame(loop);
}
$('btnRace').onclick = () => startRace('race');
$('btnFree').onclick = () => startRace('free');
$('btnBackM').onclick = () => $('btnBack').click();
$('btnBack').onclick = () => {
  racing = false; $('topbar').style.display = ''; $('btnBackM').style.display = 'none';
  try { document.exitFullscreen?.().catch(() => {}); } catch {}
  raceDiv.style.display = 'none'; $('draw').style.display = 'block';
  for (const id of DRAW_BTNS) $(id).style.display = '';
  $('loopChk').parentElement.style.display = ''; $('lineChk').parentElement.style.display = '';
  $('btnBack').style.display = 'none'; lights = { phase: 'off', n: 0, t0: 0, hold: 0 }; paintLights();
  rebuildRoute(); resizeMap();
};
applyVeh();

function runSim(steps) {
  const dt = 1 / 60;
  for (let k = 0; k < steps; k++) {
    simT += dt * 1000; step(dt);
    if (k % 300 === 0) console.log('SIM ' + (`pos=${car.x.toFixed(0)},${car.y.toFixed(0)} t=${(simT / 1000).toFixed(1)} v=${(car.v * 3.6).toFixed(0)}km/h asfalt=${car.paved?1:0} lap=${lap} sek=${secTimes.map(x => (x / 1000).toFixed(1)).join('/')} treff=${hits}`));
  }
  console.log('SIM ' + `SLUTT lap=${lap} sist=${lastLap ? (lastLap / 1000).toFixed(2) : '-'} best=${best ? (best.lap / 1000).toFixed(2) : '-'} ghost=${ghost ? Math.floor(ghost.s.length / 3) + ' punkter' : 'nei'} opptak=${rec ? Math.floor(rec.length / 3) : 0} treff=${hits} publikum=${SPECS.length} hus_fjernet=${hidden.size} banebredde=${track ? (Math.min(...track.w).toFixed(1) + '-' + Math.max(...track.w).toFixed(1)) : '-'} luftstrekk=${jumps} lukkegap=${track ? Math.hypot(track.pts[0][0]-track.pts[track.n-1][0], track.pts[0][1]-track.pts[track.n-1][1]).toFixed(1) : '-'}m ruteledd=${routePts.length}`);
}

// ------------------------------------------------------------------ test-URL-er
if (qs.get('garage')) $('btnGarage').click();
if (qs.get('free')) { startRace('free'); if (SIM) { keys['w'] = true; runSim(SIM); } if (qs.get('drive')) { keys['w'] = true; setTimeout(() => { keys['w'] = false; }, Number(qs.get('drive')) * 1000); } }
else if (qs.get('demo')) {
  ({ '2': $('btnDemo2'), '3': $('btnDemo3') }[qs.get('demo')] || $('btnDemo')).click();
  if (!$('btnRace').disabled) {
    if (qs.get('veh')) { vehId = qs.get('veh'); refreshVehSel(); applyVeh(); }
    startRace('race');
    if (SIM) runSim(SIM);
    const wait = Number(qs.get('wait') || 0) * 1000;
    if (qs.get('drive')) setTimeout(() => { keys['w'] = true; setTimeout(() => { keys['w'] = false; }, Number(qs.get('drive')) * 1000); }, wait);
    if (qs.get('steer')) keys[qs.get('steer') === 'l' ? 'arrowleft' : 'arrowright'] = true;
  }
}
