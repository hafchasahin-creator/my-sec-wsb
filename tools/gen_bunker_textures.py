#!/usr/bin/env python3
"""Generate every 16x16 texture used by the Secret Bunker add-on.

Pure standard library: RGBA PNGs are written byte by byte so the pack can be
rebuilt on any machine without image tooling installed.

Usage:  python3 tools/gen_bunker_textures.py [--preview NAME]
"""

import os
import struct
import sys
import zlib

SIZE = 16
RP = os.path.join("resource_packs", "secret_bunker_rp")
BLOCK_DIR = os.path.join(RP, "textures", "blocks")
ITEM_DIR = os.path.join(RP, "textures", "items")
BP = os.path.join("behavior_packs", "secret_bunker_bp")

CLEAR = (0, 0, 0, 0)

# ---------------------------------------------------------------------------
# PNG output
# ---------------------------------------------------------------------------


def write_png(path, pixels):
    """pixels[y][x] = (r, g, b, a)."""
    height = len(pixels)
    width = len(pixels[0])
    raw = b"".join(
        b"\x00" + bytes(c for px in row for c in px) for row in pixels
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
    with open(path, "wb") as handle:
        handle.write(blob)


# ---------------------------------------------------------------------------
# Drawing helpers
# ---------------------------------------------------------------------------


def new(color=CLEAR, size=SIZE):
    return [[color for _ in range(size)] for _ in range(size)]


def put(p, x, y, c):
    if 0 <= x < len(p[0]) and 0 <= y < len(p) and c is not None:
        if c[3] == 255:
            p[y][x] = c
        elif c[3]:
            p[y][x] = blend(p[y][x], c)


def blend(under, over):
    a = over[3] / 255.0
    if under[3] == 0:
        return over
    return (
        int(over[0] * a + under[0] * (1 - a)),
        int(over[1] * a + under[1] * (1 - a)),
        int(over[2] * a + under[2] * (1 - a)),
        max(under[3], over[3]),
    )


def rect(p, x0, y0, x1, y1, c):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            put(p, x, y, c)


def frame(p, x0, y0, x1, y1, c):
    for x in range(x0, x1 + 1):
        put(p, x, y0, c)
        put(p, x, y1, c)
    for y in range(y0, y1 + 1):
        put(p, x0, y, c)
        put(p, x1, y, c)


def hline(p, y, x0, x1, c):
    rect(p, x0, y, x1, y, c)


def vline(p, x, y0, y1, c):
    rect(p, x, y0, x, y1, c)


def shade(c, amount):
    """amount > 0 lightens, < 0 darkens."""
    def ch(v):
        if amount >= 0:
            return int(v + (255 - v) * amount)
        return int(v * (1 + amount))

    return (ch(c[0]), ch(c[1]), ch(c[2]), c[3])


def hashf(x, y, seed):
    n = (x * 374761393 + y * 668265263 + seed * 2246822519) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFF) / 255.0


def grain(p, seed, amount=0.10, skip=None):
    """Per-pixel value noise so flat fills stop looking like plastic."""
    for y in range(len(p)):
        for x in range(len(p[0])):
            c = p[y][x]
            if c[3] == 0 or (skip and skip(x, y)):
                continue
            n = (hashf(x, y, seed) - 0.5) * 2 * amount
            p[y][x] = shade(c, n)


def bolt(p, x, y, base):
    """2x2 rivet with a highlight and a shadow."""
    put(p, x, y, shade(base, 0.38))
    put(p, x + 1, y, shade(base, 0.14))
    put(p, x, y + 1, shade(base, 0.02))
    put(p, x + 1, y + 1, shade(base, -0.38))


def bevel(p, x0, y0, x1, y1, base, strength=0.24):
    """Lit top/left edge, shaded bottom/right edge."""
    for x in range(x0, x1 + 1):
        put(p, x, y0, shade(base, strength))
        put(p, x, y1, shade(base, -strength))
    for y in range(y0, y1 + 1):
        put(p, x0, y, shade(base, strength * 0.7))
        put(p, x1, y, shade(base, -strength * 0.7))


# ---------------------------------------------------------------------------
# Palette
# ---------------------------------------------------------------------------

