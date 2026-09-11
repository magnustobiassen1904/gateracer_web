import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ------------------------------------------------------------------ data
const world = await (await fetch('../data/world.json')).json();
window.addEventListener('error', e => { document.getElementById('hint').textContent = 'Feil: ' + e.message; });
const T = world.terrain;
const HALF = -T.x0;
document.getElementById('loading').style.display = 'none';

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function terrainZ(x, y) {
  let fx = clamp((x - T.x0) / T.cell, 0, T.nx - 1.001);
  let fy = clamp((y - T.y0) / T.cell, 0, T.ny - 1.001);
  const i = fy | 0, j = fx | 0, a = fy - i, b = fx - j;
  const z = (ii, jj) => T.zmin + T.z[ii * T.nx + jj] / 10;
  return z(i, j) * (1 - a) * (1 - b) + z(i + 1, j) * a * (1 - b) + z(i, j + 1) * (1 - a) * b + z(i + 1, j + 1) * a * b;
}

// ------------------------------------------------------------------ veigraf (kjørbare veier)
const G = new Map(); // nodeId -> {x,y,adj:[[id,len]]}
for (const r of world.roads) {
  if (!r.drive) continue;
  for (let i = 0; i < r.nodes.length; i++) {
    const id = r.nodes[i], p = r.p[i];
    if (!p) continue;
    if (!G.has(id)) G.set(id, { x: p[0], y: p[1], adj: [] });
    if (i > 0 && r.p[i - 1]) {
      const pid = r.nodes[i - 1], q = r.p[i - 1];
      const len = Math.hypot(p[0] - q[0], p[1] - q[1]);
      G.get(id).adj.push([pid, len]);
      G.get(pid).adj.push([id, len]);
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
  while (heap.length) {
    heap.sort((a, b) => a[0] - b[0]);
    const [d, u] = heap.shift();
    if (done.has(u)) continue;
    done.add(u);
    if (u === dst) break;
    for (const [v, w] of G.get(u).adj) {
      const nd = d + w;
      if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); heap.push([nd, v]); }
    }
  }
  if (!dist.has(dst)) return null;
  const path = [dst]; let u = dst;
  while (u !== src) { u = prev.get(u); path.push(u); }
  return path.reverse();
}

// ------------------------------------------------------------------ tegnemodus
const mapC = document.getElementById('map'), mctx = mapC.getContext('2d');
let view = { cx: 0, cy: 0, scale: 1 };
let waypoints = [];       // node ids
let routeNodes = [];      // full node list (closed)
const hint = document.getElementById('hint');

function resizeMap() {
  mapC.width = mapC.clientWidth * devicePixelRatio; mapC.height = mapC.clientHeight * devicePixelRatio;
  if (view.scale === 1) view.scale = Math.min(mapC.clientWidth, mapC.clientHeight) / 620;
  drawMap();
}
function w2s(x, y) { return [(x - view.cx) * view.scale + mapC.clientWidth / 2, -(y - view.cy) * view.scale + mapC.clientHeight / 2]; }
function s2w(sx, sy) { return [(sx - mapC.clientWidth / 2) / view.scale + view.cx, -(sy - mapC.clientHeight / 2) / view.scale + view.cy]; }

