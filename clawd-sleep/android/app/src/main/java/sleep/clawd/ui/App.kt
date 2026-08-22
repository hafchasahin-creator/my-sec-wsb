package sleep.clawd.ui

import android.text.format.DateFormat
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.runtime.withFrameNanos
import sleep.clawd.audio.Ambience
import java.util.Calendar
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.PI

val EaseOut = CubicBezierEasing(0.16f, 0.84f, 0.24f, 1f)
val EaseSleep = CubicBezierEasing(0.25f, 0.10f, 0.15f, 1f)

/** What the UI needs from the outside world. Keeps this file testable and dumb. */
data class AppCallbacks(
    val onPickFile: () -> Unit = {},
    val onAmbience: (String?) -> Unit = {},
    val onMusicVolume: (Float) -> Unit = {},
    val onAmbienceVolume: (Float) -> Unit = {},
    val onPlayPause: () -> Unit = {},
    val onSeek: (Long) -> Unit = {},
    val onTimer: (Int) -> Unit = {},
    val onLoop: (Boolean) -> Unit = {},
    val onSleep: (Boolean) -> Unit = {},
    val onAmoled: (Boolean) -> Unit = {},
    val onKeepScreenOn: (Boolean) -> Unit = {},
    val onClockVisible: (Boolean) -> Unit = {},
    val onBrightness: (Float) -> Unit = {},
    val onAlarm: (Boolean, Int, Int) -> Unit = { _, _, _ -> },
    val onAcceptNotice: () -> Unit = {},
)

@Composable
fun ClawdSleepApp(
    ui: UiModel,
    cb: AppCallbacks,
) {
    val cfg = LocalConfiguration.current
    val landscape = cfg.screenWidthDp > cfg.screenHeightDp * 1.15
    val density = LocalDensity.current
    val night = remember { Night() }
    val clawd = remember { ClawdState() }
    var sheet by remember { mutableStateOf<String?>(null) }
    var showNotice by remember { mutableStateOf(false) }

    // One clock drives the scene, so nothing can drift out of step with anything
    // else. 30fps awake, 8fps asleep: every motion here has a period measured in
    // seconds, and 60fps buys only heat.
    var now by remember { mutableFloatStateOf(0f) }
    var sleepT by remember { mutableFloatStateOf(0f) }
    var settle by remember { mutableFloatStateOf(0f) }
    var drift by remember { mutableStateOf(Offset.Zero) }

    LaunchedEffect(ui.sleepMode) {
        clawd.setMode(if (ui.sleepMode) ClawdState.Mode.ASLEEP else ClawdState.Mode.AWAKE, now)
    }

    LaunchedEffect(Unit) {
        var last = 0L
        var acc = 0f
        while (true) {
            withFrameNanos { t ->
                if (last == 0L) last = t
                var dt = (t - last) / 1e9f
                last = t
                if (dt > 0.25f) dt = 0.25f     // a throttled or slept process hands back a huge dt
                val fps = if (sleepT > 0.5f) 8f else 30f
                acc += dt
                val step = 1f / fps
                if (acc >= step) {
                    acc %= step
                    now += dt
                    val target = if (ui.sleepMode) 1f else 0f
                    val tau = if (ui.sleepMode) 0.42f else 0.16f
                    sleepT += (target - sleepT) * (1f - kotlin.math.exp(-dt / tau))
                    settle += ((if (ui.sleepMode) 1f else 0f) - settle) *
                        (1f - kotlin.math.exp(-dt / (if (ui.sleepMode) 8f else 0.5f)))
                    clawd.update(now, dt)
                    // Burn-in mitigation, not decoration: two slow periods so the
                    // path fills an area instead of retracing a line.
                    drift = Offset(
                        (sin(now / 420f * 2 * PI) * 10f).toFloat(),
                        (sin(now / 660f * 2 * PI + 2.2) * 8f).toFloat()
                    )
                }
            }
        }
    }

    val dim = if (ui.sleepMode) (sleepT * 0.55f + settle * 0.45f).coerceIn(0f, 1f) else sleepT
    val bgColor = if (ui.amoled) Ink.TrueBlack else Ink.Void

    Box(Modifier.fillMaxSize().background(bgColor)) {

        Canvas(Modifier.fillMaxSize()) {
            night.layout(size.width, size.height)
            with(night) { paint(now, 1f, ui.amoled, dim, density.density) }

            val maxW = if (landscape) size.width * 0.30f else size.width * 0.62f
            val maxH = if (landscape) size.height * 0.52f else size.height * 0.34f
            val scale = minOf(maxW / ClawdArt.W, maxH / ClawdArt.H)
            val cx = size.width / 2 + drift.x * density.density
            val cy = (if (landscape) size.height * 0.46f else size.height * 0.355f) +
                drift.y * density.density
            drawClawd(clawd, now, cx, cy, scale, alpha = 0.92f - dim * 0.34f)
        }

        // The dim scrim sits above everything, so darkening is one composite
        // rather than per-element alpha bookkeeping.
        if (dim > 0.001f) {
            Box(Modifier.fillMaxSize()
                .background(Color.Black.copy(alpha = dim * (0.12f + ui.brightness01Inverse * 0.62f))))
        }

        if (!ui.sleepMode) {
            IdleChrome(ui, cb, landscape, onOpen = { sheet = it },
                showNotice = showNotice, setNotice = { showNotice = it })
        } else {
            SleepOverlay(ui, cb, drift, dim)
        }

        sheet?.let { which ->
            Sheet(which, ui, cb, landscape, onClose = { sheet = null })
        }
    }
}

