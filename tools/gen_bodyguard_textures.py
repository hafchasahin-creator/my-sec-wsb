#!/usr/bin/env python3
"""Generate the Bodyguard textures.

Pure standard library. Writes:
  - the 64x64 entity skin (standard Bedrock humanoid UV layout)
  - the 16x16 Bodyguard Contract icon
  - a pack icon for each pack, made by scaling up the face

Usage:  python3 tools/gen_bodyguard_textures.py [--preview]
"""

import os
import struct
import sys
import zlib

BP = os.path.join("behavior_packs", "bodyguard_bp")
RP = os.path.join("resource_packs", "bodyguard_rp")

TRANSPARENT = (0, 0, 0, 0)

# Suit and skin palette.
SKIN = (206, 162, 122, 255)
SKIN_SHADE = (172, 128, 92, 255)
HAIR = (38, 30, 28, 255)
HAIR_LIGHT = (64, 52, 46, 255)
SUIT = (38, 41, 52, 255)
SUIT_LIGHT = (58, 62, 78, 255)
SHIRT = (236, 239, 245, 255)
TIE = (168, 40, 46, 255)
TIE_DARK = (124, 26, 32, 255)
SHADES = (14, 14, 18, 255)
SHINE = (78, 92, 112, 255)
SHOE = (16, 16, 20, 255)
MOUTH = (146, 96, 78, 255)
BUTTON = (96, 98, 110, 255)


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


def canvas(width, height, colour=TRANSPARENT):
    return [[colour for _ in range(width)] for _ in range(height)]


def rect(grid, x0, y0, x1, y1, colour):
    """Inclusive rectangle."""
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if 0 <= y < len(grid) and 0 <= x < len(grid[0]):
                grid[y][x] = colour


def dot(grid, x, y, colour):
    if 0 <= y < len(grid) and 0 <= x < len(grid[0]):
        grid[y][x] = colour


def scale(grid, factor):
    out = []
    for row in grid:
        line = []
        for px in row:
            line.extend([px] * factor)
        for _ in range(factor):
            out.append(list(line))
    return out


# --------------------------------------------------------------------------
# The skin
#
# Standard 64x64 Bedrock/Java humanoid layout. Each limb is one 16x16 (or
# 32x16) block of the sheet: top and bottom faces on the upper strip, then
# right / front / left / back side by side underneath.
# --------------------------------------------------------------------------

def build_skin():
    grid = canvas(64, 64)

    # ---- Head, uv [0, 0] ----
    rect(grid, 0, 8, 31, 15, SKIN)      # all four sides
    rect(grid, 8, 0, 15, 7, HAIR)       # top of the head
    rect(grid, 16, 0, 23, 7, SKIN_SHADE)  # under the chin

    # Sides and back: hair along the top, skin below.
    rect(grid, 0, 8, 7, 9, HAIR)
    rect(grid, 16, 8, 23, 9, HAIR)
    rect(grid, 24, 8, 31, 11, HAIR)

    # Face.
    rect(grid, 8, 8, 15, 9, HAIR)       # fringe
    dot(grid, 9, 9, HAIR_LIGHT)
    dot(grid, 12, 9, HAIR_LIGHT)
    rect(grid, 8, 10, 15, 11, SHADES)   # sunglasses, temple to temple
    rect(grid, 11, 11, 12, 11, SKIN_SHADE)  # nose bridge, so it reads as two lenses
    dot(grid, 9, 11, SHINE)
    dot(grid, 14, 11, SHINE)
    rect(grid, 11, 12, 12, 12, SKIN_SHADE)  # nose
    rect(grid, 11, 14, 12, 14, MOUTH)       # mouth
    dot(grid, 10, 14, SKIN_SHADE)
    dot(grid, 13, 14, SKIN_SHADE)
    rect(grid, 8, 15, 15, 15, SKIN_SHADE)   # jaw line

    # ---- Hair layer (hat), uv [32, 0] ----
    rect(grid, 40, 0, 47, 7, HAIR)      # top
    dot(grid, 42, 2, HAIR_LIGHT)
    dot(grid, 45, 3, HAIR_LIGHT)
    dot(grid, 43, 5, HAIR_LIGHT)
    rect(grid, 40, 8, 47, 9, HAIR)      # fringe over the forehead
    rect(grid, 32, 8, 39, 10, HAIR)     # right side
    rect(grid, 48, 8, 55, 10, HAIR)     # left side
    rect(grid, 56, 8, 63, 11, HAIR)     # back

    # ---- Body, uv [16, 16] ----
    rect(grid, 16, 20, 39, 31, SUIT)
    rect(grid, 20, 16, 27, 19, SUIT_LIGHT)   # shoulders
    rect(grid, 28, 16, 35, 19, SUIT)         # underside

    rect(grid, 22, 20, 25, 25, SHIRT)        # shirt
    rect(grid, 21, 20, 21, 24, SUIT_LIGHT)   # lapels
    rect(grid, 26, 20, 26, 24, SUIT_LIGHT)
    rect(grid, 23, 21, 24, 27, TIE)          # tie
    rect(grid, 23, 20, 24, 20, TIE_DARK)     # knot
    dot(grid, 26, 23, SHIRT)                 # pocket square
    dot(grid, 24, 29, BUTTON)                # button
    rect(grid, 35, 20, 36, 31, SUIT_LIGHT)   # seam up the back

    # ---- Right arm, uv [40, 16] ----
    rect(grid, 40, 20, 55, 31, SUIT)
    rect(grid, 44, 16, 47, 19, SUIT_LIGHT)   # shoulder top
    rect(grid, 40, 27, 55, 27, SHIRT)        # cuff
    rect(grid, 40, 28, 55, 31, SKIN)         # hand
    rect(grid, 48, 16, 51, 19, SKIN)         # bottom face

    # ---- Left arm, uv [32, 48] ----
    rect(grid, 32, 52, 47, 63, SUIT)
    rect(grid, 36, 48, 39, 51, SUIT_LIGHT)
    rect(grid, 32, 59, 47, 59, SHIRT)
    rect(grid, 32, 60, 47, 63, SKIN)
    rect(grid, 40, 48, 43, 51, SKIN)

    # ---- Right leg, uv [0, 16] ----
    rect(grid, 0, 20, 15, 31, SUIT)
    rect(grid, 4, 16, 7, 19, SUIT)
    rect(grid, 0, 29, 15, 31, SHOE)
    rect(grid, 8, 16, 11, 19, SHOE)          # sole

    # ---- Left leg, uv [16, 48] ----
    rect(grid, 16, 52, 31, 63, SUIT)
    rect(grid, 20, 48, 23, 51, SUIT)
    rect(grid, 16, 61, 31, 63, SHOE)
    rect(grid, 24, 48, 27, 51, SHOE)

    return grid


