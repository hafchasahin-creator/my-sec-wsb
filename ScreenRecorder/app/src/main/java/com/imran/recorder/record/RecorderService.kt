package com.imran.recorder.record

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.imran.recorder.R
import com.imran.recorder.data.AudioSource
import com.imran.recorder.data.MediaStoreRepo
import com.imran.recorder.data.Prefs
import com.imran.recorder.overlay.OverlayService
import com.imran.recorder.ui.MainActivity
import com.imran.recorder.util.Perms
import kotlin.math.sqrt

/**
 * Owns the MediaProjection for the whole app: the recording, and any screenshot taken
 * while a recording is live. Runs in the foreground for the entire capture so Android
 * never tears it down when the user leaves the app.
 */
class RecorderService : Service() {

    private val main = Handler(Looper.getMainLooper())

    private var projection: MediaProjection? = null
    private var engine: RecorderEngine? = null
    private var pfd: ParcelFileDescriptor? = null
    private var outputUri: Uri? = null
    private var startedForeground = false
    private var shooting = false
    private var sensors: SensorManager? = null

    private var countdownLeft = 0
    private var pendingResultCode = Activity.RESULT_CANCELED
    private var pendingData: Intent? = null

    private val projectionCallback = object : MediaProjection.Callback() {
        override fun onStop() {
            // Fired when the user revokes capture from the system UI.
            main.post { finishRecording() }
        }
    }

    private val ticker = object : Runnable {
        override fun run() {
            val e = engine ?: return
            val ms = e.recordedMs()
            RecorderBus.setElapsed(ms)
            // A cheap fstat, so the live bar shows the real file size rather than an estimate.
            RecorderBus.setBytes(runCatching { pfd?.statSize ?: 0L }.getOrDefault(0L))

            val limit = Prefs.maxMinutes
            if (limit > 0 && ms >= limit * 60_000L) {
                RecorderBus.say("Reached the $limit-minute limit — recording saved")
                finishRecording()
                return
            }
            main.postDelayed(this, 250)
        }
    }

    /** Shake-to-stop: a firm shake ends the capture without hunting for a control. */
    private val shakeListener = object : SensorEventListener {
        private var lastTriggerAt = 0L

        override fun onSensorChanged(event: SensorEvent) {
            if (!RecorderBus.isCapturing) return
            val x = event.values[0]
            val y = event.values[1]
            val z = event.values[2]
            val gForce = sqrt(x * x + y * y + z * z) / SensorManager.GRAVITY_EARTH
            if (gForce < SHAKE_G) return

            val now = SystemClock.elapsedRealtime()
            // Debounce: one shake is many samples, and starting a capture often jostles the phone.
            if (now - lastTriggerAt < 1_500) return
            lastTriggerAt = now
            RecorderBus.say("Shake detected — recording saved")
            finishRecording()
        }

        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
    }

