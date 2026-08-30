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

import java.util.ArrayList;
import java.util.List;

/**
 * The route as a vertical timeline, with the train sliding down it.
 *
 * Stations already called at are ticked, the one coming up is highlighted, and
 * a "you are here" marker is inserted at the train's real position between them
 * - so the whole journey reads top to bottom the way a passenger thinks about it.
 */
public final class RouteTimelineView extends View {

    private static final float ROW_DP = 58;
    private static final float TRAIN_ROW_DP = 62;

    private final Paint lineDone = Ui.stroke(Ui.GREEN, Ui.dp(2.6f));
    private final Paint lineTodo = Ui.stroke(0xFFD3DAE4, Ui.dp(2.6f));
    private final Paint dotDone = Ui.fill(Ui.GREEN);
    private final Paint dotTodoFill = Ui.fill(Ui.WHITE);
    private final Paint dotTodoRing = Ui.stroke(0xFFB6C0CE, Ui.dp(2.2f));
    private final Paint dotNextRing = Ui.stroke(Ui.BLUE, Ui.dp(2.8f));
    private final Paint tick = Ui.stroke(Ui.WHITE, Ui.dp(2f));
    private final Paint checkCircle = Ui.fill(Ui.GREEN);
    private final Paint checkMark = Ui.stroke(Ui.WHITE, Ui.dp(1.9f));

    private final Paint namePassed = Ui.text(Ui.TEXT, Ui.sp(16), Ui.medium());
    private final Paint nameNext = Ui.text(Ui.BLUE, Ui.sp(17), Ui.bold());
    private final Paint nameTodo = Ui.text(Ui.TEXT, Ui.sp(16), Ui.regular());
    private final Paint caption = Ui.text(Ui.BLUE, Ui.sp(11), Ui.medium());
    private final Paint captionDim = Ui.text(Ui.TEXT_FAINT, Ui.sp(11), Ui.regular());
    private final Paint trailing = Ui.text(Ui.TEXT_DIM, Ui.sp(13.5f), Ui.medium());
    private final Paint trailingStrong = Ui.text(Ui.TEXT, Ui.sp(14), Ui.bold());
    private final Paint youAreHere = Ui.text(Ui.BLUE, Ui.sp(15.5f), Ui.bold());
    private final Paint trainGlyph = Ui.fill(Ui.BLUE);
    private final Paint trainHalo = Ui.fill(Ui.alpha(Ui.BLUE, 0.14f));

    private final Path path = new Path();
    private final RectF rect = new RectF();

    /** One drawn line of the timeline. */
    private static final class Row {
        JourneyState.StopView stop;
        boolean isTrain;
        boolean isDestination;
    }

    private final List<Row> rows = new ArrayList<Row>();
    private int trainRowIndex = -1;

    public RouteTimelineView(Context c) {
        super(c);
        caption.setLetterSpacing(0.06f);
        youAreHere.setLetterSpacing(0.04f);
    }

    /** Rebuilds the row list from the journey. */
    public void bind(JourneyState s) {
        rows.clear();
        trainRowIndex = -1;

        long destId = s.chosenDestination == null ? 0 : s.chosenDestination.id;
        boolean trainPlaced = false;

        for (int i = 0; i < s.stops.size(); i++) {
            JourneyState.StopView v = s.stops.get(i);

            // The train sits just before the first station still ahead.
            if (!trainPlaced && v.distance > 0 && s.hasFix) {
                Row t = new Row();
                t.isTrain = true;
                trainRowIndex = rows.size();
                rows.add(t);
                trainPlaced = true;
            }

            Row r = new Row();
            r.stop = v;
            r.isDestination = destId != 0 && v.station.id == destId;
            rows.add(r);

            if (r.isDestination) break;      // the journey ends here
        }

        if (!trainPlaced && s.hasFix && !rows.isEmpty()) {
            Row t = new Row();
            t.isTrain = true;
            trainRowIndex = rows.size();
            rows.add(t);
        }
        requestLayout();
        invalidate();
    }

    public boolean isEmpty() {
        return rows.isEmpty();
    }

    /** Vertical offset of the train marker, for auto-scrolling. */
    public int trainOffsetPx() {
        if (trainRowIndex < 0) return 0;
        return Math.round(trainRowIndex * Ui.dp(ROW_DP));
    }

    @Override protected void onMeasure(int wSpec, int hSpec) {
        int w = MeasureSpec.getSize(wSpec);
        float h = Ui.dp(10);
        for (int i = 0; i < rows.size(); i++) {
            h += rows.get(i).isTrain ? Ui.dp(TRAIN_ROW_DP) : Ui.dp(ROW_DP);
        }
        setMeasuredDimension(w, Math.max(Ui.dpi(80), Math.round(h + Ui.dp(10))));
    }

