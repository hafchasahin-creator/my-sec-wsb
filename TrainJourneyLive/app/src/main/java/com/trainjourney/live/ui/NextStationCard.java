package com.trainjourney.live.ui;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.view.View;

import com.trainjourney.live.engine.JourneyState;
import com.trainjourney.live.util.Fmt;
import com.trainjourney.live.util.Geo;
import com.trainjourney.live.util.Icons;
import com.trainjourney.live.util.Ui;

/**
 * The headline card: which station is next, how far, and how long.
 *
 * This is the one thing a passenger looks at, so it earns the largest type on
 * the screen and changes character as the station gets closer - upcoming, then
 * arriving, then arrived - rather than only changing a number.
 */
public final class NextStationCard extends View {

    private final Paint card = Ui.fill(Ui.NAVY_CARD);
    private final Paint kicker = Ui.text(0xFF7E9AC4, Ui.sp(11), Ui.medium());
    private final Paint name = Ui.text(Ui.WHITE, Ui.sp(27), Ui.black());
    private final Paint distance = Ui.text(Ui.AMBER, Ui.sp(15), Ui.medium());
    private final Paint etaLabel = Ui.text(0xFF7E9AC4, Ui.sp(11), Ui.medium());
    private final Paint etaValue = Ui.text(Ui.GREEN, Ui.sp(19), Ui.bold());
    private final Paint chevron = Icons.iconStroke(0xFF9DB3D4, Ui.dp(2.1f));
    private final Paint progressTrack = Ui.fill(0xFF1E3F69);
    private final Paint progressFill = Ui.fill(Ui.BLUE_LIGHT);
    private final Paint statusChip = Ui.fill(Ui.GREEN);
    private final Paint statusText = Ui.text(Ui.WHITE, Ui.sp(11.5f), Ui.bold());

    private final RectF rect = new RectF();
    private final Path path = new Path();

    private String kickerText = "NEXT STATION";
    private String stationName = "Waiting for GPS";
    private String distanceText = "Searching for satellites";
    private String etaText = "--";
    private String chipText;
    private float progress = -1;
    private boolean arrived;

    public NextStationCard(Context c) {
        super(c);
        kicker.setLetterSpacing(0.12f);
        etaLabel.setLetterSpacing(0.08f);
        statusText.setLetterSpacing(0.06f);
        setClickable(true);
        Ui.elevate(this, Ui.dp(20), Ui.dp(8));
    }

    /** Recomputes every string from the live journey. */
    public void bind(JourneyState s) {
        arrived = false;
        chipText = null;
        progress = -1;

        if (!s.hasFix) {
            kickerText = "NEXT STATION";
            stationName = "Waiting for GPS";
            distanceText = "Searching for satellites";
            etaText = "--";
        } else if (s.next == null) {
            kickerText = "NEXT STATION";
            if (!s.hasRailData) {
                stationName = "Loading railway";
                distanceText = s.loadingRailData ? "Downloading map data" : "No railway data yet";
            } else if (s.needsRouteChoice) {
                stationName = "Which way?";
                distanceText = "Tap to choose your route";
            } else {
                stationName = "Finding your line";
                distanceText = s.snapped ? "No stations mapped ahead" : "Looking for a railway nearby";
            }
            etaText = "--";
        } else {
            String n = s.next.station.name;
            double d = Math.max(0, s.next.distance);

            switch (s.phase) {
                case JourneyState.Phase.ARRIVED:
                    kickerText = "YOU ARE AT";
                    stationName = n;
                    distanceText = "Arrived" + (s.next.station.code != null
                            ? "  -  " + s.next.station.code : "");
                    chipText = n.toUpperCase(java.util.Locale.US) + " - ARRIVED";
                    arrived = true;
                    etaText = "--";
                    break;
                case JourneyState.Phase.DEPARTED:
                    kickerText = "DEPARTED";
                    stationName = n;
                    distanceText = "Next station coming up";
                    etaText = "--";
                    break;
                case JourneyState.Phase.ARRIVING:
                    kickerText = "ARRIVING AT";
                    stationName = n;
                    distanceText = Fmt.distance(d) + " away";
                    etaText = Fmt.eta(s.etaSeconds());
                    break;
                default:
                    kickerText = "NEXT STATION";
                    stationName = n;
                    distanceText = Fmt.distance(d) + " away";
                    etaText = Fmt.eta(s.etaSeconds());
                    break;
            }

            // Progress from the previous station to this one.
            if (s.previous != null) {
                double span = s.next.distance - s.previous.distance;
                if (span > 50) {
                    progress = (float) Geo.clamp(-s.previous.distance / span, 0, 1);
                }
            }
        }
        invalidate();
    }

