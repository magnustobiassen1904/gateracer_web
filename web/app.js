import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ------------------------------------------------------------------ data
window.addEventListener('error', e => { document.getElementById('hint').textContent = 'Feil: ' + e.message; });
const world = await (await fetch('../data/world.json')).json();
const T = world.terrain;
const TZ = new Uint16Array(await (await fetch('../data/' + T.bin)).arrayBuffer());
const TC = new Uint8Array(await (await fetch('../data/' + T.cls)).arrayBuffer());
document.getElementById('loading').style.display = 'none';
const $ = id => document.getElementById(id);
const hint = $('hint');

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
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

// ------------------------------------------------------------------ tegnemodus
const mapC = $('map'), mctx = mapC.getContext('2d');
let view = { cx: (T.x0 + T.x1) / 2, cy: (T.y0 + T.y1) / 2, scale: 0 };
let waypoints = [], routeNodes = [], loopMode = true, clickMode = 'route';
function resizeMap() {
  mapC.width = mapC.clientWidth * devicePixelRatio; mapC.height = mapC.clientHeight * devicePixelRatio;
  if (!view.scale) view.scale = Math.min(mapC.clientWidth / (T.x1 - T.x0), mapC.clientHeight / (T.y1 - T.y0)) * 0.98;
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
  const o = w2s(0, 0); ctx.strokeStyle = '#ffd14a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(o[0], o[1], 7, 0, Math.PI * 2); ctx.stroke();
  if (routeNodes.length > 1) {
    ctx.beginPath();
    routeNodes.forEach((id, i) => { const n = G.get(id); const q = w2s(n.x, n.y); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); });
    if (loopMode) ctx.closePath();
    ctx.strokeStyle = '#e0333a'; ctx.lineWidth = Math.max(4, 7 * s); ctx.stroke();
  }
  ctx.textAlign = 'center';
  waypoints.forEach((id, i) => {
    const n = G.get(id); const q = w2s(n.x, n.y);
    ctx.fillStyle = i === 0 ? '#3ad66a' : (!loopMode && i === waypoints.length - 1 ? '#ffd14a' : '#fff'); ctx.beginPath(); ctx.arc(q[0], q[1], 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#000'; ctx.font = 'bold 11px sans-serif'; ctx.fillText(String(i + 1), q[0], q[1] + 4);
  });
}
function routeLength(nodesList, closed) {
  let len = 0; const m = closed ? nodesList.length : nodesList.length - 1;
  for (let i = 0; i < m; i++) { const a = G.get(nodesList[i]), b = G.get(nodesList[(i + 1) % nodesList.length]); len += Math.hypot(a.x - b.x, a.y - b.y); }
  return len;
}
function rebuildRoute() {
  routeNodes = [];
  if (waypoints.length >= 2) {
    const segs = []; const m = loopMode ? waypoints.length : waypoints.length - 1;
    for (let i = 0; i < m; i++) {
      const a = waypoints[i], b = waypoints[(i + 1) % waypoints.length]; if (a === b) continue;
      const p = dijkstra(a, b); if (!p) continue;
      segs.push(...(loopMode || i < m - 1 ? p.slice(0, -1) : p));
    }
    routeNodes = segs.filter((id, i) => i === 0 || id !== segs[i - 1]);
  }
  const len = routeNodes.length > 1 ? routeLength(routeNodes, loopMode) : 0;
  const ok = routeNodes.length >= 4 && len > 150;
  $('btnRace').disabled = !ok;
  if (clickMode === 'house') hint.textContent = 'Husmodus: klikk på hus for å fjerne (eller hente tilbake). Trykk «Fjern hus» igjen for å gå tilbake til løypetegning.';
  else hint.textContent = waypoints.length === 0 ? 'Klikk på veier for å legge punkter. Løypa snapper til gatenettet. Dra for å flytte, rull for å zoome.'
    : `${loopMode ? 'Sløyfe' : 'Sprint'}: ${Math.round(len)} m, ${waypoints.length} punkter. ${ok ? 'Trykk Kjør!' : 'Legg til flere punkter (minst 150 m).'}`;
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
      const id = nearestNode(x, y, 80 / Math.max(1, view.scale));
      if (id !== null && id !== waypoints[waypoints.length - 1]) { waypoints.push(id); rebuildRoute(); }
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
  const ids = pts.map(p => nearestNode(p[0], p[1], maxD)).filter(id => id !== null);
  waypoints = ids.filter((id, i) => i === 0 || id !== ids[i - 1]); loopMode = loop; $('loopChk').checked = loop; rebuildRoute();
  const xs = waypoints.map(id => G.get(id).x), ys = waypoints.map(id => G.get(id).y);
  view.cx = (Math.min(...xs) + Math.max(...xs)) / 2; view.cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  view.scale = clamp(Math.min(mapC.clientWidth / (Math.max(...xs) - Math.min(...xs) + 300), mapC.clientHeight / (Math.max(...ys) - Math.min(...ys) + 300)), 0.15, 3); drawMap();
}
$('btnDemo').onclick = () => setRoute([[0, 0], [0, -220], [170, -220], [170, 0]], true);
$('btnDemo2').onclick = () => setRoute([[0, 0], [-1191, -498], [-1750, -690]], false);
$('btnDemo3').onclick = () => setRoute([[340, -1140], [535, -1817], [900, -1500], [700, -900]], true);
// lagrede løyper
function refreshTrackList() {
  const sel = $('trackList'); sel.innerHTML = '<option value="">Mine løyper…</option>';
  store.get('gateracer_tracks', []).forEach((t, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = `${t.name} (${t.loop ? 'sløyfe' : 'sprint'})`; sel.appendChild(o); });
}
$('btnSave').onclick = () => {
  const name = $('trackName').value.trim(); if (!name || waypoints.length < 2) { hint.textContent = 'Gi løypa et navn og tegn minst to punkter først.'; return; }
  const list = store.get('gateracer_tracks', []).filter(t => t.name !== name); list.push({ name, waypoints, loop: loopMode }); store.set('gateracer_tracks', list); refreshTrackList(); hint.textContent = `Lagret «${name}».`;
};
$('trackList').onchange = () => { const t = store.get('gateracer_tracks', [])[Number($('trackList').value)]; if (!t) return; waypoints = t.waypoints.filter(id => G.has(id)); loopMode = t.loop; $('loopChk').checked = t.loop; $('trackName').value = t.name; rebuildRoute(); const n = G.get(waypoints[0]); if (n) { view.cx = n.x; view.cy = n.y; drawMap(); } };
refreshTrackList();
function shareUrl() { const name = $('trackName').value.trim(); return location.origin + location.pathname + '#t=' + (loopMode ? 'L' : 'S') + waypoints.join('-') + (name ? '&n=' + encodeURIComponent(name) : ''); }
$('btnShare').onclick = async () => {
  if (waypoints.length < 2) { hint.textContent = 'Tegn en løype først.'; return; }
  const url = shareUrl(); history.replaceState(null, '', url);
  try { await navigator.clipboard.writeText(url); hint.textContent = 'Lenke kopiert! Send den til noen, så får de løypa ferdig tegnet.'; }
  catch { hint.textContent = 'Lenken ligger nå i adressefeltet. Kopier den derfra.'; }
};
function loadFromHash() {
  const m = location.hash.match(/t=([LS])([\d-]+)/); if (!m) return;
  const ids = m[2].split('-').map(Number).filter(id => G.has(id)); if (ids.length < 2) return;
  waypoints = ids; loopMode = m[1] === 'L'; $('loopChk').checked = loopMode;
  const n = location.hash.match(/n=([^&]+)/); if (n) $('trackName').value = decodeURIComponent(n[1]);
  rebuildRoute();
  const xs = waypoints.map(id => G.get(id).x), ys = waypoints.map(id => G.get(id).y);
  view.cx = (Math.min(...xs) + Math.max(...xs)) / 2; view.cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  view.scale = clamp(Math.min(mapC.clientWidth / (Math.max(...xs) - Math.min(...xs) + 300), mapC.clientHeight / (Math.max(...ys) - Math.min(...ys) + 300)), 0.15, 3);
  hint.textContent = 'Løype fra lenke lastet: ' + ($('trackName').value || (loopMode ? 'sløyfe' : 'sprint')) + '. Trykk Kjør!';
}
window.addEventListener('resize', () => { resizeMap(); if (renderer) resizeRace(); });
resizeMap(); rebuildRoute(); loadFromHash(); drawMap();

