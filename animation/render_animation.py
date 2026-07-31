#!/usr/bin/env python3
"""Render an 8 second 1080x1920 @ 60fps pixel-art animation of the coral character.

Scene 1 (0-4s): the character dances.
Scene 2 (4-8s): a soda can slides in, the character pops it open and drinks.

The character sprite is the exact 12x8 cell grid sampled from the reference
image, drawn as axis-aligned blocks. Nothing is ever rotated, sheared or
resampled, so the pixel-art edges stay hard and the silhouette never changes --
motion comes from whole-sprite translation, uniform squash/stretch, and sliding
rigid parts (head band, arms, feet) against each other on the cell grid.
"""

import math
import os
import subprocess
from collections import deque

import numpy as np
from PIL import Image, ImageDraw

import imageio_ffmpeg

# ---------------------------------------------------------------- output setup

WIDTH, HEIGHT = 1080, 1920
FPS = 60
DURATION = 8.0
FRAMES = int(round(FPS * DURATION))
DT = 1.0 / FPS

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "character-dance-soda.mp4")

# ------------------------------------------------------------- character model

# Sampled straight from the reference image: 12 columns x 8 rows.
#   '#' coral body   'E' black eye   '.' empty
SPRITE = [
    "..########..",
    "..#E####E#..",
    "############",
    "############",
    "..########..",
    "..########..",
    "..#.#..#.#..",
    "..#.#..#.#..",
]
COLS, ROWS = 12, 8

CORAL = (242, 91, 69)
EYE = (13, 13, 13)

HEAD_ROWS = (0, 1)                # the band that carries the eyes
ARM_L_CELLS = {(r, c) for r in (2, 3) for c in (0, 1)}
ARM_R_CELLS = {(r, c) for r in (2, 3) for c in (10, 11)}
LEG_COLS = [2, 4, 7, 9]           # four feet, left pair then right pair
LEG_LOOKUP = {(r, c): i for i, c in enumerate(LEG_COLS) for r in (6, 7)}

# Where the can's opening meets the character while drinking, in cell space.
# The can is tipped right into the face, which means it passes over the right
# eye. These values are tuned (see the eye-coverage check in the commit notes)
# so that eye is either completely hidden or completely visible on every single
# frame -- a half-covered eye would read as a change to the design.
MOUTH_COL = 7.40
MOUTH_ROW = 2.00

BLOCK = 60.0                      # nominal cell size in canvas pixels
CENTER_X = WIDTH / 2.0
GROUND_Y = 1268.0                 # y of the soles when standing flat

# --------------------------------------------------------------- soda can art

CAN_UP = [
    ".TT.",     # pull tab
    "SSSS",     # rim
    "BBBB",
    "WWWW",     # label band
    "BBBB",
    "BBBB",
    "SSSS",     # base
]
CAN_LEN = len(CAN_UP)     # 7 cells along the can
CAN_WID = 4               # 4 cells across
CAN_BLOCK = 38.0
CAN_PALETTE = {
    "T": (198, 210, 220),
    "S": (176, 190, 202),
    "B": (44, 138, 224),
    "W": (245, 250, 255),
}


def tipped_can(rise):
    """The can laid over, opening at the lower left, base raised up to the right.

    `rise` is how many cells the can climbs per cell of length, so it doubles as
    the tilt angle: big values are nearly upright, small values nearly flat.
    Every cell stays an axis-aligned square, so the can never gets resampled.
    """
    offs = [int(math.floor((CAN_LEN - 1 - j) * rise + 0.5)) for j in range(CAN_LEN)]
    height = max(offs) + CAN_WID
    grid = []
    for r in range(height):
        line = ""
        for j in range(CAN_LEN):
            k = r - offs[j]
            line += CAN_UP[j][k] if 0 <= k < CAN_WID else "."
        grid.append(line)
    return grid, offs


def tipped_mouth(rise):
    """Cell-space (col, row) of the opening's centre in a `tipped_can` grid."""
    return 0.5, int(math.floor((CAN_LEN - 1) * rise + 0.5)) + CAN_WID / 2.0

# ------------------------------------------------------------------- utilities


def clamp(v, lo=0.0, hi=1.0):
    return lo if v < lo else (hi if v > hi else v)


