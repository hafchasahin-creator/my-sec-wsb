/**
 * Mirinda brand system.
 *
 * Colours and identity rules come from brand references gathered for this
 * campaign: the wordmark is bold, rounded, slanted caps in green with a white
 * outline; supporting art is orange fruit and yellow-green splashes; the
 * primary brand orange is #F07C50 with a documented tint ramp above it.
 *
 * The wordmark is drawn as vector strokes rather than set in a typeface - no
 * rounded display font is installed, and stroking round-capped paths gives both
 * the correct letterform weight and exact control over the outline layers.
 */

import { clamp, lerp } from './lib/ease.js';

export const COLOR = {
  // Brand orange and its documented tint ramp.
  orange: '#F07C50',
  orange1: '#F28962',
  orange2: '#F39673',
  orange3: '#F5A385',
  orange4: '#F6B096',
  orange5: '#F8BEA8',
  orange6: '#FBD8CB',
  cream: '#FEF2EE',

  // The soda itself - more saturated than the brand tint ramp.
  sodaCore: '#FF7A1A',
  sodaLight: '#FFB347',
  sodaGlow: '#FFD08A',
  sodaDeep: '#E85D04',
  sodaShadow: '#B84600',

  // Wordmark green and its supporting leaf greens.
  green: '#0F8A3D',
  greenDeep: '#075C27',
  greenLight: '#3FBF63',
  leaf: '#2E9E4A',
  leafDark: '#1B6B33',

  white: '#FFFFFF',
  ink: '#20140C',
  night: '#160B04',
};

export const TINTS = [COLOR.orange, COLOR.orange1, COLOR.orange2, COLOR.orange3, COLOR.orange4, COLOR.orange5];

export const TAGLINES = [
  'THE TASTE IS IN MIRINDA',
  'FULL OF LIFE',
  'ORANGE, UNMISTAKABLY',
  'BURSTING WITH ORANGE',
  'TASTE THE SUNSHINE',
  'REAL ORANGE ENERGY',
];

export const BODY_FONT = 'Liberation Sans';

/* ------------------------------------------------------------------ *
 * Colour helpers
 * ------------------------------------------------------------------ */

/**
 * Add an alpha channel to a colour.
 *
 * Accepts both `#rrggbb` and the `rgb(r, g, b)` form that mixHex returns -
 * episodes routinely nest the two (`rgba(mixHex(a, b, t), 0.5)`), and parsing
 * only hex would silently yield `rgba(NaN, ...)`, which canvas discards,
 * leaving whatever fill happened to be set before.
 */
