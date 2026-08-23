#!/usr/bin/env python3
"""Generate all Magical Swords textures.

- 32x32 item icons (one per sword)
- 64x64 attachable body textures, painted per cube face using the exact UV
  boxes produced by tools/gen_ms_rp.py (handle / guard / blade roles)
- 64x64 horizontally-tileable emissive "energy" sheets (safe to UV-scroll)
- particle sprites (flame flipbook, glow, star, snowflake, spark, shard,
  rune, slash streak)
- 256x256 pack icons for both packs

Usage:  python3 tools/gen_ms_textures.py
"""

import math
import os
import random
import sys

from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_ms_rp import SWORDS, geometry_for  # noqa: E402

RP = os.path.join("resource_packs", "magical_swords_rp")
BP = os.path.join("behavior_packs", "magical_swords_bp")

random.seed(21026)  # deterministic output for reproducible builds

PALETTES = {
    # role -> (dark, mid, light) ; energy -> gradient stops ; icon accents
    "inferno": {
        "handle": ((38, 16, 10), (66, 28, 16), (94, 44, 24)),
        "guard": ((70, 26, 8), (128, 52, 16), (190, 92, 28)),
        "blade": ((70, 22, 12), (150, 52, 22), (235, 120, 40)),
        "edge": (255, 216, 120),
        "energy": [(120, 10, 0), (220, 60, 0), (255, 150, 20), (255, 230, 120)],
        "icon_glow": (255, 140, 40),
    },
    "frost": {
        "handle": ((22, 34, 52), (36, 56, 84), (56, 84, 120)),
        "guard": ((60, 110, 150), (110, 170, 210), (170, 220, 245)),
        "blade": ((70, 130, 180), (130, 195, 235), (200, 240, 255)),
        "edge": (240, 252, 255),
        "energy": [(20, 70, 130), (60, 140, 210), (140, 220, 250), (235, 250, 255)],
        "icon_glow": (150, 220, 255),
    },
    "thunder": {
        "handle": ((40, 30, 14), (70, 52, 22), (104, 78, 34)),
        "guard": ((120, 78, 22), (188, 130, 40), (240, 186, 70)),
        "blade": ((90, 80, 30), (170, 155, 60), (240, 225, 110)),
        "edge": (255, 255, 190),
        "energy": [(90, 70, 0), (200, 170, 10), (255, 240, 90), (255, 255, 210)],
        "icon_glow": (255, 240, 110),
    },
    "void": {
        "handle": ((16, 8, 24), (30, 16, 44), (48, 28, 66)),
        "guard": ((40, 18, 62), (74, 34, 108), (112, 58, 152)),
        "blade": ((22, 10, 34), (52, 24, 78), (96, 48, 132)),
        "edge": (210, 140, 255),
        "energy": [(20, 0, 40), (80, 20, 130), (150, 60, 220), (230, 170, 255)],
        "icon_glow": (170, 90, 240),
    },
    "celestial": {
        "handle": ((44, 36, 20), (84, 68, 34), (128, 106, 52)),
        "guard": ((150, 120, 40), (210, 175, 70), (250, 225, 130)),
        "blade": ((160, 150, 120), (225, 215, 170), (255, 250, 225)),
        "edge": (255, 255, 240),
        "energy": [(120, 80, 20), (230, 180, 60), (255, 240, 160), (255, 255, 255)],
        "icon_glow": (255, 240, 170),
    },
}


def out(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    return path


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))


def gradient_sample(stops, t):
    t = max(0.0, min(1.0, t))
    n = len(stops) - 1
    idx = min(int(t * n), n - 1)
    local = t * n - idx
    return lerp(stops[idx], stops[idx + 1], local)


# --------------------------------------------------------------------------
# Attachable body textures (painted per UV face)
# --------------------------------------------------------------------------

FACE_LAYOUT = (
    # name, ux, uy (relative to box), width key, height key
    ("right", lambda w, h, d: (0, d, d, h), 0.72),
    ("front", lambda w, h, d: (d, d, w, h), 1.0),
    ("left", lambda w, h, d: (d + w, d, d, h), 0.72),
    ("back", lambda w, h, d: (2 * d + w, d, w, h), 0.92),
    ("top", lambda w, h, d: (d, 0, w, d), 0.85),
    ("bottom", lambda w, h, d: (d + w, 0, w, d), 0.6),
)


