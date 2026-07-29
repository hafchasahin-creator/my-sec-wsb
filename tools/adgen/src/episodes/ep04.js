/**
 * Episode 04 - "Neon Nights"
 *
 * The campaign's night spot. A rain-slicked city street at 2am, a neon MIRINDA
 * sign buzzing above a shuttered kiosk, the bottle lit only by sign glow and
 * reflections. Dark palette, hard rim light - the tonal opposite of episode 01.
 */

import {
  W, H, COLOR, rgba, camera, bgGradient, vignette, lightLeak,
  drawBottle, drawWordmark, makeSparks, makeRunlets, makeBubbles,
  clamp, lerp, span, norm, ease, rng, noise1,
  BEAT, endCard, hookLine, grade, drawKinetic, drawText,
} from './_kit.js';

const seed = 404;
const rand = rng(seed);
const rain = makeRunlets(seed + 1, 70, W, H);
const cityLights = makeSparks(seed + 2, 120, { minR: 1.4, maxR: 3.6, twinkle: 2.6, color: '#FFD9A0' });
const fizz = makeBubbles(seed + 3, 26, { w: 90, h: 260, minR: 2, maxR: 6, speed: 70, color: COLOR.sodaGlow });
const flicker = noise1(seed + 4);

// Building blocks for the skyline, fixed at module load.
const BLOCKS = Array.from({ length: 16 }, (_, i) => ({
  x: i * 84 - 40,
  w: rand.range(58, 104),
  h: rand.range(120, 330),
  win: rand.int(3, 7),
}));

const T_SIGN = 5.5;   // neon strikes
const T_REVEAL = 15.0; // bottle rises into the light

export default {
  id: 'ep04',
  index: 3,
  title: 'Neon Nights',
  draw(ctx, t) {
    bgGradient(ctx, [
      [0, '#0A0410'],
      [0.5, '#1E0A16'],
      [1, '#3A1008'],
    ]);

    camera(ctx, t, {
      zoom: lerp(1.0, 1.22, span(t, BEAT.hero - 2, BEAT.hero + 5, ease.inOutCubic)),
      panX: Math.sin(t * 0.16) * 26,
      fy: H * 0.6,
      seed,
    });

    /* -------- skyline -------- */
    ctx.save();
    for (const b of BLOCKS) {
      ctx.fillStyle = '#140812';
      ctx.fillRect(b.x, H * 0.62 - b.h, b.w, b.h + 40);
      // Lit windows, individually flickering.
      for (let r = 0; r < b.win; r++) {
        for (let c = 0; c < 3; c++) {
          const on = flicker(b.x * 0.1 + r * 3.7 + c * 1.9 + Math.floor(t * 0.7) * 0.5);
          if (on < 0.45) continue;
          ctx.fillStyle = rgba('#FFC46B', 0.25 + on * 0.4);
          ctx.fillRect(b.x + 10 + c * (b.w / 3.4), H * 0.62 - b.h + 18 + r * 34, b.w / 5.4, 16);
        }
      }
    }
    ctx.restore();
    cityLights(ctx, t, 0.4);

    /* -------- wet street -------- */
    ctx.save();
    ctx.fillStyle = '#0D0508';
    ctx.fillRect(0, H * 0.62, W, H * 0.38);
    // Reflected sign glow smeared down the road.
    const sign = span(t, T_SIGN, T_SIGN + 0.6);
    const buzz = sign * (0.72 + 0.28 * flicker(t * 9));
    const g = ctx.createLinearGradient(0, H * 0.62, 0, H);
    g.addColorStop(0, rgba(COLOR.green, 0.42 * buzz));
    g.addColorStop(0.4, rgba(COLOR.sodaCore, 0.22 * buzz));
    g.addColorStop(1, rgba(COLOR.sodaDeep, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, H * 0.62, W, H * 0.38);
    ctx.restore();

    /* -------- neon sign -------- */
    if (sign > 0) {
      ctx.save();
      ctx.globalAlpha = buzz;
      ctx.translate(W / 2, H * 0.19);
      // Glow pass, then the tube itself.
      ctx.save();
      ctx.shadowColor = COLOR.greenLight;
      ctx.shadowBlur = 46;
      drawWordmark(ctx, 0, 0, 96, {
        fill: COLOR.greenLight,
        outline: rgba(COLOR.white, 0.9),
        shadow: 0,
      });
      ctx.restore();
      drawWordmark(ctx, 0, 0, 96, { fill: '#7CFFA8', outline: rgba(COLOR.white, 0.95), shadow: 0 });
      ctx.restore();

      // Sign mounting bar.
      ctx.save();
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = '#0A0508';
      ctx.fillRect(W / 2 - 300, H * 0.19 + 78, 600, 8);
      ctx.restore();
    }

    /* -------- the bottle in the light -------- */
    const rise = span(t, T_REVEAL, T_REVEAL + 2.6, ease.outCubic);
    if (rise > 0) {
      const by = lerp(H * 0.62 + 380, H * 0.8, rise);
      ctx.save();
      ctx.translate(W / 2, by);
      ctx.rotate(Math.sin(t * 0.5) * 0.02);
      // Rim light behind the pack.
      const rl = ctx.createRadialGradient(0, -170, 20, 0, -170, 300);
      rl.addColorStop(0, rgba(COLOR.sodaGlow, 0.4 * buzz));
      rl.addColorStop(1, rgba(COLOR.sodaGlow, 0));
      ctx.fillStyle = rl;
      ctx.fillRect(-320, -480, 640, 620);
      drawBottle(ctx, 330, { fill: 0.9, glow: 0.55 * buzz });
      fizz(ctx, t, { originY: -60, fade: 0.5 * rise, scale: 0.8 });
      ctx.restore();

      // Reflection on the wet road.
      ctx.save();
      ctx.globalAlpha = 0.22 * rise;
      ctx.translate(W / 2, by + 6);
      ctx.scale(1, -0.55);
      ctx.filter = 'blur(3px)';
      drawBottle(ctx, 330, { fill: 0.9, label: 0.5 });
      ctx.restore();
    }

    ctx.restore(); // camera

    rain(ctx, t, 0.42);
    lightLeak(ctx, t, { alpha: 0.08, speed: 0.1, color: COLOR.greenLight });
    vignette(ctx, 0.68, '#05010A');

    hookLine(ctx, t, 'THE CITY NEVER COOLS DOWN', { at: 1.2, hold: 4.0, size: 44, y: H * 0.14 });

    const heroTxt = span(t, BEAT.hero + 1.4, BEAT.hero + 2.4, ease.outCubic) * (1 - span(t, BEAT.lockup - 0.8, BEAT.lockup));
    if (heroTxt > 0) {
      drawKinetic(ctx, 'OPEN AFTER DARK', W / 2, H * 0.13, 46, t - (BEAT.hero + 1.4), {
        mode: 'flip',
        step: 0.05,
        color: '#7CFFA8',
        outline: rgba('#04120A', 0.8),
        tracking: 8,
        alpha: heroTxt,
      });
    }

    endCard(ctx, t, {
      tagline: 'THE TASTE IS IN MIRINDA',
      washColor: '#14060C',
      wash: 0.9,
      blobColors: [COLOR.sodaCore, '#5A1400'],
    });
    grade(ctx, t, 0.15);
  },
};
