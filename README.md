# gateracer_web

Tegn din egen racerbane på ekte gater og kjør den i nettleseren. Området er 3,6 × 3,2 km av Kongsberg
(sentrum, Lågen, vestsiden opp til Funkelia og Skimore), origo i Mauritz Hansens gate (59.665499, 9.640823).

## Hva som er ekte data

| Element            | Kilde                                              | Hvordan                                                                 |
|--------------------|----------------------------------------------------|-------------------------------------------------------------------------|
| Veier og gatenavn  | OpenStreetMap (Overpass API)                       | Kjørbare veier blir graf som løypa snapper til                          |
| Husenes omriss     | OpenStreetMap                                      | Fotavtrykk ekstruderes til 3D                                           |
| Husenes høyde      | Kartverket, nasjonal høydemodell, overflatemodell  | 80-persentil av overflatemodellen inne i fotavtrykket = takhøyde         |
| Terreng            | Kartverket, terrengmodell 1 m                      | Nedsamplet til 3 m grid, binærfil `data/terrain.bin`                     |
| Trær (posisjon og høyde) | Overflatemodell minus terrengmodell          | Lokale topper ≥ 3 m utenfor bygninger = ett tre hver                     |
| Skog, vann, jorder | OpenStreetMap                                      | Fargelegger terrenget                                                   |

Husfarger er tilfeldige (norsk palett) med mindre OSM har `building:colour`.

## Kjøre

```
cd ~/Magnus_Tobiassen_local/Developer/gateracer_web
python3 -m http.server 8080
```
Åpne http://localhost:8080/web/ i Chrome eller Safari.

- Klikk på veier for å legge punkter, løypa snapper til gatenettet. «Sløyfe» av = sprint (punkt til punkt).
- «Eksempel: sentrum» (sløyfe) og «Eksempel: Funkelia» (sprint opp Funkeliaveien til Skimore).
- Lagre løyper med navn (lokalt i nettleseren), hent dem fra «Mine løyper…».
- Hus som ligger i veien for banen fjernes automatisk. «Fjern hus» lar deg klikke bort flere manuelt (huskes).
- Kjør: piltaster eller WASD, mellomrom = håndbrekk, R = tilbake til start.
- Tre sektorer med blå porter; HUD viser sektortid og differanse mot beste sektor. Minikart oppe til høyre.
- Bestetid og beste sektorer per løype lagres lokalt i nettleseren.

Test-URL-er: `?demo=1` (sentrum) / `?demo=2` (Funkelia) starter direkte, `&drive=3` gir gass i 3 sekunder,
`&top=140` viser banen ovenfra (feilsøking).

## Bygge verdenen på nytt (nytt sted eller ny data)

1. Sett område i `tools/area.json` (origo, utstrekning i meter, terrengcelle).
2. Hent OSM: `data/query.overpass` (juster bbox) → `data/osm_raw_big.json` via Overpass API.
3. `./venv/bin/python tools/fetch_kartverket.py` henter 1 m-fliser til `data/tiles/` (prøver igjen ved 504).
4. `./venv/bin/python tools/build_world.py` skriver `data/world.json`, `terrain.bin`, `terrain_cls.bin`.

Venv: `python3 -m venv venv && ./venv/bin/pip install numpy pillow pyproj tifffile imagecodecs scipy`

## Eksterne tjenester

Kun ved bygging av data (ikke ved kjøring): Overpass API (OSM) og Kartverkets WCS.
Ved kjøring lastes three.js fra jsdelivr CDN. Ingen brukerdata sendes noe sted.
