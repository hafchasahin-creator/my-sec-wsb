package com.trainjourney.live.data;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import java.util.ArrayList;
import java.util.List;

/**
 * On-device store for downloaded railway geometry.
 *
 * Mobile data on a train is unreliable, so every cell fetched from Overpass is
 * written here and read back on later journeys. Once an area has been seen the
 * app never needs the network for it again, which is the whole point: tracking
 * has to keep working in a tunnel or a dead zone.
 *
 * Geometry is packed as big-endian int32 microdegree pairs rather than text -
 * roughly eight bytes per point instead of forty, which matters for a line with
 * tens of thousands of nodes.
 */
public final class RailCache extends SQLiteOpenHelper {

    private static final String DB = "railcache.db";
    private static final int VERSION = 1;

    /** Cells older than this are refreshed when there is a connection to spare. */
    public static final long STALE_AFTER_MS = 60L * 24 * 3600 * 1000;   // 60 days

    private static final double SCALE = 1e7;

    public RailCache(Context ctx) {
        super(ctx.getApplicationContext(), DB, null, VERSION);
    }

    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE cells ("
                + "key TEXT PRIMARY KEY,"
                + "fetched_at INTEGER NOT NULL)");
        db.execSQL("CREATE TABLE stations ("
                + "id INTEGER PRIMARY KEY,"
                + "cell TEXT NOT NULL,"
                + "name TEXT,"
                + "code TEXT,"
                + "lat REAL NOT NULL,"
                + "lon REAL NOT NULL,"
                + "kind TEXT)");
        db.execSQL("CREATE TABLE ways ("
                + "id INTEGER PRIMARY KEY,"
                + "cell TEXT NOT NULL,"
                + "name TEXT,"
                + "kind TEXT,"
                + "usage TEXT,"
                + "pts BLOB NOT NULL)");
        db.execSQL("CREATE INDEX idx_stations_cell ON stations(cell)");
        db.execSQL("CREATE INDEX idx_ways_cell ON ways(cell)");
    }

    @Override public void onUpgrade(SQLiteDatabase db, int oldV, int newV) {
        db.execSQL("DROP TABLE IF EXISTS cells");
        db.execSQL("DROP TABLE IF EXISTS stations");
        db.execSQL("DROP TABLE IF EXISTS ways");
        onCreate(db);
    }

    // -------------------------------------------------------------------- read

    /** Timestamp the cell was last downloaded, or 0 if it never has been. */
    public long cellFetchedAt(String cellKey) {
        Cursor c = getReadableDatabase().rawQuery(
                "SELECT fetched_at FROM cells WHERE key=?", new String[]{cellKey});
        try {
            return c.moveToFirst() ? c.getLong(0) : 0L;
        } finally {
            c.close();
        }
    }

    public List<Station> readStations(String cellKey) {
        List<Station> out = new ArrayList<Station>();
        Cursor c = getReadableDatabase().rawQuery(
                "SELECT id,name,code,lat,lon,kind FROM stations WHERE cell=?",
                new String[]{cellKey});
        try {
            while (c.moveToNext()) {
                out.add(new Station(c.getLong(0), c.getString(1), c.getString(2),
                        c.getDouble(3), c.getDouble(4), c.getString(5)));
            }
        } finally {
            c.close();
        }
        return out;
    }

    public List<RailWay> readWays(String cellKey) {
        List<RailWay> out = new ArrayList<RailWay>();
        Cursor c = getReadableDatabase().rawQuery(
                "SELECT id,name,kind,usage,pts FROM ways WHERE cell=?",
                new String[]{cellKey});
        try {
            while (c.moveToNext()) {
                double[] pts = unpack(c.getBlob(4));
                if (pts.length >= 4) {
                    out.add(new RailWay(c.getLong(0), c.getString(1), c.getString(2),
                            c.getString(3), pts));
                }
            }
        } finally {
            c.close();
        }
        return out;
    }

    /** Total number of cells held locally - shown on the privacy/offline screen. */
    public int cellCount() {
        Cursor c = getReadableDatabase().rawQuery("SELECT COUNT(*) FROM cells", null);
        try {
            return c.moveToFirst() ? c.getInt(0) : 0;
        } finally {
            c.close();
        }
    }

    // ------------------------------------------------------------------- write

    /** Replaces everything held for one cell, in a single transaction. */
    public void writeCell(String cellKey, List<Station> stations, List<RailWay> ways) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            db.delete("stations", "cell=?", new String[]{cellKey});
            db.delete("ways", "cell=?", new String[]{cellKey});

            ContentValues v = new ContentValues();
            for (int i = 0; i < stations.size(); i++) {
                Station s = stations.get(i);
                v.clear();
                v.put("id", s.id);
                v.put("cell", cellKey);
                v.put("name", s.name);
                v.put("code", s.code);
                v.put("lat", s.lat);
                v.put("lon", s.lon);
                v.put("kind", s.kind);
                db.insertWithOnConflict("stations", null, v, SQLiteDatabase.CONFLICT_REPLACE);
            }
            for (int i = 0; i < ways.size(); i++) {
                RailWay w = ways.get(i);
                v.clear();
                v.put("id", w.id);
                v.put("cell", cellKey);
                v.put("name", w.name);
                v.put("kind", w.kind);
                v.put("usage", w.usage);
                v.put("pts", pack(w.pts));
                db.insertWithOnConflict("ways", null, v, SQLiteDatabase.CONFLICT_REPLACE);
            }
            v.clear();
            v.put("key", cellKey);
            v.put("fetched_at", System.currentTimeMillis());
            db.insertWithOnConflict("cells", null, v, SQLiteDatabase.CONFLICT_REPLACE);

            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    /** Wipes all cached map data - offered in settings, never done automatically. */
    public void clearAll() {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            db.delete("stations", null, null);
            db.delete("ways", null, null);
            db.delete("cells", null, null);
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    // ------------------------------------------------------------------ codecs

    static byte[] pack(double[] pts) {
        byte[] b = new byte[pts.length * 4];
        int o = 0;
        for (int i = 0; i < pts.length; i++) {
            int v = (int) Math.round(pts[i] * SCALE);
            b[o++] = (byte) (v >>> 24);
            b[o++] = (byte) (v >>> 16);
            b[o++] = (byte) (v >>> 8);
            b[o++] = (byte) v;
        }
        return b;
    }

    static double[] unpack(byte[] b) {
        if (b == null) return new double[0];
        double[] pts = new double[b.length / 4];
        int o = 0;
        for (int i = 0; i < pts.length; i++) {
            int v = ((b[o] & 0xFF) << 24) | ((b[o + 1] & 0xFF) << 16)
                  | ((b[o + 2] & 0xFF) << 8) | (b[o + 3] & 0xFF);
            o += 4;
            pts[i] = v / SCALE;
        }
        return pts;
    }
}
