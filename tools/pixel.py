#!/usr/bin/env python3
"""Tiny standard-library pixel canvas + PNG writer.

No Pillow, no numpy - the packs have to be rebuildable on a bare machine.
"""

import math
import struct
import zlib

CLEAR = (0, 0, 0, 0)


class Rng:
    """Deterministic LCG so every rebuild produces byte-identical textures."""

    def __init__(self, seed):
        self.state = (seed * 2654435761) & 0xFFFFFFFF or 1

    def next(self):
        self.state = (1664525 * self.state + 1013904223) & 0xFFFFFFFF
        return self.state

    def rand(self):
        return self.next() / 0xFFFFFFFF

    def below(self, n):
        return self.next() % n

    def between(self, lo, hi):
        return lo + self.rand() * (hi - lo)

    def chance(self, p):
        return self.rand() < p

    def pick(self, seq):
        return seq[self.below(len(seq))]


def clamp(value, lo=0, hi=255):
    return max(lo, min(hi, int(round(value))))


def rgba(color, alpha=255):
    r, g, b = color[:3]
    return (clamp(r), clamp(g), clamp(b), clamp(alpha))


def shade(color, factor):
    """factor > 1 lightens toward white, < 1 darkens toward black."""
    r, g, b = color[:3]
    if factor >= 1.0:
        t = min(1.0, factor - 1.0)
        return (
            clamp(r + (255 - r) * t),
            clamp(g + (255 - g) * t),
            clamp(b + (255 - b) * t),
        )
    return (clamp(r * factor), clamp(g * factor), clamp(b * factor))


def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return (
        clamp(a[0] + (b[0] - a[0]) * t),
        clamp(a[1] + (b[1] - a[1]) * t),
        clamp(a[2] + (b[2] - a[2]) * t),
    )


class Canvas:
    def __init__(self, width, height=None, fill=CLEAR):
        self.w = width
        self.h = height if height is not None else width
        self.px = [[fill for _ in range(self.w)] for _ in range(self.h)]

    # -- primitives -------------------------------------------------------

    def set(self, x, y, color, alpha=255):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[y][x] = rgba(color, alpha)

    def get(self, x, y):
        if 0 <= x < self.w and 0 <= y < self.h:
            return self.px[y][x]
        return CLEAR

    def opaque(self, x, y):
        return self.get(x, y)[3] > 0

    def fill_rect(self, x, y, w, h, color, alpha=255):
        for row in range(y, y + h):
            for col in range(x, x + w):
                self.set(col, row, color, alpha)

    def fill_all(self, color, alpha=255):
        self.fill_rect(0, 0, self.w, self.h, color, alpha)

    def disc(self, cx, cy, radius, color, alpha=255):
        r2 = radius * radius
        for y in range(int(cy - radius) - 1, int(cy + radius) + 2):
            for x in range(int(cx - radius) - 1, int(cx + radius) + 2):
                if (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r2:
                    self.set(x, y, color, alpha)

    def ring(self, cx, cy, radius, thickness, color, alpha=255):
        outer = radius * radius
        inner = max(0.0, radius - thickness) ** 2
        for y in range(int(cy - radius) - 1, int(cy + radius) + 2):
            for x in range(int(cx - radius) - 1, int(cx + radius) + 2):
                d = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2
                if inner <= d <= outer:
                    self.set(x, y, color, alpha)

    def line(self, x0, y0, x1, y1, color, alpha=255):
        dx, dy = abs(x1 - x0), abs(y1 - y0)
        sx = 1 if x0 < x1 else -1
        sy = 1 if y0 < y1 else -1
        err = dx - dy
        while True:
            self.set(x0, y0, color, alpha)
            if x0 == x1 and y0 == y1:
                return
            e2 = 2 * err
            if e2 > -dy:
                err -= dy
                x0 += sx
            if e2 < dx:
                err += dx
                y0 += sy

    # -- effects ----------------------------------------------------------

    def speckle(self, rng, color, density, only_opaque=True, alpha=255):
        for y in range(self.h):
            for x in range(self.w):
                if only_opaque and not self.opaque(x, y):
                    continue
                if rng.chance(density):
                    self.set(x, y, color, alpha)

    def grain(self, rng, amount, only_opaque=True):
        """Per-pixel brightness jitter; keeps textures from looking flat."""
        for y in range(self.h):
            for x in range(self.w):
                r, g, b, a = self.get(x, y)
                if a == 0 or (only_opaque and a == 0):
                    continue
                delta = (rng.rand() - 0.5) * 2 * amount
                self.px[y][x] = (
                    clamp(r + delta),
                    clamp(g + delta),
                    clamp(b + delta),
                    a,
                )

    def vertical_gradient(self, top, bottom, only_opaque=True):
        for y in range(self.h):
            t = y / max(1, self.h - 1)
            color = mix(top, bottom, t)
            for x in range(self.w):
                if only_opaque and not self.opaque(x, y):
                    continue
                a = self.get(x, y)[3]
                self.set(x, y, color, a)

    def outline(self, color, alpha=255):
        """1px border just outside every opaque pixel."""
        targets = []
        for y in range(self.h):
            for x in range(self.w):
                if self.opaque(x, y):
                    continue
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    if self.opaque(x + dx, y + dy):
                        targets.append((x, y))
                        break
        for x, y in targets:
            self.set(x, y, color, alpha)

    def darken_edges(self, color, strength=0.55):
        """Shade opaque pixels that sit next to transparency."""
        targets = []
        for y in range(self.h):
            for x in range(self.w):
                if not self.opaque(x, y):
                    continue
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    if not self.opaque(x + dx, y + dy):
                        targets.append((x, y))
                        break
        for x, y in targets:
            r, g, b, a = self.get(x, y)
            self.set(x, y, shade((r, g, b), strength), a)

    def paste(self, other, x0, y0):
        for y in range(other.h):
            for x in range(other.w):
                r, g, b, a = other.get(x, y)
                if a:
                    self.set(x0 + x, y0 + y, (r, g, b), a)

    # -- output -----------------------------------------------------------

    def to_png(self, path):
        raw = b"".join(
            b"\x00" + bytes(channel for px in row for channel in px) for row in self.px
        )

        def chunk(tag, data):
            return (
                struct.pack(">I", len(data))
                + tag
                + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
            )

        blob = b"\x89PNG\r\n\x1a\n"
        blob += chunk(b"IHDR", struct.pack(">IIBBBBB", self.w, self.h, 8, 6, 0, 0, 0))
        blob += chunk(b"IDAT", zlib.compress(raw, 9))
        blob += chunk(b"IEND", b"")
        with open(path, "wb") as handle:
            handle.write(blob)

    def ascii_preview(self):
        ramp = " .:-=+*#%@"
        out = []
        for row in self.px:
            line = []
            for r, g, b, a in row:
                if a == 0:
                    line.append(" ")
                else:
                    lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
                    line.append(ramp[min(len(ramp) - 1, int(lum * len(ramp)))])
            out.append("".join(line))
        return "\n".join(out)


def soft_dot(size=8, falloff=2.2):
    """White radial blob used as the base texture for every custom particle."""
    canvas = Canvas(size, size)
    centre = size / 2.0
    radius = size / 2.0
    for y in range(size):
        for x in range(size):
            d = math.hypot(x + 0.5 - centre, y + 0.5 - centre) / radius
            if d >= 1.0:
                continue
            a = (1.0 - d) ** falloff
            canvas.set(x, y, (255, 255, 255), clamp(a * 255))
    return canvas
