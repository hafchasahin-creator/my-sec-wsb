package com.trainjourney.live.ui;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.view.MotionEvent;
import android.view.View;

import com.trainjourney.live.util.Icons;
import com.trainjourney.live.util.Ui;

/** A filled pill button with an optional leading glyph. */
public final class PillButton extends View {

    public static final int GLYPH_NONE = -1;
    public static final int GLYPH_STOP = 0;
    public static final int GLYPH_CHECK = 1;
    public static final int GLYPH_PLAY = 2;

    private final Paint fill;
    private final Paint labelPaint;
    private final RectF rect = new RectF();
    private final Path path = new Path();

    private String label;
    private int glyph = GLYPH_NONE;
    private float press;
    private boolean enabledLook = true;

    public PillButton(Context c, String label, int background, int textColour) {
        super(c);
        this.label = label;
        fill = Ui.fill(background);
        labelPaint = Ui.textCentered(textColour, Ui.sp(16), Ui.medium());
        labelPaint.setLetterSpacing(0.02f);
        setClickable(true);
    }

    public void setLabel(String s) {
        this.label = s;
        invalidate();
    }

    public void setGlyph(int g) {
        this.glyph = g;
        invalidate();
    }

    public void setColours(int background, int textColour) {
        fill.setColor(background);
        labelPaint.setColor(textColour);
        invalidate();
    }

    public void setEnabledLook(boolean on) {
        this.enabledLook = on;
        setAlpha(on ? 1f : 0.55f);
        invalidate();
    }

    @Override public boolean onTouchEvent(MotionEvent e) {
        if (!enabledLook) return false;
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN: press = 1; invalidate(); break;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL: press = 0; invalidate(); break;
            default: break;
        }
        return super.onTouchEvent(e);
    }

    @Override protected void onSizeChanged(int w, int h, int ow, int oh) {
        super.onSizeChanged(w, h, ow, oh);
        // The pill's own radius is half its height, so the shadow outline has to
        // be rebuilt whenever it is measured.
        Ui.elevate(this, h / 2f, Ui.dp(5));
    }

    @Override protected void onDraw(Canvas canvas) {
        float inset = Ui.dp(1) + press * Ui.dp(1);
        rect.set(inset, inset, getWidth() - inset, getHeight() - inset);
        Ui.pill(canvas, rect, fill);

        float cy = rect.centerY();
        float textWidth = labelPaint.measureText(label);
        float glyphSize = Ui.sp(17);
        float gap = Ui.dp(10);
        boolean hasGlyph = glyph != GLYPH_NONE;
        float totalWidth = textWidth + (hasGlyph ? glyphSize + gap : 0);
        float startX = rect.centerX() - totalWidth / 2f;

        if (hasGlyph) {
            float gcx = startX + glyphSize / 2f;
            Paint p = Ui.fill(labelPaint.getColor());
            switch (glyph) {
                case GLYPH_STOP:
                    canvas.drawPath(Icons.stopSquare(path, gcx, cy, glyphSize), p);
                    break;
                case GLYPH_PLAY:
                    canvas.drawPath(Icons.play(path, gcx, cy, glyphSize), p);
                    break;
                default:
                    canvas.drawPath(Icons.check(path, gcx, cy, glyphSize),
                            Icons.iconStroke(labelPaint.getColor(), Ui.dp(2.4f)));
                    break;
            }
            startX += glyphSize + gap;
        }

        labelPaint.setTextAlign(Paint.Align.LEFT);
        Ui.drawTextCentredV(canvas, label, startX, cy, labelPaint);
    }
}
