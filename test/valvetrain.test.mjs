// Valvetrain renderer contract (written RED first).
// Four DOHC camshafts turn at exactly half crank speed; every lobe nose must
// physically point at its follower exactly when timing.js says lift peaks;
// the whole valve train is a closed kinematic chain: cam -> bucket -> shim ->
// valve tip -> spring -> fixed head seat, each link verified in world cm.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SPEC, camAxisStation, wrap360, signedAngle } from '../src/engine/spec.js';
import {
  lobeProfileRadius, lobeIndexAngle, lobeAzimuth, followerAzimuth,
  valveLift, valveAxisPoint, valveSeatPoint, valveAxisDir, camAxisPoint,
  eventMid, crankEvent, cycleAngle,
} from '../src/engine/timing.js';

const H = SPEC.head;
const V = SPEC.valves;
const DEG = Math.PI / 180;
const EPS = 1e-3;

const camGroupNames = ['cam-L-intake', 'cam-L-exhaust', 'cam-R-intake', 'cam-R-exhaust'];
const valves = ['intake', 'exhaust'];

async function buildValvetrain() {
  const { createValvetrain } = await import('../src/render/valvetrain.js');
  const mats = {};
  for (const n of ['camShaft', 'camLobe', 'bucket', 'springSteel', 'valveIntake', 'valveExhaust', 'fastenerDark', 'chainSteel'])
    mats[n] = new THREE.MeshStandardMaterial({ name: n });
  return createValvetrain(mats);
}

function count(group, prefix) {
  let n = 0;
  group.traverse((o) => { if (o.name.startsWith(prefix)) n += 1; });
  return n;
}

const angDiff = (a, b) => Math.abs(signedAngle(a - b));

function noseAzimuth(lobe) {
  lobe.updateWorldMatrix(true, true);
  const q = new THREE.Quaternion().setFromRotationMatrix(lobe.matrixWorld);
  const v = lobe.userData.noseDir.clone().applyQuaternion(q);
  return wrap360(Math.atan2(v.y, v.z) / DEG);
}

/** Azimuth + radius of the outline's max-radius vertex: where the cam was cut. */
function machinedNose(lobe) {
  const pos = lobe.geometry.attributes.position;
  const v = new THREE.Vector3();
  let best = null, br = -1;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const r = Math.hypot(v.y, v.z);
    if (r > br) { br = r; best = v.clone(); }
  }
  return { az: wrap360(Math.atan2(best.y, best.z) / DEG), r: br };
}

// distance from the cam axis (through cap, along direction d) down to a world point
const underCam = (cap, d, p) => cap.clone().sub(p).dot(d);

// ---- build contract --------------------------------------------------------

test('valvetrain build: 4 camshafts, 24 lobes, 24 buckets with shims, 24 valves with retainers, 24 springs', async () => {
  const { group } = await buildValvetrain();
  assert.equal(group.name, 'valvetrain');
  for (const name of camGroupNames) assert.ok(group.getObjectByName(name), `${name} missing`);
  const N = SPEC.cylinders.length; // 12 valves of each kind across the engine
  const perBank = SPEC.block.stations.length; // 6 lobes on one camshaft
  assert.equal(N, 12);
  assert.equal(count(group, 'lobe-cyl'), 2 * N, 'one intake and one exhaust lobe per cylinder');
  assert.equal(count(group, 'bucket-cyl'), 2 * N * 4, 'bucket group + cup + flange + shim per valve');
  assert.equal(count(group, 'valve-cyl'), 2 * N * 4, 'valve group + head + stem + retainer per valve');
  assert.equal(count(group, 'spring-cyl'), 2 * N);
  assert.equal(count(group, 'camshaft-'), 4);
  assert.equal(count(group, 'bearing-'), 4 * SPEC.cam.bearings.length, `${SPEC.cam.bearings.length} bearing journals per camshaft`);
  assert.equal(count(group, 'cam-sprocket-'), 4);
  let meshes = 0;
  group.traverse((o) => { if (o.isMesh) meshes += 1; });
  const want = 4 * (2 + SPEC.cam.bearings.length + perBank) + 2 * N * 3 + 2 * N * 3 + 2 * N;
  assert.equal(meshes, want, `${want} solids expected (camshaft+bearings+sprocket+lobes per cam + 3 bucket + 3 valve + 1 spring per valve), got ${meshes}`);
});

