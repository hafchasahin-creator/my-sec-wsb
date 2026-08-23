package com.imran.runner

import com.imran.runner.data.RunCodec
import com.imran.runner.data.RunRecord
import com.imran.runner.data.RunRepository
import com.imran.runner.data.RunStats
import com.imran.runner.tracking.RoutePoint
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

private fun sampleRun(
    id: Long = 1L,
    startedAt: Long = 1_700_000_000_000L,
    distance: Double = 5_240.0,
    duration: Long = 1_902_000L,
    calories: Double = 347.4,
    avg: Double = 2.81,
    max: Double = 4.11,
    pace: Double = 356.0,
) = RunRecord(
    id = id,
    startedAtEpochMs = startedAt,
    durationMs = duration,
    distanceMeters = distance,
    calories = calories,
    avgSpeedMps = avg,
    maxSpeedMps = max,
    avgPaceSecPerKm = pace,
    elevationGainMeters = 62.5,
    routePointCount = 1_874,
)

class RunCodecTest {

    @Test
    fun `a run survives the round trip exactly`() {
        val original = sampleRun()
        val decoded = RunCodec.decodeRun(RunCodec.encodeRun(original))
        assertEquals(original, decoded)
    }

    @Test
    fun `awkward doubles round trip exactly`() {
        val original = sampleRun(distance = 1.0 / 3.0, calories = 0.1 + 0.2)
        val decoded = RunCodec.decodeRun(RunCodec.encodeRun(original))!!
        assertEquals(original.distanceMeters, decoded.distanceMeters, 0.0)
        assertEquals(original.calories, decoded.calories, 0.0)
    }

    @Test
    fun `a route point survives the round trip`() {
        val point = RoutePoint(51.50735, -0.12776, 42_000L, 3.4f)
        assertEquals(point, RunCodec.decodePoint(RunCodec.encodePoint(point)))
    }

    @Test
    fun `rubbish decodes to null rather than throwing`() {
        assertNull(RunCodec.decodeRun(""))
        assertNull(RunCodec.decodeRun("nonsense"))
        assertNull(RunCodec.decodeRun("1|2|3"))
        assertNull(RunCodec.decodeRun("1|x|x|x|x|x|x|x|x|x|x"))
        assertNull(RunCodec.decodeRun("99|1|2|3|4|5|6|7|8|9|10"))
        assertNull(RunCodec.decodePoint("1,2"))
        assertNull(RunCodec.decodePoint("a,b,c,d"))
    }
}

class RunRepositoryTest {

    @get:Rule
    val temp = TemporaryFolder()

    private fun repo(): RunRepository = RunRepository(File(temp.root, "runs"))

    @Test
    fun `an empty store loads cleanly`() {
        val repository = repo()
        repository.load()
        assertTrue(repository.runs.value.isEmpty())
        assertEquals(0, repository.stats.totalRuns)
    }

    @Test
    fun `saved runs come back newest first`() {
        val repository = repo()
        repository.load()
        repository.save(sampleRun(id = 1, startedAt = 1_000L), emptyList())
        repository.save(sampleRun(id = 3, startedAt = 3_000L), emptyList())
        repository.save(sampleRun(id = 2, startedAt = 2_000L), emptyList())

        assertEquals(listOf(3L, 2L, 1L), repository.runs.value.map { it.id })

        val reopened = repo()
        reopened.load()
        assertEquals(listOf(3L, 2L, 1L), reopened.runs.value.map { it.id })
    }

    @Test
    fun `routes are stored and read back per run`() {
        val repository = repo()
        repository.load()
        val route = listOf(
            RoutePoint(51.5, -0.12, 0L, 0f),
            RoutePoint(51.5001, -0.1201, 1_000L, 3.2f),
            RoutePoint(51.5002, -0.1202, 2_000L, 3.4f),
        )
        repository.save(sampleRun(id = 7), route)
        assertEquals(route, repository.route(7L))
        assertEquals(emptyList<RoutePoint>(), repository.route(999L))
    }

