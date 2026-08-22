#!/usr/bin/env python3
"""Generate the Bodyguard firearms: geometry, textures and item icons.

Model and texture are produced from one description so their UVs cannot drift
apart - the packer assigns each cube a box-UV rectangle, and the painter fills
exactly those rectangles.

Writes:
  resource_packs/bodyguard_rp/models/entity/bg_guns.geo.json
  resource_packs/bodyguard_rp/textures/entity/bodyguard/sidearm.png
  resource_packs/bodyguard_rp/textures/entity/bodyguard/carbine.png
  resource_packs/bodyguard_rp/textures/entity/bodyguard/bullet.png
  resource_packs/bodyguard_rp/textures/items/bodyguard_sidearm.png
  resource_packs/bodyguard_rp/textures/items/bodyguard_carbine.png

Usage:  python3 tools/gen_guns.py [--preview]
"""

import json
import os
import sys

from gen_bodyguard_art import Image, darken, lighten, mix, preview  # same PNG writer

RP = os.path.join("resource_packs", "bodyguard_rp")
GEO_OUT = os.path.join(RP, "models", "entity", "bg_guns.geo.json")

# --------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------
STEEL = (74, 78, 88, 255)
STEEL_DARK = (42, 45, 52, 255)
POLYMER = (34, 34, 38, 255)
GRIP = (26, 26, 30, 255)
BRASS = (198, 156, 66, 255)
ACCENT = (104, 214, 218, 255)

MATERIALS = {
    "steel": (STEEL, STEEL_DARK),
    "polymer": (POLYMER, darken(POLYMER, 0.35)),
    "grip": (GRIP, darken(GRIP, 0.3)),
    "brass": (BRASS, darken(BRASS, 0.35)),
    "accent": (ACCENT, darken(ACCENT, 0.45)),
}

# --------------------------------------------------------------------------
# Guns.  Built along +Y with the muzzle at the top, matching how vanilla builds
# the trident, so the wield animation only has to tip them forward.
# --------------------------------------------------------------------------
GUNS = {
    "bg_sidearm": {
        "texture": "sidearm",
        "size": 32,
        "cubes": [
            # name        origin              size          material
            ("slide",     (-1.0, 3.0, -1.0),  (2, 6, 2),    "steel"),
            ("muzzle",    (-0.5, 9.0, -0.5),  (1, 1, 1),    "steel"),
            ("frame",     (-1.0, 0.5, -1.0),  (2, 3, 3),    "polymer"),
            ("grip",      (-1.0, -3.5, 0.0),  (2, 4, 2),    "grip"),
            ("guard",     (-0.5, -0.5, -0.5), (1, 1, 2),    "steel"),
        ],
    },
    "bg_carbine": {
        "texture": "carbine",
        "size": 32,
        # Kept to roughly 16 units end to end: any longer and a carbine carried
        # muzzle-down from a hanging arm clips through the ground.
        "cubes": [
            ("barrel",    (-0.5, 5.0, -0.5),  (1, 6, 1),    "steel"),
            ("muzzle",    (-1.0, 10.0, -1.0), (2, 2, 2),    "steel"),
            ("handguard", (-1.0, 2.0, -1.0),  (2, 3, 2),    "polymer"),
            ("receiver",  (-1.0, -1.0, -1.0), (2, 3, 3),    "steel"),
            ("optic",     (-0.5, 2.0, -1.5),  (1, 1, 1),    "accent"),
            ("magazine",  (-1.0, -4.0, -1.0), (2, 3, 2),    "brass"),
            ("grip",      (-1.0, -4.0, 1.0),  (2, 3, 2),    "grip"),
            ("stock",     (-1.0, -2.5, 2.0),  (2, 3, 3),    "polymer"),
        ],
    },
}


def pack(cubes, size):
    """Assign each cube a box-UV rectangle inside a size x size atlas."""
    placed = []
    x = y = row_height = 0
    for name, origin, dims, material in cubes:
        w, h, d = [int(v) for v in dims]
        box_w, box_h = 2 * (d + w), d + h
        if x + box_w > size:
            x, y = 0, y + row_height + 1
            row_height = 0
        if y + box_h > size:
            raise ValueError("gun does not fit in a %dx%d atlas" % (size, size))
        placed.append((name, origin, dims, material, (x, y)))
        x += box_w + 1
        row_height = max(row_height, box_h)
    return placed


