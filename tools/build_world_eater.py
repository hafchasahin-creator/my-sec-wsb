#!/usr/bin/env python3
"""Validate and package the World Eater add-on.

Every check here exists because failing it produces either a failed import or
an add-on that imports fine and is then silently broken in game (invisible
mob, missing texture, an entity event the script triggers that does not
exist). Run it before shipping.

Usage:  python3 tools/build_world_eater.py
"""

import json
import os
import re
import sys
import zipfile

BP = os.path.join("behavior_packs", "world_eater_bp")
RP = os.path.join("resource_packs", "world_eater_rp")
DIST = "dist"
ADDON = os.path.join(DIST, "WorldEater.mcaddon")

ENTITY_ID = "we:world_eater"

errors = []
notes = []


def fail(message):
    errors.append(message)


def load_json(path):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except Exception as exc:  # noqa: BLE001 - collect and keep going
        fail(f"{path}: invalid JSON ({exc})")
        return None


def walk(root, suffix):
    for base, _dirs, files in os.walk(root):
        for name in sorted(files):
            if name.endswith(suffix):
                yield os.path.join(base, name)


def rel(root, *parts):
    return os.path.join(root, *parts)


def check_manifests(docs):
    bp = docs.get(rel(BP, "manifest.json"))
    rp = docs.get(rel(RP, "manifest.json"))
    if not bp or not rp:
        fail("missing a manifest.json")
        return None, None

    uuid_re = re.compile(
        r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    seen = {}
    for label, manifest in (("BP", bp), ("RP", rp)):
        for required in ("format_version", "header", "modules"):
            if required not in manifest:
                fail(f"{label} manifest: missing '{required}'")
        header = manifest.get("header", {})
        for required in ("name", "uuid", "version", "min_engine_version"):
            if required not in header:
                fail(f"{label} manifest header: missing '{required}'")
        ids = [("header", header.get("uuid"))]
        for module in manifest.get("modules", []):
            ids.append((module.get("type", "?"), module.get("uuid")))
        for where, value in ids:
            if not value or not uuid_re.match(str(value)):
                fail(f"{label} manifest {where}: '{value}' is not a valid UUID")
            elif value in seen:
                fail(f"UUID {value} used twice ({seen[value]} and {label}/{where})")
            else:
                seen[value] = f"{label}/{where}"

    # Also make sure we do not collide with the other add-on in this repo.
    other = os.path.join("behavior_packs", "arcane_arsenal_bp", "manifest.json")
    other_rp = os.path.join("resource_packs", "arcane_arsenal_rp", "manifest.json")
    for path in (other, other_rp):
        if not os.path.isfile(path):
            continue
        doc = load_json(path)
        if not doc:
            continue
        foreign = [doc["header"]["uuid"]] + [m["uuid"] for m in doc["modules"]]
        clash = set(foreign) & set(seen)
        if clash:
            fail(f"UUID clash with {path}: {sorted(clash)}")

    rp_uuid = rp["header"]["uuid"]
    deps = bp.get("dependencies", [])
    if rp_uuid not in [d.get("uuid") for d in deps]:
        fail("BP manifest does not depend on the RP header UUID")
    else:
        dep = next(d for d in deps if d.get("uuid") == rp_uuid)
        if dep.get("version") != rp["header"]["version"]:
            fail(
                f"BP dependency version {dep.get('version')} != RP header "
                f"version {rp['header']['version']}"
            )

    script_dep = [d for d in deps if d.get("module_name") == "@minecraft/server"]
    script_modules = [m for m in bp["modules"] if m.get("type") == "script"]
    if script_modules and not script_dep:
        fail("BP declares a script module but no @minecraft/server dependency")
    for module in script_modules:
        entry = rel(BP, module.get("entry", ""))
        if not os.path.isfile(entry):
            fail(f"script entry not found: {entry}")
    if script_dep:
        notes.append(f"@minecraft/server {script_dep[0]['version']}")

    return bp, rp


def check_entity(docs):
    bp_path = rel(BP, "entities", "world_eater.json")
    rp_path = rel(RP, "entity", "world_eater.entity.json")
    bp_entity = docs.get(bp_path)
    rp_entity = docs.get(rp_path)
    if not bp_entity or not rp_entity:
        fail("missing the behaviour or client entity definition")
        return

    desc = bp_entity["minecraft:entity"]["description"]
    if desc.get("identifier") != ENTITY_ID:
        fail(f"{bp_path}: identifier is {desc.get('identifier')}, expected {ENTITY_ID}")
    if not desc.get("is_spawnable"):
        fail(f"{bp_path}: is_spawnable must be true or no spawn egg is generated")
    if not desc.get("is_summonable"):
        fail(f"{bp_path}: is_summonable must be true")

    client = rp_entity["minecraft:client_entity"]["description"]
    if client.get("identifier") != ENTITY_ID:
        fail(f"{rp_path}: identifier does not match the behaviour entity")

    # Component groups referenced by events must exist.
    groups = set(bp_entity["minecraft:entity"].get("component_groups", {}))
    events = bp_entity["minecraft:entity"].get("events", {})
    for name, event in events.items():
        for action in ("add", "remove"):
            for group in event.get(action, {}).get("component_groups", []):
                if group not in groups:
                    fail(f"{bp_path}: event '{name}' {action}s unknown group '{group}'")

    # Every event the script triggers must exist on the entity.
    script_path = rel(BP, "scripts", "main.js")
    if os.path.isfile(script_path):
        with open(script_path, encoding="utf-8") as handle:
            script = handle.read()
        # Literal single-argument calls: triggerEvent("we:begin_death")
        triggered = set(re.findall(r'triggerEvent\(\s*"([^"]+)"\s*\)', script))
        # The stage events are built by concatenation, so check all four.
        if re.search(r'triggerEvent\(\s*"we:stage_"\s*\+', script):
            triggered |= {f"we:stage_{stage}" for stage in range(1, 5)}
        for event in sorted(triggered):
            if event not in events:
                fail(f"{script_path}: triggers entity event '{event}' which is not defined")

    # Loot table reference.
    loot = bp_entity["minecraft:entity"]["components"].get("minecraft:loot", {})
    table = loot.get("table")
    if table:
        if not os.path.isfile(rel(BP, table)):
            fail(f"{bp_path}: loot table not found at {rel(BP, table)}")

    return bp_entity, rp_entity, client


def check_client_assets(docs, client):
    rp_path = rel(RP, "entity", "world_eater.entity.json")

    # Textures -> PNGs on disk.
    for key, path in client.get("textures", {}).items():
        png = rel(RP, path + ".png")
        if not os.path.isfile(png):
            fail(f"{rp_path}: texture '{key}' points at missing file {png}")

    # Geometry -> identifier declared in a .geo.json.
    geo_ids = set()
    bones_by_geo = {}
    for path in walk(rel(RP, "models"), ".json"):
        doc = docs.get(path)
        if not doc:
            continue
        for geo in doc.get("minecraft:geometry", []):
            identifier = geo.get("description", {}).get("identifier")
            geo_ids.add(identifier)
            bones = {b["name"]: b for b in geo.get("bones", [])}
            bones_by_geo[identifier] = bones
            for name, bone in bones.items():
                parent = bone.get("parent")
                if parent and parent not in bones:
                    fail(f"{path}: bone '{name}' has unknown parent '{parent}'")
            width = geo["description"].get("texture_width")
            height = geo["description"].get("texture_height")
            for name, bone in bones.items():
                for cube in bone.get("cubes", []):
                    uv = cube.get("uv")
                    size = cube.get("size")
                    if not isinstance(uv, list) or len(uv) != 2:
                        continue
                    fw = 2 * (size[2] + size[0])
                    fh = size[2] + size[1]
                    if uv[0] + fw > width or uv[1] + fh > height:
                        fail(
                            f"{path}: cube in bone '{name}' has box UV "
                            f"{uv} + {fw}x{fh} outside the {width}x{height} atlas"
                        )

    geometry_names = set()
    for key, identifier in client.get("geometry", {}).items():
        geometry_names.add(key)
        if identifier not in geo_ids:
            fail(f"{rp_path}: geometry '{identifier}' is not defined in any model file")

    # Render controllers exist and only reference declared arrays/textures.
    controllers = {}
    for path in walk(rel(RP, "render_controllers"), ".json"):
        doc = docs.get(path)
        if doc:
            controllers.update(doc.get("render_controllers", {}))
    for name in client.get("render_controllers", []):
        key = name if isinstance(name, str) else list(name)[0]
        if key not in controllers:
            fail(f"{rp_path}: render controller '{key}' is not defined")
            continue
        controller = controllers[key]
        arrays = controller.get("arrays", {}).get("textures", {})
        declared = set(client.get("textures", {}))
        for array_name, entries in arrays.items():
            for entry in entries:
                short = entry.replace("Texture.", "")
                if short not in declared:
                    fail(
                        f"{path}: {array_name} references Texture.{short}, "
                        f"which the client entity does not declare"
                    )
        for entry in controller.get("textures", []):
            base = entry.split("[")[0]
            if base.startswith("Array."):
                if base not in arrays:
                    fail(f"{path}: uses {base} but no such texture array is defined")
            elif base.startswith("Texture."):
                if base.replace("Texture.", "") not in declared:
                    fail(f"{path}: uses {base}, not declared on the client entity")
        geo_ref = controller.get("geometry", "")
        if geo_ref.startswith("Geometry."):
            if geo_ref.replace("Geometry.", "") not in geometry_names:
                fail(f"{path}: uses {geo_ref}, not declared on the client entity")

    # Animations and animation controllers.
    animations = {}
    for path in walk(rel(RP, "animations"), ".json"):
        doc = docs.get(path)
        if doc:
            animations.update(doc.get("animations", {}))
    anim_controllers = {}
    for path in walk(rel(RP, "animation_controllers"), ".json"):
        doc = docs.get(path)
        if doc:
            anim_controllers.update(doc.get("animation_controllers", {}))

    declared_anims = client.get("animations", {})
    for short, full in declared_anims.items():
        if full.startswith("controller."):
            if full not in anim_controllers:
                fail(f"{rp_path}: animation controller '{full}' is not defined")
        elif full not in animations:
            fail(f"{rp_path}: animation '{full}' is not defined")

    for short in client.get("scripts", {}).get("animate", []):
        key = short if isinstance(short, str) else list(short)[0]
        if key not in declared_anims:
            fail(f"{rp_path}: scripts/animate runs '{key}', which is not declared")

    # Controller states may only play animations the client entity declares.
    for name, controller in anim_controllers.items():
        for state_name, state in controller.get("states", {}).items():
            for anim in state.get("animations", []):
                key = anim if isinstance(anim, str) else list(anim)[0]
                if key not in declared_anims:
                    fail(
                        f"animation controller {name}/{state_name} plays '{key}', "
                        f"which the client entity does not declare"
                    )
            for transition in state.get("transitions", []):
                for target in transition:
                    if target not in controller.get("states", {}):
                        fail(
                            f"animation controller {name}/{state_name} "
                            f"transitions to unknown state '{target}'"
                        )
        initial = controller.get("initial_state")
        if initial and initial not in controller.get("states", {}):
            fail(f"animation controller {name}: initial_state '{initial}' does not exist")

    # Particles and sounds referenced by name on the client entity.
    particles = set()
    for path in walk(rel(RP, "particles"), ".json"):
        doc = docs.get(path)
        if doc:
            identifier = doc.get("particle_effect", {}).get("description", {}).get(
                "identifier"
            )
            if identifier in particles:
                fail(f"{path}: duplicate particle identifier '{identifier}'")
            particles.add(identifier)
            texture = (
                doc["particle_effect"]["description"]
                .get("basic_render_parameters", {})
                .get("texture")
            )
            if texture and not texture.startswith("textures/particle/"):
                notes.append(f"{path}: particle texture outside textures/particle")
            if texture and texture.startswith("textures/"):
                png = rel(RP, texture + ".png")
                if not os.path.isfile(png) and "world_eater" in texture:
                    fail(f"{path}: particle texture missing: {png}")

    declared_particles = client.get("particle_effects", {})
    for key, identifier in declared_particles.items():
        if identifier not in particles:
            fail(f"{rp_path}: particle '{identifier}' ({key}) is not defined")

    sound_defs = docs.get(rel(RP, "sounds", "sound_definitions.json"), {})
    sound_events = set(sound_defs.get("sound_definitions", {}))
    declared_sounds = client.get("sound_effects", {})
    for key, identifier in declared_sounds.items():
        if identifier not in sound_events:
            fail(f"{rp_path}: sound event '{identifier}' ({key}) is not in sound_definitions")

    # Animation timelines may only use effects/sounds/bones that exist.
    geometry_id = client.get("geometry", {}).get("default")
    bones = bones_by_geo.get(geometry_id, {})
    locators = set()
    for bone in bones.values():
        locators |= set(bone.get("locators", {}))

    for name, anim in animations.items():
        for bone_name in anim.get("bones", {}):
            if bones and bone_name not in bones:
                fail(f"animation '{name}' animates bone '{bone_name}', not in the model")
        for timestamp, events in anim.get("particle_effects", {}).items():
            for event in events if isinstance(events, list) else [events]:
                effect = event.get("effect")
                if effect not in declared_particles:
                    fail(
                        f"animation '{name}' @{timestamp} uses particle "
                        f"'{effect}', not declared on the client entity"
                    )
                locator = event.get("locator")
                if locator and locators and locator not in locators:
                    fail(
                        f"animation '{name}' @{timestamp} uses locator "
                        f"'{locator}', which the model does not have"
                    )
        for timestamp, events in anim.get("sound_effects", {}).items():
            for event in events if isinstance(events, list) else [events]:
                effect = event.get("effect")
                if effect not in declared_sounds:
                    fail(
                        f"animation '{name}' @{timestamp} uses sound "
                        f"'{effect}', not declared on the client entity"
                    )

    # Particles the script spawns must exist too.
    script_path = rel(BP, "scripts", "main.js")
    if os.path.isfile(script_path):
        with open(script_path, encoding="utf-8") as handle:
            script = handle.read()
        for identifier in sorted(set(re.findall(r'"(we:[a-z_]+)"', script))):
            if identifier.startswith("we:stage") or identifier in (
                ENTITY_ID,
                "we:world_core",
                "we:begin_death",
                "we:end_death",
                "we:despawn",
                "we:consumed",
            ):
                continue
            if identifier not in particles:
                fail(f"{script_path}: spawns particle '{identifier}' which is not defined")
        for identifier in sorted(set(re.findall(r'"(we\.[a-z_]+)"', script))):
            if identifier not in sound_events:
                fail(f"{script_path}: plays sound '{identifier}' which is not defined")

    return particles


def check_items(docs, client):
    atlas_path = rel(RP, "textures", "item_texture.json")
    atlas = docs.get(atlas_path)
    if atlas is None:
        fail(f"missing {atlas_path}")
        return []
    texture_data = atlas.get("texture_data", {})

    for key, entry in texture_data.items():
        png = rel(RP, entry["textures"] + ".png")
        if not os.path.isfile(png):
            fail(f"{atlas_path}: '{key}' points at missing file {png}")

    identifiers = []
    for path in walk(rel(BP, "items"), ".json"):
        doc = docs.get(path)
        if not doc:
            continue
        item = doc.get("minecraft:item", {})
        identifier = item.get("description", {}).get("identifier")
        identifiers.append(identifier)
        version = tuple(
            int(part) for part in str(doc.get("format_version", "0")).split(".")
        )
        icon = item.get("components", {}).get("minecraft:icon")
        # The flat {"texture": ...} form is ignored from 1.20.60 on and shows
        # up in game as a completely blank icon.
        if isinstance(icon, dict) and "texture" in icon and version >= (1, 20, 60):
            fail(
                f"{path}: minecraft:icon uses the deprecated 'texture' field at "
                f'format_version {doc["format_version"]} - use '
                '{"textures": {"default": ...}}'
            )
            continue
        key = icon.get("textures", {}).get("default") if isinstance(icon, dict) else icon
        if not key:
            fail(f"{path}: no minecraft:icon texture")
        elif key not in texture_data:
            fail(f"{path}: icon '{key}' missing from item_texture.json")

    # The spawn egg icon comes from the client entity, not an item file.
    egg = client.get("spawn_egg", {})
    egg_key = egg.get("texture")
    if not egg_key:
        fail("client entity has no spawn_egg texture - the egg will be a plain default")
    elif egg_key not in texture_data:
        fail(f"spawn egg texture '{egg_key}' missing from item_texture.json")

    # Loot table entries must be real items.
    for path in walk(rel(BP, "loot_tables"), ".json"):
        doc = docs.get(path)
        if not doc:
            continue
        for pool in doc.get("pools", []):
            for entry in pool.get("entries", []):
                name = entry.get("name", "")
                if name.startswith("we:") and name not in identifiers:
                    fail(f"{path}: drops '{name}', which has no item definition")

    lang_path = rel(RP, "texts", "en_US.lang")
    lang = ""
    if os.path.isfile(lang_path):
        with open(lang_path, encoding="utf-8") as handle:
            lang = handle.read()
    for identifier in identifiers:
        if identifier and f"item.{identifier}" not in lang:
            fail(f"{lang_path}: no name entry for {identifier}")
    if f"entity.{ENTITY_ID}.name" not in lang:
        fail(f"{lang_path}: no name entry for {ENTITY_ID}")
    if f"item.spawn_egg.entity.{ENTITY_ID}.name" not in lang:
        fail(f"{lang_path}: no spawn egg name entry for {ENTITY_ID}")

    return identifiers


def check_pack_icons():
    for root in (BP, RP):
        icon = rel(root, "pack_icon.png")
        if not os.path.isfile(icon):
            fail(f"missing {icon}")


def validate():
    docs = {}
    for root in (BP, RP):
        if not os.path.isdir(root):
            fail(f"missing pack directory: {root}")
            continue
        for path in walk(root, ".json"):
            docs[path] = load_json(path)

    if errors:
        return docs

    check_manifests(docs)
    result = check_entity(docs)
    if result:
        _bp_entity, _rp_entity, client = result
        check_client_assets(docs, client)
        check_items(docs, client)
    check_pack_icons()

    print(f"Validated {len(docs)} JSON files.")
    return docs


def package():
    os.makedirs(DIST, exist_ok=True)
    if os.path.exists(ADDON):
        os.remove(ADDON)

    count = 0
    with zipfile.ZipFile(ADDON, "w", zipfile.ZIP_DEFLATED) as archive:
        for root, folder in ((BP, "world_eater_bp"), (RP, "world_eater_rp")):
            for base, _dirs, files in os.walk(root):
                for name in sorted(files):
                    source = os.path.join(base, name)
                    arcname = os.path.join(
                        folder, os.path.relpath(source, root)
                    ).replace(os.sep, "/")
                    archive.write(source, arcname)
                    count += 1

    with zipfile.ZipFile(ADDON) as archive:
        bad = archive.testzip()
        if bad:
            print(f"corrupt entry in archive: {bad}", file=sys.stderr)
            sys.exit(1)
        names = archive.namelist()
        for required in ("world_eater_bp/manifest.json", "world_eater_rp/manifest.json"):
            if required not in names:
                print(f"archive is missing {required}", file=sys.stderr)
                sys.exit(1)

    size = os.path.getsize(ADDON)
    print(f"Packaged {ADDON} ({count} files, {size:,} bytes)")


if __name__ == "__main__":
    validate()
    if errors:
        print("\nBuild failed:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        sys.exit(1)
    for note in notes:
        print(f"note: {note}")
    package()
