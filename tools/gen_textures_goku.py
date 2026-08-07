#!/usr/bin/env python3
"""Generate the 16x16 item icons for the Goku Abilities add-on.

Pure standard library - writes RGBA PNGs directly so the pack can be rebuilt
anywhere without image tooling installed.

Usage:  python3 tools/gen_textures_goku.py [--preview]
"""

import math
import os
import struct
import sys
import zlib

SIZE = 16
OUT_DIR = os.path.join("resource_packs", "goku_rp", "textures", "items")

TRANSPARENT = (0, 0, 0, 0)


# --------------------------------------------------------------------------
# PNG output
# --------------------------------------------------------------------------

def write_png(path, pixels):
    """pixels: list of rows, each row a list of (r, g, b, a)."""
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
    blob += chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0))
    blob += chunk(b"IDAT", zlib.compress(raw, 9))
    blob += chunk(b"IEND", b"")

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(blob)


# --------------------------------------------------------------------------
# Shape helpers - shapes are dicts of (col, row) -> palette key
#   b = body, h = highlight, g = glow/accent, w = wrap/handle,
#   p = detail, o = outline
# --------------------------------------------------------------------------

def put(cells, col, row, key, overwrite=True):
    if 0 <= col < SIZE and 0 <= row < SIZE:
        if overwrite or (col, row) not in cells:
            cells[(col, row)] = key


def outline(cells, key="o"):
    """Add a 1px dark border around every filled cell."""
    bordered = dict(cells)
    for (col, row) in cells:
        for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            put(bordered, col + dc, row + dr, key, overwrite=False)
    return bordered


def render(cells, palette):
    grid = [[TRANSPARENT for _ in range(SIZE)] for _ in range(SIZE)]
    for (col, row), key in cells.items():
        if 0 <= col < SIZE and 0 <= row < SIZE:
            grid[row][col] = palette[key]
    return grid


def dist(col, row, cx=7.5, cy=7.5):
    return math.hypot(col - cx, row - cy)


# --------------------------------------------------------------------------
# Silhouettes
# --------------------------------------------------------------------------

def orb_shape(radius=6.4, sparks=True):
    """A ki sphere: bright core, body, soft outer glow, top-left specular."""
    cells = {}
    for row in range(SIZE):
        for col in range(SIZE):
            d = dist(col, row)
            if d <= radius * 0.34:
                put(cells, col, row, "h")
            elif d <= radius * 0.72:
                put(cells, col, row, "b")
            elif d <= radius:
                put(cells, col, row, "g")

    # Specular highlight, up and to the left like every vanilla round item.
    for col, row in ((5, 4), (6, 4), (5, 5)):
        put(cells, col, row, "h")

    if sparks:
        for col, row in ((13, 2), (2, 12), (14, 11), (1, 4)):
            put(cells, col, row, "p")
    return cells


def small_orb_shape():
    """Compact ki blast with a short motion trail behind it."""
    cells = {}
    for row in range(SIZE):
        for col in range(SIZE):
            d = dist(col, row, 9.0, 6.5)
            if d <= 1.6:
                put(cells, col, row, "h")
            elif d <= 3.0:
                put(cells, col, row, "b")
            elif d <= 4.2:
                put(cells, col, row, "g")

    # Trail streaming down-left.
    for step in range(1, 7):
        put(cells, 8 - step, 6 + step, "g")
        if step < 4:
            put(cells, 7 - step, 6 + step, "b")
    return cells