/* ------------------------------------------------------------ idle chrome -- */

@Composable
private fun IdleChrome(
    ui: UiModel, cb: AppCallbacks, landscape: Boolean,
    onOpen: (String) -> Unit, showNotice: Boolean, setNotice: (Boolean) -> Unit,
) {
    Column(
        Modifier.fillMaxSize().safeDrawingPadding().padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Row(Modifier.fillMaxWidth().height(44.dp), verticalAlignment = Alignment.CenterVertically) {
            if (ui.clockVisible) {
                Text(ui.clockText, color = Ink.Text3, fontSize = 15.sp,
                    fontWeight = FontWeight.Light, letterSpacing = 0.6.sp)
            }
            Spacer(Modifier.weight(1f))
            TextButton("about") { onOpen("about") }
        }

        Spacer(Modifier.weight(1f))

        Text(ui.nowLine, color = Ink.Text3, fontSize = 13.sp, letterSpacing = 0.2.sp,
            textAlign = TextAlign.Center, maxLines = 1)
        Spacer(Modifier.height(16.dp))

        Pill("sounds", Modifier.widthIn(min = 160.dp)) { onOpen("sounds") }
        Spacer(Modifier.height(16.dp))

        if (showNotice) {
            Column(Modifier.fillMaxWidth().padding(bottom = 16.dp)) {
                Box(Modifier.fillMaxWidth().height(1.dp).background(Ink.Hairline))
                Spacer(Modifier.height(16.dp))
                Text("sleep mode keeps the screen on until you wake up.",
                    color = Ink.Text2, fontSize = 15.sp, lineHeight = 22.sp)
                Spacer(Modifier.height(8.dp))
                Text("leave the phone charging. the screen dims right down and the picture " +
                    "drifts slowly so nothing burns into the display.",
                    color = Ink.Text2, fontSize = 15.sp, lineHeight = 22.sp)
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                    TextButton("ok", Ink.Accent) { setNotice(false); cb.onAcceptNotice(); cb.onSleep(true) }
                    TextButton("keep the screen off instead", Ink.Text2) {
                        setNotice(false); cb.onAcceptNotice(); cb.onKeepScreenOn(false); cb.onSleep(true)
                    }
                }
            }
        }

        Pill(
            "sleep",
            Modifier.width(232.dp).height(56.dp),
            border = Ink.Accent.copy(alpha = 0.55f),
            content = Ink.Accent,
            enabled = ui.hasSource,
        ) {
            if (!ui.warned) setNotice(true) else cb.onSleep(true)
        }
        Spacer(Modifier.height(24.dp))
    }
}