def seg(t, t0, t1):
    """Normalised 0..1 progress of t through the window [t0, t1]."""
    if t1 <= t0:
        return 1.0 if t >= t1 else 0.0
    return clamp((t - t0) / (t1 - t0))


def lerp(a, b, t):
    return a + (b - a) * t


def smooth(t):
    t = clamp(t)
    return t * t * (3.0 - 2.0 * t)


def ease_out(t):
    return 1.0 - (1.0 - clamp(t)) ** 3


def ease_in(t):
    return clamp(t) ** 3


def back_out(t, k=1.9):
    """Overshoot-and-settle easing, for pops and landings."""
    t = clamp(t) - 1.0
    return t * t * ((k + 1.0) * t + k) + 1.0


def bump(t):
    """0 -> 1 -> 0 over t in [0, 1]."""
    return math.sin(math.pi * clamp(t))


# --------------------------------------------------------------- choreography

BEAT = 2.0          # 120 BPM
SPIN_T0, SPIN_T1 = 2.02, 2.70

CAN_IN_T0, CAN_IN_T1 = 4.05, 4.75     # can slides in from the right
GRAB_T0, GRAB_T1 = 4.75, 5.05         # hand closes on the can
POP_T = 5.20                          # tab pops
LIFT_T0, LIFT_T1 = 5.30, 5.75         # can travels up to the face
DRINK_T0, DRINK_T1 = 5.75, 6.95       # can tips, head goes back, four gulps
RECOVER_T0, RECOVER_T1 = 6.95, 7.20   # back upright
CHEER_T0, CHEER_T1 = 7.20, 7.70       # satisfied double bounce
CAN_OUT_T0, CAN_OUT_T1 = 7.68, 7.96   # can drifts off so the loop is clean

GULPS = 4
GULP_T0 = DRINK_T0 + 0.16
GULP_EVERY = 0.24


def drink_amount(t):
    """0..1 ramp of how tipped-back the drinking pose is."""
    return smooth(seg(t, DRINK_T0, DRINK_T0 + 0.20)) * (
        1.0 - smooth(seg(t, DRINK_T1 - 0.16, DRINK_T1))
    )


def gulp_pulse(t):
    g = 0.0
    for i in range(GULPS):
        g0 = GULP_T0 + i * GULP_EVERY
        g += bump(seg(t, g0, g0 + 0.18)) ** 2
    return g


