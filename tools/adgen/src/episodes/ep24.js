/**
 * Episode 24 - "Crown Splash"
 *
 * Macro and slow. The camera sits at liquid level while a single drop strikes a
 * shallow orange pool over and over, each impact bigger than the last. Extreme
 * close-up, shallow framing, almost no graphic elements - all texture.
 */

import {
  W, H, COLOR, rgba, camera, bgGradient, vignette, flash,
  drawCrown, drawBlob, drawBottle, makeSplash, makeBubbles,
  clamp, lerp, span, ease, rng,
  BEAT, endCard, hookLine, grade, drawKinetic,
} from './_kit.js';

const seed = 2424;
const rand = rng(seed);

const POOL_Y = H * 0.66;

// Five strikes, escalating in size and slowing down as they go.
const STRIKES = [
  { at: 4.0, r: 70, drop: 22 },
  { at: 9.0, r: 105, drop: 30 },
  { at: 14.5, r: 150, drop: 40 },
  { at: 20.5, r: 205, drop: 52 },
  { at: 27.0, r: 270, drop: 66 },
].map((s, i) => ({
  ...s,
  spray: makeSplash(seed + 10 + i, 40 + i * 8, {
    speed: 300 + i * 90,
    aim: -Math.PI / 2,
    spread: Math.PI * 0.9,
    gravity: 700,
    life: 2.2,
    maxR: 8 + i * 3,
  }),
}));

const under = makeBubbles(seed + 2, 60, { w: W, h: 300, minR: 3, maxR: 14, speed: 34, color: COLOR.sodaGlow, alpha: 0.5 });

export default {
  id: 'ep24',
  index: 23,
  title: 'Crown Splash',
  draw(ctx, t) {
    bgGradient(ctx, [
      [0, '#FFD9A0'],
      [0.3, COLOR.sodaLight],
      [0.64, COLOR.sodaCore],
      [0.66, '#C44A00'],
      [1, '#5E1A00'],
    ]);

    // Find the current strike for shake / flash / ripple.
    let shake = 0, fl = 0, ripple = 0;
    for (const s of STRIKES) {
      const k = span(t, s.at, s.at + 0.25, ease.outQuad) * (1 - span(t, s.at + 0.2, s.at + 1.4));
      shake = Math.max(shake, k * (s.r / 12));
      fl = Math.max(fl, span(t, s.at, s.at + 0.1, ease.outQuad) * (1 - span(t, s.at + 0.08, s.at + 0.5)));
      ripple = Math.max(ripple, k);
    }

    camera(ctx, t, {
      // Very slow creep in - macro lenses do not move fast.
      zoom: lerp(1.14, 1.42, span(t, 0, BEAT.lockup, ease.inOutCubic)),
      fy: POOL_Y,
      panX: Math.sin(t * 0.09) * 10,
      shake,
      seed,
    });

    /* -------- the pool -------- */
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(0, POOL_Y);
    for (let x = 0; x <= W; x += 8) {
      const d = Math.abs(x - W / 2);
      const wave =
        Math.sin(x / 90 - t * 2.2) * 5 +
        Math.sin(x / 34 + t * 3.1) * 2.6 +
        ripple * 26 * Math.exp(-(d * d) / 90000) * Math.sin(d / 40 - t * 14);
      ctx.lineTo(x, POOL_Y + wave);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    const pg = ctx.createLinearGradient(0, POOL_Y, 0, H);
    pg.addColorStop(0, COLOR.sodaLight);
    pg.addColorStop(0.2, COLOR.sodaCore);
    pg.addColorStop(1, '#5E1A00');
    ctx.fillStyle = pg;
    ctx.fill();
    ctx.restore();

    // Bubbles clinging under the surface.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, POOL_Y, W, H - POOL_Y);
    ctx.clip();
    under(ctx, t, { originX: W / 2, originY: H + 40, fade: 0.5 });
    ctx.restore();

    /* -------- strikes -------- */
    for (const s of STRIKES) {
      const lt = t - s.at;
      // Falling drop before the hit.
      const fall = span(t, s.at - 1.4, s.at, ease.inQuad);
      if (fall > 0 && fall < 1) {
        const dy = lerp(-60, POOL_Y, fall);
        const stretch = 1 + fall * 1.3;
        ctx.save();
        ctx.translate(W / 2, dy);
        ctx.scale(1 / Math.sqrt(stretch), stretch);
        drawBlob(ctx, 0, 0, s.drop, t, { seed: 5 });
        ctx.restore();
      }
      if (lt < 0 || lt > 2.6) continue;
      ctx.save();
      ctx.translate(W / 2, POOL_Y);
      drawCrown(ctx, s.r, span(lt, 0, 1.1), 14, s.at);
      s.spray(ctx, lt, 0, { fade: 1 - span(lt, 1.5, 2.4) });
      ctx.restore();
      // Rebound jet.
      const jet = span(lt, 0.5, 1.5, ease.outCubic) * (1 - span(lt, 1.3, 2.2));
      if (jet > 0) {
        ctx.save();
        ctx.translate(W / 2, POOL_Y - jet * s.r * 1.5);
        drawBlob(ctx, 0, 0, s.drop * 0.85, t, { seed: 9, squash: 1.5 });
        ctx.restore();
      }
    }

    /* -------- the pack rises from the pool -------- */
    const rise = span(t, BEAT.hero - 1, BEAT.hero + 3, ease.inOutCubic);
    if (rise > 0) {
      ctx.save();
      ctx.translate(W / 2, lerp(H + 300, POOL_Y + 190, rise));
      const glow = ctx.createRadialGradient(0, -180, 10, 0, -180, 340);
      glow.addColorStop(0, rgba(COLOR.sodaGlow, 0.45));
      glow.addColorStop(1, rgba(COLOR.sodaGlow, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(-360, -520, 720, 680);
      drawBottle(ctx, 340, { fill: 0.92, glow: 0.5 });
      ctx.restore();
    }

    ctx.restore(); // camera

    flash(ctx, fl * 0.4, COLOR.sodaGlow);
    vignette(ctx, 0.5, '#3A0E00');

    hookLine(ctx, t, 'WATCH IT LAND', { at: 1.0, hold: 4.0, size: 54, y: H * 0.14 });

    const heroTxt = span(t, BEAT.hero + 2, BEAT.hero + 3, ease.outCubic) * (1 - span(t, BEAT.lockup - 0.8, BEAT.lockup));
    if (heroTxt > 0) {
      drawKinetic(ctx, 'PURE ORANGE, UP CLOSE', W / 2, H * 0.12, 44, t - (BEAT.hero + 2), {
        mode: 'pop',
        step: 0.026,
        color: COLOR.white,
        outline: rgba('#5E1A00', 0.8),
        tracking: 5,
        alpha: heroTxt,
      });
    }

    endCard(ctx, t, { tagline: 'BURSTING WITH ORANGE' });
    grade(ctx, t, 0.26);
  },
};
