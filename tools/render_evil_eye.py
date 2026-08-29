#!/usr/bin/env python3
"""
"THE AWAKENING" - procedural render of an eye opening in the dark.

No source photography and no generative model: every pixel is shaded from an
analytic model of the eye (sclera sphere + iris stroma + cornea + lids), lit in
linear light and tone-mapped with a filmic curve at the end.

    python3 render_evil_eye.py --preview 3.2     # single frame, quick look
    python3 render_evil_eye.py                   # full frame sequence
"""

import argparse
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

# --------------------------------------------------------------------------
# configuration
# --------------------------------------------------------------------------
FPS = 30
DURATION = 7.0
OUT_W, OUT_H = 1920, 1080
SUPERSAMPLE = 2

ASPECT = OUT_W / OUT_H
TILT = math.radians(6.5)          # canthal tilt of the eye
EYE_SCALE = 0.88                  # scene units per half palpebral fissure
EYE_CX, EYE_CY = 0.0, -0.03

R_BALL = 0.93                     # eyeball radius, fissure-half-width units
R_IRIS = 0.452
CREASE_H = 0.62                   # lid crease sits still while the lid moves

LIGHT = np.array([-0.46, 0.58, 0.67], dtype=np.float32)
LIGHT /= np.linalg.norm(LIGHT)


def srgb_to_linear(c):
    return (np.asarray(c, dtype=np.float32) / 255.0) ** np.float32(2.2)


# palette (authored as sRGB bytes, used in linear)
C_SCLERA      = srgb_to_linear((186, 178, 168))
C_SCLERA_WARM = srgb_to_linear((196, 150, 138))
C_VEIN        = srgb_to_linear((162,  38,  36))
C_CARUNCLE    = srgb_to_linear((178,  96,  92))
C_IRIS_OUT    = srgb_to_linear((104,  50,  22))
C_IRIS_MID    = srgb_to_linear((198, 106,  26))
C_IRIS_IN     = srgb_to_linear((236, 150,  44))
C_EMBER       = srgb_to_linear((255, 106,  26))
C_LIMBUS      = srgb_to_linear(( 20,  11,   9))
C_SKIN        = srgb_to_linear((138, 104,  90))
C_SKIN_DEEP   = srgb_to_linear(( 96,  48,  42))
C_LASH        = srgb_to_linear((  9,   7,   7))
C_AMBIENT     = srgb_to_linear(( 52,  66,  92))   # cool skylight fill


# --------------------------------------------------------------------------
# small numeric helpers
# --------------------------------------------------------------------------
def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def keyframe(t, keys):
    """Smoothstep interpolation through (time, value) pairs."""
    if t <= keys[0][0]:
        return keys[0][1]
    for i in range(len(keys) - 1):
        t0, v0 = keys[i]
        t1, v1 = keys[i + 1]
        if t <= t1:
            f = (t - t0) / max(t1 - t0, 1e-6)
            f = f * f * (3.0 - 2.0 * f)
            return v0 + (v1 - v0) * f
    return keys[-1][1]


def _hash01(a, b, seed):
    a = (a & 0xFFFFFFFF).astype(np.uint32)
    b = (b & 0xFFFFFFFF).astype(np.uint32)
    n = a * np.uint32(1597334677) + b * np.uint32(3812015801)
    n = n + np.uint32((seed * 2654435761) & 0xFFFFFFFF)
    n ^= (n >> np.uint32(15))
    n *= np.uint32(2246822519)
    n ^= (n >> np.uint32(13))
    n *= np.uint32(3266489917)
    n ^= (n >> np.uint32(16))
    return (n >> np.uint32(8)).astype(np.float32) * np.float32(1.0 / 16777216.0)


def value_noise(u, v, seed=0, period=None):
    """Bilinear value noise; optionally periodic along u (for polar fields)."""
    iu = np.floor(u)
    iv = np.floor(v)
    fu = (u - iu).astype(np.float32)
    fv = (v - iv).astype(np.float32)
    fu = fu * fu * (3.0 - 2.0 * fu)
    fv = fv * fv * (3.0 - 2.0 * fv)
    iu = iu.astype(np.int64)
    iv = iv.astype(np.int64)
    iu1 = iu + 1
    if period:
        p = int(period)
        iu = iu % p
        iu1 = iu1 % p
    a = _hash01(iu, iv, seed)
    b = _hash01(iu1, iv, seed)
    c = _hash01(iu, iv + 1, seed)
    d = _hash01(iu1, iv + 1, seed)
    top = a + (b - a) * fu
    bot = c + (d - c) * fu
    return top + (bot - top) * fv


