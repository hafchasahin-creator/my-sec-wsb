/**
 * Episode 07 - "Liquid Typography"
 *
 * The spot where the words are the product. Orange liquid pools into letter
 * shapes, holds, then collapses and re-forms as the next line. Typography does
 * all the work here - there is no pack on screen until the hero.
 */

import {
  W, H, COLOR, rgba, camera, bgGradient, bgStripes, flash,
  drawBlob, drawCan, floodFill, makeSplash, makeBubbles,
  clamp, lerp, span, norm, ease, rng,
  BEAT, endCard, grade, drawKinetic, drawText, setFont,
} from './_kit.js';

const seed = 707;
const rand = rng(seed);
const drips = makeSplash(seed + 1, 34, { speed: 300, aim: Math.PI / 2, spread: 1.1, gravity: 1400, life: 1.8 });
const bubbles = makeBubbles(seed + 2, 40, { w: 300, h: 320, minR: 2, maxR: 8, speed: 90 });

// The lines that get written in liquid, each with its own dwell.
const LINES = [
  { text: 'ORANGE', at: 2.0, hold: 5.0, size: 150 },
  { text: 'IS A', at: 7.4, hold: 3.4, size: 96 },
  { text: 'FEELING', at: 11.2, hold: 5.4, size: 150 },
  { text: 'NOT A', at: 17.0, hold: 3.4, size: 96 },
  { text: 'COLOUR', at: 20.8, hold: 6.0, size: 150 },
];

/**
 * Draw a line of type as if it were poured: the glyphs are clipped to a rising
 * liquid mask, with blobs pooling at the baseline and drips falling off.
 */
function liquidLine(ctx, str, size, p, t, y) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  setFont(ctx, size, { weight: 'bold', italic: true, tracking: 3 });

  // Shadow of the full word sits behind, so the reveal reads as filling.
  ctx.save();
  ctx.globalAlpha = 0.16 * clamp(p * 3);
  ctx.fillStyle = COLOR.sodaShadow;
  ctx.fillText(str, W / 2, y);
  ctx.restore();

  // Liquid body. Rather than masking the glyphs with a separate shape, the
  // fill gradient itself carries the level: everything above `level` is
  // transparent, everything below is liquid, so the word appears to fill.
  ctx.save();
  const top = y - size * 0.62;
  const bot = y + size * 0.5;
  const level = lerp(bot + 8, top - 8, clamp(p));
  const g = ctx.createLinearGradient(0, top, 0, bot);
  const lv = clamp((bot - level) / (bot - top));
  g.addColorStop(0, rgba(COLOR.sodaLight, 0));
  g.addColorStop(Math.max(0, 1 - lv - 0.02), rgba(COLOR.sodaLight, 0));
  g.addColorStop(Math.min(1, 1 - lv + 0.001), COLOR.sodaGlow);
  g.addColorStop(Math.min(1, 1 - lv + 0.08), COLOR.sodaCore);
  g.addColorStop(1, COLOR.sodaDeep);
  ctx.fillStyle = g;
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.14;
  ctx.strokeStyle = rgba(COLOR.white, 0.85 * clamp(p * 4));
  ctx.strokeText(str, W / 2, y);
  ctx.fillText(str, W / 2, y);
  ctx.restore();
  ctx.restore();
}

export default {
  id: 'ep07',
  index: 6,
  title: 'Liquid Typography',
  draw(ctx, t) {
    bgStripes(ctx, t, { width: 96, angle: -0.42, speed: 9, a: '#C44A00', b: '#A93C00' });
    ctx.save();
    ctx.fillStyle = rgba('#7A2400', 0.45);
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    camera(ctx, t, {
      zoom: lerp(1.02, 1.16, span(t, BEAT.hero - 2, BEAT.hero + 5, ease.inOutCubic)),
      rot: Math.sin(t * 0.2) * 0.012,
      seed,
    });

    /* -------- the written lines -------- */
    for (const line of LINES) {
      const p = span(t, line.at, line.at + 1.5, ease.inOutCubic);
      const out = span(t, line.at + line.hold, line.at + line.hold + 0.8, ease.inCubic);
      if (p <= 0 || out >= 1) continue;
      const y = H * 0.48 + out * 260;
      ctx.save();
      ctx.globalAlpha = 1 - out;
      liquidLine(ctx, line.text, line.size, p, t, y);
      ctx.restore();

      // Blobs pooling under the word as it fills, and drips as it collapses.
      if (p > 0.3 && out < 0.05) {
        for (let i = 0; i < 5; i++) {
          const bx = W / 2 + (i - 2) * line.size * 0.9;
          drawBlob(ctx, bx, y + line.size * 0.56, 12 + Math.sin(t * 2 + i) * 5, t, { seed: i, highlight: false });
        }
      }
      if (out > 0 && out < 0.9) {
        ctx.save();
        ctx.translate(W / 2, y + line.size * 0.4);
        drips(ctx, out * 1.6, 0, { fade: 1 - out });
        ctx.restore();
      }
    }

    /* -------- the pack arrives out of a flood -------- */
    const flood = span(t, 27.4, 29.6, ease.inOutCubic) * (1 - span(t, BEAT.hero + 0.8, BEAT.hero + 3.2, ease.inOutCubic));
    floodFill(ctx, flood, t, W, H, { amp: 26, speed: 2.2 });

    const heroIn = span(t, BEAT.hero + 0.4, BEAT.hero + 2, ease.outBack);
    if (heroIn > 0) {
      ctx.save();
      ctx.translate(W / 2, H * 0.74);
      ctx.scale(heroIn, heroIn);
      drawCan(ctx, 330, { glow: 0.5 });
      ctx.restore();
      ctx.save();
      ctx.translate(W / 2, H * 0.74);
      bubbles(ctx, t, { fade: 0.4 * heroIn, scale: 0.8 });
      ctx.restore();
    }
    flash(ctx, span(t, BEAT.hero + 0.4, BEAT.hero + 0.6, ease.outQuad) * (1 - span(t, BEAT.hero + 0.55, BEAT.hero + 1.1)) * 0.6);

    ctx.restore(); // camera

    const heroTxt = span(t, BEAT.hero + 2.2, BEAT.hero + 3.2, ease.outCubic) * (1 - span(t, BEAT.lockup - 0.8, BEAT.lockup));
    if (heroTxt > 0) {
      drawKinetic(ctx, 'TASTE IT OUT LOUD', W / 2, H * 0.2, 50, t - (BEAT.hero + 2.2), {
        mode: 'rise',
        step: 0.03,
        color: COLOR.white,
        outline: rgba(COLOR.sodaShadow, 0.7),
        tracking: 6,
        alpha: heroTxt,
      });
    }

    endCard(ctx, t, { tagline: 'ORANGE, UNMISTAKABLY' });
    grade(ctx, t, 0.34);
  },
};
