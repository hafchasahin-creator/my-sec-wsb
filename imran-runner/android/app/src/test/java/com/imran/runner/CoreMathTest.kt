package com.imran.runner

import com.imran.runner.core.Calories
import com.imran.runner.core.Format
import com.imran.runner.core.Geo
import com.imran.runner.core.SpeedFilter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GeoTest {

    @Test
    fun `one degree of latitude is about 111 km`() {
        val d = Geo.distanceMeters(0.0, 0.0, 1.0, 0.0)
        assertEquals(111_194.9, d, 1.0)
    }

    @Test
    fun `one degree of longitude shrinks with latitude`() {
        val atEquator = Geo.distanceMeters(0.0, 0.0, 0.0, 1.0)
        val atSixty = Geo.distanceMeters(60.0, 0.0, 60.0, 1.0)
        assertEquals(111_194.9, atEquator, 1.0)
        // cos(60) = 0.5
        assertEquals(atEquator / 2.0, atSixty, 50.0)
    }

    @Test
    fun `short separations stay precise`() {
        // Ten metres north of the origin.
        val tenMetres = 10.0 / 111_194.93
        assertEquals(10.0, Geo.distanceMeters(0.0, 0.0, tenMetres, 0.0), 0.01)
    }

    @Test
    fun `identical points are zero apart`() {
        assertEquals(0.0, Geo.distanceMeters(51.5, -0.12, 51.5, -0.12), 1e-9)
    }

    @Test
    fun `distance is symmetric`() {
        val a = Geo.distanceMeters(51.5074, -0.1278, 48.8566, 2.3522)
        val b = Geo.distanceMeters(48.8566, 2.3522, 51.5074, -0.1278)
        assertEquals(a, b, 1e-6)
        // London to Paris is about 343 km.
        assertEquals(343_000.0, a, 3_000.0)
    }
}

class CaloriesTest {

    @Test
    fun `burn rises with speed`() {
        var previous = -1.0
        var kmh = 0.0
        while (kmh <= 20.0) {
            val rate = Calories.kcalPerMinute(kmh / 3.6, 70.0)
            assertTrue("rate should increase at $kmh km/h", rate > previous)
            previous = rate
            kmh += 0.25
        }
    }

    @Test
    fun `burn scales linearly with weight`() {
        val light = Calories.kcalPerMinute(3.0, 50.0)
        val heavy = Calories.kcalPerMinute(3.0, 100.0)
        assertEquals(light * 2.0, heavy, 1e-9)
    }

    @Test
    fun `the walk to run blend has no step in it`() {
        // Either side of both blend edges the curve must stay continuous.
        for (edge in listOf(6.0, 8.0)) {
            val below = Calories.kcalPerMinute((edge - 0.001) / 3.6, 70.0)
            val above = Calories.kcalPerMinute((edge + 0.001) / 3.6, 70.0)
            assertEquals("discontinuity at $edge km/h", below, above, 0.01)
        }
    }

    @Test
    fun `a ten km per hour hour is a plausible number of calories`() {
        // 70 kg at 10 km/h for an hour: published tables put this near 700-750 kcal.
        val kcal = Calories.burn(10.0 / 3.6, 70.0, 3_600.0)
        assertTrue("got $kcal", kcal in 600.0..850.0)
    }

    @Test
    fun `standing still still burns resting energy`() {
        val kcal = Calories.burn(0.0, 70.0, 3_600.0)
        // 3.5 ml/kg/min is 1 MET, roughly 70 kcal/h for a 70 kg runner.
        assertEquals(73.5, kcal, 1.0)
    }
}

class SpeedFilterTest {

    @Test
    fun `first reading is taken as is`() {
        val filter = SpeedFilter()
        assertEquals(4.0, filter.update(4.0, 1.0), 1e-9)
    }

    @Test
    fun `converges on a steady input`() {
        val filter = SpeedFilter(timeConstantSeconds = 2.0)
        filter.update(0.0, 1.0)
        repeat(40) { filter.update(5.0, 1.0) }
        assertEquals(5.0, filter.value, 0.01)
    }

    @Test
    fun `smoothing does not depend on sample rate`() {
        val slow = SpeedFilter(timeConstantSeconds = 2.0)
        val fast = SpeedFilter(timeConstantSeconds = 2.0)
        slow.update(0.0, 1.0)
        fast.update(0.0, 1.0)
        repeat(10) { slow.update(5.0, 1.0) }
        repeat(100) { fast.update(5.0, 0.1) }
        assertEquals(slow.value, fast.value, 0.02)
    }

    @Test
    fun `implausible readings are clamped`() {
        val filter = SpeedFilter(maxPlausibleMps = 12.5)
        filter.update(900.0, 1.0)
        assertEquals(12.5, filter.value, 1e-9)
    }

    @Test
    fun `negative readings are floored at zero`() {
        val filter = SpeedFilter()
        filter.update(-4.0, 1.0)
        assertEquals(0.0, filter.value, 1e-9)
    }

    @Test
    fun `non advancing time leaves the value alone`() {
        val filter = SpeedFilter()
        filter.update(3.0, 1.0)
        filter.update(9.0, 0.0)
        assertEquals(3.0, filter.value, 1e-9)
    }
}

class FormatTest {

    @Test
    fun `duration is mm ss below an hour`() {
        assertEquals("00:00", Format.duration(0))
        assertEquals("00:09", Format.duration(9_400))
        assertEquals("31:42", Format.duration(31 * 60_000L + 42_000L))
        assertEquals("59:59", Format.duration(59 * 60_000L + 59_000L))
    }

    @Test
    fun `duration grows to h mm ss`() {
        assertEquals("1:00:00", Format.duration(3_600_000L))
        assertEquals("1:05:12", Format.duration(3_600_000L + 5 * 60_000L + 12_000L))
    }

    @Test
    fun `negative durations read as zero`() {
        assertEquals("00:00", Format.duration(-5_000))
    }

    @Test
    fun `pace uses the runner's idiom`() {
        assertEquals("5'56\"", Format.pace(356.0))
        assertEquals("4'00\"", Format.pace(240.0))
    }

    @Test
    fun `pace without movement is blank`() {
        assertEquals(Format.NO_PACE, Format.pace(0.0))
        assertEquals(Format.NO_PACE, Format.pace(Double.NaN))
        assertEquals(Format.NO_PACE, Format.pace(Double.POSITIVE_INFINITY))
        assertEquals(Format.NO_PACE, Format.paceFromSpeed(0.0))
    }

    @Test
    fun `pace from speed matches the gauge`() {
        // 12 km/h is a 5'00" kilometre.
        assertEquals("5'00\"", Format.paceFromSpeed(12.0 / 3.6))
    }

    @Test
    fun `speed and distance match the reference readouts`() {
        assertEquals("12.4", Format.speedKmh(12.4 / 3.6))
        assertEquals("5.24", Format.distanceKm(5_240.0))
        assertEquals("0.00", Format.distanceKm(0.0))
        assertEquals("347", Format.integer(346.7))
    }

    @Test
    fun `non finite input never reaches the screen`() {
        assertEquals("0.0", Format.oneDecimal(Double.NaN))
        assertEquals("0", Format.integer(Double.NaN))
        assertEquals("0", Format.integer(-12.0))
    }
}
