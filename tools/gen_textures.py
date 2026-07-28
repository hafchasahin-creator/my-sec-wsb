#!/usr/bin/env python3
"""Generate the 16x16 item icons for Arcane Arsenal.

Pure standard library - writes RGBA PNGs directly so the pack can be rebuilt
anywhere without image tooling installed.

Usage:  python3 tools/gen_textures.py [--preview]
"""

import os
import struct
import sys
import zlib

SIZE = 16
OUT_DIR = os.path.join("resource_packs", "arcane_arsenal_rp", "textures", "items")

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

    with open(path, "wb") as handle:
        handle.write(blob)


# --------------------------------------------------------------------------
# Shape helpers - shapes are dicts of (col, row) -> palette key
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


# --------------------------------------------------------------------------
# Silhouettes
# --------------------------------------------------------------------------

def sword_shape(variant=None):
    """Classic diagonal sword: blade up-right, hilt bottom-left.

    The whole weapon lies on one axis, col = 14 - row (shaded) and
    col = 15 - row (lit), so blade, guard and grip always line up.
    """
    cells = {}

    # Blade, rows 1..9.
    for row in range(1, 10):
        put(cells, 14 - row, row, "b")
        put(cells, 15 - row, row, "h")
    put(cells, 14, 1, "h")

    # Cross guard: two perpendicular lines crossing the axis at row 10.
    for step in range(-2, 3):
        put(cells, 4 + step, 10 + step, "g")
        put(cells, 5 + step, 10 + step, "g")

    # Grip, rows 11..14.
    for row in range(11, 15):
        put(cells, 14 - row, row, "w")
        put(cells, 15 - row, row, "w")

    # Pommel.
    put(cells, 0, 14, "p")
    put(cells, 1, 14, "p")
    put(cells, 0, 15, "p")

    if variant == "serrated":
        # Flame barbs along the shaded edge.
        for row in (3, 6):
            put(cells, 13 - row, row, "g")
    elif variant == "cored":
        # Glowing rune channel down the middle of the blade.
        for row in range(2, 9, 2):
            put(cells, 14 - row, row, "p")

    return cells


def trident_shape():
    """Three tines on a perpendicular crossbar, long diagonal shaft."""
    cells = {}

    # Shaft and centre tine are one continuous diagonal, rows 1..14.
    for row in range(1, 15):
        put(cells, 14 - row, row, "b")
        put(cells, 15 - row, row, "h")

    # Crossbar perpendicular to the shaft, crossing it at row 4.
    for step in range(0, 6):
        put(cells, 8 + step, 2 + step, "g")

    # Outer tines rise from each end of the crossbar.
    for col, row in ((8, 2), (13, 7)):
        for i in range(1, 3):
            put(cells, col + i, row - i, "h")

    # Grip and pommel.
    for row in range(11, 15):
        put(cells, 14 - row, row, "w")
        put(cells, 15 - row, row, "w")
    put(cells, 0, 15, "p")
    return cells


def hammer_shape():
    """Blocky maul head with a diagonal haft."""
    cells = {}

    # Haft.
    for row in range(8, 15):
        put(cells, 13 - row, row, "w")
        put(cells, 14 - row, row, "w")
    put(cells, 0, 15, "p")

    # Head block.
    for row in range(1, 8):
        for col in range(7, 15):
            put(cells, col, row, "b")

    # Lit top edge and struck face.
    for col in range(7, 15):
        put(cells, col, 1, "h")
    for row in range(1, 8):
        put(cells, 14, row, "h")

    # Runic accent band.
    for row in range(2, 7):
        put(cells, 8, row, "g")
    for col in range(9, 14):
        put(cells, col, 4, "g")

    # Collar where the haft meets the head.
    for row in range(7, 10):
        put(cells, 6, row, "p")
        put(cells, 7, row, "p")
    return cells


