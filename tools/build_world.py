"""
build_world.py — lager data/world.json + data/terrain.bin + data/terrain_cls.bin fra
  * tools/area.json               (område i meter rundt origo, terrengoppløsning)
  * data/osm_raw_big.json         (OpenStreetMap via Overpass: veier, bygninger, arealer)
  * data/tiles/{dtm,dom}_r_c.tif  (Kartverket, nasjonal høydemodell 1 m, hentet av fetch_kartverket.py)

Overflatemodell minus terrengmodell = høyden på alt som står på bakken:
ekte takhøyde per hus (80-persentil av overflatemodellen i fotavtrykket) og ekte trær (lokale topper).

Kjør:  ./venv/bin/python tools/build_world.py
"""
import json, math, random, os, glob
import numpy as np
from PIL import Image, ImageDraw
from pyproj import Transformer
from scipy.ndimage import maximum_filter, binary_dilation, distance_transform_edt

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE); DATA = os.path.join(ROOT, "data")
A = json.load(open(os.path.join(HERE, "area.json")))
LAT0, LON0 = A["lat0"], A["lon0"]; X0, X1, Y0, Y1 = A["x0"], A["x1"], A["y0"], A["y1"]; CELL = A["cell"]
W, H = X1 - X0, Y1 - Y0          # meter = piksler (1 m)

to_utm = Transformer.from_crs("EPSG:4326", "EPSG:25833", always_xy=True)
E0, N0 = to_utm.transform(LON0, LAT0)
def loc(lat, lon):
    e, n = to_utm.transform(lon, lat); return (round(e - E0, 2), round(n - N0, 2))

# ---------------------------------------------------------------- høydedata (fliser -> ett grid, rad 0 = sør)
import tifffile
def load_model(m):
    a = np.full((H, W), np.nan, np.float32); n = 0
    for f in glob.glob(os.path.join(DATA, "tiles", f"{m}_*_*.tif")):
        r, c = map(int, os.path.basename(f)[:-4].split("_")[1:])
        t = tifffile.imread(f).astype(np.float32)
        if t.ndim == 3: t = t[..., 0]
        t[t < -100] = np.nan
        t = np.flipud(t)                                  # tiff rad 0 = nord -> vi vil ha rad 0 = sør
        y = r * 1000; x = c * 1000
        a[y:y + t.shape[0], x:x + t.shape[1]] = t; n += 1
    return a, n
dtm, n1 = load_model("dtm"); dom, n2 = load_model("dom")
HAVE_LIDAR = n1 > 0 and n2 > 0 and np.isnan(dtm).mean() < 0.5
if not HAVE_LIDAR:
    raise SystemExit("Ingen (eller for få) høydefliser i data/tiles — kjør tools/fetch_kartverket.py først")
def fill(a):
    m = np.isnan(a)
    if m.any():
        idx = distance_transform_edt(m, return_distances=False, return_indices=True); a = a[tuple(idx)]
    return a
print("fliser", n1, n2, "hull", round(float(np.isnan(dtm).mean()) * 100, 1), "%")
dtm = fill(dtm); dom = fill(dom); chm = np.clip(dom - dtm, 0, 60)
print("lidar ok", dtm.shape, "dtm", float(dtm.min()), float(dtm.max()), "chm maks", float(chm.max()))

def px(x, y): return (x - X0, y - Y0)                 # lokale meter -> (kol, rad)
def terrain_at(x, y):
    c, r = px(x, y); c = min(max(c, 0), W - 1.001); r = min(max(r, 0), H - 1.001)
    i, j = int(r), int(c); a, b = r - i, c - j
    return float(dtm[i, j] * (1 - a) * (1 - b) + dtm[i + 1, j] * a * (1 - b) + dtm[i, j + 1] * (1 - a) * b + dtm[i + 1, j + 1] * a * b)

def crop_mask(poly, pad=0):
    """rasteriser polygon i et lite utsnitt: (mask, r0, c0) eller None hvis utenfor"""
    xs = [p[0] for p in poly]; ys = [p[1] for p in poly]
    c0 = int(max(0, min(xs) - X0 - pad)); c1 = int(min(W, max(xs) - X0 + pad + 2))
    r0 = int(max(0, min(ys) - Y0 - pad)); r1 = int(min(H, max(ys) - Y0 + pad + 2))
    if c1 <= c0 or r1 <= r0: return None
    im = Image.new("L", (c1 - c0, r1 - r0), 0)
    ImageDraw.Draw(im).polygon([(x - X0 - c0, y - Y0 - r0) for x, y in poly], fill=1)
    return np.array(im, dtype=bool), r0, c0

