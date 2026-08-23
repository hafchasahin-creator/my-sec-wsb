#!/usr/bin/env python3
"""Generate every Bloatgrub art asset from a single source of truth.

The entity model and the entity texture are produced by the *same* pass: each
cube's box-UV footprint is packed into the atlas here, and both the geometry
JSON and the painted pixels are emitted from that one packing. It is therefore
impossible for the model and its texture to drift apart - the classic way a
custom Bedrock mob ends up rendering as a smear of the wrong pixels.

Pure standard library. No image tooling required.

Usage:
    python3 tools/gen_bloatgrub.py            # write every asset
    python3 tools/gen_bloatgrub.py --preview  # also print ASCII previews
"""

import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pixel import TRANSPARENT, from_ascii, new_grid, scale_nearest, write_png  # noqa: E402

RP = os.path.join("resource_packs", "bloatgrub_rp")
BP = os.path.join("behavior_packs", "bloatgrub_bp")

ATLAS = 128  # entity texture is ATLAS x ATLAS - small enough for a phone
GEOMETRY_ID = "geometry.bloatgrub"


# ==========================================================================
# Model
# ==========================================================================
#
# Coordinate system (Bedrock entity models):
#   +Y is up, the model's feet sit at y = 0, and the creature FACES -Z.
#   One unit = 1/16 of a block. Cube "size" must stay integral so that box UV
#   lands on whole texture pixels.
#
# Bone rotations are all left at zero on purpose. The pose is built into the
# cube positions, so the model is correct no matter which way a reader thinks
# Bedrock's rotation signs point; all the motion lives in the animations.

LEG_Z = (-4, 1, 6)  # front / middle / rear leg pairs

BONES = [
    # name, parent, pivot
    ("root", None, [0, 0, 0]),
    ("body", "root", [0, 8, 2]),
    ("thorax", "body", [0, 8, 0]),
    ("head", "thorax", [0, 9, -4]),
    ("jaw_upper", "head", [0, 9, -9]),
    ("jaw_lower", "head", [0, 9, -9]),
    ("tail", "body", [0, 9, 8]),
    ("tail_tip", "tail", [0, 9, 12]),
]

# bone -> list of cubes; each cube is (name, origin, size, role, inflate)
CUBES = {
    "body": [
        ("abdomen", [-5, 5, 0], [10, 8, 8], "flesh", 0.0),
        ("ridge", [-1, 13, 1], [2, 3, 7], "chitin", 0.0),
        ("boil_l", [-6, 9, 1], [3, 3, 3], "boil", 0.25),
        ("boil_r", [3, 9, 4], [3, 3, 3], "boil", 0.25),
        ("boil_top", [-5, 12, 5], [4, 3, 3], "boil", 0.25),
    ],
    "thorax": [
        ("thorax", [-4, 5, -4], [8, 8, 4], "flesh", 0.0),
    ],
    "head": [
        ("skull", [-4, 5, -9], [8, 8, 5], "flesh", 0.0),
        ("brow", [-5, 13, -11], [10, 2, 6], "chitin", 0.0),
        ("eye", [-3, 14, -10], [6, 4, 4], "eye", 0.15),
    ],
    # The maw is the whole point of the animal, so it is deliberately wider
    # than the skull and tall enough for a ring of teeth to be legible at the
    # size this thing actually renders on a phone.
    "jaw_upper": [
        ("jaw_upper", [-5, 9, -14], [10, 4, 5], "maw_upper", 0.0),
    ],
    "jaw_lower": [
        ("jaw_lower", [-5, 5, -14], [10, 4, 5], "maw_lower", 0.0),
    ],
    "tail": [
        ("tail", [-3, 6, 8], [6, 5, 4], "flesh", 0.0),
    ],
    "tail_tip": [
        ("tail_tip", [-1, 8, 12], [2, 2, 4], "chitin", 0.0),
    ],
}


def add_legs():
    """Six spindly legs: a horizontal thigh out of the flank, a vertical shin."""
    for index, z in enumerate(LEG_Z):
        for side, sign in (("l", -1), ("r", 1)):
            thigh_bone = f"thigh_{side}{index}"
            shin_bone = f"shin_{side}{index}"

            thigh_x = 4 if sign > 0 else -9
            shin_x = 7 if sign > 0 else -9

            BONES.append((thigh_bone, "body", [sign * 4, 7, z]))
            BONES.append((shin_bone, thigh_bone, [sign * 8, 7, z]))

            CUBES[thigh_bone] = [
                (thigh_bone, [thigh_x, 6, z - 1], [5, 2, 2], "chitin", 0.0)
            ]
            CUBES[shin_bone] = [
                (shin_bone, [shin_x, 0, z - 1], [2, 6, 2], "chitin", 0.0)
            ]


