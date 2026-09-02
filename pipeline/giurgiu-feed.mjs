// Giurgiu has no GTFS anywhere, so this writes one — the Romanian half of a
// map that now covers both banks of the Danube.
//
// TRACUM SA, the municipal operator since July 2025, publishes ONE thing: a
// scanned PDF timetable on the town hall's site (primariagiurgiu.ro, „Program
// Tracum SA"), seven lines, each given as a handful of named TIMING POINTS with
// the minutes between them — 4 Pietre · Piața Centrală · Port — and nothing
// else: no stop list, no streets, no coordinates. data.gov.ro, gtfs.ro, the
// MobilityDatabase and Transitous know nothing of the town, and OSM holds not
// one route relation for it. What OSM does hold is 122 named bus-stop nodes:
// somebody mapped the poles, and the timetable's timing points ARE poles among
// them (4 Pietre, Piața Centrală, Port, Bariera Alexandriei, 23 August,
// Sârguința, Poșta Tineretului, Direcția Silvică, Palatul Copiilor, Das).
//
// So this script:
//   1. pins every timing point of the timetable to a coordinate — an OSM pole
//      where one carries the name, otherwise the named feature the timetable
//      means (the prison, the power station, the Kaufland store, a street's
//      end), snapped to the nearest road (the table below says which, one by
//      one; nothing is guessed silently);
//   2. ROUTES between consecutive timing points over the road graph of the
//      Romanian tiles (the same Dijkstra the map matcher uses), and picks up
//      every named OSM pole that sits on that road, in order — the stops the
//      timetable does not list but the road the bus takes evidently serves;
//   3. writes routes, trips, stops, stop_times AND shapes: the routed road is
//      the shape, node by node, so the feed carries the same geometry the map
//      draws — a viewer that knows nothing of this engine sees the bus on the
//      street, not a chord between two poles. Each direction is routed on its
//      own, so one-way streets are respected on the way back.
//
// Lines 6 and 7 are loops the timetable writes as A – Piața Centrală – A with
// a longer way back than out; the way back is not described anywhere, so they
// are drawn as the out-and-back the timetable does describe.
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeProj } from './lib/geo.mjs';
import { buildGraph, candidates, dijkstra, pathTo } from './lib/graph.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GD = join(ROOT, 'data/gtfs-giurgiu');
const t0 = Date.now();
const log = (m) => console.log(`[giurgiu ${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

// ---------- the timetable (Program Tracum SA, primariagiurgiu.ro, Dec 2025) ----------
// One entry per line: the timing points in the order of the outbound table.
const LINES = [
  { code: '1', name: '4 Pietre – Port', via: ['4 Pietre', 'Piața Centrală', 'Port'] },
  { code: '2', name: 'COMAT – CET', via: ['COMAT', 'Piața Centrală', 'CET'] },
  { code: '3', name: '4 Pietre – Alexandriei (Peco gaz lichefiat)', via: ['4 Pietre', 'Piața Centrală', 'Alexandriei (Peco GPL)'] },
  { code: '4', name: 'Penitenciar – DAS', via: ['Penitenciar', 'Bariera Alexandriei', '23 August', 'Piața Centrală', 'Sârguința', '4 Pietre', 'Poșta Tineretului', 'Kaufland', 'DAS'] },
  { code: '5', name: 'Drumul Fermei – Kaufland', via: ['Drumul Fermei', 'Bariera Ghizdarului', 'Palatul Copiilor', 'Piața Centrală', 'Sârguința', 'Direcția Silvică', '4 Pietre', 'Poșta Tineretului', 'Kaufland'] },
  { code: '6', name: 'Miron Nicolescu – Piața Centrală', via: ['Miron Nicolescu', 'Piața Centrală'], loop: true },
  { code: '7', name: '1 Decembrie 1918 (Alunișului) – Piața Centrală', via: ['1 Decembrie 1918 (Alunișului)', 'Piața Centrală'], loop: true },
];

// ---------- where each timing point is ----------
// [lat, lon, how it was pinned]. `snap: true` = the feature is off the road
// (a building, an estate) and the pole goes to the nearest road node.
const POINTS = {
  '4 Pietre':             [43.90470, 25.97945, 'OSM pole "4 Pietre", Bd. București × Str. 1 Decembrie 1918'],
  'Piața Centrală':       [43.89146, 25.96668, 'OSM pole "Piața Centrală" by the market hall'],
  'Port':                 [43.87346, 25.96733, 'OSM pole "Port", Șoseaua Portului at the harbour gate'],
  'COMAT':                [43.92260, 25.97350, 'COMAT SA, Bd. București 225 — OSM has no. 221 (Romstal) at 43.9217 and the road runs on north to Giurgiu Nord; the pole goes to the road', { snap: 120 }],
  'CET':                  [43.88349, 25.92396, 'OSM area "CET" (the thermal power station, west, beside Verachim)', { snap: 900 }],
  'Alexandriei (Peco GPL)': [43.89434, 25.93156, 'the LPG station the timetable names is not in OSM; the pole sits at Șoseaua Alexandriei × Strada Stănești, the last junction of the built-up road, 2.7 km from the market as the 15 min of the timetable say'],
  'Penitenciar':          [43.91432, 25.94871, 'OSM area "Penitenciarul Giurgiu"; the pole goes to the nearest road — Str. Bălănoaiei', { snap: 400, road: 'Strada Bălănoaiei' }],
  'Bariera Alexandriei':  [43.89478, 25.95356, 'OSM pole "Bariera Alexandriei"'],
  '23 August':            [43.89167, 25.95510, 'OSM pole "23 August"'],
  'Sârguința':            [43.89595, 25.97120, 'OSM pole "Sârguința"'],
  'Poșta Tineretului':    [43.90804, 25.97273, 'OSM pole "Poșta Tineretului"'],
  'Kaufland':             [43.91381, 25.96925, 'OSM building "Kaufland", Șoseaua București north; nearest road', { snap: 300 }],
  'DAS':                  [43.91614, 25.96690, 'OSM pole "Das", Strada Gloriei'],
  'Drumul Fermei':        [43.91228, 25.95137, 'north-eastern end of Drumul Fermei (OSM way 23647975); the south-western end runs out as a farm track'],
  'Bariera Ghizdarului':  [43.90716, 25.94071, 'Drumul Fermei × Șoseaua Ghizdarului — the road junction at the western edge of town'],
  'Palatul Copiilor':     [43.89530, 25.95876, 'OSM pole "Palatul Copiilor"'],
  'Direcția Silvică':     [43.89951, 25.97619, 'OSM pole "Direcția Silvică"'],
  'Miron Nicolescu':      [43.90254, 25.98149, 'eastern end of Str. Academician Miron Nicolescu (OSM way 23466328)'],
  '1 Decembrie 1918 (Alunișului)': [43.90778, 25.98127, 'north-eastern end of Str. 1 Decembrie 1918 (OSM way 97979631); OSM has no Alunișului there'],
};

// ---------- the road graph of the Romanian tiles ----------
const elements = [];
const seen = new Set();
for (let i = 5; i <= 8; i++) {
  for (const e of JSON.parse(readFileSync(join(ROOT, `data/osm/tiles/t${i}.json`), 'utf8')).elements) {
    const k = e.type + e.id;
    if (!seen.has(k)) { seen.add(k); elements.push(e); }
  }
}
const proj = makeProj(43.90, 25.97);
const graph = buildGraph(elements, proj, 'road');
log(`road graph: ${graph.nodes.size} nodes, ${graph.segs.length} segments from ${elements.length} ways`);

const nodeLL = (id) => { const n = graph.nodes.get(id); return [n.lat, n.lon]; };
const metres = (a, b) => Math.hypot((a[0] - b[0]) * 111320, (a[1] - b[1]) * 111320 * Math.cos(a[0] * Math.PI / 180));

// nearest road node (optionally on a named road) within `r` metres
function snapToRoad(lat, lon, r, roadName) {
  const [x, y] = proj.toXY(lat, lon);
  const cands = candidates(graph, x, y, r, 40);
  for (const c of cands) {
    const s = graph.segs[c.segIdx];
    if (roadName && s.name !== roadName) continue;
    const a = nodeLL(s.a), b = nodeLL(s.b);
    return metres([lat, lon], a) <= metres([lat, lon], b) ? a : b;
  }
  return null;
}

const stops = new Map();   // name → { id, lat, lon, how }
let nextId = 1;
const stopFor = (name) => {
  if (stops.has(name)) return stops.get(name);
  const p = POINTS[name];
  if (!p) throw new Error(`no coordinates for timing point „${name}”`);
  let [lat, lon, how, opt] = p;
  if (opt && opt.snap) {
    const s = snapToRoad(lat, lon, opt.snap, opt.road);
    if (!s) throw new Error(`${name}: no road within ${opt.snap} m`);
    log(`  ${name}: pinned ${metres([lat, lon], s).toFixed(0)} m from the feature to the road${opt.road ? ` (${opt.road})` : ''}`);
    [lat, lon] = s;
  }
  const st = { id: `g${nextId++}`, lat, lon, name, how };
  stops.set(name, st);
  return st;
};

// the OSM poles of the frame, by position
const osmPoles = JSON.parse(readFileSync(join(ROOT, 'data/osm/giurgiu-names.json'), 'utf8')).elements
  .filter((e) => e.type === 'node' && (e.tags.highway === 'bus_stop' || e.tags.public_transport === 'platform'))
  .map((e) => ({ name: e.tags.name, lat: e.lat, lon: e.lon, xy: proj.toXY(e.lat, e.lon) }));
log(`OSM poles in the frame: ${osmPoles.length}`);

// route between two stops: node path over the graph, from the nearest
// segment endpoints of each
function route(a, b) {
  const [ax, ay] = proj.toXY(a.lat, a.lon), [bx, by] = proj.toXY(b.lat, b.lon);
  const ca = candidates(graph, ax, ay, 150, 6), cb = candidates(graph, bx, by, 150, 6);
  if (!ca.length || !cb.length) throw new Error(`no road near ${!ca.length ? a.name : b.name}`);
  const sources = new Map();
  for (const c of ca) { const s = graph.segs[c.segIdx]; for (const n of [s.a, s.b]) sources.set(n, Math.min(sources.get(n) ?? Infinity, c.dist)); }
  const targets = new Set();
  for (const c of cb) { const s = graph.segs[c.segIdx]; targets.add(s.a); targets.add(s.b); }
  const { dist, prev } = dijkstra(graph, sources, targets, 30000);
  let best = null;
  for (const t of targets) if (dist.has(t) && (!best || dist.get(t) < dist.get(best))) best = t;
  if (best === null) throw new Error(`no route ${a.name} → ${b.name}`);
  const nodes = pathTo(prev, best);
  // The shape starts and ends where the POLE projects onto the road, not at
  // whichever graph node the router set off from — on a long straight
  // residential way that node can sit 300 m from the pole.
  const projOf = (cands, node) => {
    const c = cands.find((k) => { const s = graph.segs[k.segIdx]; return s.a === node || s.b === node; }) || cands[0];
    const [lon, lat] = proj.toLonLat(c.x, c.y);
    return [lat, lon];
  };
  return { nodes, km: dist.get(best) / 1000, startPt: projOf(ca, nodes[0]), endPt: projOf(cb, best) };
}

// named poles within `r` m of the path, in path order, one per name
function polesAlong(nodes, r, exclude) {
  const pts = nodes.map((id) => { const n = graph.nodes.get(id); return [n.x, n.y]; });
  const found = new Map();
  let acc = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
    for (const p of osmPoles) {
      if (exclude.has(p.name)) continue;
      let t = ((p.xy[0] - ax) * dx + (p.xy[1] - ay) * dy) / L2; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(p.xy[0] - (ax + t * dx), p.xy[1] - (ay + t * dy));
      if (d <= r) {
        const pos = acc + t * Math.sqrt(L2);
        const prevHit = found.get(p.name);
        if (!prevHit || d < prevHit.d) found.set(p.name, { pos, d, p });
      }
    }
    acc += Math.sqrt(L2);
  }
  return [...found.values()].sort((u, v) => u.pos - v.pos).map((h) => h.p);
}

// ---------- build the feed ----------
const q = (v) => { const s = v === undefined || v === null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csv = (header, rows) => header.join(',') + '\n' + rows.map((r) => r.map(q).join(',')).join('\n') + '\n';
mkdirSync(GD, { recursive: true });

const routeRows = [], tripRows = [], stRows = [], shapeRows = [];
const poleStop = new Map(); // OSM pole name → stop record
const stopForPole = (p) => {
  if (poleStop.has(p.name)) return poleStop.get(p.name);
  // a pole of the same name within 100 m is the timing point itself (the
  // other platform of the same stop, at most) — one record, not two
  for (const s of stops.values()) if (s.name === p.name && metres([s.lat, s.lon], [p.lat, p.lon]) <= 100) { poleStop.set(p.name, s); return s; }
  const st = { id: `g${nextId++}`, lat: p.lat, lon: p.lon, name: p.name, how: 'OSM pole on the routed road' };
  poleStop.set(p.name, st); stops.set(`osm:${p.name}`, st);
  return st;
};
let totalKm = 0;
// One direction of one line: route the timing points in the order given,
// pick up the poles on the way, keep the road as the shape.
function buildDirection(timing, timingNames) {
  const chain = [timing[0]];
  const shape = [];
  let km = 0;
  for (let i = 0; i + 1 < timing.length; i++) {
    const r = route(timing[i], timing[i + 1]);
    km += r.km;
    for (const p of polesAlong(r.nodes, 30, timingNames)) {
      const st = stopForPole(p);
      if (chain[chain.length - 1] !== st) chain.push(st);
    }
    if (chain[chain.length - 1] !== timing[i + 1]) chain.push(timing[i + 1]);
    const pts = [r.startPt, ...r.nodes.map(nodeLL), r.endPt];
    // drop repeats: the previous leg's end point, and a node that coincides
    // with a projection point
    for (const pt of pts) {
      const last = shape[shape.length - 1];
      if (last && metres(last, pt) < 1) continue;
      shape.push(pt);
    }
  }
  return { chain, shape, km };
}
for (const L of LINES) {
  routeRows.push([`G${L.code}`, 'TRACUM', L.code, L.name, 3, '']);
  const timing = L.via.map(stopFor);
  const timingNames = new Set(L.via);
  const out = buildDirection(timing, timingNames);
  const back = buildDirection([...timing].reverse(), timingNames);
  totalKm += out.km + back.km;
  log(`line ${L.code}: ${timing.length} timing points; out ${out.chain.length} stops / ${out.km.toFixed(1)} km, back ${back.chain.length} stops / ${back.km.toFixed(1)} km`);
  for (const [d, dir] of [[out, '0'], [back, '1']]) {
    const tripId = `G${L.code}-${dir}`;
    const shapeId = `shp-G${L.code}-${dir}`;
    tripRows.push([`G${L.code}`, 'ALL', tripId, d.chain[d.chain.length - 1].name, dir, shapeId]);
    d.chain.forEach((s, i) => stRows.push([tripId, s.id, i + 1, '', '']));
    let acc = 0;
    d.shape.forEach(([lat, lon], i) => {
      if (i) acc += metres(d.shape[i - 1], [lat, lon]);
      shapeRows.push([shapeId, lat.toFixed(6), lon.toFixed(6), i + 1, acc.toFixed(0)]);
    });
  }
}

const stopRows = [...new Map([...stops.values()].map((s) => [s.id, s])).values()].map((s) => [s.id, '', s.name, s.lat.toFixed(6), s.lon.toFixed(6)]);
writeFileSync(join(GD, 'stops.txt'), csv(['stop_id', 'stop_code', 'stop_name', 'stop_lat', 'stop_lon'], stopRows));
writeFileSync(join(GD, 'routes.txt'), csv(['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type', 'route_color'], routeRows));
writeFileSync(join(GD, 'trips.txt'), csv(['route_id', 'service_id', 'trip_id', 'trip_headsign', 'direction_id', 'shape_id'], tripRows));
writeFileSync(join(GD, 'stop_times.txt'), csv(['trip_id', 'stop_id', 'stop_sequence', 'arrival_time', 'departure_time'], stRows));
writeFileSync(join(GD, 'shapes.txt'), csv(['shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence', 'shape_dist_traveled'], shapeRows));
writeFileSync(join(GD, 'agency.txt'), csv(['agency_id', 'agency_name', 'agency_url', 'agency_timezone', 'agency_lang'],
  [['TRACUM', 'TRACUM SA Giurgiu', 'https://primariagiurgiu.ro', 'Europe/Bucharest', 'ro']]));
writeFileSync(join(GD, 'calendar.txt'), csv(['service_id', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'start_date', 'end_date'],
  [['ALL', 1, 1, 1, 1, 1, 1, 1, '20260101', '20271231']]));
log(`wrote data/gtfs-giurgiu: ${routeRows.length} lines, ${tripRows.length} trips, ${stopRows.length} stops (${Object.keys(POINTS).length} timing points + ${poleStop.size} OSM poles on the way), ${shapeRows.length} shape points, ${totalKm.toFixed(1)} km both ways`);
for (const s of stops.values()) if (s.how) log(`  ${s.name}: ${s.how}`);