const AREA_COL = { forest: '#1f3a25', water: '#1c3a5e', farm: '#3a3a22', park: '#22402a', scrub: '#2b3a24' };
function drawMap() {
  const ctx = mctx; ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  const W = mapC.clientWidth, H = mapC.clientHeight;
  ctx.fillStyle = '#161a2c'; ctx.fillRect(0, 0, W, H);
  const poly = (pts) => { ctx.beginPath(); pts.forEach((p, i) => { const s = w2s(p[0], p[1]); i ? ctx.lineTo(s[0], s[1]) : ctx.moveTo(s[0], s[1]); }); };
  for (const a of world.areas) { poly(a.p); ctx.closePath(); ctx.fillStyle = AREA_COL[a.k] || '#1e2436'; ctx.fill(); }
  for (const b of world.buildings) { poly(b.p); ctx.closePath(); ctx.fillStyle = '#3a4058'; ctx.fill(); }
  for (const r of world.roads) {
    poly(r.p);
    if (r.drive) { ctx.strokeStyle = '#8f96b4'; ctx.lineWidth = Math.max(2, r.w * view.scale); ctx.setLineDash([]); }
    else { ctx.strokeStyle = '#4a5068'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
  }
  ctx.setLineDash([]);
  // veinavn på kjørbare veier
  ctx.fillStyle = '#c9cee4'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
  if (view.scale > 0.9) for (const r of world.roads) if (r.drive && r.n) {
    const m = r.p[Math.floor(r.p.length / 2)]; const s = w2s(m[0], m[1]); ctx.fillText(r.n, s[0], s[1] - 6);
  }
  // origo
  const o = w2s(0, 0); ctx.strokeStyle = '#ffd14a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(o[0], o[1], 7, 0, Math.PI * 2); ctx.stroke();
  // løype
  if (routeNodes.length > 1) {
    ctx.beginPath();
    routeNodes.forEach((id, i) => { const n = G.get(id); const s = w2s(n.x, n.y); i ? ctx.lineTo(s[0], s[1]) : ctx.moveTo(s[0], s[1]); });
    ctx.closePath(); ctx.strokeStyle = '#e0333a'; ctx.lineWidth = Math.max(4, 7 * view.scale); ctx.stroke();
  }
  waypoints.forEach((id, i) => {
    const n = G.get(id); const s = w2s(n.x, n.y);
    ctx.fillStyle = i === 0 ? '#3ad66a' : '#fff'; ctx.beginPath(); ctx.arc(s[0], s[1], 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#000'; ctx.font = 'bold 11px sans-serif'; ctx.fillText(String(i + 1), s[0], s[1] + 4);
  });
}
function rebuildRoute() {
  routeNodes = [];
  if (waypoints.length >= 2) {
    const segs = [];
    for (let i = 0; i < waypoints.length; i++) {
      const a = waypoints[i], b = waypoints[(i + 1) % waypoints.length];
      if (a === b) continue;
      const p = dijkstra(a, b); if (!p) continue;
      segs.push(...p.slice(0, -1));
    }
    routeNodes = segs.filter((id, i) => i === 0 || id !== segs[i - 1]);
  }
  let len = 0;
  for (let i = 0; i < routeNodes.length; i++) { const a = G.get(routeNodes[i]), b = G.get(routeNodes[(i + 1) % routeNodes.length]); len += Math.hypot(a.x - b.x, a.y - b.y); }
  const ok = routeNodes.length >= 4 && len > 150;
  document.getElementById('btnRace').disabled = !ok;
  hint.textContent = waypoints.length === 0 ? 'Klikk på veier for å legge punkter. Løypa snapper til gatenettet og lukkes automatisk. Dra for å flytte, rull for å zoome.'
    : `Løype: ${Math.round(len)} m, ${waypoints.length} punkter. ${ok ? 'Trykk Kjør!' : 'Legg til flere punkter (minst 150 m og en sløyfe).'}`;
  drawMap();
}
let pdown = null, dragged = false;
mapC.addEventListener('pointerdown', e => { pdown = [e.clientX, e.clientY, view.cx, view.cy]; dragged = false; mapC.setPointerCapture(e.pointerId); });
mapC.addEventListener('pointermove', e => {
  if (!pdown) return;
  const dx = e.clientX - pdown[0], dy = e.clientY - pdown[1];
  if (Math.hypot(dx, dy) > 4) dragged = true;
  if (dragged) { view.cx = pdown[2] - dx / view.scale; view.cy = pdown[3] + dy / view.scale; drawMap(); }
});
mapC.addEventListener('pointerup', e => {
  if (pdown && !dragged) {
    const rect = mapC.getBoundingClientRect();
    const [x, y] = s2w(e.clientX - rect.left, e.clientY - rect.top);
    const id = nearestNode(x, y);
    if (id !== null && id !== waypoints[waypoints.length - 1]) { waypoints.push(id); rebuildRoute(); }
  }
  pdown = null;
});
mapC.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = mapC.getBoundingClientRect();
  const [wx, wy] = s2w(e.clientX - rect.left, e.clientY - rect.top);
  view.scale = clamp(view.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 0.3, 12);
  const [nx, ny] = s2w(e.clientX - rect.left, e.clientY - rect.top);
  view.cx += wx - nx; view.cy += wy - ny; drawMap();
}, { passive: false });
document.getElementById('btnUndo').onclick = () => { waypoints.pop(); rebuildRoute(); };
document.getElementById('btnClear').onclick = () => { waypoints = []; rebuildRoute(); };
document.getElementById('btnDemo').onclick = () => {
  const ids = [[0, 0], [0, -220], [170, -220], [170, 0]].map(p => nearestNode(p[0], p[1], 150)).filter(id => id !== null);
  waypoints = ids.filter((id, i) => i === 0 || id !== ids[i - 1]); rebuildRoute();
};
window.addEventListener('resize', () => { resizeMap(); if (renderer) resizeRace(); });
resizeMap(); rebuildRoute();

