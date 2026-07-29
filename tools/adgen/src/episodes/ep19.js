/**
 * Episode 19 - "Comet Trail"
 *
 * A can streaks across a deep starfield trailing liquid fire, loops back, and
 * parks centre frame as the trail catches up and wraps it. Fast horizontal
 * motion against a static field - the opposite staging to the still spots.
 */

import {
  W, H, COLOR, rgba, camera, bgGradient, flash, vignette,
  drawCan, drawBlob, makeSparks, makeSplash,
  clamp, lerp, span, ease, rng,
  BEAT, endCard, hookLine, grade, drawKinetic,
} from './_kit.js';

const seed = 1919;
const stars = makeSparks(seed + 1, 150, { minR: 0.8, maxR: 2.8, twinkle: 2.2, color: '#FFE9C4' });
const sparks = makeSplash(seed + 2, 40, { speed: 260, spread: Math.PI * 2, aim: 0, gravity: 0, life: 1.4, maxR: 9 });

/** The comet's path: a wide arc in, a loop, then a settle to centre. */
function cometAt(t) {
  const fly = span(t, 3, 14, ease.inOutCubic);
  const loop = span(t, 14, 24, ease.inOutCubic);
  const settle = span(t, 24, 30, ease.inOutCubic);
  // Arc across frame.
  let x = lerp(-260, W + 200, fly);
  let y = H * 0.34 + Math.sin(fly * Math.PI) * 150;
  // Loop back around.
  const la = loop * Math.PI * 2 - Math.PI / 2;
  x = lerp(x, W * 0.5 + Math.cos(la) * 320, loop);
  y = lerp(y, H * 0.46 + Math.sin(la) * 190, loop);
  // Settle to the hero mark.
  x = lerp(x, W * 0.5, settle);
  y = lerp(y, H * 0.56, settle);
  return { x, y, fly, loop, settle };
}

export default {
  id: 'ep19',
  index: 18,
  title: 'Comet Trail',
  draw(ctx, t) {
    bgGradient(ctx, [
      [0, '#08040E'],
      [0.5, '#2A0A18'],
      [1, '#4A1200'],
    ]);
    stars(ctx, t, 0.85);

    const c = cometAt(t);
    const prev = cometAt(t - 0.05);
    const vx = c.x - prev.x, vy = c.y - prev.y;
    const speed = Math.hypot(vx, vy);
    const heading = Math.atan2(vy, vx);

    camera(ctx, t, {
      zoom: lerp(1.0, 1.2, span(t, BEAT.hero - 2, BEAT.hero + 5, ease.inOutCubic)),
      panX: -(c.x - W / 2) * 0.06,
      shake: clamp(speed / 40) * 4,
      seed,
    });

    /* -------- the trail -------- */
    // Sample the path backwards in time and draw a tapering ribbon.
    const N = 34;
    ctx.save();
    for (let i = N; i > 0; i--) {
      const dt = i * 0.055;
      const p = cometAt(t - dt);
      const k = 1 - i / N;
      const r = lerp(4, 46, k) * (1 - c.settle * 0.55);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = rgba(k > 0.7 ? COLOR.sodaGlow : k > 0.4 ? COLOR.sodaCore : COLOR.sodaDeep, 0.16 + k * 0.5);
      ctx.fill();
    }
    ctx.restore();

    // Liquid globules shed off the trail.
    for (let i = 0; i < 9; i++) {
      const dt = 0.18 + i * 0.16;
      const p = cometAt(t - dt);
      ctx.save();
      ctx.globalAlpha = (1 - i / 9) * 0.7 * (1 - c.settle * 0.6);
      drawBlob(ctx, p.x + Math.sin(t * 3 + i) * 14, p.y + Math.cos(t * 2.6 + i) * 12, 10 + (9 - i) * 1.6, t, {
        seed: i,
        highlight: false,
      });
      ctx.restore();
    }

    /* -------- the can -------- */
    ctx.save();
    ctx.translate(c.x, c.y);
    // Lean into the direction of travel while moving; upright once parked.
    ctx.rotate(lerp(heading + Math.PI / 2, 0, c.settle));
    const stretch = 1 + clamp(speed / 60) * 0.35 * (1 - c.settle);
    ctx.scale(1 / Math.sqrt(stretch), stretch);
    ctx.translate(0, 160);
    drawCan(ctx, 300, { glow: 0.5 + c.settle * 0.3 });
    ctx.restore();

    // Burst as it parks.
    if (c.settle > 0.85) {
      ctx.save();
      ctx.translate(W * 0.5, H * 0.56);
      sparks(ctx, t, 29.4, { fade: 1 - span(t, 30.6, 32), gy: 0 });
      ctx.restore();
    }
    flash(ctx, span(t, 29.4, 29.6, ease.outQuad) * (1 - span(t, 29.55, 30.2)) * 0.7, COLOR.sodaGlow);

    ctx.restore(); // camera

    vignette(ctx, 0.6, '#04020A');

    hookLine(ctx, t, 'INCOMING', { at: 1.0, hold: 3.4, size: 60, y: H * 0.14 });

    const heroTxt = span(t, BEAT.hero + 1.4, BEAT.hero + 2.4, ease.outCubic) * (1 - span(t, BEAT.lockup - 0.8, BEAT.lockup));
    if (heroTxt > 0) {
      drawKinetic(ctx, 'NOTHING MOVES LIKE IT', W / 2, H * 0.13, 46, t - (BEAT.hero + 1.4), {
        mode: 'pop',
        step: 0.024,
        color: COLOR.white,
        outline: rgba('#2A0A18', 0.8),
        tracking: 5,
        alpha: heroTxt,
      });
    }

    endCard(ctx, t, { tagline: 'REAL ORANGE ENERGY', washColor: '#4A1200', wash: 0.9 });
    grade(ctx, t, 0.18);
  },
};
