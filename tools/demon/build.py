"""Build FlyingDemonCompanion.mcaddon: generate assets, validate, package.

A .mcaddon is a plain zip whose top level contains one folder per pack, each
with a manifest.json at its root.  This script produces that zip directly
(deflate-compressed, integrity-verified after writing).
"""
import json
import os
import subprocess
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
BP = os.path.join(ROOT, "behavior_packs", "flying_demon_bp")
RP = os.path.join(ROOT, "resource_packs", "flying_demon_rp")
DIST = os.path.join(ROOT, "dist")
OUT = os.path.join(DIST, "FlyingDemonCompanion.mcaddon")


def run(script):
    subprocess.run([sys.executable, os.path.join(HERE, script)], check=True)


def add_tree(z, src, prefix):
    for base, dirs, files in os.walk(src):
        dirs.sort()
        for fn in sorted(files):
            p = os.path.join(base, fn)
            arc = prefix + "/" + os.path.relpath(p, src).replace(os.sep, "/")
            z.write(p, arc)


def main():
    run("gen_geometry.py")
    run("gen_textures.py")
    run("gen_sounds.py")
    run("validate.py")

    os.makedirs(DIST, exist_ok=True)
    if os.path.exists(OUT):
        os.remove(OUT)
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        add_tree(z, BP, "flying_demon_bp")
        add_tree(z, RP, "flying_demon_rp")

    # verify the archive really is a healthy zip with manifests in place
    with zipfile.ZipFile(OUT) as z:
        bad = z.testzip()
        if bad:
            raise SystemExit(f"corrupt entry in archive: {bad}")
        names = z.namelist()
        for need in ("flying_demon_bp/manifest.json",
                     "flying_demon_rp/manifest.json"):
            if need not in names:
                raise SystemExit(f"missing {need} in archive")
            json.loads(z.read(need))  # must be strict JSON
        print(f"packaged {len(names)} files -> {os.path.relpath(OUT, ROOT)}"
              f" ({os.path.getsize(OUT) // 1024} KiB)")


if __name__ == "__main__":
    main()
