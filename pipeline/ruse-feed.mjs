// Ruse has no GTFS anywhere, so this writes one.
//
// The Bulgarian National Access Point lists 14 datasets and Ruse is not one of
// them. Transitous, the MobilityDatabase and gtfs.livetransport.eu have
// nothing. trinmo.org — whose map does serve nine Bulgarian cities — has no
// Ruse stop at all. OpenStreetMap holds 16 route relations, about half the
// network and mostly one direction each.
//
// What the operator DOES publish is its timetable: „Общински Транспорт Русе"
// renders every line at transport-ruse.com/разписания/<id> as a server-side
// page carrying, per direction, the ordered list of stops with their times.
// Names, though — no coordinates. So this script does two jobs:
//
//   1. scrape the 26 line pages into lines, directions and stop sequences;
//   2. GEOCODE those stop names against data/osm/ruse-stops.json, the named
//      bus-stop nodes pipeline/pbf-tiles.py cuts out of the Geofabrik extract.
//
// The result is a GTFS with routes, trips, stops and stop_times and NO shapes,
// which is exactly the shape of feed the engine already knows how to draw:
// the stop sequence becomes the HMM observation chain and the routing between
// the poles draws the road (the Olsztyn and Grodzisk path).
//
// Geocoding is the interesting half. The operator and the OSM mappers write
// the same place differently — „Скобелев" against „Скобелев (СБА)", „Акациите
// - север" against „Вилна зона Акациите - север", „Обръщало 16-ти километър"
// against „16-ти километър, Обръщало" — so names are compared as TOKEN SETS
// with the side of the street (север/юг/запад/изток) held apart as its own
// signal, plus a hand-written alias table for the couple of dozen the tokens
// cannot bridge. Every name that still finds nothing is reported and dropped:
// a missing intermediate pole costs nothing (the router draws through it),
// and pretending to know where it is would cost the truth.
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GD = join(ROOT, 'data/gtfs');
const SITE = 'https://transport-ruse.com';
const INDEX = `${SITE}/${encodeURIComponent('разписания')}`;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36';

