#!/usr/bin/env python3
"""Generate the Graveyard Horror textures.

Pure standard library. The tombstone and wraith sheets are painted onto the
box-UV layouts of their models - for a cube at uv (u, v) with size (w, h, d):

    top    (u + d,      v,     w, d)
    bottom (u + d + w,  v,     w, d)
    east   (u,          v + d, d, h)
    north  (u + d,      v + d, w, h)   <- the face you look at
    west   (u + d + w,  v + d, d, h)
    south  (u + 2d + w, v + d, w, h)

Move a cube in either model and its paint has to move here to match.

Usage:  python3 tools/gen_graveyard_textures.py [--preview]
"""

import os
import struct
import sys
import zlib

RP = os.path.join("resource_packs", "graveyard_horror_rp")
BLOCK_DIR = os.path.join(RP, "textures", "blocks")
ITEM_DIR = os.path.join(RP, "textures", "items")
ENTITY_DIR = os.path.join(RP, "textures", "entity")
PACK_ICONS = (
    os.path.join("behavior_packs", "graveyard_horror_bp", "pack_icon.png"),
    os.path.join(RP, "pack_icon.png"),
)

CLEAR = (0, 0, 0, 0)

# Everything is drained of colour except what the wraith brings with it.
SOIL = (58, 48, 38, 255)
SOIL_DARK = (40, 33, 26, 255)
SOIL_LIGHT = (78, 66, 52, 255)
BONE = (198, 192, 172, 255)
STONE = (110, 110, 104, 255)
STONE_DARK = (78, 78, 74, 255)
STONE_LIGHT = (142, 142, 134, 255)
MOSS = (72, 96, 58, 255)
MOSS_DARK = (52, 72, 42, 255)
IRON = (62, 62, 66, 255)
IRON_LIGHT = (96, 96, 102, 255)
SOULFIRE = (150, 246, 226, 255)
SOULFIRE_DIM = (86, 176, 168, 255)
SHROUD = (48, 54, 52, 255)
SHROUD_DARK = (30, 34, 34, 255)
SHROUD_LIGHT = (72, 80, 76, 255)
EYE = (188, 255, 236, 255)
INK = (24, 22, 20, 255)
PAPER = (176, 166, 140, 255)


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


def mottle(grid, x, y, w, h, colours, salt=0):
    for row in range(y, y + h):
        for col in range(x, x + w):
            if 0 <= row < len(grid) and 0 <= col < len(grid[0]):
                grid[row][col] = colours[noise(col, row, salt) % len(colours)]


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


def paint_cube(grid, uv, size, colours, salt=0):
    for x, y, w, h in faces(uv, size).values():
        mottle(grid, x, y, w, h, colours, salt)


# --------------------------------------------------------------------------
# Block tiles
# --------------------------------------------------------------------------

def grave_soil_tile():
    """Churned grave earth, with bone splinters surfacing."""
    grid = canvas(16, 16)
    mottle(grid, 0, 0, 16, 16, [SOIL, SOIL_DARK, SOIL_LIGHT, SOIL], salt=1)
    for col, row in ((3, 4), (10, 2), (6, 9), (12, 11), (2, 13)):
        grid[row][col] = BONE
        if col + 1 < 16:
            grid[row][col + 1] = BONE
    for col in range(16):  # a raked, disturbed surface
        grid[0][col] = SOIL_DARK if col % 3 else SOIL
    return grid


def crypt_stone_tile():
    """Old cracked masonry with moss creeping into the joints."""
    grid = canvas(16, 16)
    mottle(grid, 0, 0, 16, 16, [STONE, STONE_DARK, STONE_LIGHT], salt=2)
    for row in (0, 8):  # courses
        rect(grid, 0, row, 16, 1, STONE_DARK)
    for row, col in ((0, 7), (8, 3), (8, 12)):
        rect(grid, col, row, 1, 8, STONE_DARK)
    # Cracks and moss.
    for step in range(6):
        grid[3 + step][4 + (step % 2)] = STONE_DARK
    for col, row in ((1, 9), (2, 10), (13, 2), (14, 3), (9, 13), (10, 14)):
        grid[row][col] = MOSS
        if row + 1 < 16:
            grid[row + 1][col] = MOSS_DARK
    return grid


