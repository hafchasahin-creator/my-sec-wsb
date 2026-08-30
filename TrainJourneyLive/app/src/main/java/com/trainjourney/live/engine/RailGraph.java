package com.trainjourney.live.engine;

import com.trainjourney.live.data.RailIndex;
import com.trainjourney.live.data.RailWay;
import com.trainjourney.live.util.Geo;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Turns the loose bag of OSM ways into something that can be walked.
 *
 * OSM splits railway ways at junctions, so two ways connect when they share an
 * endpoint coordinate exactly. Those endpoints are hashed into a perfect 64-bit
 * key (latitude and longitude in tenth-microdegrees pack losslessly into two
 * ints), which makes finding the continuations at a junction an O(1) lookup.
 *
 * At a junction the walk takes the straightest onward line, because that is what
 * a train physically does: a sharp divergence is a branch, not the main move. If
 * two onward lines are both near-straight the walk stops guessing and reports an
 * ambiguity, which is what makes the app ask the passenger to pick a route.
 */
public final class RailGraph {

    /** Turns sharper than this are never taken as a continuation. */
    private static final double MAX_TURN_DEG = 72;
    /** Neither option counts as "straight on" beyond this. */
    private static final double FORK_WINDOW_DEG = 30;
    /** Two options this similar in straightness are genuinely hard to tell apart. */
    private static final double FORK_TIE_DEG = 14;
    /** Below this the two options barely diverge, so either choice is the same route. */
    private static final double FORK_MIN_DIVERGENCE_DEG = 12;

    private final RailIndex index;
    /** Endpoint coordinate -> list of (wayIndex, vertexIndex). */
    private final Map<Long, List<int[]>> endpoints = new HashMap<Long, List<int[]>>();

    public RailGraph(RailIndex index) {
        this.index = index;
        for (int wi = 0; wi < index.ways.size(); wi++) {
            RailWay w = index.ways.get(wi);
            int last = w.size() - 1;
            if (last < 1) continue;
            addEndpoint(w.lat(0), w.lon(0), wi, 0);
            addEndpoint(w.lat(last), w.lon(last), wi, last);
        }
    }

    public RailIndex index() {
        return index;
    }

    private void addEndpoint(double lat, double lon, int wayIndex, int vertex) {
        Long key = Long.valueOf(coordKey(lat, lon));
        List<int[]> list = endpoints.get(key);
        if (list == null) {
            list = new ArrayList<int[]>(3);
            endpoints.put(key, list);
        }
        list.add(new int[]{wayIndex, vertex});
    }

    /** Lossless packing of a coordinate rounded to 1e-7 degrees (about 1 cm). */
    static long coordKey(double lat, double lon) {
        int a = (int) Math.round(lat * 1e7);
        int b = (int) Math.round(lon * 1e7);
        return ((long) a << 32) | (b & 0xFFFFFFFFL);
    }

    /**
     * Traces the rails from a matched position for up to {@code maxMetres}.
     *
     * @param startWay  way the train is on
     * @param segment   segment index within that way
     * @param t         fraction along the segment
     * @param forward   +1 to walk in the way's node order, -1 against it
     */
    public RoutePath walk(RailWay startWay, int segment, double t, int forward, double maxMetres) {
        return walk(startWay, segment, t, forward, maxMetres, Double.NaN, Double.NaN);
    }

    /**
     * As above, but with a destination in hand.
     *
     * Knowing where the passenger is going is what makes a fork resolvable: the
     * walk takes the branch that actually heads towards the destination instead
     * of stopping and asking again.
     */
    public RoutePath walk(RailWay startWay, int segment, double t, int forward, double maxMetres,
                          double destLat, double destLon) {
        if (startWay == null || startWay.size() < 2 || forward == 0) return RoutePath.empty();

        List<Double> lats = new ArrayList<Double>(512);
        List<Double> lons = new ArrayList<Double>(512);
        List<Double> cums = new ArrayList<Double>(512);
        List<Long> ways = new ArrayList<Long>(8);
        Set<Long> visited = new HashSet<Long>();

        // Exact starting point on the segment.
        double curLat = startWay.lat(segment) + (startWay.lat(segment + 1) - startWay.lat(segment)) * t;
        double curLon = startWay.lon(segment) + (startWay.lon(segment + 1) - startWay.lon(segment)) * t;
        lats.add(Double.valueOf(curLat));
        lons.add(Double.valueOf(curLon));
        cums.add(Double.valueOf(0));

        RailWay way = startWay;
        int dir = forward;
        // First vertex to consume after the starting point.
        int next = dir > 0 ? segment + 1 : segment;
        double run = 0;
        boolean ambiguous = false;
        double ambiguityAt = 0;

        for (int hop = 0; hop < 400 && run < maxMetres; hop++) {
            ways.add(Long.valueOf(way.id));
            visited.add(Long.valueOf(way.id));

            // Consume vertices to the end of this way.
            while (next >= 0 && next < way.size() && run < maxMetres) {
                double nLat = way.lat(next), nLon = way.lon(next);
                double step = Geo.distance(curLat, curLon, nLat, nLon);
                if (step > 0.05) {
                    run += step;
                    lats.add(Double.valueOf(nLat));
                    lons.add(Double.valueOf(nLon));
                    cums.add(Double.valueOf(run));
                    curLat = nLat;
                    curLon = nLon;
                }
                next += dir;
            }
            if (run >= maxMetres) break;

            // We are standing on an endpoint of `way`. Where can we go?
            double incoming = incomingBearing(lats, lons);
            Continuation c = chooseContinuation(way, curLat, curLon, incoming, visited,
                    destLat, destLon);
            if (c == null) break;
            if (c.forked) {
                ambiguous = true;
                ambiguityAt = run;
                break;                       // stop rather than pick the wrong branch
            }
            way = index.ways.get(c.wayIndex);
            dir = c.direction;
            next = c.startVertex + dir;
        }

        int n = cums.size();
        double[] pts = new double[n * 2];
        double[] cum = new double[n];
        for (int i = 0; i < n; i++) {
            pts[i * 2] = lats.get(i).doubleValue();
            pts[i * 2 + 1] = lons.get(i).doubleValue();
            cum[i] = cums.get(i).doubleValue();
        }
        long[] wayIds = new long[ways.size()];
        for (int i = 0; i < wayIds.length; i++) wayIds[i] = ways.get(i).longValue();
        return new RoutePath(pts, cum, wayIds, ambiguous, ambiguityAt);
    }

