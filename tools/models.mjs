/* Bakes Kenney's Car Kit (CC0) into a compact module the unit can embed.
   Kenney ships OBJ plus a small colour atlas; every face lands on one flat
   patch of that atlas, so the texture can be thrown away and the colour baked
   per vertex. What comes out is indexed, quantised and about 25 KB a car.

     node tools/models.mjs /path/to/kenney_car-kit/Models
*/
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const SRC = process.argv[2] || '/tmp/kenney/carkit/Models';
const OBJ = join(SRC, 'OBJ format');
const TEX = join(OBJ, 'Textures', 'colormap.png');

/* which of the fifty models end up in a car park */
const WANTED = [
  { file: 'sedan', name: 'sedan' },
  { file: 'suv', name: 'suv' },
  { file: 'hatchback-sports', name: 'hatch' },
  { file: 'van', name: 'van' },
  { file: 'sedan-sports', name: 'coupe' },
];

/* ---- read the atlas once, via python (already a dependency of the build) -- */
function readAtlas(file) {
  const out = execFileSync('python3', ['-c', `
from PIL import Image
import sys, json
im = Image.open(${JSON.stringify(file)}).convert('RGB')
w, h = im.size
print(json.dumps({'w': w, 'h': h, 'px': list(im.tobytes())}))
`], { maxBuffer: 1 << 28 }).toString();
  const o = JSON.parse(out);
  return { w: o.w, h: o.h, px: Uint8Array.from(o.px) };
}
const atlas = readAtlas(TEX);
const sample = (u, v) => {
  const x = Math.min(atlas.w - 1, Math.max(0, Math.round(u * atlas.w - 0.5)));
  const y = Math.min(atlas.h - 1, Math.max(0, Math.round((1 - v) * atlas.h - 0.5)));
  const i = (y * atlas.w + x) * 3;
  return [atlas.px[i], atlas.px[i + 1], atlas.px[i + 2]];
};

/* ---- OBJ ---------------------------------------------------------------- */
function parseObj(text) {
  const V = [], VT = [], groups = [];
  let cur = { name: 'default', tris: [] };
  groups.push(cur);
  for (const line of text.split('\n')) {
    const p = line.trim().split(/\s+/);
    if (p[0] === 'v') V.push([+p[1], +p[2], +p[3]]);
    else if (p[0] === 'vt') VT.push([+p[1], +p[2]]);
    else if (p[0] === 'g' || p[0] === 'o') { cur = { name: p.slice(1).join(' '), tris: [] }; groups.push(cur); }
    else if (p[0] === 'f') {
      const idx = p.slice(1).map((c) => {
        const [vi, ti] = c.split('/');
        return { v: (+vi) - 1, t: ti ? (+ti) - 1 : -1 };
      });
      for (let i = 1; i < idx.length - 1; i++) cur.tris.push([idx[0], idx[i], idx[i + 1]]);
    }
  }
  return { V, VT, groups: groups.filter((g) => g.tris.length) };
}

/* ---- bake --------------------------------------------------------------- */
function bake(def) {
  const file = join(OBJ, def.file + '.obj');
  if (!existsSync(file)) throw new Error('missing ' + file);
  const { V, VT, groups } = parseObj(readFileSync(file, 'utf8'));

  // colour of every triangle, from the atlas
  const triColour = new Map();
  const tally = new Map();
  for (const g of groups) {
    for (const tri of g.tris) {
      let u = 0, v = 0, n = 0;
      for (const c of tri) if (c.t >= 0 && VT[c.t]) { u += VT[c.t][0]; v += VT[c.t][1]; n++; }
      const col = n ? sample(u / n, v / n) : [180, 180, 180];
      triColour.set(tri, col);
      if (/body|frame|chassis/i.test(g.name) || g.name === 'default') {
        const key = col.join(',');
        tally.set(key, (tally.get(key) || 0) + 1);
      }
    }
  }
  // the paint is the commonest colour on the body that is not glass or rubber
  let paintKey = null, best = 0;
  for (const [key, n] of tally) {
    const [r, gg, b] = key.split(',').map(Number);
    const lum = 0.299 * r + 0.587 * gg + 0.114 * b;
    if (lum < 42 || lum > 236) continue;         // tyres, glass, chrome, lights
    if (n > best) { best = n; paintKey = key; }
  }

  // index by (position, uv) so flat colour survives while vertices are shared
  const map = new Map();
  const pos = [], col = [], flag = [], index = [];
  let min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
  for (const g of groups) {
    const isWheel = /wheel/i.test(g.name);
    for (const tri of g.tris) {
      const c = triColour.get(tri);
      const tint = c.join(',') === paintKey ? 1 : 0;
      for (const vert of tri) {
        const key = vert.v + '|' + vert.t + '|' + tint;
        let id = map.get(key);
        if (id === undefined) {
          id = pos.length / 3;
          const p = V[vert.v];
          pos.push(p[0], p[1], p[2]);
          col.push(c[0], c[1], c[2]);
          flag.push(tint | (isWheel ? 2 : 0));
          for (let k = 0; k < 3; k++) { if (p[k] < min[k]) min[k] = p[k]; if (p[k] > max[k]) max[k] = p[k]; }
          map.set(key, id);
        }
        index.push(id);
      }
    }
  }

  // quantise positions to int16 over the model's own bounds
  const centre = [0, 0, 0].map((_, i) => (min[i] + max[i]) / 2);
  const half = Math.max(...[0, 1, 2].map((i) => (max[i] - min[i]) / 2)) || 1;
  const qpos = new Int16Array(pos.length);
  for (let i = 0; i < pos.length; i++) {
    qpos[i] = Math.round(((pos[i] - centre[i % 3]) / half) * 32000);
  }
  const idx = new Uint16Array(index);
  if (pos.length / 3 > 65535) throw new Error(def.name + ': too many vertices to index as uint16');

  const buf = Buffer.concat([
    Buffer.from(qpos.buffer),
    Buffer.from(Uint8Array.from(col).buffer),
    Buffer.from(Uint8Array.from(flag).buffer),
    Buffer.from(idx.buffer),
  ]);
  return {
    name: def.name,
    verts: pos.length / 3,
    tris: index.length / 3,
    centre, half,
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    min, max,
    b64: buf.toString('base64'),
  };
}

const models = WANTED.map(bake);
const total = models.reduce((a, m) => a + m.b64.length, 0);

const out = [
  '/* Kenney Car Kit (CC0, kenney.nl), baked flat-coloured and quantised by',
  '   tools/models.mjs. Positions are int16 over each model\'s own bounds;',
  '   colour is per-vertex from the kit\'s atlas, so no texture is shipped. */',
  'window.PM_MODELS = {',
];
for (const m of models) {
  out.push(`  ${m.name}: { verts: ${m.verts}, tris: ${m.tris}, ` +
    `centre: [${m.centre.map((v) => +v.toFixed(4))}], half: ${+m.half.toFixed(5)}, ` +
    `size: [${m.size.map((v) => +v.toFixed(4))}], ` +
    `data: "${m.b64}" },`);
}
out.push('};');
writeFileSync(join(process.cwd(), 'src', 'models.js'), out.join('\n') + '\n');

console.log(models.map((m) => `${m.name}: ${m.tris} tris, ${(m.b64.length / 1024).toFixed(0)} KB b64, size ${m.size.map((v) => v.toFixed(2)).join(' × ')}`).join('\n'));
console.log('total', (total / 1024).toFixed(0), 'KB base64');
