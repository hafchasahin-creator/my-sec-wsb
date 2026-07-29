#!/usr/bin/env python3
"""Validate and package every add-on in this repository.

Checks that every JSON file parses, that manifest UUIDs are unique across all
packs, that each behaviour pack's resource-pack dependency points at the real
resource pack, and that every item icon resolves all the way down to a PNG on
disk. Then zips each pack pair into its own .mcaddon under dist/.

Usage:
    python3 tools/build.py              # all add-ons
    python3 tools/build.py one_punch    # just the one whose key matches
"""

import json
import os
import sys
import zipfile

DIST = "dist"

# key -> (behaviour pack dir, resource pack dir, output .mcaddon name)
ADDONS = {
    "arcane": (
        os.path.join("behavior_packs", "arcane_arsenal_bp"),
        os.path.join("resource_packs", "arcane_arsenal_rp"),
        "ArcaneArsenal.mcaddon",
    ),
    "one_punch": (
        os.path.join("behavior_packs", "one_punch_bp"),
        os.path.join("resource_packs", "one_punch_rp"),
        "OnePunchMan.mcaddon",
    ),
}

errors = []
seen_uuids = {}


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


def validate(key, bp, rp):
    documents = {}
    for root in (bp, rp):
        if not os.path.isdir(root):
            fail(f"[{key}] missing pack directory: {root}")
            continue
        for path in walk_json(root):
            documents[path] = load_json(path)

    bp_manifest = documents.get(os.path.join(bp, "manifest.json"))
    rp_manifest = documents.get(os.path.join(rp, "manifest.json"))
    if not bp_manifest or not rp_manifest:
        return

    # UUIDs must be distinct within this add-on *and* across every other one,
    # or Minecraft will import one pack on top of another.
    for manifest, path in ((bp_manifest, bp), (rp_manifest, rp)):
        ids = [manifest["header"]["uuid"]]
        ids.extend(module["uuid"] for module in manifest["modules"])
        for uuid in ids:
            if uuid in seen_uuids:
                fail(f"[{key}] UUID {uuid} in {path} already used by {seen_uuids[uuid]}")
            else:
                seen_uuids[uuid] = path

    # The behaviour pack must depend on this resource pack.
    rp_uuid = rp_manifest["header"]["uuid"]
    dependency_uuids = [dep.get("uuid") for dep in bp_manifest.get("dependencies", [])]
    if rp_uuid not in dependency_uuids:
        fail(f"[{key}] behaviour pack does not depend on resource pack {rp_uuid}")

    # The script entry point must exist.
    for module in bp_manifest["modules"]:
        if module["type"] == "script":
            entry = os.path.join(bp, module["entry"])
            if not os.path.isfile(entry):
                fail(f"[{key}] script entry not found: {entry}")

    # Icons: item -> item_texture.json key -> png on disk.
    atlas_path = os.path.join(rp, "textures", "item_texture.json")
    atlas = documents.get(atlas_path)
    if atlas is None:
        fail(f"[{key}] missing {atlas_path}")
        return
    texture_data = atlas.get("texture_data", {})

    identifiers = []
    for path, doc in documents.items():
        if not path.startswith(os.path.join(bp, "items")) or doc is None:
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
                f"[{key}] {path}: minecraft:icon uses the deprecated 'texture' field "
                f"at format_version {doc['format_version']} - use "
                f'{{"textures": {{"default": ...}}}} instead'
            )
            continue

        if isinstance(icon, dict):
            key_name = icon.get("textures", {}).get("default") or icon.get("texture")
        else:
            key_name = icon
        if not key_name:
            fail(f"[{key}] {path}: no minecraft:icon texture")
            continue
        if key_name not in texture_data:
            fail(f"[{key}] {path}: icon '{key_name}' missing from item_texture.json")
            continue
        png = os.path.join(rp, texture_data[key_name]["textures"] + ".png")
        if not os.path.isfile(png):
            fail(f"[{key}] {path}: icon '{key_name}' points at missing file {png}")

    # Recipes must produce items that actually exist. Anything outside the
    # minecraft: namespace has to be one of ours.
    for path, doc in documents.items():
        if not path.startswith(os.path.join(bp, "recipes")) or doc is None:
            continue
        recipe = doc.get("minecraft:recipe_shaped", {})
        result = recipe.get("result", {})
        result_item = result.get("item") if isinstance(result, dict) else result
        if result_item and not result_item.startswith("minecraft:"):
            if result_item not in identifiers:
                fail(f"[{key}] {path}: result '{result_item}' has no item definition")

    # Every custom item needs a display name in the language file.
    lang_path = os.path.join(rp, "texts", "en_US.lang")
    lang = ""
    if os.path.isfile(lang_path):
        with open(lang_path, encoding="utf-8") as handle:
            lang = handle.read()
    for identifier in identifiers:
        if identifier and f"item.{identifier}=" not in lang:
            fail(f"[{key}] {lang_path}: no name entry for {identifier}")

    print(f"[{key}] validated {len(documents)} JSON files, {len(identifiers)} items.")


def package(key, bp, rp, addon_name):
    os.makedirs(DIST, exist_ok=True)
    addon = os.path.join(DIST, addon_name)
    if os.path.exists(addon):
        os.remove(addon)

    with zipfile.ZipFile(addon, "w", zipfile.ZIP_DEFLATED) as archive:
        for root in (bp, rp):
            folder = os.path.basename(root)
            for base, _dirs, files in os.walk(root):
                for name in sorted(files):
                    source = os.path.join(base, name)
                    arcname = os.path.join(
                        folder, os.path.relpath(source, root)
                    ).replace(os.sep, "/")
                    archive.write(source, arcname)

    size = os.path.getsize(addon)
    print(f"[{key}] packaged {addon} ({size:,} bytes)")


def main():
    wanted = sys.argv[1:] or list(ADDONS)
    unknown = [name for name in wanted if name not in ADDONS]
    if unknown:
        print(f"unknown add-on(s): {', '.join(unknown)}", file=sys.stderr)
        print(f"known: {', '.join(ADDONS)}", file=sys.stderr)
        return 2

    for key in wanted:
        bp, rp, addon_name = ADDONS[key]
        validate(key, bp, rp)

    if errors:
        print("\nBuild failed:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        return 1

    for key in wanted:
        bp, rp, addon_name = ADDONS[key]
        package(key, bp, rp, addon_name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
