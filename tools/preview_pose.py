#!/usr/bin/env python3
"""Render the bodyguard in a posed frame from one of its animations.

Animations are the one part of a Bedrock add-on that cannot be checked by
reading the JSON: a plausible-looking set of numbers can still put an elbow
through a ribcage.  This applies a frame of an animation to the rig and
rasterises it, so a pose can be looked at before it ships.

It is a small orthographic renderer with a depth buffer and texture sampling -
no lighting model beyond a flat per-face shade, and no blending.

Usage:
    python3 tools/preview_pose.py --poses attack_a,defend,victory --out dist/poses.png
    python3 tools/preview_pose.py --list
"""

import argparse
import json
import math
import os
import re
import struct
import sys
import zlib

RP = os.path.join("resource_packs", "bodyguard_rp")
GEO = os.path.join(RP, "models", "entity", "bodyguard.geo.json")
ANIM = os.path.join(RP, "animations", "bodyguard.animation.json")
TEXTURE = os.path.join(RP, "textures", "entity", "bodyguard", "bodyguard_t3.png")


# --------------------------------------------------------------------------
# PNG
# --------------------------------------------------------------------------
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
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(blob)


# --------------------------------------------------------------------------
# Molang, just enough of it to evaluate an animation channel at a moment in time
# --------------------------------------------------------------------------
def evaluate(expression, time):
    if isinstance(expression, (int, float)):
        return float(expression)
    text = str(expression)
    text = re.sub(r"(?i)\bmath\.", "math.", text)
    text = text.replace("query.life_time", repr(time))
    text = text.replace("query.modified_distance_moved", repr(time * 4.0))
    text = text.replace("query.modified_move_speed", "0.9")
    text = text.replace("query.hurt_time", "0.0")
    text = text.replace("query.death_ticks", "0.0")
    text = text.replace("query.target_x_rotation", "0.0")
    text = text.replace("query.target_y_rotation", "0.0")
    text = text.replace("query.skin_id", "1.0")
    text = text.replace("variable.tcos0", repr(math.cos(time * 4.0 * 38.17 * math.pi / 180.0) * 0.9 * 57.3))
    text = text.replace("variable.attack_time", "0.5")
    text = re.sub(r"variable\.[a-zA-Z_0-9]+", "1.0", text)
    text = text.replace("this", "0.0")
    # Molang trigonometry is in degrees.
    text = re.sub(r"math\.(sin|cos)\(", r"_deg_\1(", text)
    text = text.replace("math.", "_m_")
    scope = {
        "_deg_sin": lambda v: math.sin(math.radians(v)),
        "_deg_cos": lambda v: math.cos(math.radians(v)),
        "_m_abs": abs,
        "_m_min": min,
        "_m_max": max,
        "_m_sqrt": math.sqrt,
        "_m_pow": pow,
        "_m_floor": math.floor,
        "_m_ceil": math.ceil,
        "_m_round": round,
        "_m_mod": math.fmod,
        "_m_clamp": lambda v, lo, hi: max(lo, min(hi, v)),
        "_m_lerp": lambda a, b, t: a + (b - a) * t,
        "_m_pi": math.pi,
    }
    try:
        return float(eval(text, {"__builtins__": {}}, scope))  # noqa: S307 - local, generated
    except Exception:
        return 0.0


def channel_at(channel, time, default=(0.0, 0.0, 0.0)):
    """Resolve a bone channel (rotation/position/scale) at `time`."""
    if channel is None:
        return list(default)
    if isinstance(channel, (int, float)):
        return [float(channel)] * 3
    if isinstance(channel, list):
        return [evaluate(v, time) for v in channel]
    if isinstance(channel, dict):
        stamps = sorted((float(k), v) for k, v in channel.items())
        if not stamps:
            return list(default)
        if time <= stamps[0][0]:
            frame = stamps[0][1]
        elif time >= stamps[-1][0]:
            frame = stamps[-1][1]
        else:
            frame = None
            for i in range(len(stamps) - 1):
                t0, v0 = stamps[i]
                t1, v1 = stamps[i + 1]
                if t0 <= time <= t1:
                    a = channel_at(v0, time, default)
                    b = channel_at(v1, time, default)
                    ratio = (time - t0) / (t1 - t0) if t1 > t0 else 0.0
                    return [a[i2] + (b[i2] - a[i2]) * ratio for i2 in range(3)]
        if isinstance(frame, dict):
            frame = frame.get("post", frame.get("pre", [0, 0, 0]))
        return channel_at(frame, time, default)
    return list(default)


# --------------------------------------------------------------------------
# Rig
# --------------------------------------------------------------------------
def rotate(point, angles):
    x, y, z = point
    rx, ry, rz = [math.radians(a) for a in angles]
    # Bedrock applies X, then Y, then Z.
    cos, sin = math.cos(rx), math.sin(rx)
    y, z = y * cos - z * sin, y * sin + z * cos
    cos, sin = math.cos(ry), math.sin(ry)
    x, z = x * cos + z * sin, -x * sin + z * cos
    cos, sin = math.cos(rz), math.sin(rz)
    x, y = x * cos - y * sin, x * sin + y * cos
    return [x, y, z]


