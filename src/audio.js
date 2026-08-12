/* ============================================================================
   BACK IN SMOOTHLY — audio
   Synthesised, no files. The parking sensor is the whole soundtrack: it speeds
   up as you close in, and goes solid when you are about to touch.
   ========================================================================== */
(function (NS) {
  'use strict';
  const { clamp } = NS.core;

  class Audio {
    constructor() {
      this.ctx = null;
      this.enabled = true;
      this.ready = false;
      this._nextBeep = 0;
      this._solid = null;
    }
    unlock() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.34;
        // a gentle shelf so beeps sit on a phone speaker without stabbing
        this.comp = this.ctx.createDynamicsCompressor();
        this.comp.threshold.value = -18; this.comp.ratio.value = 4;
        this.master.connect(this.comp); this.comp.connect(this.ctx.destination);
        this.ready = true;
      } catch (e) { this.ready = false; }
    }
    setEnabled(on) {
      this.enabled = on;
      if (this.master) this.master.gain.value = on ? 0.34 : 0;
      if (!on) this.stopSolid();
    }
    _blip(freq, dur, type, gain, slide) {
      if (!this.ready || !this.enabled) return;
      const c = this.ctx, t = c.currentTime;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, slide), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain || 0.25, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur + 0.02);
    }
    /* the classic PDC tick — interval collapses as the gap closes */
    proximity(dist, t) {
      if (!this.ready || !this.enabled) return;
      if (dist < 0.30) { this.startSolid(); return; }
      this.stopSolid();
      if (dist > 2.6) return;
      const period = clamp(0.09 + (dist - 0.3) * 0.30, 0.10, 0.85);
      if (t < this._nextBeep) return;
      this._nextBeep = t + period;
      this._blip(dist < 0.9 ? 2050 : 1750, 0.055, 'square', 0.20);
    }
    startSolid() {
      if (!this.ready || !this.enabled || this._solid) return;
      const c = this.ctx, t = c.currentTime;
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'square'; o.frequency.value = 2050;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.03);
      o.connect(g); g.connect(this.master); o.start(t);
      this._solid = { o, g };
    }
    stopSolid() {
      if (!this._solid) return;
      const { o, g } = this._solid, t = this.ctx.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      o.stop(t + 0.08);
      this._solid = null;
    }
    crunch(force) {
      this.stopSolid();
      if (!this.ready || !this.enabled) return;
      const c = this.ctx, t = c.currentTime;
      const len = 0.4;
      const buf = c.createBuffer(1, c.sampleRate * len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) {
        const k = 1 - i / d.length;
        d[i] = (Math.random() * 2 - 1) * k * k;
      }
      const src = c.createBufferSource(); src.buffer = buf;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700; f.Q.value = 1.2;
      const g = c.createGain(); g.gain.value = 0.5 * clamp(force || 1, 0.3, 1);
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(t);
      this._blip(120, 0.22, 'sawtooth', 0.22, 60);
    }
    win() {
      this.stopSolid();
      if (!this.ready || !this.enabled) return;
      const notes = [523.25, 659.25, 783.99];
      notes.forEach((f, i) => setTimeout(() => this._blip(f, 0.32, 'triangle', 0.24), i * 95));
    }
    timeout() { this.stopSolid(); this._blip(330, 0.5, 'sawtooth', 0.2, 150); }
    click() { this._blip(880, 0.04, 'triangle', 0.14); }
    gear() { this._blip(440, 0.09, 'triangle', 0.16); setTimeout(() => this._blip(660, 0.12, 'triangle', 0.14), 90); }
  }

  NS.audio = new Audio();
})(window.PM = window.PM || {});