def fbm(u, v, octaves=4, seed=0, period=None, gain=0.5):
    total = None
    amp = 1.0
    norm = 0.0
    freq = 1.0
    per = period
    for o in range(octaves):
        layer = value_noise(u * freq, v * freq, seed + o * 131,
                            period=(int(round(per)) if per else None))
        total = layer * np.float32(amp) if total is None else total + layer * np.float32(amp)
        norm += amp
        amp *= gain
        freq *= 2.0
        if per:
            per *= 2.0
    return total * np.float32(1.0 / norm)


def box_blur(a, r, axis):
    if r < 1:
        return a
    pad = [(0, 0)] * a.ndim
    pad[axis] = (r + 1, r)
    ap = np.pad(a, pad, mode="edge")
    cs = np.cumsum(ap, axis=axis, dtype=np.float32)
    hi = [slice(None)] * a.ndim
    lo = [slice(None)] * a.ndim
    hi[axis] = slice(2 * r + 1, None)
    lo[axis] = slice(0, -(2 * r + 1))
    return (cs[tuple(hi)] - cs[tuple(lo)]) * np.float32(1.0 / (2 * r + 1))


def blur2d(a, r, passes=3):
    for _ in range(passes):
        a = box_blur(a, r, 0)
        a = box_blur(a, r, 1)
    return a


