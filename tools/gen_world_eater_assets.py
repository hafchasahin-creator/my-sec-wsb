#!/usr/bin/env python3
"""Generate every binary/model asset for the World Eater add-on.

The model and its texture are produced together: cubes are declared once in
CUBES, the packer assigns each one a box-UV rectangle, and the painter fills
exactly those rectangles. That means the texture can never drift out of sync
with the geometry - a whole class of "purple checkerboard" bugs simply cannot
happen.

Pure standard library (struct + zlib), so the pack rebuilds anywhere without
image tooling installed.

Outputs:
  resource_packs/world_eater_rp/models/entity/world_eater.geo.json
  resource_packs/world_eater_rp/textures/entity/world_eater/world_eater_stage{1..4}.png
  resource_packs/world_eater_rp/textures/items/world_core.png
  resource_packs/world_eater_rp/textures/items/world_eater_spawn_egg.png
  resource_packs/world_eater_rp/pack_icon.png
  behavior_packs/world_eater_bp/pack_icon.png

Usage:  python3 tools/gen_world_eater_assets.py
"""

import json
import math
import os
import random
import struct
import zlib

RP = os.path.join("resource_packs", "world_eater_rp")
BP = os.path.join("behavior_packs", "world_eater_bp")

# Bedrock's entity_emissive_alpha material reads the alpha channel as an
# emissive mask: 255 shades normally, 1..254 renders fullbright, 0 is cut out.
OPAQUE = 255
GLOW = 254


# ---------------------------------------------------------------------------
# PNG output
# ---------------------------------------------------------------------------

def write_png(path, pixels, width, height):
    """pixels: flat bytearray of RGBA rows, length width*height*4."""
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)  # filter type 0 (None)
        raw += pixels[y * stride:(y + 1) * stride]

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    blob = b"\x89PNG\r\n\x1a\n"
    blob += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    blob += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    blob += chunk(b"IEND", b"")

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(blob)


class Canvas:
    def __init__(self, width, height):
        self.w = width
        self.h = height
        self.px = bytearray(width * height * 4)

    def set(self, x, y, rgba):
        if 0 <= x < self.w and 0 <= y < self.h:
            i = (y * self.w + x) * 4
            self.px[i:i + 4] = bytes(rgba)

    def get(self, x, y):
        i = (y * self.w + x) * 4
        return tuple(self.px[i:i + 4])

    def fill_rect(self, x, y, w, h, rgba):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.set(xx, yy, rgba)

    def save(self, path):
        write_png(path, self.px, self.w, self.h)


def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return (
        int(a[0] + (b[0] - a[0]) * t),
        int(a[1] + (b[1] - a[1]) * t),
        int(a[2] + (b[2] - a[2]) * t),
    )


def shade(rgb, amount):
    return (
        max(0, min(255, int(rgb[0] * amount))),
        max(0, min(255, int(rgb[1] * amount))),
        max(0, min(255, int(rgb[2] * amount))),
    )


# ---------------------------------------------------------------------------
# The model
#
# Bedrock units: 16 = one block. -Z is the direction the mob faces.
# Each cube: bone, origin (min corner), size (w, h, d), material.
# ---------------------------------------------------------------------------

BONES = [
    # name,        parent,      pivot
    ("root",       None,        (0, 0, 0)),
    ("body",       "root",      (0, 26, 0)),
    ("spine",      "body",      (0, 44, 6)),
    ("tail",       "body",      (0, 30, 14)),
    ("tail_tip",   "tail",      (0, 26, 34)),
    ("neck",       "body",      (0, 40, -10)),
    ("head",       "neck",      (0, 40, -20)),
    ("jaw_upper",  "head",      (0, 38, -22)),
    ("jaw_lower",  "head",      (0, 33, -22)),
    ("maw",        "head",      (0, 34, -24)),
    ("eyes",       "head",      (0, 44, -30)),
    ("arm_r",      "body",      (-15, 36, -6)),
    ("arm_l",      "body",      (15, 36, -6)),
    ("leg_fr",     "root",      (-11, 20, -8)),
    ("leg_fl",     "root",      (11, 20, -8)),
    ("leg_br",     "root",      (-12, 20, 12)),
    ("leg_bl",     "root",      (12, 20, 12)),
]

