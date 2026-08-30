package com.trainjourney.live.map;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.view.GestureDetector;
import android.view.MotionEvent;
import android.view.ScaleGestureDetector;
import android.view.View;
import android.widget.OverScroller;

import com.trainjourney.live.util.Geo;
import com.trainjourney.live.util.Ui;

import java.util.ArrayList;
import java.util.List;

/**
 * A slippy map drawn from scratch.
 *
 * Everything is in normalised Web Mercator internally, so the camera can sit at
 * a fractional zoom and pinch stays continuous rather than stepping between
 * levels. Missing tiles fall back to a scaled crop of their parent, which is
 * what stops a train running into freshly downloaded territory from leaving
 * white squares across the screen.
 */
public final class MapView extends View implements TileManager.Callback {

    public static final int TILE = 256;
    public static final double MIN_ZOOM = 3;
    public static final double MAX_ZOOM = 18.5;

    /** Anything drawn on top of the imagery: rails, stations, the train. */
    public interface Overlay {
        void draw(Canvas canvas, MapView map);
    }

    /** Told when the user takes control, so the UI can offer "follow" again. */
    public interface InteractionListener {
        void onUserPanned();
        void onCameraChanged();
    }

    private final TileManager tiles;
    private final List<Overlay> overlays = new ArrayList<Overlay>(4);
    private TileSource base = TileSource.STANDARD;
    private TileSource overlaySource;                 // optional, e.g. railway detail
    private InteractionListener interactionListener;

    // Camera.
    // Until the first fix lands there is nothing meaningful to show, so the
    // camera sits well back rather than pretending to know a street.
    private double centreLat = 20.5937, centreLon = 78.9629;
    private double zoom = 4.2;
    private double targetLat = centreLat, targetLon = centreLon, targetZoom = zoom;
    private boolean animating;
    private boolean follow = true;

    // Gestures.
    private final GestureDetector gestures;
    private final ScaleGestureDetector pinch;
    private final OverScroller scroller;
    private boolean flinging;
    private double flingStartLat, flingStartLon;

    // Paints, allocated once.
    private final Paint tilePaint = new Paint(Paint.FILTER_BITMAP_FLAG | Paint.DITHER_FLAG);
    private final Paint gridPaint = Ui.stroke(0xFFDCE3EC, Ui.dp(1));
    private final Paint bgPaint = Ui.fill(Ui.MAP_BG);
    private final Paint attributionPaint =
            Ui.text(0x99303B4D, Ui.sp(9), Ui.regular());
    private final Paint attributionBg = Ui.fill(0x66FFFFFF);
    private final Rect srcRect = new Rect();
    private final RectF dstRect = new RectF();

    private long lastFrameNanos;

    private final Runnable frame = new Runnable() {
        @Override public void run() { step(); }
    };

    public MapView(Context context) {
        super(context);
        tiles = new TileManager(context);
        tiles.setCallback(this);
        scroller = new OverScroller(context);

        gestures = new GestureDetector(context, new GestureDetector.SimpleOnGestureListener() {
            @Override public boolean onDown(MotionEvent e) {
                scroller.forceFinished(true);
                flinging = false;
                return true;
            }
            @Override public boolean onScroll(MotionEvent e1, MotionEvent e2, float dx, float dy) {
                panPixels(dx, dy);
                userTookOver();
                return true;
            }
            @Override public boolean onFling(MotionEvent e1, MotionEvent e2, float vx, float vy) {
                flingStartLat = centreLat;
                flingStartLon = centreLon;
                scroller.forceFinished(true);
                scroller.fling(0, 0, (int) -vx, (int) -vy,
                        Integer.MIN_VALUE, Integer.MAX_VALUE,
                        Integer.MIN_VALUE, Integer.MAX_VALUE);
                flinging = true;
                userTookOver();
                requestFrame();
                return true;
            }
            @Override public boolean onDoubleTap(MotionEvent e) {
                zoomAround(e.getX(), e.getY(), 1.0);
                return true;
            }
        });

        pinch = new ScaleGestureDetector(context,
                new ScaleGestureDetector.SimpleOnScaleGestureListener() {
            @Override public boolean onScale(ScaleGestureDetector d) {
                double dz = Math.log(d.getScaleFactor()) / Math.log(2);
                zoomAroundImmediate(d.getFocusX(), d.getFocusY(), dz);
                userTookOver();
                return true;
            }
        });
        setBackgroundColor(Ui.MAP_BG);
    }

