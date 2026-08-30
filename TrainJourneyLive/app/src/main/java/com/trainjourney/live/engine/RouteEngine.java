package com.trainjourney.live.engine;

import android.content.Context;
import android.location.Location;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;

import com.trainjourney.live.data.RailIndex;
import com.trainjourney.live.data.RailRepository;
import com.trainjourney.live.data.Station;
import com.trainjourney.live.util.Geo;

import java.util.ArrayList;
import java.util.List;

/**
 * Turns a stream of GPS fixes into a live journey.
 *
 * Each fix is map-matched onto the rails, measured against the traced route,
 * and turned into the ordered list of stations behind and ahead. Tracing the
 * route is the expensive part, so it happens on a worker thread and only when
 * the previous trace no longer describes where the train is - typically once
 * every few kilometres rather than once a second.
 */
public final class RouteEngine implements LocationEngine.Listener,
        RailRepository.Listener, ArrivalDetector.Callback {

    /** Rebuild no more often than this, however restless the fixes are. */
    private static final long MIN_PLAN_INTERVAL_MS = 2500;
    /** Further than this off the traced line means the trace is wrong. */
    private static final double OFF_PLAN_LIMIT_M = 350;
    /**
     * A station this far behind is definitely behind us. It has to clear the
     * widest possible departure geofence, or a station would stop being "next"
     * before the detector had a chance to notice the train leaving it.
     */
    private static final double BEHIND_LIMIT_M = 1200;
    /** A fork closer than this needs the passenger to settle it. */
    private static final double FORK_ASK_WINDOW_M = 45000;
    /** Speeds above this are GPS nonsense, not a train. */
    private static final double MAX_PLAUSIBLE_SPEED = 120;      // m/s, 432 km/h

    /** Told after every update, on the main thread. */
    public interface Listener {
        void onJourneyUpdated(JourneyState state);
        /** A station transition worth animating or announcing. */
        void onStationPhase(int phase, Station station);
    }

    private final Context ctx;
    private final JourneyState state = new JourneyState();
    private final RailRepository repo;
    private final LocationEngine location;
    private final MapMatcher matcher = new MapMatcher();
    private final MatchResult match = new MatchResult();
    private final ArrivalDetector arrivals = new ArrivalDetector(this);
    private final Alerts alerts;

    private final Handler worker;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<Listener> listeners = new ArrayList<Listener>();
    private final double[] tmp = new double[2];

    private RailGraph graph;
    private RailIndex graphBuiltFrom;
    private boolean planBuilding;
    private long lastPlanBuildAt;
    private Class<?> notificationTarget;

    public RouteEngine(Context context) {
        this.ctx = context.getApplicationContext();
        this.repo = new RailRepository(this.ctx);
        this.location = new LocationEngine(this.ctx);
        this.alerts = new Alerts(this.ctx);
        HandlerThread t = new HandlerThread("route-planner",
                android.os.Process.THREAD_PRIORITY_BACKGROUND);
        t.start();
        this.worker = new Handler(t.getLooper());

        this.location.setListener(this);
        this.repo.addListener(this);
    }

    public JourneyState state()      { return state; }
    public RailRepository repo()     { return repo; }
    public LocationEngine location() { return location; }
    public Alerts alerts()           { return alerts; }

    /** Activity opened when a station notification is tapped. */
    public void setNotificationTarget(Class<?> activity) {
        this.notificationTarget = activity;
    }

    public void addListener(Listener l) {
        if (!listeners.contains(l)) listeners.add(l);
    }

    public void removeListener(Listener l) {
        listeners.remove(l);
    }

    // ------------------------------------------------------------- lifecycle

    /** Begins a journey. Returns false when location updates could not start. */
    public boolean startJourney() {
        state.startJourney();
        matcher.reset();
        arrivals.reset();
        graph = null;
        graphBuiltFrom = null;
        lastPlanBuildAt = 0;
        alerts.clearStationNotification();
        boolean ok = location.start();
        publish();
        return ok;
    }

    public void endJourney() {
        state.endJourney();
        location.stop();
        alerts.clearStationNotification();
        publish();
    }

    public void setPaused(boolean paused) {
        state.setPaused(paused);
        publish();
    }

    /** Keeps receiving fixes without owning the journey lifecycle. */
    public boolean resumeTracking() {
        return location.start();
    }

    // -------------------------------------------------------------- the fix

    @Override public void onFix(Location loc) {
        long now = System.currentTimeMillis();
        double lat = loc.getLatitude();
        double lon = loc.getLongitude();
        float acc = loc.hasAccuracy() ? loc.getAccuracy() : Float.NaN;

        double speed = derivedSpeed(loc, lat, lon, now);
        double gpsBearing = derivedBearing(loc, lat, lon, speed);

        if (state.hasFix && !state.paused) {
            double moved = Geo.distance(state.rawLat, state.rawLon, lat, lon);
            double gate = Math.max(8, (Float.isNaN(acc) ? 12 : acc) * 0.6);
            if (moved > gate && moved < 3000) state.distanceTravelled += moved;
        }

        repo.ensureCoverage(lat, lon, gpsBearing);
        matcher.match(repo.index(), lat, lon, Float.isNaN(acc) ? 25 : acc,
                gpsBearing, speed, match);

        state.rawLat = lat;
        state.rawLon = lon;
        state.accuracy = acc;
        state.speed = speed;
        state.gpsBearing = gpsBearing;
        state.fixTime = now;
        state.hasFix = true;
        state.hasRailData = !repo.index().ways.isEmpty();

        if (match.matched) {
            state.lat = match.lat;
            state.lon = match.lon;
            state.snapped = true;
            state.snapConfidence = match.confidence;
            state.bearing = match.trackBearing;
            state.lineName = match.way == null ? null : match.way.name;
        } else {
            state.lat = lat;
            state.lon = lon;
            state.snapped = false;
            state.snapConfidence = 0;
            state.lineName = null;
            if (!Double.isNaN(gpsBearing)) state.bearing = gpsBearing;
        }

        if (!state.paused) {
            state.recordSpeed(speed);
            state.addTrailPoint(state.lat, state.lon);
            state.tickElapsed();
        }

        updateRoute(now);
        publish();
    }

    @Override public void onGpsAvailabilityChanged(boolean enabled) {
        state.statusMessage = enabled ? "" : "GPS is switched off";
        publish();
    }

    private double derivedSpeed(Location loc, double lat, double lon, long now) {
        double speed = -1;
        if (loc.hasSpeed()) speed = loc.getSpeed();
        if (speed < 0 && state.hasFix && state.fixTime > 0 && now > state.fixTime) {
            double dt = (now - state.fixTime) / 1000.0;
            if (dt > 0.2 && dt < 30) {
                speed = Geo.distance(state.rawLat, state.rawLon, lat, lon) / dt;
            }
        }
        if (speed < 0 || speed > MAX_PLAUSIBLE_SPEED) speed = 0;
        return speed;
    }

    private double derivedBearing(Location loc, double lat, double lon, double speed) {
        if (speed < 1.5) return Double.NaN;                 // heading is noise at a standstill
        if (loc.hasBearing()) return Geo.norm360(loc.getBearing());
        if (state.hasFix) {
            double moved = Geo.distance(state.rawLat, state.rawLon, lat, lon);
            if (moved > 6) return Geo.bearing(state.rawLat, state.rawLon, lat, lon);
        }
        return Double.NaN;
    }

    // ------------------------------------------------------------ route plan

    private void updateRoute(long now) {
        ensureGraph();

        double along = Double.NaN;
        if (state.plan != null) {
            along = state.plan.alongFor(state.lat, state.lon, tmp);
            state.offPlan = tmp[1];
        } else {
            state.offPlan = Double.NaN;
        }

        boolean stale = state.plan == null
                || state.offPlan > OFF_PLAN_LIMIT_M
                || !state.plan.covers(match, along);
        if (stale && match.matched && graph != null && !planBuilding
                && now - lastPlanBuildAt > MIN_PLAN_INTERVAL_MS) {
            buildPlanAsync();
        }

        state.alongNow = along;
        rebuildStopViews(along);
        runArrivals();

        state.needsRouteChoice = state.chosenDestination == null
                && state.plan != null
                && state.plan.ambiguous
                && !Double.isNaN(along)
                && (state.plan.ambiguityAlong - along) < FORK_ASK_WINDOW_M;
    }

    /** The graph only has to change when the loaded railway world does. */
    private void ensureGraph() {
        RailIndex idx = repo.index();
        if (idx == graphBuiltFrom) return;
        if (idx.ways.isEmpty()) { graph = null; graphBuiltFrom = idx; return; }
        graph = new RailGraph(idx);
        graphBuiltFrom = idx;
        // A new world usually means a better trace is available.
        lastPlanBuildAt = 0;
    }

    private void buildPlanAsync() {
        planBuilding = true;
        lastPlanBuildAt = System.currentTimeMillis();
        final RailGraph g = graph;
        final MatchResult snapshot = new MatchResult();
        snapshot.copyFrom(match);
        final Station dest = state.chosenDestination;
        final double destLat = dest == null ? Double.NaN : dest.lat;
        final double destLon = dest == null ? Double.NaN : dest.lon;

        worker.post(new Runnable() {
            @Override public void run() {
                RoutePlan built = null;
                try {
                    built = RoutePlan.build(g, snapshot, destLat, destLon);
                } catch (Throwable ignored) {
                    // A malformed corner of OSM data must not take the app down.
                }
                final RoutePlan result = built;
                main.post(new Runnable() {
                    @Override public void run() {
                        planBuilding = false;
                        if (result != null && !result.isEmpty()) {
                            state.plan = result;
                            double a = result.alongFor(state.lat, state.lon, tmp);
                            state.alongNow = a;
                            state.offPlan = tmp[1];
                            rebuildStopViews(a);
                            runArrivals();
                            publish();
                        }
                    }
                });
            }
        });
    }

    /** Rewrites the ordered station view from the plan and the current position. */
    private void rebuildStopViews(double along) {
        state.stops.clear();
        state.next = null;
        state.previous = null;
        if (state.plan == null || Double.isNaN(along)) return;

        List<RoutePlan.Stop> src = state.plan.stops;
        for (int i = 0; i < src.size(); i++) {
            RoutePlan.Stop s = src.get(i);
            JourneyState.StopView v = new JourneyState.StopView();
            v.station = s.station;
            v.distance = s.along - along;
            JourneyState.Visit visit = state.visits.get(Long.valueOf(s.station.id));
            if (visit != null) {
                v.arrivedAt = visit.arrivedAt;
                v.departedAt = visit.departedAt;
            }
            state.stops.add(v);
        }

        // The next station is the first one neither departed nor clearly behind.
        int nextIdx = -1;
        for (int i = 0; i < state.stops.size(); i++) {
            JourneyState.StopView v = state.stops.get(i);
            if (v.departedAt > 0) continue;
            if (v.distance < -BEHIND_LIMIT_M) continue;
            nextIdx = i;
            break;
        }

        // While the train is standing at a station, that station stays the one
        // on the card until it has actually been left behind.
        long held = arrivals.currentStationId();
        if (held != 0 && (arrivals.phase() == JourneyState.Phase.ARRIVED
                       || arrivals.phase() == JourneyState.Phase.DEPARTED)) {
            for (int i = 0; i < state.stops.size(); i++) {
                if (state.stops.get(i).station.id == held) { nextIdx = i; break; }
            }
        }

        for (int i = 0; i < state.stops.size(); i++) {
            JourneyState.StopView v = state.stops.get(i);
            if (i == nextIdx) {
                v.state = (state.phase == JourneyState.Phase.ARRIVED)
                        ? JourneyState.StopView.ARRIVED : JourneyState.StopView.NEXT;
            } else if (nextIdx < 0 || i < nextIdx) {
                v.state = JourneyState.StopView.PASSED;
            } else {
                v.state = JourneyState.StopView.UPCOMING;
            }
        }

        if (nextIdx >= 0) {
            state.next = state.stops.get(nextIdx);
            if (nextIdx > 0) state.previous = state.stops.get(nextIdx - 1);
        } else if (!state.stops.isEmpty()) {
            state.previous = state.stops.get(state.stops.size() - 1);
        }
    }

    private void runArrivals() {
        JourneyState.StopView next = state.next;
        Station target = next == null ? null : next.station;
        double alongM = next == null ? Double.NaN : next.distance;
        double directM = target == null ? Double.NaN
                : Geo.distance(state.rawLat, state.rawLon, target.lat, target.lon);

        int phase = arrivals.update(target, alongM, directM, state.accuracy);
        state.phase = phase;
        state.phaseStation = target;
        state.phaseSince = arrivals.phaseSince();

        if (arrivals.departedHoldElapsed()) {
            arrivals.advance();
            state.phase = JourneyState.Phase.IDLE;
            rebuildStopViews(state.alongNow);
        }
    }

    // ------------------------------------------------- arrival detector hooks

    @Override public void onApproaching(Station s, double metres) {
        alerts.vibrateApproaching();
        if (notificationTarget != null) {
            alerts.notifyStation("Approaching " + s.name,
                    com.trainjourney.live.util.Fmt.distance(metres) + " to go",
                    notificationTarget);
        }
        fireStationPhase(JourneyState.Phase.ARRIVING, s);
    }

    @Override public void onArrived(Station s) {
        JourneyState.Visit v = visit(s);
        if (v.arrivedAt == 0) v.arrivedAt = System.currentTimeMillis();
        alerts.vibrateArrived();
        if (notificationTarget != null) {
            alerts.notifyStation(s.name + " - Arrived", "You have reached this station",
                    notificationTarget);
        }
        fireStationPhase(JourneyState.Phase.ARRIVED, s);
    }

    @Override public void onDeparted(Station s) {
        JourneyState.Visit v = visit(s);
        v.departedAt = System.currentTimeMillis();
        alerts.vibrateDeparted();
        if (notificationTarget != null) {
            alerts.notifyStation(s.name + " - Departed", "Next station coming up",
                    notificationTarget);
        }
        fireStationPhase(JourneyState.Phase.DEPARTED, s);
    }

    private JourneyState.Visit visit(Station s) {
        Long key = Long.valueOf(s.id);
        JourneyState.Visit v = state.visits.get(key);
        if (v == null) {
            v = new JourneyState.Visit();
            state.visits.put(key, v);
        }
        return v;
    }

    private void fireStationPhase(int phase, Station s) {
        for (int i = 0; i < listeners.size(); i++) {
            listeners.get(i).onStationPhase(phase, s);
        }
    }

    // --------------------------------------------------------- rail data hooks

    @Override public void onRailDataChanged(RailIndex index) {
        state.hasRailData = !index.ways.isEmpty();
        ensureGraph();
        if (state.hasFix && graph != null && !planBuilding && match.matched) {
            buildPlanAsync();
        }
        publish();
    }

    @Override public void onLoadStateChanged(boolean loading, String message) {
        state.loadingRailData = loading;
        state.statusMessage = message == null ? "" : message;
        publish();
    }

    // -------------------------------------------------------------- choices

    /**
     * Locks the route to a destination the passenger picked, and re-traces so
     * any fork ahead now resolves towards it.
     */
    public void chooseDestination(Station s) {
        state.chosenDestination = s;
        state.needsRouteChoice = false;
        lastPlanBuildAt = 0;
        if (graph != null && match.matched && !planBuilding) buildPlanAsync();
        publish();
    }

    public void clearDestination() {
        state.chosenDestination = null;
        lastPlanBuildAt = 0;
        if (graph != null && match.matched && !planBuilding) buildPlanAsync();
        publish();
    }

    /** Stations the passenger can pick between when the route forks. */
    public List<Station> candidateDestinations() {
        List<Station> out = new ArrayList<Station>();
        for (int i = 0; i < state.stops.size(); i++) {
            JourneyState.StopView v = state.stops.get(i);
            if (v.distance > 0) out.add(v.station);
        }
        if (out.isEmpty()) {
            // No plan yet: offer whatever is mapped nearby so the app is never stuck.
            RailIndex idx = repo.index();
            if (state.hasFix) out.addAll(idx.stationsWithin(state.rawLat, state.rawLon, 60000));
        }
        return out;
    }

    private void publish() {
        state.tickElapsed();
        for (int i = 0; i < listeners.size(); i++) {
            listeners.get(i).onJourneyUpdated(state);
        }
    }

    public void shutdown() {
        location.stop();
        repo.removeListener(this);
        listeners.clear();
    }
}
