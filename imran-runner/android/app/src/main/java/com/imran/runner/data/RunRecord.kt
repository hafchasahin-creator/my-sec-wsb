package com.imran.runner.data

/** One finished run, as stored on the phone. */
data class RunRecord(
    val id: Long,
    val startedAtEpochMs: Long,
    val durationMs: Long,
    val distanceMeters: Double,
    val calories: Double,
    val avgSpeedMps: Double,
    val maxSpeedMps: Double,
    val avgPaceSecPerKm: Double,
    val elevationGainMeters: Double,
    val routePointCount: Int,
)

/** Lifetime totals and personal records, derived from every stored run. */
data class RunStats(
    val totalRuns: Int = 0,
    val totalDistanceMeters: Double = 0.0,
    val totalCalories: Double = 0.0,
    val totalDurationMs: Long = 0L,
    val longestDistanceMeters: Double = 0.0,
    val longestDurationMs: Long = 0L,
    val fastestAvgSpeedMps: Double = 0.0,
    val topSpeedMps: Double = 0.0,
    val bestPaceSecPerKm: Double = 0.0,
) {
    companion object {
        /** A run shorter than this is not eligible for a pace or average-speed record. */
        const val MIN_DISTANCE_FOR_RECORD_M = 500.0

        fun from(records: List<RunRecord>): RunStats {
            if (records.isEmpty()) return RunStats()

            var distance = 0.0
            var calories = 0.0
            var duration = 0L
            var longestDistance = 0.0
            var longestDuration = 0L
            var fastestAvg = 0.0
            var topSpeed = 0.0
            var bestPace = 0.0

            for (run in records) {
                distance += run.distanceMeters
                calories += run.calories
                duration += run.durationMs
                if (run.distanceMeters > longestDistance) longestDistance = run.distanceMeters
                if (run.durationMs > longestDuration) longestDuration = run.durationMs
                if (run.maxSpeedMps > topSpeed) topSpeed = run.maxSpeedMps

                if (run.distanceMeters >= MIN_DISTANCE_FOR_RECORD_M) {
                    if (run.avgSpeedMps > fastestAvg) fastestAvg = run.avgSpeedMps
                    val pace = run.avgPaceSecPerKm
                    if (pace > 0.0 && (bestPace == 0.0 || pace < bestPace)) bestPace = pace
                }
            }

            return RunStats(
                totalRuns = records.size,
                totalDistanceMeters = distance,
                totalCalories = calories,
                totalDurationMs = duration,
                longestDistanceMeters = longestDistance,
                longestDurationMs = longestDuration,
                fastestAvgSpeedMps = fastestAvg,
                topSpeedMps = topSpeed,
                bestPaceSecPerKm = bestPace,
            )
        }
    }
}
