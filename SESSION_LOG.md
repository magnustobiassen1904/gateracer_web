# SESSION_LOG — gateracer_web

## Neste prioritet
Magnus tester «søk på byen din» på PC og telefon, og deler lenken. Se etter: steder der Kartverket mangler laserdata,
tette byer på 4–5 km (byggetid og bildefrekvens), og om anslaget på byggetid treffer på vanlig hjemmenett. Kjente svakheter: kameraet kan henge seg opp i liggende
mobilvisning (Magnus rapporterte det, ikke fikset, mobil er nedprioritert). Videre: toppliste (Supabase, krever
bevisst beslutning om persondata), «mal huset ditt».

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

### Runde 3 samme dag — hele Kongsberg + GitHub Pages
Magnus: «sykt morsomt». Ønsker Skarpåsveien, Madsebakken, Kjennerudvannet, Teknologiparken/Kongsberg bru, og en
lenke å dele.

**Gjort.**
- Område 5,5 × 5,4 km (`tools/area.json`). 72 Kartverket-fliser. OBS: gamle fliser med samme navn måtte slettes
  først (fetch-scriptet hopper over filer som finnes). 10 842 hus (9 677 laser), 5 157 veier, 90 000 trær
  (alle nær vei + tilfeldig utvalg i skog).
- Terreng i biter à 450 m med to detaljnivåer (full/1:4) som byttes etter avstand til bilen. Nødvendig: 3,3 M punkter.
- Mobil: touch-knapper, pinch-zoom, ingen skygger, halve trærne. `?mobile=1` for test.
- Attribusjon OSM/Kartverket i spillet og README. Eksempel 3: sløyfe over Kongsberg bru ved Teknologiparken.
- Repo opprettet offentlig: github.com/magnustobiassen1904/gateracer_web, GitHub Pages fra main.
  Offentlig var nødvendig for gratis Pages. Ingen persondata i repoet.

**Ikke testet.** Ytelse på ekte mobil. Datamengden per innlasting er ca. 16 MB ukomprimert.

### Runde 4 samme dag — telefon + løype i lenken
Spørsmål fra Magnus: ser andre løypene jeg lagrer? Svar: nei, alt er lokalt (ingen server). Tre alternativer lagt
fram; Magnus valgte 1 (løype i lenken) og ba om at det skal fungere på telefon.

**Gjort.**
- Responsivt: verktøylinjen brytes over flere rader, mindre HUD/minikart under 700 px, ingen zoom ved dobbelttrykk.
- Terreng i full oppløsning bygges nå lat (bare biter innen 330 m på mobil / 700 m på desktop) og kastes når
  bilen kjører videre. Før lå 3,3 M punkter i minnet fra start, som trolig hadde knekt iPhone-Safari.
- Touch-knapper bruker pointer capture (slapp gassen når fingeren gled litt før).
- «Del lenke»: løypa (node-id-er + sløyfe/sprint + navn) i URL-hash, lastes ved åpning.

**Ikke testet.** Fortsatt ingen ekte telefon i hus. Headless-test i 390 px bredde ser riktig ut.

### Runde 5 samme dag — liggende telefon + fotgjengere
Magnus bekreftet at mobil funker. Ønsker: kjøre med telefonen liggende, og «dummy folk» i gatene som flyr
av gårde «helt jelly» når man treffer dem.

**Gjort.**
- Mobil under kjøring: verktøylinjen skjules, egen «← Tegn»-knapp, forsøk på fullskjerm + orientation.lock
  (fungerer på Android, ikke iOS; på iOS må man snu telefonen selv). Egen CSS for lav høyde (liggende).
- Fotgjengere (64 på desktop, 28 på mobil) med enkel lavpoly-kropp, går langs banen på begge sider og krysser
  veien av og til. Treff (< 1,9 m, fart > 5 km/h): kastes i bilens retning med spinn og squash/stretch-«jelly»,
  spretter, blir liggende 5 s, respawner. Teller i HUD, morsomme utrop.
- `b93eb2e Expand to 3.6x3.2 km of Kongsberg; sprint mode, sectors, minimap, saved tracks`
- `46474a1 Whole Kongsberg (5.5x5.4 km), LOD terrain, touch controls, GitHub Pages`
- `f43cc76 Phone support and share links`
- `337e0a6 Pedestrians with jelly ragdoll, landscape phone mode`

