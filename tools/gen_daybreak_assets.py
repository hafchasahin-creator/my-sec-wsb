#!/usr/bin/env python3
"""Generate the repetitive Daybreak JSON: geometry, items, blocks, client
entities, attachables, spawn rules, texture atlases and both .lang files.

The bespoke files - monster behaviours, scripts, functions, loot tables,
animations, fogs - are hand written and live in the packs. Everything in here
is schema-identical boilerplate that is safer to derive from one table than to
copy by hand twenty-five times.

Usage:  python3 tools/gen_daybreak_assets.py
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from daybreak_models import MODELS, SURVIVOR_ROLES, SUIT_PIECES  # noqa: E402

BP = os.path.join("behavior_packs", "daybreak_bp")
RP = os.path.join("resource_packs", "daybreak_rp")

NS = "daybreak"


def write_json(path, document):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(document, handle, indent=2)
        handle.write("\n")


# ==========================================================================
# Items
# ==========================================================================

CARD_LEVELS = {
    1: "Maintenance and surface airlocks.",
    2: "Laboratories and medical wing.",
    3: "Containment corridors and armoury.",
    4: "Blast doors and generator control.",
    5: "Site director. Sun anomaly archive.",
}

ITEMS = [
    # ---- protective equipment -------------------------------------------
    dict(key="suit_helmet", name="Daybreak Suit Helmet", group="itemGroup.name.helmet",
         wearable="slot.armor.head", protection=3, durability=300, enchant="armor_head"),
    dict(key="suit_chestplate", name="Daybreak Suit Chestpiece", group="itemGroup.name.chestplate",
         wearable="slot.armor.chest", protection=6, durability=380, enchant="armor_torso"),
    dict(key="suit_leggings", name="Daybreak Suit Leggings", group="itemGroup.name.leggings",
         wearable="slot.armor.legs", protection=5, durability=350, enchant="armor_legs"),
    dict(key="suit_boots", name="Daybreak Suit Boots", group="itemGroup.name.boots",
         wearable="slot.armor.feet", protection=3, durability=300, enchant="armor_feet"),
    dict(key="sun_hood", name="Reinforced Sun Hood", group="itemGroup.name.helmet",
         wearable="slot.armor.head", protection=1, durability=90),
    dict(key="gas_mask", name="Gas Mask", group="itemGroup.name.helmet",
         wearable="slot.armor.head", protection=1, durability=260),
    # ---- devices ---------------------------------------------------------
    dict(key="uv_detector", name="UV Exposure Detector", category="tools",
         durability=0, stack=1, hand=True, use_duration=0.1, cooldown=("daybreak_detector", 0.6)),
    dict(key="flashlight", name="Flashlight", category="tools",
         durability=420, stack=1, hand=True, use_duration=0.1,
         repair=[("daybreak:battery", 140)], cooldown=("daybreak_light", 0.4)),
    dict(key="battery", name="Battery", category="items", stack=16),
    dict(key="emergency_flare", name="Emergency Flare", category="tools", stack=16,
         hand=True, use_duration=0.1, cooldown=("daybreak_flare", 2.0)),
    dict(key="radio", name="Field Radio", category="tools", stack=1, hand=True,
         use_duration=0.1, cooldown=("daybreak_radio", 3.0)),
    dict(key="research_document", name="Research Document", category="items", stack=16,
         use_duration=0.1, cooldown=("daybreak_doc", 1.0)),
    # ---- consumables -----------------------------------------------------
    dict(key="medical_kit", name="Medical Kit", category="items", stack=8,
         food=(4, "low"), animation="eat", use_duration=2.0),
    dict(key="canned_food", name="Canned Food", category="items", stack=16,
         food=(6, "normal"), animation="eat", use_duration=1.6),
    dict(key="emergency_water", name="Emergency Water", category="items", stack=16,
         food=(2, "low"), animation="drink", use_duration=1.6),
    # ---- keys and materials ---------------------------------------------
    dict(key="bunker_key", name="Bunker Key", category="items", stack=1, glint=True),
    dict(key="survival_starter", name="Daybreak Survival Starter", category="items",
         stack=1, glint=True, use_duration=0.1, cooldown=("daybreak_starter", 2.0)),
    dict(key="scrap_plating", name="Scrap Plating", category="items", stack=64),
    dict(key="uv_lens", name="UV Lens", category="items", stack=64),
    dict(key="flesh_sample", name="Flesh Sample", category="items", stack=64),
]

for level, blurb in CARD_LEVELS.items():
    ITEMS.append(dict(
        key=f"access_card_{level}", name=f"Level {level} Access Card",
        category="items", stack=1, glint=level >= 4, lore=blurb,
    ))


def build_item(spec):
    key = spec["key"]
    components = {
        "minecraft:icon": {"textures": {"default": key}},
        "minecraft:display_name": {"value": spec["name"]},
        "minecraft:max_stack_size": spec.get("stack", 1),
    }

    if spec.get("wearable"):
        components["minecraft:wearable"] = {
            "slot": spec["wearable"],
            "protection": spec.get("protection", 1),
        }
    if spec.get("durability"):
        components["minecraft:durability"] = {"max_durability": spec["durability"]}
    if spec.get("enchant"):
        components["minecraft:enchantable"] = {"value": 10, "slot": spec["enchant"]}
    if spec.get("hand"):
        components["minecraft:hand_equipped"] = True
    if spec.get("glint"):
        components["minecraft:glint"] = True
    if spec.get("food"):
        nutrition, saturation = spec["food"]
        components["minecraft:food"] = {
            "nutrition": nutrition,
            "saturation_modifier": saturation,
            "can_always_eat": True,
        }
    if spec.get("animation"):
        components["minecraft:use_animation"] = spec["animation"]
    if spec.get("use_duration"):
        components["minecraft:use_modifiers"] = {
            "use_duration": spec["use_duration"],
            "movement_modifier": 0.6 if spec.get("food") else 1.0,
        }
    if spec.get("cooldown"):
        category, duration = spec["cooldown"]
        components["minecraft:cooldown"] = {"category": category, "duration": duration}

    repair = list(spec.get("repair", []))
    if spec.get("wearable") and spec.get("durability"):
        repair.append((f"{NS}:scrap_plating", 60))
    if repair:
        components["minecraft:repairable"] = {
            "repair_items": [
                {"items": [item], "repair_amount": amount} for item, amount in repair
            ]
        }

    tags = [f"{NS}:gear"]
    if spec.get("key", "").startswith("access_card"):
        tags.append(f"{NS}:access_card")
    if spec.get("wearable"):
        tags.append(f"{NS}:protective")
    components["minecraft:tags"] = {"tags": tags}

    return {
        "format_version": "1.21.0",
        "minecraft:item": {
            "description": {
                "identifier": f"{NS}:{key}",
                "menu_category": {
                    "category": spec.get("category", "equipment"),
                    **({"group": spec["group"]} if spec.get("group") else {}),
                },
            },
            "components": components,
        },
    }


# ==========================================================================
# Blocks - card operated doors
# ==========================================================================

BLOCKS = [
    dict(key="security_door", name="Security Door", level=1, texture="daybreak_security_door",
         map_colour="#6a7076", hardness=18),
    dict(key="lab_door", name="Laboratory Door", level=2, texture="daybreak_lab_door",
         map_colour="#c8cace", hardness=18),
    dict(key="blast_door", name="Blast Door", level=4, texture="daybreak_blast_door",
         map_colour="#5e5a52", hardness=32),
    dict(key="bunker_door", name="Bunker Door", level=0, texture="daybreak_bunker_door",
         map_colour="#7a644a", hardness=24),
]


def build_block(spec):
    return {
        "format_version": "1.21.0",
        "minecraft:block": {
            "description": {
                "identifier": f"{NS}:{spec['key']}",
                "menu_category": {"category": "construction"},
            },
            "components": {
                "minecraft:display_name": spec["name"],
                "minecraft:material_instances": {
                    "*": {"texture": spec["texture"], "render_method": "opaque"}
                },
                "minecraft:map_color": spec["map_colour"],
                "minecraft:destructible_by_mining": {"seconds_to_destroy": spec["hardness"]},
                "minecraft:destructible_by_explosion": {"explosion_resistance": 1200},
                "minecraft:friction": 0.6,
            },
        },
    }


# ==========================================================================
# Entities
# ==========================================================================

MONSTERS = [
    dict(key="melted_survivor", name="Melted Survivor", texture="melted_survivor",
         model="melted_survivor", controller="humanoid", egg=("#7a2b26", "#d8c07a")),
    dict(key="flesh_mass", name="Flesh Mass", texture="flesh_mass",
         model="flesh_mass", controller="mass", egg=("#4a1a1e", "#a8564e")),
    dict(key="crawling_melt", name="Crawling Melt", texture="crawling_melt",
         model="crawling_melt", controller="quad", egg=("#a25246", "#ecd6a0")),
    dict(key="flesh_assimilator", name="Flesh Assimilator", texture="assimilator",
         model="assimilator", controller="humanoid", egg=("#8a6054", "#f2e2a8")),
]

MIMIC = dict(key="mimic_survivor", name="Mimic Survivor", egg=("#807682", "#8a3a32"))

MARKERS = [
    dict(key="contamination_marker", name="Contamination Source"),
    dict(key="alarm_marker", name="Facility Alarm"),
]

FLARE = dict(key="flare", name="Burning Flare")


def client_entity(identifier, texture, geometry, controller, egg=None,
                  material="entity_alphatest", extra_animations=None):
    animations = {
        "idle": f"animation.{NS}.{controller}.idle",
        "walk": f"animation.{NS}.{controller}.walk",
        "attack": f"animation.{NS}.{controller}.attack",
        "look_at_target": f"animation.{NS}.look_at_target",
        "controller": f"controller.animation.{NS}.{controller}",
    }
    if extra_animations:
        animations.update(extra_animations)

    description = {
        "identifier": identifier,
        "materials": {"default": material},
        "textures": {"default": texture},
        "geometry": {"default": geometry},
        "render_controllers": [f"controller.render.{NS}.default"],
        "animations": animations,
        "scripts": {"animate": ["controller"]},
    }
    if egg:
        description["spawn_egg"] = {"base_color": egg[0], "overlay_color": egg[1]}
    return {"format_version": "1.10.0", "minecraft:client_entity": {"description": description}}


def survivor_entity(role, display):
    """Behaviour definition for one survivor type.

    All five share a shape: skittish in the open, rescuable with food or a
    medical kit, and able to be transformed by the sun like anything else
    alive. The guard is the only one that picks a fight on its own.
    """
    identifier = f"{NS}:survivor_{role}"
    fights = role in ("guard", "engineer")
    health = {"guard": 26, "medic": 20, "scientist": 16, "engineer": 22, "civilian": 18}[role]
    damage = {"guard": 6, "engineer": 4, "medic": 2, "scientist": 2, "civilian": 2}[role]

    rescued = {
        "minecraft:is_tamed": {},
        "minecraft:health": {"value": health + 6, "max": health + 6},
        "minecraft:behavior.follow_owner": {
            "priority": 4, "speed_multiplier": 1.1,
            "start_distance": 7, "stop_distance": 2.5,
        },
        "minecraft:persistent": {},
        "minecraft:type_family": {"family": ["survivor", "daybreak_rescued", "mob"]},
    }
    if fights:
        rescued["minecraft:behavior.nearest_attackable_target"] = {
            "priority": 3,
            "must_see": True,
            "must_see_forget_duration": 8.0,
            "within_default_and_max_radius": True,
            "entity_types": [{
                "filters": {"test": "is_family", "subject": "other", "value": "daybreak_monster"},
                "max_dist": 14,
            }],
        }
        rescued["minecraft:behavior.melee_attack"] = {"priority": 5, "speed_multiplier": 1.1}

    return {
        "format_version": "1.21.0",
        "minecraft:entity": {
            "description": {
                "identifier": identifier,
                "is_spawnable": True,
                "is_summonable": True,
                "is_experimental": False,
            },
            "component_groups": {
                f"{NS}:rescued": rescued,
                f"{NS}:panicking": {
                    "minecraft:movement": {"value": 0.32},
                    "minecraft:behavior.panic": {"priority": 1, "speed_multiplier": 1.35},
                },
            },
            "components": {
                "minecraft:type_family": {"family": ["survivor", "mob"]},
                "minecraft:health": {"value": health, "max": health},
                "minecraft:movement": {"value": 0.25},
                "minecraft:navigation.walk": {
                    "can_path_over_water": True, "avoid_water": True, "can_open_doors": True,
                },
                "minecraft:movement.basic": {},
                "minecraft:jump.static": {},
                "minecraft:can_climb": {},
                "minecraft:physics": {},
                "minecraft:pushable": {"is_pushable": True, "is_pushable_by_piston": True},
                "minecraft:collision_box": {"width": 0.6, "height": 1.9},
                "minecraft:attack": {"damage": damage},
                "minecraft:nameable": {},
                "minecraft:breathable": {"total_supply": 15, "suffocate_time": 0},
                "minecraft:despawn": {
                    "despawn_from_distance": {"max_distance": 96, "min_distance": 64},
                    "min_range_random_chance": 4,
                },
                "minecraft:tameable": {
                    "probability": 0.55,
                    "tame_items": [f"{NS}:canned_food", f"{NS}:medical_kit", f"{NS}:emergency_water"],
                    "tame_event": {"event": f"{NS}:on_rescued", "target": "self"},
                },
                "minecraft:loot": {"table": f"loot_tables/entities/survivor_{role}.json"},
                "minecraft:ambient_sound_interval": {
                    "value": 22.0, "range": 18.0, "event_name": "ambient",
                },
                "minecraft:behavior.float": {"priority": 0},
                "minecraft:behavior.panic": {"priority": 1, "speed_multiplier": 1.3},
                "minecraft:behavior.avoid_mob_type": {
                    "priority": 2,
                    "entity_types": [{
                        "filters": {"test": "is_family", "subject": "other", "value": "daybreak_monster"},
                        "max_dist": 12, "walk_speed_multiplier": 1.4, "sprint_speed_multiplier": 1.5,
                    }],
                },
                "minecraft:behavior.hurt_by_target": {"priority": 3},
                "minecraft:behavior.random_stroll": {"priority": 7, "speed_multiplier": 0.85},
                "minecraft:behavior.look_at_player": {
                    "priority": 8, "look_distance": 8, "probability": 0.03,
                },
                "minecraft:behavior.random_look_around": {"priority": 9},
            },
            "events": {
                f"{NS}:on_rescued": {"add": {"component_groups": [f"{NS}:rescued"]}},
                f"{NS}:panic": {"add": {"component_groups": [f"{NS}:panicking"]}},
                f"{NS}:calm": {"remove": {"component_groups": [f"{NS}:panicking"]}},
            },
        },
    }


def spawn_rule(identifier, weight, herd, surface=True, underground=False,
               brightness=None, population="monster"):
    condition = {
        "minecraft:spawns_on_surface": {} if surface else None,
        "minecraft:spawns_underground": {} if underground else None,
        "minecraft:difficulty_filter": {"min": "easy", "max": "hard"},
        "minecraft:weight": {"default": weight},
        "minecraft:herd": {"min_size": herd[0], "max_size": herd[1]},
        "minecraft:biome_filter": {
            "test": "has_biome_tag", "operator": "==", "value": "overworld",
        },
    }
    if brightness:
        condition["minecraft:brightness_filter"] = {
            "min": brightness[0], "max": brightness[1], "adjust_for_weather": False,
        }
    condition = {key: value for key, value in condition.items() if value is not None}
    return {
        "format_version": "1.8.0",
        "minecraft:spawn_rules": {
            "description": {"identifier": identifier, "population_control": population},
            "conditions": [condition],
        },
    }


# ==========================================================================
# Emit
# ==========================================================================

def emit_geometry():
    count = 0
    for key, model in MODELS.items():
        width, height = model["texture"]
        bounds_w, bounds_h, offset = model["bounds"]
        document = {
            "format_version": "1.12.0",
            "minecraft:geometry": [{
                "description": {
                    "identifier": model["identifier"],
                    "texture_width": width,
                    "texture_height": height,
                    "visible_bounds_width": bounds_w,
                    "visible_bounds_height": bounds_h,
                    "visible_bounds_offset": offset,
                },
                "bones": model["bones"],
            }],
        }
        write_json(os.path.join(RP, "models", "entity", f"{NS}_{key}.geo.json"), document)
        count += 1
    return count


def emit_items():
    for spec in ITEMS:
        write_json(os.path.join(BP, "items", f"{spec['key']}.json"), build_item(spec))
    return len(ITEMS)


def emit_blocks():
    for spec in BLOCKS:
        write_json(os.path.join(BP, "blocks", f"{spec['key']}.json"), build_block(spec))
    return len(BLOCKS)


def emit_client_entities():
    count = 0
    texture_dir = f"textures/entity/{NS}"

    for spec in MONSTERS:
        write_json(
            os.path.join(RP, "entity", f"{spec['key']}.entity.json"),
            client_entity(
                f"{NS}:{spec['key']}",
                f"{texture_dir}/{spec['texture']}",
                MODELS[spec["model"]]["identifier"],
                spec["controller"],
                egg=spec["egg"],
            ),
        )
        count += 1

    # The mimic swaps skin *and* skeleton the moment it drops the act.
    mimic = client_entity(
        f"{NS}:{MIMIC['key']}",
        f"{texture_dir}/mimic_human",
        MODELS["survivor"]["identifier"],
        "humanoid",
        egg=MIMIC["egg"],
    )
    description = mimic["minecraft:client_entity"]["description"]
    description["textures"] = {
        "default": f"{texture_dir}/mimic_human",
        "revealed": f"{texture_dir}/mimic_revealed",
    }
    description["geometry"] = {
        "default": MODELS["survivor"]["identifier"],
        "revealed": MODELS["melted_survivor"]["identifier"],
    }
    description["render_controllers"] = [f"controller.render.{NS}.mimic"]
    write_json(os.path.join(RP, "entity", f"{MIMIC['key']}.entity.json"), mimic)
    count += 1

    for role, display in SURVIVOR_ROLES:
        write_json(
            os.path.join(RP, "entity", f"survivor_{role}.entity.json"),
            client_entity(
                f"{NS}:survivor_{role}",
                f"{texture_dir}/survivor_{role}",
                MODELS["survivor"]["identifier"],
                "humanoid",
                egg=("#2f3a44", "#c9a06a"),
            ),
        )
        count += 1

    write_json(
        os.path.join(RP, "entity", "flare.entity.json"),
        client_entity(f"{NS}:{FLARE['key']}", f"{texture_dir}/flare",
                      MODELS["flare"]["identifier"], "prop"),
    )
    count += 1

    for spec in MARKERS:
        write_json(
            os.path.join(RP, "entity", f"{spec['key']}.entity.json"),
            client_entity(f"{NS}:{spec['key']}", f"{texture_dir}/marker",
                          MODELS["marker"]["identifier"], "prop"),
        )
        count += 1

    return count


def emit_survivors():
    for role, display in SURVIVOR_ROLES:
        write_json(os.path.join(BP, "entities", f"survivor_{role}.json"),
                   survivor_entity(role, display))
    return len(SURVIVOR_ROLES)


def emit_attachables():
    for model_key, item_key in SUIT_PIECES:
        document = {
            "format_version": "1.10.0",
            "minecraft:attachable": {
                "description": {
                    "identifier": f"{NS}:{item_key}",
                    "materials": {"default": "armor", "enchanted": "armor_enchanted"},
                    "textures": {
                        "default": "textures/models/armor/daybreak_suit",
                        "enchanted": "textures/misc/enchanted_actor_glint",
                    },
                    "geometry": {"default": MODELS[model_key]["identifier"]},
                    "render_controllers": [f"controller.render.{NS}.armor"],
                },
            },
        }
        write_json(os.path.join(RP, "attachables", f"{NS}_{item_key}.json"), document)
    return len(SUIT_PIECES)


def emit_spawn_rules():
    rules = [
        ("melted_survivor", spawn_rule(f"{NS}:melted_survivor", 12, (1, 2))),
        ("crawling_melt", spawn_rule(f"{NS}:crawling_melt", 10, (2, 3),
                                     surface=True, underground=True)),
        ("mimic_survivor", spawn_rule(f"{NS}:mimic_survivor", 3, (1, 1))),
        ("flesh_assimilator", spawn_rule(f"{NS}:flesh_assimilator", 4, (1, 1))),
        ("flesh_mass", spawn_rule(f"{NS}:flesh_mass", 2, (1, 1),
                                  brightness=(0, 7))),
    ]
    for key, document in rules:
        write_json(os.path.join(BP, "spawn_rules", f"{key}.json"), document)
    return len(rules)


def emit_atlases():
    item_data = {spec["key"]: {"textures": f"textures/items/{spec['key']}"} for spec in ITEMS}
    write_json(os.path.join(RP, "textures", "item_texture.json"), {
        "resource_pack_name": "daybreak",
        "texture_name": "atlas.items",
        "texture_data": item_data,
    })

    terrain = {spec["texture"]: {"textures": f"textures/blocks/{spec['texture']}"}
               for spec in BLOCKS}
    write_json(os.path.join(RP, "textures", "terrain_texture.json"), {
        "resource_pack_name": "daybreak",
        "texture_name": "atlas.terrain",
        "padding": 8,
        "num_mip_levels": 4,
        "texture_data": terrain,
    })
    return len(item_data) + len(terrain)


def emit_langs():
    lines = [
        "## Daybreak - English (US)",
        "",
        "pack.name=Daybreak RP",
        "pack.description=Anomalous sun, flesh creatures and facility blocks.",
        "",
        "## Items",
    ]
    for spec in ITEMS:
        identifier = f"item.{NS}:{spec['key']}"
        lines.append(f"{identifier}={spec['name']}")
        lines.append(f"{identifier}.name={spec['name']}")

    lines += ["", "## Blocks"]
    for spec in BLOCKS:
        lines.append(f"tile.{NS}:{spec['key']}.name={spec['name']}")

    lines += ["", "## Entities"]
    entities = (
        [(spec["key"], spec["name"]) for spec in MONSTERS]
        + [(MIMIC["key"], MIMIC["name"])]
        + [(f"survivor_{role}", display) for role, display in SURVIVOR_ROLES]
        + [(FLARE["key"], FLARE["name"])]
        + [(spec["key"], spec["name"]) for spec in MARKERS]
    )
    for key, display in entities:
        lines.append(f"entity.{NS}:{key}.name={display}")
    for key, display in entities:
        if key in ("flare", "contamination_marker", "alarm_marker"):
            continue
        lines.append(f"item.spawn_egg.entity.{NS}:{key}.name=Spawn {display}")

    lines += ["", "## Item lore / hints"]
    for level, blurb in CARD_LEVELS.items():
        lines.append(f"{NS}.card.{level}={blurb}")
    lines.append("")

    os.makedirs(os.path.join(RP, "texts"), exist_ok=True)
    with open(os.path.join(RP, "texts", "en_US.lang"), "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines))
    write_json(os.path.join(RP, "texts", "languages.json"), ["en_US"])

    os.makedirs(os.path.join(BP, "texts"), exist_ok=True)
    with open(os.path.join(BP, "texts", "en_US.lang"), "w", encoding="utf-8") as handle:
        handle.write(
            "## Daybreak - English (US)\n\n"
            "pack.name=Daybreak BP\n"
            "pack.description=When Day Breaks - the sun is anomalous and lethal.\n"
        )
    write_json(os.path.join(BP, "texts", "languages.json"), ["en_US"])
    return len(lines)


def main():
    print(f"geometry        : {emit_geometry()}")
    print(f"items           : {emit_items()}")
    print(f"blocks          : {emit_blocks()}")
    print(f"client entities : {emit_client_entities()}")
    print(f"survivors       : {emit_survivors()}")
    print(f"attachables     : {emit_attachables()}")
    print(f"spawn rules     : {emit_spawn_rules()}")
    print(f"atlas entries   : {emit_atlases()}")
    print(f"lang lines      : {emit_langs()}")


if __name__ == "__main__":
    main()
