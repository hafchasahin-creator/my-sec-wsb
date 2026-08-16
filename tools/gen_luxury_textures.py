#!/usr/bin/env python3
"""Generate the item icons and pack icons for the Luxury Tech House add-on.

Pure standard library (zlib + struct), so the pack can be rebuilt on any
machine without Pillow or other image tooling installed.

Usage:  python3 tools/gen_luxury_textures.py [--preview]
"""

import os
import struct
import sys
import zlib

RP = os.path.join("resource_packs", "luxury_tech_house_rp")
BP = os.path.join("behavior_packs", "luxury_tech_house_bp")
ITEM_DIR = os.path.join(RP, "textures", "items")

T = (0, 0, 0, 0)  # transparent


# --------------------------------------------------------------------------
# PNG output
# --------------------------------------------------------------------------

def write_png(path, pixels):
    """pixels: list of rows, each row a list of (r, g, b, a) tuples."""
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
    return path


def from_art(art, palette, size=16):
    """Turn a list of strings into a pixel grid using a character palette."""
    if len(art) != size:
        raise ValueError(f"art has {len(art)} rows, expected {size}")
    rows = []
    for line in art:
        if len(line) != size:
            raise ValueError(f"art row {line!r} is {len(line)} wide, expected {size}")
        rows.append([palette[ch] for ch in line])
    return rows


def scale(pixels, factor):
    out = []
    for row in pixels:
        big = [px for px in row for _ in range(factor)]
        for _ in range(factor):
            out.append(list(big))
    return out


# --------------------------------------------------------------------------
# Icon 1 - Luxury Tech House Builder
#
# A white mansion silhouette floating over a cyan holographic projector pad,
# the way a blueprint projection would read at 16x16.
# --------------------------------------------------------------------------

BUILDER_PALETTE = {
    ".": T,
    "o": (12, 18, 28, 255),      # outline / shadow
    "w": (240, 244, 248, 255),   # white facade
    "g": (198, 208, 218, 255),   # grey facade shading
    "b": (28, 36, 48, 255),      # dark glass band
    "c": (96, 226, 255, 255),    # cyan hologram
    "C": (168, 244, 255, 255),   # cyan highlight
    "d": (24, 122, 158, 255),    # cyan shadow
    "y": (255, 214, 102, 255),   # warm window light
}

BUILDER_ART = [
    "................",
    ".......oo.......",
    "......oCCo......",
    ".....occcco.....",
    "....owwwwwwo....",
    "....owybywyo....",
    "....obbbbbbo....",
    "...owwwwwwwwo...",
    "...owybbbbywo...",
    "...obbbbbbbbo...",
    "..owwwwwwwwwwo..",
    "..owyybbbbyywo..",
    "..oggggggggggo..",
    "..occccccccccd..",
    ".odCCCCCCCCCCdo.",
    "...oddddddddo...",
]

# --------------------------------------------------------------------------
# Icon 2 - Mansion Tech Remote
#
# A slim black smart-home handset with a cyan screen, a red panic key and a
# pair of soft-touch buttons.
# --------------------------------------------------------------------------

REMOTE_PALETTE = {
    ".": T,
    "o": (10, 12, 16, 255),      # outline
    "k": (36, 40, 48, 255),      # body
    "K": (58, 64, 74, 255),      # body highlight
    "s": (24, 150, 186, 255),    # screen base
    "S": (120, 235, 255, 255),   # screen glow
    "r": (226, 58, 58, 255),     # panic key
    "R": (255, 128, 120, 255),   # panic key highlight
    "w": (226, 232, 238, 255),   # soft key
    "a": (255, 200, 84, 255),    # antenna tip
}

REMOTE_ART = [
    "..........oo....",
    "..........oao...",
    "..........oo....",
    ".....ooooooo....",
    "....okKKKKKo....",
    "....okoooooko...",
    "....okoSSSoko...",
    "....okoSsSoko...",
    "....okoSSSoko...",
    "....okoooooko...",
    "....okKwwwKko...",
    "....okKwwwKko...",
    "....okoRRRoko...",
    "....okorrroko...",
    "....okKKKKKko...",
    ".....ooooooo....",
]

# --------------------------------------------------------------------------
# Pack icon - 16x16 source, scaled to 128x128
# --------------------------------------------------------------------------

PACK_PALETTE = {
    ".": (16, 20, 28, 255),      # night sky background
    "n": (24, 32, 46, 255),      # background gradient
    "o": (8, 10, 14, 255),
    "w": (238, 243, 249, 255),
    "g": (186, 196, 208, 255),
    "c": (96, 226, 255, 255),
    "C": (176, 246, 255, 255),
    "b": (26, 34, 46, 255),
    "y": (255, 214, 102, 255),
    "p": (38, 96, 128, 255),     # pool water
}

PACK_ART = [
    "nnnnnnnnnnnnnnnn",
    "nnnnnnnnnCnnnnnn",
    "nnnnnnnnnnnnnnnn",
    "nn...oooooo...nn",
    "nn..owwwwwwo..nn",
    "nn..oybbbbyo..nn",
    "n..oowwwwwwoo..n",
    "n..oybbbbbbyo..n",
    "..oowwwwwwwwoo..",
    "..oybbbbbbbbyo..",
    ".oowwwwwwwwwwoo.",
    ".oybbbbbbbbbbyo.",
    ".oggggggggggggo.",
    ".occcccccccccco.",
    "ppppppppppppppp.",
    "pCpppCpppCpppCp.",
]


def main():
    written = []
    written.append(
        write_png(
            os.path.join(ITEM_DIR, "house_builder.png"),
            from_art(BUILDER_ART, BUILDER_PALETTE),
        )
    )
    written.append(
        write_png(
            os.path.join(ITEM_DIR, "tech_remote.png"),
            from_art(REMOTE_ART, REMOTE_PALETTE),
        )
    )

    pack_icon = scale(from_art(PACK_ART, PACK_PALETTE), 8)
    for root in (RP, BP):
        written.append(write_png(os.path.join(root, "pack_icon.png"), pack_icon))

    for path in written:
        print(f"wrote {path} ({os.path.getsize(path):,} bytes)")

    if "--preview" in sys.argv:
        for name, art in (("builder", BUILDER_ART), ("remote", REMOTE_ART)):
            print(f"\n{name}:")
            for line in art:
                print("  " + line.replace(".", " "))


if __name__ == "__main__":
    main()
