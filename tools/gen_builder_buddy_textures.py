#!/usr/bin/env python3
"""Generate every texture Builder Buddy needs.

Pure standard library: RGBA PNGs are written by hand so the pack rebuilds on
any machine without image tooling. Everything here is drawn from scratch, so
no vanilla or third-party art ends up in the pack.

Outputs
    resource_packs/Builder_Buddy_RP/textures/entity/builder_buddy.png  (64x64)
    resource_packs/Builder_Buddy_RP/textures/items/bb_house_builder_remote.png
    resource_packs/Builder_Buddy_RP/textures/items/bb_builder_buddy_spawn_egg.png
    behavior_packs/Builder_Buddy_BP/pack_icon.png                      (64x64)
    resource_packs/Builder_Buddy_RP/pack_icon.png                      (64x64)

Usage:  python3 tools/gen_builder_buddy_textures.py
"""

import os
import struct
import sys
import zlib

BP = os.path.join("behavior_packs", "Builder_Buddy_BP")
RP = os.path.join("resource_packs", "Builder_Buddy_RP")

CLEAR = (0, 0, 0, 0)


# --------------------------------------------------------------------------
# PNG output
# --------------------------------------------------------------------------

class Canvas:
    def __init__(self, width, height, fill=CLEAR):
        self.width = width
        self.height = height
        self.px = [[fill for _ in range(width)] for _ in range(height)]

    def set(self, x, y, color):
        if 0 <= x < self.width and 0 <= y < self.height:
            self.px[y][x] = color

    def get(self, x, y):
        if 0 <= x < self.width and 0 <= y < self.height:
            return self.px[y][x]
        return CLEAR

    def rect(self, x, y, w, h, color):
        for dy in range(h):
            for dx in range(w):
                self.set(x + dx, y + dy, color)

    def scaled(self, factor):
        out = Canvas(self.width * factor, self.height * factor)
        for y in range(self.height):
            for x in range(self.width):
                out.rect(x * factor, y * factor, factor, factor, self.px[y][x])
        return out

    def write(self, path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        raw = b"".join(
            b"\x00" + bytes(c for px in row for c in px) for row in self.px
        )

        def chunk(tag, data):
            return (
                struct.pack(">I", len(data))
                + tag
                + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
            )

        blob = b"\x89PNG\r\n\x1a\n"
        blob += chunk(
            b"IHDR", struct.pack(">IIBBBBB", self.width, self.height, 8, 6, 0, 0, 0)
        )
        blob += chunk(b"IDAT", zlib.compress(raw, 9))
        blob += chunk(b"IEND", b"")
        with open(path, "wb") as handle:
            handle.write(blob)


def shade(color, amount):
    """Lighten (amount > 0) or darken (amount < 0) an RGBA colour."""
    r, g, b, a = color
    if a == 0:
        return color
    return (
        max(0, min(255, r + amount)),
        max(0, min(255, g + amount)),
        max(0, min(255, b + amount)),
        a,
    )


# --------------------------------------------------------------------------
# Original palette - a friendly builder in a hard hat and hi-vis vest
# --------------------------------------------------------------------------

SKIN = (216, 163, 116, 255)
SKIN_DK = (176, 126, 86, 255)
HAIR = (78, 52, 34, 255)
HAIR_LT = (102, 70, 46, 255)
EYE = (38, 42, 58, 255)
EYE_WHITE = (238, 238, 240, 255)
MOUTH = (140, 88, 72, 255)
SHIRT = (44, 132, 140, 255)
SHIRT_DK = (32, 100, 108, 255)
VEST = (238, 148, 46, 255)
VEST_DK = (198, 116, 30, 255)
BELT = (92, 62, 40, 255)
BUCKLE = (206, 176, 92, 255)
PANTS = (54, 66, 96, 255)
PANTS_DK = (40, 50, 74, 255)
BOOT = (78, 54, 38, 255)
HAT = (246, 202, 62, 255)
HAT_DK = (206, 162, 36, 255)


# --------------------------------------------------------------------------
# Skin (64x64, classic player UV layout)
# --------------------------------------------------------------------------

def box_faces(uv_x, uv_y, w, h, d):
    """Return the six face rectangles of a box-UV cube as (x, y, w, h)."""
    return {
        "up": (uv_x + d, uv_y, w, d),
        "down": (uv_x + d + w, uv_y, w, d),
        "east": (uv_x, uv_y + d, d, h),
        "north": (uv_x + d, uv_y + d, w, h),
        "west": (uv_x + d + w, uv_y + d, d, h),
        "south": (uv_x + d + w + d, uv_y + d, w, h),
    }


def fill_box(canvas, faces, color, top=None, bottom=None):
    """Flat-fill every face, with optional distinct top/bottom colours."""
    for name, (x, y, w, h) in faces.items():
        if name == "up" and top is not None:
            canvas.rect(x, y, w, h, top)
        elif name == "down" and bottom is not None:
            canvas.rect(x, y, w, h, bottom)
        else:
            canvas.rect(x, y, w, h, color)


def texture_noise(canvas, faces, amount=-10, step=3):
    """Break up flat fills with a subtle regular shade pattern."""
    for _name, (x, y, w, h) in faces.items():
        for dy in range(h):
            for dx in range(w):
                if (dx + dy) % step == 0:
                    canvas.set(x + dx, y + dy, shade(canvas.get(x + dx, y + dy), amount))


def draw_skin():
    c = Canvas(64, 64)

    # ---- head: skin all round, hair on the back and sides, face on north ----
    head = box_faces(0, 0, 8, 8, 8)
    fill_box(c, head, SKIN, top=HAIR, bottom=SKIN_DK)
    texture_noise(c, {"n": head["north"]}, -6, 5)

    # Hair fringe across the top of every side face.
    for name in ("east", "west", "south", "north"):
        x, y, w, h = head[name]
        rows = 2 if name == "north" else 3
        for dy in range(rows):
            for dx in range(w):
                c.set(x + dx, y + dy, HAIR if (dx + dy) % 4 else HAIR_LT)

    # Face: eyes, brows and a friendly smile.
    fx, fy, _, _ = head["north"]
    c.rect(fx + 1, fy + 3, 2, 2, EYE_WHITE)
    c.rect(fx + 5, fy + 3, 2, 2, EYE_WHITE)
    c.set(fx + 2, fy + 4, EYE)
    c.set(fx + 5, fy + 4, EYE)
    c.set(fx + 1, fy + 2, HAIR)
    c.set(fx + 2, fy + 2, HAIR)
    c.set(fx + 5, fy + 2, HAIR)
    c.set(fx + 6, fy + 2, HAIR)
    c.rect(fx + 3, fy + 6, 2, 1, MOUTH)
    c.set(fx + 2, fy + 5, MOUTH)
    c.set(fx + 5, fy + 5, MOUTH)

    # ---- hat layer: yellow hard hat with a brim ----
    hat = box_faces(32, 0, 8, 8, 8)
    x, y, w, h = hat["up"]
    c.rect(x, y, w, h, HAT)
    for name in ("north", "east", "west", "south"):
        x, y, w, h = hat[name]
        c.rect(x, y, w, 3, HAT)          # dome
        c.rect(x, y + 3, w, 1, HAT_DK)   # brim lip
    # Ridge down the middle of the dome, front to back.
    x, y, w, h = hat["up"]
    c.rect(x + 3, y, 2, h, HAT_DK)

    # ---- body: teal shirt under an orange hi-vis vest ----
    body = box_faces(16, 16, 8, 12, 4)
    fill_box(c, body, SHIRT, top=SHIRT_DK, bottom=PANTS_DK)
    texture_noise(c, body, -8, 4)
    for name in ("north", "south"):
        x, y, w, h = body[name]
        c.rect(x + 1, y, 2, 8, VEST)
        c.rect(x + 5, y, 2, 8, VEST)
        c.rect(x, y + 3, w, 1, VEST_DK)
        c.rect(x, y + 8, w, 2, BELT)      # tool belt
        c.rect(x + 3, y + 8, 2, 2, BUCKLE)
        c.rect(x, y + 10, w, 2, PANTS)
    for name in ("east", "west"):
        x, y, w, h = body[name]
        c.rect(x, y, w, 8, VEST)
        c.rect(x, y + 3, w, 1, VEST_DK)
        c.rect(x, y + 8, w, 2, BELT)
        c.rect(x, y + 10, w, 2, PANTS)

    # ---- arms: teal sleeve to the elbow, bare forearm and hand ----
    for uv in ((40, 16), (32, 48)):
        arm = box_faces(uv[0], uv[1], 4, 12, 4)
        fill_box(c, arm, SKIN, top=SHIRT_DK, bottom=SKIN_DK)
        for name in ("north", "south", "east", "west"):
            x, y, w, h = arm[name]
            c.rect(x, y, w, 6, SHIRT)
            c.rect(x, y + 5, w, 1, SHIRT_DK)
            c.rect(x, y + 6, w, 1, VEST)   # hi-vis cuff band
        texture_noise(c, arm, -8, 4)

    # ---- legs: navy trousers into brown work boots ----
    for uv in ((0, 16), (16, 48)):
        leg = box_faces(uv[0], uv[1], 4, 12, 4)
        fill_box(c, leg, PANTS, top=PANTS_DK, bottom=BOOT)
        for name in ("north", "south", "east", "west"):
            x, y, w, h = leg[name]
            c.rect(x, y + 9, w, 3, BOOT)
            c.rect(x, y + 9, w, 1, shade(BOOT, 22))
        texture_noise(c, leg, -8, 4)

    return c


# --------------------------------------------------------------------------
# Item icons (16x16)
# --------------------------------------------------------------------------

def outline_alpha(canvas, color=(20, 18, 26, 255)):
    """Draw a 1px dark border around every opaque pixel."""
    edges = []
    for y in range(canvas.height):
        for x in range(canvas.width):
            if canvas.get(x, y)[3]:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                if canvas.get(x + dx, y + dy)[3]:
                    edges.append((x, y))
                    break
    for x, y in edges:
        canvas.set(x, y, color)


def draw_remote():
    """A chunky handheld console: grey shell, green screen, blueprint aerial."""
    c = Canvas(16, 16)
    shell = (128, 134, 146, 255)
    shell_lt = (168, 174, 186, 255)
    shell_dk = (86, 92, 104, 255)
    screen = (92, 224, 148, 255)
    screen_dk = (36, 138, 92, 255)
    button = (222, 76, 66, 255)
    button2 = (240, 200, 70, 255)
    aerial = (196, 202, 214, 255)

    # Aerial with a knob on top.
    c.rect(11, 0, 1, 4, aerial)
    c.rect(10, 0, 2, 1, button2)

    # Shell.
    c.rect(3, 3, 9, 12, shell)
    c.rect(3, 3, 9, 1, shell_lt)
    c.rect(3, 14, 9, 1, shell_dk)
    c.rect(11, 4, 1, 11, shell_dk)
    c.rect(3, 4, 1, 11, shell_lt)

    # Screen showing a tiny house blueprint.
    c.rect(4, 5, 7, 5, screen_dk)
    c.rect(5, 6, 5, 3, screen)
    c.rect(6, 7, 3, 2, screen_dk)   # house body
    c.set(7, 6, screen_dk)          # roof peak
    c.set(7, 8, screen)             # doorway

    # Buttons.
    c.rect(5, 11, 2, 2, button)
    c.rect(8, 11, 2, 2, button2)
    c.set(5, 11, shade(button, 40))
    c.set(8, 11, shade(button2, 40))

    outline_alpha(c)
    return c


def draw_spawn_egg():
    """Egg silhouette in the buddy's teal, speckled with hard-hat yellow."""
    c = Canvas(16, 16)
    base = SHIRT
    base_lt = shade(SHIRT, 46)
    base_dk = shade(SHIRT, -34)

    # Egg: half-widths per row, narrow at the top, round at the bottom.
    widths = [0, 2, 3, 4, 4, 5, 5, 5, 5, 5, 5, 4, 4, 3, 2, 0]
    for y, half in enumerate(widths):
        if not half:
            continue
        c.rect(8 - half, y, half * 2, 1, base)

    # Shading: lit upper-left, shadowed lower-right.
    for y in range(16):
        for x in range(16):
            if not c.get(x, y)[3]:
                continue
            if x - y < -4:
                c.set(x, y, base_lt)
            elif x - y > 4:
                c.set(x, y, base_dk)

    # Speckles.
    for x, y in ((5, 4), (9, 3), (7, 7), (10, 8), (4, 9), (8, 11), (6, 12), (11, 6)):
        c.set(x, y, HAT)
        c.set(x + 1, y, HAT_DK)

    outline_alpha(c, (26, 58, 62, 255))
    return c


def draw_pack_icon():
    """A little house with the buddy's hard hat sitting on the roof."""
    c = Canvas(16, 16, (38, 46, 62, 255))
    wall = (176, 138, 92, 255)
    wall_dk = (140, 106, 68, 255)
    roof = (150, 74, 58, 255)
    roof_dk = (116, 54, 42, 255)
    glass = (128, 206, 232, 255)
    door = (104, 72, 46, 255)
    ground = (74, 118, 66, 255)

    c.rect(0, 13, 16, 3, ground)
    # Roof: widening rows.
    for i, y in enumerate(range(4, 8)):
        half = 2 + i * 2
        c.rect(8 - half, y, half * 2, 1, roof if i % 2 == 0 else roof_dk)
    # Walls.
    c.rect(3, 8, 10, 5, wall)
    c.rect(3, 12, 10, 1, wall_dk)
    # Windows and door.
    c.rect(4, 9, 2, 2, glass)
    c.rect(10, 9, 2, 2, glass)
    c.rect(7, 10, 2, 3, door)
    # Hard hat perched on the roof ridge.
    c.rect(6, 2, 4, 2, HAT)
    c.rect(5, 3, 6, 1, HAT_DK)
    return c.scaled(4)


# --------------------------------------------------------------------------

def main():
    items = os.path.join(RP, "textures", "items")

    draw_skin().write(os.path.join(RP, "textures", "entity", "builder_buddy.png"))
    draw_remote().write(os.path.join(items, "bb_house_builder_remote.png"))
    draw_spawn_egg().write(os.path.join(items, "bb_builder_buddy_spawn_egg.png"))

    icon = draw_pack_icon()
    icon.write(os.path.join(BP, "pack_icon.png"))
    icon.write(os.path.join(RP, "pack_icon.png"))

    print("Wrote 1 skin, 2 item icons and 2 pack icons.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
