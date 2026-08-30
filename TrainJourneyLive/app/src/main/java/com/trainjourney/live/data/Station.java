package com.trainjourney.live.data;

import com.trainjourney.live.util.Fmt;

/**
 * A real railway station, halt or stop taken from OpenStreetMap.
 *
 * Nothing here is synthesised: id, name and position all come straight from the
 * OSM object, so what the app shows is what surveyors actually mapped.
 */
public final class Station {

    /** OSM element id, namespaced by type so node/way/relation ids cannot collide. */
    public final long id;
    /** Display name, tidied from the raw {@code name} tag. */
    public final String name;
    /** Operator's station code, e.g. "SCL". May be null. */
    public final String code;
    public final double lat;
    public final double lon;
    /** OSM {@code railway} value: station, halt or stop. */
    public final String kind;

    /**
     * How far along the current route plan this station sits, in metres from the
     * train. Recomputed on every fix; not part of the station's identity.
     */
    public double alongDistance = Double.NaN;
    /** Perpendicular distance from the station to the matched railway line. */
    public double offTrack = Double.NaN;

    public Station(long id, String name, String code, double lat, double lon, String kind) {
        this.id = id;
        this.name = Fmt.cleanName(name);
        this.code = code;
        this.lat = lat;
        this.lon = lon;
        this.kind = kind == null ? "station" : kind;
    }

    /** Halts and stops are minor; full stations get more prominence on the map. */
    public boolean isMajor() {
        return "station".equals(kind);
    }

    /** Geofence radius in metres - wider for big stations, which are physically longer. */
    public double geofenceRadius() {
        return isMajor() ? 320 : 200;
    }

    /** Name plus code, for the stations list. */
    public String label() {
        if (code == null || code.isEmpty()) return name;
        return name + " (" + code + ")";
    }

    @Override public boolean equals(Object o) {
        return o instanceof Station && ((Station) o).id == id;
    }

    @Override public int hashCode() {
        return (int) (id ^ (id >>> 32));
    }

    @Override public String toString() {
        return "Station{" + name + "@" + lat + "," + lon + "}";
    }
}
