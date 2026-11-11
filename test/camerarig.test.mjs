// Camera-rig unit: mouse orbit, WASD walking, smooth zoom, RESET CAMERA.
// The rig is headless math on a real THREE.PerspectiveCamera, so every claim is
// measured off the camera the renderer actually draws with:
//  1. it starts in the swept boot framing, and RESET returns to it exactly,
//  2. that framing still holds the engine AND the whole stand uncropped,
//  3. zoom and orbit are damped: monotone, never overshooting, frame-rate free,
//  4. the eye can never be driven below the cell floor, whatever the input,
//  5. the camera never rolls past vertical (no gimbal, no upside-down deck),
//  6. WASD walks in the view's own basis and keeps the orbit range intact.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SPEC } from '../src/engine/spec.js';
import { createBlock } from '../src/render/block.js';
import { createCranktrain } from '../src/render/cranktrain.js';
import { createValvetrain } from '../src/render/valvetrain.js';
import { createHeads } from '../src/render/heads.js';
import { createManifolds } from '../src/render/manifolds.js';
import { createStand } from '../src/render/stand.js';
import { createCameraRig, homePose, minElevation, clampFocus, focusLimits } from '../src/ui/cameraRig.js';

const V = SPEC.view;
const FLOOR = SPEC.stand.floorZ;
const EPS = 1e-9;
const WORLDZ = new THREE.Vector3(0, 0, 1);

const materials = new Proxy({}, {
  get: (t, k) => (t[k] ??= new THREE.MeshStandardMaterial({ name: String(k) })),
});

const newCamera = () => {
  const c = new THREE.PerspectiveCamera(V.fov, V.aspect, 0.5, 3000);
  c.up.set(0, 0, 1);
  return c;
};

const rigOnCamera = (opts) => {
  const camera = newCamera();
  const rig = createCameraRig(camera, opts);
  rig.update(0);
  return { camera, rig };
};

const settle = (rig, dt = 1 / 60, steps = 400) => {
  let s = null;
  for (let i = 0; i < steps; i++) s = rig.update(dt);
  return s;
};

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

// the whole assembly exactly as main.js hangs it: engine group + stand beside it
function buildScene() {
  const engine = createBlock(materials);
  engine.name = 'v8-block';
  for (const u of [createCranktrain, createValvetrain, createHeads, createManifolds]) engine.add(u(materials).group);
  engine.updateMatrixWorld(true);
  const stand = createStand(materials).group;
  stand.updateMatrixWorld(true);
  return { engine, stand };
}

