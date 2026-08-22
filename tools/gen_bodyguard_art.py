#!/usr/bin/env python3
"""Draw every Bodyguard texture from scratch.

Standard library only, so the pack can be rebuilt on any machine with no image
tooling.  Produces:

  resource_packs/bodyguard_rp/textures/entity/bodyguard/bodyguard_t0..t4.png
  resource_packs/bodyguard_rp/textures/items/bodyguard_contract.png
  resource_packs/bodyguard_rp/textures/items/bodyguard_spawn_egg.png
  resource_packs/bodyguard_rp/pack_icon.png
  behavior_packs/bodyguard_bp/pack_icon.png

Usage:  python3 tools/gen_bodyguard_art.py [--preview]
"""

import os
import struct
import sys
import zlib

RP = os.path.join("resource_packs", "bodyguard_rp")
BP = os.path.join("behavior_packs", "bodyguard_bp")
CLEAR = (0, 0, 0, 0)


# --------------------------------------------------------------------------
# PNG
# --------------------------------------------------------------------------
class Image:
    def __init__(self, width, height, fill=CLEAR):
        self.w = width
        self.h = height
        self.px = [[fill for _ in range(width)] for _ in range(height)]

    def set(self, x, y, color):
        if color is None:
            return
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[y][x] = color

    def get(self, x, y):
        if 0 <= x < self.w and 0 <= y < self.h:
            return self.px[y][x]
        return CLEAR

    def rect(self, x, y, w, h, color):
        for row in range(y, y + h):
            for col in range(x, x + w):
                self.set(col, row, color)

    def outline_rect(self, x, y, w, h, color):
        for col in range(x, x + w):
            self.set(col, y, color)
            self.set(col, y + h - 1, color)
        for row in range(y, y + h):
            self.set(x, row, color)
            self.set(x + w - 1, row, color)

    def shade(self, x, y, w, h, top, bottom):
        """Vertical gradient between two colours."""
        for i in range(h):
            t = i / max(1, h - 1)
            color = tuple(
                int(round(top[c] + (bottom[c] - top[c]) * t)) for c in range(4)
            )
            for col in range(x, x + w):
                self.set(col, y + i, color)

    def save(self, path):
        raw = b"".join(
            b"\x00" + bytes(channel for pixel in row for channel in pixel)
            for row in self.px
        )

        def chunk(tag, data):
            return (
                struct.pack(">I", len(data))
                + tag
                + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
            )

        blob = b"\x89PNG\r\n\x1a\n"
        blob += chunk(b"IHDR", struct.pack(">IIBBBBB", self.w, self.h, 8, 6, 0, 0, 0))
        blob += chunk(b"IDAT", zlib.compress(raw, 9))
        blob += chunk(b"IEND", b"")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as handle:
            handle.write(blob)


def mix(a, b, t):
    return tuple(int(round(a[c] + (b[c] - a[c]) * t)) for c in range(4))


def darken(color, amount):
    return (
        max(0, int(color[0] * (1 - amount))),
        max(0, int(color[1] * (1 - amount))),
        max(0, int(color[2] * (1 - amount))),
        color[3],
    )


def lighten(color, amount):
    return (
        min(255, int(color[0] + (255 - color[0]) * amount)),
        min(255, int(color[1] + (255 - color[1]) * amount)),
        min(255, int(color[2] + (255 - color[2]) * amount)),
        color[3],
    )


# --------------------------------------------------------------------------
# Cube UV unwrap helper - mirrors how Bedrock maps a box at (u, v).
# --------------------------------------------------------------------------
class Box:
    def __init__(self, u, v, w, h, d):
        self.u, self.v, self.w, self.h, self.d = u, v, w, h, d

    @property
    def top(self):
        return (self.u + self.d, self.v, self.w, self.d)

    @property
    def bottom(self):
        return (self.u + self.d + self.w, self.v, self.w, self.d)

    @property
    def right(self):
        return (self.u, self.v + self.d, self.d, self.h)

    @property
    def front(self):
        return (self.u + self.d, self.v + self.d, self.w, self.h)

    @property
    def left(self):
        return (self.u + self.d + self.w, self.v + self.d, self.d, self.h)

    @property
    def back(self):
        return (self.u + 2 * self.d + self.w, self.v + self.d, self.w, self.h)

    def faces(self):
        return [self.top, self.bottom, self.right, self.front, self.left, self.back]


