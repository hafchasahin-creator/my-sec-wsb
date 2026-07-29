/**
 * Episode 02 - "Zero Gravity"
 *
 * A can adrift in a warm orange void. Liquid tears itself into perfect floating
 * spheres that orbit the pack and then rush back into it, snapping the frame
 * into the hero. Everything moves slowly and rotates; nothing ever falls.
 */

import {
  W, H, COLOR, rgba, camera, bgGradient, bgRings, vignette,
  drawCan, drawBlob, makeSparks, makeBubbles,
  clamp, lerp, span, ease, rng,
  BEAT, endCard, hookLine, grade, drawKinetic,
} from './_kit.js';

const seed = 202;
const rand = rng(seed);
const stars = makeSparks(seed + 1, 90, { minR: 1, maxR: 3, twinkle: 1.4, color: COLOR.sodaGlow });
const halo = makeBubbles(seed + 2, 30, { w: 420, h: 620, minR: 3, maxR: 11, speed: 26, color: COLOR.sodaGlow });

// Orbiting liquid spheres, each on its own tilted ellipse.
const ORBS = Array.from({ length: 11 }, () => ({
  a: rand.range(0, Math.PI * 2),
  rx: rand.range(170, 420),
  ry: rand.range(60, 210),
  tilt: rand.range(-0.7, 0.7),
  spd: rand.range(0.16, 0.42) * rand.sign(),
  size: rand.range(16, 46),
  depth: rand.range(0.5, 1.25),
}));

const T_GATHER = 30.5; // spheres rush home

export default {
  id: 'ep02',
  index: 1,
  title: 'Zero Gravity',
  draw(ctx, t) {
    bgGradient(ctx, [
      [0, '#2A0A00'],
      [0.45, '#7C2400'],
      [1, '#B84600'],
    ]);
    bgRings(ctx, t, { cy: H * 0.5, count: 5, period: 5.5, color: COLOR.sodaGlow, alpha: 0.09, max: 780 });
    stars(ctx, t, 0.75);

    // A very slow roll so the whole frame feels untethered.
    const push = span(t, BEAT.hero - 3, BEAT.hero + 4, ease.inOutCubic);
    camera(ctx, t, {
      zoom: lerp(0.94, 1.2, push),
      rot: Math.sin(t * 0.13) * 0.035,
      panY: Math.sin(t * 0.19) * 22,
      shake: span(t, T_GATHER + 1.2, T_GATHER + 1.5, ease.outQuad) * (1 - span(t, T_GATHER + 1.4, T_GATHER + 2.2)) * 14,
      seed,
    });

    const cx = W / 2;
    const cy = H * 0.54;

    halo(ctx, t, { originX: cx, originY: cy + 300, fade: 0.35, scale: 1 });

    /* -------- orbiting liquid spheres -------- */
    // They separate out of the can early, hold an orbit, then collapse back in.
    const emerge = span(t, 2.4, 9, ease.outCubic);
    const gather = span(t, T_GATHER, T_GATHER + 1.4, ease.inCubic);
    for (let i = 0; i < ORBS.length; i++) {
      const o = ORBS[i];
      const a = o.a + t * o.spd;
      const spread = emerge * (1 - gather);
      const ox = Math.cos(a) * o.rx * spread;
      const oy = Math.sin(a) * o.ry * spread;
      // Rotate the orbit plane so the spheres pass in front of and behind the can.
      const px = cx + ox * Math.cos(o.tilt) - oy * Math.sin(o.tilt);
      const py = cy + ox * Math.sin(o.tilt) + oy * Math.cos(o.tilt);
      const behind = Math.sin(a) < 0;
      if (behind) {
        ctx.save();
        ctx.globalAlpha = 0.55 * spread;
        drawBlob(ctx, px, py, o.size * o.depth * 0.85, t, { seed: i, highlight: false });
        ctx.restore();
      }
      o._front = !behind;
      o._px = px;
      o._py = py;
      o._spread = spread;
    }

    /* -------- the can -------- */
    const spin = t * 0.34;
    const canScale = lerp(0.85, 1.15, push) * (1 + span(t, T_GATHER + 1.2, T_GATHER + 1.6, ease.outQuad) * 0.1 * (1 - span(t, T_GATHER + 1.5, T_GATHER + 2.4)));
    ctx.save();
    ctx.translate(cx, cy + 150 + Math.sin(t * 0.6) * 26);
    ctx.rotate(Math.sin(t * 0.4) * 0.16);
    ctx.scale(canScale, canScale);
    // Squash horizontally to fake the can rotating on its axis. The floor keeps
    // the pack from ever collapsing to an unreadable sliver edge-on.
    const face = Math.cos(spin);
    ctx.save();
    ctx.scale(Math.max(0.45, Math.abs(face)), 1);
    drawCan(ctx, 320, { label: Math.max(0, face) ** 0.5, glow: 0.4 + push * 0.4 });
    ctx.restore();
    ctx.restore();

    // Spheres that belong in front of the can.
    for (let i = 0; i < ORBS.length; i++) {
      const o = ORBS[i];
      if (!o._front) continue;
      ctx.save();
      ctx.globalAlpha = o._spread;
      drawBlob(ctx, o._px, o._py, o.size * o.depth, t, { seed: i + 7 });
      ctx.restore();
    }

    ctx.restore(); // camera

    vignette(ctx, 0.5, '#1A0600');
    hookLine(ctx, t, 'NOTHING HOLDS IT DOWN', { at: 1.4, hold: 5.4, size: 48, y: H * 0.2 });

    const heroTxt = span(t, BEAT.hero + 2, BEAT.hero + 3, ease.outCubic) * (1 - span(t, BEAT.lockup - 0.8, BEAT.lockup));
    if (heroTxt > 0) {
      drawKinetic(ctx, 'WEIGHTLESS ORANGE', W / 2, H * 0.16, 46, t - (BEAT.hero + 2), {
        mode: 'pop',
        step: 0.03,
        color: COLOR.white,
        outline: rgba(COLOR.sodaShadow, 0.6),
        tracking: 6,
        alpha: heroTxt,
      });
    }

    endCard(ctx, t, { tagline: 'FULL OF LIFE', washColor: '#7C2400' });
    grade(ctx, t, 0.3);
  },
};
