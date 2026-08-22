/*
 * Procedural ambience.
 *
 * Nothing here ships as an audio file. Seven beds are synthesised at runtime, so
 * the app is a few hundred kilobytes, works with the radio off, and — the part
 * that actually matters at 3am — never loops. A 30-second rain recording on
 * repeat is obvious by the third pass; a generated bed has no seam to hear.
 *
 * Structure of every preset:
 *   BED    a looping noise buffer through a filter chain. Costs ~nothing.
 *   MOTION slow LFOs on cutoff/gain, at deliberately incommensurate rates.
 *   EVENTS discrete grains (raindrops, crackles, birds) scheduled live with a
 *          lookahead clock, so they never fall into a pattern.
 *
 * The same recipe is implemented in Kotlin for the Android build
 * (android/.../audio/Ambience.kt) — keep the two in step.
 */

export const PRESETS = [
  { id: 'rain',      name: 'rain',       hint: 'steady rain on a window' },
  { id: 'ocean',     name: 'ocean',      hint: 'slow surf, long swell' },
  { id: 'forest',    name: 'forest',     hint: 'leaves, distant birds' },
  { id: 'fire',      name: 'fireplace',  hint: 'low fire, soft crackle' },
  { id: 'fan',       name: 'fan',        hint: 'a fan in the next room' },
  { id: 'brown',     name: 'brown noise',hint: 'deep, warm, featureless' },
  { id: 'white',     name: 'white noise',hint: 'bright, masks everything' },
];

// Perceptual makeup gains. Measured with tools/visual/measure-loudness.mjs so
// every bed lands within ~1 dB of the others at the same slider position —
// otherwise switching from brown noise to rain at 2am is a jump scare.
const MAKEUP = {
  rain: 0.90, ocean: 1.00, forest: 1.06, fire: 1.12, fan: 0.86, brown: 0.72, white: 0.42,
};

/* ---------------------------------------------------------------- noise ---- */

/** Fill with white noise in [-1,1). */
function white(out, rnd) {
  for (let i = 0; i < out.length; i++) out[i] = rnd() * 2 - 1;
}

/** Paul Kellet's refined pink filter — 3 dB/octave, cheap, stable. */
function pink(out, rnd) {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < out.length; i++) {
    const w = rnd() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.96900 * b2 + w * 0.1538520;
    b3 = 0.86650 * b3 + w * 0.3104856;
    b4 = 0.55000 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.0168980;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
}

/** Leaky integrator brown noise, normalised. -6 dB/octave. */
function brown(out, rnd) {
  let last = 0;
  for (let i = 0; i < out.length; i++) {
    const w = rnd() * 2 - 1;
    last = (last + 0.02 * w) / 1.02;
    out[i] = last * 3.5;
  }
}

/** Deterministic PRNG so a given preset always sounds the same. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Make a buffer that loops without a seam.
 *
 * A raw noise buffer clicks at the wrap because sample[n-1] and sample[0] are
 * unrelated. Crossfading the tail into the head with an equal-power curve makes
 * the join mathematically continuous and, for noise, completely inaudible.
 */
function loopable(ctx, seconds, kind, seed, channels = 2) {
  const sr = ctx.sampleRate;
  const n = Math.floor(seconds * sr);
  const xf = Math.min(Math.floor(0.75 * sr), Math.floor(n / 4)); // 750ms crossfade
  const buf = ctx.createBuffer(channels, n, sr);
  for (let ch = 0; ch < channels; ch++) {
    const tmp = new Float32Array(n + xf);
    const rnd = mulberry32(seed + ch * 7919);
    if (kind === 'pink') pink(tmp, rnd);
    else if (kind === 'brown') brown(tmp, rnd);
    else white(tmp, rnd);

    const out = buf.getChannelData(ch);
    out.set(tmp.subarray(0, n));
    for (let i = 0; i < xf; i++) {
      const t = i / xf;
      // equal power: sin/cos keeps the summed energy flat through the join
      const a = Math.cos((t * Math.PI) / 2);
      const b = Math.sin((t * Math.PI) / 2);
      out[i] = out[i] * b + tmp[n + i] * a;
    }
  }
  return buf;
}

