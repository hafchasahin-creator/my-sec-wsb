# Screen Recorder

A minimal native Android app that records the phone's screen to an MP4 file, using the
system `MediaProjection` + `MediaRecorder` APIs. Video only (no microphone/system audio).

## Installing on your phone

1. Download **`dist/ScreenRecorder.apk`** onto the device.
2. Tap the file to install. If Android blocks it, enable **Install unknown apps** for
   the app you downloaded it with (Settings → Apps → Special access → Install unknown apps),
   then tap the file again.
3. Open **Screen Recorder**, tap **Start Recording**, and accept the system's screen-capture
   confirmation dialog (Android always shows this — the app cannot record without it).
4. A persistent notification appears while recording. Tap **Stop** in the notification, or
   **Stop Recording** in the app, to end the recording.

Recordings are saved as `ScreenRecord_<timestamp>.mp4` under **Movies/ScreenRecorder**,
visible in your gallery/files app.

This is a debug-signed build meant for installing directly on your own device (sideloading).
It is not signed for, or published to, the Play Store.

## Requirements

- Android 10 (API 29) or newer.
- Notification permission (Android 13+) so the required recording-in-progress notice can show.

## Project layout

Standard Gradle Android app under `app/`. To rebuild:

```
cd ScreenRecorder
gradle assembleDebug   # or ./gradlew assembleDebug if you generate the wrapper
```

The APK is written to `app/build/outputs/apk/debug/app-debug.apk`.
