package com.trainjourney.live.util;

/**
 * Geodesy helpers plus the Web Mercator projection used by the map view.
 *
 * Distances are metres, angles are degrees. Over the short spans this app cares
 * about (a train is never more than a few km from the track it is on) a local
 * equirectangular plane is both accurate to well under a metre and far cheaper
 * than repeated haversine calls, so segment maths is done in that plane.
 */
public final class Geo {

    /** IUGG mean Earth radius, metres. */
    public static final double EARTH_R = 6371008.8;
    /** Metres per degree of latitude. */
    public static final double M_PER_DEG = Math.PI * EARTH_R / 180.0;

    private Geo() { }

    // ---------------------------------------------------------------- distance

    /** Great-circle distance in metres. */
    public static double distance(double lat1, double lon1, double lat2, double lon2) {
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 2 * EARTH_R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    /** Initial bearing from 1 to 2, degrees clockwise from north, 0..360. */
    public static double bearing(double lat1, double lon1, double lat2, double lon2) {
        double p1 = Math.toRadians(lat1);
        double p2 = Math.toRadians(lat2);
        double dl = Math.toRadians(lon2 - lon1);
        double y = Math.sin(dl) * Math.cos(p2);
        double x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
        return norm360(Math.toDegrees(Math.atan2(y, x)));
    }

    /** Wraps any angle into 0..360. */
    public static double norm360(double deg) {
        double d = deg % 360.0;
        return d < 0 ? d + 360.0 : d;
    }

    /** Smallest signed difference a-b, in -180..180. */
    public static double angleDelta(double a, double b) {
        double d = norm360(a - b);
        return d > 180 ? d - 360 : d;
    }

    /** Absolute angular separation, 0..180. */
    public static double angleBetween(double a, double b) {
        return Math.abs(angleDelta(a, b));
    }

    /**
     * Angular separation ignoring direction of travel along a line, 0..90.
     * A track drawn "backwards" describes the same rails, so a heading 180
     * degrees from the track heading is still perfectly aligned with it.
     */
    public static double angleBetweenUndirected(double a, double b) {
        double d = angleBetween(a, b);
        return d > 90 ? 180 - d : d;
    }

    /** Shortest-path interpolation between two bearings. */
    public static double lerpAngle(double from, double to, double t) {
        return norm360(from + angleDelta(to, from) * t);
    }

    /** Destination point travelling {@code metres} along {@code bearingDeg}. */
    public static double[] offset(double lat, double lon, double bearingDeg, double metres) {
        double dLat = metres * Math.cos(Math.toRadians(bearingDeg)) / M_PER_DEG;
        double cos = Math.max(0.01, Math.cos(Math.toRadians(lat)));
        double dLon = metres * Math.sin(Math.toRadians(bearingDeg)) / (M_PER_DEG * cos);
        return new double[]{lat + dLat, lon + dLon};
    }

    // -------------------------------------------------------- local flat plane

    /** Metres east of the origin meridian at the origin latitude. */
    public static double localX(double lon, double lonOrigin, double latOrigin) {
        return (lon - lonOrigin) * M_PER_DEG * Math.cos(Math.toRadians(latOrigin));
    }

    /** Metres north of the origin parallel. */
    public static double localY(double lat, double latOrigin) {
        return (lat - latOrigin) * M_PER_DEG;
    }

    /**
     * Perpendicular projection of P onto segment A-B, computed on a local plane
     * centred on P. Results land in the caller-supplied {@link Projection} so
     * this can run in tight loops over thousands of segments without allocating.
     */
    public static void projectOnSegment(double pLat, double pLon,
                                        double aLat, double aLon,
                                        double bLat, double bLon,
                                        Projection out) {
        double cos = Math.cos(Math.toRadians(pLat));
        double ax = (aLon - pLon) * M_PER_DEG * cos, ay = (aLat - pLat) * M_PER_DEG;
        double bx = (bLon - pLon) * M_PER_DEG * cos, by = (bLat - pLat) * M_PER_DEG;
        double dx = bx - ax, dy = by - ay;
        double len2 = dx * dx + dy * dy;

        double t;
        if (len2 < 1e-9) {
            t = 0;
        } else {
            t = -(ax * dx + ay * dy) / len2;
            if (t < 0) t = 0; else if (t > 1) t = 1;
        }
        double sx = ax + dx * t, sy = ay + dy * t;

        out.t = t;
        out.distance = Math.sqrt(sx * sx + sy * sy);
        out.lat = pLat + sy / M_PER_DEG;
        out.lon = pLon + (cos == 0 ? 0 : sx / (M_PER_DEG * cos));
        out.bearing = len2 < 1e-9 ? 0 : norm360(Math.toDegrees(Math.atan2(dx, dy)));
        out.segmentLength = Math.sqrt(len2);
    }

    /** Mutable output of {@link #projectOnSegment}. */
    public static final class Projection {
        /** Fraction along the segment, 0..1. */
        public double t;
        /** Perpendicular distance from the query point, metres. */
        public double distance;
        /** Snapped position. */
        public double lat, lon;
        /** Heading of the segment, degrees. */
        public double bearing;
        /** Length of the segment, metres. */
        public double segmentLength;
    }

    // ------------------------------------------------------------ web mercator

    /** Longitude to normalised Mercator X in 0..1. */
    public static double lonToX(double lon) {
        return (lon + 180.0) / 360.0;
    }

    /** Latitude to normalised Mercator Y in 0..1 (0 = north). */
    public static double latToY(double lat) {
        double clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
        double s = Math.sin(Math.toRadians(clamped));
        return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
    }

    /** Inverse of {@link #lonToX}. */
    public static double xToLon(double x) {
        return x * 360.0 - 180.0;
    }

    /** Inverse of {@link #latToY}. */
    public static double yToLat(double y) {
        double n = Math.PI * (1 - 2 * y);
        return Math.toDegrees(Math.atan(Math.sinh(n)));
    }

    /** Ground resolution in metres per pixel. */
    public static double metersPerPixel(double lat, double zoom, int tileSize) {
        return Math.cos(Math.toRadians(lat)) * 2 * Math.PI * EARTH_R
                / (tileSize * Math.pow(2, zoom));
    }

    /** Clamps a value into a range. */
    public static double clamp(double v, double lo, double hi) {
        return v < lo ? lo : (v > hi ? hi : v);
    }
}
