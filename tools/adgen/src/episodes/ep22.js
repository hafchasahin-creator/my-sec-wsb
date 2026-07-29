/**
 * Episode 22 - "Retro Print"
 *
 * A 1970s press ad that decided to move. Halftone dots, a limited flat palette,
 * chunky rules and hard registration-offset type. Everything snaps rather than
 * eases - the only spot in the campaign with no easing on its main beats.
 */

import {
  W, H, COLOR, rgba, camera, bgStripes, vignette,
  drawBottle, drawOrangeSlice, drawWordmark,
  clamp, lerp, span, ease, rng,
  BEAT, endCard, grade, drawText, setFont,
} from './_kit.js';

const seed = 2222;
const rand = rng(seed);

const PAPER = '#F4E3C4';
const INK = '#3A1200';

/** Halftone dot field whose dot size is driven by a radial falloff. */
function halftone(ctx, cx, cy, radius, dot, color, alpha) {
  ctx.save();
  ctx.fillStyle = rgba(color, alpha);
  const step = dot * 2.1;
  for (let y = -radius; y <= radius; y += step) {
    for (let x = -radius; x <= radius; x += step) {
      const d = Math.hypot(x, y) / radius;
      if (d > 1) continue;
      const r = dot * (1 - d) * 1.4;
      if (r <= 0.3) continue;
      ctx.beginPath();
      ctx.arc(cx + x + (Math.floor(y / step) % 2) * dot, cy + y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Type with a deliberate misregistration shadow, as if the plates slipped. */
function printType(ctx, str, x, y, size, alpha, tracking = 4) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  setFont(ctx, size, { weight: 'bold', italic: true, tracking });
  ctx.fillStyle = rgba(COLOR.sodaCore, 0.85);
  ctx.fillText(str, x + size * 0.035, y + size * 0.03);
  ctx.fillStyle = INK;
  ctx.fillText(str, x, y);
  ctx.restore();
}

// Beats snap on a fixed grid - no easing anywhere in this spot.
const CARDS = [
  { at: 2.0, line: 'IT IS 1974.', size: 76 },
  { at: 5.5, line: 'THE ORANGE', size: 82 },
  { at: 8.0, line: 'HAS ARRIVED.', size: 82 },
  { at: 12.0, line: 'ASK FOR IT', size: 70 },
  { at: 15.0, line: 'BY NAME.', size: 88 },
];

export default {
  id: 'ep22',
  index: 21,
  title: 'Retro Print',
  draw(ctx, t) {
    ctx.save();
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    // The stripe field only changes on whole beats - stepped, not smooth.
    const stepT = Math.floor(t * 2) / 2;
    bgStripes(ctx, stepT, { width: 74, angle: -0.5, speed: 26, a: rgba(COLOR.sodaCore, 0.5), b: PAPER });

    camera(ctx, t, {
      zoom: 1 + Math.floor(span(t, BEAT.hero, BEAT.hero + 4) * 5) * 0.03,
      rot: 0,
      seed,
    });

    // Halftone sun.
    halftone(ctx, W * 0.5, H * 0.44, 300, 6, COLOR.sodaDeep, 0.55);

    /* -------- stacked type cards -------- */
    for (const c of CARDS) {
      const on = t >= c.at ? 1 : 0;
      const off = t >= c.at + 3.2 ? 1 : 0;
      if (!on || off) continue;
      // Type jitters one pixel on alternate frames, like a printing press.
      const j = Math.floor(t * 12) % 2 ? 1.5 : 0;
      printType(ctx, c.line, W / 2 + j, H * 0.28 + j, c.size, 1);
    }

    /* -------- the product plate -------- */
    const plate = t >= 18.5 ? 1 : 0;
    if (plate) {
      ctx.save();
      ctx.translate(W * 0.5, H * 0.94);
      // Flat, poster-style pack: no gradients, hard ink outline.
      ctx.save();
      ctx.globalAlpha = 0.9;
      drawBottle(ctx, 330, { fill: 0.9, glow: 0 });
      ctx.restore();
      ctx.restore();

      // Slices as flat print marks either side.
      for (const s of [-1, 1]) {
        ctx.save();
        ctx.translate(W / 2 + s * 330, H * 0.74);
        ctx.rotate(Math.floor(t * 3) * 0.1 * s);
        ctx.globalAlpha = 0.92;
        drawOrangeSlice(ctx, 84, { segments: 8, detail: 0, rind: INK });
        ctx.restore();
      }
    }

    /* -------- rules and the masthead -------- */
    if (t >= 20) {
      ctx.save();
      ctx.fillStyle = INK;
      ctx.fillRect(W * 0.08, H * 0.14, W * 0.84, 7);
      ctx.fillRect(W * 0.08, H * 0.62, W * 0.84, 7);
      ctx.restore();
    }
    if (t >= 22) {
      ctx.save();
      ctx.translate(W / 2, H * 0.4);
      drawWordmark(ctx, 0, 0, 120, { fill: COLOR.green, outline: PAPER, shadow: 0.2 });
      ctx.restore();
    }
    if (t >= 24) {
      drawText(ctx, 'A PRODUCT OF THE ORANGE AGE', W / 2, H * 0.55, 26, {
        color: INK,
        tracking: 9,
      });
    }

    ctx.restore(); // camera

    // Paper grain and print noise.
    ctx.save();
    ctx.globalAlpha = 0.08;
    for (let i = 0; i < 200; i++) {
      const x = ((i * 7919 + Math.floor(t * 8) * 131) % W);
      const y = ((i * 104729 + Math.floor(t * 8) * 977) % H);
      ctx.fillStyle = INK;
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.restore();
    vignette(ctx, 0.3, '#6B4A20');

    endCard(ctx, t, {
      tagline: 'THE TASTE IS IN MIRINDA',
      washColor: COLOR.orange,
      wash: 0.95,
      blobColors: [COLOR.sodaGlow, COLOR.sodaCore],
    });
    grade(ctx, t, 0.14);
  },
};
