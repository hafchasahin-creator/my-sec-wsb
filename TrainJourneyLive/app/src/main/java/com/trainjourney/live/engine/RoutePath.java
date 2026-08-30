package com.trainjourney.live.engine;

import com.trainjourney.live.util.Geo;

/**
 * A polyline traced along the rails ahead of (or behind) the train, with a
 * running distance at every vertex.
 *
 * A traced route runs to a quarter of a million metres and tens of thousands of
 * vertices, and both the per-fix "where am I along this" question and the
 * per-station "where does this sit" question are asked against it constantly.
 * A naive scan would be tens of millions of segment projections, so the path
 * builds a uniform grid over its own segments on first use: lookups then touch
 * only the handful of segments in the neighbouring cells.
 */
public final class RoutePath {

    /** Grid cell size in degrees, about 2.2 km. Comfortably wider than any corridor. */
    private static final double GRID_DEG = 0.02;
    /** Guards against a pathological bbox producing a huge grid. */
    private static final int MAX_GRID_SIDE = 512;

    /** Interleaved lat/lon. */
    public final double[] pts;
    /** Cumulative metres from the start of the path, one per vertex. */
    public final double[] cum;
    /** Ids of the ways this path runs over, in order. */
    public final long[] wayIds;
    /**
     * True when the walk met a genuine fork it could not resolve - two onward
     * lines both plausibly straight ahead. The UI then asks which way the train
     * is going rather than guessing.
     */
    public final boolean ambiguous;
    /** Distance from the start at which that fork sits, metres. */
    public final double ambiguityAt;

    public final double minLat, minLon, maxLat, maxLon;

    // Segment grid, in compressed-sparse-row form. Built on first lookup.
    private int[] cellStart;
    private int[] cellSegs;
    private int gridW, gridH;

    private final Geo.Projection proj = new Geo.Projection();

    public RoutePath(double[] pts, double[] cum, long[] wayIds,
                     boolean ambiguous, double ambiguityAt) {
        this.pts = pts;
        this.cum = cum;
        this.wayIds = wayIds;
        this.ambiguous = ambiguous;
        this.ambiguityAt = ambiguityAt;

        double n1 = Double.MAX_VALUE, n2 = Double.MAX_VALUE;
        double x1 = -Double.MAX_VALUE, x2 = -Double.MAX_VALUE;
        for (int i = 0; i + 1 < pts.length; i += 2) {
            if (pts[i] < n1) n1 = pts[i];
            if (pts[i] > x1) x1 = pts[i];
            if (pts[i + 1] < n2) n2 = pts[i + 1];
            if (pts[i + 1] > x2) x2 = pts[i + 1];
        }
        minLat = n1; maxLat = x1; minLon = n2; maxLon = x2;
    }

    public int size() { return cum.length; }

    public double lat(int i) { return pts[i * 2]; }
    public double lon(int i) { return pts[i * 2 + 1]; }

    /** Total traced length in metres. */
    public double length() {
        return cum.length == 0 ? 0 : cum[cum.length - 1];
    }

    public boolean isEmpty() {
        return cum.length < 2;
    }

    public boolean usesWay(long wayId) {
        for (int i = 0; i < wayIds.length; i++) if (wayIds[i] == wayId) return true;
        return false;
    }

    // ------------------------------------------------------------------- grid

    private void buildGrid() {
        int segs = size() - 1;
        if (segs < 1) { cellStart = new int[1]; cellSegs = new int[0]; gridW = gridH = 0; return; }

        gridW = (int) Math.min(MAX_GRID_SIDE, Math.floor((maxLon - minLon) / GRID_DEG) + 1);
        gridH = (int) Math.min(MAX_GRID_SIDE, Math.floor((maxLat - minLat) / GRID_DEG) + 1);
        if (gridW < 1) gridW = 1;
        if (gridH < 1) gridH = 1;
        int cells = gridW * gridH;

        // Pass 1: count segment references per cell.
        int[] counts = new int[cells + 1];
        for (int s = 0; s < segs; s++) {
            int c0 = colOf(Math.min(lon(s), lon(s + 1)));
            int c1 = colOf(Math.max(lon(s), lon(s + 1)));
            int r0 = rowOf(Math.min(lat(s), lat(s + 1)));
            int r1 = rowOf(Math.max(lat(s), lat(s + 1)));
            for (int r = r0; r <= r1; r++) {
                for (int c = c0; c <= c1; c++) counts[r * gridW + c + 1]++;
            }
        }
        for (int i = 1; i <= cells; i++) counts[i] += counts[i - 1];

        // Pass 2: fill.
        cellStart = counts;
        cellSegs = new int[counts[cells]];
        int[] cursor = new int[cells];
        for (int s = 0; s < segs; s++) {
            int c0 = colOf(Math.min(lon(s), lon(s + 1)));
            int c1 = colOf(Math.max(lon(s), lon(s + 1)));
            int r0 = rowOf(Math.min(lat(s), lat(s + 1)));
            int r1 = rowOf(Math.max(lat(s), lat(s + 1)));
            for (int r = r0; r <= r1; r++) {
                for (int c = c0; c <= c1; c++) {
                    int cell = r * gridW + c;
                    cellSegs[cellStart[cell] + cursor[cell]++] = s;
                }
            }
        }
    }