add_legs()


# ==========================================================================
# Box UV
# ==========================================================================
#
# For a cube of size (sx, sy, sz) whose uv origin is (u, v), Minecraft's box
# UV unwrap occupies a 2*(sx+sz) by (sz+sy) rectangle laid out as:
#
#        u          u+sz        u+sz+sx     u+2sz+sx    u+2sz+2sx
#   v    +-----------+-----------+-----------+-----------+
#        |  (blank)  |    UP     |   DOWN    |  (blank)  |  height sz
#   v+sz +-----------+-----------+-----------+-----------+
#        |   EAST    |   NORTH   |   WEST    |   SOUTH   |  height sy
#        +-----------+-----------+-----------+-----------+
#
# NORTH is the face the creature leads with, because the model faces -Z.


def uv_footprint(size):
    sx, sy, sz = size
    return 2 * (sx + sz), sz + sy


def uv_faces(u, v, size):
    """Pixel rect (x, y, w, h) for each of the six faces."""
    sx, sy, sz = size
    return {
        "up": (u + sz, v, sx, sz),
        "down": (u + sz + sx, v, sx, sz),
        "east": (u, v + sz, sz, sy),
        "north": (u + sz, v + sz, sx, sy),
        "west": (u + sz + sx, v + sz, sz, sy),
        "south": (u + 2 * sz + sx, v + sz, sx, sy),
    }


def pack_atlas():
    """Shelf-pack every cube footprint into an ATLAS x ATLAS texture.

    Returns {cube_name: (u, v)}. Raises if the cubes do not fit, rather than
    silently overlapping two cubes onto the same pixels.
    """
    entries = []
    for bone, cubes in CUBES.items():
        for name, _origin, size, _role, _inflate in cubes:
            width, height = uv_footprint(size)
            entries.append((height, width, name, size))

    # Tallest first keeps the shelves tight; the name breaks ties so the
    # packing - and therefore the generated texture - is deterministic.
    entries.sort(key=lambda e: (-e[0], -e[1], e[2]))

    placement = {}
    cursor_x = 0
    cursor_y = 0
    shelf_height = 0
    for height, width, name, _size in entries:
        if width > ATLAS:
            raise ValueError(f"cube {name} is {width}px wide, atlas is {ATLAS}px")
        if cursor_x + width > ATLAS:
            cursor_x = 0
            cursor_y += shelf_height
            shelf_height = 0
        if cursor_y + height > ATLAS:
            raise ValueError(
                f"cube {name} does not fit: atlas {ATLAS}x{ATLAS} is too small"
            )
        placement[name] = (cursor_x, cursor_y)
        cursor_x += width
        shelf_height = max(shelf_height, height)

    return placement


def build_geometry(placement):
    bones = []
    for name, parent, pivot in BONES:
        bone = {"name": name, "pivot": list(pivot)}
        if parent:
            bone["parent"] = parent

        cubes = []
        for cube_name, origin, size, _role, inflate in CUBES.get(name, []):
            u, v = placement[cube_name]
            entry = {"origin": list(origin), "size": list(size), "uv": [u, v]}
            if inflate:
                entry["inflate"] = inflate
            cubes.append(entry)
        if cubes:
            bone["cubes"] = cubes
        bones.append(bone)

    return {
        "format_version": "1.12.0",
        "minecraft:geometry": [
            {
                "description": {
                    "identifier": GEOMETRY_ID,
                    "texture_width": ATLAS,
                    "texture_height": ATLAS,
                    "visible_bounds_width": 3,
                    "visible_bounds_height": 2.5,
                    "visible_bounds_offset": [0, 0.75, 0],
                },
                "bones": bones,
            }
        ],
    }


# ==========================================================================
# Painting
# ==========================================================================

