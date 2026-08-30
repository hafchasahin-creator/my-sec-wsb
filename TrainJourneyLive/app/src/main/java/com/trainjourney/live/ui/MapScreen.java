package com.trainjourney.live.ui;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.LinearLayout;

import com.trainjourney.live.data.RailIndex;
import com.trainjourney.live.engine.JourneyState;
import com.trainjourney.live.map.MapView;
import com.trainjourney.live.map.RailOverlay;
import com.trainjourney.live.map.TileSource;
import com.trainjourney.live.map.TrainMarker;
import com.trainjourney.live.util.Icons;
import com.trainjourney.live.util.Ui;

/**
 * The main screen: the live map, with the journey laid over it.
 *
 * Everything here is driven by the same fix - the train icon, the next-station
 * card, the six statistics and the arrival banner all read the one journey
 * object, so nothing on screen can disagree with anything else.
 */
public final class MapScreen extends FrameLayout implements MapView.InteractionListener {

    /** What the layer button cycles through. */
    private static final int[][] LAYER_MODES = {
        {0, 0},   // street
        {0, 1},   // street + railway detail
        {1, 0},   // terrain
        {1, 1},   // terrain + railway detail
    };
    private static final String[] LAYER_NAMES = {
        "Street", "Street + railway", "Terrain", "Terrain + railway"
    };

    /** Told when the passenger wants a different screen or action. */
    public interface Host {
        void onEndJourney();
        void onTogglePause();
        void onOpenRoute();
        void onChooseRoute();
    }

    private final MapView map;
    private final TrainMarker marker = new TrainMarker();
    private final RailOverlay rails;
    private final NextStationCard nextCard;
    private final StatsPanel stats;
    private final ArrivalCard arrival;
    private final CircleButton locateBtn;
    private final CircleButton layersBtn;
    private final CircleButton pauseBtn;
    private final PillButton endBtn;
    private final StatusChip chip;
    private final LinearLayout bottomStack;
    private final Host host;

    private int layerMode;
    private boolean ticking;
    private long lastTickNanos;
    private JourneyState state;
    private boolean statsCollapsed;
    private boolean hadFirstFix;

    private final Runnable ticker = new Runnable() {
        @Override public void run() {
            if (!ticking) return;
            long now = System.nanoTime();
            double dt = lastTickNanos == 0 ? 0 : (now - lastTickNanos) / 1e9;
            lastTickNanos = now;

            marker.update(dt);
            if (map.isFollowing() && marker.hasPosition()) {
                map.followTo(marker.displayLat(), marker.displayLon());
            }
            if (marker.isAnimating()) map.invalidate();
            postOnAnimation(this);
        }
    };

    public MapScreen(Context c, JourneyState state, Host host) {
        super(c);
        this.state = state;
        this.host = host;

        map = new MapView(c);
        map.setInteractionListener(this);
        rails = new RailOverlay(state);
        map.addOverlay(rails);
        map.addOverlay(new MapView.Overlay() {
            @Override public void draw(Canvas canvas, MapView m) {
                marker.draw(canvas, m);
            }
        });
        addView(map, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));

        // Elevation shadows are drawn outside a child's bounds, so every
        // container between a raised card and the window has to stop clipping.
        setClipChildren(false);
        setClipToPadding(false);

        // ---- top: menu + next station card ----
        LinearLayout top = Views.row(c);
        top.setGravity(Gravity.TOP);
        top.setClipChildren(false);
        top.setClipToPadding(false);
        CircleButton menu = new CircleButton(c, CircleButton.ICON_MENU, Ui.NAVY_CARD);
        menu.setOnClickListener(new OnClickListener() {
            @Override public void onClick(View v) { toggleStats(); }
        });
        LinearLayout.LayoutParams mp = Views.lp(Ui.dpi(50), Ui.dpi(50));
        mp.rightMargin = Ui.dpi(10);
        mp.topMargin = Ui.dpi(6);
        top.addView(menu, mp);

        nextCard = new NextStationCard(c);
        nextCard.setOnClickListener(new OnClickListener() {
            @Override public void onClick(View v) {
                if (MapScreen.this.state != null && MapScreen.this.state.needsRouteChoice) {
                    MapScreen.this.host.onChooseRoute();
                } else {
                    MapScreen.this.host.onOpenRoute();
                }
            }
        });
        top.addView(nextCard, Views.lpWeighted(1));

        LayoutParams topLp = new LayoutParams(LayoutParams.MATCH_PARENT,
                LayoutParams.WRAP_CONTENT, Gravity.TOP);
        topLp.setMargins(Ui.dpi(12), Ui.dpi(10), Ui.dpi(12), 0);
        addView(top, topLp);

