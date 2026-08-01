#!/usr/bin/env python3
"""Shared validation and packaging for the Bedrock add-ons in this repo.

Every check here exists because the corresponding mistake produces one of the
import errors people actually hit on Android: "Manifest validation failed",
"Missing dependency", "Duplicate UUID", "Unknown pack name", "Function not
found", or an entity that loads as a silent invisible blob.

An add-on describes itself with an `Addon` and calls `run(addon)`.
"""

import json
import os
import re
import struct
import sys
import zipfile

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


class Addon:
    def __init__(
        self,
        name,
        bp,
        rp,
        namespace,
        entity_id,
        client_entity,
        entity_file,
        archive,
        folder_bp,
        folder_rp,
        script_modules,
        other_packs=(),
        required_pngs=(),
        skin=None,
        required_bones=(),
        required_functions=(),
        engine=(1, 21, 0),
    ):
        self.name = name
        self.bp = bp
        self.rp = rp
        self.namespace = namespace
        self.entity_id = entity_id
        self.client_entity = client_entity
        self.entity_file = entity_file
        self.archive = archive
        self.folder_bp = folder_bp
        self.folder_rp = folder_rp
        self.script_modules = dict(script_modules)
        self.other_packs = list(other_packs)
        self.required_pngs = list(required_pngs)
        self.skin = skin
        self.required_bones = set(required_bones)
        self.required_functions = list(required_functions)
        self.engine = list(engine)

        self.errors = []
        self.notes = []
        self.docs = {}

    # -- reporting ----------------------------------------------------------

    def fail(self, message):
        self.errors.append(message)

    def note(self, message):
        self.notes.append(message)


def load_json(addon, path):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except Exception as exc:  # noqa: BLE001 - collect and keep going
        addon.fail(f"{path}: invalid JSON ({exc})")
        return None


def walk(root, suffix):
    if not os.path.isdir(root):
        return
    for base, _dirs, files in os.walk(root):
        for name in sorted(files):
            if name.endswith(suffix):
                yield os.path.join(base, name)


def read_text(path):
    with open(path, encoding="utf-8") as handle:
        return handle.read()


# ---------------------------------------------------------------------------
# Manifests
# ---------------------------------------------------------------------------

