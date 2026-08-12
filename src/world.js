/* ============================================================================
   BACK IN SMOOTHLY — world
   Seeded generation of an underground car park. Same seed, same car park:
   that is what lets the export studio render a demo run offline, frame by
   frame, and still get exactly what you saw on screen.
   ========================================================================== */
(function (NS) {
  'use strict';
  const { makeRng, clamp, lerp, TAU } = NS.core;

  /* ---- fixed dimensions, in metres --------------------------------------- */
  const CAR = {
    len: 4.34, wid: 1.82, wheelbase: 2.62,
    rearOverhang: 0.82,   // rear axle -> rear bumper
    frontOverhang: 0.90,  // front axle -> nose
    height: 1.46,
    trackHalf: 0.78,
  };
  const GEO = {
    bayW: 2.62, bayD: 5.05,
    wallZ: 0,            // poster wall
    kerbZ: 0.22,         // wheel stop
    laneZ0: 5.05,        // bay mouth
    laneZ1: 11.6,        // far side of the lane
    ceilY: 2.86,
    xMin: -13, xMax: 13,
    bayMin: -4, bayMax: 4,
  };

  const CAR_PAINTS = [
    { name: 'silver',   body: [126, 131, 138], roof: [116, 121, 128] },
    { name: 'graphite', body: [58, 62, 70],    roof: [50, 54, 62] },
    { name: 'white',    body: [186, 189, 192], roof: [176, 180, 184] },
    { name: 'navy',     body: [46, 58, 84],    roof: [40, 51, 75] },
    { name: 'black',    body: [34, 36, 40],    roof: [29, 31, 35] },
    { name: 'sand',     body: [140, 128, 108], roof: [130, 119, 100] },
    { name: 'lilac',    body: [122, 108, 152], roof: [112, 99, 141] }, // house car
    { name: 'rust',     body: [122, 74, 54],   roof: [112, 68, 50] },
  ];

  const bayCenterX = (k) => k * GEO.bayW;

  /* ---- the player's car, as a rigid body --------------------------------- */
  // Pose is the REAR AXLE centre. heading: 0 = nose towards +z.
  function carCorners(x, z, heading, inflate) {
    const s = Math.sin(heading), c = Math.cos(heading);
    const hw = CAR.wid * 0.5 + (inflate || 0);
    const back = -(CAR.rearOverhang + (inflate || 0));
    const front = CAR.wheelbase + CAR.frontOverhang + (inflate || 0);
    const pts = [];
    const lp = [[back, -hw], [front, -hw], [front, hw], [back, hw]];
    for (const [f, r] of lp) pts.push({ x: x + s * f + c * r, z: z + c * f - s * r });
    return pts;
  }
  // local (forward, right) -> world
  function local2world(x, z, heading, f, r) {
    const s = Math.sin(heading), c = Math.cos(heading);
    return { x: x + s * f + c * r, z: z + c * f - s * r };
  }
  function world2local(x, z, heading, px, pz) {
    const s = Math.sin(heading), c = Math.cos(heading);
    const dx = px - x, dz = pz - z;
    return { f: s * dx + c * dz, r: c * dx - s * dz };
  }

  /* ======================================================================== */
  function buildLevel(seed, difficulty) {
    const rng = makeRng(seed);
    const d = clamp(difficulty || 0, 0, 1);

    const targetK = rng.int(-1, 1);
    const targetX = bayCenterX(targetK);

    /* --- neighbours ------------------------------------------------------ */
    const cars = [];
    const occupied = new Set([targetK]);
    // the two flanking bays are what makes it a manoeuvre; keep at least one
    const flanks = [targetK - 1, targetK + 1];
    let flankCount = 0;
    for (const k of flanks) {
      const keep = rng.chance(0.72 + 0.28 * d) || (flankCount === 0 && k === flanks[1]);
      if (keep) { occupied.add(k); flankCount++; }
    }
    if (!flankCount) { occupied.add(flanks[rng.int(0, 1)]); flankCount = 1; }

    for (let k = GEO.bayMin; k <= GEO.bayMax; k++) {
      if (k === targetK) continue;
      if (Math.abs(k - targetK) > 1 && !rng.chance(0.62)) continue;
      if (Math.abs(k - targetK) <= 1 && !occupied.has(k)) continue;
      const paint = rng.pick(CAR_PAINTS);
      // sloppy parkers: a slight skew and lateral drift, tighter when harder
      const skew = rng.range(-0.055, 0.055) * (0.6 + d);
      const drift = rng.range(-0.14, 0.14) * (0.5 + d) + (Math.abs(k - targetK) === 1 ? rng.range(-0.06, 0.06) : 0);
      // some drivers nose in, some back in — the near end sits close to the wall
      const backedIn = rng.chance(0.45);
      const nearGap = rng.range(0.30, 0.72);
      const axleZ = backedIn
        ? nearGap + CAR.rearOverhang
        : nearGap + CAR.wheelbase + CAR.frontOverhang;
      cars.push({
        k,
        x: bayCenterX(k) + drift,
        z: axleZ,
        heading: (backedIn ? 0 : Math.PI) + skew,
        backedIn,
        paint,
        wagon: rng.chance(0.34),
      });
    }

    /* --- pillars, on the bay lines, hugging the wall --------------------- */
    const pillars = [];
    const pillarPhase = rng.int(0, 2);
    for (let k = GEO.bayMin; k <= GEO.bayMax + 1; k++) {
      if ((k + 100 + pillarPhase) % 3 !== 0) continue;
      const px = bayCenterX(k) - GEO.bayW * 0.5;
      if (Math.abs(px - targetX) < GEO.bayW * 0.8) continue;   // never pinch the target bay
      pillars.push({ x: px, z: 0.36, w: 0.42, d: 0.42 });
    }
    // one lane-side pillar for depth, always off to a side
    pillars.push({ x: bayCenterX(targetK + rng.sign() * rng.int(3, 4)), z: GEO.laneZ1 - 0.9, w: 0.5, d: 0.5 });

    /* --- ceiling light strips ------------------------------------------- */
    const lights = [
      { z: 1.55, x0: GEO.xMin, x1: GEO.xMax, gap: rng.range(3.4, 4.2), phase: rng.range(0, 3) },
      { z: 7.1,  x0: GEO.xMin, x1: GEO.xMax, gap: rng.range(3.6, 4.6), phase: rng.range(0, 3) },
    ];
    const flicker = rng.chance(0.45) ? { x: bayCenterX(targetK + rng.int(-3, 3)), z: 1.55, seed: rng() * 100 } : null;

    /* --- concrete grime -------------------------------------------------- */
    const stains = [];
    for (let i = 0; i < 16; i++) {
      stains.push({
        x: rng.range(GEO.xMin, GEO.xMax), y: rng.range(0, GEO.ceilY),
        w: rng.range(0.35, 2.4), h: rng.range(0.25, 1.5),
        a: rng.range(0.03, 0.11), dark: rng.chance(0.7),
      });
    }
    const floorMarks = [];
    for (let i = 0; i < 22; i++) {
      floorMarks.push({
        x: rng.range(GEO.xMin, GEO.xMax), z: rng.range(0.4, GEO.laneZ1),
        w: rng.range(0.2, 1.9), d: rng.range(0.15, 1.1),
        a: rng.range(0.02, 0.08), rot: rng.range(0, TAU),
      });
    }
    // tyre scuffs sweeping out of the bays
    const skids = [];
    for (let i = 0; i < 5; i++) {
      skids.push({ x: bayCenterX(rng.int(GEO.bayMin, GEO.bayMax)) + rng.range(-0.6, 0.6), z: rng.range(4.6, 7.4), len: rng.range(1.2, 3.4), rot: rng.range(-0.5, 0.5), a: rng.range(0.05, 0.12) });
    }

    /* --- the poster ------------------------------------------------------ */
    const adIndex = rng.int(0, (NS.ads ? NS.ads.length : 3) - 1);
    const posterH = rng.range(1.62, 1.86);
    const poster = {
      index: adIndex,
      cx: targetX + rng.range(-0.16, 0.16),
      cy: rng.range(1.60, 1.74),
      h: posterH,
      rot: rng.range(-0.075, 0.075),
      curl: rng.range(0.004, 0.02), // the sticker lifts a little off the concrete
    };

    /* --- starting pose: mid-manoeuvre, swung in from the side ------------
       Nose points away from the wall (heading 0), so reversing carries the
       boot towards it and the tailgate camera looks straight down the bay. */
    const side = rng.sign();
    const approach = rng.range(0.20, 0.42) + d * 0.12;         // radians off the bay axis
    const start = {
      x: targetX + side * rng.range(0.85, 1.75),
      z: GEO.laneZ0 + rng.range(3.0, 4.0),
      heading: side * approach,
    };
    // keep the nose inside the lane
    start.x = clamp(start.x, GEO.xMin + 3, GEO.xMax - 3);

    const target = {
      k: targetK, cx: targetX,
      z0: GEO.kerbZ, z1: GEO.laneZ0,
      halfW: GEO.bayW * 0.5,
    };

    return {
      seed, difficulty: d, rng,
      geo: GEO, car: CAR,
      cars, pillars, lights, flicker, stains, floorMarks, skids,
      poster, start, target,
      levelSign: rng.pick(['P-2', 'P-3', '-2', 'B2']),
      exitSide: rng.sign(),
      occupied: [...occupied],
    };
  }

  NS.world = { CAR, GEO, CAR_PAINTS, buildLevel, carCorners, local2world, world2local, bayCenterX };
})(window.PM = window.PM || {});
