/**
 * Episode 14 - "Vinyl Groove"
 *
 * Music spot. A record spins in the centre of frame - its label is an orange
 * slice - and a spectrum analyser built from bottle silhouettes pumps along the
 * bottom. Everything is locked to the tempo of this episode's soundtrack.
 */

import {
  W, H, COLOR, rgba, camera, bgGradient, bgRings, vignette, flash,
  drawOrangeSlice, drawBottle, drawCan, makeSparks, makeConfetti,
  clamp, lerp, span, ease, rng, noise1,
  BEAT, endCard, hookLine, grade, drawKinetic,
} from './_kit.js';

const seed = 1414;
const rand = rng(seed);
const spec = noise1(seed + 1);
const dust = makeSparks(seed + 2, 45, { minR: 1, maxR: 2.6, twinkle: 2.4, color: COLOR.sodaGlow });
const flakes = makeConfetti(seed + 3, 36, { size: 16, speed: 130 });

// Matches musicIdentity(13).bpm = 96 + ((13*7)%9)*6 = 96 + (91%9=1)*6 = 102.
const BPM = 102;
const BEAT_S = 60 / BPM;
const BARS = 30;

const T_DROP = 14.0;

export default {
  id: 'ep14',
  index: 13,
  title: 'Vinyl Groove',
  draw(ctx, t) {
    const phase = ((t - T_DROP) % BEAT_S + BEAT_S) % BEAT_S;
    const kick = t > T_DROP ? Math.max(0, 1 - phase / 0.19) : 0;
    const live = span(t, T_DROP, T_DROP + 1);

    bgGradient(ctx, [
      [0, '#2A0A1E'],
      [0.45, '#6B1A00'],
      [1, '#12060A'],
    ]);
    bgRings(ctx, t, { cy: H * 0.42, count: 5, period: BEAT_S * 4, color: COLOR.sodaCore, alpha: 0.13 * (0.4 + kick * 0.9), max: 900 });
    dust(ctx, t, 0.4);

    camera(ctx, t, {
      zoom: lerp(1.0, 1.18, span(t, BEAT.hero - 2, BEAT.hero + 5, ease.inOutCubic)) * (1 + kick * live * 0.014),
      rot: Math.sin(t * 0.14) * 0.01,
      shake: kick * live * 5,
      seed,
    });

    /* -------- the record -------- */
    const cx = W / 2, cy = H * 0.42;
    const R = 235;
    const spin = span(t, 2.5, 8, ease.inOutCubic) * t * 3.1;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(spin);
    // Disc.
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    const dg = ctx.createRadialGradient(-R * 0.3, -R * 0.3, R * 0.1, 0, 0, R);
    dg.addColorStop(0, '#2A2126');
    dg.addColorStop(0.6, '#141014');
    dg.addColorStop(1, '#241C20');
    ctx.fillStyle = dg;
    ctx.fill();
    // Grooves.
    ctx.strokeStyle = rgba('#5A4A52', 0.5);
    for (let i = 0; i < 26; i++) {
      ctx.lineWidth = i % 5 === 0 ? 1.6 : 0.7;
      ctx.beginPath();
      ctx.arc(0, 0, R * (0.42 + (i / 26) * 0.56), 0, Math.PI * 2);
      ctx.stroke();
    }
    // Label: the orange slice.
    drawOrangeSlice(ctx, R * 0.4, { segments: 10, detail: 1 });
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#12060A';
    ctx.fill();
    ctx.restore();

    // Sheen sweeping across the disc.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();
    const sh = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    const p = (t * 0.16) % 1;
    sh.addColorStop(clamp(p - 0.16), rgba(COLOR.white, 0));
    sh.addColorStop(clamp(p), rgba(COLOR.white, 0.16));
    sh.addColorStop(clamp(p + 0.16), rgba(COLOR.white, 0));
    ctx.fillStyle = sh;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    ctx.restore();

    // Tonearm.
    const armIn = span(t, 5.5, 7.5, ease.outCubic);
    if (armIn > 0) {
      ctx.save();
      ctx.translate(cx + 330, cy - 200);
      ctx.rotate(lerp(-0.5, 0.62, armIn) + kick * live * 0.006);
      ctx.strokeStyle = '#C9CDD2';
      ctx.lineWidth = 9;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(300, 130);
      ctx.stroke();
      ctx.fillStyle = '#8E949B';
      ctx.beginPath();
      ctx.arc(0, 0, 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect(292, 122, 34, 24, 5);
      ctx.fill();
      ctx.restore();
    }

    /* -------- bottle spectrum analyser -------- */
    if (live > 0) {
      const bw = W / BARS;
      for (let i = 0; i < BARS; i++) {
        // Low bars pump on the kick, high bars shimmer on noise.
        const lowness = 1 - Math.abs(i - BARS / 2) / (BARS / 2);
        const h =
          40 +
          spec(i * 1.7 + t * 7) * 120 +
          kick * lowness * 190 +
          Math.sin(t * 5 + i * 0.6) * 22;
        ctx.save();
        ctx.globalAlpha = live * 0.85;
        ctx.translate(i * bw + bw / 2, H);
        ctx.fillStyle = i % 4 === 0 ? COLOR.green : i % 2 === 0 ? COLOR.sodaLight : COLOR.sodaCore;
        ctx.beginPath();
        ctx.roundRect(-bw * 0.34, -h, bw * 0.68, h, bw * 0.3);
        ctx.fill();
        ctx.restore();
      }
    }

    /* -------- the pack -------- */
    const heroOn = span(t, BEAT.hero - 1, BEAT.hero + 1, ease.outBack);
    if (heroOn > 0) {
      ctx.save();
      ctx.globalAlpha = heroOn;
      ctx.translate(cx, H * 0.86);
      ctx.scale(heroOn * (1 + kick * 0.04), heroOn * (1 + kick * 0.04));
      drawCan(ctx, 320, { glow: 0.45 + kick * 0.3 });
      ctx.restore();
    }

    ctx.restore(); // camera

    flash(ctx, kick * live * 0.07, COLOR.sodaGlow);
    flakes(ctx, t, live * 0.4 * (1 - span(t, BEAT.lockup - 2, BEAT.lockup)));
    vignette(ctx, 0.55, '#0A0308');

    hookLine(ctx, t, 'DROP THE NEEDLE', { at: 1.2, hold: 4.2, size: 52, y: H * 0.12 });

    const heroTxt = span(t, BEAT.hero + 1.6, BEAT.hero + 2.6, ease.outCubic) * (1 - span(t, BEAT.lockup - 0.8, BEAT.lockup));
    if (heroTxt > 0) {
      drawKinetic(ctx, 'ORANGE ON REPEAT', W / 2, H * 0.1, 46, t - (BEAT.hero + 1.6), {
        mode: 'wave',
        color: COLOR.white,
        outline: rgba('#12060A', 0.8),
        tracking: 6,
        alpha: heroTxt,
      });
    }

    endCard(ctx, t, { tagline: 'FULL OF LIFE', washColor: '#6B1A00', wash: 0.88 });
    grade(ctx, t, 0.2);
  },
};
