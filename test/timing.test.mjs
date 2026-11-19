import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPEC, wrap360, wrap720, signedAngle, camAxisStation, HEAD_TOP_A } from '../src/engine/spec.js';
import {
  crankPinPoint,
  pistonPinPoint,
  pistonAlong,
  cycleAngle,
  strokeOf,
  valveLift,
  lobeProfileRadius,
  lobeMaxWalk,
  lobeMinCurvature,
  lobeMaxRadius,
  lobeHalfCamDeg,
  lobeAzimuth,
  camAzimuth,
  followerAzimuth,
  firingOrder,
  lobeSeparation,
  geometricTDCs,
  eventMid,
  valveAxisPoint,
  camAxisPoint,
  valveSeatPoint,
  firingProgress,
} from '../src/engine/timing.js';
import { RPM_MAX } from '../src/engine/animation.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const CYLS = SPEC.cylinders;
const DEG = Math.PI / 180;

// ---- flat-follower contact law oracles (#8 item 3, addendum A1-G1 / A1-G3) --
// The buckets are flat discs, so the follower rides on the plane the lobe
// presents to the follower axis. Sampled from the machined outline itself:
// max over the outline of r * cos(angle from the follower normal). FACE_TOL
// covers the 0.05 cam-degree sampling of the outline (3e-6 cm) with room.
const FACE_TOL = 2e-4; // cm
const OUTLINE_STEP = 0.05; // cam degrees

function lobeOutline(valve, step = OUTLINE_STEP) {
  const pts = [];
  for (let a = -180; a < 180; a += step) pts.push({ az: a, r: lobeProfileRadius(valve, a) });
  return pts;
}

const outlines = { intake: lobeOutline('intake'), exhaust: lobeOutline('exhaust') };

/** Tangent-plane distance of the lobe along a normal at `normalAz` cam degrees
 *  from the lobe nose, plus the polar angle of the point it touches. */
function lobeSupport(valve, normalAz) {
  let dist2 = -Infinity, az = 0;
  for (const q of outlines[valve]) {
    const d = q.r * Math.cos((q.az - normalAz) * DEG);
    if (d > dist2) { dist2 = d; az = q.az; }
  }
  return { dist: dist2, az };
}

test('firing order derives from the cross-plane crank as 1-8-7-3-6-5-4-2 with 90 deg pulses', () => {
  const order = firingOrder();
  assert.deepEqual(order.cyls, [1, 8, 7, 3, 6, 5, 4, 2]);
  assert.deepEqual(order.angles, [0, 90, 180, 270, 360, 450, 540, 630]);
  const gaps = order.angles.map((a, i) => wrap720(a - order.angles[(i + 7) % 8]));
  assert.deepEqual(gaps, [90, 90, 90, 90, 90, 90, 90, 90]);

  // cross-plane: the four throws sit in four mutually perpendicular planes
  const az = [...new Set(CYLS.map((c) => wrap360(SPEC.crank.pinAz[c.station])))]
    .sort((a, b) => a - b);
  assert.deepEqual(az, [45, 135, 225, 315]);
  az.forEach((a) => assert.equal(wrap360(a - az[0]) % 90, 0));
});

test('rod length is conserved between crank pin and piston pin at every crank angle', () => {
  for (const c of CYLS) {
    let min = Infinity;
    let max = -Infinity;
    for (let th = 0; th < 720; th += 1) {
      const len = dist(crankPinPoint(c, th), pistonPinPoint(c, th));
      assert.ok(
        Math.abs(len - SPEC.rod.length) < 1e-9,
        `cyl ${c.num} at ${th} deg: rod ${len} != ${SPEC.rod.length}`
      );
      const along = pistonAlong(c, th);
      min = Math.min(min, along);
      max = Math.max(max, along);
    }
    assert.ok(
      Math.abs(max - min - SPEC.stroke) < 1e-9,
      `cyl ${c.num} bore-axis travel ${max - min} != stroke ${SPEC.stroke}`
    );
  }
});

