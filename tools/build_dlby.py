#!/usr/bin/env python3
"""Validate and package DON'T LOOK BEHIND YOU.

Cross-checks everything that can be checked without launching the game: JSON
syntax, manifest UUIDs and dependencies, and - the part that actually catches
real bugs - every reference that crosses a file boundary. A geometry the client
entity names but the model file does not define, an animation bone that was
renamed on one side only, a mark_variant the animation controller waits for that
no component group ever sets: each of those ships as a silently invisible or
frozen mob, so each is an error here.

Usage:  python3 tools/build_dlby.py
"""

import json
import os
import re
import struct
import sys
import zipfile

BP = os.path.join("behavior_packs", "dlby_bp")
RP = os.path.join("resource_packs", "dlby_rp")
DIST = "dist"
ADDON = os.path.join(DIST, "Dont_Look_Behind_You.mcaddon")

ENTITY_ID = "dlby:follower"
ITEM_ID = "dlby:followers_eye"

errors = []
notes = []


def fail(msg):
    errors.append(msg)


def load(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception as exc:  # noqa: BLE001
        fail(f"{path}: invalid JSON ({exc})")
        return None


def png_size(path):
    """Read width/height straight out of IHDR, so a truncated or non-PNG file
    is caught here rather than showing up as a missing texture in game."""
    try:
        with open(path, "rb") as fh:
            head = fh.read(24)
        if head[:8] != b"\x89PNG\r\n\x1a\n" or head[12:16] != b"IHDR":
            return None
        return struct.unpack(">II", head[16:24])
    except Exception:  # noqa: BLE001
        return None


def walk_json(root):
    for base, _dirs, files in os.walk(root):
        for name in sorted(files):
            if name.endswith(".json"):
                yield os.path.join(base, name)


def validate():
    docs = {}
    for root in (BP, RP):
        if not os.path.isdir(root):
            fail(f"missing pack directory: {root}")
            continue
        for path in walk_json(root):
            docs[path] = load(path)
    if errors:
        return

    # ---------------- manifests ----------------
    bp_man = docs.get(os.path.join(BP, "manifest.json"))
    rp_man = docs.get(os.path.join(RP, "manifest.json"))
    if not bp_man or not rp_man:
        fail("missing a manifest")
        return

    uuids = []
    for man in (bp_man, rp_man):
        uuids.append(man["header"]["uuid"])
        uuids.extend(m["uuid"] for m in man["modules"])
    dupes = {u for u in uuids if uuids.count(u) > 1}
    if dupes:
        fail(f"duplicate UUIDs across manifests: {sorted(dupes)}")
    uuid_re = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
    for u in uuids:
        if not uuid_re.match(u):
            fail(f"malformed UUID: {u}")

    rp_uuid = rp_man["header"]["uuid"]
    deps = [d.get("uuid") for d in bp_man.get("dependencies", [])]
    if rp_uuid not in deps:
        fail(f"behaviour pack does not depend on the resource pack ({rp_uuid})")

    api = [d for d in bp_man.get("dependencies", []) if d.get("module_name") == "@minecraft/server"]
    if not api:
        fail("behaviour pack declares a script module but no @minecraft/server dependency")
    else:
        notes.append(f"@minecraft/server {api[0]['version']}")

    for man, tag in ((bp_man, "BP"), (rp_man, "RP")):
        mev = man["header"].get("min_engine_version")
        if mev != [1, 21, 0]:
            fail(f"{tag} min_engine_version is {mev}, expected [1, 21, 0]")

    entry = None
    for mod in bp_man["modules"]:
        if mod["type"] == "script":
            entry = os.path.join(BP, mod["entry"])
            if not os.path.isfile(entry):
                fail(f"script entry not found: {entry}")

    # ---------------- behaviour entity ----------------
    ent_path = os.path.join(BP, "entities", "follower.json")
    ent = docs.get(ent_path)
    if not ent:
        fail(f"missing {ent_path}")
        return
    ent_def = ent["minecraft:entity"]
    if ent_def["description"]["identifier"] != ENTITY_ID:
        fail(f"{ent_path}: identifier is not {ENTITY_ID}")

    groups = ent_def.get("component_groups", {})
    events = ent_def.get("events", {})
    for ev_name, ev in events.items():
        for action in ("add", "remove"):
            for g in ev.get(action, {}).get("component_groups", []):
                if g not in groups:
                    fail(f"{ent_path}: event '{ev_name}' {action}s unknown group '{g}'")

    # Every state the script can ask for must exist as an event.
    for needed in ("dlby:freeze", "dlby:stalk", "dlby:sprint", "dlby:attack", "dlby:vanish"):
        if needed not in events:
            fail(f"{ent_path}: missing event '{needed}' (the script triggers it)")

    variants = set()
    base_mv = ent_def.get("components", {}).get("minecraft:mark_variant")
    if base_mv:
        variants.add(base_mv["value"])
    for gname, g in groups.items():
        mv = g.get("minecraft:mark_variant")
        if mv:
            variants.add(mv["value"])

    loot = ent_def.get("components", {}).get("minecraft:loot")
    if loot:
        lt = os.path.join(BP, loot["table"])
        if not os.path.isfile(lt):
            fail(f"{ent_path}: loot table not found: {lt}")
        else:
            table = docs.get(lt)
            names = [
                e.get("name")
                for pool in (table or {}).get("pools", [])
                for e in pool.get("entries", [])
            ]
            if ITEM_ID not in names:
                fail(f"{lt}: does not drop {ITEM_ID}")

    # ---------------- client entity ----------------
    ce_path = os.path.join(RP, "entity", "follower.entity.json")
    ce = docs.get(ce_path)
    if not ce:
        fail(f"missing {ce_path}")
        return
    desc = ce["minecraft:client_entity"]["description"]
    if desc["identifier"] != ENTITY_ID:
        fail(f"{ce_path}: identifier does not match the behaviour entity")

    # geometry
    geo_path = os.path.join(RP, "models", "entity", "follower.geo.json")
    geo = docs.get(geo_path)
    if not geo:
        fail(f"missing {geo_path}")
        return
    geo_ids = {g["description"]["identifier"] for g in geo["minecraft:geometry"]}
    bones = {b["name"] for g in geo["minecraft:geometry"] for b in g["bones"]}
    for key, gid in desc["geometry"].items():
        if gid not in geo_ids:
            fail(f"{ce_path}: geometry '{key}' -> '{gid}' is not defined in {geo_path}")

    for g in geo["minecraft:geometry"]:
        for b in g["bones"]:
            parent = b.get("parent")
            if parent and parent not in bones:
                fail(f"{geo_path}: bone '{b['name']}' has unknown parent '{parent}'")

    tw = geo["minecraft:geometry"][0]["description"]["texture_width"]
    th = geo["minecraft:geometry"][0]["description"]["texture_height"]

    # textures
    for key, tex in desc["textures"].items():
        png = os.path.join(RP, tex + ".png")
        if not os.path.isfile(png):
            fail(f"{ce_path}: texture '{key}' -> missing {png}")
        else:
            size = png_size(png)
            if size is None:
                fail(f"{png}: not a readable PNG")
            elif list(size) != [tw, th]:
                fail(f"{png}: is {size[0]}x{size[1]} but the geometry declares {tw}x{th}")
            else:
                notes.append(f"entity texture {size[0]}x{size[1]}")

    # animations
    anim_path = os.path.join(RP, "animations", "follower.animation.json")
    anims = docs.get(anim_path)
    if not anims:
        fail(f"missing {anim_path}")
        return
    defined = set(anims["animations"].keys())
    short_to_long = desc.get("animations", {})
    for short, long in short_to_long.items():
        if long.startswith("animation.") and long not in defined:
            fail(f"{ce_path}: animation '{short}' -> '{long}' is not defined in {anim_path}")

    # Every bone an animation drives must exist in the model.
    for aname, a in anims["animations"].items():
        for bone in a.get("bones", {}):
            if bone not in bones:
                fail(f"{anim_path}: '{aname}' animates bone '{bone}', which is not in the model")

    # animation controllers
    ac_path = os.path.join(RP, "animation_controllers", "follower.animation_controllers.json")
    acs = docs.get(ac_path)
    if not acs:
        fail(f"missing {ac_path}")
        return
    ac_defined = set(acs["animation_controllers"].keys())
    used_ctrls = [c for c in desc.get("scripts", {}).get("animate", []) if isinstance(c, str)]
    for c in used_ctrls:
        if c.startswith("controller.") and c not in ac_defined:
            fail(f"{ce_path}: animation controller '{c}' is not defined in {ac_path}")
    wanted_variants = set()
    for cname, ctrl in acs["animation_controllers"].items():
        states = ctrl["states"]
        if ctrl.get("initial_state") and ctrl["initial_state"] not in states:
            fail(f"{ac_path}: '{cname}' initial_state '{ctrl['initial_state']}' does not exist")
        for sname, st in states.items():
            for a in st.get("animations", []):
                keys = [a] if isinstance(a, str) else list(a.keys())
                for k in keys:
                    if k not in short_to_long:
                        fail(f"{ac_path}: state '{sname}' plays '{k}', "
                             f"which {ce_path} does not declare")
            for tr in st.get("transitions", []):
                for target, cond in tr.items():
                    if target not in states:
                        fail(f"{ac_path}: state '{sname}' transitions to unknown state '{target}'")
                    for m in re.finditer(r"mark_variant\s*(==|<=|>=|<|>)\s*(\d+)", str(cond)):
                        wanted_variants.add(int(m.group(2)))

    # A controller waiting on a mark_variant nothing ever sets is a mob that
    # never animates - catch it here instead of in game.
    for v in sorted(wanted_variants):
        if v not in variants and v != 1:
            fail(f"{ac_path}: waits for mark_variant {v}, but no component group sets it "
                 f"(defined: {sorted(variants)})")

    # render controllers
    rc_path = os.path.join(RP, "render_controllers", "follower.render_controllers.json")
    rcs = docs.get(rc_path)
    if not rcs:
        fail(f"missing {rc_path}")
        return
    rc_defined = set(rcs["render_controllers"].keys())
    for rc in desc.get("render_controllers", []):
        name = rc if isinstance(rc, str) else list(rc.keys())[0]
        if name not in rc_defined:
            fail(f"{ce_path}: render controller '{name}' is not defined in {rc_path}")
    for rname, rc in rcs["render_controllers"].items():
        gkey = str(rc.get("geometry", "")).split(".")[-1]
        if gkey and gkey not in desc["geometry"]:
            fail(f"{rc_path}: '{rname}' uses Geometry.{gkey}, not declared in {ce_path}")
        for t in rc.get("textures", []):
            tkey = str(t).split(".")[-1]
            if tkey and tkey not in desc["textures"]:
                fail(f"{rc_path}: '{rname}' uses Texture.{tkey}, not declared in {ce_path}")
        for m in rc.get("materials", []):
            for mkey in m.values():
                key = str(mkey).split(".")[-1]
                if key not in desc.get("materials", {}):
                    fail(f"{rc_path}: '{rname}' uses Material.{key}, not declared in {ce_path}")

    # ---------------- item ----------------
    item_path = os.path.join(BP, "items", "followers_eye.json")
    item = docs.get(item_path)
    if not item:
        fail(f"missing {item_path}")
        return
    idef = item["minecraft:item"]
    if idef["description"]["identifier"] != ITEM_ID:
        fail(f"{item_path}: identifier is not {ITEM_ID}")

    version = tuple(int(p) for p in str(item.get("format_version", "0")).split("."))
    icon = idef["components"].get("minecraft:icon")
    if isinstance(icon, dict) and "texture" in icon and version >= (1, 20, 60):
        fail(f"{item_path}: minecraft:icon uses the deprecated flat 'texture' field at "
             f"format_version {item['format_version']} - use textures.default")
    key = icon.get("textures", {}).get("default") if isinstance(icon, dict) else icon
    atlas = docs.get(os.path.join(RP, "textures", "item_texture.json"))
    if not atlas:
        fail("missing resource_packs/dlby_rp/textures/item_texture.json")
    elif key not in atlas.get("texture_data", {}):
        fail(f"{item_path}: icon '{key}' is not in item_texture.json")
    else:
        png = os.path.join(RP, atlas["texture_data"][key]["textures"] + ".png")
        if not os.path.isfile(png):
            fail(f"item icon '{key}' points at missing {png}")
        elif png_size(png) is None:
            fail(f"{png}: not a readable PNG")

    # ---------------- language ----------------
    lang_path = os.path.join(RP, "texts", "en_US.lang")
    lang = ""
    if os.path.isfile(lang_path):
        with open(lang_path, encoding="utf-8") as fh:
            lang = fh.read()
    else:
        fail(f"missing {lang_path}")
    for needed in (f"item.{ITEM_ID}=", f"entity.{ENTITY_ID}.name=", "pack.name="):
        if needed not in lang:
            fail(f"{lang_path}: no entry for '{needed}'")
    bp_lang = os.path.join(BP, "texts", "en_US.lang")
    if not os.path.isfile(bp_lang):
        fail(f"missing {bp_lang}")

    # ---------------- pack icons ----------------
    for root in (BP, RP):
        icon_png = os.path.join(root, "pack_icon.png")
        if not os.path.isfile(icon_png):
            fail(f"missing {icon_png}")
        elif png_size(icon_png) is None:
            fail(f"{icon_png}: not a readable PNG")

    # ---------------- script sanity ----------------
    if entry and os.path.isfile(entry):
        with open(entry, encoding="utf-8") as fh:
            src = fh.read()
        for ev in re.findall(r'triggerEvent\("([^"]+)"\)', src):
            if ev not in events:
                fail(f"{entry}: triggers entity event '{ev}', which {ent_path} does not define")
        for ident in re.findall(r'"(dlby:[a-z_]+)"', src):
            if ident in (ENTITY_ID, ITEM_ID):
                continue
            if ident not in events:
                fail(f"{entry}: references unknown dlby identifier '{ident}'")
        if "@minecraft/server" not in src:
            fail(f"{entry}: does not import @minecraft/server")

    print(f"Validated {len(docs)} JSON files.")
    print(f"  bones {len(bones)} | animations {len(defined)} | "
          f"component groups {len(groups)} | mark_variants {sorted(variants)}")
    for n in notes:
        print(f"  {n}")


def package():
    os.makedirs(DIST, exist_ok=True)
    if os.path.exists(ADDON):
        os.remove(ADDON)
    with zipfile.ZipFile(ADDON, "w", zipfile.ZIP_DEFLATED) as z:
        for root, folder in ((BP, "dlby_bp"), (RP, "dlby_rp")):
            for base, _dirs, files in os.walk(root):
                for name in sorted(files):
                    src = os.path.join(base, name)
                    arc = os.path.join(folder, os.path.relpath(src, root)).replace(os.sep, "/")
                    z.write(src, arc)
    print(f"Packaged {ADDON} ({os.path.getsize(ADDON):,} bytes)")


if __name__ == "__main__":
    validate()
    if errors:
        print("\nBuild failed:", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        sys.exit(1)
    package()
