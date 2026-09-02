#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Cuts the OSM extracts this map needs out of a Geofabrik .pbf — same JSON shape
as Overpass ('elements': ways with tags, node ids and geometry), so build.mjs
cannot tell the difference. Overpass would not serve these at all on the day
they were built (504 from every mirror, even for a single small city box).

Ruse: 2 x 2 road tiles, plus one extra file this map alone needs —
data/osm/ruse-stops.json, every named bus stop node in the frame. Ruse
publishes its timetables as web pages with stop NAMES and no coordinates, so
pipeline/ruse-feed.mjs geocodes them against this file. No rail file: Ruse has
no tram, and its seven trolleybus lines ride the road graph like every
trolleybus in this family.
"""
import json, os, re, sys
import osmium

ROOT = os.path.join(os.path.dirname(__file__), '..')
PBFS = [os.path.join(ROOT, 'data', 'bulgaria-latest.osm.pbf')]

# must match pipeline/download.sh — the city, Basarbovo and Obraztsov Chiflik
# to the south, Srednya Kula west, the Danube (and the Romanian bank) north
S, N, W, E = 43.74, 43.90, 25.86, 26.10
# stop nodes are collected over the same frame, but only south of the Danube:
# Giurgiu sits 3 km across the river and its stops are named in Romanian
STOP_BOX = (43.74, 43.888, 25.86, 26.10)

HW = re.compile(r'^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|busway|construction|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$')
RAIL = re.compile(r'^(tram|light_rail|construction)$')

road_tiles = {}
for i in range(1, 5):
    f = os.path.join(ROOT, f'data/osm/tiles/t{i}.json')
    if os.path.exists(f):
        continue
    row, col = (i - 1) // 2, (i - 1) % 2
    road_tiles[i] = (S + (N - S) * row / 2, S + (N - S) * (row + 1) / 2,
                     W + (E - W) * col / 2, W + (E - W) * (col + 1) / 2)
need_rail = False
stops_file = os.path.join(ROOT, 'data/osm/ruse-stops.json')
need_stops = not os.path.exists(stops_file)
print('brakujące kafle dróg:', sorted(road_tiles), '| przystanki:', need_stops, flush=True)
if not road_tiles and not need_stops:
    sys.exit(0)
os.makedirs(os.path.join(ROOT, 'data/osm/tiles'), exist_ok=True)

out = {i: [] for i in road_tiles}
out_stops = []


class H(osmium.SimpleHandler):
    def way(self, w):
        tags = w.tags
        hw = tags.get('highway')
        rw = tags.get('railway')
        is_road = bool(road_tiles) and hw is not None and HW.match(hw)
        is_rail = False
        if not is_road and not is_rail:
            return
        geom, ids = [], []
        la0, la1, lo0, lo1 = 90.0, -90.0, 180.0, -180.0
        for n in w.nodes:
            try:
                lo, la = n.lon, n.lat
            except osmium.InvalidLocationError:
                continue
            # node ids ride along: buildGraph() builds topology from el.nodes
            # and SILENTLY skips ways without them (the London t13 hole)
            ids.append(n.ref)
            geom.append({'lat': la, 'lon': lo})
            if la < la0: la0 = la
            if la > la1: la1 = la
            if lo < lo0: lo0 = lo
            if lo > lo1: lo1 = lo
        if len(geom) < 2:
            return
        el = None

        def make():
            nonlocal el
            if el is None:
                el = {'type': 'way', 'id': w.id, 'nodes': ids,
                      'tags': {t.k: t.v for t in tags}, 'geometry': geom}
            return el

        if is_road:
            for i, (s, n_, w_, e) in road_tiles.items():
                if la1 >= s and la0 <= n_ and lo1 >= w_ and lo0 <= e:
                    out[i].append(make())


# Stop nodes are collected in a SECOND pass, deliberately. apply_file(...,
# locations=True) — which the way pass needs — swallows the node callback in
# this pyosmium build, and a node in the node block already carries its own
# coordinate, so the stop pass simply runs with locations=False.
class S(osmium.SimpleHandler):
    def node(self, n):
        t = n.tags
        if not (t.get('highway') == 'bus_stop'
                or t.get('public_transport') in ('platform', 'stop_position')):
            return
        name = t.get('name')
        if not name:
            return
        try:
            la, lo = n.location.lat, n.location.lon
        except osmium.InvalidLocationError:
            return
        s_, n_, w_, e_ = STOP_BOX          # (south, north, west, east)
        if not (s_ <= la <= n_ and w_ <= lo <= e_):
            return
        kind = 'stop_position' if t.get('public_transport') == 'stop_position' and t.get('highway') != 'bus_stop' else 'platform'
        out_stops.append({'id': n.id, 'lat': la, 'lon': lo, 'name': name, 'kind': kind})


for pbf in PBFS:
    if not os.path.exists(pbf):
        sys.exit(f'brak {pbf} — pobierz go (pipeline/download.sh)')
    print('czytam', os.path.basename(pbf), flush=True)
    if road_tiles:
        H().apply_file(pbf, locations=True, idx='flex_mem')
    if need_stops:
        S().apply_file(pbf)

GEN = 'pbf-tiles.py (Geofabrik bulgaria)'
for i, els in out.items():
    f = os.path.join(ROOT, f'data/osm/tiles/t{i}.json')
    if os.path.exists(f):
        print(f't{i}: już jest (Overpass zdążył)', flush=True); continue
    json.dump({'version': 0.6, 'generator': GEN, 'elements': els}, open(f, 'w'))
    print(f't{i}: {len(els)} dróg', flush=True)
if need_stops and not os.path.exists(stops_file):
    json.dump({'generator': GEN, 'stops': out_stops}, open(stops_file, 'w'), ensure_ascii=False)
    print(f'przystanki OSM: {len(out_stops)} słupków z nazwą', flush=True)
print('gotowe', flush=True)
