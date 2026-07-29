/**
 * Episode 18 - "Bottle Line"
 *
 * The factory spot. A conveyor tracks left to right; empty bottles arrive, get
 * filled from overhead nozzles, get capped, get labelled, and roll out. Precise,
 * mechanical, rhythmic - motion driven by a single scrolling belt position.
 */

import {
  W, H, COLOR, rgba, camera, bgGradient, vignette, flash,
  drawBottle, drawPour, makeFizz, makeSparks,
  clamp, lerp, span, ease, rng,
  BEAT, endCard, hookLine, grade, drawKinetic,
} from './_kit.js';

const seed = 1818;
const rand = rng(seed);
const steam = makeFizz(seed + 1, 26, { radius: 60, rise: 120, color: COLOR.white });
const motes = makeSparks(seed + 2, 40, { minR: 1, maxR: 2.4, twinkle: 1.8, color: COLOR.sodaGlow });

const BELT_Y = H * 0.74;
const SPACING = 260;     // gap between bottles on the belt
const SPEED = 118;       // px per second
const NOZZLE_X = W * 0.34;
const CAP_X = W * 0.58;
const COUNT = 9;

/** Where bottle `i` is at time t, wrapping around the belt. */
function bottleX(i, t) {
  const span_ = SPACING * COUNT;
  return (((i * SPACING + t * SPEED) % span_) + span_) % span_ - SPACING * 2;
}

export default {
  id: 'ep18',
  index: 17,
  title: 'Bottle Line',
  draw(ctx, t) {
    bgGradient(ctx, [
      [0, '#2A1810'],
      [0.45, '#5A2A10'],
      [1, '#1A0C06'],
    ]);
    motes(ctx, t, 0.35);

    // Machinery silhouette overhead.
    ctx.save();
    ctx.fillStyle = '#170C08';
    ctx.fillRect(0, 0, W, H * 0.2);
    for (let i = 0; i < 9; i++) {
      ctx.fillRect(i * 150 + 30, H * 0.2, 34, 60);
    }
    ctx.restore();

    camera(ctx, t, {
      zoom: lerp(1.04, 1.3, span(t, BEAT.hero - 2, BEAT.hero + 5, ease.inOutCubic)),
      fx: lerp(W * 0.5, W * 0.72, span(t, BEAT.hero - 2, BEAT.hero + 5, ease.inOutCubic)),
      fy: BELT_Y - 100,
      seed,
    });

    /* -------- conveyor -------- */
    ctx.save();
    ctx.fillStyle = '#241410';
    ctx.fillRect(0, BELT_Y, W, 46);
    ctx.fillStyle = '#3A2018';
    // Belt slats scrolling with the same speed as the bottles.
    const slat = (t * SPEED) % 44;
    for (let x = -44; x < W + 44; x += 44) {
      ctx.fillRect(x + slat, BELT_Y + 4, 24, 38);
    }
    ctx.fillStyle = rgba(COLOR.sodaGlow, 0.25);
    ctx.fillRect(0, BELT_Y, W, 3);
    ctx.restore();

    /* -------- filling nozzles -------- */
    ctx.save();
    ctx.fillStyle = '#4A2A1C';
    ctx.fillRect(NOZZLE_X - 90, H * 0.26, 180, 40);
    for (const dx of [-45, 0, 45]) {
      ctx.fillRect(NOZZLE_X + dx - 8, H * 0.26 + 40, 16, 60);
    }
    ctx.restore();

    /* -------- the bottles -------- */
    for (let i = 0; i < COUNT; i++) {
      const x = bottleX(i, t);
      if (x < -200 || x > W + 200) continue;
      // Fill ramps up as the bottle crosses the nozzle, cap appears after CAP_X.
      const fill = clamp((x - (NOZZLE_X - 90)) / 180) * 0.9;
      const capped = x > CAP_X;
      const labelled = x > CAP_X + 150;

      ctx.save();
      ctx.translate(x, BELT_Y + 4);
      ctx.rotate(Math.sin(t * 6 + i) * 0.008);
      drawBottle(ctx, 250, {
        fill,
        label: labelled ? 1 : 0,
        cap: capped ? COLOR.green : 'rgba(0,0,0,0)',
      });
      ctx.restore();

      // Stream from the nozzle into whichever bottle is under it.
      if (Math.abs(x - NOZZLE_X) < 92) {
        const p = 1 - Math.abs(x - NOZZLE_X) / 92;
        ctx.save();
        ctx.globalAlpha = clamp(p * 2);
        drawPour(ctx, NOZZLE_X, H * 0.26 + 100, x, BELT_Y - 250 + 30, 1, t, { width: 15, wobble: 2 });
        ctx.restore();
        ctx.save();
        ctx.translate(x, BELT_Y - 240);
        steam(ctx, t, 0.4 * p);
        ctx.restore();
      }

      // Capping press stamps down as a bottle passes.
      if (Math.abs(x - CAP_X) < 60) {
        const p = 1 - Math.abs(x - CAP_X) / 60;
        ctx.save();
        ctx.fillStyle = '#6B3A24';
        ctx.fillRect(CAP_X - 26, BELT_Y - 250 - 100 + p * 74, 52, 90);
        ctx.restore();
        if (p > 0.9) flash(ctx, 0.1, COLOR.sodaGlow);
      }
    }

    /* -------- hero: one bottle rides out and turns to camera -------- */
    const heroOn = span(t, BEAT.hero - 1.5, BEAT.hero + 1.5, ease.outCubic);
    if (heroOn > 0) {
      ctx.save();
      ctx.globalAlpha = heroOn;
      ctx.translate(lerp(W + 200, W * 0.74, heroOn), BELT_Y + 4 - heroOn * 40);
      ctx.scale(lerp(1, 1.5, heroOn), lerp(1, 1.5, heroOn));
      const glow = ctx.createRadialGradient(0, -125, 10, 0, -125, 280);
      glow.addColorStop(0, rgba(COLOR.sodaGlow, 0.45));
      glow.addColorStop(1, rgba(COLOR.sodaGlow, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(-300, -420, 600, 560);
      drawBottle(ctx, 250, { fill: 0.9, glow: 0.5 });
      ctx.restore();
    }

    ctx.restore(); // camera

    vignette(ctx, 0.55, '#0E0604');

    hookLine(ctx, t, 'TWELVE THOUSAND AN HOUR', { at: 1.4, hold: 5.0, size: 44, y: H * 0.12 });

    const heroTxt = span(t, BEAT.hero + 1.8, BEAT.hero + 2.8, ease.outCubic) * (1 - span(t, BEAT.lockup - 0.8, BEAT.lockup));
    if (heroTxt > 0) {
      drawKinetic(ctx, 'EVERY ONE THE SAME ORANGE', W / 2, H * 0.1, 40, t - (BEAT.hero + 1.8), {
        mode: 'rise',
        step: 0.022,
        color: COLOR.white,
        outline: rgba('#1A0C06', 0.8),
        tracking: 4,
        alpha: heroTxt,
      });
    }

    endCard(ctx, t, { tagline: 'ORANGE, UNMISTAKABLY', washColor: '#5A2A10', wash: 0.9 });
    grade(ctx, t, 0.2);
  },
};
