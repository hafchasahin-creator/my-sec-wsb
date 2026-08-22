#!/usr/bin/env python3
"""Generate every asset for the Natural Disasters add-on.

Pure standard library (like tools/gen_textures.py): writes RGBA PNGs and PCM
WAVs directly so the packs can be rebuilt anywhere without image/audio tooling.

Outputs
  - 11 item icons (32x32, drawn at 64x64 and box-downsampled for smoothness)
  - pack icons for both packs (128x128)
  - tornado funnel entity texture (64x64, alpha-tested streaks)
  - 6 particle sprites (16x16)
  - 5 sound effects (mono 16-bit 22050 Hz WAV)
  - the 11 behaviour-pack item JSON files
  - textures/item_texture.json and texts/en_US.lang for both packs

Everything identifier-shaped comes from the DISASTERS table below so the item
files, icon atlas and language files can never drift apart.

Usage:  python3 tools/gen_disaster_assets.py
"""

import json
import math
import os
import random
import struct
import wave
import zlib

BP = os.path.join("behavior_packs", "natural_disasters_bp")
RP = os.path.join("resource_packs", "natural_disasters_rp")

# name -> (display name, cooldown seconds)
DISASTERS = {
    "tornado": ("Tornado", 3.0),
    "tsunami": ("Tsunami", 3.0),
    "earthquake": ("Earthquake", 3.0),
    "meteor": ("Meteor Strike", 3.0),
    "volcano": ("Volcano", 5.0),
    "flash_flood": ("Flash Flood", 3.0),
    "hurricane": ("Hurricane", 3.0),
    "thunderstorm": ("Super Thunderstorm", 3.0),
    "blizzard": ("Blizzard", 3.0),
    "wildfire": ("Wildfire", 3.0),
    "sandstorm": ("Sandstorm", 3.0),
}


# --------------------------------------------------------------------------
# PNG output
# --------------------------------------------------------------------------

def write_png(path, pixels):
    """pixels: list of rows, each row a list of (r, g, b, a) ints."""
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
# Float RGBA canvas with simple painter's-algorithm blending
# --------------------------------------------------------------------------

class Canvas:
    def __init__(self, size):
        self.size = size
        self.px = [[(0.0, 0.0, 0.0, 0.0) for _ in range(size)] for _ in range(size)]

    def blend(self, x, y, color):
        if not (0 <= x < self.size and 0 <= y < self.size):
            return
        r, g, b, a = color
        if a <= 0:
            return
        br, bg, bb, ba = self.px[y][x]
        out_a = a + ba * (1 - a)
        if out_a <= 0:
            return
        self.px[y][x] = (
            (r * a + br * ba * (1 - a)) / out_a,
            (g * a + bg * ba * (1 - a)) / out_a,
            (b * a + bb * ba * (1 - a)) / out_a,
            out_a,
        )

    def disc(self, cx, cy, radius, color, soft=1.2):
        r, g, b, a = color
        lo_x = max(0, int(cx - radius - 2))
        hi_x = min(self.size, int(cx + radius + 3))
        lo_y = max(0, int(cy - radius - 2))
        hi_y = min(self.size, int(cy + radius + 3))
        for y in range(lo_y, hi_y):
            for x in range(lo_x, hi_x):
                d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
                if d <= radius:
                    self.blend(x, y, (r, g, b, a))
                elif d <= radius + soft:
                    self.blend(x, y, (r, g, b, a * (1 - (d - radius) / soft)))

    def ellipse(self, cx, cy, rx, ry, color, soft=1.2):
        r, g, b, a = color
        for y in range(self.size):
            for x in range(self.size):
                d = math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry)
                if d <= 1.0:
                    self.blend(x, y, (r, g, b, a))
                elif d <= 1.0 + soft / max(rx, ry):
                    fade = 1 - (d - 1.0) * max(rx, ry) / soft
                    self.blend(x, y, (r, g, b, a * max(0.0, fade)))

    def line(self, x0, y0, x1, y1, width, color):
        steps = max(2, int(math.hypot(x1 - x0, y1 - y0) * 2))
        for i in range(steps + 1):
            t = i / steps
            self.disc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, width / 2, color, 0.8)

    def arc(self, cx, cy, radius, a0, a1, width, color):
        """Angles in degrees, screen coords (y down)."""
        span = abs(a1 - a0)
        steps = max(4, int(span / 4))
        for i in range(steps + 1):
            ang = math.radians(a0 + (a1 - a0) * i / steps)
            self.disc(
                cx + math.cos(ang) * radius,
                cy + math.sin(ang) * radius,
                width / 2,
                color,
                0.8,
            )

    def triangle(self, p0, p1, p2, color):
        xs = [p0[0], p1[0], p2[0]]
        ys = [p0[1], p1[1], p2[1]]

        def edge(a, b, p):
            return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])

        area = edge(p0, p1, p2)
        if area == 0:
            return
        for y in range(max(0, int(min(ys))), min(self.size, int(max(ys)) + 2)):
            for x in range(max(0, int(min(xs))), min(self.size, int(max(xs)) + 2)):
                p = (x + 0.5, y + 0.5)
                w0 = edge(p1, p2, p) / area
                w1 = edge(p2, p0, p) / area
                w2 = edge(p0, p1, p) / area
                if w0 >= -0.02 and w1 >= -0.02 and w2 >= -0.02:
                    self.blend(x, y, color)

    def downsample(self, factor):
        out_size = self.size // factor
        rows = []
        for oy in range(out_size):
            row = []
            for ox in range(out_size):
                r = g = b = a = 0.0
                for sy in range(factor):
                    for sx in range(factor):
                        pr, pg, pb, pa = self.px[oy * factor + sy][ox * factor + sx]
                        r += pr * pa
                        g += pg * pa
                        b += pb * pa
                        a += pa
                n = factor * factor
                if a > 0:
                    row.append(
                        (
                            int(round(r / a * 255)),
                            int(round(g / a * 255)),
                            int(round(b / a * 255)),
                            int(round(a / n * 255)),
                        )
                    )
                else:
                    row.append((0, 0, 0, 0))
            rows.append(row)
        return rows


