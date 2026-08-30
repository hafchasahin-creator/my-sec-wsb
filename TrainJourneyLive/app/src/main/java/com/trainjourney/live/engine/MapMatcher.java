package com.trainjourney.live.engine;

import com.trainjourney.live.data.RailIndex;
import com.trainjourney.live.data.RailWay;
import com.trainjourney.live.util.Geo;

/**
 * Places a raw GPS fix onto the railway line the train is actually running on.
 *
 * The rule the app follows is deliberately conservative: snap only when the
 * evidence is strong, otherwise draw the honest GPS position. Being a hundred
 * metres off on the right line is fine; being pinned confidently to the wrong
 * line - a parallel freight track, or a road-side tramway - is not, because
 * every station prediction downstream would then be wrong too.
 *
 * Three things decide the score: how close the line is relative to the fix's own
 * accuracy, whether the train's course lines up with the track, and whether this
 * is the line we were already on. The last one supplies hysteresis, so passing
 * a parallel siding does not make the icon jump sideways.
 */
public final class MapMatcher {

    /** Minimum score before the snapped position is trusted. */
    public static final double ACCEPT_CONFIDENCE = 0.55;
    /** Never snap further than this, whatever the score. */
    public static final double HARD_LIMIT_M = 220;
    /** Below this speed heading is meaningless, so alignment is not required. */
    public static final double MIN_SPEED_FOR_HEADING = 2.2;      // m/s, ~8 km/h

    private final Geo.Projection proj = new Geo.Projection();
    private final MatchResult scratch = new MatchResult();

    /** The way chosen last time, used for hysteresis. */
    private long stickyWayId = 0;

    /**
     * @param bearing course over ground, degrees; NaN when unknown
     * @param speed   metres per second; negative when unknown
     * @param out     filled in with the result
     */
    public void match(RailIndex index, double lat, double lon, float accuracy,
                      double bearing, double speed, MatchResult out) {
        out.clear();
        if (index == null || index.ways.isEmpty()) return;

        // Search radius scales with how good the fix is: a 5 m fix should not be
        // dragged 150 m sideways, but a 40 m fix legitimately might be.
        double tolerance = Math.max(45.0, Math.min(HARD_LIMIT_M, 2.6 * accuracy + 25));
        double padDeg = tolerance / Geo.M_PER_DEG * 1.6;

        boolean headingUsable = !Double.isNaN(bearing) && speed >= MIN_SPEED_FOR_HEADING;

        double bestScore = 0;
        for (int wi = 0; wi < index.ways.size(); wi++) {
            RailWay w = index.ways.get(wi);
            if (!w.nearBox(lat, lon, padDeg)) continue;

            // Closest point on this way.
            double wayBestDist = Double.MAX_VALUE;
            int wayBestSeg = -1;
            double wayBestT = 0, wayBestLat = 0, wayBestLon = 0, wayBestBearing = 0;

            int n = w.size();
            for (int i = 0; i + 1 < n; i++) {
                Geo.projectOnSegment(lat, lon, w.lat(i), w.lon(i), w.lat(i + 1), w.lon(i + 1), proj);
                if (proj.distance < wayBestDist) {
                    wayBestDist = proj.distance;
                    wayBestSeg = i;
                    wayBestT = proj.t;
                    wayBestLat = proj.lat;
                    wayBestLon = proj.lon;
                    wayBestBearing = proj.bearing;
                }
            }
            if (wayBestSeg < 0 || wayBestDist > tolerance) continue;

            double score = score(w, wayBestDist, wayBestBearing, tolerance, bearing, headingUsable);
            if (score > bestScore) {
                bestScore = score;
                scratch.way = w;
                scratch.segment = wayBestSeg;
                scratch.t = wayBestT;
                scratch.lat = wayBestLat;
                scratch.lon = wayBestLon;
                scratch.trackBearing = wayBestBearing;
                scratch.offset = wayBestDist;
            }
        }

        if (bestScore < ACCEPT_CONFIDENCE || scratch.way == null) {
            // Not confident: leave the fix where the satellites put it.
            stickyWayId = 0;
            return;
        }

        out.copyFrom(scratch);
        out.matched = true;
        out.confidence = Math.min(1.0, bestScore);
        out.direction = headingUsable
                ? (Geo.angleBetween(bearing, out.trackBearing) < 90 ? 1 : -1)
                : 0;
        // Present the track heading in the direction of travel, so the icon
        // never renders nose-backwards on a line digitised the other way.
        if (out.direction < 0) out.trackBearing = Geo.norm360(out.trackBearing + 180);
        stickyWayId = out.way.id;
    }

    private double score(RailWay w, double distance, double segBearing,
                         double tolerance, double bearing, boolean headingUsable) {
        double distScore = 1.0 - Geo.clamp(distance / tolerance, 0, 1);
        distScore = distScore * distScore * 0.5 + distScore * 0.5;   // favour very close lines

        double angScore;
        if (headingUsable) {
            // Undirected: a line drawn the other way is still the same rails.
            double off = Geo.angleBetweenUndirected(bearing, segBearing);
            if (off > 55) return 0;                    // running across it, not along it
            angScore = 1.0 - (off / 55.0);
        } else {
            angScore = 0.62;                           // stopped: no opinion either way
        }

        double classScore = w.isMainLine() ? 1.0 : 0.82;
        double sticky = (stickyWayId != 0 && w.id == stickyWayId) ? 1.12 : 1.0;

        return (distScore * 0.55 + angScore * 0.34 + classScore * 0.11) * sticky;
    }

    /** Forgets the previous line - used when a new journey starts. */
    public void reset() {
        stickyWayId = 0;
    }
}
