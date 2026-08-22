/*
 * Clawd.
 *
 * The artwork is a 12x8 grid of square cells supplied by the user. This module
 * never redraws that shape — it reads the grid, splits it into six rigid layers,
 * and moves the layers. At rest the composite is pixel-identical to the source
 * PNG (tools/gen_clawd.py asserts exactly that).
 *
 * Rendering notes
 * ---------------
 * Each layer is filled as ONE Path2D built from its cells. Filling cell-by-cell
 * would leave a faint antialiased seam along every shared edge once the layer sits
 * at a fractional offset; a single path fill computes coverage across the whole
 * region at once, so the interior is solid and only the true silhouette is soft.
 * That 1px softness is what lets Clawd breathe by fractions of a pixel instead of
 * snapping a whole row at a time.
 */

import { breath, smooth, smoother, clamp, clamp01, lerp, easeOutCubic, easeInCubic } from './ease.js';
import { makeScheduler, makeSequence } from './rng.js';

export const GRID = { cols: 12, rows: 8, cell: 32 };
export const W = GRID.cols * GRID.cell; // 384
export const H = GRID.rows * GRID.cell; // 256

const CORAL = '#F1604C';
const EYE = '#111111';

// --- the grid, exactly as supplied -----------------------------------------
const BODY_COLS = [2, 3, 4, 5, 6, 7, 8, 9];
const LEG_COLS = [2, 4, 7, 9];
const EYE_COLS = [3, 8];
const EYE_ROW = 1;

function bodyCells() {
  const out = [];
  for (let r = 0; r < 6; r++)
    for (const c of BODY_COLS) {
      if (r === EYE_ROW && EYE_COLS.includes(c)) continue;
      out.push([c, r]);
    }
  return out;
}
const armCells = (side) =>
  (side === 'L' ? [0, 1] : [10, 11]).flatMap((c) => [[c, 2], [c, 3]]);
const legCells = () => LEG_COLS.flatMap((c) => [[c, 6], [c, 7]]);

function pathOf(cells) {
  const p = new Path2D();
  for (const [c, r] of cells) p.rect(c * GRID.cell, r * GRID.cell, GRID.cell, GRID.cell);
  return p;
}

// Built on first draw, not at import time: Path2D only exists in a document, and
// keeping the module import-clean lets it be unit-tested and loaded in a worker.
let PATH = null;
function paths() {
  if (!PATH) {
    PATH = {
      body: pathOf(bodyCells()),
      armL: pathOf(armCells('L')),
      armR: pathOf(armCells('R')),
      legs: pathOf(legCells()),
    };
  }
  return PATH;
}

// Eyes are drawn from their own local box so blinking can scale them.
const EYE_BOX = EYE_COLS.map((c) => ({
  x: c * GRID.cell,
  y: EYE_ROW * GRID.cell,
  w: GRID.cell,
  h: GRID.cell,
}));

// Pivot rows, in grid units.
const TORSO_BOTTOM = 6 * GRID.cell; // body scales about here so the feet stay planted
const SHOULDER_Y = 3.6 * GRID.cell; // arms hinge just below their own block

// --- the "Z" ---------------------------------------------------------------
// Drawn in Clawd's own idiom: a 5x5 pixel glyph, not a font character. A script
// "z" next to blocky pixel art is the single fastest way to make this look cheap.
const Z_GLYPH = ['11111', '00011', '00100', '11000', '11111'].map((row) =>
  row.split('').map(Number)
);
let Z_PATH = null;
function zPath() {
  if (!Z_PATH) {
    Z_PATH = new Path2D();
    for (let r = 0; r < 5; r++)
      for (let c = 0; c < 5; c++) if (Z_GLYPH[r][c]) Z_PATH.rect(c, r, 1, 1);
  }
  return Z_PATH;
}

// --- timing constants ------------------------------------------------------
// The three carrier periods are mutually irrational-ish so the composite never
// visibly repeats: lcm(4.2, 11.3, 17.9) is longer than any night.
const T = {
  breathAwake: 4.2,
  breathAsleep: 6.9,
  bob: 11.3,
  sway: 17.9,
  drift: 23.4, // slow whole-rig drift, doubles as OLED burn-in mitigation
};

const AMP = {
  // Reference-unit displacements. Deliberately small: at a 240px-tall Clawd the
  // breath moves the crown by ~3px. If you can see it "pumping", it is wrong.
  breathScale: 0.018,
  breathSquash: 0.006,
  bobY: 4.0,
  swayX: 1.7,
  tilt: 0.0095, // radians, ~0.54 degrees
  armSwing: 0.014,
};

