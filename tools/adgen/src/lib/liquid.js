/**
 * Liquid behaviours: pour streams, filling surfaces, running sheets and
 * free-floating droplet blobs. All are pure functions of time.
 */

import { COLOR, rgba, vGrad, blobPath } from '../brand.js';
import { clamp, lerp } from './ease.js';
import { noise1, rng } from './rng.js';

const nz = noise1(4477);

/**
 * A falling pour stream from (x0,y0) down to (x1,y1).
 * `progress` 0..1 extends the stream downward; the neck narrows as it stretches.
 */
export function drawPour(ctx, x0, y0, x1, y1, progress, t, opt = {}) {
  const p = clamp(progress);
  if (p <= 0) return;
  const { width = 26, wobble = 8, alpha = 1 } = opt;
  const yEnd = lerp(y0, y1, p);
  const steps = 26;

  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.beginPath();
  // Left edge going down.
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    const y = lerp(y0, yEnd, k);
    const x = lerp(x0, x1, k * k);
    const w = width * (1 - k * 0.42) * (1 + (nz(t * 6 + k * 5) - 0.5) * 0.25);
    const sway = Math.sin(k * 7 - t * 9) * wobble * k;
    const px = x + sway - w / 2;
    i === 0 ? ctx.moveTo(px, y) : ctx.lineTo(px, y);
  }
  // Right edge coming back up.
  for (let i = steps; i >= 0; i--) {
    const k = i / steps;
    const y = lerp(y0, yEnd, k);
    const x = lerp(x0, x1, k * k);
    const w = width * (1 - k * 0.42) * (1 + (nz(t * 6 + k * 5) - 0.5) * 0.25);
    const sway = Math.sin(k * 7 - t * 9) * wobble * k;
    ctx.lineTo(x + sway + w / 2, y);
  }
  ctx.closePath();
  const g = ctx.createLinearGradient(x0 - width, 0, x0 + width, 0);
  g.addColorStop(0, COLOR.sodaDeep);
  g.addColorStop(0.35, COLOR.sodaCore);
  g.addColorStop(0.6, COLOR.sodaLight);
  g.addColorStop(1, COLOR.sodaDeep);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
}

/**
 * An animated liquid surface line - the top of a filling volume.
 * Returns nothing; caller clips to the container first.
 */
export function surface(ctx, y, w, t, opt = {}) {
  const { amp = 6, speed = 3, color = COLOR.sodaGlow, alpha = 0.85, x = 0 } = opt;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y + 40);
  for (let px = -w / 2; px <= w / 2; px += 10) {
    ctx.lineTo(x + px, y + Math.sin(px / 42 + t * speed) * amp + Math.sin(px / 17 - t * speed * 1.6) * amp * 0.4);
  }
  ctx.lineTo(x + w / 2, y + 40);
  ctx.closePath();
  ctx.fillStyle = rgba(color, alpha);
  ctx.fill();
  ctx.restore();
}

/** A free-floating liquid blob, wobbling as if in zero gravity. */
export function drawBlob(ctx, x, y, r, t, opt = {}) {
  const { seed = 1, colors = null, highlight = true, squash = 1 } = opt;
  const [c0, c1] = colors || [COLOR.sodaLight, COLOR.sodaDeep];
  ctx.save();
  ctx.translate(x, y);
  blobPath(
    ctx,
    (a) =>
      r *
      (1 +
        0.07 * Math.sin(a * 3 + t * 1.7 + seed) +
        0.05 * Math.sin(a * 5 - t * 2.3 + seed * 2) +
        0.03 * Math.sin(a * 8 + t * 3.1 + seed * 3)),
    56,
    squash
  );
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.05, 0, 0, r * 1.15);
  g.addColorStop(0, c0);
  g.addColorStop(0.55, COLOR.sodaCore);
  g.addColorStop(1, c1);
  ctx.fillStyle = g;
  ctx.fill();
  if (highlight) {
    ctx.beginPath();
    ctx.ellipse(-r * 0.34, -r * 0.4, r * 0.24, r * 0.14, -0.6, 0, Math.PI * 2);
    ctx.fillStyle = rgba(COLOR.white, 0.6);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * A rising liquid fill that floods the frame from the bottom, with a wavy top.
 * Used as a transition and as the "flood" beat in several episodes.
 */
export function floodFill(ctx, level, t, W, H, opt = {}) {
  const p = clamp(level);
  if (p <= 0) return;
  const { amp = 22, speed = 2.4, colors = [COLOR.sodaLight, COLOR.sodaCore, COLOR.sodaDeep] } = opt;
  const y = lerp(H + amp * 2, -amp * 2, p);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, H);
  ctx.lineTo(0, y);
  for (let x = 0; x <= W; x += 12) {
    ctx.lineTo(x, y + Math.sin(x / 110 + t * speed) * amp + Math.sin(x / 43 - t * speed * 1.9) * amp * 0.45);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fillStyle = vGrad(ctx, 0, y, H, [
    [0, colors[0]],
    [0.3, colors[1]],
    [1, colors[2]],
  ]);
  ctx.fill();
  ctx.restore();
}

/**
 * Droplets clinging to and running down a vertical surface (rain-on-glass).
 * Built once from a seed - drawing must not consume RNG per frame or the
 * droplets would jump to new positions on every frame.
 */
export function makeRunlets(seed, count, W, H) {
  const r = rng(seed);
  const drops = Array.from({ length: count }, (_, i) => ({
    x: r.range(0, W),
    speed: r.range(40, 150),
    len: r.range(30, 130),
    rad: r.range(3, 8),
    off: r.range(0, 1),
  }));
  return function draw(ctx, t, alpha = 0.5) {
    if (alpha <= 0) return;
    ctx.save();
    ctx.lineCap = 'round';
    for (const d of drops) {
      const cycle = H + d.len + 60;
      const y = (((t * d.speed) / cycle + d.off) % 1) * cycle - d.len - 30;
      ctx.beginPath();
      ctx.moveTo(d.x, y);
      ctx.lineTo(d.x, y + d.len);
      ctx.lineWidth = d.rad * 0.6;
      ctx.strokeStyle = rgba(COLOR.white, alpha * 0.28);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(d.x, y + d.len, d.rad, 0, Math.PI * 2);
      ctx.fillStyle = rgba(COLOR.white, alpha * 0.5);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(d.x - d.rad * 0.3, y + d.len - d.rad * 0.3, d.rad * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = rgba(COLOR.white, alpha);
      ctx.fill();
    }
    ctx.restore();
  };
}
