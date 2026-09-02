# Ruse & Giurgiu Public Transport — interactive map

Interactive, poster-grade map of the public transport of **two towns on one
frame**: **Ruse** on the Bulgarian bank of the Danube — 18 bus lines in the
family's navy and 7 trolleybus lines in its green — and **Giurgiu** on the
Romanian bank, 8 km away across the Danube Bridge, with the 7 bus lines of
TRACUM SA. Everything matched onto the OpenStreetMap road graph and drawn one
stroke per roadway.

Part of the same family as the other maps in this account — same engine, same
visual system, same city switcher.

Live: https://miqell24.github.io/ruse-bus-map/

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

## Giurgiu — the Romanian half

**Giurgiu publishes no GTFS either.** The municipal operator TRACUM SA (since
July 2025) publishes one thing: a scanned PDF timetable on the town hall's site
(primariagiurgiu.ro, *Program Tracum SA*) — seven lines, each as a handful of
named **timing points** with the minutes between them (4 Pietre · Piața
Centrală · Port) and nothing else: no stop list, no streets, no coordinates.
data.gov.ro, gtfs.ro, the MobilityDatabase and Transitous know nothing of the
town, and OSM holds not one route relation for it. What OSM does hold is 122
named bus-stop nodes, and the timetable's timing points are poles among them.

`pipeline/giurgiu-feed.mjs` therefore pins every timing point to a coordinate
(the OSM pole of that name where there is one, otherwise the named feature the
timetable means — the prison, the power station, the Kaufland store, a
street's end — snapped to the nearest road; the table in the script says which,
one by one), ROUTES between consecutive timing points over the road graph of
the Romanian tiles with the same Dijkstra the map matcher uses, and picks up
every named OSM pole sitting on that road, in order. Each direction then gets
its own platform — OSM maps both sides of the street for most stops, and the
one on the right of the direction of travel is the one that direction serves
(a stop mapped on one side only, and a timing point that is no pole, is one
record for both). Each direction is routed
on its own, so one-way streets are respected on the way back, and the routed
road goes into the feed as `shapes.txt`, node by node — the GTFS under
`data/gtfs-giurgiu/` carries the same geometry the map draws, so any viewer
sees the bus on the street rather than a chord between two poles. Lines 6 and
7 are loops whose way back the timetable does not describe; they are drawn as
the out-and-back it does.

The two networks do not touch: no public line crosses the bridge in either
operator's data. The Romanian tiles (t5–t8) come from the Geofabrik Romania
extract in `../_pbf/`, cut by `pipeline/pbf-tiles-giurgiu.py`; the bridge is a
way both extracts carry in full, so the two road graphs meet on it.


## The train between the two towns

There is one public link across the river: the CFR Călători / БДЖ trains over
the Danube Bridge — R 1001–1004 (București – Giurgiu Nord – Giurgiu – Ruse,
calling at Giurgiu town), IR 1094/1095 and the Sofia trains IR-N 460/461, four
pairs a day between Giurgiu Nord and Централна гара Русе. Neither operator
publishes a GTFS; the community feed Jonah Brüchert builds from CFR's
timetable (jbb.ghsq.de, `ro-railway.gtfs.zip`) carries all eight trips with
shapes, and `pipeline/rail-feed.mjs` cuts each of them to the part inside the
frame and writes them as one line, `train`, both directions. It rides the
railway graph of both banks (`pipeline/pbf-rail.py`, railway=rail out of both
extracts) and is drawn as a ribbon with station discs, the way the family
draws suburban rail. Matching error 0.1 m.

## Latin under the Cyrillic

Street names in Ruse carry their Latin reading under the Cyrillic one, in the
system Bulgaria itself signs its streets with (the Streamlined System,
`pipeline/lib/bulgarian.mjs` — the Sofia rule); Giurgiu's names are Latin
already and stay single-line.

## Build

```bash
npm run download   # cuts OSM tiles + stop nodes, then writes data/gtfs
npm run build      # GTFS + OSM -> data/out/*.geojson
npm run lines      # the per-line "Lines" view
npm run serve      # http://localhost:8177
```
