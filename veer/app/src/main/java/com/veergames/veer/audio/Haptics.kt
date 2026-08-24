package com.veergames.veer.audio

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import com.veergames.veer.data.Settings

/** Small, tasteful vibration cues; every call is a guarded no-op if off/unsupported. */
class Haptics(context: Context, private val settings: Settings) {

    private val vibrator: Vibrator? = try {
        if (Build.VERSION.SDK_INT >= 31) {
            val vm = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
            vm?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }
    } catch (_: Throwable) { null }

    private fun oneShot(ms: Long, amplitude: Int) {
        if (!settings.haptics) return
        val v = vibrator ?: return
        try {
            if (!v.hasVibrator()) return
            v.vibrate(VibrationEffect.createOneShot(ms, amplitude.coerceIn(1, 255)))
        } catch (_: Throwable) {}
    }

    private fun waveform(times: LongArray, amps: IntArray) {
        if (!settings.haptics) return
        val v = vibrator ?: return
        try {
            if (!v.hasVibrator()) return
            v.vibrate(VibrationEffect.createWaveform(times, amps, -1))
        } catch (_: Throwable) {}
    }

    // 12 ms is roughly the floor at which an LRA reaches steady state, so
    // nothing shorter than that is worth sending
    fun buttonTick() = oneShot(12, 90)
    fun launch() = oneShot(16, 130)

    /** Reward ramps with the combo, matching the pitch ladder. */
    fun escapeDone(combo: Int = 0) =
        oneShot(14, (90 + 14 * combo.coerceIn(0, 8)))

    /** One waveform for the whole lunge-impact-settle beat: a second call
     *  would cancel this one, since the vibrator only runs one effect. */
    fun blocked() = waveform(
        longArrayOf(0, 34, 8, 26, 70, 14), intArrayOf(0, 80, 0, 255, 0, 70))
    fun win() = waveform(longArrayOf(0, 16, 70, 16, 70, 30), intArrayOf(0, 120, 0, 150, 0, 220))
    fun heartLost() = oneShot(24, 200)
}
