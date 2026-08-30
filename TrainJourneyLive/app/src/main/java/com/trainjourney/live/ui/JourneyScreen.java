package com.trainjourney.live.ui;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import com.trainjourney.live.data.JourneyHistoryStore;
import com.trainjourney.live.engine.JourneyState;
import com.trainjourney.live.util.Fmt;
import com.trainjourney.live.util.Icons;
import com.trainjourney.live.util.Ui;

import java.util.List;

/**
 * This journey in numbers, past journeys, and what the app has stored.
 *
 * The storage section exists because the app makes a promise - everything stays
 * on the phone - and a promise the passenger cannot inspect or undo is not
 * worth much. So the cache size is shown, and clearing it is one tap.
 */
public final class JourneyScreen extends LinearLayout {

    public interface Host {
        void onClearMapCache();
        void onClearHistory();
        long cachedTileBytes();
        int cachedCellCount();
    }

    private final Host host;
    private final JourneyHistoryStore history;

    private final SummaryCard summary;
    private final TextView positionText;
    private final TextView storageText;
    private final LinearLayout historyList;
    private final TextView historyEmpty;

    public JourneyScreen(Context c, Host host) {
        super(c);
        this.host = host;
        this.history = new JourneyHistoryStore(c);
        setOrientation(VERTICAL);
        setBackgroundColor(Ui.PAGE_BG);

        LinearLayout header = Views.column(c);
        header.setBackgroundColor(Ui.NAVY_DEEP);
        header.setPadding(Ui.dpi(16), Ui.dpi(14), Ui.dpi(16), Ui.dpi(14));
        header.addView(Views.text(c, "Journey", 19, Ui.WHITE, Ui.bold()));
        TextView sub = Views.text(c, "Everything below is stored only on this phone",
                12.5f, 0xFF8FA6C6, Ui.regular());
        sub.setPadding(0, Ui.dpi(2), 0, 0);
        header.addView(sub);
        addView(header, Views.lpMatchWrap());

        ScrollView scroll = new ScrollView(c);
        scroll.setVerticalScrollBarEnabled(false);
        scroll.setClipChildren(false);
        scroll.setClipToPadding(false);
        LinearLayout col = Views.column(c);
        col.setClipChildren(false);
        col.setClipToPadding(false);
        col.setPadding(Ui.dpi(14), Ui.dpi(14), Ui.dpi(14), Ui.dpi(20));

        summary = new SummaryCard(c);
        col.addView(summary, Views.lp(LayoutParams.MATCH_PARENT, Ui.dpi(196)));
        col.addView(Views.spacer(c, 14));

        // ---- live position ----
        LinearLayout posCard = card(c, "Live position");
        positionText = Views.text(c, "Waiting for GPS", 13.5f, Ui.TEXT_DIM, Ui.regular());
        positionText.setLineSpacing(Ui.dp(4), 1f);
        posCard.addView(positionText);
        col.addView(posCard, Views.lpMatchWrap());
        col.addView(Views.spacer(c, 14));

        // ---- storage / privacy ----
        LinearLayout dataCard = card(c, "Offline data and privacy");
        storageText = Views.text(c, "", 13.5f, Ui.TEXT_DIM, Ui.regular());
        storageText.setLineSpacing(Ui.dp(4), 1f);
        dataCard.addView(storageText);
        dataCard.addView(Views.spacer(c, 14));

        LinearLayout buttons = Views.row(c);
        PillButton clearMaps = new PillButton(c, "Clear saved maps", 0xFFEDF1F7, Ui.TEXT);
        clearMaps.setOnClickListener(new OnClickListener() {
            @Override public void onClick(View v) {
                JourneyScreen.this.host.onClearMapCache();
                refreshStorage();
            }
        });
        PillButton clearHistory = new PillButton(c, "Clear history", 0xFFEDF1F7, Ui.TEXT);
        clearHistory.setOnClickListener(new OnClickListener() {
            @Override public void onClick(View v) {
                history.clear();
                JourneyScreen.this.host.onClearHistory();
                refreshHistory();
            }
        });
        LinearLayout.LayoutParams b1 = new LinearLayout.LayoutParams(0, Ui.dpi(46), 1);
        b1.rightMargin = Ui.dpi(10);
        buttons.addView(clearMaps, b1);
        buttons.addView(clearHistory, new LinearLayout.LayoutParams(0, Ui.dpi(46), 1));
        dataCard.addView(buttons, Views.lpMatchWrap());
        col.addView(dataCard, Views.lpMatchWrap());
        col.addView(Views.spacer(c, 14));

        // ---- past journeys ----
        LinearLayout histCard = card(c, "Past journeys");
        historyEmpty = Views.text(c,
                "Finished journeys are listed here after you tap End Journey.",
                13.5f, Ui.TEXT_DIM, Ui.regular());
        histCard.addView(historyEmpty);
        historyList = Views.column(c);
        histCard.addView(historyList, Views.lpMatchWrap());
        col.addView(histCard, Views.lpMatchWrap());

        scroll.addView(col, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        addView(scroll, new LayoutParams(LayoutParams.MATCH_PARENT, 0, 1));

        refreshHistory();
    }

    private LinearLayout card(Context c, String title) {
        LinearLayout l = Views.column(c);
        l.setBackground(Views.rounded(Ui.CARD, Ui.dp(20)));
        l.setElevation(Ui.dp(3));
        l.setPadding(Ui.dpi(18), Ui.dpi(16), Ui.dpi(18), Ui.dpi(18));
        TextView t = Views.text(c, title, 15, Ui.TEXT, Ui.bold());
        t.setPadding(0, 0, 0, Ui.dpi(10));
        l.addView(t);
        return l;
    }

    public void bind(JourneyState s) {
        summary.bind(s);

        StringBuilder sb = new StringBuilder();
        if (!s.hasFix) {
            sb.append("Waiting for a GPS fix.");
        } else {
            sb.append(String.format(java.util.Locale.US, "%.5f, %.5f", s.rawLat, s.rawLon));
            sb.append("\nAccuracy ").append(Fmt.accuracy(s.accuracy)).append(" m");
            if (s.snapped) {
                sb.append("\nMatched to a railway line (")
                  .append(Math.round(s.snapConfidence * 100)).append("% confidence)");
                if (s.lineName != null && !s.lineName.isEmpty()) {
                    sb.append("\nLine: ").append(s.lineName);
                }
            } else {
                sb.append("\nNot matched to a line - showing your raw GPS position");
            }
        }
        positionText.setText(sb.toString());
        refreshStorage();
    }

    private void refreshStorage() {
        long bytes = host.cachedTileBytes();
        int cells = host.cachedCellCount();
        String size = bytes < 1024 * 1024
                ? Math.max(0, bytes / 1024) + " KB"
                : String.format(java.util.Locale.US, "%.1f MB", bytes / 1048576.0);
        storageText.setText(
                "Saved map imagery: " + size + "\n"
              + "Saved railway areas: " + cells + "\n\n"
              + "This app has no account and no server. Your position, your route and your "
              + "journey history never leave this device. The only network requests it makes "
              + "are for public OpenStreetMap map tiles and railway geometry, which are then "
              + "cached here so the same area works offline next time.");
    }

    /** Adds a finished journey to the local history. */
    public void recordJourney(JourneyState s) {
        JourneyHistoryStore.Entry e = new JourneyHistoryStore.Entry();
        e.startedAt = s.startedAt;
        e.endedAt = System.currentTimeMillis();
        e.distanceMetres = s.distanceTravelled;
        e.durationMillis = s.elapsedMillis;
        e.maxSpeed = s.maxSpeed;
        int visited = 0;
        String first = null, last = null;
        for (int i = 0; i < s.stops.size(); i++) {
            JourneyState.StopView v = s.stops.get(i);
            if (v.arrivedAt > 0) {
                visited++;
                if (first == null) first = v.station.name;
                last = v.station.name;
            }
        }
        e.stationCount = visited;
        e.from = first == null ? "" : first;
        e.to = last == null ? "" : last;
        history.add(e);
        refreshHistory();
    }

    private void refreshHistory() {
        historyList.removeAllViews();
        List<JourneyHistoryStore.Entry> all = history.load();
        historyEmpty.setVisibility(all.isEmpty() ? VISIBLE : GONE);

        Context c = getContext();
        for (int i = 0; i < all.size(); i++) {
            JourneyHistoryStore.Entry e = all.get(i);
            LinearLayout row = Views.column(c);
            row.setPadding(0, Ui.dpi(10), 0, Ui.dpi(10));

            String route;
            if (!e.from.isEmpty() && !e.to.isEmpty() && !e.from.equals(e.to)) {
                route = e.from + "  to  " + e.to;
            } else if (!e.from.isEmpty()) {
                route = "From " + e.from;
            } else {
                route = "Journey";
            }
            row.addView(Views.text(c, route, 14.5f, Ui.TEXT, Ui.medium()));
            TextView meta = Views.text(c,
                    Fmt.date(e.startedAt) + "  -  " + Fmt.distance(e.distanceMetres)
                    + "  -  " + Fmt.duration(e.durationMillis)
                    + "  -  " + e.stationCount + " stations",
                    12.5f, Ui.TEXT_FAINT, Ui.regular());
            meta.setPadding(0, Ui.dpi(3), 0, 0);
            row.addView(meta);
            historyList.addView(row, Views.lpMatchWrap());

            if (i < all.size() - 1) {
                View d = new View(c);
                d.setBackgroundColor(Ui.DIVIDER);
                historyList.addView(d, Views.lp(LayoutParams.MATCH_PARENT, Ui.dpi(1)));
            }
        }
    }

    /** The four headline numbers for the journey in progress. */
    private static final class SummaryCard extends View {
        private final Paint bg = Ui.fill(Ui.NAVY_CARD);
        private final Paint label = Ui.text(0xFF8FA6C6, Ui.sp(11.5f), Ui.medium());
        private final Paint value = Ui.text(Ui.WHITE, Ui.sp(25), Ui.black());
        private final Paint unit = Ui.text(0xFF8FA6C6, Ui.sp(12), Ui.medium());
        private final Paint divider = Ui.fill(0xFF1E3F69);
        private final Path path = new Path();

        private String[] values = {"--", "00:00:00", "--", "--"};
        private String[] units = {"km", "", "km/h", "km/h"};
        private final String[] labels = {"Distance", "Duration", "Average", "Top speed"};

        SummaryCard(Context c) {
            super(c);
        }

        void bind(JourneyState s) {
            values[0] = Fmt.distanceValue(s.distanceTravelled);
            units[0] = Fmt.distanceUnit(s.distanceTravelled);
            values[1] = Fmt.duration(s.elapsedMillis);
            values[2] = Fmt.speed(s.meanSpeed());
            values[3] = Fmt.speed(s.maxSpeed);
            invalidate();
        }

        @Override protected void onDraw(Canvas canvas) {
            float r = Ui.dp(20);
            canvas.drawRoundRect(0, 0, getWidth(), getHeight(), r, r, bg);

            float half = getWidth() / 2f;
            float mid = getHeight() / 2f;
            canvas.drawRect(half - Ui.dp(0.5f), Ui.dp(22),
                    half + Ui.dp(0.5f), getHeight() - Ui.dp(22), divider);
            canvas.drawRect(Ui.dp(22), mid - Ui.dp(0.5f),
                    getWidth() - Ui.dp(22), mid + Ui.dp(0.5f), divider);

            for (int i = 0; i < 4; i++) {
                float x = (i % 2 == 0 ? Ui.dp(22) : half + Ui.dp(22));
                float y = (i < 2 ? Ui.dp(20) : mid + Ui.dp(20));
                canvas.drawText(labels[i], x, y + Ui.dp(14), label);
                float baseline = y + Ui.dp(48);
                canvas.drawText(values[i], x, baseline, value);
                if (!units[i].isEmpty()) {
                    canvas.drawText(" " + units[i],
                            x + value.measureText(values[i]), baseline, unit);
                }
                Paint g = Icons.iconStroke(
                        i == 0 ? Ui.BLUE_LIGHT : i == 1 ? Ui.PURPLE
                        : i == 2 ? Ui.ORANGE : Ui.RED, Ui.dp(1.8f));
                float gcx = (i % 2 == 0 ? half : getWidth()) - Ui.dp(26);
                float gcy = y + Ui.dp(30);
                switch (i) {
                    case 0: canvas.drawPath(Icons.road(path, gcx, gcy, Ui.dp(20)), g); break;
                    case 1: canvas.drawPath(Icons.clock(path, gcx, gcy, Ui.dp(20)), g); break;
                    case 2: canvas.drawPath(Icons.gaugeAverage(path, gcx, gcy, Ui.dp(20)), g); break;
                    default: canvas.drawPath(Icons.gaugeMax(path, gcx, gcy, Ui.dp(20)), g); break;
                }
            }
        }
    }
}
