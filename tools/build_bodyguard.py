#!/usr/bin/env python3
"""Validate and package Sakura Bodyguard.

A cross-reference validator for behavior_packs/bodyguard_bp +
resource_packs/bodyguard_rp, in the same house style as tools/build.py but far
stricter: it chases every symbolic reference in the pack (icon key -> atlas ->
png, client entity -> geometry/animation/controller ids, controller -> short
name, animation -> geometry bone, render controller -> texture key) all the way
down to something that actually exists on disk, then zips the two packs into
dist/SakuraBodyguard.mcaddon.

The bone check is the important one: Bedrock silently ignores an animation
channel that names a bone the geometry does not have, so a typo there costs you
a limb with no error anywhere in the content log.

Usage:  python3 tools/build_bodyguard.py
"""

import json
import os
import re
import struct
import sys
import zipfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BP = os.path.join("behavior_packs", "bodyguard_bp")
RP = os.path.join("resource_packs", "bodyguard_rp")
DIST = "dist"
ADDON = os.path.join(DIST, "SakuraBodyguard.mcaddon")

# Other packs in this repo. A UUID collision with any of them makes exactly one
# of the two packs importable and the other silently absent, which is a
# miserable thing to debug on a phone.
FOREIGN_PACKS = (
    os.path.join("behavior_packs", "arcane_arsenal_bp", "manifest.json"),
    os.path.join("resource_packs", "arcane_arsenal_rp", "manifest.json"),
)

# Pre-allocated UUIDs. These are contractual - the pack must ship these exact
# values or an existing install will not upgrade in place.
EXPECTED_UUIDS = {
    "BP header": "81b6e45d-97ae-41a0-89b3-687074795396",
    "BP data module": "6adf65f5-7213-4098-ae01-7db51ed14541",
    "BP script module": "eb7e3e50-9b43-48ac-8ab5-340248fc6751",
    "RP header": "9ceb725c-6940-406e-9505-34c85f30eb0c",
    "RP resources module": "6b1f9b26-da1c-4459-867b-4536ed35931f",
}

NAMESPACE = "bg:"

# Files that must never end up inside the archive.
JUNK_NAMES = {".DS_Store", "Thumbs.db", "desktop.ini"}
JUNK_DIRS = {"__pycache__", ".git", ".ipynb_checkpoints"}
JUNK_SUFFIXES = (".pyc", ".pyo", ".orig", ".rej", ".bak", ".swp", "~")

errors = []
notes = []


def fail(message):
    errors.append(message)


def note(message):
    notes.append(message)


# ---------------------------------------------------------------------------
# loading
# ---------------------------------------------------------------------------


def load_json(path):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except Exception as exc:  # noqa: BLE001 - report and keep going
        fail(f"{path}: invalid JSON ({exc})")
        return None


def walk_files(root):
    for base, dirs, files in os.walk(root):
        dirs[:] = sorted(d for d in dirs if d not in JUNK_DIRS)
        for name in sorted(files):
            yield os.path.join(base, name)


def is_junk(path):
    name = os.path.basename(path)
    if name in JUNK_NAMES:
        return True
    if any(part in JUNK_DIRS for part in path.split(os.sep)):
        return True
    return name.endswith(JUNK_SUFFIXES)


# ---------------------------------------------------------------------------
# png
# ---------------------------------------------------------------------------

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
COLOUR_TYPES = {
    0: "grey",
    2: "rgb",
    3: "indexed",
    4: "grey+alpha",
    6: "rgba",
}


def read_png_header(path):
    """Return (width, height, bit_depth, colour_type) or None, reporting why."""
    try:
        with open(path, "rb") as handle:
            head = handle.read(33)
    except OSError as exc:
        fail(f"{path}: cannot read PNG ({exc})")
        return None

    if len(head) < 33 or head[:8] != PNG_SIGNATURE:
        fail(f"{path}: not a PNG (bad signature)")
        return None
    length, chunk = struct.unpack(">I4s", head[8:16])
    if chunk != b"IHDR" or length != 13:
        fail(f"{path}: first chunk is not a 13-byte IHDR")
        return None
    width, height, depth, colour = struct.unpack(">IIBB", head[16:26])
    if width == 0 or height == 0:
        fail(f"{path}: IHDR reports a zero dimension ({width}x{height})")
        return None
    return width, height, depth, colour


