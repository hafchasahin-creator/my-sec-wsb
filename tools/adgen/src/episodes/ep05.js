/**
 * Episode 05 - "Ice Break"
 *
 * A block of ice hangs in a cold blue-white field. Fracture lines crawl across
 * it, it detonates into shards, and the bottle emerges into warm light - the
 * whole spot is a colour temperature journey from cold to hot.
 */

import {
  W, H, COLOR, rgba, camera, bgGradient, flash, vignette,
  drawBottle, drawIce, makeSplash, makeSparks, makeBubbles,
  clamp, lerp, span, ease, rng, mixHex,
  BEAT, endCard, hookLine, grade, drawKinetic, barWipe,
} from './_kit.js';

const seed = 505;
const rand = rng(seed);
const shards = makeSplash(seed + 1, 52, { speed: 430, spread: Math.PI * 2, aim: 0, gravity: 620, life: 2.6, maxR: 20, colors: ['#DCF2FF', '#B4E2F7', '#FFFFFF'] });
const frost = makeSparks(seed + 2, 80, { minR: 1, maxR: 3.2, twinkle: 3, color: '#EAF8FF' });
const fizz = makeBubbles(seed + 3, 34, { w: 120, h: 300, minR: 2, maxR: 7, speed: 84, color: COLOR.sodaGlow });

// Crack lines: each is a jagged polyline growing from the centre outward.
const CRACKS = Array.from({ length: 9 }, () => {
  const a = rand.range(0, Math.PI * 2);
  const pts = [];
  let x = 0, y = 0, ang = a;
  for (let i = 0; i < 7; i++) {
    ang += rand.range(-0.5, 0.5);
    const step = rand.range(28, 62);
    x += Math.cos(ang) * step;
    y += Math.sin(ang) * step;
    pts.push([x, y]);
  }
  return pts;
});

const T_CRACK = 8.0;
const T_SHATTER = 16.0;

