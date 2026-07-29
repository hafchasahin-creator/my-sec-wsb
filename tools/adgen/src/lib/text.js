/**
 * Kinetic typography helpers. Body copy is set in Liberation Sans (the only
 * strong grotesque installed); the MIRINDA wordmark itself lives in brand.js
 * and is never set in a font.
 */

import { COLOR, rgba, BODY_FONT } from '../brand.js';
import { clamp, ease, stagger } from './ease.js';

export function setFont(ctx, size, { weight = 'bold', italic = false, tracking = 0 } = {}) {
  ctx.font = `${italic ? 'italic ' : ''}${weight} ${size}px "${BODY_FONT}"`;
  ctx.letterSpacing = `${tracking}px`;
}

/** Centred line with an optional outline, drop shadow and uniform alpha. */
export function drawText(ctx, str, x, y, size, opt = {}) {
  const {
    color = COLOR.white,
    outline = null,
    outlineWidth = 0.22,
    align = 'center',
    baseline = 'middle',
    alpha = 1,
    tracking = 0,
    weight = 'bold',
    italic = false,
    shadow = 0,
  } = opt;
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha *= clamp(alpha);
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  setFont(ctx, size, { weight, italic, tracking });
  if (shadow > 0) {
    ctx.shadowColor = rgba(COLOR.ink, shadow);
    ctx.shadowBlur = size * 0.28;
    ctx.shadowOffsetY = size * 0.05;
  }
  if (outline) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = size * outlineWidth;
    ctx.strokeStyle = outline;
    ctx.strokeText(str, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
  ctx.restore();
}

/**
 * Per-letter animated line. `mode` picks the entrance:
 *   'rise'  letters slide up into place
 *   'pop'   letters scale in with an overshoot
 *   'drop'  letters fall in and bounce
 *   'flip'  letters rotate in around X
 *   'wave'  letters float on a continuous sine (no entrance)
 */
export function drawKinetic(ctx, str, x, y, size, t, opt = {}) {
  const {
    mode = 'rise',
    start = 0,
    step = 0.045,
    dur = 0.55,
    color = COLOR.white,
    outline = null,
    tracking = 2,
    alpha = 1,
    weight = 'bold',
    italic = false,
    amp = 1,
  } = opt;
  if (alpha <= 0) return;

  ctx.save();
  ctx.globalAlpha *= clamp(alpha);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  setFont(ctx, size, { weight, italic, tracking });

  const chars = [...str];
  const widths = chars.map((c) => ctx.measureText(c).width + tracking);
  const total = widths.reduce((a, b) => a + b, 0);
  let cx = x - total / 2;
  const lt = t - start;

  for (let i = 0; i < chars.length; i++) {
    const w = widths[i];
    const cxi = cx + w / 2;
    cx += w;
    if (chars[i] === ' ') continue;

    let dx = 0, dy = 0, sc = 1, rot = 0, a = 1, sy = 1;
    if (mode === 'wave') {
      dy = Math.sin(t * 3 + i * 0.5) * size * 0.12 * amp;
    } else {
      const p = stagger(lt, i, step, dur, mode === 'drop' ? ease.outBounce : ease.outBack);
      if (p <= 0) continue;
      a = clamp(p * 2.5);
      if (mode === 'rise') dy = (1 - p) * size * 0.9 * amp;
      else if (mode === 'pop') sc = p;
      else if (mode === 'drop') dy = -(1 - p) * size * 1.6 * amp;
      else if (mode === 'flip') { sy = p; rot = (1 - p) * 0.6; }
    }

    ctx.save();
    ctx.globalAlpha *= a;
    ctx.translate(cxi, y + dy);
    ctx.rotate(rot);
    ctx.scale(sc, sc * sy);
    ctx.translate(dx, 0);
    if (outline) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = size * 0.2;
      ctx.strokeStyle = outline;
      ctx.strokeText(chars[i], 0, 0);
    }
    ctx.fillStyle = color;
    ctx.fillText(chars[i], 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

/** How long drawKinetic takes to fully land, for sequencing the next beat. */
export function kineticDuration(str, step = 0.045, dur = 0.55) {
  return (str.length - 1) * step + dur;
}
