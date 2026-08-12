/* ============================================================================
   BACK IN SMOOTHLY — the unit itself
   Boot, loop, HUD and the two end cards. One round is nineteen seconds; the
   payoff is the camera finding the poster on the wall, win or lose.
   ========================================================================== */
(function (NS) {
  'use strict';
  const C = NS.core;
  const { clamp, lerp, damp, smoothstep } = C;
  const D = NS.draw, S = NS.sim, WD = NS.world;

  // Swap for the network's click macro / the live product URL.
  const CTA_URL = 'https://www.platanomelon.com/';

  const COPY = {
    win: [
      { h: 'Backed in smoothly.', s: 'Straight in, first go, nothing touched. Some things really are easier with the right stuff.' },
      { h: 'That is how you back in smoothly.', s: 'Slow, straight and well lubricated. The car too.' },
      { h: 'Smooth. All the way in.', s: 'No shunting, no sawing at the wheel. Our lubricant does the same job.' },
    ],
    wall: { h: 'That is not backing in smoothly.', s: 'You went straight into the wall. A relaxant lubricant would have taken the edge off.' },
    car: { h: 'Nobody backs in smoothly like that.', s: 'You clipped the neighbour. Take it slower — and take some lubricant.' },
    pillar: { h: 'The pillar says you did not back in smoothly.', s: 'Tight spots go easier when everything is a little more slippery.' },
    stray: { h: 'Backing in smoothly means going in.', s: 'That was never the bay. Ours finds its way rather better.' },
    time: { h: 'Too slow to back in smoothly.', s: 'All that hesitating. Relax — our lubricant is rather good at that.' },
  };

  const STORE = {
    get(k, d) { try { const v = localStorage.getItem('pm_bis_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('pm_bis_' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };

  class Game {
    constructor(root) {
      this.root = root;
      this.el = {};
      ['view', 'boot', 'howto', 'result', 'brake', 'btnStart', 'btnAgain', 'btnCta', 'btnSound', 'btnHelp',
       'diagram', 'steps', 'heroAd', 'resultTitle', 'resultSub', 'resultLabel', 'resultDot',
       'scoreVal', 'scoreBar', 'scoreNote', 'live', 'cue',
       'dash', 'feedSlot', 'timer', 'timerFill', 'timerNum', 'status', 'pdcSvg', 'distNum', 'ctrlHint'].forEach((id) => {
        this.el[id] = document.getElementById(id);
      });
      this.arcs = [...this.el.pdcSvg.querySelectorAll('.arc')];
      this.arcLit = -1;

      this.reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.coarse = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
      this.input = new NS.Input();
      this.audio = NS.audio;
      this.audio.setEnabled(STORE.get('sound', true));

      this.scene = document.createElement('canvas');
      this.sctx = this.scene.getContext('2d', { alpha: false });
      this.cam = new C.Camera();
      this.post = NS.post.makePost(this.el.view);

      this._phase = 'boot';      // boot | howto | play | reveal | result
      this.wins = 0; this.rounds = 0;
      this.seeds = new Set();
      this.shake = { x: 0, y: 0, p: 0, r: 0, mag: 0 };
      this.flash = [0, 0, 0, 0];
      this.time = 0;
      this.lastStatus = '';
      this.revealT = 0;
      this.camPose = null;
      this.quality = 1;
      this._frameLog = [];

      this._bindUI();
      this._resize();
      addEventListener('resize', () => this._resize());
      addEventListener('orientationchange', () => setTimeout(() => this._resize(), 250));
      document.addEventListener('visibilitychange', () => { if (document.hidden) this.audio.stopSolid(); });
    }

    /* ---------------------------------------------------------------- setup */
    _bindUI() {
      const e = this.el;
      e.btnStart.addEventListener('click', () => this.startRound(true));
      e.btnAgain.addEventListener('click', () => this.startRound(false));
      e.btnCta.href = CTA_URL;
      e.btnHelp.addEventListener('click', () => this.showHowto());
      e.btnSound.addEventListener('click', () => {
        this.audio.unlock();
        const on = !this.audio.enabled;
        this.audio.setEnabled(on);
        STORE.set('sound', on);
        e.btnSound.setAttribute('aria-pressed', String(on));
        e.btnSound.setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
        if (on) this.audio.click();
      });
      e.btnSound.setAttribute('aria-pressed', String(this.audio.enabled));

      const brake = (on) => (ev) => {
        if (this.phase !== 'play') return;
        ev.preventDefault();
        this.input.setBrake(on ? 1 : 0);
        e.brake.dataset.on = on ? '1' : '0';
      };
      e.brake.addEventListener('pointerdown', brake(true));
      addEventListener('pointerup', brake(false));
      addEventListener('pointercancel', brake(false));
      e.brake.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') brake(true)(ev); });
      e.brake.addEventListener('keyup', (ev) => { if (ev.key === 'Enter') brake(false)(ev); });

      this.input.attachDrag(this.root);
    }

    /* The dashboard is laid out in one unit `u`, so the whole instrument
       cluster scales as a piece. The display gets whatever is left over,
       between 4:3 and square. */
    _resize() {
      const r = this.root.getBoundingClientRect();
      const W = r.width, H = r.height;
      const u = Math.min(H / 880, W / 430);
      this.root.style.setProperty('--u', u.toFixed(4) + 'px');
      this.u = u;

      const RESERVED = 322;                       // everything that is not the display
      const pad = 12 * u;
      let feedW = W - pad * 2;
      let avail = H - RESERVED * u;
      let feedH = clamp(avail, feedW * 0.70, feedW * 1.15);
      if (avail < feedW * 0.70) {                 // short screens: letterbox it
        feedH = Math.max(avail, 110 * u);
        feedW = Math.min(feedW, feedH / 0.70);
      }
      this.el.feedSlot.style.height = feedH + 'px';
      this.el.feedSlot.style.width = feedW + 'px';
      this.el.feedSlot.style.marginInline = 'auto';

      const slot = this.el.feedSlot.getBoundingClientRect();
      const x0 = (slot.left - r.left) / W, y0 = (slot.top - r.top) / H;
      this.feedRect = { x0, y0, x1: x0 + feedW / W, y1: y0 + feedH / H };
      // where the display expands to when the camera takes the screen over
      const bigW = W, bigH = Math.min(H * 0.96, bigW * (feedH / feedW));
      const bw = bigH * (feedW / feedH);
      this.feedRectBig = {
        x0: (W - bw) / 2 / W, x1: 1 - (W - bw) / 2 / W,
        y0: (H - bigH) / 2 / H, y1: 1 - (H - bigH) / 2 / H,
      };
      this.feedRadius = 10 * u;

      const dpr = Math.min(devicePixelRatio || 1, 2);
      this.el.view.width = Math.max(1, Math.round(W * dpr));
      this.el.view.height = Math.max(1, Math.round(H * dpr));
      this.el.view.style.width = W + 'px';
      this.el.view.style.height = H + 'px';
      this.dpr = dpr;

      // The sensor is the cheap part of a reversing camera: rendering near
      // 480p is both faster and more honest than rendering sharp.
      const sw = Math.max(2, Math.min(760 * (this.quality || 1), Math.round(feedW * dpr)));
      const sh = Math.max(2, Math.round(sw * (feedH / feedW)));
      this.scene.width = sw; this.scene.height = sh;
      this.cam.fov = 1.85;
      this.cam.setViewport(sw, sh);
    }

    get phase() { return this._phase; }
    set phase(p) { this._phase = p; this.root.dataset.phase = p; }

    /* ---------------------------------------------------------------- flow */
    async boot() {
      await D.loadAds();
      this.el.boot.hidden = true;
      this.buildRound();
      this.loop();
      if (STORE.get('seen', false)) this.showHowto(true); else this.showHowto();
    }

    showHowto() {
      const paused = this.phase === 'play';
      this.paused = paused;
      this.phase = 'howto';
      const e = this.el;
      const kind = this.coarse ? 'tilt' : 'keys';
      e.diagram.innerHTML = kind === 'tilt' ? NS.diagram.tilt() : NS.diagram.keys();
      e.cue.innerHTML = NS.diagram.cue(kind);
      const needPerm = kind === 'tilt' && this.input.needsPermission() && !this.input.calibrated;
      e.btnStart.textContent = paused ? 'Resume' : needPerm ? 'Allow tilt & start' : 'Start reversing';
      e.howto.hidden = false;
      e.result.hidden = true;
      e.brake.disabled = true;
      this.setInert(true);
      e.btnStart.focus({ preventScroll: true });
    }

    nextSeed() {
      let s;
      let guard = 0;
      do { s = (Math.random() * 0xffffffff) >>> 0; } while (this.seeds.has(s) && guard++ < 50);
      this.seeds.add(s);
      return s;
    }

    buildRound() {
      const difficulty = clamp(this.wins * 0.22, 0, 1);
      this.level = WD.buildLevel(this.nextSeed(), difficulty);
      this.state = S.create(this.level);
      this.driver = S.makeDriver(this.level.seed);   // also drives the demo reel
      S.measure(this.state);
      this.input.reset();
      this.flash = [0, 0, 0, 0];
      this.shake.mag = 0;
      this.revealT = 0;
      this.camPose = null;
      this.lastStatus = '';
    }

    async startRound(fromHowto) {
      const e = this.el;
      this.audio.unlock();
      if (this.coarse) {
        if (!this.input.available.tilt) {
          if (this.input.needsPermission()) await this.input.requestTilt();
          else this.input.startTilt();
        }
        // give the sensor a beat to deliver its first sample
        if (this.input.available.tilt || this.input.tiltLive()) {
          await new Promise((r) => setTimeout(r, 120));
        }
        if (this.input.tiltLive()) { this.input.mode = 'tilt'; this.input.calibrate(); }
        else this.input.mode = 'drag';
      } else {
        this.input.mode = 'keys';
      }
      STORE.set('seen', true);
      if (!fromHowto && !this.paused) this.buildRound();
      this.paused = false;
      e.howto.hidden = true;
      e.result.hidden = true;
      e.brake.disabled = false;
      this.setInert(false);
      this.phase = 'play';
      this.rounds++;
      this.audio.gear();
      e.ctrlHint.textContent = this.input.mode === 'tilt' ? 'Tilt to steer · hold to brake'
        : this.input.mode === 'drag' ? 'Drag anywhere to steer' : '← → steer · space brakes';
      this.say(this.input.mode === 'tilt'
        ? 'Reversing. Tilt to steer, hold brake to stop.'
        : this.input.mode === 'drag'
          ? 'Reversing. Drag left or right to steer, hold brake to stop.'
          : 'Reversing. Arrow keys to steer, space to brake.');
      this.el.view.focus && this.el.view.focus({ preventScroll: true });
    }

    endRound() {
      const st = this.state;
      this.phase = 'reveal';
      this.revealT = 0;
      this.el.brake.disabled = true;
      this.input.setBrake(0);
      this.el.brake.dataset.on = '0';
      this.audio.stopSolid();
      if (st.phase === 'won') {
        this.wins++;
        this.audio.win();
        this.flash = [0.72, 1.0, 0.58, 0.20];
      } else if (st.reason === 'time') {
        this.audio.timeout();
        this.flash = [1, 0.80, 0.25, 0.16];
      } else {
        this.audio.crunch(st.impact);
        this.flash = [1, 0.20, 0.10, 0.42];
        this.shake.mag = 1 * (this.reduce ? 0.35 : 1);
        if (navigator.vibrate && !this.reduce) { try { navigator.vibrate([28, 40, 60]); } catch (e) { /* */ } }
      }
    }

    showResult() {
      const st = this.state, e = this.el;
      const won = st.phase === 'won';
      const copy = won ? st.rng.pick(COPY.win) : (COPY[st.reason] || COPY.time);
      const ad = D.ads[this.level.poster.index % D.ads.length];

      e.resultLabel.textContent = won ? 'Smooth' : 'Not smooth';
      e.resultDot.style.background = won ? 'var(--cam-green)' : 'var(--cam-red)';
      e.resultLabel.style.color = won ? 'var(--cam-green)' : 'var(--cam-red)';
      e.resultTitle.textContent = copy.h;
      e.resultSub.textContent = copy.s;
      e.heroAd.innerHTML = ad ? `<img src="${ad.img.src}" alt="PlatanoMelón: Back in smoothly. Easier with our relaxant lubricant." style="width:${won ? 'min(64%,250px)' : 'min(46%,180px)'}">` : '';
      e.scoreVal.textContent = st.score + '%';
      e.scoreNote.textContent = 'Smoothness';
      e.scoreBar.style.width = '0%';
      e.scoreBar.style.background = won ? 'var(--pm-yellow)' : 'var(--cam-red)';
      requestAnimationFrame(() => { e.scoreBar.style.width = st.score + '%'; });

      const best = Math.max(STORE.get('best', 0), won ? st.score : 0);
      STORE.set('best', best);

      e.result.hidden = false;
      this.setInert(true);
      this.phase = 'result';
      this.say(`${won ? 'Parked' : 'Crashed'}. ${copy.h} Smoothness ${st.score} percent.`);
      setTimeout(() => e.btnCta.focus({ preventScroll: true }), 60);
    }

    say(msg) { if (this.el.live && msg !== this._said) { this.el.live.textContent = msg; this._said = msg; } }

    /* keep the dashboard out of the tab order while a sheet is open */
    setInert(on) {
      const d = this.el.dash;
      if (!d) return;
      if ('inert' in HTMLElement.prototype) d.inert = on;
      else d.setAttribute('aria-hidden', on ? 'true' : 'false');
    }

    /* ---------------------------------------------------------------- loop */
    loop() {
      let last = performance.now();
      const frame = (now) => {
        const dt = Math.min(0.05, (now - last) / 1000) || 0.016;
        last = now;
        this.time += dt;
        this.update(dt);
        this.render(dt);
        this._watchFrames(dt);
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }

    /* One step down in internal resolution if the phone is struggling. A
       reversing camera that drops frames is worse than a soft one. */
    _watchFrames(dt) {
      if (this.quality < 1 || this.phase !== 'play') return;
      const log = this._frameLog;
      log.push(dt);
      if (log.length < 60) return;
      const sorted = log.slice().sort((a, b) => a - b);
      const med = sorted[sorted.length >> 1];
      log.length = 0;
      if (med > 0.026) { this.quality = 0.72; this._resize(); }
    }

    update(dt) {
      const st = this.state;
      if (this.phase === 'play') {
        const inp = this.autoDrive ? S.drive(st, this.driver, dt) : this.input.update(dt);
        S.step(st, dt, inp);
        this.audio.proximity(st.proximity, this.time);
        this.updateStatus();
        this.updateDash();
        if (st.phase !== 'drive') this.endRound();
      } else if (this.phase === 'reveal') {
        this.revealT += dt;
        if (this.revealT > 1.15) this.showResult();
      }
      // decay the knocks and flashes
      this.flash[3] = Math.max(0, this.flash[3] - dt * (this.phase === 'reveal' ? 1.6 : 2.6));
      if (this.shake.mag > 0) {
        this.shake.mag = Math.max(0, this.shake.mag - dt * 2.2);
        const m = this.shake.mag * this.shake.mag * 0.06;
        this.shake.x = (Math.random() - 0.5) * m;
        this.shake.y = (Math.random() - 0.5) * m;
        this.shake.p = (Math.random() - 0.5) * m * 0.6;
        this.shake.r = (Math.random() - 0.5) * m * 0.9;
      } else { this.shake.x = this.shake.y = this.shake.p = this.shake.r = 0; }
    }

    /* The camera looks backwards, so the world's -x is the screen's right.
       Every direction the player is told about is a screen direction. */
    updateStatus() {
      const st = this.state;
      let s, tone = '';
      if (!st.inBox && Math.abs(st.lateralErr) > 0.85) { s = st.lateralErr > 0 ? 'Bay is right' : 'Bay is left'; }
      else if (!st.inBox) s = 'Line it up';
      else if (Math.abs(st.headingErr) > 0.13) s = 'Straighten up';
      else if (st.wallGap > S.TUNE.gapMax - 0.15) { s = 'Keep coming'; tone = 'ok'; }
      else { s = 'Brake now'; tone = 'urgent'; }
      this.status = s;
      if (s !== this.lastStatus) {
        this.lastStatus = s;
        this.el.status.textContent = s;
        this.el.status.dataset.tone = tone;
      }
    }

    /* ---- the instrument cluster ---------------------------------------- */
    updateDash() {
      const st = this.state, e = this.el;
      const playing = this.phase === 'play';

      const frac = clamp(st.timeLeft / S.TUNE.timeLimit, 0, 1);
      e.timerFill.style.width = (frac * 100).toFixed(1) + '%';
      const low = playing && st.timeLeft < 5.5;
      e.timer.dataset.low = low ? '1' : '0';
      if (low) e.timerNum.textContent = st.timeLeft.toFixed(1) + 's';

      const d = st.proximity;
      e.distNum.textContent = !playing ? '—' : d > 2.6 ? '—' : d.toFixed(1) + ' m';
      e.distNum.style.color = d < 0.5 ? 'var(--cam-red)' : 'var(--paper)';

      // arcs light from the outside in, the way a parking sensor does
      const TH = [0.5, 1.0, 1.7, 2.6];
      const COL = ['var(--cam-red)', 'var(--pm-yellow)', 'var(--pm-yellow)', 'var(--cam-green)'];
      let lit = 0;
      for (let i = 3; i >= 0; i--) if (playing && d < TH[i]) lit = i + 1;
      if (lit !== this.arcLit) {
        this.arcLit = lit;
        this.arcs.forEach((a, i) => {
          a.style.stroke = (playing && d < TH[i]) ? COL[i] : 'rgba(244,243,239,0.11)';
        });
      }
    }

    /* -------------------------------------------------------------- render */
    render(dt) {
      const st = this.state, cam = this.cam, ctx = this.sctx;
      if (!st) return;
      const reveal = this.phase === 'reveal' || this.phase === 'result';

      /* The camera never leaves the car. If you backed in properly the poster
         is already square in the frame — that is the whole campaign — so the
         end of a round only steadies the shot and lets the lens settle. */
      D.placeCamera(cam, st, this.shake);
      if (reveal) {
        const k = smoothstep(clamp((this.revealT - 0.15) / 1.0, 0, 1));
        cam.pitch += 0.045 * k;          // the nose lifts as the brakes release
        cam.update();
      }

      D.renderScene(ctx, cam, st, this.time, {
        guides: !reveal,
        bumper: !reveal,
        subdiv: reveal ? 9 : 6,
      });

      const L = NS.post.LOOK;
      const ease = reveal ? smoothstep(clamp((this.revealT - 0.3) / 1.1, 0, 1)) : 0;
      const a = this.feedRect, b = this.feedRectBig;
      const rect = ease > 0 ? {
        x0: lerp(a.x0, b.x0, ease), y0: lerp(a.y0, b.y0, ease),
        x1: lerp(a.x1, b.x1, ease), y1: lerp(a.y1, b.y1, ease),
      } : a;
      /* On the reveal the lens quietly stops being a cheap lens: the artwork
         has to arrive as artwork, not as camera footage. */
      this.post.render(this.scene, {
        rect,
        radius: this.feedRadius * this.dpr,
        time: this.time,
        k1: L.k1 * (1 - ease * 0.55), k2: L.k2 * (1 - ease * 0.55),
        chroma: L.chroma * (1 - ease * 0.8),
        scan: L.scan * (1 - ease * 0.62),
        grain: L.grain * (1 - ease * 0.55),
        vignette: L.vignette * (1 - ease * 0.45),
        bloom: L.bloom * (1 - ease * 0.85),
        gain: lerp(L.gain, 1.0, ease),
        sat: lerp(L.sat, 0.99, ease),
        lines: Math.round(this.scene.height / 3),
        reduce: this.reduce,
        flash: this.flash,
      });
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  NS.Game = Game;
  NS.CTA_URL = CTA_URL;
  NS.roundRect = roundRect;
})(window.PM = window.PM || {});
