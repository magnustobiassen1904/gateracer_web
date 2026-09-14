// intro.js — startsiden: velg sted i Norge, velg område (sirkel eller tegn selv), bygg kartet.
// Eksporterer obtainWorld() som app.js venter på, og AREA som beskriver hvilket kart som er lastet.
import { toUTM, fromUTM } from './utm.js';
import { Z, EXT, DRIVE, fetchTiles, geomParts, clipLine, props, tileX, tileY, gpxToLL, llToGpx } from './osmtiles.js';

const GEN_VERSION = 3;                       // må matche worldgen.js; øk når byggemetoden endres (tømmer lagrede kart)
const TYPE_RANK = { 'By': 0, 'Tettsted': 1, 'Bydel': 2, 'Tettsteddel': 3, 'Kommune': 4, 'Grend': 5, 'Adressenavn': 6, 'Adresse': 7 };
const qs = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);
const COARSE = matchMedia('(pointer: coarse)').matches || innerWidth < 900;
const MAX_SIDE = COARSE ? 3000 : 5000;       // største utstrekning i meter
const resFor = side => side <= 1250 ? 1 : side <= 2250 ? 1.5 : side <= 4250 ? 2 : 2.5;   // samme som worldgen.js

export let AREA = null;

// ------------------------------------------------------------------ område <-> lenke
function parseArea() {
  const by = qs.get('by') || 'Valgt område';
  const lat = parseFloat(qs.get('lat')), lon = parseFloat(qs.get('lon')), d = parseFloat(qs.get('d'));
  if (isFinite(lat) && isFinite(lon) && d >= 0.3 && d * 1000 <= 5000) return { lat, lon, name: by, shape: { type: 'circle', d: Math.round(d * 10) / 10 } };
  if (qs.get('poly')) {
    const pts = qs.get('poly').split(';').map(s => s.split(',').map(Number)).filter(p => p.length === 2 && p.every(isFinite));
    if (pts.length >= 3) { const c = centroidLL(pts); return { lat: c[0], lon: c[1], name: by, shape: { type: 'poly', pts } }; }
  }
  return null;
}
export function areaQuery(a = AREA) {
  if (!a || a.prebuilt) return '?map=kongsberg';
  const by = `by=${encodeURIComponent(a.name)}`;
  if (a.shape.type === 'circle') return `?lat=${a.lat.toFixed(5)}&lon=${a.lon.toFixed(5)}&d=${a.shape.d}&${by}`;
  return `?poly=${a.shape.pts.map(p => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join(';')}&${by}`;
}
function areaId(a) {
  if (a.shape.type === 'circle') return `c_${a.lat.toFixed(4)}_${a.lon.toFixed(4)}_${a.shape.d}`;
  let h = 0; for (const ch of a.shape.pts.map(p => p.map(v => v.toFixed(5)).join(',')).join(';')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return `p_${h.toString(36)}_${a.shape.pts.length}`;
}
function centroidLL(pts) { let la = 0, lo = 0; for (const p of pts) { la += p[0]; lo += p[1]; } return [la / pts.length, lo / pts.length]; }
// mål på området i meter: utstrekning (største side av omsluttende rektangel) og areal
function measure(lat, lon, shape) {
  if (shape.type === 'circle') { const R = shape.d * 500; return { side: 2 * R, area: Math.PI * R * R }; }
  const [E0, N0] = toUTM(lat, lon), xy = shape.pts.map(([la, lo]) => { const [e, n] = toUTM(la, lo); return [e - E0, n - N0]; });
  const xs = xy.map(p => p[0]), ys = xy.map(p => p[1]);
  let a = 0; for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) a += (xy[j][0] + xy[i][0]) * (xy[j][1] - xy[i][1]);
  return { side: Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)), area: Math.abs(a / 2) };
}
// anslått byggetid i sekunder. Kalibrert mot testbygg (1 km: 3 s, 4 km: 8 s på rask linje) med margin
// for vanlig hjemmenett (ca. 5 MB/s) og for å tegne byen i 3D etter at dataene er klare.
function estimate(lat, lon, shape) {
  const { side, area } = measure(lat, lon, shape), s = side + 60, r = resFor(side);
  const px = (s / r) ** 2, mb = px * 8 / 1e6;
  const tileW = 40075016 * Math.cos(lat * Math.PI / 180) / 2 ** 14, tiles = Math.ceil(s / tileW + 1) ** 2;
  const sec = 3 + mb / 5 + px / 1e6 * 0.6 + tiles * 0.08 + area / 1e6 * 1.2;
  return { sec: COARSE ? sec * 1.8 : sec, mb: Math.round(mb), side, area };
}
const fmtSec = s => s < 15 ? `ca. ${Math.max(5, Math.round(s / 5) * 5)} sek` : s < 90 ? `ca. ${Math.round(s / 5) * 5} sek` : `ca. ${Math.round(s / 60)} min`;
const fmtKm2 = a => a < 1e6 ? `${(a / 1e6).toFixed(2).replace('.', ',')} km²` : `${(a / 1e6).toFixed(1).replace('.', ',')} km²`;