    @Override protected void onDraw(Canvas canvas) {
        if (rows.isEmpty()) return;

        float railX = Ui.dp(30);
        float textX = Ui.dp(58);
        float rightEdge = getWidth() - Ui.dp(18);
        float y = Ui.dp(10);

        for (int i = 0; i < rows.size(); i++) {
            Row r = rows.get(i);
            float rowH = r.isTrain ? Ui.dp(TRAIN_ROW_DP) : Ui.dp(ROW_DP);
            float cy = y + rowH / 2f;

            // Connector to the next row.
            boolean doneHere = r.isTrain
                    || (r.stop != null && r.stop.state == JourneyState.StopView.PASSED)
                    || (r.stop != null && r.stop.state == JourneyState.StopView.ARRIVED);
            if (i < rows.size() - 1) {
                float nextH = rows.get(i + 1).isTrain ? Ui.dp(TRAIN_ROW_DP) : Ui.dp(ROW_DP);
                float ny = y + rowH + nextH / 2f;
                canvas.drawLine(railX, cy + Ui.dp(11), railX, ny - Ui.dp(11),
                        doneHere ? lineDone : lineTodo);
            }

            if (r.isTrain) {
                drawTrainRow(canvas, railX, textX, rightEdge, cy);
            } else {
                drawStationRow(canvas, r, railX, textX, rightEdge, cy);
            }
            y += rowH;
        }
    }

    private void drawTrainRow(Canvas canvas, float railX, float textX, float rightEdge, float cy) {
        canvas.drawCircle(railX, cy, Ui.dp(17), trainHalo);
        canvas.drawPath(Icons.trainSide(path, railX, cy, Ui.dp(23)), trainGlyph);
        canvas.drawText("YOU ARE HERE", textX, cy + Ui.dp(5.5f), youAreHere);

        String now = Fmt.clock(System.currentTimeMillis());
        trailing.setTextAlign(Paint.Align.RIGHT);
        canvas.drawText(now, rightEdge, cy + Ui.dp(5), trailing);
        trailing.setTextAlign(Paint.Align.LEFT);
    }

    private void drawStationRow(Canvas canvas, Row r, float railX, float textX,
                                float rightEdge, float cy) {
        JourneyState.StopView v = r.stop;
        boolean passed = v.state == JourneyState.StopView.PASSED
                      || v.state == JourneyState.StopView.ARRIVED;
        boolean isNext = v.state == JourneyState.StopView.NEXT
                      || v.state == JourneyState.StopView.ARRIVED;

        float dotR = Ui.dp(7.5f);
        if (passed) {
            canvas.drawCircle(railX, cy, dotR, dotDone);
        } else {
            canvas.drawCircle(railX, cy, dotR, dotTodoFill);
            canvas.drawCircle(railX, cy, dotR, isNext ? dotNextRing : dotTodoRing);
            if (isNext) {
                dotNextRing.setAlpha(60);
                canvas.drawCircle(railX, cy, dotR + Ui.dp(5), dotNextRing);
                dotNextRing.setAlpha(255);
            }
        }

        // Right-hand column: a tick and the call time once visited, distance before.
        float trailingLeft = rightEdge;
        if (passed && v.arrivedAt > 0) {
            float ccx = rightEdge - Ui.dp(9);
            canvas.drawCircle(ccx, cy, Ui.dp(9), checkCircle);
            canvas.drawPath(Icons.check(path, ccx, cy, Ui.dp(11)), checkMark);
            trailingLeft = ccx - Ui.dp(16);

            trailing.setTextAlign(Paint.Align.RIGHT);
            canvas.drawText(Fmt.clock(v.arrivedAt), trailingLeft, cy + Ui.dp(5), trailing);
            trailing.setTextAlign(Paint.Align.LEFT);
            trailingLeft -= trailing.measureText(Fmt.clock(v.arrivedAt)) + Ui.dp(10);
        } else if (!passed) {
            String d = Fmt.distance(Math.max(0, v.distance));
            Paint p = isNext ? trailingStrong : trailing;
            p.setTextAlign(Paint.Align.RIGHT);
            canvas.drawText(d, rightEdge, cy + Ui.dp(5), p);
            p.setTextAlign(Paint.Align.LEFT);
            trailingLeft = rightEdge - p.measureText(d) - Ui.dp(10);
        }

        float available = Math.max(Ui.dp(60), trailingLeft - textX);
        Paint namePaint = isNext ? nameNext : (passed ? namePassed : nameTodo);
        namePaint.setColor(passed ? Ui.TEXT_DIM : (isNext ? Ui.BLUE : Ui.TEXT));

        boolean hasCaption = isNext || r.isDestination;
        float nameBaseline = hasCaption ? cy + Ui.dp(0.5f) : cy + Ui.dp(6);
        canvas.drawText(Ui.ellipsize(v.station.name, namePaint, available),
                textX, nameBaseline, namePaint);

        if (isNext) {
            canvas.drawText(v.state == JourneyState.StopView.ARRIVED ? "ARRIVED" : "NEXT STATION",
                    textX, cy + Ui.dp(17), caption);
        } else if (r.isDestination) {
            canvas.drawText("DESTINATION", textX, cy + Ui.dp(17), captionDim);
        }
    }
}