PALETTES = {
    "flesh": {
        "base": (188, 166, 158),
        "light": (210, 194, 186),
        "dark": (146, 122, 120),
        "vein": (152, 104, 104),
        "deep": (118, 58, 62),
        "blot": (170, 144, 132),
    },
    "chitin": {
        "base": (58, 48, 44),
        "light": (92, 78, 68),
        "dark": (32, 26, 24),
        "vein": (104, 82, 52),
        "deep": (74, 58, 36),
        "blot": (48, 40, 36),
    },
    "boil": {
        "base": (170, 172, 78),
        "light": (224, 226, 148),
        "dark": (104, 96, 42),
        "vein": (126, 104, 52),
        "deep": (92, 60, 36),
        "blot": (196, 190, 104),
    },
    "maw": {
        "base": (52, 16, 20),
        "light": (108, 30, 36),
        "dark": (20, 5, 9),
        "vein": (120, 36, 40),
        "deep": (150, 44, 48),
        "blot": (36, 10, 14),
    },
    "eye": {
        "base": (208, 200, 184),
        "light": (238, 234, 222),
        "dark": (150, 142, 128),
        "vein": (176, 132, 130),
        "deep": (154, 44, 44),
        "blot": (188, 178, 160),
    },
}

TOOTH = (234, 226, 202)
TOOTH_SHADE = (176, 168, 148)
IRIS = (162, 22, 24)
PUPIL = (12, 6, 8)

# Per-face light level, so a flat procedural texture still reads as 3D.
FACE_LIGHT = {
    "up": 1.16,
    "down": 0.62,
    "north": 1.04,
    "south": 0.88,
    "east": 0.84,
    "west": 0.94,
}


def shade(color, factor, jitter=0):
    return tuple(
        max(0, min(255, int(channel * factor) + jitter)) for channel in color
    ) + (255,)


def put(grid, x, y, rgba):
    if 0 <= y < len(grid) and 0 <= x < len(grid[0]):
        grid[y][x] = rgba


def fill(grid, rect, rgba):
    x, y, w, h = rect
    for row in range(y, y + h):
        for col in range(x, x + w):
            put(grid, col, row, rgba)


def paint_base(grid, rect, palette, light, rng):
    """Base coat with a lightly broken rim so cube edges stay readable.

    Kept deliberately low-contrast: these faces are only a handful of texels
    across, so speckle that looks like texture in the atlas reads as static on
    the mob.
    """
    x, y, w, h = rect
    for row in range(y, y + h):
        for col in range(x, x + w):
            edge = row in (y, y + h - 1) or col in (x, x + w - 1)
            tone = palette["dark"] if edge and rng.random() < 0.4 else palette["base"]
            if not edge and rng.random() < 0.10:
                tone = palette["blot"]
            elif not edge and rng.random() < 0.04:
                tone = palette["light"]
            put(grid, col, row, shade(tone, light, rng.randint(-5, 5)))


def paint_veins(grid, rect, palette, light, rng, density):
    """Short random walks - reads as veins under translucent skin.

    The walk count is derived from the face's area rather than fixed, because
    a fixed count buries a small face in vein and leaves a large one bare.
    `density` is roughly the fraction of the face a vein may cover.
    """
    x, y, w, h = rect
    if w < 3 or h < 3:
        return
    walks = max(1, int(w * h * density / 6))
    for _ in range(walks):
        col = rng.randrange(x + 1, x + w - 1)
        row = rng.randrange(y + 1, y + h - 1)
        for step in range(rng.randint(2, 4)):
            tone = palette["deep"] if step == 0 and rng.random() < 0.35 else palette["vein"]
            put(grid, col, row, shade(tone, light, rng.randint(-8, 8)))
            col += rng.choice((-1, 0, 1))
            row += rng.choice((-1, 0, 1))
            col = max(x, min(x + w - 1, col))
            row = max(y, min(y + h - 1, row))


def paint_teeth(grid, rect, light, side, rng):
    """A ragged double row of teeth hugging one edge of a face."""
    x, y, w, h = rect
    if w < 2 or h < 2:
        return
    for col in range(x, x + w):
        length = 1 if (col - x) % 2 == 0 else min(2, h)
        if rng.random() < 0.18:
            length = min(length + 1, h)
        for step in range(length):
            row = y + step if side == "top" else y + h - 1 - step
            tone = TOOTH if step == 0 else TOOTH_SHADE
            put(grid, col, row, shade(tone, light, rng.randint(-6, 6)))