def state_at(t):
    """Full pose for time t. Pure function -- ghost trails re-evaluate it."""
    s = {
        "bob": 0.0,        # px, positive lifts the character
        "sway": 0.0,       # px, whole-body horizontal translation
        "head_dx": 0.0,    # cells, slides the head band (rows 0-1) sideways
        "sq": 0.0,         # >0 stretches tall, <0 squashes wide
        "sx": 1.0,         # extra horizontal scale (spin)
        "arm_l": 0.0,      # cells, positive raises the arm
        "arm_r": 0.0,
        "arm_l_x": 0.0,    # cells, positive moves the arm outwards
        "arm_r_x": 0.0,
        "legs": [0.0, 0.0, 0.0, 0.0],
        "airborne": 0.0,   # 0..1, drives the contact shadow
        "spin": 0.0,
    }

    # ------------------------------------------------------------- scene 1
    if t < 4.0:
        ph = t * BEAT
        beat_i = int(ph)
        frac = ph - beat_i

        # Baseline groove: a two-per-beat bob with anticipation on the offbeat.
        s["bob"] = 16.0 * abs(math.sin(math.pi * ph)) - 4.0
        s["sq"] = -0.10 * max(0.0, math.cos(math.pi * ph)) + 0.06 * abs(
            math.sin(math.pi * ph)
        )
        # Feet keep time: the pair opposite the sway taps.
        tap = bump(frac) ** 2
        if beat_i % 2 == 0:
            s["legs"][2] = s["legs"][3] = 0.34 * tap
        else:
            s["legs"][0] = s["legs"][1] = 0.34 * tap

        # -- 0.00-1.02s: sway left and right, arms swinging in opposition
        if t < 1.02:
            k = smooth(seg(t, 0.0, 0.28))
            swing = math.sin(2.0 * math.pi * t * 0.5 * BEAT)
            s["sway"] = 62.0 * swing * k
            s["head_dx"] = 0.20 * swing * k
            s["arm_l"] = k * (0.62 + 0.52 * swing)
            s["arm_r"] = k * (0.62 - 0.52 * swing)

        # -- 1.02-2.02s: tiny hops with a quick arm wave at the top
        elif t < SPIN_T0:
            local = t - 1.02
            hop_i = int(local / 0.5)
            hf = (local / 0.5) - hop_i
            air = bump(hf) ** 1.35
            s["bob"] = 4.0 + 78.0 * air
            s["airborne"] = air
            s["sq"] = 0.16 * math.sin(math.pi * hf) - 0.22 * (1.0 - air) * bump(
                clamp(hf * 3.0)
            )
            s["sway"] = 26.0 * math.sin(2.0 * math.pi * local * 0.5) * 0.6
            s["arm_l"] = s["arm_r"] = 0.5 + 0.85 * air
            s["arm_l_x"] = s["arm_r_x"] = -0.10 * air
            tuck = 0.42 * air
            s["legs"] = [tuck, tuck * 0.7, tuck * 0.7, tuck]

        # -- 2.02-2.70s: one full spin
        elif t < SPIN_T1:
            p = seg(t, SPIN_T0, SPIN_T1)
            ang = 2.0 * math.pi * smooth(p)
            s["spin"] = 1.0
            s["sx"] = math.cos(ang)
            air = bump(p) ** 1.2
            s["bob"] = 4.0 + 62.0 * air
            s["airborne"] = air
            s["sq"] = 0.20 * air
            s["sway"] = 46.0 * math.sin(ang)
            s["arm_l"] = s["arm_r"] = 0.55 + 0.75 * air
            tuck = 0.38 * air
            s["legs"] = [tuck, tuck, tuck, tuck]

        # -- 2.70-4.00s: land, then the big finish
        else:
            land = seg(t, SPIN_T1, SPIN_T1 + 0.20)
            if land < 1.0:
                imp = 1.0 - land
                s["bob"] = -10.0 * imp
                s["sq"] = -0.30 * imp
                s["legs"] = [0.0, 0.0, 0.0, 0.0]
            else:
                local = t - (SPIN_T1 + 0.20)
                wave = math.sin(2.0 * math.pi * local * BEAT * 0.5)
                s["sway"] = 40.0 * wave
                s["head_dx"] = 0.16 * wave
                s["arm_l"] = 0.85 + 0.75 * math.sin(2.0 * math.pi * local * BEAT)
                s["arm_r"] = 0.85 - 0.75 * math.sin(2.0 * math.pi * local * BEAT)
                out = smooth(seg(t, 3.74, 4.0))
                for key in ("sway", "head_dx", "arm_l", "arm_r"):
                    s[key] *= 1.0 - out
        return s

    # ------------------------------------------------------------- scene 2
    idle = math.sin(2.0 * math.pi * (t - 4.0) * 1.0)
    s["bob"] = 5.0 * idle
    s["sq"] = 0.03 * idle

    # Notice the can arriving: lean and turn the head towards it.
    notice = bump(seg(t, CAN_IN_T0 + 0.10, GRAB_T1))
    s["sway"] += 18.0 * notice
    s["head_dx"] += 0.26 * notice

    # Reach out, then close the hand on the can.
    reach = smooth(seg(t, CAN_IN_T0 + 0.28, GRAB_T1))
    s["arm_r"] += 0.34 * reach
    s["arm_r_x"] += 0.30 * reach
    s["arm_l"] += 0.16 * reach

    # Pop: a sharp squash-and-stretch with the classic overshoot.
    pop = bump(seg(t, POP_T - 0.10, POP_T + 0.32)) ** 2
    s["sq"] += 0.30 * pop
    s["bob"] += 26.0 * pop
    s["arm_r"] += 0.40 * pop
    s["arm_l"] += 0.42 * pop

    # Lift: the arm swings up so the hand carries the can to face height.
    lift = smooth(seg(t, LIFT_T0, LIFT_T1))
    s["arm_r"] += 1.05 * lift
    s["arm_r_x"] += -0.26 * lift
    s["arm_l"] += 0.28 * lift

    # Drink: head tips back away from the can, weight shifts onto the back feet,
    # and each gulp is a visible squash.
    d = drink_amount(t)
    if d > 0.0:
        g = gulp_pulse(t)
        s["head_dx"] += -0.34 * d          # head band slides back = tilt back
        s["sway"] += -34.0 * d             # and the whole body leans back
        s["bob"] += 6.0 * d
        s["arm_r"] += -0.42 * d            # hand drops to cradle the can below
        s["sq"] += 0.10 * d - 0.12 * g     # taller while tipped, squash per gulp
        s["bob"] += -7.0 * g
        s["head_dx"] += -0.12 * g
        s["legs"] = [0.0, 0.0, 0.24 * d, 0.34 * d]   # front feet lift off

    # Come back upright, arm down.
    rec = smooth(seg(t, RECOVER_T0, RECOVER_T1))
    s["arm_r"] -= 1.39 * rec
    s["arm_r_x"] += 0.26 * rec
    s["arm_l"] -= 0.28 * rec

    # Satisfied double bounce, can still in hand.
    if t >= CHEER_T0:
        c = seg(t, CHEER_T0, CHEER_T1)
        hop = bump(clamp(c * 2.0)) ** 1.3 + bump(clamp(c * 2.0 - 1.0)) ** 1.3
        s["bob"] += 54.0 * hop
        s["airborne"] = max(s["airborne"], clamp(hop))
        s["sq"] += 0.15 * hop
        s["arm_l"] += 0.95 * hop
        s["arm_r"] += 0.40 * hop
        tuck = 0.34 * hop
        s["legs"] = [tuck, tuck * 0.7, tuck * 0.7, tuck]

    # Settle into exactly the opening pose so the clip loops.
    close = smooth(seg(t, CAN_OUT_T0, 8.0))
    if close > 0.0:
        rest = state_at(0.0)
        for key in ("bob", "sway", "head_dx", "sq", "arm_l", "arm_r",
                    "arm_l_x", "arm_r_x"):
            s[key] = lerp(s[key], rest[key], close)
        s["legs"] = [lerp(v, 0.0, close) for v in s["legs"]]
        s["airborne"] *= 1.0 - close

    return s


