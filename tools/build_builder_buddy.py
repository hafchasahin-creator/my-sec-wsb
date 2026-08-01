#!/usr/bin/env python3
"""Validate and package the Builder Buddy add-on.

Every check here exists because the corresponding mistake produces one of the
import errors people actually hit on Android: "Manifest validation failed",
"Missing dependency", "Duplicate UUID", "Unknown pack name", "Function not
found", or an entity that loads as a silent invisible blob.

The packaging step writes dist/Builder_Buddy.mcaddon with the two pack folders
at the archive root, then re-opens the archive and verifies it.

Usage:  python3 tools/build_builder_buddy.py
"""

import json
import os
import re
import struct
import sys
import zipfile

BP = os.path.join("behavior_packs", "Builder_Buddy_BP")
RP = os.path.join("resource_packs", "Builder_Buddy_RP")
DIST = "dist"
ADDON = os.path.join(DIST, "Builder_Buddy.mcaddon")

# Other packs in this repo - their UUIDs must not collide with ours.
OTHER_PACKS = [
    os.path.join("behavior_packs", "arcane_arsenal_bp"),
    os.path.join("resource_packs", "arcane_arsenal_rp"),
]

ENTITY_ID = "bb:builder_buddy"
ITEM_ID = "bb:house_builder_remote"

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


def read_text(path):
    with open(path, encoding="utf-8") as handle:
        return handle.read()


# ---------------------------------------------------------------------------
# Manifests
# ---------------------------------------------------------------------------

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def check_manifests(docs):
    bp_manifest = docs.get(os.path.join(BP, "manifest.json"))
    rp_manifest = docs.get(os.path.join(RP, "manifest.json"))
    if not bp_manifest or not rp_manifest:
        fail("one or both manifests are missing or unreadable")
        return None, None

    ours = []
    for label, manifest in (("BP", bp_manifest), ("RP", rp_manifest)):
        header = manifest.get("header", {})
        for field in ("name", "description", "uuid", "version", "min_engine_version"):
            if field not in header:
                fail(f"{label} manifest header is missing '{field}'")

        if manifest.get("format_version") != 2:
            fail(f"{label} manifest must use format_version 2")

        engine = header.get("min_engine_version")
        if engine != [1, 21, 0]:
            fail(
                f"{label} min_engine_version is {engine}, expected [1, 21, 0] "
                f"for Bedrock 1.21.0"
            )

        if not isinstance(header.get("version"), list) or len(header["version"]) != 3:
            fail(f"{label} manifest version must be a 3-part list")

        ours.append(header.get("uuid"))
        for module in manifest.get("modules", []):
            ours.append(module.get("uuid"))
            if "version" not in module:
                fail(f"{label} manifest module is missing a version")

    for uuid in ours:
        if not (isinstance(uuid, str) and UUID_RE.match(uuid)):
            fail(f"malformed UUID: {uuid!r}")

    duplicates = {u for u in ours if ours.count(u) > 1}
    if duplicates:
        fail(f"duplicate UUIDs inside Builder Buddy: {sorted(duplicates)}")

    # Collisions with the other add-on that ships from this repo.
    for other in OTHER_PACKS:
        path = os.path.join(other, "manifest.json")
        if not os.path.isfile(path):
            continue
        other_manifest = load_json(path)
        if not other_manifest:
            continue
        theirs = [other_manifest["header"]["uuid"]]
        theirs += [m["uuid"] for m in other_manifest.get("modules", [])]
        clash = set(ours) & set(theirs)
        if clash:
            fail(f"UUID collision with {other}: {sorted(clash)}")

    # The behaviour pack must point at this exact resource pack.
    rp_uuid = rp_manifest["header"]["uuid"]
    deps = bp_manifest.get("dependencies", [])
    pack_deps = [d.get("uuid") for d in deps if "uuid" in d]
    if rp_uuid not in pack_deps:
        fail(f"BP does not declare a dependency on the RP ({rp_uuid})")
    else:
        dep = next(d for d in deps if d.get("uuid") == rp_uuid)
        if dep.get("version") != rp_manifest["header"]["version"]:
            fail(
                "BP resource-pack dependency version "
                f"{dep.get('version')} does not match the RP version "
                f"{rp_manifest['header']['version']}"
            )

    # Script modules.
    script_modules = [m for m in bp_manifest["modules"] if m["type"] == "script"]
    if not script_modules:
        fail("BP has no script module")
    for module in script_modules:
        entry = os.path.join(BP, module["entry"])
        if not os.path.isfile(entry):
            fail(f"script entry not found: {entry}")

    module_deps = {d["module_name"]: d["version"] for d in deps if "module_name" in d}
    for name, want in (("@minecraft/server", "1.11.0"), ("@minecraft/server-ui", "1.2.0")):
        if name not in module_deps:
            fail(f"BP is missing the '{name}' module dependency")
        elif module_deps[name] != want:
            fail(
                f"BP depends on {name} {module_deps[name]}; {want} is the stable "
                f"version for Bedrock 1.21.0"
            )

    return bp_manifest, rp_manifest


