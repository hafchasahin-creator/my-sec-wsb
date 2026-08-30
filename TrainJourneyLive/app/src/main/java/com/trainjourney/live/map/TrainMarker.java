package com.trainjourney.live.map;

import android.graphics.Canvas;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Shader;

import com.trainjourney.live.engine.RoutePath;
import com.trainjourney.live.util.Geo;
import com.trainjourney.live.util.Ui;

/**
 * The train itself: a 2D locomotive seen from above, and the motion that makes
 * it feel alive.
 *
 * GPS delivers a position once a second, which on its own would make the icon
 * hop. Between fixes the marker dead-reckons forward along the traced route at
 * the measured speed and eases out the error when the next fix lands, so the
 * train glides down the rails continuously instead of stepping. Heading is
 * interpolated the short way round, so crossing north never spins the icon.
 */
public final class TrainMarker {

    /** How quickly the drawn position converges on the true one. */
    private static final double POSITION_TIME_CONSTANT = 0.55;
    /** Same, for heading. Slower, because a jittery nose looks broken. */
    private static final double BEARING_TIME_CONSTANT = 0.35;

    // Where the icon is actually drawn.
    private double dispLat, dispLon, dispBearing;
    private boolean initialised;

    // Where it should be.
    private double trueLat, trueLon, trueBearing;
    private double speed;
    private float accuracy = Float.NaN;
    private boolean snapped;

    // Route-following state, used for dead reckoning.
    private RoutePath path;
    private double dispAlong = Double.NaN;
    private double trueAlong = Double.NaN;

    private double pulsePhase;

    private final Path body = new Path();
    private final Path glass = new Path();
    private final RectF rect = new RectF();
    private final double[] tmp = new double[2];

    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint outline = Ui.stroke(0xFFFFFFFF, Ui.dp(2.4f));
    private final Paint detail = Ui.fill(0xFF0B1B33);
    private final Paint accent = Ui.fill(0xFFFFC53D);
    private final Paint halo = Ui.fill(Ui.alpha(Ui.BLUE, 0.16f));
    private final Paint haloRing = Ui.stroke(Ui.alpha(Ui.BLUE, 0.45f), Ui.dp(1.4f));
    private final Paint contactShadow = Ui.fill(0x26101A2B);
    private final Paint unsnappedRing = Ui.stroke(Ui.alpha(0xFFF97316, 0.9f), Ui.dp(2f));

    public TrainMarker() {
        fill.setStyle(Paint.Style.FILL);
    }

    /** Feeds in the latest fix. */
    public void setTarget(double lat, double lon, double bearing, double speed,
                          float accuracy, boolean snapped, RoutePath path, double along) {
        this.trueLat = lat;
        this.trueLon = lon;
        this.speed = speed;
        this.accuracy = accuracy;
        this.snapped = snapped;
        this.path = path;
        this.trueAlong = along;
        if (!Double.isNaN(bearing)) this.trueBearing = bearing;

        if (!initialised) {
            dispLat = lat;
            dispLon = lon;
            dispBearing = Double.isNaN(bearing) ? 0 : bearing;
            dispAlong = along;
            initialised = true;
        }
        // A jump of more than a few hundred metres is a new journey, not motion.
        if (Geo.distance(dispLat, dispLon, lat, lon) > 800) {
            dispLat = lat;
            dispLon = lon;
            dispAlong = along;
        }
    }

    public boolean hasPosition() {
        return initialised;
    }

    public double displayLat() { return dispLat; }
    public double displayLon() { return dispLon; }
    public double displayBearing() { return dispBearing; }

    /** Advances the animation. Call once per frame with the frame time. */
    public void update(double dt) {
        if (!initialised) return;
        if (dt <= 0) return;
        if (dt > 0.25) dt = 0.25;                 // after a stall, do not lurch

        pulsePhase += dt;

        boolean onRoute = path != null && !path.isEmpty()
                && !Double.isNaN(trueAlong) && !Double.isNaN(dispAlong);

        if (onRoute) {
            // Roll forward at the measured speed, then close the gap to the truth.
            dispAlong += speed * dt;
            double error = trueAlong - dispAlong;
            // A large error means the plan was rebuilt underneath us: just accept it.
            if (Math.abs(error) > 400) {
                dispAlong = trueAlong;
            } else {
                dispAlong += error * (1 - Math.exp(-dt / POSITION_TIME_CONSTANT));
            }
            if (path.pointAt(dispAlong, tmp)) {
                dispLat = tmp[0];
                dispLon = tmp[1];
            }
        } else {
            double k = 1 - Math.exp(-dt / POSITION_TIME_CONSTANT);
            dispLat += (trueLat - dispLat) * k;
            dispLon += (trueLon - dispLon) * k;
            dispAlong = trueAlong;
        }

        double kb = 1 - Math.exp(-dt / BEARING_TIME_CONSTANT);
        dispBearing = Geo.lerpAngle(dispBearing, trueBearing, kb);
    }