const t0 = Date.now();
const log = (m) => console.log(`[feed ${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

async function getText(url, soft404 = false) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'bg' } });
      // the index links one line (А100) whose page does not exist; a 404 there
      // is data about the network, not a transport failure
      if (r.status === 404 && soft404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      if (attempt === 4) throw e;
      await new Promise((res) => setTimeout(res, 1500 * attempt));
    }
  }
}

// ---------- 1) scrape ----------
const decode = (s) => s
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
  .replace(/&laquo;|&raquo;/g, '');

log('pobieram listę linii');
const idxHtml = await getText(INDEX);
const ids = [...new Set([...idxHtml.matchAll(/href="\/(?:разписания|%D1%80%D0%B0%D0%B7%D0%BF%D0%B8%D1%81%D0%B0%D0%BD%D0%B8%D1%8F)\/(\d+)"/g)]
  .map((m) => Number(m[1])))].sort((a, b) => a - b);
log(`strony rozkładów: ${ids.length}`);

// One record on the operator's site is not a line. Page 91 is headed А166,
// carries 104 stops right across the city in a single direction, gives every
// one of them the same time (08:00), lists one departure, and ends at a stop
// called „ПАЗИ ГОРИТЕ ОТ ПОЖАРИ" — a fire-safety slogan sitting in the stop
// column. The index links it under yet another number (А112). Drawn, it is a
// 100 km snake through the whole network. It is a placeholder, not a service.
const NOT_A_LINE = new Set(['А166', 'А112']);

const lines = [];
for (const id of ids) {
  const html = await getText(`${INDEX}/${id}`, true);
  const t = html && /Разписание на линия\s+([^<\s]+)/.exec(html);
  if (!t) { log(`linia ${id}: strona bez rozkładu — pomijam`); continue; }
  // Latin A/T slip into the operator's own headings beside the Cyrillic ones
  const name = decode(t[1]).trim().replace(/^A/, 'А').replace(/^T/, 'Т');
  const dirs = [];
  for (let d = 0; d < 4; d++) {
    const i = html.indexOf(`<div id="route-stops-${d}"`);
    if (i < 0) continue;
    const ends = [html.indexOf(`<div id="route-stops-${d + 1}"`, i),
      html.indexOf('<!-- Hidden schedule data', i), html.length].filter((x) => x > 0);
    const blk = html.slice(i, Math.min(...ends));
    const stops = [...blk.matchAll(/<span class="station-name[^"]*">([^<]*)<\/span>/g)]
      .map((m) => decode(m[1]).replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    if (stops.length >= 2) dirs.push(stops);
  }
  if (!dirs.length) { log(`linia ${name}: brak listy przystanków — pomijam`); continue; }
  if (NOT_A_LINE.has(name)) { log(`linia ${name}: rekord-zaślepka (${dirs[0].length} przystanków, jedna godzina) — pomijam`); continue; }
  lines.push({ id, name, dirs });
}
log(`linie: ${lines.length} (${lines.map((l) => l.name).join(', ')})`);

// ---------- 2) geocode ----------
const stopsFile = join(ROOT, 'data/osm/ruse-stops.json');
if (!existsSync(stopsFile)) {
  console.error('brak data/osm/ruse-stops.json — uruchom `python3 pipeline/pbf-tiles.py`');
  process.exit(1);
}
const osmAll = JSON.parse(readFileSync(stopsFile, 'utf8')).stops;
// A stop_position is the point on the axis of the road, not a pole. Where a
// platform of the same name stands within 60 m it is the same stop twice,
// and keeping both doubled a stop a few metres apart on one side; where no
// platform exists it is all OSM knows of that stop and stays.
const KM0 = (a, b) => Math.hypot((a.lat - b.lat) * 111320, (a.lon - b.lon) * 111320 * Math.cos(a.lat * Math.PI / 180));
const plats = osmAll.filter((s) => s.kind !== 'stop_position');
const osmStops = osmAll.filter((s) => s.kind !== 'stop_position' || !plats.some((p) => p.name === s.name && KM0(p, s) < 60));
log(`słupki OSM z nazwą: ${osmStops.length} (${osmAll.length - osmStops.length} stop_position dublujących peron odrzuconych)`);

// The site's spelling on the left, OSM's on the right. Everything here was
// checked one by one against the line's own course; nothing is guessed.
const ALIAS = new Map(Object.entries({
  // the operator names this terminus by its housing estate outbound and by
  // the shopping complex inbound; OSM has only the latter, and the „ж.к.
  // Чародейка - Юг" suburb node sits 40 m from that pole
  'Чародейка - Юг': 'Търговски комплекс',
  'Астърджийка - юг': 'Астарджийка - юг',
  'Астърджийка - север': 'Астарджийка - север',
  'СОУ Христо Ботев': 'Училище Христо Ботев',
  'Мол Русе (ирис)': 'МОЛ Русе (3-та поликлиника)',
  'Филип Станиславов': 'Блок №302',
  'Блок № 302 - ул. Филип Станиславов': 'Блок №302',
  'Терасата': 'Ресторант Тераса',
  'Църквата': 'Църква Св. Архангел Михаил',
  'Болницата': 'Окръжна болница (Парк на Възрожденците)',
  'Еконтекспрес': 'Еконт Експрес (Домостроене АД)',
  'Обръщало - пл. Прага - север': 'Ж.К. Изток, пл. Прага - север',
  'Обръщало - пл. Прага - юг': 'Ж.К. Изток, пл. Прага - юг',
  'Хотел Фамилия-изток': 'Хотел Фамилия - запад',
  'Средна кула- 2 север, изход към кв. Долапите - юг': 'Средна кула 2, Изход към кв. Долапите - юг',
  'Средна кула— център - юг': 'Средна Кула, Център - юг',
}));

// Stops the operator lists that OSM simply does not have, and one line of
// notice text the operator's own database carries as if it were a stop. Named
// here so the run reports a known count instead of a silent hole.
const NOT_IN_OSM = new Set([
  'Басарбово 1', 'Басарбово 2 - запад', 'Басарбово 2 - изток',
  'Басарбово 3 - запад', 'Басарбово 3 - изток',
  'Печатница Дунав', 'Канала', 'Обръщалото',
  'След бул. Цар Освободител, на ул. Бозвели',
  'ПАЗИ ГОРИТЕ ОТ ПОЖАРИ',
]);

const DIRW = new Map([['север', 'n'], ['юг', 's'], ['запад', 'w'], ['изток', 'e']]);
// words that carry no identity: street-type abbreviations, block markers, and
// „обръщало" (turning loop), which one side writes and the other does not
const DROP = new Set(['ул', 'бул', 'бл', 'кв', 'пл', 'ж', 'к', 'жк', 'на',
  'магазин', 'вилна', 'зона', 'обръщало', 'обръщалото', 'блок']);

const tokens = (s) => s.toLowerCase()
  .replace(/ж\.п\.?/g, 'жп').replace(/ж\.к\.?/g, 'жк')
  // NB: no \b — JavaScript's word boundary is ASCII-only, so /\bкм\b/ never
  // matches Cyrillic and the site's „9-ти км" stayed unmatched against OSM's
  // „9-ти километър". Same trap as Varna's direction prefixes.
  .replace(/(^|\s)км(?=\s|$)/g, '$1километър')
  .replace(/психо диспансер/g, 'психодиспансер')
  .replace(/[№#]/g, ' ')
  .replace(/[^0-9а-яa-z]+/gi, ' ')
  .split(' ').filter((w) => w && !DROP.has(w));

// The side of the street counts only when it TRAILS the name — „Ж.К. Изток,
// пл. Прага - север" is in the Iztok district and faces north, and reading its
// „изток" as a side put it on the wrong pole for a whole run.
const sideOf = (s) => {
  const m = /[-–—]\s*(север|юг|запад|изток)\s*$/.exec(s.trim());
  return m ? DIRW.get(m[1]) : null;
};
const keyOf = (s) => {
  const side = sideOf(s);
  const t = tokens(s);
  const core = new Set(side ? t.slice(0, -1) : t);
  return { core, side, flat: t.join(' ') };
};
const subset = (a, b) => [...a].every((x) => b.has(x));
const inter = (a, b) => [...a].filter((x) => b.has(x)).length;
const lev = (a, b) => {
  if (Math.abs(a.length - b.length) > 2) return 9;
  let prev = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] !== b[j - 1] ? 1 : 0)));
    }
    prev = cur;
  }
  return prev[b.length];
};

const cand = osmStops.map((s) => ({ ...s, ...keyOf(s.name) }));
const scoreOf = (k, c) => {
  if (k.side && c.side && k.side !== c.side) return 0;
  let sc = 0;
  if (k.core.size === c.core.size && subset(k.core, c.core)) sc = 100;
  else if (k.core.size && subset(k.core, c.core)) sc = 80 + (10 * k.core.size) / Math.max(1, c.core.size);
  else if (c.core.size && subset(c.core, k.core)) sc = 70 + (10 * c.core.size) / Math.max(1, k.core.size);
  else {
    const n = inter(k.core, c.core);
    if (!n) return lev(k.flat, c.flat) <= 1 ? 60 : 0;
    sc = (40 * n) / (k.core.size + c.core.size - n);
    const a = [...k.core][0], b = [...c.core][0];
    if (a && a === b) sc += 15;   // same leading word ("МОЛ Русе …")
  }
  if (k.side && c.side === k.side) sc += 5;
  return sc;
};
const MIN_SCORE = 60;
const matchCache = new Map();
const matchesFor = (name) => {
  if (matchCache.has(name)) return matchCache.get(name);
  const target = ALIAS.get(name) || name;
  const k = keyOf(target);
  const scored = cand.map((c) => [scoreOf(k, c), c]).filter(([s]) => s >= MIN_SCORE);
  scored.sort((a, b) => b[0] - a[0]);
  const top = scored.length ? scored[0][0] : 0;
  // A BAND, not the single best. Two poles of one stop score identically, so
  // the band has to be wide enough to hold both — and wide enough to hold a
  // rival reading: „Ж.П. прелез" scores 86.7 for „Долапите, ЖП прелез - север"
  // and 85 for „Кооперативен пазар (ЖП прелез)", two level crossings 6.5 km
  // apart, and the name alone cannot tell them apart. The run below does, by
  // taking the chain of poles with the shortest total walk.
  const out = scored.filter(([s]) => s >= top - 15).map(([, c]) => c);
  matchCache.set(name, out);
  return out;
};

const KM = (a, b) => Math.hypot((a.lat - b.lat) * 111.32, (a.lon - b.lon) * 80.5);
const missing = new Map();
const usedStops = new Map();
const routes = [], trips = [], stopTimes = [];
let kept = 0, dropped = 0;
let sided = 0;

for (const L of lines) {
  const isTrolley = /^Т/.test(L.name);
  const bare = L.name.replace(/^[АТ]/, '');
  routes.push([L.name, 'RUSE', bare, `Линия ${L.name}`, isTrolley ? '11' : '3', '']);
  L.dirs.forEach((stops, d) => {
    const tripId = `${L.name}-${d}`;
    // Which pole of each candidate band the line actually uses is decided by
    // the WHOLE run, not one step at a time: a Viterbi over the bands, cost =
    // the metres between consecutive poles. That is what puts a run on the
    // right side of a dual carriageway with no side tag anywhere, and what
    // keeps a name that reads two ways from teleporting the line across town —
    // greedy nearest-to-previous cannot, because the first stop has no
    // previous and one bad early pick drags the rest of the chain with it.
    const bands = [];
    for (const raw of stops) {
      if (NOT_IN_OSM.has(raw)) { dropped++; missing.set(raw, (missing.get(raw) || 0) + 1); continue; }
      const opts = matchesFor(raw);
      if (!opts.length) { dropped++; missing.set(raw, (missing.get(raw) || 0) + 1); continue; }
      bands.push(opts); kept++;
    }
    let seq = [];
    if (bands.length) {
      let layer = bands[0].map((c) => ({ cost: 0, path: [c] }));
      for (let i = 1; i < bands.length; i++) {
        layer = bands[i].map((c) => {
          let best = null;
          for (const st of layer) {
            const cost = st.cost + KM(st.path[st.path.length - 1], c);
            if (!best || cost < best.cost) best = { cost, path: st.path };
          }
          return { cost: best.cost, path: [...best.path, c] };
        });
      }
      seq = layer.reduce((a, b) => (a.cost <= b.cost ? a : b)).path;
      // The Viterbi minimises distance, which cannot tell the two platforms of
      // one stop apart (both are on the way). Each direction serves the one on
      // the RIGHT of its direction of travel (Bulgaria drives on the right), so
      // where the band holds a same-name sibling within 60 m of the pick, the
      // right-hand one wins. Direction of travel: previous pick → next pick.
      for (let i = 0; i < seq.length; i++) {
        const sib = bands[i].filter((c) => c.name === seq[i].name && KM0(c, seq[i]) < 60);
        if (sib.length < 2) continue;
        const from = seq[i - 1] || seq[i], to = seq[i + 1] || seq[i];
        if (from === to) continue;
        const dx = (to.lon - from.lon) * Math.cos(from.lat * Math.PI / 180), dy = to.lat - from.lat;
        const right = sib.filter((c) => dx * (c.lat - from.lat) - dy * (c.lon - from.lon) * Math.cos(from.lat * Math.PI / 180) < 0);
        if (right.length) { if (!right.includes(seq[i])) sided++; seq[i] = right.reduce((a, b) => (KM0(a, seq[i]) <= KM0(b, seq[i]) ? a : b)); }
      }
    }
    if (seq.length < 2) { log(`${L.name}/${d}: po geokodowaniu zostało ${seq.length} przystanków — pomijam kierunek`); return; }
    trips.push([L.name, 'ALL', tripId, seq[seq.length - 1].name, String(d % 2), '']);
    seq.forEach((s, i) => {
      usedStops.set(s.id, s);
      stopTimes.push([tripId, s.id, i + 1, '', '']);
    });
  });
}

log(`strona jezdni: ${sided} przystanków przeniesionych na peron po prawej stronie jazdy`);

const q = (v) => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (h, rows) => h.join(',') + '\n' + rows.map((r) => r.map(q).join(',')).join('\n') + '\n';

mkdirSync(GD, { recursive: true });
writeFileSync(join(GD, 'routes.txt'),
  csv(['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type', 'route_color'], routes));
writeFileSync(join(GD, 'trips.txt'),
  csv(['route_id', 'service_id', 'trip_id', 'trip_headsign', 'direction_id', 'shape_id'], trips));
writeFileSync(join(GD, 'stop_times.txt'),
  csv(['trip_id', 'stop_id', 'stop_sequence', 'arrival_time', 'departure_time'], stopTimes));
writeFileSync(join(GD, 'stops.txt'),
  csv(['stop_id', 'stop_name', 'stop_lat', 'stop_lon'],
    [...usedStops.values()].map((s) => [s.id, s.name, s.lat.toFixed(7), s.lon.toFixed(7)])));
writeFileSync(join(GD, 'agency.txt'),
  csv(['agency_id', 'agency_name', 'agency_url', 'agency_timezone', 'agency_lang'],
    [['RUSE', 'Общински Транспорт Русе', SITE, 'Europe/Sofia', 'bg']]));
writeFileSync(join(GD, 'calendar.txt'),
  csv(['service_id', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'start_date', 'end_date'],
    [['ALL', 1, 1, 1, 1, 1, 1, 1, '20260101', '20271231']]));

log(`zapisano data/gtfs: ${routes.length} linii, ${trips.length} kierunków, ${usedStops.size} przystanków`);
log(`geokodowanie: ${kept} trafień, ${dropped} pominięć (${((100 * kept) / (kept + dropped)).toFixed(1)}% nazw znalazło słupek)`);
if (missing.size) {
  log(`nazwy bez odpowiednika w OSM (${missing.size}):`);
  for (const [n, c] of [...missing].sort((a, b) => b[1] - a[1])) console.log(`    ${c}× ${n}`);
}
