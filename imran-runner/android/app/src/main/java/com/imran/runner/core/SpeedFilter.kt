package com.imran.runner.core

import kotlin.math.exp

/**
 * Exponential smoother for live speed.
 *
 * GPS speed is noisy at the 1 Hz update rate a phone gives you, and the reference design puts
 * that number at 112sp in the middle of the screen — raw values would flicker constantly. The
 * smoothing constant is expressed as a time constant rather than a fixed weight so that a
 * dropped or late fix does not change how much history is retained.
 */
class SpeedFilter(
    private val timeConstantSeconds: Double = 2.0,
    private val maxPlausibleMps: Double = 12.5,
) {
    var value: Double = 0.0
        private set

    private var seeded = false

    fun reset() {
        value = 0.0
        seeded = false
    }

    /**
     * Folds a new reading in and returns the smoothed speed.
     *
     * @param dtSeconds time since the previous reading; non-positive values are ignored.
     */
    fun update(rawMps: Double, dtSeconds: Double): Double {
        val clamped = rawMps.coerceIn(0.0, maxPlausibleMps)
        if (!seeded) {
            seeded = true
            value = clamped
            return value
        }
        if (dtSeconds <= 0.0) return value
        val alpha = 1.0 - exp(-dtSeconds / timeConstantSeconds)
        value += alpha * (clamped - value)
        return value
    }
}