def grave_lantern_tile():
    """Iron cage around a soul flame - the ward."""
    grid = canvas(16, 16)
    mottle(grid, 0, 0, 16, 16, [IRON, IRON_LIGHT], salt=3)
    rect(grid, 3, 3, 10, 10, SOULFIRE_DIM)
    rect(grid, 4, 4, 8, 8, SOULFIRE)
    # Cage bars over the glass.
    for col in (3, 8, 12):
        rect(grid, col, 2, 1, 12, IRON)
    for row in (2, 13):
        rect(grid, 2, row, 12, 1, IRON)
    # Flame core.
    rect(grid, 6, 6, 4, 5, (226, 255, 250, 255))
    rect(grid, 7, 5, 2, 1, (226, 255, 250, 255))
    return grid


def tombstone_sheet():
    """32x32 sheet for the tombstone model: base, slab, cap."""
    grid = canvas(32, 32)
    paint_cube(grid, (0, 0), (10, 2, 6), [STONE_DARK, STONE], salt=4)     # base
    paint_cube(grid, (0, 10), (8, 12, 3), [STONE, STONE_LIGHT, STONE_DARK], salt=5)
    paint_cube(grid, (0, 26), (6, 2, 3), [STONE, STONE_LIGHT], salt=6)    # cap

    # A carved cross reads at eight pixels wide; lettering does not.
    carve = (52, 52, 48, 255)
    fx, fy, _, _ = faces((0, 10), (8, 12, 3))["north"]
    rect(grid, fx + 3, fy + 1, 2, 7, carve)      # upright
    rect(grid, fx + 1, fy + 3, 6, 2, carve)      # arms
    rect(grid, fx + 3, fy + 1, 2, 1, STONE_LIGHT)  # the light catches the top edge
    # Two engraved lines where a name would go, then weathering and moss.
    rect(grid, fx + 1, fy + 9, 6, 1, carve)
    rect(grid, fx + 2, fy + 11, 4, 1, carve)
    grid[fy + 8][fx + 1] = MOSS
    grid[fy + 9][fx] = MOSS_DARK
    grid[fy + 10][fx + 7] = MOSS_DARK
    return grid


# --------------------------------------------------------------------------
# The wraith
# --------------------------------------------------------------------------

