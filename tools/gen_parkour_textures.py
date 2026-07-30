#!/usr/bin/env python3
"""Generate the 16x16 item icons for Skyline Parkour.

Pure standard library - writes RGBA PNGs directly so the pack can be rebuilt
anywhere without image tooling installed. Kept standalone (its own tiny PNG
writer) so either add-on's texture tool can be run on its own.

Usage:  python3 tools/gen_parkour_textures.py [--preview]
"""

import os
import struct
import sys
import zlib

SIZE = 16
OUT_DIR = os.path.join("resource_packs", "skyline_parkour_rp", "textures", "items")

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


def distance(col, row, centre_col, centre_row):
    return ((col - centre_col) ** 2 + (row - centre_row) ** 2) ** 0.5


# --------------------------------------------------------------------------
# Silhouettes
# --------------------------------------------------------------------------

def compass_shape():
    """Round dial: gold rim, dark face, red/white needle."""
    cells = {}
    centre_col, centre_row = 7.5, 8.0

    for row in range(SIZE):
        for col in range(SIZE):
            dist = distance(col, row, centre_col, centre_row)
            if dist <= 5.0:
                cells[(col, row)] = "f"      # face
            elif dist <= 7.0:
                cells[(col, row)] = "b"      # rim

    # Rim highlight along the top-left.
    for row in range(SIZE):
        for col in range(SIZE):
            dist = distance(col, row, centre_col, centre_row)
            if 5.0 < dist <= 7.0 and col + row < 15:
                cells[(col, row)] = "h"

    # Needle: north half lit red, south half white, tapering to a point.
    for step, row in enumerate(range(3, 8)):
        half = step // 2
        for col in range(7 - half, 9 + half):
            put(cells, col, row, "n")
    for step, row in enumerate(range(8, 13)):
        half = (4 - step) // 2
        for col in range(7 - half, 9 + half):
            put(cells, col, row, "s")

    # Cardinal ticks on the face.
    for col, row in ((7, 3), (8, 3), (7, 12), (8, 12), (3, 7), (3, 8), (12, 7), (12, 8)):
        put(cells, col, row, "p")

    return cells


def flag_shape():
    """Checkered pennant on a pole, standing on a small plinth."""
    cells = {}

    # Pole.
    for row in range(1, 15):
        put(cells, 4, row, "w")
        put(cells, 5, row, "p")

    # Pennant: rows 1..7, tapering to the right.
    for row in range(1, 8):
        width = 9 - abs(row - 4)
        for col in range(6, 6 + width):
            checker = "b" if ((col // 2) + (row // 2)) % 2 == 0 else "h"
            put(cells, col, row, checker)

    # Plinth.
    for col in range(2, 8):
        put(cells, col, 14, "n")
    for col in range(3, 7):
        put(cells, col, 13, "n")
    put(cells, 4, 15, "p")
    put(cells, 5, 15, "p")

    return cells


def charm_shape():
    """Winged amulet: feathered wings either side of a glowing gem."""
    cells = {}
    centre_col, centre_row = 7.5, 9.0

    # Amulet body.
    for row in range(SIZE):
        for col in range(SIZE):
            dist = distance(col, row, centre_col, centre_row)
            if dist <= 2.4:
                cells[(col, row)] = "n"      # gem
            elif dist <= 3.8:
                cells[(col, row)] = "b"      # gold bezel
    for row in range(SIZE):
        for col in range(SIZE):
            if 2.4 < distance(col, row, centre_col, centre_row) <= 3.8 and col + row < 16:
                cells[(col, row)] = "h"

    # Gem glint.
    put(cells, 6, 8, "s")
    put(cells, 7, 8, "s")

    # Wings sweeping up and out from the bezel, mirrored around col 7/8.
    for col, row in ((4, 6), (3, 5), (2, 6), (1, 7)):
        put(cells, col, row, "w")
        put(cells, 15 - col, row, "w")
    for col in range(1, 5):
        put(cells, col, 7, "w")
        put(cells, 15 - col, 7, "w")
        put(cells, col, 8, "p")
        put(cells, 15 - col, 8, "p")
    for col in range(2, 5):
        put(cells, col, 9, "p")
        put(cells, 15 - col, 9, "p")

    # Suspension loop.
    for col, row in ((7, 3), (8, 3), (6, 4), (9, 4)):
        put(cells, col, row, "b")

    return cells


# --------------------------------------------------------------------------
# Items
# --------------------------------------------------------------------------

ITEMS = {
    "course_compass": (
        compass_shape,
        {
            "f": (36, 44, 66, 255),      # dial face
            "b": (214, 168, 58, 255),    # brass rim
            "h": (255, 226, 132, 255),   # rim highlight
            "n": (222, 66, 66, 255),     # needle north
            "s": (238, 244, 255, 255),   # needle south
            "p": (126, 196, 255, 255),   # cardinal ticks
            "w": (0, 0, 0, 0),
            "o": (18, 16, 26, 255),
        },
    ),
    "checkpoint_marker": (
        flag_shape,
        {
            "b": (255, 208, 64, 255),    # flag light square
            "h": (58, 62, 82, 255),      # flag dark square
            "w": (152, 106, 58, 255),    # pole lit side
            "p": (98, 66, 34, 255),      # pole shaded side
            "n": (128, 132, 144, 255),   # plinth
            "f": (0, 0, 0, 0),
            "s": (0, 0, 0, 0),
            "o": (24, 18, 12, 255),
        },
    ),
    "leap_charm": (
        charm_shape,
        {
            "n": (86, 226, 236, 255),    # gem
            "s": (226, 255, 255, 255),   # gem glint
            "b": (214, 168, 58, 255),    # bezel
            "h": (255, 232, 150, 255),   # bezel highlight
            "w": (255, 255, 255, 255),   # wing tip
            "p": (186, 214, 240, 255),   # wing shade
            "f": (0, 0, 0, 0),
            "o": (16, 24, 34, 255),
        },
    ),
}


def preview(cells):
    chars = {"f": "-", "b": "#", "h": "@", "n": "*", "s": "+", "w": "=", "p": "o", "o": "."}
    lines = []
    for row in range(SIZE):
        lines.append(
            "".join(chars.get(cells.get((col, row)), " ") for col in range(SIZE))
        )
    return "\n".join(lines)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    show = "--preview" in sys.argv

    for name, (shape_fn, palette) in ITEMS.items():
        cells = outline(shape_fn())
        write_png(os.path.join(OUT_DIR, f"{name}.png"), render(cells, palette))
        if show:
            print(f"\n=== {name} ===")
            print(preview(cells))

    # Pack icons: the compass on a night-sky plate.
    icon_cells = outline(compass_shape())
    grid = render(icon_cells, ITEMS["course_compass"][1])
    for row in range(SIZE):
        for col in range(SIZE):
            if grid[row][col] == TRANSPARENT:
                grid[row][col] = (14, 20, 38, 255)
    for path in (
        os.path.join("behavior_packs", "skyline_parkour_bp", "pack_icon.png"),
        os.path.join("resource_packs", "skyline_parkour_rp", "pack_icon.png"),
    ):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        write_png(path, grid)

    print(f"Wrote {len(ITEMS)} item textures + 2 pack icons.")


if __name__ == "__main__":
    main()
