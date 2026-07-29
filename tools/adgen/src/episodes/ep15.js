/**
 * Episode 15 - "Rain Window"
 *
 * Intimate and still. We are inside, looking through a rain-streaked window at
 * a blurred warm street; the pack sits on the sill in sharp focus. A finger
 * wipes an arc of condensation clear and the wordmark is revealed in it.
 */

import {
  W, H, COLOR, rgba, camera, bgGradient, vignette,
  drawBottle, drawGlass, drawWordmark, makeRunlets, makeSparks, makeBubbles,
  clamp, lerp, span, ease, rng, noise1,
  BEAT, endCard, hookLine, grade, drawKinetic,
} from './_kit.js';

const seed = 1515;
const rand = rng(seed);
const rainNear = makeRunlets(seed + 1, 46, W, H);
const rainFar = makeRunlets(seed + 2, 80, W, H);
const bokehN = noise1(seed + 3);
const fizz = makeBubbles(seed + 4, 26, { w: 110, h: 240, minR: 2, maxR: 6, speed: 62 });

// Out-of-focus street lights behind the glass.
const BOKEH = Array.from({ length: 22 }, () => ({
  x: rand.range(0, W),
  y: rand.range(H * 0.1, H * 0.72),
  r: rand.range(26, 78),
  c: rand.pick([COLOR.sodaGlow, COLOR.sodaCore, '#FFD9A0', COLOR.greenLight, '#FF9A4A']),
  ph: rand.range(0, 10),
}));

const T_WIPE = 22.0;

export default {
  id: 'ep15',
  index: 14,
  title: 'Rain Window',
  draw(ctx, t) {
    bgGradient(ctx, [
      [0, '#2A1608'],
      [0.5, '#5A2A0C'],
      [1, '#1A0C06'],
    ]);

    /* -------- blurred street beyond the glass -------- */
    ctx.save();
    for (const b of BOKEH) {
      const flick = 0.5 + 0.5 * bokehN(b.ph + t * 0.6);
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      g.addColorStop(0, rgba(b.c, 0.5 * flick));
      g.addColorStop(0.6, rgba(b.c, 0.18 * flick));
      g.addColorStop(1, rgba(b.c, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Far rain, soft.
    ctx.save();
    ctx.globalAlpha = 0.4;
    rainFar(ctx, t * 1.6, 0.3);
    ctx.restore();

    camera(ctx, t, {
      zoom: lerp(1.02, 1.16, span(t, BEAT.hero - 2, BEAT.hero + 5, ease.inOutCubic)),
      panX: Math.sin(t * 0.1) * 12,
      seed,
    });

    /* -------- condensation sheet -------- */
    // A misted pane, minus the arc the finger wipes clear.
    const wipe = span(t, T_WIPE, T_WIPE + 1.8, ease.inOutCubic);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    if (wipe > 0) {
      // Cut the wiped arc out of the mist.
      ctx.moveTo(W / 2 + 340 * wipe, H * 0.34);
      ctx.arc(W / 2, H * 0.34, 340 * wipe, 0, Math.PI * 2, true);
    }
    ctx.fillStyle = rgba('#D8E8F0', 0.2);
    ctx.fill('evenodd');
    ctx.restore();

    // The wordmark drawn in the cleared arc.
    if (wipe > 0.35) {
      ctx.save();
      ctx.globalAlpha = span(wipe, 0.35, 0.8);
      ctx.translate(W / 2, H * 0.32);
      drawWordmark(ctx, 0, 0, 92, {
        reveal: span(wipe, 0.4, 0.95),
        fill: rgba(COLOR.green, 0.9),
        outline: rgba(COLOR.white, 0.85),
        shadow: 0.15,
      });
      ctx.restore();
    }

    /* -------- the sill -------- */
    ctx.save();
    ctx.fillStyle = '#3A1C0A';
    ctx.fillRect(0, H * 0.78, W, H * 0.22);
    ctx.fillStyle = rgba(COLOR.sodaGlow, 0.18);
    ctx.fillRect(0, H * 0.78, W, 4);
    ctx.restore();

    /* -------- the pack in focus -------- */
    const setIn = span(t, 6, 9, ease.outCubic);
    if (setIn > 0) {
      ctx.save();
      ctx.globalAlpha = setIn;
      ctx.translate(W * 0.62, H * 0.79);
      ctx.scale(setIn, setIn);
      drawBottle(ctx, 320, { fill: 0.9, glow: 0.28 });
      ctx.restore();
      ctx.save();
      ctx.translate(W * 0.62, H * 0.79);
      fizz(ctx, t, { originY: -60, fade: 0.3 * setIn, scale: 0.7 });
      ctx.restore();
    }
    const glassIn = span(t, 10, 12.5, ease.outCubic);
    if (glassIn > 0) {
      ctx.save();
      ctx.globalAlpha = glassIn;
      ctx.translate(W * 0.36, H * 0.79);
      ctx.scale(glassIn, glassIn);
      drawGlass(ctx, 200, { fill: 0.68, ice: 2, sway: Math.sin(t * 1.6) * 0.015 });
      ctx.restore();
    }

    ctx.restore(); // camera

    // Near rain runs down the pane, in front of everything.
    rainNear(ctx, t, 0.55);

    vignette(ctx, 0.62, '#0A0402');

    hookLine(ctx, t, 'LET IT RAIN', { at: 1.4, hold: 5.0, size: 54, y: H * 0.12 });

    const heroTxt = span(t, BEAT.hero + 1.4, BEAT.hero + 2.4, ease.outCubic) * (1 - span(t, BEAT.lockup - 0.8, BEAT.lockup));
    if (heroTxt > 0) {
      drawKinetic(ctx, 'WARM INSIDE', W / 2, H * 0.1, 48, t - (BEAT.hero + 1.4), {
        mode: 'rise',
        step: 0.05,
        color: COLOR.white,
        outline: rgba('#1A0C06', 0.8),
        tracking: 8,
        alpha: heroTxt,
      });
    }

    endCard(ctx, t, { tagline: 'THE TASTE IS IN MIRINDA', washColor: '#3A1608', wash: 0.9 });
    grade(ctx, t, 0.2);
  },
};
