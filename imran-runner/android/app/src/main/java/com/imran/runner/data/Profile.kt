package com.imran.runner.data

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The runner. Weight drives the calorie model, so it is the one setting that changes the
 * numbers rather than just the presentation.
 */
data class Profile(
    val name: String = DEFAULT_NAME,
    val weightKg: Double = DEFAULT_WEIGHT_KG,
    val keepScreenOn: Boolean = true,
    val autoPause: Boolean = true,
) {
    companion object {
        const val DEFAULT_NAME = "Runner"
        const val DEFAULT_WEIGHT_KG = 70.0
        const val MIN_WEIGHT_KG = 30.0
        const val MAX_WEIGHT_KG = 200.0
    }
}

class ProfileStore(context: Context) {

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences("imran_runner_profile", Context.MODE_PRIVATE)

    private val _profile = MutableStateFlow(read())
    val profile: StateFlow<Profile> = _profile.asStateFlow()

    private fun read() = Profile(
        name = prefs.getString(KEY_NAME, Profile.DEFAULT_NAME) ?: Profile.DEFAULT_NAME,
        weightKg = prefs.getFloat(KEY_WEIGHT, Profile.DEFAULT_WEIGHT_KG.toFloat()).toDouble(),
        keepScreenOn = prefs.getBoolean(KEY_KEEP_SCREEN_ON, true),
        autoPause = prefs.getBoolean(KEY_AUTO_PAUSE, true),
    )

    fun update(transform: (Profile) -> Profile) {
        val next = transform(_profile.value).let {
            it.copy(
                name = it.name.trim().ifEmpty { Profile.DEFAULT_NAME }.take(24),
                weightKg = it.weightKg.coerceIn(Profile.MIN_WEIGHT_KG, Profile.MAX_WEIGHT_KG),
            )
        }
        prefs.edit()
            .putString(KEY_NAME, next.name)
            .putFloat(KEY_WEIGHT, next.weightKg.toFloat())
            .putBoolean(KEY_KEEP_SCREEN_ON, next.keepScreenOn)
            .putBoolean(KEY_AUTO_PAUSE, next.autoPause)
            .apply()
        _profile.value = next
    }

    private companion object {
        const val KEY_NAME = "name"
        const val KEY_WEIGHT = "weight_kg"
        const val KEY_KEEP_SCREEN_ON = "keep_screen_on"
        const val KEY_AUTO_PAUSE = "auto_pause"
    }
}
