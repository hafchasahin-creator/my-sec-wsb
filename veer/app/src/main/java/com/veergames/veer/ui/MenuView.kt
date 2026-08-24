package com.veergames.veer.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.view.MotionEvent
import com.veergames.veer.core.Levels
import kotlin.math.max
import kotlin.math.min

/**
 * Main menu: logo, primary actions, and a background of slow-moving
 * arrow paths that drift and loop behind the card stack.
 */
class MenuView(context: Context) : BaseView(context) {

    private val btnPlay = UiButton("play")
    private val btnLevels = UiButton("levels")
    private val btnSkins = UiButton("skins")
    private val btnDaily = UiButton("daily").apply { enabled = false }
    private val btnSettings = UiButton("settings")
    private val buttons = listOf(btnPlay, btnLevels, btnSkins, btnDaily, btnSettings)

    private var settingsOpen = false
    private var settingsT = 0f
    private val btnSound = UiButton("sound")
    private val btnMusic = UiButton("music")
    private val btnHaptics = UiButton("haptics")
    private val btnReset = UiButton("reset")
    private val btnClose = UiButton("close")
    private val settingsButtons = listOf(btnSound, btnMusic, btnHaptics, btnReset, btnClose)

    private var time = 0f
    private var enterT = 0f
    private val bg = BackgroundArrows()

    init { ambient = true; startAnim() }

