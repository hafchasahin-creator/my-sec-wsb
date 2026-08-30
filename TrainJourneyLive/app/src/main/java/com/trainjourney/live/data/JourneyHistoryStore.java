package com.trainjourney.live.data;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.JsonReader;
import android.util.JsonWriter;

import java.io.IOException;
import java.io.StringReader;
import java.io.StringWriter;
import java.util.ArrayList;
import java.util.List;

/**
 * Completed journeys, kept on this phone only.
 *
 * The app has no account, no server and no analytics, so history is written to
 * the app's own private preferences and never leaves the device. Only the
 * summary is stored - where and when, how far, how fast - not the trace of
 * every position, which is the part that would actually be sensitive.
 */
public final class JourneyHistoryStore {

    private static final String PREFS = "journeys";
    private static final String KEY = "entries";
    private static final int MAX_ENTRIES = 60;

    /** One finished journey. */
    public static final class Entry {
        public long startedAt;
        public long endedAt;
        public double distanceMetres;
        public long durationMillis;
        public double maxSpeed;
        public String from = "";
        public String to = "";
        public int stationCount;
    }

    private final SharedPreferences prefs;

    public JourneyHistoryStore(Context ctx) {
        this.prefs = ctx.getApplicationContext()
                .getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public List<Entry> load() {
        List<Entry> out = new ArrayList<Entry>();
        String raw = prefs.getString(KEY, null);
        if (raw == null || raw.isEmpty()) return out;
        JsonReader r = new JsonReader(new StringReader(raw));
        try {
            r.beginArray();
            while (r.hasNext()) {
                Entry e = new Entry();
                r.beginObject();
                while (r.hasNext()) {
                    String k = r.nextName();
                    if ("startedAt".equals(k)) e.startedAt = r.nextLong();
                    else if ("endedAt".equals(k)) e.endedAt = r.nextLong();
                    else if ("distance".equals(k)) e.distanceMetres = r.nextDouble();
                    else if ("duration".equals(k)) e.durationMillis = r.nextLong();
                    else if ("maxSpeed".equals(k)) e.maxSpeed = r.nextDouble();
                    else if ("from".equals(k)) e.from = r.nextString();
                    else if ("to".equals(k)) e.to = r.nextString();
                    else if ("stations".equals(k)) e.stationCount = r.nextInt();
                    else r.skipValue();
                }
                r.endObject();
                out.add(e);
            }
            r.endArray();
        } catch (Throwable ignored) {
            // A corrupt store is not worth crashing over; start clean.
            return new ArrayList<Entry>();
        } finally {
            try { r.close(); } catch (IOException ignored) { }
        }
        return out;
    }

    /** Adds a journey, newest first, trimming the oldest beyond the cap. */
    public void add(Entry e) {
        List<Entry> all = load();
        all.add(0, e);
        while (all.size() > MAX_ENTRIES) all.remove(all.size() - 1);
        save(all);
    }

    public void clear() {
        prefs.edit().remove(KEY).apply();
    }

    private void save(List<Entry> all) {
        StringWriter sw = new StringWriter();
        JsonWriter w = new JsonWriter(sw);
        try {
            w.beginArray();
            for (int i = 0; i < all.size(); i++) {
                Entry e = all.get(i);
                w.beginObject();
                w.name("startedAt").value(e.startedAt);
                w.name("endedAt").value(e.endedAt);
                w.name("distance").value(e.distanceMetres);
                w.name("duration").value(e.durationMillis);
                w.name("maxSpeed").value(e.maxSpeed);
                w.name("from").value(e.from == null ? "" : e.from);
                w.name("to").value(e.to == null ? "" : e.to);
                w.name("stations").value(e.stationCount);
                w.endObject();
            }
            w.endArray();
            w.close();
            prefs.edit().putString(KEY, sw.toString()).apply();
        } catch (IOException ignored) {
            // Losing one history entry is preferable to interrupting a journey.
        }
    }
}