def star_shape(variant=None):
    """Four-pointed aura burst - the transformation icons.

    All four forms share the burst silhouette (that is what a transformation
    reads as at 16x16); the variant marks and the palette are what tell them
    apart in the hotbar.
    """
    cells = {}
    for row in range(SIZE):
        for col in range(SIZE):
            dx, dy = col - 7.5, row - 7.5
            manhattan = abs(dx) + abs(dy)
            if manhattan <= 2.5:
                put(cells, col, row, "h")
            elif manhattan <= 4.5:
                put(cells, col, row, "b")
            elif manhattan <= 7.0 and (abs(dx) < 2.0 or abs(dy) < 2.0):
                put(cells, col, row, "g")

    # Long spikes out to the edges.
    for col in (7, 8):
        for row in (0, 1, 14, 15):
            put(cells, col, row, "g")
    for row in (7, 8):
        for col in (0, 1, 14, 15):
            put(cells, col, row, "g")

    # Diagonal sparks between the arms.
    for col, row in ((4, 4), (11, 4), (4, 11), (11, 11)):
        put(cells, col, row, "p")

    if variant == "kaioken":
        # Pulsing core: a dark cross burnt into the middle.
        for col, row in ((7, 6), (8, 6), (7, 9), (8, 9), (6, 7), (6, 8),
                         (9, 7), (9, 8)):
            put(cells, col, row, "p")
    elif variant == "hollow":
        # Ringed core for the Blue form.
        for col, row in ((7, 7), (8, 7), (7, 8), (8, 8)):
            put(cells, col, row, "b")
    elif variant == "eight":
        # Ultra Instinct gets four extra diagonal arms.
        for step in range(3, 7):
            for dc, dr in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
                put(cells, 7 + dc * step, 7 + dr * step, "g" if step < 6 else "p")
        for col, row in ((7, 7), (8, 8)):
            put(cells, col, row, "b")
    return cells


def ring_shape():
    """Spinning cutting disk seen edge-on-ish: bright annulus, hollow centre."""
    cells = {}
    for row in range(SIZE):
        for col in range(SIZE):
            d = dist(col, row)
            if 4.6 <= d <= 7.3:
                put(cells, col, row, "b")
            elif 3.6 <= d < 4.6:
                put(cells, col, row, "h")
            elif 7.3 < d <= 8.0:
                put(cells, col, row, "g")

    # Leading edge catches the light.
    for row in range(SIZE):
        for col in range(SIZE):
            d = dist(col, row)
            if 6.2 <= d <= 7.3 and row < 7:
                put(cells, col, row, "h")

    # Motion streaks.
    for col, row in ((1, 7), (0, 8), (14, 7), (15, 8)):
        put(cells, col, row, "p")
    return cells


def burst_shape():
    """Solar Flare: small blinding core with eight rays."""
    cells = {}
    for row in range(SIZE):
        for col in range(SIZE):
            d = dist(col, row)
            if d <= 2.2:
                put(cells, col, row, "h")
            elif d <= 3.6:
                put(cells, col, row, "b")

    # Rays are walked in half-steps so the diagonals stay unbroken.
    for i in range(8):
        angle = math.pi * 2 * i / 8
        step = 3.4
        while step <= 7.4:
            col = int(round(7.5 + math.cos(angle) * step))
            row = int(round(7.5 + math.sin(angle) * step))
            put(cells, col, row, "g" if step < 6.4 else "p")
            step += 0.5
    return cells


def fist_shape():
    """Dragon Fist: blocky punching fist wreathed in flame."""
    cells = {}

    # Flame wreath first so the fist overwrites it.
    for col, row in ((2, 2), (3, 1), (12, 1), (13, 2), (1, 5), (14, 5),
                     (2, 9), (13, 9)):
        put(cells, col, row, "g")

    for row in range(4, 12):
        for col in range(4, 12):
            put(cells, col, row, "b")

    # Knuckle line and lit top edge.
    for col in range(4, 12):
        put(cells, col, 4, "h")
    for col in (5, 7, 9, 11):
        put(cells, col, 5, "p")
    for row in range(4, 12):
        put(cells, 11, row, "h")

    # Finger creases.
    for col in range(5, 12):
        put(cells, col, 8, "p")

    # Wrist.
    for row in range(12, 15):
        for col in range(5, 11):
            put(cells, col, row, "w")
    return cells


