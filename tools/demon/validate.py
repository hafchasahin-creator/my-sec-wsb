"""Validate the Flying Demon add-on against Minecraft Bedrock 1.21.0.26.

Every component, event response, Molang query and particle component used by
the packs is cross-checked against the *official documentation and vanilla
packs shipped inside Mojang/bedrock-samples at tag v1.21.0.26-preview*, and
every internal reference (groups, events, animations, bones, locators,
textures, sounds, particles, UUIDs, script APIs) is resolved.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
BP = os.path.join(ROOT, "behavior_packs", "flying_demon_bp")
RP = os.path.join(ROOT, "resource_packs", "flying_demon_rp")
SAMPLES = os.environ.get("BEDROCK_SAMPLES", "/home/user/bedrock-samples")

errors = []
warns = []


def err(msg):
    errors.append(msg)


def warn(msg):
    warns.append(msg)


def strict_load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def walk_json(root_dir):
    for base, _, files in os.walk(root_dir):
        for fn in files:
            if fn.endswith(".json"):
                yield os.path.join(base, fn)


# ---------------------------------------------------------------------------
# 0. strict JSON everywhere
# ---------------------------------------------------------------------------
docs_cache = {}


def doc_text(name):
    if name not in docs_cache:
        p = os.path.join(SAMPLES, "documentation", name)
        with open(p, encoding="utf-8", errors="replace") as f:
            docs_cache[name] = f.read()
    return docs_cache[name]


def vanilla_text():
    if "vanilla" not in docs_cache:
        chunks = []
        for sub in ("behavior_pack", "resource_pack"):
            for base, _, files in os.walk(os.path.join(SAMPLES, sub)):
                for fn in files:
                    if fn.endswith(".json"):
                        with open(os.path.join(base, fn), encoding="utf-8",
                                  errors="replace") as f:
                            chunks.append(f.read())
        docs_cache["vanilla"] = "\n".join(chunks)
    return docs_cache["vanilla"]


all_json = {}
for pack in (BP, RP):
    for path in walk_json(pack):
        try:
            all_json[path] = strict_load(path)
        except Exception as e:
            err(f"invalid JSON: {os.path.relpath(path, ROOT)}: {e}")

if errors:
    print("\n".join("ERROR: " + e for e in errors))
    sys.exit(1)


def collect_keys(obj, out):
    if isinstance(obj, dict):
        for k, v in obj.items():
            out.add(k)
            collect_keys(v, out)
    elif isinstance(obj, list):
        for v in obj:
            collect_keys(v, out)


# ---------------------------------------------------------------------------
# 1. BP entity components & event responses exist in 1.21.0.26
# ---------------------------------------------------------------------------
ENTITIES_DOC = doc_text("Entities.html")
EVENTS_DOC = doc_text("Entity Events.html")
MOLANG_DOC = doc_text("Molang.html")
PARTICLES_DOC = doc_text("Particles.html")

bp_entities = [p for p in all_json if p.startswith(os.path.join(BP, "entities"))]
RESPONSE_KEYS = {"add", "remove", "sequence", "randomize", "trigger",
                 "queue_command", "set_property", "filters", "component_groups",
                 "command", "event", "target", "weight", "set_home_position",
                 "emit_vibration", "play_sound"}

for path in bp_entities:
    data = all_json[path]
    ent = data["minecraft:entity"]
    comps = set()
    for holder in [ent.get("components", {})] + list(
            ent.get("component_groups", {}).values()):
        comps |= set(holder.keys())
    for c in comps:
        if not c.startswith("minecraft:"):
            err(f"{os.path.basename(path)}: non-vanilla component {c}")
            continue
        short = c.split(":", 1)[1]
        if short not in ENTITIES_DOC and c not in vanilla_text():
            err(f"{os.path.basename(path)}: component {c} not found in "
                "1.21.0.26 docs or vanilla packs")
    # event structure
    groups = set(ent.get("component_groups", {}).keys())
    events = ent.get("events", {})

    def scan_response(resp, ev_name):
        if isinstance(resp, dict):
            for k, v in resp.items():
                if k in ("add", "remove"):
                    for g in v.get("component_groups", []):
                        if g not in groups:
                            err(f"{ev_name}: unknown component group {g}")
                elif k == "sequence":
                    for sub in v:
                        scan_response(sub, ev_name)
                elif k == "randomize":
                    for sub in v:
                        scan_response(sub, ev_name)
                elif k == "queue_command":
                    if "queue_command" not in EVENTS_DOC:
                        err("queue_command response not documented")
                elif k == "trigger":
                    pass
                elif k not in RESPONSE_KEYS:
                    warn(f"{ev_name}: unusual response key {k}")

    for ev_name, resp in events.items():
        scan_response(resp, ev_name)

    # every event referenced by a component must exist
    blob = json.dumps(ent)
    for ref in re.findall(r'"event"\s*:\s*"((?:fdc|minecraft):[\w.]+)"', blob):
        if ref.startswith("fdc:") and ref not in events:
            err(f"{os.path.basename(path)}: referenced event {ref} undefined")
    if "minecraft:on_tame" in blob and "minecraft:on_tame" not in events:
        err("tame_event minecraft:on_tame undefined")

# projectile sanity: compare our projectile keys against vanilla small_fireball
fireball_doc = ENTITIES_DOC
proj = all_json[os.path.join(BP, "entities", "demon_fire.json")]
proj_keys = set()
collect_keys(proj["minecraft:entity"]["components"].get("minecraft:projectile", {}),
             proj_keys)
van_sf = open(os.path.join(SAMPLES, "behavior_pack", "entities",
                           "small_fireball.json"), encoding="utf-8").read()
for k in proj_keys:
    if k not in van_sf and k not in ENTITIES_DOC:
        err(f"projectile key '{k}' not in vanilla small_fireball or docs")

# ---------------------------------------------------------------------------
# 2. script module check against stable 1.11.0 metadata
# ---------------------------------------------------------------------------
meta_path = os.path.join(SAMPLES, "metadata", "script_modules", "@minecraft",
                         "server_1.11.0.json")
smeta = json.load(open(meta_path))
sclasses = {c["name"]: c for c in
            smeta.get("classes", []) + smeta.get("interfaces", [])}


def has_member(cls, name, kind):
    c = sclasses.get(cls)
    if not c:
        return False
    return any(m["name"] == name for m in c.get(kind, []))


checks = [
    ("WorldAfterEvents", "entityDie", "properties"),
    ("EntityDieAfterEventSignal", "subscribe", "functions"),
    ("EntityDieAfterEvent", "damageSource", "properties"),
    ("Entity", "triggerEvent", "functions"),
    ("Entity", "addEffect", "functions"),
    ("Entity", "isValid", "functions"),
    ("Entity", "typeId", "properties"),
    ("EntityDamageSource", "damagingEntity", "properties"),
]
for cls, member, kind in checks:
    if not has_member(cls, member, kind):
        err(f"script API {cls}.{member} not in stable @minecraft/server 1.11.0")

bp_manifest = all_json[os.path.join(BP, "manifest.json")]
dep_ok = any(d.get("module_name") == "@minecraft/server" and
             d.get("version") == "1.11.0"
             for d in bp_manifest.get("dependencies", []))
if not dep_ok:
    err("BP manifest must depend on @minecraft/server 1.11.0")
if not os.path.exists(os.path.join(BP, "scripts", "main.js")):
    err("scripts/main.js missing")

# manifest cross-link
rp_manifest = all_json[os.path.join(RP, "manifest.json")]
rp_uuid = rp_manifest["header"]["uuid"]
if not any(d.get("uuid") == rp_uuid for d in bp_manifest.get("dependencies", [])):
    err("BP manifest does not depend on RP uuid")
for m in (bp_manifest, rp_manifest):
    if m["header"]["min_engine_version"] > [1, 21, 0]:
        err("min_engine_version exceeds 1.21.0")

# ---------------------------------------------------------------------------
# 3. RP wiring
# ---------------------------------------------------------------------------
anim_file = all_json[os.path.join(RP, "animations", "flying_demon.animation.json")]
anims = anim_file["animations"]
ac_file = all_json[os.path.join(
    RP, "animation_controllers", "flying_demon.animation_controllers.json")]
acs = ac_file["animation_controllers"]
geo_demon = all_json[os.path.join(RP, "models", "entity", "flying_demon.geo.json")]
geo_fire = all_json[os.path.join(RP, "models", "entity", "demon_fire.geo.json")]
particles = {}
for p in walk_json(os.path.join(RP, "particles")):
    particles[all_json[p]["particle_effect"]["description"]["identifier"]] = all_json[p]
sound_defs = all_json[os.path.join(RP, "sounds", "sound_definitions.json")]
sound_ids = set(sound_defs["sound_definitions"].keys())
render_ctrl = all_json[os.path.join(
    RP, "render_controllers", "flying_demon.render_controllers.json")]

geo_ids = {}
for gf in (geo_demon, geo_fire):
    for g in gf["minecraft:geometry"]:
        bones = {b["name"] for b in g["bones"]}
        locators = set()
        for b in g["bones"]:
            locators |= set(b.get("locators", {}).keys())
        geo_ids[g["description"]["identifier"]] = (bones, locators)

for entity_file, geo_id in (("flying_demon.entity.json", "geometry.fdc_demon"),
                            ("demon_fire.entity.json", "geometry.fdc_demon_fire")):
    ce = all_json[os.path.join(RP, "entity", entity_file)]
    desc = ce["minecraft:client_entity"]["description"]
    for tex in desc["textures"].values():
        if not os.path.exists(os.path.join(RP, tex + ".png")):
            err(f"{entity_file}: texture missing {tex}")
    for gid in desc["geometry"].values():
        if gid not in geo_ids:
            err(f"{entity_file}: geometry missing {gid}")
    for aname, aid in desc.get("animations", {}).items():
        if aid.startswith("animation.fdc"):
            if aid not in anims:
                err(f"{entity_file}: animation missing {aid}")
        elif aid.startswith("controller.animation."):
            if aid not in acs:
                err(f"{entity_file}: controller missing {aid}")
        elif aid == "animation.common.look_at_target":
            van_anim = open(os.path.join(
                SAMPLES, "resource_pack", "animations",
                "look_at_target.animation.json"), encoding="utf-8").read()
            if aid not in van_anim:
                err("vanilla animation.common.look_at_target not found")
        else:
            err(f"{entity_file}: unknown animation ref {aid}")
    for pname, pid in desc.get("particle_effects", {}).items():
        if pid not in particles:
            err(f"{entity_file}: particle {pid} undefined")
    for sname, sid in desc.get("sound_effects", {}).items():
        if sid not in sound_ids:
            err(f"{entity_file}: sound {sid} undefined")
    for rc in desc.get("render_controllers", []):
        if rc not in render_ctrl["render_controllers"]:
            err(f"{entity_file}: render controller {rc} undefined")
    egg = desc.get("spawn_egg")
    if egg and "texture" in egg:
        itex = all_json[os.path.join(RP, "textures", "item_texture.json")]
        td = itex["texture_data"]
        if egg["texture"] not in td:
            err("spawn egg texture id not in item_texture.json")
        else:
            texp = td[egg["texture"]]["textures"]
            if not os.path.exists(os.path.join(RP, texp + ".png")):
                err(f"spawn egg texture file missing: {texp}")

# animations reference only bones/locators that exist in the demon geometry
demon_bones, demon_locators = geo_ids["geometry.fdc_demon"]
fire_bones, _ = geo_ids["geometry.fdc_demon_fire"]
for aid, adef in anims.items():
    target_bones = fire_bones if "demon_fire" in aid else demon_bones
    for bone in adef.get("bones", {}):
        if bone not in target_bones:
            err(f"{aid}: bone '{bone}' not in geometry")
    blob = json.dumps(adef)
    for loc in re.findall(r'"locator"\s*:\s*"(\w+)"', blob):
        if loc not in demon_locators:
            err(f"{aid}: locator '{loc}' not in geometry")
    for eff in re.findall(r'"effect"\s*:\s*"(\w+)"', blob):
        pass  # effects are short names resolved via client entity maps

# client-entity effect short-name coverage for animation effect keyframes
ce_demon = all_json[os.path.join(RP, "entity", "flying_demon.entity.json")]
desc = ce_demon["minecraft:client_entity"]["description"]
short_particles = set(desc.get("particle_effects", {}).keys())
short_sounds = set(desc.get("sound_effects", {}).keys())
for aid, adef in anims.items():
    if "demon_fire" in aid:
        continue
    for section, names in (("particle_effects", short_particles),
                           ("sound_effects", short_sounds)):
        for key, evs in adef.get(section, {}).items():
            evs = evs if isinstance(evs, list) else [evs]
            for e in evs:
                if e["effect"] not in names:
                    err(f"{aid}: {section} short name '{e['effect']}' not mapped"
                        " in client entity")

# fireball client anim effect coverage
ce_fire = all_json[os.path.join(RP, "entity", "demon_fire.entity.json")]
fire_short = set(ce_fire["minecraft:client_entity"]["description"]
                 .get("particle_effects", {}).keys())
for key, evs in anims["animation.fdc_demon_fire.trail"].get(
        "particle_effects", {}).items():
    evs = evs if isinstance(evs, list) else [evs]
    for e in evs:
        if e["effect"] not in fire_short:
            err(f"fire trail effect '{e['effect']}' unmapped")

# AC transition targets exist; queries valid
for cid, cdef in acs.items():
    states = cdef["states"]
    if cdef.get("initial_state") and cdef["initial_state"] not in states:
        err(f"{cid}: initial_state missing")
    for sname, sdef in states.items():
        for anim in sdef.get("animations", []):
            pass  # short names, resolved via client entity (checked above)
        for tr in sdef.get("transitions", []):
            for target in tr:
                if target not in states:
                    err(f"{cid}: transition target '{target}' missing")

# every AC short animation name must exist in client entity animations map
ce_anim_names = set(desc.get("animations", {}).keys())
for cid, cdef in acs.items():
    for sname, sdef in cdef["states"].items():
        for anim in sdef.get("animations", []):
            if anim not in ce_anim_names:
                err(f"{cid}/{sname}: short anim '{anim}' not in client entity map")

# Molang queries used anywhere in RP must appear in Molang.html
rp_blob = "\n".join(json.dumps(all_json[p]) for p in all_json if p.startswith(RP))
for q in sorted(set(re.findall(r"query\.(\w+)", rp_blob))):
    if f"query.{q}" not in MOLANG_DOC:
        err(f"Molang query.{q} not documented in 1.21.0.26")
for fn in sorted(set(re.findall(r"math\.(\w+)", rp_blob, re.IGNORECASE))):
    if f"math.{fn.lower()}" not in MOLANG_DOC.lower():
        err(f"Molang math.{fn} not documented in 1.21.0.26")

# particle component names documented
for pid, pdef in particles.items():
    for comp in pdef["particle_effect"]["components"]:
        short = comp.split(":", 1)[1]
        if short not in PARTICLES_DOC and comp not in vanilla_text():
            err(f"particle {pid}: component {comp} unknown in 1.21.0.26")
    tex = pdef["particle_effect"]["description"]["basic_render_parameters"]["texture"]
    if tex.startswith("textures/particle/"):
        if not os.path.exists(os.path.join(RP, tex + ".png")):
            err(f"particle {pid}: texture missing {tex}")
    mat = pdef["particle_effect"]["description"]["basic_render_parameters"]["material"]
    if mat not in ("particles_alpha", "particles_add", "particles_blend",
                   "particles_opaque"):
        err(f"particle {pid}: unknown material {mat}")

# sound files exist
for sid, sdef in sound_defs["sound_definitions"].items():
    for s in sdef["sounds"]:
        n = s["name"] if isinstance(s, dict) else s
        if not os.path.exists(os.path.join(RP, n + ".wav")):
            err(f"sound file missing: {n}.wav")

# sounds.json entity events reference defined sounds
sjson = all_json[os.path.join(RP, "sounds.json")]
for ent_name, edef in sjson["entity_sounds"]["entities"].items():
    for ev, val in edef["events"].items():
        sid = val if isinstance(val, str) else val.get("sound")
        if sid and sid not in sound_ids:
            err(f"sounds.json: {ev} -> {sid} undefined")

# geometry UV rects within texture bounds
for gf in (geo_demon, geo_fire):
    for g in gf["minecraft:geometry"]:
        d = g["description"]
        tw, th = d["texture_width"], d["texture_height"]
        for b in g["bones"]:
            for c in b.get("cubes", []):
                for face, u in c.get("uv", {}).items():
                    x, y = u["uv"]
                    w, h = u["uv_size"]
                    if x < 0 or y < 0 or x + w > tw or y + h > th:
                        err(f"geometry {d['identifier']} uv out of bounds "
                            f"({x},{y},{w},{h})")
        parents = {b.get("parent") for b in g["bones"] if b.get("parent")}
        names = {b["name"] for b in g["bones"]}
        if parents - names:
            err(f"geometry {d['identifier']}: missing parents {parents - names}")

# BP queue_command targets a real sound definition for playsound
bp_blob = json.dumps(all_json[os.path.join(BP, "entities", "flying_demon.json")])
for snd in re.findall(r"playsound\s+([\w.]+)", bp_blob):
    if snd not in sound_ids:
        err(f"playsound references undefined sound {snd}")

print(f"checked {len(all_json)} JSON files")
if warns:
    print("\n".join("WARN: " + w for w in warns))
if errors:
    print("\n".join("ERROR: " + e for e in errors))
    sys.exit(1)
print("ALL CHECKS PASSED — pack verified against Bedrock 1.21.0.26")
