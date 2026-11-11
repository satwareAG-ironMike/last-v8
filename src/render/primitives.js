// Procedural geometry helpers. Everything in this project is built from these
// primitives plus THREE parametric shapes - no imported models.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const UP = new THREE.Vector3(0, 1, 0);

/** Rounded rectangle Shape centred on the local origin. */
export function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  const rr = Math.min(r, Math.min(w, h) / 2);
  s.moveTo(x + rr, y);
  s.lineTo(x + w - rr, y);
  s.absarc(x + w - rr, y + rr, rr, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - rr);
  s.absarc(x + w - rr, y + h - rr, rr, 0, Math.PI / 2, false);
  s.lineTo(x + rr, y + h);
  s.absarc(x + rr, y + h - rr, rr, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + rr);
  s.absarc(x + rr, y + rr, rr, Math.PI, Math.PI * 1.5, false);
  return s;
}

/** Rounded slot (stadium) of width w along local Y and overall length len along local X. */
export function stadiumShape(w, len, holes = []) {
  const s = new THREE.Shape();
  const r = w / 2;
  const half = Math.max(len / 2 - r, 0);
  s.moveTo(-half, -r);
  s.lineTo(half, -r);
  s.absarc(half, 0, r, -Math.PI / 2, Math.PI / 2, false);
  s.lineTo(-half, r);
  s.absarc(-half, 0, r, Math.PI / 2, Math.PI * 1.5, false);
  for (const h of holes) s.holes.push(h);
  return s;
}

export function circleHole(x, y, r, ccw = true) {
  const p = new THREE.Path();
  p.absarc(x, y, r, 0, Math.PI * 2, !ccw);
  return p;
}

/**
 * Extrude a shape along local +Z, centred on the origin.
 * opts: { bevel, bevelSize, steps, curveSegments }
 */
export function extrude(shape, depth, opts = {}) {
  const bevel = opts.bevel ?? 0.18;
  const g = new THREE.ExtrudeGeometry(shape, {
    curveSegments: opts.curveSegments ?? 14,
    steps: opts.steps ?? 1,
    depth: depth - 2 * bevel,
    bevelEnabled: bevel > 0.001,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: opts.bevelSegments ?? 3,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Rotate an extruded profile so its extrusion direction becomes world +X. */
export function alignX(geometry) {
  geometry.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI / 2));
  return geometry;
}

/** Profile plane helper: profile (u,v) maps to world (y,z) with v pointing up. */
export function profileToYZ(u, v) {
  return { x: 0, y: u, z: v };
}

export function pipe(points, radius, tubular = 48, radial = 18, closed = false) {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(p.x ?? p[0], p.y ?? p[1], p.z ?? p[2])),
    closed,
    'catmullrom',
    0.35
  );
  return new THREE.TubeGeometry(curve, tubular, radius, radial, closed);
}

export function pipeCurve(points, closed = false, tension = 0.35) {
  return new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(p.x ?? p[0], p.y ?? p[1], p.z ?? p[2])),
    closed,
    'catmullrom',
    tension
  );
}

export function lathe(pts, segments = 40, phiLength = Math.PI * 2) {
  return new THREE.LatheGeometry(
    pts.map((p) => new THREE.Vector2(p[0] ?? p.x, p[1] ?? p.y)),
    segments,
    0,
    phiLength
  );
}

/** Quaternion turning local +Y onto `dir`. */
export function alignYTo(dir) {
  const d = new THREE.Vector3(dir.x ?? dir[0], dir.y ?? dir[1], dir.z ?? dir[2]).normalize();
  return new THREE.Quaternion().setFromUnitVectors(UP, d);
}

export function cylinderBetween(a, b, r, radial = 20, open = false) {
  const va = new THREE.Vector3(a.x ?? a[0], a.y ?? a[1], a.z ?? a[2]);
  const vb = new THREE.Vector3(b.x ?? b[0], b.y ?? b[1], b.z ?? b[2]);
  const mid = va.clone().add(vb).multiplyScalar(0.5);
  const len = va.distanceTo(vb);
  const g = new THREE.CylinderGeometry(r, r, len, radial, 1, open);
  g.applyQuaternion(alignYTo(vb.clone().sub(va)));
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

/** Square tubing between two points, `w` x `h` cross section. */
export function rectTube(a, b, w, h, twist = 0) {
  const shape = roundedRectShape(w, h, Math.min(w, h) * 0.18);
  const g = extrude(shape, a.distanceTo(b), { bevel: 0.12 });
  // extrusion is along local Z after alignX -> orient it on a->b
  const va = new THREE.Vector3(a.x ?? a[0], a.y ?? a[1], a.z ?? a[2]);
  const vb = new THREE.Vector3(b.x ?? b[0], b.y ?? b[1], b.z ?? b[2]);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), vb.clone().sub(va).normalize());
  if (twist) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), twist));
  g.applyQuaternion(q);
  g.translate((va.x + vb.x) / 2, (va.y + vb.y) / 2, (va.z + vb.z) / 2);
  return g;
}

