package sleep.clawd.ui

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import kotlin.math.PI
import kotlin.math.pow
import kotlin.math.sin

/**
 * The night sky.
 *
 * Star positions come from a real PRNG, not a low-discrepancy sequence: feeding
 * consecutive golden-ratio values into (x, y) lays every point on a lattice, and
 * the first version of this came out as neat diagonal arcs across the screen.
 */
class Night(private val seedBase: Int = 0x5EED) {

    class Star(val x: Float, val y: Float, val r: Float, val a: Float, val p: Float, val s: Float)

    var stars: List<Star> = emptyList(); private set
    private var twinkleIdx: IntArray = IntArray(0)
    private var w = 0f
    private var h = 0f

    private fun rnd(seed: Int): () -> Float {
        var a = seed
        return {
            a += 0x6D2B79F5
            var t = a
            t = (t xor (t ushr 15)) * (1 or t)
            t = (t + ((t xor (t ushr 7)) * (61 or t))) xor t
            (((t xor (t ushr 14)).toLong() and 0xFFFFFFFFL).toDouble() / 4294967296.0).toFloat()
        }
    }

    fun layout(width: Float, height: Float) {
        if (width == w && height == h) return
        w = width; h = height
        val r = rnd(seedBase)
        val count = (150 * ((width * height) / (1080f * 2100f)).coerceIn(0.55f, 1.9f)).toInt()
        val list = ArrayList<Star>(count)
        repeat(count) {
            val v = r()
            val y = r().toDouble().pow(0.72).toFloat() * height   // biased toward the top
            val near = (1f - y / height).coerceIn(0f, 1f)
            list.add(Star(
                x = r() * width,
                y = y,
                r = (0.42f + (1.35f - 0.42f) * v * v),
                a = (0.10f + 0.52f * v) * (0.35f + 0.65f * near),
                p = r() * 1000f,
                s = 7f + 12f * r()
            ))
        }
        stars = list
        twinkleIdx = list.indices.sortedByDescending { list[it].a }.take(16).toIntArray()
    }

    fun DrawScope.paint(now: Float, alpha: Float, amoled: Boolean, dim: Float, dpScale: Float) {
        val bg = if (amoled) Ink.TrueBlack else Ink.Void
        drawRect(bg)
        if (alpha <= 0.004f) return

        // One two-stop gradient in the bottom 42%. Two stops, no line, no third
        // colour — anything more reads as a template.
        if (!amoled) {
            drawRect(Brush.verticalGradient(
                0.58f to Ink.Void.copy(alpha = 0f),
                1f to Ink.Horizon.copy(alpha = 0.85f * alpha)
            ))
        }
        // The horizon: one wide, very low-contrast pool of light under Clawd's
        // feet. Without it the frame reads as a flat black rectangle.
        val hr = maxOf(size.width, size.height) * 0.72f
        drawCircle(
            Brush.radialGradient(
                0f to Color(0x4D2E4068), 0.45f to Color(0x211C2846), 1f to Color(0x000A0F1C),
                center = Offset(size.width / 2, size.height * 0.80f), radius = hr
            ),
            radius = hr, center = Offset(size.width / 2, size.height * 0.80f),
            alpha = alpha * (1f - dim * 0.6f)
        )

        val starA = alpha * (1f - dim * 0.5f) * (if (amoled) 0.82f else 1f)
        val twSet = twinkleIdx.toHashSet()
        for (i in stars.indices) {
            val st = stars[i]
            // Only the brightest handful twinkle; animating all 150 costs ten
            // times as much for something nobody can see.
            val k = if (i in twSet) 0.62f + 0.38f * sin((now + st.p) / st.s * 2 * PI).toFloat() else 1f
            drawCircle(Ink.Star, radius = st.r * dpScale,
                center = Offset(st.x, st.y), alpha = st.a * k * starA)
        }
    }
}
