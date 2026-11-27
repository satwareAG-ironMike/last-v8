// Valvetrain renderer contract (written RED first).
// Four DOHC camshafts turn at exactly half crank speed; every lobe nose must
// physically point at its follower exactly when timing.js says lift peaks;
// the whole valve train is a closed kinematic chain: cam -> bucket -> shim ->
// valve tip -> spring -> fixed head seat, each link verified in world cm.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { SPEC, bankOut, bankUp, camAxisStation, wrap360, signedAngle } from '../src/engine/spec.js';
import { bearingStack } from '../src/engine/bearings.js';
import { partLabel } from '../src/engine/view.js';
import { createHeads } from '../src/render/heads.js';
import { closestToShell, newShell, REACH, shellAdd } from './support/surface-clearance.mjs';
import {
  lobeProfileRadius, lobeIndexAngle, lobeAzimuth, followerAzimuth, camAzimuth,
  lobeContactLift, lobeHalfCamDeg,
  valveLift, valveAxisPoint, valveSeatPoint, valveAxisDir, camAxisPoint,
  eventMid, crankEvent, cycleAngle,
} from '../src/engine/timing.js';

const H = SPEC.head;
const V = SPEC.valves;
const DEG = Math.PI / 180;
const EPS = 1e-3;

const camGroupNames = ['cam-L-intake', 'cam-L-exhaust', 'cam-R-intake', 'cam-R-exhaust'];
const valves = ['intake', 'exhaust'];

async function buildValvetrain(variantId = SPEC.build.variant) {
  const { createValvetrain } = await import('../src/render/valvetrain.js');
  const mats = {};
  for (const n of ['camShaft', 'camLobe', 'bucket', 'springSteel', 'valveIntake', 'valveExhaust', 'fastenerDark', 'chainSteel'])
    mats[n] = new THREE.MeshStandardMaterial({ name: n });
  return createValvetrain(mats, variantId);
}

/** How many parts of one drawn group carry one follower word in their name or kind. */
function censusWords(group, word) {
  let hits = 0;
  group.traverse((o) => {
    if (o.name.toLowerCase().includes(word) || (o.userData && String(o.userData.kind || '').toLowerCase().includes(word))) hits += 1;
  });
  return hits;
}

function count(group, prefix) {
  let n = 0;
  group.traverse((o) => { if (o.name.startsWith(prefix)) n += 1; });
  return n;
}

/**
 * What stands inside one published cam bearing window [bx-H, bx+H] of one drawn
 * camshaft: the outer radius off the cam axis line and which drawn parts reach
 * there. Measured per triangle - a lathed solid puts its vertices only on its end
 * rings, so a vertex filter would see nothing of the body between them - and over
 * every mesh of the cam, because a bearing window may hold the journal and
 * nothing else that is wider than the journal.
 */
function windowBand(cam, cap, bx, half) {
  const x0 = bx - half, x1 = bx + half;
  let hi = 0, tris = 0;
  const who = new Set();
  for (const m of cam.children) {
    if (!m.isMesh) continue;
    m.updateWorldMatrix(true, false);
    const pos = m.geometry.attributes.position, idx = m.geometry.index;
    const n = idx ? idx.count : pos.count;
    const at = (k) => new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(k) : k).applyMatrix4(m.matrixWorld);
    for (let j = 0; j < n; j += 3) {
      const a = at(j), b = at(j + 1), c = at(j + 2);
      const tx0 = Math.min(a.x, b.x, c.x), tx1 = Math.max(a.x, b.x, c.x);
      if (tx1 < x0 || tx0 > x1) continue; // this triangle does not reach the window
      tris += 1;
      who.add(m.name);
      const r = Math.max(Math.hypot(a.y - cap.y, a.z - cap.z),
        Math.hypot(b.y - cap.y, b.z - cap.z), Math.hypot(c.y - cap.y, c.z - cap.z));
      if (r > hi) hi = r;
    }
  }
  return { hi, tris, who: [...who] };
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

test('valvetrain build: 4 camshafts, 16 lobes, 16 buckets with shims, 16 valves with retainers, 16 springs', async () => {
  const { group } = await buildValvetrain();
  assert.equal(group.name, 'valvetrain');
  for (const name of camGroupNames) assert.ok(group.getObjectByName(name), `${name} missing`);
  assert.equal(count(group, 'lobe-cyl'), 16, '16 cam lobes expected');
  assert.equal(count(group, 'bucket-cyl'), 16 * 4, 'bucket group + cup + flange + shim per valve');
  assert.equal(count(group, 'valve-cyl'), 16 * 4, 'valve group + head + stem + retainer per valve');
  assert.equal(count(group, 'spring-cyl'), 16);
  assert.equal(count(group, 'camshaft-'), 4);
  // A1-G7 (issue #8 addendum item 4): the bearing surface on the cam is the
  // continuous camshaft journal itself. A separate collar turned up to the 2.05
  // line bore filled the tunnel exactly and pressed into the 1.79 shell bore -
  // measured against the drawn shells it stood 0.000 cm from the bearing, i.e.
  // shaft on shell, no oil film, not a buildable engine.
  assert.equal(count(group, 'bearing-'), 0, 'the camshaft journal is the bearing surface, no collar on the cam');
  assert.equal(count(group, 'cam-sprocket-'), 4);
  let meshes = 0;
  group.traverse((o) => { if (o.isMesh) meshes += 1; });
  assert.equal(meshes, 136, `136 solids expected (24 camtrain + 48 bucket/shim + 48 valve + 16 spring), got ${meshes}`);
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
      // of the lift, and exactly past the half-width it is back on the base circle.
      // It is measured as LIFT AT THE FOLLOWER, which is what a cam table reads and
      // what this valve train renders. Half-way out to the nose a flat follower is
      // lifted 0.6641 cm of its 1.10 cm (60 %), while the machined outline there has
      // only risen 0.3148 cm off its 2.00 cm base circle: the contact normal swings
      // against the polar angle as the lobe turns (lobeProfileRadius), so the radial
      // number is not a lift. Reading the radial rise against a lift bar is what made
      // this row fail after #8 item 3; the bar itself is unchanged.
      const hw = lobeHalfCamDeg(valve);
      const flankLift = lobeContactLift(valve, hw * 0.5);
      assert.ok(flankLift > 0.3 * V.maxLift,
        `${valve} flank must rise onto the nose: ${flankLift.toFixed(4)} cm of lift at half the lobe half-width, bar ${(0.3 * V.maxLift).toFixed(4)}`);
      let prev = lobeProfileRadius(valve, hw + 10);
      for (let a = hw + 10; a > 0; a -= 0.25) {
        const r = lobeProfileRadius(valve, a);
        assert.ok(r >= prev - 1e-9,
          `${valve} outline runs back on the way to the nose at ${a} cam deg: ${r.toFixed(6)} < ${prev.toFixed(6)}`);
        prev = r;
      }
      assert.ok(Math.abs(lobeProfileRadius(valve, 0) - (H.camBaseRadius + V.maxLift)) < 1e-6,
        `${valve} outline does not end on the maxLift nose: ${lobeProfileRadius(valve, 0)} at psi 0`);
      assert.ok(prev < H.camBaseRadius + V.maxLift,
        `${valve} outline reaches its nose radius before the polar angle does (${prev} at ${hw + 10} cam deg)`);
      assert.equal(lobeProfileRadius(valve, hw + 10), H.camBaseRadius, `${valve} flank past hw must fall back to base circle`);
    }
  }
});

// ---- valve schedule through the meshes --------------------------------------

