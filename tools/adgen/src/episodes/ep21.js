/**
 * Episode 21 - "Underwater Drop"
 *
 * A single drop falls into a deep tank in slow motion. It punches a crater,
 * drags a column of bubbles down with it, then everything rebounds upward and
 * the pack surfaces through the churn. Vertical, slow, weighty.
 */

import {
  W, H, COLOR, rgba, camera, bgGradient, vignette, flash,
  drawBottle, drawBlob, drawCrown, makeBubbles, makeSplash, makeFizz,
  clamp, lerp, span, ease, rng,
  BEAT, endCard, hookLine, grade, drawKinetic, floodFill,
} from './_kit.js';

const seed = 2121;
const column = makeBubbles(seed + 1, 70, { w: 260, h: 620, minR: 2, maxR: 12, speed: 70, color: COLOR.sodaGlow });
const ambient = makeBubbles(seed + 2, 50, { w: W, h: H * 1.4, minR: 2, maxR: 8, speed: 32, color: COLOR.white, alpha: 0.4 });
const crownSpray = makeSplash(seed + 3, 48, { speed: 480, aim: -Math.PI / 2, spread: Math.PI * 1.1, gravity: 900, life: 2.2, maxR: 14 });
const churn = makeFizz(seed + 4, 44, { radius: 200, rise: 220 });

const SURFACE = H * 0.36;
const T_DROP = 8.0;   // drop is released
const T_HIT = 11.5;   // impact
const T_RISE = 20.0;  // pack surfaces

export default {
  id: 'ep21',
  index: 20,
  title: 'Underwater Drop',
  draw(ctx, t) {
    bgGradient(ctx, [
      [0, '#FFCE8A'],
      [0.34, COLOR.sodaLight],
      [0.36, '#C44A00'],
      [0.72, '#8A2E00'],
      [1, '#3A1000'],
    ]);

    const boom = span(t, T_HIT, T_HIT + 0.3, ease.outQuad);
    camera(ctx, t, {
      zoom: lerp(1.06, 1.24, span(t, BEAT.hero - 2, BEAT.hero + 5, ease.inOutCubic)),
      panY: lerp(0, -40, span(t, T_HIT, T_RISE, ease.inOutCubic)),
      shake: boom * (1 - span(t, T_HIT + 0.25, T_HIT + 1.4)) * 20,
      seed,
    });

    ambient(ctx, t, { originX: W / 2, originY: H + 80, fade: 0.4 });

    // Light shafts through the surface.
    ctx.save();
    for (let i = 0; i < 6; i++) {
      const x = (i / 6) * W + Math.sin(t * 0.3 + i) * 30;
      const g = ctx.createLinearGradient(x, SURFACE, x + 80, H);
      g.addColorStop(0, rgba(COLOR.sodaGlow, 0.2));
      g.addColorStop(1, rgba(COLOR.sodaGlow, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x, SURFACE);
      ctx.lineTo(x + 70, SURFACE);
      ctx.lineTo(x + 190, H);
      ctx.lineTo(x + 40, H);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    /* -------- the falling drop -------- */
    const fall = span(t, T_DROP, T_HIT, ease.inQuad);
    if (fall > 0 && fall < 1) {
      const dy = lerp(-120, SURFACE, fall);
      const stretch = 1 + fall * 1.1;
      ctx.save();
      ctx.translate(W / 2, dy);
      ctx.scale(1 / Math.sqrt(stretch), stretch);
      drawBlob(ctx, 0, 0, 40, t, { seed: 3 });
      ctx.restore();
    }

    /* -------- the surface -------- */
    // A crater that opens on impact and closes again.
    const crater = span(t, T_HIT, T_HIT + 1.4, ease.outCubic) * (1 - span(t, T_HIT + 1.4, T_HIT + 3.4, ease.inOutCubic));
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(0, SURFACE);
    for (let x = 0; x <= W; x += 10) {
      const d = Math.abs(x - W / 2);
      const dip = crater * 150 * Math.exp(-(d * d) / 42000);
      const ripple = Math.sin(x / 60 - t * 3) * 5 + Math.sin(x / 23 + t * 4) * 2.5;
      ctx.lineTo(x, SURFACE + dip + ripple);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    const sg = ctx.createLinearGradient(0, SURFACE, 0, H);
    sg.addColorStop(0, rgba(COLOR.sodaLight, 0.95));
    sg.addColorStop(0.25, rgba(COLOR.sodaCore, 0.95));
    sg.addColorStop(1, rgba('#3A1000', 0.98));
    ctx.fillStyle = sg;
    ctx.fill();
    ctx.restore();

    /* -------- impact -------- */
    if (t >= T_HIT && t < T_HIT + 3) {
      ctx.save();
      ctx.translate(W / 2, SURFACE);
      crownSpray(ctx, t, T_HIT, { fade: 1 - span(t, T_HIT + 1.8, T_HIT + 2.8) });
      drawCrown(ctx, 150, span(t, T_HIT + 0.1, T_HIT + 1.2), 14, seed);
      ctx.restore();
      // The bubble column dragged under.
      ctx.save();
      ctx.translate(W / 2, SURFACE + 560);
      column(ctx, t, { fade: 0.8 * (1 - span(t, T_HIT + 2, T_HIT + 4)), scale: 1 });
      ctx.restore();
    }
    flash(ctx, boom * (1 - span(t, T_HIT + 0.1, T_HIT + 0.6)) * 0.55, COLOR.sodaGlow);

    /* -------- the pack surfaces -------- */
    const rise = span(t, T_RISE, T_RISE + 4, ease.inOutCubic);
    if (rise > 0) {
      const by = lerp(H + 320, H * 0.86, rise);
      ctx.save();
      ctx.translate(W / 2, by);
      ctx.rotate(Math.sin(t * 0.6) * 0.03);
      const glow = ctx.createRadialGradient(0, -180, 10, 0, -180, 340);
      glow.addColorStop(0, rgba(COLOR.sodaGlow, 0.42));
      glow.addColorStop(1, rgba(COLOR.sodaGlow, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(-360, -520, 720, 680);
      drawBottle(ctx, 350, { fill: 0.92, glow: 0.45 });
      ctx.restore();
      ctx.save();
      ctx.translate(W / 2, by - 180);
      churn(ctx, t, 0.4 * rise);
      ctx.restore();
    }

    ctx.restore(); // camera

    vignette(ctx, 0.55, '#200800');

    hookLine(ctx, t, 'ONE DROP', { at: 1.2, hold: 5.0, size: 60, y: H * 0.14 });

    const heroTxt = span(t, BEAT.hero + 1.4, BEAT.hero + 2.4, ease.outCubic) * (1 - span(t, BEAT.lockup - 0.8, BEAT.lockup));
    if (heroTxt > 0) {
      drawKinetic(ctx, 'GOES ALL THE WAY DOWN', W / 2, H * 0.12, 44, t - (BEAT.hero + 1.4), {
        mode: 'rise',
        step: 0.026,
        color: COLOR.white,
        outline: rgba('#3A1000', 0.8),
        tracking: 5,
        alpha: heroTxt,
      });
    }

    floodFill(ctx, span(t, BEAT.lockup - 0.8, BEAT.lockup, ease.inCubic), t, W, H, { amp: 24, speed: 2.4 });
    endCard(ctx, t, { tagline: 'BURSTING WITH ORANGE' });
    grade(ctx, t, 0.24);
  },
};
