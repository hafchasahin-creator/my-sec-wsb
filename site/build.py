#!/usr/bin/env python3
"""Build the profile page from template.html.

Two outputs are produced from the same template:

  index.html         every asset inlined as a data URI -> one truly standalone file
  index-linked.html  assets referenced from ./assets/  -> small file, better for hosting

Usage:
    python3 build.py            # build both
    python3 build.py --inline   # only index.html
    python3 build.py --linked   # only index-linked.html
"""

import base64
import mimetypes
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "assets"
TEMPLATE = ROOT / "template.html"

# token -> asset file
FILES = {
    "FONT_URI": "Angel_wish.ttf",
    "MONO_URI": "mono.woff2",
    "BG_URI": "background.jpg",
    "AVATAR_URI": "avatar.png",
    "COVER_URI": "cover-placeholder.jpg",
    "SONG_URI": "song.mp3",
}

EXTRA_TYPES = {".ttf": "font/ttf", ".gif": "image/gif", ".mp3": "audio/mpeg"}


def mime_for(path: Path) -> str:
    if path.suffix in EXTRA_TYPES:
        return EXTRA_TYPES[path.suffix]
    return mimetypes.guess_type(path.name)[0] or "application/octet-stream"


def data_uri(path: Path) -> str:
    payload = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime_for(path)};base64,{payload}"


def render(template: str, inline: bool) -> str:
    out = template
    for token, filename in FILES.items():
        path = ASSETS / filename
        if not path.exists():
            raise SystemExit(f"missing asset: {path}")
        value = data_uri(path) if inline else f"assets/{filename}"
        # tokens are always substituted where a quoted string is expected
        out = out.replace("{{" + token + "}}", '"' + value + '"')
    return out


def write(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")
    print(f"{path.name:<20} {len(content.encode('utf-8')) / 1024 / 1024:6.2f} MB")


def main() -> None:
    args = set(sys.argv[1:])
    both = not (args & {"--inline", "--linked"})
    template = TEMPLATE.read_text(encoding="utf-8")

    if both or "--inline" in args:
        write(ROOT / "index.html", render(template, inline=True))
    if both or "--linked" in args:
        write(ROOT / "index-linked.html", render(template, inline=False))


if __name__ == "__main__":
    main()
