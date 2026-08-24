package com.veergames.veer.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.SoundPool
import android.util.Log
import com.veergames.veer.data.Settings
import kotlin.math.pow

/**
 * Short effects go through [SoundPool]; the ambient bed goes through a
 * [MediaPlayer] (SoundPool is for short clips and will not load a multi-second
 * asset). Audio focus is requested so the bed ducks for other apps instead of
 * talking over them, and every entry point is a guarded no-op when audio is
 * unavailable or the player has switched it off.
 */
class SoundManager(private val context: Context, private val settings: Settings) {

    private var pool: SoundPool? = null
    private val ids = HashMap<String, Int>()
    private val loaded = HashSet<Int>()

    private var music: MediaPlayer? = null
    private var musicVol = 0.42f
    private var duck = 1f

    private val audioManager =
        context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
    private var focusRequest: AudioFocusRequest? = null
    private var hasFocus = false

    /** Per-effect gain, so the mix is deliberate rather than accidental. */
    private val gain = mapOf(
        "win" to 0.95f, "star" to 0.74f, "escape" to 0.58f, "launch" to 0.53f,
        "flame" to 0.62f, "blocked" to 0.47f, "tap" to 0.30f,
    )
    private val priority = mapOf(
        "win" to 5, "blocked" to 4, "star" to 3, "escape" to 2,
        "launch" to 2, "flame" to 2, "tap" to 1,
    )

    init {
        try {
            val attrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_GAME)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            val p = SoundPool.Builder().setMaxStreams(16).setAudioAttributes(attrs).build()
            p.setOnLoadCompleteListener { _, sampleId, status ->
                if (status == 0) loaded.add(sampleId)
                else Log.w("Veer", "sound load failed id=$sampleId status=$status")
            }
            pool = p
            for (name in listOf("tap", "launch", "flame", "escape", "blocked", "win", "star")) {
                try {
                    context.assets.openFd("audio/$name.wav").use { fd ->
                        ids[name] = p.load(fd, priority[name] ?: 1)
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

    private fun play(name: String, volScale: Float = 1f, rate: Float = 1f) {
        if (!settings.sound) return
        val p = pool ?: return
        val id = ids[name] ?: return
        if (id !in loaded) return
        val v = (gain[name] ?: 0.6f) * volScale
        try {
            p.play(id, v, v, priority[name] ?: 1, 0, rate.coerceIn(0.5f, 2f))
        } catch (_: Throwable) {}
    }

    fun tap() = play("tap")

    /** Softer, lower variant for backward navigation. */
    fun back() = play("tap", 0.8f, 0.79f)

    /** Launch cue; the Flame skin swaps in its own fiery swoosh. */
    fun launch(fiery: Boolean = false) {
        val rate = 0.96f + (Math.random() * 0.08f).toFloat()
        if (fiery) {
            play("flame", 1f, rate)
            play("launch", 0.55f, rate)
        } else {
            play("launch", 1f, rate)
        }
    }

    /** Pentatonic ladder, so a long chain stays musical instead of sour. */
    fun escape(combo: Int) {
        val steps = intArrayOf(0, 3, 5, 8, 10, 12, 15, 17, 20, 12, 15)
        val semis = steps[combo.coerceAtLeast(0) % steps.size]
        play("escape", 1f, 2f.pow(semis / 12f).coerceAtMost(2f))
    }

    fun blocked() = play("blocked")
    fun win() = play("win")

    /** Three stars, three pitches: a major triad as they land. */
    fun star(index: Int) =
        play("star", 1f, 2f.pow(intArrayOf(0, 4, 7)[index.coerceIn(0, 2)] / 12f))

    // ---------------------------------------------------------------- music

    fun updateMusic() {
        if (settings.music) startMusic() else stopMusic()
    }

    private fun requestFocus() {
        if (hasFocus) return
        val am = audioManager ?: return
        try {
            val attrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_GAME)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build()
            val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(attrs)
                .setWillPauseWhenDucked(false)
                .setOnAudioFocusChangeListener { change ->
                    when (change) {
                        AudioManager.AUDIOFOCUS_LOSS -> { hasFocus = false; stopMusic() }
                        AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> music?.pause()
                        AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                            duck = 0.25f; applyMusicVolume()
                        }
                        AudioManager.AUDIOFOCUS_GAIN -> {
                            duck = 1f; applyMusicVolume()
                            if (settings.music) music?.start()
                        }
                    }
                }
                .build()
            focusRequest = req
            hasFocus = am.requestAudioFocus(req) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        } catch (_: Throwable) {}
    }

    private fun abandonFocus() {
        val am = audioManager ?: return
        val req = focusRequest ?: return
        try { am.abandonAudioFocusRequest(req) } catch (_: Throwable) {}
        hasFocus = false
    }

    private fun applyMusicVolume() {
        try { music?.setVolume(musicVol * duck, musicVol * duck) } catch (_: Throwable) {}
    }

    private fun startMusic() {
        if (!settings.music) return
        try {
            if (music == null) {
                val mp = MediaPlayer()
                val fd = context.assets.openFd("audio/music.ogg")
                mp.setDataSource(fd.fileDescriptor, fd.startOffset, fd.length)
                fd.close()
                mp.setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_GAME)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build())
                mp.isLooping = true
                mp.prepare()
                music = mp
            }
            requestFocus()
            applyMusicVolume()
            music?.let { if (!it.isPlaying) it.start() }
        } catch (e: Throwable) {
            Log.w("Veer", "music unavailable: $e")
            music = null
        }
    }

    fun stopMusic() {
        try { music?.let { if (it.isPlaying) it.pause() } } catch (_: Throwable) {}
    }

    fun onPause() {
        stopMusic()
        try { pool?.autoPause() } catch (_: Throwable) {}
    }

    fun onResume() {
        try { pool?.autoResume() } catch (_: Throwable) {}
        updateMusic()
    }

    fun release() {
        try { pool?.release() } catch (_: Throwable) {}
        pool = null
        try { music?.release() } catch (_: Throwable) {}
        music = null
        abandonFocus()
    }
}