// ------------------------------------------------------------------ 3D-scene (bygges én gang)
const raceDiv = document.getElementById('race');
let renderer, scene, camera, sun, carGroup, trackGroup = null;
const V = (x, y, z) => new THREE.Vector3(x, z, -y); // lokal (øst, nord, opp) -> three (x, y, -z)

function buildStaticScene() {
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  raceDiv.appendChild(renderer.domElement);
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fc1ea);
  scene.fog = new THREE.Fog(0xb9d3ea, 180, 800);
  camera = new THREE.PerspectiveCamera(70, 1, 0.5, 2000);
  scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x3f4a30, 0.85));
  sun = new THREE.DirectionalLight(0xfff2dc, 1.6);
  sun.position.set(-120, 220, -80); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera; sc.left = -160; sc.right = 160; sc.top = 160; sc.bottom = -160; sc.near = 10; sc.far = 700;
  sun.shadow.bias = -0.0008;
  scene.add(sun); scene.add(sun.target);

  // terreng
  const CLS_COL = [[118, 158, 86], [66, 104, 58], [64, 118, 170], [176, 172, 96], [110, 168, 80], [120, 140, 70]];
  const nx = T.nx, ny = T.ny;
  const pos = new Float32Array(nx * ny * 3), col = new Float32Array(nx * ny * 3);
  for (let i = 0; i < ny; i++) for (let j = 0; j < nx; j++) {
    const k = i * nx + j, x = T.x0 + j * T.cell, y = T.y0 + i * T.cell, z = T.zmin + T.z[k] / 10;
    pos.set([x, z, -y], k * 3);
    const c = CLS_COL[T.c[k]] || CLS_COL[0]; const n = 1 + (Math.random() - 0.5) * 0.08;
    col.set([c[0] / 255 * n, c[1] / 255 * n, c[2] / 255 * n], k * 3);
  }
  const idx = [];
  for (let i = 0; i < ny - 1; i++) for (let j = 0; j < nx - 1; j++) { const a = i * nx + j, b = a + 1, c = a + nx, d = c + 1; idx.push(a, b, c, b, d, c); }
  let tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); tg.setAttribute('color', new THREE.BufferAttribute(col, 3)); tg.setIndex(idx);
  tg = tg.toNonIndexed(); tg.computeVertexNormals();
  const terrain = new THREE.Mesh(tg, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  terrain.receiveShadow = true; scene.add(terrain);

  // veier (alle, som bånd på terrenget)
  const roadGeos = [];
  for (const r of world.roads) roadGeos.push(ribbon(r.p, r.w, 0.08, r.drive ? [0.30, 0.31, 0.34] : [0.62, 0.58, 0.50], false));
  const roads = new THREE.Mesh(mergeGeometries(roadGeos.filter(Boolean)), new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  roads.receiveShadow = true; scene.add(roads);

  // bygninger
  const bGeos = [];
  for (const b of world.buildings) {
    const shape = new THREE.Shape(b.p.map(p => new THREE.Vector2(p[0], p[1])));
    const base = b.zb - 1.5, top = b.top ?? (b.zt + b.h);
    const g = new THREE.ExtrudeGeometry(shape, { depth: top - base, bevelEnabled: false });
    g.rotateX(-Math.PI / 2); g.translate(0, base, 0);
    const c = new THREE.Color(b.c); const roof = c.clone().multiplyScalar(0.55);
    const n = g.attributes.position.count, cc = new Float32Array(n * 3), nrm = g.attributes.normal;
    for (let i = 0; i < n; i++) { const isRoof = nrm.getY(i) > 0.9; const k = isRoof ? roof : c; cc.set([k.r, k.g, k.b], i * 3); }
    g.setAttribute('color', new THREE.BufferAttribute(cc, 3)); g.deleteAttribute('uv');
    bGeos.push(g);
  }
  const bld = new THREE.Mesh(mergeGeometries(bGeos), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  bld.castShadow = true; bld.receiveShadow = true; scene.add(bld);

  // trær (instanser: stamme + kjegle), høyde fra data
  const n = world.trees.length;
  const cone = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 6), new THREE.MeshLambertMaterial({ flatShading: true }), n);
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 5), new THREE.MeshLambertMaterial({ color: 0x5a4030 }), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), tmpc = new THREE.Color();
  world.trees.forEach((t, i) => {
    const [x, y, h] = t; const z = terrainZ(x, y); const r = Math.max(1.0, h * 0.22);
    p.set(x, z + h * 0.2 + h * 0.8 / 2, -y); s.set(r, h * 0.8, r); m.compose(p, q, s); cone.setMatrixAt(i, m);
    tmpc.setHSL(0.30 + Math.random() * 0.06, 0.45, 0.22 + Math.random() * 0.1); cone.setColorAt(i, tmpc);
    p.set(x, z + h * 0.1, -y); s.set(Math.max(0.3, h * 0.05), h * 0.22, Math.max(0.3, h * 0.05)); m.compose(p, q, s); trunk.setMatrixAt(i, m);
  });
  cone.castShadow = true; trunk.castShadow = true; scene.add(cone); scene.add(trunk);

  // bil
  carGroup = new THREE.Group();
  const red = new THREE.MeshLambertMaterial({ color: 0xe0333a }), dark = new THREE.MeshLambertMaterial({ color: 0x1c1c20 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.55, 1.5), red); body.position.y = 0.55; carGroup.add(body);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.35, 0.8), red); nose.position.set(2.7, 0.45, 0); carGroup.add(nose);
  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 0.8), dark); cockpit.position.set(-0.2, 1.0, 0); carGroup.add(cockpit);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), new THREE.MeshLambertMaterial({ color: 0xffd14a })); helmet.position.set(-0.1, 1.35, 0); carGroup.add(helmet);
  const wingR = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 1.9), red); wingR.position.set(-2.2, 1.25, 0); carGroup.add(wingR);
  const wingF = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 2.0), red); wingF.position.set(3.3, 0.3, 0); carGroup.add(wingF);
  for (const [wx, wz] of [[1.5, 0.95], [1.5, -0.95], [-1.5, 0.95], [-1.5, -0.95]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.45, 12), dark); w.rotation.x = Math.PI / 2; w.position.set(wx, 0.42, wz); carGroup.add(w);
  }
  carGroup.traverse(o => { o.castShadow = true; });
  scene.add(carGroup);
  resizeRace();
  document.getElementById('stats').textContent =
    `${world.origin.name} · ${world.buildings.length} bygninger · ${world.trees.length} trær · høyder: ${world.lidar ? 'Kartverket laser (ekte)' : 'gjettet (ingen lidar)'}`;
}
function resizeRace() {
  const w = raceDiv.clientWidth, h = raceDiv.clientHeight;
  renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
}
// bånd langs en polylinje, lagt på terrenget. colorFn(i) kan gi farge per sample.
function ribbon(pts, width, lift, color, closed, colorFn) {
  const n = pts.length; if (n < 2) return null;
  const pos = [], col = [], idx = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    let dx, dy;
    if (closed) { dx = b[0] - a[0]; dy = b[1] - a[1]; }
    else if (i === 0) { dx = pts[1][0] - pts[0][0]; dy = pts[1][1] - pts[0][1]; }
    else if (i === n - 1) { dx = pts[n - 1][0] - pts[n - 2][0]; dy = pts[n - 1][1] - pts[n - 2][1]; }
    else { dx = b[0] - a[0]; dy = b[1] - a[1]; }
    const L = Math.hypot(dx, dy) || 1; const nxv = -dy / L * width / 2, nyv = dx / L * width / 2;
    const p = pts[i], c = colorFn ? colorFn(i) : color;
    for (const sgn of [-1, 1]) {
      const x = p[0] + nxv * sgn, y = p[1] + nyv * sgn;
      pos.push(x, terrainZ(x, y) + lift, -y); col.push(c[0], c[1], c[2]);
    }
  }
  for (let i = 0; i < segs; i++) { const a = i * 2, b = ((i + 1) % n) * 2; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g.toNonIndexed();
}

