/*
 * Sleep Mode.
 *
 * One button. Once it is on, the app has to survive being ignored for eight
 * hours: the screen stays lit, the interface recedes until only Clawd and one
 * line of text remain, and — the requirement that matters most — nothing a
 * sleeping person's hand or duvet does to the glass can change the music.
 *
 * Accidental-touch defence is a two-step gesture, because either half alone
 * fails in a real bed:
 *   - a hold alone: a duvet resting on the screen holds forever
 *   - a tap alone: obviously
 * So: tap anywhere to raise the exit dot, then hold the dot for 900ms. A limb
 * would have to tap, find a 56px target, and stay there deliberately.
 */

import { clamp01, smooth, lerp } from './ease.js';

export const HOLD_MS = 900;
export const REVEAL_MS = 4200;

export function createSleepMode({ scene, audio, wakeLock, onChange = () => {} }) {
  const st = {
    active: false,
    /** 0..1 easing of the whole transition; drives every visual change. */
    t: 0,
    /** How far the scene has settled after the transition. Slower than `t`. */
    settle: 0,
    revealUntil: 0,
    holding: false,
    holdStart: 0,
    holdProgress: 0,
    startedAt: 0,
    amoled: false,
    /** Extra black overlay, 0..0.85. The web cannot set real screen brightness. */
    dimOverlay: 0,
  };

  let raf = null;

  async function enter() {
    if (st.active) return;
    st.active = true;
    st.startedAt = Date.now();
    st.revealUntil = performance.now() + REVEAL_MS;
    scene.clawd.setMode('asleep', performance.now() / 1000);
    await wakeLock.enable();
    onChange(st);
  }

  async function exit() {
    if (!st.active) return;
    st.active = false;
    st.holding = false;
    st.holdProgress = 0;
    scene.clawd.setMode('awake', performance.now() / 1000);
    await wakeLock.disable();
    onChange(st);
  }

  async function toggle() { return st.active ? exit() : enter(); }

  /**
   * Advance the transition. Called from the render loop so it stays in step with
   * the scene rather than fighting a CSS transition.
   */
  function update(dt) {
    const target = st.active ? 1 : 0;
    // Entering is deliberately slower than leaving: sinking takes time, waking
    // up should feel immediate.
    const tau = st.active ? 0.42 : 0.16;
    st.t += (target - st.t) * (1 - Math.exp(-dt / tau));
    if (Math.abs(st.t - target) < 0.001) st.t = target;

    // The scene keeps dimming for ~24s after the controls have gone, so the
    // room gets darker gradually instead of snapping to a new brightness.
    const settleTarget = st.active ? 1 : 0;
    st.settle += (settleTarget - st.settle) * (1 - Math.exp(-dt / (st.active ? 8.0 : 0.5)));

    scene.view.dim = st.active ? lerp(st.t * 0.55, 1, st.settle) * 1 : st.t;
    scene.view.amoled = st.amoled;
    scene.view.meteors = !st.active || st.settle < 0.6;

    if (st.holding) {
      st.holdProgress = clamp01((performance.now() - st.holdStart) / HOLD_MS);
      if (st.holdProgress >= 1) { st.holding = false; exit(); }
    } else if (st.holdProgress > 0) {
      st.holdProgress = Math.max(0, st.holdProgress - dt * 3.2);
    }
  }

  /** How visible the exit affordance is right now, 0..1. */
  function exitOpacity(nowMs) {
    if (!st.active) return 0;
    const revealed = nowMs < st.revealUntil;
    const base = 0.10;                       // never fully invisible: it is a target
    if (!revealed) return base;
    const left = (st.revealUntil - nowMs) / 900;
    return lerp(base, 0.85, clamp01(left));
  }

  function poke() {
    if (!st.active) return;
    st.revealUntil = performance.now() + REVEAL_MS;
  }

  function beginHold() {
    if (!st.active) return;
    st.holding = true;
    st.holdStart = performance.now();
  }
  function endHold() { st.holding = false; }

  return {
    state: st, enter, exit, toggle, update, exitOpacity, poke, beginHold, endHold,
    setAmoled(v) { st.amoled = !!v; },
    setDimOverlay(v) { st.dimOverlay = clamp01(v); },
    get active() { return st.active; },
    get elapsedMs() { return st.startedAt ? Date.now() - st.startedAt : 0; },
  };
}
