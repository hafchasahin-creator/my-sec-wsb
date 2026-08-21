package com.imran.recorder.ui.intro

import android.app.ActivityManager
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.SweepGradient
import android.provider.Settings
import android.util.AttributeSet
import android.view.Choreographer
import android.view.View
import com.imran.recorder.R
import com.imran.recorder.ui.intro.IntroTimeline.T_DRIFT_END
import com.imran.recorder.ui.intro.IntroTimeline.T_TRAVEL_END
import com.imran.recorder.ui.intro.IntroTimeline.T_RING_IN
import com.imran.recorder.ui.intro.IntroTimeline.T_ASSEMBLE_IN
import com.imran.recorder.ui.intro.IntroTimeline.T_ASSEMBLE_OUT
import com.imran.recorder.ui.intro.IntroTimeline.T_WORD_IN
import com.imran.recorder.ui.intro.IntroTimeline.T_SUB_IN
import com.imran.recorder.ui.intro.IntroTimeline.T_PULSE
import com.imran.recorder.ui.intro.IntroTimeline.T_PORTAL
import com.imran.recorder.ui.intro.IntroTimeline.T_END
import com.imran.recorder.ui.intro.IntroTimeline.STARS_FULL
import com.imran.recorder.ui.intro.IntroTimeline.STARS_LITE
import com.imran.recorder.ui.intro.IntroTimeline.PARTICLES_FULL
import com.imran.recorder.ui.intro.IntroTimeline.PARTICLES_LITE
import com.imran.recorder.ui.intro.IntroTimeline.easeIn
import com.imran.recorder.ui.intro.IntroTimeline.easeInOut
import com.imran.recorder.ui.intro.IntroTimeline.easeOut
import com.imran.recorder.ui.intro.IntroTimeline.portalProgress
import com.imran.recorder.ui.intro.IntroTimeline.skipTime
import com.imran.recorder.ui.intro.IntroTimeline.smooth
import com.imran.recorder.ui.intro.IntroTimeline.speedAt
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.random.Random

/**
 * The launch sequence, rendered natively on a hardware-accelerated Canvas.
 *
 * Stars are a real 3-D field: each has an (x, y, z) and is projected through a focal
 * length, so depth, parallax and the streaking under acceleration all fall out of the
 * projection rather than being faked with separate layers. The logo assembles from
 * particles sampled out of the app's own mark, so the branding is never duplicated.
 *
 * Everything is batched — stars into three brightness tiers drawn with drawLines, logo
 * particles into colour buckets drawn with drawPoints — so a frame is a handful of draw
 * calls regardless of particle count.
 */
