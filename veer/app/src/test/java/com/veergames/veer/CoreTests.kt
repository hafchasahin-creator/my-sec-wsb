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
            while (g.state == GameController.State.PLAYING && guard++ < 200) {
                val free = BoardLogic.freeSet(g.remaining)
                if (free.isEmpty()) break
                val res = g.tap(free.first().id)
                check(res is GameController.TapResult.Escaped,
                    "L${spec.num}: tapping a free arrow escapes (got $res)")
            }
            check(g.state == GameController.State.COMPLETE,
                "L${spec.num} completes, ended ${g.state} with ${g.remainingCount} left")
            check(g.hearts == 3, "L${spec.num} perfect run keeps 3 hearts")
            check(g.stars() == 3, "L${spec.num} perfect run scores 3 stars")
        }
    }

    /** Hints must reference the live board, and must never be a wrong move. */
    private fun testHintsAreAlwaysSafe() {
        section("hints")
        for (spec in Levels.all) {
            val g = GameController(spec)
            var guard = 0
            while (g.state == GameController.State.PLAYING && guard++ < 200) {
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

        var r = g.tap(blocked.id)
        check(r is GameController.TapResult.Blocked, "blocked tap reports Blocked")
        check(g.hearts == 2, "one heart lost, got ${g.hearts}")
        check(g.mistakes == 1, "mistake counted")
        check(g.remainingCount == spec.arrows.size, "blocked arrow stays on the board")

        // cooldown suppresses instant double-taps on the same arrow
        r = g.tap(blocked.id)
        check(r is GameController.TapResult.Ignored, "rapid re-tap is ignored (cooldown)")
        check(g.hearts == 2, "cooldown tap costs no heart")

        g.tick(600)
        r = g.tap(blocked.id)
        check(r is GameController.TapResult.Blocked, "after cooldown the tap registers again")
        check(g.hearts == 1, "second heart lost, got ${g.hearts}")
        check(g.stars() == 1, "two mistakes -> 1 star")

        g.tick(600)
        r = g.tap(blocked.id)
        check(g.hearts == 0 && g.state == GameController.State.FAILED, "zero hearts fails the run")
        check((r as GameController.TapResult.Blocked).failed, "failure reported on the result")
        check(g.tap(BoardLogic.freeSet(g.remaining).first().id) is GameController.TapResult.Ignored,
            "no taps register after failure")
    }

    private fun testDifficultyCurve() {
        section("difficulty curve")
        var prevArrows = 0
        val depths = ArrayList<Int>()
        for (spec in Levels.all) {
            val rounds = spec.validate()
            depths.add(rounds.size)
            check(spec.arrows.size >= prevArrows - 1,
                "L${spec.num} does not shrink sharply (${spec.arrows.size} vs $prevArrows)")
            prevArrows = spec.arrows.size
        }
        check(Levels.all.first().arrows.size <= 4, "level 1 is a small tutorial board")
        check(Levels.all.last().arrows.size >= 14, "finale is large")
        check(depths.last() >= 5, "finale needs deep ordering, got ${depths.last()}")
        check(depths.max() >= 6, "at least one level requires 6+ ordered rounds")
        // every level beyond the first must force at least one wrong-looking choice
        for (spec in Levels.all.drop(1)) {
            val blockedAtStart = spec.arrows.count { !BoardLogic.isFree(it, spec.arrows) }
            check(blockedAtStart >= 2, "L${spec.num} has real blocking (got $blockedAtStart)")
        }
    }

    /** Boards must stay coarse enough for comfortable thumbs on a small phone. */
    private fun testBoardsFitTouchTargets() {
        section("layout sanity")
        for (spec in Levels.all) {
            // narrowest common phone: 360dp wide, board gets ~312dp after margins
            val cellDp = 312f / (spec.cols - 1 + 1.35f)
            check(cellDp >= 30f, "L${spec.num} cell ${"%.1f".format(cellDp)}dp >= 30dp")
            check(spec.rows <= 12 && spec.cols <= 9, "L${spec.num} grid within portrait budget")
        }
    }
}
