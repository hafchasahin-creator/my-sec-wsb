#!/usr/bin/env python3
"""Validate and package the Anaconda add-on.

The checks are the ones that catch silent in-game failures - a mob that never
renders, an animation that targets a bone that does not exist, a spawn egg with
no icon - because Bedrock reports most of these as nothing at all.

Checks:
  * every JSON file parses
  * manifest UUIDs are unique across every pack in the repo
  * the behaviour pack depends on this resource pack, at a matching version
  * the script entry point exists
  * the BP entity and RP client entity share an identifier
  * every component group named by an event exists, and vice versa
  * spawn rules point at a real entity and a real spawn event
  * the loot table referenced by the entity exists
  * the client entity's geometry, texture, render controller and animations all
    resolve to real definitions on disk
  * every bone named in an animation exists in the geometry
  * the spawn egg icon resolves through item_texture.json to a PNG
  * both packs have a pack_icon.png and a display name for the mob

Usage:  python3 tools/build_anaconda.py
"""

import json
import os
import re
import sys
import zipfile

BP = os.path.join("behavior_packs", "anaconda_bp")
RP = os.path.join("resource_packs", "anaconda_rp")
DIST = "dist"
ADDON = os.path.join(DIST, "Anaconda.mcaddon")
ENTITY_ID = "anaconda:anaconda"

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


def check_manifests(bp_manifest, rp_manifest):
    # Every pack in the repo has to have distinct UUIDs, otherwise Minecraft
    # silently keeps only one of the colliding packs.
    seen = {}
    for base in ("behavior_packs", "resource_packs"):
        for path in walk_json(base):
            if os.path.basename(path) != "manifest.json":
                continue
            manifest = load_json(path)
            if not manifest:
                continue
            ids = [manifest["header"]["uuid"]]
            ids += [module["uuid"] for module in manifest["modules"]]
            for uuid in ids:
                if uuid in seen:
                    where = (
                        f"twice in {path}"
                        if seen[uuid] == path
                        else f"in {path} and {seen[uuid]}"
                    )
                    fail(f"duplicate UUID {uuid} {where}")
                seen[uuid] = path

    rp_uuid = rp_manifest["header"]["uuid"]
    rp_version = rp_manifest["header"]["version"]
    dependency = next(
        (d for d in bp_manifest.get("dependencies", []) if d.get("uuid") == rp_uuid),
        None,
    )
    if dependency is None:
        fail(f"behaviour pack does not depend on resource pack {rp_uuid}")
    elif dependency.get("version") != rp_version:
        fail(
            f"dependency version {dependency.get('version')} does not match "
            f"resource pack version {rp_version}"
        )

    if not any(
        d.get("module_name") == "@minecraft/server"
        for d in bp_manifest.get("dependencies", [])
    ):
        fail("behaviour pack does not declare the @minecraft/server dependency")

    for module in bp_manifest["modules"]:
        if module["type"] == "script":
            entry = os.path.join(BP, module["entry"])
            if not os.path.isfile(entry):
                fail(f"script entry not found: {entry}")

    for pack in (BP, RP):
        if not os.path.isfile(os.path.join(pack, "pack_icon.png")):
            fail(f"missing {os.path.join(pack, 'pack_icon.png')}")


def check_server_entity(doc, path):
    entity = doc.get("minecraft:entity", {})
    identifier = entity.get("description", {}).get("identifier")
    if identifier != ENTITY_ID:
        fail(f"{path}: identifier {identifier!r} should be {ENTITY_ID!r}")

    groups = set(entity.get("component_groups", {}))
    events = entity.get("events", {})

    referenced = set()

    def scan(node):
        if isinstance(node, dict):
            for key, value in node.items():
                if key in ("add", "remove") and isinstance(value, dict):
                    referenced.update(value.get("component_groups", []))
                else:
                    scan(value)
        elif isinstance(node, list):
            for item in node:
                scan(item)

    scan(events)
    for group in sorted(referenced - groups):
        fail(f"{path}: event references undefined component group {group!r}")
    for group in sorted(groups - referenced):
        fail(f"{path}: component group {group!r} is never added by any event")

    # Events fired from component timers must exist too.
    for group_name, group in entity.get("component_groups", {}).items():
        timer = group.get("minecraft:timer", {})
        event = timer.get("time_down_event", {}).get("event")
        if event and event not in events:
            fail(f"{path}: {group_name} timer fires undefined event {event!r}")

    loot = entity.get("components", {}).get("minecraft:loot", {}).get("table")
    if loot and not os.path.isfile(os.path.join(BP, loot)):
        fail(f"{path}: loot table not found: {os.path.join(BP, loot)}")

    return set(events)


def check_spawn_rules(doc, path, events):
    rules = doc.get("minecraft:spawn_rules", {})
    identifier = rules.get("description", {}).get("identifier")
    if identifier != ENTITY_ID:
        fail(f"{path}: identifier {identifier!r} should be {ENTITY_ID!r}")
    for condition in rules.get("conditions", []):
        event = condition.get("minecraft:spawn_event", {}).get("event")
        if event and event not in events:
            fail(f"{path}: spawn_event {event!r} is not defined on the entity")


