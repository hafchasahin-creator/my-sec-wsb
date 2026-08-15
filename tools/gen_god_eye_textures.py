#!/usr/bin/env python3
"""Generate every texture used by the God Eye Guardian add-on.

Pure standard library - RGBA PNGs are written by hand so the packs can be
rebuilt on any machine without image tooling installed. Everything is drawn
from a fixed seed, so re-running this produces byte-identical files.

Outputs
  resource_packs/god_eye_rp/textures/entity/god_eye.png        64x64  model skin
  resource_packs/god_eye_rp/textures/particle/god_eye.png      32x32  4 sprites
  resource_packs/god_eye_rp/textures/items/god_eye_spawn_egg.png 16x16
  resource_packs/god_eye_rp/pack_icon.png                     128x128
  behavior_packs/god_eye_bp/pack_icon.png                     128x128

Usage:  python3 tools/gen_god_eye_textures.py
"""

import math
import os
import random
import struct
import sys
import zlib

RP = os.path.join("resource_packs", "god_eye_rp")
BP = os.path.join("behavior_packs", "god_eye_bp")

CLEAR = (0, 0, 0, 0)


# --------------------------------------------------------------------------
# PNG output
# --------------------------------------------------------------------------

def new_image(width, height, fill=CLEAR):
    return [[fill for _ in range(width)] for _ in range(height)]


def write_png(path, img):
    """img: list of rows, each row a list of (r, g, b, a) tuples."""
    height = len(img)
    width = len(img[0])
    raw = b"".join(
        b"\x00" + bytes(channel for px in row for channel in px) for row in img
    )

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    blob = b"\x89PNG\r\n\x1a\n"
    blob += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    blob += chunk(b"IDAT", zlib.compress(raw, 9))
    blob += chunk(b"IEND", b"")

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(blob)
    return path


# --------------------------------------------------------------------------
# Tiny drawing helpers - all coordinates are absolute pixels in the image
# --------------------------------------------------------------------------

def put(img, x, y, colour):
    if 0 <= y < len(img) and 0 <= x < len(img[0]):
        img[y][x] = colour


def blend(img, x, y, colour):
    """Alpha-composite `colour` over whatever is already at (x, y)."""
    if not (0 <= y < len(img) and 0 <= x < len(img[0])):
        return
    sr, sg, sb, sa = colour
    if sa <= 0:
        return
    dr, dg, db, da = img[y][x]
    a = sa / 255.0
    img[y][x] = (
        int(sr * a + dr * (1 - a)),
        int(sg * a + dg * (1 - a)),
        int(sb * a + db * (1 - a)),
        max(da, sa) if da else sa,
    )


def mix(a, b, t):
    """Linear blend between two RGB(A) tuples."""
    t = max(0.0, min(1.0, t))
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))


def shade(colour, factor):
    r, g, b = colour[:3]
    a = colour[3] if len(colour) > 3 else 255
    return (
        max(0, min(255, int(r * factor))),
        max(0, min(255, int(g * factor))),
        max(0, min(255, int(b * factor))),
        a,
    )


def fill_rect(img, x0, y0, w, h, colour):
    for y in range(y0, y0 + h):
        for x in range(x0, x0 + w):
            put(img, x, y, colour)


def disc(img, cx, cy, radius, colour_fn, region=None):
    """Paint a filled circle. colour_fn(dist_ratio, angle) -> RGBA or None."""
    x0, y0, w, h = region if region else (0, 0, len(img[0]), len(img))
    for y in range(y0, y0 + h):
        for x in range(x0, x0 + w):
            dx = x + 0.5 - cx
            dy = y + 0.5 - cy
            dist = math.hypot(dx, dy)
            if dist > radius:
                continue
            colour = colour_fn(dist / radius, math.atan2(dy, dx))
            if colour is not None:
                put(img, x, y, colour)


# --------------------------------------------------------------------------
# Palette
# --------------------------------------------------------------------------

