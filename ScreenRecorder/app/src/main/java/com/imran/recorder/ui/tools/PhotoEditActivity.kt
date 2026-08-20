package com.imran.recorder.ui.tools

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Matrix
import android.graphics.Paint
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.ImageView
import android.widget.SeekBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.imran.recorder.R
import com.imran.recorder.data.MediaEntry
import com.imran.recorder.data.MediaStoreRepo
import com.imran.recorder.record.RecorderBus
import com.imran.recorder.ui.SheetItem
import com.imran.recorder.ui.Sheets
import com.imran.recorder.util.padTopForStatusBar
import com.imran.recorder.util.toast
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.BufferedOutputStream

/** Bitmap-level photo edits: rotate, aspect crop, mono and brightness. */
class PhotoEditActivity : AppCompatActivity() {

    private lateinit var uri: Uri
    private var displayName = "Screenshot"

    private var original: Bitmap? = null
    private var working: Bitmap? = null

    private var rotation = 0
    private var mono = false
    private var brightness = 1f
    private var crop: Pair<Int, Int>? = null

    private lateinit var image: ImageView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_photo_edit)

        uri = Uri.parse(intent.getStringExtra("uri") ?: run { finish(); return })
        displayName = intent.getStringExtra("name") ?: "Screenshot"

        findViewById<View>(R.id.toolbar).padTopForStatusBar()
        findViewById<TextView>(R.id.barTitle).setText(R.string.tool_photo)
        findViewById<View>(R.id.barBack).setOnClickListener { finish() }
        findViewById<TextView>(R.id.barAction).apply {
            visibility = View.VISIBLE
            setText(R.string.save)
            setOnClickListener { save() }
        }

        image = findViewById(R.id.editImage)

        findViewById<View>(R.id.actRotate).setOnClickListener {
            rotation = (rotation + 90) % 360
            render()
        }
        findViewById<View>(R.id.actCrop).setOnClickListener { pickCrop() }
        findViewById<View>(R.id.actGray).setOnClickListener {
            mono = !mono
            render()
        }
        findViewById<View>(R.id.actReset).setOnClickListener {
            rotation = 0; mono = false; brightness = 1f; crop = null
            findViewById<SeekBar>(R.id.seekBright).progress = 100
            render()
        }

        findViewById<SeekBar>(R.id.seekBright).setOnSeekBarChangeListener(
            object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(bar: SeekBar?, value: Int, fromUser: Boolean) {
                    if (!fromUser) return
                    brightness = value / 100f
                    render()
                }

                override fun onStartTrackingTouch(bar: SeekBar?) = Unit
                override fun onStopTrackingTouch(bar: SeekBar?) = Unit
            }
        )

        load()
    }

    private fun load() {
        lifecycleScope.launch {
            val bitmap = withContext(Dispatchers.IO) {
                runCatching {
                    contentResolver.openInputStream(uri)?.use {
                        // Downsample very large screenshots so edits stay responsive.
                        val options = BitmapFactory.Options().apply { inSampleSize = 1 }
                        BitmapFactory.decodeStream(it, null, options)
                    }
                }.getOrNull()
            }
            if (bitmap == null) {
                toast("This image could not be opened")
                finish()
                return@launch
            }
            original = bitmap
            render()
        }
    }

    /** Applies the current edit stack to a fresh copy of the source. */
    private fun buildEdited(): Bitmap? {
        val src = original ?: return null

        var result = src
        crop?.let { (aw, ah) ->
            val srcRatio = src.width.toFloat() / src.height
            val wantRatio = aw.toFloat() / ah
            val (cw, ch) = if (srcRatio > wantRatio) {
                ((src.height * wantRatio).toInt()) to src.height
            } else {
                src.width to ((src.width / wantRatio).toInt())
            }
            val x = ((src.width - cw) / 2).coerceAtLeast(0)
            val y = ((src.height - ch) / 2).coerceAtLeast(0)
            result = Bitmap.createBitmap(
                src, x, y, cw.coerceAtMost(src.width - x), ch.coerceAtMost(src.height - y)
            )
        }

        if (rotation != 0) {
            val matrix = Matrix().apply { postRotate(rotation.toFloat()) }
            val rotated = Bitmap.createBitmap(
                result, 0, 0, result.width, result.height, matrix, true
            )
            if (result !== src) result.recycle()
            result = rotated
        }

        if (mono || brightness != 1f) {
            val output = Bitmap.createBitmap(result.width, result.height, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(output)
            val matrix = ColorMatrix()
            if (mono) matrix.setSaturation(0f)
            if (brightness != 1f) {
                val b = brightness
                matrix.postConcat(
                    ColorMatrix(
                        floatArrayOf(
                            b, 0f, 0f, 0f, 0f,
                            0f, b, 0f, 0f, 0f,
                            0f, 0f, b, 0f, 0f,
                            0f, 0f, 0f, 1f, 0f
                        )
                    )
                )
            }
            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                colorFilter = ColorMatrixColorFilter(matrix)
            }
            canvas.drawBitmap(result, 0f, 0f, paint)
            if (result !== src) result.recycle()
            result = output
        }

        return result
    }

    private fun render() {
        val edited = buildEdited() ?: return
        val previous = working
        // Hand the new bitmap to the view before recycling the old one — recycling a bitmap
        // the ImageView is still holding crashes the next draw pass.
        image.setImageBitmap(edited)
        working = edited
        previous?.takeIf { it !== original && it !== edited }?.recycle()
    }

    private fun pickCrop() {
        Sheets.show(this, "Crop", listOf(
            SheetItem("Original", "Keep the full frame", R.drawable.ic_crop) {
                crop = null; render()
            },
            SheetItem("Square", "1:1", R.drawable.ic_crop) { crop = 1 to 1; render() },
            SheetItem("Widescreen", "16:9", R.drawable.ic_crop) { crop = 16 to 9; render() },
            SheetItem("Classic", "4:3", R.drawable.ic_crop) { crop = 4 to 3; render() },
            SheetItem("Portrait", "9:16", R.drawable.ic_crop) { crop = 9 to 16; render() }
        ))
    }

    private fun save() {
        val bitmap = working ?: return
        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) {
                val name = MediaStoreRepo.timestampName("Edited", "png")
                val target = MediaStoreRepo.createImage(this@PhotoEditActivity, name)
                    ?: return@withContext null
                val ok = runCatching {
                    contentResolver.openOutputStream(target)?.use { stream ->
                        BufferedOutputStream(stream).use { out ->
                            bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
                        }
                    } != null
                }.getOrDefault(false)

                if (ok) {
                    MediaStoreRepo.publish(this@PhotoEditActivity, target)
                    target
                } else {
                    MediaStoreRepo.discard(this@PhotoEditActivity, target)
                    null
                }
            }

            if (result != null) {
                RecorderBus.notifyMediaChanged()
                toast(getString(R.string.export_done))
                finish()
            } else {
                toast(getString(R.string.export_failed))
            }
        }
    }

    override fun onDestroy() {
        working?.takeIf { it !== original }?.recycle()
        original?.recycle()
        super.onDestroy()
    }

    companion object {
        fun open(context: Context, entry: MediaEntry) {
            context.startActivity(
                ToolsFragment.intentFor(context, PhotoEditActivity::class.java, entry)
            )
        }

        fun openUri(context: Context, uri: Uri, name: String) {
            context.startActivity(
                Intent(context, PhotoEditActivity::class.java)
                    .putExtra("uri", uri.toString())
                    .putExtra("name", name)
            )
        }
    }
}
