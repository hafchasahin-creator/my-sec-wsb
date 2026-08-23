package com.imran.runner.tracking

import com.imran.runner.core.Calories
import com.imran.runner.core.Geo
import com.imran.runner.core.SpeedFilter
import kotlin.math.max

/**
 * Turns a stream of GPS fixes into the numbers on the run screen.
 *
 * Deliberately free of Android types and of any notion of the current time — every entry point
 * takes an explicit monotonic `nowMs` — so the whole of the tracking logic can be driven from
 * unit tests with synthetic fixes.
 *
 * Not thread-safe: the service confines it to a single handler.
 */
class RunEngine(weightKg: Double = DEFAULT_WEIGHT_KG) {

    companion object {
        const val DEFAULT_WEIGHT_KG = 70.0

        /** Fixes looser than this are watched for GPS quality but never move the numbers. */
        const val MAX_ACCURACY_M = 25f

        /** Faster than a world-class sprinter: the receiver jumped, the runner did not. */
        const val MAX_PLAUSIBLE_MPS = 12.5

        /** After this long without a fix the header drops to "no GPS". */
        const val STALE_FIX_MS = 12_000L

        /**
         * Straight-lining across a gap this long stops being an estimate and starts being a
         * guess, so the run is re-anchored instead.
         */
        const val MAX_GAP_MS = 120_000L

        /** After this long without a fix, live speed is bled to zero rather than left hanging. */
        const val SPEED_TIMEOUT_MS = 4_000L

        /** Max speed only accepts fixes at least this tight, to keep a wild sample out of a PR. */
        const val MAX_SPEED_ACCURACY_M = 15f

        /** Max speed ignores the first seconds, where the filter is still settling. */
        const val MAX_SPEED_WARMUP_MS = 5_000L

        /**
         * A loose fix still feeds the smoother, so for a few time constants afterwards the
         * filtered value is part untrusted data. Records wait that out rather than inheriting it.
         */
        const val MAX_SPEED_SETTLE_MS = 8_000L

        /** Barometric-free altitude is noisy; only climbs beyond this band count. */
        const val ALTITUDE_NOISE_M = 2.0

        /** Average pace stays blank until there is enough distance for it to mean anything. */
        const val MIN_DISTANCE_FOR_PACE_M = 20.0

        /** Sentinel for "no sample yet"; 0 is a legitimate elapsed-realtime value just after boot. */
        private const val UNSET = Long.MIN_VALUE
    }

    var weightKg: Double = weightKg
        set(value) {
            field = value.coerceIn(20.0, 250.0)
        }

    private val speedFilter = SpeedFilter()

    private var state = RunState.IDLE
    private var elapsedMs = 0L
    private var lastTickMs = UNSET

    private var distanceMeters = 0.0
    private var calories = 0.0
    private var maxSpeedMps = 0.0
    private var elevationGainMeters = 0.0

    private var anchor: Fix? = null
    private var lastFixAtMs = UNSET
    private var lastAccuracyM = Float.MAX_VALUE
    private var lastLooseFixAtMs = UNSET
    private var referenceAltitude = Double.NaN

    private val route = ArrayList<RoutePoint>()
    private val splitElapsedMs = ArrayList<Long>()
    private var lastKmPaceSecPerKm = 0.0

    /** Wall-clock start, carried only so a finished run can be dated in history. */
    var startedAtEpochMs: Long = 0L
        private set

    // ---------------------------------------------------------------- lifecycle

    fun start(nowMs: Long, epochMs: Long) {
        resetInternals()
        state = RunState.RUNNING
        lastTickMs = nowMs
        startedAtEpochMs = epochMs
    }

    fun pause(nowMs: Long) {
        if (state != RunState.RUNNING) return
        tick(nowMs)
        state = RunState.PAUSED
        // The anchor is kept so movement is still sensed while paused; resume() drops it, which
        // is what actually stops the paused stretch being credited as distance.
    }

    fun resume(nowMs: Long) {
        if (state != RunState.PAUSED) return
        state = RunState.RUNNING
        lastTickMs = nowMs
        anchor = null
    }

    fun finish(nowMs: Long) {
        if (state == RunState.RUNNING) tick(nowMs)
        state = RunState.FINISHED
        speedFilter.reset()
        anchor = null
    }

    fun reset() {
        resetInternals()
        state = RunState.IDLE
    }

    private fun resetInternals() {
        speedFilter.reset()
        elapsedMs = 0L
        lastTickMs = UNSET
        distanceMeters = 0.0
        calories = 0.0
        maxSpeedMps = 0.0
        elevationGainMeters = 0.0
        anchor = null
        lastLooseFixAtMs = UNSET
        referenceAltitude = Double.NaN
        route.clear()
        splitElapsedMs.clear()
        lastKmPaceSecPerKm = 0.0
        startedAtEpochMs = 0L
    }

    // ---------------------------------------------------------------- clock

    /**
     * Advances duration and calorie burn. Safe to call at any rate: everything integrates over
     * the real gap, so 5 Hz from the foreground and 1 Hz from the background agree.
     */
    fun tick(nowMs: Long) {
        if (state == RunState.RUNNING && lastTickMs != UNSET) {
            val deltaMs = (nowMs - lastTickMs).coerceAtLeast(0L)
            val dt = deltaMs / 1000.0
            elapsedMs += deltaMs

            val fixAge = if (lastFixAtMs == UNSET) Long.MAX_VALUE else nowMs - lastFixAtMs
            if (fixAge > SPEED_TIMEOUT_MS) speedFilter.update(0.0, dt)

            calories += Calories.burn(speedFilter.value, weightKg, dt)
        }
        lastTickMs = nowMs
    }

