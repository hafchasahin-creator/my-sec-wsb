package com.veergames.veer.ui

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.view.MotionEvent
import com.veergames.veer.MainActivity
import com.veergames.veer.core.ArrowPath
import com.veergames.veer.core.BoardLogic
import com.veergames.veer.core.GameController
import com.veergames.veer.core.Levels
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/**
 * The puzzle screen: board rendering, hit-testing, escape/blocked
 * animation, hearts, hints, tutorial and result overlays.
 *
 * Puzzle logic lives in [GameController]; this view never decides
 * legality on its own - it asks, then animates the answer.
 */
@SuppressLint("ViewConstructor")
class GameView(context: Context, private val levelNum: Int) : BaseView(context) {

    private enum class Phase { PLAY, PAUSED, COMPLETE, FAILED }

    private val spec = Levels.all[levelNum - 1]
    private var game = GameController(spec)
    private var phase = Phase.PLAY

    // board geometry
    private var cell = 40f
    private var originX = 0f
    private var originY = 0f
    private val boardRect = RectF()

    // per-arrow visual state
    private class Vis {
        var track: Track? = null
        var bodyLen = 0f
        var travel = 0f          // arclength of tail along track
        var escaping = false
        var escapeT = 0f         // 0..1
        var escapeDur = 0.42f
        var anticip = 0f         // 0..1 pull-back before launch
        var gone = false
        var blockedFlash = 0f    // 1 -> 0
        var shake = 0f           // 1 -> 0
        var selectGlow = 0f      // 1 -> 0
        var hintGlow = 0f        // pulsing while > 0
        var trail = 0f           // 0..1 trail opacity
    }

    private val vis = HashMap<Int, Vis>()
    private val particles = Particles()

    // UI buttons
    private val btnBack = UiButton("back")
    private val btnPause = UiButton("pause")
    private val btnHint = UiButton("hint")
    private val btnRestart = UiButton("restart")
    private val btnPrimary = UiButton("primary")   // next / retry
    private val btnSecondary = UiButton("secondary") // menu / levels
    private val btnResume = UiButton("resume")
    private val btnPauseRestart = UiButton("restart")
    private val btnPauseMenu = UiButton("menu")
    private val btnSound = UiButton("sound")
    private val btnMusic = UiButton("music")
    private val btnHaptics = UiButton("haptics")
    private val allButtons = listOf(btnBack, btnPause, btnHint, btnRestart, btnPrimary,
        btnSecondary, btnResume, btnPauseRestart, btnPauseMenu, btnSound, btnMusic, btnHaptics)

    // overlays / effects
    private var overlayT = 0f          // 0..1 result overlay reveal
    private var slowMo = 0f            // 1 -> 0 slow-motion after final escape
    private var boardGlow = 0f
    private var heartLost = -1
    private var heartPulse = 0f
    private var comboCount = 0
    private var starsShown = 0
    private var starTimer = 0f
    private var shakeScreen = 0f

    // tutorial
    private var tutorialStage = if (levelNum == 1 && !act.progress.tutorialSeen) 1 else 0
    private var tutorialT = 0f
    private var tutorialTargetId = -1
    private var tutorialBannerT = 0f

    private var hintTarget = -1
    private var pressedArrow = -1
    private var downX = 0f
    private var downY = 0f
    private var downTime = 0L

    private val tmpPt = FloatArray(4)
    private val trailPath = Path()

    init {
        startAnim()
    }

    // ---------- layout ----------