# ------------------------------------------------------------------- drawing


def block_size(s):
    bw = BLOCK * (1.0 - s["sq"] * 0.62)
    bh = BLOCK * (1.0 + s["sq"])
    return bw, bh


def cell_xy(s, row, col):
    """Canvas position of the top-left corner of cell (row, col) in pose s."""
    bw, bh = block_size(s)
    sx = s["sx"] if abs(s["sx"]) > 0.02 else 0.02
    x = CENTER_X + s["sway"] + (col - COLS / 2.0) * bw * sx
    y = GROUND_Y - s["bob"] - (ROWS - row) * bh
    return x, y


def character_rects(s):
    """Blocks for the character in pose `s`, as (body, right_arm).

    The right arm comes back separately so the render loop can draw the soda can
    between the two -- that reads as the hand gripping the can.
    """
    bw, bh = block_size(s)
    sx = s["sx"] if abs(s["sx"]) > 0.02 else (0.02 if s["sx"] >= 0 else -0.02)
    ox = CENTER_X + s["sway"]
    oy = GROUND_Y - s["bob"]

    arm_l = clamp(s["arm_l"], -0.5, 2.0)
    arm_r = clamp(s["arm_r"], -0.5, 2.0)

    body, eyes, arm = [], [], []
    for r in range(ROWS):
        for c in range(COLS):
            ch = SPRITE[r][c]
            if ch == ".":
                continue
            dr = dc = 0.0
            is_right_arm = (r, c) in ARM_R_CELLS
            if (r, c) in ARM_L_CELLS:
                dr, dc = -arm_l, -s["arm_l_x"]
            elif is_right_arm:
                dr, dc = -arm_r, s["arm_r_x"]
            elif (r, c) in LEG_LOOKUP:
                dr = -s["legs"][LEG_LOOKUP[(r, c)]]
            elif r in HEAD_ROWS:
                dc = s["head_dx"]

            rr, cc = r + dr, c + dc
            x0 = ox + (cc - COLS / 2.0) * bw * sx
            x1 = ox + (cc + 1.0 - COLS / 2.0) * bw * sx
            y0 = oy - (ROWS - rr) * bh
            y1 = oy - (ROWS - rr - 1.0) * bh
            if x1 < x0:
                x0, x1 = x1, x0
            rect = (int(round(x0)), int(round(y0)), int(round(x1)), int(round(y1)))
            if ch == "E":
                eyes.append(rect + (EYE,))
            else:
                # 1px bleed closes hairline seams between moving parts
                filled = (rect[0], rect[1], rect[2] + 1, rect[3] + 1, CORAL)
                (arm if is_right_arm else body).append(filled)
    return body + eyes, arm


