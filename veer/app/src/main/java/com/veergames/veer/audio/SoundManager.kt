package com.veergames.veer.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.SoundPool
import android.util.Log
import com.veergames.veer.data.Settings
import kotlin.math.pow

/**
 * SoundPool-backed effects + ambient music loop. All entry points are
 * no-ops if audio is unavailable (e.g. headless tests) or toggled off.
 */
class SoundManager(private val context: Context, private val settings: Settings) {

    private var pool: SoundPool? = null
    private val ids = HashMap<String, Int>()
    private val loaded = HashSet<Int>()
    private var musicStreamId = 0
    private var musicWantedWhenLoaded = false

    private val effectVol = 0.9f
    private val musicVol = 0.30f

    init {
        try {
            val attrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_GAME)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            val p = SoundPool.Builder().setMaxStreams(10).setAudioAttributes(attrs).build()
            p.setOnLoadCompleteListener { _, sampleId, status ->
                if (status == 0) {
                    loaded.add(sampleId)
                    if (musicWantedWhenLoaded && sampleId == ids["music"]) startMusicInternal()
                }
            }
            pool = p
            for (name in listOf("tap", "launch", "escape", "blocked", "win", "star", "music")) {
                try {
                    context.assets.openFd("audio/$name.wav").use { fd ->
                        ids[name] = p.load(fd, 1)
                    }
                } catch (e: Exception) {
                    Log.w("Veer", "sound $name missing: $e")
                }
            }
        } catch (e: Throwable) {
            Log.w("Veer", "audio disabled: $e")
            pool = null
        }
    }

    private fun play(name: String, vol: Float = effectVol, rate: Float = 1f) {
        if (!settings.sound) return
        val p = pool ?: return
        val id = ids[name] ?: return
        if (id !in loaded) return
        try {
            p.play(id, vol, vol, 1, 0, rate.coerceIn(0.5f, 2f))
        } catch (_: Throwable) {}
    }

    fun tap() = play("tap", 0.5f)
    fun launch() = play("launch", 0.8f, 0.96f + (Math.random() * 0.08f).toFloat())

    /** Rising pitch per combo step - +1 semitone each, capped at +8. */
    fun escape(combo: Int) =
        play("escape", 0.85f, 2f.pow(combo.coerceIn(0, 8) / 12f))

    fun blocked() = play("blocked", 0.9f)
    fun win() = play("win", 0.9f)
    fun star() = play("star", 0.7f, 1f)

    fun updateMusic() {
        if (settings.music) startMusicInternal() else stopMusic()
    }

    private fun startMusicInternal() {
        val p = pool ?: return
        val id = ids["music"] ?: return
        if (!settings.music) return
        if (id !in loaded) { musicWantedWhenLoaded = true; return }
        if (musicStreamId != 0) return
        try {
            musicStreamId = p.play(id, musicVol, musicVol, 0, -1, 1f)
        } catch (_: Throwable) {}
    }

    fun stopMusic() {
        musicWantedWhenLoaded = false
        val p = pool ?: return
        if (musicStreamId != 0) {
            try { p.stop(musicStreamId) } catch (_: Throwable) {}
            musicStreamId = 0
        }
    }

    fun onPause() = stopMusic()
    fun onResume() = updateMusic()

    fun release() {
        try { pool?.release() } catch (_: Throwable) {}
        pool = null
    }
}
