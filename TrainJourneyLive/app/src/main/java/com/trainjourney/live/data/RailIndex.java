package com.trainjourney.live.data;

import com.trainjourney.live.util.Geo;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * An immutable snapshot of every railway feature currently held in memory.
 *
 * The matcher and the renderer both read this on their own threads while the
 * loader keeps downloading, so the repository swaps a whole new index in rather
 * than mutating shared lists. Readers never need a lock and never see a
 * half-built world.
 */
public final class RailIndex {

    public static final RailIndex EMPTY =
            new RailIndex(new ArrayList<RailWay>(), new ArrayList<Station>());

    public final List<RailWay> ways;
    public final List<Station> stations;

    public RailIndex(List<RailWay> ways, List<Station> stations) {
        this.ways = ways;
        this.stations = stations;
    }

    public boolean isEmpty() {
        return ways.isEmpty() && stations.isEmpty();
    }

    /** Builds an index from per-cell contents, de-duplicating features on cell seams. */
    public static RailIndex merge(Collection<CellContent> cells) {
        Map<Long, RailWay> w = new HashMap<Long, RailWay>();
        Map<Long, Station> s = new HashMap<Long, Station>();
        for (CellContent c : cells) {
            for (int i = 0; i < c.ways.size(); i++) {
                RailWay way = c.ways.get(i);
                w.put(Long.valueOf(way.id), way);
            }
            for (int i = 0; i < c.stations.size(); i++) {
                Station st = c.stations.get(i);
                s.put(Long.valueOf(st.id), st);
            }
        }
        return new RailIndex(new ArrayList<RailWay>(w.values()),
                             new ArrayList<Station>(s.values()));
    }

    /** Stations within {@code metres} of a point, nearest first. */
    public List<Station> stationsWithin(double lat, double lon, double metres) {
        List<Station> out = new ArrayList<Station>();
        double padDeg = metres / Geo.M_PER_DEG * 1.5;
        for (int i = 0; i < stations.size(); i++) {
            Station st = stations.get(i);
            if (Math.abs(st.lat - lat) > padDeg) continue;
            if (Geo.distance(lat, lon, st.lat, st.lon) <= metres) out.add(st);
        }
        return out;
    }

    /** The single closest station, or null when none is in range. */
    public Station nearestStation(double lat, double lon, double maxMetres) {
        Station best = null;
        double bestD = maxMetres;
        for (int i = 0; i < stations.size(); i++) {
            Station st = stations.get(i);
            double d = Geo.distance(lat, lon, st.lat, st.lon);
            if (d < bestD) { bestD = d; best = st; }
        }
        return best;
    }

    /** One cell's worth of features, as read from cache or network. */
    public static final class CellContent {
        public final String key;
        public final List<RailWay> ways;
        public final List<Station> stations;

        public CellContent(String key, List<RailWay> ways, List<Station> stations) {
            this.key = key;
            this.ways = ways;
            this.stations = stations;
        }
    }
}
