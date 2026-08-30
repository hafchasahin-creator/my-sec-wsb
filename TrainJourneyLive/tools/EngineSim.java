import com.trainjourney.live.data.*;
import com.trainjourney.live.engine.*;
import com.trainjourney.live.util.*;

import java.util.*;

/**
 * Headless simulation of a train journey over a synthetic-but-realistic railway.
 *
 * The matcher, the graph walk, the route plan and the arrival state machine are
 * all plain Java, so they can be driven here on the JVM with a scripted GPS
 * trace. This is what proves the app behaves before it ever reaches a phone.
 *
 *   javac -d out $(find app/src/main/java/com/trainjourney/live/{util,data,engine} -name '*.java' | grep -v Android) tools/EngineSim.java
 */
public class EngineSim {

    static int failures = 0;

    static void check(boolean cond, String what) {
        if (!cond) { System.out.println("  FAIL: " + what); failures++; }
        else System.out.println("  ok  : " + what);
    }

    public static void main(String[] args) {
        System.out.println("=== Train Journey Live - engine simulation ===\n");
        testGeometry();
        testIdentity();
        testGraphAndPlan();
        testJourney();
        System.out.println("\n" + (failures == 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"));
        if (failures > 0) System.exit(1);
    }

    // ---------------------------------------------------------------- identity

    /** OSM ids are large and still growing; the namespacing must not collide. */
    static void testIdentity() {
        System.out.println("\n[identity and storage]");
        long[] ids = {1L, 12_345L, 1_300_000_000L, 12_900_000_000L, 99_999_999_999L};
        String[] kinds = {"node", "way", "relation"};
        Set<Long> seen = new HashSet<Long>();
        boolean collision = false;
        for (String k : kinds) {
            for (long id : ids) {
                if (!seen.add(Long.valueOf(namespaced(k, id)))) collision = true;
            }
        }
        check(!collision, "node/way/relation ids never collide, even past 12 billion");

        // Geometry survives the microdegree packing used by the offline cache.
        double[] pts = {24.8231234, 92.7981234, -33.8567891, 151.2152897, 0, 0};
        double[] back = unpack(pack(pts));
        double worst = 0;
        for (int i = 0; i < pts.length; i++) worst = Math.max(worst, Math.abs(pts[i] - back[i]));
        check(worst < 1e-7, "cached coordinates round-trip within a centimetre");
    }

    /** Mirrors OverpassClient.namespaced. */
    static long namespaced(String type, long id) {
        int kind = "node".equals(type) ? 0 : ("way".equals(type) ? 1 : 2);
        return id * 4 + kind;
    }

    /** Mirrors RailCache.pack. */
    static byte[] pack(double[] pts) {
        byte[] b = new byte[pts.length * 4];
        int o = 0;
        for (int i = 0; i < pts.length; i++) {
            int v = (int) Math.round(pts[i] * 1e7);
            b[o++] = (byte) (v >>> 24); b[o++] = (byte) (v >>> 16);
            b[o++] = (byte) (v >>> 8);  b[o++] = (byte) v;
        }
        return b;
    }

    /** Mirrors RailCache.unpack. */
    static double[] unpack(byte[] b) {
        double[] pts = new double[b.length / 4];
        int o = 0;
        for (int i = 0; i < pts.length; i++) {
            int v = ((b[o] & 0xFF) << 24) | ((b[o + 1] & 0xFF) << 16)
                  | ((b[o + 2] & 0xFF) << 8) | (b[o + 3] & 0xFF);
            o += 4;
            pts[i] = v / 1e7;
        }
        return pts;
    }

    // ---------------------------------------------------------------- geometry

    static void testGeometry() {
        System.out.println("[geometry]");
        double d = Geo.distance(24.8200, 92.7900, 24.8300, 92.7900);
        check(Math.abs(d - 1111.9) < 3, "1/100 degree of latitude is ~1112 m (got " + Math.round(d) + ")");

        double b = Geo.bearing(24.82, 92.79, 24.83, 92.79);
        check(Math.abs(b) < 0.5 || Math.abs(b - 360) < 0.5, "due north is bearing 0 (got " + Math.round(b) + ")");

        check(Math.abs(Geo.angleBetweenUndirected(10, 190)) < 0.001,
                "a line drawn backwards is still aligned");
        check(Math.abs(Geo.angleBetween(350, 10) - 20) < 0.001, "angles wrap at 360");

        Geo.Projection p = new Geo.Projection();
        // Point 100 m east of a north-south segment.
        double[] off = Geo.offset(24.825, 92.79, 90, 100);
        Geo.projectOnSegment(off[0], off[1], 24.82, 92.79, 24.83, 92.79, p);
        check(Math.abs(p.distance - 100) < 1.5, "perpendicular offset measured (got " + Math.round(p.distance) + " m)");
        check(p.t > 0.4 && p.t < 0.6, "projects to the middle of the segment");
    }

    // -------------------------------------------------------- synthetic world

    /** Builds a line of points from a start along a bearing, curving gently. */
    static double[] line(double lat, double lon, double bearing, double curvePerKm,
                         double lengthM, double stepM) {
        int n = (int) (lengthM / stepM) + 1;
        double[] pts = new double[n * 2];
        double la = lat, lo = lon, brg = bearing;
        for (int i = 0; i < n; i++) {
            pts[i * 2] = la;
            pts[i * 2 + 1] = lo;
            double[] nx = Geo.offset(la, lo, brg, stepM);
            la = nx[0]; lo = nx[1];
            brg += curvePerKm * (stepM / 1000.0);
        }
        return pts;
    }

    static double[] slice(double[] pts, int from, int toExclusive) {
        double[] out = new double[(toExclusive - from) * 2];
        System.arraycopy(pts, from * 2, out, 0, out.length);
        return out;
    }

    static RailIndex world = null;
    static double[] mainLine = null;
    static List<Station> plannedOrder = new ArrayList<Station>();

    static void buildWorld() {
        // 60 km main line heading north-west, curving slightly, nodes every 100 m.
        mainLine = line(24.5000, 92.6000, 335, 0.55, 60000, 100);
        int n = mainLine.length / 2;

        List<RailWay> ways = new ArrayList<RailWay>();
        // Split into four ways, as OSM would at junctions. Ways share end nodes.
        int[] cuts = {0, n / 4, n / 2, (3 * n) / 4, n - 1};
        for (int i = 0; i < 4; i++) {
            ways.add(new RailWay(100 + i, "Main Line", "rail", "main",
                    slice(mainLine, cuts[i], cuts[i + 1] + 1)));
        }

        // A branch leaving the junction at the halfway node, diverging by 38 degrees.
        int j = cuts[2];
        double jLat = mainLine[j * 2], jLon = mainLine[j * 2 + 1];
        double mainBrg = Geo.bearing(mainLine[(j - 1) * 2], mainLine[(j - 1) * 2 + 1], jLat, jLon);
        ways.add(new RailWay(200, "Branch Line", "rail", "branch",
                line(jLat, jLon, mainBrg + 38, 0, 18000, 100)));

        // A parallel siding 45 m to the east of the first stretch - the classic
        // way to get a map matcher to snap to the wrong rails.
        double[] sidingStart = Geo.offset(mainLine[0], mainLine[1], 65, 45);
        ways.add(new RailWay(300, "Yard Siding", "rail", "industrial",
                line(sidingStart[0], sidingStart[1], 335, 0.55, 9000, 100)));

        // Stations every 8 km along the main line, sitting 55 m off the track.
        List<Station> stations = new ArrayList<Station>();
        String[] names = {"Silchar", "Arunachal", "Kanakpur", "New Haflong",
                          "Maibong", "Badarpur Junction", "Panchgram"};
        for (int k = 0; k < names.length; k++) {
            double m = 3000 + k * 8000;
            int idx = (int) (m / 100);
            if (idx >= n) break;
            double[] pos = Geo.offset(mainLine[idx * 2], mainLine[idx * 2 + 1], 90, 55);
            Station st = new Station(1000 + k, names[k], null, pos[0], pos[1],
                    k % 3 == 1 ? "halt" : "station");
            stations.add(st);
            plannedOrder.add(st);
        }
        // A station on the branch, which must NOT appear on the main-line route.
        double[] branchPts = ways.get(4).pts;
        stations.add(new Station(2000, "Branch Halt", null,
                branchPts[branchPts.length - 2], branchPts[branchPts.length - 1], "halt"));

        world = new RailIndex(ways, stations);
    }

    // ------------------------------------------------------- graph + planning

    static void testGraphAndPlan() {
        System.out.println("\n[graph and route plan]");
        buildWorld();
        RailGraph graph = new RailGraph(world);

        // Put a fix 12 m east of the track at 5 km along, heading with the line.
        int idx = 50;
        double trackBrg = Geo.bearing(mainLine[idx * 2], mainLine[idx * 2 + 1],
                                      mainLine[(idx + 1) * 2], mainLine[(idx + 1) * 2 + 1]);
        double[] fix = Geo.offset(mainLine[idx * 2], mainLine[idx * 2 + 1], trackBrg + 90, 12);

        MapMatcher m = new MapMatcher();
        MatchResult r = new MatchResult();
        m.match(world, fix[0], fix[1], 8f, trackBrg, 20, r);
        check(r.matched, "matched onto a railway line");
        check(r.way != null && r.way.id != 300, "chose the main line, not the parallel siding");
        check(r.offset < 15, "snapped within " + Math.round(r.offset) + " m");

        RoutePlan plan = RoutePlan.build(graph, r);
        check(plan != null && !plan.isEmpty(), "route traced through the junction");
        if (plan == null) return;

        System.out.println("  plan: " + plan.describe());
        check(plan.path.length() > 50000, "traced " + Math.round(plan.path.length() / 1000) + " km of route");

        // Ordering and content.
        boolean ordered = true;
        StringBuilder seq = new StringBuilder();
        for (int i = 0; i < plan.stops.size(); i++) {
            if (i > 0 && plan.stops.get(i).along < plan.stops.get(i - 1).along) ordered = false;
            seq.append(i > 0 ? " -> " : "").append(plan.stops.get(i).station.name);
        }
        check(ordered, "stations ordered along the route");
        System.out.println("  stops: " + seq);

        boolean hasBranchHalt = false;
        for (int i = 0; i < plan.stops.size(); i++) {
            if (plan.stops.get(i).station.id == 2000) hasBranchHalt = true;
        }
        check(!hasBranchHalt, "station on the diverging branch is excluded");
        check(plan.stops.size() >= 6, "found " + plan.stops.size() + " real stations on the route");
        check(!plan.ambiguous,
                "a 38-degree branch is a clear divergence, not a fork worth asking about");

        testGenuineFork();
    }

    /**
     * A Y-shaped split where both onward lines are equally plausible. The walk
     * must refuse to guess - and must then follow whichever branch a chosen
     * destination sits on.
     */
    static void testGenuineFork() {
        double[] trunk = line(24.5000, 92.6000, 0, 0, 20000, 100);
        int n = trunk.length / 2;
        double jLat = trunk[(n - 1) * 2], jLon = trunk[(n - 1) * 2 + 1];

        List<RailWay> ways = new ArrayList<RailWay>();
        ways.add(new RailWay(1, "Trunk", "rail", "main", trunk));
        ways.add(new RailWay(2, "West Arm", "rail", "main", line(jLat, jLon, -14, 0, 25000, 100)));
        ways.add(new RailWay(3, "East Arm", "rail", "main", line(jLat, jLon, 14, 0, 25000, 100)));

        List<Station> stations = new ArrayList<Station>();
        double[] west = ways.get(1).pts, east = ways.get(2).pts;
        Station westEnd = new Station(11, "Westford", null,
                west[west.length - 2], west[west.length - 1], "station");
        Station eastEnd = new Station(12, "Eastbury", null,
                east[east.length - 2], east[east.length - 1], "station");
        stations.add(westEnd);
        stations.add(eastEnd);
        RailIndex forkWorld = new RailIndex(ways, stations);
        RailGraph g = new RailGraph(forkWorld);

        MapMatcher m = new MapMatcher();
        MatchResult r = new MatchResult();
        m.match(forkWorld, trunk[100], trunk[101], 8f, 0, 20, r);

        RoutePlan undecided = RoutePlan.build(g, r);
        check(undecided != null && undecided.ambiguous,
                "an even Y-fork is reported, so the app asks instead of guessing");
        if (undecided != null) {
            check(undecided.path.length() < 25000,
                    "the trace stops at the fork rather than picking a branch");
        }

        RoutePlan toWest = RoutePlan.build(g, r, westEnd.lat, westEnd.lon);
        boolean reachesWest = false;
        for (int i = 0; toWest != null && i < toWest.stops.size(); i++) {
            if (toWest.stops.get(i).station.id == 11) reachesWest = true;
        }
        check(reachesWest, "choosing Westford routes the trace down the west arm");

        RoutePlan toEast = RoutePlan.build(g, r, eastEnd.lat, eastEnd.lon);
        boolean reachesEast = false;
        for (int i = 0; toEast != null && i < toEast.stops.size(); i++) {
            if (toEast.stops.get(i).station.id == 12) reachesEast = true;
        }
        check(reachesEast, "choosing Eastbury routes the trace down the east arm");
    }

    // --------------------------------------------------------- moving journey

    static void testJourney() {
        System.out.println("\n[simulated journey: 55 km at 72 km/h with GPS noise]");
        RailGraph graph = new RailGraph(world);
        MapMatcher matcher = new MapMatcher();
        MatchResult match = new MatchResult();
        JourneyState state = new JourneyState();
        state.startJourney();

        final List<String> arrived = new ArrayList<String>();
        final List<String> departed = new ArrayList<String>();
        ArrivalDetector detector = new ArrivalDetector(new ArrivalDetector.Callback() {
            public void onApproaching(Station s, double m) { }
            public void onArrived(Station s) { arrived.add(s.name); }
            public void onDeparted(Station s) { departed.add(s.name); }
        });

        Random rng = new Random(20260830L);
        RoutePlan plan = null;
        double[] tmp = new double[2];
        int matchedCount = 0, fixes = 0, wrongWay = 0;
        double lastNextDistance = Double.NaN;
        int distanceRegressions = 0;
        String lastNextName = null;

        double speed = 20;                       // m/s
        for (double travelled = 500; travelled < 55000; travelled += speed) {
            int idx = (int) (travelled / 100);
            if (idx + 1 >= mainLine.length / 2) break;
            double tLat = mainLine[idx * 2], tLon = mainLine[idx * 2 + 1];
            double brg = Geo.bearing(tLat, tLon, mainLine[(idx + 1) * 2], mainLine[(idx + 1) * 2 + 1]);

            // GPS noise: a few metres of wander, as a phone by a train window gives.
            double noise = rng.nextGaussian() * 6;
            double[] fix = Geo.offset(tLat, tLon, rng.nextDouble() * 360, Math.abs(noise));
            float acc = (float) (6 + Math.abs(rng.nextGaussian()) * 4);

            matcher.match(world, fix[0], fix[1], acc, brg, speed, match);
            fixes++;
            if (match.matched) {
                matchedCount++;
                if (match.way.id == 300 || match.way.id == 200) wrongWay++;
            }

            double dLat = match.matched ? match.lat : fix[0];
            double dLon = match.matched ? match.lon : fix[1];

            boolean needPlan = plan == null;
            if (!needPlan) {
                double a = plan.alongFor(dLat, dLon, tmp);
                needPlan = tmp[1] > 350 || !plan.covers(match, a);
            }
            if (needPlan && match.matched) plan = RoutePlan.build(graph, match);
            if (plan == null) continue;

            double along = plan.alongFor(dLat, dLon, tmp);
            state.lat = dLat; state.lon = dLon;
            state.rawLat = fix[0]; state.rawLon = fix[1];
            state.accuracy = acc;

            // Reproduce the engine's ordering of the stops, including the rule
            // that keeps a station selected while the train is standing at it.
            JourneyState.StopView next = null;
            for (int i = 0; i < plan.stops.size(); i++) {
                RoutePlan.Stop s = plan.stops.get(i);
                JourneyState.Visit v = state.visits.get(Long.valueOf(s.station.id));
                if (v != null && v.departedAt > 0) continue;
                double dist = s.along - along;
                if (dist < -1200) continue;
                next = new JourneyState.StopView();
                next.station = s.station;
                next.distance = dist;
                break;
            }
            long held = detector.currentStationId();
            if (held != 0 && (detector.phase() == JourneyState.Phase.ARRIVED
                           || detector.phase() == JourneyState.Phase.DEPARTED)) {
                for (int i = 0; i < plan.stops.size(); i++) {
                    RoutePlan.Stop s = plan.stops.get(i);
                    if (s.station.id != held) continue;
                    next = new JourneyState.StopView();
                    next.station = s.station;
                    next.distance = s.along - along;
                    break;
                }
            }
            state.next = next;

            Station target = next == null ? null : next.station;
            double direct = target == null ? Double.NaN
                    : Geo.distance(fix[0], fix[1], target.lat, target.lon);
            int phase = detector.update(target, next == null ? Double.NaN : next.distance,
                    direct, acc);
            state.phase = phase;

            if (target != null) {
                if (target.name.equals(lastNextName) && !Double.isNaN(lastNextDistance)
                        && next.distance > lastNextDistance + 120) {
                    distanceRegressions++;
                }
                lastNextName = target.name;
                lastNextDistance = next.distance;
            }

            if (phase == JourneyState.Phase.ARRIVED) {
                JourneyState.Visit v = state.visits.get(Long.valueOf(target.id));
                if (v == null) { v = new JourneyState.Visit(); state.visits.put(Long.valueOf(target.id), v); }
                if (v.arrivedAt == 0) v.arrivedAt = System.currentTimeMillis();
            }
            if (phase == JourneyState.Phase.DEPARTED) {
                JourneyState.Visit v = state.visits.get(Long.valueOf(target.id));
                if (v != null && v.departedAt == 0) v.departedAt = System.currentTimeMillis();
                detector.advance();
            }
        }

        double rate = 100.0 * matchedCount / fixes;
        System.out.println("  fixes=" + fixes + "  matched=" + Math.round(rate) + "%");
        check(rate > 95, "map matching held the line for " + Math.round(rate) + "% of fixes");
        check(wrongWay == 0, "never snapped to the siding or the branch (" + wrongWay + " slips)");
        check(distanceRegressions == 0,
                "distance to the next station never jumped backwards (" + distanceRegressions + ")");

        System.out.println("  arrived : " + arrived);
        System.out.println("  departed: " + departed);
        check(arrived.size() >= 5, "arrived at " + arrived.size() + " stations");
        check(departed.size() >= 4, "departed " + departed.size() + " stations");

        // Arrivals must be in true geographic order, with nothing skipped.
        boolean order = true;
        int expect = 0;
        for (int i = 0; i < arrived.size(); i++) {
            while (expect < plannedOrder.size()
                    && !plannedOrder.get(expect).name.equals(arrived.get(i))) expect++;
            if (expect >= plannedOrder.size()) { order = false; break; }
            expect++;
        }
        check(order, "arrivals happened in route order, none out of sequence");

        Set<String> unique = new LinkedHashSet<String>(arrived);
        check(unique.size() == arrived.size(), "no station announced twice");
    }
}
