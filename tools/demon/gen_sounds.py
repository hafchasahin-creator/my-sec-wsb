"""Synthesize the demon's voice — pure-Python DSP, writes 16-bit mono WAVs.

Bedrock plays .wav sound files natively, so no external encoder is needed.
"""
import math
import os
import random
import struct
import wave

SR = 22050
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..",
                   "resource_packs", "flying_demon_rp", "sounds", "fdc")


def seconds(n):
    return int(n * SR)


def silence(n):
    return [0.0] * seconds(n)


def softclip(x, drive=1.0):
    return math.tanh(x * drive)


class LP:
    """One-pole lowpass with per-sample settable cutoff."""

    def __init__(self, cutoff):
        self.y = 0.0
        self.set(cutoff)

    def set(self, cutoff):
        c = max(10.0, min(cutoff, SR * 0.45))
        self.a = 1.0 - math.exp(-2.0 * math.pi * c / SR)

    def step(self, x):
        self.y += self.a * (x - self.y)
        return self.y


def env_points(n, points):
    """Piecewise-linear envelope; points = [(time_fraction, value), ...]."""
    out = [0.0] * n
    for i in range(n):
        t = i / n
        prev = points[0]
        nxt = points[-1]
        for k in range(len(points) - 1):
            if points[k][0] <= t <= points[k + 1][0]:
                prev, nxt = points[k], points[k + 1]
                break
        span = max(1e-9, nxt[0] - prev[0])
        f = (t - prev[0]) / span
        out[i] = prev[1] + (nxt[1] - prev[1]) * f
    return out


def add(dst, src, at=0.0, gain=1.0):
    o = seconds(at)
    for i, v in enumerate(src):
        j = o + i
        if 0 <= j < len(dst):
            dst[j] += v * gain
    return dst


def echo(x, delay, fb, mixv):
    d = seconds(delay)
    out = list(x)
    for i in range(d, len(x)):
        out[i] += out[i - d] * fb * mixv
    return out


def normalize(x, peak=0.82):
    m = max(1e-9, max(abs(v) for v in x))
    g = peak / m
    return [v * g for v in x]


def fade_edges(x, ain=0.008, aout=0.05):
    n = len(x)
    fi, fo = seconds(ain), seconds(aout)
    for i in range(min(fi, n)):
        x[i] *= i / fi
    for i in range(min(fo, n)):
        x[n - 1 - i] *= i / fo
    return x


def save(name, data):
    os.makedirs(OUT, exist_ok=True)
    data = fade_edges(normalize(data))
    path = os.path.join(OUT, name + ".wav")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        frames = bytearray()
        for v in data:
            frames += struct.pack("<h", int(max(-1, min(1, v)) * 32767))
        w.writeframes(bytes(frames))
    print("  ", os.path.basename(path), f"{len(data)/SR:.2f}s")


def voice(dur, f0_start, f0_end, growl_hz=28, growl_depth=0.55,
          drive=3.5, breath=0.22, lp_cut=1400, rng_seed="v"):
    """Core demon larynx: detuned saws + sub + growl AM + breath noise."""
    rng = random.Random(rng_seed)
    n = seconds(dur)
    out = [0.0] * n
    ph1 = ph2 = ph3 = 0.0
    lp = LP(lp_cut)
    nlp = LP(2400)
    nhp = LP(500)
    for i in range(n):
        t = i / n
        f = f0_start + (f0_end - f0_start) * t
        f *= 1.0 + 0.01 * math.sin(2 * math.pi * 5.2 * i / SR)  # vibrato/instability
        ph1 += f / SR
        ph2 += (f * 1.011) / SR
        ph3 += (f * 0.5) / SR
        saw = (ph1 % 1.0) * 2 - 1
        saw2 = (ph2 % 1.0) * 2 - 1
        sub = math.sin(2 * math.pi * ph3)
        growl = 1.0 - growl_depth * (0.5 + 0.5 * math.sin(2 * math.pi * growl_hz * i / SR))
        nz = rng.uniform(-1, 1)
        band = nlp.step(nz) - nhp.step(nz)
        raw = (0.55 * saw + 0.35 * saw2 + 0.5 * sub) * growl + breath * band
        out[i] = softclip(lp.step(raw), drive)
    return out


