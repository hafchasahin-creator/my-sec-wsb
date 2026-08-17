#!/usr/bin/env python3
"""Package the Beautiful Base House behavior pack.

Validates the pack's JSON and function file, zips it into
dist/BaseHouse.mcaddon, and re-embeds the pack contents into the
single-file generator page base_house_generator.html (so the page and
the pack can never drift apart -- rerun this after editing the pack).

Usage:  python3 tools/build_base_house.py
"""

import base64
import json
import os
import sys
import zipfile

BP = os.path.join("behavior_packs", "base_house_bp")
ADDON = os.path.join("dist", "BaseHouse.mcaddon")
PAGE = "base_house_generator.html"

MANIFEST = os.path.join(BP, "manifest.json")
FUNCTION = os.path.join(BP, "functions", "base", "house.mcfunction")
ICON = os.path.join(BP, "pack_icon.png")


def main():
    with open(MANIFEST, encoding="utf-8") as fh:
        manifest = json.load(fh)  # raises if invalid
    with open(FUNCTION, encoding="utf-8") as fh:
        function_text = fh.read()
    with open(ICON, "rb") as fh:
        icon = fh.read()

    commands = [
        line for line in function_text.splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]
    if not commands:
        sys.exit(f"{FUNCTION}: no commands found")
    if manifest["modules"][0]["type"] != "data":
        sys.exit(f"{MANIFEST}: first module must be a data module")

    os.makedirs("dist", exist_ok=True)
    with zipfile.ZipFile(ADDON, "w", zipfile.ZIP_DEFLATED) as archive:
        for base, _dirs, files in os.walk(BP):
            for name in sorted(files):
                source = os.path.join(base, name)
                arcname = os.path.join(
                    "base_house_bp", os.path.relpath(source, BP)
                ).replace(os.sep, "/")
                archive.write(source, arcname)
    print(f"Packaged {ADDON} ({os.path.getsize(ADDON):,} bytes, "
          f"{len(commands)} commands)")

    # Refresh the embedded copies inside the generator page, if present.
    template = PAGE if os.path.isfile(PAGE) else None
    if template is None:
        print(f"note: {PAGE} not found, skipped page refresh")
        return
    with open(template, encoding="utf-8") as fh:
        html = fh.read()

    import re
    replacements = [
        (r"const MANIFEST = .*?;\n",
         "const MANIFEST = " + json.dumps(manifest, indent=2) + ";\n"),
        (r"const FUNCTION_HOUSE = .*?;\n",
         "const FUNCTION_HOUSE = " + json.dumps(function_text) + ";\n"),
        (r'const ICON_B64 = ".*?";',
         'const ICON_B64 = "' + base64.b64encode(icon).decode() + '";'),
    ]
    for pattern, replacement in replacements:
        html, count = re.subn(pattern, lambda _m: replacement, html,
                              count=1, flags=re.S)
        if count != 1:
            sys.exit(f"{PAGE}: could not find block for {pattern!r}")
    with open(PAGE, "w", encoding="utf-8") as fh:
        fh.write(html)
    print(f"Refreshed {PAGE} ({os.path.getsize(PAGE):,} bytes)")


if __name__ == "__main__":
    main()
