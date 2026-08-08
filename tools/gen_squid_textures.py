#!/usr/bin/env python3
"""Generate every texture for the Squid Game add-on.

Pure standard library - RGBA PNGs are written byte by byte so the packs can be
rebuilt on any machine without image tooling installed.

Produces:
  resource_packs/squid_game_rp/textures/items/*.png     4 x 16x16 item icons
  resource_packs/squid_game_rp/textures/entity/*.png    1 x 64x64 Young-hee skin
  behavior_packs/squid_game_bp/pack_icon.png            64x64
  resource_packs/squid_game_rp/pack_icon.png            64x64

Usage:  python3 tools/gen_squid_textures.py [--preview]
"""

import os
import struct
import sys
import zlib

BP = os.path.join("behavior_packs", "squid_game_bp")
RP = os.path.join("resource_packs", "squid_game_rp")
ITEM_DIR = os.path.join(RP, "textures", "items")
ENTITY_DIR = os.path.join(RP, "textures", "entity")

CLEAR = (0, 0, 0, 0)


# --------------------------------------------------------------------------
# PNG output
# --------------------------------------------------------------------------

def write_png(path, pixels):
    """pixels: list of rows, each row a list of (r, g, b, a) tuples."""
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


def blank(width, height, fill=CLEAR):
    return [[fill for _ in range(width)] for _ in range(height)]


def rect(grid, x, y, w, h, colour):
    for row in range(y, y + h):
        for col in range(x, x + w):
            if 0 <= row < len(grid) and 0 <= col < len(grid[0]):
                grid[row][col] = colour


def px(grid, x, y, colour):
    if 0 <= y < len(grid) and 0 <= x < len(grid[0]):
        grid[y][x] = colour


# --------------------------------------------------------------------------
# Shared palette
# --------------------------------------------------------------------------

HAIR = (26, 26, 30, 255)
HAIR_HI = (48, 48, 56, 255)
SKIN = (243, 211, 184, 255)
SKIN_SH = (214, 176, 148, 255)
BLUSH = (231, 156, 149, 255)
EYE = (32, 26, 24, 255)
EYE_HI = (255, 255, 255, 255)
MOUTH = (184, 68, 63, 255)
SWEATER = (224, 102, 60, 255)
SWEATER_SH = (176, 74, 40, 255)
SWEATER_HI = (240, 138, 96, 255)
SKIRT = (240, 196, 25, 255)
SKIRT_SH = (198, 156, 12, 255)
SOCK = (245, 245, 240, 255)
SHOE = (40, 34, 40, 255)
GREEN = (36, 152, 88, 255)
RED = (198, 46, 54, 255)
WHITE = (250, 250, 250, 255)
DARK = (24, 22, 28, 255)
GOLD = (226, 178, 54, 255)
GOLD_HI = (250, 219, 122, 255)
GOLD_SH = (166, 124, 26, 255)
GRAY = (150, 152, 160, 255)
WOOD = (140, 96, 56, 255)


# --------------------------------------------------------------------------
# Item icons - painted from 16x16 ASCII grids
# --------------------------------------------------------------------------

WHISTLE = [
    "................",
    "..............o.",
    ".............oLo",
    ".............o.o",
    "....ooooooooo.o.",
    "...oLLLLLLLLLo..",
    "..oLHHHHHHHHLo..",
    ".oLHHHHHHHHHHLo.",
    "oMMLHHHDDHHHHLo.",
    "oMMLHHHDDHHHHLo.",
    ".oLHHHHHHHHHHLo.",
    "..oLHHHHHHHHLLo.",
    "...oSSSSSSSSSo..",
    "....ooooooooo...",
    "................",
    "................",
]

WHISTLE_PALETTE = {
    "o": DARK,
    "L": GOLD_HI,
    "H": GOLD,
    "S": GOLD_SH,
    "M": GRAY,
    "D": DARK,
}

