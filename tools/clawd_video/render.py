#!/usr/bin/env python3
"""Composite a dancing Clawd, titles and cinematic polish onto the meme video.

The source clip is a 852x718 / 30fps Y2K-flavoured lyric meme.  Everything this
script adds is drawn to match that art style: chunky pixel shapes, saturated
Y2K colours, neon tubing and sparkle stars.

Pipeline
    ffmpeg (decode + 2x upscale + grade) -> python compositor -> ffmpeg (encode)

Composite order
    base frame -> bloom -> "IMRAN" background type -> contact shadow ->
    Clawd reflection -> motion-blurred Clawd -> "Claude Opus 5" neon sign ->
    sparkles / motes -> "imran cute" watermark -> light plate -> vignette

Usage
    python3 render.py INPUT.mp4 OUTPUT.mp4
"""

from __future__ import annotations

import math
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

# --------------------------------------------------------------------------
# configuration
# --------------------------------------------------------------------------

HERE = os.path.dirname(os.path.abspath(__file__))
FONT_DIR = os.path.join(HERE, "fonts")

SRC_W, SRC_H = 852, 718
SCALE = 2                       # render (and deliver) at 2x for a crisp finish
W, H = SRC_W * SCALE, SRC_H * SCALE
FPS = 30.0

BPM = 152.0                     # measured off the track's onset envelope
BEAT = 60.0 / BPM               # 0.3947 s
BEAT_PHASE = 0.325              # first downbeat, in seconds

# Clawd's 12x8 pixel grid, sampled off the supplied artwork.
BODY = (241, 92, 69)
EYE = (17, 17, 17)
GRID_W, GRID_H = 12, 8
EYES = ((3, 1), (8, 1))
LEG_SETS = ((2, 4, 7, 9), (1, 4, 7, 10), (2, 5, 6, 9), (1, 5, 6, 10))
CELL = 15                       # source px per sprite cell at choreo scale 1.0

# Y2K palette used for sparkles, streaks and neon.
PINK = (255, 122, 208)
CYAN = (128, 232, 255)
GOLD = (255, 226, 140)
LILAC = (196, 158, 255)
CORAL = BODY

# Clawd choreography: (t_start, t_end, centre_x, centre_y, scale) in source px.
# Positions snap at the clip's own scene cuts so Clawd never sits on a lyric.
CHOREO = [
    (0.00, 5.17, 704, 596, 1.00),
    (5.17, 9.10, 148, 604, 0.90),
    (9.10, 13.50, 706, 588, 0.95),
    (13.50, 17.20, 690, 566, 1.08),
    (17.20, 21.07, 158, 588, 1.00),
    (21.07, 23.37, 694, 578, 1.05),
    (23.37, 27.13, 152, 596, 1.15),
    (27.13, 30.90, 700, 592, 1.00),
    (30.90, 33.40, 152, 586, 1.05),
    (33.40, 99.00, 426, 588, 1.28),
]

# "Claude Opus 5" neon sign: (t_in, t_out, cx, cy, tube_width, framed).
# A small always-on tube in the top-left reads as a channel bug; the outro
# gets the full framed sign as the closing title.
NEON_SHOTS = [
    (0.80, 33.40, 158, 44, 210, False),
    (33.45, 99.00, 426, 108, 560, True),
]


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(os.path.join(FONT_DIR, name), size)


# --------------------------------------------------------------------------
# small compositing helpers
# --------------------------------------------------------------------------

def add_rgb(dst: Image.Image, src: Image.Image, x: int, y: int) -> None:
    """Additively blend an RGB patch onto an RGB canvas, clipped to bounds."""
    x0, y0 = max(0, x), max(0, y)
    x1 = min(dst.width, x + src.width)
    y1 = min(dst.height, y + src.height)
    if x1 <= x0 or y1 <= y0:
        return
    patch = src.crop((x0 - x, y0 - y, x1 - x, y1 - y))
    box = (x0, y0, x1, y1)
    dst.paste(ImageChops.add(dst.crop(box), patch), box)


def over_rgba(dst: Image.Image, src: Image.Image, x: int, y: int) -> None:
    """Alpha-over an RGBA patch onto a canvas (RGB or RGBA), clipped."""
    rgb = Image.merge("RGB", src.split()[:3])
    dst.paste(rgb, (x, y), src.getchannel("A"))