def faces(u, v, w, h, d):
    return {
        "top": (u + d, v, w, d),
        "bottom": (u + d + w, v, w, d),
        "right": (u, v + d, d, h),
        "front": (u + d, v + d, w, h),
        "left": (u + d + w, v + d, d, h),
        "back": (u + 2 * d + w, v + d, w, h),
    }


# Per-face brightness, so a flat colour still reads as a solid object.
FACE_SHADE = {"top": 1.20, "bottom": 0.55, "front": 1.0, "back": 0.78, "right": 0.88, "left": 0.94}


def paint(img, placed):
    for name, _origin, dims, material, (u, v) in placed:
        w, h, d = [int(x) for x in dims]
        base, dark = MATERIALS[material]
        for face, (fx, fy, fw, fh) in faces(u, v, w, h, d).items():
            shade = FACE_SHADE[face]
            for row in range(fh):
                t = row / max(1, fh - 1)
                colour = mix(base, dark, t * 0.7)
                colour = (
                    min(255, int(colour[0] * shade)),
                    min(255, int(colour[1] * shade)),
                    min(255, int(colour[2] * shade)),
                    255,
                )
                for col in range(fw):
                    img.set(fx + col, fy + row, colour)
            # A single lit edge along the top of each face.
            for col in range(fw):
                img.set(fx + col, fy, lighten(base, 0.28))
        # Serrations on a slide or handguard, so the metal is not a flat slab.
        if name in ("slide", "handguard", "receiver"):
            fx, fy, fw, fh = faces(u, v, w, h, d)["front"]
            for row in range(1, fh - 1, 2):
                for col in range(fw):
                    img.set(fx + col, fy + row, darken(base, 0.3))
        if name == "grip":
            for face in ("front", "back", "right", "left"):
                fx, fy, fw, fh = faces(u, v, w, h, d)[face]
                for row in range(fh):
                    for col in range(fw):
                        if (row + col) % 2 == 0:
                            img.set(fx + col, fy + row, darken(GRIP, 0.45))


def build_geometry():
    entries = []
    for identifier, gun in GUNS.items():
        placed = pack(gun["cubes"], gun["size"])
        cubes = []
        for _name, origin, dims, _material, (u, v) in placed:
            cubes.append(
                {
                    "origin": [float(origin[0]), float(origin[1]), float(origin[2])],
                    "size": [int(dims[0]), int(dims[1]), int(dims[2])],
                    "uv": [u, v],
                }
            )
        entries.append(
            {
                "description": {
                    "identifier": "geometry." + identifier,
                    "texture_width": gun["size"],
                    "texture_height": gun["size"],
                    "visible_bounds_width": 3,
                    "visible_bounds_height": 3,
                    "visible_bounds_offset": [0, 0.5, 0],
                },
                "bones": [
                    {
                        # Binds to whichever hand actually holds the item, which
                        # is how vanilla's trident does it.
                        "name": "gun",
                        "binding": "q.item_slot_to_bone_name(c.item_slot)",
                        "pivot": [0, 0, 0],
                        "cubes": cubes,
                    }
                ],
            }
        )
        gun["_placed"] = placed
    return {"format_version": "1.16.0", "minecraft:geometry": entries}


# --------------------------------------------------------------------------
# Bullet: a stubby tracer, drawn on its own 16x16 sheet.
# --------------------------------------------------------------------------
BULLET_GEO = {
    "format_version": "1.16.0",
    "minecraft:geometry": [
        {
            "description": {
                "identifier": "geometry.bg_bullet",
                "texture_width": 16,
                "texture_height": 16,
                "visible_bounds_width": 1,
                "visible_bounds_height": 1,
                "visible_bounds_offset": [0, 0, 0],
            },
            "bones": [
                {
                    "name": "bullet",
                    "pivot": [0, 0, 0],
                    "cubes": [
                        {"origin": [-0.5, -0.5, -2.0], "size": [1, 1, 4], "uv": [0, 0]}
                    ],
                }
            ],
        }
    ],
}