# ---------------------------------------------------------------------------
# helpers for reference chasing
# ---------------------------------------------------------------------------


def rp_asset(relative):
    """Resource-pack texture references are extensionless paths from the RP root."""
    return os.path.join(RP, relative.replace("/", os.sep) + ".png")


ARRAY_INDEX = re.compile(r"^Array\.([A-Za-z0-9_]+)\s*\[")


def resolve_render_texture_expr(expr, arrays, textures, path, seen):
    """Resolve one entry of a render controller "textures" list.

    Handles both the plain "Texture.foo" form and the vanilla
    "Array.skins[<molang>]" indexed form, in which case every member of the
    array has to resolve because any of them can be selected at runtime.
    """
    expr = expr.strip()
    match = ARRAY_INDEX.match(expr)
    if match:
        name = match.group(1)
        members = arrays.get("Array." + name)
        if members is None:
            fail(f"{path}: texture array 'Array.{name}' is not defined")
            return
        if not members:
            fail(f"{path}: texture array 'Array.{name}' is empty")
            return
        for member in members:
            resolve_render_texture_expr(member, arrays, textures, path, seen)
        return

    if not expr.startswith("Texture."):
        fail(f"{path}: unsupported texture expression {expr!r}")
        return

    key = expr[len("Texture.") :]
    seen.add(key)
    if key not in textures:
        fail(
            f"{path}: render controller uses Texture.{key}, which is not in the "
            f"client entity textures map (has: {sorted(textures)})"
        )


def collect_recipe_items(recipe):
    """Yield (role, identifier) for every item a recipe names."""
    result = recipe.get("result")
    for entry in result if isinstance(result, list) else [result]:
        if isinstance(entry, dict) and "item" in entry:
            yield "result", entry["item"]
        elif isinstance(entry, str):
            yield "result", entry

    for entry in recipe.get("ingredients", []) or []:
        if isinstance(entry, dict) and "item" in entry:
            yield "ingredient", entry["item"]
        elif isinstance(entry, str):
            yield "ingredient", entry

    for entry in (recipe.get("key") or {}).values():
        for one in entry if isinstance(entry, list) else [entry]:
            if isinstance(one, dict) and "item" in one:
                yield "ingredient", one["item"]
            elif isinstance(one, str):
                yield "ingredient", one

    for field in ("input", "reagent", "output"):
        entry = recipe.get(field)
        if isinstance(entry, dict) and "item" in entry:
            yield ("result" if field == "output" else "ingredient"), entry["item"]
        elif isinstance(entry, str):
            yield ("result" if field == "output" else "ingredient"), entry


def strip_count(identifier):
    """Vanilla recipes allow "minecraft:planks:2" data-value suffixes."""
    parts = identifier.split(":")
    if len(parts) == 3 and parts[2].isdigit():
        return ":".join(parts[:2])
    return identifier


# ---------------------------------------------------------------------------
# validation
# ---------------------------------------------------------------------------


