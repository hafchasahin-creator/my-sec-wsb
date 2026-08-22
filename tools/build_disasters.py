#!/usr/bin/env python3
"""Validate and package the Natural Disasters add-on.

Compatibility gate for Minecraft Bedrock 1.21.0 (Beta 1.21.0.26):
  - every JSON file must parse and stay at or below its 1.21.0 format ceiling
  - manifests: unique UUIDs (also vs. the Arcane Arsenal packs in this repo),
    BP -> RP dependency, script entry on disk, @minecraft/server <= 1.11.0,
    min_engine_version <= 1.21.0
  - items: post-1.20.60 icon shape ({"textures": {"default": ...}}), icon key
    resolving through item_texture.json to a PNG on disk, and only components
    that are stable at 1.21.0
  - cross references: every nd: particle, nd. sound, nd: fog and nd: entity id
    used by scripts/main.js must be defined by the packs (and vice versa for
    sounds/particles so there are no dead assets)
  - client entity: geometry / animation / render controller / texture wiring
  - binary sanity: PNG signatures, RIFF/WAVE headers, 16-bit mono PCM
  - commands in main.js only reference hand-verified 1.21.0 vanilla ids

Then zips both packs into dist/NaturalDisasters.mcaddon.

Usage:  python3 tools/build_disasters.py
"""

import json
import os
import re
import struct
import sys
import zipfile

BP = os.path.join("behavior_packs", "natural_disasters_bp")
RP = os.path.join("resource_packs", "natural_disasters_rp")
OTHER_MANIFESTS = [
    os.path.join("behavior_packs", "arcane_arsenal_bp", "manifest.json"),
    os.path.join("resource_packs", "arcane_arsenal_rp", "manifest.json"),
]
DIST = "dist"
ADDON = os.path.join(DIST, "NaturalDisasters.mcaddon")

TARGET_ENGINE = (1, 21, 0)
MAX_SERVER_MODULE = (1, 11, 0)

# Item components that are stable on 1.21.0 (subset we allow ourselves).
ALLOWED_ITEM_COMPONENTS = {
    "minecraft:icon",
    "minecraft:display_name",
    "minecraft:max_stack_size",
    "minecraft:glint",
    "minecraft:can_destroy_in_creative",
    "minecraft:cooldown",
    "minecraft:tags",
    "minecraft:hand_equipped",
}

# Vanilla identifiers used from main.js, hand-checked to exist on 1.21.0.
VANILLA_BLOCKS = {
    "air", "water", "flowing_water", "lava", "magma", "obsidian", "fire",
    "sand", "ice", "snow_layer", "stone", "cobblestone", "blackstone", "tuff",
}
VANILLA_ENTITIES = {"tnt", "lightning_bolt"}
VANILLA_PARTICLES = {"minecraft:huge_explosion_emitter", "minecraft:lava_particle"}
VANILLA_SOUNDS = {"random.explode", "random.orb", "ambient.weather.thunder"}
VANILLA_EFFECTS = {"slowness", "weakness", "blindness"}

errors = []


def fail(message):
    errors.append(message)


def load_json(path):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except Exception as exc:  # noqa: BLE001
        fail(f"{path}: invalid JSON ({exc})")
        return None


def walk_files(root, suffix):
    for base, _dirs, files in os.walk(root):
        for name in sorted(files):
            if name.endswith(suffix):
                yield os.path.join(base, name)


def version_tuple(value):
    if isinstance(value, list):
        return tuple(int(part) for part in value)
    return tuple(int(part) for part in str(value).split("."))


def check_format_version(path, doc, ceiling):
    fv = doc.get("format_version")
    if fv is None:
        fail(f"{path}: missing format_version")
        return
    try:
        if version_tuple(fv) > ceiling:
            fail(f"{path}: format_version {fv} is newer than {'.'.join(map(str, ceiling))}")
    except (TypeError, ValueError):
        fail(f"{path}: unparseable format_version {fv!r}")


UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def validate_manifests(docs):
    bp = docs.get(os.path.join(BP, "manifest.json"))
    rp = docs.get(os.path.join(RP, "manifest.json"))
    if not bp or not rp:
        fail("missing a pack manifest")
        return

    uuids = []
    for path, manifest in ((BP, bp), (RP, rp)):
        header = manifest.get("header", {})
        uuids.append(header.get("uuid"))
        for module in manifest.get("modules", []):
            uuids.append(module.get("uuid"))
        engine = tuple(header.get("min_engine_version", [99]))
        if engine > TARGET_ENGINE:
            fail(f"{path}: min_engine_version {engine} exceeds {TARGET_ENGINE}")
        if manifest.get("format_version") != 2:
            fail(f"{path}: manifest format_version must be 2")

    for other in OTHER_MANIFESTS:
        if os.path.isfile(other):
            doc = load_json(other)
            if doc:
                uuids.append(doc["header"]["uuid"])
                uuids.extend(m["uuid"] for m in doc.get("modules", []))

    for u in uuids:
        if not u or not UUID_RE.match(u):
            fail(f"malformed UUID: {u!r}")
    duplicates = {u for u in uuids if uuids.count(u) > 1}
    if duplicates:
        fail(f"duplicate UUIDs across manifests: {sorted(duplicates)}")

    rp_uuid = rp["header"]["uuid"]
    dep_uuids = [d.get("uuid") for d in bp.get("dependencies", [])]
    if rp_uuid not in dep_uuids:
        fail(f"behaviour pack does not depend on resource pack {rp_uuid}")

    for dep in bp.get("dependencies", []):
        if dep.get("module_name") == "@minecraft/server":
            if version_tuple(dep.get("version", "99.0.0")) > MAX_SERVER_MODULE:
                fail(
                    f"@minecraft/server {dep['version']} is newer than "
                    f"{'.'.join(map(str, MAX_SERVER_MODULE))} (1.21.0.26 ceiling)"
                )
            break
    else:
        fail("behaviour pack does not declare the @minecraft/server dependency")

    for module in bp.get("modules", []):
        if module.get("type") == "script":
            if module.get("language") != "javascript":
                fail("script module must declare language: javascript")
            entry = os.path.join(BP, module.get("entry", ""))
            if not os.path.isfile(entry):
                fail(f"script entry not found: {entry}")


def validate_items(docs, atlas, script_text):
    identifiers = []
    for path, doc in docs.items():
        if not path.startswith(os.path.join(BP, "items")) or doc is None:
            continue
        check_format_version(path, doc, (1, 21, 0))
        item = doc.get("minecraft:item", {})
        desc = item.get("description", {})
        identifier = desc.get("identifier")
        if not identifier or not identifier.startswith("nd:"):
            fail(f"{path}: identifier {identifier!r} must be namespaced nd:")
            continue
        identifiers.append(identifier)
        if "menu_category" not in desc:
            fail(f"{path}: no menu_category - item would be invisible in creative")
        components = item.get("components", {})
        for name in components:
            if name not in ALLOWED_ITEM_COMPONENTS:
                fail(f"{path}: component {name} is not in the vetted 1.21.0 set")

        icon = components.get("minecraft:icon")
        if not isinstance(icon, dict) or "textures" not in icon:
            fail(f"{path}: minecraft:icon must use the textures/default shape on 1.21.0")
            continue
        key = icon["textures"].get("default")
        if key not in atlas:
            fail(f"{path}: icon '{key}' missing from item_texture.json")
            continue
        png = os.path.join(RP, atlas[key]["textures"] + ".png")
        if not os.path.isfile(png):
            fail(f"{path}: icon '{key}' points at missing file {png}")

        if f'"{identifier}"' not in script_text:
            fail(f"{path}: {identifier} has no handler in scripts/main.js")
    return identifiers


