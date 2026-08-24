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

    /** Equipped arrow skin id; resolved through Skins.byId so a stale or
     *  unknown value falls back to Classic instead of crashing. */
    var skinId: String
        get() = p.getString("skin", "classic") ?: "classic"
        set(v) = p.edit().putString("skin", v).apply()
}

/** Local level progress: stars, best times, unlocks, tutorial flag. */
class Progress(context: Context) {
    private val p: SharedPreferences =
        context.getSharedPreferences("veer_progress", Context.MODE_PRIVATE)

    val levelCount: Int get() = Levels.all.size

    // level select reads these every frame; SharedPreferences is synchronized
    // and allocates, so keep a small cache and invalidate it on write
    private val starCache = IntArray(levelCount + 2) { -1 }

    fun stars(level: Int): Int {
        if (level in 1..levelCount) {
            val c = starCache[level]
            if (c >= 0) return c
            val v = p.getInt("stars_$level", 0)
            starCache[level] = v
            return v
        }
        return p.getInt("stars_$level", 0)
    }

    val totalStars: Int get() = (1..levelCount).sumOf { stars(it) }
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
        // invalidate after the write, or the cache would refill with the
        // value we just replaced
        if (level in starCache.indices) starCache[level] = -1
    }

    fun resetAll() {
        for (i in starCache.indices) starCache[i] = -1
        p.edit().clear().apply()
    }
}