def check_manifests(addon):
    bp_manifest = addon.docs.get(os.path.join(addon.bp, "manifest.json"))
    rp_manifest = addon.docs.get(os.path.join(addon.rp, "manifest.json"))
    if not bp_manifest or not rp_manifest:
        addon.fail("one or both manifests are missing or unreadable")
        return

    ours = []
    for label, manifest in (("BP", bp_manifest), ("RP", rp_manifest)):
        header = manifest.get("header", {})
        for field in ("name", "description", "uuid", "version", "min_engine_version"):
            if field not in header:
                addon.fail(f"{label} manifest header is missing '{field}'")

        if manifest.get("format_version") != 2:
            addon.fail(f"{label} manifest must use format_version 2")

        engine = header.get("min_engine_version")
        if engine != addon.engine:
            addon.fail(
                f"{label} min_engine_version is {engine}, expected {addon.engine}"
            )

        if not isinstance(header.get("version"), list) or len(header["version"]) != 3:
            addon.fail(f"{label} manifest version must be a 3-part list")

        ours.append(header.get("uuid"))
        for module in manifest.get("modules", []):
            ours.append(module.get("uuid"))
            if "version" not in module:
                addon.fail(f"{label} manifest module is missing a version")

    for uuid in ours:
        if not (isinstance(uuid, str) and UUID_RE.match(uuid)):
            addon.fail(f"malformed UUID: {uuid!r}")

    duplicates = {u for u in ours if ours.count(u) > 1}
    if duplicates:
        addon.fail(f"duplicate UUIDs inside {addon.name}: {sorted(duplicates)}")

    # Collisions with the other add-ons that ship from this repo.
    for other in addon.other_packs:
        path = os.path.join(other, "manifest.json")
        if not os.path.isfile(path):
            continue
        other_manifest = load_json(addon, path)
        if not other_manifest:
            continue
        theirs = [other_manifest["header"]["uuid"]]
        theirs += [m["uuid"] for m in other_manifest.get("modules", [])]
        clash = set(ours) & set(theirs)
        if clash:
            addon.fail(f"UUID collision with {other}: {sorted(clash)}")

    # The behaviour pack must point at this exact resource pack.
    rp_uuid = rp_manifest["header"]["uuid"]
    deps = bp_manifest.get("dependencies", [])
    pack_deps = [d.get("uuid") for d in deps if "uuid" in d]
    if rp_uuid not in pack_deps:
        addon.fail(f"BP does not declare a dependency on the RP ({rp_uuid})")
    else:
        dep = next(d for d in deps if d.get("uuid") == rp_uuid)
        if dep.get("version") != rp_manifest["header"]["version"]:
            addon.fail(
                f"BP resource-pack dependency version {dep.get('version')} does "
                f"not match the RP version {rp_manifest['header']['version']}"
            )

    script_modules = [m for m in bp_manifest["modules"] if m["type"] == "script"]
    if not script_modules:
        addon.fail("BP has no script module")
    for module in script_modules:
        entry = os.path.join(addon.bp, module["entry"])
        if not os.path.isfile(entry):
            addon.fail(f"script entry not found: {entry}")

    module_deps = {d["module_name"]: d["version"] for d in deps if "module_name" in d}
    for name, want in addon.script_modules.items():
        if name not in module_deps:
            addon.fail(f"BP is missing the '{name}' module dependency")
        elif module_deps[name] != want:
            addon.fail(
                f"BP depends on {name} {module_deps[name]}; {want} is the stable "
                f"version for Bedrock {'.'.join(str(p) for p in addon.engine)}"
            )


# ---------------------------------------------------------------------------
# Images
# ---------------------------------------------------------------------------

def check_pngs(addon):
    required = [
        os.path.join(addon.bp, "pack_icon.png"),
        os.path.join(addon.rp, "pack_icon.png"),
    ] + list(addon.required_pngs)

    for path in required:
        if not os.path.isfile(path):
            addon.fail(f"missing required image: {path}")
            continue
        with open(path, "rb") as handle:
            blob = handle.read()
        if not blob.startswith(b"\x89PNG\r\n\x1a\n"):
            addon.fail(f"{path}: not a PNG")
            continue
        width, height = struct.unpack(">II", blob[16:24])
        if addon.skin and path == addon.skin[0] and (width, height) != addon.skin[1]:
            addon.fail(f"{path}: skin must be {addon.skin[1]}, got {(width, height)}")


# ---------------------------------------------------------------------------
# Behaviour pack entity
# ---------------------------------------------------------------------------

def check_entity(addon):
    path = os.path.join(addon.bp, "entities", addon.entity_file)
    doc = addon.docs.get(path)
    if not doc:
        addon.fail(f"missing {path}")
        return set()

    entity = doc.get("minecraft:entity", {})
    description = entity.get("description", {})
    if description.get("identifier") != addon.entity_id:
        addon.fail(f"{path}: identifier must be {addon.entity_id}")
    if not description.get("is_spawnable"):
        addon.fail(f"{path}: is_spawnable must be true or there will be no spawn egg")
    if not description.get("is_summonable"):
        addon.fail(f"{path}: is_summonable must be true for /summon")

    groups = set(entity.get("component_groups", {}))
    events = entity.get("events", {})

    for name, event in events.items():
        for action in ("add", "remove"):
            for group in event.get(action, {}).get("component_groups", []):
                if group not in groups:
                    addon.fail(f"{path}: event '{name}' {action}s unknown group '{group}'")

    components = entity.get("components", {})
    referenced = []
    tame = components.get("minecraft:tameable", {}).get("tame_event", {})
    if tame.get("event"):
        referenced.append(tame["event"])
    for interaction in components.get("minecraft:interact", {}).get("interactions", []):
        event_name = interaction.get("on_interact", {}).get("event")
        if event_name:
            referenced.append(event_name)
    for group in entity.get("component_groups", {}).values():
        timer = group.get("minecraft:timer", {}).get("time_down_event", {})
        if timer.get("event"):
            referenced.append(timer["event"])
    for name in referenced:
        if name not in events:
            addon.fail(f"{path}: component references undefined event '{name}'")

    for component, field in (("minecraft:loot", "table"), ("minecraft:equipment", "table")):
        table = components.get(component, {}).get(field)
        if table and not os.path.isfile(os.path.join(addon.bp, table)):
            addon.fail(f"{path}: {component} points at missing {table}")

    return set(events)


