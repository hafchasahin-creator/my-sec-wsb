#!/usr/bin/env python3
"""Validate and package Magical Swords.

Validation is deliberately paranoid: every cross-file reference that could
produce a silent in-game failure (blank icon, missing particle, dead sound,
unbound attachable) is walked end-to-end:

  item -> icon key -> item_texture.json -> png
  item <-> attachable identifier
  attachable -> geometry / animations / controllers / render controllers
  attachable textures -> png files (vanilla paths exempt)
  animation particle shortnames -> attachable particle_effects -> particle json
  animation locators -> geometry locators
  particle json -> sprite png, known material
  main.js particle/sound/item ids -> pack definitions (custom) or the vanilla
      1.21.0.3 resource pack (if a bedrock-samples checkout is available)
  recipes -> item ids (custom + vanilla item list from bedrock-samples)
  sound_definitions -> ogg files on disk

Then zips both packs into dist/MagicalSwords.mcaddon.

Usage:  python3 tools/build_ms.py
"""

import json
import os
import re
import sys
import zipfile

BP = os.path.join("behavior_packs", "magical_swords_bp")
RP = os.path.join("resource_packs", "magical_swords_rp")
DIST = "dist"
ADDON = os.path.join(DIST, "MagicalSwords.mcaddon")
VANILLA = os.path.join("/home/user/mojang/bedrock-samples")

KNOWN_PARTICLE_MATERIALS = {"particles_alpha", "particles_blend", "particles_opaque"}
KNOWN_ATTACHABLE_MATERIALS = {
    "entity_alphatest",
    "entity_emissive",
    "entity_emissive_alpha",
    "entity_alphatest_glint",
}

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


def walk_json(root):
    for base, _dirs, files in os.walk(root):
        for name in sorted(files):
            if name.endswith(".json"):
                yield os.path.join(base, name)


def load_json_lenient(path):
    """Vanilla files are JSON-with-comments; never report their quirks."""
    try:
        with open(path, encoding="utf-8") as handle:
            text = handle.read()
        text = re.sub(r"//[^\n]*", "", text)
        text = re.sub(r",\s*([}\]])", r"\1", text)
        return json.loads(text)
    except Exception:  # noqa: BLE001
        return None


def vanilla_particles():
    ids = set()
    root = os.path.join(VANILLA, "resource_pack", "particles")
    if not os.path.isdir(root):
        return None
    for name in os.listdir(root):
        doc = load_json_lenient(os.path.join(root, name))
        if doc:
            ident = doc.get("particle_effect", {}).get("description", {}).get("identifier")
            if ident:
                ids.add(ident)
    return ids


def vanilla_sounds():
    path = os.path.join(VANILLA, "resource_pack", "sounds", "sound_definitions.json")
    if not os.path.isfile(path):
        return None
    doc = load_json_lenient(path)
    return set(doc.get("sound_definitions", {})) if doc else None


def vanilla_items():
    path = os.path.join(
        VANILLA, "metadata", "vanilladata_modules", "mojang-items.json"
    )
    if not os.path.isfile(path):
        return None
    doc = load_json_lenient(path)
    if not doc:
        return None
    ids = set()
    for entry in doc.get("data_items", []):
        name = entry.get("name")
        if name:
            ids.add(name)
    return ids


