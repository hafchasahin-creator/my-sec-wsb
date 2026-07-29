/**
 * Episode 12 - "Desert Cooler"
 *
 * Heat as the antagonist. Dunes shimmer under a white sun, the air visibly
 * distorts, then the pack lands and the whole frame cools: haze drops, blues
 * return, frost creeps across the glass. A temperature story, told in grade.
 */

import {
  W, H, COLOR, rgba, camera, bgGradient, bgHills, vignette, lightLeak, flash,
  drawBottle, makeCondensation, makeSparks, makeFizz,
  clamp, lerp, span, ease, rng, mixHex, noise1,
  BEAT, endCard, hookLine, grade, drawKinetic,
} from './_kit.js';

const seed = 1212;
const shimmer = noise1(seed + 1);
const sand = makeSparks(seed + 2, 50, { minR: 1, maxR: 2.4, twinkle: 2, color: '#FFE9C4' });
const frostBits = makeSparks(seed + 3, 60, { minR: 1, maxR: 3, twinkle: 3.2, color: '#DCF2FF' });
const beads = makeCondensation(seed + 4, 150, 340, 60);
const chill = makeFizz(seed + 5, 30, { radius: 180, rise: 200, color: '#DCF2FF' });

const T_LAND = 17.0;

export default {
  id: 'ep12',
  index: 11,
  title: 'Desert Cooler',
  draw(ctx, t) {
    // cool: 0 = blistering, 1 = ice cold. Drives every colour in the spot.
    const cool = span(t, T_LAND, T_LAND + 5, ease.inOutCubic);

    bgGradient(ctx, [
      [0, mixHex('#FFF0C8', '#BFE8FA', cool)],
      [0.42, mixHex('#FFC46B', '#7FC8E8', cool)],
      [0.62, mixHex('#E8913A', '#4A9CC4', cool)],
      [1, mixHex('#C4661C', '#1F5C7A', cool)],
    ]);

    // White-hot sun, softening as the frame cools.
    ctx.save();
    const sg = ctx.createRadialGradient(W * 0.5, H * 0.2, 10, W * 0.5, H * 0.2, 260);
    sg.addColorStop(0, rgba('#FFFFFF', lerp(1, 0.5, cool)));
    sg.addColorStop(0.4, rgba(mixHex('#FFE9A0', '#CDEBFA', cool), 0.6));
    sg.addColorStop(1, rgba('#FFE9A0', 0));
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    camera(ctx, t, {
      zoom: lerp(1.05, 1.24, span(t, BEAT.hero - 2, BEAT.hero + 5, ease.inOutCubic)),
      panX: Math.sin(t * 0.12) * 20,
      shake: span(t, T_LAND, T_LAND + 0.3, ease.outQuad) * (1 - span(t, T_LAND + 0.25, T_LAND + 1.2)) * 20,
      seed,
    });

    /* -------- dunes -------- */
    bgHills(ctx, t * 0.2, {
      bands: 3,
      speed: 2,
      baseY: H * 0.66,
      colors: [
        mixHex('#E8A85C', '#8CC4DC', cool * 0.5),
        mixHex('#D18A38', '#6FA8C4', cool * 0.5),
        mixHex('#A85F18', '#4A7E9C', cool * 0.5),
      ],
    });

    /* -------- heat haze -------- */
    // Horizontal slabs offset by noise - the classic cheap mirage, and it reads.
    const haze = (1 - cool) * span(t, 0.5, 3);
    if (haze > 0.01) {
      ctx.save();
      ctx.globalAlpha = 0.5 * haze;
      for (let i = 0; i < 26; i++) {
        const y = H * 0.6 + i * 5;
        const dx = (shimmer(i * 0.7 + t * 3) - 0.5) * 26 * (i / 26);
        ctx.fillStyle = rgba('#FFF6DC', 0.16);
        ctx.fillRect(dx, y, W, 3);
      }
      ctx.restore();
    }
    sand(ctx, t, 0.45 * (1 - cool));

    /* -------- the pack lands -------- */
    const drop = span(t, T_LAND - 1.1, T_LAND, ease.inQuad);
    const settle = span(t, T_LAND, T_LAND + 0.7, ease.outBounce);
    if (drop > 0) {
      const by = lerp(-320, H * 0.86, drop);
      ctx.save();
      ctx.translate(W / 2, by);
      // Squash on landing.
      const sq = 1 + (1 - settle) * 0.14 * (drop >= 1 ? 1 : 0);
      ctx.scale(sq, 1 / sq);
      drawBottle(ctx, 340, { fill: 0.9, glow: 0.3 + cool * 0.4 });
      ctx.save();
      ctx.translate(0, -20);
      beads(ctx, 0.7 * cool);
      ctx.restore();
      ctx.restore();

      // Cold radiating off the pack.
      if (cool > 0) {
        ctx.save();
        ctx.translate(W / 2, H * 0.86 - 180);
        chill(ctx, t, 0.5 * cool);
        ctx.restore();
      }

      // Impact dust ring.
      const ring = span(t, T_LAND, T_LAND + 0.9, ease.outQuart);
      if (ring > 0 && ring < 1) {
        ctx.save();
        ctx.globalAlpha = (1 - ring) * 0.6;
        ctx.strokeStyle = '#E8C48C';
        ctx.lineWidth = 10 * (1 - ring);
        ctx.beginPath();
        ctx.ellipse(W / 2, H * 0.87, 60 + ring * 320, 16 + ring * 70, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
    flash(ctx, span(t, T_LAND, T_LAND + 0.12, ease.outQuad) * (1 - span(t, T_LAND + 0.1, T_LAND + 0.6)) * 0.5, '#FFFFFF');

    ctx.restore(); // camera

    frostBits(ctx, t, 0.4 * cool);
    lightLeak(ctx, t, { alpha: 0.16 * (1 - cool * 0.6), speed: 0.08 });
    vignette(ctx, 0.36, mixHex('#7A3A00', '#0E3A50', cool));

    hookLine(ctx, t, '46 DEGREES IN THE SHADE', { at: 1.4, hold: 5.6, size: 46, y: H * 0.14 });

    const heroTxt = span(t, BEAT.hero + 1.4, BEAT.hero + 2.4, ease.outCubic) * (1 - span(t, BEAT.lockup - 0.8, BEAT.lockup));
    if (heroTxt > 0) {
      drawKinetic(ctx, 'COOLED IN SECONDS', W / 2, H * 0.13, 48, t - (BEAT.hero + 1.4), {
        mode: 'rise',
        step: 0.03,
        color: COLOR.white,
        outline: rgba('#0E3A50', 0.7),
        tracking: 6,
        alpha: heroTxt,
      });
    }

    endCard(ctx, t, { tagline: 'ICE COLD, FULL ORANGE', washColor: '#1F5C7A' });
    grade(ctx, t, 0.24);
  },
};
