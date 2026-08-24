#!/usr/bin/env python3
"""Generate every 2D texture for the Sakura Bodyguard add-on.

Pure standard library (struct + zlib only, NO Pillow) so the pack can be
rebuilt anywhere.  Follows the house style of tools/gen_textures.py:
16x16 icons are built as dicts of (col, row) -> palette key, run through
outline(), then rendered against a palette.

IMPORTANT DIFFERENCE FROM tools/gen_textures.py: write_png() here derives the
image dimensions from the pixel array instead of a module-level SIZE global,
so the same writer emits 16x16 icons and 64x64 pack icons correctly.

Outputs
  resource_packs/bodyguard_rp/textures/items/sakura_katana.png   16x16
  resource_packs/bodyguard_rp/textures/items/sakura_charm.png    16x16
  resource_packs/bodyguard_rp/textures/items/onigiri.png         16x16
  resource_packs/bodyguard_rp/textures/particle/sakura_petal.png 16x16
  resource_packs/bodyguard_rp/pack_icon.png                      64x64
  behavior_packs/bodyguard_bp/pack_icon.png                      64x64

Usage:  python3 tools/gen_bodyguard_icons.py [--preview]
"""

import os
import struct
import sys
import zlib

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RP = os.path.join(REPO_ROOT, "resource_packs", "bodyguard_rp")
BP = os.path.join(REPO_ROOT, "behavior_packs", "bodyguard_bp")

ITEM_DIR = os.path.join(RP, "textures", "items")
PARTICLE_DIR = os.path.join(RP, "textures", "particle")

SIZE = 16          # icon grid edge
ICON_SIZE = 64     # pack icon edge

TRANSPARENT = (0, 0, 0, 0)


# --------------------------------------------------------------------------
# PNG output
# --------------------------------------------------------------------------

def write_png(path, pixels):
    """pixels: list of rows, each row a list of (r, g, b, a). 8-bit RGBA."""
    height = len(pixels)
    width = len(pixels[0])
    for row in pixels:
        if len(row) != width:
            raise ValueError("ragged pixel array")

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


def rgba(hex_string, alpha=255):
    """'#RRGGBB' -> (r, g, b, a)."""
    text = hex_string.lstrip("#")
    return (int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16), alpha)


# --------------------------------------------------------------------------
# 16x16 cell helpers - identical contract to tools/gen_textures.py
# --------------------------------------------------------------------------

def put(cells, col, row, key, overwrite=True):
    if 0 <= col < SIZE and 0 <= row < SIZE:
        if overwrite or (col, row) not in cells:
            cells[(col, row)] = key


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
# Icon 1 - sakura_katana
# --------------------------------------------------------------------------

KATANA_PALETTE = {
    "b": rgba("#B9C9D6"),   # blade body / shaded side
    "h": rgba("#F0F7FC"),   # bright cutting edge
    "m": rgba("#A87A2E"),   # tsuba shadow (dark gold)
    "g": rgba("#E0B65C"),   # tsuba (gold)
    "w": rgba("#C0395E"),   # ito wrap (pink)
    "p": rgba("#7A1F3B"),   # wrap shadow / pommel
    "s": rgba("#F79AC0"),   # falling petal
    "o": rgba("#2A1620"),   # outline
}


