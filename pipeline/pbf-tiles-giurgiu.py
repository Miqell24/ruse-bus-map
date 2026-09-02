#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""The Romanian half of the frame: Giurgiu, across the Danube from Ruse.

Cuts 2 x 2 road tiles (t5..t8) over the town out of the Geofabrik ROMANIA
extract — the Bulgarian one this map already uses stops at the border in the
middle of the river — and harvests every NAMED node and way of the frame into
data/osm/giurgiu-names.json, with coordinates. TRACUM's timetable names its
timing points (Piața Centrală, Port, CET, Kaufland, Bariera Alexandriei…)
and nothing else, and OSM holds not one bus stop in Giurgiu, so those names
are geocoded against these features (see giurgiu-feed.mjs).

Same JSON shape as Overpass ('elements': ways with tags, node ids and
geometry) so build.mjs cannot tell the difference. Node ids are global OSM
ids, so the Danube bridge — a way both extracts carry in full — knits the two
road graphs together where it lands on the Romanian bank.
"""
import json, os, re, sys
import osmium

ROOT = os.path.join(os.path.dirname(__file__), '..')
PBF = os.path.join(ROOT, '..', '_pbf', 'romania-latest.osm.pbf')

# Giurgiu proper with the port, CET and the bridgehead south, the Bucharest
# road and Drumul Fermei north, Alexandria road west — 2 km of margin
S, N, W, E = 43.85, 43.99, 25.88, 26.07

HW = re.compile(r'^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|busway|construction|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$')

road_tiles = {}
for i in range(5, 9):
    f = os.path.join(ROOT, f'data/osm/tiles/t{i}.json')
    if os.path.exists(f):
        continue
    row, col = (i - 5) // 2, (i - 5) % 2
    road_tiles[i] = (S + (N - S) * row / 2, S + (N - S) * (row + 1) / 2,
                     W + (E - W) * col / 2, W + (E - W) * (col + 1) / 2)
names_file = os.path.join(ROOT, 'data/osm/giurgiu-names.json')
need_names = not os.path.exists(names_file)
print('brakujące kafle dróg:', sorted(road_tiles), '| nazwy OSM:', 'do zebrania' if need_names else 'są', flush=True)
if not road_tiles and not need_names:
    sys.exit(0)
os.makedirs(os.path.join(ROOT, 'data/osm/tiles'), exist_ok=True)

out = {i: [] for i in road_tiles}
out_names = []
KEEP = ('name', 'highway', 'public_transport', 'place', 'amenity', 'shop', 'landuse', 'industrial', 'office', 'building', 'railway', 'man_made', 'leisure', 'tourism')


class H(osmium.SimpleHandler):
    def way(self, w):
        tags = w.tags
        hw = tags.get('highway')
        is_road = hw is not None and HW.match(hw)
        wants_name = need_names and tags.get('name') is not None
        if not is_road and not wants_name:
            return
        geom, ids = [], []
        la0, la1, lo0, lo1 = 90.0, -90.0, 180.0, -180.0
        for n in w.nodes:
            try:
                lo, la = n.lon, n.lat
            except osmium.InvalidLocationError:
                continue
            ids.append(n.ref)
            geom.append({'lat': la, 'lon': lo})
            if la < la0: la0 = la
            if la > la1: la1 = la
            if lo < lo0: lo0 = lo
            if lo > lo1: lo1 = lo
        if len(geom) < 2:
            return
        inside = la1 >= S and la0 <= N and lo1 >= W and lo0 <= E
        if wants_name and inside:
            out_names.append({'type': 'way', 'id': w.id, 'nodes': ids, 'geometry': geom,
                              'tags': {t.k: t.v for t in tags if t.k in KEEP}})
        if not is_road:
            return
        el = None
        for i, (s, n_, w_, e) in road_tiles.items():
            if la1 >= s and la0 <= n_ and lo1 >= w_ and lo0 <= e:
                if el is None:
                    el = {'type': 'way', 'id': w.id, 'nodes': ids,
                          'tags': {t.k: t.v for t in tags}, 'geometry': geom}
                out[i].append(el)


class Nm(osmium.SimpleHandler):
    def node(self, n):
        name = n.tags.get('name')
        if not name:
            return
        try:
            la, lo = n.location.lat, n.location.lon
        except osmium.InvalidLocationError:
            return
        if not (S <= la <= N and W <= lo <= E):
            return
        out_names.append({'type': 'node', 'id': n.id, 'lat': la, 'lon': lo,
                          'tags': {t.k: t.v for t in n.tags if t.k in KEEP}})


if not os.path.exists(PBF):
    sys.exit(f'brak {PBF} — pobierz go (pipeline/download.sh)')
print('czytam', os.path.basename(PBF), flush=True)
if road_tiles or need_names:
    H().apply_file(PBF, locations=True, idx='flex_mem')
if need_names:
    Nm().apply_file(PBF)

GEN = 'pbf-tiles-giurgiu.py (Geofabrik romania)'
for i, els in out.items():
    json.dump({'version': 0.6, 'generator': GEN, 'elements': els}, open(os.path.join(ROOT, f'data/osm/tiles/t{i}.json'), 'w'))
    print(f't{i}: {len(els)} dróg', flush=True)
if need_names:
    json.dump({'version': 0.6, 'generator': GEN, 'elements': out_names}, open(names_file, 'w'), ensure_ascii=False)
    print(f'nazwy OSM Giurgiu: {len(out_names)} nazwanych węzłów i obiektów w kadrze', flush=True)
print('gotowe', flush=True)
