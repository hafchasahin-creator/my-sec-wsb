package com.imran.runner.tracking

/** Where a run is in its lifecycle. */
enum class RunState {
    /** Nothing recorded yet; the gauge sits at zero. */
    IDLE,
    RUNNING,
    PAUSED,

    /** Recorded and saved; the screen shows the finished totals until it is reset. */
    FINISHED,
}

/**
 * How much the numbers can be trusted right now, driving the bar indicator in the header.
 */
enum class GpsQuality {
    /** No fix, or the last one is too old to mean anything. */
    NONE,
    WEAK,
    FAIR,
    STRONG;

    /** Lit bars out of three. */
    val bars: Int
        get() = when (this) {
            NONE -> 0
            WEAK -> 1
            FAIR -> 2
            STRONG -> 3
        }
}

/**
 * One location sample.
 *
 * [atMs] is a monotonic timestamp (elapsed realtime), never wall-clock: a clock correction
 * mid-run must not be able to rewrite distance or duration.
 */
data class Fix(
    val latitude: Double,
    val longitude: Double,
    val altitudeMeters: Double = 0.0,
    val hasAltitude: Boolean = false,
    val accuracyMeters: Float = 0f,
    val speedMps: Float = 0f,
    val hasSpeed: Boolean = false,
    val atMs: Long,
)

/** A point kept for the route trace drawn in history. */
data class RoutePoint(
    val latitude: Double,
    val longitude: Double,
    val elapsedMs: Long,
    val speedMps: Float,
)

/** Everything the run screen renders, recomputed on each tick. */
data class RunMetrics(
    val state: RunState = RunState.IDLE,
    val distanceMeters: Double = 0.0,
    val elapsedMs: Long = 0L,
    val speedMps: Double = 0.0,
    /** Filtered speed regardless of state, used by auto-pause and the pre-run GPS preview. */
    val sensedSpeedMps: Double = 0.0,
    val avgSpeedMps: Double = 0.0,
    val maxSpeedMps: Double = 0.0,
    val calories: Double = 0.0,
    val avgPaceSecPerKm: Double = 0.0,
    val livePaceSecPerKm: Double = 0.0,
    val lastKmPaceSecPerKm: Double = 0.0,
    val elevationGainMeters: Double = 0.0,
    val gps: GpsQuality = GpsQuality.NONE,
    val routePointCount: Int = 0,
) {
    val isActive: Boolean get() = state == RunState.RUNNING || state == RunState.PAUSED
    val hasData: Boolean get() = distanceMeters > 0.0 || elapsedMs > 0L
}