/* ------------------------------------------------------------- helpers ---- */

const lfo = (ctx, hz, depth, centre, phaseDelay = 0) => {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = hz;
  g.gain.value = depth;
  osc.connect(g);
  osc.start(ctx.currentTime + phaseDelay);
  return { osc, out: g, centre };
};

const biquad = (ctx, type, freq, Q = 0.7071, gain = 0) => {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = Q;
  f.gain.value = gain;
  return f;
};

/* ------------------------------------------------------------- presets ---- */
/*
 * Each builder returns { input: null, output: AudioNode, nodes: [...],
 *                        tick(now, until) }  — tick schedules grains ahead.
 */

function bedSource(ctx, kind, seconds, seed, rate = 1) {
  const src = ctx.createBufferSource();
  src.buffer = loopable(ctx, seconds, kind, seed);
  src.loop = true;
  src.playbackRate.value = rate;
  return src;
}

function build(ctx, id) {
  const nodes = [];
  const out = ctx.createGain();
  out.gain.value = MAKEUP[id] ?? 1;
  const keep = (n) => { nodes.push(n); return n; };
  let tick = null;

  const startAll = [];
  const src = (kind, secs, seed, rate) => {
    const s = keep(bedSource(ctx, kind, secs, seed, rate));
    startAll.push(s);
    return s;
  };

  if (id === 'white') {
    // Raw white noise is fatiguing. A gentle shelf down at the top takes the
    // glassiness off without losing the masking that people actually want.
    const s = src('white', 11, 1201);
    const lp = keep(biquad(ctx, 'lowpass', 11000, 0.6));
    const shelf = keep(biquad(ctx, 'highshelf', 4500, 0.7, -5));
    s.connect(lp).connect(shelf).connect(out);
  }

  else if (id === 'brown') {
    const s = src('brown', 13, 3307);
    const lp = keep(biquad(ctx, 'lowpass', 1500, 0.5));
    s.connect(lp).connect(out);
  }

  else if (id === 'rain') {
    // Two beds at coprime lengths: the composite texture has a 143s period, and
    // the drop layer on top means nothing ever lines up twice.
    const near = src('white', 11, 5501);
    const far = src('white', 13, 6607);
    const hp = keep(biquad(ctx, 'highpass', 420, 0.6));
    const lp = keep(biquad(ctx, 'lowpass', 6200, 0.5));
    near.connect(hp).connect(lp).connect(out);

    const roof = keep(biquad(ctx, 'lowpass', 780, 0.9)); // rumble on the roof
    const roofG = keep(ctx.createGain()); roofG.gain.value = 0.55;
    far.connect(roof).connect(roofG).connect(out);

    // Slow "intensity" breathing so the shower feels weather-like, not static.
    const mod = lfo(ctx, 0.031, 900, 6200);
    mod.out.connect(lp.frequency);
    nodes.push(mod.osc, mod.out);

    tick = grainScheduler(ctx, out, 3.6, (t, rnd, dest) => {
      // a single fat drop: filtered noise burst with a fast decay
      const g = ctx.createGain();
      const bp = biquad(ctx, 'bandpass', 900 + rnd() * 3600, 4 + rnd() * 6);
      const n = ctx.createBufferSource();
      n.buffer = shortNoise(ctx, 0.055, rnd);
      const amp = 0.03 + rnd() * 0.06;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(amp, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045 + rnd() * 0.05);
      n.connect(bp).connect(g).connect(pan(ctx, rnd() * 1.4 - 0.7, dest));
      n.start(t); n.stop(t + 0.14);
    });
  }

  else if (id === 'ocean') {
    // The swell is the whole point: a lowpass sweeping between 200 and 1500 Hz
    // driven by two LFOs at incommensurate rates, with the gain swelling in
    // near-antiphase so each wave arrives and recedes rather than pulsing.
    const s = src('pink', 17, 7717);
    const lp = keep(biquad(ctx, 'lowpass', 850, 0.9));
    const swell = keep(ctx.createGain()); swell.gain.value = 0.62;
    s.connect(lp).connect(swell).connect(out);

    const a = lfo(ctx, 0.0555, 520, 850);
    const b = lfo(ctx, 0.0837, 260, 0);
    a.out.connect(lp.frequency);
    b.out.connect(lp.frequency);
    const ga = lfo(ctx, 0.0555, 0.26, 0, 0);
    ga.out.connect(swell.gain);
    nodes.push(a.osc, a.out, b.osc, b.out, ga.osc, ga.out);
  }

  else if (id === 'fan') {
    const s = src('pink', 11, 9109);
    const bp = keep(biquad(ctx, 'bandpass', 340, 0.55));
    const lp = keep(biquad(ctx, 'lowpass', 1900, 0.5));
    s.connect(bp).connect(lp).connect(out);

    // motor hum, slightly detuned pair so it beats very slowly
    for (const [f, g] of [[57.5, 0.055], [115.4, 0.022]]) {
      const o = keep(ctx.createOscillator());
      const og = keep(ctx.createGain());
      o.frequency.value = f; og.gain.value = g;
      o.connect(og).connect(out);
      startAll.push(o);
    }
    // blade wash
    const wash = keep(ctx.createGain()); wash.gain.value = 1;
    const w = lfo(ctx, 0.21, 0.055, 0);
    w.out.connect(wash.gain);
    lp.disconnect(); lp.connect(wash).connect(out);
    nodes.push(w.osc, w.out);
  }

  else if (id === 'fire') {
    const s = src('brown', 13, 4409);
    const lp = keep(biquad(ctx, 'lowpass', 430, 0.7));
    const g = keep(ctx.createGain()); g.gain.value = 0.9;
    s.connect(lp).connect(g).connect(out);
    const b = lfo(ctx, 0.047, 0.25, 0);
    b.out.connect(g.gain);
    nodes.push(b.osc, b.out);

    // Crackles arrive in clusters, which is what makes it read as fire rather
    // than as a metronome of clicks.
    tick = grainScheduler(ctx, out, 2.4, (t, rnd, dest) => {
      const burst = 1 + Math.floor(rnd() * rnd() * 4);
      for (let i = 0; i < burst; i++) {
        const at = t + i * (0.012 + rnd() * 0.07);
        const gg = ctx.createGain();
        const bp = biquad(ctx, 'bandpass', 700 + rnd() * 3800, 3 + rnd() * 9);
        const n = ctx.createBufferSource();
        n.buffer = shortNoise(ctx, 0.03, rnd);
        const amp = 0.02 + rnd() * rnd() * 0.11;
        gg.gain.setValueAtTime(0.0001, at);
        gg.gain.exponentialRampToValueAtTime(amp, at + 0.0016);
        gg.gain.exponentialRampToValueAtTime(0.0001, at + 0.012 + rnd() * 0.03);
        n.connect(bp).connect(gg).connect(pan(ctx, rnd() * 1.0 - 0.5, dest));
        n.start(at); n.stop(at + 0.09);
      }
    });
  }

  else if (id === 'forest') {
    const s = src('pink', 19, 2203);
    const lp = keep(biquad(ctx, 'lowpass', 2100, 0.6));
    const hp = keep(biquad(ctx, 'highpass', 180, 0.6));
    const g = keep(ctx.createGain()); g.gain.value = 0.5;
    s.connect(hp).connect(lp).connect(g).connect(out);
    // wind moving through, very slow
    const w = lfo(ctx, 0.026, 700, 2100);
    w.out.connect(lp.frequency);
    const wg = lfo(ctx, 0.0193, 0.17, 0);
    wg.out.connect(g.gain);
    nodes.push(w.osc, w.out, wg.osc, wg.out);

    // Birds: two or three notes, far away, never close enough to wake you.
    tick = grainScheduler(ctx, out, 0.14, (t, rnd, dest) => {
      const notes = 2 + Math.floor(rnd() * 3);
      const base = 1900 + rnd() * 1700;
      const p = pan(ctx, rnd() * 1.6 - 0.8, dest);
      for (let i = 0; i < notes; i++) {
        const at = t + i * (0.09 + rnd() * 0.1);
        const o = ctx.createOscillator();
        const gg = ctx.createGain();
        o.type = 'sine';
        const f0 = base * (0.92 + rnd() * 0.2);
        o.frequency.setValueAtTime(f0, at);
        o.frequency.exponentialRampToValueAtTime(f0 * (1 + (rnd() - 0.4) * 0.28), at + 0.07);
        gg.gain.setValueAtTime(0.0001, at);
        gg.gain.exponentialRampToValueAtTime(0.008 + rnd() * 0.012, at + 0.012);
        gg.gain.exponentialRampToValueAtTime(0.0001, at + 0.075 + rnd() * 0.06);
        o.connect(gg).connect(p);
        o.start(at); o.stop(at + 0.2);
      }
    });
  }

  return { out, nodes, startAll, tick };
}

