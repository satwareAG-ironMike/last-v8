// Camera rig: mouse orbit, WASD walking, smooth zoom, RESET CAMERA.
//
// Written as headless math so test/camerarig.test.mjs can assert the pose model
// directly (no DOM, no requestAnimationFrame): the rig owns a spherical pose
// (azimuth / elevation / range) around a focus point, every input changes a
// GOAL, and update(dt) chases that goal exponentially. That is what makes orbit
// and zoom feel smooth at 30 fps and at 240 fps alike, and it is what the tests
// measure instead of a screenshot.
//
// three's OrbitControls was deliberately not used: this scene is Z-up, the eye
// has to stay above the test-cell floor while walking, and the pose model has to
// be assertable under Node.
//
// World convention (src/engine/spec.js): X = crank axis, Z up, floor plate at
// SPEC.stand.floorZ. The eye guard is DERIVED from that plane, never a magic
// elevation constant.
import * as THREE from 'three';
import { SPEC } from '../engine/spec.js';

const V = SPEC.view;
const FLOOR = SPEC.stand.floorZ;
const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;

/** The pose the rig starts from: the boot framing swept in G5d, as spherical. */
export function homePose() {
  const off = new THREE.Vector3(...V.homePos).sub(new THREE.Vector3(...V.homeTarget));
  const dist = off.length();
  return {
    target: new THREE.Vector3(...V.homeTarget),
    az: THREE.MathUtils.euclideanModulo(Math.atan2(off.y, off.x), TAU),
    el: Math.asin(clamp(off.z / dist, -1, 1)),
    dist,
  };
}

/** The walkable volume for the focus point. Its floor is derived from the cell. */
export function focusLimits(spec = V) {
  return {
    x: spec.walkBounds.x,
    y: spec.walkBounds.y,
    zMin: FLOOR + spec.eyeMin,
    zMax: spec.walkBounds.zMax,
  };
}

export function clampFocus(t, spec = V) {
  const l = focusLimits(spec);
  return new THREE.Vector3(
    clamp(t.x, -l.x, l.x),
    clamp(t.y, -l.y, l.y),
    clamp(t.z, l.zMin, l.zMax)
  );
}

/**
 * Lowest elevation that still keeps the eye `eyeMin` above the cell floor for a
 * focus height and range:  focus.z + dist * sin(el) >= floorZ + eyeMin.
 * Outside asin's domain the guard tells you which way the pose is illegal:
 *  - s <= -1: even straight down keeps the eye above the plate, so the floor
 *    guard is slack and only the rig's own pitch limit applies;
 *  - s >= 1: the focus is below the plate by more than the range, which
 *    clampFocus forbids; the honest answer is the pitch limit.
 */
export function minElevation(targetZ, dist, spec = V) {
  const s = (FLOOR + spec.eyeMin - targetZ) / dist;
  if (s >= 1) return spec.pitchLimit;
  if (s <= -1) return -spec.pitchLimit;
  return clamp(Math.asin(s), -spec.pitchLimit, spec.pitchLimit);
}

/** Signed angle difference on the shortest way round. */
function shortestAngle(a) {
  let x = a;
  while (x > Math.PI) x -= TAU;
  while (x < -Math.PI) x += TAU;
  return x;
}

/**
 * Create the rig. `camera` is a real THREE.PerspectiveCamera: update() writes
 * position and orientation into it, so the tests assert on the same object the
 * renderer draws with. `opts` re-tunes any published limit (the tests use this
 * to prove the constants are read from the spec, not baked into the code).
 */
