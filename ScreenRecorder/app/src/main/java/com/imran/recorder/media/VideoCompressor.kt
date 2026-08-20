package com.imran.recorder.media

import android.content.Context
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.net.Uri
import android.util.Log
import android.view.Surface
import com.imran.recorder.data.MediaStoreRepo
import java.nio.ByteBuffer

/**
 * Re-encodes the video track at a lower bitrate and copies the audio track untouched.
 *
 * The decoder is configured to output straight into the encoder's input Surface, so frames
 * never round-trip through the CPU — no colour-format juggling and no OpenGL plumbing.
 * Resolution is preserved; only bitrate changes.
 */
object VideoCompressor {

    private const val TAG = "VideoCompressor"
    private const val TIMEOUT_US = 10_000L

    fun compress(
        context: Context,
        source: Uri,
        bitrate: Int,
        outputName: String,
        onProgress: (Int) -> Unit,
        isCancelled: () -> Boolean = { false }
    ): Uri? {
        val target = MediaStoreRepo.createVideo(context, outputName) ?: return null
        val outFd = runCatching { context.contentResolver.openFileDescriptor(target, "w") }.getOrNull()
        if (outFd == null) {
            MediaStoreRepo.discard(context, target)
            return null
        }

        var extractor: MediaExtractor? = null
        var audioExtractor: MediaExtractor? = null
        var decoder: MediaCodec? = null
        var encoder: MediaCodec? = null
        var muxer: MediaMuxer? = null
        var inputSurface: Surface? = null
        var ok = false

        try {
            val srcFd = context.contentResolver.openFileDescriptor(source, "r")
                ?: throw IllegalStateException("cannot open source")

            srcFd.use { fd ->
                extractor = MediaExtractor().apply { setDataSource(fd.fileDescriptor) }

                var videoTrack = -1
                var audioTrack = -1
                for (i in 0 until extractor!!.trackCount) {
                    val mime = extractor!!.getTrackFormat(i).getString(MediaFormat.KEY_MIME) ?: continue
                    if (videoTrack < 0 && mime.startsWith("video/")) videoTrack = i
                    else if (audioTrack < 0 && mime.startsWith("audio/")) audioTrack = i
                }
                if (videoTrack < 0) throw IllegalStateException("no video track")

                val srcFormat = extractor!!.getTrackFormat(videoTrack)
                val width = srcFormat.getInteger(MediaFormat.KEY_WIDTH)
                val height = srcFormat.getInteger(MediaFormat.KEY_HEIGHT)
                val durationUs =
                    if (srcFormat.containsKey(MediaFormat.KEY_DURATION))
                        srcFormat.getLong(MediaFormat.KEY_DURATION)
                    else 0L
                val frameRate =
                    if (srcFormat.containsKey(MediaFormat.KEY_FRAME_RATE))
                        srcFormat.getInteger(MediaFormat.KEY_FRAME_RATE)
                    else 30

                // --- encoder ---
                val outFormat = MediaFormat.createVideoFormat(
                    MediaFormat.MIMETYPE_VIDEO_AVC, width, height
                ).apply {
                    setInteger(
                        MediaFormat.KEY_COLOR_FORMAT,
                        MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface
                    )
                    setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
                    setInteger(MediaFormat.KEY_FRAME_RATE, frameRate)
                    setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 2)
                }
                encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
                encoder!!.configure(outFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
                inputSurface = encoder!!.createInputSurface()
                encoder!!.start()

                // --- decoder renders directly into the encoder's surface ---
                val decoderMime = srcFormat.getString(MediaFormat.KEY_MIME)!!
                decoder = MediaCodec.createDecoderByType(decoderMime)
                decoder!!.configure(srcFormat, inputSurface, null, 0)
                decoder!!.start()
                extractor!!.selectTrack(videoTrack)

                muxer = MediaMuxer(outFd.fileDescriptor, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
                VideoTrimmer.rotationOf(context, source)?.let { muxer!!.setOrientationHint(it) }

                // Audio format is known upfront, so its track can be added before start().
                var muxAudioTrack = -1
                var audioFormat: MediaFormat? = null
                if (audioTrack >= 0) {
                    audioExtractor = MediaExtractor().apply { setDataSource(fd.fileDescriptor) }
                    audioFormat = audioExtractor!!.getTrackFormat(audioTrack)
                    audioExtractor!!.selectTrack(audioTrack)
                    muxAudioTrack = muxer!!.addTrack(audioFormat)
                }

                var muxVideoTrack = -1
                var muxerStarted = false
                var extractorDone = false
                var decoderDone = false
                var encoderDone = false

                val decInfo = MediaCodec.BufferInfo()
                val encInfo = MediaCodec.BufferInfo()

                while (!encoderDone) {
                    if (isCancelled()) throw InterruptedException("cancelled")

                    if (!extractorDone) {
                        val index = decoder!!.dequeueInputBuffer(TIMEOUT_US)
                        if (index >= 0) {
                            val buffer = decoder!!.getInputBuffer(index)!!
                            val size = extractor!!.readSampleData(buffer, 0)
                            if (size < 0) {
                                decoder!!.queueInputBuffer(
                                    index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM
                                )
                                extractorDone = true
                            } else {
                                decoder!!.queueInputBuffer(
                                    index, 0, size, extractor!!.sampleTime, 0
                                )
                                extractor!!.advance()
                            }
                        }
                    }

                    if (!decoderDone) {
                        val index = decoder!!.dequeueOutputBuffer(decInfo, TIMEOUT_US)
                        if (index >= 0) {
                            // Rendering hands the frame to the encoder's surface.
                            decoder!!.releaseOutputBuffer(index, decInfo.size > 0)
                            if (decInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                                decoderDone = true
                                encoder!!.signalEndOfInputStream()
                            }
                        }
                    }

                    when (val index = encoder!!.dequeueOutputBuffer(encInfo, TIMEOUT_US)) {
                        MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                            if (muxVideoTrack < 0) {
                                muxVideoTrack = muxer!!.addTrack(encoder!!.outputFormat)
                                muxer!!.start()
                                muxerStarted = true
                            }
                        }
                        MediaCodec.INFO_TRY_AGAIN_LATER -> Unit
                        else -> if (index >= 0) {
                            val buffer = encoder!!.getOutputBuffer(index)
                            if (encInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) {
                                encInfo.size = 0
                            }
                            if (buffer != null && encInfo.size > 0 && muxerStarted) {
                                buffer.position(encInfo.offset)
                                buffer.limit(encInfo.offset + encInfo.size)
                                muxer!!.writeSampleData(muxVideoTrack, buffer, encInfo)

                                if (durationUs > 0) {
                                    onProgress(
                                        ((encInfo.presentationTimeUs * 95) / durationUs)
                                            .toInt().coerceIn(0, 95)
                                    )
                                }
                            }
                            encoder!!.releaseOutputBuffer(index, false)
                            if (encInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                                encoderDone = true
                            }
                        }
                    }
                }

                // --- copy audio unchanged ---
                if (muxAudioTrack >= 0 && muxerStarted && audioFormat != null) {
                    val maxInput =
                        if (audioFormat.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE))
                            audioFormat.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE)
                        else 128 * 1024
                    val buffer = ByteBuffer.allocate(maxInput.coerceAtLeast(64 * 1024))
                    val info = MediaCodec.BufferInfo()

                    while (true) {
                        val size = audioExtractor!!.readSampleData(buffer, 0)
                        if (size < 0) break
                        info.offset = 0
                        info.size = size
                        info.presentationTimeUs = audioExtractor!!.sampleTime
                        info.flags = VideoTrimmer.codecFlags(audioExtractor!!.sampleFlags)
                        muxer!!.writeSampleData(muxAudioTrack, buffer, info)
                        audioExtractor!!.advance()
                    }
                }

                ok = muxerStarted
                if (ok) runCatching { muxer!!.stop() }
            }
        } catch (t: Throwable) {
            Log.e(TAG, "compress failed", t)
            ok = false
        } finally {
            runCatching { decoder?.stop() }
            runCatching { decoder?.release() }
            runCatching { encoder?.stop() }
            runCatching { encoder?.release() }
            runCatching { inputSurface?.release() }
            runCatching { muxer?.release() }
            runCatching { extractor?.release() }
            runCatching { audioExtractor?.release() }
            runCatching { outFd.close() }
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
}
