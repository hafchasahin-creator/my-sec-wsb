/**
 * Procedural soundtrack synthesis.
 *
 * There are no audio assets available to this renderer and no reliable media
 * CDN, so every sound is generated from scratch: a drum kit built from shaped
 * sine and noise bursts, a sub bass, a plucked arpeggio, a pad, plus the ad
 * SFX vocabulary (pour, fizz, whoosh, glass chime, logo sting).
 *
 * Each episode picks a tempo, key and instrument palette from its index, so no
 * two spots in the campaign share a soundtrack.
 */

const SR = 44100;

/* ------------------------------------------------------------------ *
 * Small DSP helpers
 * ------------------------------------------------------------------ */

const noteHz = (semi) => 440 * Math.pow(2, (semi - 9) / 12);

/** Exponential decay envelope. */
const decay = (t, rate) => Math.exp(-t * rate);

/** Attack/decay envelope with a soft attack to avoid clicks. */
function ad(t, attack, rate) {
  if (t < 0) return 0;
  const a = attack > 0 ? Math.min(1, t / attack) : 1;
  return a * Math.exp(-Math.max(0, t - attack) * rate);
}

/** Deterministic white noise - a hashed LCG so renders are reproducible. */
function noiseAt(i) {
  let x = (i * 1103515245 + 12345) & 0x7fffffff;
  x ^= x >>> 13;
  x = (x * 1274126177) & 0x7fffffff;
  return ((x & 0xffff) / 32768) - 1;
}

/** One-pole low-pass, applied in place over a buffer. */
function lowpass(buf, cutoff) {
  const a = Math.min(1, (2 * Math.PI * cutoff) / SR);
  let y = 0;
  for (let i = 0; i < buf.length; i++) {
    y += a * (buf[i] - y);
    buf[i] = y;
  }
}

/** One-pole high-pass. */
function highpass(buf, cutoff) {
  const a = Math.min(1, (2 * Math.PI * cutoff) / SR);
  let y = 0, prev = 0;
  for (let i = 0; i < buf.length; i++) {
    y = a * (y + buf[i] - prev);
    prev = buf[i];
    buf[i] = y;
  }
}

const saw = (ph) => 2 * (ph - Math.floor(ph + 0.5));
const square = (ph) => (ph % 1 < 0.5 ? 1 : -1);
const tri = (ph) => 2 * Math.abs(saw(ph)) - 1;

/* ------------------------------------------------------------------ *
 * Per-episode musical identity
 * ------------------------------------------------------------------ */

const SCALES = {
  majorPent: [0, 2, 4, 7, 9],
  minorPent: [0, 3, 5, 7, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
};
const SCALE_NAMES = Object.keys(SCALES);

export function musicIdentity(index) {
  // Coprime strides spread tempo/key/scale so neighbouring spots differ most.
  const bpm = 96 + ((index * 7) % 9) * 6; // 96..144
  const root = [0, 5, 7, 2, 10, 3, 8][index % 7]; // C, F, G, D, A#, D#, G#
  const scale = SCALES[SCALE_NAMES[(index * 3) % SCALE_NAMES.length]];
  return {
    bpm,
    root,
    scale,
    swing: index % 3 === 0 ? 0.08 : 0,
    padVoice: index % 3, // 0 saw pad, 1 tri pad, 2 square pad
    arpVoice: index % 2, // 0 pluck, 1 bell
    arpDir: index % 4 < 2 ? 1 : -1,
  };
}

/* ------------------------------------------------------------------ *
 * Voices - each writes additively into L/R
 * ------------------------------------------------------------------ */

function addKick(L, R, at, gain = 1) {
  const n = Math.floor(0.34 * SR);
  const s0 = Math.floor(at * SR);
  for (let i = 0; i < n; i++) {
    const j = s0 + i;
    if (j < 0 || j >= L.length) continue;
    const t = i / SR;
    const f = 48 + 110 * decay(t, 34);
    const v = Math.sin(2 * Math.PI * f * t) * ad(t, 0.002, 12) * gain * 0.85;
    L[j] += v;
    R[j] += v;
  }
}

function addSnare(L, R, at, gain = 1) {
  const n = Math.floor(0.22 * SR);
  const s0 = Math.floor(at * SR);
  const tmp = new Float32Array(n);
  for (let i = 0; i < n; i++) tmp[i] = noiseAt(s0 + i);
  highpass(tmp, 900);
  for (let i = 0; i < n; i++) {
    const j = s0 + i;
    if (j < 0 || j >= L.length) continue;
    const t = i / SR;
    const body = Math.sin(2 * Math.PI * 190 * t) * decay(t, 30) * 0.35;
    const v = (tmp[i] * decay(t, 22) + body) * gain * 0.5;
    L[j] += v * 0.95;
    R[j] += v;
  }
}

function addHat(L, R, at, gain = 1, open = false) {
  const dur = open ? 0.16 : 0.05;
  const n = Math.floor(dur * SR);
  const s0 = Math.floor(at * SR);
  const tmp = new Float32Array(n);
  for (let i = 0; i < n; i++) tmp[i] = noiseAt(s0 + i * 3 + 7);
  highpass(tmp, 6500);
  for (let i = 0; i < n; i++) {
    const j = s0 + i;
    if (j < 0 || j >= L.length) continue;
    const v = tmp[i] * decay(i / SR, open ? 18 : 70) * gain * 0.3;
    L[j] += v * 1.05;
    R[j] += v * 0.9;
  }
}

function addBass(L, R, at, dur, semi, gain = 1) {
  const n = Math.floor(dur * SR);
  const s0 = Math.floor(at * SR);
  const f = noteHz(semi - 24);
  const tmp = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    tmp[i] = (saw(f * t) * 0.5 + Math.sin(2 * Math.PI * f * t) * 0.9) * ad(t, 0.008, 3.2);
  }
  lowpass(tmp, 340);
  for (let i = 0; i < n; i++) {
    const j = s0 + i;
    if (j < 0 || j >= L.length) continue;
    const v = tmp[i] * gain * 0.5;
    L[j] += v;
    R[j] += v;
  }
}

