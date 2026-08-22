#!/usr/bin/env python3
"""Generate behavior_packs/bodyguard_bp/entities/bodyguard.json.

Kept as a generator because the entity has 5 modes x 5 gear tiers of component
groups; hand-maintaining ~1200 lines of near-identical JSON is how typos ship.
Everything it emits is plain 1.21.0 data - the output file is the source of
truth for the game, this script is the source of truth for the repo.
"""
import json, os, sys

OUT = os.path.join("behavior_packs", "bodyguard_bp", "entities", "bodyguard.json")

# --------------------------------------------------------------------------
# Filter helpers
# --------------------------------------------------------------------------
def fam(value, subject="other", op=None):
    f = {"test": "is_family", "subject": subject, "value": value}
    if op:
        f["operator"] = op
    return f

def not_fam(value, subject="other"):
    return fam(value, subject, "!=")

def any_of(*items):
    return {"any_of": list(items)}

def all_of(*items):
    return {"all_of": list(items)}

def none_of(*items):
    return {"none_of": list(items)}

# Families that must never be attacked by a bodyguard: the owner and other
# players, every bodyguard, and the friendly/neutral villager-side mobs.
NEVER_TARGET = [
    fam("player"),
    fam("bodyguard"),
    fam("villager"),
    fam("irongolem"),
    fam("snowgolem"),
    fam("npc"),
    fam("wandering_trader"),
    # Neutral until provoked - handled by hurt_by_target / owner_hurt_by_target
    # instead, so the bodyguard does not start fights with them.
    fam("enderman"),
    fam("zombie_pigman"),
    fam("pacified"),
]

def hostile(*extra):
    """A monster that is not on the never-target list."""
    return all_of(fam("monster"), none_of(*NEVER_TARGET), *extra)

def specific(families, *extra):
    return all_of(any_of(*[fam(f) for f in families]), none_of(*NEVER_TARGET), *extra)

# --------------------------------------------------------------------------
# Threat priority ladder.  Order in `entity_types` IS the priority order:
# the first entry that matches a nearby entity wins.
# --------------------------------------------------------------------------
def threat_ladder(base_dist, must_see=True):
    d = base_dist
    return [
        # 1. Creepers - lethal to the owner, must die before they reach him.
        {
            "filters": specific(["creeper"]),
            "max_dist": d + 2,
            "must_see": False,
            "walk_speed_multiplier": 1.3,
            "sprint_speed_multiplier": 1.5,
        },
        # 2. Ranged attackers - they hurt the owner from outside melee range.
        {
            "filters": specific(
                ["skeleton", "stray", "bogged", "pillager", "witch",
                 "blaze", "ghast", "breeze", "shulker"]
            ),
            "max_dist": d + 4,
            "must_see": must_see,
            "walk_speed_multiplier": 1.25,
            "sprint_speed_multiplier": 1.45,
        },
        # 3. Heavy hitters.
        {
            "filters": specific(
                ["ravager", "vindicator", "evocation_illager", "piglin_brute",
                 "hoglin", "zoglin", "wither", "warden", "elder_guardian",
                 "wither_skeleton", "vex"]
            ),
            "max_dist": d,
            "must_see": must_see,
            "walk_speed_multiplier": 1.2,
            "sprint_speed_multiplier": 1.4,
        },
        # 4. Everything else hostile.
        {
            "filters": hostile(),
            "max_dist": d,
            "must_see": must_see,
            "walk_speed_multiplier": 1.15,
            "sprint_speed_multiplier": 1.35,
        },
    ]

def target_goal(priority, base_dist, must_see=True, scan_interval=14, within_radius=0):
    goal = {
        "priority": priority,
        "attack_owner": False,
        "must_see": must_see,
        "must_see_forget_duration": 4.0,
        "reselect_targets": True,
        "scan_interval": scan_interval,
        "persist_time": 2.0,
        "entity_types": threat_ladder(base_dist, must_see),
    }
    if within_radius:
        goal["within_radius"] = within_radius
    return goal

