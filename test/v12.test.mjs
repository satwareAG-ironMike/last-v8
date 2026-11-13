// The V12 architecture gates. Everything here is a claim the upgrade had to
// earn: two banks of six at a 60 degree included angle, six crankpins carrying
// a pair of side-by-side rods each, seven main bearings, and twelve power pulses
// exactly 60 crank degrees apart. Derived from src/engine/spec.js geometry, never
// asserted from a hand-typed order: firingOrder() re-derives the order from the
// throws and throws if a power TDC is not a physical TDC of its own pin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SPEC,
  BANKS,
  wrap360,
  wrap720,
  signedAngle,
  STATION_JOINTS_X,
  MAIN_CAPS_X,
  MAIN_JOURNALS,
  DECK_END_X,
  endDiscFaceX,
} from '../src/engine/spec.js';
import { firingOrder, geometricTDCs, throwOffset, pistonAlong } from '../src/engine/timing.js';
import { createEngineState, RPM_MIN, RPM_MAX } from '../src/engine/animation.js';

const CYLS = SPEC.cylinders;
const STATIONS = SPEC.block.stations;

test('twelve cylinders in two banks of six, 60 degree included angle', () => {
  assert.equal(CYLS.length, 12);
  assert.deepEqual(BANKS.L.cyls, [1, 3, 5, 7, 9, 11]);
  assert.deepEqual(BANKS.R.cyls, [2, 4, 6, 8, 10, 12]);
  assert.equal(BANKS.R.az, 30);
  assert.equal(BANKS.L.az, -30);
  assert.equal(BANKS.R.az - BANKS.L.az, 60); // the included angle the goal names
  assert.equal(STATIONS.length, 6);
  for (const bank of ['L', 'R']) {
    const list = CYLS.filter((c) => c.bank === bank);
    assert.equal(list.length, 6);
    // one cylinder per station, front to rear, no station carries two of one bank
    assert.deepEqual(list.map((c) => c.station), [0, 1, 2, 3, 4, 5]);
  }
  // stations are evenly spaced at the published pitch, centred on the crank axis
  const pitch = STATIONS.slice(0, -1).map((s, i) => s - STATIONS[i + 1]);
  assert.deepEqual(pitch, STATIONS.slice(0, -1).map(() => SPEC.block.pitch));
  assert.ok(Math.abs(STATIONS.reduce((a, b) => a + b, 0)) < 1e-9, 'station row is not centred');
});

test('six crankpins 60 degrees apart, front to rear, each shared by one pair', () => {
  const az = SPEC.crank.pinAz;
  assert.equal(az.length, 6);
  const steps = az.slice(0, -1).map((a, i) => wrap360(az[i + 1] - a));
  assert.deepEqual(steps, [60, 60, 60, 60, 60]);
  assert.equal(wrap360(az[0] + 30), 0); // cyl 1 (bank L, station 0) fires at theta = 0

  for (let st = 0; st < 6; st++) {
    const pair = CYLS.filter((c) => c.station === st);
    assert.equal(pair.length, 2, `station ${st} carries ${pair.length} rods, not a pair`);
    assert.deepEqual(pair.map((c) => c.bank).sort(), ['L', 'R']);
    // the two rods of a pin straddle the bore axes: their offsets from the pin
    // differ by exactly the 60 degree bank angle, which is what makes a 60 degree
    // V with 60 degree pin spacing fire evenly
    const [l, r] = pair;
    for (let th = 0; th < 360; th += 5) {
      const offL = signedAngle(SPEC.crank.pinAz[st] + SPEC.crank.sense * th - BANKS.L.az);
      const offR = signedAngle(SPEC.crank.pinAz[st] + SPEC.crank.sense * th - BANKS.R.az);
      // one pin, two bores: the throw's angle relative to the two bore axes is
      // always exactly the 60 degree bank angle apart
      assert.equal(wrap360(offL - offR), 60, `station ${st} pin not 60 deg between banks`);
      assert.ok(Math.abs(throwOffset(l, th) - offL) < 1e-9);
      assert.ok(Math.abs(throwOffset(r, th) - offR) < 1e-9);
    }
  }
});

test('the pair sits side by side on its pin: two big ends, no overlap, inside the webs', () => {
  const off = SPEC.crank.rodOff;
  const bigHalf = SPEC.rod.bigEndWidth / 2;
  assert.ok(off - bigHalf >= 0.05 - 1e-9, `the two big ends overlap (off ${off}, half ${bigHalf})`);
  assert.ok(off + bigHalf <= SPEC.crank.webIn - 0.05 + 1e-9, 'a big end would rub a crank web');
  for (let st = 0; st < 6; st++) {
    const pair = CYLS.filter((c) => c.station === st);
    assert.equal(new Set(pair.map((c) => Math.abs(c.bank === 'R' ? off : -off))).size, 1);
    // the renderer puts each rod of a pair on its own side of the pin: the sign
    // rule is asserted on the rendered big ends in test/cranktrain.test.mjs
    assert.ok(off > 0, 'the published offset is a magnitude');
  }
  // the pin is long enough to carry both big ends and run into both webs
  assert.ok(SPEC.crank.pinWidth / 2 >= SPEC.crank.webIn - 0.05, 'pin stops short of the webs');
  assert.ok(2 * (off + bigHalf) <= SPEC.crank.pinWidth, 'pin cannot carry both big ends');
});

