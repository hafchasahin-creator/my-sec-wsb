# Clawd Sleep

One screen, one button, and a sound to sleep to.

Open it, pick something to listen to, press **sleep**. The screen stays on, the
interface fades until only Clawd and the stars are left, and the audio keeps
playing until you wake up and turn it off.

No account. No ads. No trackers. Nothing leaves your phone.

---

## What's in here

| | |
|---|---|
| `web/` | The web app — vanilla ES modules, no framework, no build step, installable as a PWA and fully offline |
| `android/` | The Android app — Kotlin, Jetpack Compose, Media3 ExoPlayer |
| `assets/clawd/` | Clawd, reconstructed from his pixel grid, plus the six animation layers |
| `tools/` | Asset generation, a dev server, and the visual test harness |
| `dist/` | The built debug APK |

---

## Install the APK

Download **`dist/ClawdSleep-debug.apk`** from this branch and open it on the
phone. Android will ask you to allow installing from your browser or file
manager; that prompt is normal for any APK that did not come from the Play Store.

    adb install -r clawd-sleep/dist/ClawdSleep-debug.apk

Requires Android 8.0 (API 26) or newer. The APK is signed with the standard
Android debug key, so it installs alongside anything else and can be replaced by
a later build without uninstalling.

Verify it is the file that was built:

    sha256sum -c clawd-sleep/dist/ClawdSleep-debug.apk.sha256

---

## Run the web app

    python3 tools/serve.py 8000
    # then open http://localhost:8000

It needs to be served over `http://` or `https://` rather than opened as a
`file://` path — ES modules, the service worker and the Wake Lock API all
require an origin. Any static server works.

To install it as an app: open it in Chrome on Android and choose *Add to home
screen*. It then runs full-screen and works offline.

**One honest limitation.** A browser tab cannot truly guarantee an all-night
display. The Screen Wake Lock API is the correct and only supported mechanism,
and this app uses it properly — including re-acquiring the lock every time you
come back to the tab, which is the step most implementations miss. But the system
can still take it away under battery saver, and some browsers do not implement it
at all. The app says so in *about* rather than pretending otherwise. The Android
app uses `FLAG_KEEP_SCREEN_ON`, which does guarantee it.

---

## Build the APK yourself

### On a machine with the Android SDK

    cd clawd-sleep/android
    ./gradlew assembleDebug
    # -> app/build/outputs/apk/debug/app-debug.apk

Needs JDK 17 and an Android SDK with platform 35. Nothing else — the Gradle
wrapper fetches its own Gradle, and there are no native dependencies.

### With GitHub Actions

`.github/workflows/clawd-sleep-apk.yml` builds it on every push that touches
`clawd-sleep/android/`, or on demand from the Actions tab. It runs lint and the
unit tests, asserts the output really is a compiled Android package (a
`classes.dex`, a binary manifest, compiled resources, the expected package id,
and a valid signature — not a renamed zip), uploads it as a run artifact, and
commits it to `dist/`.

This is how the committed APK was produced: the container this was written in
cannot reach `dl.google.com`, so it has no Android SDK and no access to
AndroidX. The runner has both.

---

## Regenerate Clawd's assets

    python3 tools/gen_clawd.py

This is the only place Clawd's shape is defined. It reads the 12×8 grid in
`tools/clawd_spec.py`, writes the sprite, the six animation layers, the PWA
icons and every Android launcher density — and **asserts that the six layers
composited together are pixel-identical to the single-pass reference sprite**.
If a layer edit ever changed his silhouette, the build fails rather than
shipping a subtly different Clawd.

---

## How Clawd is animated

The artwork is 12×8 square cells. Rather than treat it as a bitmap and scale it
(which makes some pixel rows 3px and others 4px as it breathes — a visible
crawl), it is split into six rigid layers that move independently:

    body   armL   armR   legs   eyeL   eyeR

Each layer is filled as a **single path**. Filling cell by cell leaves a faint
seam along every shared edge once a layer sits at a fractional offset; one path
fill rasterises the whole region at once, so the interior stays solid and only
the true silhouette softens by a pixel. That is what lets him breathe by
*fractions* of a pixel without his shape flickering.

