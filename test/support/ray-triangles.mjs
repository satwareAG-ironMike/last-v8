// Ray/triangle probing for the machined-void laws (test/heads.test.mjs A1-G7).
// This repo has no CSG: every void is a THREE.Shape hole or an outline notch, so
// a law that claims "this part is drilled through" has to prove the ray actually
// crosses the void. Möller-Trumbore on the real baked world triangles is the
// measurement; a vertex or angle scan alone would pass a solid wall.
//
// The triangles are collected here from the meshes a law names, in the same
// baked world space test/heads.test.mjs already measures vertices in
// (updateWorldMatrix then applyMatrix4), so a ray and a vertex list agree.
import * as THREE from 'three';

const HIT_EPS = 1e-9;

/** Baked world triangles of a mesh, a group or a list of them. */
export function trisOf(roots) {
  const list = Array.isArray(roots) ? roots : [roots];
  const tris = [];
  const walk = (o) => {
    if (o.isMesh) {
      o.updateWorldMatrix(true, false);
      const geo = o.geometry;
      const pos = geo.attributes.position;
      const idx = geo.index;
      const n = idx ? idx.count : pos.count;
      const at = (k, m) => new THREE.Vector3().fromBufferAttribute(pos, k).applyMatrix4(m);
      const push = (a, b, c) => {
        const ab = b.clone().sub(a);
        const ac = c.clone().sub(a);
        const nrm = ab.cross(ac);
        if (nrm.lengthSq() < 1e-12) return; // degenerate: nothing to cross
        tris.push({ a, b, c, label: o.name || o.userData.kind || 'part', nrm });
      };
      if (o.isInstancedMesh) {
        const im = new THREE.Matrix4();
        for (let t = 0; t < o.count; t++) {
          im.identity();
          o.getMatrixAt(t, im);
          im.premultiply(o.matrixWorld);
          for (let j = 0; j < n; j += 3) push(at(idx ? idx.getX(j) : j, im), at(idx ? idx.getX(j + 1) : j + 1, im), at(idx ? idx.getX(j + 2) : j + 2, im));
        }
      } else {
        for (let j = 0; j < n; j += 3) push(at(idx ? idx.getX(j) : j, o.matrixWorld), at(idx ? idx.getX(j + 1) : j + 1, o.matrixWorld), at(idx ? idx.getX(j + 2) : j + 2, o.matrixWorld));
      }
    }
    for (const kid of o.children) walk(kid);
  };
  for (const r of list) walk(r);
  return tris;
}

const bbOf = (t) => t.bb || (t.bb = [
  Math.min(t.a.x, t.b.x, t.c.x), Math.max(t.a.x, t.b.x, t.c.x),
  Math.min(t.a.y, t.b.y, t.c.y), Math.max(t.a.y, t.b.y, t.c.y),
  Math.min(t.a.z, t.b.z, t.c.z), Math.max(t.a.z, t.b.z, t.c.z),
]);

/**
 * Triangles whose AABB reaches the world box. One axis per pair of comparisons:
 * x is q[0]/q[1], y is q[2]/q[3], z is q[4]/q[5]. Mixing the pairs on purpose
 * here made every column whose triangles sat above the box in y read as empty,
 * which is what made the first A1-G7 sweep print `0 of 360 deg closed` for the
 * middle bearings while the fore ones printed 358.
 */
export function regionTris(tris, lo, hi) {
  const out = [];
  for (const t of tris) {
    const q = bbOf(t);
    if (q[1] < lo[0] || q[0] > hi[0]) continue;
    if (q[3] < lo[1] || q[2] > hi[1]) continue;
    if (q[5] < lo[2] || q[4] > hi[2]) continue;
    out.push(t);
  }
  return out;
}

/**
 * Every crossing of the segment origin + t*dir, t in [tMin, tMax], sorted by t.
 * dir must be normalised. Each hit carries the distance t, the owner's name and
 * the crossing point, so a law can report which part blocks the way and where.
 *
 * Plane first, then the inside test: a triangle is crossed where the ray meets
 * its plane and the crossing point lands on the same side of all three edges as
 * the face normal - which is the same condition engine-triangles.mjs uses for its
 * exact distance measure, so the two probes agree about what a face is.
 */
export function raycast(tris, origin, dir, tMin, tMax) {
  const hits = [];
  const lo = Math.min(tMin, tMax), hi = Math.max(tMin, tMax);
  const o = [origin.x, origin.y, origin.z], d = [dir.x, dir.y, dir.z];
  const segLo = [0, 0, 0], segHi = [0, 0, 0];
  for (let ax = 0; ax < 3; ax++) {
    const a = o[ax] + d[ax] * lo, b = o[ax] + d[ax] * hi;
    segLo[ax] = Math.min(a, b);
    segHi[ax] = Math.max(a, b);
  }
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const c1 = new THREE.Vector3();
  const c2 = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (const tri of tris) {
    const q = bbOf(tri);
    // reject on the triangle's own AABB before any arithmetic
    if (segHi[0] < q[0] - HIT_EPS || segLo[0] > q[1] + HIT_EPS) continue;
    if (segHi[1] < q[2] - HIT_EPS || segLo[1] > q[3] + HIT_EPS) continue;
    if (segHi[2] < q[4] - HIT_EPS || segLo[2] > q[5] + HIT_EPS) continue;
    const den = tri.nrm.dot(dir);
    if (Math.abs(den) < 1e-12) continue; // ray parallel to the face
    const tt = tri.nrm.dot(tri.a) - tri.nrm.dot(origin);
    const s = tt / den;
    if (s < lo - HIT_EPS || s > hi + HIT_EPS) continue;
    p.copy(origin).addScaledVector(dir, s);
    e1.subVectors(tri.b, tri.a).cross(c1.subVectors(p, tri.a));
    if (e1.dot(tri.nrm) < -HIT_EPS) continue;
    e2.subVectors(tri.c, tri.b).cross(c2.subVectors(p, tri.b));
    if (e2.dot(tri.nrm) < -HIT_EPS) continue;
    e1.subVectors(tri.a, tri.c).cross(c1.subVectors(p, tri.c));
    if (e1.dot(tri.nrm) < -HIT_EPS) continue;
    hits.push({ t: s, label: tri.label, p: p.clone() });
  }
  hits.sort((x, y) => x.t - y.t);
  return hits;
}

/**
 * Azimuth coverage of a set of directions, in 1-degree bins over 0..360.
 * Returns { bins, arc } where arc = 360 - widest empty gap: a part whose
 * material closes the ring reads 360, a half shell reads its own span.
 */
export function coverage(bins) {
  const seen = new Uint8Array(360);
  for (const b of bins) seen[((Math.round(b) % 360) + 360) % 360] = 1;
  let count = 0;
  for (const s of seen) count += s;
  let widest = 0, at = null;
  for (let start = 0; start < 360; start++) {
    if (seen[start]) continue;
    let run = 0;
    while (run < 360 && !seen[(start + run) % 360]) run++;
    if (run > widest) { widest = run; at = [start, (start + run) % 360]; }
    if (run >= 360) break;
  }
  return { bins: seen, count, arc: count ? 360 - widest : 0, gap: widest, gapAt: at };
}