def check_client_entity(doc, path, documents):
    description = doc.get("minecraft:client_entity", {}).get("description", {})
    if description.get("identifier") != ENTITY_ID:
        fail(f"{path}: identifier should be {ENTITY_ID!r}")

    # Texture.
    for name, texture in description.get("textures", {}).items():
        png = os.path.join(RP, texture + ".png")
        if not os.path.isfile(png):
            fail(f"{path}: texture {name!r} points at missing file {png}")

    # Geometry.
    geometries = set()
    for doc_path, geo in documents.items():
        if not doc_path.endswith(".geo.json") or geo is None:
            continue
        for entry in geo.get("minecraft:geometry", []):
            geometries.add(entry.get("description", {}).get("identifier"))
    for name, geometry in description.get("geometry", {}).items():
        if geometry not in geometries:
            fail(f"{path}: geometry {name!r} -> {geometry!r} is not defined")

    # Render controllers.
    controllers = set()
    for doc_path, controller in documents.items():
        if "render_controllers" not in doc_path or controller is None:
            continue
        controllers.update(controller.get("render_controllers", {}))
    for controller in description.get("render_controllers", []):
        name = controller if isinstance(controller, str) else next(iter(controller))
        if name not in controllers:
            fail(f"{path}: render controller {name!r} is not defined")

    # Animations.
    defined = set()
    for doc_path, animation in documents.items():
        if ".animation.json" not in doc_path or animation is None:
            continue
        defined.update(animation.get("animations", {}))
    short_names = description.get("animations", {})
    for short, full in short_names.items():
        if full not in defined:
            fail(f"{path}: animation {short!r} -> {full!r} is not defined")

    for entry in description.get("scripts", {}).get("animate", []):
        short = entry if isinstance(entry, str) else next(iter(entry))
        if short not in short_names:
            fail(f"{path}: animate entry {short!r} has no animation mapping")

    # Spawn egg icon.
    spawn_egg = description.get("spawn_egg", {})
    key = spawn_egg.get("texture")
    if key:
        atlas = documents.get(os.path.join(RP, "textures", "item_texture.json"))
        if atlas is None:
            fail(f"{path}: spawn egg needs textures/item_texture.json")
        elif key not in atlas.get("texture_data", {}):
            fail(f"{path}: spawn egg texture {key!r} missing from item_texture.json")
        else:
            png = os.path.join(RP, atlas["texture_data"][key]["textures"] + ".png")
            if not os.path.isfile(png):
                fail(f"{path}: spawn egg icon points at missing file {png}")


def check_animation_bones(documents):
    """Animating a bone that does not exist fails silently in game."""
    bones = set()
    for path, geo in documents.items():
        if not path.endswith(".geo.json") or geo is None:
            continue
        for entry in geo.get("minecraft:geometry", []):
            defined = {bone["name"] for bone in entry.get("bones", [])}
            bones |= defined
            for bone in entry.get("bones", []):
                parent = bone.get("parent")
                if parent and parent not in defined:
                    fail(f"{path}: bone {bone['name']!r} has unknown parent {parent!r}")

    for path, animation in documents.items():
        if ".animation.json" not in path or animation is None:
            continue
        for name, body in animation.get("animations", {}).items():
            for bone in body.get("bones", {}):
                if bone not in bones:
                    fail(f"{path}: {name} animates unknown bone {bone!r}")


def check_language(documents):
    lang_path = os.path.join(RP, "texts", "en_US.lang")
    if not os.path.isfile(lang_path):
        fail(f"missing {lang_path}")
        return
    with open(lang_path, encoding="utf-8") as handle:
        lang = handle.read()
    for key in (
        f"entity.{ENTITY_ID}.name=",
        f"item.spawn_egg.entity.{ENTITY_ID}.name=",
    ):
        if key not in lang:
            fail(f"{lang_path}: missing entry {key}")


def check_script(documents):
    """Cheap sanity pass over main.js - catches events renamed on one side."""
    path = os.path.join(BP, "scripts", "main.js")
    if not os.path.isfile(path):
        return
    with open(path, encoding="utf-8") as handle:
        source = handle.read()

    entity_doc = documents.get(os.path.join(BP, "entities", "anaconda.json")) or {}
    events = set(entity_doc.get("minecraft:entity", {}).get("events", {}))
    for event in sorted(set(re.findall(r'"(anaconda:[a-z_]+)"', source))):
        if event not in events and event != ENTITY_ID:
            fail(f"{path}: triggers event {event!r} that the entity does not define")


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

    check_manifests(bp_manifest, rp_manifest)

    entity_path = os.path.join(BP, "entities", "anaconda.json")
    entity_doc = documents.get(entity_path)
    events = set()
    if entity_doc is None:
        fail(f"missing {entity_path}")
    else:
        events = check_server_entity(entity_doc, entity_path)

    spawn_path = os.path.join(BP, "spawn_rules", "anaconda.json")
    if os.path.isfile(spawn_path):
        check_spawn_rules(documents[spawn_path], spawn_path, events)

    client_path = os.path.join(RP, "entity", "anaconda.entity.json")
    if documents.get(client_path) is None:
        fail(f"missing {client_path}")
    else:
        check_client_entity(documents[client_path], client_path, documents)

    check_animation_bones(documents)
    check_language(documents)
    check_script(documents)

    print(f"Validated {len(documents)} JSON files for {ENTITY_ID}.")


def package():
    os.makedirs(DIST, exist_ok=True)
    if os.path.exists(ADDON):
        os.remove(ADDON)

    with zipfile.ZipFile(ADDON, "w", zipfile.ZIP_DEFLATED) as archive:
        for root, folder in ((BP, "anaconda_bp"), (RP, "anaconda_rp")):
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
