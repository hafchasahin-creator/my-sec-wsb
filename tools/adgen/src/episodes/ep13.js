/**
 * Episode 13 - "Paper-Cut Orange"
 *
 * A craft-style spot: every element is a flat paper shape with a hard drop
 * shadow, sliding on and off in layers as if a hand were assembling a
 * papercraft set. No gradients on the props, no glow - the flattest look in the
 * campaign, and deliberately so.
 */

import {
  W, H, COLOR, rgba, camera, vignette,
  drawLeaf, clamp, lerp, span, ease, rng, stagger,
  BEAT, endCard, hookLine, grade, drawKinetic, drawText,
} from './_kit.js';

const seed = 1313;
const rand = rng(seed);

/** Flat shape with the offset shadow that sells the paper look. */
function paper(ctx, draw, color, dx = 10, dy = 12) {
  ctx.save();
  ctx.translate(dx, dy);
  ctx.fillStyle = rgba('#7A2400', 0.32);
  draw(ctx);
  ctx.restore();
  ctx.save();
  ctx.fillStyle = color;
  draw(ctx);
  ctx.restore();
}

const circle = (r) => (c) => {
  c.beginPath();
  c.arc(0, 0, r, 0, Math.PI * 2);
  c.fill();
};

const roundRect = (w, h, r) => (c) => {
  c.beginPath();
  c.roundRect(-w / 2, -h, w, h, r);
  c.fill();
};

/** Paper orange: stacked rings plus cut-paper segments. */
function paperOrange(ctx, r, spin) {
  paper(ctx, circle(r), COLOR.sodaDeep);
  ctx.save();
  ctx.fillStyle = COLOR.orange5;
  circle(r * 0.9)(ctx);
  ctx.rotate(spin);
  for (let i = 0; i < 8; i++) {
    ctx.save();
    ctx.rotate((i / 8) * Math.PI * 2);
    ctx.fillStyle = i % 2 ? COLOR.sodaCore : COLOR.sodaLight;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r * 0.8, -0.34, 0.34);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = COLOR.cream;
  circle(r * 0.11)(ctx);
  ctx.restore();
}

/** Paper bottle built from three flat blocks. */
function paperBottle(ctx, h) {
  const w = h * 0.3;
  paper(ctx, roundRect(w, h * 0.78, w * 0.16), COLOR.sodaCore);
  paper(ctx, (c) => {
    c.beginPath();
    c.roundRect(-h * 0.055, -h, h * 0.11, h * 0.26, h * 0.02);
    c.fill();
  }, COLOR.orange1);
  paper(ctx, (c) => {
    c.beginPath();
    c.roundRect(-h * 0.07, -h - h * 0.02, h * 0.14, h * 0.1, h * 0.015);
    c.fill();
  }, COLOR.green, 8, 9);
  // Label band.
  ctx.save();
  ctx.fillStyle = COLOR.cream;
  ctx.fillRect(-w / 2, -h * 0.56, w, h * 0.2);
  ctx.fillStyle = COLOR.green;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `italic bold ${h * 0.07}px "Liberation Sans"`;
  ctx.fillText('MIRINDA', 0, -h * 0.46);
  ctx.restore();
}

// Background paper bands that slide in one after another.
const BANDS = [
  { y: 0.0, h: 0.32, c: COLOR.orange2, at: 0.4 },
  { y: 0.32, h: 0.2, c: COLOR.orange, at: 0.7 },
  { y: 0.52, h: 0.18, c: COLOR.sodaCore, at: 1.0 },
  { y: 0.7, h: 0.3, c: COLOR.sodaDeep, at: 1.3 },
];

// Props that pop on one at a time across the build.
const PROPS = Array.from({ length: 9 }, (_, i) => ({
  x: 0.14 + (i % 3) * 0.36,
  y: 0.24 + Math.floor(i / 3) * 0.22,
  r: 30 + (i % 4) * 16,
  at: 9 + i * 0.9,
  kind: i % 3,
  wobble: rand.range(0, Math.PI * 2),
}));

