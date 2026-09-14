// GPS (lat/lon) <-> EUREF89 UTM sone 33 (EPSG:25833), Kartverkets nasjonale rutenett.
// Krügers serier (samme metode som pyproj/PROJ «etmerc»), nøyaktig til millimeter innenfor Norge.
const a = 6378137, f = 1 / 298.257222101, k0 = 0.9996, lon0 = 15 * Math.PI / 180, FE = 500000;
const n = f / (2 - f), n2 = n * n, n3 = n2 * n, n4 = n3 * n;
const A = a / (1 + n) * (1 + n2 / 4 + n4 / 64);
const al = [n / 2 - 2 * n2 / 3 + 5 * n3 / 16 + 41 * n4 / 180, 13 * n2 / 48 - 3 * n3 / 5 + 557 * n4 / 1440, 61 * n3 / 240 - 103 * n4 / 140, 49561 * n4 / 161280];
const be = [n / 2 - 2 * n2 / 3 + 37 * n3 / 96 - n4 / 360, n2 / 48 + n3 / 15 - 437 * n4 / 1440, 17 * n3 / 480 - 37 * n4 / 840, 4397 * n4 / 161280];
const de = [2 * n - 2 * n2 / 3 - 2 * n3 + 116 * n4 / 45, 7 * n2 / 3 - 8 * n3 / 5 - 227 * n4 / 45, 56 * n3 / 15 - 136 * n4 / 35, 4279 * n4 / 630];
export function toUTM(lat, lon) {
  const phi = lat * Math.PI / 180, lam = lon * Math.PI / 180 - lon0;
  const e = Math.sqrt(f * (2 - f));
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - e * Math.atanh(e * Math.sin(phi)));
  const xi = Math.atan2(t, Math.cos(lam)), eta = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
  let x = eta, y = xi;
  for (let j = 1; j <= 4; j++) { y += al[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta); x += al[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta); }
  return [FE + k0 * A * x, k0 * A * y];
}
export function fromUTM(E, N) {
  const xi = N / (k0 * A), eta = (E - FE) / (k0 * A);
  let x = eta, y = xi;
  for (let j = 1; j <= 4; j++) { y -= be[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta); x -= be[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta); }
  const chi = Math.asin(Math.sin(y) / Math.cosh(x));
  let phi = chi;
  for (let j = 1; j <= 4; j++) phi += de[j - 1] * Math.sin(2 * j * chi);
  const lam = Math.atan2(Math.sinh(x), Math.cos(y));
  return [phi * 180 / Math.PI, (lam + lon0) * 180 / Math.PI];
}
