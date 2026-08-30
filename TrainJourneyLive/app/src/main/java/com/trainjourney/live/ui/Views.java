package com.trainjourney.live.ui;

import android.content.Context;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.trainjourney.live.util.Ui;

/**
 * Small factories for the parts of the UI that are ordinary widgets.
 *
 * The data-dense surfaces - the map, the cards, the timeline - are drawn on a
 * Canvas, but running text stays in real TextViews so it wraps properly, scales
 * with the user's font size and is readable by a screen reader.
 */
public final class Views {

    private Views() { }

    public static TextView text(Context c, String s, float sp, int colour, Typeface tf) {
        TextView t = new TextView(c);
        t.setText(s);
        t.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(colour);
        t.setTypeface(tf);
        t.setIncludeFontPadding(false);
        return t;
    }

    public static TextView title(Context c, String s) {
        TextView t = text(c, s, 26, Ui.WHITE, Ui.black());
        t.setLineSpacing(0, 1.08f);
        return t;
    }

    public static TextView body(Context c, String s) {
        TextView t = text(c, s, 15, 0xFFB9C6DA, Ui.regular());
        t.setLineSpacing(Ui.dp(4), 1f);
        return t;
    }

    /** A solid rounded rectangle background. */
    public static GradientDrawable rounded(int colour, float radiusPx) {
        GradientDrawable d = new GradientDrawable();
        d.setShape(GradientDrawable.RECTANGLE);
        d.setColor(colour);
        d.setCornerRadius(radiusPx);
        return d;
    }

    /** A rounded rectangle with a hairline border. */
    public static GradientDrawable roundedOutline(int fill, int stroke, float radiusPx, float widthPx) {
        GradientDrawable d = rounded(fill, radiusPx);
        d.setStroke(Math.round(widthPx), stroke);
        return d;
    }

    public static View spacer(Context c, float dp) {
        View v = new View(c);
        v.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, Ui.dpi(dp)));
        return v;
    }

    public static LinearLayout column(Context c) {
        LinearLayout l = new LinearLayout(c);
        l.setOrientation(LinearLayout.VERTICAL);
        return l;
    }

    public static LinearLayout row(Context c) {
        LinearLayout l = new LinearLayout(c);
        l.setOrientation(LinearLayout.HORIZONTAL);
        l.setGravity(Gravity.CENTER_VERTICAL);
        return l;
    }

    public static LinearLayout.LayoutParams lp(int w, int h) {
        return new LinearLayout.LayoutParams(w, h);
    }

    public static LinearLayout.LayoutParams lpMatchWrap() {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    /** Weighted child, for evenly divided rows. */
    public static LinearLayout.LayoutParams lpWeighted(float weight) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.WRAP_CONTENT, weight);
        return p;
    }

    // ------------------------------------------------------------------ insets

    /** Top system-bar inset in pixels, across API levels. */
    @SuppressWarnings("deprecation")
    public static int topInset(WindowInsets insets) {
        if (insets == null) return 0;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return insets.getInsets(WindowInsets.Type.systemBars()).top;
        }
        return insets.getSystemWindowInsetTop();
    }

    /** Bottom system-bar inset in pixels, across API levels. */
    @SuppressWarnings("deprecation")
    public static int bottomInset(WindowInsets insets) {
        if (insets == null) return 0;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return insets.getInsets(WindowInsets.Type.systemBars()).bottom;
        }
        return insets.getSystemWindowInsetBottom();
    }

    /** Makes a view respond to taps with a subtle press state. */
    public static void pressable(final View v) {
        v.setClickable(true);
        v.setOnTouchListener(new View.OnTouchListener() {
            @Override public boolean onTouch(View view, android.view.MotionEvent e) {
                switch (e.getActionMasked()) {
                    case android.view.MotionEvent.ACTION_DOWN:
                        view.animate().scaleX(0.97f).scaleY(0.97f).setDuration(90).start();
                        break;
                    case android.view.MotionEvent.ACTION_UP:
                    case android.view.MotionEvent.ACTION_CANCEL:
                        view.animate().scaleX(1f).scaleY(1f).setDuration(120).start();
                        break;
                    default:
                        break;
                }
                return false;      // let the click listener still fire
            }
        });
    }
}
