package com.trainjourney.live.ui;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.view.View;

import com.trainjourney.live.engine.JourneyState;
import com.trainjourney.live.util.Fmt;
import com.trainjourney.live.util.Icons;
import com.trainjourney.live.util.Ui;

/**
 * The six-up readout under the map: speed, distance, time, averages, accuracy.
 *
 * Each cell is label, value, unit, glyph - the same rhythm in every one, so the
 * grid can be read at a glance on a moving train rather than parsed.
 */
public final class StatsPanel extends View {

    private static final int CELLS = 6;

    private final Paint card = Ui.fill(Ui.CARD);
    private final Paint label = Ui.textCentered(Ui.TEXT_DIM, Ui.sp(11), Ui.medium());
    private final Paint value = Ui.textCentered(Ui.TEXT, Ui.sp(23), Ui.black());
    private final Paint unit = Ui.textCentered(Ui.TEXT_DIM, Ui.sp(11.5f), Ui.medium());
    private final Paint divider = Ui.fill(Ui.DIVIDER);
    private final RectF rect = new RectF();
    private final Path path = new Path();

    private final String[] labels = {
        "Current Speed", "Distance Travelled", "Journey Time",
        "Avg. Speed", "Max. Speed", "GPS Accuracy"
    };
    private final String[] values = new String[CELLS];
    private final String[] units = new String[CELLS];
    private final int[] tints = {
        Ui.GREEN, Ui.BLUE, Ui.PURPLE, Ui.ORANGE, Ui.RED, Ui.GREEN_DEEP
    };

    public StatsPanel(Context c) {
        super(c);
        for (int i = 0; i < CELLS; i++) { values[i] = "--"; units[i] = ""; }
        Ui.elevate(this, Ui.dp(20), Ui.dp(6));
    }

    public void bind(JourneyState s) {
        values[0] = Fmt.speed(s.speed);                       units[0] = "km/h";
        values[1] = Fmt.distanceValue(s.distanceTravelled);   units[1] = Fmt.distanceUnit(s.distanceTravelled);
        values[2] = Fmt.duration(s.elapsedMillis);            units[2] = "";
        values[3] = Fmt.speed(s.meanSpeed());                 units[3] = "km/h";
        values[4] = Fmt.speed(s.maxSpeed);                    units[4] = "km/h";
        values[5] = Fmt.accuracy(s.accuracy);                 units[5] = "m";
        invalidate();
    }

    @Override protected void onMeasure(int wSpec, int hSpec) {
        setMeasuredDimension(MeasureSpec.getSize(wSpec), Ui.dpi(178));
    }

    @Override protected void onDraw(Canvas canvas) {
        rect.set(0, 0, getWidth(), getHeight());
        float radius = Ui.dp(20);
        canvas.drawRoundRect(rect, radius, radius, card);

        float cellW = rect.width() / 3f;
        float cellH = rect.height() / 2f;

        // Column rules, inset so they read as separators not a table.
        for (int i = 1; i < 3; i++) {
            float x = rect.left + cellW * i;
            canvas.drawRect(x - Ui.dp(0.5f), rect.top + Ui.dp(18),
                    x + Ui.dp(0.5f), rect.top + cellH - Ui.dp(10), divider);
            canvas.drawRect(x - Ui.dp(0.5f), rect.top + cellH + Ui.dp(10),
                    x + Ui.dp(0.5f), rect.bottom - Ui.dp(18), divider);
        }
        canvas.drawRect(rect.left + Ui.dp(20), rect.top + cellH - Ui.dp(0.5f),
                rect.right - Ui.dp(20), rect.top + cellH + Ui.dp(0.5f), divider);

        for (int i = 0; i < CELLS; i++) {
            int col = i % 3, row = i / 3;
            float cx = rect.left + cellW * col + cellW / 2f;
            float cy = rect.top + cellH * row;
            drawCell(canvas, i, cx, cy, cellH, cellW);
        }
    }

    private void drawCell(Canvas canvas, int i, float cx, float top, float h, float w) {
        canvas.drawText(Ui.ellipsize(labels[i], label, w - Ui.dp(8)),
                cx, top + Ui.dp(24), label);

        // Value and unit are drawn as one centred run so they stay visually paired.
        String v = values[i];
        String u = units[i];
        float vw = value.measureText(v);
        float uw = u.isEmpty() ? 0 : unit.measureText(" " + u);
        float startX = cx - (vw + uw) / 2f;

        value.setTextAlign(Paint.Align.LEFT);
        unit.setTextAlign(Paint.Align.LEFT);
        float baseline = top + Ui.dp(54);
        canvas.drawText(v, startX, baseline, value);
        if (!u.isEmpty()) canvas.drawText(" " + u, startX + vw, baseline, unit);
        value.setTextAlign(Paint.Align.CENTER);
        unit.setTextAlign(Paint.Align.CENTER);

        float gcy = top + Ui.dp(70);
        float size = Ui.dp(20);
        Paint g = Icons.iconStroke(tints[i], Ui.dp(1.9f));
        switch (i) {
            case 0: canvas.drawPath(Icons.gaugeCurrent(path, cx, gcy, size), g); break;
            case 1: canvas.drawPath(Icons.road(path, cx, gcy, size), g); break;
            case 2: canvas.drawPath(Icons.clock(path, cx, gcy, size), g); break;
            case 3: canvas.drawPath(Icons.gaugeAverage(path, cx, gcy, size), g); break;
            case 4: canvas.drawPath(Icons.gaugeMax(path, cx, gcy, size), g); break;
            default: canvas.drawPath(Icons.gpsAccuracy(path, cx, gcy, size), g); break;
        }
    }
}
