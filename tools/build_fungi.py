#!/usr/bin/env python3
"""Validate both Dangerous Fungi packs, then write dist/Dangerous_Fungi.mcaddon.

    python3 tools/build_fungi.py [--skip-syntax]

The build fails loudly rather than shipping a pack that silently half-loads on
a phone. Checks, in order:

  manifests    format, versions, unique UUIDs, BP -> RP dependency, script entry
  blocks       identifier/filename match, geometry resolves, every material
               instance resolves to a real PNG through terrain_texture.json,
               selection box inside the legal envelope, component allowlist
  creative     all 20 species carry menu_category AND a language name - this is
               the acceptance test, so it is checked explicitly and by count
  items        icon resolves, wearable slots valid, armour has an attachable
  geometry     identifiers unique, per-face material names defined by the block
  particles    identifier/filename match, texture on disk
  features     feature + rule identifiers match filenames, blocks exist
  functions    every referenced item/block id exists, every scriptevent is
               handled by main.js, every /function named in help exists
  scripts      data table matches the block set, main.js parses as an ES module
  archive      exactly two pack folders, each with a manifest at its root
"""

import json
import os
import re
import shutil
import subprocess
import struct
import sys
import tempfile
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import fungi_shapes  # noqa: E402
import fungi_spec as spec  # noqa: E402

BP = spec.BP_DIR
RP = spec.RP_DIR
DIST = "dist"
ADDON = os.path.join(DIST, spec.ADDON_NAME)

errors = []
warnings = []


def fail(message):
    errors.append(message)


def warn(message):
    warnings.append(message)


# --------------------------------------------------------------------------
# Loading
# --------------------------------------------------------------------------


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


def png_size(path):
    """Return (w, h) for a PNG, or None if the file is not a readable PNG."""
    try:
        with open(path, "rb") as handle:
            head = handle.read(24)
    except OSError:
        return None
    if len(head) < 24 or head[:8] != b"\x89PNG\r\n\x1a\n" or head[12:16] != b"IHDR":
        return None
    return struct.unpack(">II", head[16:24])


def require_png(path, context, expect=None):
    if not os.path.isfile(path):
        fail(f"{context}: missing texture file {path}")
        return
    size = png_size(path)
    if size is None:
        fail(f"{context}: {path} is not a valid PNG")
        return
    if expect and size != expect:
        warn(f"{context}: {path} is {size[0]}x{size[1]}, expected {expect[0]}x{expect[1]}")


# --------------------------------------------------------------------------
# Manifests
# --------------------------------------------------------------------------