// ------------------------------------------------------------------ 3D-scene
const raceDiv = $('race');
let renderer, scene, camera, sun, carGroup, trackGroup = null, bldMesh = null;
const terrainChunks = []; let makeHi = null;
const MOBILE = new URLSearchParams(location.search).get('mobile') === '1' || matchMedia('(pointer: coarse)').matches || innerWidth < 900;
const HI_RADIUS = MOBILE ? 330 : 700;
const V = (x, y, z) => new THREE.Vector3(x, z, -y);
const CLS_COL = [[118, 158, 86], [66, 104, 58], [64, 118, 170], [176, 172, 96], [110, 168, 80], [120, 140, 70], [150, 142, 132], [150, 150, 140]];
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
  // bil
  carGroup = new THREE.Group();
  const red = new THREE.MeshLambertMaterial({ color: 0xe0333a }), dark = new THREE.MeshLambertMaterial({ color: 0x1c1c20 });
  const add = (geo, mat, x, y, z) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); carGroup.add(o); return o; };
  add(new THREE.BoxGeometry(4.2, 0.55, 1.5), red, 0, 0.55, 0); add(new THREE.BoxGeometry(1.6, 0.35, 0.8), red, 2.7, 0.45, 0);
  add(new THREE.BoxGeometry(1.2, 0.5, 0.8), dark, -0.2, 1.0, 0); add(new THREE.SphereGeometry(0.28, 8, 6), new THREE.MeshLambertMaterial({ color: 0xffd14a }), -0.1, 1.35, 0);
  add(new THREE.BoxGeometry(0.5, 0.12, 1.9), red, -2.2, 1.25, 0); add(new THREE.BoxGeometry(0.6, 0.1, 2.0), red, 3.3, 0.3, 0);
  for (const [wx, wz] of [[1.5, 0.95], [1.5, -0.95], [-1.5, 0.95], [-1.5, -0.95]]) add(new THREE.CylinderGeometry(0.42, 0.42, 0.45, 12), dark, wx, 0.42, wz).rotation.x = Math.PI / 2;
  carGroup.traverse(o => { o.castShadow = true; }); scene.add(carGroup);
  resizeRace();
  $('stats').textContent = `${world.origin.name} · ${world.buildings.length} bygninger · ${n} trær · Kart © OpenStreetMap · Høyder © Kartverket`;
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
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, nxv = -dy / L * width / 2, nyv = dx / L * width / 2, p = pts[i], c = colorFn ? colorFn(i) : color;
    for (const sgn of [-1, 1]) { const x = p[0] + nxv * sgn, y = p[1] + nyv * sgn; pos.push(x, terrainZ(x, y) + lift, -y); col.push(c[0], c[1], c[2]); }
  }
  for (let i = 0; i < segs; i++) { const a = i * 2, b = ((i + 1) % n) * 2; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g.toNonIndexed();
}

