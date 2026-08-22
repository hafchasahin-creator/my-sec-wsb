package sleep.clawd.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.floatPreferencesKey
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore("clawd_sleep")

/** Everything the app remembers between nights. Small enough to read whole. */
data class Settings(
    val musicVolume: Float = 0.7f,
    val ambienceVolume: Float = 0.5f,
    val ambienceId: String? = "rain",
    val trackUri: String? = null,
    val trackName: String? = null,
    val loop: Boolean = true,
    val timerMinutes: Int = 0,
    val clockVisible: Boolean = true,
    val amoled: Boolean = false,
    val keepScreenOn: Boolean = true,
    val sleepBrightness: Float = 0.04f,   // 0..1, or -1 for the system default
    val warnedAboutBattery: Boolean = false,
    val alarmEnabled: Boolean = false,
    val alarmHour: Int = 7,
    val alarmMinute: Int = 0,
    val lastSessionStart: Long = 0L,
    val lastSessionEnd: Long = 0L,
    val favourites: String = "",          // "name|ambience|mv|av" per line
)

class Prefs(private val context: Context) {

    private object K {
        val musicVolume = floatPreferencesKey("musicVolume")
        val ambienceVolume = floatPreferencesKey("ambienceVolume")
        val ambienceId = stringPreferencesKey("ambienceId")
        val trackUri = stringPreferencesKey("trackUri")
        val trackName = stringPreferencesKey("trackName")
        val loop = booleanPreferencesKey("loop")
        val timerMinutes = intPreferencesKey("timerMinutes")
        val clockVisible = booleanPreferencesKey("clockVisible")
        val amoled = booleanPreferencesKey("amoled")
        val keepScreenOn = booleanPreferencesKey("keepScreenOn")
        val sleepBrightness = floatPreferencesKey("sleepBrightness")
        val warned = booleanPreferencesKey("warnedAboutBattery")
        val alarmEnabled = booleanPreferencesKey("alarmEnabled")
        val alarmHour = intPreferencesKey("alarmHour")
        val alarmMinute = intPreferencesKey("alarmMinute")
        val sessionStart = longPreferencesKey("lastSessionStart")
        val sessionEnd = longPreferencesKey("lastSessionEnd")
        val favourites = stringPreferencesKey("favourites")
    }

    val flow: Flow<Settings> = context.dataStore.data.map { p ->
        Settings(
            musicVolume = p[K.musicVolume] ?: 0.7f,
            ambienceVolume = p[K.ambienceVolume] ?: 0.5f,
            ambienceId = p[K.ambienceId]?.ifEmpty { null } ?: "rain",
            trackUri = p[K.trackUri]?.ifEmpty { null },
            trackName = p[K.trackName]?.ifEmpty { null },
            loop = p[K.loop] ?: true,
            timerMinutes = p[K.timerMinutes] ?: 0,
            clockVisible = p[K.clockVisible] ?: true,
            amoled = p[K.amoled] ?: false,
            keepScreenOn = p[K.keepScreenOn] ?: true,
            sleepBrightness = p[K.sleepBrightness] ?: 0.04f,
            warnedAboutBattery = p[K.warned] ?: false,
            alarmEnabled = p[K.alarmEnabled] ?: false,
            alarmHour = p[K.alarmHour] ?: 7,
            alarmMinute = p[K.alarmMinute] ?: 0,
            lastSessionStart = p[K.sessionStart] ?: 0L,
            lastSessionEnd = p[K.sessionEnd] ?: 0L,
            favourites = p[K.favourites] ?: "",
        )
    }

    suspend fun update(block: (MutableMap<Preferences.Key<*>, Any>) -> Unit) {
        context.dataStore.edit { prefs ->
            val staging = mutableMapOf<Preferences.Key<*>, Any>()
            block(staging)
            @Suppress("UNCHECKED_CAST")
            staging.forEach { (k, v) -> prefs[k as Preferences.Key<Any>] = v }
        }
    }

    suspend fun setMusicVolume(v: Float) = update { it[K.musicVolume] = v }
    suspend fun setAmbienceVolume(v: Float) = update { it[K.ambienceVolume] = v }
    suspend fun setAmbience(id: String?) = update { it[K.ambienceId] = id ?: "" }
    suspend fun setTrack(uri: String?, name: String?) = update {
        it[K.trackUri] = uri ?: ""; it[K.trackName] = name ?: ""
    }
    suspend fun setLoop(v: Boolean) = update { it[K.loop] = v }
    suspend fun setTimer(m: Int) = update { it[K.timerMinutes] = m }
    suspend fun setClockVisible(v: Boolean) = update { it[K.clockVisible] = v }
    suspend fun setAmoled(v: Boolean) = update { it[K.amoled] = v }
    suspend fun setKeepScreenOn(v: Boolean) = update { it[K.keepScreenOn] = v }
    suspend fun setSleepBrightness(v: Float) = update { it[K.sleepBrightness] = v }
    suspend fun setWarned(v: Boolean) = update { it[K.warned] = v }
    suspend fun setAlarm(on: Boolean, h: Int, m: Int) = update {
        it[K.alarmEnabled] = on; it[K.alarmHour] = h; it[K.alarmMinute] = m
    }
    suspend fun setSession(start: Long, end: Long) = update {
        it[K.sessionStart] = start; it[K.sessionEnd] = end
    }
    suspend fun setFavourites(v: String) = update { it[K.favourites] = v }
}