def can_pose(t):
    """(art, x, y, opened, alpha, mouth_xy, fizz_xy) for the can, or None."""
    if t < CAN_IN_T0:
        return None

    s = state_at(t)
    bw, bh = block_size(s)
    alpha = 1.0
    d = drink_amount(t)

    if d > 0.02:
        # ---- drinking: the can is tipped up, opening locked to the mouth.
        # It starts steep and tips further over as the drink goes on.
        rise = lerp(1.0, 0.45, smooth(seg(t, DRINK_T0, DRINK_T0 + 0.45)))
        art, _ = tipped_can(rise)
        mcol, mrow = tipped_mouth(rise)
        # The opening rests *on the face* -- just below eye level and hard up
        # against the right eye's outer edge (column 9), so it never covers an
        # eye -- and it rides the head band as the head tilts back. Each gulp
        # presses the can a little further in.
        g = gulp_pulse(t)
        mx, my = cell_xy(s, MOUTH_ROW, MOUTH_COL + s["head_dx"])
        mx -= 7.0 * g
        my += 4.0 * g
        x = mx - mcol * CAN_BLOCK
        y = my - mrow * CAN_BLOCK
        fizz = (x + len(art[0]) * CAN_BLOCK * 0.72, y + CAN_BLOCK * 0.4)
        return art, x, y, True, alpha, (mx, my), fizz

    # ---- everything else: the can stands upright
    art = CAN_UP
    arm_r = clamp(s["arm_r"], -0.5, 2.0)
    hand_x, hand_y = cell_xy(s, 3.0 - arm_r, 11.0 + s["arm_r_x"])
    hand_x += bw * 0.5

    rest_x = CENTER_X + 5.9 * BLOCK
    rest_y = GROUND_Y - 2.4 * BLOCK
    p = seg(t, CAN_IN_T0, CAN_IN_T1)
    x = lerp(WIDTH + 160.0, rest_x, back_out(p, 1.25))
    y = rest_y

    g = smooth(seg(t, GRAB_T0, GRAB_T1))
    x = lerp(x, hand_x, g)
    y = lerp(y, hand_y + bh * 0.55, g)

    # While the arm lifts, the can also swings in towards the face so that the
    # moment it tips over there is no jump in position.
    lift_amt = smooth(seg(t, LIFT_T0, LIFT_T1)) * (
        1.0 - smooth(seg(t, RECOVER_T0, RECOVER_T1))
    )
    x -= 1.05 * BLOCK * lift_amt
    y -= 0.30 * BLOCK * lift_amt

    if t >= CAN_OUT_T0:
        o = ease_in(seg(t, CAN_OUT_T0, CAN_OUT_T1))
        x += 430.0 * o
        y -= 40.0 * o
        alpha = 1.0 - smooth(seg(t, CAN_OUT_T0 + 0.08, CAN_OUT_T1))

    # (x, y) is the sprite's top-left; the opening is the middle of the top row.
    x -= CAN_WID / 2.0 * CAN_BLOCK
    y -= CAN_LEN * CAN_BLOCK
    mouth = (x + CAN_WID / 2.0 * CAN_BLOCK, y)
    return art, x, y, t >= POP_T, alpha, mouth, mouth


