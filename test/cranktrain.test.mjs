// Engine animation state + cranktrain renderer contract.
// The state machine is pure math; the cranktrain must place every mesh
// exactly where src/engine/timing.js says it is, and every rotating solid
// must stay clear of the block casting (counterBayHalfX, counterRadius).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SPEC, ID, wrap720 } from '../src/engine/spec.js';
import { crankPinPoint, pistonPinPoint, pistonAlong, firingOrder } from '../src/engine/timing.js';
import { totalAdvance } from '../src/engine/ignition.js';

const C = SPEC.crank;
const EPS = 1e-3;

// ---- state machine --------------------------------------------------------

test('engine state: rpm default, clamping, start/stop, slow motion', async () => {
  const { createEngineState, RPM_MIN, RPM_MAX } = await import('../src/engine/animation.js');
  assert.equal(RPM_MIN, 0);
  assert.equal(RPM_MAX, 4000);

  const st = createEngineState();
  assert.equal(st.rpm, 1600);
  assert.equal(st.running, false);
  assert.equal(st.theta, 0);

  st.step(1); // stopped: nothing moves
  assert.equal(st.theta, 0);

  st.setRpm(5000);
  assert.equal(st.rpm, 4000);
  st.setRpm(-20);
  assert.equal(st.rpm, 0);
  st.setRpm(2000);

  st.start();
  st.step(0.5); // 2000 rpm = 12000 deg/s -> 6000 deg, wraps 720 -> 720%720=0? 6000/720=8.333 -> 240
  assert.ok(Math.abs(st.theta - 240) < 1e-9, `theta=${st.theta}`);

  st.setSlowmo(0.25);
  st.step(0.5); // another 1500 deg -> 240+1500=1740 -> wrap 300
  assert.ok(Math.abs(st.theta - 300) < 1e-9, `theta=${st.theta}`);

  st.setSlowmo(4); // clamped
  assert.equal(st.slowmo, 1);

  st.stop();
  const t = st.theta;
  st.step(1);
  assert.equal(st.theta, t);
});

// #8 P1-G2: the spark lands at powerTDC - totalAdvance, never at TDC. Every
// cylinder fires exactly once per 720, the eight pulses stay 90 deg apart, and
// the sequence is the cross-plane order (rotated: an advance moves cyl 1's spark
// past cyl 2's, which is exactly what an advance does).
// A crank that does not turn cannot spark, so the pulse law is measured on the
// turning range: rpm 0 is asserted separately as "no spark at all".
const SPARK_CASES = [
  [100, 100], [300, 0], [800, 0], [1000, 50], [1600, 55], [2400, 20], [3200, 100], [4000, 30], [4000, 100],
];

const isRotationOf = (seq, order) => {
  const k = order.indexOf(seq[0]);
  assert.ok(k >= 0, `pulse sequence ${seq.join('-')} does not start on a firing-order cylinder`);
  for (let i = 0; i < seq.length; i++) {
    assert.equal(seq[i], order[(k + i) % seq.length], `pulse sequence ${seq.join('-')} is not the firing order`);
  }
};

test('engine state: firing pulses are 8 exactly-90-degree events per cycle, each one at powerTDC - totalAdvance', async () => {
  const { createEngineState } = await import('../src/engine/animation.js');
  const order = firingOrder();
  const power = new Map(SPEC.cylinders.map((c) => [c.num, c.powerTDC]));

  for (const [rpm, throttle] of SPARK_CASES) {
    const st = createEngineState({ rpm, throttle });
    const fires = [];
    st.onFire((cyl, at) => fires.push({ num: cyl.num, at }));
    st.start();
    const adv = totalAdvance(rpm, throttle);
    // rpm*6 deg/s at 1/600 s per step = rpm/100 deg per step; every case is
    // chosen so this divides 7200 deg, i.e. exactly ten full 720 cycles.
    const perStep = rpm / 100;
    const steps = 7200 / perStep;
    for (let i = 0; i < steps; i++) st.step(1 / 600);
    assert.equal(fires.length, 10 * 8, `rpm ${rpm} throttle ${throttle}: expected 80 pulses in ${steps} steps, got ${fires.length}`);
    for (let cycle = 0; cycle < 10; cycle++) {
      const block = fires.slice(cycle * 8, cycle * 8 + 8);
      isRotationOf(block.map((f) => f.num), order.cyls);
      const angles = block.map((f) => f.at);
      for (const f of block) {
        const want = wrap720(power.get(f.num) - adv);
        assert.ok(Math.abs(f.at - want) < 1e-6,
          `rpm ${rpm} throttle ${throttle}: cyl ${f.num} fired at ${f.at}, powerTDC ${power.get(f.num)} - advance ${adv} = ${want}`);
        assert.notEqual(f.at, power.get(f.num), `cyl ${f.num} still fires at TDC, not ${adv} deg before it`);
      }
      const sorted = [...block].sort((a, b) => a.at - b.at).map((f) => f.at);
      for (let i = 0; i < 8; i++) {
        const gap = wrap720(sorted[(i + 1) % 8] - sorted[i]);
        assert.ok(Math.abs(gap - 90) < 1e-6, `rpm ${rpm} throttle ${throttle}: pulse gaps ${sorted.join(', ')}`);
      }
    }
  }
});

