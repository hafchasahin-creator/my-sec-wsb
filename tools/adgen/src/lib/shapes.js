/**
 * Product and prop geometry for the Mirinda campaign.
 *
 * Every shape is drawn around its own local origin so episodes can freely
 * translate, rotate and scale them. Sizes are expressed relative to a `h`
 * (height) or `r` (radius) argument rather than hard-coded pixels.
 */

import { COLOR, rgba, vGrad, blobPath } from '../brand.js';
import { clamp, lerp } from './ease.js';
import { rng } from './rng.js';

/* ------------------------------------------------------------------ *
 * Bottle
 * ------------------------------------------------------------------ */

/**
 * PET bottle, origin at the base centre, growing upward.
 *
 * @param {number} h  overall bottle height in px
 * @param {object} opt
 *   fill   0..1 how much liquid is left
 *   tilt   the bottle's own world rotation in radians. The liquid surface is
 *          counter-rotated by this so it stays level with the world however
 *          far the bottle is tipped - without it the contents visibly drain
 *          sideways the moment the bottle turns.
 *   sway   extra slosh on top of level, in radians
 */
export function drawBottle(ctx, h, opt = {}) {
  const { fill = 1, label = 1, cap = COLOR.green, sway = 0, glow = 0, tilt = 0 } = opt;
  const w = h * 0.29; // body width
  const nw = h * 0.115; // neck width
  const bodyTop = -h * 0.72;
  const shoulder = -h * 0.6;

  ctx.save();

  if (glow > 0) {
    ctx.save();
    ctx.shadowColor = rgba(COLOR.sodaLight, 0.9 * glow);
    ctx.shadowBlur = h * 0.22 * glow;
  }

  // --- body silhouette -------------------------------------------------
  const body = () => {
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h * 0.04);
    ctx.quadraticCurveTo(-w / 2 - h * 0.012, -h * 0.012, -w / 2 + h * 0.035, 0);
    ctx.lineTo(w / 2 - h * 0.035, 0);
    ctx.quadraticCurveTo(w / 2 + h * 0.012, -h * 0.012, w / 2, -h * 0.04);
    ctx.lineTo(w / 2, shoulder);
    ctx.quadraticCurveTo(w / 2, bodyTop, nw / 2, bodyTop - h * 0.015);
    ctx.lineTo(nw / 2, -h * 0.9);
    ctx.lineTo(-nw / 2, -h * 0.9);
    ctx.lineTo(-nw / 2, bodyTop - h * 0.015);
    ctx.quadraticCurveTo(-w / 2, bodyTop, -w / 2, shoulder);
    ctx.closePath();
  };

  // Plastic shell - tinted enough to read as a filled pack, not bare outline.
  body();
  ctx.fillStyle = vGrad(ctx, 0, -h, 0, [
    [0, rgba(COLOR.sodaGlow, 0.62)],
    [0.5, rgba(COLOR.orange3, 0.5)],
    [1, rgba(COLOR.sodaShadow, 0.55)],
  ]);
  ctx.fill();

  // --- liquid ----------------------------------------------------------
  if (fill > 0) {
    ctx.save();
    body();
    ctx.clip();
    // Undo the bottle's world rotation so the surface is world-horizontal,
    // then place that surface by remaining volume.
    ctx.rotate(-tilt + sway);
    const surfaceY = lerp(h * 1.05, -h * 1.02, clamp(fill));
    const span = h * 2.4;
    ctx.fillStyle = vGrad(ctx, 0, surfaceY, surfaceY + h, [
      [0, COLOR.sodaLight],
      [0.28, COLOR.sodaCore],
      [1, COLOR.sodaDeep],
    ]);
    ctx.fillRect(-span, surfaceY, span * 2, span);
    // Meniscus highlight along the surface.
    ctx.fillStyle = rgba(COLOR.sodaGlow, 0.8);
    ctx.fillRect(-span, surfaceY - h * 0.008, span * 2, h * 0.016);
    ctx.restore();
  }

  // --- moulded ribs ----------------------------------------------------
  ctx.save();
  body();
  ctx.clip();
  ctx.strokeStyle = rgba(COLOR.sodaShadow, 0.16);
  ctx.lineWidth = h * 0.008;
  for (let i = 0; i < 4; i++) {
    const y = -h * (0.08 + i * 0.045);
    ctx.beginPath();
    ctx.moveTo(-w / 2, y);
    ctx.lineTo(w / 2, y);
    ctx.stroke();
  }
  ctx.restore();

  // --- specular highlights --------------------------------------------
  ctx.save();
  body();
  ctx.clip();
  ctx.fillStyle = rgba(COLOR.white, 0.4);
  ctx.beginPath();
  ctx.roundRect(-w * 0.36, -h * 0.66, w * 0.1, h * 0.56, w * 0.05);
  ctx.fill();
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.roundRect(w * 0.26, -h * 0.6, w * 0.06, h * 0.44, w * 0.03);
  ctx.fill();
  ctx.restore();

  if (glow > 0) ctx.restore();

  // --- label -----------------------------------------------------------
  if (label > 0) {
    ctx.save();
    ctx.globalAlpha *= label;
    const ly = -h * 0.46;
    const lh = h * 0.26;
    ctx.beginPath();
    ctx.roundRect(-w / 2 - h * 0.004, ly, w + h * 0.008, lh, h * 0.012);
    ctx.fillStyle = vGrad(ctx, 0, ly, ly + lh, [
      [0, COLOR.orange1],
      [0.5, COLOR.orange],
      [1, COLOR.sodaDeep],
    ]);
    ctx.fill();
    // Label wordmark, scaled to the bottle.
    ctx.save();
    ctx.translate(0, ly + lh * 0.42);
    ctx.rotate(-0.02);
    drawLabelMark(ctx, w * 0.82);
    ctx.restore();
    // Green foot band.
    ctx.fillStyle = COLOR.green;
    ctx.fillRect(-w / 2, ly + lh * 0.82, w, lh * 0.1);
    ctx.restore();
  }

  // --- cap -------------------------------------------------------------
  ctx.beginPath();
  ctx.roundRect(-nw * 0.62, -h - h * 0.005, nw * 1.24, h * 0.105, h * 0.012);
  ctx.fillStyle = cap;
  ctx.fill();
  ctx.strokeStyle = rgba(COLOR.greenDeep, 0.55);
  ctx.lineWidth = h * 0.004;
  for (let i = -5; i <= 5; i++) {
    ctx.beginPath();
    ctx.moveTo(i * nw * 0.11, -h);
    ctx.lineTo(i * nw * 0.11, -h + h * 0.095);
    ctx.stroke();
  }

  ctx.restore();
}

