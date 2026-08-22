package sleep.clawd.ui

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.lerp
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.sin

/**
 * Clawd.
 *
 * The artwork is the user's own 12x8 pixel grid. Nothing here redraws that
 * shape — it is split into six rigid layers that transform independently, and at
 * rest the composite is identical to the source image.
 *
 * Each layer is one Path. Filling cell by cell would leave a faint seam along
 * every shared edge once a layer sits at a fractional offset; one path fill
 * rasterises the whole region at once, so the interior stays solid and only the
 * true silhouette softens. That is what lets him breathe by fractions of a pixel
 * instead of snapping a whole row at a time.
 */
object ClawdArt {
    const val COLS = 12
    const val ROWS = 8
    const val CELL = 32f
    const val W = COLS * CELL      // 384
    const val H = ROWS * CELL      // 256

    private val BODY_COLS = 2..9
    private val LEG_COLS = intArrayOf(2, 4, 7, 9)
    private val EYE_COLS = intArrayOf(3, 8)
    private const val EYE_ROW = 1

    const val TORSO_BOTTOM = 6 * CELL
    const val SHOULDER_Y = 3.6f * CELL

    private fun pathOf(cells: List<Pair<Int, Int>>) = Path().apply {
        for ((c, r) in cells) addRect(
            androidx.compose.ui.geometry.Rect(c * CELL, r * CELL, (c + 1) * CELL, (r + 1) * CELL)
        )
    }

    val body: Path by lazy {
        pathOf(buildList {
            for (r in 0..5) for (c in BODY_COLS) {
                if (r == EYE_ROW && (c == EYE_COLS[0] || c == EYE_COLS[1])) continue
                add(c to r)
            }
        })
    }
    val armL: Path by lazy { pathOf(listOf(0 to 2, 0 to 3, 1 to 2, 1 to 3)) }
    val armR: Path by lazy { pathOf(listOf(10 to 2, 10 to 3, 11 to 2, 11 to 3)) }
    val legs: Path by lazy { pathOf(buildList { for (c in LEG_COLS) { add(c to 6); add(c to 7) } }) }

    val eyeBoxes = EYE_COLS.map { c -> floatArrayOf(c * CELL, EYE_ROW * CELL, CELL, CELL) }

    /** A 5x5 pixel "Z", in Clawd's own idiom. A script glyph here would look cheap. */
    val zGlyph: Path by lazy {
        val rows = listOf("11111", "00011", "00100", "11000", "11111")
        Path().apply {
            for (r in rows.indices) for (c in 0 until 5)
                if (rows[r][c] == '1')
                    addRect(androidx.compose.ui.geometry.Rect(c.toFloat(), r.toFloat(), c + 1f, r + 1f))
        }
    }
}

/* --------------------------------------------------------------- shaping -- */

private fun smooth(t: Float): Float { val x = t.coerceIn(0f, 1f); return x * x * (3 - 2 * x) }
private fun easeIn(t: Float): Float { val x = t.coerceIn(0f, 1f); return x * x * x }
private fun easeOut(t: Float): Float { val x = t.coerceIn(0f, 1f); return 1 - (1 - x) * (1 - x) * (1 - x) }
private fun lerpF(a: Float, b: Float, t: Float) = a + (b - a) * t

/**
 * The breath curve.
 *
 * A sine is the wrong shape. Real breathing has a shorter inhale, a longer
 * exhale, and a rest at the bottom — which is why sine-breathing characters read
 * as pulsing rather than sleeping. Zero derivative at every junction, so it loops
 * without a corner.
 */
fun breath(phase: Float): Float {
    val p = phase - floor(phase)
    return when {
        p < 0.38f -> smooth(p / 0.38f)
        p < 0.84f -> 1f - smooth((p - 0.38f) / 0.46f)
        else -> 0f
    }
}

/** Golden-ratio additive recurrence: evenly spread, never clumping, no RNG needed. */
private class Seq(seed: Float) {
    private var x = seed
    fun next(): Float { x += 0.6180339887f; if (x >= 1f) x -= 1f; return x }
}

private class Sched(var lo: Float, var hi: Float, seed: Float) {
    private val seq = Seq(seed)
    private var at = -1f
    fun due(now: Float): Float {
        if (at < 0f) { at = now + lo + (hi - lo) * seq.next(); return -1f }
        if (now < at) return -1f
        val v = seq.next()
        at = now + lo + (hi - lo) * v
        return v
    }
    fun reset(now: Float, delay: Float) { at = now + delay }
}