def can_rects(art, x, y, opened):
    """Blocks for the can. (x, y) is the top-left of the sprite."""
    rects = []
    for r, line in enumerate(art):
        for c, ch in enumerate(line):
            if ch == "." or (opened and ch == "T"):
                continue
            x0 = x + c * CAN_BLOCK
            y0 = y + r * CAN_BLOCK
            rects.append((
                int(round(x0)), int(round(y0)),
                int(round(x0 + CAN_BLOCK)) + 1, int(round(y0 + CAN_BLOCK)) + 1,
                CAN_PALETTE[ch],
            ))
    return rects


def make_background():
    """Soft warm gradient + a gentle radial key light behind the character."""
    yy = np.linspace(0.0, 1.0, HEIGHT)[:, None]
    top = np.array([255.0, 250.0, 246.0])
    bottom = np.array([243.0, 228.0, 222.0])
    bg = np.repeat((top + (bottom - top) * (yy ** 1.15))[:, None, :], WIDTH, axis=1)

    gx = (np.arange(WIDTH)[None, :] - CENTER_X) / (WIDTH * 0.62)
    gy = (np.arange(HEIGHT)[:, None] - (GROUND_Y - 230.0)) / (HEIGHT * 0.42)
    bg = bg + np.exp(-(gx ** 2 + gy ** 2) * 2.1)[:, :, None] * np.array([14.0, 12.0, 10.0])
    return np.clip(bg, 0, 255).astype(np.uint8)


BACKGROUND = make_background()


# ------------------------------------------------------------------ particles


class Particles:
    """Bubbles, sparkles and droplets, all drawn as squares to stay on-style."""

    def __init__(self, seed=7):
        self.rng = np.random.default_rng(seed)
        self.items = []

    def spawn(self, x, y, kind, n=1, arc=(-2.7, -0.4)):
        r = self.rng
        for _ in range(n):
            if kind == "bubble":
                self.items.append(dict(
                    x=x + float(r.uniform(-26, 26)), y=y + float(r.uniform(-14, 14)),
                    vx=float(r.uniform(-22, 22)), vy=float(r.uniform(-200, -110)),
                    life=float(r.uniform(0.55, 1.00)), age=0.0,
                    size=float(r.choice([8, 10, 12, 14])), col=(255, 255, 255),
                    grav=-40.0))
            elif kind == "sparkle":
                ang = float(r.uniform(0, 2 * math.pi))
                spd = float(r.uniform(180, 520))
                self.items.append(dict(
                    x=x, y=y, vx=math.cos(ang) * spd, vy=math.sin(ang) * spd - 90.0,
                    life=float(r.uniform(0.30, 0.62)), age=0.0,
                    size=float(r.choice([10, 12, 16])), col=(255, 226, 140),
                    grav=520.0))
            else:  # droplet
                ang = float(r.uniform(*arc))
                spd = float(r.uniform(150, 380))
                self.items.append(dict(
                    x=x + float(r.uniform(-16, 16)), y=y,
                    vx=math.cos(ang) * spd, vy=math.sin(ang) * spd,
                    life=float(r.uniform(0.40, 0.75)), age=0.0,
                    size=float(r.choice([8, 10, 12])), col=(150, 210, 255),
                    grav=900.0))

    def step(self, dt):
        alive = []
        for p in self.items:
            p["age"] += dt
            if p["age"] >= p["life"]:
                continue
            p["x"] += p["vx"] * dt
            p["y"] += p["vy"] * dt
            p["vy"] += p["grav"] * dt
            p["vx"] *= 0.985
            alive.append(p)
        self.items = alive

    def draw(self, d):
        for p in self.items:
            k = 1.0 - (p["age"] / p["life"])
            a = int(255 * clamp(k ** 0.7))
            sz = max(2.0, p["size"] * (0.45 + 0.55 * k))
            x0 = int(round(p["x"] - sz / 2))
            y0 = int(round(p["y"] - sz / 2))
            d.rectangle([x0, y0, x0 + int(sz), y0 + int(sz)], fill=p["col"] + (a,))


# --------------------------------------------------------------- render loop


