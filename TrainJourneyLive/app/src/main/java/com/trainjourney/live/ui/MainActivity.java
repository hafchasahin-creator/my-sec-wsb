package com.trainjourney.live.ui;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.Toast;

import com.trainjourney.live.TrainJourneyApp;
import com.trainjourney.live.data.RailIndex;
import com.trainjourney.live.data.Station;
import com.trainjourney.live.engine.JourneyState;
import com.trainjourney.live.engine.RouteEngine;
import com.trainjourney.live.map.TileCache;
import com.trainjourney.live.service.TrackingService;
import com.trainjourney.live.util.Ui;

import java.util.List;

/**
 * The host: four screens over one live journey.
 *
 * The engine lives at application scope and the service keeps it fed, so this
 * activity is a pure view layer - it can be destroyed and rebuilt on a rotation
 * without the journey noticing.
 */
public final class MainActivity extends Activity
        implements RouteEngine.Listener, BottomNav.Listener,
                   MapScreen.Host, RouteScreen.Host, StationsScreen.Host, JourneyScreen.Host {

    private RouteEngine engine;
    private FrameLayout content;
    private BottomNav nav;

    private MapScreen mapScreen;
    private RouteScreen routeScreen;
    private StationsScreen stationsScreen;
    private JourneyScreen journeyScreen;

    private int insetTop, insetBottom;
    private boolean journeyRecorded;
    private TileCache tileCache;

    @Override protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        if (!hasLocationPermission()) {
            startActivity(new Intent(this, OnboardingActivity.class));
            finish();
            return;
        }

        engine = TrainJourneyApp.engine();
        engine.setNotificationTarget(MainActivity.class);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Ui.PAGE_BG);

        content = new FrameLayout(this);
        root.addView(content, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        nav = new BottomNav(this);
        nav.setListener(this);
        root.addView(nav, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                insetTop = Views.topInset(insets);
                insetBottom = Views.bottomInset(insets);
                nav.setBottomInset(insetBottom);
                if (mapScreen != null) mapScreen.applyInsets(insetTop, insetBottom);
                applyHeaderInsets();
                return insets;
            }
        });

        setContentView(root);
        showTab(BottomNav.TAB_MAP);

        if (!engine.state().tracking) {
            if (!engine.startJourney()) {
                Toast.makeText(this,
                        "Could not start location updates. Check that GPS is on.",
                        Toast.LENGTH_LONG).show();
            }
            journeyRecorded = false;
        }
        TrackingService.start(this);
    }

    @Override protected void onStart() {
        super.onStart();
        if (engine == null) return;
        engine.addListener(this);
        engine.resumeTracking();
        onJourneyUpdated(engine.state());
        if (mapScreen != null) mapScreen.startTicking();
    }

    @Override protected void onStop() {
        if (engine != null) engine.removeListener(this);
        if (mapScreen != null) mapScreen.stopTicking();
        super.onStop();
    }

    @Override protected void onResume() {
        super.onResume();
        if (engine != null && !hasLocationPermission()) {
            startActivity(new Intent(this, OnboardingActivity.class));
            finish();
        }
    }

    private boolean hasLocationPermission() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    // ------------------------------------------------------------------- tabs

    @Override public void onTabSelected(int tab) {
        showTab(tab);
    }

    private void showTab(int tab) {
        content.removeAllViews();
        View v;
        switch (tab) {
            case BottomNav.TAB_ROUTE:
                v = routeScreen();
                break;
            case BottomNav.TAB_STATIONS:
                v = stationsScreen();
                break;
            case BottomNav.TAB_JOURNEY:
                v = journeyScreen();
                break;
            default:
                v = mapScreen();
                break;
        }
        content.addView(v, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        applyHeaderInsets();
        if (engine != null) onJourneyUpdated(engine.state());
        if (mapScreen != null) {
            if (tab == BottomNav.TAB_MAP) mapScreen.startTicking();
            else mapScreen.stopTicking();
        }
    }

    private void applyHeaderInsets() {
        if (mapScreen != null) mapScreen.applyInsets(insetTop, insetBottom);
        for (int i = 0; i < content.getChildCount(); i++) {
            View child = content.getChildAt(i);
            if (child instanceof LinearLayout) {
                child.setPadding(0, insetTop, 0, 0);
            }
        }
    }

    private MapScreen mapScreen() {
        if (mapScreen == null) {
            mapScreen = new MapScreen(this, engine.state(), this);
            mapScreen.setRailIndex(engine.repo().index());
        }
        return mapScreen;
    }

    private RouteScreen routeScreen() {
        if (routeScreen == null) routeScreen = new RouteScreen(this, this);
        return routeScreen;
    }

    private StationsScreen stationsScreen() {
        if (stationsScreen == null) stationsScreen = new StationsScreen(this, this);
        return stationsScreen;
    }

    private JourneyScreen journeyScreen() {
        if (journeyScreen == null) journeyScreen = new JourneyScreen(this, this);
        return journeyScreen;
    }

    // ------------------------------------------------------------ engine hooks

    @Override public void onJourneyUpdated(JourneyState state) {
        switch (nav == null ? BottomNav.TAB_MAP : nav.selected()) {
            case BottomNav.TAB_ROUTE:
                if (routeScreen != null) routeScreen.bind(state);
                break;
            case BottomNav.TAB_STATIONS:
                if (stationsScreen != null) stationsScreen.bind(state);
                break;
            case BottomNav.TAB_JOURNEY:
                if (journeyScreen != null) journeyScreen.bind(state);
                break;
            default:
                if (mapScreen != null) {
                    // The repository swaps in a new snapshot as cells load, so
                    // the overlay is re-pointed at the current one every update.
                    mapScreen.setRailIndex(engine.repo().index());
                    mapScreen.bind(state);
                }
                break;
        }
    }

    @Override public void onStationPhase(int phase, Station station) {
        if (phase == JourneyState.Phase.ARRIVED && mapScreen != null) {
            // Nudge the camera back to the train so the arrival is actually seen.
            mapScreen.bind(engine.state());
        }
    }

    // ----------------------------------------------------------- screen hosts

    @Override public void onEndJourney() {
        new AlertDialog.Builder(this)
                .setTitle("End this journey?")
                .setMessage("Tracking stops and the journey is saved to this phone.")
                .setNegativeButton("Keep tracking", null)
                .setPositiveButton("End journey", new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int which) {
                        finishJourney();
                    }
                })
                .show();
    }

    private void finishJourney() {
        if (!journeyRecorded) {
            journeyRecorded = true;
            journeyScreen().recordJourney(engine.state());
        }
        engine.endJourney();
        TrackingService.stop(this);
        goToTab(BottomNav.TAB_JOURNEY);
        Toast.makeText(this, "Journey saved on this device", Toast.LENGTH_SHORT).show();
    }

    @Override public void onTogglePause() {
        engine.setPaused(!engine.state().paused);
    }

    @Override public void onOpenRoute() {
        goToTab(BottomNav.TAB_ROUTE);
    }

    @Override public void onOpenMap() {
        goToTab(BottomNav.TAB_MAP);
    }

    /** Moves the bar and the content together, whichever way the change came. */
    private void goToTab(int tab) {
        if (nav.selected() == tab) showTab(tab);
        else nav.select(tab);      // the listener does the rest
    }

    @Override public void onChooseRoute() {
        final List<Station> options = engine.candidateDestinations();
        if (options.isEmpty()) {
            Toast.makeText(this, "No stations known yet - waiting for railway data",
                    Toast.LENGTH_SHORT).show();
            return;
        }
        int n = Math.min(options.size(), 40);
        final CharSequence[] names = new CharSequence[n];
        for (int i = 0; i < n; i++) names[i] = options.get(i).label();

        new AlertDialog.Builder(this)
                .setTitle("Where are you heading?")
                .setItems(names, new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int which) {
                        engine.chooseDestination(options.get(which));
                        Toast.makeText(MainActivity.this,
                                "Destination set to " + options.get(which).name,
                                Toast.LENGTH_SHORT).show();
                    }
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    @Override public void onDestinationChosen(Station s) {
        engine.chooseDestination(s);
        Toast.makeText(this, s.name + " set as your destination", Toast.LENGTH_SHORT).show();
    }

    @Override public void onDestinationCleared() {
        engine.clearDestination();
        Toast.makeText(this, "Destination cleared", Toast.LENGTH_SHORT).show();
    }

    @Override public void onClearMapCache() {
        engine.repo().clearCache();
        if (tileCache == null) tileCache = new TileCache(this);
        tileCache.clear();
        if (mapScreen != null) {
            mapScreen.clearTileCache();
            mapScreen.setRailIndex(RailIndex.EMPTY);
        }
        Toast.makeText(this, "Saved map data cleared", Toast.LENGTH_SHORT).show();
    }

    @Override public void onClearHistory() {
        Toast.makeText(this, "Journey history cleared", Toast.LENGTH_SHORT).show();
    }

    @Override public long cachedTileBytes() {
        if (mapScreen != null) return mapScreen.cachedTileBytes();
        // The journey tab can be opened before the map has ever been built, so
        // measure the store directly rather than forcing a MapView into existence.
        if (tileCache == null) tileCache = new TileCache(this);
        return tileCache.diskBytes();
    }

    @Override public int cachedCellCount() {
        return engine == null ? 0 : engine.repo().cachedCellCount();
    }

    // ------------------------------------------------------------------- back

    @Override public void onBackPressed() {
        if (nav != null && nav.selected() != BottomNav.TAB_MAP) {
            goToTab(BottomNav.TAB_MAP);
            return;
        }
        moveTaskToBack(true);
    }

    @Override public void onLowMemory() {
        super.onLowMemory();
        if (mapScreen != null) mapScreen.onLowMemory();
    }
}