HEAD = Box(0, 0, 8, 8, 8)
HAT = Box(32, 0, 8, 8, 8)
BODY = Box(16, 16, 8, 12, 4)
ARM = Box(40, 16, 4, 12, 4)
LEG = Box(0, 16, 4, 12, 4)
PAULDRON = Box(0, 40, 5, 3, 5)
VISOR = Box(0, 52, 8, 2, 1)
EARPIECE = Box(20, 52, 1, 2, 2)
INSIGNIA = Box(24, 56, 4, 4, 1)


# --------------------------------------------------------------------------
# Tier palettes
# --------------------------------------------------------------------------
SKIN = (214, 168, 134, 255)
SKIN_DARK = (176, 132, 102, 255)
HAIR = (38, 32, 30, 255)
SHIRT = (232, 234, 238, 255)

TIERS = [
    {
        "key": "t0",
        "name": "Recruit",
        "suit": (52, 56, 66, 255),
        "trim": (96, 102, 116, 255),
        "accent": (152, 158, 170, 255),
        "plate": (90, 96, 108, 255),
        "tie": (128, 132, 142, 255),
        "glass": (24, 26, 32, 255),
    },
    {
        "key": "t1",
        "name": "Leather",
        "suit": (48, 42, 40, 255),
        "trim": (122, 78, 44, 255),
        "accent": (168, 112, 62, 255),
        "plate": (140, 92, 50, 255),
        "tie": (96, 60, 34, 255),
        "glass": (36, 24, 16, 255),
    },
    {
        "key": "t2",
        "name": "Iron",
        "suit": (44, 48, 56, 255),
        "trim": (156, 162, 172, 255),
        "accent": (206, 212, 222, 255),
        "plate": (178, 184, 194, 255),
        "tie": (120, 126, 136, 255),
        "glass": (28, 32, 40, 255),
    },
    {
        "key": "t3",
        "name": "Diamond",
        "suit": (30, 44, 54, 255),
        "trim": (84, 200, 206, 255),
        "accent": (150, 236, 238, 255),
        "plate": (104, 214, 218, 255),
        "tie": (58, 158, 168, 255),
        "glass": (18, 44, 52, 255),
    },
    {
        "key": "t4",
        "name": "Netherite",
        "suit": (24, 22, 26, 255),
        "trim": (78, 68, 74, 255),
        "accent": (214, 176, 84, 255),
        "plate": (58, 50, 56, 255),
        "tie": (140, 112, 54, 255),
        "glass": (16, 14, 18, 255),
    },
]


def draw_head(img, tier):
    hair_hi = lighten(HAIR, 0.12)
    # Every face starts as skin, then hair is layered on the top and sides.
    for face in (HEAD.right, HEAD.front, HEAD.left):
        x, y, w, h = face
        img.shade(x, y, w, h, SKIN, SKIN_DARK)
    x, y, w, h = HEAD.back
    img.rect(x, y, w, h, HAIR)
    x, y, w, h = HEAD.top
    img.rect(x, y, w, h, HAIR)
    for col in range(w):
        img.set(x + col, y, hair_hi)
    x, y, w, h = HEAD.bottom
    img.rect(x, y, w, h, darken(SKIN_DARK, 0.25))

    # Hairline: two rows across the front, three down the sides and back.
    fx, fy, fw, _fh = HEAD.front
    img.rect(fx, fy, fw, 2, HAIR)
    for col in range(fw):
        img.set(fx + col, fy + 1, hair_hi if col % 3 else HAIR)
    for face in (HEAD.right, HEAD.left):
        sx, sy, sw, _sh = face
        img.rect(sx, sy, sw, 3, HAIR)

    # Eyes - still readable if the player equips a helmet that hides the visor.
    eye_white = (238, 240, 244, 255)
    img.rect(fx + 1, fy + 3, 2, 1, eye_white)
    img.rect(fx + 5, fy + 3, 2, 1, eye_white)
    img.set(fx + 2, fy + 3, (46, 62, 92, 255))
    img.set(fx + 5, fy + 3, (46, 62, 92, 255))
    # Brow, nose, jaw
    img.rect(fx + 1, fy + 2, 2, 1, darken(SKIN_DARK, 0.3))
    img.rect(fx + 5, fy + 2, 2, 1, darken(SKIN_DARK, 0.3))
    img.rect(fx + 3, fy + 4, 2, 1, SKIN_DARK)
    img.rect(fx + 2, fy + 6, 4, 1, darken(SKIN_DARK, 0.15))
    # Collar of the shirt showing under the chin
    img.rect(fx, fy + 7, fw, 1, darken(SKIN_DARK, 0.35))

    # Hat layer: a short tactical cap in the tier trim colour.
    hx, hy, hw, hd = HAT.top
    img.rect(hx, hy, hw, hd, tier["suit"])
    for face in (HAT.right, HAT.front, HAT.left, HAT.back):
        x, y, w, h = face
        img.rect(x, y, w, 3, tier["suit"])
        img.rect(x, y + 2, w, 1, tier["trim"])
    # Brim over the eyes
    bx, by, bw, _bh = HAT.front
    img.rect(bx, by + 3, bw, 1, darken(tier["suit"], 0.35))