DOLL = [
    "................",
    "...KK......KK...",
    "..KKKKKKKKKKKK..",
    "..KKKKKKKKKKKK..",
    ".KKKSSSSSSSSKKK.",
    ".KKSSSSSSSSSSKK.",
    ".KKSSEESSEESSKK.",
    ".KKSSEESSEESSKK.",
    ".KKSSSSSSSSSSKK.",
    ".KKSBSSBBSSBSKK.",
    ".KKKSSSSSSSSKKK.",
    "..KKSSSSSSSSKK..",
    "...KKKKKKKKKK...",
    "......WWWW......",
    "......WWWW......",
    "......WWWW......",
]

DOLL_PALETTE = {
    "K": HAIR,
    "S": SKIN,
    "E": EYE,
    "B": MOUTH,
    "W": WOOD,
}

FLAG = [
    "...PP...........",
    "...PPNNWWNNWW...",
    "...PPNNWWNNWW...",
    "...PPWWNNWWNN...",
    "...PPWWNNWWNN...",
    "...PPNNWWNNWW...",
    "...PPNNWWNNWW...",
    "...PP...........",
    "...PP...........",
    "...PP...........",
    "...PP...........",
    "...PP...........",
    "...PP...........",
    "..RRRRRR........",
    "..RRRRRR........",
    "................",
]

FLAG_PALETTE = {
    "P": GRAY,
    "N": DARK,
    "W": WHITE,
    "R": RED,
}

CARD = [
    "................",
    "................",
    ".oooooooooooooo.",
    ".oGGGGGGGGGGGGo.",
    ".oGGGGGGGGGGGGo.",
    ".oWGWGWWWGWWWGo.",
    ".oWGWGWGGGWGGGo.",
    ".oWWWGWWWGWWWGo.",
    ".oGGWGGGWGWGWGo.",
    ".oGGWGWWWGWWWGo.",
    ".oGGGGGGGGGGGGo.",
    ".oGGGGGGGGGGGGo.",
    ".oGGGGGGGGGGGGo.",
    ".oooooooooooooo.",
    "................",
    "................",
]

CARD_PALETTE = {
    "o": DARK,
    "G": GREEN,
    "W": WHITE,
}


def from_ascii(rows, palette):
    grid = blank(16, 16)
    for y, line in enumerate(rows):
        if len(line) != 16:
            raise ValueError(f"row {y} is {len(line)} chars, expected 16")
        for x, key in enumerate(line):
            if key != ".":
                grid[y][x] = palette[key]
    return grid


ITEMS = {
    "referee_whistle": (WHISTLE, WHISTLE_PALETTE),
    "doll_summoner": (DOLL, DOLL_PALETTE),
    "finish_line_marker": (FLAG, FLAG_PALETTE),
    "player_card": (CARD, CARD_PALETTE),
}


# --------------------------------------------------------------------------
# Young-hee entity skin (64x64)
# --------------------------------------------------------------------------
#
# Bedrock lays a cube of size (w, h, d) placed at uv (u, v) out as:
#   up     (u + d,         v        )  w x d
#   down   (u + d + w,     v        )  w x d
#   east   (u,             v + d    )  d x h
#   front  (u + d,         v + d    )  w x h
#   west   (u + d + w,     v + d    )  d x h
#   back   (u + d + w + d, v + d    )  w x h
# The helpers below use that layout so the painted regions line up with
# models/entity/young_hee.geo.json.


def cube_region(grid, uv, size, colour):
    """Fill the whole unwrapped footprint of a cube with one colour."""
    u, v = uv
    w, h, d = size
    rect(grid, u, v, 2 * (w + d), d, colour)          # up + down strip
    rect(grid, u, v + d, 2 * (w + d), h, colour)      # the four sides