CONCRETE = (128, 130, 133, 255)
CONCRETE_DK = (92, 94, 98, 255)
STEEL = (138, 143, 150, 255)
STEEL_DK = (84, 89, 96, 255)
GUNMETAL = (66, 71, 78, 255)
CHARCOAL = (44, 47, 52, 255)
BLACK = (24, 26, 29, 255)
HAZARD = (222, 178, 42, 255)
WARN_RED = (196, 54, 48, 255)
LED_RED = (255, 74, 62, 255)
LED_GREEN = (108, 236, 122, 255)
LED_AMBER = (255, 182, 66, 255)
CYAN = (108, 214, 230, 255)
SCREEN_BG = (16, 42, 50, 255)
WHITE = (232, 236, 238, 255)
OLIVE = (94, 104, 74, 255)


# ---------------------------------------------------------------------------
# Block textures
# ---------------------------------------------------------------------------


def t_reinforced_concrete():
    p = new(CONCRETE)
    grain(p, 11, 0.16)
    # aggregate flecks
    for y in range(SIZE):
        for x in range(SIZE):
            h = hashf(x, y, 41)
            if h > 0.94:
                put(p, x, y, shade(CONCRETE, 0.30))
            elif h < 0.06:
                put(p, x, y, shade(CONCRETE, -0.34))
    # exposed rebar grid
    for x in range(SIZE):
        if x % 2 == 0:
            put(p, x, 4, shade(STEEL_DK, 0.10))
            put(p, x, 11, shade(STEEL_DK, 0.10))
    for y in range(SIZE):
        if y % 2 == 0:
            put(p, 6, y, shade(STEEL_DK, 0.04))
    put(p, 6, 4, shade(STEEL, 0.20))
    put(p, 6, 11, shade(STEEL, 0.20))
    # chipped corners
    for x, y in ((0, 0), (1, 0), (0, 1), (15, 14), (15, 15), (14, 15)):
        put(p, x, y, shade(CONCRETE, -0.30))
    return p


def t_concrete_panel():
    p = new(shade(CONCRETE, 0.05))
    grain(p, 7, 0.08)
    # recessed seam cross
    hline(p, 7, 0, 15, shade(CONCRETE, -0.30))
    hline(p, 8, 0, 15, shade(CONCRETE, 0.16))
    vline(p, 7, 0, 15, shade(CONCRETE, -0.30))
    vline(p, 8, 0, 15, shade(CONCRETE, 0.16))
    for cx, cy in ((2, 2), (12, 2), (2, 12), (12, 12)):
        bolt(p, cx, cy, CONCRETE)
    return p


def t_hazard_stripe():
    p = new(BLACK)
    for y in range(SIZE):
        for x in range(SIZE):
            if ((x + y) % 8) < 4:
                put(p, x, y, HAZARD)
    grain(p, 23, 0.12)
    # scuffed paint
    for y in range(SIZE):
        for x in range(SIZE):
            if hashf(x, y, 66) > 0.93:
                put(p, x, y, shade(p[y][x], -0.35))
    frame(p, 0, 0, 15, 15, shade(BLACK, 0.10))
    return p


def t_steel_plating():
    p = new(STEEL)
    grain(p, 3, 0.07)
    # brushed horizontal streaks
    for y in range(SIZE):
        s = (hashf(0, y, 91) - 0.5) * 0.18
        for x in range(SIZE):
            put(p, x, y, shade(p[y][x], s))
    hline(p, 0, 0, 15, shade(STEEL, 0.26))
    hline(p, 15, 0, 15, shade(STEEL, -0.28))
    vline(p, 0, 0, 15, shade(STEEL, 0.18))
    vline(p, 15, 0, 15, shade(STEEL, -0.22))
    for cx, cy in ((2, 2), (12, 2), (2, 12), (12, 12)):
        bolt(p, cx, cy, STEEL)
    return p


def t_steel_grate():
    p = new(CLEAR)
    bar = shade(STEEL_DK, 0.10)
    for y in range(SIZE):
        for x in range(SIZE):
            if x % 4 == 0 or x % 4 == 1 or y % 4 == 0:
                put(p, x, y, bar)
    # highlight the top of each bar so it reads as 3D
    for y in range(SIZE):
        if y % 4 == 0:
            hline(p, y, 0, 15, shade(STEEL, 0.14))
    for x in range(SIZE):
        if x % 4 == 0:
            vline(p, x, 0, 15, shade(STEEL, 0.06))
    grain(p, 5, 0.10)
    return p


