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
        res({ id: d.id, shape: d.shape, img, mips, shadow: silhouette(mips[2] || img),
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
    drawWallText(ctx, cam, L.levelSign, sx, 2.28, 0.46, PAL.lilac, 0.5);
    drawWallText(ctx, cam, 'SALIDA', sx, 1.86, 0.2, 'rgba(200,205,200,0.55)', 0.4);
  }

  const _txtCv = document.createElement('canvas');
  const _txtCtx = _txtCv.getContext('2d');
  function drawWallText(ctx, cam, text, cx, cy, h, color, alpha) {
    const pad = 8, fs = 64;
    _txtCtx.font = `700 ${fs}px 'DM Sans', ui-sans-serif, system-ui, sans-serif`;
    const wpx = Math.ceil(_txtCtx.measureText(text).width) + pad * 2;
    _txtCv.width = wpx; _txtCv.height = fs + pad * 2;
    _txtCtx.clearRect(0, 0, _txtCv.width, _txtCv.height);
    _txtCtx.font = `700 ${fs}px 'DM Sans', ui-sans-serif, system-ui, sans-serif`;
    _txtCtx.fillStyle = color;
    _txtCtx.textBaseline = 'middle';
    _txtCtx.letterSpacing = '2px';
    _txtCtx.fillText(text, pad, _txtCv.height / 2);
    const ar = _txtCv.width / _txtCv.height;
    const w = h * ar;
    const d = dist2(cam, cx, 0);
    const a = alpha * (1 - fogAmt(d));
    if (a < 0.02) return;
    C.drawTexturedQuad(ctx, _txtCv, cam, [
      { x: cx + w / 2, y: cy - h / 2, z: 0.004 }, { x: cx - w / 2, y: cy - h / 2, z: 0.004 },
      { x: cx - w / 2, y: cy + h / 2, z: 0.004 }, { x: cx + w / 2, y: cy + h / 2, z: 0.004 },
    ], { subdiv: 3, alpha: a });
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
        C.fillPoly(ctx, cam, [
          { x, y: g.ceilY - 0.02, z: ln.z - 0.09 }, { x: x + 1.5, y: g.ceilY - 0.02, z: ln.z - 0.09 },
          { x: x + 1.5, y: g.ceilY - 0.02, z: ln.z + 0.09 }, { x, y: g.ceilY - 0.02, z: ln.z + 0.09 },
        ], rgb(238 * k + 8, 244 * k + 8, 232 * k + 8));
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
          C.fillPoly(ctx, cam, pts, `rgba(190,200,190,${alpha})`);
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
    paintStripe(ctx, cam, g.xMin, g.laneZ0, g.xMax, g.laneZ0, 0.11, `rgba(214,214,206,${0.42})`, true);

    /* --- the target bay: chevrons pointing home ------------------------- */
    const tgt = L.target;
    const live = st && st.phase === 'drive';
    const ok = st && st.inBox && st.aligned;
    const col = ok ? PAL.greenRGB : PAL.yellowRGB;
    const pulse = live ? 0.55 + 0.45 * Math.sin(t * 3.4) : 0.85;
    // outline
    const oa = (ok ? 0.85 : 0.42) * (live ? 1 : 0.7);
    paintStripe(ctx, cam, tgt.cx - tgt.halfW, g.kerbZ + 0.05, tgt.cx - tgt.halfW, g.laneZ0, 0.105, rgbaArr(col, oa));
    paintStripe(ctx, cam, tgt.cx + tgt.halfW, g.kerbZ + 0.05, tgt.cx + tgt.halfW, g.laneZ0, 0.105, rgbaArr(col, oa));
    paintStripe(ctx, cam, tgt.cx - tgt.halfW, g.kerbZ + 0.06, tgt.cx + tgt.halfW, g.kerbZ + 0.06, 0.105, rgbaArr(col, oa));
    // chevrons flowing towards the wall — an invitation, not a floodlight,
    // and they bow out once the car is close enough to see for itself
    const near = st ? clamp((st.wallGap - 0.7) / 1.6, 0, 1) : 1;
    for (let i = 0; i < 3; i++) {
      const base = 1.45 + i * 1.0;
      const phase = live ? ((t * 0.9 + i * 0.33) % 1) : 0.5;
      const a = (0.22 + 0.45 * (1 - Math.abs(phase * 2 - 1))) * pulse * near;
      if (a < 0.02) continue;
      chevron(ctx, cam, tgt.cx, base, 0.70, 0.36, rgbaArr(col, a));
    }
  }
  function rgbaArr(c, a) { return `rgba(${c[0]},${c[1]},${c[2]},${clamp(a, 0, 1)})`; }

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

  function carFaces(car) {
    const F = [];
    const P = car.paint;
    const body = P.body, roof = P.roof;
    const s = Math.sin(car.heading), c = Math.cos(car.heading);
    const V = (f, u, r) => ({ x: car.x + s * f + c * r, y: u, z: car.z + c * f - s * r });
    const back = -W.CAR.rearOverhang, front = W.CAR.wheelbase + W.CAR.frontOverhang;
    const hw = W.CAR.wid / 2;
    const sillY = 0.34, beltY = car.wagon ? 1.06 : 1.0, roofY = car.wagon ? 1.56 : 1.44;

    // lower body
    pushBox(F, car.x, (sillY + beltY) / 2, car.z, hw, (beltY - sillY) / 2,
      (front - back) / 2, car.heading, body, body, 'body');
    // shift the box to sit between back..front
    const off = (front + back) / 2;
    for (const f of F) for (const p of f.pts) { p.x += s * off; p.z += c * off; }

    // greenhouse — a tapered box, drawn as explicit quads so it can rake
    const cabBack = car.wagon ? back + 0.55 : back + 0.85;
    const cabFront = car.wagon ? front - 0.95 : front - 1.05;
    const topBack = cabBack + (car.wagon ? 0.10 : 0.30), topFront = cabFront - 0.42;
    const gw = hw - 0.10, gwt = hw - 0.24;
    const glass = [Math.max(18, roof[0] * 0.42), Math.max(20, roof[1] * 0.46), Math.max(24, roof[2] * 0.5)];
    const q = (a, b, cc, d, col, n, tag) => F.push({ pts: [a, b, cc, d], n, col, tag });
    const bl = V(cabBack, beltY, -gw), br = V(cabBack, beltY, gw);
    const fl = V(cabFront, beltY, -gw), fr = V(cabFront, beltY, gw);
    const tbl = V(topBack, roofY, -gwt), tbr = V(topBack, roofY, gwt);
    const tfl = V(topFront, roofY, -gwt), tfr = V(topFront, roofY, gwt);
    q(tbl, tbr, tfr, tfl, roof, { x: 0, y: 1, z: 0 }, 'roof');
    q(bl, br, tbr, tbl, glass, { x: -s, y: 0.25, z: -c }, 'rearglass');   // rear screen
    q(fr, fl, tfl, tfr, glass, { x: s, y: 0.25, z: c }, 'windscreen');
    q(br, fr, tfr, tbr, glass, { x: c, y: 0.1, z: -s }, 'sideglass');
    q(fl, bl, tbl, tfl, glass, { x: -c, y: 0.1, z: s }, 'sideglass');

    // wheels
    const wr = 0.30;
    for (const [wf, wrgt] of [[0, -hw + 0.03], [0, hw - 0.03], [W.CAR.wheelbase, -hw + 0.03], [W.CAR.wheelbase, hw - 0.03]]) {
      pushBoxAt(F, V(wf, wr, wrgt), 0.09, wr, wr, car.heading, [26, 26, 28], [18, 18, 20], 'wheel');
    }

    // rear lights + plate, facing away from the nose
    const lampY = 0.86;
    const rearZ = back - 0.005;
    const lamp = (rr) => {
      const a = V(rearZ, lampY - 0.13, rr - 0.20), b = V(rearZ, lampY - 0.13, rr + 0.20);
      const cc = V(rearZ, lampY + 0.13, rr + 0.20), d = V(rearZ, lampY + 0.13, rr - 0.20);
      F.push({ pts: [a, b, cc, d], n: { x: -s, y: 0, z: -c }, col: [128, 30, 26], tag: 'lamp', emissive: 0.35 });
    };
    lamp(-hw + 0.34); lamp(hw - 0.34);
    const pa = V(rearZ, 0.62, -0.24), pb = V(rearZ, 0.62, 0.24), pc = V(rearZ, 0.76, 0.24), pd = V(rearZ, 0.76, -0.24);
    F.push({ pts: [pa, pb, pc, pd], n: { x: -s, y: 0, z: -c }, col: [188, 190, 184], tag: 'plate', emissive: 0.2 });
    // headlights at the nose
    const hl = (rr) => {
      const y0 = 0.72, y1 = 0.92, fz = front + 0.005;
      const a = V(fz, y0, rr - 0.22), b = V(fz, y0, rr + 0.22), cc = V(fz, y1, rr + 0.22), d = V(fz, y1, rr - 0.22);
      F.push({ pts: [a, b, cc, d], n: { x: s, y: 0, z: c }, col: [150, 152, 150], tag: 'head', emissive: 0.28 });
    };
    hl(-hw + 0.36); hl(hw - 0.36);
    return F;
  }
  function pushBoxAt(F, ctr, hx, hy, hz, heading, colTop, colSide, tag) {
    pushBox(F, ctr.x, ctr.y, ctr.z, hx, hy, hz, heading, colTop, colSide, tag);
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
    for (const c of L.cars) solids.push({ d: dist2(cam, c.x, c.z), draw: () => { contactShadow(ctx, cam, c.x, c.z, c.heading, W.CAR.len * 0.46, W.CAR.wid * 0.52); drawSolid(ctx, cam, carFaces(c)); } });
    solids.sort((a, b) => b.d - a.d);
    for (const s of solids) s.draw();

    if (opts.guides !== false && st.phase === 'drive') drawGuides(ctx, cam, st, opts);
    if (opts.bumper !== false) drawBumper(ctx, w, h);
  }

  NS.draw = {
    PAL, loadAds, renderScene, placeCamera, drawGuides, drawPoster,
    guidePoint, fogged, ads,
  };
})(window.PM = window.PM || {});
