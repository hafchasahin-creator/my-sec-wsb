#!/usr/bin/env python3
"""Generate the Magical Swords resource-pack JSON (models, attachables,
animations, animation controllers, render controllers, particles).

Everything per-sword is derived from the SWORDS spec below so identifiers can
never drift apart between files. Formats are the ones proven on Bedrock
1.21.0 (geometry 1.16.0, attachables/animations/particles 1.10.0) - the same
versions the vanilla 1.21.0.3 resource pack uses.

Usage:  python3 tools/gen_ms_rp.py
"""

import json
import os

RP = os.path.join("resource_packs", "magical_swords_rp")

# --------------------------------------------------------------------------
# Sword spec
# --------------------------------------------------------------------------
#
# Geometry convention (matches the vanilla trident): the sword is modelled
# vertically, +Y = towards the blade tip, origin at the grip. One root bone
# binds to the player's hand via q.item_slot_to_bone_name(c.item_slot).
# 16 geometry units = 1 block.

SWORDS = {
    "inferno": {
        "aura": "msword:inferno_aura",
        "tip_aura": "msword:inferno_aura",
        "orbitals": 0,
        "energy_scroll": 0.22,
        "blade": "flamberge",
    },
    "frost": {
        "aura": "msword:frost_aura",
        "tip_aura": "msword:frost_aura",
        "orbitals": 2,
        "energy_scroll": 0.05,
        "blade": "crystal",
    },
    "thunder": {
        "aura": "msword:thunder_arc",
        "tip_aura": "msword:thunder_arc",
        "orbitals": 0,
        "energy_scroll": 0.45,
        "blade": "zigzag",
    },
    "void": {
        "aura": "msword:void_wisp",
        "tip_aura": "msword:void_wisp",
        "orbitals": 3,
        "energy_scroll": 0.10,
        "blade": "scimitar",
    },
    "celestial": {
        "aura": "msword:celestial_star",
        "tip_aura": "msword:celestial_star",
        "orbitals": 3,
        "energy_scroll": 0.08,
        "blade": "ornate",
    },
}


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)
        handle.write("\n")
    print(f"wrote {path}")


# --------------------------------------------------------------------------
# Geometry
# --------------------------------------------------------------------------

class UvPacker:
    """Packs box-UVs onto a 64x64 sheet, row by row."""

    def __init__(self, size=64):
        self.size = size
        self.x = 0
        self.y = 0
        self.row_height = 0

    def place(self, sx, sy, sz):
        w = 2 * (int(round(sx)) + int(round(sz))) + 2
        h = int(round(sy)) + int(round(sz)) + 2
        if self.x + w > self.size:
            self.x = 0
            self.y += self.row_height
            self.row_height = 0
        u, v = self.x, self.y
        self.x += w
        self.row_height = max(self.row_height, h)
        if v + h > self.size:
            raise SystemExit(f"UV overflow: need {v + h}px of 64px")
        return [u, v]


def cube(packer, origin, size, inflate=None, rotation=None, pivot=None, uv=None):
    c = {
        "origin": [round(v, 3) for v in origin],
        "size": [round(v, 3) for v in size],
        "uv": uv if uv is not None else packer.place(*size),
    }
    if inflate is not None:
        c["inflate"] = inflate
    if rotation is not None:
        c["rotation"] = rotation
        c["pivot"] = pivot if pivot is not None else [0, origin[1] + size[1] / 2.0, 0]
    return c


