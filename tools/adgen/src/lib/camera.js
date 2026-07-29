/**
 * Camera and full-frame effects: push-in, parallax, shake, vignette, light
 * leaks and the shared background painters episodes build their look on.
 */

import { COLOR, rgba, vGrad, mixHex } from '../brand.js';
import { clamp, lerp, ease, norm } from './ease.js';
import { noise1 } from './rng.js';

export const W = 1280;
export const H = 720;

/**
 * Apply a camera transform for the rest of the draw. Always paired with
 * ctx.restore() by the caller via cam(...) { ... } style usage.
 *   zoom   scale about the focal point
 *   fx,fy  focal point in frame coords
 *   panX/panY  translation in px
 *   rot    roll in radians
 *   shake  amplitude in px (deterministic noise, not random)
 */
export function camera(ctx, t, opt = {}) {
  const { zoom = 1, fx = W / 2, fy = H / 2, panX = 0, panY = 0, rot = 0, shake = 0, seed = 1 } = opt;
  ctx.save();
  ctx.translate(fx, fy);
  if (shake > 0) {
    const n = camera._n || (camera._n = noise1(9161));
    ctx.translate((n(t * 34 + seed) - 0.5) * shake * 2, (n(t * 29 + seed + 55) - 0.5) * shake * 2);
    ctx.rotate((n(t * 21 + seed + 130) - 0.5) * shake * 0.002);
  }
  ctx.rotate(rot);
  ctx.scale(zoom, zoom);
  ctx.translate(-fx + panX, -fy + panY);
}

/* ------------------------------------------------------------------ *
 * Backgrounds
 * ------------------------------------------------------------------ */

/** Flat vertical gradient wash. */
export function bgGradient(ctx, stops) {
  ctx.fillStyle = vGrad(ctx, 0, 0, H, stops);
  ctx.fillRect(0, 0, W, H);
}

/** Radial sunburst rays rotating slowly behind the action. */
export function bgSunburst(ctx, t, opt = {}) {
  const { cx = W / 2, cy = H / 2, rays = 18, speed = 0.12, color = COLOR.sodaLight, alpha = 0.22 } = opt;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(t * speed);
  ctx.fillStyle = rgba(color, alpha);
  const R = Math.hypot(W, H);
  for (let i = 0; i < rays; i++) {
    const a0 = (i / rays) * Math.PI * 2;
    const a1 = a0 + Math.PI / rays;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, R, a0, a1);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Concentric rings pulsing outward - used for beat-synced hits. */
export function bgRings(ctx, t, opt = {}) {
  const { cx = W / 2, cy = H / 2, count = 6, period = 2.4, color = COLOR.white, alpha = 0.18, max = 900 } = opt;
  ctx.save();
  ctx.lineWidth = 8;
  for (let i = 0; i < count; i++) {
    const p = ((t / period) + i / count) % 1;
    ctx.beginPath();
    ctx.arc(cx, cy, p * max, 0, Math.PI * 2);
    ctx.strokeStyle = rgba(color, alpha * (1 - p));
    ctx.stroke();
  }
  ctx.restore();
}

/** Rolling liquid waves stacked at the bottom of frame. */
export function bgWaves(ctx, t, opt = {}) {
  const { layers = 3, baseY = H * 0.7, amp = 26, speed = 0.6, colors = [COLOR.orange3, COLOR.orange, COLOR.sodaDeep] } = opt;
  ctx.save();
  for (let l = 0; l < layers; l++) {
    const y0 = baseY + l * 42;
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(0, y0);
    for (let x = 0; x <= W; x += 16) {
      const y =
        y0 +
        Math.sin(x / 180 + t * speed * (1 + l * 0.3) + l) * amp +
        Math.sin(x / 70 - t * speed * 1.7 + l * 2) * amp * 0.35;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fillStyle = colors[l % colors.length];
    ctx.fill();
  }
  ctx.restore();
}

/** Repeating diagonal stripe field - the 70s print / poster look. */
export function bgStripes(ctx, t, opt = {}) {
  const { width = 60, angle = -0.5, speed = 30, a = COLOR.orange, b = COLOR.orange2 } = opt;
  ctx.save();
  ctx.fillStyle = b;
  ctx.fillRect(0, 0, W, H);
  ctx.translate(W / 2, H / 2);
  ctx.rotate(angle);
  ctx.fillStyle = a;
  const span = Math.hypot(W, H);
  const off = (t * speed) % (width * 2);
  for (let x = -span; x < span; x += width * 2) {
    ctx.fillRect(x + off, -span, width, span * 2);
  }
  ctx.restore();
}

/** Parallax hill / skyline silhouette bands. */
export function bgHills(ctx, t, opt = {}) {
  const { bands = 3, speed = 12, baseY = H * 0.72, colors = [COLOR.orange2, COLOR.orange, COLOR.sodaDeep] } = opt;
  ctx.save();
  for (let b = 0; b < bands; b++) {
    const k = b + 1;
    const off = (t * speed * k) % (W * 0.5);
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 20) {
      const y = baseY + b * 52 - Math.abs(Math.sin((x + off) / (260 - b * 40))) * (90 - b * 22);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fillStyle = colors[b % colors.length];
    ctx.fill();
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ *
 * Full-frame grade
 * ------------------------------------------------------------------ */

export function vignette(ctx, strength = 0.45, color = COLOR.night) {
  if (strength <= 0) return;
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, H * 0.95);
  g.addColorStop(0, rgba(color, 0));
  g.addColorStop(1, rgba(color, strength));
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/** Warm diagonal light leak sweeping across frame. */
export function lightLeak(ctx, t, opt = {}) {
  const { alpha = 0.16, speed = 0.25, color = COLOR.sodaGlow } = opt;
  const p = (t * speed) % 1;
  const x = lerp(-W * 0.4, W * 1.4, p);
  const g = ctx.createLinearGradient(x - 260, 0, x + 260, H);
  g.addColorStop(0, rgba(color, 0));
  g.addColorStop(0.5, rgba(color, alpha));
  g.addColorStop(1, rgba(color, 0));
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/** Solid colour flash - one-frame impact accents. */
export function flash(ctx, amount, color = COLOR.white) {
  if (amount <= 0) return;
  ctx.save();
  ctx.fillStyle = rgba(color, clamp(amount));
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/** Fade the whole frame to a colour - used at every episode's head and tail. */
export function fadeFrame(ctx, t, duration, opt = {}) {
  const { inDur = 0.5, outDur = 0.6, color = COLOR.night } = opt;
  const a = 1 - Math.min(norm(t, 0, inDur), norm(t, duration, duration - outDur));
  if (a > 0.001) flash(ctx, a, color);
}

/** Cinematic letterbox bars. */
export function letterbox(ctx, amount = 1, height = 60) {
  if (amount <= 0) return;
  ctx.save();
  ctx.fillStyle = COLOR.night;
  const h = height * clamp(amount);
  ctx.fillRect(0, 0, W, h);
  ctx.fillRect(0, H - h, W, h);
  ctx.restore();
}
