package com.trainjourney.live.util;

import android.graphics.Canvas;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;

/**
 * Every glyph in the app, drawn as vector paths.
 *
 * Shapes are authored in a 24x24 box and mapped onto the requested square, so a
 * single definition stays crisp at any density and the APK ships no icon assets.
 * Builders reuse a caller-owned {@link Path} to stay allocation-free in onDraw.
 */
public final class Icons {

    private static final Matrix M = new Matrix();
    private static final RectF SRC = new RectF(0, 0, 24, 24);

    private Icons() { }

    /** Maps a 24x24 path onto the square of side {@code size} centred at cx,cy. */
    private static void place(Path p, float cx, float cy, float size) {
        M.reset();
        M.setRectToRect(SRC, new RectF(cx - size / 2, cy - size / 2,
                cx + size / 2, cy + size / 2), Matrix.ScaleToFit.FILL);
        p.transform(M);
    }

    // ------------------------------------------------------------- navigation

    /** Bottom-nav map glyph: a folded map. */
    public static Path map(Path p, float cx, float cy, float size) {
        p.reset();
        p.moveTo(3, 6); p.lineTo(9, 3.5f); p.lineTo(15, 6.5f); p.lineTo(21, 4);
        p.lineTo(21, 18); p.lineTo(15, 20.5f); p.lineTo(9, 17.5f); p.lineTo(3, 20);
        p.close();
        p.moveTo(9, 3.5f); p.lineTo(9, 17.5f);
        p.moveTo(15, 6.5f); p.lineTo(15, 20.5f);
        place(p, cx, cy, size);
        return p;
    }

    /** Bottom-nav route glyph: two interleaved arrows. */
    public static Path route(Path p, float cx, float cy, float size) {
        p.reset();
        p.moveTo(3, 8.5f); p.lineTo(17, 8.5f);
        p.moveTo(14, 5.5f); p.lineTo(17, 8.5f); p.lineTo(14, 11.5f);
        p.moveTo(21, 15.5f); p.lineTo(7, 15.5f);
        p.moveTo(10, 12.5f); p.lineTo(7, 15.5f); p.lineTo(10, 18.5f);
        place(p, cx, cy, size);
        return p;
    }

    /** Bottom-nav stations glyph: a small station building. */
    public static Path stationsTab(Path p, float cx, float cy, float size) {
        p.reset();
        p.addRoundRect(new RectF(5, 8, 19, 19), 1.6f, 1.6f, Path.Direction.CW);
        p.moveTo(3.5f, 8); p.lineTo(12, 3.5f); p.lineTo(20.5f, 8);
        p.moveTo(9, 12); p.lineTo(15, 12);
        p.moveTo(9, 15.5f); p.lineTo(15, 15.5f);
        place(p, cx, cy, size);
        return p;
    }

    /** Bottom-nav journey glyph: a location pin. */
    public static Path journey(Path p, float cx, float cy, float size) {
        p.reset();
        p.moveTo(12, 21);
        p.cubicTo(12, 21, 19, 14.6f, 19, 9.8f);
        p.cubicTo(19, 5.9f, 15.9f, 3, 12, 3);
        p.cubicTo(8.1f, 3, 5, 5.9f, 5, 9.8f);
        p.cubicTo(5, 14.6f, 12, 21, 12, 21);
        p.close();
        p.addCircle(12, 9.8f, 2.6f, Path.Direction.CCW);
        place(p, cx, cy, size);
        return p;
    }

    // ----------------------------------------------------------------- chrome

    /** Hamburger menu. */
    public static Path menu(Path p, float cx, float cy, float size) {
        p.reset();
        p.moveTo(4, 7); p.lineTo(20, 7);
        p.moveTo(4, 12); p.lineTo(20, 12);
        p.moveTo(4, 17); p.lineTo(15, 17);
        place(p, cx, cy, size);
        return p;
    }

