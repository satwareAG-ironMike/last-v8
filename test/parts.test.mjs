// Renderer geometry helpers must transform bank-frame solids to world exactly
// as spec.js bankPoint does, and must keep outward-facing winding (det +1),
// otherwise normals flip and the casting renders inside-out.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { boxInBank, worldBox, latheX, latheBank } from '../src/render/parts.js';
import { SPEC, OD, ID, supportColumn, bankUp, bankPoint } from '../src/engine/spec.js';

const B = SPEC.block;

function signedVolume(g) {
  assert.ok(g.index, 'indexed geometry expected');
  const pos = g.attributes.position;
  let vol = 0;
  for (let i = 0; i < g.index.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(pos, g.index.getX(i));
    const b = new THREE.Vector3().fromBufferAttribute(pos, g.index.getX(i + 1));
    const c = new THREE.Vector3().fromBufferAttribute(pos, g.index.getX(i + 2));
    vol += a.dot(b.cross(c)) / 6;
  }
  return vol;
}

function hasVertex(g, target, eps = 1e-4) {
  // positions live in a Float32Array: rounding allows ~1e-5 at these magnitudes
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (
      Math.abs(pos.getX(i) - target.x) < eps &&
      Math.abs(pos.getY(i) - target.y) < eps &&
      Math.abs(pos.getZ(i) - target.z) < eps
    )
      return true;
  }
  return false;
}

test('boxInBank corners map exactly to bankPoint on both banks', () => {
  const col = supportColumn('L');
  for (const bank of ['L', 'R']) {
    const g = boxInBank(bank, col.along0, col.along1, col.out0, col.out1, 11, 22, 0);
    for (const a of [col.along0, col.along1]) {
      for (const o of [col.out0, col.out1]) {
        for (const x of [11, 22]) {
          const e = bankPoint(bank, a, o, x);
          assert.ok(
            hasVertex(g, e),
            `bank ${bank} missing corner along=${a} out=${o} x=${x} -> (${e.y.toFixed(3)}, ${e.z.toFixed(3)})`
          );
        }
      }
    }
  }
});

test('boxInBank keeps outward-facing winding on both banks', () => {
  for (const bank of ['L', 'R']) {
    const g = boxInBank(bank, 9.25, 24.1, 5.35, 7.0, 11, 22, 0);
    assert.ok(signedVolume(g) > 0, `bank ${bank}: inside-out (mirrored basis)`);
  }
});

test('worldBox spans the requested extents', () => {
  const g = worldBox(-21, 21, -3.2, 3.2, -14.6, -11.6, 0);
  g.computeBoundingBox();
  const bb = g.boundingBox;
  assert.ok(
    Math.abs(bb.min.x + 21) < 1e-5 && Math.abs(bb.max.x - 21) < 1e-5 &&
    Math.abs(bb.min.y + 3.2) < 1e-5 && Math.abs(bb.max.y - 3.2) < 1e-5 &&
    Math.abs(bb.min.z + 14.6) < 1e-5 && Math.abs(bb.max.z + 11.6) < 1e-5,
    `bbox ${JSON.stringify([bb.min.x, bb.max.x, bb.min.y, bb.max.y, bb.min.z, bb.max.z])}`
  );
  assert.ok(signedVolume(g) > 0);
});

test('latheX closed drum: outward normals, axial extent on world X, exact radii', () => {
  const g = latheX([[OD, -22], [OD, 22], [ID, 22], [ID, -22], [OD, -22]], 64);
  assert.ok(signedVolume(g) > 0, 'drum renders inside-out');
  g.computeBoundingBox();
  const bb = g.boundingBox;
  assert.ok(Math.abs(bb.min.x + 22) < 1e-4 && Math.abs(bb.max.x - 22) < 1e-4);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getY(i), pos.getZ(i));
    assert.ok(Math.abs(r - OD) < 1e-4 || Math.abs(r - ID) < 1e-4, `vertex radius ${r} off shell`);
  }
});

test('latheX keeps the profile on its requested side of world X (no axis flip)', () => {
  // asymmetric solid: fore disc x 22..26.5 with main hole 4.6
  const g = latheX([[4.6, 22], [OD, 22], [OD, 26.5], [4.6, 26.5], [4.6, 22]], 48);
  g.computeBoundingBox();
  assert.ok(Math.abs(g.boundingBox.min.x - 22) < 1e-4 && Math.abs(g.boundingBox.max.x - 26.5) < 1e-4,
    `x span ${g.boundingBox.min.x}..${g.boundingBox.max.x} must be 22..26.5`);
  assert.ok(signedVolume(g) > 0);
});

test('latheBank liner ring is coaxial with the bore axis', () => {
  const linerOD = B.boreShellRadius + 0.15;
  // outer-first closed profile (same pattern latheX documents)
  const prof = [
    [linerOD, B.boreStartA],
    [linerOD, B.deckA],
    [B.boreRadius, B.deckA],
    [B.boreRadius, B.boreStartA],
    [linerOD, B.boreStartA],
  ];
  for (const bank of ['L', 'R']) {
    const g = latheBank(bank, prof, 48);
    assert.ok(signedVolume(g) > 0, `bank ${bank}: liner inside-out`);
    const upL = new THREE.Vector3().fromArray(bankUp(bank));
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i);
      const along = v.dot(upL);
      // radial plane of the bank frame is spanned by world X and bank out:
      // r^2 = |v|^2 - along^2
      const r2 = v.lengthSq() - along * along;
      const r = Math.sqrt(Math.max(0, r2));
      assert.ok(
        Math.abs(r - B.boreRadius) < 1e-4 || Math.abs(r - linerOD) < 1e-4,
        `bank ${bank} vertex radius ${r} not on liner shells`
      );
      assert.ok(along >= B.boreStartA - 1e-4 && along <= B.deckA + 1e-4, 'liner out of axial range');
    }
  }
});