// ------------------------------------------------------------------ inngang
export async function obtainWorld() {
  const fromUrl = parseArea();
  if (fromUrl) return loadGenerated(fromUrl);
  const legacy = ['demo', 'free', 'sim', 'garage', 'map'].some(k => qs.has(k)) || /[#&]t=/.test(location.hash);
  if (legacy) return loadPrebuilt();                 // gamle delte lenker og testlenker går til ferdigbygd Kongsberg
  const choice = await showIntro();
  if (choice.prebuilt) { history.replaceState(null, '', `${location.pathname}?map=kongsberg`); return loadPrebuilt(); }
  AREA = choice; history.replaceState(null, '', `${location.pathname}${areaQuery(choice)}`);
  return loadGenerated(choice);
}

async function loadPrebuilt() {
  AREA = { prebuilt: true, id: 'kongsberg', name: 'Kongsberg' };
  showLoading('Laster Kongsberg …', false);
  const world = await (await fetch('../data/world.json')).json();
  const TZ = new Uint16Array(await (await fetch('../data/' + world.terrain.bin)).arrayBuffer());
  const TC = new Uint8Array(await (await fetch('../data/' + world.terrain.cls)).arrayBuffer());
  hideLoading();
  return { world, TZ, TC };
}

async function loadGenerated(a) {
  AREA = { prebuilt: false, id: areaId(a), name: a.name, lat: a.lat, lon: a.lon, shape: a.shape };
  document.title = `Gateracer — ${a.name}`;
  const key = `v${GEN_VERSION}:${AREA.id}`;
  showLoading(`Laster ${a.name} …`, false);
  const cached = await idbGet(key);
  if (cached && cached.world && cached.tz && cached.tc) {
    rememberRecent(key, AREA);
    return { world: cached.world, TZ: new Uint16Array(cached.tz), TC: new Uint8Array(cached.tc) };
  }
  const est = estimate(a.lat, a.lon, a.shape);
  showLoading(`Bygger ${a.name}`, true, est.sec);
  const res = await new Promise((resolve, reject) => {
    const w = new Worker(new URL('./worldgen.js', import.meta.url), { type: 'module' });
    w.onmessage = ev => {
      const m = ev.data;
      if (m.type === 'progress') setProgress(m.step, m.frac, m.text);
      else if (m.type === 'done') { w.terminate(); resolve(m); }
      else if (m.type === 'error') { w.terminate(); reject(new Error(m.message)); }
    };
    w.onerror = e => { w.terminate(); reject(new Error(e.message || 'Kartbyggeren krasjet')); };
    w.postMessage({ lat: a.lat, lon: a.lon, shape: a.shape, name: a.name });
  }).catch(err => { showError(err.message); return new Promise(() => {}); });   // feilskjermen tar over, spillet starter ikke
  setProgress(4, 0.6, 'Lagrer kartet i nettleseren så det åpner med en gang neste gang');
  await idbPut(key, { world: res.world, tz: res.tz, tc: res.tc });
  rememberRecent(key, AREA);
  setProgress(4, 0.85, 'Tegner byen i 3D');
  if (!res.world.lidar) await sleep(1800);            // la spilleren se beskjeden om gjettede høyder
  return { world: res.world, TZ: new Uint16Array(res.tz), TC: new Uint8Array(res.tc) };
}
export function worldReady() { stopClock(); hideLoading(); }   // kalles av app.js når 3D-scenen er klar

// ------------------------------------------------------------------ fremdrift
const STEPS = ['Kartdata fra OpenStreetMap', 'Laserdata fra Kartverket', 'Hushøyder', 'Trær og terreng', 'Setter sammen og tegner'];
const WEIGHT = [0.12, 0.5, 0.12, 0.13, 0.13];
let clock = 0, t0 = 0, estSec = 0, frac = 0;
function showLoading(title, withSteps, est) {
  $('loading').style.display = 'flex';
  $('lTitle').textContent = title;
  $('lSteps').innerHTML = withSteps ? STEPS.map((s, i) => `<li data-i="${i}">${s}</li>`).join('') : '';
  $('lBarWrap').hidden = !withSteps; $('lText').textContent = ''; $('lErr').hidden = true; $('lTime').textContent = '';
  if (withSteps) {
    t0 = performance.now(); estSec = est || 20; frac = 0; setProgress(0, 0, 'Starter');
    stopClock(); clock = setInterval(paintTime, 500); paintTime();
  }
}
function paintTime() {
  const el = (performance.now() - t0) / 1000;
  // gjenstående tid: anslaget i starten, deretter faktisk tempo når vi har kommet et stykke
  const left = frac > 0.15 ? el * (1 - frac) / frac : Math.max(1, estSec - el);
  $('lTime').textContent = `${Math.round(el)} sek brukt · ${left < 3 ? 'nesten ferdig' : `${fmtSec(left)} igjen`}`;
}
function stopClock() { if (clock) clearInterval(clock); clock = 0; }
function setProgress(step, f, text) {
  let tot = 0; for (let i = 0; i < step; i++) tot += WEIGHT[i];
  tot += WEIGHT[step] * Math.max(0, Math.min(1, f)); frac = tot;
  $('lBar').style.width = `${Math.round(tot * 100)}%`;
  $('lText').textContent = text || '';
  $('lSteps').querySelectorAll('li').forEach(li => { const i = Number(li.dataset.i); li.className = i < step || (i === step && f >= 1) ? 'done' : i === step ? 'now' : ''; });
}
function hideLoading() { $('loading').style.display = 'none'; }
function showError(msg) {
  stopClock();
  $('lErr').hidden = false; $('lErrMsg').textContent = msg;
  $('lRetry').onclick = () => location.reload();
  $('lBack').onclick = () => { location.href = location.pathname; };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ------------------------------------------------------------------ lagrede kart (IndexedDB)
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('gateracer', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('worlds');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbGet(key) {
  try { const db = await idb(); return await new Promise(res => { const q = db.transaction('worlds').objectStore('worlds').get(key); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); }
  catch { return null; }
}
async function idbPut(key, val) {
  try { const db = await idb(); await new Promise(res => { const t = db.transaction('worlds', 'readwrite'); t.objectStore('worlds').put(val, key); t.oncomplete = res; t.onerror = res; t.onabort = res; }); }
  catch { /* privat fane eller fullt lager: spillet virker likt, bare uten mellomlagring */ }
}
async function idbDelete(key) {
  try { const db = await idb(); await new Promise(res => { const t = db.transaction('worlds', 'readwrite'); t.objectStore('worlds').delete(key); t.oncomplete = res; t.onerror = res; }); } catch {}
}
function readRecent() { try { return JSON.parse(localStorage.getItem('gateracer_recent') || '[]').filter(r => r.q); } catch { return []; } }
function rememberRecent(key, a) {
  const m = measure(a.lat, a.lon, a.shape);
  let list = readRecent().filter(r => r.key !== key);
  let bb;
  if (a.shape.type === 'circle') { const [E, N] = toUTM(a.lat, a.lon), R = a.shape.d * 500, p = fromUTM(E - R, N - R), q = fromUTM(E + R, N + R); bb = [p[0], p[1], q[0], q[1]]; }
  else { const la = a.shape.pts.map(p => p[0]), lo = a.shape.pts.map(p => p[1]); bb = [Math.min(...la), Math.min(...lo), Math.max(...la), Math.max(...lo)]; }
  list.unshift({ key, q: areaQuery(a), name: a.name, center: [a.lat, a.lon], bb, size: a.shape.type === 'circle' ? `sirkel ${String(a.shape.d).replace('.', ',')} km` : `område ${fmtKm2(m.area)}`, ts: Date.now() });
  const drop = list.slice(8); list = list.slice(0, 8);
  drop.forEach(r => idbDelete(r.key));
  try { localStorage.setItem('gateracer_recent', JSON.stringify(list)); } catch {}
}

// ------------------------------------------------------------------ introsiden
function showIntro() {
  hideLoading();
  $('intro').hidden = false;
  return new Promise(() => {                         // «Kjør» navigerer til spillet, så løftet trenger aldri å innfris
    const map = L.map('introMap', { zoomControl: false, minZoom: 4, maxZoom: 18, maxBounds: [[54, -8], [74, 40]], doubleClickZoom: false });
    if (!COARSE) L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://cache.kartverket.no/v1/wmts/1.0.0/topograatone/default/webmercator/{z}/{y}/{x}.png',
      { maxZoom: 18, attribution: '© <a href="https://www.kartverket.no/" target="_blank" rel="noopener">Kartverket</a>' }).addTo(map);
    const PADS = COARSE ? { paddingTopLeft: [20, 20], paddingBottomRight: [20, Math.round(innerHeight * 0.6)] } : { paddingTopLeft: [420, 60], paddingBottomRight: [60, 60] };
    const renderer = L.canvas({ padding: 0.3 });

    // ---------------- tilstand
    let mode = 'track', loop = true, wps = [], route = [], routeLen = 0, name = 'Min løype', center = null, d = 2;
    const layers = { route: null, marks: [], circle: null, roads: null };

    // ---------------- veinett fra OpenStreetMap-fliser, hentes mens man zoomer
    const net = { tiles: new Map(), nodes: new Map(), grid: new Map(), pending: 0 };
    const GC = 1024;                                                  // rutenettcelle i globale flispiksler
    const mPerGpx = lat => 40075016 * Math.cos(lat * Math.PI / 180) / (EXT * 2 ** Z);
    function addNode(gx, gy) {
      const k = `${gx},${gy}`; let n = net.nodes.get(k);
      if (!n) { const [lat, lon] = gpxToLL(gx, gy); n = { k, gx, gy, lat, lon, adj: [] }; net.nodes.set(k, n); const c = `${Math.floor(gx / GC)},${Math.floor(gy / GC)}`; (net.grid.get(c) || net.grid.set(c, []).get(c)).push(n); }
      return n;
    }
    function ingest(tx, ty, layers) {
      const S = layers.streets; if (!S) return;
      const sc = EXT / S.extent;
      for (const F of S.feats) {
        if (F.type !== 2) continue;
        const pr = props(S, F); if (pr.tunnel || pr.rail || !DRIVE[pr.kind]) continue;
        for (const line of geomParts(F.geom)) for (const run of clipLine(line, 0, S.extent)) {
          let prev = null;
          for (const [px, py] of run) {
            const n = addNode(tx * EXT + Math.round(px * sc), ty * EXT + Math.round(py * sc));
            if (prev && prev !== n) { const len = Math.hypot(n.gx - prev.gx, n.gy - prev.gy) * mPerGpx(n.lat); prev.adj.push([n, len]); n.adj.push([prev, len]); }
            prev = n;
          }
        }
      }
    }
    async function loadTiles() {
      if (mode !== 'track' || map.getZoom() < 13) { paintInfo(); return; }
      const b = map.getBounds(), x0 = tileX(b.getWest()), x1 = tileX(b.getEast()), y0 = tileY(b.getNorth()), y1 = tileY(b.getSouth());
      const want = [];
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (!net.tiles.has(`${tx}/${ty}`)) want.push([tx, ty]);
      if (!want.length || want.length > 40) { paintInfo(); return; }
      want.forEach(([tx, ty]) => net.tiles.set(`${tx}/${ty}`, 'loading'));
      net.pending += want.length; paintInfo();
      try {
        const data = await fetchTiles(want, () => {});
        want.forEach(([tx, ty], i) => { ingest(tx, ty, data[i] || {}); net.tiles.set(`${tx}/${ty}`, 'done'); });
      } catch { want.forEach(([tx, ty]) => net.tiles.delete(`${tx}/${ty}`)); }
      net.pending -= want.length;
      for (const w of wps) if (w.want && !w.node) snapWp(w, 6);      // punkter satt før veiene var lastet
      recompute();
    }
    function nearestNode(lat, lon, maxM) {
      const [gx, gy] = llToGpx(lat, lon), per = mPerGpx(lat), r = Math.ceil(maxM / per / GC);
      let best = null, bd = maxM / per;
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) for (const n of net.grid.get(`${Math.floor(gx / GC) + i},${Math.floor(gy / GC) + j}`) || []) {
        const dd = Math.hypot(n.gx - gx, n.gy - gy); if (dd < bd && n.adj.length) { bd = dd; best = n; }
      }
      return best;
    }
    function snapWp(w, maxM) { const n = nearestNode(w.lat, w.lon, maxM); if (n) { w.node = n; w.lat = n.lat; w.lon = n.lon; } }
    function dijkstra(a, b) {
      if (a === b) return [a];
      const dist = new Map([[a, 0]]), prev = new Map(), heap = [[0, a]], done = new Set();
      const push = it => { heap.push(it); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
      const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
      while (heap.length && done.size < 300000) {
        const [dd, u] = pop(); if (done.has(u)) continue; done.add(u);
        if (u === b) break;
        for (const [v, w] of u.adj) { const nd = dd + w; if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); push([nd, v]); } }
      }
      if (!dist.has(b)) return null;
      const path = [b]; let u = b; while (u !== a) { u = prev.get(u); path.push(u); }
      return path.reverse();
    }
    const meters = (a, b) => Math.hypot((b[0] - a[0]) * 111320, (b[1] - a[1]) * 111320 * Math.cos(a[0] * Math.PI / 180));
    function recompute() {
      route = []; routeLen = 0;
      const m = loop ? wps.length : wps.length - 1;
      if (wps.length >= 2) for (let i = 0; i < m; i++) {
        const a = wps[i], b = wps[(i + 1) % wps.length];
        const p = a.node && b.node ? dijkstra(a.node, b.node) : null;
        const seg = p ? p.map(n => [n.lat, n.lon]) : [[a.lat, a.lon], [b.lat, b.lon]];   // ingen vei mellom? rett linje
        route.push(...(route.length ? seg.slice(1) : seg));
      }
      for (let i = 1; i < route.length; i++) routeLen += meters(route[i - 1], route[i]);
      redraw();
    }

    // ---------------- tegning på kartet
    function redraw() {
      for (const l of [layers.route, layers.circle, ...layers.marks]) if (l) map.removeLayer(l);
      layers.route = layers.circle = null; layers.marks = [];
      if (mode === 'track') {
        if (route.length >= 2) layers.route = L.polyline(route, { color: '#e0333a', weight: 6, opacity: 0.95, lineJoin: 'round', renderer, interactive: false }).addTo(map);
        wps.forEach((w, i) => {
          const col = i === 0 ? '#3ad66a' : (!loop && i === wps.length - 1 ? '#ffd14a' : (w.node ? '#ffffff' : '#7fd4ff'));
          layers.marks.push(L.circleMarker([w.lat, w.lon], { radius: i === 0 ? 8 : 6, color: '#0f1220', weight: 2, fillColor: col, fillOpacity: 1, renderer, interactive: false }).addTo(map));
        });
      } else if (center) {
        const [E, N] = toUTM(center[0], center[1]), R = d * 500;
        layers.circle = L.polygon(Array.from({ length: 72 }, (_, k) => fromUTM(E + R * Math.cos(k / 36 * Math.PI), N + R * Math.sin(k / 36 * Math.PI))),
          { color: '#e0333a', weight: 3, fillColor: '#e0333a', fillOpacity: 0.12, renderer, interactive: false }).addTo(map);
      }
      paintInfo();
    }
    // området som bygges rundt løypa: omsluttende rektangel + 200 m margin, i Kartverkets rutenett
    function trackArea() {
      if (route.length < 2) return null;
      const lats = route.map(p => p[0]), lons = route.map(p => p[1]);
      const c = [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lons) + Math.max(...lons)) / 2], [E0, N0] = toUTM(c[0], c[1]);
      const xy = route.map(([la, lo]) => { const [e, n] = toUTM(la, lo); return [e - E0, n - N0]; });
      const M = 200, x0 = Math.min(...xy.map(p => p[0])) - M, x1 = Math.max(...xy.map(p => p[0])) + M, y0 = Math.min(...xy.map(p => p[1])) - M, y1 = Math.max(...xy.map(p => p[1])) + M;
      const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => fromUTM(E0 + x, N0 + y).map(v => +v.toFixed(5)));
      return { lat: centroidLL(pts)[0], lon: centroidLL(pts)[1], shape: { type: 'poly', pts }, bb: [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)] };
    }
    function paintInfo() {
      $('tabTrack').classList.toggle('active', mode === 'track'); $('tabFree').classList.toggle('active', mode === 'free');
      $('trackBox').hidden = mode !== 'track'; $('freeBox').hidden = mode !== 'free';
      $('chipLoop').classList.toggle('active', loop); $('chipSprint').classList.toggle('active', !loop);
      $('dVal').textContent = `${String(d).replace('.', ',')} km`;
      const z = map.getZoom();
      let ok = false;
      if (mode === 'track') {
        const unsnapped = wps.filter(w => !w.node).length;
        $('trackInfo').innerHTML = z < 13 && wps.length === 0 ? 'Søk opp et sted eller <b>zoom inn</b> på kartet, og klikk på gatene for å tegne løypa.'
          : wps.length === 0 ? (net.pending ? 'Henter gatene …' : 'Klikk på gatene der løypa skal gå. Den følger veiene av seg selv.')
          : `${loop ? 'Sløyfe' : 'Sprint'} · <b>${(routeLen / 1000).toFixed(2).replace('.', ',')} km</b> · ${wps.length} punkter${unsnapped ? ` · ${unsnapped} utenfor vei (rett linje)` : ''}${net.pending ? ' · henter gater …' : ''}`;
        const a = trackArea();
        if (a && routeLen >= 150) {
          const reuse = findArea(a.bb), e = estimate(a.lat, a.lon, a.shape);
          if (e.side > MAX_SIDE) $('estimate').innerHTML = `<b class="warn">For stor løype.</b> Den må få plass innenfor ${MAX_SIDE / 1000} × ${MAX_SIDE / 1000} km${COARSE ? ' på mobil' : ''}.`;
          else { $('estimate').innerHTML = reuse ? 'Området er bygget fra før · <b>starter med en gang</b>' : `Bygger ${fmtKm2(e.side * e.side)} rundt løypa · <b>${fmtSec(e.sec)}</b>`; ok = true; }
        } else $('estimate').textContent = wps.length ? 'Legg til flere punkter (minst 150 m løype).' : '';
        $('btnGo').disabled = !ok; $('btnGo').textContent = 'Kjør!';
      } else {
        $('freeInfo').textContent = center ? name : 'Søk eller klikk på kartet for å velge hvor du vil kjøre.';
        if (center) { const e = estimate(center[0], center[1], { type: 'circle', d }), reuse = findArea(circleBB(center, d)); $('estimate').innerHTML = reuse ? 'Området er bygget fra før · <b>starter med en gang</b>' : `${fmtKm2(e.area)} · <b>${fmtSec(e.sec)}</b>`; ok = true; }
        else $('estimate').textContent = '';
        $('btnGo').disabled = !ok; $('btnGo').textContent = 'Kjør fritt';
      }
    }
    const circleBB = (c, dk) => { const [E, N] = toUTM(c[0], c[1]), R = dk * 500, a = fromUTM(E - R, N - R), b = fromUTM(E + R, N + R); return [a[0], a[1], b[0], b[1]]; };
    // gjenbruk et lagret område hvis løypa (med 80 m margin) får plass i det
    function findArea(bb) {
      const mLat = 80 / 111320, mLon = 80 / (111320 * Math.cos(bb[0] * Math.PI / 180));
      const fits = readRecent().filter(r => r.bb && r.bb[0] <= bb[0] - mLat && r.bb[1] <= bb[1] - mLon && r.bb[2] >= bb[2] + mLat && r.bb[3] >= bb[3] + mLon);
      fits.sort((p, q) => (p.bb[2] - p.bb[0]) * (p.bb[3] - p.bb[1]) - (q.bb[2] - q.bb[0]) * (q.bb[3] - q.bb[1]));
      return fits[0] || null;
    }
    async function nameAt(lat, lon) {
      try {
        const dd = await (await fetch(`https://ws.geonorge.no/adresser/v1/punktsok?lat=${lat}&lon=${lon}&radius=1500&treffPerSide=1&utkoordsys=4258`)).json();
        const a = (dd.adresser || [])[0]; if (!a) return null;
        return titleCase(a.kommunenavn || a.poststed || '') || null;
      } catch { return null; }
    }

    // ---------------- handlinger
    $('tabTrack').onclick = () => { mode = 'track'; redraw(); loadTiles(); };
    $('tabFree').onclick = () => { mode = 'free'; if (!center) { const c = map.getCenter(); if (map.getZoom() >= 11) center = [c.lat, c.lng]; } redraw(); };
    $('chipLoop').onclick = () => { loop = true; recompute(); };
    $('chipSprint').onclick = () => { loop = false; recompute(); };
    $('btnUndoPt').onclick = () => { wps.pop(); recompute(); };
    $('btnClearPts').onclick = () => { wps = []; recompute(); };
    const slider = $('dSlider'); slider.max = String(MAX_SIDE / 1000); slider.value = String(d);
    slider.oninput = () => { d = Math.round(Number(slider.value) * 10) / 10; redraw(); };

    map.on('moveend', loadTiles);
    window.__intro = { map, net, get wps() { return wps; }, get routeLen() { return routeLen; } };   // testhåndtak
    map.on('click', async e => {
      const lat = e.latlng.lat, lon = e.latlng.lng;
      if (mode === 'free') { center = [lat, lon]; name = 'Valgt område'; redraw(); const n = await nameAt(lat, lon); if (n) { name = n; paintInfo(); } return; }
      if (map.getZoom() < 13) { map.flyTo(e.latlng, 15, { duration: 0.6 }); return; }
      const tol = 26 * 40075016 * Math.cos(lat * Math.PI / 180) / (256 * 2 ** map.getZoom());   // ca. 26 skjermpiksler
      const w = { lat, lon, node: null, want: true };
      snapWp(w, Math.max(8, tol));
      const last = wps[wps.length - 1];
      if (last && last.node && last.node === w.node) return;
      wps.push(w); recompute();
      if (wps.length === 1 || name === 'Min løype') { const n = await nameAt(lat, lon); if (n) { name = `Løype i ${n}`; } }
    });

    $('btnGo').onclick = () => {
      if (mode === 'free') {
        if (!center) return;
        const reuse = findArea(circleBB(center, d));
        const q = reuse ? reuse.q : areaQuery({ lat: center[0], lon: center[1], name, shape: { type: 'circle', d: Math.max(0.5, d) } });
        location.assign(location.pathname + q + '#go=free');
        return;
      }
      const a = trackArea(); if (!a) return;
      const reuse = findArea(a.bb);
      const areaQ = reuse ? reuse.q : areaQuery({ lat: a.lat, lon: a.lon, name, shape: a.shape });
      const origin = reuse ? reuse.center : [a.lat, a.lon], [E0, N0] = toUTM(origin[0], origin[1]);
      const t = wps.map(w => { const [e, n] = toUTM(w.lat, w.lon); return `${Math.round(e - E0)}.${Math.round(n - N0)}`; }).join('_');
      const hash = `#t=${loop ? 'L' : 'S'}${t}&n=${encodeURIComponent(name)}&go=1`;
      rememberTrack({ name, q: areaQ, hash, len: routeLen, loop });
      history.replaceState(null, '', location.pathname + editHash());     // «tilbake» i nettleseren gir løypa igjen
      location.assign(location.pathname + areaQ + hash);
    };
    const editHash = () => `#edit=${loop ? 'L' : 'S'};${wps.map(w => `${w.lat.toFixed(6)},${w.lon.toFixed(6)},${w.node ? 1 : 0}`).join(';')}`;

    // ---------------- søk
    const input = $('q'), list = $('qRes');
    let seq = 0, timer = 0, results = [];
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 250); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && results[0]) { e.preventDefault(); choose(results[0]); } if (e.key === 'Escape') list.hidden = true; });
    async function search() {
      const s = input.value.trim(), my = ++seq;
      if (s.length < 2) { list.hidden = true; return; }
      const enc = encodeURIComponent(s), get = url => fetch(url).then(r => r.ok ? r.json() : {}).catch(() => ({}));
      const [pref, byer, adr] = await Promise.all([
        get(`https://ws.geonorge.no/stedsnavn/v1/sted?sok=${enc}*&treffPerSide=12&utkoordsys=4258`),
        get(`https://ws.geonorge.no/stedsnavn/v1/sted?sok=${enc}&fuzzy=true&navneobjekttype=by&treffPerSide=3&utkoordsys=4258`),
        s.length >= 4 ? get(`https://ws.geonorge.no/adresser/v1/sok?sok=${enc}&treffPerSide=4&utkoordsys=4258`) : {},
      ]);
      if (my !== seq) return;
      const out = [], seen = new Set();
      for (const n of [...(byer.navn || []), ...(pref.navn || [])]) {
        const nm = (n.stedsnavn || [])[0]?.skrivemåte, rp = n.representasjonspunkt; if (!nm || !rp) continue;
        const kom = (n.kommuner || [])[0]?.kommunenavn || '', k = `${nm}|${kom}|${n.navneobjekttype}`;
        if (seen.has(k)) continue; seen.add(k);
        out.push({ name: nm, sub: [n.navneobjekttype, kom].filter(Boolean).join(' · '), lat: rp.nord, lon: rp.øst, rank: TYPE_RANK[n.navneobjekttype] ?? 20 });
      }
      for (const a of adr.adresser || []) { const rp = a.representasjonspunkt; if (rp) out.push({ name: a.adressetekst, sub: `Adresse · ${titleCase(a.poststed || a.kommunenavn || '')}`, lat: rp.lat, lon: rp.lon, rank: 7 }); }
      out.sort((p, q) => p.rank - q.rank);
      results = out.slice(0, 8);
      list.innerHTML = results.length ? '' : '<li class="none">Fant ingenting</li>';
      results.forEach(r => { const li = document.createElement('li'); li.innerHTML = '<b></b><span></span>'; li.firstChild.textContent = r.name; li.lastChild.textContent = r.sub; li.onclick = () => choose(r); list.appendChild(li); });
      list.hidden = false;
    }
    function choose(r) {
      list.hidden = true; input.value = r.name;
      if (mode === 'free') { center = [r.lat, r.lon]; name = r.name; redraw(); map.flyToBounds(layers.circle.getBounds(), { ...PADS, maxZoom: 16, duration: 0.8 }); }
      else { if (!wps.length) name = `Løype i ${r.name}`; map.flyTo([r.lat, r.lon], 16, { duration: 0.8 }); }
    }

    // ---------------- lagrede løyper
    const tracks = readTracks();
    if (tracks.length) {
      $('recent').innerHTML = '<div class="label">Dine løyper</div>';
      for (const r of tracks) {
        const b = document.createElement('button'); b.className = 'recent';
        b.innerHTML = '<b></b><span></span>'; b.firstChild.textContent = r.name; b.lastChild.textContent = `${r.loop ? 'Sløyfe' : 'Sprint'} · ${(r.len / 1000).toFixed(1).replace('.', ',')} km`;
        b.onclick = () => location.assign(location.pathname + r.q + r.hash);
        $('recent').appendChild(b);
      }
    }

    // ---------------- start: redigere en løype fra spillet, eller vise hele Norge
    const edit = location.hash.match(/edit=([LS]);?([^&]*)/);
    const cMatch = location.hash.match(/[#&]c=([\d.]+),([\d.]+)/);
    if (edit) {
      loop = edit[1] === 'L';
      wps = edit[2].split(';').filter(Boolean).map(s => { const [la, lo, sn] = s.split(',').map(Number); return { lat: la, lon: lo, node: null, want: sn === 1 }; });
    }
    if (wps.length) map.fitBounds(L.latLngBounds(wps.map(w => [w.lat, w.lon])).pad(0.25), { ...PADS, maxZoom: 16 });
    else if (cMatch) map.setView([+cMatch[1], +cMatch[2]], 15);
    else map.fitBounds([[57.8, 4.5], [71.2, 31.2]], COARSE ? { paddingBottomRight: [0, Math.round(innerHeight * 0.55)] } : { paddingTopLeft: [400, 20], paddingBottomRight: [20, 20] });
    recompute();
    setTimeout(() => { map.invalidateSize(); loadTiles(); }, 60);
    if (!COARSE && !wps.length) input.focus();
  });
}
function readTracks() { try { return JSON.parse(localStorage.getItem('gateracer_tracks_ll') || '[]'); } catch { return []; } }
function rememberTrack(t) {
  const list = [{ ...t, ts: Date.now() }, ...readTracks().filter(r => r.hash !== t.hash || r.q !== t.q)].slice(0, 8);
  try { localStorage.setItem('gateracer_tracks_ll', JSON.stringify(list)); } catch {}
}
function titleCase(s) { return s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()); }
