package com.imran.runner

import com.imran.runner.tracking.Fix
import com.imran.runner.tracking.GpsQuality
import com.imran.runner.tracking.RunEngine
import com.imran.runner.tracking.RunState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Metres in one degree of latitude on the sphere the engine uses. */
private const val METRES_PER_DEGREE = 111_194.93

private fun fixAt(
    northMetres: Double,
    atMs: Long,
    accuracy: Float = 5f,
    speed: Float = 0f,
    hasSpeed: Boolean = false,
    altitude: Double = 0.0,
    hasAltitude: Boolean = false,
) = Fix(
    latitude = northMetres / METRES_PER_DEGREE,
    longitude = 0.0,
    altitudeMeters = altitude,
    hasAltitude = hasAltitude,
    accuracyMeters = accuracy,
    speedMps = speed,
    hasSpeed = hasSpeed,
    atMs = atMs,
)

/** Drives [engine] along a straight northward line, one fix per second. */
private fun straightLine(
    engine: RunEngine,
    seconds: Int,
    speedMps: Double,
    fromMs: Long,
    fromMetres: Double = 0.0,
    accuracy: Float = 5f,
    reportSpeed: Boolean = true,
): Pair<Long, Double> {
    var now = fromMs
    var metres = fromMetres
    engine.onFix(fixAt(metres, now, accuracy, speedMps.toFloat(), reportSpeed))
    repeat(seconds) {
        now += 1_000
        metres += speedMps
        engine.tick(now)
        engine.onFix(fixAt(metres, now, accuracy, speedMps.toFloat(), reportSpeed))
    }
    return now to metres
}

class RunEngineTest {

    private val epoch = 1_700_000_000_000L

    @Test
    fun `a steady run accumulates distance duration speed and pace`() {
        val engine = RunEngine(weightKg = 70.0)
        engine.start(100_000L, epoch)
        val (now, _) = straightLine(engine, seconds = 400, speedMps = 3.0, fromMs = 100_000L)

        val m = engine.metrics(now)
        assertEquals(RunState.RUNNING, m.state)
        assertEquals(1_200.0, m.distanceMeters, 3.0)
        assertEquals(400_000L, m.elapsedMs)
        assertEquals(3.0, m.avgSpeedMps, 0.05)
        assertEquals(3.0, m.speedMps, 0.05)
        // 3 m/s is a 5'33" kilometre.
        assertEquals(1_000.0 / 3.0, m.avgPaceSecPerKm, 3.0)
        assertTrue("route should have been recorded", m.routePointCount > 300)
    }

    @Test
    fun `kilometre splits are recorded as they are crossed`() {
        val engine = RunEngine()
        engine.start(0L, epoch)
        val (now, _) = straightLine(engine, seconds = 800, speedMps = 3.0, fromMs = 0L)

        val splits = engine.splitsSeconds()
        assertEquals(2, splits.size)
        splits.forEach { assertEquals(1_000.0 / 3.0, it, 4.0) }
        assertEquals(1_000.0 / 3.0, engine.metrics(now).lastKmPaceSecPerKm, 4.0)
    }

    @Test
    fun `a receiver jump is re-anchored rather than credited`() {
        val engine = RunEngine()
        engine.start(0L, epoch)
        var (now, metres) = straightLine(engine, seconds = 10, speedMps = 3.0, fromMs = 0L)
        val before = engine.metrics(now).distanceMeters

        // 800 m in one second: physically impossible, so it must not count.
        now += 1_000
        engine.tick(now)
        engine.onFix(fixAt(metres + 800.0, now, speed = 3f, hasSpeed = true))

        assertEquals(before, engine.metrics(now).distanceMeters, 0.001)
    }

    @Test
    fun `standing still barely moves the distance`() {
        val engine = RunEngine()
        engine.start(0L, epoch)
        var now = 0L
        engine.onFix(fixAt(0.0, now))
        // Two minutes of GPS wobble within a metre and a half of one spot.
        val wobble = doubleArrayOf(0.0, 1.1, -0.8, 0.5, -1.3, 0.9, -0.4, 1.2)
        repeat(120) { i ->
            now += 1_000
            engine.tick(now)
            engine.onFix(fixAt(wobble[i % wobble.size], now))
        }
        assertTrue(
            "wobble invented ${engine.metrics(now).distanceMeters} m",
            engine.metrics(now).distanceMeters < 5.0,
        )
    }

