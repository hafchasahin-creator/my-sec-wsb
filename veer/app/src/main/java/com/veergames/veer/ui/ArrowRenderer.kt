package com.veergames.veer.ui

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Shader
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/**
 * Polyline sampler + arrow drawing.
 *
 * A "track" is the arrow's own polyline (tail..head, px) with its corners
 * pre-filleted, extended by the straight exit ray. The body slides along it
 * train-style: at travel s the visible body spans arclengths
 * [s, s + bodyLen]. Because the body only ever occupies its own track plus a
 * ray the puzzle model has verified clear, it can never overlap another arrow.
 *
 * Corners are baked into the geometry rather than applied with a
 * CornerPathEffect, so (a) nothing is allocated per frame, (b) Skia's path
 * cache keeps hitting, (c) the radius cannot pop as the body end crosses a
 * vertex, and (d) effects that sample the track - the flame, the trail - ride
 * exactly on the ink through every bend.
 */
class Track(val xs: FloatArray, val ys: FloatArray) {

    val cum = FloatArray(xs.size)
    val total: Float

    init {
        var acc = 0f
        for (i in 1 until xs.size) {
            acc += hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1])
            cum[i] = acc
        }
        total = acc
    }

    /** out = [x, y, tangentX, tangentY] at arclength [dist]. */
    fun pointAt(dist: Float, out: FloatArray) {
        val d = dist.coerceIn(0f, total)
        var i = 1
        while (i < cum.size && cum[i] < d) i++
        if (i >= cum.size) i = cum.size - 1
        val segLen = cum[i] - cum[i - 1]
        val t = if (segLen <= 0f) 0f else (d - cum[i - 1]) / segLen
        out[0] = xs[i - 1] + (xs[i] - xs[i - 1]) * t
        out[1] = ys[i - 1] + (ys[i] - ys[i - 1]) * t
        val dx = xs[i] - xs[i - 1]
        val dy = ys[i] - ys[i - 1]
        val len = hypot(dx, dy).coerceAtLeast(1e-4f)
        out[2] = dx / len
        out[3] = dy / len
    }

    /**
     * Monotone variant: [cursor] holds the last segment index, so walking
     * forward along the track costs O(1) per sample instead of O(segments).
     */
    fun pointAtSeq(dist: Float, out: FloatArray, cursor: IntArray) {
        val d = dist.coerceIn(0f, total)
        var i = cursor[0].coerceIn(1, cum.size - 1)
        while (i > 1 && cum[i - 1] > d) i--
        while (i < cum.size - 1 && cum[i] < d) i++
        cursor[0] = i
        val segLen = cum[i] - cum[i - 1]
        val t = if (segLen <= 0f) 0f else (d - cum[i - 1]) / segLen
        out[0] = xs[i - 1] + (xs[i] - xs[i - 1]) * t
        out[1] = ys[i - 1] + (ys[i] - ys[i - 1]) * t
        val dx = xs[i] - xs[i - 1]
        val dy = ys[i] - ys[i - 1]
        val len = hypot(dx, dy).coerceAtLeast(1e-4f)
        out[2] = dx / len
        out[3] = dy / len
    }

    /** Fill [path] with the sub-polyline spanning arclengths [a, b]. */
    fun subPath(a: Float, b: Float, path: Path, tmp: FloatArray) {
        path.rewind()
        val lo = a.coerceIn(0f, total)
        val hi = b.coerceIn(0f, total)
        if (hi - lo < 0.25f) return
        pointAt(lo, tmp)
        path.moveTo(tmp[0], tmp[1])
        for (i in 1 until cum.size - 1) {
            if (cum[i] > lo && cum[i] < hi) path.lineTo(xs[i], ys[i])
        }
        pointAt(hi, tmp)
        path.lineTo(tmp[0], tmp[1])
    }

    companion object {
        /**
         * Build a track from lattice-aligned corner points, replacing each
         * interior corner with a quadratic fillet of radius [r].
         * Returns the track plus the arclength of the head vertex, which is
         * the body's true length once the corners have shortened it.
         */
        fun filleted(cx: FloatArray, cy: FloatArray, headIndex: Int, r: Float,
                     seg: Int = 4): Pair<Track, Float> {
            val n = cx.size
            val xs = ArrayList<Float>(n + seg * n)
            val ys = ArrayList<Float>(n + seg * n)
            var headArc = -1
            xs.add(cx[0]); ys.add(cy[0])
            for (i in 1 until n - 1) {
                if (i == headIndex) {          // straight continuation into the ray
                    xs.add(cx[i]); ys.add(cy[i])
                    headArc = xs.size - 1
                    continue
                }
                val inLen = hypot(cx[i] - cx[i - 1], cy[i] - cy[i - 1])
                val outLen = hypot(cx[i + 1] - cx[i], cy[i + 1] - cy[i])
                val rr = min(r, 0.45f * min(inLen, outLen))
                if (rr < 0.5f) {
                    xs.add(cx[i]); ys.add(cy[i])
                } else {
                    val ax = cx[i] - (cx[i] - cx[i - 1]) / inLen * rr
                    val ay = cy[i] - (cy[i] - cy[i - 1]) / inLen * rr
                    val bx = cx[i] + (cx[i + 1] - cx[i]) / outLen * rr
                    val by = cy[i] + (cy[i + 1] - cy[i]) / outLen * rr
                    xs.add(ax); ys.add(ay)
                    for (k in 1 until seg) {
                        val t = k.toFloat() / seg
                        val u = 1 - t
                        xs.add(u * u * ax + 2 * u * t * cx[i] + t * t * bx)
                        ys.add(u * u * ay + 2 * u * t * cy[i] + t * t * by)
                    }
                    xs.add(bx); ys.add(by)
                }
                if (i == headIndex) headArc = xs.size - 1
            }
            xs.add(cx[n - 1]); ys.add(cy[n - 1])
            if (headIndex == n - 1) headArc = xs.size - 1
            val track = Track(xs.toFloatArray(), ys.toFloatArray())
            val bodyLen = if (headArc >= 0) track.cum[headArc] else track.total
            return track to bodyLen
        }
    }
}

