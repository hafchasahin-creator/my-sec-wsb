package sleep.clawd.audio

import android.app.PendingIntent
import android.content.Intent
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import sleep.clawd.MainActivity

/**
 * Keeps audio alive when the app is not in front.
 *
 * A MediaSessionService is the only arrangement Android actually guarantees for
 * multi-hour playback: it runs as a foreground service with the mediaPlayback
 * type, which exempts it from Doze and from background-execution limits, and it
 * gives the lock screen a real transport for free.
 *
 * The session is attached to the music player. Ambience rides alongside it in
 * the same process and the same Engine, deliberately not exposed to the session
 * — a headset button should pause the music, not silence the rain.
 */
class PlaybackService : MediaSessionService() {

    private var session: MediaSession? = null

    override fun onCreate() {
        super.onCreate()
        val engine = Engine.get(this)
        val open = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_IMMUTABLE
        )
        session = MediaSession.Builder(this, engine.musicPlayer)
            .setSessionActivity(open)
            .build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    override fun onTaskRemoved(rootIntent: Intent?) {
        // Swiping the app away while a sound is playing is not a request to stop
        // it — people do that on purpose before putting the phone down. Only tear
        // down when nothing is actually making sound.
        val engine = Engine.get(this)
        if (!engine.musicPlayer.isPlaying && !engine.ambiencePlayer.isPlaying) {
            stopSelf()
        }
    }

    override fun onDestroy() {
        session?.run { release() }
        session = null
        super.onDestroy()
    }
}
