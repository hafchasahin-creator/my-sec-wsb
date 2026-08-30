package com.trainjourney.live.ui;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.view.MotionEvent;
import android.view.View;

import com.trainjourney.live.util.Icons;
import com.trainjourney.live.util.Ui;

/**
 * The round map controls: locate, layers, compass, pause.
 *
 * The glyph is a vector path chosen by kind, so the buttons stay sharp at any
 * density and the app ships no icon bitmaps.
 */
public final class CircleButton extends View {

    public static final int ICON_LOCATE  = 0;
    public static final int ICON_LAYERS  = 1;
    public static final int ICON_COMPASS = 2;
    public static final int ICON_PAUSE   = 3;
    public static final int ICON_PLAY    = 4;
    public static final int ICON_MENU    = 5;
    public static final int ICON_CLOSE   = 6;

    private final Paint bg = Ui.fill(0xFFFFFFFF);
    private final Paint glyph;
    private final Paint compassSouth;
    private final Path path = new Path();

    private int kind;
    private boolean active;
    private int tint;
    private int background = 0xFFFFFFFF;
    private float pressAmount;

    public CircleButton(Context c, int kind, int tint) {
        super(c);
        this.kind = kind;
        this.tint = tint;
        glyph = Icons.iconStroke(tint, Ui.dp(2.1f));
        compassSouth = Ui.fill(0xFFB9C4D2);
        setClickable(true);
        Ui.elevateOval(this, Ui.dp(5));
    }

    public void setKind(int kind) {
        this.kind = kind;
        invalidate();
    }

    /** Highlights the button, e.g. while follow mode is on. */
    public void setActive(boolean a) {
        if (active == a) return;
        active = a;
        invalidate();
    }

    public boolean isActive() {
        return active;
    }

    public void setColours(int background, int tint) {
        this.background = background;
        this.tint = tint;
        bg.setColor(background);
        glyph.setColor(tint);
        invalidate();
    }

    @Override public boolean onTouchEvent(MotionEvent e) {
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                pressAmount = 1;
                invalidate();
                break;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                pressAmount = 0;
                invalidate();
                break;
            default:
                break;
        }
        return super.onTouchEvent(e);
    }

    @Override protected void onDraw(Canvas canvas) {
        float cx = getWidth() / 2f, cy = getHeight() / 2f;
        float r = Math.min(cx, cy) - Ui.dp(3) - pressAmount * Ui.dp(1);

        bg.setColor(active ? Ui.BLUE : background);
        canvas.drawCircle(cx, cy, r, bg);

        int ink = active ? 0xFFFFFFFF : tint;
        glyph.setColor(ink);
        float size = r * 1.12f;

        switch (kind) {
            case ICON_LOCATE:
                canvas.drawPath(Icons.locate(path, cx, cy, size), glyph);
                break;
            case ICON_LAYERS:
                canvas.drawPath(Icons.layers(path, cx, cy, size), glyph);
                break;
            case ICON_COMPASS: {
                Paint fillN = Ui.fill(0xFFE23B3B);
                canvas.drawPath(Icons.compassNorth(path, cx, cy, size), fillN);
                canvas.drawPath(Icons.compassSouth(path, cx, cy, size), compassSouth);
                break;
            }
            case ICON_PAUSE: {
                Paint f = Ui.fill(ink);
                canvas.drawPath(Icons.pause(path, cx, cy, size * 0.92f), f);
                break;
            }
            case ICON_PLAY: {
                Paint f = Ui.fill(ink);
                canvas.drawPath(Icons.play(path, cx, cy, size * 0.92f), f);
                break;
            }
            case ICON_MENU:
                canvas.drawPath(Icons.menu(path, cx, cy, size), glyph);
                break;
            case ICON_CLOSE:
                canvas.drawPath(Icons.close(path, cx, cy, size), glyph);
                break;
            default:
                break;
        }
    }
}
