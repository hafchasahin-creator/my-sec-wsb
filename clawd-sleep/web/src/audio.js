/*
 * The mixer.
 *
 *   <audio> --> MediaElementSource --> musicGain ----.
 *                                                     >-- bus -- softClip -- master -- out
 *   ambience graph ------------------> ambienceGain -'
 *
 * Why an <audio> element rather than decodeAudioData: a two-hour FLAC decoded to
 * a buffer is ~1.5 GB of Float32. The element streams, seeks, reports duration,
 * uses the platform decoders, and keeps playing when the tab is backgrounded.
 *
 * Every gain move goes through rampTo(), which fades on a perceptual curve.
 * A linear fade sounds like nothing happens and then it all happens at the end.
 */

import { clamp01 } from './ease.js';
import { createAmbience, PRESETS } from './ambience.js';

const MIN_GAIN = 0.0001; // exponentialRamp cannot reach zero

/** Perceptual (exponential) fade. Falls back to a linear ramp near silence. */
function rampTo(param, target, seconds, ctx) {
  const now = ctx.currentTime;
  const t = Math.max(0.005, seconds);
  const from = Math.max(param.value, MIN_GAIN);
  param.cancelScheduledValues(now);
  param.setValueAtTime(from, now);
  if (target <= MIN_GAIN) {
    param.exponentialRampToValueAtTime(MIN_GAIN, now + t);
    param.setValueAtTime(0, now + t + 0.001);
  } else {
    param.exponentialRampToValueAtTime(target, now + t);
  }
}

/** tanh-shaped soft clip. Transparent below -6 dBFS, never lets a sum clack. */
function softClipCurve(n = 2048) {
  const c = new Float32Array(n);
  const k = 1.6;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return c;
}