function pan(ctx, position, dest) {
  const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (!p) return dest;
  p.pan.value = Math.max(-1, Math.min(1, position));
  p.connect(dest);
  return p;
}

const _noiseCache = new Map();
function shortNoise(ctx, secs, rnd) {
  // Grains are tiny and reused: allocating a fresh buffer per raindrop would
  // churn the GC for eight hours straight.
  const key = Math.round(secs * 1000);
  let pool = _noiseCache.get(key);
  if (!pool) {
    pool = [];
    for (let k = 0; k < 8; k++) {
      const n = Math.floor(secs * ctx.sampleRate);
      const b = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = b.getChannelData(0);
      const r = mulberry32(9001 + k * 131 + key);
      for (let i = 0; i < n; i++) d[i] = (r() * 2 - 1) * (1 - i / n);
      pool.push(b);
    }
    _noiseCache.set(key, pool);
  }
  return pool[Math.floor(rnd() * pool.length) % pool.length];
}

/**
 * Lookahead grain scheduler.
 *
 * Web Audio's clock is sample-accurate but setTimeout is not, so we schedule
 * everything a little ahead of the audio clock and only ever wake up to top up
 * the queue. `rate` is events per second (Poisson-ish, not a metronome).
 */
function grainScheduler(ctx, dest, rate, emit) {
  let cursor = 0;
  let rnd = mulberry32(0x5EED);
  return function tick(now, until) {
    if (cursor < now) cursor = now + 0.05;
    while (cursor < until) {
      emit(cursor, rnd, dest);
      // exponential inter-arrival -> natural clustering
      const u = Math.max(1e-6, rnd());
      cursor += -Math.log(u) / rate;
    }
  };
}

export function createAmbience(ctx, destination) {
  let current = null;

  function stopCurrent(at) {
    if (!current) return;
    const c = current;
    current = null;
    try { c.out.gain.cancelScheduledValues(at); } catch {}
    for (const s of c.startAll) { try { s.stop(at + 0.05); } catch {} }
    setTimeout(() => {
      for (const n of c.nodes) { try { n.disconnect(); } catch {} }
      try { c.out.disconnect(); } catch {}
    }, 250);
  }

  return {
    get id() { return current?.id ?? null; },
    /** Swap the bed. Caller owns the crossfade on `destination`. */
    set(id) {
      const at = ctx.currentTime;
      stopCurrent(at);
      if (!id) return;
      const b = build(ctx, id);
      b.id = id;
      b.out.connect(destination);
      for (const s of b.startAll) { try { s.start(at + 0.02); } catch {} }
      current = b;
    },
    /** Call every ~200ms from the app clock. */
    tick() {
      if (current?.tick) current.tick(ctx.currentTime, ctx.currentTime + 0.45);
    },
    dispose() { stopCurrent(ctx.currentTime); },
    PRESETS,
  };
}
