/* Headless driver: load the unit, poke it, photograph it.
   node tools/shot.mjs --out shots/a.png --w 430 --h 880 --wait 900 \
        --eval "PM.game.startRound(true)" --then 2000 --key ArrowLeft:800   */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; };
const flag = (k) => argv.includes('--' + k);
const all = (k) => argv.reduce((a, v, i) => (v === '--' + k ? [...a, argv[i + 1]] : a), []);

const W = +arg('w', 430), H = +arg('h', 880);
const URL = arg('url', 'http://127.0.0.1:8791/index.html');
const OUT = arg('out', 'shots/shot.png');
const DPR = +arg('dpr', 2);

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'shell' === arg('mode') ? 'shell' : true,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-webgl', '--ignore-gpu-blocklist',
    '--allow-file-access-from-files',
    '--autoplay-policy=no-user-gesture-required',
    '--force-device-scale-factor=' + DPR,
    '--window-size=' + W + ',' + H,
    '--hide-scrollbars',
    '--mute-audio',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: DPR, hasTouch: flag('touch'), isMobile: flag('touch') });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${(e.stack || '').split('\n').slice(0, 4).join('\n')}`));

await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise((r) => setTimeout(r, +arg('wait', 900)));

for (const e of all('eval')) {
  try { const v = await page.evaluate(e); if (v !== undefined) console.log('eval →', JSON.stringify(v)); }
  catch (err) { console.log('eval error:', err.message); }
}

for (const spec of all('key')) {
  const [key, ms] = spec.split(':');
  await page.keyboard.down(key);
  await new Promise((r) => setTimeout(r, +(ms || 500)));
  await page.keyboard.up(key);
}

const then = +arg('then', 0);
if (then) await new Promise((r) => setTimeout(r, then));

for (const e of all('eval2')) {
  try { const v = await page.evaluate(e); if (v !== undefined) console.log('eval2 →', JSON.stringify(v)); }
  catch (err) { console.log('eval2 error:', err.message); }
}
if (+arg('then2', 0)) await new Promise((r) => setTimeout(r, +arg('then2')));

mkdirSync(dirname(OUT), { recursive: true });
await page.screenshot({ path: OUT });

const errs = logs.filter((l) => /pageerror|\[error\]|\[warning\]/i.test(l));
if (errs.length) console.log('--- console ---\n' + errs.slice(0, 25).join('\n'));
else if (flag('logs')) console.log(logs.slice(-30).join('\n'));
console.log('shot →', OUT);
await browser.close();