test('camshafts turn at exactly half crank speed: 360 cam deg per 720 crank deg', () => {
  for (const bank of ['L', 'R']) {
    for (let th = 0; th < 720; th += 7) {
      const dCam = signedAngle(camAzimuth(bank, th + 0.5) - camAzimuth(bank, th));
      assert.ok(
        Math.abs(Math.abs(dCam) - 0.25) < 1e-9,
        `bank ${bank} cam rate ${dCam}`
      );
    }
    const turns = camAzimuth(bank, 720) - camAzimuth(bank, 0); // unwrapped: one full cam turn
    assert.ok(Math.abs(Math.abs(turns) - 360) < 1e-9, `bank ${bank} cam revolution ${turns}`);
  }
  // lobes are machined onto the cam: their azimuth relative to the cam is constant
  for (const c of CYLS) {
    for (const v of ['intake', 'exhaust']) {
      const relA = signedAngle(lobeAzimuth(c, v, 13) - camAzimuth(c.bank, 13));
      const relB = signedAngle(lobeAzimuth(c, v, 317) - camAzimuth(c.bank, 317));
      assert.ok(Math.abs(signedAngle(relA - relB)) < 1e-9, `cyl ${c.num} ${v} lobe not fixed to cam`);
    }
  }
});

test('valve lift is the cam lobe profile rise, peaked at the documented cycle angle', () => {
  const base = SPEC.head.camBaseRadius;
  const V = SPEC.valves;
  for (const c of CYLS) {
    for (const valve of ['intake', 'exhaust']) {
      const open = valve === 'intake' ? V.intakeOpen : V.exhaustOpen;
      const close = valve === 'intake' ? V.intakeClose : V.exhaustClose;
      const mid = (open + close) / 2;
      const halfCrank = (close - open) / 2;
      const fAz = followerAzimuth(c, valve);
      let peak = 0;
      for (let dc = -halfCrank - 12; dc <= halfCrank + 12; dc += 1) {
        const cycle = wrap720(mid + dc);
        const theta = wrap720(c.powerTDC + cycle);
        const lift = valveLift(c, valve, theta);
        peak = Math.max(peak, lift);
        // what a flat follower actually rides on: the tangent plane the lobe
        // presents to the follower axis, not the radius along that ray (#8 item 3)
        const alpha = signedAngle(lobeAzimuth(c, valve, theta) - fAz);
        const sup = lobeSupport(valve, -alpha);
        assert.ok(
          Math.abs(lift - Math.max(0, sup.dist - base)) < FACE_TOL,
          `cyl ${c.num} ${valve}: valve ${lift} vs lobe contact distance ${sup.dist - base}`
        );
        if (dc === 0) {
          assert.ok(Math.abs(lift - SPEC.valves.maxLift) < 1e-9, `cyl ${c.num} ${valve} peak ${lift}`);
        } else if (Math.abs(dc) > halfCrank) {
          assert.equal(lift, 0, `cyl ${c.num} ${valve} leaks lift outside its event at cycle ${cycle}`);
        }
      }
      assert.ok(Math.abs(peak - SPEC.valves.maxLift) < 1e-9, `cyl ${c.num} ${valve} scan peak ${peak}`);
      const lsa = lobeSeparation(c);
      assert.ok(lsa > 95 && lsa < 120, `cyl ${c.num} lobe separation ${lsa} cam deg`);
      const centreSep = Math.abs(eventMid('intake') - eventMid('exhaust'));
      assert.equal(centreSep, 2 * lsa, `cyl ${c.num} event centre separation must equal 2*LSA`);
      assert.ok(centreSep > 190 && centreSep < 240, `cyl ${c.num} event centre separation ${centreSep}`);
    }
  }
});

test('each cylinder runs the four strokes with TDC/BDC aligned to the stroke boundaries', () => {
  for (const c of CYLS) {
    const seen = new Set();
    for (let cycle = 0; cycle < 720; cycle += 5) {
      seen.add(strokeOf(c, wrap720(c.powerTDC + cycle)));
    }
    assert.deepEqual([...seen].sort(), ['COMPRESSION', 'EXHAUST', 'INTAKE', 'POWER']);

    const at = (cycle) => pistonAlong(c, wrap720(c.powerTDC + cycle));
    assert.ok(at(0) - at(180) > 7.9 && at(0) - at(180) < 8.1, `cyl ${c.num} power TDC is not the geometric top`);
    assert.ok(Math.abs(at(0) - at(360)) < 1e-9 && Math.abs(at(180) - at(540)) < 1e-9);
    assert.equal(strokeOf(c, wrap720(c.powerTDC)), 'POWER');
    assert.equal(strokeOf(c, wrap720(c.powerTDC + 200)), 'EXHAUST');
    assert.equal(strokeOf(c, wrap720(c.powerTDC + 400)), 'INTAKE');
    assert.equal(strokeOf(c, wrap720(c.powerTDC + 600)), 'COMPRESSION');
    assert.equal(cycleAngle(c, wrap720(c.powerTDC)), 0);
  }
});

