// The trains between the two towns: one rail line, Giurgiu ↔ Ruse.
//
// Neither operator publishes an official GTFS, but the community feeds Jonah
// Brüchert builds from the operators' timetables do carry them, with shapes:
//   ro-railway.gtfs.zip (CFR Călători, jbb.ghsq.de) — R 1001–1004 București
//   Nord – Giurgiu Nord – Giurgiu – Ruse, IR 1094/1095 and IR-N 460/461
//   București Nord – Giurgiu Nord – Ruse (the Sofia trains);
//   bg-bdz.gtfs.zip (БДЖ) — the same trains from the Bulgarian side.
// The Romanian feed lists every one of them, so it is the source; the
// Bulgarian feed supplies the Bulgarian names of the two Bulgarian stations.
//
// The trains come from Bucharest, 90 km north of the frame. This script keeps
// only the part of each trip that lies between Giurgiu and Ruse — the stops
// inside the frame and the stretch of shape between the first and the last of
// them — and writes it as ONE line, `train`, both directions: the map is of
// the two towns, and what the line means here is that a train links them.
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readCsv } from './lib/csv.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'data/ro-railway');
const GD = join(ROOT, 'data/gtfs-rail');
const log = (m) => console.log(`[rail] ${m}`);

if (!existsSync(join(SRC, 'stops.txt'))) {
  mkdirSync(SRC, { recursive: true });
  execSync(`unzip -o -q "${join(ROOT, 'data/ro-railway.gtfs.zip')}" -d "${SRC}"`);
}
// the frame: the two towns and the bridge between them
const S = 43.74, N = 43.99, W = 25.86, E = 26.10;
const inFrame = (lat, lon) => lat >= S && lat <= N && lon >= W && lon <= E;

const stops = new Map();
for (const s of await readCsv(join(SRC, 'stops.txt'))) stops.set(s.stop_id, { ...s, lat: Number(s.stop_lat), lon: Number(s.stop_lon) });
const routes = new Map();
for (const r of await readCsv(join(SRC, 'routes.txt'))) routes.set(r.route_id, r);
const trips = new Map();
for (const t of await readCsv(join(SRC, 'trips.txt'))) trips.set(t.trip_id, t);
const times = new Map();
for (const st of await readCsv(join(SRC, 'stop_times.txt'))) {
  let a = times.get(st.trip_id);
  if (!a) times.set(st.trip_id, (a = []));
  a.push({ seq: Number(st.stop_sequence), stop: st.stop_id, dep: st.departure_time, arr: st.arrival_time });
}
const shapes = new Map();
for (const p of await readCsv(join(SRC, 'shapes.txt'))) {
  let a = shapes.get(p.shape_id);
  if (!a) shapes.set(p.shape_id, (a = []));
  a.push({ seq: Number(p.shape_pt_sequence), lat: Number(p.shape_pt_lat), lon: Number(p.shape_pt_lon) });
}
for (const a of shapes.values()) a.sort((u, v) => u.seq - v.seq);

// Bulgarian names for the Bulgarian stations (the CFR feed writes them in
// Latin); the flag on the platform says Централна гара Русе.
const BG_NAME = { Ruse: 'Централна гара Русе', 'Ruse Triaj': 'Русе Разпределителна' };

const isGiurgiu = (n) => /giurgiu/i.test(n) && !/băneasa/i.test(n);
const isRuse = (n) => /^ruse/i.test(n);
const keptTrips = [];
for (const [tid, seq] of times) {
  seq.sort((a, b) => a.seq - b.seq);
  const names = seq.map((s) => stops.get(s.stop)?.stop_name || '');
  if (!names.some(isGiurgiu) || !names.some(isRuse)) continue;
  // the stops inside the frame, in order — the trip is cut to them
  const inside = seq.filter((s) => { const st = stops.get(s.stop); return st && inFrame(st.lat, st.lon); });
  if (inside.length < 2) continue;
  keptTrips.push({ tid, t: trips.get(tid), inside });
}
log(`${keptTrips.length} trips serve both Giurgiu and Ruse: ${[...new Set(keptTrips.map((k) => routes.get(k.t.route_id)?.route_short_name))].join(', ')}`);