# --------------------------------------------------------------------------
# Gear tiers.  variant drives the texture, the rest drives the stats.
# --------------------------------------------------------------------------
TIERS = [
    # name          hp   attack  knockback_res  speed
    ("recruit",     40,  5,      0.20,          0.30),
    ("leather",     52,  6,      0.32,          0.31),
    ("iron",        68,  8,      0.48,          0.32),
    ("diamond",     84,  10,     0.64,          0.33),
    ("netherite",  104,  12,     0.80,          0.34),
]

def tier_group(index):
    _name, hp, dmg, kb, speed = TIERS[index]
    return {
        "minecraft:variant": {"value": index},
        "minecraft:health": {"value": hp, "max": hp},
        "minecraft:attack": {"damage": dmg},
        "minecraft:knockback_resistance": {"value": kb, "max": kb},
        "minecraft:movement": {"value": speed},
    }

# --------------------------------------------------------------------------
# Modes
# --------------------------------------------------------------------------
def follow_owner(start, stop, speed):
    return {
        "priority": 9,
        "speed_multiplier": speed,
        "start_distance": start,
        "stop_distance": stop,
        "can_teleport": True,
        "ignore_vibration": True,
    }

STROLL = {
    "priority": 11,
    "speed_multiplier": 0.6,
    "xz_dist": 8,
    "y_dist": 4,
    "interval": 180,
}

ALLY_FILTER = {
    "entity_types": {
        "filters": none_of(fam("bodyguard"), fam("irongolem"), fam("villager")),
        "max_dist": 24,
    }
}

MODES = {}

# FOLLOW - escort. Sticks close, kills anything that comes at the owner.
MODES["bg:mode_follow"] = {
    "minecraft:mark_variant": {"value": 0},
    "minecraft:behavior.owner_hurt_by_target": dict(ALLY_FILTER, priority=1),
    "minecraft:behavior.owner_hurt_target": dict(ALLY_FILTER, priority=2),
    "minecraft:behavior.nearest_attackable_target": target_goal(4, 13),
    "minecraft:behavior.move_towards_target": {"priority": 7, "within_radius": 1.6},
    "minecraft:behavior.follow_owner": follow_owner(5.0, 2.5, 1.15),
    "minecraft:behavior.random_stroll": dict(STROLL, speed_multiplier=0.55, xz_dist=5),
}

# STAY - holds the spot it was told to hold. Fights only what comes to it.
MODES["bg:mode_stay"] = {
    "minecraft:mark_variant": {"value": 1},
    "minecraft:behavior.nearest_attackable_target": target_goal(4, 7, must_see=True, scan_interval=20),
    "minecraft:behavior.hold_ground": {
        "priority": 4,
        "min_radius": 5.0,
        "broadcast": False,
    },
}

# GUARD - owns an area. Anything hostile that walks in gets removed.
MODES["bg:mode_guard"] = {
    "minecraft:mark_variant": {"value": 2},
    "minecraft:behavior.owner_hurt_by_target": dict(ALLY_FILTER, priority=1),
    "minecraft:behavior.nearest_attackable_target": target_goal(4, 16, must_see=False, scan_interval=16),
    "minecraft:behavior.move_towards_target": {"priority": 7, "within_radius": 1.6},
    "minecraft:behavior.random_stroll": dict(STROLL, speed_multiplier=0.5, xz_dist=4, interval=140),
}

# PASSIVE - escort only. Never picks a fight, still defends itself.
MODES["bg:mode_passive"] = {
    "minecraft:mark_variant": {"value": 3},
    "minecraft:behavior.follow_owner": follow_owner(4.0, 2.0, 1.1),
    "minecraft:behavior.random_stroll": dict(STROLL, speed_multiplier=0.5, xz_dist=4),
}