# ---------------------------------------------------------------------------
# PNG sanity - a truncated or mislabelled icon breaks the import silently
# ---------------------------------------------------------------------------

def check_pngs():
    required = [
        os.path.join(BP, "pack_icon.png"),
        os.path.join(RP, "pack_icon.png"),
        os.path.join(RP, "textures", "entity", "builder_buddy.png"),
        os.path.join(RP, "textures", "items", "bb_house_builder_remote.png"),
        os.path.join(RP, "textures", "items", "bb_builder_buddy_spawn_egg.png"),
    ]
    sizes = {}
    for path in required:
        if not os.path.isfile(path):
            fail(f"missing required image: {path}")
            continue
        with open(path, "rb") as handle:
            blob = handle.read()
        if not blob.startswith(b"\x89PNG\r\n\x1a\n"):
            fail(f"{path}: not a PNG")
            continue
        width, height = struct.unpack(">II", blob[16:24])
        sizes[path] = (width, height)

    skin = os.path.join(RP, "textures", "entity", "builder_buddy.png")
    if sizes.get(skin) not in (None, (64, 64)):
        fail(f"{skin}: skin must be 64x64, got {sizes[skin]}")
    return sizes


# ---------------------------------------------------------------------------
# Behaviour pack entity
# ---------------------------------------------------------------------------

def check_entity(docs):
    path = os.path.join(BP, "entities", "builder_buddy.json")
    doc = docs.get(path)
    if not doc:
        fail(f"missing {path}")
        return set()

    entity = doc.get("minecraft:entity", {})
    description = entity.get("description", {})
    if description.get("identifier") != ENTITY_ID:
        fail(f"{path}: identifier must be {ENTITY_ID}")
    if not description.get("is_spawnable"):
        fail(f"{path}: is_spawnable must be true or there will be no spawn egg")
    if not description.get("is_summonable"):
        fail(f"{path}: is_summonable must be true for /summon and re-summoning")

    groups = set(entity.get("component_groups", {}))
    events = entity.get("events", {})

    # Every component group an event touches has to exist.
    for name, event in events.items():
        for action in ("add", "remove"):
            for group in event.get(action, {}).get("component_groups", []):
                if group not in groups:
                    fail(f"{path}: event '{name}' {action}s unknown group '{group}'")

    # Every event referenced by an interact/tame component has to exist.
    components = entity.get("components", {})
    referenced = []
    tame = components.get("minecraft:tameable", {}).get("tame_event", {})
    if tame.get("event"):
        referenced.append(tame["event"])
    for interaction in components.get("minecraft:interact", {}).get("interactions", []):
        event_name = interaction.get("on_interact", {}).get("event")
        if event_name:
            referenced.append(event_name)
    for name in referenced:
        if name not in events:
            fail(f"{path}: interact/tame references undefined event '{name}'")

    # Loot tables named by components must be on disk.
    for component, field in (("minecraft:loot", "table"), ("minecraft:equipment", "table")):
        table = components.get(component, {}).get(field)
        if table and not os.path.isfile(os.path.join(BP, table)):
            fail(f"{path}: {component} points at missing {table}")

    # The buddy must never be able to target friendlies.
    forbidden = ("player", "villager", "wolf", "cat", "animal", "iron_golem")
    melee = json.dumps(components.get("minecraft:behavior.melee_attack", {}))
    for family in forbidden:
        if f'"value": "{family}"' in melee and '"!="' not in melee:
            fail(f"{path}: melee_attack may target '{family}'")

    return set(events)


# ---------------------------------------------------------------------------
# Functions and script events must line up in both directions
# ---------------------------------------------------------------------------

