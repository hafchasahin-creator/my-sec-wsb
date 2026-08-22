package sleep.clawd

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import android.text.format.DateFormat
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.core.view.WindowCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import sleep.clawd.audio.AlarmScheduler
import sleep.clawd.audio.Ambience
import sleep.clawd.audio.Engine
import sleep.clawd.audio.PlaybackService
import sleep.clawd.data.Prefs
import sleep.clawd.data.Settings
import sleep.clawd.ui.AppCallbacks
import sleep.clawd.ui.ClawdSleepApp
import sleep.clawd.ui.UiModel
import java.util.Calendar

class MainActivity : ComponentActivity() {

    private lateinit var prefs: Prefs
    private lateinit var engine: Engine

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        WindowCompat.setDecorFitsSystemWindows(window, false)

        prefs = Prefs(this)
        engine = Engine.get(this)
        startService(Intent(this, PlaybackService::class.java))

        setContent {
            val settings by prefs.flow.collectAsStateWithLifecycle(initialValue = Settings())
            val audio by engine.state.collectAsStateWithLifecycle()
            // sleepMode is Activity state, not persisted: reopening the app in the
            // morning must never drop you back into a dark screen.
            var sleepMode by rememberSaveable { mutableStateOf(false) }
            var sessionStart by rememberSaveable { mutableLongStateOf(0L) }
            var clockText by remember { mutableStateOf(formatClock()) }

            LaunchedEffect(Unit) {
                while (true) {
                    clockText = formatClock()
                    engine.tickPosition()
                    delay(1000)
                }
            }

            // Apply persisted settings to the engine whenever they change.
            LaunchedEffect(settings.musicVolume) { engine.setMusicVolume(settings.musicVolume) }
            LaunchedEffect(settings.ambienceVolume) { engine.setAmbienceVolume(settings.ambienceVolume) }
            LaunchedEffect(settings.loop) { engine.setLoop(settings.loop) }
            LaunchedEffect(settings.ambienceId) { engine.setAmbience(settings.ambienceId) }
            LaunchedEffect(settings.trackUri) {
                settings.trackUri?.let { s ->
                    runCatching { engine.setTrack(Uri.parse(s), settings.trackName ?: "your audio") }
                }
            }
            LaunchedEffect(settings.timerMinutes) {
                if (settings.timerMinutes > 0) engine.startTimer(settings.timerMinutes)
                else engine.cancelTimer()
            }

            /*
             * Keeping the screen on.
             *
             * FLAG_KEEP_SCREEN_ON, not a PowerManager wake lock: it is scoped to
             * this window, so it cannot leak past the Activity, it is cleared
             * automatically if the process dies, and it is the only approach
             * Google documents for this. SCREEN_BRIGHT_WAKE_LOCK has been
             * deprecated since API 17 and leaks the screen on if you forget to
             * release it.
             *
             * DisposableEffect ties it to composition, so toggling Sleep Mode
             * fifty times sets and clears it fifty times with nothing left over,
             * and a rotation re-applies it on the new window.
             */
            DisposableEffect(sleepMode, settings.keepScreenOn, settings.sleepBrightness) {
                val wantScreen = sleepMode && settings.keepScreenOn
                if (wantScreen) {
                    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    window.attributes = window.attributes.apply {
                        screenBrightness = settings.sleepBrightness.coerceIn(0.01f, 1f)
                    }
                }
                onDispose {
                    window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    window.attributes = window.attributes.apply {
                        screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
                    }
                }
            }

            val picker = rememberLauncherForActivityResult(
                ActivityResultContracts.OpenDocument()
            ) { uri: Uri? ->
                if (uri == null) return@rememberLauncherForActivityResult
                // Without a persistable grant the URI stops working after a
                // reboot, and "your song is gone" is the worst possible morning.
                runCatching {
                    contentResolver.takePersistableUriPermission(
                        uri, Intent.FLAG_GRANT_READ_URI_PERMISSION
                    )
                }
                val name = displayName(uri)
                lifecycleScope.launch {
                    prefs.setTrack(uri.toString(), name)
                    engine.setTrack(uri, name)
                    engine.play()
                }
            }

            val ambName = settings.ambienceId?.let { Ambience.displayName(it) }
            val nowLine = listOfNotNull(ambName, audio.trackName).joinToString(" + ")
                .ifEmpty { "choose a sound" }

            val ui = UiModel(
                clockText = clockText,
                clockVisible = settings.clockVisible,
                nowLine = nowLine,
                hasSource = settings.ambienceId != null || audio.trackName != null,
                playing = audio.playing,
                trackName = audio.trackName,
                ambienceId = settings.ambienceId,
                musicVolume = settings.musicVolume,
                ambienceVolume = settings.ambienceVolume,
                loop = settings.loop,
                timerMinutes = settings.timerMinutes,
                durationMs = audio.durationMs,
                positionMs = audio.positionMs,
                sleepMode = sleepMode,
                amoled = settings.amoled,
                keepScreenOn = settings.keepScreenOn,
                sleepBrightness = settings.sleepBrightness,
                warned = settings.warnedAboutBattery,
                alarmEnabled = settings.alarmEnabled,
                alarmHour = settings.alarmHour,
                alarmMinute = settings.alarmMinute,
                lastSessionText = sessionText(settings),
                error = audio.error,
            )

            val cb = AppCallbacks(
                onPickFile = { picker.launch(arrayOf("audio/*")) },
                onAmbience = { id -> lifecycleScope.launch { prefs.setAmbience(id); engine.setAmbience(id); engine.play() } },
                onMusicVolume = { v -> engine.setMusicVolume(v); lifecycleScope.launch { prefs.setMusicVolume(v) } },
                onAmbienceVolume = { v -> engine.setAmbienceVolume(v); lifecycleScope.launch { prefs.setAmbienceVolume(v) } },
                onPlayPause = { if (audio.playing) engine.pause() else engine.play() },
                onSeek = { engine.seekTo(it) },
                onTimer = { m -> lifecycleScope.launch { prefs.setTimer(m) } },
                onLoop = { v -> lifecycleScope.launch { prefs.setLoop(v) }; engine.setLoop(v) },
                onAmoled = { v -> lifecycleScope.launch { prefs.setAmoled(v) } },
                onKeepScreenOn = { v -> lifecycleScope.launch { prefs.setKeepScreenOn(v) } },
                onClockVisible = { v -> lifecycleScope.launch { prefs.setClockVisible(v) } },
                onBrightness = { v -> lifecycleScope.launch { prefs.setSleepBrightness(v) } },
                onAcceptNotice = { lifecycleScope.launch { prefs.setWarned(true) } },
                onAlarm = { on, h, m ->
                    lifecycleScope.launch { prefs.setAlarm(on, h, m) }
                    if (on) AlarmScheduler.schedule(this@MainActivity, h, m)
                    else AlarmScheduler.cancel(this@MainActivity)
                },
                onSleep = { on ->
                    if (on) {
                        sessionStart = System.currentTimeMillis()
                        engine.play()
                        startService(Intent(this@MainActivity, PlaybackService::class.java))
                    } else if (sessionStart > 0L) {
                        val end = System.currentTimeMillis()
                        val start = sessionStart
                        lifecycleScope.launch { prefs.setSession(start, end) }
                        sessionStart = 0L
                    }
                    sleepMode = on
                },
            )

            ClawdSleepApp(ui, cb)
        }
    }

    private fun formatClock(): String {
        val c = Calendar.getInstance()
        return if (DateFormat.is24HourFormat(this)) {
            "%02d:%02d".format(c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE))
        } else {
            val h24 = c.get(Calendar.HOUR_OF_DAY)
            val h = if (h24 % 12 == 0) 12 else h24 % 12
            "%d:%02d %s".format(h, c.get(Calendar.MINUTE), if (h24 < 12) "am" else "pm")
        }
    }

    private fun sessionText(s: Settings): String? {
        if (s.lastSessionEnd <= s.lastSessionStart) return null
        val mins = ((s.lastSessionEnd - s.lastSessionStart) / 60_000L).toInt()
        if (mins < 1) return null
        val h = mins / 60
        val m = mins % 60
        return if (h > 0) "last night: ${h}h ${m}m" else "last night: ${m}m"
    }

    private fun displayName(uri: Uri): String {
        runCatching {
            contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
                ?.use { c -> if (c.moveToFirst()) return c.getString(0).substringBeforeLast('.') }
        }
        return uri.lastPathSegment?.substringAfterLast('/')?.substringBeforeLast('.') ?: "your audio"
    }
}
