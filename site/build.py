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

def read_id3(path: Path) -> dict:
    """Title and artist out of an ID3v2 tag, so the playlist names itself.

    Only the two text frames the page shows are read (TIT2/TPE1), which keeps
    this to a few lines instead of pulling in a tag library.
    """
    try:
        raw = path.read_bytes()
    except OSError:
        return {}
    if raw[:3] != b"ID3":
        return {}

    major = raw[3]
    # the tag length is stored synchsafe: 7 bits per byte
    size = 0
    for b in raw[6:10]:
        size = (size << 7) | (b & 0x7F)
    body, pos, found = raw[10:10 + size], 0, {}

    while pos + 10 <= len(body):
        frame = body[pos:pos + 4]
        if not frame.strip(b"\0"):
            break                                   # hit the padding
        if major >= 4:                              # v2.4 sizes are synchsafe too
            fsize = 0
            for b in body[pos + 4:pos + 8]:
                fsize = (fsize << 7) | (b & 0x7F)
        else:
            fsize = int.from_bytes(body[pos + 4:pos + 8], "big")
        payload = body[pos + 10:pos + 10 + fsize]
        pos += 10 + fsize

        if frame not in (b"TIT2", b"TPE1") or not payload:
            continue
        enc, text = payload[0], payload[1:]
        codec = {0: "latin-1", 1: "utf-16", 2: "utf-16-be", 3: "utf-8"}.get(enc, "latin-1")
        try:
            value = text.decode(codec).split("\0")[0].strip()
        except (UnicodeDecodeError, LookupError):
            continue
        if value:
            found["title" if frame == b"TIT2" else "artist"] = value

    return found


def playlist_tracks() -> list:
    """Every track the player cycles through, in order.

    `song.mp3` leads, then every `track-*` file in name order — so a new song
    joins the playlist just by being dropped into assets/ as track-4.mp3.
    Titles come from each file's own ID3 tag, with the filename as a fallback.
    """
    files = []
    if (ASSETS / "song.mp3").exists():
        files.append("song.mp3")
    files += sorted(p.name for p in ASSETS.glob("track-*") if p.suffix.lower() == ".mp3")

    tracks = []
    for name in files:
        tag = read_id3(ASSETS / name)
        tracks.append({
            "file": name,
            "title": tag.get("title") or Path(name).stem.replace("-", " ").title(),
            "artist": tag.get("artist") or "",
        })
    return tracks


def js_string(value: str) -> str:
    """A JS string literal — titles are arbitrary text and may carry quotes."""
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


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

    # so is the playlist, one object per track
    cover = asset_value("cover-placeholder.jpg", inline)
    entries = "".join(
        "        {{ file: \"{file}\", title: {title}, artist: {artist}, cover: \"{cover}\" }},\n".format(
            file=asset_value(t["file"], inline),
            title=js_string(t["title"]),
            artist=js_string(t["artist"]),
            cover=cover,
        )
        for t in playlist_tracks()
    )
    out = out.replace("{{PLAYLIST}}", "[\n" + entries + "    ]")

    for token, filename in FILES.items():
        if token in ("BG_URI", "SONG_URI"):
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