/* ----------------------------------------------------------------- state -- */

class ClawdState {
    enum class Mode { AWAKE, DROWSY, ASLEEP }

    var mode: Mode = Mode.AWAKE; private set
    var calm = 0f; private set
    private var calmTarget = 0f
    var reducedMotion = false

    private val seq = Seq(0.137f)
    private val blinks = Sched(2.6f, 7.4f, 0.311f)
    private val twitches = Sched(11f, 26f, 0.577f)
    private val zzz = Sched(2.6f, 4.6f, 0.733f)
    private val microWake = Sched(150f, 420f, 0.211f)

    private class Blink(val start: Float, val close: Float, val hold: Float, val open: Float,
                        val depth: Float, var double: Boolean)
    private var blink: Blink? = null

    private class Twitch(val start: Float, val dur: Float, val kind: Int, val dir: Float, val mag: Float)
    private var twitch: Twitch? = null

    class Particle(val born: Float, val life: Float, val dx: Float, val wob: Float,
                   val wobT: Float, val size: Float)
    val particles = ArrayList<Particle>(4)

    fun setMode(m: Mode, now: Float) {
        if (m == mode) return
        mode = m
        calmTarget = when (m) { Mode.ASLEEP -> 1f; Mode.DROWSY -> 0.45f; else -> 0f }
        when (m) {
            Mode.ASLEEP -> { zzz.reset(now, 2f); blinks.lo = 9f; blinks.hi = 24f }
            Mode.DROWSY -> { blinks.lo = 3.4f; blinks.hi = 9f }
            Mode.AWAKE -> { blinks.lo = 2.6f; blinks.hi = 7.4f; particles.clear() }
        }
    }

    fun update(now: Float, dt: Float) {
        calm += (calmTarget - calm) * (1f - exp(-dt / 0.75f))

        if (mode != Mode.ASLEEP) {
            val v = blinks.due(now)
            if (v >= 0f && blink == null) {
                // Fast close, slower open. The asymmetry is what reads as a blink
                // rather than a flicker.
                blink = Blink(now, 0.052f, if (v < 0.13f) 0.02f else 0f, 0.11f, 1f, v < 0.13f)
            }
        } else {
            val v = microWake.due(now)
            if (v >= 0f && blink == null) blink = Blink(now, 0.9f, 0.5f, 1.6f, -0.55f, false)
        }
        blink?.let { b ->
            if (now - b.start >= b.close + b.hold + b.open) {
                blink = if (b.double) Blink(now, b.close, 0f, b.open, b.depth, false) else null
            }
        }

        if (twitch == null) {
            val v = twitches.due(now)
            if (v >= 0f) twitch = Twitch(now, lerpF(1.6f, 3.4f, v), (v * 4).toInt() and 3,
                if (v < 0.5f) -1f else 1f, lerpF(0.55f, 1f, seq.next()))
        } else if (now - twitch!!.start > twitch!!.dur) twitch = null

        if (calm > 0.55f && !reducedMotion) {
            val v = zzz.due(now)
            if (v >= 0f && particles.size < 3) {
                particles.add(Particle(now, lerpF(5f, 6.4f, v), lerpF(-3f, 7f, seq.next()),
                    lerpF(5f, 11f, seq.next()), lerpF(2.6f, 4.2f, seq.next()),
                    lerpF(2.6f, 3.6f, seq.next())))
            }
        }
        // Bounded, always: an unbounded particle list is how an eight-hour
        // animation quietly turns into an out-of-memory crash.
        particles.removeAll { now - it.born > it.life }
    }

    fun lidOpenness(now: Float): Float {
        val base = 1f - calm * 0.86f
        val b = blink ?: return base
        val e = now - b.start
        val p = when {
            e < b.close -> easeIn(e / b.close)
            e < b.close + b.hold -> 1f
            else -> 1f - easeOut((e - b.close - b.hold) / b.open)
        }
        return if (b.depth < 0f) (base + -b.depth * p * (1f - base)).coerceIn(0f, 1f)
        else base * (1f - p)
    }