test('engine state: a crank at 0 rpm never sparks', async () => {
  const { createEngineState } = await import('../src/engine/animation.js');
  const st = createEngineState({ rpm: 0, throttle: 55 });
  const fires = [];
  st.onFire((cyl, at) => fires.push({ num: cyl.num, at }));
  st.start();
  for (let i = 0; i < 720; i++) st.step(1 / 600);
  assert.equal(fires.length, 0, `a 0 rpm engine sparked ${fires.length} times`);
  assert.equal(st.theta, 0);
});

test('engine state: the throttle control is a published surface with a live advance breakdown', async () => {
  const { createEngineState, THROTTLE_MIN, THROTTLE_MAX, RPM_MIN, RPM_MAX } = await import('../src/engine/animation.js');
  assert.equal(THROTTLE_MIN, 0);
  assert.equal(THROTTLE_MAX, 100);
  const st = createEngineState({ rpm: 1600 });
  assert.equal(st.throttle, 50, 'the product default load');
  assert.equal(st.setThrottle(140), THROTTLE_MAX);
  assert.equal(st.setThrottle(-5), THROTTLE_MIN);
  assert.equal(st.setThrottle(25), 25);
  const IG = SPEC.ignition;
  const at = (rpm, throttle) => {
    st.setRpm(rpm);
    st.setThrottle(throttle);
    return st.advance();
  };
  const a = at(1600, 55);
  assert.ok(Math.abs(a.total - totalAdvance(1600, 55)) < 1e-12, `HUD total ${a.total} != model ${totalAdvance(1600, 55)}`);
  assert.ok(a.vacuumKpa > 0 && a.vacuumKpa <= IG.vacuumModel.atmKpa, `manifold vacuum ${a.vacuumKpa}`);
  assert.ok(Math.abs(a.total - Math.min(a.base + a.centrifugal + a.vacuum, IG.maxTotalDeg)) < 1e-12,
    `HUD breakdown ${a.base} + ${a.centrifugal} + ${a.vacuum} != total ${a.total}`);
  assert.ok(Math.abs(a.base - IG.baseDeg) < 1e-12, 'the breakdown does not name the base advance');
  // part throttle at low rpm is the vacuum corner; wide open at redline is not
  const part = at(900, 15);
  const wot = at(4000, 100);
  assert.ok(part.vacuum > wot.vacuum, `vacuum advance part throttle ${part.vacuum} vs WOT ${wot.vacuum}`);
  assert.equal(wot.vacuum, 0, 'wide-open throttle still carries vacuum advance');
  assert.ok(wot.centrifugal > 0, 'redline carries no centrifugal advance');
  assert.ok(part.vacuumKpa > IG.vacuum.fullKpa, `part-throttle vacuum ${part.vacuumKpa} is not the high-vacuum corner`);
  assert.ok(RPM_MIN === 0 && RPM_MAX === 4000);
});

