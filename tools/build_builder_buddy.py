#!/usr/bin/env python3
"""Validate and package the Builder Buddy add-on.

Usage:  python3 tools/build_builder_buddy.py
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import packlib  # noqa: E402

BP = os.path.join("behavior_packs", "Builder_Buddy_BP")
RP = os.path.join("resource_packs", "Builder_Buddy_RP")

ITEM_ID = "bb:house_builder_remote"


def check_companion_rules(addon):
    """The promises that make the buddy a companion rather than a hazard."""
    entity = packlib.load_json(addon, os.path.join(BP, "entities", "builder_buddy.json"))
    if not entity:
        return
    components = entity["minecraft:entity"]["components"]

    # It must never be able to target friendlies.
    melee = json.dumps(components.get("minecraft:behavior.melee_attack", {}))
    for family in ("player", "villager", "wolf", "cat", "animal", "iron_golem"):
        if f'"value": "{family}"' in melee and '"!="' not in melee:
            addon.fail(f"melee_attack may target '{family}'")

    # The remote needs a name in the language file.
    lang = packlib.read_text(os.path.join(RP, "texts", "en_US.lang"))
    if f"item.{ITEM_ID}=" not in lang:
        addon.fail(f"en_US.lang has no name for {ITEM_ID}")

    # Autonomous work digs and places blocks, so the man-made guard is
    # load-bearing: without it the buddy will quietly mine your house.
    script = packlib.read_text(os.path.join(BP, "scripts", "main.js"))
    if "looksManMade" not in script:
        addon.fail("scripts/main.js lost the looksManMade guard on block breaking")
    if "looksLikeTree" not in script:
        addon.fail("scripts/main.js lost the tree check, so it may fell player builds")


def main():
    addon = packlib.Addon(
        name="Builder Buddy",
        bp=BP,
        rp=RP,
        namespace="bb",
        entity_id="bb:builder_buddy",
        client_entity="builder_buddy.entity.json",
        entity_file="builder_buddy.json",
        archive=os.path.join("dist", "Builder_Buddy.mcaddon"),
        folder_bp="Builder_Buddy_BP",
        folder_rp="Builder_Buddy_RP",
        script_modules={"@minecraft/server": "1.11.0", "@minecraft/server-ui": "1.2.0"},
        other_packs=[
            os.path.join("behavior_packs", "arcane_arsenal_bp"),
            os.path.join("resource_packs", "arcane_arsenal_rp"),
            os.path.join("behavior_packs", "Tiny_Parasite_BP"),
            os.path.join("resource_packs", "Tiny_Parasite_RP"),
        ],
        required_pngs=[
            os.path.join(RP, "textures", "entity", "builder_buddy.png"),
            os.path.join(RP, "textures", "items", "bb_house_builder_remote.png"),
            os.path.join(RP, "textures", "items", "bb_builder_buddy_spawn_egg.png"),
        ],
        skin=(os.path.join(RP, "textures", "entity", "builder_buddy.png"), (64, 64)),
        # Held items attach to a bone named rightItem; without it the diamond
        # sword simply does not render.
        required_bones=["rightItem"],
        required_functions=["builder_buddy_house"],
    )
    return packlib.run(addon, extra_checks=[check_companion_rules])


if __name__ == "__main__":
    sys.exit(main())
