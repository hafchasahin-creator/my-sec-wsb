package com.imran.runner.core

import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/** Spherical-earth geodesy. Accurate to a few centimetres over the distances a run covers. */
object Geo {

    /** IUGG mean earth radius. */
    private const val EARTH_RADIUS_M = 6_371_008.8

    /**
     * Great-circle distance in metres.
     *
     * Uses the haversine form rather than the spherical law of cosines because consecutive GPS
     * fixes during a run are only a handful of metres apart, where the law of cosines loses
     * precision to floating-point cancellation.
     */
    fun distanceMeters(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val phi1 = Math.toRadians(lat1)
        val phi2 = Math.toRadians(lat2)
        val halfDPhi = Math.toRadians(lat2 - lat1) / 2.0
        val halfDLambda = Math.toRadians(lon2 - lon1) / 2.0

        val sinPhi = sin(halfDPhi)
        val sinLambda = sin(halfDLambda)
        val a = sinPhi * sinPhi + cos(phi1) * cos(phi2) * sinLambda * sinLambda
        return 2.0 * EARTH_RADIUS_M * asin(min(1.0, sqrt(a)))
    }
}