export function createAudioEngine() {
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx = null;
  let el = null, srcNode = null;
  let musicGain, ambienceGain, bus, shaper, master;
  let ambience = null;
  let tickTimer = null;

  const state = {
    ready: false,
    musicVolume: 0.7,
    ambienceVolume: 0.5,
    masterVolume: 1,
    ambienceId: null,
    track: null,        // {name, url, revoke}
    playing: false,
    loop: true,
    duration: 0,
    position: 0,
    error: null,
  };

  const listeners = new Set();
  const emit = () => { for (const f of listeners) f(state); };
  const onChange = (f) => { listeners.add(f); return () => listeners.delete(f); };

  function ensure() {
    if (ctx) return ctx;
    ctx = new AC({ latencyHint: 'playback' }); // playback: bigger buffers, less CPU

    master = ctx.createGain();
    shaper = ctx.createWaveShaper();
    shaper.curve = softClipCurve();
    shaper.oversample = '2x';
    bus = ctx.createGain();
    musicGain = ctx.createGain();
    ambienceGain = ctx.createGain();

    musicGain.gain.value = 0;
    ambienceGain.gain.value = 0;
    bus.gain.value = 1;
    master.gain.value = state.masterVolume;

    musicGain.connect(bus);
    ambienceGain.connect(bus);
    bus.connect(shaper).connect(master).connect(ctx.destination);

    el = new Audio();
    el.preload = 'auto';
    el.loop = state.loop;
    el.crossOrigin = 'anonymous';
    // Keeps iOS/Safari from routing to the earpiece and keeps the element alive.
    el.setAttribute('playsinline', '');
    srcNode = ctx.createMediaElementSource(el);
    srcNode.connect(musicGain);

    el.addEventListener('loadedmetadata', () => {
      state.duration = Number.isFinite(el.duration) ? el.duration : 0;
      emit();
    });
    el.addEventListener('timeupdate', () => { state.position = el.currentTime; emit(); });
    el.addEventListener('ended', () => { if (!el.loop) { state.playing = false; emit(); } });
    el.addEventListener('error', () => {
      state.error = describeMediaError(el.error);
      state.playing = false;
      emit();
    });

    ambience = createAmbience(ctx, ambienceGain);

    // One timer drives the grain schedulers for every preset.
    tickTimer = setInterval(() => { try { ambience.tick(); } catch {} }, 200);

    state.ready = true;
    return ctx;
  }

  function describeMediaError(e) {
    if (!e) return 'that file would not play';
    switch (e.code) {
      case 1: return 'loading was interrupted';
      case 2: return 'the file could not be read';
      case 3: return 'the file is damaged or not audio';
      case 4: return "this device can't play that format";
      default: return 'that file would not play';
    }
  }

  /** Must be called from a user gesture the first time. */
  async function unlock() {
    ensure();
    if (ctx.state !== 'running') { try { await ctx.resume(); } catch {} }
    return ctx.state === 'running';
  }

  // ---------------------------------------------------------------- music --
  async function setTrack(fileOrUrl, name) {
    ensure();
    if (state.track?.revoke) URL.revokeObjectURL(state.track.url);
    state.error = null;
    const url = typeof fileOrUrl === 'string' ? fileOrUrl : URL.createObjectURL(fileOrUrl);
    state.track = { name: name || fileOrUrl?.name || 'your audio', url, revoke: typeof fileOrUrl !== 'string' };
    state.duration = 0; state.position = 0;
    el.src = url;
    try { el.load(); } catch {}
    emit();
  }

  function clearTrack() {
    if (!el) return;
    try { el.pause(); } catch {}
    if (state.track?.revoke) URL.revokeObjectURL(state.track.url);
    el.removeAttribute('src');
    try { el.load(); } catch {}
    state.track = null; state.duration = 0; state.position = 0; state.playing = false;
    rampTo(musicGain.gain, 0, 0.3, ctx);
    emit();
  }

  async function play(fadeSeconds = 2.4) {
    ensure();
    await unlock();
    if (state.track) {
      musicGain.gain.value = MIN_GAIN;
      try { await el.play(); } catch (err) { state.error = 'playback was blocked — tap play again'; emit(); return false; }
      rampTo(musicGain.gain, state.musicVolume, fadeSeconds, ctx);
    }
    if (state.ambienceId) rampTo(ambienceGain.gain, state.ambienceVolume, fadeSeconds, ctx);
    state.playing = true; state.error = null; emit();
    return true;
  }

  async function pause(fadeSeconds = 1.1) {
    if (!ctx) return;
    rampTo(musicGain.gain, 0, fadeSeconds, ctx);
    rampTo(ambienceGain.gain, 0, fadeSeconds, ctx);
    state.playing = false; emit();
    await new Promise((r) => setTimeout(r, fadeSeconds * 1000 + 40));
    if (!state.playing) { try { el.pause(); } catch {} }
  }

  function seek(seconds) {
    if (!el || !Number.isFinite(seconds)) return;
    // Duck across the jump so the splice never clicks.
    const v = state.playing ? state.musicVolume : 0;
    rampTo(musicGain.gain, MIN_GAIN, 0.06, ctx);
    setTimeout(() => {
      try { el.currentTime = Math.max(0, Math.min(seconds, state.duration || seconds)); } catch {}
      rampTo(musicGain.gain, v, 0.18, ctx);
    }, 70);
    state.position = seconds; emit();
  }

  // ------------------------------------------------------------- ambience --
  function setAmbience(id, crossfade = 1.6) {
    ensure();
    if (state.ambienceId === id) return;
    const wasOn = !!state.ambienceId;
    state.ambienceId = id;
    if (!id) {
      rampTo(ambienceGain.gain, 0, crossfade, ctx);
      setTimeout(() => { if (!state.ambienceId) ambience.set(null); }, crossfade * 1000 + 50);
      emit(); return;
    }
    const swap = () => {
      ambience.set(id);
      rampTo(ambienceGain.gain, state.playing || !wasOn ? state.ambienceVolume : 0, crossfade, ctx);
    };
    if (wasOn) {
      rampTo(ambienceGain.gain, 0, crossfade * 0.5, ctx);
      setTimeout(swap, crossfade * 500 + 30);
    } else {
      ambienceGain.gain.value = MIN_GAIN;
      swap();
    }
    emit();
  }

  // -------------------------------------------------------------- volumes --
  function setMusicVolume(v, ramp = 0.12) {
    state.musicVolume = clamp01(v);
    if (ctx && state.playing) rampTo(musicGain.gain, state.musicVolume, ramp, ctx);
    emit();
  }
  function setAmbienceVolume(v, ramp = 0.12) {
    state.ambienceVolume = clamp01(v);
    if (ctx && state.ambienceId && (state.playing || !state.track)) {
      rampTo(ambienceGain.gain, state.ambienceVolume, ramp, ctx);
    }
    emit();
  }
  /** Used by the sleep timer's long taper. */
  function fadeMaster(target, seconds) {
    ensure();
    state.masterVolume = clamp01(target);
    rampTo(master.gain, state.masterVolume, seconds, ctx);
    emit();
  }
  function setLoop(v) {
    state.loop = !!v;
    if (el) el.loop = state.loop;
    emit();
  }

  function dispose() {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = null;
    try { ambience?.dispose(); } catch {}
    try { el?.pause(); } catch {}
    if (state.track?.revoke) URL.revokeObjectURL(state.track.url);
    try { ctx?.close(); } catch {}
    ctx = null; state.ready = false;
  }

  return {
    state, onChange, PRESETS,
    unlock, ensure,
    setTrack, clearTrack, play, pause, seek, setLoop,
    setAmbience, setMusicVolume, setAmbienceVolume, fadeMaster,
    dispose,
    get context() { return ctx; },
    get element() { return el; },
    /** True when anything at all would make sound. */
    get hasSource() { return !!(state.track || state.ambienceId); },
  };
}
