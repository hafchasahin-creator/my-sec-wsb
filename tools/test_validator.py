#!/usr/bin/env python3
"""Prove that tools/build_fungi.py actually rejects broken packs.

    python3 tools/test_validator.py

A validator nobody has ever seen fail is not evidence of anything. This
temporarily corrupts one thing at a time - always restoring the original bytes
afterwards, even on error - and asserts that the build refuses each one with a
message that names the real problem.

The mutations are the failures that would actually bite: a species that would
silently vanish from the Creative inventory, a texture that does not resolve, a
missing display name, the deprecated icon field that renders blank, and so on.
"""

import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import fungi_spec as spec  # noqa: E402

BP = spec.BP_DIR
RP = spec.RP_DIR

BLOCK = os.path.join(BP, "blocks", "bloodcap.json")
EMBER = os.path.join(BP, "blocks", "embercap.json")
ROTCAP = os.path.join(BP, "blocks", "rotcap.json")
SCANNER = os.path.join(BP, "items", "fungal_scanner.json")
GEOMETRY = os.path.join(RP, "models", "blocks", "fungi_cap_broad.geo.json")
RP_MANIFEST = os.path.join(RP, "manifest.json")
BP_MANIFEST = os.path.join(BP, "manifest.json")
SOUNDS = os.path.join(RP, "blocks.json")
LANG = os.path.join(RP, "texts", "en_US.lang")
RULE = os.path.join(BP, "feature_rules", "bloodcap_rule.json")
FEATURE = os.path.join(BP, "features", "bloodcap_feature.json")
GIVE_ALL = os.path.join(BP, "functions", "fungi_give_all.mcfunction")
HELP = os.path.join(BP, "functions", "fungi_help.mcfunction")
MAIN = os.path.join(BP, "scripts", "main.js")
TERRAIN = os.path.join(RP, "textures", "terrain_texture.json")


# -- mutation helpers ------------------------------------------------------


def edit_json(path, mutate):
    def apply():
        with open(path, encoding="utf-8") as handle:
            doc = json.load(handle)
        mutate(doc)
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(doc, handle, indent=2)

    return path, apply


def edit_text(path, mutate):
    def apply():
        with open(path, encoding="utf-8") as handle:
            text = handle.read()
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(mutate(text))

    return path, apply


def raw_write(path, content):
    return path, lambda: open(path, "w", encoding="utf-8").write(content)


def drop_key(*keys):
    def mutate(doc):
        node = doc
        for key in keys[:-1]:
            node = node[key]
        del node[keys[-1]]

    return mutate


def set_key(value, *keys):
    def mutate(doc):
        node = doc
        for key in keys[:-1]:
            node = node[key]
        node[keys[-1]] = value

    return mutate


# -- the cases -------------------------------------------------------------

