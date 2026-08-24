#!/usr/bin/env python3
"""Generate the three 128x128 entity skins for bg:bodyguard_girl ("Aya").

Pure standard library (struct + zlib) - no Pillow anywhere, so the pack can be
rebuilt on any machine that can run python3.

The cube table below is the SINGLE SOURCE OF TRUTH for UV placement and must
stay byte-for-byte in agreement with
resource_packs/bodyguard_rp/models/entity/bodyguard_girl.geo.json.
Every cube uses Bedrock "box UV", whose unwrap for a cube of size (w, h, d)
anchored at (u, v) is:

    up    = (u + d,         v,     w, d)
    down  = (u + d + w,     v,     w, d)
    east  = (u,             v + d, d, h)   <- her right side
    north = (u + d,         v + d, w, h)   <- front / face side (-Z)
    west  = (u + d + w,     v + d, d, h)   <- her left side
    south = (u + d + w + d, v + d, w, h)   <- back (+Z)

Face-edge conventions used by the painters (derived from the classic
Minecraft cross unwrap):
  * on an "up" face the LAST row (fy = d - 1) is the FRONT edge,
  * on an "east" face the LAST column (fx = d - 1) is the FRONT edge,
  * on a "west" face the FIRST column (fx = 0) is the FRONT edge.

Usage:  python3 tools/gen_bodyguard_skin.py [--preview]
"""

import os
import struct
import sys
import zlib

SHEET_W = 128
SHEET_H = 128

OUT_DIR = os.path.join(
    "resource_packs", "bodyguard_rp", "textures", "entity", "bodyguard"
)

TRANSPARENT = (0, 0, 0, 0)


# --------------------------------------------------------------------------
# PNG output  (parameterised on width/height - do NOT hardcode a size here)
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

    with open(path, "wb") as handle:
        handle.write(blob)


def hexa(value):
    value = value.lstrip("#")
    return (
        int(value[0:2], 16),
        int(value[2:4], 16),
        int(value[4:6], 16),
        255,
    )


# --------------------------------------------------------------------------
# Cube table - name -> (uv, size).  Mirrors the geometry file exactly.
# --------------------------------------------------------------------------

CUBES = {
    "head":            ((0, 0),    (8, 8, 8)),
    "hair_back_cap":   ((32, 0),   (9, 10, 6)),
    "body":            ((64, 0),   (8, 12, 4)),
    "twintail_r_tail": ((88, 0),   (4, 10, 4)),
    "twintail_l_tail": ((104, 0),  (4, 10, 4)),
    "rightArm":        ((0, 16),   (3, 12, 3)),
    "leftArm":         ((12, 16),  (3, 12, 3)),
    "rightLeg":        ((24, 16),  (3, 12, 3)),
    "leftLeg":         ((36, 16),  (3, 12, 3)),
    "hair_back_long":  ((48, 16),  (7, 8, 3)),
    "twintail_r_tip":  ((68, 16),  (3, 6, 3)),
    "twintail_l_tip":  ((80, 16),  (3, 6, 3)),
    "twintail_r_tie":  ((92, 16),  (3, 3, 3)),
    "twintail_l_tie":  ((104, 16), (3, 3, 3)),
    "sidelock_r":      ((92, 22),  (1, 7, 3)),
    "sidelock_l":      ((100, 22), (1, 7, 3)),
    "ahoge_stem":      ((108, 22), (1, 5, 1)),
    "ahoge_tip":       ((112, 22), (1, 1, 3)),
    "bangs":           ((68, 25),  (9, 4, 1)),
    "ribbon":          ((112, 26), (4, 3, 1)),
    "collar":          ((0, 32),   (9, 2, 6)),
    "skirt_upper":     ((30, 32),  (9, 3, 6)),
    "skirt_lower":     ((60, 32),  (11, 4, 8)),
    "bangs_top":       ((98, 32),  (9, 1, 3)),
    "katana_tsuka":    ((98, 36),  (2, 2, 6)),
    "katana_tsuba":    ((0, 40),   (4, 4, 1)),
    "katana_blade":    ((0, 46),   (1, 3, 20)),
}


def faces_of(name):
    (u, v), (w, h, d) = CUBES[name]
    return {
        "up":    (u + d,             v,     w, d),
        "down":  (u + d + w,         v,     w, d),
        "east":  (u,                 v + d, d, h),
        "north": (u + d,             v + d, w, h),
        "west":  (u + d + w,         v + d, d, h),
        "south": (u + d + w + d,     v + d, w, h),
    }