object ArrowDraw {

    /** Geometry as fractions of one grid cell, measured against the
     *  reference art: slim shafts, tight corners, welded barbed heads. */
    const val STROKE_F = 0.185f
    const val HEAD_LEN_F = 0.50f
    const val HEAD_WID_F = 0.54f
    const val CORNER_F = 0.09f
    private const val HEAD_BACK_F = 0.24f     // barb offset behind the anchor
    private const val NOTCH_F = -0.07f        // swallowtail, behind the anchor

    private val bodyPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val headPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val glowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val glowPath = Path()
    private val tmp = FloatArray(4)

    /** Board-space ink ramp, rebuilt when the board or skin changes. */
    var inkShader: Shader? = null
    var minStroke = 0f

    /**
     * Build the head triangle for an arrow whose head anchor is at (hx, hy)
     * pointing along (ux, uy). The barbs sit *behind* the anchor and the
     * swallowtail notch behind it too, so the shaft's round cap is entirely
     * inside the head: the two read as one continuous piece of ink.
     */
    private fun buildHead(path: Path, hx: Float, hy: Float, ux: Float, uy: Float,
                          cell: Float, scale: Float) {
        val headLen = cell * HEAD_LEN_F
        val headWid = cell * HEAD_WID_F * scale
        val back = headLen * HEAD_BACK_F
        val px = -uy
        val py = ux
        path.rewind()
        path.moveTo(hx + ux * headLen, hy + uy * headLen)
        path.lineTo(hx - ux * back + px * headWid * 0.5f, hy - uy * back + py * headWid * 0.5f)
        path.lineTo(hx + ux * headLen * NOTCH_F, hy + uy * headLen * NOTCH_F)
        path.lineTo(hx - ux * back - px * headWid * 0.5f, hy - uy * back - py * headWid * 0.5f)
        path.close()
    }

    /**
     * Rebuild an arrow's body + head geometry for travel [s]. Callers cache
     * the result and only rebuild when the arrow actually moves.
     */
    fun buildGeometry(track: Track, s: Float, bodyLen: Float, cell: Float,
                      bodyPath: Path, headPath: Path, headScale: Float = 1f) {
        val headPos = s + bodyLen
        // the shaft runs all the way to the head anchor - no gap, ever
        track.subPath(max(s, 0f), min(headPos, track.total), bodyPath, tmp)
        track.pointAt(min(headPos, track.total), tmp)
        buildHead(headPath, tmp[0], tmp[1], tmp[2], tmp[3], cell, headScale)
    }

    /**
     * Paint pre-built geometry. [colorTail]/[colorHead] equal means the
     * shared board-space ink shader is used; a tinted state paints flat.
     */
    fun paint(c: Canvas, bodyPath: Path, headPath: Path, cell: Float,
              colorTail: Int, colorHead: Int, alpha: Int = 255,
              glowWidth: Float = 0f, glowColor: Int = 0) {
        if (alpha <= 0) return
        val stroke = max(cell * STROKE_F, minStroke)

        if (glowWidth > 0f && glowColor != 0) {
            glowPath.rewind()
            glowPath.addPath(bodyPath)
            glowPath.addPath(headPath)
            for (i in 3 downTo 1) {
                glowPaint.color = Palette.withAlpha(glowColor,
                    (intArrayOf(0, 46, 30, 18)[i] * alpha) / 255)
                glowPaint.strokeWidth = stroke + glowWidth * i
                c.drawPath(glowPath, glowPaint)
            }
        }

        bodyPaint.strokeWidth = stroke
        val flat = colorTail == colorHead || inkShader == null
        if (flat) {
            bodyPaint.shader = null
            bodyPaint.color = Palette.withAlpha(colorHead, alpha)
        } else {
            bodyPaint.shader = inkShader
            bodyPaint.alpha = alpha
        }
        c.drawPath(bodyPath, bodyPaint)
        bodyPaint.shader = null

        if (flat) {
            headPaint.shader = null
            headPaint.color = Palette.withAlpha(colorHead, alpha)
        } else {
            headPaint.shader = inkShader
            headPaint.alpha = alpha
        }
        c.drawPath(headPath, headPaint)
        headPaint.shader = null
    }

    /** Convenience for one-off draws (previews, menus): build then paint. */
    fun draw(c: Canvas, track: Track, s: Float, bodyLen: Float, cell: Float,
             colorTail: Int, colorHead: Int, alpha: Int = 255,
             glowWidth: Float = 0f, glowColor: Int = 0, headScale: Float = 1f) {
        buildGeometry(track, s, bodyLen, cell, scratchBody, scratchHead, headScale)
        paint(c, scratchBody, scratchHead, cell, colorTail, colorHead, alpha,
            glowWidth, glowColor)
    }

    private val scratchBody = Path()
    private val scratchHead = Path()
}
