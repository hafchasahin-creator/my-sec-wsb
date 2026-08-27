// Renders orb.html frame-by-frame with headless Chromium into PNG files.
//
//   node render.mjs --out frames            render the full seamless loop
//   node render.mjs --out stills --times 0,1.3,2.6,4.1
//
// Encode afterwards (any full ffmpeg build):
//   ffmpeg -framerate 60 -i frames/f%04d.png -c:v libx264 -pix_fmt yuv420p \
//          -crf 17 -preset slow -movflags +faststart ai-energy-orb.mp4

import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]] : null)).filter(Boolean)
);

const FPS = Number(args.fps ?? 60);
const SECONDS = Number(args.seconds ?? 6);
const outDir = path.resolve(args.out ?? 'frames');
const times = args.times ? args.times.split(',').map(Number) : null;

fs.mkdirSync(outDir, { recursive: true });

const executablePath =
  process.env.ORB_CHROMIUM ?? '/opt/pw-browsers/chromium';

const browser = await chromium.launch({
  executablePath: fs.existsSync(executablePath) ? executablePath : undefined,
  args: ['--force-color-profile=srgb', '--disable-lcd-text'],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 1100 } });
await page.goto('file://' + path.join(here, 'orb.html'));
await page.waitForFunction('typeof window.renderFrame === "function"');

async function capture(t, file) {
  const dataUrl = await page.evaluate(tt => window.renderFrame(tt), t);
  fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
}

if (times) {
  for (const t of times) {
    await capture(t, path.join(outDir, `t${t.toFixed(3)}.png`));
    console.log(`still  t=${t}`);
  }
} else {
  const total = Math.round(FPS * SECONDS);
  for (let i = 0; i < total; i++) {
    await capture(i / FPS, path.join(outDir, `f${String(i).padStart(4, '0')}.png`));
    if (i % 60 === 0) console.log(`frame ${i}/${total}`);
  }
  console.log(`done: ${total} frames → ${outDir}`);
}

await browser.close();
