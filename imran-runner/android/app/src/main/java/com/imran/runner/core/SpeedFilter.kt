package com.imran.runner.core

import kotlin.math.abs
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
    private val timeConstantSeconds: Double = 1.5,
    private val maxPlausibleMps: Double = 12.5,
) {

    private companion object {
        /**
         * A reading this far from the current value is a real change of pace, not noise, so the
         * smoother is allowed to catch up quickly instead of dragging a walk down toward zero.
         */
        const val CATCH_UP_THRESHOLD_MPS = 0.9

        const val CATCH_UP_TIME_CONSTANT_SECONDS = 0.55
    }
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
        val tau = if (abs(clamped - value) > CATCH_UP_THRESHOLD_MPS) {
            CATCH_UP_TIME_CONSTANT_SECONDS
        } else {
            timeConstantSeconds
        }
        val alpha = 1.0 - exp(-dtSeconds / tau)
        value += alpha * (clamped - value)
        return value
    }
}
