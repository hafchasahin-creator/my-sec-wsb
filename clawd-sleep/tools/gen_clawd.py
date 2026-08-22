#!/usr/bin/env python3
"""Render Clawd from the pixel grid into every asset the two apps need.

    python3 tools/gen_clawd.py

Outputs
    assets/clawd/clawd.png              384x256 reference sprite
    assets/clawd/clawd@2x.png           768x512
    assets/clawd/layers/<name>.png      one PNG per animation layer, all 384x256
                                        so they composite with a plain (0,0) draw
    assets/clawd/clawd.grid.json        the grid, for the web renderer
    web/icons/icon-*.png                launcher / PWA icons
    android/app/src/main/res/...        mipmap + drawable assets

Everything is nearest-neighbour, so the pixels stay hard at any scale.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image, ImageDraw
import clawd_spec as S

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def blank(w=S.WIDTH, h=S.HEIGHT):
    return Image.new("RGBA", (w, h), S.CLEAR)


def paint(img, cells, colour, cell=S.CELL):
    d = ImageDraw.Draw(img)
    for (c, r) in cells:
        x0, y0 = c * cell, r * cell
        d.rectangle([x0, y0, x0 + cell - 1, y0 + cell - 1], fill=colour)
    return img


def full_sprite(cell=S.CELL):
    img = Image.new("RGBA", (S.COLS * cell, S.ROWS * cell), S.CLEAR)
    paint(img, S.body_cells(), S.CORAL, cell)
    paint(img, S.arm_cells("L"), S.CORAL, cell)
    paint(img, S.arm_cells("R"), S.CORAL, cell)
    paint(img, S.leg_cells(), S.CORAL, cell)
    paint(img, [S.eye_cell("L"), S.eye_cell("R")], S.EYE, cell)
    return img


def layer_sprites():
    out = {}
    for name, (cells, _px, _py) in S.LAYERS.items():
        colour = S.EYE if name.startswith("eye") else S.CORAL
        out[name] = paint(blank(), cells, colour)
    # a closed eye: the 32px block collapses to an 8px bar sitting on the
    # block's lower third, which is what a shut pixel eye reads as.
    for side in ("L", "R"):
        c, r = S.eye_cell(side)
        img = blank()
        d = ImageDraw.Draw(img)
        x0 = c * S.CELL
        y0 = r * S.CELL + int(S.CELL * 0.625)
        d.rectangle([x0, y0, x0 + S.CELL - 1, y0 + int(S.CELL * 0.25) - 1], fill=S.EYE)
        out["eye%s_closed" % side] = img
    return out


def verify(sprite, layers):
    """Composited layers must be pixel-identical to the single-pass sprite."""
    comp = blank()
    for name in ("body", "armL", "armR", "legs", "eyeL", "eyeR"):
        comp = Image.alpha_composite(comp, layers[name])
    if list(comp.getdata()) != list(sprite.getdata()):
        raise SystemExit("FAIL: layer composite != reference sprite")
    print("  verified: layers composite pixel-identical to reference")


def icon(size, bg=(8, 10, 18, 255), pad=0.14):
    """Square launcher icon: Clawd on the app's night background."""
    img = Image.new("RGBA", (size, size), bg)
    inner = int(size * (1 - pad * 2))
    scale = max(1, inner // S.COLS)
    sp = full_sprite(scale)
    img.paste(sp, ((size - sp.width) // 2, (size - sp.height) // 2), sp)
    return img


def write(img, *parts):
    path = os.path.join(ROOT, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)
    print("  %-58s %dx%d" % (os.path.relpath(path, ROOT), img.width, img.height))


def main():
    print("clawd assets")
    sprite = full_sprite()
    layers = layer_sprites()
    verify(sprite, layers)

    write(sprite, "assets", "clawd", "clawd.png")
    write(full_sprite(64), "assets", "clawd", "clawd@2x.png")
    for name, img in sorted(layers.items()):
        write(img, "assets", "clawd", "layers", "%s.png" % name)

    grid = {
        "cols": S.COLS, "rows": S.ROWS, "cell": S.CELL,
        "width": S.WIDTH, "height": S.HEIGHT,
        "coral": "#%02X%02X%02X" % S.CORAL[:3],
        "eye": "#%02X%02X%02X" % S.EYE[:3],
        "layers": {
            name: {
                "cells": [[c, r] for (c, r) in cells],
                "pivot": [px, py],
                "colour": "eye" if name.startswith("eye") else "coral",
            }
            for name, (cells, px, py) in S.LAYERS.items()
        },
    }
    for target in (("web", "src", "clawd.grid.json"), ("assets", "clawd", "clawd.grid.json")):
        p = os.path.join(ROOT, *target)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w") as f:
            json.dump(grid, f, indent=2)
        print("  %-58s grid" % os.path.relpath(p, ROOT))

    # PWA + favicon
    for s in (192, 512):
        write(icon(s), "web", "icons", "icon-%d.png" % s)
    write(icon(180), "web", "icons", "apple-touch-icon.png")
    write(icon(32, pad=0.06), "web", "icons", "favicon-32.png")

    # Android launcher: legacy mipmaps + adaptive foreground (needs 33% safe-zone padding)
    res = ("android", "app", "src", "main", "res")
    for folder, px in (("mipmap-mdpi", 48), ("mipmap-hdpi", 72), ("mipmap-xhdpi", 96),
                       ("mipmap-xxhdpi", 144), ("mipmap-xxxhdpi", 192)):
        write(icon(px), *res, folder, "ic_launcher.png")
        write(icon(px), *res, folder, "ic_launcher_round.png")
    for folder, px in (("drawable-mdpi", 108), ("drawable-hdpi", 162), ("drawable-xhdpi", 216),
                       ("drawable-xxhdpi", 324), ("drawable-xxxhdpi", 432)):
        fg = Image.new("RGBA", (px, px), S.CLEAR)
        scale = max(1, int(px * 0.46) // S.COLS)
        sp = full_sprite(scale)
        fg.paste(sp, ((px - sp.width) // 2, (px - sp.height) // 2), sp)
        write(fg, *res, folder, "ic_launcher_foreground.png")

    # The sprite itself, for Compose to load as an ImageBitmap fallback.
    write(full_sprite(64), *res, "drawable-nodpi", "clawd.png")
    print("done")


if __name__ == "__main__":
    main()
