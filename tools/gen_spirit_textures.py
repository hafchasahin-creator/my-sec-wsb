#!/usr/bin/env python3
"""Generate the Guardian Spirit textures.

Pure standard library. The entity sheet is painted straight onto the box-UV
layout of models/entity/guardian.geo.json: for a cube at uv (u, v) with size
(w, h, d) the faces land at

    top    (u + d,         v,     w, d)
    bottom (u + d + w,     v,     w, d)
    east   (u,             v + d, d, h)
    north  (u + d,         v + d, w, h)   <- the face you look at
    west   (u + d + w,     v + d, d, h)
    south  (u + 2d + w,    v + d, w, h)

so if you move a cube in the model, move its paint here to match.

Usage:  python3 tools/gen_spirit_textures.py [--preview]
"""

import os
import struct
import sys
import zlib

RP = os.path.join("resource_packs", "spirit_guardian_rp")
ENTITY_PNG = os.path.join(RP, "textures", "entity", "spirit_guardian.png")
EGG_PNG = os.path.join(RP, "textures", "items", "spirit_guardian_spawn_egg.png")
PACK_ICONS = (
    os.path.join("behavior_packs", "spirit_guardian_bp", "pack_icon.png"),
    os.path.join(RP, "pack_icon.png"),
)

CLEAR = (0, 0, 0, 0)

# Spirit palette: pale cyan light over a deep teal cloak.
GLOW = (236, 255, 255, 255)
PALE = (206, 244, 250, 255)
LIGHT = (166, 226, 240, 255)
MID = (116, 186, 212, 255)
DEEP = (68, 134, 168, 255)
DARK = (36, 82, 112, 255)
SHADOW = (22, 52, 74, 255)
EYE = (150, 255, 246, 255)


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
    """Fill a face with a stable speckle of related colours."""
    for row in range(y, y + h):
        for col in range(x, x + w):
            if 0 <= row < len(grid) and 0 <= col < len(grid[0]):
                grid[row][col] = colours[noise(col, row, salt) % len(colours)]


def faces(uv, size):
    """Face rectangles for one box-UV cube: (x, y, w, h) each."""
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


def paint_cube(grid, uv, size, body, top=None, front=None, salt=0):
    """Base coat for every face, with optional distinct top and front."""
    for name, (x, y, w, h) in faces(uv, size).items():
        palette = body
        if name == "top" and top:
            palette = top
        if name == "north" and front:
            palette = front
        mottle(grid, x, y, w, h, palette, salt)


# --------------------------------------------------------------------------
# The entity sheet
# --------------------------------------------------------------------------

