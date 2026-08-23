package com.imran.runner

import com.imran.runner.core.GaitModel
import com.imran.runner.tracking.Fix
import com.imran.runner.tracking.RunEngine
import com.imran.runner.tracking.RunState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Regressions for the three faults reported from an actual run: the session pausing itself,
 * the speed readout sitting at 0.0 km/h while walking, and the runner not animating.
 *
 * Each one is reproduced against the real engine with synthetic fixes shaped like what a phone
 * actually delivers — including the awkward parts: mediocre accuracy, a receiver that reports
 * zero speed at walking pace, and the signal dropping out entirely.
 */
private const val METRES_PER_DEGREE = 111_194.93

private fun fix(
    north: Double,
    atMs: Long,
    accuracy: Float,
    reportedSpeed: Float? = null,
) = Fix(
    latitude = north / METRES_PER_DEGREE,
    longitude = 0.0,
    accuracyMeters = accuracy,
    speedMps = reportedSpeed ?: 0f,
    hasSpeed = reportedSpeed != null,
    atMs = atMs,
)

class WalkingSpeedRegressionTest {

    /** 5 km/h is an ordinary walking pace; it must not read as standing still. */
    @Test
    fun `a walk at typical street accuracy shows a real speed`() {
        val engine = RunEngine()
        engine.start(0L, 1_700_000_000_000L)
        var now = 0L
        var metres = 0.0
        val walkMps = 5.0 / 3.6

        // 18 m accuracy: perfectly ordinary with buildings either side, and above the 25 m
        // distance gate often enough that speed must not depend on it.
        engine.onFix(fix(metres, now, 18f, walkMps.toFloat()))
        repeat(60) {
            now += 1_000
            metres += walkMps
            engine.tick(now)
            engine.onFix(fix(metres, now, 18f, walkMps.toFloat()))
        }

        val kmh = engine.metrics(now).speedMps * 3.6
        assertTrue("walking showed $kmh km/h", kmh in 4.0..6.0)
    }

    /** Some receivers clamp their own speed to zero at walking pace. The geometry must win. */
    @Test
    fun `a walk survives a receiver that reports zero speed`() {
        val engine = RunEngine()
        engine.start(0L, 1_700_000_000_000L)
        var now = 0L
        var metres = 0.0
        val walkMps = 5.0 / 3.6

        engine.onFix(fix(metres, now, 10f, 0f))
        repeat(60) {
            now += 1_000
            metres += walkMps
            engine.tick(now)
            engine.onFix(fix(metres, now, 10f, reportedSpeed = 0f))
        }

        val kmh = engine.metrics(now).speedMps * 3.6
        assertTrue("receiver zero swallowed the walk: $kmh km/h", kmh > 3.0)
    }

    /** Fixes too loose for distance must still be allowed to say how fast you are going. */
    @Test
    fun `speed is sensed from fixes too loose to add distance`() {
        val engine = RunEngine()
        engine.start(0L, 1_700_000_000_000L)
        var now = 0L
        var metres = 0.0
        val walkMps = 6.0 / 3.6

        engine.onFix(fix(metres, now, 40f, walkMps.toFloat()))
        repeat(40) {
            now += 1_000
            metres += walkMps
            engine.tick(now)
            engine.onFix(fix(metres, now, 40f, walkMps.toFloat()))
        }

        val m = engine.metrics(now)
        assertTrue("loose fixes gave no speed: ${m.speedMps * 3.6}", m.speedMps * 3.6 > 4.0)
        // ...but they are still not trusted with the distance.
        assertEquals(0.0, m.distanceMeters, 0.001)
    }

    /** Standing still must settle to zero rather than reading GPS wobble as movement. */
    @Test
    fun `standing still settles to zero`() {
        val engine = RunEngine()
        engine.start(0L, 1_700_000_000_000L)
        var now = 0L
        val wobble = doubleArrayOf(0.0, 1.4, -1.1, 0.7, -1.6, 1.2, -0.5, 1.5)
        engine.onFix(fix(0.0, now, 12f, 0f))
        repeat(90) { i ->
            now += 1_000
            engine.tick(now)
            engine.onFix(fix(wobble[i % wobble.size], now, 12f, reportedSpeed = 0f))
        }
        val kmh = engine.metrics(now).speedMps * 3.6
        assertTrue("wobble read as $kmh km/h while standing", kmh < 1.0)
    }

    @Test
    fun `metres per second convert to km per hour`() {
        val engine = RunEngine()
        engine.start(0L, 1L)
        var now = 0L
        var metres = 0.0
        engine.onFix(fix(metres, now, 5f, 3f))
        repeat(40) {
            now += 1_000
            metres += 3.0
            engine.tick(now)
            engine.onFix(fix(metres, now, 5f, 3f))
        }
        // 3 m/s is 10.8 km/h.
        assertEquals(10.8, engine.metrics(now).speedMps * 3.6, 0.4)
    }
}

class SessionContinuityRegressionTest {

