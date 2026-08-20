package com.imran.recorder.record

import android.content.Context
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.net.Uri
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import com.imran.recorder.data.MediaStoreRepo
import java.io.BufferedOutputStream

/**
 * Grabs a single frame from an existing MediaProjection through an ImageReader-backed
 * virtual display. Reuses the recording's projection when one is live, so capturing a
 * screenshot mid-recording needs no extra consent prompt.
 */
object ScreenshotCapturer {

    private const val TAG = "ScreenshotCapturer"

    fun capture(
        context: Context,
        projection: MediaProjection,
        onResult: (Uri?) -> Unit
    ) {
        val (w, h, dpi) = CaptureGeometry.displaySize(context)
        val thread = HandlerThread("imran-shot").apply { start() }
        val handler = Handler(thread.looper)

        val reader = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 2)
        var display: android.hardware.display.VirtualDisplay? = null
        var finished = false

        fun cleanup() {
            runCatching { display?.release() }
            runCatching { reader.close() }
            thread.quitSafely()
        }

        fun finish(uri: Uri?) {
            if (finished) return
            finished = true
            cleanup()
            onResult(uri)
        }

        reader.setOnImageAvailableListener({ r ->
            if (finished) return@setOnImageAvailableListener
            val image = runCatching { r.acquireLatestImage() }.getOrNull()
                ?: return@setOnImageAvailableListener
            try {
                val bitmap = toBitmap(image, w, h)
                val uri = save(context, bitmap)
                bitmap.recycle()
                finish(uri)
            } catch (t: Throwable) {
                Log.e(TAG, "capture failed", t)
                finish(null)
            } finally {
                runCatching { image.close() }
            }
        }, handler)

        val created = runCatching {
            projection.createVirtualDisplay(
                "ImranShot", w, h, dpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                reader.surface, null, handler
            )
        }.getOrElse {
            Log.e(TAG, "virtual display failed", it)
            finish(null)
            return
        }
        // A frame can arrive before this assignment lands, in which case cleanup already ran
        // and would have missed the display — release it here instead of leaking it.
        if (finished) {
            runCatching { created?.release() }
            return
        }
        display = created

        // Nothing arrived in time — treat as a failed capture rather than hanging.
        handler.postDelayed({ finish(null) }, 4_000)
    }

    private fun toBitmap(image: android.media.Image, width: Int, height: Int): Bitmap {
        val plane = image.planes[0]
        val pixelStride = plane.pixelStride
        val rowStride = plane.rowStride
        val rowPadding = rowStride - pixelStride * width

        val padded = Bitmap.createBitmap(
            width + rowPadding / pixelStride, height, Bitmap.Config.ARGB_8888
        )
        padded.copyPixelsFromBuffer(plane.buffer)

        return if (padded.width != width) {
            val cropped = Bitmap.createBitmap(padded, 0, 0, width, height)
            padded.recycle()
            cropped
        } else {
            padded
        }
    }

    private fun save(context: Context, bitmap: Bitmap): Uri? {
        val name = MediaStoreRepo.timestampName("Shot", "png")
        val uri = MediaStoreRepo.createImage(context, name) ?: return null
        val ok = runCatching {
            context.contentResolver.openOutputStream(uri)?.use { out ->
                BufferedOutputStream(out).use { bos ->
                    bitmap.compress(Bitmap.CompressFormat.PNG, 100, bos)
                }
            } != null
        }.getOrDefault(false)

        return if (ok) {
            MediaStoreRepo.publish(context, uri)
            uri
        } else {
            MediaStoreRepo.discard(context, uri)
            null
        }
    }
}