def blade_cubes(kind, packer, energy_uv):
    """Returns (blade_cubes, energy_cubes, orbital_positions).

    Energy cubes carry uv coordinates into the *energy* texture, which is a
    horizontally tileable 64x64 sheet, so the glow render controller can
    scroll UVs without ever sampling foreign pixels.
    """
    blade = []
    energy = []
    orbitals = []

    def ecube(origin, size, row):
        # Energy faces sample a horizontally-tileable band -> safe to scroll.
        energy.append(cube(None, origin, size, uv=[0, row]))

    if kind == "flamberge":
        widths = [4.6, 4.0, 4.6, 3.8, 4.2, 3.2]
        y = 6.0
        for i, w in enumerate(widths):
            xoff = 0.9 if i % 2 else -0.9
            blade.append(cube(packer, [-w / 2 + xoff * 0.4, y, -0.5], [w, 3.4, 1]))
            y += 3.2
        blade.append(cube(packer, [-1.1, y, -0.5], [2.2, 3.6, 1]))
        blade.append(cube(packer, [-0.55, y + 3.4, -0.5], [1.1, 2.2, 1]))
        ecube([-1.0, 7.0, -0.75], [2.0, 17.5, 1.5], 8)
        ecube([-0.5, 24.5, -0.65], [1.0, 4.5, 1.3], 30)
    elif kind == "crystal":
        blade.append(cube(packer, [-1.6, 6, -0.6], [3.2, 19, 1.2]))
        blade.append(cube(packer, [-1.0, 25, -0.5], [2.0, 4.0, 1.0]))
        blade.append(cube(packer, [-0.5, 29, -0.4], [1.0, 2.0, 0.8]))
        blade.append(cube(packer, [-3.4, 8, -0.45], [1.6, 6.5, 0.9], rotation=[0, 0, 18], pivot=[-2.6, 8, 0]))
        blade.append(cube(packer, [1.8, 8, -0.45], [1.6, 6.5, 0.9], rotation=[0, 0, -18], pivot=[2.6, 8, 0]))
        ecube([-0.8, 7, -0.8], [1.6, 19.5, 1.6], 8)
        ecube([-0.4, 26.5, -0.6], [0.8, 3.5, 1.2], 30)
    elif kind == "zigzag":
        steps = [(-1.4, 3.4), (0.6, 3.2), (-1.2, 3.2), (0.8, 3.0), (-0.8, 3.0), (0.4, 2.8)]
        y = 6.0
        w = 3.6
        for xoff, h in steps:
            blade.append(cube(packer, [xoff - w / 2 + 0.8, y, -0.5], [w, h + 0.6, 1]))
            y += h
        blade.append(cube(packer, [-0.4, y, -0.5], [1.6, 3.2, 1]))
        ecube([-0.9, 6.5, -0.75], [1.8, 18.0, 1.5], 8)
        ecube([-0.45, 24.5, -0.6], [0.9, 4.2, 1.2], 30)
    elif kind == "scimitar":
        arc = [0.0, 0.5, 1.1, 1.9, 2.9, 4.1]
        y = 6.0
        for i, xoff in enumerate(arc):
            w = 3.6 - i * 0.35
            blade.append(cube(packer, [xoff - w / 2, y, -0.45], [w, 3.6, 0.9]))
            y += 3.3
        blade.append(cube(packer, [4.6, y - 0.4, -0.4], [1.6, 2.6, 0.8], rotation=[0, 0, -35], pivot=[4.6, y - 0.4, 0]))
        ecube([-0.4, 6.5, -0.7], [1.5, 16.5, 1.4], 8)
        ecube([1.6, 19.5, -0.6], [1.4, 5.5, 1.2], 30)
    elif kind == "ornate":
        blade.append(cube(packer, [-2.2, 6, -0.6], [4.4, 21, 1.2]))
        blade.append(cube(packer, [-1.4, 27, -0.5], [2.8, 3.0, 1.0]))
        blade.append(cube(packer, [-0.6, 30, -0.4], [1.2, 2.4, 0.8]))
        blade.append(cube(packer, [-4.6, 6.5, -0.45], [1.8, 9, 0.9], rotation=[0, 0, 14], pivot=[-3.7, 6.5, 0]))
        blade.append(cube(packer, [2.8, 6.5, -0.45], [1.8, 9, 0.9], rotation=[0, 0, -14], pivot=[3.7, 6.5, 0]))
        ecube([-1.2, 7, -0.8], [2.4, 21.5, 1.6], 8)
        ecube([-0.6, 28.5, -0.65], [1.2, 3.2, 1.3], 30)
        ecube([-4.2, 7.5, -0.6], [1.0, 6.5, 1.2], 44)
        ecube([3.2, 7.5, -0.6], [1.0, 6.5, 1.2], 44)
    return blade, energy, orbitals


ORBITAL_SLOTS = [
    ([3.6, 12.0, 0.0], [1.2, 1.2, 1.2]),
    ([-3.8, 18.0, 0.0], [1.0, 1.0, 1.0]),
    ([3.2, 24.0, 0.0], [0.8, 0.8, 0.8]),
]