    override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) {
        super.onSizeChanged(w, h, ow, oh)
        val bw = min(w * 0.74f, dp(320f))
        val bh = dp(58f)
        val gap = dp(11f)
        // keep the whole stack inside the lower half, whatever the aspect ratio
        val stackH = bh * 5 + gap * 4
        var y = max(h * 0.47f, min(h * 0.52f, h - insetBottom - dp(56f) - stackH))
        for (b in listOf(btnPlay, btnLevels, btnSkins, btnDaily, btnSettings)) {
            b.rect.set((w - bw) / 2f, y, (w + bw) / 2f, y + bh)
            y += bh + gap
        }
        val pw = min(w * 0.84f, dp(360f))
        val panel = RectF((w - pw) / 2f, h * 0.26f, (w + pw) / 2f, h * 0.74f)
        val tw = dp(58f); val th = dp(34f)
        val tx = panel.right - dp(30f) - tw
        btnSound.rect.set(tx, panel.top + dp(96f), tx + tw, panel.top + dp(96f) + th)
        btnMusic.rect.set(tx, panel.top + dp(148f), tx + tw, panel.top + dp(148f) + th)
        btnHaptics.rect.set(tx, panel.top + dp(200f), tx + tw, panel.top + dp(200f) + th)
        btnReset.rect.set(panel.left + dp(30f), panel.bottom - dp(76f),
            panel.right - dp(30f), panel.bottom - dp(76f) + dp(48f))
        btnClose.rect.set(panel.right - dp(52f), panel.top + dp(16f),
            panel.right - dp(16f), panel.top + dp(52f))
        bg.layout(w, h)
    }

    private fun active(): List<UiButton> = if (settingsOpen) settingsButtons else buttons

    /** Back closes the settings sheet before it leaves the menu. */
    fun handleBack(): Boolean {
        if (settingsOpen) { settingsOpen = false; settingsT = 0f; startAnim(); return true }
        return false
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        val x = event.x; val y = event.y
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                for (b in active()) if (b.contains(x, y)) { b.pressed = true; startAnim() }
            }
            MotionEvent.ACTION_UP -> {
                for (b in active()) {
                    if (b.pressed && b.contains(x, y)) onButton(b)
                    b.pressed = false
                }
                startAnim()
            }
            MotionEvent.ACTION_CANCEL -> {
                for (b in active()) b.pressed = false
                startAnim()
            }
        }
        return true
    }

    private fun onButton(b: UiButton) {
        act.sound.tap(); act.haptics.buttonTick()
        when (b.id) {
            "play" -> act.showLevel(act.progress.unlockedUpTo())
            "levels" -> act.showLevelSelect()
            "skins" -> act.showSkins()
            "settings" -> { settingsOpen = true; settingsT = 0f }
            "close" -> { settingsOpen = false; settingsT = 0f }
            "sound" -> act.settings.sound = !act.settings.sound
            "music" -> { act.settings.music = !act.settings.music; act.sound.updateMusic() }
            "haptics" -> act.settings.haptics = !act.settings.haptics
            "reset" -> act.progress.resetAll()
        }
        startAnim()
    }

    override fun step(dt: Float): Boolean {
        time += dt
        var busy = false
        if (enterT < 1f) { enterT = min(1f, enterT + dt * 1.8f); busy = true }
        if (settingsT < 1f) { settingsT = min(1f, settingsT + dt * 3.4f); busy = true }
        for (b in buttons + settingsButtons) if (b.step(dt)) busy = true
        if (bg.step(dt)) busy = true
        // the logo breathes, so keep a slow heartbeat rather than a 60 Hz spin
        return busy
    }

    override fun render(c: Canvas) {
        bg.draw(c, paint)

        val cx = width / 2f
        val logoY = height * 0.235f
        val unit = min(width, height).toFloat()
        val e = Ease.outCubic(enterT)

        LogoMark.draw(c, cx, logoY, unit * 0.20f, alpha = (255 * e).toInt(),
            progress = 1f, glow = 0.5f + 0.25f * kotlin.math.sin(time * 1.6f))

        drawText(c, "VEERPATH", cx, logoY + unit * 0.175f, dp(32f),
            Palette.withAlpha(Palette.TEXT, (255 * e).toInt()), Fonts.black, letterSpacing = 0.2f)
        drawText(c, "ESCAPE THE GRIDLOCK", cx, logoY + unit * 0.215f, dp(11f),
            Palette.withAlpha(Palette.TEXT_DIM, (200 * e).toInt()), Fonts.bold, letterSpacing = 0.3f)

        val done = (1..Levels.all.size).count { act.progress.isCompleted(it) }
        drawPillButton(c, btnPlay,
            if (done == 0) "PLAY" else "CONTINUE  ·  LEVEL ${act.progress.unlockedUpTo()}",
            dp(17f), true)
        drawPillButton(c, btnLevels, "LEVEL SELECT", dp(15f), false)
        drawSkinsButton(c)
        drawDailyButton(c)
        drawPillButton(c, btnSettings, "SETTINGS", dp(15f), false)

        drawText(c, "$done / ${Levels.all.size} levels cleared", cx,
            btnSettings.rect.bottom + dp(28f), dp(12f), Palette.TEXT_DIM, Fonts.medium)

        if (settingsOpen) drawSettings(c)
    }

    /** SKINS row carries a swatch of the equipped skin so it reads at a glance. */
    private fun drawSkinsButton(c: Canvas) {
        val r = RectF(btnSkins.rect)
        c.save()
        c.scale(btnSkins.scale, btnSkins.scale, r.centerX(), r.centerY())
        drawCard(c, r, r.height() / 2f, Palette.CARD, Palette.CARD_EDGE, 18)
        val skin = Skins.equipped
        val sw = r.height() * 0.42f
        val sx = r.left + dp(26f)
        paint.reset(); paint.isAntiAlias = true
        paint.shader = android.graphics.LinearGradient(sx - sw / 2, r.centerY() - sw / 2,
            sx + sw / 2, r.centerY() + sw / 2, skin.inkTail, skin.inkHead,
            android.graphics.Shader.TileMode.CLAMP)
        c.drawCircle(sx, r.centerY(), sw / 2, paint)
        paint.shader = null
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = dp(1.6f)
        paint.color = Palette.CARD_EDGE
        c.drawCircle(sx, r.centerY(), sw / 2, paint)
        paint.style = Paint.Style.FILL
        val p = textPaint(dp(15f), Palette.TEXT, Fonts.black)
        p.letterSpacing = 0.06f
        c.drawText("SKINS", r.centerX() + dp(10f), r.centerY() + dp(5.4f), p)
        drawText(c, skin.displayName.uppercase(), r.right - dp(24f), r.centerY() + dp(4.6f),
            dp(11f), Palette.ACCENT, Fonts.bold, Paint.Align.RIGHT, letterSpacing = 0.1f)
        c.restore()
    }

    private fun drawDailyButton(c: Canvas) {
        val r = RectF(btnDaily.rect)
        drawCard(c, r, r.height() / 2f, Palette.withAlpha(Palette.CARD, 150),
            Palette.CARD_EDGE, 0)
        drawText(c, "DAILY CHALLENGE", r.centerX(), r.centerY() - dp(1f), dp(14f),
            Palette.TEXT_DIM, Fonts.black, letterSpacing = 0.05f)
        drawText(c, "COMING SOON", r.centerX(), r.centerY() + dp(14f), dp(9.5f),
            Palette.withAlpha(Palette.ACCENT, 200), Fonts.bold, letterSpacing = 0.18f)
    }

    private fun drawSettings(c: Canvas) {
        val a = Ease.outCubic(settingsT)
        c.drawColor(Palette.withAlpha(0x0B1230, (140 * a).toInt()))
        val pw = min(width * 0.84f, dp(360f))
        val panel = RectF((width - pw) / 2f, height * 0.26f, (width + pw) / 2f, height * 0.74f)
        c.save()
        c.scale(Ease.lerp(0.94f, 1f, a), Ease.lerp(0.94f, 1f, a), panel.centerX(), panel.centerY())
        drawCard(c, panel, dp(26f), Palette.CARD, Palette.CARD_EDGE, 44, dp(10f), dp(22f))
        drawText(c, "SETTINGS", panel.centerX(), panel.top + dp(52f), dp(20f),
            Palette.TEXT, Fonts.black, letterSpacing = 0.12f)

        row(c, panel, btnSound, "Sound", act.settings.sound, 0)
        row(c, panel, btnMusic, "Music", act.settings.music, 1)
        row(c, panel, btnHaptics, "Haptics", act.settings.haptics, 2)

        drawPillButton(c, btnReset, "RESET PROGRESS", dp(14f), false)
        drawCircleButton(c, btnClose)
        Glyphs.close(c, btnClose.rect.centerX(), btnClose.rect.centerY(), dp(20f),
            iconPaint(Palette.TEXT_DIM, dp(2.4f)))
        c.restore()
    }

    private fun row(c: Canvas, panel: RectF, b: UiButton, label: String, on: Boolean, idx: Int) {
        val y = b.rect.centerY()
        val ip = iconPaint(Palette.TEXT, dp(2.2f))
        val fp = fillPaint(Palette.TEXT)
        val ix = panel.left + dp(40f)
        when (idx) {
            0 -> Glyphs.speaker(c, ix, y, dp(24f), ip, fp)
            1 -> Glyphs.note(c, ix, y, dp(24f), ip, fp)
            else -> Glyphs.vibrate(c, ix, y, dp(24f), ip)
        }
        drawText(c, label, ix + dp(26f), y + dp(6f), dp(16f), Palette.TEXT, Fonts.bold,
            Paint.Align.LEFT)
        val r = RectF(b.rect)
        val radius = r.height() / 2f
        paint.reset(); paint.isAntiAlias = true
        paint.color = if (on) Palette.ACCENT else 0xFFDCE3F2.toInt()
        c.drawRoundRect(r, radius, radius, paint)
        paint.color = 0xFFFFFFFF.toInt()
        paint.setShadowLayer(6f, 0f, 2f, Palette.withAlpha(0x101B3A, 60))
        c.drawCircle(if (on) r.right - radius else r.left + radius, r.centerY(),
            r.height() * 0.38f, paint)
        paint.clearShadowLayer()
    }
}