test('engine state: a load change mid-run never doubles a spark and never skips one per cycle', async () => {
  const { createEngineState } = await import('../src/engine/animation.js');
  const st = createEngineState({ rpm: 1500, throttle: 60 });
  const fires = [];
  st.onFire((cyl, at) => fires.push({ num: cyl.num, at }));
  st.start();
  for (let i = 0; i < 1440; i++) {
    if (i === 200) st.setThrottle(0);
    if (i === 260) st.setRpm(2800);
    if (i === 340) st.setThrottle(100);
    if (i === 420) st.setRpm(600);
    if (i === 500) st.setThrottle(35);
    st.step(1 / 600); // rpm/100 deg per step: 15, then 28, then 6
  }
  assert.ok(fires.length >= 15 * 8, `expected at least 15 cycles x 8 sparks, got ${fires.length}`);
  const power = new Map(SPEC.cylinders.map((c) => [c.num, c.powerTDC]));
  const lastAt = new Map(); // cylinder -> index of its previous spark in the emission list
  for (let i = 0; i < fires.length; i++) {
    const f = fires[i];
    assert.notEqual(f.at, power.get(f.num), `cyl ${f.num} fired at TDC, not before it (throttle ${st.throttle}%)`);
    const prev = lastAt.get(f.num);
    if (prev === undefined) continue;
    const between = new Map();
    for (const g of fires.slice(prev + 1, i)) between.set(g.num, (between.get(g.num) ?? 0) + 1);
    assert.equal(between.size, 7, `cyl ${f.num}: only ${between.size} different cylinders sparked between its own two sparks`);
    for (const [num, n] of between) assert.equal(n, 1, `cyl ${num} sparked ${n} times between two sparks of cyl ${f.num}`);
    lastAt.set(f.num, i);
  }
});

// ---- cranktrain build ------------------------------------------------------

async function buildCranktrain() {
  const { createCranktrain } = await import('../src/render/cranktrain.js');
  const mats = {};
  for (const n of ['crankShaft', 'rodSteel', 'pistonAlloy', 'ringSteel', 'chainSteel', 'fastenerDark'])
    mats[n] = new THREE.MeshStandardMaterial({ name: n });
  return createCranktrain(mats);
}

function eachVertex(mesh, fn) {
  const pos = mesh.geometry.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    fn(v);
  }
}

test('crank solids: counterweights inside the bay at r <= counterRadius, mains at r <= mainRadius', async () => {
  const { group } = await buildCranktrain();
  const crank = group.getObjectByName('crank');
  assert.ok(crank, 'crank group missing');

  // Counterweights are integral with the web slabs (like a real cross-plane
  // crank): each web reaches r = counterRadius, and none straddles the rod
  // gap s +/- 1.4 - a rod cap must never sweep through counter material.
  const meshes = [];
  crank.traverse((o) => o.isMesh && meshes.push(o));
  let sawWeb = 0;
  for (const m of meshes) {
    let maxR = 0;
    let maxAbsX = 0;
    let minZ = Infinity;
    eachVertex(m, (v) => {
      maxR = Math.max(maxR, Math.hypot(v.y, v.z));
      maxAbsX = Math.max(maxAbsX, Math.abs(v.x));
      minZ = Math.min(minZ, v.z);
    });
    if (m.name.startsWith('web-')) {
      sawWeb += 1;
      const s = Number(m.name.match(/s(-?[\d.]+)/)[1]);
      m.updateWorldMatrix(true, false);
      const bb = new THREE.Box3().setFromObject(m);
      const cx = (bb.min.x + bb.max.x) / 2;
      const half = (bb.max.x - bb.min.x) / 2;
      assert.ok(Math.abs(cx - s) >= 1.4 - 0.15 && Math.abs(cx - s) <= 1.95 + 0.01,
        `${m.name}: slab centre ${cx} not outboard of the rod gap at station ${s}`);
      assert.ok(Math.abs(cx) + half <= Math.abs(s) + 2.5 + EPS, `${m.name} slab beyond station span`);
      assert.ok(maxR <= C.counterRadius + EPS, `${m.name} r=${maxR} exceeds counterRadius`);
      assert.ok(maxR >= C.counterRadius - 0.06, `${m.name} counter arc too small (${maxR})`);
      assert.ok(maxAbsX < SPEC.block.counterBayHalfX, `${m.name} enters end-disc territory`);
      assert.ok(minZ > -C.counterRadius - EPS, 'counter z floor');
      assert.ok(minZ > -8.8, `${m.name} reaches main cap lugs`);
    }
    if (m.name.startsWith('main-')) {
      assert.ok(maxR <= C.mainRadius + EPS, `${m.name} r=${maxR} binds the 2.75 bearing shell`);
    }
  }
  assert.equal(sawWeb, 8, 'two counterweight webs per throw expected');

  // everything inside the drum bay stays clear of the void wall (ID 9.4)
  let maxBayR = 0;
  for (const m of meshes) {
    m.updateWorldMatrix(true, false);
    eachVertex(m, (v) => {
      const r = Math.hypot(v.y, v.z);
      if (Math.abs(v.x) < SPEC.block.counterBayHalfX) maxBayR = Math.max(maxBayR, r);
    });
  }
  assert.ok(maxBayR <= ID - 0.2, `rotating parts reach r=${maxBayR} into the void wall ${ID}`);
});