class CosmicIntroView @JvmOverloads constructor(
    context: Context, attrs: AttributeSet? = null
) : View(context, attrs) {

    /** Fired once on the UI thread when the sequence is over. */
    var onFinished: (() -> Unit)? = null

    /** Progress of the final dive, 0..1 — the host uses it to reveal the UI underneath. */
    var onPortalProgress: ((Float) -> Unit)? = null

    // ---------------- state ----------------
    private var startNanos = 0L
    private var lastFrameNanos = 0L
    private var running = false
    private var finished = false
    private var skipFrom = -1f          // time at which a tap asked to cut it short

    private val random = Random(7)
    private val lite: Boolean = run {
        val am = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
        am?.isLowRamDevice == true
    }

    private var frameDelta = 1f / 60f
    private var cx = 0f
    private var cy = 0f
    private var focal = 0f
    private var unit = 0f               // shortest edge, for resolution-independent sizing

    // ---------------- stars ----------------
    private val starCount = if (lite) STARS_LITE else STARS_FULL
    private val sx = FloatArray(starCount)
    private val sy = FloatArray(starCount)
    private val sz = FloatArray(starCount)
    private val sTier = IntArray(starCount)
    private val sPrevX = FloatArray(starCount)
    private val sPrevY = FloatArray(starCount)
    private val sHasPrev = BooleanArray(starCount)

    // three brightness tiers, each batched into one drawLines call
    private val tierLines = Array(3) { FloatArray(starCount * 4) }
    private val tierCount = IntArray(3)
    private val tierPaint = Array(3) {
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeCap = Paint.Cap.ROUND
        }
    }

    // ---------------- logo particles ----------------
    private var pTargetX = FloatArray(0)
    private var pTargetY = FloatArray(0)
    private var pFromX = FloatArray(0)
    private var pFromY = FloatArray(0)
    private var pDelay = FloatArray(0)
    private var pBucket = IntArray(0)
    private var pPushX = FloatArray(0)
    private var pPushY = FloatArray(0)
    private var particleCount = 0

    private val bucketPts = Array(3) { FloatArray(0) }
    private val bucketCount = IntArray(3)
    private val bucketPaint = arrayOf(
        Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE },
        Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#FFB35A") },
        Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#FF4D1F") }
    )

    private var logoBitmap: Bitmap? = null
    private val logoSrc = Rect()
    private val logoDst = RectF()
    private val logoPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)

    // ---------------- nebula ----------------
    private var nebula: Bitmap? = null
    private val nebulaPaint = Paint(Paint.FILTER_BITMAP_FLAG).apply { isAntiAlias = true }
    private val nebulaDst = RectF()

    // ---------------- ring / glow ----------------
    private val ringPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val glowPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val arcRect = RectF()
    private val flashPaint = Paint()

    // ---------------- text ----------------
    private val titlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        typeface = android.graphics.Typeface.create(
            android.graphics.Typeface.SANS_SERIF, android.graphics.Typeface.BOLD
        )
        textAlign = Paint.Align.CENTER
    }
    private val subPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#FFC46A")
        typeface = android.graphics.Typeface.create(
            android.graphics.Typeface.SANS_SERIF, android.graphics.Typeface.BOLD
        )
        textAlign = Paint.Align.CENTER
    }

    private val frameCallback = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
            if (!running) return
            // Backgrounding the app mid-sequence stops onDraw but not the clock, so the
            // loop would post frames forever. Retire it instead of burning cycles.
            if (!finished && !isShown && elapsed() > T_END) {
                finish()
                return
            }
            invalidate()
            Choreographer.getInstance().postFrameCallback(this)
        }
    }

    init {
        // Deliberately no background and no hardware layer: onDraw paints its own black
        // and fades it out for the portal, and the whole surface is repainted every frame
        // so an offscreen layer would only add a full-screen copy per frame.
        seedStars()
    }

    /** True when the platform says animations are off — the host skips straight to the app. */
    fun animationsDisabled(): Boolean = runCatching {
        Settings.Global.getFloat(
            context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f
        ) == 0f
    }.getOrDefault(false)

    fun start() {
        lastFrameNanos = 0L
        if (running || finished) return
        running = true
        startNanos = System.nanoTime()
        Choreographer.getInstance().postFrameCallback(frameCallback)
    }

    fun stop() {
        running = false
        Choreographer.getInstance().removeFrameCallback(frameCallback)
    }

    /** A tap cuts to the end rather than hard-stopping, so the reveal still plays. */
    fun skip() {
        if (finished || skipFrom >= 0f) return
        skipFrom = elapsed()
    }

    private fun elapsed(): Float = (System.nanoTime() - startNanos) / 1_000_000_000f

    // ---------------- setup ----------------

    private fun seedStars() {
        for (i in 0 until starCount) {
            respawn(i, initial = true)
            sTier[i] = when {
                random.nextFloat() < 0.10f -> 2   // a few genuinely bright ones
                random.nextFloat() < 0.40f -> 1
                else -> 0                          // most are tiny and dim
            }
        }
    }

    private fun respawn(i: Int, initial: Boolean) {
        sx[i] = (random.nextFloat() * 2f - 1f) * 1.35f
        sy[i] = (random.nextFloat() * 2f - 1f) * 1.35f
        sz[i] = if (initial) random.nextFloat() * 0.95f + 0.05f else 1f
        sHasPrev[i] = false
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        if (w == 0 || h == 0) return
        cx = w / 2f
        cy = h / 2f
        unit = min(w, h).toFloat()
        // Focal length scales with the diagonal so the field reads the same on any aspect.
        focal = hypot(w.toFloat(), h.toFloat()) * 0.42f

        titlePaint.textSize = unit * 0.115f
        titlePaint.letterSpacing = 0.10f
        subPaint.textSize = unit * 0.046f
        subPaint.letterSpacing = 0.42f

        buildNebula(w, h)
        buildLogoParticles()
    }

    /**
     * The haze is static, so it is rasterised once at a fraction of the resolution and
     * drawn scaled — three full-screen gradients per frame would not be worth the cost.
     */
    private fun buildNebula(w: Int, h: Int) {
        nebula?.recycle()
        nebula = null
        if (lite) return

        val nw = max(1, w / 6)
        val nh = max(1, h / 6)
        val bmp = Bitmap.createBitmap(nw, nh, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val p = Paint(Paint.ANTI_ALIAS_FLAG)

        data class Cloud(val fx: Float, val fy: Float, val r: Float, val color: Int)
        val clouds = listOf(
            Cloud(0.26f, 0.30f, 0.62f, Color.argb(96, 40, 58, 140)),    // cool blue
            Cloud(0.78f, 0.24f, 0.50f, Color.argb(78, 92, 42, 138)),    // violet
            Cloud(0.58f, 0.74f, 0.66f, Color.argb(70, 150, 52, 20)),    // warm ember
            Cloud(0.14f, 0.82f, 0.44f, Color.argb(54, 30, 44, 110))
        )
        for (cl in clouds) {
            val r = cl.r * min(nw, nh)
            p.shader = RadialGradient(
                cl.fx * nw, cl.fy * nh, r,
                intArrayOf(cl.color, Color.TRANSPARENT),
                floatArrayOf(0f, 1f), Shader.TileMode.CLAMP
            )
            c.drawCircle(cl.fx * nw, cl.fy * nh, r, p)
        }
        p.shader = null
        nebula = bmp
    }

    /**
     * Samples the app's own mark and turns its opaque pixels into particle targets, so
     * the logo genuinely assembles out of light fragments instead of cross-fading in.
     */
    private fun buildLogoParticles() {
        val target = if (lite) PARTICLES_LITE else PARTICLES_FULL
        val logoW = unit * 0.42f

        // A density-independent copy of the mark, large enough that the moment it resolves
        // is still crisp on a tall 1440p panel. inScaled = false keeps it at its own size.
        val opts = BitmapFactory.Options().apply { inScaled = false }
        val src = runCatching {
            BitmapFactory.decodeResource(resources, R.drawable.logo_mark_hi, opts)
        }.recoverCatching {
            BitmapFactory.decodeResource(resources, R.drawable.logo_mark, opts)
        }.getOrNull() ?: return

        val scale = logoW / src.width
        val logoH = src.height * scale
        logoBitmap = src
        logoSrc.set(0, 0, src.width, src.height)
        logoDst.set(cx - logoW / 2f, cy - logoH / 2f, cx + logoW / 2f, cy + logoH / 2f)

        // Walk the bitmap on a stride chosen to land near the requested particle count.
        val opaque = ArrayList<Int>(target * 2)
        val stride = max(1, kotlin.math.sqrt((src.width * src.height).toFloat() / (target * 3f)).toInt())
        var y = 0
        while (y < src.height) {
            var x = 0
            while (x < src.width) {
                val px = src.getPixel(x, y)
                if (Color.alpha(px) > 140) opaque += (y shl 16) or x
                x += stride
            }
            y += stride
        }
        if (opaque.isEmpty()) return

        val n = min(target, opaque.size)
        pTargetX = FloatArray(n); pTargetY = FloatArray(n)
        pFromX = FloatArray(n); pFromY = FloatArray(n)
        pDelay = FloatArray(n); pBucket = IntArray(n)
        pPushX = FloatArray(n); pPushY = FloatArray(n)
        particleCount = n

        val step = opaque.size.toFloat() / n
        val spawnR = unit * 0.95f
        for (i in 0 until n) {
            val packed = opaque[(i * step).toInt().coerceAtMost(opaque.lastIndex)]
            val px = packed and 0xFFFF
            val py = (packed shr 16) and 0xFFFF

            pTargetX[i] = logoDst.left + px * scale
            pTargetY[i] = logoDst.top + py * scale

            val a = random.nextFloat() * (2 * PI).toFloat()
            val d = spawnR * (0.55f + random.nextFloat() * 0.75f)
            pFromX[i] = cx + cos(a) * d
            pFromY[i] = cy + sin(a) * d
            pDelay[i] = random.nextFloat() * 0.22f

            val c = src.getPixel(px, py)
            val r = Color.red(c); val g = Color.green(c); val b = Color.blue(c)
            pBucket[i] = when {
                r > 200 && g > 190 && b > 180 -> 0            // white body
                r > 190 && g in 90..200 -> 1                  // amber accents
                else -> 2                                     // the red record dot
            }
        }
        for (k in 0..2) bucketPts[k] = FloatArray(n * 2)
    }

    // ---------------- frame ----------------

    override fun onDraw(canvas: Canvas) {
        // A launch animation is never worth taking the app down for. If a frame fails,
        // retire the sequence and let the host reveal the UI it was covering.
        try {
            drawFrame(canvas)
        } catch (t: Throwable) {
            finish()
        }
    }

    private fun drawFrame(canvas: Canvas) {
        val now = System.nanoTime()
        // Clamped so a dropped frame cannot teleport the field, and so a 120 Hz panel
        // advances the same distance per second as a 60 Hz one.
        frameDelta = if (lastFrameNanos == 0L) 1f / 60f
        else ((now - lastFrameNanos) / 1_000_000_000f).coerceIn(1f / 240f, 1f / 30f)
        lastFrameNanos = now

        val raw = elapsed()
        // A tap compresses whatever is left into a short outro rather than cutting hard.
        val t = skipTime(raw, skipFrom)

        // Through the dive the backdrop itself opens up: the black and the field fall away
        // so the real home screen behind this view is what the portal reveals.
        val open = if (t >= T_PORTAL) smooth(0.30f, 0.94f, portalProgress(t)) else 0f
        val veil = 1f - open
        canvas.drawColor(Color.argb((veil * 255f).toInt().coerceIn(0, 255), 0, 0, 0))

        val fade = smooth(0f, T_DRIFT_END, t) * veil
        drawNebula(canvas, t, fade)
        stepAndDrawStars(canvas, t, veil)

        if (t >= T_RING_IN) drawRing(canvas, t)
        if (t >= T_ASSEMBLE_IN) drawLogo(canvas, t)
        if (t >= T_WORD_IN) drawWordmark(canvas, t)

        if (t >= T_PORTAL) {
            val u = portalProgress(t)
            onPortalProgress?.invoke(u)
            drawPortalFlash(canvas, u)
        }

        if (t >= T_END) finish()
    }

    /** Ends the sequence exactly once, from whichever path gets there first. */
    private fun finish() {
        if (finished) return
        finished = true
        stop()
        onPortalProgress?.invoke(1f)
        onFinished?.invoke()
    }

    private fun stepAndDrawStars(canvas: Canvas, t: Float, veil: Float) {
        val v = speedAt(t) * frameDelta
        val appear = smooth(0f, T_DRIFT_END, t) * veil
        if (appear <= 0.004f) return

        tierCount.fill(0)

        for (i in 0 until starCount) {
            sz[i] -= v
            if (sz[i] <= 0.035f) {
                respawn(i, initial = false)
                continue
            }

            val px = cx + sx[i] / sz[i] * focal
            val py = cy + sy[i] / sz[i] * focal

            if (px < -220f || px > width + 220f || py < -220f || py > height + 220f) {
                respawn(i, initial = false)
                continue
            }

            val tier = sTier[i]
            if (sHasPrev[i]) {
                val idx = tierCount[tier] * 4
                val arr = tierLines[tier]
                arr[idx] = sPrevX[i]; arr[idx + 1] = sPrevY[i]
                arr[idx + 2] = px;    arr[idx + 3] = py
                tierCount[tier]++
            }
            sPrevX[i] = px; sPrevY[i] = py; sHasPrev[i] = true
        }

        val depthBoost = 1f
        for (tier in 0..2) {
            val n = tierCount[tier]
            if (n == 0) continue
            val p = tierPaint[tier]
            // Nearer tiers are drawn thicker and brighter, which is what sells the depth.
            p.strokeWidth = when (tier) {
                2 -> unit * 0.0042f
                1 -> unit * 0.0028f
                else -> unit * 0.0018f
            } * depthBoost
            val base = when (tier) {
                2 -> 255
                1 -> 200
                else -> 140
            }
            p.color = Color.argb((base * appear).toInt().coerceIn(0, 255), 255, 252, 245)
            canvas.drawLines(tierLines[tier], 0, n * 4, p)
        }
    }

    private fun drawNebula(canvas: Canvas, t: Float, fade: Float) {
        val bmp = nebula ?: return
        // Creeps outward as the camera moves, which keeps it from reading as a flat backdrop.
        val grow = 1f + smooth(0f, T_END, t) * 0.22f
        val w = width * grow
        val h = height * grow
        nebulaDst.set((width - w) / 2f, (height - h) / 2f, (width + w) / 2f, (height + h) / 2f)
        nebulaPaint.alpha = (fade * 190).toInt().coerceIn(0, 255)
        canvas.drawBitmap(bmp, null, nebulaDst, nebulaPaint)
    }

    private fun drawRing(canvas: Canvas, t: Float) {
        val born = smooth(T_RING_IN, T_RING_IN + 0.34f, t)
        val baseR = unit * 0.245f
        var r = baseR * (0.04f + easeOut(born) * 0.96f)
        var alpha = born

        if (t >= T_PORTAL) {
            // The ring becomes the portal: it races past the edges of the display.
            val u = easeIn(smooth(T_PORTAL, T_END, t))
            r = baseR * (1f + u * 9.5f)
            alpha = 1f - smooth(0.72f, 1f, u)
        }

        // core glow
        glowPaint.shader = RadialGradient(
            cx, cy, r * 1.5f,
            intArrayOf(
                Color.argb((150 * alpha).toInt().coerceIn(0, 255), 255, 120, 40),
                Color.argb((40 * alpha).toInt().coerceIn(0, 255), 255, 70, 20),
                Color.TRANSPARENT
            ),
            floatArrayOf(0f, 0.45f, 1f), Shader.TileMode.CLAMP
        )
        canvas.drawCircle(cx, cy, r * 1.5f, glowPaint)
        glowPaint.shader = null

        // the ring itself, with energy travelling around it
        val sweepRotation = t * 200f
        canvas.save()
        canvas.rotate(sweepRotation, cx, cy)
        ringPaint.strokeWidth = unit * (if (t >= T_PORTAL) 0.028f else 0.011f)
        ringPaint.shader = SweepGradient(
            cx, cy,
            intArrayOf(
                Color.argb((30 * alpha).toInt().coerceIn(0, 255), 255, 90, 30),
                Color.argb((255 * alpha).toInt().coerceIn(0, 255), 255, 190, 110),
                Color.argb((255 * alpha).toInt().coerceIn(0, 255), 255, 90, 25),
                Color.argb((30 * alpha).toInt().coerceIn(0, 255), 255, 90, 30)
            ),
            floatArrayOf(0f, 0.22f, 0.5f, 1f)
        )
        canvas.drawCircle(cx, cy, r, ringPaint)
        canvas.restore()
        ringPaint.shader = null

        // bright head racing around the ring
        if (t < T_PORTAL) {
            arcRect.set(cx - r, cy - r, cx + r, cy + r)
            ringPaint.color = Color.argb((235 * alpha).toInt().coerceIn(0, 255), 255, 226, 190)
            ringPaint.strokeCap = Paint.Cap.ROUND
            canvas.drawArc(arcRect, sweepRotation % 360f, 26f, false, ringPaint)
        }

        // shockwave from the logo's single pulse
        if (t in T_PULSE..(T_PULSE + 0.5f)) {
            val u = smooth(T_PULSE, T_PULSE + 0.5f, t)
            ringPaint.shader = null
            ringPaint.strokeWidth = unit * 0.005f * (1f - u)
            ringPaint.color = Color.argb(((1f - u) * 170).toInt().coerceIn(0, 255), 255, 170, 110)
            canvas.drawCircle(cx, cy, baseR * (1f + u * 1.5f), ringPaint)
        }
    }

    private fun drawLogo(canvas: Canvas, t: Float) {
        if (particleCount == 0) return

        val assemble = smooth(T_ASSEMBLE_IN, T_ASSEMBLE_OUT, t)
        val solid = smooth(T_ASSEMBLE_OUT - 0.12f, T_ASSEMBLE_OUT + 0.16f, t)

        // Portal dive scales the whole mark up and past the camera.
        var scale = 1f
        var logoAlpha = 1f
        if (t >= T_PORTAL) {
            val u = easeIn(smooth(T_PORTAL, T_END, t))
            scale = 1f + u * 7.5f
            logoAlpha = 1f - smooth(0.35f, 0.9f, u)
        }

        // pulse push
        var push = 0f
        if (t >= T_PULSE) push = (1f - smooth(T_PULSE, T_PULSE + 0.45f, t)) * unit * 0.035f

        if (solid < 1f) {
            bucketCount.fill(0)
            for (i in 0 until particleCount) {
                val local = ((assemble - pDelay[i]) / (1f - pDelay[i])).coerceIn(0f, 1f)
                val e = easeOut(local)
                var x = pFromX[i] + (pTargetX[i] - pFromX[i]) * e
                var y = pFromY[i] + (pTargetY[i] - pFromY[i]) * e
                if (push > 0f) {
                    val dx = x - cx; val dy = y - cy
                    val d = max(1f, hypot(dx, dy))
                    x += dx / d * push
                    y += dy / d * push
                }
                val b = pBucket[i]
                val idx = bucketCount[b] * 2
                bucketPts[b][idx] = cx + (x - cx) * scale
                bucketPts[b][idx + 1] = cy + (y - cy) * scale
                bucketCount[b]++
            }
            val a = ((1f - solid) * logoAlpha * 255).toInt().coerceIn(0, 255)
            for (k in 0..2) {
                val n = bucketCount[k]
                if (n == 0) continue
                val p = bucketPaint[k]
                p.strokeWidth = unit * 0.0055f * scale.coerceAtMost(3f)
                p.strokeCap = Paint.Cap.ROUND
                p.alpha = a
                canvas.drawPoints(bucketPts[k], 0, n * 2, p)
            }
        }

        // crisp mark fades in over the particles so the final logo is never mushy
        val bmp = logoBitmap
        if (bmp != null && solid > 0f) {
            logoPaint.alpha = (solid * logoAlpha * 255).toInt().coerceIn(0, 255)
            canvas.save()
            canvas.scale(scale, scale, cx, cy)
            canvas.drawBitmap(bmp, logoSrc, logoDst, logoPaint)
            canvas.restore()
        }
    }

    private fun drawWordmark(canvas: Canvas, t: Float) {
        val titleIn = smooth(T_WORD_IN, T_WORD_IN + 0.34f, t)
        val subIn = smooth(T_SUB_IN, T_SUB_IN + 0.34f, t)

        var drift = 0f
        var alpha = 1f
        if (t >= T_PORTAL) {
            val u = easeIn(smooth(T_PORTAL, T_END, t))
            drift = u * unit * 0.55f
            alpha = 1f - smooth(0.15f, 0.65f, u)
        }

        val baseY = cy + logoDst.height() * 0.72f + unit * 0.055f
        val rise = (1f - easeOut(titleIn)) * unit * 0.035f

        titlePaint.alpha = (titleIn * alpha * 255).toInt().coerceIn(0, 255)
        canvas.drawText("IMRAN", cx, baseY + rise + drift, titlePaint)

        val subRise = (1f - easeOut(subIn)) * unit * 0.028f
        subPaint.alpha = (subIn * alpha * 235).toInt().coerceIn(0, 255)
        canvas.drawText(
            "RECORDER", cx, baseY + unit * 0.072f + subRise + drift * 1.15f, subPaint
        )
    }

    /** A brief warm bloom at the moment the camera passes through the ring. */
    private fun drawPortalFlash(canvas: Canvas, u: Float) {
        if (u < 0.55f) return
        val f = smooth(0.55f, 0.86f, u) * (1f - smooth(0.86f, 1f, u))
        flashPaint.color = Color.argb((f * 165).toInt().coerceIn(0, 255), 255, 172, 96)
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), flashPaint)
    }

    /**
     * Frees the rasters once the sequence is over. The view stays in the hierarchy for the
     * activity's life but never replays, so there is no reason to keep several megabytes
     * of star haze and logo bitmap resident behind the home screen.
     */
    fun release() {
        stop()
        nebula?.recycle(); nebula = null
        logoBitmap?.recycle(); logoBitmap = null
        particleCount = 0
    }

    override fun onDetachedFromWindow() {
        release()
        super.onDetachedFromWindow()
    }
}