    private int colOf(double lon) {
        int c = (int) Math.floor((lon - minLon) / GRID_DEG);
        return c < 0 ? 0 : (c >= gridW ? gridW - 1 : c);
    }

    private int rowOf(double lat) {
        int r = (int) Math.floor((lat - minLat) / GRID_DEG);
        return r < 0 ? 0 : (r >= gridH ? gridH - 1 : r);
    }

    // -------------------------------------------------------------- projection

    /**
     * Projects a point onto the path.
     *
     * @param out two doubles: [0] distance along the path in metres,
     *            [1] perpendicular offset in metres
     * @return false when the path is too short, or the point is nowhere near it
     */
    public boolean project(double lat, double lon, double[] out) {
        if (isEmpty()) return false;
        if (cellStart == null) buildGrid();

        double bestOffset = Double.MAX_VALUE;
        double bestAlong = 0;
        boolean found = false;

        if (gridW > 0 && gridH > 0) {
            int c = colOf(lon), r = rowOf(lat);
            for (int rr = r - 1; rr <= r + 1; rr++) {
                if (rr < 0 || rr >= gridH) continue;
                for (int cc = c - 1; cc <= c + 1; cc++) {
                    if (cc < 0 || cc >= gridW) continue;
                    int cell = rr * gridW + cc;
                    for (int k = cellStart[cell]; k < cellStart[cell + 1]; k++) {
                        int s = cellSegs[k];
                        Geo.projectOnSegment(lat, lon, lat(s), lon(s), lat(s + 1), lon(s + 1), proj);
                        if (proj.distance < bestOffset) {
                            bestOffset = proj.distance;
                            bestAlong = cum[s] + proj.t * (cum[s + 1] - cum[s]);
                            found = true;
                        }
                    }
                }
            }
        }

        if (!found) {
            // Outside the grid neighbourhood: fall back to a full scan so a point
            // far off-route still gets an honest answer rather than a wrong one.
            for (int i = 0; i + 1 < size(); i++) {
                Geo.projectOnSegment(lat, lon, lat(i), lon(i), lat(i + 1), lon(i + 1), proj);
                if (proj.distance < bestOffset) {
                    bestOffset = proj.distance;
                    bestAlong = cum[i] + proj.t * (cum[i + 1] - cum[i]);
                    found = true;
                }
            }
        }
        if (!found) return false;
        out[0] = bestAlong;
        out[1] = bestOffset;
        return true;
    }

    /** Position at a given distance along the path; writes lat, lon into {@code out}. */
    public boolean pointAt(double metres, double[] out) {
        if (isEmpty()) return false;
        if (metres <= 0) { out[0] = lat(0); out[1] = lon(0); return true; }
        if (metres >= length()) {
            int last = size() - 1;
            out[0] = lat(last); out[1] = lon(last);
            return true;
        }
        int lo = 0, hi = size() - 1;
        while (lo + 1 < hi) {
            int mid = (lo + hi) >>> 1;
            if (cum[mid] <= metres) lo = mid; else hi = mid;
        }
        double span = cum[hi] - cum[lo];
        double f = span <= 0 ? 0 : (metres - cum[lo]) / span;
        out[0] = lat(lo) + (lat(hi) - lat(lo)) * f;
        out[1] = lon(lo) + (lon(hi) - lon(lo)) * f;
        return true;
    }

    /** Index of the last vertex at or before {@code metres}. */
    public int vertexBefore(double metres) {
        if (isEmpty()) return 0;
        int lo = 0, hi = size() - 1;
        while (lo + 1 < hi) {
            int mid = (lo + hi) >>> 1;
            if (cum[mid] <= metres) lo = mid; else hi = mid;
        }
        return lo;
    }

    /** Empty placeholder used before the first successful walk. */
    public static RoutePath empty() {
        return new RoutePath(new double[0], new double[0], new long[0], false, 0);
    }
}
