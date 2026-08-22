/* Easing and shaping functions. Kept in one place so the web build and the
 * Android build can be checked against the same definitions. */

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a, b, t) => a + (b - a) * t;

/** Hermite smoothstep. C1 continuous at both ends — no visible corner. */
export const smooth = (t) => {
  t = clamp01(t);
  return t * t * (3 - 2 * t);
};

/** Quintic smootherstep. C2 continuous; used where a corner would be visible. */
export const smoother = (t) => {
  t = clamp01(t);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

export const easeOutCubic = (t) => 1 - Math.pow(1 - clamp01(t), 3);
export const easeInCubic = (t) => Math.pow(clamp01(t), 3);
export const easeInOutSine = (t) => -(Math.cos(Math.PI * clamp01(t)) - 1) / 2;

/**
 * The breath curve.
 *
 * A sine wave is the wrong shape: real breathing has a shorter inhale, a longer
 * exhale, and a rest at the bottom. Sine gives equal in/out and no pause, which
 * is why sine-breathing characters read as "pulsing" rather than "sleeping".
 *
 *   phase 0.00 .. 0.38  inhale   0 -> 1
 *   phase 0.38 .. 0.84  exhale   1 -> 0
 *   phase 0.84 .. 1.00  rest     held at 0
 *
 * Zero derivative at every junction, so the loop is seamless.
 */
export function breath(phase) {
  const p = phase - Math.floor(phase);
  if (p < 0.38) return smooth(p / 0.38);
  if (p < 0.84) return 1 - smooth((p - 0.38) / 0.46);
  return 0;
}

/** Fractional part, guarding against negative inputs. */
export const frac = (x) => x - Math.floor(x);
