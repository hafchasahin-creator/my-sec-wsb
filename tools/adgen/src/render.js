/**
 * Frame renderer and MP4 muxer.
 *
 * Frames are drawn with @napi-rs/canvas and pushed as raw RGBA straight into
 * ffmpeg's stdin - no PNG round-trip and no temporary frame files, which is
 * what keeps a 37,000-frame campaign render practical.
 */

import { createCanvas } from '@napi-rs/canvas';
import ffmpegPkg from '@ffmpeg-installer/ffmpeg';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { W, H } from './lib/camera.js';
import { renderEpisodeAudio } from './audio.js';

export const FFMPEG = ffmpegPkg.path;
export const FPS = 30;
export const EPISODE_SECONDS = 50;

/** Write a buffer to a stream, waiting for drain so memory stays bounded. */
function write(stream, buf) {
  return stream.write(buf) ? Promise.resolve() : new Promise((res) => stream.once('drain', res));
}

/**
 * Render an episode module to an MP4.
 *
 * @param {object} episode  { id, title, draw(ctx, t, api) }
 * @param {string} outPath
 * @param {object} opt  fps, seconds, crf, silent, onProgress
 */
export async function renderEpisode(episode, outPath, opt = {}) {
  const {
    fps = FPS,
    seconds = EPISODE_SECONDS,
    crf = 23,
    preset = 'medium',
    audio = true,
    onProgress = null,
  } = opt;

  mkdirSync(dirname(outPath), { recursive: true });
  const totalFrames = Math.round(seconds * fps);

  // --- soundtrack -------------------------------------------------------
  let wavPath = null;
  if (audio) {
    wavPath = join(tmpdir(), `mirinda-${episode.id}-${process.pid}.wav`);
    writeFileSync(wavPath, renderEpisodeAudio(episode.index ?? 0, seconds));
  }

  const args = [
    '-y', '-loglevel', 'error', '-nostdin',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(fps), '-i', 'pipe:0',
  ];
  if (wavPath) args.push('-i', wavPath);
  args.push(
    '-c:v', 'libx264', '-preset', preset, '-tune', 'animation', '-crf', String(crf),
    '-pix_fmt', 'yuv420p', '-g', String(fps * 2), '-movflags', '+faststart',
  );
  if (wavPath) args.push('-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-shortest');
  args.push('-t', String(seconds), outPath);

  const ff = spawn(FFMPEG, args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  ff.stderr.on('data', (d) => (stderr += d.toString()));
  // ffmpeg exiting early would otherwise crash the process on write.
  ff.stdin.on('error', () => {});

  const done = new Promise((resolve, reject) => {
    ff.on('error', reject);
    ff.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}\n${stderr.slice(-2000)}`))
    );
  });

  // --- frames -----------------------------------------------------------
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const api = { W, H, fps, seconds, totalFrames };

  try {
    for (let f = 0; f < totalFrames; f++) {
      const t = f / fps;
      ctx.save();
      ctx.resetTransform?.();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, W, H);
      episode.draw(ctx, t, { ...api, frame: f });
      ctx.restore();
      await write(ff.stdin, canvas.data());
      if (onProgress && f % 60 === 0) onProgress(f, totalFrames);
    }
  } finally {
    ff.stdin.end();
  }

  await done;
  if (wavPath && existsSync(wavPath)) unlinkSync(wavPath);
  return outPath;
}

/**
 * Concatenate rendered episode MP4s into the full campaign film.
 * Uses the concat demuxer with stream copy - no re-encode, so it is fast and
 * lossless, and every episode keeps the quality it was rendered at.
 */
export async function concatEpisodes(paths, outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  const listPath = join(tmpdir(), `mirinda-concat-${process.pid}.txt`);
  writeFileSync(listPath, paths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));

  const args = [
    '-y', '-loglevel', 'error', '-nostdin',
    '-f', 'concat', '-safe', '0', '-i', listPath,
    '-c', 'copy', '-movflags', '+faststart', outPath,
  ];
  await run(FFMPEG, args);
  unlinkSync(listPath);
  return outPath;
}

/** Run ffmpeg and resolve with its stderr (ffmpeg reports everything there). */
export function run(bin, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.stderr.on('data', (d) => (out += d.toString()));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${bin} exited ${code}\n${out.slice(-3000)}`))));
  });
}

/** Probe a media file using ffmpeg itself (ffprobe is not shipped with the pkg). */
export async function probe(path) {
  let out = '';
  try {
    out = await run(FFMPEG, ['-hide_banner', '-i', path, '-f', 'null', '-']);
  } catch (e) {
    out = String(e.message);
  }
  const dur = out.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
  const v = out.match(/Video:\s*([a-z0-9]+).*?(\d{3,4})x(\d{3,4})/i);
  const a = out.match(/Audio:\s*([a-z0-9]+)/i);
  return {
    seconds: dur ? +dur[1] * 3600 + +dur[2] * 60 + parseFloat(dur[3]) : null,
    video: v ? { codec: v[1], w: +v[2], h: +v[3] } : null,
    audio: a ? { codec: a[1] } : null,
    raw: out,
  };
}

/** Pull a single frame out of a video as a PNG - used for visual verification. */
export async function grabFrame(videoPath, atSeconds, pngPath) {
  mkdirSync(dirname(pngPath), { recursive: true });
  await run(FFMPEG, ['-y', '-loglevel', 'error', '-ss', String(atSeconds), '-i', videoPath, '-frames:v', '1', pngPath]);
  return pngPath;
}