    // ------------------------------------------------------------------ setup

    public void addOverlay(Overlay o) {
        overlays.add(o);
    }

    public void setInteractionListener(InteractionListener l) {
        this.interactionListener = l;
    }

    public TileManager tiles() {
        return tiles;
    }

    public TileSource baseLayer() {
        return base;
    }

    public void setBaseLayer(TileSource src) {
        this.base = src;
        clampZoom();
        invalidate();
    }

    public TileSource overlayLayer() {
        return overlaySource;
    }

    public void setOverlayLayer(TileSource src) {
        this.overlaySource = src;
        invalidate();
    }

    // ----------------------------------------------------------------- camera

    public double centreLat() { return centreLat; }
    public double centreLon() { return centreLon; }
    public double zoom() { return zoom; }
    public boolean isFollowing() { return follow; }

    /** Turns automatic centring on the train back on. */
    public void setFollow(boolean f) {
        this.follow = f;
        if (interactionListener != null) interactionListener.onCameraChanged();
        invalidate();
    }

    /** Jumps straight to a position, with no animation. */
    public void moveTo(double lat, double lon, double z) {
        centreLat = targetLat = lat;
        centreLon = targetLon = lon;
        zoom = targetZoom = clamp(z);
        invalidate();
    }

    /** Eases the camera to a position over the next few frames. */
    public void animateTo(double lat, double lon, double z) {
        targetLat = lat;
        targetLon = lon;
        targetZoom = clamp(z);
        requestFrame();
    }

    /** Keeps the camera on the train while follow mode is on. */
    public void followTo(double lat, double lon) {
        if (!follow) return;
        targetLat = lat;
        targetLon = lon;
        requestFrame();
    }

    public void zoomBy(double delta) {
        targetZoom = clamp(targetZoom + delta);
        requestFrame();
    }

    private void userTookOver() {
        if (follow) {
            follow = false;
            if (interactionListener != null) interactionListener.onUserPanned();
        }
    }

    private double clamp(double z) {
        double lo = Math.max(MIN_ZOOM, base.minZoom);
        double hi = Math.min(MAX_ZOOM, base.maxZoom + 1.5);
        return Geo.clamp(z, lo, hi);
    }

    private void clampZoom() {
        zoom = clamp(zoom);
        targetZoom = clamp(targetZoom);
    }

    // ------------------------------------------------------------- projection

    /** World size in pixels at the current fractional zoom. */
    private double worldPx() {
        return TILE * Math.pow(2, zoom);
    }

    /** Screen x for a longitude. */
    public float screenX(double lon) {
        double w = worldPx();
        return (float) ((Geo.lonToX(lon) - Geo.lonToX(centreLon)) * w + getWidth() / 2.0);
    }

    /** Screen y for a latitude. */
    public float screenY(double lat) {
        double w = worldPx();
        return (float) ((Geo.latToY(lat) - Geo.latToY(centreLat)) * w + getHeight() / 2.0);
    }

    /** Longitude under a screen x. */
    public double lonAt(float x) {
        double w = worldPx();
        return Geo.xToLon(Geo.lonToX(centreLon) + (x - getWidth() / 2.0) / w);
    }

    /** Latitude under a screen y. */
    public double latAt(float y) {
        double w = worldPx();
        return Geo.yToLat(Geo.latToY(centreLat) + (y - getHeight() / 2.0) / w);
    }

