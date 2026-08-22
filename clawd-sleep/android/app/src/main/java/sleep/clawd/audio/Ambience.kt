package sleep.clawd.audio

import java.io.File
import java.io.RandomAccessFile
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.sin
import kotlin.math.tanh

/**
 * Procedural ambience.
 *
 * The app ships no audio files. Each bed is synthesised once into a WAV in the
 * cache directory and handed to ExoPlayer on repeat, which means playback rides
 * on the same rock-solid path as the user's own music — audio focus, the
 * foreground service, Doze, all of it — instead of a hand-rolled AudioTrack loop
 * that has to survive eight hours on its own.
 *
 * A looped recording is normally obvious by the third pass. Two things prevent
 * that here: the bed is 60 seconds long, and its tail is crossfaded into its own
 * head with an equal-power curve, so the join is mathematically continuous. For
 * noise-based material that is genuinely inaudible.
 */
object Ambience {

    const val RAIN = "rain"
    const val OCEAN = "ocean"
    const val FOREST = "forest"
    const val FIRE = "fire"
    const val FAN = "fan"
    const val BROWN = "brown"
    const val WHITE = "white"

    val ALL = listOf(RAIN, OCEAN, FOREST, FIRE, FAN, BROWN, WHITE)

    fun displayName(id: String): String = when (id) {
        RAIN -> "rain"; OCEAN -> "ocean"; FOREST -> "forest"; FIRE -> "fireplace"
        FAN -> "fan"; BROWN -> "brown noise"; WHITE -> "white noise"; else -> id
    }

    fun hint(id: String): String = when (id) {
        RAIN -> "steady rain on a window"
        OCEAN -> "slow surf, long swell"
        FOREST -> "leaves, distant birds"
        FIRE -> "low fire, soft crackle"
        FAN -> "a fan in the next room"
        BROWN -> "deep, warm, featureless"
        WHITE -> "bright, masks everything"
        else -> ""
    }

    private const val SR = 44_100
    private const val SECONDS = 60
    private const val XFADE_SEC = 1.5

    /** Perceptual makeup so every bed sits at the same loudness on the slider. */
    private fun makeup(id: String) = when (id) {
        RAIN -> 0.90f; OCEAN -> 1.00f; FOREST -> 1.06f; FIRE -> 1.12f
        FAN -> 0.86f; BROWN -> 0.72f; WHITE -> 0.42f; else -> 1f
    }

    /* ------------------------------------------------------------- noise -- */

    /** xorshift-ish PRNG: deterministic, so a preset always sounds the same. */
    private class Rnd(seed: Long) {
        private var s = if (seed == 0L) 0x9E3779B97F4A7C15uL.toLong() else seed
        fun next(): Float {
            s = s xor (s shl 13); s = s xor (s ushr 7); s = s xor (s shl 17)
            return ((s ushr 11).toDouble() / 9007199254740992.0).toFloat() * 2f - 1f
        }
        fun uni(): Float = (next() + 1f) * 0.5f
    }

