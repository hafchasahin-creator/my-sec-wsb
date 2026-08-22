/*
 * Deterministic, non-repeating scheduling.
 *
 * Everything Clawd does at "random" — blinks, twitches, Zzz spawns — is driven by
 * a low-discrepancy sequence rather than Math.random(). Two reasons:
 *
 *   1. Math.random() clusters. Over eight hours you get visible bunching: five
 *      blinks in three seconds, then nothing for twenty. A golden-ratio sequence
 *      is maximally evenly spread, which is what a calm creature actually looks
 *      like.
 *   2. It is reproducible, so an animation bug is reproducible.
 */

const PHI = 0.6180339887498949; // frac(golden ratio)

/** Additive recurrence. Successive values never repeat and never clump. */
export function makeSequence(seed = 0) {
  let x = seed % 1;
  return () => {
    x += PHI;
    if (x >= 1) x -= 1;
    return x;
  };
}

/**
 * A self-scheduling event source. Ask it `due(now)` every frame; it returns true
 * exactly once per interval, with each interval drawn evenly from [min, max].
 */
export function makeScheduler(minSec, maxSec, seed = 0) {
  const next = makeSequence(seed);
  let at = -1;
  let last = 0;
  return {
    /** Returns the 0..1 sequence value that fired, or -1 if nothing is due. */
    due(now) {
      if (at < 0) {
        at = now + minSec + (maxSec - minSec) * next();
        return -1;
      }
      if (now < at) return -1;
      last = next();
      at = now + minSec + (maxSec - minSec) * last;
      return last;
    },
    /** Re-arm, e.g. after the animation state changes. */
    reset(now, delay = 0) {
      at = now + delay;
    },
    setRange(minS, maxS) {
      minSec = minS;
      maxSec = maxS;
    },
  };
}

/**
 * mulberry32 — a small, fast, well-distributed PRNG.
 *
 * Use this for anything spatial. A golden-ratio additive recurrence is perfect
 * for scheduling on ONE axis, but feeding consecutive values into (x, y) lays
 * every point on a lattice: the star field came out as neat diagonal arcs the
 * first time. Low discrepancy in 1-D is not low discrepancy in 2-D.
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
