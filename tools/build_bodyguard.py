#!/usr/bin/env python3
"""Validate and package the Bodyguard add-on.

This add-on is deliberately script-free: a behaviour pack that asks for a
script module version the player's game does not have is rejected whole, and
this one has to work on plain 1.21.0. The validator enforces that, then walks
every cross-reference in the pack - entity to client entity, client entity to
geometry, texture, render controller, animations and spawn egg, every event
name to its definition, the shooter to its projectile, the projectile to its
explosion, the contract to the entity it spawns, and every displayed string to
the language file.

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


def read_text(path):
    if not os.path.isfile(path):
        return ""
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def find_values(node, key):
    """Every value stored under `key`, anywhere in a nested structure."""
    found = []
    if isinstance(node, dict):
        for name, value in node.items():
            if name == key and isinstance(value, str):
                found.append(value)
            else:
                found.extend(find_values(value, key))
    elif isinstance(node, list):
        for value in node:
            found.extend(find_values(value, key))
    return found


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
    return bp_manifest


def check_entities(documents):
    """Returns {identifier: (path, definition)} for every behaviour entity."""
    entities = {}
    for path, doc in sorted(documents.items()):
        if not path.startswith(os.path.join(BP, "entities")) or doc is None:
            continue
        definition = doc.get("minecraft:entity", {})
        identifier = definition.get("description", {}).get("identifier")
        if not identifier or not identifier.startswith(NAMESPACE):
            fail(f"{path}: identifier '{identifier}' is outside {NAMESPACE}")
            continue
        entities[identifier] = (path, definition)

    for identifier, (path, definition) in entities.items():
        groups = set(definition.get("component_groups", {}))
        events = definition.get("events", {})

        # Every group an event adds or removes has to exist...
        for name, event in events.items():
            for action in ("add", "remove"):
                for group in event.get(action, {}).get("component_groups", []):
                    if group not in groups:
                        fail(f"{path}: event '{name}' {action}s unknown group '{group}'")

        # ...and every event named anywhere in the file has to be defined.
        for name in find_values(definition, "event"):
            if name.startswith(NAMESPACE) and name not in events:
                fail(f"{path}: '{name}' is referenced but never defined in events")

        # Shooters need a projectile that exists in this pack.
        for components in [definition.get("components", {})] + list(
            definition.get("component_groups", {}).values()
        ):
            shooter = components.get("minecraft:shooter")
            if shooter and shooter.get("def") not in entities:
                fail(f"{path}: shooter fires '{shooter.get('def')}', which is not defined")

    return entities


def check_bodyguard(entities):
    entry = entities.get("bodyguard:bodyguard")
    if not entry:
        fail("bodyguard:bodyguard is not defined")
        return
    path, definition = entry

    if not definition.get("description", {}).get("is_spawnable"):
        fail(f"{path}: is_spawnable must be true for a spawn egg to exist")

    tame = definition.get("components", {}).get("minecraft:tameable")
    if not tame:
        fail(f"{path}: no minecraft:tameable, so it can never follow anyone")
    elif not tame.get("tame_items"):
        fail(f"{path}: tameable has no tame_items")

    hired = definition.get("component_groups", {}).get("bodyguard:hired", {})
    for required in (
        "minecraft:is_tamed",
        "minecraft:behavior.follow_owner",
        "minecraft:behavior.owner_hurt_by_target",
        "minecraft:behavior.owner_hurt_target",
        "minecraft:shooter",
        "minecraft:behavior.ranged_attack",
        "minecraft:interact",
    ):
        if required not in hired:
            fail(f"{path}: the hired group is missing {required}")

    # The double tap: first tap opens a window that expires on its own, a tap
    # inside the window orders food. Both halves have to be there or the order
    # can never be given.
    window = definition.get("component_groups", {}).get("bodyguard:order_window", {})
    if "minecraft:timer" not in window:
        fail(f"{path}: the order window needs a timer, or it would never close")
    if "minecraft:interact" not in window:
        fail(f"{path}: the order window needs its own interact, or a second tap does nothing")

    fetching = definition.get("component_groups", {}).get("bodyguard:fetching", {})
    spawns = fetching.get("minecraft:spawn_entity", [])
    if not spawns:
        fail(f"{path}: the fetching group hands out no food")
    for spawn in spawns:
        if not spawn.get("spawn_item"):
            fail(f"{path}: a fetching entry has no spawn_item")
    if "minecraft:timer" not in fetching:
        fail(f"{path}: fetching needs a timer, or he would forage forever")

    sensor = definition.get("components", {}).get("minecraft:damage_sensor", {})
    causes = {trigger.get("cause") for trigger in sensor.get("triggers", [])}
    for cause in ("explosion", "entity_explosion"):
        if cause not in causes:
            fail(f"{path}: no damage_sensor for '{cause}' - his own shell would kill him")


def check_projectile(entities):
    entry = entities.get("bodyguard:cannon_shell")
    if not entry:
        fail("bodyguard:cannon_shell is not defined")
        return
    path, definition = entry

    if "minecraft:projectile" not in definition.get("components", {}):
        fail(f"{path}: no minecraft:projectile, so it would never fly or hit")

    explode = None
    for group in definition.get("component_groups", {}).values():
        if "minecraft:explode" in group:
            explode = group["minecraft:explode"]
    if explode is None:
        fail(f"{path}: nothing in this entity explodes")
    elif not explode.get("power"):
        fail(f"{path}: the explosion has no power")


def check_client_entities(documents, entities):
    """Every behaviour entity needs a client entity, or it renders as nothing."""
    geometries = set()
    for path, doc in documents.items():
        if not path.startswith(os.path.join(RP, "models")) or doc is None:
            continue
        for geometry in doc.get("minecraft:geometry", []):
            geometries.add(geometry.get("description", {}).get("identifier"))

    controllers = set()
    for path, doc in documents.items():
        if not path.startswith(os.path.join(RP, "render_controllers")) or doc is None:
            continue
        controllers.update(doc.get("render_controllers", {}))

    defined_animations = set()
    for path, doc in documents.items():
        if not path.startswith(os.path.join(RP, "animations")) or doc is None:
            continue
        defined_animations.update(doc.get("animations", {}))

    texture_data = texture_data_of(documents)
    clients = {}
    for path, doc in sorted(documents.items()):
        if not path.startswith(os.path.join(RP, "entity")) or doc is None:
            continue
        description = doc.get("minecraft:client_entity", {}).get("description", {})
        identifier = description.get("identifier")
        clients[identifier] = path
        if identifier not in entities:
            fail(f"{path}: '{identifier}' has no entity in the behaviour pack")

        for slot, name in description.get("geometry", {}).items():
            if name not in geometries:
                fail(f"{path}: geometry '{name}' ({slot}) is not defined in {RP}/models")
        for slot, texture in description.get("textures", {}).items():
            if not os.path.isfile(os.path.join(RP, texture + ".png")):
                fail(f"{path}: texture '{texture}' ({slot}) has no PNG")
        for controller in description.get("render_controllers", []):
            name = controller if isinstance(controller, str) else list(controller)[0]
            if name not in controllers:
                fail(f"{path}: render controller '{name}' is not defined")

        # Animations must be defined in this pack. Referencing a vanilla
        # identifier the running version does not have fails the whole client
        # entity, and that means an invisible mob.
        animations = description.get("animations", {})
        for short_name, animation_id in animations.items():
            if animation_id not in defined_animations:
                fail(
                    f"{path}: animation '{animation_id}' ({short_name}) is not "
                    f"defined in {RP}/animations"
                )
        for animation in description.get("scripts", {}).get("animate", []):
            name = animation if isinstance(animation, str) else list(animation)[0]
            if name not in animations:
                fail(f"{path}: animate entry '{name}' is not in the animations map")

        # The spawn egg. The colour keys are spelled the American way; the
        # British spelling is silently ignored and the egg gets no icon at all.
        spawn_egg = description.get("spawn_egg")
        spawnable = entities.get(identifier, (None, {}))[1]
        spawnable = spawnable.get("description", {}).get("is_spawnable")
        if spawnable and not spawn_egg:
            fail(f"{path}: no spawn_egg, so the egg would be an invisible item")
        if spawn_egg:
            for wrong in ("base_colour", "overlay_colour"):
                if wrong in spawn_egg:
                    fail(
                        f"{path}: spawn_egg uses '{wrong}', which the game ignores - "
                        f"use '{wrong.replace('colour', 'color')}' or a texture"
                    )
            texture = spawn_egg.get("texture")
            if texture:
                if texture not in texture_data:
                    fail(f"{path}: spawn egg texture '{texture}' is not in item_texture.json")
            elif not (spawn_egg.get("base_color") and spawn_egg.get("overlay_color")):
                fail(f"{path}: spawn_egg needs a texture, or base_color and overlay_color")

    for identifier in entities:
        if identifier not in clients:
            fail(f"{RP}/entity: no client entity for '{identifier}' - it would be invisible")


def texture_data_of(documents):
    atlas = documents.get(os.path.join(RP, "textures", "item_texture.json"))
    return (atlas or {}).get("texture_data", {})


def check_items(documents, entities):
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
        if placer and placer.get("entity") not in entities:
            fail(f"{path}: entity_placer spawns '{placer.get('entity')}', which is not defined")

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

    return identifiers


def check_names(documents, entities, item_ids):
    lang_path = os.path.join(RP, "texts", "en_US.lang")
    lang = read_text(lang_path)

    expected = [f"item.{item_id}=" for item_id in item_ids if item_id]
    for identifier, (_path, definition) in entities.items():
        if definition.get("description", {}).get("is_spawnable"):
            expected.append(f"entity.{identifier}.name=")
            expected.append(f"item.spawn_egg.entity.{identifier}.name=")
        # Every on-screen interact button needs its label.
        for text in find_values(definition, "interact_text"):
            expected.append(f"{text}=")

    for entry in sorted(set(expected)):
        if entry not in lang:
            fail(f"{lang_path}: missing '{entry}'")


def validate():
    documents = {}
    for root in (BP, RP):
        if not os.path.isdir(root):
            fail(f"missing pack directory: {root}")
            continue
        for path in walk_json(root):
            documents[path] = load_json(path)

    if check_manifests(documents) is None:
        return

    entities = check_entities(documents)
    check_bodyguard(entities)
    check_projectile(entities)
    check_client_entities(documents, entities)
    item_ids = check_items(documents, entities)
    check_names(documents, entities, item_ids)

    for root in (BP, RP):
        if not os.path.isfile(os.path.join(root, "pack_icon.png")):
            fail(f"{root}: missing pack_icon.png")

    print(
        f"Validated {len(documents)} JSON files: {len(entities)} entities, "
        f"{len(item_ids)} items, script-free."
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
