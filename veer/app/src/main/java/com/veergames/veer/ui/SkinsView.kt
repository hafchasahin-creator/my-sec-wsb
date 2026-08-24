package com.veergames.veer.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.view.MotionEvent
import kotlin.math.max
import kotlin.math.min

/**
 * Skin picker. Each card runs a genuine live preview: a bent arrow on a
 * miniature board that ignites, launches, leaves the card and resets - using
 * the same [ArrowDraw], [FlameFx] and particle code as the real game, so what
 * the player sees here is exactly what they get.
 */
class SkinsView(context: Context) : BaseView(context) {

    private class Demo(val skin: Skin) {
        var track: Track? = null
        var bodyLen = 0f
        var travel = 0f
        var prevTravel = 0f
        var speed = 0f
        var phase = 0          // 0 rest, 1 ignite, 2 launch, 3 cooldown
        var t = 0f
        var igniteFront = 0f
        var seed = 0f
        val embers = Embers()
        val frost = Frost()
        val sparks = Particles()
        val bounds = RectF()
        var cell = 20f
    }

    private val demos = Skins.all.map { Demo(it) }
    private val cards = Skins.all.map { UiButton("skin_${it.id}") }
    private val btnBack = UiButton("back")
    private val flame = FlameFx()
    private val bg = BackgroundArrows()

    private var time = 0f
    private var enterT = 0f
    private var equippedFlash = 0f
    private val tmp = FloatArray(4)
    private val rectTmp = RectF()

    init { ambient = true; startAnim() }