def draw_body(img, tier):
    suit = tier["suit"]
    suit_dark = darken(suit, 0.28)
    trim = tier["trim"]

    x, y, w, h = BODY.front
    img.shade(x, y, w, h, lighten(suit, 0.08), suit_dark)
    # Collar line and a hint of neck shadow under the chin
    img.rect(x, y, w, 1, darken(suit, 0.45))
    # Open jacket over a dress shirt
    img.rect(x + 3, y, 2, h - 3, SHIRT)
    img.rect(x + 3, y, 2, 1, darken(SHIRT, 0.35))
    # Tie, with a clip
    img.rect(x + 3, y + 1, 2, 5, tier["tie"])
    img.rect(x + 3, y + 6, 2, 1, darken(tier["tie"], 0.25))
    img.rect(x + 3, y + 4, 2, 1, tier["accent"])
    # Lapels: a V of trim either side of the shirt
    for i in range(5):
        img.set(x + 2, y + i, trim if i < 4 else darken(trim, 0.3))
        img.set(x + 5, y + i, trim if i < 4 else darken(trim, 0.3))
    img.set(x + 1, y + 1, darken(trim, 0.25))
    img.set(x + 6, y + 1, darken(trim, 0.25))
    # Shoulder-holster strap across the chest
    for step in range(5):
        img.set(x + 1 + step // 2, y + 2 + step, darken(suit, 0.55))
    # Belt with a buckle
    img.rect(x, y + h - 2, w, 1, darken(suit, 0.55))
    img.rect(x + 3, y + h - 2, 2, 1, tier["accent"])
    img.rect(x, y + h - 1, w, 1, darken(suit, 0.35))

    x, y, w, h = BODY.back
    img.shade(x, y, w, h, suit, suit_dark)
    img.rect(x, y, w, 1, darken(suit, 0.45))
    img.rect(x + 1, y + 2, w - 2, 1, trim)
    # A small crest on the back of the jacket
    img.rect(x + 3, y + 4, 2, 3, darken(trim, 0.15))
    img.rect(x, y + h - 2, w, 1, darken(suit, 0.55))

    for face in (BODY.right, BODY.left):
        x, y, w, h = face
        img.shade(x, y, w, h, suit, suit_dark)
        img.rect(x, y, w, 1, darken(suit, 0.45))
        img.rect(x, y + h - 2, w, 1, darken(suit, 0.55))

    x, y, w, h = BODY.top
    img.rect(x, y, w, h, darken(suit, 0.1))
    x, y, w, h = BODY.bottom
    img.rect(x, y, w, h, darken(suit, 0.55))


def draw_arm(img, tier):
    # Sleeves read a shade lighter than the jacket so the silhouette does not
    # collapse into one dark block at a distance.
    suit = lighten(tier["suit"], 0.10)
    for face in (ARM.right, ARM.front, ARM.left, ARM.back):
        x, y, w, h = face
        img.shade(x, y, w, h, lighten(suit, 0.08), darken(suit, 0.28))
        # Shoulder seam
        img.rect(x, y, w, 1, darken(suit, 0.4))
        # Cuff
        img.rect(x, y + h - 4, w, 1, tier["trim"])
        # Gloved hand
        img.rect(x, y + h - 3, w, 3, darken(tier["plate"], 0.4))
        img.rect(x, y + h - 3, w, 1, darken(tier["plate"], 0.55))
    x, y, w, h = ARM.top
    img.rect(x, y, w, h, darken(suit, 0.12))
    x, y, w, h = ARM.bottom
    img.rect(x, y, w, h, darken(tier["plate"], 0.5))


def draw_leg(img, tier):
    suit = darken(tier["suit"], 0.14)
    for face in (LEG.right, LEG.front, LEG.left, LEG.back):
        x, y, w, h = face
        img.shade(x, y, w, h, suit, darken(suit, 0.34))
        # Waistband, so the trousers read as separate from the jacket
        img.rect(x, y, w, 1, darken(suit, 0.5))
        # Boot, with a thin trim line at the top of the shaft
        img.rect(x, y + h - 4, w, 4, (26, 24, 26, 255))
        img.rect(x, y + h - 4, w, 1, darken(tier["trim"], 0.35))
        img.rect(x, y + h - 1, w, 1, (16, 15, 17, 255))
    x, y, w, h = LEG.front
    for row in range(1, h - 4):
        img.set(x + 1, y + row, darken(suit, 0.2))
    x, y, w, h = LEG.top
    img.rect(x, y, w, h, darken(suit, 0.15))
    x, y, w, h = LEG.bottom
    img.rect(x, y, w, h, (18, 16, 18, 255))


def draw_extras(img, tier):
    plate = tier["plate"]
    # Shoulder pauldrons
    for face in PAULDRON.faces():
        x, y, w, h = face
        img.shade(x, y, w, h, lighten(plate, 0.15), darken(plate, 0.3))
    x, y, w, h = PAULDRON.top
    img.rect(x, y, w, h, lighten(plate, 0.25))
    img.outline_rect(x, y, w, h, darken(plate, 0.4))

    # Sunglasses / tactical visor
    for face in VISOR.faces():
        x, y, w, h = face
        img.rect(x, y, w, h, tier["glass"])
    x, y, w, h = VISOR.front
    img.rect(x, y, w, h, tier["glass"])
    img.rect(x, y, w, 1, darken(tier["glass"], 0.5))
    img.set(x + 1, y + 1, lighten(tier["glass"], 0.55))
    img.set(x + 5, y + 1, lighten(tier["glass"], 0.35))
    img.set(x + 3, y, tier["trim"])
    img.set(x + 4, y, tier["trim"])

    # Earpiece
    for face in EARPIECE.faces():
        x, y, w, h = face
        img.rect(x, y, w, h, (34, 34, 38, 255))
    x, y, w, h = EARPIECE.front
    img.set(x, y, tier["accent"])

    # Chest insignia - a shield crest in the tier accent
    for face in INSIGNIA.faces():
        x, y, w, h = face
        img.rect(x, y, w, h, darken(tier["plate"], 0.35))
    x, y, w, h = INSIGNIA.front
    img.rect(x, y, w, h, tier["plate"])
    img.outline_rect(x, y, w, h, darken(tier["plate"], 0.45))
    img.set(x + 1, y + 1, tier["accent"])
    img.set(x + 2, y + 1, tier["accent"])
    img.set(x + 1, y + 2, tier["accent"])
    img.set(x + 2, y + 2, tier["accent"])
    img.set(x + 1, y + 2, lighten(tier["accent"], 0.4))


def build_skin(tier):
    img = Image(64, 64)
    draw_head(img, tier)
    draw_body(img, tier)
    draw_arm(img, tier)
    draw_leg(img, tier)
    draw_extras(img, tier)
    return img


# --------------------------------------------------------------------------
# Item icons
# --------------------------------------------------------------------------
def build_contract_icon():
    img = Image(16, 16)
    parchment = (232, 219, 186, 255)
    parchment_dark = (198, 182, 146, 255)
    edge = (120, 104, 74, 255)
    ink = (74, 62, 46, 255)
    gold = (226, 178, 62, 255)
    gold_dark = (158, 116, 30, 255)

    img.shade(3, 1, 10, 14, parchment, parchment_dark)
    img.outline_rect(3, 1, 10, 14, edge)
    # Rolled top and bottom edges
    img.rect(3, 1, 10, 1, darken(parchment, 0.22))
    img.rect(3, 14, 10, 1, darken(parchment, 0.28))
    # Written lines
    for row in (4, 6, 8):
        img.rect(5, row, 6, 1, ink)
    img.rect(5, 10, 4, 1, ink)
    # Wax seal with a shield
    img.rect(8, 10, 4, 4, gold_dark)
    img.rect(9, 11, 2, 2, gold)
    img.set(9, 10, gold)
    img.set(10, 13, gold_dark)
    img.set(8, 10, darken(gold_dark, 0.3))
    return img


def build_spawn_egg_icon(tier):
    img = Image(16, 16)
    # Deliberately not a tier colour: the egg reads as "bodyguard" - a dark
    # charcoal shell with gold detail - at every zoom level in the hotbar.
    base = (46, 50, 62, 255)
    spot = (228, 182, 70, 255)
    shell = [
        (6, 2, 4), (5, 3, 6), (4, 4, 8), (4, 5, 8),
        (3, 6, 10), (3, 7, 10), (3, 8, 10), (3, 9, 10),
        (4, 10, 8), (4, 11, 8), (5, 12, 6), (6, 13, 4),
    ]
    for x, y, w in shell:
        for col in range(x, x + w):
            t = (y - 2) / 11.0
            img.set(col, y, mix(lighten(base, 0.25), darken(base, 0.35), t))
    # Speckles
    for x, y in ((5, 5), (9, 4), (6, 8), (10, 7), (7, 11), (11, 10), (4, 9)):
        img.set(x, y, spot)
        img.set(x + 1, y, darken(spot, 0.2))
    # Highlight and outline
    img.set(6, 3, lighten(base, 0.55))
    img.set(7, 3, lighten(base, 0.4))
    outline = darken(base, 0.6)
    for x, y, w in shell:
        img.set(x - 1, y, outline)
        img.set(x + w, y, outline)
    for col in range(6, 10):
        img.set(col, 1, outline)
        img.set(col, 14, outline)
    return img


def build_pack_icon(tier):
    size = 128
    img = Image(size, size)
    img.shade(0, 0, size, size, (30, 34, 46, 255), (10, 12, 18, 255))

    gold = (228, 182, 70, 255)
    plate = tier["plate"]
    suit = (38, 42, 52, 255)

    def crest_half(y):
        t = (y - 8) / 112.0
        if t < 0.0:
            return 0
        if t < 0.66:
            return 48
        return int(48 * max(0.0, 1 - (t - 0.66) / 0.34) ** 0.65)

    # Gold rim, then the crest face.
    for y in range(8, 122):
        half = crest_half(y)
        if half <= 0:
            continue
        t = (y - 8) / 114.0
        for x in range(64 - half, 64 + half):
            rim = x < 64 - half + 5 or x >= 64 + half - 5 or y < 13
            img.set(x, y, mix(gold, darken(gold, 0.45), t) if rim else mix(plate, darken(plate, 0.55), t))

    # Head, shoulders and a shirt with a tie - the bodyguard in silhouette.
    img.rect(50, 26, 28, 26, SKIN)
    img.rect(50, 26, 28, 8, (34, 30, 30, 255))          # cap
    img.rect(50, 33, 28, 3, darken(gold, 0.15))          # cap band
    img.rect(48, 38, 32, 8, tier["glass"])               # visor
    img.rect(48, 38, 32, 2, darken(tier["glass"], 0.55))
    img.rect(53, 41, 4, 2, lighten(tier["glass"], 0.65))
    img.rect(60, 41, 3, 2, lighten(tier["glass"], 0.35))

    img.rect(38, 54, 52, 46, suit)                       # jacket
    img.rect(38, 54, 52, 3, darken(suit, 0.5))
    img.rect(56, 54, 16, 34, (236, 238, 242, 255))       # shirt
    img.rect(61, 58, 6, 26, gold)                        # tie
    img.rect(61, 84, 6, 3, darken(gold, 0.35))
    for i in range(10):                                   # lapels
        img.rect(52 - i // 2, 56 + i, 3, 1, darken(gold, 0.25))
        img.rect(73 + i // 2, 56 + i, 3, 1, darken(gold, 0.25))
    img.rect(34, 58, 8, 34, darken(suit, 0.18))          # shoulders
    img.rect(86, 58, 8, 34, darken(suit, 0.18))
    return img


# --------------------------------------------------------------------------
def preview(img, scale=1):
    ramp = " .:-=+*#%@"
    for y in range(0, img.h, scale):
        line = []
        for x in range(0, img.w, scale):
            r, g, b, a = img.get(x, y)
            if a == 0:
                line.append(" ")
            else:
                lum = (r * 0.3 + g * 0.6 + b * 0.1) / 255
                line.append(ramp[min(len(ramp) - 1, int(lum * len(ramp)))])
        print("".join(line))


def main():
    written = []
    for tier in TIERS:
        skin = build_skin(tier)
        path = os.path.join(RP, "textures", "entity", "bodyguard", "bodyguard_%s.png" % tier["key"])
        skin.save(path)
        written.append(path)

    contract = build_contract_icon()
    path = os.path.join(RP, "textures", "items", "bodyguard_contract.png")
    contract.save(path)
    written.append(path)

    egg = build_spawn_egg_icon(TIERS[2])
    path = os.path.join(RP, "textures", "items", "bodyguard_spawn_egg.png")
    egg.save(path)
    written.append(path)

    icon = build_pack_icon(TIERS[2])
    for root in (RP, BP):
        path = os.path.join(root, "pack_icon.png")
        icon.save(path)
        written.append(path)

    for path in written:
        print("wrote %s (%d bytes)" % (path, os.path.getsize(path)))

    if "--preview" in sys.argv:
        print("\n--- tier 2 skin ---")
        preview(build_skin(TIERS[2]))
        print("\n--- contract icon ---")
        preview(contract)
        print("\n--- spawn egg ---")
        preview(egg)


if __name__ == "__main__":
    main()
