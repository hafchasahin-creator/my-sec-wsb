package com.veergames.veer.ui

import android.graphics.Canvas
import android.graphics.CornerPathEffect
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Shader

/**
 * Polyline sampler + premium arrow drawing.
 *
 * A "track" is the arrow's own polyline (tail..head, px coords) extended by
 * its exit ray. The body slides along the track train-style: at travel s the
 * visible body spans arclengths [s, s + bodyLen]. Because the body only ever
 * occupies its own track plus a verified-clear ray, it never overlaps others.
 */
class Track(val xs: FloatArray, val ys: FloatArray) {

    val cum = FloatArray(xs.size)
    val total: Float

    init {
        var acc = 0f
        for (i in 1 until xs.size) {
            acc += kotlin.math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1])
            cum[i] = acc
        }
        total = acc
    }

    fun pointAt(dist: Float, out: FloatArray) {
        val d = dist.coerceIn(0f, total)
        var i = 1
        while (i < cum.size && cum[i] < d) i++
        if (i >= cum.size) { out[0] = xs.last(); out[1] = ys.last(); out[2] = 1f; out[3] = 0f
            if (xs.size >= 2) tangent(xs.size - 1, out); return }
        val segLen = cum[i] - cum[i - 1]
        val t = if (segLen <= 0f) 0f else (d - cum[i - 1]) / segLen
        out[0] = xs[i - 1] + (xs[i] - xs[i - 1]) * t
        out[1] = ys[i - 1] + (ys[i] - ys[i - 1]) * t
        tangent(i, out)
    }

    private fun tangent(i: Int, out: FloatArray) {
        val dx = xs[i] - xs[i - 1]
        val dy = ys[i] - ys[i - 1]
        val len = kotlin.math.hypot(dx, dy).coerceAtLeast(1e-4f)
        out[2] = dx / len; out[3] = dy / len
    }

    /** Fill [path] with the sub-polyline spanning arclengths [a, b]. */
    fun subPath(a: Float, b: Float, path: Path, tmp: FloatArray) {
        path.rewind()
        val lo = a.coerceIn(0f, total)
        val hi = b.coerceIn(0f, total)
        if (hi - lo < 0.5f) return
        pointAt(lo, tmp)
        path.moveTo(tmp[0], tmp[1])
        for (i in 1 until cum.size - 1) {
            if (cum[i] > lo && cum[i] < hi) path.lineTo(xs[i], ys[i])
        }
        pointAt(hi, tmp)
        path.lineTo(tmp[0], tmp[1])
    }
}

object ArrowDraw {

    private val bodyPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val headPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val shadowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        color = SHADOW_COLOR
    }

    /** Geometry as fractions of one grid cell - measured against the brief's
     *  reference art: slim strokes, tight corners, crisp barbed heads. */
    const val STROKE_F = 0.185f
    const val HEAD_LEN_F = 0.46f
    const val HEAD_WID_F = 0.60f
    const val CORNER_F = 0.18f
    private const val SHADOW_COLOR = 0x18101B3A
    private val path = Path()
    private val tmp = FloatArray(4)

    /**
     * Draw one arrow body+head along [track] for travel [s].
     * [bodyLen] arclength of the body; [cell] grid cell in px.
     * Optional [overlayColor] tints the whole arrow (blocked flash / hint).
     */
    fun draw(
        c: Canvas, track: Track, s: Float, bodyLen: Float, cell: Float,
        colorTail: Int, colorHead: Int, alpha: Int = 255,
        overlayColor: Int = 0, glowWidth: Float = 0f, glowColor: Int = 0,
        shadow: Boolean = true, headScale: Float = 1f, cornerRadius: Float = CORNER_F,
    ) {
        if (alpha <= 0) return
        val stroke = cell * STROKE_F
        val headLen = cell * HEAD_LEN_F
        val headWid = cell * HEAD_WID_F * headScale
        val headBack = headLen * 0.16f

        val headPos = s + bodyLen
        // shaft stops exactly at the head's base so the two read as one solid form
        val bodyEnd = headPos - headLen * 0.12f
        track.subPath(s, bodyEnd, path, tmp)
        val effect = CornerPathEffect(cell * cornerRadius)

        if (shadow) {
            shadowPaint.strokeWidth = stroke * 1.04f
            shadowPaint.pathEffect = effect
            shadowPaint.alpha = (0x18 * alpha) / 255
            val off = cell * 0.035f
            c.save(); c.translate(0f, off)
            c.drawPath(path, shadowPaint)
            c.restore()
        }

        if (glowWidth > 0f && glowColor != 0) {
            bodyPaint.shader = null
            bodyPaint.pathEffect = effect
            for (i in 3 downTo 1) {
                bodyPaint.color = Palette.withAlpha(glowColor, (28 * i * alpha) / 255 / 2)
                bodyPaint.strokeWidth = stroke + glowWidth * i / 1.5f
                c.drawPath(path, bodyPaint)
            }
        }

        track.pointAt(s, tmp)
        val tx = tmp[0]; val ty = tmp[1]
        track.pointAt(headPos.coerceAtMost(track.total), tmp)
        val hx = tmp[0]; val hy = tmp[1]; val ux = tmp[2]; val uy = tmp[3]

        bodyPaint.pathEffect = effect
        bodyPaint.strokeWidth = stroke
        bodyPaint.shader = LinearGradient(tx, ty, hx, hy,
            Palette.withAlpha(colorTail, alpha), Palette.withAlpha(colorHead, alpha),
            Shader.TileMode.CLAMP)
        c.drawPath(path, bodyPaint)
        bodyPaint.shader = null

        // arrowhead: barbed triangle at head position along the tangent
        val px = -uy; val py = ux
        headPath.rewind()
        headPath.moveTo(hx + ux * headLen, hy + uy * headLen)
        headPath.lineTo(hx - ux * headBack + px * headWid * 0.5f, hy - uy * headBack + py * headWid * 0.5f)
        headPath.lineTo(hx + ux * headLen * 0.10f, hy + uy * headLen * 0.10f)
        headPath.lineTo(hx - ux * headBack - px * headWid * 0.5f, hy - uy * headBack - py * headWid * 0.5f)
        headPath.close()
        if (shadow) {
            headPaint.color = Palette.withAlpha(SHADOW_COLOR, (0x18 * alpha) / 255)
            c.save(); c.translate(0f, cell * 0.035f)
            c.drawPath(headPath, headPaint)
            c.restore()
        }
        if (glowWidth > 0f && glowColor != 0) {
            headPaint.color = Palette.withAlpha(glowColor, (70 * alpha) / 255)
            c.save()
            c.scale(1.25f, 1.25f, hx, hy)
            c.drawPath(headPath, headPaint)
            c.restore()
        }
        headPaint.color = Palette.withAlpha(colorHead, alpha)
        c.drawPath(headPath, headPaint)

        if (overlayColor != 0) {
            bodyPaint.color = overlayColor
            bodyPaint.strokeWidth = stroke
            bodyPaint.pathEffect = effect
            c.drawPath(path, bodyPaint)
            headPaint.color = overlayColor
            c.drawPath(headPath, headPaint)
        }
    }

    private val headPath = Path()
}
