package com.veergames.veer.ui

import android.graphics.Canvas
import android.graphics.Paint
import kotlin.random.Random

/** Tiny pooled particle system: circles with velocity, gravity, fade. */
class Particles {

    private class P {
        var x = 0f; var y = 0f; var vx = 0f; var vy = 0f
        var life = 0f; var maxLife = 1f; var size = 4f; var color = 0
        var gravity = 0f; var drag = 1f
        var alive = false
    }

    private val pool = Array(256) { P() }
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    var activeCount = 0; private set

    fun burst(x: Float, y: Float, baseColor: Int, count: Int, speed: Float,
              dirX: Float = 0f, dirY: Float = 0f, spread: Float = 1f,
              gravity: Float = 0f, life: Float = 0.55f, size: Float = 5f) {
        var spawned = 0
        for (p in pool) {
            if (spawned >= count) break
            if (p.alive) continue
            p.alive = true; spawned++
            val ang = Random.nextFloat() * Math.PI.toFloat() * 2f
            val mag = speed * (0.35f + Random.nextFloat() * 0.65f)
            p.x = x; p.y = y
            p.vx = dirX * speed + kotlin.math.cos(ang) * mag * spread
            p.vy = dirY * speed + kotlin.math.sin(ang) * mag * spread
            p.maxLife = life * (0.6f + Random.nextFloat() * 0.8f)
            p.life = p.maxLife
            p.size = size * (0.5f + Random.nextFloat())
            p.color = baseColor
            p.gravity = gravity
            p.drag = 0.90f
        }
        recount()
    }

    fun confetti(x: Float, y: Float, w: Float, count: Int) {
        var spawned = 0
        for (p in pool) {
            if (spawned >= count) break
            if (p.alive) continue
            p.alive = true; spawned++
            p.x = x + (Random.nextFloat() - 0.5f) * w
            p.y = y
            p.vx = (Random.nextFloat() - 0.5f) * 320f
            p.vy = -Random.nextFloat() * 620f - 120f
            p.maxLife = 1.1f + Random.nextFloat() * 0.7f
            p.life = p.maxLife
            p.size = 4f + Random.nextFloat() * 6f
            p.color = Palette.FESTIVE[Random.nextInt(Palette.FESTIVE.size)]
            p.gravity = 1500f
            p.drag = 0.985f
        }
        recount()
    }

    private fun recount() { activeCount = pool.count { it.alive } }

    /** Returns true while anything is alive. */
    fun step(dt: Float): Boolean {
        var any = false
        for (p in pool) {
            if (!p.alive) continue
            p.life -= dt
            if (p.life <= 0f) { p.alive = false; continue }
            any = true
            p.vy += p.gravity * dt
            p.vx *= p.drag; p.vy *= p.drag
            p.x += p.vx * dt; p.y += p.vy * dt
        }
        activeCount = pool.count { it.alive }
        return any
    }

    fun draw(c: Canvas) {
        for (p in pool) {
            if (!p.alive) continue
            val t = (p.life / p.maxLife).coerceIn(0f, 1f)
            paint.color = Palette.withAlpha(p.color, (255 * t).toInt())
            c.drawCircle(p.x, p.y, p.size * (0.5f + 0.5f * t), paint)
        }
    }

    fun clear() { for (p in pool) p.alive = false; activeCount = 0 }
}
