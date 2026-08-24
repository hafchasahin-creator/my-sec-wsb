package com.veergames.veer.ui

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

/**
 * Visual identity - light, clean, reference-faithful: near-white paper,
 * soft dotted lattice, deep-navy arrows, azure for selection, coral for
 * blocked. Colour is used sparingly so the puzzle reads instantly.
 */
object Palette {
    // written by Skins.equip(); defaults are the Classic skin
    @JvmField var BG_TOP = 0xFFFFFFFF.toInt()
    @JvmField var BG_BOTTOM = 0xFFF2F5FC.toInt()
    @JvmField var CARD = 0xFFFFFFFF.toInt()
    @JvmField var CARD_EDGE = 0xFFE2E8F6.toInt()
    @JvmField var DOT = 0xFFCDD6EA.toInt()
    @JvmField var TEXT = 0xFF1B2547.toInt()
    @JvmField var TEXT_DIM = 0xFF7C89AC.toInt()
    @JvmField var ACCENT = 0xFF2E7BF6.toInt()      // azure - selection / primary
    @JvmField var ACCENT2 = 0xFF16C79A.toInt()     // mint - success
    @JvmField var ACCENT3 = 0xFF6C5CE7.toInt()     // indigo - logo accent
    @JvmField var HEART_EMPTY = 0xFFD8DFEF.toInt()
    @JvmField var INK = 0xFF16204A.toInt()
    @JvmField var INK_LIGHT = 0xFF25325F.toInt()

    const val HEART = 0xFFFF4D6D.toInt()
    const val GOLD = 0xFFFFB020.toInt()
    const val DANGER = 0xFFFF3B4E.toInt()
    const val INK_SHADOW = 0x2A16204A

    /** Celebration-only colours (confetti, stars) - never used on the board. */
    val FESTIVE = intArrayOf(
        0xFF2E7BF6.toInt(), 0xFF16C79A.toInt(), 0xFFFFB020.toInt(),
        0xFFFF4D6D.toInt(), 0xFF6C5CE7.toInt(), 0xFF00C2D1.toInt(),
    )

    /** A muted card fill for disabled/locked surfaces on any skin. */
    fun chipDim(): Int = lerpColor(CARD, BG_BOTTOM, 0.55f)

    fun withAlpha(color: Int, alpha: Int): Int =
        (color and 0x00FFFFFF) or (alpha.coerceIn(0, 255) shl 24)

    fun lerpColor(a: Int, b: Int, t: Float): Int {
        val tt = t.coerceIn(0f, 1f)
        fun ch(sa: Int, sb: Int) = (sa + ((sb - sa) * tt)).toInt()
        return Color.argb(
            ch(Color.alpha(a), Color.alpha(b)), ch(Color.red(a), Color.red(b)),
            ch(Color.green(a), Color.green(b)), ch(Color.blue(a), Color.blue(b)),
        )
    }
}

object Fonts {
    val black: Typeface = Typeface.create("sans-serif-black", Typeface.NORMAL)
    val bold: Typeface = Typeface.create("sans-serif", Typeface.BOLD)
    val medium: Typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
    val regular: Typeface = Typeface.create("sans-serif", Typeface.NORMAL)
}

object Ease {
    fun outCubic(t: Float): Float { val u = 1 - t.coerceIn(0f, 1f); return 1 - u * u * u }
    fun inCubic(t: Float): Float { val u = t.coerceIn(0f, 1f); return u * u * u }
    fun inOut(t: Float): Float { val u = t.coerceIn(0f, 1f); return u * u * (3 - 2 * u) }
    /** Escape curve: moves on frame one, then accelerates out. */
    fun launch(t: Float): Float { val u = t.coerceIn(0f, 1f); return 0.55f * u + 0.45f * u * u }

    fun outBack(t: Float): Float {
        val u = t.coerceIn(0f, 1f) - 1f
        val s = 1.70158f
        return u * u * ((s + 1) * u + s) + 1
    }
    fun lerp(a: Float, b: Float, t: Float): Float = a + (b - a) * t
}

