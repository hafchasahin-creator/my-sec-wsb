package com.trainjourney.live.map;

import android.graphics.Canvas;
import android.graphics.DashPathEffect;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;

import com.trainjourney.live.data.RailIndex;
import com.trainjourney.live.data.RailWay;
import com.trainjourney.live.data.Station;
import com.trainjourney.live.engine.JourneyState;
import com.trainjourney.live.engine.RoutePath;
import com.trainjourney.live.util.Ui;

/**
 * Draws the railway world on the map: every mapped line, the route the train is
 * on, the ground it has already covered, and the stations.
 *
 * Lines use the convention every railway map uses - a dark casing with light
 * sleepers over it - so the rails read as rails at a glance and never get
 * confused with a road. The route ahead is lifted out of that in the app's
 * blue, and everything already travelled is drawn behind it.
 *
 * Redrawing happens every frame while the train moves, so the whole overlay is
 * allocation-free: one reusable Path, one coordinate buffer, paints built once.
 */
public final class RailOverlay implements MapView.Overlay {

    /** Below this zoom individual lines are noise, so only the route is drawn. */
    private static final double MIN_ZOOM_FOR_ALL_LINES = 10.5;
    /** Between that and this, branches and sidings are dropped to keep it legible. */
    private static final double MIN_ZOOM_FOR_MINOR_LINES = 12.0;
    /** Vertices closer together than this on screen add nothing. */
    private static final float MIN_VERTEX_SPACING_PX = 2.0f;

    private final JourneyState state;
    private RailIndex index = RailIndex.EMPTY;

    private final Path scratch = new Path();
    private final RectF oval = new RectF();

    private final Paint railCasing;
    private final Paint railSleepers;
    private final Paint routeCasing;
    private final Paint routeFill;
    private final Paint trailPaint;
    private final Paint stationFill = Ui.fill(0xFFFFFFFF);
    private final Paint stationRing;
    private final Paint stationMajorRing;
    private final Paint nextRing;
    private final Paint passedFill = Ui.fill(Ui.GREEN);
    private final Paint labelHalo;
    private final Paint label;

    public RailOverlay(JourneyState state) {
        this.state = state;

        railCasing = Ui.stroke(0xFF4A5768, Ui.dp(4.6f));
        railSleepers = Ui.stroke(0xFFF7F9FC, Ui.dp(2.6f));
        if (Ui.SUPPORTS_PATH_EFFECT) {
            // The classic railway hatching: light sleepers over a dark casing.
            railSleepers.setPathEffect(new DashPathEffect(
                    new float[]{Ui.dp(3.4f), Ui.dp(3.4f)}, 0));
        } else {
            // Older GPU canvases drop path effects silently, so the line would
            // come out solid white. A narrower, dimmer core reads as rails too.
            railSleepers.setColor(0xFFE3E9F2);
            railSleepers.setStrokeWidth(Ui.dp(1.8f));
        }

        routeCasing = Ui.stroke(0xFF10336E, Ui.dp(8f));
        routeFill = Ui.stroke(Ui.BLUE, Ui.dp(5f));

        trailPaint = Ui.stroke(Ui.alpha(0xFF16A34A, 0.85f), Ui.dp(5.5f));

        stationRing = Ui.stroke(0xFF4A5768, Ui.dp(2.2f));
        stationMajorRing = Ui.stroke(Ui.NAVY_CARD, Ui.dp(3f));
        nextRing = Ui.stroke(Ui.BLUE, Ui.dp(3.2f));

        label = Ui.text(Ui.NAVY_DEEP, Ui.sp(12.5f), Ui.medium());
        labelHalo = Ui.text(0xF2FFFFFF, Ui.sp(12.5f), Ui.medium());
        labelHalo.setStyle(Paint.Style.STROKE);
        labelHalo.setStrokeWidth(Ui.dp(3.2f));
        labelHalo.setStrokeJoin(Paint.Join.ROUND);
    }

    public void setIndex(RailIndex index) {
        this.index = index == null ? RailIndex.EMPTY : index;
    }

    @Override public void draw(Canvas canvas, MapView map) {
        float margin = Ui.dp(80);
        double west = map.lonAt(-margin);
        double east = map.lonAt(map.getWidth() + margin);
        double north = map.latAt(-margin);
        double south = map.latAt(map.getHeight() + margin);

        if (map.zoom() >= MIN_ZOOM_FOR_ALL_LINES) {
            drawAllLines(canvas, map, south, west, north, east,
                    map.zoom() >= MIN_ZOOM_FOR_MINOR_LINES);
        }
        drawRoute(canvas, map);
        drawTrail(canvas, map);
        drawStations(canvas, map, south, west, north, east);
    }

    // ------------------------------------------------------------------ lines

    private void drawAllLines(Canvas canvas, MapView map,
                              double south, double west, double north, double east,
                              boolean includeMinor) {
        for (int i = 0; i < index.ways.size(); i++) {
            RailWay w = index.ways.get(i);
            if (!includeMinor && !w.isMainLine()) continue;
            if (w.maxLat < south || w.minLat > north) continue;
            if (w.maxLon < west || w.minLon > east) continue;
            if (!buildPath(map, w)) continue;
            canvas.drawPath(scratch, railCasing);
            canvas.drawPath(scratch, railSleepers);
        }
    }