def build(bones, pose, time):
    """Return name -> function mapping a model-space point to a posed point."""
    by_name = {bone["name"]: bone for bone in bones}

    def transform(name, point):
        bone = by_name[name]
        pivot = bone.get("pivot", [0, 0, 0])
        angles = pose.get(name)
        if angles:
            # Bedrock rotates the opposite way round X and Y from a plain
            # right-handed rotation.
            angles = [-angles[0], -angles[1], angles[2]]
            local = [point[i] - pivot[i] for i in range(3)]
            local = rotate(local, angles)
            point = [local[i] + pivot[i] for i in range(3)]
        parent = bone.get("parent")
        if parent and parent in by_name:
            return transform(parent, point)
        return point

    return transform


def faces_of(cube):
    ox, oy, oz = cube["origin"]
    sx, sy, sz = cube["size"]
    inflate = cube.get("inflate", 0)
    ox, oy, oz = ox - inflate, oy - inflate, oz - inflate
    sx, sy, sz = sx + inflate * 2, sy + inflate * 2, sz + inflate * 2
    u, v = cube["uv"]
    iw, ih, idp = int(cube["size"][0]), int(cube["size"][1]), int(cube["size"][2])

    def corner(dx, dy, dz):
        return [ox + dx * sx, oy + dy * sy, oz + dz * sz]

    # (corners in UV order: origin, +u, +u+v, +v), uv rect, shade
    return [
        # front (-z)
        ([corner(1, 1, 0), corner(0, 1, 0), corner(0, 0, 0), corner(1, 0, 0)],
         (u + idp, v + idp, iw, ih), 1.00),
        # back (+z)
        ([corner(0, 1, 1), corner(1, 1, 1), corner(1, 0, 1), corner(0, 0, 1)],
         (u + 2 * idp + iw, v + idp, iw, ih), 0.72),
        # right (-x)
        ([corner(0, 1, 0), corner(0, 1, 1), corner(0, 0, 1), corner(0, 0, 0)],
         (u, v + idp, idp, ih), 0.84),
        # left (+x)
        ([corner(1, 1, 1), corner(1, 1, 0), corner(1, 0, 0), corner(1, 0, 1)],
         (u + idp + iw, v + idp, idp, ih), 0.84),
        # top (+y)
        ([corner(1, 1, 1), corner(0, 1, 1), corner(0, 1, 0), corner(1, 1, 0)],
         (u + idp, v, iw, idp), 1.12),
        # bottom (-y)
        ([corner(1, 0, 0), corner(0, 0, 0), corner(0, 0, 1), corner(1, 0, 1)],
         (u + idp + iw, v, iw, idp), 0.6),
    ]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--poses", default="idle,idle_alert,walk,run,attack_a,attack_b,special,defend,victory,at_ease")
    parser.add_argument("--time", type=float, default=None)
    parser.add_argument("--out", default=os.path.join("dist", "bodyguard_poses.png"))
    parser.add_argument("--scale", type=int, default=7)
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--gun", default="", help="attachable geometry id, e.g. geometry.bg_sidearm")
    parser.add_argument("--wield", default="0,0,0,0,0,0", help="gun position x,y,z and rotation x,y,z")
    args = parser.parse_args()

    with open(GEO, encoding="utf-8") as handle:
        bones = json.load(handle)["minecraft:geometry"][0]["bones"]
    with open(ANIM, encoding="utf-8") as handle:
        animations = json.load(handle)["animations"]

    if args.list:
        for name in animations:
            print(name)
        return 0

    tex_w, tex_h, texels = read_png(TEXTURE)

    # An attachable is a separate model bound into the hand bone, so the pose
    # renderer has to do the same to show a gun where it will actually appear.
    gun_bones, gun_texels, gun_offset, gun_angles = [], None, [0, 0, 0], [0, 0, 0]
    if args.gun:
        with open(os.path.join(RP, "models", "entity", "bg_guns.geo.json"), encoding="utf-8") as handle:
            for entry in json.load(handle)["minecraft:geometry"]:
                if entry["description"]["identifier"] == args.gun:
                    gun_bones = entry["bones"]
        if not gun_bones:
            print("unknown gun geometry: %s" % args.gun, file=sys.stderr)
            return 1
        name = args.gun.replace("geometry.bg_", "")
        _gw, _gh, gun_texels = read_png(
            os.path.join(RP, "textures", "entity", "bodyguard", name + ".png")
        )
        numbers = [float(v) for v in args.wield.split(",")]
        gun_offset, gun_angles = numbers[:3], numbers[3:6]

    names = [n.strip() for n in args.poses.split(",") if n.strip()]
    scale = args.scale
    cell = 46 * scale
    width = cell * len(names)
    height = cell
    background = (24, 26, 32, 255)
    canvas = [[background for _ in range(width)] for _ in range(height)]
    depth = [[1e9] * width for _ in range(height)]

    # A gentle three-quarter view; a flat front hides most posing.
    yaw, pitch = math.radians(28), math.radians(10)

    for slot, short in enumerate(names):
        key = "animation.bodyguard." + short
        animation = animations.get(key)
        if animation is None:
            print("unknown animation: %s" % key, file=sys.stderr)
            continue
        length = float(animation.get("animation_length", 1.0))
        time = args.time if args.time is not None else (length * 0.42 if "animation_length" in animation else 1.7)

        pose = {}
        for bone, channels in animation.get("bones", {}).items():
            actual = next((b["name"] for b in bones if b["name"].lower() == bone.lower()), bone)
            pose[actual] = channel_at(channels.get("rotation"), time)

        transform = build(bones, pose, time)
        origin_x = slot * cell + cell // 2

        drawn = []
        renderables = [(bone, cube, False) for bone in bones for cube in bone.get("cubes", [])]
        # The gun rides the hand bone, offset and rotated by its wield transform.
        hand_pivot = next((b["pivot"] for b in bones if b["name"] == "rightItem"), [0, 0, 0])
        for bone in gun_bones:
            for cube in bone.get("cubes", []):
                renderables.append(({"name": "rightItem", "_gun": True}, cube, True))

        for bone, cube, is_gun in renderables:
            for corners, (fu, fv, fw, fh), shade in faces_of(cube):
                if is_gun:
                    posed = []
                    for corner in corners:
                        # Same axis convention as a bone, so the numbers typed
                        # here are the numbers that go in the wield animation.
                        local = rotate(list(corner), [-gun_angles[0], -gun_angles[1], gun_angles[2]])
                        local = [local[i] + gun_offset[i] + hand_pivot[i] for i in range(3)]
                        posed.append(transform("rightItem", local))
                else:
                    posed = [transform(bone["name"], list(c)) for c in corners]
                if True:
                    view = []
                    for x, y, z in posed:
                        vx = x * math.cos(yaw) + z * math.sin(yaw)
                        vz = -x * math.sin(yaw) + z * math.cos(yaw)
                        vy = y * math.cos(pitch) - vz * math.sin(pitch)
                        vz = y * math.sin(pitch) + vz * math.cos(pitch)
                        view.append((vx, vy, vz))
                    drawn.append((view, (fu, fv, fw, fh), shade, is_gun))

        for view, (fu, fv, fw, fh), shade, is_gun in drawn:
            sheet = gun_texels if is_gun else texels
            xs = [v[0] for v in view]
            ys = [v[1] for v in view]
            screen = [
                (origin_x + vx * scale, cell - 3 * scale - vy * scale, vz) for vx, vy, vz in view
            ]
            min_x = max(0, int(min(p[0] for p in screen)) - 1)
            max_x = min(width - 1, int(max(p[0] for p in screen)) + 1)
            min_y = max(0, int(min(p[1] for p in screen)) - 1)
            max_y = min(height - 1, int(max(p[1] for p in screen)) + 1)
            if min_x > max_x or min_y > max_y:
                continue

            (x0, y0, z0), (x1, y1, z1), (x2, y2, z2), (x3, y3, z3) = screen
            for py in range(min_y, max_y + 1):
                for px in range(min_x, max_x + 1):
                    for tri, uvs in (
                        (((x0, y0, z0), (x1, y1, z1), (x2, y2, z2)), ((0, 0), (1, 0), (1, 1))),
                        (((x0, y0, z0), (x2, y2, z2), (x3, y3, z3)), ((0, 0), (1, 1), (0, 1))),
                    ):
                        (ax, ay, az), (bx, by, bz), (cx, cy, cz) = tri
                        det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
                        if abs(det) < 1e-9:
                            continue
                        wa = ((by - cy) * (px + 0.5 - cx) + (cx - bx) * (py + 0.5 - cy)) / det
                        wb = ((cy - ay) * (px + 0.5 - cx) + (ax - cx) * (py + 0.5 - cy)) / det
                        wc = 1.0 - wa - wb
                        if wa < -0.002 or wb < -0.002 or wc < -0.002:
                            continue
                        z = wa * az + wb * bz + wc * cz
                        if z >= depth[py][px]:
                            continue
                        us = wa * uvs[0][0] + wb * uvs[1][0] + wc * uvs[2][0]
                        vs = wa * uvs[0][1] + wb * uvs[1][1] + wc * uvs[2][1]
                        tx = min(fw - 1, max(0, int(us * fw)))
                        ty = min(fh - 1, max(0, int(vs * fh)))
                        px_index = (fu + tx) * 4
                        texel = sheet[fv + ty][px_index : px_index + 4]
                        if texel[3] == 0:
                            continue
                        depth[py][px] = z
                        canvas[py][px] = (
                            min(255, int(texel[0] * shade)),
                            min(255, int(texel[1] * shade)),
                            min(255, int(texel[2] * shade)),
                            255,
                        )
                        break

    write_png(args.out, width, height, canvas)
    print("wrote %s (%dx%d) - %s" % (args.out, width, height, ", ".join(names)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