# ---------------------------------------------------------------------------
# Functions and script events must line up in both directions
# ---------------------------------------------------------------------------

def check_functions_and_events(addon, entity_events):
    ns = addon.namespace
    script_path = os.path.join(addon.bp, "scripts", "main.js")
    if not os.path.isfile(script_path):
        addon.fail(f"missing {script_path}")
        return
    script = read_text(script_path)

    handled = set(re.findall(rf'"({ns}:[a-z_]+)":', script))
    handled |= set(re.findall(rf'event\.id === "({ns}:[a-z_]+)"', script))

    fired = set()
    functions_dir = os.path.join(addon.bp, "functions")
    if not os.path.isdir(functions_dir):
        addon.fail("missing BP functions directory")
        return

    for path in walk(functions_dir, ".mcfunction"):
        for line in read_text(path).splitlines():
            line = line.strip()
            if line.startswith("#") or not line:
                continue
            match = re.match(rf"^scriptevent\s+({ns}:[a-z_]+)", line)
            if match:
                fired.add(match.group(1))
            elif not line.startswith("scriptevent"):
                addon.fail(f"{path}: unexpected command {line!r}")

    for required in addon.required_functions:
        if not os.path.isfile(os.path.join(functions_dir, required + ".mcfunction")):
            addon.fail(f"missing functions/{required}.mcfunction (/function {required})")

    entity_doc = addon.docs.get(os.path.join(addon.bp, "entities", addon.entity_file))
    if entity_doc:
        blob = json.dumps(entity_doc)
        fired |= set(re.findall(rf"scriptevent ({ns}:[a-z_]+)", blob))

        script_tags = set(re.findall(rf'hasTag\("({ns}_[a-z_]+)"\)', script))
        entity_tags = set(re.findall(rf"tag @s add ({ns}_[a-z_]+)", blob))
        missing = script_tags - entity_tags
        if missing:
            addon.fail(f"script reads tags never set by the entity: {sorted(missing)}")

    unhandled = fired - handled
    if unhandled:
        addon.fail(f"script events fired but not handled in main.js: {sorted(unhandled)}")

    triggered = set(re.findall(rf'triggerEvent\("({ns}:[a-z_]+)"\)', script))
    # Events built from a template string, e.g. "ns:pose_" + name + "_event".
    for prefix, _var in re.findall(rf'triggerEvent\("({ns}:\w+_)" \+ \w+ \+ "(_event)"\)', script):
        for group in entity_events:
            if group.startswith(prefix):
                triggered.add(group)

    missing_events = triggered - entity_events
    if missing_events:
        addon.fail(f"main.js triggers entity events that do not exist: {sorted(missing_events)}")

    addon.note(
        f"{len(fired)} script events, {len(list(walk(functions_dir, '.mcfunction')))} functions"
    )


# ---------------------------------------------------------------------------
# Items, recipes, icons
# ---------------------------------------------------------------------------

