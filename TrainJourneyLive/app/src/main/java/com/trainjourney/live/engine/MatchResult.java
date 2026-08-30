package com.trainjourney.live.engine;

import com.trainjourney.live.data.RailWay;

/** Where the map matcher thinks the train is, and how sure it is. */
public final class MatchResult {

    /** True when the fix was confidently placed on a railway line. */
    public boolean matched;
    /** The line the train is running on, or null. */
    public RailWay way;
    /** Index of the segment within {@link #way}. */
    public int segment;
    /** Fraction along that segment, 0..1. */
    public double t;
    /** Snapped position - what the train icon is drawn at. */
    public double lat, lon;
    /** Heading of the track at the snapped point, degrees. */
    public double trackBearing;
    /** Perpendicular distance from the raw fix to the line, metres. */
    public double offset;
    /** 0..1. Below {@link MapMatcher#ACCEPT_CONFIDENCE} the raw GPS point is used instead. */
    public double confidence;
    /** +1 when travelling in the way's node order, -1 against it, 0 when unknown. */
    public int direction;

    public void copyFrom(MatchResult o) {
        matched = o.matched;
        way = o.way;
        segment = o.segment;
        t = o.t;
        lat = o.lat;
        lon = o.lon;
        trackBearing = o.trackBearing;
        offset = o.offset;
        confidence = o.confidence;
        direction = o.direction;
    }

    public void clear() {
        matched = false;
        way = null;
        segment = 0;
        t = 0;
        confidence = 0;
        direction = 0;
        offset = Double.NaN;
    }
}
