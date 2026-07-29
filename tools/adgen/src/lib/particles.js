/**
 * Particle systems.
 *
 * These are *stateless*: every particle's position is a pure function of the
 * global time `t` and its own seeded constants. Nothing accumulates between
 * frames, so any frame can be rendered in isolation and the render is exactly
 * reproducible - which is what makes per-episode and resumable rendering safe.
 */

import { COLOR, rgba } from '../brand.js';
import { rng } from './rng.js';
import { clamp } from './ease.js';

/**
 * Rising carbonation bubbles inside a column.
 * Bubbles wrap around vertically, so the field is continuous for any t.
 */
export function makeBubbles(seed, count, opt = {}) {
  const {
    w = 300,
    h = 400,
    minR = 2,
    maxR = 9,
    speed = 60,
    wobble = 10,
    color = COLOR.white,
    alpha = 0.75,
  } = opt;
  const r = rng(seed);
  const parts = Array.from({ length: count }, () => ({
    x: r.range(-w / 2, w / 2),
    phase: r.range(0, 1),
    rad: r.range(minR, maxR),
    spd: r.range(speed * 0.6, speed * 1.4),
    wob: r.range(0.5, 1.5) * wobble,
    wsp: r.range(1.2, 3.4),
    off: r.range(0, Math.PI * 2),
  }));

  return function draw(ctx, t, opts = {}) {
    const { originX = 0, originY = 0, fade = 1, scale = 1 } = opts;
    if (fade <= 0) return;
    ctx.save();
    ctx.translate(originX, originY);
    for (const p of parts) {
      const travel = (p.phase + (t * p.spd) / h) % 1;
      const y = -travel * h;
      const x = p.x + Math.sin(travel * Math.PI * 2 * p.wsp + p.off) * p.wob;
      // Bubbles grow slightly and fade as they near the surface.
      const rr = p.rad * (0.7 + travel * 0.5) * scale;
      const a = alpha * fade * Math.sin(clamp(travel) * Math.PI) ** 0.5;
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.fillStyle = rgba(color, a * 0.35);
      ctx.fill();
      ctx.lineWidth = Math.max(0.6, rr * 0.28);
      ctx.strokeStyle = rgba(color, a);
      ctx.stroke();
      // Tiny specular dot.
      ctx.beginPath();
      ctx.arc(x - rr * 0.3, y - rr * 0.3, rr * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = rgba(COLOR.white, a * 0.9);
      ctx.fill();
    }
    ctx.restore();
  };
}

/**
 * Ballistic droplet burst launched at time `t0` from the origin.
 * Droplets stretch along their velocity vector to fake motion blur.
 */
export function makeSplash(seed, count, opt = {}) {
  const {
    speed = 520,
    spread = Math.PI,
    aim = -Math.PI / 2,
    gravity = 1500,
    life = 1.6,
    minR = 3,
    maxR = 13,
    colors = [COLOR.sodaCore, COLOR.sodaLight, COLOR.sodaDeep],
  } = opt;
  const r = rng(seed);
  const parts = Array.from({ length: count }, () => {
    const a = aim + r.range(-spread / 2, spread / 2);
    const v = speed * r.range(0.45, 1.35);
    return {
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      rad: r.range(minR, maxR),
      life: life * r.range(0.6, 1.25),
      delay: r.range(0, 0.18),
      color: r.pick(colors),
      spin: r.range(-6, 6),
    };
  });

  return function draw(ctx, t, t0 = 0, opts = {}) {
    const { fade = 1, gy = gravity, stretch = 1 } = opts;
    const local = t - t0;
    if (local < 0 || fade <= 0) return;
    ctx.save();
    for (const p of parts) {
      const lt = local - p.delay;
      if (lt < 0 || lt > p.life) continue;
      const x = p.vx * lt;
      const y = p.vy * lt + 0.5 * gy * lt * lt;
      const vy = p.vy + gy * lt;
      const spd = Math.hypot(p.vx, vy);
      const a = fade * (1 - lt / p.life);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(vy, p.vx));
      const el = 1 + Math.min(2.2, (spd / 900) * stretch);
      ctx.scale(el, 1 / Math.sqrt(el));
      ctx.beginPath();
      ctx.arc(0, 0, p.rad, 0, Math.PI * 2);
      ctx.fillStyle = rgba(p.color, a);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  };
}

/** Confetti / petal flakes drifting down the frame, wrapping vertically. */
export function makeConfetti(seed, count, opt = {}) {
  const { w = 1280, h = 720, size = 16, speed = 90, colors = null } = opt;
  const pal = colors || [COLOR.orange, COLOR.sodaLight, COLOR.green, COLOR.white, COLOR.orange4];
  const r = rng(seed);
  const parts = Array.from({ length: count }, () => ({
    x: r.range(0, w),
    phase: r.range(0, 1),
    s: size * r.range(0.5, 1.5),
    spd: speed * r.range(0.6, 1.6),
    sway: r.range(20, 70),
    ssp: r.range(0.6, 2.0),
    rot: r.range(0, Math.PI * 2),
    rsp: r.range(-3, 3),
    c: r.pick(pal),
    ratio: r.range(0.35, 1),
  }));

  return function draw(ctx, t, fade = 1) {
    if (fade <= 0) return;
    ctx.save();
    for (const p of parts) {
      const travel = (p.phase + (t * p.spd) / (h + 200)) % 1;
      const y = travel * (h + 200) - 100;
      const x = p.x + Math.sin(t * p.ssp + p.rot) * p.sway;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(p.rot + t * p.rsp);
      // Flip through zero width to fake a 3D tumble.
      ctx.scale(Math.cos(t * p.rsp * 1.3 + p.rot), 1);
      ctx.globalAlpha = fade;
      ctx.fillStyle = p.c;
      ctx.beginPath();
      ctx.roundRect(-p.s / 2, (-p.s * p.ratio) / 2, p.s, p.s * p.ratio, p.s * 0.16);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  };
}

/** Star / spark field for night and festival scenes. */
export function makeSparks(seed, count, opt = {}) {
  const { w = 1280, h = 720, minR = 1, maxR = 3.4, twinkle = 2.2, color = COLOR.white } = opt;
  const r = rng(seed);
  const parts = Array.from({ length: count }, () => ({
    x: r.range(0, w),
    y: r.range(0, h),
    rad: r.range(minR, maxR),
    ph: r.range(0, Math.PI * 2),
    sp: r.range(0.5, 1.6) * twinkle,
    drift: r.range(-8, 8),
  }));
  return function draw(ctx, t, fade = 1) {
    if (fade <= 0) return;
    ctx.save();
    for (const p of parts) {
      const a = fade * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * p.sp + p.ph)));
      ctx.beginPath();
      ctx.arc(p.x + Math.sin(t * 0.3 + p.ph) * p.drift, p.y, p.rad, 0, Math.PI * 2);
      ctx.fillStyle = rgba(color, a);
      ctx.fill();
    }
    ctx.restore();
  };
}

/** Fizz mist: tiny short-lived dots clustered around a point. */
export function makeFizz(seed, count, opt = {}) {
  const { radius = 90, rise = 120, life = 0.9, color = COLOR.white } = opt;
  const r = rng(seed);
  const parts = Array.from({ length: count }, () => ({
    a: r.range(0, Math.PI * 2),
    d: r.range(0.2, 1) * radius,
    ph: r.range(0, 1),
    rad: r.range(1, 3.6),
    sp: r.range(0.7, 1.5),
  }));
  return function draw(ctx, t, fade = 1) {
    if (fade <= 0) return;
    ctx.save();
    for (const p of parts) {
      const lt = ((t * p.sp) / life + p.ph) % 1;
      const x = Math.cos(p.a) * p.d * (0.6 + lt * 0.6);
      const y = Math.sin(p.a) * p.d * 0.4 - lt * rise;
      ctx.beginPath();
      ctx.arc(x, y, p.rad, 0, Math.PI * 2);
      ctx.fillStyle = rgba(color, fade * Math.sin(lt * Math.PI) * 0.8);
      ctx.fill();
    }
    ctx.restore();
  };
}