/** Compact wordmark used on pack labels - too small for the full vector mark. */
function drawLabelMark(ctx, width) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const size = width * 0.235;
  ctx.font = `italic bold ${size}px "Liberation Sans"`;
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.34;
  ctx.strokeStyle = COLOR.white;
  ctx.strokeText('MIRINDA', 0, 0);
  ctx.fillStyle = COLOR.green;
  ctx.fillText('MIRINDA', 0, 0);
  ctx.restore();
}

/* ------------------------------------------------------------------ *
 * Can
 * ------------------------------------------------------------------ */

/** Aluminium can, origin at base centre. */
export function drawCan(ctx, h, opt = {}) {
  const { label = 1, glow = 0, open = false } = opt;
  const w = h * 0.44;
  const r = w * 0.5;

  ctx.save();
  if (glow > 0) {
    ctx.shadowColor = rgba(COLOR.sodaLight, 0.85 * glow);
    ctx.shadowBlur = h * 0.2 * glow;
  }

  // Body with rounded top/bottom rims.
  ctx.beginPath();
  ctx.moveTo(-w / 2, -h * 0.07);
  ctx.lineTo(-w / 2, -h * 0.93);
  ctx.quadraticCurveTo(-w / 2, -h, -w * 0.36, -h);
  ctx.lineTo(w * 0.36, -h);
  ctx.quadraticCurveTo(w / 2, -h, w / 2, -h * 0.93);
  ctx.lineTo(w / 2, -h * 0.07);
  ctx.quadraticCurveTo(w / 2, 0, w * 0.36, 0);
  ctx.lineTo(-w * 0.36, 0);
  ctx.quadraticCurveTo(-w / 2, 0, -w / 2, -h * 0.07);
  ctx.closePath();

  const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
  g.addColorStop(0, COLOR.sodaDeep);
  g.addColorStop(0.18, COLOR.orange);
  g.addColorStop(0.42, COLOR.orange3);
  g.addColorStop(0.55, COLOR.orange1);
  g.addColorStop(1, COLOR.sodaShadow);
  ctx.fillStyle = label > 0 ? g : '#C9CDD2';
  ctx.fill();
  ctx.save();
  ctx.clip();

  if (label > 0) {
    ctx.save();
    ctx.globalAlpha *= label;
    // Green sweep band.
    ctx.fillStyle = rgba(COLOR.green, 0.9);
    ctx.beginPath();
    ctx.moveTo(-w, -h * 0.3);
    ctx.quadraticCurveTo(0, -h * 0.42, w, -h * 0.26);
    ctx.lineTo(w, -h * 0.16);
    ctx.quadraticCurveTo(0, -h * 0.32, -w, -h * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.save();
    ctx.translate(0, -h * 0.56);
    drawLabelMark(ctx, w * 1.02);
    ctx.restore();
    ctx.restore();
  }

  // Vertical specular band.
  ctx.fillStyle = rgba(COLOR.white, 0.3);
  ctx.fillRect(-w * 0.3, -h, w * 0.09, h);
  ctx.fillStyle = rgba(COLOR.white, 0.16);
  ctx.fillRect(w * 0.2, -h, w * 0.05, h);
  ctx.restore();

  // Lid.
  ctx.beginPath();
  ctx.ellipse(0, -h, r, r * 0.2, 0, 0, Math.PI * 2);
  ctx.fillStyle = open ? '#8E949B' : '#C9CDD2';
  ctx.fill();
  ctx.strokeStyle = '#7A8087';
  ctx.lineWidth = h * 0.006;
  ctx.stroke();
  if (open) {
    ctx.beginPath();
    ctx.ellipse(0, -h + h * 0.004, r * 0.5, r * 0.11, 0, 0, Math.PI * 2);
    ctx.fillStyle = COLOR.sodaDeep;
    ctx.fill();
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ *
 * Glass
 * ------------------------------------------------------------------ */

/**
 * Tumbler with liquid, ice and a bubble column. Origin at base centre.
 * `tilt` works exactly as on drawBottle - pass the glass's own world rotation
 * so the liquid surface stays level when the glass is tipped.
 */
export function drawGlass(ctx, h, opt = {}) {
  const { fill = 0.7, sway = 0, ice = 0, bubbles = null, tilt = 0 } = opt;
  const wTop = h * 0.52;
  const wBot = h * 0.4;

  const body = () => {
    ctx.beginPath();
    ctx.moveTo(-wBot / 2, 0);
    ctx.lineTo(-wTop / 2, -h);
    ctx.lineTo(wTop / 2, -h);
    ctx.lineTo(wBot / 2, 0);
    ctx.closePath();
  };

  ctx.save();

  // Liquid.
  if (fill > 0) {
    ctx.save();
    body();
    ctx.clip();
    const surfaceY = -h * clamp(fill);
    ctx.save();
    ctx.rotate(-tilt + sway);
    ctx.fillStyle = vGrad(ctx, 0, surfaceY, surfaceY + h, [
      [0, COLOR.sodaLight],
      [0.3, COLOR.sodaCore],
      [1, COLOR.sodaDeep],
    ]);
    ctx.fillRect(-wTop * 2, surfaceY, wTop * 4, h * 2.2);
    ctx.fillStyle = rgba(COLOR.sodaGlow, 0.85);
    ctx.beginPath();
    ctx.ellipse(0, surfaceY, wTop * 0.55, h * 0.022, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (bubbles) bubbles(ctx, surfaceY, wTop, h);

    // Ice cubes floating at the surface.
    for (let i = 0; i < ice; i++) {
      const px = (i - (ice - 1) / 2) * wTop * 0.26;
      drawIce(ctx, px, surfaceY + h * 0.05 + (i % 2) * h * 0.05, h * 0.13, i * 0.6);
    }
    ctx.restore();
  }

  // Glass walls and rim.
  body();
  ctx.strokeStyle = rgba(COLOR.white, 0.55);
  ctx.lineWidth = h * 0.016;
  ctx.stroke();
  ctx.fillStyle = rgba(COLOR.white, 0.08);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, -h, wTop / 2, h * 0.035, 0, 0, Math.PI * 2);
  ctx.strokeStyle = rgba(COLOR.white, 0.7);
  ctx.lineWidth = h * 0.012;
  ctx.stroke();
  // Left specular edge.
  ctx.strokeStyle = rgba(COLOR.white, 0.5);
  ctx.lineWidth = h * 0.02;
  ctx.beginPath();
  ctx.moveTo(-wBot * 0.36, -h * 0.08);
  ctx.lineTo(-wTop * 0.42, -h * 0.9);
  ctx.stroke();
  ctx.restore();
}

/* ------------------------------------------------------------------ *
 * Props
 * ------------------------------------------------------------------ */

/** Translucent ice cube with a rotating highlight. */
export function drawIce(ctx, x, y, s, phase = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.sin(phase) * 0.25);
  ctx.beginPath();
  ctx.roundRect(-s / 2, -s / 2, s, s, s * 0.22);
  ctx.fillStyle = rgba(COLOR.white, 0.42);
  ctx.fill();
  ctx.strokeStyle = rgba(COLOR.white, 0.7);
  ctx.lineWidth = s * 0.07;
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(-s * 0.28, -s * 0.3, s * 0.22, s * 0.34, s * 0.08);
  ctx.fillStyle = rgba(COLOR.white, 0.75);
  ctx.fill();
  ctx.restore();
}

/** Orange half-slice seen face on: rind, pith, segments, seeds. */
export function drawOrangeSlice(ctx, r, opt = {}) {
  const { segments = 9, detail = 1, rind = COLOR.sodaDeep } = opt;
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = rind;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.92, 0, Math.PI * 2);
  ctx.fillStyle = COLOR.orange5;
  ctx.fill();

  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2 + 0.035;
    const a1 = ((i + 1) / segments) * Math.PI * 2 - 0.035;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r * 0.85, a0, a1);
    ctx.closePath();
    const g = ctx.createRadialGradient(0, 0, r * 0.05, 0, 0, r * 0.85);
    g.addColorStop(0, COLOR.sodaLight);
    g.addColorStop(1, COLOR.sodaCore);
    ctx.fillStyle = g;
    ctx.fill();
    if (detail > 0) {
      // Juice vesicle streaks.
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = rgba(COLOR.sodaGlow, 0.5 * detail);
      ctx.lineWidth = r * 0.018;
      for (let k = 1; k <= 5; k++) {
        const a = a0 + ((a1 - a0) * k) / 6;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.12, Math.sin(a) * r * 0.12);
        ctx.lineTo(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  // Core.
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.09, 0, Math.PI * 2);
  ctx.fillStyle = COLOR.orange6;
  ctx.fill();
  ctx.restore();
}

/** Whole orange with a leaf, drawn as a lit sphere. */
export function drawWholeOrange(ctx, r, opt = {}) {
  const { leaf = true, t = 0 } = opt;
  ctx.save();
  const g = ctx.createRadialGradient(-r * 0.32, -r * 0.36, r * 0.08, 0, 0, r * 1.12);
  g.addColorStop(0, COLOR.sodaLight);
  g.addColorStop(0.45, COLOR.sodaCore);
  g.addColorStop(1, COLOR.sodaShadow);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  // Peel pores.
  ctx.save();
  ctx.clip();
  ctx.fillStyle = rgba(COLOR.sodaShadow, 0.16);
  for (let i = 0; i < 26; i++) {
    const a = i * 2.399;
    const rr = r * Math.sqrt(i / 26) * 0.94;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, r * 0.022, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.beginPath();
  ctx.ellipse(-r * 0.34, -r * 0.4, r * 0.24, r * 0.15, -0.6, 0, Math.PI * 2);
  ctx.fillStyle = rgba(COLOR.white, 0.45);
  ctx.fill();
  if (leaf) drawLeaf(ctx, r * 0.22, -r * 0.98, r * 0.8, -0.5 + Math.sin(t * 1.6) * 0.12);
  ctx.restore();
}

/** Single leaf with a midrib, rooted at (x, y) and rotated by `angle`. */
export function drawLeaf(ctx, x, y, len, angle = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.42, -len * 0.42, len, 0);
  ctx.quadraticCurveTo(len * 0.42, len * 0.28, 0, 0);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, len, 0);
  g.addColorStop(0, COLOR.leafDark);
  g.addColorStop(0.6, COLOR.leaf);
  g.addColorStop(1, COLOR.greenLight);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = rgba(COLOR.greenDeep, 0.6);
  ctx.lineWidth = len * 0.035;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.5, -len * 0.08, len, 0);
  ctx.stroke();
  ctx.restore();
}

