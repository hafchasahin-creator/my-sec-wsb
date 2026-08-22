#!/usr/bin/env python3
"""Render the bodyguard model to a PNG so the art can be checked without
launching Minecraft.

Projects every cube's front (and optionally side) face through the same box-UV
unwrap Bedrock uses, painting near faces over far ones.  It is not a renderer -
no lighting, no rotation - but it is enough to catch a mis-mapped UV, a limb
drawn in the wrong place, or a texture that simply looks bad.

Usage:  python3 tools/preview_model.py [--out preview.png] [--scale 10]
"""

import argparse
import json
import os
import struct
import sys
import zlib

RP = os.path.join("resource_packs", "bodyguard_rp")
GEO = os.path.join(RP, "models", "entity", "bodyguard.geo.json")


def read_png(path):
    with open(path, "rb") as handle:
        data = handle.read()
    pos, idat, width, height = 8, b"", None, None
    while pos < len(data):
        length = struct.unpack(">I", data[pos : pos + 4])[0]
        tag = data[pos + 4 : pos + 8]
        body = data[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if tag == b"IHDR":
            width, height = struct.unpack(">II", body[:8])
        elif tag == b"IDAT":
            idat += body
        elif tag == b"IEND":
            break
    raw = zlib.decompress(idat)
    stride, bpp = width * 4, 4
    rows, previous, index = [], bytearray(stride), 0
    for _ in range(height):
        filter_type = raw[index]
        index += 1
        line = bytearray(raw[index : index + stride])
        index += stride
        if filter_type == 1:
            for x in range(bpp, stride):
                line[x] = (line[x] + line[x - bpp]) & 255
        elif filter_type == 2:
            for x in range(stride):
                line[x] = (line[x] + previous[x]) & 255
        elif filter_type == 3:
            for x in range(stride):
                left = line[x - bpp] if x >= bpp else 0
                line[x] = (line[x] + ((left + previous[x]) >> 1)) & 255
        elif filter_type == 4:
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0
                b = previous[x]
                c = previous[x - bpp] if x >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        rows.append(line)
        previous = line
    return width, height, rows


def write_png(path, width, height, pixels):
    raw = b"".join(
        b"\x00" + bytes(channel for pixel in row for channel in pixel) for row in pixels
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
    with open(path, "wb") as handle:
        handle.write(blob)


def faces(u, v, sx, sy, sz):
    return {
        "front": (u + sz, v + sz, sx, sy),
        "right": (u, v + sz, sz, sy),
        "back": (u + 2 * sz + sx, v + sz, sx, sy),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=os.path.join("dist", "bodyguard_preview.png"))
    parser.add_argument("--scale", type=int, default=10)
    args = parser.parse_args()

    with open(GEO, encoding="utf-8") as handle:
        geometry = json.load(handle)["minecraft:geometry"][0]
    bones = geometry["bones"]

    tiers = ["t0", "t1", "t2", "t3", "t4"]
    scale = args.scale
    # Model bounds, generous enough for the pauldrons.
    min_x, max_x = -9.5, 9.5
    min_y, max_y = -0.5, 33.0
    cell_w = int((max_x - min_x) * scale)
    cell_h = int((max_y - min_y) * scale)
    gap = scale
    # Front and side view per tier.
    width = (cell_w * 2 + gap) * len(tiers) + gap * (len(tiers) + 1)
    height = cell_h + gap * 2

    background = (26, 28, 34, 255)
    canvas = [[background for _ in range(width)] for _ in range(height)]

    for index, tier in enumerate(tiers):
        texture_path = os.path.join(RP, "textures", "entity", "bodyguard", "bodyguard_%s.png" % tier)
        tex_w, tex_h, rows = read_png(texture_path)

        block_x = gap + index * (cell_w * 2 + gap + gap)

        for view, offset_x in (("front", 0), ("right", cell_w + gap)):
            # Painter's algorithm: sort so nearer faces are drawn last.
            def depth(bone_cube):
                _bone, cube = bone_cube
                origin = cube["origin"]
                size = cube["size"]
                return -origin[2] if view == "front" else -(origin[0] + size[0])

            drawable = [(bone, cube) for bone in bones for cube in bone.get("cubes", [])]
            drawable.sort(key=depth)

            for bone, cube in drawable:
                ox, oy, oz = cube["origin"]
                sx, sy, sz = [int(v) for v in cube["size"]]
                if sx == 0 or sy == 0:
                    continue
                u, v = cube["uv"]
                fx, fy, fw, fh = faces(u, v, sx, sy, sz)[view]
                for j in range(fh):
                    for i in range(fw):
                        pixel = rows[fy + j][(fx + i) * 4 : (fx + i) * 4 + 4]
                        if pixel[3] == 0:
                            continue
                        colour = (pixel[0], pixel[1], pixel[2], 255)
                        if view == "front":
                            model_x = ox + (fw - 1 - i)
                            model_y = oy + (fh - 1 - j)
                            plane = model_x
                        else:
                            model_z = oz + i
                            model_y = oy + (fh - 1 - j)
                            plane = -model_z
                        px0 = block_x + offset_x + int((plane - min_x) * scale)
                        py0 = gap + int((max_y - model_y - 1) * scale)
                        for dy in range(scale):
                            for dx in range(scale):
                                px, py = px0 + dx, py0 + dy
                                if 0 <= px < width and 0 <= py < height:
                                    canvas[py][px] = colour

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    write_png(args.out, width, height, canvas)
    print("wrote %s (%dx%d, tiers %s: front then side)" % (args.out, width, height, ", ".join(tiers)))


if __name__ == "__main__":
    sys.exit(main())
