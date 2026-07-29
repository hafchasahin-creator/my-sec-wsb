/**
 * Episode 16 - "Kaleido Slices"
 *
 * Pure pattern. Orange slices, leaves and droplets mirrored through a rotating
 * kaleidoscope of 12 wedges. Hypnotic and symmetrical - the one spot with no
 * scene, no ground plane and no depth at all.
 */

import {
  W, H, COLOR, rgba, camera, bgGradient, flash, vignette,
  drawOrangeSlice, drawLeaf, drawCan, drawBlob,
  clamp, lerp, span, ease, rng,
  BEAT, endCard, hookLine, grade, drawKinetic, iris,
} from './_kit.js';

const seed = 1616;
const rand = rng(seed);

const WEDGES = 12;

// Elements laid out inside a single wedge, then mirrored around.
const ELEMS = Array.from({ length: 14 }, (_, i) => ({
  r: rand.range(90, 470),
  a: rand.range(-0.24, 0.24),
  size: rand.range(20, 62),
  spin: rand.range(-2.2, 2.2),
  orbit: rand.range(-0.32, 0.32),
  kind: i % 4,
  ph: rand.range(0, Math.PI * 2),
  at: rand.range(1, 9),
}));

export default {
  id: 'ep16',
  index: 15,
  title: 'Kaleido Slices',
  draw(ctx, t) {
    bgGradient(ctx, [
      [0, '#B84600'],
      [0.5, '#8A2E00'],
      [1, '#4A1400'],
    ]);

    // The pattern breathes: it winds tighter into the hero, then opens out.
    const wind = span(t, 8, BEAT.hero, ease.inOutCubic);
    const open = span(t, BEAT.hero, BEAT.hero + 4, ease.inOutCubic);

    camera(ctx, t, {
      zoom: lerp(1.0, 1.3, wind) * lerp(1, 0.86, open),
      rot: t * 0.05,
      seed,
    });

    ctx.save();
    ctx.translate(W / 2, H / 2);

    for (let s = 0; s < WEDGES; s++) {
      ctx.save();
      ctx.rotate((s / WEDGES) * Math.PI * 2);
      // Mirror every other wedge for true kaleidoscope symmetry.
      if (s % 2 === 1) ctx.scale(1, -1);

      for (let i = 0; i < ELEMS.length; i++) {
        const e = ELEMS[i];
        const on = span(t, e.at, e.at + 1, ease.outBack) * (1 - span(t, BEAT.lockup - 2.5, BEAT.lockup - 0.6, ease.inCubic));
        if (on <= 0) continue;
        const rr = e.r * lerp(1, 0.62, wind) * lerp(1, 1.25, open);
        const aa = e.a + Math.sin(t * 0.4 + e.ph) * 0.06 + t * e.orbit * 0.12;
        ctx.save();
        ctx.globalAlpha = on * 0.95;
        ctx.translate(Math.cos(aa) * rr, Math.sin(aa) * rr);
        ctx.rotate(t * e.spin * 0.4 + e.ph);
        ctx.scale(on, on);
        if (e.kind === 0) drawOrangeSlice(ctx, e.size, { segments: 8, detail: 1 });
        else if (e.kind === 1) drawLeaf(ctx, 0, 0, e.size * 1.7, 0);
        else if (e.kind === 2) drawBlob(ctx, 0, 0, e.size * 0.7, t, { seed: i });
        else {
          ctx.beginPath();
          ctx.arc(0, 0, e.size * 0.4, 0, Math.PI * 2);
          ctx.fillStyle = i % 2 ? COLOR.sodaGlow : COLOR.greenLight;
          ctx.fill();
        }
        ctx.restore();
      }
      ctx.restore();
    }

    // Centre medallion.
    const med = span(t, 3, 5, ease.outBack);
    if (med > 0) {
      ctx.save();
      ctx.rotate(-t * 0.22);
      ctx.scale(med, med);
      drawOrangeSlice(ctx, 96, { segments: 12, detail: 1 });
      ctx.restore();
    }
    ctx.restore();

    /* -------- the pack emerges from the centre -------- */
    const heroOn = span(t, BEAT.hero + 1, BEAT.hero + 2.6, ease.outBack);
    if (heroOn > 0) {
      ctx.save();
      ctx.translate(W / 2, H * 0.5 + 170);
      ctx.scale(heroOn, heroOn);
      drawCan(ctx, 330, { glow: 0.55 });
      ctx.restore();
      flash(ctx, span(t, BEAT.hero + 1, BEAT.hero + 1.2, ease.outQuad) * (1 - span(t, BEAT.hero + 1.15, BEAT.hero + 1.7)) * 0.6);
    }

    ctx.restore(); // camera

    vignette(ctx, 0.5, '#2A0800');

    hookLine(ctx, t, 'LOOK CLOSER', { at: 1.0, hold: 4.4, size: 54, y: H * 0.11 });

    const heroTxt = span(t, BEAT.hero + 3, BEAT.hero + 4, ease.outCubic) * (1 - span(t, BEAT.lockup - 0.8, BEAT.lockup));
    if (heroTxt > 0) {
      drawKinetic(ctx, 'ALL ORANGE, ALL ANGLES', W / 2, H * 0.1, 42, t - (BEAT.hero + 3), {
        mode: 'flip',
        step: 0.03,
        color: COLOR.white,
        outline: rgba('#4A1400', 0.8),
        tracking: 5,
        alpha: heroTxt,
      });
    }

    iris(ctx, 1 - span(t, BEAT.lockup - 0.7, BEAT.lockup, ease.inCubic), { color: COLOR.sodaDeep, invert: true });
    endCard(ctx, t, { tagline: 'ORANGE, UNMISTAKABLY' });
    grade(ctx, t, 0.24);
  },
};
