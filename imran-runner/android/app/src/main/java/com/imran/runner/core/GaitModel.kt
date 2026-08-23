package com.imran.runner.core

/**
 * How the runner's posture and cadence follow real speed.
 *
 * Kept free of Compose so the numbers behind the animation can be asserted in unit tests: the
 * figure freezing on screen is a bug the compiler cannot catch, so the guarantee that something
 * always moves is written down here and tested rather than left to inspection.
 */
object GaitModel {

    /** Below this the figure is standing, not walking. */
    const val WALK_START_KMH = 0.4f

    /** A full walking posture by here. */
    const val WALK_FULL_KMH = 3.5f

    /** The posture starts becoming a run here... */
    const val RUN_START_KMH = 6.5f

    /** ...and is a full run by here. */
    const val RUN_FULL_KMH = 11.0f

    /**
     * While a session is recording, the legs never stop entirely.
     *
     * A runner waiting at a crossing, or one whose GPS has briefly dropped to zero, should see a
     * figure still moving on the spot: a frozen runner reads as a crashed app.
     */
    const val TRACKING_WALK_FLOOR = 0.30f

    /** Likewise, the overall motion never drops below this while recording. */
    const val TRACKING_INTENSITY_FLOOR = 0.34f

    /** Standing still, the figure still shifts its weight this much. */
    const val IDLE_MOTION = 0.16f

    fun smoothstep(edge0: Float, edge1: Float, x: Float): Float {
        val t = ((x - edge0) / (edge1 - edge0)).coerceIn(0f, 1f)
        return t * t * (3f - 2f * t)
    }

    /** 0 = not running at all, 1 = a full running posture. */
    fun runBlend(speedKmh: Float, tracking: Boolean): Float =
        if (!tracking) 0f else smoothstep(RUN_START_KMH, RUN_FULL_KMH, speedKmh)

    /** 0 = not walking, 1 = a full walking posture. Fades out as the run blend takes over. */
    fun walkBlend(speedKmh: Float, tracking: Boolean): Float {
        if (!tracking) return 0f
        val run = runBlend(speedKmh, tracking)
        val walk = smoothstep(WALK_START_KMH, WALK_FULL_KMH, speedKmh)
        return maxOf(walk, TRACKING_WALK_FLOOR) * (1f - run)
    }

    /** How vigorously the whole figure moves. */
    fun intensity(speedKmh: Float, tracking: Boolean): Float =
        if (!tracking) 0f else (speedKmh / 13f).coerceIn(TRACKING_INTENSITY_FLOOR, 1f)

    /**
     * Steps per minute.
     *
     * Real runners hold a fairly narrow cadence and lengthen their stride instead, so this rises
     * far more slowly than speed does — the legs visibly quicken without the figure turning into
     * a flicker at 18 km/h.
     */
    fun cadenceStepsPerMinute(speedKmh: Float): Float =
        (85f + 7f * speedKmh).coerceIn(90f, 190f)

    /** Stride cycles per second: what the animation phase actually advances at. */
    fun cyclesPerSecond(speedKmh: Float, tracking: Boolean): Float {
        val moving = cadenceStepsPerMinute(speedKmh) / 120f * intensity(speedKmh, tracking)
        // Standing still the phase still creeps forward, which is what drives the idle
        // weight-shift; without it the figure is a photograph.
        return maxOf(moving, IDLE_MOTION)
    }

    /**
     * How far the feet travel, as a fraction of figure height. Never zero while recording — this
     * is the number whose vanishing made the runner look like a static icon.
     */
    fun strideFraction(speedKmh: Float, tracking: Boolean): Float {
        val walk = walkBlend(speedKmh, tracking)
        val run = runBlend(speedKmh, tracking)
        val moving = (0.140f * walk + 0.165f * run) * intensity(speedKmh, tracking)
        return if (tracking) moving else IDLE_STRIDE
    }

    /** The barely-there weight shift of a figure standing and breathing. */
    const val IDLE_STRIDE = 0.012f
}
