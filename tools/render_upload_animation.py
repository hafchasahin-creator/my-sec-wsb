"""Animate the file-upload card mockup into an MP4, with the Clawd mascot hosting."""
import math
import os
import subprocess

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, "media", "source", "upload-card.jpg")
CLAWD = os.path.join(ROOT, "media", "source", "clawd.webp")
OUT = os.path.join(ROOT, "media")
FRAMES = os.path.join(OUT, "_frames")

W = H = 736
FPS = 30
DUR = 10.0
NFRAMES = int(FPS * DUR)
SS = 3  # supersampling factor for the panel redraw

# --- geometry measured off the source image -------------------------------
PANEL = (126, 406, 616, 493)
PANEL_R = 22
TRACK_X0, TRACK_X1 = 155.0, 578.0
TRACK_CY, TRACK_H = 467.5, 7.5
SPIN_C = (173.0, 436.0)
SPIN_R = 11.0
TEXT_BASELINE = 441
STATUS_X = 196
PCT_RIGHT = 577

TEXT_RGB = (235, 234, 255)
TRACK_RGB = (58, 56, 105)
FILL_RGB = (255, 255, 255)
ACCENT = (150, 140, 255)
OK_RGB = (150, 240, 200)

FONT_PATH = "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"
FONT_BOLD = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"


def ease_out_cubic(x):
    return 1 - (1 - x) ** 3


def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


