#!/usr/bin/env python3
"""Generate every texture the Tiny Parasite add-on needs.

Pure standard library, same approach as the other packs in this repo: RGBA
PNGs are written by hand so the art rebuilds anywhere. Everything is drawn
from scratch, so no vanilla or third-party art ends up in the pack.

Outputs
    resource_packs/Tiny_Parasite_RP/textures/entity/parasite.png       (32x32)
    resource_packs/Tiny_Parasite_RP/textures/items/tp_parasite_serum.png
    resource_packs/Tiny_Parasite_RP/textures/items/tp_parasite_spawn_egg.png
    behavior_packs/Tiny_Parasite_BP/pack_icon.png                      (64x64)
    resource_packs/Tiny_Parasite_RP/pack_icon.png                      (64x64)

Usage:  python3 tools/gen_parasite_textures.py
"""

import os
import sys

# The canvas and PNG plumbing is shared with the Builder Buddy generator.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_builder_buddy_textures import (  # noqa: E402
    Canvas,
    box_faces,
    fill_box,
    outline_alpha,
    shade,
    texture_noise,
)

BP = os.path.join("behavior_packs", "Tiny_Parasite_BP")
RP = os.path.join("resource_packs", "Tiny_Parasite_RP")


# --------------------------------------------------------------------------
# Palette - something sickly and clearly not friendly
# --------------------------------------------------------------------------

FLESH = (128, 74, 142, 255)
FLESH_DK = (92, 50, 104, 255)
FLESH_LT = (162, 104, 176, 255)
BELLY = (176, 206, 128, 255)
BELLY_DK = (132, 164, 92, 255)
VEIN = (196, 76, 112, 255)
EYE = (240, 62, 62, 255)
EYE_DK = (150, 28, 28, 255)
FANG = (232, 226, 208, 255)
FANG_DK = (176, 168, 150, 255)
GLASS = (150, 196, 214, 255)
SERUM = (128, 232, 168, 255)
SERUM_DK = (58, 168, 108, 255)
CORK = (150, 110, 66, 255)


def draw_parasite():
    """32x32 skin: violet carapace, pale belly, red eyes, bone mandibles."""
    c = Canvas(32, 32)

    # ---- body: 6 wide, 4 tall, 8 long ----
    body = box_faces(0, 0, 6, 4, 8)
    fill_box(c, body, FLESH, top=FLESH_LT, bottom=BELLY)
    texture_noise(c, body, -12, 3)

    # Spine ridge down the back.
    x, y, w, h = body["up"]
    c.rect(x + 2, y, 2, h, FLESH_DK)
    for i in range(1, h, 2):
        c.rect(x + 2, y + i, 2, 1, VEIN)

    # Veins along the flanks.
    for name in ("east", "west"):
        x, y, w, h = body[name]
        for i in range(1, w, 3):
            c.rect(x + i, y + 1, 1, h - 2, shade(FLESH, -26))

    # Pale segmented belly.
    x, y, w, h = body["down"]
    for i in range(0, h, 2):
        c.rect(x, y + i, w, 1, BELLY_DK)

    # ---- head: mandibles and a pair of eyes ----
    head = box_faces(0, 14, 5, 3, 3)
    fill_box(c, head, FLESH, top=FLESH_LT, bottom=BELLY)
    hx, hy, hw, hh = head["north"]
    c.rect(hx + 1, hy + 1, 1, 1, EYE)
    c.rect(hx + 3, hy + 1, 1, 1, EYE)
    c.set(hx + 1, hy + 2, EYE_DK)
    c.set(hx + 3, hy + 2, EYE_DK)
    c.rect(hx, hy + 2, 1, 1, FANG)
    c.rect(hx + 4, hy + 2, 1, 1, FANG)

    # ---- tail ----
    tail = box_faces(18, 14, 2, 2, 4)
    fill_box(c, tail, FLESH_DK, top=FLESH, bottom=BELLY_DK)
    x, y, w, h = tail["up"]
    for i in range(0, h, 2):
        c.rect(x, y + i, w, 1, VEIN)

    # ---- one leg texture, reused by all six legs ----
    leg = box_faces(0, 22, 1, 3, 1)
    fill_box(c, leg, FLESH_DK, top=FLESH, bottom=(40, 24, 48, 255))

    # ---- one mandible texture, reused by both ----
    mand = box_faces(6, 22, 1, 1, 2)
    fill_box(c, mand, FANG, top=FANG, bottom=FANG_DK)

    return c


