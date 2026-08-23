#!/usr/bin/env python3
"""Synthesize the Magical Swords sound effects as OGG Vorbis files and write
sound_definitions.json.

Nine bespoke effects (ability casts, blink, equip shimmer) are generated with
simple DSP - filtered noise sweeps, FM growls, additive chimes - so the pack
ships genuinely custom audio without any external sample dependencies.

Usage:  python3 tools/gen_ms_sounds.py
"""

import json
import os

import numpy as np
import soundfile as sf

SR = 22050
RP = os.path.join("resource_packs", "magical_swords_rp")
OUT = os.path.join(RP, "sounds", "msword")

rng = np.random.default_rng(21026)


def t_axis(seconds):
    return np.linspace(0, seconds, int(SR * seconds), endpoint=False)


def env_ad(n, attack, decay_tau):
    """Attack-decay envelope: linear attack, exponential decay."""
    t = np.arange(n) / SR
    e = np.minimum(1.0, t / max(attack, 1e-4))
    e *= np.exp(-np.maximum(0.0, t - attack) / decay_tau)
    return e


def svf_bandpass(x, cutoff, q=2.0):
    """State-variable bandpass filter; cutoff may be an array (sweep)."""
    if np.isscalar(cutoff):
        cutoff = np.full(len(x), float(cutoff))
    f = 2.0 * np.sin(np.pi * np.minimum(cutoff, SR * 0.45) / SR)
    low = band = 0.0
    out = np.empty_like(x)
    inv_q = 1.0 / q
    for i in range(len(x)):
        low = low + f[i] * band
        high = x[i] - low - inv_q * band
        band = band + f[i] * high
        out[i] = band
    return out


def normalize(x, peak=0.9):
    m = np.max(np.abs(x))
    return x * (peak / m) if m > 0 else x


def chime(freq, seconds, decay=0.25, detune=0.003):
    t = t_axis(seconds)
    out = np.zeros_like(t)
    for mult, amp in ((1.0, 1.0), (2.76, 0.4), (5.4, 0.18)):
        f = freq * mult * (1 + rng.uniform(-detune, detune))
        out += amp * np.sin(2 * np.pi * f * t)
    return out * env_ad(len(t), 0.004, decay)


def mix(*layers):
    n = max(len(l) for l in layers)
    out = np.zeros(n)
    for l in layers:
        out[: len(l)] += l
    return out


def save(name, x):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f"{name}.ogg")
    sf.write(path, normalize(x).astype(np.float32), SR, format="OGG", subtype="VORBIS")
    print(f"wrote {path}")


# --------------------------------------------------------------------------
# The effects
# --------------------------------------------------------------------------

def equip():
    notes = [880, 1174, 1568]
    layers = []
    for i, f in enumerate(notes):
        c = chime(f, 0.45, decay=0.14)
        pad = np.zeros(int(SR * 0.07 * i))
        layers.append(np.concatenate([pad, c]) * 0.8)
    sparkle = svf_bandpass(rng.standard_normal(int(SR * 0.5)), 6000, q=3) * env_ad(
        int(SR * 0.5), 0.01, 0.1
    ) * 0.25
    return mix(*layers, sparkle)


def inferno_cyclone():
    n = int(SR * 1.25)
    t = np.arange(n) / SR
    sweep = 320 + 900 * np.sin(np.pi * np.minimum(t / 1.0, 1.0))  # rise then fall
    whoosh = svf_bandpass(rng.standard_normal(n), sweep, q=1.5) * env_ad(n, 0.15, 0.5)
    rumble = np.sin(2 * np.pi * 62 * t + 3 * np.sin(2 * np.pi * 9 * t)) * env_ad(n, 0.05, 0.6) * 0.7
    crackle = np.zeros(n)
    for _ in range(22):
        pos = rng.integers(int(0.1 * SR), n - 900)
        burst = rng.standard_normal(800) * env_ad(800, 0.001, 0.006)
        crackle[pos : pos + 800] += burst * rng.uniform(0.1, 0.35)
    return mix(whoosh, rumble, crackle)


def frost_wave():
    n = int(SR * 1.1)
    t = np.arange(n) / SR
    sweep = 2400 - 1400 * (t / 1.1)
    air = svf_bandpass(rng.standard_normal(n), sweep, q=2.5) * env_ad(n, 0.08, 0.45)
    chimes = mix(
        chime(1975, 0.9, decay=0.3) * 0.5,
        np.concatenate([np.zeros(int(SR * 0.12)), chime(2637, 0.8, decay=0.25) * 0.4]),
        np.concatenate([np.zeros(int(SR * 0.24)), chime(1568, 0.8, decay=0.3) * 0.35]),
    )
    tremolo = 1.0 + 0.25 * np.sin(2 * np.pi * 8 * t)
    return mix(air * tremolo, chimes)