SCLERA_LIGHT = (203, 194, 184)
SCLERA_MID = (166, 157, 150)
SCLERA_DARK = (110, 103, 102)
SCLERA_DEEP = (48, 43, 46)
VEIN_HOT = (176, 42, 44)
VEIN_COLD = (112, 26, 34)

IRIS_RIM = (44, 10, 74)
IRIS_MID = (128, 34, 118)
IRIS_HOT = (236, 122, 46)
IRIS_CORE = (255, 224, 142)

PUPIL_BLACK = (7, 4, 11)
PUPIL_EMBER = (128, 22, 30)

AURA_INK = (12, 5, 22)
AURA_VIOLET = (52, 18, 82)

GLOW_GOLD = (255, 226, 156)
GLOW_VIOLET = (196, 126, 255)

# entity_emissive_alpha treats alpha 0 as "cut this pixel away" and any alpha
# below 255 as "render me full bright". 110 is comfortably inside that band and
# still degrades to a decent translucent glow if a device falls back to plain
# alpha blending.
EMISSIVE = 110


# --------------------------------------------------------------------------
# 64x64 entity skin
#
# region layout (x, y, w, h):
#   SCLERA  (  0,  0, 16, 16)  lit eyeball surface           -> most faces
#   SHADE   ( 16,  0, 16, 16)  shadowed eyeball surface      -> up / down faces
#   IRIS    ( 32,  0, 16, 16)  iris disc, cut out around it
#   PUPIL   ( 48,  0, 16, 16)  pupil disc, cut out around it
#   VEIN    (  0, 16, 16, 16)  heavily veined surface        -> side bands
#   RIM     ( 16, 16, 16, 16)  darkest surface               -> rear faces
#   spare   ( 32, 16, 32, 16)
#   AURA    (  0, 32, 32, 32)  soft dark aura plane
#   HALO    ( 32, 32, 32, 32)  emissive halo ring
# --------------------------------------------------------------------------

def draw_sclera(img, x0, y0, base, veins, seed):
    rng = random.Random(seed)
    size = 16
    for y in range(size):
        for x in range(size):
            # A soft vignette so cube faces read as a curved surface.
            dx = (x - 7.5) / 8.0
            dy = (y - 7.5) / 8.0
            edge = min(1.0, math.hypot(dx, dy) / 1.25)
            colour = mix(base, SCLERA_DEEP, edge * 0.68)
            colour = shade(colour, 0.94 + rng.random() * 0.12)
            put(img, x0 + x, y0 + y, (colour[0], colour[1], colour[2], 255))

    # Veins: short random walks that fork, drawn dark then highlighted.
    for _ in range(veins):
        x = rng.uniform(1, 14)
        y = rng.uniform(1, 14)
        angle = rng.uniform(0, math.tau)
        hot = rng.random() < 0.45
        for _step in range(rng.randint(5, 11)):
            angle += rng.uniform(-0.8, 0.8)
            x += math.cos(angle)
            y += math.sin(angle)
            if not (0 <= x < size and 0 <= y < size):
                break
            colour = VEIN_HOT if hot else VEIN_COLD
            blend(img, x0 + int(x), y0 + int(y), (*colour, 190))


def draw_iris(img, x0, y0):
    def colour_fn(t, angle):
        # Fibrous radial banding, brightest at the centre.
        fibre = 0.5 + 0.5 * math.sin(angle * 11.0 + t * 5.0)
        if t > 0.86:
            return (*shade(IRIS_RIM, 0.55)[:3], 255)
        if t > 0.62:
            return (*mix(IRIS_MID, IRIS_RIM, (t - 0.62) / 0.24 + fibre * 0.18)[:3], 255)
        if t > 0.34:
            return (*mix(IRIS_HOT, IRIS_MID, (t - 0.34) / 0.28 + fibre * 0.22)[:3], 255)
        return (*mix(IRIS_CORE, IRIS_HOT, t / 0.34 + fibre * 0.15)[:3], 255)

    disc(img, x0 + 8, y0 + 8, 8.0, colour_fn, region=(x0, y0, 16, 16))