def footprint(name):
    """Bounding rect (x0, y0, x1, y1) of the whole box unwrap."""
    (u, v), (w, h, d) = CUBES[name]
    return (u, v, u + 2 * w + 2 * d, v + h + d)


# --------------------------------------------------------------------------
# Canvas primitives.  All coordinates inside a face are LOCAL (fx, fy).
# --------------------------------------------------------------------------

def new_canvas():
    return [[TRANSPARENT for _ in range(SHEET_W)] for _ in range(SHEET_H)]


def put(cv, rect, fx, fy, col):
    x, y, w, h = rect
    if 0 <= fx < w and 0 <= fy < h:
        cv[y + fy][x + fx] = col


def fill(cv, rect, col):
    _, _, w, h = rect
    for fy in range(h):
        for fx in range(w):
            put(cv, rect, fx, fy, col)


def hrow(cv, rect, fy, col, fx0=0, fx1=None):
    _, _, w, _ = rect
    fx1 = w if fx1 is None else fx1
    for fx in range(fx0, fx1):
        put(cv, rect, fx, fy, col)


def vcol(cv, rect, fx, col, fy0=0, fy1=None):
    _, _, _, h = rect
    fy1 = h if fy1 is None else fy1
    for fy in range(fy0, fy1):
        put(cv, rect, fx, fy, col)


def rows(cv, rect, fy0, fy1, col):
    """Inclusive row band."""
    for fy in range(fy0, fy1 + 1):
        hrow(cv, rect, fy, col)


def cel(cv, rect, base, light, dark, light_rows=1, dark_rows=1, dark_cols=()):
    """Generic three-tone cel shade: lit top edge, mid body, dark bottom/side."""
    _, _, w, h = rect
    fill(cv, rect, base)
    for fy in range(min(light_rows, h)):
        hrow(cv, rect, fy, light)
    for fy in range(max(0, h - dark_rows), h):
        hrow(cv, rect, fy, dark)
    for fx in dark_cols:
        vcol(cv, rect, fx % w, dark)


def hair_side(cv, rect, P, shine_fx=None, light_rows=3, dark_rows=2,
              dark_cols=(), strand_cols=()):
    """Standard hair panel: light crown band, mid mass, dark hem, 1px specular."""
    _, _, w, h = rect
    fill(cv, rect, P["hair_mid"])
    for fy in range(min(light_rows, h)):
        hrow(cv, rect, fy, P["hair_light"])
    for fx in strand_cols:
        vcol(cv, rect, fx, P["hair_dark"], min(light_rows, h - 1), h)
    for fy in range(max(0, h - dark_rows), h):
        hrow(cv, rect, fy, P["hair_dark"])
    for fx in dark_cols:
        vcol(cv, rect, fx % w, P["hair_dark"])
    if shine_fx is not None:
        vcol(cv, rect, shine_fx % w, P["hair_light"], 0, max(1, h - dark_rows))


# --------------------------------------------------------------------------
# The face - the most important 8x8 texels on the sheet.
# Local (fx, fy), fx grows to the VIEWER's right, fy grows downward.
# --------------------------------------------------------------------------

FACE_GRID = [
    ["hair_dark",   "hair_dark",     "hair_mid",     "hair_mid",   "hair_mid",   "hair_mid",     "hair_dark",     "hair_dark"],
    ["hair_dark",   "hair_mid",      "hair_light",   "hair_mid",   "hair_mid",   "hair_light",   "hair_mid",      "hair_dark"],
    ["hair_dark",   "hair_dark",     "hair_mid",     "hair_dark",  "hair_dark",  "hair_mid",     "hair_dark",     "hair_dark"],
    ["skin_shadow", "eye_lash",      "eye_lash",     "skin_light", "skin_light", "eye_lash",     "eye_lash",      "skin_shadow"],
    ["blush_soft",  "eye_highlight", "eye_iris_mid", "skin_light", "skin_light", "eye_iris_mid", "eye_highlight", "blush_soft"],
    ["blush",       "eye_iris_dark", "eye_iris_dark", "skin_mid",  "skin_mid",   "eye_iris_dark", "eye_iris_dark", "blush"],
    ["skin_shadow", "skin_mid",      "skin_mid",     "mouth",      "mouth",      "skin_mid",     "skin_mid",      "skin_shadow"],
    ["skin_shadow", "skin_shadow",   "skin_shadow",  "skin_shadow", "skin_shadow", "skin_shadow", "skin_shadow",  "skin_shadow"],
]