def t_floor_tile():
    p = new(CHARCOAL)
    grain(p, 13, 0.10)
    # 2x2 tiles with grout channels
    hline(p, 7, 0, 15, shade(CHARCOAL, -0.45))
    vline(p, 7, 0, 15, shade(CHARCOAL, -0.45))
    hline(p, 8, 0, 15, shade(CHARCOAL, 0.22))
    vline(p, 8, 0, 15, shade(CHARCOAL, 0.22))
    hline(p, 15, 0, 15, shade(CHARCOAL, -0.45))
    vline(p, 15, 0, 15, shade(CHARCOAL, -0.45))
    hline(p, 0, 0, 15, shade(CHARCOAL, 0.16))
    vline(p, 0, 0, 15, shade(CHARCOAL, 0.16))
    # anti-slip studs
    for cx in (3, 11):
        for cy in (3, 11):
            put(p, cx, cy, shade(CHARCOAL, 0.30))
            put(p, cx + 1, cy + 1, shade(CHARCOAL, -0.30))
    return p


def t_ceiling_light():
    p = new(GUNMETAL)
    frame(p, 0, 0, 15, 15, shade(GUNMETAL, 0.18))
    rect(p, 2, 2, 13, 13, (246, 244, 226, 255))
    # diffuser ribs
    for x in range(3, 13, 3):
        vline(p, x, 2, 13, (222, 220, 200, 255))
    frame(p, 2, 2, 13, 13, (255, 253, 240, 255))
    # corner screws
    for cx, cy in ((0, 0), (14, 0), (0, 14), (14, 14)):
        bolt(p, cx, cy, GUNMETAL)
    grain(p, 17, 0.04)
    return p


def t_emergency_light():
    p = new(CHARCOAL)
    frame(p, 0, 0, 15, 15, shade(CHARCOAL, 0.20))
    rect(p, 3, 4, 12, 11, WARN_RED)
    rect(p, 4, 5, 11, 8, shade(LED_RED, 0.20))
    rect(p, 5, 6, 10, 7, (255, 208, 200, 255))
    # cage bars
    for x in (5, 8, 11):
        vline(p, x, 4, 11, shade(CHARCOAL, 0.10))
    hline(p, 3, 3, 12, shade(CHARCOAL, 0.30))
    hline(p, 12, 3, 12, shade(CHARCOAL, -0.20))
    for cx, cy in ((1, 1), (13, 1), (1, 13), (13, 13)):
        bolt(p, cx, cy, CHARCOAL)
    return p


def t_reinforced_glass():
    p = new((150, 196, 205, 90))
    # faint reflection streak
    for i in range(9):
        put(p, 2 + i, 12 - i, (215, 240, 245, 130))
        put(p, 3 + i, 12 - i, (190, 225, 235, 110))
    steel = shade(STEEL_DK, 0.06)
    frame(p, 0, 0, 15, 15, steel)
    hline(p, 7, 0, 15, steel)
    hline(p, 8, 0, 15, shade(steel, -0.15))
    vline(p, 7, 0, 15, steel)
    vline(p, 8, 0, 15, shade(steel, -0.15))
    for cx, cy in ((1, 1), (13, 1), (1, 13), (13, 13)):
        bolt(p, cx, cy, STEEL_DK)
    return p


def t_vent_panel():
    p = new(shade(STEEL, -0.12))
    grain(p, 29, 0.07)
    # louvers
    for y in range(2, 14, 3):
        hline(p, y, 2, 13, BLACK)
        hline(p, y + 1, 2, 13, shade(STEEL, -0.30))
        hline(p, y + 2, 2, 13, shade(STEEL, 0.22))
    frame(p, 1, 1, 14, 14, shade(STEEL, 0.10))
    for cx, cy in ((0, 0), (14, 0), (0, 14), (14, 14)):
        bolt(p, cx, cy, STEEL)
    return p


def t_cable_conduit():
    p = new(shade(CONCRETE, -0.28))
    grain(p, 31, 0.10)
    tray = shade(GUNMETAL, 0.06)
    rect(p, 2, 0, 13, 15, tray)
    vline(p, 2, 0, 15, shade(tray, 0.25))
    vline(p, 13, 0, 15, shade(tray, -0.25))
    # three cables running vertically
    for x, col in ((4, WARN_RED), (7, (56, 62, 70, 255)), (10, (48, 92, 150, 255))):
        vline(p, x, 0, 15, shade(col, -0.20))
        vline(p, x + 1, 0, 15, col)
    # clamps
    for y in (3, 11):
        hline(p, y, 3, 12, shade(STEEL, 0.10))
        hline(p, y + 1, 3, 12, shade(STEEL, -0.25))
    return p