// ------------------------------------------------------------------ løype -> bane
let track = null; const TRACK_W = 7;
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
function buildTrack(nodeIds, closed) {
  let pts = nodeIds.map(id => { const n = G.get(id); return [n.x, n.y]; });
  pts = resample(pts, 1.5, closed); for (let k = 0; k < 3; k++) pts = smooth(pts, 5, closed); pts = resample(pts, 2, closed);
  const n = pts.length, grid = new Map(), cell = 8;
  pts.forEach((p, i) => { const key = `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`; (grid.get(key) || grid.set(key, []).get(key)).push(i); });
  const dirAt = i => { const a = closed ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)], b = closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)]; const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return [dx / L, dy / L]; };
  track = { pts, n, grid, cell, closed, dirAt, sectors: [Math.floor(n / 3), Math.floor(2 * n / 3)] };
  // hus som ligger i veien for banen skjules (pluss manuelt fjernede)
  hidden = new Set(); world.buildings.forEach((b, k) => { if (removedManual.has(b.id)) hidden.add(k); });
  for (const p of pts) for (const k of candidates(p[0], p[1], 6)) { if (hidden.has(k)) continue; if (polyDist(p[0], p[1], world.buildings[k].p) < TRACK_W / 2 + 1.5) hidden.add(k); }
  rebuildBuildings();
  if (trackGroup) { scene.remove(trackGroup); trackGroup.traverse(o => o.geometry && o.geometry.dispose()); }
  trackGroup = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  trackGroup.add(new THREE.Mesh(ribbon(pts, TRACK_W, 0.2, [0.22, 0.22, 0.25], closed), mat));
  const curb = i => (Math.floor(i / 4) % 2 === 0) ? [0.85, 0.15, 0.15] : [0.92, 0.92, 0.9];
  for (const sgn of [-1, 1]) {
    const off = pts.map((p, i) => { const d = dirAt(i), o = (TRACK_W / 2 + 0.45) * sgn; return [p[0] - d[1] * o, p[1] + d[0] * o]; });
    trackGroup.add(new THREE.Mesh(ribbon(off, 0.9, 0.22, null, closed, curb), mat));
  }
  // tverrlinjer: mål (sjakk), sektorporter (blå), sprintmål (sjakk)
  const cross = (i0, rows, colorFn) => {
    const pos = [], col = [], cols = 8, cw = TRACK_W / cols;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const quad = [];
      for (const [ri, ci] of [[r, c], [r, c + 1], [r + 1, c + 1], [r + 1, c]]) { const ii = clamp(i0 + ri, 0, n - 1), p = pts[ii], d = dirAt(ii), off = -TRACK_W / 2 + ci * cw; const x = p[0] - d[1] * off, y = p[1] + d[0] * off; quad.push([x, terrainZ(x, y) + 0.27, -y]); }
      const k = colorFn(r, c); for (const t of [0, 1, 2, 0, 2, 3]) { pos.push(...quad[t]); col.push(k, k, k); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
    trackGroup.add(new THREE.Mesh(g, mat));
  };
  cross(0, 2, (r, c) => ((r + c) % 2 === 0) ? 0.06 : 0.95);
  if (!closed) cross(n - 3, 2, (r, c) => ((r + c) % 2 === 0) ? 0.06 : 0.95);
  const blueMat = new THREE.MeshLambertMaterial({ color: 0x3a8cff, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  for (const sIdx of track.sectors) {
    const p = pts[sIdx], d = dirAt(sIdx), pos = [];
    for (const [ri, off] of [[0, -TRACK_W / 2 - 1], [0, TRACK_W / 2 + 1], [1, TRACK_W / 2 + 1], [1, -TRACK_W / 2 - 1]]) { const pp = pts[Math.min(n - 1, sIdx + ri)]; const x = pp[0] - d[1] * off, y = pp[1] + d[0] * off; pos.push(x, terrainZ(x, y) + 0.3, -y); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex([0, 2, 1, 0, 3, 2]); g.computeVertexNormals();
    trackGroup.add(new THREE.Mesh(g, blueMat));
    // portstolper
    for (const sgn of [-1, 1]) { const x = p[0] - d[1] * (TRACK_W / 2 + 1.2) * sgn, y = p[1] + d[0] * (TRACK_W / 2 + 1.2) * sgn, z = terrainZ(x, y); const pole = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3, 0.3), blueMat); pole.position.set(x, z + 1.5, -y); trackGroup.add(pole); }
  }
  trackGroup.traverse(o => { o.receiveShadow = true; }); scene.add(trackGroup);
  buildMinimapBase();
}
function nearestTrack(x, y) {
  const cx = Math.floor(x / track.cell), cy = Math.floor(y / track.cell); let best = -1, bd = Infinity;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const arr = track.grid.get(`${cx + a},${cy + b}`); if (!arr) continue; for (const i of arr) { const p = track.pts[i]; const d = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (d < bd) { bd = d; best = i; } } }
  return { i: best, d: Math.sqrt(bd) };
}

