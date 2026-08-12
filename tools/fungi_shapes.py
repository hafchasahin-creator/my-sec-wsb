#!/usr/bin/env python3
"""Block geometry for the twenty fungi.

Each shape is a list of cubes in Bedrock block space: x and z run -8..8, y runs
0..16, and the block's own origin sits at (0, 0, 0) in the middle of the floor.

`mat` names the material instance a cube's faces use. The generator turns those
names into `minecraft:material_instances` entries and into per-face
`material_instance` overrides inside the geometry file, so one block can mix a
cap texture, a stem texture and a glowing texture without any block states.

Two layouts exist:
  * "material"   - box models skinned with tiling cap/stem materials
  * "silhouette" - crossed planes skinned with one cut-out texture
"""


def cube(x, y, z, w, h, d, mat="cap", rotation=None, pivot=None):
    entry = {"origin": [x, y, z], "size": [w, h, d], "mat": mat}
    if rotation:
        entry["rotation"] = rotation
        entry["pivot"] = pivot or [0, 0, 0]
    return entry


def _cross(mat="cap"):
    return [
        cube(-8, 0, 0, 16, 16, 0, mat, rotation=[0, 45, 0]),
        cube(-8, 0, 0, 16, 16, 0, mat, rotation=[0, -45, 0]),
    ]


