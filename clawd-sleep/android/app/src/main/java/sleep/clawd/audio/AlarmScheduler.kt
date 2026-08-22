package sleep.clawd.audio

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import java.util.Calendar

object AlarmScheduler {

    private fun intent(context: Context) = PendingIntent.getBroadcast(
        context, 7, Intent(context, AlarmReceiver::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    /** @return the epoch millis the alarm will fire at, or 0 if it could not be set. */
    fun schedule(context: Context, hour: Int, minute: Int): Long {
        val am = context.getSystemService(AlarmManager::class.java) ?: return 0
        val cal = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, hour)
            set(Calendar.MINUTE, minute)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
            if (timeInMillis <= System.currentTimeMillis()) add(Calendar.DAY_OF_YEAR, 1)
        }
        val show = PendingIntent.getActivity(
            context, 8, Intent(context, sleep.clawd.MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return try {
            // setAlarmClock, not setExactAndAllowWhileIdle: it is the only variant
            // the system treats as a user-visible alarm, so it is never deferred.
            am.setAlarmClock(AlarmManager.AlarmClockInfo(cal.timeInMillis, show), intent(context))
            cal.timeInMillis
        } catch (_: SecurityException) {
            0
        }
    }

    fun cancel(context: Context) {
        context.getSystemService(AlarmManager::class.java)?.cancel(intent(context))
    }
}
