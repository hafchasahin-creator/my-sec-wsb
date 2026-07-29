/**
 * Episode 23 - "Skyline Sunset"
 *
 * Golden hour on a high ledge. The camera holds wide on a city going amber
 * while a glass sweats on the parapet. Almost nothing moves except light,
 * traffic and condensation - the quietest spot in the campaign.
 */

import {
  W, H, COLOR, rgba, camera, bgGradient, vignette, lightLeak,
  drawGlass, drawBottle, makeCondensation, makeSparks, makeBubbles,
  clamp, lerp, span, ease, rng, mixHex, noise1,
  BEAT, endCard, hookLine, grade, drawKinetic,
} from './_kit.js';

const seed = 2323;
const rand = rng(seed);
const windowN = noise1(seed + 1);
const beads = makeCondensation(seed + 2, 130, 230, 54);
const airLights = makeSparks(seed + 3, 40, { minR: 1, maxR: 2.4, twinkle: 1.2, color: '#FFE9C4' });
const fizz = makeBubbles(seed + 4, 30, { w: 110, h: 220, minR: 2, maxR: 7, speed: 58 });

// Two parallax layers of towers.
const TOWERS = [0.55, 1].map((depth, li) =>
  Array.from({ length: 14 }, (_, i) => ({
    x: i * (110 / depth) + rand.range(-18, 18),
    w: rand.range(52, 98) / depth,
    h: rand.range(150, 400) / depth,
    depth,
    cols: rand.int(2, 4),
    rows: rand.int(5, 11),
    ph: rand.range(0, 20),
    li,
  }))
);

export default {
  id: 'ep23',
  index: 22,
  title: 'Skyline Sunset',
  draw(ctx, t) {
    // Sun sinks across the spot; every colour follows it down.
    const dusk = span(t, 2, 40, ease.inOutCubic);

    bgGradient(ctx, [
      [0, mixHex('#7FB8D8', '#2A1440', dusk)],
      [0.34, mixHex('#FFC46B', '#7A2A48', dusk)],
      [0.58, mixHex('#FF9A4A', '#B84600', dusk)],
      [1, mixHex('#C4661C', '#3A1000', dusk)],
    ]);

    // The sun itself.
    const sunY = lerp(H * 0.34, H * 0.62, dusk);
    ctx.save();
    const sg = ctx.createRadialGradient(W * 0.28, sunY, 20, W * 0.28, sunY, 420);
    sg.addColorStop(0, rgba('#FFF2C8', 0.95));
    sg.addColorStop(0.16, rgba(COLOR.sodaGlow, 0.7));
    sg.addColorStop(1, rgba(COLOR.sodaCore, 0));
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, W, H);
    ctx.beginPath();
    ctx.arc(W * 0.28, sunY, lerp(88, 66, dusk), 0, Math.PI * 2);
    ctx.fillStyle = rgba('#FFF6DC', 0.9);
    ctx.fill();
    ctx.restore();

    airLights(ctx, t, 0.3 * dusk);

    camera(ctx, t, {
      zoom: lerp(1.02, 1.2, span(t, BEAT.hero - 3, BEAT.hero + 5, ease.inOutCubic)),
      fx: W * 0.68,
      fy: H * 0.76,
      panX: Math.sin(t * 0.08) * 14,
      seed,
    });

    /* -------- skyline -------- */
    for (const layer of TOWERS) {
      for (const b of layer) {
        const bodyC = mixHex(
          b.depth > 0.8 ? '#8A4A22' : '#B06A34',
          b.depth > 0.8 ? '#160A18' : '#2A1228',
          dusk
        );
        ctx.save();
        ctx.fillStyle = bodyC;
        ctx.fillRect(b.x, H * 0.72 - b.h, b.w, b.h + 60);
        // Windows catching the last light, then switching on.
        for (let r = 0; r < b.rows; r++) {
          for (let c = 0; c < b.cols; c++) {
            const lit = windowN(b.ph + r * 2.1 + c * 3.3 + Math.floor(t * 0.4) * 0.7);
            const on = dusk * (lit > 0.5 ? 1 : 0);
            const glint = (1 - dusk) * 0.5;
            const a = Math.max(on * 0.85, glint);
            if (a < 0.05) continue;
            ctx.fillStyle = rgba(mixHex('#FFE9C4', '#FFC46B', on), a);
            ctx.fillRect(
              b.x + 8 + c * ((b.w - 16) / b.cols),
              H * 0.72 - b.h + 14 + r * ((b.h - 28) / b.rows),
              (b.w - 16) / b.cols - 6,
              8
            );
          }
        }
        ctx.restore();
      }
    }

    /* -------- the parapet -------- */
    ctx.save();
    ctx.fillStyle = mixHex('#8A5A34', '#1A0C12', dusk);
    ctx.fillRect(0, H * 0.82, W, H * 0.18);
    ctx.fillStyle = rgba(COLOR.sodaGlow, 0.3 * (1 - dusk * 0.5));
    ctx.fillRect(0, H * 0.82, W, 5);
    ctx.restore();

    /* -------- the drink on the ledge -------- */
    const setIn = span(t, 5, 8, ease.outCubic);
    if (setIn > 0) {
      ctx.save();
      ctx.globalAlpha = setIn;
      ctx.translate(W * 0.7, H * 0.83);
      ctx.scale(setIn, setIn);
      drawGlass(ctx, 230, { fill: 0.72, ice: 3, sway: Math.sin(t * 1.4) * 0.012 });
      ctx.save();
      ctx.translate(0, -10);
      beads(ctx, 0.55);
      ctx.restore();
      fizz(ctx, t, { originY: -40, fade: 0.35, scale: 0.7 });
      ctx.restore();
    }
    const bottleIn = span(t, 11, 14, ease.outCubic);
    if (bottleIn > 0) {
      ctx.save();
      ctx.globalAlpha = bottleIn;
      ctx.translate(W * 0.86, H * 0.83);
      ctx.scale(bottleIn, bottleIn);
      drawBottle(ctx, 300, { fill: 0.86, glow: 0.25 });
      ctx.restore();
    }

    ctx.restore(); // camera

    lightLeak(ctx, t, { alpha: 0.16 * (1 - dusk * 0.5), speed: 0.06 });
    vignette(ctx, 0.45, mixHex('#5E2A00', '#0E0616', dusk));

    hookLine(ctx, t, 'SIX FLOORS UP, END OF THE DAY', { at: 1.6, hold: 5.6, size: 42, y: H * 0.12 });

    const heroTxt = span(t, BEAT.hero + 1.6, BEAT.hero + 2.6, ease.outCubic) * (1 - span(t, BEAT.lockup - 0.8, BEAT.lockup));
    if (heroTxt > 0) {
      drawKinetic(ctx, 'STAY FOR THE LAST LIGHT', W / 2, H * 0.11, 42, t - (BEAT.hero + 1.6), {
        mode: 'rise',
        step: 0.028,
        color: COLOR.white,
        outline: rgba('#2A1028', 0.8),
        tracking: 5,
        alpha: heroTxt,
      });
    }

    endCard(ctx, t, { tagline: 'TASTE THE SUNSHINE', washColor: '#7A2A20', wash: 0.9 });
    grade(ctx, t, 0.22);
  },
};