# --------------------------------------------------------------------------
# 1. Build a clean plate: the source image with the progress panel emptied,
#    so the spinner, labels and bar can be redrawn per frame.
# --------------------------------------------------------------------------
def build_plate(base):
    """The panel's glass background is a smooth horizontal gradient that is
    near-constant down each column, so it can be rebuilt from the clean rows
    just under the panel's top edge plus a gentle vertical ramp."""
    a = np.array(base).astype(np.float32)
    px0, py0, px1, py1 = PANEL

    CLEAN_Y0, CLEAN_Y1 = 411, 423      # clean strip above the text
    MID_X0, MID_X1 = 315, 528          # clean block between status and percent
    RAMP_Y0, RAMP_Y1 = 417, 441

    cols = a[CLEAN_Y0:CLEAN_Y1, px0:px1].mean(0)          # (w, 3)

    # smooth along x with a small gaussian to kill jpeg noise
    k = np.exp(-((np.arange(-9, 10)) ** 2) / (2 * 3.0 ** 2))
    k /= k.sum()
    cols = np.stack(
        [np.convolve(np.pad(cols[:, c], 9, mode="edge"), k, "valid") for c in range(3)],
        axis=1,
    )

    delta = (a[RAMP_Y1 - 3:RAMP_Y1 + 2, MID_X0:MID_X1].mean((0, 1))
             - a[CLEAN_Y0:CLEAN_Y1, MID_X0:MID_X1].mean((0, 1)))

    h = py1 - py0
    ys = np.arange(py0, py1, dtype=np.float32)
    f = np.clip((ys - (CLEAN_Y0 + CLEAN_Y1) / 2) / (RAMP_Y1 - RAMP_Y0), -1.0, 3.4)
    bg = cols[None, :, :] + delta[None, None, :] * f[:, None, None]

    # Rounded-rect mask for the panel interior, inset so the panel's own
    # border highlight survives untouched.
    mask = Image.new("L", (px1 - px0, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [3, 3, px1 - px0 - 4, h - 4], radius=PANEL_R - 3, fill=255
    )
    mask = mask.filter(ImageFilter.GaussianBlur(1.2))

    plate = base.copy()
    plate.paste(
        Image.fromarray(np.clip(bg, 0, 255).astype(np.uint8)), (px0, py0), mask
    )
    return plate


# --------------------------------------------------------------------------
# 2. Clawd mascot: trimmed, with detected eye boxes so he can blink.
# --------------------------------------------------------------------------
def load_clawd():
    im = Image.open(CLAWD).convert("RGBA")
    a = np.array(im)
    opaque = a[:, :, 3] > 128
    ys, xs = np.nonzero(opaque)
    box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    im = im.crop(box)
    a = np.array(im)

    # eyes = dark pixels inside the opaque silhouette
    dark = (a[:, :, 3] > 128) & (a[:, :, :3].sum(2) < 220)
    ys, xs = np.nonzero(dark)
    eyes = []
    if len(xs):
        mid = (xs.min() + xs.max()) / 2
        for sel in (xs < mid, xs >= mid):
            if sel.sum() > 20:
                eyes.append(
                    (xs[sel].min(), ys[sel].min(), xs[sel].max() + 1, ys[sel].max() + 1)
                )
    body = tuple(int(v) for v in a[a[:, :, 3] > 200][:, :3].mean(0))
    return im, eyes, body


def clawd_frame(base_img, eyes, body, blink):
    """blink in [0,1]; 1 = fully closed."""
    if blink <= 0.01 or not eyes:
        return base_img
    im = base_img.copy()
    d = ImageDraw.Draw(im)
    for (ex0, ey0, ex1, ey1) in eyes:
        d.rectangle([ex0, ey0, ex1 - 1, ey1 - 1], fill=body + (255,))
        h = ey1 - ey0
        top = ey0 + (h - max(2, int(h * (1 - blink)))) / 2
        bot = top + max(2, int(h * (1 - blink)))
        d.rectangle([ex0, top, ex1 - 1, bot], fill=(17, 17, 17, 255))
    return im


# --------------------------------------------------------------------------
# 3. Drawing helpers
# --------------------------------------------------------------------------
def fit_font(path, target_cap, sample="74%"):
    """Pick the pixel size whose digit cap-height matches the source design."""
    for size in range(10, 40):
        f = ImageFont.truetype(path, size)
        bb = f.getbbox(sample)
        if (bb[3] - bb[1]) >= target_cap:
            return f
    return ImageFont.truetype(path, 19)


def add_glow(img, glow_layer, blur, strength):
    """Additively screen a blurred layer onto an RGB image."""
    g = np.array(glow_layer.filter(ImageFilter.GaussianBlur(blur))).astype(np.float32)
    b = np.array(img).astype(np.float32)
    out = 255.0 - (255.0 - b) * (255.0 - g * strength) / 255.0
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def rr(draw, box, radius, **kw):
    draw.rounded_rectangle(box, radius=radius, **kw)


# --------------------------------------------------------------------------
# 4. Progress curve: eased ramp with a couple of realistic stalls.
# --------------------------------------------------------------------------
T_IN = 0.35          # panel content fades in
T_RUN_END = 7.0      # upload finishes
T_LOOP = 9.55        # loop-out fade begins


def progress_at(t):
    if t <= T_IN:
        return 0.0
    if t >= T_RUN_END:
        return 1.0
    u = (t - T_IN) / (T_RUN_END - T_IN)
    p = ease_out_cubic(u) * 0.28 + u * 0.72
    # brief stalls, the way a real transfer hitches
    for c, w, amt in ((0.30, 0.07, 0.030), (0.62, 0.06, 0.022)):
        p -= amt * math.exp(-(((u - c) / w) ** 2))
    return max(0.0, min(1.0, p))


def main(indices=None, encode=True):
    os.makedirs(FRAMES, exist_ok=True)
    for f in os.listdir(FRAMES):
        os.remove(os.path.join(FRAMES, f))

    base = Image.open(BASE).convert("RGB")
    plate = build_plate(base)

    clawd_src, eyes, body = load_clawd()
    CW = 132
    scale = CW / clawd_src.width
    CH = int(clawd_src.height * scale)
    CX, CY = 152, 138  # mascot centre in the empty space above the card

    font = fit_font(FONT_PATH, 13)
    font_pct = fit_font(FONT_PATH, 13)

    # a soft purple pool of light behind the mascot, matching the scene
    halo = Image.new("RGB", (W, H), (0, 0, 0))
    ImageDraw.Draw(halo).ellipse(
        [CX - 95, CY - 80, CX + 95, CY + 90], fill=(62, 44, 150)
    )
    halo = halo.filter(ImageFilter.GaussianBlur(45))

    band = Image.new("RGB", (W, H), (0, 0, 0))
    ImageDraw.Draw(band).ellipse([40, 500, 700, 800], fill=(90, 70, 235))
    band = band.filter(ImageFilter.GaussianBlur(60))

    shadow_base = Image.new("RGB", (W, H), (0, 0, 0))
    ImageDraw.Draw(shadow_base).ellipse(
        [CX - 52, CY + 62, CX + 52, CY + 82], fill=(70, 46, 150)
    )
    shadow_base = shadow_base.filter(ImageFilter.GaussianBlur(18))

    for i in (range(NFRAMES) if indices is None else indices):
        t = i / FPS
        p = progress_at(t)
        done = t >= T_RUN_END
        appear = smoothstep(0.0, T_IN, t)
        loop_out = 1.0 - smoothstep(T_LOOP, DUR, t)
        alpha = appear * loop_out

        img = plate.copy()

        # ---- mascot ------------------------------------------------------
        blink_ph = (t % 3.1)
        blink = max(0.0, 1 - abs(blink_ph - 2.6) / 0.09) if blink_ph > 2.4 else 0.0
        bob = 5.0 * math.sin(2 * math.pi * t / 2.4)
        hop = 0.0
        if done:
            u = t - T_RUN_END
            if u < 1.15:
                hop = -30 * abs(math.sin(math.pi * u / 0.42)) * math.exp(-u * 1.9)
        tilt = 4.0 * math.sin(2 * math.pi * t / 2.4 + 1.0) if not done else 9.0 * math.exp(
            -(t - T_RUN_END) * 1.6
        ) * math.sin((t - T_RUN_END) * 13)

        img = add_glow(img, halo, 0, 0.55 + 0.12 * math.sin(2 * math.pi * t / 2.4))

        m = clawd_frame(clawd_src, eyes, body, blink)
        m = m.resize((CW, CH), Image.LANCZOS)
        if abs(tilt) > 0.2:
            m = m.rotate(tilt, resample=Image.BICUBIC, expand=True)
        mx = CX - m.width // 2
        my = int(CY - m.height // 2 + bob + hop)

        img = add_glow(img, shadow_base, 0, 0.5 - 0.045 * (bob + hop) / 5.0)
        img.paste(m, (mx, my), m)

        # ---- progress panel (supersampled) --------------------------------
        px0, py0, px1, py1 = PANEL
        pw, ph = px1 - px0, py1 - py0
        layer = Image.new("RGBA", (pw * SS, ph * SS), (0, 0, 0, 0))
        glow = Image.new("RGB", (pw * SS, ph * SS), (0, 0, 0))
        d = ImageDraw.Draw(layer)
        dg = ImageDraw.Draw(glow)

        def L(x, y):
            return ((x - px0) * SS, (y - py0) * SS)

        A = int(255 * alpha)

        # track
        ty0, ty1 = TRACK_CY - TRACK_H / 2, TRACK_CY + TRACK_H / 2
        r = (TRACK_H / 2) * SS
        rr(d, [*L(TRACK_X0, ty0), *L(TRACK_X1, ty1)], r, fill=TRACK_RGB + (A,))

        # filled portion
        fill_w = (TRACK_X1 - TRACK_X0) * p
        if fill_w > TRACK_H:
            fx1 = TRACK_X0 + fill_w
            rr(d, [*L(TRACK_X0, ty0), *L(fx1, ty1)], r, fill=FILL_RGB + (A,))
            rr(dg, [*L(TRACK_X0, ty0), *L(fx1, ty1)], r,
               fill=tuple(int(c * alpha) for c in (120, 118, 190)))

            # shimmer travelling along the filled bar while uploading
            if not done:
                sh = ((t * 0.42) % 1.0)
                sx = TRACK_X0 + sh * fill_w
                half = 26
                for k in range(10):
                    f = 1 - k / 10
                    dg.ellipse(
                        [*L(sx - half * f, ty0 - 1), *L(sx + half * f, ty1 + 1)],
                        fill=tuple(int(c * 0.10 * alpha) for c in (255, 255, 255)),
                    )
            # leading-edge hotspot
            dg.ellipse([*L(fx1 - 9, ty0 - 5), *L(fx1 + 9, ty1 + 5)],
                       fill=tuple(int(c * alpha) for c in (170, 165, 235)))

        # spinner -> check
        cx, cy = SPIN_C
        sw = 2.6 * SS
        bbox = [*L(cx - SPIN_R, cy - SPIN_R), *L(cx + SPIN_R, cy + SPIN_R)]
        if not done:
            ang = (t * 300) % 360
            d.arc(bbox, ang, ang + 250, fill=(205, 206, 233, A), width=int(sw))
        else:
            u = min(1.0, (t - T_RUN_END) / 0.32)
            d.ellipse(bbox, outline=OK_RGB + (A,), width=int(sw))
            pts = [(cx - 5.0, cy + 0.3), (cx - 1.6, cy + 4.0), (cx + 5.4, cy - 3.6)]
            seg1 = min(1.0, u / 0.45)
            a0, a1 = pts[0], pts[1]
            d.line([*L(a0[0], a0[1]),
                    *L(a0[0] + (a1[0] - a0[0]) * seg1, a0[1] + (a1[1] - a0[1]) * seg1)],
                   fill=OK_RGB + (A,), width=int(sw), joint="curve")
            if u > 0.45:
                seg2 = (u - 0.45) / 0.55
                b0, b1 = pts[1], pts[2]
                d.line([*L(b0[0], b0[1]),
                        *L(b0[0] + (b1[0] - b0[0]) * seg2, b0[1] + (b1[1] - b0[1]) * seg2)],
                       fill=OK_RGB + (A,), width=int(sw), joint="curve")
            dg.ellipse([*L(cx - SPIN_R - 3, cy - SPIN_R - 3),
                        *L(cx + SPIN_R + 3, cy + SPIN_R + 3)],
                       fill=tuple(int(c * 0.55 * alpha * math.exp(-(t - T_RUN_END) * 1.3))
                                  for c in OK_RGB))

        # status + percent text, drawn at 1x for crisp glyphs
        text_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        dt = ImageDraw.Draw(text_layer)
        if done:
            dots = ""
            label = "Upload complete"
            col = OK_RGB
        else:
            label = "Uploading" + "." * (1 + int(t * 3) % 3)
            dots = ""
            col = TEXT_RGB
        dt.text((STATUS_X, TEXT_BASELINE), label + dots, font=font,
                fill=col + (A,), anchor="ls")
        pct = f"{int(round(p * 100))}%"
        dt.text((PCT_RIGHT, TEXT_BASELINE), pct, font=font_pct,
                fill=TEXT_RGB + (A,), anchor="rs")

        # composite panel layer
        panel_small = layer.resize((pw, ph), Image.LANCZOS)
        img.paste(panel_small, (px0, py0), panel_small)
        img.paste(text_layer, (0, 0), text_layer)

        glow_full = Image.new("RGB", (W, H), (0, 0, 0))
        glow_full.paste(glow.resize((pw, ph), Image.LANCZOS), (px0, py0))
        img = add_glow(img, glow_full, 7, 0.9)

        # ---- ambient pulse of the big glow under the card ------------------
        pulse = 0.04 * math.sin(2 * math.pi * t / 3.6)
        if done:
            pulse += 0.22 * math.exp(-(t - T_RUN_END) * 2.2)
        if abs(pulse) > 0.003:
            img = add_glow(img, band, 0, pulse)

        img.save(os.path.join(FRAMES, f"f{i:05d}.png"))
        if i % 30 == 0:
            print("frame", i, f"p={p:.2f}")

    if not encode:
        return

    import imageio_ffmpeg
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    out_mp4 = os.path.join(OUT, "upload-animation.mp4")
    subprocess.run(
        [ff, "-y", "-framerate", str(FPS), "-i", os.path.join(FRAMES, "f%05d.png"),
         "-c:v", "libx264", "-preset", "slow", "-crf", "18",
         "-pix_fmt", "yuv420p", "-movflags", "+faststart", out_mp4],
        check=True, capture_output=True,
    )
    for f in os.listdir(FRAMES):
        os.remove(os.path.join(FRAMES, f))
    os.rmdir(FRAMES)
    print("wrote", out_mp4, os.path.getsize(out_mp4), "bytes")


if __name__ == "__main__":
    main()