test('16 valve events per cycle with a realistic overlap around the exhaust/intake TDC', () => {
  let events = 0;
  for (const c of CYLS) {
    for (const valve of ['intake', 'exhaust']) {
      let openings = 0;
      let prev = 0;
      for (let cycle = 0; cycle < 720; cycle += 1) {
        const l = valveLift(c, valve, wrap720(c.powerTDC + cycle));
        if (l > 0 && prev === 0) openings += 1;
        prev = l;
      }
      assert.equal(openings, 1, `cyl ${c.num} ${valve} opens ${openings} times per 720`);
      events += openings;
    }
  }
  assert.equal(events, 16);

  for (const c of CYLS) {
    const i = valveLift(c, 'intake', wrap720(c.powerTDC + 360));
    const e = valveLift(c, 'exhaust', wrap720(c.powerTDC + 360));
    assert.ok(i > 0 && e > 0, `cyl ${c.num} has no overlap at TDC (in ${i} ex ${e})`);
    let both = 0;
    for (let cycle = 300; cycle < 420; cycle += 1) {
      if (
        valveLift(c, 'intake', wrap720(c.powerTDC + cycle)) > 0 &&
        valveLift(c, 'exhaust', wrap720(c.powerTDC + cycle)) > 0
      )
        both += 1;
    }
    assert.ok(both > 40 && both < 70, `cyl ${c.num} overlap ${both} crank deg`);
  }
});

test('valvetrain stays in contact: bucket to cam axis distance equals base circle plus lift', () => {
  const base = SPEC.head.camBaseRadius;
  for (const c of CYLS) {
    for (const valve of ['intake', 'exhaust']) {
      const cam = camAxisPoint(c, valve);
      for (let cycle = 0; cycle < 720; cycle += 3) {
        const theta = wrap720(c.powerTDC + cycle);
        const lift = valveLift(c, valve, theta);
        const top = valveAxisPoint(c, valve, camAxisStation - base, theta);
        const d = dist(top, cam);
        assert.ok(Math.abs(d - (base + lift)) < 1e-6, `cyl ${c.num} ${valve} lost contact at ${d}`);
      }
      const ci = camAxisPoint(c, 'intake');
      const ce = camAxisPoint(c, 'exhaust');
      assert.ok(
        Math.hypot(ci.y - ce.y, ci.z - ce.z) > 2 * (base + SPEC.valves.maxLift),
        `cyl ${c.num} camshafts collide`
      );
    }
  }
});

// ---- A1-G1: nothing ever crosses a follower face -----------------------------

