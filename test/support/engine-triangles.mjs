// Clearance measurement for the test stand, shared by test/stand.test.mjs and
// tmp/clash-stand.mjs. The engine is measured as its real TRIANGLES, transformed
// into world space (instanced fasteners included), hashed into 4 cm cells by
// their AABBs. A probe point gets its exact distance to the nearest triangle, so
// a low-poly face (a box side with 3 vertex columns) can no longer hide a clash
// the way a vertex-only voxel shell does: the measured number IS the real gap.
import * as THREE from 'three';
import { createBlock } from '../../src/render/block.js';
import { createCranktrain } from '../../src/render/cranktrain.js';
import { createValvetrain } from '../../src/render/valvetrain.js';
import { createHeads } from '../../src/render/heads.js';
import { createManifolds } from '../../src/render/manifolds.js';
import { createPlugs } from '../../src/render/plugs.js';
import { createOil } from '../../src/render/oil.js';
import { createCoolant } from '../../src/render/coolant.js';
import { GLOW_SPECS } from '../../src/render/materials.js';
import { SPEC } from '../../src/engine/spec.js';

export const TRI_CELL = 4.0;
const SEARCH = 2; // +/- 2 cells: any triangle within 8 cm of the probe is examined

/**
 * MeshStandardMaterial proxy: materials.js needs a document, tests do not. The
 * additive glow families named in src/render/materials.js GLOW_SPECS are the
 * exception - they are built from those published parameters, so a test measures
 * the same material TYPE the product draws rather than a PBR metal standing in
 * for a light.
 */
const glowFamilies = new Set(Object.keys(GLOW_SPECS));
export const proxyMaterials = () =>
  new Proxy({}, {
    get: (t, k) => (t[k] ??= glowFamilies.has(String(k))
      ? new THREE.MeshBasicMaterial({ name: String(k), ...GLOW_SPECS[String(k)] })
      : new THREE.MeshStandardMaterial({ name: String(k) })),
  });

/**
 * The engine the laws measure, for the build `variantId` names. Only the creators
 * that are variant-aware today read it - src/render/block.js `createBlock`,
 * src/render/valvetrain.js `createValvetrain`, src/render/heads.js `createHeads`,
 * src/render/manifolds.js `createManifolds`, src/render/oil.js `createOil` and
 * src/render/coolant.js `createCoolant`; `createCranktrain` and `createPlugs` are
 * shared by both builds. The heads and the pipework a law measures here are the
 * SHIPPED build's, because that is the casting the head and manifold laws gate -
 * a law that wants this variant's own head iron names `createHeads(materials,
 * 'ohv')` itself (test/ohv-head.test.mjs does).
 */
export function engineUnits(materials, variantId = SPEC.build.variant) {
  return {
    block: createBlock(materials, variantId),
    cranktrain: createCranktrain(materials).group,
    valvetrain: createValvetrain(materials, variantId).group,
    heads: createHeads(materials, SPEC.build.variant).group,
    manifolds: createManifolds(materials, SPEC.build.variant).group,
    // The plug unit keeps its update(): a law that gates a tip flash has to pose
    // the flash the way src/main.js does, through the same renderer.
    plugs: createPlugs(materials),
    // The oil assembly is static: no SPEC models a pump drive or a pressure, so there
    // is no update() to pose here (slice 8D-2a, src/render/oil.js). A law that wants
    // the shell WITHOUT the drilled oil ways names its own `opts.units`: an oil way is
    // metal removed from a casting, so it is measured against that casting, never as
    // an obstacle standing beside it.
    oil: createOil(materials, variantId).group,
    // The coolant assembly is static for the same reason the oil ways are: nothing in
    // SPEC models a pump drive or a temperature (SPEC.coolant.pending), so there is no
    // update() to pose. A member is a cavity the casting does not have, so a law that
    // measures a casting measures the casting, never the water inside it as an
    // obstacle beside it (slice 8E, src/render/coolant.js).
    coolant: createCoolant(materials, variantId).group,
  };
}

const key = (x, y, z) => `${Math.round(x / TRI_CELL)},${Math.round(y / TRI_CELL)},${Math.round(z / TRI_CELL)}`;

/**
 * World-space triangle shell of everything the engine renders.
 * Returns { tris, hash, stats }.
 */