def entity_sheet():
    grid = canvas(64, 64)

    # Head: pale spirit light, with a dark visor band and two glowing eyes.
    paint_cube(grid, (0, 0), (8, 8, 8), [LIGHT, PALE, MID], top=[PALE, GLOW], salt=1)
    head = faces((0, 0), (8, 8, 8))
    hx, hy, _, _ = head["north"]
    rect(grid, hx, hy + 2, 8, 3, SHADOW)          # visor slot
    rect(grid, hx + 1, hy + 3, 2, 1, EYE)         # eyes
    rect(grid, hx + 5, hy + 3, 2, 1, EYE)
    rect(grid, hx, hy + 6, 8, 2, DEEP)            # jaw shadow
    # A crown of light across the top of the head.
    tx, ty, tw, th = head["top"]
    rect(grid, tx + 1, ty + 1, tw - 2, th - 2, GLOW)

    # Body: deep cloak, lighter shoulders, soul gem at the chest.
    paint_cube(grid, (16, 16), (8, 10, 4), [DEEP, DARK, MID], top=[MID, LIGHT], salt=2)
    body = faces((16, 16), (8, 10, 4))
    bx, by, _, _ = body["north"]
    rect(grid, bx, by, 8, 2, LIGHT)               # collar
    rect(grid, bx + 3, by + 3, 2, 2, GLOW)        # soul gem
    rect(grid, bx + 2, by + 2, 4, 1, EYE)
    rect(grid, bx + 2, by + 5, 4, 1, EYE)
    rect(grid, bx, by + 8, 8, 2, SHADOW)          # hem shadow

    # Arms: light at the shoulder, fading to nothing at the wrist.
    for uv in ((40, 16), (52, 16)):
        paint_cube(grid, uv, (3, 10, 3), [LIGHT, MID], top=[PALE], salt=3)
        for name, (x, y, w, h) in faces(uv, (3, 10, 3)).items():
            if name in ("top", "bottom"):
                continue
            rect(grid, x, y + h - 3, w, 1, PALE)
            rect(grid, x, y + h - 2, w, 1, GLOW)
            rect(grid, x, y + h - 1, w, 1, CLEAR)  # wisps, not hands

    # Wings: near-white membrane, ribbed, with a ragged trailing edge.
    for uv, flip in (((0, 42), False), ((24, 42), True)):
        paint_cube(grid, uv, (10, 8, 1), [PALE, GLOW], top=[GLOW], salt=4)
        for name in ("north", "south"):
            x, y, w, h = faces(uv, (10, 8, 1))[name]
            for rib in range(0, w, 3):
                rect(grid, x + rib, y, 1, h, LIGHT)
            # Feathered tips: the trailing edge dissolves toward the bottom.
            for step in range(h):
                cut = step // 2
                if not cut:
                    continue
                edge = x if flip else x + w - cut
                rect(grid, edge, y + h - 1 - step, cut, 1, CLEAR)

    # Tail: the body trails off into a wisp instead of legs.
    paint_cube(grid, (0, 32), (6, 6, 3), [MID, DEEP], top=[DEEP], salt=5)
    paint_cube(grid, (24, 32), (4, 6, 2), [LIGHT, MID], top=[MID], salt=6)
    for name, (x, y, w, h) in faces((24, 32), (4, 6, 2)).items():
        if name in ("top", "bottom"):
            continue
        rect(grid, x, y + h - 2, w, 1, PALE)
        rect(grid, x, y + h - 1, w, 1, CLEAR)     # the tip fades out
    return grid


# --------------------------------------------------------------------------
# Spawn egg icon
# --------------------------------------------------------------------------

def spawn_egg():
    grid = canvas(16, 16)
    shell = [(4, 12), (3, 13), (2, 14), (2, 14), (2, 14), (2, 14), (3, 13), (4, 12)]
    for index, (left, right) in enumerate(shell):
        row = 3 + index
        rect(grid, left, row, right - left, 1, MID)
    # Dome and taper.
    rect(grid, 6, 2, 4, 1, LIGHT)
    rect(grid, 5, 11, 6, 1, DEEP)
    rect(grid, 6, 12, 4, 1, DARK)

    # Shading and the classic spotted overlay, here as soul motes.
    for row in range(2, 13):
        for col in range(2, 14):
            if grid[row][col] == CLEAR:
                continue
            if col < 6:
                grid[row][col] = LIGHT if row < 7 else MID
            elif col > 10:
                grid[row][col] = DEEP
    for col, row in ((5, 4), (9, 5), (6, 8), (10, 9), (7, 11)):
        grid[row][col] = GLOW
        if row + 1 < 16:
            grid[row + 1][col] = PALE
    # Two eyes peering out of the egg.
    grid[6][6] = EYE
    grid[6][9] = EYE
    return grid


def pack_icon():
    grid = canvas(16, 16, (18, 30, 44, 255))
    for row in range(16):
        for col in range(16):
            if (col + row) % 7 == 0:
                grid[row][col] = (28, 44, 62, 255)
    # A little hovering spirit: head, cloak, wings, wisp tail.
    rect(grid, 6, 2, 4, 3, PALE)
    grid[3][7] = EYE
    grid[3][8] = EYE
    rect(grid, 5, 5, 6, 5, DEEP)
    rect(grid, 7, 6, 2, 2, GLOW)
    rect(grid, 2, 5, 3, 2, PALE)
    rect(grid, 11, 5, 3, 2, PALE)
    rect(grid, 6, 10, 4, 2, MID)
    rect(grid, 7, 12, 2, 2, LIGHT)
    grid[14][7] = PALE
    return grid


def preview(grid):
    ramp = " .:-=+*#%@"
    lines = []
    for row in grid:
        line = ""
        for r, g, b, a in row:
            line += " " if a < 32 else ramp[min(9, (r + g + b) // 3 * 10 // 256)]
        lines.append(line)
    return "\n".join(lines)


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

    print("Wrote the entity sheet, the spawn egg icon and 2 pack icons.")


if __name__ == "__main__":
    main()
