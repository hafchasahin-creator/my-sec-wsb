#!/usr/bin/env python3
"""Validate and package Skyline Parkour.

Checks that every JSON file parses, that manifest UUIDs are unique (including
against the other add-on in this repo, so both can be installed side by side),
that the behaviour pack's resource-pack dependency points at the real resource
pack, that every `import` in the scripts resolves to a file on disk, and that
every item icon resolves all the way down to a PNG. Then zips the two packs
into dist/SkylineParkour.mcaddon.

Usage:  python3 tools/build_parkour.py
"""

import json
import os
import re
import sys
import zipfile

BP = os.path.join("behavior_packs", "skyline_parkour_bp")
RP = os.path.join("resource_packs", "skyline_parkour_rp")
OTHER_MANIFESTS = (
    os.path.join("behavior_packs", "arcane_arsenal_bp", "manifest.json"),
    os.path.join("resource_packs", "arcane_arsenal_rp", "manifest.json"),
)
DIST = "dist"
ADDON = os.path.join(DIST, "SkylineParkour.mcaddon")
BP_PACK = os.path.join(DIST, "SkylineParkour_BP.mcpack")
RP_PACK = os.path.join(DIST, "SkylineParkour_RP.mcpack")
NAMESPACE = "parkour:"

IMPORT_RE = re.compile(r"""from\s+["']([^"']+)["']""")
KNOWN_MODULES = {"@minecraft/server", "@minecraft/server-ui"}

errors = []


def fail(message):
    errors.append(message)


def load_json(path):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except Exception as exc:  # noqa: BLE001 - report and keep going
        fail(f"{path}: invalid JSON ({exc})")
        return None


def walk_json(root):
    for base, _dirs, files in os.walk(root):
        for name in sorted(files):
            if name.endswith(".json"):
                yield os.path.join(base, name)


def manifest_uuids(manifest):
    uuids = [manifest["header"]["uuid"]]
    uuids.extend(module["uuid"] for module in manifest["modules"])
    return uuids


def check_scripts(bp_manifest):
    """Every script module entry, and every relative import it pulls in, exists."""
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
        with open(path, encoding="utf-8") as handle:
            source = handle.read()
        for target in IMPORT_RE.findall(source):
            if target in KNOWN_MODULES:
                continue
            if not target.startswith("."):
                fail(f"{path}: imports unknown module '{target}'")
                continue
            resolved = os.path.normpath(os.path.join(os.path.dirname(path), target))
            if not os.path.isfile(resolved):
                fail(f"{path}: import '{target}' does not resolve to {resolved}")
                continue
            queue.append(resolved)

    unused = {
        os.path.join(base, name)
        for base, _dirs, files in os.walk(os.path.join(BP, "scripts"))
        for name in files
        if name.endswith(".js")
    } - seen
    for path in sorted(unused):
        fail(f"{path}: not reachable from the script entry point")


