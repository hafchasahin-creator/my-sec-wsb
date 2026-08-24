package com.veergames.veer

import com.veergames.veer.core.ArrowPath
import com.veergames.veer.core.BoardLogic
import com.veergames.veer.core.GameController
import com.veergames.veer.core.LevelSpec
import com.veergames.veer.core.Levels

/**
 * Pure-JVM test suite for the puzzle core (no Android dependencies).
 * Run: tools/run_tests.sh
 */
object CoreTests {

    private var failures = 0
    private var checks = 0

    private fun check(cond: Boolean, msg: String) {
        checks++
        if (!cond) { failures++; println("  FAIL: $msg") }
    }

    private fun section(name: String) = println("\n== $name ==")

    @JvmStatic
    fun main(args: Array<String>) {
        testArrowGeometry()
        testCollisionSemantics()
        testAllLevelsValid()
        testEveryLevelPlayableToCompletion()
        testHintsAreAlwaysSafe()
        testHeartsAndFailure()
        testDifficultyCurve()
        testBoardsFitTouchTargets()
        testScaling()
        testHintBudget()
        testBlockerReporting()
        testStreamingSelfRule()

        println("\n$checks checks, $failures failures")
        if (failures > 0) {
            System.exit(1)
        } else {
            println("ALL TESTS PASSED")
        }
    }

    private fun testArrowGeometry() {
        section("arrow geometry")
        val a = ArrowPath(0, listOf(1 to 1, 1 to 4, 4 to 4))
        check(a.covered.size == 7, "L-path covers 7 lattice points, got ${a.covered.size}")
        check(a.bodyLen == 6, "body length 6, got ${a.bodyLen}")
        check(a.headDir == com.veergames.veer.core.Dir.RIGHT, "head points right")

        var threw = false
        try { ArrowPath(1, listOf(0 to 0, 2 to 2)) } catch (e: IllegalArgumentException) { threw = true }
        check(threw, "diagonal segment rejected")

        threw = false
        try { ArrowPath(2, listOf(0 to 0, 3 to 0, 1 to 0)) } catch (e: IllegalArgumentException) { threw = true }
        check(threw, "180-degree reversal rejected")

        threw = false
        try { ArrowPath(3, listOf(0 to 0, 2 to 0, 2 to 2, 0 to 2, 0 to 0, 1 to 0)) }
        catch (e: IllegalArgumentException) { threw = true }
        check(threw, "self-overlapping path rejected")
    }

    private fun testCollisionSemantics() {
        section("collision")
        // A points right along y=0; B sits in its path at x=5
        val a = ArrowPath(0, listOf(0 to 0, 3 to 0))
        val b = ArrowPath(1, listOf(5 to -1, 5 to 2))
        check(BoardLogic.blockDistance(a, b) == 2, "blocked at distance 2, got ${BoardLogic.blockDistance(a, b)}")
        check(!BoardLogic.isFree(a, listOf(a, b)), "A is blocked by B")
        check(BoardLogic.isFree(a, listOf(a)), "A is free once B is gone")
        check(BoardLogic.isFree(b, listOf(a, b)), "B (heading down) is not blocked by A behind it")

        // parallel neighbours never block
        val c = ArrowPath(2, listOf(0 to 3, 3 to 3))
        check(BoardLogic.blockDistance(a, c) == null, "parallel lane does not block")

        // an arrow directly behind another, same direction: blocked
        val d = ArrowPath(3, listOf(0 to 5, 2 to 5))
        val e = ArrowPath(4, listOf(4 to 5, 6 to 5))
        check(!BoardLogic.isFree(d, listOf(d, e)), "same-direction tailgater is blocked")
        check(BoardLogic.isFree(e, listOf(d, e)), "leader is free")
    }

    private fun testAllLevelsValid() {
        section("level validation")
        check(Levels.all.size == 10, "10 demo levels, got ${Levels.all.size}")
        for (spec in Levels.all) {
            try {
                val rounds = spec.validate()
                check(rounds.isNotEmpty(), "L${spec.num} has rounds")
            } catch (e: Exception) {
                check(false, "L${spec.num} validation: ${e.message}")
            }
        }
    }

