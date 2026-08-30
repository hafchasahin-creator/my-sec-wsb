package com.trainjourney.live.engine;

import com.trainjourney.live.data.Station;
import com.trainjourney.live.util.Geo;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Everything the screens draw, in one place.
 *
 * One instance lives for the whole app; the engine writes it on the main thread
 * after each fix and the views read it in onDraw. Keeping it a plain mutable
 * object - rather than a stream of immutable snapshots - is deliberate: at one
 * fix per second with several views redrawing at 60fps, the allocation churn of
 * snapshots would be the single biggest source of jank.
 */
public final class JourneyState {

    // -------------------------------------------------------------- lifecycle

    public boolean tracking;
    public boolean paused;
    /** When the journey began, epoch millis. */
    public long startedAt;
    /** Milliseconds actually travelling, excluding paused stretches. */
    public long elapsedMillis;
    private long lastElapsedTick;
    private long pausedAt;

    // ------------------------------------------------------------------- fix

    public boolean hasFix;
    /** Raw satellite position. */
    public double rawLat, rawLon;
    /** Position after map matching, or the raw one when no confident match. */
    public double lat, lon;
    /** Direction the train icon points, degrees. */
    public double bearing = Double.NaN;
    /** Course reported by GPS, degrees. */
    public double gpsBearing = Double.NaN;
    public float accuracy = Float.NaN;
    /** Metres per second. */
    public double speed;
    public long fixTime;
    /** True when the drawn position was snapped to a railway line. */
    public boolean snapped;
    public double snapConfidence;
    /** Name of the line the train was matched to, when OSM knows one. */
    public String lineName;

    // ----------------------------------------------------------- accumulators

    public double distanceTravelled;
    public double maxSpeed;
    /** Rolling mean over the last few minutes, used for a stable ETA. */
    public double avgSpeed;
    private double speedSum;
    private long speedSamples;

    // ------------------------------------------------------------------ route

    public RoutePlan plan;
    /** Distance along the plan, metres. */
    public double alongNow = Double.NaN;
    /** How far the train is from the planned line, metres. */
    public double offPlan = Double.NaN;
    /** True when the route forks ahead and the app needs the passenger to choose. */
    public boolean needsRouteChoice;
    /** Station the passenger picked as their destination, or null. */
    public Station chosenDestination;

    /** Ordered view of the route for the timeline and the station list. */
    public final List<StopView> stops = new ArrayList<StopView>();
    public StopView next;
    public StopView previous;

    // --------------------------------------------------------------- arrivals

    /** Current relationship to {@link #next}. */
    public int phase = Phase.IDLE;
    /** Station the arrival banner is about, or null. */
    public Station phaseStation;
    public long phaseSince;

    /** Arrival/departure record per station, so a ticked station stays ticked. */
    public final Map<Long, Visit> visits = new HashMap<Long, Visit>();

    // ------------------------------------------------------------------ trail

    /** Travelled route, interleaved lat/lon, downsampled as it grows. */
    public double[] trail = new double[2048];
    public int trailCount;
    private double lastTrailLat, lastTrailLon;

    // ---------------------------------------------------------------- loading

    public boolean loadingRailData;
    public String statusMessage = "";
    /** True once at least one railway line is known near the train. */
    public boolean hasRailData;

    // ------------------------------------------------------------------ types

    /** Phases of the approach/arrival cycle. */
    public static final class Phase {
        public static final int IDLE        = 0;
        /** More than 2 km out. */
        public static final int APPROACHING = 1;
        /** Inside 1.5 km - the card switches to the big countdown. */
        public static final int ARRIVING    = 2;
        /** Inside the station geofence. */
        public static final int ARRIVED     = 3;
        /** Left the geofence; shown briefly before moving to the next station. */
        public static final int DEPARTED    = 4;
        private Phase() { }
    }

    /** Per-station state in the ordered route view. */
    public static final class StopView {
        public static final int PASSED   = 0;
        public static final int ARRIVED  = 1;
        public static final int NEXT     = 2;
        public static final int UPCOMING = 3;

        public Station station;
        /** Distance from the train, metres. Negative when the station is behind. */
        public double distance;
        public int state = UPCOMING;
        public long arrivedAt;
        public long departedAt;

        public boolean isPassed() { return state == PASSED; }
    }

