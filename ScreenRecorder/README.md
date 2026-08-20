# Imran Recorder

A complete Android screen-recording app: capture, screenshots, floating controls,
a media library and on-device editing tools. Everything runs locally — no account,
no network permission, no ads.

**Install:** download **`dist/ImranRecorder.apk`** onto the phone and tap it. If Android
blocks the install, allow *Install unknown apps* for whichever app you downloaded it with,
then tap the file again. This is a **debug-signed** build for sideloading, not a Play Store release.

Requires **Android 10 (API 29)** or newer.

---

## What's in it

### Recording
- Screen capture through `MediaProjection`, driven by a foreground service so it survives
  leaving the app, locking the screen or switching tasks.
- **Pause / resume**, with paused time removed from the finished file — no frozen gap.
- Optional **countdown** (off / 3 / 5 / 10s) shown as a full-screen overlay.
- Live state everywhere: idle, countdown, recording, paused, saving. The Record bar,
  the notification and the floating capsule always agree, because they read one shared store.
- Notification actions: pause/resume, screenshot, stop.

### Audio
| Mode | How it works |
| --- | --- |
| No audio | Video only |
| Microphone | `MediaRecorder` with the mic source |
| Device audio | `AudioPlaybackCapture` → AAC, muxed by hand |
| Device audio + mic | Both streams captured and mixed sample-by-sample |

Two engines sit behind one interface. `MediaRecorderEngine` handles silent and mic captures —
the platform owns the muxer, timestamps and pause/resume, which makes it the most reliable
path, so it is the default. `CodecEngine` handles device audio, which `MediaRecorder` cannot do
at all: it drives `MediaCodec` + `MediaMuxer` directly, taking video timestamps from the surface
clock minus paused time and audio timestamps from the sample count.

Unsupported options are detected and shown as unavailable rather than silently failing. If the
encoder rejects a configuration, the app retries once on a clean file and tells you what changed.

### Settings
Resolution (480p / 720p / 1080p / native), quality, frame rate (24/30/60, clamped to what the
device's encoder actually reports), orientation (auto/portrait/landscape), audio source,
countdown, floating controls, facecam, storage locations. Requested sizes are snapped onto
encoder-legal values so odd display geometries don't fail at `start()`.

### Floating controls
A draggable capsule drawn over other apps. Tap to expand into record / pause / screenshot /
brush / stop, drag it anywhere and it docks to the nearest edge. Shows the running time while
capturing. Needs *Display over other apps*, requested in context.

### Brush
Free-hand annotation over the whole screen while recording — five colours, undo, clear, exit.
Strokes are stored as vector paths, so undo is exact.

### Facecam
Front-camera preview in a draggable, resizable, closable overlay. Camera2 directly, because a
`WindowManager` overlay has no Lifecycle for CameraX to bind to. Missing camera or denied
permission degrades cleanly instead of crashing.

### Screenshots
Real captures via `ImageReader` on the projection. While recording it reuses the live projection,
so there's no second consent prompt; overlays are hidden for the captured frame.

### Library
Videos list with thumbnails, duration, size, resolution and date — play, share, rename, delete,
details. Screenshots in a responsive grid with a full-screen viewer. Both stay in sync with what
the recorder produces, and both have designed empty states.

### Tools
Every tool is a real on-device implementation — there are no placeholder buttons.

| Tool | Implementation |
| --- | --- |
| Trim | `MediaExtractor` → `MediaMuxer` stream copy: fast and lossless, cuts on the nearest keyframe |
| Compress | Decoder renders into the encoder's input Surface — no CPU round-trip, no GL. Audio copied through |
| Video → GIF | Frame sampling + a self-contained GIF89a encoder (median-cut palette, LZW) |
| Photo edit | Rotate, aspect crop, mono, brightness, saved as a new image |
| Share | Android Sharesheet, single or batch |

### Elsewhere
Four-card first-run walkthrough (skippable, remembered), branded splash, FAQ, how-it-works,
privacy, feedback and problem-report mail intents, share, version.

---

## Permissions

Each one is asked for the first time you use the feature that needs it, with an explanation
first. Denying any of them leaves the rest of the app working.

- **Screen capture** — Android's own consent dialog, shown every session. No app can skip it.
- **Notifications** — the ongoing recording notice Android requires.
- **Microphone** — optional narration.
- **Camera** — optional facecam.
- **Display over other apps** — floating controls, brush, countdown.

---

## Project layout

```
app/src/main/java/com/imran/recorder/
  record/    MediaProjection lifecycle, both engines, screenshots, shared state
  overlay/   floating capsule, brush layer, facecam, countdown
  ui/        splash, onboarding, dashboard + 4 tabs, player, viewer, tools
  media/     trimmer, compressor, GIF encoder
  data/      preferences, MediaStore repository, thumbnail loader
  util/      formatting, permissions, view helpers
```

## Building

```
cd ScreenRecorder
gradle assembleDebug          # -> app/build/outputs/apk/debug/app-debug.apk
gradle :app:lintDebug         # correctness checks
```

Needs JDK 17+ and an Android SDK with platform 34 and build-tools 34.0.0. Point at it with a
`local.properties` containing `sdk.dir=/path/to/android-sdk`, or set `ANDROID_HOME`.
