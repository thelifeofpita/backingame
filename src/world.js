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
  /* The car park is built to the proportions of the model kit rather than the
     other way round: Kenney's cars are chunky and short, so everything else —
     bay depth, approach, turning circle — is sized to them. */
  const CAR = {
    len: 3.09, wid: 1.82, wheelbase: 1.95,
    rearOverhang: 0.56,   // rear axle -> rear bumper
    frontOverhang: 0.58,  // front axle -> nose
    height: 1.58,
    trackHalf: 0.74,
    modelScale: 1.2133,   // kit units -> metres, so a sedan is 1.82 m wide
  };
  const MODELS = ['sedan', 'suv', 'hatch', 'van', 'coupe'];
  /* the kit's own footprints, in metres, so collision matches what is drawn */
  const MODEL_DIMS = {
    sedan: { len: 3.09, wid: 1.82 },
    suv:   { len: 3.28, wid: 1.82 },
    hatch: { len: 3.46, wid: 1.58 },
    van:   { len: 3.34, wid: 1.82 },
    coupe: { len: 3.09, wid: 1.58 },
  };
  const GEO = {
    bayW: 2.62, bayD: 4.60,
    wallZ: 0,            // poster wall
    kerbZ: 0.22,         // wheel stop
    stopZ: 1.02,         // the wheel stop, and where a parked car comes to rest
    laneZ0: 4.60,        // bay mouth
    laneZ1: 11.0,        // far side of the lane
    ceilY: 2.86,
    xMin: -13, xMax: 13,
    bayMin: -4, bayMax: 4,
  };

  /* Muted metals for the crowd, a handful of loud ones so the row is not a
     line of grey slabs. The lilac is the house car. */
  const CAR_PAINTS = [
    { name: 'silver',   body: [126, 131, 138], roof: [116, 121, 128] },
    { name: 'graphite', body: [58, 62, 70],    roof: [50, 54, 62] },
    { name: 'white',    body: [186, 189, 192], roof: [176, 180, 184] },
    { name: 'black',    body: [34, 36, 40],    roof: [29, 31, 35] },
  ];
  const CAR_PAINTS_VIVID = [
    { name: 'red',      body: [168, 44, 38],   roof: [150, 38, 33],  vivid: 1 },
    { name: 'teal',     body: [38, 116, 118],  roof: [32, 103, 105], vivid: 1 },
    { name: 'lilac',    body: [136, 118, 176], roof: [124, 108, 162], vivid: 1 },
    { name: 'mustard',  body: [186, 146, 44],  roof: [168, 132, 40], vivid: 1 },
    { name: 'navy',     body: [46, 62, 104],   roof: [40, 55, 93],   vivid: 1 },
    { name: 'forest',   body: [48, 98, 68],    roof: [43, 88, 61],   vivid: 1 },
    { name: 'orange',   body: [196, 106, 40],  roof: [176, 95, 36],  vivid: 1 },
    { name: 'plum',     body: [104, 52, 92],   roof: [93, 46, 82],   vivid: 1 },
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
    // both flanking bays are always taken: that is what makes it a manoeuvre,
    // and it is what frames the bay you are aiming at
    const flanks = [targetK - 1, targetK + 1];
    for (const k of flanks) occupied.add(k);

    for (let k = GEO.bayMin; k <= GEO.bayMax; k++) {
      if (k === targetK) continue;
      if (Math.abs(k - targetK) > 1 && !rng.chance(0.62)) continue;
      // the two beside the gap are the ones you look at, so bias them loud
      const near = Math.abs(k - targetK) === 1;
      const paint = rng.chance(near ? 0.62 : 0.34)
        ? rng.pick(CAR_PAINTS_VIVID) : rng.pick(CAR_PAINTS);
      // sloppy parkers: a slight skew and lateral drift, tighter when harder
      const skew = rng.range(-0.055, 0.055) * (0.6 + d);
      const drift = rng.range(-0.14, 0.14) * (0.5 + d) + (Math.abs(k - targetK) === 1 ? rng.range(-0.06, 0.06) : 0);
      /* Some drivers nose in, some back in, but nobody mounts the wheel stop:
         the near end of every parked car rests just short of it, which is what
         the stop is there to make happen. */
      const backedIn = rng.chance(0.45);
      const model = rng.pick(MODELS);
      const dim = MODEL_DIMS[model];
      const nearEnd = GEO.stopZ + 0.09 + rng.range(0.02, 0.18);
      const axleZ = backedIn
        ? nearEnd + CAR.rearOverhang
        : nearEnd + dim.len - CAR.rearOverhang;
      cars.push({
        k,
        x: bayCenterX(k) + drift,
        z: axleZ,
        heading: (backedIn ? 0 : Math.PI) + skew,
        backedIn,
        paint,
        model,
        len: dim.len,
        wid: dim.wid,
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
      { z: 1.55, x0: GEO.xMin, x1: GEO.xMax, gap: rng.range(3.4, 4.2), phase: rng.range(0, 3), warm: rng.range(-1, 1) },
      { z: 7.1,  x0: GEO.xMin, x1: GEO.xMax, gap: rng.range(3.6, 4.6), phase: rng.range(0, 3), warm: rng.range(-1, 1) },
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

    /* --- the things bolted to a car park wall ---------------------------- */
    const exitSide = rng.sign();
    const fixtures = {
      exit: { x: bayCenterX(targetK + exitSide * rng.int(2, 3)) + rng.range(-0.3, 0.3), y: 2.34 },
      hose: { x: bayCenterX(targetK - exitSide * rng.int(2, 4)) + rng.range(-0.2, 0.2), y: 1.18 },
      accessibleK: (() => {
        let k = targetK + rng.sign() * rng.int(2, 4);
        return clamp(k, GEO.bayMin, GEO.bayMax);
      })(),
    };

    /* --- the poster ------------------------------------------------------ */
    const adIndex = rng.int(0, (NS.ads ? NS.ads.length : 3) - 1);
    const posterH = rng.range(1.22, 1.36);
    const poster = {
      index: adIndex,
      cx: targetX + rng.range(-0.06, 0.06),
      cy: rng.range(1.00, 1.10),
      h: posterH,
      rot: rng.range(-0.075, 0.075),
      curl: rng.range(0.004, 0.02), // the sticker lifts a little off the concrete
    };

    /* --- starting pose: mid-manoeuvre, swung in from the side ------------
       Nose points away from the wall (heading 0), so reversing carries the
       boot towards it and the tailgate camera looks straight down the bay. */
    const side = rng.sign();
    const approach = rng.range(0.26, 0.50) + d * 0.12;         // radians off the bay axis
    const start = {
      x: targetX + side * rng.range(1.05, 2.0),
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
      poster, start, target, fixtures,
      levelSign: rng.pick(['P-2', 'P-3', '-2', 'B2']),
      exitSide,
      occupied: [...occupied],
    };
  }

  NS.world = { CAR, GEO, MODELS, MODEL_DIMS, CAR_PAINTS, buildLevel, carCorners, local2world, world2local, bayCenterX };
})(window.PM = window.PM || {});