    public static Path chevronRight(Path p, float cx, float cy, float size) {
        p.reset();
        p.moveTo(9, 5); p.lineTo(16, 12); p.lineTo(9, 19);
        place(p, cx, cy, size);
        return p;
    }

    public static Path chevronLeft(Path p, float cx, float cy, float size) {
        p.reset();
        p.moveTo(15, 5); p.lineTo(8, 12); p.lineTo(15, 19);
        place(p, cx, cy, size);
        return p;
    }

    public static Path check(Path p, float cx, float cy, float size) {
        p.reset();
        p.moveTo(5.5f, 12.5f); p.lineTo(10, 17); p.lineTo(18.5f, 7.5f);
        place(p, cx, cy, size);
        return p;
    }

    public static Path close(Path p, float cx, float cy, float size) {
        p.reset();
        p.moveTo(6, 6); p.lineTo(18, 18);
        p.moveTo(18, 6); p.lineTo(6, 18);
        place(p, cx, cy, size);
        return p;
    }

    /** Crosshair used by the "follow my train" button. */
    public static Path locate(Path p, float cx, float cy, float size) {
        p.reset();
        p.addCircle(12, 12, 5.2f, Path.Direction.CW);
        p.moveTo(12, 1.8f);  p.lineTo(12, 5);
        p.moveTo(12, 19);    p.lineTo(12, 22.2f);
        p.moveTo(1.8f, 12);  p.lineTo(5, 12);
        p.moveTo(19, 12);    p.lineTo(22.2f, 12);
        place(p, cx, cy, size);
        return p;
    }

    /** Stacked sheets, for the map layer switcher. */
    public static Path layers(Path p, float cx, float cy, float size) {
        p.reset();
        p.moveTo(12, 3); p.lineTo(21.5f, 8.2f); p.lineTo(12, 13.4f); p.lineTo(2.5f, 8.2f);
        p.close();
        p.moveTo(4.6f, 12.2f); p.lineTo(12, 16.2f); p.lineTo(19.4f, 12.2f);
        p.moveTo(4.6f, 16.1f); p.lineTo(12, 20.1f); p.lineTo(19.4f, 16.1f);
        place(p, cx, cy, size);
        return p;
    }

    /** North-pointing compass needle (filled halves drawn by the caller). */
    public static Path compassNorth(Path p, float cx, float cy, float size) {
        p.reset();
        p.moveTo(12, 3.5f); p.lineTo(16.4f, 12); p.lineTo(12, 10.2f); p.close();
        place(p, cx, cy, size);
        return p;
    }

    public static Path compassSouth(Path p, float cx, float cy, float size) {
        p.reset();
        p.moveTo(12, 20.5f); p.lineTo(7.6f, 12); p.lineTo(12, 13.8f); p.close();
        place(p, cx, cy, size);
        return p;
    }

    public static Path pause(Path p, float cx, float cy, float size) {
        p.reset();
        p.addRoundRect(new RectF(7.5f, 5.5f, 10.8f, 18.5f), 1.1f, 1.1f, Path.Direction.CW);
        p.addRoundRect(new RectF(13.2f, 5.5f, 16.5f, 18.5f), 1.1f, 1.1f, Path.Direction.CW);
        place(p, cx, cy, size);
        return p;
    }

    public static Path play(Path p, float cx, float cy, float size) {
        p.reset();
        p.moveTo(8, 5.2f); p.lineTo(19, 12); p.lineTo(8, 18.8f); p.close();
        place(p, cx, cy, size);
        return p;
    }

    public static Path stopSquare(Path p, float cx, float cy, float size) {
        p.reset();
        p.addRoundRect(new RectF(6.5f, 6.5f, 17.5f, 17.5f), 2f, 2f, Path.Direction.CW);
        place(p, cx, cy, size);
        return p;
    }

    // ------------------------------------------------------------ stat glyphs