def aces(x):
    """Narkowicz ACES filmic tone-map approximation."""
    return np.clip((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0)


# --------------------------------------------------------------------------
# animation
# --------------------------------------------------------------------------
OPEN_KEYS = [
    (0.00, 0.000), (0.42, 0.000), (0.66, 0.058), (0.92, 0.044),
    (1.34, 0.250), (1.92, 0.395), (2.32, 0.428), (2.60, 0.372),
    (2.94, 0.980), (3.16, 1.105), (3.54, 0.982), (4.60, 1.000),
    (5.55, 1.048), (6.20, 1.002), (7.00, 1.008),
]
RAGE_KEYS = [
    (0.00, 0.000), (0.60, 0.020), (1.30, 0.055), (2.30, 0.130),
    (2.74, 0.300), (3.04, 1.000), (3.52, 0.720), (4.40, 0.870),
    (5.30, 0.780), (6.10, 1.000), (7.00, 0.950),
]
PUPIL_KEYS = [
    (0.00, 0.660), (2.40, 0.628), (2.80, 0.690), (3.04, 0.205),
    (3.30, 0.146), (3.72, 0.190), (4.60, 0.166), (5.60, 0.202),
    (6.25, 0.150), (7.00, 0.172),
]
SLIT_KEYS = [
    (0.00, 1.00), (2.92, 1.00), (3.34, 0.54), (4.50, 0.49), (7.00, 0.46),
]
GAZE_KEYS = [
    (0.00, 0.000), (4.42, 0.000), (4.58, -0.052), (4.74, -0.049),
    (4.90, 0.006), (5.05, 0.000), (7.00, 0.000),
]


def params(t):
    p = {}
    op = keyframe(t, OPEN_KEYS)
    rage = keyframe(t, RAGE_KEYS)
    if t > 3.0:
        rage += 0.055 * math.sin(2.0 * math.pi * 0.85 * (t - 3.0))
        rage += 0.028 * math.sin(2.0 * math.pi * 2.30 * (t - 3.0) + 1.1)
    p["open"] = max(op, 0.0)
    p["rage"] = float(np.clip(rage, 0.0, 1.25))
    p["pupil"] = keyframe(t, PUPIL_KEYS) * (1.0 - 0.05 * math.sin(2.0 * math.pi * 0.7 * t))
    p["slit"] = keyframe(t, SLIT_KEYS)
    p["gaze_x"] = keyframe(t, GAZE_KEYS) + 0.016 * math.sin(0.62 * t + 0.4)
    p["gaze_y"] = 0.010 * math.sin(0.47 * t + 2.1)
    p["zoom"] = keyframe(t, [(0.0, 0.895), (3.05, 0.985), (3.25, 1.012), (7.0, 1.115)])
    p["cam_x"] = 0.011 * math.sin(0.68 * t + 1.0) + 0.004 * math.sin(1.9 * t)
    p["cam_y"] = 0.009 * math.sin(0.51 * t) + 0.003 * math.sin(2.3 * t + 0.7)
    return p


# --------------------------------------------------------------------------
# lid geometry (eye space: u across the fissure, v vertical)
# --------------------------------------------------------------------------
def _soft_base(q, k=0.14):
    """C-infinity approximation of max(q, 0) - no derivative break at q = 0."""
    return 0.5 * (q + np.sqrt(q * q + k * k))


def lid_curves_soft(u, op):
    """Lid margins continued smoothly past the canthi, for skin shading only.

    lid_curves() pinches to a hard point at |u| = 1, which makes every field
    derived from it (crease distance, lid parameter) degenerate there and band
    across the frame. These stay smooth everywhere.
    """
    base = np.clip(1.0 - u * u, 0.0, 1.0)
    up_shift = u + np.float32(0.14) * base
    lo_shift = u - np.float32(0.20) * base
    bu = _soft_base(1.0 - up_shift * up_shift)
    bl = _soft_base(1.0 - lo_shift * lo_shift)
    amp_up = 0.006 + 0.530 * op
    amp_lo = 0.005 + 0.300 * op
    return (np.float32(amp_up) * bu ** np.float32(0.56),
            -np.float32(amp_lo) * bl ** np.float32(0.66))


def lid_curves(u, op):
    """Upper and lower lid margins as v(u). Corners pinch to a point."""
    base = np.clip(1.0 - u * u, 0.0, 1.0)
    up_shift = u + np.float32(0.14) * base          # peak of upper lid sits nasal
    lo_shift = u - np.float32(0.20) * base          # lower lid dips temporal
    bu = np.clip(1.0 - up_shift * up_shift, 0.0, 1.0)
    bl = np.clip(1.0 - lo_shift * lo_shift, 0.0, 1.0)
    amp_up = 0.006 + 0.530 * op
    amp_lo = 0.005 + 0.300 * op
    upper = np.float32(amp_up) * bu ** np.float32(0.56)
    lower = -np.float32(amp_lo) * bl ** np.float32(0.66)
    return upper, lower


def lid_curves_scalar(u, op):
    u = np.asarray(u, dtype=np.float32)
    return lid_curves(u, op)


def crease_curve(u):
    base = _soft_base(1.0 - (u * 0.94) ** 2)
    return np.float32(CREASE_H) * base ** np.float32(0.40) + np.float32(0.03)


# --------------------------------------------------------------------------
# lashes, drawn as vector geometry and composited as a mask
# --------------------------------------------------------------------------
def eye_to_pixel(u, v, P, W2, H2):
    ct, st = math.cos(TILT), math.sin(TILT)
    dx = (u * ct - v * st) * EYE_SCALE
    dy = (u * st + v * ct) * EYE_SCALE
    X = dx + EYE_CX
    Y = dy + EYE_CY
    sx = (X - P["cam_x"]) * P["zoom"]
    sy = (Y - P["cam_y"]) * P["zoom"]
    px = (sx / (2.0 * ASPECT) + 0.5) * W2
    py = (0.5 - sy * 0.5) * H2
    return px, py


def lash_mask(P, W2, H2, seed=7):
    """Upper and lower lashes: tapered polygons following the live lid margin."""
    img = Image.new("L", (W2, H2), 0)
    dr = ImageDraw.Draw(img)
    rng = np.random.default_rng(seed)
    op = P["open"]
    px_per_unit = (W2 / (2.0 * ASPECT)) * P["zoom"] * EYE_SCALE

    for side in ("upper", "lower"):
        n = 270 if side == "upper" else 165
        for i in range(n):
            s = (i + rng.uniform(0.12, 0.88)) / n
            u = -0.985 + 1.97 * s
            fan = math.sin(math.pi * min(max(s, 0.0), 1.0)) ** 0.55
            upper, lower = lid_curves_scalar(u, op)
            if side == "upper":
                v = float(upper) - 0.018
                length = (0.075 + 0.125 * fan) * rng.uniform(0.40, 1.55)
                a0 = math.radians(90.0 + 48.0 * (u * 0.92) + rng.uniform(-13, 13))
                curl = math.radians(rng.uniform(26, 70))
                width = px_per_unit * 0.0034 * rng.uniform(0.45, 1.30)
            else:
                v = float(lower) + 0.015
                length = (0.030 + 0.040 * fan) * rng.uniform(0.40, 1.20)
                a0 = math.radians(-90.0 + 42.0 * (u * 0.92) + rng.uniform(-15, 15))
                curl = -math.radians(rng.uniform(14, 44))
                width = px_per_unit * 0.0026 * rng.uniform(0.45, 1.15)
            if length <= 0.0 or width <= 0.15:
                continue

            steps = 13
            pts = []
            cu, cv = u, v
            for k in range(steps + 1):
                tt = k / steps
                pts.append((cu, cv))
                ang = a0 + curl * tt
                step = length / steps
                cu += math.cos(ang) * step
                cv += math.sin(ang) * step

            xs, ys = [], []
            for (uu, vv) in pts:
                x, y = eye_to_pixel(uu, vv, P, W2, H2)
                xs.append(x)
                ys.append(y)

            left, right = [], []
            for k in range(len(xs)):
                k0 = max(k - 1, 0)
                k1 = min(k + 1, len(xs) - 1)
                dx = xs[k1] - xs[k0]
                dy = ys[k1] - ys[k0]
                m = math.hypot(dx, dy) or 1.0
                nx, ny = -dy / m, dx / m
                w = width * (1.0 - k / len(xs)) ** 0.75
                left.append((xs[k] + nx * w, ys[k] + ny * w))
                right.append((xs[k] - nx * w, ys[k] - ny * w))
            poly = left + right[::-1]
            dr.polygon(poly, fill=int(250 if side == "upper" else 232))

    # a continuous dark margin the strands grow out of; without it the lashes
    # read as a loose fringe floating above the lid
    for side, off, wdt in (("upper", -0.013, 0.0072), ("lower", 0.011, 0.0042)):
        pts = []
        for i in range(97):
            uu = -0.995 + 1.99 * (i / 96.0)
            up, lo = lid_curves_scalar(uu, op)
            vv = (float(up) + off) if side == "upper" else (float(lo) + off)
            pts.append(eye_to_pixel(uu, vv, P, W2, H2))
        wpx = px_per_unit * wdt
        band = [(x, y - wpx) for (x, y) in pts] + [(x, y + wpx) for (x, y) in pts][::-1]
        dr.polygon(band, fill=int(255 if side == "upper" else 226))

    img = img.filter(ImageFilter.GaussianBlur(max(1.0, W2 / 1400.0)))
    return np.asarray(img, dtype=np.float32) / 255.0


# --------------------------------------------------------------------------
# the frame
# --------------------------------------------------------------------------
def render(t, w, h, ss):
    P = params(t)
    W2, H2 = w * ss, h * ss
    op, rage = P["open"], P["rage"]

    xs = ((np.arange(W2, dtype=np.float32) + 0.5) / W2 - 0.5) * (2.0 * ASPECT)
    ys = -(((np.arange(H2, dtype=np.float32) + 0.5) / H2 - 0.5) * 2.0)
    X = xs / P["zoom"] + P["cam_x"]
    Y = ys / P["zoom"] + P["cam_y"]

    ct, st = math.cos(TILT), math.sin(TILT)
    dx = X[None, :] - np.float32(EYE_CX)
    dy = Y[:, None] - np.float32(EYE_CY)
    u = (dx * ct + dy * st) * np.float32(1.0 / EYE_SCALE)
    v = (-dx * st + dy * ct) * np.float32(1.0 / EYE_SCALE)
    u = np.broadcast_to(u, (H2, W2)).astype(np.float32, copy=True)
    v = np.broadcast_to(v, (H2, W2)).astype(np.float32, copy=True)
    del dx, dy

    upper, lower = lid_curves(u, op)
    aa = np.float32(2.4 / (H2 * 0.5) / EYE_SCALE / P["zoom"])   # ~2px feather

    inside = (smoothstep(-aa, aa, upper - v)
              * smoothstep(-aa, aa, v - lower)
              * smoothstep(-aa, aa, np.float32(0.998) - np.abs(u)))

    # ---------------- skin & lids -------------------------------------
    tex_f = fbm(u * 34.0, v * 34.0, octaves=4, seed=11)
    tex_c = fbm(u * 5.5, v * 5.5, octaves=3, seed=57)
    pores = fbm(u * 130.0, v * 130.0, octaves=2, seed=203)

    crease = crease_curve(u)
    orb = smoothstep(1.78, 0.98, np.abs(u))   # orbital envelope: features fade out
    upper_s, lower_s = lid_curves_soft(u, op)
    d_up = v - upper_s                     # >0 on the upper lid
    d_lo = lower_s - v                     # >0 on the lower lid
    lid_t = np.clip(d_up / np.maximum(crease - upper_s, 1e-3), 0.0, 1.0)

    shade = np.full((H2, W2), 0.13, dtype=np.float32)
    on_up = smoothstep(-0.01, 0.025, d_up)
    on_lo = smoothstep(-0.01, 0.025, d_lo)
    # upper lid: rolls away from the light near the margin, peaks mid-lid,
    # then folds into the crease
    shade += 0.52 * np.exp(-((lid_t - 0.50) ** 2) / 0.115) * on_up * orb
    shade -= 0.16 * np.exp(-((lid_t - 0.98) ** 2) / 0.010) * on_up * orb
    # brow region above the crease falls into shadow
    shade -= 0.10 * smoothstep(0.0, 0.26, v - crease) * orb
    shade += 0.09 * np.exp(-((v - crease - 0.34) ** 2) / 0.040) * orb
    shade -= 0.13 * smoothstep(0.55, 1.15, v)
    # lower lid roll then tear trough
    shade += 0.38 * np.exp(-((d_lo - 0.090) ** 2) / 0.0090) * on_lo * orb
    shade -= 0.10 * smoothstep(0.16, 0.46, d_lo) * orb
    shade += 0.13 * np.exp(-((d_lo - 0.55) ** 2) / 0.055) * orb
    # fine skin relief
    shade *= (0.76 + 0.46 * tex_f)
    shade *= (0.87 + 0.26 * tex_c)
    shade *= (0.88 + 0.24 * pores)
    # creased skin lines parallel to the lid margin
    wrinkle = np.sin(lid_t * 17.0 + 3.4 * tex_c + 1.2 * u) * smoothstep(0.08, 0.55, lid_t)
    shade -= 0.070 * np.clip(wrinkle, 0.0, 1.0) * on_up * orb
    shade = np.clip(shade, 0.02, None)

    redness = (0.35 + 0.65 * tex_c)
    redness = redness * (1.0 + 2.4 * np.exp(-np.maximum(d_up, 0.0) / 0.045)
                         + 2.0 * np.exp(-np.maximum(d_lo, 0.0) / 0.040))
    redness = np.clip(redness * 0.42, 0.0, 1.0)

    skin = (C_SKIN[None, None, :] * (1.0 - redness)[..., None]
            + C_SKIN_DEEP[None, None, :] * redness[..., None])
    skin = skin * shade[..., None]
    del tex_f, pores, wrinkle, redness

    # the eye lights the face around it
    r_face = np.sqrt(u * u + (v * 1.30) ** 2)
    face_glow = np.exp(-np.maximum(r_face - 0.60, 0.0) / 0.165) * (0.25 + 0.75 * op)
    skin += (C_EMBER[None, None, :] * (face_glow * (0.05 + 0.34 * rage))[..., None])
    # light spills through the seam of the closed lids before it opens
    seam = np.exp(-((v - (upper + lower) * 0.5) ** 2) / 0.00035) \
        * smoothstep(1.02, 0.90, np.abs(u))
    skin += C_EMBER[None, None, :] * (seam * rage * 0.85 * (1.0 - smoothstep(0.02, 0.16, op)))[..., None]
    del seam, r_face, face_glow, crease, lid_t, shade, tex_c, orb, on_up, on_lo
    del upper_s, lower_s

    img = skin
    del skin

    # ---------------- eyeball ------------------------------------------
    rows = np.any(inside > 0.0015, axis=1)
    if rows.any():
        cols = np.any(inside > 0.0015, axis=0)
        y0 = max(int(np.argmax(rows)) - 6, 0)
        y1 = min(H2 - int(np.argmax(rows[::-1])) + 6, H2)
        x0 = max(int(np.argmax(cols)) - 6, 0)
        x1 = min(W2 - int(np.argmax(cols[::-1])) + 6, W2)
        sl = (slice(y0, y1), slice(x0, x1))
        su, sv = u[sl], v[sl]
        s_up, s_lo = upper[sl], lower[sl]

        gx = np.float32(P["gaze_x"])
        gy = np.float32(P["gaze_y"])
        bu = su - gx * 0.30
        bv = sv - gy * 0.30
        rb = np.sqrt(bu * bu + bv * bv) * np.float32(1.0 / R_BALL)
        nz = np.sqrt(np.clip(1.0 - rb * rb, 0.0, 1.0))
        nx = bu / R_BALL
        ny = bv / R_BALL

        scl_tex = fbm(bu * 30.0, bv * 30.0, octaves=3, seed=402)
        ndl = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]
        wrap = np.clip((ndl + 0.62) / 1.62, 0.0, 1.0)          # heavy subsurface
        diffuse = (0.16 + 0.62 * wrap * wrap) * (0.78 + 0.44 * scl_tex)

        # sclera vasculature: ridged noise, denser toward the canthi
        # Vessels are the iso-contours of a *single* noise octave - summing
        # octaves first (ridged fbm) smears them into marbling. Domain-warping
        # each octave keeps them wandering and branching.
        rad_b = np.sqrt(bu * bu + bv * bv)
        phi_b = np.arctan2(bv, bu * 0.70)
        warp = fbm(bu * 2.6, bv * 2.6, octaves=2, seed=505) - 0.5
        thick = 1.0 + 1.7 * rage
        veins = np.zeros_like(bu)
        for fr, fp, amp, wid, sd in ((5.5, 2.6, 1.00, 0.060, 91),
                                     (11.0, 5.1, 0.72, 0.042, 140),
                                     (23.0, 9.7, 0.44, 0.028, 311),
                                     (44.0, 18.0, 0.26, 0.020, 617),
                                     (7.6, 3.4, 0.55, 0.030, 733)):
            n = value_noise(rad_b * fr + warp * (fr * 0.30),
                            phi_b * fp + warp * 1.4, sd)
            hw = wid * thick
            veins += amp * smoothstep(1.0 - hw, 1.0, 1.0 - np.abs(n * 2.0 - 1.0))
        veins *= smoothstep(0.14, 0.86, np.abs(bu)) ** 1.15
        veins *= (0.30 + 0.95 * rage)
        veins = np.clip(veins, 0.0, 1.0)
        del warp, rad_b, phi_b
        del scl_tex

        warm = np.clip(smoothstep(0.30, 1.05, np.abs(bu)) * 0.85
                       + smoothstep(0.30, 0.75, np.abs(bv)) * 0.35, 0.0, 1.0)
        sclera = (C_SCLERA[None, None, :] * (1.0 - warm)[..., None]
                  + C_SCLERA_WARM[None, None, :] * warm[..., None])
        sclera = sclera * (1.0 - 0.70 * veins)[..., None] + C_VEIN[None, None, :] * (veins * 0.72)[..., None]
        sclera = sclera * diffuse[..., None]
        sclera += C_AMBIENT[None, None, :] * (0.13 * (1.0 - wrap) + 0.035)[..., None]
        del warm, veins

        # caruncle + canthal soft tissue at the inner corner
        car = np.exp(-(((su + 0.90) ** 2) * 62.0 + ((sv + 0.02) ** 2) * 150.0))
        sclera = sclera * (1.0 - car * 0.85)[..., None] + C_CARUNCLE[None, None, :] * (car * 0.85 * diffuse)[..., None]
        del car

        eye = sclera
        del sclera

        # ---------------- iris ------------------------------------------
        iu = su - gx
        iv = sv - gy
        ir = np.sqrt(iu * iu + iv * iv)
        in_iris = ir < (R_IRIS * 1.16)
        if in_iris.any():
            ry = np.any(in_iris, axis=1)
            rx = np.any(in_iris, axis=0)
            iy0 = int(np.argmax(ry)); iy1 = in_iris.shape[0] - int(np.argmax(ry[::-1]))
            ix0 = int(np.argmax(rx)); ix1 = in_iris.shape[1] - int(np.argmax(rx[::-1]))
            isl = (slice(iy0, iy1), slice(ix0, ix1))
            a = iu[isl]
            b = iv[isl]
            rr = ir[isl]
            th = np.arctan2(b, a)
            rn = rr * np.float32(1.0 / R_IRIS)

            ang = (th + np.float32(math.pi)) * np.float32(1.0 / (2.0 * math.pi))
            F = 84.0
            ang_w = ang + (fbm(ang * 7.0, rn * 2.0, octaves=2, seed=919, period=7.0) - 0.5) * 0.055
            fib = fbm(ang_w * F, rn * 2.6, octaves=5, seed=31, period=F, gain=0.55)
            fib2 = fbm(ang_w * (F * 2.0), rn * 5.5, octaves=3, seed=77, period=F * 2.0)
            crypt = fbm(ang * 27.0, rn * 5.0, octaves=3, seed=53, period=27.0)
            sector = fbm(ang * 6.0, rn * 1.3, octaves=3, seed=613, period=6.0)

            # radial colour ramp of the stroma
            k = np.clip(rn, 0.0, 1.0)
            m_out = smoothstep(0.60, 1.02, k)
            m_mid = smoothstep(0.05, 0.50, k) * (1.0 - m_out)
            col = (C_IRIS_IN[None, None, :] * (1.0 - smoothstep(0.05, 0.50, k))[..., None]
                   + C_IRIS_MID[None, None, :] * m_mid[..., None]
                   + C_IRIS_OUT[None, None, :] * m_out[..., None])
            del m_out, m_mid

            fiber_amp = 0.80 * (0.30 + 0.70 * smoothstep(0.10, 0.40, rn))
            tex = 1.0 + fiber_amp * (fib - 0.5) * 2.0 + 0.30 * (fib2 - 0.5)
            tex *= 0.84 + 0.34 * sector          # uneven pigment across sectors
            # collarette: the crimped ridge where the stroma changes character
            coll = np.exp(-((rn - 0.40) ** 2) / 0.0026)
            tex += 0.42 * coll * (0.5 + fib)
            # crypts: dark fenestrations just outside the collarette
            tex -= 0.80 * smoothstep(0.60, 0.86, crypt) * smoothstep(0.26, 0.48, rn) * (1.0 - smoothstep(0.78, 0.94, rn))
            tex -= 0.30 * smoothstep(0.72, 0.94, fib2) * smoothstep(0.45, 0.72, rn)
            tex = np.clip(tex, 0.06, 2.6)
            col = col * tex[..., None]

            # limbal ring
            col *= (1.0 - 0.90 * smoothstep(0.925, 1.005, rn))[..., None]
            col += C_LIMBUS[None, None, :] * smoothstep(0.935, 1.02, rn)[..., None]

            # the fire behind the stroma
            emis = (np.exp(-((rn - 0.26) ** 2) / 0.10) * (0.05 + 0.44 * rage)
                    + 0.50 * rage * np.exp(-((rn - 0.11) ** 2) / 0.013))
            emis *= (0.42 + 0.44 * tex) * (0.72 + 0.56 * sector)
            col += C_EMBER[None, None, :] * emis[..., None]
            del emis, tex, fib, fib2, crypt, coll, sector, ang_w

            # pupil, constricting and drawing to a vertical slit
            pr = np.float32(P["pupil"] * R_IRIS)
            slit = np.float32(P["slit"])
            pd = np.sqrt((a / slit) ** 2 + b * b)
            pd2 = pd
            pedge = smoothstep(pr - 0.006, pr + 0.006, pd)
            col *= pedge[..., None]
            col += C_EMBER[None, None, :] * (
                np.exp(-((pd - pr) ** 2) / 0.00022) * (0.10 + 0.72 * rage))[..., None]
            del pedge

            # pigment ruff: the dark collar the pupil margin throws outward
            col *= (1.0 - 0.62 * np.exp(-((pd2 - pr * 1.16) ** 2) / 0.00035))[..., None]
            r_lim = np.float32(R_IRIS) * (1.0 + 0.014 * (value_noise(ang * 9.0, rn * 0.0 + 3.0, 71, period=9.0) - 0.5))
            iris_a = 1.0 - smoothstep(-0.010, 0.004, rr - r_lim)
            del r_lim
            sub = eye[isl]
            eye[isl] = sub * (1.0 - iris_a)[..., None] + col * iris_a[..., None]
            del col, sub, iris_a, a, b, rr, rn, th, ang, k, pd, pd2

        del iu, iv, ir, in_iris

        # ---------------- occlusion by the lids --------------------------
        lid_sh = smoothstep(0.0, 0.46, s_up - sv)
        eye *= (0.07 + 0.93 * lid_sh)[..., None]
        eye *= (0.40 + 0.60 * smoothstep(0.0, 0.13, sv - s_lo))[..., None]
        eye *= (0.24 + 0.76 * smoothstep(0.80, 1.00, 1.0 - np.abs(su)) ** 0.6)[..., None]
        del lid_sh

        # ---------------- cornea ----------------------------------------
        # key catchlight, upper-left, softened window shape
        hx = bu + 0.20
        hy = bv - 0.20
        spec = 0.85 * np.exp(-((np.abs(hx) / 0.042) ** 2.8 + (np.abs(hy) / 0.029) ** 2.8))
        spec += 1.30 * np.exp(-((np.abs(hx) / 0.021) ** 3.0 + (np.abs(hy) / 0.014) ** 3.0))
        spec += 0.055 * np.exp(-(hx * hx + hy * hy) / 0.0070)
        # bounce fill, lower-right
        spec += 0.10 * np.exp(-(((bu - 0.30) ** 2) / 0.014 + ((bv + 0.26) ** 2) / 0.0060))
        # broad wet sheen over the whole cornea
        spec += 0.007 * np.clip(nz, 0, 1) ** 3 * np.exp(-((bv - 0.30) ** 2) / 0.20)
        eye += spec[..., None] * np.array([1.62, 1.60, 1.68], dtype=np.float32)[None, None, :]
        del spec, hx, hy

        # light bending round the corneal bulge, brightest away from the key
        rim = np.exp(-((np.sqrt(bu * bu + bv * bv) - R_IRIS - 0.008) ** 2) / 0.000045)
        rim *= smoothstep(-0.30, 0.80, bu * 0.72 - bv * 0.69)
        eye += rim[..., None] * np.array([0.045, 0.042, 0.040], dtype=np.float32)[None, None, :]
        del rim

        # tear meniscus riding on the lower lid margin
        tear = np.exp(-((sv - s_lo - 0.015) ** 2) / 0.000055) * smoothstep(0.99, 0.62, np.abs(su))
        tear *= 0.45 + 0.85 * fbm(su * 9.0, sv * 3.0, octaves=2, seed=808)
        eye += tear[..., None] * np.array([0.30, 0.285, 0.28], dtype=np.float32)[None, None, :]
        # dark waterline under the upper lid margin
        eye *= (1.0 - 0.88 * np.exp(-((sv - s_up + 0.012) ** 2) / 0.00040))[..., None]
        del tear, nz, nx, ny, ndl, wrap, diffuse, rb, bu, bv

        m = inside[sl][..., None]
        img[sl] = img[sl] * (1.0 - m) + eye * m
        del eye, m, su, sv, s_up, s_lo

    del inside, upper, lower, u, v

    # ---------------- lashes -------------------------------------------
    lm = lash_mask(P, W2, H2)
    img = img * (1.0 - lm)[..., None] + C_LASH[None, None, :] * lm[..., None]
    del lm

    # ---------------- downsample ---------------------------------------
    if ss > 1:
        img = img.reshape(h, ss, w, ss, 3).mean(axis=(1, 3))

    # ---------------- bloom / grade / grain ----------------------------
    lum = img @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    bright = np.clip(lum - 1.05, 0.0, None)[..., None] * img
    small = bright[: (h // 4) * 4, : (w // 4) * 4].reshape(h // 4, 4, w // 4, 4, 3).mean(axis=(1, 3))
    small = blur2d(small, max(2, w // 340))
    big = np.repeat(np.repeat(small, 4, axis=0), 4, axis=1)
    if big.shape[0] != h or big.shape[1] != w:
        pad = ((0, h - big.shape[0]), (0, w - big.shape[1]), (0, 0))
        big = np.pad(big, pad, mode="edge")
    big = blur2d(big, 3, passes=2)      # nearest-neighbour upsample leaves 4px blocks
    img = img + big * (0.15 + 0.26 * rage)
    del lum, bright, small, big

    yy = (np.arange(h, dtype=np.float32) / h - 0.5) * 2.0
    xx = (np.arange(w, dtype=np.float32) / w - 0.5) * 2.0
    ecx = (np.float32(EYE_CX) - P["cam_x"]) * P["zoom"] / ASPECT
    ecy = (np.float32(EYE_CY) - P["cam_y"]) * P["zoom"]
    rad = np.sqrt(xx[None, :] ** 2 * 0.86 + yy[:, None] ** 2)

    # shallow depth of field: the eye is the focal plane, the face falls off
    coc = smoothstep(0.42, 1.35, np.sqrt(((xx[None, :] - ecx) * 0.92) ** 2
                                         + ((yy[:, None] - ecy) * 1.30) ** 2))
    img = img * (1.0 - coc)[..., None] + blur2d(img, max(1, w // 420), passes=2) * coc[..., None]
    del coc

    vig = np.clip(1.0 - 0.86 * smoothstep(0.34, 1.22, rad), 0.0, 1.0) ** 1.5
    img *= vig[..., None]
    del rad, vig

    img = aces(img * 0.94)
    img = img ** np.float32(1.0 / 2.2)

    # cool the shadows, warm the highlights
    l2 = img @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    img[..., 2] += 0.045 * (1.0 - l2) ** 2
    img[..., 0] += 0.030 * l2 ** 2
    img[..., 1] -= 0.010 * (1.0 - l2) ** 2
    del l2

    g = np.random.default_rng(int(t * 1000) + 17).standard_normal((h, w, 1)).astype(np.float32)
    img += g * 0.011
    del g

    img = np.clip(img, 0.0, 1.0)
    out = (img * 255.0 + 0.5).astype(np.uint8)

    # chromatic aberration: pull R out, push B in, by a pixel
    im = Image.fromarray(out)
    r, gch, b = im.split()
    r = r.resize((int(w * 1.0022), int(h * 1.0022)), Image.LANCZOS)
    r = r.crop(((r.width - w) // 2, (r.height - h) // 2,
                (r.width - w) // 2 + w, (r.height - h) // 2 + h))
    b = b.resize((int(w * 0.9982), int(h * 0.9982)), Image.LANCZOS)
    pad_l = (w - b.width) // 2
    pad_t = (h - b.height) // 2
    bb = Image.new("L", (w, h), 0)
    bb.paste(b, (pad_l, pad_t))
    return Image.merge("RGB", (r, gch, bb))


# --------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", type=float, default=None,
                    help="render one frame at this timestamp and exit")
    ap.add_argument("--scale", type=float, default=1.0)
    ap.add_argument("--ss", type=int, default=SUPERSAMPLE)
    ap.add_argument("--out", default="frames")
    ap.add_argument("--start", type=int, default=0)
    ap.add_argument("--stride", type=int, default=1)
    args = ap.parse_args()

    w = int(OUT_W * args.scale) // 2 * 2
    h = int(OUT_H * args.scale) // 2 * 2

    if args.preview is not None:
        im = render(args.preview, w, h, args.ss)
        path = f"{args.out}_t{args.preview:.2f}.png"
        im.save(path)
        print(path)
        return

    os.makedirs(args.out, exist_ok=True)
    total = int(DURATION * FPS)
    for i in range(args.start, total, args.stride):
        im = render(i / FPS, w, h, args.ss)
        im.save(os.path.join(args.out, f"f{i:05d}.png"))
        print(f"{i+1}/{total}", flush=True)


if __name__ == "__main__":
    main()
