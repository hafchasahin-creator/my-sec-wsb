"""Shared mask definitions for the hat/hand animation."""
from PIL import Image, ImageDraw, ImageFilter
import numpy as np

W, H = 736, 1089

# Region covering hat + brim + fist + forearm.
# Traced against the artwork: top/left runs off-frame, the long lower-right
# diagonal follows the brim edge down to the fist, then down the sleeve.
ARM_HAT = [
    (-80, -80),
    (405, -80),
    (410, 18),
    (352, 72),
    (300, 120),
    (248, 165),
    (196, 212),
    (150, 248),
    (120, 272),
    (168, 285),
    (212, 302),
    (232, 332),
    (244, 385),
    (232, 440),
    (222, 490),
    (246, 532),
    (272, 580),
    (285, 640),
    (250, 700),
    (170, 760),
    (40, 810),
    (-80, 840),
]

# The hat alone (above the fist), used for the extra wrist-flex rotation.
HAT_ONLY = [
    (-80, -80),
    (405, -80),
    (410, 18),
    (300, 120),
    (196, 212),
    (120, 272),
    (60, 290),
    (-80, 300),
]


def poly_mask(points, feather, size=(W, H)):
    """Rasterise a polygon into a float32 0..1 mask with Gaussian feathering."""
    im = Image.new("L", size, 0)
    ImageDraw.Draw(im).polygon(points, fill=255)
    if feather > 0:
        im = im.filter(ImageFilter.GaussianBlur(feather))
    return np.asarray(im, dtype=np.float32) / 255.0


def taper_y(mask, y_start, y_end):
    """Fade a mask to zero between y_start and y_end so it blends into the jacket."""
    ys = np.arange(mask.shape[0], dtype=np.float32)
    t = np.clip((y_end - ys) / float(y_end - y_start), 0.0, 1.0)
    # smoothstep for a soft shoulder
    t = t * t * (3.0 - 2.0 * t)
    return mask * t[:, None]


def build_masks():
    arm = poly_mask(ARM_HAT, feather=24)
    arm = taper_y(arm, 600, 820)
    hat = poly_mask(HAT_ONLY, feather=26)
    return arm, hat
