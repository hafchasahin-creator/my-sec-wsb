package com.trainjourney.live;

import android.app.Application;

import com.trainjourney.live.engine.RouteEngine;

/**
 * Holds the one engine the whole app shares.
 *
 * Tracking has to survive the activity being recreated on a rotation or dropped
 * while the phone is in a pocket, so the journey lives at application scope and
 * the screens are only ever views onto it.
 */
public final class TrainJourneyApp extends Application {

    private static TrainJourneyApp instance;
    private RouteEngine engine;

    @Override public void onCreate() {
        super.onCreate();
        instance = this;
    }

    public static synchronized RouteEngine engine() {
        if (instance == null) throw new IllegalStateException("Application not created");
        if (instance.engine == null) {
            instance.engine = new RouteEngine(instance);
        }
        return instance.engine;
    }

    /** True once an engine exists, without creating one. */
    public static boolean hasEngine() {
        return instance != null && instance.engine != null;
    }
}
