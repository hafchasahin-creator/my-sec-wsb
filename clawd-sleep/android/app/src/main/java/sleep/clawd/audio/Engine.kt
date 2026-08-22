package sleep.clawd.audio

import android.content.Context
import android.net.Uri
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.math.cos
import kotlin.math.PI

/**
 * Two players, on purpose.
 *
 * The user's own track and the ambience bed need independent volumes, independent
 * looping, and independent lifetimes — one ExoPlayer with a mixing source would
 * give none of that without a custom renderer. Two instances cost a few hundred
 * kilobytes and behave exactly as you would expect at 4am.
 *
 * The music player is the one attached to the MediaSession, so the lock screen
 * and a headset button control the thing a person thinks of as "the music".
 */
class Engine private constructor(private val app: Context) {

    data class State(
        val ready: Boolean = false,
        val playing: Boolean = false,
        val trackName: String? = null,
        val ambienceId: String? = null,
        val durationMs: Long = 0,
        val positionMs: Long = 0,
        val error: String? = null,
        val ambiencePreparing: Boolean = false,
    )

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    /** Attenuates both players together for the sleep-timer taper. */
    private var master = 1f
    private var musicVol = 0.7f
    private var ambienceVol = 0.5f
    private var fadeJob: Job? = null
    private var timerJob: Job? = null

    val musicPlayer: ExoPlayer by lazy {
        ExoPlayer.Builder(app)
            .setAudioAttributes(sleepAudioAttributes(), /* handleAudioFocus = */ true)
            // A sleep app must not resume by itself after a call or another app
            // takes over — waking to music at 3am is worse than silence.
            .setHandleAudioBecomingNoisy(true)
            .build()
            .apply {
                repeatMode = Player.REPEAT_MODE_ONE
                addListener(object : Player.Listener {
                    override fun onIsPlayingChanged(isPlaying: Boolean) = push()
                    override fun onPlaybackStateChanged(state: Int) = push()
                    override fun onPlayerError(error: PlaybackException) {
                        _state.value = _state.value.copy(error = describe(error), playing = false)
                    }
                })
            }
    }

    val ambiencePlayer: ExoPlayer by lazy {
        ExoPlayer.Builder(app)
            .setAudioAttributes(sleepAudioAttributes(), /* handleAudioFocus = */ false)
            .build()
            .apply { repeatMode = Player.REPEAT_MODE_ONE }
    }

    private fun sleepAudioAttributes() = AudioAttributes.Builder()
        // MEDIA rather than a notification/alarm usage: it follows the media
        // volume slider, ducks politely, and respects Do Not Disturb.
        .setUsage(C.USAGE_MEDIA)
        .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
        .build()

    private fun describe(e: PlaybackException) = when (e.errorCode) {
        PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND -> "that file has moved — pick it again"
        PlaybackException.ERROR_CODE_IO_NO_PERMISSION -> "no permission to read that file"
        PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED,
        PlaybackException.ERROR_CODE_DECODER_INIT_FAILED -> "this phone can't play that format"
        PlaybackException.ERROR_CODE_DRM_SCHEME_UNSUPPORTED -> "that file is copy protected"
        else -> "that file would not play"
    }

    private fun push() {
        _state.value = _state.value.copy(
            ready = true,
            playing = musicPlayer.isPlaying || ambiencePlayer.isPlaying,
            durationMs = musicPlayer.duration.let { if (it == C.TIME_UNSET) 0 else it },
            positionMs = musicPlayer.currentPosition.coerceAtLeast(0),
        )
    }

    fun tickPosition() = push()

    /* ------------------------------------------------------------ music -- */

    fun setTrack(uri: Uri, name: String) {
        musicPlayer.setMediaItem(MediaItem.fromUri(uri))
        musicPlayer.prepare()
        _state.value = _state.value.copy(trackName = name, error = null)
    }

    fun clearTrack() {
        musicPlayer.stop()
        musicPlayer.clearMediaItems()
        _state.value = _state.value.copy(trackName = null, durationMs = 0, positionMs = 0)
    }

    fun seekTo(ms: Long) { musicPlayer.seekTo(ms); push() }

    fun setLoop(on: Boolean) {
        musicPlayer.repeatMode = if (on) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF
    }

    /* --------------------------------------------------------- ambience -- */

    fun setAmbience(id: String?) {
        if (id == _state.value.ambienceId) return
        _state.value = _state.value.copy(ambienceId = id)
        if (id == null) {
            fadeAmbienceTo(0f, 1200) { ambiencePlayer.stop(); ambiencePlayer.clearMediaItems() }
            return
        }
        _state.value = _state.value.copy(ambiencePreparing = true)
        scope.launch {
            // Synthesis is ~0.5s of pure CPU; it must not touch the main thread.
            val f: File = withContext(Dispatchers.IO) { Ambience.fileFor(app.cacheDir, id) }
            ambiencePlayer.volume = 0f
            ambiencePlayer.setMediaItem(MediaItem.fromUri(Uri.fromFile(f)))
            ambiencePlayer.repeatMode = Player.REPEAT_MODE_ONE
            ambiencePlayer.prepare()
            ambiencePlayer.playWhenReady = true
            _state.value = _state.value.copy(ambiencePreparing = false)
            fadeAmbienceTo(ambienceVol * master, 2400)
            push()
        }
    }