SHAPES = {
    # 1 - Bloodcap: squat stem under a wide, heavy cap with a drip rim.
    "cap_broad": {
        "layout": "material",
        "cubes": [
            cube(-2, 0, -2, 4, 6, 4, "stem"),
            cube(-6, 6, -6, 12, 4, 12, "cap"),
            cube(-7, 6, -7, 14, 1, 14, "cap"),
            cube(-3, 10, -3, 6, 1, 6, "cap"),
        ],
    },
    # 2 - Toxic Veil: hanging crossed sheets.
    "veil": {"layout": "silhouette", "cubes": _cross()},
    # 3 - Sporeburst: taut round puffball.
    "puffball": {
        "layout": "material",
        "cubes": [
            cube(-3, 0, -3, 6, 2, 6, "stem"),
            cube(-5, 2, -5, 10, 6, 10, "cap"),
            cube(-4, 8, -4, 8, 2, 8, "cap"),
            cube(-2, 10, -2, 4, 1, 4, "cap"),
        ],
    },
    # 4 - Shadow Morel: tall pitted spire on a short stalk.
    "morel": {
        "layout": "material",
        "cubes": [
            cube(-2, 0, -2, 4, 4, 4, "stem"),
            cube(-4, 4, -4, 8, 7, 8, "cap"),
            cube(-3, 11, -3, 6, 3, 6, "cap"),
            cube(-1, 14, -1, 2, 2, 2, "cap"),
        ],
    },
    # 5 - Embercap: glowing coal held in a flat cap.
    "cap_glow": {
        "layout": "material",
        "cubes": [
            cube(-2, 0, -2, 4, 4, 4, "stem"),
            cube(-5, 4, -5, 10, 3, 10, "cap"),
            cube(-6, 5, -6, 12, 1, 12, "cap"),
            cube(-3, 7, -3, 6, 2, 6, "glow"),
        ],
    },
    # 6 - Frost Mold: flat rime crust with a few raised shards.
    "crust": {
        "layout": "material",
        "cubes": [
            cube(-8, 0, -8, 16, 1, 16, "cap"),
            cube(-6, 1, -5, 5, 2, 4, "cap"),
            cube(1, 1, 2, 4, 3, 4, "cap"),
            cube(-2, 1, -7, 3, 2, 3, "cap"),
            cube(4, 1, -6, 2, 4, 2, "cap"),
        ],
    },
    # 7 - Rotcap: sagging cap collapsing over its stem.
    "droop": {
        "layout": "material",
        "cubes": [
            cube(-2, 0, -2, 4, 7, 4, "stem"),
            cube(-6, 7, -6, 12, 2, 12, "cap"),
            cube(-7, 5, -7, 14, 2, 14, "cap"),
            cube(-4, 9, -4, 8, 1, 8, "cap"),
        ],
    },
    # 8 - Phantom Fungus: thin crossed sheets, barely there.
    "phantom_veil": {"layout": "silhouette", "cubes": _cross()},
    # 9 - Shockshroom: charged bulb on a tall conductive stalk.
    "antenna": {
        "layout": "material",
        "cubes": [
            cube(-4, 0, -4, 8, 3, 8, "stem"),
            cube(-1, 3, -1, 2, 8, 2, "stem"),
            cube(-3, 11, -3, 6, 4, 6, "glow"),
            cube(-5, 2, -1, 2, 1, 2, "cap"),
            cube(3, 2, -1, 2, 1, 2, "cap"),
        ],
    },
    # 10 - Acid Bloom: open cup with a pool of acid in it.
    "bowl": {
        "layout": "material",
        "cubes": [
            cube(-2, 0, -2, 4, 3, 4, "stem"),
            cube(-6, 3, -6, 12, 1, 12, "cap"),
            cube(-6, 4, -6, 12, 4, 2, "cap"),
            cube(-6, 4, 4, 12, 4, 2, "cap"),
            cube(-6, 4, -4, 2, 4, 8, "cap"),
            cube(4, 4, -4, 2, 4, 8, "cap"),
            cube(-4, 4, -4, 8, 1, 8, "cap"),
        ],
    },
    # 11 - Voidcap: dark cap drawn up into a spire.
    "cap_spire": {
        "layout": "material",
        "cubes": [
            cube(-2, 0, -2, 4, 5, 4, "stem"),
            cube(-5, 5, -5, 10, 4, 10, "cap"),
            cube(-3, 9, -3, 6, 3, 6, "cap"),
            cube(-1, 12, -1, 2, 3, 2, "glow"),
        ],
    },
    # 12 - Spine Fungus: hardened needles at four heights.
    "spikes": {
        "layout": "material",
        "cubes": [
            cube(-6, 0, -6, 12, 2, 12, "stem"),
            cube(-5, 2, -4, 2, 7, 2, "cap"),
            cube(1, 2, -5, 2, 9, 2, "cap"),
            cube(-2, 2, 2, 2, 6, 2, "cap"),
            cube(3, 2, 1, 2, 5, 2, "cap"),
            cube(-1, 2, -1, 2, 4, 2, "cap"),
        ],
    },
    # 13 - Crimson Brain: stacked lobes.
    "brain": {
        "layout": "material",
        "cubes": [
            cube(-5, 0, -5, 10, 4, 10, "stem"),
            cube(-6, 3, -4, 12, 4, 8, "cap"),
            cube(-4, 3, -6, 8, 4, 12, "cap"),
            cube(-3, 7, -3, 6, 3, 6, "cap"),
            cube(-1, 10, -1, 2, 2, 2, "cap"),
        ],
    },
    # 14 - Glowspore: luminous crust studded with nodules.
    "crust_nodule": {
        "layout": "material",
        "cubes": [
            cube(-8, 0, -8, 16, 1, 16, "cap"),
            cube(-6, 1, -6, 3, 3, 3, "glow"),
            cube(2, 1, -4, 4, 4, 4, "glow"),
            cube(-3, 1, 3, 3, 3, 3, "glow"),
            cube(4, 1, 3, 2, 2, 2, "glow"),
            cube(-1, 1, -2, 2, 2, 2, "glow"),
        ],
    },
    # 15 - Deathbell: pale bell hanging from a black stalk.
    "bell": {
        "layout": "material",
        "cubes": [
            cube(-1, 0, -1, 2, 9, 2, "stem"),
            cube(-5, 7, -5, 10, 6, 10, "cap"),
            cube(-6, 7, -6, 12, 2, 12, "cap"),
            cube(-3, 13, -3, 6, 2, 6, "cap"),
            cube(-1, 15, -1, 2, 1, 2, "stem"),
        ],
    },
    # 16 - Creeping Mold: thin film with overlapping patches.
    "crust_patch": {
        "layout": "material",
        "cubes": [
            cube(-8, 0, -8, 16, 1, 16, "cap"),
            cube(-7, 1, -6, 6, 1, 5, "cap"),
            cube(0, 1, -2, 7, 1, 7, "cap"),
            cube(-4, 1, 2, 5, 2, 5, "cap"),
        ],
    },
    # 17 - Ash Fungus: three grey stalks at different heights.
    "cluster": {
        "layout": "material",
        "cubes": [
            cube(-7, 0, -7, 14, 1, 14, "stem"),
            cube(-5, 1, -4, 2, 5, 2, "stem"),
            cube(-7, 6, -6, 6, 2, 6, "cap"),
            cube(2, 1, 1, 2, 7, 2, "stem"),
            cube(0, 8, -1, 6, 2, 6, "cap"),
            cube(-1, 1, 4, 2, 4, 2, "stem"),
            cube(-3, 5, 2, 6, 2, 6, "cap"),
        ],
    },
    # 18 - Nightmare Cap: tall cap with a flared spotted brim.
    "cap_tall": {
        "layout": "material",
        "cubes": [
            cube(-2, 0, -2, 4, 8, 4, "stem"),
            cube(-5, 8, -5, 10, 6, 10, "cap"),
            cube(-6, 9, -6, 12, 2, 12, "cap"),
            cube(-3, 14, -3, 6, 2, 6, "cap"),
        ],
    },
    # 19 - Parasite Bloom: bulb throwing out four thin tendrils.
    "tendril": {
        "layout": "material",
        "cubes": [
            cube(-4, 0, -4, 8, 3, 8, "stem"),
            cube(-3, 3, -3, 6, 5, 6, "cap"),
            cube(-6, 6, -1, 1, 8, 1, "glow"),
            cube(5, 6, 0, 1, 9, 1, "glow"),
            cube(0, 6, -6, 1, 7, 1, "glow"),
            cube(-1, 6, 5, 1, 8, 1, "glow"),
        ],
    },
    # 20 - Mycelium-X Core: a mutated mass with four rising spires.
    "core": {
        "layout": "material",
        "cubes": [
            cube(-8, 0, -8, 16, 3, 16, "stem"),
            cube(-6, 3, -6, 12, 8, 12, "cap"),
            cube(-4, 11, -4, 8, 3, 8, "cap"),
            cube(-2, 14, -2, 4, 2, 4, "glow"),
            cube(-7, 3, -7, 2, 10, 2, "glow"),
            cube(5, 3, 5, 2, 11, 2, "glow"),
            cube(5, 3, -7, 2, 9, 2, "glow"),
            cube(-7, 3, 5, 2, 10, 2, "glow"),
        ],
    },
}