/** A tappable region drawn by the owning view; tracks press animation. */
class UiButton(val id: String) {
    val rect = RectF()
    var pressed = false
    var pressAnim = 0f // 0 rest .. 1 fully pressed
    var enabled = true

    /** Touch slop in px, set per screen from dp. */
    var touchPad = 24f

    fun contains(x: Float, y: Float): Boolean {
        if (!enabled) return false
        val pad = touchPad
        return x >= rect.left - pad && x <= rect.right + pad &&
            y >= rect.top - pad && y <= rect.bottom + pad
    }

    /** Advance press animation; returns true while animating. */
    fun step(dt: Float): Boolean {
        val target = if (pressed) 1f else 0f
        if (pressAnim == target) return false
        val speed = dt * 10f
        pressAnim = if (pressAnim < target) min(target, pressAnim + speed)
        else maxOf(target, pressAnim - speed)
        return true
    }

    val scale: Float get() = 1f - 0.07f * pressAnim
}

/** Hand-drawn glyphs; all sized to fit a box of [s] centered at (cx, cy). */
object Glyphs {

    fun back(c: Canvas, cx: Float, cy: Float, s: Float, p: Paint) {
        val path = Path()
        path.moveTo(cx + s * 0.22f, cy - s * 0.4f)
        path.lineTo(cx - s * 0.22f, cy)
        path.lineTo(cx + s * 0.22f, cy + s * 0.4f)
        c.drawPath(path, p)
    }

    fun bulb(c: Canvas, cx: Float, cy: Float, s: Float, p: Paint) {
        c.drawCircle(cx, cy - s * 0.08f, s * 0.30f, p)
        c.drawLine(cx - s * 0.12f, cy + s * 0.30f, cx + s * 0.12f, cy + s * 0.30f, p)
        c.drawLine(cx - s * 0.10f, cy + s * 0.42f, cx + s * 0.10f, cy + s * 0.42f, p)
        // rays
        for (i in 0 until 3) {
            val a = Math.PI * (0.75 + 0.25 * i) // 135, 90(top), 45 degrees
            val dx = cos(a).toFloat(); val dy = -sin(a).toFloat()
            c.drawLine(cx + dx * s * 0.42f, cy - s * 0.08f + dy * s * 0.42f,
                cx + dx * s * 0.55f, cy - s * 0.08f + dy * s * 0.55f, p)
        }
    }

    fun restart(c: Canvas, cx: Float, cy: Float, s: Float, p: Paint, fill: Paint) {
        val r = s * 0.34f
        val box = RectF(cx - r, cy - r, cx + r, cy + r)
        c.drawArc(box, -50f, 285f, false, p)
        // arrowhead at the arc start (top-right), pointing clockwise
        val ang = Math.toRadians(-55.0)
        val ax = cx + r * cos(ang).toFloat()
        val ay = cy + r * sin(ang).toFloat()
        val head = Path()
        val hs = s * 0.18f
        head.moveTo(ax + hs * 0.9f, ay - hs * 0.5f)
        head.lineTo(ax - hs * 0.6f, ay - hs * 0.6f)
        head.lineTo(ax + hs * 0.2f, ay + hs * 0.8f)
        head.close()
        c.drawPath(head, fill)
    }

    fun pause(c: Canvas, cx: Float, cy: Float, s: Float, fill: Paint) {
        val w = s * 0.14f; val h = s * 0.42f; val gap = s * 0.16f
        c.drawRoundRect(RectF(cx - gap - w, cy - h, cx - gap + w * 0.4f, cy + h), w * 0.5f, w * 0.5f, fill)
        c.drawRoundRect(RectF(cx + gap - w * 0.4f, cy - h, cx + gap + w, cy + h), w * 0.5f, w * 0.5f, fill)
    }

    fun gear(c: Canvas, cx: Float, cy: Float, s: Float, p: Paint) {
        val r = s * 0.30f
        c.drawCircle(cx, cy, r, p)
        c.drawCircle(cx, cy, r * 0.38f, p)
        for (i in 0 until 8) {
            val a = Math.PI / 4 * i
            val dx = cos(a).toFloat(); val dy = sin(a).toFloat()
            c.drawLine(cx + dx * r, cy + dy * r, cx + dx * (r + s * 0.14f), cy + dy * (r + s * 0.14f), p)
        }
    }