def check_manifests():
    bp = load_json(os.path.join(BP, "manifest.json"))
    rp = load_json(os.path.join(RP, "manifest.json"))
    if not bp or not rp:
        fail("cannot continue without both manifests")
        return None, None

    uuids = []
    for label, manifest in (("BP", bp), ("RP", rp)):
        header = manifest.get("header", {})
        if manifest.get("format_version") != 2:
            fail(f"{label} manifest: format_version must be 2")
        for field in ("name", "description", "uuid", "version", "min_engine_version"):
            if field not in header:
                fail(f"{label} manifest: header is missing '{field}'")
        if header.get("min_engine_version") != spec.MIN_ENGINE:
            fail(
                f"{label} manifest: min_engine_version {header.get('min_engine_version')} "
                f"!= target {spec.MIN_ENGINE}"
            )
        if not manifest.get("modules"):
            fail(f"{label} manifest: no modules")
        uuids.append(header.get("uuid"))
        uuids.extend(module.get("uuid") for module in manifest.get("modules", []))

    duplicates = sorted({u for u in uuids if uuids.count(u) > 1})
    if duplicates:
        fail(f"duplicate UUIDs across manifests: {duplicates}")
    for value in uuids:
        if not re.fullmatch(r"[0-9a-fA-F-]{36}", str(value or "")):
            fail(f"malformed UUID: {value!r}")

    # The behaviour pack must pull in this exact resource pack, or the blocks
    # load with no model and no name.
    rp_uuid = rp["header"]["uuid"]
    dependencies = bp.get("dependencies", [])
    if rp_uuid not in [dep.get("uuid") for dep in dependencies]:
        fail(f"BP manifest: no dependency on the resource pack ({rp_uuid})")
    server = [d for d in dependencies if d.get("module_name") == "@minecraft/server"]
    if not server:
        fail("BP manifest: missing @minecraft/server dependency")
    elif server[0].get("version") != spec.SERVER_MODULE:
        fail(
            f"BP manifest: @minecraft/server {server[0].get('version')} "
            f"!= expected {spec.SERVER_MODULE}"
        )

    # A resource pack must not depend on a behaviour pack: the UUID does not
    # resolve in the resource-pack registry, so the RP reports a missing
    # dependency and can refuse to activate.
    bp_uuid = bp["header"]["uuid"]
    for dependency in rp.get("dependencies", []):
        if dependency.get("uuid") == bp_uuid:
            fail("RP manifest: depends on the behaviour pack - remove it, the BP -> RP link is enough")
        elif dependency.get("uuid"):
            warn(f"RP manifest: unexpected dependency on {dependency['uuid']}")

    script_modules = [m for m in bp["modules"] if m.get("type") == "script"]
    if not script_modules:
        fail("BP manifest: no script module")
    for module in script_modules:
        entry = os.path.join(BP, module.get("entry", ""))
        if not os.path.isfile(entry):
            fail(f"BP manifest: script entry not found: {entry}")

    for pack, label in ((BP, "BP"), (RP, "RP")):
        require_png(os.path.join(pack, "pack_icon.png"), f"{label} pack icon")

    return bp, rp


# --------------------------------------------------------------------------
# Blocks
# --------------------------------------------------------------------------

ALLOWED_BLOCK_COMPONENTS = {
    "minecraft:geometry",
    "minecraft:material_instances",
    "minecraft:collision_box",
    "minecraft:selection_box",
    "minecraft:destructible_by_mining",
    "minecraft:destructible_by_explosion",
    "minecraft:light_emission",
    "minecraft:light_dampening",
    "minecraft:map_color",
    "minecraft:flammable",
    "minecraft:friction",
    "minecraft:loot",
    "minecraft:display_name",
    "minecraft:placement_filter",
}

VALID_RENDER_METHODS = {
    "opaque",
    "alpha_test",
    "blend",
    "double_sided",
    "alpha_test_single_sided",
}


VALID_BLOCK_SOUNDS = {
    "amethyst_block", "anvil", "azalea", "bamboo", "candle", "cloth", "coral",
    "deepslate", "glass", "grass", "gravel", "honey_block", "itemframe",
    "ladder", "metal", "moss", "mud", "nether_wart", "netherrack",
    "powder_snow", "sand", "scaffolding", "sculk", "silent", "slime", "snow",
    "soul_sand", "stone", "sweet_berry_bush", "turtle_egg", "wood",
}


def check_block_sounds(block_ids):
    """Every custom block needs a blocks.json entry or it is entirely silent."""
    path = os.path.join(RP, "blocks.json")
    doc = load_json(path)
    if doc is None:
        fail(f"missing {path} - every custom block would be silent")
        return
    for identifier in block_ids:
        entry = doc.get(identifier)
        if not isinstance(entry, dict) or not entry.get("sound"):
            fail(f"{path}: no sound entry for {identifier} - it would be silent")
        elif entry["sound"] not in VALID_BLOCK_SOUNDS:
            fail(f"{path}: {identifier} uses unknown sound {entry['sound']!r}")
    for key in doc:
        if key == "format_version":
            continue
        if key not in block_ids:
            warn(f"{path}: entry for unknown block {key}")


