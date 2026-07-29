/**
 * Episode 08 - "Orchard Wind"
 *
 * Daylight, outdoors, no gloss. Rows of orange trees recede into a hazy sun; a
 * gust rolls through and strips leaves and fruit across frame. Painted, warm,
 * horizontal - the naturalistic spot in the campaign.
 */

import {
  W, H, COLOR, rgba, camera, bgGradient, bgHills, lightLeak, vignette,
  drawWholeOrange, drawLeaf, drawBottle, drawGlass, makeConfetti,
  clamp, lerp, span, ease, rng, noise1,
  BEAT, endCard, hookLine, grade, drawKinetic,
} from './_kit.js';

const seed = 808;
const rand = rng(seed);
const gust = noise1(seed + 1);
const leaves = makeConfetti(seed + 2, 40, {
  size: 26,
  speed: 40,
  colors: [COLOR.leaf, COLOR.greenLight, COLOR.leafDark, COLOR.sodaCore],
});

// Three depth rows of trees; nearer rows are bigger and scroll faster.
const ROWS = [0.42, 0.7, 1].map((depth, ri) =>
  Array.from({ length: 8 }, (_, i) => ({
    x: i * (300 / depth) + rand.range(-40, 40),
    depth,
    fruit: rand.int(3, 6),
    seedy: rand.range(0, 10),
    ri,
  }))
);

function tree(ctx, x, y, s, t, fruitCount, ph) {
  const swayA = Math.sin(t * 0.8 + ph) * 0.03 + (gust(t * 0.5 + ph) - 0.5) * 0.05;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(swayA);
  ctx.scale(s, s);
  // Trunk.
  ctx.fillStyle = '#6B3410';
  ctx.beginPath();
  ctx.moveTo(-14, 0);
  ctx.lineTo(-8, -120);
  ctx.lineTo(8, -120);
  ctx.lineTo(14, 0);
  ctx.closePath();
  ctx.fill();
  // Canopy: three overlapping blobs.
  for (let i = 0; i < 3; i++) {
    const a = -0.9 + i * 0.9;
    ctx.beginPath();
    ctx.ellipse(Math.cos(a) * 52, -160 + Math.sin(a) * 26, 84, 68, 0, 0, Math.PI * 2);
    ctx.fillStyle = i === 1 ? COLOR.leaf : i === 0 ? COLOR.leafDark : COLOR.greenLight;
    ctx.fill();
  }
  // Fruit hanging in the canopy.
  for (let i = 0; i < fruitCount; i++) {
    const a = (i / fruitCount) * Math.PI * 2 + ph;
    ctx.save();
    ctx.translate(Math.cos(a) * 76, -160 + Math.sin(a) * 48);
    drawWholeOrange(ctx, 17, { leaf: false, t });
    ctx.restore();
  }
  ctx.restore();
}

const T_GUST = 12.0;

export default {
  id: 'ep08',
  index: 7,
  title: 'Orchard Wind',
  draw(ctx, t) {
    bgGradient(ctx, [
      [0, '#FFD9A0'],
      [0.42, COLOR.sodaLight],
      [0.7, COLOR.orange1],
      [1, '#C86A2E'],
    ]);

    // Hazy sun.
    ctx.save();
    const sg = ctx.createRadialGradient(W * 0.74, H * 0.24, 20, W * 0.74, H * 0.24, 320);
    sg.addColorStop(0, rgba('#FFF6E0', 0.95));
    sg.addColorStop(0.3, rgba(COLOR.sodaGlow, 0.5));
    sg.addColorStop(1, rgba(COLOR.sodaGlow, 0));
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    bgHills(ctx, t * 0.25, { bands: 2, speed: 3, baseY: H * 0.62, colors: ['#D89A5C', '#B9793E'] });

    camera(ctx, t, {
      zoom: lerp(1.04, 1.24, span(t, BEAT.hero - 3, BEAT.hero + 5, ease.inOutCubic)),
      panX: -t * 6,
      fy: H * 0.6,
      seed,
    });

    /* -------- the grove -------- */
    for (const row of ROWS) {
      for (const tr of row) {
        const scroll = (t * 14 * tr.depth) % (W + 700);
        const x = ((tr.x - scroll) % (W + 700) + W + 700) % (W + 700) - 350;
        tree(ctx, x, H * (0.66 + tr.depth * 0.14), tr.depth, t, tr.fruit, tr.seedy);
      }
    }

    // Ground.
    ctx.save();
    ctx.fillStyle = '#8C5220';
    ctx.fillRect(0, H * 0.86, W, H * 0.14);
    ctx.fillStyle = rgba(COLOR.sodaGlow, 0.2);
    ctx.fillRect(0, H * 0.86, W, 5);
    ctx.restore();

    /* -------- the table setting -------- */
    const setIn = span(t, 20, 23, ease.outCubic);
    if (setIn > 0) {
      ctx.save();
      ctx.globalAlpha = setIn;
      ctx.translate(W * 0.5, H * 0.92);
      ctx.scale(setIn, setIn);
      drawGlass(ctx, 230, { fill: 0.72, ice: 2, sway: Math.sin(t * 2) * 0.02 });
      ctx.translate(-250, 0);
      drawBottle(ctx, 300, { fill: 0.86, glow: 0.2 });
      ctx.restore();
    }

    ctx.restore(); // camera

    // The gust: leaves rip across frame, driven hardest right after T_GUST.
    const wind = span(t, T_GUST, T_GUST + 1.4, ease.outCubic) * (1 - span(t, BEAT.lockup - 3, BEAT.lockup));
    ctx.save();
    ctx.translate(0, 0);
    leaves(ctx, t, 0.85 * wind);
    ctx.restore();
    // A few big foreground leaves for depth.
    for (let i = 0; i < 5; i++) {
      const p = ((t * 0.14 + i * 0.2) % 1);
      ctx.save();
      ctx.globalAlpha = 0.75 * wind * Math.sin(p * Math.PI);
      ctx.translate(lerp(-160, W + 160, p), H * (0.2 + i * 0.15) + Math.sin(t * 1.4 + i) * 60);
      ctx.rotate(t * (1.4 + i * 0.4));
      drawLeaf(ctx, 0, 0, 70, 0);
      ctx.restore();
    }

    lightLeak(ctx, t, { alpha: 0.18, speed: 0.09 });
    vignette(ctx, 0.34, '#5E2A00');

    hookLine(ctx, t, 'PICKED, NOT INVENTED', { at: 1.4, hold: 5.4, size: 48, y: H * 0.16 });

    const heroTxt = span(t, BEAT.hero + 1.4, BEAT.hero + 2.4, ease.outCubic) * (1 - span(t, BEAT.lockup - 0.8, BEAT.lockup));
    if (heroTxt > 0) {
      drawKinetic(ctx, 'TASTE THE SUNSHINE', W / 2, H * 0.14, 48, t - (BEAT.hero + 1.4), {
        mode: 'rise',
        step: 0.034,
        color: COLOR.white,
        outline: rgba('#7A3A00', 0.7),
        tracking: 6,
        alpha: heroTxt,
      });
    }

    endCard(ctx, t, { tagline: 'TASTE THE SUNSHINE', washColor: '#C86A2E' });
    grade(ctx, t, 0.3);
  },
};