    fun heart(c: Canvas, cx: Float, cy: Float, s: Float, fill: Paint) {
        val path = Path()
        val w = s * 0.5f
        path.moveTo(cx, cy + w * 0.78f)
        path.cubicTo(cx - w * 1.3f, cy - w * 0.15f, cx - w * 0.72f, cy - w * 0.95f, cx, cy - w * 0.35f)
        path.cubicTo(cx + w * 0.72f, cy - w * 0.95f, cx + w * 1.3f, cy - w * 0.15f, cx, cy + w * 0.78f)
        c.drawPath(path, fill)
    }

    fun star(c: Canvas, cx: Float, cy: Float, s: Float, fill: Paint) {
        val path = Path()
        val outer = s * 0.5f
        val inner = outer * 0.42f
        for (i in 0 until 10) {
            val r = if (i % 2 == 0) outer else inner
            val a = -Math.PI / 2 + Math.PI / 5 * i
            val x = cx + (r * cos(a)).toFloat()
            val y = cy + (r * sin(a)).toFloat()
            if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }
        path.close()
        c.drawPath(path, fill)
    }

    fun lock(c: Canvas, cx: Float, cy: Float, s: Float, p: Paint, fill: Paint) {
        val w = s * 0.34f; val h = s * 0.28f
        c.drawRoundRect(RectF(cx - w, cy - h * 0.1f, cx + w, cy + h * 1.6f), s * 0.08f, s * 0.08f, fill)
        val shackle = RectF(cx - w * 0.62f, cy - h * 1.4f, cx + w * 0.62f, cy + h * 0.4f)
        c.drawArc(shackle, 180f, 180f, false, p)
    }

    fun play(c: Canvas, cx: Float, cy: Float, s: Float, fill: Paint) {
        val path = Path()
        path.moveTo(cx - s * 0.26f, cy - s * 0.36f)
        path.lineTo(cx + s * 0.4f, cy)
        path.lineTo(cx - s * 0.26f, cy + s * 0.36f)
        path.close()
        c.drawPath(path, fill)
    }

    fun speaker(c: Canvas, cx: Float, cy: Float, s: Float, p: Paint, fill: Paint) {
        val path = Path()
        path.moveTo(cx - s * 0.42f, cy - s * 0.16f)
        path.lineTo(cx - s * 0.18f, cy - s * 0.16f)
        path.lineTo(cx + s * 0.06f, cy - s * 0.36f)
        path.lineTo(cx + s * 0.06f, cy + s * 0.36f)
        path.lineTo(cx - s * 0.18f, cy + s * 0.16f)
        path.lineTo(cx - s * 0.42f, cy + s * 0.16f)
        path.close()
        c.drawPath(path, fill)
        val arc1 = RectF(cx - s * 0.1f, cy - s * 0.24f, cx + s * 0.38f, cy + s * 0.24f)
        c.drawArc(arc1, -60f, 120f, false, p)
        val arc2 = RectF(cx - s * 0.2f, cy - s * 0.42f, cx + s * 0.56f, cy + s * 0.42f)
        c.drawArc(arc2, -60f, 120f, false, p)
    }

    fun note(c: Canvas, cx: Float, cy: Float, s: Float, p: Paint, fill: Paint) {
        c.drawCircle(cx - s * 0.16f, cy + s * 0.26f, s * 0.15f, fill)
        c.drawLine(cx - s * 0.02f, cy + s * 0.26f, cx - s * 0.02f, cy - s * 0.34f, p)
        val flag = Path()
        flag.moveTo(cx - s * 0.02f, cy - s * 0.34f)
        flag.cubicTo(cx + s * 0.16f, cy - s * 0.30f, cx + s * 0.22f, cy - s * 0.16f, cx + s * 0.30f, cy - s * 0.14f)
        c.drawPath(flag, p)
    }

