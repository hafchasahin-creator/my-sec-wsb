"""Single source of truth for Clawd's pixel geometry.

Clawd is a 12x8 grid of square cells. At the reference scale a cell is 32px,
giving a 384x256 sprite. Every renderer (web canvas, Android Compose, PNG
export) reads this same grid, so the shape can never drift between platforms.

Grid rows (col indices that are filled):
    0  body top .................. 2..9
    1  eye row .................... 2..9   (cols 3 and 8 are eye cells)
    2  arm row .................... 0..11
    3  arm row .................... 0..11
    4  body ....................... 2..9
    5  body ....................... 2..9
    6  legs ....................... 2, 4, 7, 9
    7  legs ....................... 2, 4, 7, 9
"""

COLS = 12
ROWS = 8
CELL = 32                      # reference px per cell
WIDTH = COLS * CELL            # 384
HEIGHT = ROWS * CELL           # 256

CORAL = (241, 96, 76, 255)     # #F1604C
EYE   = (17, 17, 17, 255)      # #111111
CLEAR = (0, 0, 0, 0)

BODY_COLS = range(2, 10)       # 2..9
ARM_ROWS = (2, 3)
LEG_COLS = (2, 4, 7, 9)
LEG_ROWS = (6, 7)
EYE_ROW = 1
EYE_COLS = (3, 8)

# --- layer definitions -------------------------------------------------------
# Each layer is a list of (col, row) cells plus the pivot it transforms about.
# Composited at rest they reproduce the original artwork exactly.

def body_cells():
    """Head/torso, rows 0..5, cols 2..9 — minus the two eye cells."""
    out = []
    for r in range(0, 6):
        for c in BODY_COLS:
            if r == EYE_ROW and c in EYE_COLS:
                continue
            out.append((c, r))
    return out


def arm_cells(side):
    """side: 'L' -> cols 0,1  |  'R' -> cols 10,11 (rows 2..3)."""
    cols = (0, 1) if side == "L" else (10, 11)
    return [(c, r) for r in ARM_ROWS for c in cols]


def leg_cells():
    return [(c, r) for r in LEG_ROWS for c in LEG_COLS]


def eye_cell(side):
    return (EYE_COLS[0] if side == "L" else EYE_COLS[1], EYE_ROW)


LAYERS = {
    # name: (cells, pivot_x_cells, pivot_y_cells)  pivot in cell units
    "body":  (body_cells(),  6.0,  6.0),   # scales about its bottom edge (row 6)
    "armL":  (arm_cells("L"), 2.0, 3.0),   # hinges at the shoulder (body edge, low)
    "armR":  (arm_cells("R"), 10.0, 3.0),
    "legs":  (leg_cells(),   6.0,  6.0),   # hinges where legs meet the body
    "eyeL":  ([eye_cell("L")], 3.5, 1.5),  # scales about its own centre
    "eyeR":  ([eye_cell("R")], 8.5, 1.5),
}
