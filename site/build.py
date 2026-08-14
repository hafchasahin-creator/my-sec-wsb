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

# token -> asset file. BG_URI is resolved at build time so that dropping a
# background.mp4 (or .webm/.png/...) into assets/ is all it takes to swap the
# backdrop — the page renders a video or an image to match.
FILES = {
    "FONT_URI": "Angel_wish.ttf",
    "MONO_URI": "mono.woff2",
    "BG_URI": None,
    "BGVIDEO_URI": "background-clip.mp4",   # optional; "" when absent
    "PFPVIDEO_URI": "profile-clip.mp4",     # optional; "" when absent
    "AVATAR_URI": "avatar.png",
    "COVER_URI": "cover-placeholder.jpg",
    "SONG_URI": "song.mp3",
}

# tokens the page can live without — a missing file becomes an empty string
OPTIONAL = {"BGVIDEO_URI", "PFPVIDEO_URI"}

# videos are never inlined, even in single-file builds; streaming from assets/
# allows proper buffering and range requests on Android
NEVER_INLINE = {"background-clip.mp4", "profile-clip.mp4"}

# first match wins; video before image so a dropped-in clip takes over
BACKGROUND_CANDIDATES = ["background.mp4", "background.webm", "background.jpg",
                         "background.png", "background.jpeg", "background.gif"]


def resolve_background() -> str:
    for name in BACKGROUND_CANDIDATES:
        if (ASSETS / name).exists():
            return name
    raise SystemExit(f"no background found in {ASSETS} (looked for: "
                     + ", ".join(BACKGROUND_CANDIDATES) + ")")


def background_stills() -> list:
    """The still artwork, in the order the page rotates through it.

    `background.*` leads, then every `still-*` file in name order — so extra
    photos join the rotation just by being dropped into assets/ as
    still-1.jpg, still-2.jpg and so on.
    """
    stills = []
    primary = resolve_background()
    if not primary.lower().endswith((".mp4", ".webm", ".ogv")):
        stills.append(primary)
    stills += sorted(p.name for p in ASSETS.glob("still-*")
                     if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".gif", ".webp"})
    return stills

EXTRA_TYPES = {".ttf": "font/ttf", ".gif": "image/gif", ".mp3": "audio/mpeg",
               ".woff2": "font/woff2", ".mp4": "video/mp4", ".webm": "video/webm"}

# Video is inlined only while it stays small enough for the single file to
# remain openable on a phone; past this it streams from assets/ instead.
INLINE_VIDEO_LIMIT = 8 * 1024 * 1024


def mime_for(path: Path) -> str:
    if path.suffix in EXTRA_TYPES:
        return EXTRA_TYPES[path.suffix]
    return mimetypes.guess_type(path.name)[0] or "application/octet-stream"


def data_uri(path: Path) -> str:
    payload = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime_for(path)};base64,{payload}"


def asset_value(filename: str, inline: bool) -> str:
    """A data URI when inlining, otherwise a path under assets/."""
    path = ASSETS / filename
    # videos in NEVER_INLINE are always streamed, even when inlining other assets
    if filename in NEVER_INLINE:
        return f"assets/{filename}"
    video = path.suffix.lower() in {".mp4", ".webm", ".ogv"}
    embed = inline and (not video or path.stat().st_size <= INLINE_VIDEO_LIMIT)
    return data_uri(path) if embed else f"assets/{filename}"


def render(template: str, inline: bool) -> str:
    # the still rotation is emitted as a JS array literal
    stills = background_stills()
    out = template.replace(
        "{{BG_URI}}",
        "[\n" + "".join(f'        "{asset_value(n, inline)}",\n' for n in stills) + "    ]"
    )

    for token, filename in FILES.items():
        if token == "BG_URI":
            continue                      # handled above
        path = ASSETS / filename

        if not path.exists():
            if token in OPTIONAL:
                out = out.replace("{{" + token + "}}", '""')
                continue
            raise SystemExit(f"missing asset: {path}")

        value = asset_value(filename, inline)
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