def geometry_for(key, spec):
    packer = UvPacker()
    handle = [
        cube(packer, [-0.9, -5.0, -0.9], [1.8, 10.0, 1.8]),
        cube(packer, [-1.4, -7.0, -1.4], [2.8, 2.4, 2.8]),
    ]
    guard = [
        cube(packer, [-4.0, 4.4, -1.1], [8.0, 2.0, 2.2]),
        cube(packer, [-4.6, 3.9, -1.0], [1.6, 3.0, 2.0]),
        cube(packer, [3.0, 3.9, -1.0], [1.6, 3.0, 2.0]),
    ]
    blade, energy, _ = blade_cubes(spec["blade"], packer, None)

    orbital_cubes = []
    for i in range(spec["orbitals"]):
        pos, size = ORBITAL_SLOTS[i]
        orbital_cubes.append(
            cube(None, [pos[0] - size[0] / 2, pos[1] - size[1] / 2, pos[2] - size[2] / 2], size, uv=[0, 58])
        )

    bones = [
        {
            "name": "sword",
            "binding": "q.item_slot_to_bone_name(c.item_slot)",
            "pivot": [0, 0, 0],
            "locators": {
                "particle_tip": [0, 29, 0],
                "particle_mid": [0, 16, 0],
                "particle_guard": [0, 5, 0],
            },
        },
        {"name": "handle", "parent": "sword", "pivot": [0, 0, 0], "cubes": handle},
        {"name": "guard", "parent": "sword", "pivot": [0, 5, 0], "cubes": guard},
        {"name": "blade", "parent": "sword", "pivot": [0, 6, 0], "cubes": blade},
        {"name": "energy", "parent": "blade", "pivot": [0, 16, 0], "cubes": energy},
    ]
    if orbital_cubes:
        bones.append(
            {"name": "orbitals", "parent": "sword", "pivot": [0, 16, 0], "cubes": orbital_cubes}
        )

    return {
        "format_version": "1.16.0",
        "minecraft:geometry": [
            {
                "description": {
                    "identifier": f"geometry.msword.{key}",
                    "texture_width": 64,
                    "texture_height": 64,
                },
                "bones": bones,
            }
        ],
    }


# --------------------------------------------------------------------------
# Attachables
# --------------------------------------------------------------------------

def attachable_for(key, spec):
    return {
        "format_version": "1.10.0",
        "minecraft:attachable": {
            "description": {
                "identifier": f"msword:{key}_sword",
                "materials": {
                    "default": "entity_alphatest",
                    "glow": "entity_emissive",
                    "enchanted": "entity_alphatest_glint",
                },
                "textures": {
                    "default": f"textures/attachables/{key}_sword",
                    "glow": f"textures/attachables/{key}_energy",
                    "enchanted": "textures/misc/enchanted_item_glint",
                },
                "geometry": {"default": f"geometry.msword.{key}"},
                "scripts": {
                    "pre_animation": [
                        f"variable.msword_scroll = {spec['energy_scroll']};"
                    ],
                    "animate": ["wield"],
                },
                "animations": {
                    "wield": f"controller.animation.msword.{key}.wield",
                    "first_person_hold": f"animation.msword.{key}.first_person_hold",
                    "third_person_hold": f"animation.msword.{key}.third_person_hold",
                    "idle": f"animation.msword.{key}.idle",
                },
                "particle_effects": {
                    "ambient": spec["aura"],
                    "ambient_tip": spec["tip_aura"],
                },
                "render_controllers": [
                    "controller.render.msword_base",
                    "controller.render.msword_glow",
                ],
            },
        },
    }


# --------------------------------------------------------------------------
# Animations + controllers
# --------------------------------------------------------------------------

def animations_for(key, spec):
    idle_bones = {
        "energy": {
            "position": [0, "math.sin(q.life_time * 220.0) * 0.28", 0],
            "scale": [
                "1.0 + math.sin(q.life_time * 300.0) * 0.04",
                "1.0 + math.sin(q.life_time * 300.0 + 90.0) * 0.03",
                1.0,
            ],
        },
        "blade": {
            "rotation": [0, 0, "math.sin(q.life_time * 140.0) * 0.8"],
        },
    }
    if spec["orbitals"]:
        idle_bones["orbitals"] = {
            "rotation": [0, "q.life_time * 150.0", 0],
            "position": [0, "math.sin(q.life_time * 180.0) * 0.5", 0],
        }

    return {
        "format_version": "1.10.0",
        "animations": {
            f"animation.msword.{key}.first_person_hold": {
                "loop": True,
                "bones": {
                    "sword": {
                        "position": [-4.0, 0.0, -1.0],
                        "rotation": [130.0, -8.0, 18.0],
                    }
                },
            },
            f"animation.msword.{key}.third_person_hold": {
                "loop": True,
                "bones": {
                    "sword": {
                        "position": [1.0, -1.5, -7.0],
                        "rotation": [75.0, 0.0, -45.0],
                    }
                },
            },
            f"animation.msword.{key}.idle": {
                "loop": True,
                "animation_length": 1.6,
                "bones": idle_bones,
                "particle_effects": {
                    "0.0": {"effect": "ambient", "locator": "particle_mid"},
                    "0.8": {"effect": "ambient_tip", "locator": "particle_tip"},
                },
            },
        },
    }


