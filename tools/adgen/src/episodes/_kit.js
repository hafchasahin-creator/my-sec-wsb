/**
 * Shared kit for episode modules.
 *
 * Every spot in the campaign runs 50 seconds on the same four-beat structure,
 * so the beat boundaries and the closing lockup live here rather than being
 * re-typed 25 times. Everything else about a spot - staging, palette, motion,
 * camera - is authored per episode.
 */

export * from '../brand.js';
export * from '../lib/ease.js';
export * from '../lib/rng.js';
export * from '../lib/shapes.js';
export * from '../lib/particles.js';
export * from '../lib/liquid.js';
export * from '../lib/text.js';
export * from '../lib/camera.js';
export * from '../lib/transitions.js';

import { COLOR, rgba, drawLockup, TAGLINES } from '../brand.js';
import { clamp, norm, span, ease } from '../lib/ease.js';
import { W, H, flash, vignette, fadeFrame } from '../lib/camera.js';
import { drawKinetic } from '../lib/text.js';

/** Beat boundaries in seconds, shared by all 25 spots. */
export const BEAT = { hook: 0, build: 8, hero: 30, lockup: 42, end: 50 };

/** Progress 0..1 through a named beat. */
export const beat = (t, name) => {
  const keys = ['hook', 'build', 'hero', 'lockup'];
  const i = keys.indexOf(name);
  const a = BEAT[keys[i]];
  const b = i === keys.length - 1 ? BEAT.end : BEAT[keys[i + 1]];
  return norm(t, a, b);
};

/**
 * The closing lockup, identical in structure across the campaign so the brand
 * sign-off is consistent: splash blooms in, wordmark writes on, tagline rules
 * out, then a soft hold.
 */
export function endCard(ctx, t, opt = {}) {
  const {
    tagline = TAGLINES[0],
    at = BEAT.lockup,
    blobColors = null,
    scale = 1,
    y = H * 0.46,
    wash = 0.82,
    washColor = COLOR.sodaDeep,
  } = opt;
  const lt = t - at;
  if (lt < 0) return;

  // Wash the frame down so the lockup always sits on a clean field.
  const w = span(lt, 0, 0.7, ease.outCubic) * wash;
  if (w > 0) {
    ctx.save();
    ctx.fillStyle = rgba(washColor, w);
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // Impact flash on the hit.
  flash(ctx, span(lt, 0, 0.22, ease.outQuad) * (1 - span(lt, 0.12, 0.5)) * 0.5, COLOR.white);

  const reveal = span(lt, 0.15, 1.5, ease.outQuart);
  const pop = 1 + 0.12 * Math.sin(clamp(span(lt, 0.1, 0.9)) * Math.PI) * (1 - span(lt, 0.9, 1.4));
  drawLockup(ctx, W / 2, y, scale * pop, t, {
    reveal,
    tagline,
    taglineAt: span(lt, 1.5, 2.6, ease.outCubic),
    blobColors,
  });
}

/**
 * Opening title beat used by several spots: a short kinetic line over the hook.
 */
export function hookLine(ctx, t, str, opt = {}) {
  const { at = 0.6, y = H * 0.24, size = 52, hold = 5, color = COLOR.white } = opt;
  const lt = t - at;
  if (lt < 0 || lt > hold + 1.2) return;
  const out = 1 - span(lt, hold, hold + 0.9, ease.inQuad);
  drawKinetic(ctx, str, W / 2, y, size, lt, {
    mode: 'rise',
    step: 0.035,
    color,
    outline: rgba(COLOR.sodaShadow, 0.55),
    tracking: 5,
    alpha: out,
  });
}

/** Standard head/tail fade every episode ends with, for clean butt-joins. */
export function frameFade(ctx, t) {
  fadeFrame(ctx, t, BEAT.end, { inDur: 0.55, outDur: 0.7, color: COLOR.night });
}

/** Common grade pass: vignette then fade. Call last in every episode. */
export function grade(ctx, t, vig = 0.4) {
  vignette(ctx, vig);
  frameFade(ctx, t);
}
