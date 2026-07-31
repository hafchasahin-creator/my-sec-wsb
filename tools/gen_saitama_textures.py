#!/usr/bin/env python3
"""Generate the Saitama Bot textures.

Pure standard library. The entity sheet is painted onto the box-UV layout of
models/entity/saitama.geo.json - for a cube at uv (u, v) with size (w, h, d):

    top    (u + d,      v,     w, d)
    bottom (u + d + w,  v,     w, d)
    east   (u,          v + d, d, h)
    north  (u + d,      v + d, w, h)   <- the face you look at
    west   (u + d + w,  v + d, d, h)
    south  (u + 2d + w, v + d, w, h)

Move a cube in the model and you must move its paint here to match.

Usage:  python3 tools/gen_saitama_textures.py [--preview]
"""

import os
import struct
import sys
import zlib

RP = os.path.join("resource_packs", "saitama_bot_rp")
ENTITY_PNG = os.path.join(RP, "textures", "entity", "saitama_hero.png")
EGG_PNG = os.path.join(RP, "textures", "items", "saitama_hero_spawn_egg.png")
PACK_ICONS = (
    os.path.join("behavior_packs", "saitama_bot_bp", "pack_icon.png"),
    os.path.join(RP, "pack_icon.png"),
)

CLEAR = (0, 0, 0, 0)

SKIN = (242, 206, 168, 255)
SKIN_DARK = (206, 168, 130, 255)
SUIT = (240, 206, 46, 255)
SUIT_DARK = (198, 166, 26, 255)
GLOVE = (196, 48, 44, 255)
GLOVE_DARK = (150, 30, 28, 255)
CAPE = (240, 240, 242, 255)
CAPE_SHADE = (200, 202, 208, 255)
BELT = (188, 42, 40, 255)
INK = (44, 38, 34, 255)


# --------------------------------------------------------------------------
# PNG output
# --------------------------------------------------------------------------

def write_png(path, pixels):
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


# --------------------------------------------------------------------------
# Painting helpers
# --------------------------------------------------------------------------

def canvas(width, height, colour=CLEAR):
    return [[colour for _ in range(width)] for _ in range(height)]


def rect(grid, x, y, w, h, colour):
    for row in range(y, y + h):
        for col in range(x, x + w):
            if 0 <= row < len(grid) and 0 <= col < len(grid[0]):
                grid[row][col] = colour


def noise(col, row, salt=0):
    value = (col * 374761393 + row * 668265263 + salt * 2246822519) & 0xFFFFFFFF
    value = (value ^ (value >> 13)) * 1274126177 & 0xFFFFFFFF
    return (value ^ (value >> 16)) & 0xFF


def shade(grid, x, y, w, h, base, dark, salt=0):
    """Flat colour with a light speckle so it is not a dead plastic slab."""
    for row in range(y, y + h):
        for col in range(x, x + w):
            if 0 <= row < len(grid) and 0 <= col < len(grid[0]):
                grid[row][col] = dark if noise(col, row, salt) % 7 == 0 else base


def faces(uv, size):
    u, v = uv
    w, h, d = size
    return {
        "top": (u + d, v, w, d),
        "bottom": (u + d + w, v, w, d),
        "east": (u, v + d, d, h),
        "north": (u + d, v + d, w, h),
        "west": (u + d + w, v + d, d, h),
        "south": (u + 2 * d + w, v + d, w, h),
    }


def paint_cube(grid, uv, size, base, dark, salt=0):
    for x, y, w, h in faces(uv, size).values():
        shade(grid, x, y, w, h, base, dark, salt)


def paint_limb(grid, uv, size, upper, upper_dark, lower, lower_dark, split, salt=0):
    """A limb that is suit at the top and glove or boot at the bottom."""
    paint_cube(grid, uv, size, upper, upper_dark, salt)
    for name, (x, y, w, h) in faces(uv, size).items():
        if name in ("top",):
            continue
        if name == "bottom":
            shade(grid, x, y, w, h, lower, lower_dark, salt)
            continue
        shade(grid, x, y + h - split, w, split, lower, lower_dark, salt)


# --------------------------------------------------------------------------
# The entity sheet
# --------------------------------------------------------------------------

