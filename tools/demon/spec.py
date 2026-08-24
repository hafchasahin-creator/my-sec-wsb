"""Single source of truth for the Flying Demon model.

Defines the bone tree and every cube (with a semantic paint tag), mirrors the
right-hand side from the left, and shelf-packs one texture rect per cube face
(per-face UV mapping, format_version 1.12.0) into a 256x256 atlas.

Both the geometry generator and the texture painter import this module, so
the UV layout and the painted pixels can never drift apart.
"""
import math

TEX_W, TEX_H = 256, 128

# ---------------------------------------------------------------------------
# Bone / cube definitions.  Units: model pixels (16 px = 1 block).
# The demon faces -Z.  Feet rest on y=0.
# Cube = (cube_id, origin, size, tag)
# ---------------------------------------------------------------------------

BONES = [
    {
        "name": "root",
        "parent": None,
        "pivot": [0, 0, 0],
        "cubes": [],
    },
    {
        "name": "body",
        "parent": "root",
        "pivot": [0, 26, 2],
        "cubes": [
            ("torso", [-7, 20, -10], [14, 12, 20], "hide"),
            ("chest_ridge", [-5, 22, -11.5], [10, 8, 3], "belly"),
            ("pelvis", [-5.5, 17, 4], [11, 4, 7], "hide"),
            ("spike1", [-1.25, 31.8, -6], [2.5, 3.5, 3], "spike"),
            ("spike2", [-1.25, 31.8, -1], [2.5, 4.5, 3.5], "spike"),
            ("spike3", [-1.25, 31.8, 4.5], [2.5, 3.5, 3], "spike"),
        ],
        "locators": {"chest": [0, 27, -8]},
    },
    {
        "name": "neck",
        "parent": "body",
        "pivot": [0, 28, -9],
        "cubes": [
            ("neck_c", [-3.5, 25, -16], [7, 6.5, 7], "hide"),
        ],
    },
    {
        "name": "head",
        "parent": "neck",
        "pivot": [0, 28, -15],
        "cubes": [
            ("skull", [-5, 25.5, -25], [10, 8, 10], "hide"),
            ("snout", [-3.5, 26.5, -31.5], [7, 3.8, 7], "hide"),
            ("teeth_up", [-3.1, 25.0, -31.2], [6.2, 1.6, 6.3], "teeth"),
            ("brow", [-5.2, 30.5, -25.5], [10.4, 1.5, 3], "hide"),
            ("eye_l", [1.6, 28.6, -25.6], [2.6, 1.8, 1], "eye"),
            ("eye_r", [-4.2, 28.6, -25.6], [2.6, 1.8, 1], "eye", "eye_l"),
            ("horn_l1", [2.4, 32.5, -21.6], [2.2, 3.5, 2.2], "horn"),
            ("horn_l2", [2.8, 35.6, -22.6], [1.7, 3.2, 1.7], "horn"),
            ("horn_l3", [3.2, 38.4, -23.4], [1.2, 3.0, 1.2], "horn"),
            ("horn_r1", [-4.6, 32.5, -21.6], [2.2, 3.5, 2.2], "horn", "horn_l1"),
            ("horn_r2", [-4.5, 35.6, -22.6], [1.7, 3.2, 1.7], "horn", "horn_l2"),
            ("horn_r3", [-4.4, 38.4, -23.4], [1.2, 3.0, 1.2], "horn", "horn_l3"),
        ],
        "locators": {
            "mouth": [0, 26, -31],
            "eye_left": [2.9, 29.5, -26.2],
            "eye_right": [-2.9, 29.5, -26.2],
        },
    },
    {
        "name": "jaw",
        "parent": "head",
        "pivot": [0, 26.5, -24],
        "cubes": [
            ("jaw_low", [-3.4, 23.6, -31], [6.8, 2.9, 7.5], "hide"),
            ("teeth_low", [-3.0, 26.3, -30.6], [6.0, 1.5, 6.4], "teeth"),
            ("chin_spike", [-0.9, 21.8, -30.5], [1.8, 2.2, 1.8], "spike"),
            ("inner_mouth", [-2.8, 24.2, -30.2], [5.6, 2.2, 6.2], "mouth"),
        ],
    },
    {
        "name": "wing_l",
        "parent": "body",
        "pivot": [6, 30, -4],
        "cubes": [
            ("wl_shoulder", [5, 28, -6], [4, 4, 4], "hide"),
            ("wl_arm", [6, 28.7, -5.3], [13, 2.6, 2.6], "hide"),
            ("wl_mem", [6, 29.3, -4], [13, 0.6, 15], "membrane"),
        ],
    },
    {
        "name": "wing_l_tip",
        "parent": "wing_l",
        "pivot": [19, 30, -4],
        "cubes": [
            ("wlt_bone", [19, 28.9, -5], [15, 2.2, 2.2], "hide"),
            ("wlt_mem", [19, 29.3, -4.2], [17, 0.6, 13], "membrane"),
            ("wlt_claw", [33.4, 28.4, -6.6], [1.8, 1.8, 3], "claw"),
        ],
    },
    {
        "name": "wing_r",
        "parent": "body",
        "pivot": [-6, 30, -4],
        "mirror_of": "wing_l",
        "cubes": [],
    },
    {
        "name": "wing_r_tip",
        "parent": "wing_r",
        "pivot": [-19, 30, -4],
        "mirror_of": "wing_l_tip",
        "cubes": [],
    },
    {
        "name": "arm_l",
        "parent": "body",
        "pivot": [6, 25, -8],
        "cubes": [
            ("al_upper", [4.6, 17.5, -9.6], [3.2, 8, 3.2], "hide"),
            ("al_fore", [4.9, 10.9, -9.4], [2.8, 7, 2.8], "hide"),
            ("al_claw1", [4.7, 7.6, -8.6], [0.9, 3.6, 0.9], "claw"),
            ("al_claw2", [5.9, 7.4, -8.6], [0.9, 3.9, 0.9], "claw"),
            ("al_claw3", [7.1, 7.6, -8.6], [0.9, 3.6, 0.9], "claw"),
        ],
    },
    {
        "name": "arm_r",
        "parent": "body",
        "pivot": [-6, 25, -8],
        "mirror_of": "arm_l",
        "cubes": [],
    },
    {
        "name": "leg_l",
        "parent": "body",
        "pivot": [3.6, 19, 6.5],
        "cubes": [
            ("ll_thigh", [1.6, 11.5, 4.4], [4.4, 8.5, 4.8], "hide"),
            ("ll_shin", [2.0, 4.5, 5.2], [3.6, 7.5, 3.6], "hide"),
            ("ll_foot", [1.7, 0, 1.8], [4.2, 3, 6.6], "hide"),
            ("ll_talon1", [2.0, 0, 0.6], [1.1, 1.6, 1.6], "claw"),
            ("ll_talon2", [3.4, 0, 0.6], [1.1, 1.6, 1.6], "claw"),
            ("ll_talon3", [4.8, 0, 0.9], [1.0, 1.5, 1.5], "claw"),
        ],
    },
    {
        "name": "leg_r",
        "parent": "body",
        "pivot": [-3.6, 19, 6.5],
        "mirror_of": "leg_l",
        "cubes": [],
    },
    {
        "name": "tail1",
        "parent": "body",
        "pivot": [0, 24, 10],
        "cubes": [
            ("t1", [-2.6, 21.6, 9.5], [5.2, 4.8, 10.5], "hide"),
            ("t1_spike", [-1.0, 26.2, 12], [2.0, 2.2, 2.6], "spike"),
        ],
    },
    {
        "name": "tail2",
        "parent": "tail1",
        "pivot": [0, 24, 19.5],
        "cubes": [
            ("t2", [-1.9, 22.2, 19.5], [3.8, 3.6, 10.5], "hide"),
        ],
    },
    {
        "name": "tail3",
        "parent": "tail2",
        "pivot": [0, 24, 29.5],
        "cubes": [
            ("t3", [-1.4, 22.7, 29.5], [2.8, 2.6, 9.5], "hide"),
        ],
    },
    {
        "name": "tail_spade",
        "parent": "tail3",
        "pivot": [0, 24, 38.5],
        "cubes": [
            ("spade", [-3.4, 23.7, 38], [6.8, 0.6, 8.5], "spade"),
        ],
    },
]

