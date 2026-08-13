#!/usr/bin/env python3
"""Generate the 16x16 item icons for Onetap Armory.

Pure standard library - writes RGBA PNGs directly so the pack can be rebuilt
anywhere without image tooling installed.

Usage:  python3 tools/gen_onetap_textures.py [--preview]
"""

import os
import struct
import sys
import zlib

SIZE = 16
OUT_DIR = os.path.join("resource_packs", "onetap_armory_rp", "textures", "items")
PACK_ICONS = (
    os.path.join("behavior_packs", "onetap_armory_bp", "pack_icon.png"),
    os.path.join("resource_packs", "onetap_armory_rp", "pack_icon.png"),
)

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

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(blob)


# --------------------------------------------------------------------------
# Shape helpers - shapes are dicts of (col, row) -> palette key
# --------------------------------------------------------------------------

def put(cells, col, row, key, overwrite=True):
    if 0 <= col < SIZE and 0 <= row < SIZE:
        if overwrite or (col, row) not in cells:
            cells[(col, row)] = key


def line(cells, start, end, key):
    """Straight run between two points, one pixel thick."""
    c0, r0 = start
    c1, r1 = end
    steps = max(abs(c1 - c0), abs(r1 - r0)) or 1
    for step in range(steps + 1):
        put(cells, round(c0 + (c1 - c0) * step / steps),
            round(r0 + (r1 - r0) * step / steps), key)


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


# --------------------------------------------------------------------------
# Silhouettes - one per weapon, so all five read differently in the hotbar
# --------------------------------------------------------------------------

def scythe_shape():
    """Long bone snath with a crescent blade sweeping across the top."""
    cells = {}

    # Snath: one diagonal from the bottom-left corner up to the collar.
    for row in range(4, 16):
        put(cells, 15 - row, row, "w")
        put(cells, 16 - row, row, "p")
    put(cells, 0, 15, "p")

    # Crescent blade, outer arc then inner edge.
    arc = [(11, 4), (11, 3), (10, 2), (9, 1), (7, 0), (5, 1), (4, 2), (3, 4)]
    for index in range(len(arc) - 1):
        line(cells, arc[index], arc[index + 1], "b")
    inner = [(11, 5), (10, 4), (9, 3), (7, 2), (5, 3), (4, 4), (4, 5)]
    for index in range(len(inner) - 1):
        line(cells, inner[index], inner[index + 1], "h")
    put(cells, 3, 5, "g")
    put(cells, 4, 6, "g")

    # Collar where blade meets snath.
    for row in (4, 5):
        put(cells, 11, row, "g")
    put(cells, 12, 4, "g")
    return cells


def lance_shape():
    """Straight haft with a long tapered head and two barbs."""
    cells = {}

    for row in range(3, 16):
        put(cells, 14 - row, row, "w")
        put(cells, 15 - row, row, "p")
    put(cells, 0, 15, "p")

    # Head: a narrow diamond on the same diagonal.
    head = [(12, 2), (13, 1), (14, 0)]
    for col, row in head:
        put(cells, col, row, "h")
        put(cells, col - 1, row, "b")
        put(cells, col, row + 1, "b")
    put(cells, 11, 3, "b")
    put(cells, 12, 3, "b")
    put(cells, 11, 2, "g")

    # Barbs flaring back from the socket.
    line(cells, (9, 5), (7, 4), "g")
    line(cells, (10, 6), (11, 7), "g")
    # Void core glowing in the socket.
    put(cells, 10, 4, "c")
    put(cells, 9, 4, "c")
    return cells


def maul_shape():
    """Blocky two-tone head, runed face, short haft."""
    cells = {}

    for row in range(8, 16):
        put(cells, 12 - row, row, "w")
        put(cells, 13 - row, row, "w")
    put(cells, 0, 15, "p")

    for row in range(1, 9):
        for col in range(6, 15):
            put(cells, col, row, "b")
    for col in range(6, 15):
        put(cells, col, 1, "h")
    for row in range(1, 9):
        put(cells, 14, row, "h")
    for col in range(6, 15):
        put(cells, col, 8, "p")

    # Runes struck into the face.
    for row in range(3, 7):
        put(cells, 8, row, "g")
    for col in range(9, 13):
        put(cells, col, 4, "g")
    put(cells, 11, 3, "c")
    put(cells, 11, 5, "c")

    # Collar.
    for row in range(7, 10):
        put(cells, 5, row, "p")
        put(cells, 6, row, "p")
    return cells


def dagger_shape():
    """Short blade, wide guard, stubby grip - clearly not a sword."""
    cells = {}

    # Blade, rows 1..7 only.
    for row in range(1, 8):
        put(cells, 14 - row, row, "b")
        put(cells, 15 - row, row, "h")
    put(cells, 14, 1, "h")
    put(cells, 13, 1, "c")

    # Guard: short bar across the diagonal.
    for step in range(-2, 3):
        put(cells, 7 + step, 8 + step, "g")
        put(cells, 8 + step, 8 + step, "g")

    # Grip and pommel.
    for row in range(10, 14):
        put(cells, 13 - row, row, "w")
        put(cells, 14 - row, row, "w")
    put(cells, 0, 13, "p")
    put(cells, 1, 13, "p")
    put(cells, 0, 14, "p")
    return cells