def check_blocks(terrain, geometries):
    identifiers = []
    for path in sorted(walk(os.path.join(BP, "blocks"), ".json")):
        doc = load_json(path)
        if doc is None:
            continue
        block = doc.get("minecraft:block")
        if not block:
            fail(f"{path}: no minecraft:block root")
            continue

        description = block.get("description", {})
        identifier = description.get("identifier")
        stem = os.path.splitext(os.path.basename(path))[0]
        if identifier != spec.ident(stem):
            fail(f"{path}: identifier {identifier!r} does not match filename ({spec.ident(stem)})")
        identifiers.append(identifier)

        # ---- creative inventory: the headline requirement ----
        menu = description.get("menu_category")
        if not isinstance(menu, dict) or not menu.get("category"):
            fail(
                f"{path}: no description.menu_category.category - {identifier} would NOT "
                f"appear in the Creative inventory"
            )
        elif menu.get("is_hidden_in_commands"):
            fail(f"{path}: menu_category.is_hidden_in_commands hides {identifier}")

        components = block.get("components", {})
        unknown = set(components) - ALLOWED_BLOCK_COMPONENTS
        if unknown:
            fail(f"{path}: unsupported block component(s) {sorted(unknown)}")

        # ---- geometry ----
        geometry = components.get("minecraft:geometry")
        geo_id = geometry.get("identifier") if isinstance(geometry, dict) else geometry
        if not geo_id:
            fail(f"{path}: no minecraft:geometry")
        elif geo_id not in geometries:
            fail(f"{path}: geometry {geo_id!r} has no model in the resource pack")

        # ---- material instances -> terrain_texture -> png ----
        instances = components.get("minecraft:material_instances")
        if not isinstance(instances, dict) or "*" not in instances:
            fail(f"{path}: minecraft:material_instances must exist and define '*'")
            instances = instances if isinstance(instances, dict) else {}
        for name, instance in instances.items():
            if isinstance(instance, str):
                if instance not in instances:
                    fail(f"{path}: material alias {name!r} points at undefined {instance!r}")
                continue
            method = instance.get("render_method")
            if method not in VALID_RENDER_METHODS:
                fail(f"{path}: material {name!r} has invalid render_method {method!r}")
            key = instance.get("texture")
            if key not in terrain:
                fail(f"{path}: material {name!r} texture {key!r} missing from terrain_texture.json")
                continue
            require_png(
                os.path.join(RP, terrain[key] + ".png"),
                f"{path} material {name!r}",
                expect=(16, 16),
            )

        # ---- numeric ranges ----
        light = components.get("minecraft:light_emission")
        if light is not None and not (isinstance(light, int) and 0 <= light <= 15):
            fail(f"{path}: light_emission must be an integer 0-15, got {light!r}")
        dampening = components.get("minecraft:light_dampening")
        if dampening is not None and not (isinstance(dampening, int) and 0 <= dampening <= 15):
            fail(f"{path}: light_dampening must be an integer 0-15, got {dampening!r}")
        colour = components.get("minecraft:map_color")
        if colour is not None and not re.fullmatch(r"#[0-9A-Fa-f]{6}", str(colour)):
            fail(f"{path}: map_color must be #RRGGBB, got {colour!r}")

        box = components.get("minecraft:selection_box")
        if isinstance(box, dict):
            ox, oy, oz = box["origin"]
            sx, sy, sz = box["size"]
            if not (-8 <= ox and ox + sx <= 8 and -8 <= oz and oz + sz <= 8):
                fail(f"{path}: selection_box leaves the -8..8 horizontal envelope")
            if not (0 <= oy and oy + sy <= 16):
                fail(f"{path}: selection_box leaves the 0..16 vertical envelope")

    if len(identifiers) != 20:
        fail(f"expected 20 fungus blocks, found {len(identifiers)}")
    if len(set(identifiers)) != len(identifiers):
        fail("duplicate block identifiers")
    expected = {spec.ident(s["key"]) for s in spec.SPECIES}
    if set(identifiers) != expected:
        fail(f"block set does not match the species list: {sorted(expected ^ set(identifiers))}")
    return identifiers


