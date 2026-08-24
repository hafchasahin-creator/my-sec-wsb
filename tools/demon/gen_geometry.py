"""Emit the Bedrock geometry JSON for the demon and its fire projectile."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spec  # noqa: E402

RP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..",
                  "resource_packs", "flying_demon_rp")


def demon_geometry():
    bones_spec, cube_index, uv = spec.build_uv()
    bones_out = []
    for b in bones_spec:
        bone = {"name": b["name"], "pivot": list(b["pivot"])}
        if b["parent"]:
            bone["parent"] = b["parent"]
        cubes = []
        for cube in b["cubes"]:
            cid, origin, size = cube[0], cube[1], cube[2]
            rects = uv[cid]
            face_uv = {}
            for f, (x, y, w, h) in rects.items():
                face_uv[f] = {"uv": [x, y], "uv_size": [w, h]}
            cubes.append({
                "origin": [round(v, 3) for v in origin],
                "size": [round(v, 3) for v in size],
                "uv": face_uv,
            })
        if cubes:
            bone["cubes"] = cubes
        if b.get("locators"):
            bone["locators"] = {k: list(v) for k, v in b["locators"].items()}
        bones_out.append(bone)

    return {
        "format_version": "1.12.0",
        "minecraft:geometry": [
            {
                "description": {
                    "identifier": "geometry.fdc_demon",
                    "texture_width": spec.TEX_W,
                    "texture_height": spec.TEX_H,
                    "visible_bounds_width": 10,
                    "visible_bounds_height": 6,
                    "visible_bounds_offset": [0, 2, 0],
                },
                "bones": bones_out,
            }
        ],
    }


def fireball_geometry():
    def face_uv_all(x, y, w, h):
        return {f: {"uv": [x, y], "uv_size": [w, h]} for f in spec.FACES}

    return {
        "format_version": "1.12.0",
        "minecraft:geometry": [
            {
                "description": {
                    "identifier": "geometry.fdc_demon_fire",
                    "texture_width": 16,
                    "texture_height": 16,
                    "visible_bounds_width": 1,
                    "visible_bounds_height": 1,
                    "visible_bounds_offset": [0, 0, 0],
                },
                "bones": [
                    {
                        "name": "body",
                        "pivot": [0, 0, 0],
                        "cubes": [
                            {
                                "origin": [-2.5, -2.5, -2.5],
                                "size": [5, 5, 5],
                                "uv": face_uv_all(0, 0, 5, 5),
                            },
                            {
                                "origin": [-1.5, -1.5, -1.5],
                                "size": [3, 3, 3],
                                "inflate": 1.6,
                                "uv": face_uv_all(6, 0, 3, 3),
                            },
                        ],
                    }
                ],
            }
        ],
    }


def main():
    models = os.path.join(RP, "models", "entity")
    os.makedirs(models, exist_ok=True)
    with open(os.path.join(models, "flying_demon.geo.json"), "w") as f:
        json.dump(demon_geometry(), f, indent=2)
    with open(os.path.join(models, "demon_fire.geo.json"), "w") as f:
        json.dump(fireball_geometry(), f, indent=2)
    print("geometry written")


if __name__ == "__main__":
    main()