    @Test
    fun `slow movement is still credited in full`() {
        val engine = RunEngine()
        engine.start(0L, epoch)
        // 0.5 m/s: every single step is under the noise floor, so this only works if the held
        // anchor accumulates the displacement instead of discarding it.
        val (now, _) = straightLine(engine, seconds = 200, speedMps = 0.5, fromMs = 0L)
        assertEquals(100.0, engine.metrics(now).distanceMeters, 4.0)
    }

    @Test
    fun `a pause excludes both its time and its distance`() {
        val engine = RunEngine()
        engine.start(0L, epoch)
        var (now, metres) = straightLine(engine, seconds = 10, speedMps = 3.0, fromMs = 0L)

        engine.pause(now)
        // Travelling 300 m during the pause — a lift home, say — must not be recorded.
        repeat(60) {
            now += 1_000
            metres += 5.0
            engine.tick(now)
            engine.onFix(fixAt(metres, now, speed = 5f, hasSpeed = true))
        }
        assertEquals(RunState.PAUSED, engine.metrics(now).state)
        assertEquals(10_000L, engine.metrics(now).elapsedMs)
        assertEquals(0.0, engine.metrics(now).speedMps, 0.001)

        engine.resume(now)
        val (after, _) = straightLine(engine, 10, 3.0, now, metres)

        val m = engine.metrics(after)
        assertEquals(20_000L, m.elapsedMs)
        assertEquals(60.0, m.distanceMeters, 4.0)
    }

    @Test
    fun `calories track the runner's weight`() {
        fun burn(weight: Double): Double {
            val engine = RunEngine(weightKg = weight)
            engine.start(0L, epoch)
            val (now, _) = straightLine(engine, seconds = 600, speedMps = 3.0, fromMs = 0L)
            return engine.metrics(now).calories
        }
        val light = burn(60.0)
        val heavy = burn(120.0)
        assertTrue("expected a real burn, got $light", light > 50.0)
        assertEquals(light * 2.0, heavy, light * 0.02)
    }

    @Test
    fun `max speed ignores the warm-up and loose fixes`() {
        val engine = RunEngine()
        engine.start(0L, epoch)

        // Three seconds of sprinting inside the warm-up window: not a record.
        straightLine(engine, seconds = 3, speedMps = 9.0, fromMs = 0L)
        assertEquals(0.0, engine.metrics(3_000L).maxSpeedMps, 0.001)

        // A minute of fast running reported with 20 m accuracy: usable for distance, but too
        // loose to set a personal best on.
        val (now, metres) = straightLine(engine, 60, 8.0, 3_000L, 27.0, accuracy = 20f)
        assertEquals(0.0, engine.metrics(now).maxSpeedMps, 0.001)
        assertTrue(engine.metrics(now).distanceMeters > 400.0)

        // Now a clean stretch at 4 m/s does count.
        val (end, _) = straightLine(engine, 60, 4.0, now, metres, accuracy = 5f)
        assertEquals(4.0, engine.metrics(end).maxSpeedMps, 0.2)
    }

    @Test
    fun `fixes too loose to trust are discarded`() {
        val engine = RunEngine()
        engine.start(0L, epoch)
        val (now, _) = straightLine(engine, seconds = 60, speedMps = 3.0, fromMs = 0L, accuracy = 40f)
        assertEquals(0.0, engine.metrics(now).distanceMeters, 0.001)
    }

    @Test
    fun `elevation counts climbs and ignores the way back down`() {
        val engine = RunEngine()
        engine.start(0L, epoch)
        var now = 0L
        var metres = 0.0
        var altitude = 100.0
        engine.onFix(fixAt(metres, now, altitude = altitude, hasAltitude = true))
        repeat(10) {
            now += 1_000; metres += 3.0; altitude += 5.0
            engine.tick(now)
            engine.onFix(fixAt(metres, now, altitude = altitude, hasAltitude = true))
        }
        assertEquals(50.0, engine.metrics(now).elevationGainMeters, 1.0)

        repeat(10) {
            now += 1_000; metres += 3.0; altitude -= 5.0
            engine.tick(now)
            engine.onFix(fixAt(metres, now, altitude = altitude, hasAltitude = true))
        }
        assertEquals(50.0, engine.metrics(now).elevationGainMeters, 1.0)
    }