    /** Speedometer with the needle low - current speed. */
    public static Path gaugeCurrent(Path p, float cx, float cy, float size) {
        p.reset();
        p.addArc(new RectF(3, 5, 21, 23), 180, 180);
        p.moveTo(12, 19); p.lineTo(7.6f, 11.4f);
        place(p, cx, cy, size);
        return p;
    }

    /** Speedometer with the needle upright - average speed. */
    public static Path gaugeAverage(Path p, float cx, float cy, float size) {
        p.reset();
        p.addArc(new RectF(3, 5, 21, 23), 180, 180);
        p.moveTo(12, 19); p.lineTo(12, 9.2f);
        place(p, cx, cy, size);
        return p;
    }

    /** Speedometer pinned to the right - maximum speed. */
    public static Path gaugeMax(Path p, float cx, float cy, float size) {
        p.reset();
        p.addArc(new RectF(3, 5, 21, 23), 180, 180);
        p.moveTo(12, 19); p.lineTo(16.4f, 11.4f);
        place(p, cx, cy, size);
        return p;
    }

    /** Road receding to the horizon - distance travelled. */
    public static Path road(Path p, float cx, float cy, float size) {
        p.reset();
        p.moveTo(8.5f, 3.5f); p.lineTo(4.5f, 20.5f);
        p.moveTo(15.5f, 3.5f); p.lineTo(19.5f, 20.5f);
        p.moveTo(12, 4.5f); p.lineTo(12, 8);
        p.moveTo(12, 10.5f); p.lineTo(12, 14);
        p.moveTo(12, 16.5f); p.lineTo(12, 20);
        place(p, cx, cy, size);
        return p;
    }

    public static Path clock(Path p, float cx, float cy, float size) {
        p.reset();
        p.addCircle(12, 12, 8.6f, Path.Direction.CW);
        p.moveTo(12, 7); p.lineTo(12, 12.4f); p.lineTo(16, 14.6f);
        place(p, cx, cy, size);
        return p;
    }

    /** Concentric target - GPS accuracy. */
    public static Path gpsAccuracy(Path p, float cx, float cy, float size) {
        p.reset();
        p.addCircle(12, 12, 8.4f, Path.Direction.CW);
        p.addCircle(12, 12, 3.6f, Path.Direction.CW);
        place(p, cx, cy, size);
        return p;
    }

    public static Path bell(Path p, float cx, float cy, float size) {
        p.reset();
        p.moveTo(6, 17.2f);
        p.lineTo(6, 10.6f);
        p.cubicTo(6, 7.2f, 8.7f, 4.5f, 12, 4.5f);
        p.cubicTo(15.3f, 4.5f, 18, 7.2f, 18, 10.6f);
        p.lineTo(18, 17.2f);
        p.close();
        p.moveTo(4.5f, 17.2f); p.lineTo(19.5f, 17.2f);
        p.moveTo(10, 19.6f); p.cubicTo(10.5f, 20.8f, 13.5f, 20.8f, 14, 19.6f);
        place(p, cx, cy, size);
        return p;
    }

    /** Shield with a tick - the privacy note. */
    public static Path shield(Path p, float cx, float cy, float size) {
        p.reset();
        p.moveTo(12, 3);
        p.lineTo(19.5f, 6.2f);
        p.lineTo(19.5f, 11.5f);
        p.cubicTo(19.5f, 16.5f, 16.3f, 19.7f, 12, 21.2f);
        p.cubicTo(7.7f, 19.7f, 4.5f, 16.5f, 4.5f, 11.5f);
        p.lineTo(4.5f, 6.2f);
        p.close();
        p.moveTo(8.8f, 11.8f); p.lineTo(11.2f, 14.2f); p.lineTo(15.4f, 9.6f);
        place(p, cx, cy, size);
        return p;
    }