    internal fun twitchOf(now: Float): FloatArray {
        val out = floatArrayOf(0f, 0f, 0f, 0f) // tilt, armL, armR, shift
        val tw = twitch ?: return out
        if (reducedMotion) return out
        val p = ((now - tw.start) / tw.dur).coerceIn(0f, 1f)
        val env = sin(p * PI).toFloat() * tw.mag * lerpF(1f, 0.55f, calm)
        when (tw.kind) {
            0 -> out[0] = env * 0.0095f * tw.dir
            1 -> out[1] = env * 0.014f * tw.dir
            2 -> out[2] = env * 0.014f * tw.dir
            else -> out[3] = env * 1.6f * tw.dir
        }
        return out
    }
}

/* ------------------------------------------------------------------ draw -- */

/**
 * @param cx,cy centre of the sprite in px
 * @param scale px per reference unit
 */
fun DrawScope.drawClawd(st: ClawdState, now: Float, cx: Float, cy: Float, scale: Float, alpha: Float) {
    if (alpha <= 0.004f) return
    val calm = st.calm
    val motion = if (st.reducedMotion) 0f else lerpF(1f, 0.55f, calm)

    val bp = lerpF(4.2f, 6.9f, calm)
    val br = breath(now / bp)
    val bob = if (st.reducedMotion) 0f else sin(now / 11.3f * 2 * PI).toFloat() * 4f * motion
    val sway = if (st.reducedMotion) 0f else sin(now / 17.9f * 2 * PI + 1.1).toFloat() * 1.7f * motion

    val tw = st.twitchOf(now)
    val tilt = tw[0] + calm * 0.0095f * 0.55f

    val fill = lerp(Ink.ClawdCoral, Ink.ClawdAsleep, calm).copy(alpha = alpha)
    val eyeCol = Ink.ClawdEye.copy(alpha = alpha)

    translate(cx - ClawdArt.W / 2 * scale + sway * scale, cy - ClawdArt.H / 2 * scale + bob * scale) {
        scale(scale, scale, pivot = Offset.Zero) {
            translate(tw[3], 0f) {
                // legs stay planted; only the rig's own drift moves them
                drawPath(ClawdArt.legs, fill)

                // everything above the legs shares the breathing transform,
                // pivoted on the torso's bottom edge so the feet do not lift
                rotate(Math.toDegrees(tilt.toDouble()).toFloat(),
                    Offset(ClawdArt.W / 2, ClawdArt.TORSO_BOTTOM)) {
                    val sy = 1f + br * 0.018f * lerpF(1f, 0.62f, calm)
                    val sx = 1f - br * 0.006f * lerpF(1f, 0.62f, calm)
                    scale(sx, sy, Offset(ClawdArt.W / 2, ClawdArt.TORSO_BOTTOM)) {
                        drawPath(ClawdArt.body, fill)
                        rotate(Math.toDegrees(tw[1].toDouble()).toFloat(),
                            Offset(ClawdArt.W / 2, ClawdArt.SHOULDER_Y)) { drawPath(ClawdArt.armL, fill) }
                        rotate(Math.toDegrees(tw[2].toDouble()).toFloat(),
                            Offset(ClawdArt.W / 2, ClawdArt.SHOULDER_Y)) { drawPath(ClawdArt.armR, fill) }

                        val open = st.lidOpenness(now)
                        for (e in ClawdArt.eyeBoxes) {
                            // Collapse toward a line a little below centre — where a
                            // shut pixel eye actually sits.
                            val pivotY = e[1] + e[3] * 0.66f
                            val h = maxOf(e[3] * open, e[3] * 0.2f)
                            drawRect(eyeCol, Offset(e[0], pivotY - h * 0.66f),
                                androidx.compose.ui.geometry.Size(e[2], h))
                        }
                    }
                }

                for (p in st.particles) {
                    val age = (now - p.born) / p.life
                    if (age < 0f || age > 1f) continue
                    val a = when {
                        age < 0.18f -> smooth(age / 0.18f)
                        age > 0.55f -> 1f - smooth((age - 0.55f) / 0.45f)
                        else -> 1f
                    }
                    val s = p.size * lerpF(0.7f, 1.25f, age)
                    val wob = sin(now / p.wobT * 2 * PI).toFloat() * p.wob * age
                    translate(ClawdArt.W * 0.72f + p.dx + wob, 22f - age * 74f) {
                        scale(s, s, Offset.Zero) {
                            drawPath(ClawdArt.zGlyph, Ink.ClawdCoral.copy(alpha = a * 0.5f * alpha))
                        }
                    }
                }
            }
        }
    }
}