    /** True while the icon still has ground to cover, so the view keeps drawing. */
    public boolean isAnimating() {
        if (!initialised) return false;
        if (speed > 0.4) return true;
        if (Geo.distance(dispLat, dispLon, trueLat, trueLon) > 1.0) return true;
        return Geo.angleBetween(dispBearing, trueBearing) > 0.5;
    }

    // ------------------------------------------------------------------- draw

    public void draw(Canvas canvas, MapView map) {
        if (!initialised) return;
        float x = map.screenX(dispLon);
        float y = map.screenY(dispLat);

        double mpp = map.metersPerPixel();

        // Accuracy halo, in real metres, so it means something.
        if (!Float.isNaN(accuracy) && accuracy > 0) {
            float r = (float) (accuracy / mpp);
            if (r > Ui.dp(10) && r < Ui.dp(400)) {
                canvas.drawCircle(x, y, r, halo);
                canvas.drawCircle(x, y, r, haloRing);
            }
        }

        // A gentle pulse while moving, so the eye finds the train instantly.
        if (speed > 1.0) {
            float t = (float) ((pulsePhase % 2.2) / 2.2);
            float pr = Ui.dp(20) + Ui.dp(26) * Ui.easeOut(t);
            halo.setAlpha((int) (52 * (1 - t)));
            canvas.drawCircle(x, y, pr, halo);
            halo.setAlpha(41);
        }

        float len = iconLength(map.zoom());
        float hw = len * 0.235f;

        canvas.save();
        canvas.translate(x, y);
        canvas.rotate((float) dispBearing);

        buildBody(len, hw);
        // A soft contact shadow, drawn as a slightly larger offset copy rather
        // than a blur: mask filters are ignored by the GPU canvas before API 28.
        canvas.save();
        canvas.translate(0, Ui.dp(2));
        canvas.scale(1.04f, 1.02f);
        canvas.drawPath(body, contactShadow);
        canvas.restore();

        fill.setShader(new LinearGradient(-hw, 0, hw, 0,
                0xFF4A90FF, 0xFF1553B8, Shader.TileMode.CLAMP));
        canvas.drawPath(body, fill);
        fill.setShader(null);
        canvas.drawPath(body, outline);

        // Windscreen, side windows and roof rib.
        canvas.drawPath(glass, detail);
        float wy = -len * 0.06f;
        rect.set(-hw * 0.72f, wy, -hw * 0.20f, wy + len * 0.17f);
        canvas.drawRoundRect(rect, hw * 0.10f, hw * 0.10f, detail);
        rect.set(hw * 0.20f, wy, hw * 0.72f, wy + len * 0.17f);
        canvas.drawRoundRect(rect, hw * 0.10f, hw * 0.10f, detail);
        rect.set(-hw * 0.55f, len * 0.20f, hw * 0.55f, len * 0.28f);
        canvas.drawRoundRect(rect, hw * 0.08f, hw * 0.08f, detail);

        // Headlights.
        canvas.drawCircle(-hw * 0.52f, -len * 0.375f, len * 0.036f, accent);
        canvas.drawCircle(hw * 0.52f, -len * 0.375f, len * 0.036f, accent);

        canvas.restore();

        // When the fix could not be trusted onto a line, say so honestly.
        if (!snapped) {
            canvas.drawCircle(x, y, len * 0.72f, unsnappedRing);
        }
    }

    /** The icon grows with zoom but never dominates or disappears. */
    private static float iconLength(double zoom) {
        double t = Geo.clamp((zoom - 11.0) / 6.0, 0, 1);
        return (float) (Ui.dp(26) + (Ui.dp(52) - Ui.dp(26)) * t);
    }

    private void buildBody(float len, float hw) {
        float half = len / 2f;
        float r = hw * 0.42f;

        body.reset();
        body.moveTo(0, -half);
        body.cubicTo(hw * 0.80f, -half, hw, -half + len * 0.16f, hw, -half + len * 0.26f);
        body.lineTo(hw, half - r);
        body.quadTo(hw, half, hw - r, half);
        body.lineTo(-hw + r, half);
        body.quadTo(-hw, half, -hw, half - r);
        body.lineTo(-hw, -half + len * 0.26f);
        body.cubicTo(-hw, -half + len * 0.16f, -hw * 0.80f, -half, 0, -half);
        body.close();

        glass.reset();
        glass.moveTo(0, -half + len * 0.10f);
        glass.cubicTo(hw * 0.62f, -half + len * 0.10f,
                      hw * 0.80f, -half + len * 0.20f,
                      hw * 0.80f, -half + len * 0.27f);
        glass.lineTo(-hw * 0.80f, -half + len * 0.27f);
        glass.cubicTo(-hw * 0.80f, -half + len * 0.20f,
                      -hw * 0.62f, -half + len * 0.10f,
                      0, -half + len * 0.10f);
        glass.close();
    }
}
