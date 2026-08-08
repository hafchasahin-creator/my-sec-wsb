#!/usr/bin/env python3
"""Generate every PNG the Anaconda add-on needs.

Pure standard library - writes RGBA PNGs directly so the pack can be rebuilt
anywhere without image tooling installed.

Outputs:
  resource_packs/anaconda_rp/textures/entity/anaconda.png   128x128 mob skin
  resource_packs/anaconda_rp/textures/items/anaconda_spawn_egg.png  16x16
  resource_packs/anaconda_rp/pack_icon.png                  128x128
  behavior_packs/anaconda_bp/pack_icon.png                  128x128

The mob skin is painted per cube face using the same box-UV layout the game
uses, so the belly, mouth interior and eyes land on the right faces of
models/entity/anaconda.geo.json. Keep CUBES in sync with that file.

Usage:  python3 tools/gen_anaconda_textures.py
"""

import math
import os
import struct
import zlib

RP = os.path.join("resource_packs", "anaconda_rp")
BP = os.path.join("behavior_packs", "anaconda_bp")

# --------------------------------------------------------------------------
# Palette
# --------------------------------------------------------------------------

DARK = (34, 52, 30, 255)
BASE = (56, 84, 44, 255)
MID = (72, 104, 54, 255)
LIGHT = (98, 128, 66, 255)
BELLY = (196, 190, 140, 255)
BELLY_ALT = (168, 162, 116, 255)
MOUTH = (176, 84, 96, 255)
MOUTH_ALT = (146, 64, 78, 255)
TONGUE = (196, 48, 60, 255)
EYE_RING = (24, 26, 18, 255)
EYE = (218, 172, 54, 255)
PUPIL = (16, 14, 10, 255)
TRANSPARENT = (0, 0, 0, 0)


# --------------------------------------------------------------------------
# PNG output
# --------------------------------------------------------------------------

def write_png(path, pixels):
    """pixels: list of rows, each row a list of (r, g, b, a)."""
    height = len(pixels)
    width = len(pixels[0])
    raw = b"".join(
        b"\x00" + bytes(channel for px in row for channel in px) for row in pixels
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
    print(f"  wrote {path} ({width}x{height})")


def blank(width, height, colour=TRANSPARENT):
    return [[colour for _ in range(width)] for _ in range(height)]


def fill(pixels, x0, y0, w, h, colour_fn):
    height = len(pixels)
    width = len(pixels[0])
    for y in range(y0, y0 + h):
        for x in range(x0, x0 + w):
            if 0 <= x < width and 0 <= y < height:
                colour = colour_fn(x, y) if callable(colour_fn) else colour_fn
                if colour is not None:
                    pixels[y][x] = colour


# --------------------------------------------------------------------------
# Deterministic noise - no random module, so rebuilds are byte-identical
# --------------------------------------------------------------------------

def noise(x, y, seed=0):
    n = (x * 374761393 + y * 668265263 + seed * 1442695040888963407) & 0xFFFFFFFF
    n = (n ^ (n >> 13)) * 1274126177 & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFF) / 65535.0


def scales(x, y):
    """Diamond-lattice snake skin."""
    u = (x * 2 + y) % 18
    v = (x * 2 - y) % 18
    ring = min(abs(u - 9), abs(v - 9))
    n = noise(x, y)
    if ring <= 2:
        return DARK if n < 0.7 else BASE
    if ring >= 6:
        return LIGHT if n < 0.5 else MID
    return MID if n < 0.6 else BASE