    /** Plays every level to completion using only genuinely-free arrows. */
    private fun testEveryLevelPlayableToCompletion() {
        section("full playthroughs")
        for (spec in Levels.all) {
            val g = GameController(spec)
            var guard = 0
            while (g.state == GameController.State.PLAYING && guard++ < 400) {
                val free = BoardLogic.freeSet(g.remaining)
                if (free.isEmpty()) break
                val res = g.tap(free.first().id)
                check(res is GameController.TapResult.Escaped,
                    "L${spec.num}: tapping a free arrow escapes (got $res)")
            }
            check(g.state == GameController.State.COMPLETE,
                "L${spec.num} completes, ended ${g.state} with ${g.remainingCount} left")
            check(g.hearts == g.maxHearts, "L${spec.num} perfect run loses no hearts")
            check(g.stars() == 3, "L${spec.num} perfect run scores 3 stars")
        }
    }

    /** Hints must reference the live board, and must never be a wrong move. */
    private fun testHintsAreAlwaysSafe() {
        section("hints")
        for (spec in Levels.all) {
            val g = GameController(spec, hintBudget = Int.MAX_VALUE)
            var guard = 0
            while (g.state == GameController.State.PLAYING && guard++ < 400) {
                val hint = g.hint()
                check(hint != null, "L${spec.num}: a hint exists while arrows remain")
                if (hint == null) break
                check(BoardLogic.isFree(hint, g.remaining),
                    "L${spec.num}: hinted arrow ${hint.id} is actually free")
                val res = g.tap(hint.id)
                check(res is GameController.TapResult.Escaped,
                    "L${spec.num}: hinted arrow escapes when tapped")
            }
            check(g.state == GameController.State.COMPLETE, "L${spec.num} solvable by hints alone")
        }
    }

    private fun testHeartsAndFailure() {
        section("hearts / lives")
        // find a level with a blocked arrow at the start
        val spec = Levels.all.first { s -> s.arrows.any { !BoardLogic.isFree(it, s.arrows) } }
        val g = GameController(spec)
        val blocked = spec.arrows.first { !BoardLogic.isFree(it, spec.arrows) }

        val hearts0 = g.maxHearts
        var r = g.tap(blocked.id)
        check(r is GameController.TapResult.Blocked, "blocked tap reports Blocked")
        check(g.hearts == hearts0 - 1, "one heart lost, got ${g.hearts}")
        check(g.mistakes == 1, "mistake counted")
        check(g.remainingCount == spec.arrows.size, "blocked arrow stays on the board")

        // cooldown suppresses instant double-taps on the same arrow
        r = g.tap(blocked.id)
        check(r is GameController.TapResult.Ignored, "rapid re-tap is ignored (cooldown)")
        check(g.hearts == hearts0 - 1, "cooldown tap costs no heart")

        g.tick(600_000)
        r = g.tap(blocked.id)
        check(r is GameController.TapResult.Blocked, "after cooldown the tap registers again")
        check(g.hearts == hearts0 - 2, "second heart lost, got ${g.hearts}")

        while (g.hearts > 0) {
            g.tick(600_000)
            r = g.tap(blocked.id)
        }
        check(g.state == GameController.State.FAILED, "zero hearts fails the run")
        check((r as GameController.TapResult.Blocked).failed, "failure reported on the result")
        check(g.tap(BoardLogic.freeSet(g.remaining).first().id) is GameController.TapResult.Ignored,
            "no taps register after failure")
    }

    private fun testDifficultyCurve() {
        section("difficulty curve")
        // the density brief the game is built to
        val bands = arrayOf(4..5, 6..7, 8..10, 10..12, 12..15, 15..18, 18..22,
            22..26, 25..30, 30..40)
        var prevArrows = 0
        val depths = ArrayList<Int>()
        for ((i, spec) in Levels.all.withIndex()) {
            val rounds = spec.validate()
            depths.add(rounds.size)
            check(spec.arrows.size in bands[i],
                "L${spec.num} has ${spec.arrows.size} arrows, brief wants ${bands[i]}")
            check(spec.arrows.size >= prevArrows,
                "L${spec.num} does not shrink (${spec.arrows.size} vs $prevArrows)")
            prevArrows = spec.arrows.size
        }
        check(depths.last() >= 8, "finale needs deep ordering, got ${depths.last()}")
        // no lonely one-cell sticks; real bent shapes throughout
        for (spec in Levels.all) {
            check(spec.arrows.none { it.bodyLen < 2 }, "L${spec.num} has a stub arrow")
            val bent = spec.arrows.count { it.pts.size > 2 }
            check(bent >= spec.arrows.size / 3,
                "L${spec.num}: only $bent of ${spec.arrows.size} arrows bend")
        }
        // every level must force ordering, and must not hand out the board
        for (spec in Levels.all) {
            val blockedAtStart = spec.arrows.count { !BoardLogic.isFree(it, spec.arrows) }
            check(blockedAtStart >= 2, "L${spec.num} has real blocking (got $blockedAtStart)")
            val freeAtStart = spec.arrows.size - blockedAtStart
            check(freeAtStart <= maxOf(3, spec.arrows.size / 4),
                "L${spec.num} opens with $freeAtStart free arrows - too many giveaways")
            // an arrow whose head sits on the border can never be blocked
            val permanent = spec.arrows.count { a ->
                val hx = a.head.first + a.headDir.dx
                val hy = a.head.second + a.headDir.dy
                hx < 0 || hy < 0 || hx >= spec.cols || hy >= spec.rows
            }
            check(permanent <= 2, "L${spec.num} has $permanent permanently-free arrows")
        }
    }