def build_bullet_texture():
    img = Image(16, 16)
    core = (255, 236, 178, 255)
    hot = (255, 208, 96, 255)
    tail = (226, 122, 40, 255)
    for face, (fx, fy, fw, fh) in faces(0, 0, 1, 1, 4).items():
        for row in range(fh):
            for col in range(fw):
                t = row / max(1, fh - 1)
                img.set(fx + col, fy + row, mix(core, tail, t) if fh > 1 else hot)
    return img


# --------------------------------------------------------------------------
# Inventory icons
# --------------------------------------------------------------------------
def build_sidearm_icon():
    img = Image(16, 16)
    steel, steel_dark = STEEL, STEEL_DARK
    # slide
    img.rect(3, 4, 10, 3, steel)
    img.rect(3, 4, 10, 1, lighten(steel, 0.3))
    img.rect(3, 6, 10, 1, steel_dark)
    for x in range(9, 13):
        img.set(x, 5, darken(steel, 0.3))
    # muzzle
    img.rect(13, 5, 1, 1, darken(steel, 0.5))
    # frame
    img.rect(3, 7, 8, 2, POLYMER)
    img.rect(3, 7, 8, 1, lighten(POLYMER, 0.2))
    # trigger guard
    img.rect(6, 9, 4, 1, POLYMER)
    img.set(6, 10, POLYMER)
    img.set(9, 10, POLYMER)
    img.rect(7, 10, 2, 1, darken(POLYMER, 0.4))
    # grip
    for row in range(9, 14):
        offset = (row - 9) // 2
        img.rect(3 + offset, row, 3, 1, GRIP)
        img.set(3 + offset, row, lighten(GRIP, 0.25))
    img.set(4, 10, ACCENT)
    return img


def build_carbine_icon():
    img = Image(16, 16)
    # barrel
    img.rect(9, 5, 6, 1, STEEL)
    img.set(14, 5, darken(STEEL, 0.5))
    # handguard
    img.rect(7, 4, 4, 3, POLYMER)
    img.rect(7, 4, 4, 1, lighten(POLYMER, 0.22))
    for x in range(7, 11):
        img.set(x, 5, darken(POLYMER, 0.35))
    # receiver
    img.rect(4, 4, 3, 4, STEEL)
    img.rect(4, 4, 3, 1, lighten(STEEL, 0.3))
    # optic
    img.rect(5, 2, 3, 2, darken(STEEL, 0.35))
    img.set(6, 3, ACCENT)
    # magazine
    img.rect(5, 8, 2, 4, BRASS)
    img.set(5, 8, lighten(BRASS, 0.3))
    img.rect(5, 11, 2, 1, darken(BRASS, 0.4))
    # grip
    img.rect(7, 8, 2, 3, GRIP)
    # stock
    img.rect(1, 5, 3, 3, POLYMER)
    img.rect(1, 5, 3, 1, lighten(POLYMER, 0.2))
    img.rect(3, 4, 1, 4, darken(POLYMER, 0.3))
    return img


def main():
    geometry = build_geometry()
    os.makedirs(os.path.dirname(GEO_OUT), exist_ok=True)
    geometry["minecraft:geometry"].extend(BULLET_GEO["minecraft:geometry"])
    with open(GEO_OUT, "w", encoding="utf-8") as handle:
        json.dump(geometry, handle, indent=2)
        handle.write("\n")

    written = [GEO_OUT]
    for identifier, gun in GUNS.items():
        img = Image(gun["size"], gun["size"])
        paint(img, gun["_placed"])
        path = os.path.join(RP, "textures", "entity", "bodyguard", gun["texture"] + ".png")
        img.save(path)
        written.append(path)

    path = os.path.join(RP, "textures", "entity", "bodyguard", "bullet.png")
    build_bullet_texture().save(path)
    written.append(path)

    for name, builder in (("bodyguard_sidearm", build_sidearm_icon), ("bodyguard_carbine", build_carbine_icon)):
        path = os.path.join(RP, "textures", "items", name + ".png")
        builder().save(path)
        written.append(path)

    for path in written:
        print("wrote %s (%d bytes)" % (path, os.path.getsize(path)))

    if "--preview" in sys.argv:
        print("\n--- sidearm icon ---")
        preview(build_sidearm_icon())
        print("\n--- carbine icon ---")
        preview(build_carbine_icon())


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    main()
