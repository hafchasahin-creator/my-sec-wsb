package com.imran.recorder.ui.tools

import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.SeekBar
import android.widget.TextView
import android.widget.VideoView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.imran.recorder.R
import com.imran.recorder.data.MediaEntry
import com.imran.recorder.data.MediaStoreRepo
import com.imran.recorder.media.VideoTrimmer
import com.imran.recorder.record.RecorderBus
import com.imran.recorder.util.Format
import com.imran.recorder.util.padTopForStatusBar
import com.imran.recorder.util.toast
import com.imran.recorder.util.visible
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class TrimActivity : AppCompatActivity() {

    private lateinit var uri: Uri
    private var durationMs = 0L
    private var running = false

    private lateinit var preview: VideoView
    private lateinit var seekStart: SeekBar
    private lateinit var seekEnd: SeekBar
    private lateinit var labelStart: TextView
    private lateinit var labelEnd: TextView
    private lateinit var saveLabel: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_trim)

        uri = Uri.parse(intent.getStringExtra("uri") ?: run { finish(); return })
        durationMs = intent.getLongExtra("duration", 0L)

        findViewById<View>(R.id.toolbar).padTopForStatusBar()
        findViewById<TextView>(R.id.barTitle).setText(R.string.tool_trim)
        findViewById<View>(R.id.barBack).setOnClickListener { finish() }

        preview = findViewById(R.id.preview)
        seekStart = findViewById(R.id.seekStart)
        seekEnd = findViewById(R.id.seekEnd)
        labelStart = findViewById(R.id.labelStart)
        labelEnd = findViewById(R.id.labelEnd)
        saveLabel = findViewById(R.id.trimSaveLabel)

        val playButton = findViewById<View>(R.id.previewPlay)
        preview.setVideoURI(uri)
        preview.setOnPreparedListener {
            if (durationMs <= 0) durationMs = preview.duration.toLong()
            setupRanges()
        }
        preview.setOnCompletionListener { playButton.visible(true) }
        playButton.setOnClickListener {
            playButton.visible(false)
            preview.seekTo(seekStart.progress)
            preview.start()
        }
        preview.setOnClickListener {
            if (preview.isPlaying) {
                preview.pause()
                playButton.visible(true)
            }
        }

        findViewById<View>(R.id.trimSave).setOnClickListener { runTrim() }
        setupRanges()
    }

    private fun setupRanges() {
        val max = durationMs.toInt().coerceAtLeast(1)
        seekStart.max = max
        seekEnd.max = max
        if (seekEnd.progress == 0) seekEnd.progress = max
        updateLabels()

        val listener = object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(bar: SeekBar?, value: Int, fromUser: Boolean) {
                if (!fromUser) return
                // Keep at least a second between the handles so the export is never empty.
                if (bar === seekStart && value > seekEnd.progress - 1000) {
                    seekStart.progress = (seekEnd.progress - 1000).coerceAtLeast(0)
                }
                if (bar === seekEnd && value < seekStart.progress + 1000) {
                    seekEnd.progress = (seekStart.progress + 1000).coerceAtMost(seekEnd.max)
                }
                updateLabels()
                if (bar === seekStart) preview.seekTo(seekStart.progress)
            }

            override fun onStartTrackingTouch(bar: SeekBar?) = Unit
            override fun onStopTrackingTouch(bar: SeekBar?) = Unit
        }
        seekStart.setOnSeekBarChangeListener(listener)
        seekEnd.setOnSeekBarChangeListener(listener)
    }

    private fun updateLabels() {
        labelStart.text = Format.clock(seekStart.progress.toLong())
        labelEnd.text = Format.clock(seekEnd.progress.toLong())
    }

    private fun runTrim() {
        if (running) return
        val start = seekStart.progress.toLong()
        val end = seekEnd.progress.toLong()
        if (end - start < 500) {
            toast("Choose a longer section")
            return
        }

        running = true
        saveLabel.text = getString(R.string.processing)

        lifecycleScope.launch {
            val name = MediaStoreRepo.timestampName("Trim", "mp4")
            val result = withContext(Dispatchers.IO) {
                VideoTrimmer.trim(this@TrimActivity, uri, start, end, name) {}
            }
            running = false
            saveLabel.setText(R.string.save)

            if (result != null) {
                RecorderBus.notifyMediaChanged()
                toast(getString(R.string.export_done))
                finish()
            } else {
                toast(getString(R.string.export_failed))
            }
        }
    }

    override fun onPause() {
        super.onPause()
        if (preview.isPlaying) preview.pause()
    }

    override fun onDestroy() {
        runCatching { preview.stopPlayback() }
        super.onDestroy()
    }

    companion object {
        fun open(context: Context, entry: MediaEntry) {
            context.startActivity(ToolsFragment.intentFor(context, TrimActivity::class.java, entry))
        }
    }
}