# --------------------------------------------------------------------------
# Items
# --------------------------------------------------------------------------

VALID_ARMOR_SLOTS = {
    "slot.armor.head",
    "slot.armor.chest",
    "slot.armor.legs",
    "slot.armor.feet",
}


def check_items(item_atlas, attachables):
    identifiers = []
    for path in sorted(walk(os.path.join(BP, "items"), ".json")):
        doc = load_json(path)
        if doc is None:
            continue
        item = doc.get("minecraft:item")
        if not item:
            fail(f"{path}: no minecraft:item root")
            continue

        description = item.get("description", {})
        identifier = description.get("identifier")
        stem = os.path.splitext(os.path.basename(path))[0]
        if identifier != spec.ident(stem):
            fail(f"{path}: identifier {identifier!r} does not match filename")
        identifiers.append(identifier)

        menu = description.get("menu_category")
        if not isinstance(menu, dict) or not menu.get("category"):
            fail(f"{path}: no menu_category.category - {identifier} would not appear in Creative")

        components = item.get("components", {})

        icon = components.get("minecraft:icon")
        version = str(doc.get("format_version", "0"))
        parts = tuple(int(p) for p in version.split("."))
        if isinstance(icon, dict) and "texture" in icon and parts >= (1, 20, 60):
            fail(
                f"{path}: minecraft:icon uses the deprecated flat 'texture' field at "
                f"format_version {version}; the game ignores it and the icon renders blank"
            )
            continue
        key = icon.get("textures", {}).get("default") if isinstance(icon, dict) else icon
        if not key:
            fail(f"{path}: no minecraft:icon texture")
        elif key not in item_atlas:
            fail(f"{path}: icon {key!r} missing from item_texture.json")
        else:
            require_png(
                os.path.join(RP, item_atlas[key] + ".png"), f"{path} icon", expect=(16, 16)
            )

        # minecraft:* tags belong to the engine; declaring one from a pack is
        # undocumented and can log a tag-registration error.
        for tag in components.get("minecraft:tags", {}).get("tags", []):
            if str(tag).startswith("minecraft:"):
                fail(f"{path}: declares engine-owned tag {tag!r} - use a fungi: tag instead")

        wearable = components.get("minecraft:wearable")
        if wearable:
            if wearable.get("slot") not in VALID_ARMOR_SLOTS:
                fail(f"{path}: wearable slot {wearable.get('slot')!r} is not a valid armour slot")
            if identifier not in attachables:
                fail(f"{path}: wearable item has no attachable, so it is invisible when worn")
            if "minecraft:durability" not in components:
                warn(f"{path}: wearable item has no durability")

    expected = {spec.ident(item["key"]) for item in spec.EQUIPMENT}
    if set(identifiers) != expected:
        fail(f"item set mismatch: {sorted(expected ^ set(identifiers))}")
    return identifiers


# --------------------------------------------------------------------------
# Resource pack indexes
# --------------------------------------------------------------------------


def read_atlas(path, label):
    doc = load_json(path)
    if not doc:
        fail(f"missing {label} ({path})")
        return {}
    data = doc.get("texture_data", {})
    flat = {}
    for key, value in data.items():
        textures = value.get("textures") if isinstance(value, dict) else value
        if isinstance(textures, list):
            textures = textures[0]
        if not isinstance(textures, str):
            fail(f"{path}: entry {key!r} has no usable texture path")
            continue
        flat[key] = textures
    return flat


def read_geometries():
    found = {}
    for path in walk(os.path.join(RP, "models"), ".geo.json"):
        doc = load_json(path)
        if not doc:
            continue
        for entry in doc.get("minecraft:geometry", []):
            identifier = entry.get("description", {}).get("identifier")
            if not identifier:
                fail(f"{path}: geometry with no identifier")
                continue
            if identifier in found:
                fail(f"duplicate geometry identifier {identifier} in {path} and {found[identifier]}")
            found[identifier] = path
    return found