# AGGRESSIVE - forward screen. Intercepts hostiles before they arrive.
MODES["bg:mode_aggressive"] = {
    "minecraft:mark_variant": {"value": 4},
    "minecraft:behavior.owner_hurt_by_target": dict(ALLY_FILTER, priority=1),
    "minecraft:behavior.owner_hurt_target": dict(ALLY_FILTER, priority=2),
    "minecraft:behavior.nearest_attackable_target": target_goal(4, 20, must_see=False, scan_interval=10),
    "minecraft:behavior.move_towards_target": {"priority": 7, "within_radius": 1.6},
    "minecraft:behavior.follow_owner": follow_owner(9.0, 3.5, 1.3),
}

# --------------------------------------------------------------------------
# Base components
# --------------------------------------------------------------------------
components = {
    "minecraft:type_family": {"family": ["bodyguard", "mob"]},
    "minecraft:collision_box": {"width": 0.6, "height": 1.9},
    "minecraft:physics": {
        "has_collision": True,
        "has_gravity": True,
        "push_towards_closest_space": True,
    },
    "minecraft:jump.static": {"jump_power": 0.42},
    "minecraft:can_climb": {},
    "minecraft:movement": {"value": 0.30},
    "minecraft:movement.basic": {"max_turn": 30.0},
    "minecraft:navigation.walk": {
        "can_path_over_water": True,
        "can_float": True,
        "avoid_damage_blocks": True,
        "avoid_portals": True,
        "can_pass_doors": True,
        "can_open_doors": True,
        "can_break_doors": False,
        "can_walk": True,
    },
    "minecraft:follow_range": {"value": 32, "max": 48},
    "minecraft:health": {"value": 40, "max": 40},
    "minecraft:attack": {"damage": 5},
    "minecraft:knockback_resistance": {"value": 0.2, "max": 1.0},
    "minecraft:breathable": {"total_supply": 15, "suffocate_time": 0},
    "minecraft:nameable": {"allow_name_tag_renaming": True, "always_show": True},
    "minecraft:leashable": {"soft_distance": 4.0, "hard_distance": 6.0, "max_distance": 10.0},
    "minecraft:equippable": {
        "slots": [
            {
                "slot": 0,
                "accepted_items": [
                    "wooden_sword", "stone_sword", "iron_sword", "golden_sword",
                    "diamond_sword", "netherite_sword", "wooden_axe", "stone_axe",
                    "iron_axe", "golden_axe", "diamond_axe", "netherite_axe",
                    "trident", "bow", "crossbow",
                ],
            },
            {
                "slot": 1,
                "accepted_items": ["shield"],
            },
        ]
    },
    # Mobile-friendly: gives touch players a labelled interact button.
    "minecraft:interact": {
        "interactions": [
            {
                "on_interact": {
                    "filters": all_of(
                        fam("player"),
                        {"test": "is_sneak_held", "subject": "other", "value": False},
                        {
                            "test": "has_equipment",
                            "subject": "other",
                            "domain": "hand",
                            "value": "bg:contract",
                        },
                        {"test": "has_component", "subject": "self", "value": "minecraft:is_tamed"},
                    ),
                    "event": "bg:command_panel",
                    "target": "self",
                },
                "use_item": False,
                "interact_text": "action.interact.bodyguard.command",
                "swing": False,
                "play_sounds": "random.click",
            }
        ]
    },
    # Physical presence: solid enough to body-block, but it never shoves the
    # owner around - push_through 1.0 means the collision resolves by sliding
    # through instead of applying push velocity.
    "minecraft:pushable": {"is_pushable": True, "is_pushable_by_piston": True},
    "minecraft:push_through": {"value": 1.0},
    "minecraft:hurt_on_condition": {
        "damage_conditions": [
            {
                "filters": {"test": "in_lava", "subject": "self", "operator": "==", "value": True},
                "cause": "lava",
                "damage_per_tick": 4,
            }
        ]
    },
    "minecraft:conditional_bandwidth_optimization": {
        "default_values": {
            "max_optimized_distance": 80,
            "max_dropped_ticks": 10,
            "use_motion_prediction_hints": True,
        }
    },
    "minecraft:ambient_sound_interval": {
        "value": 12.0,
        "range": 12.0,
        "event_name": "ambient",
    },
    "minecraft:behavior.float": {"priority": 0},
    "minecraft:behavior.open_door": {"priority": 3, "close_door_after": True},
    "minecraft:behavior.look_at_player": {
        "priority": 13,
        "look_distance": 8.0,
        "probability": 0.35,
        "angle_of_view_horizontal": 180,
    },
    "minecraft:behavior.random_look_around": {
        "priority": 14,
        "look_distance": 8.0,
        "look_time": [2, 6],
        "min_angle_of_view_horizontal": -45,
        "max_angle_of_view_horizontal": 45,
    },
}

