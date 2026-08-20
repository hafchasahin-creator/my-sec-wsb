package com.imran.recorder.ui.player

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.ImageView
import android.widget.SeekBar
import android.widget.TextView
import android.widget.VideoView
import androidx.appcompat.app.AppCompatActivity
import com.imran.recorder.R
import com.imran.recorder.data.MediaEntry
import com.imran.recorder.data.MediaStoreRepo
import com.imran.recorder.data.Thumbnails
import com.imran.recorder.record.RecorderBus
import com.imran.recorder.ui.SheetItem
import com.imran.recorder.ui.Sheets
import com.imran.recorder.util.Format
import com.imran.recorder.util.openExternally
import com.imran.recorder.util.shareMedia
import com.imran.recorder.util.toast

/** In-app playback with its own transport, so recordings open without leaving the app. */
class PlayerActivity : AppCompatActivity() {

    private lateinit var video: VideoView
    private lateinit var playButton: ImageView
    private lateinit var seek: SeekBar
    private lateinit var position: TextView
    private lateinit var duration: TextView
    private lateinit var chrome: List<View>

    private lateinit var uri: Uri
    private var displayName: String = ""
    private var chromeVisible = true

    private val handler = Handler(Looper.getMainLooper())
    private val tick = object : Runnable {
        override fun run() {
            if (video.isPlaying) {
                seek.progress = video.currentPosition
                position.text = Format.clock(video.currentPosition.toLong())
            }
            handler.postDelayed(this, 300)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_player)

        uri = Uri.parse(intent.getStringExtra(EXTRA_URI) ?: run { finish(); return })
        displayName = intent.getStringExtra(EXTRA_NAME) ?: "Recording"

        video = findViewById(R.id.video)
        playButton = findViewById(R.id.playerPlay)
        seek = findViewById(R.id.playerSeek)
        position = findViewById(R.id.playerPos)
        duration = findViewById(R.id.playerDur)
        chrome = listOf(findViewById(R.id.playerTop), findViewById(R.id.playerControls))

        findViewById<TextView>(R.id.playerTitle).text = displayName.substringBeforeLast('.')
        findViewById<View>(R.id.playerBack).setOnClickListener { finish() }
        findViewById<View>(R.id.playerShare).setOnClickListener {
            shareMedia(uri, "video/mp4")
        }
        findViewById<View>(R.id.playerMore).setOnClickListener { showMore() }

        video.setOnPreparedListener { player ->
            player.isLooping = false
            seek.max = video.duration.coerceAtLeast(1)
            duration.text = Format.clock(video.duration.toLong())
            video.start()
            syncPlayIcon()
            handler.post(tick)
        }
        video.setOnCompletionListener {
            syncPlayIcon()
            seek.progress = seek.max
            showChrome(true)
        }
        video.setOnErrorListener { _, _, _ ->
            toast("This file could not be played here")
            openExternally(uri, "video/mp4")
            finish()
            true
        }

        playButton.setOnClickListener { togglePlay() }
        video.setOnClickListener { showChrome(!chromeVisible) }

        seek.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(bar: SeekBar?, value: Int, fromUser: Boolean) {
                if (fromUser) {
                    video.seekTo(value)
                    position.text = Format.clock(value.toLong())
                }
            }

            override fun onStartTrackingTouch(bar: SeekBar?) = Unit
            override fun onStopTrackingTouch(bar: SeekBar?) = Unit
        })

        video.setVideoURI(uri)
    }

    private fun togglePlay() {
        if (video.isPlaying) video.pause() else video.start()
        syncPlayIcon()
    }

    private fun syncPlayIcon() {
        playButton.setImageResource(if (video.isPlaying) R.drawable.ic_pause else R.drawable.ic_play)
    }

    private fun showChrome(show: Boolean) {
        chromeVisible = show
        for (view in chrome) {
            view.animate().alpha(if (show) 1f else 0f).setDuration(160).withEndAction {
                view.visibility = if (show) View.VISIBLE else View.INVISIBLE
            }.start()
        }
    }

    private fun showMore() {
        Sheets.show(this, displayName.substringBeforeLast('.'), listOf(
            SheetItem(getString(R.string.rename), null, R.drawable.ic_pencil) { rename() },
            SheetItem("Open with another app", null, R.drawable.ic_open_ext) {
                openExternally(uri, "video/mp4")
            },
            SheetItem(getString(R.string.delete), null, R.drawable.ic_delete) { confirmDelete() }
        ))
    }

    private fun currentEntry(): MediaEntry? =
        MediaStoreRepo.videos(this).firstOrNull { it.uri == uri }

    private fun rename() {
        val entry = currentEntry() ?: return
        Sheets.prompt(this, getString(R.string.rename_title), displayName.substringBeforeLast('.')) { name ->
            if (name.isBlank()) return@prompt
            if (MediaStoreRepo.rename(this, entry, name)) {
                displayName = "$name.${displayName.substringAfterLast('.', "mp4")}"
                findViewById<TextView>(R.id.playerTitle).text = name
                RecorderBus.notifyMediaChanged()
                toast(getString(R.string.renamed))
            } else {
                toast("Could not rename this file")
            }
        }
    }

    private fun confirmDelete() {
        Sheets.confirm(
            this, getString(R.string.delete_title), getString(R.string.delete_body),
            getString(R.string.delete)
        ) {
            val entry = currentEntry()
            val ok = entry != null && MediaStoreRepo.delete(this, entry)
            if (ok) {
                Thumbnails.evict(uri)
                RecorderBus.notifyMediaChanged()
                toast(getString(R.string.deleted))
                finish()
            } else {
                toast("Could not delete this file")
            }
        }
    }

    override fun onPause() {
        super.onPause()
        if (video.isPlaying) {
            video.pause()
            syncPlayIcon()
        }
    }

    override fun onDestroy() {
        handler.removeCallbacks(tick)
        runCatching { video.stopPlayback() }
        super.onDestroy()
    }

    companion object {
        private const val EXTRA_URI = "uri"
        private const val EXTRA_NAME = "name"

        fun open(context: Context, uri: Uri, name: String) {
            context.startActivity(
                Intent(context, PlayerActivity::class.java)
                    .putExtra(EXTRA_URI, uri.toString())
                    .putExtra(EXTRA_NAME, name)
            )
        }
    }
}
