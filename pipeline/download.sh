#!/usr/bin/env bash
# Downloads input data: the OSM extract, the Ruse GTFS this project writes
# itself, MapLibre GL. Everything is cached — re-running only fetches what is
# missing.
#
# There is NO Ruse GTFS to download: the city is not among the 14 datasets on
# the Bulgarian National Access Point, and neither Transitous, the
# MobilityDatabase nor trinmo.org carries it. pipeline/ruse-feed.mjs writes the
# feed from the operator's own timetable pages instead — which means the OSM
# step has to run FIRST, because the feed geocodes its stop names against the
# poles cut out of the extract.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/gtfs data/osm/tiles web/vendor

# pyosmium does the cutting; it is the one dependency outside Node here.
need_osmium () {
  python3 -c "import osmium" 2>/dev/null && return 0
  echo "brak pakietu osmium — zainstaluj: pip3 install --user osmium" >&2
  return 1
}

# 1) OSM — from the Geofabrik extract, not Overpass.
#    2 x 2 road tiles out of the Bulgarian Geofabrik extract, plus
#    data/osm/ruse-stops.json — every named bus-stop node in the frame, which
#    is what ruse-feed.mjs geocodes the timetable against.
#    pipeline/pbf-tiles.py cuts the tiles out of the .pbf and writes exactly the
#    JSON shape Overpass would have returned (ways with tags, NODE IDS and
#    geometry — buildGraph silently drops ways without el.nodes).
if [ ! -f data/osm/tiles/t4.json ] || [ ! -f data/osm/ruse-stops.json ]; then
  need_osmium
  if [ ! -f data/bulgaria-latest.osm.pbf ]; then
    echo "== Geofabrik bulgaria-latest.osm.pbf =="
    curl -fL --retry 5 --retry-delay 5 -C - --max-time 3600 -o data/bulgaria-latest.osm.pbf \
      "https://download.geofabrik.de/europe/bulgaria-latest.osm.pbf"
  fi
  echo "== cutting OSM tiles out of the extract =="
  python3 pipeline/pbf-tiles.py
fi

# 2) GTFS — scraped and geocoded, not downloaded
if [ ! -f data/gtfs/routes.txt ]; then
  echo "== transport-ruse.com timetables + OSM geocoding -> data/gtfs =="
  node pipeline/ruse-feed.mjs
fi

# 2b) Giurgiu — the Romanian half of the frame: 2 x 2 road tiles (t5..t8) and
#     the named features of the town, cut out of the Geofabrik ROMANIA extract
#     (shared with the other Romanian maps of the family, in ../_pbf/).
if [ ! -f data/osm/tiles/t8.json ] || [ ! -f data/osm/giurgiu-names.json ]; then
  need_osmium
  mkdir -p ../_pbf
  if [ ! -f ../_pbf/romania-latest.osm.pbf ]; then
    echo "== Geofabrik romania-latest.osm.pbf =="
    curl -fL --retry 5 --retry-delay 5 -C - --max-time 3600 -o ../_pbf/romania-latest.osm.pbf \
      "https://download.geofabrik.de/europe/romania-latest.osm.pbf"
  fi
  echo "== cutting the Giurgiu tiles out of the Romanian extract =="
  python3 pipeline/pbf-tiles-giurgiu.py
fi

# 2c) Giurgiu GTFS — written from the TRACUM timetable + OSM, not downloaded
if [ ! -f data/gtfs-giurgiu/routes.txt ]; then
  echo "== TRACUM timetable + OSM -> data/gtfs-giurgiu =="
  node pipeline/giurgiu-feed.mjs
fi

# 3) MapLibre GL (vendored, no CDN at runtime)
if [ ! -f web/vendor/maplibre-gl.js ]; then
  echo "== MapLibre GL =="
  curl -fL --retry 3 -o web/vendor/maplibre-gl.js  https://unpkg.com/maplibre-gl@5.6.1/dist/maplibre-gl.js
  curl -fL --retry 3 -o web/vendor/maplibre-gl.css https://unpkg.com/maplibre-gl@5.6.1/dist/maplibre-gl.css
fi

echo "OK — data ready:"
du -sh data/gtfs data/osm 2>/dev/null || true