# --------------------------------------------------------------------------
# Component groups
# --------------------------------------------------------------------------
groups = {}

# ---- Unbound recruit: stands around, waits to be hired. -------------------
groups["bg:unbound"] = {
    "minecraft:skin_id": {"value": 0},
    "minecraft:tameable": {
        "probability": 1.0,
        "tame_items": ["gold_ingot"],
        "tame_event": {"event": "bg:on_bind", "target": "self"},
    },
    "minecraft:behavior.tempt": {
        "priority": 4,
        "speed_multiplier": 1.1,
        "within_radius": 24,
        "can_tempt_vertically": True,
        "can_get_scared": False,
        "items": ["gold_ingot", "bg:contract"],
    },
    "minecraft:behavior.random_stroll": dict(STROLL, speed_multiplier=0.45, xz_dist=4),
    "minecraft:despawn": {
        "despawn_from_distance": {
            "max_distance": 128,
            "min_distance": 96,
        },
        "min_range_random_chance": 400,
    },
}

# ---- Bound: hired. Everything mode-independent lives here. ----------------
groups["bg:bound"] = {
    "minecraft:is_tamed": {},
    "minecraft:persistent": {},
    "minecraft:skin_id": {"value": 1},
    # Never retaliates against a player - that is what keeps it from ever
    # turning on its own owner, even if the owner clips it by accident.
    "minecraft:behavior.hurt_by_target": {
        "priority": 3,
        "hurt_owner": False,
        "alert_same_type": True,
        "entity_types": {
            "filters": none_of(fam("player"), fam("bodyguard")),
            "max_dist": 24,
        },
    },
    "minecraft:behavior.look_at_entity": {
        "priority": 12,
        "look_distance": 10.0,
        "probability": 0.6,
        "look_time": [3, 7],
        "filters": all_of(fam("player"), {"test": "is_owner", "subject": "other", "value": True}),
    },
    "minecraft:behavior.melee_box_attack": {
        "priority": 6,
        "track_target": True,
        "speed_multiplier": 1.25,
        "cooldown_time": 0.85,
        "horizontal_reach": 1.1,
        "melee_fov": 120,
        "require_complete_path": False,
        "on_attack": {"event": "bg:on_melee_hit", "target": "self"},
    },
    "minecraft:damage_sensor": {
        "triggers": [
            {
                # The owner can never hurt their own bodyguard.
                "on_damage": {
                    "filters": all_of(fam("player"), {"test": "is_owner", "subject": "other", "value": True})
                },
                "deals_damage": False,
            },
            {
                # Bodyguards never hurt each other.
                "on_damage": {"filters": fam("bodyguard")},
                "deals_damage": False,
            },
            {
                "cause": "fall",
                "damage_multiplier": 0.35,
                "deals_damage": True,
            },
            {
                "cause": "magic",
                "damage_multiplier": 0.5,
                "deals_damage": True,
            },
        ]
    },
}

for name, comps in MODES.items():
    groups[name] = comps

for i in range(len(TIERS)):
    groups["bg:tier_%d" % i] = tier_group(i)

