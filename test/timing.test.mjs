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
} from '../src/engine/timing.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const CYLS = SPEC.cylinders;

test('firing order derives from the 60 deg V12 crank as 1-6-5-10-9-2-4-3-8-7-12-11 with 60 deg pulses', () => {
  const order = firingOrder();
  assert.deepEqual(order.cyls, [1, 6, 5, 10, 9, 2, 4, 3, 8, 7, 12, 11]);
  assert.deepEqual(order.angles, [0, 60, 120, 180, 240, 300, 360, 420, 480, 540, 600, 660]);
  const gaps = order.angles.map((a, i) => wrap720(a - order.angles[(i + 11) % 12]));
  assert.deepEqual(gaps, new Array(12).fill(60));

  // six throws 60 deg apart in azimuth: with the 60 deg bank angle that is what
  // makes every one of the twelve power strokes land exactly 60 crank degrees later
  const az = [...new Set(CYLS.map((c) => wrap360(SPEC.crank.pinAz[c.station])))]
    .sort((a, b) => a - b);
  assert.deepEqual(az, [30, 90, 150, 210, 270, 330]);
  az.forEach((a) => assert.equal(wrap360(a - az[0]) % 60, 0));
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
        // what the follower actually rides on: nose radius minus base circle
        const alpha = signedAngle(lobeAzimuth(c, valve, theta) - fAz);
        const profile = lobeProfileRadius(valve, alpha) - base;
        assert.ok(
          Math.abs(lift - Math.max(0, profile)) < 1e-9,
          `cyl ${c.num} ${valve}: valve ${lift} vs cam profile ${profile}`
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

test('24 valve events per cycle with a realistic overlap around the exhaust/intake TDC', () => {
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
  assert.equal(events, 2 * CYLS.length);

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
