// Cast-iron measurement for the test stand, shared by test/crankblock.test.mjs and the
// tmp/ probes that re-derive issue #18's numbers. The block is measured as its real
// TRIANGLES, because a vertex scan cannot see this defect: the block's supports are
// RoundedBoxGeometry, which carries no vertex in the middle of a face, so the 0.1000 cm
// of cast support standing inside a bearing shell's own bore reads as 3.3593 cm of
// clearance to the nearest vertex (#18 Measured 1).
//
// Every reading here is a distance off the CRANK AXIS (the world x axis) and an x window.
// The crank turns a full 360 deg, so what its hardware occupies is an annulus over an x
// band, and comparing (x, radius) pairs is exact for it (#18 "Measurement tool defect":
// the ray-parity burial test failed its own control points and is not used here).
import * as THREE from 'three';
import { createBlock } from '../../src/render/block.js';
import { MAIN_CAPS_X } from '../../src/engine/spec.js';

// The three mains this block carries itself; the fore and aft mains ride the end discs
// and belong to issue #28.
export const CENTRAL_MAINS = MAIN_CAPS_X.slice(1, 4); // 11, 0, -11
// Half the x window of a drawn bearing shell: src/render/block.js bands main-shell-x at
// c +/- 0.9 and turns the ring 0.05 inside that, so a seat is measured over the shell's
// own band.
export const SHELL_HALF = 0.9;
// A triangle read off a Float32 attribute, held to 1e-3 cm: seven times the chord sagitta
// the casting's own 0.5 deg machined step leaves on a 3.45 cm arc (3.45 * (1 - cos 0.25 deg)
// = 1.3e-4) and two orders under the 0.1000 cm issue #18 measures.
export const IRON_EPS = 1e-3;
// The bearing surfaces that are MEANT to touch (issue #18 ask 2): a shell or a bushing.
// Nothing else in the casting may stand closer to the crank than the published air.
export const BEARING_SURFACE = /^(main-shell|main-bush|rod-shell|rod-bush)/;

export function treeMats() {
  const cache = new Map();
  return new Proxy({}, {
    get: (t, k) => (cache.get(k) ?? cache.set(k, new THREE.MeshStandardMaterial({ name: String(k) })).get(k)),
  });
}

const segDist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2));
  return Math.hypot(ax + t * dx - px, ay + t * dy - py);
};

/**
 * The exact distance from the crank axis to one drawn triangle: 0 when the axis line
 * pierces the face, otherwise the nearest point on its three edges.
 */
export function triAxisR(pos, i, j, k) {
  const a = [pos.getY(i), pos.getZ(i)];
  const b = [pos.getY(j), pos.getZ(j)];
  const c = [pos.getY(k), pos.getZ(k)];
  const cr = (u, v) => u[0] * v[1] - u[1] * v[0];
  const s1 = cr(a, b), s2 = cr(b, c), s3 = cr(c, a);
  if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) return 0;
  return Math.min(segDist(0, 0, ...a, ...b), segDist(0, 0, ...b, ...c), segDist(0, 0, ...c, ...a));
}

/**
 * Every cast-iron face of one build's block: { part, tris }, each triangle carrying its x
 * window, its distance off the crank axis, and the angle about that axis of the face point
 * nearest the axis.
 */
export function castIron(variant) {
  const block = createBlock(treeMats(), variant);
  const out = [];
  for (const m of block.children) {
    if (!m.isMesh || !m.userData.solid || m.material?.name !== 'castIronBlock') continue;
    const pos = m.geometry.attributes.position, idx = m.geometry.index;
    const n = idx ? idx.count : pos.count;
    const tris = [];
    for (let q = 0; q < n; q += 3) {
      const i = idx ? idx.getX(q) : q, j = idx ? idx.getX(q + 1) : q + 1, k = idx ? idx.getX(q + 2) : q + 2;
      const r = triAxisR(pos, i, j, k);
      const corners = [[pos.getY(i), pos.getZ(i)], [pos.getY(j), pos.getZ(j)], [pos.getY(k), pos.getZ(k)]];
      const at = corners.reduce((p, q2) => (Math.hypot(...q2) <= Math.hypot(...p) ? q2 : p), corners[0]);
      tris.push({
        x0: Math.min(pos.getX(i), pos.getX(j), pos.getX(k)),
        x1: Math.max(pos.getX(i), pos.getX(j), pos.getX(k)),
        r,
        ang: Math.atan2(at[1], at[0]),
      });
    }
    out.push({ part: m.userData.part || m.name, tris });
  }
  return out;
}

/** The iron standing in one central main's shell band, closest first. */
export function seatIron(iron, c) {
  const rows = [];
  for (const e of iron) {
    const inBand = e.tris.filter((t) => t.x1 >= c - SHELL_HALF && t.x0 <= c + SHELL_HALF);
    if (!inBand.length) continue;
    rows.push({ part: e.part, r: inBand.reduce((p, q) => (q.r < p.r ? q : p)).r });
  }
  return rows.sort((a, b) => a.r - b.r);
}

/**
 * The angular span, in degrees, of the drawn iron sitting ON the seat bore at one main:
 * every angle is folded into the lower half, where a main seat can stand.
 */
export function seatArcDeg(iron, c, boreR) {
  const on = [];
  for (const e of seatIron(iron, c)) {
    const solid = iron.find((x) => x.part === e.part);
    for (const t of solid.tris) {
      if (t.x1 < c - SHELL_HALF || t.x0 > c + SHELL_HALF) continue;
      if (Math.abs(t.r - boreR) > IRON_EPS) continue;
      let a = t.ang;
      if (a > 0) a -= 2 * Math.PI;
      on.push(a);
    }
  }
  if (!on.length) return { deg: 0, faces: 0 };
  return { deg: (Math.max(...on) - Math.min(...on)) * 180 / Math.PI, faces: on.length };
}

/**
 * The air between one drawn cast-iron solid and one swung crank outline (an annulus of
 * radius `reach` about the crank axis, over the x band [b0, b1]). The axial term and the
 * radial term are each the solid's own minimum, so where they fall on different points of
 * one triangle the number is SMALLER than the true gap: a lower bound, which can fail
 * honestly and can never pass falsely. Infinity only for a solid with no triangles at all.
 */
export function swingAir(solid, reach, b0, b1) {
  let air = Infinity, who = null;
  for (const t of solid.tris) {
    // Iron standing outside the band still has a real distance to the swept annulus, and
    // that axial gap is where this casting is tightest: the OHV main cap lugs stand 0.3000
    // cm from the crank pin's swept band without ever entering it.
    const dx = Math.max(b0 - t.x1, t.x0 - b1, 0);
    const v = Math.hypot(dx, Math.max(0, t.r - reach));
    if (v < air) { air = v; who = t; }
  }
  return { air, who };
}
