#!/usr/bin/env python3
"""Validate and package the Goku Abilities add-on.

Checks that every JSON file parses, that manifest UUIDs are unique, that the
behaviour pack's resource-pack dependency points at the real resource pack,
that every item icon resolves all the way down to a PNG on disk, that every
recipe produces a real item out of real ingredients, and that every ability
item is wired to a handler in the script. Then zips the two packs into
dist/GokuAbilities.mcaddon.

Usage:  python3 tools/build_goku.py
"""

import json
import os
import re
import sys
import zipfile

NAMESPACE = "goku"
BP = os.path.join("behavior_packs", "goku_bp")
RP = os.path.join("resource_packs", "goku_rp")
DIST = "dist"
ADDON = os.path.join(DIST, "GokuAbilities.mcaddon")

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

    # UUIDs must all be distinct - inside this add-on and against the other
    # add-on in this repository, since both can be installed side by side.
    uuids = []
    for manifest in (bp_manifest, rp_manifest):
        uuids.append(manifest["header"]["uuid"])
        uuids.extend(module["uuid"] for module in manifest["modules"])
    duplicates = {u for u in uuids if uuids.count(u) > 1}
    if duplicates:
        fail(f"duplicate UUIDs across manifests: {sorted(duplicates)}")

    foreign = set()
    for other in ("behavior_packs", "resource_packs"):
        for base, _dirs, files in os.walk(other):
            if "manifest.json" not in files:
                continue
            if base in (BP, RP):
                continue
            doc = load_json(os.path.join(base, "manifest.json"))
            if not doc:
                continue
            foreign.add(doc["header"]["uuid"])
            foreign.update(module["uuid"] for module in doc.get("modules", []))
    clashes = foreign.intersection(uuids)
    if clashes:
        fail(f"UUIDs collide with another add-on in this repo: {sorted(clashes)}")

    # The behaviour pack must depend on this resource pack.
    rp_uuid = rp_manifest["header"]["uuid"]
    dependency_uuids = [dep.get("uuid") for dep in bp_manifest.get("dependencies", [])]
    if rp_uuid not in dependency_uuids:
        fail(f"behaviour pack does not depend on resource pack {rp_uuid}")

    # The script entry point must exist.
    script_source = ""
    for module in bp_manifest["modules"]:
        if module["type"] == "script":
            entry = os.path.join(BP, module["entry"])
            if not os.path.isfile(entry):
                fail(f"script entry not found: {entry}")
            else:
                with open(entry, encoding="utf-8") as handle:
                    script_source = handle.read()

    # Icons: item -> item_texture.json key -> png on disk.
    atlas_path = os.path.join(RP, "textures", "item_texture.json")
    atlas = documents.get(atlas_path)
    if atlas is None:
        fail(f"missing {atlas_path}")
        return
    texture_data = atlas.get("texture_data", {})

    identifiers = []
    cooldowns = {}
    for path, doc in sorted(documents.items()):
        if not path.startswith(os.path.join(BP, "items")) or doc is None:
            continue
        item = doc.get("minecraft:item", {})
        identifier = item.get("description", {}).get("identifier")
        identifiers.append(identifier)
        components = item.get("components", {})

        cooldown = components.get("minecraft:cooldown")
        if cooldown:
            cooldowns[identifier] = cooldown.get("category")

        # minecraft:icon changed shape at format_version 1.20.60: the flat
        # "texture" string is deprecated and is silently ignored by the game,
        # which shows up in-game as an item with a completely blank icon.
        version = tuple(
            int(part) for part in str(doc.get("format_version", "0")).split(".")
        )
        icon = components.get("minecraft:icon")
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

        # Without a use duration there is no use button on touch controls, so
        # the ability would be unreachable on a phone.
        if "minecraft:use_modifiers" not in components:
            fail(f"{path}: no minecraft:use_modifiers - unusable on touch controls")

        # Every ability must be handled by the script, or tapping it does nothing.
        if identifier and identifier not in script_source:
            fail(f"{path}: '{identifier}' never appears in the behaviour script")

    # The script gates each ability on the cooldown category `goku_<name>`,
    # built from the identifier at runtime. If an item declares a category that
    # does not follow that convention the HUD sweep and the script gate drift
    # apart: the icon greys out while the ability still fires, or vice versa.
    if "`goku_${" not in script_source:
        fail("behaviour script no longer derives cooldown categories as goku_<name>")
    for identifier, category in cooldowns.items():
        expected = f"goku_{identifier.split(':')[-1]}"
        if category != expected:
            fail(
                f"{identifier}: cooldown category is '{category}', but the script "
                f"gates this ability on '{expected}'"
            )

    # Recipes must produce items that exist and use ingredients that exist.
    for path, doc in sorted(documents.items()):
        if not path.startswith(os.path.join(BP, "recipes")) or doc is None:
            continue
        recipe = doc.get("minecraft:recipe_shaped", {})
        result = recipe.get("result", {})
        result_item = result.get("item") if isinstance(result, dict) else result
        if result_item and result_item.startswith(f"{NAMESPACE}:"):
            if result_item not in identifiers:
                fail(f"{path}: result '{result_item}' has no item definition")

        pattern = recipe.get("pattern", [])
        key = recipe.get("key", {})
        used = {char for row in pattern for char in row if char != " "}
        missing = used.difference(key)
        if missing:
            fail(f"{path}: pattern uses undefined key(s) {sorted(missing)}")
        unused = set(key).difference(used)
        if unused:
            fail(f"{path}: key defines unused slot(s) {sorted(unused)}")
        for slot, ingredient in key.items():
            item_id = ingredient.get("item", "")
            if item_id.startswith(f"{NAMESPACE}:") and item_id not in identifiers:
                fail(f"{path}: ingredient '{item_id}' ({slot}) has no item definition")

    # Every custom item needs a display name in the language file.
    lang_path = os.path.join(RP, "texts", "en_US.lang")
    lang = ""
    if os.path.isfile(lang_path):
        with open(lang_path, encoding="utf-8") as handle:
            lang = handle.read()
    for identifier in identifiers:
        if identifier and f"item.{identifier}=" not in lang:
            fail(f"{lang_path}: no name entry for {identifier}")

    # Guard against a texture that was added to the atlas but never drawn.
    for key, entry in texture_data.items():
        png = os.path.join(RP, entry["textures"] + ".png")
        if not os.path.isfile(png):
            fail(f"{atlas_path}: '{key}' points at missing file {png}")

    for pack in (BP, RP):
        if not os.path.isfile(os.path.join(pack, "pack_icon.png")):
            fail(f"{pack}: missing pack_icon.png")

    # A stray `import` of anything but @minecraft/server needs a matching
    # manifest dependency, and there is none.
    for module in re.findall(r"from\s+\"([^\"]+)\"", script_source):
        if module != "@minecraft/server":
            fail(f"script imports '{module}' with no manifest dependency for it")

    print(f"Validated {len(documents)} JSON files, {len(identifiers)} items.")


def package():
    os.makedirs(DIST, exist_ok=True)
    if os.path.exists(ADDON):
        os.remove(ADDON)

    with zipfile.ZipFile(ADDON, "w", zipfile.ZIP_DEFLATED) as archive:
        for root, folder in ((BP, "goku_bp"), (RP, "goku_rp")):
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