def rgba(r, g, b, a=1.0):
    return (r / 255.0, g / 255.0, b / 255.0, a)


# --------------------------------------------------------------------------
# Item icons (drawn on a 64x64 canvas, shipped at 32x32)
# --------------------------------------------------------------------------

def icon_tornado(c):
    rows = [
        (8, 26, 5.5, 236),
        (17, 21, 5.0, 222),
        (25, 16, 4.6, 206),
        (33, 12, 4.2, 190),
        (41, 8, 3.8, 174),
        (48, 5, 3.2, 158),
    ]
    for i, (cy, rx, ry, lum) in enumerate(rows):
        sway = 3 * math.sin(i * 1.9)
        c.ellipse(32 + sway, cy, rx, ry, rgba(lum, lum, lum + 6))
        c.ellipse(32 + sway - rx * 0.3, cy - 1.4, rx * 0.5, ry * 0.5, rgba(250, 250, 252, 0.55))
    c.disc(31, 56, 2.6, rgba(120, 120, 128))
    for dx, dy in ((-14, 44), (15, 38), (-11, 22), (13, 18), (18, 52)):
        c.disc(32 + dx, dy, 1.6, rgba(121, 85, 61))


def icon_tsunami(c):
    c.triangle((2, 62), (62, 62), (62, 34), rgba(21, 101, 192))
    c.triangle((2, 62), (2, 40), (62, 34), rgba(21, 101, 192))
    for x in range(2, 62):
        top = 40 - x * 0.1 + 3.0 * math.sin(x / 5.0)
        c.line(x, top, x, 62, 1.4, rgba(30, 120, 205, 0.9))
    c.arc(40, 28, 19, 175, 330, 9, rgba(25, 118, 210))
    c.arc(40, 28, 19, 175, 330, 4.5, rgba(100, 181, 246))
    c.arc(40, 28, 8, 160, 340, 4.5, rgba(66, 165, 245))
    for ang in range(180, 331, 25):
        rad = math.radians(ang)
        c.disc(40 + math.cos(rad) * 23, 28 + math.sin(rad) * 23, 2.6, rgba(240, 250, 255))
    for x in (8, 20, 33, 47, 58):
        c.disc(x, 40 + 3 * math.sin(x / 4.0), 2.0, rgba(227, 242, 253))


