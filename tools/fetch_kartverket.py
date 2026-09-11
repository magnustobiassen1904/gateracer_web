"""
Henter terrengmodell (dtm) og overflatemodell (dom), 1 m, fra Kartverkets WCS i 1000 m-fliser
for området definert i tools/area.json. Prøver på nytt til alt er hentet (tjenesten er tidvis nede).
Skriver data/tiles/{dtm,dom}_{r}_{c}.tif. Kjør: ./venv/bin/python tools/fetch_kartverket.py
"""
import json, os, sys, time, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
A = json.load(open(os.path.join(HERE, "area.json")))
E0, N0 = A["E0"], A["N0"]; X0, X1, Y0, Y1 = A["x0"], A["x1"], A["y0"], A["y1"]
TILE = 1000
out = os.path.join(ROOT, "data", "tiles"); os.makedirs(out, exist_ok=True)
HOSTS = ["wcs.geonorge.no", "wms.geonorge.no"]
jobs = []
for r, y in enumerate(range(Y0, Y1, TILE)):
    for c, x in enumerate(range(X0, X1, TILE)):
        w = min(TILE, X1 - x); h = min(TILE, Y1 - y)
        for m in ("dtm", "dom"):
            jobs.append((m, r, c, x, y, w, h))
for attempt in range(1, 60):
    left = [j for j in jobs if not os.path.exists(os.path.join(out, f"{j[0]}_{j[1]}_{j[2]}.tif"))]
    if not left: print("FERDIG"); sys.exit(0)
    print(f"forsøk {attempt}: {len(left)} fliser igjen", flush=True)
    for m, r, c, x, y, w, h in left:
        bbox = f"{E0 + x:.0f},{N0 + y:.0f},{E0 + x + w:.0f},{N0 + y + h:.0f}"
        for host in HOSTS:
            url = (f"https://{host}/skwms1/wcs.hoyde-{m}-nhm-25833?service=WCS&version=1.0.0&request=GetCoverage"
                   f"&coverage=nhm_{m}_topo_25833&format=GeoTIFF&crs=EPSG:25833&response_crs=EPSG:25833&bbox={bbox}&width={w}&height={h}")
            try:
                data = urllib.request.urlopen(url, timeout=180).read()
                if data[:4] in (b"II*\x00", b"MM\x00*"):
                    open(os.path.join(out, f"{m}_{r}_{c}.tif"), "wb").write(data)
                    print(f"  ok {m} {r},{c} ({len(data)//1024} kB) via {host}", flush=True); break
                print(f"  {m} {r},{c}: ikke tiff via {host}: {data[:60]!r}", flush=True)
            except Exception as e:
                print(f"  {m} {r},{c}: feil via {host}: {str(e)[:80]}", flush=True)
    time.sleep(120)
print("GA OPP"); sys.exit(1)