def read_attachables():
    found = {}
    for path in walk(os.path.join(RP, "attachables"), ".json"):
        doc = load_json(path)
        if not doc:
            continue
        description = doc.get("minecraft:attachable", {}).get("description", {})
        identifier = description.get("identifier")
        if not identifier:
            fail(f"{path}: attachable with no identifier")
            continue
        found[identifier] = path
        for name, texture in description.get("textures", {}).items():
            if not texture.startswith("textures/"):
                continue
            if texture.startswith("textures/misc/"):
                continue  # vanilla enchantment glint
            require_png(os.path.join(RP, texture + ".png"), f"{path} texture {name!r}")
        if not description.get("render_controllers"):
            fail(f"{path}: attachable has no render_controllers, so it will not draw")
    return found


# --------------------------------------------------------------------------
# Geometry cross-check
# --------------------------------------------------------------------------


def check_geometry_materials():
    """Every per-face material name must be declared by the block that uses it."""
    block_materials = {}
    for path in walk(os.path.join(BP, "blocks"), ".json"):
        doc = load_json(path)
        if not doc:
            continue
        block = doc.get("minecraft:block", {})
        geometry = block.get("components", {}).get("minecraft:geometry")
        geo_id = geometry.get("identifier") if isinstance(geometry, dict) else geometry
        names = set(block.get("components", {}).get("minecraft:material_instances", {}))
        # '*' is the fallback for any face that names no instance.
        block_materials.setdefault(geo_id, set()).update(names)

    for path in walk(os.path.join(RP, "models"), ".geo.json"):
        doc = load_json(path)
        if not doc:
            continue
        for entry in doc.get("minecraft:geometry", []):
            geo_id = entry.get("description", {}).get("identifier")
            declared = block_materials.get(geo_id)
            if declared is None:
                warn(f"{path}: geometry {geo_id} is not used by any block")
                continue
            for bone in entry.get("bones", []):
                for index, cube in enumerate(bone.get("cubes", [])):
                    uv = cube.get("uv")
                    if not isinstance(uv, dict):
                        continue
                    for face, spec_uv in uv.items():
                        if not isinstance(spec_uv, dict):
                            continue
                        name = spec_uv.get("material_instance")
                        if name is None:
                            continue  # falls through to the block's "*" instance
                        if name not in declared:
                            fail(
                                f"{path}: cube {index} face {face} uses material "
                                f"{name!r}, which {geo_id}'s block does not define"
                            )


# --------------------------------------------------------------------------
# Particles, features, functions
# --------------------------------------------------------------------------


def check_particles():
    seen = set()
    for path in sorted(walk(os.path.join(RP, "particles"), ".json")):
        doc = load_json(path)
        if not doc:
            continue
        effect = doc.get("particle_effect")
        if not effect:
            fail(f"{path}: no particle_effect root")
            continue
        description = effect.get("description", {})
        identifier = description.get("identifier")
        if not identifier or ":" not in str(identifier):
            fail(f"{path}: particle identifier must be namespaced, got {identifier!r}")
        if identifier in seen:
            fail(f"duplicate particle identifier {identifier}")
        seen.add(identifier)

        render = description.get("basic_render_parameters", {})
        texture = render.get("texture")
        if not texture:
            fail(f"{path}: no basic_render_parameters.texture")
        else:
            require_png(os.path.join(RP, texture + ".png"), f"{path} particle texture")
        if not effect.get("components"):
            fail(f"{path}: particle has no components")
    expected = {f"{spec.NAMESPACE}:{s['key']}_spore" for s in spec.SPECIES}
    if seen != expected:
        fail(f"particle set mismatch: {sorted(expected ^ seen)}")
    return seen


