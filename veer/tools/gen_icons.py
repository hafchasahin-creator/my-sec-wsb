#!/usr/bin/env python3
"""Generate VeerPath launcher icons + adaptive-icon layers.

The mark: a bold "V" route whose right stroke escapes as an arrowhead,
drawn on a deep-navy gradient tile with a soft inner glow. Run:

    python3 tools/gen_icons.py
"""
import math
import os

from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), "..", "app", "src", "main", "res")

NAVY_TOP = (18, 26, 62)
NAVY_BOT = (10, 15, 40)
ACCENT = (46, 200, 220)
ACCENT2 = (108, 92, 231)
WHITE = (255, 255, 255)

DENSITIES = {          # folder -> launcher px
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}
FOREGROUND = {         # adaptive foreground layers (108dp box)
    "mipmap-mdpi": 108,
    "mipmap-hdpi": 162,
    "mipmap-xhdpi": 216,
    "mipmap-xxhdpi": 324,
    "mipmap-xxxhdpi": 432,
}


def lerp(a, b, t):
    return tuple(int(x + (y - x) * t) for x, y in zip(a, b))


def gradient(size, top, bot, diagonal=True):
    img = Image.new("RGB", (size, size))
    dr = ImageDraw.Draw(img)
    for i in range(size):
        t = i / max(1, size - 1)
        dr.line([(0, i), (size, i)], fill=lerp(top, bot, t))
    if diagonal:
        # subtle diagonal sheen
        sheen = Image.new("L", (size, size), 0)
        sd = ImageDraw.Draw(sheen)
        sd.polygon([(0, 0), (size, 0), (0, size)], fill=42)
        sheen = sheen.filter(ImageFilter.GaussianBlur(size * 0.18))
        img = Image.composite(Image.new("RGB", (size, size), (255, 255, 255)), img,
                              sheen.point(lambda v: v // 3))
    return img


def draw_mark(img, cx, cy, s, stroke_f=0.135, glow=True):
    """Draw the V-with-escaping-arrowhead mark centred at (cx, cy), span s.

    The right arm stops short so the arrowhead protrudes past it - the mark
    reads as a path that turns and escapes, not just a letter V.
    """
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    dr = ImageDraw.Draw(layer)
    w = s * 0.50
    p0 = (cx - w, cy - s * 0.34)
    p1 = (cx, cy + s * 0.44)
    p2 = (cx + w * 0.74, cy - s * 0.18)
    stroke = s * stroke_f * 2.0

    def seg(a, b, color, width):
        dr.line([a, b], fill=color, width=int(width))
        r = width / 2
        for p in (a, b):
            dr.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=color)

    # gradient along the V by drawing in short bands
    for (a, b, c0, c1) in ((p0, p1, ACCENT, lerp(ACCENT, ACCENT2, 0.5)),
                           (p1, p2, lerp(ACCENT, ACCENT2, 0.5), ACCENT2)):
        steps = 48
        for i in range(steps):
            t0, t1 = i / steps, (i + 1) / steps
            aa = (a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0)
            bb = (a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1)
            seg(aa, bb, lerp(c0, c1, t1) + (255,), stroke)

    # arrowhead at the end of the second stroke, aligned to it
    dx, dy = p2[0] - p1[0], p2[1] - p1[1]
    L = math.hypot(dx, dy)
    ux, uy = dx / L, dy / L
    px, py = -uy, ux
    head_len = s * 0.34
    head_wid = s * 0.50
    tip = (p2[0] + ux * head_len, p2[1] + uy * head_len)
    back = (p2[0] - ux * head_len * 0.06, p2[1] - uy * head_len * 0.06)
    b1 = (back[0] + px * head_wid / 2, back[1] + py * head_wid / 2)
    b2 = (back[0] - px * head_wid / 2, back[1] - py * head_wid / 2)
    notch = (p2[0] + ux * head_len * 0.10, p2[1] + uy * head_len * 0.10)
    dr.polygon([tip, b1, notch, b2], fill=ACCENT2 + (255,))

    if glow:
        g = layer.filter(ImageFilter.GaussianBlur(s * 0.07))
        img.alpha_composite(Image.blend(Image.new("RGBA", img.size, (0, 0, 0, 0)), g, 0.55))
    img.alpha_composite(layer)
    return img


def squircle_mask(size, radius_f=0.235):
    m = Image.new("L", (size * 4, size * 4), 0)
    d = ImageDraw.Draw(m)
    r = int(size * 4 * radius_f)
    d.rounded_rectangle([0, 0, size * 4 - 1, size * 4 - 1], radius=r, fill=255)
    return m.resize((size, size), Image.LANCZOS)


def make_launcher(size, round_icon=False):
    base = gradient(size, NAVY_TOP, NAVY_BOT).convert("RGBA")
    base = draw_mark(base, size * 0.5, size * 0.5, size * 0.56)
    mask = (Image.new("L", (size * 4, size * 4), 0) if round_icon else None)
    if round_icon:
        d = ImageDraw.Draw(mask)
        d.ellipse([0, 0, size * 4 - 1, size * 4 - 1], fill=255)
        mask = mask.resize((size, size), Image.LANCZOS)
    else:
        mask = squircle_mask(size)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(base, (0, 0), mask)
    return out


def make_foreground(size):
    """Adaptive foreground: mark only, inside the 66% safe zone."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    img = draw_mark(img, size * 0.5, size * 0.5, size * 0.40)
    return img


def make_background(size):
    return gradient(size, NAVY_TOP, NAVY_BOT).convert("RGBA")


def main():
    for folder, px in DENSITIES.items():
        d = os.path.join(OUT, folder)
        os.makedirs(d, exist_ok=True)
        make_launcher(px).save(os.path.join(d, "ic_launcher.png"))
        make_launcher(px, round_icon=True).save(os.path.join(d, "ic_launcher_round.png"))
    for folder, px in FOREGROUND.items():
        d = os.path.join(OUT, folder)
        make_foreground(px).save(os.path.join(d, "ic_launcher_foreground.png"))
        make_background(px).save(os.path.join(d, "ic_launcher_background.png"))
    # Play-store / marketing icon
    dist = os.path.join(os.path.dirname(__file__), "..", "dist")
    os.makedirs(dist, exist_ok=True)
    make_launcher(512).save(os.path.join(dist, "playstore_icon_512.png"))
    print("icons written")


if __name__ == "__main__":
    main()