def wraith_sheet():
    grid = canvas(64, 64)

    # Hood: darkest of all, with two lights inside it.
    paint_cube(grid, (0, 0), (9, 9, 9), [SHROUD_DARK, SHROUD], salt=7)
    hx, hy, _, _ = faces((0, 0), (9, 9, 9))["north"]
    rect(grid, hx + 1, hy + 2, 7, 6, (16, 18, 18, 255))   # the void inside the hood
    rect(grid, hx + 2, hy + 4, 2, 2, EYE)
    rect(grid, hx + 5, hy + 4, 2, 2, EYE)
    rect(grid, hx, hy, 9, 1, SHROUD_LIGHT)                # lit edge of the cowl

    # Robe.
    paint_cube(grid, (0, 20), (8, 14, 4), [SHROUD, SHROUD_DARK, SHROUD_LIGHT], salt=8)
    bx, by, _, _ = faces((0, 20), (8, 14, 4))["north"]
    for step in range(4):                                  # cord and folds
        rect(grid, bx, by + 4 + step * 3, 8, 1, SHROUD_DARK)
    rect(grid, bx + 3, by + 1, 2, 2, SOULFIRE_DIM)         # a cold light at the throat

    # Sleeves, fading to nothing where hands would be.
    for uv in ((28, 20), (44, 20)):
        paint_cube(grid, uv, (4, 12, 4), [SHROUD, SHROUD_DARK], salt=9)
        for name, (x, y, w, h) in faces(uv, (4, 12, 4)).items():
            if name in ("top", "bottom"):
                continue
            rect(grid, x, y + h - 2, w, 1, SHROUD_DARK)
            rect(grid, x, y + h - 1, w, 1, CLEAR)

    # Shroud and tatters: ragged, see-through at the hem.
    paint_cube(grid, (0, 40), (8, 9, 4), [SHROUD_DARK, SHROUD], salt=10)
    for name, (x, y, w, h) in faces((0, 40), (8, 9, 4)).items():
        if name in ("top", "bottom"):
            continue
        for col in range(w):
            if (col + noise(col, y, 11)) % 3 == 0:
                rect(grid, x + col, y + h - 2, 1, 2, CLEAR)
    paint_cube(grid, (28, 40), (4, 6, 2), [SHROUD_DARK], salt=12)
    for name, (x, y, w, h) in faces((28, 40), (4, 6, 2)).items():
        if name in ("top", "bottom"):
            continue
        rect(grid, x, y + h - 2, w, 2, CLEAR)
        rect(grid, x + (w // 2), y + h - 2, 1, 1, SHROUD_DARK)
    return grid


# --------------------------------------------------------------------------
# Items
# --------------------------------------------------------------------------

def ledger_icon():
    """A gravekeeper's book: dark cover, bone clasp, brittle pages."""
    grid = canvas(16, 16)
    rect(grid, 2, 2, 12, 13, (46, 40, 36, 255))       # cover
    rect(grid, 3, 3, 10, 11, (34, 30, 28, 255))
    rect(grid, 11, 3, 3, 11, PAPER)                   # page block
    for row in range(4, 14, 2):
        rect(grid, 11, row, 3, 1, (146, 136, 112, 255))
    rect(grid, 2, 2, 1, 13, INK)                      # spine
    rect(grid, 5, 5, 5, 1, BONE)                      # bone clasp
    rect(grid, 7, 5, 1, 5, BONE)
    rect(grid, 5, 12, 6, 1, (86, 76, 66, 255))
    grid[7][6] = SOULFIRE_DIM
    grid[8][8] = SOULFIRE_DIM
    return grid


def spawn_egg_icon():
    grid = canvas(16, 16)
    shell = [(6, 10), (5, 11), (4, 12), (3, 13), (3, 13), (3, 13), (3, 13), (4, 12), (5, 11)]
    for index, (left, right) in enumerate(shell):
        rect(grid, left, 2 + index, right - left, 1, SHROUD)
    rect(grid, 4, 11, 8, 1, SHROUD_DARK)
    rect(grid, 5, 12, 6, 1, SHROUD_DARK)
    rect(grid, 6, 13, 4, 1, (16, 18, 18, 255))
    for row in range(2, 14):
        for col in range(3, 13):
            if grid[row][col] == CLEAR:
                continue
            if col < 6:
                grid[row][col] = SHROUD_LIGHT if row < 8 else SHROUD
    for col, row in ((6, 5), (9, 7), (5, 9), (10, 10)):
        grid[row][col] = SOULFIRE_DIM
    grid[6][6] = EYE
    grid[6][9] = EYE
    return grid


def pack_icon():
    """A tombstone under a cold moon, fog at its foot."""
    night = (22, 26, 30, 255)
    grid = canvas(16, 16, night)
    for row in range(16):
        for col in range(16):
            if noise(col, row, 13) % 23 == 0:
                grid[row][col] = (44, 50, 56, 255)     # stars
    rect(grid, 10, 1, 4, 4, (196, 214, 210, 255))      # moon
    rect(grid, 11, 2, 2, 2, (226, 240, 236, 255))
    rect(grid, 6, 5, 5, 8, STONE)                      # tombstone
    rect(grid, 7, 4, 3, 1, STONE)
    rect(grid, 6, 5, 5, 1, STONE_LIGHT)
    rect(grid, 7, 7, 3, 1, STONE_DARK)
    rect(grid, 7, 9, 3, 1, STONE_DARK)
    rect(grid, 5, 13, 7, 1, SOIL_DARK)                 # mound
    rect(grid, 4, 14, 9, 2, SOIL)
    for col in range(0, 16, 3):                        # fog
        grid[12][col] = (60, 70, 76, 255)
        grid[13][(col + 1) % 16] = (52, 60, 66, 255)
    grid[8][8] = SOULFIRE_DIM
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


BLOCKS = {
    "grave_soil": grave_soil_tile,
    "grave_crypt_stone": crypt_stone_tile,
    "grave_lantern": grave_lantern_tile,
    "grave_tombstone": tombstone_sheet,
}

ITEMS = {
    "gravekeepers_ledger": ledger_icon,
    "grave_wraith_spawn_egg": spawn_egg_icon,
}


def main():
    show = "--preview" in sys.argv

    for name, factory in BLOCKS.items():
        grid = factory()
        write_png(os.path.join(BLOCK_DIR, f"{name}.png"), grid)
        if show:
            print(f"\n=== block {name} ===\n{preview(grid)}")

    for name, factory in ITEMS.items():
        grid = factory()
        write_png(os.path.join(ITEM_DIR, f"{name}.png"), grid)
        if show:
            print(f"\n=== item {name} ===\n{preview(grid)}")

    sheet = wraith_sheet()
    write_png(os.path.join(ENTITY_DIR, "grave_wraith.png"), sheet)
    if show:
        print(f"\n=== wraith ===\n{preview(sheet)}")

    icon = pack_icon()
    for path in PACK_ICONS:
        write_png(path, icon)

    print(
        f"Wrote {len(BLOCKS)} block textures, {len(ITEMS)} item icons, "
        f"the wraith sheet and 2 pack icons."
    )


if __name__ == "__main__":
    main()