// ------------------------------------------------------------------ minikart
const mm = $('minimap'), mmx = mm.getContext('2d'); let mmBase = null, mmT = null;
function buildMinimapBase() {
  const S = 210 * devicePixelRatio; mm.width = S; mm.height = S;
  const xs = track.pts.map(p => p[0]), ys = track.pts.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const sc = (S - 24 * devicePixelRatio) / Math.max(x1 - x0, y1 - y0, 50);
  mmT = (x, y) => [S / 2 + (x - (x0 + x1) / 2) * sc, S / 2 - (y - (y0 + y1) / 2) * sc];
  mmBase = document.createElement('canvas'); mmBase.width = S; mmBase.height = S; const c = mmBase.getContext('2d');
  c.strokeStyle = '#3a4058'; c.lineWidth = 1.5 * devicePixelRatio; c.lineCap = 'round';
  for (const r of world.roads) { if (!r.drive) continue; if (!r.p.some(p => p[0] > x0 - 150 && p[0] < x1 + 150 && p[1] > y0 - 150 && p[1] < y1 + 150)) continue; c.beginPath(); r.p.forEach((p, i) => { const q = mmT(p[0], p[1]); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); }); c.stroke(); }
  c.strokeStyle = '#e0333a'; c.lineWidth = 4 * devicePixelRatio; c.beginPath(); track.pts.forEach((p, i) => { const q = mmT(p[0], p[1]); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); }); if (track.closed) c.closePath(); c.stroke();
  c.fillStyle = '#3a8cff'; for (const s of track.sectors) { const q = mmT(...track.pts[s]); c.beginPath(); c.arc(q[0], q[1], 4 * devicePixelRatio, 0, 7); c.fill(); }
  c.fillStyle = '#fff'; const q0 = mmT(...track.pts[0]); c.beginPath(); c.arc(q0[0], q0[1], 4.5 * devicePixelRatio, 0, 7); c.fill();
  if (!track.closed) { c.fillStyle = '#ffd14a'; const q1 = mmT(...track.pts[track.n - 1]); c.beginPath(); c.arc(q1[0], q1[1], 4.5 * devicePixelRatio, 0, 7); c.fill(); }
}
function drawMinimap() {
  if (!mmBase) return; mmx.clearRect(0, 0, mm.width, mm.height); mmx.drawImage(mmBase, 0, 0);
  const q = mmT(car.x, car.y); mmx.save(); mmx.translate(q[0], q[1]); mmx.rotate(-car.hdg); mmx.fillStyle = '#fff'; mmx.strokeStyle = '#000'; mmx.lineWidth = devicePixelRatio;
  const r = 6 * devicePixelRatio; mmx.beginPath(); mmx.moveTo(r, 0); mmx.lineTo(-r * 0.7, r * 0.6); mmx.lineTo(-r * 0.7, -r * 0.6); mmx.closePath(); mmx.fill(); mmx.stroke(); mmx.restore();
}