def entity_sheet():
    grid = canvas(64, 64)

    # Head: bald, and the face is the point of the whole character.
    paint_cube(grid, (0, 0), (8, 8, 8), SKIN, SKIN_DARK, salt=1)
    head = faces((0, 0), (8, 8, 8))
    fx, fy, _, _ = head["north"]
    rect(grid, fx + 1, fy + 3, 1, 2, INK)   # eyes: two dots, nothing more
    rect(grid, fx + 6, fy + 3, 1, 2, INK)
    rect(grid, fx + 3, fy + 6, 2, 1, INK)   # small flat mouth
    # A little shading under the crown so the bald head reads as round.
    tx, ty, tw, th = head["top"]
    rect(grid, tx, ty, tw, 1, SKIN_DARK)

    # Body: yellow suit, red belt, white collar where the cape attaches.
    paint_cube(grid, (16, 16), (8, 12, 4), SUIT, SUIT_DARK, salt=2)
    for name, (x, y, w, h) in faces((16, 16), (8, 12, 4)).items():
        if name in ("top", "bottom"):
            continue
        rect(grid, x, y + h - 2, w, 2, BELT)          # belt
        rect(grid, x, y, w, 1, CAPE_SHADE)            # collar
    bx, by, _, _ = faces((16, 16), (8, 12, 4))["north"]
    rect(grid, bx + 3, by + 2, 2, 2, SUIT_DARK)       # zip detail

    # Arms: suit to the elbow, red gloves below.
    for uv in ((40, 16), (32, 48)):
        paint_limb(grid, uv, (4, 12, 4), SUIT, SUIT_DARK, GLOVE, GLOVE_DARK, split=4, salt=3)

    # Legs: suit to the shin, red boots below.
    for uv in ((0, 16), (16, 48)):
        paint_limb(grid, uv, (4, 12, 4), SUIT, SUIT_DARK, GLOVE, GLOVE_DARK, split=5, salt=4)

    # Cape: white outside, shaded inside.
    paint_cube(grid, (0, 32), (10, 14, 1), CAPE, CAPE_SHADE, salt=5)
    inside = faces((0, 32), (10, 14, 1))["north"]
    shade(grid, *inside, CAPE_SHADE, (176, 178, 184, 255), salt=6)
    outside = faces((0, 32), (10, 14, 1))["south"]
    ox, oy, ow, oh = outside
    rect(grid, ox, oy, ow, 1, SUIT_DARK)  # gold seam at the shoulders
    for step in range(oh):                # frayed hem
        if step > oh - 4:
            rect(grid, ox + (step % 2), oy + step, 1, 1, CAPE_SHADE)
    return grid


# --------------------------------------------------------------------------
# Spawn egg and pack icon
# --------------------------------------------------------------------------

def spawn_egg():
    grid = canvas(16, 16)
    shell = [(6, 10), (5, 11), (4, 12), (3, 13), (3, 13), (3, 13), (3, 13), (4, 12), (5, 11)]
    for index, (left, right) in enumerate(shell):
        rect(grid, left, 2 + index, right - left, 1, SUIT)
    rect(grid, 4, 11, 8, 1, SUIT_DARK)
    rect(grid, 5, 12, 6, 1, SUIT_DARK)
    rect(grid, 6, 13, 4, 1, GLOVE_DARK)
    for row in range(2, 14):
        for col in range(3, 13):
            if grid[row][col] == CLEAR:
                continue
            if col < 6:
                grid[row][col] = SUIT if row < 8 else SUIT_DARK
    # Red spots, in the shape of the suit's gloves and boots.
    for col, row in ((6, 4), (9, 6), (5, 8), (10, 9), (7, 10)):
        grid[row][col] = GLOVE
        grid[row][col + 1] = GLOVE_DARK
    grid[5][6] = INK  # two blank eyes peering out
    grid[5][9] = INK
    return grid


def pack_icon():
    grid = canvas(16, 16, (36, 34, 40, 255))
    for row in range(16):
        for col in range(16):
            if (col + row) % 6 == 0:
                grid[row][col] = (52, 48, 56, 255)
    # Impact flash behind the fist.
    for row in range(16):
        for col in range(16):
            if abs(col - 9) + abs(row - 8) < 8:
                grid[row][col] = SUIT_DARK
            if abs(col - 9) + abs(row - 8) < 5:
                grid[row][col] = SUIT
    # A red glove, thrown straight at you.
    rect(grid, 6, 6, 6, 5, GLOVE)
    rect(grid, 6, 6, 6, 1, GLOVE_DARK)
    rect(grid, 6, 10, 6, 1, GLOVE_DARK)
    rect(grid, 7, 7, 1, 3, (232, 96, 88, 255))
    rect(grid, 5, 11, 4, 2, CAPE)  # a flick of cape
    return grid


def preview(grid):
    ramp = " .:-=+*#%@"
    return "\n".join(
        "".join(
            " " if px[3] < 32 else ramp[min(9, (px[0] + px[1] + px[2]) // 3 * 10 // 256)]
            for px in row
        )
        for row in grid
    )


def main():
    show = "--preview" in sys.argv

    sheet = entity_sheet()
    write_png(ENTITY_PNG, sheet)
    egg = spawn_egg()
    write_png(EGG_PNG, egg)
    icon = pack_icon()
    for path in PACK_ICONS:
        write_png(path, icon)

    if show:
        print("=== entity sheet ===")
        print(preview(sheet))
        print("\n=== spawn egg ===")
        print(preview(egg))

    print("Wrote the hero sheet, the spawn egg icon and 2 pack icons.")


if __name__ == "__main__":
    main()
