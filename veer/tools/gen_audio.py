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


def write(name, data, sr=SR):
    os.makedirs(OUT, exist_ok=True)
    data = np.clip(data, -1.0, 1.0)
    pcm = (data * 32767).astype("<i2")
    with wave.open(os.path.join(OUT, name), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    print(f"  {name}  {len(data)/sr:.2f}s")


def env(n, attack=0.01, decay=0.1, sustain=0.0, release=0.1, hold=0.0):
    a = int(attack * SR); h = int(hold * SR); d = int(decay * SR); r = int(release * SR)
    a, h, d, r = max(a, 1), max(h, 0), max(d, 1), max(r, 1)
    body = np.concatenate([
        np.linspace(0, 1, a),
        np.ones(h),
        np.linspace(1, sustain, d),
        np.linspace(sustain, 0, r),
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
    n = int(0.09 * SR)
    body = tone(880, n, "sine") * env(n, 0.002, 0.03, 0.0, 0.05)
    click = highpass(noise(n), 2500) * env(n, 0.001, 0.012, 0, 0.02) * 0.35
    return (body * 0.5 + click) * 0.7


def s_launch():
    """Whoosh: filtered noise sweeping up + a pitch-rising body."""
    n = int(0.30 * SR)
    t = np.arange(n) / SR
    sweep = noise(n) * env(n, 0.012, 0.10, 0.35, 0.16)
    cutoff = np.linspace(400, 5200, n)
    # time-varying low-pass approximated by blending two static passes
    lo = lowpass(sweep, 700)
    hi = lowpass(sweep, 5000)
    blend = np.linspace(0, 1, n)
    air = lo * (1 - blend) + hi * blend
    body = tone(lambda tt: 220 + 520 * tt / max(t[-1], 1e-6), n, "tri") * \
        env(n, 0.006, 0.12, 0.2, 0.14) * 0.30
    return (air * 0.55 + body) * 0.75


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
    thud = tone(lambda tt: 190 - 70 * tt, n, "sine") * env(n, 0.004, 0.10, 0.12, 0.12)
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
    """Seamless ~16s ambient bed: soft pad chords + sparse arpeggio pings."""
    bars = 4
    bar = 4.0
    n = int(bars * bar * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    # chord progression (Am - F - C - G) as smooth pads
    chords = [(220.00, 261.63, 329.63), (174.61, 220.00, 261.63),
              (261.63, 329.63, 392.00), (196.00, 246.94, 293.66)]
    for bi, chord in enumerate(chords):
        start = int(bi * bar * SR)
        ln = int(bar * SR)
        seg = np.zeros(ln)
        for f in chord:
            det = tone(f, ln, "sine") + tone(f * 1.005, ln, "sine") * 0.5
            seg += det * 0.3
        # long fade in/out per bar so loop points are silent-ish and seamless
        fade = np.minimum(np.linspace(0, 1, ln) * 4, 1) * np.minimum(np.linspace(1, 0, ln) * 4, 1)
        out[start:start + ln] += seg * fade * 0.22
    # sparse pings on a pentatonic scale
    ping_scale = [523.25, 587.33, 659.25, 783.99, 880.00]
    rng = np.random.default_rng(5)
    for k in range(12):
        f = ping_scale[rng.integers(0, len(ping_scale))]
        off = int((k * (bars * bar / 12) + rng.uniform(0, 0.2)) * SR)
        ln = int(1.2 * SR)
        if off + ln > n:
            ln = n - off
        seg = tone(f, ln, "sine") * env(ln, 0.01, 0.4, 0.05, 0.7) * 0.07
        out[off:off + ln] += seg
    out = reverb(out, decay=0.5, mix=0.4)
    # crossfade the tail into the head for a click-free loop
    x = int(0.5 * SR)
    ramp = np.linspace(0, 1, x)
    out[:x] = out[:x] * ramp + out[-x:] * (1 - ramp)
    out = out[:-x]
    return out * 0.85


def main():
    print("synthesizing audio...")
    write("tap.wav", s_tap())
    write("launch.wav", s_launch())
    write("escape.wav", s_escape())
    write("blocked.wav", s_blocked())
    write("star.wav", s_star())
    write("win.wav", s_win())
    write("music.wav", s_music())


if __name__ == "__main__":
    main()
