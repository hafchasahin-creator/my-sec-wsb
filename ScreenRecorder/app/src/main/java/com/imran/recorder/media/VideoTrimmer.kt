package com.imran.recorder.media

import android.content.Context
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.media.MediaMuxer
import android.net.Uri
import android.util.Log
import com.imran.recorder.data.MediaStoreRepo
import java.nio.ByteBuffer

/**
 * Lossless trim: copies the encoded samples inside the chosen window straight into a new
 * MP4. No decode, no re-encode — so it is quick and quality is identical to the source.
 * Cuts land on the nearest preceding sync frame, which is inherent to stream copying.
 */
object VideoTrimmer {

    private const val TAG = "VideoTrimmer"

    fun trim(
        context: Context,
        source: Uri,
        startMs: Long,
        endMs: Long,
        outputName: String,
        onProgress: (Int) -> Unit
    ): Uri? {
        if (endMs <= startMs) return null

        val target = MediaStoreRepo.createVideo(context, outputName) ?: return null
        val pfd = runCatching { context.contentResolver.openFileDescriptor(target, "w") }.getOrNull()
        if (pfd == null) {
            MediaStoreRepo.discard(context, target)
            return null
        }

        var extractor: MediaExtractor? = null
        var muxer: MediaMuxer? = null
        var ok = false

        try {
            extractor = MediaExtractor()
            context.contentResolver.openFileDescriptor(source, "r")!!.use { srcFd ->
                extractor.setDataSource(srcFd.fileDescriptor)

                muxer = MediaMuxer(pfd.fileDescriptor, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)

                val indexMap = HashMap<Int, Int>()
                var maxInput = 256 * 1024

                for (i in 0 until extractor.trackCount) {
                    val format = extractor.getTrackFormat(i)
                    val mime = format.getString(MediaFormat.KEY_MIME) ?: continue
                    if (!mime.startsWith("video/") && !mime.startsWith("audio/")) continue

                    extractor.selectTrack(i)
                    if (format.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) {
                        maxInput = maxOf(maxInput, format.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE))
                    }
                    indexMap[i] = muxer!!.addTrack(format)
                }
                if (indexMap.isEmpty()) throw IllegalStateException("no usable tracks")

                rotationOf(context, source)?.let { muxer!!.setOrientationHint(it) }

                val startUs = startMs * 1000
                val endUs = endMs * 1000
                extractor.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)

                val buffer = ByteBuffer.allocate(maxInput)
                val info = android.media.MediaCodec.BufferInfo()
                muxer!!.start()

                var firstPtsUs = -1L
                val spanUs = (endUs - startUs).coerceAtLeast(1)

                while (true) {
                    val size = extractor.readSampleData(buffer, 0)
                    if (size < 0) break

                    val sampleTimeUs = extractor.sampleTime
                    if (sampleTimeUs > endUs) break

                    val track = indexMap[extractor.sampleTrackIndex]
                    if (track != null && sampleTimeUs >= 0) {
                        if (firstPtsUs < 0) firstPtsUs = sampleTimeUs

                        info.offset = 0
                        info.size = size
                        info.presentationTimeUs = (sampleTimeUs - firstPtsUs).coerceAtLeast(0)
                        info.flags = codecFlags(extractor.sampleFlags)

                        muxer!!.writeSampleData(track, buffer, info)
                        onProgress(
                            (((sampleTimeUs - startUs) * 100) / spanUs).toInt().coerceIn(0, 99)
                        )
                    }
                    extractor.advance()
                }
                ok = true
            }
        } catch (t: Throwable) {
            Log.e(TAG, "trim failed", t)
        } finally {
            runCatching { if (ok) muxer?.stop() }
            runCatching { muxer?.release() }
            runCatching { extractor?.release() }
            runCatching { pfd.close() }
        }

        return if (ok) {
            MediaStoreRepo.publish(context, target)
            onProgress(100)
            target
        } else {
            MediaStoreRepo.discard(context, target)
            null
        }
    }

    /**
     * MediaExtractor sample flags and MediaCodec buffer flags are different sets that happen
     * to share the value 1 for a sync frame. Translating explicitly stops an ENCRYPTED sample
     * (2) from being handed to the muxer as CODEC_CONFIG (2).
     */
    @Suppress("DEPRECATION")
    fun codecFlags(sampleFlags: Int): Int =
        if (sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0) {
            android.media.MediaCodec.BUFFER_FLAG_SYNC_FRAME
        } else {
            0
        }

    fun rotationOf(context: Context, uri: Uri): Int? {
        val retriever = MediaMetadataRetriever()
        return try {
            retriever.setDataSource(context, uri)
            retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)
                ?.toIntOrNull()
        } catch (t: Throwable) {
            null
        } finally {
            runCatching { retriever.release() }
        }
    }
}
