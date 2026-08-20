package com.imran.recorder.ui.photo

import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.ImageView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.imran.recorder.R
import com.imran.recorder.data.MediaStoreRepo
import com.imran.recorder.data.Thumbnails
import com.imran.recorder.record.RecorderBus
import com.imran.recorder.ui.Sheets
import com.imran.recorder.ui.tools.PhotoEditActivity
import com.imran.recorder.util.shareMedia
import com.imran.recorder.util.toast

class PhotoViewerActivity : AppCompatActivity() {

    private lateinit var uri: Uri
    private var displayName = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_photo_viewer)

        uri = Uri.parse(intent.getStringExtra(EXTRA_URI) ?: run { finish(); return })
        displayName = intent.getStringExtra(EXTRA_NAME) ?: "Screenshot"

        findViewById<TextView>(R.id.photoTitle).text = displayName.substringBeforeLast('.')
        findViewById<View>(R.id.photoBack).setOnClickListener { finish() }
        findViewById<View>(R.id.photoShare).setOnClickListener { shareMedia(uri, "image/*") }
        findViewById<View>(R.id.photoEdit).setOnClickListener {
            PhotoEditActivity.openUri(this, uri, displayName)
        }
        findViewById<View>(R.id.photoDelete).setOnClickListener { confirmDelete() }

        load()
    }

    override fun onResume() {
        super.onResume()
        load()
    }

    private fun load() {
        val image = findViewById<ImageView>(R.id.photo)
        val bitmap = runCatching {
            contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it) }
        }.getOrNull()

        if (bitmap == null) {
            toast("This image could not be opened")
            finish()
            return
        }
        image.setImageBitmap(bitmap)
    }

    private fun confirmDelete() {
        Sheets.confirm(
            this, getString(R.string.delete_title), getString(R.string.delete_body),
            getString(R.string.delete)
        ) {
            val entry = MediaStoreRepo.photos(this).firstOrNull { it.uri == uri }
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

    companion object {
        private const val EXTRA_URI = "uri"
        private const val EXTRA_NAME = "name"

        fun open(context: Context, uri: Uri, name: String) {
            context.startActivity(
                Intent(context, PhotoViewerActivity::class.java)
                    .putExtra(EXTRA_URI, uri.toString())
                    .putExtra(EXTRA_NAME, name)
            )
        }
    }
}
