// gen_test.mjs — kjører kartbyggeren (web/worldgen.js) i Node uten nettleser, med tidtaking per fase.
// Bruk: node --experimental-detect-module tools/gen_test.mjs <lat> <lon> <diameter_km> [navn]
// Eksempel: node --experimental-detect-module tools/gen_test.mjs 59.665499 9.640823 1 Kongsberg

// Kjører worldgen.js i Node med samme meldingsgrensesnitt som i nettleseren.
const [lat, lon, d, name] = [Number(process.argv[2]), Number(process.argv[3]), Number(process.argv[4]), process.argv[5] || 'Test'];
let last = '';
globalThis.self = {
  postMessage(m) {
    if (m.type === 'progress') { const t = `[${m.step}] ${m.text}`; if (t !== last) { console.log(((performance.now() / 1000).toFixed(1) + 's').padStart(7), t); last = t; } }
    else if (m.type === 'error') { console.log('FEIL:', m.message); process.exit(1); }
    else if (m.type === 'done') {
      const w = m.world, TZ = new Uint16Array(m.tz), TC = new Uint8Array(m.tc);
      const hs = w.buildings.filter(b => b.src === 'lidar').map(b => b.h).sort((a, b) => a - b);
      const inside = p => Math.abs(p[0]) <= 500 && Math.abs(p[1]) <= 500;
      console.log('TID ' + JSON.stringify(Object.fromEntries(Object.entries(m.timing).map(([k, v]) => [k, k === 'tiles' || k === 'pixels' ? v : +(v / 1000).toFixed(1)]))));
      console.log('RESULTAT ' + JSON.stringify({ bound: w.bound.length, utenfor: TC.reduce((a, c) => a + (c === 8), 0), lidar: w.lidar, hus: w.buildings.length, hus_laser: hs.length, median_h: hs[hs.length >> 1], veier: w.roads.length, kjørbare: w.roads.filter(r => r.drive).length, trær: w.trees.length, arealer: w.areas.length, vann: TC.reduce((a, c) => a + (c === 2), 0), nx: w.terrain.nx, zmin: w.terrain.zmin, origo_z: w.origin.z }));
      if (process.env.DUMP) require('fs').writeFileSync(process.env.DUMP, JSON.stringify({ world: w }));
      globalThis.__done = m; setTimeout(() => process.exit(0), 10);
    }
  },
};
const _f = globalThis.fetch; globalThis.fetch = (u, o = {}) => _f(u, { ...o, headers: { ...(o.headers || {}), 'User-Agent': 'Gateracer-devtest/1.0 (+https://github.com/magnustobiassen1904/gateracer_web)' } });
globalThis.require = (await import('module')).createRequire(import.meta.url);
await import(new URL('../web/worldgen.js', import.meta.url).href);
self.onmessage({ data: { lat, lon, shape: { type: 'circle', d }, name } });
