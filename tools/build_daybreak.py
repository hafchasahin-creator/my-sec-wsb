#!/usr/bin/env python3
"""Validate and package the Daybreak add-on.

The point of this script is that a broken reference should fail here, on a
laptop, rather than silently in Minecraft on a phone where the only symptom is
an invisible item or a mob that refuses to spawn. It checks, in order:

  * every JSON file parses
  * manifest UUIDs are unique - including against the other add-on in this
    repository, since both can be installed at once
  * the behaviour pack depends on the resource pack, and the script entry exists
  * every script import resolves to a real file
  * every item icon resolves item -> item_texture.json -> PNG on disk
  * every block texture resolves block -> terrain_texture.json -> PNG on disk
  * every behaviour entity has a client entity, and vice versa
  * client entities and attachables reference geometry, textures, animations,
    animation controllers and render controllers that actually exist
  * loot tables named by entities exist, and the items they drop exist
  * spawn rules and recipes point at real identifiers
  * every custom item, block and entity has a name in en_US.lang
  * every "daybreak:" identifier mentioned in scripts or functions is real

Then it writes dist/Daybreak.mcaddon with exactly two folders at the root - no
nested zip.

Usage:  python3 tools/build_daybreak.py
"""

import json
import os
import re
import sys
import zipfile

BP = os.path.join("behavior_packs", "daybreak_bp")
RP = os.path.join("resource_packs", "daybreak_rp")
OTHER_MANIFESTS = [
    os.path.join("behavior_packs", "arcane_arsenal_bp", "manifest.json"),
    os.path.join("resource_packs", "arcane_arsenal_rp", "manifest.json"),
]
DIST = "dist"
ADDON = os.path.join(DIST, "Daybreak.mcaddon")
NS = "daybreak"

# Identifiers that are events, families, tags, fog ids or script event names
# rather than items/blocks/entities.
KNOWN_NON_CONTENT = {
    f"{NS}:start", f"{NS}:give_items", f"{NS}:build", f"{NS}:spawn_facility",
    f"{NS}:reset", f"{NS}:status", f"{NS}:briefing",
    f"{NS}:reveal", f"{NS}:panic", f"{NS}:calm", f"{NS}:on_rescued",
    f"{NS}:burn_out", f"{NS}:spent", f"{NS}:disguised", f"{NS}:revealed",
    f"{NS}:rescued", f"{NS}:gear", f"{NS}:access_card", f"{NS}:protective",
}

errors = []
warnings = []


def fail(message):
    errors.append(message)


def warn(message):
    warnings.append(message)


def load_json(path):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except Exception as exc:  # noqa: BLE001
        fail(f"{path}: invalid JSON ({exc})")
        return None


def walk(root, suffix):
    for base, _dirs, files in os.walk(root):
        for name in sorted(files):
            if name.endswith(suffix):
                yield os.path.join(base, name)


def read(path):
    with open(path, encoding="utf-8") as handle:
        return handle.read()


class Packs:
    def __init__(self):
        self.json = {}
        for root in (BP, RP):
            if not os.path.isdir(root):
                fail(f"missing pack directory: {root}")
                continue
            for path in walk(root, ".json"):
                self.json[path] = load_json(path)

        self.items = {}        # identifier -> path
        self.blocks = {}
        self.bp_entities = {}
        self.rp_entities = {}
        self.geometries = set()
        self.animations = set()
        self.animation_controllers = set()
        self.render_controllers = set()
        self.fogs = set()
        self.index()

    def index(self):
        for path, doc in self.json.items():
            if doc is None:
                continue
            if path.startswith(os.path.join(BP, "items")):
                identifier = doc.get("minecraft:item", {}).get("description", {}).get("identifier")
                if identifier:
                    self.items[identifier] = path
            elif path.startswith(os.path.join(BP, "blocks")):
                identifier = doc.get("minecraft:block", {}).get("description", {}).get("identifier")
                if identifier:
                    self.blocks[identifier] = path
            elif path.startswith(os.path.join(BP, "entities")):
                identifier = doc.get("minecraft:entity", {}).get("description", {}).get("identifier")
                if identifier:
                    self.bp_entities[identifier] = path
            elif path.startswith(os.path.join(RP, "entity")):
                identifier = (doc.get("minecraft:client_entity", {})
                              .get("description", {}).get("identifier"))
                if identifier:
                    self.rp_entities[identifier] = path
            elif path.startswith(os.path.join(RP, "models")):
                for geometry in doc.get("minecraft:geometry", []):
                    identifier = geometry.get("description", {}).get("identifier")
                    if identifier:
                        self.geometries.add(identifier)
            elif path.startswith(os.path.join(RP, "animations")):
                self.animations.update(doc.get("animations", {}).keys())
            elif path.startswith(os.path.join(RP, "animation_controllers")):
                self.animation_controllers.update(doc.get("animation_controllers", {}).keys())
            elif path.startswith(os.path.join(RP, "render_controllers")):
                self.render_controllers.update(doc.get("render_controllers", {}).keys())
            elif path.startswith(os.path.join(RP, "fogs")):
                identifier = (doc.get("minecraft:fog_settings", {})
                              .get("description", {}).get("identifier"))
                if identifier:
                    self.fogs.add(identifier)

    def content_ids(self):
        return set(self.items) | set(self.blocks) | set(self.bp_entities)