def check_functions_and_events(entity_events):
    script_path = os.path.join(BP, "scripts", "main.js")
    if not os.path.isfile(script_path):
        fail(f"missing {script_path}")
        return
    script = read_text(script_path)

    handled = set(re.findall(r'"(bb:[a-z_]+)":', script))
    handled |= set(re.findall(r'event\.id === "(bb:[a-z_]+)"', script))

    fired = set()
    functions_dir = os.path.join(BP, "functions")
    if not os.path.isdir(functions_dir):
        fail("missing BP functions directory")
        return

    for path in walk(functions_dir, ".mcfunction"):
        for line in read_text(path).splitlines():
            line = line.strip()
            if line.startswith("#") or not line:
                continue
            match = re.match(r"^scriptevent\s+(bb:[a-z_]+)", line)
            if match:
                fired.add(match.group(1))
            elif not line.startswith("scriptevent"):
                fail(f"{path}: unexpected command {line!r}")

    # The brief names this one explicitly.
    required_function = os.path.join(functions_dir, "builder_buddy_house.mcfunction")
    if not os.path.isfile(required_function):
        fail("missing functions/builder_buddy_house.mcfunction (/function builder_buddy_house)")

    # Script events fired from the entity's queue_command blocks.
    entity_doc = load_json(os.path.join(BP, "entities", "builder_buddy.json"))
    if entity_doc:
        blob = json.dumps(entity_doc)
        fired |= set(re.findall(r"scriptevent (bb:[a-z_]+)", blob))

        # queue_command tag lines must match the tags the script reads.
        script_tags = set(re.findall(r'hasTag\("(bb_[a-z_]+)"\)', script))
        entity_tags = set(re.findall(r"tag @s add (bb_[a-z_]+)", blob))
        missing = script_tags - entity_tags
        if missing:
            fail(f"script reads tags never set by the entity: {sorted(missing)}")

    unhandled = fired - handled
    if unhandled:
        fail(f"script events fired but not handled in main.js: {sorted(unhandled)}")

    # Entity events the script triggers must exist on the entity.
    triggered = set(re.findall(r'triggerEvent\("(bb:[a-z_]+)"\)', script))
    for template in re.findall(r'triggerEvent\("bb:(\w+)_" \+ (\w+) \+ "_event"\)', script):
        pass  # handled below by expanding the known modes and poses
    for mode in ("follow", "stay", "build"):
        triggered.add(f"bb:mode_{mode}_event")
    for pose in ("normal", "attack", "build", "celebrate"):
        triggered.add(f"bb:pose_{pose}_event")

    missing_events = triggered - entity_events
    if missing_events:
        fail(f"main.js triggers entity events that do not exist: {sorted(missing_events)}")

    notes.append(f"{len(fired)} script events, {len(list(walk(functions_dir, '.mcfunction')))} functions")


# ---------------------------------------------------------------------------
# Items, recipes, icons
# ---------------------------------------------------------------------------

def check_items(docs):
    atlas_path = os.path.join(RP, "textures", "item_texture.json")
    atlas = docs.get(atlas_path)
    if not atlas:
        fail(f"missing {atlas_path}")
        return []
    texture_data = atlas.get("texture_data", {})

    identifiers = []
    for path, doc in docs.items():
        if not path.startswith(os.path.join(BP, "items")) or doc is None:
            continue
        item = doc.get("minecraft:item", {})
        identifier = item.get("description", {}).get("identifier")
        identifiers.append(identifier)
        components = item.get("components", {})

        icon = components.get("minecraft:icon")
        # At format_version 1.20.60+ the flat "texture" string is ignored by the
        # game and the item renders with a blank icon.
        if isinstance(icon, dict) and "texture" in icon:
            fail(f"{path}: minecraft:icon must use {{'textures': {{'default': ...}}}}")
            continue
        key = icon.get("textures", {}).get("default") if isinstance(icon, dict) else icon
        if not key:
            fail(f"{path}: no minecraft:icon texture")
            continue
        if key not in texture_data:
            fail(f"{path}: icon '{key}' is not in item_texture.json")
            continue
        png = os.path.join(RP, texture_data[key]["textures"] + ".png")
        if not os.path.isfile(png):
            fail(f"{path}: icon '{key}' points at missing {png}")

        if "minecraft:display_name" not in components:
            fail(f"{path}: no minecraft:display_name")

    # The spawn egg icon has to be in the atlas too.
    client = docs.get(os.path.join(RP, "entity", "builder_buddy.entity.json"))
    if client:
        egg = client["minecraft:client_entity"]["description"].get("spawn_egg", {})
        egg_texture = egg.get("texture")
        if not egg_texture:
            fail("client entity has no spawn_egg texture")
        elif egg_texture not in texture_data:
            fail(f"spawn egg texture '{egg_texture}' is not in item_texture.json")

    # Recipes must produce items that exist.
    for path, doc in docs.items():
        if not path.startswith(os.path.join(BP, "recipes")) or doc is None:
            continue
        recipe = doc.get("minecraft:recipe_shaped") or doc.get("minecraft:recipe_shapeless") or {}
        result = recipe.get("result", {})
        result_item = result.get("item") if isinstance(result, dict) else result
        if result_item and result_item.startswith("bb:") and result_item not in identifiers:
            fail(f"{path}: result '{result_item}' has no item definition")

    return identifiers