def cube_face(grid, uv, size, face):
    """Return (x, y, w, h) of one face inside the cube's footprint."""
    u, v = uv
    w, h, d = size
    return {
        "up": (u + d, v, w, d),
        "down": (u + d + w, v, w, d),
        "east": (u, v + d, d, h),
        "front": (u + d, v + d, w, h),
        "west": (u + d + w, v + d, d, h),
        "back": (u + d + w + d, v + d, w, h),
    }[face]


def paint_side_rows(grid, uv, size, row_from, row_to, colour):
    """Colour a horizontal band across all four side faces of a cube."""
    u, v = uv
    w, h, d = size
    rect(grid, u, v + d + row_from, 2 * (w + d), row_to - row_from, colour)


HEAD_UV, HEAD_SIZE = (0, 0), (8, 8, 8)
BODY_UV, BODY_SIZE = (16, 16), (8, 12, 4)
SKIRT_UV, SKIRT_SIZE = (16, 32), (10, 8, 6)
LARM_UV, LARM_SIZE = (0, 32), (4, 12, 4)
RARM_UV, RARM_SIZE = (40, 16), (4, 12, 4)
LLEG_UV, LLEG_SIZE = (0, 48), (4, 12, 4)
RLEG_UV, RLEG_SIZE = (16, 48), (4, 12, 4)
LTAIL_UV, LTAIL_SIZE = (40, 0), (3, 9, 3)
RTAIL_UV, RTAIL_SIZE = (48, 32), (3, 9, 3)


def paint_head(grid):
    cube_region(grid, HEAD_UV, HEAD_SIZE, HAIR)

    # Faint highlight along the parting so the hair is not a flat black slab.
    x, y, w, _h = cube_face(grid, HEAD_UV, HEAD_SIZE, "up")
    rect(grid, x + 1, y + 1, w - 2, 2, HAIR_HI)

    # Face.
    fx, fy, fw, fh = cube_face(grid, HEAD_UV, HEAD_SIZE, "front")
    rect(grid, fx, fy, fw, fh, SKIN)
    rect(grid, fx, fy, fw, 2, HAIR)                 # blunt fringe
    rect(grid, fx, fy, 1, 4, HAIR)                  # side locks
    rect(grid, fx + fw - 1, fy, 1, 4, HAIR)
    rect(grid, fx, fy + fh - 1, fw, 1, SKIN_SH)     # chin shadow

    # Wide staring eyes.
    for ex in (fx + 2, fx + 5):
        rect(grid, ex, fy + 3, 1, 2, EYE)
        px(grid, ex, fy + 3, EYE_HI)

    px(grid, fx + 1, fy + 5, BLUSH)
    px(grid, fx + 6, fy + 5, BLUSH)
    rect(grid, fx + 3, fy + 6, 2, 1, MOUTH)

    # Chin underside reads as skin, not hair.
    dx, dy, dw, dh = cube_face(grid, HEAD_UV, HEAD_SIZE, "down")
    rect(grid, dx, dy, dw, dh, SKIN_SH)

    cube_region(grid, LTAIL_UV, LTAIL_SIZE, HAIR)
    cube_region(grid, RTAIL_UV, RTAIL_SIZE, HAIR)
    # Tied-off tips.
    paint_side_rows(grid, LTAIL_UV, LTAIL_SIZE, 7, 9, SWEATER_SH)
    paint_side_rows(grid, RTAIL_UV, RTAIL_SIZE, 7, 9, SWEATER_SH)


