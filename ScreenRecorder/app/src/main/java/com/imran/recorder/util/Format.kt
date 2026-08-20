package com.imran.recorder.util

import java.util.Locale
import java.util.concurrent.TimeUnit

object Format {

    /** mm:ss, or h:mm:ss once the clip passes an hour. */
    fun clock(ms: Long): String {
        val total = if (ms < 0) 0 else ms
        val h = TimeUnit.MILLISECONDS.toHours(total)
        val m = TimeUnit.MILLISECONDS.toMinutes(total) % 60
        val s = TimeUnit.MILLISECONDS.toSeconds(total) % 60
        return if (h > 0) String.format(Locale.US, "%d:%02d:%02d", h, m, s)
        else String.format(Locale.US, "%02d:%02d", m, s)
    }

    fun size(bytes: Long): String {
        if (bytes <= 0) return "0 B"
        val units = arrayOf("B", "KB", "MB", "GB", "TB")
        var v = bytes.toDouble()
        var i = 0
        while (v >= 1024 && i < units.lastIndex) {
            v /= 1024; i++
        }
        return if (i == 0) "${v.toInt()} ${units[i]}"
        else String.format(Locale.US, "%.1f %s", v, units[i])
    }

    /** Compact form for the storage pill, e.g. "41.3G". */
    fun sizeShort(bytes: Long): String {
        val gb = bytes / 1_073_741_824.0
        return if (gb >= 10) String.format(Locale.US, "%.0fG", gb)
        else String.format(Locale.US, "%.1fG", gb)
    }

    fun date(epochSeconds: Long): String {
        val fmt = java.text.SimpleDateFormat("d MMM yyyy · HH:mm", Locale.getDefault())
        return fmt.format(java.util.Date(epochSeconds * 1000))
    }

    fun resolutionLabel(shortEdge: Int): String = when (shortEdge) {
        0 -> "Native"
        480 -> "480p"
        720 -> "720p (HD)"
        1080 -> "1080p (Full HD)"
        else -> "${shortEdge}p"
    }

    fun qualityLabel(q: Int): String = when (q) {
        0 -> "Economy"
        2 -> "High"
        else -> "Standard"
    }
}