// ---------------------------------------------------------------------------
test('the rig publishes its limits from SPEC.view and starts in the boot framing', () => {
  for (const k of ['homePos', 'homeTarget', 'fov', 'aspect', 'distMin', 'distMax', 'pitchLimit',
    'eyeMin', 'orbitSpeed', 'zoomStep', 'walkSpeed', 'walkBoost', 'damping', 'walkBounds']) {
    assert.ok(k in V, `SPEC.view.${k} missing`);
  }
  assert.ok(V.distMin > 10 && V.distMin < V.distMax && V.distMax < 3000, `range limits ${V.distMin}..${V.distMax}`);
  assert.ok(V.pitchLimit > 0 && V.pitchLimit < Math.PI / 2, `pitchLimit ${V.pitchLimit} must stay off the Z-up gimbal`);
  assert.ok(V.zoomStep > 1, `zoomStep ${V.zoomStep} must be > 1 so a notch means a real change`);
  assert.ok(V.damping > 0 && V.orbitSpeed > 0 && V.walkSpeed > 0 && V.walkBoost > 1, 'motion constants');
  assert.ok(V.eyeMin > 0, 'the eye guard must be a positive height above the floor plate');
  assert.ok(V.fov > 5 && V.fov < 120, `published fov ${V.fov}`);
  assert.ok(V.aspect > 0.5 && V.aspect < 4, `published aspect ${V.aspect}`);

  const off = new THREE.Vector3(...V.homePos).sub(new THREE.Vector3(...V.homeTarget));
  const h = homePose();
  assert.ok(near(h.dist, off.length(), EPS), 'home range derived from the published pose, not stored twice');
  assert.ok(near(Math.hypot(off.x, off.y), h.dist * Math.cos(h.el), EPS), 'home elevation derived');

  // the published home pose has to be a LEGAL pose under its own published
  // limits, or the boot framing is a coincidence rather than a design
  assert.ok(Math.abs(h.el) <= V.pitchLimit + EPS,
    `the published home elevation ${h.el.toFixed(4)} breaks the published pitch limit ${V.pitchLimit}`);
  assert.ok(h.dist >= V.distMin - EPS && h.dist <= V.distMax + EPS,
    `the published home range ${h.dist.toFixed(2)} is outside ${V.distMin}..${V.distMax}`);
  assert.ok(clampFocus(h.target).distanceTo(h.target) < EPS,
    `the published home focus ${h.target.toArray().map((n) => n.toFixed(2))} sits outside the walkable cell`);
  assert.ok(V.homePos[2] >= SPEC.stand.floorZ + V.eyeMin - EPS,
    `the published home eye z ${V.homePos[2]} sits under the floor guard ${SPEC.stand.floorZ + V.eyeMin}`);
  const lim = focusLimits();
  assert.ok(near(lim.zMin, SPEC.stand.floorZ + V.eyeMin, EPS), 'the focus floor is DERIVED from the cell, never pinned');

  const { camera, rig } = rigOnCamera();
  assert.ok(camera.position.distanceTo(new THREE.Vector3(...V.homePos)) < 1e-6,
    `rig boot pose ${camera.position.toArray().map((n) => n.toFixed(2))} != published home`);
  assert.ok(camera.up.distanceTo(WORLDZ) < EPS, 'camera.up must be world Z or the deck tilts');
  assert.ok(rig.state().dist === h.dist, 'boot range equals the published range');
});

test('RESET CAMERA returns to the swept framing, and it frames engine + stand uncropped', () => {
  const { camera, rig } = rigOnCamera();
  rig.orbit(640, -320);
  rig.zoom(-7);
  rig.walk({ fwd: 1, strafe: -1, rise: 1 }, 2);
  settle(rig, 1 / 60, 300);
  const stray = camera.position.clone();
  assert.ok(stray.distanceTo(new THREE.Vector3(...V.homePos)) > 20, 'the pose really moved, so the reset proves something');

  const r = rig.reset();
  rig.update(0);
  assert.ok(camera.position.distanceTo(new THREE.Vector3(...V.homePos)) < 1e-9,
    `reset left the camera at ${camera.position.toArray().map((n) => n.toFixed(3))}`);
  assert.ok(r.focus.distanceTo(new THREE.Vector3(...V.homeTarget)) < EPS, 'reset focus');
  assert.ok(near(r.dist, homePose().dist, EPS) && near(r.az, r.azGoal, EPS) && near(r.el, r.elGoal, EPS), 'reset angles');

  const { engine, stand } = buildScene();
  const standBox = new THREE.Box3().setFromObject(stand);
  const engineBox = new THREE.Box3().setFromObject(engine);
  const union = engineBox.clone().union(standBox);
  assert.ok(standBox.min.x < -30 && standBox.max.x > 30 && standBox.min.z < FLOOR + 1,
    `the stand bbox is not the published footprint: x ${standBox.min.x}..${standBox.max.x}, z ${standBox.min.z}..${standBox.max.z}`);
  const cam = newCamera();
  cam.position.set(...V.homePos);
  cam.lookAt(new THREE.Vector3(...V.homeTarget));
  cam.updateMatrixWorld(true);
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const x of [union.min.x, union.max.x]) {
    for (const y of [union.min.y, union.max.y]) {
      for (const z of [union.min.z, union.max.z]) {
        const n = new THREE.Vector3(x, y, z).project(cam);
        minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
        minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
      }
    }
  }
  assert.ok(minX > -1 && maxX < 1 && minY > -1 && maxY < 1,
    `boot framing crops the assembly: NDC x ${minX.toFixed(3)}..${maxX.toFixed(3)} y ${minY.toFixed(3)}..${maxY.toFixed(3)}`);
  // and it is not shrunk into a postage stamp either: it uses most of the frame
  assert.ok(maxX - minX > 0.6 && maxY - minY > 0.9,
    `the assembly only spans NDC ${(maxX - minX).toFixed(2)} x ${(maxY - minY).toFixed(2)} of the frame`);
});