function addPluck(L, R, at, dur, semi, gain = 1, voice = 0, pan = 0) {
  const n = Math.floor(dur * SR);
  const s0 = Math.floor(at * SR);
  const f = noteHz(semi);
  const tmp = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let v;
    if (voice === 1) {
      // FM bell.
      const mod = Math.sin(2 * Math.PI * f * 2.01 * t) * 2.4 * decay(t, 9);
      v = Math.sin(2 * Math.PI * f * t + mod);
    } else {
      v = square(f * t) * 0.35 + tri(f * t) * 0.65;
    }
    tmp[i] = v * ad(t, 0.004, voice === 1 ? 5.5 : 9);
  }
  lowpass(tmp, voice === 1 ? 5200 : 2600);
  const gl = gain * (1 - Math.max(0, pan)) * 0.34;
  const gr = gain * (1 + Math.min(0, pan)) * 0.34;
  for (let i = 0; i < n; i++) {
    const j = s0 + i;
    if (j < 0 || j >= L.length) continue;
    L[j] += tmp[i] * gl;
    R[j] += tmp[i] * gr;
  }
}

function addPad(L, R, at, dur, semis, gain = 1, voice = 0) {
  const n = Math.floor(dur * SR);
  const s0 = Math.floor(at * SR);
  const tmpL = new Float32Array(n);
  const tmpR = new Float32Array(n);
  const osc = voice === 1 ? tri : voice === 2 ? square : saw;
  for (const semi of semis) {
    const f = noteHz(semi);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      // Slight detune between channels gives the pad width.
      tmpL[i] += osc(f * 0.997 * t);
      tmpR[i] += osc(f * 1.003 * t + 0.31);
    }
  }
  lowpass(tmpL, 1500);
  lowpass(tmpR, 1500);
  const g = (gain * 0.12) / Math.max(1, semis.length);
  for (let i = 0; i < n; i++) {
    const j = s0 + i;
    if (j < 0 || j >= L.length) continue;
    const t = i / SR;
    // Long swell in, gentle fade out.
    const env = Math.min(1, t / 0.6) * Math.min(1, (dur - t) / 0.8);
    L[j] += tmpL[i] * g * env;
    R[j] += tmpR[i] * g * env;
  }
}

/** Rising noise sweep - the classic pre-drop riser. */
function addRiser(L, R, at, dur, gain = 1) {
  const n = Math.floor(dur * SR);
  const s0 = Math.floor(at * SR);
  for (let i = 0; i < n; i++) {
    const j = s0 + i;
    if (j < 0 || j >= L.length) continue;
    const k = i / n;
    const f = 200 + Math.pow(k, 2.2) * 3800;
    const t = i / SR;
    const v = (Math.sin(2 * Math.PI * f * t) * 0.4 + noiseAt(j) * 0.5) * Math.pow(k, 1.6) * gain * 0.22;
    L[j] += v;
    R[j] += v * 0.92;
  }
}

/** Whoosh for whip pans and transitions. */
function addWhoosh(L, R, at, dur, gain = 1) {
  const n = Math.floor(dur * SR);
  const s0 = Math.floor(at * SR);
  const tmp = new Float32Array(n);
  for (let i = 0; i < n; i++) tmp[i] = noiseAt(s0 + i * 5 + 31);
  lowpass(tmp, 2200);
  highpass(tmp, 300);
  for (let i = 0; i < n; i++) {
    const j = s0 + i;
    if (j < 0 || j >= L.length) continue;
    const k = i / n;
    const env = Math.sin(k * Math.PI) ** 1.5;
    const v = tmp[i] * env * gain * 0.4;
    // Sweep the whoosh across the stereo field.
    L[j] += v * (1 - k);
    R[j] += v * k;
  }
}

