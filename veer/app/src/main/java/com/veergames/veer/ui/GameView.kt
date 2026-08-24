package com.veergames.veer.ui

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.DashPathEffect
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import android.view.MotionEvent
import com.veergames.veer.core.ArrowPath
import com.veergames.veer.core.BoardLogic
import com.veergames.veer.core.Difficulty
import com.veergames.veer.core.Dir
import com.veergames.veer.core.GameController
import com.veergames.veer.core.Levels
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/**
 * The puzzle screen: board rendering, hit-testing, launch/bump animation,
 * hearts, hints, tutorial, skin effects and result overlays.
 *
 * Every legality decision comes from [GameController]; this view asks, then
 * animates the answer, so what the player sees can never disagree with the
 * puzzle state. Geometry per arrow is cached and rebuilt only while that
 * arrow is actually moving, so a 33-arrow board costs one path per frame.
 */
@SuppressLint("ViewConstructor")
class GameView(context: Context, private val levelNum: Int) : BaseView(context) {

    private enum class Phase { PLAY, PAUSED, COMPLETE, FAILED }

    private companion object {
        /** hitArrow: two arrows within a hair of each other - never guess,
         *  because a guess costs a heart. */
        const val AMBIGUOUS = -2
    }

    private enum class Motion { INTRO, IDLE, IGNITE, ANTICIPATE, LAUNCH, BUMP_OUT, BUMP_BACK, GONE }

    private val spec = Levels.all[levelNum - 1]
    private var game = GameController(spec)
    private var phase = Phase.PLAY

    private var cell = 40f
    private var originX = 0f
    private var originY = 0f
    private val boardRect = RectF()

    /** Per-arrow visual state; indexed by dense arrow id. */
    private class Vis {
        var track: Track? = null
        var bodyLen = 0f
        var travel = 0f
        var prevTravel = 0f
        var speed = 0f
        var motion = Motion.IDLE
        var t = 0f
        var dur = 0.3f
        var delay = 0f
        var bumpDist = 0f
        var blockerId = -1
        var comboIdx = 0
        var blockedFlash = 0f
        var impactFlash = 0f
        var recoil = 0f
        var selectGlow = 0f
        var trail = 0f
        var igniteFront = 0f
        var seed = 0f
        var active = true
        // cached geometry
        val bodyPath = Path()
        val headPath = Path()
        var geomTravel = Float.NaN
        var geomVersion = -1
    }

    private lateinit var vis: Array<Vis>
    private val particles = Particles()
    private val embers = Embers()
    private val frost = Frost()
    private val flame = FlameFx()
    private val outro = Outro()

    private val btnBack = UiButton("back")
    private val btnPause = UiButton("pause")
    private val btnHint = UiButton("hint")
    private val btnRestart = UiButton("restart")
    private val btnPrimary = UiButton("primary")
    private val btnSecondary = UiButton("secondary")
    private val btnResume = UiButton("resume")
    private val btnPauseRestart = UiButton("pauseRestart")
    private val btnPauseMenu = UiButton("pauseMenu")
    private val btnSound = UiButton("sound")
    private val btnMusic = UiButton("music")
    private val btnHaptics = UiButton("haptics")
    private val allButtons = listOf(btnBack, btnPause, btnHint, btnRestart, btnPrimary,
        btnSecondary, btnResume, btnPauseRestart, btnPauseMenu, btnSound, btnMusic, btnHaptics)

    private var overlayT = 0f
    private var timeScale = 1f
    private var timeScaleTarget = 1f
    private var hitStop = 0f
    private var boardGlow = 0f
    private var heartLostIndex = -1
    private var heartPulse = 0f
    private var starsShown = 0
    private var starTimer = 0f
    private var shakeScreen = 0f
    private var shakeDirX = 0f
    private var shakeDirY = 0f
    private var pendingComplete = false
    private var inFlight = 0
    private var failDelay = 0f
    private var comboShown = 0
    private var comboPop = 0f
    private val starAge = FloatArray(3) { -1f }
    private var winSweep = 0f
    private var time = 0f
    private var introT = 0f

    private var tutorialStage = if (levelNum == 1 && !act.progress.tutorialSeen) 1 else 0
    private var tutorialT = 0f
    private var tutorialTargetId = -1
    private var tutorialBlockedId = -1
    private var tutorialBannerT = 0f

    private var hintTarget = -1
    private var hintGlow = 0f
    private var hintPhase = 0f
    private var pressedArrow = -1
    private var downX = 0f
    private var downY = 0f

