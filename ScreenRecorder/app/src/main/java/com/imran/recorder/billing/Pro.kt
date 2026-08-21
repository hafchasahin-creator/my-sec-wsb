package com.imran.recorder.billing

import com.imran.recorder.BuildConfig
import com.imran.recorder.data.Prefs
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Everything the paid tier unlocks. Edit this list to change the free/Pro split. */
enum class ProFeature(val label: String) {
    HIGH_FPS("60 FPS recording"),
    NATIVE_RESOLUTION("Native resolution capture"),
    HIGH_QUALITY("High-bitrate quality"),
    FACECAM("Facecam overlay"),
    GIF_EXPORT("Video to GIF"),
    COMPRESS("Video compression"),
    AUTO_STOP("Auto-stop timer")
}

/**
 * Entitlement state for the app.
 *
 * The source of truth is the Play purchase that [BillingManager] reports; [Prefs.proEntitled]
 * only caches it so the UI is correct before billing connects. Debug builds are entitled
 * unconditionally, because Play Billing cannot complete a purchase for a sideloaded APK —
 * release builds get the real gate.
 */
object Pro {

    private val _entitled = MutableStateFlow(BuildConfig.DEBUG || Prefs.proEntitled)
    val entitled = _entitled.asStateFlow()

    val isPro: Boolean get() = _entitled.value

    /** True in a build where the gate cannot be exercised, so the UI can say so plainly. */
    val unlockedForDebug: Boolean get() = BuildConfig.DEBUG

    fun setEntitled(value: Boolean) {
        Prefs.proEntitled = value
        _entitled.value = BuildConfig.DEBUG || value
    }

    fun refreshFromCache() {
        _entitled.value = BuildConfig.DEBUG || Prefs.proEntitled
    }

    fun isLocked(feature: ProFeature): Boolean = !isPro

    /** Options a free user may pick; anything else routes to the paywall. */
    fun allowsFps(fps: Int) = fps <= 30 || isPro
    fun allowsResolution(shortEdge: Int) = shortEdge in 1..1080 || isPro
    fun allowsQuality(bucket: Int) = bucket < 2 || isPro
}
