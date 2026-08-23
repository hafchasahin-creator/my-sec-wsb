# Imran Runner

A GPS running tracker for Android, built to the supplied reference design: a pure-black premium
fitness screen with one enormous live speed readout, a glowing 270° gauge, and a runner animated
inside it whose stride is driven by how fast you are actually moving.

**[⬇ Download the APK](https://github.com/hafchasahin-creator/my-sec-wsb/releases/download/imran-runner-latest/ImranRunner.apk)** — Android 8.0 (Oreo) or newer.

---

## What it does

**Tracking** comes from the phone's own GNSS receiver through `LocationManager` — no Google Play
Services dependency, so it works on any Android phone including those without Google services.
Speed is taken from the receiver's Doppler measurement where the hardware reports one, and derived
from position deltas where it does not.

- Live speed, distance, duration, calories, average speed, max speed and average pace
- A second stats page with live pace, the last completed kilometre split, and elevation gain
- Runs continue with the screen off, via a foreground service with a live notification
- The session only ever pauses when you ask it to. Auto-pause is off unless you turn it on, and
  even then it will not fire without a live fix — losing the signal under a bridge is not the
  same as standing still, and the clock keeps running while the header says SEARCHING
- Speed is read from far looser fixes than distance is, so an ordinary walk down a street with
  buildings either side still shows a live km/h instead of sitting at 0.0
- Completed runs are saved on the device with their full route trace
- History with a route sparkline per run and a detail screen with the full trace
- Stats: lifetime distance, calories, time and runs, personal records, and an eight-week chart
- Profile: your name and weight, which is what the calorie model is built on

Nothing is ever uploaded. There is no network code in the app at all.

## The animation

The runner is not a sprite loop. It is a filled, athletic silhouette — head, torso, tapered
limbs with real thickness, and feet — posed every frame by moving its feet along a stride path
and solving two-bone inverse kinematics for the knees and elbows. That is what lets cadence
scale *continuously* with speed instead of snapping between canned frames, and it is why the
stride lengthens as well as quickens.

- The posture itself morphs with speed: standing → walking → jogging → flat-out, each blend
  low-passed so a GPS blip can never snap the figure between gaits
- A running pose that reads as running: forward lean, knee drive, the trailing heel kicking up
  just before the front foot lands, arms pumping bent at the elbow, feet that plantarflex at
  toe-off and reach toes-up for the landing
- Cadence follows a realistic curve: real runners hold a narrow cadence and lengthen their stride,
  so the legs quicken far more slowly than speed rises and never become a flicker
- Speeding up stretches the gait already in progress; the phase is never reset
- Stopping eases the figure into a standing pose with a slow breathing cycle
- The ground is a true perspective plane of dots with its vanishing point at the runner's feet,
  scrolling toward the viewer at running speed
- The gauge arc is spring-damped, so it settles like a weighted needle
- Distance, calories and speed ease between values; the clock ticks, because a clock should
- The GPS bars breathe slowly — enough to read as live, not enough to pull your eye

## Layout

```
imran-runner/
  android/
    app/src/main/java/com/imran/runner/
      core/        Geo, Calories, SpeedFilter, Format — pure Kotlin, no Android
      data/        RunRecord, RunCodec, RunRepository, Profile
      tracking/    RunEngine (pure), RunTracker, TrackingService
      ui/          theme, components, screens
    app/src/test/  JVM unit tests for everything above that is pure
  dist/            the built APK
```

`RunEngine` holds all of the tracking logic and takes an explicit monotonic `nowMs` on every entry
point, so a whole run can be replayed from synthetic fixes in a unit test. That is where the
awkward cases live and are tested: a receiver that jumps several hundred metres, GPS wobble while
standing at a crossing, movement slower than the noise floor, a pause that must cost neither time
nor distance, and a tunnel that stops the fixes altogether.

## Building

The app is built by `.github/workflows/imran-runner-apk.yml` on a GitHub runner, which runs the
unit tests and lint, assembles a signed release APK, checks the package really is a well-formed
and signed Android package, then commits it to `dist/` and publishes it as a release asset.

To build it yourself with an Android SDK to hand:

```sh
cd imran-runner/android
./gradlew testDebugUnitTest lintDebug assembleRelease
# app/build/outputs/apk/release/app-release.apk
```

`imran-runner.keystore` is a self-signed key kept in the repo on purpose: the app is installed by
sideloading rather than through a store, and a stable key is what lets each rebuild install over
the last one as an update. It is not a credential for any service.

## Permissions

| Permission | Why |
| --- | --- |
| `ACCESS_FINE_LOCATION` | the GPS fixes every number is derived from |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION` | keeps recording with the screen off |
| `POST_NOTIFICATIONS` | the live run notification; declining it does not stop tracking |