def draw_serum():
    """A corked vial of glowing green antiparasitic serum."""
    c = Canvas(16, 16)

    # Cork and neck.
    c.rect(6, 1, 4, 2, CORK)
    c.rect(6, 0, 4, 1, shade(CORK, 30))
    c.rect(6, 3, 4, 2, GLASS)

    # Flask body.
    widths = [0, 0, 0, 0, 0, 2, 3, 4, 5, 5, 5, 5, 5, 4, 3, 0]
    for y, half in enumerate(widths):
        if not half:
            continue
        c.rect(8 - half, y, half * 2, 1, GLASS)

    # Liquid fills the lower two thirds.
    for y in range(9, 15):
        for x in range(16):
            if c.get(x, y)[3]:
                c.set(x, y, SERUM if (x + y) % 3 else SERUM_DK)
    c.rect(4, 9, 8, 1, shade(SERUM, 40))

    # Highlight on the glass.
    c.rect(5, 6, 1, 3, shade(GLASS, 55))

    outline_alpha(c, (28, 34, 40, 255))
    return c


def draw_spawn_egg():
    """Egg in the parasite's violet, speckled with sickly green."""
    c = Canvas(16, 16)
    widths = [0, 2, 3, 4, 4, 5, 5, 5, 5, 5, 5, 4, 4, 3, 2, 0]
    for y, half in enumerate(widths):
        if not half:
            continue
        c.rect(8 - half, y, half * 2, 1, FLESH)

    for y in range(16):
        for x in range(16):
            if not c.get(x, y)[3]:
                continue
            if x - y < -4:
                c.set(x, y, FLESH_LT)
            elif x - y > 4:
                c.set(x, y, FLESH_DK)

    for x, y in ((5, 4), (9, 3), (7, 7), (10, 8), (4, 9), (8, 11), (6, 12), (11, 6)):
        c.set(x, y, BELLY)
        c.set(x + 1, y, BELLY_DK)

    outline_alpha(c, (44, 22, 52, 255))
    return c


def draw_pack_icon():
    """The parasite curled up, seen from above, on a dark biohazard plate."""
    c = Canvas(16, 16, (28, 20, 34, 255))

    # Faint hazard ring.
    for x in range(16):
        for y in range(16):
            d = (x - 7.5) ** 2 + (y - 7.5) ** 2
            if 34 < d < 46:
                c.set(x, y, (54, 38, 62, 255))

    # Body and tail curled to one side.
    c.rect(5, 6, 6, 5, FLESH)
    c.rect(5, 6, 6, 1, FLESH_LT)
    c.rect(6, 8, 4, 1, FLESH_DK)
    c.rect(10, 10, 3, 1, FLESH_DK)
    c.rect(12, 9, 1, 2, FLESH_DK)

    # Head with two red eyes.
    c.rect(6, 3, 4, 3, FLESH)
    c.set(6, 4, EYE)
    c.set(9, 4, EYE)
    c.set(5, 3, FANG)
    c.set(10, 3, FANG)

    # Legs.
    for y in (7, 9):
        c.rect(3, y, 2, 1, FLESH_DK)
        c.rect(11, y, 2, 1, FLESH_DK)

    return c.scaled(4)


def main():
    items = os.path.join(RP, "textures", "items")

    draw_parasite().write(os.path.join(RP, "textures", "entity", "parasite.png"))
    draw_serum().write(os.path.join(items, "tp_parasite_serum.png"))
    draw_spawn_egg().write(os.path.join(items, "tp_parasite_spawn_egg.png"))

    icon = draw_pack_icon()
    icon.write(os.path.join(BP, "pack_icon.png"))
    icon.write(os.path.join(RP, "pack_icon.png"))

    print("Wrote 1 skin, 2 item icons and 2 pack icons.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