### Runde 6 (12.09) — F1-følelse, startlys, ghost, kjøretøy, free roam
Magnus: «funker knallbra på PC». Ønsket startlys, ghost av beste runde, mer F1-look, valgbare biler med spaker,
færre hus revet, rett linje der det ikke er vei, free roam, og publikum som heier.

**Gjort.**
- **Startlys:** fem røde lyspar på en portal over startlinja (og i HUD), fylles ett per 0,9 s, tilfeldig pause
  0,3–3 s, så slukkes alle. Gass før det = 2 sekunders straff (ikke omstart, som ga evig løkke).
- **Ghost:** beste runde lagres som posisjonsspor (20 Hz, kvantisert) i localStorage per løype. Neste runde
  spilles den av som gjennomsiktig bil, og HUD viser live differanse mot ghosten per baneposisjon.
- **Kjøretøy:** fem presets (Formel 1, rask bil, tung bil, motorsykkel, sykkel) med egne 3D-modeller og
  fysikkparametre, pluss «Egen bil» med fem spaker. Dra i en spake og presetet kopieres til din egen bil.
- **F1-look:** ny F1-modell (halo, sidekasser, vinger med endeplater, oppheng), dashbord med gir og turtallslys,
  FOV og kamerahøyde som følger farten, kameraskjelving, fartsvignett, dekkrøyk, sektorfarger (lilla/grønn/gul),
  hvite kantlinjer langs banen.
- **Smalere bane i stedet for husriving:** midtlinja skyves mot midten av korridoren mellom husene, og bredden
  varierer 4,6–7,0 m. Hus fjernes bare når de står inne i minstebredden: 4 mot 13 før på sentrumsløypa.
- **Rett linje / hopp:** «Rett linje» gir punkter utenfor veinettet, og manglende rute gir automatisk rett linje.
  Ny lufthåndtering: bilen tar av over kuler og mister fart i landingen.
- **Free roam:** kjør fritt uten løype/klokke, start på nærmeste ordentlige gate, minikart følger bilen.
- **Publikum:** grupper på 3–8 som står og heier med flagg og bannere langs banen. Fotgjengere flyttet fra
  banerelativ til veirelativ utplassering, så de finnes overalt (også i free roam), og hver person er nå én
  sammenslått mesh av ytelsesgrunner.

**Feil funnet og rettet underveis (alle funnet med den nye simuleringstesten, ikke synlige i skjermbilder):**
1. Baneposisjonen låste seg til motsatt kjøreretning der løypa går tilbake langs samme gate. Nå søkes det i et
   smalt vindu framover, og retningen må stemme med bilens.
2. Hus kunne stå inne i den smale banen. Nå måles faktisk avstand til fotavtrykket (2,55 m fra midtlinja).
3. Treff i husvegg ga full stopp. Nå skraper bilen langs veggen, og kiler den seg helt fast, bergers den tilbake.
4. Startportalens bjelker sto langs banen i stedet for på tvers, og lampene vendte bort fra bilen.
5. Lyssekvensen ble drevet av bildefrekvens og stoppet i headless. Nå drives all spilltid av en klokkefunksjon
   som kan simuleres.

**Ny testinfrastruktur.** `?sim=N&auto=V` kjører fysikken med fast tidssteg og virtuell klokke uten å tegne, og
logger runder, sektorer, ghost, treff, banebredde og lukkegap. Dette avslørte alle fem feilene over; ingen av dem
var synlige i skjermbilder. Dokumentert i README.

**Ikke gjort.** Kamerafeilen i liggende mobilvisning. Mobil er nedprioritert etter Magnus' beskjed.
- `6ea3c88 F1 start lights, best-lap ghost, vehicle garage, free roam, narrower track`

### Runde 7 (12.09) — hopp fjernet, free roam uten bremsing
Magnus: bilen fløy opp i ulendt terreng og mistet bakkekontakt, «likte det bedre som det var før». Ville også
kjøre like fort overalt i free roam, og ikke bremses av å treffe folk.

**Gjort.**
- All lufthåndtering fjernet. Bilen følger bakken hele tiden (`car.z = terrengZ + 0,18`). Dette reverserer
  hoppene fra runde 6 med vilje, på Magnus' beskjed. «Rett linje» finnes fortsatt, men gir nå bare snarveier.
- Free roam: `onRoad` er alltid sant, så gress og grus bremser ikke. Asfalt måles fortsatt separat, men bare
  for å velge farge på støvet.
