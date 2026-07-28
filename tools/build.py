#!/usr/bin/env python3
"""Validate and package Arcane Arsenal.

Checks that every JSON file parses, that manifest UUIDs are unique, that the
behaviour pack's resource-pack dependency points at the real resource pack, and
that every item icon resolves all the way down to a PNG on disk. Then zips the
two packs into dist/ArcaneArsenal.mcaddon.

Usage:  python3 tools/build.py
"""

import json
import os
import sys
import zipfile

BP = os.path.join("behavior_packs", "arcane_arsenal_bp")
RP = os.path.join("resource_packs", "arcane_arsenal_rp")
DIST = "dist"
ADDON = os.path.join(DIST, "ArcaneArsenal.mcaddon")

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

    # UUIDs must all be distinct.
    uuids = []
    for manifest in (bp_manifest, rp_manifest):
        uuids.append(manifest["header"]["uuid"])
        uuids.extend(module["uuid"] for module in manifest["modules"])
    duplicates = {u for u in uuids if uuids.count(u) > 1}
    if duplicates:
        fail(f"duplicate UUIDs across manifests: {sorted(duplicates)}")

    # The behaviour pack must depend on this resource pack.
    rp_uuid = rp_manifest["header"]["uuid"]
    dependency_uuids = [
        dep.get("uuid") for dep in bp_manifest.get("dependencies", [])
    ]
    if rp_uuid not in dependency_uuids:
        fail(f"behaviour pack does not depend on resource pack {rp_uuid}")

    # The script entry point must exist.
    for module in bp_manifest["modules"]:
        if module["type"] == "script":
            entry = os.path.join(BP, module["entry"])
            if not os.path.isfile(entry):
                fail(f"script entry not found: {entry}")

    # Icons: item -> item_texture.json key -> png on disk.
    atlas_path = os.path.join(RP, "textures", "item_texture.json")
    atlas = documents.get(atlas_path)
    if atlas is None:
        fail(f"missing {atlas_path}")
        return
    texture_data = atlas.get("texture_data", {})

    identifiers = []
    for path, doc in documents.items():
        if not path.startswith(os.path.join(BP, "items")) or doc is None:
            continue
        item = doc.get("minecraft:item", {})
        identifier = item.get("description", {}).get("identifier")
        identifiers.append(identifier)

        # minecraft:icon changed shape at format_version 1.20.60: the flat
        # "texture" string is deprecated and is silently ignored by the game,
        # which shows up in-game as an item with a completely blank icon.
        # Reject it rather than shipping an invisible weapon again.
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

        if isinstance(icon, dict):
            key = icon.get("textures", {}).get("default") or icon.get("texture")
        else:
            key = icon
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
    for path, doc in documents.items():
        if not path.startswith(os.path.join(BP, "recipes")) or doc is None:
            continue
        recipe = doc.get("minecraft:recipe_shaped", {})
        result = recipe.get("result", {})
        result_item = result.get("item") if isinstance(result, dict) else result
        if result_item and result_item.startswith("arcane:"):
            if result_item not in identifiers:
                fail(f"{path}: result '{result_item}' has no item definition")

    # Every custom item needs a display name in the language file.
    lang_path = os.path.join(RP, "texts", "en_US.lang")
    lang = ""
    if os.path.isfile(lang_path):
        with open(lang_path, encoding="utf-8") as handle:
            lang = handle.read()
    for identifier in identifiers:
        if identifier and f"item.{identifier}=" not in lang:
            fail(f"{lang_path}: no name entry for {identifier}")

    print(f"Validated {len(documents)} JSON files, {len(identifiers)} items.")


def package():
    os.makedirs(DIST, exist_ok=True)
    if os.path.exists(ADDON):
        os.remove(ADDON)

    with zipfile.ZipFile(ADDON, "w", zipfile.ZIP_DEFLATED) as archive:
        for root, folder in ((BP, "arcane_arsenal_bp"), (RP, "arcane_arsenal_rp")):
            for base, _dirs, files in os.walk(root):
                for name in sorted(files):
                    source = os.path.join(base, name)
                    arcname = os.path.join(
                        folder, os.path.relpath(source, root)
                    ).replace(os.sep, "/")
                    archive.write(source, arcname)

    size = os.path.getsize(ADDON)
    print(f"Packaged {ADDON} ({size:,} bytes)")


if __name__ == "__main__":
    validate()
    if errors:
        print("\nBuild failed:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        sys.exit(1)
    package()
