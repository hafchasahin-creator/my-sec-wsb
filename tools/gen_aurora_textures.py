#!/usr/bin/env python3
"""Generate the Aurora Visuals sky textures.

Pure standard library. Everything here is drawn from maths rather than copied
from anywhere: a bloomed sun, a lit moon in eight phases, soft clouds, and the
two colour maps that decide how grass and leaves are tinted.

Usage:  python3 tools/gen_aurora_textures.py [--preview]
"""

import math
import os
import struct
import sys
import zlib

RP = os.path.join("resource_packs", "aurora_visuals_rp")
BP = os.path.join("behavior_packs", "aurora_visuals_bp")

TRANSPARENT = (0, 0, 0, 0)


# --------------------------------------------------------------------------
# PNG output
# --------------------------------------------------------------------------

def write_png(path, pixels):
    height = len(pixels)
    width = len(pixels[0])
    raw = b"".join(
        b"\x00" + bytes(channel for px in row for channel in px) for row in pixels
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

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(blob)


def canvas(width, height, colour=TRANSPARENT):
    return [[colour for _ in range(width)] for _ in range(height)]


def clamp(value, low=0.0, high=1.0):
    return max(low, min(high, value))


def mix(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(4))


def smoothstep(edge0, edge1, x):
    t = clamp((x - edge0) / (edge1 - edge0 or 1e-6))
    return t * t * (3 - 2 * t)


# --------------------------------------------------------------------------
# Value noise, used for the clouds
# --------------------------------------------------------------------------

def hash2(x, y, seed):
    n = x * 374761393 + y * 668265263 + seed * 1442695040888963407
    n = (n ^ (n >> 13)) * 1274126177
    return ((n ^ (n >> 16)) & 0xFFFF) / 0xFFFF


def value_noise(x, y, seed):
    x0, y0 = math.floor(x), math.floor(y)
    fx, fy = x - x0, y - y0
    sx, sy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    n00 = hash2(x0, y0, seed)
    n10 = hash2(x0 + 1, y0, seed)
    n01 = hash2(x0, y0 + 1, seed)
    n11 = hash2(x0 + 1, y0 + 1, seed)
    return (n00 * (1 - sx) + n10 * sx) * (1 - sy) + (n01 * (1 - sx) + n11 * sx) * sy


def fbm(x, y, seed, octaves=4):
    total, amplitude, frequency, norm = 0.0, 1.0, 1.0, 0.0
    for _ in range(octaves):
        total += value_noise(x * frequency, y * frequency, seed) * amplitude
        norm += amplitude
        amplitude *= 0.5
        frequency *= 2.0
    return total / norm


# --------------------------------------------------------------------------
# The sun
#
# The in-world sun is a fixed-size quad, so the bloom has to live in the
# texture: a hot white core, a warm inner halo, and a wide soft falloff that
# fades to nothing before the edge of the image.
# --------------------------------------------------------------------------

def build_sun(size=128):
    grid = canvas(size, size)
    centre = (size - 1) / 2
    core = (255, 252, 236, 255)
    warm = (255, 226, 150, 255)
    outer = (255, 186, 96, 255)

    for y in range(size):
        for x in range(size):
            away = math.hypot(x - centre, y - centre) / centre  # 0 at the middle

            if away <= 0.16:
                colour = core
                alpha = 255
            elif away <= 0.34:
                colour = mix(core, warm, smoothstep(0.16, 0.34, away))
                alpha = 255
            else:
                colour = mix(warm, outer, smoothstep(0.34, 0.62, away))
                # Two falloffs added together: a tight bright halo, and a wide
                # faint one. That is what reads as bloom.
                tight = 1.0 - smoothstep(0.34, 0.58, away)
                wide = 1.0 - smoothstep(0.40, 1.0, away)
                alpha = round(255 * clamp(tight * 0.85 + wide * 0.45))

            if alpha <= 0:
                continue

            # A faint four-point flare, so the sun has some shape to it.
            flare = max(
                0.0,
                1.0 - abs(x - centre) / (size * 0.02) if abs(y - centre) < 1.5 else 0.0,
                1.0 - abs(y - centre) / (size * 0.02) if abs(x - centre) < 1.5 else 0.0,
            )
            alpha = min(255, alpha + round(60 * flare * (1.0 - smoothstep(0.3, 0.9, away))))
            grid[y][x] = (colour[0], colour[1], colour[2], alpha)
    return grid


# --------------------------------------------------------------------------
# The moon: eight phases in a 4x2 grid, each one lit from the side
# --------------------------------------------------------------------------

def build_moon(cell=64):
    """Eight phases in a 4x2 grid, in vanilla's order: full first, new fifth.

    The terminator is the classic ellipse - a pixel is lit when it sits to the
    right of cos(phase) * the half-width of the disc at that height - and the
    second half of the cycle is mirrored so the crescents lean the other way.
    """
    width, height = cell * 4, cell * 2
    grid = canvas(width, height)
    surface = (234, 240, 252, 255)
    shade = (178, 192, 216, 255)
    glow = (196, 214, 245, 255)

    centre = (cell - 1) / 2
    radius = cell * 0.40
    halo = cell * 0.49

    for phase in range(8):
        ox = (phase % 4) * cell
        oy = (phase // 4) * cell
        k = math.cos(math.pi * phase / 4)
        mirrored = phase > 4

        for y in range(cell):
            for x in range(cell):
                dx = x - centre
                dy = y - centre
                away = math.hypot(dx, dy)
                if away > halo:
                    continue

                xr = (-dx if mirrored else dx) / radius
                yr = dy / radius
                lit = xr >= -k * math.sqrt(max(0.0, 1.0 - yr * yr))

                if away <= radius and lit:
                    noise = fbm(x / 9.0, y / 9.0, 7 + phase, 3)
                    grid[oy + y][ox + x] = mix(surface, shade, clamp((noise - 0.45) * 2.2))
                elif phase != 4 and lit:
                    fade = 1.0 - smoothstep(radius, halo, away)
                    alpha = round(80 * fade)
                    if alpha > 0:
                        grid[oy + y][ox + x] = (glow[0], glow[1], glow[2], alpha)
    return grid


# --------------------------------------------------------------------------
# Clouds: vanilla reads this as a flat sheet of alpha
# --------------------------------------------------------------------------

def build_clouds(size=256):
    grid = canvas(size, size)
    for y in range(size):
        for x in range(size):
            # Sampled on a torus so the sheet tiles seamlessly.
            u = x / size * 6
            v = y / size * 6
            n = fbm(u, v, 21, 5)
            n = (n + fbm(u * 2.3 + 11, v * 2.3 + 7, 33, 3)) / 2

            density = smoothstep(0.40, 0.64, n)
            if density <= 0.01:
                continue
            alpha = round(235 * density)
            tint = round(238 + 17 * density)
            grid[y][x] = (tint, tint, min(255, tint + 4), alpha)
    return grid


# --------------------------------------------------------------------------
# Grass and foliage colour maps
#
# Minecraft indexes these by temperature (x) and downfall (y), so the shape of
# the gradient decides how every biome looks. These follow the same layout as
# vanilla but push the greens a little richer and cool the dry corner down.
# --------------------------------------------------------------------------

def build_colormap(kind, size=256):
    grid = canvas(size, size, (0, 0, 0, 255))

    if kind == "grass":
        cold = (126, 176, 148, 255)
        lush = (74, 176, 62, 255)
        jungle = (44, 158, 40, 255)
        dry = (188, 184, 96, 255)
    else:
        cold = (110, 156, 132, 255)
        lush = (58, 152, 48, 255)
        jungle = (34, 138, 32, 255)
        dry = (170, 168, 84, 255)

    for y in range(size):
        for x in range(size):
            temperature = clamp(1.0 - x / (size - 1))
            downfall = clamp(1.0 - y / (size - 1)) * temperature

            warm = mix(dry, jungle, clamp(downfall * 1.35))
            cool = mix(cold, lush, clamp(downfall * 1.6))
            colour = mix(cool, warm, smoothstep(0.15, 0.85, temperature))

            # A touch more saturation than vanilla, which is most of why this
            # reads as "shader grass" rather than default grass.
            grid[y][x] = saturate(colour, 1.12)
    return grid


def saturate(colour, amount):
    r, g, b, a = colour
    grey = 0.299 * r + 0.587 * g + 0.114 * b
    return (
        round(clamp(grey + (r - grey) * amount, 0, 255)),
        round(clamp(grey + (g - grey) * amount, 0, 255)),
        round(clamp(grey + (b - grey) * amount, 0, 255)),
        a,
    )


def build_pack_icon(size=128):
    """A little scene: gradient sky, a sun, and a dark ridge."""
    grid = canvas(size, size)
    top = (86, 140, 206, 255)
    bottom = (188, 216, 240, 255)
    ridge = (26, 36, 52, 255)

    for y in range(size):
        for x in range(size):
            grid[y][x] = mix(top, bottom, y / (size - 1))

    sun = build_sun(size // 2)
    ox, oy = size // 4, size // 6
    for y in range(len(sun)):
        for x in range(len(sun[0])):
            r, g, b, a = sun[y][x]
            if a == 0:
                continue
            base = grid[oy + y][ox + x]
            grid[oy + y][ox + x] = mix(base, (r, g, b, 255), a / 255)

    for x in range(size):
        peak = size - 26 - round(18 * abs(math.sin(x / 26.0)) + 8 * fbm(x / 18.0, 0.5, 3, 2))
        for y in range(peak, size):
            grid[y][x] = ridge if y > peak + 2 else (240, 246, 255, 255)
    return grid


def preview(grid, step):
    chars = " .:-=+*#%@"
    lines = []
    for y in range(0, len(grid), step):
        line = ""
        for x in range(0, len(grid[0]), step):
            r, g, b, a = grid[y][x]
            line += " " if a < 20 else chars[min(9, int((r + g + b) / 765 * 9) + 1)]
        lines.append(line)
    return "\n".join(lines)


def main():
    environment = os.path.join(RP, "textures", "environment")
    colormap = os.path.join(RP, "textures", "colormap")

    sun = build_sun()
    moon = build_moon()
    clouds = build_clouds()

    write_png(os.path.join(environment, "sun.png"), sun)
    write_png(os.path.join(environment, "moon_phases.png"), moon)
    write_png(os.path.join(environment, "clouds.png"), clouds)
    write_png(os.path.join(colormap, "grass.png"), build_colormap("grass"))
    write_png(os.path.join(colormap, "foliage.png"), build_colormap("foliage"))

    icon = build_pack_icon()
    write_png(os.path.join(RP, "pack_icon.png"), icon)
    write_png(os.path.join(BP, "pack_icon.png"), icon)

    if "--preview" in sys.argv:
        print("=== sun ===")
        print(preview(sun, 4))
        print("\n=== clouds ===")
        print(preview(clouds, 8))

    print("Wrote sun, moon, clouds, 2 colour maps and 2 pack icons.")


if __name__ == "__main__":
    main()