/**
 * Condensation droplets scattered over a product surface. Positions are baked
 * once from the seed so the beads stay put frame to frame.
 */
export function makeCondensation(seed, w, h, count = 40) {
  const r = rng(seed);
  const beads = Array.from({ length: count }, () => ({
    x: r.range(-w / 2, w / 2),
    y: r.range(-h, 0),
    r: r.range(w * 0.012, w * 0.045),
  }));
  return function draw(ctx, alpha = 0.5) {
    if (alpha <= 0) return;
    ctx.save();
    for (const b of beads) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = rgba(COLOR.white, 0.22 * alpha);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.32, b.r * 0.34, 0, Math.PI * 2);
      ctx.fillStyle = rgba(COLOR.white, 0.75 * alpha);
      ctx.fill();
    }
    ctx.restore();
  };
}

/**
 * Liquid crown / splash ring - the classic milk-drop silhouette.
 * The spike jitter is a deterministic function of angle, not random per call,
 * so the crown stays stable across frames instead of flickering.
 */
export function drawCrown(ctx, r, progress, spikes = 12, seed = 0) {
  const p = clamp(progress);
  if (p <= 0) return;
  const rise = Math.sin(p * Math.PI);
  ctx.save();
  blobPath(
    ctx,
    (a) => {
      const spike = Math.pow(Math.abs(Math.cos((a * spikes) / 2)), 6);
      const jitter = 1 + 0.08 * Math.sin(a * 5 + seed) + 0.05 * Math.sin(a * 11 - seed * 2);
      return r * (0.55 + p * 0.5) * (1 + spike * 0.5 * rise) * jitter;
    },
    spikes * 8,
    0.4
  );
  ctx.fillStyle = vGrad(ctx, 0, -r, r * 0.4, [
    [0, COLOR.sodaLight],
    [1, COLOR.sodaDeep],
  ]);
  ctx.fill();
  ctx.restore();
}
