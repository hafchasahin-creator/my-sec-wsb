#!/usr/bin/env python3
"""Render the Bloatgrub model to a PNG so a human can look at it.

Three orthographic views (side, front, top), drawn with a painter's algorithm
straight from bloatgrub.geo.json and bloatgrub.png. Because the model's bone
rotations are all zero, cube origins are already model-space, so no transform
stack is needed - what you see here is what the game builds before animation.

This is a sanity check on silhouette and texture placement, not a renderer.

Usage:  python3 tools/preview_bloatgrub.py [out.png]
"""

import json
import os
import sys
import zlib
import struct

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pixel import new_grid, write_png  # noqa: E402

RP = os.path.join("resource_packs", "bloatgrub_rp")
GEO = os.path.join(RP, "models", "entity", "bloatgrub.geo.json")
TEX = os.path.join(RP, "textures", "entity", "bloatgrub.png")

ZOOM = 9          # screen pixels per model unit
PAD = 3           # model units of margin around each view
BACKDROP = (26, 24, 30, 255)
GRID = (38, 36, 44, 255)


def read_png(path):
    """Decode an 8-bit RGBA PNG into a grid. Enough for our own output."""
    with open(path, "rb") as handle:
        blob = handle.read()
    assert blob[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"

    pos = 8
    width = height = None
    idat = b""
    while pos < len(blob):
        length = struct.unpack(">I", blob[pos:pos + 4])[0]
        tag = blob[pos + 4:pos + 8]
        data = blob[pos + 8:pos + 8 + length]
        if tag == b"IHDR":
            width, height, depth, colour = struct.unpack(">IIBB", data[:10])
            assert depth == 8 and colour == 6, "expected 8-bit RGBA"
        elif tag == b"IDAT":
            idat += data
        elif tag == b"IEND":
            break
        pos += 12 + length

    raw = zlib.decompress(idat)
    stride = width * 4
    grid = []
    previous = bytearray(stride)
    pos = 0
    for _row in range(height):
        filter_type = raw[pos]
        pos += 1
        line = bytearray(raw[pos:pos + stride])
        pos += stride
        for i in range(stride):
            a = line[i - 4] if i >= 4 else 0
            b = previous[i]
            c = previous[i - 4] if i >= 4 else 0
            if filter_type == 1:
                line[i] = (line[i] + a) & 0xFF
            elif filter_type == 2:
                line[i] = (line[i] + b) & 0xFF
            elif filter_type == 3:
                line[i] = (line[i] + (a + b) // 2) & 0xFF
            elif filter_type == 4:
                delta = a + b - c
                pa, pb, pc = abs(delta - a), abs(delta - b), abs(delta - c)
                pred = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pred) & 0xFF
        grid.append([tuple(line[i:i + 4]) for i in range(0, stride, 4)])
        previous = line
    return grid


def uv_faces(u, v, size):
    sx, sy, sz = size
    return {
        "up": (u + sz, v, sx, sz),
        "down": (u + sz + sx, v, sx, sz),
        "east": (u, v + sz, sz, sy),
        "north": (u + sz, v + sz, sx, sy),
        "west": (u + sz + sx, v + sz, sz, sy),
        "south": (u + 2 * sz + sx, v + sz, sx, sy),
    }


def collect_cubes():
    doc = json.load(open(GEO, encoding="utf-8"))
    entry = doc["minecraft:geometry"][0]
    cubes = []
    for bone in entry["bones"]:
        for cube in bone.get("cubes", []):
            cubes.append(
                {
                    "bone": bone["name"],
                    "origin": [float(value) for value in cube["origin"]],
                    "size": [int(value) for value in cube["size"]],
                    "uv": cube["uv"],
                }
            )
    return cubes, entry["description"]


# Each view: which face is toward the camera, how model axes map to the screen,
# and which axis to sort along (far to near).
VIEWS = {
    "side": {
        "face": "east",
        "axis_h": "z", "flip_h": False,
        "axis_v": "y",
        "depth": lambda c: c["origin"][0],           # bigger x is nearer
        "label": "side (from +X, facing left)",
    },
    "front": {
        "face": "north",
        "axis_h": "x", "flip_h": True,
        "axis_v": "y",
        "depth": lambda c: -c["origin"][2],          # smaller z is nearer
        "label": "front (the end with the mouth)",
    },
    "top": {
        "face": "up",
        "axis_h": "x", "flip_h": True,
        "axis_v": "z",
        "depth": lambda c: c["origin"][1],           # bigger y is nearer
        "label": "top",
    },
}


def render_view(cubes, texture, view, bounds):
    face_name = view["face"]
    (min_h, max_h), (min_v, max_v) = bounds

    width = int((max_h - min_h + 2 * PAD) * ZOOM)
    height = int((max_v - min_v + 2 * PAD) * ZOOM)
    canvas = new_grid(width, height, BACKDROP)

    # A faint one-block grid, so proportions are readable.
    for step in range(int(min_h) - PAD, int(max_h) + PAD + 1):
        if step % 16:
            continue
        col = int((step - min_h + PAD) * ZOOM)
        for row in range(height):
            if 0 <= col < width:
                canvas[row][col] = GRID
    for step in range(int(min_v) - PAD, int(max_v) + PAD + 1):
        if step % 16:
            continue
        row = int((max_v - step + PAD) * ZOOM)
        for col in range(width):
            if 0 <= row < height:
                canvas[row][col] = GRID

    index = {"x": 0, "y": 1, "z": 2}
    ih, iv = index[view["axis_h"]], index[view["axis_v"]]

    for cube in sorted(cubes, key=view["depth"]):
        sx, sy, sz = cube["size"]
        span = {"x": sx, "y": sy, "z": sz}
        fx, fy, fw, fh = uv_faces(cube["uv"][0], cube["uv"][1], cube["size"])[face_name]
        if fw <= 0 or fh <= 0:
            continue

        h0 = cube["origin"][ih]
        v0 = cube["origin"][iv]
        hw = span[view["axis_h"]]
        vh = span[view["axis_v"]]

        for py in range(int(vh * ZOOM)):
            for px in range(int(hw * ZOOM)):
                # Texture sample: box UV is 1 texel per model unit on each face.
                tx = int(px / ZOOM / hw * fw)
                ty = int(py / ZOOM / vh * fh)
                rgba = texture[min(fy + ty, len(texture) - 1)][
                    min(fx + tx, len(texture[0]) - 1)
                ]
                if rgba[3] == 0:
                    continue

                model_h = h0 + (hw - px / ZOOM if view["flip_h"] else px / ZOOM)
                model_v = v0 + vh - py / ZOOM
                col = int((model_h - min_h + PAD) * ZOOM)
                row = int((max_v - model_v + PAD) * ZOOM)
                if 0 <= col < width and 0 <= row < height:
                    canvas[row][col] = rgba

    return canvas


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "bloatgrub_preview.png"
    cubes, description = collect_cubes()
    texture = read_png(TEX)

    xs = [c["origin"][0] for c in cubes] + [c["origin"][0] + c["size"][0] for c in cubes]
    ys = [c["origin"][1] for c in cubes] + [c["origin"][1] + c["size"][1] for c in cubes]
    zs = [c["origin"][2] for c in cubes] + [c["origin"][2] + c["size"][2] for c in cubes]
    extent = {"x": (min(xs), max(xs)), "y": (min(ys), max(ys)), "z": (min(zs), max(zs))}

    panels = []
    for name, view in VIEWS.items():
        bounds = (extent[view["axis_h"]], extent[view["axis_v"]])
        panels.append((name, view, render_view(cubes, texture, view, bounds)))

    gap = 8
    total_width = sum(len(p[2][0]) for p in panels) + gap * (len(panels) - 1)
    total_height = max(len(p[2]) for p in panels)
    sheet = new_grid(total_width, total_height, BACKDROP)

    cursor = 0
    for _name, _view, panel in panels:
        for row in range(len(panel)):
            for col in range(len(panel[0])):
                sheet[row][cursor + col] = panel[row][col]
        cursor += len(panel[0]) + gap

    write_png(out, sheet)
    print(
        f"{out}: {total_width}x{total_height}, {len(cubes)} cubes, "
        f"model spans x {extent['x']}, y {extent['y']}, z {extent['z']} "
        f"(= {(extent['x'][1] - extent['x'][0]) / 16:.2f} x "
        f"{(extent['y'][1] - extent['y'][0]) / 16:.2f} x "
        f"{(extent['z'][1] - extent['z'][0]) / 16:.2f} blocks before "
        f"minecraft:scale)"
    )
    for name, view, _panel in panels:
        print(f"  {name}: {view['label']}")


if __name__ == "__main__":
    main()