def validate():
    documents = {}
    for root in (BP, RP):
        if not os.path.isdir(root):
            fail(f"missing pack directory: {root}")
            continue
        for path in walk_json(root):
            documents[path] = load_json(path)

    bp_manifest = documents.get(os.path.join(BP, "manifest.json"))
    rp_manifest = documents.get(os.path.join(RP, "manifest.json"))
    if not bp_manifest or not rp_manifest:
        return

    # UUIDs must be distinct here and against the other add-on in the repo.
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

    # The behaviour pack must depend on this resource pack and on both modules.
    dependencies = bp_manifest.get("dependencies", [])
    rp_uuid = rp_manifest["header"]["uuid"]
    if rp_uuid not in [dep.get("uuid") for dep in dependencies]:
        fail(f"behaviour pack does not depend on resource pack {rp_uuid}")
    module_names = {dep.get("module_name") for dep in dependencies}
    for required in KNOWN_MODULES:
        if required not in module_names:
            fail(f"{BP}/manifest.json: missing dependency on {required}")

    check_scripts(bp_manifest)

    # Icons: item -> item_texture.json key -> png on disk.
    atlas_path = os.path.join(RP, "textures", "item_texture.json")
    atlas = documents.get(atlas_path)
    if atlas is None:
        fail(f"missing {atlas_path}")
        return
    texture_data = atlas.get("texture_data", {})

    identifiers = []
    for path, doc in sorted(documents.items()):
        if not path.startswith(os.path.join(BP, "items")) or doc is None:
            continue
        item = doc.get("minecraft:item", {})
        identifier = item.get("description", {}).get("identifier")
        identifiers.append(identifier)
        if identifier and not identifier.startswith(NAMESPACE):
            fail(f"{path}: identifier '{identifier}' is outside the {NAMESPACE} namespace")

        # minecraft:icon changed shape at format_version 1.20.60: the flat
        # "texture" string is deprecated and is silently ignored by the game,
        # which shows up in-game as an item with a completely blank icon.
        version = tuple(
            int(part) for part in str(doc.get("format_version", "0")).split(".")
        )
        icon = item.get("components", {}).get("minecraft:icon")
        if isinstance(icon, dict) and "texture" in icon and version >= (1, 20, 60):
            fail(
                f"{path}: minecraft:icon uses the deprecated 'texture' field at "
                f"format_version {doc['format_version']} - use "
                f'{{"textures": {{"default": ...}}}} instead'
            )
            continue

        key = icon.get("textures", {}).get("default") if isinstance(icon, dict) else icon
        if not key:
            fail(f"{path}: no minecraft:icon texture")
            continue
        if key not in texture_data:
            fail(f"{path}: icon '{key}' missing from item_texture.json")
            continue
        png = os.path.join(RP, texture_data[key]["textures"] + ".png")
        if not os.path.isfile(png):
            fail(f"{path}: icon '{key}' points at missing file {png}")

    # Recipes must produce items that actually exist.
    recipes = 0
    for path, doc in sorted(documents.items()):
        if not path.startswith(os.path.join(BP, "recipes")) or doc is None:
            continue
        recipes += 1
        recipe = doc.get("minecraft:recipe_shaped", {})
        result = recipe.get("result", {})
        result_item = result.get("item") if isinstance(result, dict) else result
        if result_item and result_item.startswith(NAMESPACE):
            if result_item not in identifiers:
                fail(f"{path}: result '{result_item}' has no item definition")
        pattern = recipe.get("pattern", [])
        keys = set(recipe.get("key", {}))
        used = {char for row in pattern for char in row if char != " "}
        if used - keys:
            fail(f"{path}: pattern uses undefined keys {sorted(used - keys)}")
        if keys - used:
            fail(f"{path}: key defines unused symbols {sorted(keys - used)}")

    # Every custom item needs a display name in the language file.
    lang_path = os.path.join(RP, "texts", "en_US.lang")
    lang = ""
    if os.path.isfile(lang_path):
        with open(lang_path, encoding="utf-8") as handle:
            lang = handle.read()
    for identifier in identifiers:
        if identifier and f"item.{identifier}=" not in lang:
            fail(f"{lang_path}: no name entry for {identifier}")

    # Pack icons, so the packs are recognisable in the in-game list.
    for root in (BP, RP):
        if not os.path.isfile(os.path.join(root, "pack_icon.png")):
            fail(f"{root}: missing pack_icon.png")

    print(
        f"Validated {len(documents)} JSON files, {len(identifiers)} items, "
        f"{recipes} recipes."
    )


def write_zip(path, roots):
    """roots: (source directory, folder name inside the zip) pairs."""
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

    # Both packs together - one tap installs everything.
    write_zip(ADDON, ((BP, "skyline_parkour_bp"), (RP, "skyline_parkour_rp")))

    # And each pack on its own, for installing them one at a time. A .mcpack
    # holds a single pack at the root of the zip, not in a subfolder.
    write_zip(BP_PACK, ((BP, ""),))
    write_zip(RP_PACK, ((RP, ""),))


if __name__ == "__main__":
    validate()
    if errors:
        print("\nBuild failed:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        sys.exit(1)
    package()
