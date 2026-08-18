#!/usr/bin/env python3
"""Shared model tables for the Daybreak add-on.

One table describes every custom entity model. `gen_daybreak_assets.py` turns it
into Bedrock `.geo.json` files, `gen_daybreak_textures.py` paints the matching
PNG using the exact same cube/UV data, so a model and its skin can never drift
apart.

Cube UV follows Bedrock's standard box unwrap for a cube of size (w, h, d)
placed at texture coordinate (u, v):

    top    (u + d,         v        )  size (w, d)
    bottom (u + d + w,     v        )  size (w, d)
    right  (u,             v + d    )  size (d, h)
    front  (u + d,         v + d    )  size (w, h)
    left   (u + d + w,     v + d    )  size (d, h)
    back   (u + d + w + d, v + d    )  size (w, h)

Keeping the whole unwrap in one place means the texture generator can flood a
cube's footprint with mottled flesh and still know exactly where the *front of
the head* lands when it needs to paint eyes.
"""

# --------------------------------------------------------------------------
# Palettes - every colour the creatures are built from.
# --------------------------------------------------------------------------

PALETTES = {
    "melted_survivor": {
        "base": (150, 74, 68),
        "dark": (96, 42, 42),
        "light": (196, 118, 102),
        "accent": (214, 176, 132),
        "void": (28, 12, 14),
    },
    "flesh_mass": {
        "base": (128, 52, 52),
        "dark": (74, 26, 30),
        "light": (176, 92, 80),
        "accent": (226, 198, 150),
        "void": (22, 8, 10),
    },
    "crawling_melt": {
        "base": (162, 82, 70),
        "dark": (102, 44, 40),
        "light": (204, 128, 108),
        "accent": (236, 214, 160),
        "void": (24, 10, 12),
    },
    "assimilator": {
        "base": (138, 96, 84),
        "dark": (84, 52, 50),
        "light": (188, 142, 116),
        "accent": (242, 226, 168),
        "void": (20, 10, 12),
    },
    # Survivors share one geometry; only the palette changes per role.
    "survivor_civilian": {
        "base": (86, 96, 116),
        "dark": (52, 58, 74),
        "light": (122, 132, 150),
        "accent": (206, 166, 134),
        "void": (26, 26, 32),
    },
    "survivor_scientist": {
        "base": (214, 216, 220),
        "dark": (150, 152, 158),
        "light": (240, 242, 246),
        "accent": (206, 166, 134),
        "void": (40, 44, 52),
    },
    "survivor_guard": {
        "base": (58, 66, 60),
        "dark": (34, 40, 36),
        "light": (86, 96, 86),
        "accent": (198, 158, 126),
        "void": (18, 20, 18),
    },
    "survivor_medic": {
        "base": (222, 224, 228),
        "dark": (154, 120, 120),
        "light": (246, 248, 250),
        "accent": (200, 160, 128),
        "void": (150, 40, 40),
    },
    "survivor_engineer": {
        "base": (188, 138, 54),
        "dark": (126, 88, 32),
        "light": (222, 178, 88),
        "accent": (204, 164, 132),
        "void": (40, 34, 26),
    },
    "mimic_survivor": {
        "base": (128, 118, 130),
        "dark": (78, 70, 82),
        "light": (170, 158, 168),
        "accent": (208, 172, 140),
        "void": (24, 20, 26),
    },
    "flare": {
        "base": (198, 60, 40),
        "dark": (120, 30, 22),
        "light": (255, 214, 120),
        "accent": (255, 248, 214),
        "void": (60, 18, 14),
    },
    "suit": {
        "base": (192, 142, 62),
        "dark": (120, 86, 34),
        "light": (226, 182, 96),
        "accent": (86, 78, 62),
        "void": (48, 42, 34),
    },
}


def cube(origin, size, uv, inflate=None):
    entry = {"origin": list(origin), "size": list(size), "uv": list(uv)}
    if inflate:
        entry["inflate"] = inflate
    return entry


