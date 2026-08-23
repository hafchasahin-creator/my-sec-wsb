package com.imran.runner.core

import java.util.Locale
import kotlin.math.roundToInt
import kotlin.math.roundToLong

/**
 * Display formatting for every number on screen.
 *
 * Everything is forced to [Locale.US] so the decimal separator stays a point: the layout is
 * built around glyph widths that a comma would shift, and the design is a fixed one.
 */
object Format {

    const val NO_PACE = "--'--\""

    /** Speed as shown in the gauge and the summary panel, e.g. `12.4`. */
    fun speedKmh(mps: Double): String = oneDecimal(mps * 3.6)

    /** Distance in kilometres to two places, e.g. `5.24`. */
    fun distanceKm(meters: Double): String = String.format(Locale.US, "%.2f", meters / 1000.0)

    fun oneDecimal(value: Double): String =
        String.format(Locale.US, "%.1f", if (value.isFinite()) value else 0.0)

    fun integer(value: Double): String =
        if (value.isFinite()) (if (value < 0) 0L else value.roundToLong()).toString() else "0"

    /**
     * Elapsed time. Under an hour this is `MM:SS`, above it `H:MM:SS`, so the field only grows
     * once and never jitters between widths within a run.
     */
    fun duration(millis: Long): String {
        val total = (millis / 1000L).coerceAtLeast(0L)
        val hours = total / 3600L
        val minutes = (total % 3600L) / 60L
        val seconds = total % 60L
        return if (hours > 0L) {
            String.format(Locale.US, "%d:%02d:%02d", hours, minutes, seconds)
        } else {
            String.format(Locale.US, "%02d:%02d", minutes, seconds)
        }
    }

    /** Pace in the runner's idiom: `5'56"` per kilometre. */
    fun pace(secondsPerKm: Double): String {
        if (!secondsPerKm.isFinite() || secondsPerKm <= 0.0 || secondsPerKm > 5_999.0) return NO_PACE
        val rounded = secondsPerKm.roundToInt()
        return String.format(Locale.US, "%d'%02d\"", rounded / 60, rounded % 60)
    }

    /** Pace derived from a speed, for the live readout. */
    fun paceFromSpeed(mps: Double): String =
        if (mps <= 0.15) NO_PACE else pace(1000.0 / mps)

    /** Metres of climb, e.g. `128`. */
    fun elevation(meters: Double): String = integer(meters)
}
