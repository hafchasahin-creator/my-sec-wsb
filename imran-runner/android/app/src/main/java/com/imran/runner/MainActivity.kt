package com.imran.runner

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.fadeOut
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.imran.runner.data.RunRecord
import com.imran.runner.data.RunStats
import com.imran.runner.tracking.RoutePoint
import com.imran.runner.tracking.RunState
import com.imran.runner.ui.components.BottomNav
import com.imran.runner.ui.components.NavTab
import com.imran.runner.ui.screens.BrandIntro
import com.imran.runner.ui.screens.HistoryScreen
import com.imran.runner.ui.screens.LockOverlay
import com.imran.runner.ui.screens.ProfileScreen
import com.imran.runner.ui.screens.RunDetailScreen
import com.imran.runner.ui.screens.RunScreen
import com.imran.runner.ui.screens.RunSummaryOverlay
import com.imran.runner.ui.screens.StatsScreen
import com.imran.runner.ui.theme.ImranColors
import com.imran.runner.ui.theme.ImranRunnerTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {

    private val app: ImranRunnerApp get() = application as ImranRunnerApp

    private var permissionGranted by mutableStateOf(false)
    private var locationEnabled by mutableStateOf(true)

    private val requestPermissions =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            refreshPermissionState()
            if (permissionGranted) app.tracker.onPermissionGranted()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        refreshPermissionState()

        setContent {
            ImranRunnerTheme {
                ImranRunnerRoot(
                    permissionGranted = permissionGranted,
                    locationEnabled = locationEnabled,
                    onRequestPermission = ::askForLocation,
                    onKeepScreenOn = ::setKeepScreenOn,
                )
            }
        }
    }

    override fun onStart() {
        super.onStart()
        refreshPermissionState()
        // Holding the tracker while on screen is what gives a GPS lock and a live speed reading
        // before the run has even started.
        app.tracker.acquire()
    }

    override fun onStop() {
        app.tracker.release()
        super.onStop()
    }

    private fun refreshPermissionState() {
        permissionGranted = app.tracker.hasLocationPermission()
        locationEnabled = app.tracker.isLocationEnabled()
    }

    private fun askForLocation() {
        if (!locationEnabled) {
            runCatching {
                startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
            }
            return
        }
        if (permissionGranted) return

        val wanted = mutableListOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            wanted += Manifest.permission.POST_NOTIFICATIONS
        }

        val canAsk = shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_FINE_LOCATION) ||
            !hasAskedBefore
        hasAskedBefore = true

        if (canAsk) {
            requestPermissions.launch(wanted.toTypedArray())
        } else {
            // Permanently declined: the only way back is the system settings page.
            runCatching {
                startActivity(
                    Intent(
                        Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.fromParts("package", packageName, null),
                    ),
                )
            }
        }
    }

    private var hasAskedBefore = false

    private fun setKeepScreenOn(on: Boolean) {
        if (on) {
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
            window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }
}

@Composable
private fun ImranRunnerRoot(
    permissionGranted: Boolean,
    locationEnabled: Boolean,
    onRequestPermission: () -> Unit,
    onKeepScreenOn: (Boolean) -> Unit,
) {
    val context = LocalContext.current
    val application = context.applicationContext as ImranRunnerApp
    val tracker = application.tracker
    val scope = rememberCoroutineScope()

    val metrics by tracker.metrics.collectAsStateWithLifecycle()
    val runs by application.repository.runs.collectAsStateWithLifecycle()
    val profile by application.profileStore.profile.collectAsStateWithLifecycle()

    var tab by remember { mutableStateOf(NavTab.Run) }
    var locked by remember { mutableStateOf(false) }
    var openRun by remember { mutableStateOf<RunRecord?>(null) }
    var justFinished by remember { mutableStateOf<RunRecord?>(null) }
    var introDone by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        delay(1_600)
        introDone = true
    }

    // The display stays awake only while it is actually being used to time a run.
    val keepAwake = profile.keepScreenOn &&
        (metrics.state == RunState.RUNNING || metrics.state == RunState.PAUSED)
    DisposableEffect(keepAwake) {
        onKeepScreenOn(keepAwake)
        onDispose { onKeepScreenOn(false) }
    }

    // Locking only makes sense during a run; ending one always releases it.
    LaunchedEffect(metrics.state) {
        if (metrics.state != RunState.RUNNING && metrics.state != RunState.PAUSED) locked = false
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(ImranColors.Background),
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.safeDrawing),
        ) {
            Box(Modifier.weight(1f)) {
                val detail = openRun
                when {
                    detail != null -> {
                        var route by remember(detail.id) {
                            mutableStateOf(emptyList<RoutePoint>())
                        }
                        LaunchedEffect(detail.id) {
                            route = withContext(Dispatchers.IO) {
                                application.repository.route(detail.id)
                            }
                        }
                        RunDetailScreen(
                            run = detail,
                            route = route,
                            onBack = { openRun = null },
                            onDelete = {
                                val id = detail.id
                                openRun = null
                                scope.launch(Dispatchers.IO) { application.repository.delete(id) }
                            },
                        )
                    }

                    tab == NavTab.Run -> RunScreen(
                        metrics = metrics,
                        locked = locked,
                        permissionGranted = permissionGranted,
                        locationEnabled = locationEnabled,
                        onPrimary = {
                            if (!permissionGranted || !locationEnabled) {
                                onRequestPermission()
                            } else {
                                tracker.toggle()
                            }
                        },
                        onLock = { locked = true },
                        onFinish = {
                            val saved = tracker.finish()
                            if (saved == null) tracker.reset() else justFinished = saved
                        },
                        onSettings = { tab = NavTab.Profile },
                        onRequestPermission = onRequestPermission,
                    )

                    tab == NavTab.History -> HistoryScreen(
                        runs = runs,
                        routeFor = { application.repository.route(it) },
                        onOpen = { openRun = it },
                    )

                    tab == NavTab.Stats -> StatsScreen(
                        runs = runs,
                        stats = remember(runs) { RunStats.from(runs) },
                    )

                    else -> ProfileScreen(
                        profile = profile,
                        totalRuns = runs.size,
                        versionName = BuildInfo.VERSION_NAME,
                        onProfileChange = { transform ->
                            application.profileStore.update(transform)
                        },
                        onClearHistory = {
                            scope.launch(Dispatchers.IO) { application.repository.clearAll() }
                        },
                    )
                }
            }

            if (openRun == null) {
                Box(Modifier.fillMaxWidth().padding(horizontal = 20.dp)) {
                    BottomNav(selected = tab, onSelect = { tab = it })
                }
                Spacer(Modifier.height(10.dp))
            }
        }

        // Above the bottom navigation as well as the run screen: a locked phone in a pocket must
        // not be able to change tabs any more than it can stop the run.
        if (locked) {
            LockOverlay(onUnlock = { locked = false })
        }

        justFinished?.let { saved ->
            RunSummaryOverlay(
                run = saved,
                onDone = {
                    justFinished = null
                    tracker.reset()
                },
                onViewHistory = {
                    justFinished = null
                    tracker.reset()
                    tab = NavTab.History
                },
            )
        }

        AnimatedVisibility(
            visible = !introDone,
            enter = EnterTransition.None,
            exit = fadeOut(animationSpec = tween(520)),
        ) {
            BrandIntro()
        }
    }
}

/** Version string, kept here so the BuildConfig class does not need to be generated. */
internal object BuildInfo {
    const val VERSION_NAME = "1.0.0"
}
