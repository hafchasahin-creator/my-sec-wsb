package com.veergames.veer.data

import android.content.Context
import android.content.SharedPreferences
import com.veergames.veer.core.Levels

/** Sound/music/haptics toggles. */
class Settings(context: Context) {
    private val p: SharedPreferences =
        context.getSharedPreferences("veer_settings", Context.MODE_PRIVATE)

    var sound: Boolean
        get() = p.getBoolean("sound", true)
        set(v) = p.edit().putBoolean("sound", v).apply()
    var music: Boolean
        get() = p.getBoolean("music", true)
        set(v) = p.edit().putBoolean("music", v).apply()
    var haptics: Boolean
        get() = p.getBoolean("haptics", true)
        set(v) = p.edit().putBoolean("haptics", v).apply()
}

/** Local level progress: stars, best times, unlocks, tutorial flag. */
class Progress(context: Context) {
    private val p: SharedPreferences =
        context.getSharedPreferences("veer_progress", Context.MODE_PRIVATE)

    val levelCount: Int get() = Levels.all.size

    fun stars(level: Int): Int = p.getInt("stars_$level", 0)
    fun bestTimeMs(level: Int): Long = p.getLong("time_$level", 0L)

    /** Highest playable level number (1-based). */
    fun unlockedUpTo(): Int {
        var last = 1
        for (n in 1..levelCount) if (stars(n) > 0) last = minOf(n + 1, levelCount)
        return last
    }

    fun isUnlocked(level: Int): Boolean = level <= unlockedUpTo()
    fun isCompleted(level: Int): Boolean = stars(level) > 0
    fun allCompleted(): Boolean = (1..levelCount).all { isCompleted(it) }

    var tutorialSeen: Boolean
        get() = p.getBoolean("tutorial_seen", false)
        set(v) = p.edit().putBoolean("tutorial_seen", v).apply()

    fun recordResult(level: Int, stars: Int, timeMs: Long) {
        val e = p.edit()
        if (stars > stars(level)) e.putInt("stars_$level", stars)
        val best = bestTimeMs(level)
        if (best == 0L || timeMs < best) e.putLong("time_$level", timeMs)
        e.apply()
    }

    fun resetAll() = p.edit().clear().apply()
}
