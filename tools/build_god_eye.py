#!/usr/bin/env python3
"""Validate and package the God Eye Guardian add-on.

The point of this script is that a broken pack fails here rather than silently
on a phone. It walks every cross-reference the game makes at load time:

  manifests   format, UUID uniqueness and shape, versions, the BP -> RP
              dependency, min_engine_version, the script module entry point
  entities    every behaviour entity has a client entity and vice versa
  models      geometry identifiers, bone parents, locators used by animations
  textures    every texture path in every client entity and particle resolves
              to a real .png, plus the spawn egg's item_texture.json entry
  animations  every animation, animation controller, render controller and
              particle short-name a client entity references really exists,
              and every animation controller state names a known animation
  materials   Material.* keys used by render controllers are declared
  particles   every particle keyframe in an animation is in particle_effects
  script      every god_eye:* identifier main.js mentions is a real entity,
              particle, fog or entity event
  language    display names for every entity and spawn egg
  packaging   lowercase ASCII paths only, then the .mcaddon zip

Usage:  python3 tools/build_god_eye.py [--skip-sim]
"""

import json
import os
import re
import shutil
import subprocess
import sys
import uuid
import zipfile

BP = os.path.join("behavior_packs", "god_eye_bp")
RP = os.path.join("resource_packs", "god_eye_rp")
DIST = "dist"
ADDON = os.path.join(DIST, "God_Eye_Guardian.mcaddon")
NAMESPACE = "god_eye"
MIN_ENGINE = [1, 21, 0]

errors = []
notes = []


def fail(message):
    errors.append(message)


def note(message):
    notes.append(message)


# --------------------------------------------------------------------------
# Loading
# --------------------------------------------------------------------------

def load_json(path):
    try:
        with open(path, encoding="utf-8") as handle:
            text = handle.read()
    except OSError as exc:
        fail(f"{path}: cannot read ({exc})")
        return None
    if text.startswith("﻿"):
        fail(f"{path}: starts with a UTF-8 BOM, which Minecraft rejects")
        text = text.lstrip("﻿")
    try:
        return json.loads(text)
    except ValueError as exc:
        fail(f"{path}: invalid JSON ({exc})")
        return None


def walk(root, suffix):
    for base, _dirs, files in os.walk(root):
        for name in sorted(files):
            if name.endswith(suffix):
                yield os.path.join(base, name)


def read_text(path):
    if not os.path.isfile(path):
        return ""
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def rp_texture_exists(reference):
    """Client entities and particles name textures without the extension."""
    for extension in (".png", ".tga", ".jpg"):
        if os.path.isfile(os.path.join(RP, reference + extension)):
            return True
    return os.path.isfile(os.path.join(RP, reference))


# --------------------------------------------------------------------------
# Manifests
# --------------------------------------------------------------------------

def check_manifests(bp_manifest, rp_manifest):
    seen = {}

    for label, manifest, path in (
        ("BP", bp_manifest, os.path.join(BP, "manifest.json")),
        ("RP", rp_manifest, os.path.join(RP, "manifest.json")),
    ):
        if manifest.get("format_version") != 2:
            fail(f"{path}: format_version must be 2")

        header = manifest.get("header", {})
        for key in ("name", "description", "uuid", "version", "min_engine_version"):
            if key not in header:
                fail(f"{path}: header is missing '{key}'")

        if header.get("min_engine_version") != MIN_ENGINE:
            fail(
                f"{path}: min_engine_version is {header.get('min_engine_version')}, "
                f"expected {MIN_ENGINE}"
            )
        if not isinstance(header.get("version"), list) or len(header["version"]) != 3:
            fail(f"{path}: header version must be a three-part list")

        modules = manifest.get("modules") or []
        if not modules:
            fail(f"{path}: no modules")
        for module in modules:
            if "uuid" not in module or "version" not in module or "type" not in module:
                fail(f"{path}: a module is missing type/uuid/version")

        for candidate, where in [(header.get("uuid"), f"{label} header")] + [
            (module.get("uuid"), f"{label} {module.get('type')} module") for module in modules
        ]:
            if candidate is None:
                continue
            try:
                uuid.UUID(str(candidate))
            except ValueError:
                fail(f"{path}: '{candidate}' is not a valid UUID ({where})")
            if candidate in seen:
                fail(f"duplicate UUID {candidate}: {where} and {seen[candidate]}")
            else:
                seen[candidate] = where

    # The behaviour pack must pull its resource pack in, at a matching version.
    rp_uuid = rp_manifest["header"]["uuid"]
    rp_version = rp_manifest["header"]["version"]
    dependencies = bp_manifest.get("dependencies") or []

    pack_dependency = next((d for d in dependencies if d.get("uuid") == rp_uuid), None)
    if pack_dependency is None:
        fail(f"behaviour pack does not depend on the resource pack ({rp_uuid})")
    elif pack_dependency.get("version") != rp_version:
        fail(
            f"BP depends on RP version {pack_dependency.get('version')} but the RP "
            f"manifest says {rp_version}"
        )

    server = next((d for d in dependencies if d.get("module_name") == "@minecraft/server"), None)
    if server is None:
        fail("behaviour pack does not declare a @minecraft/server dependency")
    else:
        note(f"script module: @minecraft/server {server.get('version')}")

    script_modules = [m for m in bp_manifest.get("modules", []) if m.get("type") == "script"]
    if not script_modules:
        fail("behaviour pack has no script module")
    for module in script_modules:
        entry = module.get("entry")
        if not entry:
            fail("script module has no entry")
        elif not os.path.isfile(os.path.join(BP, entry)):
            fail(f"script entry not found: {os.path.join(BP, entry)}")

    for pack, path in ((BP, os.path.join(BP, "pack_icon.png")), (RP, os.path.join(RP, "pack_icon.png"))):
        if not os.path.isfile(path):
            fail(f"{pack}: missing pack_icon.png")


