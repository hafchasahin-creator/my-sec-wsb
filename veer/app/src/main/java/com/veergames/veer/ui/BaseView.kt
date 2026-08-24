package com.veergames.veer.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.view.View
import com.veergames.veer.MainActivity

/**
 * Frame-timed custom view: [step] advances animation by dt seconds and
 * returns true while more frames are needed; [render] paints.
 */
abstract class BaseView(context: Context) : View(context) {

    protected val act: MainActivity get() = context as MainActivity
    private var lastFrameNs = 0L
    private var running = false

    protected val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private var bgShader: Shader? = null
    private var bgW = 0
    private var bgH = 0
    private var bgSkinVersion = -1

    /** Safe-area insets in px, filled on layout. */
    protected var insetTop = 0f
    protected var insetBottom = 0f

    /**
     * Screens with slow ambient motion set this: when [step] reports nothing
     * urgent, the view keeps ticking at ~30 Hz instead of stopping. Halves
     * the cost of a menu the player is just looking at, without freezing the
     * background drift.
     */
    protected var ambient = false
    private var pendingTick = false

    init {
        isClickable = true
        isFocusable = true
    }

    override fun onApplyWindowInsets(insets: android.view.WindowInsets): android.view.WindowInsets {
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            val bars = insets.getInsets(
                android.view.WindowInsets.Type.systemBars() or
                    android.view.WindowInsets.Type.displayCutout())
            insetTop = bars.top.toFloat()
            insetBottom = bars.bottom.toFloat()
        } else {
            @Suppress("DEPRECATION")
            insetTop = insets.systemWindowInsetTop.toFloat()
            @Suppress("DEPRECATION")
            insetBottom = insets.systemWindowInsetBottom.toFloat()
        }
        // insets can arrive after the first size pass, and the size may not
        // change - re-run our own layout explicitly so cutouts are respected
        if (width > 0 && height > 0) onSizeChanged(width, height, width, height)
        startAnim()
        return insets
    }

    protected fun startAnim() {
        if (!running) {
            running = true
            lastFrameNs = 0L
            postInvalidateOnAnimation()
        }
    }

    abstract fun step(dt: Float): Boolean
    abstract fun render(c: Canvas)

    override fun onDraw(canvas: Canvas) {
        val now = System.nanoTime()
        val dt = if (lastFrameNs == 0L) 1f / 60f
        else ((now - lastFrameNs) / 1_000_000_000.0).toFloat().coerceIn(0f, 0.05f)
        lastFrameNs = now
        val more = step(dt)
        drawBackground(canvas)
        render(canvas)
        when {
            more -> postInvalidateOnAnimation()
            ambient -> if (!pendingTick) {
                pendingTick = true
                postDelayed({ pendingTick = false; invalidate() }, 33L)
            }
            else -> { running = false; lastFrameNs = 0L }
        }
    }

    protected open fun drawBackground(c: Canvas) {
        if (bgShader == null || bgW != width || bgH != height ||
            bgSkinVersion != Skins.version) {
            bgW = width; bgH = height; bgSkinVersion = Skins.version
            bgShader = LinearGradient(0f, 0f, 0f, height.toFloat(),
                Palette.BG_TOP, Palette.BG_BOTTOM, Shader.TileMode.CLAMP)
        }
        paint.reset()
        paint.isAntiAlias = true
        paint.shader = bgShader
        c.drawRect(0f, 0f, width.toFloat(), height.toFloat(), paint)
        paint.shader = null
    }

    // ---- shared drawing helpers ----

    protected fun textPaint(size: Float, color: Int, tf: android.graphics.Typeface,
                            align: Paint.Align = Paint.Align.CENTER): Paint {
        paint.reset()
        paint.isAntiAlias = true
        paint.textSize = size
        paint.color = color
        paint.typeface = tf
        paint.textAlign = align
        return paint
    }

    protected fun drawText(c: Canvas, s: String, x: Float, y: Float, size: Float,
                           color: Int, tf: android.graphics.Typeface = Fonts.bold,
                           align: Paint.Align = Paint.Align.CENTER, letterSpacing: Float = 0f) {
        val p = textPaint(size, color, tf, align)
        p.letterSpacing = letterSpacing
        c.drawText(s, x, y, p)
    }

    /** Soft card with a hairline edge and a very light drop shadow. */
    protected fun drawCard(c: Canvas, r: RectF, radius: Float, fill: Int = Palette.CARD,
                           edge: Int = Palette.CARD_EDGE, shadowAlpha: Int = 22,
                           shadowDy: Float = 6f, shadowBlur: Float = 14f) {
        paint.reset(); paint.isAntiAlias = true
        if (shadowAlpha > 0) {
            paint.color = fill
            paint.setShadowLayer(shadowBlur, 0f, shadowDy,
                Palette.withAlpha(0x101B3A, shadowAlpha))
            c.drawRoundRect(r, radius, radius, paint)
            paint.clearShadowLayer()
        }
        paint.color = fill
        c.drawRoundRect(r, radius, radius, paint)
        if (edge != 0) {
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = 1.5f
            paint.color = edge
            c.drawRoundRect(r, radius, radius, paint)
            paint.style = Paint.Style.FILL
        }
    }

    protected fun drawPillButton(c: Canvas, b: UiButton, label: String, textSize: Float,
                                 primary: Boolean, enabled: Boolean = true) {
        val r = RectF(b.rect)
        val s = b.scale
        c.save()
        c.scale(s, s, r.centerX(), r.centerY())
        val radius = r.height() / 2f
        paint.reset(); paint.isAntiAlias = true
        if (primary && enabled) {
            paint.shader = LinearGradient(r.left, r.top, r.right, r.bottom,
                Palette.ACCENT, Palette.ACCENT3, Shader.TileMode.CLAMP)
            paint.setShadowLayer(18f, 0f, 8f, Palette.withAlpha(Palette.ACCENT, 90))
            c.drawRoundRect(r, radius, radius, paint)
            paint.clearShadowLayer(); paint.shader = null
        } else {
            drawCard(c, r, radius, if (enabled) Palette.CARD else 0xFFF0F3FA.toInt(),
                Palette.CARD_EDGE, if (enabled) 18 else 0)
        }
        val tc = when {
            !enabled -> Palette.TEXT_DIM
            primary -> 0xFFFFFFFF.toInt()
            else -> Palette.TEXT
        }
        val p = textPaint(textSize, tc, Fonts.black)
        p.letterSpacing = 0.06f
        c.drawText(label, r.centerX(), r.centerY() + textSize * 0.35f, p)
        c.restore()
    }

    /** Circular icon-button background plate. */
    protected fun drawCircleButton(c: Canvas, b: UiButton, tint: Int = Palette.CARD) {
        val r = RectF(b.rect)
        c.save()
        c.scale(b.scale, b.scale, r.centerX(), r.centerY())
        paint.reset(); paint.isAntiAlias = true
        paint.color = tint
        paint.setShadowLayer(12f, 0f, 5f, Palette.withAlpha(0x101B3A, 26))
        c.drawCircle(r.centerX(), r.centerY(), r.width() / 2f, paint)
        paint.clearShadowLayer()
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 1.4f
        paint.color = Palette.CARD_EDGE
        c.drawCircle(r.centerX(), r.centerY(), r.width() / 2f, paint)
        paint.style = Paint.Style.FILL
        c.restore()
    }

    protected fun iconPaint(color: Int, strokeW: Float): Paint {
        paint.reset(); paint.isAntiAlias = true
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = strokeW
        paint.strokeCap = Paint.Cap.ROUND
        paint.strokeJoin = Paint.Join.ROUND
        paint.color = color
        return paint
    }

    protected fun fillPaint(color: Int): Paint {
        paint.reset(); paint.isAntiAlias = true
        paint.style = Paint.Style.FILL
        paint.color = color
        return paint
    }

    protected fun dp(v: Float): Float = v * resources.displayMetrics.density
}
