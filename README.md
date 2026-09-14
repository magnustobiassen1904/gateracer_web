# gateracer_web

Tegn din egen racerbane på ekte gater, hvor som helst i Norge, og kjør den i nettleseren.

**Spill:** https://magnustobiassen1904.github.io/gateracer_web/

Startsiden er et kart over Norge. Søk opp et sted eller zoom inn, og klikk rett på gatene der løypa skal gå. Løypa
følger veinettet av seg selv (veiene hentes fra OpenStreetMap-flisene mens du zoomer). Trykk «Kjør!», så bygges
området rundt løypa (omsluttende rektangel + 200 m) og løpet starter direkte. Er løypa innenfor et område som er
bygget fra før, gjenbrukes det og løpet starter på et par sekunder. «Ny løype» i løpet tar deg tilbake til kartet med
løypa klar til redigering. Fanen «Free roam» bygger en sirkel du velger og slipper deg løs.

Løyper du har kjørt ligger under «Dine løyper». Bestetider og ghost følger løypa (punktenes posisjon i grader), ikke
området, så de overlever at området bygges på nytt. Det gamle Kongsberg-kartet med egen tegneside nås bare via gamle
lenker (`?map=kongsberg`).

## Hvordan et kart bygges i nettleseren

`web/worldgen.js` kjører i en bakgrunnstråd (Web Worker) og gjør det samme som `tools/build_world.py`:

1. **Kartdata:** henter OpenStreetMaps offisielle vektorfliser (zoom 14) for området. Reserve: VersaTiles.
   Hus og veier kuttes mot flisekantene og mot området. Veier kobles til et veinett ved å slå sammen punkter som
   ligger innen en halv meter av hverandre. Veier i tunnel tas ikke med.
2. **Laserdata:** terrengmodell og overflatemodell fra Kartverkets WCS, 1–2,5 m oppløsning etter områdets størrelse,
   hentet i biter på 1000 × 1000 piksler og lest med en egen liten GeoTIFF-leser (`readTiff`).
3. **Hushøyder:** 80-persentilen av overflatemodellen inne i hvert hus, minus bakken.
4. **Trær:** lokale topper i overflate minus terreng, tett nær vei og glissent i skog, maks 90 000.
5. **Terreng:** 3 m rutenett, arealklasser (skog, vann, hav, jorder …), og en egen klasse for alt utenfor området.

Kartverket gir høyde 0 over hav og utenfor Norge, og et enormt negativt tall der data mangler. Er over 97 % av
området nøyaktig 0, eller svarer Kartverket ikke, faller byggeren tilbake til åpne terrengfliser (Terrarium, ca. 5 m)
og gjettede hushøyder. Spilleren får beskjed.

Bygde kart lagres i IndexedDB (de 5 siste). `GEN_VERSION` i `worldgen.js` og `intro.js` må økes når byggemetoden
endres, ellers brukes gamle lagrede kart.

Vektorflis-koden (henting, dekoding, klipping) ligger i `web/osmtiles.js` og brukes både av startsiden og byggeren.
Kartverkets filer kan være «glisne»: deler uten data (typisk over vann) har adresse 0 og leses som 0.

Koordinater regnes om fra GPS til EUREF89 UTM 33 i `web/utm.js` (Krügers serier, under 1 mm avvik fra pyproj).

### Lenker

- Sirkel: `web/?lat=59.66550&lon=9.64082&d=2&by=Kongsberg`
- Tegnet område: `web/?poly=lat,lon;lat,lon;lat,lon&by=Navn`
- Ferdigbygd Kongsberg: `web/?map=kongsberg`. Gamle delte lenker uten sted åpner også Kongsberg.
- En delt løype legges bak `#t=` og fungerer på alle steder. `&go=1` starter løpet direkte, `#go=free` starter free roam.
- Startsiden med en løype til redigering: `web/#edit=L;lat,lon,1;lat,lon,1;…` (siste tall 1 = snappet til vei).

## Hva som er ekte data (ferdigbygd Kongsberg)

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
- «Rett linje» ignorerer veinettet: tegn snarveier over jorder og mark. Finner appen ingen kjørbar rute mellom
  to punkter, lager den en rett linje av seg selv.
