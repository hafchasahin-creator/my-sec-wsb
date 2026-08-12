#!/usr/bin/env python3
"""Draw every PNG the Dangerous Fungi resource pack needs.

    python3 tools/gen_fungi_textures.py [--preview bloodcap]

Nothing here depends on an image library; `tools/pixel.py` writes the PNGs by
hand. Every drawing routine is seeded from the species key, so a rebuild always
produces identical bytes.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import fungi_shapes  # noqa: E402
import fungi_spec as spec  # noqa: E402
from pixel import Canvas, Rng, mix, shade, soft_dot  # noqa: E402

S = 16

BLOCK_DIR = os.path.join(spec.RP_DIR, "textures", "blocks")
ITEM_DIR = os.path.join(spec.RP_DIR, "textures", "items")
ARMOR_DIR = os.path.join(spec.RP_DIR, "textures", "models", "armor")
PARTICLE_DIR = os.path.join(spec.RP_DIR, "textures", "particle")


def seed_of(text):
    value = 0
    for ch in text:
        value = (value * 131 + ord(ch)) & 0xFFFFFFFF
    return value or 7


# ==========================================================================
# Cap materials - one routine per species look
# ==========================================================================


def _base(canvas, pal, rng, top="cap_light", bottom="cap_dark", grain=14):
    canvas.fill_all(pal["cap"])
    canvas.vertical_gradient(shade(pal[top], 1.0), pal[bottom], only_opaque=False)
    canvas.grain(rng, grain, only_opaque=False)


def cap_spots(canvas, pal, rng):
    _base(canvas, pal, rng)
    for _ in range(7):
        cx, cy = rng.below(S), rng.below(S)
        r = rng.between(1.2, 2.4)
        canvas.disc(cx, cy, r + 0.6, shade(pal["cap_dark"], 0.8))
        canvas.disc(cx, cy, r, pal["accent"])
        canvas.disc(cx - 0.5, cy - 0.5, r * 0.45, shade(pal["accent"], 1.25))
    canvas.grain(rng, 8, only_opaque=False)


def cap_veined(canvas, pal, rng):
    _base(canvas, pal, rng, grain=18)
    for _ in range(5):
        x, y = rng.below(S), rng.below(S)
        for _ in range(14):
            canvas.set(x % S, y % S, pal["cap_light"])
            canvas.set((x + 1) % S, y % S, shade(pal["cap_light"], 1.2))
            x += rng.below(3) - 1
            y += 1 if rng.chance(0.7) else -1
    for _ in range(10):
        canvas.set(rng.below(S), rng.below(S), pal["accent"])


def cap_warts(canvas, pal, rng):
    _base(canvas, pal, rng, grain=10)
    for _ in range(12):
        x, y = rng.below(S), rng.below(S)
        canvas.fill_rect(x, y, 2, 2, shade(pal["cap_dark"], 0.85))
        canvas.set(x, y, shade(pal["accent"], 1.1))
        canvas.set(x + 1, y + 1, shade(pal["cap_dark"], 0.7))


def cap_honeycomb(canvas, pal, rng):
    _base(canvas, pal, rng, grain=8)
    for cy in range(0, S, 4):
        for cx in range(0, S, 4):
            offset = 2 if (cy // 4) % 2 else 0
            x = (cx + offset) % S
            canvas.fill_rect(x, cy, 3, 3, shade(pal["cap_dark"], 0.55))
            canvas.fill_rect(x + 1, cy + 1, 1, 1, shade(pal["cap_dark"], 0.35))
            for i in range(3):
                canvas.set((x + i) % S, cy - 1, pal["cap_light"])
    canvas.grain(rng, 10, only_opaque=False)


def cap_cracks(canvas, pal, rng):
    canvas.fill_all(pal["cap_dark"])
    canvas.grain(rng, 16, only_opaque=False)
    for _ in range(4):
        x, y = rng.below(S), rng.below(S)
        for _ in range(12):
            canvas.set(x % S, y % S, pal["glow"] or pal["accent"])
            canvas.set((x + 1) % S, y % S, mix(pal["cap"], pal["accent"], 0.6))
            if rng.chance(0.5):
                y += 1
            else:
                x += 1 if rng.chance(0.5) else -1
    for _ in range(18):
        canvas.set(rng.below(S), rng.below(S), pal["cap"])
    for _ in range(6):
        canvas.set(rng.below(S), rng.below(S), shade(pal["accent"], 1.2))


def cap_crystal(canvas, pal, rng):
    _base(canvas, pal, rng, grain=6)
    # Shards radiate outward from a handful of nucleation points, so the
    # facets cross each other instead of all leaning the same way.
    for _ in range(5):
        cx, cy = rng.below(S), rng.below(S)
        for _ in range(4):
            angle = rng.rand() * 6.2832
            length = 3 + rng.below(5)
            for i in range(length):
                x = int(cx + math.cos(angle) * i)
                y = int(cy + math.sin(angle) * i)
                canvas.set(x, y, pal["cap_light"] if i < length * 0.6 else pal["accent"])
                canvas.set(x, y + 1, shade(pal["cap_dark"], 0.85))
        canvas.set(cx, cy, pal["accent"])
    for _ in range(12):
        canvas.set(rng.below(S), rng.below(S), shade(pal["accent"], 1.05))


def cap_mottle(canvas, pal, rng):
    _base(canvas, pal, rng, grain=20)
    for _ in range(14):
        cx, cy = rng.below(S), rng.below(S)
        tone = pal["cap_dark"] if rng.chance(0.6) else pal["cap_light"]
        canvas.disc(cx, cy, rng.between(1.0, 2.6), tone)
    canvas.grain(rng, 16, only_opaque=False)
    for _ in range(8):
        canvas.set(rng.below(S), rng.below(S), pal["accent"])


def cap_arcs(canvas, pal, rng):
    _base(canvas, pal, rng, grain=10)
    for _ in range(4):
        x = rng.below(S)
        y = 0
        while y < S:
            canvas.set(x % S, y, pal["accent"])
            canvas.set((x + 1) % S, y, shade(pal["cap_light"], 1.1))
            x += rng.below(5) - 2
            y += 1
    for _ in range(12):
        canvas.set(rng.below(S), rng.below(S), shade(pal["glow"] or pal["accent"], 1.15))


def cap_goo(canvas, pal, rng):
    _base(canvas, pal, rng, grain=12)
    for _ in range(6):
        x = rng.below(S)
        drop = 3 + rng.below(7)
        for y in range(drop):
            canvas.set(x, y, pal["cap_light"])
        canvas.disc(x, drop, 1.4, pal["accent"])
    for _ in range(9):
        cx, cy = rng.below(S), rng.below(S)
        canvas.ring(cx, cy, 2.0, 1.0, shade(pal["cap_dark"], 0.8))


def cap_rift(canvas, pal, rng):
    canvas.fill_all(pal["cap_dark"])
    canvas.grain(rng, 10, only_opaque=False)
    for _ in range(3):
        x, y = rng.below(S), 0
        while y < S:
            canvas.set(x % S, y, pal["cap_light"])
            canvas.set((x + 1) % S, y, pal["accent"])
            x += rng.below(3) - 1
            y += 1
    for _ in range(16):
        canvas.set(rng.below(S), rng.below(S), shade(pal["accent"], 1.3))
    for _ in range(24):
        canvas.set(rng.below(S), rng.below(S), pal["cap"])


def cap_shards(canvas, pal, rng):
    _base(canvas, pal, rng, grain=12)
    for _ in range(11):
        x, y = rng.below(S), rng.below(S)
        size = 2 + rng.below(4)
        for i in range(size):
            for j in range(size - i):
                canvas.set(x + j, y + i, pal["cap_light"] if i < size // 2 else pal["cap_dark"])
        canvas.line(x, y, x + size, y, pal["accent"])


def cap_folds(canvas, pal, rng):
    _base(canvas, pal, rng, grain=8)
    for band in range(0, S, 3):
        phase = rng.rand() * 6.28
        for x in range(S):
            y = band + int(round(1.4 * math.sin(x * 0.7 + phase)))
            canvas.set(x, y % S, shade(pal["cap_dark"], 0.7))
            canvas.set(x, (y + 1) % S, pal["cap_light"])
    canvas.grain(rng, 10, only_opaque=False)
    for _ in range(6):
        canvas.set(rng.below(S), rng.below(S), pal["accent"])


def cap_nodules(canvas, pal, rng):
    canvas.fill_all(pal["cap_dark"])
    canvas.grain(rng, 14, only_opaque=False)
    for _ in range(8):
        cx, cy = rng.below(S), rng.below(S)
        r = rng.between(1.4, 2.8)
        canvas.disc(cx, cy, r, pal["cap"])
        canvas.disc(cx, cy, r * 0.6, pal["cap_light"])
        canvas.disc(cx, cy, r * 0.28, pal["accent"])
    for _ in range(10):
        canvas.set(rng.below(S), rng.below(S), shade(pal["cap_light"], 1.2))


def cap_pale(canvas, pal, rng):
    """Bone-white cap with the dark radiating gills of a death cap."""
    _base(canvas, pal, rng, grain=7)
    for spoke in range(12):
        angle = spoke * (6.2832 / 12) + rng.rand() * 0.15
        for i in range(2, 11):
            x = int(8 + math.cos(angle) * i)
            y = int(8 + math.sin(angle) * i)
            canvas.set(x, y, shade(pal["accent"], 0.78))
            canvas.set(x, y + 1, shade(pal["cap_light"], 1.0))
    canvas.disc(8, 8, 2.4, pal["cap_light"])
    canvas.ring(8, 8, 2.6, 1.0, shade(pal["accent"], 0.85))
    for _ in range(8):
        canvas.set(rng.below(S), rng.below(S), shade(pal["accent"], 0.7))


def cap_smoky(canvas, pal, rng):
    _base(canvas, pal, rng, grain=22)
    for _ in range(12):
        cx, cy = rng.below(S), rng.below(S)
        r = rng.between(1.5, 3.5)
        tone = mix(pal["cap"], pal["cap_light"] if rng.chance(0.5) else pal["accent"], 0.45)
        canvas.disc(cx, cy, r, tone)
    canvas.grain(rng, 18, only_opaque=False)


def cap_eyes(canvas, pal, rng):
    _base(canvas, pal, rng, grain=12)
    for _ in range(4):
        cx, cy = 2 + rng.below(S - 4), 2 + rng.below(S - 4)
        canvas.disc(cx, cy, 2.6, shade(pal["cap_dark"], 0.7))
        canvas.disc(cx, cy, 1.9, pal["accent"])
        canvas.disc(cx, cy, 0.9, (12, 6, 14))
        canvas.set(cx - 1, cy - 1, (255, 235, 240))
    for _ in range(10):
        canvas.set(rng.below(S), rng.below(S), pal["cap_light"])


def cap_tendrils(canvas, pal, rng):
    _base(canvas, pal, rng, grain=12)
    for _ in range(6):
        x, y = rng.below(S), rng.below(S)
        angle = rng.rand() * 6.28
        for step in range(9):
            angle += (rng.rand() - 0.5) * 0.9
            x += math.cos(angle)
            y += math.sin(angle)
            canvas.set(int(x) % S, int(y) % S, pal["cap_dark"])
            canvas.set((int(x) + 1) % S, int(y) % S, pal["accent"])
    for _ in range(8):
        canvas.set(rng.below(S), rng.below(S), shade(pal["cap_light"], 1.15))


def cap_mutant(canvas, pal, rng):
    _base(canvas, pal, rng, grain=14)
    for _ in range(5):
        x, y = rng.below(S), rng.below(S)
        for _ in range(13):
            canvas.set(x % S, y % S, pal["accent"])
            canvas.set((x + 1) % S, (y + 1) % S, shade(pal["accent"], 0.65))
            x += rng.below(3) - 1
            y += rng.below(3) - 1
    for _ in range(7):
        cx, cy = rng.below(S), rng.below(S)
        canvas.disc(cx, cy, rng.between(1.0, 2.0), pal["cap_light"])
        canvas.disc(cx, cy, 0.8, pal["glow"] or pal["accent"])


def cap_wisp(canvas, pal, rng):
    _base(canvas, pal, rng, grain=8)
    for _ in range(10):
        cx, cy = rng.below(S), rng.below(S)
        canvas.ring(cx, cy, rng.between(2.0, 4.0), 1.0, pal["cap_light"])
    for _ in range(8):
        canvas.set(rng.below(S), rng.below(S), pal["accent"])


CAP_STYLES = {
    "spots": cap_spots,
    "veined": cap_veined,
    "warts": cap_warts,
    "honeycomb": cap_honeycomb,
    "cracks": cap_cracks,
    "crystal": cap_crystal,
    "mottle": cap_mottle,
    "arcs": cap_arcs,
    "goo": cap_goo,
    "rift": cap_rift,
    "shards": cap_shards,
    "folds": cap_folds,
    "nodules": cap_nodules,
    "pale": cap_pale,
    "smoky": cap_smoky,
    "eyes": cap_eyes,
    "tendrils": cap_tendrils,
    "mutant": cap_mutant,
    "wisp": cap_wisp,
}


# ==========================================================================
# Stem materials
# ==========================================================================


def stem_fibrous(canvas, pal, rng):
    canvas.fill_all(pal["stem"])
    for x in range(S):
        tone = shade(pal["stem"], 0.82 + 0.34 * rng.rand())
        for y in range(S):
            canvas.set(x, y, tone)
    for _ in range(20):
        x = rng.below(S)
        y0 = rng.below(S)
        for y in range(y0, min(S, y0 + 4 + rng.below(6))):
            canvas.set(x, y, pal["stem_dark"])
    canvas.grain(rng, 10, only_opaque=False)


def stem_smooth(canvas, pal, rng):
    canvas.fill_all(pal["stem"])
    canvas.vertical_gradient(shade(pal["stem"], 1.18), pal["stem_dark"], only_opaque=False)
    # A soft highlight down one side stops the flesh reading as flat colour.
    for y in range(S):
        canvas.set(3, y, shade(canvas.get(3, y)[:3], 1.16))
        canvas.set(4, y, shade(canvas.get(4, y)[:3], 1.10))
        canvas.set(12, y, shade(canvas.get(12, y)[:3], 0.88))
    for _ in range(16):
        canvas.disc(rng.below(S), rng.below(S), rng.between(0.6, 1.4), shade(pal["stem"], 0.9))
    canvas.grain(rng, 9, only_opaque=False)


def stem_bark(canvas, pal, rng):
    canvas.fill_all(pal["stem"])
    canvas.grain(rng, 16, only_opaque=False)
    for x in range(0, S, 2):
        offset = rng.below(2)
        for y in range(S):
            if (y + offset) % 5 == 0:
                canvas.set(x, y, pal["stem_dark"])
                canvas.set(x + 1, y, shade(pal["stem_dark"], 0.8))
            elif rng.chance(0.16):
                canvas.set(x, y, shade(pal["stem"], 1.2))
    canvas.grain(rng, 10, only_opaque=False)


def stem_ribbed(canvas, pal, rng):
    """Stacked growth rings - the bands wander so they never look printed."""
    canvas.fill_all(pal["stem"])
    canvas.grain(rng, 10, only_opaque=False)
    y = rng.below(3)
    while y < S:
        wobble = rng.rand() * 6.2832
        depth = rng.between(0.6, 1.6)
        for x in range(S):
            offset = int(round(depth * math.sin(x * 0.55 + wobble)))
            canvas.set(x, (y + offset) % S, pal["stem_dark"])
            canvas.set(x, (y + offset + 1) % S, shade(pal["stem"], 1.22))
        y += 3 + rng.below(2)
    for _ in range(14):
        x, y0 = rng.below(S), rng.below(S)
        canvas.set(x, y0, shade(pal["stem_dark"], 0.75))
    canvas.grain(rng, 8, only_opaque=False)


STEM_STYLES = {
    "fibrous": stem_fibrous,
    "smooth": stem_smooth,
    "bark": stem_bark,
    "ribbed": stem_ribbed,
}


# ==========================================================================
# Glow material - derived from the palette so it always matches
# ==========================================================================


def glow_material(canvas, pal, rng):
    glow = pal["glow"] or pal["accent"]
    canvas.fill_all(shade(glow, 0.55))
    canvas.grain(rng, 12, only_opaque=False)
    for _ in range(10):
        cx, cy = rng.below(S), rng.below(S)
        canvas.disc(cx, cy, rng.between(1.2, 3.0), glow)
        canvas.disc(cx, cy, 0.9, shade(glow, 1.35))
    for _ in range(14):
        canvas.set(rng.below(S), rng.below(S), shade(glow, 1.4))


# ==========================================================================
# Cut-out silhouettes for the crossed-plane species
# ==========================================================================


def silhouette(canvas, pal, rng, wispy=False):
    """A hanging veil on crossed planes: stalk, domed hood, torn lace skirt.

    Row 0 of the texture is the top of the block, so the drawing hangs
    downward and leaves the block's lower corners empty.
    """
    cap, dark, light, accent = (
        pal["cap"],
        pal["cap_dark"],
        pal["cap_light"],
        pal["accent"],
    )

    # Central stalk, thin so the plane still reads as a plant.
    for y in range(3, S):
        canvas.set(7, y, pal["stem"])
        canvas.set(8, y, pal["stem_dark"])
        if y > 11 and rng.chance(0.35):
            canvas.set(7, y, (0, 0, 0), 0)
            canvas.set(8, y, (0, 0, 0), 0)

    # Domed hood, rows 1..6.
    for y in range(1, 7):
        half = int(1.5 + (y - 1) * 1.15)
        for x in range(8 - half, 8 + half):
            canvas.set(x, y, mix(light, cap, (y - 1) / 5.0))
    for x in range(2, 14):
        if canvas.opaque(x, 6):
            canvas.set(x, 6, dark)

    # Lace skirt: every other column hangs, the rest stay open sky.
    for x in range(2, 14):
        if x in (7, 8):
            continue
        if rng.chance(0.28):
            continue  # a gap torn right through the veil
        drop = 3 + rng.below(8)
        # Longer strands toward the middle, shorter at the outer edges.
        drop = max(2, drop - abs(x - 8) // 2)
        for y in range(7, min(S, 7 + drop)):
            if rng.chance(0.12):
                continue  # holes in the lace
            canvas.set(x, y, mix(cap, dark, (y - 7) / 9.0))
        tip = min(S - 1, 7 + drop)
        canvas.set(x, tip, accent if rng.chance(0.5) else dark)

    if wispy:
        for _ in range(30):
            canvas.set(rng.below(S), 1 + rng.below(S - 1), (0, 0, 0), 0)
        for _ in range(14):
            x, y = rng.below(S), rng.below(S)
            if canvas.opaque(x, y):
                canvas.set(x, y, accent)

    canvas.grain(rng, 14)
    canvas.darken_edges(0.78)


# ==========================================================================
# Item icons
# ==========================================================================


def icon_scanner():
    c = Canvas(S)
    body = (58, 62, 70)
    body_dark = (32, 35, 40)
    body_light = (92, 98, 108)
    screen = (38, 220, 150)
    # Handle.
    c.fill_rect(6, 9, 4, 6, body_dark)
    c.fill_rect(6, 9, 1, 6, body)
    # Casing.
    c.fill_rect(3, 2, 10, 8, body)
    c.fill_rect(3, 2, 10, 1, body_light)
    c.fill_rect(3, 9, 10, 1, body_dark)
    # Screen with a readout line.
    c.fill_rect(5, 4, 6, 4, (12, 40, 30))
    c.fill_rect(5, 4, 6, 1, screen)
    c.set(6, 6, screen)
    c.set(8, 6, screen)
    c.set(9, 5, screen)
    # Antenna and status lamp.
    c.fill_rect(11, 0, 1, 3, (170, 176, 186))
    c.set(11, 0, (255, 210, 90))
    c.set(4, 8, (230, 70, 70))
    c.outline(body_dark)
    return c


def _armor_icon(kind):
    c = Canvas(S)
    base = (188, 196, 44)
    dark = (120, 126, 22)
    light = (226, 232, 96)
    strap = (48, 44, 40)
    glass = (60, 150, 170)

    if kind == "spore_mask":
        base, dark, light = (176, 178, 168), (108, 110, 104), (214, 216, 208)
        c.fill_rect(4, 5, 8, 6, base)
        c.fill_rect(4, 5, 8, 1, light)
        c.fill_rect(4, 10, 8, 1, dark)
        c.fill_rect(6, 11, 4, 3, dark)  # filter canister
        c.fill_rect(6, 11, 4, 1, (80, 82, 78))
        c.fill_rect(2, 6, 2, 1, strap)
        c.fill_rect(12, 6, 2, 1, strap)
        c.set(6, 7, (60, 62, 58))
        c.set(9, 7, (60, 62, 58))
    elif kind == "hazard_helmet":
        c.fill_rect(3, 3, 10, 9, base)
        c.fill_rect(3, 3, 10, 1, light)
        c.fill_rect(3, 11, 10, 1, dark)
        c.fill_rect(5, 6, 6, 4, glass)
        c.fill_rect(5, 6, 6, 1, (120, 220, 240))
        c.fill_rect(4, 12, 8, 1, strap)
    elif kind == "hazard_chestplate":
        c.fill_rect(3, 3, 10, 10, base)
        c.fill_rect(1, 4, 2, 5, base)
        c.fill_rect(13, 4, 2, 5, base)
        c.fill_rect(3, 3, 10, 1, light)
        c.fill_rect(3, 12, 10, 1, dark)
        c.fill_rect(7, 3, 2, 10, strap)
        c.fill_rect(3, 7, 10, 1, dark)
        c.fill_rect(6, 1, 4, 2, dark)
    elif kind == "hazard_leggings":
        c.fill_rect(3, 2, 10, 4, base)
        c.fill_rect(3, 2, 10, 1, light)
        c.fill_rect(3, 6, 4, 8, base)
        c.fill_rect(9, 6, 4, 8, base)
        c.fill_rect(3, 5, 10, 1, strap)
        c.fill_rect(3, 13, 4, 1, dark)
        c.fill_rect(9, 13, 4, 1, dark)
    else:  # hazard_boots
        c.fill_rect(2, 5, 5, 6, base)
        c.fill_rect(9, 5, 5, 6, base)
        c.fill_rect(2, 5, 5, 1, light)
        c.fill_rect(9, 5, 5, 1, light)
        c.fill_rect(1, 11, 6, 2, strap)
        c.fill_rect(9, 11, 6, 2, strap)
        c.fill_rect(2, 8, 5, 1, dark)
        c.fill_rect(9, 8, 5, 1, dark)

    rng = Rng(seed_of(kind))
    c.grain(rng, 9)
    c.outline((26, 24, 22))
    return c


# ==========================================================================
# Worn armour layers (vanilla 64x32 humanoid armour atlas)
# ==========================================================================


def armor_layer(layer, key):
    c = Canvas(64, 32)
    rng = Rng(seed_of(key + str(layer)))
    if key == "spore_mask":
        # Only the head box is painted, so it reads as a mask, not a helmet.
        c.fill_rect(0, 0, 32, 16, (176, 178, 168))
        c.fill_rect(0, 0, 32, 16, (176, 178, 168))
        for y in range(0, 16, 4):
            c.fill_rect(0, y, 32, 1, (140, 142, 134))
        # Front face of the head box.
        c.fill_rect(8, 8, 8, 8, (196, 198, 188))
        c.fill_rect(9, 10, 6, 4, (108, 110, 104))
        c.fill_rect(10, 11, 2, 2, (58, 60, 56))
        c.fill_rect(13, 11, 2, 2, (58, 60, 56))
        c.fill_rect(11, 14, 3, 2, (86, 88, 82))
        c.grain(rng, 8)
        return c

    base = (188, 196, 44)
    dark = (120, 126, 22)
    strap = (52, 48, 42)
    c.fill_all(base)
    c.grain(rng, 12, only_opaque=False)
    # Seam lines all over, so every unwrapped face keeps some structure.
    for y in range(0, 32, 4):
        c.fill_rect(0, y, 64, 1, dark)
    for x in range(0, 64, 8):
        c.fill_rect(x, 0, 1, 32, shade(base, 0.9))

    if layer == 1:
        # Head front face: visor.
        c.fill_rect(8, 8, 8, 8, (168, 176, 40))
        c.fill_rect(9, 10, 6, 4, (48, 132, 152))
        c.fill_rect(9, 10, 6, 1, (120, 220, 240))
        c.fill_rect(10, 15, 4, 1, (70, 66, 58))
        # Torso front: hazard chevrons and a chest strap.
        c.fill_rect(20, 20, 8, 12, base)
        for i in range(0, 12, 3):
            c.fill_rect(20, 20 + i, 8, 1, strap)
        c.fill_rect(23, 20, 2, 12, dark)
        # Shoulders.
        c.fill_rect(44, 20, 8, 12, shade(base, 0.92))
        c.fill_rect(44, 22, 8, 1, strap)
    else:
        # Leg layer: knee pads and boot cuffs.
        c.fill_rect(4, 20, 8, 12, shade(base, 0.95))
        c.fill_rect(4, 24, 8, 2, strap)
        c.fill_rect(20, 20, 8, 12, shade(base, 0.95))
        c.fill_rect(20, 24, 8, 2, strap)
        c.fill_rect(0, 16, 16, 1, strap)

    c.grain(rng, 7, only_opaque=False)
    return c


# ==========================================================================
# Pack icon
# ==========================================================================


def pack_icon(size=128):
    c = Canvas(size, size)
    rng = Rng(seed_of("dangerous-fungi-icon"))
    for y in range(size):
        t = y / (size - 1)
        for x in range(size):
            c.set(x, y, mix((22, 14, 30), (46, 24, 58), t))
    for _ in range(160):
        x, y = rng.below(size), rng.below(size)
        c.set(x, y, mix((90, 60, 120), (160, 120, 200), rng.rand()))

    scale = size / 16.0
    # Stem.
    c.fill_rect(int(6.5 * scale), int(8 * scale), int(3 * scale), int(6 * scale), (76, 46, 100))
    c.fill_rect(int(6.5 * scale), int(8 * scale), int(1 * scale), int(6 * scale), (110, 74, 140))
    # Cap.
    cx, cy = size / 2.0, 8 * scale
    for y in range(int(3 * scale), int(9 * scale)):
        half = math.sqrt(max(0.0, 1 - ((y - cy) / (5.6 * scale)) ** 2)) * 6.4 * scale
        for x in range(int(cx - half), int(cx + half)):
            t = (y - 3 * scale) / (6 * scale)
            c.set(x, y, mix((176, 111, 224), (83, 39, 118), t))
    # Warning spots.
    for _ in range(9):
        sx = cx + (rng.rand() - 0.5) * 10 * scale
        sy = 4 * scale + rng.rand() * 4 * scale
        c.disc(sx, sy, rng.between(0.5, 1.1) * scale, (154, 255, 92))
    # Rising spores.
    for _ in range(70):
        x, y = rng.below(size), rng.below(size)
        c.set(x, y, (224, 179, 255))
    return c


# ==========================================================================
# Driver
# ==========================================================================


def block_texture_key(key, material):
    return f"fungi_{key}_{material}"


def build_species_textures(sp, write=True):
    shape = fungi_shapes.SHAPES[sp["shape"]]
    rng = Rng(seed_of(sp["key"]))
    made = {}

    if shape["layout"] == "silhouette":
        c = Canvas(S)
        silhouette(c, sp["palette"], rng, wispy=sp["key"] == "phantom_fungus")
        made["cap"] = c
    else:
        for material in fungi_shapes.materials_used(sp["shape"]):
            c = Canvas(S)
            if material == "cap":
                CAP_STYLES[sp["cap_style"]](c, sp["palette"], rng)
            elif material == "stem":
                STEM_STYLES[sp["stem_style"]](c, sp["palette"], rng)
            else:
                glow_material(c, sp["palette"], rng)
            made[material] = c

    if write:
        for material, canvas in made.items():
            canvas.to_png(
                os.path.join(BLOCK_DIR, block_texture_key(sp["key"], material) + ".png")
            )
    return made


def generate_all():
    for directory in (BLOCK_DIR, ITEM_DIR, ARMOR_DIR, PARTICLE_DIR):
        os.makedirs(directory, exist_ok=True)

    count = 0
    for sp in spec.SPECIES:
        count += len(build_species_textures(sp))

    icon_scanner().to_png(os.path.join(ITEM_DIR, "fungal_scanner.png"))
    for item in spec.EQUIPMENT:
        if item["key"] == "fungal_scanner":
            continue
        _armor_icon(item["key"]).to_png(os.path.join(ITEM_DIR, item["key"] + ".png"))

    armor_layer(1, "hazard").to_png(os.path.join(ARMOR_DIR, "hazard_layer_1.png"))
    armor_layer(2, "hazard").to_png(os.path.join(ARMOR_DIR, "hazard_layer_2.png"))
    armor_layer(1, "spore_mask").to_png(os.path.join(ARMOR_DIR, "spore_mask_layer_1.png"))

    soft_dot(8, 2.2).to_png(os.path.join(PARTICLE_DIR, "fungal_spore.png"))
    soft_dot(8, 1.1).to_png(os.path.join(PARTICLE_DIR, "fungal_smoke.png"))

    icon = pack_icon()
    icon.to_png(os.path.join(spec.RP_DIR, "pack_icon.png"))
    icon.to_png(os.path.join(spec.BP_DIR, "pack_icon.png"))

    print(
        f"Textures: {count} block materials, "
        f"{len(spec.EQUIPMENT)} item icons, 3 armour layers, 2 particle sprites, 2 pack icons."
    )


if __name__ == "__main__":
    if "--preview" in sys.argv:
        which = sys.argv[sys.argv.index("--preview") + 1]
        target = spec.by_key(which)
        for material, canvas in build_species_textures(target, write=False).items():
            print(f"--- {which} / {material} ---")
            print(canvas.ascii_preview())
    else:
        os.makedirs(spec.BP_DIR, exist_ok=True)
        os.makedirs(spec.RP_DIR, exist_ok=True)
        generate_all()