def bone(name, pivot, cubes, parent=None, rotation=None, mirror=False):
    entry = {"name": name, "pivot": list(pivot)}
    if parent:
        entry["parent"] = parent
    if rotation:
        entry["rotation"] = list(rotation)
    if mirror:
        entry["mirror"] = True
    entry["cubes"] = cubes
    return entry


# --------------------------------------------------------------------------
# Models
# --------------------------------------------------------------------------

def _humanoid(arm_len=12, leg_len=12, body_depth=4, head=(8, 8, 8)):
    """Classic 64x64 humanoid layout - used by survivors and the mimic."""
    hw, hh, hd = head
    return [
        bone("head", [0, 24, 0], [cube([-hw / 2, 24, -hd / 2], [hw, hh, hd], [0, 0])]),
        bone("body", [0, 24, 0], [cube([-4, 24 - 12, -body_depth / 2], [8, 12, body_depth], [16, 16])]),
        bone("rightArm", [-5, 22, 0], [cube([-8, 22 - arm_len, -2], [4, arm_len, 4], [40, 16])]),
        bone("leftArm", [5, 22, 0], [cube([4, 22 - arm_len, -2], [4, arm_len, 4], [32, 48])]),
        bone("rightLeg", [-1.9, 12, 0], [cube([-3.9, 12 - leg_len, -2], [4, leg_len, 4], [0, 16])]),
        bone("leftLeg", [1.9, 12, 0], [cube([-0.1, 12 - leg_len, -2], [4, leg_len, 4], [16, 48])]),
    ]


