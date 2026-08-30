package com.trainjourney.live.map;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Handler;
import android.os.Looper;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;

/**
 * Supplies tiles to the map: memory first, then disk, then the network.
 *
 * Cached tiles come back on the calling thread so a pan over ground already
 * visited is instant and completely offline. Only a genuine miss costs a
 * request, and requests are capped at four at a time to stay a polite client of
 * a free service.
 */
public final class TileManager {

    private static final String USER_AGENT =
        "TrainJourneyLive/1.0 (Android passenger app; caches aggressively; OSM tiles)";
    private static final int CONNECT_TIMEOUT_MS = 12000;
    private static final int READ_TIMEOUT_MS = 20000;
    private static final int MAX_TILE_BYTES = 512 * 1024;
    /**
     * How long a tile that failed to load is left alone. Without this, every
     * frame would re-request it: a dead tile server or a tunnel would turn into
     * a request storm rather than a quiet gap in the map.
     */
    private static final long FAILURE_BACKOFF_MS = 45_000;

    /** Told when a tile arrives so the map can redraw. */
    public interface Callback {
        void onTileReady();
    }

    private final TileCache cache;
    private final ExecutorService pool;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Set<String> inFlight = new HashSet<String>();
    private final Map<String, Long> failedUntil = new HashMap<String, Long>();
    private Callback callback;
    private volatile boolean networkAllowed = true;
    private int pending;

    public TileManager(Context ctx) {
        this.cache = new TileCache(ctx);
        this.pool = Executors.newFixedThreadPool(4, new ThreadFactory() {
            @Override public Thread newThread(Runnable r) {
                Thread t = new Thread(r, "tile-loader");
                t.setPriority(Thread.MIN_PRIORITY + 2);
                t.setDaemon(true);
                return t;
            }
        });
        // First measurement of the on-disk store, off the UI thread.
        this.pool.execute(new Runnable() {
            @Override public void run() { cache.refreshDiskUsage(); }
        });
    }

    public void setCallback(Callback c) {
        this.callback = c;
    }

    public TileCache cache() {
        return cache;
    }

    /** Turns downloading off - cached tiles still draw. */
    public void setNetworkAllowed(boolean allowed) {
        this.networkAllowed = allowed;
    }

    public boolean isNetworkAllowed() {
        return networkAllowed;
    }

    /** Number of tiles currently being fetched, for the loading indicator. */
    public int pendingCount() {
        return pending;
    }

    /**
     * Returns the tile if it is already in memory, otherwise starts fetching it
     * and returns null. Safe to call from onDraw.
     */
    public Bitmap get(TileSource src, int z, int x, int y) {
        int span = 1 << z;
        if (z < 0 || x < 0 || y < 0 || x >= span || y >= span) return null;

        String key = TileCache.key(src, z, x, y);
        Bitmap b = cache.fromMemory(key);
        if (b != null) return b;

        if (inFlight.contains(key)) return null;
        Long until = failedUntil.get(key);
        if (until != null) {
            if (System.currentTimeMillis() < until.longValue()) return null;
            failedUntil.remove(key);
        }
        inFlight.add(key);
        pending++;
        submit(src, z, x, y, key);
        return null;
    }

    /** Peeks memory only - used when hunting for a usable parent tile. */
    public Bitmap peek(TileSource src, int z, int x, int y) {
        return cache.fromMemory(TileCache.key(src, z, x, y));
    }

    private void submit(final TileSource src, final int z, final int x, final int y,
                        final String key) {
        pool.execute(new Runnable() {
            @Override public void run() {
                Bitmap result = null;
                try {
                    result = cache.fromDisk(src, z, x, y);
                    if (result == null && networkAllowed) {
                        byte[] png = download(src.url(z, x, y));
                        if (png != null) {
                            cache.toDisk(src, z, x, y, png);
                            BitmapFactory.Options o = new BitmapFactory.Options();
                            o.inPreferredConfig = Bitmap.Config.ARGB_8888;
                            result = BitmapFactory.decodeByteArray(png, 0, png.length, o);
                        }
                    }
                } catch (Throwable ignored) {
                    // A failed tile is a blank square, never a crash.
                }
                final Bitmap bmp = result;
                main.post(new Runnable() {
                    @Override public void run() {
                        inFlight.remove(key);
                        pending = Math.max(0, pending - 1);
                        if (bmp != null) {
                            cache.putMemory(key, bmp);
                            if (callback != null) callback.onTileReady();
                        } else {
                            failedUntil.put(key, Long.valueOf(
                                    System.currentTimeMillis() + FAILURE_BACKOFF_MS));
                        }
                        if (pending == 0) trimAsync();
                    }
                });
            }
        });
    }

    private static byte[] download(String url) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setRequestProperty("User-Agent", USER_AGENT);
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(READ_TIMEOUT_MS);
            conn.setInstanceFollowRedirects(true);
            if (conn.getResponseCode() != 200) return null;

            InputStream in = new BufferedInputStream(conn.getInputStream(), 16 * 1024);
            ByteArrayOutputStream out = new ByteArrayOutputStream(32 * 1024);
            byte[] buf = new byte[8 * 1024];
            int n, total = 0;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > MAX_TILE_BYTES) return null;
                out.write(buf, 0, n);
            }
            in.close();
            return out.toByteArray();
        } catch (Throwable e) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /** Trimming touches the filesystem, so it never runs on the UI thread. */
    private void trimAsync() {
        pool.execute(new Runnable() {
            @Override public void run() { cache.trimIfNeeded(); }
        });
    }

    /** Clears the failure backoffs, e.g. when connectivity returns. */
    public void retryFailedTiles() {
        failedUntil.clear();
    }

    public void onLowMemory() {
        cache.trimMemory();
    }
}
