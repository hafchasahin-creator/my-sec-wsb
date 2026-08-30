package com.trainjourney.live.util;

import android.content.res.Resources;
import android.graphics.Canvas;
import android.graphics.Outline;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.os.Build;
import android.view.View;
import android.view.ViewOutlineProvider;

/**
 * The app's design tokens and small drawing helpers.
 *
 * Everything on screen is drawn with Canvas rather than assembled from stock
 * widgets, so the palette, the type ramp and the shadow recipe all live here
 * and nowhere else.
 */
public final class Ui {

    // ------------------------------------------------------------------ colour

    public static final int NAVY_CARD  = 0xFF102A4C;
    public static final int NAVY_DEEP  = 0xFF0B1B33;
    public static final int NAVY_SOFT  = 0xFF1B3A63;
    public static final int NAVY_LINE  = 0xFF23456F;

    public static final int BLUE       = 0xFF1E6FE8;
    public static final int BLUE_LIGHT = 0xFF4A90FF;
    public static final int BLUE_DARK  = 0xFF1553B8;

    public static final int AMBER      = 0xFFFFC53D;
    public static final int GREEN      = 0xFF22C55E;
    public static final int GREEN_DEEP = 0xFF15803D;
    public static final int RED        = 0xFFEF4444;
    public static final int ORANGE     = 0xFFF97316;
    public static final int PURPLE     = 0xFF8B5CF6;

    public static final int WHITE      = 0xFFFFFFFF;
    public static final int CARD       = 0xFFFFFFFF;
    public static final int PAGE_BG    = 0xFFF3F5F9;
    public static final int TEXT       = 0xFF0B1B33;
    public static final int TEXT_DIM   = 0xFF6B7A90;
    public static final int TEXT_FAINT = 0xFF9AA7B8;
    public static final int DIVIDER    = 0xFFE6EAF0;

    public static final int RAIL_DARK  = 0xFF39465A;
    public static final int RAIL_LIGHT = 0xFFF2F4F8;
    public static final int TRAIL      = 0xFF1E6FE8;
    public static final int MAP_BG     = 0xFFE9EDF2;

    // ----------------------------------------------------------------- metrics

    private static final float DENSITY = Resources.getSystem().getDisplayMetrics().density;
    private static final float SCALED  = Resources.getSystem().getDisplayMetrics().scaledDensity;

    /**
     * A hardware-accelerated canvas ignores blur mask filters and path effects
     * before API 28 - silently, so a blurred drop shadow would come out as a
     * hard dark slab and a dashed line as a solid one. Both are checked here and
     * every affected surface has a fallback that looks deliberate instead.
     */
    public static final boolean SUPPORTS_BLUR =
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.P;
    public static final boolean SUPPORTS_PATH_EFFECT =
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.P;

    private Ui() { }

    /** Density-independent pixels to device pixels. */
    public static float dp(float v) { return v * DENSITY; }

    /** Rounded dp, for anything that must land on a whole pixel. */
    public static int dpi(float v) { return Math.round(v * DENSITY); }

    /** Scale-independent pixels, honouring the user's font size setting. */
    public static float sp(float v) { return v * SCALED; }

    // ---------------------------------------------------------------- typeface

    public static Typeface regular()  { return Typeface.create("sans-serif", Typeface.NORMAL); }
    public static Typeface medium()   { return Typeface.create("sans-serif-medium", Typeface.NORMAL); }
    public static Typeface bold()     { return Typeface.create("sans-serif", Typeface.BOLD); }
    public static Typeface black()    { return Typeface.create("sans-serif-black", Typeface.NORMAL); }
    public static Typeface condensed(){ return Typeface.create("sans-serif-condensed", Typeface.NORMAL); }

    // ------------------------------------------------------------------ paints

    public static Paint fill(int colour) {
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setStyle(Paint.Style.FILL);
        p.setColor(colour);
        return p;
    }

    public static Paint stroke(int colour, float widthPx) {
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setStyle(Paint.Style.STROKE);
        p.setColor(colour);
        p.setStrokeWidth(widthPx);
        p.setStrokeCap(Paint.Cap.ROUND);
        p.setStrokeJoin(Paint.Join.ROUND);
        return p;
    }

    public static Paint text(int colour, float sizePx, Typeface tf) {
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(colour);
        p.setTextSize(sizePx);
        p.setTypeface(tf);
        p.setSubpixelText(true);
        return p;
    }

