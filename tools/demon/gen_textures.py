"""Paint every texture for the Flying Demon add-on procedurally."""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spec  # noqa: E402
from png import Image, mix, shade  # noqa: E402

RP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..",
                  "resource_packs", "flying_demon_rp")
BP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..",
                  "behavior_packs", "flying_demon_bp")

# palette
HIDE = (27, 25, 31, 255)
HIDE_RED = (46, 20, 24, 255)
HIDE_DARK = (17, 15, 20, 255)
BELLY_A = (87, 26, 28, 255)
BELLY_B = (58, 17, 22, 255)
BONE_D = (74, 67, 65, 255)
BONE_L = (216, 204, 180, 255)
MEM_IN = (85, 19, 23, 255)
MEM_OUT = (44, 9, 12, 255)
VEIN = (124, 42, 32, 255)
VEIN_RAGE = (255, 96, 40, 255)
TOOTH = (239, 232, 214, 255)
MOUTH_A = (52, 6, 8, 255)
MOUTH_B = (74, 13, 16, 255)
CLAW = (222, 210, 186, 255)
EYE_CORE = (255, 215, 94, 255)
EYE_MID = (255, 139, 31, 255)
EYE_RIM = (179, 63, 14, 255)
EYE_CORE_R = (255, 248, 232, 255)
EYE_MID_R = (255, 90, 36, 255)
EYE_RIM_R = (255, 32, 0, 255)
CRACK = (255, 90, 26, 255)
CRACK_CORE = (255, 215, 94, 255)
CLEAR = (0, 0, 0, 0)


def _rng(cid, face):
    return random.Random(f"{cid}:{face}")


