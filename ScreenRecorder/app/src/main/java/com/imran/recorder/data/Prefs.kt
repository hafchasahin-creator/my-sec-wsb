package com.imran.recorder.data

import android.content.Context
import android.content.SharedPreferences

/** Every user-facing recorder option lives here so the service, UI and overlays agree. */
object Prefs {

    private const val FILE = "imran_recorder"
    private lateinit var sp: SharedPreferences

    fun init(context: Context) {
        sp = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)
    }

    // --- keys ---
    private const val K_ONBOARDED = "onboarded"
    private const val K_AUDIO = "audio_source"
    private const val K_RES = "resolution"
    private const val K_FPS = "fps"
    private const val K_QUALITY = "quality"
    private const val K_ORIENT = "orientation"
    private const val K_COUNTDOWN = "countdown"
    private const val K_FLOATING = "floating"
    private const val K_FACECAM = "facecam"
    private const val K_BUBBLE_X = "bubble_x"
    private const val K_BUBBLE_Y = "bubble_y"
    private const val K_BRUSH_COLOR = "brush_color"
    private const val K_BRUSH_WIDTH = "brush_width"
    private const val K_SHAKE_STOP = "shake_stop"
    private const val K_MAX_MINUTES = "max_minutes"
    private const val K_HAPTICS = "haptics"
    private const val K_SORT = "library_sort"
    private const val K_OVERLAY_ASKED = "overlay_asked"

    var onboarded: Boolean
        get() = sp.getBoolean(K_ONBOARDED, false)
        set(v) = sp.edit().putBoolean(K_ONBOARDED, v).apply()

    /** One of [AudioSource]. */
    var audioSource: AudioSource
        get() = AudioSource.from(sp.getString(K_AUDIO, AudioSource.MUTE.key))
        set(v) = sp.edit().putString(K_AUDIO, v.key).apply()

    /** Short edge in pixels; 0 means "match the display". */
    var resolution: Int
        get() = sp.getInt(K_RES, 720)
        set(v) = sp.edit().putInt(K_RES, v).apply()

    var fps: Int
        get() = sp.getInt(K_FPS, 30)
        set(v) = sp.edit().putInt(K_FPS, v).apply()

    /** Bitrate multiplier bucket: 0 = economy, 1 = standard, 2 = high. */
    var quality: Int
        get() = sp.getInt(K_QUALITY, 1)
        set(v) = sp.edit().putInt(K_QUALITY, v).apply()

    var orientation: Orientation
        get() = Orientation.from(sp.getString(K_ORIENT, Orientation.AUTO.key))
        set(v) = sp.edit().putString(K_ORIENT, v.key).apply()

    /** Seconds of countdown before capture begins; 0 disables it. */
    var countdown: Int
        get() = sp.getInt(K_COUNTDOWN, 3)
        set(v) = sp.edit().putInt(K_COUNTDOWN, v).apply()

    var floatingEnabled: Boolean
        get() = sp.getBoolean(K_FLOATING, true)
        set(v) = sp.edit().putBoolean(K_FLOATING, v).apply()

    var facecamEnabled: Boolean
        get() = sp.getBoolean(K_FACECAM, false)
        set(v) = sp.edit().putBoolean(K_FACECAM, v).apply()

    var bubbleX: Int
        get() = sp.getInt(K_BUBBLE_X, -1)
        set(v) = sp.edit().putInt(K_BUBBLE_X, v).apply()

    var bubbleY: Int
        get() = sp.getInt(K_BUBBLE_Y, -1)
        set(v) = sp.edit().putInt(K_BUBBLE_Y, v).apply()

    var brushColor: Int
        get() = sp.getInt(K_BRUSH_COLOR, 0xFFFF3B30.toInt())
        set(v) = sp.edit().putInt(K_BRUSH_COLOR, v).apply()

    var brushWidth: Float
        get() = sp.getFloat(K_BRUSH_WIDTH, 10f)
        set(v) = sp.edit().putFloat(K_BRUSH_WIDTH, v).apply()

    /** Shake the device to end a capture without hunting for a control. */
    var shakeToStop: Boolean
        get() = sp.getBoolean(K_SHAKE_STOP, false)
        set(v) = sp.edit().putBoolean(K_SHAKE_STOP, v).apply()

    /** Auto-stop after this many minutes; 0 means no limit. */
    var maxMinutes: Int
        get() = sp.getInt(K_MAX_MINUTES, 0)
        set(v) = sp.edit().putInt(K_MAX_MINUTES, v).apply()

    var haptics: Boolean
        get() = sp.getBoolean(K_HAPTICS, true)
        set(v) = sp.edit().putBoolean(K_HAPTICS, v).apply()

    /** Whether the overlay rationale has been shown, so it is asked once, not every capture. */
    var overlayAsked: Boolean
        get() = sp.getBoolean(K_OVERLAY_ASKED, false)
        set(v) = sp.edit().putBoolean(K_OVERLAY_ASKED, v).apply()

    var sort: SortMode
        get() = SortMode.from(sp.getString(K_SORT, SortMode.NEWEST.key))
        set(v) = sp.edit().putString(K_SORT, v.key).apply()

    fun bitrateFor(width: Int, height: Int, fps: Int): Int {
        // ~0.1 bits per pixel per frame at standard quality, clamped to sane encoder limits.
        val factor = when (quality) {
            0 -> 0.06
            2 -> 0.18
            else -> 0.10
        }
        val bps = (width.toLong() * height * fps * factor).toLong()
        return bps.coerceIn(1_500_000L, 42_000_000L).toInt()
    }
}

enum class AudioSource(val key: String, val label: String) {
    MUTE("mute", "No audio"),
    MIC("mic", "Microphone"),
    INTERNAL("internal", "Device audio"),
    INTERNAL_MIC("internal_mic", "Device audio + mic");

    val needsMic: Boolean get() = this == MIC || this == INTERNAL_MIC
    val needsProjectionAudio: Boolean get() = this == INTERNAL || this == INTERNAL_MIC

    companion object {
        fun from(k: String?) = entries.firstOrNull { it.key == k } ?: MUTE
    }
}

enum class SortMode(val key: String, val label: String) {
    NEWEST("newest", "Newest first"),
    OLDEST("oldest", "Oldest first"),
    LARGEST("largest", "Largest first"),
    LONGEST("longest", "Longest first"),
    NAME("name", "Name A–Z");

    companion object {
        fun from(k: String?) = entries.firstOrNull { it.key == k } ?: NEWEST
    }
}

enum class Orientation(val key: String, val label: String) {
    AUTO("auto", "Auto"),
    PORTRAIT("portrait", "Portrait"),
    LANDSCAPE("landscape", "Landscape");

    companion object {
        fun from(k: String?) = entries.firstOrNull { it.key == k } ?: AUTO
    }
}