    @Test
    fun `deleting a run removes it and its route`() {
        val repository = repo()
        repository.load()
        repository.save(sampleRun(id = 1, startedAt = 1_000L), listOf(RoutePoint(1.0, 2.0, 0L, 1f)))
        repository.save(sampleRun(id = 2, startedAt = 2_000L), listOf(RoutePoint(3.0, 4.0, 0L, 1f)))

        repository.delete(1L)
        assertEquals(listOf(2L), repository.runs.value.map { it.id })
        assertTrue(repository.route(1L).isEmpty())
        assertEquals(1, repository.route(2L).size)

        val reopened = repo()
        reopened.load()
        assertEquals(listOf(2L), reopened.runs.value.map { it.id })
    }

    @Test
    fun `clearing removes everything`() {
        val repository = repo()
        repository.load()
        repository.save(sampleRun(id = 1), listOf(RoutePoint(1.0, 2.0, 0L, 1f)))
        repository.clearAll()
        assertTrue(repository.runs.value.isEmpty())

        val reopened = repo()
        reopened.load()
        assertTrue(reopened.runs.value.isEmpty())
    }

    @Test
    fun `one corrupt line does not lose the rest of the history`() {
        val repository = repo()
        repository.load()
        repository.save(sampleRun(id = 1, startedAt = 1_000L), emptyList())
        repository.save(sampleRun(id = 2, startedAt = 2_000L), emptyList())

        val index = File(File(temp.root, "runs"), "runs.index")
        index.writeText(index.readText().replace("|2|2000|", "|CORRUPT|"))

        val reopened = repo()
        reopened.load()
        assertEquals(listOf(1L), reopened.runs.value.map { it.id })
    }
}

class RunStatsTest {

    @Test
    fun `no runs means no stats`() {
        val stats = RunStats.from(emptyList())
        assertEquals(0, stats.totalRuns)
        assertEquals(0.0, stats.totalDistanceMeters, 0.0)
        assertEquals(0.0, stats.bestPaceSecPerKm, 0.0)
    }

    @Test
    fun `totals add up and records pick the best`() {
        val stats = RunStats.from(
            listOf(
                sampleRun(id = 1, distance = 5_000.0, duration = 1_800_000L, calories = 300.0, avg = 2.78, max = 4.0, pace = 360.0),
                sampleRun(id = 2, distance = 10_000.0, duration = 3_000_000L, calories = 700.0, avg = 3.33, max = 5.2, pace = 300.0),
                sampleRun(id = 3, distance = 2_000.0, duration = 900_000L, calories = 140.0, avg = 2.22, max = 3.1, pace = 450.0),
            ),
        )
        assertEquals(3, stats.totalRuns)
        assertEquals(17_000.0, stats.totalDistanceMeters, 0.001)
        assertEquals(1_140.0, stats.totalCalories, 0.001)
        assertEquals(5_700_000L, stats.totalDurationMs)
        assertEquals(10_000.0, stats.longestDistanceMeters, 0.001)
        assertEquals(3_000_000L, stats.longestDurationMs)
        assertEquals(3.33, stats.fastestAvgSpeedMps, 0.001)
        assertEquals(5.2, stats.topSpeedMps, 0.001)
        assertEquals(300.0, stats.bestPaceSecPerKm, 0.001)
    }

    @Test
    fun `a jog to the postbox cannot set a pace record`() {
        val stats = RunStats.from(
            listOf(
                sampleRun(id = 1, distance = 5_000.0, avg = 2.78, pace = 360.0),
                // 80 m sprint: counts towards totals and top speed, but not towards pace or
                // average-speed records.
                sampleRun(id = 2, distance = 80.0, avg = 6.0, max = 7.0, pace = 166.0),
            ),
        )
        assertEquals(5_080.0, stats.totalDistanceMeters, 0.001)
        assertEquals(7.0, stats.topSpeedMps, 0.001)
        assertEquals(360.0, stats.bestPaceSecPerKm, 0.001)
        assertEquals(2.78, stats.fastestAvgSpeedMps, 0.001)
    }
}
