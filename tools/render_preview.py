#!/usr/bin/env python3
"""Render the fungus block models to a PNG contact sheet.

    python3 tools/render_preview.py [--out preview.png] [--cell 96]

There is no way to open Minecraft from here, so this rasterises the same
geometry and textures the game will use: every cube face is projected with an
orthographic three-quarter camera, splatted through a depth buffer and sampled
from the real 16x16 material PNG, with the same face dimming the engine
applies. It is not a pixel-exact preview, but it is enough to catch a model
that is inside-out, invisible, mis-skinned or shapeless.
"""

import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import fungi_shapes  # noqa: E402
import fungi_spec as spec  # noqa: E402
from gen_fungi_textures import build_species_textures  # noqa: E402
from pixel import Canvas  # noqa: E402

YAW = math.radians(35.0)
PITCH = math.radians(24.0)

# How much the engine darkens each face by its normal.
FACE_DIMMING = {
    "up": 1.0,
    "down": 0.48,
    "north": 0.80,
    "south": 0.80,
    "east": 0.62,
    "west": 0.62,
}

# origin corner + the two edge vectors spanning each face of a unit cube.
FACE_FRAME = {
    "down": ((0, 0, 0), (1, 0, 0), (0, 0, 1)),
    "up": ((0, 1, 0), (1, 0, 0), (0, 0, 1)),
    "north": ((0, 0, 0), (1, 0, 0), (0, 1, 0)),
    "south": ((0, 0, 1), (1, 0, 0), (0, 1, 0)),
    "west": ((0, 0, 0), (0, 0, 1), (0, 1, 0)),
    "east": ((1, 0, 0), (0, 0, 1), (0, 1, 0)),
}


def rotate_y(point, degrees, pivot):
    if not degrees:
        return point
    angle = math.radians(degrees)
    cos, sin = math.cos(angle), math.sin(angle)
    x, y, z = point[0] - pivot[0], point[1] - pivot[1], point[2] - pivot[2]
    return (
        pivot[0] + x * cos + z * sin,
        pivot[1] + y,
        pivot[2] - x * sin + z * cos,
    )


def project(point):
    """Block space -> (screen x, screen y, depth), orthographic."""
    x, y, z = point[0], point[1] - 8.0, point[2]
    cy, sy = math.cos(YAW), math.sin(YAW)
    xr = x * cy + z * sy
    zr = -x * sy + z * cy
    cp, sp = math.cos(PITCH), math.sin(PITCH)
    yr = y * cp - zr * sp
    depth = y * sp + zr * cp
    return xr, -yr, depth


def render_species(sp, cell, background):
    shape = fungi_shapes.SHAPES[sp["shape"]]
    textures = build_species_textures(sp, write=False)

    canvas = Canvas(cell, cell, background)
    depth_buffer = [[float("inf")] * cell for _ in range(cell)]

    # Fit the whole 16-block cube in the frame with a small margin.
    scale = cell / 24.0
    centre = cell / 2.0

    for entry in shape["cubes"]:
        ox, oy, oz = entry["origin"]
        sx, sy, sz = entry["size"]
        rotation = entry.get("rotation", [0, 0, 0])[1] if "rotation" in entry else 0
        pivot = entry.get("pivot", [0, 0, 0])
        texture = textures.get(entry["mat"]) or textures.get("cap")
        if texture is None:
            continue

        for face, (corner, edge_u, edge_v) in FACE_FRAME.items():
            base = (
                ox + corner[0] * sx,
                oy + corner[1] * sy,
                oz + corner[2] * sz,
            )
            span_u = (edge_u[0] * sx, edge_u[1] * sy, edge_u[2] * sz)
            span_v = (edge_v[0] * sx, edge_v[1] * sy, edge_v[2] * sz)
            len_u = math.sqrt(sum(c * c for c in span_u))
            len_v = math.sqrt(sum(c * c for c in span_v))
            if len_u < 1e-6 or len_v < 1e-6:
                continue  # degenerate face of a zero-thickness plane

            # Sample densely enough that the splat leaves no holes.
            steps_u = max(2, int(len_u * scale * 2.4))
            steps_v = max(2, int(len_v * scale * 2.4))
            dim = 1.0 if sp["light"] >= 7 or entry["mat"] == "glow" else FACE_DIMMING[face]

            for iu in range(steps_u + 1):
                u = iu / steps_u
                for iv in range(steps_v + 1):
                    v = iv / steps_v
                    point = (
                        base[0] + span_u[0] * u + span_v[0] * v,
                        base[1] + span_u[1] * u + span_v[1] * v,
                        base[2] + span_u[2] * u + span_v[2] * v,
                    )
                    point = rotate_y(point, rotation, pivot)
                    px, py, depth = project(point)
                    col = int(centre + px * scale)
                    row = int(centre + py * scale)
                    if not (0 <= col < cell and 0 <= row < cell):
                        continue
                    if depth >= depth_buffer[row][col]:
                        continue

                    # Every face maps the full 16x16 material.
                    tx = min(15, max(0, int(u * 16)))
                    ty = min(15, max(0, int((1.0 - v) * 16)))
                    r, g, b, a = texture.get(tx, ty)
                    if a < 128:
                        continue  # alpha_test cut-out
                    depth_buffer[row][col] = depth
                    canvas.set(col, row, (r * dim, g * dim, b * dim))

    return canvas


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="preview_models.png")
    parser.add_argument("--cell", type=int, default=96)
    parser.add_argument("--columns", type=int, default=5)
    args = parser.parse_args()

    background = (38, 40, 46, 255)
    cells = [(sp, render_species(sp, args.cell, background)) for sp in spec.SPECIES]

    columns = args.columns
    rows = (len(cells) + columns - 1) // columns
    pad = 3
    sheet = Canvas(
        columns * (args.cell + pad) + pad,
        rows * (args.cell + pad) + pad,
        (18, 19, 22, 255),
    )
    for index, (sp, cell_canvas) in enumerate(cells):
        row, col = divmod(index, columns)
        sheet.paste(
            cell_canvas,
            pad + col * (args.cell + pad),
            pad + row * (args.cell + pad),
        )
    sheet.to_png(args.out)

    print(f"Wrote {args.out} ({sheet.w}x{sheet.h})")
    for index, sp in enumerate(spec.SPECIES):
        print(f"  r{index // columns} c{index % columns}  {sp['name']} ({sp['shape']})")


if __name__ == "__main__":
    main()