# ---------------------------------------------------------------------------
# Resource pack wiring: client entity -> geometry / animations / controllers
# ---------------------------------------------------------------------------

def check_resource_pack(docs):
    client_path = os.path.join(RP, "entity", "builder_buddy.entity.json")
    client = docs.get(client_path)
    if not client:
        fail(f"missing {client_path}")
        return
    description = client["minecraft:client_entity"]["description"]

    if description.get("identifier") != ENTITY_ID:
        fail(f"{client_path}: identifier must match the BP entity ({ENTITY_ID})")

    # Textures.
    for name, rel in description.get("textures", {}).items():
        if not os.path.isfile(os.path.join(RP, rel + ".png")):
            fail(f"{client_path}: texture '{name}' -> missing {rel}.png")

    # Geometry.
    geometries = set()
    bones = set()
    for path in walk(os.path.join(RP, "models"), ".json"):
        doc = docs.get(path)
        if not doc:
            continue
        for geo in doc.get("minecraft:geometry", []):
            identifier = geo.get("description", {}).get("identifier")
            geometries.add(identifier)
            for bone in geo.get("bones", []):
                bones.add(bone["name"])
            # Held items attach to a bone named rightItem.
            if "rightItem" not in {b["name"] for b in geo.get("bones", [])}:
                fail(f"{path}: geometry has no 'rightItem' bone, the sword will not render")

    for name, geo_id in description.get("geometry", {}).items():
        if geo_id not in geometries:
            fail(f"{client_path}: geometry '{name}' -> unknown {geo_id}")

    # Animations and animation controllers.
    animations = set()
    for path in walk(os.path.join(RP, "animations"), ".json"):
        doc = docs.get(path)
        if doc:
            animations |= set(doc.get("animations", {}))
            # Bone names used by the animation must exist in the geometry.
            for anim_name, anim in doc.get("animations", {}).items():
                for bone in anim.get("bones", {}):
                    if bone not in bones:
                        fail(f"{path}: animation '{anim_name}' moves unknown bone '{bone}'")

    controllers = set()
    for path in walk(os.path.join(RP, "animation_controllers"), ".json"):
        doc = docs.get(path)
        if doc:
            controllers |= set(doc.get("animation_controllers", {}))

    declared = description.get("animations", {})
    for short_name, target in declared.items():
        if target.startswith("controller."):
            if target not in controllers:
                fail(f"{client_path}: animation '{short_name}' -> unknown controller {target}")
        elif target not in animations:
            fail(f"{client_path}: animation '{short_name}' -> unknown animation {target}")

    # Everything the animate list plays must be declared above.
    for entry in description.get("scripts", {}).get("animate", []):
        name = entry if isinstance(entry, str) else list(entry)[0]
        if name not in declared:
            fail(f"{client_path}: animate list plays undeclared '{name}'")

    # Controller states may only play animations the client entity declares.
    for path in walk(os.path.join(RP, "animation_controllers"), ".json"):
        doc = docs.get(path)
        if not doc:
            continue
        for controller_name, controller in doc.get("animation_controllers", {}).items():
            states = controller.get("states", {})
            initial = controller.get("initial_state")
            if initial and initial not in states:
                fail(f"{path}: {controller_name} initial_state '{initial}' is not a state")
            for state_name, state in states.items():
                for anim in state.get("animations", []):
                    key = anim if isinstance(anim, str) else list(anim)[0]
                    if key not in declared:
                        fail(
                            f"{path}: {controller_name}.{state_name} plays '{key}', "
                            f"which the client entity does not declare"
                        )
                for transition in state.get("transitions", []):
                    for target in transition:
                        if target not in states:
                            fail(
                                f"{path}: {controller_name}.{state_name} transitions to "
                                f"unknown state '{target}'"
                            )

    # Render controllers.
    render_controllers = set()
    for path in walk(os.path.join(RP, "render_controllers"), ".json"):
        doc = docs.get(path)
        if doc:
            render_controllers |= set(doc.get("render_controllers", {}))
    for name in description.get("render_controllers", []):
        key = name if isinstance(name, str) else list(name)[0]
        if key not in render_controllers:
            fail(f"{client_path}: unknown render controller '{key}'")


