#!/usr/bin/env python3
"""Generate the textures for the Luxury Estate add-on.

Pure standard library - writes RGBA PNGs directly so the pack can be rebuilt
on any machine, phone-side file managers included, without image tooling.

Block tiles are 16x16 and tile seamlessly on the X axis so long walls do not
show a visible repeat seam.

Usage:  python3 tools/gen_luxury_textures.py [--preview]
"""

import os
import struct
import sys
import zlib

SIZE = 16
BLOCK_DIR = os.path.join("resource_packs", "luxury_house_rp", "textures", "blocks")
ITEM_DIR = os.path.join("resource_packs", "luxury_house_rp", "textures", "items")
PACK_ICONS = (
    os.path.join("behavior_packs", "luxury_house_bp", "pack_icon.png"),
    os.path.join("resource_packs", "luxury_house_rp", "pack_icon.png"),
)

TRANSPARENT = (0, 0, 0, 0)


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


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def blank(colour=TRANSPARENT):
    return [[colour for _ in range(SIZE)] for _ in range(SIZE)]


def noise(col, row, salt=0):
    """Deterministic 0..255 hash - the same tile every time it is generated."""
    value = (col * 374761393 + row * 668265263 + salt * 2246822519) & 0xFFFFFFFF
    value = (value ^ (value >> 13)) * 1274126177 & 0xFFFFFFFF
    return (value ^ (value >> 16)) & 0xFF


def shade(colour, amount):
    r, g, b, a = colour
    return (
        max(0, min(255, r + amount)),
        max(0, min(255, g + amount)),
        max(0, min(255, b + amount)),
        a,
    )


def vein(grid, points, colour, wrap=True):
    """Draw a soft vein through a list of (col, row) control points."""
    for index in range(len(points) - 1):
        c0, r0 = points[index]
        c1, r1 = points[index + 1]
        steps = max(abs(c1 - c0), abs(r1 - r0)) * 2 or 1
        for step in range(steps + 1):
            col = round(c0 + (c1 - c0) * step / steps)
            row = round(r0 + (r1 - r0) * step / steps)
            if wrap:
                col %= SIZE
            if 0 <= row < SIZE and 0 <= col < SIZE:
                grid[row][col] = colour


def border(grid, colour, inset=0):
    for i in range(inset, SIZE - inset):
        grid[inset][i] = colour
        grid[SIZE - 1 - inset][i] = colour
        grid[i][inset] = colour
        grid[i][SIZE - 1 - inset] = colour


# --------------------------------------------------------------------------
# Block tiles
# --------------------------------------------------------------------------

def marble_tile():
    """Polished white marble: warm off-white with pale grey veining."""
    base = (238, 235, 228, 255)
    grid = blank(base)
    for row in range(SIZE):
        for col in range(SIZE):
            grid[row][col] = shade(base, (noise(col, row, 1) % 9) - 4)
    grey = (206, 202, 194, 255)
    pale = (221, 218, 211, 255)
    vein(grid, [(0, 3), (5, 5), (9, 2), (13, 4), (16, 6)], grey)
    vein(grid, [(0, 12), (4, 10), (8, 13), (12, 11), (16, 13)], pale)
    vein(grid, [(2, 15), (3, 12)], pale)
    # Polished highlight along the top edge.
    for col in range(SIZE):
        grid[0][col] = shade(grid[0][col], 12)
    return grid


def onyx_tile():
    """Black onyx marble: near-black with bright white veining."""
    base = (32, 30, 36, 255)
    grid = blank(base)
    for row in range(SIZE):
        for col in range(SIZE):
            grid[row][col] = shade(base, (noise(col, row, 2) % 11) - 5)
    white = (214, 212, 220, 255)
    grey = (120, 118, 128, 255)
    vein(grid, [(0, 10), (4, 7), (8, 9), (11, 5), (16, 7)], white)
    vein(grid, [(0, 2), (6, 1), (10, 3), (16, 1)], grey)
    vein(grid, [(5, 8), (6, 12), (9, 15)], grey)
    return grid


def gilded_tile():
    """Marble with an inlaid gold band across the middle."""
    grid = marble_tile()
    gold = (226, 178, 60, 255)
    bright = (255, 226, 130, 255)
    dark = (156, 114, 26, 255)
    for col in range(SIZE):
        grid[6][col] = dark
        grid[7][col] = gold
        grid[8][col] = bright if col % 4 == 1 else gold
        grid[9][col] = dark
    # Diamond studs riding the band.
    for col in range(2, SIZE, 6):
        grid[7][col] = bright
        grid[8][(col + 1) % SIZE] = dark
    return grid