def controller_for(key):
    return {
        "format_version": "1.10.0",
        "animation_controllers": {
            f"controller.animation.msword.{key}.wield": {
                "initial_state": "first_person",
                "states": {
                    "first_person": {
                        "animations": ["first_person_hold", "idle"],
                        "transitions": [{"third_person": "!c.is_first_person"}],
                    },
                    "third_person": {
                        "animations": ["third_person_hold", "idle"],
                        "transitions": [{"first_person": "c.is_first_person"}],
                    },
                },
            }
        },
    }


RENDER_CONTROLLERS = {
    "format_version": "1.10.0",
    "render_controllers": {
        "controller.render.msword_base": {
            "geometry": "Geometry.default",
            "part_visibility": [{"*": True}, {"energy": False}, {"orbitals": False}],
            "materials": [
                {"*": "variable.is_enchanted ? material.enchanted : material.default"}
            ],
            "textures": ["Texture.default", "Texture.enchanted"],
        },
        "controller.render.msword_glow": {
            "geometry": "Geometry.default",
            "part_visibility": [{"*": False}, {"energy": True}, {"orbitals": True}],
            "materials": [{"*": "material.glow"}],
            "textures": ["Texture.glow"],
            "uv_anim": {
                "offset": ["q.life_time * variable.msword_scroll", 0.0],
                "scale": [1.0, 1.0],
            },
        },
    },
}


# --------------------------------------------------------------------------
# Particles
# --------------------------------------------------------------------------

TEX = "textures/particle/"


def particle(identifier, material, texture, components):
    return {
        "format_version": "1.10.0",
        "particle_effect": {
            "description": {
                "identifier": identifier,
                "basic_render_parameters": {
                    "material": material,
                    "texture": TEX + texture,
                },
            },
            "components": components,
        },
    }


def burst(num, shape_radius, speed, life, size, extra=None, surface=False, direction=None):
    shape = {"radius": shape_radius}
    if surface:
        shape["surface_only"] = True
    if direction is not None:
        shape["direction"] = direction
    comp = {
        "minecraft:emitter_rate_instant": {"num_particles": num},
        "minecraft:emitter_lifetime_once": {"active_time": 0.05},
        "minecraft:emitter_shape_sphere": shape,
        "minecraft:particle_initial_speed": speed,
        "minecraft:particle_lifetime_expression": {"max_lifetime": life},
        "minecraft:particle_appearance_billboard": {
            "size": size,
            "facing_camera_mode": "rotate_xyz",
        },
    }
    if extra:
        comp.update(extra)
    return comp


PARTICLES = {}

# ---- Inferno ----
PARTICLES["msword:inferno_aura"] = particle(
    "msword:inferno_aura", "particles_alpha", "msword_flame",
    {
        "minecraft:emitter_rate_instant": {"num_particles": 2},
        "minecraft:emitter_lifetime_once": {"active_time": 0.05},
        "minecraft:emitter_shape_sphere": {"radius": 0.28},
        "minecraft:particle_initial_speed": "math.random(0.05, 0.25)",
        "minecraft:particle_motion_dynamic": {
            "linear_acceleration": [0, 0.9, 0],
            "linear_drag_coefficient": 0.6,
        },
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.5, 0.9)"},
        "minecraft:particle_appearance_billboard": {
            "size": ["0.1 + v.particle_random_1 * 0.08", "0.1 + v.particle_random_1 * 0.08"],
            "facing_camera_mode": "rotate_xyz",
            "uv": {
                "texture_width": 1,
                "texture_height": 8,
                "flipbook": {
                    "base_UV": [0, 0],
                    "size_UV": [1, 1],
                    "step_UV": [0, 1],
                    "frames_per_second": 10,
                    "max_frame": 8,
                    "stretch_to_lifetime": True,
                    "loop": False,
                },
            },
        },
    },
)