# ---- Ranged fallback: used when a target cannot be reached in melee. ------
groups["bg:ranged"] = {
    "minecraft:shooter": {"def": "minecraft:arrow", "sound": "bow"},
    "minecraft:behavior.ranged_attack": {
        "priority": 5,
        "attack_interval_min": 1.4,
        "attack_interval_max": 2.4,
        "attack_radius": 16.0,
        "attack_radius_min": 4.0,
        "speed_multiplier": 1.1,
        "target_in_sight_time": 0.2,
        "ranged_fov": 120.0,
    },
}

# ---- Short flag states that the resource pack animates. ------------------
# query.timer_flag_N is readable on the client, so these drive the special
# attack windup, the post-fight victory beat, and the shield stance without
# any per-tick client/server chatter.
groups["bg:flag_special"] = {
    "minecraft:behavior.timer_flag_1": {
        "priority": 1,
        "duration_range": [0.6, 0.6],
        "cooldown_range": [0.0, 0.0],
        "on_end": {"event": "bg:special_end", "target": "self"},
    }
}
groups["bg:flag_victory"] = {
    "minecraft:behavior.timer_flag_2": {
        "priority": 8,
        "duration_range": [2.0, 2.6],
        "cooldown_range": [0.0, 0.0],
        "on_end": {"event": "bg:victory_end", "target": "self"},
    }
}
groups["bg:flag_defend"] = {
    "minecraft:behavior.timer_flag_3": {
        "priority": 2,
        "duration_range": [1.2, 1.6],
        "cooldown_range": [0.0, 0.0],
        "on_end": {"event": "bg:defend_end", "target": "self"},
    }
}

# --------------------------------------------------------------------------
# Events
# --------------------------------------------------------------------------
MODE_GROUPS = list(MODES.keys())
TIER_GROUPS = ["bg:tier_%d" % i for i in range(len(TIERS))]

events = {}

events["minecraft:entity_spawned"] = {
    "add": {"component_groups": ["bg:unbound", "bg:tier_0"]}
}

events["bg:on_bind"] = {
    "remove": {"component_groups": ["bg:unbound"]},
    "add": {"component_groups": ["bg:bound", "bg:mode_follow"]},
}

for name in MODE_GROUPS:
    key = name.replace("bg:mode_", "bg:set_")
    events[key] = {
        "remove": {"component_groups": [m for m in MODE_GROUPS]},
        "add": {"component_groups": [name]},
    }

for i, name in enumerate(TIER_GROUPS):
    events["bg:set_tier_%d" % i] = {
        "remove": {"component_groups": TIER_GROUPS},
        "add": {"component_groups": [name]},
    }

events["bg:ranged_on"] = {"add": {"component_groups": ["bg:ranged"]}}
events["bg:ranged_off"] = {"remove": {"component_groups": ["bg:ranged"]}}

events["bg:special_start"] = {"add": {"component_groups": ["bg:flag_special"]}}
events["bg:special_end"] = {"remove": {"component_groups": ["bg:flag_special"]}}
events["bg:victory_start"] = {"add": {"component_groups": ["bg:flag_victory"]}}
events["bg:victory_end"] = {"remove": {"component_groups": ["bg:flag_victory"]}}
events["bg:defend_start"] = {"add": {"component_groups": ["bg:flag_defend"]}}
events["bg:defend_end"] = {"remove": {"component_groups": ["bg:flag_defend"]}}

# Fired by minecraft:interact; the script picks it up through
# world.afterEvents.dataDrivenEntityTrigger and opens the command panel.
events["bg:command_panel"] = {}
events["bg:on_melee_hit"] = {}

entity = {
    "format_version": "1.21.0",
    "minecraft:entity": {
        "description": {
            "identifier": "bg:bodyguard",
            "is_spawnable": True,
            "is_summonable": True,
            "is_experimental": False,
        },
        "component_groups": groups,
        "components": components,
        "events": events,
    },
}

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as handle:
    json.dump(entity, handle, indent=2)
    handle.write("\n")
print("wrote %s (%d component groups, %d events)" % (OUT, len(groups), len(events)))
