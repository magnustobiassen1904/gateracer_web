# gateracer_web

Tegn din egen racerbane på ekte gater og kjør den i nettleseren.

**Spill:** https://magnustobiassen1904.github.io/gateracer_web/

Området er 5,5 × 5,4 km av Kongsberg: sentrum, Lågen, Funkelia og Skimore i vest, Madsebakken, Skarpåsveien og
Kjennerudvannet i øst, Teknologiparken og Kongsberg bru i sør. Origo i Mauritz Hansens gate (59.665499, 9.640823).

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
- Eksempler: «sentrum» (sløyfe), «Funkelia» (sprint opp Funkeliaveien til Skimore), «Teknologiparken» (sløyfe over Kongsberg bru).
- Mobil: pinch-zoom på kartet, knapper på skjermen for gass/brems/sving. Skygger og halvparten av trærne er slått av,
  terrenget i full oppløsning bygges bare rundt bilen (330 m) og kastes når man kjører videre.
- Lagre løyper med navn (lokalt i nettleseren), hent dem fra «Mine løyper…».
- «Del lenke» kopierer en adresse som åpner spillet med løypa ferdig tegnet (`#t=L<node-id-er>&n=<navn>`).
  Bestetider ligger fortsatt bare lokalt hos hver spiller.
- Hus som ligger i veien for banen fjernes automatisk. «Fjern hus» lar deg klikke bort flere manuelt (huskes).
- Kjør: piltaster eller WASD, mellomrom = håndbrekk, R = tilbake til start.
- Tre sektorer med blå porter; HUD viser sektortid og differanse mot beste sektor. Minikart oppe til høyre.
- Bestetid og beste sektorer per løype lagres lokalt i nettleseren.

Test-URL-er: `?demo=1` (sentrum) / `?demo=2` (Funkelia) / `?demo=3` (Teknologiparken) starter direkte, `&mobile=1` tvinger mobilmodus, `&drive=3` gir gass i 3 sekunder,
`&top=140` viser banen ovenfra (feilsøking).

## Bygge verdenen på nytt (nytt sted eller ny data)

1. Sett område i `tools/area.json` (origo, utstrekning i meter, terrengcelle).
2. Hent OSM: `data/query.overpass` (juster bbox) → `data/osm_raw_big.json` via Overpass API.
3. `./venv/bin/python tools/fetch_kartverket.py` henter 1 m-fliser til `data/tiles/` (prøver igjen ved 504).
4. `./venv/bin/python tools/build_world.py` skriver `data/world.json`, `terrain.bin`, `terrain_cls.bin`.

Venv: `python3 -m venv venv && ./venv/bin/pip install numpy pillow pyproj tifffile imagecodecs scipy`

## Publisering

GitHub Pages fra `main`, rot. `index.html` i rot videresender til `web/`. Push til `main` = ny versjon live etter 1–2 min.

## Lisens og attribusjon

Kartdata i `data/` er avledet fra OpenStreetMap (© OpenStreetMap-bidragsytere, ODbL 1.0) og Kartverkets
nasjonale høydemodell (CC BY 4.0). Attribusjon vises i spillet. Koden er Magnus Tobiassens.

## Eksterne tjenester

Kun ved bygging av data (ikke ved kjøring): Overpass API (OSM) og Kartverkets WCS.
Ved kjøring lastes three.js fra jsdelivr CDN. Ingen brukerdata sendes noe sted.