MODELS = {
    # ---------------------------------------------------------------- monsters
    "melted_survivor": {
        "identifier": "geometry.daybreak.melted_survivor",
        "texture": (64, 64),
        "bounds": (2.0, 2.4, [0, 1.0, 0]),
        "bones": [
            bone("head", [0, 21, 0], [
                cube([-4, 21, -4], [8, 7, 8], [0, 0]),          # skull
                cube([-3, 17, -3], [6, 4, 6], [32, 0]),         # sagging jaw / drip
            ]),
            bone("body", [0, 21, 0], [
                cube([-4.5, 9, -3], [9, 12, 6], [16, 16]),
            ]),
            bone("rightArm", [-5.5, 19, 0], [
                cube([-9.5, 3, -2], [4, 16, 4], [40, 16]),
            ]),
            bone("leftArm", [5.5, 19, 0], [
                cube([5.5, 3, -2], [4, 16, 4], [32, 48]),
            ]),
            bone("rightLeg", [-2.2, 9, 0], [
                cube([-4.4, 0, -2], [4, 9, 4], [0, 16]),
            ]),
            bone("leftLeg", [2.2, 9, 0], [
                cube([0.4, 0, -2], [4, 9, 4], [16, 48]),
            ]),
        ],
        "face": {"bone": "head", "cube": 0, "style": "melted"},
    },
    "flesh_mass": {
        "identifier": "geometry.daybreak.flesh_mass",
        "texture": (128, 128),
        "bounds": (3.5, 3.4, [0, 1.6, 0]),
        "bones": [
            bone("body", [0, 20, 0], [
                cube([-10, 14, -8], [20, 18, 16], [0, 0]),      # main mass
                cube([-7, 30, -5], [14, 6, 10], [0, 56]),       # crown of fused torsos
            ]),
            bone("head", [0, 22, -8], [
                cube([-6, 16, -14], [12, 10, 7], [0, 84]),      # maw
            ]),
            bone("rightArm", [-10, 28, 0], [
                cube([-16, 10, -3], [6, 20, 6], [56, 56]),
            ]),
            bone("leftArm", [10, 28, 0], [
                cube([10, 10, -3], [6, 20, 6], [86, 56]),
            ]),
            bone("rightLeg", [-5, 14, 0], [
                cube([-9, 0, -4], [8, 14, 8], [56, 90]),
            ]),
            bone("leftLeg", [5, 14, 0], [
                cube([1, 0, -4], [8, 14, 8], [90, 90]),
            ]),
        ],
        "face": {"bone": "head", "cube": 0, "style": "maw"},
    },
    "crawling_melt": {
        "identifier": "geometry.daybreak.crawling_melt",
        "texture": (32, 32),
        "bounds": (1.2, 0.9, [0, 0.3, 0]),
        "bones": [
            bone("body", [0, 3, 0], [
                cube([-4, 2, -5], [8, 4, 10], [0, 0]),
            ]),
            bone("head", [0, 4, -5], [
                cube([-3, 2, -9], [6, 4, 4], [0, 15]),
            ]),
            bone("rightArm", [-3, 3, -3], [
                cube([-5, 0, -4], [2, 3, 2], [21, 15]),
            ]),
            bone("leftArm", [3, 3, -3], [
                cube([3, 0, -4], [2, 3, 2], [21, 21]),
            ]),
            bone("rightLeg", [-3, 3, 3], [
                cube([-5, 0, 2], [2, 3, 2], [27, 15]),
            ]),
            bone("leftLeg", [3, 3, 3], [
                cube([3, 0, 2], [2, 3, 2], [27, 21]),
            ]),
        ],
        "face": {"bone": "head", "cube": 0, "style": "maw"},
    },
    "assimilator": {
        "identifier": "geometry.daybreak.assimilator",
        "texture": (64, 64),
        "bounds": (2.2, 3.2, [0, 1.4, 0]),
        "bones": [
            bone("head", [0, 32, 0], [
                cube([-3.5, 32, -3.5], [7, 7, 7], [0, 0]),
            ]),
            bone("body", [0, 32, 0], [
                cube([-3, 18, -2], [6, 14, 4], [16, 16]),
            ]),
            bone("rightArm", [-3.5, 31, 0], [
                cube([-6.5, 11, -1.5], [3, 20, 3], [40, 16]),
            ]),
            bone("leftArm", [3.5, 31, 0], [
                cube([3.5, 11, -1.5], [3, 20, 3], [32, 48]),
            ]),
            bone("rightLeg", [-1.6, 18, 0], [
                cube([-3.2, 0, -1.5], [3, 18, 3], [0, 16]),
            ]),
            bone("leftLeg", [1.6, 18, 0], [
                cube([0.2, 0, -1.5], [3, 18, 3], [16, 48]),
            ]),
        ],
        "face": {"bone": "head", "cube": 0, "style": "melted"},
    },
    # -------------------------------------------------------------- survivors
    "survivor": {
        "identifier": "geometry.daybreak.survivor",
        "texture": (64, 64),
        "bounds": (1.6, 2.2, [0, 1.0, 0]),
        "bones": _humanoid(),
        "face": {"bone": "head", "cube": 0, "style": "human"},
    },
    # ------------------------------------------------------------ props / fx
    "flare": {
        "identifier": "geometry.daybreak.flare",
        "texture": (16, 16),
        "bounds": (0.6, 0.6, [0, 0.2, 0]),
        "bones": [
            bone("body", [0, 2, 0], [
                cube([-1.5, 0, -1.5], [3, 5, 3], [0, 0]),
            ]),
        ],
    },
    "marker": {
        "identifier": "geometry.daybreak.marker",
        "texture": (8, 8),
        "bounds": (0.4, 0.4, [0, 0.2, 0]),
        "bones": [
            bone("body", [0, 0, 0], [
                cube([-0.5, 0, -0.5], [1, 1, 1], [0, 0]),
            ]),
        ],
    },
    # ------------------------------------------------- protective suit layers
    # Four attachable geometries over one shared 64x64 skin. Bone names match
    # the player skeleton so the game parents them automatically, and the
    # inflate values are staggered so the chest belt never z-fights the legs.
    "suit_helmet": {
        "identifier": "geometry.daybreak.suit_helmet",
        "texture": (64, 64),
        "bounds": (1.2, 1.2, [0, 1.6, 0]),
        "bones": [
            bone("head", [0, 24, 0], [cube([-4, 24, -4], [8, 8, 8], [0, 0], inflate=1.0)]),
        ],
        "face": {"bone": "head", "cube": 0, "style": None},
    },
    "suit_chest": {
        "identifier": "geometry.daybreak.suit_chest",
        "texture": (64, 64),
        "bounds": (1.6, 1.6, [0, 1.0, 0]),
        "bones": [
            bone("body", [0, 24, 0], [cube([-4, 12, -2], [8, 12, 4], [16, 16], inflate=1.05)]),
            bone("rightArm", [-5, 22, 0], [cube([-8, 10, -2], [4, 12, 4], [40, 16], inflate=1.0)]),
            bone("leftArm", [5, 22, 0], [cube([4, 10, -2], [4, 12, 4], [32, 48], inflate=1.0)]),
        ],
    },
    "suit_legs": {
        "identifier": "geometry.daybreak.suit_legs",
        "texture": (64, 64),
        "bounds": (1.4, 1.4, [0, 0.8, 0]),
        "bones": [
            bone("body", [0, 24, 0], [cube([-4, 12, -2], [8, 4, 4], [0, 32], inflate=0.6)]),
            bone("rightLeg", [-1.9, 12, 0], [cube([-3.9, 0, -2], [4, 12, 4], [0, 16], inflate=0.55)]),
            bone("leftLeg", [1.9, 12, 0], [cube([-0.1, 0, -2], [4, 12, 4], [16, 48], inflate=0.55)]),
        ],
    },
    "suit_boots": {
        "identifier": "geometry.daybreak.suit_boots",
        "texture": (64, 64),
        "bounds": (1.2, 0.8, [0, 0.3, 0]),
        "bones": [
            bone("rightLeg", [-1.9, 12, 0], [cube([-3.9, 0, -2], [4, 5, 4], [24, 32], inflate=0.9)]),
            bone("leftLeg", [1.9, 12, 0], [cube([-0.1, 0, -2], [4, 5, 4], [44, 32], inflate=0.9)]),
        ],
    },
}