test('zoom is damped: monotone, never overshooting, and it settles on the goal', () => {
  const { camera, rig } = rigOnCamera();
  const from = rig.state().dist;
  rig.zoom(-4); // 4 notches in: inside the range, so the notch law is measurable
  const goal = rig.state().distGoal;
  assert.ok(goal < from, 'a notch zoom in must shorten the range');
  assert.ok(near(goal, from * Math.pow(V.zoomStep, -4), 1e-9), 'the goal follows the published notch law, not a pinned distance');
  let prevEye = camera.position.clone();
  let last = from;
  let biggestMove = 0;
  const seq = [];
  for (let i = 0; i < 400; i++) {
    const s = rig.update(1 / 60);
    seq.push(s.dist);
    assert.ok(s.dist <= last + EPS && s.dist >= goal - EPS,
      `zoom overshot at step ${i}: dist ${s.dist.toFixed(6)}, previous ${last.toFixed(6)}, goal ${goal.toFixed(6)}`);
    const gap = Math.abs(s.dist - goal);
    // exponential motion closes the gap a slice every frame until it arrives: it
    // never stalls early, and it never jumps past the goal
    assert.ok(gap < 1e-6 || s.dist < last - 1e-12,
      `zoom stalled at step ${i}: ${s.dist.toFixed(8)} is still ${gap.toFixed(8)} from ${goal.toFixed(8)}`);
    biggestMove = Math.max(biggestMove, camera.position.distanceTo(prevEye));
    prevEye = camera.position.clone();
    last = s.dist;
  }
  assert.ok(biggestMove < 0.2 * (from - goal),
    `one frame moved the eye ${biggestMove.toFixed(2)} cm of a ${(from - goal).toFixed(2)} cm zoom: not smooth`);
  assert.ok(biggestMove > 1e-6, 'the eye never moved during the zoom');
  assert.ok(Math.abs(last - goal) < 1e-4, `zoom did not settle: ${last.toFixed(4)} vs goal ${goal.toFixed(4)}`);
  // smooth, not instant: the first frame covers only a slice of the gap
  const gap = from - goal;
  assert.ok(from - seq[0] < 0.2 * gap, `the first frame jumped ${(from - seq[0]).toFixed(2)} of a ${gap.toFixed(2)} cm move`);
  assert.ok(from - seq[0] > 1e-4, 'the first frame did not move at all: the zoom is not damped');
});

test('zoom clamps to the published range and is proportional at every range', () => {
  const { rig } = rigOnCamera();
  for (let i = 0; i < 40; i++) rig.zoom(-10);
  assert.ok(near(rig.state().distGoal, V.distMin, EPS), `zoom in clamped at ${rig.state().distGoal}, published ${V.distMin}`);
  settle(rig);
  assert.ok(Math.abs(rig.state().dist - V.distMin) < 1e-4, 'the applied range did not settle on the clamp');
  for (let i = 0; i < 80; i++) rig.zoom(10);
  assert.ok(near(rig.state().distGoal, V.distMax, EPS), `zoom out clamped at ${rig.state().distGoal}, published ${V.distMax}`);

  // proportional: one notch is the same FRACTION of range near or far, as long
  // as the notch is not landing on a clamp (which is the point of a clamp)
  const ratios = [];
  for (const dist of [V.distMin + 20, 140, V.distMax - 60]) {
    rig.focusOn(V.homeTarget, dist);
    const a = rig.state().dist;
    rig.zoom(-1);
    const b = rig.state().distGoal;
    ratios.push(b / a);
    assert.ok(near(b / a, 1 / V.zoomStep, 1e-9), `one notch at ${dist} cm changed the range by ${b / a}, published ${1 / V.zoomStep}`);
  }
  assert.ok(Math.max(...ratios) - Math.min(...ratios) < 1e-9, 'a notch means different amounts at different ranges');
  // at the wall a further notch is HELD, it does not creep past the limit
  rig.focusOn(V.homeTarget, V.distMin);
  rig.zoom(-5);
  assert.ok(near(rig.state().distGoal, V.distMin, EPS), `zoom in past the near clamp reached ${rig.state().distGoal}`);
  rig.focusOn(V.homeTarget, V.distMax);
  rig.zoom(5);
  assert.ok(near(rig.state().distGoal, V.distMax, EPS), `zoom out past the far clamp reached ${rig.state().distGoal}`);
  // and one notch in then one notch out is a round trip: the law is invertible
  rig.focusOn(V.homeTarget, 140);
  const there = rig.state().dist;
  rig.zoom(-3);
  rig.zoom(3);
  assert.ok(near(rig.state().distGoal, there, 1e-9), 'zoom in then out did not return to the same range');
});