test('all 16 valves sit exactly on valveAxisPoint; their opening window matches the cam event exactly', async () => {
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

// A1-G1 (#8 item 3): this oracle REPLACES the knife-edge check it used to be
// (`bucket face distance == camBaseRadius + lift`, i.e. the lobe radius along the
// follower ray). A flat follower does not ride a radius, it rides the plane the
// lobe presents to its axis, so the check now measures the drawn lobe mesh
// against the drawn bucket over a whole 720 crank-degree cycle: nothing of the
// lobe may cross the face plane, the face must actually stand on the lobe, and
// the contact patch has to land inside the tappet face. The radius form could
// not see either defect this row now catches: the single-ray law let the lobe
// reach 0.5005 cm past every bucket it drove (recorded in GATES A1-G1), and the
// chamfer on the extruded lobe put the drawn nose 0.1209 cm past the face plane
// of all 16 buckets even after the law was fixed.
test('A1-G1 the drawn lobes never cross a bucket face, and every follower stands on a contact patch inside its own tappet face', async () => {
  const { group, update } = await buildValvetrain();
  const d = new THREE.Vector3(), across = new THREE.Vector3(), q = new THREE.Vector3();
  const cap = new THREE.Vector3(), wc = new THREE.Vector3();
  const CAM_AXIS = new THREE.Vector3(1, 0, 0); // lobes live in the (y, z) profile plane
  // The lobe mesh is the machined outline sampled every 2 cam degrees
  // (src/render/valvetrain.js lobeShape), so an inscribed vertex can sit that
  // far short of the true curve. Measured worst gap on the committed tree at
  // 1 crank-degree sampling: 0.0030 cm, against which STAND_TOL leaves room.
  const STAND_TOL = 5e-3, PEN_TOL = 1e-3; // cm
  const faceR = H.bucketRadius, faceLimit = faceR - 0.15; // the published walk limit
  let pen = 0, penAt = null, stand = 0, standAt = null, walk = 0, walkAt = null, lifted = 0;
  let maxVerts = 0, maxOutlineR = 0, lobeWidth = 0;
  for (let theta = 0; theta < 720; theta += 1) {
    update(theta);
    group.updateMatrixWorld(true);
    for (const cyl of SPEC.cylinders) {
      for (const valve of valves) {
        const lobe = group.getObjectByName(`lobe-cyl${cyl.num}-${valve}`);
        const bucket = group.getObjectByName(`bucket-cyl${cyl.num}-${valve}`);
        assert.ok(lobe && bucket, `cyl ${cyl.num} ${valve}: lobe or bucket missing from the tree`);
        const lift = valveLift(cyl, valve, theta);
        if (lift > 1e-9) lifted++;
        const capPt = camAxisPoint(cyl, valve);
        cap.fromArray([capPt.x, capPt.y, capPt.z]);
        d.fromArray(valveAxisDir(cyl, valve));
        across.crossVectors(CAM_AXIS, d).normalize(); // across the face, in the profile plane
        // the face plane comes off the posed bucket, not off a formula: the
        // render squares every follower part to its valve axis (createValvetrain
        // setFromUnitVectors(Z_AXIS, valveAxisDir)), so the cup top face is
        // bucketHeight / 2 under the posed centroid along that axis.
        bucket.getWorldPosition(wc);
        const face = underCam(cap, d, wc) - H.bucketHeight / 2;
        assert.ok(face >= H.camBaseRadius - STAND_TOL,
          `cyl ${cyl.num} ${valve} at theta ${theta}: bucket face at ${face.toFixed(4)} cm is inside the cam base circle ${H.camBaseRadius}`);
        let reach = -Infinity, reachAcross = 0;
        const pos = lobe.geometry.attributes.position;
        if (pos.count > maxVerts) maxVerts = pos.count;
        lobe.geometry.computeBoundingBox();
        const bb = lobe.geometry.boundingBox;
        if (bb && bb.max.x - bb.min.x > lobeWidth) lobeWidth = bb.max.x - bb.min.x;
        for (let i = 0; i < pos.count; i++) {
          q.fromBufferAttribute(pos, i).applyMatrix4(lobe.matrixWorld).sub(cap);
          const depth = -q.dot(d); // cm below the cam axis, along the follower axis
          if (depth - face > pen) { pen = depth - face; penAt = [cyl.num, valve, theta, +depth.toFixed(4), +face.toFixed(4)]; }
          if (depth > reach) { reach = depth; reachAcross = Math.abs(q.dot(across)); }
          const radial = Math.hypot(q.dot(d), q.dot(across)); // out of the cam axis, in the profile plane
          if (radial > maxOutlineR) maxOutlineR = radial;
        }
        const gap = face - reach;
        if (gap > stand) { stand = gap; standAt = [cyl.num, valve, theta, +lift.toFixed(4)]; }
        if (reachAcross > walk) { walk = reachAcross; walkAt = [cyl.num, valve, theta, +lift.toFixed(4)]; }
      }
    }
  }
  // Printed so a GATES row can quote the measured half of this oracle from the
  // run record itself, instead of hand-copying numbers into the doc.
  console.log(`A1-G1 mesh audit: 720 crank samples x 16 followers, verts/lobe ${maxVerts}, ` +
    `lobe width ${lobeWidth.toFixed(4)} cm, max outline radius ${maxOutlineR.toFixed(4)} cm, ` +
    `worst penetration ${pen.toFixed(4)} cm, worst stand-off gap ${stand.toFixed(4)} cm, ` +
    `worst contact walk ${walk.toFixed(4)} cm of ${faceLimit.toFixed(2)} cm, lifted samples ${lifted}`);
  assert.ok(pen < PEN_TOL,
    `a lobe mesh crosses its follower face by ${pen.toFixed(4)} cm at ${JSON.stringify(penAt)} (tol ${PEN_TOL})`);
  assert.ok(stand < STAND_TOL,
    `a follower stands off its lobe by ${stand.toFixed(4)} cm at ${JSON.stringify(standAt)} (tol ${STAND_TOL})`);
  assert.ok(walk <= faceLimit,
    `the contact patch runs ${walk.toFixed(4)} cm across a ${faceR} cm tappet face (limit ${faceLimit} cm)`);
  assert.ok(lifted >= 8 * 2 * 2, `only ${lifted} follower samples were lifted over the cycle: the lobes never reach their tappets`);
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

test('nothing floats: one continuous cam journal through all 7 bearing windows, drive sprockets in the crank nose plane', async () => {
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
    assert.ok(jbb.min.x < SPEC.block.stations[3] - SPEC.cam.bearingHalf && jbb.max.x > bands[3] + CS.width,
      `${name}: journal ${jbb.min.x}..${jbb.max.x} does not run from the aft bearing through the sprocket`);
    // A1-G7: every one of the 7 published bearing windows has to be carried by the
    // drawn camshaft journal itself, at the published cam journal radius - the
    // bearing shell in the head rides on that, on the published oil film. Nothing
    // else may stand in the window: a wider part there is a part that cannot be
    // built, because the head machines its line bore around it.
    const br = bearingStack();
    for (const bx of SPEC.cam.bearings) {
      const win = windowBand(cam, capPt, bx, SPEC.cam.bearingHalf);
      assert.ok(win.tris > 0, `${name}: nothing drawn of the camshaft reaches the bearing window ${bx} +/- ${SPEC.cam.bearingHalf}`);
      assert.deepEqual(win.who, [`camshaft-${bank}-${valve}`],
        `${name} x${bx}: the bearing window holds ${win.who.join(', ')} at ${win.hi.toFixed(4)} cm off the cam axis - the window of a ${br.boreR} cm line bore carries the ${br.journalR} cm cam journal and nothing else`);
      assert.ok(Math.abs(win.hi - br.journalR) <= 1e-4,
        `${name} x${bx}: what the bearing shell rides on stands at ${win.hi.toFixed(4)} cm off the cam axis, not the published ${br.journalR} cm cam journal radius (the head bores at ${br.boreR} cm for the ${br.shellWall} cm shell over it)`);
      assert.ok(win.hi <= br.shellIdR - br.oilFilm / 2,
        `${name} x${bx}: the journal at ${win.hi.toFixed(4)} cm reaches into the ${br.shellIdR} cm shell bore, leaving less than half the published ${br.oilFilm} cm oil film`);
    }
    const sb = new THREE.Box3().setFromObject(cam.getObjectByName(`cam-sprocket-${bank}-${valve}`));
    assert.ok(sb.min.x > bands[i] - 0.06 && sb.max.x < bands[i] + CS.width + 0.06,
      `${name}: sprocket x ${sb.min.x}..${sb.max.x} not in band ${bands[i]}`);
    const fore = SPEC.cam.bearings[SPEC.cam.bearings.length - 1] + SPEC.cam.bearingHalf;
    assert.ok(sb.min.x >= fore - EPS,
      `${name}: the sprocket band starts at ${sb.min.x.toFixed(3)} and reaches into the fore bearing window that ends at ${fore}`);
    const maxR = Math.max(Math.abs(sb.max.y - capPt.y), Math.abs(sb.min.y - capPt.y),
      Math.abs(sb.max.z - capPt.z), Math.abs(sb.min.z - capPt.z));
    assert.ok(maxR <= CS.pitchR + CS.toothH + 0.2, `${name}: sprocket radial envelope ${maxR}`);
    assert.ok(maxR >= CS.pitchR + CS.toothH * 0.4, `${name}: sprocket teeth too small`);
    assert.equal(count(cam, 'bearing-'), 0, `${name}: the cam carries no bearing collar - the journal is the camshaft`);
  }
});

// A1-G7 (issue #8 addendum item 4): the bearing stack crosses two renderers, so
// one law has to measure across them. test/heads.test.mjs gates the head side -
// the line bore, the shell wall, the shell bore the journal rides in. This gates
// the cam side against the drawn head: the closest real approach between the
// drawn camshaft journal and the drawn bearing shells of its own cam line has to
// be the published oil film, measured with test/support/surface-clearance.mjs.
// What stands in the bearing window besides the journal - the collars this fix
// deletes - is gated by the window law in the test above.
test('A1-G7 the drawn cam journal rides the drawn bearing shells on exactly the published oil film', async () => {
  const { group } = await buildValvetrain();
  group.updateMatrixWorld(true);
  const mats = new Proxy({}, {
    get: (t, k) => (t[k] ??= new THREE.MeshStandardMaterial({ name: String(k) })),
  });
  const heads = createHeads(mats).group;
  heads.updateMatrixWorld(true);
  const br = bearingStack();
  const rows = [];
  for (const name of camGroupNames) {
    const bank = name.split('-')[1], valve = name.split('-')[2];
    const journal = group.getObjectByName(name).getObjectByName(`camshaft-${bank}-${valve}`);
    assert.ok(journal, `${name}: camshaft journal missing`);
    const shells = newShell();
    let halves = 0;
    for (const o of heads.getObjectByName(`head-${bank}`).children) {
      if (o.userData.kind !== 'shell' || o.userData.valve !== valve) continue;
      shellAdd(shells, o);
      halves += 1;
    }
    assert.equal(halves, 14, `${name}: 14 shell halves (7 columns, cradle + cap) expected on this cam line`);
    const near = closestToShell(journal, shells);
    assert.ok(Number.isFinite(near.d),
      `${name}: nothing of the drawn journal came within ${REACH} cm of a drawn bearing shell - the cam does not meet its bearings where the head says they sit`);
    rows.push(`${bank} ${valve} -> ${near.into} ${near.d.toFixed(4)}`);
    // Both sides are bored rings cut as polygons, and the polygon step is the
    // 0.006 cm facet tolerance test/heads.test.mjs already measures the shell
    // bore with. The published film is the number, the facets are the tolerance.
    assert.ok(Math.abs(near.d - br.runningClearance) <= 0.006,
      `${name}: the journal stands ${near.d.toFixed(4)} cm from ${near.into} while the published oil film under the shell is ${br.oilFilm} cm (${br.journalR} cm journal + ${br.oilFilm} cm film = ${br.shellIdR} cm shell bore). A bearing either has its film or it does not.`);
  }
  console.log(`A1-G7 cam journal to bearing shell clearance (cm): ${rows.join('; ')}; published film ${br.oilFilm} cm`);
});

// ---- A1-G2 / A1-G1: the cam chain drive (issue #4) -------------------------
// One roller chain per DOHC camshaft, each in its own published band, driven
// from the crank nose. The acceptance bar issue #4 sets is a REAL chain:
// 18/36 teeth at the published 3.45 / 6.9 pitch radii and the derived 1.204 cm
// pitch, tooth spaces machined from the roller profile so the rollers ride IN
// the gaps, no link and no tooth crossing each other, and all four cam
// sprockets wrapped from the crank. Every number below is either read out of
// SPEC.crank.sprocket / SPEC.cam.sprocket by src/engine/drive.js, or measured
// off the drawn solids - never typed into this file.
const CH = SPEC.chain;
const CS = SPEC.crank.sprocket;
const KS = SPEC.cam.sprocket;
const BANDS = KS.bands;
const BANDS_ORDER = ['cam-L-intake', 'cam-L-exhaust', 'cam-R-intake', 'cam-R-exhaust'];
const chainNames = BANDS_ORDER.map((g) => `cam-chain-${g.slice(4)}`);

async function buildDrive() {
  const { createDrive } = await import('../src/render/drive.js');
  const mats = {};
  for (const n of ['chainSteel', 'camShaft', 'anodized'])
    mats[n] = new THREE.MeshStandardMaterial({ name: n });
  return createDrive(mats);
}
async function buildCrank() {
  const { createCranktrain } = await import('../src/render/cranktrain.js');
  const mats = {};
  for (const n of ['crankShaft', 'chainSteel', 'metal', 'journalBearing', 'shell', 'bolt', 'cap', 'web'])
    mats[n] = new THREE.MeshStandardMaterial({ name: n });
  return createCranktrain(mats);
}

const inPlane = (v) => ({ y: v.y, z: v.z });
const planeDist = (a, b) => Math.hypot(a.y - b.y, a.z - b.z);
const planeAz = (a) => wrap360(Math.atan2(a.y, a.z) / DEG);

/**
 * World-space profile vertices of a sprocket mesh, in the (y, z) plane the
 * chain runs in, relative to that sprocket's own axis.
 */
function profile(mesh, axis) {
  mesh.updateWorldMatrix(true, false);
  const pos = mesh.geometry.attributes.position;
  const v = new THREE.Vector3();
  const out = [];
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    out.push({ y: v.y - axis.y, z: v.z - axis.z, w: { y: v.y, z: v.z } });
  }
  const r = out.map((p) => Math.hypot(p.y, p.z));
  const min = Math.min(...r), max = Math.max(...r);
  return { pts: out, minR: min, maxR: max };
}

/**
 * Machined tooth spaces read OUT OF THE DRAWN SOLID: the vertices that belong
 * to a gap are the ones standing inside the tip circle, and each gap's cutter
 * arc is fitted to them by least squares. Returns the cutter centre and radius,
 * so this file never re-derives what the renderer machined.
 */
function machinedGaps(mesh, axis, teeth, bore = 0) {
  const { pts } = profile(mesh, axis);
  const tipR = Math.max(...pts.map((p) => Math.hypot(p.y, p.z)));
  const seen = new Map(); // the extrusion repeats every contour point on each wall
  const cand = [];
  for (const p of pts) {
    const r = Math.hypot(p.y, p.z);
    if (r > tipR - 1e-6) continue; // the tooth tip land: not part of a cutter arc
    if (r <= bore + 1e-6) continue; // the bored spigot it runs on: not part of a cutter arc
    const key = `${p.y.toFixed(9)}|${p.z.toFixed(9)}`;
    if (seen.has(key)) continue;
    seen.set(key, p);
    cand.push(p);
  }
  // The gap floors are what the drawing machines lowest, so they are the seeds;
  // every other flank vertex belongs to the floor it stands nearest to.
  const floorR = Math.min(...cand.map((p) => Math.hypot(p.y, p.z)));
  const groups = cand
    .filter((p) => Math.hypot(p.y, p.z) <= floorR + 1e-6)
    .map((p) => ({ az: planeAz(p), pts: [] }));
  for (const p of cand) {
    const a = planeAz(p);
    let best = 0, bestD = Infinity;
    groups.forEach((g, i) => {
      const d = Math.abs(((a - g.az + 180) % 360 + 360) % 360 - 180);
      if (d < bestD) { bestD = d; best = i; }
    });
    groups[best].pts.push(p);
  }
  const gaps = [];
  for (const [k, entry] of groups.map((g, i) => [i, g])) {
    const ps = entry.pts;
    if (ps.length < 3) continue;
    let sy = 0, sz = 0, syy = 0, szz = 0, syz = 0, sry = 0, srz = 0;
    for (const p of ps) {
      const r2 = p.y * p.y + p.z * p.z;
      sy += p.y; sz += p.z; syy += p.y * p.y; szz += p.z * p.z; syz += p.y * p.z; sry += r2 * p.y; srz += r2 * p.z;
    }
    const n = ps.length;
    const a11 = syy - sy * sy / n, a12 = syz - sy * sz / n, a22 = szz - sz * sz / n;
    const b1 = sry - sy * (syy + szz) / n, b2 = srz - sz * (syy + szz) / n;
    // 2*(a11*cy + a12*cz) = b1, 2*(a12*cy + a22*cz) = b2 for the linearized
    // circle equation y2+z2 - 2 c.p + const = 0.
    const det = a11 * a22 - a12 * a12;
    const cy = (b1 * a22 - b2 * a12) / (2 * det), cz = (b2 * a11 - b1 * a12) / (2 * det);
    const rad = ps.reduce((s, p) => s + Math.hypot(p.y - cy, p.z - cz), 0) / n;
    gaps.push({ k, cy, cz, rad, az: planeAz({ y: cy, z: cz }), n: ps.length });
  }
  // profile() already stands every point off the sprocket's own axis, so its
  // own minR is the drawn bore radius and its maxR is the drawn tip circle
  const { minR } = profile(mesh, axis);
  return { gaps, tipR, minR };
}

test('A1-G2 every cam-drive number derives from the two published sprockets', async () => {
  const { chainPitch, wrapRadius, gapCutR, tipRadius, rootRadius, hubRadius } = await import('../src/engine/drive.js');
  assert.ok(!('pitch' in CH) && !('pitchR' in CH) && !('teeth' in CH),
    'SPEC.chain must not type a pitch or tooth count of its own: the drive derives them from the sprockets');
  const p = chainPitch();
  const arc = (sp) => (2 * Math.PI * sp.pitchR) / sp.teeth;
  assert.ok(Math.abs(p - arc(KS)) < 1e-12 && Math.abs(p - arc(CS)) < 1e-12,
    `chain pitch ${p} must be the shared pitch circle of both sprockets`);
  assert.ok(Math.abs(p - 1.204) < 5e-4, `the published drive pitch is 1.204 cm, measured ${p.toFixed(5)}`);
  // A chain sprocket's tip circle is a machined consequence of the roller it
  // has to carry: the roller stands in the gap with its outer edge at the tip.
  for (const sp of [CS, KS]) {
    const want = sp.pitchR + p / 2 - CH.rollerR;
    assert.ok(Math.abs(tipRadius(sp.pitchR) - want) < 1e-9,
      `${sp.teeth}T tip radius ${tipRadius(sp.pitchR)} != pitchR + pitch/2 - rollerR = ${want}`);
    assert.ok(Math.abs(rootRadius(sp.pitchR) - (sp.pitchR - gapCutR())) < 1e-9,
      `${sp.teeth}T root radius must sit one cutter radius below the pitch circle`);
    assert.ok(rootRadius(sp.pitchR) > sp.bore,
      `${sp.teeth}T bore ${sp.bore} leaves no web under the machined root ${rootRadius(sp.pitchR)}`);
  }
  // The chain wraps the polygon through the gap centres, not the tip circle.
  for (const sp of [CS, KS]) {
    const wr = wrapRadius(sp.teeth);
    assert.ok(wr > sp.pitchR && wr < tipRadius(sp.pitchR),
      `${sp.teeth}T wrap radius ${wr} must lie between the pitch circle and the tip`);
    const chord = 2 * wr * Math.sin(Math.PI / sp.teeth);
    assert.ok(Math.abs(chord - p) < 1e-9, `${sp.teeth}T rollers one tooth apart must be one pitch apart`);
  }
  // Printed, not typed: every derived drive number this row quotes comes out of
  // this run record, so the doc can re-quote it without hand-copying a figure.
  console.log(`A1-G2 drive derivation: pitch ${p.toFixed(13)} cm = 2pi x ${CS.pitchR}/${CS.teeth}T = 2pi x ${KS.pitchR}/${KS.teeth}T; `
    + `wrap seat ${wrapRadius(CS.teeth).toFixed(4)}/${wrapRadius(KS.teeth).toFixed(4)} cm, polygon action ${(wrapRadius(CS.teeth) - CS.pitchR).toFixed(6)}/${(wrapRadius(KS.teeth) - KS.pitchR).toFixed(6)} cm; `
    + `cutter ${gapCutR().toFixed(4)} cm, tip ${tipRadius(CS.pitchR).toFixed(4)}/${tipRadius(KS.pitchR).toFixed(4)} cm, `
    + `root ${rootRadius(CS.pitchR).toFixed(4)}/${rootRadius(KS.pitchR).toFixed(4)} cm, hub ${hubRadius(CS.pitchR).toFixed(4)}/${hubRadius(KS.pitchR).toFixed(4)} cm`);
});

test('A1-G2 the loop is a whole number of links: whole teeth, take-up inside the published travel', async () => {
  const { driveContract, chainPitch, gapCutR, tipRadius } = await import('../src/engine/drive.js');
  const dc = driveContract();
  const p = chainPitch();
  assert.equal(dc.chainCount, 4, 'one chain per DOHC camshaft');
  assert.deepEqual(dc.bands, BANDS);
  for (const r of dc.runs) {
    const step1 = 360 / CS.teeth, step2 = 360 / KS.teeth;
    assert.ok(Number.isInteger(r.wrap.crank) && Number.isInteger(r.wrap.cam), 'wraps must be whole teeth');
    assert.equal(r.wrap.crank * step1 + r.wrap.cam * step2, 360,
      `wrap ${r.wrap.crank}T crank + ${r.wrap.cam}T cam must close 360 deg of chain turn`);
    assert.equal(r.linkCount, r.rollers.length, 'one roller per link');
    assert.ok(Math.abs(r.loop - r.linkCount * p) < 1e-9, 'the loop is linkCount links of the pitch');
    for (const key of ['A', 'B']) {
      const s = r.spans[key];
      assert.ok(Number.isInteger(s.links) && s.links > 1, `span ${key} carries a whole number of links`);
      assert.ok(s.takeUp > 1e-9, `span ${key}: a taut chain must not need the links stretched`);
      assert.ok(s.takeUp <= CH.tensionerTravel,
        `span ${key} closure ${s.takeUp.toFixed(4)} cm exceeds the published tensioner travel ${CH.tensionerTravel}`);
      assert.ok(s.distance <= s.links * p, `span ${key} is longer than its ${s.links} rigid links`);
      assert.ok(s.bow.rise > 0 && s.bow.rise < 2, `span ${key} bow ${s.bow.rise} is not a chain deflection`);
    }
    assert.equal(r.linkCount % 2, 0, 'an even link count closes without a bending link');
    assert.ok(gapCutR() > CH.rollerR, 'the machined gap must be bigger than the roller it carries');
  }
  assert.equal(new Set(dc.linkCounts).size, 1, 'all four chains are the same length');
  assert.equal(new Set(dc.wrapCounts).size, 1, 'all four chains wrap the same number of teeth');
  const D = dc.runs[0].D;
  // A spur pair would have to stand at the sum of its pitch radii; the two axes
  // are 36.48 cm apart, so no 3.45 / 6.9 gear pair can ever touch - the chain
  // is not a stylistic choice here, it is the only way this geometry works.
  assert.ok(D > tipRadius(CS.pitchR) + tipRadius(KS.pitchR),
    `a direct gear mesh needs the axes at ${tipRadius(CS.pitchR) + tipRadius(KS.pitchR)} cm or nearer, they stand ${D} cm apart`);
  assert.ok(Math.abs(D - (CS.pitchR + KS.pitchR)) > 25,
    `the pitch radii sum to ${CS.pitchR + KS.pitchR} while the axes stand ${D} apart`);
  const r0 = dc.runs[0];
  console.log(`A1-G2 chain loops: ${dc.chainCount} chains in bands ${dc.bands.join('/')} cm, ${r0.linkCount} links of ${p.toFixed(4)} cm `
    + `each wrapping ${r0.wrap.crank}T crank + ${r0.wrap.cam}T cam (loop ${r0.loop.toFixed(4)} cm), cam axes ${D.toFixed(4)} cm from the crank `
    + `against a ${tipRadius(CS.pitchR) + tipRadius(KS.pitchR)} cm tip-sum and a ${CS.pitchR + KS.pitchR} cm pitch-sum`);
  for (const key of ['A', 'B']) {
    const s = r0.spans[key];
    console.log(`A1-G2 span ${key}: ${s.distance.toFixed(4)} cm between seats on ${s.links} rigid links, take-up ${s.takeUp.toFixed(4)} cm `
      + `of ${CH.tensionerTravel} cm published travel, bow rise ${s.bow.rise.toFixed(4)} cm on a R ${s.bow.R.toFixed(2)} cm arc`);
  }
});

test('A1-G2 four chains, one per DOHC camshaft, each riding its own published band', async () => {
  const { driveContract } = await import('../src/engine/drive.js');
  const dc = driveContract();
  const { group } = await buildDrive();
  group.updateMatrixWorld(true);
  const seen = new Map();
  for (let i = 0; i < chainNames.length; i++) {
    const ch = group.getObjectByName(chainNames[i]);
    assert.ok(ch, `chain group ${chainNames[i]} missing`);
    const bb = new THREE.Box3().setFromObject(ch);
    const lo = BANDS[i], hi = BANDS[i] + KS.width;
    assert.ok(bb.min.x >= lo + CH.bandClr - 1e-6 && bb.max.x <= hi - CH.bandClr + 1e-6,
      `${ch.name}: chain x ${bb.min.x.toFixed(4)}..${bb.max.x.toFixed(4)} outside band ${lo}..${hi} by >= ${CH.bandClr}`);
    assert.equal(count(ch, `${ch.name}-roller-`), dc.runs[i].linkCount,
      `${ch.name}: ${count(ch, `${ch.name}-roller-`)} drawn rollers for the ${dc.runs[i].linkCount} links the measured chain has`);
    console.log(`${ch.name}: drawn x ${bb.min.x.toFixed(4)}..${bb.max.x.toFixed(4)} cm inside its published band ${lo}..${hi} cm, `
      + `${count(ch, `${ch.name}-roller-`)} rollers on the measured ${dc.runs[i].loop.toFixed(4)} cm loop`);
    seen.set(lo, ch.name);
    for (const kind of ['guide', 'tensioner'])
      assert.ok(ch.getObjectByName(`${ch.name}-${kind}`), `${ch.name}: ${kind} missing`);
  }
  assert.equal(seen.size, 4, 'four distinct bands');
  for (let i = 1; i < BANDS.length; i++) {
    const a = group.getObjectByName(chainNames[i - 1]), b = group.getObjectByName(chainNames[i]);
    const pa = new THREE.Box3().setFromObject(a), pb = new THREE.Box3().setFromObject(b);
    assert.ok(pb.min.x - pa.max.x >= CH.bandClr - 1e-6,
      `chains ${a.name} and ${b.name} touch: ${pa.max.x.toFixed(4)} vs ${pb.min.x.toFixed(4)}`);
  }
});

test('A1-G2 the drawn chain is the measured chain: one roller per link, every link exactly the pitch', async () => {
  const { chainLayout, chainPitch } = await import('../src/engine/drive.js');
  const { group } = await buildDrive();
  group.updateMatrixWorld(true);
  const p = chainPitch();
  for (const bank of ['L', 'R']) {
    for (const valve of ['intake', 'exhaust']) {
      const name = `cam-chain-${bank}-${valve}`;
      const ch = group.getObjectByName(name);
      const rollers = [];
      ch.traverse((o) => { if (o.name.startsWith(`${name}-roller-`)) rollers.push(o); });
      const lay = chainLayout(bank, valve);
      assert.equal(rollers.length, lay.linkCount,
        `${name}: ${rollers.length} drawn rollers for ${lay.linkCount} links`);
      let worst = 0;
      for (const o of rollers) worst = Math.max(worst, Math.abs(o.userData.pitch - p));
      assert.ok(worst < 1e-9, `${name}: worst drawn link ${worst.toFixed(9)} cm off the ${p.toFixed(5)} cm pitch`);
      const centres = rollers.map((o) => inPlane(new THREE.Vector3().setFromMatrixPosition(o.matrixWorld)));
      for (let i = 0; i < centres.length; i++) {
        const a = centres[i], b = centres[(i + 1) % centres.length];
        assert.ok(Math.abs(planeDist(a, b) - p) < 1e-6,
          `${name}: drawn roller ${i} to ${i + 1} stands ${planeDist(a, b).toFixed(6)} cm, need ${p.toFixed(6)}`);
      }
    }
  }
});

test('A1-G2 the tooth spaces are machined where the chain engages them, with the roller\'s own air', async () => {
  const { chainLayout, gapCutR } = await import('../src/engine/drive.js');
  const { group } = await buildDrive();
  const vt = await buildValvetrain();
  const crank = await buildCrank();
  group.updateMatrixWorld(true);
  vt.group.updateMatrixWorld(true);
  crank.group.updateMatrixWorld(true);
  let worstAir = 9, leastAir = 9, checked = 0;
  for (const bank of ['L', 'R']) {
    for (const valve of ['intake', 'exhaust']) {
      const name = `cam-chain-${bank}-${valve}`;
      const ch = group.getObjectByName(name);
      const lay = chainLayout(bank, valve);
      const cam = vt.group.getObjectByName(`cam-${bank}-${valve}`);
      const sp = cam.getObjectByName(`cam-sprocket-${bank}-${valve}`);
      const axis = { y: lay.cam.y, z: lay.cam.z };
      const { gaps, tipR, minR } = machinedGaps(sp, axis, KS.teeth, KS.bore);
      assert.ok(Math.abs(minR - KS.bore) < 1e-3,
        `${sp.name}: drawn bore ${minR.toFixed(4)} cm is not the ${KS.bore} cm cam journal it must run on`);
      assert.ok(Math.abs(tipR - (KS.pitchR + chainPitchOf(KS) / 2 - CH.rollerR)) < 1e-3,
        `${sp.name}: drawn tip circle ${tipR.toFixed(4)} cm is not the machined one`);
      assert.equal(gaps.length, KS.teeth, `${sp.name}: ${gaps.length} machined gaps drawn, need ${KS.teeth}`);
      for (const g of gaps) {
        assert.ok(Math.abs(g.rad - gapCutR()) < 1e-3,
          `${sp.name} gap ${g.k}: cutter radius ${g.rad.toFixed(4)} != rollerR + gapClr ${gapCutR()}`);
        assert.ok(Math.abs(Math.hypot(g.cy, g.cz) - KS.pitchR) < 1e-3,
          `${sp.name} gap ${g.k}: cutter centred at radius ${Math.hypot(g.cy, g.cz).toFixed(4)}, need the pitch circle ${KS.pitchR}`);
      }
      // every roller the chain puts on this sprocket
      const onCam = ch.children.filter((o) => o.name.startsWith(`${name}-roller-`) && o.userData.on === 'cam');
      assert.ok(onCam.length >= 2, `${name}: no rollers on the cam sprocket`);
      for (const o of onCam) {
        const c = inPlane(new THREE.Vector3().setFromMatrixPosition(o.matrixWorld));
        const rel = { y: c.y - lay.cam.y, z: c.z - lay.cam.z };
        let best = 9;
        for (const g of gaps) best = Math.min(best, Math.hypot(rel.y - g.cy, rel.z - g.cz));
        const air = gapCutR() - best - CH.rollerR;
        assert.ok(best + CH.rollerR <= gapCutR(),
          `${name}: roller at ${planeAz(rel).toFixed(2)} deg stands ${best.toFixed(4)} from the gap centre and crosses its wall`);
        worstAir = Math.min(worstAir, air); checked += 1;
        assert.ok(Math.hypot(rel.y, rel.z) < tipR, `${name}: roller stands outside the tip circle it is supposed to ride in`);
      }
      // and the crank side of the same chain
      const lane = crank.group.getObjectByName('crank').getObjectByName('sprocket')
        .getObjectByName(`sprocket-lane-${BANDS_ORDER.indexOf(`cam-${bank}-${valve}`)}`);
      assert.ok(lane, `crank sprocket lane for ${name} missing`);
      const cg = machinedGaps(lane, { y: 0, z: 0 }, CS.teeth, CS.bore);
      assert.ok(Math.abs(cg.minR - CS.bore) < 1e-3,
        `crank lane ${lane.name}: drawn bore ${cg.minR.toFixed(4)} cm is not the ${CS.bore} cm nose spigot it is machined on`);
      assert.equal(cg.gaps.length, CS.teeth, `crank lane ${lane.name}: ${cg.gaps.length} gaps, need ${CS.teeth}`);
      const onCrank = ch.children.filter((o) => o.name.startsWith(`${name}-roller-`) && o.userData.on === 'crank');
      assert.ok(onCrank.length >= 2, `${name}: no rollers on the crank sprocket`);
      for (const o of onCrank) {
        const c = inPlane(new THREE.Vector3().setFromMatrixPosition(o.matrixWorld));
        let best = 9;
        for (const g of cg.gaps) best = Math.min(best, Math.hypot(c.y - g.cy, c.z - g.cz));
        worstAir = Math.min(worstAir, gapCutR() - best - CH.rollerR); checked += 1;
        assert.ok(best + CH.rollerR <= gapCutR(),
          `${name}: crank roller stands ${best.toFixed(4)} off its gap centre and crosses the machined wall`);
      }
      leastAir = Math.min(leastAir, gapCutR());
    }
  }
  assert.ok(checked >= 4 * (2 + 2), `${checked} engaged rollers measured, too few to call this a drive`);
  assert.ok(worstAir > 0.02, `the tightest machined air around a roller is ${worstAir.toFixed(4)} cm`);
  assert.ok(worstAir <= CH.gapClr + 1e-3,
    `worst air ${worstAir.toFixed(4)} cm exceeds the published running clearance ${CH.gapClr}`);
  function chainPitchOf(sp) { return (2 * Math.PI * sp.pitchR) / sp.teeth; }
});

test('A1-G2 no drawn tooth crosses a drawn roller, and no chain plate shares x with a tooth', async () => {
  const { chainPitch } = await import('../src/engine/drive.js');
  const { group } = await buildDrive();
  const vt = await buildValvetrain();
  const crank = await buildCrank();
  for (const g of [group, vt.group, crank.group]) g.updateMatrixWorld(true);
  const p = chainPitch();
  let worst = 0, worstAt = '';
  for (const bank of ['L', 'R']) {
    for (const valve of ['intake', 'exhaust']) {
      const name = `cam-chain-${bank}-${valve}`;
      const ch = group.getObjectByName(name);
      const i = BANDS_ORDER.indexOf(`cam-${bank}-${valve}`);
      const rollers = ch.children.filter((o) => o.name.startsWith(`${name}-roller-`));
      const cam = vt.group.getObjectByName(`cam-${bank}-${valve}`);
      const meshes = [
        cam.getObjectByName(`cam-sprocket-${bank}-${valve}`),
        crank.group.getObjectByName('crank').getObjectByName('sprocket').getObjectByName(`sprocket-lane-${i}`),
      ];
      const axisOf = [
        { y: rollers[0].userData.axis.y, z: rollers[0].userData.axis.z },
        { y: 0, z: 0 },
      ];
      for (let m = 0; m < meshes.length; m++) {
        const { pts } = profile(meshes[m], axisOf[m]);
        for (const o of rollers) {
          const c = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
          for (const q of pts) {
            const d = Math.hypot(q.w.y - c.y, q.w.z - c.z);
            if (worstAt === '' || d < worst) { worst = d; worstAt = `${name} roller to ${meshes[m].name}`; }
          }
        }
      }
      // side plates vs the tooth lane they have to clear
      const plates = ch.children.filter((o) => o.name.startsWith(`${name}-plates`));
      assert.equal(plates.length, 2, `${name}: a roller chain has two side-plate layers, got ${plates.length}`);
      const lanes = [
        new THREE.Box3().setFromObject(meshes[0]),
        new THREE.Box3().setFromObject(meshes[1]),
      ];
      for (const pl of plates) {
        const pb = new THREE.Box3().setFromObject(pl);
        for (const lb of lanes) {
          // a plate is clear when it lies wholly before or wholly behind the
          // tooth lane it runs beside: the air is then the nearer of the two
          // measured gaps, which is the LARGER of these two signed numbers
          const clear = Math.max(pb.min.x - lb.max.x, lb.min.x - pb.max.x);
          assert.ok(clear >= CH.plateClr - 1e-6,
            `${name} plate x ${pb.min.x.toFixed(4)}..${pb.max.x.toFixed(4)} shares x with a tooth lane ${lb.min.x.toFixed(4)}..${lb.max.x.toFixed(4)} (air ${clear.toFixed(4)})`);
        }
      }
      const plateLayers = plates.map((pl) => new THREE.Box3().setFromObject(pl));
      const inner = Math.min(plateLayers[0].max.x, plateLayers[1].max.x);
      const outer = Math.max(plateLayers[0].min.x, plateLayers[1].min.x);
      assert.ok(outer - inner >= CH.channel - 1e-6,
        `${name}: the channel between its plate layers is ${outer - inner}, need ${CH.channel} for a ${CH.toothW} tooth`);
      assert.ok(outer - inner <= CH.channel + 1e-6, `${name}: channel ${outer - inner} wider than published`);
      const xOf = (b) => `${b.min.x.toFixed(4)}..${b.max.x.toFixed(4)}`;
      console.log(`${name}: two plate layers x ${xOf(plateLayers[0])} and x ${xOf(plateLayers[1])} cm `
        + `leave a ${outer - inner} cm channel for the ${CH.toothW} cm tooth they ride beside`);
      // adjacent rollers on the drawn loop stand one pitch apart: a chain whose
      // own links overlap is not a chain
      let worstJoint = 9;
      for (const o of rollers) {
        const c = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
        for (const q of rollers) {
          if (q === o) continue;
          const e = new THREE.Vector3().setFromMatrixPosition(q.matrixWorld);
          const d = Math.hypot(c.y - e.y, c.z - e.z);
          if (d < worstJoint) worstJoint = d;
        }
      }
      assert.ok(worstJoint >= p - 1e-6,
        `${name}: its closest pair of drawn rollers stands ${worstJoint.toFixed(4)} cm apart, under the ${p.toFixed(4)} cm pitch`);
    }
  }
  assert.ok(worst >= CH.rollerR - 1e-6,
    `a tooth vertex stands ${worst.toFixed(4)} cm from a roller centre - ${worstAt}`);
});

test('A1-G2 the drive is a chain riding in the gaps, not a band over the sprocket tips', async () => {
  const { tipRadius } = await import('../src/engine/drive.js');
  const { group } = await buildDrive();
  group.updateMatrixWorld(true);
  for (const bank of ['L', 'R']) {
    for (const valve of ['intake', 'exhaust']) {
      const name = `cam-chain-${bank}-${valve}`;
      const ch = group.getObjectByName(name);
      const rollers = ch.children.filter((o) => o.name.startsWith(`${name}-roller-`));
      const lay = rollers[0].userData.layout;
      const onCam = rollers.filter((o) => o.userData.on === 'cam');
      const onCrank = rollers.filter((o) => o.userData.on === 'crank');
      const camR = onCam.map((o) => planeDist(inPlane(new THREE.Vector3().setFromMatrixPosition(o.matrixWorld)), lay.cam));
      const crankR = onCrank.map((o) => Math.hypot(o.userData.rel.y, o.userData.rel.z));
      const tipC = tipRadius(CS.pitchR), tipK = tipRadius(KS.pitchR);
      assert.ok(Math.max(...camR) < tipK && Math.max(...crankR) < tipC,
        `${name}: a wrap roller stands outside its sprocket's tip circle - the chain would ride over the teeth`);
      assert.ok(Math.min(...camR) > tipK - CH.rollerR - 1e-6 && Math.min(...crankR) > tipC - CH.rollerR - 1e-6,
        `${name}: a wrap roller is cut deeper than the tip circle minus the roller radius`);
      const perGap = new Map();
      for (const o of rollers) {
        if (o.userData.gap === undefined) continue;
        const k = `${o.userData.on}:${o.userData.gap}`;
        perGap.set(k, (perGap.get(k) ?? 0) + 1);
      }
      for (const [k, n] of perGap)
        assert.equal(n, 1, `machined ${k} carries ${n} rollers: one roller per gap`);
      assert.equal(perGap.size, rollers.filter((o) => o.userData.gap !== undefined).length,
        `${name}: gaps are double-booked`);
    }
  }
});

test('A1-G1 no chain part, sprocket lane or shoe crosses the fore casting plane', async () => {
  const { group } = await buildDrive();
  const crank = await buildCrank();
  const vt = await buildValvetrain();
  for (const g of [group, crank.group, vt.group]) g.updateMatrixWorld(true);
  const FACE = SPEC.head.deckFore ?? SPEC.crank.sprocket.x0; // 28.6: the machined shoulder
  const bb = new THREE.Box3().setFromObject(group);
  assert.ok(bb.min.x >= CS.x0 - 1e-6, `chain drive reaches x ${bb.min.x.toFixed(4)} behind the sprocket plane ${CS.x0}`);
  for (const bank of ['L', 'R']) {
    for (const valve of ['intake', 'exhaust']) {
      const cam = vt.group.getObjectByName(`cam-${bank}-${valve}`);
      const sp = new THREE.Box3().setFromObject(cam.getObjectByName(`cam-sprocket-${bank}-${valve}`));
      assert.ok(sp.min.x >= FACE - 1e-6, `cam sprocket for ${bank} ${valve} reaches ${sp.min.x.toFixed(4)} into the head shoulder at ${FACE}`);
    }
  }
  const lanes = crank.group.getObjectByName('crank').getObjectByName('sprocket');
  assert.ok(lanes, 'crank nose sprocket group missing');
  for (let i = 0; i < BANDS.length; i++) {
    const lane = lanes.getObjectByName(`sprocket-lane-${i}`);
    assert.ok(lane, `crank sprocket lane ${i} missing: four DOHC sprockets need four lanes`);
    const lb = new THREE.Box3().setFromObject(lane);
    assert.ok(Math.abs(lb.min.x - (BANDS[i] + KS.width / 2 - CH.toothW / 2)) < 1e-3,
      `crank lane ${i} sits at ${lb.min.x.toFixed(4)}..${lb.max.x.toFixed(4)}, not centred in band ${BANDS[i]}`);
  }
  assert.equal(count(lanes, 'sprocket-lane-'), 4, 'one 18-tooth lane per chain');
});

test('A1-G1 the chain holds its pose, its link length and its gap lock through a full 720 deg cycle', async () => {
  const { driveContract, chainPose, chainPitch, gapCutR, wrapRadius } = await import('../src/engine/drive.js');
  const dc = driveContract();
  const p = chainPitch();
  let worstLink = 0, worstSeat = 0, worstAir = 9, seats = 0;
  let takeMin = 9, takeMax = 0, hops = 0;
  const seenWrap = new Map();
  const seenHop = new Set();
  for (let theta = 0; theta < 720; theta += 2) {
    for (const lay of dc.runs) {
      const pose = chainPose(lay, theta);
      assert.equal(pose.rollers.length, lay.linkCount, `link count changed at crank ${theta}`);
      const c1 = wrapRadius(CS.teeth), c2 = wrapRadius(KS.teeth);
      for (const r of pose.rollers) {
        if (r.on === 'crank') {
          assert.ok(Math.abs(planeDist(r, { y: 0, z: 0}) - c1) < 1e-6,
            `crank wrap roller left the wrap circle at crank ${theta}`);
        } else if (r.on === 'cam') {
          assert.ok(Math.abs(planeDist(r, lay.cam) - c2) < 1e-6,
            `cam wrap roller left the wrap circle at crank ${theta}`);
        }
      }
      for (const l of pose.links) worstLink = Math.max(worstLink, Math.abs(l.chord - p));
      for (const key of ['A', 'B']) {
        const s = pose.spans[key];
        takeMin = Math.min(takeMin, s.takeUp);
        takeMax = Math.max(takeMax, s.takeUp);
        assert.ok(s.takeUp > 1e-9 && s.takeUp <= CH.tensionerTravel,
          `span ${key} closure ${s.takeUp.toFixed(4)} at crank ${theta} outside the published travel ${CH.tensionerTravel}`);
      }
      // the drawn sprockets turn at the ratio the teeth realise: crank theta,
      // cam theta/2. The chain's seats must sit in those rotated gaps.
      for (const r of pose.rollers) {
        if (r.gap === undefined) continue;
        seats += 1;
        const rel = r.on === 'cam' ? { y: r.y - lay.cam.y, z: r.z - lay.cam.z } : r;
        const gap = r.on === 'cam' ? pose.gaps.cam[r.gap] : pose.gaps.crank[r.gap];
        const off = Math.hypot(rel.y - gap.y, rel.z - gap.z);
        worstSeat = Math.max(worstSeat, off);
        worstAir = Math.min(worstAir, gapCutR() - off - CH.rollerR);
      }
      seenWrap.set(`${pose.wrap.crank}+${pose.wrap.cam}`, (seenWrap.get(`${pose.wrap.crank}+${pose.wrap.cam}`) ?? 0) + 1);
      seenHop.add(`${pose.engagement.h1}:${pose.engagement.h2}`);
      hops = seenHop.size;
    }
  }
  // A rigid-link chain seats on the polygon through the gap centres, not on the
  // arc-pitch circle the gaps are machined from, so the seating offset is the
  // polygon action - derived here from the published pitch and tooth counts,
  // never typed - and it has to fit inside the air the gaps are cut with.
  const polygonAction = Math.max(
    wrapRadius(CS.teeth) - CS.pitchR,
    wrapRadius(KS.teeth) - KS.pitchR,
  );
  console.log(`A1-G2 720 deg cycle at 2 crank degrees x 4 chains: seated rollers ${seats}, worst seating offset ${worstSeat.toFixed(6)} cm = the polygon action ${polygonAction.toFixed(6)} cm, `
    + `tightest roller air inside a machined gap ${worstAir.toFixed(4)} cm of the ${CH.gapClr} cm published clearance, `
    + `worst link error ${worstLink.toFixed(9)} cm of the ${p.toFixed(4)} cm pitch, take-up band ${takeMin.toFixed(4)}..${takeMax.toFixed(4)} cm of ${CH.tensionerTravel} cm travel, `
    + `engagement steps ${[...seenWrap.keys()].join('/')}, wrap-centre hops ${hops}`);
  assert.ok(worstLink < 1e-6, `worst drawn link off the pitch over 720 deg: ${worstLink.toFixed(9)} cm`);
  assert.ok(Math.abs(worstSeat - polygonAction) < 1e-9,
    `worst roller-to-gap seating offset ${worstSeat.toFixed(9)} cm is not the polygon action ${polygonAction.toFixed(9)} cm`);
  assert.ok(worstSeat <= gapCutR() - CH.rollerR + 1e-9,
    `seating offset ${worstSeat.toFixed(9)} cm exceeds the ${gapCutR() - CH.rollerR} cm the gaps are cut with`);
  assert.ok(worstAir > 0.02, `tightest roller air over the cycle: ${worstAir.toFixed(4)} cm`);
  assert.ok(seats >= 4 * 720 / 2 * 2, `${seats} seated rollers measured over the cycle`);
  for (const [k, n] of seenWrap) assert.ok(n > 0, k);
});

test('A1-G2 the guide and the tensioner ride the two bows the closure needs', async () => {
  const { driveContract, chainPose } = await import('../src/engine/drive.js');
  const { group } = await buildDrive();
  group.updateMatrixWorld(true);
  const dc = driveContract();
  for (const lay of dc.runs) {
    const name = `cam-chain-${lay.bank}-${lay.valve}`;
    const ch = group.getObjectByName(name);
    const guide = ch.getObjectByName(`${name}-guide`);
    const shoe = ch.getObjectByName(`${name}-tensioner`);
    assert.ok(guide.userData.onSpan && shoe.userData.onSpan, `${name}: guide/shoe not assigned to a span`);
    assert.notEqual(guide.userData.onSpan, shoe.userData.onSpan, `${name}: guide and tensioner on the same span`);
    const pose = chainPose(lay, 0);
    for (const [kind, obj, spanKey] of [['guide', guide, guide.userData.onSpan], ['tensioner', shoe, shoe.userData.onSpan]]) {
      const s = pose.spans[spanKey];
      const apex = s.apex;
      const c = new THREE.Vector3().setFromMatrixPosition(obj.matrixWorld);
      const d = Math.hypot(c.y - apex.y, c.z - apex.z);
      assert.ok(d < 1e-3, `${name} ${kind} is ${d.toFixed(4)} cm off the bow apex it is supposed to ride`);
      assert.ok(Math.abs(obj.userData.padRise - s.bow.rise) < 1e-6,
        `${name} ${kind} pad rise ${obj.userData.padRise} != measured span closure rise ${s.bow.rise}`);
      assert.ok(s.takeUp <= CH.tensionerTravel || kind === 'guide',
        `${name}: the guide span closure ${s.takeUp.toFixed(4)} needs the tensioner`);

      // The pad has to be machined CLEAR of the chain it rides, and it has to
      // stand where the bow says - not hovering somewhere safe and useless.
      // Both bounds come from the drawn solid and the span's own arc numbers.
      const pad = obj.children.find((o) => o.isMesh);
      assert.ok(pad, `${name} ${kind}: no pad solid drawn on its mount`);
      const pg = pad.geometry.attributes.position;
      let loY = 9, hiY = -9, loZ = 9, hiZ = -9;
      for (let i = 0; i < pg.count; i++) {
        loY = Math.min(loY, pg.getY(i)); hiY = Math.max(hiY, pg.getY(i));
        loZ = Math.min(loZ, pg.getZ(i)); hiZ = Math.max(hiZ, pg.getZ(i));
      }
      const run = hiY - loY;
      const inv = new THREE.Matrix4().copy(pad.matrixWorld).invert();
      let air = 9;
      for (const o of ch.children.filter((x) => x.name.startsWith(`${name}-roller-`))) {
        const p = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).applyMatrix4(inv);
        // the pad only ever turns about world X, so a roller (its swept volume a
        // cylinder of rollerR along that same axis) reduces to its centre point
        // standing off the pad rectangle in the (y, z) plane
        const dy = Math.max(Math.abs(p.y) - hiY, Math.abs(p.y) - -loY, 0);
        const dz = p.z > hiZ ? p.z - hiZ : (p.z < loZ ? loZ - p.z : 0);
        air = Math.min(air, Math.hypot(dy, dz) - CH.rollerR);
      }
      assert.ok(air >= CH.plateClr - 1e-9,
        `${name} ${kind}: its pad stands only ${air.toFixed(4)} cm clear of the rollers it rides (need the published ${CH.plateClr} cm air)`);
      const sag = s.bow.R - Math.sqrt(s.bow.R * s.bow.R - (run / 2) * (run / 2));
      assert.ok(air <= CH.plateClr + sag + 1e-6,
        `${name} ${kind}: its pad stands ${air.toFixed(4)} cm off the chain when the bow lets it stand at most ${CH.plateClr + sag} - it is not riding its span`);
      console.log(`${name} ${kind} on span ${spanKey}: pad face ${pad.userData.faceGap} cm off the roller centres, `
        + `pad run ${run.toFixed(4)} cm sagging ${sag.toFixed(4)} cm on the span's R ${s.bow.R.toFixed(2)} cm bow, `
        + `tightest pad-to-roller air ${air.toFixed(4)} cm against the published ${CH.plateClr} cm, in ${pad.material.name}`);
    }
  }
});

// ---------------------------------------------------------------------------
// P1-G7 / A1-G7 OHV clause (issue #8 addendum item 1): THE BUILD SWITCH.
// A DOHC head and an OHV block are two builds of one engine, and the tree may
// name either only through src/engine/layout.js, which reads the switch
// published in SPEC.build.variant. These laws gate the CONTRACT, not a drawing:
// the counts, the 2:1 drive, the axis placement an OHV cam has to stand at, the
// outline a clearance law has to read, and the fact that the OHV valvetrain is
// published but NOT drawn - so no later row can call it built. Placement
// numbers are the ones issue #16 measures against this casting.
// ---------------------------------------------------------------------------

const OHV_LAW = 'P1-G7/A1-G7 the OHV build contract';

const ohvLayout = async () => await import('../src/engine/layout.js');

test(`${OHV_LAW}: the switch is published, names exactly two variants, and every valvetrain count derives from it`, async () => {
  const L = await ohvLayout();
  assert.equal(SPEC.build.variant, 'dohc', 'the shipped build has to say which variant it is');
  assert.deepEqual(Object.keys(SPEC.variants).sort(), ['dohc', 'ohv'],
    `SPEC.variants carries ${Object.keys(SPEC.variants || {}).join(', ')}; the addendum promises a DOHC default beside an OHV small-block`);
  const banks = Object.keys(SPEC.banks).length;
  const valves = SPEC.cylinders.length * 2;
  assert.equal(L.cams('dohc'), banks * 2, `the DOHC build runs one cam line per bank side, so ${banks * 2}`);
  assert.equal(L.cams('ohv'), 1, 'the OHV build runs ONE central cam, not a pair per bank');
  assert.equal(L.cams(), L.cams(SPEC.build.variant), 'cams() with no argument has to read the published switch');
  for (const id of ['dohc', 'ohv']) {
    assert.equal(L.lobes(id), valves, `${id}: ${valves} valves need ${valves} lobes`);
    assert.equal(L.lobes(id) % L.cams(id), 0, `${id}: the ${L.lobes(id)} lobes have to divide evenly over ${L.cams(id)} cam(s)`);
  }
  assert.equal(L.lobes('ohv'), 16, 'the addendum names a central 16-lobe cam');
  assert.deepEqual(L.followers('dohc'), { lifters: 0, pushrods: 0, rockers: 0, covers: 0, valves: 16, springs: 16 },
    'the DOHC build rides lobes and buckets: it casts and draws no lifters, pushrods, rockers or rocker '
    + 'covers, and it does owe the 16 valves and 16 springs it draws');
  assert.deepEqual(L.followers('ohv'), { lifters: 16, pushrods: 16, rockers: 16, covers: 2, valves: 16, springs: 16 },
    'the OHV build owes one lifter, one pushrod and one rocker per valve, one cover per bank, and the '
    + '16 valves and 16 springs its head seats: issue #51 option B publishes the valve families as '
    + 'owed so the gap the screenshot gate counts is a declared gap of this variant');
  assert.throws(() => L.cams('flathead'), /unknown build variant "flathead"/,
    'a switch value nobody published has to be refused by name, not answered with a silent default');
  console.log(`${OHV_LAW} counts: switch ${SPEC.build.variant}; dohc ${L.cams('dohc')} cams / ${L.lobes('dohc')} lobes / `
    + `${JSON.stringify(L.followers('dohc'))}; ohv ${L.cams('ohv')} cam / ${L.lobes('ohv')} lobes / ${JSON.stringify(L.followers('ohv'))}`);
});

test(`${OHV_LAW}: the OHV variant drives its single central cam 2:1 from the crank on the two published pitch circles and the shared chain pitch`, async () => {
  const L = await ohvLayout();
  const { chainPitch } = await import('../src/engine/drive.js');
  const d = L.drive('ohv');
  assert.equal(d.crankTeeth, CS.teeth, 'the crank end of the OHV drive is the published crank sprocket');
  assert.equal(d.crankPitchR, CS.pitchR, 'the crank end of the OHV drive is the published crank pitch circle');
  assert.equal(d.camTeeth, CS.teeth * SPEC.cam.halfSpeedRatio,
    `the cam end has to carry twice the crank's ${CS.teeth} teeth for the published ${SPEC.cam.halfSpeedRatio}:1`);
  assert.equal(d.camPitchR, CS.pitchR * SPEC.cam.halfSpeedRatio,
    `and twice the crank's ${CS.pitchR} cm pitch circle, or the two ends stop sharing one chain pitch`);
  assert.equal(d.camTeeth, KS.teeth, 'the OHV cam sprocket is the published cam sprocket, not a second one');
  assert.equal(d.camPitchR, KS.pitchR, 'the OHV cam sprocket runs on the published cam pitch circle');
  assert.equal(d.camBore, KS.bore, 'and it is bored on the cam journal the published sprocket hub presses onto');
  const pitch = chainPitch();
  assert.ok(Math.abs(d.pitch - pitch) < 1e-12,
    `the OHV drive has to ride the same ${pitch.toFixed(13)} cm pitch the DOHC chains ride, measured ${d.pitch}`);
  const Cc = L.ohvCam().belowCrankCm;
  assert.ok(Cc > d.camPitchR + 0.5, `a cam stood ${Cc} cm from the crank cannot carry a ${d.camPitchR} cm pitch circle`);
  const alpha = Math.asin((d.camPitchR - d.crankPitchR) / Cc);
  const span = Math.hypot(Cc, 0) * Math.cos(alpha);
  const loop = 2 * span
    + ((Math.PI - 2 * alpha) / (2 * Math.PI)) * 2 * Math.PI * d.crankPitchR
    + ((Math.PI + 2 * alpha) / (2 * Math.PI)) * 2 * Math.PI * d.camPitchR;
  const links = loop / pitch;
  const whole = Math.round(links);
  assert.ok(Math.abs(links - whole) * pitch <= CH.tensionerTravel + 1e-9,
    `the loop the published pitch circles and ${Cc} cm of centre distance describe is ${links.toFixed(3)} links, `
    + `${(Math.abs(links - whole) * pitch).toFixed(3)} cm off a whole ${whole} links - more take-up than the published ${CH.tensionerTravel} cm tensioner travel gives`);
  console.log(`${OHV_LAW} drive: ${d.crankTeeth}T/${d.camTeeth}T at ${d.crankPitchR}/${d.camPitchR} cm pitch circles `
    + `on ${pitch.toFixed(13)} cm pitch, span ${span.toFixed(4)} cm at ${Cc} cm centre distance, `
    + `wrap ${(((Math.PI - 2 * alpha) / (2 * Math.PI)) * CS.teeth).toFixed(2)}/${(((Math.PI + 2 * alpha) / (2 * Math.PI)) * KS.teeth).toFixed(2)} whole teeth, `
    + `loop ${links.toFixed(3)} links against ${whole} with ${CH.tensionerTravel} cm of take-up`);
});

test(`${OHV_LAW}: the published OHV cam axis clears everything that swings past it in the crankcase, read against the widest outline the cam has`, async () => {
  const L = await ohvLayout();
  const { bankUp } = await import('../src/engine/spec.js');
  const { pistonAlong } = await import('../src/engine/timing.js');
  const cam = L.ohvCam();
  const Cc = cam.belowCrankCm;
  const tunnel = L.camTunnel('ohv');
  const worst = L.worstOutlineR('ohv');
  const K = SPEC.crank;
  const swings = [
    ['connecting-rod big end', K.radius + SPEC.rod.bigEndRadius],
    ['counterweight lobe tip', K.counterRadius],
    ['crank pin sweep', K.radius + K.pinRadius],
  ];
  const margins = [];
  for (const [name, sweep] of swings) {
    const air = Cc - sweep - worst;
    assert.ok(air >= 0.4,
      `a cam stood ${Cc} cm below the crank centre leaves the ${name} (sweeps ${sweep.toFixed(2)} cm) only `
      + `${air.toFixed(3)} cm past its widest outline ${worst.toFixed(4)} cm - the OHV placement needs 0.4 cm`);
    const columnAir = Cc - sweep - tunnel.faceR;
    assert.ok(columnAir >= 0.4,
      `at a bearing column bored to ${tunnel.faceR.toFixed(2)} cm the ${name} keeps ${columnAir.toFixed(3)} cm, `
      + `and the lobes swing in the open valley between the columns`);
    margins.push(`${name} ${air.toFixed(3)}/${columnAir.toFixed(3)}`);
  }
  // The liner is the tunnel this block casts, not the axis it is bored on.
  const clampSeg = (p, a, b) => {
    const ab = [b[0] - a[0], b[1] - a[1]];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / (ab[0] * ab[0] + ab[1] * ab[1])));
    return Math.hypot(p[0] - a[0] - t * ab[0], p[1] - a[1] - t * ab[1]);
  };
  const axis = [0, -Cc];
  const linerReadings = [];
  for (const bank of Object.keys(SPEC.banks)) {
    const u = bankUp(bank).slice(1);
    const near = clampSeg(axis, [SPEC.block.boreStartA * u[0], SPEC.block.boreStartA * u[1]],
      [SPEC.block.deckA * u[0], SPEC.block.deckA * u[1]]);
    const cast = near - SPEC.block.boreShellRadius;
    assert.ok(cast - worst >= 0.3,
      `bank ${bank}: the cam's widest outline stands only ${(cast - worst).toFixed(3)} cm clear of the nearest `
      + `liner material this block casts (${near.toFixed(3)} cm to the bored tunnel, shell radius ${SPEC.block.boreShellRadius})`);
    const axisLine = Math.abs(axis[0] * u[1] - axis[1] * u[0]) - SPEC.block.boreShellRadius;
    assert.ok(axisLine > 0, `bank ${bank}: the cam axis stands inside the bored liner axis line itself (${axisLine.toFixed(3)} cm) - the tunnel would swallow it`);
    assert.ok(cast > axisLine,
      `bank ${bank}: the reading that gates is the clamped tunnel (${cast.toFixed(3)} cm), not the infinite bored axis (${axisLine.toFixed(3)} cm)`);
    linerReadings.push(`${bank} tunnel material ${cast.toFixed(3)} cm / bored-axis line ${axisLine.toFixed(3)} cm`);
  }
  // The piston skirt bottom disc, read at its own lowest published pose.
  let skirtWorst = Infinity;
  let skirtBank = '';
  for (const cyl of SPEC.cylinders) {
    const u = bankUp(cyl.bank).slice(1);
    let lowest = Infinity;
    for (let th = 0; th < 720; th += 1) lowest = Math.min(lowest, pistonAlong(cyl, th));
    const s = lowest - SPEC.piston.skirtLength;
    const near = Math.hypot(axis[0] - s * u[0], axis[1] - s * u[1]) - SPEC.piston.radius;
    if (near < skirtWorst) { skirtWorst = near; skirtBank = `cyl ${cyl.num} (${cyl.bank}) at ${lowest.toFixed(3)} cm up its bore`; }
  }
  skirtWorst -= worst;
  assert.ok(skirtWorst >= 0.3,
    `the cam's widest outline ${worst.toFixed(4)} cm stands ${skirtWorst.toFixed(3)} cm clear of the nearest piston `
    + `skirt bottom (${skirtBank}, skirt ${SPEC.piston.skirtLength} cm below the pin, radius ${SPEC.piston.radius}) - 0.3 cm needed`);
  // And the consequence this casting cannot dodge: the bored tunnel breaks below
  // the face the pan rails and the test stand are built on.
  const floorZ = cam.tunnelFloorZ;
  assert.ok(Math.abs(floorZ - (-Cc - tunnel.faceR)) < 1e-9,
    `the tunnel floor has to be the published centre distance plus the machined face, measured ${floorZ}`);
  const below = -floorZ - SPEC.block.caseOuterRadius;
  assert.ok(below > 0, `row A1-G6 has to fix this before the OHV cam can be cast: the bored tunnel floor at ${floorZ} cm `
    + `stands ${below.toFixed(2)} cm below the crankcase drum this tree casts (caseOuterRadius ${SPEC.block.caseOuterRadius}), `
    + `and ${(-floorZ - SPEC.block.panRailZ).toFixed(2)} cm below the pan-rail face at ${SPEC.block.panRailZ}`);
  assert.equal(SPEC.variants.ohv.drawn, true, 'every law in this block reads the OHV cam tunnel as cast iron: the variant has to say so');
  console.log(`${OHV_LAW} placement: C ${Cc} cm on the bisector, tunnel bore ${tunnel.boreR.toFixed(4)} / face ${tunnel.faceR.toFixed(4)} / floor ${floorZ.toFixed(2)} cm, `
    + `widest outline ${worst.toFixed(4)} cm; swings ${margins.join('; ')} (lobe sweep / bearing column); `
    + `liners ${linerReadings.join('; ')}; skirt bottom ${skirtWorst.toFixed(3)} cm; tunnel floor ${below.toFixed(2)} cm under caseOuterRadius ${SPEC.block.caseOuterRadius}`);
});

