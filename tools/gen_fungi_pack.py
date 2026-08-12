#!/usr/bin/env python3
"""Generate every JSON/text file in both Dangerous Fungi packs.

    python3 tools/gen_fungi_pack.py

Blocks, items, geometries, material bindings, particles, world-generation
features, functions, language files and the script data table are all derived
from tools/fungi_spec.py, so the twenty species stay consistent by construction.
"""

import json
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import fungi_shapes  # noqa: E402
import fungi_spec as spec  # noqa: E402

BP = spec.BP_DIR
RP = spec.RP_DIR

BLOCK_FORMAT = "1.21.0"
ITEM_FORMAT = "1.21.0"
GEO_FORMAT = "1.16.0"
FEATURE_FORMAT = "1.13.0"
PARTICLE_FORMAT = "1.10.0"
ATTACHABLE_FORMAT = "1.10.0"

FACES = ("north", "east", "south", "west", "up", "down")


def write_json(path, payload):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")


def write_text(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text)


def hexcolor(rgb):
    return "#{:02X}{:02X}{:02X}".format(*rgb)


# ==========================================================================
# Manifests
# ==========================================================================


def gen_manifests():
    write_json(
        os.path.join(BP, "manifest.json"),
        {
            "format_version": 2,
            "header": {
                "name": "Dangerous Fungi BP",
                "description": "Twenty fictional dangerous fungi, a fungal scanner and hazard gear. Behavior Pack.",
                "uuid": spec.UUIDS["bp_header"],
                "version": spec.PACK_VERSION,
                "min_engine_version": spec.MIN_ENGINE,
            },
            "modules": [
                {
                    "type": "data",
                    "uuid": spec.UUIDS["bp_data"],
                    "version": spec.PACK_VERSION,
                },
                {
                    "type": "script",
                    "language": "javascript",
                    "entry": "scripts/main.js",
                    "uuid": spec.UUIDS["bp_script"],
                    "version": spec.PACK_VERSION,
                },
            ],
            "dependencies": [
                {
                    "uuid": spec.UUIDS["rp_header"],
                    "version": spec.PACK_VERSION,
                },
                {"module_name": "@minecraft/server", "version": spec.SERVER_MODULE},
            ],
            "metadata": {
                "authors": ["Dangerous Fungi"],
                "license": "MIT",
                "product_type": "addon",
            },
        },
    )

    write_json(
        os.path.join(RP, "manifest.json"),
        {
            "format_version": 2,
            "header": {
                "name": "Dangerous Fungi RP",
                "description": "Models, textures, particles and names for the twenty dangerous fungi. Resource Pack.",
                "uuid": spec.UUIDS["rp_header"],
                "version": spec.PACK_VERSION,
                "min_engine_version": spec.MIN_ENGINE,
            },
            "modules": [
                {
                    "type": "resources",
                    "uuid": spec.UUIDS["rp_resources"],
                    "version": spec.PACK_VERSION,
                }
            ],
            # No dependencies: a resource pack must never depend on a behaviour
            # pack. The BP -> RP dependency alone is what makes the game pull
            # this pack in automatically when the add-on is applied to a world.
            "metadata": {
                "authors": ["Dangerous Fungi"],
                "license": "MIT",
                "product_type": "addon",
            },
        },
    )


# ==========================================================================
# Geometry
# ==========================================================================


def geo_identifier(shape_name):
    return f"geometry.fungi.{shape_name}"


