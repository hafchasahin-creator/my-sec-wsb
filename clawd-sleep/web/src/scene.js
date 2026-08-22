/*
 * The night.
 *
 * One canvas holds the whole environment: a static star field, a handful of stars
 * that breathe, a horizon that is barely there, and Clawd.
 *
 * The expensive part (150-odd stars and two gradients) is rasterised once into an
 * offscreen canvas and blitted each frame. Only ~16 stars are recomputed per frame.
 * Animating all of them would cost 10x for something nobody can see.
 *
 * The whole composite also drifts on a very slow Lissajous path. That is not
 * decoration — it is the OLED burn-in mitigation. Nothing sits on the same
 * physical pixel for more than a few minutes across an eight-hour night.
 */

import { createClawd, W as CW, H as CH, AWAKE, DROWSY, ASLEEP } from './clawd.js';
import { smooth, clamp, clamp01, lerp } from './ease.js';
import { makeSequence, makeScheduler, mulberry32 } from './rng.js';

const STAR_COUNT = 150;
const TWINKLE_COUNT = 16;

// Burn-in drift: two slow, coprime-ish periods so the path fills an area rather
// than retracing a line. +/-11px over ~23 and ~31 minutes is invisible to a
// watching human and plenty to spread the load across pixels.
const DRIFT = { ax: 11, ay: 9, tx: 1404, ty: 1907 };