def paint_head(cv, P):
    f = faces_of("head")

    # Top of the skull - hidden under bangs_top and the hair cap, but painted
    # as hair so nothing can flash skin through a seam.
    fill(cv, f["up"], P["hair_mid"])
    fill(cv, f["down"], P["skin_shadow"])       # under-chin
    fill(cv, f["south"], P["hair_dark"])        # 100% covered by the cap

    # Her right cheek: the three columns nearest the front seam are skin.
    fill(cv, f["east"], P["hair_dark"])
    for fx in (5, 6, 7):
        vcol(cv, f["east"], fx, P["skin_mid"], 3, 7)
        put(cv, f["east"], fx, 7, P["skin_shadow"])
        put(cv, f["east"], fx, 2, P["hair_dark"])
    # Her left cheek mirrors it (front seam is on the other side of the cell).
    fill(cv, f["west"], P["hair_dark"])
    for fx in (0, 1, 2):
        vcol(cv, f["west"], fx, P["skin_mid"], 3, 7)
        put(cv, f["west"], fx, 7, P["skin_shadow"])
        put(cv, f["west"], fx, 2, P["hair_dark"])

    # THE FACE.
    for fy, line in enumerate(FACE_GRID):
        for fx, key in enumerate(line):
            put(cv, f["north"], fx, fy, P[key])


# --------------------------------------------------------------------------
# Hair
# --------------------------------------------------------------------------

def paint_hair_back(cv, P):
    f = faces_of("hair_back_cap")

    # up face: front rows (fy = d-1 side) catch the light.
    fill(cv, f["up"], P["hair_mid"])
    for fy in (3, 4, 5):
        hrow(cv, f["up"], fy, P["hair_light"])
    fill(cv, f["down"], P["hair_dark"])

    # north face is buried inside the head; only the outer texel column each
    # side pokes out as side hair in front of the ears.
    fill(cv, f["north"], P["hair_dark"])
    vcol(cv, f["north"], 0, P["hair_mid"])
    vcol(cv, f["north"], 8, P["hair_mid"])

    hair_side(cv, f["east"], P, shine_fx=1, dark_cols=(0,))
    hair_side(cv, f["west"], P, shine_fx=4, dark_cols=(5,))

    # The big readable back-of-head panel.
    hair_side(cv, f["south"], P, light_rows=3, dark_rows=2,
              dark_cols=(0, 8), strand_cols=(2, 6))
    vcol(cv, f["south"], 4, P["hair_light"], 0, 4)   # crown parting shine

    # Nape fall.
    g = faces_of("hair_back_long")
    fill(cv, g["up"], P["hair_mid"])
    fill(cv, g["down"], P["hair_dark"])
    fill(cv, g["north"], P["hair_dark"])
    hair_side(cv, g["east"], P, light_rows=2, dark_rows=3, dark_cols=(0,))
    hair_side(cv, g["west"], P, light_rows=2, dark_rows=3, dark_cols=(2,))
    hair_side(cv, g["south"], P, light_rows=2, dark_rows=3, dark_cols=(0, 6))
    # Ragged, pointed hem instead of a flat brick.
    for fx in (0, 3, 6):
        vcol(cv, g["south"], fx, P["hair_dark"], 4, 8)
    put(cv, g["south"], 3, 7, P["outline"])


def paint_twintail(cv, P, side):
    tail = faces_of("twintail_%s_tail" % side)
    tip = faces_of("twintail_%s_tip" % side)
    tie = faces_of("twintail_%s_tie" % side)

    # --- tail (4x10x4) -----------------------------------------------------
    fill(cv, tail["up"], P["hair_light"])     # tucks under the tie
    fill(cv, tail["down"], P["hair_dark"])    # hidden by the tip cube
    shine_face = "east" if side == "r" else "west"
    for key in ("east", "north", "west", "south"):
        hair_side(cv, tail[key], P, light_rows=3, dark_rows=2,
                  shine_fx=(1 if key == shine_face else None))

    # --- tip (3x6x3) -------------------------------------------------------
    fill(cv, tip["up"], P["hair_mid"])
    fill(cv, tip["down"], P["hair_dark"])
    for key in ("east", "north", "west", "south"):
        rect = tip[key]
        fill(cv, rect, P["hair_mid"])
        rows(cv, rect, 3, 4, P["hair_dark"])
        # 1px notched spike so the tail ends in a point.
        put(cv, rect, 0, 5, P["outline"])
        put(cv, rect, 1, 5, P["hair_dark"])
        put(cv, rect, 2, 5, P["outline"])

    # --- tie (3x3x3) - a tiny cube carrying a big colour accent ------------
    for key in ("up", "down"):
        fill(cv, tie[key], P["ribbon"])
    for key in ("east", "north", "west", "south"):
        rect = tie[key]
        fill(cv, rect, P["ribbon"])
        hrow(cv, rect, 0, P["uniform_trim"])
        hrow(cv, rect, 2, P["outline"])