CUBES = [
    # torso
    ("body", (-14, 20, -12), (28, 18, 26), "flesh"),
    ("body", (-11, 36, -2), (22, 11, 15), "plate"),
    ("body", (-15, 22, -4), (30, 12, 10), "flesh"),
    # jagged spine plates
    ("spine", (-2, 45, -4), (4, 9, 6), "plate"),
    ("spine", (-2, 46, 3), (4, 11, 6), "plate"),
    ("spine", (-2, 44, 10), (4, 8, 6), "plate"),
    # tail
    ("tail", (-7, 24, 12), (14, 12, 22), "flesh"),
    ("tail_tip", (-4, 25, 32), (8, 8, 20), "flesh"),
    ("tail_tip", (-1, 27, 50), (2, 4, 10), "claw"),
    # neck
    ("neck", (-9, 33, -22), (18, 13, 14), "flesh"),
    # skull
    ("head", (-12, 37, -42), (24, 13, 22), "plate"),
    ("head", (-13, 40, -34), (26, 8, 12), "flesh"),
    # horns
    ("head", (-13, 48, -30), (3, 10, 3), "claw"),
    ("head", (10, 48, -30), (3, 10, 3), "claw"),
    ("head", (-14, 56, -28), (3, 7, 3), "claw"),
    ("head", (11, 56, -28), (3, 7, 3), "claw"),
    # upper jaw + fangs
    ("jaw_upper", (-11, 32, -46), (22, 7, 24), "plate"),
    ("jaw_upper", (-9, 29, -45), (3, 4, 3), "tooth"),
    ("jaw_upper", (-3, 29, -46), (3, 5, 3), "tooth"),
    ("jaw_upper", (2, 29, -45), (3, 4, 3), "tooth"),
    ("jaw_upper", (6, 29, -44), (3, 4, 3), "tooth"),
    ("jaw_upper", (-9, 29, -38), (3, 4, 3), "tooth"),
    ("jaw_upper", (6, 29, -38), (3, 4, 3), "tooth"),
    # lower jaw + fangs
    ("jaw_lower", (-10, 24, -44), (20, 8, 22), "plate"),
    ("jaw_lower", (-8, 31, -43), (3, 4, 3), "tooth"),
    ("jaw_lower", (-2, 31, -44), (3, 5, 3), "tooth"),
    ("jaw_lower", (4, 31, -43), (3, 4, 3), "tooth"),
    ("jaw_lower", (-8, 31, -36), (3, 4, 3), "tooth"),
    ("jaw_lower", (5, 31, -36), (3, 4, 3), "tooth"),
    # glowing throat, sits between the jaws
    ("maw", (-9, 30, -40), (18, 6, 18), "maw"),
    # eyes - a cluster, not a pair
    ("eyes", (-11, 44, -35), (4, 3, 2), "eye"),
    ("eyes", (7, 44, -35), (4, 3, 2), "eye"),
    ("eyes", (-8, 48, -33), (3, 3, 2), "eye"),
    ("eyes", (5, 48, -33), (3, 3, 2), "eye"),
    ("eyes", (-4, 46, -36), (2, 2, 2), "eye"),
    ("eyes", (2, 46, -36), (2, 2, 2), "eye"),
    ("eyes", (-1, 50, -32), (2, 2, 2), "eye"),
    # tendril arms
    ("arm_r", (-21, 20, -10), (7, 18, 8), "flesh"),
    ("arm_r", (-22, 10, -12), (6, 12, 6), "flesh"),
    ("arm_r", (-23, 4, -14), (4, 7, 4), "claw"),
    ("arm_l", (14, 20, -10), (7, 18, 8), "flesh"),
    ("arm_l", (16, 10, -12), (6, 12, 6), "flesh"),
    ("arm_l", (19, 4, -14), (4, 7, 4), "claw"),
    # legs
    ("leg_fr", (-14, 6, -12), (7, 15, 8), "flesh"),
    ("leg_fr", (-14, 0, -14), (7, 6, 10), "claw"),
    ("leg_fl", (7, 6, -12), (7, 15, 8), "flesh"),
    ("leg_fl", (7, 0, -14), (7, 6, 10), "claw"),
    ("leg_br", (-15, 6, 8), (7, 15, 8), "flesh"),
    ("leg_br", (-15, 0, 6), (7, 6, 10), "claw"),
    ("leg_bl", (8, 6, 8), (7, 15, 8), "flesh"),
    ("leg_bl", (8, 0, 6), (7, 6, 10), "claw"),
]