// ------------------------------------------------------------------ løype -> bane
let track = null; // {pts:[[x,y]], n, grid:Map, cell}
const TRACK_W = 7;
function buildTrack(nodeIds) {
  let pts = nodeIds.map(id => { const n = G.get(id); return [n.x, n.y]; });
  pts = resample(pts, 1.5);
  for (let k = 0; k < 3; k++) pts = smooth(pts, 5);
  pts = resample(pts, 2);
  const n = pts.length;
  const grid = new Map(), cell = 8;
  pts.forEach((p, i) => { const key = `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`; (grid.get(key) || grid.set(key, []).get(key)).push(i); });
  track = { pts, n, grid, cell };
  if (trackGroup) { scene.remove(trackGroup); trackGroup.traverse(o => o.geometry && o.geometry.dispose()); }
  trackGroup = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  trackGroup.add(new THREE.Mesh(ribbon(pts, TRACK_W, 0.2, [0.22, 0.22, 0.25], true), mat));
  // kantsteiner: rød/hvit annenhver 8 m
  const curb = i => (Math.floor(i / 4) % 2 === 0) ? [0.85, 0.15, 0.15] : [0.92, 0.92, 0.9];
  for (const sgn of [-1, 1]) {
    const off = pts.map((p, i) => { const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n]; const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; const d = (TRACK_W / 2 + 0.45) * sgn; return [p[0] - dy / L * d, p[1] + dx / L * d]; });
    trackGroup.add(new THREE.Mesh(ribbon(off, 0.9, 0.22, null, true, curb), mat));
  }
  // mållinje: sjakkmønster 2 rader x 8 felt på tvers av banen ved sample 0
  {
    const pos = [], col = [];
    const dirAt = i => { const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n]; const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return [dx / L, dy / L]; };
    const cols = 8, cw = TRACK_W / cols;
    for (let r = 0; r < 2; r++) for (let c = 0; c < cols; c++) {
      const quad = [];
      for (const [ri, ci] of [[r, c], [r, c + 1], [r + 1, c + 1], [r + 1, c]]) {
        const p = pts[ri], d = dirAt(ri), off = -TRACK_W / 2 + ci * cw;
        const x = p[0] - d[1] * off, y = p[1] + d[0] * off; quad.push([x, terrainZ(x, y) + 0.27, -y]);
      }
      const k = ((r + c) % 2 === 0) ? 0.06 : 0.95;
      for (const t of [0, 1, 2, 0, 2, 3]) { pos.push(...quad[t]); col.push(k, k, k); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
    trackGroup.add(new THREE.Mesh(g, mat));
  }
  trackGroup.traverse(o => { o.receiveShadow = true; });
  scene.add(trackGroup);
}
function resample(pts, step) {
  const out = []; let carry = 0; const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-6) continue;
    let s = carry; while (s < L) { const t = s / L; out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); s += step; } carry = s - L;
  }
  return out;
}
function smooth(pts, r) {
  const n = pts.length; return pts.map((_, i) => { let x = 0, y = 0; for (let k = -r; k <= r; k++) { const p = pts[(i + k + n) % n]; x += p[0]; y += p[1]; } return [x / (2 * r + 1), y / (2 * r + 1)]; });
}
function nearestTrack(x, y) { // -> {i, d}
  const cx = Math.floor(x / track.cell), cy = Math.floor(y / track.cell); let best = -1, bd = Infinity;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    const arr = track.grid.get(`${cx + a},${cy + b}`); if (!arr) continue;
    for (const i of arr) { const p = track.pts[i]; const d = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (d < bd) { bd = d; best = i; } }
  }
  return { i: best, d: Math.sqrt(bd) };
}