# --------------------------------------------------------------------------
# Entities, models, animations, particles
# --------------------------------------------------------------------------

def collect(documents, root, top_key):
    out = {}
    for path, doc in documents.items():
        if not path.startswith(root) or not isinstance(doc, dict):
            continue
        if top_key in doc:
            out[path] = doc[top_key]
    return out


def check_content(documents):
    bp_entities = collect(documents, os.path.join(BP, "entities"), "minecraft:entity")
    rp_entities = collect(documents, os.path.join(RP, "entity"), "minecraft:client_entity")

    behaviour_ids = {}
    for path, entity in bp_entities.items():
        description = entity.get("description", {})
        identifier = description.get("identifier")
        if not identifier:
            fail(f"{path}: entity has no identifier")
            continue
        if not identifier.startswith(f"{NAMESPACE}:"):
            fail(f"{path}: identifier '{identifier}' is outside the {NAMESPACE} namespace")
        behaviour_ids[identifier] = (path, description, entity)

    client_ids = {}
    for path, entity in rp_entities.items():
        description = entity.get("description", {})
        identifier = description.get("identifier")
        if not identifier:
            fail(f"{path}: client entity has no identifier")
            continue
        client_ids[identifier] = (path, description)

    for identifier in behaviour_ids:
        if identifier not in client_ids:
            fail(f"{identifier}: has a behaviour entity but no client entity (it would be invisible)")
    for identifier in client_ids:
        if identifier not in behaviour_ids:
            fail(f"{identifier}: has a client entity but no behaviour entity")

    # --- component groups referenced by events must exist -----------------
    for identifier, (path, _description, entity) in behaviour_ids.items():
        groups = set(entity.get("component_groups", {}))
        for event_name, event in (entity.get("events") or {}).items():
            for action in ("add", "remove"):
                for group in (event.get(action) or {}).get("component_groups", []):
                    if group not in groups:
                        fail(f"{path}: event '{event_name}' {action}s unknown component group '{group}'")

    # --- geometry ----------------------------------------------------------
    geometries = set()
    geometry_bones = {}
    for path in walk(os.path.join(RP, "models"), ".json"):
        doc = documents.get(path)
        if not isinstance(doc, dict):
            continue
        for geometry in doc.get("minecraft:geometry", []):
            identifier = geometry.get("description", {}).get("identifier")
            if not identifier:
                fail(f"{path}: a geometry has no identifier")
                continue
            geometries.add(identifier)

            bones = geometry.get("bones", [])
            names = {bone.get("name") for bone in bones}
            geometry_bones[identifier] = {
                "bones": names,
                "locators": {
                    locator
                    for bone in bones
                    for locator in (bone.get("locators") or {})
                },
            }
            for bone in bones:
                parent = bone.get("parent")
                if parent and parent not in names:
                    fail(f"{path}: bone '{bone.get('name')}' has unknown parent '{parent}'")

    # --- animations, controllers, render controllers -----------------------
    animations = {}
    for path in walk(os.path.join(RP, "animations"), ".json"):
        doc = documents.get(path)
        if isinstance(doc, dict):
            animations.update({name: (path, body) for name, body in (doc.get("animations") or {}).items()})

    controllers = set()
    controller_states = {}
    for path in walk(os.path.join(RP, "animation_controllers"), ".json"):
        doc = documents.get(path)
        if not isinstance(doc, dict):
            continue
        for name, body in (doc.get("animation_controllers") or {}).items():
            controllers.add(name)
            controller_states[name] = body

    render_controllers = {}
    for path in walk(os.path.join(RP, "render_controllers"), ".json"):
        doc = documents.get(path)
        if not isinstance(doc, dict):
            continue
        for name, body in (doc.get("render_controllers") or {}).items():
            render_controllers[name] = body

    particles = set()
    for path in walk(os.path.join(RP, "particles"), ".json"):
        doc = documents.get(path)
        if not isinstance(doc, dict):
            continue
        description = doc.get("particle_effect", {}).get("description", {})
        identifier = description.get("identifier")
        if not identifier:
            fail(f"{path}: particle has no identifier")
            continue
        particles.add(identifier)
        texture = description.get("basic_render_parameters", {}).get("texture")
        if not texture:
            fail(f"{path}: particle '{identifier}' has no texture")
        elif not rp_texture_exists(texture):
            fail(f"{path}: particle texture '{texture}' does not resolve to a file")

    fogs = set()
    for path in walk(os.path.join(RP, "fogs"), ".json"):
        doc = documents.get(path)
        if isinstance(doc, dict):
            identifier = doc.get("minecraft:fog_settings", {}).get("description", {}).get("identifier")
            if identifier:
                fogs.add(identifier)

    # --- every client entity reference resolves ----------------------------
    atlas = documents.get(os.path.join(RP, "textures", "item_texture.json")) or {}
    atlas_keys = atlas.get("texture_data", {})

    for identifier, (path, description) in client_ids.items():
        for key, texture in (description.get("textures") or {}).items():
            if not rp_texture_exists(texture):
                fail(f"{path}: texture '{key}' -> '{texture}' does not resolve to a file")

        used_geometries = description.get("geometry") or {}
        for key, geometry in used_geometries.items():
            if geometry not in geometries:
                fail(f"{path}: geometry '{key}' -> '{geometry}' is not defined in models/")

        declared_animations = description.get("animations") or {}
        for short, full in declared_animations.items():
            if full.startswith("controller.animation."):
                if full not in controllers:
                    fail(f"{path}: animation '{short}' -> controller '{full}' does not exist")
            elif full not in animations:
                fail(f"{path}: animation '{short}' -> '{full}' does not exist in animations/")

        for controller in (description.get("scripts") or {}).get("animate", []):
            name = controller if isinstance(controller, str) else next(iter(controller))
            if name.startswith("controller.animation."):
                if name not in controllers:
                    fail(f"{path}: animate references unknown controller '{name}'")
            elif name not in declared_animations:
                fail(f"{path}: animate references unknown animation short name '{name}'")

        declared_particles = description.get("particle_effects") or {}
        for short, full in declared_particles.items():
            if full not in particles:
                fail(f"{path}: particle_effects '{short}' -> '{full}' does not exist in particles/")

        materials = description.get("materials") or {}
        for controller_name in description.get("render_controllers", []):
            name = controller_name if isinstance(controller_name, str) else next(iter(controller_name))
            body = render_controllers.get(name)
            if body is None:
                fail(f"{path}: render controller '{name}' does not exist")
                continue
            for mapping in body.get("materials", []):
                for _bone, material in mapping.items():
                    key = material.replace("Material.", "")
                    if key not in materials:
                        fail(f"{path}: render controller '{name}' uses Material.{key}, which is not declared")

        # Every animation this entity can play must only touch bones and
        # locators the geometry actually has, and only fire declared particles.
        geometry_name = used_geometries.get("default")
        shape = geometry_bones.get(geometry_name, {})
        for short, full in declared_animations.items():
            entry = animations.get(full)
            if entry is None:
                continue
            _animation_path, body = entry
            for bone in (body.get("bones") or {}):
                if shape and bone not in shape["bones"]:
                    fail(f"{path}: animation '{full}' animates bone '{bone}', absent from {geometry_name}")
            for _time, effect in (body.get("particle_effects") or {}).items():
                for item in effect if isinstance(effect, list) else [effect]:
                    name = item.get("effect")
                    locator = item.get("locator")
                    if name not in declared_particles:
                        fail(f"{path}: animation '{full}' fires particle '{name}', not in particle_effects")
                    if locator and shape and locator not in shape["locators"]:
                        fail(f"{path}: animation '{full}' uses locator '{locator}', absent from {geometry_name}")

        # Animation controller states may only name animations this entity declares.
        for controller in (description.get("scripts") or {}).get("animate", []):
            name = controller if isinstance(controller, str) else next(iter(controller))
            body = controller_states.get(name)
            if body is None:
                continue
            states = body.get("states") or {}
            for state_name, state in states.items():
                for animation in state.get("animations", []):
                    short = animation if isinstance(animation, str) else next(iter(animation))
                    if short not in declared_animations:
                        fail(
                            f"{path}: controller '{name}' state '{state_name}' plays '{short}', "
                            f"which this entity does not declare"
                        )
                for transition in state.get("transitions", []):
                    for destination in transition:
                        if destination not in states:
                            fail(f"{name}: state '{state_name}' transitions to unknown state '{destination}'")
            initial = body.get("initial_state")
            if initial and initial not in states:
                fail(f"{name}: initial_state '{initial}' is not a state")

    # --- spawn eggs ---------------------------------------------------------
    for identifier, (path, description, _entity) in behaviour_ids.items():
        if not description.get("is_spawnable"):
            continue
        client = client_ids.get(identifier)
        if not client:
            continue
        egg = (client[1].get("spawn_egg") or {})
        texture_key = egg.get("texture")
        if not texture_key:
            note(f"{identifier}: spawnable with no spawn_egg texture - the game will use a default egg")
            continue
        if texture_key not in atlas_keys:
            fail(f"{client[0]}: spawn egg texture '{texture_key}' is missing from item_texture.json")
        elif not rp_texture_exists(atlas_keys[texture_key]["textures"]):
            fail(f"item_texture.json: '{texture_key}' points at a missing file")

    # --- language -----------------------------------------------------------
    lang = read_text(os.path.join(RP, "texts", "en_US.lang"))
    for identifier, (_path, description, _entity) in behaviour_ids.items():
        if f"entity.{identifier}.name=" not in lang:
            fail(f"en_US.lang: no display name for entity {identifier}")
        if description.get("is_spawnable") and f"item.spawn_egg.entity.{identifier}.name=" not in lang:
            fail(f"en_US.lang: no spawn egg name for {identifier}")

    return behaviour_ids, particles, fogs


