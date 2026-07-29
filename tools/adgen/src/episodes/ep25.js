/**
 * Episode 25 - "Grand Finale"
 *
 * The closer. Rapid whip-cut montage that revisits the campaign's motifs - the
 * pour, the burst, the orbit, the kaleidoscope, the neon - roughly two seconds
 * each, then everything converges on the biggest lockup in the set.
 */

import {
  W, H, COLOR, rgba, camera, bgGradient, bgSunburst, bgRings, bgStripes,
  vignette, flash, lightLeak,
  drawBottle, drawCan, drawGlass, drawOrangeSlice, drawWholeOrange, drawCrown, drawBlob, drawLeaf,
  drawPour, makeSplash, makeBubbles, makeConfetti, makeSparks,
  clamp, lerp, span, norm, ease, rng,
  BEAT, endCard, grade, drawKinetic, whipStreaks, whipOffset, splashWipe,
} from './_kit.js';

const seed = 2525;
const rand = rng(seed);
const bubbles = makeBubbles(seed + 1, 44, { w: 220, h: 320, minR: 2, maxR: 9, speed: 95 });
const burst = makeSplash(seed + 2, 54, { speed: 420, spread: Math.PI * 2, aim: 0, gravity: 300, life: 2, maxR: 14 });
const confetti = makeConfetti(seed + 3, 70, { size: 20, speed: 150 });
const sparks = makeSparks(seed + 4, 90, { minR: 1, maxR: 3, twinkle: 2.4, color: COLOR.sodaGlow });

/* ------------------------------------------------------------------ *
 * The montage: each cut is a self-contained mini-scene keyed on local time.
 * ------------------------------------------------------------------ */

const CUTS = [
  // 0 - the pour, revisited
  (ctx, u, t) => {
    bgGradient(ctx, [[0, COLOR.sodaGlow], [0.5, COLOR.sodaCore], [1, '#7A2400']]);
    bgSunburst(ctx, t, { rays: 18, speed: 0.2, alpha: 0.16 });
    ctx.save();
    ctx.translate(W / 2, H * 0.86);
    drawGlass(ctx, 300, { fill: 0.2 + u * 0.55, ice: 2, bubbles: (c) => bubbles(c, t, { fade: 0.8 }) });
    ctx.restore();
    drawPour(ctx, W / 2 + 130, H * 0.1, W / 2, H * 0.62, clamp(u * 2), t, { width: 30 });
  },
  // 1 - citrus burst
  (ctx, u, t) => {
    bgGradient(ctx, [[0, COLOR.orange2], [0.5, COLOR.sodaCore], [1, '#9C3200']]);
    bgRings(ctx, t, { count: 4, period: 1.4, alpha: 0.2, max: 800 });
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(u * 3);
    ctx.scale(1 + u * 0.4, 1 + u * 0.4);
    drawWholeOrange(ctx, 130, { t });
    ctx.restore();
    ctx.save();
    ctx.translate(W / 2, H / 2);
    burst(ctx, u * 1.6, 0, { fade: u, gy: 300 });
    ctx.restore();
  },
  // 2 - zero gravity orbit
  (ctx, u, t) => {
    bgGradient(ctx, [[0, '#2A0A00'], [0.5, '#7C2400'], [1, '#B84600']]);
    sparks(ctx, t, 0.8);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + t * 0.5;
      drawBlob(ctx, W / 2 + Math.cos(a) * 320, H / 2 + Math.sin(a) * 170, 26 + (i % 3) * 12, t, { seed: i });
    }
    ctx.save();
    ctx.translate(W / 2, H * 0.72);
    ctx.scale(Math.max(0.5, Math.abs(Math.cos(t * 0.9))), 1);
    drawCan(ctx, 300, { glow: 0.5 });
    ctx.restore();
  },
  // 3 - kaleidoscope
  (ctx, u, t) => {
    bgGradient(ctx, [[0, '#B84600'], [0.5, '#8A2E00'], [1, '#4A1400']]);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(t * 0.5);
    for (let s = 0; s < 10; s++) {
      ctx.save();
      ctx.rotate((s / 10) * Math.PI * 2);
      for (let i = 0; i < 5; i++) {
        ctx.save();
        ctx.translate(120 + i * 90, 0);
        ctx.rotate(t * (1 + i * 0.3));
        i % 2 ? drawLeaf(ctx, 0, 0, 60, 0) : drawOrangeSlice(ctx, 34 + i * 4, { segments: 8, detail: 1 });
        ctx.restore();
      }
      ctx.restore();
    }
    ctx.restore();
  },
  // 4 - neon
  (ctx, u, t) => {
    bgGradient(ctx, [[0, '#0A0410'], [0.5, '#1E0A16'], [1, '#3A1008']]);
    sparks(ctx, t, 0.5);
    ctx.save();
    ctx.translate(W / 2, H * 0.82);
    const gl = ctx.createRadialGradient(0, -200, 10, 0, -200, 360);
    gl.addColorStop(0, rgba('#7CFFA8', 0.3));
    gl.addColorStop(1, rgba('#7CFFA8', 0));
    ctx.fillStyle = gl;
    ctx.fillRect(-400, -560, 800, 700);
    drawBottle(ctx, 360, { fill: 0.92, glow: 0.6 });
    ctx.restore();
  },
  // 5 - crown splash macro
  (ctx, u, t) => {
    bgGradient(ctx, [[0, COLOR.sodaLight], [0.62, COLOR.sodaCore], [0.64, '#C44A00'], [1, '#5E1A00']]);
    ctx.save();
    ctx.fillStyle = '#C44A00';
    ctx.fillRect(0, H * 0.64, W, H * 0.36);
    ctx.translate(W / 2, H * 0.64);
    drawCrown(ctx, 240, clamp(u * 1.3), 15, 3);
    burst(ctx, u * 1.8, 0, { fade: 1 });
    ctx.restore();
  },
  // 6 - retro print
  (ctx, u, t) => {
    bgStripes(ctx, Math.floor(t * 3) / 3, { width: 70, angle: -0.5, speed: 30, a: COLOR.sodaCore, b: '#F4E3C4' });
    ctx.save();
    ctx.translate(W / 2, H * 0.92);
    drawBottle(ctx, 340, { fill: 0.9 });
    ctx.restore();
  },
];

