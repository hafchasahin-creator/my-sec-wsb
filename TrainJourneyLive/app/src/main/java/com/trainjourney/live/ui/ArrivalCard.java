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

/**
 * The full-width banner that takes over as a station arrives.
 *
 * It only appears inside the last kilometre and clears itself once the train is
 * away again, so it is an event rather than another permanent panel: station
 * illustration, the name in the largest type the app uses, and the countdown.
 */
public final class ArrivalCard extends View {

    private final Paint card = Ui.fill(Ui.CARD);
    private final Paint glyph = Icons.iconStroke(Ui.GREEN_DEEP, Ui.dp(2.1f));
    private final Paint kicker = Ui.textCentered(Ui.GREEN_DEEP, Ui.sp(13), Ui.medium());
    private final Paint name = Ui.textCentered(Ui.TEXT, Ui.sp(30), Ui.black());
    private final Paint caption = Ui.textCentered(Ui.TEXT_DIM, Ui.sp(13), Ui.regular());
    private final Paint bigNumber = Ui.textCentered(Ui.TEXT, Ui.sp(34), Ui.black());
    private final Paint chip = Ui.fill(Ui.GREEN_DEEP);
    private final Paint chipText = Ui.textCentered(Ui.WHITE, Ui.sp(14), Ui.bold());

    private final RectF rect = new RectF();
    private final Path path = new Path();

    private String kickerText = "ARRIVING AT";
    private String stationName = "";
    private String captionText = "You will arrive in";
    private String numberText = "";
    private String chipLabel;
    private boolean visible;

    public ArrivalCard(Context c) {
        super(c);
        kicker.setLetterSpacing(0.14f);
        chipText.setLetterSpacing(0.05f);
        setVisibility(View.GONE);
        Ui.elevate(this, Ui.dp(22), Ui.dp(12));
    }

    /**
     * @return true when the card wants to be on screen
     */
    public boolean bind(JourneyState s) {
        boolean show = s.next != null
                && (s.phase == JourneyState.Phase.ARRIVING
                 || s.phase == JourneyState.Phase.ARRIVED
                 || s.phase == JourneyState.Phase.DEPARTED);
        if (!show) {
            visible = false;
            return false;
        }

        stationName = s.next.station.name.toUpperCase(java.util.Locale.US);
        chipLabel = null;

        if (s.phase == JourneyState.Phase.ARRIVED) {
            kickerText = "ARRIVED AT";
            captionText = "Doors this side of the platform may vary";
            numberText = "";
            chipLabel = stationName + " - ARRIVED";
        } else if (s.phase == JourneyState.Phase.DEPARTED) {
            kickerText = "DEPARTED";
            captionText = "On the way to the next station";
            numberText = "";
            chipLabel = stationName + " - DEPARTED";
        } else {
            kickerText = "ARRIVING AT";
            double d = Math.max(0, s.next.distance);
            captionText = "You will arrive in";
            numberText = Fmt.distanceValue(d) + " " + Fmt.distanceUnit(d);
        }

        visible = true;
        invalidate();
        return true;
    }

    public boolean isShowing() {
        return visible;
    }

    @Override protected void onMeasure(int wSpec, int hSpec) {
        setMeasuredDimension(MeasureSpec.getSize(wSpec), Ui.dpi(232));
    }

    @Override protected void onDraw(Canvas canvas) {
        rect.set(0, 0, getWidth(), getHeight());
        float radius = Ui.dp(22);
        canvas.drawRoundRect(rect, radius, radius, card);

        float cx = rect.centerX();
        float y = rect.top + Ui.dp(20);

        canvas.drawPath(Icons.stationBuilding(path, cx, y + Ui.dp(24), Ui.dp(56)), glyph);
        y += Ui.dp(62);

        canvas.drawText(kickerText, cx, y, kicker);
        y += Ui.dp(30);

        float size = Ui.sp(30);
        name.setTextSize(size);
        while (name.measureText(stationName) > rect.width() - Ui.dp(40) && size > Ui.sp(18)) {
            size -= Ui.sp(1);
            name.setTextSize(size);
        }
        canvas.drawText(Ui.ellipsize(stationName, name, rect.width() - Ui.dp(32)), cx, y, name);
        y += Ui.dp(24);

        canvas.drawText(captionText, cx, y, caption);
        y += Ui.dp(34);

        if (!numberText.isEmpty()) {
            canvas.drawText(numberText, cx, y, bigNumber);
        }

        if (chipLabel != null) {
            float chipH = Ui.dp(42);
            float chipW = Math.min(rect.width() - Ui.dp(48),
                    chipText.measureText(chipLabel) + Ui.dp(44));
            rect.set(cx - chipW / 2f, rect.bottom - Ui.dp(20) - chipH,
                     cx + chipW / 2f, rect.bottom - Ui.dp(20));
            Ui.pill(canvas, rect, chip);
            Ui.drawTextCentredV(canvas,
                    Ui.ellipsize(chipLabel, chipText, chipW - Ui.dp(20)),
                    cx, rect.centerY(), chipText);
        }
    }
}
