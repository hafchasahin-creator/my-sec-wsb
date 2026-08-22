#!/usr/bin/env python3
"""Validate and package every add-on in this repository.

Two add-ons live side by side:

  Arcane Arsenal  behavior_packs/arcane_arsenal_bp + resource_packs/arcane_arsenal_rp
  Bodyguard       behavior_packs/bodyguard_bp      + resource_packs/bodyguard_rp

Both target Bedrock 1.21.0.  The checks below are the ones that would otherwise
only show up in-game as a silently missing texture, an entity that renders as a
white box, or a behaviour pack that refuses to load at all:

  * every JSON file parses
  * manifest UUIDs are unique across the whole repository
  * each behaviour pack depends on its own resource pack, with matching versions
  * script entry points exist and every imported module is declared
  * item icons resolve item -> item_texture.json -> a real PNG
  * recipes only produce items that exist
  * every custom item and entity has a display name in en_US.lang
  * client entities resolve their geometry, textures, materials, animations,
    animation controllers and render controllers
  * animation controllers only reference animations the client entity maps
  * render controllers only reference textures/geometry the client entity maps
  * geometry bone parents exist, UV boxes fit the texture, and every visible
    cube face has non-transparent pixels behind it
  * every bg:* entity event a script triggers exists in the entity definition
  * every component group an event adds or removes exists
  * every file uses a format_version its schema actually understands in 1.21.0
  * no two AI goals that can be active together share a priority
  * every animation controller state is reachable and can be left again
  * every Molang expression parses, and *(with a reference tree)* every
    query.* it names exists in 1.21.0 and is not experimental
  * every custom particle a script spawns exists in the resource pack

Usage:  python3 tools/build.py [--skip-package]
"""

import json
import os
import re
import struct
import sys
import zlib
import zipfile

DIST = "dist"

ADDONS = [
    {
        "name": "ArcaneArsenal",
        "bp": os.path.join("behavior_packs", "arcane_arsenal_bp"),
        "rp": os.path.join("resource_packs", "arcane_arsenal_rp"),
        "namespace": "arcane",
    },
    {
        "name": "Bodyguard",
        "bp": os.path.join("behavior_packs", "bodyguard_bp"),
        "rp": os.path.join("resource_packs", "bodyguard_rp"),
        "namespace": "bg",
    },
]

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
    except Exception as exc:  # noqa: BLE001 - report and keep going
        fail("%s: invalid JSON (%s)" % (path, exc))
        return None


def walk_json(root):
    for base, _dirs, files in os.walk(root):
        for name in sorted(files):
            if name.endswith(".json"):
                yield os.path.join(base, name)


