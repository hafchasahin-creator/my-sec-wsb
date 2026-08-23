package com.imran.runner.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.imran.runner.tracking.RoutePoint
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min

/**
 * The shape of the run.
 *
 * There is no basemap behind it — the app never touches the network — so the trace is drawn on
 * its own, scaled to fill the space it is given while keeping its true proportions. Longitude is
 * squeezed by the cosine of the latitude, otherwise a route in northern Europe would come out
 * stretched sideways.
 */
@Composable
fun RouteTrace(
    points: List<RoutePoint>,
    color: Color,
    modifier: Modifier = Modifier,
    strokeWidth: Dp = 3.dp,
    showEnds: Boolean = false,
) {
    Canvas(modifier) {
        if (points.size < 2) return@Canvas

        var minLat = Double.MAX_VALUE
        var maxLat = -Double.MAX_VALUE
        var minLon = Double.MAX_VALUE
        var maxLon = -Double.MAX_VALUE
        for (p in points) {
            minLat = min(minLat, p.latitude); maxLat = max(maxLat, p.latitude)
            minLon = min(minLon, p.longitude); maxLon = max(maxLon, p.longitude)
        }

        val midLat = (minLat + maxLat) / 2.0
        val lonScale = cos(Math.toRadians(midLat)).coerceAtLeast(0.05)
        val spanX = ((maxLon - minLon) * lonScale).coerceAtLeast(1e-7)
        val spanY = (maxLat - minLat).coerceAtLeast(1e-7)

        val pad = strokeWidth.toPx()
        val usableW = (size.width - pad * 2f).coerceAtLeast(1f)
        val usableH = (size.height - pad * 2f).coerceAtLeast(1f)
        val scale = min(usableW / spanX, usableH / spanY).toFloat()

        val drawnW = (spanX * scale).toFloat()
        val drawnH = (spanY * scale).toFloat()
        val originX = (size.width - drawnW) / 2f
        val originY = (size.height - drawnH) / 2f

        fun project(p: RoutePoint) = Offset(
            originX + (((p.longitude - minLon) * lonScale) * scale).toFloat(),
            // Latitude grows northward but the canvas grows downward.
            originY + drawnH - (((p.latitude - minLat) * scale).toFloat()),
        )

        val path = Path()
        val first = project(points.first())
        path.moveTo(first.x, first.y)
        for (i in 1 until points.size) {
            val q = project(points[i])
            path.lineTo(q.x, q.y)
        }

        drawPath(
            path = path,
            color = color,
            style = Stroke(
                width = strokeWidth.toPx(),
                cap = StrokeCap.Round,
                join = StrokeJoin.Round,
            ),
        )

        if (showEnds) {
            val last = project(points.last())
            drawCircle(Color.White, strokeWidth.toPx() * 1.5f, first)
            drawCircle(color, strokeWidth.toPx() * 1.5f, last)
        }
    }
}
