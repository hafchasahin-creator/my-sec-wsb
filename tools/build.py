#!/usr/bin/env python3
"""Validate and package the add-ons in this repository.

For every add-on it checks that each JSON file parses, that manifest UUIDs are
unique, that the behaviour pack's resource-pack dependency points at the real
resource pack, that every item icon and block texture resolves all the way down
to a PNG on disk, that recipes produce items or blocks that exist, and that
everything custom has a display name. Then it zips each pair of packs into a
.mcaddon.

Usage:  python3 tools/build.py [addon ...]     (default: every add-on)
"""

import json
import os
import sys
import zipfile

DIST = "dist"

ADDONS = {
    "arcane": {
        "bp": os.path.join("behavior_packs", "arcane_arsenal_bp"),
        "rp": os.path.join("resource_packs", "arcane_arsenal_rp"),
        "namespace": "arcane",
        "addon": os.path.join(DIST, "ArcaneArsenal.mcaddon"),
    },
    "onetap": {
        "bp": os.path.join("behavior_packs", "onetap_armory_bp"),
        "rp": os.path.join("resource_packs", "onetap_armory_rp"),
        "namespace": "onetap",
        "addon": os.path.join(DIST, "OnetapArmory.mcaddon"),
    },
    "spirit": {
        "bp": os.path.join("behavior_packs", "spirit_guardian_bp"),
        "rp": os.path.join("resource_packs", "spirit_guardian_rp"),
        "namespace": "spirit",
        "addon": os.path.join(DIST, "SpiritGuardian.mcaddon"),
    },
    "luxury": {
        "bp": os.path.join("behavior_packs", "luxury_house_bp"),
        "rp": os.path.join("resource_packs", "luxury_house_rp"),
        "namespace": "luxury",
        "addon": os.path.join(DIST, "LuxuryEstate.mcaddon"),
    },
}

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


def texture_exists(rp, atlas_path, atlas, key, source):
    """Resolve an atlas key down to a PNG, reporting where it broke."""
    if atlas is None:
        fail(f"{source}: {atlas_path} is missing, so '{key}' cannot resolve")
        return
    entry = atlas.get("texture_data", {}).get(key)
    if entry is None:
        fail(f"{source}: texture '{key}' missing from {atlas_path}")
        return
    textures = entry["textures"]
    if isinstance(textures, list):
        textures = textures[0]
    png = os.path.join(rp, textures + ".png")
    if not os.path.isfile(png):
        fail(f"{source}: texture '{key}' points at missing file {png}")


def collect_ids(documents, folder, extract):
    """Gather declared ids from every JSON under `folder`."""
    found = set()
    for path, doc in documents.items():
        if not path.startswith(folder) or doc is None:
            continue
        found.update(extract(doc))
    return found


def geometry_ids(doc):
    # 1.12 format: a list under minecraft:geometry, each with an identifier.
    geometries = doc.get("minecraft:geometry")
    if isinstance(geometries, list):
        return {
            geometry.get("description", {}).get("identifier")
            for geometry in geometries
            if isinstance(geometry, dict)
        }
    # 1.8 format: top-level keys named geometry.<name>.
    return {key.split(":")[0] for key in doc if key.startswith("geometry.")}


def validate_client_entities(rp, documents, entity_identifiers, item_atlas_path, item_atlas):
    """A client entity that points at a missing model, texture or controller
    renders as an invisible or bright-pink mob, with nothing in the log to say
    which reference broke. Resolve all of them here instead."""
    models = collect_ids(documents, os.path.join(rp, "models"), geometry_ids)
    controllers = collect_ids(
        documents,
        os.path.join(rp, "render_controllers"),
        lambda doc: set(doc.get("render_controllers", {})),
    )
    animations = collect_ids(
        documents,
        os.path.join(rp, "animations"),
        lambda doc: set(doc.get("animations", {})),
    )
    animations |= collect_ids(
        documents,
        os.path.join(rp, "animation_controllers"),
        lambda doc: set(doc.get("animation_controllers", {})),
    )

    described = set()
    for path, doc in sorted(documents.items()):
        if not path.startswith(os.path.join(rp, "entity")) or doc is None:
            continue
        description = doc.get("minecraft:client_entity", {}).get("description", {})
        identifier = description.get("identifier")
        described.add(identifier)

        if identifier not in entity_identifiers:
            fail(f"{path}: client entity '{identifier}' has no behaviour-pack entity")

        for key, texture in description.get("textures", {}).items():
            if not os.path.isfile(os.path.join(rp, texture + ".png")):
                fail(f"{path}: texture '{key}' points at missing file {texture}.png")

        for key, geometry in description.get("geometry", {}).items():
            if geometry not in models:
                fail(f"{path}: geometry '{key}' -> '{geometry}' is not defined in {rp}/models")

        for controller in description.get("render_controllers", []):
            name = controller if isinstance(controller, str) else next(iter(controller))
            if name not in controllers:
                fail(f"{path}: render controller '{name}' is not defined in {rp}/render_controllers")

        for key, animation in description.get("animations", {}).items():
            if animation not in animations:
                fail(f"{path}: animation '{key}' -> '{animation}' is not defined")

        for name in description.get("scripts", {}).get("animate", []):
            key = name if isinstance(name, str) else next(iter(name))
            if key not in description.get("animations", {}):
                fail(f"{path}: scripts/animate runs '{key}', which is not in animations")

        egg = description.get("spawn_egg", {})
        if "texture" in egg:
            texture_exists(rp, item_atlas_path, item_atlas, egg["texture"], path)

    for identifier in entity_identifiers:
        if identifier not in described:
            fail(f"{rp}/entity: no client entity for {identifier}, it would be invisible")


