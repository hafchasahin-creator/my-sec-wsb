/**
 * Episode 01 - "The Pour"
 *
 * The classic opener. An empty glass on a warm sunlit counter, the bottle
 * swings in, tips, and a cascade of orange fills the glass; the fill triggers a
 * crown splash and a rising bubble column, then the camera pushes in for the
 * hero and the lockup lands on a sunburst.
 */

import {
  W, H, COLOR, rgba, camera, bgGradient, bgSunburst, lightLeak,
  drawBottle, drawGlass, drawCrown, drawWholeOrange, makeCondensation,
  drawPour, makeBubbles, makeSplash, makeFizz,
  clamp, lerp, span, norm, ease, rng,
  BEAT, endCard, hookLine, grade,
} from './_kit.js';

const seed = 101;
const rand = rng(seed);
const bubbles = makeBubbles(seed + 1, 46, { w: 210, h: 300, minR: 2, maxR: 8, speed: 92 });
const splash = makeSplash(seed + 2, 44, { speed: 620, aim: -Math.PI / 2, spread: Math.PI * 0.95, life: 1.5 });
const splash2 = makeSplash(seed + 3, 30, { speed: 420, aim: -Math.PI / 2, spread: Math.PI * 1.2, life: 1.2, maxR: 9 });
const fizz = makeFizz(seed + 4, 34, { radius: 120, rise: 150 });
const beads = makeCondensation(seed + 5, 150, 340, 46);

const GLASS_X = W * 0.52;
const GLASS_Y = H * 0.86;
const GLASS_H = 310;

// Timings inside the spot.
const T_SWING = 9.0;   // bottle enters
const T_TIP = 12.0;    // bottle tips over the glass
const T_POUR = 13.2;   // stream starts
const T_HIT = 14.2;    // stream reaches the glass
const T_FULL = 26.0;   // glass is full
const T_LIFT = 27.5;   // bottle rights itself and lifts away

