package com.veergames.veer.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.view.MotionEvent
import com.veergames.veer.core.Levels
import kotlin.math.min

/** 10-level grid with stars, lock states and a "more coming" footer card. */
class LevelSelectView(context: Context) : BaseView(context) {

    private val tiles = ArrayList<UiButton>()
    private val btnBack = UiButton("back")
    private var enterT = 0f
    private var time = 0f
    private val bg = BackgroundArrows()

    init {
        for (i in 1..Levels.all.size) tiles.add(UiButton("lvl$i"))
        startAnim()
    }

    override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) {
        super.onSizeChanged(w, h, ow, oh)
        btnBack.rect.set(dp(16f), insetTop + dp(14f), dp(16f) + dp(44f), insetTop + dp(58f))
        val cols = 3
        val margin = min(w * 0.10f, dp(38f))
        val gap = dp(14f)
        val tile = (w - margin * 2 - gap * (cols - 1)) / cols
        val top = insetTop + dp(132f)
        for ((i, b) in tiles.withIndex()) {
            val cx = i % cols
            val cy = i / cols
            val x = margin + cx * (tile + gap)
            val y = top + cy * (tile + gap)
            b.rect.set(x, y, x + tile, y + tile)
            b.enabled = act.progress.isUnlocked(i + 1)
        }
        bg.layout(w, h)
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        val x = event.x; val y = event.y
        val all = tiles + btnBack
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN ->
                for (b in all) if (b.contains(x, y)) { b.pressed = true; startAnim() }
            MotionEvent.ACTION_UP -> {
                for (b in all) {
                    if (b.pressed && b.contains(x, y)) {
                        act.sound.tap(); act.haptics.buttonTick()
                        if (b.id == "back") act.showMenu()
                        else act.showLevel(b.id.removePrefix("lvl").toInt())
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
        for (b in tiles) b.step(dt)
        btnBack.step(dt)
        bg.step(dt)
        return true
    }

    override fun render(c: Canvas) {
        bg.draw(c, paint)
        drawCircleButton(c, btnBack)
        Glyphs.back(c, btnBack.rect.centerX(), btnBack.rect.centerY(), dp(22f),
            iconPaint(Palette.TEXT, dp(2.6f)))

        drawText(c, "LEVEL SELECT", width / 2f, insetTop + dp(52f), dp(22f),
            Palette.TEXT, Fonts.black, letterSpacing = 0.14f)
        val done = (1..Levels.all.size).count { act.progress.isCompleted(it) }
        val totalStars = (1..Levels.all.size).sumOf { act.progress.stars(it) }
        drawText(c, "$done of ${Levels.all.size} cleared  ·  $totalStars★",
            width / 2f, insetTop + dp(80f), dp(12.5f), Palette.TEXT_DIM, Fonts.medium)

        for ((i, b) in tiles.withIndex()) {
            val n = i + 1
            val appear = ((enterT * 1.6f) - i * 0.06f).coerceIn(0f, 1f)
            if (appear <= 0f) continue
            drawTile(c, b, n, appear)
        }

        val last = tiles.last().rect
        val card = RectF(tiles.first().rect.left, last.bottom + dp(20f),
            tiles.last().rect.right, last.bottom + dp(20f) + dp(64f))
        drawCard(c, card, dp(18f), 0xFFF3F6FD.toInt(), Palette.CARD_EDGE, 0)
        drawText(c, "MORE LEVELS COMING SOON", card.centerX(), card.centerY() + dp(5f),
            dp(12.5f), Palette.TEXT_DIM, Fonts.black, letterSpacing = 0.14f)
    }

    private fun drawTile(c: Canvas, b: UiButton, n: Int, appear: Float) {
        val unlocked = act.progress.isUnlocked(n)
        val completed = act.progress.isCompleted(n)
        val isCurrent = unlocked && !completed
        val r = RectF(b.rect)
        val a = Ease.outBack(appear)
        c.save()
        c.scale(Ease.lerp(0.8f, 1f, a) * b.scale, Ease.lerp(0.8f, 1f, a) * b.scale,
            r.centerX(), r.centerY())
        val alpha = (255 * appear).toInt()

        if (isCurrent) {
            val pulse = 0.5f + 0.5f * kotlin.math.sin(time * 3.1f)
            paint.reset(); paint.isAntiAlias = true
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = dp(2.5f)
            paint.color = Palette.withAlpha(Palette.ACCENT, (alpha * (0.45f + 0.4f * pulse)).toInt())
            val g = RectF(r); g.inset(-dp(4f) * pulse, -dp(4f) * pulse)
            c.drawRoundRect(g, dp(22f), dp(22f), paint)
        }

        val fill = when {
            !unlocked -> 0xFFEFF2FA.toInt()
            completed -> Palette.CARD
            else -> Palette.CARD
        }
        drawCard(c, r, dp(20f), Palette.withAlpha(fill, alpha),
            if (isCurrent) Palette.ACCENT else Palette.CARD_EDGE, if (unlocked) 26 else 0)

        if (!unlocked) {
            Glyphs.lock(c, r.centerX(), r.centerY(), r.width() * 0.42f,
                iconPaint(Palette.withAlpha(0xFFB6C0D8.toInt(), alpha), dp(3f)),
                fillPaint(Palette.withAlpha(0xFFB6C0D8.toInt(), alpha)))
        } else {
            drawText(c, "$n", r.centerX(), r.centerY() + r.height() * 0.06f,
                r.height() * 0.34f,
                Palette.withAlpha(if (isCurrent) Palette.ACCENT else Palette.TEXT, alpha),
                Fonts.black)
            val sw = r.width() * 0.17f
            val sy = r.bottom - r.height() * 0.18f
            for (i in 0 until 3) {
                val sx = r.centerX() + (i - 1) * sw * 0.95f
                val on = i < act.progress.stars(n)
                Glyphs.star(c, sx, sy, sw,
                    fillPaint(Palette.withAlpha(
                        if (on) Palette.GOLD else 0xFFDDE3F0.toInt(), alpha)))
            }
        }
        c.restore()
    }
}
