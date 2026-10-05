// atmosphere.js — himmel, klokkeslett, vær og sikt (render distance).
// Himmelen er én skjermkuppel med egen shader: fargeovergang, sol/måne, skyer, stjerner og nordlys.
// Lys og tåke følger solhøyden, så soloppgang, solnedgang og natt får riktig stemning også på bakken.
// Regn og snø er partikler som følger kameraet.
import * as THREE from 'three';

export const DISTANCES = [
  { id: 'kort', name: 'Kort', km: 1.6 },
  { id: 'middels', name: 'Middels', km: 9 },
  { id: 'lang', name: 'Lang', km: 22 },
  { id: 'ekstrem', name: 'Ekstrem', km: 45 },
];
export const WEATHERS = [
  { id: 'klart', name: 'Klart', cloud: 0.04, dark: 0, vis: Infinity, precip: null },          // vis = sikt i meter
  { id: 'lettskyet', name: 'Lettskyet', cloud: 0.42, dark: 0.05, vis: Infinity, precip: null },
  { id: 'overskyet', name: 'Overskyet', cloud: 0.92, dark: 0.45, vis: 16000, precip: null },
  { id: 'regn', name: 'Regn', cloud: 1, dark: 0.62, vis: 2600, precip: 'rain' },
  { id: 'sno', name: 'Snø', cloud: 1, dark: 0.4, vis: 1000, precip: 'snow' },
  { id: 'take', name: 'Tåke', cloud: 0.7, dark: 0.3, vis: 300, precip: null },
];
export const TIMES = [['Soloppgang', 5.4], ['Morgen', 8], ['Dag', 13], ['Solnedgang', 20.6], ['Skumring', 21.6], ['Natt', 0.5]];

// solhøyde (grader) og retning (radianer fra øst mot nord) for et klokkeslett. Forenklet norsk sommer:
// sola står opp ca. 05, høyest ca. 13 og går ned ca. 21.
export function sunAt(h) {
  const t = ((h - 5) / 16) * Math.PI;                      // 0 ved soloppgang, π ved solnedgang
  const elev = h >= 5 && h <= 21 ? 46 * Math.sin(t) : -26 * Math.sin(((h < 5 ? h + 24 : h) - 21) / 8 * Math.PI);
  const az = -((h - 13) / 24) * Math.PI * 2 - Math.PI / 2;     // kl. 13 i sør, 05 i nordøst, 21 i nordvest
  return { elev, az };
}

// nøkkelbilder etter solhøyde. Farger i sRGB 0–1.
const KEYS = [
  { e: -20, zen: [0.012, 0.018, 0.045], hor: [0.035, 0.045, 0.085], glow: [0.03, 0.04, 0.08], sun: [0.55, 0.65, 0.95], si: 0.22, hs: [0.26, 0.32, 0.5], hg: [0.06, 0.07, 0.09], hi: 0.42 },
  { e: -8, zen: [0.05, 0.07, 0.18], hor: [0.2, 0.17, 0.3], glow: [0.55, 0.3, 0.32], sun: [0.55, 0.62, 0.9], si: 0.2, hs: [0.35, 0.38, 0.6], hg: [0.08, 0.08, 0.1], hi: 0.42 },
  { e: -2, zen: [0.16, 0.24, 0.45], hor: [0.62, 0.42, 0.42], glow: [1.0, 0.45, 0.2], sun: [1.0, 0.5, 0.28], si: 0.45, hs: [0.6, 0.55, 0.7], hg: [0.2, 0.16, 0.14], hi: 0.55 },
  { e: 4, zen: [0.3, 0.45, 0.72], hor: [0.95, 0.66, 0.46], glow: [1.0, 0.62, 0.3], sun: [1.0, 0.68, 0.42], si: 1.15, hs: [0.75, 0.72, 0.8], hg: [0.3, 0.26, 0.2], hi: 0.7 },
  { e: 14, zen: [0.33, 0.55, 0.86], hor: [0.78, 0.82, 0.88], glow: [1.0, 0.88, 0.7], sun: [1.0, 0.9, 0.78], si: 1.5, hs: [0.8, 0.88, 1.0], hg: [0.27, 0.3, 0.2], hi: 0.82 },
  { e: 40, zen: [0.28, 0.52, 0.88], hor: [0.72, 0.82, 0.93], glow: [1.0, 0.97, 0.9], sun: [1.0, 0.96, 0.88], si: 1.6, hs: [0.81, 0.9, 1.0], hg: [0.25, 0.29, 0.19], hi: 0.85 },
];
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function keyAt(e) {
  if (e <= KEYS[0].e) return KEYS[0];
  for (let i = 0; i + 1 < KEYS.length; i++) {
    const a = KEYS[i], b = KEYS[i + 1]; if (e > b.e) continue;
    const t = (e - a.e) / (b.e - a.e), o = {};
    for (const k in a) o[k] = Array.isArray(a[k]) ? mix3(a[k], b[k], t) : a[k] + (b[k] - a[k]) * t;
    return o;
  }
  return KEYS[KEYS.length - 1];
}

