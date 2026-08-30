package com.trainjourney.live.map;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.LruCache;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.Arrays;
import java.util.Comparator;

/**
 * Two-level tile store: a bitmap cache in memory, PNG files on disk.
 *
 * The disk half is what makes the map usable on a train. Everything the app has
 * ever drawn stays on the phone, so the same route runs offline the second time
 * and a tunnel costs nothing. Nothing is ever fetched twice.
 */
public final class TileCache {

    /** Disk budget. Roughly a 200 km corridor at street zoom. */
    private static final long MAX_DISK_BYTES = 160L * 1024 * 1024;
    /** Trim runs are expensive, so they happen rarely and cut deep. */
    private static final double TRIM_TO = 0.75;

    private final File root;
    private final LruCache<String, Bitmap> memory;
    /** Written by the loader threads, read by the UI; -1 until first measured. */
    private volatile long diskBytesEstimate = -1;

    public TileCache(Context ctx) {
        this.root = new File(ctx.getCacheDir(), "tiles");
        if (!root.exists()) root.mkdirs();

        // An eighth of the heap: enough for a screenful plus its surroundings.
        int maxKb = (int) (Runtime.getRuntime().maxMemory() / 1024 / 8);
        this.memory = new LruCache<String, Bitmap>(Math.max(4 * 1024, maxKb)) {
            @Override protected int sizeOf(String key, Bitmap value) {
                return value.getByteCount() / 1024;
            }
        };
    }

    public static String key(TileSource src, int z, int x, int y) {
        return src.id + "/" + z + "/" + x + "/" + y;
    }

    public Bitmap fromMemory(String key) {
        return memory.get(key);
    }

    public void putMemory(String key, Bitmap bmp) {
        if (bmp != null) memory.put(key, bmp);
    }

    private File fileFor(TileSource src, int z, int x, int y) {
        return new File(root, src.id + "/" + z + "/" + x + "/" + y + ".png");
    }

    /** Reads a tile previously saved to disk, or null. */
    public Bitmap fromDisk(TileSource src, int z, int x, int y) {
        File f = fileFor(src, z, x, y);
        if (!f.exists() || f.length() == 0) return null;
        try {
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inPreferredConfig = Bitmap.Config.ARGB_8888;
            Bitmap b = BitmapFactory.decodeFile(f.getAbsolutePath(), o);
            if (b != null) f.setLastModified(System.currentTimeMillis());   // keep it fresh in LRU
            return b;
        } catch (Throwable e) {
            return null;
        }
    }

    /** Saves a freshly downloaded tile. */
    public void toDisk(TileSource src, int z, int x, int y, byte[] png) {
        File f = fileFor(src, z, x, y);
        File dir = f.getParentFile();
        if (dir != null && !dir.exists() && !dir.mkdirs()) return;
        File tmp = new File(f.getAbsolutePath() + ".tmp");
        OutputStream out = null;
        try {
            out = new FileOutputStream(tmp);
            out.write(png);
            out.close();
            out = null;
            if (!tmp.renameTo(f)) tmp.delete();
            if (diskBytesEstimate >= 0) diskBytesEstimate += png.length;
        } catch (IOException e) {
            tmp.delete();
        } finally {
            if (out != null) try { out.close(); } catch (IOException ignored) { }
        }
    }

    /**
     * Bytes currently held on disk, as last measured. Always cheap: walking the
     * cache directory can take hundreds of milliseconds once it holds thousands
     * of tiles, which is not something the UI thread can afford, so measuring
     * happens on {@link #refreshDiskUsage()} from a background thread instead.
     */
    public long diskBytes() {
        return Math.max(0, diskBytesEstimate);
    }

    /** True before the store has ever been measured. */
    public boolean diskUsageUnknown() {
        return diskBytesEstimate < 0;
    }

    /** Walks the cache directory. Must not be called on the main thread. */
    public void refreshDiskUsage() {
        diskBytesEstimate = measure(root);
    }

    private static long measure(File dir) {
        long total = 0;
        File[] kids = dir.listFiles();
        if (kids == null) return 0;
        for (int i = 0; i < kids.length; i++) {
            total += kids[i].isDirectory() ? measure(kids[i]) : kids[i].length();
        }
        return total;
    }

    /**
     * Drops the oldest tiles when the store grows past its budget.
     * Runs on a loader thread; it both measures and deletes.
     */
    public void trimIfNeeded() {
        if (diskBytesEstimate < 0) refreshDiskUsage();
        if (diskBytesEstimate <= MAX_DISK_BYTES) return;
        java.util.List<File> files = new java.util.ArrayList<File>();
        collect(root, files);
        File[] arr = files.toArray(new File[0]);
        Arrays.sort(arr, new Comparator<File>() {
            @Override public int compare(File a, File b) {
                return Long.compare(a.lastModified(), b.lastModified());
            }
        });
        long target = (long) (MAX_DISK_BYTES * TRIM_TO);
        long now = diskBytesEstimate;
        for (int i = 0; i < arr.length && now > target; i++) {
            long len = arr[i].length();
            if (arr[i].delete()) now -= len;
        }
        diskBytesEstimate = now;
    }

    private static void collect(File dir, java.util.List<File> out) {
        File[] kids = dir.listFiles();
        if (kids == null) return;
        for (int i = 0; i < kids.length; i++) {
            if (kids[i].isDirectory()) collect(kids[i], out);
            else out.add(kids[i]);
        }
    }

    /** Empties the whole tile store. */
    public void clear() {
        delete(root);
        root.mkdirs();
        memory.evictAll();
        diskBytesEstimate = 0;
    }

    private static void delete(File f) {
        File[] kids = f.listFiles();
        if (kids != null) for (int i = 0; i < kids.length; i++) delete(kids[i]);
        f.delete();
    }

    public void trimMemory() {
        memory.evictAll();
    }
}