def validate_script_references(script_text, docs, item_identifiers):
    # Particles defined by the RP.
    defined_particles = set()
    for path, doc in docs.items():
        if path.startswith(os.path.join(RP, "particles")) and doc:
            check_format_version(path, doc, (1, 21, 0))
            ident = doc.get("particle_effect", {}).get("description", {}).get("identifier")
            if ident:
                defined_particles.add(ident)
            texture = (
                doc.get("particle_effect", {})
                .get("description", {})
                .get("basic_render_parameters", {})
                .get("texture")
            )
            if texture and not os.path.isfile(os.path.join(RP, texture + ".png")):
                fail(f"{path}: particle texture {texture}.png missing")

    used_particles = set(re.findall(r'"(nd:[a-z_]+)"', script_text))
    non_particles = set(item_identifiers) | {"nd:tornado", "nd:despawn"}
    used_particles = {
        p for p in used_particles
        if not p.startswith("nd:fog_") and p not in non_particles
    }
    for p in used_particles - defined_particles:
        fail(f"main.js uses particle {p} that the RP does not define")
    for p in defined_particles - used_particles:
        fail(f"RP defines particle {p} that main.js never uses")

    for p in re.findall(r'"(minecraft:[a-z_]+_(?:emitter|particle))"', script_text):
        if p not in VANILLA_PARTICLES:
            fail(f"main.js uses unverified vanilla particle {p}")

    # Sounds.
    sound_defs = docs.get(os.path.join(RP, "sounds", "sound_definitions.json"))
    defined_sounds = set()
    if sound_defs:
        for ident, entry in sound_defs.get("sound_definitions", {}).items():
            defined_sounds.add(ident)
            for s in entry.get("sounds", []):
                wav = os.path.join(RP, s["name"] + ".wav")
                if not os.path.isfile(wav):
                    fail(f"sound {ident}: missing file {wav}")
    else:
        fail("missing sounds/sound_definitions.json")

    used_sounds = set(re.findall(r'"(nd\.[a-z_]+)"', script_text))
    for s in used_sounds - defined_sounds:
        fail(f"main.js plays sound {s} that the RP does not define")
    for s in defined_sounds - used_sounds:
        fail(f"RP defines sound {s} that main.js never plays")
    for s in re.findall(r'"((?:random|ambient)\.[a-z.]+)"', script_text):
        if s not in VANILLA_SOUNDS:
            fail(f"main.js plays unverified vanilla sound {s}")

    # Effects.
    for e in re.findall(r'effect\([^,]+, "([a-z_]+)"', script_text):
        if e not in VANILLA_EFFECTS:
            fail(f"main.js applies unverified effect {e}")

    # Blocks and entities referenced from commands.
    for match in re.findall(r"(?:setblock|fill) [^`]*?`", script_text):
        pass  # commands are template strings; checked via the id scan below
    ids = re.findall(r"(?:setblock|fill) \$\{[^`]+?\} (?:\$\{[^`]+?\} )*([a-z_]+)", script_text)
    for block in re.findall(r"\} ([a-z_]+)(?: \[\])?(?:`| \[\] )", script_text):
        pass
    # Simpler and stricter: scan for the literal block word that follows the
    # final coordinate placeholder in every setblock/fill template.
    for cmdline in re.findall(r"`(?:setblock|fill)[^`]+`", script_text):
        words = re.findall(r"\}\s+([a-z_]+)", cmdline)
        for w in words:
            if w in ("replace",):
                continue
            if w not in VANILLA_BLOCKS:
                fail(f"main.js references unverified block '{w}' in {cmdline}")
        for w in re.findall(r"replace\s+([a-z_]+)", cmdline):
            if w not in VANILLA_BLOCKS:
                fail(f"main.js replace-filter references unverified block '{w}'")
    for cmdline in re.findall(r"`summon\s+([a-z_]+)", script_text):
        if cmdline not in VANILLA_ENTITIES:
            fail(f"main.js summons unverified entity '{cmdline}'")

    # Fogs.
    defined_fogs = set()
    for path, doc in docs.items():
        if path.startswith(os.path.join(RP, "fogs")) and doc:
            check_format_version(path, doc, (1, 21, 0))
            ident = doc.get("minecraft:fog_settings", {}).get("description", {}).get("identifier")
            if ident:
                defined_fogs.add(ident)
    for f in re.findall(r"fog @a push (nd:[a-z_]+)", script_text):
        if f not in defined_fogs:
            fail(f"main.js pushes fog {f} that the RP does not define")


def validate_entity_wiring(docs, script_text):
    bp_entity = docs.get(os.path.join(BP, "entities", "tornado.json"))
    if not bp_entity:
        fail("missing BP entity entities/tornado.json")
        return
    check_format_version(os.path.join(BP, "entities", "tornado.json"), bp_entity, (1, 21, 0))
    desc = bp_entity["minecraft:entity"]["description"]
    if desc.get("identifier") != "nd:tornado":
        fail("BP entity identifier must be nd:tornado")
    if desc.get("is_experimental"):
        fail("BP entity must not be experimental")
    events = bp_entity["minecraft:entity"].get("events", {})
    if "nd:despawn" not in events:
        fail("BP entity is missing the nd:despawn event used by main.js")

    client = docs.get(os.path.join(RP, "entity", "tornado.entity.json"))
    if not client:
        fail("missing RP client entity entity/tornado.entity.json")
        return
    cdesc = client["minecraft:client_entity"]["description"]
    if cdesc.get("identifier") != "nd:tornado":
        fail("client entity identifier must be nd:tornado")

    geo_name = cdesc["geometry"]["default"]
    geo_doc = docs.get(os.path.join(RP, "models", "entity", "tornado.geo.json"))
    geo_ids = [
        g["description"]["identifier"] for g in (geo_doc or {}).get("minecraft:geometry", [])
    ]
    if geo_name not in geo_ids:
        fail(f"client entity geometry {geo_name} not found in tornado.geo.json")

    anim_name = cdesc["animations"]["spin"]
    anim_doc = docs.get(os.path.join(RP, "animations", "tornado.animation.json"))
    if anim_name not in (anim_doc or {}).get("animations", {}):
        fail(f"client entity animation {anim_name} not found in tornado.animation.json")
    if geo_doc:
        bones = {b["name"] for g in geo_doc["minecraft:geometry"] for b in g["bones"]}
        for bone in (anim_doc or {}).get("animations", {}).get(anim_name, {}).get("bones", {}):
            if bone not in bones:
                fail(f"animation drives bone '{bone}' that the geometry does not have")

    rc_name = cdesc["render_controllers"][0]
    rc_doc = docs.get(os.path.join(RP, "render_controllers", "tornado.render_controllers.json"))
    if rc_name not in (rc_doc or {}).get("render_controllers", {}):
        fail(f"render controller {rc_name} not found")

    texture = cdesc["textures"]["default"]
    if not os.path.isfile(os.path.join(RP, texture + ".png")):
        fail(f"client entity texture {texture}.png missing")

    if '"nd:tornado"' not in script_text:
        fail("main.js never spawns nd:tornado")


