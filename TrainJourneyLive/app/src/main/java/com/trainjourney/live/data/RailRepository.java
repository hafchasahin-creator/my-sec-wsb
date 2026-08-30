package com.trainjourney.live.data;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.util.Log;

import com.trainjourney.live.data.RailIndex.CellContent;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Keeps the railway world around the train loaded, cache first.
 *
 * The globe is cut into fixed 0.25 degree cells (about 28 km). As the train
 * moves the repository makes sure the cell under it and its neighbours are in
 * memory: the local database is consulted first and answers instantly offline,
 * and only genuinely missing cells go to the network - one at a time, cells
 * ahead of the train first, because Overpass is a shared free service.
 */
public final class RailRepository {

    private static final String TAG = "RailRepo";

    /** Cell size in degrees. Small enough for a quick query, big enough to be rare. */
    public static final double CELL_DEG = 0.25;
    /** Cells kept in memory at once; beyond this the least recently touched is dropped. */
    private static final int MAX_CELLS_IN_MEMORY = 24;
    /** Consecutive failures before a cell is left alone for a while. */
    private static final int MAX_ATTEMPTS = 3;
    private static final long RETRY_BACKOFF_MS = 60_000L;

    /** Told whenever the loaded world changes. Always called on the main thread. */
    public interface Listener {
        void onRailDataChanged(RailIndex index);
        void onLoadStateChanged(boolean loading, String message);
    }

    private final Context ctx;
    private final RailCache cache;
    private final Handler worker;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<Listener> listeners = new ArrayList<Listener>();

    /** Cell key -> content, in access order so eviction is a single call. */
    private final LinkedHashMap<String, CellContent> loaded =
            new LinkedHashMap<String, CellContent>(32, 0.75f, true);
    private final Set<String> queued = new HashSet<String>();
    private final ArrayDeque<String> queue = new ArrayDeque<String>();
    private final Map<String, Integer> attempts = new HashMap<String, Integer>();
    private final Map<String, Long> cooldown = new HashMap<String, Long>();

    private volatile RailIndex index = RailIndex.EMPTY;
    private volatile boolean busy;
    private volatile String status = "";

    public RailRepository(Context context) {
        this.ctx = context.getApplicationContext();
        this.cache = new RailCache(this.ctx);
        HandlerThread t = new HandlerThread("rail-loader", android.os.Process.THREAD_PRIORITY_BACKGROUND);
        t.start();
        this.worker = new Handler(t.getLooper());
    }

    /** The current snapshot. Safe to read from any thread. */
    public RailIndex index() {
        return index;
    }

    public boolean isLoading() {
        return busy || !queue.isEmpty();
    }

    public String statusMessage() {
        return status;
    }

    public int cachedCellCount() {
        return cache.cellCount();
    }

    public void addListener(Listener l) {
        if (!listeners.contains(l)) listeners.add(l);
    }

    public void removeListener(Listener l) {
        listeners.remove(l);
    }

    // ------------------------------------------------------------------ cells

    public static int cellIndexLat(double lat) {
        return (int) Math.floor(lat / CELL_DEG);
    }

    public static int cellIndexLon(double lon) {
        return (int) Math.floor(lon / CELL_DEG);
    }

    public static String cellKey(int i, int j) {
        return i + "_" + j;
    }

    /**
     * Makes sure the cell under the train and the ring around it are available,
     * ordering the queue so whatever lies ahead is fetched first.
     *
     * @param headingDeg current course, or NaN when the train is not moving yet
     */
    public void ensureCoverage(final double lat, final double lon, final double headingDeg) {
        final int ci = cellIndexLat(lat);
        final int cj = cellIndexLon(lon);

        List<String> wanted = new ArrayList<String>(9);
        wanted.add(cellKey(ci, cj));

        // Neighbours, sorted so the ones the train is heading into come first.
        List<int[]> ring = new ArrayList<int[]>(8);
        for (int di = -1; di <= 1; di++) {
            for (int dj = -1; dj <= 1; dj++) {
                if (di == 0 && dj == 0) continue;
                ring.add(new int[]{di, dj});
            }
        }
        if (!Double.isNaN(headingDeg)) {
            final double hx = Math.sin(Math.toRadians(headingDeg));   // east component
            final double hy = Math.cos(Math.toRadians(headingDeg));   // north component
            java.util.Collections.sort(ring, new java.util.Comparator<int[]>() {
                @Override public int compare(int[] a, int[] b) {
                    double sa = a[1] * hx + a[0] * hy;
                    double sb = b[1] * hx + b[0] * hy;
                    return Double.compare(sb, sa);   // most aligned first
                }
            });
        }
        for (int i = 0; i < ring.size(); i++) {
            int[] d = ring.get(i);
            wanted.add(cellKey(ci + d[0], cj + d[1]));
        }

        for (int i = 0; i < wanted.size(); i++) enqueue(wanted.get(i));
        pump();
    }

