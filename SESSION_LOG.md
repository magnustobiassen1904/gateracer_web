# SESSION_LOG — gateracer_web

## Neste prioritet
Magnus tester det store kartet (Funkelia-sprinten) og sektortidene. Deretter: ghost-bil av beste runde,
touch-styring, «mal huset ditt», ytelse på svakere maskiner (55 000 trær + 1,3 M terrengpunkter).

---

## 2026-09-11 — Sesjon 1: fra idé til kjørbar MVP

**Bakgrunn.** Magnus spurte om en app der man tegner en F1-bane på Google Maps-gatebilder og kjører den.
Konklusjon: Street View kan ikke brukes som spillverden (ToS forbyr lagring/avledede verk, og bildene er
stillbilder). Valgt retning: stilisert lavpoly-verden fra åpne kartdata, med ekte høyder fra Kartverkets laserdata.

**Beslutninger.**
- Web-først (three.js i nettleser), ingen app-butikk, ingen backend. Fysikk er egen arkademodell, ingen fysikkmotor.
- Ekte høyder: Kartverkets overflatemodell (DOM) minus terrengmodell (DTM) gir høyde på hus og enkelttrær.
  Takhøyde tas som absolutt 80-persentil av DOM i fotavtrykket (robust på skrå tomter).
- Google-bilder på fasader: nei, ToS. Alternativer notert i README/samtale (OSM-tagger, brukeren maler selv).
- Prosjektnavn `gateracer_web`, mappe `~/Magnus_Tobiassen_local/Developer/gateracer_web/`.

**Gjort.**
- Konseptrender i Python (ren PIL) fra OSM-data, mot sør fra 59.6655, 9.6408 → bekreftet at layout er gjenkjennbart.
- `tools/build_world.py`: OSM + GeoTIFF → `data/world.json` (terreng 2 m, 601 bygninger, 375 veier, 3323 trær).
- `tools/fetch_kartverket.sh`: henter DTM/DOM via WCS med retry. Kartverket ga 503/504 i ca. 40 min, så kom det.
- `web/`: tegnemodus (klikk på kart, Dijkstra-snapping til kjørbare veier, auto-lukking), kjøremodus
  (terreng, ekstruderte hus, instanserte trær, bane med kantsteiner og mållinje, chase-kamera, skygger),
  bilfysikk (sykkelmodell, gress bremser, kollisjon mot husfotavtrykk), runde-/bestetid med checkpoints.
- Testet med headless Chrome (Chrome-utvidelsen var ikke tilkoblet). Fikset feil vindingsrekkefølge på terrenget
  (usynlig terreng).

**Resultat fra lidar.** 543 av 601 hus fikk høyde fra laser (median 5,0 m, maks 13,7 m). 3323 trær med ekte høyde.

**Ikke testet.** Selve kjørefølelsen (kan ikke kjøres headless). Touch/mobil finnes ikke ennå.

**Commits.**
- `5825b51 Initial MVP: draw a track on real Kongsberg streets and race it` — verden, app, verktøy, README.

### Runde 2 samme dag — «Sykt bra. Jeg vil ha mer.»
Magnus testet: morsomt. Ønsker: større kart (mer av Kongsberg, Funkelia), hus som ikke står i veien,
flere/lagrede baner, minikart, sektortider.

**Gjort.**
- Område utvidet til 3,6 × 3,2 km (`tools/area.json`): sentrum, Lågen, Funkelia, Skimore. 32 Kartverket-fliser
  à 1 km hentet med `tools/fetch_kartverket.py` (Kartverket svarte denne gangen). OSM: 5 361 hus, 2 939 veier.
- `build_world.py` skrevet om: asymmetrisk område, fliser, multipolygon-relasjoner (elva!), elver som linjer,
  terreng til binærfil (3 m), tretynning (tett nær vei, glissent i skog, 55 063 trær). 4 822 hus med laserhøyde.
- App: indeksert terreng, sprint-modus (punkt til punkt) i tillegg til sløyfe, hus innen 4,5 m fra banesenter
  skjules automatisk (og kolliderer ikke), «Fjern hus»-modus med lagring, lagrede løyper med navn, minikart,
  tre sektorer med blå porter og differanse mot beste sektor, to eksempelløyper (sentrum, Funkelia-sprint).
- Testet med headless Chrome: begge moduser rendrer uten feil.

**Ikke testet.** Kjørefølelse og ytelse i ekte nettleser med det store datasettet.
- `b93eb2e Expand to 3.6x3.2 km of Kongsberg; sprint mode, sectors, minimap, saved tracks`
