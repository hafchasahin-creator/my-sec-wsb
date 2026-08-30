package com.trainjourney.live.engine;

import com.trainjourney.live.data.Station;
import com.trainjourney.live.util.Geo;

/**
 * Decides when the train is approaching, has arrived at, and has left a station.
 *
 * Distance to the station is measured along the rails rather than as the crow
 * flies, because a line curving into a valley can be four kilometres of track
 * away while looking like one on a straight-line measure. Arrival itself is a
 * geofence on the real distance, widened when the GPS fix is poor so a 40-metre
 * fix cannot sit just outside a 30-metre fence and never trigger.
 */
public final class ArrivalDetector {

    /** Inside this, the card switches to the arriving treatment. */
    public static final double ARRIVING_M = 1500;
    /** Outside this, the station is merely upcoming. */
    public static final double APPROACHING_M = 12000;
    /** How long the "departed" banner stays before the next station takes over. */
    public static final long DEPARTED_HOLD_MS = 18000;
    /** Departure needs this much clearance beyond the fence, to avoid flapping. */
    private static final double DEPART_HYSTERESIS = 1.45;

    /** Told about every transition so it can buzz, notify and log. */
    public interface Callback {
        void onApproaching(Station s, double metres);
        void onArrived(Station s);
        void onDeparted(Station s);
    }

    private final Callback callback;

    private long currentStationId;
    private int phase = JourneyState.Phase.IDLE;
    private long phaseSince;
    private boolean announcedApproach;

    public ArrivalDetector(Callback callback) {
        this.callback = callback;
    }

    public int phase() { return phase; }
    public long phaseSince() { return phaseSince; }

    /**
     * Id of the station the machine is currently tracking, or 0.
     * The route view uses this to keep a station selected while the train is
     * standing at it, even once the distance measure has gone negative.
     */
    public long currentStationId() { return currentStationId; }

    /**
     * Feeds one fix through the state machine.
     *
     * @param target    the station currently being approached, or null
     * @param alongM    distance to it along the route, metres
     * @param directM   straight-line distance to it, metres
     * @param accuracy  fix accuracy, metres
     * @return the phase after this update
     */
    public int update(Station target, double alongM, double directM, float accuracy) {
        long now = System.currentTimeMillis();

        if (target == null) {
            if (phase != JourneyState.Phase.IDLE) setPhase(JourneyState.Phase.IDLE, now);
            currentStationId = 0;
            announcedApproach = false;
            return phase;
        }

        if (target.id != currentStationId) {
            // A different station is now the one ahead.
            currentStationId = target.id;
            announcedApproach = false;
            setPhase(JourneyState.Phase.APPROACHING, now);
        }

        double fence = geofence(target, accuracy);

        switch (phase) {
            case JourneyState.Phase.ARRIVED: {
                if (directM > fence * DEPART_HYSTERESIS) {
                    setPhase(JourneyState.Phase.DEPARTED, now);
                    callback.onDeparted(target);
                }
                break;
            }
            case JourneyState.Phase.DEPARTED: {
                // Held briefly, then the caller moves us on to the next station.
                break;
            }
            default: {
                if (directM <= fence) {
                    setPhase(JourneyState.Phase.ARRIVED, now);
                    callback.onArrived(target);
                } else if (usable(alongM) && alongM <= ARRIVING_M) {
                    if (phase != JourneyState.Phase.ARRIVING) {
                        setPhase(JourneyState.Phase.ARRIVING, now);
                    }
                    if (!announcedApproach) {
                        announcedApproach = true;
                        callback.onApproaching(target, alongM);
                    }
                } else if (usable(alongM) && alongM <= APPROACHING_M) {
                    if (phase != JourneyState.Phase.APPROACHING) {
                        setPhase(JourneyState.Phase.APPROACHING, now);
                    }
                } else if (phase != JourneyState.Phase.APPROACHING) {
                    setPhase(JourneyState.Phase.APPROACHING, now);
                }
                break;
            }
        }
        return phase;
    }

    /** True once the departed banner has been shown long enough to move on. */
    public boolean departedHoldElapsed() {
        return phase == JourneyState.Phase.DEPARTED
                && System.currentTimeMillis() - phaseSince > DEPARTED_HOLD_MS;
    }

    /** Clears the station being tracked so the next one can take over. */
    public void advance() {
        currentStationId = 0;
        announcedApproach = false;
        setPhase(JourneyState.Phase.IDLE, System.currentTimeMillis());
    }

    public void reset() {
        currentStationId = 0;
        announcedApproach = false;
        phase = JourneyState.Phase.IDLE;
        phaseSince = 0;
    }

    private void setPhase(int p, long now) {
        if (phase == p) return;
        phase = p;
        phaseSince = now;
    }

    private static boolean usable(double v) {
        return !Double.isNaN(v) && v >= 0;
    }

    /**
     * Geofence radius: the station's own size, never smaller than the GPS can
     * actually resolve, and capped so a very poor fix cannot swallow a whole town.
     */
    static double geofence(Station s, float accuracy) {
        double base = s.geofenceRadius();
        double byAccuracy = Float.isNaN(accuracy) ? base : 2.2 * accuracy + 60;
        return Geo.clamp(Math.max(base, byAccuracy), 120, 650);
    }
}