test('crank train rotates the throws by pinAzimuth(cyl, theta) (sense verified in pixels later)', async () => {
  const { group, update } = await buildCranktrain();
  update(90);
  const crank = group.getObjectByName('crank');
  const pin = crank.getObjectByName('pin-s16.5');
  assert.ok(pin, 'pin-s16.5 missing');
  pin.updateWorldMatrix(true, false);
  const bb = new THREE.Box3().setFromObject(pin);
  const c = bb.getCenter(new THREE.Vector3());
  const az = (315 - 90) * (Math.PI / 180);
  assert.ok(Math.abs(c.x - 16.5) < 1e-4, `pin x=${c.x}`);
  assert.ok(Math.abs(c.y - 4 * Math.sin(az)) < EPS, `pin y=${c.y}`);
  assert.ok(Math.abs(c.z - 4 * Math.cos(az)) < EPS, `pin z=${c.z}`);
});

test('pistons and rods track timing.js exactly at an arbitrary crank angle', async () => {
  const { group, update } = await buildCranktrain();
  const theta = 37; // deliberately not a multiple of 90
  update(theta);

  const upR = new THREE.Vector3();
  for (const cyl of SPEC.cylinders) {
    const piston = group.getObjectByName(`piston-cyl${cyl.num}`);
    const rod = group.getObjectByName(`rod-cyl${cyl.num}`);
    assert.ok(piston && rod, `missing meshes for cyl ${cyl.num}`);

    const along = pistonAlong(cyl, theta);
    const pp = pistonPinPoint(cyl, theta);
    // piston group position is the along-axis displacement from the bank axis origin
    assert.ok(
      Math.abs(piston.position.length() - along) < 1e-6,
      `cyl ${cyl.num}: |pos|=${piston.position.length()} along=${along}`
    );
    upR.fromArray([0, 0, 0]).copy(new THREE.Vector3(0, pp.y, pp.z).normalize());
    const pn = piston.position.clone().normalize();
    assert.ok(pn.dot(upR) > 0.999999, `cyl ${cyl.num}: piston not on its bore axis`);

    // rod big end exactly on the crankpin (plus its lateral offset on the shared pin)
    const cp = crankPinPoint(cyl, theta);
    assert.ok(Math.abs(rod.position.y - cp.y) < 1e-6 && Math.abs(rod.position.z - cp.z) < 1e-6,
      `cyl ${cyl.num}: rod big end off the crankpin`);
    const off = rod.position.x - cp.x;
    assert.ok(Math.abs(Math.abs(off) - 0.7) < 1e-6, `cyl ${cyl.num}: rod offset on pin = ${off}`);
    assert.ok((cyl.bank === 'R') === (off > 0), `cyl ${cyl.num}: rod sits on the wrong side`);

    // rod small end sits ON the shared pin: piston pin y/z exactly, laterally
    // offset by its bank side (bank R +0.7, bank L -0.7 along the pin axis)
    const small = new THREE.Vector3(0, SPEC.rod.length, 0).applyQuaternion(rod.quaternion).add(rod.position);
    assert.ok(Math.abs(small.x - (pp.x + off)) < EPS,
      `cyl ${cyl.num}: small end x=${small.x}, expected ${pp.x + off} on the pin`);
    assert.ok(Math.abs(small.y - pp.y) < EPS && Math.abs(small.z - pp.z) < EPS,
      `cyl ${cyl.num}: small end ${small.toArray()} off the piston pin axis ${[pp.y, pp.z]}`);
  }
});