- Fotgjengertreff koster ikke lenger fart. NB: Magnus' formulering var tvetydig («gjerne også at du blir bremset
  ... det synes jeg er dumt, for da går det så sakte»); tolket som at fartstapet skulle bort. Flagget til ham.

**Feil funnet og rettet.** Bergingen ved fastkiling utløstes aldri: telleren ble nullstilt hvert bilde så lenge
bilens egen posisjon var klar, selv om ingen bevegelse var mulig. Nå nullstilles den bare når bilen faktisk
flytter seg, eller når spilleren ikke gir gass. Bergingen bruker også veirutenettet i stedet for å skanne alle
20 000 veisegmenter. Funnet med free roam-simuleringen (`?free=1&sim=3000`), som nå også holder gassen inne.
- `0c48acf Keep the car on the ground, no speed loss off-road or from hits`

### Runde 8 (14.09) — hele Norge: søk, sirkel eller tegn selv, bygges i nettleseren
Magnus: søk på byen sin eller klikk på kartet, velg størrelse, og kartet bygges og åpnes. Underveis: sirkel med
diameter-spake eller tegn området selv, og anslått byggetid både ved valg og under bygging.

**Beslutninger.**
- Byggingen flyttes til nettleseren (Web Worker). Ingen server, ingen kostnad, GitHub Pages holder. Mulig fordi
  Kartverket (WCS, stedsnavn, adresser, kartfliser) og OSM-flisene tillater direkte henting fra nettsider (CORS), testet.
- **Overpass droppet som datakilde.** Den offentlige serveren svarte med tidsavbrudd selv på en bitte liten
  forespørsel hele formiddagen 14.09, og to reservespeil var nede. Byttet til OpenStreetMaps offisielle vektorfliser
  (CDN, under et halvt sekund per flis), med VersaTiles som reserve. Pris: ingen hustyper/farger fra OSM (hushøyde
  kommer uansett fra laser), og veinettet må kobles ved å slå sammen punkter.
- **maps.mail.ru bevisst utelatt** (Overpass-speil drevet av VK i Russland) av personvernhensyn. Flagget.
- Kartverket-WCS gir 0 over hav/utenfor Norge og float32-minimum der data mangler. Håndteres, med reserve til
  åpne terrengfliser og gjettede hushøyder.
- Område som sirkel (0,5–5 km, mobil maks 3 km) eller polygon. Utenfor området tegnes dempet terreng uten hus, trær
  og veier, og bilen stoppes ved grensen.
- Byggetidsanslag kalibrert mot testbygg i Node: 1 km 3–6 s, 2 km ca. 4 s, 4 km 7,7 s. I Chrome: 2 km 7,6 s.
  Anslaget legger på margin for 5 MB/s hjemmenett og 3D-tegning. Under bygging vises brukt tid og gjenstående tid,
  som går over fra anslag til faktisk tempo etter 15 %.
- Løyper, bestetider og ghost lagres per sted. Kongsberg beholder gamle nøkler, så eksisterende tider overlever.

**Verifisert.**
- Hushøyder fra nettleserbygget mot Python-bygget for samme 1 km-område: 543 hus matchet, median avvik 0,00 m,
  99 % under 0,5 m. Høyde i origo 171,4 m i begge.
- Bygget Kongsberg (1, 2 og 4 km), Bergen, Tromsø og Gjøvik. Søk, sirkel, tegn selv, bygging, lagret kart (0,5 s
  andre gang), delelenke med sted og løype, løypekjøring og free roam på generert kart, mobil-intro.
- Regresjon: ferdigbygd Kongsberg gir identisk rundetid i simuleringen (95,37 s).

**Feil funnet og rettet underveis.**
1. Protobuf-dekoderen leste posisjonen før lengdefeltet (JavaScript evaluerer `pos + varint()` fra venstre).
2. Tromsø fikk laveste høyde −1,3 × 10³⁸: Kartverkets nodata-verdi. Nå satt til 0.
3. Bergen fikk nesten ikke vann: havet ligger i et eget `ocean`-lag. Lagt til, og havbunn under vann flates til 0.
4. Stedsnavn fra tegnemodus lekket over til sirkelmodus.
5. Node-testen ble avvist av Overpass uten User-Agent (406/429). Gjaldt bare testen, ikke nettleseren.

**Nye verktøy.** `tools/gen_test.mjs` (bygger i Node med tider) og `tools/browser_test.py` (styrer ekte Chrome).