CASES = [
    (
        "a species with no menu_category (would vanish from Creative)",
        edit_json(BLOCK, drop_key("minecraft:block", "description", "menu_category")),
        "menu_category",
    ),
    (
        "a block hidden from the Creative menu",
        edit_json(
            BLOCK,
            set_key(True, "minecraft:block", "description", "menu_category", "is_hidden_in_commands"),
        ),
        "hides",
    ),
    (
        "a material pointing at a texture key that does not exist",
        edit_json(
            EMBER,
            set_key("nope", "minecraft:block", "components", "minecraft:material_instances", "*", "texture"),
        ),
        "missing from terrain_texture.json",
    ),
    (
        "a texture key whose PNG is absent from disk",
        edit_json(TERRAIN, set_key({"textures": "textures/blocks/ghost"}, "texture_data", "fungi_bloodcap_cap")),
        "missing texture file",
    ),
    (
        "an invalid render method",
        edit_json(
            EMBER,
            set_key("shiny", "minecraft:block", "components", "minecraft:material_instances", "*", "render_method"),
        ),
        "render_method",
    ),
    (
        "a light emission outside 0-15",
        edit_json(EMBER, set_key(99, "minecraft:block", "components", "minecraft:light_emission")),
        "light_emission",
    ),
    (
        "an unsupported block component",
        edit_json(EMBER, set_key({}, "minecraft:block", "components", "minecraft:on_step_on")),
        "unsupported block component",
    ),
    (
        "an identifier that disagrees with its filename",
        edit_json(EMBER, set_key("fungi:wrong", "minecraft:block", "description", "identifier")),
        "does not match filename",
    ),
    ("malformed JSON", raw_write(ROTCAP, "{ broken"), "invalid JSON"),
    (
        "a species with no display name",
        edit_text(LANG, lambda t: t.replace("tile.fungi:voidcap.name=Voidcap\n", "")),
        "no name for fungi:voidcap",
    ),
    (
        "two species sharing a display name",
        edit_text(LANG, lambda t: t.replace("tile.fungi:voidcap.name=Voidcap", "tile.fungi:voidcap.name=Rotcap")),
        "share a display name",
    ),
    (
        "an unknown block sound",
        edit_json(SOUNDS, set_key("mushroom", "fungi:deathbell", "sound")),
        "unknown sound",
    ),
    (
        "a block with no sound at all (silent block)",
        edit_json(SOUNDS, drop_key("fungi:deathbell")),
        "would be silent",
    ),
    (
        "the deprecated flat icon field (renders blank in game)",
        edit_json(SCANNER, set_key({"texture": "fungal_scanner"}, "minecraft:item", "components", "minecraft:icon")),
        "deprecated flat 'texture' field",
    ),
    (
        "an engine-owned tag on a custom item",
        edit_json(
            SCANNER,
            set_key(["minecraft:is_sword"], "minecraft:item", "components", "minecraft:tags", "tags"),
        ),
        "engine-owned tag",
    ),
    (
        "a geometry naming a material the block never declares",
        edit_json(
            GEOMETRY,
            set_key(
                "cap",
                "minecraft:geometry",
                0,
                "bones",
                0,
                "cubes",
                0,
                "uv",
                "north",
                "material_instance",
            ),
        ),
        "which geometry.fungi.cap_broad's block does not define",
    ),
    (
        "a duplicate UUID across the two manifests",
        edit_json(RP_MANIFEST, lambda d: d["modules"][0].update(uuid=d["header"]["uuid"])),
        "duplicate UUIDs",
    ),
    (
        "a resource pack that depends on the behaviour pack",
        edit_json(
            RP_MANIFEST,
            set_key([{"uuid": spec.UUIDS["bp_header"], "version": spec.PACK_VERSION}], "dependencies"),
        ),
        "depends on the behaviour pack",
    ),
    (
        "a behaviour pack that lost its resource-pack dependency",
        edit_json(
            BP_MANIFEST,
            set_key([{"module_name": "@minecraft/server", "version": spec.SERVER_MODULE}], "dependencies"),
        ),
        "no dependency on the resource pack",
    ),
    (
        "a wrong @minecraft/server version",
        edit_json(BP_MANIFEST, lambda d: d["dependencies"][1].update(version="2.9.0")),
        "@minecraft/server",
    ),
    (
        "a missing script entry point",
        edit_json(BP_MANIFEST, lambda d: d["modules"][1].update(entry="scripts/gone.js")),
        "script entry not found",
    ),
    (
        "a feature rule pointing at a feature that does not exist",
        edit_json(RULE, set_key("fungi:ghost_feature", "minecraft:feature_rules", "description", "places_feature")),
        "has no matching feature file",
    ),
    (
        "an unknown world-generation placement pass",
        edit_json(RULE, set_key("magic_pass", "minecraft:feature_rules", "conditions", "placement_pass")),
        "unknown placement_pass",
    ),
    (
        "a feature placing a block the add-on does not define",
        edit_json(FEATURE, set_key("fungi:ghost", "minecraft:single_block_feature", "places_block")),
        "is not one of the add-on's blocks",
    ),
    (
        "fungi_give_all forgetting a species",
        edit_text(GIVE_ALL, lambda t: t.replace("give @s fungi:mycelium_x 8\n", "")),
        "does not give",
    ),
    (
        "a give command naming an item that does not exist",
        edit_text(GIVE_ALL, lambda t: t.replace("fungi:bloodcap", "fungi:phantomcap")),
        "unknown identifier",
    ),
    (
        "help pointing at a function that is not shipped",
        edit_text(HELP, lambda t: t.replace("/function fungi_status", "/function fungi_nuke")),
        "references missing function",
    ),
    (
        "a scriptevent main.js does not handle",
        edit_text(
            os.path.join(BP, "functions", "fungi_spread_off.mcfunction"),
            lambda t: t.replace("fungi:spread_off", "fungi:spread_maybe"),
        ),
        "does not handle",
    ),
    (
        "a JavaScript syntax error",
        edit_text(MAIN, lambda t: t + "\nfunction broken( {\n"),
        "syntax error",
    ),
]


def main():
    print(f"Negative-testing the validator with {len(CASES)} mutations.\n")

    baseline = subprocess.run(
        [sys.executable, "tools/build_fungi.py"], capture_output=True, text=True
    )
    if baseline.returncode != 0:
        print("The pack does not validate before any mutation:", file=sys.stderr)
        print(baseline.stderr, file=sys.stderr)
        return 1

    failures = []
    for name, (path, apply), expected in CASES:
        with open(path, "rb") as handle:
            original = handle.read()
        try:
            apply()
            result = subprocess.run(
                [sys.executable, "tools/build_fungi.py"], capture_output=True, text=True
            )
            output = result.stdout + result.stderr
            if result.returncode == 0:
                failures.append(f"{name}: build PASSED, it should have failed")
                print(f"  MISSED  {name}")
            elif expected not in output:
                failures.append(f"{name}: rejected, but no message matching {expected!r}")
                print(f"  vague   {name}")
            else:
                print(f"  caught  {name}")
        finally:
            with open(path, "wb") as handle:
                handle.write(original)

    restored = subprocess.run(
        [sys.executable, "tools/build_fungi.py"], capture_output=True, text=True
    )
    if restored.returncode != 0:
        failures.append("the pack did not validate again after restoring every file")
        print("\nRestore check FAILED:\n" + restored.stderr, file=sys.stderr)
    else:
        print("\nAll files restored; the pack validates again.")

    print(f"\n{len(CASES) - len(failures)}/{len(CASES)} mutations rejected as expected")
    if failures:
        print("\nProblems:", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
