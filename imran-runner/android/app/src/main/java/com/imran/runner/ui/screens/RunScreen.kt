package com.imran.runner.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import com.imran.runner.core.Format
import com.imran.runner.tracking.RunMetrics
import com.imran.runner.tracking.RunState
import com.imran.runner.ui.components.ControlRow
import com.imran.runner.ui.components.ImranIcon
import com.imran.runner.ui.components.MetricPanel
import com.imran.runner.ui.components.PageDots
import com.imran.runner.ui.components.PanelSpec
import com.imran.runner.ui.components.RunTopBar
import com.imran.runner.ui.components.RunnerIcon
import com.imran.runner.ui.components.SpeedGauge
import com.imran.runner.ui.components.StatRow
import com.imran.runner.ui.components.StatSpec
import com.imran.runner.ui.theme.ImranColors
import com.imran.runner.ui.theme.ImranType
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

private const val UNLOCK_HOLD_SECONDS = 1.1f

@Composable
fun RunScreen(
    metrics: RunMetrics,
    locked: Boolean,
    permissionGranted: Boolean,
    locationEnabled: Boolean,
    onPrimary: () -> Unit,
    onLock: () -> Unit,
    onUnlock: () -> Unit,
    onFinish: () -> Unit,
    onSettings: () -> Unit,
    onRequestPermission: () -> Unit,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier.fillMaxSize()) {
        val compact = maxHeight < 680.dp
        val gaugeSize = minOf(maxWidth - 40.dp, maxHeight * (if (compact) 0.365f else 0.395f))
        val pager = rememberPagerState(pageCount = { 2 })

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(if (compact) 6.dp else 12.dp))

            RunTopBar(
                quality = metrics.gps,
                title = when {
                    locked -> "LOCKED"
                    metrics.state == RunState.RUNNING -> "RUNNING"
                    metrics.state == RunState.PAUSED -> "PAUSED"
                    metrics.state == RunState.FINISHED -> "FINISHED"
                    else -> "READY"
                },
                titleTint = if (metrics.state == RunState.RUNNING) {
                    ImranColors.Accent
                } else {
                    ImranColors.TextDim
                },
                onSettings = onSettings,
            )

            Spacer(Modifier.weight(0.5f))

            SpeedGauge(
                speedKmh = (metrics.speedMps * 3.6).toFloat(),
                sessionTopKmh = (metrics.maxSpeedMps * 3.6).toFloat(),
                running = metrics.state == RunState.RUNNING,
                caption = "CURRENT SPEED",
                size = gaugeSize,
            )

            Spacer(Modifier.weight(0.6f))

            HorizontalPager(
                state = pager,
                modifier = Modifier.fillMaxWidth(),
            ) { page ->
                StatRow(if (page == 0) primaryStats(metrics) else secondaryStats(metrics))
            }

            Spacer(Modifier.height(if (compact) 8.dp else 14.dp))
            PageDots(count = 2, selected = pager.currentPage)
            Spacer(Modifier.height(if (compact) 10.dp else 16.dp))

            MetricPanel(summaryPanel(metrics))

            Spacer(Modifier.weight(0.75f))

            if (!permissionGranted || !locationEnabled) {
                LocationNotice(
                    permissionGranted = permissionGranted,
                    onRequestPermission = onRequestPermission,
                )
                Spacer(Modifier.height(14.dp))
            }

            ControlRow(
                state = metrics.state,
                locked = locked,
                primaryDiameter = if (compact) 80.dp else 92.dp,
                secondaryDiameter = if (compact) 58.dp else 66.dp,
                onPrimary = onPrimary,
                onLock = onLock,
                onFinish = onFinish,
            )

            Spacer(Modifier.weight(0.55f))
        }

        if (locked) {
            LockOverlay(onUnlock = onUnlock)
        }
    }
}

private fun primaryStats(metrics: RunMetrics) = listOf(
    StatSpec(
        icon = RunnerIcon.Road,
        iconTint = ImranColors.Blue,
        label = "DISTANCE",
        unit = "KM",
        unitTint = ImranColors.Blue,
        value = (metrics.distanceMeters / 1000.0).toFloat(),
        format = { String.format(java.util.Locale.US, "%.2f", it) },
    ),
    StatSpec(
        icon = RunnerIcon.Flame,
        iconTint = ImranColors.Orange,
        label = "CALORIES",
        unit = "KCAL",
        unitTint = ImranColors.Orange,
        value = metrics.calories.toFloat(),
        format = { Format.integer(it.toDouble()) },
    ),
    StatSpec(
        icon = RunnerIcon.Stopwatch,
        iconTint = ImranColors.Accent,
        label = "DURATION",
        unit = "TIME",
        unitTint = ImranColors.Accent,
        value = metrics.elapsedMs / 1000f,
        format = { Format.duration((it * 1000f).toLong()) },
        // The clock ticks; easing it would only make it read as late.
        animated = false,
    ),
)

