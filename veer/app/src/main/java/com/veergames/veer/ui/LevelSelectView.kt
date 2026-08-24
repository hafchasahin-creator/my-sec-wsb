package com.veergames.veer.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.view.MotionEvent
import com.veergames.veer.core.Levels
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * Level map: a scrolling grid of tiles with stars, difficulty dots and arrow
 * counts. Scrolling matters even at ten levels - on a short screen at the
 * largest display-size setting the last row and the footer fall off - and it
 * is what lets the grid grow to hundreds of levels later.
 */
class LevelSelectView(context: Context) : BaseView(context) {

    private val tiles = ArrayList<UiButton>()
    private val btnBack = UiButton("back")
    private var enterT = 0f
    private var time = 0f
    private val bg = BackgroundArrows()

    private var scrollY = 0f
    private var maxScroll = 0f
    private var flingV = 0f
    private var lastTouchY = 0f
    private var dragged = 0f
    private var contentBottom = 0f

    private var lockedShake = 0f
    private var lockedIndex = -1
    private var lockedMsg = 0f

    private val rectTmp = RectF()
    private var cachedDone = 0
    private var cachedStars = 0

    init {
        for (i in 1..Levels.all.size) tiles.add(UiButton("lvl$i"))
        ambient = true
        startAnim()
    }