def check_features(block_ids):
    feature_ids = set()
    for path in sorted(walk(os.path.join(BP, "features"), ".json")):
        doc = load_json(path)
        if not doc:
            continue
        feature = doc.get("minecraft:single_block_feature")
        if not feature:
            fail(f"{path}: no minecraft:single_block_feature root")
            continue
        identifier = feature.get("description", {}).get("identifier")
        stem = os.path.splitext(os.path.basename(path))[0]
        # Bedrock requires the feature name to match the filename exactly.
        if identifier != f"{spec.NAMESPACE}:{stem}":
            fail(f"{path}: feature identifier {identifier!r} must match the filename")
        feature_ids.add(identifier)

        places = feature.get("places_block")
        if places not in block_ids:
            fail(f"{path}: places_block {places!r} is not one of the add-on's blocks")

        attach = feature.get("may_attach_to", {})
        sides = attach.get("min_sides_must_attach")
        if sides is not None and not (1 <= sides <= 4):
            fail(f"{path}: min_sides_must_attach must be 1-4, got {sides}")
        for side, blocks in attach.items():
            if side in ("min_sides_must_attach", "auto_rotate"):
                continue
            if side not in ("top", "bottom", "north", "south", "east", "west", "all", "sides"):
                fail(f"{path}: may_attach_to has unknown side {side!r}")
            for block_id in blocks if isinstance(blocks, list) else [blocks]:
                if not str(block_id).startswith("minecraft:"):
                    fail(f"{path}: may_attach_to.{side} contains non-vanilla {block_id!r}")

    for path in sorted(walk(os.path.join(BP, "feature_rules"), ".json")):
        doc = load_json(path)
        if not doc:
            continue
        rule = doc.get("minecraft:feature_rules")
        if not rule:
            fail(f"{path}: no minecraft:feature_rules root")
            continue
        description = rule.get("description", {})
        identifier = description.get("identifier")
        stem = os.path.splitext(os.path.basename(path))[0]
        if identifier != f"{spec.NAMESPACE}:{stem}":
            fail(f"{path}: rule identifier {identifier!r} must match the filename")
        places = description.get("places_feature")
        if places not in feature_ids:
            fail(f"{path}: places_feature {places!r} has no matching feature file")

        conditions = rule.get("conditions", {})
        placement = conditions.get("placement_pass")
        valid_passes = {
            "first_pass",
            "before_underground_pass",
            "underground_pass",
            "after_underground_pass",
            "before_surface_pass",
            "surface_pass",
            "after_surface_pass",
            "final_pass",
            "pregeneration_pass",
            "sky_pass",
        }
        if placement not in valid_passes:
            fail(f"{path}: unknown placement_pass {placement!r}")
        if "minecraft:biome_filter" not in conditions:
            warn(f"{path}: no biome filter - the feature will try every biome")

        distribution = rule.get("distribution", {})
        if "iterations" not in distribution:
            fail(f"{path}: distribution has no iterations")
        for axis in ("x", "y", "z"):
            if axis not in distribution:
                fail(f"{path}: distribution is missing {axis}")
    return feature_ids


def check_functions(block_ids, item_ids):
    directory = os.path.join(BP, "functions")
    if not os.path.isdir(directory):
        fail("no functions directory")
        return
    names = {
        os.path.splitext(os.path.basename(p))[0]
        for p in walk(directory, ".mcfunction")
    }

    with open(os.path.join(BP, "scripts", "main.js"), encoding="utf-8") as handle:
        script = handle.read()

    known = set(block_ids) | set(item_ids)
    given = set()

    for path in sorted(walk(directory, ".mcfunction")):
        with open(path, encoding="utf-8") as handle:
            body = handle.read()
        for line_number, line in enumerate(body.splitlines(), 1):
            line = line.strip()
            if not line or line.startswith("#"):
                continue

            for identifier in re.findall(r"\bfungi:[a-z_]+", line):
                if line.startswith("scriptevent"):
                    if f'case "{identifier}"' not in script:
                        fail(f"{path}:{line_number}: main.js does not handle {identifier}")
                elif identifier not in known:
                    fail(f"{path}:{line_number}: unknown identifier {identifier}")
                elif line.startswith("give"):
                    given.add(identifier)

            for target in re.findall(r"/function ([a-z_]+)", line):
                if target not in names:
                    fail(f"{path}:{line_number}: references missing function {target}")

    # fungi_give_all is the tester's shortcut - it must hand over everything.
    missing = known - given
    if missing:
        fail(f"fungi_give_all does not give: {sorted(missing)}")

    for required in (
        "fungi_help",
        "fungi_give_all",
        "fungi_test_area",
        "fungi_clear_effects",
        "fungi_spread_on",
        "fungi_spread_off",
        "fungi_emergency_cleanup",
    ):
        if required not in names:
            fail(f"missing required function {required}.mcfunction")