def t_server_rack_front():
    p = new(BLACK)
    frame(p, 0, 0, 15, 15, shade(GUNMETAL, 0.10))
    for i, y in enumerate(range(2, 15, 3)):
        rect(p, 2, y, 13, y + 1, shade(GUNMETAL, -0.20))
        hline(p, y, 2, 13, shade(GUNMETAL, 0.10))
        # drive slot
        rect(p, 3, y, 8, y, shade(BLACK, 0.10))
        # status LEDs, different per bay
        led = (LED_GREEN, LED_AMBER, LED_GREEN, LED_RED, LED_GREEN)[i % 5]
        put(p, 11, y, led)
        put(p, 12, y + 1, LED_GREEN if i % 2 else shade(LED_GREEN, -0.55))
    grain(p, 37, 0.05)
    return p


def t_server_rack_side():
    p = new(shade(GUNMETAL, 0.04))
    grain(p, 39, 0.06)
    # perforated cooling mesh
    for y in range(3, 14, 2):
        for x in range(3, 14, 2):
            put(p, x, y, shade(BLACK, 0.06))
    frame(p, 1, 1, 14, 14, shade(GUNMETAL, 0.18))
    for cx, cy in ((0, 0), (14, 0), (0, 14), (14, 14)):
        bolt(p, cx, cy, GUNMETAL)
    return p


def t_console_front():
    p = new(shade(GUNMETAL, -0.10))
    grain(p, 43, 0.06)
    rect(p, 2, 2, 13, 8, SCREEN_BG)
    frame(p, 2, 2, 13, 8, shade(GUNMETAL, 0.20))
    # scrolling readout
    for y, w in ((4, 7), (5, 4), (6, 9)):
        hline(p, y, 4, 4 + w, CYAN)
    put(p, 12, 3, LED_GREEN)
    # button bank
    for x in range(3, 13, 3):
        rect(p, x, 11, x + 1, 12, shade(STEEL, -0.10))
        put(p, x, 11, shade(STEEL, 0.25))
    put(p, 3, 11, LED_RED)
    put(p, 12, 11, LED_AMBER)
    hline(p, 14, 0, 15, shade(GUNMETAL, -0.30))
    return p


def t_console_top():
    p = new(shade(GUNMETAL, 0.02))
    grain(p, 47, 0.05)
    # keyboard block
    rect(p, 2, 6, 13, 13, shade(CHARCOAL, 0.06))
    for y in range(7, 13, 2):
        for x in range(3, 13, 2):
            put(p, x, y, shade(STEEL, -0.06))
    # angled display lip
    rect(p, 1, 1, 14, 4, SCREEN_BG)
    hline(p, 2, 3, 10, CYAN)
    hline(p, 3, 3, 6, shade(CYAN, -0.30))
    frame(p, 1, 1, 14, 4, shade(GUNMETAL, 0.22))
    return p


def t_monitor():
    p = new(shade(GUNMETAL, -0.05))
    frame(p, 0, 0, 15, 15, shade(GUNMETAL, 0.16))
    rect(p, 1, 1, 14, 12, SCREEN_BG)
    # waveform / camera feed
    heights = [6, 8, 5, 9, 7, 4, 8, 10, 6, 5, 9, 7, 6, 8]
    for i, h in enumerate(heights):
        vline(p, 1 + i, 12 - h + 4, 11, shade(CYAN, -0.35))
        put(p, 1 + i, 12 - h + 4, CYAN)
    hline(p, 2, 2, 8, shade(CYAN, 0.20))
    hline(p, 11, 1, 14, shade(CYAN, -0.55))
    # scanline
    hline(p, 6, 1, 14, (60, 120, 132, 255))
    put(p, 13, 14, LED_GREEN)
    hline(p, 14, 4, 11, shade(GUNMETAL, -0.25))
    return p


def t_keypad():
    p = new(shade(STEEL, -0.18))
    grain(p, 53, 0.06)
    frame(p, 0, 0, 15, 15, shade(STEEL, 0.14))
    # small display
    rect(p, 2, 1, 13, 4, SCREEN_BG)
    hline(p, 2, 3, 7, LED_GREEN)
    put(p, 12, 3, LED_GREEN)
    # 3x3 keys
    for row in range(3):
        for col in range(3):
            x = 2 + col * 4
            y = 6 + row * 3
            rect(p, x, y, x + 2, y + 1, shade(STEEL, 0.06))
            put(p, x, y, shade(STEEL, 0.30))
            put(p, x + 2, y + 1, shade(STEEL, -0.34))
    rect(p, 10, 12, 12, 13, WARN_RED)
    return p


