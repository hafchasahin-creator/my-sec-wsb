/**
 * Episode 10 - "Street Court"
 *
 * Hard graphic energy: a floodlit court seen in flat perspective, a ball that
 * is an orange, and beat-synced geometry snapping on every hit. Fast cuts,
 * high contrast, everything on the grid - the most graphic spot in the set.
 */

import {
  W, H, COLOR, rgba, camera, bgGradient, bgRings, flash, vignette, letterbox,
  drawWholeOrange, drawCan, makeSparks, makeSplash,
  clamp, lerp, span, ease, rng,
  BEAT, endCard, hookLine, grade, drawKinetic, barWipe,
} from './_kit.js';

const seed = 1010;
const rand = rng(seed);
const dust = makeSparks(seed + 1, 60, { minR: 1, maxR: 2.8, twinkle: 3.4, color: COLOR.sodaGlow });
const impact = makeSplash(seed + 2, 30, { speed: 380, aim: -Math.PI / 2, spread: Math.PI * 1.5, gravity: 1500, life: 1.1, maxR: 10 });

const BPM = 138;
const BEAT_S = 60 / BPM;

/** Bounce height at time t: a decaying series of parabolic arcs on the beat. */
function bounce(t, t0) {
  const lt = t - t0;
  if (lt < 0) return { y: 0, hit: -1 };
  const n = Math.floor(lt / BEAT_S);
  const k = (lt % BEAT_S) / BEAT_S;
  const amp = 300 * Math.pow(0.86, n);
  return { y: -amp * 4 * k * (1 - k), hit: n };
}

const T_BALL = 5.0;
const T_MORPH = 26.0;

export default {
  id: 'ep10',
  index: 9,
  title: 'Street Court',
  draw(ctx, t) {
    bgGradient(ctx, [
      [0, '#20100A'],
      [0.4, '#6B2200'],
      [1, '#12070A'],
    ]);

    const { y: ballY, hit } = bounce(t, T_BALL);
    // Every bounce pulses the frame.
    const sinceHit = ((t - T_BALL) % BEAT_S + BEAT_S) % BEAT_S;
    const pulse = t > T_BALL ? Math.max(0, 1 - sinceHit / 0.22) : 0;

    bgRings(ctx, t, { cy: H * 0.72, count: 4, period: BEAT_S * 4, color: COLOR.sodaGlow, alpha: 0.12 * (0.4 + pulse), max: 820 });

    camera(ctx, t, {
      zoom: lerp(1.02, 1.22, span(t, BEAT.hero - 2, BEAT.hero + 5, ease.inOutCubic)) * (1 + pulse * 0.012),
      shake: pulse * 7,
      seed,
    });

    /* -------- the court -------- */
    ctx.save();
    // Floor plane.
    ctx.fillStyle = '#3A1200';
    ctx.beginPath();
    ctx.moveTo(-200, H);
    ctx.lineTo(W * 0.3, H * 0.6);
    ctx.lineTo(W * 0.7, H * 0.6);
    ctx.lineTo(W + 200, H);
    ctx.closePath();
    ctx.fill();
    // Court markings converging to the vanishing point.
    ctx.strokeStyle = rgba(COLOR.sodaGlow, 0.4);
    ctx.lineWidth = 4;
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(W / 2 + i * 240, H + 40);
      ctx.lineTo(W / 2 + i * 62, H * 0.6);
      ctx.stroke();
    }
    for (let i = 1; i <= 5; i++) {
      const k = i / 6;
      const y = lerp(H, H * 0.6, k);
      const half = lerp(760, 190, k);
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(W / 2 - half, y);
      ctx.lineTo(W / 2 + half, y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // Centre circle.
    ctx.beginPath();
    ctx.ellipse(W / 2, H * 0.84, 210, 54, 0, 0, Math.PI * 2);
    ctx.strokeStyle = rgba(COLOR.sodaGlow, 0.5);
    ctx.stroke();
    ctx.restore();

    // Floodlight cones.
    ctx.save();
    for (const fx of [W * 0.18, W * 0.82]) {
      const g = ctx.createLinearGradient(fx, 0, fx, H);
      g.addColorStop(0, rgba(COLOR.sodaGlow, 0.3));
      g.addColorStop(1, rgba(COLOR.sodaGlow, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(fx - 40, 0);
      ctx.lineTo(fx + 40, 0);
      ctx.lineTo(fx + 320, H);
      ctx.lineTo(fx - 320, H);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    dust(ctx, t, 0.4);

    /* -------- the ball -------- */
    const morph = span(t, T_MORPH, T_MORPH + 2.4, ease.inOutCubic);
    const bx = W / 2 + Math.sin((t - T_BALL) * 0.7) * 260 * (1 - morph);
    const by = H * 0.84 + ballY * (1 - morph * 0.6);
    if (t > T_BALL && morph < 1) {
      // Squash on contact.
      const squash = 1 + pulse * 0.3;
      ctx.save();
      ctx.globalAlpha = 1 - morph;
      // Shadow tracks the ball height.
      ctx.save();
      ctx.globalAlpha = (1 - morph) * (0.4 - ballY / 1400);
      ctx.beginPath();
      ctx.ellipse(bx, H * 0.855, 70 + ballY / 12, 18 + ballY / 46, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#000000';
      ctx.fill();
      ctx.restore();
      ctx.translate(bx, by);
      ctx.rotate((t - T_BALL) * 2.4);
      ctx.scale(squash, 1 / squash);
      drawWholeOrange(ctx, 66, { t, leaf: false });
      ctx.restore();

      if (pulse > 0.5) {
        ctx.save();
        ctx.translate(bx, H * 0.855);
        impact(ctx, sinceHit, 0, { fade: pulse * 0.8 });
        ctx.restore();
      }
    }

    /* -------- the pack -------- */
    if (morph > 0) {
      ctx.save();
      ctx.globalAlpha = morph;
      ctx.translate(W / 2, H * 0.88);
      ctx.scale(morph, morph);
      drawCan(ctx, 350, { glow: 0.5 });
      ctx.restore();
    }
    flash(ctx, span(t, T_MORPH, T_MORPH + 0.2, ease.outQuad) * (1 - span(t, T_MORPH + 0.15, T_MORPH + 0.7)) * 0.7);

    ctx.restore(); // camera

    letterbox(ctx, span(t, 0.4, 1.4, ease.outCubic) * (1 - span(t, BEAT.lockup - 1, BEAT.lockup)), 48);
    vignette(ctx, 0.55, '#0A0406');

    hookLine(ctx, t, 'PLAY LOUD', { at: 1.2, hold: 4.0, size: 62, y: H * 0.2 });

    const heroTxt = span(t, BEAT.hero + 1.2, BEAT.hero + 2.2, ease.outCubic) * (1 - span(t, BEAT.lockup - 0.8, BEAT.lockup));
    if (heroTxt > 0) {
      drawKinetic(ctx, 'REAL ORANGE ENERGY', W / 2, H * 0.17, 50, t - (BEAT.hero + 1.2), {
        mode: 'drop',
        step: 0.024,
        color: COLOR.white,
        outline: rgba('#3A1200', 0.8),
        tracking: 5,
        alpha: heroTxt,
      });
    }

    barWipe(ctx, span(t, BEAT.lockup - 0.45, BEAT.lockup, ease.inCubic), { bars: 11, color: COLOR.sodaDeep, dir: -1 });
    endCard(ctx, t, { tagline: 'REAL ORANGE ENERGY' });
    grade(ctx, t, 0.2);
  },
};
