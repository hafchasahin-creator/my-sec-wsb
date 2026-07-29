/**
 * Episode 11 - "Splash Portal"
 *
 * A vertical sheet of liquid hangs in the frame like a doorway. Objects punch
 * through it from behind - slices, ice, finally the pack - each impact throwing
 * a crown outward toward camera. Built entirely on the splash vocabulary.
 */

import {
  W, H, COLOR, rgba, camera, bgGradient, bgSunburst, flash, vignette,
  drawOrangeSlice, drawIce, drawBottle, drawCrown, blobPath,
  makeSplash, makeBubbles,
  clamp, lerp, span, ease, rng,
  BEAT, endCard, hookLine, grade, drawKinetic, splashWipe,
} from './_kit.js';

const seed = 1111;
const rand = rng(seed);
const bursts = [0, 1, 2, 3].map((i) =>
  makeSplash(seed + 10 + i, 40, { speed: 560 + i * 90, spread: Math.PI * 2, aim: 0, gravity: 900, life: 1.8, maxR: 15 })
);
const fizz = makeBubbles(seed + 2, 36, { w: 200, h: 340, minR: 2, maxR: 8, speed: 78 });

// Four punch-throughs, escalating.
const PUNCHES = [
  { at: 7.0, kind: 'slice', size: 90 },
  { at: 12.5, kind: 'ice', size: 96 },
  { at: 18.0, kind: 'slice', size: 128 },
  { at: 24.5, kind: 'bottle', size: 340 },
];

/** The hanging liquid sheet, rippling from the most recent impact. */
function portal(ctx, t, cx, cy, r, ripple) {
  ctx.save();
  ctx.translate(cx, cy);
  blobPath(
    ctx,
    (a) =>
      r *
      (1 +
        0.05 * Math.sin(a * 5 + t * 1.2) +
        0.035 * Math.sin(a * 9 - t * 1.8) +
        ripple * 0.16 * Math.sin(a * 7 - t * 22)),
    90,
    1.12
  );
  const g = ctx.createRadialGradient(0, -r * 0.2, r * 0.1, 0, 0, r * 1.1);
  g.addColorStop(0, rgba(COLOR.sodaLight, 0.95));
  g.addColorStop(0.55, rgba(COLOR.sodaCore, 0.9));
  g.addColorStop(1, rgba(COLOR.sodaDeep, 0.95));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = rgba(COLOR.sodaGlow, 0.7);
  ctx.stroke();
  ctx.restore();
}

export default {
  id: 'ep11',
  index: 10,
  title: 'Splash Portal',
  draw(ctx, t) {
    bgGradient(ctx, [
      [0, '#7A2400'],
      [0.5, '#A83C00'],
      [1, '#4A1400'],
    ]);
    bgSunburst(ctx, t, { rays: 16, speed: 0.1, alpha: 0.12, color: COLOR.sodaGlow });

    // The most recent impact drives ripple, camera shake and flash together.
    let ripple = 0, shake = 0, fl = 0;
    for (const p of PUNCHES) {
      const k = span(t, p.at, p.at + 0.8, ease.outQuad) * (1 - span(t, p.at, p.at + 1.6));
      ripple = Math.max(ripple, k);
      shake = Math.max(shake, k * (p.kind === 'bottle' ? 20 : 11));
      fl = Math.max(fl, span(t, p.at, p.at + 0.12, ease.outQuad) * (1 - span(t, p.at + 0.1, p.at + 0.5)));
    }

    camera(ctx, t, {
      zoom: lerp(1.0, 1.2, span(t, BEAT.hero - 2, BEAT.hero + 5, ease.inOutCubic)),
      rot: Math.sin(t * 0.16) * 0.014,
      shake,
      seed,
    });

    const cx = W / 2, cy = H * 0.5;
    portal(ctx, t, cx, cy, 230, ripple);

    /* -------- punch-throughs -------- */
    PUNCHES.forEach((p, i) => {
      const lt = t - p.at;
      if (lt < -0.4) return;
      // Emerge from the sheet, travel toward camera, then settle or exit.
      const come = span(lt, 0, 1.5, ease.outCubic);
      const gone = p.kind === 'bottle' ? 0 : span(lt, 2.2, 3.4, ease.inCubic);
      if (gone >= 1) return;
      const sc = lerp(0.15, 1, come);
      const y = cy + come * (p.kind === 'bottle' ? 210 : 90) + gone * 320;

      ctx.save();
      ctx.globalAlpha = 1 - gone;
      ctx.translate(cx, y);
      ctx.scale(sc, sc);
      ctx.rotate(p.kind === 'bottle' ? 0 : lt * 1.6);
      if (p.kind === 'slice') drawOrangeSlice(ctx, p.size, { segments: 10, detail: 1 });
      else if (p.kind === 'ice') drawIce(ctx, 0, 0, p.size, lt);
      else drawBottle(ctx, p.size, { fill: 0.9, glow: 0.5 });
      ctx.restore();

      // Crown thrown outward on the hit.
      if (lt >= 0 && lt < 1.4) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(1, 0.55);
        drawCrown(ctx, 190, span(lt, 0, 0.9), 15, i);
        ctx.restore();
        ctx.save();
        ctx.translate(cx, cy);
        bursts[i](ctx, lt, 0, { fade: 1 - span(lt, 0.9, 1.5) });
        ctx.restore();
      }
    });

    // Fizz around the settled pack.
    const heroOn = span(t, 26, 28, ease.outCubic);
    if (heroOn > 0) {
      ctx.save();
      ctx.translate(cx, cy + 210);
      fizz(ctx, t, { fade: 0.4 * heroOn, scale: 0.9 });
      ctx.restore();
    }

    ctx.restore(); // camera

    flash(ctx, fl * 0.6, COLOR.sodaGlow);
    vignette(ctx, 0.45, '#2A0800');

    hookLine(ctx, t, 'COME STRAIGHT THROUGH', { at: 1.2, hold: 4.6, size: 46, y: H * 0.13 });

    const heroTxt = span(t, BEAT.hero + 1.3, BEAT.hero + 2.3, ease.outCubic) * (1 - span(t, BEAT.lockup - 0.8, BEAT.lockup));
    if (heroTxt > 0) {
      drawKinetic(ctx, 'NOTHING GETS IN THE WAY', W / 2, H * 0.12, 44, t - (BEAT.hero + 1.3), {
        mode: 'pop',
        step: 0.024,
        color: COLOR.white,
        outline: rgba('#4A1400', 0.75),
        tracking: 5,
        alpha: heroTxt,
      });
    }

    splashWipe(ctx, span(t, BEAT.lockup - 0.6, BEAT.lockup, ease.inCubic), t, { color: COLOR.sodaDeep, seed: 9 });
    endCard(ctx, t, { tagline: 'ORANGE, UNMISTAKABLY' });
    grade(ctx, t, 0.24);
  },
};
