package com.veergames.veer.ui

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.view.MotionEvent
import kotlin.math.max
import kotlin.math.min

/**
 * 2.6s opening animation:
 *  0.00 fade up from deep navy
 *  0.25 a glowing arrow streaks in, turning 90 degrees several times
 *  0.95 companion paths flicker in around it
 *  1.35 paths converge into the logo mark, which draws on
 *  1.85 logo pulse
 *  2.05 wordmark fades in
 *  2.60 hand off to the menu
 * Tapping skips straight to the end.
 */
@SuppressLint("ViewConstructor")
class SplashView(context: Context, private val onDone: () -> Unit) : BaseView(context) {

    private var t = 0f
    private var finished = false
    private val total = 2.62f

    private val heroPts = FloatArray(12)   // 6 points of the hero path (in unit space)
    private val companions = ArrayList<FloatArray>()
    private val path = Path()

    init {
        // Hero route in unit space (0..1 of the short side), several 90-degree turns
        val route = floatArrayOf(
            -0.62f, 0.34f,
            -0.18f, 0.34f,
            -0.18f, -0.10f,
            0.16f, -0.10f,
            0.16f, 0.20f,
            0.52f, 0.20f,
        )
        System.arraycopy(route, 0, heroPts, 0, route.size)
        companions.add(floatArrayOf(-0.50f, -0.28f, -0.50f, -0.52f, 0.02f, -0.52f))
        companions.add(floatArrayOf(0.48f, -0.34f, 0.10f, -0.34f, 0.10f, -0.58f))
        companions.add(floatArrayOf(-0.44f, 0.60f, 0.06f, 0.60f, 0.06f, 0.42f))
        companions.add(floatArrayOf(0.46f, 0.56f, 0.46f, 0.34f, 0.24f, 0.34f))
        startAnim()
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (event.actionMasked == MotionEvent.ACTION_DOWN && t < total - 0.35f) {
            t = max(t, total - 0.35f)
            startAnim()
        }
        return true
    }

    override fun step(dt: Float): Boolean {
        t += dt
        if (t >= total && !finished) {
            finished = true
            post { onDone() }
            return false
        }
        return true
    }

    override fun drawBackground(c: Canvas) {
        // resolve from deep navy into whatever the equipped skin's board is
        val k = ((t - 1.15f) / 0.75f).coerceIn(0f, 1f)
        val top = Palette.lerpColor(0xFF0B1230.toInt(), Palette.BG_TOP, Ease.inOut(k))
        val bot = Palette.lerpColor(0xFF141C3E.toInt(), Palette.BG_BOTTOM, Ease.inOut(k))
        paint.reset(); paint.isAntiAlias = true
        paint.shader = android.graphics.LinearGradient(0f, 0f, 0f, height.toFloat(),
            top, bot, android.graphics.Shader.TileMode.CLAMP)
        c.drawRect(0f, 0f, width.toFloat(), height.toFloat(), paint)
        paint.shader = null
    }

