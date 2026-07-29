/**
 * Episode 03 - "Citrus Burst"
 *
 * A whole orange spins up, detonates into flying segments, and the segments
 * sweep back through frame to assemble a can out of the debris. Fast, punchy,
 * built on radial motion rather than the vertical staging of episode 01.
 */

import {
  W, H, COLOR, rgba, camera, bgGradient, bgSunburst, flash,
  drawWholeOrange, drawOrangeSlice, drawCan, drawLeaf,
  makeSplash, makeConfetti,
  clamp, lerp, span, ease, rng,
  BEAT, endCard, hookLine, grade, drawKinetic, splashWipe,
} from './_kit.js';

const seed = 303;
const rand = rng(seed);
const burst = makeSplash(seed + 1, 60, { speed: 340, spread: Math.PI * 2, aim: 0, gravity: 0, life: 2.4, maxR: 16 });
const flakes = makeConfetti(seed + 2, 46, { size: 20, speed: 120 });

// Each flying segment gets its own launch angle, spin and return path. Throw
// distances are kept inside the frame so the debris field stays on screen for
// the whole hang before it funnels back in.
const SEGS = Array.from({ length: 14 }, (_, i) => ({
  a: (i / 14) * Math.PI * 2 + rand.range(-0.15, 0.15),
  dist: rand.range(180, 470),
  spin: rand.range(-7, 7),
  size: rand.range(34, 78),
  delay: rand.range(0, 0.22),
}));

const T_SPIN = 6.5;
const T_BOOM = 11.0;
const T_RETURN = 24.0;
const T_FORM = 28.5;

export default {
  id: 'ep03',
  index: 2,
  title: 'Citrus Burst',
  draw(ctx, t) {
    bgGradient(ctx, [
      [0, COLOR.orange2],
      [0.5, COLOR.sodaCore],
      [1, '#9C3200'],
    ]);
    bgSunburst(ctx, t, { rays: 26, speed: -0.22, alpha: 0.15, color: COLOR.sodaGlow });

    const boom = span(t, T_BOOM, T_BOOM + 0.35, ease.outQuad);
    camera(ctx, t, {
      zoom: lerp(1.02, 1.25, span(t, T_FORM, BEAT.hero + 6, ease.inOutCubic)) * lerp(1, 1.1, boom * (1 - span(t, T_BOOM + 0.3, T_BOOM + 1.4))),
      rot: Math.sin(t * 0.3) * 0.02,
      shake: boom * (1 - span(t, T_BOOM + 0.2, T_BOOM + 1.3)) * 22,
      seed,
    });

    const cx = W / 2;
    const cy = H * 0.52;

    /* -------- the whole orange, spinning up -------- */
    const alive = 1 - span(t, T_BOOM - 0.06, T_BOOM);
    if (alive > 0) {
      const wind = span(t, T_SPIN, T_BOOM, ease.inQuart);
      const scale = lerp(0.9, 1.28, wind) * (1 + Math.sin(t * (2 + wind * 26)) * 0.03 * wind);
      ctx.save();
      ctx.globalAlpha = alive;
      ctx.translate(cx, cy);
      ctx.rotate(wind * 26 + Math.sin(t * 0.7) * 0.1);
      ctx.scale(scale, scale);
      drawWholeOrange(ctx, 150, { t });
      ctx.restore();
    }

    /* -------- detonation -------- */
    if (t >= T_BOOM) {
      ctx.save();
      ctx.translate(cx, cy);
      burst(ctx, t, T_BOOM, { fade: 1 - span(t, T_BOOM + 1.6, T_BOOM + 3), gy: 0 });
      ctx.restore();
    }
    flash(ctx, boom * (1 - span(t, T_BOOM + 0.05, T_BOOM + 0.45)) * 0.85, COLOR.sodaGlow);

    /* -------- flying segments -------- */
    // Out on the blast, hanging in the mid-section, then funnelled back in.
    if (t >= T_BOOM) {
      const out = span(t, T_BOOM, T_BOOM + 1.3, ease.outQuart);
      const back = span(t, T_RETURN, T_FORM, ease.inOutCubic);
      for (let i = 0; i < SEGS.length; i++) {
        const s = SEGS[i];
        const drift = (t - T_BOOM) * 3;
        const d = s.dist * out * (1 - back) + drift * (1 - back);
        const a = s.a + (t - T_BOOM) * 0.12;
        const x = cx + Math.cos(a) * d;
        const y = cy + Math.sin(a) * d * 0.82;
        const sc = lerp(1, 0.25, back);
        ctx.save();
        ctx.globalAlpha = 1 - span(t, T_FORM - 0.5, T_FORM);
        ctx.translate(x, y);
        ctx.rotate((t - T_BOOM) * s.spin * (1 - back * 0.7));
        ctx.scale(sc, sc);
        // Alternate segments and leaves for variety in the debris field.
        if (i % 4 === 3) drawLeaf(ctx, 0, 0, s.size * 1.3, 0);
        else drawOrangeSlice(ctx, s.size, { segments: 9, detail: 1 });
        ctx.restore();
      }
    }

    /* -------- the can assembles -------- */
    const form = span(t, T_FORM - 0.3, T_FORM + 1.3, ease.outBack);
    if (form > 0) {
      ctx.save();
      ctx.translate(cx, cy + 170);
      ctx.scale(form, form);
      ctx.rotate((1 - form) * 0.7);
      drawCan(ctx, 340, { glow: 0.45 + span(t, BEAT.hero, BEAT.hero + 3) * 0.4 });
      ctx.restore();
    }
    flash(ctx, span(t, T_FORM, T_FORM + 0.18, ease.outQuad) * (1 - span(t, T_FORM + 0.15, T_FORM + 0.6)) * 0.7);

    ctx.restore(); // camera

    flakes(ctx, t, span(t, T_BOOM, T_BOOM + 1.5) * (1 - span(t, BEAT.lockup - 2, BEAT.lockup)) * 0.75);

    hookLine(ctx, t, 'ONE ORANGE. ALL OF IT.', { at: 1.0, hold: 4.6, size: 50 });

    const heroTxt = span(t, BEAT.hero + 1.5, BEAT.hero + 2.4, ease.outCubic) * (1 - span(t, BEAT.lockup - 0.8, BEAT.lockup));
    if (heroTxt > 0) {
      drawKinetic(ctx, 'BURSTING WITH ORANGE', W / 2, H * 0.15, 48, t - (BEAT.hero + 1.5), {
        mode: 'drop',
        step: 0.026,
        color: COLOR.white,
        outline: rgba(COLOR.sodaShadow, 0.65),
        tracking: 5,
        alpha: heroTxt,
      });
    }

    // Splash transition straight into the end card.
    splashWipe(ctx, span(t, BEAT.lockup - 0.55, BEAT.lockup, ease.inCubic), t, { color: COLOR.sodaDeep, seed: 5 });
    endCard(ctx, t, { tagline: 'BURSTING WITH ORANGE' });
    grade(ctx, t, 0.36);
  },
};