// ------------------------------------------------------------------ bil / fysikk / tider
const car = { x: 0, y: 0, hdg: 0, v: 0, steer: 0 };
const keys = {};
window.addEventListener('keydown', e => { const k = e.key.toLowerCase(); keys[k] = true; if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault(); if (k === 'r' && racing) resetCar(); });
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
for (const [id, key] of [['tLeft', 'arrowleft'], ['tRight', 'arrowright'], ['tGas', 'arrowup'], ['tBrake', 'arrowdown']]) {
  const el = $(id); const on = e => { e.preventDefault(); keys[key] = true; el.classList.add('down'); }, off = e => { e.preventDefault(); keys[key] = false; el.classList.remove('down'); };
  el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); on(e); }); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off);
}
$('tReset').addEventListener('pointerdown', e => { e.preventDefault(); if (racing) resetCar(); });
if (MOBILE) $('touch').style.display = 'flex';
let racing = false, lap = 1, lapStart = 0, lastLap = null, best = null, bestKey = '', prevP = 0, finished = false;
let secTimes = [], secStart = 0, secIdx = 0, secDelta = [];
function resetCar() {
  const p0 = track.pts[0], p1 = track.pts[3];
  car.x = p0[0]; car.y = p0[1]; car.hdg = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]); car.v = 0; car.steer = 0;
  lapStart = secStart = performance.now(); prevP = 0; secTimes = []; secDelta = []; secIdx = 0; finished = false;
  camera.position.copy(V(car.x - Math.cos(car.hdg) * 10, car.y - Math.sin(car.hdg) * 10, terrainZ(car.x, car.y) + 4));
}
function showMsg(t, ms = 1500) { const m = $('msg'); m.textContent = t; m.style.opacity = 1; clearTimeout(m._t); m._t = setTimeout(() => m.style.opacity = 0, ms); }
function fmt(ms) { const s = ms / 1000; return `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`; }
function fmtD(ms) { return (ms >= 0 ? '+' : '−') + (Math.abs(ms) / 1000).toFixed(2); }
function sectorHud() {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const bs = best && best.sectors ? best.sectors[i] : null;
    if (secTimes[i] != null) parts.push(`S${i + 1} <b>${fmt(secTimes[i])}</b> <span class="${secDelta[i] != null ? (secDelta[i] <= 0 ? 'neg' : 'pos') : ''}">${secDelta[i] != null ? fmtD(secDelta[i]) : ''}</span>`);
    else parts.push(`S${i + 1} ${bs != null ? '<span style="opacity:.5">' + fmt(bs) + '</span>' : '–'}`);
  }
  $('sectors').innerHTML = parts.join(' &nbsp; ');
}
function passSector(i, now) {
  const t = now - secStart; secTimes[i] = t; secStart = now;
  const bs = best && best.sectors ? best.sectors[i] : null; secDelta[i] = bs != null ? t - bs : null;
  if (i < 2) showMsg(`Sektor ${i + 1}: ${fmt(t)}${bs != null ? '  ' + fmtD(t - bs) : ''}`, 1600);
}
function finishLap(now) {
  const total = now - lapStart; lastLap = total; passSector(2, now);
  const bestSectors = best && best.sectors ? best.sectors.map((s, i) => Math.min(s ?? Infinity, secTimes[i] ?? Infinity)) : secTimes.slice();
  if (!best || total < best.lap) { best = { lap: total, sectors: bestSectors }; showMsg((track.closed ? 'NY BESTETID ' : 'MÅL! NY BESTETID ') + fmt(total), 2500); }
  else { best.sectors = bestSectors; showMsg((track.closed ? 'Runde ' : 'MÅL! ') + fmt(total) + '  ' + fmtD(total - best.lap), 2500); }
  store.set(bestKey, best);
  if (track.closed) { lap++; lapStart = secStart = now; secTimes = []; secDelta = []; secIdx = 0; } else finished = true;
}
function step(dt) {
  const th = (keys['arrowup'] || keys['w'] ? 1 : 0) - (keys['arrowdown'] || keys['s'] ? 1 : 0);
  const st = (keys['arrowleft'] || keys['a'] ? 1 : 0) - (keys['arrowright'] || keys['d'] ? 1 : 0);
  const brake = keys[' '];
  const nt = nearestTrack(car.x, car.y), onTrack = nt.i >= 0 && nt.d < TRACK_W / 2 + 1.0;
  let v = car.v;
  if (th > 0) v += (v < 0 ? 20 : 13 * (1 - Math.abs(v) / 62)) * dt; else if (th < 0) v -= (v > 0.5 ? 22 : 5) * dt;
  const drag = v * v * 0.004 + 0.8 + (onTrack ? 0 : Math.abs(v) * 1.6 + 3) + (brake ? 28 : 0);
  v -= Math.sign(v) * Math.min(Math.abs(v), drag * dt); v = clamp(v, -8, 62);
  const maxSteer = (onTrack ? 0.5 : 0.35) / (1 + Math.abs(v) / 22);
  car.steer += (st * maxSteer - car.steer) * Math.min(1, dt * 9);
  car.hdg += (v / 2.6) * Math.tan(car.steer) * dt * (brake && Math.abs(v) > 5 ? 1.6 : 1);
  const nx = car.x + Math.cos(car.hdg) * v * dt, ny = car.y + Math.sin(car.hdg) * v * dt, cs = Math.cos(car.hdg), sn = Math.sin(car.hdg);
  let hit = false;
  for (const [fx, fy] of [[0, 0], [2.1, 0.75], [2.1, -0.75], [-2.1, 0.75], [-2.1, -0.75]]) { if (hitsBuilding(nx + cs * fx - sn * fy, ny + sn * fx + cs * fy)) { hit = true; break; } }
  if (hit || nx < T.x0 + 6 || nx > T.x1 - 6 || ny < T.y0 + 6 || ny > T.y1 - 6) { v = -v * 0.25; if (Math.abs(v) < 1) v = 0; } else { car.x = nx; car.y = ny; }
  car.v = v;
  // sektorer og mål
  if (nt.i >= 0 && !finished) {
    const now = performance.now(), n = track.n, p = nt.i, [s1, s2] = track.sectors;
    if (Math.abs(p - prevP) < n / 4) {
      if (secIdx === 0 && prevP < s1 && p >= s1) { passSector(0, now); secIdx = 1; }
      else if (secIdx === 1 && prevP < s2 && p >= s2) { passSector(1, now); secIdx = 2; }
      else if (secIdx === 2 && !track.closed && p >= n - 4) finishLap(now);
    }
    if (track.closed && prevP > n * 0.85 && p < n * 0.15) { if (secIdx === 2) finishLap(now); else { lapStart = secStart = now; secTimes = []; secDelta = []; secIdx = 0; } }
    prevP = p;
  }
  const z = terrainZ(car.x, car.y), zf = terrainZ(car.x + cs * 2, car.y + sn * 2), zb = terrainZ(car.x - cs * 2, car.y - sn * 2), zl = terrainZ(car.x - sn, car.y + cs), zr = terrainZ(car.x + sn, car.y - cs);
  carGroup.position.set(car.x, z + (onTrack ? 0.2 : 0.05), -car.y);
  carGroup.rotation.set(Math.atan2(zr - zl, 2), car.hdg, Math.atan2(zf - zb, 4), 'YZX');
  const back = 9 + Math.abs(v) * 0.08;
  camera.position.lerp(V(car.x - cs * back, car.y - sn * back, z + 3.6), 1 - Math.exp(-dt * 5));
  camera.lookAt(V(car.x + cs * 6, car.y + sn * 6, z + 1.2));
  if (qs.get('top')) { camera.position.set(car.x, z + Number(qs.get('top')), -car.y + 1); camera.lookAt(V(car.x, car.y, z)); }
  sun.position.set(car.x - 120, z + 220, -car.y - 80); sun.target.position.set(car.x, z, -car.y);
  for (const c of terrainChunks) {
    const d = Math.hypot(car.x - c.cx, car.y - c.cy);
    if (d < HI_RADIUS && !c.hi) { c.hi = makeHi(c); scene.add(c.hi); }
    else if (d > HI_RADIUS * 1.6 && c.hi) { scene.remove(c.hi); c.hi.geometry.dispose(); c.hi = null; }
    if (c.hi) { c.hi.visible = d < HI_RADIUS; c.lo.visible = !c.hi.visible; } else c.lo.visible = true;
  }
  $('spd').textContent = Math.round(Math.abs(v) * 3.6);
  $('lapTime').textContent = fmt((finished ? lastLap : performance.now() - lapStart));
  $('lapNo').textContent = (track.closed ? `Runde ${lap}` : (finished ? 'I mål · R for ny start' : 'Sprint')) + (onTrack ? '' : ' · utenfor banen');
  $('lastLap').textContent = 'Sist: ' + (lastLap ? fmt(lastLap) : '–'); $('bestLap').textContent = 'Best: ' + (best ? fmt(best.lap) : '–');
  sectorHud(); drawMinimap();
}
let lastT = 0;
function loop(t) { if (!racing) return; const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016); lastT = t; step(dt); renderer.render(scene, camera); requestAnimationFrame(loop); }

