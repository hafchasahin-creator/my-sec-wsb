package com.imran.recorder.ui.tools

import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.imran.recorder.R
import com.imran.recorder.data.MediaEntry
import com.imran.recorder.data.MediaStoreRepo
import com.imran.recorder.data.Thumbnails
import com.imran.recorder.media.VideoCompressor
import com.imran.recorder.record.RecorderBus
import com.imran.recorder.util.Format
import com.imran.recorder.util.padTopForStatusBar
import com.imran.recorder.util.toast
import com.imran.recorder.util.visible
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class CompressActivity : AppCompatActivity() {

    private data class Level(val label: String, val note: String, val factor: Double)

    private val levels = listOf(
        Level("Light", "About 70% of the original size", 0.70),
        Level("Balanced", "About 45% — recommended", 0.45),
        Level("Small", "About 25%, softer detail", 0.25)
    )

    private var chosen = 1
    private var running = false

    private lateinit var uri: Uri
    private var sizeBytes = 0L
    private var durationMs = 0L
    private var width = 0
    private var height = 0

    private lateinit var progress: ProgressBar
    private lateinit var progressLabel: TextView
    private lateinit var runLabel: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_compress)

        uri = Uri.parse(intent.getStringExtra("uri") ?: run { finish(); return })
        sizeBytes = intent.getLongExtra("size", 0L)
        durationMs = intent.getLongExtra("duration", 0L)
        width = intent.getIntExtra("width", 0)
        height = intent.getIntExtra("height", 0)

        findViewById<View>(R.id.toolbar).padTopForStatusBar()
        findViewById<TextView>(R.id.barTitle).setText(R.string.tool_compress)
        findViewById<View>(R.id.barBack).setOnClickListener { finish() }

        progress = findViewById(R.id.progress)
        progressLabel = findViewById(R.id.progressLabel)
        runLabel = findViewById(R.id.compressRunLabel)

        findViewById<TextView>(R.id.srcName).text =
            (intent.getStringExtra("name") ?: "Recording").substringBeforeLast('.')
        findViewById<TextView>(R.id.srcMeta).text = buildString {
            append(Format.size(sizeBytes))
            append(" · ").append(Format.clock(durationMs))
            if (width > 0) append(" · ${width}×${height}")
        }
        Thumbnails.load(findViewById<ImageView>(R.id.srcThumb), uri, 320)

        buildLevels()
        findViewById<View>(R.id.compressRun).setOnClickListener { runCompress() }
    }

    private fun buildLevels() {
        val container = findViewById<LinearLayout>(R.id.levels)
        container.removeAllViews()

        levels.forEachIndexed { index, level ->
            val row = layoutInflater.inflate(R.layout.row_sheet_item, container, false)
            row.findViewById<ImageView>(R.id.itemIcon).setImageResource(R.drawable.ic_compress)
            row.findViewById<TextView>(R.id.itemTitle).text =
                if (sizeBytes > 0)
                    "${level.label} · about ${Format.size((sizeBytes * level.factor).toLong())}"
                else level.label
            row.findViewById<TextView>(R.id.itemSub).apply {
                visible(true)
                text = level.note
            }
            row.findViewById<ImageView>(R.id.itemCheck).visible(index == chosen)
            row.setOnClickListener {
                if (running) return@setOnClickListener
                chosen = index
                buildLevels()
            }
            container.addView(row)

            if (index < levels.lastIndex) {
                val divider = View(this)
                divider.layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, 1
                )
                divider.setBackgroundColor(getColor(R.color.divider))
                container.addView(divider)
            }
        }
    }

    private fun runCompress() {
        if (running) return

        // Derive a target bitrate from the source's own average, so the reduction is relative
        // to how the clip was actually encoded.
        val durationSec = (durationMs / 1000.0).coerceAtLeast(0.5)
        val sourceBitrate = ((sizeBytes * 8) / durationSec).toInt().coerceAtLeast(500_000)
        val target = (sourceBitrate * levels[chosen].factor).toInt().coerceAtLeast(300_000)

        running = true
        runLabel.text = getString(R.string.processing)
        progress.visible(true)
        progressLabel.visible(true)
        progress.progress = 0
        progressLabel.text = "0%"

        lifecycleScope.launch {
            val name = MediaStoreRepo.timestampName("Compressed", "mp4")
            val result = withContext(Dispatchers.IO) {
                VideoCompressor.compress(
                    this@CompressActivity, uri, target, name,
                    onProgress = { value ->
                        runOnUiThread {
                            progress.progress = value
                            progressLabel.text = "$value%"
                        }
                    },
                    isCancelled = { isFinishing || isDestroyed }
                )
            }

            running = false
            runLabel.setText(R.string.tool_compress)
            progress.visible(false)
            progressLabel.visible(false)

            if (result != null) {
                RecorderBus.notifyMediaChanged()
                toast(getString(R.string.export_done))
                finish()
            } else {
                toast(getString(R.string.export_failed))
            }
        }
    }

    companion object {
        fun open(context: Context, entry: MediaEntry) {
            context.startActivity(
                ToolsFragment.intentFor(context, CompressActivity::class.java, entry)
            )
        }
    }
}
