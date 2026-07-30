#!/usr/bin/env python3
"""Validate and package the Bodyguard add-on.

This add-on is deliberately script-free: a behaviour pack that asks for a
script module version the player's game does not have is rejected whole, and
this one has to work on plain 1.21.0. The validator enforces that, then checks
that every cross-reference resolves - entity to client entity, client entity to
geometry, texture, render controller and spawn egg, item to entity, recipe to
item, and every name to the language file.

Usage:  python3 tools/build_bodyguard.py
"""

import json
import os
import sys
import zipfile

BP = os.path.join("behavior_packs", "bodyguard_bp")
RP = os.path.join("resource_packs", "bodyguard_rp")
OTHER_MANIFESTS = (
    os.path.join("behavior_packs", "arcane_arsenal_bp", "manifest.json"),
    os.path.join("resource_packs", "arcane_arsenal_rp", "manifest.json"),
    os.path.join("behavior_packs", "skyline_parkour_bp", "manifest.json"),
    os.path.join("resource_packs", "skyline_parkour_rp", "manifest.json"),
)
DIST = "dist"
ADDON = os.path.join(DIST, "Bodyguard.mcaddon")
BP_PACK = os.path.join(DIST, "Bodyguard_BP.mcpack")
RP_PACK = os.path.join(DIST, "Bodyguard_RP.mcpack")
NAMESPACE = "bodyguard:"

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


def texture_data_of(documents):
    atlas = documents.get(os.path.join(RP, "textures", "item_texture.json"))
    return (atlas or {}).get("texture_data", {})


