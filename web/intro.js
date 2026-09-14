// intro.js — startsiden: velg sted i Norge, velg område (sirkel eller tegn selv), bygg kartet.
// Eksporterer obtainWorld() som app.js venter på, og AREA som beskriver hvilket kart som er lastet.
import { toUTM, fromUTM } from './utm.js';

const GEN_VERSION = 2;                       // må matche worldgen.js; øk når byggemetoden endres (tømmer lagrede kart)
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
    rememberRecent(key, AREA); hideLoading();
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
  list.unshift({ key, q: areaQuery(a), name: a.name, size: a.shape.type === 'circle' ? `sirkel ${String(a.shape.d).replace('.', ',')} km` : `tegnet område, ${fmtKm2(m.area)}`, ts: Date.now() });
  const drop = list.slice(5); list = list.slice(0, 5);
  drop.forEach(r => idbDelete(r.key));
  try { localStorage.setItem('gateracer_recent', JSON.stringify(list)); } catch {}
}

// ------------------------------------------------------------------ introsiden
function showIntro() {
  hideLoading();
  $('intro').hidden = false;
  return new Promise(resolve => {
    let center = null, mode = 'circle', d = 2, pts = [];
    const names = { circle: 'Valgt område', draw: 'Valgt område' };   // hver modus har sitt eget stedsnavn
    const layers = { shape: null, marker: null, verts: [] };
    const map = L.map('introMap', { zoomControl: false, minZoom: 4, maxZoom: 18, maxBounds: [[54, -8], [74, 40]], doubleClickZoom: false });
    if (!COARSE) L.control.zoom({ position: 'bottomright' }).addTo(map);
    map.fitBounds([[57.8, 4.5], [71.2, 31.2]], COARSE ? { paddingBottomRight: [0, Math.round(innerHeight * 0.55)] } : { paddingTopLeft: [400, 20], paddingBottomRight: [20, 20] });
    L.tileLayer('https://cache.kartverket.no/v1/wmts/1.0.0/topograatone/default/webmercator/{z}/{y}/{x}.png',
      { maxZoom: 18, attribution: '© <a href="https://www.kartverket.no/" target="_blank" rel="noopener">Kartverket</a>' }).addTo(map);
    const fly = bounds => map.flyToBounds(bounds, COARSE ? { paddingTopLeft: [20, 20], paddingBottomRight: [20, Math.round(innerHeight * 0.6)], maxZoom: 16, duration: 0.8 } : { paddingTopLeft: [420, 60], paddingBottomRight: [60, 60], maxZoom: 16, duration: 0.8 });

    const currentShape = () => mode === 'circle' ? (center ? { type: 'circle', d } : null) : (pts.length >= 3 ? { type: 'poly', pts: pts.map(p => [p[0], p[1]]) } : null);
    const shapeCenter = () => mode === 'circle' ? center : (pts.length >= 3 ? centroidLL(pts) : null);

    function redraw() {
      for (const l of [layers.shape, layers.marker, ...layers.verts]) if (l) map.removeLayer(l);
      layers.shape = layers.marker = null; layers.verts = [];
      const style = { color: '#e0333a', weight: 3, fillColor: '#e0333a', fillOpacity: 0.12, interactive: false };
      if (mode === 'circle' && center) {
        const [E, N] = toUTM(center[0], center[1]), R = d * 500;
        const ring = Array.from({ length: 72 }, (_, k) => fromUTM(E + R * Math.cos(k / 72 * 2 * Math.PI), N + R * Math.sin(k / 72 * 2 * Math.PI)));
        layers.shape = L.polygon(ring, style).addTo(map);
        layers.marker = L.circleMarker(center, { radius: 5, color: '#fff', weight: 2, fillColor: '#e0333a', fillOpacity: 1, interactive: false }).addTo(map);
      } else if (mode === 'draw' && pts.length) {
        layers.shape = (pts.length >= 3 ? L.polygon(pts, style) : L.polyline(pts, { ...style, dashArray: '6 6' })).addTo(map);
        layers.verts = pts.map((p, i) => L.circleMarker(p, { radius: i === 0 ? 7 : 5, color: '#fff', weight: 2, fillColor: i === 0 ? '#3ad66a' : '#e0333a', fillOpacity: 1, interactive: false }).addTo(map));
      }
      paintInfo();
    }
    function paintInfo() {
      $('tabCircle').classList.toggle('active', mode === 'circle'); $('tabDraw').classList.toggle('active', mode === 'draw');
      $('circleBox').hidden = mode !== 'circle'; $('drawBox').hidden = mode !== 'draw';
      $('dVal').textContent = `${String(d).replace('.', ',')} km`;
      const shape = currentShape(), c = shapeCenter();
      const name = names[mode];
      $('pickName').textContent = c ? name : 'Ingen sted valgt';
      $('pickSub').textContent = c ? `${c[0].toFixed(4)}° N, ${c[1].toFixed(4)}° Ø` : (mode === 'circle' ? 'Søk eller klikk på kartet' : 'Klikk minst tre punkter på kartet');
      $('pick').classList.toggle('on', !!c);
      $('drawInfo').textContent = pts.length === 0 ? 'Klikk på kartet for å sette hjørner rundt området du vil kjøre i.' : pts.length < 3 ? `${pts.length} punkt${pts.length > 1 ? 'er' : ''}. Legg til minst ${3 - pts.length} til.` : `${pts.length} punkter.`;
      let ok = false;
      if (shape && c) {
        const e = estimate(c[0], c[1], shape), tooBig = e.side > MAX_SIDE, tooSmall = e.area < 50000;
        $('estimate').innerHTML = tooBig
          ? `<b class="warn">For stort.</b> Området er ${(e.side / 1000).toFixed(1).replace('.', ',')} km på det bredeste. Maks er ${MAX_SIDE / 1000} km${COARSE ? ' på mobil' : ''}.`
          : tooSmall ? '<b class="warn">For lite.</b> Gjør området litt større.'
          : `<b>${fmtKm2(e.area)}</b> · ${e.mb} MB laserdata · byggetid <b>${fmtSec(e.sec)}</b>`;
        ok = !tooBig && !tooSmall;
      } else $('estimate').textContent = '';
      $('btnBuild').disabled = !ok;
      $('btnBuild').textContent = ok ? `Bygg ${name}` : 'Bygg kart';
    }
    async function nameAt(lat, lon) {
      try {
        const dd = await (await fetch(`https://ws.geonorge.no/adresser/v1/punktsok?lat=${lat}&lon=${lon}&radius=1500&treffPerSide=1&utkoordsys=4258`)).json();
        const a = (dd.adresser || [])[0]; if (!a) return null;
        const kom = titleCase(a.kommunenavn || '');
        return kom && a.adressenavn ? `${a.adressenavn}, ${kom}` : (kom || a.adressenavn);
      } catch { return null; }
    }

    // sirkel / tegn selv
    $('tabCircle').onclick = () => { mode = 'circle'; if (!center && pts.length >= 3) { center = centroidLL(pts); names.circle = names.draw; } redraw(); };
    $('tabDraw').onclick = () => { mode = 'draw'; redraw(); };
    const slider = $('dSlider'); slider.max = String(MAX_SIDE / 1000); slider.value = String(d);
    slider.oninput = () => { d = Math.round(Number(slider.value) * 10) / 10; redraw(); };
    $('btnUndoPt').onclick = () => { pts.pop(); redraw(); };
    $('btnClearPts').onclick = () => { pts = []; redraw(); };

    map.on('click', async e => {
      const lat = e.latlng.lat, lon = e.latlng.lng;
      if (mode === 'circle') {
        center = [lat, lon]; names.circle = 'Valgt område'; redraw();
        const n = await nameAt(lat, lon); if (n && center && center[0] === lat) { names.circle = n; paintInfo(); }
      } else {
        pts.push([lat, lon]); redraw();
        if (pts.length === 3 || (pts.length > 3 && names.draw === 'Valgt område')) { const c = centroidLL(pts), n = await nameAt(c[0], c[1]); if (n) { names.draw = n; paintInfo(); } }
      }
    });

    // søk
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
      list.hidden = true; input.value = r.name; names.circle = r.name; if (pts.length < 3) names.draw = r.name;
      if (mode === 'circle') { center = [r.lat, r.lon]; redraw(); fly(layers.shape.getBounds()); }
      else { map.flyTo([r.lat, r.lon], 15, { duration: 0.8 }); paintInfo(); }
    }

    // nylig bygde kart
    const recent = readRecent();
    if (recent.length) {
      $('recent').innerHTML = '<div class="label">Dine kart</div>';
      for (const r of recent) {
        const b = document.createElement('button'); b.className = 'recent';
        b.innerHTML = '<b></b><span></span>'; b.firstChild.textContent = r.name; b.lastChild.textContent = `${r.size} · åpner med en gang`;
        b.onclick = () => { location.href = location.pathname + r.q; };
        $('recent').appendChild(b);
      }
    }

    $('btnBuild').onclick = () => {
      const shape = currentShape(), c = shapeCenter(); if (!shape || !c) return;
      $('intro').hidden = true; map.remove();
      resolve({ lat: c[0], lon: c[1], name: names[mode], shape });
    };
    $('btnKongsberg').onclick = () => { $('intro').hidden = true; map.remove(); resolve({ prebuilt: true }); };
    redraw();
    setTimeout(() => map.invalidateSize(), 50);
    if (!COARSE) input.focus();
  });
}
function titleCase(s) { return s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()); }