    private void enqueue(String key) {
        if (loaded.containsKey(key) || queued.contains(key)) return;
        Long until = cooldown.get(key);
        if (until != null && System.currentTimeMillis() < until.longValue()) return;
        queued.add(key);
        queue.addLast(key);
    }

    private void pump() {
        if (busy || queue.isEmpty()) return;
        final String key = queue.pollFirst();
        busy = true;
        publishLoadState(true, "Loading railway data");
        worker.post(new Runnable() {
            @Override public void run() {
                loadCell(key);
            }
        });
    }

    /** Runs on the loader thread: cache first, network only if that came up empty. */
    private void loadCell(String key) {
        CellContent content = null;
        String message = null;
        try {
            long fetchedAt = cache.cellFetchedAt(key);
            if (fetchedAt > 0) {
                content = new CellContent(key, cache.readWays(key), cache.readStations(key));
            } else if (isOnline()) {
                int[] ij = parseKey(key);
                double south = ij[0] * CELL_DEG;
                double west = ij[1] * CELL_DEG;
                OverpassClient.CellData d =
                        OverpassClient.fetch(south, west, south + CELL_DEG, west + CELL_DEG);
                cache.writeCell(key, d.stations, d.ways);
                content = new CellContent(key, d.ways, d.stations);
            } else {
                message = "Offline - using saved map data";
            }
        } catch (Throwable e) {
            Log.w(TAG, "cell " + key + " failed: " + e);
            message = "Could not download railway data";
        }

        final CellContent result = content;
        final String msg = message;
        final String cellKey = key;
        main.post(new Runnable() {
            @Override public void run() {
                onCellFinished(cellKey, result, msg);
            }
        });
    }

    /** Main thread: publish the new world, then start the next fetch. */
    private void onCellFinished(String key, CellContent content, String message) {
        queued.remove(key);
        busy = false;

        if (content != null) {
            attempts.remove(key);
            cooldown.remove(key);
            loaded.put(key, content);
            while (loaded.size() > MAX_CELLS_IN_MEMORY) {
                java.util.Iterator<String> it = loaded.keySet().iterator();
                if (!it.hasNext()) break;
                it.next();
                it.remove();      // eldest by access order
            }
            index = RailIndex.merge(loaded.values());
            for (int i = 0; i < listeners.size(); i++) {
                listeners.get(i).onRailDataChanged(index);
            }
        } else {
            Integer prev = attempts.get(key);
            int n = (prev == null ? 0 : prev.intValue()) + 1;
            attempts.put(key, Integer.valueOf(n));
            if (n >= MAX_ATTEMPTS) {
                cooldown.put(key, Long.valueOf(System.currentTimeMillis() + RETRY_BACKOFF_MS));
                attempts.remove(key);
            } else {
                queue.addLast(key);      // try again after the others
                queued.add(key);
            }
        }

        publishLoadState(!queue.isEmpty(), message);
        pump();
    }

    private void publishLoadState(boolean loading, String message) {
        status = message == null ? (loading ? "Loading railway data" : "") : message;
        for (int i = 0; i < listeners.size(); i++) {
            listeners.get(i).onLoadStateChanged(loading, status);
        }
    }

    private static int[] parseKey(String key) {
        int u = key.indexOf('_');
        return new int[]{Integer.parseInt(key.substring(0, u)),
                         Integer.parseInt(key.substring(u + 1))};
    }

    private boolean isOnline() {
        try {
            ConnectivityManager cm =
                    (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return false;
            NetworkInfo ni = cm.getActiveNetworkInfo();
            return ni != null && ni.isConnected();
        } catch (Throwable e) {
            return true;    // if we cannot tell, let the request decide
        }
    }

    /** Forgets every downloaded cell. Offered in the app, never automatic. */
    public void clearCache() {
        worker.post(new Runnable() {
            @Override public void run() {
                cache.clearAll();
                main.post(new Runnable() {
                    @Override public void run() {
                        loaded.clear();
                        index = RailIndex.EMPTY;
                        for (int i = 0; i < listeners.size(); i++) {
                            listeners.get(i).onRailDataChanged(index);
                        }
                    }
                });
            }
        });
    }
}
