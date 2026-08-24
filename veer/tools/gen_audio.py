#!/usr/bin/env python3
"""Synthesize VeerPath's sound effects and ambient loop into app assets.

All sounds are generated (no third-party samples). Run:
    python3 tools/gen_audio.py
"""
import math
import os
import struct
import wave

import numpy as np

SR = 44100
OUT = os.path.join(os.path.dirname(__file__), "..", "app", "src", "main", "assets", "audio")


def write(name, data, sr=SR, target=0.95):
    """Peak-normalise then write. Without this the mix ends up inverted -
    the punish sound louder than the fanfare - because each synth voice has
    its own arbitrary amplitude."""
    os.makedirs(OUT, exist_ok=True)
    peak = float(np.abs(data).max()) or 1.0
    data = np.clip(data * (target / peak), -1.0, 1.0)
    pcm = (data * 32767).astype("<i2")
    path = os.path.join(OUT, name)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    print(f"  {name}  {len(data)/sr:.2f}s  peak {peak:.3f} -> {target}")
    return path


def to_ogg(wav_path, ogg_name, quality=3, rate=22050):
    """Re-encode a long bed to OGG. aapt2 stores .ogg uncompressed, so
    AssetFileDescriptor still works, and the APK drops ~1.2 MB."""
    import subprocess
    try:
        import imageio_ffmpeg
        ff = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        print("  (ffmpeg unavailable - keeping WAV)")
        return None
    out = os.path.join(OUT, ogg_name)
    r = subprocess.run([ff, "-y", "-i", wav_path, "-ac", "1", "-ar", str(rate),
                        "-c:a", "libvorbis", "-q:a", str(quality), out],
                       capture_output=True)
    if r.returncode != 0:
        print("  (ogg encode failed - keeping WAV)")
        return None
    os.remove(wav_path)
    print(f"  {ogg_name}  {os.path.getsize(out)//1024} KB")
    return out


def env(n, attack=0.01, decay=0.1, sustain=0.0, release=0.1, hold=0.0):
    a = int(attack * SR); h = int(hold * SR); d = int(decay * SR); r = int(release * SR)
    a, h, d, r = max(a, 1), max(h, 0), max(d, 1), max(r, 1)
    # exponential decay/release and a slightly convex attack: linear ramps
    # are what make synthesised effects sound like a 1980s beeper
    body = np.concatenate([
        np.linspace(0, 1, a) ** 0.6,
        np.ones(h),
        sustain + (1 - sustain) * np.exp(-5 * np.linspace(0, 1, d)),
        sustain * np.exp(-6 * np.linspace(0, 1, r)),
    ])
    if len(body) < n:
        body = np.pad(body, (0, n - len(body)))
    return body[:n]


def tone(freq, n, kind="sine", phase=0.0):
    t = np.arange(n) / SR
    if callable(freq):
        f = freq(t)
        ph = 2 * np.pi * np.cumsum(f) / SR + phase
    else:
        ph = 2 * np.pi * freq * t + phase
    if kind == "sine":
        return np.sin(ph)
    if kind == "tri":
        return 2 / np.pi * np.arcsin(np.sin(ph))
    if kind == "saw":
        return 2 * (ph / (2 * np.pi) % 1) - 1
    if kind == "square":
        return np.sign(np.sin(ph))
    raise ValueError(kind)


def noise(n):
    rng = np.random.default_rng(11)
    return rng.uniform(-1, 1, n)