    /* ---------------------------------------------------------- volumes -- */

    fun setMusicVolume(v: Float) { musicVol = v.coerceIn(0f, 1f); applyVolumes() }
    fun setAmbienceVolume(v: Float) { ambienceVol = v.coerceIn(0f, 1f); applyVolumes() }

    private fun applyVolumes() {
        musicPlayer.volume = musicVol * master
        ambiencePlayer.volume = ambienceVol * master
    }

    /* ------------------------------------------------------------ fades -- */

    /**
     * Equal-power fade. A linear ramp on a volume control sounds like nothing
     * happens and then everything happens at the end; cos² tracks perceived
     * loudness, so a 90-second taper is genuinely unnoticeable.
     */
    private fun fadeAmbienceTo(target: Float, ms: Long, onEnd: (() -> Unit)? = null) {
        val from = ambiencePlayer.volume
        scope.launch {
            val steps = (ms / 40).toInt().coerceAtLeast(1)
            repeat(steps) { i ->
                val t = (i + 1).toFloat() / steps
                val k = ((1 - cos(t * PI)) / 2).toFloat()
                ambiencePlayer.volume = from + (target - from) * k
                delay(40)
            }
            ambiencePlayer.volume = target
            onEnd?.invoke()
        }
    }

    fun play(fadeMs: Long = 2400) {
        fadeJob?.cancel()
        master = 1f
        if (musicPlayer.mediaItemCount > 0) {
            musicPlayer.volume = 0f
            musicPlayer.playWhenReady = true
        }
        if (ambiencePlayer.mediaItemCount > 0) {
            ambiencePlayer.playWhenReady = true
        }
        fadeJob = scope.launch {
            val steps = (fadeMs / 40).toInt().coerceAtLeast(1)
            repeat(steps) { i ->
                val t = (i + 1).toFloat() / steps
                val k = ((1 - cos(t * PI)) / 2).toFloat()
                musicPlayer.volume = musicVol * k
                ambiencePlayer.volume = ambienceVol * k
                delay(40)
            }
            applyVolumes()
        }
        push()
    }

    fun pause(fadeMs: Long = 1100) {
        fadeJob?.cancel()
        fadeJob = scope.launch {
            val m0 = musicPlayer.volume
            val a0 = ambiencePlayer.volume
            val steps = (fadeMs / 40).toInt().coerceAtLeast(1)
            repeat(steps) { i ->
                val t = (i + 1).toFloat() / steps
                val k = ((1 + cos(t * PI)) / 2).toFloat()
                musicPlayer.volume = m0 * k
                ambiencePlayer.volume = a0 * k
                delay(40)
            }
            musicPlayer.playWhenReady = false
            ambiencePlayer.playWhenReady = false
            push()
        }
        _state.value = _state.value.copy(playing = false)
    }

    /* ------------------------------------------------------ sleep timer -- */

    /** Runs the countdown, tapers the last 90s to nothing, then stops. */
    fun startTimer(minutes: Int) {
        timerJob?.cancel()
        master = 1f
        applyVolumes()
        if (minutes <= 0) return
        val endsAt = System.currentTimeMillis() + minutes * 60_000L
        timerJob = scope.launch {
            while (true) {
                // Wall clock, not an accumulated counter: a counter drifts, and a
                // dozing process drifts badly.
                val left = endsAt - System.currentTimeMillis()
                if (left <= 0) break
                master = if (left >= TAPER_MS) 1f else {
                    val t = 1f - left.toFloat() / TAPER_MS
                    ((1 + cos(t * PI)) / 2).toFloat()
                }
                applyVolumes()
                delay(if (left > TAPER_MS) 1000 else 60)
            }
            master = 0f
            applyVolumes()
            musicPlayer.playWhenReady = false
            ambiencePlayer.playWhenReady = false
            _state.value = _state.value.copy(playing = false)
            master = 1f
        }
    }

    fun cancelTimer() {
        timerJob?.cancel(); timerJob = null
        master = 1f; applyVolumes()
    }

    fun timerRemainingMs(minutes: Int, startedAt: Long): Long =
        (startedAt + minutes * 60_000L - System.currentTimeMillis()).coerceAtLeast(0)

    fun release() {
        fadeJob?.cancel(); timerJob?.cancel()
        musicPlayer.release()
        ambiencePlayer.release()
        instance = null
    }

    companion object {
        private const val TAPER_MS = 90_000f
        @Volatile private var instance: Engine? = null

        fun get(context: Context): Engine =
            instance ?: synchronized(this) {
                instance ?: Engine(context.applicationContext).also { instance = it }
            }
    }
}