def paint_oral_disc(grid, rect, light, half, rng):
    """Half of a lamprey-style mouth: a black throat ringed with teeth.

    `half` is "upper" or "lower". The two halves are painted as mirror images
    so that, with the jaws closed, the pair reads as one continuous ring of
    teeth around a hole - which is the single feature that has to survive
    being viewed from three blocks away on a phone.
    """
    palette = PALETTES["maw"]
    x, y, w, h = rect
    fill(grid, rect, shade(palette["dark"], light))

    # Wet throat: a little variation so the hole is not a flat black rectangle.
    for row in range(y, y + h):
        for col in range(x, x + w):
            if rng.random() < 0.22:
                put(grid, col, row, shade(palette["base"], light, rng.randint(-6, 6)))

    inner_row = y + h - 1 if half == "upper" else y
    outer_row = y if half == "upper" else y + h - 1

    # Outer rim and the two sides: a thin gum line holding the ring together.
    for col in range(x, x + w):
        put(grid, col, outer_row, shade(palette["light"], light, rng.randint(-8, 8)))
    for row in range(y, y + h):
        for col in (x, x + w - 1):
            tone = TOOTH if (row + col) % 2 == 0 else palette["light"]
            put(grid, col, row, shade(tone, light, rng.randint(-8, 8)))

    # The teeth themselves, biting inward toward the gap between the jaws.
    step = -1 if half == "upper" else 1
    for col in range(x, x + w):
        length = 2 if (col - x) % 2 == 0 else 1
        if rng.random() < 0.2:
            length += 1
        for depth in range(min(length, h - 1)):
            row = inner_row + step * depth
            tone = TOOTH if depth == 0 else TOOTH_SHADE
            put(grid, col, row, shade(tone, light, rng.randint(-6, 6)))


def paint_pustule(grid, rect, palette, light, rng):
    """A wet-looking blister: dark rim, bright bloom, one specular pixel."""
    x, y, w, h = rect
    cx = x + (w - 1) / 2.0
    cy = y + (h - 1) / 2.0
    radius = max(w, h) / 2.0
    for row in range(y, y + h):
        for col in range(x, x + w):
            dist = ((col - cx) ** 2 + (row - cy) ** 2) ** 0.5
            if dist > radius * 0.78:
                tone = palette["dark"]
            elif dist > radius * 0.42:
                tone = palette["base"]
            else:
                tone = palette["light"]
            put(grid, col, row, shade(tone, light, rng.randint(-6, 6)))
    if w >= 3 and h >= 3:
        put(grid, x + 1, y + 1, shade((255, 255, 220), light))


def paint_eye(grid, rect, light, rng, big):
    """Milky sclera; the front and top faces get a bloodshot iris."""
    palette = PALETTES["eye"]
    paint_base(grid, rect, palette, light, rng)
    paint_veins(grid, rect, palette, light, rng, 0.10)
    if not big:
        return
    # An ellipse rather than a square, sized off the face so the iris fills
    # most of it - a two-pixel iris on a six-pixel face reads as a speck.
    x, y, w, h = rect
    cx = (w - 1) / 2.0
    cy = (h - 1) / 2.0
    rx = max(0.9, w * 0.42)
    ry = max(0.9, h * 0.42)
    for row in range(h):
        for col in range(w):
            ex = (col - cx) / rx
            ey = (row - cy) / ry
            reach = ex * ex + ey * ey
            if reach <= 1.0:
                put(grid, x + col, y + row, shade(IRIS, light, rng.randint(-10, 10)))
            elif reach <= 1.5 and rng.random() < 0.4:
                put(grid, x + col, y + row, shade(palette["deep"], light, rng.randint(-8, 8)))

    # Slit pupil, and a single wet highlight off to one side.
    for row in range(h):
        if abs(row - cy) <= max(0.5, h * 0.3):
            put(grid, x + int(round(cx)), y + row, PUPIL + (255, ))
    if w >= 4 and h >= 3:
        put(grid, x + max(1, int(cx) - 1), y + 1, shade((255, 250, 240), light))


