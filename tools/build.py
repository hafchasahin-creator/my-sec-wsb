#!/usr/bin/env python3
"""Validate and package every add-on in this repository.

For each add-on this checks that:
  * every JSON file parses;
  * manifest UUIDs are unique and the behaviour pack depends on its resource pack;
  * the script entry point exists;
  * every item icon and every block material instance resolves to a PNG on disk;
  * custom block geometries exist in the resource pack;
  * block permutations only test states the block actually declares;
  * recipes produce something that is really defined;
  * every custom block and item has a name in the language file.

Then it zips each pack pair into dist/<Name>.mcaddon.

Usage:  python3 tools/build.py [addon-name ...]
"""

import json
import os
import re
import sys
import zipfile

DIST = "dist"

ADDONS = [
    {
        "name": "ArcaneArsenal",
        "bp": os.path.join("behavior_packs", "arcane_arsenal_bp"),
        "rp": os.path.join("resource_packs", "arcane_arsenal_rp"),
        "namespace": "arcane",
    },
    {
        "name": "SecretBunker",
        "bp": os.path.join("behavior_packs", "secret_bunker_bp"),
        "rp": os.path.join("resource_packs", "secret_bunker_rp"),
        "namespace": "bunker",
    },
]


def load_json(path, errors):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except Exception as exc:  # noqa: BLE001 - report and keep going
        errors.append(f"{path}: invalid JSON ({exc})")
        return None


def walk_json(root):
    for base, _dirs, files in os.walk(root):
        for name in sorted(files):
            if name.endswith(".json"):
                yield os.path.join(base, name)


def atlas_lookup(rp, atlas_name, errors):
    """key -> png path, from terrain_texture.json / item_texture.json."""
    path = os.path.join(rp, "textures", atlas_name)
    if not os.path.isfile(path):
        return {}
    doc = load_json(path, errors) or {}
    return {
        key: os.path.join(rp, entry["textures"] + ".png")
        for key, entry in doc.get("texture_data", {}).items()
        if isinstance(entry.get("textures"), str)
    }


def geometry_identifiers(rp, errors):
    found = set()
    models = os.path.join(rp, "models")
    if not os.path.isdir(models):
        return found
    for path in walk_json(models):
        doc = load_json(path, errors) or {}
        for geo in doc.get("minecraft:geometry", []):
            identifier = geo.get("description", {}).get("identifier")
            if identifier:
                found.add(identifier)
    return found


