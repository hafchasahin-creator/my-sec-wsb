package com.imran.runner.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.cos
import kotlin.math.sin

/**
 * The app's iconography, drawn rather than imported.
 *
 * `material-icons-extended` would supply all of these, but with minification off it also ships
 * every one of the two thousand it does not need — several megabytes of dex for fourteen glyphs.
 * Drawing them keeps the download small and, more usefully, keeps the shapes exactly on the
 * reference: its stopwatch has a crossbar, its road has a dashed centre line.
 */
enum class RunnerIcon {
    Runner,
    Road,
    Flame,
    Stopwatch,
    Lock,
    LockOpen,
    Flag,
    Play,
    Pause,
    Settings,
    History,
    Stats,
    Person,
    Speedometer,
    Mountain,
    Trophy,
}

@Composable
fun ImranIcon(
    icon: RunnerIcon,
    tint: Color,
    size: Dp = 22.dp,
    modifier: Modifier = Modifier,
) {
    Canvas(modifier.size(size)) { drawRunnerIcon(icon, tint, this.size.minDimension) }
}

/**
 * Draws [icon] into the current canvas at [extent] pixels square, anchored at the origin.
 *
 * Every glyph is authored on a 24x24 grid, the same one the reference's icons use, so the shapes
 * stay consistent with each other whatever size they are drawn at.
 */