def gen_geometries():
    for shape_name, shape in fungi_shapes.SHAPES.items():
        cubes = []
        for entry in shape["cubes"]:
            uv = {}
            for face in FACES:
                uv[face] = {"uv": [0, 0], "uv_size": [16, 16]}
                # "cap" is published as the block's default "*" instance, so cap
                # faces must name no instance at all and fall through to it.
                # Naming a material the block does not declare leaves the face
                # unskinned, so only the extra materials are named here.
                if entry["mat"] != "cap":
                    uv[face]["material_instance"] = entry["mat"]
            cube = {
                "origin": entry["origin"],
                "size": entry["size"],
                "uv": uv,
            }
            if "rotation" in entry:
                cube["rotation"] = entry["rotation"]
                cube["pivot"] = entry["pivot"]
            cubes.append(cube)

        write_json(
            os.path.join(RP, "models", "blocks", f"fungi_{shape_name}.geo.json"),
            {
                "format_version": GEO_FORMAT,
                "minecraft:geometry": [
                    {
                        "description": {
                            "identifier": geo_identifier(shape_name),
                            "texture_width": 16,
                            "texture_height": 16,
                            "visible_bounds_width": 2,
                            "visible_bounds_height": 2.5,
                            "visible_bounds_offset": [0, 0.75, 0],
                        },
                        "bones": [
                            {"name": "fungus", "pivot": [0, 0, 0], "cubes": cubes}
                        ],
                    }
                ],
            },
        )
    return len(fungi_shapes.SHAPES)


# ==========================================================================
# Blocks
# ==========================================================================


def texture_key(key, material):
    return f"fungi_{key}_{material}"


def gen_blocks():
    for sp in spec.SPECIES:
        shape_name = sp["shape"]
        shape = fungi_shapes.SHAPES[shape_name]
        materials = fungi_shapes.materials_used(shape_name)
        pal = sp["palette"]

        instances = {}
        for material in materials:
            entry = {
                "texture": texture_key(sp["key"], material),
                "render_method": "alpha_test",
            }
            if material == "glow" or sp["light"] >= 7:
                # Glowing parts should not be darkened by the face they sit on.
                entry["face_dimming"] = False
            instances["*" if material == "cap" else material] = entry

        components = {
            "minecraft:geometry": {"identifier": geo_identifier(shape_name)},
            "minecraft:material_instances": instances,
            "minecraft:collision_box": False,
            "minecraft:selection_box": fungi_shapes.selection_box(shape_name),
            "minecraft:destructible_by_mining": {"seconds_to_destroy": 0.25},
            "minecraft:destructible_by_explosion": {"explosion_resistance": 0.2},
            "minecraft:light_dampening": 0,
            "minecraft:light_emission": sp["light"],
            "minecraft:map_color": hexcolor(pal["cap"]),
        }
        if sp.get("flammable"):
            components["minecraft:flammable"] = {
                "catch_chance_modifier": 20,
                "destroy_chance_modifier": 60,
            }

        write_json(
            os.path.join(BP, "blocks", f"{sp['key']}.json"),
            {
                "format_version": BLOCK_FORMAT,
                "minecraft:block": {
                    "description": {
                        "identifier": spec.ident(sp["key"]),
                        "menu_category": {
                            "category": "nature",
                            "group": "itemGroup.name.mushroom",
                        },
                    },
                    "components": components,
                },
            },
        )
    return len(spec.SPECIES)


def gen_terrain_texture():
    data = {}
    for sp in spec.SPECIES:
        for material in fungi_shapes.materials_used(sp["shape"]):
            key = texture_key(sp["key"], material)
            data[key] = {"textures": f"textures/blocks/{key}"}
    write_json(
        os.path.join(RP, "textures", "terrain_texture.json"),
        {
            "resource_pack_name": "dangerous_fungi",
            "texture_name": "atlas.terrain",
            "padding": 8,
            "num_mip_levels": 4,
            "texture_data": data,
        },
    )
    return len(data)


# ==========================================================================
# Items
# ==========================================================================

ENCHANT_SLOT = {
    "slot.armor.head": "armor_head",
    "slot.armor.chest": "armor_torso",
    "slot.armor.legs": "armor_legs",
    "slot.armor.feet": "armor_feet",
}


