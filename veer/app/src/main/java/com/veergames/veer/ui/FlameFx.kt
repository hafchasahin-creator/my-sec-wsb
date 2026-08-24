package com.veergames.veer.ui

import android.graphics.Canvas
import android.graphics.Paint
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * The Flame skin's fire, drawn along an arrow's own [Track].
 *
 * Every sample is taken by arclength along the track, so the fire follows
 * each 90-degree bend exactly instead of being a sprite pasted behind the
 * arrow. Four ribbons - two behind the ink, two in front - weave against
 * each other via a lateral offset, which reads as tongues of flame while
 * costing four batched drawLines calls per arrow.
 *
 * Lifecycle: IGNITE (a burn front races tail -> head) then LAUNCH (the fire
 * follows the moving body and trails behind it, longer the faster it goes).
 */
class FlameFx {

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val tmp = FloatArray(4)
    private val cursor = IntArray(1)
    private val sx = FloatArray(MAX_SAMPLES)
    private val sy = FloatArray(MAX_SAMPLES)
    private val nx = FloatArray(MAX_SAMPLES)
    private val ny = FloatArray(MAX_SAMPLES)
    private val sd = FloatArray(MAX_SAMPLES)
    private val lines = FloatArray(MAX_SAMPLES * 4)
    private var count = 0

    companion object {
        const val IGNITE_SECONDS = 0.20f
        private const val MAX_SAMPLES = 48
        private const val SMOKE = 0x59FF4D0A
        private const val OUTER = 0xFFFF6A18.toInt()
        private const val MID = 0xFFFFA02A.toInt()
        private const val INNER = 0xFFFFE9A8.toInt()
    }

    /**
     * Sample the lit span once per arrow per frame. [front] is the fraction
     * of the body alight (ignition), [trailLen] the flame length dragging
     * behind the tail.
     */
    private fun sample(track: Track, bodyStart: Float, bodyLen: Float, cell: Float,
                       front: Float, trailLen: Float): Boolean {
        val litFrom = max(0f, bodyStart - trailLen)
        val litTo = bodyStart + bodyLen * front.coerceIn(0f, 1f)
        if (litTo - litFrom < cell * 0.05f) { count = 0; return false }
        val step = cell * 0.35f
        count = min(MAX_SAMPLES, max(2, ((litTo - litFrom) / step).toInt() + 2))
        cursor[0] = 1
        val span = litTo - litFrom
        for (i in 0 until count) {
            val d = litFrom + span * i / (count - 1f)
            track.pointAtSeq(d, tmp, cursor)
            sx[i] = tmp[0]; sy[i] = tmp[1]
            nx[i] = -tmp[3]; ny[i] = tmp[2]
            sd[i] = d
        }
        return true
    }

    /** Ribbons that sit under the ink. */
    fun drawBehind(c: Canvas, track: Track, bodyStart: Float, bodyLen: Float, cell: Float,
                   front: Float, trailLen: Float, time: Float, seed: Float) {
        if (!sample(track, bodyStart, bodyLen, cell, front, trailLen)) return
        val actualTrail = bodyStart - max(0f, bodyStart - trailLen)
        ribbon(c, cell, time, seed, actualTrail, 1.00f, SMOKE, 0.9f)
        ribbon(c, cell, time, seed + 4.1f, actualTrail, 0.74f, OUTER, 1.1f)
    }

    /** Brighter cores drawn over the ink so the fire reads as fire. */
    fun drawFront(c: Canvas, track: Track, bodyStart: Float, bodyLen: Float, cell: Float,
                  front: Float, trailLen: Float, time: Float, seed: Float) {
        if (count < 2) return
        val actualTrail = bodyStart - max(0f, bodyStart - trailLen)
        ribbon(c, cell, time, seed + 9.7f, actualTrail, 0.44f, MID, -1.2f)
        ribbon(c, cell, time, seed + 16.3f, actualTrail, 0.22f, INNER, -0.7f)
    }

