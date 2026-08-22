/*
 * Sleep timer and alarm.
 *
 * The timer does not stop the music; it *lands* it. Audio tapers over the last
 * 90 seconds on a perceptual curve, so what wakes you is nothing at all — by the
 * time silence arrives you have not noticed the last two minutes.
 *
 * When it expires the screen stays lit, because the user pressed a button that
 * promised exactly that. Releasing it is a setting, not a surprise.
 */

import { clamp01 } from './ease.js';

export const TIMER_OPTIONS = [0, 15, 30, 45, 60, 90];
export const TAPER_SECONDS = 90;

export function createTimer({ audio, onTick = () => {}, onExpire = () => {} }) {
  let endsAt = 0;
  let minutes = 0;
  let tapering = false;
  let handle = null;

  function stop() {
    if (handle) { clearInterval(handle); handle = null; }
    endsAt = 0; minutes = 0; tapering = false;
    audio.fadeMaster(1, 0.6);
    onTick(null);
  }

  function set(mins) {
    if (handle) { clearInterval(handle); handle = null; }
    minutes = mins | 0;
    tapering = false;
    audio.fadeMaster(1, 0.6);
    if (!minutes) { endsAt = 0; onTick(null); return; }
    endsAt = Date.now() + minutes * 60_000;
    handle = setInterval(tick, 500);
    tick();
  }

  function tick() {
    if (!endsAt) return;
    // Date.now() rather than an accumulated counter: an accumulated counter
    // drifts, and drifts *badly* once the tab is throttled in the background.
    const left = endsAt - Date.now();
    if (left <= 0) {
      const wasMinutes = minutes;
      stop();
      onExpire(wasMinutes);
      return;
    }
    if (!tapering && left <= TAPER_SECONDS * 1000) {
      tapering = true;
      audio.fadeMaster(0.0, left / 1000);
    }
    onTick({ remainingMs: left, minutes, tapering });
  }

  /** Re-read the clock after the page was hidden; catches throttled intervals. */
  function resync() { if (endsAt) tick(); }

  return {
    set, stop, resync,
    get minutes() { return minutes; },
    get remainingMs() { return endsAt ? Math.max(0, endsAt - Date.now()) : 0; },
    get active() { return !!endsAt; },
    dispose() { if (handle) clearInterval(handle); handle = null; },
  };
}

/**
 * A gentle alarm.
 *
 * Synthesised, not a sample: a soft two-note figure that starts near silence and
 * takes 40 seconds to reach a level that would actually wake someone. Nothing
 * about waking up should feel like an emergency.
 *
 * On the web this is best-effort and we say so — a backgrounded tab gets its
 * timers throttled and there is no reliable browser API for "wake me at 7". The
 * Android build uses AlarmManager.setAlarmClock, which is exact and survives Doze.
 */
export function createAlarm(audio) {
  let timeout = null;
  let ringing = false;
  let nodes = [];
  let at = 0;

  function cancel() {
    if (timeout) clearTimeout(timeout);
    timeout = null;
    at = 0;
    silence();
  }

  function silence() {
    ringing = false;
    for (const n of nodes) { try { n.stop?.(); n.disconnect?.(); } catch {} }
    nodes = [];
  }

  /** @param hhmm "07:30" */
  function schedule(hhmm, onRing = () => {}) {
    cancel();
    if (!hhmm) return 0;
    const [h, m] = hhmm.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
    const now = new Date();
    const target = new Date(now);
    target.setHours(h, m, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    at = target.getTime();
    // Re-check every 30s instead of one long timeout: a single multi-hour
    // setTimeout is the first thing a throttled tab gets wrong, and it also
    // breaks across a DST change or a manual clock adjustment.
    const poll = () => {
      if (!at) return;
      const left = at - Date.now();
      if (left <= 250) { at = 0; ring(); onRing(); return; }
      timeout = setTimeout(poll, Math.min(30_000, Math.max(250, left - 100)));
    };
    poll();
    return at;
  }

  function ring() {
    const ctx = audio.ensure();
    audio.unlock();
    ringing = true;
    const t0 = ctx.currentTime + 0.1;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, t0);
    bus.gain.exponentialRampToValueAtTime(0.28, t0 + 40); // 40s to full
    bus.connect(ctx.destination);
    nodes.push(bus);

    // a slow, soft two-note figure, repeating every 5.5s
    for (let i = 0; i < 220; i++) {
      const when = t0 + i * 5.5;
      for (const [k, f] of [[0, 528], [1, 704]]) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        const s = when + k * 0.42;
        g.gain.setValueAtTime(0.0001, s);
        g.gain.exponentialRampToValueAtTime(0.5, s + 0.35);
        g.gain.exponentialRampToValueAtTime(0.0001, s + 2.6);
        o.connect(g).connect(bus);
        o.start(s); o.stop(s + 2.8);
        nodes.push(o, g);
      }
    }
  }

  return {
    schedule, cancel, silence,
    get ringing() { return ringing; },
    get at() { return at; },
  };
}
