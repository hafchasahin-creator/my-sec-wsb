package com.imran.recorder.record

import android.content.Context
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat
import android.media.projection.MediaProjection
import android.os.Build
import android.util.DisplayMetrics
import android.view.WindowManager
import com.imran.recorder.data.AudioSource
import com.imran.recorder.data.Orientation
import com.imran.recorder.data.Prefs
import java.io.FileDescriptor

data class RecordConfig(
    val width: Int,
    val height: Int,
    val dpi: Int,
    val fps: Int,
    val bitrate: Int,
    val audio: AudioSource
)

/**
 * Two engines implement this:
 *  - [MediaRecorderEngine] for silent and microphone captures (the platform muxer
 *    handles timestamps and pause/resume, so it is the safest default).
 *  - [CodecEngine] for device-audio captures, which MediaRecorder cannot do at all.
 */
interface RecorderEngine {
    /** @return true if capture actually started. */
    fun start(projection: MediaProjection, cfg: RecordConfig, fd: FileDescriptor): Boolean
    fun pause()
    fun resume()
    /** Finalises the file. Safe to call more than once. */
    fun stop()
    /** Milliseconds of content actually recorded, excluding paused time. */
    fun recordedMs(): Long
}

object EncoderCaps {

    private fun avcCaps(): MediaCodecInfo.VideoCapabilities? {
        val list = MediaCodecList(MediaCodecList.REGULAR_CODECS)
        for (info in list.codecInfos) {
            if (!info.isEncoder) continue
            if (info.supportedTypes.none { it.equals(MediaFormat.MIMETYPE_VIDEO_AVC, true) }) continue
            return runCatching {
                info.getCapabilitiesForType(MediaFormat.MIMETYPE_VIDEO_AVC).videoCapabilities
            }.getOrNull() ?: continue
        }
        return null
    }

    /**
     * Snaps a requested size onto something the device's H.264 encoder will accept.
     * Without this, unusual display sizes make configure()/start() throw on some devices.
     */
    fun clampSize(width: Int, height: Int): Pair<Int, Int> {
        val caps = avcCaps() ?: return even(width) to even(height)

        val wAlign = caps.widthAlignment.coerceAtLeast(2)
        val hAlign = caps.heightAlignment.coerceAtLeast(2)

        var w = align(width.coerceIn(caps.supportedWidths.lower, caps.supportedWidths.upper), wAlign)
        var h = align(height.coerceIn(caps.supportedHeights.lower, caps.supportedHeights.upper), hAlign)

        // Height support can depend on the chosen width, so re-clamp once w is fixed.
        runCatching {
            val hRange = caps.getSupportedHeightsFor(w)
            h = align(h.coerceIn(hRange.lower, hRange.upper), hAlign)
        }
        runCatching {
            val wRange = caps.getSupportedWidthsFor(h)
            w = align(w.coerceIn(wRange.lower, wRange.upper), wAlign)
        }
        return w to h
    }

    fun clampFps(width: Int, height: Int, fps: Int): Int {
        val caps = avcCaps() ?: return fps
        return runCatching {
            val range = caps.getSupportedFrameRatesFor(width, height)
            fps.toDouble().coerceIn(range.lower, range.upper).toInt().coerceAtLeast(1)
        }.getOrDefault(fps)
    }

    fun clampBitrate(bitrate: Int): Int {
        val caps = avcCaps() ?: return bitrate
        return bitrate.coerceIn(caps.bitrateRange.lower, caps.bitrateRange.upper)
    }

    fun maxFpsSupported(): Int {
        val caps = avcCaps() ?: return 60
        return runCatching { caps.supportedFrameRates.upper.toInt() }.getOrDefault(60)
    }

    private fun align(v: Int, a: Int) = (v / a) * a
    private fun even(v: Int) = v - (v % 2)
}

object CaptureGeometry {

    /** Real display size in pixels, including the area under system bars. */
    fun displaySize(context: Context): Triple<Int, Int, Int> {
        val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val dpi = context.resources.displayMetrics.densityDpi
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val b = wm.maximumWindowMetrics.bounds
            Triple(b.width(), b.height(), dpi)
        } else {
            val m = DisplayMetrics()
            @Suppress("DEPRECATION")
            wm.defaultDisplay.getRealMetrics(m)
            Triple(m.widthPixels, m.heightPixels, m.densityDpi)
        }
    }

    /**
     * Builds the capture config from the current display and the user's settings:
     * honours the orientation preference, scales to the chosen short edge and then
     * snaps everything onto encoder-legal values.
     */
    fun configFor(context: Context): RecordConfig {
        val (rawW, rawH, dpi) = displaySize(context)

        var w = rawW
        var h = rawH
        when (Prefs.orientation) {
            Orientation.PORTRAIT -> if (w > h) { val t = w; w = h; h = t }
            Orientation.LANDSCAPE -> if (h > w) { val t = w; w = h; h = t }
            Orientation.AUTO -> Unit
        }

        val target = Prefs.resolution
        if (target > 0) {
            val shortEdge = minOf(w, h)
            if (shortEdge > target) {
                val scale = target.toDouble() / shortEdge
                w = (w * scale).toInt()
                h = (h * scale).toInt()
            }
        }

        val (cw, ch) = EncoderCaps.clampSize(w, h)
        val fps = EncoderCaps.clampFps(cw, ch, Prefs.fps)
        val bitrate = EncoderCaps.clampBitrate(Prefs.bitrateFor(cw, ch, fps))

        return RecordConfig(cw, ch, dpi, fps, bitrate, Prefs.audioSource)
    }
}