export function rgba(color, alpha) {
  const a = clamp(alpha, 0, 1);
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(color);
  if (m) return `rgba(${Math.round(+m[1])}, ${Math.round(+m[2])}, ${Math.round(+m[3])}, ${a})`;
  let h = color.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export function mixHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (sh) => Math.round(lerp((pa >> sh) & 255, (pb >> sh) & 255, clamp(t)));
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

/** Vertical linear gradient from an array of [stop, colour] pairs. */
export function vGrad(ctx, x, y0, y1, stops) {
  const g = ctx.createLinearGradient(x, y0, x, y1);
  for (const [s, c] of stops) g.addColorStop(s, c);
  return g;
}

/* ------------------------------------------------------------------ *
 * The MIRINDA wordmark
 *
 * Each glyph is a list of polylines on a 0..100 cap-height grid (y grows down,
 * baseline at y=100). Stroking them with round caps and joins produces the
 * rounded bold letterform; stroking the same paths three times at decreasing
 * widths produces the green core inside a white outline.
 * ------------------------------------------------------------------ */

const GLYPHS = {
  M: { w: 68, paths: [[[0, 100], [0, 0], [34, 58], [68, 0], [68, 100]]] },
  I: { w: 0, paths: [[[0, 0], [0, 100]]] },
  R: {
    w: 54,
    paths: [
      [[0, 100], [0, 0]],
      [[0, 0], [30, 0], ['q', 54, 0, 54, 24], ['q', 54, 48, 30, 48], [0, 48]],
      [[26, 48], [56, 100]],
    ],
  },
  N: { w: 58, paths: [[[0, 100], [0, 0], [58, 100], [58, 0]]] },
  D: {
    w: 60,
    paths: [
      [[0, 100], [0, 0]],
      [[0, 0], [24, 0], ['q', 60, 0, 60, 50], ['q', 60, 100, 24, 100], [0, 100]],
    ],
  },
  A: {
    w: 66,
    paths: [
      [[0, 100], [33, 0], [66, 100]],
      [[15, 66], [51, 66]],
    ],
  },
};

const WORD = 'MIRINDA';
const TRACKING = 30; // gap between glyph boxes, in grid units
const SLANT = -0.17; // italic lean

function tracePath(ctx, pts) {
  let started = false;
  for (const p of pts) {
    if (p[0] === 'q') {
      ctx.quadraticCurveTo(p[1], p[2], p[3], p[4]);
    } else if (!started) {
      ctx.moveTo(p[0], p[1]);
      started = true;
    } else {
      ctx.lineTo(p[0], p[1]);
    }
  }
}

/** Total wordmark width in grid units, before scaling. */
export function wordmarkGridWidth() {
  let w = 0;
  for (let i = 0; i < WORD.length; i++) {
    w += GLYPHS[WORD[i]].w;
    if (i < WORD.length - 1) w += TRACKING;
  }
  return w;
}

/**
 * Draw the MIRINDA wordmark centred on (x, y).
 *
 * @param {number} height  cap height in pixels
 * @param {object} opt
 *   reveal   0..1 - progressively reveals letters left to right
 *   fill     core colour (default brand green)
 *   outline  outline colour (default white)
 *   halo     optional extra outer ring colour
 *   shadow   drop shadow opacity
 *   letterY  fn(i) -> extra vertical offset per letter, for bouncing lockups
 *   letterS  fn(i) -> per-letter scale multiplier
 */
export function drawWordmark(ctx, x, y, height, opt = {}) {
  const {
    reveal = 1,
    fill = COLOR.green,
    outline = COLOR.white,
    halo = null,
    shadow = 0.28,
    letterY = null,
    letterS = null,
    alpha = 1,
  } = opt;
  if (alpha <= 0 || reveal <= 0) return;

  const s = height / 100;
  const stem = 25; // stroke width in grid units
  const gridW = wordmarkGridWidth();

  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(x, y);
  ctx.scale(s, s);
  // Slant about the vertical centre so the lean does not shift the mark sideways.
  ctx.transform(1, 0, SLANT, 1, 0, 0);
  ctx.translate(-gridW / 2, -50);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  let cursor = 0;
  const shown = reveal * WORD.length;

  for (let i = 0; i < WORD.length; i++) {
    const g = GLYPHS[WORD[i]];
    const local = clamp(shown - i);
    if (local > 0) {
      ctx.save();
      const dy = letterY ? letterY(i) : 0;
      const sc = letterS ? letterS(i) : 1;
      ctx.translate(cursor + g.w / 2, 50 + dy);
      ctx.scale(sc, sc);
      ctx.translate(-g.w / 2, -50);
      ctx.globalAlpha *= local;

      const layers = [];
      if (shadow > 0) layers.push([stem + 26, rgba(COLOR.greenDeep, shadow)]);
      if (halo) layers.push([stem + 22, halo]);
      layers.push([stem + 11, outline]);
      layers.push([stem, fill]);

      for (const [w, c] of layers) {
        ctx.lineWidth = w;
        ctx.strokeStyle = c;
        ctx.beginPath();
        for (const p of g.paths) tracePath(ctx, p);
        ctx.stroke();
      }
      ctx.restore();
    }
    cursor += g.w + TRACKING;
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ *
 * Supporting identity marks
 * ------------------------------------------------------------------ */

/**
 * Trace a closed organic outline through polar samples, smoothing the corners
 * with quadratic segments through segment midpoints. Used by every blob, splash
 * and liquid body in the campaign, so the silhouettes never look polygonal.
 */
export function blobPath(ctx, radiusAt, samples = 72, squash = 1) {
  const pts = [];
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * Math.PI * 2;
    const r = radiusAt(a, i);
    pts.push([Math.cos(a) * r, Math.sin(a) * r * squash]);
  }
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  ctx.beginPath();
  let m = mid(pts[samples - 1], pts[0]);
  ctx.moveTo(m[0], m[1]);
  for (let i = 0; i < samples; i++) {
    const cur = pts[i];
    const nxt = pts[(i + 1) % samples];
    m = mid(cur, nxt);
    ctx.quadraticCurveTo(cur[0], cur[1], m[0], m[1]);
  }
  ctx.closePath();
}

/** The yellow-green splash blob that sits behind the wordmark on pack art. */
export function drawSplashBlob(ctx, x, y, r, t, seed = 1, colors = null) {
  const [c0, c1] = colors || [COLOR.sodaLight, COLOR.orange];
  ctx.save();
  ctx.translate(x, y);
  // Soft rounded lobes plus a slow secondary wobble - reads as liquid, not a star.
  blobPath(
    ctx,
    (a) =>
      r *
      (1 +
        0.1 * Math.sin(a * 6 + t * 1.1 + seed) +
        0.06 * Math.sin(a * 9 - t * 0.7 + seed * 2) +
        0.04 * Math.sin(a * 3 + t * 1.9 + seed * 3)),
    84,
    0.88
  );
  const g = ctx.createRadialGradient(0, -r * 0.3, r * 0.08, 0, 0, r * 1.2);
  g.addColorStop(0, c0);
  g.addColorStop(0.62, c1);
  g.addColorStop(1, c1);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
}

/** Full end-card lockup: splash, wordmark, tagline rule. */
export function drawLockup(ctx, x, y, scale, t, opt = {}) {
  const { reveal = 1, tagline = TAGLINES[0], blob = true, taglineAt = 1, blobColors = null } = opt;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  if (blob) {
    ctx.save();
    ctx.globalAlpha *= clamp(reveal * 1.6);
    const r = 355 * clamp(reveal * 1.4);
    // Soft outer bloom so the mark separates from whatever is behind it.
    ctx.save();
    ctx.globalAlpha *= 0.45;
    drawSplashBlob(ctx, 0, -6, r * 1.16, t * 0.7, 7, [COLOR.sodaGlow, COLOR.sodaDeep]);
    ctx.restore();
    drawSplashBlob(ctx, 0, -6, r, t, 3, blobColors || [COLOR.sodaLight, COLOR.sodaCore]);
    ctx.restore();
  }

  drawWordmark(ctx, 0, -8, 152, { reveal });

  if (taglineAt > 0) {
    ctx.save();
    ctx.globalAlpha *= clamp(taglineAt);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = '7px';
    ctx.font = `bold 34px "${BODY_FONT}"`;
    const w = ctx.measureText(tagline).width;
    ctx.fillStyle = rgba(COLOR.white, 0.75);
    ctx.fillRect(-((w + 90) / 2) * clamp(taglineAt), 108, (w + 90) * clamp(taglineAt), 3);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 9;
    ctx.strokeStyle = rgba(COLOR.sodaShadow, 0.55);
    ctx.strokeText(tagline, 0, 148);
    ctx.fillStyle = COLOR.white;
    ctx.fillText(tagline, 0, 148);
    ctx.restore();
  }
  ctx.restore();
}
