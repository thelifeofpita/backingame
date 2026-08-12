/* ============================================================================
   BACK IN SMOOTHLY — core
   Math, seeded RNG, pinhole camera, perspective polygon + texture drawing.
   Everything is expressed in metres. World axes: x = right, y = up, z = depth.
   The garage's back wall (the one wearing the poster) sits at z = 0.
   ========================================================================== */
(function (NS) {
  'use strict';

  /* ---- scalar helpers ---------------------------------------------------- */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (t) => t * t * (3 - 2 * t);
  const mix = lerp;
  // frame-rate independent exponential approach
  const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
  const sign = Math.sign;
  const TAU = Math.PI * 2;
  const norm = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

  /* ---- deterministic RNG (mulberry32) ------------------------------------ */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeRng(seed) {
    const r = mulberry32(seed);
    r.range = (a, b) => a + r() * (b - a);
    r.int = (a, b) => Math.floor(a + r() * (b - a + 1));
    r.pick = (arr) => arr[Math.floor(r() * arr.length) % arr.length];
    r.chance = (p) => r() < p;
    r.sign = () => (r() < 0.5 ? -1 : 1);
    r.seed = seed;
    return r;
  }

  /* ---- colour ------------------------------------------------------------ */
  function rgb(r, g, b, a) { return a === undefined ? `rgb(${r|0},${g|0},${b|0})` : `rgba(${r|0},${g|0},${b|0},${a})`; }
  function shade(c, k) { // multiply an [r,g,b] triple
    return rgb(clamp(c[0] * k, 0, 255), clamp(c[1] * k, 0, 255), clamp(c[2] * k, 0, 255));
  }
  function hexToRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  /* ========================================================================
     Camera — a plain pinhole. The wide-angle "fisheye" is applied later, in
     the post pass, exactly like a real reversing camera: the sensor sees a
     rectilinear world, the lens bends it.
     ====================================================================== */
  class Camera {
    constructor() {
      this.pos = { x: 0, y: 0.95, z: 8 };
      this.yaw = 0;          // 0 = looking towards +z
      this.pitch = -0.24;    // negative = looking down
      this.roll = 0;
      this.fov = 1.75;       // horizontal field of view, radians
      this.w = 480; this.h = 854;
      this.near = 0.06;
      this._m = new Float64Array(9);
      this.update();
    }
    setViewport(w, h) { this.w = w; this.h = h; this.update(); }
    update() {
      const { yaw, pitch, roll } = this;
      const sy = Math.sin(yaw), cy = Math.cos(yaw);
      const sp = Math.sin(pitch), cp = Math.cos(pitch);
      // forward, right, up  (right-handed, y up)
      let fx = sy * cp, fy = sp, fz = cy * cp;
      let rx = cy, ry = 0, rz = -sy;
      // up = forward x right
      let ux = fy * rz - fz * ry, uy = fz * rx - fx * rz, uz = fx * ry - fy * rx;
      if (roll) {
        const sr = Math.sin(roll), cr = Math.cos(roll);
        const nrx = rx * cr + ux * sr, nry = ry * cr + uy * sr, nrz = rz * cr + uz * sr;
        ux = ux * cr - rx * sr; uy = uy * cr - ry * sr; uz = uz * cr - rz * sr;
        rx = nrx; ry = nry; rz = nrz;
      }
      const m = this._m;
      m[0] = rx; m[1] = ry; m[2] = rz;
      m[3] = ux; m[4] = uy; m[5] = uz;
      m[6] = fx; m[7] = fy; m[8] = fz;
      this.fx = (this.w * 0.5) / Math.tan(this.fov * 0.5);
      this.fy = this.fx;
      this.cx = this.w * 0.5;
      this.cy = this.h * 0.5;
      this.dir = { x: fx, y: fy, z: fz };
    }
    /* world point -> view space {x right, y up, z forward} */
    toView(p, out) {
      const m = this._m, P = this.pos;
      const dx = p.x - P.x, dy = p.y - P.y, dz = p.z - P.z;
      out = out || {};
      out.x = m[0] * dx + m[1] * dy + m[2] * dz;
      out.y = m[3] * dx + m[4] * dy + m[5] * dz;
      out.z = m[6] * dx + m[7] * dy + m[8] * dz;
      return out;
    }
    /* view space -> screen pixels */
    project(v, out) {
      const iz = 1 / v.z;
      out = out || {};
      out.x = this.cx + this.fx * v.x * iz;
      out.y = this.cy - this.fy * v.y * iz;
      out.z = v.z;
      return out;
    }
    projectWorld(p, out) { return this.project(this.toView(p, _tmpV), out); }
  }
  const _tmpV = { x: 0, y: 0, z: 0 };

  /* ---- near-plane clipping of a view-space polygon ------------------------ */
  function clipNear(poly, near) {
    const out = [];
    const n = poly.length;
    if (!n) return out;
    let a = poly[n - 1], ain = a.z > near;
    for (let i = 0; i < n; i++) {
      const b = poly[i], bin = b.z > near;
      if (ain !== bin) {
        const t = (near - a.z) / (b.z - a.z);
        out.push({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: near, u: a.u !== undefined ? lerp(a.u, b.u, t) : undefined, v: a.v !== undefined ? lerp(a.v, b.v, t) : undefined });
      }
      if (bin) out.push(b);
      a = b; ain = bin;
    }
    return out;
  }

  /* ---- draw a world-space polygon --------------------------------------- */
  const _polyBuf = [];
  function polyToScreen(cam, pts, isView) {
    _polyBuf.length = 0;
    for (let i = 0; i < pts.length; i++) {
      _polyBuf.push(isView ? pts[i] : cam.toView(pts[i], {}));
    }
    const clipped = clipNear(_polyBuf, cam.near);
    if (clipped.length < 3) return null;
    const scr = new Array(clipped.length);
    for (let i = 0; i < clipped.length; i++) scr[i] = cam.project(clipped[i], {});
    return scr;
  }

  function tracePath(ctx, scr) {
    ctx.beginPath();
    ctx.moveTo(scr[0].x, scr[0].y);
    for (let i = 1; i < scr.length; i++) ctx.lineTo(scr[i].x, scr[i].y);
    ctx.closePath();
  }

  function fillPoly(ctx, cam, pts, style, isView) {
    const scr = polyToScreen(cam, pts, isView);
    if (!scr) return null;
    tracePath(ctx, scr);
    ctx.fillStyle = style;
    ctx.fill();
    return scr;
  }

  function strokePoly(ctx, cam, pts, style, width, isView, close) {
    const buf = [];
    for (let i = 0; i < pts.length; i++) buf.push(isView ? pts[i] : cam.toView(pts[i], {}));
    const clipped = clipNear(close === false ? buf : buf, cam.near);
    if (clipped.length < 2) return;
    ctx.beginPath();
    for (let i = 0; i < clipped.length; i++) {
      const s = cam.project(clipped[i], {});
      if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
    }
    if (close) ctx.closePath();
    ctx.strokeStyle = style; ctx.lineWidth = width; ctx.stroke();
  }

  /* ========================================================================
     Perspective-correct textured quad.
     Canvas2D can only do affine transforms, so the quad is diced into a grid
     and each cell drawn as two affine triangles. Cheap, and at the poster's
     on-screen size the residual error is well under a pixel.
     ====================================================================== */
  function drawTexturedQuad(ctx, img, cam, corners, opts) {
    opts = opts || {};
    const N = opts.subdiv || 6;
    const alpha = opts.alpha === undefined ? 1 : opts.alpha;
    if (alpha <= 0.002) return;
    const [P00, P10, P11, P01] = corners; // world: uv (0,0) (1,0) (1,1) (0,1)
    const grid = new Array((N + 1) * (N + 1));
    let anyBehind = false, minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (let j = 0; j <= N; j++) {
      const v = j / N;
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        // bilinear on the (planar) quad
        const ax = lerp(P00.x, P10.x, u), ay = lerp(P00.y, P10.y, u), az = lerp(P00.z, P10.z, u);
        const bx = lerp(P01.x, P11.x, u), by = lerp(P01.y, P11.y, u), bz = lerp(P01.z, P11.z, u);
        const w = { x: lerp(ax, bx, v), y: lerp(ay, by, v), z: lerp(az, bz, v) };
        const view = cam.toView(w, {});
        if (view.z <= cam.near) { anyBehind = true; grid[j * (N + 1) + i] = null; continue; }
        const s = cam.project(view, {});
        s.u = u; s.v = v;
        if (s.x < minX) minX = s.x; if (s.x > maxX) maxX = s.x;
        if (s.y < minY) minY = s.y; if (s.y > maxY) maxY = s.y;
        grid[j * (N + 1) + i] = s;
      }
    }
    if (maxX < 0 || maxY < 0 || minX > cam.w || minY > cam.h) return; // fully off-screen
    const tw = img.width, th = img.height;
    ctx.save();
    if (alpha < 1) ctx.globalAlpha *= alpha;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = grid[j * (N + 1) + i], b = grid[j * (N + 1) + i + 1],
              c = grid[(j + 1) * (N + 1) + i + 1], d = grid[(j + 1) * (N + 1) + i];
        if (!a || !b || !c || !d) continue;
        tri(ctx, img, a, b, c, tw, th);
        tri(ctx, img, a, c, d, tw, th);
      }
    }
    ctx.restore();
    if (anyBehind) return;
  }

  const _e = 0.6; // edge bleed, hides the hairline seams between cells
  function tri(ctx, img, p0, p1, p2, tw, th) {
    const x0 = p0.x, y0 = p0.y, x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y;
    const u0 = p0.u * tw, v0 = p0.v * th, u1 = p1.u * tw, v1 = p1.v * th, u2 = p2.u * tw, v2 = p2.v * th;
    const du1 = u1 - u0, dv1 = v1 - v0, du2 = u2 - u0, dv2 = v2 - v0;
    const det = du1 * dv2 - du2 * dv1;
    if (!det) return;
    const idet = 1 / det;
    const a = (x1 - x0) * dv2 * idet - (x2 - x0) * dv1 * idet;
    const b = (y1 - y0) * dv2 * idet - (y2 - y0) * dv1 * idet;
    const c = (x2 - x0) * du1 * idet - (x1 - x0) * du2 * idet;
    const d = (y2 - y0) * du1 * idet - (y1 - y0) * du2 * idet;
    const e = x0 - a * u0 - c * v0;
    const f = y0 - b * u0 - d * v0;
    // expand the clip triangle slightly outward from its centroid
    const gx = (x0 + x1 + x2) / 3, gy = (y0 + y1 + y2) / 3;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x0 + Math.sign(x0 - gx) * _e, y0 + Math.sign(y0 - gy) * _e);
    ctx.lineTo(x1 + Math.sign(x1 - gx) * _e, y1 + Math.sign(y1 - gy) * _e);
    ctx.lineTo(x2 + Math.sign(x2 - gx) * _e, y2 + Math.sign(y2 - gy) * _e);
    ctx.closePath();
    ctx.clip();
    ctx.transform(a, b, c, d, e, f);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }

  /* ---- mip pyramid so the poster stays crisp and cheap when far away ----- */
  function makeMips(img, levels) {
    const mips = [img];
    let cur = img;
    for (let i = 1; i < (levels || 3); i++) {
      const w = Math.max(2, Math.round(cur.width / 2)), h = Math.max(2, Math.round(cur.height / 2));
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const c = cv.getContext('2d');
      c.imageSmoothingQuality = 'high';
      c.drawImage(cur, 0, 0, w, h);
      mips.push(cv); cur = cv;
    }
    return mips;
  }
  function pickMip(mips, screenWidthPx) {
    for (let i = mips.length - 1; i > 0; i--) {
      if (mips[i].width >= screenWidthPx * 0.85) return mips[i];
    }
    return mips[0];
  }

  NS.core = {
    clamp, lerp, mix, smoothstep, damp, sign, norm, TAU,
    makeRng, mulberry32, rgb, shade, hexToRgb,
    Camera, clipNear, polyToScreen, tracePath, fillPoly, strokePoly,
    drawTexturedQuad, makeMips, pickMip,
  };
})(window.PM = window.PM || {});
