#!/usr/bin/env python3
"""Generate every texture for the Super Powers add-on.

Pure standard library. Writes:
  - seven 16x16 item icons, drawn as one matching set of power cores
  - a 16x16 particle sheet with four cells the particle files index into
  - a pack icon for each pack

Usage:  python3 tools/gen_superpowers_textures.py [--preview]
"""

import os
import struct
import sys
import zlib

BP = os.path.join("behavior_packs", "super_powers_bp")
RP = os.path.join("resource_packs", "super_powers_rp")

SIZE = 16
TRANSPARENT = (0, 0, 0, 0)

PLATE = (30, 33, 44, 255)
PLATE_DARK = (18, 20, 28, 255)
OUTLINE = (10, 11, 16, 255)


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


def canvas(width=SIZE, height=SIZE, colour=TRANSPARENT):
    return [[colour for _ in range(width)] for _ in range(height)]


def dot(grid, x, y, colour):
    if 0 <= y < len(grid) and 0 <= x < len(grid[0]):
        grid[y][x] = colour


def rect(grid, x0, y0, x1, y1, colour):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            dot(grid, x, y, colour)


def line(grid, x0, y0, x1, y1, colour):
    steps = max(abs(x1 - x0), abs(y1 - y0)) or 1
    for step in range(steps + 1):
        dot(
            grid,
            round(x0 + (x1 - x0) * step / steps),
            round(y0 + (y1 - y0) * step / steps),
            colour,
        )


def distance(x, y, cx, cy):
    return ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5


def scale(grid, factor):
    out = []
    for row in grid:
        line_out = []
        for px in row:
            line_out.extend([px] * factor)
        for _ in range(factor):
            out.append(list(line_out))
    return out


# --------------------------------------------------------------------------
# The shared "core" plate every power item sits on
# --------------------------------------------------------------------------

def plate(accent, glow):
    grid = canvas()
    for y in range(SIZE):
        for x in range(SIZE):
            away = distance(x, y, 7.5, 7.5)
            if away <= 5.4:
                grid[y][x] = PLATE
            elif away <= 6.6:
                grid[y][x] = accent
            elif away <= 7.4:
                grid[y][x] = PLATE_DARK
    # A lit arc along the top left, so the disc reads as round.
    for y in range(SIZE):
        for x in range(SIZE):
            away = distance(x, y, 7.5, 7.5)
            if 5.4 < away <= 6.6 and x + y < 15:
                grid[y][x] = glow
    return grid


def outline(grid):
    out = [row[:] for row in grid]
    for y in range(SIZE):
        for x in range(SIZE):
            if grid[y][x] != TRANSPARENT:
                continue
            neighbours = [
                grid[y + dy][x + dx]
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
                if 0 <= x + dx < SIZE and 0 <= y + dy < SIZE
            ]
            if any(px != TRANSPARENT for px in neighbours):
                out[y][x] = OUTLINE
    return out


# --------------------------------------------------------------------------
# Symbols
# --------------------------------------------------------------------------

def speed_symbol(grid, mark, hot):
    for x, y in ((9, 3), (8, 3), (7, 4), (6, 5), (5, 6), (6, 6), (7, 6), (8, 6)):
        dot(grid, x, y, mark)
    for x, y in ((9, 7), (8, 8), (7, 9), (6, 10), (5, 11), (6, 8), (7, 7)):
        dot(grid, x, y, mark)
    for x, y in ((7, 5), (8, 7), (7, 8)):
        dot(grid, x, y, hot)


def flight_symbol(grid, mark, hot):
    # Two wings sweeping out from a gap in the middle, feathered at the tips.
    rows = {
        5: [6, 9],
        6: [5, 6, 9, 10],
        7: [4, 5, 6, 9, 10, 11],
        8: [3, 4, 5, 6, 9, 10, 11, 12],
        9: [4, 5, 10, 11],
        10: [5, 10],
    }
    for y, columns in rows.items():
        for x in columns:
            dot(grid, x, y, mark)
        # The leading edge catches the light.
        dot(grid, min(columns), y, hot)
        dot(grid, max(columns), y, hot)


def laser_symbol(grid, mark, hot):
    # An eye, and the beam leaving it.
    for x in range(4, 12):
        dot(grid, x, 7, mark)
    for x in range(5, 11):
        dot(grid, x, 6, mark)
        dot(grid, x, 8, mark)
    rect(grid, 7, 6, 8, 8, hot)
    dot(grid, 7, 7, (255, 255, 255, 255))
    for x in range(11, 15):
        dot(grid, x, 7, hot)
    dot(grid, 13, 6, mark)
    dot(grid, 13, 8, mark)


def invisibility_symbol(grid, mark, hot):
    # A figure that is only half there: solid on one side, fading on the other.
    body = []
    for y in range(4, 7):
        for x in range(6, 10):
            body.append((x, y))
    for y in range(7, 12):
        for x in range(5, 11):
            if y >= 10 and x in (7, 8):
                continue  # gap between the legs
            body.append((x, y))
    for x, y in body:
        if x <= 7:
            dot(grid, x, y, mark)
        elif (x + y) % 2 == 0:
            dot(grid, x, y, hot)


def teleport_symbol(grid, mark, hot):
    # A spiral, drawn as four shrinking arcs.
    for x in range(4, 12):
        dot(grid, x, 4, mark)
    for y in range(4, 10):
        dot(grid, 11, y, mark)
    for x in range(6, 12):
        dot(grid, x, 10, mark)
    for y in range(7, 11):
        dot(grid, 6, y, mark)
    for x in range(6, 10):
        dot(grid, x, 7, hot)
    dot(grid, 9, 8, hot)