    /** Projects a way into screen space, dropping vertices too close to matter. */
    private boolean buildPath(MapView map, RailWay w) {
        scratch.reset();
        int n = w.size();
        if (n < 2) return false;

        float lastX = 0, lastY = 0;
        boolean started = false;
        int drawn = 0;
        for (int i = 0; i < n; i++) {
            float x = map.screenX(w.lon(i));
            float y = map.screenY(w.lat(i));
            if (!started) {
                scratch.moveTo(x, y);
                started = true;
                drawn++;
            } else {
                float dx = x - lastX, dy = y - lastY;
                boolean last = (i == n - 1);
                if (!last && dx * dx + dy * dy < MIN_VERTEX_SPACING_PX * MIN_VERTEX_SPACING_PX) {
                    continue;
                }
                scratch.lineTo(x, y);
                drawn++;
            }
            lastX = x;
            lastY = y;
        }
        return drawn >= 2;
    }

    // ------------------------------------------------------------------ route

    private void drawRoute(Canvas canvas, MapView map) {
        if (state.plan == null || state.plan.isEmpty()) return;
        RoutePath p = state.plan.path;

        // Only the part still to run is highlighted; behind the train it is history.
        double from = Double.isNaN(state.alongNow) ? 0 : state.alongNow;
        double to = p.length();
        if (state.chosenDestination != null) {
            for (int i = 0; i < state.plan.stops.size(); i++) {
                if (state.plan.stops.get(i).station.id == state.chosenDestination.id) {
                    to = state.plan.stops.get(i).along;
                    break;
                }
            }
        }
        if (to <= from) return;

        int start = p.vertexBefore(from);
        int end = Math.min(p.size() - 1, p.vertexBefore(to) + 1);

        scratch.reset();
        boolean started = false;
        float lastX = 0, lastY = 0;
        int drawn = 0;
        for (int i = start; i <= end; i++) {
            float x = map.screenX(p.lon(i));
            float y = map.screenY(p.lat(i));
            if (!started) {
                scratch.moveTo(x, y);
                started = true;
                drawn++;
            } else {
                float dx = x - lastX, dy = y - lastY;
                if (i != end && dx * dx + dy * dy < MIN_VERTEX_SPACING_PX * MIN_VERTEX_SPACING_PX) {
                    continue;
                }
                scratch.lineTo(x, y);
                drawn++;
            }
            lastX = x;
            lastY = y;
        }
        if (drawn < 2) return;
        canvas.drawPath(scratch, routeCasing);
        canvas.drawPath(scratch, routeFill);
    }

    private void drawTrail(Canvas canvas, MapView map) {
        if (state.trailCount < 2) return;
        scratch.reset();
        float lastX = 0, lastY = 0;
        boolean started = false;
        int drawn = 0;
        for (int i = 0; i < state.trailCount; i++) {
            float x = map.screenX(state.trail[i * 2 + 1]);
            float y = map.screenY(state.trail[i * 2]);
            if (!started) {
                scratch.moveTo(x, y);
                started = true;
                drawn++;
            } else {
                float dx = x - lastX, dy = y - lastY;
                boolean last = (i == state.trailCount - 1);
                if (!last && dx * dx + dy * dy < MIN_VERTEX_SPACING_PX * MIN_VERTEX_SPACING_PX) {
                    continue;
                }
                scratch.lineTo(x, y);
                drawn++;
            }
            lastX = x;
            lastY = y;
        }
        if (drawn >= 2) canvas.drawPath(scratch, trailPaint);
    }

    // --------------------------------------------------------------- stations

    private void drawStations(Canvas canvas, MapView map,
                              double south, double west, double north, double east) {
        double zoom = map.zoom();
        boolean showMinor = zoom >= 11.5;
        boolean showLabels = zoom >= 11.0;
        float r = (float) (zoom >= 14 ? Ui.dp(6.5f) : Ui.dp(5f));

        long nextId = state.next == null ? 0 : state.next.station.id;

        for (int i = 0; i < index.stations.size(); i++) {
            Station s = index.stations.get(i);
            if (s.lat < south || s.lat > north || s.lon < west || s.lon > east) continue;
            if (!s.isMajor() && !showMinor) continue;

            float x = map.screenX(s.lon);
            float y = map.screenY(s.lat);

            JourneyState.Visit visit = state.visitFor(s);
            boolean passed = visit != null && visit.arrivedAt > 0;
            boolean isNext = s.id == nextId;

            float radius = s.isMajor() ? r : r * 0.78f;
            if (isNext) {
                // A soft target ring so the eye lands on where the train is going.
                oval.set(x - radius * 2.4f, y - radius * 2.4f,
                         x + radius * 2.4f, y + radius * 2.4f);
                nextRing.setAlpha(70);
                canvas.drawOval(oval, nextRing);
                nextRing.setAlpha(255);
            }

            canvas.drawCircle(x, y, radius, passed ? passedFill : stationFill);
            canvas.drawCircle(x, y, radius,
                    isNext ? nextRing : (s.isMajor() ? stationMajorRing : stationRing));
            if (passed) {
                // A white tick inside the green dot.
                float t = radius * 0.55f;
                canvas.drawLine(x - t * 0.7f, y, x - t * 0.1f, y + t * 0.6f, tick());
                canvas.drawLine(x - t * 0.1f, y + t * 0.6f, x + t * 0.8f, y - t * 0.6f, tick());
            }

            if (showLabels && (s.isMajor() || zoom >= 13)) {
                String name = Ui.ellipsize(s.name, label, Ui.dp(150));
                float tx = x + radius + Ui.dp(5);
                float ty = y + Ui.dp(4.5f);
                canvas.drawText(name, tx, ty, labelHalo);
                canvas.drawText(name, tx, ty, label);
            }
        }
    }

    private Paint tickPaint;

    private Paint tick() {
        if (tickPaint == null) {
            tickPaint = Ui.stroke(0xFFFFFFFF, Ui.dp(1.7f));
        }
        return tickPaint;
    }
}
