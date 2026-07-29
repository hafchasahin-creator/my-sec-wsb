/**
 * Scene-to-scene transitions used inside episodes and between the four beats of
 * each spot. Each takes a 0..1 progress and paints over the current frame.
 */

import { COLOR, rgba, blobPath } from '../brand.js';
import { clamp, lerp, ease } from './ease.js';
import { W, H } from './camera.js';

/** Expanding organic splash that wipes the frame in a brand colour. */
export function splashWipe(ctx, p, t, opt = {}) {
  const k = clamp(p);
  if (k <= 0) return;
  const { cx = W / 2, cy = H / 2, color = COLOR.sodaCore, seed = 2 } = opt;
  const maxR = Math.hypot(W, H) * 0.75;
  const r = ease.outCubic(k) * maxR;
  ctx.save();
  ctx.translate(cx, cy);
  blobPath(
    ctx,
    (a) => r * (1 + 0.13 * Math.sin(a * 7 + seed) + 0.07 * Math.sin(a * 12 - t * 2 + seed)),
    72,
    1
  );
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

/** Circular iris in or out from a focal point. */
export function iris(ctx, p, opt = {}) {
  const k = clamp(p);
  const { cx = W / 2, cy = H / 2, color = COLOR.night, invert = false } = opt;
  const maxR = Math.hypot(W, H) * 0.6;
  const r = (invert ? k : 1 - k) * maxR;
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.arc(cx, cy, Math.max(0, r), 0, Math.PI * 2, true);
  ctx.fill('evenodd');
  ctx.restore();
}

/** Hard-edged bar wipe: `bars` vertical panels sweeping in with a stagger. */
export function barWipe(ctx, p, opt = {}) {
  const k = clamp(p);
  if (k <= 0) return;
  const { bars = 7, color = COLOR.orange, dir = 1 } = opt;
  const bw = W / bars;
  ctx.save();
  ctx.fillStyle = color;
  for (let i = 0; i < bars; i++) {
    const local = clamp((k - (i / bars) * 0.45) / 0.55);
    const h = ease.outQuart(local) * H;
    ctx.fillRect(i * bw, dir > 0 ? 0 : H - h, bw + 1, h);
  }
  ctx.restore();
}

/** An orange slice spinning outward to cover the frame. */
export function sliceWipe(ctx, p, drawSlice, opt = {}) {
  const k = clamp(p);
  if (k <= 0) return;
  const { cx = W / 2, cy = H / 2 } = opt;
  const r = ease.inCubic(k) * Math.hypot(W, H) * 0.62;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(k * Math.PI * 1.4);
  drawSlice(ctx, r);
  ctx.restore();
}

/**
 * Whip pan: horizontal streak blur suggestion, drawn as stretched colour bands.
 * `p` runs 0..1 across the whip; the frame content should also be offset by
 * whipOffset(p) for the effect to read.
 */
export function whipStreaks(ctx, p, opt = {}) {
  const k = clamp(p);
  const intensity = Math.sin(k * Math.PI);
  if (intensity <= 0.01) return;
  const { color = COLOR.sodaLight, count = 26 } = opt;
  ctx.save();
  ctx.globalAlpha = intensity * 0.55;
  for (let i = 0; i < count; i++) {
    const y = (i / count) * H + ((i * 37) % 23);
    const h = 3 + ((i * 13) % 9);
    ctx.fillStyle = rgba(i % 3 === 0 ? COLOR.white : color, 0.5);
    ctx.fillRect(0, y, W, h);
  }
  ctx.restore();
}

export function whipOffset(p, amount = W * 1.1) {
  const k = clamp(p);
  // Accelerate out, decelerate in - the frame leaves and the next one arrives.
  return k < 0.5 ? -ease.inCubic(k * 2) * amount : (1 - ease.outCubic((k - 0.5) * 2)) * amount;
}

/** Cross-fade helper: returns alpha for outgoing/incoming halves of a beat. */
export function crossFade(p) {
  const k = clamp(p);
  return { out: 1 - k, in: k };
}