export function engineTriangles(materials = proxyMaterials(), opts = {}) {
  const tris = [];
  const hash = new Map();
  let meshes = 0, instances = 0, verts = 0;
  const push = (a, b, c, label) => {
    const ab = b.clone().sub(a);
    const ac = c.clone().sub(a);
    const n = ab.clone().cross(ac);
    const len2 = n.lengthSq();
    if (len2 < 1e-12) return; // degenerate: no surface to measure against
    const i = tris.length;
    // plane form n.x + d0 = 0 is precomputed once per triangle: the probe then
    // needs a dot product instead of a cross product per test
    tris.push({ a, b, c, label, n, len2, d0: n.dot(a) });
    const x0 = Math.min(a.x, b.x, c.x), x1 = Math.max(a.x, b.x, c.x);
    const y0 = Math.min(a.y, b.y, c.y), y1 = Math.max(a.y, b.y, c.y);
    const z0 = Math.min(a.z, b.z, c.z), z1 = Math.max(a.z, b.z, c.z);
    for (let cx = Math.floor(x0 / TRI_CELL); cx <= Math.ceil(x1 / TRI_CELL); cx++) {
      for (let cy = Math.floor(y0 / TRI_CELL); cy <= Math.ceil(y1 / TRI_CELL); cy++) {
        for (let cz = Math.floor(z0 / TRI_CELL); cz <= Math.ceil(z1 / TRI_CELL); cz++) {
          const k = `${cx},${cy},${cz}`;
          const list = hash.get(k);
          if (list) list.push(i);
          else hash.set(k, [i]);
        }
      }
    }
  };
  // opts.units names which units to keep in the shell (default: all of them). A law
  // that measures a plug bore against the castings it is machined into needs the
  // casting-only shell; a law that measures the same bore against the moving valve
  // heads beside it needs the whole engine. Both readings are the same triangles.
  // opts.variant names which BUILD those units are: omitted, it is the tree's own
  // SPEC.build.variant, so every closed row's shell is the shell it already measured.
  const units = engineUnits(materials, opts.variant);
  const keep = opts.units ?? Object.keys(units);
  for (const k of keep) {
    // A unit is either an Object3D or a renderer unit that hands back one
    // (createPlugs carries update() next to its group).
    const root = units[k].isObject3D ? units[k] : units[k].group;
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh) return;
      meshes++;
      const label = o.name || o.userData.kind || 'part';
      o.updateWorldMatrix(true, false);
      const geo = o.geometry;
      const pos = geo.attributes.position;
      const idx = geo.index;
      const n = idx ? idx.count : pos.count;
      verts += pos.count;
      const at = (k, m) => new THREE.Vector3().fromBufferAttribute(pos, k).applyMatrix4(m);
      const walk = (m) => {
        for (let j = 0; j < n; j += 3) {
          const i0 = idx ? idx.getX(j) : j;
          const i1 = idx ? idx.getX(j + 1) : j + 1;
          const i2 = idx ? idx.getX(j + 2) : j + 2;
          push(at(i0, m), at(i1, m), at(i2, m), label);
        }
      };
      if (o.isInstancedMesh) {
        const im = new THREE.Matrix4();
        for (let t = 0; t < o.count; t++) {
          instances++;
          im.identity();
          o.getMatrixAt(t, im);
          walk(im.premultiply(o.matrixWorld)); // world = matrixWorld x instanceMatrix
        }
      } else {
        walk(o.matrixWorld);
      }
    });
  }
  return { tris, hash, stats: { meshes, instances, verts, tris: tris.length, cells: hash.size } };
}

// three r187 has no Triangle.distanceToPoint (neither static nor instance), and
// a hand-rolled exact measure is 20 lines with no dependency. The closest point
// on a triangle is either its plane projection (when that lands inside) or a
// point on one of its three edges - nothing else - so both cases are tested.
const EPS_IN = 1e-9;

function distToSegment(p, a, b) {
  const ab = tmpAB.subVectors(b, a);
  const ap = tmpV.subVectors(p, a);
  let t = ap.dot(ab) / Math.max(1e-12, ab.lengthSq());
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  tmpP.copy(a).addScaledVector(ab, t);
  return tmpP.distanceTo(p);
}

/** Barycentric-free inside test: all three edge cross products point the same way as n. */
function insideTriangle(a, b, c, p, n) {
  tmpC.crossVectors(tmpAB.subVectors(b, a), tmpV.subVectors(p, a));
  if (tmpC.dot(n) < -EPS_IN) return false;
  tmpC.crossVectors(tmpV2.subVectors(c, b), tmpV.subVectors(p, b));
  if (tmpC.dot(n) < -EPS_IN) return false;
  tmpC.crossVectors(tmpAB2.subVectors(a, c), tmpV.subVectors(p, c));
  return tmpC.dot(n) >= -EPS_IN;
}

