#!/usr/bin/env python3
"""Validate and package Aurora Visuals.

The failure mode for a visuals pack is silence: a texture at the wrong path or
a fog id with a typo changes nothing at all and reports nothing. So this checks
the exact vanilla paths the textures have to live at, that every fog the script
asks for exists in the resource pack, and that every fog file is actually used.

Usage:  python3 tools/build_aurora.py
"""

import json
import os
import re
import struct
import sys
import zipfile

BP = os.path.join("behavior_packs", "aurora_visuals_bp")
RP = os.path.join("resource_packs", "aurora_visuals_rp")
OTHER_MANIFESTS = (
    os.path.join("behavior_packs", "arcane_arsenal_bp", "manifest.json"),
    os.path.join("resource_packs", "arcane_arsenal_rp", "manifest.json"),
    os.path.join("behavior_packs", "skyline_parkour_bp", "manifest.json"),
    os.path.join("resource_packs", "skyline_parkour_rp", "manifest.json"),
    os.path.join("behavior_packs", "bodyguard_bp", "manifest.json"),
    os.path.join("resource_packs", "bodyguard_rp", "manifest.json"),
    os.path.join("behavior_packs", "super_powers_bp", "manifest.json"),
    os.path.join("resource_packs", "super_powers_rp", "manifest.json"),
)
DIST = "dist"
ADDON = os.path.join(DIST, "AuroraVisuals.mcaddon")
RP_PACK = os.path.join(DIST, "AuroraVisuals_RP.mcpack")
BP_PACK = os.path.join(DIST, "AuroraVisuals_BP.mcpack")

IMPORT_RE = re.compile(r"""from\s+["']([^"']+)["']""")
FOG_RE = re.compile(r"""["'](aurora:[a-z_]+)["']""")
HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")

REQUIRED_MODULES = {
    "@minecraft/server": "1.11.0",
    "@minecraft/server-ui": "1.1.0",
}

# Vanilla only reads these from exactly these paths. Anywhere else and the
# pack loads cleanly and does nothing.
REQUIRED_TEXTURES = {
    "textures/environment/sun.png": "the sun",
    "textures/environment/moon_phases.png": "the moon",
    "textures/environment/clouds.png": "the clouds",
    "textures/colormap/grass.png": "grass tint",
    "textures/colormap/foliage.png": "leaf tint",
}

errors = []


def fail(message):
    errors.append(message)


def load_json(path):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except Exception as exc:  # noqa: BLE001
        fail(f"{path}: invalid JSON ({exc})")
        return None


def read_text(path):
    if not os.path.isfile(path):
        return ""
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def walk_json(root):
    for base, _dirs, files in os.walk(root):
        for name in sorted(files):
            if name.endswith(".json"):
                yield os.path.join(base, name)


def script_files():
    for base, _dirs, files in os.walk(os.path.join(BP, "scripts")):
        for name in sorted(files):
            if name.endswith(".js"):
                yield os.path.join(base, name)


def manifest_uuids(manifest):
    uuids = [manifest["header"]["uuid"]]
    uuids.extend(module["uuid"] for module in manifest["modules"])
    return uuids