        // ---- right: map controls ----
        LinearLayout side = Views.column(c);
        side.setGravity(Gravity.CENTER_HORIZONTAL);
        side.setClipChildren(false);
        CircleButton compass = new CircleButton(c, CircleButton.ICON_COMPASS, Ui.NAVY_CARD);
        compass.setOnClickListener(new OnClickListener() {
            @Override public void onClick(View v) { map.zoomBy(0); }
        });
        locateBtn = new CircleButton(c, CircleButton.ICON_LOCATE, Ui.NAVY_CARD);
        locateBtn.setActive(true);
        locateBtn.setOnClickListener(new OnClickListener() {
            @Override public void onClick(View v) { recentre(); }
        });
        layersBtn = new CircleButton(c, CircleButton.ICON_LAYERS, Ui.NAVY_CARD);
        layersBtn.setOnClickListener(new OnClickListener() {
            @Override public void onClick(View v) { cycleLayers(); }
        });
        LinearLayout.LayoutParams bp = Views.lp(Ui.dpi(48), Ui.dpi(48));
        bp.bottomMargin = Ui.dpi(12);
        side.addView(compass, bp);
        side.addView(locateBtn, new LinearLayout.LayoutParams(bp));
        side.addView(layersBtn, Views.lp(Ui.dpi(48), Ui.dpi(48)));

        LayoutParams sideLp = new LayoutParams(LayoutParams.WRAP_CONTENT,
                LayoutParams.WRAP_CONTENT, Gravity.END | Gravity.CENTER_VERTICAL);
        sideLp.setMargins(0, 0, Ui.dpi(14), 0);
        addView(side, sideLp);

        // ---- arrival banner ----
        arrival = new ArrivalCard(c);
        LayoutParams arrivalLp = new LayoutParams(LayoutParams.MATCH_PARENT,
                LayoutParams.WRAP_CONTENT, Gravity.CENTER);
        arrivalLp.setMargins(Ui.dpi(22), 0, Ui.dpi(22), 0);
        addView(arrival, arrivalLp);

        // ---- bottom: stats + actions ----
        bottomStack = Views.column(c);
        bottomStack.setClipChildren(false);
        bottomStack.setClipToPadding(false);
        chip = new StatusChip(c);
        LinearLayout.LayoutParams chipLp = Views.lp(LinearLayout.LayoutParams.WRAP_CONTENT,
                Ui.dpi(30));
        chipLp.gravity = Gravity.CENTER_HORIZONTAL;
        chipLp.bottomMargin = Ui.dpi(10);
        bottomStack.addView(chip, chipLp);

        stats = new StatsPanel(c);
        bottomStack.addView(stats, Views.lpMatchWrap());

        LinearLayout actions = Views.row(c);
        actions.setClipChildren(false);
        actions.setPadding(0, Ui.dpi(12), 0, 0);
        endBtn = new PillButton(c, "END JOURNEY", Ui.BLUE, Ui.WHITE);
        endBtn.setGlyph(PillButton.GLYPH_STOP);
        endBtn.setOnClickListener(new OnClickListener() {
            @Override public void onClick(View v) { MapScreen.this.host.onEndJourney(); }
        });
        pauseBtn = new CircleButton(c, CircleButton.ICON_PAUSE, Ui.WHITE);
        pauseBtn.setColours(Ui.NAVY_CARD, Ui.WHITE);
        pauseBtn.setOnClickListener(new OnClickListener() {
            @Override public void onClick(View v) { MapScreen.this.host.onTogglePause(); }
        });
        LinearLayout.LayoutParams endLp = new LinearLayout.LayoutParams(0, Ui.dpi(56), 1);
        endLp.rightMargin = Ui.dpi(12);
        actions.addView(endBtn, endLp);
        actions.addView(pauseBtn, Views.lp(Ui.dpi(56), Ui.dpi(56)));
        bottomStack.addView(actions, Views.lpMatchWrap());