export function distToTriangle(t, p) {
  const signed = t.n.dot(p) - t.d0; // signed distance x |n| to the plane
  const q = tmpQ.copy(p).addScaledVector(t.n, -signed / t.len2);
  if (insideTriangle(t.a, t.b, t.c, q, t.n)) return Math.abs(signed) / Math.sqrt(t.len2);
  return Math.min(
    distToSegment(p, t.a, t.b),
    distToSegment(p, t.b, t.c),
    distToSegment(p, t.c, t.a)
  );
}

const tmpAB = new THREE.Vector3();
const tmpAB2 = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const tmpQ = new THREE.Vector3();
const tmpP = new THREE.Vector3();

const tmpW = new THREE.Vector3();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

// Per-triangle AABBs are cached on the triangle itself at build time; the
// candidate filters below read them instead of re-deriving them per probe.
const boxOf = (t) => t.bb || (t.bb = [
  Math.min(t.a.x, t.b.x, t.c.x), Math.max(t.a.x, t.b.x, t.c.x),
  Math.min(t.a.y, t.b.y, t.c.y), Math.max(t.a.y, t.b.y, t.c.y),
  Math.min(t.a.z, t.b.z, t.c.z), Math.max(t.a.z, t.b.z, t.c.z),
]);

/** Nearest engine triangle to a world point, restricted to a candidate list. */
function nearestTri(shell, cand, p, pad) {
  let best = Infinity, who = null;
  for (const i of cand) {
    const t = shell.tris[i];
    const q = boxOf(t);
    if (p[0] + pad < q[0] || p[0] - pad > q[1]) continue;
    if (p[1] + pad < q[2] || p[1] - pad > q[3]) continue;
    if (p[2] + pad < q[4] || p[2] - pad > q[5]) continue;
    const d = distToTriangle(t, tmpW.set(p[0], p[1], p[2]));
    if (d < best) { best = d; who = t.label; }
  }
  return { d: best, who };
}

/** Candidate gather: triangles whose AABB reaches a world box expanded by pad. */
function gather(shell, lo, hi, pad) {
  const out = [];
  const seen = new Set();
  for (let cx = Math.floor((lo[0] - pad) / TRI_CELL); cx <= Math.ceil((hi[0] + pad) / TRI_CELL); cx++) {
    for (let cy = Math.floor((lo[1] - pad) / TRI_CELL); cy <= Math.ceil((hi[1] + pad) / TRI_CELL); cy++) {
      for (let cz = Math.floor((lo[2] - pad) / TRI_CELL); cz <= Math.ceil((hi[2] + pad) / TRI_CELL); cz++) {
        const list = shell.hash.get(`${cx},${cy},${cz}`);
        if (!list) continue;
        for (const i of list) {
          if (seen.has(i)) continue;
          seen.add(i);
          out.push(i);
        }
      }
    }
  }
  return out;
}

/** Exact distance from a world point to the nearest engine triangle, with its owner. */
export function triDistance(shell, p) {
  const ix = Math.round(p[0] / TRI_CELL), iy = Math.round(p[1] / TRI_CELL), iz = Math.round(p[2] / TRI_CELL);
  const cand = [];
  for (let a = -SEARCH; a <= SEARCH; a++) {
    for (let b = -SEARCH; b <= SEARCH; b++) {
      for (let c = -SEARCH; c <= SEARCH; c++) {
        const list = shell.hash.get(`${ix + a},${iy + b},${iz + c}`);
        if (list) for (const i of list) cand.push(i);
      }
    }
  }
  const r = nearestTri(shell, cand, p, (SEARCH + 1) * TRI_CELL);
  return { d: r.d, who: r.who, at: p };
}

/**
 * Worst (smallest) engine-triangle distance over the surface of a world box,
 * measured exactly for every gap up to `pad`. The candidate set is gathered
 * once from the box's own expanded AABB, then the surface is probed in two
 * stages: a coarse grid locates the closest basin, a fine grid measures it. A
 * face-to-face contact (a mount plate on a casting plane, the case that
 * matters here) reads the same value at every sample in the overlap, so the
 * fine stage lands on the true minimum.
 *
 * `pad` is a search radius, not a tolerance: a triangle can only win a probe if
 * its AABB reaches within pad of it, and a triangle that is genuinely within
 * pad of the probe always satisfies that. So every returned value <= pad is
 * the exact real gap; anything further away reports Infinity ("clear"), which
 * is the honest answer for a member that keeps its distance. The clearance
 * design limits here are 0.05..0.5 cm, so a 2 cm radius sees them all.
 */
