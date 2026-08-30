# Train Journey Live

An Android app for someone **currently sitting inside a moving train**.

Your phone's GPS *is* the train's position — so the app needs no operator feed,
no account and no API key. It matches your fix onto the real railway line you
are running on, works out which stations lie ahead, and counts them down as you
travel.

**Download:** [`dist/TrainJourneyLive.apk`](dist/TrainJourneyLive.apk) — 120 KB,
signed, installs on Android 7.0 (API 24) and later.

---

## What it does

| | |
|---|---|
| **Live map** | Real OpenStreetMap imagery with the real railway lines drawn on it — dark casing, light sleepers, the way a railway map should look. Pinch, pan, fling, and a **follow-train** button. |
| **2D train** | A top-down locomotive, not a blue dot. It rotates to your heading, sits on the rails, and moves *continuously* — between the once-a-second fixes it dead-reckons forward along the traced route at your measured speed, then eases out the error when the next fix lands. |
| **Next station** | Large card: station name, distance, ETA, and a progress bar from the last station to the next. |
| **Arrival detection** | `APPROACHING` → `ARRIVING AT` → `— ARRIVED` → `— DEPARTED`, driven by a geofence that widens when your GPS fix is poor. Arrival is a double vibration pulse and a notification; departure is a shorter one. Then the card moves itself on to the following station. |
| **Route timeline** | The whole journey top to bottom, called stations ticked with their real call times, the train marker sliding down between them, next station highlighted. |
| **Stations** | Every station on the route with live distances. Tap one to set it as your destination. |
| **Journey** | Distance, duration, average and top speed, live position and match confidence, past journeys, and exactly what is stored on the device. |

## How it decides where you are

1. **Fix** — `LocationManager` GPS at 1 Hz. No Play Services, so satellite fixes
   keep arriving where there is no data signal at all.
2. **Match** — every nearby railway line is scored on how close it is *relative
   to your fix's own accuracy*, whether your course lines up with the track, and
   whether it is the line you were already on. Above the confidence threshold the
   train is snapped to the rails; below it, the honest GPS position is drawn with
   an amber ring. **It will not snap you to a distant or parallel line** — being a
   hundred metres off on the right line is fine, being confidently pinned to the
   wrong one makes every station prediction wrong too.
3. **Trace** — the app walks the rails forward from the matched point, up to
   260 km ahead and 40 km behind, taking the straightest way through each
   junction, because that is what a train physically does.
4. **Order** — every station within 450 m of that traced line is placed on it by
   distance along the rails, not as the crow flies. A line curving through a
   valley can be four kilometres of track away while looking like one on a
   straight-line measure.

### When it genuinely cannot tell

At a **real fork** — two onward lines both near-straight and similarly plausible
— the trace **stops rather than guessing**, and the app asks where you are
heading. Pick a destination on the Stations tab and the trace re-runs, taking
whichever branch actually leads there. A branch diverging at a clear angle is not
a fork; it's a branch, and the main line wins.

## Offline

Train journeys lose signal, so:

- **Railway geometry** is downloaded once per 0.25° cell and written to SQLite.
  Cells are fetched one at a time, the ones ahead of you first. Once an area has
  been seen, it never needs the network again.
- **Map tiles** are cached to disk (160 MB budget, oldest evicted). Missing tiles
  fall back to a scaled crop of their parent, so new territory blurs in rather
  than flashing white.
- **GPS keeps working regardless** — a tunnel costs you nothing but tiles.

Open the app once with a signal before your journey and the whole corridor is
already on the phone.

## Privacy

No account. No server. No analytics. **There is nothing to send your location to.**

Position, route and journey history live in the app's private storage and are
excluded from cloud backup. The only network requests the app makes are for
public OpenStreetMap tiles and railway geometry — and both are cached so it stops
making them. The Journey tab shows exactly how much is stored and clears it in
one tap.

## Install

1. Copy `dist/TrainJourneyLive.apk` to the phone.
2. Open it. Android will ask to allow installing from this source — that is the
   normal prompt for any app not from the Play Store.
3. On first launch, grant **Precise** location. Approximate location is accurate
   to about a kilometre, which cannot tell one station from the next; the app
   detects that case and explains it rather than drifting silently.
