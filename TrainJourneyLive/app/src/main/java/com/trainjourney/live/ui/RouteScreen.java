package com.trainjourney.live.ui;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import com.trainjourney.live.engine.JourneyState;
import com.trainjourney.live.util.Fmt;
import com.trainjourney.live.util.Icons;
import com.trainjourney.live.util.Ui;

/**
 * The whole route on one screen: a timeline from the first station called at to
 * the last one known ahead, with live speed and ETA pinned underneath.
 */
public final class RouteScreen extends LinearLayout {

    public interface Host {
        void onOpenMap();
    }

    private final RouteTimelineView timeline;
    private final ScrollView scroll;
    private final FooterView footer;
    private final TextView emptyText;
    private final TextView lineText;
    private boolean autoScrolled;

    public RouteScreen(Context c, Host host) {
        super(c);
        setOrientation(VERTICAL);
        setBackgroundColor(Ui.PAGE_BG);

        // ---- header ----
        LinearLayout header = Views.row(c);
        header.setBackgroundColor(Ui.NAVY_DEEP);
        header.setPadding(Ui.dpi(16), Ui.dpi(14), Ui.dpi(16), Ui.dpi(14));

        LinearLayout titles = Views.column(c);
        titles.addView(Views.text(c, "Route", 19, Ui.WHITE, Ui.bold()));
        lineText = Views.text(c, "Following your GPS", 12.5f, 0xFF8FA6C6, Ui.regular());
        lineText.setPadding(0, Ui.dpi(2), 0, 0);
        titles.addView(lineText);
        header.addView(titles, Views.lpWeighted(1));

        CircleButton mapBtn = new CircleButton(c, CircleButton.ICON_LOCATE, Ui.WHITE);
        mapBtn.setColours(0xFF17325C, Ui.WHITE);
        final Host h = host;
        mapBtn.setOnClickListener(new OnClickListener() {
            @Override public void onClick(View v) { h.onOpenMap(); }
        });
        header.addView(mapBtn, Views.lp(Ui.dpi(42), Ui.dpi(42)));
        addView(header, Views.lpMatchWrap());

        // ---- timeline card ----
        scroll = new ScrollView(c);
        scroll.setVerticalScrollBarEnabled(false);
        scroll.setClipChildren(false);
        scroll.setClipToPadding(false);

        LinearLayout inner = Views.column(c);
        inner.setClipChildren(false);
        inner.setClipToPadding(false);
        inner.setPadding(Ui.dpi(14), Ui.dpi(14), Ui.dpi(14), Ui.dpi(14));

        LinearLayout card = Views.column(c);
        card.setBackground(Views.rounded(Ui.CARD, Ui.dp(20)));
        card.setElevation(Ui.dp(3));
        card.setPadding(Ui.dpi(6), Ui.dpi(10), Ui.dpi(6), Ui.dpi(10));

        timeline = new RouteTimelineView(c);
        card.addView(timeline, Views.lpMatchWrap());

        emptyText = Views.text(c,
                "Waiting for the railway line under you.\n\n"
              + "Once your position settles on a track, every station ahead appears here "
              + "in order, with the train moving down the list as you travel.",
                14, Ui.TEXT_DIM, Ui.regular());
        emptyText.setPadding(Ui.dpi(20), Ui.dpi(24), Ui.dpi(20), Ui.dpi(30));
        emptyText.setGravity(Gravity.CENTER_HORIZONTAL);
        emptyText.setLineSpacing(Ui.dp(4), 1f);
        card.addView(emptyText, Views.lpMatchWrap());

        inner.addView(card, Views.lpMatchWrap());
        scroll.addView(inner, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        addView(scroll, new LayoutParams(LayoutParams.MATCH_PARENT, 0, 1));

        // ---- footer ----
        footer = new FooterView(c);
        addView(footer, Views.lp(LayoutParams.MATCH_PARENT, Ui.dpi(74)));
    }

    public void bind(JourneyState s) {
        timeline.bind(s);
        boolean empty = timeline.isEmpty();
        timeline.setVisibility(empty ? View.GONE : View.VISIBLE);
        emptyText.setVisibility(empty ? View.VISIBLE : View.GONE);

        if (s.lineName != null && !s.lineName.isEmpty()) {
            lineText.setText(s.lineName);
        } else if (s.snapped) {
            lineText.setText("On a mapped railway line");
        } else if (s.hasFix) {
            lineText.setText("Following your GPS");
        } else {
            lineText.setText("Waiting for GPS");
        }

        footer.bind(s);

        // Bring the train into view the first time there is a route to show.
        if (!empty && !autoScrolled) {
            autoScrolled = true;
            scroll.post(new Runnable() {
                @Override public void run() {
                    scroll.smoothScrollTo(0, Math.max(0,
                            timeline.trainOffsetPx() - scroll.getHeight() / 3));
                }
            });
        }
        if (empty) autoScrolled = false;
    }

    /** Speed and ETA, always visible under the list. */
    private static final class FooterView extends View {
        private final Paint bg = Ui.fill(Ui.CARD);
        private final Paint divider = Ui.fill(Ui.DIVIDER);
        private final Paint label = Ui.text(Ui.TEXT_DIM, Ui.sp(11.5f), Ui.medium());
        private final Paint value = Ui.text(Ui.TEXT, Ui.sp(19), Ui.black());
        private final Paint unit = Ui.text(Ui.TEXT_DIM, Ui.sp(11.5f), Ui.medium());
        private final Path path = new Path();
        private final RectF rect = new RectF();

        private String speed = "--", eta = "--";

        FooterView(Context c) {
            super(c);
        }

        void bind(JourneyState s) {
            speed = Fmt.speed(s.speed);
            eta = Fmt.eta(s.etaSeconds());
            invalidate();
        }

        @Override protected void onDraw(Canvas canvas) {
            rect.set(0, 0, getWidth(), getHeight());
            canvas.drawRect(rect, bg);
            canvas.drawRect(0, 0, getWidth(), Ui.dp(1), divider);

            float half = getWidth() / 2f;
            canvas.drawRect(half - Ui.dp(0.5f), Ui.dp(16),
                    half + Ui.dp(0.5f), getHeight() - Ui.dp(16), divider);

            drawCell(canvas, Ui.dp(20), "Current Speed", speed, "km/h", Ui.GREEN, true);
            drawCell(canvas, half + Ui.dp(20), "ETA to Next",
                    "--".equals(eta) ? "--" : "~" + eta, "", Ui.BLUE, false);
        }

        private void drawCell(Canvas canvas, float x, String head, String v, String u,
                              int tint, boolean gauge) {
            float gcy = getHeight() / 2f;
            Paint g = Icons.iconStroke(tint, Ui.dp(1.9f));
            float gs = Ui.dp(22);
            canvas.drawPath(gauge
                    ? Icons.gaugeCurrent(path, x + gs / 2, gcy, gs)
                    : Icons.clock(path, x + gs / 2, gcy, gs), g);

            float tx = x + gs + Ui.dp(12);
            canvas.drawText(head, tx, gcy - Ui.dp(6), label);
            canvas.drawText(v, tx, gcy + Ui.dp(18), value);
            if (!u.isEmpty()) {
                canvas.drawText(" " + u, tx + value.measureText(v), gcy + Ui.dp(18), unit);
            }
        }
    }
}