def paint_face(grid, rect, role, face, rng):
    light = FACE_LIGHT[face]

    if role == "eye":
        # The bulging blind eye only shows an iris where it can be seen.
        paint_eye(grid, rect, light, rng, big=face in ("north", "up"))
        return

    if role == "boil":
        paint_pustule(grid, rect, PALETTES["boil"], light, rng)
        return

    if role in ("maw_upper", "maw_lower"):
        palette = PALETTES["maw"]
        half = "upper" if role == "maw_upper" else "lower"
        inward = "down" if role == "maw_upper" else "up"
        gum_side = "bottom" if role == "maw_upper" else "top"
        if face == "north":
            # The face you see coming at you.
            paint_oral_disc(grid, rect, light, half, rng)
            return
        paint_base(grid, rect, palette, light, rng)
        paint_veins(grid, rect, palette, light, rng, 0.14)
        if face == inward:
            # The surface that faces into the throat is all teeth.
            x, y, w, h = rect
            for row in range(y, y + h):
                for col in range(x, x + w):
                    if (col + row) % 2 == 0:
                        put(grid, col, row, shade(TOOTH, light, rng.randint(-10, 10)))
                    elif rng.random() < 0.3:
                        put(
                            grid, col, row, shade(TOOTH_SHADE, light, rng.randint(-8, 8))
                        )
        elif face in ("east", "west"):
            paint_teeth(grid, rect, light, gum_side, rng)
        return

    palette = PALETTES[role]
    paint_base(grid, rect, palette, light, rng)
    paint_veins(grid, rect, palette, light, rng, 0.22 if role == "flesh" else 0.08)


def build_texture(placement):
    grid = new_grid(ATLAS, ATLAS)
    for _bone, cubes in sorted(CUBES.items()):
        for name, _origin, size, role, _inflate in cubes:
            u, v = placement[name]
            rng = random.Random(f"bloatgrub::{name}")
            for face, rect in uv_faces(u, v, size).items():
                if rect[2] <= 0 or rect[3] <= 0:
                    continue
                paint_face(grid, rect, role, face, rng)
    return grid


# ==========================================================================
# Item icons
# ==========================================================================

ICON_PALETTE = {
    ".": (22, 15, 17, 255),      # outline
    "f": (188, 166, 158, 255),   # flesh
    "F": (216, 200, 192, 255),   # flesh highlight
    "s": (138, 116, 114, 255),   # flesh shadow
    "v": (112, 44, 50, 255),     # vein
    "c": (58, 48, 44, 255),      # chitin
    "C": (100, 86, 72, 255),     # chitin highlight
    "m": (44, 14, 18, 255),      # maw
    "M": (86, 22, 28, 255),      # maw wet
    "t": (234, 226, 202, 255),   # tooth
    "e": (176, 26, 28, 255),     # eye
    "E": (240, 120, 110, 255),   # eye glint
    "b": (170, 172, 78, 255),    # boil
    "B": (226, 228, 150, 255),   # boil highlight
    "g": (140, 186, 194, 160),   # glass
    "G": (200, 232, 236, 190),   # glass highlight
    "l": (78, 118, 126, 255),    # glass rim
    "k": (112, 112, 122, 255),   # metal
    "K": (178, 178, 190, 255),   # metal highlight
    "n": (206, 210, 220, 255),   # needle
    "a": (96, 214, 88, 255),     # serum
    "A": (176, 252, 148, 255),   # serum highlight
    "d": (40, 128, 46, 255),     # serum shadow
}

# A dormant grub, coiled tight. Pale sac, sickly boils along the back, a ring
# of teeth where the head tucks in, and one filmy eye that is still watching.
DORMANT_GRUB = [
    "                ",
    "     ......     ",
    "   ..ffffff..   ",
    "  .sfFFFFFFfs.  ",
    " .bfFf.eEe.fFs. ",
    " .Bbf.veEev.fFs.",
    ".bBFf.mtmtm.fFf.",
    ".Bbff.tmMmt.ffs.",
    ".bBFf.mtmtm.fFf.",
    " .Bbfv.mtm.vfFs.",
    " .sfFf.....fFf. ",
    "  .sfFFffFFfs.  ",
    "  c..ffffff..   ",
    " cC ..ssss..    ",
    "cC     ..       ",
    "                ",
]

# The same animal, sealed in a jar. It is pressed against the glass.
GRUB_JAR = [
    "                ",
    "    .kkkkkk.    ",
    "    .KKkkKK.    ",
    "    .kkkkkk.    ",
    "   .lGgggggl.   ",
    "  .lG..ff..Gl.  ",
    "  .lg.fFFf.gl.  ",
    "  .lg.fFfv.gl.  ",
    "  .lG.mtte.Gl.  ",
    "  .lg.mtt..gl.  ",
    "  .lg.sffs.gl.  ",
    "  .lG.ffff.Gl.  ",
    "  .lgg....ggl.  ",
    "  .lGgggggGl.   ",
    "   .llllll.     ",
    "                ",
]