def draw_pupil(img, x0, y0):
    def colour_fn(t, angle):
        # Flat black for most of the disc; a dim ember only just inside the rim,
        # so at model scale it reads as a pupil rather than as a second iris.
        ember = max(0.0, 1.0 - abs(t - 0.86) * 7.0)
        colour = mix(PUPIL_BLACK, PUPIL_EMBER, ember * 0.4)
        if t < 0.16:
            colour = mix(colour, GLOW_GOLD, (0.16 - t) * 3.0)
        return (*colour[:3], 255)

    disc(img, x0 + 8, y0 + 8, 8.0, colour_fn, region=(x0, y0, 16, 16))


AURA_HOLE = 0.44


def draw_aura(img, x0, y0, size=32):
    """Ragged ink annulus used by the three crossed aura planes.

    It is a ring rather than a disc on purpose: the planes pass straight
    through the middle of the model, so a filled centre would blend over the
    eyeball itself and turn it muddy. Leaving a hole means the shroud only ever
    surrounds the eye.
    """
    rng = random.Random(0xA17A)
    cx = cy = size / 2.0
    for y in range(size):
        for x in range(size):
            dist = math.hypot(x + 0.5 - cx, y + 0.5 - cy) / (size / 2.0)
            if dist > 1.0 or dist < AURA_HOLE:
                continue
            band = (dist - AURA_HOLE) / (1.0 - AURA_HOLE)
            falloff = math.sin(band * math.pi) ** 0.75
            wisp = 0.72 + 0.28 * math.sin(
                math.atan2(y - cy, x - cx) * 5.0 + dist * 4.0
            )
            alpha = falloff * wisp * 235 * (0.85 + rng.random() * 0.3)
            if alpha < 6:
                continue
            colour = mix(AURA_VIOLET, AURA_INK, min(1.0, band * 1.5))
            put(img, x0 + x, y0 + y, (colour[0], colour[1], colour[2], min(180, int(alpha))))


def draw_halo(img, x0, y0, size=32):
    """Emissive ring. Anything outside the ring is cut away with alpha 0."""
    cx = cy = size / 2.0
    for y in range(size):
        for x in range(size):
            dist = math.hypot(x + 0.5 - cx, y + 0.5 - cy) / (size / 2.0)
            band = 1.0 - abs(dist - 0.74) / 0.26
            if band <= 0.04 or dist > 1.0:
                continue
            colour = mix(GLOW_VIOLET, GLOW_GOLD, band)
            put(img, x0 + x, y0 + y, (colour[0], colour[1], colour[2], EMISSIVE))


def build_entity_texture():
    img = new_image(64, 64)
    draw_sclera(img, 0, 0, SCLERA_LIGHT, veins=7, seed=11)
    draw_sclera(img, 16, 0, SCLERA_MID, veins=5, seed=23)
    draw_iris(img, 32, 0)
    draw_pupil(img, 48, 0)
    draw_sclera(img, 0, 16, SCLERA_MID, veins=14, seed=37)
    draw_sclera(img, 16, 16, SCLERA_DARK, veins=9, seed=53)
    draw_aura(img, 0, 32)
    draw_halo(img, 32, 32)
    return write_png(os.path.join(RP, "textures", "entity", "god_eye.png"), img)


# --------------------------------------------------------------------------
# 32x32 particle atlas - four 16x16 sprites
#   (0,  0) dark mote      (16,  0) bright spark
#   (0, 16) spectral eye   (16, 16) void wisp
# --------------------------------------------------------------------------

def sprite_mote(img, x0, y0):
    def colour_fn(t, _angle):
        alpha = int((1.0 - t) ** 1.8 * 225)
        if alpha < 5:
            return None
        return (*mix(AURA_VIOLET, AURA_INK, t)[:3], alpha)

    disc(img, x0 + 8, y0 + 8, 7.5, colour_fn, region=(x0, y0, 16, 16))