test(`${OHV_LAW}: a cam clearance law reads the widest outline the cam can present, and a base-circle law reports a clearance the cam does not have`, async () => {
  const L = await ohvLayout();
  const { lobeProfileRadius, lobeHalfCamDeg, camLiftCm } = await import('../src/engine/timing.js');
  const { noseR } = await import('../src/engine/bearings.js');
  const base = SPEC.head.camBaseRadius;
  const R = SPEC.variants.ohv.rockerRatio;
  const dohc = { lift: camLiftCm('dohc'), nose: L.noseMaxRadius('dohc') };
  const ohv = { lift: camLiftCm('ohv'), nose: L.worstOutlineR('ohv') };
  assert.ok(Math.abs(dohc.nose - noseR) < 1e-9,
    `the DOHC cam's widest outline is the ground nose the bearing stack already publishes (${noseR}), measured ${dohc.nose}`);
  assert.ok(Math.abs(ohv.nose - Math.max(lobeProfileRadius('intake', 0, ohv.lift), lobeProfileRadius('exhaust', 0, ohv.lift))) < 1e-9,
    `the widest outline this variant's 16-lobe cam can present in ANY direction is the ground nose of its own lobes on its own ${ohv.lift.toFixed(4)} cm grind`);
  assert.ok(Math.abs(ohv.nose - L.noseMaxRadius('ohv')) < 1e-9, 'worstOutlineR and noseMaxR are one published number per variant, not two tunable ones');
  assert.ok(Math.abs(ohv.lift * R - SPEC.valves.maxLift) < 1e-12,
    `the OHV grind of ${ohv.lift.toFixed(4)} cm over the ${R}:1 rocker restores ${ohv.lift.toFixed(4)} x ${R} = ${(ohv.lift * R).toFixed(4)} cm, not the published ${SPEC.valves.maxLift} cm of valve lift`);
  assert.ok(ohv.nose < dohc.nose,
    `a rocker ratio of ${R}:1 has to move this variant's nose inwards: measured ${ohv.nose.toFixed(4)} against the DOHC nose ${dohc.nose.toFixed(4)} its buckets ride directly`);
  assert.ok(Math.abs(L.bestOutlineR() - base) < 1e-9, 'and the narrowest either cam presents is the base circle it is ground on');
  assert.ok(ohv.nose > L.bestOutlineR(), 'if the two were equal the direction would not matter, and it does');
  const halfCam = lobeHalfCamDeg('intake');
  assert.ok(Math.abs(lobeProfileRadius('intake', halfCam, ohv.lift) - base) < 1e-6,
    `a lobe is a base circle with a nose on it: ${halfCam.toFixed(2)} cam degrees off its nose it has to be back on ${base}`);
  const gap = ohv.nose - L.bestOutlineR();
  const baseCircleLaw = SPEC.crank.radius + SPEC.rod.bigEndRadius + L.bestOutlineR();
  const realLaw = SPEC.crank.radius + SPEC.rod.bigEndRadius + ohv.nose;
  assert.ok(Math.abs(realLaw - baseCircleLaw - gap) < 1e-9, 'the two readings differ by exactly the nose over the base circle');
  assert.ok(realLaw > baseCircleLaw,
    `a law that clears the rod big end against the base circle (${baseCircleLaw.toFixed(3)} cm of centre distance) `
    + `asks for ${gap.toFixed(3)} cm less than the same law reading the outline the cam actually presents (${realLaw.toFixed(3)} cm)`);
  console.log(`${OHV_LAW} outline: base circle ${L.bestOutlineR().toFixed(4)} cm, DOHC nose ${dohc.nose.toFixed(4)} cm (${dohc.lift} cm grind), `
    + `OHV nose ${ohv.nose.toFixed(4)} cm (${ohv.lift.toFixed(4)} cm grind on a ${R}:1 rocker), `
    + `direction worth ${gap.toFixed(4)} cm of centre distance; rod-big-end floor ${baseCircleLaw.toFixed(3)} cm as a base-circle law, `
    + `${realLaw.toFixed(3)} cm as the law this row gates`);
});