    /** Losing the signal must not stop the clock, and must not look like standing still. */
    @Test
    fun `losing gps keeps the session running and the clock ticking`() {
        val engine = RunEngine()
        engine.start(0L, 1_700_000_000_000L)
        var now = 0L
        var metres = 0.0
        engine.onFix(fix(metres, now, 8f, 3f))
        repeat(30) {
            now += 1_000
            metres += 3.0
            engine.tick(now)
            engine.onFix(fix(metres, now, 8f, 3f))
        }
        val elapsedBefore = engine.metrics(now).elapsedMs

        // Two minutes in a tunnel: no fixes at all.
        repeat(120) {
            now += 1_000
            engine.tick(now)
        }

        val m = engine.metrics(now)
        assertEquals(RunState.RUNNING, m.state)
        assertEquals(elapsedBefore + 120_000L, m.elapsedMs)
        assertFalse("a two-minute-old fix is not recent", m.hasRecentFix)
    }

    @Test
    fun `a fresh fix is reported as recent and a stale one is not`() {
        val engine = RunEngine()
        engine.start(0L, 1L)
        engine.onFix(fix(0.0, 1_000L, 8f, 2f))
        assertTrue(engine.hasRecentFix(2_000L))
        assertFalse(engine.hasRecentFix(2_000L + RunEngine.SPEED_TIMEOUT_MS + 1))
    }

    @Test
    fun `pausing and resuming keeps one run rather than starting another`() {
        val engine = RunEngine()
        engine.start(0L, 1_700_000_000_000L)
        var now = 0L
        var metres = 0.0
        engine.onFix(fix(metres, now, 6f, 3f))
        repeat(20) {
            now += 1_000; metres += 3.0
            engine.tick(now); engine.onFix(fix(metres, now, 6f, 3f))
        }
        val distanceBefore = engine.metrics(now).distanceMeters

        engine.pause(now)
        repeat(30) { now += 1_000; engine.tick(now) }
        assertEquals(20_000L, engine.metrics(now).elapsedMs)

        engine.resume(now)
        repeat(20) {
            now += 1_000; metres += 3.0
            engine.tick(now); engine.onFix(fix(metres, now, 6f, 3f))
        }
        val m = engine.metrics(now)
        assertEquals(RunState.RUNNING, m.state)
        assertEquals(40_000L, m.elapsedMs)
        assertTrue("resumed run lost its distance", m.distanceMeters > distanceBefore)
    }
}

/**
 * The animation freezing is not something the compiler can catch, so the guarantee that the
 * figure always has something to move is asserted here.
 */
class RunnerAnimationRegressionTest {

    @Test
    fun `the figure always moves while a session is recording`() {
        var kmh = 0f
        while (kmh <= 20f) {
            val stride = GaitModel.strideFraction(kmh, tracking = true)
            val cycles = GaitModel.cyclesPerSecond(kmh, tracking = true)
            assertTrue("stride collapsed at $kmh km/h", stride > 0.01f)
            assertTrue("phase stopped advancing at $kmh km/h", cycles > 0.05f)
            kmh += 0.25f
        }
    }

    @Test
    fun `a stopped figure still shifts its weight`() {
        assertTrue(GaitModel.strideFraction(0f, tracking = false) > 0f)
        assertTrue(GaitModel.cyclesPerSecond(0f, tracking = false) > 0f)
    }

    @Test
    fun `posture moves from standing through walking to running as speed rises`() {
        assertEquals(0f, GaitModel.walkBlend(0f, tracking = false), 1e-6f)
        assertEquals(0f, GaitModel.runBlend(0f, tracking = false), 1e-6f)

        // Walking: a walking posture, not yet a running one.
        assertTrue(GaitModel.walkBlend(4f, tracking = true) > 0.5f)
        assertEquals(0f, GaitModel.runBlend(4f, tracking = true), 1e-6f)

        // Jogging: on the way over.
        val jogRun = GaitModel.runBlend(8f, tracking = true)
        assertTrue("jogging should be part-way into the run posture, was $jogRun", jogRun in 0.05f..0.95f)

        // Running: fully committed.
        assertEquals(1f, GaitModel.runBlend(14f, tracking = true), 1e-6f)
        assertTrue(GaitModel.walkBlend(14f, tracking = true) < 0.05f)
    }

    @Test
    fun `cadence rises with speed without ever becoming a flicker`() {
        val slow = GaitModel.cyclesPerSecond(4f, tracking = true)
        val quick = GaitModel.cyclesPerSecond(11f, tracking = true)
        val flatOut = GaitModel.cyclesPerSecond(20f, tracking = true)
        assertTrue("faster running should quicken the legs", quick > slow)
        assertTrue(flatOut >= quick)
        assertTrue("cadence became a flicker: $flatOut cycles/s", flatOut < 2.0f)
    }

    @Test
    fun `blends stay inside their range at every speed`() {
        var kmh = 0f
        while (kmh <= 30f) {
            for (tracking in listOf(true, false)) {
                val walk = GaitModel.walkBlend(kmh, tracking)
                val run = GaitModel.runBlend(kmh, tracking)
                assertTrue("walk $walk out of range at $kmh", walk in 0f..1f)
                assertTrue("run $run out of range at $kmh", run in 0f..1f)
                assertTrue("walk+run exceeded 1 at $kmh", walk + run <= 1.001f)
            }
            kmh += 0.5f
        }
    }
}