def lowpass(x, cutoff):
    """One-pole low-pass."""
    a = math.exp(-2 * math.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc = a * acc + (1 - a) * v
        y[i] = acc
    return y


def highpass(x, cutoff):
    return x - lowpass(x, cutoff)


def lowpass_sweep(x, f0, f1):
    """One-pole low-pass whose cutoff glides f0 -> f1 (log) across the buffer."""
    cutoffs = np.geomspace(max(f0, 1.0), max(f1, 1.0), len(x))
    y = np.empty_like(x)
    acc = 0.0
    two_pi_over_sr = 2 * math.pi / SR
    for i, v in enumerate(x):
        a = math.exp(-two_pi_over_sr * cutoffs[i])
        acc = a * acc + (1 - a) * v
        y[i] = acc
    return y


def reverb(x, decay=0.35, delays=(0.017, 0.029, 0.043, 0.061), mix=0.28):
    out = x.copy()
    for i, d in enumerate(delays):
        k = int(d * SR)
        if k >= len(x):
            continue
        tail = np.zeros_like(x)
        tail[k:] = x[:-k] * (decay ** (i + 1))
        out += tail * mix
    return out / (1 + mix)


# ---------------- effects ----------------

def s_tap():
    """Inharmonic percussive click - the 1.508 ratio is deliberately
    non-integer so it reads as something struck, not a tone."""
    n = int(0.07 * SR)
    t = np.arange(n) / SR
    body = (tone(1240, n, "sine") * np.exp(-t / 0.028) * 0.5 +
            tone(1870, n, "sine") * np.exp(-t / 0.016) * 0.22)
    click = highpass(noise(n), 5000) * np.exp(-t / 0.0035) * 0.30
    return body + click


def s_launch():
    """Whoosh of something leaving: the spectrum and the pitch both fall."""
    n = int(0.30 * SR)
    air = lowpass_sweep(noise(n), 3600, 500) * env(n, 0.010, 0.10, 0.30, 0.16)
    body = tone(lambda tt: 520 * 2 ** (-tt / 0.22), n, "tri") * \
        env(n, 0.040, 0.12, 0.20, 0.14) * 0.35
    return air * 0.6 + body


def s_escape(base=660):
    """Bright pop with a quick upward blip - the satisfying 'gone' sound."""
    n = int(0.24 * SR)
    a = tone(base, n, "sine") * env(n, 0.003, 0.09, 0.1, 0.12)
    b = tone(base * 1.5, n, "sine") * env(n, 0.004, 0.07, 0.05, 0.10) * 0.5
    c = tone(lambda tt: base * 2 + 900 * tt, n, "sine") * env(n, 0.002, 0.05, 0, 0.05) * 0.25
    return reverb((a + b + c) * 0.55, mix=0.22)


def s_blocked():
    """Soft dull thud + short buzz: clearly negative, never harsh."""
    n = int(0.26 * SR)
    thud = tone(lambda tt: 200 * 2 ** (-tt / 0.16), n, "sine") * \
        env(n, 0.004, 0.10, 0.12, 0.12)
    buzz = tone(150, n, "square") * env(n, 0.002, 0.05, 0.0, 0.06) * 0.16
    knock = lowpass(noise(n), 900) * env(n, 0.001, 0.03, 0, 0.04) * 0.4
    return (thud * 0.7 + buzz + knock * 0.5) * 0.8


def s_star():
    n = int(0.35 * SR)
    out = np.zeros(n)
    for i, f in enumerate((1046.5, 1318.5, 1568.0)):
        seg = tone(f, n, "sine") * env(n, 0.004, 0.12, 0.08, 0.18)
        out += np.roll(seg, int(i * 0.012 * SR)) * (0.5 ** i)
    return reverb(out * 0.5, mix=0.3)


def s_win():
    """Rising four-note arpeggio with shimmer."""
    notes = [523.25, 659.25, 783.99, 1046.50]
    step = 0.11
    n = int((step * len(notes) + 0.9) * SR)
    out = np.zeros(n)
    for i, f in enumerate(notes):
        ln = int(0.9 * SR)
        seg = (tone(f, ln, "sine") * 0.6 + tone(f * 2, ln, "sine") * 0.18 +
               tone(f * 3, ln, "sine") * 0.07) * env(ln, 0.006, 0.25, 0.22, 0.55)
        off = int(i * step * SR)
        out[off:off + ln] += seg[:max(0, n - off)] * (0.9 - i * 0.08)
    return reverb(out * 0.45, decay=0.45, mix=0.34)


def s_music():
    """Seamless ambient bed. Each chord's release runs into the next bar and
    the tail wraps back onto the head, so there is no gap at the loop point
    and no dropout between chords."""
    bars = 8
    bar = 4.0
    n = int(bars * bar * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    # chord progression (Am - F - C - G) as smooth pads
    chords = [(220.00, 261.63, 329.63), (174.61, 220.00, 261.63),
              (261.63, 329.63, 392.00), (196.00, 246.94, 293.66),
              (220.00, 261.63, 329.63), (146.83, 174.61, 220.00),
              (174.61, 220.00, 261.63), (196.00, 246.94, 293.66)]
    tail_len = int(2.6 * SR)
    for bi, chord in enumerate(chords):
        start = int(bi * bar * SR)
        ln = int(bar * SR) + tail_len
        seg = np.zeros(ln)
        for f in chord:
            det = tone(f, ln, "sine") + tone(f * 1.005, ln, "sine") * 0.5
            seg += det * 0.3
        seg += tone(chord[0] / 2, ln, "sine") * 0.12          # sub-bass root
        seg *= env(ln, 1.2, 1.6, 0.55, 2.6, hold=0.4)
        end = start + ln
        if end <= n:
            out[start:end] += seg * 0.22
        else:
            head = n - start
            out[start:] += seg[:head] * 0.22
            wrap = min(len(seg) - head, n)
            out[:wrap] += seg[head:head + wrap] * 0.22        # tail wraps to the head
    # sparse pings on a pentatonic scale
    ping_scale = [523.25, 587.33, 659.25, 783.99, 880.00]
    rng = np.random.default_rng(5)
    for k in range(20):
        f = ping_scale[rng.integers(0, len(ping_scale))]
        off = int((k * (bars * bar / 20) + rng.uniform(0, 0.2)) * SR)
        ln = min(int(1.2 * SR), n - off)
        if ln <= 0:
            continue
        seg = tone(f, ln, "sine") * env(ln, 0.01, 0.4, 0.05, 0.7) * 0.07
        out[off:off + ln] += seg
    out = reverb(out, decay=0.5, mix=0.4)
    return out


def s_flame():
    """Fiery swoosh for the Flame skin: crackling band-passed noise over a
    rising airy sweep, so it reads as ignition + whoosh rather than a hiss."""
    n = int(0.42 * SR)
    t = np.arange(n) / SR
    air = noise(n)
    lo = lowpass(air, 500)
    mid = lowpass(air, 2600) - lowpass(air, 700)
    hi = highpass(air, 4200)
    blend = np.linspace(0, 1, n)
    body = (lo * (1 - blend) * 0.9 + mid * 0.8 + hi * blend * 0.5)
    body *= env(n, 0.010, 0.16, 0.34, 0.22)
    # crackle: sparse impulses shaped by a fast decay
    rng = np.random.default_rng(23)
    crackle = np.zeros(n)
    for _ in range(26):
        i = rng.integers(0, n - 400)
        ln = int(rng.integers(120, 380))
        crackle[i:i + ln] += (rng.uniform(-1, 1, ln) *
                              np.exp(-np.linspace(0, 6, ln)) * rng.uniform(0.2, 0.7))
    crackle = highpass(crackle, 1800) * 0.5
    swell = tone(lambda tt: 120 + 300 * tt / max(t[-1], 1e-6), n, "tri") * \
        env(n, 0.02, 0.2, 0.15, 0.2) * 0.18
    return reverb((body * 0.7 + crackle + swell) * 0.8, mix=0.18)


def main():
    print("synthesizing audio...")
    write("tap.wav", s_tap())
    write("launch.wav", s_launch())
    write("flame.wav", s_flame())
    write("escape.wav", s_escape())
    write("blocked.wav", s_blocked())
    write("star.wav", s_star())
    write("win.wav", s_win())
    music_wav = write("music.wav", s_music(), target=0.50)
    to_ogg(music_wav, "music.ogg")


if __name__ == "__main__":
    main()
