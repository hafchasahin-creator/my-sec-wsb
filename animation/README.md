# Hat-tip animation

`hat_tip.mp4` — the portrait in `src.jpg` animated so the hat and the hand
holding it move. 720x1080, 30 fps, H.264, 12 s, seamless loop.

## How it works

No frames are painted by hand and nothing is cut out. Each output frame is a
single backward resample of the source through a composed map:

```
output pixel -> camera drift -> masked rigid-body warp -> source sample
```

* `mask.py` traces two feathered regions: the whole moving unit (hat + brim +
  fist + forearm) and the hat alone. The arm mask fades to zero between
  y=600 and y=820 so the motion dissolves into the jacket instead of ending
  on a seam.
* `render.py` rotates those regions about two pivots — an off-frame elbow at
  `(-150, 720)` for the forearm swing, and the fist at `(185, 330)` for the
  wrist flex that tips the hat. Displacement is weighted by the feathered
  masks, so it decays smoothly to zero at the edges and nothing tears.
* A slow periodic zoom/pan adds ambient life. Gesture period (4 s) divides the
  total duration (12 s) and the camera drift is a full sine cycle, so the last
  frame meets the first.

## Rebuild

```sh
pip install pillow numpy imageio-ffmpeg
python3 render.py --out hat_tip.mp4
```

Inspect single frames without encoding:

```sh
python3 render.py --preview 0,1.0,2.0,3.0   # writes prev_0.png ...
```

Tune the feel with `AMP_ELBOW` / `AMP_WRIST` (swing size), `GESTURE_PERIOD`
(pace), and the pivots in `render.py`.