# ---------------------------------------------------------------- osm
d = json.load(open(os.path.join(DATA, "osm_raw_big.json")))["elements"]
nodes = {e["id"]: loc(e["lat"], e["lon"]) for e in d if e["type"] == "node"}
ways = {e["id"]: e for e in d if e["type"] == "way"}
rels = [e for e in d if e["type"] == "relation"]

DRIVE = {"primary": 8, "secondary": 8, "tertiary": 7, "residential": 6, "unclassified": 6, "living_street": 5, "service": 4, "track": 3.5}
WALK = {"footway": 1.8, "cycleway": 2.2, "path": 1.5, "pedestrian": 4, "steps": 1.5}
def area_kind(t):
    if t.get("natural") == "wood" or t.get("landuse") == "forest": return "forest"
    if t.get("natural") == "water" or t.get("waterway") in ("river",): return "water"
    if t.get("landuse") in ("farmland", "meadow"): return "farm"
    if t.get("landuse") == "grass" or t.get("leisure") in ("park", "pitch", "playground", "golf_course"): return "park"
    if t.get("natural") == "scrub": return "scrub"
    if t.get("natural") in ("bare_rock", "scree") or t.get("landuse") == "quarry": return "rock"
    if t.get("landuse") == "industrial": return "industrial"
    return None

def rings_from_relation(rel):
    """kjeder outer-veier i en multipolygon til lukkede ringer"""
    segs = [list(ways[m["ref"]]["nodes"]) for m in rel.get("members", []) if m["type"] == "way" and m.get("role", "outer") == "outer" and m["ref"] in ways]
    rings = []
    while segs:
        ring = segs.pop(0)
        changed = True
        while changed and ring[0] != ring[-1]:
            changed = False
            for i, s in enumerate(segs):
                if s[0] == ring[-1]: ring += s[1:]; segs.pop(i); changed = True; break
                if s[-1] == ring[-1]: ring += s[::-1][1:]; segs.pop(i); changed = True; break
                if s[-1] == ring[0]: ring = s[:-1] + ring; segs.pop(i); changed = True; break
                if s[0] == ring[0]: ring = s[::-1][:-1] + ring; segs.pop(i); changed = True; break
        if len(ring) >= 4: rings.append([nodes[n] for n in ring if n in nodes])
    return rings

roads, buildings, areas = [], [], []
PAL = ["#b93c32", "#f0ece0", "#e6c85a", "#78828c", "#aa503c", "#ebebeb", "#c8aa78", "#5a646e", "#d9d2c5", "#8c1c1c"]
def norm_colour(c):
    if not c: return None
    c = c.strip().lower()
    if c.startswith("#") and len(c) == 7: return c
    return {"white": "#f0f0f0", "red": "#b93c32", "yellow": "#e6c85a", "grey": "#909090", "gray": "#909090",
            "brown": "#7a4a2a", "black": "#303030", "blue": "#4a6a9a", "green": "#4a8a4a", "beige": "#d9cdb0"}.get(c)
def inside(p): return X0 <= p[0] <= X1 and Y0 <= p[1] <= Y1

building_mask = np.zeros((H, W), dtype=bool)
for w in ways.values():
    t = w.get("tags", {}); p = [nodes[n] for n in w["nodes"] if n in nodes]
    if len(p) < 2: continue
    if "building" in t and len(p) >= 4:
        poly = p[:-1] if p[0] == p[-1] else p
        if not any(inside(q) for q in poly): continue
        cm = crop_mask(poly)
        if cm is None: continue
        m, r0, c0 = cm
        building_mask[r0:r0 + m.shape[0], c0:c0 + m.shape[1]] |= m
        zs = [terrain_at(x, y) for x, y in poly]
        h = None; top = None; from_lidar = False
        if m.sum() >= 6:
            top = float(np.percentile(dom[r0:r0 + m.shape[0], c0:c0 + m.shape[1]][m], 80)); h = top - max(zs)
            if h < 2.2: h = None; top = None
            else: from_lidar = True
        if h is None:
            if "height" in t:
                try: h = float(t["height"].replace("m", "").strip())
                except: pass
            if h is None and "building:levels" in t:
                try: h = float(t["building:levels"]) * 3 + 1
                except: pass
        if h is None: h = {"garage": 3, "garages": 3, "shed": 2.5, "carport": 2.8, "roof": 3, "apartments": 12}.get(t["building"], 6.5)
        h = min(max(h, 2.4), 45)
        if top is None: top = max(zs) + h
        rnd = random.Random(w["id"])
        buildings.append({"id": w["id"], "p": poly, "h": round(h, 1), "zb": round(min(zs), 1), "zt": round(max(zs), 1), "top": round(top, 1),
                          "t": t["building"], "c": norm_colour(t.get("building:colour")) or rnd.choice(PAL), "src": "lidar" if from_lidar else "tag/guess"})
    elif "highway" in t:
        k = t["highway"]
        if (k in DRIVE or k in WALK) and any(inside(q) for q in p):
            roads.append({"id": w["id"], "k": k, "w": DRIVE.get(k) or WALK.get(k), "drive": k in DRIVE,
                          "n": t.get("name", ""), "nodes": w["nodes"], "p": p})
    else:
        kind = area_kind(t)
        if kind and len(p) >= 4 and any(inside(q) for q in p): areas.append({"k": kind, "p": p})