def paint_face(px, x0, y0, fw, fh, role, pal, shade):
    dark, mid, light = pal[role]
    for yy in range(fh):
        t = yy / max(1, fh - 1)
        for xx in range(fw):
            u = xx / max(1, fw - 1) if fw > 1 else 0.5
            base = lerp(light, dark, t)
            # subtle centre highlight for blades, banding for handles
            if role == "blade":
                centre = 1.0 - abs(u - 0.5) * 2
                if centre > 0.6:
                    base = lerp(base, pal["edge"], 0.55 * (centre - 0.6) / 0.4)
                if xx in (0, fw - 1):
                    base = lerp(base, dark, 0.55)
            elif role == "handle":
                if (yy // 2) % 2 == 0:
                    base = lerp(base, dark, 0.35)
            elif role == "guard":
                if yy in (0, fh - 1) or xx in (0, fw - 1):
                    base = lerp(base, light, 0.35)
            noise = random.uniform(-0.06, 0.06)
            base = tuple(max(0, min(255, int(c * (shade + noise)))) for c in base)
            px[x0 + xx, y0 + yy] = (*base, 255)


def body_texture(key):
    geo = geometry_for(key, SWORDS[key])["minecraft:geometry"][0]
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    px = img.load()
    role_of = {"handle": "handle", "guard": "guard", "blade": "blade"}
    for bone in geo["bones"]:
        role = role_of.get(bone["name"])
        if role is None:
            continue  # energy + orbitals sample the dedicated energy sheet
        for c in bone.get("cubes", []):
            w = max(1, int(round(c["size"][0])))
            h = max(1, int(round(c["size"][1])))
            d = max(1, int(round(c["size"][2])))
            u, v = int(c["uv"][0]), int(c["uv"][1])
            for _name, rect, shade in FACE_LAYOUT:
                fx, fy, fw, fh = rect(w, h, d)
                if fw <= 0 or fh <= 0:
                    continue
                paint_face(px, u + fx, v + fy, fw, fh, role, PALETTES[key], shade)
    img.save(out(os.path.join(RP, "textures", "attachables", f"{key}_sword.png")))


def energy_texture(key):
    stops = PALETTES[key]["energy"]
    img = Image.new("RGBA", (64, 64))
    px = img.load()
    # Horizontally tileable value-noise bands: sum of sines with integer
    # frequencies is periodic over the width by construction.
    for y in range(64):
        phase = random.uniform(0, math.tau)
        f1, f2 = random.choice([1, 2, 3]), random.choice([3, 4, 5])
        amp = random.uniform(0.25, 0.45)
        for x in range(64):
            a = math.tau * x / 64
            v = 0.55 + amp * math.sin(f1 * a + phase) + (amp * 0.6) * math.sin(f2 * a + phase * 1.7)
            v += 0.1 * math.sin(math.tau * y / 16 + phase)
            colour = gradient_sample(stops, v)
            px[x, y] = (*colour, 255)
    if key == "thunder":
        # zig-zag bolt streaks, kept periodic in x
        for _ in range(6):
            yy = random.randint(2, 61)
            xx = random.randint(0, 63)
            for step in range(24):
                px[(xx + step) % 64, max(0, min(63, yy + random.randint(-1, 1)))] = (255, 255, 220, 255)
                yy += random.choice([-1, 0, 1])
    if key == "celestial":
        for _ in range(40):
            px[random.randint(0, 63), random.randint(0, 63)] = (255, 255, 255, 255)
    img.save(out(os.path.join(RP, "textures", "attachables", f"{key}_energy.png")))


# --------------------------------------------------------------------------
# Item icons (32x32 pixel art, diagonal blade)
# --------------------------------------------------------------------------

def icon(key):
    pal = PALETTES[key]
    img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    px = img.load()

    def put(x, y, colour, alpha=255):
        if 0 <= x < 32 and 0 <= y < 32:
            px[x, y] = (*colour, alpha)

    dark, mid, light = pal["blade"]
    hd, hm, hl = pal["handle"]
    gd, gm, gl = pal["guard"]
    edge = pal["edge"]

    # Blade along the anti-diagonal: from (8, 23) up to (26, 5)
    for i in range(19):
        x = 8 + i
        y = 23 - i
        wobble = 0
        if key == "inferno":
            wobble = 1 if i % 4 in (1, 2) else 0
        if key == "thunder":
            wobble = 1 if i % 5 in (2, 3) else 0
        if key == "void":
            wobble = i // 7
        # blade body: 3px thick across the diagonal
        put(x - 1 + wobble, y - 1, dark)
        put(x + wobble, y - 1, light)
        put(x - 1 + wobble, y, mid)
        put(x + wobble, y, light if i % 3 else edge)
        put(x + 1 + wobble, y, edge)
        put(x + wobble, y + 1, dark)
    # tip sparkle
    put(27, 4, edge)
    put(26, 4, light)
    put(27, 5, light)

    # crossguard perpendicular to the blade at (10, 21)
    for k in range(-3, 4):
        put(10 + k, 21 + k, gm if abs(k) < 3 else gd)
        put(11 + k, 21 + k, gl if abs(k) < 2 else gm)
        put(9 + k, 21 + k, gd)

    # grip down-left from the guard
    for i in range(1, 7):
        put(9 - i, 22 + i, hm if i % 2 else hd)
        put(10 - i, 22 + i, hl if i % 2 else hm)
    put(3, 29, gl)
    put(2, 29, gm)
    put(3, 30, gm)
    put(2, 30, gd)

    # themed glow pixels around the blade
    glow = pal["icon_glow"]
    sparks = {
        "inferno": [(12, 15), (17, 12), (22, 10), (15, 20)],
        "frost": [(13, 14), (19, 10), (23, 12), (11, 19)],
        "thunder": [(14, 13), (20, 12), (24, 7), (12, 18)],
        "void": [(13, 13), (18, 14), (23, 9), (10, 17)],
        "celestial": [(12, 14), (17, 9), (23, 11), (14, 19), (25, 15)],
    }[key]
    for sx, sy in sparks:
        put(sx, sy, glow, 220)
        put(sx + 1, sy, glow, 120)
        put(sx - 1, sy, glow, 120)
        put(sx, sy + 1, glow, 120)
        put(sx, sy - 1, glow, 120)
    if key == "celestial":
        for sx, sy in [(6, 6), (28, 20), (7, 25)]:
            put(sx, sy, (255, 255, 255), 230)
            put(sx + 1, sy, (255, 255, 255), 90)
            put(sx - 1, sy, (255, 255, 255), 90)
            put(sx, sy + 1, (255, 255, 255), 90)
            put(sx, sy - 1, (255, 255, 255), 90)

    img.save(out(os.path.join(RP, "textures", "items", f"{key}_sword.png")))


# --------------------------------------------------------------------------
# Particle sprites
# --------------------------------------------------------------------------

def sprite_glow():
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    px = img.load()
    for y in range(16):
        for x in range(16):
            d = math.hypot(x - 7.5, y - 7.5) / 7.5
            a = max(0.0, 1.0 - d)
            px[x, y] = (255, 255, 255, int(255 * a * a))
    img.save(out(os.path.join(RP, "textures", "particle", "msword_glow.png")))


def sprite_star():
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    px = img.load()
    for y in range(16):
        for x in range(16):
            dx, dy = abs(x - 7.5), abs(y - 7.5)
            v = max(0.0, 1.0 - (dx + dy * 6) / 9) + max(0.0, 1.0 - (dy + dx * 6) / 9)
            v = min(1.0, v)
            core = max(0.0, 1.0 - math.hypot(x - 7.5, y - 7.5) / 3.0)
            a = min(1.0, v + core)
            px[x, y] = (255, 255, 255, int(255 * a))
    img.save(out(os.path.join(RP, "textures", "particle", "msword_star.png")))


def sprite_snow():
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    c = 7.5
    for k in range(6):
        ang = math.tau * k / 6
        x2, y2 = c + 6.5 * math.cos(ang), c + 6.5 * math.sin(ang)
        draw.line([(c, c), (x2, y2)], fill=(255, 255, 255, 255), width=1)
        # side branches
        bx, by = c + 4 * math.cos(ang), c + 4 * math.sin(ang)
        for s in (-1, 1):
            a2 = ang + s * math.tau / 12
            draw.line([(bx, by), (bx + 2.2 * math.cos(a2), by + 2.2 * math.sin(a2))],
                      fill=(255, 255, 255, 210), width=1)
    img.save(out(os.path.join(RP, "textures", "particle", "msword_snow.png")))


def sprite_spark():
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    points = [(2, 3), (7, 6), (5, 9), (12, 8), (9, 12), (14, 13)]
    draw.line(points, fill=(255, 255, 255, 255), width=1)
    draw.line([(3, 12), (7, 9), (11, 4)], fill=(255, 255, 255, 160), width=1)
    img = img.filter(ImageFilter.GaussianBlur(0.4))
    img.save(out(os.path.join(RP, "textures", "particle", "msword_spark.png")))


def sprite_shard():
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.polygon([(8, 1), (11, 9), (8, 15), (5, 9)], fill=(255, 255, 255, 235))
    draw.line([(8, 1), (8, 15)], fill=(255, 255, 255, 255), width=1)
    draw.polygon([(3, 5), (5, 8), (3, 11), (1, 8)], fill=(255, 255, 255, 150))
    draw.polygon([(13, 5), (15, 8), (13, 11), (11, 8)], fill=(255, 255, 255, 150))
    img.save(out(os.path.join(RP, "textures", "particle", "msword_shard.png")))


def sprite_rune():
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.line([(4, 2), (12, 2), (6, 8), (12, 8), (4, 14)], fill=(255, 255, 255, 255), width=1)
    draw.line([(8, 4), (8, 12)], fill=(255, 255, 255, 140), width=1)
    img.save(out(os.path.join(RP, "textures", "particle", "msword_rune.png")))


def sprite_slash():
    img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    px = img.load()
    for y in range(32):
        for x in range(32):
            ang = math.atan2(y - 15.5, x - 15.5)
            r = math.hypot(x - 15.5, y - 15.5)
            band = max(0.0, 1.0 - abs(r - 11) / 4.5)
            arc = max(0.0, math.cos(ang))  # right-side crescent
            a = band * arc
            px[x, y] = (255, 255, 255, int(255 * min(1.0, a * 1.4)))
    img.save(out(os.path.join(RP, "textures", "particle", "msword_slash.png")))


def sprite_flame():
    # 8-frame vertical flipbook, 16x16 each -> 16x128
    img = Image.new("RGBA", (16, 128), (0, 0, 0, 0))
    px = img.load()
    for frame in range(8):
        t = frame / 7.0
        oy = frame * 16
        height = 11 - int(3 * t)
        sway = math.sin(t * math.tau) * 1.5
        for y in range(16):
            for x in range(16):
                fy = 13 - y  # flame grows upward from y=13
                if fy < 0 or fy > height:
                    continue
                centre = 7.5 + sway * (fy / max(1, height))
                width = 4.2 * (1.0 - fy / (height + 1)) + 0.6
                d = abs(x - centre) / width
                if d > 1:
                    continue
                heat = (1.0 - d) * (1.0 - 0.55 * fy / (height + 1))
                if heat > 0.72:
                    colour = (255, 240, 170)
                elif heat > 0.45:
                    colour = (255, 160, 40)
                else:
                    colour = (220, 70, 10)
                alpha = int(255 * min(1.0, heat * 1.8) * (1.0 - 0.35 * t))
                px[x, oy + y] = (*colour, alpha)
    img.save(out(os.path.join(RP, "textures", "particle", "msword_flame.png")))


# --------------------------------------------------------------------------
# Pack icons
# --------------------------------------------------------------------------

def pack_icon():
    size = 256
    img = Image.new("RGBA", (size, size), (16, 12, 30, 255))
    px = img.load()
    for y in range(size):
        for x in range(size):
            d = math.hypot(x - 128, y - 128) / 181.0
            base = lerp((44, 30, 70), (14, 10, 26), d)
            px[x, y] = (*base, 255)
    draw = ImageDraw.Draw(img)
    for i in range(90):
        sx, sy = random.randint(0, 255), random.randint(0, 255)
        a = random.randint(60, 200)
        draw.point((sx, sy), fill=(255, 255, 255, a))
    colours = [PALETTES[k]["icon_glow"] for k in ("inferno", "frost", "thunder", "void", "celestial")]
    # fan of five glowing blades
    for i, colour in enumerate(colours):
        ang = math.radians(-90 + (i - 2) * 22)
        x0, y0 = 128, 208
        x1 = x0 + 150 * math.cos(ang)
        y1 = y0 + 150 * math.sin(ang)
        for wobble, alpha, width in ((0, 255, 7), (0, 130, 13)):
            draw.line([(x0, y0), (x1, y1)], fill=(*colour, alpha), width=width)
        draw.line([(x0, y0), (x0 + 40 * math.cos(ang), y0 + 40 * math.sin(ang))],
                  fill=(40, 30, 24, 255), width=9)
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    img.save(out(os.path.join(RP, "pack_icon.png")))
    img.save(out(os.path.join(BP, "pack_icon.png")))


def main():
    for key in SWORDS:
        body_texture(key)
        energy_texture(key)
        icon(key)
    sprite_glow()
    sprite_star()
    sprite_snow()
    sprite_spark()
    sprite_shard()
    sprite_rune()
    sprite_slash()
    sprite_flame()
    pack_icon()
    print("textures generated.")


if __name__ == "__main__":
    main()