    override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) {
        super.onSizeChanged(w, h, ow, oh)
        btnBack.rect.set(dp(14f), insetTop + dp(14f), dp(14f) + dp(44f), insetTop + dp(58f))
        btnBack.touchPad = dp(8f)
        val cols = 3
        val margin = min(w * 0.10f, dp(34f))
        val gap = dp(14f)
        val tile = (w - margin * 2 - gap * (cols - 1)) / cols
        val top = insetTop + dp(124f)
        for ((i, b) in tiles.withIndex()) {
            val cx = i % cols
            val cy = i / cols
            b.rect.set(margin + cx * (tile + gap), top + cy * (tile + gap),
                margin + cx * (tile + gap) + tile, top + cy * (tile + gap) + tile)
            b.enabled = true      // locked tiles still take the tap, and explain
            b.touchPad = dp(6f)
        }
        val rows = (tiles.size + cols - 1) / cols
        contentBottom = top + rows * (tile + gap) + dp(96f)
        maxScroll = max(0f, contentBottom - (h - insetBottom - dp(12f)))
        scrollY = scrollY.coerceIn(0f, maxScroll)
        bg.layout(w, h)
        refreshCounts()
    }

    private fun refreshCounts() {
        cachedDone = (1..Levels.all.size).count { act.progress.isCompleted(it) }
        cachedStars = act.progress.totalStars
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        val x = event.x
        val y = event.y
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                lastTouchY = y
                dragged = 0f
                flingV = 0f
                if (btnBack.contains(x, y)) btnBack.pressed = true
                else for (b in tiles) if (b.contains(x, y + scrollY)) b.pressed = true
                startAnim()
            }
            MotionEvent.ACTION_MOVE -> {
                val dy = y - lastTouchY
                lastTouchY = y
                dragged += abs(dy)
                if (maxScroll > 0f) {
                    scrollY = (scrollY - dy).coerceIn(0f, maxScroll)
                    flingV = -dy / 0.016f
                }
                if (dragged > dp(12f)) {
                    btnBack.pressed = false
                    for (b in tiles) b.pressed = false
                }
                startAnim()
            }
            MotionEvent.ACTION_UP -> {
                if (dragged <= dp(12f)) {
                    if (btnBack.pressed && btnBack.contains(x, y)) {
                        act.sound.back(); act.haptics.buttonTick(); act.showMenu()
                    } else {
                        for ((i, b) in tiles.withIndex()) {
                            if (b.pressed && b.contains(x, y + scrollY)) openLevel(i + 1, i)
                        }
                    }
                } else {
                    flingV = flingV.coerceIn(-4200f, 4200f)
                }
                btnBack.pressed = false
                for (b in tiles) b.pressed = false
                startAnim()
            }
            MotionEvent.ACTION_CANCEL -> {
                btnBack.pressed = false
                for (b in tiles) b.pressed = false
                startAnim()
            }
        }
        return true
    }

    private fun openLevel(level: Int, index: Int) {
        if (act.progress.isUnlocked(level)) {
            act.sound.tap(); act.haptics.buttonTick()
            act.showLevel(level)
        } else {
            // a locked tile explains itself rather than swallowing the tap
            act.sound.blocked(); act.haptics.blocked()
            lockedIndex = index
            lockedShake = 1f
            lockedMsg = 1.8f
            startAnim()
        }
    }

    override fun step(dt: Float): Boolean {
        time += dt
        var busy = false
        if (enterT < 1f) { enterT = min(1f, enterT + dt * 2.2f); busy = true }
        for (b in tiles) if (b.step(dt)) busy = true
        if (btnBack.step(dt)) busy = true
        if (lockedShake > 0f) { lockedShake = max(0f, lockedShake - dt * 3.4f); busy = true }
        if (lockedMsg > 0f) { lockedMsg = max(0f, lockedMsg - dt); busy = true }
        if (abs(flingV) > 8f && maxScroll > 0f) {
            scrollY = (scrollY + flingV * dt).coerceIn(0f, maxScroll)
            flingV *= 0.90f
            if (scrollY <= 0f || scrollY >= maxScroll) flingV = 0f
            busy = true
        } else flingV = 0f
        if (bg.step(dt)) busy = true
        return busy
    }

    override fun render(c: Canvas) {
        bg.draw(c, paint)

        c.save()
        c.translate(0f, -scrollY)
        for ((i, b) in tiles.withIndex()) {
            val appear = ((enterT * 1.6f) - i * 0.05f).coerceIn(0f, 1f)
            if (appear > 0f) drawTile(c, b, i + 1, appear, i)
        }
        drawFooterStats(c)
        c.restore()

        // header sits above the scrolling content
        drawBackdrop(c)
        drawCircleButton(c, btnBack)
        Glyphs.back(c, btnBack.rect.centerX(), btnBack.rect.centerY(), dp(22f),
            iconPaint(Palette.TEXT, dp(2.6f)))
        drawText(c, "LEVEL SELECT", width / 2f, insetTop + dp(48f), dp(21f),
            Palette.TEXT, Fonts.black, letterSpacing = 0.14f)
        drawText(c, "$cachedDone of ${Levels.all.size} cleared  ·  $cachedStars★",
            width / 2f, insetTop + dp(74f), dp(12f), Palette.TEXT_DIM, Fonts.medium)

        if (lockedMsg > 0f && lockedIndex >= 0) {
            val a = (255 * min(1f, lockedMsg)).toInt()
            drawText(c, "Clear level ${lockedIndex} first", width / 2f,
                height - insetBottom - dp(28f), dp(13.5f),
                Palette.withAlpha(Palette.DANGER, a), Fonts.bold)
        }
    }

    /** Solid band behind the header so tiles do not scroll into the title. */
    private fun drawBackdrop(c: Canvas) {
        paint.reset(); paint.isAntiAlias = true
        paint.shader = android.graphics.LinearGradient(0f, 0f, 0f, insetTop + dp(96f),
            Palette.BG_TOP, Palette.withAlpha(Palette.BG_TOP, 0),
            android.graphics.Shader.TileMode.CLAMP)
        c.drawRect(0f, 0f, width.toFloat(), insetTop + dp(96f), paint)
        paint.shader = null
    }

    private fun drawFooterStats(c: Canvas) {
        val last = tiles.last().rect
        rectTmp.set(tiles.first().rect.left, last.bottom + dp(18f),
            tiles.last().rect.right, last.bottom + dp(18f) + dp(66f))
        drawCard(c, rectTmp, dp(18f), Palette.CARD, Palette.CARD_EDGE, 16)
        drawText(c, "MORE LEVELS COMING SOON", rectTmp.centerX(),
            rectTmp.top + dp(26f), dp(11.5f), Palette.TEXT_DIM, Fonts.black,
            letterSpacing = 0.14f)
        val barW = rectTmp.width() - dp(48f)
        val prog = cachedStars / (Levels.all.size * 3f)
        rectTmp.set(rectTmp.centerX() - barW / 2, rectTmp.top + dp(40f),
            rectTmp.centerX() + barW / 2, rectTmp.top + dp(46f))
        drawCard(c, rectTmp, dp(3f), Palette.withAlpha(Palette.TEXT_DIM, 46), 0, 0)
        if (prog > 0f) {
            rectTmp.right = rectTmp.left + barW * prog
            drawCard(c, rectTmp, dp(3f), Palette.GOLD, 0, 0)
        }
    }

    private fun drawTile(c: Canvas, b: UiButton, n: Int, appear: Float, index: Int) {
        val unlocked = act.progress.isUnlocked(n)
        val completed = act.progress.isCompleted(n)
        val isCurrent = unlocked && !completed
        rectTmp.set(b.rect)
        val a = Ease.outBack(appear)
        val shake = if (index == lockedIndex && lockedShake > 0f)
            sinShake(lockedShake) * dp(6f) else 0f
        c.save()
        c.translate(shake, 0f)
        c.scale(Ease.lerp(0.8f, 1f, a) * b.scale, Ease.lerp(0.8f, 1f, a) * b.scale,
            rectTmp.centerX(), rectTmp.centerY())
        val alpha = (255 * appear).toInt()

        if (isCurrent) {
            val pulse = 0.5f + 0.5f * kotlin.math.sin(time * 3.1f)
            paint.reset(); paint.isAntiAlias = true
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = dp(2.5f)
            paint.color = Palette.withAlpha(Palette.ACCENT, (alpha * (0.45f + 0.4f * pulse)).toInt())
            val g = RectF(rectTmp)
            g.inset(-dp(4f) * pulse, -dp(4f) * pulse)
            c.drawRoundRect(g, dp(22f), dp(22f), paint)
        }

        drawCard(c, rectTmp, dp(20f),
            Palette.withAlpha(if (unlocked) Palette.CARD else Palette.chipDim(), alpha),
            if (isCurrent) Palette.ACCENT else Palette.CARD_EDGE, if (unlocked) 26 else 0)

        if (!unlocked) {
            Glyphs.lock(c, rectTmp.centerX(), rectTmp.centerY(), rectTmp.width() * 0.40f,
                iconPaint(Palette.withAlpha(Palette.TEXT_DIM, alpha), dp(3f)),
                fillPaint(Palette.withAlpha(Palette.TEXT_DIM, alpha)))
        } else {
            drawText(c, "$n", rectTmp.centerX(), rectTmp.centerY() + rectTmp.height() * 0.02f,
                rectTmp.height() * 0.32f,
                Palette.withAlpha(if (isCurrent) Palette.ACCENT else Palette.TEXT, alpha),
                Fonts.black)
            // difficulty dot + arrow count: the ramp is legible before entering
            val spec = Levels.all[n - 1]
            val dotC = when (spec.difficulty) {
                com.veergames.veer.core.Difficulty.EASY -> Palette.ACCENT2
                com.veergames.veer.core.Difficulty.NORMAL -> Palette.ACCENT
                com.veergames.veer.core.Difficulty.HARD -> Palette.GOLD
                else -> Palette.HEART
            }
            c.drawCircle(rectTmp.left + dp(13f), rectTmp.top + dp(13f), dp(3.5f),
                fillPaint(Palette.withAlpha(dotC, alpha)))
            drawText(c, "${spec.arrows.size}", rectTmp.right - dp(13f), rectTmp.top + dp(17f),
                dp(10f), Palette.withAlpha(Palette.TEXT_DIM, alpha), Fonts.bold,
                Paint.Align.RIGHT)

            val sw = rectTmp.width() * 0.17f
            val sy = rectTmp.bottom - rectTmp.height() * 0.19f
            for (i in 0 until 3) {
                val on = i < act.progress.stars(n)
                Glyphs.star(c, rectTmp.centerX() + (i - 1) * sw * 0.95f, sy, sw,
                    fillPaint(Palette.withAlpha(
                        if (on) Palette.GOLD else Palette.withAlpha(Palette.TEXT_DIM, 70), alpha)))
            }
        }
        c.restore()
    }

    private fun sinShake(t: Float): Float = kotlin.math.sin(t * 26f) * t
}