def t_camera_body():
    p = new(shade(GUNMETAL, 0.06))
    grain(p, 59, 0.06)
    frame(p, 0, 0, 15, 15, shade(GUNMETAL, -0.22))
    hline(p, 1, 1, 14, shade(GUNMETAL, 0.22))
    # lens
    rect(p, 5, 5, 10, 10, BLACK)
    rect(p, 6, 6, 9, 9, (32, 46, 58, 255))
    put(p, 7, 7, (120, 190, 210, 255))
    put(p, 8, 8, (48, 80, 96, 255))
    put(p, 2, 2, LED_RED)
    return p


def t_crate_side():
    p = new(OLIVE)
    grain(p, 61, 0.12)
    frame(p, 0, 0, 15, 15, shade(OLIVE, -0.35))
    hline(p, 1, 1, 14, shade(OLIVE, 0.20))
    # steel corner caps
    for cx, cy in ((0, 0), (12, 0), (0, 12), (12, 12)):
        rect(p, cx, cy, cx + 3, cy + 3, shade(STEEL_DK, 0.04))
        bolt(p, cx + 1, cy + 1, STEEL_DK)
    # strap
    rect(p, 0, 6, 15, 8, shade(CHARCOAL, 0.08))
    hline(p, 6, 0, 15, shade(CHARCOAL, 0.24))
    rect(p, 6, 5, 9, 9, shade(STEEL, -0.10))
    # stencilled markings
    rect(p, 5, 11, 6, 11, HAZARD)
    rect(p, 8, 11, 10, 11, HAZARD)
    return p


def t_crate_top():
    p = new(shade(OLIVE, 0.06))
    grain(p, 63, 0.12)
    frame(p, 0, 0, 15, 15, shade(OLIVE, -0.35))
    rect(p, 0, 6, 15, 8, shade(CHARCOAL, 0.08))
    rect(p, 6, 0, 8, 15, shade(CHARCOAL, 0.08))
    hline(p, 6, 0, 15, shade(CHARCOAL, 0.24))
    vline(p, 6, 0, 15, shade(CHARCOAL, 0.24))
    rect(p, 5, 5, 10, 10, shade(STEEL, -0.12))
    frame(p, 5, 5, 10, 10, shade(STEEL, 0.16))
    put(p, 7, 7, LED_AMBER)
    return p


def t_med_locker():
    p = new(WHITE)
    grain(p, 67, 0.05)
    frame(p, 0, 0, 15, 15, shade(WHITE, -0.22))
    # door split + handle
    vline(p, 7, 1, 14, shade(WHITE, -0.28))
    vline(p, 8, 1, 14, shade(WHITE, 0.10))
    rect(p, 5, 7, 6, 9, shade(STEEL_DK, 0.10))
    rect(p, 9, 7, 10, 9, shade(STEEL_DK, 0.10))
    # red cross
    rect(p, 6, 2, 9, 5, WARN_RED)
    rect(p, 4, 3, 11, 4, WARN_RED)
    # vent slots
    for y in (11, 13):
        hline(p, y, 3, 5, shade(WHITE, -0.30))
        hline(p, y, 10, 12, shade(WHITE, -0.30))
    return p


def t_generator_front():
    p = new(shade(STEEL, -0.22))
    grain(p, 71, 0.08)
    frame(p, 0, 0, 15, 15, shade(STEEL, 0.10))
    # turbine housing
    rect(p, 3, 3, 12, 12, CHARCOAL)
    frame(p, 3, 3, 12, 12, shade(STEEL, 0.18))
    for i in range(4):
        put(p, 5 + i, 5 + i, shade(STEEL, 0.10))
        put(p, 10 - i, 5 + i, shade(STEEL, 0.10))
        put(p, 5 + i, 10 - i, shade(STEEL, -0.10))
        put(p, 10 - i, 10 - i, shade(STEEL, -0.10))
    rect(p, 7, 7, 8, 8, shade(STEEL, 0.28))
    # warning lamp + label
    put(p, 1, 1, LED_AMBER)
    put(p, 14, 1, LED_GREEN)
    rect(p, 5, 14, 10, 14, HAZARD)
    return p


def t_generator_side():
    p = new(shade(STEEL, -0.18))
    grain(p, 73, 0.08)
    for y in range(2, 14, 3):
        hline(p, y, 2, 13, shade(BLACK, 0.08))
        hline(p, y + 1, 2, 13, shade(STEEL, 0.14))
    # pipe
    vline(p, 12, 0, 15, shade(STEEL_DK, 0.18))
    vline(p, 13, 0, 15, shade(STEEL_DK, -0.10))
    frame(p, 1, 1, 14, 14, shade(STEEL, 0.08))
    return p