    fun vibrate(c: Canvas, cx: Float, cy: Float, s: Float, p: Paint) {
        c.drawRoundRect(RectF(cx - s * 0.16f, cy - s * 0.36f, cx + s * 0.16f, cy + s * 0.36f), s * 0.07f, s * 0.07f, p)
        c.drawLine(cx - s * 0.32f, cy - s * 0.2f, cx - s * 0.32f, cy + s * 0.2f, p)
        c.drawLine(cx + s * 0.32f, cy - s * 0.2f, cx + s * 0.32f, cy + s * 0.2f, p)
        c.drawLine(cx - s * 0.46f, cy - s * 0.1f, cx - s * 0.46f, cy + s * 0.1f, p)
        c.drawLine(cx + s * 0.46f, cy - s * 0.1f, cx + s * 0.46f, cy + s * 0.1f, p)
    }

    fun close(c: Canvas, cx: Float, cy: Float, s: Float, p: Paint) {
        c.drawLine(cx - s * 0.3f, cy - s * 0.3f, cx + s * 0.3f, cy + s * 0.3f, p)
        c.drawLine(cx + s * 0.3f, cy - s * 0.3f, cx - s * 0.3f, cy + s * 0.3f, p)
    }
}

/**
 * The brand mark: a V drawn as one stroked polyline whose right stroke
 * ends in an arrowhead escaping up-right. [progress] reveals the stroke
 * (0..1) for the splash draw-on animation.
 */
object LogoMark {

    fun draw(c: Canvas, cx: Float, cy: Float, size: Float, alpha: Int = 255,
             progress: Float = 1f, glow: Float = 1f) {
        val w = size * 0.5f
        val x0 = cx - w; val y0 = cy - size * 0.42f
        val x1 = cx; val y1 = cy + size * 0.46f
        val x2 = cx + w * 0.98f; val y2 = cy - size * 0.40f
        // head sits at the tip of the second stroke
        val hx = x2; val hy = y2
        val stroke = size * 0.16f

        val full = Path()
        full.moveTo(x0, y0)
        full.lineTo(x1, y1)
        full.lineTo(x2, y2)
        val measure = android.graphics.PathMeasure(full, false)
        val total = measure.length
        val shown = Path()
        measure.getSegment(0f, total * progress.coerceIn(0f, 1f), shown, true)

        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        p.style = Paint.Style.STROKE
        p.strokeCap = Paint.Cap.ROUND
        p.strokeJoin = Paint.Join.ROUND
        p.pathEffect = android.graphics.CornerPathEffect(size * 0.10f)
        p.shader = LinearGradient(x0, y1, x2, y2,
            Palette.withAlpha(Palette.ACCENT, alpha), Palette.withAlpha(Palette.ACCENT3, alpha),
            Shader.TileMode.CLAMP)
        // layered glow
        if (glow > 0f) {
            for (i in 3 downTo 1) {
                p.strokeWidth = stroke + i * size * 0.09f
                p.alpha = (alpha * glow * 0.10f).toInt().coerceAtLeast(0)
                c.drawPath(shown, p)
            }
        }
        p.alpha = alpha
        p.strokeWidth = stroke
        c.drawPath(shown, p)

        if (progress >= 0.995f) {
            // arrowhead pointing up-right, aligned with the second stroke
            val dirX = (x2 - x1); val dirY = (y2 - y1)
            val len = kotlin.math.hypot(dirX, dirY)
            val ux = dirX / len; val uy = dirY / len
            val px = -uy; val py = ux
            val headLen = size * 0.30f
            val headW = size * 0.34f
            val tipX = hx + ux * headLen; val tipY = hy + uy * headLen
            val head = Path()
            head.moveTo(tipX, tipY)
            head.lineTo(hx + px * headW * 0.5f - ux * headLen * 0.12f, hy + py * headW * 0.5f - uy * headLen * 0.12f)
            head.lineTo(hx - px * headW * 0.5f - ux * headLen * 0.12f, hy - py * headW * 0.5f - uy * headLen * 0.12f)
            head.close()
            val hp = Paint(Paint.ANTI_ALIAS_FLAG)
            hp.color = Palette.withAlpha(Palette.ACCENT3, alpha)
            c.drawPath(head, hp)
        }
    }
}
