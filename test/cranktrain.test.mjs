// Engine animation state + cranktrain renderer contract.
// The state machine is pure math; the cranktrain must place every mesh
// exactly where src/engine/timing.js says it is, and every rotating solid
// must stay clear of the block casting (counterBayHalfX, counterRadius).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SPEC, ID } from '../src/engine/spec.js';
import { crankPinPoint, pistonPinPoint, pistonAlong, firingOrder } from '../src/engine/timing.js';

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

test('engine state: firing pulses are 8 exactly-90-degree events per cycle', async () => {
  const { createEngineState } = await import('../src/engine/animation.js');
  const st = createEngineState({ rpm: 1000 });
  const fires = [];
  st.onFire((cyl, at) => fires.push({ num: cyl.num, at }));
  st.start();
  for (let i = 0; i < 720; i++) st.step(1 / 600); // 10 deg per step -> 7200 deg = 10 cycles
  assert.equal(fires.length, 10 * 8, `expected 80 pulses, got ${fires.length}`);
  const first = fires.slice(0, 8);
  assert.deepEqual(first.map((f) => f.num), firingOrder().cyls);
  const angles = first.map((f) => f.at);
  assert.deepEqual(angles, [0, 90, 180, 270, 360, 450, 540, 630]);
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