def t_blast_door():
    p = new(shade(STEEL, -0.10))
    grain(p, 79, 0.06)
    frame(p, 0, 0, 15, 15, shade(STEEL_DK, 0.02))
    hline(p, 1, 1, 14, shade(STEEL, 0.22))
    # centre seam of the two door leaves
    vline(p, 7, 1, 14, shade(BLACK, 0.10))
    vline(p, 8, 1, 14, shade(STEEL, 0.24))
    # hazard chevrons across the middle
    for y in range(6, 10):
        for x in range(1, 15):
            if ((x + y) % 6) < 3:
                put(p, x, y, HAZARD)
            else:
                put(p, x, y, shade(BLACK, 0.06))
    hline(p, 5, 1, 14, shade(STEEL, 0.18))
    hline(p, 10, 1, 14, shade(STEEL, -0.26))
    # hinge bolts
    for y in (2, 12):
        bolt(p, 2, y, STEEL)
        bolt(p, 12, y, STEEL)
    # handles
    rect(p, 5, 11, 6, 13, shade(STEEL_DK, 0.16))
    rect(p, 9, 11, 10, 13, shade(STEEL_DK, 0.16))
    return p


def t_blast_door_frame():
    p = new(shade(STEEL_DK, 0.06))
    grain(p, 83, 0.07)
    hline(p, 0, 0, 15, shade(STEEL, 0.20))
    hline(p, 15, 0, 15, shade(STEEL, -0.30))
    for y in range(1, 15, 4):
        bolt(p, 7, y, STEEL_DK)
    vline(p, 3, 0, 15, shade(STEEL_DK, -0.22))
    vline(p, 12, 0, 15, shade(STEEL_DK, -0.22))
    return p


def t_vault_door():
    p = new(shade(STEEL, -0.14))
    grain(p, 89, 0.06)
    frame(p, 0, 0, 15, 15, shade(STEEL_DK, 0.10))
    # circular door plate
    cx = cy = 7.5
    for y in range(SIZE):
        for x in range(SIZE):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            if d < 7.2:
                put(p, x, y, shade(STEEL, 0.06))
            if 6.2 < d < 7.2:
                put(p, x, y, shade(STEEL, -0.28))
            if 4.6 < d < 5.4:
                put(p, x, y, shade(STEEL, -0.18))
    # spoke wheel
    for i in range(-4, 5):
        put(p, 7 + i, 7, shade(STEEL_DK, 0.22))
        put(p, 8 + i, 8, shade(STEEL_DK, 0.22))
        put(p, 7, 7 + i, shade(STEEL_DK, 0.22))
        put(p, 8, 8 + i, shade(STEEL_DK, 0.22))
    rect(p, 6, 6, 9, 9, shade(STEEL, 0.24))
    rect(p, 7, 7, 8, 8, shade(STEEL_DK, -0.10))
    for cx2, cy2 in ((1, 1), (13, 1), (1, 13), (13, 13)):
        bolt(p, cx2, cy2, STEEL)
    return p


def t_radiation_sign():
    p = new(HAZARD)
    grain(p, 97, 0.08)
    frame(p, 0, 0, 15, 15, shade(HAZARD, -0.30))
    cx = cy = 7.5
    for y in range(SIZE):
        for x in range(SIZE):
            dx, dy = x - cx, y - cy
            d = (dx * dx + dy * dy) ** 0.5
            if d < 1.9:
                put(p, x, y, BLACK)
                continue
            if 3.0 < d < 7.0:
                # three 60-degree blades
                import math

                ang = (math.degrees(math.atan2(dy, dx)) + 360) % 120
                if ang < 60:
                    put(p, x, y, BLACK)
    return p


def t_hatch_top():
    p = new(shade(STEEL_DK, 0.02))
    grain(p, 101, 0.10)
    frame(p, 0, 0, 15, 15, shade(STEEL_DK, -0.28))
    hline(p, 1, 1, 14, shade(STEEL, 0.14))
    # tread plate diamonds
    for y in range(2, 14, 4):
        for x in range(2, 14, 4):
            put(p, x, y, shade(STEEL, 0.22))
            put(p, x + 1, y + 1, shade(STEEL, 0.22))
            put(p, x + 1, y, shade(STEEL, -0.20))
            put(p, x, y + 1, shade(STEEL, -0.20))
    # recessed pull ring
    cx = cy = 7.5
    for y in range(SIZE):
        for x in range(SIZE):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            if 3.0 < d < 4.3:
                put(p, x, y, shade(STEEL_DK, -0.30))
            elif 2.0 < d <= 3.0:
                put(p, x, y, shade(CHARCOAL, 0.04))
    rect(p, 6, 12, 9, 13, HAZARD)
    return p