test('A1-G1 no lobe crosses its follower face and no follower flies: contact over a full 720 deg cycle', () => {
  const base = SPEC.head.camBaseRadius;
  let worstPen = 0, penAt = null, worstGap = 0, gapAt = null, walkMax = 0, walkAt = null;
  for (const c of CYLS) {
    for (const valve of ['intake', 'exhaust']) {
      for (let cycle = 0; cycle < 720; cycle += 2) {
        const theta = wrap720(c.powerTDC + cycle);
        const alpha = signedAngle(lobeAzimuth(c, valve, theta) - followerAzimuth(c, valve));
        const sup = lobeSupport(valve, -alpha);
        const face = base + valveLift(c, valve, theta);
        const pen = sup.dist - face; // > 0: the lobe reaches past the face into the bucket
        if (pen > worstPen) { worstPen = pen; penAt = [c.num, valve, cycle, alpha.toFixed(2), sup.dist.toFixed(4), face.toFixed(4)]; }
        if (-pen > worstGap) { worstGap = -pen; gapAt = [c.num, valve, cycle, pen.toFixed(4)]; }
        const walk = Math.abs(sup.az + alpha); // contact offset off the follower ray, cam deg
        if (walk > walkMax) { walkMax = walk; walkAt = [c.num, valve, cycle, sup.az.toFixed(2)]; }
      }
    }
  }
  assert.ok(worstPen < FACE_TOL,
    `lobe penetrates the flat follower face by ${worstPen.toFixed(4)} cm at ${JSON.stringify(penAt)} (tol ${FACE_TOL})`);
  assert.ok(worstGap < FACE_TOL,
    `follower loses contact, gap ${worstGap.toFixed(4)} cm at ${JSON.stringify(gapAt)} (tol ${FACE_TOL})`);
  assert.ok(walkMax < 60, `contact runs ${walkMax.toFixed(2)} cam deg off the follower ray at ${JSON.stringify(walkAt)}`);
  // the contact law in centimetres, against the part that has to carry it:
  // dh/dpsi is how far the contact patch moves across the flat tappet face, and
  // the outline radius of curvature has to stay positive or the lobe cuts the
  // bucket instead of riding it.
  const faceR = SPEC.head.bucketRadius;
  for (const valve of ['intake', 'exhaust']) {
    const walk = lobeMaxWalk(valve);
    const curv = lobeMinCurvature(valve);
    assert.ok(walk <= faceR - 0.15,
      `${valve}: contact walks ${walk.toFixed(4)} cm across a ${faceR} cm tappet face (limit ${faceR - 0.15})`);
    assert.ok(curv > 0,
      `${valve}: the machined outline undercuts a flat follower, tightest radius of curvature ${curv.toFixed(4)} cm`);
  }
});

// ---- A1-G3: the lobe is a machined profile, not a cosine drawn on a ray ------

test('A1-G3 the machined lobe: base circle, ramps, flanks, nose, lift, duration, grinder-stepped', () => {
  const base = SPEC.head.camBaseRadius;
  const quote = 0.127; // 0.050 in: the lift height a duration is quoted at
  for (const valve of ['intake', 'exhaust']) {
    const V = SPEC.valves;
    const halfCam = (valve === 'intake' ? V.intakeClose - V.intakeOpen : V.exhaustClose - V.exhaustOpen) / 4;
    const event = 4 * halfCam;
    // the contact law, not the ray: at a cam offset the follower rides on the
    // tangent plane the lobe presents, so every band below is a lift band
    const liftAt = (camDeg) => Math.max(0, lobeSupport(valve, camDeg).dist - base);
    const at = (target) => {
      let lo = 0, hi = 180;
      for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (liftAt(m) > target) lo = m; else hi = m; }
      return (lo + hi) / 2;
    };
    const durZero = 4 * at(1e-9);
    const durQuote = 4 * at(quote);
    const noseBand = 4 * at(V.maxLift - quote);
    const rampEach = (durZero - durQuote) / 2;
    const flankEach = (durZero - 2 * rampEach - noseBand) / 2;
    const report = `zero-lift duration ${durZero.toFixed(2)} | quoted at ${quote} cm ${durQuote.toFixed(2)} (${((100 * durQuote) / durZero).toFixed(1)}%) | ` +
      `ramp each side ${rampEach.toFixed(2)} | main flank each side ${flankEach.toFixed(2)} | nose band ${noseBand.toFixed(2)} | ` +
      `lift at nose ${liftAt(0).toFixed(4)} at half width ${liftAt(halfCam * 0.5).toFixed(4)} at ${halfCam + 5} cam deg ${liftAt(halfCam + 5).toFixed(4)}`;
    // Band windows are the shape a cam grinder actually produces on a
    // flat-tappet lobe, quoted the way a cam is quoted: at 0.050 in / 0.127 cm
    // of lift, which sits out on the ramps. A ground cam measures its
    // zero-lift duration 8..25 crank deg longer per side than that quoted
    // duration (80..98 % of the event), keeps at least 25 crank deg of working
    // flank on each side, and holds its nose band 40..120 crank deg wide.
    // A1-G3 also demands the profile be convex, so a nose narrower than the
    // ground arc undercuts: see the p / p_undercut headroom in
    // scripts/valve-train-audit.mjs.
    assert.ok(
      Math.abs(Math.round(durZero) - event) < 0.5 &&
        Math.abs(liftAt(0) - V.maxLift) < FACE_TOL &&
        liftAt(halfCam + 5) < 1e-6 &&
        liftAt(halfCam * 0.5) > 0.3 * V.maxLift &&
        rampEach >= 8 && rampEach <= 25 &&
        flankEach >= 25 && noseBand >= 40 && noseBand <= 120 &&
        durQuote / durZero >= 0.8 && durQuote / durZero <= 0.98,
      `${valve} lobe bands off a ground profile: ${report}`
    );
  }
  // journal / base-circle / nose stepping: everything turned or ground lands on the
  // 0.05 cm increment a grinder or a cam journal grinder works in. SPEC.cam.bearingR
  // is named the line bore the head machines, not a bearing: A1-G7 publishes the
  // stack, and the bearing that rides in that bore is a 0.26 cm shell over a 1.75 cm
  // cam journal (src/engine/bearings.js).
  const step = 0.05;
  const names = { 'cam base circle': SPEC.head.camBaseRadius, 'cam journal': SPEC.head.camJournalRadius, 'cam line bore': SPEC.cam.bearingR, 'max lift': SPEC.valves.maxLift };
  if (SPEC.valves.lobeNoseRadius !== undefined) names['lobe nose radius'] = SPEC.valves.lobeNoseRadius;
  for (const [name, v] of Object.entries(names)) {
    assert.ok(Math.abs(v / step - Math.round(v / step)) < 1e-9, `${name} ${v} is not stepped to ${step} cm`);
  }
  for (const valve of ['intake', 'exhaust']) {
    assert.ok(Math.abs(lobeProfileRadius(valve, 0) - (SPEC.head.camBaseRadius + SPEC.valves.maxLift)) < 1e-9,
      `${valve}: machined nose radius must be base circle + maxLift`);
    assert.ok(lobeProfileRadius(valve, 180) === SPEC.head.camBaseRadius, `${valve}: opposite the nose must be the base circle`);
  }
});