    public static Paint textCentered(int colour, float sizePx, Typeface tf) {
        Paint p = text(colour, sizePx, tf);
        p.setTextAlign(Paint.Align.CENTER);
        return p;
    }

    // ----------------------------------------------------------------- drawing

    /**
     * Gives a canvas-drawn card a real shadow.
     *
     * The framework renders elevation shadows from the view's outline on the
     * GPU, so this works identically on every supported version - unlike a blur
     * mask filter, which is quietly dropped before API 28.
     */
    public static void elevate(View v, final float cornerRadiusPx, float elevationPx) {
        v.setOutlineProvider(new ViewOutlineProvider() {
            @Override public void getOutline(View view, Outline outline) {
                outline.setRoundRect(0, 0, view.getWidth(), view.getHeight(), cornerRadiusPx);
            }
        });
        v.setElevation(elevationPx);
        v.setClipToOutline(false);
    }

    /** Same, for a round control. */
    public static void elevateOval(View v, float elevationPx) {
        v.setOutlineProvider(new ViewOutlineProvider() {
            @Override public void getOutline(View view, Outline outline) {
                int inset = Math.round(dp(3));
                outline.setOval(inset, inset, view.getWidth() - inset, view.getHeight() - inset);
            }
        });
        v.setElevation(elevationPx);
    }

    /** Rounded rectangle, the app's default card shape. */
    public static void card(Canvas c, RectF r, float radiusPx, Paint p) {
        c.drawRoundRect(r, radiusPx, radiusPx, p);
    }

    /** Fully rounded pill - used for buttons and status chips. */
    public static void pill(Canvas c, RectF r, Paint p) {
        float radius = r.height() / 2f;
        c.drawRoundRect(r, radius, radius, p);
    }

    /** Baseline that vertically centres text of this paint inside a band. */
    public static float centredBaseline(float centreY, Paint p) {
        Paint.FontMetrics fm = p.getFontMetrics();
        return centreY - (fm.ascent + fm.descent) / 2f;
    }

    /** Draws text vertically centred on {@code centreY}. */
    public static void drawTextCentredV(Canvas c, String s, float x, float centreY, Paint p) {
        c.drawText(s, x, centredBaseline(centreY, p), p);
    }

    /** Measures text height above the baseline, for tight layouts. */
    public static float capHeight(Paint p) {
        Rect r = new Rect();
        p.getTextBounds("Hg", 0, 2, r);
        return r.height();
    }

    /**
     * Truncates with an ellipsis so long station names never overrun their card.
     * Paint.breakText is used rather than TextUtils so the helper stays usable
     * from plain drawing code without a TextPaint.
     */
    public static String ellipsize(String s, Paint p, float maxWidth) {
        if (s == null) return "";
        if (p.measureText(s) <= maxWidth) return s;
        float dots = p.measureText("...");
        int n = p.breakText(s, true, Math.max(0, maxWidth - dots), null);
        if (n <= 0) return "...";
        return s.substring(0, n).trim() + "...";
    }

    /** Blends two ARGB colours. */
    public static int blend(int from, int to, float t) {
        t = (float) Geo.clamp(t, 0, 1);
        int a = (int) (Color.alpha(from) + (Color.alpha(to) - Color.alpha(from)) * t);
        int r = (int) (Color.red(from) + (Color.red(to) - Color.red(from)) * t);
        int g = (int) (Color.green(from) + (Color.green(to) - Color.green(from)) * t);
        int b = (int) (Color.blue(from) + (Color.blue(to) - Color.blue(from)) * t);
        return Color.argb(a, r, g, b);
    }

    /** Same colour at a different opacity. */
    public static int alpha(int colour, float a) {
        return Color.argb((int) (255 * Geo.clamp(a, 0, 1)),
                Color.red(colour), Color.green(colour), Color.blue(colour));
    }

    // --------------------------------------------------------------- animation

    /** Standard ease-out used for camera moves and card transitions. */
    public static float easeOut(float t) {
        t = (float) Geo.clamp(t, 0, 1);
        float inv = 1 - t;
        return 1 - inv * inv * inv;
    }

    /** Symmetric ease for pulses. */
    public static float easeInOut(float t) {
        t = (float) Geo.clamp(t, 0, 1);
        return t < 0.5f ? 4 * t * t * t : 1 - (float) Math.pow(-2 * t + 2, 3) / 2;
    }
}