test('the motion is frame-rate independent: the same wall clock lands the same pose', () => {
  const a = rigOnCamera().rig;
  const b = rigOnCamera().rig;
  for (const r of [a, b]) { r.orbit(400, 210); r.zoom(-4); r.walk({ fwd: 1, strafe: -0.5 }, 0.4); }
  const T = 1.5;
  for (let i = 0; i < 90; i++) a.update(T / 90); // 60 fps
  for (let i = 0; i < 1500; i++) b.update(T / 1500); // 1000 fps
  const sa = a.state(), sb = b.state();
  assert.ok(near(sa.dist, sb.dist, 1e-9), `range ${sa.dist} vs ${sb.dist}`);
  assert.ok(near(sa.az, sb.az, 1e-9), `azimuth ${sa.az} vs ${sb.az}`);
  assert.ok(near(sa.el, sb.el, 1e-9), `elevation ${sa.el} vs ${sb.el}`);
  assert.ok(sa.focus.distanceTo(sb.focus) < 1e-9, 'the focus drifted with the frame rate');
});

test('the eye can never be driven below the cell floor, whatever the input', () => {
  const legalGoal = (r, tag) => {
    const st = r.state();
    const floor = minElevation(st.focusGoal.z, st.distGoal);
    assert.ok(st.elGoal >= floor - 1e-12,
      `${tag}: the rig asked for elevation ${st.elGoal.toFixed(4)} which puts the eye under its guard ${floor.toFixed(4)}`);
  };

  // PHASE 1: everything at once - drag, zoom in, walk down with the boost
  const { camera, rig } = rigOnCamera();
  let lowest = Infinity;
  for (let i = 0; i < 400; i++) {
    rig.orbit(37 * i, -900);
    rig.zoom(-3);
    rig.walk({ fwd: 1, rise: -1, boost: true }, 1 / 30);
    const s = rig.update(1 / 30);
    lowest = Math.min(lowest, s.eye.z - FLOOR);
    assert.ok(s.eye.z > FLOOR, `the camera reached z ${s.eye.z.toFixed(3)}, the floor plate is at ${FLOOR}`);
    assert.ok(s.eye.z - FLOOR >= V.eyeMin - 1e-6, `eye height ${s.eye.z - FLOOR} under the published guard ${V.eyeMin}`);
    assert.ok(Math.abs(s.el) <= V.pitchLimit + EPS, `elevation ${s.el.toFixed(3)} passed the pitch limit`);
    legalGoal(rig, 'phase 1');
  }
  assert.ok(lowest <= V.eyeMin + 0.5, `the eye never got near the guard: closest approach ${lowest.toFixed(2)} cm vs ${V.eyeMin}`);

  // PHASE 2: a pure drag, no zoom and no walk afterwards to repair the goal.
  // This is the only input that shows the ORBIT itself refuses an illegal goal.
  rig.reset();
  for (let i = 0; i < 40; i++) {
    rig.orbit(0, -1200); // 54 deg of pitch travel per drag, forever
    legalGoal(rig, 'phase 2: a drag alone must not aim the eye under the plate');
    rig.update(1 / 60);
    legalGoal(rig, 'phase 2 after update');
  }

  // PHASE 3: park the elevation ON the guard (drag + zoom in, settle), then drop
  // the focus. Two legal poses do not interpolate through legal eye heights: the
  // APPLIED elevation has to be clamped every frame, not just the goal.
  rig.reset();
  for (let i = 0; i < 60; i++) {
    rig.orbit(0, -900);
    rig.zoom(-2);
    rig.update(1 / 60);
  }
  for (let i = 0; i < 400; i++) rig.update(1 / 60);
  const parked = rig.state();
  const parkedGuard = minElevation(parked.focus.z, parked.dist);
  assert.ok(near(parked.el, parkedGuard, 1e-6),
    `the drag did not park the elevation on its guard: el ${parked.el.toFixed(4)} vs guard ${parkedGuard.toFixed(4)}`);
  let parkedLowest = Infinity;
  let bound = 0;
  for (let i = 0; i < 300; i++) {
    rig.orbit(0, -900);
    rig.walk({ rise: -1 }, 1 / 60);
    const s = rig.update(1 / 60);
    if (Math.abs(s.el - minElevation(s.focus.z, s.dist)) < 1e-9) bound += 1;
    parkedLowest = Math.min(parkedLowest, s.eye.z - FLOOR);
    assert.ok(s.eye.z - FLOOR >= V.eyeMin - 1e-6,
      `phase 3 frame ${i}: dropping the focus under a parked elevation put the eye ${s.eye.z - FLOOR} cm above the plate, guard ${V.eyeMin}`);
    legalGoal(rig, 'phase 3');
  }
  assert.ok(bound > 0, 'the applied elevation clamp never bound: the guard is decorative, not load-bearing');
  assert.ok(parkedLowest <= V.eyeMin + 0.02, `phase 3 never reached the guard: ${parkedLowest.toFixed(3)} cm`);
  // and the guard is DERIVED from the floor plane, not a constant elevation
  const lowFocus = minElevation(FLOOR + 8, 60);
  const highFocus = minElevation(FLOOR + 40, 60);
  assert.ok(lowFocus > highFocus, `minElevation must follow the focus height (${lowFocus} vs ${highFocus})`);
  assert.ok(near(lowFocus, Math.asin((FLOOR + V.eyeMin - (FLOOR + 8)) / 60), EPS), 'minElevation formula');
  // outside asin's domain the function still answers honestly instead of NaN:
  // a focus high above the plate has slack (even straight down clears the floor)
  const slack = minElevation(FLOOR + 60, 20);
  assert.ok(Number.isFinite(slack), 'minElevation returned NaN: asin domain not handled');
  assert.ok(near(slack, -V.pitchLimit, EPS), `slack guard reads ${slack}, expected the pitch limit ${-V.pitchLimit}`);
  // and a focus buried below the plate by more than the range (clampFocus forbids
  // it) is answered by the pitch limit, not NaN
  const illegal = minElevation(FLOOR - 200, 60);
  assert.ok(Number.isFinite(illegal) && near(illegal, V.pitchLimit, EPS), `illegal focus reads ${illegal}`);
});