    /** Paul Kellet's refined pink filter. */
    private class Pink {
        private var b0 = 0f; private var b1 = 0f; private var b2 = 0f
        private var b3 = 0f; private var b4 = 0f; private var b5 = 0f; private var b6 = 0f
        fun next(w: Float): Float {
            b0 = 0.99886f * b0 + w * 0.0555179f
            b1 = 0.99332f * b1 + w * 0.0750759f
            b2 = 0.96900f * b2 + w * 0.1538520f
            b3 = 0.86650f * b3 + w * 0.3104856f
            b4 = 0.55000f * b4 + w * 0.5329522f
            b5 = -0.7616f * b5 - w * 0.0168980f
            val out = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362f) * 0.11f
            b6 = w * 0.115926f
            return out
        }
    }

    /** Leaky integrator, normalised. */
    private class Brown {
        private var last = 0f
        fun next(w: Float): Float { last = (last + 0.02f * w) / 1.02f; return last * 3.5f }
    }

    /* ------------------------------------------------------------ biquad -- */
    /**
     * RBJ cookbook biquad, direct form I. Web Audio hands these out for free;
     * on this side they have to be written down, so the two platforms are
     * filtering with the same coefficients.
     */
    private class Biquad(type: Type, freqHz: Double, q: Double, gainDb: Double = 0.0) {
        enum class Type { LOWPASS, HIGHPASS, BANDPASS, HIGHSHELF }

        private var a0 = 1.0; private var a1 = 0.0; private var a2 = 0.0
        private var b0 = 1.0; private var b1 = 0.0; private var b2 = 0.0
        private var x1 = 0.0; private var x2 = 0.0; private var y1 = 0.0; private var y2 = 0.0

        init { design(type, freqHz, q, gainDb) }

        private var type = type
        private var q = q
        private var gainDb = gainDb

        fun design(t: Type, freqHz: Double, qq: Double, g: Double) {
            val f = freqHz.coerceIn(20.0, SR / 2.0 - 200.0)
            val w0 = 2.0 * PI * f / SR
            val cw = cos(w0); val sw = sin(w0)
            val alpha = sw / (2.0 * qq)
            when (t) {
                Type.LOWPASS -> {
                    b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2
                    a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha
                }
                Type.HIGHPASS -> {
                    b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2
                    a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha
                }
                Type.BANDPASS -> {
                    b0 = alpha; b1 = 0.0; b2 = -alpha
                    a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha
                }
                Type.HIGHSHELF -> {
                    val a = Math.pow(10.0, g / 40.0)
                    val sa = 2.0 * Math.sqrt(a) * alpha
                    b0 = a * ((a + 1) + (a - 1) * cw + sa)
                    b1 = -2 * a * ((a - 1) + (a + 1) * cw)
                    b2 = a * ((a + 1) + (a - 1) * cw - sa)
                    a0 = (a + 1) - (a - 1) * cw + sa
                    a1 = 2 * ((a - 1) - (a + 1) * cw)
                    a2 = (a + 1) - (a - 1) * cw - sa
                }
            }
            b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0; a0 = 1.0
        }

        /** Re-tune the cutoff without resetting state — used for the ocean swell. */
        fun retune(freqHz: Double) = design(type, freqHz, q, gainDb)

        fun process(xIn: Float): Float {
            val x = xIn.toDouble()
            val y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
            x2 = x1; x1 = x; y2 = y1; y1 = y
            return y.toFloat()
        }
    }

    /* ------------------------------------------------------------ render -- */

    /**
     * Returns the WAV for [id], synthesising it on first use. Generation of a
     * 60-second stereo bed takes well under a second and happens once per
     * install, off the main thread.
     */
    fun fileFor(cacheDir: File, id: String): File {
        val dir = File(cacheDir, "ambience").apply { mkdirs() }
        val f = File(dir, "$id-v1.wav")
        if (f.exists() && f.length() > 44) return f
        val pcm = render(id)
        writeWav(f, pcm, SR, 2)
        return f
    }

    private fun render(id: String): ShortArray {
        val n = SR * SECONDS
        val xf = (XFADE_SEC * SR).toInt()
        // Render n + xf frames, then fold the tail back over the head.
        val total = n + xf
        val left = FloatArray(total)
        val right = FloatArray(total)

        for (ch in 0..1) {
            val out = if (ch == 0) left else right
            // Decorrelated seeds give a wide stereo image from one recipe.
            val rnd = Rnd(0x5EED1234L + ch * 7919L + id.hashCode())
            renderChannel(id, out, rnd)
        }

        val g = makeup(id)
        val pcm = ShortArray(n * 2)
        for (i in 0 until n) {
            var l = left[i]; var r = right[i]
            if (i < xf) {
                // equal power: the summed energy is flat across the join
                val t = i.toDouble() / xf
                val a = cos(t * PI / 2).toFloat()
                val b = sin(t * PI / 2).toFloat()
                l = l * b + left[n + i] * a
                r = r * b + right[n + i] * a
            }
            pcm[i * 2] = clip(l * g)
            pcm[i * 2 + 1] = clip(r * g)
        }
        return pcm
    }

    /** tanh soft clip, then to 16-bit. Nothing can clack, ever. */
    private fun clip(v: Float): Short {
        val s = (tanh(1.6f * v) / tanh(1.6f)).coerceIn(-1f, 1f)
        return (s * 32000f).toInt().toShort()
    }

    private fun renderChannel(id: String, out: FloatArray, rnd: Rnd) {
        val n = out.size
        when (id) {
            WHITE -> {
                val lp = Biquad(Biquad.Type.LOWPASS, 11000.0, 0.6)
                val sh = Biquad(Biquad.Type.HIGHSHELF, 4500.0, 0.7, -5.0)
                for (i in 0 until n) out[i] = sh.process(lp.process(rnd.next())) * 0.6f
            }
            BROWN -> {
                val br = Brown(); val lp = Biquad(Biquad.Type.LOWPASS, 1500.0, 0.5)
                for (i in 0 until n) out[i] = lp.process(br.next(rnd.next())) * 0.9f
            }
            RAIN -> {
                val hp = Biquad(Biquad.Type.HIGHPASS, 420.0, 0.6)
                val lp = Biquad(Biquad.Type.LOWPASS, 6200.0, 0.5)
                val roof = Biquad(Biquad.Type.LOWPASS, 780.0, 0.9)
                // droplet layer: a sparse train of decaying resonant blips
                var nextDrop = 0
                var dropAmp = 0f; var dropPhase = 0.0; var dropStep = 0.0; var dropDecay = 0.0
                for (i in 0 until n) {
                    val w = rnd.next()
                    // slow weather: cutoff wanders, so the shower breathes
                    if (i % 512 == 0) {
                        val t = i.toDouble() / SR
                        lp.retune(6200.0 + 900.0 * sin(2 * PI * t / 32.3))
                    }
                    var v = lp.process(hp.process(w)) * 0.62f + roof.process(w) * 0.34f
                    if (i >= nextDrop) {
                        nextDrop = i + (SR * (-ln(rnd.uni().coerceAtLeast(1e-6f).toDouble()) / 3.6)).toInt().coerceAtLeast(64)
                        dropAmp = 0.05f + rnd.uni() * 0.09f
                        dropStep = 2 * PI * (900.0 + rnd.uni() * 3200.0) / SR
                        dropPhase = 0.0
                        dropDecay = exp(-1.0 / (SR * (0.012 + rnd.uni() * 0.03)))
                    }
                    if (dropAmp > 1e-4f) {
                        v += (sin(dropPhase) * dropAmp).toFloat()
                        dropPhase += dropStep
                        dropAmp = (dropAmp * dropDecay).toFloat()
                    }
                    out[i] = v
                }
            }
            OCEAN -> {
                val pink = Pink()
                val lp = Biquad(Biquad.Type.LOWPASS, 850.0, 0.9)
                for (i in 0 until n) {
                    val t = i.toDouble() / SR
                    if (i % 256 == 0) {
                        // two incommensurate LFOs: the swell never lands twice
                        val f = 850.0 + 520.0 * sin(2 * PI * 0.0555 * t) + 260.0 * sin(2 * PI * 0.0837 * t)
                        lp.retune(f)
                    }
                    val swell = (0.62 + 0.26 * sin(2 * PI * 0.0555 * t)).toFloat()
                    out[i] = lp.process(pink.next(rnd.next())) * swell * 1.5f
                }
            }
            FOREST -> {
                val pink = Pink()
                val hp = Biquad(Biquad.Type.HIGHPASS, 180.0, 0.6)
                val lp = Biquad(Biquad.Type.LOWPASS, 2100.0, 0.6)
                var nextBird = SR * 3
                var birdLeft = 0; var birdPhase = 0.0; var birdStep = 0.0; var birdAmp = 0f
                for (i in 0 until n) {
                    val t = i.toDouble() / SR
                    if (i % 512 == 0) lp.retune(2100.0 + 700.0 * sin(2 * PI * 0.026 * t))
                    val wind = (0.50 + 0.17 * sin(2 * PI * 0.0193 * t)).toFloat()
                    var v = lp.process(hp.process(pink.next(rnd.next()))) * wind * 1.5f
                    if (i >= nextBird) {
                        nextBird = i + SR * (4 + (rnd.uni() * 10).toInt())
                        birdLeft = (SR * (0.07 + rnd.uni() * 0.06)).toInt()
                        birdStep = 2 * PI * (1900.0 + rnd.uni() * 1700.0) / SR
                        birdAmp = 0.010f + rnd.uni() * 0.012f
                        birdPhase = 0.0
                    }
                    if (birdLeft > 0) {
                        val env = sin(PI * (1.0 - birdLeft.toDouble() / (SR * 0.1))).coerceIn(0.0, 1.0)
                        v += (sin(birdPhase) * birdAmp * env).toFloat()
                        birdPhase += birdStep
                        birdLeft--
                    }
                    out[i] = v
                }
            }
            FIRE -> {
                val br = Brown()
                val lp = Biquad(Biquad.Type.LOWPASS, 430.0, 0.7)
                var nextCrack = 0
                var crackLeft = 0; var crackAmp = 0f; var crackPhase = 0.0; var crackStep = 0.0; var crackDecay = 0.0
                for (i in 0 until n) {
                    val t = i.toDouble() / SR
                    val breathe = (0.9 + 0.25 * sin(2 * PI * 0.047 * t)).toFloat()
                    var v = lp.process(br.next(rnd.next())) * breathe
                    if (i >= nextCrack) {
                        nextCrack = i + (SR * (-ln(rnd.uni().coerceAtLeast(1e-6f).toDouble()) / 2.4)).toInt().coerceAtLeast(48)
                        crackLeft = (SR * 0.05).toInt()
                        crackAmp = 0.02f + rnd.uni() * rnd.uni() * 0.13f
                        crackStep = 2 * PI * (700.0 + rnd.uni() * 3800.0) / SR
                        crackDecay = exp(-1.0 / (SR * (0.006 + rnd.uni() * 0.02)))
                        crackPhase = 0.0
                    }
                    if (crackLeft > 0) {
                        v += (sin(crackPhase) * crackAmp).toFloat()
                        crackPhase += crackStep
                        crackAmp = (crackAmp * crackDecay).toFloat()
                        crackLeft--
                    }
                    out[i] = v
                }
            }
            FAN -> {
                val pink = Pink()
                val bp = Biquad(Biquad.Type.BANDPASS, 340.0, 0.55)
                val lp = Biquad(Biquad.Type.LOWPASS, 1900.0, 0.5)
                for (i in 0 until n) {
                    val t = i.toDouble() / SR
                    val wash = (1.0 + 0.055 * sin(2 * PI * 0.21 * t)).toFloat()
                    var v = lp.process(bp.process(pink.next(rnd.next()))) * 3.2f * wash
                    // a slightly detuned motor pair, so the hum beats very slowly
                    v += (sin(2 * PI * 57.5 * t) * 0.055).toFloat()
                    v += (sin(2 * PI * 115.4 * t) * 0.022).toFloat()
                    out[i] = v
                }
            }
            else -> for (i in 0 until n) out[i] = rnd.next() * 0.3f
        }
        normalise(out)
    }

    /** Bring the peak to -3 dBFS so the makeup gains mean the same thing everywhere. */
    private fun normalise(a: FloatArray) {
        var peak = 0f
        for (v in a) { val x = abs(v); if (x > peak) peak = x }
        if (peak < 1e-6f) return
        val g = 0.707f / peak
        for (i in a.indices) a[i] *= g
    }

    /* -------------------------------------------------------------- wav --- */

    private fun writeWav(file: File, pcm: ShortArray, sampleRate: Int, channels: Int) {
        val tmp = File(file.parentFile, file.name + ".tmp")
        val dataBytes = pcm.size * 2
        RandomAccessFile(tmp, "rw").use { f ->
            f.setLength(0)
            fun s(v: String) = f.write(v.toByteArray(Charsets.US_ASCII))
            fun i32(v: Int) = f.write(byteArrayOf(
                (v and 0xFF).toByte(), ((v shr 8) and 0xFF).toByte(),
                ((v shr 16) and 0xFF).toByte(), ((v shr 24) and 0xFF).toByte()))
            fun i16(v: Int) = f.write(byteArrayOf((v and 0xFF).toByte(), ((v shr 8) and 0xFF).toByte()))

            s("RIFF"); i32(36 + dataBytes); s("WAVE")
            s("fmt "); i32(16); i16(1); i16(channels)
            i32(sampleRate); i32(sampleRate * channels * 2); i16(channels * 2); i16(16)
            s("data"); i32(dataBytes)

            val buf = ByteArray(dataBytes)
            var j = 0
            for (v in pcm) {
                val x = v.toInt()
                buf[j++] = (x and 0xFF).toByte()
                buf[j++] = ((x shr 8) and 0xFF).toByte()
            }
            f.write(buf)
        }
        // Rename only once the file is complete: a half-written WAV that survives
        // a crash would be cached forever and would click every 60 seconds.
        tmp.renameTo(file)
    }
}
