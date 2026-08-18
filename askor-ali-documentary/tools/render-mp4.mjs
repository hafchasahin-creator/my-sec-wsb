#!/usr/bin/env node
/**
 * Offline renderer for askor-ali-documentary.html
 *
 * Drives the film's deterministic `renderAt(t)` hook frame by frame in a
 * headless Chromium, pipes the frames into ffmpeg, and muxes them with a
 * procedurally synthesised score that mirrors the in-page WebAudio one.
 *
 *   node tools/render-mp4.mjs [output.mp4]
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = resolve(HERE, "..", "askor-ali-documentary.html");
const OUT  = resolve(process.argv[2] ?? resolve(HERE, "..", "askor-ali-documentary.mp4"));
const FFMPEG = process.env.FFMPEG || "ffmpeg";

const W = 1280, H = 720, FPS = 30, DURATION = 30, SR = 44100;

/* ----------------------------- the score ---------------------------- */
const CHORDS = [
  [0.0,  [55.00, 82.41, 130.81]],
  [9.6,  [65.41, 98.00, 155.56]],
  [15.4, [73.42, 110.00, 174.61]],
  [21.0, [49.00, 73.42, 146.83]],
  [26.0, [55.00, 82.41, 164.81]]
];
const IMPACTS = [4.2, 9.6, 15.4, 21.0, 26.0];

const N = Math.round(DURATION * SR);
const buf = new Float32Array(N);

// exponential attack/decay envelope, matching the WebAudio ramps
function env(i, at, dur, peak) {
  const t = i / SR - at;
  if (t < 0 || t > dur) return 0;
  const atk = Math.min(0.9, dur * 0.35);
  const eps = 0.0001;
  return t < atk
    ? eps * Math.pow(peak / eps, t / atk)
    : peak * Math.pow(eps / peak, (t - atk) / Math.max(1e-6, dur - atk));
}

function wave(type, phase) {
  if (type === "sine") return Math.sin(phase);
  // mildly band-limited triangle: odd harmonics, 1/n^2
  let v = 0;
  for (let n = 1; n <= 9; n += 2) v += (((n - 1) / 2) % 2 ? -1 : 1) * Math.sin(n * phase) / (n * n);
  return v * (8 / (Math.PI * Math.PI));
}

function tone(type, freq, at, dur, peak, cents = 0) {
  const f = freq * Math.pow(2, cents / 1200);
  const step = 2 * Math.PI * f / SR;
  const i0 = Math.max(0, Math.floor(at * SR));
  const i1 = Math.min(N, Math.ceil((at + dur) * SR));
  let ph = 0;
  for (let i = i0; i < i1; i++, ph += step) buf[i] += wave(type, ph) * env(i, at, dur, peak);
}

// drone
tone("sine", 36.71, 0, DURATION, 0.16);
tone("sine", 55.00, 0, DURATION, 0.07, 6);

// pad
CHORDS.forEach(([at, freqs], k) => {
  const end = (CHORDS[k + 1]?.[0] ?? DURATION) - at;
  freqs.forEach((f, j) => {
    tone("triangle", f, at, end + 0.6, 0.075 - j * 0.012, (j - 1) * 5);
    tone("sine", f * 2, at, end + 0.4, 0.022);
  });
});

// heartbeat pulse
for (let b = 9.6; b < 27.6; b += 0.75) {
  const i0 = Math.floor(b * SR), i1 = Math.min(N, Math.floor((b + 0.4) * SR));
  let ph = 0;
  for (let i = i0; i < i1; i++) {
    const t = (i - i0) / SR;
    const f = t < 0.16 ? 120 * Math.pow(42 / 120, t / 0.16) : 42;
    ph += 2 * Math.PI * f / SR;
    buf[i] += Math.sin(ph) * 0.34 * Math.pow(0.0001 / 0.34, Math.min(1, t / 0.34));
  }
}