const CUT_LEN = 2.1;
const MONTAGE_START = 1.2;
const MONTAGE_END = MONTAGE_START + CUT_LEN * CUTS.length * 2; // two passes

export default {
  id: 'ep25',
  index: 24,
  title: 'Grand Finale',
  draw(ctx, t) {
    /* -------- montage -------- */
    if (t < MONTAGE_END) {
      const lt = t - MONTAGE_START;
      const idx = Math.floor(lt / CUT_LEN);
      const u = (lt % CUT_LEN) / CUT_LEN;
      const cut = CUTS[((idx % CUTS.length) + CUTS.length) % CUTS.length];

      // Whip between cuts: the outgoing frame slides off as the next arrives.
      const whipZone = 0.14;
      const whip = u > 1 - whipZone ? (u - (1 - whipZone)) / whipZone : 0;

      ctx.save();
      camera(ctx, t, { zoom: 1.04 + u * 0.06, seed: idx });
      ctx.translate(whipOffset(whip * 0.5) * 0.7, 0);
      if (lt >= 0) cut(ctx, u, t);
      ctx.restore();
      ctx.restore(); // camera opened inside the save above

      whipStreaks(ctx, whip, { color: COLOR.sodaLight });
      // Beat flash on every cut change.
      flash(ctx, (1 - norm(u, 0, 0.1)) * 0.35, COLOR.white);
    } else {
      // Converge: everything falls into the final field.
      bgGradient(ctx, [[0, COLOR.sodaLight], [0.5, COLOR.sodaCore], [1, '#8A2E00']]);
      bgSunburst(ctx, t, { rays: 24, speed: 0.3, alpha: 0.2 });
      sparks(ctx, t, 0.6);

      const conv = span(t, MONTAGE_END, MONTAGE_END + 2.4, ease.outCubic);
      // The full product range lands in a row.
      const items = [
        (c) => drawBottle(c, 330, { fill: 0.92, glow: 0.5 }),
        (c) => drawCan(c, 300, { glow: 0.5 }),
        (c) => drawGlass(c, 260, { fill: 0.74, ice: 3 }),
      ];
      items.forEach((draw, i) => {
        const p = span(t, MONTAGE_END + i * 0.28, MONTAGE_END + 1.4 + i * 0.28, ease.outBack);
        if (p <= 0) return;
        ctx.save();
        ctx.translate(W / 2 + (i - 1) * 320, H * 0.9 + (1 - p) * 300);
        ctx.scale(p, p);
        draw(ctx);
        ctx.restore();
      });
      ctx.save();
      ctx.translate(W / 2, H * 0.72);
      bubbles(ctx, t, { fade: 0.5 * conv, scale: 1.2 });
      ctx.restore();
    }

    confetti(ctx, t, span(t, MONTAGE_END - 2, MONTAGE_END) * (1 - span(t, BEAT.lockup + 3, BEAT.lockup + 5)) * 0.8);
    lightLeak(ctx, t, { alpha: 0.14, speed: 0.2 });
    vignette(ctx, 0.4, '#3A0E00');

    const heroTxt = span(t, MONTAGE_END + 2.6, MONTAGE_END + 3.6, ease.outCubic) * (1 - span(t, BEAT.lockup - 0.8, BEAT.lockup));
    if (heroTxt > 0) {
      drawKinetic(ctx, 'TWENTY MINUTES OF ORANGE', W / 2, H * 0.15, 46, t - (MONTAGE_END + 2.6), {
        mode: 'drop',
        step: 0.022,
        color: COLOR.white,
        outline: rgba('#7A2400', 0.75),
        tracking: 5,
        alpha: heroTxt,
      });
    }

    splashWipe(ctx, span(t, BEAT.lockup - 0.6, BEAT.lockup, ease.inCubic), t, { color: COLOR.sodaDeep, seed: 4 });
    // The campaign's final lockup runs bigger and holds longer than the rest.
    endCard(ctx, t, { tagline: 'THE TASTE IS IN MIRINDA', scale: 1.14, wash: 0.92 });
    grade(ctx, t, 0.3);
  },
};