const SKY_VS = `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vec4 p = projectionMatrix * viewMatrix * vec4(cameraPosition + vDir * 1000.0, 1.0);
  gl_Position = p.xyww;                                     // alltid helt bakerst
}`;
const SKY_FS = `
precision highp float;
varying vec3 vDir;
uniform vec3 uZen, uHor, uGlow, uSunDir, uSunCol, uMoonDir, uFogCol;
uniform float uTime, uCloud, uDark, uNight, uAurora, uFogSky;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * n2(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  float up = max(d.y, 0.0);
  vec3 col = mix(uHor, uZen, pow(up, 0.55));
  float sd = max(dot(d, uSunDir), 0.0);
  // glød rundt sola, sterkest langs horisonten (soloppgang og solnedgang)
  col += uGlow * (pow(sd, 6.0) * 0.55 * (1.0 - up) + pow(sd, 48.0) * 0.4) * (1.0 - uDark);
  // stjerner
  if (uNight > 0.01 && d.y > 0.0) {
    vec3 sp = d * 220.0; vec3 cell = floor(sp); float r = h21(cell.xy + cell.z * 7.13);
    float star = step(0.985, r) * smoothstep(0.42, 0.0, length(fract(sp) - 0.5)) * (0.5 + 0.5 * sin(uTime * (1.0 + r * 3.0) + r * 40.0));
    col += vec3(star) * uNight * (1.0 - uCloud) * smoothstep(0.0, 0.15, d.y);
  }
  // nordlys: lysende gardiner som bølger sakte, grønne nede og lilla øverst
  if (uAurora > 0.01 && d.y > 0.02) {
    vec2 uv = vec2(d.x, -d.z) / (d.y + 0.18);              // nordover på himmelen
    float a = 0.0;
    for (int k = 0; k < 3; k++) {
      float fk = float(k);
      float wave = fbm(vec2(uv.x * 0.35 + fk * 3.1 + uTime * 0.025, fk * 1.7 + uTime * 0.01)) * 2.4 - 1.2;
      float band = exp(-pow((uv.y - 0.4 - fk * 0.55 - wave) * 2.6, 2.0));
      float rays = 0.55 + 0.45 * n2(vec2(uv.x * 9.0 + fk * 5.0 + uTime * 0.18, uTime * 0.3));
      a += band * rays * (0.9 - fk * 0.22);
    }
    float hgt = smoothstep(0.03, 0.5, d.y);
    vec3 ac = mix(vec3(0.15, 1.0, 0.45), vec3(0.65, 0.25, 0.9), smoothstep(0.25, 0.75, d.y));
    col += ac * a * uAurora * (1.0 - uCloud * 0.9) * smoothstep(0.02, 0.12, d.y) * (0.6 + 0.4 * hgt);
  }
  // sol og måne
  col += uSunCol * smoothstep(0.9993, 0.9997, sd) * 3.0 * (1.0 - uCloud * 0.85) * step(-0.02, uSunDir.y);
  float md = max(dot(d, uMoonDir), 0.0);
  col += vec3(0.85, 0.9, 1.0) * smoothstep(0.99955, 0.9998, md) * uNight * (1.0 - uCloud * 0.9);
  col += vec3(0.25, 0.3, 0.45) * pow(md, 300.0) * uNight * 0.6;
  // skyer: et lag som drar sakte over himmelen, lyses opp av sola
  if (uCloud > 0.01 && d.y > 0.0) {
    vec2 cp = d.xz / (d.y + 0.12) * 1.4 + vec2(uTime * 0.012, uTime * 0.004);
    float n = fbm(cp);
    float c = smoothstep(1.0 - uCloud * 0.95 - 0.2, 1.0 - uCloud * 0.95 + 0.25, n + uCloud * 0.35);
    float lit = 0.75 + 0.25 * pow(sd, 3.0);
    vec3 cc = mix(uHor * 1.08 + uGlow * pow(sd, 4.0) * 0.35, uZen * 0.5 + uHor * 0.35, uDark) * lit;
    cc = mix(cc, cc * 0.55, uDark * smoothstep(0.4, 1.0, n));
    col = mix(col, cc, c * smoothstep(0.0, 0.12, d.y) * 0.95);
  }
  col = mix(col, uHor, smoothstep(0.12, -0.02, d.y) * 0.85);   // horisonten glir over i tåka
  col = mix(col, uFogCol, uFogSky);
  gl_FragColor = vec4(col, 1.0);
}`;