// ------------------------------------------------------------------ modusbytte
const DRAW_BTNS = ['btnRace', 'btnUndo', 'btnClear', 'btnDemo', 'btnDemo2', 'btnDemo3', 'btnShare', 'btnHouse', 'btnSave', 'trackList', 'trackName', 'loopChk'];
$('btnRace').onclick = () => {
  if (!renderer) buildStaticScene();
  buildTrack(routeNodes, loopMode);
  bestKey = 'gateracer_best_' + (loopMode ? 'L' : 'S') + waypoints.join('-');
  const b = store.get(bestKey, null); best = b && typeof b === 'object' ? b : (b ? { lap: Number(b), sectors: null } : null); lastLap = null; lap = 1;
  $('draw').style.display = 'none'; raceDiv.style.display = 'block';
  for (const id of DRAW_BTNS) $(id).style.display = 'none'; $('loopChk').parentElement.style.display = 'none';
  $('btnBack').style.display = ''; hint.textContent = `${loopMode ? 'Sløyfe' : 'Sprint'} · ${hidden.size} hus fjernet fra banen · piltaster eller WASD`;
  resizeRace(); resetCar(); racing = true; lastT = performance.now(); showMsg('GO!', 1000); step(0.016); requestAnimationFrame(loop);
};
$('btnBack').onclick = () => {
  racing = false; raceDiv.style.display = 'none'; $('draw').style.display = 'block';
  for (const id of DRAW_BTNS) $(id).style.display = ''; $('loopChk').parentElement.style.display = '';
  $('btnBack').style.display = 'none'; rebuildRoute(); resizeMap();
};

// ------------------------------------------------------------------ test-URL-er
const qs = new URLSearchParams(location.search);
if (qs.get('demo')) {
  ({ '2': $('btnDemo2'), '3': $('btnDemo3') }[qs.get('demo')] || $('btnDemo')).click();
  if (!$('btnRace').disabled) { $('btnRace').click(); if (qs.get('drive')) { keys['w'] = true; setTimeout(() => { keys['w'] = false; }, Number(qs.get('drive')) * 1000); } }
}