def swirl_shape():
    """Instant Transmission: a warp spiral."""
    cells = {}
    steps = 46
    for i in range(steps):
        t = i / (steps - 1)
        angle = t * math.pi * 3.4
        radius = 1.0 + t * 6.2
        col = int(round(7.5 + math.cos(angle) * radius))
        row = int(round(7.5 + math.sin(angle) * radius))
        key = "h" if t < 0.25 else ("b" if t < 0.7 else "g")
        put(cells, col, row, key)
        if t > 0.35:
            put(cells, col, row + 1, key, overwrite=False)

    for col, row in ((7, 7), (8, 7), (7, 8), (8, 8)):
        put(cells, col, row, "h")
    for col, row in ((13, 13), (2, 3)):
        put(cells, col, row, "p")
    return cells


def cloud_shape():
    """Flying Nimbus: a fat golden cloud."""
    cells = {}
    rows = {
        4: range(6, 10),
        5: range(4, 12),
        6: range(2, 14),
        7: range(1, 15),
        8: range(1, 15),
        9: range(2, 14),
        10: range(4, 12),
        11: range(6, 10),
    }
    for row, span in rows.items():
        for col in span:
            put(cells, col, row, "b")

    for col in range(4, 12):
        put(cells, col, 5, "h")
    for col in range(2, 14):
        put(cells, col, 6, "h")
    for col in range(2, 14):
        put(cells, col, 10, "g")
    for col in range(6, 10):
        put(cells, col, 11, "g")

    # Wisps trailing underneath.
    for col, row in ((3, 12), (7, 13), (12, 12)):
        put(cells, col, row, "p")
    return cells


def bean_shape():
    """Senzu Bean: a single curved bean."""
    cells = {}
    rows = {
        3: (9, 11),
        4: (8, 12),
        5: (7, 12),
        6: (6, 11),
        7: (5, 10),
        8: (4, 9),
        9: (3, 8),
        10: (3, 7),
        11: (4, 7),
        12: (5, 7),
    }
    for row, (start, end) in rows.items():
        for col in range(start, end + 1):
            put(cells, col, row, "b")

    # Lit outer curve and a seam down the middle.
    for row, (start, end) in rows.items():
        put(cells, end, row, "h")
    for row, (start, end) in rows.items():
        put(cells, start, row, "g")
    for col, row in ((9, 5), (8, 6), (7, 7), (6, 8), (5, 9)):
        put(cells, col, row, "p")
    return cells


def pole_shape():
    """Power Pole: a diagonal red staff with gold caps."""
    cells = {}
    for row in range(1, 15):
        put(cells, 14 - row, row, "b")
        put(cells, 15 - row, row, "h")

    for row in (1, 2, 13, 14):
        put(cells, 14 - row, row, "g")
        put(cells, 15 - row, row, "g")

    # Grip wrap in the middle.
    for row in (7, 8):
        put(cells, 14 - row, row, "w")
        put(cells, 15 - row, row, "w")
    put(cells, 0, 15, "p")
    return cells


# --------------------------------------------------------------------------
# Palettes
# --------------------------------------------------------------------------

def palette(body, high, glow, wrap, detail, edge):
    return {"b": body, "h": high, "g": glow, "w": wrap, "p": detail, "o": edge}


BLUE_KI = palette(
    (86, 176, 255, 255), (226, 248, 255, 255), (38, 106, 200, 255),
    (30, 62, 120, 255), (180, 236, 255, 255), (8, 24, 56, 255),
)