    /**
     * One woven ribbon. The lateral offset is what makes it look alive:
     * each ribbon snakes around the centreline at its own phase, so the
     * four together read as separate tongues rather than one fat stroke.
     */
    private fun ribbon(c: Canvas, cell: Float, time: Float, seed: Float, trailLen: Float,
                       widthF: Float, color: Int, swayF: Float) {
        if (count < 2) return
        val sway = cell * 0.07f * swayF
        var j = 0
        for (i in 0 until count) {
            val wob = sin(sd[i] / cell * 3.1f - time * 15f + seed) +
                0.5f * sin(sd[i] / cell * 7.3f + time * 23f + seed * 2.1f)
            val ox = nx[i] * sway * wob
            val oy = ny[i] * sway * wob
            if (i > 0) {
                lines[j++] = sx[i - 1] + nx[i - 1] * sway *
                    (sin(sd[i - 1] / cell * 3.1f - time * 15f + seed) +
                        0.5f * sin(sd[i - 1] / cell * 7.3f + time * 23f + seed * 2.1f))
                lines[j++] = sy[i - 1] + ny[i - 1] * sway *
                    (sin(sd[i - 1] / cell * 3.1f - time * 15f + seed) +
                        0.5f * sin(sd[i - 1] / cell * 7.3f + time * 23f + seed * 2.1f))
                lines[j++] = sx[i] + ox
                lines[j++] = sy[i] + oy
            }
        }
        // taper: the trailing end dissolves rather than stopping flat
        val span = sd[count - 1] - sd[0]
        val trailPortion = if (span > 0f) (trailLen / span).coerceIn(0f, 1f) else 0f
        val head = 1f - 0.35f * trailPortion
        paint.strokeWidth = cell * ArrowDraw.STROKE_F * widthF * 2.2f * head
        paint.color = Palette.withAlpha(color, (color ushr 24 and 0xFF))
        c.drawLines(lines, 0, j, paint)
        // a brighter, thinner pass over the leading third sells the heat
        if (j >= 8) {
            val from = (j * 2 / 3) and 3.inv()
            paint.strokeWidth = paint.strokeWidth * 0.55f
            paint.color = Palette.withAlpha(color, min(255, (color ushr 24 and 0xFF) + 40))
            c.drawLines(lines, from, j - from, paint)
        }
    }

    /** A licking tongue just ahead of the burn front during ignition. */
    fun drawTongue(c: Canvas, track: Track, dist: Float, cell: Float, time: Float) {
        track.pointAt(dist, tmp)
        val x = tmp[0]; val y = tmp[1]
        val pulse = 1f + 0.25f * sin(time * 30f)
        val r = cell * 0.34f * pulse
        fill.color = Palette.withAlpha(OUTER, 150)
        c.drawCircle(x, y, r, fill)
        fill.color = Palette.withAlpha(MID, 190)
        c.drawCircle(x, y, r * 0.62f, fill)
        fill.color = Palette.withAlpha(INNER, 235)
        c.drawCircle(x, y, r * 0.30f, fill)
    }
}

/** Warm ember particles with buoyancy, used by the Flame skin. */
class Embers {

    private class E {
        var x = 0f; var y = 0f; var vx = 0f; var vy = 0f
        var life = 0f; var maxLife = 1f; var size = 3f; var hot = 0f
        var alive = false
    }

    private val pool = Array(180) { E() }
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private var live = 0
    private var rndState = 12345

    private fun rnd(): Float {
        rndState = rndState * 1103515245 + 12345
        return ((rndState ushr 16) and 0x7FFF) / 32767f
    }

    fun spawn(x: Float, y: Float, count: Int, spread: Float, dirX: Float = 0f,
              dirY: Float = 0f, speed: Float = 90f, life: Float = 0.7f, size: Float = 4f) {
        var made = 0
        for (e in pool) {
            if (made >= count) break
            if (e.alive) continue
            e.alive = true; made++; live++
            val a = rnd() * 6.2831f
            val m = speed * (0.3f + rnd() * 0.9f)
            e.x = x + (rnd() - 0.5f) * spread
            e.y = y + (rnd() - 0.5f) * spread
            e.vx = dirX * speed + kotlin.math.cos(a) * m * 0.6f
            e.vy = dirY * speed + sin(a) * m * 0.6f - 40f
            e.maxLife = life * (0.6f + rnd() * 0.8f)
            e.life = e.maxLife
            e.size = size * (0.5f + rnd())
            e.hot = 0.5f + rnd() * 0.5f
        }
    }

    fun step(dt: Float): Boolean {
        if (live == 0) return false
        live = 0
        for (e in pool) {
            if (!e.alive) continue
            e.life -= dt
            if (e.life <= 0f) { e.alive = false; continue }
            live++
            e.vy -= 150f * dt
            e.vx *= 0.94f; e.vy *= 0.96f
            e.x += e.vx * dt; e.y += e.vy * dt
        }
        return live > 0
    }

    fun draw(c: Canvas) {
        if (live == 0) return
        for (e in pool) {
            if (!e.alive) continue
            val t = (e.life / e.maxLife).coerceIn(0f, 1f)
            val col = Palette.lerpColor(0xFFFF3D00.toInt(), 0xFFFFE9A8.toInt(), t * e.hot)
            paint.color = Palette.withAlpha(col, (235 * t).toInt())
            c.drawCircle(e.x, e.y, e.size * (0.45f + 0.55f * t), paint)
        }
    }

    fun clear() { for (e in pool) e.alive = false; live = 0 }
}

/** Cold sparkles for the Ice skin: slow drifting frost motes. */
class Frost {