# Attachable slot -> (model key, item identifier suffix).
SUIT_PIECES = [
    ("suit_helmet", "suit_helmet"),
    ("suit_chest", "suit_chestplate"),
    ("suit_legs", "suit_leggings"),
    ("suit_boots", "suit_boots"),
]

# Survivor roles all reuse geometry.daybreak.survivor with their own skin.
SURVIVOR_ROLES = [
    ("civilian", "Civilian Survivor"),
    ("scientist", "Site Scientist"),
    ("guard", "Security Guard"),
    ("medic", "Field Medic"),
    ("engineer", "Facility Engineer"),
]

# Which palette paints which texture file. Several textures share one model.
TEXTURE_SKINS = {
    "melted_survivor": ("melted_survivor", "melted_survivor"),
    "flesh_mass": ("flesh_mass", "flesh_mass"),
    "crawling_melt": ("crawling_melt", "crawling_melt"),
    "assimilator": ("assimilator", "assimilator"),
    "mimic_human": ("survivor", "mimic_survivor"),
    "mimic_revealed": ("melted_survivor", "melted_survivor"),
    "survivor_civilian": ("survivor", "survivor_civilian"),
    "survivor_scientist": ("survivor", "survivor_scientist"),
    "survivor_guard": ("survivor", "survivor_guard"),
    "survivor_medic": ("survivor", "survivor_medic"),
    "survivor_engineer": ("survivor", "survivor_engineer"),
    "flare": ("flare", "flare"),
}


def cube_faces(c):
    """Yield (face_name, x, y, w, h) texture rectangles for one cube."""
    u, v = c["uv"]
    w, h, d = (int(round(n)) for n in c["size"])
    yield "top", u + d, v, w, d
    yield "bottom", u + d + w, v, w, d
    yield "right", u, v + d, d, h
    yield "front", u + d, v + d, w, h
    yield "left", u + d + w, v + d, d, h
    yield "back", u + d + w + d, v + d, w, h