ITEMS = {
    "ki_blast": (small_orb_shape, BLUE_KI),
    "kamehameha": (
        lambda: orb_shape(6.6),
        palette((70, 158, 255, 255), (236, 252, 255, 255), (26, 88, 196, 255),
                (26, 54, 110, 255), (168, 232, 255, 255), (6, 20, 52, 255)),
    ),
    "spirit_bomb": (
        lambda: orb_shape(7.4),
        palette((110, 208, 255, 255), (255, 255, 255, 255), (52, 130, 226, 255),
                (24, 60, 116, 255), (206, 246, 255, 255), (8, 26, 62, 255)),
    ),
    "destructo_disk": (
        ring_shape,
        palette((132, 236, 255, 255), (248, 255, 255, 255), (34, 150, 190, 255),
                (22, 74, 96, 255), (196, 250, 255, 255), (6, 32, 46, 255)),
    ),
    "dragon_fist": (
        fist_shape,
        palette((222, 96, 34, 255), (255, 194, 92, 255), (255, 132, 40, 255),
                (108, 44, 16, 255), (255, 236, 160, 255), (44, 14, 4, 255)),
    ),
    "solar_flare": (
        burst_shape,
        palette((255, 226, 118, 255), (255, 255, 244, 255), (255, 190, 48, 255),
                (140, 96, 16, 255), (255, 246, 190, 255), (58, 38, 4, 255)),
    ),
    "instant_transmission": (
        swirl_shape,
        palette((162, 96, 236, 255), (238, 208, 255, 255), (98, 44, 168, 255),
                (46, 18, 82, 255), (216, 150, 255, 255), (16, 4, 34, 255)),
    ),
    "flying_nimbus": (
        cloud_shape,
        palette((255, 208, 82, 255), (255, 244, 178, 255), (214, 148, 30, 255),
                (150, 100, 18, 255), (255, 232, 140, 255), (62, 38, 4, 255)),
    ),
    "kaioken": (
        lambda: star_shape("kaioken"),
        palette((228, 52, 44, 255), (255, 174, 150, 255), (150, 20, 18, 255),
                (78, 10, 10, 255), (255, 122, 96, 255), (36, 4, 4, 255)),
    ),
    "super_saiyan": (
        star_shape,
        palette((255, 208, 48, 255), (255, 252, 206, 255), (216, 146, 16, 255),
                (128, 84, 8, 255), (255, 238, 140, 255), (56, 34, 2, 255)),
    ),
    "super_saiyan_blue": (
        lambda: star_shape("hollow"),
        palette((70, 190, 255, 255), (226, 250, 255, 255), (24, 118, 208, 255),
                (14, 62, 120, 255), (160, 232, 255, 255), (4, 22, 54, 255)),
    ),
    "ultra_instinct": (
        lambda: star_shape("eight"),
        palette((208, 220, 238, 255), (255, 255, 255, 255), (140, 158, 190, 255),
                (78, 92, 120, 255), (238, 244, 255, 255), (28, 34, 48, 255)),
    ),
    "senzu_bean": (
        bean_shape,
        palette((104, 190, 66, 255), (176, 232, 120, 255), (52, 122, 38, 255),
                (36, 84, 26, 255), (206, 246, 152, 255), (14, 40, 8, 255)),
    ),
    "power_pole": (
        pole_shape,
        palette((198, 46, 40, 255), (244, 118, 100, 255), (255, 206, 74, 255),
                (86, 60, 24, 255), (255, 232, 150, 255), (34, 8, 6, 255)),
    ),
}


def preview(cells):
    chars = {"b": "#", "h": "@", "g": "*", "w": "=", "p": "o", "o": "."}
    return "\n".join(
        "".join(chars.get(cells.get((col, row)), " ") for col in range(SIZE))
        for row in range(SIZE)
    )


def main():
    show = "--preview" in sys.argv

    for name, (shape_fn, colors) in ITEMS.items():
        cells = outline(shape_fn())
        write_png(os.path.join(OUT_DIR, f"{name}.png"), render(cells, colors))
        if show:
            print(f"\n=== {name} ===")
            print(preview(cells))

    # Pack icon: the Super Saiyan aura on a dark plate.
    icon_cells = outline(star_shape())
    grid = render(icon_cells, ITEMS["super_saiyan"][1])
    for row in range(SIZE):
        for col in range(SIZE):
            if grid[row][col] == TRANSPARENT:
                grid[row][col] = (26, 20, 40, 255)
    for path in (
        os.path.join("behavior_packs", "goku_bp", "pack_icon.png"),
        os.path.join("resource_packs", "goku_rp", "pack_icon.png"),
    ):
        write_png(path, grid)

    print(f"Wrote {len(ITEMS)} item textures + 2 pack icons.")


if __name__ == "__main__":
    main()