    /** When the train reached and left a station. */
    public static final class Visit {
        public long arrivedAt;
        public long departedAt;
    }

    // ------------------------------------------------------------- mutation

    public void startJourney() {
        tracking = true;
        paused = false;
        startedAt = System.currentTimeMillis();
        lastElapsedTick = startedAt;
        elapsedMillis = 0;
        distanceTravelled = 0;
        maxSpeed = 0;
        avgSpeed = 0;
        speedSum = 0;
        speedSamples = 0;
        trailCount = 0;
        visits.clear();
        stops.clear();
        plan = null;
        next = null;
        previous = null;
        phase = Phase.IDLE;
        phaseStation = null;
        chosenDestination = null;
        needsRouteChoice = false;
        alongNow = Double.NaN;
    }

    public void endJourney() {
        tickElapsed();
        tracking = false;
        paused = false;
    }

    public void setPaused(boolean p) {
        if (p == paused) return;
        if (p) {
            tickElapsed();
            pausedAt = System.currentTimeMillis();
        } else {
            lastElapsedTick = System.currentTimeMillis();
            pausedAt = 0;
        }
        paused = p;
    }

    /** Advances the travelling clock. Safe to call as often as the UI likes. */
    public void tickElapsed() {
        if (!tracking || paused) return;
        long now = System.currentTimeMillis();
        if (lastElapsedTick > 0 && now > lastElapsedTick) {
            elapsedMillis += now - lastElapsedTick;
        }
        lastElapsedTick = now;
    }

    /** Records a speed sample into the rolling average. */
    public void recordSpeed(double metresPerSecond) {
        if (metresPerSecond < 0) return;
        if (metresPerSecond > maxSpeed) maxSpeed = metresPerSecond;
        // Exponential mean: responsive enough for an ETA, steady enough to read.
        if (speedSamples == 0) avgSpeed = metresPerSecond;
        else avgSpeed = avgSpeed * 0.94 + metresPerSecond * 0.06;
        speedSum += metresPerSecond;
        speedSamples++;
    }

    /** Mean speed over the whole journey, metres per second. */
    public double meanSpeed() {
        if (elapsedMillis <= 0) return 0;
        return distanceTravelled / (elapsedMillis / 1000.0);
    }

    /** Appends to the travelled trail, keeping it sparse. */
    public void addTrailPoint(double la, double lo) {
        if (trailCount > 0
                && Geo.distance(lastTrailLat, lastTrailLon, la, lo) < 20) {
            return;
        }
        if (trailCount * 2 + 2 > trail.length) {
            if (trail.length >= 32768) {
                decimateTrail();
            } else {
                double[] bigger = new double[trail.length * 2];
                System.arraycopy(trail, 0, bigger, 0, trailCount * 2);
                trail = bigger;
            }
        }
        trail[trailCount * 2] = la;
        trail[trailCount * 2 + 1] = lo;
        trailCount++;
        lastTrailLat = la;
        lastTrailLon = lo;
    }

    /** Halves the trail's resolution so a very long journey stays bounded. */
    private void decimateTrail() {
        int w = 0;
        for (int i = 0; i < trailCount; i += 2) {
            trail[w * 2] = trail[i * 2];
            trail[w * 2 + 1] = trail[i * 2 + 1];
            w++;
        }
        trailCount = w;
    }

    /** Look-up used by the timeline to keep ticks on stations already visited. */
    public Visit visitFor(Station s) {
        return s == null ? null : visits.get(Long.valueOf(s.id));
    }

    /** ETA to the next station in seconds, or NaN when it cannot be estimated. */
    public double etaSeconds() {
        if (next == null || next.distance <= 0) return Double.NaN;
        double v = Math.max(speed, avgSpeed);
        if (v < 1.5) v = avgSpeed;                 // standing at a signal
        if (v < 1.5) return Double.NaN;
        return next.distance / v;
    }

    /** Distance still to run to the chosen destination, or NaN. */
    public double distanceToDestination() {
        if (chosenDestination == null) return Double.NaN;
        for (int i = 0; i < stops.size(); i++) {
            StopView v = stops.get(i);
            if (v.station.id == chosenDestination.id) return v.distance;
        }
        return Double.NaN;
    }

    /** The final station on the plan, used when no destination was chosen. */
    public StopView lastStop() {
        return stops.isEmpty() ? null : stops.get(stops.size() - 1);
    }
}
