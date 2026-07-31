#!/usr/bin/env python3
"""Validate and package the Super Powers add-on.

Checks the things that have actually broken add-ons in this repo before:
pinned script module versions, script imports that resolve, item icons that
reach a real PNG, every particle the scripts spawn being defined in the
resource pack, and every item's cooldown category matching the power key the
scripts use. Then zips both packs into dist/SuperPowers.mcaddon.

Usage:  python3 tools/build_superpowers.py
"""

import json
import os
import re
import sys
import zipfile

BP = os.path.join("behavior_packs", "super_powers_bp")
RP = os.path.join("resource_packs", "super_powers_rp")
OTHER_MANIFESTS = (
    os.path.join("behavior_packs", "arcane_arsenal_bp", "manifest.json"),
    os.path.join("resource_packs", "arcane_arsenal_rp", "manifest.json"),
    os.path.join("behavior_packs", "skyline_parkour_bp", "manifest.json"),
    os.path.join("resource_packs", "skyline_parkour_rp", "manifest.json"),
    os.path.join("behavior_packs", "bodyguard_bp", "manifest.json"),
    os.path.join("resource_packs", "bodyguard_rp", "manifest.json"),
)
DIST = "dist"
ADDON = os.path.join(DIST, "SuperPowers.mcaddon")
BP_PACK = os.path.join(DIST, "SuperPowers_BP.mcpack")
RP_PACK = os.path.join(DIST, "SuperPowers_RP.mcpack")
NAMESPACE = "sp:"

IMPORT_RE = re.compile(r"""from\s+["']([^"']+)["']""")
NAMESPACED_RE = re.compile(r"""["'](sp:[a-z_]+)["']""")
POWER_KEY_RE = re.compile(r"""key:\s*["']([a-z]+)["']""")

# Module versions that exist in Minecraft 1.21.0, this pack's
# min_engine_version. Asking for a version the client does not have makes the
# game reject the whole behaviour pack - no items, no scripts, no explanation.
# @minecraft/server 1.11.0 shipped with 1.21.0; 1.12.0 with 1.21.20.
# @minecraft/server-ui 1.1.0 shipped with 1.20.0; 1.2.0 with 1.21.20.
REQUIRED_MODULES = {
    "@minecraft/server": "1.11.0",
    "@minecraft/server-ui": "1.1.0",
}

errors = []


def fail(message):
    errors.append(message)


def load_json(path):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except Exception as exc:  # noqa: BLE001 - report and keep going
        fail(f"{path}: invalid JSON ({exc})")
        return None


def read_text(path):
    if not os.path.isfile(path):
        return ""
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def walk_json(root):
    for base, _dirs, files in os.walk(root):
        for name in sorted(files):
            if name.endswith(".json"):
                yield os.path.join(base, name)


def script_files():
    for base, _dirs, files in os.walk(os.path.join(BP, "scripts")):
        for name in sorted(files):
            if name.endswith(".js"):
                yield os.path.join(base, name)


def manifest_uuids(manifest):
    uuids = [manifest["header"]["uuid"]]
    uuids.extend(module["uuid"] for module in manifest["modules"])
    return uuids


def check_manifests(documents):
    bp_manifest = documents.get(os.path.join(BP, "manifest.json"))
    rp_manifest = documents.get(os.path.join(RP, "manifest.json"))
    if not bp_manifest or not rp_manifest:
        fail("missing a manifest")
        return None

    uuids = manifest_uuids(bp_manifest) + manifest_uuids(rp_manifest)
    duplicates = {u for u in uuids if uuids.count(u) > 1}
    if duplicates:
        fail(f"duplicate UUIDs across manifests: {sorted(duplicates)}")
    for path in OTHER_MANIFESTS:
        other = load_json(path) if os.path.isfile(path) else None
        if not other:
            continue
        clash = set(uuids) & set(manifest_uuids(other))
        if clash:
            fail(f"UUID clash with {path}: {sorted(clash)}")

    dependencies = bp_manifest.get("dependencies", [])
    if rp_manifest["header"]["uuid"] not in [dep.get("uuid") for dep in dependencies]:
        fail("behaviour pack does not depend on the resource pack")

    declared = {
        dep["module_name"]: dep.get("version")
        for dep in dependencies
        if dep.get("module_name")
    }
    for name, version in REQUIRED_MODULES.items():
        if name not in declared:
            fail(f"{BP}/manifest.json: missing dependency on {name}")
        elif declared[name] != version:
            fail(
                f"{BP}/manifest.json: {name} is pinned to {version} for "
                f"min_engine_version 1.21.0, found {declared[name]}"
            )
    return bp_manifest


