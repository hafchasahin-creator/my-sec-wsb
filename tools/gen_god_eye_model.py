#!/usr/bin/env python3
"""Generate resource_packs/god_eye_rp/models/entity/god_eye.geo.json.

Bedrock geometry is boxes only, so the eyeball is approximated as a stack of
layers. Each layer is a pair of crossed slabs - one long in X, one long in Z -
whose union is a square with the corners cut off. Stack those with a circular
width profile and the silhouette reads as a sphere from every angle instead of
as a cube.

Two details keep it from flickering:

  * consecutive layers overlap by 0.1, so no two horizontal faces are ever
    coplanar (Minecraft z-fights on exactly-coincident faces);
  * within a layer the Z-slab is inset 0.05 top and bottom, so it hides inside
    the X-slab rather than sharing its caps.

Usage:  python3 tools/gen_god_eye_model.py
"""

import json
import os

OUT = os.path.join(
    "resource_packs", "god_eye_rp", "models", "entity", "god_eye.geo.json"
)

TEXTURE_W = TEXTURE_H = 64

# Texture regions, matching tools/gen_god_eye_textures.py.
SCLERA = ([0, 0], [16, 16])
SHADE = ([16, 0], [16, 16])
IRIS = ([32, 0], [16, 16])
PUPIL = ([48, 0], [16, 16])
VEIN = ([0, 16], [16, 16])
RIM = ([16, 16], [16, 16])
AURA = ([0, 32], [32, 32])
HALO = ([32, 32], [32, 32])

CENTRE_Y = 10.0
OVERLAP = 0.1
INSET = 0.05

# (bottom, top, half-length of the long axis, half-length of the short axis).
# The half-lengths trace a circle of radius 7 around y = 10.
LAYERS = [
    (2.0, 3.0, 2.0, 2.0),
    (3.0, 5.0, 4.0, 3.0),
    (5.0, 8.0, 6.0, 4.0),
    (8.0, 12.0, 7.0, 5.0),
    (12.0, 15.0, 6.0, 4.0),
    (15.0, 17.0, 4.0, 3.0),
    (17.0, 18.0, 2.0, 2.0),
]


def face(region):
    """Stretch a whole texture region across one face."""
    origin, size = region
    return {"uv": list(origin), "uv_size": list(size)}


def tile(region, width, height, shift=0):
    """Sample a region at 1:1 texel density.

    Stretching a 16x16 tile across faces of wildly different sizes makes the
    veins change scale layer by layer and the eyeball look like scrap metal.
    Taking a face-sized window out of the tile instead keeps one texel per
    model unit everywhere, which is how vanilla models are mapped. `shift`
    slides the window so stacked layers do not repeat the same pixels.
    """
    (rx, ry), (rw, rh) = region
    w = min(width, rw)
    h = min(height, rh)
    ox = max(0, min(shift, rw - w))
    oy = max(0, min(shift, rh - h))
    return {"uv": [rx + ox, ry + oy], "uv_size": [round(w, 2), round(h, 2)]}


def faces(size, north, south, east, west, up, down, shift=0):
    sx, sy, sz = size
    return {
        "north": tile(north, sx, sy, shift),
        "south": tile(south, sx, sy, shift),
        "east": tile(east, sz, sy, shift),
        "west": tile(west, sz, sy, shift),
        "up": tile(up, sx, sz, shift),
        "down": tile(down, sx, sz, shift),
    }


def plane(north, south=None):
    out = {"north": face(north), "south": face(south or north)}
    return out


def trim(values):
    """Keep float noise like 3.9999999999999996 out of the shipped JSON."""
    out = []
    for value in values:
        rounded = round(value, 3)
        out.append(int(rounded) if rounded == int(rounded) else rounded)
    return out


def eyeball_cubes():
    cubes = []
    for index, (y0, y1, long_half, short_half) in enumerate(LAYERS):
        top = y1 + (OVERLAP if index < len(LAYERS) - 1 else 0.0)

        # Slab running along X.
        size = trim([long_half * 2, top - y0, short_half * 2])
        cubes.append(
            {
                "origin": trim([-long_half, y0, -short_half]),
                "size": size,
                "uv": faces(size, SCLERA, RIM, VEIN, VEIN, SHADE, RIM, shift=index),
            }
        )

        if long_half == short_half:
            continue  # the caps are square; one slab is enough

        # Slab running along Z, tucked just inside the X slab's caps.
        size = trim([short_half * 2, (top - y0) - INSET * 2, long_half * 2])
        cubes.append(
            {
                "origin": trim([-short_half, y0 + INSET, -long_half]),
                "size": size,
                "uv": faces(size, VEIN, RIM, SCLERA, SCLERA, SHADE, RIM, shift=index + 1),
            }
        )
    return cubes


def build():
    return {
        "format_version": "1.12.0",
        "minecraft:geometry": [
            {
                "description": {
                    "identifier": "geometry.god_eye",
                    "texture_width": TEXTURE_W,
                    "texture_height": TEXTURE_H,
                    "visible_bounds_width": 3,
                    "visible_bounds_height": 3,
                    "visible_bounds_offset": [0, 0.7, 0],
                },
                "bones": [
                    {"name": "root", "pivot": [0, 0, 0]},
                    {
                        "name": "body",
                        "parent": "root",
                        "pivot": [0, CENTRE_Y, 0],
                        "locators": {
                            "aura": [0, CENTRE_Y, 0],
                            "pupil": [0, CENTRE_Y, -8],
                            "crown": [0, 18, 0],
                        },
                    },
                    {
                        "name": "eyeball",
                        "parent": "body",
                        "pivot": [0, CENTRE_Y, 0],
                        "cubes": eyeball_cubes(),
                    },
                    {
                        # Driven by query.target_x_rotation / target_y_rotation,
                        # so the pupil tracks whatever the eye is looking at.
                        "name": "head",
                        "parent": "body",
                        "pivot": [0, CENTRE_Y, 0],
                        "cubes": [
                            {
                                "origin": [-5, 5, -7.6],
                                "size": [10, 10, 0],
                                "uv": plane(IRIS),
                            }
                        ],
                    },
                    {
                        "name": "pupil",
                        "parent": "head",
                        "pivot": [0, CENTRE_Y, -7.9],
                        "cubes": [
                            {
                                "origin": [-3, 7, -7.9],
                                "size": [6, 6, 0],
                                "uv": plane(PUPIL),
                            }
                        ],
                    },
                    {
                        # entity_emissive_alpha: the halo region is drawn full
                        # bright, and everything around it is cut away.
                        "name": "glow",
                        "parent": "head",
                        "pivot": [0, CENTRE_Y, -8.2],
                        "cubes": [
                            {
                                "origin": [-7, 3, -8.2],
                                "size": [14, 14, 0],
                                "uv": plane(HALO),
                            }
                        ],
                    },
                    {
                        "name": "aura",
                        "parent": "body",
                        "pivot": [0, CENTRE_Y, 0],
                        "cubes": [
                            {
                                "origin": [-14, -4, 0],
                                "size": [28, 28, 0],
                                "pivot": [0, CENTRE_Y, 0],
                                "rotation": rotation,
                                "uv": plane(AURA),
                            }
                            for rotation in ([0, 0, 0], [15, 60, 0], [-15, 120, 0])
                        ],
                    },
                ],
            }
        ],
    }


def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump(build(), handle, indent=2)
        handle.write("\n")
    cubes = sum(len(bone.get("cubes", [])) for bone in build()["minecraft:geometry"][0]["bones"])
    print(f"wrote {OUT} ({cubes} cubes)")


if __name__ == "__main__":
    main()
