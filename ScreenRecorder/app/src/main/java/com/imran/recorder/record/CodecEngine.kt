package com.imran.recorder.record

import android.annotation.SuppressLint
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.media.MediaRecorder
import android.media.projection.MediaProjection
import android.os.SystemClock
import android.util.Log
import android.view.Surface
import com.imran.recorder.data.AudioSource
import java.io.FileDescriptor
import java.nio.ByteBuffer

/**
 * Device-audio captures. MediaRecorder cannot read the playback-capture stream at all,
 * so this path drives MediaCodec and MediaMuxer directly:
 *
 *   VirtualDisplay -> encoder input Surface -> H.264 -> muxer
 *   AudioRecord(playback capture) [+ mic] -> AAC -> muxer
 *
 * Video timestamps come from the surface clock minus accumulated pause time; audio
 * timestamps come from the sample count, which pauses on its own because paused audio
 * is discarded. Both therefore measure recorded content time and stay in sync.
 */
class CodecEngine : RecorderEngine {

    private var videoEncoder: MediaCodec? = null
    private var audioEncoder: MediaCodec? = null
    private var muxer: MediaMuxer? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var inputSurface: Surface? = null
    private var audioRecord: AudioRecord? = null
    private var micRecord: AudioRecord? = null

    private var videoTrack = -1
    private var audioTrack = -1
    private var expectAudio = false

    @Volatile private var muxerStarted = false
    @Volatile private var running = false
    @Volatile private var paused = false
    @Volatile private var stopped = false

    private val muxLock = Any()

    private var videoThread: Thread? = null
    private var audioThread: Thread? = null

    private var firstVideoPtsUs = -1L
    private var lastVideoPtsUs = -1L
    private var pausedTotalUs = 0L
    private var pauseStartUs = 0L
    private var totalFrames = 0L

    private var startedAt = 0L
    private var pausedAtMs = 0L
    private var pausedTotalMs = 0L

    @SuppressLint("MissingPermission")
    override fun start(projection: MediaProjection, cfg: RecordConfig, fd: FileDescriptor): Boolean {
        try {
            expectAudio = cfg.audio.needsProjectionAudio

            // --- video encoder ---
            val vFormat = MediaFormat.createVideoFormat(
                MediaFormat.MIMETYPE_VIDEO_AVC, cfg.width, cfg.height
            ).apply {
                setInteger(
                    MediaFormat.KEY_COLOR_FORMAT,
                    MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface
                )
                setInteger(MediaFormat.KEY_BIT_RATE, cfg.bitrate)
                setInteger(MediaFormat.KEY_FRAME_RATE, cfg.fps)
                setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, I_FRAME_SECONDS)
            }
            val vEnc = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
            vEnc.configure(vFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            inputSurface = vEnc.createInputSurface()
            videoEncoder = vEnc

            // --- audio encoder ---
            if (expectAudio) {
                val aFormat = MediaFormat.createAudioFormat(
                    MediaFormat.MIMETYPE_AUDIO_AAC, SAMPLE_RATE, CHANNELS
                ).apply {
                    setInteger(
                        MediaFormat.KEY_AAC_PROFILE,
                        MediaCodecInfo.CodecProfileLevel.AACObjectLC
                    )
                    setInteger(MediaFormat.KEY_BIT_RATE, AUDIO_BITRATE)
                    setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 32 * 1024)
                }
                val aEnc = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
                aEnc.configure(aFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
                audioEncoder = aEnc

                if (!openAudioInputs(projection, cfg.audio)) {
                    // Falls back to a silent capture rather than failing the recording.
                    Log.w(TAG, "audio inputs unavailable; continuing without audio")
                    runCatching { aEnc.release() }
                    audioEncoder = null
                    expectAudio = false
                }
            }

            muxer = MediaMuxer(fd, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)

            virtualDisplay = projection.createVirtualDisplay(
                "ImranRecorder",
                cfg.width, cfg.height, cfg.dpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                inputSurface, null, null
            )

            running = true
            paused = false
            stopped = false
            startedAt = SystemClock.elapsedRealtime()
            pausedTotalMs = 0

            vEnc.start()
            audioEncoder?.start()
            audioRecord?.startRecording()
            micRecord?.startRecording()

            videoThread = Thread({ drainVideo() }, "imran-video").also { it.start() }
            if (expectAudio) {
                audioThread = Thread({ pumpAudio() }, "imran-audio").also { it.start() }
            }
            return true
        } catch (t: Throwable) {
            Log.e(TAG, "start failed", t)
            releaseAll()
            return false
        }
    }