fun DrawScope.drawRunnerIcon(icon: RunnerIcon, tint: Color, extent: Float) {
    val u = extent / 24f

    fun at(x: Float, y: Float) = Offset(x * u, y * u)

    fun stroke(width: Float, vararg points: Float) {
        var i = 0
        while (i + 3 < points.size) {
            drawLine(
                tint,
                at(points[i], points[i + 1]),
                at(points[i + 2], points[i + 3]),
                width * u,
                StrokeCap.Round,
            )
            i += 2
        }
    }

    fun dot(x: Float, y: Float, r: Float, color: Color = tint) =
        drawCircle(color, r * u, at(x, y))

    fun shape(color: Color, rounding: Float = 0f, build: Path.() -> Unit) {
        val path = Path().apply(build)
        drawPath(path, color, style = Fill)
        if (rounding > 0f) {
            drawPath(
                path,
                color,
                style = Stroke(rounding * u, cap = StrokeCap.Round, join = StrokeJoin.Round),
            )
        }
    }

    when (icon) {
        RunnerIcon.Runner -> {
            dot(14.8f, 4.2f, 2.15f)
            stroke(2.3f, 14.2f, 8.4f, 11.0f, 13.4f)
            stroke(2.1f, 14.4f, 9.4f, 17.4f, 11.4f, 15.6f, 13.6f)
            stroke(2.1f, 13.9f, 8.9f, 10.3f, 9.4f, 8.6f, 6.6f)
            stroke(2.3f, 11.0f, 13.4f, 15.1f, 15.0f, 13.9f, 18.9f)
            stroke(2.3f, 11.0f, 13.4f, 7.4f, 15.6f, 9.8f, 18.4f)
        }

        RunnerIcon.Road -> {
            stroke(2.1f, 7.4f, 20.4f, 10.2f, 3.8f)
            stroke(2.1f, 16.6f, 20.4f, 13.8f, 3.8f)
            stroke(1.9f, 12f, 5.2f, 12f, 8.2f)
            stroke(1.9f, 12f, 10.6f, 12f, 13.6f)
            stroke(1.9f, 12f, 16f, 12f, 19f)
        }

        RunnerIcon.Flame -> {
            shape(tint) {
                moveTo(12f * u, 21.8f * u)
                cubicTo(7.9f * u, 21.8f * u, 5.2f * u, 18.6f * u, 5.2f * u, 14.6f * u)
                cubicTo(5.2f * u, 10.2f * u, 9.2f * u, 7.6f * u, 10.6f * u, 2.2f * u)
                cubicTo(14.2f * u, 5.6f * u, 18.8f * u, 9.4f * u, 18.8f * u, 14.6f * u)
                cubicTo(18.8f * u, 18.6f * u, 16.1f * u, 21.8f * u, 12f * u, 21.8f * u)
                close()
            }
            // A hotter core, so the flame reads as fire rather than as a leaf.
            shape(lighten(tint, 0.45f)) {
                moveTo(12f * u, 20.4f * u)
                cubicTo(9.8f * u, 20.4f * u, 8.5f * u, 18.6f * u, 8.5f * u, 16.4f * u)
                cubicTo(8.5f * u, 13.9f * u, 10.7f * u, 12.8f * u, 11.7f * u, 9.9f * u)
                cubicTo(13.7f * u, 12f * u, 15.5f * u, 13.8f * u, 15.5f * u, 16.4f * u)
                cubicTo(15.5f * u, 18.6f * u, 14.2f * u, 20.4f * u, 12f * u, 20.4f * u)
                close()
            }
        }

        RunnerIcon.Stopwatch -> {
            drawCircle(tint, 7.2f * u, at(12f, 13.6f), style = Stroke(2.1f * u))
            stroke(2.4f, 9.5f, 3.3f, 14.5f, 3.3f)
            stroke(2.2f, 12f, 4.1f, 12f, 6.4f)
            stroke(2f, 12f, 13.6f, 12f, 9.4f)
        }

        RunnerIcon.Lock -> {
            drawArc(
                color = tint,
                startAngle = 180f,
                sweepAngle = 180f,
                useCenter = false,
                topLeft = at(8.2f, 7.4f),
                size = Size(7.6f * u, 7.6f * u),
                style = Stroke(2.2f * u, cap = StrokeCap.Round),
            )
            drawRoundRect(
                color = tint,
                topLeft = at(6.2f, 11f),
                size = Size(11.6f * u, 9.4f * u),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(2.4f * u, 2.4f * u),
            )
        }

        RunnerIcon.LockOpen -> {
            drawArc(
                color = tint,
                startAngle = 180f,
                sweepAngle = 140f,
                useCenter = false,
                topLeft = at(11.2f, 6.2f),
                size = Size(7.6f * u, 7.6f * u),
                style = Stroke(2.2f * u, cap = StrokeCap.Round),
            )
            drawRoundRect(
                color = tint,
                topLeft = at(5.2f, 11f),
                size = Size(11.6f * u, 9.4f * u),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(2.4f * u, 2.4f * u),
            )
        }

        RunnerIcon.Flag -> {
            stroke(2.2f, 7f, 3.4f, 7f, 20.9f)
            shape(tint, rounding = 0.9f) {
                moveTo(8.2f * u, 4.3f * u)
                lineTo(18.4f * u, 4.3f * u)
                lineTo(15.7f * u, 8.1f * u)
                lineTo(18.4f * u, 11.9f * u)
                lineTo(8.2f * u, 11.9f * u)
                close()
            }
        }

        RunnerIcon.Play -> shape(tint, rounding = 2.4f) {
            moveTo(9.6f * u, 6.6f * u)
            lineTo(18.2f * u, 12f * u)
            lineTo(9.6f * u, 17.4f * u)
            close()
        }

        RunnerIcon.Pause -> {
            drawRoundRect(
                tint, at(7.2f, 5.6f), Size(3.5f * u, 12.8f * u),
                androidx.compose.ui.geometry.CornerRadius(1.7f * u, 1.7f * u),
            )
            drawRoundRect(
                tint, at(13.3f, 5.6f), Size(3.5f * u, 12.8f * u),
                androidx.compose.ui.geometry.CornerRadius(1.7f * u, 1.7f * u),
            )
        }

        RunnerIcon.Settings -> {
            for (i in 0 until 8) {
                val a = i * Math.PI.toFloat() / 4f
                drawLine(
                    tint,
                    at(12f + 5.1f * cos(a), 12f + 5.1f * sin(a)),
                    at(12f + 8.1f * cos(a), 12f + 8.1f * sin(a)),
                    3.3f * u,
                    StrokeCap.Round,
                )
            }
            drawCircle(tint, 5.4f * u, at(12f, 12f), style = Stroke(3.2f * u))
            drawCircle(tint, 2.1f * u, at(12f, 12f))
        }

        RunnerIcon.History -> {
            drawRoundRect(
                color = tint,
                topLeft = at(4.8f, 4.4f),
                size = Size(14.4f * u, 16.6f * u),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(2.6f * u, 2.6f * u),
                style = Stroke(2f * u),
            )
            drawRoundRect(
                color = tint,
                topLeft = at(8.6f, 2.4f),
                size = Size(6.8f * u, 4f * u),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(1.4f * u, 1.4f * u),
            )
            stroke(1.8f, 8.2f, 11.4f, 15.8f, 11.4f)
            stroke(1.8f, 8.2f, 14.8f, 15.8f, 14.8f)
            stroke(1.8f, 8.2f, 18.2f, 13f, 18.2f)
        }

        RunnerIcon.Stats -> {
            stroke(3.4f, 6.6f, 19.4f, 6.6f, 14.4f)
            stroke(3.4f, 12f, 19.4f, 12f, 7.6f)
            stroke(3.4f, 17.4f, 19.4f, 17.4f, 11.2f)
        }

        RunnerIcon.Person -> {
            dot(12f, 7.8f, 3.7f)
            drawArc(
                color = tint,
                startAngle = 200f,
                sweepAngle = 140f,
                useCenter = false,
                topLeft = at(4.4f, 14f),
                size = Size(15.2f * u, 15.2f * u),
                style = Stroke(4.4f * u, cap = StrokeCap.Round),
            )
        }

        RunnerIcon.Speedometer -> {
            drawArc(
                color = tint,
                startAngle = 160f,
                sweepAngle = 220f,
                useCenter = false,
                topLeft = at(4.6f, 5.6f),
                size = Size(14.8f * u, 14.8f * u),
                style = Stroke(2.1f * u, cap = StrokeCap.Round),
            )
            stroke(2.2f, 12f, 13f, 15.6f, 8.8f)
            dot(12f, 13f, 1.5f)
        }

        RunnerIcon.Mountain -> shape(tint, rounding = 1.1f) {
            moveTo(2.8f * u, 19.4f * u)
            lineTo(9.4f * u, 7.4f * u)
            lineTo(13.1f * u, 13.6f * u)
            lineTo(15.6f * u, 9.6f * u)
            lineTo(21.2f * u, 19.4f * u)
            close()
        }

        RunnerIcon.Trophy -> {
            shape(tint, rounding = 0.9f) {
                moveTo(8.2f * u, 3.4f * u)
                lineTo(15.8f * u, 3.4f * u)
                lineTo(15.2f * u, 9.4f * u)
                cubicTo(15f * u, 11.2f * u, 13.6f * u, 12.2f * u, 12f * u, 12.2f * u)
                cubicTo(10.4f * u, 12.2f * u, 9f * u, 11.2f * u, 8.8f * u, 9.4f * u)
                close()
            }
            drawArc(
                color = tint, startAngle = 300f, sweepAngle = 150f, useCenter = false,
                topLeft = at(3.6f, 3.8f), size = Size(5.4f * u, 5.4f * u),
                style = Stroke(1.8f * u, cap = StrokeCap.Round),
            )
            drawArc(
                color = tint, startAngle = 270f, sweepAngle = 150f, useCenter = false,
                topLeft = at(15f, 3.8f), size = Size(5.4f * u, 5.4f * u),
                style = Stroke(1.8f * u, cap = StrokeCap.Round),
            )
            stroke(2.2f, 12f, 12.2f, 12f, 16.4f)
            drawRoundRect(
                tint, at(7.8f, 16.4f), Size(8.4f * u, 3.4f * u),
                androidx.compose.ui.geometry.CornerRadius(1.4f * u, 1.4f * u),
            )
        }
    }
}

/** Draws [icon] centred on [centre] at [extent] pixels square. */
fun DrawScope.drawRunnerIconAt(
    icon: RunnerIcon,
    tint: Color,
    centre: Offset,
    extent: Float,
) {
    translate(centre.x - extent / 2f, centre.y - extent / 2f) {
        drawRunnerIcon(icon, tint, extent)
    }
}

private fun lighten(color: Color, amount: Float) = Color(
    red = color.red + (1f - color.red) * amount,
    green = color.green + (1f - color.green) * amount,
    blue = color.blue + (1f - color.blue) * amount,
    alpha = color.alpha,
)