def build_contract():
    grid = canvas(16, 16)

    rect(grid, 2, 2, 13, 13, (218, 196, 152, 255))     # parchment
    rect(grid, 2, 2, 13, 3, (196, 172, 128, 255))      # rolled top
    rect(grid, 2, 12, 13, 13, (196, 172, 128, 255))    # rolled bottom
    for row in (5, 7, 9):
        rect(grid, 4, row, 11, row, (120, 100, 70, 255))
    rect(grid, 4, 11, 8, 11, (120, 100, 70, 255))      # signature line

    # Wax seal with a gold ring.
    rect(grid, 9, 9, 12, 12, (168, 40, 46, 255))
    dot(grid, 9, 9, (214, 168, 58, 255))
    dot(grid, 12, 9, (214, 168, 58, 255))
    dot(grid, 9, 12, (214, 168, 58, 255))
    dot(grid, 12, 12, (214, 168, 58, 255))
    dot(grid, 10, 10, (206, 92, 96, 255))

    # Outline.
    outlined = [row[:] for row in grid]
    for y in range(16):
        for x in range(16):
            if grid[y][x] == TRANSPARENT:
                neighbours = [
                    grid[y + dy][x + dx]
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
                    if 0 <= x + dx < 16 and 0 <= y + dy < 16
                ]
                if any(px != TRANSPARENT for px in neighbours):
                    outlined[y][x] = (54, 42, 28, 255)
    return outlined


def build_spawn_egg():
    """A drawn spawn egg. A texture is more reliable than the colour fields:
    an unrecognised colour key just means no icon is generated at all."""
    grid = canvas(16, 16)

    shell = [
        (2, 6, 9), (3, 5, 10), (4, 4, 11), (5, 4, 11), (6, 3, 12), (7, 3, 12),
        (8, 3, 12), (9, 3, 12), (10, 4, 11), (11, 4, 11), (12, 5, 10), (13, 6, 9),
    ]
    for row, x0, x1 in shell:
        rect(grid, x0, row, x1, row, SUIT)

    # Lit side, so it reads as an egg and not a flat blob.
    for row, x0, x1 in shell[:6]:
        rect(grid, x0, row, min(x0 + 1, x1), row, SUIT_LIGHT)

    # Red speckles, the tie colour.
    for x, y in ((6, 4), (9, 6), (5, 8), (10, 9), (7, 11)):
        dot(grid, x, y, TIE)
    dot(grid, 7, 3, SHIRT)

    outlined = [row[:] for row in grid]
    for y in range(16):
        for x in range(16):
            if grid[y][x] != TRANSPARENT:
                continue
            neighbours = [
                grid[y + dy][x + dx]
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
                if 0 <= x + dx < 16 and 0 <= y + dy < 16
            ]
            if any(px != TRANSPARENT for px in neighbours):
                outlined[y][x] = (12, 12, 16, 255)
    return outlined


def preview(grid, x0, y0, x1, y1):
    keys = {
        SKIN: ".", SKIN_SHADE: ",", HAIR: "#", HAIR_LIGHT: "%", SUIT: "8",
        SUIT_LIGHT: "o", SHIRT: "@", TIE: "T", TIE_DARK: "t", SHADES: "=",
        SHINE: "*", SHOE: "_", MOUTH: "u", BUTTON: "+", TRANSPARENT: " ",
    }
    lines = []
    for y in range(y0, y1 + 1):
        lines.append("".join(keys.get(grid[y][x], "?") for x in range(x0, x1 + 1)))
    return "\n".join(lines)


def main():
    skin = build_skin()
    write_png(os.path.join(RP, "textures", "entity", "bodyguard.png"), skin)
    write_png(os.path.join(RP, "textures", "items", "hire_contract.png"), build_contract())
    write_png(
        os.path.join(RP, "textures", "items", "bodyguard_spawn_egg.png"),
        build_spawn_egg(),
    )

    # Pack icon: the face, scaled up 8x so it is readable in the pack list.
    face = [row[8:16] for row in skin[8:16]]
    icon = scale(face, 8)
    for path in (
        os.path.join(BP, "pack_icon.png"),
        os.path.join(RP, "pack_icon.png"),
    ):
        write_png(path, icon)

    if "--preview" in sys.argv:
        print("=== face ===")
        print(preview(skin, 8, 8, 15, 15))
        print("\n=== jacket front ===")
        print(preview(skin, 20, 20, 27, 31))

    print("Wrote the bodyguard skin, 2 item icons and 2 pack icons.")


if __name__ == "__main__":
    main()