def gen_roar():
    body = voice(2.2, 96, 60, growl_hz=27, growl_depth=0.6, drive=3.8,
                 breath=0.26, lp_cut=1500, rng_seed="roar")
    e = env_points(len(body), [(0, 0), (0.03, 1), (0.62, 0.95), (1.0, 0)])
    body = [v * g for v, g in zip(body, e)]
    return echo(body, 0.13, 0.34, 1.0)


def gen_rage():
    n = seconds(2.7)
    out = [0.0] * n
    # riser: filtered noise sweep + rising tone
    rng = random.Random("rage")
    lp = LP(300)
    ph = 0.0
    rise = seconds(0.75)
    for i in range(rise):
        t = i / rise
        lp.set(300 + 3800 * t * t)
        f = 58 + 60 * t
        ph += f / SR
        v = lp.step(rng.uniform(-1, 1)) * 0.8 + 0.5 * math.sin(2 * math.pi * ph)
        out[i] = softclip(v, 2.2) * (0.25 + 0.75 * t)
    blast = voice(1.95, 118, 66, growl_hz=31, growl_depth=0.65, drive=5.0,
                  breath=0.3, lp_cut=1900, rng_seed="rageblast")
    e = env_points(len(blast), [(0, 0), (0.02, 1), (0.7, 0.9), (1.0, 0)])
    blast = [v * g for v, g in zip(blast, e)]
    add(out, blast, at=0.72)
    return echo(out, 0.11, 0.3, 1.0)


def gen_growl():
    body = voice(1.5, 58, 50, growl_hz=24, growl_depth=0.7, drive=2.6,
                 breath=0.12, lp_cut=600, rng_seed="growl")
    e = env_points(len(body), [(0, 0), (0.1, 0.9), (0.75, 0.8), (1.0, 0)])
    return [v * g for v, g in zip(body, e)]


def _thump(dur, f_start, f_end, gain=1.0):
    n = seconds(dur)
    out = [0.0] * n
    ph = 0.0
    for i in range(n):
        t = i / n
        f = f_start + (f_end - f_start) * t
        ph += f / SR
        out[i] = math.sin(2 * math.pi * ph) * (1 - t) ** 1.6 * gain
    return out


def _crunch(dur, cutoff, seed, gain=1.0):
    rng = random.Random(seed)
    n = seconds(dur)
    lp = LP(cutoff)
    out = []
    for i in range(n):
        t = i / n
        v = lp.step(rng.uniform(-1, 1)) * (1 - t) ** 2.2
        # crackly amplitude gating for a bone-splinter feel
        if rng.random() < 0.06:
            v *= 2.4
        out.append(softclip(v, 2.0) * gain)
    return out


def gen_bite():
    n = seconds(0.38)
    out = [0.0] * n
    add(out, _crunch(0.05, 5200, "snapclick", 0.9), 0.0)
    add(out, _thump(0.3, 150, 55, 1.0), 0.015)
    add(out, _crunch(0.16, 1500, "snapbody", 0.8), 0.02)
    return out


def gen_eat():
    n = seconds(1.35)
    out = [0.0] * n
    for k, at in enumerate((0.0, 0.45, 0.85)):
        add(out, _crunch(0.2, 1300 + 200 * k, f"eat{k}", 0.95), at)
        add(out, _thump(0.22, 120, 48, 0.8), at + 0.01)
        # wet squelch: quick downward chirp
        sq = _thump(0.12, 340, 90, 0.5)
        add(out, sq, at + 0.05)
    g = voice(0.5, 52, 46, growl_hz=22, growl_depth=0.7, drive=2.0,
              breath=0.08, lp_cut=420, rng_seed="eatgrowl")
    e = env_points(len(g), [(0, 0), (0.2, 0.5), (1.0, 0)])
    add(out, [v * gg for v, gg in zip(g, e)], 1.0)
    return out


