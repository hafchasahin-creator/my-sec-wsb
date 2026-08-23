package com.imran.runner.data

import com.imran.runner.tracking.RoutePoint

/**
 * Line-oriented storage format for runs.
 *
 * Every field is a number, so there is nothing to escape and a corrupt line can be dropped
 * without taking the rest of the history with it. `Double.toString` is locale-independent and
 * round-trips exactly, which a formatted decimal would not.
 */
object RunCodec {

    private const val VERSION = 1
    private const val SEP = '|'

    fun encodeRun(run: RunRecord): String = buildString {
        append(VERSION).append(SEP)
        append(run.id).append(SEP)
        append(run.startedAtEpochMs).append(SEP)
        append(run.durationMs).append(SEP)
        append(run.distanceMeters).append(SEP)
        append(run.calories).append(SEP)
        append(run.avgSpeedMps).append(SEP)
        append(run.maxSpeedMps).append(SEP)
        append(run.avgPaceSecPerKm).append(SEP)
        append(run.elevationGainMeters).append(SEP)
        append(run.routePointCount)
    }

    /** Returns null for anything unparseable, so one bad line cannot lose a history. */
    fun decodeRun(line: String): RunRecord? {
        val parts = line.trim().split(SEP)
        if (parts.size < 11) return null
        if (parts[0].toIntOrNull() != VERSION) return null
        return try {
            RunRecord(
                id = parts[1].toLong(),
                startedAtEpochMs = parts[2].toLong(),
                durationMs = parts[3].toLong(),
                distanceMeters = parts[4].toDouble(),
                calories = parts[5].toDouble(),
                avgSpeedMps = parts[6].toDouble(),
                maxSpeedMps = parts[7].toDouble(),
                avgPaceSecPerKm = parts[8].toDouble(),
                elevationGainMeters = parts[9].toDouble(),
                routePointCount = parts[10].toInt(),
            )
        } catch (e: NumberFormatException) {
            null
        }
    }

    fun encodePoint(point: RoutePoint): String =
        "${point.latitude},${point.longitude},${point.elapsedMs},${point.speedMps}"

    fun decodePoint(line: String): RoutePoint? {
        val parts = line.trim().split(',')
        if (parts.size < 4) return null
        return try {
            RoutePoint(
                latitude = parts[0].toDouble(),
                longitude = parts[1].toDouble(),
                elapsedMs = parts[2].toLong(),
                speedMps = parts[3].toFloat(),
            )
        } catch (e: NumberFormatException) {
            null
        }
    }
}