def t_hatch_side():
    p = new(shade(CONCRETE, -0.18))
    grain(p, 103, 0.12)
    hline(p, 0, 0, 15, shade(STEEL_DK, 0.10))
    hline(p, 1, 0, 15, shade(STEEL_DK, -0.12))
    for x in range(2, 14, 4):
        bolt(p, x, 3, STEEL_DK)
    return p


def t_locker():
    p = new(shade(GUNMETAL, 0.10))
    grain(p, 107, 0.06)
    frame(p, 0, 0, 15, 15, shade(GUNMETAL, -0.24))
    vline(p, 7, 1, 14, shade(GUNMETAL, -0.30))
    vline(p, 8, 1, 14, shade(GUNMETAL, 0.16))
    for x0 in (1, 8):
        for y in (3, 4, 5):
            hline(p, y, x0 + 1, x0 + 5, shade(GUNMETAL, -0.22))
    rect(p, 5, 8, 6, 10, shade(STEEL, 0.06))
    rect(p, 9, 8, 10, 10, shade(STEEL, 0.06))
    put(p, 6, 8, LED_GREEN)
    return p


def t_bunker_door_top():
    """Shared top/bottom cap for door-ish blocks."""
    p = new(shade(STEEL_DK, 0.04))
    grain(p, 109, 0.08)
    hline(p, 7, 0, 15, shade(BLACK, 0.08))
    hline(p, 8, 0, 15, shade(STEEL, 0.14))
    for x in (2, 12):
        bolt(p, x, 3, STEEL_DK)
        bolt(p, x, 11, STEEL_DK)
    return p


# ---------------------------------------------------------------------------
# Item textures
# ---------------------------------------------------------------------------


def t_item_keycard():
    p = new(CLEAR)
    body = (46, 82, 132, 255)
    rect(p, 2, 3, 13, 12, body)
    frame(p, 2, 3, 13, 12, shade(body, -0.35))
    hline(p, 3, 3, 12, shade(body, 0.28))
    # magnetic stripe
    rect(p, 2, 5, 13, 6, shade(BLACK, 0.10))
    hline(p, 5, 2, 13, shade(BLACK, 0.30))
    # gold chip
    rect(p, 4, 8, 6, 10, (214, 176, 68, 255))
    frame(p, 4, 8, 6, 10, (140, 108, 30, 255))
    put(p, 5, 9, (245, 218, 130, 255))
    # printed data lines
    hline(p, 8, 8, 12, shade(body, 0.45))
    hline(p, 10, 8, 11, shade(body, 0.30))
    # clearance pip
    put(p, 12, 10, LED_GREEN)
    return p


def t_item_beacon():
    p = new(CLEAR)
    body = shade(GUNMETAL, 0.05)
    # case
    rect(p, 3, 6, 12, 14, body)
    frame(p, 3, 6, 12, 14, shade(body, -0.40))
    hline(p, 6, 4, 11, shade(body, 0.30))
    # screen
    rect(p, 5, 8, 10, 10, SCREEN_BG)
    hline(p, 9, 6, 9, CYAN)
    put(p, 5, 8, CYAN)
    # antenna
    vline(p, 8, 1, 5, shade(STEEL, -0.05))
    put(p, 7, 2, shade(STEEL, 0.20))
    put(p, 8, 0, LED_RED)
    put(p, 9, 1, shade(LED_RED, -0.30))
    # deploy button + grip
    rect(p, 5, 12, 6, 13, WARN_RED)
    rect(p, 9, 12, 11, 13, HAZARD)
    return p


def t_item_tracker():
    p = new(CLEAR)
    body = shade(OLIVE, 0.02)
    rect(p, 2, 2, 13, 13, body)
    frame(p, 2, 2, 13, 13, shade(body, -0.42))
    hline(p, 2, 3, 12, shade(body, 0.30))
    # radar screen
    rect(p, 4, 4, 11, 11, SCREEN_BG)
    frame(p, 4, 4, 11, 11, shade(body, -0.25))
    for i in range(6):
        put(p, 5 + i, 5 + i, shade(LED_GREEN, -0.40))
    hline(p, 7, 5, 10, shade(LED_GREEN, -0.15))
    vline(p, 7, 5, 10, shade(LED_GREEN, -0.15))
    put(p, 9, 6, LED_GREEN)
    put(p, 6, 9, shade(LED_GREEN, -0.20))
    # controls
    put(p, 3, 13, LED_RED)
    put(p, 12, 13, LED_AMBER)
    return p