    @SuppressLint("MissingPermission")
    private fun openAudioInputs(projection: MediaProjection, mode: AudioSource): Boolean {
        val config = AudioPlaybackCaptureConfiguration.Builder(projection)
            .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
            .addMatchingUsage(AudioAttributes.USAGE_GAME)
            .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
            .build()

        val minBuf = AudioRecord.getMinBufferSize(
            SAMPLE_RATE, AudioFormat.CHANNEL_IN_STEREO, AudioFormat.ENCODING_PCM_16BIT
        )
        if (minBuf <= 0) return false
        val bufBytes = minBuf * 2

        val record = runCatching {
            AudioRecord.Builder()
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(SAMPLE_RATE)
                        .setChannelMask(AudioFormat.CHANNEL_IN_STEREO)
                        .build()
                )
                .setBufferSizeInBytes(bufBytes)
                .setAudioPlaybackCaptureConfig(config)
                .build()
        }.getOrNull()

        if (record == null || record.state != AudioRecord.STATE_INITIALIZED) {
            runCatching { record?.release() }
            return false
        }
        audioRecord = record

        if (mode == AudioSource.INTERNAL_MIC) {
            val micMin = AudioRecord.getMinBufferSize(
                SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT
            )
            val mic = runCatching {
                AudioRecord(
                    MediaRecorder.AudioSource.VOICE_RECOGNITION,
                    SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    (if (micMin > 0) micMin else 4096) * 2
                )
            }.getOrNull()
            // Missing mic is not fatal — device audio alone is still a valid recording.
            if (mic != null && mic.state == AudioRecord.STATE_INITIALIZED) {
                micRecord = mic
            } else {
                runCatching { mic?.release() }
            }
        }
        return true
    }

    // ---------------- video ----------------

    private fun drainVideo() {
        val enc = videoEncoder ?: return
        val info = MediaCodec.BufferInfo()
        try {
            while (running) {
                val idx = enc.dequeueOutputBuffer(info, TIMEOUT_US)
                when {
                    idx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        synchronized(muxLock) {
                            if (videoTrack < 0) videoTrack = muxer!!.addTrack(enc.outputFormat)
                        }
                        maybeStartMuxer()
                    }
                    idx == MediaCodec.INFO_TRY_AGAIN_LATER -> Unit
                    idx >= 0 -> {
                        val buf = enc.getOutputBuffer(idx)
                        if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) info.size = 0

                        if (buf != null && info.size > 0 && muxerStarted && !paused) {
                            if (firstVideoPtsUs < 0) firstVideoPtsUs = info.presentationTimeUs
                            var pts = info.presentationTimeUs - firstVideoPtsUs - pausedTotalUs
                            if (pts <= lastVideoPtsUs) pts = lastVideoPtsUs + 1
                            lastVideoPtsUs = pts
                            info.presentationTimeUs = pts

                            buf.position(info.offset)
                            buf.limit(info.offset + info.size)
                            synchronized(muxLock) {
                                if (muxerStarted) muxer?.writeSampleData(videoTrack, buf, info)
                            }
                        }
                        enc.releaseOutputBuffer(idx, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
                    }
                }
            }
            // Drain whatever the encoder still holds after the EOS signal.
            drainRemainingVideo(enc, info)
        } catch (t: Throwable) {
            Log.e(TAG, "video loop", t)
        }
    }

    private fun drainRemainingVideo(enc: MediaCodec, info: MediaCodec.BufferInfo) {
        val deadline = SystemClock.elapsedRealtime() + 2_000
        while (SystemClock.elapsedRealtime() < deadline) {
            val idx = enc.dequeueOutputBuffer(info, TIMEOUT_US)
            if (idx == MediaCodec.INFO_TRY_AGAIN_LATER) continue
            if (idx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                synchronized(muxLock) {
                    if (videoTrack < 0) videoTrack = muxer!!.addTrack(enc.outputFormat)
                }
                maybeStartMuxer()
                continue
            }
            if (idx < 0) continue

            val buf = enc.getOutputBuffer(idx)
            if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) info.size = 0
            if (buf != null && info.size > 0 && muxerStarted) {
                if (firstVideoPtsUs < 0) firstVideoPtsUs = info.presentationTimeUs
                var pts = info.presentationTimeUs - firstVideoPtsUs - pausedTotalUs
                if (pts <= lastVideoPtsUs) pts = lastVideoPtsUs + 1
                lastVideoPtsUs = pts
                info.presentationTimeUs = pts
                buf.position(info.offset)
                buf.limit(info.offset + info.size)
                synchronized(muxLock) {
                    if (muxerStarted) muxer?.writeSampleData(videoTrack, buf, info)
                }
            }
            enc.releaseOutputBuffer(idx, false)
            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
        }
    }

    // ---------------- audio ----------------

    private fun pumpAudio() {
        val enc = audioEncoder ?: return
        val rec = audioRecord ?: return
        val mic = micRecord

        val frames = 1024
        val pcm = ShortArray(frames * CHANNELS)
        val micPcm = ShortArray(frames)
        val info = MediaCodec.BufferInfo()

        try {
            while (running) {
                val read = rec.read(pcm, 0, pcm.size)
                if (read <= 0) {
                    drainAudio(enc, info)
                    continue
                }
                if (paused) {
                    drainAudio(enc, info)
                    continue
                }

                if (mic != null) {
                    val wantFrames = read / CHANNELS
                    val got = mic.read(micPcm, 0, wantFrames, AudioRecord.READ_NON_BLOCKING)
                    if (got > 0) {
                        for (i in 0 until minOf(got, wantFrames)) {
                            val m = micPcm[i].toInt()
                            pcm[i * 2] = clamp16(pcm[i * 2] + m)
                            pcm[i * 2 + 1] = clamp16(pcm[i * 2 + 1] + m)
                        }
                    }
                }

                feedAudio(enc, pcm, read)
                drainAudio(enc, info)
            }

            // Signal end of audio stream and flush.
            val idx = enc.dequeueInputBuffer(TIMEOUT_US * 10)
            if (idx >= 0) {
                enc.queueInputBuffer(
                    idx, 0, 0, ptsForFrames(), MediaCodec.BUFFER_FLAG_END_OF_STREAM
                )
            }
            val deadline = SystemClock.elapsedRealtime() + 1_500
            while (SystemClock.elapsedRealtime() < deadline) {
                if (drainAudio(enc, info)) return
            }
        } catch (t: Throwable) {
            Log.e(TAG, "audio loop", t)
        }
    }

    private fun feedAudio(enc: MediaCodec, pcm: ShortArray, shorts: Int) {
        val idx = enc.dequeueInputBuffer(TIMEOUT_US)
        if (idx < 0) return
        val buf: ByteBuffer = enc.getInputBuffer(idx) ?: return
        buf.clear()
        val capacityShorts = buf.remaining() / 2
        val n = minOf(shorts, capacityShorts)
        buf.asShortBuffer().put(pcm, 0, n)
        buf.position(0)
        buf.limit(n * 2)
        enc.queueInputBuffer(idx, 0, n * 2, ptsForFrames(), 0)
        totalFrames += (n / CHANNELS).toLong()
    }

    private fun ptsForFrames(): Long = totalFrames * 1_000_000L / SAMPLE_RATE

    /** @return true once end-of-stream was seen. */
    private fun drainAudio(enc: MediaCodec, info: MediaCodec.BufferInfo): Boolean {
        while (true) {
            val idx = enc.dequeueOutputBuffer(info, 0)
            when {
                idx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                    synchronized(muxLock) {
                        if (audioTrack < 0) audioTrack = muxer!!.addTrack(enc.outputFormat)
                    }
                    maybeStartMuxer()
                }
                idx == MediaCodec.INFO_TRY_AGAIN_LATER -> return false
                idx >= 0 -> {
                    val buf = enc.getOutputBuffer(idx)
                    if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) info.size = 0
                    if (buf != null && info.size > 0 && muxerStarted) {
                        buf.position(info.offset)
                        buf.limit(info.offset + info.size)
                        synchronized(muxLock) {
                            if (muxerStarted) muxer?.writeSampleData(audioTrack, buf, info)
                        }
                    }
                    enc.releaseOutputBuffer(idx, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return true
                }
                else -> return false
            }
        }
    }

    private fun maybeStartMuxer() {
        synchronized(muxLock) {
            if (muxerStarted) return
            if (videoTrack < 0) return
            if (expectAudio && audioTrack < 0) return
            runCatching {
                muxer?.start()
                muxerStarted = true
            }.onFailure { Log.e(TAG, "muxer start", it) }
        }
    }

    // ---------------- lifecycle ----------------

    override fun pause() {
        if (paused || !running) return
        paused = true
        pauseStartUs = SystemClock.elapsedRealtimeNanos() / 1000
        pausedAtMs = SystemClock.elapsedRealtime()
    }

    override fun resume() {
        if (!paused || !running) return
        val nowUs = SystemClock.elapsedRealtimeNanos() / 1000
        pausedTotalUs += nowUs - pauseStartUs
        pausedTotalMs += SystemClock.elapsedRealtime() - pausedAtMs
        pausedAtMs = 0
        paused = false
    }

    override fun stop() {
        if (stopped) return
        stopped = true
        running = false
        paused = false

        runCatching { videoEncoder?.signalEndOfInputStream() }

        runCatching { videoThread?.join(3_000) }
        runCatching { audioThread?.join(3_000) }
        videoThread = null
        audioThread = null

        releaseAll()
    }

    private fun releaseAll() {
        runCatching { audioRecord?.stop() }
        runCatching { audioRecord?.release() }
        audioRecord = null
        runCatching { micRecord?.stop() }
        runCatching { micRecord?.release() }
        micRecord = null

        runCatching { virtualDisplay?.release() }
        virtualDisplay = null

        runCatching { videoEncoder?.stop() }
        runCatching { videoEncoder?.release() }
        videoEncoder = null

        runCatching { audioEncoder?.stop() }
        runCatching { audioEncoder?.release() }
        audioEncoder = null

        runCatching { inputSurface?.release() }
        inputSurface = null

        synchronized(muxLock) {
            if (muxerStarted) runCatching { muxer?.stop() }
            runCatching { muxer?.release() }
            muxer = null
            muxerStarted = false
        }
    }

    override fun recordedMs(): Long {
        if (startedAt == 0L) return 0
        val pausedNow = if (pausedAtMs > 0) SystemClock.elapsedRealtime() - pausedAtMs else 0
        return SystemClock.elapsedRealtime() - startedAt - pausedTotalMs - pausedNow
    }

    private fun clamp16(v: Int): Short =
        when {
            v > Short.MAX_VALUE -> Short.MAX_VALUE
            v < Short.MIN_VALUE -> Short.MIN_VALUE
            else -> v.toShort()
        }

    companion object {
        private const val TAG = "CodecEngine"
        private const val TIMEOUT_US = 10_000L
        private const val SAMPLE_RATE = 44_100
        private const val CHANNELS = 2
        private const val AUDIO_BITRATE = 160_000
        private const val I_FRAME_SECONDS = 2
    }
}