    /** Crossed-out cloud - offline / cached-data indicator. */
    public static Path cloudOff(Path p, float cx, float cy, float size) {
        p.reset();
        p.moveTo(7, 18.5f);
        p.cubicTo(4.2f, 18.5f, 2.5f, 16.4f, 2.5f, 14.2f);
        p.cubicTo(2.5f, 12, 4.1f, 10.3f, 6.2f, 10);
        p.moveTo(9.4f, 6.4f);
        p.cubicTo(12.6f, 4.4f, 17, 6.2f, 17.6f, 10);
        p.cubicTo(20, 10.2f, 21.5f, 12.1f, 21.5f, 14.2f);
        p.cubicTo(21.5f, 16.1f, 20.3f, 17.7f, 18.6f, 18.3f);
        p.moveTo(3.5f, 3.5f); p.lineTo(20.5f, 20.5f);
        place(p, cx, cy, size);
        return p;
    }

    // --------------------------------------------------------------- railway

    /**
     * Station building with platform canopy and a pin on each side - the marker
     * used on the arrival card, matching the reference artwork.
     */
    public static Path stationBuilding(Path p, float cx, float cy, float size) {
        p.reset();
        // roof
        p.moveTo(3.2f, 9.4f); p.lineTo(12, 4.6f); p.lineTo(20.8f, 9.4f);
        // body
        p.addRoundRect(new RectF(5.6f, 9.4f, 18.4f, 19.4f - 0.6f), 1.2f, 1.2f, Path.Direction.CW);
        // door
        p.addRoundRect(new RectF(10.4f, 13.2f, 13.6f, 18.8f), 0.6f, 0.6f, Path.Direction.CW);
        // windows
        p.addRect(new RectF(7.2f, 12.4f, 9.4f, 14.6f), Path.Direction.CW);
        p.addRect(new RectF(14.6f, 12.4f, 16.8f, 14.6f), Path.Direction.CW);
        // ground line
        p.moveTo(3.6f, 19.6f); p.lineTo(20.4f, 19.6f);
        place(p, cx, cy, size);
        return p;
    }

    /** Simple side-on train used in the route timeline. */
    public static Path trainSide(Path p, float cx, float cy, float size) {
        p.reset();
        p.addRoundRect(new RectF(5.4f, 4.4f, 18.6f, 17.4f), 3.4f, 3.4f, Path.Direction.CW);
        p.addRect(new RectF(7.6f, 7.6f, 16.4f, 12f), Path.Direction.CCW);
        p.moveTo(6.4f, 20.4f); p.lineTo(9.4f, 17.4f);
        p.moveTo(17.6f, 20.4f); p.lineTo(14.6f, 17.4f);
        p.addCircle(9.2f, 14.9f, 1.05f, Path.Direction.CCW);
        p.addCircle(14.8f, 14.9f, 1.05f, Path.Direction.CCW);
        place(p, cx, cy, size);
        return p;
    }

    /** Two rails with sleepers, for empty states and headers. */
    public static Path railway(Path p, float cx, float cy, float size) {
        p.reset();
        p.moveTo(8.4f, 2.5f); p.lineTo(8.4f, 21.5f);
        p.moveTo(15.6f, 2.5f); p.lineTo(15.6f, 21.5f);
        for (int i = 0; i < 5; i++) {
            float y = 4.2f + i * 3.9f;
            p.moveTo(5.8f, y); p.lineTo(18.2f, y);
        }
        place(p, cx, cy, size);
        return p;
    }

    // --------------------------------------------------------------- helpers

    /**
     * Convenience for the common case: build the glyph, stroke it, done.
     * The path is supplied by the caller so views can keep one instance around.
     */
    public static void strokeGlyph(Canvas c, Path p, Paint stroke) {
        c.drawPath(p, stroke);
    }

    /** Rounds the caps and joins of an icon stroke paint. */
    public static Paint iconStroke(int colour, float widthPx) {
        Paint p = Ui.stroke(colour, widthPx);
        p.setStrokeCap(Paint.Cap.ROUND);
        p.setStrokeJoin(Paint.Join.ROUND);
        return p;
    }
}
