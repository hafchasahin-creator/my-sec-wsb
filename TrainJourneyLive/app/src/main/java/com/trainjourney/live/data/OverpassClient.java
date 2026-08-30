package com.trainjourney.live.data;

import android.util.JsonReader;
import android.util.JsonToken;
import android.util.Log;

import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.GZIPInputStream;

/**
 * Reads real railway geometry from OpenStreetMap through the public Overpass API.
 *
 * OSM data is open (ODbL), so no key, account or operator feed is involved. One
 * request per grid cell returns both the running lines and the stations inside
 * it; results are streamed rather than buffered because a dense cell can run to
 * several megabytes of JSON on a phone with very little spare memory.
 */
public final class OverpassClient {

    private static final String TAG = "Overpass";

    /** Mirrors are tried in order; the first that answers wins. */
    private static final String[] ENDPOINTS = {
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
        "https://overpass.private.coffee/api/interpreter",
        "https://overpass.osm.jp/api/interpreter",
    };

    private static final String USER_AGENT =
        "TrainJourneyLive/1.0 (offline-first passenger app; OSM data via Overpass)";

    private static final int CONNECT_TIMEOUT_MS = 15000;
    private static final int READ_TIMEOUT_MS    = 75000;

    /** Everything one grid cell contributes. */
    public static final class CellData {
        public final List<Station> stations = new ArrayList<Station>();
        public final List<RailWay> ways = new ArrayList<RailWay>();
    }

    private OverpassClient() { }

    /**
     * Fetches every running line and station inside the bounding box.
     * Service track (sidings, yards, crossovers) is filtered out server-side:
     * it would otherwise dominate the match near large stations.
     */
    public static CellData fetch(double south, double west, double north, double east)
            throws IOException {
        String query = buildQuery(south, west, north, east);
        IOException last = null;
        for (int i = 0; i < ENDPOINTS.length; i++) {
            try {
                return request(ENDPOINTS[i], query);
            } catch (IOException e) {
                Log.w(TAG, "mirror failed: " + ENDPOINTS[i] + " (" + e.getMessage() + ")");
                last = e;
            }
        }
        throw last != null ? last : new IOException("no Overpass mirror reachable");
    }

    /** The Overpass QL for one cell. Package-private so it can be checked in tests. */
    static String buildQuery(double south, double west, double north, double east) {
        String bbox = trim(south) + "," + trim(west) + "," + trim(north) + "," + trim(east);
        String query =
            "[out:json][timeout:70];"
          + "(way[\"railway\"~\"^(rail|light_rail|narrow_gauge|subway|monorail)$\"]"
          +   "[\"service\"!~\".\"](" + bbox + "););out geom qt;"
          + "(node[\"railway\"~\"^(station|halt)$\"](" + bbox + ");"
          +  "way[\"railway\"~\"^(station|halt)$\"](" + bbox + ");"
          +  "relation[\"railway\"~\"^(station|halt)$\"](" + bbox + ");"
          +  "node[\"public_transport\"=\"station\"][\"train\"=\"yes\"](" + bbox + "););"
          + "out center qt;";
        return query;
    }

    private static String trim(double v) {
        return String.format(java.util.Locale.US, "%.5f", v);
    }

