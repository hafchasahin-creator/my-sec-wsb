#!/usr/bin/env python3
"""Generate the 16x16 icon for the One Punch Man add-on.

Pure standard library, same approach as tools/gen_textures.py: the sprite is
written out as an ASCII map so it can be read and edited by eye, then rendered
straight to an RGBA PNG.

Usage:  python3 tools/gen_opm_textures.py [--preview]
"""

import os
import struct
import sys
import zlib

SIZE = 16
RP = os.path.join("resource_packs", "one_punch_rp")
BP = os.path.join("behavior_packs", "one_punch_bp")
OUT_DIR = os.path.join(RP, "textures", "items")

TRANSPARENT = (0, 0, 0, 0)

# Saitama's glove: red fist, yellow wristband, impact sparks.
#   b base red   h highlight   g shadow/knuckle groove
#   w cuff       p cuff shadow  s spark   . transparent
FIST = [
    "................",
    "................",
    "...hh.hh.hh.hh..",
    "..hhhghhghhghhh.",
    "..bbbgbbgbbgbbb.",
    "..bbbbbbbbbbbbb.",
    "..bbbbbbbbbbbbb.",
    ".bggggggbbbbbbb.",
    ".bbbbbbbbbbbbbb.",
    ".bbbbbbbbbbbbbb.",
    "..bbbbbbbbbbbbg.",
    "..gbbbbbbbbbbgg.",
    "..wwwwwwwwwwww..",
    "..wppwwppwwppw..",
    "..wwwwwwwwwwww..",
    "...pppppppppp...",
]

PALETTE = {
    "b": (206, 43, 43, 255),
    "h": (240, 96, 82, 255),
    "g": (128, 20, 24, 255),
    "w": (255, 214, 76, 255),
    "p": (198, 148, 32, 255),
    "s": (255, 255, 255, 255),
    "o": (32, 8, 10, 255),
}

# Colour the pack icon plate sits on behind the fist.
PLATE = (46, 10, 14, 255)


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
# Sprite handling
# --------------------------------------------------------------------------

def parse(rows):
    """ASCII map -> dict of (col, row) -> palette key."""
    if len(rows) != SIZE:
        raise ValueError(f"sprite has {len(rows)} rows, expected {SIZE}")
    cells = {}
    for row, line in enumerate(rows):
        if len(line) != SIZE:
            raise ValueError(f"row {row} is {len(line)} wide, expected {SIZE}")
        for col, char in enumerate(line):
            if char != ".":
                cells[(col, row)] = char
    return cells


def outline(cells, key="o"):
    """Add a 1px dark border around every filled cell."""
    bordered = dict(cells)
    for (col, row) in cells:
        for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            target = (col + dc, row + dr)
            if 0 <= target[0] < SIZE and 0 <= target[1] < SIZE:
                bordered.setdefault(target, key)
    return bordered


def render(cells):
    grid = [[TRANSPARENT for _ in range(SIZE)] for _ in range(SIZE)]
    for (col, row), key in cells.items():
        grid[row][col] = PALETTE[key]
    return grid


def preview(cells):
    return "\n".join(
        "".join(cells.get((col, row), " ") for col in range(SIZE))
        for row in range(SIZE)
    )


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    cells = outline(parse(FIST))

    write_png(os.path.join(OUT_DIR, "serious_punch.png"), render(cells))

    # Pack icons: same fist, opaque dark-red plate behind it.
    grid = render(cells)
    for row in range(SIZE):
        for col in range(SIZE):
            if grid[row][col] == TRANSPARENT:
                grid[row][col] = PLATE
    for path in (
        os.path.join(BP, "pack_icon.png"),
        os.path.join(RP, "pack_icon.png"),
    ):
        write_png(path, grid)

    if "--preview" in sys.argv:
        print(preview(cells))
    print("Wrote 1 item texture + 2 pack icons.")


if __name__ == "__main__":
    main()