def icon_earthquake(c):
    for y in range(14, 56):
        t = (y - 14) / 42.0
        col = rgba(150 - 55 * t, 105 - 40 * t, 62 - 22 * t)
        c.line(6, y, 58, y, 1.4, col)
    c.line(6, 14, 58, 14, 3, rgba(124, 179, 66))
    crack = [(33, 12), (26, 22), (36, 30), (27, 40), (37, 48), (30, 57)]
    for i in range(len(crack) - 1):
        c.line(*crack[i], *crack[i + 1], 5.0, rgba(33, 20, 12))
    c.line(26, 22, 16, 27, 3.0, rgba(33, 20, 12))
    c.line(36, 30, 48, 34, 3.0, rgba(33, 20, 12))
    c.line(27, 40, 18, 46, 2.4, rgba(33, 20, 12))
    for x0, y0 in ((8, 6), (50, 5)):
        c.line(x0, y0, x0 + 6, y0 + 3, 2.0, rgba(255, 213, 79))
        c.line(x0 + 1, y0 + 5, x0 + 7, y0 + 7, 2.0, rgba(255, 213, 79))


def icon_meteor(c):
    for i in range(16):
        t = i / 15.0
        c.disc(
            24 + t * 34,
            44 - t * 36,
            10.5 - t * 8.5,
            rgba(255, 190 - t * 90, 40, 0.34 + 0.30 * (1 - t)),
            2.0,
        )
    c.disc(22, 42, 13.5, rgba(255, 138, 30))
    c.disc(21, 43, 11.5, rgba(141, 78, 42))
    c.disc(19, 45, 9.0, rgba(109, 58, 30))
    for dx, dy, r in ((-4, -3, 2.4), (3, 2, 3.0), (-1, 5, 2.0), (5, -4, 1.8)):
        c.disc(21 + dx, 43 + dy, r, rgba(74, 38, 19))
    c.arc(22, 42, 13.5, 110, 260, 2.6, rgba(255, 224, 130, 0.9))


def icon_volcano(c):
    c.triangle((32, 15), (4, 57), (60, 57), rgba(87, 66, 57))
    c.triangle((32, 15), (18, 57), (46, 57), rgba(62, 46, 40))
    c.ellipse(32, 17, 8.5, 3.2, rgba(46, 30, 24))
    c.ellipse(32, 17, 6.0, 2.1, rgba(255, 87, 34))
    lava = rgba(255, 87, 34)
    core = rgba(255, 202, 40)
    c.line(27, 18, 18, 42, 4.4, lava)
    c.line(18, 42, 14, 55, 4.0, lava)
    c.line(36, 18, 43, 38, 4.0, lava)
    c.line(43, 38, 49, 54, 3.4, lava)
    c.line(32, 19, 31, 34, 3.0, lava)
    c.line(27, 18, 19, 41, 1.8, core)
    c.line(36, 18, 42, 37, 1.6, core)
    for dx, dy, r in ((-6, -8, 4.2), (0, -12, 5.2), (7, -7, 3.8)):
        c.disc(32 + dx, 12 + dy, r, rgba(120, 118, 122, 0.85))


def icon_flash_flood(c):
    c.triangle((32, 8), (18, 24), (46, 24), rgba(141, 90, 47))
    c.triangle((32, 11), (22, 23), (42, 23), rgba(184, 122, 66))
    c.line(26, 24, 26, 30, 4, rgba(120, 76, 40))
    c.line(38, 24, 38, 30, 4, rgba(120, 76, 40))
    bands = [
        (26, rgba(100, 181, 246)),
        (36, rgba(66, 165, 245)),
        (46, rgba(30, 136, 229)),
        (55, rgba(21, 101, 192)),
    ]
    for y0, col in bands:
        for x in range(2, 62):
            yy = y0 + 3.2 * math.sin(x / 5.0 + y0)
            c.line(x, yy, x, min(62, yy + 11), 1.5, col)
    for x in (10, 24, 40, 53):
        c.disc(x, 24 + 3 * math.sin(x / 3.0), 1.9, rgba(227, 242, 253))