FACES = ["north", "south", "east", "west", "up", "down"]


def _face_px(size, face):
    sx, sy, sz = size
    if face in ("north", "south"):
        w, h = sx, sy
    elif face in ("east", "west"):
        w, h = sz, sy
    else:
        w, h = sx, sz
    return max(1, math.ceil(w)), max(1, math.ceil(h))


def _mirror_bone(src_bone, name, parent, pivot):
    """Create the right-hand twin of a left-side bone, sharing UVs."""
    cubes = []
    for cube in src_bone["cubes"]:
        cid, origin, size = cube[0], cube[1], cube[2]
        tag = cube[3]
        m_origin = [-(origin[0] + size[0]), origin[1], origin[2]]
        cubes.append((cid + "_M", m_origin, list(size), tag, cid))
    return {
        "name": name,
        "parent": parent,
        "pivot": pivot,
        "cubes": cubes,
    }


def build_model():
    """Resolve mirrors; return (bones, cube_index) where cube_index maps
    cube_id -> dict(origin, size, tag, uv_ref, bone)."""
    by_name = {b["name"]: b for b in BONES}
    bones = []
    for b in BONES:
        if b.get("mirror_of"):
            src = by_name[b["mirror_of"]]
            nb = _mirror_bone(src, b["name"], b["parent"], b["pivot"])
            if "locators" in b:
                nb["locators"] = b["locators"]
            bones.append(nb)
        else:
            bones.append(b)

    cube_index = {}
    for b in bones:
        for cube in b["cubes"]:
            cid, origin, size, tag = cube[0], cube[1], cube[2], cube[3]
            uv_ref = cube[4] if len(cube) > 4 else None
            cube_index[cid] = {
                "origin": origin,
                "size": size,
                "tag": tag,
                "uv_ref": uv_ref,
                "bone": b["name"],
            }
    return bones, cube_index


