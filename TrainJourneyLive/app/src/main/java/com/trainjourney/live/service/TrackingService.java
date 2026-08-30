package com.trainjourney.live.service;

import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import com.trainjourney.live.TrainJourneyApp;
import com.trainjourney.live.data.Station;
import com.trainjourney.live.engine.JourneyState;
import com.trainjourney.live.engine.RouteEngine;
import com.trainjourney.live.ui.MainActivity;
import com.trainjourney.live.util.Fmt;

/**
 * Keeps the journey tracking while the app is not on screen.
 *
 * A train ride is hours long and the phone spends most of it locked in a
 * pocket, so location updates run under a foreground service. The notification
 * doubles as a glanceable readout: the next station and how far it is, without
 * unlocking anything.
 */
public final class TrackingService extends Service implements RouteEngine.Listener {

    private static final int NOTIF_ID = 4200;
    /** Rewriting the notification on every fix would be wasteful and flickery. */
    private static final long MIN_NOTIF_INTERVAL_MS = 4000;

    public static final String ACTION_START = "com.trainjourney.live.START";
    public static final String ACTION_STOP  = "com.trainjourney.live.STOP";

    private RouteEngine engine;
    private long lastNotified;
    private String lastText = "";

    public static void start(Context ctx) {
        Intent i = new Intent(ctx, TrackingService.class).setAction(ACTION_START);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(i);
        } else {
            ctx.startService(i);
        }
    }

    public static void stop(Context ctx) {
        ctx.startService(new Intent(ctx, TrackingService.class).setAction(ACTION_STOP));
    }

    @Override public IBinder onBind(Intent intent) {
        return null;
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_START : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            detach();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        engine = TrainJourneyApp.engine();
        engine.setNotificationTarget(MainActivity.class);
        engine.addListener(this);
        goForeground(buildNotification("Tracking your journey", "Waiting for a GPS fix"));
        engine.resumeTracking();
        return START_STICKY;
    }

    private void goForeground(Notification n) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            } else {
                startForeground(NOTIF_ID, n);
            }
        } catch (Throwable e) {
            // Some OEM builds refuse the location type; a plain foreground
            // notification still keeps the process alive.
            try { startForeground(NOTIF_ID, n); } catch (Throwable ignored) { }
        }
    }

    private Notification buildNotification(String title, String body) {
        return TrainJourneyApp.engine().alerts()
                .buildTrackingNotification(title, body, MainActivity.class);
    }

    @Override public void onJourneyUpdated(JourneyState state) {
        long now = System.currentTimeMillis();
        if (now - lastNotified < MIN_NOTIF_INTERVAL_MS) return;

        String title;
        String body;
        if (state.next != null) {
            title = "Next: " + state.next.station.name;
            String eta = Fmt.eta(state.etaSeconds());
            body = Fmt.distance(Math.max(0, state.next.distance))
                    + ("--".equals(eta) ? "" : "  -  about " + eta)
                    + "  -  " + Fmt.speed(state.speed) + " km/h";
        } else if (!state.hasFix) {
            title = "Tracking your journey";
            body = "Waiting for a GPS fix";
        } else {
            title = "Tracking your journey";
            body = state.hasRailData ? "Looking for the line you are on"
                                     : "Loading railway data";
        }

        String combined = title + "|" + body;
        if (combined.equals(lastText)) return;
        lastText = combined;
        lastNotified = now;

        try {
            android.app.NotificationManager nm = (android.app.NotificationManager)
                    getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTIF_ID, buildNotification(title, body));
        } catch (Throwable ignored) { }
    }

    @Override public void onStationPhase(int phase, Station station) {
        lastNotified = 0;      // a transition is worth showing straight away
    }

    private void detach() {
        if (engine != null) {
            engine.removeListener(this);
            engine = null;
        }
    }

    @Override public void onDestroy() {
        detach();
        super.onDestroy();
    }
}