    // ---------------------------------------------------------------- fixes

    fun onFix(fix: Fix) {
        lastFixAtMs = fix.atMs
        lastAccuracyM = fix.accuracyMeters

        if (state == RunState.FINISHED) return
        if (fix.accuracyMeters > MAX_ACCURACY_M) return

        val previous = anchor
        if (previous == null) {
            anchor = fix
            if (fix.hasAltitude) referenceAltitude = fix.altitudeMeters
            if (state == RunState.RUNNING) record(fix, speedFilter.value)
            return
        }

        val deltaMs = fix.atMs - previous.atMs
        if (deltaMs <= 0L) return
        if (deltaMs > MAX_GAP_MS) {
            anchor = fix
            return
        }
        val dt = deltaMs / 1000.0

        val moved = Geo.distanceMeters(
            previous.latitude, previous.longitude, fix.latitude, fix.longitude,
        )
        val impliedMps = moved / dt

        if (impliedMps > MAX_PLAUSIBLE_MPS) {
            // The receiver re-acquired somewhere else. Re-anchor silently rather than credit a
            // hundred metres nobody ran.
            anchor = fix
            return
        }

        if (fix.accuracyMeters > MAX_SPEED_ACCURACY_M) lastLooseFixAtMs = fix.atMs

        // Speed is sensed in every state, not just while running: it drives the GPS-lock preview
        // before the run starts and lets auto-resume notice the runner setting off again.
        val speed = speedFilter.update(
            if (fix.hasSpeed) fix.speedMps.toDouble() else impliedMps,
            dt,
        )

        if (state != RunState.RUNNING) {
            anchor = fix
            return
        }

        val noiseFloor = max(1.5, fix.accuracyMeters * 0.5)
        if (moved < noiseFloor) {
            // Standing at the lights. The anchor is held rather than advanced, so GPS wobble
            // cannot invent distance a metre at a time — and genuinely slow movement is not
            // lost either, because the displacement is measured from that same held anchor and
            // gets credited in full as soon as it clears the floor.
            return
        }

        distanceMeters += moved
        updateElevation(fix)
        updateSplits()

        val settled = lastLooseFixAtMs == UNSET || fix.atMs - lastLooseFixAtMs >= MAX_SPEED_SETTLE_MS
        if (speed > maxSpeedMps &&
            fix.accuracyMeters <= MAX_SPEED_ACCURACY_M &&
            settled &&
            elapsedMs > MAX_SPEED_WARMUP_MS
        ) {
            maxSpeedMps = speed
        }

        anchor = fix
        record(fix, speed)
    }

    private fun record(fix: Fix, speed: Double) {
        route.add(RoutePoint(fix.latitude, fix.longitude, elapsedMs, speed.toFloat()))
    }

    private fun updateElevation(fix: Fix) {
        if (!fix.hasAltitude) return
        if (referenceAltitude.isNaN()) {
            referenceAltitude = fix.altitudeMeters
            return
        }
        val delta = fix.altitudeMeters - referenceAltitude
        if (delta > ALTITUDE_NOISE_M) {
            elevationGainMeters += delta
            referenceAltitude = fix.altitudeMeters
        } else if (delta < -ALTITUDE_NOISE_M) {
            referenceAltitude = fix.altitudeMeters
        }
    }

    private fun updateSplits() {
        val completedKm = (distanceMeters / 1000.0).toInt()
        while (splitElapsedMs.size < completedKm) {
            val previousSplit = splitElapsedMs.lastOrNull() ?: 0L
            splitElapsedMs.add(elapsedMs)
            lastKmPaceSecPerKm = (elapsedMs - previousSplit) / 1000.0
        }
    }

    // ---------------------------------------------------------------- output

    fun metrics(nowMs: Long): RunMetrics {
        val elapsedSeconds = elapsedMs / 1000.0
        val average = if (elapsedSeconds > 0.5) distanceMeters / elapsedSeconds else 0.0
        val averagePace =
            if (distanceMeters >= MIN_DISTANCE_FOR_PACE_M && elapsedSeconds > 0.0) {
                elapsedSeconds / (distanceMeters / 1000.0)
            } else {
                0.0
            }
        val live = speedFilter.value
        return RunMetrics(
            state = state,
            distanceMeters = distanceMeters,
            elapsedMs = elapsedMs,
            speedMps = if (state == RunState.RUNNING || state == RunState.IDLE) live else 0.0,
            sensedSpeedMps = live,
            avgSpeedMps = average,
            maxSpeedMps = maxSpeedMps,
            calories = calories,
            avgPaceSecPerKm = averagePace,
            livePaceSecPerKm = if (live > 0.15) 1000.0 / live else 0.0,
            lastKmPaceSecPerKm = lastKmPaceSecPerKm,
            elevationGainMeters = elevationGainMeters,
            gps = gpsQuality(nowMs),
            routePointCount = route.size,
        )
    }

    fun gpsQuality(nowMs: Long): GpsQuality {
        if (lastFixAtMs == UNSET || nowMs - lastFixAtMs > STALE_FIX_MS) return GpsQuality.NONE
        return when {
            lastAccuracyM <= 8f -> GpsQuality.STRONG
            lastAccuracyM <= 18f -> GpsQuality.FAIR
            else -> GpsQuality.WEAK
        }
    }

    fun routeSnapshot(): List<RoutePoint> = ArrayList(route)

    /** Completed kilometre splits, in seconds, oldest first. */
    fun splitsSeconds(): List<Double> {
        val out = ArrayList<Double>(splitElapsedMs.size)
        var previous = 0L
        for (t in splitElapsedMs) {
            out.add((t - previous) / 1000.0)
            previous = t
        }
        return out
    }
}