test('every power TDC is a physical TDC of its own crank throw, 180 deg later is BDC', () => {
  for (const c of CYLS) {
    const tdc = geometricTDCs(c);
    assert.ok(tdc.some((t) => Math.abs(wrap720(t - c.powerTDC)) < 1e-9), `cyl ${c.num} ${c.powerTDC} vs ${tdc}`);
    assert.equal(wrap360(crankPinPoint(c, c.powerTDC).az), wrap360(SPEC.banks[c.bank].az), `cyl ${c.num} top dead centre azimuth`);
    const top = pistonAlong(c, c.powerTDC);
    const bottom = pistonAlong(c, wrap720(c.powerTDC + 180));
    assert.ok(top > bottom && Math.abs(top - bottom - SPEC.stroke) < 1e-9);
  }
});

test('nothing penetrates: piston stays in the bore, never touches a valve, cover clears the cams', () => {
  const deck = SPEC.block.deckA;
  for (const c of CYLS) {
    for (let th = 0; th < 720; th += 1) {
      const along = pistonAlong(c, th);
      const crownA = along + SPEC.piston.compressionHeight;
      const skirtA = along - SPEC.piston.skirtLength;
      assert.ok(crownA <= deck - 0.05, `cyl ${c.num} crown through the deck at ${th}: ${crownA}`);
      assert.ok(skirtA >= SPEC.block.boreStartA + 0.2, `cyl ${c.num} skirt left the bore at ${th}: ${skirtA}`);
      for (const valve of ['intake', 'exhaust']) {
        const headA = valveSeatPoint(c, valve).along - valveLift(c, valve, th);
        assert.ok(
          headA - crownA > 0.02,
          `cyl ${c.num} ${valve} strikes the piston at cycle ${cycleAngle(c, th)}: ${headA - crownA}`
        );
      }
      assert.ok(HEAD_TOP_A >= camAxisPoint(c, 'intake').along + SPEC.head.camBaseRadius);
    }
  }
});

// ---- #8 Phase 1: ignition timing, advance curves, load model (P1-G3, P1-G4) ----

const RPM_CEIL = RPM_MAX;

import {
  centrifugalAdvance,
  vacuumAdvance,
  manifoldVacuum,
  totalAdvance,
  sparkAngle,
} from '../src/engine/ignition.js';

const IG = SPEC.ignition;