const metres = (a, b) => Math.hypot((a.lat - b.lat) * 111320, (a.lon - b.lon) * 111320 * Math.cos(a.lat * Math.PI / 180));
const nearestIdx = (pts, st) => { let bi = 0, bd = Infinity; pts.forEach((p, i) => { const d = metres(p, st); if (d < bd) { bd = d; bi = i; } }); return bi; };

const q = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csv = (h, rows) => h.join(',') + '\n' + rows.map((r) => r.map(q).join(',')).join('\n') + '\n';
rmSync(GD, { recursive: true, force: true }); mkdirSync(GD, { recursive: true });

const stopRows = new Map(), tripRows = [], stRows = [], shapeRows = [];
let n = 0;
for (const { tid, t, inside } of keptTrips) {
  const r = routes.get(t.route_id);
  const first = stops.get(inside[0].stop), last = stops.get(inside[inside.length - 1].stop);
  const dir = isRuse(last.stop_name) ? '0' : '1';         // 0 = towards Ruse
  const newTid = `train-${++n}-${(r.route_short_name || '').replace(/\s+/g, '')}`;
  let shapeId = '';
  const sh = shapes.get(t.shape_id);
  if (sh && sh.length) {
    const i0 = nearestIdx(sh, first), i1 = nearestIdx(sh, last);
    const cut = sh.slice(Math.min(i0, i1), Math.max(i0, i1) + 1);
    if (cut.length >= 2) {
      shapeId = `shape-${n}`;
      cut.forEach((p, i) => shapeRows.push([shapeId, p.lat.toFixed(6), p.lon.toFixed(6), i + 1]));
    }
  }
  // one headsign per direction, whatever halt the frame cuts the trip at
  const headsign = dir === '0' ? 'Централна гара Русе' : 'București (via Giurgiu Nord)';
  tripRows.push(['train', 'ALL', newTid, headsign, dir, shapeId, `${r.route_short_name} (${t.trip_headsign || ''})`]);
  inside.forEach((s, i) => {
    const st = stops.get(s.stop);
    stopRows.set(s.stop, [s.stop, '', BG_NAME[st.stop_name] || st.stop_name, st.lat.toFixed(6), st.lon.toFixed(6)]);
    stRows.push([newTid, s.stop, i + 1, s.arr || '', s.dep || '']);
  });
  log(`  ${r.route_short_name}: ${inside.map((s) => stops.get(s.stop).stop_name).join(' → ')} (${sh ? 'shape cut' : 'NO shape'})`);
}
writeFileSync(join(GD, 'stops.txt'), csv(['stop_id', 'stop_code', 'stop_name', 'stop_lat', 'stop_lon'], [...stopRows.values()]));
writeFileSync(join(GD, 'routes.txt'), csv(['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type', 'route_color'],
  [['train', 'CFR', 'train', 'Giurgiu – Ruse (CFR Călători / БДЖ)', 2, '']]));
writeFileSync(join(GD, 'trips.txt'), csv(['route_id', 'service_id', 'trip_id', 'trip_headsign', 'direction_id', 'shape_id', 'trip_short_name'], tripRows));
writeFileSync(join(GD, 'stop_times.txt'), csv(['trip_id', 'stop_id', 'stop_sequence', 'arrival_time', 'departure_time'], stRows));
writeFileSync(join(GD, 'shapes.txt'), csv(['shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence'], shapeRows));
writeFileSync(join(GD, 'agency.txt'), csv(['agency_id', 'agency_name', 'agency_url', 'agency_timezone', 'agency_lang'],
  [['CFR', 'CFR Călători / БДЖ', 'https://www.cfrcalatori.ro', 'Europe/Bucharest', 'ro']]));
writeFileSync(join(GD, 'calendar.txt'), csv(['service_id', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'start_date', 'end_date'],
  [['ALL', 1, 1, 1, 1, 1, 1, 1, '20260101', '20271231']]));
log(`wrote data/gtfs-rail: 1 line, ${tripRows.length} trips, ${stopRows.size} stations, ${shapeRows.length} shape points`);
