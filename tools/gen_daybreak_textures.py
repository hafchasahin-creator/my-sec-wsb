#!/usr/bin/env python3
"""Paint every PNG the Daybreak add-on ships.

Pure standard library (zlib + struct), so the pack rebuilds anywhere without
image tooling. Entity skins are painted straight onto the UV rectangles that
`daybreak_models.py` hands to the geometry writer, which keeps skins and models
in lockstep.

Usage:  python3 tools/gen_daybreak_textures.py
"""

import math
import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from daybreak_models import MODELS, PALETTES, TEXTURE_SKINS, cube_faces  # noqa: E402

RP = os.path.join("resource_packs", "daybreak_rp")
BP = os.path.join("behavior_packs", "daybreak_bp")

CLEAR = (0, 0, 0, 0)


# --------------------------------------------------------------------------
# PNG plumbing
# --------------------------------------------------------------------------

class Grid:
    def __init__(self, width, height, fill=CLEAR):
        self.w = width
        self.h = height
        self.px = [[fill for _ in range(width)] for _ in range(height)]

    def set(self, x, y, colour):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[y][x] = colour if len(colour) == 4 else (*colour, 255)

    def get(self, x, y):
        if 0 <= x < self.w and 0 <= y < self.h:
            return self.px[y][x]
        return CLEAR

    def rect(self, x0, y0, x1, y1, colour):
        for y in range(int(y0), int(y1) + 1):
            for x in range(int(x0), int(x1) + 1):
                self.set(x, y, colour)


def write_png(path, grid):
    raw = b"".join(
        b"\x00" + bytes(channel for px in row for channel in px) for row in grid.px
    )

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    blob = b"\x89PNG\r\n\x1a\n"
    blob += chunk(b"IHDR", struct.pack(">IIBBBBB", grid.w, grid.h, 8, 6, 0, 0, 0))
    blob += chunk(b"IDAT", zlib.compress(raw, 9))
    blob += chunk(b"IEND", b"")

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(blob)


class Rand:
    """Small deterministic LCG - identical output on every machine."""

    def __init__(self, seed):
        self.state = (seed ^ 0x9E3779B9) & 0xFFFFFFFF

    def next(self):
        self.state = (self.state * 1664525 + 1013904223) & 0xFFFFFFFF
        return self.state

    def rand(self):
        return self.next() / 0xFFFFFFFF

    def between(self, low, high):
        return low + (high - low) * self.rand()

    def chance(self, probability):
        return self.rand() < probability


def seed_of(text):
    value = 0
    for character in text:
        value = (value * 131 + ord(character)) & 0xFFFFFFFF
    return value


def shade(colour, amount):
    """amount < 1 darkens, > 1 lightens."""
    return tuple(max(0, min(255, int(channel * amount))) for channel in colour[:3])