export const AWAKE = 'awake';
export const DROWSY = 'drowsy';
export const ASLEEP = 'asleep';

export function createClawd(opts = {}) {
  const seq = makeSequence(0.137);
  const blinks = makeScheduler(2.6, 7.4, 0.311);
  const twitches = makeScheduler(11, 26, 0.577);
  const zzz = makeScheduler(2.6, 4.6, 0.733);
  const microWake = makeScheduler(150, 420, 0.211);

  const st = {
    mode: AWAKE,
    /** 0 = fully awake, 1 = fully asleep. Everything else is derived from this. */
    calm: 0,
    calmTarget: 0,
    /** 1 = eyes open, 0 = shut. */
    lid: 1,
    blink: null, // {start, dur, depth}
    twitch: null, // {start, dur, kind, dir}
    particles: [],
    reduced: !!opts.reducedMotion,
    lastIdleAt: 0,
  };

  function setMode(mode, now) {
    if (st.mode === mode) return;
    st.mode = mode;
    st.calmTarget = mode === ASLEEP ? 1 : mode === DROWSY ? 0.45 : 0;
    if (mode === ASLEEP) {
      zzz.reset(now, 2.0);
      blinks.setRange(9, 24);
    } else if (mode === DROWSY) {
      blinks.setRange(3.4, 9.0);
    } else {
      blinks.setRange(2.6, 7.4);
      st.particles.length = 0;
    }
  }

  function startBlink(now, v) {
    // Fast close, slower open — the asymmetry is what makes a blink read as a
    // blink instead of a flicker.
    const double = v < 0.13;
    st.blink = { start: now, close: 0.052, open: 0.11, hold: double ? 0.02 : 0, double, depth: 1 };
  }

  function update(now, dt) {
    // calm eases toward its target over ~2.4s; every amplitude below is a lerp on it
    const k = 1 - Math.exp(-dt / 0.75);
    st.calm += (st.calmTarget - st.calm) * k;

    // --- blinking ---
    if (st.mode !== ASLEEP) {
      const v = blinks.due(now);
      if (v >= 0 && !st.blink) startBlink(now, v);
    } else {
      // Asleep the eyes stay shut; very occasionally Clawd cracks one open.
      const v = microWake.due(now);
      if (v >= 0 && !st.blink) st.blink = { start: now, close: 0.9, open: 1.6, hold: 0.5, depth: -0.55 };
    }

    if (st.blink) {
      const b = st.blink;
      const e = now - b.start;
      const total = b.close + b.hold + b.open;
      if (e >= total) {
        st.blink = b.double ? { ...b, start: now, double: false } : null;
      }
    }

    // --- sleepy micromovements ---
    if (!st.twitch) {
      const v = twitches.due(now);
      if (v >= 0) {
        const kinds = ['lean', 'armL', 'armR', 'shift'];
        st.twitch = {
          start: now,
          dur: lerp(1.6, 3.4, v),
          kind: kinds[Math.floor(v * 4) & 3],
          dir: v < 0.5 ? -1 : 1,
          mag: lerp(0.55, 1, seq()),
        };
      }
    } else if (now - st.twitch.start > st.twitch.dur) {
      st.twitch = null;
    }

    // --- Zzz ---
    if (st.calm > 0.55 && !st.reduced) {
      const v = zzz.due(now);
      if (v >= 0 && st.particles.length < 3) {
        st.particles.push({
          born: now,
          life: lerp(5.0, 6.4, v),
          dx: lerp(-3, 7, seq()),
          wob: lerp(5, 11, seq()),
          wobT: lerp(2.6, 4.2, seq()),
          size: lerp(2.6, 3.6, seq()),
        });
      }
    }
    for (let i = st.particles.length - 1; i >= 0; i--) {
      if (now - st.particles[i].born > st.particles[i].life) st.particles.splice(i, 1);
    }
  }

  /** Eye openness 0..1 for this instant. */
  function lidOpenness(now) {
    const base = 1 - st.calm * 0.86; // asleep -> 0.14, a shut pixel eye is a line
    if (!st.blink) return base;
    const b = st.blink;
    const e = now - b.start;
    let p;
    if (e < b.close) p = easeInCubic(e / b.close);
    else if (e < b.close + b.hold) p = 1;
    else p = 1 - easeOutCubic((e - b.close - b.hold) / b.open);
    if (b.depth < 0) return clamp01(base + -b.depth * p * (1 - base)); // micro-wake: opens
    return base * (1 - p);
  }

  /**
   * Draw Clawd.
   * @param ctx   2D context
   * @param now   seconds, monotonic
   * @param cx,cy centre of the sprite in css px
   * @param scale css px per reference unit
   * @param alpha 0..1 master opacity
   */
  function draw(ctx, now, cx, cy, scale, alpha = 1) {
    if (alpha <= 0.004) return;

    const reduced = st.reduced;
    const calm = st.calm;

    // Amplitudes relax as Clawd falls asleep, and collapse under reduced-motion.
    const motion = reduced ? 0 : lerp(1, 0.55, calm);
    const bp = T.breathAwake + (T.breathAsleep - T.breathAwake) * calm;

    const br = breath(now / bp);
    const bob = reduced ? 0 : Math.sin((now / T.bob) * Math.PI * 2) * AMP.bobY * motion;
    const sway = reduced ? 0 : Math.sin((now / T.sway) * Math.PI * 2 + 1.1) * AMP.swayX * motion;

    // twitch contributions
    let tilt = 0, armLx = 0, armRx = 0, shift = 0;
    if (st.twitch && !reduced) {
      const tw = st.twitch;
      const p = clamp01((now - tw.start) / tw.dur);
      // a single smooth there-and-back, never a snap
      const env = Math.sin(p * Math.PI) * tw.mag * motion;
      if (tw.kind === 'lean') tilt = env * AMP.tilt * tw.dir;
      else if (tw.kind === 'armL') armLx = env * AMP.armSwing * tw.dir;
      else if (tw.kind === 'armR') armRx = env * AMP.armSwing * tw.dir;
      else shift = env * 1.6 * tw.dir;
    }
    // a permanent, barely-there lean once asleep
    tilt += calm * AMP.tilt * 0.55;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-W / 2 + sway + shift, -H / 2 + bob);

    // legs — planted, they only take the rig's own drift
    ctx.fillStyle = CORAL;
    const P = paths();
    ctx.fill(P.legs);

    // everything above the legs shares the breathing transform
    ctx.save();
    ctx.translate(W / 2, TORSO_BOTTOM);
    ctx.rotate(tilt);
    const sy = 1 + br * AMP.breathScale * lerp(1, 0.62, calm);
    const sx = 1 - br * AMP.breathSquash * lerp(1, 0.62, calm);
    ctx.scale(sx, sy);
    ctx.translate(-W / 2, -TORSO_BOTTOM);

    ctx.fill(P.body);

    // arms hinge at the shoulder so the tip travels further than the root
    for (const [p, rot] of [[P.armL, armLx], [P.armR, armRx]]) {
      if (rot === 0) {
        ctx.fill(p);
      } else {
        ctx.save();
        ctx.translate(W / 2, SHOULDER_Y);
        ctx.rotate(rot);
        ctx.translate(-W / 2, -SHOULDER_Y);
        ctx.fill(p);
        ctx.restore();
      }
    }

    // eyes, inside the body transform so they breathe with the head
    const open = lidOpenness(now);
    ctx.fillStyle = EYE;
    for (const e of EYE_BOX) {
      // Collapse toward a line sitting a little below centre — where a closed
      // pixel eye actually sits.
      const pivotY = e.y + e.h * 0.66;
      const h = Math.max(e.h * open, e.h * 0.2);
      ctx.fillRect(e.x, pivotY - h * 0.66, e.w, h);
    }
    ctx.restore(); // body transform

    // Zzz float up from just off the top-right of the head
    if (st.particles.length) drawParticles(ctx, now);

    ctx.restore();
  }

  function drawParticles(ctx, now) {
    ctx.fillStyle = CORAL;
    for (const p of st.particles) {
      const age = (now - p.born) / p.life;
      if (age < 0 || age > 1) continue;
      // opacity: in over the first 18%, out over the last 45%
      const a =
        age < 0.18 ? smooth(age / 0.18) : age > 0.55 ? 1 - smooth((age - 0.55) / 0.45) : 1;
      const rise = age * 74;
      const wob = Math.sin((now / p.wobT) * Math.PI * 2) * p.wob * age;
      const s = p.size * lerp(0.7, 1.25, age);
      ctx.save();
      ctx.globalAlpha = a * 0.5;
      ctx.translate(W * 0.72 + p.dx + wob, 22 - rise);
      ctx.scale(s, s);
      ctx.fill(zPath());
      ctx.restore();
    }
  }

  return {
    state: st,
    setMode,
    update,
    draw,
    get mode() { return st.mode; },
    set reducedMotion(v) { st.reduced = !!v; if (v) st.particles.length = 0; },
    /** True when nothing is mid-animation, so a low-power frame can be skipped. */
    get quiescent() { return !st.blink && !st.twitch && st.particles.length === 0; },
  };
}