def check_items(addon):
    atlas_path = os.path.join(addon.rp, "textures", "item_texture.json")
    atlas = addon.docs.get(atlas_path)
    if not atlas:
        addon.fail(f"missing {atlas_path}")
        return []
    texture_data = atlas.get("texture_data", {})

    identifiers = []
    for path, doc in addon.docs.items():
        if not path.startswith(os.path.join(addon.bp, "items")) or doc is None:
            continue
        item = doc.get("minecraft:item", {})
        identifier = item.get("description", {}).get("identifier")
        identifiers.append(identifier)
        components = item.get("components", {})

        icon = components.get("minecraft:icon")
        # At format_version 1.20.60+ the flat "texture" string is ignored by the
        # game and the item renders with a blank icon.
        if isinstance(icon, dict) and "texture" in icon:
            addon.fail(f"{path}: minecraft:icon must use {{'textures': {{'default': ...}}}}")
            continue
        key = icon.get("textures", {}).get("default") if isinstance(icon, dict) else icon
        if not key:
            addon.fail(f"{path}: no minecraft:icon texture")
            continue
        if key not in texture_data:
            addon.fail(f"{path}: icon '{key}' is not in item_texture.json")
            continue
        png = os.path.join(addon.rp, texture_data[key]["textures"] + ".png")
        if not os.path.isfile(png):
            addon.fail(f"{path}: icon '{key}' points at missing {png}")

        if "minecraft:display_name" not in components:
            addon.fail(f"{path}: no minecraft:display_name")

    client = addon.docs.get(os.path.join(addon.rp, "entity", addon.client_entity))
    if client:
        egg = client["minecraft:client_entity"]["description"].get("spawn_egg", {})
        egg_texture = egg.get("texture")
        if not egg_texture:
            addon.fail("client entity has no spawn_egg texture")
        elif egg_texture not in texture_data:
            addon.fail(f"spawn egg texture '{egg_texture}' is not in item_texture.json")

    for path, doc in addon.docs.items():
        if not path.startswith(os.path.join(addon.bp, "recipes")) or doc is None:
            continue
        recipe = doc.get("minecraft:recipe_shaped") or doc.get("minecraft:recipe_shapeless") or {}
        result = recipe.get("result", {})
        result_item = result.get("item") if isinstance(result, dict) else result
        prefix = addon.namespace + ":"
        if result_item and result_item.startswith(prefix) and result_item not in identifiers:
            addon.fail(f"{path}: result '{result_item}' has no item definition")

    return identifiers


# ---------------------------------------------------------------------------
# Resource pack wiring: client entity -> geometry / animations / controllers
# ---------------------------------------------------------------------------

