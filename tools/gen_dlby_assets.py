#!/usr/bin/env python3
"""Generate The Follower's geometry, texture and pack icons.

The cube table below is the single source of truth: the same entries drive the
Bedrock box-UV layout written into follower.geo.json and the pixels painted into
follower.png, so the model and its skin can never drift apart.

Pure standard library (zlib + struct) so the pack rebuilds anywhere.

Usage:  python3 tools/gen_dlby_assets.py
"""

import json
import os
import struct
import zlib

RP = os.path.join("resource_packs", "dlby_rp")
BP = os.path.join("behavior_packs", "dlby_bp")

TEX_W = TEX_H = 64

# --------------------------------------------------------------------------
# Deterministic noise so rebuilds are byte-identical.
# --------------------------------------------------------------------------

class Rand:
    def __init__(self, seed):
        self.s = seed & 0xFFFFFFFF

    def next(self):
        # xorshift32
        s = self.s
        s ^= (s << 13) & 0xFFFFFFFF
        s ^= s >> 17
        s ^= (s << 5) & 0xFFFFFFFF
        self.s = s & 0xFFFFFFFF
        return self.s

    def chance(self, pct):
        return (self.next() % 100) < pct


# --------------------------------------------------------------------------
# PNG output
# --------------------------------------------------------------------------