LOCATORS = {
    "head": {"mouth": [0, 34, -48], "eye_glow": [0, 46, -34]},
    "body": {"core": [0, 30, 0], "back": [0, 46, 8]},
    "leg_fr": {"foot_fr": [-11, 0, -9]},
    "leg_fl": {"foot_fl": [11, 0, -9]},
}

TEX_W = 256
TEX_H = 256


# ---------------------------------------------------------------------------
# Box-UV packing
# ---------------------------------------------------------------------------

def box_uv_footprint(size):
    w, h, d = size
    return 2 * (d + w), d + h


def face_rects(uv, size):
    """Map the six box-UV faces to (x, y, w, h) rectangles in the atlas."""
    u, v = uv
    w, h, d = size
    return {
        "up": (u + d, v, w, d),
        "down": (u + d + w, v, w, d),
        "east": (u, v + d, d, h),
        "north": (u + d, v + d, w, h),
        "west": (u + d + w, v + d, d, h),
        "south": (u + d + w + d, v + d, w, h),
    }


def pack(cubes, width, height):
    """Shelf-pack every cube footprint. Returns {index: (u, v)} or None."""
    order = sorted(
        range(len(cubes)),
        key=lambda i: box_uv_footprint(cubes[i][2])[1],
        reverse=True,
    )
    placements = {}
    shelf_y = 0
    shelf_x = 0
    shelf_h = 0
    for i in order:
        fw, fh = box_uv_footprint(cubes[i][2])
        if fw > width:
            return None
        if shelf_x + fw > width:
            shelf_y += shelf_h
            shelf_x = 0
            shelf_h = 0
        if shelf_y + fh > height:
            return None
        placements[i] = (shelf_x, shelf_y)
        shelf_x += fw
        shelf_h = max(shelf_h, fh)
    return placements


# ---------------------------------------------------------------------------
# Stage palettes - the creature gets darker and hotter as it grows
# ---------------------------------------------------------------------------

PALETTES = {
    1: {
        "name": "Hungry",
        "flesh": ((36, 32, 42), (62, 55, 70)),
        "plate": ((28, 25, 33), (48, 43, 55)),
        "tooth": ((196, 190, 178), (232, 228, 216)),
        "claw": ((22, 20, 26), (46, 42, 50)),
        "glow": (168, 44, 40),
        "hot": (214, 92, 60),
        "eye": (226, 70, 52),
        "vein_density": 0.14,
    },
    2: {
        "name": "Devourer",
        "flesh": ((30, 22, 28), (56, 38, 44), ),
        "plate": ((22, 16, 21), (42, 30, 36)),
        "tooth": ((204, 188, 168), (240, 228, 208)),
        "claw": ((18, 13, 17), (40, 30, 34)),
        "glow": (204, 40, 28),
        "hot": (248, 120, 44),
        "eye": (255, 74, 40),
        "vein_density": 0.22,
    },
    3: {
        "name": "Catastrophe",
        "flesh": ((20, 16, 20), (44, 32, 32)),
        "plate": ((14, 11, 14), (34, 24, 25)),
        "tooth": ((214, 196, 170), (248, 236, 214)),
        "claw": ((12, 9, 12), (32, 22, 24)),
        "glow": (240, 76, 18),
        "hot": (255, 178, 60),
        "eye": (255, 132, 30),
        "vein_density": 0.32,
    },
    4: {
        "name": "World Eater",
        "flesh": ((10, 8, 12), (30, 22, 28)),
        "plate": ((6, 5, 8), (22, 16, 20)),
        "tooth": ((228, 214, 196), (255, 250, 238)),
        "claw": ((5, 4, 6), (24, 16, 20)),
        "glow": (255, 52, 46),
        "hot": (255, 224, 196),
        "eye": (255, 236, 210),
        "vein_density": 0.44,
    },
}