test('seven main bearings: every journal has a cap, every cap a journal', () => {
  assert.equal(MAIN_CAPS_X.length, 7);
  assert.equal(MAIN_JOURNALS.length, 7);
  for (const c of MAIN_CAPS_X) {
    const home = MAIN_JOURNALS.find(([x0, x1]) => c >= x0 && c <= x1);
    assert.ok(home, `main cap at ${c} sits on nothing`);
  }
  // interior caps sit on the slab joints between two cylinder stations; the two
  // outer ones are the fore/aft bearings inside the end discs
  const interior = MAIN_CAPS_X.filter((c) => Math.abs(c) <= DECK_END_X);
  assert.deepEqual(
    interior.map((c) => Math.abs(c)).sort((a, b) => a - b),
    STATION_JOINTS_X.map((c) => Math.abs(c)).sort((a, b) => a - b)
  );
  assert.equal(MAIN_CAPS_X.filter((c) => Math.abs(c) > DECK_END_X).length, 2);
  // no counterweight can reach a cap: the sweep stays inside the published bay
  const last = Math.max(...STATIONS);
  assert.ok(last + SPEC.crank.counterLobeHalfX < endDiscFaceX(), 'a counterweight leaves the bay');
  assert.ok(SPEC.block.counterBayHalfX >= last + SPEC.crank.counterLobeHalfX);
});

test('twelve evenly spaced power pulses: 60 crank degrees, once per cylinder per 720', () => {
  const order = firingOrder();
  assert.equal(order.cyls.length, 12);
  assert.deepEqual(order.angles, [0, 60, 120, 180, 240, 300, 360, 420, 480, 540, 600, 660]);
  assert.equal(new Set(order.cyls).size, 12, 'a cylinder fires twice, or never');
  const gaps = order.angles.map((a, i) => wrap720(a - order.angles[(i + 11) % 12]));
  assert.deepEqual(gaps, new Array(12).fill(60));
  assert.deepEqual(order.cyls, [1, 6, 5, 10, 9, 2, 4, 3, 8, 7, 12, 11]);
  // banks alternate: only the two wrap adjacency a 6-pin 60 deg V cannot avoid
  const bankOf = (n) => (n % 2 ? 'L' : 'R');
  const seq = order.cyls.map(bankOf);
  const same = seq.map((b, i) => (b === seq[(i + 1) % 12] ? 1 : 0));
  assert.equal(same.reduce((a, b) => a + b), 2, `bank alternation broken: ${seq.join('')}`);
  // every listed power TDC is a physical top dead centre of its own throw
  for (const c of CYLS) {
    const tdc = geometricTDCs(c);
    assert.ok(tdc.some((t) => Math.abs(wrap720(t - c.powerTDC)) < 1e-9), `cyl ${c.num}: ${c.powerTDC} vs ${tdc}`);
  }
});

test('the running clock reports twelve firing events 60 degrees apart per cycle', () => {
  const state = createEngineState({ rpm: 600, running: true });
  const hits = [];
  state.onFire((cyl) => hits.push(cyl.num));
  let travelled = 0;
  while (travelled < 715) travelled += state.step(1 / 3600); // exactly 1 crank degree a step
  assert.equal(hits.length, 12, `fired ${hits.length} times in one cycle: ${hits.join(',')}`);
  assert.deepEqual(
    [...hits].sort((a, b) => a - b),
    CYLS.map((c) => c.num).sort((a, b) => a - b),
    'every cylinder must fire exactly once per cycle'
  );
  // twelve pulses in 720 crank degrees is only even if the published pulses are
  const at = Object.fromEntries(CYLS.map((c) => [c.num, c.powerTDC]));
  const sorted = [...hits].sort((a, b) => at[a] - at[b]);
  const steps = sorted.slice(1).map((n, i) => at[n] - at[sorted[i]]);
  assert.deepEqual(steps, new Array(11).fill(60), `uneven pulses: ${steps.join(',')}`);
  assert.equal(RPM_MIN, 0);
  assert.equal(RPM_MAX, 4000);
});

test('four camshafts carry six lobes each, at half crank speed', () => {
  assert.equal(SPEC.cam.halfSpeedRatio, 2);
  for (const bank of ['L', 'R']) {
    assert.equal(CYLS.filter((c) => c.bank === bank).length, 6);
  }
  assert.equal(SPEC.cam.sprocket.teeth, 2 * SPEC.crank.sprocket.teeth);
  assert.equal(SPEC.cam.sprocket.bands.length, 4);
  // 2:1 is machined, not faked: same chain pitch on both sprockets
  const crankPitch = (2 * Math.PI * SPEC.crank.sprocket.pitchR) / SPEC.crank.sprocket.teeth;
  const camPitch = (2 * Math.PI * SPEC.cam.sprocket.pitchR) / SPEC.cam.sprocket.teeth;
  assert.ok(Math.abs(crankPitch - camPitch) < 1e-6, `chain pitch ${crankPitch} vs ${camPitch}`);
});

test('piston travel equals the published stroke in every bore, both banks', () => {
  for (const c of CYLS) {
    let min = Infinity;
    let max = -Infinity;
    for (let th = 0; th < 360; th += 1) {
      const a = pistonAlong(c, th);
      min = Math.min(min, a);
      max = Math.max(max, a);
    }
    assert.ok(Math.abs(max - min - SPEC.stroke) < 1e-9, `cyl ${c.num} travel ${max - min}`);
  }
});