def read_text(path):
    if not os.path.isfile(path):
        return ""
    with open(path, encoding="utf-8") as handle:
        return handle.read()


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

    # UUIDs must be distinct here and against every other add-on in the repo,
    # so all of them can be installed at the same time.
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

    if rp_manifest["header"]["uuid"] not in [
        dep.get("uuid") for dep in bp_manifest.get("dependencies", [])
    ]:
        fail("behaviour pack does not depend on the resource pack")

    # No scripts, on purpose: no script module version to get wrong.
    for module in bp_manifest["modules"]:
        if module["type"] == "script":
            fail(f"{BP}/manifest.json: this add-on must stay script-free")
    for dep in bp_manifest.get("dependencies", []):
        if dep.get("module_name"):
            fail(
                f"{BP}/manifest.json: depends on script module "
                f"{dep['module_name']}, which this add-on must not need"
            )

    # ---- entity: behaviour side ----
    entity_path = os.path.join(BP, "entities", "bodyguard.json")
    entity = documents.get(entity_path)
    if entity is None:
        fail(f"missing {entity_path}")
        return

    definition = entity.get("minecraft:entity", {})
    identifier = definition.get("description", {}).get("identifier")
    if not identifier or not identifier.startswith(NAMESPACE):
        fail(f"{entity_path}: identifier '{identifier}' is outside {NAMESPACE}")
    if not definition.get("description", {}).get("is_spawnable"):
        fail(f"{entity_path}: is_spawnable must be true for a spawn egg to exist")

    groups = set(definition.get("component_groups", {}))
    events = definition.get("events", {})
    for name, event in events.items():
        for group in event.get("add", {}).get("component_groups", []):
            if group not in groups:
                fail(f"{entity_path}: event '{name}' adds unknown group '{group}'")

    tame = definition.get("components", {}).get("minecraft:tameable")
    if not tame:
        fail(f"{entity_path}: no minecraft:tameable, so it can never follow anyone")
    else:
        event_name = tame.get("tame_event", {}).get("event")
        if event_name not in events:
            fail(f"{entity_path}: tame_event '{event_name}' is not defined in events")
        if not tame.get("tame_items"):
            fail(f"{entity_path}: tameable has no tame_items")

    hired = definition.get("component_groups", {}).get("bodyguard:hired", {})
    for required in (
        "minecraft:is_tamed",
        "minecraft:behavior.follow_owner",
        "minecraft:behavior.owner_hurt_by_target",
        "minecraft:behavior.owner_hurt_target",
    ):
        if required not in hired:
            fail(f"{entity_path}: the hired group is missing {required}")

    # ---- entity: resource side ----
    client_path = os.path.join(RP, "entity", "bodyguard.entity.json")
    client = documents.get(client_path)
    if client is None:
        fail(f"missing {client_path}")
        return

    description = client.get("minecraft:client_entity", {}).get("description", {})
    if description.get("identifier") != identifier:
        fail(
            f"{client_path}: identifier '{description.get('identifier')}' does not "
            f"match the behaviour pack's '{identifier}'"
        )

    # Geometry identifiers actually defined in this pack.
    geometries = set()
    for path, doc in documents.items():
        if not path.startswith(os.path.join(RP, "models")) or doc is None:
            continue
        for geometry in doc.get("minecraft:geometry", []):
            geometries.add(geometry.get("description", {}).get("identifier"))
    for slot, name in description.get("geometry", {}).items():
        if name not in geometries:
            fail(f"{client_path}: geometry '{name}' ({slot}) is not defined in {RP}/models")

    for slot, texture in description.get("textures", {}).items():
        png = os.path.join(RP, texture + ".png")
        if not os.path.isfile(png):
            fail(f"{client_path}: texture '{texture}' ({slot}) has no file at {png}")

    controllers = set()
    for path, doc in documents.items():
        if not path.startswith(os.path.join(RP, "render_controllers")) or doc is None:
            continue
        controllers.update(doc.get("render_controllers", {}))
    for controller in description.get("render_controllers", []):
        name = controller if isinstance(controller, str) else list(controller)[0]
        if name not in controllers:
            fail(f"{client_path}: render controller '{name}' is not defined")

    # Animations must be defined in this pack. Referencing a vanilla animation
    # identifier that does not exist on the player's version is a load error
    # for the whole client entity, and a load error there means an invisible
    # mob, so the pack ships its own.
    defined_animations = set()
    for path, doc in documents.items():
        if not path.startswith(os.path.join(RP, "animations")) or doc is None:
            continue
        defined_animations.update(doc.get("animations", {}))

    animations = description.get("animations", {})
    for short_name, animation_id in animations.items():
        if animation_id not in defined_animations:
            fail(
                f"{client_path}: animation '{animation_id}' ({short_name}) is not "
                f"defined in {RP}/animations"
            )
    for animation in description.get("scripts", {}).get("animate", []):
        name = animation if isinstance(animation, str) else list(animation)[0]
        if name not in animations:
            fail(f"{client_path}: animate entry '{name}' is not in the animations map")

    # The spawn egg. The colour keys are spelled the American way; the British
    # spelling is silently ignored and the egg ends up with no icon at all.
    spawn_egg = description.get("spawn_egg")
    if not spawn_egg:
        fail(f"{client_path}: no spawn_egg, so the egg would be an invisible item")
    else:
        for wrong in ("base_colour", "overlay_colour"):
            if wrong in spawn_egg:
                fail(
                    f"{client_path}: spawn_egg uses '{wrong}', which the game ignores "
                    f"- use '{wrong.replace('colour', 'color')}' or a texture"
                )
        texture = spawn_egg.get("texture")
        if texture:
            if texture not in texture_data_of(documents):
                fail(f"{client_path}: spawn egg texture '{texture}' is not in item_texture.json")
        elif not (spawn_egg.get("base_color") and spawn_egg.get("overlay_color")):
            fail(f"{client_path}: spawn_egg needs a texture, or base_color and overlay_color")

    # ---- items and recipes ----
    texture_data = texture_data_of(documents)

    identifiers = []
    for path, doc in sorted(documents.items()):
        if not path.startswith(os.path.join(BP, "items")) or doc is None:
            continue
        item = doc.get("minecraft:item", {})
        item_id = item.get("description", {}).get("identifier")
        identifiers.append(item_id)
        components = item.get("components", {})

        icon = components.get("minecraft:icon")
        key = icon.get("textures", {}).get("default") if isinstance(icon, dict) else icon
        if isinstance(icon, dict) and "texture" in icon:
            fail(f"{path}: minecraft:icon must use textures/default, not the old 'texture'")
        elif not key:
            fail(f"{path}: no minecraft:icon texture")
        elif key not in texture_data:
            fail(f"{path}: icon '{key}' missing from item_texture.json")
        elif not os.path.isfile(os.path.join(RP, texture_data[key]["textures"] + ".png")):
            fail(f"{path}: icon '{key}' points at a missing PNG")

        placer = components.get("minecraft:entity_placer")
        if placer and placer.get("entity") != identifier:
            fail(
                f"{path}: entity_placer spawns '{placer.get('entity')}', "
                f"which is not {identifier}"
            )

    for path, doc in sorted(documents.items()):
        if not path.startswith(os.path.join(BP, "recipes")) or doc is None:
            continue
        recipe = doc.get("minecraft:recipe_shaped", {})
        result = recipe.get("result", {})
        result_item = result.get("item") if isinstance(result, dict) else result
        if result_item and result_item.startswith(NAMESPACE):
            if result_item not in identifiers:
                fail(f"{path}: result '{result_item}' has no item definition")
        keys = set(recipe.get("key", {}))
        used = {char for row in recipe.get("pattern", []) for char in row if char != " "}
        if used - keys:
            fail(f"{path}: pattern uses undefined keys {sorted(used - keys)}")
        if keys - used:
            fail(f"{path}: key defines unused symbols {sorted(keys - used)}")

    # ---- names ----
    lang_path = os.path.join(RP, "texts", "en_US.lang")
    lang = read_text(lang_path)
    expected = [f"entity.{identifier}.name=", f"item.spawn_egg.entity.{identifier}.name="]
    expected += [f"item.{item_id}=" for item_id in identifiers if item_id]
    for entry in expected:
        if entry not in lang:
            fail(f"{lang_path}: missing '{entry}'")

    for root in (BP, RP):
        if not os.path.isfile(os.path.join(root, "pack_icon.png")):
            fail(f"{root}: missing pack_icon.png")

    print(
        f"Validated {len(documents)} JSON files: 1 entity, "
        f"{len(identifiers)} items, script-free."
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
    write_zip(ADDON, ((BP, "bodyguard_bp"), (RP, "bodyguard_rp")))
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