    private static CellData request(String endpoint, String query) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(endpoint).openConnection();
        try {
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(READ_TIMEOUT_MS);
            conn.setDoOutput(true);
            conn.setRequestProperty("User-Agent", USER_AGENT);
            conn.setRequestProperty("Accept-Encoding", "gzip");
            conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");

            byte[] body = ("data=" + URLEncoder.encode(query, "UTF-8")).getBytes("UTF-8");
            conn.setFixedLengthStreamingMode(body.length);
            OutputStream out = conn.getOutputStream();
            try { out.write(body); } finally { out.close(); }

            int code = conn.getResponseCode();
            if (code != 200) {
                throw new IOException("HTTP " + code + " from " + endpoint);
            }
            InputStream in = conn.getInputStream();
            if ("gzip".equalsIgnoreCase(conn.getContentEncoding())) {
                in = new GZIPInputStream(in);
            }
            in = new BufferedInputStream(in, 32 * 1024);
            try {
                return parse(in);
            } finally {
                try { in.close(); } catch (IOException ignored) { }
            }
        } finally {
            conn.disconnect();
        }
    }

    // ------------------------------------------------------------------ parsing

    /** Package-private so the parser can be exercised without a network. */
    static CellData parse(InputStream in) throws IOException {
        CellData data = new CellData();
        JsonReader r = new JsonReader(new InputStreamReader(in, "UTF-8"));
        r.beginObject();
        while (r.hasNext()) {
            String key = r.nextName();
            if ("elements".equals(key)) {
                r.beginArray();
                while (r.hasNext()) readElement(r, data);
                r.endArray();
            } else {
                r.skipValue();
            }
        }
        r.endObject();
        return data;
    }

    private static void readElement(JsonReader r, CellData data) throws IOException {
        String type = null;
        long id = 0;
        double lat = Double.NaN, lon = Double.NaN;
        double centreLat = Double.NaN, centreLon = Double.NaN;
        double[] geom = null;
        Tags tags = new Tags();

        r.beginObject();
        while (r.hasNext()) {
            String key = r.nextName();
            if ("type".equals(key)) {
                type = r.nextString();
            } else if ("id".equals(key)) {
                id = r.nextLong();
            } else if ("lat".equals(key)) {
                lat = r.nextDouble();
            } else if ("lon".equals(key)) {
                lon = r.nextDouble();
            } else if ("center".equals(key)) {
                r.beginObject();
                while (r.hasNext()) {
                    String k2 = r.nextName();
                    if ("lat".equals(k2)) centreLat = r.nextDouble();
                    else if ("lon".equals(k2)) centreLon = r.nextDouble();
                    else r.skipValue();
                }
                r.endObject();
            } else if ("geometry".equals(key)) {
                geom = readGeometry(r);
            } else if ("tags".equals(key)) {
                readTags(r, tags);
            } else {
                r.skipValue();
            }
        }
        r.endObject();

        if (type == null) return;
        String railway = tags.railway;

        boolean isStation = "station".equals(railway) || "halt".equals(railway)
                || "station".equals(tags.publicTransport);
        if (isStation) {
            double sLat = !Double.isNaN(lat) ? lat : centreLat;
            double sLon = !Double.isNaN(lon) ? lon : centreLon;
            if (Double.isNaN(sLat) || Double.isNaN(sLon)) return;
            if (tags.name == null || tags.name.trim().isEmpty()) return;   // unnamed: not useful
            data.stations.add(new Station(namespaced(type, id), tags.name, tags.ref,
                    sLat, sLon, "halt".equals(railway) ? "halt" : "station"));
            return;
        }

        if ("way".equals(type) && geom != null && geom.length >= 4 && railway != null) {
            data.ways.add(new RailWay(id, tags.name, railway, tags.usage, geom));
        }
    }

    private static double[] readGeometry(JsonReader r) throws IOException {
        // Grows geometrically; most ways are short, a few are thousands of points.
        double[] buf = new double[128];
        int n = 0;
        r.beginArray();
        while (r.hasNext()) {
            if (r.peek() == JsonToken.NULL) { r.skipValue(); continue; }  // clipped node
            double pLat = Double.NaN, pLon = Double.NaN;
            r.beginObject();
            while (r.hasNext()) {
                String k = r.nextName();
                if ("lat".equals(k)) pLat = r.nextDouble();
                else if ("lon".equals(k)) pLon = r.nextDouble();
                else r.skipValue();
            }
            r.endObject();
            if (Double.isNaN(pLat) || Double.isNaN(pLon)) continue;
            if (n + 2 > buf.length) {
                double[] bigger = new double[buf.length * 2];
                System.arraycopy(buf, 0, bigger, 0, n);
                buf = bigger;
            }
            buf[n++] = pLat;
            buf[n++] = pLon;
        }
        r.endArray();
        if (n == buf.length) return buf;
        double[] exact = new double[n];
        System.arraycopy(buf, 0, exact, 0, n);
        return exact;
    }

    private static void readTags(JsonReader r, Tags t) throws IOException {
        r.beginObject();
        while (r.hasNext()) {
            String k = r.nextName();
            if (r.peek() != JsonToken.STRING) { r.skipValue(); continue; }
            String v = r.nextString();
            if ("railway".equals(k)) t.railway = v;
            else if ("name".equals(k)) { if (t.name == null) t.name = v; }
            else if ("name:en".equals(k)) t.name = v;              // prefer the English name
            else if ("usage".equals(k)) t.usage = v;
            else if ("ref".equals(k)) t.ref = v;
            else if ("railway:ref".equals(k)) t.ref = v;
            else if ("public_transport".equals(k)) t.publicTransport = v;
        }
        r.endObject();
    }

    /**
     * Keeps node/way/relation ids from colliding in one table.
     *
     * OSM node ids are past twelve billion, so an additive namespace would have
     * to be enormous to stay clear of way ids; multiplying instead makes the
     * scheme collision-free for any id, whatever OSM reaches next.
     */
    static long namespaced(String type, long id) {
        int kind = "node".equals(type) ? 0 : ("way".equals(type) ? 1 : 2);
        return id * 4 + kind;
    }

    private static final class Tags {
        String railway, name, usage, ref, publicTransport;
    }
}