def sprite_spark(img, x0, y0):
    def colour_fn(t, _angle):
        alpha = int((1.0 - t) ** 1.4 * 255)
        if alpha < 5:
            return None
        colour = mix(GLOW_GOLD, IRIS_MID, t)
        return (*colour[:3], alpha)

    disc(img, x0 + 8, y0 + 8, 7.5, colour_fn, region=(x0, y0, 16, 16))
    # A cross flare so beams read as light rather than as dots.
    for i in range(16):
        a = int(255 * (1.0 - abs(i - 7.5) / 8.0) ** 2)
        blend(img, x0 + i, y0 + 7, (*GLOW_GOLD, a))
        blend(img, x0 + i, y0 + 8, (*GLOW_GOLD, a))
        blend(img, x0 + 7, y0 + i, (*GLOW_GOLD, a))
        blend(img, x0 + 8, y0 + i, (*GLOW_GOLD, a))


def sprite_eye(img, x0, y0):
    """A tiny almond eye glyph for the swarm and the erase effect."""
    for y in range(16):
        for x in range(16):
            dx = (x - 7.5) / 7.5
            dy = (y - 7.5) / 4.0
            d = math.hypot(dx, dy)
            if d > 1.0:
                continue
            if d > 0.82:
                put(img, x0 + x, y0 + y, (*IRIS_RIM, 235))
            else:
                put(img, x0 + x, y0 + y, (*mix(SCLERA_LIGHT, SCLERA_DARK, d), 245))
    for y in range(16):
        for x in range(16):
            if math.hypot(x - 7.5, y - 7.5) <= 2.6:
                put(img, x0 + x, y0 + y, (*PUPIL_BLACK, 255))
            elif math.hypot(x - 7.5, y - 7.5) <= 3.6:
                put(img, x0 + x, y0 + y, (*IRIS_HOT, 255))


def sprite_wisp(img, x0, y0):
    rng = random.Random(0x1DEA)
    for y in range(16):
        for x in range(16):
            dx = (x - 7.5) / 5.0
            dy = (y - 7.5) / 7.5
            d = math.hypot(dx, dy)
            if d > 1.0:
                continue
            alpha = int((1.0 - d) ** 1.5 * 240 * (0.75 + rng.random() * 0.5))
            if alpha < 6:
                continue
            put(img, x0 + x, y0 + y, (*mix(GLOW_VIOLET, IRIS_RIM, d)[:3], min(240, alpha)))


def build_particle_texture():
    img = new_image(32, 32)
    sprite_mote(img, 0, 0)
    sprite_spark(img, 16, 0)
    sprite_eye(img, 0, 16)
    sprite_wisp(img, 16, 16)
    return write_png(os.path.join(RP, "textures", "particle", "god_eye.png"), img)


# --------------------------------------------------------------------------
# 16x16 spawn egg
# --------------------------------------------------------------------------

EGG_MASK = [
    "......####......",
    "....########....",
    "...##########...",
    "..############..",
    ".##############.",
    ".##############.",
    "################",
    "################",
    "################",
    "################",
    ".##############.",
    ".##############.",
    "..############..",
    "...##########...",
    "....########....",
    "......####......",
]