# --------------------------------------------------------------------------
# Language + scripts
# --------------------------------------------------------------------------


def check_lang(block_ids, item_ids):
    path = os.path.join(RP, "texts", "en_US.lang")
    if not os.path.isfile(path):
        fail(f"missing {path}")
        return
    with open(path, encoding="utf-8") as handle:
        lang = handle.read()

    entries = {}
    for line in lang.splitlines():
        if line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key in entries:
            fail(f"{path}: duplicate key {key}")
        entries[key] = value.strip()

    for identifier in block_ids:
        key = f"tile.{identifier}.name"
        if not entries.get(key):
            fail(f"{path}: no name for {identifier} (needs {key}) - it would show a raw key in Creative")
    for identifier in item_ids:
        key = f"item.{identifier}.name"
        if not entries.get(key):
            fail(f"{path}: no name for {identifier} (needs {key})")

    names = [entries[f"tile.{i}.name"] for i in block_ids if f"tile.{i}.name" in entries]
    if len(set(names)) != len(names):
        fail(f"{path}: two species share a display name")

    for pack in (BP, RP):
        languages = os.path.join(pack, "texts", "languages.json")
        if not os.path.isfile(languages):
            fail(f"missing {languages}")
        elif load_json(languages) != ["en_US"]:
            warn(f"{languages}: expected [\"en_US\"]")


def check_scripts(block_ids, skip_syntax=False):
    data_path = os.path.join(BP, "scripts", "fungi_data.js")
    main_path = os.path.join(BP, "scripts", "main.js")
    for path in (data_path, main_path):
        if not os.path.isfile(path):
            fail(f"missing {path}")
            return

    with open(data_path, encoding="utf-8") as handle:
        data = handle.read()
    for identifier in block_ids:
        if f'"{identifier}"' not in data:
            fail(f"{data_path}: species table does not mention {identifier}")

    with open(main_path, encoding="utf-8") as handle:
        main = handle.read()
    for symbol in ("SPECIES", "BY_ID", "EQUIPMENT", "DANGER_NAMES", "DANGER_BLOCK", "VERSION"):
        if f"export const {symbol}" not in data:
            fail(f"{data_path}: does not export {symbol}, but main.js imports it")
    if "@minecraft/server" not in main:
        fail(f"{main_path}: does not import @minecraft/server")

    if skip_syntax or not shutil.which("node"):
        warn("node not available - skipped JavaScript syntax check")
        return
    with tempfile.TemporaryDirectory() as tmp:
        for path in (data_path, main_path):
            target = os.path.join(tmp, os.path.basename(path).replace(".js", ".mjs"))
            with open(path, encoding="utf-8") as src, open(target, "w", encoding="utf-8") as dst:
                dst.write(src.read().replace("./fungi_data.js", "./fungi_data.mjs"))
        for name in ("fungi_data.mjs", "main.mjs"):
            result = subprocess.run(
                ["node", "--check", os.path.join(tmp, name)],
                capture_output=True,
                text=True,
            )
            if result.returncode != 0:
                fail(f"scripts/{name.replace('.mjs', '.js')}: syntax error\n{result.stderr.strip()}")


# --------------------------------------------------------------------------
# Packaging
# --------------------------------------------------------------------------


