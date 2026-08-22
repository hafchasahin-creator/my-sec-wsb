package sleep.clawd.ui

/** Everything the composables read. One flat, immutable snapshot per frame. */
data class UiModel(
    val clockText: String = "",
    val clockVisible: Boolean = true,
    val nowLine: String = "choose a sound",
    val hasSource: Boolean = false,
    val playing: Boolean = false,
    val trackName: String? = null,
    val ambienceId: String? = null,
    val musicVolume: Float = 0.7f,
    val ambienceVolume: Float = 0.5f,
    val loop: Boolean = true,
    val timerMinutes: Int = 0,
    val durationMs: Long = 0,
    val positionMs: Long = 0,
    val sleepMode: Boolean = false,
    val amoled: Boolean = false,
    val keepScreenOn: Boolean = true,
    val sleepBrightness: Float = 0.04f,
    val warned: Boolean = false,
    val alarmEnabled: Boolean = false,
    val alarmHour: Int = 7,
    val alarmMinute: Int = 0,
    val lastSessionText: String? = null,
    val error: String? = null,
) {
    /** How much extra black the scrim should add — an inverse of chosen brightness. */
    val brightness01Inverse: Float get() = (1f - sleepBrightness).coerceIn(0f, 1f)
}