export function createCameraRig(camera, opts = {}) {
  const spec = { ...V, ...opts };
  const home = homePose();
  const focusGoal = home.target.clone();
  const focus = focusGoal.clone();
  let az = home.az, el = home.el, dist = home.dist;
  let azGoal = az, elGoal = el, distGoal = dist;

  // A goal that would put the eye under the floor is rejected at the input, so
  // the damped motion never even tries to dive through the floor plate.
  const guard = (elevation, range) =>
    Math.max(minElevation(focusGoal.z, range, spec), Math.min(spec.pitchLimit, elevation));

  const state = () => ({
    az, el, dist,
    azGoal, elGoal, distGoal,
    focus: focus.clone(),
    focusGoal: focusGoal.clone(),
    eye: camera.position.clone(),
  });

  /** Orbit by a mouse delta in pixels. Yaw wraps, pitch meets the floor guard. */
  function orbit(dxPx, dyPx) {
    azGoal = THREE.MathUtils.euclideanModulo(azGoal - dxPx * spec.orbitSpeed, TAU);
    elGoal = guard(elGoal + dyPx * spec.orbitSpeed, distGoal);
  }

  /**
   * Wheel zoom. Multiplicative per notch: positive notches pull the camera BACK
   * (zoom out), negative notches push it IN, so one notch always covers the same
   * FRACTION of the range whether the eye is 42 cm or 420 cm from the block.
   */
  function zoom(notches) {
    distGoal = clamp(distGoal * Math.pow(spec.zoomStep, notches), spec.distMin, spec.distMax);
    elGoal = guard(elGoal, distGoal);
  }

  /**
   * WASD + QE walk. The basis is the view's own: forward is eye -> focus
   * projected onto the floor plane, strafe is 90 deg right of it, rise is world
   * Z. Walking moves the focus and the eye follows it, so the orbit range
   * survives a walk: walking translates, it is not a zoom.
   */
  function walk({ fwd = 0, strafe = 0, rise = 0, boost = false } = {}, dt = 1 / 60) {
    const forward = new THREE.Vector3(-Math.cos(el) * Math.cos(az), -Math.cos(el) * Math.sin(az), 0);
    if (forward.lengthSq() < 1e-12) forward.set(-Math.cos(az), -Math.sin(az), 0); // looking straight down
    forward.normalize();
    // the camera's own right axis for a Z-up lookAt: cross(forward, world Z)
    const right = new THREE.Vector3(forward.y, -forward.x, 0);
    const step = spec.walkSpeed * (boost ? spec.walkBoost : 1) * dt;
    focusGoal
      .addScaledVector(forward, fwd * step)
      .addScaledVector(right, strafe * step)
      .setZ(focusGoal.z + rise * step);
    focusGoal.copy(clampFocus(focusGoal, spec));
    elGoal = guard(elGoal, distGoal);
  }

  /** Snap onto a part: the inspection focus and the preset views use this. */
  function focusOn(point, range) {
    focusGoal.copy(clampFocus(new THREE.Vector3(...point), spec));
    focus.copy(focusGoal);
    dist = distGoal = clamp(range, spec.distMin, spec.distMax);
    el = elGoal = guard(home.el, dist);
    return writeCamera();
  }

  /** RESET CAMERA: back to the swept boot framing exactly. */
  function reset() {
    azGoal = az = home.az;
    elGoal = el = home.el;
    distGoal = dist = home.dist;
    focusGoal.copy(home.target);
    focus.copy(home.target);
    return writeCamera();
  }

  /** Chase the goals (exponential, frame-rate independent). dt is clamped. */
  function update(dt) {
    const h = clamp(dt, 0, 0.05);
    const k = 1 - Math.exp(-spec.damping * h);
    dist += (distGoal - dist) * k;
    az = THREE.MathUtils.euclideanModulo(az + shortestAngle(azGoal - az) * k, TAU);
    elGoal = guard(elGoal, distGoal);
    el += (elGoal - el) * k;
    focus.x += (focusGoal.x - focus.x) * k;
    focus.y += (focusGoal.y - focus.y) * k;
    focus.z += (focusGoal.z - focus.z) * k;
    // A damped value can still lag under the guard while the focus walks up or
    // the range shortens underneath it: clamp the APPLIED elevation too, so an
    // eye below the floor plate is structurally impossible rather than unlucky.
    const floorEl = minElevation(focus.z, dist, spec);
    if (el < floorEl) el = floorEl;
    return writeCamera();
  }

  /** Turn the spherical pose into the camera's real position and orientation. */
  function writeCamera() {
    const eye = new THREE.Vector3(
      focus.x + dist * Math.cos(el) * Math.cos(az),
      focus.y + dist * Math.cos(el) * Math.sin(az),
      focus.z + dist * Math.sin(el)
    );
    camera.up.set(0, 0, 1);
    camera.position.copy(eye);
    camera.lookAt(focus);
    camera.updateMatrixWorld(true);
    return { ...state(), eye };
  }

  return { orbit, zoom, walk, focusOn, reset, update, state, spec, home };
}