    /** Metres per pixel at the centre of the view. */
    public double metersPerPixel() {
        return Geo.metersPerPixel(centreLat, zoom, TILE);
    }

    /** True when a coordinate is on screen, with a margin in pixels. */
    public boolean isVisible(double lat, double lon, float margin) {
        float x = screenX(lon), y = screenY(lat);
        return x >= -margin && x <= getWidth() + margin
            && y >= -margin && y <= getHeight() + margin;
    }

    private void panPixels(float dx, float dy) {
        double w = worldPx();
        double nx = Geo.lonToX(centreLon) + dx / w;
        double ny = Geo.latToY(centreLat) + dy / w;
        ny = Geo.clamp(ny, 0.0001, 0.9999);
        nx = nx - Math.floor(nx);
        centreLon = targetLon = Geo.xToLon(nx);
        centreLat = targetLat = Geo.yToLat(ny);
        notifyCamera();
        invalidate();
    }

    /** Zooms keeping the point under the finger fixed. */
    private void zoomAroundImmediate(float fx, float fy, double dz) {
        double lat = latAt(fy), lon = lonAt(fx);
        zoom = targetZoom = clamp(zoom + dz);
        // Re-centre so that (lat,lon) lands back under (fx,fy).
        double w = worldPx();
        double cx = Geo.lonToX(lon) - (fx - getWidth() / 2.0) / w;
        double cy = Geo.latToY(lat) - (fy - getHeight() / 2.0) / w;
        centreLon = targetLon = Geo.xToLon(cx);
        centreLat = targetLat = Geo.yToLat(Geo.clamp(cy, 0.0001, 0.9999));
        notifyCamera();
        invalidate();
    }

    private void zoomAround(float fx, float fy, double dz) {
        zoomAroundImmediate(fx, fy, dz);
        userTookOver();
    }

    private void notifyCamera() {
        if (interactionListener != null) interactionListener.onCameraChanged();
    }

    // ------------------------------------------------------------- animation

    private void requestFrame() {
        if (animating) return;
        animating = true;
        lastFrameNanos = System.nanoTime();
        postOnAnimation(frame);
    }

    private void step() {
        long now = System.nanoTime();
        float dt = (float) Math.min(0.05, (now - lastFrameNanos) / 1e9);
        lastFrameNanos = now;

        boolean more = false;

        if (flinging) {
            if (scroller.computeScrollOffset()) {
                double w = worldPx();
                double nx = Geo.lonToX(flingStartLon) + scroller.getCurrX() / w;
                double ny = Geo.clamp(Geo.latToY(flingStartLat) + scroller.getCurrY() / w,
                        0.0001, 0.9999);
                centreLon = targetLon = Geo.xToLon(nx - Math.floor(nx));
                centreLat = targetLat = Geo.yToLat(ny);
                more = true;
            } else {
                flinging = false;
            }
        }

        // Critically damped easing: fast to start, no overshoot, frame-rate safe.
        double k = 1 - Math.exp(-dt * 9.0);
        double dLat = targetLat - centreLat;
        double dLon = targetLon - centreLon;
        double dZoom = targetZoom - zoom;
        if (Math.abs(dLat) > 1e-8 || Math.abs(dLon) > 1e-8) {
            centreLat += dLat * k;
            centreLon += dLon * k;
            more = true;
        }
        if (Math.abs(dZoom) > 1e-4) {
            zoom += dZoom * k;
            more = true;
        }

        invalidate();
        if (more) {
            postOnAnimation(frame);
        } else {
            animating = false;
            notifyCamera();
        }
    }

    /** Views drawing live content ask for a frame every vsync. */
    public void requestContinuousRedraw() {
        requestFrame();
    }

    // ------------------------------------------------------------------ input

    @Override public boolean onTouchEvent(MotionEvent event) {
        pinch.onTouchEvent(event);
        if (!pinch.isInProgress()) gestures.onTouchEvent(event);
        return true;
    }