test('the camera never rolls past vertical: no gimbal, no upside-down deck', () => {
  const { camera, rig } = rigOnCamera();
  let minUp = 1;
  const poses = [[0, 0], [90, -300], [180, 300], [270, -900], [45, 900], [300, 900], [120, -900]];
  for (const [dx, dy] of poses) {
    rig.reset();
    rig.orbit(dx, dy);
    rig.orbit(0, 4000); // push up as far as the rig allows
    rig.zoom(6);
    const s = settle(rig, 1 / 120, 400);
    const up = new THREE.Vector3(0, 1, 0).transformDirection(camera.matrixWorld);
    assert.ok(Number.isFinite(camera.quaternion.x) && Number.isFinite(camera.quaternion.w),
      `camera quaternion went non-finite at elevation ${s.el}: the Z-up gimbal`);
    assert.ok(up.angleTo(WORLDZ) <= V.pitchLimit + 1e-6,
      `the camera up axis tilted ${up.angleTo(WORLDZ).toFixed(3)} rad from world Z, past pitchLimit ${V.pitchLimit}`);
    minUp = Math.min(minUp, up.dot(WORLDZ));
    assert.ok(up.dot(WORLDZ) > 0, `the camera rolled upside down at elevation ${s.el.toFixed(3)}`);
  }
  assert.ok(near(minUp, Math.cos(V.pitchLimit), 2e-2), `the tilt margin is not the published one: ${minUp.toFixed(4)} vs ${Math.cos(V.pitchLimit).toFixed(4)}`);
});