export function createScene(canvas, opts = {}) {
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  const clawd = createClawd({ reducedMotion: opts.reducedMotion });

  let dpr = 1, cssW = 0, cssH = 0;
  let stars = [];           // {x,y,r,a} in css px
  let twinkle = [];         // indices into stars
  let bg = null;            // offscreen static layer
  let bgCtx = null;
  let landscape = false;

  const meteorSched = makeScheduler(190, 420, 0.409);
  let meteor = null;

  const view = {
    /** 0 = full interface, 1 = deep sleep mode. Drives dimming. */
    dim: 0,
    amoled: false,
    /** Master scene opacity so the app can fade the whole night in on launch. */
    reveal: 0,
    meteors: true,
  };

  // ---- layout ------------------------------------------------------------
  function resize() {
    const rect = canvas.getBoundingClientRect();
    // Cap DPR at 2: a 3x buffer costs 2.25x the fill rate all night for no
    // visible gain on a scene made of soft dots.
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cssW = Math.max(1, Math.round(rect.width));
    cssH = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    landscape = cssW > cssH * 1.15;
    buildStars();
    paintStatic();
  }

  function buildStars() {
    const rnd = mulberry32(0x5EED57A2);
    stars = [];
    // Stars thin out toward the bottom of the frame, where the horizon glow is.
    const n = Math.round(STAR_COUNT * clamp((cssW * cssH) / (390 * 780), 0.55, 1.9));
    for (let i = 0; i < n; i++) {
      const x = rnd() * cssW;
      const v = rnd();
      const y = Math.pow(rnd(), 0.72) * cssH; // biased upward
      const near = clamp01(1 - y / cssH);
      stars.push({
        x,
        y,
        r: lerp(0.42, 1.35, v * v),           // most stars tiny, a few larger
        a: lerp(0.10, 0.62, v) * lerp(0.35, 1, near),
        p: rnd() * 1000,                       // twinkle phase
        s: lerp(7, 19, rnd()),                 // twinkle period, seconds
      });
    }
    // The twinkling subset is the brightest few. A Set, because the static
    // paint loop tests membership once per star.
    twinkle = new Set(
      stars.map((s, i) => [s.a, i])
        .sort((a, b) => b[0] - a[0])
        .slice(0, TWINKLE_COUNT)
        .map((p) => p[1])
    );
  }

  function paintStatic() {
    if (!bg) { bg = document.createElement('canvas'); bgCtx = bg.getContext('2d'); }
    // Oversize by the drift amplitude so the drift never exposes an edge.
    const padX = DRIFT.ax + 2, padY = DRIFT.ay + 2;
    bg.width = Math.round((cssW + padX * 2) * dpr);
    bg.height = Math.round((cssH + padY * 2) * dpr);
    const g = bgCtx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, bg.width, bg.height);
    g.translate(padX, padY);

    // Sky: near-black at the crown, the faintest navy toward the horizon.
    const sky = g.createLinearGradient(0, 0, 0, cssH);
    sky.addColorStop(0, '#04060C');
    sky.addColorStop(0.62, '#070A13');
    sky.addColorStop(1, '#0A0F1C');
    g.fillStyle = sky;
    g.fillRect(-padX, -padY, cssW + padX * 2, cssH + padY * 2);

    // Horizon: one wide, very low-contrast pool of light under Clawd's feet.
    // This is what stops the frame reading as a flat black rectangle.
    const hx = cssW / 2;
    const hy = cssH * (landscape ? 0.92 : 0.80);
    const hr = Math.max(cssW, cssH) * 0.72;
    const glow = g.createRadialGradient(hx, hy, 0, hx, hy, hr);
    glow.addColorStop(0, 'rgba(46,64,104,0.30)');
    glow.addColorStop(0.45, 'rgba(28,40,70,0.13)');
    glow.addColorStop(1, 'rgba(10,15,28,0)');
    g.fillStyle = glow;
    g.fillRect(-padX, -padY, cssW + padX * 2, cssH + padY * 2);

    // Static stars.
    for (let i = 0; i < stars.length; i++) {
      if (twinkle.has(i)) continue;
      const s = stars[i];
      g.globalAlpha = s.a;
      g.fillStyle = s.r > 1.0 ? '#DDE6FF' : '#C3CFEA';
      g.beginPath();
      g.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
    bg._pad = { x: padX, y: padY };
  }

  // ---- Clawd's place in the frame ---------------------------------------
  function clawdLayout() {
    // Clawd is generously sized and sits above centre in portrait so the controls
    // below have room without crowding him.
    const maxW = landscape ? cssW * 0.30 : cssW * 0.62;
    const maxH = landscape ? cssH * 0.52 : cssH * 0.34;
    const scale = Math.min(maxW / CW, maxH / CH);
    return {
      cx: cssW / 2,
      cy: landscape ? cssH * 0.46 : cssH * 0.355,
      scale,
    };
  }

  // ---- per-frame ---------------------------------------------------------
  function update(now, dt) {
    clawd.update(now, dt);
    if (view.meteors && !opts.reducedMotion) {
      if (!meteor && meteorSched.due(now) >= 0) {
        const seq = mulberry32((now * 1000) | 0);
        meteor = {
          born: now,
          life: 2.1,
          x: lerp(0.08, 0.92, seq()) * cssW,
          y: lerp(0.06, 0.34, seq()) * cssH,
          dx: lerp(-1, 1, seq()) * cssW * 0.16,
          dy: cssH * 0.11,
        };
      }
      if (meteor && now - meteor.born > meteor.life) meteor = null;
    } else {
      meteor = null;
    }
  }

  function draw(now) {
    const dimK = view.dim;
    // In sleep mode everything except Clawd and the sky recedes.
    const starAlpha = lerp(1, 0.5, dimK);
    const clawdAlpha = lerp(0.92, 0.58, dimK) * view.reveal;

    const dx = Math.sin((now / DRIFT.tx) * Math.PI * 2) * DRIFT.ax;
    const dy = Math.sin((now / DRIFT.ty) * Math.PI * 2 + 2.2) * DRIFT.ay;

    if (view.amoled) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, cssW, cssH);
    } else {
      ctx.fillStyle = '#04060C';
      ctx.fillRect(0, 0, cssW, cssH);
    }

    if (view.reveal <= 0.002) return;

    const pad = bg._pad;
    ctx.save();
    ctx.globalAlpha = starAlpha * view.reveal * (view.amoled ? 0.82 : 1);
    ctx.drawImage(bg, 0, 0, bg.width, bg.height,
      -pad.x + dx, -pad.y + dy, cssW + pad.x * 2, cssH + pad.y * 2);
    ctx.restore();

    // twinkling subset
    ctx.save();
    ctx.translate(dx, dy);
    for (const i of twinkle) {
      const s = stars[i];
      const k = 0.62 + 0.38 * Math.sin(((now + s.p) / s.s) * Math.PI * 2);
      ctx.globalAlpha = s.a * k * starAlpha * view.reveal * (view.amoled ? 0.82 : 1);
      ctx.fillStyle = '#E4ECFF';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (meteor) drawMeteor(now);

    const L = clawdLayout();
    clawd.draw(ctx, now, L.cx, L.cy, L.scale, clawdAlpha);
    ctx.restore();
  }

  function drawMeteor(now) {
    const p = clamp01((now - meteor.born) / meteor.life);
    // fade in and out; never a bright streak, just a suggestion of one
    const a = Math.sin(p * Math.PI) * 0.34 * lerp(1, 0.4, view.dim) * view.reveal;
    if (a <= 0.004) return;
    const x = meteor.x + meteor.dx * p;
    const y = meteor.y + meteor.dy * p;
    const tail = 34;
    const g = ctx.createLinearGradient(x, y, x - meteor.dx * 0.14 - tail * 0.2, y - tail);
    g.addColorStop(0, `rgba(226,236,255,${a})`);
    g.addColorStop(1, 'rgba(226,236,255,0)');
    ctx.strokeStyle = g;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - meteor.dx * 0.14 - tail * 0.2, y - tail);
    ctx.stroke();
  }

  return {
    canvas, ctx, clawd, view,
    resize, update, draw,
    get landscape() { return landscape; },
    clawdLayout,
    setReducedMotion(v) { opts.reducedMotion = v; clawd.reducedMotion = v; },
  };
}

export { AWAKE, DROWSY, ASLEEP };