// ------------------------------------------------------------------ kollisjon mot bygninger
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
function hitsBuilding(x, y) {
  const arr = bGrid.get(`${Math.floor(x / BC)},${Math.floor(y / BC)}`); if (!arr) return false;
  for (const k of arr) { const b = world.buildings[k]; if (x < b.bb[0] || x > b.bb[2] || y < b.bb[1] || y > b.bb[3]) continue; if (pip(x, y, b.p)) return true; }
  return false;
}

// ------------------------------------------------------------------ bil / fysikk
const car = { x: 0, y: 0, hdg: 0, v: 0, steer: 0 };
const keys = {};
window.addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(e.key.toLowerCase())) e.preventDefault(); if (e.key.toLowerCase() === 'r' && racing) resetCar(); });
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
let racing = false, lap = 1, lapStart = 0, lastLap = null, bestLap = null, cp1 = false, cp2 = false, prevP = 0, bestKey = '';
function resetCar() {
  const p0 = track.pts[0], p1 = track.pts[3];
  car.x = p0[0]; car.y = p0[1]; car.hdg = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]); car.v = 0; car.steer = 0;
  lapStart = performance.now(); cp1 = cp2 = false; prevP = 0;
  camera.position.copy(V(car.x - Math.cos(car.hdg) * 10, car.y - Math.sin(car.hdg) * 10, terrainZ(car.x, car.y) + 4));
}
function showMsg(t, ms = 1500) { const m = document.getElementById('msg'); m.textContent = t; m.style.opacity = 1; clearTimeout(m._t); m._t = setTimeout(() => m.style.opacity = 0, ms); }
function fmt(ms) { const s = ms / 1000; return `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`; }