test(`${OHV_LAW}: the OHV valvetrain is drawn where its host iron is cast, and every family still owed is named`, async () => {
  const L = await ohvLayout();
  const owed = L.followers('ohv');
  assert.equal(SPEC.variants.ohv.drawn, true, 'the block machines the 16 lifter bores and the build draws the 16 followers that stand in them: the switch has to say so');
  const pending = SPEC.variants.ohv.pendingHardware;
  assert.ok(Array.isArray(pending) && pending.length > 0, 'drawn: true beside an undrawn train is a claim the spec has to bound: pendingHardware has to name what is still owed');
  for (const p of pending) {
    assert.ok(owed[p.family] > 0, `pendingHardware names "${p.family}", which this variant's own contract does not owe (${JSON.stringify(owed)})`);
    assert.ok(/^#\d+$/.test(p.issue), `pendingHardware family "${p.family}" is not tied to an open issue: "${p.issue}"`);
    assert.ok(p.why && p.why.length > 10, `pendingHardware family "${p.family}" names no reason a reader can check`);
  }
  // the DOHC build beside it: four camshafts, buckets, and no lifter in it
  const dohc = (await buildValvetrain('dohc')).group;
  const wantDOHC = [...L.camGroupNames('dohc')].sort();
  assert.equal(wantDOHC.length, L.cams('dohc'), 'the switch has to name as many camshafts as it counts');
  for (const name of wantDOHC) assert.ok(dohc.getObjectByName(name), `the DOHC switch names the camshaft "${name}" and the drawn valve train has no such part`);
  // read the semantic kind, not a name prefix: 'cam-sprocket-*' shares the
  // prefix with 'cam-L-intake' and would poison a prefix-only filter
  const drawnDOHC = new Set();
  dohc.traverse((o) => { if (o.userData && o.userData.part === 'camshaft' && o.parent) drawnDOHC.add(o.parent.name); });
  assert.deepEqual([...drawnDOHC].sort(), wantDOHC,
    `the camshafts drawn in the DOHC valve train ${[...drawnDOHC].sort().join(', ')} have to be exactly the ones the switch names, ${wantDOHC.join(', ')}`);
  let dohcLifters = 0;
  dohc.traverse((o) => { if (o.name.toLowerCase().includes('lifter')) dohcLifters += 1; });
  assert.equal(dohcLifters, 0, `the DOHC build draws ${dohcLifters} lifter(s): that variant rides buckets on its overhead cams, not lifters in a block gallery`);

  // the OHV build: the one cam the switch names plus the followers its bores hold
  const ohv = (await buildValvetrain('ohv')).group;
  const wantOHV = [...L.camGroupNames('ohv')].sort();
  assert.equal(wantOHV.length, L.cams('ohv'), 'the OHV switch has to name as many camshafts as it counts');
  for (const name of wantOHV) assert.ok(ohv.getObjectByName(name), `the OHV switch names the camshaft "${name}" and the drawn valve train has no such part`);
  const G = L.ohvLifterGallery();
  const bores = Object.values(G.banks).flatMap((b) => b.bores.map((o) => o.name)).sort();
  const lifters = [];
  ohv.traverse((o) => { if (o.userData && o.userData.part === 'lifter') lifters.push(o.name); });
  assert.deepEqual(lifters.sort(), bores,
    `the lifters drawn in the OHV valve train (${lifters.length}: ${lifters.slice(0, 3).join(', ')}...) have to be exactly the ${bores.length} bores the block machines`);
  assert.equal(lifters.length, owed.lifters, `the OHV build draws ${lifters.length} lifters for the ${owed.lifters} its own contract counts`);
  // Slice 8J (issue #51 option A): the list is now MEASURED. pendingHardware has
  // to name exactly the families this build does not draw - a family listed while
  // drawn, or a gap drawn while unlisted, is a spec that has drifted from the
  // scene it describes. test/ohv-valve.test.mjs measures the same invariant off
  // the drawn metal; this law is the spec-side half.
  const drawnCount = (re) => {
    let n = 0;
    ohv.traverse((o) => { if (o.isMesh && re.test(o.name)) n += 1; });
    return n;
  };
  const drawnGroups = (re) => {
    const s = new Set();
    ohv.traverse((o) => { if (o.isGroup && re.test(o.name)) s.add(o.name); });
    return s.size;
  };
  const FAMILY_RE = {
    lifters: /^lifter-cyl/, valves: /^valve-cyl\d+-(intake|exhaust)$/, springs: /^spring-cyl\d+-(intake|exhaust)$/,
    pushrods: /pushrod/, rockers: /rocker/, covers: /(^|-)cover/,
  };
  const drawn = {
    lifters: lifters.length, valves: drawnGroups(FAMILY_RE.valves), springs: drawnCount(FAMILY_RE.springs),
    pushrods: drawnCount(FAMILY_RE.pushrods), rockers: drawnCount(FAMILY_RE.rockers), covers: drawnCount(FAMILY_RE.covers),
  };
  for (const [familyName, n] of Object.entries(drawn)) {
    const listed = pending.some((p) => p.family === familyName);
    assert.equal(listed, n === 0,
      `pendingHardware ${listed ? 'names' : 'does not name'} "${familyName}" while the OHV build draws ${n} of them: the list has to be the measured gap`);
    if (n > 0) assert.equal(n, owed[familyName], `the OHV build draws ${n} ${familyName} for the ${owed[familyName]} its own contract counts`);
  }
  const named = pending.map((p) => p.family).sort();
  assert.deepEqual(named, Object.keys(drawn).filter((k) => drawn[k] === 0).sort(),
    `pendingHardware has to name exactly the valvetrain families the OHV build does not draw, measured ${named.join(', ')}`);
  for (const family of named) {
    const p = pending.find((e) => e.family === family);
    assert.ok(/#16|#51|#45/.test(p.issue), `the "${family}" family is tied to ${p.issue}: the issue that owes it and the issue whose iron it waits on`);
  }
  // a pending family may not appear in the scene at all: hardware may not appear
  // before the iron that houses it is cast. The families that ARE drawn are
  // counted against the contract instead of refused.
  const PENDING_WORDS = { pushrods: ['pushrod', 'push-rod'], rockers: ['rocker'], covers: ['cover'] };
  for (const [familyName, words] of Object.entries(PENDING_WORDS)) {
    for (const word of words) {
      let hits = 0;
      ohv.traverse((o) => { if (o.name.toLowerCase().includes(word) || (o.userData && String(o.userData.kind || '').toLowerCase().includes(word))) hits += 1; });
      assert.equal(hits, 0, `the OHV build draws ${hits} part(s) for "${word}" while SPEC.variants.ohv.pendingHardware names that family owed: `
        + `hardware may not appear in the scene before the iron that houses it is cast`);
    }
  }
  // the families this build DOES draw have to answer the words the record and the
  // inspection menu use for them, at the count the contract owes
  for (const [word, want] of [['valve-', owed.valves], ['spring', owed.springs]]) {
    const groups = new Set();
    ohv.traverse((o) => { if (o.name.toLowerCase().includes(word)) groups.add(o.name.replace(/-(head|stem|retainer)$/, '')); });
    assert.equal(groups.size, want, `the OHV build answers "${word}" with ${groups.size} part(s) for the ${want} its own contract counts`);
  }
  console.log(`${OHV_LAW} drawn: switch ${SPEC.build.variant} -> dohc ${wantDOHC.join(', ')} with buckets, ohv ${wantOHV.join(', ')} with ${lifters.length} lifters in ${bores.length} bores; `
    + `still owed and named: ${pending.map((p) => `${p.family} (${owed[p.family]}, ${p.issue})`).join(', ')}`);
});

// ---------------------------------------------------------------------------
// SLICE 8C-3b (issue #16 option B, GATES A1-G6 / P1-G7 / A1-G7): the followers
// that ride the gallery slice 8C-3a machined. Written RED first: every law in
// this block measures a part that does not exist at the commit this block is
// committed at, and each was proven red on its own evidence before anything was
// implemented (tmp/v8-8c3b-red1.out).
//
// What this block does NOT close: the 16 pushrods, 16 rockers and 2 rocker
// covers the same contract owes (slice 8C-3c), and the drilling that feeds this
// gallery (row A1-G4, issue #16). SPEC.variants.ohv.drawn stays false until the
// whole train is drawn, and the laws that gate that switch say so.
// ---------------------------------------------------------------------------
const TRAIN = 'OHV-TRAIN';
const CORNER = 1e-4; // a float32 vertex can only hold a float64 machined value this closely

const ohvBuilt = async () => {
  const { createValvetrain } = await import('../src/render/valvetrain.js');
  const mats = {};
  for (const n of ['camShaft', 'camLobe', 'bucket', 'springSteel', 'valveIntake', 'valveExhaust', 'fastenerDark', 'chainSteel'])
    mats[n] = new THREE.MeshStandardMaterial({ name: n });
  const built = createValvetrain(mats, 'ohv');
  built.group.updateMatrixWorld(true);
  return built;
};

/** Every vertex of one drawn mesh, in world cm. */
function worldVerts(o) {
  o.updateWorldMatrix(true, false);
  const pos = o.geometry.attributes.position;
  const out = new Array(pos.count);
  for (let i = 0; i < pos.count; i++) out[i] = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
  return out;
}


/** One published lifter's own frame: its axis line, and how to read a point in it. */
function lifterFrame(L, f) {
  const d = new THREE.Vector3().fromArray(bankUp(f.bank));
  const origin = new THREE.Vector3(0, 0, -L.ohvHousing().belowCrankCm);
  const anchor = new THREE.Vector3(f.x, origin.y, origin.z); // the axis crosses the cam axis at x = the lobe centre
  return {
    d,
    origin,
    t: (p) => p.clone().sub(anchor).dot(d), // cm from the cam axis along the bore axis
    perp: (p) => { const v = p.clone().sub(anchor); return v.addScaledVector(d, -v.dot(d)).length(); },
    offCrank: (p) => Math.hypot(p.y, p.z),
    offCam: (p) => Math.hypot(p.y - origin.y, p.z - origin.z),
    // distance off the cylinder bore's own axis line: the liner this lifter must never enter
    offLiner: (p) => Math.abs(p.y * d.z - p.z * d.y),
  };
}

/**
 * The gallery iron this block casts for one bank, read in the frame its ribs are
 * extruded in (src/render/block.js ohvGalleryRib): x across the bank, `out` off
 * the crank axis in this bank's own out direction, `t` along the lifter axis from
 * the cam axis. Two prisms per rib - the mouth block at the full cast wall and
 * the guide wall standing on the room arc - and the bore that runs through both.
 */
function galleryIron(L, bank) {
  const G = L.ohvLifterGallery();
  const g = G.banks[bank];
  const up = bankUp(bank), outv = bankOut(bank);
  const ribOut = g.axisOut + G.boreRadius + G.castWallCm;
  const prisms = [
    { t0: g.guideFrom, t1: g.stepT, in: g.ribIn },
    { t0: g.stepT, t1: g.guideTo, in: g.wallIn },
  ];
  return {
    // the rib's shape carries sgn * out and its basis carries sgn * outv, so the
    // two signs cancel: a world point reads back as out = p . outv for BOTH banks
    at: (p) => ({ x: p.x, t: (p.y * up[1] + p.z * up[2]) - g.axisAlong, out: p.y * outv[1] + p.z * outv[2] }),
    inIron: (q) => prisms.find((pr) => q.t >= pr.t0 && q.t <= pr.t1 && q.out >= pr.in && q.out <= ribOut) || null,
    inBore: (q) => (q.t < g.guideFrom - CORNER || q.t > g.guideTo + CORNER ? null
      : g.bores.find((b) => Math.hypot(q.x - b.x, q.out - g.axisOut) <= G.boreRadius + CORNER) || null),
    ribOut, prisms,
  };
}

test(`${TRAIN}: the 16 bores the OHV block machines publish the 16 followers that stand in them`, async () => {
  const L = await ohvLayout();
  const E = await import('../src/engine/ohv.js');
  const G = L.ohvLifterGallery();
  const Hs = L.ohvHousing();
  const F = L.ohvLifters();
  const cam = E.ohvCamLayout();
  const owed = L.followers('ohv').lifters;
  assert.equal(F.lifters.length, owed, `the switch owes ${owed} lifters for ${SPEC.cylinders.length} valves and the gallery publishes ${F.lifters.length}`);
  const bores = Object.values(G.banks).flatMap((b) => b.bores.map((o) => o.name)).sort();
  assert.deepEqual(F.lifters.map((o) => o.name).sort(), bores,
    'a lifter has to be the part the block bored a bore for, same name, nothing extra: gallery '
    + `${bores.length} bores, followers ${F.lifters.length}`);
  const centre = new Map(cam.lobes.map((l) => [`${l.cyl.num}-${l.valve}`, l.centre]));
  const base = SPEC.head.camBaseRadius;
  for (const f of F.lifters) {
    const g = G.banks[f.bank];
    const key = `cyl${f.cyl}-${f.valve}`;
    assert.ok(Math.abs(f.radius - G.stemRadius) < 1e-9, `${key}: the lifter body is ${f.radius} cm, not the ${G.stemRadius} cm the bore's own running clearance leaves`);
    assert.ok(Math.abs(f.boreRadius - G.boreRadius) < 1e-9, `${key}: its bore reads ${f.boreRadius} cm against the ${G.boreRadius} cm the gallery machines`);
    assert.ok(Math.abs(f.radius + f.oilFilm - f.boreRadius) < 1e-9,
      `${key}: body ${f.radius} + film ${f.oilFilm} does not equal its bore ${f.boreRadius} - the oil film has to BE the clearance between a lifter and its bore`);
    assert.ok(Math.abs(f.x - centre.get(`${f.cyl}-${f.valve}`)) < 1e-9,
      `${key}: the lifter stands at x ${f.x} but the lobe it rides is centred at x ${centre.get(`${f.cyl}-${f.valve}`)} - a follower has to stand over its own lobe`);
    assert.ok(Math.abs(f.length - g.bodyLength) < 1e-9, `${key}: body length ${f.length} is not the ${g.bodyLength} cm the gallery derives`);
    assert.ok(Math.abs(f.faceMin - base) < 1e-9,
      `${key}: at zero lift its cam-side face stands at t ${f.faceMin}, not on the ${base} cm ground base circle it rides`);
    assert.ok(Math.abs(f.faceMax - Hs.worstOutlineR) < 1e-9,
      `${key}: at full lift its face stands at t ${f.faceMax}, not on the ${Hs.worstOutlineR} cm outline the cam sweeps`);
    assert.ok(Math.abs(f.topMax - g.bodyTop) < 1e-9,
      `${key}: at full lift its outboard end reaches t ${f.topMax}, past the ${g.bodyTop} cm station where a body this wide stands on the ${G.reliefR} cm room the crank swings are owed`);
    assert.ok(f.faceMin < G.tunnelBoreR,
      `${key}: its foot at t ${f.faceMin} never reaches the machined tunnel face at ${G.tunnelBoreR}, so it could not ride a lobe that turns in that tunnel`);
    assert.ok(f.engagementMin > 0,
      `${key}: at zero lift the body is held by only ${f.engagementMin} cm of guide, so it would come out of its bore`);
    assert.ok(Math.abs(f.engagementMax - (f.guideTo - f.guideFrom)) < 1e-9,
      `${key}: at full lift it is held by ${f.engagementMax} cm of a guide ${f.guideTo - f.guideFrom} cm long`);
    assert.ok(f.crankClearR >= G.reliefR,
      `${key}: the closest its body ever comes to the crank axis is ${f.crankClearR.toFixed(4)} cm, inside the ${G.reliefR} cm room the crank-side swings are owed`);
    assert.ok(f.crankClearR - G.maxSweep >= G.crankSideAirCm - 1e-9,
      `${key}: ${f.crankClearR.toFixed(4)} cm off the crank against a ${G.maxSweep.toFixed(4)} cm swing is ${(f.crankClearR - G.maxSweep).toFixed(4)} cm of air, under the ${G.crankSideAirCm} cm this variant publishes`);
    assert.ok(f.linerClearR >= SPEC.block.boreShellRadius,
      `${key}: its body comes within ${f.linerClearR.toFixed(4)} cm of its cylinder's bore axis, and this block casts liner iron out to ${SPEC.block.boreShellRadius} cm`);
  }
  const f0 = F.lifters[0];
  console.log(`${TRAIN} derivation: ${F.lifters.length} lifters, body r ${f0.radius.toFixed(5)} in a ${f0.boreRadius.toFixed(5)} bore (film ${f0.oilFilm.toFixed(4)}), `
    + `length ${f0.length.toFixed(5)}, face t ${f0.faceMin.toFixed(5)}..${f0.faceMax.toFixed(5)}, outboard end ${f0.topMin.toFixed(5)}..${f0.topMax.toFixed(5)}, `
    + `guide ${f0.guideFrom.toFixed(5)}..${f0.guideTo.toFixed(5)} holding ${f0.engagementMin.toFixed(5)}..${f0.engagementMax.toFixed(5)} cm, `
    + `nearest approach to the crank ${f0.crankClearR.toFixed(5)} (room ${G.reliefR.toFixed(4)}, sweep ${G.maxSweep.toFixed(4)}), `
    + `off its cylinder's bore axis ${f0.linerClearR.toFixed(5)} (liner shell ${SPEC.block.boreShellRadius})`);
});

test(`${TRAIN}: the OHV build draws 16 lifters, each one inside the void its block bores for it`, async () => {
  const L = await ohvLayout();
  const E = await import('../src/engine/ohv.js');
  const G = L.ohvLifterGallery();
  const F = L.ohvLifters();
  const built = await ohvBuilt(); // the baked pose is theta = 0, and theta = 0 is not zero lift for every lobe
  const perBank = { L: 0, R: 0 };
  const rows = [];
  for (const f of F.lifters) {
    const m = built.group.getObjectByName(f.name);
    assert.ok(m && m.isMesh, `the block machined a lifter bore named "${f.name}" and the OHV valve train draws no such part`);
    assert.equal(m.userData.part, 'lifter', `${f.name}: userData.part reads "${m.userData.part}" - the inspection menu has to read a lifter`);
    assert.equal(m.userData.cyl, f.cyl, `${f.name}: userData.cyl reads ${m.userData.cyl}, not cylinder ${f.cyl}`);
    const g = G.banks[f.bank];
    const fr = lifterFrame(L, f);
    const iron = galleryIron(L, f.bank);
    const verts = worldVerts(m);
    let rMax = -Infinity, tMin = Infinity, tMax = -Infinity;
    let crankMin = Infinity, linerMin = Infinity, inIron = 0, faceVerts = 0, faceSpread = 0, faceR = 0;
    for (const p of verts) {
      const t = fr.t(p), perp = fr.perp(p);
      if (t < tMin) tMin = t;
      if (t > tMax) tMax = t;
      if (perp > rMax) rMax = perp;
      const rr = fr.offCrank(p); if (rr < crankMin) crankMin = rr;
      const ll = fr.offLiner(p); if (ll < linerMin) linerMin = ll;
      const q = iron.at(p);
      if (!iron.inBore(q) && iron.inIron(q)) inIron += 1;
      if (t <= tMin + CORNER) { faceVerts += 1; faceSpread = Math.max(faceSpread, Math.abs(t - tMin)); faceR = Math.max(faceR, perp); }
    }
    assert.equal(inIron, 0, `${f.name}: ${inIron} of its ${verts.length} vertices stand inside the gallery iron this block casts `
      + `(the rib prisms from the machined tunnel face t ${g.guideFrom.toFixed(4)} to the guide end t ${g.guideTo.toFixed(4)}, `
      + `iron out to r ${iron.ribOut.toFixed(4)} off the crank) and outside every bore it machines - a follower may only stand in a void its block bored`);
    // a drawn prism carries its vertices on its two end faces, so the guide hold is
    // the overlap of the body's own span with the machined bore window, not a vertex count
    const guide = Math.min(tMax, g.guideTo) - Math.max(tMin, g.guideFrom);
    const lift0 = E.ohvLift(SPEC.cylinders.find((c) => c.num === f.cyl), f.valve, 0);
    const want = Math.min(f.faceMin + lift0 + f.length, g.guideTo) - Math.max(f.faceMin + lift0, g.guideFrom);
    assert.ok(guide > 0 && Math.abs(guide - want) < CORNER,
      `${f.name}: its body overlaps the bore this block bored for it (t ${g.guideFrom.toFixed(4)}..${g.guideTo.toFixed(4)}) by ${guide.toFixed(5)} cm, `
      + `not the ${want.toFixed(5)} cm the guide gives a body at the ${lift0.toFixed(5)} cm lift it rides in the baked pose`);
    assert.ok(G.boreRadius - rMax >= G.oilFilm - CORNER,
      `${f.name}: the drawn body leaves only ${(G.boreRadius - rMax).toFixed(5)} cm inside its ${G.boreRadius.toFixed(4)} cm bore, under the ${G.oilFilm.toFixed(4)} cm oil film this tree runs every bearing on`);
    assert.ok(Math.abs(rMax - f.radius) < CORNER,
      `${f.name}: the drawn body measures r ${rMax.toFixed(5)} off its axis, not the published ${f.radius.toFixed(5)} cm the bore less the oil film gives`);
    // a FLAT tappet: the cam-side face is one plane across the bore axis and it
    // spans the whole body, or the follower is not riding the lobe face to face
    assert.ok(faceVerts > 8 && faceSpread <= CORNER && Math.abs(faceR - f.radius) < CORNER,
      `${f.name}: its cam-side face is ${faceVerts} vertices spread ${faceSpread.toFixed(6)} cm along the axis out to r ${faceR.toFixed(5)}, not a ${f.radius.toFixed(5)} cm flat plane across the bore`);
    assert.ok(tMin >= f.faceMin - CORNER && tMax <= f.faceMin + F.liftMaxCm + f.length + CORNER,
      `${f.name}: the drawn body spans t ${tMin.toFixed(5)}..${tMax.toFixed(5)}, outside the ${f.faceMin.toFixed(5)}..${(f.faceMin + F.liftMaxCm + f.length).toFixed(5)} this variant can ever occupy`);
    assert.ok(Math.abs(tMin - (f.faceMin + lift0)) < CORNER && Math.abs(tMax - (f.faceMin + lift0 + f.length)) < CORNER,
      `${f.name}: in the baked pose its body stands at t ${tMin.toFixed(5)}..${tMax.toFixed(5)} against the ${f.faceMin.toFixed(5)}..${(f.faceMin + f.length).toFixed(5)} the gallery publishes plus the ${lift0.toFixed(5)} cm lift its lobe gives at crank 0`);
    assert.ok(crankMin >= G.reliefR - CORNER,
      `${f.name}: its ${verts.length} vertices stand no nearer than ${crankMin.toFixed(4)} cm to the crank axis - inside the ${G.reliefR.toFixed(4)} cm room the crank-side swings are owed`);
    assert.ok(linerMin >= SPEC.block.boreShellRadius - CORNER,
      `${f.name}: its body stands ${linerMin.toFixed(4)} cm off its cylinder's bore axis, and this block casts liner iron out to ${SPEC.block.boreShellRadius} cm`);
    perBank[f.bank] += 1;
    rows.push(`${f.bank}${f.cyl}${f.valve[0]} r${rMax.toFixed(4)} face ${faceVerts}v/${faceSpread.toFixed(5)} t${tMin.toFixed(3)}..${tMax.toFixed(3)} guide ${guide.toFixed(4)} iron ${inIron} crank ${crankMin.toFixed(4)} liner ${linerMin.toFixed(4)}`);
    // the inspection menu has to be able to NAME the part it picks
    const lbl = partLabel(f.name);
    assert.notEqual(lbl, f.name, `${f.name}: partLabel() returns the raw name, so the inspection menu drops this lifter`);
    assert.ok(/lifter/i.test(lbl) && lbl.includes(`cylinder ${f.cyl}`) && lbl.includes(f.valve),
      `partLabel("${f.name}") reads "${lbl}" - it has to name a lifter and the cylinder and valve it serves`);
  }
  for (const bank of Object.keys(SPEC.banks)) {
    assert.equal(perBank[bank], G.banks[bank].bores.length,
      `bank ${bank} draws ${perBank[bank]} lifters for the ${G.banks[bank].bores.length} bores its gallery machines`);
  }
  for (const word of ['bucket', 'shim']) {
    let hits = 0;
    built.group.traverse((o) => { if (o.name.toLowerCase().includes(word)) hits += 1; });
    assert.equal(hits, 0, `the OHV build draws ${hits} part(s) for "${word}": this variant rides lifters in bores, not the DOHC build's buckets`);
  }
  console.log(`${TRAIN} drawn: ${perBank.L} + ${perBank.R} lifters, every one inside its own bore with the published oil film left in it, `
    + `0 of ${rows.length} bodies standing in gallery iron, ${rows[0]}; sample ${rows.slice(1, 3).join(', ')}`);
});

test(`${TRAIN}: every lifter rides its own lobe on the flat-follower contact law and never cuts into it`, async () => {
  const L = await ohvLayout();
  const E = await import('../src/engine/ohv.js');
  const F = L.ohvLifters();
  const cam = E.ohvCamLayout();
  const built = await ohvBuilt();
  const camGroup = built.group.getObjectByName(L.camGroupNames('ohv')[0]);
  assert.ok(camGroup, `the switch names "${L.camGroupNames('ohv')[0]}" and the OHV build draws no such cam`);
  const scratch = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  let worstCut = -Infinity, worstGap = 0, cutAt = '', gapAt = '', contour = Infinity;
  const STEPS = 180; // 720 crank degrees at 4-degree steps
  const CUT = 1e-6;
  for (const f of F.lifters) {
    const own = camGroup.children.filter((o) => o.name.startsWith('lobe-'));
    assert.equal(own.length, cam.lobes.length, `the cam draws ${own.length} lobes for the ${cam.lobes.length} ohvCamLayout() publishes`);
    // every drawn lobe whose ground faces span this lifter's own x footprint can
    // reach its contact face: the lifter is 2 x 0.48500 wide, a lobe 1.65000
    const band = own.filter((o) => {
      o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox;
      return bb.min.x <= f.x + f.radius + CORNER && bb.max.x >= f.x - f.radius - CORNER;
    });
    assert.ok(band.length >= 1, `${f.name}: no drawn lobe spans its x footprint ${f.x.toFixed(4)} +/- ${f.radius.toFixed(4)} - the follower would ride nothing`);
    assert.ok(band.every((o) => {
      const bb = o.geometry.boundingBox;
      return bb.min.x <= f.x - f.radius + CORNER && bb.max.x >= f.x + f.radius - CORNER;
    }), `${f.name}: a lobe that reaches its footprint is narrower than the footprint, so the lifter's face would stand past the ground face it rides`);
    // an extruded lobe carries its vertices on its two ground faces; the profile
    // is the same on both, so one face is the whole contour
    const lobe = camGroup.children.find((o) => o.name === `lobe-cyl${f.cyl}-${f.valve}`);
    assert.ok(lobe, `${f.name}: the cam draws no lobe named "lobe-cyl${f.cyl}-${f.valve}" for this lifter to ride`);
    lobe.geometry.computeBoundingBox();
    const faceX = lobe.geometry.boundingBox.min.x;
    const pos = lobe.geometry.attributes.position;
    const pts = [];
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getX(i) - faceX) > CORNER) continue;
      pts.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);
    }
    if (pts.length < contour) contour = pts.length;
    assert.ok(pts.length >= cam.profileSamples, `${f.name}: its own lobe carries ${pts.length} contour vertices on a ground face, under the ${cam.profileSamples}-step contour ohvCamLayout() grounds it at`);
    const d = new THREE.Vector3().fromArray(bankUp(f.bank));
    const cyl = SPEC.cylinders.find((c) => c.num === f.cyl);
    for (let s = 0; s < STEPS; s++) {
      const theta = s * 4;
      built.update(theta);
      built.group.updateMatrixWorld(true);
      camGroup.getWorldQuaternion(quat); // the drawn turn, not a re-derived one
      let reach = -Infinity;
      for (const [lx, ly, lz] of pts) {
        scratch.set(lx, ly, lz).applyQuaternion(quat);
        const proj = scratch.y * d.y + scratch.z * d.z; // cm off the cam axis along this lifter's axis
        if (proj > reach) reach = proj;
      }
      const face = SPEC.head.camBaseRadius + E.ohvLift(cyl, f.valve, theta);
      const cut = reach - face;
      if (cut > worstCut) { worstCut = cut; cutAt = `${f.name} at ${theta} crank deg (the drawn lobe reaches ${reach.toFixed(5)}, the lifter face stands at ${face.toFixed(5)})`; }
      const gap = face - reach;
      if (gap > worstGap) { worstGap = gap; gapAt = `${f.name} at ${theta} crank deg`; }
    }
  }
  // the drawn outline is a float32 vertex buffer, so a machined 3.10000 cm nose
  // can only be held to about 2e-7 here; CUT is 1e-6 cm, a thousand times tighter
  // than the 1e-3 cm penetration tolerance row A1-G1 gates the DOHC lobes at
  assert.ok(worstCut <= CUT, `a lobe cuts into its follower: ${cutAt} stands ${worstCut.toFixed(7)} cm past the lifter's contact face - `
    + `the outline is the envelope of the planes flat followers ride (src/engine/timing.js lobeFaceDistance), so no drawn lobe may cross one`);
  assert.ok(worstGap <= 2 * cam.profileChordErrCm + CORNER,
    `the drawn lobes stop reaching their followers: the widest gap between a drawn contour and the lifter face it rides is `
    + `${worstGap.toFixed(5)} cm at ${gapAt}, over the ${cam.profileChordErrCm.toFixed(5)} cm a ${cam.profileSamples}-step contour sinks inside its own machined outline (twice that is the bound)`);
  console.log(`${TRAIN} contact: 16 lifters x ${STEPS} crank poses, ${contour} contour vertices per lobe face, worst cut ${worstCut.toFixed(6)} cm (0 owed), `
    + `worst gap ${worstGap.toFixed(6)} cm against a ${cam.profileChordErrCm.toFixed(6)} cm contour chord error, nose lift ${F.liftMaxCm.toFixed(4)} cm`);
});

