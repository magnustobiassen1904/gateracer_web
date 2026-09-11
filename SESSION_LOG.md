# SESSION_LOG — gateracer_web

## Neste prioritet
Magnus tester kjørefølelsen i nettleseren (http://localhost:8080/web/). Avgjør: er det gøy nok til å gå videre?
Deretter: mobil-/touch-styring, «mal huset ditt», ghost-runder.

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
- `Initial MVP: draw a track on real Kongsberg streets and race it` — verden, app, verktøy, README.
