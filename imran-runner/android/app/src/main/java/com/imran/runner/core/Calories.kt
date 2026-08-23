package com.imran.runner.core

/**
 * Energy expenditure from the ACSM metabolic equations.
 *
 * Both equations give gross VO2 in ml/kg/min for a horizontal surface, with `v` in metres per
 * minute:
 *
 *   walking   VO2 = 0.1 * v + 3.5
 *   running   VO2 = 0.2 * v + 3.5
 *
 * The walking equation is validated up to roughly 6 km/h and the running equation from roughly
 * 8 km/h, so the band between the two is blended instead of stepped — a runner easing through
 * 7 km/h should not see the calorie counter jump.
 *
 * kcal/min = VO2 * kg / 1000 * 5, taking 5 kcal per litre of oxygen.
 */
object Calories {

    private const val WALK_CEILING_MPS = 6.0 / 3.6
    private const val RUN_FLOOR_MPS = 8.0 / 3.6
    private const val KCAL_PER_LITRE_O2 = 5.0

    private fun walkingVo2(metresPerMinute: Double) = 0.1 * metresPerMinute + 3.5

    private fun runningVo2(metresPerMinute: Double) = 0.2 * metresPerMinute + 3.5

    /** Gross oxygen uptake in ml/kg/min at the given speed. */
    fun vo2(speedMps: Double): Double {
        val v = speedMps.coerceAtLeast(0.0) * 60.0
        return when {
            speedMps <= WALK_CEILING_MPS -> walkingVo2(v)
            speedMps >= RUN_FLOOR_MPS -> runningVo2(v)
            else -> {
                val t = (speedMps - WALK_CEILING_MPS) / (RUN_FLOOR_MPS - WALK_CEILING_MPS)
                walkingVo2(v) * (1 - t) + runningVo2(v) * t
            }
        }
    }

    /** Kilocalories per minute for a runner of [weightKg] moving at [speedMps]. */
    fun kcalPerMinute(speedMps: Double, weightKg: Double): Double =
        vo2(speedMps) * weightKg / 1000.0 * KCAL_PER_LITRE_O2

    /** Kilocalories burned over [seconds] at a steady [speedMps]. */
    fun burn(speedMps: Double, weightKg: Double, seconds: Double): Double =
        kcalPerMinute(speedMps, weightKg) * (seconds / 60.0)
}