function step(dt) {
  const th = (keys['arrowup'] || keys['w'] ? 1 : 0) - (keys['arrowdown'] || keys['s'] ? 1 : 0);
  const st = (keys['arrowleft'] || keys['a'] ? 1 : 0) - (keys['arrowright'] || keys['d'] ? 1 : 0);
  const brake = keys[' '];
  const nt = nearestTrack(car.x, car.y);
  const onTrack = nt.i >= 0 && nt.d < TRACK_W / 2 + 1.0;
  let v = car.v;
  if (th > 0) v += (v < 0 ? 20 : 13 * (1 - Math.abs(v) / 62)) * dt;
  else if (th < 0) v -= (v > 0.5 ? 22 : 5) * dt;
  const drag = v * v * 0.004 + 0.8 + (onTrack ? 0 : Math.abs(v) * 1.6 + 3) + (brake ? 28 : 0);
  v -= Math.sign(v) * Math.min(Math.abs(v), drag * dt);
  v = clamp(v, -8, 62);
  const maxSteer = (onTrack ? 0.5 : 0.35) / (1 + Math.abs(v) / 22);
  car.steer += (st * maxSteer - car.steer) * Math.min(1, dt * 9);
  car.hdg += (v / 2.6) * Math.tan(car.steer) * dt * (brake && Math.abs(v) > 5 ? 1.6 : 1);
  const nx = car.x + Math.cos(car.hdg) * v * dt, ny = car.y + Math.sin(car.hdg) * v * dt;
  // kollisjon: senter + fire hjørner
  const cs = Math.cos(car.hdg), sn = Math.sin(car.hdg); let hit = false;
  for (const [fx, fy] of [[0, 0], [2.1, 0.75], [2.1, -0.75], [-2.1, 0.75], [-2.1, -0.75]]) {
    const px = nx + cs * fx - sn * fy, py = ny + sn * fx + cs * fy; if (hitsBuilding(px, py)) { hit = true; break; }
  }
  if (hit || Math.abs(nx) > HALF - 6 || Math.abs(ny) > HALF - 6) { v = -v * 0.25; if (Math.abs(v) < 1) v = 0; }
  else { car.x = nx; car.y = ny; }
  car.v = v;
  // runde-logikk
  if (nt.i >= 0) {
    const n = track.n, p = nt.i;
    if (Math.abs(p - Math.floor(n / 3)) < 10) cp1 = true;
    if (cp1 && Math.abs(p - Math.floor(2 * n / 3)) < 10) cp2 = true;
    if (prevP > n * 0.85 && p < n * 0.15) {
      if (cp1 && cp2) {
        const t = performance.now() - lapStart; lastLap = t;
        if (bestLap === null || t < bestLap) { bestLap = t; localStorage.setItem(bestKey, String(t)); showMsg('NY BESTETID ' + fmt(t)); } else showMsg('Runde ' + fmt(t));
        lap++; lapStart = performance.now();
      }
      cp1 = cp2 = false;
    }
    prevP = p;
  }
  // plassering i 3D
  const z = terrainZ(car.x, car.y);
  const zf = terrainZ(car.x + cs * 2, car.y + sn * 2), zb = terrainZ(car.x - cs * 2, car.y - sn * 2);
  const zl = terrainZ(car.x - sn * 1, car.y + cs * 1), zr = terrainZ(car.x + sn * 1, car.y - cs * 1);
  carGroup.position.set(car.x, z + (onTrack ? 0.2 : 0.05), -car.y);
  carGroup.rotation.set(Math.atan2(zr - zl, 2), car.hdg, Math.atan2(zf - zb, 4), 'YZX');
  // kamera
  const back = 9 + Math.abs(v) * 0.08;
  const want = V(car.x - cs * back, car.y - sn * back, z + 3.6);
  camera.position.lerp(want, 1 - Math.exp(-dt * 5));
  const look = V(car.x + cs * 6, car.y + sn * 6, z + 1.2);
  camera.lookAt(look);
  if (qs.get('top')) { camera.position.set(car.x, z + Number(qs.get('top')), -car.y + 1); camera.lookAt(V(car.x, car.y, z)); }
  sun.position.set(car.x - 120, z + 220, -car.y - 80); sun.target.position.set(car.x, z, -car.y);
  // HUD
  document.getElementById('spd').textContent = Math.round(Math.abs(v) * 3.6);
  document.getElementById('lapTime').textContent = fmt(performance.now() - lapStart);
  document.getElementById('lapNo').textContent = `Runde ${lap}${onTrack ? '' : ' · utenfor banen'}`;
  document.getElementById('lastLap').textContent = 'Sist: ' + (lastLap ? fmt(lastLap) : '–');
  document.getElementById('bestLap').textContent = 'Best: ' + (bestLap ? fmt(bestLap) : '–');
}
let lastT = 0;
function loop(t) {
  if (!racing) return;
  const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016); lastT = t;
  step(dt); renderer.render(scene, camera); requestAnimationFrame(loop);
}