private fun secondaryStats(metrics: RunMetrics) = listOf(
    StatSpec(
        icon = RunnerIcon.Speedometer,
        iconTint = ImranColors.Accent,
        label = "PACE NOW",
        unit = "/KM",
        unitTint = ImranColors.Accent,
        value = metrics.livePaceSecPerKm.toFloat(),
        format = { Format.pace(it.toDouble()) },
        animated = false,
    ),
    StatSpec(
        icon = RunnerIcon.Stopwatch,
        iconTint = ImranColors.Blue,
        label = "LAST KM",
        unit = "/KM",
        unitTint = ImranColors.Blue,
        value = metrics.lastKmPaceSecPerKm.toFloat(),
        format = { Format.pace(it.toDouble()) },
        animated = false,
    ),
    StatSpec(
        icon = RunnerIcon.Mountain,
        iconTint = ImranColors.Orange,
        label = "ELEVATION",
        unit = "M GAIN",
        unitTint = ImranColors.Orange,
        value = metrics.elevationGainMeters.toFloat(),
        format = { Format.integer(it.toDouble()) },
    ),
)

private fun summaryPanel(metrics: RunMetrics) = listOf(
    PanelSpec(
        label = "AVG SPEED",
        unit = "KM/H",
        unitTint = ImranColors.Blue,
        value = (metrics.avgSpeedMps * 3.6).toFloat(),
        format = { Format.oneDecimal(it.toDouble()) },
    ),
    PanelSpec(
        label = "MAX SPEED",
        unit = "KM/H",
        unitTint = ImranColors.Blue,
        value = (metrics.maxSpeedMps * 3.6).toFloat(),
        format = { Format.oneDecimal(it.toDouble()) },
    ),
    PanelSpec(
        label = "AVG PACE",
        unit = "/KM",
        unitTint = ImranColors.Blue,
        value = metrics.avgPaceSecPerKm.toFloat(),
        format = { Format.pace(it.toDouble()) },
    ),
)

/** Tells the runner why the numbers are not moving, and offers the one tap that fixes it. */
@Composable
private fun LocationNotice(
    permissionGranted: Boolean,
    onRequestPermission: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(ImranColors.SurfaceRaised)
            .pointerInput(permissionGranted) {
                detectTapGestures { if (!permissionGranted) onRequestPermission() }
            }
            .padding(horizontal = 16.dp, vertical = 12.dp),
    ) {
        Text(
            text = if (!permissionGranted) {
                "Location access is off — tap to allow so Imran Runner can track your run."
            } else {
                "Turn on your phone's location to start tracking."
            },
            style = ImranType.Body.copy(color = ImranColors.Amber),
        )
    }
}

/**
 * Swallows every touch until the runner holds anywhere on the screen.
 *
 * A pocket press or a raindrop must not be able to stop a run, but the way out has to be
 * findable while moving, so the gesture is hold-anywhere rather than a target to hit.
 */
@Composable
private fun LockOverlay(onUnlock: () -> Unit) {
    var progress by remember { mutableFloatStateOf(0f) }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .pointerInput(Unit) {
                detectTapGestures(
                    onPress = {
                        coroutineScope {
                            val hold = launch {
                                val start = withFrameNanos { it }
                                while (isActive && progress < 1f) {
                                    withFrameNanos { now ->
                                        progress = ((now - start) / 1_000_000_000f /
                                            UNLOCK_HOLD_SECONDS).coerceIn(0f, 1f)
                                    }
                                }
                                if (progress >= 1f) onUnlock()
                            }
                            tryAwaitRelease()
                            hold.cancel()
                            progress = 0f
                        }
                    },
                )
            },
    ) {
        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 40.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Bottom,
        ) {
            Box(contentAlignment = Alignment.Center) {
                androidx.compose.foundation.Canvas(Modifier.size(64.dp)) {
                    val stroke = size.minDimension * 0.075f
                    drawCircle(
                        color = ImranColors.Track,
                        radius = size.minDimension / 2f - stroke,
                        style = Stroke(stroke),
                    )
                    if (progress > 0.001f) {
                        drawArc(
                            color = ImranColors.Accent,
                            startAngle = -90f,
                            sweepAngle = 360f * progress,
                            useCenter = false,
                            topLeft = androidx.compose.ui.geometry.Offset(stroke, stroke),
                            size = androidx.compose.ui.geometry.Size(
                                size.width - stroke * 2f,
                                size.height - stroke * 2f,
                            ),
                            style = Stroke(stroke, cap = StrokeCap.Round),
                        )
                    }
                }
                ImranIcon(RunnerIcon.Lock, ImranColors.Accent, size = 24.dp)
            }
            Spacer(Modifier.height(12.dp))
            Text("HOLD ANYWHERE TO UNLOCK", style = ImranType.ControlLabel.copy(color = Color.White))
        }
    }
}