        LayoutParams bottomLp = new LayoutParams(LayoutParams.MATCH_PARENT,
                LayoutParams.WRAP_CONTENT, Gravity.BOTTOM);
        bottomLp.setMargins(Ui.dpi(12), 0, Ui.dpi(12), Ui.dpi(12));
        addView(bottomStack, bottomLp);
    }

    // ------------------------------------------------------------------- state

    public void bind(JourneyState s) {
        this.state = s;
        nextCard.bind(s);
        stats.bind(s);

        boolean showArrival = arrival.bind(s);
        arrival.setVisibility(showArrival ? View.VISIBLE : View.GONE);
        // The banner and the six-up grid would fight for the same attention.
        bottomStack.setAlpha(showArrival ? 0.25f : 1f);

        pauseBtn.setKind(s.paused ? CircleButton.ICON_PLAY : CircleButton.ICON_PAUSE);
        chip.bind(s, map.tiles().pendingCount());

        if (s.hasFix) {
            marker.setTarget(s.lat, s.lon, s.bearing, s.speed, s.accuracy, s.snapped,
                    s.plan == null ? null : s.plan.path, s.alongNow);
            if (!ticking) startTicking();
            if (!hadFirstFix) {
                // The very first fix is a jump, not a pan: there is nowhere
                // meaningful to animate from.
                hadFirstFix = true;
                map.moveTo(s.lat, s.lon, 15.2);
            }
        }
        map.invalidate();
    }

    public void setRailIndex(RailIndex index) {
        rails.setIndex(index);
        map.invalidate();
    }

    private void recentre() {
        map.setFollow(true);
        locateBtn.setActive(true);
        if (marker.hasPosition()) {
            map.animateTo(marker.displayLat(), marker.displayLon(),
                    Math.max(map.zoom(), 15.0));
        }
    }

    private void toggleStats() {
        statsCollapsed = !statsCollapsed;
        stats.setVisibility(statsCollapsed ? View.GONE : View.VISIBLE);
    }

    private void cycleLayers() {
        layerMode = (layerMode + 1) % LAYER_MODES.length;
        int[] mode = LAYER_MODES[layerMode];
        map.setBaseLayer(TileSource.BASE_LAYERS[mode[0]]);
        map.setOverlayLayer(mode[1] == 1 ? TileSource.RAILWAY_OVERLAY : null);
        chip.flash(LAYER_NAMES[layerMode]);
    }

    // ------------------------------------------------------------- map events

    @Override public void onUserPanned() {
        locateBtn.setActive(false);
    }

    @Override public void onCameraChanged() {
        locateBtn.setActive(map.isFollowing());
    }

    // -------------------------------------------------------------- lifecycle

    public void startTicking() {
        if (ticking) return;
        ticking = true;
        lastTickNanos = 0;
        postOnAnimation(ticker);
    }

    public void stopTicking() {
        ticking = false;
    }

    @Override protected void onDetachedFromWindow() {
        stopTicking();
        super.onDetachedFromWindow();
    }

    /** Bytes of map imagery saved on this device. */
    public long cachedTileBytes() {
        return map.tiles().cache().diskBytes();
    }

    public void onLowMemory() {
        map.tiles().onLowMemory();
    }

    /** Forgets every saved tile, then redraws from whatever comes back. */
    public void clearTileCache() {
        map.tiles().cache().clear();
        map.invalidate();
    }

    /** Applies the system bar insets so nothing hides under the status bar. */
    public void applyInsets(int top, int bottom) {
        LayoutParams lp = (LayoutParams) ((View) nextCard.getParent()).getLayoutParams();
        lp.topMargin = top + Ui.dpi(10);
        ((View) nextCard.getParent()).setLayoutParams(lp);
    }

    /**
     * A small floating status pill: what the app is loading, or the layer that
     * was just chosen. Quiet by default, because most of the time there is
     * nothing to say.
     */
    private static final class StatusChip extends View {
        private final Paint bg = Ui.fill(0xF2102A4C);
        private final Paint text = Ui.textCentered(Ui.WHITE, Ui.sp(12), Ui.medium());
        private final Paint glyph = Icons.iconStroke(Ui.AMBER, Ui.dp(1.7f));
        private final RectF rect = new RectF();
        private final Path path = new Path();
        private String message;
        private boolean offlineIcon;
        private long flashUntil;
        private String flashText;

        StatusChip(Context c) {
            super(c);
            setVisibility(GONE);
        }

        void bind(JourneyState s, int tilesPending) {
            String m = null;
            offlineIcon = false;
            if (s.statusMessage != null && s.statusMessage.startsWith("Offline")) {
                m = "Offline - using saved map data";
                offlineIcon = true;
            } else if (s.loadingRailData) {
                m = "Loading railway data";
            } else if (!s.hasFix) {
                m = "Waiting for GPS";
            } else if (tilesPending > 6) {
                m = "Loading map";
            } else if (s.paused) {
                m = "Journey paused";
            }
            message = m;
            updateVisibility();
        }

        void flash(String s) {
            flashText = s;
            flashUntil = System.currentTimeMillis() + 1800;
            updateVisibility();
            postDelayed(new Runnable() {
                @Override public void run() { updateVisibility(); }
            }, 1900);
        }

        private String current() {
            if (flashText != null && System.currentTimeMillis() < flashUntil) return flashText;
            return message;
        }

        private void updateVisibility() {
            String c = current();
            setVisibility(c == null ? GONE : VISIBLE);
            requestLayout();
            invalidate();
        }

        @Override protected void onMeasure(int wSpec, int hSpec) {
            String c = current();
            float w = c == null ? 0 : text.measureText(c) + Ui.dp(offlineIcon ? 54 : 32);
            setMeasuredDimension(Math.round(w), Ui.dpi(30));
        }

        @Override protected void onDraw(Canvas canvas) {
            String c = current();
            if (c == null) return;
            rect.set(0, 0, getWidth(), getHeight());
            Ui.pill(canvas, rect, bg);
            float cx = getWidth() / 2f;
            if (offlineIcon) {
                canvas.drawPath(Icons.cloudOff(path, Ui.dp(18), rect.centerY(), Ui.dp(17)), glyph);
                cx += Ui.dp(10);
            }
            Ui.drawTextCentredV(canvas, c, cx, rect.centerY(), text);
        }
    }
}
