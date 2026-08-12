/* Bundles src/ into two single files:
     index.html      — the unit: a complete standalone document. Lives at the
                       repo root so GitHub Pages serves the game, not the README.
     dist/embed.html — the same page as body content only, for hosts that
                       supply their own document shell.
   No minifier, no dependencies: the point is that what ships is readable. */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = (f) => join(here, 'src', f);
const read = (f) => (existsSync(src(f)) ? readFileSync(src(f), 'utf8') : '');

const SCRIPTS = [
  'assets.js', 'core.js', 'world.js', 'sim.js', 'draw.js', 'post.js',
  'audio.js', 'input.js', 'diagram.js', 'game.js', 'studio.js', 'boot.js',
];

const css = read('fonts.css') + '\n' + read('ui.css');
const html = read('ui.html');
const js = SCRIPTS.map((f) => {
  const body = read(f);
  return body ? `/* ==== ${f} ${'='.repeat(Math.max(0, 62 - f.length))} */\n${body}` : '';
}).filter(Boolean).join('\n');

const TITLE = 'Back in smoothly — PlatanoMelón';
const DESC = 'A rear-view-camera parking game. Tilt your phone, back into the bay, do not touch a thing.';

const head = `<title>${TITLE}</title>
<meta name="description" content="${DESC}">
<meta name="theme-color" content="#060707">
<meta name="color-scheme" content="dark">`;

const bodyContent = `${html}\n<style>\n${css}\n</style>\n<script>\n${js}\n</script>\n`;

mkdirSync(join(here, 'dist'), { recursive: true });

writeFileSync(join(here, 'index.html'),
`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, user-scalable=no">
${head}
</head>
<body>
${bodyContent}</body>
</html>
`);

writeFileSync(join(here, 'dist', 'embed.html'), `${head}\n${bodyContent}`);

const kb = (p) => (statSync(join(here, p)).size / 1024).toFixed(0) + ' KB';
console.log(`built  index.html       ${kb('index.html')}`);
console.log(`built  dist/embed.html  ${kb('dist/embed.html')}`);