# --------------------------------------------------------------------------
# Script and functions
# --------------------------------------------------------------------------

def check_script(behaviour_ids, particles, fogs, documents):
    path = os.path.join(BP, "scripts", "main.js")
    source = read_text(path)
    if not source:
        fail(f"{path}: empty or missing")
        return

    events = {
        name
        for _path, _description, entity in behaviour_ids.values()
        for name in (entity.get("events") or {})
    }
    known = set(behaviour_ids) | particles | fogs | events

    for reference in sorted(set(re.findall(rf"{NAMESPACE}:[a-z_]+", source))):
        if reference not in known:
            fail(f"{path}: references '{reference}', which is not an entity, particle, fog or event")

    # Command functions and the tags they hand to the script must line up.
    function_dir = os.path.join(BP, "functions")
    tags_in_functions = set()
    for function_path in walk(function_dir, ".mcfunction"):
        body = read_text(function_path)
        name = os.path.basename(function_path)
        if name != name.lower():
            fail(f"{function_path}: .mcfunction names must be lowercase")
        for line in body.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            if stripped.startswith("/"):
                fail(f"{function_path}: '{stripped}' - commands in functions must not start with '/'")
            match = re.match(r"tag @s add (\S+)", stripped)
            if match:
                tags_in_functions.add(match.group(1))

    tags_in_script = set(re.findall(r'"(ge_cmd_[a-z_]+)"', source))
    for tag in sorted(tags_in_functions - tags_in_script):
        fail(f"functions add tag '{tag}' but main.js never handles it")
    for tag in sorted(tags_in_script - tags_in_functions):
        fail(f"main.js handles tag '{tag}' but no .mcfunction ever adds it")

    for required in (
        "god_eye_spawn",
        "god_eye_remove",
        "god_eye_mode_normal",
        "god_eye_mode_aggressive",
    ):
        if not os.path.isfile(os.path.join(function_dir, f"{required}.mcfunction")):
            fail(f"missing functions/{required}.mcfunction")

    note(f"functions: {len(list(walk(function_dir, '.mcfunction')))}")

    # mark_variant values the script sets must have matching animation states.
    used_states = {int(v) for v in re.findall(r"setState\([a-zA-Z]+, (\d)\)", source)}
    controller = None
    for controller_path in walk(os.path.join(RP, "animation_controllers"), ".json"):
        doc = documents.get(controller_path) or {}
        controller = (doc.get("animation_controllers") or {}).get("controller.animation.god_eye.state")
        if controller:
            break
    if controller:
        conditions = json.dumps(controller)
        for value in sorted(used_states):
            if value != 0 and f"query.mark_variant == {value}" not in conditions:
                fail(f"main.js sets mark_variant {value} but no animation state reacts to it")


