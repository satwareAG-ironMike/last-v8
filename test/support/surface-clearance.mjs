// Exact surface clearance probing for laws that gate one solid against another.
// The voxel reading in test/manifolds.test.mjs is a coarse stand-in: a casting
// corner and a pipe corner in neighbouring 1 cm cells can read 0.5 cm apart while
// their surfaces stand 0.001 cm apart or interpenetrate. A law about a cast
// bearing housing (which cannot be moved) and the pipework bolted outside it is
// therefore measured here, exactly, on the real rendered triangles.
//
// How it stays honest:
//  - distToTriangle (test/support/engine-triangles.mjs) is the same exact measure
//    every other machined-clearance law in this repo already uses.
//  - The candidate grid is bucketed by AABB. A probe examines every bucket whose
//    cell reaches within SCAN buckets of its own, so any gap under
//    SCAN * BUCKET (= reach) is examined; the returned number is then the true
//    surface distance, not an estimate. Distances at or above reach are reported
//    as Infinity ("clear within reach") and the caller has to say so.
import * as THREE from 'three';
import { distToTriangle } from './engine-triangles.mjs';

export const BUCKET = 4.0;
export const SCAN = 1;
export const REACH = SCAN * BUCKET; // 4 cm: every gap under this is measured exactly

/** A pipework/part name belongs to the bank named in it: `plenum-L`, `primary-L-5.5`. */
export const BANK_RE = /-(L|R)\b/;

/**
 * The world matrices one mesh actually draws at: one for an ordinary mesh, and
 * one per instance for an InstancedMesh. The tree draws its repeat hardware -
 * chain rollers and side plates, stand bolts, head bolts - as instances, whose
 * metal lives only in instanceMatrix: reading the prototype at the group origin
 * measures a part that is not drawn there at all.
 */
function worldMatrices(o) {
  if (!o.isInstancedMesh) return [o.matrixWorld];
  const out = new Array(o.count);
  const local = new THREE.Matrix4();
  for (let i = 0; i < o.count; i++) {
    o.getMatrixAt(i, local);
    out[i] = local.premultiply(o.matrixWorld);
  }
  return out;
}

/** World triangles of one mesh into a {tris, hash} shell readable by nearestInShell. */
export function shellAdd(shell, o) {
  o.updateWorldMatrix(true, false);
  const pos = o.geometry.attributes.position, idx = o.geometry.index;
  const n = idx ? idx.count : pos.count;
  const mats = worldMatrices(o);
  const at = (k, m) => new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(k) : k).applyMatrix4(m);
  shell.box ??= new THREE.Box3();
  const push = (a, b, c) => {
    const ab = b.clone().sub(a), ac = c.clone().sub(a);
    const normal = ab.clone().cross(ac);
    const len2 = normal.lengthSq();
    if (len2 < 1e-12) return; // degenerate: no surface to measure against
    const i = shell.tris.length;
    shell.tris.push({
      a, b, c, label: o.name, n: normal, len2, d0: normal.dot(a),
      box: {
        x0: Math.min(a.x, b.x, c.x), x1: Math.max(a.x, b.x, c.x),
        y0: Math.min(a.y, b.y, c.y), y1: Math.max(a.y, b.y, c.y),
        z0: Math.min(a.z, b.z, c.z), z1: Math.max(a.z, b.z, c.z),
      },
    });
    for (let cx = Math.floor(Math.min(a.x, b.x, c.x) / BUCKET); cx <= Math.ceil(Math.max(a.x, b.x, c.x) / BUCKET); cx++)
      for (let cy = Math.floor(Math.min(a.y, b.y, c.y) / BUCKET); cy <= Math.ceil(Math.max(a.y, b.y, c.y) / BUCKET); cy++)
        for (let cz = Math.floor(Math.min(a.z, b.z, c.z) / BUCKET); cz <= Math.ceil(Math.max(a.z, b.z, c.z) / BUCKET); cz++) {
          const k = `${cx},${cy},${cz}`;
          const list = shell.hash.get(k);
          if (list) list.push(i); else shell.hash.set(k, [i]);
        }
  };
  for (const m of mats) for (let j = 0; j < n; j += 3) push(at(j, m), at(j + 1, m), at(j + 2, m));
  // shell.box is the union of everything in the shell, so a caller can skip a
  // solid whose own box cannot reach it. setFromObject replaces, so the union is
  // built by hand: an empty Box3 unioned would poison the bounds with infinities.
  const bb = new THREE.Box3().setFromObject(o);
  if (shell.box.isEmpty()) shell.box.copy(bb);
  else shell.box.union(bb);
  return shell;
}