export function boltGeometry(across = 1.4, headH = 0.9, shaftR = 0.5, shaftL = 2.4, socket = true) {
  const hr = across / 2 / Math.cos(Math.PI / 6);
  const parts = [new THREE.CylinderGeometry(hr, hr * 0.98, headH, 6, 1).translate(0, headH / 2, 0)];
  parts.push(new THREE.CylinderGeometry(shaftR, shaftR, shaftL, 14, 1).translate(0, -shaftL / 2, 0));
  if (socket) {
    // hex socket recess in the head
    const sr = hr * 0.55;
    const rec = new THREE.CylinderGeometry(sr, sr, headH * 0.75, 6, 1).translate(0, headH * 0.62, 0);
    parts.push(rec);
  }
  return mergeGeometries(parts, false);
}

export function nutGeometry(across = 1.4, h = 0.8, holeR = 0.5) {
  const hr = across / 2 / Math.cos(Math.PI / 6);
  const g = new THREE.CylinderGeometry(hr, hr * 0.97, h, 6, 1);
  void holeR;
  return g;
}

export function washerGeometry(rIn = 0.6, rOut = 1.0, t = 0.18) {
  return new THREE.CylinderGeometry(rOut, rOut, t, 24, 1);
}

/**
 * Instanced bolts. specs: [{ p:[x,y,z], dir:[dx,dy,dz], s:scale, headOut:boolean }]
 * dir is the direction the shaft points; the head sits opposite dir.
 */
export function instancedBolts(specs, geo, material, group = null) {
  const mesh = new THREE.InstancedMesh(geo, material, specs.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  specs.forEach((b, i) => {
    const d = new THREE.Vector3(b.dir[0], b.dir[1], b.dir[2]).normalize();
    q.copy(alignYTo(d));
    pos.set(b.p[0], b.p[1], b.p[2]);
    one.setScalar(b.s ?? 1);
    m.compose(pos, q, one);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (group) group.add(mesh);
  return mesh;
}

/** Sprocket / gear with simplified involute teeth, axis along local Y before rotation. */
export function sprocketGeometry(teeth, pitchR, toothH, thickness, boreR, widthFactor = 0.55) {
  const s = new THREE.Shape();
  const n = Math.max(6, teeth);
  const step = (Math.PI * 2) / n;
  const rootR = pitchR - toothH * 0.55;
  const tipR = pitchR + toothH * 0.45;
  for (let i = 0; i < n; i++) {
    const a0 = i * step;
    const aTipHalf = step * (0.5 - widthFactor * 0.5);
    const aRootHalf = step * 0.5;
    const p1 = [Math.cos(a0 - aRootHalf) * rootR, Math.sin(a0 - aRootHalf) * rootR];
    const p2 = [Math.cos(a0 - aTipHalf) * tipR, Math.sin(a0 - aTipHalf) * tipR];
    const p3 = [Math.cos(a0 + aTipHalf) * tipR, Math.sin(a0 + aTipHalf) * tipR];
    const p4 = [Math.cos(a0 + aRootHalf) * rootR, Math.sin(a0 + aRootHalf) * rootR];
    if (i === 0) s.moveTo(p1[0], p1[1]);
    else s.lineTo(p1[0], p1[1]);
    s.lineTo(p2[0], p2[1]);
    s.lineTo(p3[0], p3[1]);
    s.lineTo(p4[0], p4[1]);
  }
  s.closePath();
  if (boreR > 0) s.holes.push(circleHole(0, 0, boreR));
  const g = extrude(s, thickness, { bevel: 0.05, bevelSegments: 2, curveSegments: 6 });
  return alignX(g); // axis becomes world X
}

/** Helical compression spring, axis along local +Y, centred on the origin. */
export function springGeometry(radius, length, coils, wireR, samplesPerCoil = 22) {
  const pts = [];
  const total = coils * samplesPerCoil;
  for (let i = 0; i <= total; i++) {
    const t = i / total;
    const a = t * coils * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, (t - 0.5) * length, Math.sin(a) * radius));
  }
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
  return new THREE.TubeGeometry(curve, Math.max(96, total * 2), wireR, 9, false);
}

/** Torus weld bead sitting on a pipe curve at parameter t. */
export function weldBead(curve, t, r, tube = 0.22) {
  const p = curve.getPointAt(t);
  const tan = curve.getTangentAt(t);
  const g = new THREE.TorusGeometry(r, tube, 8, 26);
  g.applyQuaternion(alignYTo(tan));
  g.translate(p.x, p.y, p.z);
  return g;
}

export function ringOfPoints(count, radius, startAngle = 0) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = startAngle + (i / count) * Math.PI * 2;
    out.push([Math.cos(a) * radius, Math.sin(a) * radius]);
  }
  return out;
}

export { mergeGeometries, THREE };
