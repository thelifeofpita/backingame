/* ============================================================================
   BACK IN SMOOTHLY — post
   Everything between the sensor and your eye: the wide-angle lens, the cheap
   auto-gain, the LCD in the dashboard and the camera phone pointed at it.
   The scene canvas goes in flat; this is what bends it.
   ========================================================================== */
(function (NS) {
  'use strict';

  const VERT = `
    attribute vec2 aPos;
    varying vec2 vUv;
    void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }
  `;

  const FRAG = `
    #extension GL_OES_standard_derivatives : enable
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uTex;
    uniform vec2  uRes;       // output pixels
    uniform vec2  uSrc;       // source texture pixels
    uniform vec2  uRMin, uRMax;  // the display panel, in output uv
    uniform float uRadius;    // its corner radius, in output pixels
    uniform float uTime;
    uniform float uAspect;
    uniform float uK1, uK2, uFit;
    uniform float uChroma, uScan, uGrain, uVig, uBloom, uGain, uSat;
    uniform vec2  uPanel;     // the display's own pixel grid
    uniform float uGrille;    // how hard the RGB matrix shows through
    uniform float uLines;
    uniform float uReduce;
    uniform vec4  uFlash;     // rgb + amount

    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    /* s scales the whole channel, k bends it. The bend is cubic, so it only
       really shows near the corners; the scale is linear, which is what puts
       colour fringing across the middle of the frame as well. */
    vec2 lens(vec2 p, float k, float s){
      float r2 = dot(p, p);
      return p * s * (1.0 + (uK1 + k) * r2 + uK2 * r2 * r2);
    }
    vec2 toUv(vec2 p){ return (p * uFit) / vec2(uAspect, 1.0) + 0.5; }
    #define SNAP(uv) ((floor((uv) * uPanel) + 0.5) / uPanel)

    void main(){
      // --- the panel: a rounded rectangle of glass sat in the dashboard ---
      vec2 halfPx = (uRMax - uRMin) * uRes * 0.5;
      vec2 ctrPx  = (uRMax + uRMin) * uRes * 0.5;
      vec2 dv = abs(vUv * uRes - ctrPx) - (halfPx - uRadius);
      float sd = length(max(dv, 0.0)) + min(max(dv.x, dv.y), 0.0) - uRadius;
      float inside = 1.0 - smoothstep(-0.75, 0.75, sd);
      float shadow = smoothstep(14.0, 0.0, sd) * 0.5;
      if (inside < 0.002) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, shadow);
        return;
      }

      vec2 luv = (vUv - uRMin) / (uRMax - uRMin);
      vec2 p = (luv - 0.5) * vec2(uAspect, 1.0);
      float r2 = dot(p, p);

      /* The panel grid belongs to the picture, not to the output: index it by
         the lens-mapped coordinate and the pixels bow with everything else,
         packing tighter towards the edges the way a wide lens squeezes them. */
      vec2 uvG = toUv(lens(p, 0.0, 1.0));
      vec2 cell = uvG * uPanel;
      vec2 texel = 1.0 / uPanel;

      /* Colour fringing has to be measured in whole panel pixels. Snapping the
         sample to pixel centres quantises away any offset smaller than a
         texel, which is what made the aberration vanish once the grid arrived. */
      vec2 dir = r2 > 1e-7 ? normalize(p / vec2(uAspect, 1.0)) : vec2(0.0);
      vec2 off = dir * texel * (uChroma * (0.75 + r2 * 2.4));

      vec3 col;
      col.r = texture2D(uTex, clamp(SNAP(uvG + off), 0.001, 0.999)).r;
      col.g = texture2D(uTex, clamp(SNAP(uvG), 0.001, 0.999)).g;
      col.b = texture2D(uTex, clamp(SNAP(uvG - off), 0.001, 0.999)).b;

      // --- bloom: strip lights blooming into a cheap sensor -------------
      /* Only genuine light sources are allowed to bloom. Keying off the
         brightest channel made saturated yellow — the poster — glow like a
         lamp and swallow its own type; luminance keeps it to the tubes. */
      if (uBloom > 0.001) {
        vec3 b = vec3(0.0);
        vec2 px = 2.6 / uSrc;
        for (int i = 0; i < 8; i++) {
          float a = float(i) * 0.7853981;
          vec2 o = vec2(cos(a), sin(a)) * px * 2.2;
          vec3 s = texture2D(uTex, clamp(uvG + o, 0.001, 0.999)).rgb;
          float l = dot(s, vec3(0.299, 0.587, 0.114));
          b += s * smoothstep(0.90, 1.0, l);
        }
        col += b * (uBloom / 8.0);
      }

      // --- sensor: lifted blacks, low saturation, a cool cast -----------
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(lum), col, uSat);
      col *= vec3(0.96, 1.0, 1.02);
      col = col * uGain + 0.028;

      /* --- the panel itself ---------------------------------------------
         Three things make a screen look like a screen when you photograph one:
         the gaps between pixels, the red-green-blue stripe inside each one,
         and the fact that both are slightly out of step with the camera's own
         grid, which is where the moire comes from. */
      /* Two different frequencies, and they have to stay separate or they
         beat against each other into a mesh: the lattice belongs to the panel,
         the red-green-blue stripe to the camera looking at it. */
      /* How many output pixels one panel pixel covers here. The lens squeezes
         them towards the edges, so this varies across the frame; draw only
         what can actually be resolved or the matrix aliases into a diagonal
         weave instead of a grid. */
      float cellPx = 1.0 / max(fwidth(cell.x), 1e-5);
      float latAmt = smoothstep(1.1, 2.4, cellPx) * uGrille;
      float subAmt = smoothstep(3.0, 6.0, cellPx) * uGrille;

      vec2 f = fract(cell);
      float gx = 0.5 - 0.5 * cos(f.x * 6.2831853);
      float gy = 0.5 - 0.5 * cos(f.y * 6.2831853);
      float door = mix(1.0, 0.40 + 0.60 * gx * gy, latAmt);
      // three subpixels to a pixel, but only where they fit
      float sub = floor(f.x * 3.0);
      vec3 stripe = vec3(sub < 1.0 ? 1.0 : 0.66,
                         (sub >= 1.0 && sub < 2.0) ? 1.0 : 0.66,
                         sub >= 2.0 ? 1.0 : 0.66);
      vec3 matrix = mix(vec3(1.0), stripe, subAmt) * door;
      float scan = sin(cell.y * 3.14159265);
      matrix *= mix(1.0, 0.92 + 0.08 * scan * scan, uScan);
      col *= matrix;
      col *= 1.0 + latAmt * 0.46 + subAmt * 0.18;   // give back what it took
      // slow rolling refresh bar
      col *= 1.0 + (1.0 - uReduce) * 0.016 * sin(luv.y * 5.0 - uTime * 0.9);

      // --- lens shroud and vignette -------------------------------------
      float rr = length(p * vec2(0.94, 1.0));
      col *= mix(1.0, smoothstep(1.05, 0.40, rr), uVig);

      // --- grain, stronger where the gain is working hardest -------------
      float n = hash(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5;
      col += n * uGrain * (1.25 - clamp(lum, 0.0, 1.0) * 0.75);

      col = mix(col, uFlash.rgb, uFlash.a);

      // --- it is a piece of glass in a car ------------------------------
      col += 0.022 * smoothstep(0.15, 1.0, luv.x * 0.55 + (1.0 - luv.y) * 0.45);
      col *= mix(1.0, 0.42, smoothstep(-3.0, -0.2, sd)); // recessed under its bezel

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), inside);
    }
  `;

  /* Uniform plumbing, shared with gl.js which owns the context. */
  function setUniforms(gl, p, prm, w, h, srcW, srcH) {
    const r = prm.rect || { x0: 0, y0: 0, x1: 1, y1: 1 };
    const aspect = ((r.x1 - r.x0) * w) / ((r.y1 - r.y0) * h);
    const rc = aspect * aspect * 0.25 + 0.25;
    const fit = 1 / (1 + prm.k1 * rc + prm.k2 * rc * rc);
    const U = p.u;
    gl.uniform2f(U.uRes, w, h);
    gl.uniform2f(U.uSrc, srcW, srcH);
    gl.uniform2f(U.uRMin, r.x0, 1 - r.y1);
    gl.uniform2f(U.uRMax, r.x1, 1 - r.y0);
    gl.uniform1f(U.uRadius, prm.radius || 0);
    gl.uniform1f(U.uTime, prm.time || 0);
    gl.uniform1f(U.uAspect, aspect);
    gl.uniform1f(U.uK1, prm.k1); gl.uniform1f(U.uK2, prm.k2); gl.uniform1f(U.uFit, fit);
    gl.uniform1f(U.uChroma, prm.chroma);
    gl.uniform1f(U.uScan, prm.scan);
    gl.uniform1f(U.uGrain, prm.grain);
    gl.uniform1f(U.uVig, prm.vignette);
    gl.uniform1f(U.uBloom, prm.bloom);
    gl.uniform1f(U.uGain, prm.gain === undefined ? 1 : prm.gain);
    gl.uniform1f(U.uSat, prm.sat === undefined ? 0.78 : prm.sat);
    gl.uniform1f(U.uLines, prm.lines || 300);
    const pw = prm.panel || 320;
    gl.uniform2f(U.uPanel, pw, Math.round(pw / aspect));
    gl.uniform1f(U.uGrille, prm.grille === undefined ? 0.55 : prm.grille);
    gl.uniform1f(U.uReduce, prm.reduce ? 1 : 0);
    const f = prm.flash || [0, 0, 0, 0];
    gl.uniform4f(U.uFlash, f[0], f[1], f[2], f[3]);
  }

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('[post] shader:', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  class Post {
    constructor(canvas) {
      this.canvas = canvas;
      this.ok = false;
      const opts = { alpha: true, premultipliedAlpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' };
      const gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
      if (!gl) return;
      this.gl = gl;
      const vs = compile(gl, gl.VERTEX_SHADER, VERT);
      const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
      if (!vs || !fs) return;
      const prog = gl.createProgram();
      gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn('[post] link:', gl.getProgramInfoLog(prog)); return; }
      this.prog = prog;
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      this.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      this.u = {};
      for (const n of ['uRes', 'uSrc', 'uRMin', 'uRMax', 'uRadius', 'uTime', 'uAspect', 'uK1', 'uK2', 'uFit',
                       'uChroma', 'uScan', 'uGrain', 'uVig', 'uBloom', 'uGain', 'uSat', 'uLines', 'uReduce', 'uFlash', 'uTex']) {
        this.u[n] = gl.getUniformLocation(prog, n);
      }
      gl.uniform1i(this.u.uTex, 0);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      this.ok = true;
      canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.ok = false; });
    }

    render(src, p) {
      if (!this.ok) return false;
      const gl = this.gl, cv = this.canvas;
      const w = cv.width, h = cv.height;
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(this.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      // the display panel, given top-down like CSS, used bottom-up like GL
      const r = p.rect || { x0: 0, y0: 0, x1: 1, y1: 1 };
      const aspect = ((r.x1 - r.x0) * w) / ((r.y1 - r.y0) * h);
      const k1 = p.k1, k2 = p.k2;
      // fit: push the corner of the distorted image exactly onto the corner
      const rc = aspect * aspect * 0.25 + 0.25;
      const fit = 1 / (1 + k1 * rc + k2 * rc * rc);
      const U = this.u;
      gl.uniform2f(U.uRes, w, h);
      gl.uniform2f(U.uSrc, src.width, src.height);
      gl.uniform2f(U.uRMin, r.x0, 1 - r.y1);
      gl.uniform2f(U.uRMax, r.x1, 1 - r.y0);
      gl.uniform1f(U.uRadius, p.radius || 0);
      gl.uniform1f(U.uTime, p.time);
      gl.uniform1f(U.uAspect, aspect);
      gl.uniform1f(U.uK1, k1);
      gl.uniform1f(U.uK2, k2);
      gl.uniform1f(U.uFit, fit);
      gl.uniform1f(U.uChroma, p.chroma);
      gl.uniform1f(U.uScan, p.scan);
      gl.uniform1f(U.uGrain, p.grain);
      gl.uniform1f(U.uVig, p.vignette);
      gl.uniform1f(U.uBloom, p.bloom);
      gl.uniform1f(U.uGain, p.gain === undefined ? 1 : p.gain);
      gl.uniform1f(U.uSat, p.sat === undefined ? 0.78 : p.sat);
      gl.uniform1f(U.uLines, p.lines || 300);
      gl.uniform1f(U.uReduce, p.reduce ? 1 : 0);
      const f = p.flash || [0, 0, 0, 0];
      gl.uniform4f(U.uFlash, f[0], f[1], f[2], f[3]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return true;
    }
  }

  /* ---- graceful degradation: still a screen, just not a curved one ------- */
  class Post2D {
    constructor(canvas) { this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.ok = true; this.fallback = true; }
    render(src, p) {
      const ctx = this.ctx, w = this.canvas.width, h = this.canvas.height;
      const r = p.rect || { x0: 0, y0: 0, x1: 1, y1: 1 };
      const rx = r.x0 * w, ry = r.y0 * h, rw = (r.x1 - r.x0) * w, rh = (r.y1 - r.y0) * h;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      if (window.PM && PM.roundRect) { PM.roundRect(ctx, rx, ry, rw, rh, p.radius || 0); ctx.clip(); }
      ctx.drawImage(src, rx, ry, rw, rh);
      if (!this._ov || this._ov.width !== w || this._ov.height !== h) this._buildOverlay(w, h, p);
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(this._ov, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      const f = p.flash;
      if (f && f[3] > 0.001) {
        ctx.fillStyle = `rgba(${f[0] * 255 | 0},${f[1] * 255 | 0},${f[2] * 255 | 0},${f[3]})`;
        ctx.fillRect(rx, ry, rw, rh);
      }
      ctx.restore();
      return true;
    }
    _buildOverlay(w, h, p) {
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const c = cv.getContext('2d');
      c.fillStyle = '#fff'; c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(0,0,0,0.14)';
      const lines = p.lines || 300;
      for (let y = 0; y < h; y += h / lines) c.fillRect(0, y, w, Math.max(1, h / lines * 0.5));
      const g = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.72);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(40,40,40,1)');
      c.globalCompositeOperation = 'multiply';
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      this._ov = cv;
    }
  }

  function makePost(canvas) {
    const p = new Post(canvas);
    if (p.ok) return p;
    return new Post2D(canvas);
  }

  /* ---- the look, in one place ------------------------------------------- */
  const LOOK = {
    k1: 0.52, k2: 0.20,      // a proper wide-angle bow, not a hint of one
    chroma: 1.35,            // measured in panel pixels, so it survives snapping
    scan: 0.5,
    grain: 0.05,
    vignette: 0.8,
    bloom: 0.22,
    gain: 1.03,
    sat: 0.78,
    panel: 432,      // the display's horizontal pixel count
    grille: 0.5,
    lines: 240,
  };

  NS.post = { Post, Post2D, makePost, LOOK, VERT, FRAG, setUniforms };
})(window.PM = window.PM || {});