for rel in rels:
    kind = area_kind(rel.get("tags", {}))
    if not kind: continue
    for ring in rings_from_relation(rel):
        if any(inside(q) for q in ring): areas.append({"k": kind, "p": ring})
print("bygninger", len(buildings), "veier", len(roads), "arealer", len(areas))

# ---------------------------------------------------------------- arealklasse per meter
CLASSES = {"grass": 0, "forest": 1, "water": 2, "farm": 3, "park": 4, "scrub": 5, "rock": 6, "industrial": 7}
cls = np.zeros((H, W), dtype=np.uint8)
for a in sorted(areas, key=lambda a: a["k"] != "forest"):      # skog først, så overskriver mer spesifikke
    cm = crop_mask(a["p"])
    if cm is None: continue
    m, r0, c0 = cm; sub = cls[r0:r0 + m.shape[0], c0:c0 + m.shape[1]]
    if a["k"] == "water": sub[m] = 2
    else: sub[m & ((sub == 0) | (sub == 1))] = CLASSES[a["k"]]
# elver/bekker som linjer -> vann
for w in ways.values():
    t = w.get("tags", {})
    if t.get("waterway") in ("river", "stream"):
        p = [nodes[n] for n in w["nodes"] if n in nodes]
        if len(p) < 2: continue
        wd = t.get("width", "6").split()[0]; wd = int(float(wd)) if wd.replace(".", "").isdigit() else 6
        im = Image.new("L", (W, H), 0); ImageDraw.Draw(im).line([px(x, y) for x, y in p], fill=1, width=max(2, wd))
        cls[np.array(im, dtype=bool)] = 2

# ---------------------------------------------------------------- trær fra overflatemodellen (tynnet)
road_im = Image.new("L", (W, H), 0); rd = ImageDraw.Draw(road_im)
for r in roads:
    if r["drive"] and len(r["p"]) >= 2: rd.line([px(x, y) for x, y in r["p"]], fill=1, width=90)
near_road = np.array(road_im, dtype=bool)
nb = binary_dilation(building_mask, iterations=3)
veg = chm.copy(); veg[nb] = 0; veg[cls == 2] = 0
peaks = (veg == maximum_filter(veg, size=7)) & (veg >= 3.0)
rr, cc = np.nonzero(peaks); order = np.argsort(-veg[rr, cc])
trees = []; taken = set()
for k in order:
    r_, c_ = rr[k], cc[k]; hgt = float(veg[r_, c_])
    dense = near_road[r_, c_]
    if not dense and hgt < 5.5: continue
    sp = 4 if dense else 9
    key = (r_ // sp, c_ // sp)
    if key in taken: continue
    taken.add(key)
    trees.append([int(c_ + X0), int(r_ + Y0), round(hgt, 1)])
    if len(trees) >= 70000: break
print("trær", len(trees))

# ---------------------------------------------------------------- terreng -> binærfiler
tg = dtm[::CELL, ::CELL]; cg = cls[::CELL, ::CELL]
zmin = float(np.floor(tg.min()))
np.round((tg - zmin) * 10).astype(np.uint16).tofile(os.path.join(DATA, "terrain.bin"))
cg.astype(np.uint8).tofile(os.path.join(DATA, "terrain_cls.bin"))
terrain = {"x0": X0, "y0": Y0, "x1": X1, "y1": Y1, "cell": CELL, "nx": tg.shape[1], "ny": tg.shape[0], "zmin": zmin,
           "bin": "terrain.bin", "cls": "terrain_cls.bin"}
world = {"origin": {"lat": LAT0, "lon": LON0, "z": round(terrain_at(0, 0), 1), "name": A["name"]},
         "lidar": True, "terrain": terrain, "buildings": buildings, "roads": roads, "trees": trees, "areas": areas}
out = os.path.join(DATA, "world.json"); json.dump(world, open(out, "w"), separators=(",", ":"))
hs = [b["h"] for b in buildings if b["src"] == "lidar"]
print("skrev", out, os.path.getsize(out) // 1024, "kB; terrain.bin", tg.shape, "; hus fra lidar", len(hs), "/", len(buildings), "median", round(float(np.median(hs)), 1), "maks", max(hs))
