/* ============================================================================
   BACK IN SMOOTHLY — simulation
   A reverse-only kinematic bicycle model, collision, and the rules of a park.
   step() is a pure function of (state, dt, input): feed it the same seed and
   the same inputs and you get the same run, on a phone or in an offline
   render. The export studio depends on that.
   ========================================================================== */
(function (NS) {
  'use strict';
  const { clamp, lerp, damp, norm, makeRng } = NS.core;
  const W = NS.world;

  const TUNE = {
    creep: 1.42,          // m/s — an automatic idling backwards
    accel: 2.6,
    brakeRate: 5.4,
    maxSteerAngle: 0.62,  // rad at the front wheels (~35°)
    steerRate: 2.9,       // rad/s of wheel movement
    timeLimit: 19.0,      // s — a round always fits inside twenty seconds
    holdToPark: 0.42,     // s stationary in the box before it counts
    stopSpeed: 0.10,
    wallCrash: 0.50,      // past the wheel stop is a crunch
    idealGap: 1.10,       // resting on the wheel stop — and where the poster frames
    gapMin: 0.72,
    gapMax: 1.95,
  };

  /* ---- geometry helpers -------------------------------------------------- */
  function obb(x, z, heading, halfLen, halfWid, cf) {
    // cf = forward offset of the box centre from the pose point
    const s = Math.sin(heading), c = Math.cos(heading);
    const pts = [];
    for (const [f, r] of [[-halfLen, -halfWid], [halfLen, -halfWid], [halfLen, halfWid], [-halfLen, halfWid]]) {
      const ff = f + cf;
      pts.push({ x: x + s * ff + c * r, z: z + c * ff - s * r });
    }
    return pts;
  }
  function carBox(x, z, heading, shrink) {
    const sh = shrink || 0;
    const halfLen = (W.CAR.rearOverhang + W.CAR.wheelbase + W.CAR.frontOverhang) * 0.5 - sh;
    const cf = (W.CAR.wheelbase + W.CAR.frontOverhang - W.CAR.rearOverhang) * 0.5;
    return obb(x, z, heading, halfLen, W.CAR.wid * 0.5 - sh, cf);
  }
  function axes(poly) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ex = b.x - a.x, ez = b.z - a.z;
      const l = Math.hypot(ex, ez) || 1;
      out.push({ x: -ez / l, z: ex / l });
    }
    return out;
  }
  function overlapSAT(A, B) {
    const ax = axes(A).concat(axes(B));
    for (const n of ax) {
      let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
      for (const p of A) { const d = p.x * n.x + p.z * n.z; if (d < amin) amin = d; if (d > amax) amax = d; }
      for (const p of B) { const d = p.x * n.x + p.z * n.z; if (d < bmin) bmin = d; if (d > bmax) bmax = d; }
      if (amax < bmin || bmax < amin) return false;
    }
    return true;
  }
  function segDist(p1, p2, p3, p4) {
    const d = (a, b, c) => { // point c to segment ab
      const abx = b.x - a.x, abz = b.z - a.z;
      const t = clamp(((c.x - a.x) * abx + (c.z - a.z) * abz) / (abx * abx + abz * abz || 1), 0, 1);
      return Math.hypot(a.x + abx * t - c.x, a.z + abz * t - c.z);
    };
    // segments cross?
    const o = (a, b, c) => Math.sign((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
    if (o(p1, p2, p3) !== o(p1, p2, p4) && o(p3, p4, p1) !== o(p3, p4, p2)) return 0;
    return Math.min(d(p1, p2, p3), d(p1, p2, p4), d(p3, p4, p1), d(p3, p4, p2));
  }
  function polyDist(A, B) {
    let m = Infinity;
    for (let i = 0; i < A.length; i++) {
      const a1 = A[i], a2 = A[(i + 1) % A.length];
      for (let j = 0; j < B.length; j++) {
        const b1 = B[j], b2 = B[(j + 1) % B.length];
        const d = segDist(a1, a2, b1, b2);
        if (d < m) m = d;
      }
    }
    return m;
  }

  /* ---- obstacle list ----------------------------------------------------- */
  function buildObstacles(level) {
    const obs = [];
    for (const c of level.cars) obs.push({ kind: 'car', poly: carBox(c.x, c.z, c.heading, 0.015), ref: c });
    for (const p of level.pillars) {
      obs.push({ kind: 'pillar', poly: obb(p.x, p.z, 0, p.d * 0.5, p.w * 0.5, 0), ref: p });
    }
    return obs;
  }

  /* ======================================================================== */
  function create(level, opts) {
    opts = opts || {};
    const s = {
      level,
      obstacles: buildObstacles(level),
      t: 0,
      phase: 'drive',      // drive | won | lost
      reason: null,
      car: {
        x: level.start.x, z: level.start.z, h: level.start.heading,
        v: 0, steer: 0, steerCmd: 0,
      },
      parkHold: 0,
      timeLeft: TUNE.timeLimit,
      proximity: 9,        // metres to whatever is behind
      inBox: false,
      aligned: false,
      events: [],          // {type,t,...} — drives sound and shake
      steerWork: 0,        // integrated wheel movement, for the smoothness score
      travelled: 0,
      score: 0,
      detail: null,
      impact: 0,
      seedTag: level.seed,
      rng: makeRng((level.seed ^ 0x9e3779b9) >>> 0),
    };
    return s;
  }

  function rearBumperSeg(car) {
    const a = W.local2world(car.x, car.z, car.h, -W.CAR.rearOverhang, -W.CAR.wid * 0.5);
    const b = W.local2world(car.x, car.z, car.h, -W.CAR.rearOverhang, W.CAR.wid * 0.5);
    return [a, b];
  }

  function measure(s) {
    const L = s.level, c = s.car;
    const box = carBox(c.x, c.z, c.h, 0);
    const bump = rearBumperSeg(c);

    // distance behind: the wall plus every obstacle
    let prox = Math.min(bump[0].z, bump[1].z);
    for (const o of s.obstacles) {
      const d = polyDist(box, o.poly);
      if (d < prox) prox = d;
    }
    s.proximity = Math.max(0, prox);

    /* Inside the bay. A 4.3 m car in a 2.6 m bay is unforgiving: five degrees
       of skew throws the nose a third of a metre sideways, so the tolerance
       here and the heading tolerance below have to agree with each other. */
    const t = L.target, tol = 0.13;
    let inBox = true;
    for (const p of box) {
      if (p.x < t.cx - t.halfW - tol || p.x > t.cx + t.halfW + tol) { inBox = false; break; }
      if (p.z < 0.02 || p.z > t.z1 + 0.5) { inBox = false; break; }
    }
    s.inBox = inBox;
    s.headingErr = norm(c.h);          // parked square = nose out, heading 0
    s.lateralErr = c.x - t.cx;
    s.wallGap = Math.min(bump[0].z, bump[1].z);
    s.aligned = Math.abs(s.headingErr) < 0.175 && Math.abs(s.lateralErr) < 0.34;
    return box;
  }

  function step(s, dt, input) {
    if (s.phase !== 'drive') { s.t += dt; return s; }
    dt = Math.min(dt, 1 / 30);
    const c = s.car, L = s.level;
    const steerIn = clamp(input.steer || 0, -1, 1);
    const brake = clamp(input.brake || 0, 0, 1);

    // Wheel follows the tilt at a human rate. Tilt right = the boot goes right
    // on screen, which is what the guide lines show you.
    const cmd = -steerIn * TUNE.maxSteerAngle;
    const maxStep = TUNE.steerRate * dt;
    const prev = c.steer;
    c.steer += clamp(cmd - c.steer, -maxStep, maxStep);
    s.steerWork += Math.abs(c.steer - prev);
    c.steerCmd = cmd;

    // Creep backwards unless braked.
    const target = -TUNE.creep * (1 - brake);
    c.v = damp(c.v, target, brake > 0.02 ? TUNE.brakeRate : TUNE.accel, dt);
    if (Math.abs(c.v) < 0.012) c.v = 0;

    // Kinematic bicycle, rear axle reference.
    const ds = c.v * dt;
    c.h = norm(c.h + (ds * Math.tan(c.steer)) / W.CAR.wheelbase);
    c.x += ds * Math.sin(c.h);
    c.z += ds * Math.cos(c.h);
    s.travelled += Math.abs(ds);

    const box = measure(s);

    /* --- collisions --------------------------------------------------- */
    let hit = null;
    if (s.wallGap <= TUNE.wallCrash) hit = 'wall';
    if (!hit) {
      const soft = carBox(c.x, c.z, c.h, 0.02);
      for (const o of s.obstacles) {
        if (overlapSAT(soft, o.poly)) { hit = o.kind; break; }
      }
    }
    if (!hit && (c.x < L.geo.xMin + 1 || c.x > L.geo.xMax - 1 || c.z > L.geo.laneZ1 - 0.9)) hit = 'stray';
    if (hit) {
      s.phase = 'lost';
      s.reason = hit;
      s.impact = clamp(Math.abs(c.v) / TUNE.creep, 0.25, 1);
      c.v = 0;
      s.events.push({ type: 'crash', t: s.t, what: hit, force: s.impact });
      finish(s);
      return s;
    }

    /* --- parked? ------------------------------------------------------- */
    const stopped = Math.abs(c.v) < TUNE.stopSpeed;
    const good = s.inBox && stopped && Math.abs(s.headingErr) < 0.14 &&
                 s.wallGap > TUNE.gapMin && s.wallGap < TUNE.gapMax;
    if (good) {
      s.parkHold += dt;
      if (s.parkHold >= TUNE.holdToPark) {
        s.phase = 'won';
        s.reason = 'parked';
        s.events.push({ type: 'parked', t: s.t });
        finish(s);
        return s;
      }
    } else s.parkHold = 0;

    /* --- clock --------------------------------------------------------- */
    s.t += dt;
    s.timeLeft = Math.max(0, TUNE.timeLimit - s.t);
    if (s.timeLeft <= 0) {
      s.phase = 'lost';
      s.reason = 'time';
      s.events.push({ type: 'timeout', t: s.t });
      finish(s);
    }
    return s;
  }

  /* ---- the smoothness score --------------------------------------------- */
  function finish(s) {
    const t = s.level.target;
    const centring = 1 - clamp(Math.abs(s.lateralErr) / (t.halfW - W.CAR.wid * 0.5 + 0.02), 0, 1);
    const square = 1 - clamp(Math.abs(s.headingErr) / 0.14, 0, 1);
    const gap = 1 - clamp(Math.abs(s.wallGap - TUNE.idealGap) / 0.75, 0, 1);
    // wheel movement per metre travelled: fewer sawing motions = smoother
    const effort = clamp(s.steerWork / Math.max(0.8, s.travelled) / 1.5, 0, 1);
    const flow = 1 - effort;
    const pace = 1 - clamp((s.t - 6) / 12, 0, 1);

    if (s.phase === 'won') {
      const raw = 0.30 * centring + 0.26 * square + 0.16 * gap + 0.18 * flow + 0.10 * pace;
      s.score = Math.round(lerp(62, 100, clamp(raw, 0, 1)));
    } else {
      const raw = 0.4 * flow + 0.3 * pace + 0.3 * clamp(1 - s.proximity / 4, 0, 1);
      s.score = Math.round(lerp(8, 48, clamp(raw, 0, 1)));
    }
    s.detail = { centring, square, gap, flow, pace };
  }

  /* ========================================================================
     Autopilot — for the demo reel. A reverse Stanley controller with a
     deliberately human wrist: a little late, a little wobbly, occasionally
     over-committed, always seeded.
     ====================================================================== */
  function makeDriver(seed) {
    const rng = makeRng((seed ^ 0x5bf03635) >>> 0);
    return {
      rng,
      lag: rng.range(0.06, 0.16),
      wobbleAmp: rng.range(0.04, 0.10),
      wobbleHz: rng.range(0.5, 1.1),
      phase: rng.range(0, 6.283),
      kPsi: rng.range(1.15, 1.65),
      kE: rng.range(0.70, 0.98),
      look: rng.range(0.50, 0.80),
      hesitate: rng.chance(0.4) ? { at: rng.range(1.4, 3.2), dur: rng.range(0.2, 0.5) } : null,
      buf: [],
      lastSteer: 0,
    };
  }

  function drive(s, drv, dt) {
    const c = s.car, t = s.level.target;
    /* Reversing down the bay axis. A cross-track error to the right needs a
       positive heading to unwind it (the boot swings the other way), and a
       heading that is too small needs a negative wheel angle to grow it. */
    const e = c.x - t.cx;
    // the lookahead shortens as the wall closes, so the last metre is straight
    const look = clamp((s.wallGap - 1.05) * drv.look, 0.85, 2.6);
    const hDes = clamp(Math.atan2(drv.kE * e, look), -0.7, 0.7);
    const psi = norm(c.h - hDes);
    let delta = drv.kPsi * psi;
    let steerIn = clamp(-delta / TUNE.maxSteerAngle, -1, 1);

    // human noise
    steerIn += Math.sin(s.t * drv.wobbleHz * 6.283 + drv.phase) * drv.wobbleAmp;
    steerIn = clamp(steerIn, -1, 1);

    // reaction delay
    drv.buf.push(steerIn);
    const delayFrames = Math.max(1, Math.round(drv.lag / dt));
    const delayed = drv.buf.length > delayFrames ? drv.buf.shift() : drv.buf[0];

    // slow down for the last stretch, then stop in the right place
    let brake = 0;
    const stopAt = TUNE.idealGap + drv.rng.range(-0.12, 0.30);
    if (s.wallGap < 2.4) brake = clamp((2.4 - s.wallGap) / 1.4, 0, 1) * 0.5;
    // only commit to stopping once the car is genuinely in the box
    if (s.wallGap < stopAt + 0.30 && s.inBox) brake = 1;
    else if (s.wallGap < TUNE.gapMin + 0.15) brake = 0.9;   // out of the box: crawl
    if (drv.hesitate && s.t > drv.hesitate.at && s.t < drv.hesitate.at + drv.hesitate.dur) brake = 1;

    drv.lastSteer = delayed;
    return { steer: delayed, brake };
  }

  /* ---- offline run: used to vet demo seeds before rendering -------------- */
  function simulateOffline(seed, difficulty, dt, record) {
    const level = NS.world.buildLevel(seed, difficulty);
    const s = create(level);
    const drv = makeDriver(seed);
    const frames = record ? [] : null;
    let guard = 0;
    measure(s);
    while (s.phase === 'drive' && guard++ < 3000) {
      const input = drive(s, drv, dt);
      if (frames) frames.push({ x: s.car.x, z: s.car.z, h: s.car.h, steer: s.car.steer, v: s.car.v, in: input.steer });
      step(s, dt, input);
    }
    return { state: s, level, driver: drv, frames, ok: s.phase === 'won', time: s.t };
  }

  NS.sim = {
    TUNE, create, step, measure, carBox, obb, overlapSAT, polyDist,
    rearBumperSeg, makeDriver, drive, simulateOffline, buildObstacles,
  };
})(window.PM = window.PM || {});