4. Allow notifications if you want station alerts while the screen is off.

## Build

**Android Studio** — open the project and Run. Standard Gradle + AGP layout.

**Command line, no Android Studio:**

```bash
./build.sh            # -> dist/TrainJourneyLive.apk
./build.sh clean
./test.sh             # engine, Overpass reader, API-surface check
```

`build.sh` drives `aapt2`, `javac`, `dx`, `zipalign` and `apksigner` directly.
It exists because this project was built in an environment with no access to
Google's Maven repository, which is also why the app depends on **nothing but
the Android framework** — no AndroidX, no Compose, no third-party libraries.
Every card, chart, icon and the entire map renderer is drawn on a `Canvas`. That
is why the APK is 120 KB.

Requirements: JDK 8+, plus `aapt`, `zipalign`, `apksigner` (all in Ubuntu's
`universe`), a platform jar and `dx`. Override paths with `ANDROID_JAR` and
`DX_JAR`.

The signing key in `keystore/` is a **demo key with a published password**,
committed so that rebuilds keep the same signature and can be installed over the
existing app. It is fine for sideloading and useless for anything else — replace
it before publishing anywhere (`KEYSTORE=... KS_PASS=... ./build.sh`).

> The sources deliberately avoid lambdas and method references: `dx` cannot
> desugar `invokedynamic`. Anonymous classes throughout, Java 8 otherwise.

## Tests

`./test.sh` runs three suites, none needing a device:

1. **Engine** — a scripted 55 km journey at 72 km/h with GPS noise over a
   synthetic railway that includes a parallel siding, a 38° branch and a Y-fork.
   Asserts the matcher holds the right line, never snaps to the siding or the
   branch, distances never jump backwards, and every station is arrived at and
   departed exactly once, in geographic order.
2. **Overpass** — the query and the JSON reader against a response shaped like
   the real API's: inline way geometry, station nodes, stations mapped as areas
   with a centre, clipped `null` nodes, unnamed features and unrelated tags.
3. **API surface** — the app compiles against a full AOSP framework jar, which
   also contains methods hidden from the public SDK; those would compile and
   then throw `NoSuchMethodError` on a real phone. Every framework call the
   compiled app emits (437 of them) is resolved against a genuine public
   `android.jar`. The 15 that sit above it are all documented APIs added after
   API 23, each behind a `Build.VERSION.SDK_INT` guard.

## Attribution

Map imagery and railway data © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright).
Terrain layer © OpenTopoMap (CC-BY-SA). Railway detail overlay © OpenRailwayMap.
Attribution is drawn on the map, as those terms require.

## Honest limitations

- **It tracks you, not the timetable.** Without an operator feed it cannot say
  "this service is 20 minutes late" — it says where *you* are and what is ahead.
- **It is only as good as OpenStreetMap.** An unmapped halt will not appear.
- **First run in a new area needs a signal** to download that area once.
- Public Overpass mirrors are free and shared; a busy one may take a few seconds
  or refuse, in which case the app tries the next and backs off.
- On Android 7 and 8 the GPU canvas ignores blur and path effects, so railway
  sleepers render as a narrower solid core. Everything else is identical.

## Layout

```
app/src/main/java/com/trainjourney/live/
  util/    Geo (geodesy + Mercator), Ui (design tokens), Icons (vector glyphs), Fmt
  data/    Station, RailWay, RailIndex, OverpassClient, RailCache, RailRepository,
           JourneyHistoryStore
  engine/  MapMatcher, RailGraph, RoutePath, RoutePlan, ArrivalDetector,
           LocationEngine, RouteEngine, JourneyState, Alerts
  map/     MapView, TileSource, TileCache, TileManager, RailOverlay, TrainMarker
  ui/      MainActivity, OnboardingActivity, MapScreen, RouteScreen,
           StationsScreen, JourneyScreen, NextStationCard, StatsPanel,
           ArrivalCard, RouteTimelineView, BottomNav, CircleButton, PillButton
  service/ TrackingService (foreground, location type)
tools/     IconGen, EngineSim, OverpassTest, ApiCheck, extract_refs.py
```