def write_png(path, pixels, width, height):
    raw = b"".join(
        b"\x00" + bytes(c for px in row for c in px) for row in pixels
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


def blank(width, height):
    return [[(0, 0, 0, 0)] * width for _ in range(height)]


# --------------------------------------------------------------------------
# Palette
# --------------------------------------------------------------------------

BODY = (10, 10, 13, 255)
BODY_HI = (16, 16, 21, 255)
BODY_LO = (5, 5, 7, 255)
HAND = (24, 23, 28, 255)
HAND_HI = (34, 33, 40, 255)
FACE = (201, 195, 186, 255)
FACE_HI = (223, 218, 210, 255)
FACE_LO = (163, 156, 147, 255)
FACE_EDGE = (96, 92, 88, 255)
EYE = (11, 9, 12, 255)
MOUTH = (58, 52, 50, 255)


# --------------------------------------------------------------------------
# Cube table.  (name, bone, origin, size, uv)
# Units are 1/16 block.  The entity stands with its feet at y = 0.
# --------------------------------------------------------------------------

CUBES = [
    ("leg_right",  "leg_right",        [-4.0,  0.0, -1.5], [3, 24, 3], [22, 29]),
    ("leg_left",   "leg_left",         [ 1.0,  0.0, -1.5], [3, 24, 3], [34, 29]),
    ("torso",      "torso",            [-3.5, 24.0, -2.0], [7, 15, 4], [ 0, 29]),
    ("neck",       "neck",             [-1.5, 38.0, -1.5], [3,  5, 3], [48, 14]),
    ("head",       "head",             [-3.5, 42.5, -3.5], [7,  7, 7], [ 0,  0]),
    ("arm_ru",     "arm_right_upper",  [-6.5, 26.0, -1.5], [3, 12, 3], [ 0, 14]),
    ("arm_rl",     "arm_right_lower",  [-6.5, 14.0, -1.5], [3, 12, 3], [12, 14]),
    ("hand_r",     "hand_right",       [-7.0,  7.0, -2.5], [4,  7, 5], [28,  0]),
    ("arm_lu",     "arm_left_upper",   [ 3.5, 26.0, -1.5], [3, 12, 3], [24, 14]),
    ("arm_ll",     "arm_left_lower",   [ 3.5, 14.0, -1.5], [3, 12, 3], [36, 14]),
    ("hand_l",     "hand_left",        [ 3.0,  7.0, -2.5], [4,  7, 5], [46,  0]),
]

# Bone graph: name -> (parent, pivot, baked rotation)
# The baked rotations are the permanent crooked posture: the torso hunches
# forward, the neck cranes the head back up, and the two arms hang at very
# slightly different angles so the silhouette is never symmetrical.
BONES = [
    ("root",             None,               [0.0,  0.0, 0.0],  None),
    ("leg_right",        "root",             [-2.5, 24.0, 0.0], [-2.0, 0.0, 1.0]),
    ("leg_left",         "root",             [2.5, 24.0, 0.0],  [2.0, 0.0, -1.0]),
    ("waist",            "root",             [0.0, 24.0, 0.0],  [14.0, 0.0, 3.0]),
    ("torso",            "waist",            [0.0, 24.0, 0.0],  None),
    ("neck",             "torso",            [0.0, 38.0, 0.0],  [-18.0, 0.0, -5.0]),
    ("head",             "neck",             [0.0, 42.5, 0.0],  None),
    ("arm_right_upper",  "torso",            [-5.0, 37.5, 0.0], [-7.0, 0.0, -4.0]),
    ("arm_right_lower",  "arm_right_upper",  [-5.0, 26.0, 0.0], [10.0, 0.0, 2.0]),
    ("hand_right",       "arm_right_lower",  [-5.0, 14.0, 0.0], [6.0, 0.0, 0.0]),
    ("arm_left_upper",   "torso",            [5.0, 37.5, 0.0],  [-3.0, 0.0, 6.0]),
    ("arm_left_lower",   "arm_left_upper",   [5.0, 26.0, 0.0],  [13.0, 0.0, -3.0]),
    ("hand_left",        "arm_left_lower",   [5.0, 14.0, 0.0],  [4.0, 0.0, 0.0]),
]


def faces(uv, size):
    """Bedrock box-UV face rectangles for a cube.

    Mirrors the vanilla layout, verified against the player head (cube size
    8/8/8 at uv 0,0 puts the face at 8,8):

        (u+d, v)      top     w x d
        (u+d+w, v)    bottom  w x d
        (u, v+d)      east    d x h
        (u+d, v+d)    north   w x h   <- the "front" of the model
        (u+d+w, v+d)  west    d x h
        (u+2d+w, v+d) south   w x h
    """
    u, v = uv
    w, h, d = size
    return {
        "top":    (u + d,          v,     w, d),
        "bottom": (u + d + w,      v,     w, d),
        "east":   (u,              v + d, d, h),
        "north":  (u + d,          v + d, w, h),
        "west":   (u + d + w,      v + d, d, h),
        "south":  (u + 2 * d + w,  v + d, w, h),
    }


# --------------------------------------------------------------------------
# Geometry
# --------------------------------------------------------------------------

def build_geometry():
    by_bone = {}
    for _name, bone, origin, size, uv in CUBES:
        by_bone.setdefault(bone, []).append(
            {"origin": origin, "size": size, "uv": uv}
        )

    bones = []
    for name, parent, pivot, rotation in BONES:
        bone = {"name": name, "pivot": pivot}
        if parent:
            bone["parent"] = parent
        if rotation:
            bone["rotation"] = rotation
        if name in by_bone:
            bone["cubes"] = by_bone[name]
        bones.append(bone)

    return {
        "format_version": "1.12.0",
        "minecraft:geometry": [
            {
                "description": {
                    "identifier": "geometry.dlby_follower",
                    "texture_width": TEX_W,
                    "texture_height": TEX_H,
                    "visible_bounds_width": 3,
                    "visible_bounds_height": 4,
                    "visible_bounds_offset": [0, 1.6, 0],
                },
                "bones": bones,
            }
        ],
    }


# --------------------------------------------------------------------------
# Texture
# --------------------------------------------------------------------------

def fill(px, rect, colour):
    x, y, w, h = rect
    for j in range(int(y), int(y + h)):
        for i in range(int(x), int(x + w)):
            px[j][i] = colour


def paint_body(px, rect, rng, base, hi, lo):
    """Flat base colour plus sparse single-pixel grain.

    The Follower is meant to read as a near-black silhouette, so the grain is
    only a couple of shades wide - just enough that the body does not look like
    a flat vector shape under torchlight.
    """
    x, y, w, h = rect
    for j in range(int(y), int(y + h)):
        for i in range(int(x), int(x + w)):
            roll = rng.next() % 100
            if roll < 8:
                px[j][i] = hi
            elif roll < 20:
                px[j][i] = lo
            else:
                px[j][i] = base


def paint_face(px, rect, rng):
    """The pale face on the head's north (front) slot.

    A 7x7 face: pale mask inset from the edges so the black head reads as a
    hood around it, two 1px eyes set wide and low, and a barely-there mouth.
    """
    x, y, w, h = rect
    x, y = int(x), int(y)

    # Dark head all over first, so the corners stay black.
    paint_body(px, rect, rng, BODY, BODY_HI, BODY_LO)

    # Pale mask: a tall oval, 5 wide, inset 1px left/right.
    mask = [
        "..###..",
        ".#####.",
        "#######",
        "#######",
        "#######",
        ".#####.",
        "..###..",
    ]
    for j in range(7):
        for i in range(7):
            if mask[j][i] != "#":
                continue
            edge = mask[j][max(0, i - 1)] != "#" or mask[j][min(6, i + 1)] != "#"
            if edge:
                px[y + j][x + i] = FACE_EDGE
            elif j <= 1:
                px[y + j][x + i] = FACE_HI
            elif j >= 5:
                px[y + j][x + i] = FACE_LO
            else:
                px[y + j][x + i] = FACE if rng.chance(80) else FACE_LO

    # Tiny dark eyes, set wide and slightly sunken.
    for ex in (1, 5):
        px[y + 3][x + ex] = EYE
        px[y + 2][x + ex] = FACE_LO

    # A single dark pixel where a mouth should be. Barely visible - the face is
    # more disturbing when you cannot quite resolve it.
    px[y + 5][x + 3] = MOUTH


def build_texture():
    rng = Rand(0xF0110E4)
    px = blank(TEX_W, TEX_H)

    for name, _bone, _origin, size, uv in CUBES:
        rect_set = faces(uv, size)
        hand = name.startswith("hand_")
        base, hi, lo = (HAND, HAND_HI, BODY) if hand else (BODY, BODY_HI, BODY_LO)
        for side, rect in rect_set.items():
            if name == "head" and side == "north":
                paint_face(px, rect, rng)
            else:
                paint_body(px, rect, rng, base, hi, lo)

    # Faint pale bleed onto the head sides next to the face, so the mask reads
    # as wrapping around the skull instead of being a decal.
    head = faces([0, 0], [7, 7, 7])
    ex, ey, ew, _eh = head["east"]
    wx, wy, _ww, _wh = head["west"]
    for j in range(2, 6):
        px[int(ey) + j][int(ex) + int(ew) - 1] = FACE_EDGE
        px[int(wy) + j][int(wx)] = FACE_EDGE

    return px


# --------------------------------------------------------------------------
# Item icon + pack icons
# --------------------------------------------------------------------------

def build_eye_icon():
    """16x16 Follower's Eye: a pale sclera, a slit pupil, dark veins."""
    rng = Rand(0x0E4E)
    px = blank(16, 16)
    cx = cy = 7.5
    for y in range(16):
        for x in range(16):
            dx, dy = (x - cx) / 7.0, (y - cy) / 5.0
            r = dx * dx + dy * dy
            if r > 1.0:
                continue
            if r > 0.82:
                px[y][x] = (28, 26, 30, 255)
            elif r > 0.5:
                px[y][x] = FACE_LO if rng.chance(35) else FACE
            else:
                px[y][x] = FACE_HI if rng.chance(25) else FACE
    # Iris + slit pupil.
    for y in range(4, 12):
        for x in range(5, 11):
            dx, dy = (x - cx) / 3.0, (y - cy) / 3.6
            if dx * dx + dy * dy <= 1.0:
                px[y][x] = (22, 20, 26, 255) if rng.chance(70) else (36, 33, 42, 255)
    for y in range(4, 12):
        px[y][7] = (4, 4, 6, 255)
        px[y][8] = (4, 4, 6, 255)
    # Veins reaching in from the corners.
    for x, y in ((2, 7), (3, 6), (4, 6), (13, 8), (12, 9), (11, 9), (3, 9), (12, 6)):
        if px[y][x][3]:
            px[y][x] = (150, 96, 96, 255)
    return px


def build_pack_icon(accent):
    """64x64 icon: the silhouette standing in a dark doorway."""
    rng = Rand(0xDEAD ^ accent)
    px = blank(64, 64)
    for y in range(64):
        for x in range(64):
            v = 8 + (y * 10) // 64
            px[y][x] = (v, v, v + 3, 255)

    # Doorway of slightly lighter dark.
    for y in range(6, 64):
        for x in range(14, 50):
            px[y][x] = (18, 18, 23, 255) if rng.chance(88) else (22, 22, 28, 255)

    # Tall thin body.
    for y in range(20, 60):
        for x in range(28, 36):
            px[y][x] = BODY
    # Long arms.
    for y in range(26, 54):
        for x in (25, 26, 37, 38):
            px[y][x] = BODY
    # Oversized hands.
    for y in range(52, 58):
        for x in list(range(23, 28)) + list(range(36, 41)):
            px[y][x] = HAND
    # Head with its pale face.
    for y in range(11, 21):
        for x in range(27, 37):
            px[y][x] = BODY
    for y in range(13, 20):
        for x in range(29, 35):
            px[y][x] = FACE if rng.chance(80) else FACE_LO
    for x in (30, 33):
        px[16][x] = EYE
    return px


# --------------------------------------------------------------------------

def main():
    geo_path = os.path.join(RP, "models", "entity", "follower.geo.json")
    os.makedirs(os.path.dirname(geo_path), exist_ok=True)
    with open(geo_path, "w", encoding="utf-8") as handle:
        json.dump(build_geometry(), handle, indent=2)
        handle.write("\n")
    print("wrote", geo_path)

    tex_path = os.path.join(RP, "textures", "entity", "follower.png")
    write_png(tex_path, build_texture(), TEX_W, TEX_H)
    print("wrote", tex_path, f"({TEX_W}x{TEX_H})")

    eye_path = os.path.join(RP, "textures", "items", "followers_eye.png")
    write_png(eye_path, build_eye_icon(), 16, 16)
    print("wrote", eye_path)

    for root, accent in ((RP, 1), (BP, 2)):
        icon = os.path.join(root, "pack_icon.png")
        write_png(icon, build_pack_icon(accent), 64, 64)
        print("wrote", icon)


if __name__ == "__main__":
    main()
