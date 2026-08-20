package com.imran.recorder.media

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.util.Log
import com.imran.recorder.data.MediaStoreRepo
import java.io.BufferedOutputStream

/**
 * Samples frames out of a clip with MediaMetadataRetriever and writes them through
 * [GifEncoder]. Capped in length and frame rate because GIF grows fast.
 */
object VideoToGif {

    private const val TAG = "VideoToGif"
    const val MAX_SECONDS = 15
    private const val FPS = 10

    fun convert(
        context: Context,
        source: Uri,
        startMs: Long,
        lengthMs: Long,
        targetWidth: Int,
        outputName: String,
        onProgress: (Int) -> Unit,
        isCancelled: () -> Boolean = { false }
    ): Uri? {
        val retriever = MediaMetadataRetriever()
        val clamped = lengthMs.coerceIn(500L, MAX_SECONDS * 1000L)

        return try {
            retriever.setDataSource(context, source)

            val srcW = retriever
                .extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)
                ?.toIntOrNull() ?: 0
            val srcH = retriever
                .extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)
                ?.toIntOrNull() ?: 0
            if (srcW <= 0 || srcH <= 0) return null

            val rotation = retriever
                .extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)
                ?.toIntOrNull() ?: 0
            val uprightW = if (rotation == 90 || rotation == 270) srcH else srcW
            val uprightH = if (rotation == 90 || rotation == 270) srcW else srcH

            val outW = targetWidth.coerceAtMost(uprightW).let { it - (it % 2) }
            val outH = (outW.toLong() * uprightH / uprightW).toInt().let { it - (it % 2) }
            if (outW <= 0 || outH <= 0) return null

            val frames = ((clamped / 1000.0) * FPS).toInt().coerceIn(2, MAX_SECONDS * FPS)
            val stepUs = (clamped * 1000L) / frames

            val target = MediaStoreRepo.createGif(context, outputName) ?: return null
            val stream = context.contentResolver.openOutputStream(target)
            if (stream == null) {
                MediaStoreRepo.discard(context, target)
                return null
            }

            var wrote = 0
            BufferedOutputStream(stream).use { out ->
                val encoder = GifEncoder(out, outW, outH, 100 / FPS)
                for (i in 0 until frames) {
                    if (isCancelled()) throw InterruptedException("cancelled")

                    val timeUs = startMs * 1000L + i * stepUs
                    val frame: Bitmap? = runCatching {
                        retriever.getScaledFrameAtTime(
                            timeUs,
                            MediaMetadataRetriever.OPTION_CLOSEST,
                            outW,
                            outH
                        )
                    }.getOrNull()

                    if (frame != null) {
                        encoder.addFrame(frame)
                        frame.recycle()
                        wrote++
                    }
                    onProgress(((i + 1) * 96 / frames).coerceIn(0, 96))
                }
                encoder.finish()
            }

            if (wrote == 0) {
                MediaStoreRepo.discard(context, target)
                null
            } else {
                MediaStoreRepo.publish(context, target)
                onProgress(100)
                target
            }
        } catch (t: Throwable) {
            Log.e(TAG, "gif failed", t)
            null
        } finally {
            runCatching { retriever.release() }
        }
    }
}
