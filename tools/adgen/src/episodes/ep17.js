/**
 * Episode 17 - "Monsoon Rooftop"
 *
 * Warm rain on a city rooftop at dusk. String lights sway, puddles hold the
 * skyline upside down, and rain falls in sheets you can see through. Communal
 * and celebratory rather than product-first - the pack arrives late and low.
 */

import {
  W, H, COLOR, rgba, camera, bgGradient, bgHills, vignette, lightLeak,
  drawBottle, drawGlass, makeRunlets, makeSparks, makeSplash,
  clamp, lerp, span, ease, rng, noise1, mixHex,
  BEAT, endCard, hookLine, grade, drawKinetic,
} from './_kit.js';

const seed = 1717;
const rand = rng(seed);
const sheets = makeRunlets(seed + 1, 110, W, H);
const lightsN = noise1(seed + 2);
const spray = makeSplash(seed + 3, 24, { speed: 200, aim: -Math.PI / 2, spread: Math.PI * 0.9, gravity: 1100, life: 0.9, maxR: 7, colors: [rgba(COLOR.white, 0.7), COLOR.sodaGlow] });

// Two catenary strings of bulbs across the top of frame.
const STRINGS = [
  { y: H * 0.16, sag: 90, n: 15, ph: 0 },
  { y: H * 0.27, sag: 62, n: 11, ph: 2.1 },
];

// Puddles on the rooftop deck.
const PUDDLES = Array.from({ length: 5 }, () => ({
  x: rand.range(80, W - 80),
  y: rand.range(H * 0.88, H * 0.97),
  w: rand.range(90, 240),
  h: rand.range(14, 30),
}));

const T_LIGHTS = 6.0;

export default {
  id: 'ep17',
  index: 16,
  title: 'Monsoon Rooftop',
  draw(ctx, t) {
    bgGradient(ctx, [
      [0, '#2E1A46'],
      [0.35, '#6B2A3C'],
      [0.62, '#B84600'],
      [1, '#3A1200'],
    ]);

    camera(ctx, t, {
      zoom: lerp(1.02, 1.2, span(t, BEAT.hero - 2, BEAT.hero + 5, ease.inOutCubic)),
      panX: Math.sin(t * 0.12) * 18,
      seed,
    });

    // Distant skyline.
    bgHills(ctx, t * 0.15, { bands: 2, speed: 1.5, baseY: H * 0.66, colors: ['#3A1E38', '#25122A'] });

    /* -------- rooftop deck -------- */
    ctx.save();
    ctx.fillStyle = '#1C0E14';
    ctx.fillRect(0, H * 0.8, W, H * 0.2);
    for (const p of PUDDLES) {
      const g = ctx.createLinearGradient(0, p.y - p.h, 0, p.y + p.h);
      g.addColorStop(0, rgba(COLOR.sodaCore, 0.42));
      g.addColorStop(1, rgba('#6B2A3C', 0.22));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.w / 2, p.h, 0, 0, Math.PI * 2);
      ctx.fill();
      // Raindrop rings.
      const ring = ((t * 0.9 + p.x) % 1.4) / 1.4;
      ctx.strokeStyle = rgba(COLOR.white, 0.3 * (1 - ring));
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, (p.w / 2) * ring, p.h * ring, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    /* -------- string lights -------- */
    const lit = span(t, T_LIGHTS, T_LIGHTS + 1.2);
    for (const s of STRINGS) {
      const swayA = Math.sin(t * 0.7 + s.ph) * 14;
      ctx.save();
      // Cable.
      ctx.strokeStyle = rgba('#1A0E14', 0.9);
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let x = -20; x <= W + 20; x += 12) {
        const k = x / W;
        const y = s.y + Math.sin(k * Math.PI) * s.sag + swayA * Math.sin(k * Math.PI);
        x === -20 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      // Bulbs.
      for (let i = 0; i <= s.n; i++) {
        const k = i / s.n;
        const x = k * W;
        const y = s.y + Math.sin(k * Math.PI) * s.sag + swayA * Math.sin(k * Math.PI);
        const on = lit * (0.55 + 0.45 * lightsN(i * 2.3 + s.ph + t * 1.1));
        const c = i % 3 === 0 ? COLOR.greenLight : i % 3 === 1 ? COLOR.sodaGlow : COLOR.sodaLight;
        const g = ctx.createRadialGradient(x, y + 14, 1, x, y + 14, 44);
        g.addColorStop(0, rgba(c, 0.9 * on));
        g.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = g;
        ctx.fillRect(x - 46, y - 32, 92, 92);
        ctx.beginPath();
        ctx.arc(x, y + 14, 8, 0, Math.PI * 2);
        ctx.fillStyle = rgba(mixHex('#3A2A20', c, on), 1);
        ctx.fill();
      }
      ctx.restore();
    }

    /* -------- table with the drinks -------- */
    const setIn = span(t, 13, 16, ease.outCubic);
    if (setIn > 0) {
      ctx.save();
      ctx.globalAlpha = setIn;
      ctx.translate(W * 0.5, H * 0.9);
      ctx.scale(setIn, setIn);
      // Low table.
      ctx.fillStyle = '#2E1810';
      ctx.fillRect(-320, -18, 640, 18);
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = setIn;
      ctx.translate(W * 0.5, H * 0.9 - 18);
      drawBottle(ctx, 300, { fill: 0.9, glow: 0.32 });
      ctx.translate(-230, 0);
      drawGlass(ctx, 190, { fill: 0.7, ice: 2, sway: Math.sin(t * 1.8) * 0.02 });
      ctx.translate(460, 0);
      drawGlass(ctx, 190, { fill: 0.62, ice: 1, sway: Math.sin(t * 1.8 + 1) * 0.02 });
      ctx.restore();
    }

    // Rain hitting the table edge.
    if (setIn > 0.5) {
      for (let i = 0; i < 4; i++) {
        ctx.save();
        ctx.translate(W * 0.5 + (i - 1.5) * 180, H * 0.9 - 18);
        spray(ctx, (t * 1.4 + i * 0.37) % 1.1, 0, { fade: 0.5 });
        ctx.restore();
      }
    }

    ctx.restore(); // camera

    sheets(ctx, t * 1.9, 0.5);
    lightLeak(ctx, t, { alpha: 0.1, speed: 0.11, color: COLOR.sodaGlow });
    vignette(ctx, 0.6, '#100616');

    hookLine(ctx, t, 'FIRST RAIN OF THE YEAR', { at: 1.4, hold: 5.0, size: 46, y: H * 0.09 });

    const heroTxt = span(t, BEAT.hero + 1.4, BEAT.hero + 2.4, ease.outCubic) * (1 - span(t, BEAT.lockup - 0.8, BEAT.lockup));
    if (heroTxt > 0) {
      drawKinetic(ctx, 'EVERYONE UP ON THE ROOF', W / 2, H * 0.075, 40, t - (BEAT.hero + 1.4), {
        mode: 'rise',
        step: 0.024,
        color: COLOR.white,
        outline: rgba('#100616', 0.8),
        tracking: 4,
        alpha: heroTxt,
      });
    }

    endCard(ctx, t, { tagline: 'FULL OF LIFE', washColor: '#7A2400', wash: 0.9 });
    grade(ctx, t, 0.2);
  },
};