/* ------------------------------------------------------------ sleep mode -- */

@Composable
private fun SleepOverlay(ui: UiModel, cb: AppCallbacks, drift: Offset, dim: Float) {
    var lit by remember { mutableStateOf(true) }
    var firstTapAt by remember { mutableLongStateOf(0L) }

    LaunchedEffect(lit) {
        if (lit) { kotlinx.coroutines.delay(4200); lit = false }
    }

    Box(
        Modifier.fillMaxSize()
            // A full-screen catcher: while this is up, nothing a hand or a duvet
            // does to the glass can reach a music control.
            .pointerInput(Unit) {
                detectTapGestures(onTap = {
                    val t = System.currentTimeMillis()
                    if (firstTapAt != 0L && t - firstTapAt < 4000) {
                        firstTapAt = 0L
                        cb.onSleep(false)
                    } else {
                        firstTapAt = t
                        lit = true
                    }
                })
            }
    ) {
        Column(
            Modifier.fillMaxSize().safeDrawingPadding()
                .offset { androidx.compose.ui.unit.IntOffset(drift.x.roundToInt(), drift.y.roundToInt()) },
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(Modifier.height(64.dp))
            if (ui.clockVisible) {
                Text(ui.clockText, color = Ink.Text3.copy(alpha = 0.55f),
                    fontSize = 56.sp, fontWeight = FontWeight.ExtraLight, letterSpacing = (-1.6).sp)
            }
            if (lit) {
                Spacer(Modifier.height(32.dp))
                Text("tap twice to wake", color = Ink.Text3.copy(alpha = 0.5f), fontSize = 13.sp)
            }
            Spacer(Modifier.weight(1f))
            if (ui.nowLine.isNotEmpty()) {
                Text(ui.nowLine, color = Ink.Text3.copy(alpha = 0.42f), fontSize = 13.sp, maxLines = 1)
            }
            Spacer(Modifier.height(16.dp))
            // The mark never reaches zero opacity — it is a target, and an
            // invisible target is not a target.
            Box(Modifier.size(6.dp).alpha(if (lit) 0.85f else 0.10f).background(Ink.Accent)
                .semantics { contentDescription = "wake up" })
            Spacer(Modifier.height(24.dp))
        }
    }
}

/* ---------------------------------------------------------------- sheets -- */

@Composable
private fun Sheet(which: String, ui: UiModel, cb: AppCallbacks, landscape: Boolean, onClose: () -> Unit) {
    Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.55f))
        .pointerInput(Unit) { detectTapGestures { onClose() } })

    Box(
        Modifier.fillMaxSize().padding(top = if (landscape) 0.dp else 120.dp),
        contentAlignment = if (landscape) Alignment.CenterEnd else Alignment.BottomCenter
    ) {
        Column(
            Modifier
                .then(if (landscape) Modifier.fillMaxHeight().width(420.dp) else Modifier.fillMaxWidth())
                .background(if (ui.amoled) Ink.SurfaceAmoled else Ink.Surface,
                    if (landscape) RoundedCornerShape(0.dp) else RoundedCornerShape(topStart = 14.dp, topEnd = 14.dp))
                .border(1.dp, Ink.Hairline,
                    if (landscape) RoundedCornerShape(0.dp) else RoundedCornerShape(topStart = 14.dp, topEnd = 14.dp))
                .safeDrawingPadding()
                .pointerInput(Unit) { detectTapGestures { } }   // swallow taps meant for the sheet
                .verticalScroll(rememberScrollState())
                .padding(bottom = 24.dp)
        ) {
            Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 24.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Text(
                    when (which) { "sounds" -> "sounds"; "mix" -> "playing"; else -> "about" },
                    color = Ink.Text1, fontSize = 22.sp
                )
                Spacer(Modifier.weight(1f))
                TextButton("close") { onClose() }
            }

            when (which) {
                "sounds" -> SoundsTab(ui, cb)
                "mix" -> MixTab(ui, cb)
                else -> AboutTab(ui, cb)
            }
        }
    }
}