// ------------------------------------------------------------------ modusbytte
document.getElementById('btnRace').onclick = () => {
  if (!renderer) buildStaticScene();
  buildTrack(routeNodes);
  bestKey = 'gateracer_best_' + waypoints.join('-');
  bestLap = localStorage.getItem(bestKey) ? Number(localStorage.getItem(bestKey)) : null; lastLap = null; lap = 1;
  document.getElementById('draw').style.display = 'none'; raceDiv.style.display = 'block';
  for (const id of ['btnRace', 'btnUndo', 'btnClear', 'btnDemo']) document.getElementById(id).style.display = 'none';
  document.getElementById('btnBack').style.display = ''; hint.textContent = 'Kjør! Piltaster eller WASD.';
  resizeRace(); resetCar(); racing = true; lastT = performance.now(); showMsg('GO!', 1000); requestAnimationFrame(loop);
};
document.getElementById('btnBack').onclick = () => {
  racing = false;
  raceDiv.style.display = 'none'; document.getElementById('draw').style.display = 'block';
  for (const id of ['btnRace', 'btnUndo', 'btnClear', 'btnDemo']) document.getElementById(id).style.display = '';
  document.getElementById('btnBack').style.display = 'none'; rebuildRoute(); resizeMap();
};

// ------------------------------------------------------------------ demo-løype (?demo=1) — brukes til testing og som eksempel
const qs = new URLSearchParams(location.search);
if (qs.get('demo')) {
  document.getElementById('btnDemo').click();
  if (!document.getElementById('btnRace').disabled) {
    document.getElementById('btnRace').click();
    if (qs.get('drive')) { keys['w'] = true; setTimeout(() => { keys['w'] = false; }, Number(qs.get('drive')) * 1000); }
  }
}