def validate_binaries():
    for path in walk_files(BP, ".png"):
        with open(path, "rb") as handle:
            if handle.read(8) != b"\x89PNG\r\n\x1a\n":
                fail(f"{path}: not a PNG")
    for path in walk_files(RP, ".png"):
        with open(path, "rb") as handle:
            if handle.read(8) != b"\x89PNG\r\n\x1a\n":
                fail(f"{path}: not a PNG")
    for path in walk_files(RP, ".wav"):
        with open(path, "rb") as handle:
            head = handle.read(44)
        if head[:4] != b"RIFF" or head[8:12] != b"WAVE":
            fail(f"{path}: not a RIFF/WAVE file")
            continue
        channels, rate = struct.unpack("<HI", head[22:28])
        bits = struct.unpack("<H", head[34:36])[0]
        if (channels, bits) != (1, 16):
            fail(f"{path}: expected 16-bit mono PCM, got {bits}-bit {channels}ch")
        if rate not in (16000, 22050, 44100, 48000):
            fail(f"{path}: unusual sample rate {rate}")


def validate():
    docs = {}
    for root in (BP, RP):
        if not os.path.isdir(root):
            fail(f"missing pack directory: {root}")
            return []
        for path in walk_files(root, ".json"):
            if path.endswith(os.path.join("texts", "languages.json")):
                load_json(path)  # parse check only
                continue
            docs[path] = load_json(path)

    with open(os.path.join(BP, "scripts", "main.js"), encoding="utf-8") as handle:
        script_text = handle.read()

    validate_manifests(docs)

    atlas_doc = docs.get(os.path.join(RP, "textures", "item_texture.json")) or {}
    atlas = atlas_doc.get("texture_data", {})
    identifiers = validate_items(docs, atlas, script_text)
    if len(identifiers) != 11:
        fail(f"expected 11 disaster items, found {len(identifiers)}")

    # Every atlas entry must belong to an item.
    for key in atlas:
        if not any(f'"{key}"' in json.dumps(doc) for path, doc in docs.items()
                   if path.startswith(os.path.join(BP, "items")) and doc):
            fail(f"item_texture.json entry '{key}' is not used by any item")

    validate_script_references(script_text, docs, identifiers)
    validate_entity_wiring(docs, script_text)
    validate_binaries()

    # Language files must name every item.
    lang_path = os.path.join(RP, "texts", "en_US.lang")
    lang = ""
    if os.path.isfile(lang_path):
        with open(lang_path, encoding="utf-8") as handle:
            lang = handle.read()
    for identifier in identifiers:
        if f"item.{identifier}=" not in lang:
            fail(f"{lang_path}: no name entry for {identifier}")

    print(f"Validated {len(docs)} JSON files, {len(identifiers)} disaster items.")
    return identifiers


def package():
    os.makedirs(DIST, exist_ok=True)
    if os.path.exists(ADDON):
        os.remove(ADDON)
    with zipfile.ZipFile(ADDON, "w", zipfile.ZIP_DEFLATED) as archive:
        for root, folder in ((BP, "natural_disasters_bp"), (RP, "natural_disasters_rp")):
            for base, _dirs, files in os.walk(root):
                for name in sorted(files):
                    source = os.path.join(base, name)
                    arcname = os.path.join(folder, os.path.relpath(source, root)).replace(
                        os.sep, "/"
                    )
                    archive.write(source, arcname)
    # Sanity: both manifests must sit exactly one level deep.
    with zipfile.ZipFile(ADDON) as archive:
        names = archive.namelist()
        for wanted in ("natural_disasters_bp/manifest.json", "natural_disasters_rp/manifest.json"):
            if wanted not in names:
                fail(f"{ADDON}: {wanted} missing from archive")
        bad = archive.testzip()
        if bad:
            fail(f"{ADDON}: corrupt member {bad}")
    size = os.path.getsize(ADDON)
    print(f"Packaged {ADDON} ({size:,} bytes, {len(names)} files)")


if __name__ == "__main__":
    validate()
    if errors:
        print("\nBuild failed:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        sys.exit(1)
    package()
    if errors:
        print("\nPackaging problems:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        sys.exit(1)