// ---- cam phasing -------------------------------------------------------------

test('cams turn at exactly half crank speed, same direction as the crank', async () => {
  const { group, update } = await buildValvetrain();
  for (const theta of [0, 37, 151, 360, 719.5]) {
    update(theta);
    for (const name of camGroupNames) {
      const cam = group.getObjectByName(name);
      const got = wrap360(cam.rotation.x / DEG);
      assert.ok(angDiff(got, wrap360(theta / 2)) < 1e-9,
        `${name} at theta ${theta}: cam ${got}deg != half crank ${wrap360(theta / 2)}deg`);
    }
  }
});

test('every lobe nose physically points at its follower exactly when the valve is at max lift', async () => {
  const { group, update } = await buildValvetrain();
  // 1) as-machined pose: NO update() has been called since the build, so the
  //    world pose is the bake pose. Checked for all 16 lobes before anything turns.
  for (const cyl of SPEC.cylinders) {
    for (const valve of valves) {
      const lobe = group.getObjectByName(`lobe-cyl${cyl.num}-${valve}`);
      assert.ok(lobe, `lobe-cyl${cyl.num}-${valve} missing`);
      const idx = lobeIndexAngle(cyl, valve);
      const cut = machinedNose(lobe);
      // vertices are stored as float32, so the as-cut nose angle is exact to ~1e-6 deg
      assert.ok(angDiff(cut.az, idx) < 1e-3,
        `cyl ${cyl.num} ${valve}: machined nose at ${cut.az}deg != index angle ${idx}deg`);
      assert.ok(angDiff(noseAzimuth(lobe), idx) < 1e-6,
        `cyl ${cyl.num} ${valve}: lobe baked at the wrong index angle`);
    }
  }
  // 2) once the cam turns, the nose must track lobeAzimuth() exactly
  for (const cyl of SPEC.cylinders) {
    for (const valve of valves) {
      const lobe = group.getObjectByName(`lobe-cyl${cyl.num}-${valve}`);
      for (const theta of [23, 90, 180, 265, 340, 520, 700]) {
        update(theta);
        assert.ok(angDiff(noseAzimuth(lobe), lobeAzimuth(cyl, valve, theta)) < 1e-6,
          `cyl ${cyl.num} ${valve} at theta ${theta}: nose ${noseAzimuth(lobe)}deg != lobeAzimuth ${lobeAzimuth(cyl, valve, theta)}deg`);
      }
      // peak-lift coincidence: at crankEvent(cyl, eventMid) the nose faces the follower
      const theta = crankEvent(cyl, eventMid(valve));
      update(theta);
      assert.ok(angDiff(noseAzimuth(lobe), followerAzimuth(cyl, valve)) < 1e-6,
        `cyl ${cyl.num} ${valve}: max-lift nose not facing its follower at theta ${theta}`);
    }
  }
});