def crystal_tile():
    """Crystal glass: transparent centre, frosted facets, pale gold frame."""
    grid = blank(TRANSPARENT)
    tint = (196, 232, 240, 70)
    facet = (226, 248, 252, 130)
    frame = (222, 190, 104, 255)
    frame_dark = (162, 130, 52, 255)

    for row in range(SIZE):
        for col in range(SIZE):
            grid[row][col] = tint
    # Diagonal facets catching the light.
    for i in range(SIZE):
        grid[i][i] = facet
        grid[i][(SIZE - 1 - i)] = facet
    border(grid, frame_dark)
    border(grid, frame, inset=1)
    for i in range(SIZE):
        grid[1][i] = frame if i % 2 == 0 else frame_dark
    return grid


def lamp_tile():
    """Gold lantern block: gilded cage over a glowing warm core."""
    gold = (218, 170, 56, 255)
    gold_dark = (142, 104, 24, 255)
    glow = (255, 236, 170, 255)
    core = (255, 252, 226, 255)

    grid = blank(glow)
    for row in range(SIZE):
        for col in range(SIZE):
            dist = max(abs(col - 7.5), abs(row - 7.5))
            if dist < 3.5:
                grid[row][col] = core
            else:
                grid[row][col] = shade(glow, -(int(dist) * 6))
    # Cage bars.
    for i in range(SIZE):
        for bar in (2, 13):
            grid[i][bar] = gold
            grid[bar][i] = gold
    border(grid, gold_dark)
    border(grid, gold, inset=1)
    for corner_row in (2, 13):
        for corner_col in (2, 13):
            grid[corner_row][corner_col] = gold_dark
    return grid


def rug_tile():
    """Royal rug: deep crimson pile inside a woven gold border."""
    red = (138, 26, 34, 255)
    red_dark = (104, 18, 26, 255)
    gold = (214, 172, 74, 255)
    gold_dark = (150, 116, 38, 255)

    grid = blank(red)
    for row in range(SIZE):
        for col in range(SIZE):
            grid[row][col] = shade(red, (noise(col, row, 3) % 7) - 3)
    border(grid, gold_dark)
    border(grid, gold, inset=1)
    # Woven fringe on the border.
    for i in range(SIZE):
        if i % 2 == 0:
            grid[0][i] = gold
            grid[SIZE - 1][i] = gold
            grid[i][0] = gold
            grid[i][SIZE - 1] = gold
    # Central medallion.
    for row in range(SIZE):
        for col in range(SIZE):
            dist = abs(col - 7.5) + abs(row - 7.5)
            if dist < 2.2:
                grid[row][col] = gold
            elif dist < 3.4:
                grid[row][col] = gold_dark
            elif dist < 4.4:
                grid[row][col] = red_dark
    return grid


BLOCKS = {
    "luxury_marble": marble_tile,
    "luxury_onyx_marble": onyx_tile,
    "luxury_gilded_marble": gilded_tile,
    "luxury_crystal_glass": crystal_tile,
    "luxury_gold_lamp": lamp_tile,
    "luxury_royal_rug": rug_tile,
}


# --------------------------------------------------------------------------
# Item icons
# --------------------------------------------------------------------------

def deed_icon():
    """A rolled deed: parchment scroll, gold wax seal, villa stamped on it."""
    paper = (232, 220, 186, 255)
    paper_dark = (198, 182, 144, 255)
    ink = (72, 58, 40, 255)
    gold = (226, 178, 60, 255)
    gold_dark = (150, 110, 26, 255)
    seal = (176, 40, 44, 255)

    grid = blank(TRANSPARENT)
    # Sheet.
    for row in range(2, 15):
        for col in range(3, 14):
            grid[row][col] = paper
    # Rolled top and bottom edges.
    for col in range(2, 15):
        grid[1][col] = paper_dark
        grid[2][col] = paper_dark
        grid[14][col] = paper_dark
        grid[15][col] = paper_dark
    # Stamped villa: roof, walls, door, windows.
    for col in range(5, 12):
        grid[6][col] = gold
    for col in range(6, 11):
        grid[5][col] = gold_dark
    walls = (208, 192, 150, 255)
    for row in range(7, 11):
        for col in range(5, 12):
            grid[row][col] = walls
    # Light walls with inked edges and openings: at 16x16 the stamp only reads
    # if the dark pixels are the details, not the body.
    for row in range(7, 11):
        grid[row][5] = ink
        grid[row][11] = ink
    for col in range(5, 12):
        grid[11][col] = ink
    grid[8][7] = ink  # windows
    grid[8][9] = ink
    grid[9][8] = ink  # door
    grid[10][8] = ink
    # Ruled lines under the drawing.
    for col in range(5, 12, 2):
        grid[12][col] = ink
    # Wax seal.
    for row in range(10, 14):
        for col in range(10, 14):
            grid[row][col] = seal
    grid[11][11] = gold
    grid[12][12] = gold_dark
    return grid


