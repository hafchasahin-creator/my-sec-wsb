package com.trainjourney.live.engine;

import com.trainjourney.live.data.RailIndex;
import com.trainjourney.live.data.Station;
import com.trainjourney.live.util.Geo;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/**
 * The train's route as the app understands it: one continuous line traced
 * through the rails, with every station on it placed in order.
 *
 * The line runs both ways from wherever the plan was built - a short distance
 * behind so the previous station is known, a long way ahead for the upcoming
 * ones - and is measured from its own start, so a single "distance along" value
 * orders everything the UI needs to show.
 */
public final class RoutePlan {

    /** How far behind the build point the plan looks, metres. */
    public static final double BACKWARD_M = 40_000;
    /** How far ahead, metres. Comfortably more than a phone-battery's worth of travel. */
    public static final double FORWARD_M = 260_000;
    /** A station further than this from the line is not on this route. */
    private static final double STATION_CORRIDOR_M = 450;
    /** Two stations closer than this with the same name are one station mapped twice. */
    private static final double DEDUPE_M = 1_200;

    /** A station pinned to the route, with its position along it. */
    public static final class Stop {
        public final Station station;
        /** Distance from the start of the plan's line, metres. */
        public final double along;
        /** How far the station sits from the line itself, metres. */
        public final double offset;

        Stop(Station station, double along, double offset) {
            this.station = station;
            this.along = along;
            this.offset = offset;
        }
    }

    /** The full traced line: behind the build point, then ahead of it. */
    public final RoutePath path;
    /** Distance along {@link #path} of the point the plan was built at. */
    public final double originAlong;
    /** Every station on the line, ordered from the far end behind to the far end ahead. */
    public final List<Stop> stops;
    /** True when the trace hit a fork it would not guess at. */
    public final boolean ambiguous;
    /** Where that fork is, as a distance along the path. */
    public final double ambiguityAlong;
    /** Id of the way the plan was built from. */
    public final long seedWayId;
    public final long builtAt;

    private final double[] scratch = new double[2];

    private RoutePlan(RoutePath path, double originAlong, List<Stop> stops,
                      boolean ambiguous, double ambiguityAlong, long seedWayId) {
        this.path = path;
        this.originAlong = originAlong;
        this.stops = stops;
        this.ambiguous = ambiguous;
        this.ambiguityAlong = ambiguityAlong;
        this.seedWayId = seedWayId;
        this.builtAt = System.currentTimeMillis();
    }

    public boolean isEmpty() {
        return path.isEmpty();
    }

    /**
     * Distance along the plan for a position, or NaN when the position is not
     * on this route any more. {@code out[1]} receives the perpendicular offset.
     */
    public double alongFor(double lat, double lon, double[] out) {
        if (path.isEmpty()) return Double.NaN;
        if (!path.project(lat, lon, out)) return Double.NaN;
        return out[0];
    }

    /** Convenience overload using an internal scratch buffer. */
    public double alongFor(double lat, double lon) {
        return alongFor(lat, lon, scratch);
    }

    /** Perpendicular distance of the last {@link #alongFor} call. */
    public double lastOffset() {
        return scratch[1];
    }

    // ------------------------------------------------------------------ build

    /**
     * Traces the route through a matched position and places the stations on it.
     *
     * @param graph   graph over the currently loaded railway data
     * @param match   a confident map match
     */
    public static RoutePlan build(RailGraph graph, MatchResult match) {
        return build(graph, match, Double.NaN, Double.NaN);
    }