    override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) {
        super.onSizeChanged(w, h, ow, oh)
        layoutBoard(w, h)
    }

    private fun layoutBoard(w: Int, h: Int) {
        if (w == 0 || h == 0) return
        val top = insetTop + dp(6f)
        val headerH = dp(112f)
        val footerH = dp(96f)
        val bottom = h - insetBottom - dp(8f)
        val availTop = top + headerH
        val availBottom = bottom - footerH
        val availW = w - dp(24f) * 2
        val availH = max(dp(120f), availBottom - availTop)
        // cells span (cols-1) gaps; add 1 cell of breathing room around
        cell = min(availW / (spec.cols - 1 + 1.35f), availH / (spec.rows - 1 + 1.35f))
        val boardW = (spec.cols - 1) * cell
        val boardH = (spec.rows - 1) * cell
        originX = (w - boardW) / 2f
        originY = availTop + (availH - boardH) / 2f
        boardRect.set(originX - cell * 0.7f, originY - cell * 0.7f,
            originX + boardW + cell * 0.7f, originY + boardH + cell * 0.7f)
        buildTracks()
        layoutButtons(w, h, top, bottom)
    }

    private fun layoutButtons(w: Int, h: Int, top: Float, bottom: Float) {
        val icon = dp(44f)
        btnBack.rect.set(dp(16f), top + dp(4f), dp(16f) + icon, top + dp(4f) + icon)
        btnPause.rect.set(w - dp(16f) - icon, top + dp(4f), w - dp(16f), top + dp(4f) + icon)

        val big = dp(62f)
        val cy = bottom - big / 2f - dp(6f)
        val gap = dp(28f)
        btnHint.rect.set(w / 2f - big - gap / 2f, cy - big / 2f, w / 2f - gap / 2f, cy + big / 2f)
        btnRestart.rect.set(w / 2f + gap / 2f, cy - big / 2f, w / 2f + gap / 2f + big, cy + big / 2f)

        val bw = min(w * 0.68f, dp(300f))
        val bh = dp(58f)
        btnPrimary.rect.set((w - bw) / 2f, h * 0.66f, (w + bw) / 2f, h * 0.66f + bh)
        btnSecondary.rect.set((w - bw) / 2f, h * 0.66f + bh + dp(14f),
            (w + bw) / 2f, h * 0.66f + bh * 2 + dp(14f))
        btnResume.rect.set((w - bw) / 2f, h * 0.52f, (w + bw) / 2f, h * 0.52f + bh)

        val tw = dp(58f); val th = dp(34f)
        val sx = w / 2f + dp(58f)
        btnSound.rect.set(sx, h * 0.30f, sx + tw, h * 0.30f + th)
        btnMusic.rect.set(sx, h * 0.30f + dp(52f), sx + tw, h * 0.30f + dp(52f) + th)
        btnHaptics.rect.set(sx, h * 0.30f + dp(104f), sx + tw, h * 0.30f + dp(104f) + th)
    }

    private fun px(gx: Int): Float = originX + gx * cell
    private fun py(gy: Int): Float = originY + gy * cell

    /** Build each arrow's track: its own polyline + straight exit ray. */
    private fun buildTracks() {
        vis.clear()
        val diag = hypot(width.toFloat(), height.toFloat())
        for (a in spec.arrows) {
            val n = a.pts.size
            val xs = FloatArray(n + 1)
            val ys = FloatArray(n + 1)
            for (i in 0 until n) {
                xs[i] = px(a.pts[i].first)
                ys[i] = py(a.pts[i].second)
            }
            val ext = diag + cell * 4f
            xs[n] = xs[n - 1] + a.headDir.dx * ext
            ys[n] = ys[n - 1] + a.headDir.dy * ext
            val v = Vis()
            v.track = Track(xs, ys)
            v.bodyLen = a.bodyLen * cell
            vis[a.id] = v
        }
    }

    // ---------- input ----------

    override fun onTouchEvent(event: MotionEvent): Boolean {
        val x = event.x
        val y = event.y
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downX = x; downY = y; downTime = System.currentTimeMillis()
                for (b in activeButtons()) if (b.contains(x, y)) { b.pressed = true; startAnim(); return true }
                if (phase == Phase.PLAY) {
                    val id = hitArrow(x, y)
                    if (id >= 0) {
                        pressedArrow = id
                        vis[id]?.selectGlow = 1f
                        startAnim()
                    }
                }
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                val moved = hypot(x - downX, y - downY) > dp(24f)
                if (moved) {
                    for (b in allButtons) b.pressed = false
                    if (pressedArrow >= 0) { vis[pressedArrow]?.selectGlow = 0f; pressedArrow = -1 }
                    startAnim()
                }
                return true
            }
            MotionEvent.ACTION_UP -> {
                var consumed = false
                for (b in activeButtons()) {
                    if (b.pressed && b.contains(x, y)) { onButton(b); consumed = true }
                    b.pressed = false
                }
                if (!consumed && pressedArrow >= 0 && phase == Phase.PLAY) {
                    val id = hitArrow(x, y)
                    if (id == pressedArrow) tapArrow(id)
                }
                pressedArrow = -1
                startAnim()
                return true
            }
            MotionEvent.ACTION_CANCEL -> {
                for (b in allButtons) b.pressed = false
                if (pressedArrow >= 0) vis[pressedArrow]?.selectGlow = 0f
                pressedArrow = -1
                startAnim()
                return true
            }
        }
        return super.onTouchEvent(event)
    }

    private fun activeButtons(): List<UiButton> = when (phase) {
        Phase.PLAY -> listOf(btnBack, btnPause, btnHint, btnRestart)
        Phase.PAUSED -> listOf(btnResume, btnPauseRestart, btnPauseMenu, btnSound, btnMusic, btnHaptics)
        Phase.COMPLETE, Phase.FAILED ->
            if (overlayT > 0.85f) listOf(btnPrimary, btnSecondary) else emptyList()
    }

    /** Nearest arrow whose body is within a comfortable touch radius. */
    private fun hitArrow(x: Float, y: Float): Int {
        var best = -1
        var bestD = cell * 0.62f
        for (a in game.remaining) {
            val v = vis[a.id] ?: continue
            if (v.escaping || v.gone) continue
            val d = distanceToArrow(a, x, y)
            if (d < bestD) { bestD = d; best = a.id }
        }
        return best
    }

    private fun distanceToArrow(a: ArrowPath, x: Float, y: Float): Float {
        var best = Float.MAX_VALUE
        for (i in 0 until a.pts.size - 1) {
            val x1 = px(a.pts[i].first); val y1 = py(a.pts[i].second)
            val x2 = px(a.pts[i + 1].first); val y2 = py(a.pts[i + 1].second)
            best = min(best, pointSegDist(x, y, x1, y1, x2, y2))
        }
        // include the arrowhead area
        val hx = px(a.head.first); val hy = py(a.head.second)
        val tipX = hx + a.headDir.dx * cell * ArrowDraw.HEAD_LEN_F
        val tipY = hy + a.headDir.dy * cell * ArrowDraw.HEAD_LEN_F
        best = min(best, pointSegDist(x, y, hx, hy, tipX, tipY))
        return best
    }

    private fun pointSegDist(px: Float, py: Float, x1: Float, y1: Float,
                             x2: Float, y2: Float): Float {
        val vx = x2 - x1; val vy = y2 - y1
        val wx = px - x1; val wy = py - y1
        val len2 = vx * vx + vy * vy
        val t = if (len2 <= 0f) 0f else ((wx * vx + wy * vy) / len2).coerceIn(0f, 1f)
        return hypot(px - (x1 + vx * t), py - (y1 + vy * t))
    }

    private fun onButton(b: UiButton) {
        act.sound.tap()
        act.haptics.buttonTick()
        when (b.id) {
            "back" -> act.showLevelSelect()
            "pause" -> { phase = Phase.PAUSED; overlayT = 0f }
            "resume" -> { phase = Phase.PLAY; overlayT = 0f }
            "hint" -> useHint()
            "restart" -> restart()
            "primary" -> if (phase == Phase.COMPLETE) {
                if (levelNum < Levels.all.size) act.showLevel(levelNum + 1) else act.showLevelSelect()
            } else restart()
            "secondary" -> act.showLevelSelect()
            "menu" -> act.showMenu()
            "sound" -> { act.settings.sound = !act.settings.sound }
            "music" -> { act.settings.music = !act.settings.music; act.sound.updateMusic() }
            "haptics" -> { act.settings.haptics = !act.settings.haptics }
        }
        startAnim()
    }

    fun handleBack(): Boolean {
        if (phase == Phase.PAUSED) { phase = Phase.PLAY; startAnim(); return true }
        if (phase == Phase.PLAY) { phase = Phase.PAUSED; overlayT = 0f; startAnim(); return true }
        return false
    }

    fun pauseGame() {
        if (phase == Phase.PLAY) { phase = Phase.PAUSED; overlayT = 0f }
    }

    private fun restart() {
        game = GameController(spec)
        phase = Phase.PLAY
        overlayT = 0f; slowMo = 0f; boardGlow = 0f; comboCount = 0
        starsShown = 0; starTimer = 0f; hintTarget = -1
        particles.clear()
        buildTracks()
        startAnim()
    }

    private fun useHint() {
        if (phase != Phase.PLAY) return
        val a = game.hint() ?: return
        hintTarget = a.id
        vis[a.id]?.hintGlow = 2.4f
        startAnim()
    }

    private fun tapArrow(id: Int) {
        val v = vis[id] ?: return
        if (v.escaping || v.gone) return
        when (val res = game.tap(id)) {
            is GameController.TapResult.Escaped -> {
                v.escaping = true
                v.escapeT = 0f
                v.anticip = 1f
                val dist = (v.track?.total ?: 0f) - v.bodyLen
                v.escapeDur = (0.30f + (dist / max(cell, 1f)) * 0.012f).coerceIn(0.30f, 0.62f)
                comboCount++
                if (hintTarget == id) hintTarget = -1
                act.sound.launch()
                act.haptics.launch()
                if (tutorialStage == 1) { tutorialStage = 2; tutorialBannerT = 0f }
                if (res.last) onLevelComplete()
            }
            is GameController.TapResult.Blocked -> {
                v.blockedFlash = 1f
                v.shake = 1f
                comboCount = 0
                heartLost = res.heartsLeft
                heartPulse = 1f
                shakeScreen = 0.55f
                act.sound.blocked()
                act.haptics.blocked()
                act.haptics.heartLost()
                if (res.failed) {
                    phase = Phase.FAILED
                    overlayT = 0f
                }
            }
            GameController.TapResult.Ignored -> Unit
        }
        startAnim()
    }

    private fun onLevelComplete() {
        phase = Phase.COMPLETE
        overlayT = 0f
        slowMo = 1f
        boardGlow = 1f
        starTimer = 0f
        starsShown = 0
        act.sound.win()
        act.haptics.win()
        act.progress.recordResult(levelNum, game.stars(), game.elapsedMs)
        if (tutorialStage != 0) {
            act.progress.tutorialSeen = true
            tutorialStage = 0
        }
        particles.confetti(width / 2f, boardRect.centerY(), width * 0.9f, 90)
    }

    // ---------- animation ----------

    override fun step(dt: Float): Boolean {
        var busy = false
        val scale = if (slowMo > 0f) Ease.lerp(0.35f, 1f, 1f - slowMo) else 1f
        val sdt = dt * scale

        if (phase == Phase.PLAY) game.tick((dt * 1000).toLong())

        for (b in allButtons) if (b.step(dt)) busy = true

        if (slowMo > 0f) { slowMo = max(0f, slowMo - dt * 1.6f); busy = true }
        if (boardGlow > 0f) { boardGlow = max(0f, boardGlow - dt * 0.9f); busy = true }
        if (shakeScreen > 0f) { shakeScreen = max(0f, shakeScreen - dt * 2.4f); busy = true }
        if (heartPulse > 0f) { heartPulse = max(0f, heartPulse - dt * 2.2f); busy = true }
        if (phase != Phase.PLAY && overlayT < 1f) { overlayT = min(1f, overlayT + dt * 3.2f); busy = true }

        if (phase == Phase.COMPLETE && overlayT > 0.35f && starsShown < game.stars()) {
            starTimer += dt
            if (starTimer > 0.20f) {
                starTimer = 0f
                starsShown++
                act.sound.star()
                act.haptics.buttonTick()
                particles.burst(width / 2f + (starsShown - 2) * dp(46f), height * 0.40f,
                    Palette.GOLD, 12, 220f, spread = 1f, life = 0.5f, size = 5f)
            }
            busy = true
        }

        for ((id, v) in vis) {
            if (v.gone) continue
            if (v.anticip > 0f) {
                v.anticip = max(0f, v.anticip - dt * 7.5f)
                busy = true
            }
            if (v.escaping) {
                v.escapeT = min(1f, v.escapeT + sdt / v.escapeDur)
                val total = v.track?.total ?: 0f
                v.travel = Ease.inCubic(v.escapeT) * (total - v.bodyLen)
                v.trail = min(1f, v.trail + dt * 6f)
                if (v.escapeT >= 1f) {
                    v.gone = true
                    v.escaping = false
                    onArrowGone(id)
                }
                busy = true
            } else if (v.trail > 0f) {
                v.trail = max(0f, v.trail - dt * 3f); busy = true
            }
            if (v.blockedFlash > 0f) { v.blockedFlash = max(0f, v.blockedFlash - dt * 2.2f); busy = true }
            if (v.shake > 0f) { v.shake = max(0f, v.shake - dt * 3.6f); busy = true }
            if (v.selectGlow > 0f && pressedArrow != id) {
                v.selectGlow = max(0f, v.selectGlow - dt * 3.4f); busy = true
            }
            if (v.hintGlow > 0f && hintTarget == id) {
                v.hintGlow = max(0f, v.hintGlow - dt * 0.42f); busy = true
            }
        }

        if (particles.step(dt)) busy = true

        if (tutorialStage > 0) {
            tutorialT += dt
            tutorialBannerT = min(1f, tutorialBannerT + dt * 2.2f)
            if (tutorialStage == 1 && tutorialTargetId < 0) {
                tutorialTargetId = BoardLogic.pickHint(game.remaining, 0)?.id ?: -1
            }
            if (tutorialStage == 2 && game.remainingCount <= 0) tutorialStage = 0
            busy = true
        }
        if (pressedArrow >= 0) busy = true
        return busy
    }

    private fun onArrowGone(id: Int) {
        val v = vis[id] ?: return
        val t = v.track ?: return
        // particle burst where the head crossed the board edge
        t.pointAt((v.travel + v.bodyLen).coerceAtMost(t.total), tmpPt)
        val ex = tmpPt[0].coerceIn(-cell, width + cell)
        val ey = tmpPt[1].coerceIn(-cell, height + cell)
        particles.burst(
            ex.coerceIn(0f, width.toFloat()), ey.coerceIn(0f, height.toFloat()),
            Palette.ACCENT, 14, 260f, dirX = tmpPt[2] * 0.6f, dirY = tmpPt[3] * 0.6f,
            spread = 0.7f, life = 0.45f, size = 5.5f)
        act.sound.escape(comboCount - 1)
        act.haptics.escapeDone()
    }

    // ---------- rendering ----------

    override fun render(c: Canvas) {
        if (width == 0) return
        c.save()
        if (shakeScreen > 0f) {
            val m = shakeScreen * dp(5f)
            c.translate(
                (Math.random().toFloat() - 0.5f) * m,
                (Math.random().toFloat() - 0.5f) * m)
        }

        drawHeader(c)
        drawBoardDots(c)
        drawArrows(c)
        particles.draw(c)
        drawFooter(c)
        if (tutorialStage > 0 && phase == Phase.PLAY) drawTutorial(c)
        c.restore()

        when (phase) {
            Phase.PAUSED -> drawPauseOverlay(c)
            Phase.COMPLETE -> drawCompleteOverlay(c)
            Phase.FAILED -> drawFailOverlay(c)
            Phase.PLAY -> Unit
        }
    }

    private fun drawHeader(c: Canvas) {
        val top = insetTop + dp(10f)
        drawText(c, "Level $levelNum", width / 2f, top + dp(26f), dp(21f),
            Palette.TEXT, Fonts.black, letterSpacing = 0.02f)

        // hearts
        val hs = dp(26f)
        val gap = dp(8f)
        val totalW = hs * 3 + gap * 2
        var hx = width / 2f - totalW / 2f + hs / 2f
        val hy = top + dp(58f)
        for (i in 0 until 3) {
            val alive = i < game.hearts
            val pulse = if (!alive && i == heartLost && heartPulse > 0f) 1f + heartPulse * 0.35f else 1f
            c.save()
            c.scale(pulse, pulse, hx, hy)
            Glyphs.heart(c, hx, hy, hs,
                fillPaint(if (alive) Palette.HEART else Palette.HEART_EMPTY))
            c.restore()
            hx += hs + gap
        }

        // difficulty chip (left) and remaining counter (right)
        val chipH = dp(30f)
        val cy = top + dp(56f)
        val diffLabel = spec.difficulty.label
        val dw = dp(16f) + textWidth(diffLabel, dp(13f), Fonts.bold)
        val dr = RectF(dp(16f), cy - chipH / 2f, dp(16f) + dw, cy + chipH / 2f)
        drawCard(c, dr, chipH / 2f, Palette.CARD, Palette.CARD_EDGE, 14)
        drawText(c, diffLabel, dr.centerX(), dr.centerY() + dp(4.6f), dp(13f),
            difficultyColor(), Fonts.black)

        val remaining = "${game.remainingCount}"
        val rw = max(dp(52f), dp(30f) + textWidth(remaining, dp(14f), Fonts.black))
        val rr = RectF(width - dp(16f) - rw, cy - chipH / 2f, width - dp(16f), cy + chipH / 2f)
        drawCard(c, rr, chipH / 2f, Palette.CARD, Palette.CARD_EDGE, 14)
        val ip = fillPaint(Palette.ACCENT)
        miniArrow(c, rr.left + dp(15f), rr.centerY(), dp(13f), ip)
        drawText(c, remaining, rr.left + dp(24f) + (rw - dp(24f)) / 2f, rr.centerY() + dp(5f),
            dp(14f), Palette.TEXT, Fonts.black)

        // back + pause icons
        drawCircleButton(c, btnBack)
        Glyphs.back(c, btnBack.rect.centerX(), btnBack.rect.centerY(), dp(22f),
            iconPaint(Palette.TEXT, dp(2.6f)))
        drawCircleButton(c, btnPause)
        Glyphs.pause(c, btnPause.rect.centerX(), btnPause.rect.centerY(), dp(24f),
            fillPaint(Palette.TEXT))
    }

    private fun difficultyColor(): Int = when (spec.difficulty) {
        com.veergames.veer.core.Difficulty.EASY -> Palette.ACCENT2
        com.veergames.veer.core.Difficulty.NORMAL -> Palette.ACCENT
        com.veergames.veer.core.Difficulty.HARD -> Palette.HEART
    }

    private fun miniArrow(c: Canvas, cx: Float, cy: Float, s: Float, p: Paint) {
        val path = Path()
        path.moveTo(cx - s * 0.42f, cy + s * 0.34f)
        path.lineTo(cx + s * 0.44f, cy - s * 0.34f)
        path.lineTo(cx + s * 0.06f, cy + s * 0.02f)
        path.close()
        c.drawPath(path, p)
    }

    private fun textWidth(s: String, size: Float, tf: android.graphics.Typeface): Float {
        val p = textPaint(size, 0, tf)
        return p.measureText(s)
    }

    private fun drawBoardDots(c: Canvas) {
        val p = fillPaint(Palette.DOT)
        val r = cell * 0.052f
        for (gx in 0 until spec.cols) {
            for (gy in 0 until spec.rows) {
                c.drawCircle(px(gx), py(gy), r, p)
            }
        }
        if (boardGlow > 0f) {
            val gp = fillPaint(Palette.withAlpha(Palette.ACCENT2, (40 * boardGlow).toInt()))
            gp.style = Paint.Style.STROKE
            gp.strokeWidth = dp(3f) * boardGlow
            c.drawRoundRect(boardRect, cell * 0.5f, cell * 0.5f, gp)
        }
    }

    private fun drawArrows(c: Canvas) {
        for (a in spec.arrows) {
            val v = vis[a.id] ?: continue
            if (v.gone) continue
            val track = v.track ?: continue
            val stillPlaying = game.remaining.any { it.id == a.id }
            if (!stillPlaying && !v.escaping) continue

            var travel = v.travel
            if (v.anticip > 0f && v.escaping) {
                travel -= Ease.outCubic(v.anticip) * cell * 0.13f
            }
            var dx = 0f
            var dy = 0f
            if (v.shake > 0f) {
                val amp = v.shake * cell * 0.10f
                val ph = (System.nanoTime() / 22_000_000.0).toFloat()
                dx = a.headDir.dx * kotlin.math.sin(ph) * amp
                dy = a.headDir.dy * kotlin.math.sin(ph) * amp
                if (a.headDir.dx == 0) dx = kotlin.math.sin(ph) * amp * 0.35f
                if (a.headDir.dy == 0) dy = kotlin.math.sin(ph) * amp * 0.35f
            }

            // trail while escaping
            if (v.escaping && v.trail > 0f) {
                drawTrail(c, track, travel, v)
            }

            c.save()
            c.translate(dx, dy)

            val cols = Palette.arrowColors(a.id)
            var tail = cols[0]
            var head = cols[1]
            var glowW = 0f
            var glowC = 0

            if (v.blockedFlash > 0f) {
                val t = Ease.outCubic(v.blockedFlash)
                tail = Palette.lerpColor(tail, Palette.DANGER, t)
                head = Palette.lerpColor(head, Palette.DANGER, t)
                glowW = cell * 0.10f * t
                glowC = Palette.DANGER
            } else if (hintTarget == a.id && v.hintGlow > 0f) {
                val pulse = (kotlin.math.sin(v.hintGlow * 7f) * 0.5f + 0.5f)
                tail = Palette.lerpColor(tail, Palette.ACCENT, 0.55f + 0.35f * pulse)
                head = Palette.lerpColor(head, Palette.ACCENT, 0.55f + 0.35f * pulse)
                glowW = cell * (0.10f + 0.07f * pulse)
                glowC = Palette.ACCENT
            } else if (v.selectGlow > 0f || pressedArrow == a.id) {
                val t = if (pressedArrow == a.id) 1f else v.selectGlow
                tail = Palette.lerpColor(tail, Palette.ACCENT, 0.85f * t)
                head = Palette.lerpColor(head, Palette.ACCENT, 0.85f * t)
                glowW = cell * 0.09f * t
                glowC = Palette.ACCENT
            } else if (v.escaping) {
                tail = Palette.lerpColor(tail, Palette.ACCENT, 0.85f)
                head = Palette.lerpColor(head, Palette.ACCENT, 0.85f)
                glowW = cell * 0.08f
                glowC = Palette.ACCENT
            }

            val pressScale = if (pressedArrow == a.id) 1.03f else 1f
            if (pressScale != 1f) {
                val hx = px(a.head.first); val hy = py(a.head.second)
                c.scale(pressScale, pressScale, hx, hy)
            }

            ArrowDraw.draw(c, track, travel, v.bodyLen, cell, tail, head,
                alpha = 255, glowWidth = glowW, glowColor = glowC)
            c.restore()
        }
    }

    private fun drawTrail(c: Canvas, track: Track, travel: Float, v: Vis) {
        val back = (travel - cell * 1.5f).coerceAtLeast(0f)
        track.subPath(back, travel + v.bodyLen * 0.35f, trailPath, tmpPt)
        paint.reset(); paint.isAntiAlias = true
        paint.style = Paint.Style.STROKE
        paint.strokeCap = Paint.Cap.ROUND
        paint.strokeWidth = cell * ArrowDraw.STROKE_F * 0.9f
        paint.color = Palette.withAlpha(Palette.ACCENT, (60 * v.trail).toInt())
        c.drawPath(trailPath, paint)
        paint.strokeWidth = cell * ArrowDraw.STROKE_F * 0.45f
        paint.color = Palette.withAlpha(Palette.ACCENT, (90 * v.trail).toInt())
        c.drawPath(trailPath, paint)
    }

    private fun drawFooter(c: Canvas) {
        drawCircleButton(c, btnHint)
        Glyphs.bulb(c, btnHint.rect.centerX(), btnHint.rect.centerY(), dp(30f),
            iconPaint(Palette.GOLD, dp(2.6f)))
        drawCircleButton(c, btnRestart)
        Glyphs.restart(c, btnRestart.rect.centerX(), btnRestart.rect.centerY(), dp(30f),
            iconPaint(Palette.ACCENT, dp(2.6f)), fillPaint(Palette.ACCENT))
    }

    // ---------- tutorial ----------

    private fun drawTutorial(c: Canvas) {
        val msg = if (tutorialStage == 1) "Tap a free arrow" else "Clear the board"
        val alpha = (255 * Ease.outCubic(tutorialBannerT)).toInt()
        val y = boardRect.top - dp(18f)
        val p = textPaint(dp(16f), Palette.withAlpha(Palette.TEXT_DIM, alpha), Fonts.bold)
        c.drawText(msg, width / 2f, y, p)

        if (tutorialStage == 1) {
            val target = game.remaining.firstOrNull { it.id == tutorialTargetId } ?: return
            val v = vis[target.id] ?: return
            if (v.escaping || v.gone) return
            // pulsing ring + finger at the arrow's midpoint
            val mid = target.pts[target.pts.size / 2]
            val cx = px(mid.first); val cy = py(mid.second)
            val cycle = (tutorialT % 1.6f) / 1.6f
            val ringT = (cycle / 0.55f).coerceAtMost(1f)
            val ringP = iconPaint(
                Palette.withAlpha(Palette.ACCENT, ((1f - ringT) * 150).toInt()), dp(2.4f))
            c.drawCircle(cx, cy, cell * (0.32f + 0.55f * ringT), ringP)
            val tapDip = if (cycle < 0.18f) kotlin.math.sin(cycle / 0.18f * Math.PI).toFloat() else 0f
            drawFinger(c, cx + cell * 0.22f - tapDip * dp(3f),
                cy + cell * 0.30f - tapDip * dp(5f), cell * 0.78f)
        }
    }

    /** Simple stylised pointing hand. */
    private fun drawFinger(c: Canvas, x: Float, y: Float, s: Float) {
        val fill = fillPaint(0xFFFFFFFF.toInt())
        val edge = iconPaint(Palette.withAlpha(Palette.TEXT, 90), s * 0.045f)
        val path = Path()
        path.moveTo(x, y)                                   // fingertip
        path.lineTo(x - s * 0.10f, y + s * 0.30f)
        path.cubicTo(x - s * 0.16f, y + s * 0.42f, x - s * 0.06f, y + s * 0.52f,
            x + s * 0.10f, y + s * 0.52f)
        path.lineTo(x + s * 0.30f, y + s * 0.52f)
        path.cubicTo(x + s * 0.42f, y + s * 0.52f, x + s * 0.44f, y + s * 0.36f,
            x + s * 0.36f, y + s * 0.24f)
        path.lineTo(x + s * 0.16f, y + s * 0.02f)
        path.cubicTo(x + s * 0.10f, y - s * 0.05f, x + s * 0.03f, y - s * 0.04f, x, y)
        path.close()
        c.drawPath(path, fill)
        c.drawPath(path, edge)
    }

    // ---------- overlays ----------

    private fun scrim(c: Canvas, alpha: Float) {
        c.drawColor(Palette.withAlpha(0x0B1230, (alpha * 150).toInt()))
    }

    private fun drawPauseOverlay(c: Canvas) {
        scrim(c, overlayT)
        val a = Ease.outCubic(overlayT)
        val panel = RectF(width * 0.10f, height * 0.22f, width * 0.90f, height * 0.62f)
        c.save()
        c.scale(Ease.lerp(0.94f, 1f, a), Ease.lerp(0.94f, 1f, a), panel.centerX(), panel.centerY())
        drawCard(c, panel, dp(28f), Palette.CARD, Palette.CARD_EDGE, 40, dp(10f), dp(24f))
        drawText(c, "PAUSED", panel.centerX(), panel.top + dp(52f), dp(24f),
            Palette.TEXT, Fonts.black, letterSpacing = 0.12f)

        drawToggleRow(c, "Sound", btnSound, act.settings.sound, panel)
        drawToggleRow(c, "Music", btnMusic, act.settings.music, panel)
        drawToggleRow(c, "Haptics", btnHaptics, act.settings.haptics, panel)
        c.restore()

        drawPillButton(c, btnResume, "RESUME", dp(17f), true)
        val bw = btnResume.rect.width()
        val rowTop = btnResume.rect.bottom + dp(12f)
        val rowBottom = rowTop + dp(52f)
        btnPauseRestart.rect.set(btnResume.rect.left, rowTop,
            btnResume.rect.left + bw / 2f - dp(6f), rowBottom)
        btnPauseMenu.rect.set(btnResume.rect.left + bw / 2f + dp(6f), rowTop,
            btnResume.rect.right, rowBottom)
        drawPillButton(c, btnPauseRestart, "RESTART", dp(14f), false)
        drawPillButton(c, btnPauseMenu, "MENU", dp(14f), false)
    }

    private fun drawToggleRow(c: Canvas, label: String, b: UiButton, on: Boolean, panel: RectF) {
        val y = b.rect.centerY()
        drawText(c, label, panel.left + dp(34f), y + dp(6f), dp(16f),
            Palette.TEXT, Fonts.bold, Paint.Align.LEFT)
        val r = RectF(b.rect)
        val radius = r.height() / 2f
        paint.reset(); paint.isAntiAlias = true
        paint.color = if (on) Palette.ACCENT else 0xFFDCE3F2.toInt()
        c.drawRoundRect(r, radius, radius, paint)
        val knobR = r.height() * 0.38f
        val kx = if (on) r.right - radius else r.left + radius
        paint.color = 0xFFFFFFFF.toInt()
        paint.setShadowLayer(6f, 0f, 2f, Palette.withAlpha(0x101B3A, 60))
        c.drawCircle(kx, r.centerY(), knobR, paint)
        paint.clearShadowLayer()
    }

    private fun drawCompleteOverlay(c: Canvas) {
        scrim(c, overlayT)
        val a = Ease.outBack(overlayT.coerceIn(0f, 1f))
        c.save()
        c.scale(Ease.lerp(0.9f, 1f, a.coerceIn(0f, 1.2f)),
            Ease.lerp(0.9f, 1f, a.coerceIn(0f, 1.2f)), width / 2f, height * 0.42f)
        drawText(c, "LEVEL COMPLETE", width / 2f, height * 0.30f, dp(25f),
            0xFFFFFFFF.toInt(), Fonts.black, letterSpacing = 0.08f)
        c.restore()

        // stars
        val sw = dp(52f)
        for (i in 0 until 3) {
            val cx = width / 2f + (i - 1) * dp(58f)
            val cy = height * 0.40f
            val filled = i < starsShown
            val pop = if (filled) 1f else 0.86f
            c.save()
            c.scale(pop, pop, cx, cy)
            Glyphs.star(c, cx, cy, sw,
                fillPaint(if (filled) Palette.GOLD else Palette.withAlpha(0xFFFFFF, 46)))
            c.restore()
        }

        // stats
        val secs = game.elapsedMs / 1000.0
        val timeStr = String.format("%d:%02d", (secs / 60).toInt(), (secs % 60).toInt())
        drawText(c, "Time  $timeStr", width / 2f, height * 0.50f, dp(16f),
            0xFFDDE6FF.toInt(), Fonts.bold)
        drawText(c, "Mistakes  ${game.mistakes}", width / 2f, height * 0.545f, dp(16f),
            0xFFDDE6FF.toInt(), Fonts.bold)

        if (overlayT > 0.85f) {
            val last = levelNum >= Levels.all.size
            drawPillButton(c, btnPrimary, if (last) "LEVEL SELECT" else "NEXT LEVEL", dp(17f), true)
            drawPillButton(c, btnSecondary, "LEVELS", dp(15f), false)
        }
    }

    private fun drawFailOverlay(c: Canvas) {
        scrim(c, overlayT)
        val a = Ease.outCubic(overlayT)
        c.save()
        c.scale(Ease.lerp(0.92f, 1f, a), Ease.lerp(0.92f, 1f, a), width / 2f, height * 0.40f)
        drawText(c, "OUT OF HEARTS", width / 2f, height * 0.36f, dp(24f),
            0xFFFFFFFF.toInt(), Fonts.black, letterSpacing = 0.06f)
        drawText(c, "Take another run at it", width / 2f, height * 0.42f, dp(15f),
            0xFFC9D4F2.toInt(), Fonts.medium)
        c.restore()
        if (overlayT > 0.85f) {
            drawPillButton(c, btnPrimary, "TRY AGAIN", dp(17f), true)
            drawPillButton(c, btnSecondary, "LEVELS", dp(15f), false)
        }
    }
}