# ---------------------------------------------------------------------------
# Language files
# ---------------------------------------------------------------------------

def check_language(identifiers):
    for root in (BP, RP):
        langs = os.path.join(root, "texts", "languages.json")
        if not os.path.isfile(langs):
            fail(f"missing {langs}")
            continue
        listed = load_json(langs) or []
        for code in listed:
            path = os.path.join(root, "texts", f"{code}.lang")
            if not os.path.isfile(path):
                fail(f"{langs} lists '{code}' but {path} does not exist")

    lang_path = os.path.join(RP, "texts", "en_US.lang")
    if not os.path.isfile(lang_path):
        fail(f"missing {lang_path}")
        return
    lang = read_text(lang_path)

    required = [
        f"entity.{ENTITY_ID}.name=",
        f"item.spawn_egg.entity.{ENTITY_ID}.name=",
        f"item.{ITEM_ID}=",
    ]
    for key in required:
        if key not in lang:
            fail(f"{lang_path}: missing '{key}'")

    for identifier in identifiers:
        if identifier and f"item.{identifier}=" not in lang:
            fail(f"{lang_path}: no name entry for {identifier}")

    # Interact prompts referenced by the entity need translations.
    entity_doc = load_json(os.path.join(BP, "entities", "builder_buddy.json"))
    if entity_doc:
        for text in re.findall(r'"interact_text": "([^"]+)"', json.dumps(entity_doc)):
            if f"{text}=" not in lang:
                fail(f"{lang_path}: missing interact text '{text}'")

    for root in (BP, RP):
        path = os.path.join(root, "texts", "en_US.lang")
        if os.path.isfile(path):
            body = read_text(path)
            if "pack.name=" not in body:
                fail(f"{path}: missing pack.name (shows as 'Unknown pack name')")


# ---------------------------------------------------------------------------

def validate():
    docs = {}
    for root in (BP, RP):
        if not os.path.isdir(root):
            fail(f"missing pack directory: {root}")
            continue
        for path in walk(root, ".json"):
            docs[path] = load_json(path)

    if errors:
        return

    check_manifests(docs)
    check_pngs()
    entity_events = check_entity(docs)
    check_functions_and_events(entity_events)
    identifiers = check_items(docs)
    check_resource_pack(docs)
    check_language(identifiers)

    notes.append(f"{len(docs)} JSON files, {len(identifiers)} custom items")


def package():
    os.makedirs(DIST, exist_ok=True)
    if os.path.exists(ADDON):
        os.remove(ADDON)

    # Deflate only, no directory entries and no extra top-level files: this is
    # the shape the Android importer is happiest with.
    with zipfile.ZipFile(ADDON, "w", zipfile.ZIP_DEFLATED) as archive:
        for root, folder in ((BP, "Builder_Buddy_BP"), (RP, "Builder_Buddy_RP")):
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
    with zipfile.ZipFile(ADDON) as archive:
        bad = archive.testzip()
        if bad:
            fail(f"archive is corrupt at {bad}")
            return
        names = archive.namelist()
        for required in (
            "Builder_Buddy_BP/manifest.json",
            "Builder_Buddy_RP/manifest.json",
            "Builder_Buddy_BP/pack_icon.png",
            "Builder_Buddy_RP/pack_icon.png",
            "Builder_Buddy_BP/scripts/main.js",
            "Builder_Buddy_BP/functions/builder_buddy_house.mcfunction",
        ):
            if required not in names:
                fail(f"archive is missing {required}")
        for name in names:
            if name.startswith("/") or ".." in name:
                fail(f"unsafe archive path: {name}")
            if "__MACOSX" in name or name.endswith(".DS_Store"):
                fail(f"junk file in archive: {name}")
        # Both manifests must still parse straight out of the archive.
        for manifest in ("Builder_Buddy_BP/manifest.json", "Builder_Buddy_RP/manifest.json"):
            try:
                json.loads(archive.read(manifest))
            except Exception as exc:  # noqa: BLE001
                fail(f"{manifest} inside the archive is unreadable ({exc})")

    size = os.path.getsize(ADDON)
    print(f"Packaged {ADDON} ({size:,} bytes, {len(names)} entries)")


def main():
    validate()
    for note in notes:
        print(f"  {note}")
    if errors:
        print("\nBuild failed:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        return 1

    package()
    if errors:
        print("\nPackaging failed:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        return 1

    print("Builder Buddy validated and packaged.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