    /**
     * Traces the route, resolving any fork towards a destination the passenger
     * has picked. Pass NaN for the destination to have forks reported instead.
     */
    public static RoutePlan build(RailGraph graph, MatchResult match,
                                  double destLat, double destLon) {
        if (graph == null || match == null || !match.matched || match.way == null) return null;
        int dir = match.direction != 0 ? match.direction : 1;

        RoutePath ahead = graph.walk(match.way, match.segment, match.t, dir, FORWARD_M,
                destLat, destLon);
        RoutePath behind = graph.walk(match.way, match.segment, match.t, -dir, BACKWARD_M);
        if (ahead.isEmpty() && behind.isEmpty()) return null;

        // Stitch: the backward trace reversed, then the forward trace.
        int nb = behind.size();
        int na = ahead.size();
        double back = behind.isEmpty() ? 0 : behind.length();
        int total = (nb > 0 ? nb - 1 : 0) + na;      // the shared origin appears once

        double[] pts = new double[total * 2];
        double[] cum = new double[total];
        int k = 0;
        for (int i = nb - 1; i >= 1; i--) {          // skip index 0: it is the origin
            pts[k * 2] = behind.lat(i);
            pts[k * 2 + 1] = behind.lon(i);
            cum[k] = back - behind.cum[i];
            k++;
        }
        for (int i = 0; i < na; i++) {
            pts[k * 2] = ahead.lat(i);
            pts[k * 2 + 1] = ahead.lon(i);
            cum[k] = back + ahead.cum[i];
            k++;
        }

        long[] wayIds = new long[behind.wayIds.length + ahead.wayIds.length];
        System.arraycopy(behind.wayIds, 0, wayIds, 0, behind.wayIds.length);
        System.arraycopy(ahead.wayIds, 0, wayIds, behind.wayIds.length, ahead.wayIds.length);

        RoutePath combined = new RoutePath(pts, cum, wayIds,
                ahead.ambiguous, back + ahead.ambiguityAt);
        List<Stop> stops = placeStations(graph.index(), combined);

        return new RoutePlan(combined, back, stops,
                ahead.ambiguous, back + ahead.ambiguityAt, match.way.id);
    }

    /** Finds every station within the corridor and orders it along the line. */
    private static List<Stop> placeStations(RailIndex index, RoutePath path) {
        List<Stop> found = new ArrayList<Stop>();
        double[] out = new double[2];

        // Cheap rejection box around the whole path.
        double minLat = Double.MAX_VALUE, maxLat = -Double.MAX_VALUE;
        double minLon = Double.MAX_VALUE, maxLon = -Double.MAX_VALUE;
        for (int i = 0; i < path.size(); i++) {
            double la = path.lat(i), lo = path.lon(i);
            if (la < minLat) minLat = la;
            if (la > maxLat) maxLat = la;
            if (lo < minLon) minLon = lo;
            if (lo > maxLon) maxLon = lo;
        }
        double pad = STATION_CORRIDOR_M / Geo.M_PER_DEG * 2;

        for (int i = 0; i < index.stations.size(); i++) {
            Station s = index.stations.get(i);
            if (s.lat < minLat - pad || s.lat > maxLat + pad) continue;
            if (s.lon < minLon - pad || s.lon > maxLon + pad) continue;
            if (!path.project(s.lat, s.lon, out)) continue;
            if (out[1] > STATION_CORRIDOR_M) continue;
            found.add(new Stop(s, out[0], out[1]));
        }

        Collections.sort(found, new Comparator<Stop>() {
            @Override public int compare(Stop a, Stop b) {
                return Double.compare(a.along, b.along);
            }
        });
        return dedupe(found);
    }

    /**
     * OSM often carries both a {@code railway=station} area and a
     * {@code railway=halt} node for the same place. Keeping both would make the
     * app announce the same arrival twice, so near-duplicates collapse to the
     * one closest to the line.
     */
    private static List<Stop> dedupe(List<Stop> sorted) {
        List<Stop> out = new ArrayList<Stop>(sorted.size());
        for (int i = 0; i < sorted.size(); i++) {
            Stop s = sorted.get(i);
            boolean merged = false;
            for (int j = out.size() - 1; j >= 0; j--) {
                Stop prev = out.get(j);
                if (s.along - prev.along > DEDUPE_M) break;
                boolean sameName = prev.station.name.equalsIgnoreCase(s.station.name);
                boolean veryClose = Geo.distance(prev.station.lat, prev.station.lon,
                                                 s.station.lat, s.station.lon) < 350;
                if (sameName || veryClose) {
                    if (s.offset < prev.offset) out.set(j, s);
                    merged = true;
                    break;
                }
            }
            if (!merged) out.add(s);
        }
        return out;
    }

    /** True when the plan still describes where the train is. */
    public boolean covers(MatchResult match, double alongNow) {
        if (path.isEmpty()) return false;
        if (match != null && match.matched && match.way != null
                && !path.usesWay(match.way.id)) {
            return false;
        }
        if (Double.isNaN(alongNow)) return false;
        // Rebuild before running off the end of the traced line.
        return alongNow < path.length() - 12_000;
    }

    /** Short summary for diagnostics. */
    public String describe() {
        return "RoutePlan{" + stops.size() + " stops, " + Math.round(path.length() / 1000)
                + " km" + (ambiguous ? ", forked" : "") + "}";
    }
}