What he does:

- **Breathes.** Not a sine wave — real breathing has a shorter inhale, a longer
  exhale and a rest at the bottom (38% / 46% / 16%), with zero derivative at
  every junction so the loop has no corner. A sine reads as pulsing, not
  sleeping. The body scales about its own bottom edge, so his feet stay planted.
- **Floats**, on a period deliberately out of step with the breath (11.3s vs
  4.2s), plus a third, almost invisible sway at 17.9s.
- **Blinks**, fast closed and slower open. Intervals come from a golden-ratio
  sequence rather than `Math.random()`: random clusters, and over eight hours you
  would see five blinks in three seconds and then nothing for twenty.
- **Twitches** — a lean, an arm, a shift — roughly three times a minute.
- **Falls asleep** after 90 seconds of quiet, or immediately when you press
  sleep. Eyes settle to a line. Very occasionally he cracks one open.
- **Dreams** in 5×5 pixel Zs, at most three at a time, drawn in his own idiom.
  A script "z" next to blocky pixel art is the fastest way to make something
  look cheap.

Once asleep, every amplitude drops and the frame rate falls from 30fps to 8fps.

The composite of all these periods does not repeat within a night.

---

## Sound

**Nothing is a recording.** All seven beds — rain, ocean, forest, fireplace,
fan, brown noise, white noise — are synthesised, which is why the whole app is a
few hundred kilobytes and works in airplane mode.

A looped recording is obvious by the third pass. Two things prevent that here:
the bed is long, and its tail is crossfaded into its own head with an equal-power
curve, so the join is mathematically continuous — for noise-based material,
genuinely inaudible. On the web, raindrops and fire crackles are scheduled live
on top with exponential inter-arrival times, so they cluster like real weather
instead of ticking like a metronome.

Your own audio and the ambience are separate players with separate volumes, so
you can put a song under rain and balance the two. Both fade in and out on an
equal-power curve; a linear fade sounds like nothing happens and then everything
happens at the end.

The sleep timer does not stop the music, it *lands* it: the last 90 seconds taper
to nothing, so what wakes you is nothing at all.

---

## Sleep Mode

Pressing **sleep** does five things:

1. Takes the screen-awake lock — `FLAG_KEEP_SCREEN_ON` on Android, the Screen
   Wake Lock API on the web.
2. Fades the interface out over about a second. Nothing flashes.
3. Keeps dimming the scene for another 20 seconds, so the room gets darker
   gradually instead of snapping to a new brightness.
4. Calms Clawd and drops the frame rate.
5. Puts a full-screen catcher over everything, so **nothing a hand or a duvet
   does to the glass can reach a music control.**

To wake: **tap twice.** Each tap has to be a deliberate one — under 400ms, under
12px of travel, and not from the very edge of the screen. A duvet settling holds
far longer than that; a brush travels much further. One tap lights the small
mark at the bottom so you can see the app is listening.

`Escape` also works on the web.

### About the screen being on all night

This is said once, in the app, before the first long session, because it is true:

> Keeping the display on all night uses a significant amount of battery — very
> roughly 15–35% on a typical phone, depending on the panel and brightness.
> **Leave the phone charging.** On an OLED screen, a static bright image held for
> hours can also leave faint permanent marks (burn-in).

What is actually done about it:

- The whole scene **drifts** on a slow Lissajous path, ±10px over 7 and 11
  minutes. Nothing sits on the same physical pixel for more than a few minutes.
  This is why the drift exists; it is not decoration, and it stays on even when
  you ask for reduced motion.
- The screen is dimmed hard — on Android the app sets its own window brightness,
  which you can choose.
- **True black** mode paints `#000000`, where an OLED pixel is simply *off*: no
  emission, no power, nothing to burn in.
- Everything on screen is already near the bottom of the luminance range. Body
  text sits just above the 4.5:1 contrast floor rather than well above it —
  ordinary dark-mode text emits about five times the light for no legibility
  gain, and every excess candela is glare at 3am.

