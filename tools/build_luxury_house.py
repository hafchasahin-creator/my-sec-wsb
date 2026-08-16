#!/usr/bin/env python3
"""Validate and package the Luxury Tech House add-on.

Static checks:
  * every JSON file parses
  * manifest UUIDs are unique, the behaviour pack depends on the resource pack,
    and the declared script entry point exists
  * every item icon resolves item -> item_texture.json -> a PNG on disk
  * every custom item has a display name in the language file
  * no script references a palette key that config.js does not define

Dynamic check (needs Node, skipped with a warning if unavailable):
  * runs the add-on's own modules against a stubbed @minecraft/server and
    validates the ~1000 commands the builder emits - see tools/sim/harness.mjs

Then zips the two packs into dist/LuxuryTechHouse.mcaddon with the pack folders
at the archive root, which is what Bedrock expects from a .mcaddon.

Usage:  python3 tools/build_luxury_house.py [--skip-sim]
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

BP = os.path.join("behavior_packs", "luxury_tech_house_bp")
RP = os.path.join("resource_packs", "luxury_tech_house_rp")
SIM = os.path.join("tools", "sim")
DIST = "dist"
ADDON = os.path.join(DIST, "LuxuryTechHouse.mcaddon")

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


# --------------------------------------------------------------------------
# Static validation
# --------------------------------------------------------------------------

def validate_static():
    documents = {}
    for root in (BP, RP):
        if not os.path.isdir(root):
            fail(f"missing pack directory: {root}")
            continue
        for path in walk(root, ".json"):
            documents[path] = load_json(path)

    bp_manifest = documents.get(os.path.join(BP, "manifest.json"))
    rp_manifest = documents.get(os.path.join(RP, "manifest.json"))
    if not bp_manifest or not rp_manifest:
        fail("both manifests must load before anything else can be checked")
        return

    uuids = []
    for manifest in (bp_manifest, rp_manifest):
        uuids.append(manifest["header"]["uuid"])
        uuids.extend(module["uuid"] for module in manifest["modules"])
    duplicates = sorted({u for u in uuids if uuids.count(u) > 1})
    if duplicates:
        fail(f"duplicate UUIDs across manifests: {duplicates}")

    # UUIDs must not collide with any other pack in the repository either.
    for other in walk(".", "manifest.json"):
        if other.startswith(("./" + BP, "./" + RP, BP, RP)):
            continue
        doc = load_json(other)
        if not doc:
            continue
        foreign = {doc["header"]["uuid"]} | {m["uuid"] for m in doc.get("modules", [])}
        clash = foreign & set(uuids)
        if clash:
            fail(f"UUID(s) {sorted(clash)} also used by {other}")

    rp_uuid = rp_manifest["header"]["uuid"]
    dependencies = bp_manifest.get("dependencies", [])
    if rp_uuid not in [d.get("uuid") for d in dependencies]:
        fail(f"behaviour pack does not depend on resource pack {rp_uuid}")
    modules = {d.get("module_name") for d in dependencies}
    for required in ("@minecraft/server", "@minecraft/server-ui"):
        if required not in modules:
            fail(f"behaviour pack does not declare a dependency on {required}")

    for manifest, label in ((bp_manifest, "BP"), (rp_manifest, "RP")):
        engine = manifest["header"].get("min_engine_version")
        if engine != [1, 21, 0]:
            fail(f"{label} min_engine_version is {engine}, expected [1, 21, 0]")

    script_entry = None
    for module in bp_manifest["modules"]:
        if module["type"] == "script":
            script_entry = os.path.join(BP, module["entry"])
    if not script_entry or not os.path.isfile(script_entry):
        fail(f"script entry not found: {script_entry}")

    # icons: item -> atlas key -> png
    atlas_path = os.path.join(RP, "textures", "item_texture.json")
    atlas = documents.get(atlas_path)
    if atlas is None:
        fail(f"missing {atlas_path}")
        return
    texture_data = atlas.get("texture_data", {})

    identifiers = []
    for path, doc in documents.items():
        if not path.startswith(os.path.join(BP, "items")) or doc is None:
            continue
        item = doc.get("minecraft:item", {})
        identifier = item.get("description", {}).get("identifier")
        identifiers.append(identifier)
        icon = item.get("components", {}).get("minecraft:icon")
        # The flat "texture" string was deprecated at format_version 1.20.60 and
        # is silently ignored, which shows up in game as a blank icon.
        if isinstance(icon, dict) and "texture" in icon:
            fail(f"{path}: minecraft:icon must use {{'textures': {{'default': ...}}}}")
            continue
        key = icon.get("textures", {}).get("default") if isinstance(icon, dict) else None
        if not key:
            fail(f"{path}: no minecraft:icon texture")
            continue
        if key not in texture_data:
            fail(f"{path}: icon '{key}' missing from item_texture.json")
            continue
        png = os.path.join(RP, texture_data[key]["textures"] + ".png")
        if not os.path.isfile(png):
            fail(f"{path}: icon '{key}' points at missing file {png}")

    lang_path = os.path.join(RP, "texts", "en_US.lang")
    lang = ""
    if os.path.isfile(lang_path):
        with open(lang_path, encoding="utf-8") as handle:
            lang = handle.read()
    for identifier in identifiers:
        if identifier and f"item.{identifier}=" not in lang:
            fail(f"{lang_path}: no name entry for {identifier}")

    for root in (BP, RP):
        if not os.path.isfile(os.path.join(root, "pack_icon.png")):
            fail(f"{root}: missing pack_icon.png")

    # Palette keys used by the scripts must exist in config.js.
    config_path = os.path.join(BP, "scripts", "config.js")
    with open(config_path, encoding="utf-8") as handle:
        config_source = handle.read()
    block_section = config_source.split("export const B = {", 1)[1].split("\n};", 1)[0]
    defined = set(re.findall(r"^\s{2}([A-Z][A-Z0-9_]*):", block_section, re.M))
    used = set()
    for path in walk(os.path.join(BP, "scripts"), ".js"):
        if path == config_path:
            continue
        with open(path, encoding="utf-8") as handle:
            used |= set(re.findall(r"\bB\.([A-Z][A-Z0-9_]*)\b", handle.read()))
    missing = sorted(used - defined)
    if missing:
        fail(f"scripts reference palette keys config.js does not define: {missing}")
    notes.append(f"palette: {len(defined)} ids defined, {len(used)} referenced")
    notes.append(f"validated {len(documents)} JSON files, {len(identifiers)} items")


# --------------------------------------------------------------------------
# Dynamic validation: run the add-on's modules under Node
# --------------------------------------------------------------------------

def validate_simulation():
    node = shutil.which("node")
    if not node:
        notes.append("node not found - skipped the build simulation")
        return

    with tempfile.TemporaryDirectory(prefix="luxsim-") as work:
        shutil.copytree(os.path.join(BP, "scripts"), os.path.join(work, "scripts"))
        shutil.copy(os.path.join(SIM, "harness.mjs"), os.path.join(work, "harness.mjs"))
        with open(os.path.join(work, "package.json"), "w", encoding="utf-8") as handle:
            handle.write('{"type":"module"}\n')

        # Node resolves bare specifiers from the importing file upwards, so the
        # stubs go in a node_modules tree beside the copied scripts.
        for name, source in (
            ("server", "stub-server.mjs"),
            ("server-ui", "stub-server-ui.mjs"),
        ):
            target = os.path.join(work, "node_modules", "@minecraft", name)
            os.makedirs(target, exist_ok=True)
            shutil.copy(os.path.join(SIM, source), os.path.join(target, "index.mjs"))
            with open(os.path.join(target, "package.json"), "w", encoding="utf-8") as handle:
                json.dump(
                    {"name": f"@minecraft/{name}", "type": "module", "main": "index.mjs"},
                    handle,
                )

        result = subprocess.run(
            [node, "harness.mjs"],
            cwd=work,
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode != 0:
            fail("build simulation failed:\n" + (result.stderr or result.stdout).rstrip())
        else:
            notes.append("simulation: " + result.stdout.strip())


# --------------------------------------------------------------------------
# Packaging
# --------------------------------------------------------------------------

def package():
    os.makedirs(DIST, exist_ok=True)
    if os.path.exists(ADDON):
        os.remove(ADDON)

    with zipfile.ZipFile(ADDON, "w", zipfile.ZIP_DEFLATED) as archive:
        for root, folder in ((BP, "luxury_tech_house_bp"), (RP, "luxury_tech_house_rp")):
            for base, _dirs, files in os.walk(root):
                for name in sorted(files):
                    source = os.path.join(base, name)
                    arcname = os.path.join(
                        folder, os.path.relpath(source, root)
                    ).replace(os.sep, "/")
                    archive.write(source, arcname)

    # A .mcaddon must contain the pack folders directly, never a nested archive.
    with zipfile.ZipFile(ADDON) as archive:
        names = archive.namelist()
        if any(name.endswith((".zip", ".mcpack", ".mcaddon")) for name in names):
            fail("packaged archive contains a nested archive")
        for required in (
            "luxury_tech_house_bp/manifest.json",
            "luxury_tech_house_rp/manifest.json",
            "luxury_tech_house_bp/scripts/main.js",
        ):
            if required not in names:
                fail(f"packaged archive is missing {required}")
        print(f"Packaged {ADDON} ({os.path.getsize(ADDON):,} bytes, {len(names)} entries)")


if __name__ == "__main__":
    validate_static()
    if "--skip-sim" not in sys.argv:
        validate_simulation()

    for note in notes:
        print(note)

    if errors:
        print("\nBuild failed:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        sys.exit(1)

    package()
    if errors:
        sys.exit(1)