def main():
    cmd = [
        imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24",
        "-s", f"{WIDTH}x{HEIGHT}", "-r", str(FPS), "-i", "pipe:0",
        "-c:v", "libx264", "-preset", "slow", "-crf", "16",
        "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.2",
        "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
        "-movflags", "+faststart", OUT,
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)

    particles = Particles()
    rng = np.random.default_rng(21)
    ghosts = deque(maxlen=4)
    tab = None

    for i in range(FRAMES):
        t = i * DT
        s = state_at(t)

        frame = Image.fromarray(BACKGROUND.copy(), "RGB").convert("RGBA")
        over = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
        od = ImageDraw.Draw(over)

        # ---- contact shadow, squashing with the bounce
        lift = clamp(s["bob"] / 90.0)
        sw = (5.6 * BLOCK) * (1.0 - 0.34 * lift) * max(0.18, abs(s["sx"]))
        sh = 46.0 * (1.0 - 0.30 * lift)
        sa = int(46 * (1.0 - 0.55 * lift))
        cx = CENTER_X + s["sway"] * 0.55
        for k in range(4):  # cheap soft edge
            f = 1.0 + k * 0.22
            od.ellipse([cx - sw / 2 * f, GROUND_Y + 6 - sh / 2 * f,
                        cx + sw / 2 * f, GROUND_Y + 6 + sh / 2 * f],
                       fill=(150, 96, 84, max(4, sa // (k + 2))))

        # ---- spin motion trail
        if s["spin"] > 0.0 and ghosts:
            for k, past in enumerate(reversed(ghosts)):
                a = int(40 * (1.0 - k / len(ghosts)) * s["spin"])
                if a <= 2:
                    continue
                for (x0, y0, x1, y1, col) in past:
                    od.rectangle([x0, y0, x1, y1], fill=col + (a,))

        body, right_arm = character_rects(s)
        ghosts.append(body + right_arm)
        for (x0, y0, x1, y1, col) in body + right_arm:
            od.rectangle([x0, y0, x1, y1], fill=col + (255,))

        # ---- can sits in front, cradled by the arm just below it
        cp = can_pose(t)
        if cp is not None:
            art, cxx, cyy, opened, calpha, (mx, my), (fx, fy) = cp
            ca = int(255 * clamp(calpha))
            if ca > 0:
                for (x0, y0, x1, y1, col) in can_rects(art, cxx, cyy, opened):
                    od.rectangle([x0, y0, x1, y1], fill=col + (ca,))


            if abs(t - POP_T) < DT:
                particles.spawn(mx, my, "sparkle", 28)
                particles.spawn(mx, my, "droplet", 12)
                tab = dict(x=mx, y=my, vx=330.0, vy=-540.0, age=0.0)
            # fizz rises off the can, never over the face
            if opened and t < CAN_OUT_T0 and i % 3 == 0:
                particles.spawn(fx, fy, "bubble", 1)
            # a droplet flicks out of the mouth on every gulp, always thrown
            # to the right so nothing ever lands on the face
            for gi in range(GULPS):
                if abs(t - (GULP_T0 + gi * GULP_EVERY + 0.09)) < DT:
                    particles.spawn(mx + 34.0, my + 30.0, "droplet", 5,
                                    arc=(-1.15, 0.25))

        # ---- satisfied sparkles, kept above the head so the face stays clean
        if CHEER_T0 <= t <= CHEER_T1 and i % 5 == 0:
            _, hy = cell_xy(s, 0.0, 6.0)
            jitter = float(rng.uniform(-230, 230))
            particles.spawn(CENTER_X + s["sway"] + jitter, hy - 80.0, "sparkle", 2)

        # ---- the popped tab flying off
        if tab is not None:
            tab["age"] += DT
            tab["x"] += tab["vx"] * DT
            tab["y"] += tab["vy"] * DT
            tab["vy"] += 1500.0 * DT
            if tab["age"] < 1.4:
                od.rectangle([int(tab["x"]), int(tab["y"]),
                              int(tab["x"]) + 16, int(tab["y"]) + 16],
                             fill=CAN_PALETTE["T"] + (235,))
            else:
                tab = None

        particles.step(DT)
        particles.draw(od)

        proc.stdin.write(Image.alpha_composite(frame, over).convert("RGB").tobytes())

    proc.stdin.close()
    if proc.wait() != 0:
        raise SystemExit("ffmpeg failed")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