def materials_used(shape_name):
    """Ordered set of material instance names a shape needs."""
    seen = []
    for entry in SHAPES[shape_name]["cubes"]:
        if entry["mat"] not in seen:
            seen.append(entry["mat"])
    return seen


def bounds(shape_name):
    """Axis-aligned bounding box of a shape as (origin, size)."""
    cubes = SHAPES[shape_name]["cubes"]
    lo = [min(c["origin"][i] for c in cubes) for i in range(3)]
    hi = [max(c["origin"][i] + c["size"][i] for c in cubes) for i in range(3)]
    # Crossed planes are rotated 45 degrees, so their real footprint is the
    # full block rather than the unrotated plane.
    if SHAPES[shape_name]["layout"] == "silhouette":
        return [-8, 0, -8], [16, 16, 16]
    return lo, [hi[i] - lo[i] for i in range(3)]


def selection_box(shape_name):
    origin, size = bounds(shape_name)
    origin = [max(-8, min(8, v)) for v in origin]
    origin[1] = max(0, origin[1])
    size = [max(1, min(16, v)) for v in size]
    # Keep the box inside the legal -8..8 / 0..16 envelope.
    for axis in (0, 2):
        size[axis] = min(size[axis], 8 - origin[axis])
    size[1] = min(size[1], 16 - origin[1])
    return {"origin": origin, "size": size}


def validate():
    problems = []
    for name, shape in SHAPES.items():
        for index, entry in enumerate(shape["cubes"]):
            ox, oy, oz = entry["origin"]
            sx, sy, sz = entry["size"]
            if shape["layout"] == "silhouette":
                continue
            if not (-8 <= ox and ox + sx <= 8):
                problems.append(f"{name} cube {index}: x out of range")
            if not (-8 <= oz and oz + sz <= 8):
                problems.append(f"{name} cube {index}: z out of range")
            if not (0 <= oy and oy + sy <= 16):
                problems.append(f"{name} cube {index}: y out of range")
            if min(sx, sy, sz) < 0:
                problems.append(f"{name} cube {index}: negative size")
    return problems


if __name__ == "__main__":
    issues = validate()
    print("\n".join(issues) if issues else f"{len(SHAPES)} shapes OK")
