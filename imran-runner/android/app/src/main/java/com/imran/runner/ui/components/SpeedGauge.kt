package com.imran.runner.ui.components

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.sp
import androidx.compose.material3.Text
import com.imran.runner.ui.theme.ImranColors
import com.imran.runner.ui.theme.ImranType
import kotlin.math.cos
import kotlin.math.sin

/** The gauge sweeps 270 degrees, open at the bottom, exactly as in the reference. */
private const val START_ANGLE = 135f
private const val SWEEP_ANGLE = 270f

/** The dial starts at 20 km/h and steps up in tens only if the runner outruns it. */
private fun dialCeiling(topSpeedKmh: Float): Float {
    var ceiling = 20f
    while (topSpeedKmh > ceiling - 1f) ceiling += 10f
    return ceiling
}

/**
 * The centrepiece: current speed as a number, as an arc, and as a runner whose stride is driven
 * by that same number.
 *
 * @param speedKmh the live, already-smoothed speed.
 * @param sessionTopKmh highest speed seen this run, used only to decide when the dial needs a
 *   larger range so that the needle does not sit pinned.
 */
@Composable
fun SpeedGauge(
    speedKmh: Float,
    sessionTopKmh: Float,
    running: Boolean,
    caption: String,
    size: Dp,
    modifier: Modifier = Modifier,
) {
    val ceiling by animateFloatAsState(
        targetValue = dialCeiling(maxOf(speedKmh, sessionTopKmh)),
        animationSpec = spring(dampingRatio = 1f, stiffness = Spring.StiffnessVeryLow),
        label = "ceiling",
    )

    // A spring rather than a tween: the arc should feel weighted, settling into a new speed the
    // way a physical needle would, without ever overshooting far enough to look bouncy.
    val fraction by animateFloatAsState(
        targetValue = (speedKmh / ceiling).coerceIn(0f, 1f),
        animationSpec = spring(dampingRatio = 0.82f, stiffness = Spring.StiffnessLow),
        label = "gauge",
    )

    val displayed by animateFloatAsState(
        targetValue = speedKmh,
        animationSpec = spring(dampingRatio = 1f, stiffness = Spring.StiffnessMediumLow),
        label = "speed",
    )

    val gait = rememberGait(speedKmh = { speedKmh }, running = { running })

    // Type inside the gauge is scaled from the gauge's own size rather than from the system font
    // scale: the readout has to stay whole on a small phone, and a runner glancing at it mid-
    // stride is better served by a number that always fits than by one that honours a setting.
    val unit = size.value

    Box(modifier = modifier.height(size), contentAlignment = Alignment.TopCenter) {
        Canvas(Modifier.fillMaxSize()) {
            val w = this.size.width
            val h = this.size.height
            val stroke = w * 0.031f
            val inset = stroke * 1.9f
            val arcSize = Size(w - inset * 2f, h - inset * 2f)
            val topLeft = Offset(inset, inset)
            val radius = arcSize.minDimension / 2f
            val centre = Offset(w / 2f, h / 2f)

            drawArc(
                color = ImranColors.Track,
                startAngle = START_ANGLE,
                sweepAngle = SWEEP_ANGLE,
                useCenter = false,
                topLeft = topLeft,
                size = arcSize,
                style = roundStroke(stroke),
            )

            val sweep = SWEEP_ANGLE * fraction
            if (sweep > 0.4f) {
                // Three passes: a wide soft bloom, a tighter one, then the arc itself. Cheaper
                // and steadier across GPUs than a blur, and it is what gives the green its glow.
                drawArc(
                    color = ImranColors.Accent, startAngle = START_ANGLE, sweepAngle = sweep,
                    useCenter = false, topLeft = topLeft, size = arcSize,
                    style = roundStroke(stroke * 3.2f), alpha = 0.06f,
                )
                drawArc(
                    color = ImranColors.Accent, startAngle = START_ANGLE, sweepAngle = sweep,
                    useCenter = false, topLeft = topLeft, size = arcSize,
                    style = roundStroke(stroke * 1.9f), alpha = 0.13f,
                )
                drawArc(
                    color = ImranColors.Accent, startAngle = START_ANGLE, sweepAngle = sweep,
                    useCenter = false, topLeft = topLeft, size = arcSize,
                    style = roundStroke(stroke),
                )

                val angle = Math.toRadians((START_ANGLE + sweep).toDouble())
                val tip = Offset(
                    centre.x + radius * cos(angle).toFloat(),
                    centre.y + radius * sin(angle).toFloat(),
                )
                drawCircle(
                    brush = Brush.radialGradient(
                        colors = listOf(ImranColors.Accent.copy(alpha = 0.55f), Color.Transparent),
                        center = tip,
                        radius = stroke * 2.8f,
                    ),
                    radius = stroke * 2.8f,
                    center = tip,
                )
                drawCircle(Color.White, stroke * 0.60f, tip)
            }

            // Ground first, then the runner standing on it.
            drawGroundGrid(
                vanishing = Offset(w / 2f, h * 0.800f),
                width = w * 0.82f,
                depth = h * 0.075f,
                scroll = gait.ground,
                color = ImranColors.Accent,
                alpha = 0.60f,
            )
            drawSpeedStreaks(
                center = Offset(w / 2f, h * 0.845f),
                span = Size(w * 0.5f, h * 0.12f),
                scroll = gait.ground,
                intensity = gait.intensity,
                color = ImranColors.Accent,
            )
            drawRunner(
                feet = Offset(w / 2f, h * 0.862f),
                height = h * 0.145f,
                phase = gait.phase,
                intensity = gait.intensity,
                breath = gait.breath,
                bright = ImranColors.Accent,
                dim = ImranColors.AccentShadow,
            )
        }

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = size * 0.155f),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = caption,
                style = ImranType.Label.copy(fontSize = (unit * 0.041f).sp),
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(size * 0.015f))
            Box(
                modifier = Modifier.height(size * 0.315f),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = com.imran.runner.core.Format.oneDecimal(displayed.toDouble()),
                    style = ImranType.Hero.copy(
                        fontSize = (unit * 0.365f).sp,
                        letterSpacing = (unit * -0.016f).sp,
                    ),
                    maxLines = 1,
                    softWrap = false,
                )
            }
            Text(
                text = "KM/H",
                style = ImranType.HeroUnit.copy(
                    fontSize = (unit * 0.083f).sp,
                    letterSpacing = (unit * 0.017f).sp,
                ),
            )
        }
    }
}