def katana_shape():
    """Single-edged diagonal katana: tip top-right, pommel bottom-left.

    Everything hangs off the axis col = 14 - row (shaded spine) and
    col = 15 - row (lit edge), the same trick sword_shape() uses, so the
    blade, guard and grip can never drift out of alignment.
    """
    cells = {}
    petals = {}

    # --- blade, rows 1..8: shaded back + bright single edge ----------------
    for row in range(1, 9):
        put(cells, 14 - row, row, "b")   # mune (back), shaded
        put(cells, 15 - row, row, "h")   # ha (cutting edge), lit
    put(cells, 14, 1, "h")               # squared-off kissaki
    put(cells, 13, 2, "h")               # a touch of sori (curvature)

    # --- tsuba: a small round guard bridging blade end and grip start ------
    # The blade stops at row 8 (cols 6,7) and the grip starts at row 11
    # (cols 3,4); this blob fills rows 9-10 so the weapon is one connected
    # silhouette, and it is a disc rather than a cross - katana, not longsword.
    for col in (4, 5, 6):
        put(cells, col, 9, "g")
        put(cells, col, 10, "g")
    put(cells, 5, 8, "g")
    put(cells, 6, 10, "m")               # lower-right of the disc, shaded
    put(cells, 5, 11, "m")               # habaki collar into the grip

    # --- grip (tsuka), rows 11..15, alternating ito wrap -------------------
    for row in range(11, 16):
        for col in (14 - row, 15 - row):
            put(cells, col, row, "w" if row % 2 else "p")
    put(cells, 1, 14, "g")               # menuki stud
    put(cells, 0, 15, "g")               # kashira / pommel cap

    # --- falling petals (drawn on top of the outline, never outlined) ------
    for col, row in ((14, 4), (12, 7), (10, 11), (7, 14)):
        put(petals, col, row, "s")

    return cells, petals


# --------------------------------------------------------------------------
# Icon 2 - sakura_charm
# --------------------------------------------------------------------------

CHARM_PALETTE = {
    "b": rgba("#F2799F"),   # petal mid
    "h": rgba("#FFDCEC"),   # petal light
    "w": rgba("#C0395E"),   # petal shadow
    "p": rgba("#FFFFFF"),   # inner glow / pistil
    "g": rgba("#E0B65C"),   # gold ring + tassel cord
    "y": rgba("#A87A2E"),   # gold shadow
    "t": rgba("#E2314F"),   # tassel silk
    "o": rgba("#3A2130"),   # outline
}


def charm_shape():
    """Five-petal cherry blossom hung from a gold ring, short tassel below."""
    cells = {}

    # --- gold ring at the top ---------------------------------------------
    # Explicit cells: a computed circle at r=2 is mush at this scale.
    for col in (7, 8, 9):
        put(cells, col, 0, "g")
    for row in (1, 2):
        put(cells, 6, row, "g")
        put(cells, 10, row, "y")
    for col in (7, 8, 9):
        put(cells, col, 3, "y")
    put(cells, 8, 4, "g")                # cord down into the blossom

    # --- five petals around a common centre --------------------------------
    cx, cy = 8.0, 9.0
    petal_centres = [
        (8, 6),     # up
        (11, 8),    # upper right
        (10, 12),   # lower right
        (6, 12),    # lower left
        (5, 8),     # upper left
    ]
    for pc, pr in petal_centres:
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                col, row = pc + dc, pr + dr
                # Clip the corner facing away from the centre: rounds the tip.
                if abs(dc) == 1 and abs(dr) == 1:
                    if (col - cx) * dc > 0 and (row - cy) * dr > 0:
                        continue
                # Lit on the upper-left of each petal, mid elsewhere.
                put(cells, col, row, "h" if (dc <= 0 and dr <= 0) else "b")

    # --- notches carved between adjacent petals ---------------------------
    # Without these the five blobs fuse into one pink lump at 16px.  The
    # notches are radial lines along the five midpoint directions, and they
    # only ever RECOLOUR cells the petals already claimed, so they can never
    # grow the silhouette.
    midpoints = [
        (0.588, -0.809),    # between "up" and "upper right"
        (0.951, 0.309),     # between "upper right" and "lower right"
        (0.0, 1.0),         # between "lower right" and "lower left"
        (-0.951, 0.309),    # between "lower left" and "upper left"
        (-0.588, -0.809),   # between "upper left" and "up"
    ]
    for dx, dy in midpoints:
        step = 1.6
        while step <= 4.2:
            col = int(round(cx + dx * step))
            row = int(round(cy + dy * step))
            if (col, row) in cells:
                # Deep separator further out, softer shadow near the centre.
                cells[(col, row)] = "o" if 2.4 <= step <= 3.5 else "w"
            step += 0.35

    # --- soft inner glow at the blossom centre ----------------------------
    # Kept to a 5-texel plus: a full 3x3 white core swallows the petals.
    for col, row in ((7, 9), (9, 9), (8, 8), (8, 10)):
        put(cells, col, row, "h")
    put(cells, 8, 9, "p")
    for col, row in ((7, 8), (9, 10)):
        put(cells, col, row, "g")

    # --- short tassel below ------------------------------------------------
    put(cells, 8, 14, "g")
    for col in (7, 8, 9):
        put(cells, col, 15, "t")

    return cells


