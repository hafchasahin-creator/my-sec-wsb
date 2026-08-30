package com.trainjourney.live.engine;

import android.content.Context;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;

/**
 * The phone's own GPS, and nothing else.
 *
 * This app is used inside a moving train, often with no usable data connection,
 * so it talks to {@link LocationManager} directly rather than to a fused
 * provider: satellite fixes keep coming in a valley with no signal, and there is
 * no dependency on Play Services being present or up to date.
 *
 * The network provider is subscribed as well, but only ever used to paint a
 * first rough position before the first satellite fix lands.
 */
public final class LocationEngine {

    private static final String TAG = "LocationEngine";

    /** One fix a second is plenty for a train and kind to the battery. */
    private static final long MIN_TIME_MS = 1000;
    private static final float MIN_DISTANCE_M = 0;
    /** A network fix is ignored once a satellite fix this recent exists. */
    private static final long GPS_PREFERRED_WINDOW_MS = 20000;
    /** Fixes worse than this are dropped: they would drag the train off the line. */
    private static final float MAX_USABLE_ACCURACY_M = 200;

    public interface Listener {
        void onFix(Location location);
        /** Called when the provider is switched off or comes back. */
        void onGpsAvailabilityChanged(boolean enabled);
    }

    private final Context ctx;
    private final LocationManager lm;
    private Listener listener;
    private boolean running;

    private Location lastGps;
    private Location lastAny;

    private final LocationListener gpsListener = new LocationListener() {
        @Override public void onLocationChanged(Location location) {
            handle(location, true);
        }
        @Override public void onProviderEnabled(String provider) {
            if (listener != null) listener.onGpsAvailabilityChanged(true);
        }
        @Override public void onProviderDisabled(String provider) {
            if (listener != null) listener.onGpsAvailabilityChanged(false);
        }
        @Override public void onStatusChanged(String provider, int status, Bundle extras) { }
    };

    private final LocationListener netListener = new LocationListener() {
        @Override public void onLocationChanged(Location location) {
            handle(location, false);
        }
        @Override public void onProviderEnabled(String provider) { }
        @Override public void onProviderDisabled(String provider) { }
        @Override public void onStatusChanged(String provider, int status, Bundle extras) { }
    };

    public LocationEngine(Context context) {
        this.ctx = context.getApplicationContext();
        this.lm = (LocationManager) this.ctx.getSystemService(Context.LOCATION_SERVICE);
    }

    public void setListener(Listener l) {
        this.listener = l;
    }

    public boolean isRunning() {
        return running;
    }

    /** True when the user has GPS switched on at the system level. */
    public boolean isGpsEnabled() {
        try {
            return lm != null && lm.isProviderEnabled(LocationManager.GPS_PROVIDER);
        } catch (Throwable e) {
            return false;
        }
    }

    /**
     * Starts listening. The caller must already hold ACCESS_FINE_LOCATION.
     *
     * @return false when the permission is missing or no provider exists
     */
    public boolean start() {
        if (running) return true;
        if (lm == null) return false;
        try {
            lm.requestLocationUpdates(LocationManager.GPS_PROVIDER,
                    MIN_TIME_MS, MIN_DISTANCE_M, gpsListener);
            try {
                lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER,
                        4000, 0, netListener);
            } catch (Throwable ignored) {
                // Plenty of devices have no network provider. Not a problem.
            }
            running = true;
            seedFromLastKnown();
            return true;
        } catch (SecurityException e) {
            Log.w(TAG, "location permission not granted");
            return false;
        } catch (Throwable e) {
            Log.w(TAG, "could not start location updates: " + e);
            return false;
        }
    }

    public void stop() {
        if (!running) return;
        running = false;
        try { lm.removeUpdates(gpsListener); } catch (Throwable ignored) { }
        try { lm.removeUpdates(netListener); } catch (Throwable ignored) { }
    }

    /** Paints something on screen immediately rather than an empty map. */
    private void seedFromLastKnown() {
        try {
            Location best = null;
            Location gps = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            Location net = lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
            if (gps != null) best = gps;
            if (best == null && net != null) best = net;
            if (best != null && listener != null) {
                lastAny = best;
                listener.onFix(best);
            }
        } catch (Throwable ignored) { }
    }

    private void handle(Location loc, boolean fromGps) {
        if (loc == null || listener == null) return;
        if (!isFinite(loc.getLatitude()) || !isFinite(loc.getLongitude())) return;

        if (fromGps) {
            lastGps = loc;
        } else if (lastGps != null
                && ageMillis(lastGps) < GPS_PREFERRED_WINDOW_MS) {
            return;                      // a good satellite fix already covers us
        }

        if (loc.hasAccuracy() && loc.getAccuracy() > MAX_USABLE_ACCURACY_M
                && lastAny != null && ageMillis(lastAny) < 15000) {
            return;                      // a wild fix; keep the previous one
        }

        lastAny = loc;
        listener.onFix(loc);
    }

    private static long ageMillis(Location l) {
        long t = l.getTime();
        return t <= 0 ? Long.MAX_VALUE : System.currentTimeMillis() - t;
    }

    private static boolean isFinite(double v) {
        return !Double.isNaN(v) && !Double.isInfinite(v);
    }

    /** Best fix seen so far, or null. */
    public Location lastFix() {
        return lastGps != null ? lastGps : lastAny;
    }

    /** True when the device reports raw satellite support at all. */
    public boolean hasGpsHardware() {
        if (lm == null) return false;
        try {
            return lm.getAllProviders().contains(LocationManager.GPS_PROVIDER);
        } catch (Throwable e) {
            return Build.VERSION.SDK_INT > 0;
        }
    }
}