    private class F {
        var x = 0f; var y = 0f; var vx = 0f; var vy = 0f
        var life = 0f; var maxLife = 1f; var size = 3f; var spin = 0f
        var alive = false
    }

    private val pool = Array(120) { F() }
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private var live = 0
    private var seed = 999

    private fun rnd(): Float {
        seed = seed * 1103515245 + 12345
        return ((seed ushr 16) and 0x7FFF) / 32767f
    }

    fun spawn(x: Float, y: Float, count: Int, spread: Float, speed: Float = 60f) {
        var made = 0
        for (f in pool) {
            if (made >= count) break
            if (f.alive) continue
            f.alive = true; made++; live++
            val a = rnd() * 6.2831f
            f.x = x + (rnd() - 0.5f) * spread
            f.y = y + (rnd() - 0.5f) * spread
            f.vx = kotlin.math.cos(a) * speed * (0.3f + rnd())
            f.vy = sin(a) * speed * (0.3f + rnd()) + 20f
            f.maxLife = 0.7f + rnd() * 0.7f
            f.life = f.maxLife
            f.size = 2.5f + rnd() * 3.5f
            f.spin = rnd() * 6.28f
        }
    }

    fun step(dt: Float): Boolean {
        if (live == 0) return false
        live = 0
        for (f in pool) {
            if (!f.alive) continue
            f.life -= dt
            if (f.life <= 0f) { f.alive = false; continue }
            live++
            f.vy += 60f * dt
            f.vx *= 0.97f; f.vy *= 0.98f
            f.x += f.vx * dt; f.y += f.vy * dt
            f.spin += dt * 3f
        }
        return live > 0
    }

    fun draw(c: Canvas) {
        if (live == 0) return
        paint.style = Paint.Style.STROKE
        paint.strokeCap = Paint.Cap.ROUND
        for (f in pool) {
            if (!f.alive) continue
            val t = (f.life / f.maxLife).coerceIn(0f, 1f)
            paint.color = Palette.withAlpha(0xFFCFEEFF.toInt(), (220 * t).toInt())
            paint.strokeWidth = max(1f, f.size * 0.32f)
            val r = f.size * (0.6f + 0.4f * t)
            for (k in 0 until 3) {
                val a = f.spin + k * 1.047f
                val dx = kotlin.math.cos(a) * r
                val dy = sin(a) * r
                c.drawLine(f.x - dx, f.y - dy, f.x + dx, f.y + dy, paint)
            }
        }
        paint.style = Paint.Style.FILL
    }

    fun clear() { for (f in pool) f.alive = false; live = 0 }
}

/**
 * The level-complete outro: a shockwave from the last exit, a ripple that
 * runs through the dot lattice, and rings that punch out behind each star.
 * Deliberately short - the whole thing is spent inside ~1.2 s so controls
 * come back fast.
 */
class Outro {

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    var active = false; private set
    private var t = 0f
    private var ox = 0f
    private var oy = 0f

    fun start(x: Float, y: Float) { active = true; t = 0f; ox = x; oy = y }
    fun clear() { active = false; t = 0f }

    fun step(dt: Float): Boolean {
        if (!active) return false
        t += dt
        if (t > 1.4f) active = false
        return active
    }

    /** Ripple phase for a dot, measured from the blast origin. */
    fun dotBoost(x: Float, y: Float, cell: Float): Float {
        if (!active) return 0f
        val d = kotlin.math.hypot(x - ox, y - oy)
        val wave = t * cell * 26f
        val k = (1f - kotlin.math.abs(d - wave) / (cell * 1.6f)).coerceIn(0f, 1f)
        return k * (1f - (t / 1.4f).coerceIn(0f, 1f))
    }

    fun draw(c: Canvas, cell: Float, accent: Int, accent2: Int) {
        if (!active) return
        for (i in 0 until 3) {
            val lag = i * 0.09f
            val k = ((t - lag) / 0.85f)
            if (k <= 0f || k >= 1f) continue
            val r = Ease.outCubic(k) * cell * 16f
            val a = ((1f - k) * 150).toInt()
            paint.strokeWidth = cell * 0.16f * (1f - k)
            paint.color = Palette.withAlpha(if (i % 2 == 0) accent else accent2, a)
            c.drawCircle(ox, oy, r, paint)
        }
    }

    /** Expanding ring behind a star as it lands. */
    fun starRing(c: Canvas, x: Float, y: Float, age: Float, size: Float, color: Int) {
        val k = (age / 0.42f).coerceIn(0f, 1f)
        if (k >= 1f) return
        paint.strokeWidth = size * 0.10f * (1f - k)
        paint.color = Palette.withAlpha(color, ((1f - k) * 180).toInt())
        c.drawCircle(x, y, size * (0.4f + Ease.outCubic(k) * 1.3f), paint)
    }
}