def paint_hide(img, x, y, w, h, face, rage, rng, cid):
    for j in range(h):
        for i in range(w):
            c = HIDE
            r = rng.random()
            if r < 0.10:
                c = HIDE_RED
            elif r < 0.30:
                c = HIDE_DARK
            n = 0.88 + rng.random() * 0.24
            if face == "up":
                n *= 1.18
            elif face == "down":
                n *= 0.72
            else:
                # darker toward the bottom of side faces
                n *= 1.06 - 0.18 * (j / max(1, h - 1))
            img.set_raw(x + i, y + j, shade(c, n))
    # sparse scale glints
    for _ in range(max(1, w * h // 14)):
        i, j = rng.randrange(w), rng.randrange(h)
        img.set_raw(x + i, y + j, shade(HIDE, 1.45))
    if rage and w >= 4 and h >= 4:
        # glowing cracks: short random walks
        for _ in range(max(1, w * h // 30)):
            ci, cj = rng.randrange(w), rng.randrange(h)
            for step in range(rng.randrange(3, 7)):
                img.set_raw(x + ci, y + cj, CRACK if step % 2 else CRACK_CORE)
                ci = max(0, min(w - 1, ci + rng.choice((-1, 0, 1))))
                cj = max(0, min(h - 1, cj + rng.choice((-1, 0, 1))))


def paint_belly(img, x, y, w, h, face, rage, rng, cid):
    for j in range(h):
        band = (j // 2) % 2 == 0
        seam = j % 4 == 3
        for i in range(w):
            c = BELLY_A if band else BELLY_B
            if seam:
                c = shade(c, 0.55)
            n = 0.9 + rng.random() * 0.2
            if rage and not seam and abs(i - w / 2) < w * 0.28:
                c = mix(c, CRACK, 0.45)
            img.set_raw(x + i, y + j, shade(c, n))


def paint_spike(img, x, y, w, h, face, rage, rng, cid):
    for j in range(h):
        t = j / max(1, h - 1)  # 0 top -> 1 bottom
        base = mix(BONE_L, BONE_D, t)  # light tip on top
        for i in range(w):
            img.set_raw(x + i, y + j, shade(base, 0.9 + rng.random() * 0.2))


def paint_horn(img, x, y, w, h, face, rage, rng, cid):
    for j in range(h):
        t = j / max(1, h - 1)
        base = mix(BONE_L, BONE_D, t * 0.9)
        ring = j % 3 == 2
        for i in range(w):
            c = shade(base, 0.72) if ring else base
            img.set_raw(x + i, y + j, shade(c, 0.92 + rng.random() * 0.16))


def paint_claw(img, x, y, w, h, face, rage, rng, cid):
    for j in range(h):
        t = j / max(1, h - 1)
        base = mix(BONE_D, CLAW, t)  # dark at knuckle, light at point
        for i in range(w):
            img.set_raw(x + i, y + j, shade(base, 0.9 + rng.random() * 0.2))


def paint_membrane(img, x, y, w, h, face, rage, rng, cid):
    if face in ("up", "down"):
        # large faces: u runs along the wing, v toward the trailing edge
        for j in range(h):
            t = j / max(1, h - 1)
            for i in range(w):
                c = mix(MEM_IN, MEM_OUT, t)
                img.set_raw(x + i, y + j, shade(c, 0.88 + rng.random() * 0.22))
        # veins fanning from the leading-inner corner
        vein = VEIN_RAGE if rage else VEIN
        for v in range(3 + w // 6):
            ang = (v + 0.5) / (3 + w // 6) * (math.pi / 2.2) + 0.12
            for r in range(max(w, h) * 2):
                px = int(r * math.cos(ang) * 0.62)
                py = int(r * math.sin(ang) * 0.62)
                if px >= w or py >= h:
                    break
                if (px + py) % 2 == 0:
                    img.set_raw(x + px, y + py, vein)
        # torn trailing edge
        for i in range(w):
            bite = rng.randrange(4) == 0
            depth = rng.randrange(1, 4) if bite else (1 if rng.random() < 0.55 else 0)
            for d in range(depth):
                img.set_raw(x + i, y + h - 1 - d, CLEAR)
        # a couple of holes
        for _ in range(max(1, w // 8)):
            hi, hj = rng.randrange(w), rng.randrange(int(h * 0.55), h)
            img.set_raw(x + hi, y + hj, CLEAR)
    else:
        for j in range(h):
            for i in range(w):
                img.set_raw(x + i, y + j, shade(MEM_IN, 0.8 + rng.random() * 0.2))


def paint_teeth(img, x, y, w, h, face, rage, rng, cid):
    up_row = "up" in cid  # teeth_up points DOWN, teeth_low points UP
    if face in ("up", "down"):
        for j in range(h):
            for i in range(w):
                img.set_raw(x + i, y + j, MOUTH_B)
        return
    # transparent background with triangular fangs
    for j in range(h):
        for i in range(w):
            img.set_raw(x + i, y + j, CLEAR)
    period = 3
    for i in range(w):
        phase = i % period
        length = h if phase == 1 else max(1, h - 1)
        for j in range(length):
            jj = j if up_row else h - 1 - j
            c = TOOTH if j < length - 1 else shade(TOOTH, 0.75)
            img.set_raw(x + i, y + jj, c)


def paint_mouth(img, x, y, w, h, face, rage, rng, cid):
    for j in range(h):
        for i in range(w):
            c = MOUTH_B if rng.random() < 0.4 else MOUTH_A
            img.set_raw(x + i, y + j, shade(c, 0.85 + rng.random() * 0.3))


def paint_eye(img, x, y, w, h, face, rage, rng, cid):
    core = EYE_CORE_R if rage else EYE_CORE
    midc = EYE_MID_R if rage else EYE_MID
    rim = EYE_RIM_R if rage else EYE_RIM
    cx, cy = (w - 1) / 2, (h - 1) / 2
    maxd = max(1.0, math.hypot(cx, cy))
    for j in range(h):
        for i in range(w):
            d = math.hypot(i - cx, j - cy) / maxd
            if d < 0.4:
                c = core
            elif d < 0.8:
                c = midc
            else:
                c = rim
            img.set_raw(x + i, y + j, c)
    # vertical slit pupil on the front face when calm
    if not rage and face == "north" and w >= 3:
        for j in range(h):
            img.set_raw(x + w // 2, y + j, (30, 8, 4, 255))


def paint_spade(img, x, y, w, h, face, rage, rng, cid):
    if face in ("up", "down"):
        # arrowhead: widest near the tail, point at far z (bottom rows)
        for j in range(h):
            t = j / max(1, h - 1)
            half = (w / 2) * (1.0 - 0.85 * t) + (w * 0.5 * 0.5 if t < 0.25 else 0)
            half = min(half, w / 2)
            for i in range(w):
                dx = abs(i - (w - 1) / 2)
                if dx <= half:
                    c = mix(MEM_IN, MEM_OUT, t * 0.8)
                    if rage and dx < 1.2:
                        c = mix(c, VEIN_RAGE, 0.6)
                    img.set_raw(x + i, y + j, shade(c, 0.9 + rng.random() * 0.2))
                else:
                    img.set_raw(x + i, y + j, CLEAR)
        # tip pixel column always solid
        img.set_raw(x + w // 2, y + h - 1, shade(MEM_OUT, 0.9))
    else:
        for j in range(h):
            for i in range(w):
                img.set_raw(x + i, y + j, shade(MEM_OUT, 0.9))


PAINTERS = {
    "hide": paint_hide,
    "belly": paint_belly,
    "spike": paint_spike,
    "horn": paint_horn,
    "claw": paint_claw,
    "membrane": paint_membrane,
    "teeth": paint_teeth,
    "mouth": paint_mouth,
    "eye": paint_eye,
    "spade": paint_spade,
}


def paint_demon(rage):
    bones, cube_index, uv = spec.build_uv()
    img = Image(spec.TEX_W, spec.TEX_H)
    for cid, c in cube_index.items():
        if c["uv_ref"]:
            continue
        for face, (x, y, w, h) in uv[cid].items():
            rng = _rng(cid, face)
            PAINTERS[c["tag"]](img, x, y, w, h, face, rage, rng, cid)
    return img


def paint_fireball():
    img = Image(16, 16)
    rng = random.Random("fireball")
    for j in range(5):
        for i in range(5):
            t = math.hypot(i - 2, j - 2) / 2.9
            c = mix((255, 244, 200, 255), (255, 98, 20, 255), min(1, t))
            img.set_raw(i, j, shade(c, 0.9 + rng.random() * 0.2))
    for j in range(3):
        for i in range(3):
            img.set_raw(6 + i, j, (255, 252, 236, 255))
    return img


def paint_egg():
    img = Image(16, 16)
    rng = random.Random("egg")
    # egg silhouette
    for j in range(16):
        for i in range(16):
            dx = (i - 7.5) / 5.4
            dy = (j - 8.2) / 6.6
            r = dx * dx + dy * dy * (1.25 if j < 8 else 0.95)
            if r <= 1.0:
                base = (38, 20, 30, 255)
                if r > 0.72:
                    base = (24, 12, 20, 255)
                img.set_raw(i, j, shade(base, 0.9 + rng.random() * 0.2))
    # ember speckles
    for _ in range(9):
        i, j = rng.randrange(4, 12), rng.randrange(4, 13)
        if img.get(i, j)[3]:
            img.set_raw(i, j, (255, 74, 31, 255))
    # one glowing eye slit
    for i in range(5, 9):
        img.set_raw(i, 7, (255, 178, 32, 255))
    img.set_raw(9, 7, (255, 230, 120, 255))
    return img


def _disc(img, cx, cy, r, color, soft=0.0):
    for j in range(int(cy - r - 2), int(cy + r + 3)):
        for i in range(int(cx - r - 2), int(cx + r + 3)):
            d = math.hypot(i - cx, j - cy)
            if d <= r:
                img.set(i, j, color)
            elif soft > 0 and d <= r + soft:
                a = int(color[3] * (1 - (d - r) / soft))
                img.set(i, j, (color[0], color[1], color[2], a))


def paint_pack_icon():
    S = 256
    img = Image(S, S)
    rng = random.Random("icon")
    # background: dark radial with ember gradient at the bottom
    for j in range(S):
        for i in range(S):
            d = math.hypot(i - S / 2, j - S / 2) / (S * 0.72)
            base = mix((34, 16, 40, 255), (10, 6, 12, 255), min(1, d))
            glow = max(0.0, (j / S - 0.55)) * 0.9
            base = mix(base, (120, 30, 12, 255), min(0.75, glow))
            img.set_raw(i, j, base)
    # embers
    for _ in range(130):
        i, j = rng.randrange(S), rng.randrange(int(S * 0.35), S)
        c = (255, rng.randrange(60, 160), 20, rng.randrange(90, 220))
        img.set(i, j, c)
        if rng.random() < 0.4:
            img.set(i + 1, j, c)
    cx, cy = S / 2, S * 0.47
    # horns
    for side in (-1, 1):
        for t in range(100):
            tt = t / 99
            hx = cx + side * (58 + 46 * tt)
            hy = cy - 46 - 88 * tt + 46 * tt * tt
            r = 13 * (1 - tt) + 2.5
            _disc(img, hx, hy, r, (16, 12, 18, 255))
            _disc(img, hx, hy, max(1.0, r - 4), (58, 48, 46, 255))
    # skull
    _disc(img, cx, cy, 62, (22, 18, 26, 255))
    _disc(img, cx, cy + 30, 46, (22, 18, 26, 255))
    _disc(img, cx, cy - 8, 56, (34, 28, 38, 255))
    # jaw shadow
    img.rect(int(cx - 40), int(cy + 44), 80, 26, (12, 8, 12, 255))
    # teeth
    for k in range(-4, 5):
        tx = cx + k * 9
        for j in range(16):
            wj = max(1, 3 - j // 4)
            for i in range(-wj, wj + 1):
                img.set(int(tx + i), int(cy + 44 + j), (226, 216, 194, 255))
    # eyes
    for side in (-1, 1):
        ex, ey = cx + side * 27, cy - 4
        _disc(img, ex, ey, 15, (255, 46, 8, 190), soft=13)
        _disc(img, ex, ey, 10, (255, 120, 24, 255), soft=5)
        _disc(img, ex, ey, 4.6, (255, 236, 170, 255), soft=3)
    # nostrils
    for side in (-1, 1):
        _disc(img, cx + side * 10, cy + 32, 4, (10, 6, 10, 255))
    return img


def particle_textures():
    out = {}
    ember = Image(8, 8)
    for j in range(8):
        for i in range(8):
            d = math.hypot(i - 3.5, j - 3.5) / 4.0
            if d < 1:
                c = mix((255, 240, 180, 255), (255, 90, 20, 0), d)
                ember.set_raw(i, j, c)
    out["fdc_ember"] = ember

    smoke = Image(16, 16)
    rng = random.Random("smoke")
    for j in range(16):
        for i in range(16):
            d = math.hypot(i - 7.5, j - 7.5) / 8.5
            if d < 1:
                a = int(170 * (1 - d) * (0.7 + rng.random() * 0.3))
                g = rng.randrange(26, 44)
                smoke.set_raw(i, j, (g, g - 4, g + 2, a))
    out["fdc_smoke"] = smoke

    flame = Image(16, 16)
    for j in range(16):
        for i in range(16):
            dx = (i - 7.5) / (3.4 + 3.6 * (j / 15))
            dy = (j - 3.0) / 11.5
            r = dx * dx + max(0, dy) * 1.15 + max(0, -dy) * 3.2
            if r <= 1.0:
                c = mix((255, 250, 210, 255), (255, 70, 10, 40), min(1, r))
                flame.set_raw(i, j, c)
    out["fdc_flame"] = flame

    gore = Image(8, 8)
    rng = random.Random("gore")
    for _ in range(15):
        i, j = rng.randrange(1, 7), rng.randrange(1, 7)
        c = (rng.randrange(120, 190), rng.randrange(10, 30), rng.randrange(10, 26), 255)
        gore.set_raw(i, j, c)
        if rng.random() < 0.5:
            gore.set_raw(i + 1, j, shade(c, 0.7))
    out["fdc_gore"] = gore

    flare = Image(16, 16)
    for j in range(16):
        for i in range(16):
            dx, dy = abs(i - 7.5), abs(j - 7.5)
            star = min(dx, dy) + 0.28 * max(dx, dy)
            d = math.hypot(dx, dy) / 9.5
            if star < 2.2 or d < 0.3:
                flare.set_raw(i, j, mix((255, 252, 240, 255), (255, 60, 20, 0), min(1, d * 1.4)))
            elif d < 1:
                flare.set(i, j, (255, 84, 30, int(70 * (1 - d))))
    out["fdc_flare"] = flare
    return out


def main():
    ent = os.path.join(RP, "textures", "entity")
    items = os.path.join(RP, "textures", "items")
    part = os.path.join(RP, "textures", "particle")
    os.makedirs(ent, exist_ok=True)
    os.makedirs(items, exist_ok=True)
    os.makedirs(part, exist_ok=True)

    paint_demon(rage=False).save(os.path.join(ent, "flying_demon.png"))
    paint_demon(rage=True).save(os.path.join(ent, "flying_demon_rage.png"))
    paint_fireball().save(os.path.join(ent, "demon_fire.png"))
    paint_egg().save(os.path.join(items, "fdc_demon_egg.png"))
    for name, img in particle_textures().items():
        img.save(os.path.join(part, name + ".png"))
    icon = paint_pack_icon()
    icon.save(os.path.join(RP, "pack_icon.png"))
    icon.save(os.path.join(BP, "pack_icon.png"))
    print("textures written")


if __name__ == "__main__":
    main()