test('lobes are machined from lobeProfileRadius: base circle, maxLift nose, centred on their station', async () => {
  const { group } = await buildValvetrain();
  for (const cyl of SPEC.cylinders) {
    const s = SPEC.block.stations[cyl.station];
    for (const valve of valves) {
      const lobe = group.getObjectByName(`lobe-cyl${cyl.num}-${valve}`);
      let maxR = 0, minR = Infinity, minX = Infinity, maxX = -Infinity;
      const pos = lobe.geometry.attributes.position;
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        maxR = Math.max(maxR, Math.hypot(v.y, v.z));
        minR = Math.min(minR, Math.hypot(v.y, v.z));
        minX = Math.min(minX, v.x);
        maxX = Math.max(maxX, v.x);
      }
      const noseR = lobeProfileRadius(valve, 0); // base circle + maxLift
      assert.ok(Math.abs(maxR - noseR) < 0.3, `cyl ${cyl.num} ${valve}: nose r ${maxR} != machined ${noseR}`);
      assert.ok(Math.abs(minR - H.camBaseRadius) < 0.45, `cyl ${cyl.num} ${valve}: base circle r ${minR}`);
      assert.ok(Math.abs((minX + maxX) / 2 - s) < 0.06,
        `cyl ${cyl.num} ${valve}: lobe centre x ${(minX + maxX) / 2} not at station ${s}`);
      assert.ok(maxX - minX <= H.camLobeWidth + 0.45, `cyl ${cyl.num} ${valve}: lobe width ${maxX - minX}`);
      // the flank is the machined profile: half-way to the nose it still carries most
      // of the lift, and exactly past the half-width it is back on the base circle
      const hw = (valve === 'intake' ? V.intakeClose - V.intakeOpen : V.exhaustClose - V.exhaustOpen) / 4;
      assert.ok(lobeProfileRadius(valve, hw * 0.5) - H.camBaseRadius > 0.3 * V.maxLift, `${valve} flank must rise onto the nose`);
      assert.equal(lobeProfileRadius(valve, hw + 10), H.camBaseRadius, `${valve} flank past hw must fall back to base circle`);
    }
  }
});

// ---- valve schedule through the meshes --------------------------------------

test('all 24 valves sit exactly on valveAxisPoint; their opening window matches the cam event exactly', async () => {
  const { group, update } = await buildValvetrain();
  const d = new THREE.Vector3();
  for (let theta = 0; theta < 720; theta += 5) {
    update(theta);
    for (const cyl of SPEC.cylinders) {
      const cycle = cycleAngle(cyl, theta);
      for (const valve of valves) {
        const vg = group.getObjectByName(`valve-cyl${cyl.num}-${valve}`);
        const want = valveAxisPoint(cyl, valve, 0, theta);
        assert.ok(
          Math.abs(vg.position.x - want.x) < 1e-6 && Math.abs(vg.position.y - want.y) < 1e-6 && Math.abs(vg.position.z - want.z) < 1e-6,
          `cyl ${cyl.num} ${valve} at theta ${theta}: valve ${vg.position.toArray()} off its axis point`
        );
        const seat = valveSeatPoint(cyl, valve);
        d.fromArray(valveAxisDir(cyl, valve));
        const lift = -vg.position.clone().sub(new THREE.Vector3(seat.x, seat.y, seat.z)).dot(d);
        const mathLift = valveLift(cyl, valve, theta);
        assert.ok(Math.abs(lift - mathLift) < 1e-6, `cyl ${cyl.num} ${valve} at theta ${theta}: mesh lift ${lift} != math ${mathLift}`);
        const inWindow = valve === 'exhaust'
          ? cycle > V.exhaustOpen && cycle < V.exhaustClose
          : cycle > V.intakeOpen && cycle < V.intakeClose;
        if (inWindow) assert.ok(lift > 1e-9, `cyl ${cyl.num} ${valve}: cycle ${cycle} must be open`);
        else assert.ok(lift < 1e-9, `cyl ${cyl.num} ${valve}: cycle ${cycle} must be shut, got ${lift}`);
        if (cycle === eventMid(valve)) assert.ok(lift > V.maxLift - 1e-3, `cyl ${cyl.num} ${valve}: not at peak lift at event mid`);
      }
    }
  }
});

// ---- the chain: cam -> bucket -> shim -> valve tip -> spring -----------------