def icon_hurricane(c):
    c.disc(32, 32, 27, rgba(41, 121, 255, 0.28), 3.0)
    for arm in (0.0, math.pi):
        for i in range(46):
            th = i / 45.0 * 3.6
            r = 4 + th * 6.4
            ang = th + arm
            x = 32 + math.cos(ang) * r
            y = 32 + math.sin(ang) * r * 0.92
            c.disc(x, y, 4.4 - th * 0.62, rgba(224, 247, 250, 0.95), 1.0)
    c.disc(32, 32, 4.6, rgba(178, 235, 242))
    c.disc(32, 32, 2.3, rgba(0, 131, 143))


def icon_thunderstorm(c):
    cloud = rgba(69, 90, 100)
    lite = rgba(96, 125, 139)
    for cx, cy, r, col in (
        (21, 21, 10, cloud),
        (33, 16, 12, lite),
        (45, 21, 9, cloud),
        (33, 24, 13, cloud),
    ):
        c.disc(cx, cy, r, col)
    c.ellipse(33, 27, 20, 7, rgba(55, 71, 79))
    bolt_a = [(36, 30), (26, 44), (33, 44), (25, 60)]
    for i in range(len(bolt_a) - 1):
        c.line(*bolt_a[i], *bolt_a[i + 1], 5.4, rgba(255, 179, 0))
    for i in range(len(bolt_a) - 1):
        c.line(*bolt_a[i], *bolt_a[i + 1], 2.6, rgba(255, 234, 0))
    c.disc(45, 38, 1.8, rgba(129, 212, 250))
    c.disc(15, 34, 1.8, rgba(129, 212, 250))


def icon_blizzard(c):
    edge = rgba(129, 212, 250)
    body = rgba(255, 255, 255)
    for k in range(6):
        ang = math.radians(k * 60 + 90)
        dx, dy = math.cos(ang), math.sin(ang)
        c.line(32, 32, 32 + dx * 24, 32 + dy * 24, 4.6, edge)
        c.line(32, 32, 32 + dx * 24, 32 + dy * 24, 2.4, body)
        for frac in (0.55, 0.8):
            bx, by = 32 + dx * 24 * frac, 32 + dy * 24 * frac
            for side in (-1, 1):
                tick = math.radians(k * 60 + 90 + side * 55)
                c.line(
                    bx,
                    by,
                    bx + math.cos(tick) * 6.5,
                    by + math.sin(tick) * 6.5,
                    2.6,
                    body,
                )
    c.disc(32, 32, 4.6, edge)
    c.disc(32, 32, 2.6, body)


def icon_wildfire(c):
    c.triangle((32, 6), (15, 40), (49, 40), rgba(255, 109, 0))
    c.disc(32, 41, 16.5, rgba(255, 109, 0))
    c.triangle((30, 18), (20, 44), (42, 44), rgba(255, 167, 38))
    c.disc(32, 44, 11.5, rgba(255, 167, 38))
    c.triangle((31, 30), (25, 48), (39, 48), rgba(255, 213, 79))
    c.disc(32, 48, 7.0, rgba(255, 241, 118))
    c.disc(23, 15, 2.4, rgba(255, 138, 30))
    c.disc(44, 20, 2.0, rgba(255, 138, 30))


def icon_sandstorm(c):
    swirls = [
        (24, 18, 11, 150, 395, 4.6, rgba(215, 168, 110)),
        (34, 34, 14, 130, 380, 5.0, rgba(198, 139, 78)),
        (26, 49, 9, 150, 390, 4.0, rgba(224, 187, 136)),
    ]
    for cx, cy, r, a0, a1, w, col in swirls:
        c.arc(cx, cy, r, a0, a1, w, col)
        end = math.radians(a1)
        c.disc(cx + math.cos(end) * r, cy + math.sin(end) * r, w * 0.75, col)
    for x, y in ((50, 12), (55, 26), (48, 42), (54, 52), (12, 30), (10, 54)):
        c.disc(x, y, 1.9, rgba(233, 202, 155))


ICONS = {
    "tornado": icon_tornado,
    "tsunami": icon_tsunami,
    "earthquake": icon_earthquake,
    "meteor": icon_meteor,
    "volcano": icon_volcano,
    "flash_flood": icon_flash_flood,
    "hurricane": icon_hurricane,
    "thunderstorm": icon_thunderstorm,
    "blizzard": icon_blizzard,
    "wildfire": icon_wildfire,
    "sandstorm": icon_sandstorm,
}


