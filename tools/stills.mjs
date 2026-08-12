/* Renders the studio's 10 transparent stills straight to disk. */
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = 'stills';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--mute-audio', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 950, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) console.log('[err]', m.text()); });
await page.goto('http://127.0.0.1:8791/index.html#studio', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 3500));

const files = await page.evaluate(async () => {
  const st = PM.studio;
  st.long = 1600;               // render big; they are hero assets
  st.setFormat('9:16');
  const out = [];
  st.download = () => {};       // collect instead of downloading
  const blobs = await st.exportStills(10);
  for (const b of blobs) {
    const buf = await b.arrayBuffer();
    const u = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192));
    out.push(btoa(s));
  }
  return { seed: st.seed.toString(16), out };
}, { timeout: 180000 });

files.out.forEach((b64, i) => {
  const name = `${OUT}/back-in-smoothly_${String(i + 1).padStart(2, '0')}.png`;
  writeFileSync(name, Buffer.from(b64, 'base64'));
});
console.log('seed', files.seed, '·', files.out.length, 'stills');
await browser.close();