test('buckets ride the cam face: bucket top sits exactly camBase+lift under the cam axis', async () => {
  const { group, update } = await buildValvetrain();
  const d = new THREE.Vector3();
  for (const theta of [0, 55, 125, 265, 355, 470, 585, 700]) {
    update(theta);
    for (const cyl of SPEC.cylinders) {
      for (const valve of valves) {
        const bucket = group.getObjectByName(`bucket-cyl${cyl.num}-${valve}`);
        assert.ok(bucket, `bucket-cyl${cyl.num}-${valve} missing`);
        const lift = valveLift(cyl, valve, theta);
        d.fromArray(valveAxisDir(cyl, valve));
        const capPt = camAxisPoint(cyl, valve);
        const cap = new THREE.Vector3(capPt.x, capPt.y, capPt.z);
        const wantCentre = cap.clone().addScaledVector(d, -(H.camBaseRadius + H.bucketHeight / 2 + lift));
        assert.ok(bucket.position.distanceTo(wantCentre) < 1e-6,
          `cyl ${cyl.num} ${valve} at theta ${theta}: bucket off the follower axis at lift ${lift}`);
        const topFace = underCam(cap, d, bucket.position) - H.bucketHeight / 2;
        assert.ok(Math.abs(topFace - (H.camBaseRadius + lift)) < EPS,
          `cyl ${cyl.num} ${valve} at theta ${theta}: bucket face ${topFace} not riding cam radius ${H.camBaseRadius + lift}`);
        assert.ok(topFace >= H.camBaseRadius - 1e-9, 'bucket penetrated past the cam base circle');
      }
    }
  }
});

test('shim sits exactly between bucket and valve tip: the chain closes with zero gap at every lift', async () => {
  const { group, update } = await buildValvetrain();
  const d = new THREE.Vector3();
  const wc = new THREE.Vector3();
  for (const theta of [0, 200, 265, 470, 540, 700]) {
    update(theta);
    for (const cyl of SPEC.cylinders) {
      for (const valve of valves) {
        const shim = group.getObjectByName(`bucket-cyl${cyl.num}-${valve}-shim`);
        const vg = group.getObjectByName(`valve-cyl${cyl.num}-${valve}`);
        assert.ok(shim, `shim for cyl ${cyl.num} ${valve} missing`);
        const lift = valveLift(cyl, valve, theta);
        d.fromArray(valveAxisDir(cyl, valve));
        const capPt = camAxisPoint(cyl, valve);
        const cap = new THREE.Vector3(capPt.x, capPt.y, capPt.z);
        shim.getWorldPosition(wc);
        const shimBottom = underCam(cap, d, wc) + H.shim / 2;
        const tipDist = camAxisStation - H.stemToTip + lift; // valve tip: fixed seat geometry + live lift
        assert.ok(Math.abs(shimBottom - tipDist) < EPS,
          `cyl ${cyl.num} ${valve} at theta ${theta}: shim bottom ${shimBottom} != valve tip ${tipDist}`);
        const retainer = vg.getObjectByName(`valve-cyl${cyl.num}-${valve}-retainer`);
        assert.ok(retainer, 'retainer missing');
        retainer.getWorldPosition(wc);
        const retainerTop = underCam(cap, d, wc) - H.retainerGap / 2; // top face of the retainer = the valve tip plane
        assert.ok(Math.abs(retainerTop - tipDist) < EPS,
          `cyl ${cyl.num} ${valve}: retainer not clamped on the tip (${retainerTop} != ${tipDist})`);
      }
    }
  }
});

// ---- springs ------------------------------------------------------------------

test('springs compress by exactly the valve lift, are preloaded, and never reach coil-solid', async () => {
  const { group, update } = await buildValvetrain();
  const mounted = H.stemToTip - H.retainerGap - H.guideLength; // installed length at zero lift
  // A compression spring is installed SHORTER than its free length: that is preload.
  assert.ok(V.springFreeLength > mounted, 'springs must be preloaded at zero lift (free length > installed length)');
  assert.ok(V.springFreeLength - mounted < V.maxLift, 'preload must stay well inside the lift range');
  assert.ok(mounted - V.maxLift > V.springCoils * V.springWireRadius * 2 + 0.3, 'springs would go coil-solid at max lift');
  const d = new THREE.Vector3();
  for (const theta of [0, 265, 470, 610]) {
    update(theta);
    for (const cyl of SPEC.cylinders) {
      for (const valve of valves) {
        const spring = group.getObjectByName(`spring-cyl${cyl.num}-${valve}`);
        const lift = valveLift(cyl, valve, theta);
        const wantScale = (mounted - lift) / mounted;
        assert.ok(Math.abs(spring.scale.y - wantScale) < 1e-9,
          `cyl ${cyl.num} ${valve}: spring scale ${spring.scale.y} != ${wantScale}`);
        d.fromArray(valveAxisDir(cyl, valve));
        const seat = valveSeatPoint(cyl, valve);
        const anchor = new THREE.Vector3(seat.x, seat.y, seat.z).addScaledVector(d, H.guideLength); // fixed in the head
        const live = mounted - lift;
        const wantPos = anchor.clone().addScaledVector(d, live / 2);
        assert.ok(spring.position.distanceTo(wantPos) < 1e-6,
          `cyl ${cyl.num} ${valve}: spring slid off its fixed seat`);
      }
    }
  }
});