    override fun render(c: Canvas) {
        val cx = width / 2f
        val cy = height * 0.46f
        val unit = min(width, height) * 0.92f
        val fadeIn = (t / 0.28f).coerceIn(0f, 1f)

        // --- hero streak ---
        val heroT = ((t - 0.22f) / 1.05f).coerceIn(0f, 1f)
        if (heroT > 0f && t < 1.62f) {
            val dissolve = ((t - 1.30f) / 0.30f).coerceIn(0f, 1f)
            drawStreak(c, cx, cy, unit, heroPts, Ease.inOut(heroT),
                alpha = (255 * (1f - dissolve) * fadeIn).toInt(), width = unit * 0.026f,
                headOn = true)
        }

        // --- board lattice resolving in behind the mark ---
        val latticeT = ((t - 1.5f) / 0.7f).coerceIn(0f, 1f)
        if (latticeT > 0f) {
            val step = unit * 0.13f
            val p = fillPaint(Palette.withAlpha(Palette.DOT, (latticeT * 210).toInt()))
            var gx = cx - step * 3
            while (gx <= cx + step * 3) {
                var gy = cy - step * 3
                while (gy <= cy + step * 3) {
                    c.drawCircle(gx, gy, unit * 0.006f * latticeT, p)
                    gy += step
                }
                gx += step
            }
        }

        // --- companion paths ---
        for ((i, cp) in companions.withIndex()) {
            val start = 0.86f + i * 0.07f
            val p = ((t - start) / 0.42f).coerceIn(0f, 1f)
            if (p <= 0f) continue
            val dissolve = ((t - 1.34f) / 0.28f).coerceIn(0f, 1f)
            val a = (170 * p * (1f - dissolve)).toInt()
            if (a <= 0) continue
            drawStreak(c, cx, cy, unit, cp, p, a, unit * 0.017f, headOn = false)
        }

        // --- logo assembly ---
        val logoT = ((t - 1.34f) / 0.46f).coerceIn(0f, 1f)
        if (logoT > 0f) {
            val pulse = if (t > 1.86f) {
                val q = ((t - 1.86f) / 0.42f).coerceIn(0f, 1f)
                1f + 0.085f * kotlin.math.sin(q * Math.PI.toFloat()) * (1f - q * 0.25f)
            } else 1f
            val size = unit * 0.30f * pulse
            val glow = (1f - ((t - 1.9f) / 0.7f).coerceIn(0f, 1f)) * 0.9f + 0.1f
            LogoMark.draw(c, cx, cy - unit * 0.02f, size,
                alpha = (255 * min(1f, logoT * 1.6f)).toInt(),
                progress = Ease.outCubic(logoT), glow = glow)
        }

        // --- wordmark ---
        val wordT = ((t - 2.02f) / 0.34f).coerceIn(0f, 1f)
        if (wordT > 0f) {
            val a = (255 * Ease.outCubic(wordT)).toInt()
            val rise = (1f - Ease.outCubic(wordT)) * dp(10f)
            drawText(c, "VEERPATH", cx, cy + unit * 0.26f + rise, dp(34f),
                Palette.withAlpha(Palette.TEXT, a), Fonts.black, letterSpacing = 0.22f)
            drawText(c, "ESCAPE THE GRIDLOCK", cx, cy + unit * 0.315f + rise, dp(11.5f),
                Palette.withAlpha(Palette.TEXT_DIM, (a * 0.85f).toInt()), Fonts.bold,
                letterSpacing = 0.34f)
        }
    }

    /**
     * Draw a polyline (unit-space coords) revealed to fraction [progress],
     * with a bright leading head and a soft glow tail.
     */
    private fun drawStreak(c: Canvas, cx: Float, cy: Float, unit: Float, pts: FloatArray,
                           progress: Float, alpha: Int, width: Float, headOn: Boolean) {
        if (alpha <= 0) return
        path.rewind()
        val n = pts.size / 2
        val xs = FloatArray(n); val ys = FloatArray(n)
        for (i in 0 until n) {
            xs[i] = cx + pts[i * 2] * unit
            ys[i] = cy + pts[i * 2 + 1] * unit
        }
        path.moveTo(xs[0], ys[0])
        for (i in 1 until n) path.lineTo(xs[i], ys[i])
        val measure = android.graphics.PathMeasure(path, false)
        val len = measure.length
        val shown = Path()
        // comet: keep a trailing window rather than the whole path
        val head = len * progress
        val tail = max(0f, head - len * (if (headOn) 0.55f else 0.85f))
        measure.getSegment(tail, head, shown, true)

        paint.reset(); paint.isAntiAlias = true
        paint.style = Paint.Style.STROKE
        paint.strokeCap = Paint.Cap.ROUND
        paint.strokeJoin = Paint.Join.ROUND
        paint.pathEffect = android.graphics.CornerPathEffect(unit * 0.035f)
        // glow layers
        for (i in 3 downTo 1) {
            paint.strokeWidth = width * (1f + i * 0.85f)
            paint.color = Palette.withAlpha(Palette.ACCENT, (alpha * 0.09f).toInt())
            c.drawPath(shown, paint)
        }
        paint.strokeWidth = width
        paint.color = Palette.withAlpha(
            if (headOn) 0xFF7FE7FF.toInt() else Palette.ACCENT2, alpha)
        c.drawPath(shown, paint)
        paint.pathEffect = null

        if (headOn && progress < 1f) {
            val pos = FloatArray(2); val tan = FloatArray(2)
            measure.getPosTan(head, pos, tan)
            paint.style = Paint.Style.FILL
            paint.color = Palette.withAlpha(0xFFFFFFFF.toInt(), alpha)
            c.drawCircle(pos[0], pos[1], width * 0.85f, paint)
            paint.color = Palette.withAlpha(Palette.ACCENT, (alpha * 0.5f).toInt())
            c.drawCircle(pos[0], pos[1], width * 1.9f, paint)
        }
    }
}
