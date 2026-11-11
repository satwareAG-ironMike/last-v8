// Solid primitives for engine parts: boxes axis-aligned in a bank frame,
// world-aligned boxes, and closed solids of revolution about the crank axis
// (world X) or a bank bore axis. All coordinates cm, right-handed transforms
// only - geometry normals must stay outward (verified in test/parts.test.mjs).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BANKS, bankUp, bankOut } from '../engine/spec.js';
import { alignYTo } from './primitives.js';

const X = new THREE.Vector3(1, 0, 0);

/**
 * Right-handed bank frame as a matrix mapping local axes to world:
 * bank R local (X, out, up), bank L local (X, up, out). Determinant is +1
 * for both banks, so applyMatrix4 can never mirror the winding.
 */
export function bankFrame(bank) {
  const up = new THREE.Vector3().fromArray(bankUp(bank));
  const out = new THREE.Vector3().fromArray(bankOut(bank));
  const right = BANKS[bank].outSign > 0;
  const m = new THREE.Matrix4().makeBasis(X, ...(right ? [out, up] : [up, out]));
  return { m, right, up, out };
}

function filletedBox(dx, dy, dz, fillet) {
  const r = Math.min(fillet, 0.45 * Math.min(dx, dy, dz));
  return r > 0.01 ? new RoundedBoxGeometry(dx, dy, dz, 2, r) : new THREE.BoxGeometry(dx, dy, dz);
}

/** Bank-local solid: along [a0,a1] x out [o0,o1] x x [x0,x1], optional cast fillet. */
export function boxInBank(bank, a0, a1, o0, o1, x0, x1, fillet = 0) {
  const { m, right } = bankFrame(bank);
  const dims = right ? [x1 - x0, o1 - o0, a1 - a0] : [x1 - x0, a1 - a0, o1 - o0];
  const ctr = right
    ? [(x0 + x1) / 2, (o0 + o1) / 2, (a0 + a1) / 2]
    : [(x0 + x1) / 2, (a0 + a1) / 2, (o0 + o1) / 2];
  const g = filletedBox(...dims, fillet);
  g.translate(...ctr);
  g.applyMatrix4(m);
  return g;
}

/** World-axis-aligned solid with optional cast fillet. */
export function worldBox(x0, x1, y0, y1, z0, z1, fillet = 0) {
  const g = filletedBox(x1 - x0, y1 - y0, z1 - z0, fillet);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

function latheProfile(pairs) {
  return pairs.map(([r, a]) => new THREE.Vector2(r, a));
}

/**
 * Closed solid of revolution about world X (crank axis).
 * Profile: ordered [radius, x] points, closed by repeating the first point.
 * Convention: outer wall ascending, top ring inward, inner wall descending -
 * this keeps outward-facing normals (proven by the signed-volume tests).
 */
export function latheX(pairs, segments = 48) {
  const g = new THREE.LatheGeometry(latheProfile(pairs), segments, 0, Math.PI * 2);
  g.rotateZ(-Math.PI / 2); // lathe axis +Y -> world +X, outward winding kept
  return g;
}

/**
 * Closed solid of revolution about a bank bore axis, offset `x` cm along the
 * crank axis (world X) to its cylinder station. Profile: [radius, along].
 */
export function latheBank(bank, pairs, segments = 48, x = 0) {
  const g = new THREE.LatheGeometry(latheProfile(pairs), segments, 0, Math.PI * 2);
  g.applyQuaternion(alignYTo(bankUp(bank)));
  g.translate(x, 0, 0); // station offset is along world X, never along the bore
  return g;
}
