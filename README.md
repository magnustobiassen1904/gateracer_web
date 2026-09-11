# gateracer_web

Tegn din egen racerbane på ekte gater og kjør den i nettleseren. MVP bygget rundt
Mauritz Hansens gate i Kongsberg (59.665499, 9.640823).

## Hva som er ekte data

| Element            | Kilde                                              | Hvordan                                                                 |
|--------------------|----------------------------------------------------|-------------------------------------------------------------------------|
| Veier og gatenavn  | OpenStreetMap (Overpass API)                       | Kjørbare veier blir graf som løypa snapper til                          |
| Husenes omriss     | OpenStreetMap                                      | Fotavtrykk ekstruderes til 3D                                           |
| Husenes høyde      | Kartverket, nasjonal høydemodell, overflatemodell  | 80-persentil av overflatemodellen inne i fotavtrykket = takhøyde         |
| Terreng            | Kartverket, terrengmodell 1 m                      | Nedsamplet til 2 m grid                                                 |
| Trær (posisjon og høyde) | Overflatemodell minus terrengmodell          | Lokale topper ≥ 3 m utenfor bygninger = ett tre hver                     |
| Skog, vann, jorder | OpenStreetMap                                      | Fargelegger terrenget                                                   |

Husfarger er tilfeldige (norsk palett) med mindre OSM har `building:colour`.

## Kjøre

```
cd ~/Magnus_Tobiassen_local/Developer/gateracer_web
python3 -m http.server 8080
```
Åpne http://localhost:8080/web/ i Chrome eller Safari.

- Klikk på veier for å legge punkter, løypa snapper til gatenettet og lukkes automatisk.
- «Eksempel-løype» legger inn en ferdig sløyfe.
- Kjør: piltaster eller WASD, mellomrom = håndbrekk, R = tilbake til start.
- Bestetid per løype lagres lokalt i nettleseren.

Test-URL-er: `?demo=1` starter eksempelløypa direkte, `&drive=3` gir gass i 3 sekunder,
`&top=140` viser banen ovenfra (feilsøking).

## Bygge verdenen på nytt (nytt sted eller ny data)

1. Endre `LAT0, LON0` i `tools/build_world.py` og bbox i Overpass-spørringen (hent ny `data/osm_raw.json`).
2. Oppdater `E0/N0` i `tools/fetch_kartverket.sh` og kjør den (henter `data/dtm.tif` og `data/dom.tif`).
   Kartverkets WCS er tidvis nede (504); scriptet prøver igjen hvert 3. minutt.
3. `./venv/bin/python tools/build_world.py` skriver `data/world.json`.

Venv: `python3 -m venv venv && ./venv/bin/pip install numpy pillow pyproj tifffile imagecodecs scipy`

## Eksterne tjenester

Kun ved bygging av data (ikke ved kjøring): Overpass API (OSM) og Kartverkets WCS.
Ved kjøring lastes three.js fra jsdelivr CDN. Ingen brukerdata sendes noe sted.