def check_resource_pack(addon):
    client_path = os.path.join(addon.rp, "entity", addon.client_entity)
    client = addon.docs.get(client_path)
    if not client:
        addon.fail(f"missing {client_path}")
        return
    description = client["minecraft:client_entity"]["description"]

    if description.get("identifier") != addon.entity_id:
        addon.fail(f"{client_path}: identifier must match the BP entity ({addon.entity_id})")

    for name, rel in description.get("textures", {}).items():
        if not os.path.isfile(os.path.join(addon.rp, rel + ".png")):
            addon.fail(f"{client_path}: texture '{name}' -> missing {rel}.png")

    geometries = set()
    bones = set()
    for path in walk(os.path.join(addon.rp, "models"), ".json"):
        doc = addon.docs.get(path)
        if not doc:
            continue
        for geo in doc.get("minecraft:geometry", []):
            geometries.add(geo.get("description", {}).get("identifier"))
            names = {b["name"] for b in geo.get("bones", [])}
            bones |= names
            for needed in addon.required_bones:
                if needed not in names:
                    addon.fail(f"{path}: geometry has no '{needed}' bone")

    for name, geo_id in description.get("geometry", {}).items():
        if geo_id not in geometries:
            addon.fail(f"{client_path}: geometry '{name}' -> unknown {geo_id}")

    animations = set()
    for path in walk(os.path.join(addon.rp, "animations"), ".json"):
        doc = addon.docs.get(path)
        if doc:
            animations |= set(doc.get("animations", {}))
            for anim_name, anim in doc.get("animations", {}).items():
                for bone in anim.get("bones", {}):
                    if bone not in bones:
                        addon.fail(f"{path}: animation '{anim_name}' moves unknown bone '{bone}'")

    controllers = set()
    for path in walk(os.path.join(addon.rp, "animation_controllers"), ".json"):
        doc = addon.docs.get(path)
        if doc:
            controllers |= set(doc.get("animation_controllers", {}))

    declared = description.get("animations", {})
    for short_name, target in declared.items():
        if target.startswith("controller."):
            if target not in controllers:
                addon.fail(f"{client_path}: animation '{short_name}' -> unknown controller {target}")
        elif target not in animations:
            addon.fail(f"{client_path}: animation '{short_name}' -> unknown animation {target}")

    for entry in description.get("scripts", {}).get("animate", []):
        name = entry if isinstance(entry, str) else list(entry)[0]
        if name not in declared:
            addon.fail(f"{client_path}: animate list plays undeclared '{name}'")

    for path in walk(os.path.join(addon.rp, "animation_controllers"), ".json"):
        doc = addon.docs.get(path)
        if not doc:
            continue
        for controller_name, controller in doc.get("animation_controllers", {}).items():
            states = controller.get("states", {})
            initial = controller.get("initial_state")
            if initial and initial not in states:
                addon.fail(f"{path}: {controller_name} initial_state '{initial}' is not a state")
            for state_name, state in states.items():
                for anim in state.get("animations", []):
                    k = anim if isinstance(anim, str) else list(anim)[0]
                    if k not in declared:
                        addon.fail(
                            f"{path}: {controller_name}.{state_name} plays '{k}', which the "
                            f"client entity does not declare"
                        )
                for transition in state.get("transitions", []):
                    for target in transition:
                        if target not in states:
                            addon.fail(
                                f"{path}: {controller_name}.{state_name} transitions to "
                                f"unknown state '{target}'"
                            )

    render_controllers = set()
    for path in walk(os.path.join(addon.rp, "render_controllers"), ".json"):
        doc = addon.docs.get(path)
        if doc:
            render_controllers |= set(doc.get("render_controllers", {}))
    for name in description.get("render_controllers", []):
        k = name if isinstance(name, str) else list(name)[0]
        if k not in render_controllers:
            addon.fail(f"{client_path}: unknown render controller '{k}'")


# ---------------------------------------------------------------------------
# Language files
# ---------------------------------------------------------------------------

def check_language(addon, identifiers):
    for root in (addon.bp, addon.rp):
        langs = os.path.join(root, "texts", "languages.json")
        if not os.path.isfile(langs):
            addon.fail(f"missing {langs}")
            continue
        for code in load_json(addon, langs) or []:
            path = os.path.join(root, "texts", f"{code}.lang")
            if not os.path.isfile(path):
                addon.fail(f"{langs} lists '{code}' but {path} does not exist")

    lang_path = os.path.join(addon.rp, "texts", "en_US.lang")
    if not os.path.isfile(lang_path):
        addon.fail(f"missing {lang_path}")
        return
    lang = read_text(lang_path)

    for key in (
        f"entity.{addon.entity_id}.name=",
        f"item.spawn_egg.entity.{addon.entity_id}.name=",
    ):
        if key not in lang:
            addon.fail(f"{lang_path}: missing '{key}'")

    for identifier in identifiers:
        if identifier and f"item.{identifier}=" not in lang:
            addon.fail(f"{lang_path}: no name entry for {identifier}")

    entity_doc = addon.docs.get(os.path.join(addon.bp, "entities", addon.entity_file))
    if entity_doc:
        for text in re.findall(r'"interact_text": "([^"]+)"', json.dumps(entity_doc)):
            if f"{text}=" not in lang:
                addon.fail(f"{lang_path}: missing interact text '{text}'")

    for root in (addon.bp, addon.rp):
        path = os.path.join(root, "texts", "en_US.lang")
        if os.path.isfile(path) and "pack.name=" not in read_text(path):
            addon.fail(f"{path}: missing pack.name (shows as 'Unknown pack name')")


