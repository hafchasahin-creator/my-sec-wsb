package com.trainjourney.live.engine;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;

import com.trainjourney.live.R;

/**
 * The buzz and the banner that tell a passenger something happened.
 *
 * A phone in a pocket on a noisy train is the real use case, so arrival is a
 * distinct double pulse and departure a single short one - distinguishable
 * without looking. Notifications are posted quietly; the app never makes noise
 * on its own.
 */
public final class Alerts {

    public static final String CHANNEL_TRACKING = "tracking";
    public static final String CHANNEL_STATION  = "station";

    private static final int NOTIF_STATION = 4201;

    private final Context ctx;

    public Alerts(Context context) {
        this.ctx = context.getApplicationContext();
        ensureChannels();
    }

    private void ensureChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm =
                (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        NotificationChannel tracking = new NotificationChannel(CHANNEL_TRACKING,
                "Live journey", NotificationManager.IMPORTANCE_LOW);
        tracking.setDescription("Keeps your position updating while the app is in the background.");
        tracking.setShowBadge(false);
        nm.createNotificationChannel(tracking);

        NotificationChannel station = new NotificationChannel(CHANNEL_STATION,
                "Station alerts", NotificationManager.IMPORTANCE_DEFAULT);
        station.setDescription("Approaching, arrived and departed alerts for stations on your route.");
        station.enableVibration(false);      // vibration is driven explicitly below
        nm.createNotificationChannel(station);
    }

    // ------------------------------------------------------------- vibration

    /** Two firm pulses - the train has reached a station. */
    public void vibrateArrived() {
        vibrate(new long[]{0, 180, 110, 260}, -1);
    }

    /** One short pulse - the station is coming up. */
    public void vibrateApproaching() {
        vibrate(new long[]{0, 90}, -1);
    }

    /** A soft tick as the platform slides away. */
    public void vibrateDeparted() {
        vibrate(new long[]{0, 60, 80, 60}, -1);
    }

    private void vibrate(long[] pattern, int repeat) {
        try {
            Vibrator v = vibrator();
            if (v == null || !v.hasVibrator()) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v.vibrate(VibrationEffect.createWaveform(pattern, repeat));
            } else {
                v.vibrate(pattern, repeat);
            }
        } catch (Throwable ignored) {
            // A missing or busy vibrator must never interrupt tracking.
        }
    }

    private Vibrator vibrator() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager vm =
                    (VibratorManager) ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            return vm == null ? null : vm.getDefaultVibrator();
        }
        return (Vibrator) ctx.getSystemService(Context.VIBRATOR_SERVICE);
    }

    // ---------------------------------------------------------- notifications

    /** Posts (or replaces) the station banner. */
    public void notifyStation(String title, String body, Class<?> openActivity) {
        try {
            NotificationManager nm =
                    (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            nm.notify(NOTIF_STATION, build(title, body, CHANNEL_STATION, openActivity, false));
        } catch (Throwable ignored) {
            // Notification permission can be refused; tracking carries on regardless.
        }
    }

    public void clearStationNotification() {
        try {
            NotificationManager nm =
                    (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(NOTIF_STATION);
        } catch (Throwable ignored) { }
    }

    /** The persistent notification the foreground service runs under. */
    public Notification buildTrackingNotification(String title, String body, Class<?> openActivity) {
        return build(title, body, CHANNEL_TRACKING, openActivity, true);
    }

    @SuppressWarnings("deprecation")
    private Notification build(String title, String body, String channel,
                               Class<?> openActivity, boolean ongoing) {
        Intent open = new Intent(ctx, openActivity);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            b = new Notification.Builder(ctx, channel);
        } else {
            b = new Notification.Builder(ctx);
            b.setPriority(ongoing ? Notification.PRIORITY_LOW : Notification.PRIORITY_DEFAULT);
        }
        b.setContentTitle(title)
         .setContentText(body)
         .setSmallIcon(R.mipmap.ic_launcher)
         .setContentIntent(pi)
         .setOnlyAlertOnce(true)
         .setOngoing(ongoing);
        if (!ongoing) b.setAutoCancel(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            b.setVisibility(Notification.VISIBILITY_PUBLIC);
        }
        return b.build();
    }
}