def paint_hair_front(cv, P):
    # --- bangs (9x4x1): the hero fringe ------------------------------------
    f = faces_of("bangs")
    fill(cv, f["up"], P["hair_mid"])
    fill(cv, f["down"], P["hair_dark"])       # shade cast onto the forehead
    fill(cv, f["east"], P["hair_dark"])
    fill(cv, f["west"], P["hair_dark"])
    fill(cv, f["south"], P["hair_dark"])      # faces the head

    n = f["north"]
    fill(cv, n, P["hair_mid"])
    hrow(cv, n, 0, P["hair_light"])
    hrow(cv, n, 1, P["hair_light"])
    hrow(cv, n, 3, P["hair_dark"])
    for fx in (2, 4, 5, 7):                   # saw-tooth of pointed locks
        put(cv, n, fx, 2, P["hair_dark"])
        put(cv, n, fx, 3, P["outline"])

    # --- bangs_top (9x1x3): thin scalp plate -------------------------------
    g = faces_of("bangs_top")
    for key in ("down", "east", "north", "west", "south"):
        fill(cv, g[key], P["hair_dark"])
    fill(cv, g["up"], P["hair_mid"])
    vcol(cv, g["up"], 4, P["hair_light"])     # centre parting
    vcol(cv, g["up"], 0, P["hair_dark"])
    vcol(cv, g["up"], 8, P["hair_dark"])

    # --- sidelocks (1x7x3): face-framing locks -----------------------------
    for side, outward, inward in (("r", "east", "west"), ("l", "west", "east")):
        s = faces_of("sidelock_%s" % side)
        fill(cv, s["up"], P["hair_mid"])
        fill(cv, s["down"], P["hair_dark"])
        fill(cv, s[inward], P["hair_dark"])   # pressed against the head
        fill(cv, s["south"], P["hair_dark"])

        out = s[outward]
        fill(cv, out, P["hair_mid"])
        vcol(cv, out, 1, P["hair_light"])     # the single specular line
        rows(cv, out, 5, 6, P["hair_dark"])
        put(cv, out, 0, 6, P["outline"])
        put(cv, out, 2, 6, P["outline"])

        nf = s["north"]                       # 1 texel wide, seen head-on
        fill(cv, nf, P["hair_mid"])
        rows(cv, nf, 5, 6, P["hair_dark"])

    # --- ahoge (the signature silhouette element) --------------------------
    a = faces_of("ahoge_stem")
    fill(cv, a["up"], P["hair_light"])
    fill(cv, a["down"], P["hair_mid"])
    for key in ("east", "north", "west", "south"):
        rect = a[key]
        fill(cv, rect, P["hair_mid"])
        rows(cv, rect, 3, 4, P["hair_light"])

    t = faces_of("ahoge_tip")
    for key in ("up", "east", "north", "west", "south"):
        fill(cv, t[key], P["hair_light"])
    fill(cv, t["down"], P["hair_mid"])


# --------------------------------------------------------------------------
# Uniform
# --------------------------------------------------------------------------

def paint_body(cv, P):
    f = faces_of("body")

    fill(cv, f["up"], P["skin_mid"])              # neck hole
    for fx in range(8):
        put(cv, f["up"], fx, 0, P["uniform_primary"])
        put(cv, f["up"], fx, 3, P["uniform_primary"])
    for fy in range(4):
        put(cv, f["up"], 0, fy, P["uniform_primary"])
        put(cv, f["up"], 7, fy, P["uniform_primary"])
    fill(cv, f["down"], P["skirt_shadow"])        # hidden inside the skirt

    for key, edge in (("east", 0), ("west", 3), ("north", None), ("south", None)):
        rect = f[key]
        _, _, w, _ = rect
        fill(cv, rect, P["uniform_primary"])
        hrow(cv, rect, 0, P["uniform_trim"])      # lit shoulder line
        rows(cv, rect, 9, 11, P["skirt"])         # blouse tucked into the skirt
        hrow(cv, rect, 11, P["skirt_shadow"])
        if edge is not None:
            vcol(cv, rect, edge % w, P["outline"], 0, 9)

    vcol(cv, f["north"], 4, P["uniform_secondary"], 0, 9)   # centre-front seam
    hrow(cv, f["south"], 8, P["uniform_secondary"])