test(`${TRAIN}: the OHV train poses every lifter by exactly the lift its lobe publishes, once per 720 degrees`, async () => {
  const L = await ohvLayout();
  const E = await import('../src/engine/ohv.js');
  const F = L.ohvLifters();
  const built = await ohvBuilt();
  const base = SPEC.head.camBaseRadius;
  const poses = [0, 30, 90, 150, 210, 270, 330, 400, 480, 560, 640, 719];
  let worst = 0, worstAt = '';
  for (const theta of poses) {
    built.update(theta);
    built.group.updateMatrixWorld(true);
    for (const f of F.lifters) {
      const m = built.group.getObjectByName(f.name);
      const fr = lifterFrame(L, f);
      const c = new THREE.Vector3();
      m.getWorldPosition(c);
      const lift = E.ohvLift(SPEC.cylinders.find((k) => k.num === f.cyl), f.valve, theta);
      const want = base + lift + f.length / 2;
      const got = fr.t(c);
      if (Math.abs(got - want) > worst) { worst = Math.abs(got - want); worstAt = `${f.name} at ${theta} crank deg: drawn t ${got.toFixed(5)} against ${want.toFixed(5)}`; }
    }
  }
  assert.ok(worst < CORNER, `the animation does not pose the followers on the published lift: ${worstAt} is off by ${worst.toFixed(6)} cm`);
  for (const f of F.lifters) {
    const cyl = SPEC.cylinders.find((k) => k.num === f.cyl);
    let windows = 0, peak = 0, peakAt = 0, held = Infinity;
    const lifts = [];
    for (let theta = 0; theta < 720; theta++) lifts.push(E.ohvLift(cyl, f.valve, theta));
    for (let theta = 0; theta < 720; theta++) {
      const lift = lifts[theta];
      // a window starts where this sample lifts and the one before it (wrapping
      // the 720 deg seam) does not
      if (lift > 1e-9 && lifts[(theta + 719) % 720] <= 1e-9) windows += 1;
      if (lift > peak) { peak = lift; peakAt = theta; }
      const top = base + lifts[theta] + f.length;
      held = Math.min(held, Math.min(top, f.guideTo) - Math.max(base + lifts[theta], f.guideFrom));
    }
    assert.equal(windows, 1, `${f.name}: its lobe lifts it ${windows} times per 720 crank degrees; one valve event per cycle is what row P1-G1 gates`);
    assert.ok(Math.abs(peak - F.liftMaxCm) < 1e-9, `${f.name}: peak lift ${peak.toFixed(5)} cm is not the ${F.liftMaxCm.toFixed(5)} cm the ground nose over the base circle gives`);
    const mid = ((crankEvent(cyl, eventMid(f.valve)) % 720) + 720) % 720;
    assert.ok(Math.abs(signedAngle(peakAt - mid)) <= 1,
      `${f.name}: lift peaks at ${peakAt} crank degrees, ${signedAngle(peakAt - mid).toFixed(2)} off the ${mid} deg its valve event is published at`);
    assert.ok(held >= f.engagementMin - 1e-9,
      `${f.name}: the least guide hold across the cycle is ${held.toFixed(5)} cm, under the ${f.engagementMin.toFixed(5)} cm its bore publishes at zero lift`);
  }
  console.log(`${TRAIN} animation: ${poses.length} poses x 16 lifters, worst pose error ${worst.toFixed(6)} cm; `
    + `1 lift window per lifter per 720 deg, peak ${F.liftMaxCm.toFixed(4)} cm at its published event, `
    + `guide hold never under ${Math.min(...F.lifters.map((k) => k.engagementMin)).toFixed(5)} cm`);
});
// ---------------------------------------------------------------------------
// A1-G2 CLOSURE CLAUSE (issue #24 dialogue, 2026-11-23): this row's own CHECK
// has to measure BOTH halves of its own wording. The nine laws of the OHV
// crank-to-cam chain live in test/ohv-drive.test.mjs, so this law runs that
// file as a child oracle and demands it green, with every one of its laws
// present and every one of them printing the number it measured.
//
// Why a law and not a note: measured before this line existed, breaking the
// OHV drive contract - src/engine/drive.js `const d = SPEC.variants.ohv.belowCrankCm`
// -> `+ 0.4` - left THIS file green at 25 pass 25 fail 0
// (output-sha256 recorded in tmp/v8-a1g2f-blind.out). A row that reads "in
// DOHC and in OHV" cannot be gated by an oracle that is blind to OHV.
// ---------------------------------------------------------------------------