export function boxTriangleWorst(shell, bb, opts = {}) {
  const coarse = opts.coarse ?? 1.0;
  const fine = opts.fine ?? 0.12;
  const pad = opts.pad ?? 2.0;
  const cand = gather(shell, [bb[0], bb[2], bb[4]], [bb[1], bb[3], bb[5]], pad);
  const [x0, x1, y0, y1, z0, z1] = bb;
  let worst = Infinity, who = null, at = null, probes = 0;
  const probe = (x, y, z) => {
    probes += 1;
    const r = nearestTri(shell, cand, [x, y, z], pad);
    if (r.d < worst) { worst = r.d; who = r.who; at = [x, y, z]; }
  };
  const faces = (step, cx, cy, cz) => {
    // second stage: only the neighbourhood of the coarse basin
    const rx = cx == null ? [x0, x1] : [Math.max(x0, cx - 1.5), Math.min(x1, cx + 1.5)];
    const ry = cy == null ? [y0, y1] : [Math.max(y0, cy - 1.5), Math.min(y1, cy + 1.5)];
    const rz = cz == null ? [z0, z1] : [Math.max(z0, cz - 1.5), Math.min(z1, cz + 1.5)];
    for (let x = rx[0]; x <= rx[1] + 1e-9; x += step) {
      for (let y = ry[0]; y <= ry[1] + 1e-9; y += step) { probe(x, y, rz[0]); probe(x, y, rz[1]); }
      for (let z = rz[0]; z <= rz[1] + 1e-9; z += step) { probe(x, ry[0], z); probe(x, ry[1], z); }
    }
    for (let y = ry[0]; y <= ry[1] + 1e-9; y += step) {
      for (let z = rz[0]; z <= rz[1] + 1e-9; z += step) { probe(rx[0], y, z); probe(rx[1], y, z); }
    }
  };
  faces(coarse, null, null, null);
  if (at && Number.isFinite(worst)) faces(fine, at[0], at[1], at[2]);
  return { worst, who, at: at ? at.map((n) => +n.toFixed(2)) : null, probes, candidates: cand.length };
}

/**
 * Worst engine-triangle distance along a strut axis, minus the strut's own
 * radius. Same two-stage idea, on the axis parameter.
 */
export function strutTriangleWorst(shell, m, opts = {}) {
  const coarse = opts.coarse ?? 0.5;
  const fine = opts.fine ?? 0.06;
  const pad = opts.pad ?? 2.0;
  const lo = [Math.min(m.a[0], m.b[0]) - m.r, Math.min(m.a[1], m.b[1]) - m.r, Math.min(m.a[2], m.b[2]) - m.r];
  const hi = [Math.max(m.a[0], m.b[0]) + m.r, Math.max(m.a[1], m.b[1]) + m.r, Math.max(m.a[2], m.b[2]) + m.r];
  const cand = gather(shell, lo, hi, pad);
  tmpA.set(...m.a);
  tmpB.set(...m.b);
  const len = tmpA.distanceTo(tmpB);
  const n = Math.max(8, Math.ceil(len / coarse));
  let worst = Infinity, who = null, at = null, tBest = 0, probes = 0;
  const probe = (t) => {
    probes += 1;
    const p = tmpW.copy(tmpA).lerp(tmpB, t);
    const r = nearestTri(shell, cand, [p.x, p.y, p.z], pad);
    const d = Math.max(0, r.d - m.r);
    if (d < worst) { worst = d; who = r.who; at = [p.x, p.y, p.z]; tBest = t; }
  };
  for (let i = 0; i <= n; i++) probe(i / n);
  if (Number.isFinite(worst)) {
    const t0 = Math.max(0, tBest - coarse / len);
    const t1 = Math.min(1, tBest + coarse / len);
    const k = Math.max(1, Math.ceil(((t1 - t0) * len) / fine));
    for (let i = 0; i <= k; i++) probe(t0 + (t1 - t0) * (i / k));
  }
  return { worst, who, at: at ? at.map((v) => +v.toFixed(2)) : null, probes, candidates: cand.length };
}