def paint_arm(cv, P, name, lit_face, dark_face, dark_fx):
    f = faces_of(name)
    fill(cv, f["up"], P["uniform_primary"])
    fill(cv, f["down"], P["skin_shadow"])

    for key in ("east", "north", "west", "south"):
        rect = f[key]
        fill(cv, rect, P["uniform_primary"])
        hrow(cv, rect, 0, P["uniform_trim"])      # lit top of the puff sleeve
        rows(cv, rect, 1, 4, P["uniform_primary"])
        hrow(cv, rect, 5, P["uniform_secondary"])  # cuff band
        rows(cv, rect, 6, 9, P["skin_mid"])        # forearm
        rows(cv, rect, 10, 11, P["skin_shadow"])   # fist gripping the tsuka

    rows(cv, f[lit_face], 6, 9, P["skin_light"])
    _, _, w, _ = f[dark_face]
    vcol(cv, f[dark_face], dark_fx % w, P["outline"])


def paint_leg(cv, P, name, lit_face, dark_face, dark_fx):
    f = faces_of(name)
    fill(cv, f["up"], P["skin_shadow"])           # hidden under the skirt
    fill(cv, f["down"], P["outline"])             # sole

    # The skirt (skirt_upper y10-13, skirt_lower y6-10) fully encloses the legs
    # in x and z, so ONLY leg rows 6-11 (y 6 down to y 0) are ever on screen.
    # The whole thigh/stocking/shoe banding therefore lives inside that window;
    # rows 0-5 are sealed under the skirt and are painted flat skin.
    for key in ("east", "north", "west", "south"):
        rect = f[key]
        rows(cv, rect, 0, 6, P["skin_mid"])        # bare thigh (row 6 = visible)
        hrow(cv, rect, 7, P["thigh_high_band"])    # contrast welt, just below hem
        rows(cv, rect, 8, 9, P["thigh_high"])      # stocking
        rows(cv, rect, 10, 11, P["outline"])       # school shoe

    hrow(cv, f[lit_face], 8, P["uniform_trim"])   # stocking sheen
    _, _, w, _ = f[dark_face]
    vcol(cv, f[dark_face], dark_fx % w, P["skirt_shadow"], 6, 10)


def paint_chest_decor(cv, P):
    # --- sailor collar (9x2x6) ---------------------------------------------
    f = faces_of("collar")
    up = f["up"]
    fill(cv, up, P["uniform_secondary"])
    for inset in (1, 2):                          # the classic double stripe
        for fx in range(inset, 9 - inset):
            put(cv, up, fx, inset, P["uniform_trim"])
            put(cv, up, fx, 5 - inset, P["uniform_trim"])
        for fy in range(inset, 6 - inset):
            put(cv, up, inset, fy, P["uniform_trim"])
            put(cv, up, 8 - inset, fy, P["uniform_trim"])
    for fx in (3, 4, 5):                          # V neckline, front edge
        put(cv, up, fx, 5, P["uniform_primary"])
    put(cv, up, 4, 4, P["uniform_primary"])

    fill(cv, f["down"], P["uniform_secondary"])
    for key in ("east", "north", "west", "south"):
        rect = f[key]
        fill(cv, rect, P["uniform_secondary"])
        hrow(cv, rect, 1, P["uniform_trim"])
    hrow(cv, f["south"], 0, P["uniform_trim"])

    # --- neckerchief knot (4x3x1) ------------------------------------------
    g = faces_of("ribbon")
    for key in ("up", "down", "east", "west", "south"):
        fill(cv, g[key], P["ribbon"])
    for key in ("east", "west"):
        hrow(cv, g[key], 0, P["uniform_trim"])
        hrow(cv, g[key], 2, P["outline"])
    n = g["north"]
    fill(cv, n, P["ribbon"])
    put(cv, n, 1, 0, P["uniform_trim"])
    put(cv, n, 3, 0, P["uniform_trim"])
    hrow(cv, n, 2, P["outline"])
    vcol(cv, n, 2, P["outline"])                  # the tie split


