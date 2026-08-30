package com.trainjourney.live.ui;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.view.MotionEvent;
import android.view.View;

import com.trainjourney.live.util.Icons;
import com.trainjourney.live.util.Ui;

/** The four-tab bar along the bottom: Map, Route, Stations, Journey. */
public final class BottomNav extends View {

    public static final int TAB_MAP = 0;
    public static final int TAB_ROUTE = 1;
    public static final int TAB_STATIONS = 2;
    public static final int TAB_JOURNEY = 3;
    private static final String[] LABELS = {"Map", "Route", "Stations", "Journey"};

    public interface Listener {
        void onTabSelected(int tab);
    }

    private final Paint bg = Ui.fill(Ui.NAVY_DEEP);
    private final Paint hairline = Ui.fill(0xFF1B3055);
    private final Paint activeGlyph = Icons.iconStroke(Ui.BLUE_LIGHT, Ui.dp(2f));
    private final Paint idleGlyph = Icons.iconStroke(0xFF7F90AB, Ui.dp(1.9f));
    private final Paint activeText = Ui.textCentered(Ui.BLUE_LIGHT, Ui.sp(11), Ui.medium());
    private final Paint idleText = Ui.textCentered(0xFF7F90AB, Ui.sp(11), Ui.regular());
    private final Paint indicator = Ui.fill(Ui.BLUE_LIGHT);
    private final Path path = new Path();

    private int selected = TAB_MAP;
    private float indicatorX = -1;
    private Listener listener;
    private int bottomInset;

    public BottomNav(Context c) {
        super(c);
        setClickable(true);
    }

    public void setListener(Listener l) {
        this.listener = l;
    }

    public void setBottomInset(int px) {
        this.bottomInset = px;
        requestLayout();
    }

    public int selected() {
        return selected;
    }

    public void select(int tab) {
        if (tab == selected) return;
        selected = tab;
        invalidate();
        if (listener != null) listener.onTabSelected(tab);
    }

    @Override protected void onMeasure(int wSpec, int hSpec) {
        int w = MeasureSpec.getSize(wSpec);
        setMeasuredDimension(w, Ui.dpi(62) + bottomInset);
    }

    @Override public boolean onTouchEvent(MotionEvent e) {
        if (e.getActionMasked() == MotionEvent.ACTION_UP) {
            int tab = (int) (e.getX() / (getWidth() / 4f));
            if (tab < 0) tab = 0;
            if (tab > 3) tab = 3;
            select(tab);
            performClick();
        }
        return true;
    }

    @Override public boolean performClick() {
        return super.performClick();
    }

    @Override protected void onDraw(Canvas canvas) {
        canvas.drawRect(0, 0, getWidth(), getHeight(), bg);
        canvas.drawRect(0, 0, getWidth(), Ui.dp(1), hairline);

        float cellW = getWidth() / 4f;
        float contentH = getHeight() - bottomInset;
        float iconCy = contentH * 0.40f;
        float textY = contentH * 0.82f;

        // The little bar above the active tab slides rather than jumps.
        float targetX = cellW * selected + cellW / 2f;
        if (indicatorX < 0) indicatorX = targetX;
        else if (Math.abs(indicatorX - targetX) > 0.5f) {
            indicatorX += (targetX - indicatorX) * 0.28f;
            postInvalidateOnAnimation();
        } else {
            indicatorX = targetX;
        }
        canvas.drawRoundRect(indicatorX - Ui.dp(15), 0, indicatorX + Ui.dp(15), Ui.dp(3),
                Ui.dp(2), Ui.dp(2), indicator);

        for (int i = 0; i < 4; i++) {
            float cx = cellW * i + cellW / 2f;
            boolean on = i == selected;
            Paint g = on ? activeGlyph : idleGlyph;
            float size = Ui.dp(23);
            switch (i) {
                case TAB_MAP:      canvas.drawPath(Icons.map(path, cx, iconCy, size), g); break;
                case TAB_ROUTE:    canvas.drawPath(Icons.route(path, cx, iconCy, size), g); break;
                case TAB_STATIONS: canvas.drawPath(Icons.stationsTab(path, cx, iconCy, size), g); break;
                default:           canvas.drawPath(Icons.journey(path, cx, iconCy, size), g); break;
            }
            canvas.drawText(LABELS[i], cx, textY, on ? activeText : idleText);
        }
    }
}
