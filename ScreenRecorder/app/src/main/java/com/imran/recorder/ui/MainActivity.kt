package com.imran.recorder.ui

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.ImageView
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import androidx.appcompat.app.AppCompatActivity
import androidx.fragment.app.Fragment
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.imran.recorder.BuildConfig
import com.imran.recorder.R
import com.imran.recorder.data.Prefs
import com.imran.recorder.overlay.OverlayService
import com.imran.recorder.record.RecState
import com.imran.recorder.record.RecorderBus
import com.imran.recorder.record.RecorderService
import com.imran.recorder.ui.info.InfoActivity
import com.imran.recorder.ui.photo.PhotoFragment
import com.imran.recorder.ui.settings.SettingsFragment
import com.imran.recorder.ui.tools.ToolsFragment
import com.imran.recorder.ui.video.VideoFragment
import com.imran.recorder.util.Format
import com.imran.recorder.util.Perms
import com.imran.recorder.util.padBottomForNavBar
import com.imran.recorder.util.padTopForStatusBar
import com.imran.recorder.util.pressBounce
import com.imran.recorder.util.toast
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {

    enum class Tab { VIDEO, PHOTO, EDIT, SETTINGS }

    private var current = Tab.VIDEO

    private lateinit var recordButton: View
    private lateinit var recordIcon: ImageView
    private lateinit var recordLabel: TextView

    private var pendingPermission: ((Boolean) -> Unit)? = null
    private var pendingOverlay: (() -> Unit)? = null

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            pendingPermission?.invoke(granted)
            pendingPermission = null
        }

    private val overlayLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
            // The system dialog reports nothing useful, so re-check the real state.
            if (Perms.overlay(this)) {
                pendingOverlay?.invoke()
            } else {
                toast(getString(R.string.perm_overlay_body))
            }
            pendingOverlay = null
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        findViewById<View>(R.id.topBar).padTopForStatusBar()
        findViewById<View>(R.id.bottomNav).padBottomForNavBar()

        recordButton = findViewById(R.id.recordButton)
        recordIcon = findViewById(R.id.recordIcon)
        recordLabel = findViewById(R.id.recordLabel)

        recordButton.setOnClickListener {
            it.pressBounce()
            onRecordPressed()
        }

        findViewById<View>(R.id.navVideo).setOnClickListener { select(Tab.VIDEO) }
        findViewById<View>(R.id.navPhoto).setOnClickListener { select(Tab.PHOTO) }
        findViewById<View>(R.id.navEdit).setOnClickListener { select(Tab.EDIT) }
        findViewById<View>(R.id.navSettings).setOnClickListener { select(Tab.SETTINGS) }

        findViewById<View>(R.id.navQuick).setOnClickListener {
            it.pressBounce()
            showQuickSheet()
        }
        findViewById<View>(R.id.topShot).setOnClickListener { takeScreenshot() }
        findViewById<View>(R.id.topMenu).setOnClickListener { showMenuSheet() }

        current = Tab.entries[savedInstanceState?.getInt(KEY_TAB, 0) ?: 0]
        // On a config change the FragmentManager restores the fragment itself.
        if (savedInstanceState == null) showFragment(current) else syncNav()

        observe()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putInt(KEY_TAB, current.ordinal)
    }

    // ---------------- navigation ----------------

    private fun select(tab: Tab) {
        if (tab == current && supportFragmentManager.findFragmentById(R.id.container) != null) return
        current = tab
        showFragment(tab)
        syncNav()
    }

    private fun showFragment(tab: Tab) {
        val fragment: Fragment = when (tab) {
            Tab.VIDEO -> VideoFragment()
            Tab.PHOTO -> PhotoFragment()
            Tab.EDIT -> ToolsFragment()
            Tab.SETTINGS -> SettingsFragment()
        }
        supportFragmentManager.beginTransaction()
            .setCustomAnimations(R.anim.tab_enter, R.anim.fade_out)
            .replace(R.id.container, fragment)
            .commit()
        syncNav()
    }

    private fun syncNav() {
        fun paint(rootId: Int, iconId: Int, textId: Int, on: Boolean) {
            findViewById<View>(rootId).isSelected = on
            findViewById<ImageView>(iconId).isSelected = on
            findViewById<TextView>(textId).isSelected = on
        }
        paint(R.id.navVideo, R.id.navVideoIcon, R.id.navVideoText, current == Tab.VIDEO)
        paint(R.id.navPhoto, R.id.navPhotoIcon, R.id.navPhotoText, current == Tab.PHOTO)
        paint(R.id.navEdit, R.id.navEditIcon, R.id.navEditText, current == Tab.EDIT)
        paint(R.id.navSettings, R.id.navSettingsIcon, R.id.navSettingsText, current == Tab.SETTINGS)
    }

    // ---------------- recorder ----------------

    private fun onRecordPressed() {
        when (RecorderBus.state.value) {
            RecState.IDLE -> startRecording()
            RecState.COUNTDOWN, RecState.RECORDING, RecState.PAUSED ->
                RecorderService.send(this, RecorderService.ACTION_STOP)
            RecState.STARTING, RecState.SAVING -> Unit
        }
    }

    /** Collects the permissions this configuration needs, then hands off to the service. */
    fun startRecording() {
        ensureNotifications {
            val needsMic = Prefs.audioSource.needsMic
            if (needsMic && !Perms.mic(this)) {
                explain(R.string.perm_mic_title, R.string.perm_mic_body) {
                    request(Manifest.permission.RECORD_AUDIO) { granted ->
                        if (!granted) {
                            // Keep the recording possible instead of blocking on a denial.
                            Prefs.audioSource = com.imran.recorder.data.AudioSource.MUTE
                            toast("Recording without audio")
                        }
                        RecorderService.requestStart(this)
                    }
                }
            } else {
                RecorderService.requestStart(this)
            }
        }
    }

    fun takeScreenshot() {
        ensureNotifications { RecorderService.requestScreenshot(this) }
    }

    private fun bindRecordState(state: RecState, elapsed: Long) {
        val (bg, label, icon) = when (state) {
            RecState.RECORDING -> Triple(
                R.drawable.rp_pill_record, Format.clock(elapsed), R.drawable.ic_stop_square
            )
            RecState.PAUSED -> Triple(
                R.drawable.rp_pill_record,
                "${getString(R.string.state_paused)} · ${Format.clock(elapsed)}",
                R.drawable.ic_stop_square
            )
            RecState.COUNTDOWN -> Triple(
                R.drawable.rp_pill_record, getString(R.string.starting), R.drawable.ic_close
            )
            RecState.STARTING -> Triple(
                R.drawable.rp_pill_record, getString(R.string.starting), R.drawable.ic_record_dot
            )
            RecState.SAVING -> Triple(
                R.drawable.rp_pill_brand, getString(R.string.saving), R.drawable.ic_record_dot
            )
            RecState.IDLE -> Triple(
                R.drawable.rp_pill_brand, getString(R.string.record), R.drawable.ic_record_dot
            )
        }
        recordButton.setBackgroundResource(bg)
        recordLabel.text = label
        recordIcon.setImageResource(icon)
        recordButton.isEnabled = state != RecState.SAVING && state != RecState.STARTING
        recordButton.alpha = if (recordButton.isEnabled) 1f else 0.7f
    }

    private fun observe() {
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch {
                    RecorderBus.state.collectLatest { bindRecordState(it, RecorderBus.elapsedMs.value) }
                }
                launch {
                    RecorderBus.elapsedMs.collectLatest { bindRecordState(RecorderBus.state.value, it) }
                }
                launch {
                    RecorderBus.messages.collectLatest { toast(it) }
                }
            }
        }
    }

    // ---------------- permissions ----------------

    private fun request(permission: String, onResult: (Boolean) -> Unit) {
        if (Perms.has(this, permission)) {
            onResult(true)
            return
        }
        pendingPermission = onResult
        permissionLauncher.launch(permission)
    }

    fun ensureNotifications(next: () -> Unit) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || Perms.notifications(this)) {
            next()
            return
        }
        explain(R.string.perm_notif_title, R.string.perm_notif_body) {
            request(Manifest.permission.POST_NOTIFICATIONS) { next() }
        }
    }

    fun ensureMic(next: (Boolean) -> Unit) {
        if (Perms.mic(this)) {
            next(true); return
        }
        explain(R.string.perm_mic_title, R.string.perm_mic_body) {
            request(Manifest.permission.RECORD_AUDIO, next)
        }
    }

    fun ensureCamera(next: (Boolean) -> Unit) {
        if (Perms.camera(this)) {
            next(true); return
        }
        explain(R.string.perm_cam_title, R.string.perm_cam_body) {
            request(Manifest.permission.CAMERA, next)
        }
    }

    fun ensureOverlay(next: () -> Unit) {
        if (Perms.overlay(this)) {
            next(); return
        }
        explain(R.string.perm_overlay_title, R.string.perm_overlay_body) {
            pendingOverlay = next
            runCatching { overlayLauncher.launch(Perms.overlayIntent(this)) }
                .onFailure { toast("Could not open the permission screen") }
        }
    }

    /** Context before the system prompt, so a denial is an informed one. */
    private fun explain(titleRes: Int, bodyRes: Int, onContinue: () -> Unit) {
        MaterialAlertDialogBuilder(this)
            .setTitle(titleRes)
            .setMessage(bodyRes)
            .setNegativeButton(R.string.not_now, null)
            .setPositiveButton(R.string.grant) { _, _ -> onContinue() }
            .show()
    }

    // ---------------- sheets ----------------

    private fun showQuickSheet() {
        Sheets.show(this, getString(R.string.nav_create), listOf(
            SheetItem(
                getString(R.string.record),
                "Capture the screen right now",
                R.drawable.ic_record_dot
            ) { startRecording() },
            SheetItem(
                getString(R.string.tool_screenshot),
                "Save a still of the current screen",
                R.drawable.ic_screenshot
            ) { takeScreenshot() },
            SheetItem(
                getString(R.string.tool_floating),
                if (Prefs.floatingEnabled) "Currently on" else "Controls that follow you into other apps",
                R.drawable.ic_bubble
            ) { toggleFloating() },
            SheetItem(
                getString(R.string.tools_title),
                "Trim, compress, GIF and photo tools",
                R.drawable.ic_tools
            ) { select(Tab.EDIT) }
        ))
    }

    private fun showMenuSheet() {
        Sheets.show(this, getString(R.string.app_name), listOf(
            SheetItem(getString(R.string.tutorial), null, R.drawable.ic_help) {
                InfoActivity.open(this, InfoActivity.PAGE_TUTORIAL)
            },
            SheetItem(getString(R.string.faq), null, R.drawable.ic_info) {
                InfoActivity.open(this, InfoActivity.PAGE_FAQ)
            },
            SheetItem(getString(R.string.feedback), null, R.drawable.ic_feedback) { sendFeedback(false) },
            SheetItem(getString(R.string.report_bug), null, R.drawable.ic_bug) { sendFeedback(true) },
            SheetItem(getString(R.string.share_app), null, R.drawable.ic_share) { shareApp() },
            SheetItem(getString(R.string.privacy), null, R.drawable.ic_shield) {
                InfoActivity.open(this, InfoActivity.PAGE_PRIVACY)
            },
            SheetItem(getString(R.string.version), BuildConfig.VERSION_NAME, R.drawable.ic_star) {}
        ))
    }

    fun toggleFloating() {
        if (Prefs.floatingEnabled) {
            Prefs.floatingEnabled = false
            OverlayService.hideBubble()
            toast("Floating controls off")
            refreshCurrentFragment()
        } else {
            ensureOverlay {
                Prefs.floatingEnabled = true
                OverlayService.showBubble(this)
                toast("Floating controls on")
                refreshCurrentFragment()
            }
        }
    }

    private fun refreshCurrentFragment() {
        (supportFragmentManager.findFragmentById(R.id.container) as? Refreshable)?.refresh()
    }

    fun sendFeedback(isBug: Boolean) {
        val subject = if (isBug) "Imran Recorder — problem report" else "Imran Recorder — feedback"
        val body = buildString {
            appendLine()
            appendLine("---")
            appendLine("App version: ${BuildConfig.VERSION_NAME}")
            appendLine("Android: ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
            appendLine("Device: ${Build.MANUFACTURER} ${Build.MODEL}")
        }
        val intent = Intent(Intent.ACTION_SENDTO).apply {
            data = android.net.Uri.parse("mailto:")
            putExtra(Intent.EXTRA_SUBJECT, subject)
            putExtra(Intent.EXTRA_TEXT, body)
        }
        runCatching { startActivity(Intent.createChooser(intent, subject)) }
            .onFailure { toast("No email app is set up on this device") }
    }

    fun shareApp() {
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(
                Intent.EXTRA_TEXT,
                "I record my screen with Imran Recorder — screen capture, screenshots and " +
                    "floating controls in one app."
            )
        }
        startActivity(Intent.createChooser(intent, getString(R.string.share_app)))
    }

    override fun onResume() {
        super.onResume()
        bindRecordState(RecorderBus.state.value, RecorderBus.elapsedMs.value)
        // The bubble can be dismissed from its own close button while we were away.
        if (Prefs.floatingEnabled && !OverlayService.bubbleActive && Perms.overlay(this)) {
            OverlayService.showBubble(this)
        }
    }

    /** Fragments that keep list state fresh implement this. */
    interface Refreshable {
        fun refresh()
    }

    companion object {
        private const val KEY_TAB = "tab"
    }
}