# ---------------------------------------------------------------------------
# Packaging
# ---------------------------------------------------------------------------

def package(addon):
    dist = os.path.dirname(addon.archive)
    os.makedirs(dist, exist_ok=True)
    if os.path.exists(addon.archive):
        os.remove(addon.archive)

    # Deflate only, no directory entries and no extra top-level files: this is
    # the shape the Android importer is happiest with.
    with zipfile.ZipFile(addon.archive, "w", zipfile.ZIP_DEFLATED) as archive:
        for root, folder in ((addon.bp, addon.folder_bp), (addon.rp, addon.folder_rp)):
            for base, _dirs, files in os.walk(root):
                for name in sorted(files):
                    if name.startswith(".") or name == "Thumbs.db":
                        continue
                    source = os.path.join(base, name)
                    arcname = os.path.join(
                        folder, os.path.relpath(source, root)
                    ).replace(os.sep, "/")
                    archive.write(source, arcname)

    # Re-open and verify: a corrupt archive is the "Not a valid ZIP" error.
    with zipfile.ZipFile(addon.archive) as archive:
        bad = archive.testzip()
        if bad:
            addon.fail(f"archive is corrupt at {bad}")
            return
        names = archive.namelist()
        for required in (
            f"{addon.folder_bp}/manifest.json",
            f"{addon.folder_rp}/manifest.json",
            f"{addon.folder_bp}/pack_icon.png",
            f"{addon.folder_rp}/pack_icon.png",
            f"{addon.folder_bp}/scripts/main.js",
        ):
            if required not in names:
                addon.fail(f"archive is missing {required}")
        for name in names:
            if name.startswith("/") or ".." in name:
                addon.fail(f"unsafe archive path: {name}")
            if "__MACOSX" in name or name.endswith(".DS_Store"):
                addon.fail(f"junk file in archive: {name}")
        for manifest in (f"{addon.folder_bp}/manifest.json", f"{addon.folder_rp}/manifest.json"):
            try:
                json.loads(archive.read(manifest))
            except Exception as exc:  # noqa: BLE001
                addon.fail(f"{manifest} inside the archive is unreadable ({exc})")

    size = os.path.getsize(addon.archive)
    print(f"Packaged {addon.archive} ({size:,} bytes, {len(names)} entries)")


# ---------------------------------------------------------------------------

def run(addon, extra_checks=()):
    for root in (addon.bp, addon.rp):
        if not os.path.isdir(root):
            addon.fail(f"missing pack directory: {root}")
            continue
        for path in walk(root, ".json"):
            addon.docs[path] = load_json(addon, path)

    if not addon.errors:
        check_manifests(addon)
        check_pngs(addon)
        entity_events = check_entity(addon)
        check_functions_and_events(addon, entity_events)
        identifiers = check_items(addon)
        check_resource_pack(addon)
        check_language(addon, identifiers)
        for extra in extra_checks:
            extra(addon)
        addon.note(f"{len(addon.docs)} JSON files, {len(identifiers)} custom items")

    for note in addon.notes:
        print(f"  {note}")
    if addon.errors:
        print(f"\n{addon.name} build failed:", file=sys.stderr)
        for error in addon.errors:
            print(f"  - {error}", file=sys.stderr)
        return 1

    package(addon)
    if addon.errors:
        print("\nPackaging failed:", file=sys.stderr)
        for error in addon.errors:
            print(f"  - {error}", file=sys.stderr)
        return 1

    print(f"{addon.name} validated and packaged.")
    return 0