def main():
    documents = {}
    for root in (BP, RP):
        if not os.path.isdir(root):
            fail(f"missing pack directory: {root}")
        for path in walk_json(root):
            documents[path] = load_json(path)

    bp_manifest = documents.get(os.path.join(BP, "manifest.json"))
    rp_manifest = documents.get(os.path.join(RP, "manifest.json"))
    if not bp_manifest or not rp_manifest:
        report_and_exit()

    # ---- manifests -------------------------------------------------------
    uuids = []
    for manifest in (bp_manifest, rp_manifest):
        uuids.append(manifest["header"]["uuid"])
        uuids.extend(m["uuid"] for m in manifest["modules"])
    duplicates = {u for u in uuids if uuids.count(u) > 1}
    if duplicates:
        fail(f"duplicate UUIDs: {sorted(duplicates)}")

    # keep clear of the other add-on that lives in this repository
    for other in (
        os.path.join("behavior_packs", "arcane_arsenal_bp", "manifest.json"),
        os.path.join("resource_packs", "arcane_arsenal_rp", "manifest.json"),
    ):
        if os.path.isfile(other):
            doc = load_json(other)
            if doc:
                theirs = {doc["header"]["uuid"]} | {m["uuid"] for m in doc["modules"]}
                clash = theirs & set(uuids)
                if clash:
                    fail(f"UUID clash with {other}: {sorted(clash)}")

    rp_uuid = rp_manifest["header"]["uuid"]
    if rp_uuid not in [d.get("uuid") for d in bp_manifest.get("dependencies", [])]:
        fail("behavior pack does not depend on the resource pack uuid")

    for module in bp_manifest["modules"]:
        if module["type"] == "script":
            entry = os.path.join(BP, module["entry"])
            if not os.path.isfile(entry):
                fail(f"script entry not found: {entry}")

    for root in (BP, RP):
        if not os.path.isfile(os.path.join(root, "pack_icon.png")):
            fail(f"{root}: missing pack_icon.png")

    # ---- items -----------------------------------------------------------
    atlas = documents.get(os.path.join(RP, "textures", "item_texture.json")) or {}
    texture_data = atlas.get("texture_data", {})

    item_ids = set()
    cooldown_categories = set()
    for path, doc in documents.items():
        if not path.startswith(os.path.join(BP, "items")) or doc is None:
            continue
        item = doc.get("minecraft:item", {})
        identifier = item.get("description", {}).get("identifier")
        item_ids.add(identifier)
        components = item.get("components", {})

        icon = components.get("minecraft:icon")
        key = None
        if isinstance(icon, dict):
            key = icon.get("textures", {}).get("default")
        elif isinstance(icon, str):
            key = icon
        if not key:
            fail(f"{path}: minecraft:icon must use textures.default at 1.21.0")
        elif key not in texture_data:
            fail(f"{path}: icon '{key}' missing from item_texture.json")
        else:
            png = os.path.join(RP, texture_data[key]["textures"] + ".png")
            if not os.path.isfile(png):
                fail(f"{path}: icon '{key}' points at missing file {png}")

        cooldown = components.get("minecraft:cooldown")
        if cooldown:
            cooldown_categories.add(cooldown.get("category"))

    # ---- particles -------------------------------------------------------
    particle_ids = set()
    for path, doc in documents.items():
        if not path.startswith(os.path.join(RP, "particles")) or doc is None:
            continue
        desc = doc.get("particle_effect", {}).get("description", {})
        ident = desc.get("identifier")
        if not ident:
            fail(f"{path}: particle without identifier")
            continue
        if ident in particle_ids:
            fail(f"{path}: duplicate particle identifier {ident}")
        particle_ids.add(ident)
        params = desc.get("basic_render_parameters", {})
        if params.get("material") not in KNOWN_PARTICLE_MATERIALS:
            fail(f"{path}: unknown particle material {params.get('material')}")
        texture = params.get("texture", "")
        if texture.startswith("textures/particle/"):
            png = os.path.join(RP, texture + ".png")
            if not os.path.isfile(png):
                fail(f"{path}: particle texture missing: {png}")

    # ---- geometry / animations / controllers -----------------------------
    geometry_ids = {}
    geometry_locators = {}
    for path, doc in documents.items():
        if not path.startswith(os.path.join(RP, "models")) or doc is None:
            continue
        for geo in doc.get("minecraft:geometry", []):
            ident = geo.get("description", {}).get("identifier")
            geometry_ids[ident] = path
            locators = set()
            has_binding = False
            for bone in geo.get("bones", []):
                locators.update(bone.get("locators", {}))
                if bone.get("binding"):
                    has_binding = True
            geometry_locators[ident] = locators
            if not has_binding:
                fail(f"{path}: {ident} has no bone binding (attachable will not follow the hand)")

    animation_ids = {}
    animation_docs = {}
    for path, doc in documents.items():
        if not path.startswith(os.path.join(RP, "animations")) or doc is None:
            continue
        for name, anim in doc.get("animations", {}).items():
            animation_ids[name] = path
            animation_docs[name] = anim

    controller_ids = set()
    controller_animation_refs = {}
    for path, doc in documents.items():
        if not path.startswith(os.path.join(RP, "animation_controllers")) or doc is None:
            continue
        for name, ctrl in doc.get("animation_controllers", {}).items():
            controller_ids.add(name)
            refs = set()
            for state in ctrl.get("states", {}).values():
                for anim in state.get("animations", []):
                    refs.add(anim if isinstance(anim, str) else next(iter(anim)))
            controller_animation_refs[name] = refs

    render_controller_ids = set()
    for path, doc in documents.items():
        if not path.startswith(os.path.join(RP, "render_controllers")) or doc is None:
            continue
        render_controller_ids.update(doc.get("render_controllers", {}))

    # ---- attachables ------------------------------------------------------
    attachable_ids = set()
    for path, doc in documents.items():
        if not path.startswith(os.path.join(RP, "attachables")) or doc is None:
            continue
        desc = doc.get("minecraft:attachable", {}).get("description", {})
        ident = desc.get("identifier")
        attachable_ids.add(ident)
        if ident not in item_ids:
            fail(f"{path}: attachable {ident} has no matching item")

        for mat in desc.get("materials", {}).values():
            if mat not in KNOWN_ATTACHABLE_MATERIALS:
                fail(f"{path}: unknown material {mat}")

        for name, tex in desc.get("textures", {}).items():
            if tex.startswith("textures/misc/"):
                continue  # vanilla-provided (enchant glint)
            if not os.path.isfile(os.path.join(RP, tex + ".png")):
                fail(f"{path}: texture '{name}' missing: {tex}.png")

        geo_ref = desc.get("geometry", {}).get("default")
        if geo_ref not in geometry_ids:
            fail(f"{path}: geometry {geo_ref} not found")

        anim_map = desc.get("animations", {})
        for short, ref in anim_map.items():
            if ref.startswith("controller.animation."):
                if ref not in controller_ids:
                    fail(f"{path}: animation controller {ref} not found")
            elif ref not in animation_ids:
                fail(f"{path}: animation {ref} not found")

        # controller states must reference shortnames that exist here
        for short, ref in anim_map.items():
            if ref.startswith("controller.animation."):
                for used in controller_animation_refs.get(ref, ()):  # shortnames
                    if used not in anim_map:
                        fail(f"{path}: controller {ref} references '{used}' missing from attachable animations")

        for rc in desc.get("render_controllers", []):
            if rc not in render_controller_ids:
                fail(f"{path}: render controller {rc} not found")

        effects = desc.get("particle_effects", {})
        for short, pid in effects.items():
            if pid not in particle_ids:
                fail(f"{path}: particle effect {pid} not defined in this pack")

        # animation-driven particles and locators
        for short, ref in anim_map.items():
            anim = animation_docs.get(ref)
            if not anim:
                continue
            for key_frame in anim.get("particle_effects", {}).values():
                entries = key_frame if isinstance(key_frame, list) else [key_frame]
                for entry in entries:
                    if entry.get("effect") not in effects:
                        fail(f"{ref}: particle shortname '{entry.get('effect')}' not in attachable particle_effects")
                    locator = entry.get("locator")
                    if locator and locator not in geometry_locators.get(desc.get("geometry", {}).get("default"), set()):
                        fail(f"{ref}: locator '{locator}' missing from geometry")

    for item in item_ids:
        if item not in attachable_ids:
            fail(f"item {item} has no attachable (held model)")

    # ---- sounds ----------------------------------------------------------
    sound_defs = {}
    sound_doc = documents.get(os.path.join(RP, "sounds", "sound_definitions.json"))
    if sound_doc:
        sound_defs = sound_doc.get("sound_definitions", {})
        for event, definition in sound_defs.items():
            for entry in definition.get("sounds", []):
                name = entry["name"] if isinstance(entry, dict) else entry
                found = any(
                    os.path.isfile(os.path.join(RP, name + ext))
                    for ext in (".ogg", ".wav", ".fsb", ".mp3")
                )
                if not found:
                    fail(f"sound_definitions: {event} -> missing file {name}")
    else:
        fail("missing sounds/sound_definitions.json")

    # ---- script references ----------------------------------------------
    script_path = os.path.join(BP, "scripts", "main.js")
    script = open(script_path, encoding="utf-8").read() if os.path.isfile(script_path) else ""

    v_particles = vanilla_particles()
    v_sounds = vanilla_sounds()
    v_items = vanilla_items()

    for pid in sorted(set(re.findall(r'"(msword:[a-z_]+)"', script))):
        if pid.endswith("_sword"):
            if pid not in item_ids:
                fail(f"main.js: item {pid} not defined")
        elif pid not in particle_ids:
            fail(f"main.js: particle {pid} not defined")

    for sid in sorted(set(re.findall(r'"(msword\.[a-z.]+)"', script))):
        if sid not in sound_defs:
            fail(f"main.js: sound {sid} not defined")

    if v_particles is not None:
        for pid in sorted(set(re.findall(r'"(minecraft:[a-z_]+_emitter|minecraft:[a-z_]+_particle)"', script))):
            if pid not in v_particles:
                fail(f"main.js: vanilla particle {pid} not in 1.21.0 vanilla pack")
    if v_sounds is not None:
        for sid in sorted(
            set(re.findall(r'sound\(dimension, "([a-z._]+)"', script))
            | set(re.findall(r'playSound\("([a-z._]+)"', script))
        ):
            if not sid.startswith("msword.") and sid not in v_sounds:
                fail(f"main.js: vanilla sound '{sid}' not in 1.21.0 sound_definitions")

    # ---- recipes ---------------------------------------------------------
    for path, doc in documents.items():
        if not path.startswith(os.path.join(BP, "recipes")) or doc is None:
            continue
        recipe = doc.get("minecraft:recipe_shaped", {})
        result = recipe.get("result", {})
        result_item = result.get("item")
        if result_item and result_item.startswith("msword:") and result_item not in item_ids:
            fail(f"{path}: result {result_item} has no item definition")
        if v_items is not None:
            for slot in recipe.get("key", {}).values():
                ingredient = slot.get("item")
                if ingredient and ingredient.startswith("minecraft:"):
                    if ingredient.split(":", 1)[1] not in {i.split(":", 1)[1] for i in v_items} and ingredient not in v_items:
                        fail(f"{path}: unknown vanilla ingredient {ingredient}")

    report_and_exit(package_after=True, count=len(documents))


def report_and_exit(package_after=False, count=0):
    if errors:
        print("\nBuild failed:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        sys.exit(1)
    if not package_after:
        sys.exit(1)
    print(f"Validated {count} JSON documents. All cross-references resolve.")
    package()
    sys.exit(0)


def package():
    os.makedirs(DIST, exist_ok=True)
    if os.path.exists(ADDON):
        os.remove(ADDON)
    with zipfile.ZipFile(ADDON, "w", zipfile.ZIP_DEFLATED) as archive:
        for root, folder in ((BP, "magical_swords_bp"), (RP, "magical_swords_rp")):
            for base, _dirs, files in os.walk(root):
                for name in sorted(files):
                    source = os.path.join(base, name)
                    arcname = os.path.join(folder, os.path.relpath(source, root)).replace(os.sep, "/")
                    archive.write(source, arcname)
    print(f"Packaged {ADDON} ({os.path.getsize(ADDON):,} bytes)")


if __name__ == "__main__":
    main()