test(`${OHV_LAW}: this row's own CHECK measures the OHV drive too - it runs test/ohv-drive.test.mjs and demands every law of it green`, async () => {
  const file = 'test/ohv-drive.test.mjs';
  const src = readFileSync(file, 'utf8');
  const laws = (src.match(/^test\(/gm) || []).length;
  assert.ok(laws > 0, `${file} declares ${laws} test() laws, so the drive half of this row has nothing to gate`);
  // node's own recursion guard: a test file that spawns `node --test` inherits
  // NODE_TEST_CONTEXT and the child then prints "node:test run() is being called
  // recursively within a test file. skipping running files." and exits 0 with an
  // empty report - a gate that passes by measuring nothing. Measured with
  // tmp/spawnprobe.test.mjs. The child runs in an environment without that key.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_TEST_WORKER_ID;
  // and NODE_OPTIONS must not carry a second --test-reporter: run under
  // scripts/ledger-run.sh (or npm test) it does, and node then refuses the child with
  // `ERR_INVALID_ARG_VALUE: The argument '--test-reporter' must match the number of
  // specified '--test-reporter-destination'` - measured in tmp/v8-a1g2f-green.out.
  // The child's reporter is pinned here, once, the same single token
  // scripts/ledger-run.sh would have pinned.
  const opts = (process.env.NODE_OPTIONS || '').split(/\s+/)
    .filter((t) => t && !t.startsWith('--test-reporter')).join(' ');
  if (opts) env.NODE_OPTIONS = opts; else delete env.NODE_OPTIONS;
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', file], {
    encoding: 'utf8',
    env,
    maxBuffer: 64 * 1024 * 1024,
  });
  // node stamps every reporter summary with that run's wall clock, and this law
  // pastes the child's whole report into its own failure text. A recorded run of
  // this law then hashes differently on every re-run - measured on two identical
  // negative controls, tmp/v8-8c3b-nc-az-tilt.out and tmp/v8-8c3b-nc-az-tilt2.out,
  // which differed only in the child's duration_ms line. scripts/ledger-run.sh
  // strips those stamps for the same reason; the embedded report is stripped the
  // same way, so a hash this row cites stays re-derivable.
  const out = `${r.stdout}\n${r.stderr}`.split('\n')
    .map((line) => line.replace(/ \([0-9]+\.?[0-9]*ms\)$/, ''))
    .filter((line) => !/^\s*(?:\u2139|#) duration_ms /.test(line)).join('\n');
  // the same two reporter spellings scripts/ledger-run.sh accepts: node 24's
  // spec reporter (`ℹ pass 9`) and node 22 on a CI runner (`# pass 9`)
  const counts = (label) => Number(((out.match(new RegExp(`^(?:ℹ|#) ${label} (\\d+)$`, 'm')) || [])[1]));
  const tests = counts('tests');
  const pass = counts('pass');
  const fail = counts('fail');
  const printed = (out.match(/^OHV-DRIVE /gm) || []).length;
  assert.equal(r.status, 0, `the row's drive oracle ${file} exited ${r.status}:\n${out.slice(-3000)}`);
  assert.equal(tests, laws, `${file} declares ${laws} test() laws and the run reported ${tests} - a drive law was removed or renamed out of this row`);
  assert.equal(fail, 0, `${file} reads ${fail} failing drive law(s), and this row's wording names the OHV drive:\n${out.slice(-3000)}`);
  assert.equal(pass, laws, `${file} passed ${pass} of the ${laws} drive laws it declares`);
  assert.ok(printed >= laws, `${file} printed ${printed} measurement lines for ${laws} laws - a drive law that prints nothing measures nothing`);
  const contract = (out.match(/^OHV-DRIVE contract:.*$/m) || [''])[0];
  assert.ok(contract, `${file} printed no contract line, so the tooth counts and pitch radii this row is about are not in its output`);
  console.log(`A1-G2 closure: ${file} -> exit 0, ${tests} laws declared, ${pass} pass, ${fail} fail, ${printed} measurement lines`);
  console.log(`A1-G2 closure, the drive numbers as that oracle prints them: ${contract}`);
});
