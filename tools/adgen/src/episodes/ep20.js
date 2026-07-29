/**
 * Episode 20 - "Festival Lights"
 *
 * Night celebration. Fireworks bloom over a crowd silhouette, bunting sways,
 * confetti falls constantly. The pack is held up in the foreground as a
 * silhouette-with-glow rather than a studio hero.
 */

import {
  W, H, COLOR, rgba, camera, bgGradient, vignette, flash,
  drawBottle, drawWholeOrange, makeConfetti, makeSparks, makeSplash,
  clamp, lerp, span, ease, rng,
  BEAT, endCard, hookLine, grade, drawKinetic,
} from './_kit.js';

const seed = 2020;
const rand = rng(seed);
const confetti = makeConfetti(seed + 1, 70, { size: 18, speed: 110 });
const stars = makeSparks(seed + 2, 110, { minR: 1, maxR: 2.6, twinkle: 1.6, color: '#FFE9C4' });

// Fireworks: each is a splash burst fired at a scheduled time and position.
const FIREWORKS = Array.from({ length: 9 }, (_, i) => ({
  at: 4 + i * 3.4 + rand.range(-0.5, 0.5),
  x: rand.range(W * 0.15, W * 0.85),
  y: rand.range(H * 0.14, H * 0.42),
  burst: makeSplash(seed + 20 + i, 46, {
    speed: rand.range(280, 460),
    spread: Math.PI * 2,
    aim: 0,
    gravity: 180,
    life: 2.2,
    maxR: 8,
    colors: [
      rand.pick([COLOR.sodaGlow, COLOR.sodaLight, COLOR.greenLight]),
      COLOR.white,
      rand.pick([COLOR.sodaCore, COLOR.orange1]),
    ],
  }),
}));

// Crowd silhouette heads.
const CROWD = Array.from({ length: 34 }, () => ({
  x: rand.range(-40, W + 40),
  s: rand.range(0.7, 1.3),
  ph: rand.range(0, Math.PI * 2),
}));

