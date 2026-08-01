#!/usr/bin/env python3
"""Validate and package the Tiny Parasite add-on.

Usage:  python3 tools/build_parasite.py
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import packlib  # noqa: E402

BP = os.path.join("behavior_packs", "Tiny_Parasite_BP")
RP = os.path.join("resource_packs", "Tiny_Parasite_RP")


def check_safety_valves(addon):
    """A self-replicating mob has to be stoppable and bounded.

    Everything below is a load-bearing safety property, not a style rule: if
    any of it goes missing the add-on can run a phone into the ground with no
    way back out.
    """
    script = packlib.read_text(os.path.join(BP, "scripts", "main.js"))

    if "MAX_PARASITES" not in script:
        addon.fail("scripts/main.js has no MAX_PARASITES population cap")
    else:
        cap = int(script.split("const MAX_PARASITES =")[1].split(";")[0].strip())
        if cap > 100:
            addon.fail(f"MAX_PARASITES is {cap}; anything over 100 will choke a phone")

    if "parasite_purge" not in os.listdir(os.path.join(BP, "functions")) and not os.path.isfile(
        os.path.join(BP, "functions", "parasite_purge.mcfunction")
    ):
        addon.fail("there is no parasite_purge function to stop an outbreak")

    if "breaksBlocks: false" not in script:
        addon.fail("the burst explosion must pass breaksBlocks: false so it cannot grief the world")

    # The parasite must despawn when far away, or a long session accumulates
    # thousands of them in chunks the player has walked away from.
    entity = packlib.load_json(addon, os.path.join(BP, "entities", "parasite.json"))
    if entity:
        components = entity["minecraft:entity"]["components"]
        if "minecraft:despawn" not in components:
            addon.fail("the parasite needs minecraft:despawn so abandoned ones clean themselves up")

        # It must never be able to target its own kind, or a swarm eats itself
        # and spreads without ever touching a real host.
        blob = json.dumps(entity)
        if '"value": "parasite"' not in blob or '"!="' not in blob:
            addon.fail("the parasite's targeting does not exclude the parasite family")


def main():
    addon = packlib.Addon(
        name="Tiny Parasite",
        bp=BP,
        rp=RP,
        namespace="tp",
        entity_id="tp:parasite",
        client_entity="parasite.entity.json",
        entity_file="parasite.json",
        archive=os.path.join("dist", "Tiny_Parasite.mcaddon"),
        folder_bp="Tiny_Parasite_BP",
        folder_rp="Tiny_Parasite_RP",
        script_modules={"@minecraft/server": "1.11.0"},
        other_packs=[
            os.path.join("behavior_packs", "arcane_arsenal_bp"),
            os.path.join("resource_packs", "arcane_arsenal_rp"),
            os.path.join("behavior_packs", "Builder_Buddy_BP"),
            os.path.join("resource_packs", "Builder_Buddy_RP"),
        ],
        required_pngs=[
            os.path.join(RP, "textures", "entity", "parasite.png"),
            os.path.join(RP, "textures", "items", "tp_parasite_serum.png"),
            os.path.join(RP, "textures", "items", "tp_parasite_spawn_egg.png"),
        ],
        skin=(os.path.join(RP, "textures", "entity", "parasite.png"), (32, 32)),
        required_functions=["parasite_purge", "parasite_spawn", "parasite_status"],
    )
    return packlib.run(addon, extra_checks=[check_safety_valves])


if __name__ == "__main__":
    sys.exit(main())