# --------------------------------------------------------------------------
# Icon 3 - onigiri
# --------------------------------------------------------------------------

ONIGIRI_PALETTE = {
    "b": rgba("#FBF6EC"),   # rice
    "h": rgba("#FFFFFF"),   # lit rice edge
    "d": rgba("#DCD2BF"),   # rice shadow
    "g": rgba("#2E3A33"),   # nori
    "w": rgba("#1C241F"),   # nori shadow
    "p": rgba("#D8404A"),   # umeboshi
    "q": rgba("#F07682"),   # umeboshi highlight
    "o": rgba("#43392C"),   # outline
}

# Rounded triangle, symmetric about col 8.  (row: left_col, right_col)
RICE_ROWS = {
    3: (8, 8),
    4: (7, 9),
    5: (7, 9),
    6: (6, 10),
    7: (6, 10),
    8: (5, 11),
    9: (5, 11),
    10: (4, 12),
    11: (4, 12),
    12: (3, 13),
    13: (4, 12),
}


def onigiri_shape():
    """Rounded rice triangle, nori band across the base, one umeboshi."""
    cells = {}

    for row, (left, right) in RICE_ROWS.items():
        for col in range(left, right + 1):
            put(cells, col, row, "b")
        # Lit upper-left face, shaded lower-right face.
        put(cells, left, row, "h")
        if row >= 5:
            put(cells, left + 1, row, "h")
        put(cells, right, row, "d")
    for col in range(RICE_ROWS[3][0], RICE_ROWS[3][1] + 1):
        put(cells, col, 3, "h")

    # --- nori band across the bottom --------------------------------------
    for row in (11, 12, 13):
        left, right = RICE_ROWS[row]
        for col in range(left, right + 1):
            put(cells, col, row, "w" if row == 13 else "g")
    # A 1px lighter top edge on the nori so it does not read as a hole.
    for col in range(RICE_ROWS[11][0], RICE_ROWS[11][1] + 1):
        put(cells, col, 11, "g")

    # --- umeboshi plum ----------------------------------------------------
    for col, row in ((7, 6), (8, 6), (7, 7), (8, 7)):
        put(cells, col, row, "p")
    put(cells, 7, 6, "q")

    # --- two sesame specks ------------------------------------------------
    put(cells, 5, 9, "d")
    put(cells, 11, 8, "d")

    return cells


# --------------------------------------------------------------------------
# Icon 4 - sakura_petal particle (top-left 8x8 cell only)
# --------------------------------------------------------------------------

PETAL_LIGHT = rgba("#FFE3EE")
PETAL_MID = rgba("#FCB4CE")
PETAL_DARK = rgba("#E88AAE")

# Heart-notched petal confined to cols 0..7 / rows 0..7.
PETAL_ROWS = {
    0: (2, 5),
    1: (1, 6),
    2: (1, 6),
    3: (1, 6),
    4: (1, 6),
    5: (2, 5),
    6: (2, 5),
    7: (3, 4),
}
PETAL_NOTCH = {(3, 0), (4, 0)}


