/* ============================================================================
   BACK IN SMOOTHLY — export studio   (#studio)
   A floating phone, turning slowly, playing a demo round that has never been
   played before. Same simulation, same renderer, same lens — driven by the
   autopilot instead of a thumb, and recorded out as video or GIF.
   ========================================================================== */
(function (NS) {
  'use strict';
  const C = NS.core;
  const { clamp, lerp, damp, smoothstep, rgb } = C;
  const D = NS.draw, S = NS.sim, W = NS.world;

  const SCREEN_W = 540, SCREEN_H = 1170;      // the phone's panel, in pixels
  const FORMATS = {
    '9:16': [1080, 1920], '4:5': [1080, 1350], '1:1': [1080, 1080], '16:9': [1920, 1080],
  };
  const BACKDROPS = {
    none: { name: 'None', transparent: true, ink: '#F4F3EF' },
    garage: { name: 'Garage', a: '#2b2e31', b: '#0b0c0d', glow: 'rgba(159,141,199,0.22)', ink: '#F4F3EF' },
    yellow: { name: 'Yellow', a: '#FFEA00', b: '#F2C400', glow: 'rgba(255,255,255,0.35)', ink: '#0A0B0B' },
    lilac: { name: 'Lilac', a: '#B9A9DA', b: '#8E79B8', glow: 'rgba(255,255,255,0.3)', ink: '#0A0B0B' },
    black: { name: 'Black', a: '#131415', b: '#000', glow: 'rgba(255,234,0,0.14)', ink: '#F4F3EF' },
  };

  /* ---- the layout of the phone's own screen ------------------------------ */
  function layout(w, h) {
    const u = Math.min(h / 880, w / 430);
    const pad = 12 * u;
    let fw = w - pad * 2;
    const avail = h - 286 * u;
    let fh = clamp(avail, fw * 0.70, fw * 1.15);
    if (avail < fw * 0.70) { fh = Math.max(avail, 110 * u); fw = Math.min(fw, fh / 0.70); }
    const fy = pad + (34 + 8 + 3 + 8) * u;
    return { u, pad, feed: { x: (w - fw) / 2, y: fy, w: fw, h: fh }, radius: 10 * u };
  }

  /* ======================================================================== */
  /*  THE PHONE'S SCREEN, PAINTED                                             */
  /*  The live unit builds this out of DOM for crispness and screen readers;  */
  /*  a recording needs pixels, so the same cluster is drawn here.            */
  /* ======================================================================== */
  function drawScreen(ctx, w, h, st, t, feedCv, L) {
    const u = L.u, F = L.feed;
    const font = (s, wt) => `${wt || 500} ${(s * u).toFixed(1)}px 'DM Sans', system-ui, sans-serif`;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#191b1d'); g.addColorStop(0.22, '#101112');
    g.addColorStop(0.6, '#0c0d0e'); g.addColorStop(1, '#131416');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

    ctx.textBaseline = 'middle';
    /* --- gear selector + unit name ------------------------------------- */
    const topY = L.pad + 17 * u;
    ctx.textAlign = 'left';
    let x = L.pad;
    ['P', 'R', 'N', 'D'].forEach((ch) => {
      const on = ch === 'R';
      ctx.font = font(on ? 16 : 13, 700);
      ctx.fillStyle = on ? D.PAL.yellow : 'rgba(244,243,239,0.28)';
      if (on) { ctx.shadowColor = 'rgba(255,234,0,0.5)'; ctx.shadowBlur = 10 * u; }
      ctx.fillText(ch, x, topY);
      ctx.shadowBlur = 0;
      x += ctx.measureText(ch).width + 7 * u;
    });
    ctx.font = font(9.5, 600);
    ctx.fillStyle = 'rgba(244,243,239,0.42)';
    ctx.letterSpacing = (1.8 * u).toFixed(2) + 'px';
    ctx.fillText('REAR VIEW ASSIST', x + 6 * u, topY);
    ctx.letterSpacing = '0px';
    for (let i = 0; i < 2; i++) {
      const cx = w - L.pad - 17 * u - i * 41 * u;
      ctx.beginPath(); ctx.arc(cx, topY, 17 * u, 0, 6.2832);
      ctx.fillStyle = 'rgba(255,255,255,0.035)'; ctx.fill();
      ctx.strokeStyle = 'rgba(244,243,239,0.13)'; ctx.lineWidth = 1 * u; ctx.stroke();
      ctx.fillStyle = 'rgba(244,243,239,0.55)';
      ctx.font = font(11, 700); ctx.textAlign = 'center';
      ctx.fillText(i ? '♪' : '?', cx, topY + 0.5 * u);
      ctx.textAlign = 'left';
    }

    /* --- timer ---------------------------------------------------------- */
    const ty = L.pad + 40 * u, tw = w - L.pad * 2, th = 3 * u;
    const frac = clamp(st.timeLeft / S.TUNE.timeLimit, 0, 1);
    NS.roundRect(ctx, L.pad, ty, tw, th, th / 2);
    ctx.fillStyle = 'rgba(244,243,239,0.1)'; ctx.fill();
    NS.roundRect(ctx, L.pad, ty, Math.max(th, tw * frac), th, th / 2);
    ctx.fillStyle = st.timeLeft < 5.5 ? D.PAL.red : D.PAL.yellow; ctx.fill();

    /* --- the feed ------------------------------------------------------- */
    if (feedCv) ctx.drawImage(feedCv, F.x, F.y, F.w, F.h);

    /* --- status --------------------------------------------------------- */
    const sy = F.y + F.h + 22 * u;
    ctx.textAlign = 'center';
    ctx.font = font(14, 700);
    ctx.letterSpacing = (1.9 * u).toFixed(2) + 'px';
    ctx.fillStyle = st.statusTone === 'ok' ? D.PAL.green : st.statusTone === 'urgent' ? D.PAL.red : D.PAL.yellow;
    ctx.fillText((st.statusText || '').toUpperCase(), w / 2, sy);
    ctx.letterSpacing = '0px';

    /* --- proximity ------------------------------------------------------ */
    const py = sy + 26 * u;
    const pw = 116 * u, ph = 74 * u;
    const px0 = w / 2 - 74 * u;
    ctx.save();
    ctx.translate(px0, py);
    ctx.scale(pw / 132, ph / 84);
    NS.roundRect(ctx, 39, 4, 54, 36, 7);
    ctx.fillStyle = '#22252a'; ctx.fill();
    ctx.strokeStyle = 'rgba(159,141,199,0.45)'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = 'rgba(159,141,199,0.16)'; ctx.fillRect(45, 9, 42, 11);
    ctx.fillStyle = 'rgba(255,46,18,0.55)'; NS.roundRect(ctx, 52, 34, 28, 4, 2); ctx.fill();
    const TH = [0.5, 1.0, 1.7, 2.6];
    const COL = [D.PAL.red, D.PAL.yellow, D.PAL.yellow, D.PAL.green];
    for (let i = 0; i < 4; i++) {
      const r = 22 + i * 9.4;
      ctx.beginPath();
      ctx.arc(66, 40, r, 0.30, Math.PI - 0.30);
      ctx.strokeStyle = (st.playing && st.proximity < TH[i]) ? COL[i] : 'rgba(244,243,239,0.11)';
      ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.stroke();
    }
    ctx.restore();
    ctx.textAlign = 'left';
    const dx = w / 2 + 14 * u;
    ctx.font = font(30, 700);
    ctx.fillStyle = st.proximity < 0.5 ? D.PAL.red : '#F4F3EF';
    const dtxt = !st.playing || st.proximity > 2.6 ? '—' : st.proximity.toFixed(1) + ' m';
    ctx.fillText(dtxt, dx, py + 30 * u);
    ctx.font = font(9, 600);
    ctx.letterSpacing = (1.5 * u).toFixed(2) + 'px';
    ctx.fillStyle = 'rgba(244,243,239,0.4)';
    ctx.fillText('TO CONTACT', dx, py + 52 * u);
    ctx.letterSpacing = '0px';

    /* --- brake ---------------------------------------------------------- */
    const by = h - L.pad - 62 * u, br = 48 * u;
    const bg = ctx.createRadialGradient(w / 2, by - br * 0.16, 2, w / 2, by, br);
    const on = st.brake > 0.35;
    bg.addColorStop(0, on ? 'rgba(255,46,18,0.9)' : 'rgba(255,46,18,0.24)');
    bg.addColorStop(0.62, on ? 'rgba(255,46,18,0.35)' : 'rgba(255,46,18,0.06)');
    bg.addColorStop(1, 'rgba(0,0,0,0.4)');
    ctx.beginPath(); ctx.arc(w / 2, by, br * (on ? 0.945 : 1), 0, 6.2832);
    ctx.fillStyle = bg; ctx.fill();
    ctx.strokeStyle = 'rgba(255,46,18,0.5)'; ctx.lineWidth = 2 * u; ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.8 * u; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(w / 2, by - 9 * u, 12 * u, 0, 6.2832); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(w / 2 - 8.5 * u, by - 17.5 * u); ctx.lineTo(w / 2 + 8.5 * u, by - 0.5 * u);
    ctx.moveTo(w / 2 + 8.5 * u, by - 17.5 * u); ctx.lineTo(w / 2 - 8.5 * u, by - 0.5 * u);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.font = font(10, 700);
    ctx.letterSpacing = (1.5 * u).toFixed(2) + 'px';
    ctx.fillStyle = '#fff';
    ctx.fillText('BRAKE', w / 2, by + 18 * u);

    ctx.textAlign = 'left';
  }

  /* ======================================================================== */
  /*  THE PHONE, IN THREE DIMENSIONS                                          */
  /* ======================================================================== */
  const PH = { w: 0.78, h: 1.60, d: 0.078, r: 0.10, bezel: 0.035 };

  function roundedOutline(w, h, r, seg) {
    const pts = [];
    const hw = w / 2 - r, hh = h / 2 - r;
    const corners = [[hw, hh, 0], [-hw, hh, Math.PI / 2], [-hw, -hh, Math.PI], [hw, -hh, -Math.PI / 2]];
    for (const [cx, cy, a0] of corners) {
      for (let i = 0; i <= seg; i++) {
        const a = a0 + (i / seg) * (Math.PI / 2);
        pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
      }
    }
    return pts;
  }

  function rotate(p, yaw, pitch, roll) {
    let { x, y, z } = p;
    let c = Math.cos(roll), s = Math.sin(roll);
    let nx = x * c - y * s, ny = x * s + y * c; x = nx; y = ny;
    c = Math.cos(pitch); s = Math.sin(pitch);
    let nz = y * s + z * c; ny = y * c - z * s; y = ny; z = nz;
    c = Math.cos(yaw); s = Math.sin(yaw);
    nx = x * c + z * s; nz = -x * s + z * c; x = nx; z = nz;
    return { x, y, z };
  }

  function drawPhone(ctx, cam, screenCv, pose) {
    const { yaw, pitch, roll, ox, oy } = pose;
    const out = roundedOutline(PH.w, PH.h, PH.r, 6);
    const hd = PH.d / 2;
    const M = (x, y, z) => {
      const p = rotate({ x, y, z }, yaw, pitch, roll);
      return { x: p.x + ox, y: p.y + oy, z: p.z };
    };
    const front = out.map((p) => M(p.x, p.y, -hd));
    const back = out.map((p) => M(p.x, p.y, hd));

    // which way is the phone facing?
    const n = rotate({ x: 0, y: 0, z: -1 }, yaw, pitch, roll);
    const toCam = { x: cam.pos.x - ox, y: cam.pos.y - oy, z: cam.pos.z };
    const facing = n.x * toCam.x + n.y * toCam.y + n.z * toCam.z > 0;

    if (!facing) C.fillPoly(ctx, cam, back, '#141618');

    /* the aluminium rim, one quad per outline segment, lit from top-left */
    const rimFaces = [];
    for (let i = 0; i < out.length; i++) {
      const j = (i + 1) % out.length;
      const mid = { x: (out[i].x + out[j].x) / 2, y: (out[i].y + out[j].y) / 2 };
      const len = Math.hypot(mid.x, mid.y) || 1;
      const nl = rotate({ x: mid.x / len, y: mid.y / len, z: 0 }, yaw, pitch, roll);
      const cen = M((out[i].x + out[j].x) / 2, (out[i].y + out[j].y) / 2, 0);
      const vx = cam.pos.x - cen.x, vy = cam.pos.y - cen.y, vz = cam.pos.z - cen.z;
      if (nl.x * vx + nl.y * vy + nl.z * vz <= 0) continue;
      const key = clamp(-nl.x * 0.45 + nl.y * 0.80 + 0.30, 0, 1);
      const lit = 0.26 + 0.52 * key;
      const spec = Math.pow(key, 9) * 0.35;
      rimFaces.push({
        pts: [front[i], front[j], back[j], back[i]],
        col: rgb(52 + 120 * lit + 190 * spec, 54 + 122 * lit + 190 * spec, 60 + 126 * lit + 190 * spec),
        d: Math.hypot(vx, vy, vz),
      });
    }
    rimFaces.sort((a, b) => b.d - a.d);
    for (const f of rimFaces) C.fillPoly(ctx, cam, f.pts, f.col);

    if (facing) {
      C.fillPoly(ctx, cam, front, '#0b0c0d');            // bezel
      const sw = PH.w - PH.bezel * 2, sh = PH.h - PH.bezel * 2;
      const z = -hd - 0.001;
      C.drawTexturedQuad(ctx, screenCv, cam, [
        M(-sw / 2, sh / 2, z), M(sw / 2, sh / 2, z),
        M(sw / 2, -sh / 2, z), M(-sw / 2, -sh / 2, z),
      ], { subdiv: 5 });
      // a sheet of glass over the top
      const gl = C.polyToScreen(cam, front, false);
      if (gl) {
        ctx.save();
        C.tracePath(ctx, gl); ctx.clip();
        const a = C.polyToScreen(cam, [M(-PH.w, PH.h * 0.9, z), M(PH.w * 0.2, PH.h, z)], false);
        if (a) {
          const grd = ctx.createLinearGradient(a[0].x, a[0].y, a[1].x, a[1].y + 400);
          grd.addColorStop(0, 'rgba(255,255,255,0.11)');
          grd.addColorStop(0.35, 'rgba(255,255,255,0.03)');
          grd.addColorStop(0.55, 'rgba(255,255,255,0)');
          ctx.fillStyle = grd;
          ctx.fill();
        }
        ctx.restore();
      }
    }
  }

  /* ======================================================================== */
  /*  THE STUDIO                                                              */
  /* ======================================================================== */
  class Studio {
    constructor(root) {
      this.root = root;
      this.format = '9:16';
      this.long = 1080;
      this.backdrop = 'none';
      this.allAds = true;
      this.caption = true;
      this.time = 0;
      this.usedSeeds = new Set(JSON.parse(localStorage.getItem('pm_bis_demoSeeds') || '[]'));
      this.busy = false;

      this.screen = document.createElement('canvas');
      this.screen.width = SCREEN_W; this.screen.height = SCREEN_H;
      this.sctx = this.screen.getContext('2d');
      this.L = layout(SCREEN_W, SCREEN_H);

      const fw = Math.round(this.L.feed.w), fh = Math.round(this.L.feed.h);
      this.feedCv = document.createElement('canvas');
      this.feedCv.width = fw; this.feedCv.height = fh;
      this.r3d = new NS.gl.Renderer(this.feedCv);
      if (this.r3d.ok) this.r3d.loadModels();
      else {
        this.r3d = null;
        this.sceneCv = document.createElement('canvas');
        this.sceneCv.width = fw; this.sceneCv.height = fh;
        this.scctx = this.sceneCv.getContext('2d', { alpha: false });
        this.post = NS.post.makePost(this.feedCv);
      }
      this.cam = new C.Camera();
      this.cam.fov = 1.85;
      this.cam.setViewport(fw, fh);

      this.out = document.createElement('canvas');
      this.octx = this.out.getContext('2d');
      this.view = new C.Camera();
      this.view.fov = 0.62;

      this._buildUI();
      this.setFormat('9:16');
      this.newDemo();
      this._loop();
    }

    /* ---- demo selection: vetted offline, never the same twice ---------- */
    /* wantAd: pick a car park whose wall is wearing that execution */
    newDemo(wantAd) {
      let seed = 0, tries = 0, res = null;
      const bad = (r) => !r || !r.ok || r.time < 4.2 || r.time > 12 ||
        (wantAd !== undefined && wantAd !== null && r.level.poster.index !== wantAd);
      do {
        seed = (Math.random() * 0xffffffff) >>> 0;
        if (this.usedSeeds.has(seed)) continue;
        res = S.simulateOffline(seed, 0.35, 1 / 60, false);
        tries++;
      } while (bad(res) && tries < 700);
      this.usedSeeds.add(seed);
      if (this.usedSeeds.size > 400) this.usedSeeds = new Set([...this.usedSeeds].slice(-200));
      try { localStorage.setItem('pm_bis_demoSeeds', JSON.stringify([...this.usedSeeds])); } catch (e) { /* */ }
      this.seed = seed;
      this.adIndex = res ? res.level.poster.index : 0;
      this.runTime = res ? res.time : 8;
      this.resetRun();
      if (this.el.seed) this.el.seed.textContent = '#' + seed.toString(16).padStart(8, '0');
      if (this.el.len) this.el.len.textContent = (this.runTime + 2.6).toFixed(1) + 's';
    }
    resetRun() {
      this.level = W.buildLevel(this.seed, 0.35);
      if (this.r3d) this.r3d.setLevel(this.level);
      this.state = S.create(this.level);
      this.driver = S.makeDriver(this.seed);
      S.measure(this.state);
      this.brake = 0;
      this.steer = 0;
      this.runT = 0;
      this.revealT = 0;
      this.camPose = null;      // the reveal must start from this run's camera
      this.phase = 'play';
      this.shake = { x: 0, y: 0, p: 0, r: 0, mag: 0 };
      this.flash = [0, 0, 0, 0];
    }

    /* ---- one simulation + render step --------------------------------- */
    stepSim(dt) {
      const st = this.state;
      this.runT += dt;
      if (this.phase === 'play') {
        const inp = S.drive(st, this.driver, dt);
        this.steer = damp(this.steer, inp.steer, 12, dt);
        this.brake = damp(this.brake, inp.brake, 18, dt);
        S.step(st, dt, inp);
        if (st.phase !== 'drive') {
          this.phase = 'reveal';
          this.revealT = 0;
          this.flash = st.phase === 'won' ? [0.72, 1.0, 0.58, 0.20] : [1, 0.20, 0.10, 0.42];
          if (st.phase !== 'won') this.shake.mag = 1;
        }
      } else if (this.phase === 'reveal') {
        this.revealT += dt;
        if (this.revealT > 3.4) { this.phase = 'done'; }
      } else {
        this.revealT += dt;
      }
      this.flash[3] = Math.max(0, this.flash[3] - dt * 1.9);
      if (this.shake.mag > 0) {
        this.shake.mag = Math.max(0, this.shake.mag - dt * 2.2);
        const m = this.shake.mag * this.shake.mag * 0.05;
        this.shake.x = (Math.random() - 0.5) * m; this.shake.y = (Math.random() - 0.5) * m;
        this.shake.p = (Math.random() - 0.5) * m * 0.6; this.shake.r = (Math.random() - 0.5) * m * 0.9;
      }
    }

    statusOf() {
      const st = this.state;
      if (this.phase !== 'play') return ['', ''];
      if (!st.inBox && Math.abs(st.lateralErr) > 0.85) return [st.lateralErr > 0 ? 'Bay is right' : 'Bay is left', ''];
      if (!st.inBox) return ['Line it up', ''];
      if (Math.abs(st.headingErr) > 0.13) return ['Straighten up', ''];
      if (st.wallGap > 0.95) return ['Keep coming', 'ok'];
      return ['Brake now', 'urgent'];
    }

    renderScreen(t) {
      const st = this.state, cam = this.cam;
      const reveal = this.phase !== 'play';
      // the camera stays on the car: a good park puts the poster in frame by itself
      D.placeCamera(cam, st, this.shake);
      if (reveal) {
        cam.pitch += 0.045 * smoothstep(clamp((this.revealT - 0.15) / 1.0, 0, 1));
        cam.update();
      }
      const sceneOpts = { guides: !reveal, bumper: !reveal, subdiv: reveal ? 9 : 6 };
      if (this.r3d) this.r3d.renderScene(cam, st, t, sceneOpts);
      else D.renderScene(this.scctx, cam, st, t, sceneOpts);

      const LK = NS.post.LOOK;
      const ease = reveal ? smoothstep(clamp((this.revealT - 0.3) / 1.1, 0, 1)) : 0;
      const params = {
        rect: { x0: 0, y0: 0, x1: 1, y1: 1 },
        radius: this.L.radius,
        time: t,
        k1: LK.k1 * (1 - ease * 0.55), k2: LK.k2 * (1 - ease * 0.55),
        chroma: LK.chroma * (1 - ease * 0.8),
        scan: LK.scan * (1 - ease * 0.62),
        grain: LK.grain * (1 - ease * 0.55),
        vignette: LK.vignette * (1 - ease * 0.45),
        bloom: LK.bloom * (1 - ease * 0.85),
        gain: lerp(LK.gain, 1, ease),
        sat: lerp(LK.sat, 0.99, ease),
        lines: Math.round(this.feedCv.height / 3),
        reduce: false,
        flash: this.flash,
      };
      if (this.r3d) this.r3d.present(params);
      else this.post.render(this.sceneCv, params);

      const [text, tone] = this.statusOf();
      drawScreen(this.sctx, SCREEN_W, SCREEN_H, {
        timeLeft: st.timeLeft, proximity: st.proximity, brake: this.brake,
        playing: this.phase === 'play', statusText: text, statusTone: tone,
      }, t, this.feedCv, this.L);
    }

    /* ---- the composed frame ------------------------------------------- */
    renderFrame(t) {
      const ctx = this.octx, w = this.out.width, h = this.out.height;
      const bd = BACKDROPS[this.backdrop];
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!bd.transparent) {
        const g = ctx.createRadialGradient(w * 0.5, h * 0.34, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.78);
        g.addColorStop(0, bd.a); g.addColorStop(1, bd.b);
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        const gg = ctx.createRadialGradient(w * 0.5, h * 0.46, 0, w * 0.5, h * 0.46, Math.min(w, h) * 0.52);
        gg.addColorStop(0, bd.glow); gg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gg; ctx.fillRect(0, 0, w, h);
      }

      // the phone floats and turns; the roll follows the demo's own steering
      const pt = t + (this.poseOffset || 0);
      const bob = Math.sin(pt * 0.62) * 0.035;
      const pose = {
        yaw: Math.sin(pt * 0.44) * 0.30,
        pitch: -0.055 + Math.sin(pt * 0.33 + 1.1) * 0.055,
        roll: -this.steer * 0.30 + Math.sin(pt * 0.29) * 0.02,
        ox: 0, oy: bob,
      };

      /* Frame the phone rather than guess at it: pick the distance that makes
         it fill the intended slice of the frame, whatever the format is. */
      this.view.fov = 0.60;
      this.view.setViewport(w, h);
      const fx = (w * 0.5) / Math.tan(this.view.fov * 0.5);
      const fill = this.caption ? 0.70 : 0.82;
      const dH = (fx * PH.h * 1.06) / (fill * h);
      const dW = (fx * PH.w * 1.06) / (0.64 * w);
      const dist = Math.max(dH, dW);
      const capShift = this.caption ? h * 0.075 : 0;
      this.view.pos = { x: 0, y: (capShift / fx) * dist, z: -dist };
      this.view.yaw = 0; this.view.pitch = 0; this.view.roll = 0;
      this.view.update();
      this.phoneScreenH = (fx * PH.h) / dist;

      // the pool of shade it floats over
      const ph = this.phoneScreenH || h * 0.6;
      if (!bd.transparent) {
      const sy = h / 2 - capShift + ph * 0.62 + bob * ph * 0.4;
      const sr = ph * 0.42;
      ctx.save();
      ctx.translate(w / 2, sy); ctx.scale(1, 0.22);
      const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, sr);
      sg.addColorStop(0, 'rgba(0,0,0,0.5)'); sg.addColorStop(0.6, 'rgba(0,0,0,0.18)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sg;
      ctx.beginPath(); ctx.arc(0, 0, sr, 0, 6.2832); ctx.fill();
      ctx.restore();
      }

      drawPhone(ctx, this.view, this.screen, pose);

      if (this.caption) {
        const bd2 = BACKDROPS[this.backdrop];
        ctx.textAlign = 'center';
        ctx.fillStyle = bd2.ink;
        const fs = Math.min(w, h) * 0.062;
        ctx.font = `700 ${fs}px 'DM Sans', system-ui, sans-serif`;
        ctx.letterSpacing = (-fs * 0.03).toFixed(2) + 'px';
        ctx.fillText('Back in smoothly.', w / 2, h - fs * 1.5);
        ctx.letterSpacing = '0px';
        ctx.font = `500 ${fs * 0.34}px 'DM Sans', system-ui, sans-serif`;
        ctx.globalAlpha = 0.62;
        ctx.fillText('Easier with our relaxant lubricant · PlatanoMelón', w / 2, h - fs * 0.72);
        ctx.globalAlpha = 1;
      }
    }

    /* ---- live preview -------------------------------------------------- */
    _loop() {
      let last = performance.now();
      const frame = (now) => {
        this._raf = requestAnimationFrame(frame);
        if (this.busy) { last = now; return; }
        const dt = clamp((now - last) / 1000, 0, 0.05) || 0.016;
        last = now;
        this.time += dt;
        this.stepSim(dt);
        if (this.phase === 'done' && this.revealT > 4.4) { if (this.loopDemo !== false) this.newDemo(); }
        this.renderScreen(this.time);
        this.renderFrame(this.time);
      };
      this._raf = requestAnimationFrame(frame);
    }

    /* ---- stills -------------------------------------------------------- */
    /* Ten moments from one run: the swing in, the line-up, the last inch,
       and the poster the camera ends on. Rendered on nothing at all, so they
       drop straight into a deck or a layout. */
    async exportStills(count, opts) {
      const n = count || 5;
      if (!opts || !opts.hold) this.busyOn('Rendering stills…');
      const keepBd = this.backdrop, keepCap = this.caption;
      this.backdrop = 'none';
      this.allAds = true; this.caption = false;

      this.resetRun();
      /* Weighted towards the manoeuvre. The camera holds still once the car is
         parked, so more than a couple of resting frames would just repeat. */
      const nEnd = n >= 8 ? 2 : 1, nRun = n - nEnd;
      const marks = [];
      for (let i = 0; i < nRun; i++) marks.push(this.runTime * (0.06 + 0.86 * (i / (nRun - 1))));
      for (let i = 0; i < nEnd; i++) marks.push(this.runTime + 0.7 + i * 1.4);

      let t = 0, mi = 0;
      const files = [];
      const dt = 1 / 60;
      while (mi < n && t < marks[n - 1] + 2.0) {
        this.stepSim(dt);
        t += dt;
        if (t >= marks[mi]) {
          // give every still its own attitude, so a set reads as a set
          this.poseOffset = mi * 2.55;
          this.renderScreen(t);
          this.renderFrame(t);
          files.push(await new Promise((res) => this.out.toBlob(res, 'image/png')));
          mi++;
          this.say(`Rendering stills… ${mi}/${n}`);
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      this.backdrop = keepBd; this.caption = keepCap; this.poseOffset = 0;

      if (!opts || !opts.hold) {
        await this.saveStills(files, opts);
        this.busyOff();
      }
      return files;
    }

    /* Name by execution, so a set of fifteen sorts into three legible runs. */
    async saveStills(files, opts) {
      const ad = (D.ads[this.adIndex] && D.ads[this.adIndex].id) || 'ad';
      const tag = (opts && opts.tag) || ad;
      for (let i = 0; i < files.length; i++) {
        if (files[i]) this.download(files[i], `back-in-smoothly_${tag}_${String(i + 1).padStart(2, '0')}.png`);
        await new Promise((r) => setTimeout(r, 220));   // browsers rate-limit bursts
      }
      this.say(`${files.length} stills saved.`);
    }

    /* One run per execution, so every poster in the campaign gets a set. */
    async exportEveryAd(perAd) {
      this.busyOn('Rendering all three…');
      const out = [];
      for (let a = 0; a < Math.max(1, D.ads.length); a++) {
        this.newDemo(a);
        const files = await this.exportStills(perAd, { hold: true });
        const tag = (D.ads[a] && D.ads[a].id) || ('ad' + (a + 1));
        for (const f of files) out.push({ blob: f, tag });
        await this.saveStills(files, { tag });
      }
      this.busyOff();
      this.say(`${out.length} stills saved across ${D.ads.length} executions.`);
      return out;
    }

    download(blob, name) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      this.say(`Saved ${name} · ${(blob.size / 1048576).toFixed(1)} MB`);
    }

    busyOn(msg) { this.busy = true; this.say(msg); this.el.panel.setAttribute('aria-busy', 'true'); this.el.buttons.forEach((b) => (b.disabled = true)); }
    busyOff() { this.busy = false; this.el.panel.removeAttribute('aria-busy'); this.el.buttons.forEach((b) => (b.disabled = false)); }
    say(m) { if (this.el.status) this.el.status.textContent = m; }

    setFormat(f) {
      this.format = f;
      const [w, h] = FORMATS[f];
      const k = this.long / Math.max(w, h);
      this.out.width = Math.round(w * k / 2) * 2;
      this.out.height = Math.round(h * k / 2) * 2;
      this.out.style.aspectRatio = `${w} / ${h}`;
    }

    /* ---- panel --------------------------------------------------------- */
    _buildUI() {
      const root = this.root;
      root.innerHTML = `
        <div class="st-wrap">
          <div class="st-stage"><div class="st-canvas"></div></div>
          <aside class="st-panel" id="stPanel">
            <header>
              <p class="tag">Export studio</p>
              <h1>Demo stills</h1>
              <p class="st-note">A floating phone playing a round nobody has played before. One run per execution, on nothing at all.</p>
            </header>
            <div class="st-row"><label>Format</label><div class="st-seg" id="stFormat"></div></div>
            <div class="st-row"><label>Backdrop</label><div class="st-seg" id="stBack"></div></div>
            <div class="st-row"><label>Caption</label><div class="st-seg" id="stCap"></div></div>
            <div class="st-row"><label>Executions</label><div class="st-seg" id="stAds"></div></div>
            <div class="st-row"><label>Frames per run</label>
              <select id="stCount">
                <option value="4">4 frames</option>
                <option value="5" selected>5 frames</option>
                <option value="8">8 frames</option>
              </select>
            </div>
            <div class="st-meta">
              <span>Seed <b id="stSeed">—</b></span><span>Length <b id="stLen">—</b></span>
            </div>
            <div class="st-actions">
              <button class="btn btn-ghost btn-mini" id="stNew">New demo</button>
              <button class="btn btn-primary" id="stPng">Export stills · PNG</button>
            </div>
            <p class="st-status" id="stStatus" role="status" aria-live="polite">Ready.</p>
            <a class="studioLink" href="#play" id="stBack2">← Back to the game</a>
          </aside>
        </div>`;
      root.querySelector('.st-canvas').appendChild(this.out);
      this.out.className = 'st-out';

      const seg = (host, opts, cur, cb) => {
        host.innerHTML = '';
        opts.forEach(([val, label]) => {
          const b = document.createElement('button');
          b.textContent = label;
          b.className = 'st-chip';
          b.setAttribute('aria-pressed', String(val === cur()));
          b.onclick = () => { cb(val); [...host.children].forEach((c) => c.setAttribute('aria-pressed', String(c === b))); };
          host.appendChild(b);
        });
      };
      this.el = {
        panel: root.querySelector('#stPanel'),
        status: root.querySelector('#stStatus'),
        seed: root.querySelector('#stSeed'),
        len: root.querySelector('#stLen'),
        count: root.querySelector('#stCount'),
      };
      seg(root.querySelector('#stFormat'), Object.keys(FORMATS).map((k) => [k, k]), () => this.format, (v) => this.setFormat(v));
      seg(root.querySelector('#stBack'), Object.entries(BACKDROPS).map(([k, v]) => [k, v.name]), () => this.backdrop, (v) => { this.backdrop = v; });
      seg(root.querySelector('#stCap'), [[true, 'On'], [false, 'Off']], () => this.caption, (v) => { this.caption = v; });
      seg(root.querySelector('#stAds'), [[true, 'All three'], [false, 'This one']], () => this.allAds, (v) => { this.allAds = v; });
      root.querySelector('#stNew').onclick = () => this.newDemo();
      root.querySelector('#stPng').onclick = () => (this.allAds
        ? this.exportEveryAd(+this.el.count.value)
        : this.exportStills(+this.el.count.value));
      this.el.buttons = [...root.querySelectorAll('.st-actions button, .st-chip, #stCount')];
    }
  }

  NS.startStudio = function () {
    document.body.classList.add('studio');
    const root = document.getElementById('shell');
    D.loadAds().then(() => {
      NS.studio = new Studio(root);
    });
  };
  NS.studioParts = { layout, drawScreen, drawPhone, SCREEN_W, SCREEN_H };
})(window.PM = window.PM || {});