def belly(x, y):
    n = noise(x, y, 7)
    if (y // 2) % 2 == 0:
        return BELLY if n < 0.75 else BELLY_ALT
    return BELLY_ALT if n < 0.6 else BELLY


def mouth(x, y):
    return MOUTH if noise(x, y, 3) < 0.65 else MOUTH_ALT


# --------------------------------------------------------------------------
# The mob skin
# --------------------------------------------------------------------------

# name -> (uv_x, uv_y, width, height, depth); mirrors anaconda.geo.json.
CUBES = {
    "head": (0, 0, 12, 10, 12),
    "neck": (48, 0, 10, 11, 10),
    "tongue": (90, 0, 1, 1, 8),
    "jaw": (0, 24, 10, 3, 12),
    "body3": (48, 24, 11, 11, 10),
    "body1": (0, 40, 12, 12, 10),
    "body5": (48, 48, 9, 9, 10),
    "body4": (0, 64, 10, 10, 10),
    "body7": (48, 70, 6, 6, 10),
    "body6": (0, 86, 8, 8, 10),
    "tail2": (48, 88, 2, 2, 10),
    "tail1": (0, 106, 4, 4, 10),
}


def faces(cube):
    """Box-UV rectangles for one cube: name -> (x, y, w, h)."""
    u, v, w, h, d = cube
    return {
        "up": (u + d, v, w, d),
        "down": (u + d + w, v, w, d),
        "east": (u, v + d, d, h),
        "north": (u + d, v + d, w, h),
        "west": (u + d + w, v + d, d, h),
        "south": (u + d + w + d, v + d, w, h),
    }


def draw_eye(pixels, x, y):
    """A 5x4 eye with a vertical slit pupil, top-left corner at (x, y)."""
    fill(pixels, x, y, 5, 4, EYE_RING)
    fill(pixels, x + 1, y + 1, 3, 2, EYE)
    fill(pixels, x + 2, y + 1, 1, 2, PUPIL)


def entity_texture():
    pixels = blank(128, 128, TRANSPARENT)

    # Base skin across every cube's whole footprint.
    for cube in CUBES.values():
        u, v, w, h, d = cube
        fill(pixels, u, v, 2 * (d + w), d + h, scales)

    # Pale belly on the underside of every body segment.
    for name, cube in CUBES.items():
        if name in ("tongue", "head"):
            continue
        x, y, w, h = faces(cube)["down"]
        fill(pixels, x, y, w, h, belly)

    # Mouth interior: roof of the mouth is the head's underside, floor of the
    # mouth is the jaw's top face.
    x, y, w, h = faces(CUBES["head"])["down"]
    fill(pixels, x, y, w, h, mouth)
    x, y, w, h = faces(CUBES["jaw"])["up"]
    fill(pixels, x, y, w, h, mouth)

    # The tongue is small enough to just be red all over.
    u, v, w, h, d = CUBES["tongue"]
    fill(pixels, u, v, 2 * (d + w), d + h, TONGUE)

    head = faces(CUBES["head"])

    # Eyes. On the east face the snout is at the left edge, on the west face it
    # is at the right edge, so the two eyes sit at opposite ends of their rects.
    ex, ey, _ew, _eh = head["east"]
    draw_eye(pixels, ex + 2, ey + 1)
    wx, wy, ww, _wh = head["west"]
    draw_eye(pixels, wx + ww - 7, wy + 1)

    # Nostrils on the snout.
    nx, ny, nw, _nh = head["north"]
    fill(pixels, nx + 3, ny + 2, 1, 1, EYE_RING)
    fill(pixels, nx + nw - 4, ny + 2, 1, 1, EYE_RING)

    # A darker stripe running along the top of the skull.
    ux, uy, uw, uh = head["up"]
    fill(
        pixels,
        ux + uw // 2 - 1,
        uy,
        2,
        uh,
        lambda x, y: DARK if noise(x, y, 11) < 0.85 else BASE,
    )

    write_png(os.path.join(RP, "textures", "entity", "anaconda.png"), pixels)


# --------------------------------------------------------------------------
# Spawn egg
# --------------------------------------------------------------------------

def spawn_egg():
    size = 16
    pixels = blank(size, size)
    cx, cy = 7.5, 8.5

    def inside(x, y):
        # Narrower towards the top, like a vanilla spawn egg.
        taper = 0.70 + 0.30 * ((y - 1.0) / 13.0)
        rx = 4.6 * min(1.0, max(0.55, taper))
        ry = 6.6
        dx = (x - cx) / rx
        dy = (y - cy) / ry
        return dx * dx + dy * dy <= 1.0

    for y in range(size):
        for x in range(size):
            if not inside(x, y):
                continue
            edge = not (
                inside(x - 1, y) and inside(x + 1, y)
                and inside(x, y - 1) and inside(x, y + 1)
            )
            if edge:
                pixels[y][x] = DARK
                continue
            n = noise(x, y, 5)
            spot = ((x * 2 + y) % 7 <= 1) and n < 0.8
            pixels[y][x] = BASE if spot else (LIGHT if n < 0.45 else MID)

    # A hint of a pale belly on the lower left, plus a highlight.
    for y in range(9, 14):
        for x in range(4, 9):
            if inside(x, y) and pixels[y][x] != DARK and noise(x, y, 9) < 0.5:
                pixels[y][x] = BELLY_ALT
    if inside(6, 4):
        pixels[4][6] = LIGHT

    write_png(os.path.join(RP, "textures", "items", "anaconda_spawn_egg.png"), pixels)


# --------------------------------------------------------------------------
# Pack icons
# --------------------------------------------------------------------------

def pack_icon(path):
    size = 128
    bg_top = (26, 44, 30, 255)
    bg_bottom = (14, 24, 18, 255)
    pixels = [
        [
            (
                int(bg_top[0] + (bg_bottom[0] - bg_top[0]) * y / (size - 1)),
                int(bg_top[1] + (bg_bottom[1] - bg_top[1]) * y / (size - 1)),
                int(bg_top[2] + (bg_bottom[2] - bg_top[2]) * y / (size - 1)),
                255,
            )
            for _ in range(size)
        ]
        for y in range(size)
    ]

    def disc(cx, cy, radius, colour_fn):
        r2 = radius * radius
        for y in range(int(cy - radius) - 1, int(cy + radius) + 2):
            for x in range(int(cx - radius) - 1, int(cx + radius) + 2):
                if 0 <= x < size and 0 <= y < size:
                    dx = x - cx
                    dy = y - cy
                    if dx * dx + dy * dy <= r2:
                        pixels[y][x] = colour_fn(x, y)

    # Body: an S-curve from tail (bottom) to head (top).
    steps = 260
    for i in range(steps, -1, -1):
        t = i / steps
        cx = 64 + 34 * math.sin(t * 2.4 * math.pi)
        cy = 116 - t * 96
        radius = 4 + 12 * t
        disc(cx, cy, radius + 2, lambda x, y: DARK)
        disc(cx, cy, radius, lambda x, y: scales(x // 2, y // 2))

    # Head at the end of the curve.
    hx = 64 + 34 * math.sin(2.4 * math.pi)
    hy = 20
    disc(hx, hy, 19, lambda x, y: DARK)
    disc(hx, hy, 16, lambda x, y: scales(x // 2, y // 2))
    for side in (-1, 1):
        disc(hx + side * 8, hy - 4, 5, lambda x, y: EYE_RING)
        disc(hx + side * 8, hy - 4, 3, lambda x, y: EYE)
        disc(hx + side * 8, hy - 4, 1.6, lambda x, y: PUPIL)
    # Forked tongue.
    fill(pixels, int(hx) - 1, hy + 14, 3, 16, TONGUE)
    fill(pixels, int(hx) - 7, hy + 26, 6, 3, TONGUE)
    fill(pixels, int(hx) + 2, hy + 26, 6, 3, TONGUE)

    write_png(path, pixels)


if __name__ == "__main__":
    print("Generating Anaconda textures...")
    entity_texture()
    spawn_egg()
    pack_icon(os.path.join(RP, "pack_icon.png"))
    pack_icon(os.path.join(BP, "pack_icon.png"))
    print("Done.")
