package com.imran.runner.tracking

import android.annotation.SuppressLint
import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.imran.runner.ImranRunnerApp
import com.imran.runner.MainActivity
import com.imran.runner.R
import com.imran.runner.core.Format
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

/**
 * Keeps a run recording when the phone is in a pocket with the screen off.
 *
 * The service holds no state of its own: it holds a location reference on [RunTracker] and
 * mirrors that tracker into an ongoing notification, so whichever way the run is controlled —
 * the screen or the notification — there is only ever one set of numbers.
 */
class TrackingService : Service() {

    companion object {
        const val ACTION_START = "com.imran.runner.action.START"
        const val ACTION_PAUSE = "com.imran.runner.action.PAUSE"
        const val ACTION_RESUME = "com.imran.runner.action.RESUME"
        const val ACTION_FINISH = "com.imran.runner.action.FINISH"

        private const val NOTIFICATION_ID = 8_141

        /**
         * The tracker publishes at 5 Hz for the sake of a smooth screen. The notification shows
         * whole seconds, so rebuilding it that often would be twelve thousand pointless wakeups
         * over an hour's run with the screen off.
         */
        private const val NOTIFICATION_INTERVAL_MS = 1_000L

        fun start(context: Context) {
            try {
                ContextCompat.startForegroundService(context, context.trackingIntent(ACTION_START))
            } catch (e: IllegalStateException) {
                // Android refuses foreground service starts from the background. The run still
                // records while the app is on screen; it simply will not survive being closed.
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, TrackingService::class.java))
        }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val tracker: RunTracker get() = (application as ImranRunnerApp).tracker

    private var started = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PAUSE -> tracker.pause()
            ACTION_RESUME -> tracker.resume()
            ACTION_FINISH -> {
                tracker.finish()
                stopSelf()
                return START_NOT_STICKY
            }
        }

        if (!started) {
            started = true
            goForeground()
            tracker.acquire()
            scope.launch {
                var lastShownAt = 0L
                var lastState: RunState? = null
                tracker.metrics.collectLatest { metrics ->
                    val now = SystemClock.elapsedRealtime()
                    // Pausing or resuming changes the action button, so that always redraws
                    // immediately; otherwise once a second is as fine as the text can show.
                    if (metrics.state != lastState || now - lastShownAt >= NOTIFICATION_INTERVAL_MS) {
                        lastShownAt = now
                        lastState = metrics.state
                        NotificationManagerCompat.from(this@TrackingService)
                            .notifyIfAllowed(NOTIFICATION_ID, buildNotification(metrics))
                    }
                }
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        if (started) {
            tracker.release()
            started = false
        }
        scope.cancel()
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    private fun goForeground() {
        val notification = buildNotification(tracker.metrics.value)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ServiceCompat.startForeground(
                    this,
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (e: SecurityException) {
            // Location permission was revoked between starting the run and the service landing.
            stopSelf()
        }
    }

    // POST_NOTIFICATIONS is optional here: if it was declined the run still records, so the throw
    // is caught rather than the call being gated on a permission the app does not require.
    @SuppressLint("MissingPermission")
    private fun NotificationManagerCompat.notifyIfAllowed(id: Int, notification: Notification) {
        try {
            notify(id, notification)
        } catch (e: SecurityException) {
            // POST_NOTIFICATIONS was declined; the run keeps recording regardless.
        }
    }

    private fun buildNotification(metrics: RunMetrics): Notification {
        val running = metrics.state == RunState.RUNNING
        val content = buildString {
            append(Format.distanceKm(metrics.distanceMeters)).append(" km")
            append("  ·  ").append(Format.duration(metrics.elapsedMs))
            append("  ·  ").append(Format.integer(metrics.calories)).append(" kcal")
        }

        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java)
                .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        return NotificationCompat.Builder(this, ImranRunnerApp.CHANNEL_TRACKING)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(if (running) "Imran Runner · recording" else "Imran Runner · paused")
            .setContentText(content)
            .setContentIntent(open)
            .setOngoing(true)
            .setSilent(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_WORKOUT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .addAction(
                0,
                if (running) "Pause" else "Resume",
                servicePendingIntent(if (running) ACTION_PAUSE else ACTION_RESUME, 1),
            )
            .addAction(0, "Finish", servicePendingIntent(ACTION_FINISH, 2))
            .build()
    }

    private fun servicePendingIntent(action: String, requestCode: Int): PendingIntent =
        PendingIntent.getService(
            this,
            requestCode,
            trackingIntent(action),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
}