def blur_scaled(mask: Image.Image, radius: float, div: int = 4) -> Image.Image:
    """Gaussian blur done at reduced resolution -- much cheaper, same look."""
    w, h = max(1, mask.width // div), max(1, mask.height // div)
    small = mask.resize((w, h), Image.BILINEAR)
    small = small.filter(ImageFilter.GaussianBlur(max(0.5, radius / div)))
    return small.resize(mask.size, Image.BILINEAR)


def glow_stack(mask: Image.Image, colours, radii, gains, div: int = 4):
    """Additive RGB glow built from a luminance mask at several radii."""
    out = Image.new("RGB", mask.size, (0, 0, 0))
    for col, rad, gain in zip(colours, radii, gains):
        m = blur_scaled(mask, rad, div)
        m = m.point(lambda v, g=gain: min(255, int(v * g)))
        tint = Image.new("RGB", mask.size, col)
        out = ImageChops.add(
            out, ImageChops.multiply(tint, Image.merge("RGB", (m, m, m))))
    return out


# --------------------------------------------------------------------------
# Clawd sprite
# --------------------------------------------------------------------------

def clawd_grid(arm_pose: int, leg_pose: int) -> np.ndarray:
    """An (8, 12, 4) RGBA pixel grid for one dance pose."""
    g = np.zeros((GRID_H, GRID_W, 4), np.uint8)

    def put(x, y, col):
        if 0 <= y < GRID_H and 0 <= x < GRID_W:
            g[y, x] = (*col, 255)

    for y in range(0, 6):                       # torso
        for x in range(2, 10):
            put(x, y, BODY)

    # arms: 0 = as drawn, 1 = left up / right down, 2 = mirrored
    left_rows, right_rows = {0: ((2, 3), (2, 3)),
                             1: ((1, 2), (3, 4)),
                             2: ((3, 4), (1, 2))}[arm_pose]
    for r in left_rows:
        put(0, r, BODY)
        put(1, r, BODY)
    for r in right_rows:
        put(10, r, BODY)
        put(11, r, BODY)

    for x in LEG_SETS[leg_pose]:                # legs
        put(x, 6, BODY)
        put(x, 7, BODY)

    for x, y in EYES:
        put(x, y, EYE)
    return g


_POSE_CACHE: dict[tuple, Image.Image] = {}


def clawd_pose(arm_pose: int, leg_pose: int, cell_px: int) -> Image.Image:
    key = (arm_pose, leg_pose, cell_px)
    if key not in _POSE_CACHE:
        base = Image.fromarray(clawd_grid(arm_pose, leg_pose), "RGBA")
        _POSE_CACHE[key] = base.resize(
            (GRID_W * cell_px, GRID_H * cell_px), Image.NEAREST)
    return _POSE_CACHE[key]


def clawd_at(t: float, cell_px: int):
    """Return (sprite, dx, dy, hop) for time t -- a beat-locked dance."""
    b = (t - BEAT_PHASE) / BEAT                 # position in beats
    ph = b - math.floor(b)                      # 0..1 inside the beat
    bar = int(math.floor(b))

    arm_pose = 1 if bar % 2 == 0 else 2
    leg_pose = bar % 4

    hop = -abs(math.sin(math.pi * ph)) ** 0.7   # bouncy up-swing
    sway = math.sin(math.pi * b)                # side to side over two beats
    tilt = 13.0 * sway
    squash = 1.0 + 0.13 * math.cos(2 * math.pi * ph)

    img = clawd_pose(arm_pose, leg_pose, cell_px)
    sw, sh = img.size
    img = img.resize((max(1, int(sw / squash)), max(1, int(sh * squash))),
                     Image.NEAREST)
    img = img.rotate(tilt, resample=Image.NEAREST, expand=True)
    return img, sway * 0.16 * sw, hop * 0.30 * sh, hop


def choreo(t: float):
    for t0, t1, x, y, s in CHOREO:
        if t0 <= t < t1:
            return x * SCALE, y * SCALE, s
    x, y, s = CHOREO[-1][2:]
    return x * SCALE, y * SCALE, s


# --------------------------------------------------------------------------
# cached art
# --------------------------------------------------------------------------

def make_imran_type() -> Image.Image:
    """Big pixel 'IMRAN' for the background.

    Light fill inside a dark chunky outline, so the same plate stays legible
    over the clip's white pastel outro and its dark night sky alike.
    """
    target_w = int(620 * SCALE)
    size = 20
    f = font("PressStart2P.ttf", size)
    while f.getbbox("IMRAN")[2] < target_w:
        size += 4
        f = font("PressStart2P.ttf", size)

    bb = f.getbbox("IMRAN")
    stroke = max(2, size // 11)
    pad = size // 2 + stroke
    w, h = bb[2] - bb[0] + pad * 2, bb[3] - bb[1] + pad * 2

    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(im).text(
        (pad - bb[0], pad - bb[1]), "IMRAN", font=f,
        fill=(255, 255, 255, 255), stroke_width=stroke,
        stroke_fill=(38, 22, 52, 255))
    return im


def make_neon(text: str, tube_w: int, framed: bool):
    """Return (core RGBA, glow RGB) for a neon-tube sign."""
    size = 18
    f = font("Audiowide.ttf", size)
    while f.getbbox(text)[2] < tube_w:
        size += 2
        f = font("Audiowide.ttf", size)

    bb = f.getbbox(text)
    pad = int(size * (1.5 if framed else 0.9))
    w = bb[2] - bb[0] + pad * 2
    h = bb[3] - bb[1] + pad * 2
    tx, ty = pad - bb[0], pad - bb[1]

    tube = Image.new("L", (w, h), 0)
    dt = ImageDraw.Draw(tube)
    dt.text((tx, ty), text, font=f, fill=255,
            stroke_width=max(1, size // 24), stroke_fill=255)

    if framed:
        r = int(size * 0.5)
        box = [pad // 2, pad // 3, w - pad // 2, h - pad // 3]
        dt.rounded_rectangle(box, radius=r, outline=255,
                             width=max(2, size // 20))
        midy = (box[1] + box[3]) // 2          # mounting stems, like a real sign
        stem = max(2, size // 24)
        dt.line([box[0] - pad // 3, midy, box[0], midy], fill=255, width=stem)
        dt.line([box[2], midy, box[2] + pad // 3, midy], fill=255, width=stem)

    # a hot white filament inside a magenta tube reads as neon at any size
    inner = Image.new("L", (w, h), 0)
    ImageDraw.Draw(inner).text((tx, ty), text, font=f, fill=255)
    hot = Image.new("RGB", (w, h), (255, 118, 214))
    hot.paste((255, 248, 255), (0, 0), inner.filter(
        ImageFilter.GaussianBlur(max(0.6, size / 90))))
    core = Image.merge("RGBA", (*hot.split(), tube))

    glow = glow_stack(tube,
                      [(255, 110, 220), (110, 224, 255), (255, 200, 255)],
                      [size * 0.45, size * 0.16, size * 0.05],
                      [0.85, 0.62, 0.42], div=2)
    return core, glow


def make_watermark():
    size = int(31 * SCALE)
    f = font("Caveat.ttf", size)
    txt = "imran cute"
    bb = f.getbbox(txt)
    pad = size // 2
    w, h = bb[2] - bb[0] + pad * 2, bb[3] - bb[1] + pad * 2
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.text((pad - bb[0], pad - bb[1]), txt, font=f, fill=(255, 255, 255, 232),
           stroke_width=max(1, size // 24), stroke_fill=(28, 14, 38, 150))
    shade = im.filter(ImageFilter.GaussianBlur(size * 0.14))
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.alpha_composite(shade)
    out.alpha_composite(im)
    return out


def make_star(size: int, colour) -> Image.Image:
    """A Y2K four-point sparkle."""
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = size / 2.0
    thin = max(1.0, size * 0.058)
    for ang in (0.0, math.pi / 2):
        for sign in (1, -1):
            ex, ey = c + math.cos(ang) * c * sign, c + math.sin(ang) * c * sign
            d.polygon([(c - math.sin(ang) * thin, c + math.cos(ang) * thin),
                       (c + math.sin(ang) * thin, c - math.cos(ang) * thin),
                       (ex, ey)], fill=(*colour, 255))
    d.ellipse([c - thin * 1.5, c - thin * 1.5, c + thin * 1.5, c + thin * 1.5],
              fill=(255, 255, 255, 255))
    return im


def make_streaks() -> Image.Image:
    """A wide soft diagonal light-streak plate that slides across frame."""
    w, h = W * 2, H
    im = Image.new("RGB", (w, h), (0, 0, 0))
    d = ImageDraw.Draw(im)
    rng = np.random.default_rng(7)
    for _ in range(10):
        x = int(rng.integers(0, w))
        length = int(rng.integers(int(H * 0.5), int(H * 1.25)))
        thick = int(rng.integers(3, 10)) * SCALE
        col = [CYAN, PINK, GOLD, LILAC][int(rng.integers(0, 4))]
        gain = float(rng.uniform(0.07, 0.17))
        y0 = int(rng.integers(-int(H * 0.25), int(H * 0.8)))
        d.line([x, y0, x + int(length * 0.45), y0 + length], width=thick,
               fill=tuple(int(c * gain) for c in col))
    return im.filter(ImageFilter.GaussianBlur(8 * SCALE))


def make_vignette() -> Image.Image:
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    nx = (xx - W / 2) / (W / 2)
    ny = (yy - H / 2) / (H / 2)
    r = np.sqrt(nx * nx + ny * ny) / math.sqrt(2.0)
    v = 1.0 - 0.60 * np.clip(r - 0.52, 0, None) ** 1.4
    m = (np.clip(v, 0.80, 1.0) * 255).astype(np.uint8)
    band = Image.fromarray(m, "L")
    return Image.merge("RGB", (band, band, band))


# --------------------------------------------------------------------------
# particles
# --------------------------------------------------------------------------

class Sparkles:
    """Twinkling stars plus slow drifting pixel motes -- seeded, repeatable."""

    PALETTE = [(255, 255, 255), CYAN, PINK, GOLD, LILAC, CORAL]

    def __init__(self, n_stars=24, n_motes=48):
        rng = np.random.default_rng(1234)
        self.stars = [dict(
            x=float(rng.uniform(0, W)), y=float(rng.uniform(0, H)),
            size=int(rng.uniform(15, 44) * SCALE),
            col=self.PALETTE[int(rng.integers(0, len(self.PALETTE)))],
            rate=float(rng.uniform(0.55, 1.8)),
            phase=float(rng.uniform(0, 1)),
            drift=float(rng.uniform(-9, 9)) * SCALE) for _ in range(n_stars)]
        self.motes = [dict(
            x=float(rng.uniform(0, W)), y=float(rng.uniform(0, H)),
            size=int(rng.uniform(3, 8)) * SCALE,
            col=self.PALETTE[int(rng.integers(0, len(self.PALETTE)))],
            vy=float(rng.uniform(-26, -8)) * SCALE,
            vx=float(rng.uniform(-7, 7)) * SCALE,
            wob=float(rng.uniform(0, 6.28)),
            alpha=float(rng.uniform(0.25, 0.65))) for _ in range(n_motes)]
        self._cache: dict[tuple, Image.Image] = {}

    def _star(self, size, col):
        key = (size, col)
        if key not in self._cache:
            self._cache[key] = make_star(size, col)
        return self._cache[key]

    def draw(self, add: Image.Image, over: Image.Image, t: float, hit: float):
        for s in self.stars:
            u = (t * s["rate"] + s["phase"]) % 1.0
            k = math.sin(math.pi * u) ** 3 * (0.55 + 0.45 * hit)
            if k < 0.04:
                continue
            sz = max(6, int(s["size"] * (0.55 + 0.75 * k)))
            img = self._star(sz, s["col"])
            a = img.getchannel("A").point(lambda v, k=k: int(v * k))
            x = int((s["x"] + s["drift"] * t) % (W + 240)) - 120 - sz // 2
            y = int(s["y"]) - sz // 2
            rgb = Image.merge("RGB", img.split()[:3])
            prem = ImageChops.multiply(rgb, Image.merge("RGB", (a, a, a)))
            add_rgb(add, prem, x, y)
            over.paste(rgb, (x, y), a.point(lambda v: int(v * 0.55)))

        d = ImageDraw.Draw(over)
        for m in self.motes:
            y = (m["y"] + m["vy"] * t) % (H + 80) - 40
            x = (m["x"] + m["vx"] * t
                 + math.sin(t * 1.7 + m["wob"]) * 14 * SCALE) % W
            a = int(255 * m["alpha"]
                    * (0.6 + 0.4 * math.sin(t * 3 + m["wob"])))
            if a <= 6:
                continue
            sz = m["size"]
            d.rectangle([int(x), int(y), int(x) + sz, int(y) + sz],
                        fill=(*m["col"], a))


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def bloom(img: Image.Image, gain=0.15, thresh=216, radius=11) -> Image.Image:
    small = img.resize((W // 4, H // 4), Image.BILINEAR)
    hi = small.point(lambda v: 0 if v < thresh else min(
        255, int((v - thresh) * (255.0 / (255 - thresh)))))
    hi = hi.filter(ImageFilter.GaussianBlur(radius))
    hi = hi.point(lambda v: int(v * gain))
    return hi.resize((W, H), Image.BILINEAR)


def main():
    src, dst = sys.argv[1], sys.argv[2]
    # optional preview window: render.py IN OUT [duration] [start]
    dur = float(sys.argv[3]) if len(sys.argv) > 3 else None
    start = float(sys.argv[4]) if len(sys.argv) > 4 else 0.0

    grade = (f"scale={W}:{H}:flags=lanczos,"
             "eq=saturation=1.16:contrast=1.07:brightness=0.006:gamma=1.02,"
             "unsharp=5:5:0.32:5:5:0.0")

    seek = ["-ss", f"{start:g}"] if start else []
    dec = subprocess.Popen(
        ["ffmpeg", "-v", "error", *seek, "-i", src, "-vf", grade,
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        stdout=subprocess.PIPE, bufsize=10 ** 8)

    enc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
         "-r", f"{FPS:g}", "-i", "-",
         "-i", src,
         "-map", "0:v", "-map", "1:a?",
         "-c:v", "libx264", "-preset", "slow", "-crf", "16",
         "-pix_fmt", "yuv420p", "-movflags", "+faststart",
         "-c:a", "aac", "-b:a", "192k", "-shortest", dst],
        stdin=subprocess.PIPE)

    imran = make_imran_type()
    neon = [make_neon("CLAUDE OPUS 5", int(s[4] * SCALE), s[5])
            for s in NEON_SHOTS]
    watermark = make_watermark()
    streaks = make_streaks()
    vignette = make_vignette()
    sparkles = Sparkles()

    ix = W // 2 - imran.width // 2
    iy = int(H * 0.40) - imran.height // 2

    gw = imran.width                            # sweeping shimmer gradient
    ramp = np.linspace(0, 1, gw * 2, dtype=np.float32)
    shimmer = (np.clip(1.0 - np.abs(ramp - 0.5) * 5.0, 0, 1) * 68 + 187
               ).astype(np.uint8)

    nbytes = W * H * 3
    n = 0

    while True:
        buf = dec.stdout.read(nbytes)
        if len(buf) < nbytes:
            break
        t = start + n / FPS
        if dur is not None and t - start > dur:
            break
        img = Image.frombuffer("RGB", (W, H), buf, "raw", "RGB", 0, 1).copy()

        b = (t - BEAT_PHASE) / BEAT
        hit = max(0.0, 1.0 - (b - math.floor(b)) * 2.2)

        # --- bloom -------------------------------------------------------
        img = ImageChops.add(img, bloom(img))

        # --- "IMRAN" background type -------------------------------------
        plate = imran.copy()
        off = int((t * 0.16) % 1.0 * gw)
        band = Image.fromarray(
            np.tile(shimmer[off:off + gw], (plate.height, 1)), "L")
        alpha = ImageChops.multiply(plate.getchannel("A"), band)
        plate.putalpha(alpha.point(lambda v: int(v * 0.30)))
        over_rgba(img, plate, ix + int(math.sin(t * 0.45) * 5 * SCALE), iy)

        # --- Clawd -------------------------------------------------------
        cx, cy, cs = choreo(t)
        cell = max(2, int(CELL * cs * SCALE))
        sprite, dx, dy, hop = clawd_at(t, cell)

        acc = None                              # 3-sample shutter motion blur
        for k in (-1, 0, 1):
            spr, sdx, sdy, _ = clawd_at(t + k * 0.34 / FPS, cell)
            lay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            lay.alpha_composite(spr, (int(cx + sdx - spr.width / 2),
                                      int(cy + sdy - spr.height / 2)))
            arr = np.asarray(lay, dtype=np.float32)
            acc = arr if acc is None else acc + arr
        clawd = Image.fromarray((acc / 3.0).astype(np.uint8), "RGBA")
        clawd.alpha_composite(sprite, (int(cx + dx - sprite.width / 2),
                                       int(cy + dy - sprite.height / 2)))

        # contact shadow, tied to hop height
        sh_w = int(sprite.width * (0.78 + 0.22 * (1 + hop)))
        sh_h = max(6, int(sprite.height * 0.15 * (1 + hop * 0.55)))
        sh_y = int(cy + sprite.height * 0.44)
        shadow = Image.new("L", (W, H), 255)
        ImageDraw.Draw(shadow).ellipse(
            [cx - sh_w // 2 + dx * 0.6, sh_y - sh_h // 2,
             cx + sh_w // 2 + dx * 0.6, sh_y + sh_h // 2],
            fill=int(148 + 72 * -hop))
        shadow = blur_scaled(shadow, 7 * SCALE)
        img = ImageChops.multiply(img, Image.merge("RGB", (shadow,) * 3))

        # soft reflection under the feet
        top = max(0, sh_y - sprite.height)
        if sh_y - top > 16 and sh_y < H:
            refl = clawd.crop((0, top, W, sh_y)).transpose(
                Image.FLIP_TOP_BOTTOM)
            refl = refl.filter(ImageFilter.GaussianBlur(2.5 * SCALE))
            ra = np.asarray(refl.getchannel("A"), dtype=np.float32)
            fade = np.linspace(0.32, 0.0, ra.shape[0], dtype=np.float32)[:, None]
            refl.putalpha(Image.fromarray((ra * fade).astype(np.uint8), "L"))
            over_rgba(img, refl, 0, sh_y)

        # cast shadow just behind the body, so Clawd reads off busy frames
        ca = clawd.getchannel("A")
        cast = blur_scaled(ca, 5 * SCALE, div=2).point(lambda v: int(v * 0.42))
        over_rgba(img, Image.merge("RGBA", (*Image.new(
            "RGB", (W, H), (26, 12, 32)).split(), cast)), 5 * SCALE, 7 * SCALE)

        over_rgba(img, clawd, 0, 0)

        # --- additive light plate ----------------------------------------
        add = Image.new("RGB", (W, H), (0, 0, 0))
        sx = int((-t * 26 * SCALE) % W)
        add.paste(streaks.crop((sx, 0, sx + W, H)), (0, 0))
        add = ImageChops.add(add, glow_stack(
            ca, [CORAL, (255, 196, 158)],
            [12 * SCALE, 4 * SCALE], [0.26 + 0.16 * hit, 0.14]))

        # --- "Claude Opus 5" neon sign ------------------------------------
        for i, (t0, t1, nx, ny, _tw, _fr) in enumerate(NEON_SHOTS):
            if not (t0 <= t < t1):
                continue
            core, glow = neon[i]
            fade = min(1.0, (t - t0) / 0.55) * min(1.0, (t1 - t) / 0.45)
            warm = (t - t0) / 0.9               # tube flickers as it warms up
            flick = 0.0 if (warm < 0.7 and int((t - t0) * 26) % 3 == 0) else 1.0
            pulse = 0.86 + 0.14 * math.sin(t * 2.1) + 0.10 * hit
            k = max(0.0, fade) * flick * pulse
            if k <= 0.02:
                continue
            px = int(nx * SCALE - core.width / 2)
            py = int(ny * SCALE - core.height / 2)
            add_rgb(add, glow.point(lambda v, k=k: int(v * min(1.0, k))),
                    px, py)
            lit = core.copy()
            lit.putalpha(lit.getchannel("A").point(
                lambda v, k=k: int(v * min(1.0, k * 0.95))))
            over_rgba(img, lit, px, py)

        # --- sparkles / motes ---------------------------------------------
        over = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        sparkles.draw(add, over, t, hit)
        over_rgba(img, over, 0, 0)

        # --- watermark -----------------------------------------------------
        over_rgba(img, watermark, W - watermark.width - 10 * SCALE,
                  H - watermark.height - 4 * SCALE)

        # --- light plate + vignette ----------------------------------------
        # Clawd sits in front of the light, so hold the additive plate out of
        # its silhouette -- otherwise the glow bleaches the coral flat.
        occl = ca.point(lambda v: 255 - int(v * 0.88))
        add = ImageChops.multiply(add, Image.merge("RGB", (occl,) * 3))
        img = ImageChops.multiply(ImageChops.add(img, add), vignette)

        enc.stdin.write(img.tobytes())
        n += 1
        if n % 90 == 0:
            print(f"  {n:5d} frames  ({t:5.1f}s)", flush=True)

    enc.stdin.close()
    enc.wait()
    dec.terminate()
    print(f"done: {n} frames -> {dst}")


if __name__ == "__main__":
    main()