test('rod big/small end BOSS MESHES physically sit on the crankpin and piston pin', async () => {
  const { group, update } = await buildCranktrain();
  const theta = 123;
  update(theta);
  for (const cyl of SPEC.cylinders) {
    const big = group.getObjectByName(`rod-cyl${cyl.num}-big`);
    const small = group.getObjectByName(`rod-cyl${cyl.num}-small`);
    assert.ok(big && small, `cyl ${cyl.num}: rod boss meshes missing`);
    big.updateWorldMatrix(true, true);
    small.updateWorldMatrix(true, true);
    const cp = crankPinPoint(cyl, theta);
    const pp = pistonPinPoint(cyl, theta);
    const bbB = new THREE.Box3().setFromObject(big);
    const cB = bbB.getCenter(new THREE.Vector3());
    const rB = Math.hypot(cB.y - cp.y, cB.z - cp.z);
    assert.ok(rB < 0.02, `cyl ${cyl.num}: big-end boss centre r=${rB.toFixed(3)} off crankpin`);
    const bbS = new THREE.Box3().setFromObject(small);
    const cS = bbS.getCenter(new THREE.Vector3());
    const rS = Math.hypot(cS.y - pp.y, cS.z - pp.z);
    assert.ok(rS < 0.02, `cyl ${cyl.num}: small-end boss centre r=${rS.toFixed(3)} off piston pin`);
    assert.ok(cS.x >= pp.x - 2.9 && cS.x <= pp.x + 2.9, `cyl ${cyl.num}: small end off the pin span`);
  }
});

test('pistons: skirt clears the bore bottom and the counter tips at BDC', async () => {
  const { group } = await buildCranktrain();
  const cyl1 = SPEC.cylinders[0];
  const bdcAlong = pistonAlong(cyl1, 180); // throwOffset = 180 at theta 180
  assert.ok(Math.abs(bdcAlong - 10.5) < 1e-9, `BDC along=${bdcAlong}`);
  const skirtBottom = bdcAlong - SPEC.piston.skirtLength; // 6.5
  assert.ok(skirtBottom > C.counterRadius + 0.15, `skirt bottom ${skirtBottom} hits counter r=${C.counterRadius}`);
  assert.ok(skirtBottom > SPEC.block.boreStartA + 0.5, 'skirt leaves the bore liner');

  // TDC crown stays under the deck (head gasket gap 1.7)
  const tdcAlong = pistonAlong(cyl1, 315 + 45); // throwOffset 0
  assert.ok(Math.abs(tdcAlong - 18.5) < 1e-9, `TDC along=${tdcAlong}`);
  assert.ok(tdcAlong + SPEC.piston.compressionHeight < SPEC.block.deckA - 1.6, 'crown breaches the deck');

  // 8 piston groups (body mesh + 3 ring band meshes), 8 rod groups
  let pistons = 0;
  let rods = 0;
  let rings = 0;
  group.traverse((o) => {
    if (o.isGroup && o.name.startsWith('rod-cyl')) rods += 1;
    if (!o.isMesh) return;
    if (o.name.startsWith('piston-cyl')) pistons += 1;
    if (o.name.startsWith('ring-cyl')) rings += 1;
  });
  assert.equal(pistons, 8);
  assert.equal(rods, 8);
  assert.equal(rings, 24);
});

test('flywheel and sprocket sit outside the casting envelope', async () => {
  const { group } = await buildCranktrain();
  const fw = group.getObjectByName('crank').getObjectByName('flywheel');
  const sp = group.getObjectByName('crank').getObjectByName('sprocket');
  assert.ok(fw && sp, 'flywheel/sprocket missing');
  const fbb = new THREE.Box3().setFromObject(fw);
  assert.ok(Math.abs(fbb.min.x + 30.0) < 1e-3 && Math.abs(fbb.max.x + 26.4) < 0.15, `flywheel x ${fbb.min.x}..${fbb.max.x}`);
  assert.ok(Math.max(fbb.max.y, fbb.max.z) <= C.flywheel.radius + 0.56, 'flywheel radial');
  const sbb = new THREE.Box3().setFromObject(sp);
  assert.ok(Math.abs(sbb.min.x - 28.6) < 1e-3 && Math.abs(sbb.max.x - 29.8) < 1e-3, `sprocket x ${sbb.min.x}..${sbb.max.x}`);
});
