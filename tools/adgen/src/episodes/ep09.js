/**
 * Episode 09 - "Sunrise Fizz"
 *
 * A single held idea: the rising sun is an orange, the orange becomes the pack.
 * Wide, slow, almost still - the calmest spot in the campaign, and the one that
 * leans hardest on a single transformation.
 */

import {
  W, H, COLOR, rgba, camera, bgGradient, bgWaves, lightLeak, vignette,
  drawWholeOrange, drawCan, makeBubbles, makeSparks,
  clamp, lerp, span, ease, rng, mixHex,
  BEAT, endCard, hookLine, grade, drawKinetic,
} from './_kit.js';

const seed = 909;
const stars = makeSparks(seed + 1, 70, { minR: 1, maxR: 2.6, twinkle: 1.2, color: '#FFE9C4' });
const fizz = makeBubbles(seed + 2, 44, { w: 240, h: 420, minR: 2, maxR: 9, speed: 62, color: COLOR.sodaGlow });

const T_RISE = 3.0;    // sun clears the horizon
const T_MORPH = 22.0;  // sun becomes the pack

export default {
  id: 'ep09',
  index: 8,
  title: 'Sunrise Fizz',
  draw(ctx, t) {
    // Night to day: every colour in the frame is interpolated on this one value.
    const dawn = span(t, T_RISE, T_RISE + 14, ease.inOutCubic);
    bgGradient(ctx, [
      [0, mixHex('#0B1030', '#FFC46B', dawn)],
      [0.36, mixHex('#2A1436', COLOR.sodaLight, dawn)],
      [0.62, mixHex('#5A1E28', COLOR.sodaCore, dawn)],
      [1, mixHex('#10060E', '#B84600', dawn)],
    ]);

    ctx.save();
    ctx.globalAlpha = 1 - dawn;
    stars(ctx, t, 0.8);
    ctx.restore();

    camera(ctx, t, {
      zoom: lerp(1.0, 1.26, span(t, T_MORPH - 2, BEAT.hero + 6, ease.inOutCubic)),
      fy: H * 0.52,
      panY: Math.sin(t * 0.1) * 10,
      seed,
    });

    /* -------- the sun -------- */
    const rise = span(t, T_RISE, T_RISE + 12, ease.outCubic);
    const sunY = lerp(H * 0.86, H * 0.44, rise);
    const morph = span(t, T_MORPH, T_MORPH + 3.2, ease.inOutCubic);
    const sunR = lerp(150, 108, morph);

    // Corona.
    ctx.save();
    const cg = ctx.createRadialGradient(W / 2, sunY, sunR * 0.7, W / 2, sunY, sunR * 4.2);
    cg.addColorStop(0, rgba(COLOR.sodaGlow, 0.7));
    cg.addColorStop(0.35, rgba(COLOR.sodaCore, 0.28));
    cg.addColorStop(1, rgba(COLOR.sodaDeep, 0));
    ctx.fillStyle = cg;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    // The sun itself, dissolving into the pack across the morph.
    if (morph < 1) {
      ctx.save();
      ctx.globalAlpha = 1 - morph;
      ctx.translate(W / 2, sunY);
      ctx.rotate(t * 0.08);
      ctx.scale(1, lerp(1, 1.3, morph));
      drawWholeOrange(ctx, sunR, { t, leaf: dawn > 0.6 });
      ctx.restore();
    }

    /* -------- the pack it becomes -------- */
    if (morph > 0) {
      ctx.save();
      ctx.globalAlpha = morph;
      ctx.translate(W / 2, sunY + lerp(0, 190, morph));
      ctx.scale(lerp(0.6, 1, morph), lerp(0.6, 1, morph));
      drawCan(ctx, 340, { glow: 0.45 * morph });
      ctx.restore();
      ctx.save();
      ctx.translate(W / 2, sunY + 190);
      fizz(ctx, t, { fade: 0.42 * morph, scale: 0.9 });
      ctx.restore();
    }

    /* -------- sea -------- */
    bgWaves(ctx, t, {
      layers: 3,
      baseY: H * 0.8,
      amp: 18,
      speed: 0.5,
      colors: [
        mixHex('#1B1030', COLOR.orange2, dawn),
        mixHex('#120A22', COLOR.orange, dawn),
        mixHex('#0A0416', COLOR.sodaDeep, dawn),
      ],
    });

    // Sun path glittering on the water.
    ctx.save();
    ctx.globalAlpha = 0.5 * rise;
    for (let i = 0; i < 22; i++) {
      const y = H * 0.8 + i * 9;
      const w = 60 + i * 16 + Math.sin(t * 2 + i) * 22;
      ctx.fillStyle = rgba(COLOR.sodaGlow, 0.35 - i * 0.012);
      ctx.fillRect(W / 2 - w / 2, y, w, 4);
    }
    ctx.restore();

    ctx.restore(); // camera

    lightLeak(ctx, t, { alpha: 0.14, speed: 0.07 });
    vignette(ctx, 0.42, mixHex('#05030F', '#5E1E00', dawn));

    hookLine(ctx, t, 'EVERY MORNING STARTS ORANGE', { at: 1.6, hold: 6.0, size: 44, y: H * 0.15 });

    const heroTxt = span(t, BEAT.hero + 1.6, BEAT.hero + 2.6, ease.outCubic) * (1 - span(t, BEAT.lockup - 0.8, BEAT.lockup));
    if (heroTxt > 0) {
      drawKinetic(ctx, 'THE SUN, BOTTLED', W / 2, H * 0.14, 50, t - (BEAT.hero + 1.6), {
        mode: 'flip',
        step: 0.05,
        color: COLOR.white,
        outline: rgba('#5E1E00', 0.7),
        tracking: 7,
        alpha: heroTxt,
      });
    }

    endCard(ctx, t, { tagline: 'TASTE THE SUNSHINE', washColor: '#A83C00' });
    grade(ctx, t, 0.26);
  },
};