def sakura_petal_grid():
    grid = [[TRANSPARENT for _ in range(SIZE)] for _ in range(SIZE)]

    filled = set()
    for row, (left, right) in PETAL_ROWS.items():
        for col in range(left, right + 1):
            if (col, row) in PETAL_NOTCH:
                continue
            filled.add((col, row))

    for (col, row) in filled:
        # Soft edge: any texel missing an orthogonal neighbour fades out.
        neighbours = sum(
            1
            for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1))
            if (col + dc, row + dr) in filled
        )
        if col + row <= 4:
            base = PETAL_LIGHT
        elif col + row >= 9:
            base = PETAL_DARK
        else:
            base = PETAL_MID
        alpha = 255 if neighbours == 4 else 205
        grid[row][col] = (base[0], base[1], base[2], alpha)

    return grid


# --------------------------------------------------------------------------
# 64x64 canvas helpers for the pack icons
# --------------------------------------------------------------------------

def new_canvas(size=ICON_SIZE, fill=TRANSPARENT):
    return [[fill for _ in range(size)] for _ in range(size)]


def px(grid, x, y, color):
    if 0 <= x < len(grid[0]) and 0 <= y < len(grid):
        grid[y][x] = color


def rect(grid, x0, y0, x1, y1, color):
    for y in range(int(y0), int(y1) + 1):
        for x in range(int(x0), int(x1) + 1):
            px(grid, x, y, color)