def gen_fire():
    rng = random.Random("fire")
    n = seconds(2.0)
    out = [0.0] * n
    lp = LP(850)
    for i in range(n):
        t = i / n
        e = min(1, t * 7) * (1 - max(0, (t - 0.72)) / 0.28) ** 1.4
        v = lp.step(rng.uniform(-1, 1)) * e
        out[i] = softclip(v * 1.6, 1.8)
    # crackle impulses
    lp2 = LP(3200)
    imp = [0.0] * n
    i = seconds(0.1)
    while i < n:
        amp = rng.uniform(0.3, 1.0)
        w = rng.randint(8, 30)
        for k in range(w):
            if i + k < n:
                imp[i + k] += rng.uniform(-1, 1) * amp * (1 - k / w)
        i += rng.randint(int(0.012 * SR), int(0.05 * SR))
    for i in range(n):
        t = i / n
        e = min(1, t * 6) * (1 - max(0, (t - 0.75)) / 0.25) ** 1.5
        out[i] += lp2.step(imp[i]) * 0.4 * e
    # low rumble under it
    add(out, [v * 0.5 for v in voice(1.9, 46, 40, growl_hz=17, growl_depth=0.5,
                                     drive=1.6, breath=0.0, lp_cut=260,
                                     rng_seed="firerumble")], 0.05)
    return out


def gen_flap():
    rng = random.Random("flap")
    n = seconds(0.48)
    out = [0.0] * n
    lp = LP(500)
    for i in range(n):
        t = i / n
        cut = 380 + 1300 * math.sin(math.pi * min(1, t * 1.25)) ** 2
        lp.set(cut)
        e = math.sin(math.pi * t) ** 1.3
        out[i] = softclip(lp.step(rng.uniform(-1, 1)) * e * 1.7, 1.5)
    add(out, _thump(0.14, 90, 55, 0.5), 0.3)
    return out


def gen_hurt():
    body = voice(0.7, 130, 74, growl_hz=36, growl_depth=0.5, drive=3.4,
                 breath=0.25, lp_cut=1700, rng_seed="hurt")
    e = env_points(len(body), [(0, 0), (0.04, 1), (0.5, 0.7), (1.0, 0)])
    return [v * g for v, g in zip(body, e)]


def gen_death():
    body = voice(2.9, 92, 36, growl_hz=26, growl_depth=0.6, drive=3.6,
                 breath=0.28, lp_cut=1300, rng_seed="death")
    e = env_points(len(body), [(0, 0), (0.04, 1), (0.42, 0.9), (0.85, 0.4), (1.0, 0)])
    body = [v * g for v, g in zip(body, e)]
    # slowing heartbeat-ish thuds at the end
    add(body, _thump(0.3, 70, 40, 0.7), 2.15)
    add(body, _thump(0.34, 60, 34, 0.6), 2.55)
    return echo(body, 0.16, 0.36, 1.0)


def gen_land():
    n = seconds(0.55)
    out = [0.0] * n
    add(out, _thump(0.3, 95, 42, 1.0), 0.0)
    add(out, _crunch(0.22, 700, "landdust", 0.55), 0.01)
    add(out, _thump(0.16, 70, 40, 0.45), 0.2)
    return out


def main():
    print("synthesizing sounds:")
    save("roar", gen_roar())
    save("rage", gen_rage())
    save("growl", gen_growl())
    save("bite", gen_bite())
    save("eat", gen_eat())
    save("fire", gen_fire())
    save("flap", gen_flap())
    save("hurt", gen_hurt())
    save("death", gen_death())
    save("land", gen_land())


if __name__ == "__main__":
    main()