def check_scripts(bp_manifest):
    entries = [
        os.path.join(BP, module["entry"])
        for module in bp_manifest["modules"]
        if module["type"] == "script"
    ]
    if not entries:
        fail(f"{BP}/manifest.json: no script module")
        return

    seen = set()
    queue = list(entries)
    while queue:
        path = queue.pop()
        if path in seen:
            continue
        seen.add(path)
        if not os.path.isfile(path):
            fail(f"script file not found: {path}")
            continue
        for target in IMPORT_RE.findall(read_text(path)):
            if target in REQUIRED_MODULES:
                continue
            if not target.startswith("."):
                fail(f"{path}: imports unknown module '{target}'")
                continue
            resolved = os.path.normpath(os.path.join(os.path.dirname(path), target))
            if not os.path.isfile(resolved):
                fail(f"{path}: import '{target}' does not resolve to {resolved}")
                continue
            queue.append(resolved)

    for path in sorted(set(script_files()) - seen):
        fail(f"{path}: not reachable from the script entry point")


def check_powers(documents):
    """Every power key in config.js needs an item, and the item's cooldown
    category has to be the one state.js starts."""
    config = read_text(os.path.join(BP, "scripts", "config.js"))
    keys = set(POWER_KEY_RE.findall(config))
    if not keys:
        fail("scripts/config.js: could not find any power keys")
        return set()

    categories = {}
    identifiers = set()
    for path, doc in sorted(documents.items()):
        if not path.startswith(os.path.join(BP, "items")) or doc is None:
            continue
        item = doc.get("minecraft:item", {})
        identifier = item.get("description", {}).get("identifier")
        identifiers.add(identifier)
        cooldown = item.get("components", {}).get("minecraft:cooldown")
        if cooldown:
            categories[identifier] = cooldown.get("category")

    for key in sorted(keys):
        identifier = f"sp:{key}_core"
        if identifier not in identifiers:
            fail(f"power '{key}' has no item at {BP}/items/{key}_core.json")
            continue
        expected = f"sp_{key}"
        if categories.get(identifier) != expected:
            fail(
                f"{identifier}: cooldown category is {categories.get(identifier)!r}, "
                f"but state.js starts '{expected}'"
            )
    return identifiers


def check_particles(documents):
    """Anything the scripts spawn as 'sp:...' must be a particle we ship or an
    item we define - a typo here is an effect that silently never appears."""
    particles = set()
    for path, doc in documents.items():
        if not path.startswith(os.path.join(RP, "particles")) or doc is None:
            continue
        identifier = (
            doc.get("particle_effect", {}).get("description", {}).get("identifier")
        )
        particles.add(identifier)
        texture = (
            doc.get("particle_effect", {})
            .get("description", {})
            .get("basic_render_parameters", {})
            .get("texture")
        )
        if texture and not os.path.isfile(os.path.join(RP, texture + ".png")):
            fail(f"{path}: texture '{texture}' has no PNG")

    items = set()
    for path, doc in documents.items():
        if not path.startswith(os.path.join(BP, "items")) or doc is None:
            continue
        items.add(doc.get("minecraft:item", {}).get("description", {}).get("identifier"))

    known = particles | items
    for path in script_files():
        for identifier in set(NAMESPACED_RE.findall(read_text(path))):
            if identifier not in known:
                fail(f"{path}: '{identifier}' is neither a particle nor an item in this add-on")
    return particles