# Purge serum: a crude syringe of caustic green. Cuts the thing out of you.
PURGE_SERUM = [
    "            .n. ",
    "           .nn. ",
    "          .nn.  ",
    "         .nn.   ",
    "       ..KK.    ",
    "      .KAAK.    ",
    "     .KAaaAK.   ",
    "    .KAaadaK.   ",
    "   .KAaadaK.    ",
    "   .KaadaaK.    ",
    "  .KAaadaK.     ",
    "  .KaadaK.      ",
    " .kKaaaKk.      ",
    " .kKKKKk.       ",
    ".kkKk.k.        ",
    ".kk.            ",
]

ICONS = {
    "dormant_bloatgrub": DORMANT_GRUB,
    "grub_jar": GRUB_JAR,
    "purge_serum": PURGE_SERUM,
}

# 16x16 face used for both pack icons, upscaled 4x.
PACK_FACE = [
    "                ",
    "  cc        cc  ",
    " cCc  cccc  cCc ",
    " cc  cCCCCc  cc ",
    "    cCffffCc    ",
    "   cCfFFFFfCc   ",
    "  cCfFeEEefFCc  ",
    "  cffFeEEefFfc  ",
    "  cfFfFeeFfFfc  ",
    "  cfsmmmmmmsfc  ",
    "  cfmtmtmtmtmc  ",
    "  csmmtmmtmmsc  ",
    "   cfmmmmmmfc   ",
    "    ccffffcc    ",
    "  cc  cccc  cc  ",
    " cCc        cCc ",
]


# ==========================================================================
# Animations
# ==========================================================================
#
# Generated from the same BONES table as the geometry, so an animation can
# never reference a bone that the model does not have. Motion is expressed as
# Molang over query.anim_time; both clips loop, and the client entity blends
# `walk` in on top of `idle` whenever the creature is moving.


def leg_bones():
    """[(thigh, shin, gait_phase_degrees)] - alternating tripod gait."""
    out = []
    for index in range(len(LEG_Z)):
        for side, offset in (("l", 0), ("r", 180)):
            # Adjacent legs on the same side are in antiphase, and the two
            # sides are swapped, which is what makes it a tripod crawl.
            phase = (offset + index * 180) % 360
            out.append((f"thigh_{side}{index}", f"shin_{side}{index}", phase, side))
    return out


def build_animations():
    idle_bones = {
        "body": {
            "position": [0, "math.sin(query.anim_time * 110) * 0.45", 0],
            "rotation": ["math.sin(query.anim_time * 110 + 30) * 1.8", 0, 0],
        },
        "thorax": {
            "rotation": ["math.sin(query.anim_time * 110 + 70) * 2.5", 0, 0],
        },
        "head": {
            "rotation": [
                "math.sin(query.anim_time * 90) * 4",
                "math.sin(query.anim_time * 41) * 7",
                "math.sin(query.anim_time * 63) * 3",
            ],
        },
        # A mouth that never stops working, even at rest.
        "jaw_lower": {
            "rotation": ["14 + math.sin(query.anim_time * 290) * 13", 0, 0],
        },
        "jaw_upper": {
            "rotation": ["-9 - math.sin(query.anim_time * 290) * 8", 0, 0],
        },
        "tail": {
            "rotation": [
                "22 + math.sin(query.anim_time * 85) * 9",
                "math.sin(query.anim_time * 67) * 10",
                0,
            ],
        },
        "tail_tip": {
            "rotation": [
                "math.sin(query.anim_time * 85 + 55) * 16",
                "math.sin(query.anim_time * 67 + 40) * 14",
                0,
            ],
        },
    }
    for thigh, shin, phase, side in leg_bones():
        sign = -1 if side == "l" else 1
        idle_bones[thigh] = {
            "rotation": [f"math.sin(query.anim_time * 130 + {phase}) * 2.5", 0, 0]
        }
        idle_bones[shin] = {
            "rotation": [
                0,
                0,
                f"{sign * 4} + math.sin(query.anim_time * 130 + {phase + 40}) * 3",
            ]
        }

    walk_bones = {
        "body": {
            "position": [0, "math.abs(math.cos(query.anim_time * 640)) * 0.6", 0],
            "rotation": [0, 0, "math.cos(query.anim_time * 640) * 3.5"],
        },
        "head": {
            "rotation": ["math.cos(query.anim_time * 640 + 90) * 5", 0, 0],
        },
        "jaw_lower": {
            "rotation": ["20 + math.sin(query.anim_time * 620) * 16", 0, 0],
        },
        "jaw_upper": {
            "rotation": ["-14 - math.sin(query.anim_time * 620) * 10", 0, 0],
        },
        "tail": {
            "rotation": [0, "math.sin(query.anim_time * 320) * 20", 0],
        },
        "tail_tip": {
            "rotation": [0, "math.sin(query.anim_time * 320 + 70) * 26", 0],
        },
    }
    for thigh, shin, phase, side in leg_bones():
        sign = -1 if side == "l" else 1
        walk_bones[thigh] = {
            "rotation": [f"math.cos(query.anim_time * 640 + {phase}) * 28", 0, 0]
        }
        walk_bones[shin] = {
            "rotation": [
                f"math.cos(query.anim_time * 640 + {phase + 55}) * -22",
                0,
                f"{sign * 6}",
            ]
        }

    return {
        "format_version": "1.8.0",
        "animations": {
            "animation.bloatgrub.idle": {
                "loop": True,
                "animation_length": 3.0,
                "bones": idle_bones,
            },
            "animation.bloatgrub.walk": {
                "loop": True,
                "animation_length": 1.125,
                "bones": walk_bones,
            },
        },
    }


