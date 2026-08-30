package com.trainjourney.live.ui;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Canvas;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Shader;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import com.trainjourney.live.util.Icons;
import com.trainjourney.live.util.Ui;

/**
 * First run: explain what the app does, then ask for precise location.
 *
 * The ask is made once the reason for it is on screen, because the whole app is
 * one question - where is this train right now - and a coarse fix cannot answer
 * it. On Android 12 and later the passenger can grant approximate location by
 * mistake, so that case is detected and explained rather than silently
 * producing a train that drifts a kilometre off the rails.
 */
public final class OnboardingActivity extends Activity {

    private static final int REQ_LOCATION = 11;
    private static final int REQ_NOTIFICATIONS = 12;

    private TextView statusLine;
    private PillButton action;
    private boolean askedOnce;

    @Override protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        if (hasPrecise()) {
            launchMain();
            return;
        }
        setContentView(buildUi());
    }

    @Override protected void onResume() {
        super.onResume();
        if (askedOnce && hasPrecise()) launchMain();
        else refresh();
    }

    // --------------------------------------------------------------------- ui

    private View buildUi() {
        final ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Ui.NAVY_DEEP);
        scroll.setFillViewport(true);

        LinearLayout col = Views.column(this);
        col.setPadding(Ui.dpi(26), Ui.dpi(20), Ui.dpi(26), Ui.dpi(28));
        scroll.addView(col, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        scroll.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                v.setPadding(0, Views.topInset(insets), 0, Views.bottomInset(insets));
                return insets;
            }
        });

        HeroView hero = new HeroView(this);
        col.addView(hero, Views.lp(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dpi(180)));

        col.addView(Views.spacer(this, 18));

        TextView title = Views.title(this, "Train Journey Live");
        col.addView(title);

        col.addView(Views.spacer(this, 10));
        TextView sub = Views.body(this,
                "Live station tracking from inside the train you are actually sitting in. "
              + "Your phone's GPS is the train's position - no operator feed needed.");
        col.addView(sub);

        col.addView(Views.spacer(this, 24));
        col.addView(feature("Your train on the real railway",
                "Real OpenStreetMap tracks and stations, with a 2D train that moves and turns "
              + "with you and stays on the line.", FEATURE_RAIL));
        col.addView(feature("Stations announced automatically",
                "Next station, distance and ETA update as you travel. Arrival and departure "
              + "are detected for you, with a buzz you can feel in a pocket.", FEATURE_BELL));
        col.addView(feature("Built for no signal",
                "Map and railway data are saved on the phone the first time they load, so "
              + "tracking carries on through tunnels and dead zones.", FEATURE_OFFLINE));

        col.addView(Views.spacer(this, 8));

        LinearLayout privacy = Views.row(this);
        privacy.setBackground(Views.rounded(0xFF14294A, Ui.dp(14)));
        privacy.setPadding(Ui.dpi(14), Ui.dpi(13), Ui.dpi(14), Ui.dpi(13));
        GlyphView shield = new GlyphView(this, FEATURE_SHIELD, Ui.GREEN);
        privacy.addView(shield, Views.lp(Ui.dpi(22), Ui.dpi(22)));
        TextView pt = Views.text(this,
                "Your location and journey history stay on this phone. "
              + "Nothing is sent to any server of ours - there isn't one.",
                13, 0xFFAEC0D8, Ui.regular());
        pt.setPadding(Ui.dpi(12), 0, 0, 0);
        pt.setLineSpacing(Ui.dp(3), 1f);
        privacy.addView(pt);
        col.addView(privacy, Views.lpMatchWrap());

        col.addView(Views.spacer(this, 22));

        statusLine = Views.text(this, "", 13, Ui.AMBER, Ui.medium());
        statusLine.setVisibility(View.GONE);
        statusLine.setLineSpacing(Ui.dp(3), 1f);
        col.addView(statusLine, Views.lpMatchWrap());
        col.addView(Views.spacer(this, 10));

        action = new PillButton(this, "Enable precise location", Ui.BLUE, Ui.WHITE);
        action.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { onActionTapped(); }
        });
        col.addView(action, Views.lp(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dpi(56)));

        col.addView(Views.spacer(this, 14));
        TextView legal = Views.text(this,
                "Map imagery and railway data (c) OpenStreetMap contributors, ODbL. "
              + "Downloaded on demand and cached on this device.",
                11, 0xFF7C8CA6, Ui.regular());
        legal.setGravity(Gravity.CENTER_HORIZONTAL);
        legal.setLineSpacing(Ui.dp(2), 1f);
        col.addView(legal, Views.lpMatchWrap());

        return scroll;
    }

    private static final int FEATURE_RAIL = 0;
    private static final int FEATURE_BELL = 1;
    private static final int FEATURE_OFFLINE = 2;
    private static final int FEATURE_SHIELD = 3;

    private View feature(String head, String detail, int glyph) {
        LinearLayout row = Views.row(this);
        row.setGravity(Gravity.TOP);
        row.setPadding(0, 0, 0, Ui.dpi(18));

        LinearLayout badge = new LinearLayout(this);
        badge.setBackground(Views.rounded(0xFF17325C, Ui.dp(12)));
        badge.setGravity(Gravity.CENTER);
        GlyphView g = new GlyphView(this, glyph, Ui.BLUE_LIGHT);
        badge.addView(g, Views.lp(Ui.dpi(22), Ui.dpi(22)));
        row.addView(badge, Views.lp(Ui.dpi(42), Ui.dpi(42)));

        LinearLayout texts = Views.column(this);
        texts.setPadding(Ui.dpi(14), 0, 0, 0);
        texts.addView(Views.text(this, head, 15.5f, Ui.WHITE, Ui.medium()));
        TextView d = Views.text(this, detail, 13, 0xFF93A5BF, Ui.regular());
        d.setPadding(0, Ui.dpi(3), 0, 0);
        d.setLineSpacing(Ui.dp(3), 1f);
        texts.addView(d);
        row.addView(texts, Views.lpWeighted(1));
        return row;
    }

    /** A single vector glyph, sized to its view. */
    private static final class GlyphView extends View {
        private final Path p = new Path();
        private final Paint paint;
        private final int kind;

        GlyphView(Context c, int kind, int colour) {
            super(c);
            this.kind = kind;
            paint = Icons.iconStroke(colour, Ui.dp(1.9f));
        }

        @Override protected void onDraw(Canvas canvas) {
            float cx = getWidth() / 2f, cy = getHeight() / 2f;
            float s = Math.min(getWidth(), getHeight());
            switch (kind) {
                case FEATURE_RAIL:    canvas.drawPath(Icons.railway(p, cx, cy, s), paint); break;
                case FEATURE_BELL:    canvas.drawPath(Icons.bell(p, cx, cy, s), paint); break;
                case FEATURE_OFFLINE: canvas.drawPath(Icons.cloudOff(p, cx, cy, s), paint); break;
                default:              canvas.drawPath(Icons.shield(p, cx, cy, s), paint); break;
            }
        }
    }

    /** The illustration at the top: rails receding, with a train on them. */
    private static final class HeroView extends View {
        private final Paint rail = Ui.stroke(0xFF20416F, Ui.dp(3));
        private final Paint sleeper = Ui.stroke(0xFF1A3861, Ui.dp(3));
        private final Paint body = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint glass = Ui.fill(0xFF0B1B33);
        private final Paint lamp = Ui.fill(Ui.AMBER);
        private final Paint glow = Ui.fill(Ui.alpha(Ui.BLUE, 0.18f));
        private final Path train = new Path();

        HeroView(Context c) {
            super(c);
        }

        @Override protected void onDraw(Canvas canvas) {
            float w = getWidth(), h = getHeight();
            float cx = w / 2f;

            // Rails converging towards the top.
            float topGap = w * 0.06f, bottomGap = w * 0.30f;
            canvas.drawLine(cx - topGap, h * 0.06f, cx - bottomGap, h, rail);
            canvas.drawLine(cx + topGap, h * 0.06f, cx + bottomGap, h, rail);
            for (int i = 0; i < 9; i++) {
                float t = i / 8f;
                float y = h * (0.06f + 0.94f * t * t);
                float g = topGap + (bottomGap - topGap) * t * t;
                canvas.drawLine(cx - g * 1.16f, y, cx + g * 1.16f, y, sleeper);
            }

            float len = h * 0.46f;
            float hw = len * 0.235f;
            float ty = h * 0.60f;
            canvas.drawCircle(cx, ty, len * 0.78f, glow);

            canvas.save();
            canvas.translate(cx, ty);
            float half = len / 2f, r = hw * 0.42f;
            train.reset();
            train.moveTo(0, -half);
            train.cubicTo(hw * 0.8f, -half, hw, -half + len * 0.16f, hw, -half + len * 0.26f);
            train.lineTo(hw, half - r);
            train.quadTo(hw, half, hw - r, half);
            train.lineTo(-hw + r, half);
            train.quadTo(-hw, half, -hw, half - r);
            train.lineTo(-hw, -half + len * 0.26f);
            train.cubicTo(-hw, -half + len * 0.16f, -hw * 0.8f, -half, 0, -half);
            train.close();
            body.setShader(new LinearGradient(-hw, 0, hw, 0,
                    0xFF4A90FF, 0xFF1553B8, Shader.TileMode.CLAMP));
            canvas.drawPath(train, body);
            body.setShader(null);

            canvas.drawRoundRect(-hw * 0.78f, -half + len * 0.12f,
                    hw * 0.78f, -half + len * 0.30f, hw * 0.2f, hw * 0.2f, glass);
            canvas.drawRoundRect(-hw * 0.70f, -len * 0.05f,
                    -hw * 0.18f, len * 0.14f, hw * 0.1f, hw * 0.1f, glass);
            canvas.drawRoundRect(hw * 0.18f, -len * 0.05f,
                    hw * 0.70f, len * 0.14f, hw * 0.1f, hw * 0.1f, glass);
            canvas.drawCircle(-hw * 0.52f, -half + len * 0.06f, len * 0.036f, lamp);
            canvas.drawCircle(hw * 0.52f, -half + len * 0.06f, len * 0.036f, lamp);
            canvas.restore();
        }
    }

    // ------------------------------------------------------------ permissions

    private boolean hasPrecise() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasCoarseOnly() {
        return !hasPrecise()
                && checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)
                    == PackageManager.PERMISSION_GRANTED;
    }

    private boolean permanentlyDenied() {
        return !hasPrecise()
                && askedOnce
                && !shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_FINE_LOCATION);
    }

    private void onActionTapped() {
        if (hasPrecise()) {
            launchMain();
        } else if (permanentlyDenied() || hasCoarseOnly()) {
            openAppSettings();
        } else {
            askedOnce = true;
            requestPermissions(new String[]{
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
        }
    }

    @Override public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (code == REQ_LOCATION) {
            if (hasPrecise()) {
                requestNotificationsThenGo();
            } else {
                refresh();
            }
        } else if (code == REQ_NOTIFICATIONS) {
            launchMain();
        }
    }

    private void requestNotificationsThenGo() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},
                    REQ_NOTIFICATIONS);
        } else {
            launchMain();
        }
    }

    private void refresh() {
        if (statusLine == null || action == null) return;
        if (hasCoarseOnly()) {
            statusLine.setText("Approximate location was granted. That is accurate to about a "
                    + "kilometre, which is not enough to tell one station from the next. "
                    + "Please switch this app to Precise location.");
            statusLine.setVisibility(View.VISIBLE);
            action.setLabel("Open location settings");
        } else if (permanentlyDenied()) {
            statusLine.setText("Location is blocked for this app. Turn it on under "
                    + "Permissions to start tracking your journey.");
            statusLine.setVisibility(View.VISIBLE);
            action.setLabel("Open app settings");
        } else {
            statusLine.setVisibility(View.GONE);
            action.setLabel("Enable precise location");
        }
    }

    private void openAppSettings() {
        try {
            Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.fromParts("package", getPackageName(), null));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (Throwable e) {
            startActivity(new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS));
        }
    }

    private void launchMain() {
        startActivity(new Intent(this, MainActivity.class));
        overridePendingTransition(0, 0);
        finish();
    }
}