// ---- nothing floats apart ----------------------------------------------------

test(`nothing floats: continuous camshafts through ${SPEC.cam.bearings.length} bearings, drive sprockets in the crank nose plane`, async () => {
  const { group } = await buildValvetrain();
  // Box3.expandByObject() refreshes the object's own matrix but NOT its
  // ancestors', so pose the whole tree like the renderer does before measuring.
  group.updateMatrixWorld(true);
  const CS = SPEC.cam.sprocket;
  assert.equal(CS.teeth, SPEC.crank.sprocket.teeth * 2, 'cam sprocket = 2x crank sprocket teeth');
  assert.ok(Math.abs(CS.pitchR - SPEC.crank.sprocket.pitchR * 2) < 1e-9, 'cam pitch radius exactly 2x crank');
  const chainPitch = (sp) => (2 * Math.PI * sp.pitchR) / sp.teeth;
  assert.ok(Math.abs(chainPitch(CS) - chainPitch(SPEC.crank.sprocket)) < 1e-9,
    'cam and crank sprockets must share one chain pitch (they run on the same chain)');
  const bands = SPEC.cam.sprocket.bands;
  for (const name of camGroupNames) {
    const cam = group.getObjectByName(name);
    const bank = name.split('-')[1];
    const valve = name.split('-')[2];
    const i = camGroupNames.indexOf(name);
    const cyl = SPEC.cylinders.find((c) => c.bank === bank);
    const capPt = camAxisPoint(cyl, valve);
    assert.ok(Math.abs(cam.position.y - capPt.y) < 1e-6 && Math.abs(cam.position.z - capPt.z) < 1e-6,
      `${name}: axis not on camAxisBank line`);
    const j = cam.getObjectByName(`camshaft-${bank}-${valve}`);
    const jbb = new THREE.Box3().setFromObject(j);
    assert.ok(jbb.min.x < SPEC.block.stations.at(-1) - SPEC.cam.bearingHalf && jbb.max.x > bands.at(-1) + CS.width,
      `${name}: journal ${jbb.min.x}..${jbb.max.x} does not run from the aft bearing through the sprocket`);
    for (const bx of SPEC.cam.bearings) {
      const brg = cam.getObjectByName(`bearing-${bank}-${valve}-${bx}`);
      assert.ok(brg, `${name}: bearing at x=${bx} missing`);
      const bb = new THREE.Box3().setFromObject(brg);
      assert.ok(Math.abs((bb.min.x + bb.max.x) / 2 - bx) < 0.06, `${name}: bearing at ${bb.min.x}..${bb.max.x} != ${bx}`);
    }
    const sb = new THREE.Box3().setFromObject(cam.getObjectByName(`cam-sprocket-${bank}-${valve}`));
    assert.ok(sb.min.x > bands[i] - 0.06 && sb.max.x < bands[i] + CS.width + 0.06,
      `${name}: sprocket x ${sb.min.x}..${sb.max.x} not in band ${bands[i]}`);
    const maxR = Math.max(Math.abs(sb.max.y - capPt.y), Math.abs(sb.min.y - capPt.y),
      Math.abs(sb.max.z - capPt.z), Math.abs(sb.min.z - capPt.z));
    assert.ok(maxR <= CS.pitchR + CS.toothH + 0.2, `${name}: sprocket radial envelope ${maxR}`);
    assert.ok(maxR >= CS.pitchR + CS.toothH * 0.4, `${name}: sprocket teeth too small`);
    assert.equal(count(cam, 'bearing-'), SPEC.cam.bearings.length, `${name}: bearing journals expected`);
  }
});