export function newShell() {
  return { tris: [], hash: new Map(), box: new THREE.Box3() };
}

/** Union of the boxes of everything already added to a shell. */
export function shellBox(shell) {
  return shell.box;
}

/** Sampled world surface of a mesh: every vertex plus every edge midpoint. */
export function surfaceOf(o) {
  o.updateWorldMatrix(true, false);
  const pos = o.geometry.attributes.position, idx = o.geometry.index;
  const n = idx ? idx.count : pos.count;
  const mats = worldMatrices(o);
  const at = (k, m) => new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(k) : k).applyMatrix4(m);
  const out = [];
  for (const m of mats) for (let j = 0; j < n; j += 3) {
    const a = at(j, m), b = at(j + 1, m), c = at(j + 2, m);
    out.push(a, b, c,
      a.clone().add(b).multiplyScalar(0.5), b.clone().add(c).multiplyScalar(0.5), c.clone().add(a).multiplyScalar(0.5));
  }
  return out;
}

/**
 * Exact distance from a world point to the nearest triangle of a shell, with its
 * owner. Every real gap under REACH is found; anything further reads Infinity.
 */
export function nearestInShell(shell, p) {
  const ix = Math.floor(p.x / BUCKET), iy = Math.floor(p.y / BUCKET), iz = Math.floor(p.z / BUCKET);
  let best = Infinity, who = null;
  for (let a = -SCAN; a <= SCAN; a++) for (let b = -SCAN; b <= SCAN; b++) for (let c = -SCAN; c <= SCAN; c++) {
    const list = shell.hash.get(`${ix + a},${iy + b},${iz + c}`);
    if (!list) continue;
    for (const i of list) {
      const t = shell.tris[i];
      // The triangle's own box is a cheap floor on its distance: a triangle whose
      // box is already further than the current best cannot win, so the exact
      // measure runs only on the handful of candidates that could.
      const dx = Math.max(t.box.x0 - p.x, p.x - t.box.x1, 0);
      const dy = Math.max(t.box.y0 - p.y, p.y - t.box.y1, 0);
      const dz = Math.max(t.box.z0 - p.z, p.z - t.box.z1, 0);
      if (Math.hypot(dx, dy, dz) >= best) continue;
      const d = distToTriangle(t, p);
      if (d < best) { best = d; who = t.label; }
    }
  }
  return { d: best, who };
}

/**
 * Closest surface approach between a sampled solid and a shell: walks the sampled
 * surface of `o`, skipping it whole when its box cannot reach the shell's box.
 * Returns { d, into, at } with d = Infinity when nothing came within REACH.
 */
export function closestToShell(o, shell, opts = {}) {
  const ob = new THREE.Box3().setFromObject(o);
  const sb = shell.box;
  if (ob.max.x < sb.min.x - REACH || ob.min.x > sb.max.x + REACH ||
      ob.max.y < sb.min.y - REACH || ob.min.y > sb.max.y + REACH ||
      ob.max.z < sb.min.z - REACH || ob.min.z > sb.max.z + REACH)
    return { d: Infinity, into: null, at: null };
  const points = opts.surface === false ? null : surfaceOf(o);
  let best = Infinity, into = null, at = null;
  const test = (p) => {
    const r = nearestInShell(shell, p);
    if (r.d < best) { best = r.d; into = r.who; at = p; }
  };
  if (points) for (const p of points) test(p);
  else { o.updateWorldMatrix(true, false); o.traverse((m) => { if (!m.isMesh) return; const pos = m.geometry.attributes.position; m.updateWorldMatrix(true, false); for (const mat of worldMatrices(m)) for (let i = 0; i < pos.count; i++) test(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mat)); }); }
  return { d: best, into, at };
}

/** Closest surface approach between two sampled solids. */
export function solidsClearance(a, b) {
  const shell = newShell();
  for (const o of (b.isObject3D ? [b] : b)) shellAdd(shell, o);
  return closestToShell(a.isObject3D ? a : a, shell);
}