    @Override public void onTileReady() {
        invalidate();
    }

    // ------------------------------------------------------------------- draw

    @Override protected void onDraw(Canvas canvas) {
        canvas.drawRect(0, 0, getWidth(), getHeight(), bgPaint);
        drawLayer(canvas, base);
        if (overlaySource != null) drawLayer(canvas, overlaySource);

        for (int i = 0; i < overlays.size(); i++) {
            overlays.get(i).draw(canvas, this);
        }
        drawAttribution(canvas);
    }

    private void drawLayer(Canvas canvas, TileSource src) {
        int zi = (int) Math.round(zoom);
        if (zi < src.minZoom) zi = src.minZoom;
        if (zi > src.maxZoom) zi = src.maxZoom;

        double scale = Math.pow(2, zoom - zi);
        double tileSize = TILE * scale;
        int span = 1 << zi;

        // World pixel of the view centre, at zi.
        double cx = Geo.lonToX(centreLon) * TILE * span;
        double cy = Geo.latToY(centreLat) * TILE * span;
        double originX = getWidth() / 2.0 - cx * scale;
        double originY = getHeight() / 2.0 - cy * scale;

        int x0 = (int) Math.floor(-originX / tileSize);
        int y0 = (int) Math.floor(-originY / tileSize);
        int x1 = (int) Math.floor((getWidth() - originX) / tileSize);
        int y1 = (int) Math.floor((getHeight() - originY) / tileSize);

        for (int ty = y0; ty <= y1; ty++) {
            if (ty < 0 || ty >= span) continue;
            for (int tx = x0; tx <= x1; tx++) {
                int wrapped = ((tx % span) + span) % span;
                float left = (float) (originX + tx * tileSize);
                float top = (float) (originY + ty * tileSize);
                dstRect.set(left, top, (float) (left + tileSize), (float) (top + tileSize));

                Bitmap bmp = tiles.get(src, zi, wrapped, ty);
                if (bmp != null) {
                    srcRect.set(0, 0, bmp.getWidth(), bmp.getHeight());
                    canvas.drawBitmap(bmp, srcRect, dstRect, tilePaint);
                } else if (!drawFromParent(canvas, src, zi, wrapped, ty, dstRect)) {
                    if (!src.overlay) canvas.drawRect(dstRect, gridPaint);
                }
            }
        }
    }

    /**
     * Draws the matching crop of an already-cached lower-zoom tile.
     * Blurry for a moment beats blank while the real tile downloads.
     */
    private boolean drawFromParent(Canvas canvas, TileSource src, int z, int x, int y, RectF dst) {
        for (int up = 1; up <= 4; up++) {
            int pz = z - up;
            if (pz < src.minZoom) break;
            int shift = up;
            int px = x >> shift, py = y >> shift;
            Bitmap bmp = tiles.peek(src, pz, px, py);
            if (bmp == null) continue;

            int div = 1 << shift;
            int sub = bmp.getWidth() / div;
            int ox = (x - (px << shift)) * sub;
            int oy = (y - (py << shift)) * sub;
            srcRect.set(ox, oy, ox + sub, oy + sub);
            canvas.drawBitmap(bmp, srcRect, dst, tilePaint);
            return true;
        }
        return false;
    }

    private void drawAttribution(Canvas canvas) {
        String text = base.attribution;
        if (overlaySource != null) text = text + " | " + overlaySource.attribution;
        float pad = Ui.dp(4);
        float w = attributionPaint.measureText(text);
        float h = Ui.sp(11);
        float y = getHeight() - Ui.dp(2);
        canvas.drawRect(0, y - h - pad, w + pad * 2, y, attributionBg);
        canvas.drawText(text, pad, y - pad, attributionPaint);
    }

    @Override protected void onDetachedFromWindow() {
        super.onDetachedFromWindow();
        animating = false;
    }
}