def paint_skirt(cv, P):
    # --- hip block ---------------------------------------------------------
    f = faces_of("skirt_upper")
    fill(cv, f["up"], P["skirt_pleat_light"])     # waistband from above
    fill(cv, f["down"], P["skirt_shadow"])
    for key in ("east", "north", "west", "south"):
        rect = f[key]
        _, _, w, _ = rect
        fill(cv, rect, P["skirt"])
        hrow(cv, rect, 0, P["skirt_pleat_light"])  # waistband highlight
        for fx in range(1, w, 2):
            vcol(cv, rect, fx, P["skirt_shadow"], 1, 3)

    # --- flared pleated panel ---------------------------------------------
    g = faces_of("skirt_lower")
    fill(cv, g["up"], P["skirt_shadow"])
    fill(cv, g["down"], P["skirt_shadow"])
    for key in ("east", "north", "west", "south"):
        rect = g[key]
        _, _, w, h = rect
        for fx in range(w):
            if fx % 3 == 0:
                col = P["skirt_shadow"]           # pleat boundary
            elif (fx // 3) % 2 == 0:
                col = P["skirt"]
            else:
                col = P["skirt_pleat_light"]
            vcol(cv, rect, fx, col)
        hrow(cv, rect, h - 1, P["outline"])       # hard dark hem


# --------------------------------------------------------------------------
# Katana (part of the mob geometry, so it lives on this same sheet)
# --------------------------------------------------------------------------

def paint_katana(cv, P):
    # --- tsuka / grip (2x2x6): faked ito wrap diamonds ---------------------
    f = faces_of("katana_tsuka")
    for key in ("east", "west"):
        rect = f[key]
        _, _, w, h = rect
        for fy in range(h):
            for fx in range(w):
                dark = ((fx + 2 * fy) % 3) == 0
                put(cv, rect, fx, fy,
                    P["grip_wrap_dark"] if dark else P["grip_wrap"])
    for key in ("up", "down"):
        rect = f[key]
        _, _, w, h = rect
        for fy in range(h):
            for fx in range(w):
                dark = ((fy + 2 * fx) % 3) == 0
                put(cv, rect, fx, fy,
                    P["grip_wrap_dark"] if dark else P["grip_wrap"])
    fill(cv, f["south"], P["tsuba_metal"])        # pommel cap
    fill(cv, f["north"], P["grip_wrap_dark"])     # butts into the tsuba

    # --- tsuba / guard (4x4x1): square cube read as a disc ----------------
    g = faces_of("katana_tsuba")
    for key in ("up", "down", "east", "west"):
        rect = g[key]
        _, _, _, h = rect
        fill(cv, rect, P["tsuba_metal"])
        hrow(cv, rect, h - 1, P["outline"])
    for key in ("north", "south"):
        rect = g[key]
        fill(cv, rect, P["tsuba_metal"])
        for fx, fy in ((0, 0), (3, 0), (0, 3), (3, 3)):
            put(cv, rect, fx, fy, TRANSPARENT)    # knock the corners off
        for fx, fy in ((1, 0), (2, 0), (0, 1), (3, 1),
                       (0, 2), (3, 2), (1, 3), (2, 3)):
            put(cv, rect, fx, fy, P["outline"])
        put(cv, rect, 1, 1, P["uniform_trim"])    # glint

    # --- blade (1x3x20) ----------------------------------------------------
    b = faces_of("katana_blade")
    fill(cv, b["up"], P["blade_steel_light"])     # 1px spine
    fill(cv, b["down"], P["blade_steel_light"])   # 1px sharpened edge
    fill(cv, b["north"], P["blade_steel_light"])  # the kissaki tip
    fill(cv, b["south"], P["blade_steel_dark"])   # hidden inside the tsuba

    for key, tip_at_end in (("east", True), ("west", False)):
        rect = b[key]
        _, _, w, _ = rect
        hrow(cv, rect, 0, P["blade_steel_light"])   # shinogi ridge
        hrow(cv, rect, 1, P["blade_steel_mid"])
        hrow(cv, rect, 2, P["blade_steel_dark"])    # cutting-edge shadow
        # Taper the last three texels of length into the point.
        tip = [w - 1, w - 2, w - 3] if tip_at_end else [0, 1, 2]
        put(cv, rect, tip[0], 1, P["blade_steel_light"])
        put(cv, rect, tip[0], 2, TRANSPARENT)
        put(cv, rect, tip[1], 1, P["blade_steel_mid"])
        put(cv, rect, tip[1], 2, P["outline"])
        put(cv, rect, tip[2], 2, P["blade_steel_dark"])


# --------------------------------------------------------------------------
# Palettes - three variants, identical key sets.
# --------------------------------------------------------------------------

PALETTES = {
    "sakura": {
        "hair_light": "#FFDCEC", "hair_mid": "#F79AC0", "hair_dark": "#BF5B89",
        "hair_shine": "#FFFFFF",
        "skin_light": "#FFF2E6", "skin_mid": "#FFD9C2", "skin_shadow": "#DFA184",
        "uniform_primary": "#FAF4F7", "uniform_secondary": "#F2799F",
        "uniform_trim": "#FFFFFF",
        "skirt": "#D4436E", "skirt_shadow": "#9E2C4F",
        "skirt_pleat_light": "#F2799F",
        "thigh_high": "#F7EFF3", "thigh_high_band": "#F2799F",
        "eye_highlight": "#FFFFFF", "eye_iris_light": "#FF8FA8",
        "eye_iris_mid": "#E8547A", "eye_iris_dark": "#96234A",
        "eye_lash": "#33192A",
        "blush": "#FF9BB0", "blush_soft": "#FFC4D2", "mouth": "#B03A5C",
        "blade_steel_light": "#F0F7FC", "blade_steel_mid": "#B9C9D6",
        "blade_steel_dark": "#6E8397",
        "grip_wrap": "#C0395E", "grip_wrap_dark": "#7A1F3B",
        "tsuba_metal": "#E0B65C", "ribbon": "#E2314F", "outline": "#3A2130",
    },
    "midnight": {
        "hair_light": "#8367B8", "hair_mid": "#4A3570", "hair_dark": "#21193A",
        "hair_shine": "#B79BE0",
        "skin_light": "#FFF1E4", "skin_mid": "#F0D2BE", "skin_shadow": "#C29984",
        "uniform_primary": "#2C3566", "uniform_secondary": "#46529B",
        "uniform_trim": "#F0C46B",
        "skirt": "#1C2145", "skirt_shadow": "#10132B",
        "skirt_pleat_light": "#46529B",
        "thigh_high": "#2A2140", "thigh_high_band": "#9B7FD4",
        "eye_highlight": "#FFFFFF", "eye_iris_light": "#FFE29B",
        "eye_iris_mid": "#F2C05E", "eye_iris_dark": "#A6752A",
        "eye_lash": "#120E20",
        "blush": "#E58FA5", "blush_soft": "#F0B8C6", "mouth": "#9E3E56",
        "blade_steel_light": "#E8F0F8", "blade_steel_mid": "#A9BACB",
        "blade_steel_dark": "#566A80",
        "grip_wrap": "#4B3D8F", "grip_wrap_dark": "#271F55",
        "tsuba_metal": "#C9A24A", "ribbon": "#E5B94F", "outline": "#14101F",
    },
    "frost": {
        "hair_light": "#F4FBFF", "hair_mid": "#BDDCF0", "hair_dark": "#7BA3C4",
        "hair_shine": "#FFFFFF",
        "skin_light": "#FFF7F0", "skin_mid": "#FBDFCC", "skin_shadow": "#D6A891",
        "uniform_primary": "#E4F1FA", "uniform_secondary": "#5AA6D6",
        "uniform_trim": "#FFFFFF",
        "skirt": "#3A7CB4", "skirt_shadow": "#245880",
        "skirt_pleat_light": "#6FB6E0",
        "thigh_high": "#EDF6FC", "thigh_high_band": "#5AA6D6",
        "eye_highlight": "#FFFFFF", "eye_iris_light": "#9EEAF7",
        "eye_iris_mid": "#46C6E0", "eye_iris_dark": "#1B7392",
        "eye_lash": "#1B2E3D",
        "blush": "#F09BAE", "blush_soft": "#FAC6D2", "mouth": "#A8465E",
        "blade_steel_light": "#F6FBFF", "blade_steel_mid": "#C2D6E4",
        "blade_steel_dark": "#6C8598",
        "grip_wrap": "#3E7FA8", "grip_wrap_dark": "#204E6E",
        "tsuba_metal": "#CFE0EA", "ribbon": "#6FD0E8", "outline": "#1B2C3C",
    },
}


def resolve(palette):
    return {key: hexa(value) for key, value in palette.items()}


# --------------------------------------------------------------------------
# Sheet assembly
# --------------------------------------------------------------------------

def paint_sheet(palette):
    P = resolve(palette)
    cv = new_canvas()

    paint_head(cv, P)
    paint_hair_back(cv, P)
    paint_hair_front(cv, P)
    paint_twintail(cv, P, "r")
    paint_twintail(cv, P, "l")
    paint_body(cv, P)
    paint_chest_decor(cv, P)
    paint_skirt(cv, P)
    # Right arm lit on the front, silhouette darkened on her right edge;
    # left arm lit on the front too so both arms take light from one direction.
    paint_arm(cv, P, "rightArm", "north", "east", 0)
    paint_arm(cv, P, "leftArm", "north", "west", 2)
    paint_leg(cv, P, "rightLeg", "north", "east", 0)
    paint_leg(cv, P, "leftLeg", "north", "west", 2)
    paint_katana(cv, P)

    return cv


# --------------------------------------------------------------------------
# Self-checks
# --------------------------------------------------------------------------

def check_uv_layout():
    """Every unwrap must fit the sheet and must not overlap another cube."""
    problems = []
    rects = {name: footprint(name) for name in CUBES}
    for name, (x0, y0, x1, y1) in rects.items():
        if x1 > SHEET_W or y1 > SHEET_H:
            problems.append("%s overruns the sheet: %s" % (name, (x0, y0, x1, y1)))
    names = sorted(rects)
    for i, a in enumerate(names):
        ax0, ay0, ax1, ay1 = rects[a]
        for b in names[i + 1:]:
            bx0, by0, bx1, by1 = rects[b]
            if ax0 < bx1 and bx0 < ax1 and ay0 < by1 and by0 < ay1:
                problems.append("UV overlap: %s %s vs %s %s"
                                % (a, rects[a], b, rects[b]))
    return problems


def check_face(cv, P):
    """Assertions from the art direction on the 8x8 north face of the head."""
    rect = faces_of("head")["north"]
    x, y, _, _ = rect
    px = [[cv[y + fy][x + fx] for fx in range(8)] for fy in range(8)]
    assert all(p[3] == 255 for row in px for p in row), "face has holes"
    assert sum(1 for row in px for p in row if p == P["eye_highlight"]) == 2
    assert sum(1 for row in px for p in row if p == P["mouth"]) == 2
    lum = lambda c: 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]

    # Readability invariants for the eye.  Note these are deliberately NOT a
    # single global luminance chain: the midnight variant's gold iris is
    # BRIGHTER than its own skin_shadow by design, and forcing it under would
    # turn the gold to mud.  What actually has to hold is that the lash is the
    # darkest thing on the face and that the iris keeps a wide separation from
    # both its own highlight row and the surrounding skin, so the eye survives
    # Minecraft's ambient darkening at night.
    assert lum(P["eye_lash"]) < min(
        lum(P[k]) for k in ("eye_iris_dark", "eye_iris_mid", "skin_shadow",
                            "skin_mid", "skin_light", "eye_highlight")
    ), "eye_lash must be the darkest colour on the face"
    assert lum(P["eye_iris_mid"]) - lum(P["eye_iris_dark"]) >= 40, \
        "iris needs a wide light/dark spread or it flattens at range"
    assert lum(P["skin_mid"]) - lum(P["eye_iris_dark"]) >= 40, \
        "iris must stay well clear of the skin it sits against"
    assert lum(P["eye_highlight"]) > lum(P["eye_iris_mid"]), \
        "the catchlight must be the brightest texel of the eye"
    for dim, bright in (("skin_shadow", "skin_mid"), ("skin_mid", "skin_light")):
        assert lum(P[dim]) < lum(P[bright]), "skin ramp inverted"