    /**
     * Boards must stay tappable on a small phone. Mirrors GameView.layoutBoard
     * exactly, so the test cannot drift away from the real layout.
     */
    private fun testBoardsFitTouchTargets() {
        section("layout sanity")
        // 360x640dp worst case, minus the same chrome the game reserves
        val availW = 360f - 12f * 2
        val availH = 640f - 28f - 12f - 96f - 104f
        for (spec in Levels.all) {
            val cellW = availW / (spec.cols - 1 + 1.15f)
            val cellH = availH / (spec.rows - 1 + 1.15f)
            val cellDp = minOf(cellW, cellH)
            check(cellDp >= 24f, "L${spec.num} cell ${"%.1f".format(cellDp)}dp >= 24dp")
        }
    }

    /** Hearts and star pars must scale with board size. */
    private fun testScaling() {
        section("hearts and stars")
        for (spec in Levels.all) {
            val g = GameController(spec)
            check(g.maxHearts >= 3, "L${spec.num} has at least 3 hearts")
            check(g.maxHearts <= 7, "L${spec.num} hearts stay sane (${g.maxHearts})")
        }
        val finale = Levels.all.last()
        check(GameController(finale).maxHearts > GameController(Levels.all.first()).maxHearts,
            "the finale is more forgiving than the tutorial")
    }

    /** The hint budget is finite, but must never point at an illegal move. */
    private fun testHintBudget() {
        section("hint budget")
        val spec = Levels.all[4]
        val g = GameController(spec)
        check(g.hintsLeft == 3, "three hints per level, got ${g.hintsLeft}")
        var used = 0
        while (true) {
            val h = g.hint() ?: break
            check(BoardLogic.isFree(h, g.remaining), "hint $used is genuinely free")
            used++
            check(used <= 3, "hints cannot exceed the budget")
        }
        check(used == 3, "all three hints are usable, got $used")
        check(g.hint() == null, "a spent budget returns no hint")
    }

    /** A blocked arrow must report the blocker the animation will hit. */
    private fun testBlockerReporting() {
        section("blocker reporting")
        for (spec in Levels.all) {
            val g = GameController(spec)
            val blocked = spec.arrows.firstOrNull { !BoardLogic.isFree(it, spec.arrows) }
                ?: continue
            val res = g.tap(blocked.id)
            check(res is GameController.TapResult.Blocked, "L${spec.num}: blocked tap reports it")
            val b = res as GameController.TapResult.Blocked
            check(b.gap >= 1, "L${spec.num}: gap is at least one cell (got ${b.gap})")
            check(b.blocker.id != blocked.id, "L${spec.num}: blocker is another arrow")
            // the reported blocker must really sit on the ray at that distance
            val d = b.arrow.headDir
            val key = com.veergames.veer.core.ArrowPath.key(
                blocked.head.first + d.dx * b.gap, blocked.head.second + d.dy * b.gap)
            check(key in b.blocker.coveredSet,
                "L${spec.num}: blocker actually occupies the impact cell")
        }
    }

    /** Spiral shapes: a head may cross a cell its own tail has vacated. */
    private fun testStreamingSelfRule() {
        section("streaming self-collision")
        // a hook whose exit ray passes over its own tail cell: legal, because
        // by the time the head gets there the tail has moved on
        val hook = ArrowPath(0, listOf(0 to 0, 3 to 0, 3 to 2, 0 to 2, 0 to 1))
        check(!BoardLogic.selfBlocks(hook), "hook clears its own vacated tail")
        // a spiral that closes on itself: the head aims at body cell index 1,
        // which is still occupied when the head arrives one step later
        val trap = ArrowPath(1, listOf(0 to 0, 4 to 0, 4 to 3, 1 to 3, 1 to 1))
        check(BoardLogic.selfBlocks(trap), "a head aimed into its own standing body is blocked")
        // and the rule is index-sensitive, not a blanket ban on own cells
        check(!BoardLogic.isFree(trap, listOf(trap)), "self-blocked arrow is never free")
    }
}