def paint_face(canvas, rect, mat, pal, rng, face):
    x, y, w, h = rect
    if w <= 0 or h <= 0:
        return

    if mat == "maw":
        # Throat: black at the rim, white-hot at the centre. All emissive.
        cx, cy = (w - 1) / 2.0, (h - 1) / 2.0
        norm = max(1.0, math.hypot(cx, cy))
        for yy in range(h):
            for xx in range(w):
                t = 1.0 - math.hypot(xx - cx, yy - cy) / norm
                t = max(0.0, t) ** 1.4
                rgb = mix(shade(pal["glow"], 0.35), pal["hot"], t)
                if rng.random() < 0.07:
                    rgb = shade(rgb, 0.6)
                canvas.set(x + xx, y + yy, (*rgb, GLOW))
        return

    if mat == "eye":
        for yy in range(h):
            for xx in range(w):
                edge = xx == 0 or yy == 0 or xx == w - 1 or yy == h - 1
                rgb = shade(pal["eye"], 0.55) if edge else pal["eye"]
                canvas.set(x + xx, y + yy, (*rgb, GLOW))
        # a dark slit pupil on the outward faces
        if face in ("north", "east", "west") and w >= 3 and h >= 2:
            for yy in range(h):
                canvas.set(x + w // 2, y + yy, (18, 4, 4, GLOW))
        return

    if mat == "tooth":
        dark, light = pal["tooth"]
        for yy in range(h):
            t = 1.0 - (yy / max(1, h - 1))  # tips (low y in UV = top) stay pale
            for xx in range(w):
                rgb = mix(shade(dark, 0.65), light, t)
                if rng.random() < 0.10:
                    rgb = shade(rgb, 0.88)
                canvas.set(x + xx, y + yy, (*rgb, OPAQUE))
        return

    dark, light = pal[mat if mat in pal else "flesh"]
    for yy in range(h):
        for xx in range(w):
            t = rng.random() * 0.55 + (0.45 if face in ("up", "north") else 0.0)
            rgb = mix(dark, light, t)
            canvas.set(x + xx, y + yy, (*rgb, OPAQUE))

    # 1px dark border so cube edges read at distance
    for xx in range(w):
        canvas.set(x + xx, y, (*shade(dark, 0.55), OPAQUE))
        canvas.set(x + xx, y + h - 1, (*shade(dark, 0.55), OPAQUE))
    for yy in range(h):
        canvas.set(x, y + yy, (*shade(dark, 0.55), OPAQUE))
        canvas.set(x + w - 1, y + yy, (*shade(dark, 0.55), OPAQUE))

    if mat == "claw":
        for yy in range(h):
            t = 1.0 - yy / max(1, h - 1)
            if t > 0.72:
                for xx in range(w):
                    canvas.set(x + xx, y + yy, (*mix(light, pal["hot"], (t - 0.72) * 3), OPAQUE))
        return

    # Corruption veins: short random walks that glow.
    veins = int(w * h * pal["vein_density"] / 12)
    for _ in range(max(1, veins)):
        cx = rng.randrange(w)
        cy = rng.randrange(h)
        length = rng.randint(3, max(4, (w + h) // 3))
        for _step in range(length):
            if not (0 <= cx < w and 0 <= cy < h):
                break
            hot = rng.random() < 0.3
            rgb = pal["hot"] if hot else pal["glow"]
            canvas.set(x + cx, y + cy, (*rgb, GLOW))
            if rng.random() < 0.5:
                cx += rng.choice((-1, 1))
            else:
                cy += rng.choice((-1, 1))


def build_geometry(placements):
    bones = []
    by_bone = {}
    for index, (bone, origin, size, mat) in enumerate(CUBES):
        by_bone.setdefault(bone, []).append(
            {
                "origin": list(origin),
                "size": list(size),
                "uv": list(placements[index]),
            }
        )

    for name, parent, pivot in BONES:
        bone = {"name": name, "pivot": list(pivot)}
        if parent:
            bone["parent"] = parent
        if name in by_bone:
            bone["cubes"] = by_bone[name]
        if name in LOCATORS:
            bone["locators"] = LOCATORS[name]
        bones.append(bone)

    return {
        "format_version": "1.12.0",
        "minecraft:geometry": [
            {
                "description": {
                    "identifier": "geometry.world_eater",
                    "texture_width": TEX_W,
                    "texture_height": TEX_H,
                    "visible_bounds_width": 8,
                    "visible_bounds_height": 7,
                    "visible_bounds_offset": [0, 3, 0],
                },
                "bones": bones,
            }
        ],
    }


# ---------------------------------------------------------------------------
# 16x16 item icons
# ---------------------------------------------------------------------------

def world_core_icon():
    c = Canvas(16, 16)
    cx = cy = 7.5
    for y in range(16):
        for x in range(16):
            d = math.hypot(x - cx, y - cy)
            if d > 7.2:
                continue
            if d > 6.0:
                c.set(x, y, (16, 8, 14, 255))
            elif d > 5.0:
                c.set(x, y, (44, 18, 30, 255))
            else:
                t = 1.0 - d / 5.0
                c.set(x, y, (*mix((28, 12, 22), (255, 96, 40), t ** 1.6), 255))
    # fracture lines across the core
    for (x, y) in [(7, 2), (7, 3), (6, 4), (6, 5), (7, 6), (8, 7), (8, 8),
                   (7, 9), (7, 10), (8, 11), (3, 7), (4, 7), (5, 8), (10, 6),
                   (11, 7), (12, 7)]:
        c.set(x, y, (255, 232, 190, 255))
    # highlight
    c.set(5, 4, (255, 244, 220, 255))
    c.set(6, 4, (255, 214, 170, 255))
    return c


def spawn_egg_icon():
    c = Canvas(16, 16)
    rng = random.Random(4242)
    for y in range(16):
        for x in range(16):
            # egg silhouette: narrow at the top, round at the bottom
            ry = (y - 8.0) / 7.0
            half = 4.6 * math.sqrt(max(0.0, 1.0 - (ry * 0.92) ** 2))
            if y < 8:
                half *= 0.82 + 0.18 * (y / 8.0)
            if abs(x - 7.5) > half:
                continue
            edge = abs(x - 7.5) > half - 1.0 or y <= 1 or y >= 14
            base = (22, 18, 26) if edge else mix((30, 24, 34), (68, 52, 72), rng.random())
            c.set(x, y, (*base, 255))
    # corrupted speckles
    for _ in range(26):
        x = rng.randrange(3, 13)
        y = rng.randrange(2, 15)
        if c.get(x, y)[3] == 0:
            continue
        c.set(x, y, (*(rng.choice([(226, 48, 40), (255, 132, 36), (150, 30, 60)])), 255))
    # a glowing maw-slit so the egg reads as the World Eater's
    for x in range(5, 11):
        c.set(x, 9, (255, 196, 120, 255))
    for x in range(6, 10):
        c.set(x, 10, (255, 96, 40, 255))
    c.set(5, 6, (255, 70, 50, 255))
    c.set(10, 6, (255, 70, 50, 255))
    return c


def particle_atlas():
    """32x32 sheet of four 16x16 cells the particle JSONs index by UV.

    Shipping our own sheet means the UV coordinates are exact instead of
    depending on where a sprite happens to sit in the vanilla atlas.
      (0,0)   soft mote      (16,0)  ember spark
      (0,16)  rock shard     (16,16) smoke puff
    """
    c = Canvas(32, 32)
    rng = random.Random(7)

    # soft round mote
    for y in range(16):
        for x in range(16):
            d = math.hypot(x - 7.5, y - 7.5)
            if d <= 7.0:
                a = int(255 * max(0.0, 1.0 - d / 7.0) ** 1.3)
                c.set(x, y, (255, 255, 255, a))

    # ember spark: bright core, four-point flare
    for y in range(16):
        for x in range(16):
            dx, dy = abs(x - 7.5), abs(y - 7.5)
            d = math.hypot(dx, dy)
            spike = max(0.0, 1.0 - (dx * dy) / 9.0)
            a = max(max(0.0, 1.0 - d / 3.2) ** 1.2, spike * 0.55)
            if a > 0.02:
                c.set(16 + x, y, (255, 255, 255, int(255 * min(1.0, a))))

    # rock shard: chunky angular blob
    for y in range(16):
        for x in range(16):
            if 2 <= x <= 13 and 2 <= y <= 13:
                edge = abs(x - 7.5) + abs(y - 7.5)
                if edge < 8.5 and rng.random() > 0.08:
                    v = 190 + rng.randrange(66)
                    c.set(x, 16 + y, (v, v, v, 255))

    # smoke puff: clumpy, soft-edged
    for y in range(16):
        for x in range(16):
            d = math.hypot(x - 7.5, y - 7.5) + rng.random() * 2.2
            if d <= 7.5:
                a = int(210 * max(0.0, 1.0 - d / 7.5) ** 0.8)
                c.set(16 + x, 16 + y, (255, 255, 255, a))

    return c


def pack_icon():
    c = Canvas(64, 64)
    rng = random.Random(99)
    for y in range(64):
        for x in range(64):
            t = y / 63.0
            c.set(x, y, (*mix((10, 6, 12), (34, 14, 22), t), 255))
    # a cracked world being swallowed
    cx, cy = 32.0, 36.0
    for y in range(64):
        for x in range(64):
            d = math.hypot(x - cx, y - cy)
            if d < 20:
                t = 1.0 - d / 20.0
                c.set(x, y, (*mix((26, 20, 30), (58, 44, 52), t * rng.random()), 255))
    for _ in range(70):
        x = rng.randrange(14, 50)
        y = rng.randrange(18, 54)
        for _step in range(rng.randint(3, 9)):
            if not (0 <= x < 64 and 0 <= y < 64):
                break
            c.set(x, y, (*rng.choice([(255, 96, 30), (220, 40, 30)]), 255))
            if rng.random() < 0.5:
                x += rng.choice((-1, 1))
            else:
                y += rng.choice((-1, 1))
    # giant jaws closing over it
    for x in range(64):
        top = int(10 + 5 * math.sin(x / 6.0))
        for y in range(0, top):
            c.set(x, y, (6, 4, 8, 255))
        if (x // 4) % 2 == 0:
            for y in range(top, top + rng.randint(3, 6)):
                c.set(x, y, (236, 226, 208, 255))
    # glowing eyes
    for (ex, ey) in [(18, 5), (26, 3), (38, 3), (46, 5), (32, 7)]:
        for dy in range(2):
            for dx in range(3):
                c.set(ex + dx, ey + dy, (255, 70, 40, 255))
    return c


def main():
    placements = pack(CUBES, TEX_W, TEX_H)
    if placements is None:
        raise SystemExit(
            f"box-UV packing overflowed {TEX_W}x{TEX_H}; enlarge the atlas"
        )

    geo = build_geometry(placements)
    geo_path = os.path.join(RP, "models", "entity", "world_eater.geo.json")
    os.makedirs(os.path.dirname(geo_path), exist_ok=True)
    with open(geo_path, "w", encoding="utf-8") as handle:
        json.dump(geo, handle, indent=2)
        handle.write("\n")

    used = 0
    for stage, pal in PALETTES.items():
        canvas = Canvas(TEX_W, TEX_H)
        rng = random.Random(1000 + stage)
        for index, (_bone, _origin, size, mat) in enumerate(CUBES):
            rects = face_rects(placements[index], size)
            for face, rect in rects.items():
                paint_face(canvas, rect, mat, pal, rng, face)
        canvas.save(
            os.path.join(
                RP, "textures", "entity", "world_eater",
                f"world_eater_stage{stage}.png",
            )
        )
        used = max(
            used,
            max(
                placements[i][1] + box_uv_footprint(CUBES[i][2])[1]
                for i in range(len(CUBES))
            ),
        )

    world_core_icon().save(os.path.join(RP, "textures", "items", "world_core.png"))
    spawn_egg_icon().save(
        os.path.join(RP, "textures", "items", "world_eater_spawn_egg.png")
    )
    particle_atlas().save(
        os.path.join(RP, "textures", "particle", "world_eater_particles.png")
    )
    icon = pack_icon()
    icon.save(os.path.join(RP, "pack_icon.png"))
    icon.save(os.path.join(BP, "pack_icon.png"))

    print(
        f"Wrote geometry ({len(CUBES)} cubes across {len(BONES)} bones), "
        f"4 stage textures at {TEX_W}x{TEX_H} (atlas rows used: {used}), "
        "1 particle atlas, 2 item icons, 2 pack icons."
    )


if __name__ == "__main__":
    main()