# --------------------------------------------------------------------------
# Packaging
# --------------------------------------------------------------------------

def check_paths():
    for root in (BP, RP):
        for base, dirs, files in os.walk(root):
            for name in dirs + files:
                # Language files are the one place Bedrock demands mixed case:
                # the loader looks for exactly en_US.lang.
                if name != name.lower() and not name.endswith(".lang"):
                    fail(f"{os.path.join(base, name)}: use lowercase paths (Bedrock is case-sensitive)")
                if " " in name:
                    fail(f"{os.path.join(base, name)}: paths must not contain spaces")
                if not name.isascii():
                    fail(f"{os.path.join(base, name)}: paths must be ASCII")


def run_simulation():
    node = shutil.which("node")
    if not node:
        note("node not found - skipped the behaviour simulation")
        return
    result = subprocess.run(
        [node, os.path.join("tools", "sim", "run.mjs")],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        fail("behaviour simulation failed:\n" + (result.stdout or result.stderr))
    else:
        passed = result.stdout.count("  ok   ")
        note(f"behaviour simulation: {passed} checks passed")


def package():
    os.makedirs(DIST, exist_ok=True)
    if os.path.exists(ADDON):
        os.remove(ADDON)

    with zipfile.ZipFile(ADDON, "w", zipfile.ZIP_DEFLATED) as archive:
        for root, folder in ((BP, "god_eye_bp"), (RP, "god_eye_rp")):
            for base, _dirs, files in os.walk(root):
                for name in sorted(files):
                    source = os.path.join(base, name)
                    arcname = os.path.join(folder, os.path.relpath(source, root)).replace(os.sep, "/")
                    archive.write(source, arcname)

    # A .mcaddon is just a zip; make sure the one we produced actually opens
    # and carries both manifests where Minecraft looks for them.
    with zipfile.ZipFile(ADDON) as archive:
        broken = archive.testzip()
        if broken:
            fail(f"{ADDON}: corrupt entry {broken}")
        names = set(archive.namelist())
        for required in ("god_eye_bp/manifest.json", "god_eye_rp/manifest.json"):
            if required not in names:
                fail(f"{ADDON}: missing {required}")
        for name in names:
            if name.startswith("/") or ".." in name:
                fail(f"{ADDON}: unsafe archive path {name}")

    print(f"Packaged {ADDON} ({os.path.getsize(ADDON):,} bytes, {len(names)} files)")


def main():
    documents = {}
    for root in (BP, RP):
        if not os.path.isdir(root):
            fail(f"missing pack directory: {root}")
            continue
        for path in walk(root, ".json"):
            documents[path] = load_json(path)

    bp_manifest = documents.get(os.path.join(BP, "manifest.json"))
    rp_manifest = documents.get(os.path.join(RP, "manifest.json"))

    if bp_manifest and rp_manifest:
        check_manifests(bp_manifest, rp_manifest)
        behaviour_ids, particles, fogs = check_content(documents)
        check_script(behaviour_ids, particles, fogs, documents)
        note(f"entities: {', '.join(sorted(behaviour_ids))}")
        note(f"particles: {len(particles)}")
    else:
        fail("cannot continue without both manifests")

    check_paths()
    run_simulation()

    print(f"Validated {len(documents)} JSON files.")
    for message in notes:
        print(f"  - {message}")

    if errors:
        print("\nBuild failed:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        return 1

    package()
    return 0


if __name__ == "__main__":
    sys.exit(main())
