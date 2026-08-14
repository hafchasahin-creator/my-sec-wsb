"""Animate the portrait: the hat tips and the hand that holds it shifts.

Approach: no hard cut-outs (they leave holes and seams on a painted image).
Instead every frame is a single backward resample of the source through a
composed map:

    output pixel -> camera drift -> masked rigid-body warp -> source sample

The warp is a rotation whose influence is weighted by a feathered mask, so the
displacement decays smoothly to zero outside the hat/arm and nothing tears.
"""
import argparse
import math
import os
import subprocess

import numpy as np
from PIL import Image

from mask import build_masks, W, H

SRC = "src.jpg"
FPS = 30
DURATION = 12.0           # seconds, seamless loop
GESTURE_PERIOD = 4.0      # seconds per hat-tip cycle
OUT_W, OUT_H = 720, 1080
SS = 2                    # source supersample factor for clean resampling

# Rotation pivots, in source pixel coordinates.
PIVOT_ELBOW = (-150.0, 720.0)   # off-frame elbow: swings the whole forearm
PIVOT_FIST = (185.0, 330.0)     # the fist gripping the brim: wrist flex

AMP_ELBOW = math.radians(0.85)  # whole-arm swing
AMP_WRIST = math.radians(1.9)   # hat tilt about the fist


def bilinear(img, x, y):
    """Sample img (H,W) or (H,W,C) at float coords, clamping at the border."""
    h, w = img.shape[:2]
    x = np.clip(x, 0, w - 1.001)
    y = np.clip(y, 0, h - 1.001)
    x0 = np.floor(x).astype(np.int32)
    y0 = np.floor(y).astype(np.int32)
    x1 = x0 + 1
    y1 = y0 + 1
    fx = (x - x0)[..., None] if img.ndim == 3 else (x - x0)
    fy = (y - y0)[..., None] if img.ndim == 3 else (y - y0)
    a = img[y0, x0]
    b = img[y0, x1]
    c = img[y1, x0]
    d = img[y1, x1]
    top = a + (b - a) * fx
    bot = c + (d - c) * fx
    return top + (bot - top) * fy


def rot_delta(x, y, pivot, theta):
    """Displacement produced by rotating (x, y) about pivot by theta."""
    px, py = pivot
    dx = x - px
    dy = y - py
    ct, st = math.cos(theta), math.sin(theta)
    return (px + ct * dx - st * dy) - x, (py + st * dx + ct * dy) - y


def gesture(t):
    """Loop-safe angles: hold, lift, settle. Harmonics keep it seamless."""
    u = 2.0 * math.pi * (t % GESTURE_PERIOD) / GESTURE_PERIOD
    elbow = AMP_ELBOW * (math.sin(u) + 0.32 * math.sin(2 * u + 0.7))
    wrist = AMP_WRIST * (math.sin(u + 0.85) + 0.28 * math.sin(2 * u + 1.9))
    return elbow, wrist


def camera(t):
    """Slow breathing drift over the full duration, periodic so it loops."""
    v = 2.0 * math.pi * t / DURATION
    zoom = 1.018 + 0.018 * math.cos(v)          # 1.000 .. 1.036
    pan_x = 5.0 * math.sin(v)
    pan_y = 7.0 * math.sin(v + 1.2)
    return zoom, pan_x, pan_y


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", type=str, default="")
    ap.add_argument("--out", type=str, default="hat_tip.mp4")
    args = ap.parse_args()

    base = Image.open(SRC).convert("RGB")
    hi = base.resize((W * SS, H * SS), Image.LANCZOS)
    hi = np.asarray(hi, dtype=np.float32)

    arm_mask, hat_mask = build_masks()

    # Output pixel grid mapped into source space.
    ou, ov = np.meshgrid(
        np.arange(OUT_W, dtype=np.float32),
        np.arange(OUT_H, dtype=np.float32),
    )
    cx, cy = W / 2.0, H / 2.0
    # Base scale: fit the 720x1080 frame across the source.
    s0 = max(OUT_W / float(W), OUT_H / float(H))

    if args.preview:
        times = [float(x) for x in args.preview.split(",")]
    else:
        times = [i / FPS for i in range(int(round(DURATION * FPS)))]

    ffmpeg = None
    if not args.preview:
        import imageio_ffmpeg
        exe = imageio_ffmpeg.get_ffmpeg_exe()
        cmd = [
            exe, "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
            "-s", f"{OUT_W}x{OUT_H}", "-r", str(FPS), "-i", "-",
            "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "17",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart", args.out,
        ]
        ffmpeg = subprocess.Popen(cmd, stdin=subprocess.PIPE,
                                  stdout=subprocess.DEVNULL,
                                  stderr=subprocess.PIPE)

    for idx, t in enumerate(times):
        zoom, pan_x, pan_y = camera(t)
        scale = s0 * zoom
        # output -> source coordinates
        sx = (ou - OUT_W / 2.0) / scale + cx + pan_x
        sy = (ov - OUT_H / 2.0) / scale + cy + pan_y

        th_e, th_w = gesture(t)
        m_arm = bilinear(arm_mask, sx, sy)
        m_hat = bilinear(hat_mask, sx, sy)

        ex, ey = rot_delta(sx, sy, PIVOT_ELBOW, th_e)
        wx, wy = rot_delta(sx, sy, PIVOT_FIST, th_w)
        dx = m_arm * ex + m_hat * wx
        dy = m_arm * ey + m_hat * wy

        # backward warp: content at q moved to q + d, so sample at q - d
        frame = bilinear(hi, (sx - dx) * SS, (sy - dy) * SS)
        frame = np.clip(frame + 0.5, 0, 255).astype(np.uint8)

        if args.preview:
            Image.fromarray(frame).save(f"prev_{idx}.png")
        else:
            ffmpeg.stdin.write(frame.tobytes())

    if ffmpeg is not None:
        ffmpeg.stdin.close()
        err = ffmpeg.stderr.read().decode("utf-8", "replace")
        if ffmpeg.wait() != 0:
            raise SystemExit("ffmpeg failed:\n" + err[-3000:])
        print("wrote", args.out, os.path.getsize(args.out), "bytes")


if __name__ == "__main__":
    main()