def build_spawn_egg():
    img = new_image(16, 16)
    rng = random.Random(0x9E)
    for y, row in enumerate(EGG_MASK):
        for x, cell in enumerate(row):
            if cell != "#":
                continue
            edge = min(1.0, math.hypot((x - 7.5) / 8.0, (y - 7.5) / 8.5))
            colour = mix((26, 14, 40), (8, 4, 14), edge)
            colour = shade(colour, 0.9 + rng.random() * 0.25)
            put(img, x, y, (colour[0], colour[1], colour[2], 255))

    # Speckles, then the eye itself staring out of the shell.
    for _ in range(14):
        x = rng.randrange(2, 14)
        y = rng.randrange(1, 15)
        if EGG_MASK[y][x] == "#":
            blend(img, x, y, (*GLOW_VIOLET, 90))

    for y in range(16):
        for x in range(16):
            d = math.hypot(x - 7.5, y - 7.5)
            if d <= 4.6 and EGG_MASK[y][x] == "#":
                if d <= 1.7:
                    put(img, x, y, (*PUPIL_BLACK, 255))
                elif d <= 3.0:
                    put(img, x, y, (*mix(IRIS_CORE, IRIS_HOT, (d - 1.7) / 1.3), 255))
                elif d <= 4.0:
                    put(img, x, y, (*mix(IRIS_MID, IRIS_RIM, (d - 3.0)), 255))
                else:
                    put(img, x, y, (*mix(SCLERA_LIGHT, SCLERA_DARK, d - 4.0), 255))
    return write_png(os.path.join(RP, "textures", "items", "god_eye_spawn_egg.png"), img)


# --------------------------------------------------------------------------
# 128x128 pack icons
# --------------------------------------------------------------------------

def build_pack_icon(path):
    size = 128
    img = new_image(size, size)
    rng = random.Random(0x60D)
    cx = cy = size / 2.0

    for y in range(size):
        for x in range(size):
            d = math.hypot(x - cx, y - cy) / (size / 2.0)
            colour = mix((22, 10, 34), (4, 2, 8), min(1.0, d))
            img[y][x] = (colour[0], colour[1], colour[2], 255)

    # Dark aura haze.
    for _ in range(2600):
        angle = rng.uniform(0, math.tau)
        radius = rng.uniform(30, 63)
        x = int(cx + math.cos(angle) * radius)
        y = int(cy + math.sin(angle) * radius * 0.9)
        blend(img, x, y, (*AURA_VIOLET, rng.randrange(20, 70)))

    # Sclera, iris, pupil.
    for y in range(size):
        for x in range(size):
            dx = (x - cx) / 46.0
            dy = (y - cy) / 30.0
            d = math.hypot(dx, dy)
            if d > 1.0:
                continue
            if d > 0.9:
                img[y][x] = (*shade(IRIS_RIM, 0.6)[:3], 255)
            else:
                img[y][x] = (*mix(SCLERA_LIGHT, SCLERA_DARK, d * 0.9), 255)

    for y in range(size):
        for x in range(size):
            d = math.hypot(x - cx, y - cy)
            if d <= 12:
                img[y][x] = (*PUPIL_BLACK, 255)
            elif d <= 17:
                img[y][x] = (*mix(IRIS_CORE, IRIS_HOT, (d - 12) / 5.0), 255)
            elif d <= 25:
                img[y][x] = (*mix(IRIS_HOT, IRIS_MID, (d - 17) / 8.0), 255)
            elif d <= 30:
                img[y][x] = (*mix(IRIS_MID, IRIS_RIM, (d - 25) / 5.0), 255)

    # Veins across the sclera.
    for _ in range(26):
        angle = rng.uniform(0, math.tau)
        x, y = cx + math.cos(angle) * 44, cy + math.sin(angle) * 28
        for _step in range(rng.randint(8, 20)):
            angle += rng.uniform(-0.6, 0.6)
            x -= math.cos(angle) * 2.0
            y -= math.sin(angle) * 1.4
            if math.hypot((x - cx) / 46.0, (y - cy) / 30.0) > 0.95:
                break
            if math.hypot(x - cx, y - cy) < 32:
                break
            blend(img, int(x), int(y), (*VEIN_HOT, 150))

    return write_png(path, img)


def main():
    written = [
        build_entity_texture(),
        build_particle_texture(),
        build_spawn_egg(),
        build_pack_icon(os.path.join(RP, "pack_icon.png")),
        build_pack_icon(os.path.join(BP, "pack_icon.png")),
    ]
    for path in written:
        print(f"wrote {path} ({os.path.getsize(path):,} bytes)")


if __name__ == "__main__":
    sys.exit(main())