    @Test
    fun `gps quality follows accuracy and staleness`() {
        val engine = RunEngine()
        assertEquals(GpsQuality.NONE, engine.gpsQuality(0L))

        engine.onFix(fixAt(0.0, 1_000L, accuracy = 4f))
        assertEquals(GpsQuality.STRONG, engine.gpsQuality(1_000L))

        engine.onFix(fixAt(0.0, 2_000L, accuracy = 14f))
        assertEquals(GpsQuality.FAIR, engine.gpsQuality(2_000L))

        engine.onFix(fixAt(0.0, 3_000L, accuracy = 30f))
        assertEquals(GpsQuality.WEAK, engine.gpsQuality(3_000L))

        assertEquals(GpsQuality.NONE, engine.gpsQuality(3_000L + RunEngine.STALE_FIX_MS + 1))
    }

    @Test
    fun `live speed bleeds away when the fixes stop`() {
        val engine = RunEngine()
        engine.start(0L, epoch)
        var (now, _) = straightLine(engine, seconds = 30, speedMps = 4.0, fromMs = 0L)
        assertEquals(4.0, engine.metrics(now).speedMps, 0.1)

        // The runner walks into a tunnel: no fixes at all for half a minute.
        repeat(30) {
            now += 1_000
            engine.tick(now)
        }
        assertTrue(
            "speed should decay, was ${engine.metrics(now).speedMps}",
            engine.metrics(now).speedMps < 0.2,
        )
    }

    @Test
    fun `finishing freezes the totals and reset clears them`() {
        val engine = RunEngine()
        engine.start(0L, epoch)
        val (now, _) = straightLine(engine, seconds = 60, speedMps = 3.0, fromMs = 0L)
        val distance = engine.metrics(now).distanceMeters

        engine.finish(now)
        val finished = engine.metrics(now + 60_000L)
        assertEquals(RunState.FINISHED, finished.state)
        assertEquals(distance, finished.distanceMeters, 0.001)
        assertEquals(60_000L, finished.elapsedMs)
        assertEquals(0.0, finished.speedMps, 0.001)

        engine.reset()
        val cleared = engine.metrics(now)
        assertEquals(RunState.IDLE, cleared.state)
        assertEquals(0.0, cleared.distanceMeters, 0.001)
        assertEquals(0L, cleared.elapsedMs)
    }

    @Test
    fun `nothing is recorded before the run starts`() {
        val engine = RunEngine()
        val (now, _) = straightLine(engine, seconds = 60, speedMps = 3.0, fromMs = 0L)
        val m = engine.metrics(now)
        assertEquals(RunState.IDLE, m.state)
        assertEquals(0.0, m.distanceMeters, 0.001)
        assertEquals(0L, m.elapsedMs)
        // Speed is still sensed, so the gauge can prove the GPS has a lock before you set off.
        assertEquals(3.0, m.sensedSpeedMps, 0.1)
    }

    @Test
    fun `the tick rate does not change the result`() {
        fun run(tickHz: Int): Pair<Long, Double> {
            val engine = RunEngine()
            engine.start(0L, epoch)
            var now = 0L
            var metres = 0.0
            engine.onFix(fixAt(metres, now, speed = 3f, hasSpeed = true))
            repeat(120) {
                repeat(tickHz) {
                    now += 1_000L / tickHz
                    engine.tick(now)
                }
                metres += 3.0
                engine.onFix(fixAt(metres, now, speed = 3f, hasSpeed = true))
            }
            val m = engine.metrics(now)
            return m.elapsedMs to m.calories
        }
        val (slowMs, slowKcal) = run(1)
        val (fastMs, fastKcal) = run(10)
        assertEquals(slowMs, fastMs)
        assertEquals(slowKcal, fastKcal, slowKcal * 0.01)
    }
}
