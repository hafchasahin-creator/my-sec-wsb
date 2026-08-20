package com.imran.recorder.ui.tools

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.SeekBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.imran.recorder.R
import com.imran.recorder.data.MediaEntry
import com.imran.recorder.data.MediaStoreRepo
import com.imran.recorder.media.VideoToGif
import com.imran.recorder.record.RecorderBus
import com.imran.recorder.util.Format
import com.imran.recorder.util.padTopForStatusBar
import com.imran.recorder.util.toast
import com.imran.recorder.util.visible
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class GifActivity : AppCompatActivity() {

    private data class Size(val label: String, val note: String, val width: Int)

    private val sizes = listOf(
        Size("Small", "240 px wide — easiest to send", 240),
        Size("Medium", "360 px wide — recommended", 360),
        Size("Large", "480 px wide — bigger file", 480)
    )

    private var chosen = 1
    private var running = false

    private lateinit var uri: Uri
    private var durationMs = 0L

    private lateinit var startSeek: SeekBar
    private lateinit var lenSeek: SeekBar
    private lateinit var startLabel: TextView
    private lateinit var lenLabel: TextView
    private lateinit var progress: ProgressBar
    private lateinit var progressLabel: TextView
    private lateinit var runLabel: TextView
    private lateinit var previewImage: ImageView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_gif)

        uri = Uri.parse(intent.getStringExtra("uri") ?: run { finish(); return })
        durationMs = intent.getLongExtra("duration", 0L)

        findViewById<View>(R.id.toolbar).padTopForStatusBar()
        findViewById<TextView>(R.id.barTitle).setText(R.string.tool_gif)
        findViewById<View>(R.id.barBack).setOnClickListener { finish() }

        startSeek = findViewById(R.id.gifStart)
        lenSeek = findViewById(R.id.gifLen)
        startLabel = findViewById(R.id.gifStartLabel)
        lenLabel = findViewById(R.id.gifLenLabel)
        progress = findViewById(R.id.gifProgress)
        progressLabel = findViewById(R.id.gifProgressLabel)
        runLabel = findViewById(R.id.gifRunLabel)
        previewImage = findViewById(R.id.gifPreview)

        startSeek.max = durationMs.toInt().coerceAtLeast(1)
        lenSeek.max = VideoToGif.MAX_SECONDS
        lenSeek.progress = 3
        updateLabels()

        val listener = object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(bar: SeekBar?, value: Int, fromUser: Boolean) {
                updateLabels()
            }

            override fun onStartTrackingTouch(bar: SeekBar?) = Unit
            override fun onStopTrackingTouch(bar: SeekBar?) {
                if (bar === startSeek) loadPreview()
            }
        }
        startSeek.setOnSeekBarChangeListener(listener)
        lenSeek.setOnSeekBarChangeListener(listener)

        buildSizes()
        findViewById<View>(R.id.gifRun).setOnClickListener { runExport() }
        loadPreview()
    }

    private fun updateLabels() {
        startLabel.text = Format.clock(startSeek.progress.toLong())
        lenLabel.text = "${lenSeek.progress.coerceAtLeast(1)}s"
    }

    private fun loadPreview() {
        lifecycleScope.launch {
            val at = startSeek.progress.toLong()
            val frame = withContext(Dispatchers.IO) {
                val retriever = MediaMetadataRetriever()
                try {
                    retriever.setDataSource(this@GifActivity, uri)
                    retriever.getFrameAtTime(at * 1000, MediaMetadataRetriever.OPTION_CLOSEST)
                } catch (t: Throwable) {
                    null
                } finally {
                    runCatching { retriever.release() }
                }
            }
            if (frame != null && !isFinishing) previewImage.setImageBitmap(frame)
        }
    }

    private fun buildSizes() {
        val container = findViewById<LinearLayout>(R.id.gifSizes)
        container.removeAllViews()

        sizes.forEachIndexed { index, size ->
            val row = layoutInflater.inflate(R.layout.row_sheet_item, container, false)
            row.findViewById<ImageView>(R.id.itemIcon).setImageResource(R.drawable.ic_gif)
            row.findViewById<TextView>(R.id.itemTitle).text = size.label
            row.findViewById<TextView>(R.id.itemSub).apply {
                visible(true)
                text = size.note
            }
            row.findViewById<ImageView>(R.id.itemCheck).visible(index == chosen)
            row.setOnClickListener {
                if (running) return@setOnClickListener
                chosen = index
                buildSizes()
            }
            container.addView(row)

            if (index < sizes.lastIndex) {
                val divider = View(this)
                divider.layoutParams =
                    LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 1)
                divider.setBackgroundColor(getColor(R.color.divider))
                container.addView(divider)
            }
        }
    }

    private fun runExport() {
        if (running) return
        val start = startSeek.progress.toLong()
        val lengthMs = lenSeek.progress.coerceAtLeast(1) * 1000L

        running = true
        runLabel.text = getString(R.string.processing)
        progress.visible(true)
        progressLabel.visible(true)
        progress.progress = 0
        progressLabel.text = "0%"

        lifecycleScope.launch {
            val name = MediaStoreRepo.timestampName("Gif", "gif")
            val result = withContext(Dispatchers.IO) {
                VideoToGif.convert(
                    this@GifActivity, uri, start, lengthMs, sizes[chosen].width, name,
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
            runLabel.setText(R.string.tool_gif)
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
            context.startActivity(ToolsFragment.intentFor(context, GifActivity::class.java, entry))
        }
    }
}