def thunder_skyfall():
    n = int(SR * 0.95)
    t = np.arange(n) / SR
    zapf = 2600 * np.exp(-t * 4.5) + 160
    zap = svf_bandpass(rng.standard_normal(n), zapf, q=1.2) * env_ad(n, 0.005, 0.28)
    thump = np.sin(2 * np.pi * 55 * t) * env_ad(n, 0.002, 0.16) * 0.9
    fizz = svf_bandpass(rng.standard_normal(n), 5200, q=2.0) * env_ad(n, 0.002, 0.1) * 0.5
    return mix(zap, thump, fizz)


def thunder_crackle():
    n = int(SR * 0.28)
    t = np.arange(n) / SR
    hiss = svf_bandpass(rng.standard_normal(n), 4200, q=1.5) * env_ad(n, 0.002, 0.05)
    ring = np.sin(2 * np.pi * 3100 * t) * env_ad(n, 0.001, 0.04) * 0.5
    return mix(hiss, ring)


def void_slash():
    n = int(SR * 1.0)
    t = np.arange(n) / SR
    growl = np.sin(2 * np.pi * 96 * t + 5.5 * np.sin(2 * np.pi * 31 * t)) * env_ad(n, 0.2, 0.4)
    riser = svf_bandpass(rng.standard_normal(n), 240 + 1500 * t, q=2.0)
    riser *= np.minimum(1.0, t / 0.55) * np.exp(-np.maximum(0.0, t - 0.6) / 0.18)
    sub = np.sin(2 * np.pi * (70 - 25 * t) * t) * env_ad(n, 0.3, 0.35) * 0.8
    return mix(growl, riser * 0.8, sub)


def void_blink():
    n = int(SR * 0.6)
    t = np.arange(n) / SR
    gliss = np.sin(2 * np.pi * (900 * np.exp(-t * 4.0) + 180) * t) * env_ad(n, 0.004, 0.16)
    echo = np.zeros(n)
    tap = gliss[: int(SR * 0.2)] * 0.35
    for delay in (0.16, 0.3):
        pos = int(SR * delay)
        end = min(n, pos + len(tap))
        echo[pos:end] += tap[: end - pos]
    sparkle = svf_bandpass(rng.standard_normal(n), 5600, q=3.0) * env_ad(n, 0.002, 0.08) * 0.3
    return mix(gliss, echo, sparkle)


def celestial_slash():
    n = int(SR * 1.15)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for f0, amp in ((440, 0.6), (554, 0.5), (659, 0.45), (880, 0.3)):
        f = f0 * (1.0 + 0.5 * np.minimum(t / 0.9, 1.0))  # glide up a fifth
        out += amp * np.sin(2 * np.pi * np.cumsum(f) / SR)
    out *= env_ad(n, 0.06, 0.4)
    air = svf_bandpass(rng.standard_normal(n), 3600 + 2000 * t, q=2.2) * env_ad(n, 0.05, 0.35) * 0.4
    return mix(out, air)


def celestial_nova():
    n = int(SR * 1.7)
    t = np.arange(n) / SR
    boom = np.sin(2 * np.pi * 48 * np.exp(-t * 1.6) * t * 4) * env_ad(n, 0.004, 0.45)
    blast = svf_bandpass(rng.standard_normal(n), 900 * np.exp(-t * 2.5) + 120, q=1.1)
    blast *= env_ad(n, 0.003, 0.3)
    shimmer = mix(
        np.concatenate([np.zeros(int(SR * 0.25)), chime(1568, 1.3, decay=0.5) * 0.35]),
        np.concatenate([np.zeros(int(SR * 0.45)), chime(2093, 1.1, decay=0.5) * 0.3]),
        np.concatenate([np.zeros(int(SR * 0.65)), chime(2637, 1.0, decay=0.5) * 0.25]),
    )
    return mix(boom, blast, shimmer)


SOUNDS = {
    "equip": equip,
    "inferno_cyclone": inferno_cyclone,
    "frost_wave": frost_wave,
    "thunder_skyfall": thunder_skyfall,
    "thunder_crackle": thunder_crackle,
    "void_slash": void_slash,
    "void_blink": void_blink,
    "celestial_slash": celestial_slash,
    "celestial_nova": celestial_nova,
}

DEFINITIONS = {
    "msword.equip": ("equip", 0.7),
    "msword.inferno.cyclone": ("inferno_cyclone", 1.0),
    "msword.frost.wave": ("frost_wave", 1.0),
    "msword.thunder.skyfall": ("thunder_skyfall", 1.0),
    "msword.thunder.crackle": ("thunder_crackle", 0.8),
    "msword.void.slash": ("void_slash", 1.0),
    "msword.void.blink": ("void_blink", 0.9),
    "msword.celestial.slash": ("celestial_slash", 1.0),
    "msword.celestial.nova": ("celestial_nova", 1.0),
}


def main():
    for name, fn in SOUNDS.items():
        save(name, fn())

    definitions = {
        "format_version": "1.20.20",
        "sound_definitions": {
            event: {
                "category": "player",
                "sounds": [{"name": f"sounds/msword/{file}", "volume": volume}],
            }
            for event, (file, volume) in DEFINITIONS.items()
        },
    }
    path = os.path.join(RP, "sounds", "sound_definitions.json")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(definitions, handle, indent=2)
        handle.write("\n")
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