export default {
  id: 'ep20',
  index: 19,
  title: 'Festival Lights',
  draw(ctx, t) {
    bgGradient(ctx, [
      [0, '#0A0620'],
      [0.42, '#2A0E30'],
      [0.75, '#6B1E24'],
      [1, '#3A0E10'],
    ]);
    stars(ctx, t, 0.7);

    // Fireworks flash the whole frame.
    let fl = 0;
    for (const f of FIREWORKS) {
      fl = Math.max(fl, span(t, f.at, f.at + 0.14, ease.outQuad) * (1 - span(t, f.at + 0.1, f.at + 0.7)));
    }

    camera(ctx, t, {
      zoom: lerp(1.02, 1.18, span(t, BEAT.hero - 2, BEAT.hero + 5, ease.inOutCubic)),
      panX: Math.sin(t * 0.14) * 20,
      shake: fl * 6,
      seed,
    });

    /* -------- fireworks -------- */
    for (const f of FIREWORKS) {
      const lt = t - f.at;
      if (lt < 0 || lt > 3) continue;
      // Rising shell before the burst.
      if (lt < 0.02) continue;
      ctx.save();
      ctx.translate(f.x, f.y);
      f.burst(ctx, lt, 0, { fade: 1 - span(lt, 1.6, 2.8), gy: 180 });
      // Core flare.
      const core = span(lt, 0, 0.35, ease.outQuad) * (1 - span(lt, 0.2, 0.9));
      if (core > 0) {
        const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 150 * core);
        g.addColorStop(0, rgba(COLOR.white, 0.9 * core));
        g.addColorStop(1, rgba(COLOR.sodaGlow, 0));
        ctx.fillStyle = g;
        ctx.fillRect(-180, -180, 360, 360);
      }
      ctx.restore();
    }

    /* -------- bunting -------- */
    ctx.save();
    const sway = Math.sin(t * 0.8) * 12;
    ctx.strokeStyle = rgba('#1A0E20', 0.9);
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = -20; x <= W + 20; x += 12) {
      const k = x / W;
      const y = H * 0.1 + Math.sin(k * Math.PI) * 70 + sway * Math.sin(k * Math.PI);
      x === -20 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    for (let i = 0; i <= 20; i++) {
      const k = i / 20;
      const x = k * W;
      const y = H * 0.1 + Math.sin(k * Math.PI) * 70 + sway * Math.sin(k * Math.PI);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.sin(t * 1.2 + i) * 0.1);
      ctx.beginPath();
      ctx.moveTo(-16, 0);
      ctx.lineTo(16, 0);
      ctx.lineTo(0, 40);
      ctx.closePath();
      ctx.fillStyle = [COLOR.sodaCore, COLOR.greenLight, COLOR.sodaGlow, COLOR.orange1][i % 4];
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    /* -------- crowd -------- */
    ctx.save();
    ctx.fillStyle = '#0A0410';
    for (const p of CROWD) {
      const bob = Math.sin(t * 2.4 + p.ph) * 6;
      const y = H * 0.86 + bob;
      ctx.beginPath();
      ctx.arc(p.x, y - 34 * p.s, 17 * p.s, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(p.x, y + 34 * p.s, 26 * p.s, 52 * p.s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Some arms raised holding oranges.
    for (let i = 0; i < 6; i++) {
      const x = W * (0.12 + i * 0.15);
      const lift = Math.sin(t * 1.8 + i) * 14;
      ctx.save();
      ctx.strokeStyle = '#0A0410';
      ctx.lineWidth = 12;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, H * 0.88);
      ctx.lineTo(x + 10, H * 0.74 + lift);
      ctx.stroke();
      ctx.translate(x + 10, H * 0.72 + lift);
      ctx.globalAlpha = 0.9;
      drawWholeOrange(ctx, 16, { leaf: false, t });
      ctx.restore();
    }
    ctx.restore();

    /* -------- the pack held up front -------- */
    const hold = span(t, 18, 22, ease.outCubic);
    if (hold > 0) {
      const by = lerp(H * 1.3, H * 0.98, hold) + Math.sin(t * 1.2) * 10;
      ctx.save();
      ctx.translate(W * 0.72, by);
      ctx.rotate(-0.1 + Math.sin(t * 0.9) * 0.03);
      const glow = ctx.createRadialGradient(0, -190, 10, 0, -190, 340);
      glow.addColorStop(0, rgba(COLOR.sodaGlow, 0.45));
      glow.addColorStop(1, rgba(COLOR.sodaGlow, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(-360, -540, 720, 700);
      drawBottle(ctx, 380, { fill: 0.9, glow: 0.5 });
      ctx.restore();
    }

    ctx.restore(); // camera

    confetti(ctx, t, 0.7 * span(t, 3, 5));
    flash(ctx, fl * 0.28, COLOR.sodaGlow);
    vignette(ctx, 0.6, '#050210');

    hookLine(ctx, t, 'THE WHOLE STREET IS OUT', { at: 1.2, hold: 4.6, size: 46, y: H * 0.3 });

    const heroTxt = span(t, BEAT.hero + 1.4, BEAT.hero + 2.4, ease.outCubic) * (1 - span(t, BEAT.lockup - 0.8, BEAT.lockup));
    if (heroTxt > 0) {
      drawKinetic(ctx, 'RAISE SOMETHING ORANGE', W / 2, H * 0.32, 44, t - (BEAT.hero + 1.4), {
        mode: 'drop',
        step: 0.024,
        color: COLOR.white,
        outline: rgba('#2A0E30', 0.85),
        tracking: 5,
        alpha: heroTxt,
      });
    }

    endCard(ctx, t, { tagline: 'FULL OF LIFE', washColor: '#6B1E24', wash: 0.9 });
    grade(ctx, t, 0.2);
  },
};