**Nothing here bypasses Android security.** No device-admin, no
`SYSTEM_ALERT_WINDOW`, no keyguard dismissal, no battery-optimisation
exemptions. The screen stays on via a documented window flag, and audio survives
backgrounding via a normal `mediaPlayback` foreground service — the same
mechanism every music app uses.

---

## Android architecture, and why

| Decision | Reason |
|---|---|
| **Media3 ExoPlayer** in a **MediaSessionService** | The only arrangement Android actually guarantees for multi-hour playback. The foreground service with `mediaPlayback` type is exempt from Doze and background-execution limits, and the lock-screen transport comes free. |
| **Two players**, not one | Music and ambience need independent volumes, looping and lifetimes. One player with a mixing source gives none of that without a custom renderer. |
| The session is attached to the **music** player | A headset button should pause your song, not silence the rain. |
| **`FLAG_KEEP_SCREEN_ON`**, not a `PowerManager` wake lock | It is scoped to the window, cannot leak past the Activity, is released automatically if the process dies, and `SCREEN_BRIGHT_WAKE_LOCK` has been deprecated since API 17. Tied to a `DisposableEffect`, so toggling sleep mode fifty times sets and clears it fifty times with nothing left over. |
| **`ACTION_OPEN_DOCUMENT`** + `takePersistableUriPermission` | Without the persistable grant the URI stops working after a reboot, and "your song is gone" is the worst possible morning. |
| **DataStore**, not SharedPreferences | Async, transactional, and it will not block the frame that is drawing Clawd. |
| **No Hilt** | Two singletons and a Prefs class. A DI graph here would be more machinery than app. |
| Ambience rendered to a **WAV in the cache**, played by ExoPlayer | Riding the same battle-tested playback path as your music — audio focus, the service, Doze — instead of a hand-rolled `AudioTrack` loop that has to survive eight hours alone. |
| `minSdk 26` | The oldest release with the notification-channel model and the foreground-service behaviour Media3 relies on. |

Audio focus behaves the way a *sleep* app should, not the way a music app does:
after a phone call or another app taking over, playback does **not** resume by
itself. Waking to music at 3am is worse than silence.

---

## Accessibility

- Contrast is deliberately low, because the alternative is glare — but body text
  still clears 4.5:1 against the brightest point of its own background, and the
  OS "increase contrast" setting raises the whole ramp.
- `prefers-reduced-motion` (and Android's animation scale) stops Clawd
  translating. He still breathes, in opacity. The burn-in drift stays on: it is
  hardware protection, not decoration.
- Every target is at least 48dp. Sliders have a 2px track and a 48px grab area.
- No swipe-to-delete and no edge gestures anywhere. A phone on a nightstand gets
  brushed.
- Nothing is communicated by colour alone.
- The focus ring is one hairline, not a bright halo — visible to a keyboard user,
  invisible to everyone else in a dark room.
- Full keyboard support on the web: tab order, arrow keys on sliders, space to
  play/pause, `Escape` to leave sleep mode.

---

## Design notes

The accent is Clawd's own coral with the hue held exactly and the saturation cut
48% — the same family, but a coral *object* rather than a coral *light source*.
It marks exactly two things: the sleep action, and the current selection. Never
focus, hover, links, headings, or state.

There is no error colour. Errors are plain text. A red toast at 3am is an
assault.

Four easing curves, every control point inside [0,1], so nothing can overshoot
and nothing can bounce. Nothing rounded except pills and chips — Clawd is
square-cornered pixel art, and a UI full of soft rectangles fights him.

---

## Verifying the animation

    node tools/visual/shoot.mjs        # renders every screen in Chromium
    python3 tools/gen_clawd.py         # asserts the layers still match the source

The web renderer has been run through 8.5 simulated hours headlessly to confirm
the particle list stays bounded and no scheduler drifts.

---

## Licence

Clawd is the user's artwork. The code is yours to do as you like with.