def preview(art):
    return "\n".join(art)


def preview_grid(grid):
    ramp = " .:-=+*#%@"
    lines = []
    for row in grid:
        line = []
        for r, g, b, a in row:
            if a == 0:
                line.append(" ")
            else:
                level = int(((r + g + b) / 3.0) / 256.0 * (len(ramp) - 1))
                line.append(ramp[level])
        lines.append("".join(line))
    return "\n".join(lines)


# ==========================================================================
# Entry point
# ==========================================================================

def main():
    show = "--preview" in sys.argv

    for directory in (
        os.path.join(RP, "models", "entity"),
        os.path.join(RP, "textures", "entity"),
        os.path.join(RP, "textures", "items"),
        BP,
    ):
        os.makedirs(directory, exist_ok=True)

    placement = pack_atlas()

    geometry = build_geometry(placement)
    geo_path = os.path.join(RP, "models", "entity", "bloatgrub.geo.json")
    with open(geo_path, "w", encoding="utf-8") as handle:
        json.dump(geometry, handle, indent=2)
        handle.write("\n")

    animations = build_animations()
    anim_path = os.path.join(RP, "animations", "bloatgrub.animation.json")
    os.makedirs(os.path.dirname(anim_path), exist_ok=True)
    with open(anim_path, "w", encoding="utf-8") as handle:
        json.dump(animations, handle, indent=2)
        handle.write("\n")

    texture = build_texture(placement)
    write_png(os.path.join(RP, "textures", "entity", "bloatgrub.png"), texture)

    for name, art in ICONS.items():
        grid = from_ascii(art, ICON_PALETTE)
        write_png(os.path.join(RP, "textures", "items", f"{name}.png"), grid)
        if show:
            print(f"\n=== {name} ===")
            print(preview(art))

    face = from_ascii(PACK_FACE, ICON_PALETTE)
    backdrop = (18, 14, 16, 255)
    for row in range(len(face)):
        for col in range(len(face[0])):
            if face[row][col] == TRANSPARENT:
                face[row][col] = backdrop
    pack_icon = scale_nearest(face, 4)
    for path in (
        os.path.join(BP, "pack_icon.png"),
        os.path.join(RP, "pack_icon.png"),
    ):
        write_png(path, pack_icon)

    cube_count = sum(len(cubes) for cubes in CUBES.values())
    used = sum(
        uv_footprint(size)[0] * uv_footprint(size)[1]
        for cubes in CUBES.values()
        for _n, _o, size, _r, _i in cubes
    )
    print(
        f"Wrote {GEOMETRY_ID} ({len(BONES)} bones, {cube_count} cubes), "
        f"{ATLAS}x{ATLAS} entity texture ({used} of {ATLAS * ATLAS} px used), "
        f"{len(ICONS)} item icons, 2 pack icons, "
        f"{len(animations['animations'])} animations."
    )

    if show:
        print("\n=== entity atlas ===")
        print(preview_grid(texture))


if __name__ == "__main__":
    main()