PARTICLES["msword:inferno_ring"] = particle(
    "msword:inferno_ring", "particles_alpha", "msword_flame",
    {
        "minecraft:emitter_rate_instant": {"num_particles": 5},
        "minecraft:emitter_lifetime_once": {"active_time": 0.05},
        "minecraft:emitter_shape_disc": {"radius": 0.35, "plane_normal": [0, 1, 0]},
        "minecraft:particle_initial_speed": "math.random(1.0, 2.2)",
        "minecraft:particle_motion_dynamic": {
            "linear_acceleration": [0, 2.0, 0],
            "linear_drag_coefficient": 0.8,
        },
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.4, 0.8)"},
        "minecraft:particle_appearance_billboard": {
            "size": ["0.16 + v.particle_random_1 * 0.12", "0.2 + v.particle_random_1 * 0.14"],
            "facing_camera_mode": "rotate_xyz",
            "uv": {
                "texture_width": 1,
                "texture_height": 8,
                "flipbook": {
                    "base_UV": [0, 0],
                    "size_UV": [1, 1],
                    "step_UV": [0, 1],
                    "frames_per_second": 12,
                    "max_frame": 8,
                    "stretch_to_lifetime": True,
                    "loop": False,
                },
            },
        },
    },
)

PARTICLES["msword:hit_ember"] = particle(
    "msword:hit_ember", "particles_alpha", "msword_glow",
    burst(
        12, 0.3, "math.random(1.5, 3.0)", "math.random(0.35, 0.65)",
        ["0.05 + v.particle_random_1 * 0.05", "0.05 + v.particle_random_1 * 0.05"],
        extra={
            "minecraft:particle_motion_dynamic": {
                "linear_acceleration": [0, -6.0, 0],
                "linear_drag_coefficient": 1.2,
            },
            "minecraft:particle_appearance_tinting": {
                "color": [
                    "1.0",
                    "0.75 - 0.55 * (v.particle_age / v.particle_lifetime)",
                    "0.2 - 0.15 * (v.particle_age / v.particle_lifetime)",
                    "1.0 - 0.6 * (v.particle_age / v.particle_lifetime)",
                ]
            },
        },
    ),
)

PARTICLES["msword:slash_fire"] = particle(
    "msword:slash_fire", "particles_alpha", "msword_slash",
    burst(
        6, 0.15, "math.random(1.2, 2.0)", 0.25,
        [0.45, 0.45],
        extra={
            "minecraft:particle_initial_spin": {
                "rotation": "math.random(0, 360)",
                "rotation_rate": "math.random(-400, 400)",
            },
            "minecraft:particle_appearance_tinting": {
                "color": ["1.0", "0.55", "0.15", "1.0 - (v.particle_age / v.particle_lifetime)"]
            },
        },
    ),
)

# ---- Frost ----
PARTICLES["msword:frost_aura"] = particle(
    "msword:frost_aura", "particles_alpha", "msword_snow",
    {
        "minecraft:emitter_rate_instant": {"num_particles": 2},
        "minecraft:emitter_lifetime_once": {"active_time": 0.05},
        "minecraft:emitter_shape_sphere": {"radius": 0.35},
        "minecraft:particle_initial_speed": "math.random(0.02, 0.1)",
        "minecraft:particle_motion_dynamic": {
            "linear_acceleration": [0, -0.5, 0],
            "linear_drag_coefficient": 1.5,
        },
        "minecraft:particle_initial_spin": {
            "rotation": "math.random(0, 360)",
            "rotation_rate": "math.random(-90, 90)",
        },
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.7, 1.2)"},
        "minecraft:particle_appearance_billboard": {
            "size": ["0.07 + v.particle_random_1 * 0.06", "0.07 + v.particle_random_1 * 0.06"],
            "facing_camera_mode": "rotate_xyz",
        },
        "minecraft:particle_appearance_tinting": {
            "color": ["0.75", "0.92", "1.0", "0.9 - 0.8 * (v.particle_age / v.particle_lifetime)"]
        },
    },
)

PARTICLES["msword:frost_crystal"] = particle(
    "msword:frost_crystal", "particles_alpha", "msword_shard",
    burst(
        10, 0.25, "math.random(1.4, 2.4)", "math.random(0.3, 0.55)",
        ["0.1 + v.particle_random_1 * 0.06", "0.1 + v.particle_random_1 * 0.06"],
        extra={
            "minecraft:particle_motion_dynamic": {
                "linear_acceleration": [0, -5.0, 0],
                "linear_drag_coefficient": 1.0,
            },
            "minecraft:particle_initial_spin": {
                "rotation": "math.random(0, 360)",
                "rotation_rate": "math.random(-300, 300)",
            },
            "minecraft:particle_appearance_tinting": {
                "color": ["0.72", "0.9", "1.0", "1.0"]
            },
        },
    ),
)