test('orbit azimuth wraps: a full turn comes back to the same pose', () => {
  const { camera, rig } = rigOnCamera();
  const before = rig.update(0);
  const px = (Math.PI * 2) / V.orbitSpeed; // one full turn in pixels
  rig.orbit(px, 0);
  const s = settle(rig, 1 / 120, 600);
  assert.ok(s.az >= 0 && s.az < Math.PI * 2, `azimuth ${s.az} escaped [0, 2pi)`);
  assert.ok(camera.position.distanceTo(before.eye) < 1e-4,
    `a full orbit left the eye ${camera.position.distanceTo(before.eye).toFixed(4)} cm from where it started`);
  rig.orbit(-px, 0);
  const s2 = settle(rig, 1 / 120, 600);
  assert.ok(camera.position.distanceTo(before.eye) < 1e-4, 'the reverse turn did not come back either');
  assert.ok(near(s2.el, before.el, 1e-9) && near(s2.dist, before.dist, 1e-9), 'orbiting changed range or elevation');

  // the SHORT way round: a 270 deg command is a 90 deg move in the other
  // direction, so the eye may travel at most half a turn to get there
  rig.reset();
  const a0 = rig.update(0).az;
  rig.orbit((1.5 * Math.PI) / V.orbitSpeed); // -270 deg of mouse travel
  const wrap = (a) => { let x = a; while (x < 0) x += Math.PI * 2; while (x >= Math.PI * 2) x -= Math.PI * 2; return x; };
  const step = (a, b) => { let d = wrap(b) - wrap(a); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
  let path = 0;
  let prev = a0;
  let s3 = null;
  for (let i = 0; i < 900; i++) {
    s3 = rig.update(1 / 120);
    path += Math.abs(step(prev, s3.az));
    prev = s3.az;
  }
  const want = wrap(a0 + Math.PI / 2);
  assert.ok(Math.abs(step(s3.az, want)) < 1e-6,
    `a -270 deg command settled at az ${s3.az.toFixed(4)}, expected ${want.toFixed(4)}`);
  assert.ok(path <= Math.PI + 0.1,
    `the rig travelled ${path.toFixed(3)} rad for a 270 deg command: it went the long way round`);
  assert.ok(path > 1.4, `the rig travelled only ${path.toFixed(3)} rad: the orbit did not complete the move`);
});

test('WASD walks in the view basis, keeps the orbit range, and stays inside the cell', () => {
  const { camera, rig } = rigOnCamera();
  const before = rig.update(0);

  rig.walk({ fwd: 1 }, 1);
  const s = settle(rig, 1 / 60, 600);
  const moved = s.focus.clone().sub(before.focus);
  assert.ok(moved.length() > V.walkSpeed * 0.5, `W moved the focus only ${moved.length().toFixed(2)} cm in 1 s`);
  const viewFlat = before.focus.clone().sub(before.eye).setZ(0).normalize();
  assert.ok(moved.clone().setZ(0).normalize().dot(viewFlat) > 0.9999,
    `W moved ${moved.toArray().map((n) => n.toFixed(2))}, not along the view direction`);
  assert.ok(Math.abs(moved.z) < 1e-9, `W changed the focus height by ${moved.z}: walking must stay floor-parallel`);

  // D must strafe along the CAMERA'S OWN right axis, not an invented basis
  rig.reset();
  rig.update(0);
  const camRight = new THREE.Vector3(1, 0, 0).transformDirection(camera.matrixWorld).setZ(0).normalize();
  const camForward = new THREE.Vector3(0, 0, -1).transformDirection(camera.matrixWorld).setZ(0).normalize();
  assert.ok(camForward.dot(viewFlat) > 0.9999, 'the camera view axis and the walk forward disagree');

  rig.walk({ strafe: 1 }, 1);
  const s2 = settle(rig, 1 / 60, 600);
  const strafe = s2.focus.clone().sub(rig.home.target);
  assert.ok(Math.abs(strafe.z) < 1e-9, 'strafe changed the focus height');
  assert.ok(strafe.clone().normalize().dot(camRight) > 0.9999,
    `D moved ${strafe.toArray().map((n) => n.toFixed(2))}, not along the camera's right axis`);
  assert.ok(Math.abs(strafe.normalize().dot(camForward)) < 1e-9, 'strafe is not 90 deg from the forward direction');

  rig.reset();
  rig.walk({ strafe: -1 }, 1);
  const s3 = settle(rig, 1 / 60, 600);
  const left = s3.focus.clone().sub(rig.home.target);
  assert.ok(left.dot(strafe.clone().negate()) > 0.9999 * strafe.length() ** 2, 'A is not the reverse of D');

  // Shift is the published boost, nothing else
  rig.reset();
  rig.walk({ fwd: 1, boost: true }, 0.5);
  const boosted = settle(rig, 1 / 60, 600).focus.clone().sub(rig.home.target).length();
  assert.ok(near(boosted, V.walkSpeed * V.walkBoost * 0.5, 1e-6),
    `Shift walked ${boosted.toFixed(2)} cm in 0.5 s, published ${V.walkSpeed * V.walkBoost * 0.5}`);

  // rise: vertical, bounded on both ends by the cell
  rig.reset();
  rig.walk({ rise: 1 }, 40);
  const up = settle(rig, 1 / 60, 600).focusGoal;
  assert.ok(near(up.z, V.walkBounds.zMax, 1e-6), `rise clamped at z ${up.z}, published ${V.walkBounds.zMax}`);
  rig.reset();
  rig.walk({ rise: -1 }, 40);
  const down = settle(rig, 1 / 60, 600).focusGoal;
  assert.ok(near(down.z, FLOOR + V.eyeMin, 1e-6), `the focus floor is ${down.z}, it must be DERIVED: floorZ + eyeMin = ${FLOOR + V.eyeMin}`);

  // walking translates the rig: it is not a zoom
  const { camera: c2, rig: r2 } = rigOnCamera();
  r2.update(0);
  const d0 = r2.state().dist;
  for (let i = 0; i < 60; i++) r2.walk({ fwd: 1, strafe: 0.5, boost: true }, 1 / 60);
  const sw = settle(r2, 1 / 60, 400);
  assert.ok(near(sw.dist, d0, 1e-9), `walking changed the orbit range ${d0} -> ${sw.dist}`);
  assert.ok(c2.position.distanceTo(before.eye) > 10, 'walking did not move the eye at all');

  // walking forever cannot leave the cell
  for (let i = 0; i < 5000; i++) r2.walk({ fwd: 1, boost: true }, 1 / 60);
  const end = settle(r2, 1 / 60, 400).focusGoal;
  const lim = V.walkBounds;
  assert.ok(Math.abs(end.x) <= lim.x + EPS && Math.abs(end.y) <= lim.y + EPS,
    `the focus escaped the cell: ${end.toArray().map((n) => n.toFixed(1))}`);
  assert.ok(Math.hypot(end.x, end.y) > lim.x - 1, 'the walk bound is not reachable: it is a suggestion, not a wall');
  const clamped = clampFocus(new THREE.Vector3(1e6, -1e6, 1e6));
  assert.ok(near(clamped.x, lim.x, EPS) && near(clamped.y, -lim.y, EPS) && near(clamped.z, lim.zMax, EPS), 'clampFocus x/y/zMax');
});

test('the camera really looks at its focus, and focusOn frames a part at a real range', () => {
  const { camera, rig } = rigOnCamera();
  rig.orbit(-260, 150);
  rig.walk({ fwd: -1, strafe: 1, rise: -1 }, 1.2);
  const s = settle(rig, 1 / 120, 800);
  const look = new THREE.Vector3(0, 0, -1).transformDirection(camera.matrixWorld);
  const want = s.focus.clone().sub(camera.position).normalize();
  assert.ok(look.angleTo(want) < 1e-9, `the camera looks ${(look.angleTo(want) * 180 / Math.PI).toFixed(4)} deg off its focus`);
  const up = new THREE.Vector3(0, 1, 0).transformDirection(camera.matrixWorld);
  assert.ok(up.angleTo(WORLDZ) < V.pitchLimit + 1e-6, 'the camera up axis left world Z');
  assert.ok(Math.abs(up.angleTo(look) - Math.PI / 2) < 1e-9, 'the camera up axis is not square to its view');
  assert.ok(near(camera.position.distanceTo(s.focus), s.dist, 1e-9), 'range != eye-to-focus distance');

  const f = rig.focusOn([16.5, -5.4, -12.6], 60); // a mount pad on the oil-pan flange
  rig.update(0);
  assert.ok(near(f.dist, 60, EPS), 'focusOn range');
  assert.ok(near(camera.position.distanceTo(f.focus), 60, 1e-9), 'focusOn did not put the camera at the published range');
  const tooClose = rig.focusOn([0, 0, 0], 1);
  assert.ok(near(tooClose.dist, V.distMin, EPS), `focusOn clamped to ${tooClose.dist}, published ${V.distMin}`);
  const out = rig.focusOn([1e5, 0, 0], 120);
  assert.ok(Math.abs(out.focus.x) <= V.walkBounds.x + EPS, 'focusOn let the focus leave the cell');
});

test('nothing in the rig is a magic number: every limit reads the published spec', () => {
  const { rig } = rigOnCamera();
  assert.equal(rig.spec.distMin, V.distMin);
  assert.equal(rig.spec.distMax, V.distMax);
  assert.equal(rig.spec.zoomStep, V.zoomStep);
  assert.equal(rig.spec.walkSpeed, V.walkSpeed);
  assert.equal(rig.spec.walkBoost, V.walkBoost);
  assert.equal(rig.spec.damping, V.damping);
  assert.equal(rig.spec.orbitSpeed, V.orbitSpeed);
  assert.equal(rig.spec.walkBounds.zMax, V.walkBounds.zMax);

  // the same rig re-tuned through opts: the tests then measure the tune, which
  // proves the constants are read from the spec and not baked into the code
  const tuned = createCameraRig(newCamera(), { zoomStep: 1.02, walkBoost: 2, walkBounds: { x: 1, y: 1, zMax: 1 } });
  const d0 = homePose().dist;
  tuned.zoom(-1); // zoom IN: the range shortens by one tuned notch
  assert.ok(near(tuned.state().distGoal, d0 / 1.02, 1e-9), 'opts.zoomStep not honoured');
  assert.ok(!near(tuned.state().distGoal, d0 / V.zoomStep, 1e-6), `the rig still used the spec zoomStep ${V.zoomStep}`);
  tuned.zoom(3); // and positive notches pull the camera back out again
  assert.ok(near(tuned.state().distGoal, (d0 / 1.02) * 1.02 ** 3, 1e-9), 'zoom out direction');
  tuned.walk({ fwd: 1, boost: true }, 1);
  const fg = tuned.state().focusGoal;
  const lim = tuned.spec.walkBounds; // a BOX: each axis is held on its own
  assert.ok(Math.abs(fg.x) <= lim.x + 1e-6 && Math.abs(fg.y) <= lim.y + 1e-6 && Math.abs(fg.z - 0) <= 1e6,
    `opts.walkBounds did not bind: focus ${fg.toArray().map((n) => n.toFixed(2))}`);
  assert.ok(Math.abs(fg.x) >= lim.x - 1e-6 || Math.abs(fg.y) >= lim.y - 1e-6,
    `the tuned bound is a suggestion, not a wall: focus sat at ${fg.toArray().map((n) => n.toFixed(2))}`);
  assert.ok(near(fg.z, SPEC.stand.floorZ + tuned.spec.eyeMin, 1e-6) || fg.z <= lim.zMax + 1e-6,
    'the focus left the tuned z range');
  const slow = createCameraRig(newCamera(), { damping: 0.2 });
  slow.zoom(-10);
  for (let i = 0; i < 60; i++) slow.update(1 / 60);
  assert.ok(Math.abs(slow.state().dist - slow.state().distGoal) > 1, 'opts.damping not honoured: it settled as fast as the default');
});
