package com.imran.recorder.ui.info

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.imran.recorder.BuildConfig
import com.imran.recorder.R
import com.imran.recorder.util.dp
import com.imran.recorder.util.padTopForStatusBar

/** FAQ, walkthrough and privacy pages, rendered from structured content. */
class InfoActivity : AppCompatActivity() {

    private data class Block(val heading: String, val body: String)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_info)

        findViewById<View>(R.id.toolbar).padTopForStatusBar()
        findViewById<View>(R.id.barBack).setOnClickListener { finish() }

        val page = intent.getStringExtra(EXTRA_PAGE) ?: PAGE_FAQ
        val (title, blocks) = when (page) {
            PAGE_TUTORIAL -> getString(R.string.tutorial) to tutorial()
            PAGE_PRIVACY -> getString(R.string.privacy) to privacy()
            else -> getString(R.string.faq) to faq()
        }

        findViewById<TextView>(R.id.barTitle).text = title
        render(findViewById(R.id.infoContent), blocks)
    }

    private fun render(container: LinearLayout, blocks: List<Block>) {
        container.removeAllViews()
        blocks.forEachIndexed { index, block ->
            val heading = TextView(this).apply {
                text = block.heading
                setTextAppearance(R.style.T_Title)
                setTextColor(getColor(R.color.text_primary))
                textSize = 17f
                val lp = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                )
                lp.topMargin = if (index == 0) 0 else dp(24f)
                layoutParams = lp
            }
            val body = TextView(this).apply {
                text = block.body
                setTextColor(getColor(R.color.text_secondary))
                textSize = 14.5f
                setLineSpacing(dp(4f).toFloat(), 1f)
                val lp = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                )
                lp.topMargin = dp(7f)
                layoutParams = lp
            }
            container.addView(heading)
            container.addView(body)
        }
    }

    private fun tutorial() = listOf(
        Block(
            "1 · Start a recording",
            "Tap the Record button at the bottom of any screen. If a countdown is set, you get " +
                "those seconds to switch to whatever you want to capture."
        ),
        Block(
            "2 · Approve the system prompt",
            "Android shows its own screen-capture confirmation every time. That dialog belongs to " +
                "the operating system — no app can bypass or pre-approve it. Accept it and capture begins."
        ),
        Block(
            "3 · Use the floating controls",
            "Turn on Floating from the Video tab or Settings. A draggable capsule sits over every " +
                "app: tap it to expand, then pause, grab a screenshot, draw on screen, or stop. " +
                "Drag it anywhere and it docks to the nearest edge."
        ),
        Block(
            "4 · Stop and find your clip",
            "Stop from the capsule, the notification, or the Record button. The file is finalised and " +
                "appears in the Video tab, where you can play, rename, share or delete it."
        ),
        Block(
            "Annotating while you record",
            "The Brush tool draws over the screen and everything you draw is captured in the video. " +
                "Undo removes the last stroke, Clear wipes the layer, and the red X leaves drawing mode."
        )
    )

    private fun faq() = listOf(
        Block(
            "Why does Android ask permission every time?",
            "Screen capture is a privacy-sensitive operation, so Android requires fresh consent for " +
                "each capture session. This is enforced by the platform and applies to every recorder app."
        ),
        Block(
            "Can it record sound from games and videos?",
            "Yes, on Android 10 and newer. Choose Device audio in Settings → Audio source. Some apps " +
                "mark their audio as non-capturable (many streaming services do), and those stay silent."
        ),
        Block(
            "Why is my recording silent?",
            "Check Settings → Audio source. Microphone needs the mic permission; Device audio needs " +
                "Android 10+. If the encoder rejects an audio mode, the app tells you and records video only."
        ),
        Block(
            "Where are my files?",
            "Recordings go to Movies/Imran Recorder and screenshots to Pictures/Imran Recorder. Both " +
                "show up in your gallery. Scoped storage fixes these locations."
        ),
        Block(
            "The floating capsule disappeared",
            "It closes when you tap its X, which also turns the feature off. Switch Floating back on " +
                "from the Video tab or Settings. It also needs the Display over other apps permission."
        ),
        Block(
            "Recording stopped on its own",
            "Android may end capture if the system reclaims memory, or if you revoke the capture from " +
                "the status bar. Anything already recorded is still saved."
        ),
        Block(
            "Does pause work everywhere?",
            "Pause and resume are supported on all devices this app runs on. Paused time is removed " +
                "from the final file, so the clip has no frozen gap."
        )
    )

    private fun privacy() = listOf(
        Block(
            "Your recordings stay on your device",
            "Imran Recorder writes captures to your device storage and nowhere else. There is no " +
                "account, no upload, and no cloud component."
        ),
        Block(
            "No analytics or tracking",
            "The app collects no usage data, contains no advertising and no third-party trackers. " +
                "Settings are stored locally in the app's private preferences."
        ),
        Block(
            "No network access",
            "The app requests no internet permission. Files leave your device only when you " +
                "explicitly share them through Android's share sheet, which hands them to the app you pick."
        ),
        Block(
            "What each permission is for",
            "Screen capture — recording and screenshots. Microphone — optional narration. Camera — " +
                "optional facecam. Display over other apps — floating controls. Notifications — the " +
                "recording notice Android requires. Every one of them is requested only when you first " +
                "use the feature that needs it."
        ),
        Block(
            "Version",
            "Imran Recorder ${BuildConfig.VERSION_NAME}"
        )
    )

    companion object {
        private const val EXTRA_PAGE = "page"
        const val PAGE_FAQ = "faq"
        const val PAGE_TUTORIAL = "tutorial"
        const val PAGE_PRIVACY = "privacy"

        fun open(context: Context, page: String) {
            context.startActivity(
                Intent(context, InfoActivity::class.java).putExtra(EXTRA_PAGE, page)
            )
        }
    }
}
