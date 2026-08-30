package com.trainjourney.live.data;

import java.io.ByteArrayInputStream;

/**
 * Exercises the Overpass reader against a response shaped exactly like the real
 * API returns - ways with inline geometry, station nodes, a station mapped as an
 * area with a centre, unnamed features, and a clipped geometry entry.
 *
 * Parsing runs on android.util.JsonReader, which is pure Java, so the real code
 * path can be driven here rather than mocked.
 */
public class OverpassTest {

    static int failures = 0;

    static void check(boolean c, String what) {
        if (!c) { System.out.println("  FAIL: " + what); failures++; }
        else System.out.println("  ok  : " + what);
    }

    public static void main(String[] args) throws Exception {
        System.out.println("=== Overpass reader ===\n");

        System.out.println("[query]");
        String q = OverpassClient.buildQuery(24.75, 92.5, 25.0, 92.75);
        System.out.println("  " + q.replace(";", ";\n  "));
        check(q.startsWith("[out:json]"), "asks for JSON");
        check(q.contains("out geom qt;"), "requests inline geometry for the lines");
        check(q.contains("out center qt;"), "requests centres for station areas");
        check(count(q, '(') == count(q, ')'), "parentheses balance");
        check(count(q, '[') == count(q, ']'), "brackets balance");
        check(count(q, '"') % 2 == 0, "quotes balance");
        check(q.contains("24.75000,92.50000,25.00000,92.75000"),
                "bounding box is south,west,north,east");
        check(q.contains("\"service\"!~\".\""), "service track is filtered out server-side");

        System.out.println("\n[parsing]");
        String json =
            "{\"version\":0.6,\"generator\":\"Overpass API\","
          + "\"osm3s\":{\"timestamp_osm_base\":\"2026-08-30T00:00:00Z\"},"
          + "\"elements\":["
          // a normal running line
          + "{\"type\":\"way\",\"id\":1001,\"tags\":{\"railway\":\"rail\",\"usage\":\"main\","
          + "\"name\":\"Lumding-Badarpur section\"},\"geometry\":["
          + "{\"lat\":24.8000,\"lon\":92.7000},{\"lat\":24.8100,\"lon\":92.7050},"
          + "{\"lat\":24.8200,\"lon\":92.7100}]},"
          // a branch with a clipped node, which Overpass emits as null
          + "{\"type\":\"way\",\"id\":1002,\"tags\":{\"railway\":\"narrow_gauge\"},"
          + "\"geometry\":[{\"lat\":24.8200,\"lon\":92.7100},null,"
          + "{\"lat\":24.8300,\"lon\":92.7300}]},"
          // a station node with a code
          + "{\"type\":\"node\",\"id\":2001,\"lat\":24.8205,\"lon\":92.7104,"
          + "\"tags\":{\"railway\":\"station\",\"name\":\"Badarpur Junction\",\"ref\":\"BPB\"}},"
          // a halt
          + "{\"type\":\"node\",\"id\":2002,\"lat\":24.8100,\"lon\":92.7052,"
          + "\"tags\":{\"railway\":\"halt\",\"name\":\"Panchgram\"}},"
          // a station mapped as an area: position comes from `center`
          + "{\"type\":\"way\",\"id\":2003,\"center\":{\"lat\":24.8000,\"lon\":92.7002},"
          + "\"tags\":{\"railway\":\"station\",\"name\":\"SILCHAR\",\"name:en\":\"Silchar\"},"
          + "\"geometry\":[{\"lat\":24.7999,\"lon\":92.7001},{\"lat\":24.8001,\"lon\":92.7003}]},"
          // unnamed station: not useful to a passenger, must be dropped
          + "{\"type\":\"node\",\"id\":2004,\"lat\":24.79,\"lon\":92.69,"
          + "\"tags\":{\"railway\":\"halt\"}},"
          // an unrelated element with tags we do not care about
          + "{\"type\":\"node\",\"id\":3001,\"lat\":24.77,\"lon\":92.68,"
          + "\"tags\":{\"amenity\":\"cafe\",\"name\":\"Platform Tea\"}}"
          + "]}";

        OverpassClient.CellData d = OverpassClient.parse(
                new ByteArrayInputStream(json.getBytes("UTF-8")));

        check(d.ways.size() == 2, "read " + d.ways.size() + " railway lines");
        check(d.stations.size() == 3, "read " + d.stations.size() + " named stations");

        RailWay main = find(d, 1001);
        check(main != null && main.size() == 3, "line geometry has all three points");
        check(main != null && "main".equals(main.usage) && main.isMainLine(),
                "usage tag read, so main lines can be preferred");
        check(main != null && Math.abs(main.lat(0) - 24.8) < 1e-9
                && Math.abs(main.lon(0) - 92.7) < 1e-9, "coordinates land in the right order");

        RailWay branch = find(d, 1002);
        check(branch != null && branch.size() == 2, "a clipped null node is skipped, not fatal");

        Station silchar = findStation(d, "Silchar");
        check(silchar != null, "a station mapped as an area is placed at its centre");
        check(silchar != null && Math.abs(silchar.lat - 24.8000) < 1e-9,
                "centre coordinates used, not the first way node");
        check(silchar != null && silchar.isMajor(), "railway=station is a major station");

        Station bpb = findStation(d, "Badarpur Junction");
        check(bpb != null && "BPB".equals(bpb.code), "station code read from the ref tag");

        Station panchgram = findStation(d, "Panchgram");
        check(panchgram != null && !panchgram.isMajor(), "railway=halt is a minor stop");

        check(findStation(d, "Platform Tea") == null, "a cafe is not mistaken for a station");

        boolean unnamed = false;
        for (Station s : d.stations) if (s.name == null || s.name.isEmpty()) unnamed = true;
        check(!unnamed, "unnamed stations are dropped");

        // Ids from different element types must stay distinct.
        boolean distinct = true;
        for (int i = 0; i < d.stations.size(); i++) {
            for (int j = i + 1; j < d.stations.size(); j++) {
                if (d.stations.get(i).id == d.stations.get(j).id) distinct = false;
            }
        }
        check(distinct, "node-based and way-based stations keep distinct ids");

        System.out.println("\n" + (failures == 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"));
        if (failures > 0) System.exit(1);
    }

    static int count(String s, char c) {
        int n = 0;
        for (int i = 0; i < s.length(); i++) if (s.charAt(i) == c) n++;
        return n;
    }

    static RailWay find(OverpassClient.CellData d, long id) {
        for (RailWay w : d.ways) if (w.id == id) return w;
        return null;
    }

    static Station findStation(OverpassClient.CellData d, String name) {
        for (Station s : d.stations) if (name.equals(s.name)) return s;
        return null;
    }
}