PARTICLES["msword:frost_wave"] = particle(
    "msword:frost_wave", "particles_alpha", "msword_glow",
    burst(
        8, 0.5, "math.random(0.8, 1.6)", "math.random(0.4, 0.7)",
        ["0.18 + v.particle_random_1 * 0.1", "0.18 + v.particle_random_1 * 0.1"],
        surface=True,
        extra={
            "minecraft:particle_motion_dynamic": {
                "linear_acceleration": [0, 1.2, 0],
                "linear_drag_coefficient": 1.4,
            },
            "minecraft:particle_appearance_tinting": {
                "color": [
                    "0.55 + 0.4 * (v.particle_age / v.particle_lifetime)",
                    "0.85",
                    "1.0",
                    "0.95 - 0.85 * (v.particle_age / v.particle_lifetime)",
                ]
            },
        },
    ),
)

PARTICLES["msword:frozen_shell"] = particle(
    "msword:frozen_shell", "particles_alpha", "msword_shard",
    {
        "minecraft:emitter_rate_instant": {"num_particles": 5},
        "minecraft:emitter_lifetime_once": {"active_time": 0.05},
        "minecraft:emitter_shape_point": {},
        "minecraft:particle_lifetime_expression": {"max_lifetime": 0.45},
        "minecraft:particle_motion_parametric": {
            "relative_position": [
                "math.cos(v.particle_random_1 * 360.0 + v.particle_age * 240.0) * 0.55",
                "v.particle_random_2 * 1.5 - 0.6",
                "math.sin(v.particle_random_1 * 360.0 + v.particle_age * 240.0) * 0.55",
            ]
        },
        "minecraft:particle_initial_spin": {
            "rotation": "math.random(0, 360)",
            "rotation_rate": 120,
        },
        "minecraft:particle_appearance_billboard": {
            "size": [0.09, 0.09],
            "facing_camera_mode": "rotate_xyz",
        },
        "minecraft:particle_appearance_tinting": {
            "color": ["0.8", "0.95", "1.0", "0.85 - 0.7 * (v.particle_age / v.particle_lifetime)"]
        },
    },
)

# ---- Thunder ----
PARTICLES["msword:thunder_arc"] = particle(
    "msword:thunder_arc", "particles_blend", "msword_spark",
    burst(
        2, 0.3, "math.random(0.2, 0.6)", "math.random(0.1, 0.2)",
        ["0.09 + v.particle_random_1 * 0.08", "0.09 + v.particle_random_1 * 0.08"],
        extra={
            "minecraft:particle_initial_spin": {
                "rotation": "math.random(0, 360)",
            },
            "minecraft:particle_appearance_tinting": {
                "color": ["1.0", "1.0", "0.6", "1.0"]
            },
        },
    ),
)

PARTICLES["msword:thunder_spark"] = particle(
    "msword:thunder_spark", "particles_blend", "msword_spark",
    burst(
        10, 0.3, "math.random(2.0, 3.5)", "math.random(0.15, 0.35)",
        ["0.1 + v.particle_random_1 * 0.06", "0.1 + v.particle_random_1 * 0.06"],
        extra={
            "minecraft:particle_motion_dynamic": {"linear_drag_coefficient": 2.0},
            "minecraft:particle_initial_spin": {
                "rotation": "math.random(0, 360)",
            },
            "minecraft:particle_appearance_tinting": {
                "color": ["1.0", "0.98", "0.55", "1.0"]
            },
        },
    ),
)

PARTICLES["msword:thunder_strike"] = particle(
    "msword:thunder_strike", "particles_blend", "msword_spark",
    burst(
        18, 0.4, "math.random(3.5, 6.0)", "math.random(0.25, 0.5)",
        ["0.13 + v.particle_random_1 * 0.09", "0.13 + v.particle_random_1 * 0.09"],
        extra={
            "minecraft:particle_motion_dynamic": {
                "linear_acceleration": [0, -4.0, 0],
                "linear_drag_coefficient": 1.5,
            },
            "minecraft:particle_initial_spin": {
                "rotation": "math.random(0, 360)",
                "rotation_rate": "math.random(-500, 500)",
            },
            "minecraft:particle_appearance_tinting": {
                "color": [
                    "1.0",
                    "1.0 - 0.3 * (v.particle_age / v.particle_lifetime)",
                    "0.9 - 0.7 * (v.particle_age / v.particle_lifetime)",
                    "1.0",
                ]
            },
        },
    ),
)