def validate():
    documents = {}
    pngs = []

    for root in (BP, RP):
        if not os.path.isdir(root):
            fail(f"missing pack directory: {root}")
            continue
        for path in walk_files(root):
            if is_junk(path):
                fail(f"stray file in pack tree: {path}")
                continue
            if path.endswith(".json"):
                documents[path] = load_json(path)
            elif path.endswith(".png"):
                pngs.append(path)

    # -- every PNG on disk must actually decode -----------------------------
    png_size = {}
    for path in sorted(pngs):
        header = read_png_header(path)
        if header:
            width, height, depth, colour = header
            png_size[path] = (width, height)
            note(
                f"png {path}: {width}x{height} {depth}-bit "
                f"{COLOUR_TYPES.get(colour, f'type{colour}')}"
            )

    for pack, root in (("BP", BP), ("RP", RP)):
        icon = os.path.join(root, "pack_icon.png")
        if icon not in png_size:
            fail(f"{pack}: missing or unreadable {icon}")

    # -- manifests ----------------------------------------------------------
    bp_manifest = documents.get(os.path.join(BP, "manifest.json"))
    rp_manifest = documents.get(os.path.join(RP, "manifest.json"))
    if not bp_manifest or not rp_manifest:
        fail("cannot continue without both manifests")
        return documents

    def module_of(manifest, kind):
        for module in manifest.get("modules", []):
            if module.get("type") == kind:
                return module
        return None

    bp_data = module_of(bp_manifest, "data")
    bp_script = module_of(bp_manifest, "script")
    rp_resources = module_of(rp_manifest, "resources")

    actual = {
        "BP header": bp_manifest.get("header", {}).get("uuid"),
        "BP data module": (bp_data or {}).get("uuid"),
        "BP script module": (bp_script or {}).get("uuid"),
        "RP header": rp_manifest.get("header", {}).get("uuid"),
        "RP resources module": (rp_resources or {}).get("uuid"),
    }
    for label, expected in EXPECTED_UUIDS.items():
        got = actual.get(label)
        if got is None:
            fail(f"{label}: missing (module not present in manifest)")
        elif str(got).lower() != expected:
            fail(f"{label}: uuid is {got}, expected the pre-allocated {expected}")

    present = [u for u in actual.values() if u]
    duplicates = sorted({u for u in present if present.count(u) > 1})
    if duplicates:
        fail(f"duplicate UUIDs within the bodyguard manifests: {duplicates}")

    # ... and no collision with the other add-on in this repo.
    foreign = {}
    for path in FOREIGN_PACKS:
        doc = load_json(path) if os.path.isfile(path) else None
        if not doc:
            continue
        foreign[doc["header"]["uuid"].lower()] = f"{path} header"
        for module in doc.get("modules", []):
            foreign[module["uuid"].lower()] = f"{path} {module.get('type')} module"
    for label, uuid in actual.items():
        if uuid and uuid.lower() in foreign:
            fail(f"{label} uuid {uuid} collides with {foreign[uuid.lower()]}")

    # -- BP -> RP dependency + script entry ---------------------------------
    rp_uuid = rp_manifest["header"]["uuid"]
    dependencies = bp_manifest.get("dependencies", [])
    if rp_uuid not in [d.get("uuid") for d in dependencies]:
        fail(f"behaviour pack does not depend on resource pack header {rp_uuid}")

    if bp_script:
        entry = bp_script.get("entry")
        if not entry:
            fail("BP script module has no 'entry'")
        elif not os.path.isfile(os.path.join(BP, entry)):
            fail(f"script entry not found: {os.path.join(BP, entry)}")
        # A script module with no @minecraft/server dependency will not link.
        if not any(d.get("module_name") == "@minecraft/server" for d in dependencies):
            fail("BP declares a script module but no @minecraft/server dependency")

    # -- items --------------------------------------------------------------
    atlas_path = os.path.join(RP, "textures", "item_texture.json")
    atlas = documents.get(atlas_path)
    if atlas is None:
        fail(f"missing {atlas_path}")
        texture_data = {}
    else:
        texture_data = atlas.get("texture_data", {})

    item_ids = []
    items_dir = os.path.join(BP, "items")
    for path, doc in sorted(documents.items()):
        if not path.startswith(items_dir + os.sep) or doc is None:
            continue
        item = doc.get("minecraft:item", {})
        identifier = item.get("description", {}).get("identifier")
        if not identifier:
            fail(f"{path}: item has no description.identifier")
            continue
        item_ids.append(identifier)

        version = tuple(
            int(part) for part in str(doc.get("format_version", "0")).split(".")
        )
        components = item.get("components", {})
        icon = components.get("minecraft:icon")
        if icon is None:
            fail(f"{path}: no minecraft:icon component")
            continue
        if isinstance(icon, dict) and "texture" in icon and version >= (1, 20, 60):
            fail(
                f"{path}: minecraft:icon uses the deprecated flat 'texture' field at "
                f"format_version {doc.get('format_version')} - use "
                '{"textures": {"default": ...}} instead'
            )
            continue

        if isinstance(icon, dict):
            key = icon.get("textures", {}).get("default") or icon.get("texture")
        else:
            key = icon
        if not key:
            fail(f"{path}: minecraft:icon resolves to no texture key")
            continue
        if key not in texture_data:
            fail(f"{path}: icon key '{key}' is missing from {atlas_path}")
            continue
        target = texture_data[key].get("textures")
        if isinstance(target, list):
            target = target[0] if target else None
        if not target:
            fail(f"{atlas_path}: key '{key}' has no textures path")
            continue
        png = rp_asset(target)
        if png not in png_size:
            fail(f"{path}: icon '{key}' points at missing/undecodable {png}")

    # Atlas keys that resolve nowhere are dead weight but also a sign of a typo.
    for key, entry in sorted(texture_data.items()):
        target = entry.get("textures")
        if isinstance(target, list):
            target = target[0] if target else None
        if target and rp_asset(target) not in png_size:
            fail(f"{atlas_path}: key '{key}' points at missing {rp_asset(target)}")

    # -- entity (behaviour side) --------------------------------------------
    entity_ids = []
    entities_dir = os.path.join(BP, "entities")
    for path, doc in sorted(documents.items()):
        if not path.startswith(entities_dir + os.sep) or doc is None:
            continue
        description = doc.get("minecraft:entity", {}).get("description", {})
        identifier = description.get("identifier")
        if not identifier:
            fail(f"{path}: entity has no description.identifier")
            continue
        entity_ids.append(identifier)
        if not description.get("is_summonable"):
            fail(f"{path}: {identifier} is not summonable")
        if not description.get("is_spawnable"):
            fail(f"{path}: {identifier} is not spawnable (no spawn egg will exist)")

    # -- recipes ------------------------------------------------------------
    known_items = set(item_ids)
    recipes_dir = os.path.join(BP, "recipes")
    for path, doc in sorted(documents.items()):
        if not path.startswith(recipes_dir + os.sep) or doc is None:
            continue
        for root_key, recipe in doc.items():
            if not root_key.startswith("minecraft:recipe_"):
                continue
            for role, raw in collect_recipe_items(recipe):
                identifier = strip_count(raw)
                if identifier.startswith(NAMESPACE):
                    if identifier not in known_items:
                        fail(
                            f"{path}: {role} '{identifier}' is not defined by any item "
                            f"in this pack (defined: {sorted(known_items)})"
                        )
                elif identifier.startswith("minecraft:") or ":" not in identifier:
                    if role == "result":
                        # A recipe that outputs a vanilla item is legal but is
                        # almost always a copy/paste slip in a custom pack.
                        note(f"{path}: result '{identifier}' is a vanilla item")
                else:
                    fail(
                        f"{path}: {role} '{identifier}' is neither vanilla "
                        f"(minecraft:*) nor defined in this pack"
                    )

    # -- language -----------------------------------------------------------
    lang_path = os.path.join(RP, "texts", "en_US.lang")
    lang_keys = set()
    if not os.path.isfile(lang_path):
        fail(f"missing {lang_path}")
    else:
        with open(lang_path, encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                lang_keys.add(line.split("=", 1)[0].strip())

    languages_path = os.path.join(RP, "texts", "languages.json")
    if documents.get(languages_path) is None:
        fail(f"missing {languages_path}")
    elif "en_US" not in documents[languages_path]:
        fail(f"{languages_path}: does not list en_US")

    for identifier in item_ids:
        if f"item.{identifier}.name" not in lang_keys:
            fail(f"{lang_path}: no 'item.{identifier}.name' entry")
    for identifier in entity_ids:
        if f"entity.{identifier}.name" not in lang_keys:
            fail(f"{lang_path}: no 'entity.{identifier}.name' entry")
        egg = f"item.spawn_egg.entity.{identifier}.name"
        if egg not in lang_keys:
            fail(f"{lang_path}: no '{egg}' entry (spawn egg would show a raw key)")

    # -- geometry -----------------------------------------------------------
    geometry_bones = {}  # geometry id -> set of bone names
    for path, doc in sorted(documents.items()):
        if doc is None or not path.startswith(os.path.join(RP, "models") + os.sep):
            continue
        for geo in doc.get("minecraft:geometry", []):
            identifier = geo.get("description", {}).get("identifier")
            if not identifier:
                fail(f"{path}: geometry entry with no description.identifier")
                continue
            bones = {b.get("name") for b in geo.get("bones", []) if b.get("name")}
            geometry_bones[identifier] = bones

            names = [b.get("name") for b in geo.get("bones", [])]
            for name in names:
                if names.count(name) > 1:
                    fail(f"{path}: geometry {identifier} defines bone '{name}' twice")
            for bone in geo.get("bones", []):
                parent = bone.get("parent")
                if parent and parent not in bones:
                    fail(
                        f"{path}: bone '{bone.get('name')}' has parent '{parent}' "
                        f"which is not a bone in {identifier}"
                    )

    # -- animations ---------------------------------------------------------
    animation_ids = set()
    animation_bones = {}  # animation id -> set of bone names
    for path, doc in sorted(documents.items()):
        if doc is None or not path.startswith(os.path.join(RP, "animations") + os.sep):
            continue
        for identifier, body in (doc.get("animations") or {}).items():
            animation_ids.add(identifier)
            animation_bones[identifier] = set((body.get("bones") or {}).keys())

    # -- animation controllers ----------------------------------------------
    controller_ids = set()
    controller_refs = {}  # controller id -> set of animation short names used
    controller_states = {}  # controller id -> (initial_state, {state names})
    for path, doc in sorted(documents.items()):
        if doc is None or not path.startswith(
            os.path.join(RP, "animation_controllers") + os.sep
        ):
            continue
        for identifier, body in (doc.get("animation_controllers") or {}).items():
            controller_ids.add(identifier)
            states = body.get("states") or {}
            controller_states[identifier] = (body.get("initial_state"), set(states))
            used = set()
            for state_name, state in states.items():
                for entry in state.get("animations", []) or []:
                    if isinstance(entry, str):
                        used.add(entry)
                    elif isinstance(entry, dict):
                        used.update(entry.keys())
                for entry in state.get("transitions", []) or []:
                    if not isinstance(entry, dict):
                        continue
                    for target in entry:
                        if target not in states:
                            fail(
                                f"{path}: {identifier} state '{state_name}' "
                                f"transitions to unknown state '{target}'"
                            )
            controller_refs[identifier] = used

            initial, names = controller_states[identifier]
            if initial and initial not in names:
                fail(f"{path}: {identifier} initial_state '{initial}' does not exist")

    # -- render controllers -------------------------------------------------
    render_controllers = {}
    for path, doc in sorted(documents.items()):
        if doc is None or not path.startswith(
            os.path.join(RP, "render_controllers") + os.sep
        ):
            continue
        for identifier, body in (doc.get("render_controllers") or {}).items():
            render_controllers[identifier] = (path, body)

    # -- client entities: the hub every reference passes through ------------
    entity_dir = os.path.join(RP, "entity")
    client_ids = []
    for path, doc in sorted(documents.items()):
        if doc is None or not path.startswith(entity_dir + os.sep):
            continue
        description = doc.get("minecraft:client_entity", {}).get("description", {})
        identifier = description.get("identifier")
        if not identifier:
            fail(f"{path}: client entity has no description.identifier")
            continue
        client_ids.append(identifier)
        if identifier not in entity_ids:
            fail(f"{path}: client entity '{identifier}' has no behaviour definition")

        textures = description.get("textures", {}) or {}
        if not textures:
            fail(f"{path}: client entity has no textures")
        for key, relative in sorted(textures.items()):
            png = rp_asset(relative)
            if png not in png_size:
                fail(f"{path}: texture '{key}' -> missing/undecodable {png}")

        geometries = description.get("geometry", {}) or {}
        if not geometries:
            fail(f"{path}: client entity has no geometry")
        entity_geometry_ids = {}
        for key, geo_id in sorted(geometries.items()):
            if geo_id not in geometry_bones:
                fail(
                    f"{path}: geometry '{key}' -> '{geo_id}' is not defined in any "
                    f"geo.json (defined: {sorted(geometry_bones)})"
                )
            else:
                entity_geometry_ids[key] = geo_id

        # animations map: short name -> animation id or controller id
        animations = description.get("animations", {}) or {}
        short_to_full = {}
        for short, full in sorted(animations.items()):
            short_to_full[short] = full
            if full.startswith("controller.animation."):
                if full not in controller_ids:
                    fail(
                        f"{path}: animation short name '{short}' -> '{full}' is not a "
                        f"defined animation controller"
                    )
            elif full not in animation_ids:
                fail(
                    f"{path}: animation short name '{short}' -> '{full}' is not a "
                    f"defined animation"
                )

        # scripts.animate entries must be short names that exist.
        animate = (description.get("scripts", {}) or {}).get("animate", []) or []
        animated_shorts = set()
        for entry in animate:
            if isinstance(entry, str):
                animated_shorts.add(entry)
            elif isinstance(entry, dict):
                animated_shorts.update(entry.keys())
        for short in sorted(animated_shorts):
            if short not in short_to_full:
                fail(
                    f"{path}: scripts.animate lists '{short}', which is not in the "
                    f"description animations map"
                )
        # Every controller in the map has to be driven by scripts.animate or it
        # never runs; every clip listed there instead of a controller would run
        # unconditionally at weight 1.
        for short, full in sorted(short_to_full.items()):
            if full.startswith("controller.animation.") and short not in animated_shorts:
                fail(
                    f"{path}: animation controller '{full}' (short '{short}') is not "
                    f"listed in scripts.animate, so it will never run"
                )

        # Short names a controller plays must exist in this entity's map.
        for short, full in sorted(short_to_full.items()):
            if not full.startswith("controller.animation."):
                continue
            for used in sorted(controller_refs.get(full, set())):
                if used not in short_to_full:
                    fail(
                        f"{path}: controller '{full}' plays short name '{used}', "
                        f"which is not in the client entity animations map"
                    )

        # particle_effects referenced by controllers must be declared here.
        declared_particles = description.get("particle_effects", {}) or {}
        for short, full in sorted(short_to_full.items()):
            if not full.startswith("controller.animation."):
                continue
            for _cpath, cbody in [
                (p, b)
                for p, d in documents.items()
                if d and p.startswith(os.path.join(RP, "animation_controllers") + os.sep)
                for cid, b in (d.get("animation_controllers") or {}).items()
                if cid == full
            ]:
                for state in (cbody.get("states") or {}).values():
                    for effect in state.get("particle_effects", []) or []:
                        name = (
                            effect.get("effect")
                            if isinstance(effect, dict)
                            else effect
                        )
                        if name and name not in declared_particles:
                            fail(
                                f"{path}: controller '{full}' fires particle effect "
                                f"'{name}', which is not in the client entity "
                                f"particle_effects map"
                            )

        # Bone check: every bone any animation touches must exist in the
        # geometry this entity actually renders.
        all_bones = set()
        for geo_id in entity_geometry_ids.values():
            all_bones |= geometry_bones.get(geo_id, set())
        if all_bones:
            for short, full in sorted(short_to_full.items()):
                if full.startswith("controller.animation."):
                    continue
                for bone in sorted(animation_bones.get(full, set())):
                    if bone not in all_bones:
                        fail(
                            f"animation '{full}' animates bone '{bone}', which does "
                            f"not exist in geometry {sorted(entity_geometry_ids.values())} "
                            f"(known bones: {sorted(all_bones)})"
                        )

        # render controllers
        for reference in description.get("render_controllers", []) or []:
            name = (
                list(reference.keys())[0]
                if isinstance(reference, dict)
                else reference
            )
            if name not in render_controllers:
                fail(f"{path}: render controller '{name}' is not defined")
                continue
            rc_path, rc = render_controllers[name]
            arrays = (rc.get("arrays") or {}).get("textures") or {}
            expressions = rc.get("textures")
            if isinstance(expressions, str):
                fail(f"{rc_path}: 'textures' must be an array of expressions")
                expressions = [expressions]
            used_keys = set()
            for expr in expressions or []:
                resolve_render_texture_expr(
                    expr, arrays, textures, rc_path, used_keys
                )
            unused = sorted(set(textures) - used_keys)
            if unused:
                note(
                    f"{rc_path}: client entity texture(s) {unused} are never selected "
                    f"by {name}"
                )

            geo_expr = rc.get("geometry")
            if isinstance(geo_expr, str) and geo_expr.startswith("Geometry."):
                geo_key = geo_expr[len("Geometry.") :]
                if geo_key not in geometries:
                    fail(
                        f"{rc_path}: {name} uses {geo_expr}, but the client entity "
                        f"has no geometry key '{geo_key}'"
                    )
            materials = description.get("materials", {}) or {}
            for mapping in rc.get("materials", []) or []:
                for _bone, expr in (mapping or {}).items():
                    if isinstance(expr, str) and expr.startswith("Material."):
                        key = expr[len("Material.") :]
                        if key not in materials:
                            fail(
                                f"{rc_path}: {name} uses {expr}, but the client entity "
                                f"has no material key '{key}'"
                            )

    for identifier in entity_ids:
        if identifier not in client_ids:
            fail(f"entity '{identifier}' has no client entity file in {entity_dir}")

    # -- particles ----------------------------------------------------------
    for path, doc in sorted(documents.items()):
        if doc is None or not path.startswith(os.path.join(RP, "particles") + os.sep):
            continue
        description = doc.get("particle_effect", {}).get("description", {})
        if not description.get("identifier"):
            fail(f"{path}: particle has no description.identifier")
        relative = (description.get("basic_render_parameters") or {}).get("texture")
        if not relative:
            fail(f"{path}: particle has no basic_render_parameters.texture")
        elif rp_asset(relative) not in png_size:
            fail(f"{path}: particle texture -> missing/undecodable {rp_asset(relative)}")

    print(
        f"Validated {len(documents)} JSON files, {len(png_size)} PNGs, "
        f"{len(item_ids)} items, {len(entity_ids)} entities, "
        f"{len(animation_ids)} animations, {len(controller_ids)} animation "
        f"controllers, {len(geometry_bones)} geometries."
    )
    return documents


# ---------------------------------------------------------------------------
# packaging
# ---------------------------------------------------------------------------


def package():
    os.makedirs(DIST, exist_ok=True)
    if os.path.exists(ADDON):
        os.remove(ADDON)

    written = []
    with zipfile.ZipFile(ADDON, "w", zipfile.ZIP_DEFLATED) as archive:
        for root, folder in ((BP, "bodyguard_bp"), (RP, "bodyguard_rp")):
            sources = sorted(
                path for path in walk_files(root) if not is_junk(path)
            )
            for source in sources:
                arcname = "/".join(
                    [folder, os.path.relpath(source, root).replace(os.sep, "/")]
                )
                # Fixed timestamp so repeated builds are byte-identical.
                info = zipfile.ZipInfo(arcname, date_time=(2024, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o644 << 16
                with open(source, "rb") as handle:
                    archive.writestr(info, handle.read())
                written.append(arcname)

    for required in ("bodyguard_bp/manifest.json", "bodyguard_rp/manifest.json"):
        if required not in written:
            print(f"Build failed: {required} missing from archive", file=sys.stderr)
            sys.exit(1)

    size = os.path.getsize(ADDON)
    print(f"Packaged {ADDON} ({size:,} bytes, {len(written)} entries)")


if __name__ == "__main__":
    os.chdir(REPO)
    validate()
    if "-v" in sys.argv or "--verbose" in sys.argv:
        for line in notes:
            print(f"  note: {line}")
    if errors:
        print("\nBuild failed:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        sys.exit(1)
    for line in notes:
        if line.startswith("png "):
            print(f"  {line}")
    package()