def rrect(grid, x0, y0, x1, y1, color, radius):
    """Rounded rectangle, inclusive bounds."""
    for y in range(int(y0), int(y1) + 1):
        for x in range(int(x0), int(x1) + 1):
            cx = min(max(x, x0 + radius), x1 - radius)
            cy = min(max(y, y0 + radius), y1 - radius)
            if (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius + radius * 0.5:
                px(grid, x, y, color)


def ellipse(grid, cx, cy, rx, ry, color):
    for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
        for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
            if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.0:
                px(grid, x, y, color)


def thick_line(grid, x0, y0, x1, y1, half, color, t_start=0.0, t_end=1.0):
    """Draw a segment of the line from t_start..t_end with a square brush."""
    steps = int(max(abs(x1 - x0), abs(y1 - y0)) * 3) + 1
    for i in range(steps + 1):
        t = i / steps
        if not (t_start <= t <= t_end):
            continue
        x = round(x0 + (x1 - x0) * t)
        y = round(y0 + (y1 - y0) * t)
        for dy in range(-half, half + 1):
            for dx in range(-half, half + 1):
                px(grid, x + dx, y + dy, color)


def lerp_color(a, b, t):
    return (
        round(a[0] + (b[0] - a[0]) * t),
        round(a[1] + (b[1] - a[1]) * t),
        round(a[2] + (b[2] - a[2]) * t),
        255,
    )


# Deterministic scatter of background petals: (x, y, size) hand-placed so the
# icon is byte-identical on every rebuild (no RNG, no seed to drift).
BG_PETALS = [
    (7, 8, 2), (20, 4, 1), (46, 6, 2), (57, 13, 1), (5, 25, 1),
    (59, 30, 2), (3, 41, 2), (61, 45, 1), (11, 55, 1), (33, 58, 2),
    (52, 57, 2), (21, 60, 1), (44, 61, 1), (16, 15, 1), (49, 50, 1),
]


def pack_icon_grid(theme):
    """Key-art tile: Aya's bust over a gradient, petals, crossed katanas.

    Both packs share the artwork and differ only by the background / frame /
    ribbon tint, so they are instantly distinguishable in the pack list while
    still reading as one set.

    Draw order is strictly back-to-front: gradient, petals, crossed katanas,
    uniform collar, twin-tails, hair mass, face, bangs, features, ahoge,
    frame.  Every hair and skin mass is laid down twice - a 1px-larger dark
    plate first, then the fill - which is how the silhouette keeps its outline
    without a separate (and much slower) edge-detect pass.
    """
    g = new_canvas()

    top = theme["bg_top"]
    bottom = theme["bg_bottom"]
    for y in range(ICON_SIZE):
        row_color = lerp_color(top, bottom, y / (ICON_SIZE - 1))
        for x in range(ICON_SIZE):
            g[y][x] = row_color

    # --- background petals -------------------------------------------------
    for x, y, s_ in BG_PETALS:
        ellipse(g, x, y, s_ + 0.8, s_ + 0.3, theme["bg_petal"])
        px(g, x, y - s_, theme["bg_petal_lit"])

    # --- crossed katanas behind the head ----------------------------------
    # t = 0 is the pommel, t = 1 the kissaki.  A dark pass first gives the
    # whole crest a hard edge so pale steel survives on a pale pink ground.
    ink = rgba("#2A1620")
    for (ax, ay, bx, by) in ((5, 59, 59, 4), (59, 59, 5, 4)):
        thick_line(g, ax, ay, bx, by, 1, ink, 0.00, 1.00)               # edge
        thick_line(g, ax, ay, bx, by, 0, rgba("#8FA5B6"), 0.28, 0.97)   # back
        thick_line(g, ax, ay, bx, by, 0, rgba("#F2F9FF"), 0.30, 0.99)   # ha
        thick_line(g, ax, ay, bx, by, 1, rgba("#E0B65C"), 0.21, 0.26)   # tsuba
        thick_line(g, ax, ay, bx, by, 0, rgba("#C0395E"), 0.04, 0.19)   # ito

    # --- neck + sailor collar (the bust the head sits on) ------------------
    rect(g, 27, 42, 36, 51, theme["skin_shadow"])
    rrect(g, 15, 47, 48, 61, ink, 6)
    rrect(g, 16, 48, 47, 60, theme["uniform"], 6)
    rect(g, 18, 51, 45, 51, theme["uniform_trim"])
    rect(g, 18, 53, 45, 53, theme["uniform_trim"])
    # V neckline cut back to skin
    for i in range(7):
        rect(g, 32 - i, 47 + i, 31 + i, 48 + i, theme["skin_shadow"])
    # neckerchief knot
    rrect(g, 28, 52, 36, 60, ink, 3)
    rrect(g, 29, 53, 35, 59, theme["ribbon"], 3)
    rect(g, 30, 54, 34, 54, theme["ribbon_lit"])

    hair_dark = theme["hair_dark"]
    hair_mid = theme["hair_mid"]
    hair_light = theme["hair_light"]

    # --- twin-tails --------------------------------------------------------
    for side in (-1, 1):
        cx = 32 + side * 21
        rrect(g, cx - 7, 22, cx + 7, 55, ink, 7)
        rrect(g, cx - 6, 23, cx + 6, 53, hair_dark, 6)
        rrect(g, cx - 5, 24, cx + 5, 51, hair_mid, 5)
        # single specular stripe, on the outward face of each tail
        rect(g, cx - side * 3, 28, cx - side * 3 + 1, 46, hair_light)
        # ribbon tie at the root
        rrect(g, cx - 8, 19, cx + 8, 28, ink, 4)
        rrect(g, cx - 7, 20, cx + 7, 27, theme["ribbon"], 4)
        rect(g, cx - 5, 22, cx + 5, 22, theme["ribbon_lit"])

    # --- hair mass ---------------------------------------------------------
    rrect(g, 13, 10, 50, 50, ink, 13)
    rrect(g, 14, 11, 49, 49, hair_dark, 13)
    rrect(g, 15, 12, 48, 47, hair_mid, 12)

    # --- face --------------------------------------------------------------
    rrect(g, 17, 18, 46, 48, ink, 9)
    rrect(g, 18, 19, 45, 47, theme["skin_shadow"], 9)
    rrect(g, 18, 19, 45, 45, theme["skin_mid"], 8)
    ellipse(g, 32, 32, 11, 9, theme["skin_light"])

    # --- bangs: saw-toothed fringe over the forehead -----------------------
    tooth = [29, 26, 30, 27, 29, 26, 30, 27]
    for x in range(16, 48):
        depth = tooth[((x - 16) // 4) % len(tooth)]
        for y in range(13, depth + 1):
            px(g, x, y, hair_mid)
        px(g, x, depth, hair_dark)
        px(g, x, depth + 1, ink)
    for x in range(18, 46):
        px(g, x, 15, hair_light)
        px(g, x, 16, hair_light)
    # face-framing side locks
    for side in (-1, 1):
        cx = 32 + side * 15
        rrect(g, cx - 3, 18, cx + 3, 44, ink, 3)
        rrect(g, cx - 2, 18, cx + 2, 42, hair_mid, 2)
        rect(g, cx - side, 22, cx - side, 38, hair_light)

    # --- eyes: 7x12 including the lash frame, deliberately oversized -------
    lash = theme["eye_lash"]
    for side in (-1, 1):
        x0 = 22 if side < 0 else 36
        x1 = x0 + 6
        rect(g, x0 - 1, 29, x1 + 1, 42, lash)      # lash frame
        rect(g, x0, 33, x1, 35, theme["iris_dark"])
        rect(g, x0, 36, x1, 38, theme["iris_mid"])
        rect(g, x0, 39, x1, 40, theme["iris_light"])
        rect(g, x0, 29, x1, 32, lash)              # heavy upper lid
        # catchlights mirror outward so the pair reads as one gaze
        hx = x0 if side < 0 else x1 - 2
        rect(g, hx, 33, hx + 2, 35, rgba("#FFFFFF"))
        sx = x1 - 1 if side < 0 else x0
        rect(g, sx, 38, sx + 1, 39, rgba("#FFFFFF"))

    # nose-bridge light between the eyes (no nose is drawn - chibi omits it)
    rect(g, 30, 33, 33, 38, theme["skin_light"])

    # --- blush -------------------------------------------------------------
    for side in (-1, 1):
        cx = 32 + side * 11
        ellipse(g, cx, 43, 4, 2.2, theme["blush"])
        ellipse(g, cx, 42, 3, 1.2, theme["blush_soft"])

    # --- mouth -------------------------------------------------------------
    rect(g, 31, 44, 32, 44, theme["mouth"])
    px(g, 30, 43, theme["mouth"])
    px(g, 33, 43, theme["mouth"])

    # --- ahoge (cowlick), drawn last so it sits clear of the hair mass -----
    ahoge = [(30, 9), (30, 7), (30, 5), (31, 4), (33, 3), (35, 2), (37, 3)]
    for (x, y) in ahoge:
        rect(g, x - 1, y - 1, x + 1, y + 1, ink)
    for (x, y) in ahoge:
        px(g, x, y, hair_light)
        px(g, x, y + 1, hair_mid)

    # --- frame -------------------------------------------------------------
    frame = theme["frame"]
    rect(g, 0, 0, ICON_SIZE - 1, 1, frame)
    rect(g, 0, ICON_SIZE - 2, ICON_SIZE - 1, ICON_SIZE - 1, frame)
    rect(g, 0, 0, 1, ICON_SIZE - 1, frame)
    rect(g, ICON_SIZE - 2, 0, ICON_SIZE - 1, ICON_SIZE - 1, frame)
    for (x, y) in ((0, 0), (1, 0), (0, 1),
                   (63, 0), (62, 0), (63, 1),
                   (0, 63), (0, 62), (1, 63),
                   (63, 63), (62, 63), (63, 62)):
        px(g, x, y, theme["corner"])

    return g


RP_THEME = {
    "bg_top": rgba("#FFD3E4"),
    "bg_bottom": rgba("#C93F71"),
    "bg_petal": rgba("#FFC9DD"),
    "bg_petal_lit": rgba("#FFFFFF"),
    "frame": rgba("#8E2846"),
    "corner": rgba("#C05A80"),
    "hair_light": rgba("#FFDCEC"),
    "hair_mid": rgba("#F79AC0"),
    "hair_dark": rgba("#BF5B89"),
    "uniform": rgba("#FAF4F7"),
    "uniform_trim": rgba("#F2799F"),
    "ribbon": rgba("#E2314F"),
    "ribbon_lit": rgba("#FF8FA0"),
    "skin_light": rgba("#FFF2E6"),
    "skin_mid": rgba("#FFD9C2"),
    "skin_shadow": rgba("#CE8E72"),
    "eye_lash": rgba("#33192A"),
    "iris_light": rgba("#FF8FA8"),
    "iris_mid": rgba("#E8547A"),
    "iris_dark": rgba("#96234A"),
    "blush": rgba("#FF9BB0"),
    "blush_soft": rgba("#FFC4D2"),
    "mouth": rgba("#B03A5C"),
}

# The behaviour pack wears the same key art under a plum/twilight tint so the
# two entries are instantly distinguishable in the pack list.
BP_THEME = dict(RP_THEME)
BP_THEME.update({
    "bg_top": rgba("#9E82D0"),
    "bg_bottom": rgba("#251B42"),
    "bg_petal": rgba("#D9C4F2"),
    "bg_petal_lit": rgba("#F4EBFF"),
    "frame": rgba("#241A3E"),
    "corner": rgba("#5A4488"),
    "hair_dark": rgba("#8E4C7E"),
    "uniform": rgba("#2C3566"),
    "uniform_trim": rgba("#F0C46B"),
    "ribbon": rgba("#F0C46B"),
    "ribbon_lit": rgba("#FFF0C0"),
})


# --------------------------------------------------------------------------
# Preview / driver
# --------------------------------------------------------------------------

CHARS = {
    "b": "#", "h": "@", "m": "+", "g": "*", "w": "=", "p": "o",
    "s": "%", "d": ",", "q": "^", "t": "T", "y": "y", "o": ".",
}


def preview(cells):
    lines = []
    for row in range(SIZE):
        lines.append(
            "".join(CHARS.get(cells.get((col, row)), " ") for col in range(SIZE))
        )
    return "\n".join(lines)


def main():
    show = "--preview" in sys.argv
    written = []

    # --- sakura_katana ----------------------------------------------------
    body, petals = katana_shape()
    cells = outline(body)
    cells.update(petals)
    path = os.path.join(ITEM_DIR, "sakura_katana.png")
    write_png(path, render(cells, KATANA_PALETTE))
    written.append(path)
    if show:
        print("\n=== sakura_katana ===\n" + preview(cells))

    # --- sakura_charm -----------------------------------------------------
    cells = outline(charm_shape())
    path = os.path.join(ITEM_DIR, "sakura_charm.png")
    write_png(path, render(cells, CHARM_PALETTE))
    written.append(path)
    if show:
        print("\n=== sakura_charm ===\n" + preview(cells))

    # --- onigiri ----------------------------------------------------------
    cells = outline(onigiri_shape())
    path = os.path.join(ITEM_DIR, "onigiri.png")
    write_png(path, render(cells, ONIGIRI_PALETTE))
    written.append(path)
    if show:
        print("\n=== onigiri ===\n" + preview(cells))

    # --- particle ---------------------------------------------------------
    path = os.path.join(PARTICLE_DIR, "sakura_petal.png")
    write_png(path, sakura_petal_grid())
    written.append(path)

    # --- pack icons -------------------------------------------------------
    path = os.path.join(RP, "pack_icon.png")
    write_png(path, pack_icon_grid(RP_THEME))
    written.append(path)

    path = os.path.join(BP, "pack_icon.png")
    write_png(path, pack_icon_grid(BP_THEME))
    written.append(path)

    for p in written:
        print("wrote", os.path.relpath(p, REPO_ROOT))


if __name__ == "__main__":
    main()
