"""Minimal dependency-free PNG writer + raster helpers (RGBA, 8-bit)."""
import struct
import zlib


class Image:
    def __init__(self, w, h, fill=(0, 0, 0, 0)):
        self.w = w
        self.h = h
        self.px = [list(fill) for _ in range(w * h)]

    def set(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            a = c[3] if len(c) > 3 else 255
            if a >= 255:
                self.px[y * self.w + x] = [c[0], c[1], c[2], 255]
            elif a > 0:
                dst = self.px[y * self.w + x]
                da = dst[3]
                out_a = a + da * (255 - a) // 255
                if out_a == 0:
                    return
                for i in range(3):
                    dst[i] = (c[i] * a + dst[i] * da * (255 - a) // 255) // out_a
                dst[3] = out_a

    def set_raw(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            a = c[3] if len(c) > 3 else 255
            self.px[y * self.w + x] = [c[0], c[1], c[2], a]

    def get(self, x, y):
        if 0 <= x < self.w and 0 <= y < self.h:
            return tuple(self.px[y * self.w + x])
        return (0, 0, 0, 0)

    def rect(self, x, y, w, h, c):
        for j in range(y, y + h):
            for i in range(x, x + w):
                self.set_raw(i, j, c)

    def save(self, path):
        raw = bytearray()
        for y in range(self.h):
            raw.append(0)  # filter: none
            for x in range(self.w):
                raw.extend(self.px[y * self.w + x])

        def chunk(tag, data):
            out = struct.pack(">I", len(data)) + tag + data
            out += struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
            return out

        png = b"\x89PNG\r\n\x1a\n"
        png += chunk(b"IHDR", struct.pack(">IIBBBBB", self.w, self.h, 8, 6, 0, 0, 0))
        png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        png += chunk(b"IEND", b"")
        with open(path, "wb") as f:
            f.write(png)


def lerp(a, b, t):
    return a + (b - a) * t


def mix(c1, c2, t):
    return tuple(int(round(lerp(c1[i], c2[i], t))) for i in range(3)) + (
        int(round(lerp(c1[3] if len(c1) > 3 else 255, c2[3] if len(c2) > 3 else 255, t))),
    )


def shade(c, f):
    """Multiply RGB by factor f, keep alpha."""
    return (
        max(0, min(255, int(c[0] * f))),
        max(0, min(255, int(c[1] * f))),
        max(0, min(255, int(c[2] * f))),
        c[3] if len(c) > 3 else 255,
    )
