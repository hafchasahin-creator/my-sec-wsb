package com.trainjourney.live.ui;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import com.trainjourney.live.data.Station;
import com.trainjourney.live.engine.JourneyState;
import com.trainjourney.live.util.Fmt;
import com.trainjourney.live.util.Icons;
import com.trainjourney.live.util.Ui;

import java.util.ArrayList;
import java.util.List;

/**
 * Every station on the route, with the option to name one as the destination.
 *
 * Choosing a destination is what resolves a fork the app refuses to guess at,
 * so this screen is also the answer to "which way is this train going".
 */
public final class StationsScreen extends LinearLayout {

    public interface Host {
        void onDestinationChosen(Station s);
        void onDestinationCleared();
    }

    private final ListView list;
    private final TextView subtitle;
    private final TextView empty;
    private final Host host;

    public StationsScreen(Context c, Host host) {
        super(c);
        this.host = host;
        setOrientation(VERTICAL);
        setBackgroundColor(Ui.PAGE_BG);

        LinearLayout header = Views.column(c);
        header.setBackgroundColor(Ui.NAVY_DEEP);
        header.setPadding(Ui.dpi(16), Ui.dpi(14), Ui.dpi(16), Ui.dpi(14));
        header.addView(Views.text(c, "Stations", 19, Ui.WHITE, Ui.bold()));
        subtitle = Views.text(c, "Tap a station to set it as your destination",
                12.5f, 0xFF8FA6C6, Ui.regular());
        subtitle.setPadding(0, Ui.dpi(2), 0, 0);
        header.addView(subtitle);
        addView(header, Views.lpMatchWrap());

        ScrollView scroll = new ScrollView(c);
        scroll.setVerticalScrollBarEnabled(false);
        scroll.setClipChildren(false);
        scroll.setClipToPadding(false);
        LinearLayout inner = Views.column(c);
        inner.setClipChildren(false);
        inner.setClipToPadding(false);
        inner.setPadding(Ui.dpi(14), Ui.dpi(14), Ui.dpi(14), Ui.dpi(18));

        LinearLayout card = Views.column(c);
        card.setBackground(Views.rounded(Ui.CARD, Ui.dp(20)));
        card.setElevation(Ui.dp(3));
        card.setPadding(0, Ui.dpi(6), 0, Ui.dpi(6));

        list = new ListView(c, host);
        card.addView(list, Views.lpMatchWrap());

        empty = Views.text(c,
                "No stations yet.\n\nThey appear as soon as the app has matched you to a "
              + "railway line and downloaded the stations around it.",
                14, Ui.TEXT_DIM, Ui.regular());
        empty.setPadding(Ui.dpi(20), Ui.dpi(24), Ui.dpi(20), Ui.dpi(30));
        empty.setGravity(Gravity.CENTER_HORIZONTAL);
        empty.setLineSpacing(Ui.dp(4), 1f);
        card.addView(empty, Views.lpMatchWrap());

        inner.addView(card, Views.lpMatchWrap());
        scroll.addView(inner, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        addView(scroll, new LayoutParams(LayoutParams.MATCH_PARENT, 0, 1));
    }

    public void bind(JourneyState s) {
        list.bind(s);
        boolean none = list.isEmpty();
        list.setVisibility(none ? GONE : VISIBLE);
        empty.setVisibility(none ? VISIBLE : GONE);

        if (s.chosenDestination != null) {
            subtitle.setText("Destination: " + s.chosenDestination.name + " - tap to change");
        } else if (s.needsRouteChoice) {
            subtitle.setText("The line splits ahead - pick where you are heading");
        } else {
            subtitle.setText("Tap a station to set it as your destination");
        }
    }

    /** A tappable, canvas-drawn list of the stations on the route. */
    private static final class ListView extends View {

        private static final float ROW_DP = 66;

        private final Paint divider = Ui.fill(Ui.DIVIDER);
        private final Paint name = Ui.text(Ui.TEXT, Ui.sp(16), Ui.medium());
        private final Paint sub = Ui.text(Ui.TEXT_FAINT, Ui.sp(12), Ui.regular());
        private final Paint dist = Ui.text(Ui.TEXT_DIM, Ui.sp(14), Ui.bold());
        private final Paint chipText = Ui.textCentered(Ui.WHITE, Ui.sp(10.5f), Ui.bold());
        private final Paint chipBg = Ui.fill(Ui.BLUE);
        private final Paint dotDone = Ui.fill(Ui.GREEN);
        private final Paint dotFill = Ui.fill(Ui.WHITE);
        private final Paint dotRing = Ui.stroke(0xFFB6C0CE, Ui.dp(2f));
        private final Paint dotNext = Ui.stroke(Ui.BLUE, Ui.dp(2.6f));
        private final Paint check = Ui.stroke(Ui.WHITE, Ui.dp(1.8f));
        private final Paint pressBg = Ui.fill(0x111E6FE8);
        private final Path path = new Path();
        private final RectF rect = new RectF();

        private final List<JourneyState.StopView> rows = new ArrayList<JourneyState.StopView>();
        private long destinationId;
        private int pressedRow = -1;
        private final Host host;

        ListView(Context c, Host host) {
            super(c);
            this.host = host;
            chipText.setLetterSpacing(0.05f);
            setClickable(true);
        }

        void bind(JourneyState s) {
            rows.clear();
            rows.addAll(s.stops);
            destinationId = s.chosenDestination == null ? 0 : s.chosenDestination.id;
            requestLayout();
            invalidate();
        }

        boolean isEmpty() {
            return rows.isEmpty();
        }

        @Override protected void onMeasure(int wSpec, int hSpec) {
            setMeasuredDimension(MeasureSpec.getSize(wSpec),
                    Math.max(1, Math.round(rows.size() * Ui.dp(ROW_DP))));
        }

        @Override public boolean onTouchEvent(MotionEvent e) {
            int row = (int) (e.getY() / Ui.dp(ROW_DP));
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    pressedRow = (row >= 0 && row < rows.size()) ? row : -1;
                    invalidate();
                    return true;
                case MotionEvent.ACTION_UP:
                    if (pressedRow >= 0 && pressedRow == row && row < rows.size()) {
                        Station st = rows.get(row).station;
                        if (st.id == destinationId) host.onDestinationCleared();
                        else host.onDestinationChosen(st);
                        performClick();
                    }
                    pressedRow = -1;
                    invalidate();
                    return true;
                case MotionEvent.ACTION_CANCEL:
                    pressedRow = -1;
                    invalidate();
                    return true;
                default:
                    return true;
            }
        }

        @Override public boolean performClick() {
            return super.performClick();
        }

        @Override protected void onDraw(Canvas canvas) {
            float rowH = Ui.dp(ROW_DP);
            float dotX = Ui.dp(30);
            float textX = Ui.dp(56);
            float right = getWidth() - Ui.dp(18);

            for (int i = 0; i < rows.size(); i++) {
                JourneyState.StopView v = rows.get(i);
                float top = i * rowH;
                float cy = top + rowH / 2f;

                if (i == pressedRow) {
                    canvas.drawRect(0, top, getWidth(), top + rowH, pressBg);
                }
                if (i > 0) {
                    canvas.drawRect(textX, top, getWidth() - Ui.dp(16), top + Ui.dp(1), divider);
                }

                boolean passed = v.state == JourneyState.StopView.PASSED
                              || v.state == JourneyState.StopView.ARRIVED;
                boolean isNext = v.state == JourneyState.StopView.NEXT
                              || v.state == JourneyState.StopView.ARRIVED;
                float r = Ui.dp(7);
                if (passed) {
                    canvas.drawCircle(dotX, cy, r, dotDone);
                    canvas.drawPath(Icons.check(path, dotX, cy, Ui.dp(9)), check);
                } else {
                    canvas.drawCircle(dotX, cy, r, dotFill);
                    canvas.drawCircle(dotX, cy, r, isNext ? dotNext : dotRing);
                }

                boolean isDest = v.station.id == destinationId;

                // Right-hand column first, so the name knows how much room it has.
                float trailingLeft = right;
                if (isDest) {
                    String chip = "DESTINATION";
                    float w = chipText.measureText(chip) + Ui.dp(18);
                    rect.set(right - w, cy - Ui.dp(10), right, cy + Ui.dp(10));
                    chipBg.setColor(Ui.GREEN_DEEP);
                    Ui.pill(canvas, rect, chipBg);
                    Ui.drawTextCentredV(canvas, chip, rect.centerX(), cy, chipText);
                    trailingLeft = rect.left - Ui.dp(10);
                } else if (isNext) {
                    String chip = "NEXT";
                    float w = chipText.measureText(chip) + Ui.dp(18);
                    rect.set(right - w, cy - Ui.dp(10), right, cy + Ui.dp(10));
                    chipBg.setColor(Ui.BLUE);
                    Ui.pill(canvas, rect, chipBg);
                    Ui.drawTextCentredV(canvas, chip, rect.centerX(), cy, chipText);
                    trailingLeft = rect.left - Ui.dp(10);
                } else {
                    String d = passed ? "Passed" : Fmt.distance(Math.max(0, v.distance));
                    dist.setColor(passed ? Ui.TEXT_FAINT : Ui.TEXT_DIM);
                    dist.setTextAlign(Paint.Align.RIGHT);
                    canvas.drawText(d, right, cy + Ui.dp(5), dist);
                    dist.setTextAlign(Paint.Align.LEFT);
                    trailingLeft = right - dist.measureText(d) - Ui.dp(10);
                }

                float available = Math.max(Ui.dp(70), trailingLeft - textX);
                name.setColor(passed ? Ui.TEXT_DIM : Ui.TEXT);
                canvas.drawText(Ui.ellipsize(v.station.name, name, available),
                        textX, cy - Ui.dp(2), name);

                String detail = v.station.isMajor() ? "Station" : "Halt";
                if (v.station.code != null && !v.station.code.isEmpty()) {
                    detail = v.station.code + "  -  " + detail;
                }
                if (passed && v.arrivedAt > 0) {
                    detail = "Called at " + Fmt.clock(v.arrivedAt);
                }
                canvas.drawText(Ui.ellipsize(detail, sub, available),
                        textX, cy + Ui.dp(15), sub);
            }
        }
    }
}
