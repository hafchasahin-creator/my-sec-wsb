package com.imran.runner.tracking

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Looper
import android.os.SystemClock
import androidx.core.content.ContextCompat
import com.imran.runner.data.ProfileStore
import com.imran.runner.data.RunRecord
import com.imran.runner.data.RunRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The live run: owns the [RunEngine], the location subscription and the clock that drives them.
 *
 * A single instance is held by the application, so the run survives the activity being recreated
 * and is the one thing both the UI and the foreground service read from.
 *
 * Location updates are reference counted. The activity holds one while it is on screen — that is
 * what gives you a GPS lock and a live speed reading *before* you press start — and the service
 * holds another for the duration of a run, which is what keeps it going with the screen off.
 */
class RunTracker(
    context: Context,
    private val repository: RunRepository,
    private val profileStore: ProfileStore,
) {

    companion object {
        /** The engine integrates over real time, so this only sets how smooth the UI looks. */
        private const val TICK_MS = 200L

        private const val LOCATION_INTERVAL_MS = 1_000L

        /** A fix older than this is history, not a position; feeding it in would fake distance. */
        private const val MAX_FIX_AGE_MS = 60_000L

        /** Auto-pause: below this speed the runner has stopped. */
        private const val AUTO_PAUSE_SPEED_MPS = 0.5

        /** ...but only after holding still this long, so a red light is not a stutter. */
        private const val AUTO_PAUSE_AFTER_MS = 10_000L

        /** Auto-resume once they are clearly moving again. */
        private const val AUTO_RESUME_SPEED_MPS = 1.3

        private const val UNSET = Long.MIN_VALUE
    }

    private val appContext = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val engine = RunEngine()
    private val locationManager =
        appContext.getSystemService(Context.LOCATION_SERVICE) as LocationManager

    private val _metrics = MutableStateFlow(RunMetrics())
    val metrics: StateFlow<RunMetrics> = _metrics.asStateFlow()

    /** The run that has just been saved, so the UI can show a summary. */
    private val _lastFinished = MutableStateFlow<RunRecord?>(null)
    val lastFinished: StateFlow<RunRecord?> = _lastFinished.asStateFlow()

    private val _locationAvailable = MutableStateFlow(true)
    val locationAvailable: StateFlow<Boolean> = _locationAvailable.asStateFlow()

    private var holders = 0
    private var listening = false
    private var ticker: Job? = null

    private var slowSinceMs = UNSET
    private var pausedAutomatically = false

    init {
        scope.launch {
            profileStore.profile.collect { engine.weightKg = it.weightKg }
        }
    }

    // ---------------------------------------------------------------- subscription

    /**
     * [LocationListener] is implemented in full rather than as a lambda on purpose: the three
     * companion callbacks only gained default implementations in API 30, and on an API 26 phone
     * a SAM-converted listener throws [AbstractMethodError] the moment the provider changes state.
     */
    private val listener = object : LocationListener {
        override fun onLocationChanged(location: Location) = onLocation(location)

        override fun onProviderEnabled(provider: String) {
            _locationAvailable.value = true
        }

        override fun onProviderDisabled(provider: String) {
            _locationAvailable.value = isLocationEnabled()
        }

        @Deprecated("Required on API 26-29, where it is still abstract.")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
    }

    /** Adds a holder; location flows while at least one is held. */
    fun acquire() {
        holders++
        if (holders == 1) {
            startLocation()
            startTicker()
        }
    }

    fun release() {
        if (holders == 0) return
        holders--
        if (holders == 0) {
            stopLocation()
            stopTicker()
        }
    }

    fun hasLocationPermission(): Boolean =
        ContextCompat.checkSelfPermission(appContext, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    fun isLocationEnabled(): Boolean = try {
        locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
            locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
    } catch (e: SecurityException) {
        false
    }

    /**
     * The fused provider blends GNSS with the phone's motion sensors, which is both steadier and
     * kinder to the battery, but it only exists from API 31. Below that, raw GPS it is — and
     * either way the network provider is a last resort so the header can still say something.
     */
    private fun bestProvider(): String? {
        val providers = try {
            locationManager.allProviders
        } catch (e: SecurityException) {
            return null
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            providers.contains(LocationManager.FUSED_PROVIDER)
        ) {
            return LocationManager.FUSED_PROVIDER
        }
        if (providers.contains(LocationManager.GPS_PROVIDER)) return LocationManager.GPS_PROVIDER
        if (providers.contains(LocationManager.NETWORK_PROVIDER)) return LocationManager.NETWORK_PROVIDER
        return null
    }

    // Lint cannot see the permission check through hasLocationPermission(), and the whole body is
    // guarded by it as well as by a SecurityException catch.
    @SuppressLint("MissingPermission")
    private fun startLocation() {
        if (listening || !hasLocationPermission()) return
        val provider = bestProvider() ?: return
        try {
            locationManager.requestLocationUpdates(
                provider,
                LOCATION_INTERVAL_MS,
                0f,
                listener,
                Looper.getMainLooper(),
            )
            listening = true
            _locationAvailable.value = isLocationEnabled()
            locationManager.getLastKnownLocation(provider)?.let(::onLocation)
        } catch (e: SecurityException) {
            listening = false
        } catch (e: IllegalArgumentException) {
            listening = false
        }
    }

    private fun stopLocation() {
        if (!listening) return
        try {
            locationManager.removeUpdates(listener)
        } catch (e: SecurityException) {
            // Nothing to undo.
        }
        listening = false
    }

    /** Re-subscribes once the permission has just been granted. */
    fun onPermissionGranted() {
        if (holders > 0) startLocation()
    }

    private fun onLocation(location: Location) {
        val atMs = location.elapsedRealtimeNanos / 1_000_000L
        // A last-known fix can be hours old. Anchoring on one would invent every metre between
        // there and here the moment the next real fix lands.
        if (SystemClock.elapsedRealtime() - atMs > MAX_FIX_AGE_MS) return

        engine.onFix(
            Fix(
                latitude = location.latitude,
                longitude = location.longitude,
                altitudeMeters = location.altitude,
                hasAltitude = location.hasAltitude(),
                accuracyMeters = if (location.hasAccuracy()) location.accuracy else Float.MAX_VALUE,
                speedMps = if (location.hasSpeed()) location.speed else 0f,
                hasSpeed = location.hasSpeed(),
                atMs = atMs,
            ),
        )
    }

    // ---------------------------------------------------------------- clock

    private fun startTicker() {
        if (ticker?.isActive == true) return
        ticker = scope.launch {
            while (isActive) {
                val now = SystemClock.elapsedRealtime()
                engine.tick(now)
                val snapshot = engine.metrics(now)
                applyAutoPause(snapshot, now)
                _metrics.value = engine.metrics(now)
                delay(TICK_MS)
            }
        }
    }

    private fun stopTicker() {
        ticker?.cancel()
        ticker = null
    }

    private fun applyAutoPause(snapshot: RunMetrics, nowMs: Long) {
        if (!profileStore.profile.value.autoPause) {
            slowSinceMs = UNSET
            return
        }
        when (snapshot.state) {
            RunState.RUNNING -> {
                if (snapshot.sensedSpeedMps < AUTO_PAUSE_SPEED_MPS) {
                    if (slowSinceMs == UNSET) slowSinceMs = nowMs
                    if (nowMs - slowSinceMs >= AUTO_PAUSE_AFTER_MS) {
                        engine.pause(nowMs)
                        pausedAutomatically = true
                        slowSinceMs = UNSET
                    }
                } else {
                    slowSinceMs = UNSET
                }
            }

            RunState.PAUSED -> {
                if (pausedAutomatically && snapshot.sensedSpeedMps > AUTO_RESUME_SPEED_MPS) {
                    engine.resume(nowMs)
                    pausedAutomatically = false
                }
            }

            else -> slowSinceMs = UNSET
        }
    }

    // ---------------------------------------------------------------- commands

    fun start() {
        val now = SystemClock.elapsedRealtime()
        engine.weightKg = profileStore.profile.value.weightKg
        engine.start(now, System.currentTimeMillis())
        pausedAutomatically = false
        slowSinceMs = UNSET
        _lastFinished.value = null
        _metrics.value = engine.metrics(now)
        TrackingService.start(appContext)
    }

    fun pause() {
        engine.pause(SystemClock.elapsedRealtime())
        pausedAutomatically = false
        publish()
    }

    fun resume() {
        engine.resume(SystemClock.elapsedRealtime())
        pausedAutomatically = false
        publish()
    }

    fun toggle() {
        when (metrics.value.state) {
            RunState.IDLE, RunState.FINISHED -> start()
            RunState.RUNNING -> pause()
            RunState.PAUSED -> resume()
        }
    }

    /** Ends the run, saves it, and hands back the stored record. */
    fun finish(): RunRecord? {
        val now = SystemClock.elapsedRealtime()
        engine.finish(now)
        val m = engine.metrics(now)
        TrackingService.stop(appContext)
        publish()

        // Nothing worth keeping: a mis-tap rather than a run.
        if (m.distanceMeters < 10.0 && m.elapsedMs < 10_000L) {
            engine.reset()
            publish()
            return null
        }

        val record = RunRecord(
            id = engine.startedAtEpochMs.takeIf { it > 0L } ?: System.currentTimeMillis(),
            startedAtEpochMs = engine.startedAtEpochMs,
            durationMs = m.elapsedMs,
            distanceMeters = m.distanceMeters,
            calories = m.calories,
            avgSpeedMps = m.avgSpeedMps,
            maxSpeedMps = m.maxSpeedMps,
            avgPaceSecPerKm = m.avgPaceSecPerKm,
            elevationGainMeters = m.elevationGainMeters,
            routePointCount = m.routePointCount,
        )
        val route = engine.routeSnapshot()
        scope.launch {
            withContext(Dispatchers.IO) { repository.save(record, route) }
        }
        _lastFinished.value = record
        return record
    }

    /** Clears a finished run off the screen and goes back to the ready state. */
    fun reset() {
        engine.reset()
        _lastFinished.value = null
        publish()
    }

    private fun publish() {
        _metrics.value = engine.metrics(SystemClock.elapsedRealtime())
    }

    internal fun currentSplits(): List<Double> = engine.splitsSeconds()
}

/** Kept out of [RunTracker] so the service file owns its own intent vocabulary. */
internal fun Context.trackingIntent(action: String): Intent =
    Intent(this, TrackingService::class.java).setAction(action)