def paint_body(grid):
    cube_region(grid, BODY_UV, BODY_SIZE, SWEATER)
    paint_side_rows(grid, BODY_UV, BODY_SIZE, 0, 1, SOCK)        # collar
    paint_side_rows(grid, BODY_UV, BODY_SIZE, 5, 6, SWEATER_SH)  # knit band
    paint_side_rows(grid, BODY_UV, BODY_SIZE, 10, 12, SKIRT_SH)  # waist

    fx, fy, fw, fh = cube_face(grid, BODY_UV, BODY_SIZE, "front")
    rect(grid, fx + 3, fy + 1, 2, 3, SWEATER_HI)                 # buttons strip
    px(grid, fx + 3, fy + 2, SOCK)
    _ = fh

    cube_region(grid, SKIRT_UV, SKIRT_SIZE, SKIRT)
    paint_side_rows(grid, SKIRT_UV, SKIRT_SIZE, 0, 1, SKIRT_SH)
    # Pleats: every other column down the whole skirt band.
    u, v = SKIRT_UV
    w, h, d = SKIRT_SIZE
    for col in range(u, u + 2 * (w + d), 3):
        rect(grid, col, v + d, 1, h, SKIRT_SH)


def paint_arm(grid, uv, size):
    cube_region(grid, uv, size, SWEATER)
    paint_side_rows(grid, uv, size, 0, 1, SWEATER_HI)   # shoulder seam
    paint_side_rows(grid, uv, size, 8, 9, SWEATER_SH)   # cuff
    paint_side_rows(grid, uv, size, 9, 12, SKIN)        # hand
    x, y, w, h = cube_face(grid, uv, size, "down")
    rect(grid, x, y, w, h, SKIN_SH)                     # palm


def paint_leg(grid, uv, size):
    cube_region(grid, uv, size, SKIN)
    paint_side_rows(grid, uv, size, 6, 9, SOCK)         # knee sock
    paint_side_rows(grid, uv, size, 9, 12, SHOE)        # shoe
    x, y, w, h = cube_face(grid, uv, size, "up")
    rect(grid, x, y, w, h, SKIRT_SH)                    # hidden under the skirt
    x, y, w, h = cube_face(grid, uv, size, "down")
    rect(grid, x, y, w, h, SHOE)                        # sole


def young_hee_skin():
    grid = blank(64, 64)
    paint_head(grid)
    paint_body(grid)
    paint_arm(grid, LARM_UV, LARM_SIZE)
    paint_arm(grid, RARM_UV, RARM_SIZE)
    paint_leg(grid, LLEG_UV, LLEG_SIZE)
    paint_leg(grid, RLEG_UV, RLEG_SIZE)
    return grid


# --------------------------------------------------------------------------
# Pack icon - green light over red light, doll in the middle
# --------------------------------------------------------------------------

def pack_icon():
    grid = blank(64, 64, DARK)
    rect(grid, 0, 0, 64, 32, GREEN)
    rect(grid, 0, 32, 64, 32, RED)
    rect(grid, 0, 31, 64, 2, DARK)

    doll = from_ascii(DOLL, DOLL_PALETTE)
    # Nearest-neighbour 3x upscale, centred, skipping the stick rows.
    scale = 3
    ox, oy = (64 - 16 * scale) // 2, (64 - 16 * scale) // 2
    for y in range(16):
        for x in range(16):
            colour = doll[y][x]
            if colour[3] == 0:
                continue
            rect(grid, ox + x * scale, oy + y * scale, scale, scale, colour)
    return grid


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------

def preview(name, grid):
    print(f"\n{name}")
    for row in grid:
        print("".join("  " if c[3] == 0 else "##" for c in row))


def main():
    show = "--preview" in sys.argv
    written = []

    for name, (rows, palette) in ITEMS.items():
        grid = from_ascii(rows, palette)
        path = os.path.join(ITEM_DIR, f"{name}.png")
        write_png(path, grid)
        written.append(path)
        if show:
            preview(name, grid)

    skin = young_hee_skin()
    skin_path = os.path.join(ENTITY_DIR, "young_hee.png")
    write_png(skin_path, skin)
    written.append(skin_path)

    icon = pack_icon()
    for path in (
        os.path.join(BP, "pack_icon.png"),
        os.path.join(RP, "pack_icon.png"),
    ):
        write_png(path, icon)
        written.append(path)

    for path in written:
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
