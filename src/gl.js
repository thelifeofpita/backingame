/* ============================================================================
   BACK IN SMOOTHLY — WebGL scene
   The car park, drawn with an actual depth buffer. The 2D painter's renderer
   in draw.js could not sort a two-thousand-triangle car against itself, which
   is why every face used to show; here the hardware decides what is in front.
   Scene renders into a framebuffer, the lens shader turns that into the
   dashboard display, and both live in one context so nothing is copied.
   ========================================================================== */
(function (NS) {
  'use strict';
  const C = NS.core;
  const { clamp, lerp } = C;
  const W = NS.world;

  /* ---- matrices (column-major, as WebGL wants) --------------------------- */
  function mat4() { return new Float32Array(16); }
  function ident(m) { m.fill(0); m[0] = m[5] = m[10] = m[15] = 1; return m; }
  /* +z is forward here, matching core.Camera's view basis */
  function perspective(out, fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2);
    out.fill(0);
    out[0] = f / aspect; out[5] = f;
    out[10] = (far + near) / (far - near);
    out[11] = 1;
    out[14] = (-2 * far * near) / (far - near);
    return out;
  }
  function viewFromCamera(out, cam) {
    const m = cam._m, p = cam.pos;
    const r = { x: m[0], y: m[1], z: m[2] };
    const u = { x: m[3], y: m[4], z: m[5] };
    const f = { x: m[6], y: m[7], z: m[8] };
    out[0] = r.x; out[4] = r.y; out[8] = r.z; out[12] = -(r.x * p.x + r.y * p.y + r.z * p.z);
    out[1] = u.x; out[5] = u.y; out[9] = u.z; out[13] = -(u.x * p.x + u.y * p.y + u.z * p.z);
    out[2] = f.x; out[6] = f.y; out[10] = f.z; out[14] = -(f.x * p.x + f.y * p.y + f.z * p.z);
    out[3] = 0; out[7] = 0; out[11] = 0; out[15] = 1;
    return out;
  }
  function mul(out, a, b) {
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
        out[c * 4 + r] = s;
      }
    }
    return out;
  }
  function trs(out, x, y, z, yaw, s) {
    const c = Math.cos(yaw), si = Math.sin(yaw);
    out[0] = c * s; out[1] = 0; out[2] = -si * s; out[3] = 0;
    out[4] = 0; out[5] = s; out[6] = 0; out[7] = 0;
    out[8] = si * s; out[9] = 0; out[10] = c * s; out[11] = 0;
    out[12] = x; out[13] = y; out[14] = z; out[15] = 1;
    return out;
  }

  /* ---- shaders ----------------------------------------------------------- */
  const SOLID_VS = `
    attribute vec3 aPos;
    attribute vec3 aCol;
    attribute float aFlag;
    uniform mat4 uVP, uM;
    uniform vec3 uTint;
    uniform float uClip;
    varying vec3 vCol, vW;
    varying float vFlag;
    void main(){
      vec4 w = uM * vec4(aPos, 1.0);
      vW = w.xyz;
      vFlag = aFlag;
      vCol = (aFlag >= 0.5 && aFlag < 1.5) ? uTint : aCol;
      gl_Position = (uClip > 0.5) ? vec4(aPos.xy, 0.0, 1.0) : uVP * w;
    }`;

  const LIGHT = `
    uniform vec3 uCam;
    uniform vec2 uLightZ;
    uniform vec2 uLightWarm;
    uniform vec3 uFog;
    uniform float uFogK, uCeil;
    vec3 tubes(vec3 p, vec3 n){
      vec3 sum = vec3(0.0);
      for (int i = 0; i < 2; i++) {
        float lz = (i == 0) ? uLightZ.x : uLightZ.y;
        float wm = (i == 0) ? uLightWarm.x : uLightWarm.y;
        vec3 d = vec3(0.0, uCeil - p.y, lz - p.z);   // nearest point on the tube
        float r = length(d);
        float att = 1.0 / (1.0 + r * r * 0.16);
        float nl = max(dot(n, normalize(d)), 0.0);
        sum += vec3(1.0 + wm * 0.06, 1.0, 1.0 - wm * 0.08) * att * (0.25 + 0.75 * nl);
      }
      return sum;
    }`;

  const SOLID_FS = `
    #extension GL_OES_standard_derivatives : enable
    precision highp float;
    varying vec3 vCol, vW;
    varying float vFlag;
    ${LIGHT}
    void main(){
      vec3 col = vCol;
      if (vFlag < 3.5) {
        /* Flat normal from the derivatives, turned to face the viewer. We are
           standing inside this room, so the wall's outward normal is the wrong
           one; orienting to the eye makes winding irrelevant everywhere. */
        vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
        if (dot(n, uCam - vW) < 0.0) n = -n;
        vec3 key = normalize(vec3(0.28, 0.92, 0.27));
        float nl = max(dot(n, key), 0.0);
        vec3 lit = vec3(0.40) + vec3(0.30) * nl + tubes(vW, n) * 0.95;
        col *= lit;
      }
      float d = length(vW - uCam);
      col = mix(col, uFog, 1.0 - exp(-max(0.0, d - 1.2) * uFogK));
      gl_FragColor = vec4(col, 1.0);
    }`;

  const TEX_VS = `
    attribute vec3 aPos;
    attribute vec2 aUv;
    uniform mat4 uVP, uM;
    varying vec2 vUv;
    varying vec3 vW;
    void main(){
      vec4 w = uM * vec4(aPos, 1.0);
      vW = w.xyz; vUv = aUv;
      gl_Position = uVP * w;
    }`;

  const TEX_FS = `
    precision highp float;
    varying vec2 vUv;
    varying vec3 vW;
    uniform sampler2D uTex;
    uniform vec3 uCam, uFog;
    uniform float uFogK, uAlpha, uShade;
    void main(){
      vec4 t = texture2D(uTex, vUv);
      if (t.a < 0.02) discard;
      vec3 col = t.rgb * uShade;
      float d = length(vW - uCam);
      col = mix(col, uFog, (1.0 - exp(-max(0.0, d - 1.2) * uFogK)) * 0.5);
      gl_FragColor = vec4(col, t.a * uAlpha);
    }`;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('[gl]', gl.getShaderInfoLog(s));
      gl.deleteShader(s); return null;
    }
    return s;
  }
  function program(gl, vs, fs, attrs) {
    const v = compile(gl, gl.VERTEX_SHADER, vs), f = compile(gl, gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    const p = gl.createProgram();
    gl.attachShader(p, v); gl.attachShader(p, f);
    attrs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.warn('[gl]', gl.getProgramInfoLog(p)); return null; }
    p.u = new Proxy({}, { get: (c, k) => (k in c ? c[k] : (c[k] = gl.getUniformLocation(p, k))) });
    return p;
  }

  /* ---- a growable triangle sink in the solid vertex format --------------- */
  class Mesh {
    constructor() { this.pos = []; this.col = []; this.flag = []; }
    tri(a, b, c, col, flag) {
      for (const p of [a, b, c]) {
        this.pos.push(p.x, p.y, p.z);
        this.col.push(col[0], col[1], col[2]);
        this.flag.push(flag || 0);
      }
    }
    quad(a, b, c, d, col, flag) { this.tri(a, b, c, col, flag); this.tri(a, c, d, col, flag); }
    box(cx, cy, cz, hx, hy, hz, yaw, col, colTop, flag) {
      const s = Math.sin(yaw || 0), co = Math.cos(yaw || 0);
      const V = (f, u, r) => ({ x: cx + s * f + co * r, y: cy + u, z: cz + co * f - s * r });
      const A = V(-hz, -hy, -hx), B = V(hz, -hy, -hx), Cc = V(hz, -hy, hx), D = V(-hz, -hy, hx);
      const E = V(-hz, hy, -hx), F = V(hz, hy, -hx), G = V(hz, hy, hx), H = V(-hz, hy, hx);
      this.quad(E, F, G, H, colTop || col, flag);
      this.quad(B, Cc, G, F, col, flag);
      this.quad(D, A, E, H, col, flag);
      this.quad(A, B, F, E, col, flag);
      this.quad(Cc, D, H, G, col, flag);
      this.quad(D, Cc, B, A, col, flag);
    }
    get count() { return this.pos.length / 3; }
    upload(gl, target) {
      target = target || {};
      const n = this.count;
      target.n = n;
      const put = (buf, arr, Type) => {
        const b = buf || gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, new Type(arr), gl.STATIC_DRAW);
        return b;
      };
      target.pos = put(target.pos, this.pos, Float32Array);
      target.col = put(target.col, this.col, Uint8Array);
      target.flag = put(target.flag, this.flag, Uint8Array);
      return target;
    }
  }

  const FLAG = { LIT: 0, TINT: 1, WHEEL: 2, UNLIT: 4 };

  /* ======================================================================== */
  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ok = false;
      const opts = { alpha: true, premultipliedAlpha: false, antialias: false, depth: false,
        stencil: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' };
      const gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
      if (!gl) return;
      this.gl = gl;
      this.deriv = gl.getExtension('OES_standard_derivatives');
      if (!this.deriv) return;                    // flat shading needs them
      this.solid = program(gl, SOLID_VS, SOLID_FS, ['aPos', 'aCol', 'aFlag']);
      this.tex = program(gl, TEX_VS, TEX_FS, ['aPos', 'aUv']);
      this.post = program(gl, NS.post.VERT, NS.post.FRAG, ['aPos']);
      if (!this.solid || !this.tex || !this.post) return;

      this.quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

      this.vp = mat4(); this.proj = mat4(); this.view = mat4(); this.model = ident(mat4());
      this.level = null; this.levelBuf = null;
      this.guideBuf = null; this.guideMesh = new Mesh();
      this.models = {};
      this.textures = {};
      this.fbo = null;
      this.ok = true;
      canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.ok = false; });
    }

    /* ---- framebuffer the scene is drawn into --------------------------- */
    resizeTarget(w, h) {
      const gl = this.gl;
      if (this.fbo && this.fbw === w && this.fbh === h) return;
      this.fbw = w; this.fbh = h;
      if (!this.fbo) {
        this.fbo = gl.createFramebuffer();
        this.fbTex = gl.createTexture();
        this.fbDepth = gl.createRenderbuffer();
      }
      gl.bindTexture(gl.TEXTURE_2D, this.fbTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.fbDepth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fbTex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.fbDepth);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /* ---- car models, unpacked from the baked buffers -------------------- */
    loadModels() {
      const defs = window.PM_MODELS || {};
      const gl = this.gl;
      for (const name in defs) {
        const d = defs[name];
        const raw = atob(d.data);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        const nv = d.verts;
        let o = 0;
        const qpos = new Int16Array(bytes.buffer, o, nv * 3); o += nv * 6;
        const col = new Uint8Array(bytes.buffer, o, nv * 3); o += nv * 3;
        const flag = new Uint8Array(bytes.buffer, o, nv); o += nv;
        if (o % 2) o++;
        const idx = new Uint16Array(bytes.buffer.slice(o), 0, d.tris * 3);
        // de-quantise into world units: Kenney's cars are chunky, so the whole
        // car park is built to their proportions rather than the other way round
        const s = (d.half / 32000) * W.CAR.modelScale;
        const lift = (d.size[1] / 2) * W.CAR.modelScale;   // sit it on the floor
        const pos = new Float32Array(nv * 3);
        for (let i = 0; i < nv; i++) {
          pos[i * 3] = qpos[i * 3] * s;
          pos[i * 3 + 1] = qpos[i * 3 + 1] * s + lift;
          pos[i * 3 + 2] = qpos[i * 3 + 2] * s;
        }
        const mk = (arr, Type, tgt) => {
          const b = gl.createBuffer();
          gl.bindBuffer(tgt || gl.ARRAY_BUFFER, b);
          gl.bufferData(tgt || gl.ARRAY_BUFFER, new Type(arr), gl.STATIC_DRAW);
          return b;
        };
        this.models[name] = {
          pos: mk(pos, Float32Array), col: mk(col, Uint8Array), flag: mk(flag, Uint8Array),
          idx: mk(idx, Uint16Array, gl.ELEMENT_ARRAY_BUFFER), n: d.tris * 3,
        };
      }
      this.modelNames = Object.keys(this.models);
    }

    texture(key, source) {
      const gl = this.gl;
      let t = this.textures[key];
      if (t) return t;
      t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const pot = (v) => (v & (v - 1)) === 0;
      const w = source.width, h = source.height;
      if (pot(w) && pot(h)) {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.generateMipmap(gl.TEXTURE_2D);
      } else {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      this.textures[key] = t;
      return t;
    }

    /* ---- the car park itself, built once per level ---------------------- */
    setLevel(L) {
      this.level = L;
      const g = L.geo, m = new Mesh();
      const P = NS.draw.PAL;
      const CONCRETE = [128, 130, 128], CONCRETE_HI = [146, 148, 145];
      const FLOOR = [104, 106, 106], CEIL = [78, 80, 82], DARK = [70, 71, 70];
      const V = (x, y, z) => ({ x, y, z });

      // poster wall, split so the top half catches more of the tubes
      m.quad(V(g.xMin, 0, 0), V(g.xMax, 0, 0), V(g.xMax, 1.6, 0), V(g.xMin, 1.6, 0), CONCRETE);
      m.quad(V(g.xMin, 1.6, 0), V(g.xMax, 1.6, 0), V(g.xMax, g.ceilY, 0), V(g.xMin, g.ceilY, 0), CONCRETE_HI);
      m.quad(V(g.xMin, 0, 0.004), V(g.xMax, 0, 0.004), V(g.xMax, 0.34, 0.004), V(g.xMin, 0.34, 0.004), DARK);
      // side and far walls
      m.quad(V(g.xMin, 0, 0), V(g.xMin, 0, g.laneZ1), V(g.xMin, g.ceilY, g.laneZ1), V(g.xMin, g.ceilY, 0), [96, 98, 98]);
      m.quad(V(g.xMax, 0, g.laneZ1), V(g.xMax, 0, 0), V(g.xMax, g.ceilY, 0), V(g.xMax, g.ceilY, g.laneZ1), [96, 98, 98]);
      m.quad(V(g.xMax, 0, g.laneZ1), V(g.xMin, 0, g.laneZ1), V(g.xMin, g.ceilY, g.laneZ1), V(g.xMax, g.ceilY, g.laneZ1), [88, 90, 90]);
      // ceiling and floor
      m.quad(V(g.xMin, g.ceilY, g.laneZ1), V(g.xMax, g.ceilY, g.laneZ1), V(g.xMax, g.ceilY, 0), V(g.xMin, g.ceilY, 0), CEIL);
      m.quad(V(g.xMin, 0, 0), V(g.xMin, 0, g.laneZ1), V(g.xMax, 0, g.laneZ1), V(g.xMax, 0, 0), FLOOR);

      // strip lights
      for (const ln of L.lights) {
        m.box((g.xMin + g.xMax) / 2, g.ceilY - 0.06, ln.z, (g.xMax - g.xMin) / 2, 0.06, 0.26, 0, [34, 36, 38], [34, 36, 38]);
        for (let x = ln.x0 + ln.phase; x < ln.x1; x += ln.gap) {
          m.quad(V(x, g.ceilY - 0.115, ln.z - 0.09), V(x + 1.5, g.ceilY - 0.115, ln.z - 0.09),
            V(x + 1.5, g.ceilY - 0.115, ln.z + 0.09), V(x, g.ceilY - 0.115, ln.z + 0.09),
            [250, 252, 246], null, FLAG.UNLIT);
        }
      }

      // bay lines, wheel stops, pillars
      const stripe = (x0, z0, x1, z1, w, col, y) => {
        const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1;
        const nx = (-dz / l) * w * 0.5, nz = (dx / l) * w * 0.5;
        m.quad(V(x0 - nx, y || 0.006, z0 - nz), V(x1 - nx, y || 0.006, z1 - nz),
          V(x1 + nx, y || 0.006, z1 + nz), V(x0 + nx, y || 0.006, z0 + nz), col, FLAG.UNLIT);
      };
      for (let k = g.bayMin; k <= g.bayMax + 1; k++) {
        const x = W.bayCenterX(k) - g.bayW / 2;
        stripe(x, g.stopZ - 0.5, x, g.laneZ0, 0.10, [150, 150, 143]);
      }
      stripe(g.xMin, g.laneZ0, g.xMax, g.laneZ0, 0.10, [150, 150, 143]);
      for (let k = g.bayMin; k <= g.bayMax; k++) {
        const cx = W.bayCenterX(k);
        m.box(cx, 0.065, g.stopZ, g.bayW * 0.34, 0.065, 0.09, 0, [112, 112, 106], [138, 138, 130]);
      }
      for (const p of L.pillars) {
        m.box(p.x, 1.43, p.z, p.w / 2, 1.43, p.d / 2, 0, [104, 106, 104], [92, 94, 92]);
        m.box(p.x, 1.05, p.z, p.w / 2 + 0.006, 0.16, p.d / 2 + 0.006, 0, P.yellowRGB, P.yellowRGB);
      }
      // oil, scuffs and damp: a car park floor is never clean
      for (const mk of L.floorMarks) {
        const a = clamp(mk.a * 2.6, 0, 0.42);
        const col = [lerp(FLOOR[0], 44, a), lerp(FLOOR[1], 44, a), lerp(FLOOR[2], 42, a)];
        m.quad(V(mk.x - mk.w / 2, 0.002, mk.z - mk.d / 2), V(mk.x + mk.w / 2, 0.002, mk.z - mk.d / 2),
          V(mk.x + mk.w / 2, 0.002, mk.z + mk.d / 2), V(mk.x - mk.w / 2, 0.002, mk.z + mk.d / 2), col);
      }
      for (const sk of L.skids) {
        const dx = Math.sin(sk.rot) * sk.len, dz = Math.cos(sk.rot) * sk.len;
        const a = clamp(sk.a * 4, 0, 0.55);
        const col = [lerp(FLOOR[0], 34, a), lerp(FLOOR[1], 34, a), lerp(FLOOR[2], 34, a)];
        m.quad(V(sk.x - 0.07, 0.003, sk.z), V(sk.x + 0.07, 0.003, sk.z),
          V(sk.x + dx + 0.07, 0.003, sk.z + dz), V(sk.x + dx - 0.07, 0.003, sk.z + dz), col);
      }
      for (const st of L.stains) {
        // nothing directly behind the poster: it reads as a mounting board
        if (Math.abs(st.x - L.poster.cx) < 1.4 && Math.abs(st.y - L.poster.cy) < 1.2) continue;
        const a = clamp(st.a * 1.5, 0, 0.24);
        const base = st.dark ? [40, 42, 42] : [190, 190, 182];
        const col = [lerp(CONCRETE[0], base[0], a), lerp(CONCRETE[1], base[1], a), lerp(CONCRETE[2], base[2], a)];
        m.quad(V(st.x - st.w / 2, st.y - st.h / 2, 0.002), V(st.x + st.w / 2, st.y - st.h / 2, 0.002),
          V(st.x + st.w / 2, st.y + st.h / 2, 0.002), V(st.x - st.w / 2, st.y + st.h / 2, 0.002), col);
      }

      // the accessible bay, and the wall fixtures
      const F = L.fixtures;
      if (F) {
        const ax = W.bayCenterX(F.accessibleK);
        m.quad(V(ax - g.bayW * 0.36, 0.005, g.stopZ), V(ax + g.bayW * 0.36, 0.005, g.stopZ),
          V(ax + g.bayW * 0.36, 0.005, g.laneZ0 - 0.4), V(ax - g.bayW * 0.36, 0.005, g.laneZ0 - 0.4),
          [38, 86, 168], null, FLAG.UNLIT);
        m.box(F.exit.x, F.exit.y, 0.11, 0.31, 0.12, 0.05, 0, [22, 120, 46], [30, 168, 62]);
        m.box(F.hose.x, F.hose.y, 0.09, 0.21, 0.31, 0.09, 0, [150, 38, 30], [168, 42, 34]);
      }

      this.levelBuf = m.upload(this.gl, this.levelBuf);
    }

    /* ---- per-frame ------------------------------------------------------- */
    bindSolid(buf) {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.pos);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.col);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.UNSIGNED_BYTE, true, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.flag);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.UNSIGNED_BYTE, false, 0, 0);
    }

    renderScene(cam, st, t, opts) {
      const gl = this.gl, L = this.level;
      opts = opts || {};
      this.resizeTarget(cam.w, cam.h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.viewport(0, 0, cam.w, cam.h);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.BLEND);
      gl.disable(gl.CULL_FACE);      // depth decides; winding never has to
      const F = NS.draw.PAL.fog;
      gl.clearColor(F[0] / 255, F[1] / 255, F[2] / 255, 1);
      gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      const aspect = cam.w / cam.h;
      const fovY = 2 * Math.atan(Math.tan(cam.fov / 2) / aspect);
      perspective(this.proj, fovY, aspect, 0.06, 60);
      viewFromCamera(this.view, cam);
      mul(this.vp, this.proj, this.view);

      const p = this.solid;
      gl.useProgram(p);
      gl.uniformMatrix4fv(p.u.uVP, false, this.vp);
      gl.uniform3f(p.u.uCam, cam.pos.x, cam.pos.y, cam.pos.z);
      gl.uniform3f(p.u.uFog, F[0] / 255, F[1] / 255, F[2] / 255);
      gl.uniform1f(p.u.uFogK, 0.105);
      gl.uniform1f(p.u.uCeil, L.geo.ceilY);
      gl.uniform2f(p.u.uLightZ, L.lights[0].z, L.lights[1].z);
      gl.uniform2f(p.u.uLightWarm, L.lights[0].warm || 0, L.lights[1].warm || 0);
      gl.uniform1f(p.u.uClip, 0);

      // the car park
      gl.uniformMatrix4fv(p.u.uM, false, ident(this.model));
      gl.uniform3f(p.u.uTint, 1, 1, 1);
      this.bindSolid(this.levelBuf);
      gl.drawArrays(gl.TRIANGLES, 0, this.levelBuf.n);

      // the neighbours
      const mm = mat4();
      for (const car of L.cars) {
        const mdl = this.models[car.model] || this.models[this.modelNames[0]];
        if (!mdl) continue;
        /* A pose is the rear axle everywhere in the simulation, but a baked
           model is centred on its own bounding box. Shift it forward by the
           difference or every parked car sits a metre out of its bay — over
           the wheel stop one way round, into the aisle the other. */
        const cf = (car.len || W.CAR.len) * 0.5 - W.CAR.rearOverhang;
        trs(mm, car.x + Math.sin(car.heading) * cf, 0, car.z + Math.cos(car.heading) * cf, car.heading, 1);
        gl.uniformMatrix4fv(p.u.uM, false, mm);
        gl.uniform3f(p.u.uTint, car.paint.body[0] / 255, car.paint.body[1] / 255, car.paint.body[2] / 255);
        this.bindSolid(mdl);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mdl.idx);
        gl.drawElements(gl.TRIANGLES, mdl.n, gl.UNSIGNED_SHORT, 0);
      }

      // the poster, and anything else printed on the wall
      this.drawDecals(cam, L, opts);

      /* Bumper first, overlay second: a reversing camera paints its guides on
         top of the whole picture, including the car's own bodywork. */
      if (opts.bumper !== false) this.drawBumper();
      if (opts.guides !== false && st && st.phase === 'drive') this.drawGuides(cam, st);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    drawDecals(cam, L, opts) {
      const gl = this.gl, p = this.tex;
      const ad = NS.draw.ads[L.poster.index % Math.max(1, NS.draw.ads.length)];
      if (!ad) return;
      gl.useProgram(p);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniformMatrix4fv(p.u.uVP, false, this.vp);
      gl.uniformMatrix4fv(p.u.uM, false, ident(this.model));
      const F = NS.draw.PAL.fog;
      gl.uniform3f(p.u.uCam, cam.pos.x, cam.pos.y, cam.pos.z);
      gl.uniform3f(p.u.uFog, F[0] / 255, F[1] / 255, F[2] / 255);
      gl.uniform1f(p.u.uFogK, 0.105);
      gl.uniform1i(p.u.uTex, 0);
      gl.activeTexture(gl.TEXTURE0);

      const po = L.poster, h = po.h, w = h * ad.ar;
      const cr = Math.cos(po.rot), sr = Math.sin(po.rot);
      const corner = (u, v) => {
        const lx = (0.5 - u) * w, ly = (0.5 - v) * h;
        return {
          x: po.cx + lx * cr - ly * sr,
          y: po.cy + lx * sr + ly * cr,
          z: 0.012,
        };
      };
      const pts = [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)];
      const uv = [0, 0, 1, 0, 1, 1, 0, 1];
      // its shadow first, offset onto the concrete
      gl.bindTexture(gl.TEXTURE_2D, this.texture('shadow' + ad.id, ad.potShadow || ad.shadow));
      gl.uniform1f(p.u.uAlpha, 1);
      gl.uniform1f(p.u.uShade, 1);
      this.quadTex(pts.map((q) => ({ x: q.x + 0.03, y: q.y - 0.035, z: 0.008 })), uv);
      gl.bindTexture(gl.TEXTURE_2D, this.texture('ad' + ad.id, ad.pot || ad.img));
      gl.uniform1f(p.u.uShade, 0.94);
      this.quadTex(pts, uv);

      // signage
      const sign = NS.draw.signAtlas && NS.draw.signAtlas(L);
      if (sign) {
        gl.bindTexture(gl.TEXTURE_2D, this.texture('signs' + L.seed, sign.canvas));
        gl.uniform1f(p.u.uShade, 1);
        for (const q of sign.quads) this.quadTex(q.pts, q.uv);
      }
      gl.disable(gl.BLEND);
      void opts;
    }

    quadTex(pts, uv) {
      const gl = this.gl;
      if (!this._qbuf) { this._qbuf = gl.createBuffer(); this._qubuf = gl.createBuffer(); }
      const P = new Float32Array([
        pts[0].x, pts[0].y, pts[0].z, pts[1].x, pts[1].y, pts[1].z, pts[2].x, pts[2].y, pts[2].z,
        pts[0].x, pts[0].y, pts[0].z, pts[2].x, pts[2].y, pts[2].z, pts[3].x, pts[3].y, pts[3].z,
      ]);
      const U = new Float32Array([
        uv[0], uv[1], uv[2], uv[3], uv[4], uv[5],
        uv[0], uv[1], uv[4], uv[5], uv[6], uv[7],
      ]);
      gl.bindBuffer(gl.ARRAY_BUFFER, this._qbuf);
      gl.bufferData(gl.ARRAY_BUFFER, P, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this._qubuf);
      gl.bufferData(gl.ARRAY_BUFFER, U, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
      gl.disableVertexAttribArray(2);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    /* ---- the calibrated overlay ----------------------------------------- */
    drawGuides(cam, st) {
      const gl = this.gl, p = this.solid, m = this.guideMesh;
      m.pos.length = 0; m.col.length = 0; m.flag.length = 0;
      const D = NS.draw;
      const half = W.CAR.wid / 2 + 0.06, backF = -W.CAR.rearOverhang - 0.03;
      const SEG = 16, MAXARC = 2.7, wdt = 0.055;
      const rail = (lr) => {
        const out = [];
        for (let i = 0; i <= SEG; i++) {
          const q = D.guidePoint(st.car, backF, lr, (i / SEG) * MAXARC);
          if (q.z < 0.02 && out.length > 1) break;
          out.push(q);
        }
        return out;
      };
      const ribbon = (pts, colFn) => {
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i], b = pts[i + 1];
          const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
          const nx = (-dz / l) * wdt, nz = (dx / l) * wdt;
          const y = 0.02;
          const col = colFn(i / (pts.length - 1));
          m.quad({ x: a.x - nx, y, z: a.z - nz }, { x: b.x - nx, y, z: b.z - nz },
            { x: b.x + nx, y, z: b.z + nz }, { x: a.x + nx, y, z: a.z + nz }, col, FLAG.UNLIT);
        }
      };
      const split = 1.75 / MAXARC;
      for (const lr of [-half, half]) {
        ribbon(rail(lr), (u) => (u < split ? D.PAL.yellowRGB : D.PAL.greenRGB));
      }
      for (const [arc, col] of [[1.05, D.PAL.yellowRGB], [1.95, D.PAL.greenRGB]]) {
        for (const sgn of [-1, 1]) {
          const a = D.guidePoint(st.car, backF, sgn * half, arc);
          const b = D.guidePoint(st.car, backF, sgn * (half + 0.30), arc);
          if (a.z < 0.02 || b.z < 0.02) continue;
          ribbon([a, b], () => col);
        }
      }
      const barArc = 0.44;
      const bl = D.guidePoint(st.car, backF, -half, barArc), br = D.guidePoint(st.car, backF, half, barArc);
      const blu = D.guidePoint(st.car, backF, -half, barArc - 0.30), bru = D.guidePoint(st.car, backF, half, barArc - 0.30);
      ribbon([blu, bl, br, bru], () => D.PAL.redRGB);

      this.guideBuf = m.upload(gl, this.guideBuf);
      gl.useProgram(p);
      gl.uniform1f(p.u.uClip, 0);
      gl.uniformMatrix4fv(p.u.uM, false, ident(this.model));
      gl.disable(gl.DEPTH_TEST);
      this.bindSolid(this.guideBuf);
      gl.drawArrays(gl.TRIANGLES, 0, this.guideBuf.n);
      gl.enable(gl.DEPTH_TEST);
    }

    /* ---- the car's own bumper, bolted to the lens ------------------------ */
    drawBumper() {
      const gl = this.gl, p = this.solid;
      if (!this.bumperBuf) {
        const m = new Mesh();
        const N = 24, top = -0.80, dip = 0.085;
        for (let i = 0; i < N; i++) {
          const x0 = -1.1 + (2.2 * i) / N, x1 = -1.1 + (2.2 * (i + 1)) / N;
          const y0 = top + dip * (x0 * x0), y1 = top + dip * (x1 * x1);
          const shade = [46, 48, 52];
          m.quad({ x: x0, y: y0, z: 0 }, { x: x1, y: y1, z: 0 },
            { x: x1, y: -1.2, z: 0 }, { x: x0, y: -1.2, z: 0 }, shade, FLAG.UNLIT);
          m.quad({ x: x0, y: y0 + 0.012, z: 0 }, { x: x1, y: y1 + 0.012, z: 0 },
            { x: x1, y: y1, z: 0 }, { x: x0, y: y0, z: 0 }, [126, 132, 140], FLAG.UNLIT);
        }
        this.bumperBuf = m.upload(gl, null);
      }
      gl.useProgram(p);
      gl.uniform1f(p.u.uClip, 1);
      gl.disable(gl.DEPTH_TEST);
      this.bindSolid(this.bumperBuf);
      gl.drawArrays(gl.TRIANGLES, 0, this.bumperBuf.n);
      gl.uniform1f(p.u.uClip, 0);
      gl.enable(gl.DEPTH_TEST);
    }

    /* ---- the lens, and the panel it is shown on -------------------------- */
    present(params) {
      const gl = this.gl, cv = this.canvas;
      const w = cv.width, h = cv.height;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const p = this.post;
      gl.useProgram(p);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.disableVertexAttribArray(1); gl.disableVertexAttribArray(2);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.fbTex);
      gl.uniform1i(p.u.uTex, 0);
      NS.post.setUniforms(gl, p, params, w, h, this.fbw, this.fbh);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  NS.gl = { Renderer, Mesh, FLAG };
})(window.PM = window.PM || {});