def gen_items():
    for item in spec.EQUIPMENT:
        description = {
            "identifier": spec.ident(item["key"]),
            "menu_category": {"category": item["category"]},
        }
        if item.get("group"):
            description["menu_category"]["group"] = item["group"]

        components = {
            "minecraft:icon": {"textures": {"default": item["key"]}},
            "minecraft:max_stack_size": item.get("stack", 1),
        }

        if item["kind"] == "armor":
            components["minecraft:wearable"] = {
                "slot": item["slot"],
                "protection": item["protection"],
            }
            components["minecraft:durability"] = {"max_durability": item["durability"]}
            components["minecraft:repairable"] = {
                "repair_items": [
                    {
                        "items": ["minecraft:leather", "minecraft:iron_ingot"],
                        "repair_amount": max(20, item["durability"] // 8),
                    }
                ]
            }
            components["minecraft:enchantable"] = {
                "value": 10,
                "slot": ENCHANT_SLOT[item["slot"]],
            }
            # Only own-namespace tags: minecraft:* tags are engine-owned and a
            # pack that declares one can log a tag-registration error.
            components["minecraft:tags"] = {"tags": ["fungi:hazard_gear"]}
        else:
            components["minecraft:hand_equipped"] = True
            components["minecraft:use_modifiers"] = {
                "use_duration": 0.1,
                "movement_modifier": 1.0,
            }
            components["minecraft:cooldown"] = {
                "category": "fungal_scan",
                "duration": 0.6,
            }
            components["minecraft:tags"] = {"tags": ["fungi:tool"]}

        write_json(
            os.path.join(BP, "items", f"{item['key']}.json"),
            {
                "format_version": ITEM_FORMAT,
                "minecraft:item": {
                    "description": description,
                    "components": components,
                },
            },
        )
    return len(spec.EQUIPMENT)


def gen_item_texture():
    write_json(
        os.path.join(RP, "textures", "item_texture.json"),
        {
            "resource_pack_name": "dangerous_fungi",
            "texture_name": "atlas.items",
            "texture_data": {
                item["key"]: {"textures": f"textures/items/{item['key']}"}
                for item in spec.EQUIPMENT
            },
        },
    )


ARMOR_GEOMETRY = {
    "slot.armor.head": "geometry.humanoid.armor.helmet",
    "slot.armor.chest": "geometry.humanoid.armor.chestplate",
    "slot.armor.legs": "geometry.humanoid.armor.leggings",
    "slot.armor.feet": "geometry.humanoid.armor.boots",
}

ARMOR_HIDE = {
    "slot.armor.head": "variable.helmet_layer_visible = 0.0;",
    "slot.armor.chest": "variable.chest_layer_visible = 0.0;",
    "slot.armor.legs": "variable.leg_layer_visible = 0.0;",
    "slot.armor.feet": "variable.boot_layer_visible = 0.0;",
}


def gen_attachables():
    made = 0
    for item in spec.EQUIPMENT:
        if item["kind"] != "armor":
            continue
        if item["key"] == "spore_mask":
            texture = "textures/models/armor/spore_mask_layer_1"
        else:
            texture = f"textures/models/armor/hazard_layer_{item['layer']}"
        write_json(
            os.path.join(RP, "attachables", f"{item['key']}.json"),
            {
                "format_version": ATTACHABLE_FORMAT,
                "minecraft:attachable": {
                    "description": {
                        "identifier": spec.ident(item["key"]),
                        "materials": {
                            "default": "armor",
                            "enchanted": "armor_enchanted",
                        },
                        "textures": {
                            "default": texture,
                            "enchanted": "textures/misc/enchanted_item_glint",
                        },
                        "geometry": {"default": ARMOR_GEOMETRY[item["slot"]]},
                        "scripts": {"parent_setup": ARMOR_HIDE[item["slot"]]},
                        "render_controllers": ["controller.render.armor"],
                    }
                },
            },
        )
        made += 1
    return made


# ==========================================================================
# Particles
# ==========================================================================

PARTICLE_STYLES = {
    "rise": {
        "count": 4,
        "radius": 0.45,
        "speed": 0.35,
        "life": 1.4,
        "accel": [0, 0.55, 0],
        "drag": 1.6,
        "direction": "outwards",
    },
    "drift": {
        "count": 4,
        "radius": 0.5,
        "speed": 0.28,
        "life": 1.6,
        "accel": [0, 0.12, 0],
        "drag": 1.2,
        "direction": "outwards",
    },
    "sink": {
        "count": 4,
        "radius": 0.5,
        "speed": 0.22,
        "life": 1.5,
        "accel": [0, -0.5, 0],
        "drag": 1.0,
        "direction": "outwards",
    },
    "burst": {
        "count": 8,
        "radius": 0.35,
        "speed": 1.1,
        "life": 1.1,
        "accel": [0, 0.2, 0],
        "drag": 2.6,
        "direction": "outwards",
    },
    "spark": {
        "count": 5,
        "radius": 0.4,
        "speed": 0.9,
        "life": 0.5,
        "accel": [0, -0.4, 0],
        "drag": 2.2,
        "direction": "outwards",
    },
    "smoke": {
        "count": 3,
        "radius": 0.4,
        "speed": 0.18,
        "life": 2.0,
        "accel": [0, 0.35, 0],
        "drag": 1.8,
        "direction": "outwards",
    },
    "drip": {
        "count": 3,
        "radius": 0.4,
        "speed": 0.12,
        "life": 1.3,
        "accel": [0, -1.4, 0],
        "drag": 0.4,
        "direction": "outwards",
    },
}


def particle_id(key):
    return f"{spec.NAMESPACE}:{key}_spore"


def gen_particles():
    for sp in spec.SPECIES:
        cfg = sp["particle"]
        style = PARTICLE_STYLES[cfg["style"]]
        r, g, b = cfg["color"]
        size = cfg["size"]
        texture = (
            "textures/particle/fungal_smoke"
            if cfg["style"] == "smoke"
            else "textures/particle/fungal_spore"
        )

        components = {
            "minecraft:emitter_local_space": {"position": True, "rotation": False},
            "minecraft:emitter_rate_instant": {"num_particles": style["count"]},
            "minecraft:emitter_lifetime_once": {"active_time": 0.25},
            "minecraft:emitter_shape_sphere": {
                "radius": style["radius"],
                "direction": style["direction"],
            },
            "minecraft:particle_initial_speed": style["speed"],
            "minecraft:particle_lifetime_expression": {
                "max_lifetime": style["life"]
            },
            "minecraft:particle_motion_dynamic": {
                "linear_acceleration": style["accel"],
                "linear_drag_coefficient": style["drag"],
            },
            "minecraft:particle_appearance_billboard": {
                "size": [size, size],
                "facing_camera_mode": "lookat_xyz",
                "uv": {
                    "texture_width": 8,
                    "texture_height": 8,
                    "uv": [0, 0],
                    "uv_size": [8, 8],
                },
            },
            "minecraft:particle_appearance_tinting": {
                "color": [
                    round(r, 3),
                    round(g, 3),
                    round(b, 3),
                    "math.max(0.0, 1.0 - (variable.particle_age / variable.particle_lifetime))",
                ]
            },
        }
        if not cfg.get("glow"):
            components["minecraft:particle_appearance_lighting"] = {}

        write_json(
            os.path.join(RP, "particles", f"{sp['key']}_spore.json"),
            {
                "format_version": PARTICLE_FORMAT,
                "particle_effect": {
                    "description": {
                        "identifier": particle_id(sp["key"]),
                        "basic_render_parameters": {
                            "material": "particles_blend",
                            "texture": texture,
                        },
                    },
                    "components": components,
                },
            },
        )
    return len(spec.SPECIES)


# ==========================================================================
# World generation
# ==========================================================================


def feature_id(key):
    return f"{spec.NAMESPACE}:{key}_feature"


def rule_id(key):
    return f"{spec.NAMESPACE}:{key}_rule"


def gen_features():
    for sp in spec.SPECIES:
        gen = sp["gen"]
        write_json(
            os.path.join(BP, "features", f"{sp['key']}_feature.json"),
            {
                "format_version": FEATURE_FORMAT,
                "minecraft:single_block_feature": {
                    "description": {"identifier": feature_id(sp["key"])},
                    "places_block": spec.ident(sp["key"]),
                    "enforce_placement_rules": False,
                    "enforce_survivability_rules": False,
                    "may_replace": ["minecraft:air"],
                    "may_attach_to": {
                        "min_sides_must_attach": 1,
                        "auto_rotate": False,
                        "bottom": gen["attach"],
                    },
                },
            },
        )

        numerator, denominator = gen["chance"]
        distribution = {
            "iterations": gen["iterations"],
            "scatter_chance": {"numerator": numerator, "denominator": denominator},
            "x": {"distribution": "uniform", "extent": [0, 15]},
            "z": {"distribution": "uniform", "extent": [0, 15]},
        }
        if gen["y"] is None:
            distribution["y"] = "query.heightmap(variable.worldx, variable.worldz)"
        else:
            distribution["y"] = {
                "distribution": "uniform",
                "extent": list(gen["y"]),
            }

        biome_filter = [
            {"test": "has_biome_tag", "operator": "==", "value": tag}
            for tag in gen["biomes"]
        ]

        write_json(
            os.path.join(BP, "feature_rules", f"{sp['key']}_rule.json"),
            {
                "format_version": FEATURE_FORMAT,
                "minecraft:feature_rules": {
                    "description": {
                        "identifier": rule_id(sp["key"]),
                        "places_feature": feature_id(sp["key"]),
                    },
                    "conditions": {
                        "placement_pass": gen["pass"],
                        "minecraft:biome_filter": biome_filter,
                    },
                    "distribution": distribution,
                },
            },
        )
    return len(spec.SPECIES)


# ==========================================================================
# Functions
# ==========================================================================

DANGER_BLOCK = {
    1: "minecraft:emerald_block",
    2: "minecraft:gold_block",
    3: "minecraft:copper_block",
    4: "minecraft:redstone_block",
    5: "minecraft:obsidian",
}


def raw(text):
    return json.dumps({"rawtext": [{"text": text}]}, separators=(",", ":"))


def gen_functions():
    directory = os.path.join(BP, "functions")
    os.makedirs(directory, exist_ok=True)
    files = {}

    # -- help -------------------------------------------------------------
    help_lines = [
        "# Dangerous Fungi - command reference",
        f"tellraw @s {raw('§2§l=== DANGEROUS FUNGI ===§r')}",
        f"tellraw @s {raw('§720 fictional fungal species. Danger I to V.')}",
        f"tellraw @s {raw('§a/function fungi_give_all§7 - every fungus, the scanner and the hazard set')}",
        f"tellraw @s {raw('§a/function fungi_test_area§7 - build a labelled testing field')}",
        f"tellraw @s {raw('§a/function fungi_clear_effects§7 - clear effects, contamination and infection')}",
        f"tellraw @s {raw('§a/function fungi_spread_on§7 - allow Creeping Mold / Mycelium-X to spread')}",
        f"tellraw @s {raw('§a/function fungi_spread_off§7 - stop all spreading (default is on)')}",
        f"tellraw @s {raw('§a/function fungi_emergency_cleanup§7 - delete every fungus within 12 blocks')}",
        f"tellraw @s {raw('§a/function fungi_danger_list§7 - list all 20 species and danger levels')}",
        f"tellraw @s {raw('§a/function fungi_status§7 - add-on status and current settings')}",
        f"tellraw @s {raw('§7Hold the §fFungal Scanner§7 and use it to analyse nearby growths.')}",
        f"tellraw @s {raw('§7Search the Creative inventory for any species name, e.g. §fBloodcap§7.')}",
    ]
    files["fungi_help"] = "\n".join(help_lines)

    # -- give all ---------------------------------------------------------
    give_lines = ["# Every fungus, the scanner and the full hazard set"]
    for sp in spec.SPECIES:
        give_lines.append(f"give @s {spec.ident(sp['key'])} 8")
    for item in spec.EQUIPMENT:
        give_lines.append(f"give @s {spec.ident(item['key'])} 1")
    give_lines.append(
        f"tellraw @s {raw('§a[Fungi] §7Given all 20 species, the Fungal Scanner and the hazard set.')}"
    )
    files["fungi_give_all"] = "\n".join(give_lines)

    # -- danger list ------------------------------------------------------
    danger_lines = [
        "# Species roster",
        f"tellraw @s {raw('§2§l=== SPECIES ROSTER ===§r')}",
    ]
    tint = {1: "§a", 2: "§e", 3: "§6", 4: "§c", 5: "§d"}
    for index, sp in enumerate(sorted(spec.SPECIES, key=lambda s: (s["danger"], s["name"])), 1):
        colour = tint[sp["danger"]]
        line = (
            f"§7{index:2d}. §f{sp['name']} {colour}"
            f"{spec.DANGER_NAMES[sp['danger']].split(' - ')[0]}"
            f" §8| §7{sp['habitat']}"
        )
        danger_lines.append(f"tellraw @s {raw(line)}")
    files["fungi_danger_list"] = "\n".join(danger_lines)

    # -- effects / spreading / cleanup ------------------------------------
    files["fungi_clear_effects"] = "\n".join(
        [
            "# Clear vanilla effects plus the add-on's own status tracks",
            "effect @s clear",
            "scriptevent fungi:cure",
            f"tellraw @s {raw('§a[Fungi] §7Effects, contamination and infection cleared.')}",
        ]
    )
    files["fungi_spread_on"] = "\n".join(
        [
            "# Re-enable the strictly rate-limited spreading system",
            "scriptevent fungi:spread_on",
        ]
    )
    files["fungi_spread_off"] = "\n".join(
        [
            "# Stop Creeping Mold and Mycelium-X from spreading at all",
            "scriptevent fungi:spread_off",
        ]
    )
    files["fungi_emergency_cleanup"] = "\n".join(
        [
            "# Remove every custom fungus within 12 blocks and clear your status",
            "effect @s clear",
            "scriptevent fungi:cleanup",
        ]
    )
    files["fungi_status"] = "\n".join(
        ["# Report add-on version, spreading state and nearby growth count", "scriptevent fungi:status"]
    )

    # -- test area --------------------------------------------------------
    test_lines = [
        "# Flatten a 49x49 plot, floor it, and let the script place the exhibits",
        f"tellraw @s {raw('§a[Fungi] §7Building the testing field... stand still for a moment.')}",
        "fill ~-24 ~-1 ~-24 ~24 ~-1 ~24 minecraft:polished_andesite",
        "fill ~-24 ~ ~-24 ~24 ~9 ~24 air",
        # 'hollow' on a single-layer box leaves just the perimeter, marking the
        # edge of the field without walling the player in.
        "fill ~-25 ~ ~-25 ~25 ~ ~25 minecraft:glass hollow",
        "scriptevent fungi:test_area",
    ]
    files["fungi_test_area"] = "\n".join(test_lines)

    for name, body in files.items():
        write_text(os.path.join(directory, f"{name}.mcfunction"), body + "\n")
    return len(files)


# ==========================================================================
# Language files
# ==========================================================================


def gen_lang():
    rp_lines = [
        "pack.name=Dangerous Fungi RP",
        "pack.description=Models, textures and particles for the twenty dangerous fungi.",
        "",
        "## Fungus blocks",
    ]
    for sp in spec.SPECIES:
        rp_lines.append(f"tile.{spec.ident(sp['key'])}.name={sp['name']}")
    rp_lines += ["", "## Equipment"]
    for item in spec.EQUIPMENT:
        rp_lines.append(f"item.{spec.ident(item['key'])}.name={item['name']}")
    write_text(os.path.join(RP, "texts", "en_US.lang"), "\n".join(rp_lines) + "\n")
    write_json(os.path.join(RP, "texts", "languages.json"), ["en_US"])

    bp_lines = [
        "pack.name=Dangerous Fungi BP",
        "pack.description=Twenty fictional dangerous fungi, a scanner and hazard gear.",
    ]
    write_text(os.path.join(BP, "texts", "en_US.lang"), "\n".join(bp_lines) + "\n")
    write_json(os.path.join(BP, "texts", "languages.json"), ["en_US"])


# ==========================================================================
# Script data table
# ==========================================================================


def gen_script_data():
    entries = []
    for sp in spec.SPECIES:
        payload = {
            "id": spec.ident(sp["key"]),
            "key": sp["key"],
            "name": sp["name"],
            "danger": sp["danger"],
            "range": sp["range"],
            "damage": sp["damage"],
            "contact": sp["contact"],
            "pulse": sp["pulse"],
            "effects": [
                {"id": eid, "ticks": ticks, "amp": amp}
                for eid, ticks, amp in sp["effects"]
            ],
            "particle": particle_id(sp["key"]),
            "habitat": sp["habitat"],
            "desc": sp["desc"],
        }
        for flag in ("ignites", "contaminates", "infects", "hurts_mobs"):
            if sp.get(flag):
                payload[flag] = True
        if sp.get("spreads"):
            payload["spreads"] = sp["spreads"]
        entries.append(payload)

    equipment = {
        "scanner": spec.ident("fungal_scanner"),
        "mask": spec.ident("spore_mask"),
        "head": spec.ident("hazard_helmet"),
        "chest": spec.ident("hazard_chestplate"),
        "legs": spec.ident("hazard_leggings"),
        "feet": spec.ident("hazard_boots"),
    }

    body = [
        "/*",
        " * GENERATED FILE - edit tools/fungi_spec.py and re-run",
        " * python3 tools/gen_fungi_pack.py instead of editing this by hand.",
        " */",
        "",
        "export const VERSION = \"%d.%d.%d\";" % tuple(spec.PACK_VERSION),
        "",
        "export const DANGER_NAMES = %s;"
        % json.dumps(
            {str(k): v for k, v in spec.DANGER_NAMES.items()}, indent=2
        ),
        "",
        "export const EQUIPMENT = %s;" % json.dumps(equipment, indent=2),
        "",
        "export const SPECIES = %s;" % json.dumps(entries, indent=2),
        "",
        "/** typeId -> species record, built once at load. */",
        "export const BY_ID = Object.create(null);",
        "for (const entry of SPECIES) BY_ID[entry.id] = entry;",
        "",
        "export const DANGER_BLOCK = %s;" % json.dumps(
            {str(k): v for k, v in DANGER_BLOCK.items()}, indent=2
        ),
        "",
    ]
    write_text(os.path.join(BP, "scripts", "fungi_data.js"), "\n".join(body))
    return len(entries)


# ==========================================================================
# Driver
# ==========================================================================


def clean_generated():
    """Remove generated trees so renamed files never linger in the package."""
    for path in (
        os.path.join(BP, "blocks"),
        os.path.join(BP, "items"),
        os.path.join(BP, "features"),
        os.path.join(BP, "feature_rules"),
        os.path.join(BP, "functions"),
        os.path.join(RP, "particles"),
        os.path.join(RP, "attachables"),
        os.path.join(RP, "models"),
    ):
        shutil.rmtree(path, ignore_errors=True)


def main():
    problems = fungi_shapes.validate()
    if problems:
        print("Geometry out of bounds:\n  " + "\n  ".join(problems), file=sys.stderr)
        return 1

    clean_generated()
    gen_manifests()
    shapes = gen_geometries()
    blocks = gen_blocks()
    textures = gen_terrain_texture()
    items = gen_items()
    gen_item_texture()
    attachables = gen_attachables()
    particles = gen_particles()
    features = gen_features()
    functions = gen_functions()
    gen_lang()
    species = gen_script_data()

    print(
        f"Generated: {blocks} blocks, {shapes} geometries, {textures} block textures, "
        f"{items} items, {attachables} attachables, {particles} particles, "
        f"{features} feature+rule pairs, {functions} functions, {species} script records."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