def package():
    os.makedirs(DIST, exist_ok=True)
    if os.path.exists(ADDON):
        os.remove(ADDON)

    with zipfile.ZipFile(ADDON, "w", zipfile.ZIP_DEFLATED) as archive:
        for root, folder in ((BP, spec.BP_FOLDER), (RP, spec.RP_FOLDER)):
            for base, _dirs, files in os.walk(root):
                for name in sorted(files):
                    source = os.path.join(base, name)
                    arcname = os.path.join(
                        folder, os.path.relpath(source, root)
                    ).replace(os.sep, "/")
                    archive.write(source, arcname)
    return ADDON


def verify_archive():
    """Re-open the finished .mcaddon and check it the way the game will."""
    with zipfile.ZipFile(ADDON) as archive:
        names = archive.namelist()
        bad = archive.testzip()
        if bad:
            fail(f"{ADDON}: corrupt entry {bad}")
        roots = {name.split("/")[0] for name in names}
        if roots != {spec.BP_FOLDER, spec.RP_FOLDER}:
            fail(f"{ADDON}: top-level folders are {sorted(roots)}")
        for folder in (spec.BP_FOLDER, spec.RP_FOLDER):
            if f"{folder}/manifest.json" not in names:
                fail(f"{ADDON}: {folder}/manifest.json is not at the pack root")
        for name in names:
            if name.startswith("/") or ".." in name:
                fail(f"{ADDON}: unsafe archive path {name}")
        blocks = [n for n in names if n.startswith(f"{spec.BP_FOLDER}/blocks/")]
        if len(blocks) != 20:
            fail(f"{ADDON}: contains {len(blocks)} block files, expected 20")
        return len(names)


# --------------------------------------------------------------------------
# Driver
# --------------------------------------------------------------------------


def main():
    skip_syntax = "--skip-syntax" in sys.argv

    for path in (BP, RP):
        if not os.path.isdir(path):
            fail(f"missing pack directory {path} - run tools/gen_fungi_pack.py first")
    if errors:
        report(0)
        return 1

    check_manifests()
    terrain = read_atlas(os.path.join(RP, "textures", "terrain_texture.json"), "terrain_texture.json")
    item_atlas = read_atlas(os.path.join(RP, "textures", "item_texture.json"), "item_texture.json")
    geometries = read_geometries()
    attachables = read_attachables()

    block_ids = check_blocks(terrain, geometries)
    check_block_sounds(block_ids)
    item_ids = check_items(item_atlas, attachables)
    check_geometry_materials()
    check_particles()
    check_features(set(block_ids))
    check_functions(block_ids, item_ids)
    check_lang(block_ids, item_ids)
    check_scripts(block_ids, skip_syntax)

    # Orphan textures are harmless but usually mean a rename went half-done.
    referenced = {os.path.join(RP, p + ".png") for p in terrain.values()}
    referenced |= {os.path.join(RP, p + ".png") for p in item_atlas.values()}
    for path in walk(os.path.join(RP, "textures", "blocks"), ".png"):
        if path not in referenced:
            warn(f"orphan texture (nothing references it): {path}")

    total = len(list(walk(BP, ".json"))) + len(list(walk(RP, ".json")))
    if errors:
        report(total)
        return 1

    package()
    entries = verify_archive()
    if errors:
        report(total)
        return 1

    report(total)
    size = os.path.getsize(ADDON)
    print(f"\nPackaged {ADDON}")
    print(f"  {entries} files, {size:,} bytes")
    print(f"  {len(block_ids)} fungus blocks, all with menu_category + display name")
    print(f"  {len(item_ids)} equipment items")
    return 0


def report(total):
    print(f"Validated {total} JSON files across both packs.")
    for message in warnings:
        print(f"  warning: {message}")
    if errors:
        print(f"\nBuild FAILED with {len(errors)} error(s):", file=sys.stderr)
        for message in errors:
            print(f"  - {message}", file=sys.stderr)
    else:
        print("  all checks passed")


if __name__ == "__main__":
    sys.exit(main())
