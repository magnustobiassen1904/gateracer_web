#!/bin/zsh
# Henter terrengmodell (DTM) og overflatemodell (DOM), 1 m, fra Kartverkets WCS for 900x900 m rundt origo.
# Prøver på nytt til det lykkes (tjenesten er tidvis nede). Skriver data/dtm.tif og data/dom.tif.
cd "$(dirname "$0")/.."
E0=198281.07; N0=6626351.79; H=450
BBOX="$(printf '%.0f' $((E0-H))),$(printf '%.0f' $((N0-H))),$(printf '%.0f' $((E0+H))),$(printf '%.0f' $((N0+H)))"
for try in {1..40}; do
  for s in dtm dom; do
    [ -s data/$s.tif ] && continue
    for host in wcs.geonorge.no wms.geonorge.no; do
      curl -s -m 120 "https://$host/skwms1/wcs.hoyde-$s-nhm-25833?service=WCS&version=1.0.0&request=GetCoverage&coverage=nhm_${s}_topo_25833&format=GeoTIFF&crs=EPSG:25833&response_crs=EPSG:25833&bbox=$BBOX&width=900&height=900" -o data/$s.tmp
      if file data/$s.tmp | grep -q TIFF; then mv data/$s.tmp data/$s.tif; echo "$(date +%H:%M) $s OK via $host"; break; else echo "$(date +%H:%M) $s feilet via $host: $(head -c 80 data/$s.tmp | tr -d '\n')"; rm -f data/$s.tmp; fi
    done
  done
  [ -s data/dtm.tif ] && [ -s data/dom.tif ] && { echo FERDIG; exit 0; }
  sleep 180
done
echo "GA OPP etter 40 forsøk"; exit 1
