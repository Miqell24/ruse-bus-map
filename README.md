# Ruse Public Transport — interactive map

Interactive, poster-grade map of the public transport network of **Ruse**:
18 bus lines in the family's navy and 7 trolleybus lines in its green, matched
onto the OpenStreetMap road graph and drawn one stroke per roadway.

Part of the same family as the other maps in this account — same engine, same
visual system, same city switcher.

## Where the data comes from

**Ruse publishes no GTFS anywhere.** Checked, one by one:

* the Bulgarian National Access Point lists 14 transport datasets — Sofia,
  Plovdiv, Varna, Burgas, Blagoevgrad, Dobrich, Pleven, Sliven, Stara Zagora,
  Kazanlak, Samokov, Veliko Tarnovo, Yambol, BDŽ — and **Ruse is not one**;
* Transitous (`feeds/bg.json`) and the Mobility Database have nothing;
* `gtfs.livetransport.eu`, which serves twelve Bulgarian feeds, has no Ruse;
* trinmo.org — whose live map does cover nine Bulgarian cities — carries no
  Ruse stop at all;
* OpenStreetMap holds 16 route relations: roughly half the network, mostly one
  direction each.

What the operator *does* publish is its timetable. „Общински Транспорт Русе"
renders each line at `transport-ruse.com/разписания/<id>` as a server-side page
that carries, per direction, the ordered list of stops — **names, no
coordinates**. So `pipeline/ruse-feed.mjs` does two jobs: it scrapes those
pages into lines, directions and stop sequences, and it **geocodes** the stop
names against `data/osm/ruse-stops.json` — the named bus-stop nodes
`pipeline/pbf-tiles.py` cuts out of the Geofabrik extract. The result is a
GTFS with routes, trips, stops and stop_times and **no shapes**, which is the
shape of feed the engine already knows: the stop chain becomes the observation
chain and the routing between poles draws the road (the Olsztyn path).

### Geocoding, in two parts

The operator and the OSM mappers write the same place differently —
„Скобелев" against „Скобелев (СБА)", „Акациите - север" against „Вилна зона
Акациите - север", „Обръщало 16-ти километър" against „16-ти километър,
Обръщало". Names are therefore compared as **token sets**, with the side of the
street (север/юг/запад/изток) held apart as its own signal and only counted
when it *trails* the name — „Ж.К. Изток, пл. Прага - север" is in the Iztok
district and faces north. A short alias table covers the fifteen the tokens
cannot bridge, including the terminus the operator calls „Чародейка - Юг"
outbound and „Търговски комплекс" inbound.

Matching returns a **band** of candidates, not a winner, and which pole of each
band the line really uses is then decided by a Viterbi over the whole run,
costed in metres between consecutive poles. That is what puts a run on the
correct side of a dual carriageway with no side tag anywhere — and what stops
a name that reads two ways from teleporting the line across town: „Ж.П. прелез"
matches two level crossings 6.5 km apart, and only the chain can tell which.

**98.2 %** of the stop references find a pole. The rest are named in the run
log and dropped: five Basarbovo village stops, „Печатница Дунав", two unnamed
turning loops and one row of fire-safety notice text the operator's database
carries as if it were a stop. A missing intermediate pole costs nothing — the
router draws through it — and guessing where it is would cost the truth.

## What is not drawn

Page 91 of the timetable site is headed **А166** (and linked from the index as
А112). It carries 104 stops right across the city in one direction, gives every
one of them the same time — 08:00 — lists a single departure, and ends at a
stop called „ПАЗИ ГОРИТЕ ОТ ПОЖАРИ". Drawn, it is a 100 km snake through the
whole network. It is a placeholder record, not a service, and it is excluded.

## Result

| | |
|---|---|
| lines | 25 (18 bus + 7 trolleybus) |
| directions drawn | 49 |
| network drawn | 490 km |
| mean matching error | ~8.5 m (stop-sequence matching, no shapes) |
| stops | 241 |

## Line numbers

The operator writes **T** for a trolleybus line and **A** for a bus one — T2,
A3 — but the vehicle and the stop flag show the bare number, and the two sets
never collide (trolleybuses 2, 9, 13, 21, 24, 27, 29; buses 3…50). The mode
letter therefore stays in the internal key, where it keeps the families apart
and traceable back to the timetable page, and the map prints the number the
street shows. The Sofia and Lviv rule.

## Build

```bash
npm run download   # cuts OSM tiles + stop nodes, then writes data/gtfs
npm run build      # GTFS + OSM -> data/out/*.geojson
npm run lines      # the per-line "Lines" view
npm run serve      # http://localhost:8177
```