# ---- Void ----
PARTICLES["msword:void_wisp"] = particle(
    "msword:void_wisp", "particles_alpha", "msword_glow",
    {
        "minecraft:emitter_rate_instant": {"num_particles": 3},
        "minecraft:emitter_lifetime_once": {"active_time": 0.05},
        "minecraft:emitter_shape_point": {},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.5, 0.8)"},
        "minecraft:particle_motion_parametric": {
            "relative_position": [
                "math.cos(v.particle_random_1 * 360.0 + v.particle_age * 300.0) * 0.42",
                "(v.particle_random_2 - 0.5) * 1.2 + v.particle_age * 0.4",
                "math.sin(v.particle_random_1 * 360.0 + v.particle_age * 300.0) * 0.42",
            ]
        },
        "minecraft:particle_appearance_billboard": {
            "size": ["0.1 + v.particle_random_3 * 0.06", "0.1 + v.particle_random_3 * 0.06"],
            "facing_camera_mode": "rotate_xyz",
        },
        "minecraft:particle_appearance_tinting": {
            "color": [
                "0.45 - 0.3 * (v.particle_age / v.particle_lifetime)",
                "0.1",
                "0.6 - 0.2 * (v.particle_age / v.particle_lifetime)",
                "0.95 - 0.75 * (v.particle_age / v.particle_lifetime)",
            ]
        },
    },
)

PARTICLES["msword:void_slash"] = particle(
    "msword:void_slash", "particles_alpha", "msword_rune",
    {
        "minecraft:emitter_rate_instant": {"num_particles": 12},
        "minecraft:emitter_lifetime_once": {"active_time": 0.05},
        "minecraft:emitter_shape_point": {},
        "minecraft:particle_lifetime_expression": {"max_lifetime": 0.35},
        "minecraft:particle_motion_parametric": {
            "relative_position": [
                "math.cos(-60.0 + v.particle_random_1 * 120.0) * (1.0 + v.particle_age * 3.0)",
                "0.9 + math.sin(-60.0 + v.particle_random_1 * 120.0) * (1.0 + v.particle_age * 3.0)",
                "(v.particle_random_2 - 0.5) * 0.4",
            ]
        },
        "minecraft:particle_initial_spin": {
            "rotation": "math.random(0, 360)",
            "rotation_rate": "math.random(-200, 200)",
        },
        "minecraft:particle_appearance_billboard": {
            "size": ["0.2 + v.particle_random_3 * 0.15", "0.2 + v.particle_random_3 * 0.15"],
            "facing_camera_mode": "rotate_xyz",
        },
        "minecraft:particle_appearance_tinting": {
            "color": [
                "0.5 - 0.35 * (v.particle_age / v.particle_lifetime)",
                "0.05",
                "0.65 - 0.3 * (v.particle_age / v.particle_lifetime)",
                "1.0 - 0.7 * (v.particle_age / v.particle_lifetime)",
            ]
        },
    },
)

PARTICLES["msword:void_blink"] = particle(
    "msword:void_blink", "particles_alpha", "msword_glow",
    {
        "minecraft:emitter_rate_instant": {"num_particles": 16},
        "minecraft:emitter_lifetime_once": {"active_time": 0.05},
        "minecraft:emitter_shape_point": {},
        "minecraft:particle_lifetime_expression": {"max_lifetime": 0.5},
        "minecraft:particle_motion_parametric": {
            "relative_position": [
                "math.cos(v.particle_random_1 * 360.0 + v.particle_age * 720.0) * 0.8 * (1.0 - v.particle_age / v.particle_lifetime)",
                "v.particle_random_2 * 1.8",
                "math.sin(v.particle_random_1 * 360.0 + v.particle_age * 720.0) * 0.8 * (1.0 - v.particle_age / v.particle_lifetime)",
            ]
        },
        "minecraft:particle_appearance_billboard": {
            "size": [0.12, 0.12],
            "facing_camera_mode": "rotate_xyz",
        },
        "minecraft:particle_appearance_tinting": {
            "color": ["0.6", "0.2", "0.85", "0.95 - 0.8 * (v.particle_age / v.particle_lifetime)"]
        },
    },
)

# ---- Celestial ----
PARTICLES["msword:celestial_star"] = particle(
    "msword:celestial_star", "particles_blend", "msword_star",
    {
        "minecraft:emitter_rate_instant": {"num_particles": 2},
        "minecraft:emitter_lifetime_once": {"active_time": 0.05},
        "minecraft:emitter_shape_point": {},
        "minecraft:particle_lifetime_expression": {"max_lifetime": "math.random(0.6, 1.0)"},
        "minecraft:particle_motion_parametric": {
            "relative_position": [
                "math.cos(v.particle_random_1 * 360.0 + v.particle_age * 160.0) * 0.5",
                "v.particle_random_2 * 1.6 - 0.3",
                "math.sin(v.particle_random_1 * 360.0 + v.particle_age * 160.0) * 0.5",
            ]
        },
        "minecraft:particle_appearance_billboard": {
            "size": [
                "0.1 + 0.05 * math.sin(v.particle_age * 720.0 + v.particle_random_3 * 360.0)",
                "0.1 + 0.05 * math.sin(v.particle_age * 720.0 + v.particle_random_3 * 360.0)",
            ],
            "facing_camera_mode": "rotate_xyz",
        },
        "minecraft:particle_appearance_tinting": {
            "color": [
                "1.0",
                "0.95 - 0.2 * v.particle_random_4",
                "0.7 + 0.3 * v.particle_random_4",
                "0.95 - 0.75 * (v.particle_age / v.particle_lifetime)",
            ]
        },
    },
)