def cannon_shape():
    """Thick barrel on the diagonal with a flared, glowing muzzle."""
    cells = {}

    # Barrel: three pixels thick.
    for row in range(3, 13):
        for thickness in range(3):
            put(cells, 12 - row + thickness, row, "b" if thickness == 1 else "p")
    for row in range(3, 13):
        put(cells, 13 - row + 1, row, "h")

    # Flared muzzle at the top right.
    for col in range(10, 15):
        put(cells, col, 14 - col, "h")
        put(cells, col, 15 - col, "b")
    put(cells, 13, 1, "c")
    put(cells, 14, 1, "g")
    put(cells, 12, 2, "g")
    put(cells, 13, 2, "c")

    # Grip and trigger housing under the breech.
    for row in range(11, 15):
        put(cells, 3, row, "w")
        put(cells, 4, row, "w")
    put(cells, 2, 14, "p")
    put(cells, 5, 12, "g")
    return cells


WEAPONS = {
    # b = body, h = highlight, g = accent/glow, c = core, w = haft, p = shadow
    "reapers_edge": (
        scythe_shape,
        {
            "b": (196, 38, 62, 255),
            "h": (255, 122, 138, 255),
            "g": (156, 74, 220, 255),
            "c": (232, 176, 255, 255),
            "w": (214, 208, 190, 255),
            "p": (122, 116, 100, 255),
            "o": (26, 10, 22, 255),
        },
    ),
    "void_lance": (
        lance_shape,
        {
            "b": (108, 66, 208, 255),
            "h": (176, 240, 255, 255),
            "g": (74, 226, 234, 255),
            "c": (250, 250, 255, 255),
            "w": (38, 30, 58, 255),
            "p": (22, 16, 36, 255),
            "o": (10, 6, 20, 255),
        },
    ),
    "judgment_hammer": (
        maul_shape,
        {
            "b": (238, 232, 208, 255),
            "h": (255, 252, 240, 255),
            "g": (232, 178, 54, 255),
            "c": (110, 200, 255, 255),
            "w": (150, 112, 46, 255),
            "p": (176, 168, 142, 255),
            "o": (48, 38, 20, 255),
        },
    ),
    "whisper_dagger": (
        dagger_shape,
        {
            "b": (86, 98, 116, 255),
            "h": (168, 246, 236, 255),
            "g": (44, 52, 66, 255),
            "c": (226, 255, 250, 255),
            "w": (34, 34, 44, 255),
            "p": (72, 214, 200, 255),
            "o": (8, 12, 18, 255),
        },
    ),
    "doom_cannon": (
        cannon_shape,
        {
            "b": (96, 102, 114, 255),
            "h": (158, 166, 180, 255),
            "g": (255, 148, 40, 255),
            "c": (255, 236, 170, 255),
            "w": (78, 52, 32, 255),
            "p": (58, 62, 72, 255),
            "o": (16, 18, 24, 255),
        },
    ),
}


def pack_icon():
    """Crossed scythe and lance over a blood-red field."""
    field = (46, 12, 18, 255)
    field_light = (72, 20, 28, 255)
    grid = [[field for _ in range(SIZE)] for _ in range(SIZE)]
    for row in range(SIZE):
        for col in range(SIZE):
            if (col + row) % 6 == 0:
                grid[row][col] = field_light

    cells = {}
    line(cells, (1, 14), (14, 1), "b")   # lance
    line(cells, (2, 14), (14, 2), "h")
    line(cells, (1, 1), (14, 14), "g")   # scythe snath
    line(cells, (1, 2), (13, 14), "w")
    for col, row in ((13, 1), (14, 1), (14, 2)):
        put(cells, col, row, "c")
    for col, row in ((1, 1), (2, 1), (1, 2)):
        put(cells, col, row, "c")

    palette = {
        "b": (176, 232, 255, 255),
        "h": (110, 176, 232, 255),
        "g": (240, 228, 210, 255),
        "w": (168, 156, 138, 255),
        "c": (255, 236, 150, 255),
        "o": (14, 6, 10, 255),
    }
    for (col, row), key in outline(cells).items():
        if 0 <= col < SIZE and 0 <= row < SIZE:
            grid[row][col] = palette[key]
    return grid


def preview(cells):
    chars = {"b": "#", "h": "@", "g": "*", "c": "+", "w": "=", "p": "o", "o": "."}
    return "\n".join(
        "".join(chars.get(cells.get((col, row)), " ") for col in range(SIZE))
        for row in range(SIZE)
    )


def main():
    show = "--preview" in sys.argv
    os.makedirs(OUT_DIR, exist_ok=True)

    for name, (shape_fn, palette) in WEAPONS.items():
        cells = outline(shape_fn())
        write_png(os.path.join(OUT_DIR, f"{name}.png"), render(cells, palette))
        if show:
            print(f"\n=== {name} ===\n{preview(cells)}")

    icon = pack_icon()
    for path in PACK_ICONS:
        write_png(path, icon)

    print(f"Wrote {len(WEAPONS)} item icons + {len(PACK_ICONS)} pack icons.")


if __name__ == "__main__":
    main()
