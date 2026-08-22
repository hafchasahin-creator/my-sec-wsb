package sleep.clawd.audio

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import sleep.clawd.MainActivity
import sleep.clawd.R

/**
 * The alarm.
 *
 * Scheduled with AlarmManager.setAlarmClock, which is the one API that is exact,
 * survives Doze, and is visible to the system as a real alarm. A countdown inside
 * a coroutine would be silently dropped after a few hours of idle.
 */
class AlarmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val open = PendingIntent.getActivity(
            context, 1,
            Intent(context, MainActivity::class.java).apply {
                putExtra(EXTRA_ALARM, true)
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_IMMUTABLE
        )

        val nm = context.getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL, "Alarm", NotificationManager.IMPORTANCE_HIGH)
            )
        }
        val n = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("good morning")
            .setContentIntent(open)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setAutoCancel(true)
            .setFullScreenIntent(open, true)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(42, n)
        } catch (_: SecurityException) {
            // POST_NOTIFICATIONS not granted; the activity still handles the intent.
        }
        context.startActivity(
            Intent(context, MainActivity::class.java).apply {
                putExtra(EXTRA_ALARM, true)
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
        )
    }

    companion object {
        const val CHANNEL = "clawd_alarm"
        const val EXTRA_ALARM = "clawd.alarm"
    }
}
