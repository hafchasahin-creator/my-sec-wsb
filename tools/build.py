#!/usr/bin/env python3
"""Validate and package every add-on in this repository.

Validation is the point of this script. A Bedrock pack almost never fails
loudly: a mistyped icon field, a geometry the client entity cannot find, or a
texture whose size does not match the model all produce a silent blank item or
an invisible mob in game, with nothing in chat to tell you why. Every check
here exists because that class of failure is expensive to debug on a phone.

Usage:
    python3 tools/build.py                # validate + package everything
    python3 tools/build.py Bloatgrub      # just one add-on
    python3 tools/build.py --check-only   # validate, do not write .mcaddon
"""

import json
import os
import re
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pixel import read_png_size  # noqa: E402

DIST = "dist"
TOOLS = os.path.dirname(os.path.abspath(__file__))
SOUND_IDS = os.path.join(TOOLS, "data", "vanilla_sound_ids.txt")
PARTICLE_IDS = os.path.join(TOOLS, "data", "vanilla_particle_ids.txt")


def vanilla_particle_ids():
    """({working}, {everything else})."""
    if not os.path.isfile(PARTICLE_IDS):
        return set(), set()
    working, other, bucket = set(), set(), None
    with open(PARTICLE_IDS, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if line == "[WORKING]":
                bucket = working
            elif line == "[OTHER]":
                bucket = other
            elif bucket is not None:
                bucket.add(line)
    return working, other


def vanilla_sound_ids():
    if not os.path.isfile(SOUND_IDS):
        return set()
    with open(SOUND_IDS, encoding="utf-8") as handle:
        return {
            line.strip()
            for line in handle
            if line.strip() and not line.startswith("#")
        }

ADDONS = [
    {
        "name": "ArcaneArsenal",
        "bp": os.path.join("behavior_packs", "arcane_arsenal_bp"),
        "rp": os.path.join("resource_packs", "arcane_arsenal_rp"),
        "output": os.path.join(DIST, "ArcaneArsenal.mcaddon"),
    },
    {
        "name": "Bloatgrub",
        "bp": os.path.join("behavior_packs", "bloatgrub_bp"),
        "rp": os.path.join("resource_packs", "bloatgrub_rp"),
        "output": os.path.join(DIST, "Bloatgrub.mcaddon"),
    },
]


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def walk_files(root, suffix):
    for base, _dirs, files in os.walk(root):
        for name in sorted(files):
            if name.endswith(suffix):
                yield os.path.join(base, name)


def _flatten_references(node):
    """Every string inside a render-controller field, however it is nested."""
    if node is None:
        return []
    if isinstance(node, str):
        return [node]
    if isinstance(node, list):
        return [ref for item in node for ref in _flatten_references(item)]
    if isinstance(node, dict):
        return [ref for item in node.values() for ref in _flatten_references(item)]
    return []


def version_tuple(value):
    try:
        return tuple(int(part) for part in str(value).split("."))
    except ValueError:
        return (0,)


class Addon:
    """Loads one behaviour/resource pack pair and checks it over."""

    def __init__(self, spec):
        self.name = spec["name"]
        self.bp = spec["bp"]
        self.rp = spec["rp"]
        self.output = spec["output"]
        self.errors = []
        self.documents = {}
        self.item_ids = []
        self.entity_ids = []
        self.extra_ids = set()  # entity events, component groups, item tags
        self.entity_events = set()

    # -- reporting ---------------------------------------------------------

    def fail(self, message):
        self.errors.append(message)

    def load_json(self, path):
        try:
            with open(path, encoding="utf-8") as handle:
                return json.load(handle)
        except Exception as exc:  # noqa: BLE001 - report and keep going
            self.fail(f"{path}: invalid JSON ({exc})")
            return None

    def doc(self, *parts):
        return self.documents.get(os.path.join(*parts))

    def docs_under(self, *parts):
        prefix = os.path.join(*parts)
        return {
            path: doc
            for path, doc in self.documents.items()
            if path.startswith(prefix + os.sep) and doc is not None
        }

    def lang_text(self):
        path = os.path.join(self.rp, "texts", "en_US.lang")
        if not os.path.isfile(path):
            return path, ""
        with open(path, encoding="utf-8") as handle:
            return path, handle.read()

    # -- checks ------------------------------------------------------------

    def read_all(self):
        for root in (self.bp, self.rp):
            if not os.path.isdir(root):
                self.fail(f"missing pack directory: {root}")
                continue
            for path in walk_files(root, ".json"):
                self.documents[path] = self.load_json(path)

    def check_manifests(self):
        bp_manifest = self.doc(self.bp, "manifest.json")
        rp_manifest = self.doc(self.rp, "manifest.json")
        if not bp_manifest or not rp_manifest:
            self.fail("cannot validate without both manifests")
            return []

        uuids = []
        for label, manifest in (("behaviour", bp_manifest), ("resource", rp_manifest)):
            header = manifest.get("header") or {}
            if not header.get("uuid"):
                self.fail(f"{label} pack manifest has no header.uuid")
            else:
                uuids.append(header["uuid"])
            modules = manifest.get("modules")
            if not isinstance(modules, list) or not modules:
                self.fail(f"{label} pack manifest has no modules")
                continue
            for index, module in enumerate(modules):
                if not isinstance(module, dict) or not module.get("uuid"):
                    self.fail(f"{label} pack manifest module {index} has no uuid")
                    continue
                uuids.append(module["uuid"])
        duplicates = {u for u in uuids if uuids.count(u) > 1}
        if duplicates:
            self.fail(f"duplicate UUIDs inside the add-on: {sorted(duplicates)}")

        rp_uuid = (rp_manifest.get("header") or {}).get("uuid")
        dependency_uuids = [d.get("uuid") for d in bp_manifest.get("dependencies", [])]
        if rp_uuid and rp_uuid not in dependency_uuids:
            self.fail(f"behaviour pack does not depend on resource pack {rp_uuid}")

        for module in bp_manifest.get("modules", []):
            if not isinstance(module, dict):
                continue
            if module["type"] != "script":
                continue
            entry = os.path.join(self.bp, module["entry"])
            if not os.path.isfile(entry):
                self.fail(f"script entry not found: {entry}")
            server = [
                d for d in bp_manifest.get("dependencies", [])
                if d.get("module_name") == "@minecraft/server"
            ]
            if not server:
                self.fail(
                    "behaviour pack declares a script module but no "
                    "@minecraft/server dependency"
                )

        for pack_root in (self.bp, self.rp):
            icon = os.path.join(pack_root, "pack_icon.png")
            if not os.path.isfile(icon):
                self.fail(f"missing {icon}")

        return uuids

    def check_items(self):
        atlas_path = os.path.join(self.rp, "textures", "item_texture.json")
        atlas = self.doc(self.rp, "textures", "item_texture.json")
        texture_data = (atlas or {}).get("texture_data", {})
        if atlas is None:
            self.fail(f"missing {atlas_path}")

        for path, doc in sorted(self.docs_under(self.bp, "items").items()):
            item = doc.get("minecraft:item", {})
            identifier = item.get("description", {}).get("identifier")
            if not identifier:
                self.fail(f"{path}: item has no identifier")
                continue
            self.item_ids.append(identifier)
            self.extra_ids.update(
                item.get("components", {}).get("minecraft:tags", {}).get("tags", [])
            )

            # minecraft:icon changed shape at format_version 1.20.60: the flat
            # "texture" string is deprecated and is silently ignored by the
            # game, which shows up in game as a completely blank icon.
            version = version_tuple(doc.get("format_version", "0"))
            icon = item.get("components", {}).get("minecraft:icon")
            if isinstance(icon, dict) and "texture" in icon and version >= (1, 20, 60):
                self.fail(
                    f"{path}: minecraft:icon uses the deprecated 'texture' field "
                    f"at format_version {doc['format_version']} - use "
                    f'{{"textures": {{"default": ...}}}} instead'
                )
                continue

            if isinstance(icon, dict):
                key = icon.get("textures", {}).get("default") or icon.get("texture")
            else:
                key = icon
            if not key:
                self.fail(f"{path}: no minecraft:icon texture")
                continue
            if key not in texture_data:
                self.fail(f"{path}: icon '{key}' missing from item_texture.json")
                continue
            # "textures" is a string or, for variant icons, a list of them.
            entry = texture_data[key]
            paths = entry.get("textures") if isinstance(entry, dict) else entry
            if isinstance(paths, str):
                paths = [paths]
            if not paths:
                self.fail(f"{path}: icon '{key}' has no texture path in item_texture.json")
                continue
            for texture in paths:
                png = os.path.join(self.rp, str(texture) + ".png")
                if not os.path.isfile(png):
                    self.fail(f"{path}: icon '{key}' points at missing file {png}")

    # An item with one of these already has a use action the client knows how
    # to offer, so it does not need an explicit touch button.
    VANILLA_USE_COMPONENTS = (
        "minecraft:food",
        "minecraft:throwable",
        "minecraft:shooter",
        "minecraft:projectile",
        "minecraft:block_placer",
        "minecraft:entity_placer",
        "minecraft:record",
        "minecraft:bundle_interaction",
    )

    def check_touch_controls(self):
        """The works-on-PC-dead-on-phone bug.

        A custom item with no vanilla use behaviour and no
        minecraft:interact_button gives touch players no on-screen use button.
        They then have no input that can generate a use action at all, so
        world.afterEvents.itemUse never fires for them - while the very same
        pack works fine with a mouse. Nothing is logged either way.
        """
        _lang_path, lang = self.lang_text()

        for path, doc in sorted(self.docs_under(self.bp, "items").items()):
            item = doc.get("minecraft:item", {})
            components = item.get("components", {})
            identifier = item.get("description", {}).get("identifier", path)

            button = components.get("minecraft:interact_button")
            usable = "minecraft:use_modifiers" in components
            vanilla_use = any(c in components for c in self.VANILLA_USE_COMPONENTS)

            if usable and button is None and not vanilla_use:
                self.fail(
                    f"{path}: {identifier} has minecraft:use_modifiers but no "
                    "minecraft:interact_button, so touch players get no use "
                    "button and itemUse never fires for them"
                )
            if isinstance(button, str) and f"{button}=" not in lang:
                self.fail(
                    f"{path}: interact_button label '{button}' has no entry in "
                    "the resource pack's en_US.lang, so the button would show "
                    "the raw key"
                )

    CRAFTING_TAGS = frozenset({
        "crafting_table", "stonecutter", "smithing_table", "furnace",
        "blast_furnace", "smoker", "campfire", "soul_campfire",
        "brewing_stand", "material_reducer",
    })

    def check_recipes(self):
        for path, doc in sorted(self.docs_under(self.bp, "recipes").items()):
            shaped = doc.get("minecraft:recipe_shaped")
            recipe = shaped or doc.get("minecraft:recipe_shapeless") or {}

            # Without a station tag the recipe loads and is craftable nowhere.
            tags = recipe.get("tags")
            if not tags:
                self.fail(f"{path}: no crafting station in \"tags\"")
            else:
                unknown = sorted(set(tags) - self.CRAFTING_TAGS)
                if unknown:
                    self.fail(f"{path}: unknown crafting station tag(s) {unknown}")

            if shaped:
                pattern = shaped.get("pattern") or []
                key = shaped.get("key") or {}
                if not 1 <= len(pattern) <= 3:
                    self.fail(f"{path}: pattern has {len(pattern)} rows, must be 1-3")
                widths = {len(row) for row in pattern}
                if len(widths) > 1:
                    self.fail(f"{path}: pattern rows are ragged: {pattern}")
                if widths and max(widths) > 3:
                    self.fail(f"{path}: pattern is {max(widths)} columns wide, max 3")
                used = {ch for row in pattern for ch in row} - {" "}
                for ch in sorted(used - set(key)):
                    self.fail(
                        f"{path}: pattern uses '{ch}' but \"key\" does not define it, "
                        "so the recipe will not load"
                    )
                for ch in sorted(set(key) - used):
                    self.fail(f"{path}: \"key\" defines '{ch}' but the pattern never uses it")

            result = recipe.get("result", {})
            result_item = result.get("item") if isinstance(result, dict) else result
            if result_item and not result_item.startswith("minecraft:"):
                if result_item not in self.item_ids:
                    self.fail(f"{path}: result '{result_item}' has no item definition")

            # Ingredients from our own namespaces must exist too.
            ingredients = []
            for entry in recipe.get("key", {}).values():
                ingredients.append(entry.get("item") if isinstance(entry, dict) else entry)
            raw = recipe.get("ingredients", [])
            if isinstance(raw, list):
                for entry in raw:
                    ingredients.append(
                        entry.get("item") if isinstance(entry, dict) else entry
                    )
            for ingredient in ingredients:
                if not ingredient or ingredient.startswith("minecraft:"):
                    continue
                if ingredient not in self.item_ids:
                    self.fail(f"{path}: ingredient '{ingredient}' has no item definition")

    def check_loot_tables(self):
        """A typo in a loot entry drops nothing, and reports nothing.

        check_entities only proves the file the entity points at exists. This
        opens it and resolves every identifier inside, the same way recipes
        are resolved.
        """
        def walk(node, path):
            if isinstance(node, list):
                for item in node:
                    walk(item, path)
                return
            if not isinstance(node, dict):
                return

            kind = node.get("type")
            name = node.get("name")
            if name and isinstance(name, str):
                if kind == "loot_table":
                    if not os.path.isfile(os.path.join(self.bp, name)):
                        self.fail(f"{path}: nested loot table '{name}' does not exist")
                elif not name.startswith("minecraft:"):
                    if name not in self.item_ids and name not in self.entity_ids:
                        self.fail(
                            f"{path}: loot entry '{name}' has no item or entity "
                            "definition, so this drops nothing"
                        )
            for value in ("item", "entity"):
                target = node.get(value)
                if isinstance(target, str) and not target.startswith("minecraft:"):
                    if target not in self.item_ids and target not in self.entity_ids:
                        self.fail(f"{path}: loot references undefined '{target}'")

            for value in node.values():
                if isinstance(value, (dict, list)):
                    walk(value, path)

        for path, doc in sorted(self.docs_under(self.bp, "loot_tables").items()):
            if "format_version" in doc:
                self.fail(
                    f"{path}: loot tables carry no format_version - none of the "
                    "vanilla 1.21.0 tables have one"
                )
            walk(doc.get("pools", []), path)

    def check_entities(self):
        """The expensive-to-debug half: a custom mob that renders as nothing."""
        server_entities = {}
        for path, doc in sorted(self.docs_under(self.bp, "entities").items()):
            description = doc.get("minecraft:entity", {}).get("description", {})
            identifier = description.get("identifier")
            if not identifier:
                self.fail(f"{path}: entity has no identifier")
                continue
            server_entities[identifier] = (path, doc)
            self.entity_ids.append(identifier)
            entity = doc.get("minecraft:entity", {})
            self.extra_ids.update(entity.get("events", {}).keys())
            self.entity_events.update(entity.get("events", {}).keys())
            self.extra_ids.update(entity.get("component_groups", {}).keys())
            families = (
                entity.get("components", {})
                .get("minecraft:type_family", {})
                .get("family", [])
            )
            self.extra_ids.update(families)

        client_entities = {}
        for path, doc in sorted(self.docs_under(self.rp, "entity").items()):
            description = doc.get("minecraft:client_entity", {}).get("description", {})
            identifier = description.get("identifier")
            if not identifier:
                self.fail(f"{path}: client entity has no identifier")
                continue
            client_entities[identifier] = (path, description)

        for identifier, (path, _doc) in server_entities.items():
            if identifier not in client_entities:
                self.fail(
                    f"{path}: no resource-pack client entity for '{identifier}' - "
                    "the mob would spawn invisible"
                )
        for identifier, (path, _desc) in client_entities.items():
            if identifier not in server_entities:
                self.fail(f"{path}: client entity '{identifier}' has no behaviour entity")

        geometries = self.collect_geometries()
        animations = self.collect_animations()
        controllers = self.collect_render_controllers()

        for identifier, (path, description) in client_entities.items():
            self.check_client_entity(path, description, geometries, animations, controllers)

        # Loot tables and spawn rules referenced by the behaviour entities.
        for identifier, (path, doc) in server_entities.items():
            components = doc.get("minecraft:entity", {}).get("components", {})
            loot = components.get("minecraft:loot", {}).get("table")
            if loot and not os.path.isfile(os.path.join(self.bp, loot)):
                self.fail(f"{path}: minecraft:loot points at missing {loot}")

        for path, doc in sorted(self.docs_under(self.bp, "spawn_rules").items()):
            identifier = (
                doc.get("minecraft:spawn_rules", {})
                .get("description", {})
                .get("identifier")
            )
            if identifier and identifier not in server_entities:
                self.fail(f"{path}: spawn rules for unknown entity '{identifier}'")

        # Names, so nothing shows up as a raw identifier on the HUD.
        lang_path, lang = self.lang_text()
        for identifier in self.entity_ids:
            if f"entity.{identifier}.name=" not in lang:
                self.fail(f"{lang_path}: no name entry for entity {identifier}")
            spawnable = (
                server_entities[identifier][1]
                .get("minecraft:entity", {})
                .get("description", {})
                .get("is_spawnable")
            )
            key = f"item.spawn_egg.entity.{identifier}.name="
            if spawnable and key not in lang:
                self.fail(f"{lang_path}: no spawn egg name for {identifier}")

    def collect_geometries(self):
        """{geometry id: (path, description, bone names)}."""
        found = {}
        for path in sorted(walk_files(os.path.join(self.rp, "models"), ".json")):
            doc = self.documents.get(path)
            if doc is None:
                continue
            for entry in doc.get("minecraft:geometry", []):
                description = entry.get("description", {})
                identifier = description.get("identifier")
                if not identifier:
                    self.fail(f"{path}: geometry with no identifier")
                    continue
                bones = {bone.get("name") for bone in entry.get("bones", [])}
                found[identifier] = (path, description, bones)
                self.check_geometry(path, entry)
        return found

    def check_geometry(self, path, entry):
        description = entry.get("description", {})
        width = description.get("texture_width")
        height = description.get("texture_height")
        if not width or not height:
            self.fail(f"{path}: geometry is missing texture_width/texture_height")
            return

        bone_names = {bone.get("name") for bone in entry.get("bones", [])}
        rects = []
        for bone in entry.get("bones", []):
            parent = bone.get("parent")
            if parent and parent not in bone_names:
                self.fail(
                    f"{path}: bone '{bone.get('name')}' has unknown parent '{parent}'"
                )
            for cube in bone.get("cubes", []):
                size = cube.get("size")
                uv = cube.get("uv")
                if not isinstance(uv, list):
                    continue  # per-face UV, nothing to box-check
                if not size or len(size) != 3:
                    self.fail(f"{path}: cube in '{bone.get('name')}' has no size")
                    continue
                if any(float(value) != int(value) for value in size):
                    self.fail(
                        f"{path}: cube in '{bone.get('name')}' has non-integer size "
                        f"{size}; box UV would land between texture pixels"
                    )
                    continue
                sx, sy, sz = (int(value) for value in size)
                u, v = int(uv[0]), int(uv[1])
                rect = (u, v, 2 * (sx + sz), sz + sy)
                if u + rect[2] > width or v + rect[3] > height:
                    self.fail(
                        f"{path}: cube in '{bone.get('name')}' at uv {uv} size {size} "
                        f"runs off the {width}x{height} texture"
                    )
                mirrored = bool(cube.get("mirror", bone.get("mirror", False)))
                rects.append((bone.get("name"), rect, mirrored))

        # Two cubes sharing texture pixels is how a model ends up wearing the
        # wrong skin in one place and looking fine everywhere else - EXCEPT
        # when a left/right pair deliberately shares one unwrap with "mirror".
        # That is Mojang's own convention: geometry.humanoid gives rightArm and
        # leftArm the same uv [40,16]. Only partial overlap is ever a bug.
        for i in range(len(rects)):
            name_a, rect_a, mirror_a = rects[i]
            for j in range(i + 1, len(rects)):
                name_b, rect_b, mirror_b = rects[j]
                ax, ay, aw, ah = rect_a
                bx, by, bw, bh = rect_b
                if not (ax < bx + bw and bx < ax + aw and ay < by + bh and by < ay + ah):
                    continue
                if rect_a == rect_b and (mirror_a or mirror_b):
                    continue  # the mirrored-pair idiom
                self.fail(
                    f"{path}: UV footprints of '{name_a}' and '{name_b}' overlap"
                )

    def collect_animations(self):
        """{animation name: (path, bone names it drives)}."""
        found = {}
        anim_dir = os.path.join(self.rp, "animations")
        for path in sorted(walk_files(anim_dir, ".json")):
            doc = self.documents.get(path)
            if doc is None:
                continue
            for name, body in doc.get("animations", {}).items():
                found[name] = (path, set(body.get("bones", {}).keys()))
        return found

    def collect_render_controllers(self):
        """{controller name: {"geometry"|"textures"|"materials": {slot names}}}."""
        found = {}
        controller_dir = os.path.join(self.rp, "render_controllers")
        for path in sorted(walk_files(controller_dir, ".json")):
            doc = self.documents.get(path)
            if doc is None:
                continue
            for name, body in doc.get("render_controllers", {}).items():
                slots = {"geometry": set(), "textures": set(), "materials": set()}
                for field, prefix in (
                    ("geometry", "Geometry."),
                    ("textures", "Texture."),
                    ("materials", "Material."),
                ):
                    for reference in _flatten_references(body.get(field)):
                        if not reference.startswith(prefix):
                            continue
                        slot = reference[len(prefix):]
                        # Molang-driven slot names cannot be resolved statically.
                        if any(ch in slot for ch in "()+ '\""):
                            continue
                        slots[field].add(slot)
                found[name] = slots
        return found

    def check_client_entity(self, path, description, geometries, animations, controllers):
        identifier = description.get("identifier")

        declared = {
            "geometry": set(description.get("geometry", {})),
            "textures": set(description.get("textures", {})),
            "materials": set(description.get("materials", {})),
        }
        for controller in description.get("render_controllers", []):
            key = controller if isinstance(controller, str) else next(iter(controller))
            if key not in controllers:
                self.fail(f"{path}: unknown render controller '{key}'")
                continue
            # A controller asking for Texture.default when the client entity
            # only declares "skin" renders the mob untextured, in silence.
            prefixes = {
                "geometry": "Geometry",
                "textures": "Texture",
                "materials": "Material",
            }
            for field, slots in controllers[key].items():
                for slot in sorted(slots - declared[field]):
                    self.fail(
                        f"{path}: render controller '{key}' asks for "
                        f"{prefixes[field]}.{slot}, but {identifier} declares no "
                        f"'{slot}' in its {field} block"
                    )

        if not description.get("materials"):
            self.fail(f"{path}: {identifier} declares no materials")

        for key, texture in description.get("textures", {}).items():
            png = os.path.join(self.rp, texture + ".png")
            if not os.path.isfile(png):
                self.fail(f"{path}: texture '{key}' points at missing file {png}")

        geometry_ids = description.get("geometry", {})
        for key, geometry_id in geometry_ids.items():
            if geometry_id not in geometries:
                self.fail(
                    f"{path}: geometry '{geometry_id}' (slot '{key}') is not defined "
                    "in any models/ file - the mob renders as nothing"
                )
                continue

            geo_path, geo_description, _bones = geometries[geometry_id]
            texture = description.get("textures", {}).get(key) or description.get(
                "textures", {}
            ).get("default")
            if not texture:
                self.fail(
                    f"{path}: geometry slot '{key}' has no matching texture and "
                    "there is no 'default' to fall back on"
                )
                continue
            png = os.path.join(self.rp, texture + ".png")
            if not os.path.isfile(png):
                continue
            try:
                actual = read_png_size(png)
            except ValueError as exc:
                self.fail(str(exc))
                continue
            declared = (
                geo_description.get("texture_width"),
                geo_description.get("texture_height"),
            )
            if declared != actual:
                self.fail(
                    f"{geo_path}: {geometry_id} declares a "
                    f"{declared[0]}x{declared[1]} texture but {png} is "
                    f"{actual[0]}x{actual[1]} - every UV would be misaligned"
                )

        model_bones = set()
        for geometry_id in geometry_ids.values():
            if geometry_id in geometries:
                model_bones |= geometries[geometry_id][2]

        for key, animation in description.get("animations", {}).items():
            if animation.startswith("controller."):
                continue
            if animation not in animations:
                self.fail(f"{path}: animation '{animation}' (slot '{key}') is not defined")
                continue
            anim_path, anim_bones = animations[animation]
            missing = sorted(anim_bones - model_bones)
            if missing and model_bones:
                self.fail(
                    f"{anim_path}: {animation} animates bones the model does not "
                    f"have: {missing}"
                )

        # Anything listed in scripts.animate has to resolve to a declared slot.
        declared_slots = set(description.get("animations", {}).keys())
        for entry in description.get("scripts", {}).get("animate", []):
            slot = entry if isinstance(entry, str) else next(iter(entry))
            if slot not in declared_slots:
                self.fail(
                    f"{path}: scripts.animate refers to '{slot}', which is not in "
                    "the animations block"
                )

    def check_script_ids(self):
        """Catch a namespaced id in the script that nothing in the pack defines.

        A typo here is invisible: the script loads, the handler runs, and the
        branch it guards simply never fires. There is no error anywhere.
        """
        manifest = self.doc(self.bp, "manifest.json") or {}
        entries = [
            module["entry"]
            for module in manifest.get("modules", [])
            if module.get("type") == "script" and module.get("entry")
        ]

        known = set(self.item_ids) | set(self.entity_ids) | self.extra_ids
        pattern = re.compile(r"""["'`]([a-z][a-z0-9_]*):([a-z0-9_./-]+)["'`]""")

        for entry in entries:
            path = os.path.join(self.bp, entry)
            if not os.path.isfile(path):
                continue
            with open(path, encoding="utf-8") as handle:
                source = handle.read()

            # triggerEvent takes an entity EVENT, and nothing else. Without
            # this, passing the component-group name instead of the event that
            # adds it - grub:enraged for grub:enrage - looks like a valid id
            # and does nothing at all in game.
            for match in re.finditer(
                r"""triggerEvent\(\s*["'`]([^"'`]+)["'`]""", source
            ):
                name = match.group(1)
                if name in self.entity_events:
                    continue
                line = source.count("\n", 0, match.start()) + 1
                known_events = sorted(self.entity_events) or ["<none defined>"]
                self.fail(
                    f"{path}:{line}: triggerEvent('{name}') - no entity in this "
                    f"pack defines that event (defined: {known_events})"
                )

            seen = set()
            for match in pattern.finditer(source):
                namespace, name = match.groups()
                # Vanilla ids and module specifiers are somebody else's problem.
                if namespace in ("minecraft", "http", "https"):
                    continue
                identifier = f"{namespace}:{name}"
                if identifier in known or identifier in seen:
                    continue
                seen.add(identifier)
                line = source.count("\n", 0, match.start()) + 1
                self.fail(
                    f"{path}:{line}: script refers to '{identifier}', which no "
                    "item, entity, entity event, component group or tag in this "
                    "pack defines"
                )

    # Dotted lowercase ids in a behaviour script are, in practice, sound
    # events. Anything here that is genuinely not one goes in this set.
    NOT_SOUND_IDS = frozenset()

    def check_sound_ids(self):
        """Catch a sound id the engine does not know.

        playSound with an unknown id neither throws nor logs - it just plays
        nothing - so a typo silently deletes an effect and no amount of testing
        in game will tell you which one, or that there was one.
        """
        known = vanilla_sound_ids()
        if not known:
            return  # no reference list checked in; skip rather than guess

        manifest = self.doc(self.bp, "manifest.json") or {}
        entries = [
            module["entry"]
            for module in manifest.get("modules", [])
            if module.get("type") == "script" and module.get("entry")
        ]
        pattern = re.compile(r"""["'`]([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)["'`]""")

        for entry in entries:
            path = os.path.join(self.bp, entry)
            if not os.path.isfile(path):
                continue
            with open(path, encoding="utf-8") as handle:
                source = handle.read()

            reported = set()
            for match in pattern.finditer(source):
                sound = match.group(1)
                if sound in known or sound in self.NOT_SOUND_IDS:
                    continue
                if sound in reported:
                    continue
                reported.add(sound)

                stem = sound.split(".")[1] if "." in sound else sound
                near = sorted(k for k in known if stem and stem in k)[:4]
                hint = f" did you mean {near}?" if near else ""
                line = source.count("\n", 0, match.start()) + 1
                self.fail(
                    f"{path}:{line}: '{sound}' is not a Bedrock 1.21.0 sound "
                    f"event, so it would play nothing, silently.{hint}"
                )

    # Particles this project has verified as spawnable despite the reference
    # list saying otherwise. Add with a note, not on a hunch.
    EXTRA_WORKING_PARTICLES = frozenset()

    def check_particle_ids(self):
        """Catch a particle that renders nothing when spawned standalone.

        Two failure modes look identical in game: an id that does not exist,
        and an id that exists but needs Molang context from a host entity.
        Neither reports anything - the effect is simply not there.
        """
        working, other = vanilla_particle_ids()
        if not working:
            return

        manifest = self.doc(self.bp, "manifest.json") or {}
        entries = [
            module["entry"]
            for module in manifest.get("modules", [])
            if module.get("type") == "script" and module.get("entry")
        ]
        pattern = re.compile(r"""["'`]minecraft:([a-z0-9_]+)["'`]""")

        for entry in entries:
            path = os.path.join(self.bp, entry)
            if not os.path.isfile(path):
                continue
            with open(path, encoding="utf-8") as handle:
                source = handle.read()

            reported = set()
            for match in pattern.finditer(source):
                name = match.group(1)
                # Only ids that look like particles; component and entity ids
                # under the minecraft namespace are checked elsewhere.
                if not (name.endswith("_particle") or name.endswith("_emitter")
                        or name in other or name in working):
                    continue
                if name in working or name in self.EXTRA_WORKING_PARTICLES:
                    continue
                if name in reported:
                    continue
                reported.add(name)

                line = source.count("\n", 0, match.start()) + 1
                why = (
                    "needs Molang context from a host entity, so it renders "
                    "nothing when spawned on its own"
                    if name in other
                    else "is not a vanilla Bedrock particle"
                )
                self.fail(f"{path}:{line}: 'minecraft:{name}' {why}")

    def check_item_icon_sizes(self):
        for path in sorted(walk_files(os.path.join(self.rp, "textures", "items"), ".png")):
            try:
                width, height = read_png_size(path)
            except ValueError as exc:
                self.fail(str(exc))
                continue
            if width != height:
                self.fail(f"{path}: item icons must be square, got {width}x{height}")

    def check_item_names(self):
        lang_path, lang = self.lang_text()
        for identifier in self.item_ids:
            if f"item.{identifier}=" not in lang:
                self.fail(f"{lang_path}: no name entry for {identifier}")

    def validate(self):
        self.read_all()
        uuids = self.check_manifests()
        if self.errors and not self.documents:
            return uuids
        self.check_items()
        self.check_touch_controls()
        self.check_recipes()
        self.check_entities()
        self.check_loot_tables()
        self.check_script_ids()
        self.check_sound_ids()
        self.check_particle_ids()
        self.check_item_icon_sizes()
        self.check_item_names()
        return uuids

    # -- packaging ---------------------------------------------------------

    def package(self):
        os.makedirs(os.path.dirname(self.output) or ".", exist_ok=True)
        if os.path.exists(self.output):
            os.remove(self.output)

        with zipfile.ZipFile(self.output, "w", zipfile.ZIP_DEFLATED) as archive:
            for root in (self.bp, self.rp):
                folder = os.path.basename(root)
                for base, _dirs, files in os.walk(root):
                    for name in sorted(files):
                        source = os.path.join(base, name)
                        arcname = os.path.join(
                            folder, os.path.relpath(source, root)
                        ).replace(os.sep, "/")
                        archive.write(source, arcname)
        return os.path.getsize(self.output)


def main():
    argv = [a for a in sys.argv[1:] if not a.startswith("-")]
    check_only = "--check-only" in sys.argv

    selected = [a for a in ADDONS if not argv or a["name"] in argv]
    unknown = set(argv) - {a["name"] for a in ADDONS}
    if unknown:
        print(f"unknown add-on(s): {sorted(unknown)}", file=sys.stderr)
        return 2

    all_uuids = []
    failed = False
    for spec in selected:
        addon = Addon(spec)
        all_uuids.extend(addon.validate())

        if addon.errors:
            failed = True
            print(f"\n{addon.name}: FAILED", file=sys.stderr)
            for error in addon.errors:
                print(f"  - {error}", file=sys.stderr)
            continue

        summary = (
            f"{addon.name}: {len(addon.documents)} JSON files, "
            f"{len(addon.item_ids)} items, {len(addon.entity_ids)} entities"
        )
        if check_only:
            print(f"{summary} - OK")
        else:
            size = addon.package()
            print(f"{summary} -> {addon.output} ({size:,} bytes)")

    # Two add-ons sharing a UUID means installing one uninstalls the other.
    if len(selected) == len(ADDONS):
        clashes = {u for u in all_uuids if all_uuids.count(u) > 1}
        if clashes:
            print(f"\nUUID collision across add-ons: {sorted(clashes)}", file=sys.stderr)
            failed = True

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
