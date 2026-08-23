#!/usr/bin/env python3
"""Minimal RGBA PNG writer - standard library only.

Shared by the texture generators so the packs can be rebuilt on any machine
that has Python, with no image libraries installed.
"""

import struct
import zlib

TRANSPARENT = (0, 0, 0, 0)


def new_grid(width, height, fill=TRANSPARENT):
    """A height x width grid of RGBA tuples, indexed grid[row][col]."""
    return [[fill for _ in range(width)] for _ in range(height)]


def write_png(path, pixels):
    """pixels: list of rows, each row a list of (r, g, b, a) tuples."""
    height = len(pixels)
    width = len(pixels[0]) if height else 0
    if any(len(row) != width for row in pixels):
        raise ValueError("write_png: rows have inconsistent widths")

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

    with open(path, "wb") as handle:
        handle.write(blob)


def scale_nearest(pixels, factor):
    """Nearest-neighbour upscale - keeps pixel art crisp."""
    out = []
    for row in pixels:
        wide = [px for px in row for _ in range(factor)]
        out.extend([list(wide) for _ in range(factor)])
    return out


def from_ascii(art, palette):
    """Build a grid from a list of equal-length strings and a char -> RGBA map.

    Any character missing from the palette is transparent.
    """
    height = len(art)
    width = len(art[0]) if height else 0
    if any(len(line) != width for line in art):
        bad = [i for i, line in enumerate(art) if len(line) != width]
        raise ValueError(f"from_ascii: rows {bad} are not {width} chars wide")
    return [[palette.get(ch, TRANSPARENT) for ch in line] for line in art]


def read_png_size(path):
    """(width, height) from a PNG's IHDR chunk, without decoding pixels."""
    with open(path, "rb") as handle:
        header = handle.read(24)
    if len(header) < 24 or header[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path}: not a PNG")
    if header[12:16] != b"IHDR":
        raise ValueError(f"{path}: first chunk is not IHDR")
    return struct.unpack(">II", header[16:24])