def make_item_icons():
    out_dir = os.path.join(RP, "textures", "items")
    for name, draw in ICONS.items():
        canvas = Canvas(64)
        draw(canvas)
        write_png(os.path.join(out_dir, f"{name}.png"), canvas.downsample(2))


# --------------------------------------------------------------------------
# Pack icons
# --------------------------------------------------------------------------

def make_pack_icons():
    canvas = Canvas(256)
    for y in range(256):
        t = y / 255.0
        col = rgba(24 + 30 * t, 32 + 44 * t, 52 + 74 * t)
        canvas.line(0, y, 255, y, 1.6, col)
    # Big tornado funnel.
    rows = [(46, 88, 20), (78, 72, 19), (108, 55, 17), (136, 39, 15), (162, 25, 13), (186, 13, 11)]
    for i, (cy, rx, ry) in enumerate(rows):
        sway = 10 * math.sin(i * 1.7)
        lum = 232 - i * 14
        canvas.ellipse(112 + sway, cy, rx, ry, rgba(lum, lum, lum + 8, 0.96))
        canvas.ellipse(112 + sway - rx * 0.3, cy - 5, rx * 0.5, ry * 0.5, rgba(252, 252, 255, 0.5))
    canvas.disc(108, 212, 9, rgba(130, 130, 140))
    # Lightning bolt on the right.
    bolt = [(216, 36), (196, 92), (212, 92), (190, 152)]
    for i in range(len(bolt) - 1):
        canvas.line(*bolt[i], *bolt[i + 1], 14, rgba(255, 179, 0))
        canvas.line(*bolt[i], *bolt[i + 1], 7, rgba(255, 234, 0))
    # Meteor streak top-left.
    for i in range(14):
        t = i / 13.0
        canvas.disc(14 + t * 52, 64 - t * 46, 12 - t * 8, rgba(255, 150, 40, 0.5))
    canvas.disc(18, 60, 11, rgba(141, 78, 42))
    canvas.arc(18, 60, 11, 110, 260, 3, rgba(255, 210, 120))
    pixels = canvas.downsample(2)
    write_png(os.path.join(BP, "pack_icon.png"), pixels)
    write_png(os.path.join(RP, "pack_icon.png"), pixels)


# --------------------------------------------------------------------------
# Tornado funnel entity texture: light grey streaks with hard alpha gaps
# --------------------------------------------------------------------------

def make_tornado_texture():
    rng = random.Random(20260822)
    size = 64
    row_phase = [rng.uniform(0, math.tau) for _ in range(size)]
    row_freq = [rng.uniform(0.55, 0.95) for _ in range(size)]
    pixels = []
    for y in range(size):
        base = 238 - int(y * 1.35)
        row = []
        for x in range(size):
            wave_v = math.sin(x * row_freq[y] + row_phase[y]) + 0.35 * math.sin(
                x * 0.23 + y * 0.7
            )
            solid = wave_v > -0.55 and rng.random() > 0.06
            if solid:
                lum = base + rng.randint(-14, 14)
                lum = max(120, min(250, lum))
                row.append((lum, lum, min(255, lum + 6), 255))
            else:
                row.append((0, 0, 0, 0))
        pixels.append(row)
    write_png(os.path.join(RP, "textures", "entity", "tornado.png"), pixels)


# --------------------------------------------------------------------------
# Particle sprites
# --------------------------------------------------------------------------

def radial_sprite(size, color, power=2.0, alpha_max=0.9, stretch_x=1.0):
    rows = []
    for y in range(size):
        row = []
        for x in range(size):
            dx = (x + 0.5 - size / 2) / (size / 2) / stretch_x
            dy = (y + 0.5 - size / 2) / (size / 2)
            d = math.hypot(dx, dy)
            a = max(0.0, 1.0 - d) ** power * alpha_max
            row.append((color[0], color[1], color[2], int(a * 255)))
        rows.append(row)
    return rows