@Composable
private fun SoundsTab(ui: UiModel, cb: AppCallbacks) {
    SectionHeader("ambience")
    for (id in Ambience.ALL) {
        RowItem(
            name = Ambience.displayName(id),
            meta = Ambience.hint(id),
            selected = ui.ambienceId == id,
        ) { cb.onAmbience(if (ui.ambienceId == id) null else id) }
    }
    SectionHeader("your audio")
    RowItem(name = "add a file", meta = "mp3, m4a, flac, ogg, wav, opus", selected = false) {
        cb.onPickFile()
    }
    ui.trackName?.let {
        RowItem(name = it, meta = "playing from your phone", selected = true) { }
    }
}

@Composable
private fun MixTab(ui: UiModel, cb: AppCallbacks) {
    LabelledSlider("music", ui.musicVolume, cb.onMusicVolume)
    LabelledSlider("ambience", ui.ambienceVolume, cb.onAmbienceVolume)

    Spacer(Modifier.height(20.dp))
    Box(Modifier.fillMaxWidth().height(1.dp).background(Ink.Hairline))
    Spacer(Modifier.height(16.dp))

    Text("stop after", color = Ink.Text2, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 24.dp))
    Spacer(Modifier.height(8.dp))
    val opts = listOf(0, 15, 30, 45, 60, 90)
    Column(Modifier.padding(horizontal = 24.dp)) {
        opts.chunked(3).forEach { rowOpts ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                rowOpts.forEach { m ->
                    Chip(if (m == 0) "never" else if (m >= 60) "${m / 60}h" else "${m}m",
                        ui.timerMinutes == m, Modifier.weight(1f)) { cb.onTimer(m) }
                }
            }
            Spacer(Modifier.height(8.dp))
        }
    }

    Row(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Text("repeat all night", color = Ink.Text2, fontSize = 13.sp)
        Spacer(Modifier.weight(1f))
        Switch(ui.loop, cb.onLoop, colors = switchColours())
    }
}

@Composable
private fun AboutTab(ui: UiModel, cb: AppCallbacks) {
    Text("one screen, one button, and a sound to sleep to. no account, no tracking, no ads. " +
        "nothing leaves your phone.",
        color = Ink.Text2, fontSize = 15.sp, lineHeight = 22.sp,
        modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))

    ToggleRow("true black", "for oled screens — uses less power and cannot burn in",
        ui.amoled, cb.onAmoled)
    ToggleRow("keep the screen on", "off means audio only — the display sleeps as usual",
        ui.keepScreenOn, cb.onKeepScreenOn)
    ToggleRow("show the clock", null, ui.clockVisible, cb.onClockVisible)

    LabelledSlider("screen brightness in sleep mode", ui.sleepBrightness, cb.onBrightness)

    ToggleRow("alarm", if (ui.alarmEnabled) "wakes you at %02d:%02d".format(ui.alarmHour, ui.alarmMinute) else null,
        ui.alarmEnabled) { on -> cb.onAlarm(on, ui.alarmHour, ui.alarmMinute) }

    ui.lastSessionText?.let {
        Spacer(Modifier.height(16.dp))
        Box(Modifier.fillMaxWidth().height(1.dp).background(Ink.Hairline))
        Text(it, color = Ink.Text3, fontSize = 13.sp,
            modifier = Modifier.padding(horizontal = 24.dp, vertical = 12.dp))
    }

    Text("clawd sleep 1.0", color = Ink.Text3, fontSize = 13.sp,
        modifier = Modifier.padding(horizontal = 24.dp, vertical = 12.dp))
}

/* ----------------------------------------------------------------- atoms -- */

@Composable
private fun SectionHeader(s: String) {
    Text(s, color = Ink.Text2, fontSize = 13.sp, fontWeight = FontWeight.Medium,
        letterSpacing = 0.2.sp,
        modifier = Modifier.padding(start = 24.dp, end = 24.dp, top = 16.dp, bottom = 8.dp))
}