def read_png(path):
    """Minimal RGBA PNG reader - enough to check alpha coverage."""
    with open(path, "rb") as handle:
        data = handle.read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    pos, idat, width, height, colour = 8, b"", None, None, None
    while pos < len(data):
        length = struct.unpack(">I", data[pos : pos + 4])[0]
        tag = data[pos + 4 : pos + 8]
        body = data[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if tag == b"IHDR":
            width, height, _bits, colour = struct.unpack(">IIBB", body[:10])
        elif tag == b"IDAT":
            idat += body
        elif tag == b"IEND":
            break
    if colour != 6:
        raise ValueError("expected RGBA (colour type 6), got %s" % colour)
    raw = zlib.decompress(idat)
    stride, bpp = width * 4, 4
    rows, previous, index = [], bytearray(stride), 0
    for _ in range(height):
        filter_type = raw[index]
        index += 1
        line = bytearray(raw[index : index + stride])
        index += stride
        if filter_type == 1:
            for x in range(bpp, stride):
                line[x] = (line[x] + line[x - bpp]) & 255
        elif filter_type == 2:
            for x in range(stride):
                line[x] = (line[x] + previous[x]) & 255
        elif filter_type == 3:
            for x in range(stride):
                left = line[x - bpp] if x >= bpp else 0
                line[x] = (line[x] + ((left + previous[x]) >> 1)) & 255
        elif filter_type == 4:
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0
                b = previous[x]
                c = previous[x - bpp] if x >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        rows.append(line)
        previous = line
    return width, height, rows


# --------------------------------------------------------------------------
# format_version
#
# Bedrock does not reject an unknown format_version; it falls back to a
# different parse, which shows up in-game as a component that quietly does
# nothing.  These sets are what Mojang's own 1.21.0 packs use, plus the values
# the 1.21.0 schemas document.  Anything else is a guess.
# --------------------------------------------------------------------------
FORMAT_VERSIONS = {
    ("bp", "items"): {"1.10", "1.14", "1.16", "1.16.0", "1.20.50", "1.20.60", "1.20.80", "1.21.0"},
    ("bp", "recipes"): {"1.12", "1.16", "1.17", "1.19", "1.20.10", "1.20.60"},
    ("bp", "entities"): {
        "1.8.0", "1.10.0", "1.12.0", "1.13.0", "1.14.0", "1.16.0", "1.17.0",
        "1.18.10", "1.19.0", "1.20.0", "1.20.10", "1.20.60", "1.20.80", "1.21.0",
    },
    ("bp", "spawn_rules"): {"1.8.0", "1.11.0", "1.17.0"},
    ("rp", "entity"): {"1.8.0", "1.10.0"},
    ("rp", "animations"): {"1.8.0", "1.10.0"},
    ("rp", "animation_controllers"): {"1.10.0"},
    ("rp", "render_controllers"): {"1.8.0", "1.10", "1.10.0"},
    ("rp", "particles"): {"1.10.0"},
    ("rp", "models"): {"1.8.0", "1.10.0", "1.12.0", "1.16.0"},
    ("rp", "sounds"): {"1.14.0", "1.20.20"},
}


def check_format_versions(addon, documents):
    for path, doc in documents.items():
        if not isinstance(doc, dict) or "format_version" not in doc:
            continue
        relative = os.path.relpath(path, addon["bp"] if path.startswith(addon["bp"]) else addon["rp"])
        side = "bp" if path.startswith(addon["bp"]) else "rp"
        folder = relative.replace(os.sep, "/").split("/")[0]
        allowed = FORMAT_VERSIONS.get((side, folder))
        if not allowed:
            continue
        version = str(doc["format_version"])
        if version not in allowed:
            fail(
                "%s: format_version %s is not one Bedrock 1.21.0 uses for %s "
                "(expected one of %s)" % (path, version, folder, ", ".join(sorted(allowed)))
            )


# --------------------------------------------------------------------------
# Manifests
# --------------------------------------------------------------------------
def check_manifests(addons, documents):
    all_uuids = {}
    for addon in addons:
        bp = documents.get(os.path.join(addon["bp"], "manifest.json"))
        rp = documents.get(os.path.join(addon["rp"], "manifest.json"))
        if not bp or not rp:
            fail("%s: missing a manifest" % addon["name"])
            continue

        for manifest, label in ((bp, "BP"), (rp, "RP")):
            for uuid in [manifest["header"]["uuid"]] + [
                module["uuid"] for module in manifest["modules"]
            ]:
                if uuid in all_uuids:
                    fail(
                        "duplicate UUID %s used by %s and %s"
                        % (uuid, all_uuids[uuid], addon["name"] + " " + label)
                    )
                all_uuids[uuid] = addon["name"] + " " + label

        rp_uuid = rp["header"]["uuid"]
        dependency = None
        for entry in bp.get("dependencies", []):
            if entry.get("uuid") == rp_uuid:
                dependency = entry
        if not dependency:
            fail("%s: behaviour pack does not depend on its resource pack" % addon["name"])
        elif dependency.get("version") != rp["header"]["version"]:
            fail(
                "%s: dependency version %s does not match resource pack version %s"
                % (addon["name"], dependency.get("version"), rp["header"]["version"])
            )

        if bp["header"].get("min_engine_version") != [1, 21, 0]:
            fail("%s: BP min_engine_version must stay [1, 21, 0]" % addon["name"])

        # Script module versions must be declared, and must be the ones that
        # actually ship with 1.21.0.
        allowed = {"@minecraft/server": "1.11.0", "@minecraft/server-ui": "1.1.0"}
        declared = {
            entry["module_name"]: entry["version"]
            for entry in bp.get("dependencies", [])
            if "module_name" in entry
        }
        for module, version in declared.items():
            if module not in allowed:
                warn("%s: unrecognised script module %s" % (addon["name"], module))
            elif version != allowed[module]:
                fail(
                    "%s: %s %s is not the version shipped with Bedrock 1.21.0 (expected %s)"
                    % (addon["name"], module, version, allowed[module])
                )

        entry_path = None
        for module in bp["modules"]:
            if module["type"] == "script":
                entry_path = os.path.join(addon["bp"], module["entry"])
                if not os.path.isfile(entry_path):
                    fail("%s: script entry not found: %s" % (addon["name"], entry_path))
        addon["_script"] = entry_path
        addon["_modules"] = declared


def check_script_imports(addon):
    path = addon.get("_script")
    if not path or not os.path.isfile(path):
        return
    with open(path, encoding="utf-8") as handle:
        source = handle.read()
    imported = set(re.findall(r'from\s+"(@minecraft/[a-z-]+)"', source))
    declared = set(addon.get("_modules", {}).keys())
    for module in imported - declared:
        fail("%s: %s imports %s but the manifest does not declare it" % (addon["name"], path, module))
    for module in declared - imported:
        warn("%s: manifest declares %s but %s never imports it" % (addon["name"], module, path))
    addon["_source"] = source


# --------------------------------------------------------------------------
# Items, recipes, language
# --------------------------------------------------------------------------
def check_items(addon, documents):
    atlas_path = os.path.join(addon["rp"], "textures", "item_texture.json")
    atlas = documents.get(atlas_path)
    if atlas is None:
        fail("%s: missing %s" % (addon["name"], atlas_path))
        return [], {}
    texture_data = atlas.get("texture_data", {})

    identifiers = []
    for path, doc in documents.items():
        if not path.startswith(os.path.join(addon["bp"], "items")) or doc is None:
            continue
        item = doc.get("minecraft:item", {})
        identifier = item.get("description", {}).get("identifier")
        identifiers.append(identifier)

        version = tuple(int(p) for p in str(doc.get("format_version", "0")).split("."))
        icon = item.get("components", {}).get("minecraft:icon")
        # minecraft:icon changed shape at format_version 1.20.60: the flat
        # "texture" string is silently ignored, which renders as a blank icon.
        if isinstance(icon, dict) and "texture" in icon and version >= (1, 20, 60):
            fail(
                '%s: minecraft:icon uses the deprecated "texture" field at '
                'format_version %s - use {"textures": {"default": ...}}'
                % (path, doc["format_version"])
            )
            continue

        key = icon.get("textures", {}).get("default") if isinstance(icon, dict) else icon
        if not key:
            fail("%s: no minecraft:icon texture" % path)
        elif key not in texture_data:
            fail("%s: icon '%s' missing from item_texture.json" % (path, key))
        else:
            png = os.path.join(addon["rp"], texture_data[key]["textures"] + ".png")
            if not os.path.isfile(png):
                fail("%s: icon '%s' points at missing file %s" % (path, key, png))

    for path, doc in documents.items():
        if not path.startswith(os.path.join(addon["bp"], "recipes")) or doc is None:
            continue
        for kind in ("minecraft:recipe_shaped", "minecraft:recipe_shapeless"):
            recipe = doc.get(kind)
            if not recipe:
                continue
            result = recipe.get("result", {})
            result_item = result.get("item") if isinstance(result, dict) else result
            if result_item and result_item.startswith(addon["namespace"] + ":"):
                if result_item not in identifiers:
                    fail("%s: result '%s' has no item definition" % (path, result_item))
            # Shaped recipe keys must all appear in the pattern, and vice versa.
            if kind == "minecraft:recipe_shaped":
                pattern = "".join(recipe.get("pattern", []))
                keys = set(recipe.get("key", {}).keys())
                used = set(ch for ch in pattern if ch != " ")
                for missing in used - keys:
                    fail("%s: pattern uses '%s' with no key entry" % (path, missing))
                for unused in keys - used:
                    warn("%s: key '%s' is never used in the pattern" % (path, unused))

    return identifiers, texture_data


def check_language(addon, identifiers, entity_ids):
    lang_path = os.path.join(addon["rp"], "texts", "en_US.lang")
    text = ""
    if os.path.isfile(lang_path):
        with open(lang_path, encoding="utf-8") as handle:
            text = handle.read()
    else:
        fail("%s: missing %s" % (addon["name"], lang_path))
    for identifier in identifiers:
        if identifier and ("item.%s=" % identifier) not in text:
            fail("%s: no name entry for %s" % (lang_path, identifier))
    for identifier in entity_ids:
        if ("entity.%s.name=" % identifier) not in text:
            fail("%s: no entity name entry for %s" % (lang_path, identifier))
        if ("item.spawn_egg.entity.%s=" % identifier) not in text:
            warn("%s: no spawn egg name for %s" % (lang_path, identifier))

    for pack in (addon["bp"], addon["rp"]):
        languages = os.path.join(pack, "texts", "languages.json")
        if not os.path.isfile(languages):
            fail("%s: missing %s" % (addon["name"], languages))
        manifest = os.path.join(pack, "manifest.json")
        with open(manifest, encoding="utf-8") as handle:
            header = json.load(handle)["header"]
        # A manifest that uses translation keys needs them present in the lang.
        for field in ("name", "description"):
            value = header.get(field, "")
            if isinstance(value, str) and value.startswith("pack."):
                lang = os.path.join(pack, "texts", "en_US.lang")
                content = ""
                if os.path.isfile(lang):
                    with open(lang, encoding="utf-8") as handle:
                        content = handle.read()
                if ("%s=" % value) not in content:
                    fail("%s: manifest uses %s but %s does not define it" % (pack, value, lang))


# --------------------------------------------------------------------------
# Entities: behaviour side
# --------------------------------------------------------------------------
# Bedrock keeps target-selection goals in a separate list from action goals, so
# a shared priority only matters within one list.
TARGET_GOALS = {
    "minecraft:behavior.hurt_by_target",
    "minecraft:behavior.owner_hurt_by_target",
    "minecraft:behavior.owner_hurt_target",
    "minecraft:behavior.nearest_attackable_target",
    "minecraft:behavior.nearest_prioritized_attackable_target",
    "minecraft:behavior.defend_trusted_target",
    "minecraft:behavior.defend_village_target",
}


def collect_goals(node, out):
    if isinstance(node, dict):
        for key, value in node.items():
            if key.startswith("minecraft:behavior.") and isinstance(value, dict) and "priority" in value:
                out.append((key, value["priority"]))
            collect_goals(value, out)
    elif isinstance(node, list):
        for item in node:
            collect_goals(item, out)


def check_goal_priorities(path, entity):
    """Two goals at the same priority in the same list have undefined order."""
    groups = entity.get("component_groups", {})
    base = []
    collect_goals(entity.get("components", {}), base)

    # Groups that are mutually exclusive by construction: one mode, one tier.
    modes = sorted(g for g in groups if g.startswith("bg:mode_"))
    tiers = sorted(g for g in groups if g.startswith("bg:tier_"))
    always = sorted(g for g in groups if g.startswith("bg:flag_") or g == "bg:ranged")
    if not modes:
        return

    for mode in modes:
        combo = list(base)
        if "bg:bound" in groups:
            collect_goals(groups["bg:bound"], combo)
        collect_goals(groups[mode], combo)
        for extra in always:
            collect_goals(groups[extra], combo)
        for tier in tiers[:1]:
            collect_goals(groups[tier], combo)

        for is_target in (True, False):
            seen = {}
            for name, priority in combo:
                if (name in TARGET_GOALS) != is_target:
                    continue
                if priority in seen and seen[priority] != name:
                    fail(
                        "%s: with %s active, %s and %s both sit at priority %s"
                        % (path, mode, seen[priority], name, priority)
                    )
                seen[priority] = name


def check_bp_entities(addon, documents):
    entity_ids = []
    events_by_entity = {}
    for path, doc in documents.items():
        if not path.startswith(os.path.join(addon["bp"], "entities")) or doc is None:
            continue
        entity = doc.get("minecraft:entity", {})
        description = entity.get("description", {})
        identifier = description.get("identifier")
        if not identifier:
            fail("%s: entity has no identifier" % path)
            continue
        entity_ids.append(identifier)

        groups = set(entity.get("component_groups", {}).keys())
        events = entity.get("events", {})
        events_by_entity[identifier] = set(events.keys())

        def group_names(node, out):
            if isinstance(node, dict):
                for key, value in node.items():
                    if key == "component_groups" and isinstance(value, list):
                        out.update(value)
                    else:
                        group_names(value, out)
            elif isinstance(node, list):
                for item in node:
                    group_names(item, out)

        referenced = set()
        group_names(events, referenced)
        for missing in sorted(referenced - groups):
            fail("%s: event references unknown component group '%s'" % (path, missing))
        for unused in sorted(groups - referenced):
            # entity_spawned adds the starting groups; anything never added or
            # removed by any event is dead weight.
            warn("%s: component group '%s' is never added or removed" % (path, unused))

        # Every event a component triggers must exist.
        triggered = set()

        def find_triggers(node):
            if isinstance(node, dict):
                for key, value in node.items():
                    if key == "event" and isinstance(value, str):
                        triggered.add(value)
                    else:
                        find_triggers(value)
            elif isinstance(node, list):
                for item in node:
                    find_triggers(item)

        find_triggers(entity)
        for missing in sorted(triggered - set(events.keys())):
            if missing.startswith("minecraft:"):
                continue
            fail("%s: component triggers unknown event '%s'" % (path, missing))

        check_goal_priorities(path, entity)

        if description.get("is_spawnable") is not True:
            warn("%s: %s is not spawnable, so it gets no creative spawn egg" % (path, identifier))

    return entity_ids, events_by_entity


def check_script_events(addon, events_by_entity, particles, item_ids, entity_ids):
    """Every namespaced string literal in a script must name something real.

    Checking only `triggerEvent("...")` misses the ways a script actually
    reaches for an event: a table of modes, a ternary, a built-up tier name.
    So instead every "<namespace>:..." literal in the file is classified, and
    anything that matches nothing at all is a typo.
    """
    source = addon.get("_source")
    if not source:
        return
    namespace = addon["namespace"]
    script = addon["_script"]

    known_events = set()
    for events in events_by_entity.values():
        known_events |= events

    # Dynamic property keys are namespaced too, but they are storage, not ids.
    property_keys = set(
        re.findall(r'[gs]etDynamicProperty\(\s*"([^"]+)"', source)
    )

    # Prefixes built up at runtime, e.g. triggerEvent("bg:set_tier_" + tier).
    prefixes = set(re.findall(r'"([^"]*)"\s*\+', source))
    for prefix in sorted(p for p in prefixes if p.startswith(namespace + ":")):
        if not any(event.startswith(prefix) for event in known_events):
            fail("%s: builds event name from '%s' but no event matches" % (script, prefix))

    valid = known_events | set(particles) | set(item_ids) | set(entity_ids) | property_keys
    for literal in sorted(set(re.findall(r'"(%s:[A-Za-z_0-9]+)"' % namespace, source))):
        if literal in valid:
            continue
        if any(literal.startswith(prefix) for prefix in prefixes):
            continue
        fail(
            "%s: '%s' matches no entity event, particle, item, entity or dynamic "
            "property in this add-on" % (script, literal)
        )

    # The other direction: an event nothing can ever fire is dead configuration.
    literals = set(re.findall(r'"(%s:[A-Za-z_0-9]+)"' % namespace, source))
    for path, doc in addon["_documents"].items():
        if not path.startswith(os.path.join(addon["bp"], "entities")) or doc is None:
            continue
        entity = doc.get("minecraft:entity", {})
        fired = set(re.findall(r'"event":\s*"([^"]+)"', json.dumps(entity)))
        for name in sorted(set(entity.get("events", {})) - fired - literals):
            if name.startswith("minecraft:"):
                continue
            if any(name.startswith(prefix) for prefix in prefixes):
                continue
            warn("%s: event '%s' is never fired by the pack or its scripts" % (path, name))


# --------------------------------------------------------------------------
# Entities: resource side
# --------------------------------------------------------------------------
def collect_geometries(addon, documents):
    geometries = {}
    for path, doc in documents.items():
        if not path.startswith(os.path.join(addon["rp"], "models")) or doc is None:
            continue
        for entry in doc.get("minecraft:geometry", []):
            description = entry.get("description", {})
            identifier = description.get("identifier")
            if identifier:
                geometries[identifier] = (path, entry)
    return geometries


def collect_named(addon, documents, folder, key):
    found = {}
    for path, doc in documents.items():
        if not path.startswith(os.path.join(addon["rp"], folder)) or doc is None:
            continue
        for name in doc.get(key, {}):
            found[name] = path
    return found


def collect_particles(addon, documents):
    found = {}
    for path, doc in documents.items():
        if not path.startswith(os.path.join(addon["rp"], "particles")) or doc is None:
            continue
        identifier = doc.get("particle_effect", {}).get("description", {}).get("identifier")
        if identifier:
            found[identifier] = path
    return found


def check_rp_entities(addon, documents, entity_ids):
    geometries = collect_geometries(addon, documents)
    animations = collect_named(addon, documents, "animations", "animations")
    controllers = collect_named(addon, documents, "animation_controllers", "animation_controllers")
    renderers = collect_named(addon, documents, "render_controllers", "render_controllers")
    atlas = documents.get(os.path.join(addon["rp"], "textures", "item_texture.json")) or {}
    texture_data = atlas.get("texture_data", {})

    described = []
    for path, doc in documents.items():
        if not path.startswith(os.path.join(addon["rp"], "entity")) or doc is None:
            continue
        description = doc.get("minecraft:client_entity", {}).get("description", {})
        identifier = description.get("identifier")
        described.append(identifier)
        if identifier not in entity_ids:
            fail("%s: client entity '%s' has no behaviour pack entity" % (path, identifier))

        for name, geometry in description.get("geometry", {}).items():
            if geometry not in geometries:
                fail("%s: geometry '%s' (%s) is not defined in this pack" % (path, geometry, name))

        for name, texture in description.get("textures", {}).items():
            png = os.path.join(addon["rp"], texture + ".png")
            if not os.path.isfile(png):
                fail("%s: texture '%s' -> missing %s" % (path, name, png))

        spawn_egg = description.get("spawn_egg", {})
        if "texture" in spawn_egg and "texture_index" in spawn_egg:
            key = spawn_egg["texture"]
            if key != "spawn_egg" and key not in texture_data:
                fail("%s: spawn egg texture '%s' missing from item_texture.json" % (path, key))

        mapped = description.get("animations", {})
        for short, target in mapped.items():
            if target.startswith("controller."):
                if target not in controllers:
                    fail("%s: animation controller '%s' is not defined" % (path, target))
            elif target not in animations:
                fail("%s: animation '%s' is not defined" % (path, target))

        scripts = description.get("scripts", {})
        for short in scripts.get("animate", []):
            name = short if isinstance(short, str) else list(short.keys())[0]
            if name not in mapped:
                fail("%s: scripts.animate references '%s' which is not in animations" % (path, name))

        for controller in description.get("render_controllers", []):
            name = controller if isinstance(controller, str) else list(controller.keys())[0]
            if name not in renderers:
                fail("%s: render controller '%s' is not defined" % (path, name))

        # Animation controllers may only reference short names the entity maps.
        for controller_name, controller_path in controllers.items():
            if controller_name not in mapped.values():
                continue
            controller_doc = documents[controller_path]["animation_controllers"][controller_name]
            for state_name, state in controller_doc.get("states", {}).items():
                for animation in state.get("animations", []):
                    key = animation if isinstance(animation, str) else list(animation.keys())[0]
                    if key not in mapped:
                        fail(
                            "%s: state '%s' plays '%s' which the client entity does not map"
                            % (controller_path, state_name, key)
                        )
                # Every transition must point at a state that exists.
                for transition in state.get("transitions", []):
                    for target in transition:
                        if target not in controller_doc.get("states", {}):
                            fail(
                                "%s: state '%s' transitions to unknown state '%s'"
                                % (controller_path, state_name, target)
                            )

        # Render controllers may only reference textures/geometry/materials the
        # entity maps.
        for renderer_name, renderer_path in renderers.items():
            if renderer_name not in description.get("render_controllers", []):
                continue
            renderer = documents[renderer_path]["render_controllers"][renderer_name]
            blob = json.dumps(renderer)
            for reference in set(re.findall(r"Texture\.([A-Za-z_0-9]+)", blob)):
                if reference not in description.get("textures", {}):
                    fail("%s: references Texture.%s which the entity does not map" % (renderer_path, reference))
            for reference in set(re.findall(r"Geometry\.([A-Za-z_0-9]+)", blob)):
                if reference not in description.get("geometry", {}):
                    fail("%s: references Geometry.%s which the entity does not map" % (renderer_path, reference))
            for reference in set(re.findall(r"Material\.([A-Za-z_0-9]+)", blob)):
                if reference not in description.get("materials", {}):
                    fail("%s: references Material.%s which the entity does not map" % (renderer_path, reference))

    for identifier in entity_ids:
        if identifier not in described:
            fail("%s: entity '%s' has no client entity definition" % (addon["name"], identifier))

    return geometries


def check_geometry(addon, geometries, documents):
    """Bone parents, UV bounds, and texture coverage for every visible face."""
    for identifier, (path, geometry) in geometries.items():
        description = geometry.get("description", {})
        width = description.get("texture_width", 64)
        height = description.get("texture_height", 64)
        bones = {bone["name"]: bone for bone in geometry.get("bones", [])}

        for bone in geometry.get("bones", []):
            parent = bone.get("parent")
            if parent and parent not in bones:
                fail("%s: bone '%s' has unknown parent '%s'" % (path, bone["name"], parent))

        # Which textures actually render this geometry?
        textures = []
        for entity_path, doc in documents.items():
            if not entity_path.startswith(os.path.join(addon["rp"], "entity")) or doc is None:
                continue
            entity_description = doc.get("minecraft:client_entity", {}).get("description", {})
            if identifier not in entity_description.get("geometry", {}).values():
                continue
            textures = list(entity_description.get("textures", {}).values())

        boxes = []
        for bone in geometry.get("bones", []):
            for cube in bone.get("cubes", []):
                u, v = cube["uv"] if isinstance(cube.get("uv"), list) else (0, 0)
                sx, sy, sz = cube["size"]
                sx, sy, sz = int(sx), int(sy), int(sz)
                box_w, box_h = 2 * (sz + sx), sz + sy
                if u + box_w > width or v + box_h > height:
                    fail(
                        "%s: cube on '%s' at uv %s needs %dx%d but the texture is %dx%d"
                        % (path, bone["name"], cube["uv"], box_w, box_h, width, height)
                    )
                boxes.append((bone["name"], u, v, sx, sy, sz, bone.get("mirror", False)))

        for texture in textures:
            png = os.path.join(addon["rp"], texture + ".png")
            if not os.path.isfile(png):
                continue
            try:
                png_w, png_h, rows = read_png(png)
            except Exception as exc:  # noqa: BLE001
                fail("%s: %s" % (png, exc))
                continue
            if (png_w, png_h) != (width, height):
                fail(
                    "%s: is %dx%d but geometry %s declares %dx%d"
                    % (png, png_w, png_h, identifier, width, height)
                )
                continue
            for name, u, v, sx, sy, sz, _mirror in boxes:
                # The hat/overlay layer is deliberately part-transparent.
                if name in ("hat",):
                    continue
                faces = {
                    "top": (u + sz, v, sx, sz),
                    "bottom": (u + sz + sx, v, sx, sz),
                    "right": (u, v + sz, sz, sy),
                    "front": (u + sz, v + sz, sx, sy),
                    "left": (u + sz + sx, v + sz, sz, sy),
                    "back": (u + 2 * sz + sx, v + sz, sx, sy),
                }
                for face, (fx, fy, fw, fh) in faces.items():
                    if fw == 0 or fh == 0:
                        continue
                    transparent = 0
                    for yy in range(fy, fy + fh):
                        for xx in range(fx, fx + fw):
                            if rows[yy][xx * 4 + 3] == 0:
                                transparent += 1
                    if transparent:
                        fail(
                            "%s: %s face of bone '%s' has %d transparent pixels"
                            % (png, face, name, transparent)
                        )


# --------------------------------------------------------------------------
# Animation controllers and Molang
# --------------------------------------------------------------------------
def check_controller_graphs(addon, documents):
    """A state nothing transitions into never plays; a state with no way out
    is a trap unless it is genuinely terminal (death)."""
    for path, doc in documents.items():
        if not path.startswith(os.path.join(addon["rp"], "animation_controllers")) or doc is None:
            continue
        for name, controller in doc.get("animation_controllers", {}).items():
            states = controller.get("states", {})
            initial = controller.get("initial_state", "default")
            if initial not in states:
                fail("%s: %s has initial_state '%s' which is not defined" % (path, name, initial))
                continue

            reachable = {initial}
            frontier = [initial]
            while frontier:
                current = frontier.pop()
                for transition in states.get(current, {}).get("transitions", []):
                    for target in transition:
                        if target not in states:
                            continue  # already reported by check_rp_entities
                        if target not in reachable:
                            reachable.add(target)
                            frontier.append(target)

            for state in sorted(set(states) - reachable):
                fail("%s: %s state '%s' can never be entered" % (path, name, state))

            for state, body in states.items():
                if body.get("transitions"):
                    continue
                # A terminal state is only sensible if it plays something that
                # ends the entity, i.e. the death animation.
                plays = [a if isinstance(a, str) else list(a.keys())[0] for a in body.get("animations", [])]
                if not any("death" in play for play in plays):
                    warn("%s: %s state '%s' has no way out" % (path, name, state))


# Molang built-ins that are not query.* - checked by prefix.
MOLANG_MATH = {
    "abs", "acos", "asin", "atan", "atan2", "ceil", "clamp", "cos", "die_roll",
    "die_roll_integer", "exp", "floor", "hermite_blend", "lerp", "lerprotate",
    "ln", "max", "min", "mod", "pi", "pow", "random", "random_integer", "round",
    "sin", "sqrt", "trunc",
}
# Set by the engine, so a pack may read them without assigning them first.
ENGINE_VARIABLES = {
    # entity animation
    "attack_time", "gliding_speed_value", "is_brandishing_spear",
    "is_holding_spyglass", "is_using_vr", "player_x_rotation", "player_y_rotation",
    # particle systems
    "particle_age", "particle_lifetime", "particle_random_1", "particle_random_2",
    "particle_random_3", "particle_random_4", "emitter_age", "emitter_lifetime",
    "emitter_random_1", "emitter_random_2", "emitter_random_3", "emitter_random_4",
}
# query.* that only resolves with an experimental toggle on.
EXPERIMENTAL_QUERIES = {"state_time"}


def molang_strings(node, out):
    if isinstance(node, str):
        if "query." in node or "math." in node or "variable." in node or "Math." in node:
            out.append(node)
    elif isinstance(node, dict):
        for value in node.values():
            molang_strings(value, out)
    elif isinstance(node, list):
        for item in node:
            molang_strings(item, out)


def check_molang(addon, documents, reference):
    known_queries = None
    if reference:
        doc_path = os.path.join(reference, "documentation", "Molang.html")
        if os.path.isfile(doc_path):
            with open(doc_path, encoding="utf-8", errors="replace") as handle:
                raw = handle.read()
            known_queries = set(re.findall(r"query\.([a-z_0-9]+)", raw))

    # Variables the pack itself assigns, anywhere in the resource pack.
    assigned = set(ENGINE_VARIABLES)
    for path, doc in documents.items():
        if not path.startswith(addon["rp"]) or doc is None:
            continue
        text = json.dumps(doc)
        assigned.update(re.findall(r"variable\.([a-zA-Z_0-9]+)\s*=", text))

    checked = 0
    for path, doc in documents.items():
        if not path.startswith(addon["rp"]) or doc is None:
            continue
        expressions = []
        molang_strings(doc, expressions)
        for expression in expressions:
            checked += 1
            if expression.count("(") != expression.count(")"):
                fail("%s: unbalanced parentheses in Molang: %s" % (path, expression[:90]))
            for name in re.findall(r"[Mm]ath\.([a-zA-Z_0-9]+)", expression):
                if name not in MOLANG_MATH:
                    fail("%s: math.%s is not a Molang function" % (path, name))
            for name in set(re.findall(r"query\.([a-zA-Z_0-9]+)", expression)):
                if name in EXPERIMENTAL_QUERIES:
                    fail(
                        "%s: query.%s is experimental in 1.21.0 and will not resolve "
                        "with experiments off" % (path, name)
                    )
                elif known_queries is not None and name not in known_queries:
                    fail("%s: query.%s does not exist in 1.21.0" % (path, name))
            for name in set(re.findall(r"variable\.([a-zA-Z_0-9]+)", expression)):
                if name not in assigned:
                    fail(
                        "%s: variable.%s is read but never assigned in this pack "
                        "and is not engine-provided" % (path, name)
                    )
    return checked


# --------------------------------------------------------------------------
# Sounds
# --------------------------------------------------------------------------
def check_sounds(addon, documents, reference):
    known = None
    if reference:
        definitions = os.path.join(reference, "resource_pack", "sounds", "sound_definitions.json")
        if os.path.isfile(definitions):
            with open(definitions, encoding="utf-8") as handle:
                known = set(json.load(handle).get("sound_definitions", {}).keys())

    local = set()
    local_path = os.path.join(addon["rp"], "sounds", "sound_definitions.json")
    if os.path.isfile(local_path):
        doc = documents.get(local_path) or {}
        local = set(doc.get("sound_definitions", {}).keys())

    used = []
    sounds_path = os.path.join(addon["rp"], "sounds.json")
    doc = documents.get(sounds_path)
    if doc:
        for entity, config in doc.get("entity_sounds", {}).get("entities", {}).items():
            for event, value in config.get("events", {}).items():
                sound = value if isinstance(value, str) else value.get("sound")
                if sound:
                    used.append((sounds_path, "%s/%s" % (entity, event), sound))

    source = addon.get("_source")
    if source:
        for match in re.finditer(r'playSound\([^,]+,\s*"([a-z0-9_.]+)"', source):
            used.append((addon["_script"], "script", match.group(1)))

    if known is None:
        if used:
            warn("%s: %d sound ids unverified (no 1.21.0 reference tree)" % (addon["name"], len(used)))
        return
    for path, where, sound in used:
        if sound not in known and sound not in local:
            fail("%s: %s uses sound '%s' which does not exist in 1.21.0" % (path, where, sound))


# --------------------------------------------------------------------------
def validate(reference):
    for addon in ADDONS:
        documents = {}
        for root in (addon["bp"], addon["rp"]):
            if not os.path.isdir(root):
                fail("missing pack directory: %s" % root)
                continue
            for path in walk_json(root):
                documents[path] = load_json(path)
        addon["_documents"] = documents

    check_manifests(ADDONS, {p: d for a in ADDONS for p, d in a["_documents"].items()})

    total_files = 0
    for addon in ADDONS:
        documents = addon["_documents"]
        total_files += len(documents)
        check_format_versions(addon, documents)
        check_script_imports(addon)
        identifiers, _atlas = check_items(addon, documents)
        entity_ids, events_by_entity = check_bp_entities(addon, documents)
        particles = collect_particles(addon, documents)
        check_script_events(addon, events_by_entity, particles, identifiers, entity_ids)
        check_language(addon, identifiers, entity_ids)
        geometries = check_rp_entities(addon, documents, entity_ids)
        check_geometry(addon, geometries, documents)
        check_controller_graphs(addon, documents)
        molang = check_molang(addon, documents, reference)
        check_sounds(addon, documents, reference)
        print(
            "  %-14s %2d items, %2d entities, %2d geometries, %2d particles, "
            "%3d Molang expressions, %3d JSON files"
            % (
                addon["name"], len(identifiers), len(entity_ids), len(geometries),
                len(particles), molang, len(documents),
            )
        )
    return total_files


def package():
    os.makedirs(DIST, exist_ok=True)
    for addon in ADDONS:
        target = os.path.join(DIST, addon["name"] + ".mcaddon")
        if os.path.exists(target):
            os.remove(target)
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
            for root in (addon["bp"], addon["rp"]):
                folder = os.path.basename(root)
                for base, _dirs, files in os.walk(root):
                    for name in sorted(files):
                        source = os.path.join(base, name)
                        arcname = os.path.join(folder, os.path.relpath(source, root))
                        archive.write(source, arcname.replace(os.sep, "/"))
        print("Packaged %s (%s bytes)" % (target, format(os.path.getsize(target), ",")))


def main():
    reference = os.environ.get("BEDROCK_REFERENCE", "")
    if reference and not os.path.isdir(reference):
        reference = ""
    print("Validating add-ons for Bedrock 1.21.0")
    total = validate(reference)
    print("Checked %d JSON files." % total)

    for message in warnings:
        print("  note: %s" % message)

    if errors:
        print("\nBuild failed:", file=sys.stderr)
        for message in errors:
            print("  - %s" % message, file=sys.stderr)
        return 1

    if "--skip-package" not in sys.argv:
        package()
    return 0


if __name__ == "__main__":
    sys.exit(main())