def png_size(path):
    """Width and height straight out of the IHDR chunk."""
    with open(path, "rb") as handle:
        header = handle.read(24)
    if header[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    return struct.unpack(">II", header[16:24])


def check_manifests(documents):
    bp_manifest = documents.get(os.path.join(BP, "manifest.json"))
    rp_manifest = documents.get(os.path.join(RP, "manifest.json"))
    if not bp_manifest or not rp_manifest:
        fail("missing a manifest")
        return None

    uuids = manifest_uuids(bp_manifest) + manifest_uuids(rp_manifest)
    duplicates = {u for u in uuids if uuids.count(u) > 1}
    if duplicates:
        fail(f"duplicate UUIDs across manifests: {sorted(duplicates)}")
    for path in OTHER_MANIFESTS:
        other = load_json(path) if os.path.isfile(path) else None
        if not other:
            continue
        clash = set(uuids) & set(manifest_uuids(other))
        if clash:
            fail(f"UUID clash with {path}: {sorted(clash)}")

    dependencies = bp_manifest.get("dependencies", [])
    if rp_manifest["header"]["uuid"] not in [dep.get("uuid") for dep in dependencies]:
        fail("behaviour pack does not depend on the resource pack")

    declared = {
        dep["module_name"]: dep.get("version")
        for dep in dependencies
        if dep.get("module_name")
    }
    for name, version in REQUIRED_MODULES.items():
        if name not in declared:
            fail(f"{BP}/manifest.json: missing dependency on {name}")
        elif declared[name] != version:
            fail(
                f"{BP}/manifest.json: {name} is pinned to {version} for "
                f"min_engine_version 1.21.0, found {declared[name]}"
            )
    return bp_manifest


def check_scripts(bp_manifest):
    entries = [
        os.path.join(BP, module["entry"])
        for module in bp_manifest["modules"]
        if module["type"] == "script"
    ]
    if not entries:
        fail(f"{BP}/manifest.json: no script module")
        return

    seen = set()
    queue = list(entries)
    while queue:
        path = queue.pop()
        if path in seen:
            continue
        seen.add(path)
        if not os.path.isfile(path):
            fail(f"script file not found: {path}")
            continue
        for target in IMPORT_RE.findall(read_text(path)):
            if target in REQUIRED_MODULES:
                continue
            if not target.startswith("."):
                fail(f"{path}: imports unknown module '{target}'")
                continue
            resolved = os.path.normpath(os.path.join(os.path.dirname(path), target))
            if not os.path.isfile(resolved):
                fail(f"{path}: import '{target}' does not resolve to {resolved}")
                continue
            queue.append(resolved)

    for path in sorted(set(script_files()) - seen):
        fail(f"{path}: not reachable from the script entry point")


def check_fogs(documents):
    defined = {}
    for path, doc in sorted(documents.items()):
        if not path.startswith(os.path.join(RP, "fogs")) or doc is None:
            continue
        settings = doc.get("minecraft:fog_settings", {})
        identifier = settings.get("description", {}).get("identifier")
        if not identifier:
            fail(f"{path}: no fog identifier")
            continue
        if identifier in defined:
            fail(f"{path}: identifier '{identifier}' is already used by {defined[identifier]}")
        defined[identifier] = path

        distance = settings.get("distance", {})
        if not distance:
            fail(f"{path}: no distance fog, so this definition changes nothing")
        for section, values in distance.items():
            colour = values.get("fog_color")
            if not colour or not HEX_RE.match(str(colour)):
                fail(f"{path}: {section} fog_color {colour!r} is not a #rrggbb colour")
            start, end = values.get("fog_start"), values.get("fog_end")
            if start is None or end is None:
                fail(f"{path}: {section} is missing fog_start or fog_end")
            elif start > end:
                fail(f"{path}: {section} fog_start {start} is beyond fog_end {end}")

    referenced = set()
    for path in script_files():
        referenced.update(FOG_RE.findall(read_text(path)))

    for identifier in sorted(referenced - set(defined)):
        fail(f"scripts ask for fog '{identifier}', which no file in {RP}/fogs defines")
    for identifier in sorted(set(defined) - referenced):
        fail(f"{defined[identifier]}: '{identifier}' is never used by the scripts")

    return defined


def check_textures():
    for relative, what in REQUIRED_TEXTURES.items():
        path = os.path.join(RP, relative.replace("/", os.sep))
        if not os.path.isfile(path):
            fail(f"missing {relative} - {what} would stay vanilla")
            continue
        size = png_size(path)
        if not size:
            fail(f"{relative}: not a PNG")
        elif relative.endswith("colormap/grass.png") or relative.endswith("colormap/foliage.png"):
            if size != (256, 256):
                fail(f"{relative}: colour maps must be 256x256, found {size[0]}x{size[1]}")
        elif relative.endswith("moon_phases.png"):
            if size[0] != size[1] * 2:
                fail(
                    f"{relative}: the moon sheet is four phases by two, so it must be "
                    f"twice as wide as it is tall, found {size[0]}x{size[1]}"
                )
        elif size[0] != size[1]:
            fail(f"{relative}: expected a square texture, found {size[0]}x{size[1]}")


def check_biomes(documents):
    path = os.path.join(RP, "biomes_client.json")
    doc = documents.get(path)
    if doc is None:
        return 0
    biomes = doc.get("biomes", {})
    for name, values in biomes.items():
        for field in ("water_surface_color", "water_fog_color"):
            colour = values.get(field)
            if colour and not HEX_RE.match(str(colour)):
                fail(f"{path}: {name}.{field} {colour!r} is not a #rrggbb colour")
        transparency = values.get("water_surface_transparency")
        if transparency is not None and not 0 <= transparency <= 1:
            fail(f"{path}: {name}.water_surface_transparency must be between 0 and 1")
    return len(biomes)


def validate():
    documents = {}
    for root in (BP, RP):
        if not os.path.isdir(root):
            fail(f"missing pack directory: {root}")
            continue
        for path in walk_json(root):
            documents[path] = load_json(path)

    bp_manifest = check_manifests(documents)
    if bp_manifest is None:
        return

    check_scripts(bp_manifest)
    fogs = check_fogs(documents)
    check_textures()
    biomes = check_biomes(documents)

    for root in (BP, RP):
        if not os.path.isfile(os.path.join(root, "pack_icon.png")):
            fail(f"{root}: missing pack_icon.png")

    print(
        f"Validated {len(documents)} JSON files, {len(fogs)} fogs, "
        f"{len(REQUIRED_TEXTURES)} sky textures, {biomes} biome water colours."
    )


def write_zip(path, roots):
    if os.path.exists(path):
        os.remove(path)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for root, folder in roots:
            for base, _dirs, files in os.walk(root):
                for name in sorted(files):
                    source = os.path.join(base, name)
                    inner = os.path.relpath(source, root)
                    arcname = (
                        os.path.join(folder, inner) if folder else inner
                    ).replace(os.sep, "/")
                    archive.write(source, arcname)
    print(f"Packaged {path} ({os.path.getsize(path):,} bytes)")


def package():
    os.makedirs(DIST, exist_ok=True)
    write_zip(ADDON, ((BP, "aurora_visuals_bp"), (RP, "aurora_visuals_rp")))
    write_zip(RP_PACK, ((RP, ""),))
    write_zip(BP_PACK, ((BP, ""),))


if __name__ == "__main__":
    validate()
    if errors:
        print("\nBuild failed:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        sys.exit(1)
    package()