test('centrifugal advance is a clamped ramp: zero at and below its start rpm, capped at and above its full rpm', () => {
  const C = IG.centri;
  assert.equal(centrifugalAdvance(0), 0);
  assert.equal(centrifugalAdvance(C.startRpm), 0);
  assert.ok(centrifugalAdvance(10) === 0);
  // the ramp is linear between the breakpoints
  const mid = (C.startRpm + C.fullRpm) / 2;
  assert.ok(Math.abs(centrifugalAdvance(mid) - C.maxDeg / 2) < 1e-9, `mid-rpm ${centrifugalAdvance(mid)}`);
  assert.equal(centrifugalAdvance(C.fullRpm), C.maxDeg);
  assert.equal(centrifugalAdvance(RPM_CEIL), C.maxDeg); // above the product's rpm ceiling too
  let prev = -1;
  for (let rpm = 0; rpm <= RPM_CEIL; rpm += 25) {
    const v = centrifugalAdvance(rpm);
    assert.ok(v >= prev - 1e-12, `centrifugal advance not monotone at ${rpm}: ${prev} -> ${v}`);
    assert.ok(v >= 0 && v <= C.maxDeg + 1e-12, `centrifugal advance out of clamp at ${rpm}: ${v}`);
    prev = v;
  }
});

test('manifold vacuum derives from throttle and rpm over the documented model, never a constant', () => {
  const M = IG.vacuumModel;
  const atm = M.atmKpa;
  for (let rpm = 0; rpm <= RPM_CEIL; rpm += 200) {
    // wide open throttle: the manifold sits near atmospheric, the model only
    // carries the pumping loss that grows with rpm
    const wot = manifoldVacuum(rpm, 100);
    assert.ok(wot >= 0 && wot <= M.wotLossKpa * (rpm / RPM_CEIL) + 1e-9, `WOT vacuum at ${rpm}: ${wot}`);
    // closed throttle: the deepest vacuum, falling away as rpm rises
    const closed = manifoldVacuum(rpm, 0);
    const expect = M.closedKpa * (1 - M.closedFall * (rpm / RPM_CEIL));
    assert.ok(Math.abs(closed - expect) < 1e-9, `closed-throttle vacuum at ${rpm}: ${closed} != ${expect}`);
    // vacuum falls monotonically as the throttle opens at every rpm
    let prev = Infinity;
    for (let t = 0; t <= 100; t += 5) {
      const v = manifoldVacuum(rpm, t);
      assert.ok(v <= prev + 1e-9, `vacuum rose with throttle at rpm ${rpm}: ${prev} -> ${v}`);
      assert.ok(v >= 0 && v <= atm, `vacuum ${v} outside 0..${atm} at rpm ${rpm} throttle ${t}`);
      prev = v;
    }
  }
  // part throttle at low rpm is the high-vacuum corner the model exists for
  assert.ok(manifoldVacuum(800, 25) > 60, `part-throttle vacuum ${manifoldVacuum(800, 25)}`);
  assert.ok(manifoldVacuum(4000, 100) < IG.vacuum.startKpa, 'WOT at redline is not vacuum-free');
});

test('vacuum advance is a clamped function of vacuum: nothing at WOT, full at high vacuum', () => {
  const VC = IG.vacuum;
  assert.equal(vacuumAdvance(0), 0);
  assert.equal(vacuumAdvance(VC.startKpa), 0);
  assert.ok(Math.abs(vacuumAdvance((VC.startKpa + VC.fullKpa) / 2) - VC.maxDeg / 2) < 1e-9);
  assert.equal(vacuumAdvance(VC.fullKpa), VC.maxDeg);
  assert.equal(vacuumAdvance(IG.vacuumModel.atmKpa), VC.maxDeg);
  let prev = -1;
  for (let v = 0; v <= 102; v += 1) {
    const a = vacuumAdvance(v);
    assert.ok(a >= prev - 1e-12 && a <= VC.maxDeg + 1e-12, `vacuum advance ${a} at ${v} kPa`);
    prev = a;
  }
  // the corner the curve exists for, and the corner it must not touch
  assert.ok(vacuumAdvance(manifoldVacuum(900, 20)) > 10, 'part throttle idle gets no vacuum advance');
  assert.equal(vacuumAdvance(manifoldVacuum(4000, 100)), 0, 'wide-open throttle adds vacuum advance');
});