export default {
  id: 'ep13',
  index: 12,
  title: 'Paper-Cut Orange',
  draw(ctx, t) {
    ctx.save();
    ctx.fillStyle = COLOR.cream;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    // Paper bands sliding in from the left.
    for (const b of BANDS) {
      const p = span(t, b.at, b.at + 0.9, ease.outCubic);
      if (p <= 0) continue;
      ctx.save();
      ctx.fillStyle = b.c;
      ctx.fillRect(-W + p * W, H * b.y, W, H * b.h + 1);
      ctx.restore();
    }

    camera(ctx, t, {
      zoom: lerp(1.0, 1.14, span(t, BEAT.hero - 2, BEAT.hero + 5, ease.inOutCubic)),
      rot: Math.sin(t * 0.18) * 0.008,
      seed,
    });

    /* -------- prop layer -------- */
    for (let i = 0; i < PROPS.length; i++) {
      const p = PROPS[i];
      const on = span(t, p.at, p.at + 0.55, ease.outBack) * (1 - span(t, 27.5 + i * 0.12, 28.2 + i * 0.12, ease.inCubic));
      if (on <= 0) continue;
      ctx.save();
      ctx.globalAlpha = clamp(on * 2);
      ctx.translate(W * p.x, H * p.y);
      ctx.rotate(Math.sin(t * 0.7 + i) * 0.06);
      ctx.scale(on, on);
      if (p.kind === 0) paperOrange(ctx, p.r, t * 0.3 + i);
      else if (p.kind === 1) {
        ctx.save();
        ctx.translate(-p.r * 0.5, 0);
        drawLeaf(ctx, 0, 0, p.r * 1.6, Math.sin(t * 0.8 + i) * 0.3);
        ctx.restore();
      } else {
        paper(ctx, (c) => {
          c.beginPath();
          c.roundRect(-p.r * 0.5, -p.r * 0.5, p.r, p.r, p.r * 0.22);
          c.fill();
        }, COLOR.greenLight);
      }
      ctx.restore();
    }

    /* -------- the hero build -------- */
    const heroOn = span(t, 28.6, 30.2, ease.outBack);
    if (heroOn > 0) {
      ctx.save();
      ctx.translate(W / 2, H * 0.9);
      ctx.scale(heroOn, heroOn);
      ctx.rotate((1 - heroOn) * 0.2);
      paperBottle(ctx, 360);
      ctx.restore();
      // Two paper oranges flanking the pack.
      for (const s of [-1, 1]) {
        const on = span(t, 30.2 + (s > 0 ? 0.2 : 0), 31 + (s > 0 ? 0.2 : 0), ease.outBack);
        if (on <= 0) continue;
        ctx.save();
        ctx.translate(W / 2 + s * 300, H * 0.82);
        ctx.scale(on, on);
        ctx.rotate(Math.sin(t * 0.6 + s) * 0.08);
        paperOrange(ctx, 74, t * 0.2);
        ctx.restore();
      }
    }

    ctx.restore(); // camera

    vignette(ctx, 0.22, '#7A2400');

    hookLine(ctx, t, 'CUT FROM SOMETHING REAL', { at: 2.0, hold: 5.4, size: 46, y: H * 0.14, color: COLOR.green });

    const heroTxt = span(t, BEAT.hero + 1.6, BEAT.hero + 2.6, ease.outCubic) * (1 - span(t, BEAT.lockup - 0.8, BEAT.lockup));
    if (heroTxt > 0) {
      drawKinetic(ctx, 'MADE BY HAND, MORE OR LESS', W / 2, H * 0.12, 40, t - (BEAT.hero + 1.6), {
        mode: 'pop',
        step: 0.02,
        color: COLOR.green,
        outline: COLOR.cream,
        tracking: 3,
        alpha: heroTxt,
      });
    }

    endCard(ctx, t, { tagline: 'FULL OF LIFE', washColor: COLOR.orange, wash: 0.95 });
    grade(ctx, t, 0.16);
  },
};