def make_particle_sprites():
    out = os.path.join(RP, "textures", "particle")
    write_png(os.path.join(out, "nd_smoke.png"), radial_sprite(16, (185, 185, 192), 1.6, 0.85))
    write_png(os.path.join(out, "nd_sand.png"), radial_sprite(16, (214, 170, 112), 1.7, 0.85, 1.6))
    write_png(os.path.join(out, "nd_splash.png"), radial_sprite(16, (170, 214, 255), 1.9, 0.95))

    # Ember: hot core fading to orange.
    rows = []
    for y in range(16):
        row = []
        for x in range(16):
            d = math.hypot(x - 7.5, y - 7.5) / 8.0
            a = max(0.0, 1.0 - d) ** 1.6
            r = 255
            g = int(240 - 140 * min(1.0, d * 1.3))
            b = int(150 * max(0.0, 1.0 - d * 2.2))
            row.append((r, max(60, g), b, int(a * 255)))
        rows.append(row)
    write_png(os.path.join(out, "nd_ember.png"), rows)

    # Snowflake: crisp plus + diagonals.
    rows = [[(255, 255, 255, 0) for _ in range(16)] for _ in range(16)]
    for i in range(3, 13):
        for px, py in ((i, 8), (8, i), (i, i), (i, 15 - i)):
            rows[py][px] = (245, 250, 255, 235)
    for px, py in ((8, 8),):
        rows[py][px] = (255, 255, 255, 255)
    write_png(os.path.join(out, "nd_snow.png"), rows)

    # Wind streak: horizontal white wisp.
    rows = []
    for y in range(16):
        row = []
        for x in range(16):
            fy = math.exp(-(((y - 7.5) / 2.6) ** 2))
            fx = math.sin(math.pi * (x + 0.5) / 16)
            row.append((235, 245, 255, int(200 * fy * fx)))
        rows.append(row)
    write_png(os.path.join(out, "nd_wind.png"), rows)


# --------------------------------------------------------------------------
# Sounds (mono 16-bit PCM WAV, 22050 Hz)
# --------------------------------------------------------------------------

RATE = 22050


def write_wav(path, samples):
    peak = max(1e-9, max(abs(s) for s in samples))
    scale = 0.82 / peak * 32767
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(RATE)
        handle.writeframes(
            b"".join(struct.pack("<h", int(s * scale)) for s in samples)
        )


def lowpass(samples, alpha):
    out = []
    prev = 0.0
    for s in samples:
        prev += alpha * (s - prev)
        out.append(prev)
    return out


def fade_edges(samples, seconds=0.08):
    n = int(RATE * seconds)
    total = len(samples)
    for i in range(min(n, total)):
        samples[i] *= i / n
        samples[total - 1 - i] *= i / n
    return samples


def sound_wind(rng, seconds=4.0):
    n = int(RATE * seconds)
    noise = lowpass([rng.uniform(-1, 1) for _ in range(n)], 0.09)
    out = []
    for i, s in enumerate(noise):
        t = i / RATE
        gust = 0.55 + 0.45 * math.sin(math.tau * 0.35 * t + 1.2)
        swell = 0.75 + 0.25 * math.sin(math.tau * 0.09 * t)
        out.append(s * gust * swell)
    return fade_edges(out, 0.15)


def sound_rumble(rng, seconds=3.0):
    n = int(RATE * seconds)
    noise = lowpass([rng.uniform(-1, 1) for _ in range(n)], 0.035)
    out = []
    phase = [rng.uniform(0, math.tau) for _ in range(3)]
    for i in range(n):
        t = i / RATE
        s = 0.0
        for k, freq in enumerate((27.0, 36.5, 47.0)):
            wobble = 1.0 + 0.05 * math.sin(math.tau * 0.5 * t + k)
            s += math.sin(math.tau * freq * wobble * t + phase[k]) * (0.5 - 0.12 * k)
        tremor = 0.6 + 0.4 * math.sin(math.tau * 1.7 * t + 0.7)
        out.append((s * 0.6 + noise[i] * 1.6) * tremor)
    return fade_edges(out, 0.12)


def sound_whoosh(rng, seconds=1.6):
    n = int(RATE * seconds)
    out = []
    prev = 0.0
    for i in range(n):
        t = i / n
        alpha = 0.02 + 0.30 * t
        prev += alpha * (rng.uniform(-1, 1) - prev)
        env = (t ** 1.6) if t < 0.8 else max(0.0, 1 - (t - 0.8) / 0.2) * 0.8 ** 1.6
        out.append(prev * env)
    return fade_edges(out, 0.02)