def read_png(path):
    """Minimal PNG decode - returns (width, height, rows of RGBA tuples)."""
    import struct
    import zlib

    with open(path, "rb") as handle:
        blob = handle.read()
    if blob[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")

    offset = 8
    width = height = depth = colour = None
    data = b""
    while offset < len(blob):
        length, tag = struct.unpack(">I4s", blob[offset:offset + 8])
        payload = blob[offset + 8:offset + 8 + length]
        if tag == b"IHDR":
            width, height, depth, colour = struct.unpack(">IIBB", payload[:10])
        elif tag == b"IDAT":
            data += payload
        elif tag == b"IEND":
            break
        offset += 12 + length

    if depth != 8 or colour != 6:
        raise ValueError(f"unsupported PNG format (depth={depth}, colour={colour})")

    raw = zlib.decompress(data)
    stride = width * 4
    rows = []
    previous = bytearray(stride)
    position = 0
    for _ in range(height):
        filter_type = raw[position]
        position += 1
        line = bytearray(raw[position:position + stride])
        position += stride
        for index in range(stride):
            left = line[index - 4] if index >= 4 else 0
            up = previous[index]
            corner = previous[index - 4] if index >= 4 else 0
            if filter_type == 1:
                line[index] = (line[index] + left) & 0xFF
            elif filter_type == 2:
                line[index] = (line[index] + up) & 0xFF
            elif filter_type == 3:
                line[index] = (line[index] + (left + up) // 2) & 0xFF
            elif filter_type == 4:
                estimate = left + up - corner
                da, db, dc = (abs(estimate - left), abs(estimate - up), abs(estimate - corner))
                nearest = left if (da <= db and da <= dc) else (up if db <= dc else corner)
                line[index] = (line[index] + nearest) & 0xFF
        rows.append([tuple(line[i:i + 4]) for i in range(0, stride, 4)])
        previous = line
    return width, height, rows


def opaque_fraction(rows):
    total = sum(len(row) for row in rows)
    if total == 0:
        return 0.0
    drawn = sum(1 for row in rows for pixel in row if pixel[3] > 0)
    return drawn / total


def check_textures(packs):
    """Catch blank icons and skins that do not match their model's UV size."""
    for root in (BP, RP):
        icon = os.path.join(root, "pack_icon.png")
        if not os.path.isfile(icon):
            fail(f"missing {icon}")

    for path in sorted(walk(os.path.join(RP, "textures", "items"), ".png")):
        try:
            width, height, rows = read_png(path)
        except Exception as exc:  # noqa: BLE001
            fail(f"{path}: unreadable PNG ({exc})")
            continue
        if (width, height) != (16, 16):
            fail(f"{path}: item icons must be 16x16, found {width}x{height}")
        drawn = opaque_fraction(rows)
        if drawn < 0.12:
            fail(f"{path}: icon is {drawn:.0%} drawn - it will look blank in the hotbar")

    for path in sorted(walk(os.path.join(RP, "textures", "blocks"), ".png")):
        try:
            width, height, rows = read_png(path)
        except Exception as exc:  # noqa: BLE001
            fail(f"{path}: unreadable PNG ({exc})")
            continue
        if (width, height) != (16, 16):
            fail(f"{path}: block textures must be 16x16, found {width}x{height}")
        if opaque_fraction(rows) < 1.0:
            fail(f"{path}: opaque block texture has transparent pixels")

    # A skin painted at the wrong size makes a mob render with scrambled UVs.
    geometry_size = {}
    for path, doc in packs.json.items():
        if not path.startswith(os.path.join(RP, "models")):
            continue
        for geometry in doc.get("minecraft:geometry", []):
            description = geometry.get("description", {})
            geometry_size[description.get("identifier")] = (
                description.get("texture_width"), description.get("texture_height")
            )

    for identifier, path in sorted(packs.rp_entities.items()):
        description = packs.json[path]["minecraft:client_entity"]["description"]
        sizes = {
            geometry_size.get(geometry)
            for geometry in description.get("geometry", {}).values()
            if geometry in geometry_size
        }
        for name, texture in description.get("textures", {}).items():
            png = os.path.join(RP, texture + ".png")
            if not os.path.isfile(png):
                continue
            try:
                width, height, _rows = read_png(png)
            except Exception as exc:  # noqa: BLE001
                fail(f"{png}: unreadable PNG ({exc})")
                continue
            if sizes and (width, height) not in sizes:
                fail(f"{path}: texture '{name}' is {width}x{height} but its geometry "
                     f"declares {sorted(sizes)}")


def check_manifests(packs):
    bp_manifest = packs.json.get(os.path.join(BP, "manifest.json"))
    rp_manifest = packs.json.get(os.path.join(RP, "manifest.json"))
    if not bp_manifest or not rp_manifest:
        fail("missing a manifest")
        return

    uuids = []
    for manifest in (bp_manifest, rp_manifest):
        uuids.append(manifest["header"]["uuid"])
        uuids.extend(module["uuid"] for module in manifest["modules"])
    duplicates = {value for value in uuids if uuids.count(value) > 1}
    if duplicates:
        fail(f"duplicate UUIDs inside Daybreak: {sorted(duplicates)}")

    # Both add-ons can be installed side by side, so their UUIDs must differ.
    foreign = set()
    for path in OTHER_MANIFESTS:
        if not os.path.isfile(path):
            continue
        other = load_json(path)
        if not other:
            continue
        foreign.add(other["header"]["uuid"])
        foreign.update(module["uuid"] for module in other["modules"])
    clash = foreign.intersection(uuids)
    if clash:
        fail(f"UUID collision with the other add-on in this repo: {sorted(clash)}")

    rp_uuid = rp_manifest["header"]["uuid"]
    dependencies = [dep.get("uuid") for dep in bp_manifest.get("dependencies", [])]
    if rp_uuid not in dependencies:
        fail(f"behaviour pack does not depend on resource pack {rp_uuid}")

    server_dependency = [
        dep for dep in bp_manifest.get("dependencies", [])
        if dep.get("module_name") == "@minecraft/server"
    ]
    if not server_dependency:
        fail("behaviour pack does not declare an @minecraft/server dependency")
    elif server_dependency[0].get("version") != "1.11.0":
        warn(f"@minecraft/server pinned to {server_dependency[0].get('version')}, expected 1.11.0")

    for manifest, root in ((bp_manifest, BP), (rp_manifest, RP)):
        engine = manifest["header"].get("min_engine_version")
        if engine != [1, 21, 0]:
            warn(f"{root}: min_engine_version is {engine}, expected [1, 21, 0]")

    for module in bp_manifest["modules"]:
        if module["type"] == "script":
            entry = os.path.join(BP, module["entry"])
            if not os.path.isfile(entry):
                fail(f"script entry not found: {entry}")


def check_scripts():
    """Every relative import must resolve, and no stray TODO may ship."""
    script_dir = os.path.join(BP, "scripts")
    if not os.path.isdir(script_dir):
        fail("missing scripts directory")
        return {}

    sources = {path: read(path) for path in walk(script_dir, ".js")}
    for path, source in sources.items():
        for match in re.finditer(r'from\s+"(\./[^"]+)"', source):
            target = os.path.normpath(os.path.join(os.path.dirname(path), match.group(1)))
            if not os.path.isfile(target):
                fail(f"{path}: import '{match.group(1)}' does not resolve")
        for match in re.finditer(r'from\s+"(@minecraft/[^"]+)"', source):
            if match.group(1) != "@minecraft/server":
                fail(f"{path}: imports {match.group(1)}, which the manifest does not declare")
    return sources


def check_items(packs):
    atlas_path = os.path.join(RP, "textures", "item_texture.json")
    atlas = packs.json.get(atlas_path)
    if atlas is None:
        fail(f"missing {atlas_path}")
        return
    texture_data = atlas.get("texture_data", {})

    for identifier, path in sorted(packs.items.items()):
        doc = packs.json[path]
        item = doc["minecraft:item"]
        version = tuple(int(part) for part in str(doc.get("format_version", "0")).split("."))
        icon = item.get("components", {}).get("minecraft:icon")

        # The flat {"texture": ...} form is silently ignored from 1.20.60 on,
        # which shows up in game as a completely blank icon.
        if isinstance(icon, dict) and "texture" in icon and version >= (1, 20, 60):
            fail(f"{path}: minecraft:icon uses the deprecated flat 'texture' field")
            continue
        key = icon.get("textures", {}).get("default") if isinstance(icon, dict) else icon
        if not key:
            fail(f"{path}: no minecraft:icon texture")
            continue
        if key not in texture_data:
            fail(f"{path}: icon '{key}' missing from item_texture.json")
            continue
        png = os.path.join(RP, texture_data[key]["textures"] + ".png")
        if not os.path.isfile(png):
            fail(f"{path}: icon '{key}' points at missing file {png}")


def check_blocks(packs):
    atlas_path = os.path.join(RP, "textures", "terrain_texture.json")
    atlas = packs.json.get(atlas_path)
    if atlas is None:
        fail(f"missing {atlas_path}")
        return
    texture_data = atlas.get("texture_data", {})

    for identifier, path in sorted(packs.blocks.items()):
        components = packs.json[path]["minecraft:block"].get("components", {})
        instances = components.get("minecraft:material_instances", {})
        for face, spec in instances.items():
            key = spec.get("texture")
            if not key:
                fail(f"{path}: material instance '{face}' has no texture")
                continue
            if key not in texture_data:
                fail(f"{path}: texture '{key}' missing from terrain_texture.json")
                continue
            png = os.path.join(RP, texture_data[key]["textures"] + ".png")
            if not os.path.isfile(png):
                fail(f"{path}: texture '{key}' points at missing file {png}")


def check_entities(packs):
    for identifier, path in sorted(packs.bp_entities.items()):
        if identifier not in packs.rp_entities:
            fail(f"{path}: no client entity for {identifier}")

        entity = packs.json[path]["minecraft:entity"]
        groups = list(entity.get("component_groups", {}).values())
        for components in [entity.get("components", {})] + groups:
            loot = components.get("minecraft:loot", {}).get("table")
            if loot and not os.path.isfile(os.path.join(BP, loot)):
                fail(f"{path}: loot table not found: {loot}")

    for identifier, path in sorted(packs.rp_entities.items()):
        if identifier not in packs.bp_entities:
            fail(f"{path}: client entity {identifier} has no behaviour definition")

        description = packs.json[path]["minecraft:client_entity"]["description"]

        for name, texture in description.get("textures", {}).items():
            if not os.path.isfile(os.path.join(RP, texture + ".png")):
                fail(f"{path}: texture '{name}' -> {texture}.png not found")

        for name, geometry in description.get("geometry", {}).items():
            if geometry not in packs.geometries:
                fail(f"{path}: geometry '{name}' -> {geometry} is not defined")

        for name, animation in description.get("animations", {}).items():
            if animation.startswith("controller."):
                if animation not in packs.animation_controllers:
                    fail(f"{path}: animation controller {animation} is not defined")
            elif animation not in packs.animations:
                fail(f"{path}: animation {animation} is not defined")

        for controller in description.get("render_controllers", []):
            name = controller if isinstance(controller, str) else list(controller)[0]
            if name not in packs.render_controllers:
                fail(f"{path}: render controller {name} is not defined")

        # Anything the animation controller plays must exist on the entity.
        declared = set(description.get("animations", {}))
        for controller in description.get("animations", {}).values():
            if not controller.startswith("controller."):
                continue
            for doc_path, doc in packs.json.items():
                if not doc_path.startswith(os.path.join(RP, "animation_controllers")):
                    continue
                spec = doc.get("animation_controllers", {}).get(controller)
                if not spec:
                    continue
                for state in spec.get("states", {}).values():
                    for animation in state.get("animations", []):
                        name = animation if isinstance(animation, str) else list(animation)[0]
                        if name not in declared:
                            fail(f"{path}: {controller} plays '{name}', "
                                 f"which the entity does not declare")


def check_attachables(packs):
    for path in walk(os.path.join(RP, "attachables"), ".json"):
        doc = packs.json.get(path)
        if not doc:
            continue
        description = doc["minecraft:attachable"]["description"]
        identifier = description.get("identifier")
        if identifier not in packs.items:
            fail(f"{path}: attachable {identifier} has no matching item")
        for name, geometry in description.get("geometry", {}).items():
            if geometry not in packs.geometries:
                fail(f"{path}: geometry '{name}' -> {geometry} is not defined")
        for name, texture in description.get("textures", {}).items():
            if texture.startswith("textures/misc/"):
                continue  # vanilla glint
            if not os.path.isfile(os.path.join(RP, texture + ".png")):
                fail(f"{path}: texture '{name}' -> {texture}.png not found")
        for controller in description.get("render_controllers", []):
            name = controller if isinstance(controller, str) else list(controller)[0]
            if name not in packs.render_controllers:
                fail(f"{path}: render controller {name} is not defined")


def check_spawn_rules(packs):
    for path in walk(os.path.join(BP, "spawn_rules"), ".json"):
        doc = packs.json.get(path)
        if not doc:
            continue
        identifier = doc["minecraft:spawn_rules"]["description"]["identifier"]
        if identifier not in packs.bp_entities:
            fail(f"{path}: spawn rule for unknown entity {identifier}")


def check_recipes(packs):
    for path in walk(os.path.join(BP, "recipes"), ".json"):
        doc = packs.json.get(path)
        if not doc:
            continue
        recipe = doc.get("minecraft:recipe_shaped") or doc.get("minecraft:recipe_shapeless")
        if not recipe:
            fail(f"{path}: not a shaped or shapeless recipe")
            continue

        result = recipe.get("result", {})
        result_item = result.get("item") if isinstance(result, dict) else result
        if result_item and result_item.startswith(f"{NS}:"):
            if result_item not in packs.items and result_item not in packs.blocks:
                fail(f"{path}: result '{result_item}' has no definition")

        ingredients = []
        if "key" in recipe:
            ingredients = [entry.get("item") for entry in recipe["key"].values()]
            width = {len(row) for row in recipe.get("pattern", [])}
            if len(width) > 1:
                fail(f"{path}: pattern rows are not all the same length")
            symbols = {ch for row in recipe.get("pattern", []) for ch in row if ch != " "}
            missing = symbols - set(recipe["key"])
            if missing:
                fail(f"{path}: pattern uses undefined keys {sorted(missing)}")
        elif "ingredients" in recipe:
            ingredients = [entry.get("item") for entry in recipe["ingredients"]]

        for item in ingredients:
            if item and item.startswith(f"{NS}:") and item not in packs.items:
                fail(f"{path}: ingredient '{item}' has no definition")


def check_loot(packs):
    for path in walk(os.path.join(BP, "loot_tables"), ".json"):
        doc = packs.json.get(path)
        if not doc:
            continue
        for pool in doc.get("pools", []):
            for entry in pool.get("entries", []):
                name = entry.get("name")
                if entry.get("type") == "item" and name and name.startswith(f"{NS}:"):
                    if name not in packs.items and name not in packs.blocks:
                        fail(f"{path}: drops '{name}', which has no definition")


def check_lang(packs):
    lang_path = os.path.join(RP, "texts", "en_US.lang")
    if not os.path.isfile(lang_path):
        fail(f"missing {lang_path}")
        return
    lang = read(lang_path)

    for identifier in sorted(packs.items):
        if f"item.{identifier}=" not in lang:
            fail(f"{lang_path}: no name for item {identifier}")
    for identifier in sorted(packs.blocks):
        if f"tile.{identifier}.name=" not in lang:
            fail(f"{lang_path}: no name for block {identifier}")
    for identifier in sorted(packs.bp_entities):
        if f"entity.{identifier}.name=" not in lang:
            fail(f"{lang_path}: no name for entity {identifier}")
        spawnable = (packs.json[packs.bp_entities[identifier]]["minecraft:entity"]
                     ["description"].get("is_spawnable"))
        if spawnable and f"item.spawn_egg.entity.{identifier}.name=" not in lang:
            warn(f"{lang_path}: no spawn egg name for {identifier}")


def check_identifier_use(packs, sources):
    """Catch a typo in any daybreak: identifier used by scripts or functions."""
    known = packs.content_ids() | packs.fogs | KNOWN_NON_CONTENT
    pattern = re.compile(rf"{NS}:[a-z0-9_]+")

    targets = dict(sources)
    for path in walk(os.path.join(BP, "functions"), ".mcfunction"):
        targets[path] = read(path)

    for path, source in targets.items():
        # Template literals build ids as `${NS}:name`; normalise those first.
        text = source.replace("${NS}", NS)
        for identifier in sorted(set(pattern.findall(text))):
            if identifier not in known:
                fail(f"{path}: references unknown identifier '{identifier}'")


def check_function_targets(packs):
    """Any /function referenced from another function must exist."""
    root = os.path.join(BP, "functions")
    available = {
        os.path.relpath(path, root)[: -len(".mcfunction")].replace(os.sep, "/")
        for path in walk(root, ".mcfunction")
    }
    for path in walk(root, ".mcfunction"):
        for match in re.finditer(r"^\s*function\s+(\S+)", read(path), re.MULTILINE):
            if match.group(1) not in available:
                fail(f"{path}: calls missing function '{match.group(1)}'")
    return available


def check_no_experiments(packs):
    for path, doc in packs.json.items():
        if not isinstance(doc, dict):
            continue
        entity = doc.get("minecraft:entity")
        if entity and entity.get("description", {}).get("is_experimental"):
            fail(f"{path}: is_experimental is set - the pack must run without toggles")


def validate():
    packs = Packs()
    if errors:
        return packs
    check_manifests(packs)
    sources = check_scripts()
    check_items(packs)
    check_blocks(packs)
    check_entities(packs)
    check_attachables(packs)
    check_spawn_rules(packs)
    check_recipes(packs)
    check_loot(packs)
    check_lang(packs)
    check_textures(packs)
    check_identifier_use(packs, sources)
    functions = check_function_targets(packs)
    check_no_experiments(packs)

    print(
        f"Validated {len(packs.json)} JSON files: "
        f"{len(packs.items)} items, {len(packs.blocks)} blocks, "
        f"{len(packs.bp_entities)} entities, {len(packs.geometries)} models, "
        f"{len(functions)} functions, {len(sources)} scripts, "
        f"{len(list(walk(RP, '.png')))} textures."
    )
    return packs


def package():
    os.makedirs(DIST, exist_ok=True)
    if os.path.exists(ADDON):
        os.remove(ADDON)

    total = 0
    with zipfile.ZipFile(ADDON, "w", zipfile.ZIP_DEFLATED) as archive:
        for root, folder in ((BP, "daybreak_bp"), (RP, "daybreak_rp")):
            for base, _dirs, files in os.walk(root):
                for name in sorted(files):
                    source = os.path.join(base, name)
                    arcname = os.path.join(
                        folder, os.path.relpath(source, root)
                    ).replace(os.sep, "/")
                    archive.write(source, arcname)
                    total += 1

    # A .mcaddon must be a plain zip of pack folders. A zip inside the zip is
    # the classic import failure, so refuse to ship one.
    with zipfile.ZipFile(ADDON) as archive:
        names = archive.namelist()
        nested = [name for name in names if name.endswith((".zip", ".mcpack", ".mcaddon"))]
        if nested:
            fail(f"nested archive inside the .mcaddon: {nested}")
        roots = {name.split("/")[0] for name in names}
        if roots != {"daybreak_bp", "daybreak_rp"}:
            fail(f"unexpected top level entries in the .mcaddon: {sorted(roots)}")
        for required in ("daybreak_bp/manifest.json", "daybreak_rp/manifest.json"):
            if required not in names:
                fail(f"missing {required} in the .mcaddon")

    print(f"Packaged {ADDON} ({os.path.getsize(ADDON):,} bytes, {total} files)")


if __name__ == "__main__":
    validate()
    if not errors:
        package()

    for message in warnings:
        print(f"  warning: {message}")
    if errors:
        print("\nBuild failed:", file=sys.stderr)
        for message in errors:
            print(f"  - {message}", file=sys.stderr)
        sys.exit(1)
    print("OK")
