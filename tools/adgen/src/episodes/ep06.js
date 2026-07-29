/**
 * Episode 06 - "Bubble Kingdom"
 *
 * Shot from inside the drink. Giant translucent bubbles drift past the camera
 * in layered depth while the pack descends through them. The whole frame is
 * liquid - light shafts from above, caustics below, no horizon anywhere.
 */

import {
  W, H, COLOR, rgba, camera, bgGradient, vignette,
  drawBottle, makeBubbles, makeFizz,
  clamp, lerp, span, ease, rng, noise1,
  BEAT, endCard, hookLine, grade, drawKinetic,
} from './_kit.js';

const seed = 606;
const rand = rng(seed);
const micro = makeBubbles(seed + 1, 90, { w: W * 1.2, h: H * 1.5, minR: 2, maxR: 9, speed: 55, color: COLOR.sodaGlow, alpha: 0.5 });
const fizz = makeFizz(seed + 2, 40, { radius: 240, rise: 260 });
const caustic = noise1(seed + 3);

// Three depth layers of large bubbles, each with its own scale and speed.
const LAYERS = [0.45, 0.75, 1.15].map((depth, li) =>
  Array.from({ length: 9 }, () => ({
    x: rand.range(-100, W + 100),
    phase: rand.range(0, 1),
    r: rand.range(48, 130) * depth,
    spd: rand.range(24, 52) * depth,
    sway: rand.range(20, 70),
    ssp: rand.range(0.3, 0.9),
    depth,
    li,
  }))
);

function bigBubble(ctx, x, y, r, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.05, x, y, r);
  g.addColorStop(0, rgba(COLOR.white, 0.3));
  g.addColorStop(0.72, rgba(COLOR.sodaGlow, 0.08));
  g.addColorStop(0.94, rgba(COLOR.white, 0.28));
  g.addColorStop(1, rgba(COLOR.white, 0.06));
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.035);
  ctx.strokeStyle = rgba(COLOR.white, 0.5 * alpha);
  ctx.stroke();
  // Twin speculars sell the sphere.
  ctx.beginPath();
  ctx.ellipse(x - r * 0.36, y - r * 0.4, r * 0.2, r * 0.12, -0.7, 0, Math.PI * 2);
  ctx.fillStyle = rgba(COLOR.white, 0.8 * alpha);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + r * 0.42, y + r * 0.38, r * 0.07, 0, Math.PI * 2);
  ctx.fillStyle = rgba(COLOR.white, 0.5 * alpha);
  ctx.fill();
  ctx.restore();
}

const T_DESCEND = 10.0;

export default {
  id: 'ep06',
  index: 5,
  title: 'Bubble Kingdom',
  draw(ctx, t) {
    bgGradient(ctx, [
      [0, '#FFB347'],
      [0.28, COLOR.sodaCore],
      [0.72, '#C44A00'],
      [1, '#5E1E00'],
    ]);

    // Light shafts raking down from the surface.
    ctx.save();
    for (let i = 0; i < 7; i++) {
      const x = (i / 7) * W + Math.sin(t * 0.25 + i) * 40;
      const wdt = 60 + caustic(i * 3 + t * 0.4) * 90;
      const g = ctx.createLinearGradient(x, 0, x + wdt * 0.6, H);
      g.addColorStop(0, rgba(COLOR.sodaGlow, 0.22));
      g.addColorStop(1, rgba(COLOR.sodaGlow, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + wdt, 0);
      ctx.lineTo(x + wdt * 2.2, H);
      ctx.lineTo(x + wdt * 0.6, H);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    camera(ctx, t, {
      zoom: lerp(1.0, 1.18, span(t, BEAT.hero - 3, BEAT.hero + 5, ease.inOutCubic)),
      panX: Math.sin(t * 0.17) * 30,
      panY: Math.cos(t * 0.13) * 20,
      rot: Math.sin(t * 0.1) * 0.02,
      seed,
    });

    micro(ctx, t, { originX: W / 2, originY: H + 60, fade: 0.6 });

    // Back layers of bubbles.
    for (const layer of LAYERS.slice(0, 2)) {
      for (const b of layer) {
        const travel = (b.phase + (t * b.spd) / (H + 400)) % 1;
        const y = H + 200 - travel * (H + 400);
        bigBubble(ctx, b.x + Math.sin(t * b.ssp + b.phase * 9) * b.sway, y, b.r, 0.5 * b.depth);
      }
    }

    /* -------- the pack descending -------- */
    const descend = span(t, T_DESCEND, BEAT.hero + 2, ease.inOutCubic);
    const by = lerp(-260, H * 0.72, descend);
    ctx.save();
    ctx.translate(W / 2, by);
    ctx.rotate(Math.sin(t * 0.5) * 0.06 + (1 - descend) * 0.3);
    const glow = ctx.createRadialGradient(0, -170, 20, 0, -170, 360);
    glow.addColorStop(0, rgba(COLOR.sodaGlow, 0.42));
    glow.addColorStop(1, rgba(COLOR.sodaGlow, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(-380, -540, 760, 720);
    drawBottle(ctx, 340, { fill: 0.9, glow: 0.4 });
    ctx.restore();

    // Bubble trail streaming off the pack.
    ctx.save();
    ctx.translate(W / 2, by - 160);
    fizz(ctx, t, 0.4 * descend);
    ctx.restore();

    // Front layer passes in front of the pack for real depth.
    for (const b of LAYERS[2]) {
      const travel = (b.phase + (t * b.spd) / (H + 400)) % 1;
      const y = H + 200 - travel * (H + 400);
      bigBubble(ctx, b.x + Math.sin(t * b.ssp + b.phase * 9) * b.sway, y, b.r, 0.45);
    }

    ctx.restore(); // camera

    vignette(ctx, 0.5, '#3A0E00');
    hookLine(ctx, t, 'DIVE INTO THE FIZZ', { at: 1.3, hold: 5.2, size: 50, y: H * 0.18 });

    const heroTxt = span(t, BEAT.hero + 1.6, BEAT.hero + 2.6, ease.outCubic) * (1 - span(t, BEAT.lockup - 0.8, BEAT.lockup));
    if (heroTxt > 0) {
      drawKinetic(ctx, 'A WHOLE WORLD OF BUBBLES', W / 2, H * 0.13, 42, t - (BEAT.hero + 1.6), {
        mode: 'wave',
        color: COLOR.white,
        outline: rgba('#5E1E00', 0.7),
        tracking: 4,
        alpha: heroTxt,
      });
    }

    endCard(ctx, t, { tagline: 'FULL OF LIFE', washColor: '#8A2E00' });
    grade(ctx, t, 0.28);
  },
};