@Composable
private fun RowItem(name: String, meta: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 64.dp)
            .pointerInput(name) { detectTapGestures { onClick() } }
            .padding(horizontal = 24.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(Modifier.weight(1f)) {
            Text(name, color = if (selected) Ink.Accent else Ink.Text1, fontSize = 16.sp, maxLines = 1)
            if (meta.isNotEmpty()) {
                Text(meta, color = Ink.Text3, fontSize = 13.sp, letterSpacing = 0.2.sp, maxLines = 1)
            }
        }
        // Selected rows get a mark; unselected rows render nothing at all — no
        // empty circle, no ghost checkbox.
        if (selected) Box(Modifier.size(6.dp).background(Ink.Accent))
    }
    Box(Modifier.fillMaxWidth().padding(start = 24.dp).height(1.dp).background(Ink.Hairline))
}

@Composable
private fun LabelledSlider(label: String, value: Float, onChange: (Float) -> Unit) {
    Column(Modifier.padding(horizontal = 24.dp, vertical = 8.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(label, color = Ink.Text2, fontSize = 13.sp, letterSpacing = 0.2.sp)
            Spacer(Modifier.weight(1f))
            Text("${(value * 100).roundToInt()}", color = Ink.Text3, fontSize = 13.sp)
        }
        Slider(
            value = value, onValueChange = onChange,
            colors = SliderDefaults.colors(
                thumbColor = Ink.Text2,
                activeTrackColor = Ink.Accent.copy(alpha = 0.70f),
                inactiveTrackColor = Ink.Hairline,
            ),
            modifier = Modifier.fillMaxWidth().height(48.dp)
        )
    }
}

@Composable
private fun ToggleRow(label: String, meta: String?, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 24.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(label, color = Ink.Text1, fontSize = 16.sp)
            meta?.let { Text(it, color = Ink.Text3, fontSize = 13.sp, letterSpacing = 0.2.sp) }
        }
        Switch(checked, onChange, colors = switchColours())
    }
}

@Composable
private fun switchColours() = SwitchDefaults.colors(
    checkedThumbColor = Ink.Accent,
    checkedTrackColor = Color.Transparent,
    checkedBorderColor = Ink.Accent.copy(alpha = 0.45f),
    uncheckedThumbColor = Ink.Text3,
    uncheckedTrackColor = Color.Transparent,
    uncheckedBorderColor = Ink.Hairline,
)

@Composable
private fun Chip(label: String, on: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier.height(36.dp)
            .border(1.dp, if (on) Ink.Accent.copy(alpha = 0.55f) else Ink.Hairline, RoundedCornerShape(8.dp))
            .pointerInput(label) { detectTapGestures { onClick() } },
        contentAlignment = Alignment.Center
    ) { Text(label, color = if (on) Ink.Accent else Ink.Text2, fontSize = 13.sp) }
}

@Composable
private fun Pill(
    label: String,
    modifier: Modifier = Modifier,
    border: Color = Ink.Hairline,
    content: Color = Ink.Text1,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    Box(
        modifier.heightIn(min = 48.dp).alpha(if (enabled) 1f else 0.4f)
            .border(1.dp, border, RoundedCornerShape(999.dp))
            .pointerInput(label, enabled) { detectTapGestures { if (enabled) onClick() } }
            .padding(horizontal = 20.dp),
        contentAlignment = Alignment.Center
    ) { Text(label, color = content, fontSize = 16.sp, letterSpacing = 0.6.sp) }
}

@Composable
private fun TextButton(label: String, colour: Color = Ink.Text3, onClick: () -> Unit) {
    Box(
        Modifier.heightIn(min = 48.dp)
            .pointerInput(label) { detectTapGestures { onClick() } }
            .padding(horizontal = 12.dp),
        contentAlignment = Alignment.Center
    ) { Text(label, color = colour, fontSize = 13.sp, letterSpacing = 0.2.sp) }
}