test('total advance is base + centrifugal + vacuum, clamped at the published ceiling', () => {
  for (let rpm = 0; rpm <= RPM_CEIL; rpm += 150) {
    for (const t of [0, 20, 55, 100]) {
      const sum = IG.baseDeg + centrifugalAdvance(rpm) + vacuumAdvance(manifoldVacuum(rpm, t));
      const total = totalAdvance(rpm, t);
      assert.ok(Math.abs(total - Math.min(sum, IG.maxTotalDeg)) < 1e-9, `total ${total} vs sum ${sum}`);
      assert.ok(total >= IG.baseDeg - 1e-9 && total <= IG.maxTotalDeg + 1e-9, `total ${total} out of range`);
    }
  }
  // the clamp really engages at a reachable corner: closed throttle at full centrifugal rpm
  const corner = totalAdvance(IG.centri.fullRpm, 0);
  assert.ok(IG.baseDeg + centrifugalAdvance(IG.centri.fullRpm) + vacuumAdvance(manifoldVacuum(IG.centri.fullRpm, 0)) > IG.maxTotalDeg);
  assert.equal(corner, IG.maxTotalDeg, `clamp corner ${corner}`);
});

test('firingProgress opens at the spark BTDC, runs through TDC and closes after the burn window', () => {
  const adv = IG.baseDeg;
  const burn = IG.burnDeg;
  for (const c of CYLS) {
    const at = (cycle) => firingProgress(c, wrap720(c.powerTDC + cycle), adv);
    assert.equal(at(wrap720(720 - adv - 1)), -1, `cyl ${c.num} opens late`);
    assert.equal(at(wrap720(720 - adv)), 0, `cyl ${c.num} window does not open at the spark`);
    assert.equal(at(0), adv / (adv + burn), `cyl ${c.num} TDC is not inside the window`);
    assert.equal(at(burn), 1, `cyl ${c.num} window does not close at the burn end`);
    assert.equal(at(burn + 1), -1, `cyl ${c.num} stays lit after the burn window`);
    let prev = -1;
    for (let cycle = 0; cycle < 720; cycle += 1) {
      const p = at(cycle);
      if (p >= 0) {
        assert.ok(p >= prev, `progress fell at cycle ${cycle}: ${prev} -> ${p}`);
        assert.ok(p <= 1 + 1e-12);
      }
      prev = p;
    }
    // the window wraps the cycle boundary without a gap: BTDC and ATDC halves join
    const open = wrap720(720 - adv);
    const left = at(wrap720(open - 2));
    assert.equal(left, -1);
    const first = at(open);
    const next = at(wrap720(open + 2));
    assert.equal(first, 0);
    assert.ok(next > first && next < 1, `progress does not advance across the wrap: ${first} -> ${next}`);
  }
  // a bigger total advance opens the window earlier and the end stays put
  const c1 = CYLS[0];
  assert.equal(firingProgress(c1, wrap720(c1.powerTDC + wrap720(720 - 30)), 30), 0);
  assert.equal(firingProgress(c1, wrap720(c1.powerTDC + wrap720(720 - 31)), 30), -1);
});

test('the spark angle is powerTDC minus the live total advance, once per 720 per cylinder', () => {
  for (const c of CYLS) {
    for (const [rpm, t] of [[0, 100], [800, 0], [1600, 55], [3200, 100], [4000, 30]]) {
      const adv = totalAdvance(rpm, t);
      const ang = sparkAngle(c, rpm, t);
      assert.ok(Math.abs(wrap720(ang + adv - c.powerTDC)) < 1e-9, `cyl ${c.num} ${rpm}/${t}: ${ang} not powerTDC-${adv}`);
      assert.ok(adv > 0 && adv <= IG.maxTotalDeg);
      const ahead = wrap720(ang - c.powerTDC);
      assert.ok(ahead >= 720 - IG.maxTotalDeg && ahead < 720, `cyl ${c.num} spark is not BTDC: ${ahead}`);
    }
    const uniq = new Set(SPEC.cylinders.map((k) => sparkAngle(k, 1600, 55)));
    assert.equal(uniq.size, 8, 'two cylinders share a spark angle');
  }
});
