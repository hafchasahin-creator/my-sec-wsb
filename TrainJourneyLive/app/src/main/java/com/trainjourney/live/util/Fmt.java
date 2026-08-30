package com.trainjourney.live.util;

import java.util.Locale;

/** Human-readable formatting for the numbers shown all over the UI. */
public final class Fmt {

    private Fmt() { }

    /** "820 m", "6.4 km", "142 km" - the granularity a passenger actually wants. */
    public static String distance(double metres) {
        if (Double.isNaN(metres) || metres < 0) return "--";
        if (metres < 950) return Math.round(metres / 10.0) * 10 + " m";
        double km = metres / 1000.0;
        if (km < 10) return String.format(Locale.US, "%.1f km", km);
        return String.format(Locale.US, "%.0f km", km);
    }

    /** Distance split for the two-part readouts (value and unit drawn separately). */
    public static String distanceValue(double metres) {
        if (Double.isNaN(metres) || metres < 0) return "--";
        if (metres < 950) return String.valueOf(Math.round(metres / 10.0) * 10);
        double km = metres / 1000.0;
        return km < 10 ? String.format(Locale.US, "%.1f", km) : String.format(Locale.US, "%.0f", km);
    }

    public static String distanceUnit(double metres) {
        return (!Double.isNaN(metres) && metres < 950) ? "m" : "km";
    }

    /** Speed in km/h with no decimals - trains do not need them. */
    public static String speed(double metresPerSecond) {
        if (Double.isNaN(metresPerSecond) || metresPerSecond < 0) return "--";
        return String.valueOf(Math.round(metresPerSecond * 3.6));
    }

    /** "~7 min", "~1 h 12 min", or "--" when there is nothing sensible to say. */
    public static String eta(double seconds) {
        if (Double.isNaN(seconds) || seconds <= 0 || seconds > 24 * 3600) return "--";
        long mins = Math.round(seconds / 60.0);
        if (mins < 1) return "<1 min";
        if (mins < 60) return mins + " min";
        long h = mins / 60, m = mins % 60;
        return m == 0 ? h + " h" : h + " h " + m + " min";
    }

    /** Elapsed journey time as HH:MM:SS. */
    public static String duration(long millis) {
        if (millis < 0) millis = 0;
        long total = millis / 1000;
        long h = total / 3600, m = (total % 3600) / 60, s = total % 60;
        return String.format(Locale.US, "%02d:%02d:%02d", h, m, s);
    }

    /** Wall-clock time of day, e.g. "08:42 AM". */
    public static String clock(long epochMillis) {
        if (epochMillis <= 0) return "--:--";
        java.util.Calendar c = java.util.Calendar.getInstance();
        c.setTimeInMillis(epochMillis);
        int h24 = c.get(java.util.Calendar.HOUR_OF_DAY);
        int h = h24 % 12; if (h == 0) h = 12;
        return String.format(Locale.US, "%02d:%02d %s", h, c.get(java.util.Calendar.MINUTE),
                h24 < 12 ? "AM" : "PM");
    }

    /** Short date for the journey history list. */
    public static String date(long epochMillis) {
        java.util.Calendar c = java.util.Calendar.getInstance();
        c.setTimeInMillis(epochMillis);
        String[] months = {"Jan", "Feb", "Mar", "Apr", "May", "Jun",
                           "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};
        return c.get(java.util.Calendar.DAY_OF_MONTH) + " "
                + months[c.get(java.util.Calendar.MONTH)] + " "
                + c.get(java.util.Calendar.YEAR);
    }

    /** GPS accuracy readout. */
    public static String accuracy(float metres) {
        if (metres <= 0) return "--";
        return String.valueOf(Math.round(metres));
    }

    /** Title-cases a station name that arrived in a shouty form. */
    public static String cleanName(String raw) {
        if (raw == null) return "";
        String s = raw.trim();
        if (s.isEmpty()) return s;
        boolean allUpper = s.equals(s.toUpperCase(Locale.US)) && s.length() > 3;
        if (!allUpper) return s;
        StringBuilder sb = new StringBuilder(s.length());
        boolean start = true;
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            if (start && Character.isLetter(ch)) {
                sb.append(Character.toUpperCase(ch));
                start = false;
            } else if (Character.isLetter(ch)) {
                sb.append(Character.toLowerCase(ch));
            } else {
                sb.append(ch);
                start = true;
            }
        }
        return sb.toString();
    }
}
