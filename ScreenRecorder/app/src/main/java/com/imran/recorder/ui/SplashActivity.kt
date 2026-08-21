package com.imran.recorder.ui

import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.VideoView
import androidx.appcompat.app.AppCompatActivity
import com.imran.recorder.R
import com.imran.recorder.data.Prefs

/**
 * Branded intro. Plays the packaged clip full-bleed with an animated tagline and a
 * progress hairline, then hands off. Skippable by tapping anywhere, and it falls back to
 * the static mark if the device cannot play the clip.
 */
class SplashActivity : AppCompatActivity() {

    private lateinit var root: FrameLayout
    private lateinit var video: VideoView
    private lateinit var mark: View
    private lateinit var tagline: View
    private lateinit var skip: View
    private lateinit var progress: View

    private var advanced = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContentView(R.layout.activity_splash)

        root = findViewById(R.id.splashRoot)
        video = findViewById(R.id.introVideo)
        mark = findViewById(R.id.splashMark)
        tagline = findViewById(R.id.splashTagline)
        skip = findViewById(R.id.splashSkip)
        progress = findViewById(R.id.splashProgress)

        root.setOnClickListener { advance() }
        skip.setOnClickListener { advance() }

        if (Prefs.introEnabled) startIntro() else runStaticSplash()
    }

    // ---------------- video intro ----------------

    private fun startIntro() {
        val uri = Uri.parse("android.resource://$packageName/${R.raw.intro}")

        video.setOnPreparedListener { player ->
            player.isLooping = false
            applyVolume(player)
            coverScale(player.videoWidth, player.videoHeight)

            // The static mark covers the first frame so there is never a black flash.
            mark.animate().alpha(0f).setDuration(180).withEndAction {
                mark.visibility = View.GONE
            }.start()
            video.visibility = View.VISIBLE

            val durationMs = video.duration.coerceAtLeast(1).toLong()
            runTimeline(durationMs)
            video.start()
        }

        video.setOnCompletionListener { advance() }
        video.setOnErrorListener { _, _, _ ->
            // Any decode problem falls back rather than stranding the user on a black screen.
            runStaticSplash()
            true
        }

        video.setVideoURI(uri)
    }

    /** Scales the clip to cover the screen, cropping the overflow instead of letterboxing. */
    private fun coverScale(videoWidth: Int, videoHeight: Int) {
        if (videoWidth <= 0 || videoHeight <= 0) return
        val screenW = root.width.takeIf { it > 0 } ?: resources.displayMetrics.widthPixels
        val screenH = root.height.takeIf { it > 0 } ?: resources.displayMetrics.heightPixels

        val scale = maxOf(
            screenW.toFloat() / videoWidth,
            screenH.toFloat() / videoHeight
        )
        video.layoutParams = (video.layoutParams as FrameLayout.LayoutParams).apply {
            width = (videoWidth * scale).toInt()
            height = (videoHeight * scale).toInt()
            gravity = android.view.Gravity.CENTER
        }
    }

    /**
     * Startup sound is intrusive, so it follows the ringer: silent or vibrate means muted,
     * and there is a setting for people who never want it.
     */
    private fun applyVolume(player: MediaPlayer) {
        val audio = getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        val ringerAllows = audio?.ringerMode == AudioManager.RINGER_MODE_NORMAL
        val on = Prefs.introSound && ringerAllows
        runCatching { player.setVolume(if (on) 1f else 0f, if (on) 1f else 0f) }
    }

    /** Overlay beats timed against the clip rather than hard-coded to its length. */
    private fun runTimeline(durationMs: Long) {
        progress.post {
            progress.pivotX = 0f
            progress.animate().scaleX(1f)
                .setDuration(durationMs)
                .setInterpolator(android.view.animation.LinearInterpolator())
                .start()
        }

        skip.animate().alpha(1f).setStartDelay(900).setDuration(260).start()

        // Lifts in just after the wordmark resolves, roughly two thirds through.
        tagline.translationY = tagline.resources.displayMetrics.density * 14
        tagline.animate().alpha(1f).translationY(0f)
            .setStartDelay((durationMs * 0.62f).toLong())
            .setDuration(520)
            .setInterpolator(android.view.animation.DecelerateInterpolator())
            .start()
    }

    // ---------------- fallback ----------------

    private fun runStaticSplash() {
        video.visibility = View.GONE
        root.setBackgroundResource(R.drawable.bg_brand_gradient)
        mark.visibility = View.VISIBLE
        mark.alpha = 0f
        mark.scaleX = 0.86f
        mark.scaleY = 0.86f
        mark.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(480).start()

        tagline.animate().alpha(0.9f).setStartDelay(240).setDuration(420).start()
        runTimeline(1_250)
        root.postDelayed({ advance() }, 1_300)
    }

    // ---------------- handoff ----------------

    private fun advance() {
        if (advanced) return
        advanced = true

        runCatching { video.stopPlayback() }

        val next = if (Prefs.onboarded) {
            Intent(this, MainActivity::class.java)
        } else {
            Intent(this, OnboardingActivity::class.java)
        }
        startActivity(next)
        overridePendingTransition(R.anim.fade_in, R.anim.fade_out)
        finish()
    }

    override fun onPause() {
        super.onPause()
        // Leaving mid-intro should not leave audio playing behind the app.
        if (!advanced) runCatching { video.pause() }
    }

    override fun onDestroy() {
        runCatching { video.stopPlayback() }
        super.onDestroy()
    }
}
