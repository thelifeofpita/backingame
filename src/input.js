/* ============================================================================
   BACK IN SMOOTHLY — input
   Tilt first, keys and drag as equals. The tilt reading is taken from raw
   accelerometer gravity rather than Euler angles, because Euler angles gimbal
   lock exactly where people hold a phone to play, and calibrated against
   however the player happens to be sitting.
   ========================================================================== */
(function (NS) {
  'use strict';
  const { clamp, damp } = NS.core;

  const MAX_TILT = 0.36;   // rad — a comfortable wrist roll gives full lock
  const DEAD = 0.028;

  class Input {
    constructor() {
      this.mode = 'keys';        // keys | tilt | drag
      this.available = { tilt: false, keys: true, drag: true };
      this.raw = 0;              // -1..1 before smoothing
      this.steer = 0;
      this.brake = 0;
      this.tiltReady = false;
      this.tiltDenied = false;
      this._g = { x: 0, y: -9.8, z: 0 };
      this._flip = 1;
      this._neutral = 0;
      this._keys = { l: 0, r: 0, b: 0 };
      this._dragActive = false;
      this._dragBase = 0;
      this._dragSteer = 0;
      this._lastEvent = 0;
      this.calibrated = false;
      this._bind();
    }

    _bind() {
      addEventListener('keydown', (e) => this._key(e, 1), { passive: false });
      addEventListener('keyup', (e) => this._key(e, 0), { passive: false });
      addEventListener('blur', () => { this._keys.l = this._keys.r = this._keys.b = 0; });
    }
    _key(e, down) {
      const k = e.key;
      let used = true;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') this._keys.l = down;
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') this._keys.r = down;
      else if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === ' ' || k === 'Spacebar') this._keys.b = down;
      else used = false;
      if (used) {
        if (down && this.mode !== 'keys' && !this._lockMode) this.mode = 'keys';
        if (e.cancelable) e.preventDefault();
      }
    }

    /* ---- tilt --------------------------------------------------------- */
    needsPermission() {
      return (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') ||
             (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function');
    }
    async requestTilt() {
      try {
        if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
          const r = await DeviceMotionEvent.requestPermission();
          if (r !== 'granted') { this.tiltDenied = true; return false; }
        } else if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
          const r = await DeviceOrientationEvent.requestPermission();
          if (r !== 'granted') { this.tiltDenied = true; return false; }
        }
      } catch (e) { this.tiltDenied = true; return false; }
      return this.startTilt();
    }
    startTilt() {
      if (this._tiltBound) return this.available.tilt;
      this._onMotion = (e) => {
        const a = e.accelerationIncludingGravity;
        if (!a || (a.x === null && a.y === null)) return;
        this._lastEvent = performance.now();
        // low-pass to gravity; discards the hand tremor and any real shaking
        const k = 0.82;
        this._g.x = this._g.x * k + (a.x || 0) * (1 - k);
        this._g.y = this._g.y * k + (a.y || 0) * (1 - k);
        this._g.z = this._g.z * k + (a.z || 0) * (1 - k);
        this._haveMotion = true;
        this.available.tilt = true;
      };
      this._onOrient = (e) => {
        if (this._haveMotion) return;      // motion is the better source
        if (e.beta === null || e.gamma === null) return;
        this._lastEvent = performance.now();
        const b = e.beta * Math.PI / 180, g = e.gamma * Math.PI / 180;
        // gravity, in device axes, from the ZXY Euler triple
        this._g.x = Math.cos(b) * Math.sin(g) * 9.81;
        this._g.y = -Math.sin(b) * 9.81;
        this._g.z = -Math.cos(b) * Math.cos(g) * 9.81;
        this._flip = 1;
        this._orientOnly = true;
        this.available.tilt = true;
      };
      addEventListener('devicemotion', this._onMotion, { passive: true });
      addEventListener('deviceorientation', this._onOrient, { passive: true });
      this._tiltBound = true;
      return true;
    }
    /* Browsers disagree about the sign of accelerationIncludingGravity, so we
       work it out from how the phone is being held at calibration time. */
    calibrate() {
      const g = this._g;
      if (!this._orientOnly) {
        if (Math.abs(g.y) > 3) this._flip = g.y > 0 ? -1 : 1;
        else if (Math.abs(g.z) > 3) this._flip = g.z > 0 ? -1 : 1;
        else this._flip = 1;
      }
      this._neutral = this._axis();
      this.calibrated = true;
    }
    _axis() {
      const g = this._g, f = this._flip;
      let gx = g.x * f, gy = g.y * f;
      const a = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
      if (a === 90) { const t = gx; gx = -gy; gy = t; }
      else if (a === 180) { gx = -gx; gy = -gy; }
      else if (a === 270 || a === -90) { const t = gx; gx = gy; gy = -t; }
      const mag = Math.hypot(g.x, g.y, g.z) || 9.81;
      return Math.asin(clamp(gx / mag, -1, 1));
    }
    tiltLive() { return this.available.tilt && performance.now() - this._lastEvent < 1200; }

    /* Permission granting and the first sensor reading are separate events:
       the sensor can take a few hundred milliseconds to deliver anything. The
       old code checked immediately, found nothing, and fell back to dragging
       for the whole first round. Wait for a real sample instead. */
    waitForSample(ms) {
      if (this.tiltLive()) return Promise.resolve(true);
      return new Promise((resolve) => {
        const t0 = performance.now();
        const tick = () => {
          if (this.tiltLive()) return resolve(true);
          if (performance.now() - t0 > (ms || 1200)) return resolve(false);
          setTimeout(tick, 40);
        };
        tick();
      });
    }

    /* ---- drag (also the accessible alternative to tilting) ------------- */
    attachDrag(el) {
      const down = (x) => { this._dragActive = true; this._dragUsed = true; this._dragBase = x - this._dragSteer * this._dragSpan(el); };
      const move = (x) => {
        if (!this._dragActive) return;
        this._dragSteer = clamp((x - this._dragBase) / this._dragSpan(el), -1, 1);
        if (!this._lockMode) this.mode = 'drag';
      };
      const up = () => { this._dragActive = false; };
      el.addEventListener('pointerdown', (e) => { if (e.target.closest('button, a, [data-nodrag]')) return; el.setPointerCapture && el.setPointerCapture(e.pointerId); down(e.clientX); });
      el.addEventListener('pointermove', (e) => move(e.clientX));
      addEventListener('pointerup', up); addEventListener('pointercancel', up);
    }
    _dragSpan(el) { return Math.max(120, (el.clientWidth || 360) * 0.34); }

    setBrake(v) { this._extBrake = v; }

    /* ---- read --------------------------------------------------------- */
    update(dt) {
      // sensor showed up after we had already fallen back? take it, quietly,
      // but only while the player has not started dragging
      if (this.mode === 'drag' && !this._dragUsed && this.tiltLive() && !this._lockMode) {
        this.mode = 'tilt';
        this.calibrate();
        if (this.onModeChange) this.onModeChange('tilt');
      }
      let target = 0;
      const useTilt = this.mode === 'tilt' && this.tiltLive();
      if (useTilt) {
        const a = this._axis() - this._neutral;
        const s = Math.abs(a) < DEAD ? 0 : (a - Math.sign(a) * DEAD) / (MAX_TILT - DEAD);
        target = clamp(s, -1, 1);
      } else if (this.mode === 'drag') {
        target = this._dragSteer;
        // spring back to centre when the finger lets go
        if (!this._dragActive) this._dragSteer = damp(this._dragSteer, 0, 6, dt);
      } else {
        target = (this._keys.r ? 1 : 0) - (this._keys.l ? 1 : 0);
      }
      this.raw = target;
      // one shared smoothing law, so every control scheme feels the same
      const lambda = this.mode === 'keys' ? 9 : 14;
      this.steer = damp(this.steer, target, lambda, dt);
      const b = Math.max(this._keys.b ? 1 : 0, this._extBrake || 0);
      this.brake = damp(this.brake, b, 22, dt);
      return { steer: this.steer, brake: this.brake };
    }
    reset() {
      this.steer = 0; this.brake = 0; this._dragSteer = 0; this._extBrake = 0;
      this._dragUsed = false;
      this._keys.l = this._keys.r = this._keys.b = 0;
    }
  }

  NS.Input = Input;
})(window.PM = window.PM || {});