# ---------------------------------------------------------------------------
# Pack icons (64x64, drawn at 16 and scaled)
# ---------------------------------------------------------------------------


def t_pack_icon():
    p = new(CHARCOAL)
    grain(p, 113, 0.10)
    # bunker silhouette
    rect(p, 2, 9, 13, 14, CONCRETE)
    rect(p, 4, 6, 11, 9, shade(CONCRETE, 0.10))
    hline(p, 6, 4, 11, shade(CONCRETE, 0.26))
    # blast door
    rect(p, 6, 10, 9, 14, shade(STEEL, -0.10))
    for y in range(11, 14):
        for x in range(6, 10):
            if ((x + y) % 4) < 2:
                put(p, x, y, HAZARD)
    # warning lamp
    put(p, 7, 4, LED_RED)
    put(p, 8, 4, shade(LED_RED, -0.30))
    # hazard floor line
    for x in range(SIZE):
        put(p, x, 15, HAZARD if (x // 2) % 2 == 0 else BLACK)
    return p


def scale(p, factor):
    out = []
    for row in p:
        big = [c for c in row for _ in range(factor)]
        for _ in range(factor):
            out.append(list(big))
    return out


# ---------------------------------------------------------------------------

BLOCKS = {
    "bunker_reinforced_concrete": t_reinforced_concrete,
    "bunker_concrete_panel": t_concrete_panel,
    "bunker_hazard_stripe": t_hazard_stripe,
    "bunker_steel_plating": t_steel_plating,
    "bunker_steel_grate": t_steel_grate,
    "bunker_floor_tile": t_floor_tile,
    "bunker_ceiling_light": t_ceiling_light,
    "bunker_emergency_light": t_emergency_light,
    "bunker_reinforced_glass": t_reinforced_glass,
    "bunker_vent_panel": t_vent_panel,
    "bunker_cable_conduit": t_cable_conduit,
    "bunker_server_rack_front": t_server_rack_front,
    "bunker_server_rack_side": t_server_rack_side,
    "bunker_console_front": t_console_front,
    "bunker_console_top": t_console_top,
    "bunker_monitor": t_monitor,
    "bunker_keypad": t_keypad,
    "bunker_camera": t_camera_body,
    "bunker_crate_side": t_crate_side,
    "bunker_crate_top": t_crate_top,
    "bunker_med_locker": t_med_locker,
    "bunker_locker": t_locker,
    "bunker_generator_front": t_generator_front,
    "bunker_generator_side": t_generator_side,
    "bunker_blast_door": t_blast_door,
    "bunker_blast_door_frame": t_blast_door_frame,
    "bunker_vault_door": t_vault_door,
    "bunker_radiation_sign": t_radiation_sign,
    "bunker_hatch_top": t_hatch_top,
    "bunker_hatch_side": t_hatch_side,
    "bunker_door_cap": t_bunker_door_top,
}

ITEMS = {
    "bunker_keycard": t_item_keycard,
    "bunker_deployment_beacon": t_item_beacon,
    "bunker_motion_tracker": t_item_tracker,
}


def preview(name):
    maker = BLOCKS.get(name) or ITEMS.get(name)
    if not maker:
        print(f"unknown texture: {name}")
        return
    ramp = " .:-=+*#%@"
    for row in maker():
        line = ""
        for r, g, b, a in row:
            if a == 0:
                line += "  "
            else:
                lum = (r * 0.3 + g * 0.6 + b * 0.1) / 255
                line += ramp[min(9, int(lum * 9))] * 2
        print(line)


def main():
    if "--preview" in sys.argv:
        preview(sys.argv[sys.argv.index("--preview") + 1])
        return

    os.makedirs(BLOCK_DIR, exist_ok=True)
    os.makedirs(ITEM_DIR, exist_ok=True)

    for name, maker in BLOCKS.items():
        write_png(os.path.join(BLOCK_DIR, name + ".png"), maker())
    for name, maker in ITEMS.items():
        write_png(os.path.join(ITEM_DIR, name + ".png"), maker())

    icon = scale(t_pack_icon(), 4)
    write_png(os.path.join(RP, "pack_icon.png"), icon)
    os.makedirs(BP, exist_ok=True)
    write_png(os.path.join(BP, "pack_icon.png"), icon)

    print(f"Wrote {len(BLOCKS)} block textures, {len(ITEMS)} item textures, 2 pack icons.")


if __name__ == "__main__":
    main()