def timestop_symbol(grid, mark, hot):
    for y in range(SIZE):
        for x in range(SIZE):
            away = distance(x, y, 7.5, 7.5)
            if 3.4 <= away <= 4.4:
                grid[y][x] = mark
    line(grid, 7, 7, 7, 4, hot)   # hour hand
    line(grid, 7, 7, 10, 7, hot)  # minute hand
    dot(grid, 7, 7, (255, 255, 255, 255))


def band_symbol(grid, mark, hot):
    for y in range(SIZE):
        for x in range(SIZE):
            away = distance(x, y, 7.5, 8.5)
            if 4.0 <= away <= 5.4:
                grid[y][x] = mark
            elif away < 4.0:
                grid[y][x] = TRANSPARENT
    rect(grid, 6, 2, 9, 5, hot)
    dot(grid, 7, 3, (255, 255, 255, 255))
    dot(grid, 6, 2, mark)
    dot(grid, 9, 2, mark)
    dot(grid, 6, 5, mark)
    dot(grid, 9, 5, mark)


ITEMS = {
    #                  accent                glow                  mark                 hot
    "speed_core": (speed_symbol, (150, 116, 20, 255), (255, 214, 82, 255), (255, 226, 94, 255), (255, 255, 214, 255)),
    "flight_core": (flight_symbol, (52, 122, 140, 255), (150, 232, 255, 255), (208, 246, 255, 255), (255, 255, 255, 255)),
    "laser_core": (laser_symbol, (128, 30, 34, 255), (255, 96, 88, 255), (255, 74, 66, 255), (255, 222, 180, 255)),
    "invisibility_core": (invisibility_symbol, (86, 56, 132, 255), (198, 158, 255, 255), (206, 176, 255, 255), (255, 255, 255, 255)),
    "teleport_core": (teleport_symbol, (74, 40, 122, 255), (176, 108, 255, 255), (198, 140, 255, 255), (255, 214, 255, 255)),
    "timestop_core": (timestop_symbol, (34, 78, 140, 255), (118, 190, 255, 255), (168, 218, 255, 255), (255, 255, 255, 255)),
    "power_band": (band_symbol, (146, 108, 30, 255), (240, 196, 84, 255), (226, 180, 66, 255), (120, 226, 255, 255)),
}


# --------------------------------------------------------------------------
# Particle sheet: four 8x8 cells the particle files index into by uv
# --------------------------------------------------------------------------

def build_particles():
    grid = canvas()
    white = (255, 255, 255, 255)
    soft = (255, 255, 255, 170)
    faint = (255, 255, 255, 90)

    # (0,0) soft dot
    for y in range(8):
        for x in range(8):
            away = distance(x, y, 3.5, 3.5)
            if away <= 1.6:
                grid[y][x] = white
            elif away <= 2.6:
                grid[y][x] = soft
            elif away <= 3.4:
                grid[y][x] = faint

    # (8,0) four point spark
    for step in range(4):
        dot(grid, 11 + step, 3, white if step < 2 else soft)
        dot(grid, 11 - step, 3, white if step < 2 else soft)
        dot(grid, 11, 3 + step, white if step < 2 else soft)
        dot(grid, 11, 3 - step, white if step < 2 else soft)
    dot(grid, 11, 3, white)

    # (0,8) ring
    for y in range(8):
        for x in range(8):
            away = distance(x, y + 8, 3.5, 11.5)
            if 2.4 <= away <= 3.4:
                grid[y + 8][x] = white
            elif 1.8 <= away < 2.4:
                grid[y + 8][x] = faint

    # (8,8) streak
    for x in range(9, 15):
        alpha = 255 - (x - 9) * 34
        grid[11][x] = (255, 255, 255, alpha)
        grid[12][x] = (255, 255, 255, max(0, alpha - 60))
    grid[11][8] = white
    grid[10][9] = soft

    return grid


def preview(grid):
    chars = " .:-=+*#%@"
    lines = []
    for row in grid:
        line_out = ""
        for px in row:
            if px[3] == 0:
                line_out += " "
            else:
                brightness = (px[0] + px[1] + px[2]) / 765
                line_out += chars[min(9, int(brightness * 9) + 1)]
        lines.append(line_out)
    return "\n".join(lines)


def main():
    show = "--preview" in sys.argv

    for name, (symbol, accent, glow, mark, hot) in ITEMS.items():
        grid = plate(accent, glow)
        symbol(grid, mark, hot)
        grid = outline(grid)
        write_png(os.path.join(RP, "textures", "items", f"{name}.png"), grid)
        if show:
            print(f"\n=== {name} ===")
            print(preview(grid))

    write_png(os.path.join(RP, "textures", "particle", "sp_particles.png"), build_particles())

    # Pack icon: the band, scaled up.
    icon_grid = plate(*ITEMS["power_band"][1:3])
    band_symbol(icon_grid, ITEMS["power_band"][3], ITEMS["power_band"][4])
    icon = scale(outline(icon_grid), 4)
    for path in (
        os.path.join(BP, "pack_icon.png"),
        os.path.join(RP, "pack_icon.png"),
    ):
        write_png(path, icon)

    print(f"Wrote {len(ITEMS)} item icons, 1 particle sheet and 2 pack icons.")


if __name__ == "__main__":
    main()
