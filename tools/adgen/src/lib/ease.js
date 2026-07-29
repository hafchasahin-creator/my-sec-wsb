/**
 * Easing curves and small timeline helpers shared by every episode.
 * All easing functions take and return a normalised 0..1 value.
 */

export const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const mix = lerp;

/** Map v from [a,b] onto 0..1, clamped. The workhorse for scene timing. */
export const norm = (v, a, b) => clamp((v - a) / (b - a));

/** Normalise then shape in one call: span(t, 2, 5, ease.outBack). */
export const span = (v, a, b, fn = (x) => x) => fn(norm(v, a, b));

export const ease = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => t * (2 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuart: (t) => 1 - Math.pow(1 - t, 4),
  inOutQuart: (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2),
  outQuint: (t) => 1 - Math.pow(1 - t, 5),
  inExpo: (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  outExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutExpo: (t) =>
    t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2,
  outBack: (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
  inBack: (t) => 2.70158 * t * t * t - 1.70158 * t * t,
  outElastic: (t) =>
    t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1,
  outBounce: (t) => {
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  },
  /** Rises to 1 then falls back to 0 - for flashes, pops and impacts. */
  pulse: (t) => Math.sin(clamp(t) * Math.PI),
};

/** Fade in over `up` seconds and out over `down`, given local time and duration. */
export function envelope(t, duration, up = 0.4, down = 0.4) {
  return Math.min(norm(t, 0, up), norm(t, duration, duration - down));
}

/** Staggered per-item progress: item i of n starts `stepDelay` after item i-1. */
export function stagger(t, i, stepDelay, dur, fn = ease.outCubic) {
  return span(t, i * stepDelay, i * stepDelay + dur, fn);
}