/** Carbonation fizz bed. */
function addFizz(L, R, at, dur, gain = 1) {
  const n = Math.floor(dur * SR);
  const s0 = Math.floor(at * SR);
  const tmp = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // Sparse crackle on top of a hiss floor.
    const crack = Math.abs(noiseAt(s0 + i * 7)) > 0.985 ? noiseAt(s0 + i * 11) * 6 : 0;
    tmp[i] = noiseAt(s0 + i) * 0.5 + crack;
  }
  highpass(tmp, 4000);
  for (let i = 0; i < n; i++) {
    const j = s0 + i;
    if (j < 0 || j >= L.length) continue;
    const k = i / n;
    const env = Math.min(1, k * 12) * Math.min(1, (1 - k) * 6);
    const v = tmp[i] * env * gain * 0.16;
    L[j] += v;
    R[j] += v * 1.08;
  }
}

/** Liquid pour: filtered noise whose centre frequency rises as a glass fills. */
function addPour(L, R, at, dur, gain = 1) {
  const n = Math.floor(dur * SR);
  const s0 = Math.floor(at * SR);
  const tmp = new Float32Array(n);
  for (let i = 0; i < n; i++) tmp[i] = noiseAt(s0 + i * 3 + 5);
  lowpass(tmp, 1800);
  highpass(tmp, 400);
  for (let i = 0; i < n; i++) {
    const j = s0 + i;
    if (j < 0 || j >= L.length) continue;
    const k = i / n;
    const t = i / SR;
    const env = Math.min(1, k * 10) * Math.min(1, (1 - k) * 8);
    // Resonant "filling" tone climbing in pitch.
    const tone = Math.sin(2 * Math.PI * (240 + k * 520) * t) * 0.18 * env;
    const v = (tmp[i] * 0.5 + tone) * env * gain * 0.34;
    L[j] += v;
    R[j] += v;
  }
}

/** Bright glass chime marking the product reveal. */
function addChime(L, R, at, semi, gain = 1) {
  const partials = [1, 2.76, 5.4, 8.93];
  const dur = 2.6;
  const n = Math.floor(dur * SR);
  const s0 = Math.floor(at * SR);
  const f = noteHz(semi + 12);
  for (let i = 0; i < n; i++) {
    const j = s0 + i;
    if (j < 0 || j >= L.length) continue;
    const t = i / SR;
    let v = 0;
    for (let p = 0; p < partials.length; p++) {
      v += Math.sin(2 * Math.PI * f * partials[p] * t) * decay(t, 1.6 + p * 1.7) * (1 / (p + 1.4));
    }
    v *= ad(t, 0.003, 0) * gain * 0.2;
    L[j] += v;
    R[j] += v * 0.96;
  }
}

/** The logo sting: a stacked fifth swell with a bell on top. */
function addSting(L, R, at, root, gain = 1) {
  addChime(L, R, at, root + 12, gain * 1.1);
  addChime(L, R, at + 0.09, root + 19, gain * 0.7);
  addPad(L, R, at, 3.2, [root, root + 7, root + 12, root + 16], gain * 2.6, 0);
  addKick(L, R, at, gain * 1.2);
}

/* ------------------------------------------------------------------ *
 * Arrangement
 * ------------------------------------------------------------------ */

/**
 * Build the full stereo soundtrack for one episode.
 * @returns {Buffer} 16-bit stereo PCM WAV
 */
