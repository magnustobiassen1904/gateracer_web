"""
build_world.py — lager data/world.json fra
  * data/osm_raw.json           (OpenStreetMap via Overpass: veier, bygninger, arealer)
  * data/dtm.tif / data/dom.tif (Kartverket, nasjonal høydemodell 1 m: terreng + overflate)

Overflatemodell minus terrengmodell = høyden på alt som står på bakken.
Det gir ekte høyder på hus (percentil inne i fotavtrykket) og ekte trær (lokale topper).

Kjør:  ./venv/bin/python tools/build_world.py
"""
import json, math, random, sys, os
import numpy as np
from PIL import Image, ImageDraw
from pyproj import Transformer

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, "data")

LAT0, LON0 = 59.665499, 9.640823      # Mauritz Hansens gate, Kongsberg
HALF = 450                            # meter fra origo i hver retning (900 x 900 m verden)
CELL = 2                              # terrengoppløsning i world.json (m)

to_utm = Transformer.from_crs("EPSG:4326", "EPSG:25833", always_xy=True)
E0, N0 = to_utm.transform(LON0, LAT0)

def loc(lat, lon):
    e, n = to_utm.transform(lon, lat)
    return (round(e - E0, 2), round(n - N0, 2))

# ---------------------------------------------------------------- høydedata
def load_tif(name):
    import tifffile
    path = os.path.join(DATA, name)
    if not os.path.exists(path):
        return None
    a = tifffile.imread(path).astype(np.float32)
    if a.ndim == 3: a = a[..., 0]
    a[a < -100] = np.nan
    return a

dtm = load_tif("dtm.tif")
dom = load_tif("dom.tif")
HAVE_LIDAR = dtm is not None and dom is not None
if HAVE_LIDAR:
    # GeoTIFF fra WCS: rad 0 = nord. Vi vil ha rad 0 = sør (y stigende) -> flipp.
    dtm = np.flipud(dtm); dom = np.flipud(dom)
    # tett hull (nodata) med nærmeste gyldige verdi via enkel iterativ fylling
    def fill(a):
        m = np.isnan(a)
        if not m.any(): return a
        from scipy.ndimage import distance_transform_edt
        idx = distance_transform_edt(m, return_distances=False, return_indices=True)
        return a[tuple(idx)]
    dtm = fill(dtm); dom = fill(dom)
    chm = np.clip(dom - dtm, 0, 60)
    res = (2 * HALF) / dtm.shape[0]     # m per piksel (1.0 hvis 900x900)
    print("lidar ok", dtm.shape, "res", res, "dtm", dtm.min(), dtm.max(), "chm max", chm.max())
