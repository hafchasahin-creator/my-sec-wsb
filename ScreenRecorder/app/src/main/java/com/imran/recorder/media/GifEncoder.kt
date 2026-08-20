package com.imran.recorder.media

import android.graphics.Bitmap
import java.io.OutputStream

/**
 * GIF89a writer: median-cut global palette plus the standard variable-width LZW coder.
 * Self-contained so the GIF tool needs no native or third-party encoder.
 */
class GifEncoder(
    private val out: OutputStream,
    private val width: Int,
    private val height: Int,
    private val delayCentis: Int,
    private val loop: Boolean = true
) {

    private var palette: IntArray = IntArray(0)
    private var started = false
    private val nearestCache = HashMap<Int, Int>()

    /** The palette is global, so it is built once from the first frame. */
    fun addFrame(bitmap: Bitmap) {
        val pixels = IntArray(width * height)
        val scaled = if (bitmap.width == width && bitmap.height == height) {
            bitmap
        } else {
            Bitmap.createScaledBitmap(bitmap, width, height, true)
        }
        scaled.getPixels(pixels, 0, width, 0, 0, width, height)
        if (scaled !== bitmap) scaled.recycle()

        if (!started) {
            palette = MedianCut.build(pixels, 256)
            writeHeader()
            started = true
        }

        val indices = ByteArray(pixels.size)
        for (i in pixels.indices) {
            indices[i] = nearest(pixels[i]).toByte()
        }

        writeGraphicControl()
        writeImageDescriptor()
        Lzw(indices, 8).encodeTo(out)
    }

    fun finish() {
        if (!started) return
        out.write(0x3B) // trailer
        out.flush()
    }

    // ---------------- palette lookup ----------------

    private fun nearest(argb: Int): Int {
        // Cache on 5-bits-per-channel buckets: exact enough, and keeps the inner loop cheap.
        val key = ((argb shr 19) and 0x1F shl 10) or
            ((argb shr 11) and 0x1F shl 5) or
            ((argb shr 3) and 0x1F)
        nearestCache[key]?.let { return it }

        val r = (argb shr 16) and 0xFF
        val g = (argb shr 8) and 0xFF
        val b = argb and 0xFF

        var best = 0
        var bestDist = Int.MAX_VALUE
        for (i in palette.indices) {
            val p = palette[i]
            val dr = r - ((p shr 16) and 0xFF)
            val dg = g - ((p shr 8) and 0xFF)
            val db = b - (p and 0xFF)
            val dist = dr * dr + dg * dg + db * db
            if (dist < bestDist) {
                bestDist = dist
                best = i
                if (dist == 0) break
            }
        }
        nearestCache[key] = best
        return best
    }

    // ---------------- GIF structure ----------------

    private fun writeHeader() {
        out.write("GIF89a".toByteArray(Charsets.US_ASCII))
        writeShort(width)
        writeShort(height)
        // Global colour table, 8 bits per channel, 256 entries.
        out.write(0xF7)
        out.write(0) // background index
        out.write(0) // pixel aspect ratio

        for (i in 0 until 256) {
            val c = if (i < palette.size) palette[i] else 0
            out.write((c shr 16) and 0xFF)
            out.write((c shr 8) and 0xFF)
            out.write(c and 0xFF)
        }

        if (loop) {
            out.write(0x21)
            out.write(0xFF)
            out.write(11)
            out.write("NETSCAPE2.0".toByteArray(Charsets.US_ASCII))
            out.write(3)
            out.write(1)
            writeShort(0) // repeat forever
            out.write(0)
        }
    }

    private fun writeGraphicControl() {
        out.write(0x21)
        out.write(0xF9)
        out.write(4)
        out.write(0) // no transparency, no disposal
        writeShort(delayCentis)
        out.write(0)
        out.write(0)
    }

    private fun writeImageDescriptor() {
        out.write(0x2C)
        writeShort(0)
        writeShort(0)
        writeShort(width)
        writeShort(height)
        out.write(0) // no local colour table
    }

    private fun writeShort(value: Int) {
        out.write(value and 0xFF)
        out.write((value shr 8) and 0xFF)
    }

    // ---------------- LZW ----------------

    private class Lzw(private val pixels: ByteArray, private val minCodeSize: Int) {

        fun encodeTo(out: OutputStream) {
            out.write(minCodeSize)

            val clearCode = 1 shl minCodeSize
            val endCode = clearCode + 1

            var codeSize = minCodeSize + 1
            var nextCode = endCode + 1
            var dictionary = HashMap<Long, Int>()

            val blocks = BlockWriter(out)
            var bitBuffer = 0
            var bitCount = 0

            fun emit(code: Int) {
                bitBuffer = bitBuffer or (code shl bitCount)
                bitCount += codeSize
                while (bitCount >= 8) {
                    blocks.write(bitBuffer and 0xFF)
                    bitBuffer = bitBuffer ushr 8
                    bitCount -= 8
                }
            }

            emit(clearCode)

            if (pixels.isEmpty()) {
                emit(endCode)
            } else {
                var prefix = pixels[0].toInt() and 0xFF

                for (i in 1 until pixels.size) {
                    val next = pixels[i].toInt() and 0xFF
                    val key = (prefix.toLong() shl 8) or next.toLong()
                    val existing = dictionary[key]
                    if (existing != null) {
                        prefix = existing
                    } else {
                        emit(prefix)
                        if (nextCode < 4096) {
                            dictionary[key] = nextCode
                            if (nextCode == (1 shl codeSize) && codeSize < 12) codeSize++
                            nextCode++
                        } else {
                            emit(clearCode)
                            dictionary = HashMap()
                            codeSize = minCodeSize + 1
                            nextCode = endCode + 1
                        }
                        prefix = next
                    }
                }
                emit(prefix)
                emit(endCode)
            }

            if (bitCount > 0) blocks.write(bitBuffer and 0xFF)
            blocks.flush()
            out.write(0) // block terminator
        }
    }

    /** GIF image data is carried in sub-blocks of at most 255 bytes. */
    private class BlockWriter(private val out: OutputStream) {
        private val buffer = ByteArray(255)
        private var size = 0

        fun write(byte: Int) {
            buffer[size++] = byte.toByte()
            if (size == 255) flush()
        }

        fun flush() {
            if (size == 0) return
            out.write(size)
            out.write(buffer, 0, size)
            size = 0
        }
    }

    /** Builds a global palette by repeatedly splitting the widest colour box. */
    private object MedianCut {

        private class Box(val pixels: IntArray, val from: Int, val to: Int) {
            var rMin = 255; var rMax = 0
            var gMin = 255; var gMax = 0
            var bMin = 255; var bMax = 0

            init {
                for (i in from until to) {
                    val p = pixels[i]
                    val r = (p shr 16) and 0xFF
                    val g = (p shr 8) and 0xFF
                    val b = p and 0xFF
                    if (r < rMin) rMin = r
                    if (r > rMax) rMax = r
                    if (g < gMin) gMin = g
                    if (g > gMax) gMax = g
                    if (b < bMin) bMin = b
                    if (b > bMax) bMax = b
                }
            }

            val count get() = to - from
            val widest: Int
                get() {
                    val dr = rMax - rMin
                    val dg = gMax - gMin
                    val db = bMax - bMin
                    return when {
                        dr >= dg && dr >= db -> 0
                        dg >= db -> 1
                        else -> 2
                    }
                }
            val volume get() = (rMax - rMin) * (gMax - gMin) * (bMax - bMin)

            fun average(): Int {
                var r = 0L; var g = 0L; var b = 0L
                for (i in from until to) {
                    val p = pixels[i]
                    r += (p shr 16) and 0xFF
                    g += (p shr 8) and 0xFF
                    b += p and 0xFF
                }
                val n = count.coerceAtLeast(1)
                return ((r / n).toInt() shl 16) or ((g / n).toInt() shl 8) or (b / n).toInt()
            }
        }

        fun build(source: IntArray, maxColors: Int): IntArray {
            // Subsample large frames: a few tens of thousands of pixels define the palette well.
            val step = (source.size / 40_000).coerceAtLeast(1)
            val sample = IntArray((source.size + step - 1) / step)
            var w = 0
            var i = 0
            while (i < source.size && w < sample.size) {
                sample[w++] = source[i] and 0xFFFFFF
                i += step
            }

            val boxes = ArrayList<Box>()
            boxes += Box(sample, 0, w)

            while (boxes.size < maxColors) {
                val target = boxes
                    .filter { it.count > 1 && it.volume > 0 }
                    .maxByOrNull { it.volume.toLong() * it.count }
                    ?: break

                val shift = when (target.widest) { 0 -> 16; 1 -> 8; else -> 0 }
                // Arrays.sort has no ranged comparator overload for IntArray, so sort a boxed
                // copy of just this box's slice and write it back.
                val slice = sample.copyOfRange(target.from, target.to).toTypedArray()
                java.util.Arrays.sort(slice) { a, b ->
                    ((a shr shift) and 0xFF) - ((b shr shift) and 0xFF)
                }
                for (k in slice.indices) sample[target.from + k] = slice[k]

                val mid = target.from + target.count / 2
                if (mid == target.from || mid == target.to) break

                boxes.remove(target)
                boxes += Box(sample, target.from, mid)
                boxes += Box(sample, mid, target.to)
            }

            val palette = IntArray(boxes.size.coerceAtLeast(1))
            for (index in boxes.indices) palette[index] = boxes[index].average()
            return palette
        }
    }
}