    private val tmpPt = FloatArray(4)
    private val scratchPath = Path()
    private val rectTmp = RectF()
    private val panelRect = RectF()
    private val resultCard = RectF()
    private val trailPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val rayPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
    }
    private var headerTop = 0f
    private var footerCy = 0f
    private val skin get() = Skins.equipped

    init {
        buildVis()
        startAnim()
    }

    private fun buildVis() {
        vis = Array(spec.arrows.size) { i ->
            Vis().also {
                it.seed = i * 1.7f
                it.motion = Motion.INTRO
                it.delay = 0f
            }
        }
    }

    // ---------------------------------------------------------------- layout

    override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) {
        super.onSizeChanged(w, h, ow, oh)
        layoutBoard(w, h)
    }

    private fun layoutBoard(w: Int, h: Int) {
        if (w == 0 || h == 0) return
        val oldCell = cell
        headerTop = max(insetTop, dp(12f))
        val headerH = dp(96f)
        val navSafe = max(insetBottom, dp(28f))
        val bottom = h - navSafe
        footerCy = bottom - dp(46f)
        val footerH = dp(104f)
        val availTop = headerTop + headerH
        val availBottom = bottom - footerH
        val availW = w - dp(12f) * 2
        val availH = max(dp(120f), availBottom - availTop)
        cell = min(availW / (spec.cols - 1 + 1.15f), availH / (spec.rows - 1 + 1.15f))
        val boardW = (spec.cols - 1) * cell
        val boardH = (spec.rows - 1) * cell
        originX = (w - boardW) / 2f
        // bias the surplus upward: a low board is easier to reach one-handed
        originY = availTop + (availH - boardH) * 0.40f
        boardRect.set(originX - cell * 0.62f, originY - cell * 0.62f,
            originX + boardW + cell * 0.62f, originY + boardH + cell * 0.62f)
        ArrowDraw.minStroke = dp(2.5f)
        ArrowDraw.inkShader = LinearGradient(0f, boardRect.top, 0f, boardRect.bottom,
            skin.inkTail, skin.inkHead, Shader.TileMode.CLAMP)
        buildTracks(oldCell)
        layoutButtons(w, h, bottom)
        for (b in allButtons) b.touchPad = dp(8f)
    }

    private fun layoutButtons(w: Int, h: Int, bottom: Float) {
        val icon = dp(44f)
        btnBack.rect.set(dp(14f), headerTop, dp(14f) + icon, headerTop + icon)
        btnPause.rect.set(w - dp(14f) - icon, headerTop, w - dp(14f), headerTop + icon)

        val big = dp(60f)
        val gap = dp(32f)
        btnHint.rect.set(w / 2f - big - gap / 2f, footerCy - big / 2f,
            w / 2f - gap / 2f, footerCy + big / 2f)
        btnRestart.rect.set(w / 2f + gap / 2f, footerCy - big / 2f,
            w / 2f + gap / 2f + big, footerCy + big / 2f)

        // pause sheet: one card, everything derived from it
        val panelW = min(w - dp(40f), dp(360f))
        panelRect.set((w - panelW) / 2f, h / 2f - dp(210f), (w + panelW) / 2f, h / 2f + dp(210f))
        val tw = dp(56f); val th = dp(32f)
        val tx = panelRect.right - dp(24f) - tw
        btnSound.rect.set(tx, panelRect.top + dp(92f) - th / 2, tx + tw, panelRect.top + dp(92f) + th / 2)
        btnMusic.rect.set(tx, panelRect.top + dp(144f) - th / 2, tx + tw, panelRect.top + dp(144f) + th / 2)
        btnHaptics.rect.set(tx, panelRect.top + dp(196f) - th / 2, tx + tw, panelRect.top + dp(196f) + th / 2)
        val pw = panelW - dp(48f)
        btnResume.rect.set(panelRect.centerX() - pw / 2, panelRect.top + dp(248f),
            panelRect.centerX() + pw / 2, panelRect.top + dp(248f) + dp(56f))
        btnPauseRestart.rect.set(panelRect.centerX() - pw / 2, panelRect.top + dp(316f),
            panelRect.centerX() - dp(6f), panelRect.top + dp(316f) + dp(52f))
        btnPauseMenu.rect.set(panelRect.centerX() + dp(6f), panelRect.top + dp(316f),
            panelRect.centerX() + pw / 2, panelRect.top + dp(316f) + dp(52f))

        // result sheet
        val cardW = min(w - dp(40f), dp(340f))
        val cardH = dp(452f)
        resultCard.set((w - cardW) / 2f, (h - cardH) / 2f, (w + cardW) / 2f, (h + cardH) / 2f)
        val bw = cardW - dp(48f)
        btnPrimary.rect.set(resultCard.centerX() - bw / 2, resultCard.top + dp(302f),
            resultCard.centerX() + bw / 2, resultCard.top + dp(302f) + dp(56f))
        btnSecondary.rect.set(resultCard.centerX() - bw / 2, resultCard.top + dp(370f),
            resultCard.centerX() + bw / 2, resultCard.top + dp(370f) + dp(50f))
    }

    private fun px(gx: Int): Float = originX + gx * cell
    private fun py(gy: Int): Float = originY + gy * cell

    /**
     * Build each arrow's filleted track plus its exit ray. The ray is only
     * as long as it needs to be for the whole body to clear the screen, so
     * escape durations differ per arrow instead of all maxing out.
     */
    private fun buildTracks(oldCell: Float) {
        val scale = if (oldCell > 0f && cell > 0f) cell / oldCell else 1f
        for (a in spec.arrows) {
            val v = vis[a.id]
            val n = a.pts.size
            val cx = FloatArray(n + 1)
            val cy = FloatArray(n + 1)
            for (i in 0 until n) {
                cx[i] = px(a.pts[i].first)
                cy[i] = py(a.pts[i].second)
            }
            val pad = cell * (1.2f + ArrowDraw.HEAD_LEN_F)
            val exit = when (a.headDir) {
                Dir.RIGHT -> (width + pad) - cx[n - 1]
                Dir.LEFT -> cx[n - 1] + pad
                Dir.DOWN -> (height + pad) - cy[n - 1]
                Dir.UP -> cy[n - 1] + pad
            }.coerceAtLeast(cell)
            val ext = exit + a.bodyLen * cell
            cx[n] = cx[n - 1] + a.headDir.dx * ext
            cy[n] = cy[n - 1] + a.headDir.dy * ext
            val (track, bodyLen) = Track.filleted(cx, cy, n - 1, cell * ArrowDraw.CORNER_F)
            v.track = track
            v.bodyLen = bodyLen
            if (v.motion != Motion.IDLE && v.motion != Motion.INTRO) {
                v.travel *= scale        // keep a flying arrow where it was
                v.bumpDist *= scale
            }
            v.geomTravel = Float.NaN
        }
    }

    // ----------------------------------------------------------------- input

    override fun onTouchEvent(event: MotionEvent): Boolean {
        val x = event.x
        val y = event.y
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downX = x; downY = y
                for (b in activeButtons()) if (b.contains(x, y)) {
                    b.pressed = true; startAnim(); return true
                }
                if (phase == Phase.PLAY) {
                    val id = hitArrow(x, y)
                    if (id >= 0) {
                        pressedArrow = id
                        vis[id].selectGlow = 1f
                        startAnim()
                    } else if (id == AMBIGUOUS) {
                        // two arrows are equally close: refuse to guess, but
                        // show both so the miss is legible rather than dead
                        for (a in game.remaining) {
                            if (distanceToArrow(a, x, y) < max(cell * 0.62f, dp(20f))) {
                                vis[a.id].selectGlow = 0.45f
                            }
                        }
                        act.sound.tap()
                        startAnim()
                    }
                }
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                if (hypot(x - downX, y - downY) > dp(26f)) {
                    for (b in allButtons) b.pressed = false
                    if (pressedArrow >= 0) { vis[pressedArrow].selectGlow = 0f; pressedArrow = -1 }
                    startAnim()
                }
                return true
            }
            MotionEvent.ACTION_UP -> {
                var consumed = false
                for (b in activeButtons()) {
                    if (b.pressed && b.contains(x, y)) { onButton(b); consumed = true; break }
                }
                for (b in allButtons) b.pressed = false     // never strand a press
                if (!consumed && pressedArrow >= 0 && phase == Phase.PLAY) {
                    if (hitArrow(x, y) == pressedArrow) tapArrow(pressedArrow)
                }
                pressedArrow = -1
                startAnim()
                return true
            }
            MotionEvent.ACTION_CANCEL -> {
                for (b in allButtons) b.pressed = false
                if (pressedArrow >= 0) vis[pressedArrow].selectGlow = 0f
                pressedArrow = -1
                startAnim()
                return true
            }
        }
        return super.onTouchEvent(event)
    }

    private fun setPhase(p: Phase) {
        phase = p
        for (b in allButtons) b.pressed = false
    }

    private fun activeButtons(): List<UiButton> = when (phase) {
        Phase.PLAY -> listOf(btnBack, btnPause, btnHint, btnRestart)
        Phase.PAUSED -> listOf(btnResume, btnPauseRestart, btnPauseMenu, btnSound, btnMusic, btnHaptics)
        Phase.COMPLETE, Phase.FAILED ->
            if (overlayT > 0.55f) listOf(btnPrimary, btnSecondary) else emptyList()
    }

    /**
     * Nearest arrow within a comfortable radius. When two arrows are almost
     * equally close - unavoidable on the dense late boards - the tap is
     * refused rather than guessed, because a guess costs a heart.
     */
    private fun hitArrow(x: Float, y: Float): Int {
        var best = -1
        var bestD = Float.MAX_VALUE
        var secondD = Float.MAX_VALUE
        val limit = max(cell * 0.60f, dp(19f))
        for (a in game.remaining) {
            val v = vis[a.id]
            if (v.motion == Motion.LAUNCH || v.motion == Motion.GONE) continue
            val d = distanceToArrow(a, x, y)
            if (d < bestD) { secondD = bestD; bestD = d; best = a.id }
            else if (d < secondD) secondD = d
        }
        if (best < 0 || bestD > limit) return -1
        if (secondD - bestD < cell * 0.14f) return AMBIGUOUS
        return best
    }

    private fun distanceToArrow(a: ArrowPath, x: Float, y: Float): Float {
        var best = Float.MAX_VALUE
        for (i in 0 until a.pts.size - 1) {
            best = min(best, pointSegDist(x, y,
                px(a.pts[i].first), py(a.pts[i].second),
                px(a.pts[i + 1].first), py(a.pts[i + 1].second)))
        }
        val hx = px(a.head.first); val hy = py(a.head.second)
        return min(best, pointSegDist(x, y, hx, hy,
            hx + a.headDir.dx * cell * ArrowDraw.HEAD_LEN_F,
            hy + a.headDir.dy * cell * ArrowDraw.HEAD_LEN_F))
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
        when (b.id) {
            "back" -> act.showLevelSelect()
            "pause" -> { setPhase(Phase.PAUSED); overlayT = 0f }
            "resume" -> { setPhase(Phase.PLAY); overlayT = 0f }
            "hint" -> useHint()
            "restart", "pauseRestart" -> restart()
            "primary" -> if (phase == Phase.COMPLETE) {
                if (levelNum < Levels.all.size) act.showLevel(levelNum + 1) else act.showLevelSelect()
            } else restart()
            "secondary" -> act.showLevelSelect()
            "pauseMenu" -> act.showMenu()
            "sound" -> act.settings.sound = !act.settings.sound
            "music" -> { act.settings.music = !act.settings.music; act.sound.updateMusic() }
            "haptics" -> act.settings.haptics = !act.settings.haptics
        }
        // feedback after the toggle flips, so turning sound ON is audible
        if (b.id != "sound" || act.settings.sound) act.sound.tap()
        if (b.id != "haptics" || act.settings.haptics) act.haptics.buttonTick()
        startAnim()
    }

    fun handleBack(): Boolean {
        when (phase) {
            Phase.PAUSED -> { act.showLevelSelect(); return true }
            Phase.COMPLETE, Phase.FAILED -> { act.showLevelSelect(); return true }
            Phase.PLAY -> { setPhase(Phase.PAUSED); overlayT = 0f; startAnim(); return true }
        }
    }

    fun pauseGame() {
        if (phase == Phase.PLAY) { setPhase(Phase.PAUSED); overlayT = 0f }
    }

    private fun restart() {
        game = GameController(spec)
        setPhase(Phase.PLAY)
        overlayT = 0f; boardGlow = 0f; timeScale = 1f; timeScaleTarget = 1f
        starsShown = 0; starTimer = 0f; hintTarget = -1; hintGlow = 0f
        pendingComplete = false; inFlight = 0; failDelay = 0f
        shakeScreen = 0f; heartPulse = 0f; heartLostIndex = -1
        comboShown = 0; comboPop = 0f; introT = 0f
        particles.clear(); embers.clear(); frost.clear(); outro.clear()
        winSweep = 0f
        for (i in starAge.indices) starAge[i] = -1f
        buildVis()
        buildTracks(cell)
        if (levelNum == 1 && !act.progress.tutorialSeen) {
            tutorialStage = 1; tutorialTargetId = -1; tutorialBannerT = 0f
        }
        startAnim()
    }

    private fun useHint() {
        if (phase != Phase.PLAY) return
        val a = game.hint() ?: return
        hintTarget = a.id
        hintGlow = 1.6f
        hintPhase = 0f
        startAnim()
    }

    // ------------------------------------------------------------- gameplay

    private fun tapArrow(id: Int) {
        val v = vis[id]
        if (v.motion != Motion.IDLE) return
        when (val res = game.tap(id)) {
            is GameController.TapResult.Escaped -> {
                v.active = false
                v.comboIdx = res.combo - 1
                inFlight++
                if (hintTarget == id) { hintTarget = -1; hintGlow = 0f }
                if (skin.effect == Skin.Effect.FLAME) {
                    v.motion = Motion.IGNITE
                    v.dur = FlameFx.IGNITE_SECONDS
                } else {
                    v.motion = Motion.ANTICIPATE
                    v.dur = 0.075f
                }
                v.t = 0f
                if (res.combo >= 3) { comboShown = res.combo; comboPop = 1f }
                if (res.last) { pendingComplete = true; timeScaleTarget = 0.35f }
                if (tutorialStage == 1) {
                    tutorialStage = 2
                    tutorialBannerT = 0f
                    tutorialBlockedId = game.remaining
                        .firstOrNull { !BoardLogic.isFree(it, game.remaining) }?.id ?: -1
                }
            }
            is GameController.TapResult.Blocked -> {
                comboShown = 0
                v.motion = Motion.BUMP_OUT
                v.t = 0f
                v.dur = 0.10f
                v.blockerId = res.blocker.id
                v.bumpDist = min((res.gap - 0.45f) * cell, cell * 0.42f)
                    .coerceAtLeast(cell * 0.10f)
                if (res.failed) failDelay = 0.62f
            }
            GameController.TapResult.Ignored -> Unit
        }
        startAnim()
    }

    /** The instant a lunging arrow meets its blocker. */
    private fun onImpact(id: Int) {
        val v = vis[id]
        val arrow = spec.arrows[id]
        v.blockedFlash = 1f
        heartLostIndex = game.hearts
        heartPulse = 1f
        shakeDirX = arrow.headDir.dx.toFloat()
        shakeDirY = arrow.headDir.dy.toFloat()
        shakeScreen = 0.55f
        hitStop = 0.055f
        timeScaleTarget = 0.5f
        act.sound.blocked()
        act.haptics.blocked()

        if (v.blockerId >= 0) {
            val bv = vis[v.blockerId]
            bv.impactFlash = 1f
            bv.recoil = 1f
        }
        val track = v.track ?: return
        track.pointAt(v.travel + v.bodyLen + cell * ArrowDraw.HEAD_LEN_F, tmpPt)
        particles.burst(tmpPt[0].coerceIn(0f, width.toFloat()),
            tmpPt[1].coerceIn(0f, height.toFloat()),
            Palette.DANGER, 10, 160f,
            dirX = -arrow.headDir.dx * 0.5f, dirY = -arrow.headDir.dy * 0.5f,
            spread = 0.9f, life = 0.34f, size = 4f)
        // heart shards
        val hx = heartX(heartLostIndex)
        particles.burst(hx, headerTop + dp(58f), Palette.HEART, 9, 240f,
            spread = 1f, gravity = 1400f, life = 0.5f, size = 4f)
    }

    private fun launch(id: Int) {
        val v = vis[id]
        v.motion = Motion.LAUNCH
        v.t = 0f
        val dist = (v.track?.total ?: 0f) - v.bodyLen
        v.dur = (0.13f + (dist / max(cell, 1f)) * 0.011f).coerceIn(0.16f, 0.34f)
        act.sound.launch(skin.effect == Skin.Effect.FLAME)
        act.haptics.launch()
    }

    private fun onArrowGone(id: Int) {
        val v = vis[id]
        inFlight = max(0, inFlight - 1)
        val track = v.track ?: return
        track.pointAt((v.travel + v.bodyLen).coerceAtMost(track.total), tmpPt)
        val ex = tmpPt[0].coerceIn(0f, width.toFloat())
        val ey = tmpPt[1].coerceIn(0f, height.toFloat())
        when (skin.effect) {
            Skin.Effect.FLAME -> {
                embers.spawn(ex, ey, 26, cell * 0.5f, tmpPt[2] * 0.4f, tmpPt[3] * 0.4f,
                    speed = 240f, life = 0.9f, size = 5f)
                particles.burst(ex, ey, 0xFFFF7A20.toInt(), 10, 260f,
                    dirX = tmpPt[2] * 0.6f, dirY = tmpPt[3] * 0.6f, spread = 0.8f,
                    life = 0.4f, size = 6f)
            }
            Skin.Effect.FROST -> {
                frost.spawn(ex, ey, 18, cell * 0.6f, 150f)
                particles.burst(ex, ey, skin.exitParticle, 10, 220f,
                    dirX = tmpPt[2] * 0.5f, dirY = tmpPt[3] * 0.5f, spread = 0.8f, life = 0.5f)
            }
            else -> particles.burst(ex, ey, skin.exitParticle, 14, 260f,
                dirX = tmpPt[2] * 0.6f, dirY = tmpPt[3] * 0.6f, spread = 0.7f,
                life = 0.45f, size = 5.5f)
        }
        act.sound.escape(v.comboIdx)
        act.haptics.escapeDone(v.comboIdx)
        // nudge the neighbours the escape swept past
        wake(spec.arrows[id])
        if (pendingComplete && inFlight == 0) {
            pendingComplete = false
            outro.start(ex, ey)
            winSweep = 1f
            onLevelComplete()
        }
    }

    /** Small perpendicular nudge for arrows near a departing one. */
    private fun wake(gone: ArrowPath) {
        for (a in game.remaining) {
            val v = vis[a.id]
            if (v.motion != Motion.IDLE) continue
            val d = min(
                hypot(px(a.head.first) - px(gone.head.first),
                    py(a.head.second) - py(gone.head.second)),
                hypot(px(a.tail.first) - px(gone.tail.first),
                    py(a.tail.second) - py(gone.tail.second)))
            if (d < cell * 2.2f) v.recoil = max(v.recoil, 0.5f)
        }
    }

    private fun onLevelComplete() {
        setPhase(Phase.COMPLETE)
        overlayT = 0f
        boardGlow = 1f
        starTimer = 0f
        starsShown = 0
        for (i in starAge.indices) starAge[i] = -1f
        timeScaleTarget = 1f
        act.sound.win()
        act.haptics.win()
        act.progress.recordResult(levelNum, game.stars(), game.elapsedMs)
        if (tutorialStage != 0) { act.progress.tutorialSeen = true; tutorialStage = 0 }
        particles.confetti(width / 2f, boardRect.centerY(), width * 0.9f, 90)
    }

    // ------------------------------------------------------------ animation

    override fun step(dt: Float): Boolean {
        time += dt
        var busy = false

        if (hitStop > 0f) {
            hitStop = max(0f, hitStop - dt)
            if (hitStop == 0f) timeScaleTarget = if (pendingComplete) 0.35f else 1f
            busy = true
        }
        timeScale += (timeScaleTarget - timeScale) * min(1f, dt * 9f)
        if (abs(timeScale - timeScaleTarget) > 0.002f) busy = true
        val sdt = dt * timeScale

        if (phase == Phase.PLAY && !pendingComplete) game.tick((dt * 1_000_000).toLong())
        for (b in allButtons) if (b.step(dt)) busy = true

        if (introT < 1f) {
            introT = min(1f, introT + dt * 0.9f)
            busy = true
        }
        if (boardGlow > 0f) { boardGlow = max(0f, boardGlow - sdt * 0.9f); busy = true }
        if (shakeScreen > 0f) { shakeScreen = max(0f, shakeScreen - dt * 2.6f); busy = true }
        if (heartPulse > 0f) { heartPulse = max(0f, heartPulse - dt * 2.4f); busy = true }
        if (comboPop > 0f) { comboPop = max(0f, comboPop - dt * 1.1f); busy = true }
        if (hintGlow > 0f) { hintGlow = max(0f, hintGlow - dt * 0.85f); hintPhase += dt * 6.2f; busy = true }
        if (failDelay > 0f) {
            failDelay = max(0f, failDelay - dt)
            if (failDelay == 0f) { setPhase(Phase.FAILED); overlayT = 0f }
            busy = true
        }
        if (phase != Phase.PLAY && overlayT < 1f) { overlayT = min(1f, overlayT + dt * 2.6f); busy = true }

        if (phase == Phase.COMPLETE && overlayT > 0.3f && starsShown < game.stars()) {
            starTimer += dt
            val cadence = floatArrayOf(0.22f, 0.20f, 0.30f)[starsShown.coerceIn(0, 2)]
            if (starTimer > cadence) {
                starTimer = 0f
                act.sound.star(starsShown)
                act.haptics.buttonTick()
                starAge[starsShown] = 0f
                particles.burst(starX(starsShown), resultCard.top + dp(140f),
                    Palette.GOLD, 16, 240f, spread = 1f, life = 0.55f, size = 5f)
                starsShown++
            }
            busy = true
        }

        for (id in vis.indices) {
            val v = vis[id]
            if (v.motion == Motion.GONE) continue
            val track = v.track
            v.prevTravel = v.travel
            when (v.motion) {
                Motion.INTRO -> {
                    // staggered arrival, nearest the centre first
                    val delay = introDelay(id)
                    val k = ((introT * 1.35f - delay) / 0.30f).coerceIn(0f, 1f)
                    v.travel = (1f - Ease.outBack(k)) * cell * 1.6f
                    if (k >= 1f) { v.motion = Motion.IDLE; v.travel = 0f }
                    busy = true
                }
                Motion.IGNITE -> {
                    v.t += sdt
                    v.igniteFront = (v.t / v.dur).coerceIn(0.06f, 1f)
                    v.travel = -Ease.outCubic(v.t / v.dur) * cell * 0.10f
                    if (v.t >= v.dur) { v.motion = Motion.ANTICIPATE; v.t = 0f; v.dur = 0.05f }
                    busy = true
                }
                Motion.ANTICIPATE -> {
                    v.t += sdt
                    val k = (v.t / v.dur).coerceIn(0f, 1f)
                    v.travel = -cell * 0.12f * Ease.outCubic(k)
                    if (v.t >= v.dur) { launch(id); v.igniteFront = 1f }
                    busy = true
                }
                Motion.LAUNCH -> {
                    v.t += sdt
                    val k = (v.t / v.dur).coerceIn(0f, 1f)
                    val total = track?.total ?: 0f
                    val start = -cell * 0.12f
                    v.travel = start + Ease.launch(k) * (total - v.bodyLen - start)
                    v.trail = min(1f, v.trail + dt * 16f)
                    if (skin.effect == Skin.Effect.FLAME && track != null && k < 0.92f) {
                        track.pointAt(max(0f, v.travel - cell * 0.2f), tmpPt)
                        embers.spawn(tmpPt[0], tmpPt[1], 2, cell * 0.25f,
                            speed = 40f, life = 0.5f, size = 3.4f)
                    }
                    if (v.t >= v.dur) { v.motion = Motion.GONE; onArrowGone(id) }
                    busy = true
                }
                Motion.BUMP_OUT -> {
                    v.t += sdt
                    val k = (v.t / v.dur).coerceIn(0f, 1f)
                    v.travel = Ease.outCubic(k) * v.bumpDist
                    if (v.t >= v.dur) {
                        onImpact(id)
                        v.motion = Motion.BUMP_BACK
                        v.t = 0f
                        v.dur = 0.34f
                    }
                    busy = true
                }
                Motion.BUMP_BACK -> {
                    v.t += sdt
                    val k = (v.t / v.dur).coerceIn(0f, 1f)
                    // damped spring home, overshooting once past rest
                    v.travel = v.bumpDist * exp(-6.5f * k) * kotlin.math.cos(k * 15.5f)
                    if (v.t >= v.dur) { v.motion = Motion.IDLE; v.travel = 0f; v.t = 0f }
                    busy = true
                }
                else -> Unit
            }
            v.speed = if (sdt > 1e-5f) abs(v.travel - v.prevTravel) / sdt else 0f

            if (v.motion != Motion.LAUNCH && v.trail > 0f) {
                v.trail = max(0f, v.trail - dt * 3.4f); busy = true
            }
            if (v.blockedFlash > 0f) { v.blockedFlash = max(0f, v.blockedFlash - dt * 2.0f); busy = true }
            if (v.impactFlash > 0f) { v.impactFlash = max(0f, v.impactFlash - dt * 2.6f); busy = true }
            if (v.recoil > 0f) { v.recoil = max(0f, v.recoil - dt * 3.2f); busy = true }
            if (v.selectGlow > 0f && pressedArrow != id) {
                v.selectGlow = max(0f, v.selectGlow - dt * 3.6f); busy = true
            }
        }

        if (particles.step(sdt)) busy = true
        if (embers.step(sdt)) busy = true
        if (frost.step(sdt)) busy = true
        if (outro.step(dt)) busy = true
        if (winSweep > 0f) { winSweep = max(0f, winSweep - dt * 0.9f); busy = true }
        for (i in starAge.indices) if (starAge[i] >= 0f) { starAge[i] += dt; busy = true }

        if (tutorialStage > 0 && phase == Phase.PLAY) {
            tutorialT += dt
            tutorialBannerT = min(1f, tutorialBannerT + dt * 2.2f)
            if (tutorialStage == 1 && (tutorialTargetId < 0 ||
                        game.remaining.none { it.id == tutorialTargetId })) {
                tutorialTargetId = BoardLogic.pickHint(game.remaining, 0)?.id ?: -1
            }
            busy = true
        }
        if (pressedArrow >= 0) busy = true
        return busy
    }

    private fun introDelay(id: Int): Float {
        val a = spec.arrows[id]
        val dx = px(a.head.first) - boardRect.centerX()
        val dy = py(a.head.second) - boardRect.centerY()
        val r = hypot(dx, dy) / max(1f, hypot(boardRect.width(), boardRect.height()) * 0.5f)
        return r * 0.45f
    }

    // ------------------------------------------------------------ rendering

    override fun render(c: Canvas) {
        if (width == 0) return
        c.save()
        if (shakeScreen > 0f) {
            val amp = shakeScreen * shakeScreen * dp(7f)
            val w = sin(time * 46f)
            c.translate(shakeDirX * amp * w, shakeDirY * amp * w)
            c.rotate(shakeScreen * 0.55f * w, width / 2f, boardRect.centerY())
        }
        drawBoard(c)
        drawArrows(c)
        particles.draw(c)
        embers.draw(c)
        frost.draw(c)
        c.restore()

        drawHeader(c)
        drawFooter(c)
        if (tutorialStage > 0 && phase == Phase.PLAY) drawTutorial(c)

        when (phase) {
            Phase.PAUSED -> drawPauseOverlay(c)
            Phase.COMPLETE -> drawCompleteOverlay(c)
            Phase.FAILED -> drawFailOverlay(c)
            Phase.PLAY -> Unit
        }
    }

    private fun heartX(index: Int): Float {
        val n = game.maxHearts
        val hs = min(dp(23f), (width * 0.40f) / n)
        val gap = hs * 0.30f
        val total = hs * n + gap * (n - 1)
        return width / 2f - total / 2f + hs / 2f + index * (hs + gap)
    }

    private fun starX(i: Int): Float = resultCard.centerX() + (i - 1) * dp(58f)

    private fun drawHeader(c: Canvas) {
        drawText(c, "Level $levelNum", width / 2f, headerTop + dp(24f), dp(19f),
            Palette.TEXT, Fonts.black, letterSpacing = 0.02f)
        drawText(c, spec.title.uppercase(), width / 2f, headerTop + dp(40f), dp(10f),
            Palette.TEXT_DIM, Fonts.bold, letterSpacing = 0.18f)

        val n = game.maxHearts
        val hs = min(dp(23f), (width * 0.40f) / n)
        val hy = headerTop + dp(58f)
        for (i in 0 until n) {
            val alive = i < game.hearts
            val justLost = !alive && i == heartLostIndex && heartPulse > 0f
            val s = if (justLost) 1f + Ease.outBack(1f - heartPulse) * 0.45f * heartPulse else 1f
            val col = if (alive) Palette.HEART
            else if (justLost) Palette.lerpColor(Palette.HEART, Palette.HEART_EMPTY, 1f - heartPulse)
            else Palette.HEART_EMPTY
            c.save()
            c.scale(s, s, heartX(i), hy)
            Glyphs.heart(c, heartX(i), hy, hs, fillPaint(col))
            c.restore()
        }

        val chipH = dp(30f)
        val cy = headerTop + dp(58f)
        val diffLabel = spec.difficulty.label
        val dw = dp(20f) + textWidth(diffLabel, dp(12f), Fonts.black)
        rectTmp.set(dp(14f), cy - chipH / 2f, dp(14f) + dw, cy + chipH / 2f)
        drawCard(c, rectTmp, chipH / 2f, skin.chip, 0, 0)
        drawText(c, diffLabel, rectTmp.centerX(), rectTmp.centerY() + dp(4.2f), dp(12f),
            difficultyColor(), Fonts.black)

        val label = "${game.remainingCount}/${spec.arrows.size}"
        val rw = dp(30f) + textWidth(label, dp(13f), Fonts.black) + dp(12f)
        rectTmp.set(width - dp(14f) - rw, cy - chipH / 2f, width - dp(14f), cy + chipH / 2f)
        drawCard(c, rectTmp, chipH / 2f, skin.chip, 0, 0)
        miniArrow(c, rectTmp.left + dp(15f), rectTmp.centerY(), dp(12f), fillPaint(Palette.ACCENT))
        drawText(c, label, rectTmp.left + dp(28f), rectTmp.centerY() + dp(4.6f), dp(13f),
            Palette.TEXT, Fonts.black, Paint.Align.LEFT)

        if (comboShown >= 3 && comboPop > 0f) {
            val pop = Ease.outBack(min(1f, (1f - comboPop) * 4f))
            val cx = rectTmp.left - dp(38f)
            c.save()
            c.scale(pop, pop, cx, cy)
            val col = when {
                comboShown >= 8 -> Palette.GOLD
                comboShown >= 5 -> Palette.ACCENT2
                else -> Palette.ACCENT
            }
            drawText(c, "x$comboShown", cx, cy + dp(5f), dp(15f), col, Fonts.black)
            c.restore()
        }

        // progress hairline
        val prog = game.escapedCount.toFloat() / spec.arrows.size
        val py0 = headerTop + dp(84f)
        rectTmp.set(dp(16f), py0, width - dp(16f), py0 + dp(3f))
        drawCard(c, rectTmp, dp(1.5f), Palette.withAlpha(Palette.TEXT_DIM, 46), 0, 0)
        if (prog > 0f) {
            rectTmp.set(dp(16f), py0, dp(16f) + (width - dp(32f)) * prog, py0 + dp(3f))
            drawCard(c, rectTmp, dp(1.5f), Palette.ACCENT, 0, 0)
        }

        drawCircleButton(c, btnBack)
        Glyphs.back(c, btnBack.rect.centerX(), btnBack.rect.centerY(), dp(21f),
            iconPaint(Palette.TEXT, dp(2.5f)))
        drawCircleButton(c, btnPause)
        Glyphs.pause(c, btnPause.rect.centerX(), btnPause.rect.centerY(), dp(23f),
            fillPaint(Palette.TEXT))
    }

    private fun difficultyColor(): Int = when (spec.difficulty) {
        Difficulty.EASY -> Palette.ACCENT2
        Difficulty.NORMAL -> Palette.ACCENT
        Difficulty.HARD -> Palette.GOLD
        Difficulty.EXPERT -> Palette.HEART
    }

    private fun miniArrow(c: Canvas, cx: Float, cy: Float, s: Float, p: Paint) {
        scratchPath.rewind()
        scratchPath.moveTo(cx - s * 0.42f, cy + s * 0.34f)
        scratchPath.lineTo(cx + s * 0.44f, cy - s * 0.34f)
        scratchPath.lineTo(cx + s * 0.06f, cy + s * 0.02f)
        scratchPath.close()
        c.drawPath(scratchPath, p)
    }

    private fun textWidth(s: String, size: Float, tf: android.graphics.Typeface): Float =
        textPaint(size, 0, tf).measureText(s)

    private fun drawBoard(c: Canvas) {
        if (skin.boardTint != 0) {
            paint.reset(); paint.isAntiAlias = true
            paint.color = skin.boardTint
            c.drawRoundRect(boardRect, cell * 0.4f, cell * 0.4f, paint)
        }
        val p = fillPaint(Palette.DOT)
        val r = cell * 0.072f
        if (outro.active) {
            // the completion shockwave runs through the lattice
            for (gx in 0 until spec.cols) {
                val x = px(gx)
                for (gy in 0 until spec.rows) {
                    val y = py(gy)
                    val boost = outro.dotBoost(x, y, cell)
                    if (boost > 0.01f) {
                        p.color = Palette.lerpColor(Palette.DOT, Palette.ACCENT2, boost)
                        c.drawCircle(x, y, r * (1f + boost * 1.9f), p)
                        p.color = Palette.DOT
                    } else {
                        c.drawCircle(x, y, r, p)
                    }
                }
            }
        } else {
            for (gx in 0 until spec.cols) {
                val x = px(gx)
                for (gy in 0 until spec.rows) c.drawCircle(x, py(gy), r, p)
            }
        }
        outro.draw(c, cell, Palette.ACCENT, Palette.ACCENT2)
        if (boardGlow > 0f) {
            paint.reset(); paint.isAntiAlias = true
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = dp(3f) * boardGlow
            paint.color = Palette.withAlpha(Palette.ACCENT2, (70 * boardGlow).toInt())
            c.drawRoundRect(boardRect, cell * 0.4f, cell * 0.4f, paint)
            paint.style = Paint.Style.FILL
        }
    }

    private fun drawArrows(c: Canvas) {
        // resting arrows first, moving ones on top
        for (pass in 0..1) {
            for (a in spec.arrows) {
                val v = vis[a.id]
                if (v.motion == Motion.GONE) continue
                if (!v.active && v.motion != Motion.LAUNCH && v.motion != Motion.IGNITE &&
                    v.motion != Motion.ANTICIPATE) continue
                val moving = v.motion == Motion.LAUNCH || v.motion == Motion.IGNITE ||
                    v.motion == Motion.ANTICIPATE
                if ((pass == 1) != moving) continue
                drawArrow(c, a, v)
            }
        }
        if (pressedArrow >= 0) drawExitPreview(c, spec.arrows[pressedArrow])
    }

    private fun drawArrow(c: Canvas, a: ArrowPath, v: Vis) {
        val track = v.track ?: return
        val flameSkin = skin.effect == Skin.Effect.FLAME

        var tail = skin.inkTail
        var head = skin.inkHead
        var glowW = skin.glowWidth * cell
        var glowC = skin.glowColor

        if (v.blockedFlash > 0f) {
            val t = Ease.outCubic(v.blockedFlash)
            tail = Palette.lerpColor(tail, Palette.DANGER, t)
            head = tail
            glowW = max(glowW, cell * 0.10f * t); glowC = Palette.DANGER
        } else if (v.impactFlash > 0f) {
            val t = Ease.outCubic(v.impactFlash) * 0.45f
            tail = Palette.lerpColor(tail, Palette.DANGER, t)
            head = tail
            glowW = max(glowW, cell * 0.06f * t); glowC = Palette.DANGER
        } else if (hintTarget == a.id && hintGlow > 0f) {
            val env = (hintGlow / 1.6f).coerceAtMost(1f)
            val pulse = sin(hintPhase) * 0.5f + 0.5f
            tail = Palette.lerpColor(tail, Palette.ACCENT, (0.5f + 0.35f * pulse) * env)
            head = tail
            glowW = max(glowW, cell * (0.09f + 0.06f * pulse) * env); glowC = Palette.ACCENT
        } else if (pressedArrow == a.id || v.selectGlow > 0f) {
            val t = if (pressedArrow == a.id) 1f else v.selectGlow
            tail = Palette.lerpColor(tail, Palette.ACCENT, 0.8f * t)
            head = tail
            glowW = max(glowW, cell * 0.08f * t); glowC = Palette.ACCENT
        } else if (v.motion == Motion.LAUNCH && !flameSkin) {
            tail = Palette.lerpColor(tail, Palette.ACCENT, 0.75f)
            head = tail
            glowW = max(glowW, cell * 0.07f); glowC = Palette.ACCENT
        }

        // negative travel is a rigid recoil, drawn as a translate so the
        // whole arrow pulls back instead of squashing against the tail
        val back = min(v.travel, 0f)
        val recoilPx = if (v.recoil > 0f) cell * 0.055f * exp(-3.2f * (1f - v.recoil)) * v.recoil
        else 0f
        val offX = a.headDir.dx * back + a.headDir.dx * recoilPx
        val offY = a.headDir.dy * back + a.headDir.dy * recoilPx
        val drawTravel = max(v.travel, 0f)

        if (v.geomTravel != drawTravel || v.geomVersion != Skins.version) {
            ArrowDraw.buildGeometry(track, drawTravel, v.bodyLen, cell, v.bodyPath, v.headPath)
            v.geomTravel = drawTravel
            v.geomVersion = Skins.version
        }

        c.save()
        if (offX != 0f || offY != 0f) c.translate(offX, offY)

        if (v.motion == Motion.LAUNCH && v.trail > 0f && !flameSkin) drawTrail(c, track, v)

        if (flameSkin && (v.motion == Motion.IGNITE || v.motion == Motion.ANTICIPATE ||
                    v.motion == Motion.LAUNCH)) {
            val trailLen = if (v.motion == Motion.LAUNCH)
                (v.speed * 0.075f).coerceIn(cell * 0.5f, cell * 4.4f) else 0f
            flame.drawBehind(c, track, drawTravel, v.bodyLen, cell, v.igniteFront, trailLen,
                time, v.seed)
            ArrowDraw.paint(c, v.bodyPath, v.headPath, cell, tail, head, 255, glowW, glowC)
            flame.drawFront(c, track, drawTravel, v.bodyLen, cell, v.igniteFront, trailLen,
                time, v.seed)
            if (v.motion == Motion.IGNITE) {
                flame.drawTongue(c, track, drawTravel + v.bodyLen * v.igniteFront, cell, time)
            }
        } else {
            ArrowDraw.paint(c, v.bodyPath, v.headPath, cell, tail, head, 255, glowW, glowC)
        }
        c.restore()
    }

    /** Dashed preview of where the pressed arrow would go, and what stops it. */
    private fun drawExitPreview(c: Canvas, a: ArrowPath) {
        val blocker = BoardLogic.firstBlocker(a, game.remaining)
        val hx = px(a.head.first) + a.headDir.dx * cell * 0.62f
        val hy = py(a.head.second) + a.headDir.dy * cell * 0.62f
        val endX: Float
        val endY: Float
        val col: Int
        if (blocker == null) {
            endX = hx + a.headDir.dx * (width + height).toFloat()
            endY = hy + a.headDir.dy * (width + height).toFloat()
            col = Palette.withAlpha(skin.accent, 130)
        } else {
            endX = px(a.head.first) + a.headDir.dx * blocker.second * cell
            endY = py(a.head.second) + a.headDir.dy * blocker.second * cell
            col = Palette.withAlpha(Palette.DANGER, 160)
            vis[blocker.first.id].selectGlow = max(vis[blocker.first.id].selectGlow, 0.55f)
        }
        rayPaint.color = col
        rayPaint.strokeWidth = cell * 0.07f
        rayPaint.pathEffect = DashPathEffect(
            floatArrayOf(cell * 0.20f, cell * 0.16f), -(time * cell * 1.4f))
        c.drawLine(hx, hy,
            endX.coerceIn(-cell, width + cell), endY.coerceIn(-cell, height + cell), rayPaint)
        rayPaint.pathEffect = null
    }

    private fun drawTrail(c: Canvas, track: Track, v: Vis) {
        val len = (v.speed * 0.050f).coerceIn(cell * 0.6f, cell * 4f)
        val back = (v.travel - len).coerceAtLeast(0f)
        track.subPath(back, v.travel + v.bodyLen * 0.25f, scratchPath, tmpPt)
        val widths = floatArrayOf(1.0f, 0.72f, 0.44f)
        val alphas = intArrayOf(96, 56, 26)
        for (i in 0..2) {
            trailPaint.strokeWidth = cell * ArrowDraw.STROKE_F * widths[i]
            trailPaint.color = Palette.withAlpha(skin.trailColor, (alphas[i] * v.trail).toInt())
            c.drawPath(scratchPath, trailPaint)
        }
    }

    private fun drawFooter(c: Canvas) {
        drawCircleButton(c, btnHint)
        val hintsLeft = game.hintsLeft
        Glyphs.bulb(c, btnHint.rect.centerX(), btnHint.rect.centerY(), dp(29f),
            iconPaint(if (hintsLeft > 0) Palette.GOLD else Palette.withAlpha(Palette.GOLD, 90),
                dp(2.5f)))
        // count badge
        val bx = btnHint.rect.right - dp(4f)
        val by = btnHint.rect.top + dp(4f)
        c.drawCircle(bx, by, dp(11f),
            fillPaint(if (hintsLeft > 0) Palette.ACCENT else Palette.withAlpha(Palette.TEXT_DIM, 150)))
        drawText(c, "$hintsLeft", bx, by + dp(4f), dp(11f), 0xFFFFFFFF.toInt(), Fonts.black)

        drawCircleButton(c, btnRestart)
        Glyphs.restart(c, btnRestart.rect.centerX(), btnRestart.rect.centerY(), dp(29f),
            iconPaint(Palette.ACCENT, dp(2.5f)), fillPaint(Palette.ACCENT))
    }

    // ------------------------------------------------------------- tutorial

    private fun drawTutorial(c: Canvas) {
        val msg = when (tutorialStage) {
            1 -> "Tap a free arrow"
            2 -> "Red means blocked - clear its path first"
            else -> "Clear the board"
        }
        val alpha = (255 * Ease.outCubic(tutorialBannerT)).toInt()
        drawText(c, msg, width / 2f, boardRect.top - dp(12f), dp(14f),
            Palette.withAlpha(Palette.TEXT_DIM, alpha), Fonts.bold)

        if (tutorialStage == 2) {
            val blocked = game.remaining.firstOrNull { it.id == tutorialBlockedId } ?: return
            val mid = blocked.pts[blocked.pts.size / 2]
            val cx = px(mid.first); val cy = py(mid.second)
            val pulse = (sin(tutorialT * 3.4f) * 0.5f + 0.5f)
            c.drawCircle(cx, cy, cell * (0.42f + 0.2f * pulse),
                iconPaint(Palette.withAlpha(Palette.DANGER, (120 * (1f - pulse * 0.5f)).toInt()),
                    dp(2.2f)))
            return
        }
        if (tutorialStage != 1) return
        val target = game.remaining.firstOrNull { it.id == tutorialTargetId } ?: return
        if (vis[target.id].motion != Motion.IDLE) return
        val mid = target.pts[target.pts.size / 2]
        val cx = px(mid.first); val cy = py(mid.second)
        val cycle = (tutorialT % 1.6f) / 1.6f
        val ringT = (cycle / 0.55f).coerceAtMost(1f)
        c.drawCircle(cx, cy, cell * (0.32f + 0.55f * ringT),
            iconPaint(Palette.withAlpha(Palette.ACCENT, ((1f - ringT) * 150).toInt()), dp(2.4f)))
        val dip = if (cycle < 0.18f) sin(cycle / 0.18f * Math.PI).toFloat() else 0f
        drawFinger(c, cx + cell * 0.22f - dip * dp(3f), cy + cell * 0.30f - dip * dp(5f),
            max(cell * 0.78f, dp(30f)))
    }

    private fun drawFinger(c: Canvas, x: Float, y: Float, s: Float) {
        scratchPath.rewind()
        scratchPath.moveTo(x, y)
        scratchPath.lineTo(x - s * 0.10f, y + s * 0.30f)
        scratchPath.cubicTo(x - s * 0.16f, y + s * 0.42f, x - s * 0.06f, y + s * 0.52f,
            x + s * 0.10f, y + s * 0.52f)
        scratchPath.lineTo(x + s * 0.30f, y + s * 0.52f)
        scratchPath.cubicTo(x + s * 0.42f, y + s * 0.52f, x + s * 0.44f, y + s * 0.36f,
            x + s * 0.36f, y + s * 0.24f)
        scratchPath.lineTo(x + s * 0.16f, y + s * 0.02f)
        scratchPath.cubicTo(x + s * 0.10f, y - s * 0.05f, x + s * 0.03f, y - s * 0.04f, x, y)
        scratchPath.close()
        c.drawPath(scratchPath, fillPaint(0xFFFFFFFF.toInt()))
        c.drawPath(scratchPath, iconPaint(Palette.withAlpha(0xFF101B3A.toInt(), 90), s * 0.045f))
    }

    // ------------------------------------------------------------- overlays

    private fun scrim(c: Canvas, alpha: Float) {
        c.drawColor(Palette.withAlpha(skin.scrim, (alpha * 170).toInt()))
    }

    private fun drawPauseOverlay(c: Canvas) {
        scrim(c, overlayT)
        val a = Ease.outCubic(overlayT)
        c.save()
        c.scale(Ease.lerp(0.94f, 1f, a), Ease.lerp(0.94f, 1f, a),
            panelRect.centerX(), panelRect.centerY())
        drawCard(c, panelRect, dp(26f), Palette.CARD, Palette.CARD_EDGE, 40, dp(10f), dp(24f))
        drawText(c, "PAUSED", panelRect.centerX(), panelRect.top + dp(48f), dp(22f),
            Palette.TEXT, Fonts.black, letterSpacing = 0.12f)
        toggleRow(c, btnSound, "Sound", act.settings.sound, 0)
        toggleRow(c, btnMusic, "Music", act.settings.music, 1)
        toggleRow(c, btnHaptics, "Haptics", act.settings.haptics, 2)
        drawPillButton(c, btnResume, "RESUME", dp(16f), true)
        drawPillButton(c, btnPauseRestart, "RESTART", dp(13.5f), false)
        drawPillButton(c, btnPauseMenu, "MENU", dp(13.5f), false)
        c.restore()
    }

    private fun toggleRow(c: Canvas, b: UiButton, label: String, on: Boolean, idx: Int) {
        val y = b.rect.centerY()
        val ix = panelRect.left + dp(34f)
        when (idx) {
            0 -> Glyphs.speaker(c, ix, y, dp(22f), iconPaint(Palette.TEXT, dp(2f)),
                fillPaint(Palette.TEXT))
            1 -> Glyphs.note(c, ix, y, dp(22f), iconPaint(Palette.TEXT, dp(2f)),
                fillPaint(Palette.TEXT))
            else -> Glyphs.vibrate(c, ix, y, dp(22f), iconPaint(Palette.TEXT, dp(2f)))
        }
        drawText(c, label, ix + dp(24f), y + dp(6f), dp(15f), Palette.TEXT, Fonts.bold,
            Paint.Align.LEFT)
        rectTmp.set(b.rect)
        val radius = rectTmp.height() / 2f
        paint.reset(); paint.isAntiAlias = true
        paint.color = if (on) Palette.ACCENT else skin.toggleOff
        c.drawRoundRect(rectTmp, radius, radius, paint)
        paint.color = skin.knob
        c.drawCircle(if (on) rectTmp.right - radius else rectTmp.left + radius,
            rectTmp.centerY(), rectTmp.height() * 0.38f, paint)
    }

    private fun drawCompleteOverlay(c: Canvas) {
        scrim(c, overlayT)
        val a = Ease.outBack(overlayT.coerceIn(0f, 1f)).coerceIn(0f, 1.3f)
        c.save()
        c.scale(Ease.lerp(0.9f, 1f, a), Ease.lerp(0.9f, 1f, a),
            resultCard.centerX(), resultCard.centerY())
        drawCard(c, resultCard, dp(26f), Palette.CARD, Palette.CARD_EDGE, 44, dp(10f), dp(24f))
        drawText(c, "LEVEL COMPLETE", resultCard.centerX(), resultCard.top + dp(56f), dp(21f),
            Palette.TEXT, Fonts.black, letterSpacing = 0.08f)
        drawText(c, spec.title.uppercase(), resultCard.centerX(), resultCard.top + dp(80f),
            dp(11f), Palette.TEXT_DIM, Fonts.bold, letterSpacing = 0.2f)

        for (i in 0 until 3) {
            val cx = starX(i)
            val cy = resultCard.top + dp(140f)
            val filled = i < starsShown
            if (starAge[i] >= 0f) outro.starRing(c, cx, cy, starAge[i], dp(50f), Palette.GOLD)
            val pop = if (starAge[i] >= 0f)
                Ease.lerp(0.4f, 1f, Ease.outBack((starAge[i] / 0.28f).coerceIn(0f, 1f))) else 0.62f
            val s = if (filled) pop else 0.62f
            c.save()
            c.scale(s, s, cx, cy)
            Glyphs.star(c, cx, cy, dp(50f),
                fillPaint(if (filled) Palette.GOLD else Palette.withAlpha(Palette.TEXT_DIM, 60)))
            c.restore()
        }
        val par = maxOf(1, spec.arrows.size / 10)
        drawText(c, "3 stars: no mistakes  ·  2 stars: up to $par",
            resultCard.centerX(), resultCard.top + dp(182f), dp(10.5f),
            Palette.TEXT_DIM, Fonts.medium)

        val secs = game.elapsedMs / 1000
        val best = act.progress.bestTimeMs(levelNum) / 1000
        drawText(c, String.format("Time  %d:%02d", secs / 60, secs % 60),
            resultCard.centerX(), resultCard.top + dp(224f), dp(15f), Palette.TEXT, Fonts.bold)
        if (best > 0) {
            drawText(c, String.format("Best  %d:%02d", best / 60, best % 60),
                resultCard.centerX(), resultCard.top + dp(250f), dp(12.5f),
                Palette.TEXT_DIM, Fonts.medium)
        }
        drawText(c, "Mistakes  ${game.mistakes}", resultCard.centerX(),
            resultCard.top + dp(276f), dp(12.5f), Palette.TEXT_DIM, Fonts.medium)
        c.restore()

        if (overlayT > 0.55f) {
            val f = ((overlayT - 0.55f) / 0.45f).coerceIn(0f, 1f)
            c.save()
            c.translate(0f, (1f - Ease.outCubic(f)) * dp(14f))
            val last = levelNum >= Levels.all.size
            drawPillButton(c, btnPrimary, if (last) "LEVEL SELECT" else "NEXT LEVEL", dp(16f), true)
            drawPillButton(c, btnSecondary, "LEVELS", dp(14f), false)
            c.restore()
        }
    }

    private fun drawFailOverlay(c: Canvas) {
        scrim(c, overlayT)
        val a = Ease.outCubic(overlayT)
        c.save()
        c.scale(Ease.lerp(0.92f, 1f, a), Ease.lerp(0.92f, 1f, a),
            resultCard.centerX(), resultCard.centerY())
        drawCard(c, resultCard, dp(26f), Palette.CARD, Palette.CARD_EDGE, 44, dp(10f), dp(24f))
        drawText(c, "OUT OF HEARTS", resultCard.centerX(), resultCard.top + dp(64f), dp(21f),
            Palette.TEXT, Fonts.black, letterSpacing = 0.06f)
        drawText(c, "Blocked ${game.mistakes} times", resultCard.centerX(),
            resultCard.top + dp(96f), dp(13f), Palette.TEXT_DIM, Fonts.medium)
        drawText(c, "An arrow can only leave when nothing", resultCard.centerX(),
            resultCard.top + dp(150f), dp(13f), Palette.TEXT, Fonts.medium)
        drawText(c, "stands in front of its head.", resultCard.centerX(),
            resultCard.top + dp(172f), dp(13f), Palette.TEXT, Fonts.medium)
        drawText(c, "Press and hold an arrow to see its path.", resultCard.centerX(),
            resultCard.top + dp(212f), dp(12f), Palette.ACCENT, Fonts.bold)
        c.restore()
        if (overlayT > 0.55f) {
            drawPillButton(c, btnPrimary, "TRY AGAIN", dp(16f), true)
            drawPillButton(c, btnSecondary, "LEVELS", dp(14f), false)
        }
    }
}
