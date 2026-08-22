/*
 * Visual harness. Boots the real app in Chromium and captures the states that
 * matter, with the animation clock pinned so shots are comparable run to run.
 *
 *   node shoot.mjs [outdir]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] || '/tmp/claude-0/-home-user-my-sec-wsb/992d6acf-f8cd-55a1-b904-623d25870e29/scratchpad/shots';
mkdirSync(OUT, { recursive: true });
const URL_BASE = 'http://localhost:8123/index.html';

const DEVICES = [
  { id: 'portrait', width: 390, height: 844, dpr: 3 },
  { id: 'landscape', width: 844, height: 390, dpr: 3 },
  { id: 'tablet', width: 834, height: 1112, dpr: 2 },
  { id: 'small', width: 320, height: 568, dpr: 2 },
];

const errors = [];

async function shoot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  return `${OUT}/${name}.png`;
}

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox',
         '--force-prefers-reduced-motion=false'],
});

for (const d of DEVICES) {
  const ctx = await browser.newContext({
    viewport: { width: d.width, height: d.height },
    deviceScaleFactor: d.dpr,
    isMobile: d.width < 500,
    hasTouch: true,
    colorScheme: 'dark',
    permissions: [],
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${d.id}] pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${d.id}] console: ${m.text()}`); });

  await page.goto(URL_BASE, { waitUntil: 'networkidle' });
  // let the reveal finish, then pin the clock so shots are deterministic
  await page.waitForTimeout(1700);
  await page.evaluate(() => {
    const c = window.__clawd;
    c.stop();
    c.scene.view.reveal = 1;
    // draw one deterministic frame at t=3.1s (mid-inhale, eyes open)
    c.scene.update(3.1, 1 / 30);
    c.scene.draw(3.1);
  });
  await shoot(page, `${d.id}-01-idle`);

  if (d.id === 'portrait' || d.id === 'landscape') {
    await page.evaluate(() => window.__clawd.openSheet('sounds'));
    await page.waitForTimeout(420);
    await shoot(page, `${d.id}-02-sounds`);

    await page.evaluate(() => {
      const c = window.__clawd;
      c.settings.ambienceId = 'rain';
      c.closeSheet();
    });
    await page.waitForTimeout(340);
    await page.evaluate(() => window.__clawd.openSheet('mix'));
    await page.waitForTimeout(420);
    await shoot(page, `${d.id}-03-mix`);

    await page.evaluate(() => window.__clawd.openSheet('about'));
    await page.waitForTimeout(420);
    await shoot(page, `${d.id}-04-about`);

    await page.evaluate(() => window.__clawd.closeSheet());
    await page.waitForTimeout(340);

    // sleep mode, fully settled
    await page.evaluate(async () => {
      const c = window.__clawd;
      c.audio.state.ambienceId = 'rain';
      await c.sleep.enter();
      for (let i = 0; i < 400; i++) { c.sleep.update(0.1); }
      c.scene.update(60, 0.1); c.scene.draw(60);
    });
    await page.waitForTimeout(1300);
    await page.evaluate(() => {
      const c = window.__clawd;
      c.scene.update(61, 0.1); c.scene.draw(61);
    });
    await shoot(page, `${d.id}-05-sleep`);

    // morning
    await page.evaluate(() => {
      document.getElementById('morning-sub').textContent = 'you slept with rain for 7h 12m.';
      const rows = document.getElementById('morning-rows'); rows.textContent = '';
      for (const [k, v] of [['asleep', '11:42 pm'], ['awake', '6:54 am'], ['sound', 'rain']]) {
        const d = document.createElement('div');
        const dt = document.createElement('dt'); dt.textContent = k;
        const dd = document.createElement('dd'); dd.className = 'tabular'; dd.textContent = v;
        d.append(dt, dd); rows.append(d);
      }
      document.getElementById('morning').hidden = false;
    });
    await page.waitForTimeout(400);
    await shoot(page, `${d.id}-06-morning`);
  }

  await ctx.close();
}

await browser.close();
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); }
else console.log('no page errors');
console.log('shots ->', OUT);