- «Free roam»: kjør fritt i hele Kongsberg uten løype og uten klokke, med folk overalt. Her bremser ingenting:
  gress og grus går like fort som asfalt.
- Eksempler: «sentrum» (sløyfe), «Funkelia» (sprint opp Funkeliaveien til Skimore), «Teknologiparken» (sløyfe over Kongsberg bru).
- Mobil: pinch-zoom på kartet, knapper på skjermen for gass/brems/sving. Skygger og halvparten av trærne er slått av,
  terrenget i full oppløsning bygges bare rundt bilen (330 m) og kastes når man kjører videre.
- Lagre løyper med navn (lokalt i nettleseren), hent dem fra «Mine løyper…».
- «Del lenke» kopierer en adresse som åpner spillet med løypa ferdig tegnet (`#t=L<node-id-er>&n=<navn>`).
  Bestetider ligger fortsatt bare lokalt hos hver spiller.
- Banen blir smalere (ned til 4,6 m) der husene står tett, og midtlinja skyves mot midten av korridoren.
  Bare hus som står inne i minstebredden fjernes. «Fjern hus» lar deg klikke bort flere manuelt (huskes).
- Kiler du deg fast, settes bilen automatisk tilbake på banen etter drøyt ett sekund.
- Start: fem røde lys fylles ett for ett, og etter en tilfeldig pause slukkes de. Gass før det gir 2 sekunders straff.
- Kjør: piltaster eller WASD, mellomrom = håndbrekk, R = ny start, G = garasje.
- Garasje: fem ferdige kjøretøy (Formel 1, rask bil, tung bil, motorsykkel, sykkel) og spaker for toppfart,
  akselerasjon, veigrep, bremser og vekt. Dra i en spake og du får din egen bil.
- Ghost: setter du ny bestetid, lagres runden. Neste runde kjører en gjennomsiktig skygge av den foran deg,
  og HUD-en viser hvor mange sekunder foran eller bak du ligger akkurat nå.
- Bilen holder alltid kontakt med bakken, uansett hvor ulendt terrenget er. Ingen hopp.
- Fotgjengere går langs gatene og krysser av og til. Treffer du dem, flyr de av gårde (jelly-ragdoll) og telles i
  HUD, men du mister ikke fart av det.
  Langs banen står det også publikum i grupper og heier, med flagg og bannere.
- På telefon skjules verktøylinjen under kjøring, spillet ber om fullskjerm og liggende format der nettleseren tillater det.
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

## Testing av kartbyggeren

```
node --experimental-detect-module tools/gen_test.mjs 59.665499 9.640823 1 Kongsberg   # bygger uten nettleser, med tider
./venv/bin/python tools/browser_test.py                                              # hjelpeklasse for ekte Chrome
```

`tools/browser_test.py` styrer en ekte headless Chrome via DevTools-protokollen (krever `websocket-client` i venv).
Den trengs fordi `--virtual-time-budget` ikke venter på bakgrunnstråder. `?dump=1` skriver statistikk om kartet til
konsollen.

## Eksterne tjenester

Når en spiller bruker spillet, kontakter nettleseren deres disse tjenestene direkte. Ingen av dem krever konto eller
nøkkel, og spillet lagrer ingenting om spilleren utenfor spillerens egen nettleser.

| Tjeneste | Hva | Hva tjenesten ser |
|---|---|---|
| Kartverket kartfliser (cache.kartverket.no) | Bakgrunnskart på startsiden | IP-adresse, hvilket område kartet viser |
| Kartverket stedsnavn og adresser (ws.geonorge.no) | Søk og navn ved kartklikk | IP-adresse, søketeksten, klikkpunktet |
| Kartverket høydedata (wcs.geonorge.no) | Laserdata | IP-adresse, området som bygges |
| OpenStreetMap vektorfliser (vector.openstreetmap.org) | Veier, hus, skog, vann | IP-adresse, området som bygges |
| VersaTiles (tiles.versatiles.org) | Reserve for OpenStreetMap-fliser | Samme, bare hvis OSM-flisene feiler |
| Amazon S3 Terrain Tiles | Reserve for terreng hvis Kartverket svarer ikke | IP-adresse, området |
| jsdelivr og cdnjs | three.js og Leaflet | IP-adresse |

Bevisst utelatt: Overpass-speilet på maps.mail.ru (drives av VK, Russland).