def permit_icon():
    """Demolition permit: grey docket, red stamp, wrecking ball."""
    paper = (214, 212, 206, 255)
    paper_dark = (170, 168, 162, 255)
    ink = (56, 56, 60, 255)
    red = (188, 44, 40, 255)
    iron = (108, 110, 118, 255)
    iron_light = (162, 164, 172, 255)

    grid = blank(TRANSPARENT)
    for row in range(2, 14):
        for col in range(2, 12):
            grid[row][col] = paper
    for col in range(2, 12):
        grid[2][col] = paper_dark
        grid[13][col] = paper_dark
    for row in (5, 7, 9):
        for col in range(4, 10):
            grid[row][col] = ink
    # Red "approved" stamp across the docket.
    for i in range(4):
        grid[4 + i][4 + i] = red
        grid[4 + i][9 - i] = red
    # Wrecking ball on its chain, hanging over the corner.
    for i in range(3):
        grid[i][12 + i] = iron_light
    for row in range(10, 15):
        for col in range(10, 15):
            dist = ((col - 12.5) ** 2 + (row - 12.5) ** 2) ** 0.5
            if dist <= 2.4:
                grid[row][col] = iron
            if dist <= 1.2:
                grid[row][col] = iron_light
    for i in range(3, 10):
        grid[i][13] = iron_light
    return grid


ITEMS = {
    "villa_deed": deed_icon,
    "wrecking_permit": permit_icon,
}


# --------------------------------------------------------------------------
# Pack icon
# --------------------------------------------------------------------------

def pack_icon():
    """Gold-roofed marble villa on a night-blue plate."""
    sky = (26, 32, 58, 255)
    sky_light = (44, 54, 92, 255)
    marble = (236, 233, 226, 255)
    marble_dark = (196, 193, 186, 255)
    gold = (228, 182, 66, 255)
    gold_dark = (156, 116, 28, 255)
    glass = (126, 196, 214, 255)
    lawn = (74, 120, 62, 255)
    water = (58, 128, 186, 255)

    grid = blank(sky)
    for row in range(SIZE):
        for col in range(SIZE):
            if row < 6:
                grid[row][col] = sky_light if (col + row) % 5 == 0 else sky
    # Lawn and pool.
    for col in range(SIZE):
        grid[14][col] = lawn
        grid[15][col] = lawn
    for col in range(1, 5):
        grid[14][col] = water
        grid[15][col] = water
    # Villa body: two storeys.
    for row in range(7, 14):
        for col in range(5, 14):
            grid[row][col] = marble if (col + row) % 2 else marble_dark
    # Gold roof and cornice.
    for col in range(4, 15):
        grid[6][col] = gold
        grid[10][col] = gold_dark
    for col in range(5, 14, 4):
        grid[5][col] = gold_dark
    # Windows and door.
    for row in (8, 12):
        for col in (6, 9, 12):
            grid[row][col] = glass
    grid[12][9] = gold
    grid[13][9] = gold_dark
    return grid


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------

def preview(grid):
    ramp = " .:-=+*#%@"
    lines = []
    for row in grid:
        line = ""
        for r, g, b, a in row:
            if a < 32:
                line += " "
            else:
                line += ramp[min(9, (r + g + b) // 3 * 10 // 256)]
        lines.append(line)
    return "\n".join(lines)


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

    icon = pack_icon()
    for path in PACK_ICONS:
        write_png(path, icon)
    if show:
        print(f"\n=== pack icon ===\n{preview(icon)}")

    print(
        f"Wrote {len(BLOCKS)} block tiles, {len(ITEMS)} item icons "
        f"and {len(PACK_ICONS)} pack icons."
    )


if __name__ == "__main__":
    main()
