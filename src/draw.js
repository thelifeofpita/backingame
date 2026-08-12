/* ============================================================================
   BACK IN SMOOTHLY — scene renderer
   Draws the car park the way a reversing camera sees it: low resolution,
   auto-gained to a flat grey, everything falling into the dark past four
   metres. The lens itself is applied afterwards, in post.
   ========================================================================== */
(function (NS) {
  'use strict';
  const C = NS.core;
  const { clamp, lerp, damp, rgb, shade } = C;
  const W = NS.world;

  /* ---- the palette, straight off the artwork ----------------------------- */
  const PAL = {
    yellow: '#FFEA00', yellowRGB: [255, 234, 0],
    lilac: '#9F8DC7', lilacRGB: [159, 141, 199],
    pink: '#FF33AC', pinkRGB: [255, 51, 172],
    green: '#7BE03C', greenRGB: [123, 224, 60],
    red: '#FF2E12', redRGB: [255, 46, 18],
    fog: [24, 27, 29],
    concrete: [128, 130, 128],
    floor: [104, 106, 106],
    ceil: [56, 58, 60],
  };

  const FOG_K = 0.105;
  function fogAmt(d) { return 1 - Math.exp(-Math.max(0, d - 1.2) * FOG_K * 1.9); }
  function fogged(c, d, mul) {
    const f = fogAmt(d), m = mul === undefined ? 1 : mul;
    return rgb(
      lerp(c[0] * m, PAL.fog[0], f),
      lerp(c[1] * m, PAL.fog[1], f),
      lerp(c[2] * m, PAL.fog[2], f)
    );
  }
  const dist2 = (cam, x, z) => Math.hypot(x - cam.pos.x, z - cam.pos.z);

  /* ---- ad textures ------------------------------------------------------- */
  const ads = [];
  function loadAds() {
    const defs = window.PM_ADS || [];
    return Promise.all(defs.map((d) => new Promise((res) => {
      const img = new Image();
      img.onload = () => {
        const mips = C.makeMips(img, 4);
        const shadow = silhouette(mips[2] || img);
        // WebGL1 will not mipmap a non-power-of-two texture, and without mips
        // the poster crawls with aliasing at the far end of the car park. Square
        // it off here; the quad carries the real aspect ratio.
        res({ id: d.id, shape: d.shape, img, mips, shadow,
              pot: toPot(img, 512), potShadow: toPot(shadow, 256),
              w: img.width, h: img.height, ar: img.width / img.height });
      };
      img.onerror = () => res(null);
      img.src = d.src;
    }))).then((list) => {
      list.forEach((a) => { if (a) ads.push(a); });
      NS.ads = ads;
      return ads;
    });
  }

  function toPot(src, n) {
    const cv = document.createElement('canvas');
    cv.width = n; cv.height = n;
    const c = cv.getContext('2d');
    c.imageSmoothingQuality = 'high';
    c.drawImage(src, 0, 0, n, n);
    return cv;
  }

  /* a black copy of the sticker, for the shadow it casts on the concrete */
  function silhouette(src) {
    const cv = document.createElement('canvas');
    cv.width = src.width; cv.height = src.height;
    const c = cv.getContext('2d');
    c.drawImage(src, 0, 0);
    const d = c.getImageData(0, 0, cv.width, cv.height);
    const px = d.data;
    for (let i = 0; i < px.length; i += 4) {
      px[i] = 8; px[i + 1] = 9; px[i + 2] = 9;
      px[i + 3] = px[i + 3] * 0.42;
    }
    c.putImageData(d, 0, 0);
    return cv;
  }

  /* ======================================================================== */
  /*  BACK WALL                                                               */
  /* ======================================================================== */
  /* the three walls that are not the poster wall — they only ever appear at
     the edge of frame, but without them the world visibly runs out */
  function drawShell(ctx, cam, L) {
    const g = L.geo, h = g.ceilY;
    const far = g.laneZ1;
    const band = (pts, d, mul) => C.fillPoly(ctx, cam, pts, fogged([96, 98, 98], d, mul));
    for (let i = 0; i < 5; i++) {
      const a = lerp(0, far, i / 5), b = lerp(0, far, (i + 1) / 5);
      const dm = Math.abs(cam.pos.z - (a + b) / 2) + Math.abs(cam.pos.x - g.xMin);
      band([{ x: g.xMin, y: 0, z: a }, { x: g.xMin, y: 0, z: b }, { x: g.xMin, y: h, z: b }, { x: g.xMin, y: h, z: a }], dm, 0.6);
      const dp = Math.abs(cam.pos.z - (a + b) / 2) + Math.abs(g.xMax - cam.pos.x);
      band([{ x: g.xMax, y: 0, z: b }, { x: g.xMax, y: 0, z: a }, { x: g.xMax, y: h, z: a }, { x: g.xMax, y: h, z: b }], dp, 0.6);
    }
    for (let i = 0; i < 8; i++) {
      const a = lerp(g.xMin, g.xMax, i / 8), b = lerp(g.xMin, g.xMax, (i + 1) / 8);
      band([{ x: b, y: 0, z: far }, { x: a, y: 0, z: far }, { x: a, y: h, z: far }, { x: b, y: h, z: far }],
        dist2(cam, (a + b) / 2, far), 0.72);
    }
  }

  function drawWall(ctx, cam, L, view) {
    const g = L.geo, N = 10;
    const x0 = g.xMin, x1 = g.xMax;
    for (let i = 0; i < N; i++) {
      const a = lerp(x0, x1, i / N), b = lerp(x0, x1, (i + 1) / N);
      const d = dist2(cam, (a + b) / 2, 0);
      // fluorescent tubes hang 1.5 m off the wall: the top of the wall catches more
      C.fillPoly(ctx, cam, [
        { x: a, y: 0, z: 0 }, { x: b, y: 0, z: 0 },
        { x: b, y: 1.6, z: 0 }, { x: a, y: 1.6, z: 0 },
      ], fogged(PAL.concrete, d, 0.78));
      C.fillPoly(ctx, cam, [
        { x: a, y: 1.6, z: 0 }, { x: b, y: 1.6, z: 0 },
        { x: b, y: g.ceilY, z: 0 }, { x: a, y: g.ceilY, z: 0 },
      ], fogged(PAL.concrete, d, 0.9));
    }
    // vertical shuttering seams in the concrete
    for (let x = Math.ceil(x0 / 1.22) * 1.22; x < x1; x += 1.22) {
      C.strokePoly(ctx, cam, [{ x, y: 0.02, z: 0.001 }, { x, y: g.ceilY, z: 0.001 }],
        `rgba(30,32,33,${0.30 * (1 - fogAmt(dist2(cam, x, 0)))})`, 1.6, false, false);
    }
    // grime: darker at the base, damp patches above
    for (const s of L.stains) {
      const d = dist2(cam, s.x, 0);
      const a = s.a * (1 - fogAmt(d));
      if (a < 0.012) continue;
      C.fillPoly(ctx, cam, [
        { x: s.x - s.w / 2, y: s.y - s.h / 2, z: 0.002 }, { x: s.x + s.w / 2, y: s.y - s.h / 2, z: 0.002 },
        { x: s.x + s.w / 2, y: s.y + s.h / 2, z: 0.002 }, { x: s.x - s.w / 2, y: s.y + s.h / 2, z: 0.002 },
      ], s.dark ? `rgba(38,40,40,${a})` : `rgba(196,196,188,${a * 0.7})`);
    }
    // skirting: the dark band every car park wall has
    for (let i = 0; i < N; i++) {
      const a = lerp(x0, x1, i / N), b = lerp(x0, x1, (i + 1) / N);
      const d = dist2(cam, (a + b) / 2, 0);
      C.fillPoly(ctx, cam, [
        { x: a, y: 0, z: 0.003 }, { x: b, y: 0, z: 0.003 },
        { x: b, y: 0.34, z: 0.003 }, { x: a, y: 0.34, z: 0.003 },
      ], fogged([70, 71, 70], d, 1));
    }
    // level marker, in house lilac
    const sx = W.bayCenterX(L.target.k + 3 * L.exitSide);
    drawWallText(ctx, cam, L.levelSign, sx, 2.30, 0.44, PAL.lilac, 0.55);

    // bay numbers, stencilled over each bay
    for (let k = g.bayMin; k <= g.bayMax; k++) {
      const bx = W.bayCenterX(k);
      if (Math.abs(bx - cam.pos.x) > 7.5) continue;
      drawWallText(ctx, cam, String(k + 12), bx, 2.52, 0.30, 'rgba(214,216,208,0.75)',
        0.55 * (1 - fogAmt(dist2(cam, bx, 0))));
    }

    // the green box that is on every car park wall, and the red one beside it
    const F = L.fixtures;
    if (F) {
      wallPlate(ctx, cam, F.exit.x, F.exit.y, 0.62, 0.24, [30, 168, 62], 0.55);
      drawWallText(ctx, cam, 'SALIDA', F.exit.x, F.exit.y, 0.13, '#ffffff', 0.9);
      wallPlate(ctx, cam, F.hose.x, F.hose.y, 0.42, 0.62, [168, 42, 34], 0.12);
      wallPlate(ctx, cam, F.hose.x, F.hose.y, 0.34, 0.54, [128, 32, 26], 0.06);
    }
  }

  const _txtCache = new Map();
  function textCanvas(text, color) {
    const key = text + '|' + color;
    let cv = _txtCache.get(key);
    if (cv) return cv;
    cv = document.createElement('canvas');
    const c = cv.getContext('2d');
    const pad = 8, fs = 64, font = `700 ${fs}px 'DM Sans', ui-sans-serif, system-ui, sans-serif`;
    c.font = font;
    cv.width = Math.ceil(c.measureText(text).width) + pad * 2;
    cv.height = fs + pad * 2;
    c.font = font;
    c.fillStyle = color;
    c.textBaseline = 'middle';
    c.letterSpacing = '2px';
    c.fillText(text, pad, cv.height / 2);
    if (_txtCache.size > 40) _txtCache.clear();
    _txtCache.set(key, cv);
    return cv;
  }
  function drawWallText(ctx, cam, text, cx, cy, h, color, alpha) {
    const _txtCv = textCanvas(text, color);
    const ar = _txtCv.width / _txtCv.height;
    const w = h * ar;
    const d = dist2(cam, cx, 0);
    const a = alpha * (1 - fogAmt(d));
    if (a < 0.02) return;
    // uv (0,0) is the image's top-left; on a wall seen from the lane that is
    // world +x, +y — the same mapping the poster uses
    C.drawTexturedQuad(ctx, _txtCv, cam, [
      { x: cx + w / 2, y: cy + h / 2, z: 0.004 }, { x: cx - w / 2, y: cy + h / 2, z: 0.004 },
      { x: cx - w / 2, y: cy - h / 2, z: 0.004 }, { x: cx + w / 2, y: cy - h / 2, z: 0.004 },
    ], { subdiv: 3, alpha: a });
  }

  /* a lit box or a painted cabinet, flat on the wall */
  function wallPlate(ctx, cam, cx, cy, w, h, col, glow) {
    const d = dist2(cam, cx, 0);
    const f = 1 - fogAmt(d);
    if (f < 0.05) return;
    const k = 0.55 + 0.45 * f + (glow || 0);
    C.fillPoly(ctx, cam, [
      { x: cx - w / 2, y: cy - h / 2, z: 0.005 }, { x: cx + w / 2, y: cy - h / 2, z: 0.005 },
      { x: cx + w / 2, y: cy + h / 2, z: 0.005 }, { x: cx - w / 2, y: cy + h / 2, z: 0.005 },
    ], rgb(clamp(col[0] * k, 0, 255), clamp(col[1] * k, 0, 255), clamp(col[2] * k, 0, 255)));
  }

  /* ---- the poster -------------------------------------------------------- */
  function drawPoster(ctx, cam, L, opts) {
    const ad = ads[L.poster.index % (ads.length || 1)];
    if (!ad) return;
    const p = L.poster;
    const h = p.h, w = h * ad.ar;
    const cr = Math.cos(p.rot), sr = Math.sin(p.rot);
    const corner = (u, v) => {
      // the camera looks down -z, so screen-right is world -x: the poster's
      // own left-to-right has to run that way or it reads back to front
      const lx = (0.5 - u) * w, ly = (0.5 - v) * h;
      const x = p.cx + lx * cr - ly * sr;
      const y = p.cy + lx * sr + ly * cr;
      // the sticker lifts off the concrete at its edges
      const lift = p.curl * (Math.abs(u - 0.5) + Math.abs(v - 0.5)) * 2;
      return { x, y, z: 0.006 + lift };
    };
    const d = dist2(cam, p.cx, 0);
    const a = clamp(1 - fogAmt(d) * 0.22, 0.6, 1);
    // gauge the on-screen size so we pick a sensible mip
    const s0 = cam.projectWorld(corner(0, 0.5), {}), s1 = cam.projectWorld(corner(1, 0.5), {});
    const px = Math.abs(s1.x - s0.x) || 60;
    const img = C.pickMip(ad.mips, px);
    if (ad.shadow) {
      const sh = [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)]
        .map((q) => ({ x: q.x + 0.018, y: q.y - 0.022, z: 0.004 }));
      C.drawTexturedQuad(ctx, ad.shadow, cam, sh, { subdiv: 4, alpha: a });
    }
    C.drawTexturedQuad(ctx, img, cam, [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)],
      { subdiv: (opts && opts.subdiv) || 6, alpha: a });
    // it still lives in the same murk as everything else, just less of it
    C.fillPoly(ctx, cam, [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)],
      `rgba(24,27,29,${fogAmt(d) * 0.26})`);
    return true;
  }

  /* ======================================================================== */
  /*  CEILING + LIGHTS                                                        */
  /* ======================================================================== */
  function drawCeiling(ctx, cam, L, t) {
    const g = L.geo;
    for (let i = 0; i < 6; i++) {
      const a = lerp(0, g.laneZ1, i / 6), b = lerp(0, g.laneZ1, (i + 1) / 6);
      C.fillPoly(ctx, cam, [
        { x: g.xMin, y: g.ceilY, z: a }, { x: g.xMax, y: g.ceilY, z: a },
        { x: g.xMax, y: g.ceilY, z: b }, { x: g.xMin, y: g.ceilY, z: b },
      ], fogged(PAL.ceil, dist2(cam, cam.pos.x, (a + b) / 2), 1));
    }
    // service duct running the length of the ceiling
    for (const ln of L.lights) {
      C.fillPoly(ctx, cam, [
        { x: g.xMin, y: g.ceilY - 0.001, z: ln.z - 0.26 }, { x: g.xMax, y: g.ceilY - 0.001, z: ln.z - 0.26 },
        { x: g.xMax, y: g.ceilY - 0.001, z: ln.z + 0.26 }, { x: g.xMin, y: g.ceilY - 0.001, z: ln.z + 0.26 },
      ], 'rgba(34,36,38,0.9)');
      for (let x = ln.x0 + ln.phase; x < ln.x1; x += ln.gap) {
        const flick = L.flicker && Math.abs(L.flicker.x - x) < 1.6 && Math.abs(L.flicker.z - ln.z) < 0.5
          ? (Math.sin(t * 31 + L.flicker.seed) > 0.55 ? 0.25 : 1) : 1;
        const d = dist2(cam, x + 0.75, ln.z);
        const k = (1 - fogAmt(d) * 0.8) * flick;
        // old tubes and new ones never match: one row runs warm, the other cold
        const wm = ln.warm || 0;
        C.fillPoly(ctx, cam, [
          { x, y: g.ceilY - 0.02, z: ln.z - 0.09 }, { x: x + 1.5, y: g.ceilY - 0.02, z: ln.z - 0.09 },
          { x: x + 1.5, y: g.ceilY - 0.02, z: ln.z + 0.09 }, { x, y: g.ceilY - 0.02, z: ln.z + 0.09 },
        ], rgb((238 + wm * 14) * k + 8, 244 * k + 8, (232 - wm * 22) * k + 8));
      }
    }
  }

  /* ======================================================================== */
  /*  FLOOR                                                                   */
  /* ======================================================================== */
  function drawFloor(ctx, cam, L, st, t) {
    const g = L.geo, BANDS = 11;
    const zEnd = g.laneZ1;
    for (let i = 0; i < BANDS; i++) {
      const a = (i / BANDS) ** 1.5 * zEnd, b = ((i + 1) / BANDS) ** 1.5 * zEnd;
      const d = Math.abs(cam.pos.z - (a + b) / 2);
      C.fillPoly(ctx, cam, [
        { x: g.xMin, y: 0, z: a }, { x: g.xMax, y: 0, z: a },
        { x: g.xMax, y: 0, z: b }, { x: g.xMin, y: 0, z: b },
      ], fogged(PAL.floor, d, 1));
    }
    // pools of light under each tube
    ctx.globalCompositeOperation = 'lighter';
    for (const ln of L.lights) {
      for (let x = ln.x0 + ln.phase; x < ln.x1; x += ln.gap) {
        const cx = x + 0.75;
        if (Math.abs(cx - cam.pos.x) > 9) continue;
        const d = dist2(cam, cx, ln.z);
        if (d < 4.2) continue;      // too close: the ellipse would wrap the lens
        for (let r = 3; r >= 1; r--) {
          const rad = r * 0.95;
          const alpha = (0.032 / r) * (1 - fogAmt(d)) * clamp((d - 4.2) / 2.5, 0, 1);
          if (alpha < 0.006) continue;
          const pts = [];
          for (let k = 0; k < 14; k++) {
            const ang = (k / 14) * Math.PI * 2;
            pts.push({ x: cx + Math.cos(ang) * rad * 1.1, y: 0.001, z: ln.z + Math.sin(ang) * rad });
          }
          C.fillPoly(ctx, cam, pts, `rgba(${196 + (ln.warm || 0) * 8},200,${196 - (ln.warm || 0) * 10},${alpha})`);
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';

    // oil marks and tyre scuffs
    for (const m of L.floorMarks) {
      const d = dist2(cam, m.x, m.z);
      const a = m.a * (1 - fogAmt(d));
      if (a < 0.01) continue;
      C.fillPoly(ctx, cam, [
        { x: m.x - m.w / 2, y: 0.002, z: m.z - m.d / 2 }, { x: m.x + m.w / 2, y: 0.002, z: m.z - m.d / 2 },
        { x: m.x + m.w / 2, y: 0.002, z: m.z + m.d / 2 }, { x: m.x - m.w / 2, y: 0.002, z: m.z + m.d / 2 },
      ], `rgba(38,38,36,${a})`);
    }
    for (const s of L.skids) {
      const a = s.a * (1 - fogAmt(dist2(cam, s.x, s.z)));
      if (a < 0.01) continue;
      const dx = Math.sin(s.rot) * s.len, dz = Math.cos(s.rot) * s.len;
      C.fillPoly(ctx, cam, [
        { x: s.x - 0.05, y: 0.002, z: s.z }, { x: s.x + 0.05, y: 0.002, z: s.z },
        { x: s.x + dx + 0.05, y: 0.002, z: s.z + dz }, { x: s.x + dx - 0.05, y: 0.002, z: s.z + dz },
      ], `rgba(30,30,30,${a})`);
    }

    /* --- bay markings --------------------------------------------------- */
    for (let k = g.bayMin; k <= g.bayMax + 1; k++) {
      const x = W.bayCenterX(k) - g.bayW / 2;
      if (Math.abs(x - cam.pos.x) > 11) continue;
      const d = dist2(cam, x, 2.5);
      const wear = 0.62 - fogAmt(d) * 0.5;
      if (wear < 0.03) continue;
      paintStripe(ctx, cam, x, g.kerbZ + 0.05, x, g.laneZ0, 0.11, `rgba(214,214,206,${wear})`);
    }
    // the aisle line along the mouth of the bays
    paintStripe(ctx, cam, g.xMin, g.laneZ0, g.xMax, g.laneZ0, 0.10, 'rgba(214,214,206,0.34)', true);

    // one bay painted blue, as every car park has
    const ak = L.fixtures ? L.fixtures.accessibleK : null;
    if (ak !== null && ak !== L.target.k && Math.abs(W.bayCenterX(ak) - cam.pos.x) < 9) {
      const ax = W.bayCenterX(ak);
      const af = 1 - fogAmt(dist2(cam, ax, 3));
      C.fillPoly(ctx, cam, [
        { x: ax - g.bayW * 0.36, y: 0.003, z: 1.5 }, { x: ax + g.bayW * 0.36, y: 0.003, z: 1.5 },
        { x: ax + g.bayW * 0.36, y: 0.003, z: 4.3 }, { x: ax - g.bayW * 0.36, y: 0.003, z: 4.3 },
      ], `rgba(38,86,168,${0.55 * af})`);
      C.fillPoly(ctx, cam, [
        { x: ax - 0.30, y: 0.004, z: 2.35 }, { x: ax + 0.30, y: 0.004, z: 2.35 },
        { x: ax + 0.30, y: 0.004, z: 3.45 }, { x: ax - 0.30, y: 0.004, z: 3.45 },
      ], `rgba(228,232,238,${0.6 * af})`);
    }

    /* --- wheel stops: why nobody parks with their bumper on the wall ---- */
    for (let k = g.bayMin; k <= g.bayMax; k++) {
      const cx = W.bayCenterX(k);
      if (Math.abs(cx - cam.pos.x) > 8.5) continue;
      const d = dist2(cam, cx, g.stopZ);
      const fade = 1 - fogAmt(d);
      if (fade < 0.05) continue;
      const isTarget = L.target.k === k;
      drawWheelStop(ctx, cam, cx, g.stopZ, g.bayW * 0.34, isTarget, d);
      void fade;
    }

    /* --- the target bay: chevrons pointing home ------------------------- */
    const tgt = L.target;
    const live = st && st.phase === 'drive';
    const ok = st && st.inBox && st.aligned;
    // house lilac, not guide-line yellow: the bay you want and the path you are
    // taking are two different pieces of information and should not share a hue
    const col = ok ? PAL.greenRGB : PAL.lilacRGB;
    const pulse = live ? 0.55 + 0.45 * Math.sin(t * 3.4) : 0.85;
    // fade the markings out as the car arrives — the poster is the payoff
    const close = st ? clamp((st.wallGap - 0.8) / 1.7, 0.12, 1) : 1;
    const oa = (ok ? 0.72 : 0.52) * (live ? 1 : 0.7) * close;
    paintStripe(ctx, cam, tgt.cx - tgt.halfW, g.kerbZ + 0.05, tgt.cx - tgt.halfW, g.laneZ0, 0.095, rgbaArr(col, oa));
    paintStripe(ctx, cam, tgt.cx + tgt.halfW, g.kerbZ + 0.05, tgt.cx + tgt.halfW, g.laneZ0, 0.095, rgbaArr(col, oa));
    paintStripe(ctx, cam, tgt.cx - tgt.halfW, g.kerbZ + 0.06, tgt.cx + tgt.halfW, g.kerbZ + 0.06, 0.095, rgbaArr(col, oa));
    // chevrons flowing towards the wall — an invitation, not a floodlight,
    // and they bow out once the car is close enough to see for itself
    const near = st ? clamp((st.wallGap - 1.3) / 1.8, 0, 1) : 1;
    for (let i = 0; i < 3; i++) {
      const base = 1.45 + i * 1.0;
      const phase = live ? ((t * 0.9 + i * 0.33) % 1) : 0.5;
      const a = (0.20 + 0.40 * (1 - Math.abs(phase * 2 - 1))) * pulse * near;
      if (a < 0.02) continue;
      chevron(ctx, cam, tgt.cx, base, 0.58, 0.30, rgbaArr(col, a));
    }
  }
  function rgbaArr(c, a) { return `rgba(${c[0]},${c[1]},${c[2]},${clamp(a, 0, 1)})`; }

  /* a low concrete kerb the back wheels are meant to meet */
  function drawWheelStop(ctx, cam, cx, z, halfW, isTarget, d) {
    const h = 0.13, dep = 0.16;
    const F = [];
    pushBox(F, cx, h / 2, z, halfW, h / 2, dep / 2, 0,
      isTarget ? [150, 148, 132] : [118, 118, 112],
      isTarget ? [128, 126, 112] : [98, 98, 94], 'stop');
    drawSolid(ctx, cam, F);
    if (isTarget) {   // a painted top, so it reads as the thing to aim at
      C.fillPoly(ctx, cam, [
        { x: cx - halfW * 0.92, y: h + 0.002, z: z - dep * 0.3 },
        { x: cx + halfW * 0.92, y: h + 0.002, z: z - dep * 0.3 },
        { x: cx + halfW * 0.92, y: h + 0.002, z: z + dep * 0.3 },
        { x: cx - halfW * 0.92, y: h + 0.002, z: z + dep * 0.3 },
      ], rgbaArr(PAL.yellowRGB, 0.72 * (1 - fogAmt(d))));
    }
  }

  function paintStripe(ctx, cam, x0, z0, x1, z1, w, style) {
    const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1;
    const nx = (-dz / l) * w * 0.5, nz = (dx / l) * w * 0.5;
    C.fillPoly(ctx, cam, [
      { x: x0 - nx, y: 0.004, z: z0 - nz }, { x: x1 - nx, y: 0.004, z: z1 - nz },
      { x: x1 + nx, y: 0.004, z: z1 + nz }, { x: x0 + nx, y: 0.004, z: z0 + nz },
    ], style);
  }
  function chevron(ctx, cam, cx, z, w, depth, style) {
    const t = 0.13;
    C.fillPoly(ctx, cam, [
      { x: cx - w / 2, y: 0.005, z: z + depth }, { x: cx, y: 0.005, z },
      { x: cx, y: 0.005, z: z + t * 1.6 }, { x: cx - w / 2 + t * 0.9, y: 0.005, z: z + depth + t * 0.5 },
    ], style);
    C.fillPoly(ctx, cam, [
      { x: cx + w / 2, y: 0.005, z: z + depth }, { x: cx, y: 0.005, z },
      { x: cx, y: 0.005, z: z + t * 1.6 }, { x: cx + w / 2 - t * 0.9, y: 0.005, z: z + depth + t * 0.5 },
    ], style);
  }

  /* ======================================================================== */
  /*  SOLIDS                                                                  */
  /* ======================================================================== */
  const LIGHT_DIR = (() => { const v = { x: 0.25, y: 1, z: 0.35 }; const l = Math.hypot(v.x, v.y, v.z); return { x: v.x / l, y: v.y / l, z: v.z / l }; })();

  function pushBox(faces, cx, cy, cz, hx, hy, hz, heading, colTop, colSide, tag) {
    const s = Math.sin(heading || 0), c = Math.cos(heading || 0);
    const V = (f, u, r) => ({ x: cx + s * f + c * r, y: cy + u, z: cz + c * f - s * r });
    // f = along heading (length), r = right (width), u = up
    const A = V(-hz, -hy, -hx), B = V(hz, -hy, -hx), Cc = V(hz, -hy, hx), D = V(-hz, -hy, hx);
    const E = V(-hz, hy, -hx), F = V(hz, hy, -hx), G = V(hz, hy, hx), H = V(-hz, hy, hx);
    faces.push({ pts: [E, F, G, H], n: { x: 0, y: 1, z: 0 }, col: colTop, tag });
    faces.push({ pts: [B, Cc, G, F], n: { x: s, y: 0, z: c }, col: colSide, tag });                 // front
    faces.push({ pts: [D, A, E, H], n: { x: -s, y: 0, z: -c }, col: colSide, tag: tag + '-back' }); // back
    faces.push({ pts: [A, B, F, E], n: { x: -c, y: 0, z: s }, col: colSide, tag });                 // left side (-r)
    faces.push({ pts: [Cc, D, H, G], n: { x: c, y: 0, z: -s }, col: colSide, tag });                // right side
    return faces;
  }

  /* ========================================================================
     Cars, built by lofting a cross-section along the length. Six stations and
     an eight-sided section is enough for a silhouette that reads as a car at
     any angle: shoulders, a tapering nose, a boot, wheels that sit in arches
     rather than beside them. Normals are derived from the geometry and turned
     outwards against the part's own centre, so nothing can end up inside-out.
     ====================================================================== */

  // r across the body, t up it: a rounded box, flat on the floor
  const BODY_SECTION = [
    [-1.00, 0.14], [-0.96, 0.58], [-0.74, 0.94], [-0.34, 1.00],
    [0.34, 1.00], [0.74, 0.94], [0.96, 0.58], [1.00, 0.14], [0.80, 0.00], [-0.80, 0.00],
  ];
  const CABIN_SECTION = [
    [-1.00, 0.00], [-0.97, 0.62], [-0.66, 1.00], [0.66, 1.00], [0.97, 0.62], [1.00, 0.00],
  ];

  function loft(F, V, stations, section, opts) {
    const ring = stations.map((st) =>
      section.map(([r, t]) => V(st.f, st.y0 + (st.y1 - st.y0) * t, st.hw * r)));
    // the part's own centre, so outward normals can be resolved without
    // depending on winding order
    let cx = 0, cy = 0, cz = 0, n = 0;
    for (const rg of ring) for (const p of rg) { cx += p.x; cy += p.y; cz += p.z; n++; }
    cx /= n; cy /= n; cz /= n;

    const push = (pts, col, tag) => {
      const ax = pts[1].x - pts[0].x, ay = pts[1].y - pts[0].y, az = pts[1].z - pts[0].z;
      const bx = pts[2].x - pts[0].x, by = pts[2].y - pts[0].y, bz = pts[2].z - pts[0].z;
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      let fx = 0, fy = 0, fz = 0;
      for (const p of pts) { fx += p.x; fy += p.y; fz += p.z; }
      fx = fx / pts.length - cx; fy = fy / pts.length - cy; fz = fz / pts.length - cz;
      if (nx * fx + ny * fy + nz * fz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      F.push({ pts, n: { x: nx, y: ny, z: nz }, col, tag });
    };

    for (let i = 0; i < ring.length - 1; i++) {
      for (let j = 0; j < section.length; j++) {
        const k = (j + 1) % section.length;
        const quad = [ring[i][j], ring[i][k], ring[i + 1][k], ring[i + 1][j]];
        // glass wherever the panel stands up on the side of the greenhouse
        const col = opts.colorFor ? opts.colorFor(quad, i, j) : opts.col;
        push(quad, col, opts.tag);
      }
    }
    if (opts.caps !== false) {
      push(ring[0].slice(), opts.capCol || opts.col, opts.tag + '-rear');
      push(ring[ring.length - 1].slice().reverse(), opts.capCol || opts.col, opts.tag + '-front');
    }
    return ring;
  }

  function ngon(F, V, f, r, sides, radius, width, colSide, colFace, tag) {
    const pts = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 + Math.PI / sides;
      pts.push([Math.cos(a) * radius, Math.sin(a) * radius]);
    }
    const inner = pts.map(([df, dy]) => V(f + df, radius + dy, r - width / 2));
    const outer = pts.map(([df, dy]) => V(f + df, radius + dy, r + width / 2));
    const sign = Math.sign(r) || 1;
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      const nx = pts[i][0] + pts[j][0], ny = pts[i][1] + pts[j][1];
      const l = Math.hypot(nx, ny) || 1;
      const wn = V(nx / l, ny / l, 0), o = V(0, 0, 0);
      F.push({
        pts: [inner[i], inner[j], outer[j], outer[i]],
        n: { x: wn.x - o.x, y: wn.y - o.y, z: wn.z - o.z },
        col: colSide, tag,
      });
    }
    const face = sign > 0 ? outer : inner.slice().reverse();
    const nv = V(0, 0, sign), o2 = V(0, 0, 0);
    F.push({ pts: face, n: { x: nv.x - o2.x, y: nv.y - o2.y, z: nv.z - o2.z }, col: colFace, tag: tag + '-hub' });
  }

  function carFaces(car, simple) {
    const F = [];
    const P = car.paint;
    const body = P.body, roof = P.roof;
    const s = Math.sin(car.heading), c = Math.cos(car.heading);
    const V = (f, u, r) => ({ x: car.x + s * f + c * r, y: u, z: car.z + c * f - s * r });
    const back = -W.CAR.rearOverhang, front = W.CAR.wheelbase + W.CAR.frontOverhang;
    const hw = W.CAR.wid / 2;
    const wagon = car.wagon;
    const beltY = wagon ? 1.10 : 1.04;
    const roofY = wagon ? 1.60 : 1.47;
    const glass = [Math.max(20, roof[0] * 0.34), Math.max(23, roof[1] * 0.38), Math.max(28, roof[2] * 0.44)];
    const dark = [body[0] * 0.42, body[1] * 0.42, body[2] * 0.42];

    if (simple) {
      // distant cars: a shape, not a car
      pushBox(F, car.x + s * (front + back) / 2, (0.26 + beltY) / 2, car.z + c * (front + back) / 2,
        hw * 0.98, (beltY - 0.26) / 2, (front - back) / 2, car.heading, body, body, 'body');
      pushBox(F, car.x + s * ((front + back) / 2 - 0.15), (beltY + roofY) / 2, car.z + c * ((front + back) / 2 - 0.15),
        hw * 0.8, (roofY - beltY) / 2, (front - back) * 0.28, car.heading, roof, glass, 'cabin');
      return F;
    }

    /* --- body ---------------------------------------------------------- */
    const bumper = 0.05;
    loft(F, V, [
      { f: back, hw: hw * 0.90, y0: 0.30, y1: 1.00 },
      { f: back + 0.30, hw: hw * 0.995, y0: 0.245, y1: beltY },
      { f: 0.55, hw: hw, y0: 0.235, y1: beltY + 0.02 },
      { f: W.CAR.wheelbase - 0.15, hw: hw, y0: 0.235, y1: beltY + 0.01 },
      { f: front - 0.34, hw: hw * 0.985, y0: 0.26, y1: beltY - 0.05 },
      { f: front, hw: hw * 0.86, y0: 0.325, y1: 0.95 },
    ], BODY_SECTION, {
      tag: 'body',
      colorFor: (q) => (q[0].y < 0.46 && q[1].y < 0.46 ? dark : body),   // sills and bumpers
      col: body, capCol: body,
    });
    void bumper;

    /* --- greenhouse ---------------------------------------------------- */
    const cabBack = wagon ? back + 0.62 : back + 0.98;
    const cabFront = wagon ? front - 1.02 : front - 1.12;
    loft(F, V, [
      { f: cabBack, hw: hw * 0.86, y0: beltY - 0.03, y1: wagon ? roofY - 0.06 : beltY + 0.30 },
      { f: cabBack + (wagon ? 0.18 : 0.46), hw: hw * 0.90, y0: beltY - 0.03, y1: roofY },
      { f: cabFront - 0.58, hw: hw * 0.90, y0: beltY - 0.03, y1: roofY },
      { f: cabFront, hw: hw * 0.78, y0: beltY - 0.03, y1: beltY + 0.20 },
    ], CABIN_SECTION, {
      tag: 'cabin',
      /* Panels that stand up are windows, panels that lie down are roof. The
         test has to look along the section edge (q0 -> q1), which is the way
         the panel faces; q0 -> q3 only says how long the car is. */
      colorFor: (q) => {
        const dy = Math.abs(q[1].y - q[0].y);
        const dh = Math.hypot(q[1].x - q[0].x, q[1].z - q[0].z);
        return dy > dh * 0.5 ? glass : roof;
      },
      col: glass, capCol: glass,
    });

    /* --- wheels, sitting in the arches --------------------------------- */
    const wr = 0.325, tyre = [26, 26, 28], rim = [92, 95, 99];
    for (const wf of [0.02, W.CAR.wheelbase]) {
      for (const sgn of [-1, 1]) {
        ngon(F, V, wf, sgn * (hw - 0.12), 8, wr, 0.19, tyre, rim, 'wheel');
      }
    }

    /* --- lights and plates --------------------------------------------- */
    const q4 = (fz, y0, y1, r0, r1, col, nf, tag, em) => {
      F.push({
        pts: [V(fz, y0, r0), V(fz, y0, r1), V(fz, y1, r1), V(fz, y1, r0)],
        n: { x: s * nf, y: 0, z: c * nf }, col, tag, emissive: em,
      });
    };
    const rz = back - 0.012, fz = front + 0.012;
    q4(rz, 0.74, 0.87, -hw + 0.16, -hw + 0.46, [146, 36, 30], -1, 'lamp', 0.30);
    q4(rz, 0.74, 0.87, hw - 0.46, hw - 0.16, [146, 36, 30], -1, 'lamp', 0.30);
    q4(rz, 0.50, 0.61, -0.22, 0.22, [196, 198, 192], -1, 'plate', 0.22);
    q4(fz, 0.70, 0.84, -hw + 0.18, -hw + 0.48, [172, 174, 168], 1, 'head', 0.26);
    q4(fz, 0.70, 0.84, hw - 0.48, hw - 0.18, [172, 174, 168], 1, 'head', 0.26);
    return F;
  }

  function pillarFaces(p) {
    const F = [];
    pushBox(F, p.x, 1.43, p.z, p.w / 2, 1.43, p.d / 2, 0, [92, 94, 92], [104, 106, 104], 'pillar');
    // brand-yellow hazard band, which is also just what car parks look like
    pushBox(F, p.x, 1.05, p.z, p.w / 2 + 0.004, 0.16, p.d / 2 + 0.004, 0, PAL.yellowRGB, PAL.yellowRGB, 'band');
    return F;
  }

  function drawSolid(ctx, cam, faces) {
    const out = [];
    for (const f of faces) {
      // back-face cull
      const cx = (f.pts[0].x + f.pts[1].x + f.pts[2].x + f.pts[3].x) / 4;
      const cy = (f.pts[0].y + f.pts[1].y + f.pts[2].y + f.pts[3].y) / 4;
      const cz = (f.pts[0].z + f.pts[1].z + f.pts[2].z + f.pts[3].z) / 4;
      const vx = cam.pos.x - cx, vy = cam.pos.y - cy, vz = cam.pos.z - cz;
      if (f.n.x * vx + f.n.y * vy + f.n.z * vz <= 0) continue;
      out.push({ f, d: Math.hypot(vx, vy, vz) });
    }
    out.sort((a, b) => b.d - a.d);
    for (const o of out) {
      const f = o.f;
      const nl = clamp(f.n.x * LIGHT_DIR.x + f.n.y * LIGHT_DIR.y + f.n.z * LIGHT_DIR.z, 0, 1);
      const k = 0.52 + 0.56 * nl + (f.emissive || 0);
      C.fillPoly(ctx, cam, f.pts, fogged(f.col, o.d, k));
    }
  }

  function contactShadow(ctx, cam, x, z, heading, halfLen, halfWid) {
    const s = Math.sin(heading), c = Math.cos(heading);
    const V = (f, r) => ({ x: x + s * f + c * r, y: 0.006, z: z + c * f - s * r });
    for (let i = 2; i >= 0; i--) {
      const g = 1 + i * 0.22;
      C.fillPoly(ctx, cam, [V(-halfLen * g, -halfWid * g), V(halfLen * g, -halfWid * g), V(halfLen * g, halfWid * g), V(-halfLen * g, halfWid * g)],
        `rgba(14,16,17,${0.30 - i * 0.085})`);
    }
  }

  /* ======================================================================== */
  /*  GUIDE LINES — the calibrated overlay, curving with the wheel            */
  /* ======================================================================== */
  function guidePoint(car, lf, lr, arc) {
    // where a point on the car ends up after reversing `arc` metres
    const s = Math.sin(car.h), c = Math.cos(car.h);
    const P = { x: car.x + s * lf + c * lr, z: car.z + c * lf - s * lr };
    const tan = Math.tan(car.steer);
    const ds = -arc;
    if (Math.abs(tan) < 1e-4) return { x: P.x + s * ds, y: 0.008, z: P.z + c * ds };
    const R = W.CAR.wheelbase / tan;
    const Cx = car.x + R * c, Cz = car.z - R * s;   // centre = pos + R * right
    const dh = (ds * tan) / W.CAR.wheelbase;
    const rx = P.x - Cx, rz = P.z - Cz;
    const cd = Math.cos(dh), sd = Math.sin(dh);
    return { x: Cx + rx * cd + rz * sd, y: 0.008, z: Cz - rx * sd + rz * cd };
  }

  function drawGuides(ctx, cam, st, opts) {
    const car = st.car;
    const half = W.CAR.wid / 2 + 0.06;
    const backF = -W.CAR.rearOverhang - 0.03;
    const SEG = 14, MAXARC = 2.7;
    // the projected path is painted on the floor, so it stops at the wall
    const rail = (lr) => {
      const pts = [];
      for (let i = 0; i <= SEG; i++) {
        const p = guidePoint(car, backF, lr, (i / SEG) * MAXARC);
        if (p.z < 0.02 && pts.length > 1) break;
        pts.push(p);
      }
      return pts;
    };
    const L = rail(-half), R = rail(half);
    const scale = cam.h / 700;
    const lw = Math.max(1.8, 3.6 * scale);

    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // dark keyline so the overlay survives on a pale concrete floor
    for (const r of [L, R]) polyline(ctx, cam, r, 'rgba(0,0,0,0.55)', lw + Math.max(2, 3 * scale));
    // yellow near, green far — colour-coded distance, same as the mockups
    const split = Math.round(SEG * (1.75 / MAXARC));
    for (const r of [L, R]) {
      polyline(ctx, cam, r.slice(0, split + 1), PAL.yellow, lw);
      polyline(ctx, cam, r.slice(split), PAL.green, lw);
    }
    // ticks: a step out of each rail at 1.15 m and 2.0 m
    for (const [arc, col] of [[1.05, PAL.yellow], [1.95, PAL.green]]) {
      const i = arc / MAXARC;
      for (const sgn of [-1, 1]) {
        const a = guidePoint(car, backF, sgn * half, arc * 1);
        const b = guidePoint(car, backF, sgn * (half + 0.30), arc * 1);
        if (a.z < 0.02 || b.z < 0.02) continue;
        polyline(ctx, cam, [a, b], 'rgba(0,0,0,0.5)', lw + 2 * scale);
        polyline(ctx, cam, [a, b], col, lw);
      }
      void i;
    }
    // the red bar: where the bumper will be in half a metre
    const barArc = 0.44;
    const bl = guidePoint(car, backF, -half, barArc), br = guidePoint(car, backF, half, barArc);
    const blu = guidePoint(car, backF, -half, barArc - 0.30), bru = guidePoint(car, backF, half, barArc - 0.30);
    const bar = [blu, bl, br, bru];
    polyline(ctx, cam, bar, 'rgba(0,0,0,0.5)', lw + 2.5 * scale);
    polyline(ctx, cam, bar, PAL.red, lw * 1.1);
  }

  function polyline(ctx, cam, pts, style, width) {
    const view = pts.map((p) => cam.toView(p, {}));
    const clipped = C.clipNear(view, cam.near);
    if (clipped.length < 2) return;
    ctx.beginPath();
    for (let i = 0; i < clipped.length; i++) {
      const s = cam.project(clipped[i], {});
      if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
    }
    ctx.strokeStyle = style; ctx.lineWidth = width; ctx.stroke();
  }

  /* ======================================================================== */
  /*  OWN BUMPER — screen-space, because it is bolted to the camera           */
  /* ======================================================================== */
  function drawBumper(ctx, w, h) {
    const y0 = h * 0.895;
    const g = ctx.createLinearGradient(0, y0, 0, h);
    g.addColorStop(0, 'rgba(96,99,104,1)');
    g.addColorStop(0.18, 'rgba(58,61,66,1)');
    g.addColorStop(1, 'rgba(20,21,24,1)');
    ctx.beginPath();
    ctx.moveTo(-w * 0.1, h + 2);
    ctx.lineTo(-w * 0.1, y0 + h * 0.055);
    ctx.quadraticCurveTo(w * 0.5, y0 - h * 0.052, w * 1.1, y0 + h * 0.055);
    ctx.lineTo(w * 1.1, h + 2);
    ctx.closePath();
    ctx.fillStyle = g; ctx.fill();
    // specular sliver along the top edge
    ctx.beginPath();
    ctx.moveTo(-w * 0.1, y0 + h * 0.055);
    ctx.quadraticCurveTo(w * 0.5, y0 - h * 0.052, w * 1.1, y0 + h * 0.055);
    ctx.strokeStyle = 'rgba(190,196,205,0.35)';
    ctx.lineWidth = Math.max(1.2, h * 0.0035);
    ctx.stroke();
  }

  /* ======================================================================== */
  /*  MASTER                                                                  */
  /* ======================================================================== */
  function placeCamera(cam, st, shake) {
    const car = st.car;
    // the lens lives on the tailgate, above the plate, looking back and down
    const eye = W.local2world(car.x, car.z, car.h, -W.CAR.rearOverhang + 0.02, 0);
    cam.pos.x = eye.x; cam.pos.z = eye.z; cam.pos.y = 0.92;
    cam.yaw = car.h + Math.PI;
    cam.pitch = -0.285;
    cam.roll = 0;
    if (shake) {
      cam.pos.x += shake.x; cam.pos.y += shake.y;
      cam.pitch += shake.p; cam.roll = shake.r;
    }
    cam.update();
  }

  function renderScene(ctx, cam, st, t, opts) {
    opts = opts || {};
    const L = st.level;
    const w = cam.w, h = cam.h;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = rgb(PAL.fog[0], PAL.fog[1], PAL.fog[2]);
    ctx.fillRect(0, 0, w, h);

    drawShell(ctx, cam, L);
    drawWall(ctx, cam, L, null);
    drawPoster(ctx, cam, L, opts);
    drawCeiling(ctx, cam, L, t);
    drawFloor(ctx, cam, L, st, t);

    // solids, far to near
    const solids = [];
    for (const p of L.pillars) solids.push({ d: dist2(cam, p.x, p.z), draw: () => { contactShadow(ctx, cam, p.x, p.z, 0, p.d * 0.6, p.w * 0.6); drawSolid(ctx, cam, pillarFaces(p)); } });
    for (const c of L.cars) {
      const d = dist2(cam, c.x, c.z);
      solids.push({ d, draw: () => {
        contactShadow(ctx, cam, c.x, c.z, c.heading, W.CAR.len * 0.46, W.CAR.wid * 0.52);
        drawSolid(ctx, cam, carFaces(c, d > 11));
      } });
    }
    solids.sort((a, b) => b.d - a.d);
    for (const s of solids) s.draw();

    if (opts.guides !== false && st.phase === 'drive') drawGuides(ctx, cam, st, opts);
    if (opts.bumper !== false) drawBumper(ctx, w, h);
  }

  /* One canvas of wall lettering per level, and the quads it maps onto:
     bay numbers over each bay and the level marker by the exit. */
  const _signCache = {};
  function signAtlas(L) {
    if (_signCache.seed === L.seed) return _signCache.out;
    const g = L.geo;
    const rows = [];
    for (let k = g.bayMin; k <= g.bayMax; k++) rows.push({ text: String(k + 12), size: 0.30, x: W.bayCenterX(k), y: 2.52 });
    rows.push({ text: L.levelSign, size: 0.44, x: W.bayCenterX(L.target.k + 3 * L.exitSide), y: 2.30, col: PAL.lilac });
    const CELL = 128, cols = 8;
    const cv = document.createElement('canvas');
    cv.width = CELL * cols;
    cv.height = CELL * Math.ceil(rows.length / cols);
    const c = cv.getContext('2d');
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const quads = [];
    rows.forEach((r, i) => {
      const cx = (i % cols) * CELL, cy = Math.floor(i / cols) * CELL;
      c.font = `700 ${r.text.length > 2 ? 44 : 62}px 'DM Sans', ui-sans-serif, sans-serif`;
      c.fillStyle = r.col || 'rgba(216,218,210,0.82)';
      c.fillText(r.text, cx + CELL / 2, cy + CELL / 2);
      const w = r.size * (c.measureText(r.text).width / 62) * 1.6;
      const h = r.size;
      const u0 = cx / cv.width, u1 = (cx + CELL) / cv.width;
      const v0 = cy / cv.height, v1 = (cy + CELL) / cv.height;
      quads.push({
        pts: [
          { x: r.x + w / 2, y: r.y + h / 2, z: 0.01 }, { x: r.x - w / 2, y: r.y + h / 2, z: 0.01 },
          { x: r.x - w / 2, y: r.y - h / 2, z: 0.01 }, { x: r.x + w / 2, y: r.y - h / 2, z: 0.01 },
        ],
        uv: [u0, v0, u1, v0, u1, v1, u0, v1],
      });
    });
    _signCache.seed = L.seed;
    _signCache.out = { canvas: cv, quads };
    return _signCache.out;
  }

  NS.draw = {
    PAL, loadAds, renderScene, placeCamera, drawGuides, drawPoster,
    guidePoint, fogged, ads, carFaces, signAtlas,
  };
})(window.PM = window.PM || {});