// impacts + noise risers (RBJ bandpass on white noise)
function bandpass(x, f0, Q, s) {
  const w0 = 2 * Math.PI * f0 / SR, alpha = Math.sin(w0) / (2 * Q), cw = Math.cos(w0);
  const b0 = alpha, b1 = 0, b2 = -alpha, a0 = 1 + alpha, a1 = -2 * cw, a2 = 1 - alpha;
  const y = (b0 / a0) * x + (b1 / a0) * s.x1 + (b2 / a0) * s.x2 - (a1 / a0) * s.y1 - (a2 / a0) * s.y2;
  s.x2 = s.x1; s.x1 = x; s.y2 = s.y1; s.y1 = y;
  return y;
}
let seed = 1234567;
const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x3fffffff) - 1;

for (const at of IMPACTS) {
  tone("sine", 62, at, 1.6, 0.42);
  const s = { x1: 0, x2: 0, y1: 0, y2: 0 };
  const i0 = Math.max(0, Math.floor((at - 1.2) * SR)), i1 = Math.min(N, Math.floor((at + 0.8) * SR));
  for (let i = i0; i < i1; i++) {
    const t = i / SR - (at - 1.2);
    const a = t < 1.2 ? 0.0001 * Math.pow(0.16 / 0.0001, t / 1.2)
                      : 0.16 * Math.pow(0.0001 / 0.16, Math.min(1, (t - 1.2) / 0.7));
    buf[i] += bandpass(noise(), 900, 0.8, s) * a;
  }
}

// closing swell, then the master fade to silence
tone("triangle", 110, 25.4, 3.4, 0.10);
for (let i = Math.floor(28.4 * SR); i < N; i++) buf[i] *= 1 - (i / SR - 28.4) / (DURATION - 28.4);

// gentle saturation + 16-bit WAV
const pcm = Buffer.alloc(N * 2);
for (let i = 0; i < N; i++) {
  const v = Math.tanh(buf[i] * 1.35) * 0.92;
  pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2);
}
const hdr = Buffer.alloc(44);
hdr.write("RIFF", 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write("WAVE", 8);
hdr.write("fmt ", 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22);
hdr.writeUInt32LE(SR, 24); hdr.writeUInt32LE(SR * 2, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34);
hdr.write("data", 36); hdr.writeUInt32LE(pcm.length, 40);

const work = resolve(tmpdir(), "askor-doc-render");
mkdirSync(work, { recursive: true });
const wav = resolve(work, "score.wav");
writeFileSync(wav, Buffer.concat([hdr, pcm]));
console.log(`score: ${(pcm.length / 1e6).toFixed(1)} MB pcm -> ${wav}`);

/* ----------------------------- the picture -------------------------- */
const ff = spawn(FFMPEG, [
  "-y", "-hide_banner", "-loglevel", "error",
  "-f", "image2pipe", "-framerate", String(FPS), "-i", "pipe:0",
  "-i", wav,
  "-c:v", "libx264", "-preset", "slow", "-crf", "17",
  "-pix_fmt", "yuv420p", "-r", String(FPS),
  "-c:a", "aac", "-b:a", "192k",
  "-shortest", "-movflags", "+faststart",
  OUT
], { stdio: ["pipe", "inherit", "inherit"] });

const write = chunk => new Promise(res => ff.stdin.write(chunk) ? res() : ff.stdin.once("drain", res));

const browser = await chromium.launch({
  args: ["--force-color-profile=srgb", "--disable-lcd-text", "--font-render-hinting=none"]
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.goto("file://" + PAGE);
await page.waitForFunction("!!window.__doc");
await page.evaluate(() => document.fonts.ready);

const total = DURATION * FPS;
for (let f = 0; f < total; f++) {
  const b64 = await page.evaluate(t => {
    window.__doc.renderAt(t);
    return document.getElementById("stage").toDataURL("image/jpeg", 0.95).slice(23);
  }, f / FPS);
  await write(Buffer.from(b64, "base64"));
  if (f % 60 === 0) process.stdout.write(`\rframe ${f}/${total}`);
}
process.stdout.write(`\rframe ${total}/${total}\n`);

await browser.close();
ff.stdin.end();
await new Promise((res, rej) => ff.on("close", c => c === 0 ? res() : rej(new Error("ffmpeg exit " + c))));
rmSync(work, { recursive: true, force: true });
console.log("wrote " + OUT);
