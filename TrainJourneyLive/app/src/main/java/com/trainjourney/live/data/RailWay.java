package com.trainjourney.live.data;

/**
 * One OSM way tagged as railway track, held as a flat coordinate array.
 *
 * Map matching walks every segment of every nearby way on each GPS fix, so the
 * geometry is stored unboxed - {@code pts[2i]} is latitude, {@code pts[2i+1]}
 * longitude - to keep that loop free of object churn.
 */
public final class RailWay {

    public final long id;
    /** Line name, e.g. "Lumding-Badarpur section". May be null. */
    public final String name;
    /** OSM {@code railway} value: rail, light_rail, narrow_gauge, subway, monorail. */
    public final String kind;
    /** OSM {@code usage} value: main, branch, industrial... May be null. */
    public final String usage;
    /** Interleaved lat/lon pairs. */
    public final double[] pts;

    /** Cached bounding box, used to skip far-away ways cheaply. */
    public final double minLat, minLon, maxLat, maxLon;

    public RailWay(long id, String name, String kind, String usage, double[] pts) {
        this.id = id;
        this.name = name;
        this.kind = kind == null ? "rail" : kind;
        this.usage = usage;
        this.pts = pts;

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

    public int size() {
        return pts.length / 2;
    }

    public double lat(int i) { return pts[i * 2]; }
    public double lon(int i) { return pts[i * 2 + 1]; }

    /** Main lines are preferred over branches and sidings when matching. */
    public boolean isMainLine() {
        return usage == null || "main".equals(usage) || "branch".equals(usage);
    }

    /** True when the box could contain a point within {@code padDeg} of the way. */
    public boolean nearBox(double lat, double lon, double padDeg) {
        return lat >= minLat - padDeg && lat <= maxLat + padDeg
            && lon >= minLon - padDeg && lon <= maxLon + padDeg;
    }

    @Override public boolean equals(Object o) {
        return o instanceof RailWay && ((RailWay) o).id == id;
    }

    @Override public int hashCode() {
        return (int) (id ^ (id >>> 32));
    }
}