class _Shelf:
    def __init__(self, w, h):
        self.w = w
        self.h = h
        self.x = 0
        self.y = 0
        self.row_h = 0

    def alloc(self, w, h):
        pad = 1
        if self.x + w + pad > self.w:
            self.x = 0
            self.y += self.row_h + pad
            self.row_h = 0
        if self.y + h + pad > self.h:
            raise RuntimeError("texture atlas overflow")
        rect = (self.x, self.y, w, h)
        self.x += w + pad
        self.row_h = max(self.row_h, h)
        return rect


def build_uv():
    """Return uv map: cube_id -> {face: (x, y, w, h)}. Mirrored cubes share
    their source cube's rects."""
    bones, cube_index = build_model()
    uv = {}
    shelf = _Shelf(TEX_W, TEX_H)

    # Pack biggest faces first for tighter shelves, but keep per-cube
    # grouping deterministic.
    order = sorted(
        (cid for cid, c in cube_index.items() if not c["uv_ref"]),
        key=lambda cid: -max(
            _face_px(cube_index[cid]["size"], f)[1] for f in FACES
        ),
    )
    for cid in order:
        c = cube_index[cid]
        faces = {}
        for f in FACES:
            w, h = _face_px(c["size"], f)
            faces[f] = shelf.alloc(w, h)
        uv[cid] = faces
    for cid, c in cube_index.items():
        if c["uv_ref"]:
            uv[cid] = uv[c["uv_ref"]]
    return bones, cube_index, uv


if __name__ == "__main__":
    bones, cube_index, uv = build_uv()
    used_h = max(r[1] + r[3] for f in uv.values() for r in f.values())
    print(f"cubes: {len(cube_index)}, atlas rows used: {used_h}/{TEX_H}")