    @Override protected void onMeasure(int wSpec, int hSpec) {
        setMeasuredDimension(MeasureSpec.getSize(wSpec), Ui.dpi(112));
    }

    @Override protected void onDraw(Canvas canvas) {
        rect.set(0, 0, getWidth(), getHeight());
        float radius = Ui.dp(20);
        card.setColor(arrived ? 0xFF0E3B2A : Ui.NAVY_CARD);
        canvas.drawRoundRect(rect, radius, radius, card);

        float left = rect.left + Ui.dp(18);
        float right = rect.right - Ui.dp(16);
        float top = rect.top + Ui.dp(15);

        // Right-hand ETA block and chevron.
        float chevronCx = right - Ui.dp(9);
        canvas.drawPath(Icons.chevronRight(path, chevronCx, rect.centerY(), Ui.dp(20)), chevron);
        float etaRight = chevronCx - Ui.dp(16);

        if (!"--".equals(etaText)) {
            etaLabel.setTextAlign(Paint.Align.RIGHT);
            etaValue.setTextAlign(Paint.Align.RIGHT);
            canvas.drawText("ETA", etaRight, top + Ui.dp(10), etaLabel);
            canvas.drawText("~" + etaText, etaRight, top + Ui.dp(34), etaValue);
        }

        float nameRight = ("--".equals(etaText) ? etaRight : etaRight - Ui.dp(74));
        float available = Math.max(Ui.dp(80), nameRight - left);

        canvas.drawText(kickerText, left, top + Ui.dp(10), kicker);

        // Shrink the station name until it fits, then ellipsize as a last resort.
        float size = Ui.sp(27);
        name.setTextSize(size);
        while (name.measureText(stationName) > available && size > Ui.sp(17)) {
            size -= Ui.sp(1);
            name.setTextSize(size);
        }
        String shown = Ui.ellipsize(stationName, name, available);
        canvas.drawText(shown, left, top + Ui.dp(40), name);

        if (chipText != null) {
            float chipH = Ui.dp(24);
            float chipW = statusText.measureText(chipText) + Ui.dp(22);
            rect.set(left, top + Ui.dp(50), left + chipW, top + Ui.dp(50) + chipH);
            Ui.pill(canvas, rect, statusChip);
            Ui.drawTextCentredV(canvas, chipText, left + Ui.dp(11), rect.centerY(), statusText);
        } else {
            distance.setColor(arrived ? Ui.GREEN : Ui.AMBER);
            canvas.drawText(Ui.ellipsize(distanceText, distance, available),
                    left, top + Ui.dp(64), distance);
        }

        if (progress >= 0) {
            float barY = getHeight() - Ui.dp(15);
            float barLeft = left, barRight = right - Ui.dp(4);
            rect.set(barLeft, barY, barRight, barY + Ui.dp(4));
            canvas.drawRoundRect(rect, Ui.dp(2), Ui.dp(2), progressTrack);
            rect.set(barLeft, barY, barLeft + (barRight - barLeft) * progress, barY + Ui.dp(4));
            canvas.drawRoundRect(rect, Ui.dp(2), Ui.dp(2), progressFill);
        }
    }
}
