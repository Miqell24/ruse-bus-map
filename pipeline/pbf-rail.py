#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""The railway of the frame — both banks. Cuts every railway=rail way (and the
tracks under construction) over the Ruse–Giurgiu frame out of BOTH Geofabrik
extracts into data/osm/rail.json, in the Overpass JSON shape build.mjs reads.
The Danube Bridge carries the line across the border; each extract holds the
bridge way in full, so the two halves meet on it. The trains between Giurgiu
Nord and Ruse ride this graph (see rail-feed.mjs)."""
import json, os, re, sys
import osmium

ROOT = os.path.join(os.path.dirname(__file__), '..')
PBFS = [os.path.join(ROOT, 'data', 'bulgaria-latest.osm.pbf'), os.path.join(ROOT, '..', '_pbf', 'romania-latest.osm.pbf')]
OUT = os.path.join(ROOT, 'data/osm/rail.json')
S, N, W, E = 43.74, 43.99, 25.86, 26.10
RAIL = re.compile(r'^(rail|construction|narrow_gauge)$')

if os.path.exists(OUT):
    print('rail.json już jest'); sys.exit(0)
els, seen = [], set()


class H(osmium.SimpleHandler):
    def way(self, w):
        t = w.tags
        rw = t.get('railway')
        if rw is None or not RAIL.match(rw):
            return
        if rw == 'construction' and t.get('construction') != 'rail':
            return
        geom, ids = [], []
        la0, la1, lo0, lo1 = 90.0, -90.0, 180.0, -180.0
        for n in w.nodes:
            try:
                lo, la = n.lon, n.lat
            except osmium.InvalidLocationError:
                continue
            ids.append(n.ref); geom.append({'lat': la, 'lon': lo})
            la0, la1, lo0, lo1 = min(la0, la), max(la1, la), min(lo0, lo), max(lo1, lo)
        if len(geom) < 2 or not (la1 >= S and la0 <= N and lo1 >= W and lo0 <= E):
            return
        if w.id in seen:
            return
        seen.add(w.id)
        els.append({'type': 'way', 'id': w.id, 'nodes': ids, 'tags': {k: v for k, v in t}, 'geometry': geom})


for pbf in PBFS:
    if not os.path.exists(pbf):
        sys.exit(f'brak {pbf}')
    print('czytam', os.path.basename(pbf), flush=True)
    H().apply_file(pbf, locations=True, idx='flex_mem')
json.dump({'version': 0.6, 'generator': 'pbf-rail.py (Geofabrik bulgaria + romania)', 'elements': els}, open(OUT, 'w'))
print(f'rail.json: {len(els)} torów', flush=True)
