package com.imran.recorder.record

import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.MediaRecorder
import android.media.projection.MediaProjection
import android.os.SystemClock
import android.util.Log
import com.imran.recorder.data.AudioSource
import java.io.FileDescriptor

/**
 * Silent and microphone captures. MediaRecorder owns the muxer, timestamps and
 * pause/resume internally, which makes this by far the most reliable path — so it
 * handles every mode that does not require device-audio capture.
 */
class MediaRecorderEngine : RecorderEngine {

    private var recorder: MediaRecorder? = null
    private var virtualDisplay: VirtualDisplay? = null

    private var startedAt = 0L
    private var pausedAt = 0L
    private var pausedTotal = 0L
    private var stopped = false

    override fun start(projection: MediaProjection, cfg: RecordConfig, fd: FileDescriptor): Boolean {
        val r = MediaRecorder()
        try {
            if (cfg.audio.needsMic) {
                r.setAudioSource(MediaRecorder.AudioSource.MIC)
            }
            r.setVideoSource(MediaRecorder.VideoSource.SURFACE)
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)

            r.setVideoEncoder(MediaRecorder.VideoEncoder.H264)
            r.setVideoSize(cfg.width, cfg.height)
            r.setVideoFrameRate(cfg.fps)
            r.setVideoEncodingBitRate(cfg.bitrate)

            if (cfg.audio.needsMic) {
                r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                r.setAudioChannels(1)
                r.setAudioSamplingRate(44_100)
                r.setAudioEncodingBitRate(128_000)
            }

            r.setOutputFile(fd)
            r.prepare()

            virtualDisplay = projection.createVirtualDisplay(
                "ImranRecorder",
                cfg.width, cfg.height, cfg.dpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                r.surface, null, null
            )

            r.start()
            recorder = r
            startedAt = SystemClock.elapsedRealtime()
            pausedTotal = 0
            stopped = false
            return true
        } catch (t: Throwable) {
            Log.e(TAG, "start failed", t)
            runCatching { r.reset() }
            runCatching { r.release() }
            runCatching { virtualDisplay?.release() }
            virtualDisplay = null
            recorder = null
            return false
        }
    }

    override fun pause() {
        val r = recorder ?: return
        runCatching {
            r.pause()
            pausedAt = SystemClock.elapsedRealtime()
        }.onFailure { Log.w(TAG, "pause failed", it) }
    }

    override fun resume() {
        val r = recorder ?: return
        runCatching {
            r.resume()
            if (pausedAt > 0) {
                pausedTotal += SystemClock.elapsedRealtime() - pausedAt
                pausedAt = 0
            }
        }.onFailure { Log.w(TAG, "resume failed", it) }
    }

    override fun stop() {
        if (stopped) return
        stopped = true
        val r = recorder
        recorder = null

        if (r != null) {
            // stop() throws when no frame ever reached the encoder; the file is then
            // unusable and the caller discards it.
            runCatching { r.stop() }.onFailure { Log.w(TAG, "stop threw", it) }
            runCatching { r.reset() }
            runCatching { r.release() }
        }
        runCatching { virtualDisplay?.release() }
        virtualDisplay = null
    }

    override fun recordedMs(): Long {
        if (startedAt == 0L) return 0
        val pausedNow = if (pausedAt > 0) SystemClock.elapsedRealtime() - pausedAt else 0
        return SystemClock.elapsedRealtime() - startedAt - pausedTotal - pausedNow
    }

    companion object {
        private const val TAG = "MediaRecorderEngine"

        fun canHandle(audio: AudioSource) = !audio.needsProjectionAudio
    }
}