PARTICLES["msword:celestial_slash"] = particle(
    "msword:celestial_slash", "particles_blend", "msword_slash",
    {
        "minecraft:emitter_rate_instant": {"num_particles": 14},
        "minecraft:emitter_lifetime_once": {"active_time": 0.05},
        "minecraft:emitter_shape_point": {},
        "minecraft:particle_lifetime_expression": {"max_lifetime": 0.4},
        "minecraft:particle_motion_parametric": {
            "relative_position": [
                "math.cos(-70.0 + v.particle_random_1 * 140.0) * (1.4 + v.particle_age * 3.5)",
                "1.0 + math.sin(-70.0 + v.particle_random_1 * 140.0) * (1.4 + v.particle_age * 3.5)",
                "(v.particle_random_2 - 0.5) * 0.5",
            ]
        },
        "minecraft:particle_initial_spin": {
            "rotation": "math.random(0, 360)",
            "rotation_rate": "math.random(-250, 250)",
        },
        "minecraft:particle_appearance_billboard": {
            "size": ["0.3 + v.particle_random_3 * 0.25", "0.3 + v.particle_random_3 * 0.25"],
            "facing_camera_mode": "rotate_xyz",
        },
        "minecraft:particle_appearance_tinting": {
            "color": [
                "1.0",
                "0.95",
                "0.65 + 0.35 * (v.particle_age / v.particle_lifetime)",
                "1.0 - 0.75 * (v.particle_age / v.particle_lifetime)",
            ]
        },
    },
)

PARTICLES["msword:celestial_nova"] = particle(
    "msword:celestial_nova", "particles_blend", "msword_star",
    burst(
        40, 0.5, "math.random(5.0, 7.5)", "math.random(0.45, 0.7)",
        ["0.16 + v.particle_random_1 * 0.12", "0.16 + v.particle_random_1 * 0.12"],
        surface=True,
        extra={
            "minecraft:particle_motion_dynamic": {"linear_drag_coefficient": 3.5},
            "minecraft:particle_initial_spin": {
                "rotation": "math.random(0, 360)",
                "rotation_rate": "math.random(-300, 300)",
            },
            "minecraft:particle_appearance_tinting": {
                "color": [
                    "1.0",
                    "1.0 - 0.25 * (v.particle_age / v.particle_lifetime)",
                    "0.85 - 0.45 * (v.particle_age / v.particle_lifetime)",
                    "1.0 - 0.65 * (v.particle_age / v.particle_lifetime)",
                ]
            },
        },
    ),
)


# --------------------------------------------------------------------------
# item_texture.json
# --------------------------------------------------------------------------

ITEM_TEXTURE = {
    "resource_pack_name": "magical_swords",
    "texture_name": "atlas.items",
    "texture_data": {
        f"msword_{key}": {"textures": f"textures/items/{key}_sword"} for key in SWORDS
    },
}


def main():
    for key, spec in SWORDS.items():
        write_json(os.path.join(RP, "models", "entity", f"{key}_sword.geo.json"), geometry_for(key, spec))
        write_json(os.path.join(RP, "attachables", f"{key}_sword.json"), attachable_for(key, spec))
        write_json(os.path.join(RP, "animations", f"{key}_sword.animation.json"), animations_for(key, spec))
        write_json(
            os.path.join(RP, "animation_controllers", f"{key}_sword.animation_controllers.json"),
            controller_for(key),
        )
    write_json(os.path.join(RP, "render_controllers", "msword.render_controllers.json"), RENDER_CONTROLLERS)
    for identifier, doc in PARTICLES.items():
        name = identifier.split(":", 1)[1]
        write_json(os.path.join(RP, "particles", f"{name}.json"), doc)
    write_json(os.path.join(RP, "textures", "item_texture.json"), ITEM_TEXTURE)
    print(f"{len(SWORDS)} swords, {len(PARTICLES)} particle systems.")


if __name__ == "__main__":
    main()