def sound_wave(rng, seconds=2.2):
    n = int(RATE * seconds)
    noise = lowpass([rng.uniform(-1, 1) for _ in range(n)], 0.13)
    out = []
    for i, s in enumerate(noise):
        t = i / RATE
        if t < 0.3:
            env = t / 0.3
        else:
            env = math.exp(-(t - 0.3) / 0.8)
        deep = math.sin(math.tau * 52 * t) * math.exp(-t / 0.5) * 0.35
        out.append(s * env + deep * env)
    return fade_edges(out, 0.05)


def sound_fire(rng, seconds=3.0):
    n = int(RATE * seconds)
    out = lowpass([rng.uniform(-1, 1) * 0.22 for _ in range(n)], 0.28)
    for _ in range(110):
        start = rng.randrange(0, n - 300)
        length = rng.randint(60, 220)
        amp = rng.uniform(0.35, 1.0)
        for j in range(length):
            if start + j < n:
                out[start + j] += rng.uniform(-1, 1) * amp * math.exp(-j / (length / 4))
    return fade_edges(out, 0.08)


def make_sounds():
    rng = random.Random(20260822)
    out = os.path.join(RP, "sounds", "nd")
    write_wav(os.path.join(out, "wind.wav"), sound_wind(rng))
    write_wav(os.path.join(out, "rumble.wav"), sound_rumble(rng))
    write_wav(os.path.join(out, "whoosh.wav"), sound_whoosh(rng))
    write_wav(os.path.join(out, "wave.wav"), sound_wave(rng))
    write_wav(os.path.join(out, "fire_crackle.wav"), sound_fire(rng))


# --------------------------------------------------------------------------
# Item JSON + atlas + language files (single source of truth: DISASTERS)
# --------------------------------------------------------------------------

def dump_json(path, doc):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(doc, handle, indent=2)
        handle.write("\n")


def make_items():
    for name, (display, cooldown) in DISASTERS.items():
        doc = {
            "format_version": "1.21.0",
            "minecraft:item": {
                "description": {
                    "identifier": f"nd:{name}",
                    "menu_category": {"category": "items"},
                },
                "components": {
                    "minecraft:icon": {"textures": {"default": f"nd_{name}"}},
                    "minecraft:display_name": {"value": display},
                    "minecraft:max_stack_size": 1,
                    "minecraft:glint": True,
                    "minecraft:can_destroy_in_creative": False,
                    "minecraft:cooldown": {
                        "category": f"nd_{name}",
                        "duration": cooldown,
                    },
                    "minecraft:tags": {"tags": ["nd:disaster"]},
                },
            },
        }
        dump_json(os.path.join(BP, "items", f"{name}.json"), doc)


def make_atlas_and_lang():
    atlas = {
        "resource_pack_name": "natural_disasters",
        "texture_name": "atlas.items",
        "texture_data": {
            f"nd_{name}": {"textures": f"textures/items/{name}"}
            for name in DISASTERS
        },
    }
    dump_json(os.path.join(RP, "textures", "item_texture.json"), atlas)

    rp_lang = [
        "pack.name=Natural Disasters RP",
        "pack.description=Visuals, sounds and particles for the Natural Disasters add-on.",
    ]
    for name, (display, _cooldown) in DISASTERS.items():
        rp_lang.append(f"item.nd:{name}={display}")
        rp_lang.append(f"item.nd:{name}.name={display}")
    rp_lang.append("entity.nd:tornado.name=Tornado")

    bp_lang = [
        "pack.name=Natural Disasters BP",
        "pack.description=11 natural disasters as creative items. Hold one and tap a block!",
    ]

    for root, lines in ((RP, rp_lang), (BP, bp_lang)):
        texts = os.path.join(root, "texts")
        os.makedirs(texts, exist_ok=True)
        with open(os.path.join(texts, "en_US.lang"), "w", encoding="utf-8") as handle:
            handle.write("\n".join(lines) + "\n")
        with open(os.path.join(texts, "languages.json"), "w", encoding="utf-8") as handle:
            handle.write('[\n  "en_US"\n]\n')


def main():
    make_item_icons()
    make_pack_icons()
    make_tornado_texture()
    make_particle_sprites()
    make_sounds()
    make_items()
    make_atlas_and_lang()
    print(
        f"Generated {len(DISASTERS)} icons + item JSONs, 2 pack icons, "
        "1 entity texture, 6 particle sprites, 5 sounds, atlas and lang files."
    )


if __name__ == "__main__":
    main()