export function renderEpisodeAudio(index, duration) {
  const id = musicIdentity(index);
  const n = Math.ceil(duration * SR);
  const L = new Float32Array(n);
  const R = new Float32Array(n);

  const beat = 60 / id.bpm;
  const bar = beat * 4;
  const { root, scale } = id;

  // Four-chord loop in scale degrees, rotated per episode.
  const prog = [0, 5, 3, 4].map((d, i) => root + scale[(d + index) % scale.length] + (i === 2 ? -12 : 0));

  // Beat structure of the spot, in seconds.
  const HOOK = 8, BUILD = 30, HERO = 42;

  // --- pads: one chord per bar for the whole spot ----------------------
  for (let b = 0; b * bar < duration; b++) {
    const at = b * bar;
    const chordRoot = prog[b % prog.length];
    const semis = [chordRoot, chordRoot + 7, chordRoot + 12];
    const g = at < HOOK ? 0.5 : at < HERO ? 1 : 0.8;
    addPad(L, R, at, Math.min(bar, duration - at), semis, g, id.padVoice);
  }

  // --- drums -----------------------------------------------------------
  for (let s = 0; s * (beat / 2) < duration; s++) {
    const at = s * (beat / 2) + (s % 2 === 1 ? id.swing * beat : 0);
    if (at >= duration) break;
    const eighth = s % 8;
    const inHook = at < HOOK;
    const inLock = at >= HERO;

    // Hook is sparse; the groove lands at 8s and thins again at the lockup.
    if (inHook) {
      if (eighth === 0) addKick(L, R, at, 0.7);
      if (eighth === 4) addHat(L, R, at, 0.5);
    } else if (inLock) {
      if (eighth === 0) addKick(L, R, at, 0.55);
    } else {
      if (eighth === 0 || eighth === 6) addKick(L, R, at, 1);
      if (eighth === 4) addSnare(L, R, at, 0.9);
      addHat(L, R, at, eighth % 2 === 0 ? 0.8 : 0.45, eighth === 7);
    }
  }

  // --- bass: root of the current chord, on every beat -------------------
  for (let b = 0; b * beat < duration; b++) {
    const at = b * beat;
    if (at < HOOK || at >= HERO + 4) continue;
    const chordRoot = prog[Math.floor(at / bar) % prog.length];
    addBass(L, R, at, beat * 0.9, chordRoot, at < BUILD ? 0.8 : 1);
  }

  // --- arpeggio: sixteenths through the build and hero ------------------
  const sixteenth = beat / 4;
  for (let s = 0; s * sixteenth < duration; s++) {
    const at = s * sixteenth;
    if (at < HOOK + 2 || at >= HERO + 2) continue;
    const chordRoot = prog[Math.floor(at / bar) % prog.length];
    const step = id.arpDir > 0 ? s : -s;
    const deg = ((step % scale.length) + scale.length) % scale.length;
    const oct = 12 * (Math.floor(s / scale.length) % 2);
    const semi = chordRoot + scale[deg] + 12 + oct;
    const g = at < BUILD ? 0.55 : 0.95;
    addPluck(L, R, at, sixteenth * 3.2, semi, g, id.arpVoice, ((s % 4) - 1.5) / 2.2);
  }

  // --- signature SFX ----------------------------------------------------
  addWhoosh(L, R, 0.15, 1.1, 1);                 // opening whip in
  addRiser(L, R, HOOK - 2.2, 2.2, 1);            // riser into the groove
  addWhoosh(L, R, HOOK - 0.12, 0.7, 0.9);
  addFizz(L, R, HOOK + 1, BUILD - HOOK - 2, 0.8); // carbonation bed under the build
  addPour(L, R, BUILD - 6.5, 5.2, 1);            // the pour beat
  addWhoosh(L, R, BUILD - 0.2, 0.8, 1);
  addChime(L, R, BUILD + 0.05, root + 12, 1);    // product reveal
  addFizz(L, R, BUILD, HERO - BUILD, 1);
  addRiser(L, R, HERO - 1.6, 1.6, 0.9);
  addSting(L, R, HERO + 0.1, root, 1);           // logo lockup
  addChime(L, R, HERO + 2.4, root + 19, 0.55);

  return encodeWav(L, R, duration);
}

/* ------------------------------------------------------------------ *
 * Mixdown
 * ------------------------------------------------------------------ */

function encodeWav(L, R, duration) {
  const n = L.length;
  // Master fade so episodes butt-join without clicks.
  const fadeIn = Math.floor(0.25 * SR);
  const fadeOut = Math.floor(0.7 * SR);
  for (let i = 0; i < n; i++) {
    let g = 1;
    if (i < fadeIn) g = i / fadeIn;
    if (i > n - fadeOut) g = Math.min(g, (n - i) / fadeOut);
    L[i] *= g;
    R[i] *= g;
  }

  // Peak-normalise to -1.5 dBFS, then soft-clip anything that still spikes.
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const norm = peak > 0 ? 0.84 / peak : 1;

  const bytes = Buffer.alloc(44 + n * 4);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(36 + n * 4, 4);
  bytes.write('WAVE', 8);
  bytes.write('fmt ', 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);           // PCM
  bytes.writeUInt16LE(2, 22);           // stereo
  bytes.writeUInt32LE(SR, 24);
  bytes.writeUInt32LE(SR * 4, 28);      // byte rate
  bytes.writeUInt16LE(4, 32);           // block align
  bytes.writeUInt16LE(16, 34);          // bits
  bytes.write('data', 36);
  bytes.writeUInt32LE(n * 4, 40);

  const sat = (v) => Math.tanh(v * norm) * 0.97;
  for (let i = 0; i < n; i++) {
    bytes.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(sat(L[i]) * 32767))), 44 + i * 4);
    bytes.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(sat(R[i]) * 32767))), 44 + i * 4 + 2);
  }
  return bytes;
}
