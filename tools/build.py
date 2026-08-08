#!/usr/bin/env python3
"""Validate and package every add-on in this repository.

Checks that every JSON file parses, that manifest UUIDs are unique across all
packs, that each behaviour pack's resource-pack dependency points at the real
resource pack, that every item icon resolves all the way down to a PNG on disk,
and that every custom entity has a client definition whose geometry, texture and
render controller all exist. Then zips each add-on into dist/.

Usage:  python3 tools/build.py [addon ...]
"""

import json
import os
import sys
import zipfile

DIST = "dist"

ADDONS = {
    "arcane_arsenal": {
        "title": "Arcane Arsenal",
        "bp": os.path.join("behavior_packs", "arcane_arsenal_bp"),
        "rp": os.path.join("resource_packs", "arcane_arsenal_rp"),
        "namespace": "arcane",
        "output": os.path.join(DIST, "ArcaneArsenal.mcaddon"),
    },
    "squid_game": {
        "title": "Squid Game",
        "bp": os.path.join("behavior_packs", "squid_game_bp"),
        "rp": os.path.join("resource_packs", "squid_game_rp"),
        "namespace": "squidgame",
        "output": os.path.join(DIST, "SquidGame.mcaddon"),
    },
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


def read_text(path):
    if not os.path.isfile(path):
        return ""
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def texture_exists(rp, reference):
    """Bedrock texture paths are extensionless; the file may be png or tga."""
    for suffix in (".png", ".tga", ""):
        if os.path.isfile(os.path.join(rp, reference + suffix)):
            return True
    return False


# --------------------------------------------------------------------------
# Checks
# --------------------------------------------------------------------------

def check_manifests(addon, documents):
    bp_manifest = documents.get(os.path.join(addon["bp"], "manifest.json"))
    rp_manifest = documents.get(os.path.join(addon["rp"], "manifest.json"))
    if not bp_manifest or not rp_manifest:
        fail(f"{addon['title']}: missing a manifest")
        return None, None

    # UUIDs must be distinct across every pack in the repository, not just
    # within one add-on - a collision makes Minecraft refuse the import.
    for manifest, label in ((bp_manifest, "BP"), (rp_manifest, "RP")):
        uuids = [manifest["header"]["uuid"]]
        uuids += [module["uuid"] for module in manifest["modules"]]
        for uuid in uuids:
            owner = f"{addon['title']} {label}"
            if uuid in seen_uuids:
                fail(f"UUID {uuid} used by both {seen_uuids[uuid]} and {owner}")
            else:
                seen_uuids[uuid] = owner

    rp_uuid = rp_manifest["header"]["uuid"]
    dependency_uuids = [dep.get("uuid") for dep in bp_manifest.get("dependencies", [])]
    if rp_uuid not in dependency_uuids:
        fail(f"{addon['title']}: behaviour pack does not depend on its resource pack")

    for module in bp_manifest["modules"]:
        if module["type"] == "script":
            entry = os.path.join(addon["bp"], module["entry"])
            if not os.path.isfile(entry):
                fail(f"script entry not found: {entry}")

    return bp_manifest, rp_manifest


def check_items(addon, documents, lang):
    """item json -> item_texture.json key -> png on disk, plus a display name."""
    bp, rp = addon["bp"], addon["rp"]
    atlas_path = os.path.join(rp, "textures", "item_texture.json")
    atlas = documents.get(atlas_path)
    if atlas is None:
        fail(f"missing {atlas_path}")
        return []
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
        if not texture_exists(rp, texture_data[key]["textures"]):
            fail(f"{path}: icon '{key}' points at a missing texture file")

        if identifier and f"item.{identifier}=" not in lang:
            fail(f"{addon['title']}: no display name for {identifier} in en_US.lang")

    return identifiers


def check_entities(addon, documents, lang):
    """Every BP entity needs a client entity whose assets all resolve."""
    bp, rp = addon["bp"], addon["rp"]

    server_entities = {}
    for path, doc in documents.items():
        if not path.startswith(os.path.join(bp, "entities")) or doc is None:
            continue
        identifier = (
            doc.get("minecraft:entity", {}).get("description", {}).get("identifier")
        )
        if identifier:
            server_entities[identifier] = path

    if not server_entities:
        return

    client_entities = {}
    for path, doc in documents.items():
        if not path.startswith(os.path.join(rp, "entity")) or doc is None:
            continue
        description = doc.get("minecraft:client_entity", {}).get("description", {})
        identifier = description.get("identifier")
        if identifier:
            client_entities[identifier] = (path, description)

    geometries = set()
    for path, doc in documents.items():
        if not path.startswith(os.path.join(rp, "models")) or doc is None:
            continue
        for entry in doc.get("minecraft:geometry", []):
            name = entry.get("description", {}).get("identifier")
            if name:
                geometries.add(name)
        # Pre-1.12 geometry files key the model straight off the root object.
        for key in doc:
            if key.startswith("geometry."):
                geometries.add(key)

    controllers = set()
    for path, doc in documents.items():
        if not path.startswith(os.path.join(rp, "render_controllers")) or doc is None:
            continue
        controllers.update(doc.get("render_controllers", {}))

    for identifier, server_path in server_entities.items():
        if identifier not in client_entities:
            fail(f"{server_path}: no client entity for {identifier} in the RP")
            continue
        client_path, description = client_entities[identifier]

        for name, reference in description.get("textures", {}).items():
            if not texture_exists(rp, reference):
                fail(f"{client_path}: texture '{name}' -> missing file {reference}")

        for name, reference in description.get("geometry", {}).items():
            if reference not in geometries:
                fail(f"{client_path}: geometry '{name}' -> undefined {reference}")

        for reference in description.get("render_controllers", []):
            name = reference if isinstance(reference, str) else next(iter(reference))
            if name not in controllers:
                fail(f"{client_path}: render controller '{name}' is not defined")

        if f"entity.{identifier}.name=" not in lang:
            fail(f"{addon['title']}: no display name for entity {identifier}")


def check_recipes(addon, documents, identifiers):
    bp = addon["bp"]
    prefix = addon["namespace"] + ":"
    for path, doc in documents.items():
        if not path.startswith(os.path.join(bp, "recipes")) or doc is None:
            continue
        recipe = doc.get("minecraft:recipe_shaped", {})
        result = recipe.get("result", {})
        result_item = result.get("item") if isinstance(result, dict) else result
        if result_item and result_item.startswith(prefix):
            if result_item not in identifiers:
                fail(f"{path}: result '{result_item}' has no item definition")


def validate(addon):
    documents = {}
    for root in (addon["bp"], addon["rp"]):
        if not os.path.isdir(root):
            fail(f"missing pack directory: {root}")
            return 0, 0
        for path in walk_json(root):
            documents[path] = load_json(path)

    bp_manifest, _rp_manifest = check_manifests(addon, documents)
    if not bp_manifest:
        return 0, 0

    lang = read_text(os.path.join(addon["rp"], "texts", "en_US.lang"))
    identifiers = check_items(addon, documents, lang)
    check_entities(addon, documents, lang)
    check_recipes(addon, documents, identifiers)

    print(
        f"{addon['title']}: validated {len(documents)} JSON files, "
        f"{len(identifiers)} items."
    )
    return len(documents), len(identifiers)


def package(addon):
    os.makedirs(DIST, exist_ok=True)
    output = addon["output"]
    if os.path.exists(output):
        os.remove(output)

    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for root in (addon["bp"], addon["rp"]):
            folder = os.path.basename(root)
            for base, _dirs, files in os.walk(root):
                for name in sorted(files):
                    source = os.path.join(base, name)
                    arcname = os.path.join(
                        folder, os.path.relpath(source, root)
                    ).replace(os.sep, "/")
                    archive.write(source, arcname)

    print(f"Packaged {output} ({os.path.getsize(output):,} bytes)")


if __name__ == "__main__":
    requested = sys.argv[1:] or list(ADDONS)
    unknown = [name for name in requested if name not in ADDONS]
    if unknown:
        print(f"Unknown add-on(s): {', '.join(unknown)}", file=sys.stderr)
        print(f"Known: {', '.join(ADDONS)}", file=sys.stderr)
        sys.exit(2)

    for key in requested:
        validate(ADDONS[key])

    if errors:
        print("\nBuild failed:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        sys.exit(1)

    for key in requested:
        package(ADDONS[key])