def mix(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


# --------------------------------------------------------------------------
# Entity skins
# --------------------------------------------------------------------------

FACE_LIGHT = {"top": 1.18, "bottom": 0.62, "front": 1.0, "back": 0.82, "left": 0.9, "right": 0.9}

# Bones that should be painted with the palette's "accent" (skin/bone) colour.
SKIN_BONES = {
    "survivor": {"head"},
    "melted_survivor": set(),
    "flesh_mass": set(),
    "crawling_melt": set(),
    "assimilator": {"head"},
    "flare": set(),
}


def paint_model_onto(grid, name, model_key, palette_key, rng):
    model = MODELS[model_key]
    palette = PALETTES[palette_key]
    organic = palette_key in (
        "melted_survivor", "flesh_mass", "crawling_melt", "assimilator"
    )

    for bone_def in model["bones"]:
        skinned = bone_def["name"] in SKIN_BONES.get(model_key, set())
        base = palette["accent"] if skinned else palette["base"]
        dark = shade(palette["dark"], 1.0) if not skinned else shade(base, 0.7)
        light = palette["light"] if not skinned else shade(base, 1.15)

        for shape in bone_def["cubes"]:
            for face, x0, y0, fw, fh in cube_faces(shape):
                lighting = FACE_LIGHT[face]
                for y in range(y0, y0 + fh):
                    for x in range(x0, x0 + fw):
                        tone = rng.between(-0.14, 0.14)
                        colour = mix(base, light if tone > 0 else dark, abs(tone) * 2.4)
                        colour = shade(colour, lighting + rng.between(-0.05, 0.05))
                        grid.set(x, y, colour)

                # Organic detail: dark pores, pale bone streaks, wet highlights.
                if organic:
                    for _ in range(max(1, (fw * fh) // 9)):
                        x = int(rng.between(x0, x0 + fw))
                        y = int(rng.between(y0, y0 + fh))
                        if rng.chance(0.45):
                            grid.set(x, y, shade(palette["void"], rng.between(0.8, 1.3)))
                        elif rng.chance(0.35):
                            grid.set(x, y, shade(palette["accent"], rng.between(0.7, 1.0)))
                        else:
                            grid.set(x, y, shade(palette["light"], rng.between(1.0, 1.25)))
                    # Runny drips down the front faces.
                    if face == "front" and fh >= 6:
                        for _ in range(max(1, fw // 3)):
                            x = int(rng.between(x0, x0 + fw))
                            run = int(rng.between(2, max(3, fh - 1)))
                            for y in range(y0 + fh - run, y0 + fh):
                                grid.set(x, y, shade(palette["dark"], rng.between(0.85, 1.1)))

    _paint_clothing(grid, name, model, palette, rng)
    _paint_face(grid, model, palette, rng)
    return grid


def paint_entity(name, model_key, palette_key):
    width, height = MODELS[model_key]["texture"]
    grid = Grid(width, height)
    return paint_model_onto(grid, name, model_key, palette_key, Rand(seed_of(name)))


def _front_rect(model, bone_name, cube_index):
    for bone_def in model["bones"]:
        if bone_def["name"] != bone_name:
            continue
        shape = bone_def["cubes"][cube_index]
        for face, x0, y0, fw, fh in cube_faces(shape):
            if face == "front":
                return x0, y0, fw, fh
    return None


def _paint_face(grid, model, palette, rng):
    spec = model.get("face")
    if not spec:
        return
    rect = _front_rect(model, spec["bone"], spec["cube"])
    if not rect:
        return
    x0, y0, fw, fh = rect
    style = spec.get("style")
    if not style:
        return
    void = palette["void"]
    accent = palette["accent"]

    if style == "human":
        eye_y = y0 + fh // 2
        for dx in (fw // 4 - 1, fw - fw // 4):
            grid.rect(x0 + dx, eye_y, x0 + dx, eye_y, void)
            grid.set(x0 + dx, eye_y - 1, shade(void, 1.6))
        grid.rect(x0 + fw // 3, y0 + fh - 2, x0 + fw - fw // 3, y0 + fh - 2, shade(void, 1.3))
        # Hairline across the top of the head.
        grid.rect(x0, y0, x0 + fw - 1, y0 + max(1, fh // 4) - 1, shade(void, 1.1))
    elif style == "melted":
        # Two uneven hollows where eyes used to be, and a torn grin.
        for index, dx in enumerate((fw // 5, fw - fw // 3)):
            top = y0 + fh // 3 + (index % 2)
            grid.rect(x0 + dx, top, x0 + dx + 1, top + 1, shade(void, 0.9))
            grid.set(x0 + dx, top + 2, shade(void, 1.5))
        grin = y0 + fh - max(2, fh // 4)
        for x in range(x0 + 1, x0 + fw - 1):
            grid.set(x, grin, shade(void, 0.8))
            if (x - x0) % 2 == 0:
                grid.set(x, grin + 1 if grin + 1 < y0 + fh else grin, accent)
    elif style == "maw":
        grid.rect(x0 + 1, y0 + 1, x0 + fw - 2, y0 + fh - 2, shade(void, 0.8))
        for x in range(x0 + 1, x0 + fw - 1):
            if (x - x0) % 2 == 1:
                grid.set(x, y0 + 1, accent)
                grid.set(x, y0 + fh - 2, accent)
        for _ in range(3):
            grid.set(
                int(rng.between(x0 + 1, x0 + fw - 1)),
                int(rng.between(y0 + 2, y0 + fh - 2)),
                shade(palette["light"], 1.1),
            )


def _paint_clothing(grid, name, model, palette, rng):
    """Role markings on the survivor chest so the five types read apart."""
    rect = _front_rect(model, "body", 0)
    if not rect:
        return
    x0, y0, fw, fh = rect

    if name == "survivor_medic":
        cx, cy = x0 + fw // 2, y0 + fh // 2
        grid.rect(cx - 2, cy - 1, cx + 1, cy, (168, 34, 34))
        grid.rect(cx - 1, cy - 3, cx, cy + 2, (168, 34, 34))
    elif name == "survivor_guard":
        grid.rect(x0, y0 + 1, x0 + fw - 1, y0 + 2, shade(palette["void"], 1.4))
        grid.rect(x0 + fw // 2 - 1, y0, x0 + fw // 2, y0 + fh - 1, shade(palette["dark"], 0.8))
        grid.rect(x0, y0 + fh - 4, x0 + fw - 1, y0 + fh - 3, (44, 44, 48))
    elif name == "survivor_scientist":
        grid.rect(x0 + fw // 2, y0, x0 + fw // 2, y0 + fh - 1, shade(palette["dark"], 0.9))
        grid.rect(x0 + 1, y0 + 1, x0 + 2, y0 + 2, (86, 128, 176))
    elif name == "survivor_engineer":
        for y in (y0 + 2, y0 + fh - 4):
            grid.rect(x0, y, x0 + fw - 1, y, (226, 232, 236))
    elif name == "survivor_civilian":
        grid.rect(x0 + 1, y0 + 2, x0 + 2, y0 + 5, shade(palette["dark"], 0.85))
    elif name == "mimic_human":
        # Almost human - one wrong detail, only visible up close.
        grid.set(x0 + fw - 2, y0 + 2, (150, 60, 58))
        grid.set(x0 + fw - 2, y0 + 3, (150, 60, 58))


# --------------------------------------------------------------------------
# Item icons - 16x16
# --------------------------------------------------------------------------

S = 16


def outline(grid, colour=(18, 14, 16, 255)):
    """1px dark border hugging every drawn pixel."""
    edges = []
    for y in range(grid.h):
        for x in range(grid.w):
            if grid.get(x, y)[3] == 0:
                neighbours = [grid.get(x + dx, y + dy)[3] for dx, dy in
                              ((1, 0), (-1, 0), (0, 1), (0, -1))]
                if any(a > 0 for a in neighbours):
                    edges.append((x, y))
    for x, y in edges:
        grid.set(x, y, colour)


def item_grid():
    return Grid(S, S)


def icon_suit_helmet(g):
    tan, dark, glass = (196, 146, 66), (128, 92, 40), (128, 196, 208)
    g.rect(4, 3, 11, 4, tan)
    g.rect(3, 5, 12, 10, tan)
    g.rect(4, 11, 11, 12, dark)
    g.rect(5, 6, 10, 9, glass)
    g.rect(5, 6, 10, 6, (196, 236, 244))
    g.rect(3, 7, 3, 9, dark)
    g.rect(12, 7, 12, 9, dark)


def icon_suit_chest(g):
    tan, dark, strap = (196, 146, 66), (128, 92, 40), (78, 62, 34)
    g.rect(4, 3, 11, 12, tan)
    g.rect(2, 4, 3, 9, tan)
    g.rect(12, 4, 13, 9, tan)
    g.rect(5, 5, 6, 11, strap)
    g.rect(9, 5, 10, 11, strap)
    g.rect(7, 6, 8, 8, dark)
    g.rect(4, 12, 11, 12, dark)


def icon_suit_legs(g):
    tan, dark = (196, 146, 66), (128, 92, 40)
    g.rect(4, 2, 11, 5, tan)
    g.rect(4, 6, 7, 13, tan)
    g.rect(8, 6, 11, 13, tan)
    g.rect(7, 6, 8, 13, (0, 0, 0, 0))
    g.rect(4, 4, 11, 4, dark)
    g.rect(4, 13, 6, 13, dark)
    g.rect(9, 13, 11, 13, dark)


def icon_suit_boots(g):
    tan, dark = (196, 146, 66), (96, 70, 32)
    g.rect(3, 5, 6, 10, tan)
    g.rect(9, 5, 12, 10, tan)
    g.rect(2, 11, 7, 12, dark)
    g.rect(8, 11, 13, 12, dark)


def icon_sun_hood(g):
    cloth, dark, shine = (172, 168, 152), (108, 104, 92), (214, 210, 190)
    g.rect(4, 3, 11, 4, cloth)
    g.rect(3, 5, 12, 11, cloth)
    g.rect(5, 6, 10, 9, dark)
    g.rect(5, 6, 10, 6, shine)
    g.rect(3, 12, 12, 12, dark)


def icon_gas_mask(g):
    rubber, dark, lens, filt = (58, 62, 58), (32, 34, 32), (168, 196, 128), (120, 124, 118)
    g.rect(4, 3, 11, 11, rubber)
    g.rect(4, 4, 5, 5, dark)
    g.rect(10, 4, 11, 5, dark)
    g.rect(5, 5, 6, 6, lens)
    g.rect(9, 5, 10, 6, lens)
    g.rect(6, 8, 9, 11, filt)
    g.rect(7, 12, 8, 13, dark)


def icon_uv_detector(g):
    case, screen, dark = (78, 84, 88), (96, 224, 128), (36, 40, 44)
    g.rect(4, 3, 11, 13, case)
    g.rect(5, 5, 10, 9, dark)
    g.rect(6, 6, 9, 8, screen)
    g.rect(6, 6, 7, 6, (216, 255, 216))
    g.rect(5, 11, 6, 12, (196, 72, 60))
    g.rect(8, 11, 10, 12, dark)
    g.rect(7, 1, 8, 3, (150, 154, 158))


def icon_flashlight(g):
    body, lens, ring = (66, 70, 76), (255, 236, 168), (140, 146, 152)
    g.rect(6, 6, 9, 14, body)
    g.rect(5, 3, 10, 5, ring)
    g.rect(6, 4, 9, 5, lens)
    g.rect(6, 8, 9, 8, (44, 48, 52))
    g.rect(6, 11, 9, 11, (44, 48, 52))
    for x in range(4, 12, 3):
        g.set(x, 1, (255, 248, 200))
        g.set(x, 2, (255, 248, 200))


def icon_battery(g):
    shell, band, term = (56, 58, 62), (198, 156, 42), (188, 192, 196)
    g.rect(5, 4, 10, 14, shell)
    g.rect(5, 7, 10, 9, band)
    g.rect(6, 2, 9, 3, term)
    g.rect(7, 11, 8, 11, (232, 208, 96))
    g.rect(6, 12, 9, 12, (232, 208, 96))


def icon_flare(g):
    stick, cap, fire, hot = (168, 52, 44), (96, 30, 26), (255, 148, 40), (255, 244, 176)
    g.rect(6, 7, 9, 14, stick)
    g.rect(6, 10, 9, 10, cap)
    g.rect(6, 4, 9, 6, fire)
    g.rect(7, 2, 8, 5, hot)
    g.set(5, 5, fire)
    g.set(10, 5, fire)
    g.set(6, 1, (255, 210, 120))


def icon_radio(g):
    case, grill, knob = (62, 66, 62), (32, 34, 32), (176, 148, 62)
    g.rect(3, 5, 12, 14, case)
    g.rect(4, 7, 8, 12, grill)
    for y in range(7, 13, 2):
        g.rect(4, y, 8, y, (86, 90, 86))
    g.rect(10, 7, 11, 8, knob)
    g.rect(10, 10, 11, 12, (44, 48, 44))
    g.rect(10, 1, 11, 5, (140, 144, 148))


def icon_document(g):
    paper, ink, stamp = (222, 216, 196), (92, 88, 76), (168, 44, 40)
    g.rect(3, 2, 12, 14, paper)
    for y in range(5, 13, 2):
        g.rect(5, y, 10, y, ink)
    g.rect(4, 3, 8, 3, (60, 58, 50))
    g.rect(9, 11, 12, 13, stamp)
    g.rect(10, 12, 11, 12, (222, 216, 196))


def icon_medkit(g):
    case, cross, dark = (226, 228, 230), (188, 42, 42), (150, 152, 156)
    g.rect(3, 4, 12, 13, case)
    g.rect(3, 4, 12, 5, dark)
    g.rect(6, 8, 9, 9, cross)
    g.rect(7, 6, 8, 11, cross)
    g.rect(7, 2, 8, 3, dark)


def icon_canned_food(g):
    tin, band, label = (150, 154, 158), (108, 112, 116), (186, 96, 48)
    g.rect(4, 3, 11, 13, tin)
    g.rect(4, 3, 11, 4, band)
    g.rect(4, 12, 11, 13, band)
    g.rect(4, 6, 11, 10, label)
    g.rect(5, 7, 7, 8, (232, 214, 168))
    g.rect(11, 5, 11, 12, (120, 124, 128))


def icon_water(g):
    bottle, water, cap = (206, 226, 232), (72, 138, 196), (188, 62, 52)
    g.rect(5, 4, 10, 14, bottle)
    g.rect(6, 7, 9, 13, water)
    g.rect(6, 2, 9, 3, cap)
    g.rect(6, 4, 6, 6, (236, 246, 250))
    g.rect(7, 9, 8, 9, (128, 186, 226))


CARD_COLOURS = {
    1: (120, 176, 96),
    2: (96, 152, 206),
    3: (206, 176, 72),
    4: (198, 112, 48),
    5: (176, 62, 62),
}


def make_card_icon(level):
    def draw(g):
        body, chip, stripe = (226, 224, 216), (206, 178, 78), CARD_COLOURS[level]
        g.rect(2, 4, 13, 12, body)
        g.rect(2, 4, 13, 5, stripe)
        g.rect(3, 7, 5, 9, chip)
        g.rect(7, 7, 12, 7, (120, 118, 112))
        g.rect(7, 9, 11, 9, (120, 118, 112))
        for index in range(level):
            g.rect(3 + index * 2, 11, 3 + index * 2, 11, stripe)
    return draw


def icon_bunker_key(g):
    metal, dark = (176, 168, 140), (112, 106, 84)
    g.rect(4, 2, 8, 3, metal)
    g.rect(3, 4, 4, 6, metal)
    g.rect(8, 4, 9, 6, metal)
    g.rect(5, 4, 7, 6, dark)
    g.rect(6, 7, 7, 14, metal)
    g.rect(8, 10, 9, 11, metal)
    g.rect(8, 13, 9, 14, metal)


def icon_starter(g):
    crate, edge, sun = (128, 96, 56), (86, 62, 34), (240, 178, 62)
    g.rect(2, 3, 13, 13, crate)
    g.rect(2, 3, 13, 3, edge)
    g.rect(2, 13, 13, 13, edge)
    g.rect(2, 3, 2, 13, edge)
    g.rect(13, 3, 13, 13, edge)
    g.rect(6, 7, 9, 10, sun)
    g.rect(7, 6, 8, 11, sun)
    g.rect(5, 8, 10, 9, sun)
    g.set(4, 5, sun)
    g.set(11, 5, sun)
    g.set(4, 12, sun)
    g.set(11, 12, sun)


def icon_plating(g):
    steel, dark, rivet = (140, 146, 152), (94, 100, 106), (198, 202, 206)
    g.rect(2, 4, 13, 12, steel)
    g.rect(2, 4, 13, 4, rivet)
    g.rect(2, 12, 13, 12, dark)
    for x in (4, 7, 10):
        g.set(x, 6, rivet)
        g.set(x, 10, rivet)
    g.rect(5, 8, 10, 8, dark)


def icon_lens(g):
    glass, ring, glow = (156, 214, 232), (128, 132, 138), (236, 250, 255)
    g.rect(5, 3, 10, 3, ring)
    g.rect(4, 4, 11, 11, glass)
    g.rect(5, 12, 10, 12, ring)
    g.rect(3, 5, 3, 10, ring)
    g.rect(12, 5, 12, 10, ring)
    g.rect(5, 5, 7, 6, glow)
    g.rect(6, 9, 9, 10, (108, 176, 206))


def icon_flesh(g):
    flesh, dark, bone = (162, 78, 72), (110, 44, 44), (226, 206, 168)
    g.rect(4, 5, 11, 11, flesh)
    g.rect(3, 7, 12, 9, flesh)
    g.rect(5, 4, 9, 4, flesh)
    g.rect(6, 12, 10, 12, dark)
    g.rect(6, 7, 7, 8, dark)
    g.rect(9, 6, 10, 7, bone)
    g.set(5, 10, bone)


ITEM_ICONS = {
    "suit_helmet": icon_suit_helmet,
    "suit_chestplate": icon_suit_chest,
    "suit_leggings": icon_suit_legs,
    "suit_boots": icon_suit_boots,
    "sun_hood": icon_sun_hood,
    "gas_mask": icon_gas_mask,
    "uv_detector": icon_uv_detector,
    "flashlight": icon_flashlight,
    "battery": icon_battery,
    "emergency_flare": icon_flare,
    "radio": icon_radio,
    "research_document": icon_document,
    "medical_kit": icon_medkit,
    "canned_food": icon_canned_food,
    "emergency_water": icon_water,
    "bunker_key": icon_bunker_key,
    "survival_starter": icon_starter,
    "scrap_plating": icon_plating,
    "uv_lens": icon_lens,
    "flesh_sample": icon_flesh,
}
for _level in range(1, 6):
    ITEM_ICONS[f"access_card_{_level}"] = make_card_icon(_level)


# --------------------------------------------------------------------------
# Block textures - 16x16
# --------------------------------------------------------------------------

def block_metal(grid, base, dark, light, seed):
    rng = Rand(seed_of(seed))
    for y in range(16):
        for x in range(16):
            tone = rng.between(-0.08, 0.08)
            grid.set(x, y, shade(mix(base, light if tone > 0 else dark, abs(tone) * 3), 1.0))
    grid.rect(0, 0, 15, 0, light)
    grid.rect(0, 15, 15, 15, dark)
    grid.rect(0, 0, 0, 15, light)
    grid.rect(15, 0, 15, 15, dark)


def tex_security_door(g):
    block_metal(g, (108, 114, 120), (72, 78, 84), (146, 152, 158), "security")
    g.rect(0, 7, 15, 8, (58, 62, 66))
    g.rect(3, 3, 12, 5, (44, 48, 52))
    g.rect(4, 4, 11, 4, (120, 176, 96))
    for y in (2, 13):
        for x in (2, 13):
            g.set(x, y, (168, 174, 180))
    g.rect(5, 11, 10, 12, (44, 48, 52))


def tex_lab_door(g):
    block_metal(g, (206, 208, 212), (154, 158, 164), (236, 238, 242), "lab")
    g.rect(0, 7, 15, 7, (96, 152, 206))
    g.rect(4, 2, 11, 6, (176, 200, 220))
    g.rect(5, 3, 10, 5, (128, 172, 200))
    g.rect(3, 10, 12, 11, (150, 154, 160))
    g.rect(6, 13, 9, 13, (96, 152, 206))


def tex_blast_door(g):
    block_metal(g, (96, 92, 84), (62, 58, 52), (132, 128, 118), "blast")
    for y in range(16):
        for x in range(16):
            if (x + y) % 8 < 4 and 4 <= y <= 11:
                g.set(x, y, (206, 168, 48) if (x + y) % 8 < 2 else (36, 34, 30))
    g.rect(0, 3, 15, 3, (48, 46, 42))
    g.rect(0, 12, 15, 12, (48, 46, 42))
    for x in (1, 14):
        for y in (1, 14):
            g.set(x, y, (168, 164, 152))


def tex_bunker_door(g):
    block_metal(g, (122, 100, 74), (82, 64, 44), (156, 132, 100), "bunker")
    # Wheel valve.
    for angle in range(0, 360, 15):
        radius = 5.2
        x = 7.5 + math.cos(math.radians(angle)) * radius
        y = 7.5 + math.sin(math.radians(angle)) * radius
        g.set(int(round(x)), int(round(y)), (58, 50, 40))
    g.rect(7, 3, 8, 12, (74, 62, 48))
    g.rect(3, 7, 12, 8, (74, 62, 48))
    g.rect(6, 6, 9, 9, (96, 80, 60))
    g.rect(7, 7, 8, 8, (48, 42, 34))


BLOCK_TEXTURES = {
    "daybreak_security_door": tex_security_door,
    "daybreak_lab_door": tex_lab_door,
    "daybreak_blast_door": tex_blast_door,
    "daybreak_bunker_door": tex_bunker_door,
}


# --------------------------------------------------------------------------
# Environment + pack icons
# --------------------------------------------------------------------------

def paint_sun(size=32):
    """The anomalous sun: a blown-out white core inside a bleeding corona."""
    grid = Grid(size, size)
    rng = Rand(seed_of("sun"))
    centre = (size - 1) / 2
    for y in range(size):
        for x in range(size):
            distance = math.hypot(x - centre, y - centre) / (size / 2)
            if distance > 1.0:
                continue
            if distance < 0.42:
                colour = (255, 255, 250)
                alpha = 255
            elif distance < 0.66:
                t = (distance - 0.42) / 0.24
                colour = mix((255, 250, 226), (255, 186, 92), t)
                alpha = 255
            else:
                t = (distance - 0.66) / 0.34
                colour = mix((255, 170, 76), (196, 44, 28), t)
                alpha = int(255 * (1.0 - t * 0.82))
            flicker = rng.between(0.94, 1.06)
            grid.set(x, y, (*shade(colour, flicker), max(0, min(255, alpha))))
    return grid


def paint_pack_icon(tint):
    size = 128
    grid = Grid(size, size)
    rng = Rand(seed_of(f"icon{tint[0]}"))
    horizon = 84
    for y in range(size):
        for x in range(size):
            if y < horizon:
                t = y / horizon
                colour = mix((248, 196, 96), tint, t)
                colour = mix(colour, (86, 20, 18), t * 0.55)
            else:
                t = (y - horizon) / (size - horizon)
                colour = mix((44, 20, 20), (10, 8, 10), t)
            grid.set(x, y, (*colour, 255))

    # Sun disc with a hard bloom.
    cx, cy, radius = 64, 46, 20
    for y in range(size):
        for x in range(size):
            distance = math.hypot(x - cx, y - cy)
            if distance < radius:
                colour = (255, 255, 246) if distance < radius * 0.55 else mix(
                    (255, 240, 190), (255, 150, 60), (distance - radius * 0.55) / (radius * 0.45)
                )
                grid.set(x, y, (*colour, 255))
            elif distance < radius * 2.1:
                t = (distance - radius) / (radius * 1.1)
                base = grid.get(x, y)
                grid.set(x, y, (*mix(base[:3], (255, 178, 92), max(0.0, 0.55 - t * 0.55)), 255))

    # Ruined skyline plus one figure caught in the open.
    x = 4
    while x < size - 4:
        width = int(rng.between(9, 20))
        top = int(rng.between(horizon - 34, horizon - 6))
        for bx in range(x, min(size - 1, x + width)):
            for by in range(top, horizon):
                shade_tone = (18, 12, 14) if (bx + by) % 11 else (52, 34, 28)
                grid.set(bx, by, (*shade_tone, 255))
        x += width + int(rng.between(2, 7))

    for by in range(horizon, horizon + 22):
        grid.set(63, by, (12, 8, 10, 255))
        grid.set(64, by, (12, 8, 10, 255))
    grid.rect(62, horizon + 22, 65, horizon + 26, (12, 8, 10, 255))
    grid.rect(60, horizon + 27, 67, horizon + 34, (12, 8, 10, 255))
    return grid


def paint_suit_texture():
    """One 64x64 skin shared by all four protective-suit attachables."""
    grid = Grid(64, 64)
    rng = Rand(seed_of("daybreak_suit"))
    for model_key in ("suit_helmet", "suit_chest", "suit_legs", "suit_boots"):
        paint_model_onto(grid, model_key, model_key, "suit", rng)

    # Visor across the helmet front, and reflective banding on the chest.
    rect = _front_rect(MODELS["suit_helmet"], "head", 0)
    if rect:
        x0, y0, fw, fh = rect
        grid.rect(x0 + 1, y0 + fh // 3, x0 + fw - 2, y0 + fh - 3, (46, 62, 74))
        grid.rect(x0 + 2, y0 + fh // 3, x0 + fw - 3, y0 + fh // 3 + 1, (150, 208, 220))
    rect = _front_rect(MODELS["suit_chest"], "body", 0)
    if rect:
        x0, y0, fw, fh = rect
        grid.rect(x0, y0 + 3, x0 + fw - 1, y0 + 3, (226, 232, 236))
        grid.rect(x0, y0 + fh - 4, x0 + fw - 1, y0 + fh - 4, (226, 232, 236))
        grid.rect(x0 + fw // 2 - 1, y0 + 5, x0 + fw // 2, y0 + fh - 6, (72, 66, 54))
    return grid


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def main():
    written = 0

    for name, (model_key, palette_key) in TEXTURE_SKINS.items():
        grid = paint_entity(name, model_key, palette_key)
        write_png(os.path.join(RP, "textures", "entity", "daybreak", f"{name}.png"), grid)
        written += 1

    # Fully transparent skin for the invisible zone markers.
    write_png(os.path.join(RP, "textures", "entity", "daybreak", "marker.png"), Grid(8, 8))
    written += 1

    write_png(os.path.join(RP, "textures", "models", "armor", "daybreak_suit.png"),
              paint_suit_texture())
    written += 1

    for name, draw in ITEM_ICONS.items():
        grid = item_grid()
        draw(grid)
        outline(grid)
        write_png(os.path.join(RP, "textures", "items", f"{name}.png"), grid)
        written += 1

    for name, draw in BLOCK_TEXTURES.items():
        grid = Grid(16, 16)
        draw(grid)
        write_png(os.path.join(RP, "textures", "blocks", f"{name}.png"), grid)
        written += 1

    write_png(os.path.join(RP, "textures", "environment", "sun.png"), paint_sun())
    written += 1

    write_png(os.path.join(RP, "pack_icon.png"), paint_pack_icon((176, 62, 34)))
    write_png(os.path.join(BP, "pack_icon.png"), paint_pack_icon((132, 44, 30)))
    written += 2

    print(f"Wrote {written} PNGs.")


if __name__ == "__main__":
    main()
