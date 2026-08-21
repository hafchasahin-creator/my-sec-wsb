package com.imran.recorder.ui.settings

import android.os.Bundle
import android.view.View
import android.widget.ImageView
import android.widget.TextView
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import androidx.appcompat.widget.SwitchCompat
import androidx.fragment.app.Fragment
import com.imran.recorder.BuildConfig
import com.imran.recorder.R
import com.imran.recorder.billing.Pro
import com.imran.recorder.billing.ProFeature
import com.imran.recorder.data.AudioSource
import com.imran.recorder.data.MediaStoreRepo
import com.imran.recorder.data.Orientation
import com.imran.recorder.data.Prefs
import com.imran.recorder.overlay.OverlayService
import com.imran.recorder.record.EncoderCaps
import com.imran.recorder.ui.MainActivity
import com.imran.recorder.ui.SheetItem
import com.imran.recorder.ui.Sheets
import com.imran.recorder.ui.info.InfoActivity
import com.imran.recorder.ui.pro.ProActivity
import com.imran.recorder.util.Format
import com.imran.recorder.util.Perms
import com.imran.recorder.util.toast
import com.imran.recorder.util.visible

class SettingsFragment : Fragment(R.layout.fragment_settings), MainActivity.Refreshable {

    private val host get() = activity as? MainActivity

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        view.findViewById<View>(R.id.banner).setOnClickListener {
            InfoActivity.open(requireContext(), InfoActivity.PAGE_TUTORIAL)
        }
        bindAll()
    }

    override fun onResume() {
        super.onResume()
        bindAll()
    }

    override fun refresh() = bindAll()

    private fun bindAll() {
        val root = view ?: return

        row(
            root, R.id.rowPro, R.drawable.ic_crown,
            getString(R.string.settings_pro),
            if (Pro.isPro) getString(R.string.settings_pro_sub_active)
            else getString(R.string.settings_pro_sub_free)
        ) { ProActivity.open(requireContext()) }

        // --- recording method ---
        row(
            root, R.id.rowFloating, R.drawable.ic_bubble,
            getString(R.string.set_floating), getString(R.string.set_floating_sub),
            switch = Prefs.floatingEnabled
        ) { host?.toggleFloating(); root.postDelayed({ bindAll() }, 250) }

        row(
            root, R.id.rowFloatingPersist, R.drawable.ic_bubble,
            getString(R.string.set_floating_persist), getString(R.string.set_floating_persist_sub),
            switch = Prefs.floatingPersists
        ) { Prefs.floatingPersists = !Prefs.floatingPersists; bindAll() }

        row(
            root, R.id.rowCleanCapture, R.drawable.ic_shield,
            getString(R.string.set_clean_capture), getString(R.string.set_clean_capture_sub),
            switch = Prefs.keepOverlayOutOfVideo
        ) {
            Prefs.keepOverlayOutOfVideo = !Prefs.keepOverlayOutOfVideo
            OverlayService.reapplySecureFlag()
            bindAll()
        }

        row(
            root, R.id.rowFacecam, R.drawable.ic_facecam,
            getString(R.string.set_facecam),
            when {
                !Perms.hasFrontCamera(requireContext()) -> "No front camera on this device"
                OverlayService.facecamActive -> "Showing now"
                else -> "Front-camera bubble on top of recordings"
            },
            switch = OverlayService.facecamActive
        ) { toggleFacecam() }

        // --- video ---
        row(
            root, R.id.rowAudio, R.drawable.ic_mic,
            getString(R.string.set_audio), Prefs.audioSource.label
        ) { showAudioDialog() }

        row(
            root, R.id.rowResolution, R.drawable.ic_resolution,
            getString(R.string.set_resolution), Format.resolutionLabel(Prefs.resolution)
        ) { pickResolution() }

        row(
            root, R.id.rowQuality, R.drawable.ic_star,
            getString(R.string.set_quality), Format.qualityLabel(Prefs.quality)
        ) { pickQuality() }

        row(
            root, R.id.rowFps, R.drawable.ic_speed,
            getString(R.string.set_fps), "${Prefs.fps} FPS"
        ) { pickFps() }

        row(
            root, R.id.rowOrientation, R.drawable.ic_orientation,
            getString(R.string.set_orientation), Prefs.orientation.label
        ) { pickOrientation() }

        // --- control ---
        row(
            root, R.id.rowCountdown, R.drawable.ic_timer,
            getString(R.string.set_countdown),
            if (Prefs.countdown == 0) "Off" else "${Prefs.countdown} seconds"
        ) { pickCountdown() }

        row(
            root, R.id.rowLimit, R.drawable.ic_speed,
            getString(R.string.set_limit),
            if (Prefs.maxMinutes == 0) getString(R.string.set_limit_sub)
            else "After ${Prefs.maxMinutes} minutes"
        ) { pickLimit() }

        row(
            root, R.id.rowShake, R.drawable.ic_swap,
            getString(R.string.set_shake), getString(R.string.set_shake_sub),
            switch = Prefs.shakeToStop
        ) { Prefs.shakeToStop = !Prefs.shakeToStop; bindAll() }

        row(
            root, R.id.rowHaptics, R.drawable.ic_volume,
            getString(R.string.set_haptics), getString(R.string.set_haptics_sub),
            switch = Prefs.haptics
        ) { Prefs.haptics = !Prefs.haptics; bindAll() }

        // The subtitle carries what the sequence actually did last launch, and switching
        // it on plays it straight away, so "it never appeared" is answerable on the spot.
        row(
            root, R.id.rowIntro, R.drawable.ic_play,
            getString(R.string.set_intro),
            getString(R.string.set_intro_sub) + " \u00b7 last launch: " + Prefs.introLastResult,
            switch = Prefs.introEnabled
        ) {
            Prefs.introEnabled = !Prefs.introEnabled
            bindAll()
            if (Prefs.introEnabled) (activity as? MainActivity)?.playIntroPreview()
        }

        row(
            root, R.id.rowStorage, R.drawable.ic_storage,
            getString(R.string.set_storage), MediaStoreRepo.VIDEO_DIR
        ) { showStorageInfo() }

        // --- about ---
        row(root, R.id.rowFaq, R.drawable.ic_info, getString(R.string.faq), null) {
            InfoActivity.open(requireContext(), InfoActivity.PAGE_FAQ)
        }
        row(root, R.id.rowTutorial, R.drawable.ic_help, getString(R.string.tutorial), null) {
            InfoActivity.open(requireContext(), InfoActivity.PAGE_TUTORIAL)
        }
        row(root, R.id.rowFeedback, R.drawable.ic_feedback, getString(R.string.feedback), null) {
            host?.sendFeedback(false)
        }
        row(root, R.id.rowBug, R.drawable.ic_bug, getString(R.string.report_bug), null) {
            host?.sendFeedback(true)
        }
        row(root, R.id.rowShare, R.drawable.ic_share, getString(R.string.share_app), null) {
            host?.shareApp()
        }
        row(root, R.id.rowPrivacy, R.drawable.ic_shield, getString(R.string.privacy), null) {
            InfoActivity.open(requireContext(), InfoActivity.PAGE_PRIVACY)
        }
        row(
            root, R.id.rowVersion, R.drawable.ic_star,
            getString(R.string.version), BuildConfig.VERSION_NAME,
            chevron = false
        ) { }
    }

    /**
     * Included row layouts share child ids, so every lookup is scoped to its own
     * include root rather than the fragment root.
     */
    private fun row(
        root: View,
        includeId: Int,
        icon: Int,
        title: String,
        value: String?,
        switch: Boolean? = null,
        chevron: Boolean = true,
        onClick: () -> Unit
    ) {
        val rowView = root.findViewById<View>(includeId)
        rowView.findViewById<ImageView>(R.id.rowIcon).setImageResource(icon)
        rowView.findViewById<TextView>(R.id.rowTitle).text = title
        rowView.findViewById<TextView>(R.id.rowValue).apply {
            visible(value != null)
            text = value.orEmpty()
        }

        val toggle = rowView.findViewById<SwitchCompat>(R.id.rowSwitch)
        val arrow = rowView.findViewById<ImageView>(R.id.rowChevron)

        if (switch != null) {
            toggle.visible(true)
            toggle.setOnCheckedChangeListener(null)
            toggle.isChecked = switch
            toggle.isClickable = false
            toggle.isFocusable = false
            arrow.visible(false)
        } else {
            toggle.visible(false)
            arrow.visible(chevron)
        }

        rowView.setOnClickListener { onClick() }
    }

    // ---------------- pickers ----------------

    private fun showAudioDialog() {
        val ctx = context ?: return
        val view = layoutInflater.inflate(R.layout.dialog_audio, null)

        val swInternal = view.findViewById<SwitchCompat>(R.id.swInternal)
        val swMic = view.findViewById<SwitchCompat>(R.id.swMic)
        val swMute = view.findViewById<SwitchCompat>(R.id.swMute)

        val internalSupported = Perms.supportsInternalAudio(ctx)
        val micSupported = Perms.hasMicHardware(ctx)

        if (!internalSupported) {
            view.findViewById<TextView>(R.id.optInternalSub).text =
                "Not available on this Android version or device"
            view.findViewById<View>(R.id.optInternal).alpha = 0.45f
        }
        if (!micSupported) {
            view.findViewById<TextView>(R.id.optMicSub).text = "No microphone on this device"
            view.findViewById<View>(R.id.optMic).alpha = 0.45f
        }

        var internal = Prefs.audioSource.needsProjectionAudio && internalSupported
        var mic = Prefs.audioSource.needsMic && micSupported

        fun render() {
            swInternal.isChecked = internal
            swMic.isChecked = mic
            swMute.isChecked = !internal && !mic
        }
        render()

        view.findViewById<View>(R.id.optInternal).setOnClickListener {
            if (!internalSupported) return@setOnClickListener
            internal = !internal
            render()
        }
        view.findViewById<View>(R.id.optMic).setOnClickListener {
            if (!micSupported) return@setOnClickListener
            mic = !mic
            render()
        }
        view.findViewById<View>(R.id.optMute).setOnClickListener {
            internal = false
            mic = false
            render()
        }

        MaterialAlertDialogBuilder(ctx)
            .setTitle(R.string.audio_title)
            .setView(view)
            .setNegativeButton(R.string.cancel, null)
            .setPositiveButton(R.string.done) { _, _ -> applyAudio(internal, mic) }
            .show()
    }

    private fun applyAudio(internal: Boolean, mic: Boolean) {
        val chosen = when {
            internal && mic -> AudioSource.INTERNAL_MIC
            internal -> AudioSource.INTERNAL
            mic -> AudioSource.MIC
            else -> AudioSource.MUTE
        }
        if (chosen.needsMic && !Perms.mic(requireContext())) {
            host?.ensureMic { granted ->
                Prefs.audioSource = if (granted) chosen else {
                    if (internal) AudioSource.INTERNAL else AudioSource.MUTE
                }
                bindAll()
            }
        } else {
            Prefs.audioSource = chosen
            bindAll()
        }
    }

    private fun pickResolution() {
        val ctx = context ?: return
        Sheets.pick(
            ctx, getString(R.string.set_resolution),
            listOf(480, 720, 1080, 0),
            label = { Format.resolutionLabel(it) },
            subtitle = {
                when (it) {
                    480 -> "Smallest files"
                    720 -> "Balanced — recommended"
                    1080 -> "Sharp, larger files"
                    else -> "Matches your display exactly"
                }
            },
            enabled = { Pro.allowsResolution(it) },
            current = Prefs.resolution
        ) {
            if (!Pro.allowsResolution(it)) {
                ProActivity.promptFor(requireContext(), ProFeature.NATIVE_RESOLUTION)
            } else {
                Prefs.resolution = it
                bindAll()
            }
        }
    }

    private fun pickQuality() {
        val ctx = context ?: return
        Sheets.pick(
            ctx, getString(R.string.set_quality),
            listOf(0, 1, 2),
            label = { Format.qualityLabel(it) },
            subtitle = {
                when (it) {
                    0 -> "Lower bitrate, smaller files"
                    2 -> "Higher bitrate, best detail"
                    else -> "Recommended for most recordings"
                }
            },
            enabled = { Pro.allowsQuality(it) },
            current = Prefs.quality
        ) {
            if (!Pro.allowsQuality(it)) {
                ProActivity.promptFor(requireContext(), ProFeature.HIGH_QUALITY)
            } else {
                Prefs.quality = it
                bindAll()
            }
        }
    }

    private fun pickFps() {
        val ctx = context ?: return
        val max = EncoderCaps.maxFpsSupported()
        Sheets.pick(
            ctx, getString(R.string.set_fps),
            listOf(24, 30, 60),
            label = { "$it FPS" },
            subtitle = {
                when {
                    it > max -> "Above this device's encoder limit"
                    it == 24 -> "Cinematic, lightest on the CPU"
                    it == 30 -> "Standard"
                    else -> "Smooth — best for games"
                }
            },
            enabled = { it <= max && Pro.allowsFps(it) },
            current = Prefs.fps
        ) {
            if (!Pro.allowsFps(it)) {
                ProActivity.promptFor(requireContext(), ProFeature.HIGH_FPS)
            } else {
                Prefs.fps = it
                bindAll()
            }
        }
    }

    private fun pickOrientation() {
        val ctx = context ?: return
        Sheets.pick(
            ctx, getString(R.string.set_orientation),
            Orientation.entries.toList(),
            label = { it.label },
            subtitle = {
                when (it) {
                    Orientation.AUTO -> "Follows the screen when capture starts"
                    Orientation.PORTRAIT -> "Always records tall"
                    Orientation.LANDSCAPE -> "Always records wide"
                }
            },
            current = Prefs.orientation
        ) { Prefs.orientation = it; bindAll() }
    }

    private fun pickCountdown() {
        val ctx = context ?: return
        Sheets.pick(
            ctx, getString(R.string.set_countdown),
            listOf(0, 3, 5, 10),
            label = { if (it == 0) "Off" else "$it seconds" },
            subtitle = { if (it == 0) "Start capturing immediately" else null },
            current = Prefs.countdown
        ) { Prefs.countdown = it; bindAll() }
    }

    private fun pickLimit() {
        val ctx = context ?: return
        Sheets.pick(
            ctx, getString(R.string.set_limit),
            listOf(0, 5, 15, 30, 60),
            label = { if (it == 0) "No limit" else "$it minutes" },
            subtitle = {
                when (it) {
                    0 -> "Record until you stop it"
                    5 -> "Good for quick clips"
                    else -> null
                }
            },
            enabled = { it == 0 || !Pro.isLocked(ProFeature.AUTO_STOP) },
            current = Prefs.maxMinutes
        ) {
            if (it != 0 && Pro.isLocked(ProFeature.AUTO_STOP)) {
                ProActivity.promptFor(requireContext(), ProFeature.AUTO_STOP)
            } else {
                Prefs.maxMinutes = it
                bindAll()
            }
        }
    }

    private fun toggleFacecam() {
        val ctx = context ?: return
        if (!Perms.hasFrontCamera(ctx)) {
            ctx.toast("This device has no front camera")
            return
        }
        if (!OverlayService.facecamActive && Pro.isLocked(ProFeature.FACECAM)) {
            ProActivity.promptFor(ctx, ProFeature.FACECAM)
            return
        }
        if (OverlayService.facecamActive) {
            Prefs.facecamEnabled = false
            OverlayService.hideFacecam()
            view?.postDelayed({ bindAll() }, 200)
            return
        }
        host?.ensureCamera { granted ->
            if (!granted) {
                ctx.toast(getString(R.string.perm_cam_body))
                return@ensureCamera
            }
            host?.ensureOverlay {
                Prefs.facecamEnabled = true
                OverlayService.showFacecam(ctx)
                view?.postDelayed({ bindAll() }, 260)
            }
        }
    }

    private fun showStorageInfo() {
        val ctx = context ?: return
        val (free, total) = MediaStoreRepo.storage(ctx)
        Sheets.show(ctx, getString(R.string.set_storage), listOf(
            SheetItem(
                MediaStoreRepo.VIDEO_DIR, "Recordings", R.drawable.ic_video
            ) {},
            SheetItem(
                MediaStoreRepo.PHOTO_DIR, "Screenshots and GIFs", R.drawable.ic_photo
            ) {},
            SheetItem(
                getString(R.string.storage_free, Format.size(free), Format.size(total)),
                "Android's scoped storage fixes these locations, so they cannot be moved.",
                R.drawable.ic_storage
            ) {}
        ))
    }
}
