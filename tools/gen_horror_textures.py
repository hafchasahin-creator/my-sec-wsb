#!/usr/bin/env python3
"""Generate the textures for the Horror Mode add-on.

Pure standard library. Produces:
  textures/entity/watcher.png   64x64 skin for The Watcher (geometry.humanoid.custom)
  textures/items/dread_totem.png  16x16 item icon
  pack_icon.png                 for both packs

Usage:  python3 tools/gen_horror_textures.py [--preview]
"""

import os
import struct
import sys
import zlib

RP = os.path.join("resource_packs", "horror_rp")
BP = os.path.join("behavior_packs", "horror_bp")

TRANSPARENT = (0, 0, 0, 0)

# The Watcher is almost pure black so it reads as a silhouette at any light
# level; only the face has contrast.
VOID = (9, 9, 12, 255)
VOID_DARK = (5, 5, 7, 255)
FACE = (16, 16, 20, 255)
GLOW = (236, 236, 228, 255)


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


def blank(width, height, colour=TRANSPARENT):
    return [[colour for _ in range(width)] for _ in range(height)]


def box(grid, x1, y1, x2, y2, colour):
    for y in range(y1, y2 + 1):
        for x in range(x1, x2 + 1):
            if 0 <= y < len(grid) and 0 <= x < len(grid[0]):
                grid[y][x] = colour


# --------------------------------------------------------------------------
# The Watcher - 64x64 player skin layout
# --------------------------------------------------------------------------

# The four second-layer (hat / jacket / sleeve / trouser overlay) regions of a
# 64x64 skin. Left opaque these render as a bulky shell around the model, so
# they are cleared to transparent instead.
OVERLAY_REGIONS = [
    (32, 0, 63, 15),   # hat
    (0, 32, 55, 47),   # body + right arm + right leg, layer 2
    (0, 48, 15, 63),   # left leg, layer 2
    (48, 48, 63, 63),  # left arm, layer 2
]

# Head front face occupies (8,8)-(15,15) in the layout.
HEAD_FRONT = (8, 8)


def watcher_skin():
    grid = blank(64, 64, VOID)

    # Slight vertical shading so the figure is not a flat block of one colour.
    for y in range(64):
        if y % 4 == 3:
            box(grid, 0, y, 63, y, VOID_DARK)

    for region in OVERLAY_REGIONS:
        box(grid, region[0], region[1], region[2], region[3], TRANSPARENT)

    # Face: dark plate, two tall glowing eyes, a wide split grin.
    fx, fy = HEAD_FRONT
    box(grid, fx, fy, fx + 7, fy + 7, FACE)
    box(grid, fx + 1, fy + 2, fx + 2, fy + 4, GLOW)
    box(grid, fx + 5, fy + 2, fx + 6, fy + 4, GLOW)
    box(grid, fx + 2, fy + 6, fx + 5, fy + 6, GLOW)
    grid[fy + 5][fx + 1] = GLOW
    grid[fy + 5][fx + 6] = GLOW

    return grid


# --------------------------------------------------------------------------
# Cursed Totem - 16x16 item icon
# --------------------------------------------------------------------------

TOTEM = [
    "................",
    ".....oooooo.....",
    "....obbbbbbo....",
    "....obwbbwbo....",
    "....obbbbbbo....",
    "....obbwwbbo....",
    "....obbbbbbo....",
    ".....obbbbo.....",
    "...oobbbbbboo...",
    "..obbbbbbbbbbo..",
    "..obbowwwoobbo..",
    "..obbo....obbo..",
    "...oo......oo...",
    ".....obbbbo.....",
    ".....obbbbo.....",
    "......oooo......",
]

TOTEM_PALETTE = {
    "b": (34, 30, 38, 255),
    "w": (222, 220, 206, 255),
    "o": (8, 7, 10, 255),
}


def totem_icon():
    grid = blank(16, 16)
    for row, line in enumerate(TOTEM):
        if len(line) != 16:
            raise ValueError(f"totem row {row} is {len(line)} wide, expected 16")
        for col, char in enumerate(line):
            if char != ".":
                grid[row][col] = TOTEM_PALETTE[char]
    return grid


def preview(grid):
    lookup = {TOTEM_PALETTE["b"]: "#", TOTEM_PALETTE["w"]: "@", TOTEM_PALETTE["o"]: "."}
    return "\n".join(
        "".join(lookup.get(px, " ") for px in row) for row in grid
    )


def main():
    write_png(os.path.join(RP, "textures", "entity", "watcher.png"), watcher_skin())

    icon = totem_icon()
    write_png(os.path.join(RP, "textures", "items", "dread_totem.png"), icon)

    # Pack icons: the totem on an opaque near-black plate.
    plate = [list(row) for row in icon]
    for y in range(16):
        for x in range(16):
            if plate[y][x] == TRANSPARENT:
                plate[y][x] = (14, 12, 18, 255)
    for path in (
        os.path.join(BP, "pack_icon.png"),
        os.path.join(RP, "pack_icon.png"),
    ):
        write_png(path, plate)

    if "--preview" in sys.argv:
        print(preview(icon))
    print("Wrote 1 entity skin, 1 item texture + 2 pack icons.")


if __name__ == "__main__":
    main()