else:
    print("!! ingen dtm.tif/dom.tif — bruker open-elevation som terreng og gjetter høyder")
    ed = json.load(open(os.path.join(DATA, "elev_open_elevation.json")))["results"]
    N = 24; G = np.zeros((N, N))
    for k, p in enumerate(ed): G[k // N, k % N] = p["elevation"]
    # interpoler opp til 1 m grid
    ys = np.linspace(0, N - 1, 2 * HALF); xs = np.linspace(0, N - 1, 2 * HALF)
    yi = np.clip(ys.astype(int), 0, N - 2); xi = np.clip(xs.astype(int), 0, N - 2)
    fy = (ys - yi)[:, None]; fx = (xs - xi)[None, :]
    dtm = (G[yi][:, xi] * (1 - fy) * (1 - fx) + G[yi + 1][:, xi] * fy * (1 - fx)
           + G[yi][:, xi + 1] * (1 - fy) * fx + G[yi + 1][:, xi + 1] * fy * fx).astype(np.float32)
    chm = np.zeros_like(dtm); res = 1.0

H, W = dtm.shape
def px(x, y):
    """lokale meter -> pikselindeks (kol, rad)"""
    return ((x + HALF) / res, (y + HALF) / res)

def terrain_at(x, y):
    c, r = px(x, y)
    c = min(max(c, 0), W - 1.001); r = min(max(r, 0), H - 1.001)
    i, j = int(r), int(c); a, b = r - i, c - j
    return float(dtm[i, j] * (1 - a) * (1 - b) + dtm[i + 1, j] * a * (1 - b) + dtm[i, j + 1] * (1 - a) * b + dtm[i + 1, j + 1] * a * b)

# ---------------------------------------------------------------- osm
d = json.load(open(os.path.join(DATA, "osm_raw.json")))["elements"]
nodes = {e["id"]: loc(e["lat"], e["lon"]) for e in d if e["type"] == "node"}
ways = [e for e in d if e["type"] == "way"]

DRIVE = {"primary": 8, "secondary": 8, "tertiary": 7, "residential": 6, "unclassified": 6, "living_street": 5, "service": 4}
WALK = {"footway": 1.8, "cycleway": 2.2, "path": 1.5, "pedestrian": 4, "track": 3, "steps": 1.5}

roads, buildings, areas = [], [], []
def poly_mask(poly):
    im = Image.new("L", (W, H), 0)
    ImageDraw.Draw(im).polygon([px(x, y) for x, y in poly], fill=1)
    return np.array(im, dtype=bool)

building_mask = np.zeros((H, W), dtype=bool)
PAL = ["#b93c32", "#f0ece0", "#e6c85a", "#78828c", "#aa503c", "#ebebeb", "#c8aa78", "#5a646e", "#d9d2c5", "#8c1c1c"]
def norm_colour(c):
    if not c: return None
    c = c.strip().lower()
    if c.startswith("#") and len(c) == 7: return c
    return {"white": "#f0f0f0", "red": "#b93c32", "yellow": "#e6c85a", "grey": "#909090", "gray": "#909090",
            "brown": "#7a4a2a", "black": "#303030", "blue": "#4a6a9a", "green": "#4a8a4a", "beige": "#d9cdb0"}.get(c)

for w in ways:
    t = w.get("tags", {}); p = [nodes[n] for n in w["nodes"] if n in nodes]
    if len(p) < 2: continue
    if "building" in t and len(p) >= 4:
        poly = p[:-1] if p[0] == p[-1] else p
        if any(abs(x) > HALF + 50 or abs(y) > HALF + 50 for x, y in poly): continue
        m = poly_mask(poly)
        building_mask |= m
        h = None; top = None; from_lidar = False
        zs = [terrain_at(x, y) for x, y in poly]
        if HAVE_LIDAR and m.sum() >= 6:
            # absolutt takhøyde direkte fra overflatemodellen (robust på skrå tomter)
            top = float(np.percentile(dom[m], 80))
            h = top - max(zs)
            if h < 2.2: h = None; top = None
            else: from_lidar = True
        if h is None:
            if "height" in t:
                try: h = float(t["height"].replace("m", "").strip())
                except: pass
            if h is None and "building:levels" in t:
                try: h = float(t["building:levels"]) * 3 + 1
                except: pass
        if h is None:
            h = {"garage": 3, "garages": 3, "shed": 2.5, "carport": 2.8, "roof": 3, "apartments": 12}.get(t["building"], 6.5)
        h = min(max(h, 2.4), 45)
        if top is None: top = max(zs) + h
        rnd = random.Random(w["id"])
        colour = norm_colour(t.get("building:colour")) or rnd.choice(PAL)
        buildings.append({"id": w["id"], "p": poly, "h": round(h, 1), "zb": round(min(zs), 1), "zt": round(max(zs), 1), "top": round(top, 1),
                          "t": t["building"], "c": colour, "src": "lidar" if from_lidar else "tag/guess"})
    elif "highway" in t:
        k = t["highway"]
        if k in DRIVE or k in WALK:
            roads.append({"id": w["id"], "k": k, "w": DRIVE.get(k) or WALK.get(k), "drive": k in DRIVE,
                          "n": t.get("name", ""), "nodes": w["nodes"], "p": p})
    else:
        kind = None
        if t.get("natural") == "wood" or t.get("landuse") == "forest": kind = "forest"
        elif t.get("natural") == "water" or t.get("waterway") == "river": kind = "water"
        elif t.get("landuse") in ("farmland", "meadow"): kind = "farm"
        elif t.get("landuse") == "grass" or t.get("leisure") in ("park", "pitch", "playground"): kind = "park"
        elif t.get("natural") == "scrub": kind = "scrub"
        if kind and len(p) >= 4: areas.append({"k": kind, "p": p})

# ---------------------------------------------------------------- arealklasse per terrengcelle
CLASSES = {"grass": 0, "forest": 1, "water": 2, "farm": 3, "park": 4, "scrub": 5}
cls = np.zeros((H, W), dtype=np.uint8)
for a in areas:
    m = poly_mask(a["p"])
    if a["k"] == "water": cls[m] = 2
    else: cls[m & (cls == 0)] = CLASSES[a["k"]]

# ---------------------------------------------------------------- trær fra overflatemodellen
trees = []
if HAVE_LIDAR:
    from scipy.ndimage import maximum_filter, binary_dilation
    nb = binary_dilation(building_mask, iterations=int(3 / res))
    veg = chm.copy(); veg[nb] = 0; veg[cls == 2] = 0
    peaks = (veg == maximum_filter(veg, size=int(6 / res) | 1)) & (veg >= 3.0)
    rr, cc = np.nonzero(peaks)
    order = np.argsort(-veg[rr, cc])
    taken = set()
    for k in order:
        r_, c_ = rr[k], cc[k]
        key = (int(r_ * res // 4), int(c_ * res // 4))
        if key in taken: continue
        taken.add(key)
        x = c_ * res - HALF; y = r_ * res - HALF
        trees.append([round(x, 1), round(y, 1), round(float(veg[r_, c_]), 1)])
        if len(trees) >= 6000: break
    print("trær fra lidar:", len(trees))
else:
    rnd = random.Random(3)
    nb = building_mask.copy()
    for _ in range(60000):
        x = rnd.uniform(-HALF, HALF); y = rnd.uniform(-HALF, HALF)
        c, r = px(x, y); r = int(r); c = int(c)
        if not (0 <= r < H and 0 <= c < W) or nb[r, c]: continue
        k = cls[r, c]
        keep = {1: 0.28, 5: 0.08, 0: 0.012, 4: 0.02}.get(int(k), 0)
        if rnd.random() < keep:
            trees.append([round(x, 1), round(y, 1), round(rnd.uniform(6, 15) if k == 1 else rnd.uniform(4, 10), 1)])
    print("trær gjettet:", len(trees))

# ---------------------------------------------------------------- terreng-grid til json
step = int(CELL / res)
tg = dtm[::step, ::step]; cg = cls[::step, ::step]
zmin = float(np.floor(tg.min()))
terrain = {"x0": -HALF, "y0": -HALF, "cell": CELL, "nx": tg.shape[1], "ny": tg.shape[0], "zmin": zmin,
           "z": [int(round((v - zmin) * 10)) for v in tg.flatten()],      # desimeter over zmin, rad-major, rad 0 = sør
           "c": [int(v) for v in cg.flatten()]}

z0 = terrain_at(0, 0)
world = {"origin": {"lat": LAT0, "lon": LON0, "z": round(z0, 1), "name": "Mauritz Hansens gate, Kongsberg"},
         "lidar": HAVE_LIDAR, "terrain": terrain, "buildings": buildings, "roads": roads, "trees": trees, "areas": areas}
out = os.path.join(DATA, "world.json")
json.dump(world, open(out, "w"), separators=(",", ":"))
print("skrev", out, os.path.getsize(out) // 1024, "kB —", len(buildings), "bygninger,", len(roads), "veier,", len(trees), "trær")
if HAVE_LIDAR:
    hs = [b["h"] for b in buildings if b["src"] == "lidar"]
    print("hushøyder fra lidar:", len(hs), "median", round(float(np.median(hs)), 1), "maks", max(hs))