def validate(spec):
    bp = spec["bp"]
    rp = spec["rp"]
    namespace = spec["namespace"]

    documents = {}
    for root in (bp, rp):
        if not os.path.isdir(root):
            fail(f"missing pack directory: {root}")
            continue
        for path in walk_json(root):
            documents[path] = load_json(path)

    bp_manifest = documents.get(os.path.join(bp, "manifest.json"))
    rp_manifest = documents.get(os.path.join(rp, "manifest.json"))
    if not bp_manifest or not rp_manifest:
        return 0, 0

    # UUIDs must all be distinct.
    uuids = []
    for manifest in (bp_manifest, rp_manifest):
        uuids.append(manifest["header"]["uuid"])
        uuids.extend(module["uuid"] for module in manifest["modules"])
    duplicates = {u for u in uuids if uuids.count(u) > 1}
    if duplicates:
        fail(f"{bp}: duplicate UUIDs across manifests: {sorted(duplicates)}")

    # The behaviour pack must depend on this resource pack.
    rp_uuid = rp_manifest["header"]["uuid"]
    dependency_uuids = [dep.get("uuid") for dep in bp_manifest.get("dependencies", [])]
    if rp_uuid not in dependency_uuids:
        fail(f"{bp}: behaviour pack does not depend on resource pack {rp_uuid}")

    # The script entry point must exist.
    for module in bp_manifest["modules"]:
        if module["type"] == "script":
            entry = os.path.join(bp, module["entry"])
            if not os.path.isfile(entry):
                fail(f"script entry not found: {entry}")

    item_atlas_path = os.path.join(rp, "textures", "item_texture.json")
    block_atlas_path = os.path.join(rp, "textures", "terrain_texture.json")
    item_atlas = documents.get(item_atlas_path)
    block_atlas = documents.get(block_atlas_path)

    # Items: icon -> item_texture.json key -> png on disk.
    identifiers = []
    for path, doc in sorted(documents.items()):
        if not path.startswith(os.path.join(bp, "items")) or doc is None:
            continue
        item = doc.get("minecraft:item", {})
        identifier = item.get("description", {}).get("identifier")
        identifiers.append(identifier)

        # minecraft:icon changed shape at format_version 1.20.60: the flat
        # "texture" string is deprecated and is silently ignored by the game,
        # which shows up in-game as an item with a completely blank icon.
        # Reject it rather than shipping an invisible item again.
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
        texture_exists(rp, item_atlas_path, item_atlas, key, path)

    # Blocks: every material instance texture -> terrain_texture.json -> png.
    block_identifiers = []
    for path, doc in sorted(documents.items()):
        if not path.startswith(os.path.join(bp, "blocks")) or doc is None:
            continue
        block = doc.get("minecraft:block", {})
        identifier = block.get("description", {}).get("identifier")
        block_identifiers.append(identifier)

        components = block.get("components", {})
        instances = components.get("minecraft:material_instances")
        if not instances:
            fail(f"{path}: no minecraft:material_instances, the block has no texture")
            continue
        for face, instance in instances.items():
            if not isinstance(instance, dict):
                continue  # an alias onto another face
            key = instance.get("texture")
            if not key:
                fail(f"{path}: material instance '{face}' has no texture")
                continue
            texture_exists(rp, block_atlas_path, block_atlas, key, path)

    # Entities: server definition, client definition, model, controllers.
    entity_identifiers = []
    spawn_eggs = []
    for path, doc in sorted(documents.items()):
        if not path.startswith(os.path.join(bp, "entities")) or doc is None:
            continue
        description = doc.get("minecraft:entity", {}).get("description", {})
        identifier = description.get("identifier")
        if not identifier:
            fail(f"{path}: entity has no identifier")
            continue
        entity_identifiers.append(identifier)
        if description.get("is_spawnable"):
            spawn_eggs.append(f"{identifier}_spawn_egg")

    if entity_identifiers:
        validate_client_entities(rp, documents, entity_identifiers, item_atlas_path, item_atlas)

    known = set(identifiers) | set(block_identifiers) | set(spawn_eggs)

    # Recipes must produce something that exists, from ingredients that exist.
    for path, doc in sorted(documents.items()):
        if not path.startswith(os.path.join(bp, "recipes")) or doc is None:
            continue
        recipe = doc.get("minecraft:recipe_shaped") or doc.get(
            "minecraft:recipe_shapeless"
        )
        if recipe is None:
            fail(f"{path}: not a shaped or shapeless recipe")
            continue

        result = recipe.get("result", {})
        result_item = result.get("item") if isinstance(result, dict) else result
        if result_item and result_item.startswith(f"{namespace}:"):
            if result_item not in known:
                fail(f"{path}: result '{result_item}' has no item or block definition")

        ingredients = []
        for entry in recipe.get("key", {}).values():
            ingredients.append(entry.get("item") if isinstance(entry, dict) else entry)
        for entry in recipe.get("ingredients", []):
            ingredients.append(entry.get("item") if isinstance(entry, dict) else entry)
        for ingredient in ingredients:
            if (
                ingredient
                and ingredient.startswith(f"{namespace}:")
                and ingredient not in known
            ):
                fail(f"{path}: ingredient '{ingredient}' has no definition")

    # Everything custom needs a display name in the language file.
    lang_path = os.path.join(rp, "texts", "en_US.lang")
    lang = ""
    if os.path.isfile(lang_path):
        with open(lang_path, encoding="utf-8") as handle:
            lang = handle.read()
    for identifier in identifiers:
        if identifier and f"item.{identifier}=" not in lang:
            fail(f"{lang_path}: no name entry for item {identifier}")
    for identifier in block_identifiers:
        if identifier and f"tile.{identifier}.name=" not in lang:
            fail(f"{lang_path}: no name entry for block {identifier}")
    for identifier in entity_identifiers:
        if identifier and f"entity.{identifier}.name=" not in lang:
            fail(f"{lang_path}: no name entry for entity {identifier}")
    for identifier in spawn_eggs:
        entity_id = identifier[: -len("_spawn_egg")]
        if f"item.spawn_egg.entity.{entity_id}.name=" not in lang:
            fail(f"{lang_path}: no name entry for spawn egg of {entity_id}")

    # Pack icons are what the player sees in the pack list.
    for root in (bp, rp):
        if not os.path.isfile(os.path.join(root, "pack_icon.png")):
            fail(f"{root}: missing pack_icon.png")

    print(
        f"{bp}: validated {len(documents)} JSON files, {len(identifiers)} items, "
        f"{len(block_identifiers)} blocks, {len(entity_identifiers)} entities."
    )
    return len(identifiers), len(block_identifiers)


def package(spec):
    os.makedirs(DIST, exist_ok=True)
    addon = spec["addon"]
    if os.path.exists(addon):
        os.remove(addon)

    with zipfile.ZipFile(addon, "w", zipfile.ZIP_DEFLATED) as archive:
        for root in (spec["bp"], spec["rp"]):
            folder = os.path.basename(root)
            for base, _dirs, files in os.walk(root):
                for name in sorted(files):
                    source = os.path.join(base, name)
                    arcname = os.path.join(
                        folder, os.path.relpath(source, root)
                    ).replace(os.sep, "/")
                    archive.write(source, arcname)

    size = os.path.getsize(addon)
    print(f"Packaged {addon} ({size:,} bytes)")


if __name__ == "__main__":
    selected = sys.argv[1:] or list(ADDONS)
    unknown = [name for name in selected if name not in ADDONS]
    if unknown:
        print(f"Unknown add-on(s): {', '.join(unknown)}", file=sys.stderr)
        print(f"Available: {', '.join(ADDONS)}", file=sys.stderr)
        sys.exit(2)

    for name in selected:
        validate(ADDONS[name])

    if errors:
        print("\nBuild failed:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        sys.exit(1)

    for name in selected:
        package(ADDONS[name])