export default {
  id: 'ep01',
  index: 0,
  title: 'The Pour',
  draw(ctx, t) {
    /* ---------------- background ---------------- */
    bgGradient(ctx, [
      [0, '#8A2B00'],
      [0.34, COLOR.sodaDeep],
      [0.72, COLOR.sodaCore],
      [1, '#7A2400'],
    ]);
    bgSunburst(ctx, t, { cy: H * 0.46, rays: 20, speed: 0.07, alpha: 0.16, color: COLOR.sodaGlow });

    // Warm key light blooming behind the glass so the product separates.
    ctx.save();
    const key = ctx.createRadialGradient(GLASS_X, H * 0.58, 20, GLASS_X, H * 0.58, 430);
    key.addColorStop(0, rgba(COLOR.sodaGlow, 0.55));
    key.addColorStop(1, rgba(COLOR.sodaGlow, 0));
    ctx.fillStyle = key;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    // Counter surface.
    ctx.save();
    ctx.fillStyle = '#5E1B00';
    ctx.fillRect(0, GLASS_Y, W, H - GLASS_Y);
    ctx.fillStyle = rgba(COLOR.sodaGlow, 0.28);
    ctx.fillRect(0, GLASS_Y, W, 4);
    ctx.restore();

    /* ---------------- camera ---------------- */
    // Slow drift through the hook, a push-in for the hero, settle for the lockup.
    const push = span(t, BEAT.hero - 2, BEAT.hero + 5, ease.inOutCubic);
    const settle = span(t, BEAT.lockup - 1.5, BEAT.lockup + 0.6, ease.inOutCubic);
    const zoom = lerp(1.06, 1.34, push) * lerp(1, 0.78, settle);
    const shake = span(t, T_HIT, T_HIT + 0.5, ease.outQuad) * (1 - span(t, T_HIT + 0.2, T_HIT + 1.1)) * 9;
    camera(ctx, t, {
      zoom,
      fx: GLASS_X,
      fy: lerp(H * 0.55, GLASS_Y - GLASS_H * 0.55, push),
      panX: Math.sin(t * 0.22) * 14 * (1 - push),
      shake,
      seed,
    });

    /* ---------------- props ---------------- */
    // Oranges dressing the counter.
    ctx.save();
    ctx.translate(W * 0.16, GLASS_Y - 52);
    ctx.rotate(Math.sin(t * 0.5) * 0.03);
    drawWholeOrange(ctx, 54, { t });
    ctx.restore();
    ctx.save();
    ctx.translate(W * 0.87, GLASS_Y - 40);
    ctx.rotate(-0.2 + Math.sin(t * 0.4 + 1) * 0.03);
    drawWholeOrange(ctx, 42, { t, leaf: false });
    ctx.restore();

    /* ---------------- glass fill state ---------------- */
    const fill = span(t, T_HIT, T_FULL, ease.inOutQuad) * 0.78;
    const surfaceY = GLASS_Y - GLASS_H * fill;
    const sway = Math.sin(t * 5.5) * 0.05 * (1 - span(t, T_FULL, T_FULL + 2.5));

    ctx.save();
    ctx.translate(GLASS_X, GLASS_Y);
    drawGlass(ctx, GLASS_H, {
      fill,
      sway,
      ice: t > T_FULL - 3 ? 3 : 0,
      bubbles: fill > 0.02 ? (c, sy, wTop) => bubbles(c, t, { originY: 0, fade: 0.9, scale: 0.9 }) : null,
    });
    ctx.restore();

    /* ---------------- the bottle ---------------- */
    const BOTTLE_H = 340;
    const enter = span(t, T_SWING, T_TIP, ease.outCubic);
    const tip = span(t, T_TIP, T_POUR, ease.inOutCubic);
    const lift = span(t, T_LIFT, T_LIFT + 2.4, ease.inOutCubic);
    // Rest pose after the swing-in, and the pouring pose. The pouring pose is
    // chosen so that the mouth - base + (sin(rot), -cos(rot)) * height - lands
    // just above the glass rim. Rotation is negative so the bottle tips *into*
    // the glass rather than away from it.
    const REST_X = GLASS_X + 300, REST_Y = GLASS_Y - 250;
    const POUR_X = GLASS_X + 305, POUR_Y = GLASS_Y - 545;
    const bx = lerp(lerp(W + 340, REST_X, enter), POUR_X, tip);
    const by = lerp(REST_Y, POUR_Y, tip) - lift * 300;
    const rot =
      lerp(-0.1, -2.2, tip) * (1 - lift * 0.6) + Math.sin(t * 2.2) * 0.02 * (1 - tip);
    const mouthX = bx + Math.sin(rot) * BOTTLE_H;
    const mouthY = by - Math.cos(rot) * BOTTLE_H;

    if (enter > 0 && lift < 1) {
      ctx.save();
      ctx.globalAlpha = 1 - span(t, T_LIFT + 1.6, T_LIFT + 2.6);
      ctx.translate(bx, by);
      ctx.rotate(rot);
      drawBottle(ctx, BOTTLE_H, {
        fill: 0.88 - fill * 0.6,
        tilt: rot,
        sway: Math.sin(t * 3.1) * 0.03,
        glow: 0.35,
      });
      ctx.restore();
    }

    /* ---------------- the pour ---------------- */
    const pouring = t >= T_POUR && t < T_FULL + 0.4;
    if (pouring) {
      const p = span(t, T_POUR, T_HIT, ease.inQuad);
      const stop = 1 - span(t, T_FULL - 0.6, T_FULL + 0.4);
      ctx.save();
      ctx.globalAlpha = stop;
      // Stop the stream at the liquid surface, never below the glass base.
      drawPour(ctx, mouthX, mouthY, GLASS_X + 6, Math.min(surfaceY + 8, GLASS_Y - 14), p, t, {
        width: 34,
        wobble: 7,
      });
      ctx.restore();
    }

    /* ---------------- impact ---------------- */
    // The crown and burst belong at the liquid surface, which rises as it fills,
    // and are clipped to the glass so the splash stays inside the vessel.
    if (t >= T_HIT && t < T_HIT + 2.2) {
      const impactY = GLASS_Y - GLASS_H * (span(t, T_HIT, T_FULL, ease.inOutQuad) * 0.78);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(GLASS_X - GLASS_H * 0.2, GLASS_Y);
      ctx.lineTo(GLASS_X - GLASS_H * 0.26, GLASS_Y - GLASS_H * 1.24);
      ctx.lineTo(GLASS_X + GLASS_H * 0.26, GLASS_Y - GLASS_H * 1.24);
      ctx.lineTo(GLASS_X + GLASS_H * 0.2, GLASS_Y);
      ctx.closePath();
      ctx.clip();
      ctx.translate(GLASS_X, impactY);
      drawCrown(ctx, 72, span(t, T_HIT, T_HIT + 0.85), 13, seed);
      splash(ctx, t, T_HIT, { fade: 1 - span(t, T_HIT + 1.1, T_HIT + 2.1) });
      ctx.restore();
    }
    // Ongoing surface agitation while the glass fills.
    if (pouring && t > T_HIT) {
      ctx.save();
      ctx.translate(GLASS_X + 6, surfaceY);
      splash2(ctx, (t * 1.7) % 1.2, 0, { fade: 0.55, gy: 900 });
      fizz(ctx, t, 0.35);
      ctx.restore();
    }

    /* ---------------- hero beat ---------------- */
    const hero = span(t, BEAT.hero, BEAT.hero + 1.4, ease.outCubic);
    if (hero > 0) {
      ctx.save();
      ctx.globalAlpha = hero * (1 - span(t, BEAT.lockup - 1, BEAT.lockup));
      ctx.translate(GLASS_X, GLASS_Y);
      beads(ctx, 0.55 * hero);
      ctx.restore();
    }

    ctx.restore(); // camera

    /* ---------------- overlays ---------------- */
    lightLeak(ctx, t, { alpha: 0.13, speed: 0.14 });
    hookLine(ctx, t, 'SOME THINGS ARE WORTH THE WAIT', { at: 1.2, hold: 5.2, size: 46 });

    // Hero supers.
    const hs = span(t, BEAT.hero + 1.2, BEAT.hero + 2.2, ease.outCubic) * (1 - span(t, BEAT.lockup - 0.8, BEAT.lockup));
    if (hs > 0) {
      ctx.save();
      ctx.globalAlpha = hs;
      ctx.textAlign = 'center';
      ctx.font = 'bold 40px "Liberation Sans"';
      ctx.letterSpacing = '8px';
      ctx.fillStyle = COLOR.white;
      ctx.shadowColor = rgba(COLOR.sodaShadow, 0.6);
      ctx.shadowBlur = 16;
      ctx.lineJoin = 'round';
      ctx.lineWidth = 11;
      ctx.strokeStyle = rgba(COLOR.sodaShadow, 0.7);
      ctx.strokeText('ICE COLD. FULL ORANGE.', W / 2, H * 0.15);
      ctx.fillText('ICE COLD. FULL ORANGE.', W / 2, H * 0.15);
      ctx.restore();
    }

    endCard(ctx, t, { tagline: 'THE TASTE IS IN MIRINDA' });
    grade(ctx, t, 0.42);
  },
};
