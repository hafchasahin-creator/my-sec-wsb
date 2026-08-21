package com.imran.recorder.ui.intro

import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * The launch sequence's clock and easing, kept free of Android types so the beat timings
 * can be asserted on the JVM. [CosmicIntroView] owns the pixels; this owns the schedule.
 *
 * Beats, in seconds:
 *   0.00 - 0.40  deep space settles in
 *   0.40 - 1.20  acceleration through the field
 *   1.20 - 1.80  the point of light becomes a ring, the mark assembles
 *   1.80 - 2.40  wordmark, one pulse
 *   2.40 - 2.94  the dive through the mark onto the home screen
 */
object IntroTimeline {

    const val T_DRIFT_END = 0.40f
    const val T_TRAVEL_END = 1.20f
    const val T_RING_IN = 1.15f
    const val T_ASSEMBLE_IN = 1.38f
    const val T_ASSEMBLE_OUT = 1.98f
    const val T_WORD_IN = 1.96f
    const val T_SUB_IN = 2.12f
    const val T_PULSE = 2.18f
    const val T_PORTAL = 2.42f
    const val T_END = 2.94f

    const val STARS_FULL = 340
    const val STARS_LITE = 150
    const val PARTICLES_FULL = 760
    const val PARTICLES_LITE = 300

    /** 0 before [from], 1 after [to], linear in between. */
    fun smooth(from: Float, to: Float, t: Float): Float =
        ((t - from) / (to - from)).coerceIn(0f, 1f)

    fun easeOut(x: Float) = 1f - (1f - x).pow(3f)
    fun easeIn(x: Float) = x * x * x
    fun easeInOut(x: Float) =
        if (x < 0.5f) 4f * x * x * x else 1f - (-2f * x + 2f).pow(3f) / 2f

    /** Camera speed over the sequence: drift, accelerate, hold, then dive. */
    fun speedAt(t: Float): Float = when {
        t < T_DRIFT_END -> 0.03f
        t < T_TRAVEL_END -> 0.03f + easeInOut(smooth(T_DRIFT_END, T_TRAVEL_END, t)) * 0.42f
        t < T_PORTAL -> 0.45f - easeInOut(smooth(T_TRAVEL_END, T_RING_IN + 0.5f, t)) * 0.33f
        else -> 0.12f + easeIn(smooth(T_PORTAL, T_END, t)).pow(1.5f) * 5.2f
    }

    /** How far into the dive we are, 0..1. The host fades the real UI in against this. */
    fun portalProgress(t: Float): Float = smooth(T_PORTAL, T_END, t)

    /**
     * A tap compresses whatever is left into a short outro rather than cutting to black:
     * the clock jumps to the dive and then runs a little over 3x.
     */
    fun skipTime(raw: Float, skipFrom: Float): Float =
        if (skipFrom < 0f) raw else min(T_END, max(raw, T_PORTAL + (raw - skipFrom) * 3.2f))
}