    override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) {
        super.onSizeChanged(w, h, ow, oh)
        btnBack.rect.set(dp(14f), insetTop + dp(14f), dp(14f) + dp(44f), insetTop + dp(58f))

        val margin = dp(18f)
        val gap = dp(14f)
        val cols = 2
        val cardW = (w - margin * 2 - gap) / cols
        val cardH = min(cardW * 1.16f, (h - insetTop - dp(150f) - gap) / 2f)
        val top = insetTop + dp(120f)
        for ((i, b) in cards.withIndex()) {
            val cx = i % cols
            val cy = i / cols
            val x = margin + cx * (cardW + gap)
            val y = top + cy * (cardH + gap)
            b.rect.set(x, y, x + cardW, y + cardH)
        }
        for ((i, d) in demos.withIndex()) {
            val r = cards[i].rect
            d.bounds.set(r.left + dp(10f), r.top + dp(34f), r.right - dp(10f), r.bottom - dp(34f))
            buildDemo(d)
        }
        bg.layout(w, h)
    }

    /** A short S-shaped path that fits the card and exits to the right. */
    private fun buildDemo(d: Demo) {
        val b = d.bounds
        val cell = min(b.width() / 4.6f, b.height() / 3.4f)
        d.cell = cell
        val ox = b.centerX() - cell * 1.7f
        val oy = b.centerY() - cell * 1.0f
        val ptsX = floatArrayOf(0f, 0f, 2f, 2f, 3.4f)
        val ptsY = floatArrayOf(2f, 0f, 0f, 2f, 2f)
        val n = ptsX.size
        val xs = FloatArray(n + 1)
        val ys = FloatArray(n + 1)
        for (i in 0 until n) {
            xs[i] = ox + ptsX[i] * cell
            ys[i] = oy + ptsY[i] * cell
        }
        xs[n] = xs[n - 1] + (width + cell * 4f)
        ys[n] = ys[n - 1]
        d.track = Track(xs, ys)
        var len = 0f
        for (i in 1 until n) len += kotlin.math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1])
        d.bodyLen = len
        d.travel = 0f
        d.phase = 0
        d.t = 0f
        d.seed = d.skin.id.hashCode() % 10 * 1.3f
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        val x = event.x; val y = event.y
        val all = cards + btnBack
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN ->
                for (b in all) if (b.contains(x, y)) { b.pressed = true; startAnim() }
            MotionEvent.ACTION_UP -> {
                for ((i, b) in all.withIndex()) {
                    if (b.pressed && b.contains(x, y)) {
                        act.sound.tap(); act.haptics.buttonTick()
                        if (b.id == "back") act.showMenu()
                        else {
                            val skin = Skins.all[i]
                            act.applySkin(skin)
                            equippedFlash = 1f
                            // restart that card's demo so the change is felt
                            demos[i].phase = 1; demos[i].t = 0f; demos[i].travel = 0f
                        }
                    }
                    b.pressed = false
                }
                startAnim()
            }
            MotionEvent.ACTION_CANCEL -> { for (b in all) b.pressed = false; startAnim() }
        }
        return true
    }

    override fun step(dt: Float): Boolean {
        time += dt
        enterT = min(1f, enterT + dt * 2.2f)
        if (equippedFlash > 0f) equippedFlash = max(0f, equippedFlash - dt * 1.8f)
        for (b in cards + btnBack) b.step(dt)
        bg.step(dt)

        for (d in demos) {
            val track = d.track ?: continue
            d.prevTravel = d.travel
            d.t += dt
            when (d.phase) {
                0 -> if (d.t > 0.9f) { d.phase = 1; d.t = 0f }
                1 -> {
                    d.igniteFront = (d.t / FlameFx.IGNITE_SECONDS).coerceIn(0f, 1f)
                    if (d.skin.effect != Skin.Effect.FLAME || d.t >= FlameFx.IGNITE_SECONDS) {
                        d.phase = 2; d.t = 0f; d.igniteFront = 1f
                    }
                }
                2 -> {
                    val dur = 0.62f
                    val k = (d.t / dur).coerceIn(0f, 1f)
                    d.travel = Ease.inCubic(k) * (track.total - d.bodyLen)
                    if (d.skin.effect == Skin.Effect.FLAME && k < 0.9f) {
                        track.pointAt(max(0f, d.travel - d.cell * 0.2f), tmp)
                        d.embers.spawn(tmp[0], tmp[1], 1, d.cell * 0.25f, speed = 34f,
                            life = 0.45f, size = 3f)
                    }
                    if (k >= 1f) {
                        d.phase = 3; d.t = 0f
                        spawnExit(d, track)
                    }
                }
                else -> if (d.t > 0.75f) { buildDemo(d); d.phase = 0; d.t = 0f }
            }
            d.speed = if (dt > 0f) kotlin.math.abs(d.travel - d.prevTravel) / dt else 0f
            d.embers.step(dt); d.frost.step(dt); d.sparks.step(dt)
        }
        return true
    }

    private fun spawnExit(d: Demo, track: Track) {
        track.pointAt((d.travel + d.bodyLen).coerceAtMost(track.total), tmp)
        val x = min(tmp[0], d.bounds.right)
        val y = tmp[1]
        when (d.skin.effect) {
            Skin.Effect.FLAME -> d.embers.spawn(x, y, 14, d.cell * 0.4f, 0.5f, 0f, 180f, 0.7f, 4f)
            Skin.Effect.FROST -> d.frost.spawn(x, y, 10, d.cell * 0.5f, 110f)
            else -> d.sparks.burst(x, y, d.skin.exitParticle, 8, 170f, 0.5f, 0f, 0.7f,
                life = 0.4f, size = 4f)
        }
    }

    override fun render(c: Canvas) {
        bg.draw(c, paint)
        drawCircleButton(c, btnBack)
        Glyphs.back(c, btnBack.rect.centerX(), btnBack.rect.centerY(), dp(22f),
            iconPaint(Palette.TEXT, dp(2.6f)))
        drawText(c, "SKINS", width / 2f, insetTop + dp(50f), dp(22f), Palette.TEXT,
            Fonts.black, letterSpacing = 0.16f)
        drawText(c, "Tap a skin to equip it", width / 2f, insetTop + dp(78f), dp(12.5f),
            Palette.TEXT_DIM, Fonts.medium)

        for ((i, b) in cards.withIndex()) drawCard(c, b, demos[i], i)
    }

    private fun drawCard(c: Canvas, b: UiButton, d: Demo, index: Int) {
        val skin = d.skin
        val equipped = Skins.equipped.id == skin.id
        val r = rectTmp
        r.set(b.rect)
        val appear = Ease.outBack(((enterT * 1.5f) - index * 0.08f).coerceIn(0f, 1f))
        c.save()
        c.scale(Ease.lerp(0.85f, 1f, appear) * b.scale, Ease.lerp(0.85f, 1f, appear) * b.scale,
            r.centerX(), r.centerY())

        // card body painted in the skin's own board colours
        paint.reset(); paint.isAntiAlias = true
        paint.shader = android.graphics.LinearGradient(r.left, r.top, r.left, r.bottom,
            skin.bgTop, skin.bgBottom, android.graphics.Shader.TileMode.CLAMP)
        paint.setShadowLayer(dp(10f), 0f, dp(4f), Palette.withAlpha(0x101B3A, 46))
        c.drawRoundRect(r, dp(20f), dp(20f), paint)
        paint.clearShadowLayer(); paint.shader = null

        paint.style = Paint.Style.STROKE
        paint.strokeWidth = if (equipped) dp(2.6f) else dp(1.4f)
        paint.color = if (equipped) Palette.ACCENT else Palette.withAlpha(skin.dot, 190)
        c.drawRoundRect(r, dp(20f), dp(20f), paint)
        paint.style = Paint.Style.FILL

        c.save()
        c.clipRect(r.left + dp(2f), r.top + dp(2f), r.right - dp(2f), r.bottom - dp(2f))

        // dotted lattice in the demo area
        val dotP = fillPaint(skin.dot)
        var gx = d.bounds.left
        while (gx <= d.bounds.right) {
            var gy = d.bounds.top
            while (gy <= d.bounds.bottom) {
                c.drawCircle(gx, gy, d.cell * 0.05f, dotP)
                gy += d.cell
            }
            gx += d.cell
        }

        val track = d.track
        if (track != null && d.phase != 3) {
            val flameSkin = skin.effect == Skin.Effect.FLAME
            val trailLen = if (d.phase == 2)
                (d.speed * 0.07f).coerceIn(d.cell * 0.4f, d.cell * 3.4f) else 0f
            if (flameSkin && d.phase >= 1) {
                flame.drawBehind(c, track, d.travel, d.bodyLen, d.cell, d.igniteFront,
                    trailLen, time, d.seed)
            }
            var tail = skin.inkTail
            var head = skin.inkHead
            if (d.phase == 2 && !flameSkin) {
                tail = Palette.lerpColor(tail, skin.accent, 0.5f)
                head = Palette.lerpColor(head, skin.accent, 0.5f)
            }
            ArrowDraw.draw(c, track, d.travel, d.bodyLen, d.cell, tail, head,
                glowWidth = skin.glowWidth * d.cell, glowColor = skin.glowColor)
            if (flameSkin && d.phase >= 1) {
                flame.drawFront(c, track, d.travel, d.bodyLen, d.cell, d.igniteFront,
                    trailLen, time, d.seed)
                if (d.phase == 1) {
                    flame.drawTongue(c, track, d.travel + d.bodyLen * d.igniteFront,
                        d.cell, time)
                }
            }
        }
        d.sparks.draw(c)
        d.embers.draw(c)
        d.frost.draw(c)
        c.restore()

        drawText(c, skin.displayName.uppercase(), r.centerX(), r.top + dp(24f), dp(14f),
            skin.text, Fonts.black, letterSpacing = 0.12f)
        drawText(c, if (equipped) "EQUIPPED" else skin.tagline, r.centerX(),
            r.bottom - dp(14f), dp(10.5f),
            if (equipped) Palette.ACCENT else skin.textDim, Fonts.bold, letterSpacing = 0.1f)
        c.restore()
    }
}