def coverage(cv):
    return sum(1 for row in cv for px in row if px[3] != 0)


def preview(cv):
    ramp = " .:-=+*#%@"
    lines = []
    for fy in range(0, SHEET_H, 2):
        out = []
        for fx in range(0, SHEET_W, 1):
            px = cv[fy][fx]
            if px[3] == 0:
                out.append(" ")
            else:
                lumv = (0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2]) / 255.0
                out.append(ramp[min(9, int(lumv * 9) + 1)])
        lines.append("".join(out).rstrip())
    return "\n".join(lines)


def main():
    problems = check_uv_layout()
    if problems:
        for line in problems:
            print("ERROR: " + line)
        return 1

    os.makedirs(OUT_DIR, exist_ok=True)
    show = "--preview" in sys.argv

    for variant, palette in PALETTES.items():
        cv = paint_sheet(palette)
        check_face(cv, resolve(palette))
        path = os.path.join(OUT_DIR, "%s.png" % variant)
        write_png(path, cv)
        print("%-9s -> %s  (%d/%d opaque texels, %.1f%% of the sheet)" % (
            variant, path, coverage(cv), SHEET_W * SHEET_H,
            100.0 * coverage(cv) / (SHEET_W * SHEET_H)))
        if show and variant == "sakura":
            print(preview(cv))

    print("%d cubes across %d bones, UV layout verified clash-free."
          % (len(CUBES), 16))
    return 0


if __name__ == "__main__":
    sys.exit(main())