export default {
  id: 'ep05',
  index: 4,
  title: 'Ice Break',
  draw(ctx, t) {
    // The grade warms up across the spot as the ice gives way to the drink.
    const warm = span(t, T_SHATTER, T_SHATTER + 4, ease.inOutCubic);
    bgGradient(ctx, [
      [0, mixHex('#0E2A3C', '#7C2400', warm)],
      [0.5, mixHex('#1C4C66', COLOR.sodaDeep, warm)],
      [1, mixHex('#08161F', '#9C3200', warm)],
    ]);

    const boom = span(t, T_SHATTER, T_SHATTER + 0.3, ease.outQuad);
    camera(ctx, t, {
      zoom: lerp(1.08, 1.3, span(t, BEAT.hero - 2, BEAT.hero + 5, ease.inOutCubic)),
      shake: boom * (1 - span(t, T_SHATTER + 0.2, T_SHATTER + 1.5)) * 26,
      panY: Math.sin(t * 0.2) * 12,
      seed,
    });

    const cx = W / 2, cy = H * 0.5;

    frost(ctx, t, 0.5 * (1 - warm * 0.6));

    /* -------- the ice block -------- */
    const intact = 1 - span(t, T_SHATTER - 0.05, T_SHATTER);
    if (intact > 0) {
      const shiver = span(t, T_CRACK, T_SHATTER, ease.inQuart);
      ctx.save();
      ctx.globalAlpha = intact;
      ctx.translate(cx + Math.sin(t * 40) * 5 * shiver, cy + Math.cos(t * 37) * 4 * shiver);

      // Block body.
      ctx.beginPath();
      ctx.roundRect(-165, -195, 330, 390, 26);
      const g = ctx.createLinearGradient(-165, -195, 165, 195);
      g.addColorStop(0, rgba('#EAF8FF', 0.85));
      g.addColorStop(0.5, rgba('#9FD8F0', 0.7));
      g.addColorStop(1, rgba('#5FA6C8', 0.8));
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = rgba('#FFFFFF', 0.85);
      ctx.lineWidth = 5;
      ctx.stroke();

      // A hint of the bottle frozen inside.
      ctx.save();
      ctx.globalAlpha = 0.3 + shiver * 0.35;
      ctx.translate(0, 150);
      drawBottle(ctx, 280, { fill: 0.9, label: 0.5 });
      ctx.restore();

      // Fractures crawling outward.
      const grow = span(t, T_CRACK, T_SHATTER - 0.5, ease.outCubic);
      if (grow > 0) {
        ctx.save();
        ctx.strokeStyle = rgba('#FFFFFF', 0.95);
        ctx.lineWidth = 3.2;
        ctx.lineCap = 'round';
        for (const pts of CRACKS) {
          const n = Math.floor(grow * pts.length);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          for (let i = 0; i < n; i++) ctx.lineTo(pts[i][0], pts[i][1]);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Specular face.
      ctx.beginPath();
      ctx.roundRect(-125, -160, 60, 300, 22);
      ctx.fillStyle = rgba('#FFFFFF', 0.4);
      ctx.fill();
      ctx.restore();
    }

    /* -------- shatter -------- */
    if (t >= T_SHATTER) {
      ctx.save();
      ctx.translate(cx, cy);
      shards(ctx, t, T_SHATTER, { fade: 1 - span(t, T_SHATTER + 1.8, T_SHATTER + 3.2) });
      ctx.restore();
      // A few tumbling cubes with real geometry among the droplet shards.
      for (let i = 0; i < 7; i++) {
        const lt = t - T_SHATTER;
        if (lt > 3) break;
        const a = (i / 7) * Math.PI * 2;
        const dist = 260 * ease.outQuart(clamp(lt / 1.2)) + lt * 30;
        ctx.save();
        ctx.globalAlpha = 1 - clamp(lt / 3);
        ctx.translate(cx + Math.cos(a) * dist, cy + Math.sin(a) * dist * 0.8 + lt * lt * 130);
        ctx.rotate(lt * (2 + i));
        drawIce(ctx, 0, 0, 46, i);
        ctx.restore();
      }
    }
    flash(ctx, boom * (1 - span(t, T_SHATTER + 0.05, T_SHATTER + 0.5)) * 0.9, '#FFFFFF');

    /* -------- the bottle revealed -------- */
    const reveal = span(t, T_SHATTER + 0.15, T_SHATTER + 1.8, ease.outBack);
    if (reveal > 0) {
      ctx.save();
      ctx.translate(cx, cy + 190);
      ctx.scale(reveal, reveal);
      const glow = ctx.createRadialGradient(0, -160, 20, 0, -160, 340);
      glow.addColorStop(0, rgba(COLOR.sodaGlow, 0.5));
      glow.addColorStop(1, rgba(COLOR.sodaGlow, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(-360, -520, 720, 700);
      drawBottle(ctx, 340, { fill: 0.92, glow: 0.5 });
      fizz(ctx, t, { originY: -70, fade: 0.45, scale: 0.9 });
      ctx.restore();
    }

    ctx.restore(); // camera

    vignette(ctx, 0.5, mixHex('#04121C', '#2A0800', warm));
    hookLine(ctx, t, 'LOCKED IN THE COLD', { at: 1.2, hold: 5.0, size: 48, y: H * 0.16 });

    const heroTxt = span(t, BEAT.hero + 1.3, BEAT.hero + 2.3, ease.outCubic) * (1 - span(t, BEAT.lockup - 0.8, BEAT.lockup));
    if (heroTxt > 0) {
      drawKinetic(ctx, 'BREAK THE COLD OPEN', W / 2, H * 0.14, 46, t - (BEAT.hero + 1.3), {
        mode: 'pop',
        step: 0.028,
        color: COLOR.white,
        outline: rgba('#0A2433', 0.75),
        tracking: 6,
        alpha: heroTxt,
      });
    }

    barWipe(ctx, span(t, BEAT.lockup - 0.5, BEAT.lockup, ease.inCubic), { bars: 9, color: COLOR.sodaDeep });
    endCard(ctx, t, { tagline: 'ICE COLD, FULL ORANGE' });
    grade(ctx, t, 0.32);
  },
};