/** Slow ambient arrow paths drifting behind menu screens. */
class BackgroundArrows {

    private class Streak(
        var x: Float, var y: Float, val dirX: Float, val dirY: Float,
        val len: Float, val speed: Float, val bend: Float, val thickness: Float,
        val alpha: Int,
    ) {
        val corner: android.graphics.CornerPathEffect =
            android.graphics.CornerPathEffect(thickness * 2.4f)
    }

    private val streaks = ArrayList<Streak>()
    private val path = Path()
    private var w = 0
    private var h = 0

    fun layout(width: Int, height: Int) {
        w = width; h = height
        streaks.clear()
        val unit = min(width, height).toFloat()
        val rnd = java.util.Random(7)
        repeat(9) {
            val horizontal = rnd.nextBoolean()
            val dirX = if (horizontal) (if (rnd.nextBoolean()) 1f else -1f) else 0f
            val dirY = if (horizontal) 0f else (if (rnd.nextBoolean()) 1f else -1f)
            streaks.add(Streak(
                x = rnd.nextFloat() * width,
                y = rnd.nextFloat() * height,
                dirX = dirX, dirY = dirY,
                len = unit * (0.16f + rnd.nextFloat() * 0.28f),
                speed = unit * (0.012f + rnd.nextFloat() * 0.03f),
                bend = if (rnd.nextBoolean()) 1f else -1f,
                thickness = unit * (0.008f + rnd.nextFloat() * 0.008f),
                alpha = 16 + rnd.nextInt(16),
            ))
        }
    }

    private var acc = 0f

    /** Returns true when the ambient drift actually moved. Stepping at 30 Hz
     *  is indistinguishable at these speeds and halves the repaint cost. */
    fun step(dt: Float): Boolean {
        acc += dt
        if (acc < 1f / 30f) return false
        val step = acc
        acc = 0f
        for (s in streaks) {
            s.x += s.dirX * s.speed * step * 60f * 0.1f
            s.y += s.dirY * s.speed * step * 60f * 0.1f
            val m = s.len * 2f
            if (s.x < -m) s.x = w + m
            if (s.x > w + m) s.x = -m
            if (s.y < -m) s.y = h + m
            if (s.y > h + m) s.y = -m
        }
        return true
    }

    fun draw(c: Canvas, paint: Paint) {
        paint.reset(); paint.isAntiAlias = true
        paint.style = Paint.Style.STROKE
        paint.strokeCap = Paint.Cap.ROUND
        paint.strokeJoin = Paint.Join.ROUND
        for (s in streaks) {
            path.rewind()
            val half = s.len / 2f
            // an L-shaped path: straight run then a 90-degree turn
            if (s.dirX != 0f) {
                path.moveTo(s.x - s.dirX * half, s.y)
                path.lineTo(s.x + s.dirX * half * 0.45f, s.y)
                path.lineTo(s.x + s.dirX * half * 0.45f, s.y + s.bend * half * 0.6f)
            } else {
                path.moveTo(s.x, s.y - s.dirY * half)
                path.lineTo(s.x, s.y + s.dirY * half * 0.45f)
                path.lineTo(s.x + s.bend * half * 0.6f, s.y + s.dirY * half * 0.45f)
            }
            paint.pathEffect = s.corner
            paint.strokeWidth = s.thickness
            paint.color = Palette.withAlpha(Palette.INK, s.alpha)
            c.drawPath(path, paint)
        }
        paint.pathEffect = null
    }
}