    private fun startShakeWatch() {
        if (!Prefs.shakeToStop) return
        val manager = getSystemService(SENSOR_SERVICE) as? SensorManager ?: return
        val accelerometer = manager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) ?: return
        manager.registerListener(shakeListener, accelerometer, SensorManager.SENSOR_DELAY_UI)
        sensors = manager
    }

    private fun stopShakeWatch() {
        runCatching { sensors?.unregisterListener(shakeListener) }
        sensors = null
    }

    private val countdownStep = object : Runnable {
        override fun run() {
            countdownLeft--
            if (countdownLeft <= 0) {
                RecorderBus.setCountdown(0)
                OverlayService.hideCountdown()
                beginCapture()
            } else {
                RecorderBus.setCountdown(countdownLeft)
                OverlayService.showCountdown(this@RecorderService, countdownLeft)
                main.postDelayed(this, 1_000)
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> handleStart(intent)
            ACTION_SHOOT_WITH -> handleShootWithConsent(intent)
            ACTION_SHOOT -> handleShoot()
            ACTION_STOP -> finishRecording()
            ACTION_PAUSE -> pauseRecording()
            ACTION_RESUME -> resumeRecording()
            ACTION_TOGGLE_PAUSE ->
                if (RecorderBus.state.value == RecState.PAUSED) resumeRecording() else pauseRecording()
            else -> if (!RecorderBus.isBusy && !shooting) stopSelf()
        }
        return START_NOT_STICKY
    }

    // ---------------- start ----------------

    private fun handleStart(intent: Intent) {
        if (RecorderBus.isCapturing) {
            RecorderBus.say("A recording is already running")
            return
        }
        val code = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
        val data = extractData(intent)
        if (code != Activity.RESULT_OK || data == null) {
            RecorderBus.setState(RecState.IDLE)
            stopSelfIfIdle()
            return
        }

        pendingResultCode = code
        pendingData = data
        goForeground()

        val seconds = Prefs.countdown
        if (seconds > 0) {
            countdownLeft = seconds
            RecorderBus.setState(RecState.COUNTDOWN)
            RecorderBus.setCountdown(seconds)
            OverlayService.showCountdown(this, seconds)
            main.postDelayed(countdownStep, 1_000)
        } else {
            beginCapture()
        }
    }

    private fun beginCapture() {
        val data = pendingData
        if (data == null) {
            RecorderBus.setState(RecState.IDLE)
            stopSelfIfIdle()
            return
        }
        RecorderBus.setState(RecState.STARTING)

        val mpm = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val mp = runCatching { mpm.getMediaProjection(pendingResultCode, data) }.getOrNull()
        pendingData = null

        if (mp == null) {
            fail("Could not start screen capture")
            return
        }
        mp.registerCallback(projectionCallback, main)
        projection = mp

        val cfg = CaptureGeometry.configFor(this)

        val name = MediaStoreRepo.timestampName("Recording", "mp4")
        val uri = MediaStoreRepo.createVideo(this, name)
        if (uri == null) {
            fail("Could not create the output file")
            return
        }
        outputUri = uri

        val descriptor = runCatching { contentResolver.openFileDescriptor(uri, "w") }.getOrNull()
        if (descriptor == null) {
            MediaStoreRepo.discard(this, uri)
            outputUri = null
            fail("Could not open the output file")
            return
        }
        pfd = descriptor

        val useCodec = cfg.audio.needsProjectionAudio && Perms.supportsInternalAudio(this)
        val chosen: RecorderEngine = if (useCodec) CodecEngine() else MediaRecorderEngine()

        if (chosen.start(mp, cfg, descriptor.fileDescriptor)) {
            engine = chosen
        } else {
            // A failed attempt may already have written a container header, so the retry gets a
            // clean file rather than appending to a half-initialised one.
            closeOutput(discard = true)

            val retryUri = MediaStoreRepo.createVideo(this, MediaStoreRepo.timestampName("Recording", "mp4"))
            val retryFd = retryUri?.let {
                runCatching { contentResolver.openFileDescriptor(it, "w") }.getOrNull()
            }
            if (retryUri == null || retryFd == null) {
                retryUri?.let { MediaStoreRepo.discard(this, it) }
                fail("This device refused the selected recording settings")
                return
            }
            outputUri = retryUri
            pfd = retryFd

            val fallback = MediaRecorderEngine()
            val safeCfg = cfg.copy(audio = AudioSource.MUTE)
            if (fallback.start(mp, safeCfg, retryFd.fileDescriptor)) {
                engine = fallback
                RecorderBus.say("Started without audio — the encoder rejected that audio mode")
            } else {
                closeOutput(discard = true)
                fail("This device refused the selected recording settings")
                return
            }
        }

        RecorderBus.setState(RecState.RECORDING)
        RecorderBus.setElapsed(0)
        RecorderBus.setBytes(0)
        RecorderBus.setConfigLabel(describe(cfg))
        startShakeWatch()
        main.post(ticker)
        updateNotification()

        if (Prefs.floatingEnabled && Perms.overlay(this)) OverlayService.showBubble(this)
        if (Prefs.facecamEnabled && Perms.camera(this)) OverlayService.showFacecam(this)
    }

    /** e.g. "1080p · 30fps · Mic" — shown under the live timer. */
    private fun describe(cfg: RecordConfig): String {
        val shortEdge = minOf(cfg.width, cfg.height)
        val audio = when (cfg.audio) {
            AudioSource.MUTE -> "No audio"
            AudioSource.MIC -> "Mic"
            AudioSource.INTERNAL -> "Device audio"
            AudioSource.INTERNAL_MIC -> "Device + mic"
        }
        return "${shortEdge}p · ${cfg.fps}fps · $audio"
    }

    private fun fail(message: String) {
        RecorderBus.say(message)
        releaseProjection()
        RecorderBus.setState(RecState.IDLE)
        RecorderBus.setElapsed(0)
        stopForegroundCompat()
        stopSelfIfIdle()
    }

    // ---------------- pause / resume / stop ----------------

    private fun pauseRecording() {
        if (RecorderBus.state.value != RecState.RECORDING) return
        engine?.pause()
        RecorderBus.setState(RecState.PAUSED)
        updateNotification()
    }

    private fun resumeRecording() {
        if (RecorderBus.state.value != RecState.PAUSED) return
        engine?.resume()
        RecorderBus.setState(RecState.RECORDING)
        updateNotification()
    }

    private fun finishRecording() {
        // Stop can arrive from the bar, the notification, the bubble, shake, the auto-stop
        // timer and the projection callback at once. Finalising is already under way, so
        // ignore the extras rather than tearing the service down mid-save.
        if (RecorderBus.state.value == RecState.SAVING) return

        main.removeCallbacks(countdownStep)
        main.removeCallbacks(ticker)

        if (RecorderBus.state.value == RecState.COUNTDOWN) {
            OverlayService.hideCountdown()
            RecorderBus.setCountdown(0)
            pendingData = null
            releaseProjection()
            RecorderBus.setState(RecState.IDLE)
            stopForegroundCompat()
            stopSelfIfIdle()
            return
        }

        val e = engine ?: run {
            releaseProjection()
            RecorderBus.setState(RecState.IDLE)
            stopForegroundCompat()
            stopSelfIfIdle()
            return
        }

        RecorderBus.setState(RecState.SAVING)
        updateNotification()
        engine = null

        val recordedMs = e.recordedMs()

        // Finalising blocks: MediaRecorder.stop() flushes the muxer and CodecEngine joins its
        // encoder threads. Doing that on the main thread would ANR, so it runs on a worker
        // and the teardown resumes back here.
        Thread({
            e.stop()
            main.post { completeSave(recordedMs) }
        }, "imran-finalise").start()
    }

    private fun completeSave(recordedMs: Long) {
        stopShakeWatch()
        val tooShort = recordedMs < 700
        closeOutput(discard = tooShort)

        releaseProjection()
        OverlayService.hideBrush()
        OverlayService.hideFacecam()
        // Two independent choices: whether the button shows during a capture, and whether
        // it stays afterwards. This handles the "keep it" case even when it was off during.
        if (Prefs.floatingPersists && Perms.overlay(this)) {
            OverlayService.showBubble(this)
        } else {
            OverlayService.hideBubble()
        }

        RecorderBus.setElapsed(0)
        RecorderBus.setBytes(0)
        RecorderBus.setConfigLabel("")
        RecorderBus.setState(RecState.IDLE)
        RecorderBus.notifyMediaChanged()
        if (tooShort) RecorderBus.say("Recording was too short to save")

        stopForegroundCompat()
        stopSelfIfIdle()
    }

    /** Closes the descriptor and either publishes the row or removes it. */
    private fun closeOutput(discard: Boolean) {
        val descriptor = pfd
        val uri = outputUri
        pfd = null
        outputUri = null

        val bytes = runCatching { descriptor?.statSize ?: 0L }.getOrDefault(0L)
        runCatching { descriptor?.close() }

        if (uri == null) return
        if (discard || bytes < 4_096) {
            MediaStoreRepo.discard(this, uri)
        } else {
            MediaStoreRepo.publish(this, uri)
            RecorderBus.notifySaved(uri)
        }
    }

    private fun releaseProjection() {
        val mp = projection
        projection = null
        if (mp != null) {
            runCatching { mp.unregisterCallback(projectionCallback) }
            runCatching { mp.stop() }
        }
    }

    // ---------------- screenshots ----------------

    private fun handleShoot() {
        val mp = projection
        if (mp != null) {
            takeShot(mp, keepProjection = true)
        } else {
            // Nothing to capture from and no foreground obligation to satisfy here:
            // requestScreenshot() sends the idle case straight to the consent activity.
            stopSelfIfIdle()
        }
    }

    private fun handleShootWithConsent(intent: Intent) {
        val code = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
        val data = extractData(intent)
        if (code != Activity.RESULT_OK || data == null) {
            stopSelfIfIdle()
            return
        }
        goForeground()
        val mpm = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val mp = runCatching { mpm.getMediaProjection(code, data) }.getOrNull()
        if (mp == null) {
            RecorderBus.say("Could not capture the screen")
            stopForegroundCompat()
            stopSelfIfIdle()
            return
        }
        mp.registerCallback(object : MediaProjection.Callback() {}, main)
        takeShot(mp, keepProjection = false)
    }

    private fun takeShot(mp: MediaProjection, keepProjection: Boolean) {
        if (shooting) return
        shooting = true

        // Overlays mirror into the capture, so hide them for the frame we grab.
        OverlayService.setOverlaysVisible(false)
        main.postDelayed({
            ScreenshotCapturer.capture(this, mp) { uri ->
                main.post {
                    OverlayService.setOverlaysVisible(true)
                    shooting = false
                    if (uri != null) {
                        RecorderBus.say("Screenshot saved")
                        RecorderBus.notifyMediaChanged()
                    } else {
                        RecorderBus.say("Screenshot failed")
                    }
                    if (!keepProjection) {
                        runCatching { mp.stop() }
                        if (!RecorderBus.isCapturing) {
                            stopForegroundCompat()
                            stopSelfIfIdle()
                        }
                    }
                }
            }
        }, 140)
    }

    // ---------------- foreground / notification ----------------

    private fun goForeground() {
        val types = foregroundTypes()
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIF_ID, buildNotification(), types)
            } else {
                startForeground(NOTIF_ID, buildNotification())
            }
            startedForeground = true
        }.onFailure {
            Log.e(TAG, "startForeground failed", it)
            // Retry with the minimum type so capture is still possible.
            runCatching {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(
                        NOTIF_ID, buildNotification(),
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
                    )
                } else {
                    startForeground(NOTIF_ID, buildNotification())
                }
                startedForeground = true
            }
        }
    }

    private fun foregroundTypes(): Int {
        var types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
        // The camera and microphone service types only exist from API 30; passing their
        // bits on 29 would be rejected. Only declare a type whose permission is held, too,
        // or startForeground throws.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            if (Prefs.audioSource.needsMic && Perms.mic(this)) {
                types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            }
            if (Prefs.facecamEnabled && Perms.camera(this)) {
                types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
            }
        }
        return types
    }

    private fun stopForegroundCompat() {
        if (!startedForeground) return
        startedForeground = false
        runCatching { stopForeground(STOP_FOREGROUND_REMOVE) }
    }

    private fun stopSelfIfIdle() {
        if (!RecorderBus.isBusy && !shooting) stopSelf()
    }

    private fun createChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.notif_channel_recording),
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = getString(R.string.notif_channel_recording_desc)
            setShowBadge(false)
            enableVibration(false)
        }
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager)
            .createNotificationChannel(channel)
    }

    private fun serviceIntent(action: String, request: Int): PendingIntent =
        PendingIntent.getService(
            this, request,
            Intent(this, RecorderService::class.java).setAction(action),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

    private fun buildNotification(): Notification {
        val state = RecorderBus.state.value
        val content = when (state) {
            RecState.PAUSED -> getString(R.string.notif_paused_text)
            RecState.SAVING -> getString(R.string.state_saving)
            RecState.COUNTDOWN -> getString(R.string.starting)
            else -> getString(R.string.notif_recording_text)
        }

        val open = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.notif_recording_title))
            .setContentText(content)
            .setSmallIcon(R.drawable.ic_record_dot)
            .setColor(ContextCompat.getColor(this, R.color.brand_500))
            .setContentIntent(open)
            .setOngoing(true)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)

        if (state == RecState.RECORDING) {
            // A chronometer ticks on its own, so the notification needs no per-second rebuild.
            builder.setUsesChronometer(true)
                .setWhen(System.currentTimeMillis() - (engine?.recordedMs() ?: 0L))
        }

        if (RecorderBus.isCapturing) {
            val paused = state == RecState.PAUSED
            builder.addAction(
                if (paused) R.drawable.ic_play else R.drawable.ic_pause,
                if (paused) getString(R.string.resume) else getString(R.string.pause),
                serviceIntent(ACTION_TOGGLE_PAUSE, 11)
            )
            builder.addAction(
                R.drawable.ic_screenshot, getString(R.string.tool_screenshot),
                serviceIntent(ACTION_SHOOT, 12)
            )
            builder.addAction(
                R.drawable.ic_stop_square, getString(R.string.stop),
                serviceIntent(ACTION_STOP, 13)
            )
        }
        return builder.build()
    }

    private fun updateNotification() {
        if (!startedForeground) return
        runCatching {
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager)
                .notify(NOTIF_ID, buildNotification())
        }
    }

    private fun extractData(intent: Intent): Intent? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(EXTRA_RESULT_DATA)
        }

    override fun onDestroy() {
        main.removeCallbacks(ticker)
        main.removeCallbacks(countdownStep)
        stopShakeWatch()

        // The process is going away, so finalise inline rather than handing off to a worker
        // that would never get to post its result back.
        val e = engine
        engine = null
        if (e != null) {
            val recordedMs = e.recordedMs()
            e.stop()
            closeOutput(discard = recordedMs < 700)
        }
        releaseProjection()
        RecorderBus.setElapsed(0)
        RecorderBus.setState(RecState.IDLE)
        RecorderBus.notifyMediaChanged()
        super.onDestroy()
    }

    companion object {
        private const val TAG = "RecorderService"
        private const val CHANNEL_ID = "imran_recording"
        private const val NOTIF_ID = 4711
        private const val SHAKE_G = 2.7f

        const val ACTION_START = "com.imran.recorder.START"
        const val ACTION_STOP = "com.imran.recorder.STOP"
        const val ACTION_PAUSE = "com.imran.recorder.PAUSE"
        const val ACTION_RESUME = "com.imran.recorder.RESUME"
        const val ACTION_TOGGLE_PAUSE = "com.imran.recorder.TOGGLE_PAUSE"
        const val ACTION_SHOOT = "com.imran.recorder.SHOOT"
        const val ACTION_SHOOT_WITH = "com.imran.recorder.SHOOT_WITH"

        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_RESULT_DATA = "result_data"

        fun send(context: Context, action: String) {
            val intent = Intent(context, RecorderService::class.java).setAction(action)
            ContextCompat.startForegroundService(context, intent)
        }

        /** Entry point used by every Record affordance in the app. */
        fun requestStart(context: Context) {
            if (RecorderBus.isCapturing) {
                RecorderBus.say("A recording is already running")
                return
            }
            context.startActivity(
                ProjectionRequestActivity.intent(context, ProjectionRequestActivity.PURPOSE_RECORD)
            )
        }

        /**
         * With a recording live the service already holds a projection and is foreground, so
         * it can shoot directly. Idle, it must not be started as a foreground service before
         * consent exists — that would leave startForeground() unsatisfied — so the consent
         * activity is launched first and forwards the result as ACTION_SHOOT_WITH.
         */
        fun requestScreenshot(context: Context) {
            if (RecorderBus.isCapturing) {
                send(context, ACTION_SHOOT)
            } else {
                context.startActivity(
                    ProjectionRequestActivity.intent(context, ProjectionRequestActivity.PURPOSE_SHOT)
                )
            }
        }
    }
}
