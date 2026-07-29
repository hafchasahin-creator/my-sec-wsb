#!/usr/bin/env node
/**
 * Mirinda campaign renderer - CLI.
 *
 * Usage:
 *   node render.js --smoke              3-second pipeline check (ep01)
 *   node render.js --ep 4               render one episode to dist/ads/episodes
 *   node render.js --ep 4 --seconds 6   short cut of one episode
 *   node render.js --all                render all episodes, then concat
 *   node render.js --concat             concat already-rendered episodes
 *   node render.js --preview 7 --at 33  write a single frame to a PNG
 *
 * Run from anywhere; paths resolve relative to the repository root.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync } from 'node:fs';

import { renderEpisode, concatEpisodes, probe, EPISODE_SECONDS, FPS } from './src/render.js';
import { W, H } from './src/lib/camera.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const OUT_DIR = join(REPO, 'dist/ads');
const EP_DIR = join(OUT_DIR, 'episodes');

export const EPISODE_COUNT = 25;

/* ------------------------------------------------------------------ *
 * Episode loading
 * ------------------------------------------------------------------ */

const pad = (n) => String(n).padStart(2, '0');

export async function loadEpisode(n) {
  const file = join(HERE, 'src/episodes', `ep${pad(n)}.js`);
  if (!existsSync(file)) throw new Error(`episode ${n} not found at ${file}`);
  const mod = (await import(`file://${file}`)).default;
  // The renderer, not the module, is the authority on ordering.
  return { ...mod, index: n - 1, id: `ep${pad(n)}` };
}

export async function loadAll() {
  const out = [];
  for (let n = 1; n <= EPISODE_COUNT; n++) out.push(await loadEpisode(n));
  return out;
}

/* ------------------------------------------------------------------ *
 * Args
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v.startsWith('--')) {
      const key = v.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { a[key] = next; i++; } else a[key] = true;
    } else a._.push(v);
  }
  return a;
}

const fmtBytes = (b) => `${(b / 1048576).toFixed(1)} MB`;
const fmtTime = (s) => `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s`;

/* ------------------------------------------------------------------ *
 * Commands
 * ------------------------------------------------------------------ */

async function cmdPreview(n, at) {
  const ep = await loadEpisode(n);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ep.draw(ctx, at, { W, H, fps: FPS, seconds: EPISODE_SECONDS, frame: Math.round(at * FPS) });
  const out = process.env.PREVIEW_OUT || join(OUT_DIR, `preview_${ep.id}_${at}.png`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, canvas.toBuffer('image/png'));
  console.log(`preview -> ${out}  (${ep.title} @ ${at}s)`);
}

async function cmdEpisode(n, opt) {
  const ep = await loadEpisode(n);
  const out = opt.out || join(EP_DIR, `${ep.id}.mp4`);
  const seconds = opt.seconds ?? EPISODE_SECONDS;
  const t0 = Date.now();
  process.stdout.write(`[${ep.id}] ${ep.title} ... `);
  await renderEpisode(ep, out, {
    seconds,
    crf: opt.crf ?? 23,
    preset: opt.preset ?? 'medium',
    onProgress: (f, total) => {
      process.stdout.write(`\r[${ep.id}] ${ep.title} ... ${Math.round((f / total) * 100)}%   `);
    },
  });
  const size = statSync(out).size;
  console.log(`\r[${ep.id}] ${ep.title} ... done  ${fmtBytes(size)}  ${fmtTime((Date.now() - t0) / 1000)}      `);
  return out;
}

async function cmdAll(opt) {
  mkdirSync(EP_DIR, { recursive: true });
  const t0 = Date.now();
  const paths = [];
  for (let n = 1; n <= EPISODE_COUNT; n++) {
    const out = join(EP_DIR, `ep${pad(n)}.mp4`);
    // Resume support: an already-rendered episode of the right length is kept.
    if (opt.resume && existsSync(out) && statSync(out).size > 100000) {
      console.log(`[ep${pad(n)}] already rendered, skipping`);
      paths.push(out);
      continue;
    }
    paths.push(await cmdEpisode(n, opt));
  }
  console.log(`\nall episodes rendered in ${fmtTime((Date.now() - t0) / 1000)}`);
  return paths;
}

async function cmdConcat() {
  const paths = [];
  for (let n = 1; n <= EPISODE_COUNT; n++) {
    const p = join(EP_DIR, `ep${pad(n)}.mp4`);
    if (!existsSync(p)) throw new Error(`missing ${p} - render it first`);
    paths.push(p);
  }
  const out = join(OUT_DIR, 'mirinda_campaign_20min.mp4');
  console.log(`concatenating ${paths.length} episodes ...`);
  await concatEpisodes(paths, out);
  const info = await probe(out);
  console.log(
    `-> ${out}\n   ${fmtBytes(statSync(out).size)}  ${fmtTime(info.seconds || 0)}  ` +
      `${info.video?.codec} ${info.video?.w}x${info.video?.h}  audio ${info.audio?.codec}`
  );
  return out;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const opt = {
    seconds: a.seconds ? Number(a.seconds) : undefined,
    crf: a.crf ? Number(a.crf) : undefined,
    preset: a.preset || undefined,
    out: a.out || undefined,
    resume: !!a.resume,
  };

  if (a.preview) return cmdPreview(Number(a.preview), a.at ? Number(a.at) : 25);
  if (a.smoke) {
    const out = join(OUT_DIR, 'smoke.mp4');
    await cmdEpisode(1, { ...opt, seconds: 3, out, preset: 'veryfast' });
    const info = await probe(out);
    console.log(`smoke: ${JSON.stringify({ seconds: info.seconds, video: info.video, audio: info.audio })}`);
    return;
  }
  if (a.concat) return cmdConcat();
  if (a.all) { await cmdAll(opt); return cmdConcat(); }
  if (a.ep) return cmdEpisode(Number(a.ep), opt);

  console.log(`Mirinda campaign renderer
  --smoke            3-second pipeline check
  --ep N             render episode N (1..${EPISODE_COUNT})
  --all [--resume]   render every episode then concat
  --concat           concat already-rendered episodes
  --preview N --at S single frame to PNG
options: --seconds S --crf N --preset NAME --out PATH`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