    /** Heading over the last few metres of the path so far. */
    private static double incomingBearing(List<Double> lats, List<Double> lons) {
        int n = lats.size();
        if (n < 2) return Double.NaN;
        int back = Math.max(0, n - 4);
        return Geo.bearing(lats.get(back).doubleValue(), lons.get(back).doubleValue(),
                           lats.get(n - 1).doubleValue(), lons.get(n - 1).doubleValue());
    }

    private static final class Continuation {
        int wayIndex;
        int startVertex;
        int direction;
        double bearing;
        double turn;
        boolean forked;
    }

    /**
     * Picks the onward line at a junction, or reports a fork it will not guess at.
     */
    private Continuation chooseContinuation(RailWay from, double lat, double lon,
                                            double incoming, Set<Long> visited,
                                            double destLat, double destLon) {
        List<int[]> here = endpoints.get(Long.valueOf(coordKey(lat, lon)));
        if (here == null) return null;

        List<Continuation> options = new ArrayList<Continuation>(4);
        for (int i = 0; i < here.size(); i++) {
            int[] e = here.get(i);
            RailWay w = index.ways.get(e[0]);
            if (w.id == from.id) continue;
            if (visited.contains(Long.valueOf(w.id))) continue;
            // Guard against a hash collision: the coordinate must really match.
            if (Geo.distance(lat, lon, w.lat(e[1]), w.lon(e[1])) > 1.0) continue;

            int dir = e[1] == 0 ? 1 : -1;
            int nextVertex = e[1] + dir;
            if (nextVertex < 0 || nextVertex >= w.size()) continue;

            Continuation c = new Continuation();
            c.wayIndex = e[0];
            c.startVertex = e[1];
            c.direction = dir;
            c.bearing = Geo.bearing(w.lat(e[1]), w.lon(e[1]), w.lat(nextVertex), w.lon(nextVertex));
            c.turn = Double.isNaN(incoming) ? 0 : Geo.angleBetween(incoming, c.bearing);
            if (c.turn > MAX_TURN_DEG) continue;
            options.add(c);
        }
        if (options.isEmpty()) return null;

        Continuation best = options.get(0);
        Continuation second = null;
        for (int i = 1; i < options.size(); i++) {
            Continuation c = options.get(i);
            if (c.turn < best.turn) { second = best; best = c; }
            else if (second == null || c.turn < second.turn) { second = c; }
        }

        if (second == null) return best;

        // A real fork: both options are near-straight, similarly straight, and
        // actually go different ways. Anything else has an obvious main move.
        boolean forked = best.turn < FORK_WINDOW_DEG
                && second.turn < FORK_WINDOW_DEG
                && (second.turn - best.turn) < FORK_TIE_DEG
                && Geo.angleBetween(best.bearing, second.bearing) > FORK_MIN_DIVERGENCE_DEG;
        if (!forked) return best;

        if (!Double.isNaN(destLat)) {
            // The passenger told us where they are going, so the fork resolves:
            // take whichever branch actually heads that way.
            double toDest = Geo.bearing(lat, lon, destLat, destLon);
            Continuation pick = null;
            double bestAim = Double.MAX_VALUE;
            for (int i = 0; i < options.size(); i++) {
                double aim = Geo.angleBetween(options.get(i).bearing, toDest);
                if (aim < bestAim) { bestAim = aim; pick = options.get(i); }
            }
            if (pick != null) return pick;
        }

        best.forked = true;
        return best;
    }
}