def check_items_and_recipes(documents):
    atlas = documents.get(os.path.join(RP, "textures", "item_texture.json"))
    texture_data = (atlas or {}).get("texture_data", {})

    identifiers = []
    for path, doc in sorted(documents.items()):
        if not path.startswith(os.path.join(BP, "items")) or doc is None:
            continue
        item = doc.get("minecraft:item", {})
        identifier = item.get("description", {}).get("identifier")
        identifiers.append(identifier)
        if identifier and not identifier.startswith(NAMESPACE):
            fail(f"{path}: identifier '{identifier}' is outside {NAMESPACE}")

        icon = item.get("components", {}).get("minecraft:icon")
        if isinstance(icon, dict) and "texture" in icon:
            fail(f"{path}: minecraft:icon must use textures/default, not the old 'texture'")
            continue
        key = icon.get("textures", {}).get("default") if isinstance(icon, dict) else icon
        if not key:
            fail(f"{path}: no minecraft:icon texture")
        elif key not in texture_data:
            fail(f"{path}: icon '{key}' missing from item_texture.json")
        elif not os.path.isfile(os.path.join(RP, texture_data[key]["textures"] + ".png")):
            fail(f"{path}: icon '{key}' points at a missing PNG")

    made = set()
    for path, doc in sorted(documents.items()):
        if not path.startswith(os.path.join(BP, "recipes")) or doc is None:
            continue
        recipe = doc.get("minecraft:recipe_shaped", {})
        result = recipe.get("result", {})
        result_item = result.get("item") if isinstance(result, dict) else result
        made.add(result_item)
        if result_item and result_item.startswith(NAMESPACE):
            if result_item not in identifiers:
                fail(f"{path}: result '{result_item}' has no item definition")
        keys = set(recipe.get("key", {}))
        used = {char for row in recipe.get("pattern", []) for char in row if char != " "}
        if used - keys:
            fail(f"{path}: pattern uses undefined keys {sorted(used - keys)}")
        if keys - used:
            fail(f"{path}: key defines unused symbols {sorted(keys - used)}")

    for identifier in identifiers:
        if identifier and identifier not in made:
            fail(f"{identifier}: no crafting recipe, so it is command-only")

    lang_path = os.path.join(RP, "texts", "en_US.lang")
    lang = read_text(lang_path)
    for identifier in identifiers:
        if identifier and f"item.{identifier}=" not in lang:
            fail(f"{lang_path}: no name entry for {identifier}")

    return identifiers


def validate():
    documents = {}
    for root in (BP, RP):
        if not os.path.isdir(root):
            fail(f"missing pack directory: {root}")
            continue
        for path in walk_json(root):
            documents[path] = load_json(path)

    bp_manifest = check_manifests(documents)
    if bp_manifest is None:
        return

    check_scripts(bp_manifest)
    check_powers(documents)
    particles = check_particles(documents)
    identifiers = check_items_and_recipes(documents)

    for root in (BP, RP):
        if not os.path.isfile(os.path.join(root, "pack_icon.png")):
            fail(f"{root}: missing pack_icon.png")

    print(
        f"Validated {len(documents)} JSON files, {len(identifiers)} items, "
        f"{len(particles)} particles, {len(list(script_files()))} scripts."
    )


def write_zip(path, roots):
    if os.path.exists(path):
        os.remove(path)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for root, folder in roots:
            for base, _dirs, files in os.walk(root):
                for name in sorted(files):
                    source = os.path.join(base, name)
                    inner = os.path.relpath(source, root)
                    arcname = (
                        os.path.join(folder, inner) if folder else inner
                    ).replace(os.sep, "/")
                    archive.write(source, arcname)
    print(f"Packaged {path} ({os.path.getsize(path):,} bytes)")


def package():
    os.makedirs(DIST, exist_ok=True)
    write_zip(ADDON, ((BP, "super_powers_bp"), (RP, "super_powers_rp")))
    write_zip(BP_PACK, ((BP, ""),))
    write_zip(RP_PACK, ((RP, ""),))


if __name__ == "__main__":
    validate()
    if errors:
        print("\nBuild failed:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        sys.exit(1)
    package()