def staff_shape():
    """Long haft topped with a glowing orb."""
    cells = {}

    for row in range(5, 15):
        put(cells, 13 - row, row, "w")
        put(cells, 14 - row, row, "b")
    put(cells, 0, 15, "p")

    # Orb.
    centre_col, centre_row = 11, 4
    for row in range(SIZE):
        for col in range(SIZE):
            dist = ((col - centre_col) ** 2 + (row - centre_row) ** 2) ** 0.5
            if dist <= 1.2:
                put(cells, col, row, "h")
            elif dist <= 2.6:
                put(cells, col, row, "g")

    # Prongs cradling the orb.
    put(cells, 8, 6, "p")
    put(cells, 8, 7, "p")
    put(cells, 9, 7, "p")
    return cells


# --------------------------------------------------------------------------
# Weapons
# --------------------------------------------------------------------------

WEAPONS = {
    "frostbite_blade": (
        sword_shape,
        {
            "b": (95, 201, 248, 255),
            "h": (222, 247, 255, 255),
            "g": (43, 111, 168, 255),
            "w": (59, 74, 107, 255),
            "p": (168, 230, 255, 255),
            "o": (11, 30, 51, 255),
        },
    ),
    "emberfang": (
        lambda: sword_shape("serrated"),
        {
            "b": (255, 122, 42, 255),
            "h": (255, 214, 110, 255),
            "g": (107, 46, 18, 255),
            "w": (58, 29, 13, 255),
            "p": (255, 90, 30, 255),
            "o": (43, 15, 4, 255),
        },
    ),
    "stormcaller": (
        trident_shape,
        {
            "b": (120, 176, 200, 255),
            "h": (223, 246, 255, 255),
            "g": (255, 243, 150, 255),
            "w": (62, 90, 107, 255),
            "p": (255, 226, 92, 255),
            "o": (16, 32, 43, 255),
        },
    ),
    "voidreaper": (
        lambda: sword_shape("cored"),
        {
            "b": (107, 63, 160, 255),
            "h": (196, 154, 240, 255),
            "g": (42, 15, 74, 255),
            "w": (26, 10, 46, 255),
            "p": (223, 120, 255, 255),
            "o": (10, 4, 20, 255),
        },
    ),
    "cataclysm_hammer": (
        hammer_shape,
        {
            "b": (110, 110, 122, 255),
            "h": (168, 168, 182, 255),
            "g": (192, 57, 43, 255),
            "w": (90, 58, 30, 255),
            "p": (72, 72, 82, 255),
            "o": (26, 26, 34, 255),
        },
    ),
    "meteor_staff": (
        staff_shape,
        {
            "b": (74, 46, 26, 255),
            "h": (255, 240, 170, 255),
            "g": (255, 96, 32, 255),
            "w": (110, 72, 40, 255),
            "p": (196, 142, 58, 255),
            "o": (26, 14, 6, 255),
        },
    ),
}


def preview(cells):
    chars = {"b": "#", "h": "@", "g": "*", "w": "=", "p": "o", "o": "."}
    lines = []
    for row in range(SIZE):
        lines.append(
            "".join(chars.get(cells.get((col, row)), " ") for col in range(SIZE))
        )
    return "\n".join(lines)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    show = "--preview" in sys.argv

    for name, (shape_fn, palette) in WEAPONS.items():
        cells = outline(shape_fn())
        write_png(os.path.join(OUT_DIR, f"{name}.png"), render(cells, palette))
        if show:
            print(f"\n=== {name} ===")
            print(preview(cells))

    # Pack icons reuse the Voidreaper silhouette on a dark plate.
    icon_cells = outline(sword_shape())
    icon_palette = dict(WEAPONS["voidreaper"][1])
    grid = render(icon_cells, icon_palette)
    for row in range(SIZE):
        for col in range(SIZE):
            if grid[row][col] == TRANSPARENT:
                grid[row][col] = (24, 16, 40, 255)
    for path in (
        os.path.join("behavior_packs", "arcane_arsenal_bp", "pack_icon.png"),
        os.path.join("resource_packs", "arcane_arsenal_rp", "pack_icon.png"),
    ):
        write_png(path, grid)

    print(f"Wrote {len(WEAPONS)} item textures + 2 pack icons.")


if __name__ == "__main__":
    main()