export function createAtmosphere({ scene, renderer, camera, sun, hemi, mobile, lat = 60 }) {
  const uni = {
    uZen: { value: new THREE.Vector3() }, uHor: { value: new THREE.Vector3() }, uGlow: { value: new THREE.Vector3() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Vector3(1, 1, 1) }, uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
    uFogCol: { value: new THREE.Vector3() }, uTime: { value: 0 }, uCloud: { value: 0 }, uDark: { value: 0 }, uNight: { value: 0 }, uAurora: { value: 0 }, uFogSky: { value: 0 },
  };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
    uniforms: uni, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, depthTest: false,
  }));
  sky.frustumCulled = false; sky.renderOrder = -1000; scene.add(sky);
  scene.background = null;
  scene.fog = new THREE.Fog(0xb9d3ea, 300, 1600);

  const state = { hour: 13, weather: WEATHERS[0], dist: DISTANCES[1], aurora: true, t: 0 };
  let night = 0, sunDir = new THREE.Vector3(), moonDir = new THREE.Vector3();
  const srgb = (c, a) => a.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);

  // ---- nedbør
  const PN = mobile ? 1400 : 4000, BOX = 70, BOXH = 36;
  const pPos = new Float32Array(PN * 6), pVel = new Float32Array(PN);
  for (let i = 0; i < PN; i++) {
    const x = (Math.random() - 0.5) * BOX, y = Math.random() * BOXH, z = (Math.random() - 0.5) * BOX;
    pPos.set([x, y, z, x, y - 0.6, z], i * 6); pVel[i] = 0.8 + Math.random() * 0.4;
  }
  const pGeo = new THREE.BufferGeometry(); pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  const rain = new THREE.LineSegments(pGeo, new THREE.LineBasicMaterial({ color: 0xaab4c8, transparent: true, opacity: 0.45, depthWrite: false }));
  const flake = document.createElement('canvas'); flake.width = flake.height = 32;
  { const c = flake.getContext('2d'), g = c.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,.7)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, 32, 32); }
  const sGeo = new THREE.BufferGeometry(); const sPos = new Float32Array(PN * 3);
  for (let i = 0; i < PN; i++) sPos.set([pPos[i * 6], pPos[i * 6 + 1], pPos[i * 6 + 2]], i * 3);
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  const snow = new THREE.Points(sGeo, new THREE.PointsMaterial({ map: new THREE.CanvasTexture(flake), size: 0.22, transparent: true, depthWrite: false, opacity: 0.95 }));
  for (const o of [rain, snow]) { o.frustumCulled = false; o.visible = false; scene.add(o); }
  const anchor = new THREE.Vector3(), wrap = (v, m) => ((v % m) + m) % m;

  function apply() {
    const { elev, az } = sunAt(state.hour);
    const k = keyAt(elev), w = state.weather, er = elev * Math.PI / 180;
    sunDir.set(Math.cos(er) * Math.cos(az), Math.sin(er), -Math.cos(er) * Math.sin(az)).normalize();
    // månen står omtrent motsatt av sola, litt over horisonten om natta
    const mr = Math.max(0.35, -er * 0.9 + 0.2); moonDir.set(-Math.cos(mr) * Math.cos(az), Math.sin(mr), Math.cos(mr) * Math.sin(az)).normalize();
    night = Math.min(1, Math.max(0, (-elev - 4) / 9));
    const grey = [0.55, 0.58, 0.62].map(v => v * (1 - night * 0.85) + 0.02);
    const dk = w.dark;
    const zen = mix3(k.zen, mix3(grey, k.zen, 0.35), dk), hor = mix3(k.hor, grey, dk * 0.85), glow = k.glow.map(v => v * (1 - dk));
    uni.uZen.value.set(...zen); uni.uHor.value.set(...hor); uni.uGlow.value.set(...glow);
    uni.uSunDir.value.copy(sunDir); uni.uSunCol.value.set(...k.sun); uni.uMoonDir.value.copy(moonDir);
    uni.uCloud.value = w.cloud; uni.uDark.value = dk; uni.uNight.value = night;
    uni.uAurora.value = state.aurora ? night * (lat > 62 ? 1 : 0.85) : 0;
    // tåke: sikten kuttes av værtypen, og tåka får horisontens farge så fjella forsvinner mykt inn i himmelen
    const far = Math.min(state.dist.km * 1000, w.vis), thick = w.vis < state.dist.km * 1000;
    scene.fog.far = far; scene.fog.near = w.id === 'take' ? 5 : far * (thick ? 0.05 : state.dist.id === 'kort' ? 0.25 : 0.12);
    srgb(hor, scene.fog.color); uni.uFogCol.value.set(...hor);
    uni.uFogSky.value = w.id === 'take' ? 0.85 : w.precip ? 0.45 : 0;
    camera.far = Math.max(3000, far * 1.15); camera.updateProjectionMatrix();
    // lys: sol om dagen, blåhvit måne om natta. Overskyet demper sola og løfter himmellyset.
    const sunVis = Math.max(0, Math.min(1, (elev + 1.5) / 4));
    if (sunVis > 0) { srgb(k.sun, sun.color); sun.intensity = k.si * (1 - dk * 0.8); }
    else { sun.color.setRGB(0.55, 0.65, 0.95, THREE.SRGBColorSpace); sun.intensity = 0.22 * (1 - dk * 0.7) + (state.aurora ? 0.04 : 0); }
    srgb(state.aurora && night > 0.5 ? mix3(k.hs, [0.25, 0.6, 0.4], 0.35) : mix3(k.hs, grey, dk * 0.6), hemi.color); srgb(k.hg, hemi.groundColor);
    hemi.intensity = k.hi * (1 + dk * 0.25);
    rain.visible = w.precip === 'rain'; snow.visible = w.precip === 'snow';
    rain.material.color.setRGB(...mix3([0.67, 0.71, 0.78], [0.2, 0.22, 0.28], night), THREE.SRGBColorSpace);
  }
  const lightDir = () => (sunAt(state.hour).elev > -1.5 ? sunDir : moonDir);

  function update(dt, cam) {
    state.t += dt; uni.uTime.value = state.t;
    sky.position.copy(cam.position);
    if (rain.visible || snow.visible) {
      // partiklene ligger i en boks rundt kameraet og flyttes med når kameraet kjører fra dem
      anchor.copy(cam.position);
      const isRain = rain.visible, fall = isRain ? 22 : 1.6;
      for (let i = 0; i < PN; i++) {
        let x, y, z;
        if (isRain) { x = pPos[i * 6]; y = pPos[i * 6 + 1]; z = pPos[i * 6 + 2]; }
        else { x = sPos[i * 3]; y = sPos[i * 3 + 1]; z = sPos[i * 3 + 2]; }
        y -= fall * pVel[i] * dt;
        if (!isRain) { x += Math.sin(state.t * 0.7 + i) * 0.4 * dt; z += Math.cos(state.t * 0.5 + i * 1.3) * 0.4 * dt; }
        y = anchor.y - 8 + wrap(y - (anchor.y - 8), BOXH);
        x = anchor.x - BOX / 2 + wrap(x - anchor.x + BOX / 2, BOX);
        z = anchor.z - BOX / 2 + wrap(z - anchor.z + BOX / 2, BOX);
        if (isRain) { pPos[i * 6] = pPos[i * 6 + 3] = x; pPos[i * 6 + 1] = y; pPos[i * 6 + 4] = y - 0.7; pPos[i * 6 + 2] = pPos[i * 6 + 5] = z; }
        else { sPos[i * 3] = x; sPos[i * 3 + 1] = y; sPos[i * 3 + 2] = z; }
      }
      (isRain ? pGeo : sGeo).attributes.position.needsUpdate = true;
    }
  }

  return {
    state, update, lightDir,
    get night() { return night; },
    set(o) { Object.assign(state, o); apply(); },
  };
}
