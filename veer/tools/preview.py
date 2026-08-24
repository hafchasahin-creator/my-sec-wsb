#!/usr/bin/env python3
"""Offline preview renderer - a faithful mirror of the in-game drawing code.

Mirrors com.veergames.veer.ui.ArrowDraw geometry and com.veergames.veer.ui.Skins
colours so board layouts and skins can be reviewed without an emulator.
Keep the constants below in sync with the Kotlin side.
"""
from __future__ import annotations

import math

from PIL import Image, ImageDraw, ImageFilter

# --- geometry, mirrors ArrowDraw ---
STROKE_F = 0.185
HEAD_LEN_F = 0.50
HEAD_WID_F = 0.54
CORNER_F = 0.09
HEAD_BACK_F = 0.24      # barbs sit BEHIND the head anchor
NOTCH_F = -0.07         # swallowtail also behind it
BODY_TRIM_F = 0.0       # shaft runs right to the anchor: head and shaft weld

# --- palettes, mirror Skins.kt ---
SKINS = {
    "classic": {
        "bg": ((255, 255, 255), (242, 245, 252)),
        "dot": (205, 214, 234),
        "tail": (37, 50, 95), "head": (22, 32, 74),
        "glow": None,
    },
    "neon": {
        "bg": ((11, 14, 32), (18, 22, 48)),
        "dot": (48, 60, 104),
        "tail": (0, 245, 212), "head": (0, 180, 255),
        "glow": (0, 220, 255),
    },
    "ice": {
        "bg": ((243, 250, 255), (223, 240, 253)),
        "dot": (176, 205, 228),
        "tail": (108, 190, 235), "head": (44, 122, 196),
        "glow": (150, 220, 255),
    },
    "flame": {
        "bg": ((26, 16, 14), (44, 22, 16)),
        "dot": (92, 60, 46),
        "tail": (255, 196, 72), "head": (255, 92, 36),
        "glow": (255, 140, 40),
    },
}


def _lerp(c1, c2, t):
    return tuple(int(a + (b - a) * t) for a, b in zip(c1, c2))


def _rounded_polyline(dr, pts, width, color, radius):
    if len(pts) < 2:
        return
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        p, c, n = pts[i - 1], pts[i], pts[i + 1]

        def trim(a, b, r):
            dx, dy = b[0] - a[0], b[1] - a[1]
            L = math.hypot(dx, dy) or 1
            r = min(r, L / 2)
            return (a[0] + dx / L * r, a[1] + dy / L * r)

        a = trim(c, p, radius)
        b = trim(c, n, radius)
        out.append(a)
        for k in range(1, 7):
            t = k / 7
            out.append((
                (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0],
                (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]))
        out.append(b)
    out.append(pts[-1])
    dr.line(out, fill=color, width=max(1, int(width)), joint="curve")
    r = width / 2
    for p in (out[0], out[-1]):
        dr.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=color)


def draw_arrow(layer, pts, head_dir, cell, skin, shadow=True):
    s = SKINS[skin]
    stroke = cell * STROKE_F
    head_len = cell * HEAD_LEN_F
    head_wid = cell * HEAD_WID_F
    head_back = head_len * HEAD_BACK_F
    dx, dy = head_dir
    hx, hy = pts[-1]
    body = list(pts[:-1]) + [(hx - dx * head_len * BODY_TRIM_F,
                              hy - dy * head_len * BODY_TRIM_F)]
    dr = ImageDraw.Draw(layer)

    if s["glow"]:
        g = Image.new("RGBA", layer.size, (0, 0, 0, 0))
        gd = ImageDraw.Draw(g)
        _rounded_polyline(gd, body, stroke * 2.6, s["glow"] + (70,), cell * CORNER_F)
        g = g.filter(ImageFilter.GaussianBlur(cell * 0.14))
        layer.alpha_composite(g)
    elif shadow:
        sh = Image.new("RGBA", layer.size, (0, 0, 0, 0))
        _rounded_polyline(ImageDraw.Draw(sh), [(x, y + cell * 0.035) for x, y in body],
                          stroke * 1.04, (16, 27, 58, 24), cell * CORNER_F)
        layer.alpha_composite(sh)

    _rounded_polyline(dr, body, stroke, s["head"] + (255,), cell * CORNER_F)
    n = len(body) - 1
    total = sum(abs(body[i + 1][0] - body[i][0]) + abs(body[i + 1][1] - body[i][1])
                for i in range(n)) or 1
    acc = 0
    for i in range(n):
        a, b = body[i], body[i + 1]
        L = abs(b[0] - a[0]) + abs(b[1] - a[1])
        steps = max(1, int(L / (cell * 0.2)))
        for k in range(steps):
            t0, t1 = k / steps, (k + 1) / steps
            pa = (a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0)
            pb = (a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1)
            dr.line([pa, pb], fill=_lerp(s["tail"], s["head"], (acc + L * t1) / total) + (255,),
                    width=max(1, int(stroke)))
        acc += L
    for i, p in enumerate(body):
        t = sum(abs(body[j + 1][0] - body[j][0]) + abs(body[j + 1][1] - body[j][1])
                for j in range(i)) / total
        c = _lerp(s["tail"], s["head"], t)
        r = stroke / 2
        dr.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=c + (255,))

    px, py = -dy, dx
    tip = (hx + dx * head_len, hy + dy * head_len)
    p1 = (hx - dx * head_back + px * head_wid / 2, hy - dy * head_back + py * head_wid / 2)
    notch = (hx + dx * head_len * NOTCH_F, hy + dy * head_len * NOTCH_F)
    p2 = (hx - dx * head_back - px * head_wid / 2, hy - dy * head_back - py * head_wid / 2)
    dr.polygon([tip, p1, notch, p2], fill=s["head"] + (255,))


def render_level(level, path, cell=None, skin="classic", phone=(1080, 2050)):
    """Render a level roughly as the phone would lay it out."""
    s = SKINS[skin]
    W, H = phone
    header = int(H * 0.13)
    footer = int(H * 0.12)
    avail_w = W - int(W * 0.07) * 2
    avail_h = H - header - footer
    if cell is None:
        cell = min(avail_w / (level.cols - 1 + 1.35), avail_h / (level.rows - 1 + 1.35))
    bw = (level.cols - 1) * cell
    bh = (level.rows - 1) * cell
    ox = (W - bw) / 2
    oy = header + (avail_h - bh) / 2

    img = Image.new("RGBA", (W, H))
    dr = ImageDraw.Draw(img)
    for y in range(H):
        dr.line([(0, y), (W, y)], fill=_lerp(s["bg"][0], s["bg"][1], y / H) + (255,))

    def P(p):
        return (ox + p[0] * cell, oy + p[1] * cell)

    r = max(1.5, cell * 0.052)
    for gx in range(level.cols):
        for gy in range(level.rows):
            x, y = P((gx, gy))
            dr.ellipse([x - r, y - r, x + r, y + r], fill=s["dot"] + (255,))

    for a in level.arrows:
        draw_arrow(img, [P(p) for p in a.pts], a.head_dir, cell, skin)

    img.convert("RGB").save(path)
    return path