def validate(addon, errors):
    bp, rp, ns = addon["bp"], addon["rp"], addon["namespace"]
    documents = {}
    for root in (bp, rp):
        if not os.path.isdir(root):
            errors.append(f"missing pack directory: {root}")
            return 0, 0
        for path in walk_json(root):
            documents[path] = load_json(path, errors)

    bp_manifest = documents.get(os.path.join(bp, "manifest.json"))
    rp_manifest = documents.get(os.path.join(rp, "manifest.json"))
    if not bp_manifest or not rp_manifest:
        errors.append(f"{addon['name']}: missing a manifest")
        return 0, 0

    uuids = []
    for manifest in (bp_manifest, rp_manifest):
        uuids.append(manifest["header"]["uuid"])
        uuids.extend(module["uuid"] for module in manifest["modules"])
    duplicates = {u for u in uuids if uuids.count(u) > 1}
    if duplicates:
        errors.append(f"{addon['name']}: duplicate UUIDs {sorted(duplicates)}")

    rp_uuid = rp_manifest["header"]["uuid"]
    if rp_uuid not in [d.get("uuid") for d in bp_manifest.get("dependencies", [])]:
        errors.append(f"{addon['name']}: behaviour pack does not depend on {rp_uuid}")

    for module in bp_manifest["modules"]:
        if module["type"] == "script":
            entry = os.path.join(bp, module["entry"])
            if not os.path.isfile(entry):
                errors.append(f"script entry not found: {entry}")

    items_atlas = atlas_lookup(rp, "item_texture.json", errors)
    terrain_atlas = atlas_lookup(rp, "terrain_texture.json", errors)
    geometries = geometry_identifiers(rp, errors)

    for key, png in list(items_atlas.items()) + list(terrain_atlas.items()):
        if not os.path.isfile(png):
            errors.append(f"{rp}: atlas key '{key}' points at missing file {png}")

    lang_path = os.path.join(rp, "texts", "en_US.lang")
    lang = ""
    if os.path.isfile(lang_path):
        with open(lang_path, encoding="utf-8") as handle:
            lang = handle.read()
    else:
        errors.append(f"missing {lang_path}")

    # ---- items -----------------------------------------------------------
    item_ids = []
    for path, doc in documents.items():
        if not path.startswith(os.path.join(bp, "items")) or doc is None:
            continue
        item = doc.get("minecraft:item", {})
        identifier = item.get("description", {}).get("identifier")
        item_ids.append(identifier)

        version = tuple(int(p) for p in str(doc.get("format_version", "0")).split("."))
        icon = item.get("components", {}).get("minecraft:icon")
        # The flat {"texture": ...} form is ignored from 1.20.60 on, which shows
        # up in game as a completely blank icon. Reject it outright.
        if isinstance(icon, dict) and "texture" in icon and version >= (1, 20, 60):
            errors.append(
                f"{path}: minecraft:icon uses the deprecated 'texture' field at "
                f"format_version {doc['format_version']} - use "
                '{"textures": {"default": ...}} instead'
            )
            continue
        key = icon.get("textures", {}).get("default") if isinstance(icon, dict) else icon
        if not key:
            errors.append(f"{path}: no minecraft:icon texture")
        elif key not in items_atlas:
            errors.append(f"{path}: icon '{key}' missing from item_texture.json")

        if identifier and f"item.{identifier}=" not in lang:
            errors.append(f"{lang_path}: no name entry for {identifier}")

    # ---- blocks ----------------------------------------------------------
    block_ids = []
    for path, doc in documents.items():
        if not path.startswith(os.path.join(bp, "blocks")) or doc is None:
            continue
        block = doc.get("minecraft:block", {})
        description = block.get("description", {})
        identifier = description.get("identifier")
        block_ids.append(identifier)
        components = block.get("components", {})
        permutations = block.get("permutations", [])

        if identifier and f"tile.{identifier}.name=" not in lang:
            errors.append(f"{lang_path}: no name entry for {identifier}")

        # Every texture named by a material instance must exist in the atlas.
        instance_sets = [components.get("minecraft:material_instances", {})]
        for permutation in permutations:
            instance_sets.append(
                permutation.get("components", {}).get("minecraft:material_instances", {})
            )
        for instances in instance_sets:
            for face, instance in instances.items():
                texture = instance.get("texture") if isinstance(instance, dict) else instance
                if texture and texture not in terrain_atlas:
                    errors.append(
                        f"{path}: face '{face}' texture '{texture}' missing from "
                        "terrain_texture.json"
                    )

        # Custom geometry must be present in the resource pack.
        for source in [components] + [p.get("components", {}) for p in permutations]:
            geometry = source.get("minecraft:geometry")
            if isinstance(geometry, dict):
                geometry = geometry.get("identifier")
            if (
                isinstance(geometry, str)
                and not geometry.startswith("minecraft:")
                and geometry not in geometries
            ):
                errors.append(f"{path}: geometry '{geometry}' not found in {rp}/models")

        # Permutation conditions may only test states the block declares.
        declared = set(description.get("states", {}))
        for trait, config in description.get("traits", {}).items():
            declared.update(config.get("enabled_states", []))
        for permutation in permutations:
            for state in re.findall(r"block_state\('([^']+)'\)", permutation.get("condition", "")):
                if state not in declared:
                    errors.append(
                        f"{path}: permutation tests undeclared state '{state}'"
                    )

    # ---- recipes ---------------------------------------------------------
    defined = set(filter(None, item_ids + block_ids))
    for path, doc in documents.items():
        if not path.startswith(os.path.join(bp, "recipes")) or doc is None:
            continue
        for kind in ("minecraft:recipe_shaped", "minecraft:recipe_shapeless"):
            recipe = doc.get(kind)
            if not recipe:
                continue
            result = recipe.get("result", {})
            result_item = result.get("item") if isinstance(result, dict) else result
            if result_item and result_item.startswith(ns + ":") and result_item not in defined:
                errors.append(f"{path}: result '{result_item}' has no definition")
            for entry in recipe.get("key", {}).values():
                ingredient = entry.get("item") if isinstance(entry, dict) else entry
                if (
                    isinstance(ingredient, str)
                    and ingredient.startswith(ns + ":")
                    and ingredient not in defined
                ):
                    errors.append(f"{path}: ingredient '{ingredient}' has no definition")

    print(
        f"{addon['name']}: {len(documents)} JSON files, "
        f"{len(block_ids)} blocks, {len(item_ids)} items."
    )
    return len(block_ids), len(item_ids)


def package(addon):
    os.makedirs(DIST, exist_ok=True)
    target = os.path.join(DIST, addon["name"] + ".mcaddon")
    if os.path.exists(target):
        os.remove(target)

    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for root in (addon["bp"], addon["rp"]):
            folder = os.path.basename(root)
            for base, _dirs, files in os.walk(root):
                for name in sorted(files):
                    source = os.path.join(base, name)
                    arcname = os.path.join(
                        folder, os.path.relpath(source, root)
                    ).replace(os.sep, "/")
                    archive.write(source, arcname)

    print(f"Packaged {target} ({os.path.getsize(target):,} bytes)")


if __name__ == "__main__":
    wanted = sys.argv[1:]
    selected = [a for a in ADDONS if not wanted or a["name"] in wanted]
    if not selected:
        print(f"no such add-on: {wanted}", file=sys.stderr)
        sys.exit(2)

    all_errors = []
    for addon in selected:
        validate(addon, all_errors)

    if all_errors:
        print("\nBuild failed:", file=sys.stderr)
        for error in all_errors:
            print(f"  - {error}", file=sys.stderr)
        sys.exit(1)

    for addon in selected:
        package(addon)
