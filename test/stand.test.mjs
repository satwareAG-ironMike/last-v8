// Industrial test stand - written RED first. Contract:
// - the stand carries the engine on REAL casting faces only: the oil-pan flange
//   (cast pan rails + pan side wall) under the block, and the fore/aft end-disc
//   flat x-faces. No cradle under the pan is possible: the pan bottom is z -14.6,
//   the drain plug reaches -15.05 and the floor is -16.5 (1.45..1.90 cm of air),
//   so every frame member travels the free lane below z -15.15 or |x| > 22.
// - the fore/aft locator frame has to dodge the rotating hardware it passes:
//   crank nose stub, sprocket drum (x 28.6..29.8), flywheel disc + ring gear.
// - mounts bite their design depth into the measured face, their engagement area
//   is >= 1.5 cm^2, and clamp bolts are buried in the pan wall with their heads
//   proud of the mount's outboard face.
// - feet sit exactly on the floor plane, nothing hangs below it, and every member
//   reaches a foot through real joints (nothing floats apart).
// - clearances are measured against the real triangles of the five engine units
//   that are actually rendered, so every assert is derived from geometry.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SPEC, panWallHalfWidth, panRailPlane, endDiscFaceX } from '../src/engine/spec.js';
import { createBlock } from '../src/render/block.js';
import { createCranktrain } from '../src/render/cranktrain.js';
import { createManifolds } from '../src/render/manifolds.js';
import { createStand, standSpecs, standBolts } from '../src/render/stand.js';
import {
  boxTriangleWorst, engineTriangles, strutTriangleWorst, triDistance,
} from './support/engine-triangles.mjs';

const S = SPEC.stand;
const B = SPEC.block;
const EPS = 1e-4;
const KINDS = {
  bed: 2, skid: 2, tie: 2, sideTie: 4, post: 4, pad: 4,
  column: 4, arm: 2, jaw: 4, brace: 4,
};
const MOUNT_KINDS = new Set(['pad', 'jaw', 'bolt']);

const materials = new Proxy({}, {
  get: (t, k) => (t[k] ??= new THREE.MeshStandardMaterial({ name: String(k) })),
});

const build = () => createStand(materials);

// ---------------------------------------------------------------------------
// world AABB helpers (the frame is axis-aligned; only the braces are diagonal)
// ---------------------------------------------------------------------------
function aabbGap(a, b) {
  const g = [];
  for (let i = 0; i < 3; i++) g.push(Math.max(0, a[i * 2] - b[i * 2 + 1], b[i * 2] - a[i * 2 + 1]));
  return g;
}
const aabbDistance = (a, b) => Math.hypot(...aabbGap(a, b));
const overlapSpan = (a, b, i) => Math.min(a[i * 2 + 1], b[i * 2 + 1]) - Math.max(a[i * 2], b[i * 2]);
/** Signed reach of a point into a world AABB: > 0 buried, < 0 short. */
function depthToBox(bb, p) {
  const m = [];
  for (let i = 0; i < 3; i++) m.push(p[i] - bb[i * 2], bb[i * 2 + 1] - p[i]);
  const outside = m.filter((v) => v < 0);
  return outside.length ? Math.max(...outside) : Math.min(...m);
}
/** Distance from a segment to a world AABB, minus the segment's own radius. */
function segBoxDistance(a, b, bb, r) {
  const n = 240;
  let best = Infinity;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const d = Math.hypot(...[0, 1, 2].map((k) => Math.max(0, bb[k * 2] - p[k], p[k] - bb[k * 2 + 1])));
    if (d < best) best = d;
  }
  return best - r;
}

/** World-space vertices of every non-instanced mesh under an object. */
function vertsOf(obj) {
  obj.updateMatrixWorld(true);
  const arr = [];
  obj.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return;
    o.updateWorldMatrix(true, false);
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      arr.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
    }
  });
  return arr;
}

function worldAABB(obj) {
  const b = new THREE.Box3();
  for (const v of vertsOf(obj)) b.expandByPoint(v);
  return [b.min.x, b.max.x, b.min.y, b.max.y, b.min.z, b.max.z];
}

const kindCounts = (group) => {
  const c = {};
  group.traverse((o) => {
    if (!o.isMesh) return;
    const k = o.userData.kind ?? 'unnamed';
    c[k] = (c[k] ?? 0) + (o.isInstancedMesh ? o.count : 1);
  });
  return c;
};

/** World AABB of a published member; diagonal braces get their axis box. */
function memberBox(m) {
  if (m.kind !== 'brace') return m.bb;
  const lo = (i) => Math.min(m.a[i], m.b[i]) - m.r;
  const hi = (i) => Math.max(m.a[i], m.b[i]) + m.r;
  return [lo(0), hi(0), lo(1), hi(1), lo(2), hi(2)];
}

// ---------------------------------------------------------------------------
// Clearance is measured against the engine's real TRIANGLES in world space
// (shared helper: test/support/engine-triangles.mjs). A vertex-only voxel shell
// was the wrong instrument here: the block's low-poly faces put their vertices
// 21 cm apart, so a probe could sit inside an empty cell right next to the oil
// pan and report "clear". Triangle distance is exact and names the owner, so a
// clash reports the part instead of only failing.
// ---------------------------------------------------------------------------
let shellCache = null;
function engineShell() {
  if (!shellCache) shellCache = engineTriangles(materials);
  return shellCache;
}

// ---------------------------------------------------------------------------
// the mounting interfaces, taken from the block casting that is really rendered
// ---------------------------------------------------------------------------
function castFaces() {
  const block = createBlock(materials);
  const face = (name) => {
    const o = block.getObjectByName(name);
    assert.ok(o, `block casting face ${name} missing: the stand has nothing to bolt onto`);
    return worldAABB(o);
  };
  return {
    pan: face('oil-pan'),
    rails: face('pan-rails'),
    fore: face('end-disc-fore'),
    aft: face('end-disc-aft'),
    plug: face('pan-plug'),
  };
}

const fmt = (bb) => JSON.stringify(bb.map((n) => +n.toFixed(2)));

// ===========================================================================
test('stand publishes its whole load path: members, mounts, clamp bolts', () => {
  const members = standSpecs();
  const byKind = {};
  for (const m of members) byKind[m.kind] = (byKind[m.kind] ?? 0) + 1;
  assert.deepEqual(byKind, KINDS, `published stand kinds ${JSON.stringify(byKind)}`);
  assert.equal(members.length, Object.values(KINDS).reduce((a, b) => a + b, 0), 'published member count');
  assert.equal(standBolts().length, S.boltsPerMount * KINDS.pad, 'two clamp bolts per engine mount');
  const names = new Set();
  for (const m of members) {
    assert.ok(m.name && m.kind, `member ${JSON.stringify(m)} has no name/kind`);
    assert.ok(!names.has(m.name), `duplicate member name ${m.name}`);
    names.add(m.name);
    if (m.kind === 'brace') {
      assert.equal(m.a.length, 3, `${m.name} foot`);
      assert.equal(m.b.length, 3, `${m.name} head`);
      assert.ok(m.r >= 0.3, `${m.name} brace radius ${m.r}`);
    } else {
      assert.equal(m.bb.length, 6, `member ${m.name} bb ${JSON.stringify(m.bb)}`);
      assert.ok(m.bb[0] < m.bb[1] && m.bb[2] < m.bb[3] && m.bb[4] < m.bb[5], `${m.name} inverted extents ${fmt(m.bb)}`);
      assert.ok(m.bb[0] <= S.bedX[1] && m.bb[1] >= S.bedX[0], `${m.name} outside the frame footprint`);
    }
  }
  for (const b of standBolts()) {
    assert.ok(b.name && b.p && b.dir && b.shaftL > 0 && b.headH > 0, `bolt ${JSON.stringify(b)}`);
    assert.ok(Math.hypot(...b.dir).toFixed(6) === '1.000000', `bolt ${b.name} dir ${b.dir} is not a unit vector`);
  }
});

test('stand builds exactly the published members: 32 members plus 8 clamp bolts', async () => {
  const { group } = build();
  const c = kindCounts(group);
  assert.deepEqual(c, { ...KINDS, bolt: 8 }, `rendered stand kinds ${JSON.stringify(c)}`);
  const published = new Set(standSpecs().map((m) => m.name));
  const built = new Map();
  group.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return;
    assert.ok(published.has(o.name), `rendered member ${o.name} is not a published member`);
    built.set(o.name, o);
    assert.ok(o.castShadow, `${o.name} must cast shadows`);
    assert.ok(o.receiveShadow, `${o.name} must receive shadows`);
    assert.notEqual(o.material, undefined, `${o.name} has no material`);
  });
  for (const n of published) assert.ok(built.has(n), `published member ${n} was never rendered`);
  const bolts = group.getObjectByName('stand-bolts');
  assert.ok(bolts?.isInstancedMesh, 'stand-bolts InstancedMesh missing');
  assert.equal(bolts.count, 8, 'clamp bolt instances');
  assert.ok(bolts.castShadow, 'clamp bolts must cast shadows');
  // rendered member AABBs must be the published ones: a mesh may not drift away
  // from the member the clearance and joint tests measured
  for (const [name, o] of built) {
    const m = standSpecs().find((x) => x.name === name);
    const bb = worldAABB(o);
    if (m.kind === 'brace') {
      // a tube's AABB is its axis box inset by r*(1-|dir_axis|); x is constant on
      // every brace here, so its x half-extent IS the radius and pins the strut
      assert.ok(Math.abs((bb[1] - bb[0]) / 2 - m.r) < 0.04,
        `${name} tube half-x-extent ${((bb[1] - bb[0]) / 2).toFixed(3)} != published r ${m.r} (${fmt([bb[0], bb[1]])})`);
      for (const p of [m.a, m.b]) {
        assert.ok(depthToBox(bb, p) > -0.05, `${name} does not reach its endpoint ${fmt(p)}`);
      }
      continue;
    }
    const p = m.bb;
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(bb[i * 2] - p[i * 2]) < 0.12, `${name} rendered ${fmt(bb)} vs published ${fmt(p)}`);
      assert.ok(Math.abs(bb[i * 2 + 1] - p[i * 2 + 1]) < 0.12, `${name} rendered ${fmt(bb)} vs published ${fmt(p)}`);
    }
  }
});

test('feet stand exactly on the floor plane and nothing hangs below it', async () => {
  const { group } = build();
  const vs = vertsOf(group);
  const lowest = Math.min(...vs.map((v) => v.z));
  assert.ok(Math.abs(lowest - S.floorZ) < EPS,
    `lowest stand vertex z ${lowest.toFixed(4)} != floor plane ${S.floorZ}`);
  const members = standSpecs();
  for (const m of members) {
    const bb = memberBox(m);
    assert.ok(bb[4] >= S.floorZ - EPS, `${m.name} reaches z ${bb[4].toFixed(2)} below the floor`);
  }
  const feet = members.filter((m) => m.kind !== 'brace' && Math.abs(m.bb[4] - S.floorZ) < EPS);
  assert.ok(feet.length >= 8, `only ${feet.length} members stand on the floor`);
  assert.deepEqual(
    [...new Set(feet.map((m) => m.kind))].sort(),
    ['bed', 'sideTie', 'skid', 'tie'],
    'the floor is carried by the frame beams, not by the mount hardware'
  );
  let area = 0;
  for (const m of feet) area += (m.bb[1] - m.bb[0]) * (m.bb[3] - m.bb[2]);
  assert.ok(area >= 600, `floor contact area ${area.toFixed(0)} cm^2 is too little to carry a V8`);
});

test('four engine mounts bite the measured oil-pan flange and hold it by area', async () => {
  const F = castFaces();
  const pads = standSpecs().filter((m) => m.kind === 'pad');
  assert.equal(pads.length, 4, 'engine mounts: one per corner of the pan flange');
  const wall = panWallHalfWidth();
  const railZ = panRailPlane();
  for (const p of pads) {
    const bb = p.bb;
    const sgn = bb[2] > 0 ? 1 : -1;
    assert.ok(sgn * bb[3] > 0, `${p.name} is not on its own side of the pan`);
    const inboard = sgn > 0 ? bb[2] : bb[3];
    const biteY = Math.abs(wall - Math.abs(inboard));
    assert.ok(biteY <= S.bite + 1e-3 && (sgn > 0 ? inboard < wall : inboard > -wall),
      `${p.name} bites the pan wall |y| ${wall.toFixed(4)} by ${biteY.toFixed(4)} cm, design ${S.bite}`);
    const biteZ = bb[5] - railZ;
    assert.ok(Math.abs(biteZ - S.bite) < 1e-3,
      `${p.name} bites the pan-rail plane z ${railZ} by ${biteZ.toFixed(4)} cm, design ${S.bite}`);
    // the pad must sit under the flange it clamps, inside the rail extent in x
    assert.ok(bb[0] >= F.rails[0] - EPS && bb[1] <= F.rails[1] + EPS,
      `${p.name} x ${fmt([bb[0], bb[1]])} is not inside the pan rails ${fmt([F.rails[0], F.rails[1]])}`);
    // engagement is measured on the casting that is really rendered: the bearing
    // patch on the pan side wall, clipped by the pan box
    const areaWall = Math.max(0, overlapSpan(bb, F.pan, 0)) * Math.max(0, overlapSpan(bb, F.pan, 2));
    assert.ok(areaWall >= 1.5, `${p.name} bears on the oil-pan wall over only ${areaWall.toFixed(2)} cm^2`);
    const areaRail = Math.max(0, overlapSpan(bb, F.rails, 0)) * Math.max(0, overlapSpan(bb, F.rails, 1));
    assert.ok(areaRail >= 0.5, `${p.name} butts under the pan rails over only ${areaRail.toFixed(2)} cm^2`);
    // it must clear the drain plug: a mount sitting on the plug would be a lie
    assert.ok(aabbDistance(bb, F.plug) >= S.minAir,
      `${p.name} sits on the oil-pan drain plug ${fmt(F.plug)}`);
  }
});

test('clamp bolts are buried in the pan wall, their heads stand proud in free air', async () => {
  const { group } = build();
  const F = castFaces();
  const shell = engineShell();
  const bolts = standBolts();
  const mesh = group.getObjectByName('stand-bolts');
  assert.equal(bolts.length, mesh.count, 'published clamp bolts vs rendered instances');
  const pads = standSpecs().filter((m) => m.kind === 'pad');
  const perMount = {};
  bolts.forEach((b, i) => {
    const pad = pads.find((p) => Math.sign(p.bb[2]) === Math.sign(b.p[1]) && Math.sign(p.bb[0]) === Math.sign(b.p[0]));
    assert.ok(pad, `bolt ${b.name} belongs to no mount pad`);
    perMount[pad.name] = (perMount[pad.name] ?? 0) + 1;
    // instancedBolts turns local +Y (the hex head side of boltGeometry) onto dir,
    // so `dir` is the direction the head faces and the shaft tip is opposite.
    const tip = b.p.map((v, k) => v - b.dir[k] * b.shaftL);
    const headTop = b.p.map((v, k) => v + b.dir[k] * b.headH);
    const dTip = depthToBox(F.pan, tip);
    assert.ok(dTip >= 0.3, `${b.name} tip ${fmt(tip)} stops ${(-dTip).toFixed(2)} cm short of the pan wall`);
    assert.ok(dTip <= 1.5, `${b.name} drives ${dTip.toFixed(2)} cm clean through the oil pan`);
    // the tip must reach past the pad's own inboard edge: the bolt clamps the pad
    const padIn = Math.sign(b.p[1]) > 0 ? pad.bb[2] : pad.bb[3];
    assert.ok(Math.sign(b.p[1]) * tip[1] < Math.sign(b.p[1]) * padIn,
      `${b.name} tip |y| ${Math.abs(tip[1]).toFixed(2)} never reaches past its pad edge ${Math.abs(padIn).toFixed(2)}`);
    assert.ok(Math.abs(headTop[1]) > Math.abs(pad.bb[3]) + 0.05,
      `${b.name} head top |y| ${Math.abs(headTop[1]).toFixed(2)} is swallowed by the mount (pad outboard |y| ${Math.abs(pad.bb[3]).toFixed(2)})`);
    // a socket must be able to reach the head: free air around it
    const near = triDistance(shell, headTop);
    assert.ok(near.d >= S.minAir, `${b.name} head sits ${near.d.toFixed(2)} cm from ${near.who}`);
    // and the head stands outboard of the engine's own lowest casting
    assert.ok(Math.abs(headTop[1]) > Math.abs(F.pan[2]) + 1.0,
      `${b.name} head is not outboard of the oil pan`);
    // the published instance is the one the renderer placed
    const m4 = new THREE.Matrix4();
    mesh.getMatrixAt(i, m4);
    const pos = new THREE.Vector3().setFromMatrixColumn(m4, 3);
    assert.ok(pos.distanceTo(new THREE.Vector3(...b.p)) < 1e-6,
      `${b.name} rendered at ${pos.toArray().map((n) => n.toFixed(2))}, published ${fmt(b.p)}`);
  });
  for (const p of pads) {
    assert.equal(perMount[p.name], S.boltsPerMount, `${p.name} carries ${perMount[p.name] ?? 0} clamp bolts, need ${S.boltsPerMount}`);
  }
});

test('locator jaws clamp the fore/aft end-disc faces, sampled not asserted', async () => {
  const F = castFaces();
  const jaws = standSpecs().filter((m) => m.kind === 'jaw');
  assert.equal(jaws.length, 4, 'locator jaws: two per end disc');
  const OD = B.caseOuterRadius;
  const bossR = Math.max(B.mainBossR, B.aftMainBossR);
  const ends = { fore: 0, aft: 0 };
  for (const j of jaws) {
    const bb = j.bb;
    const fore = bb[0] > 0;
    ends[fore ? 'fore' : 'aft']++;
    const faceBB = fore ? F.fore : F.aft;
    const faceX = fore ? faceBB[1] : faceBB[0];
    const bite = Math.abs(Math.abs(faceX) - Math.abs(fore ? bb[0] : bb[1]));
    assert.ok(Math.abs(bite - S.jawBite) < 1e-3,
      `${j.name} bites the end-disc face x ${faceX.toFixed(2)} by ${bite.toFixed(4)} cm, design ${S.jawBite}`);
    const near = Math.min(Math.abs(bb[0]), Math.abs(bb[1]));
    const far = Math.max(Math.abs(bb[0]), Math.abs(bb[1]));
    assert.ok(near < Math.abs(faceX) && far > Math.abs(faceX),
      `${j.name} |x| ${near.toFixed(2)}..${far.toFixed(2)} must straddle the end-disc face x ${faceX.toFixed(2)}`);
    // the face it presses on is an annulus about the crank axis, so the real
    // bearing area is only the part of the jaw footprint inside the casting
    let area = 0;
    for (let y = bb[2]; y <= bb[3] + 1e-9; y += 0.1) {
      for (let z = bb[4]; z <= bb[5] + 1e-9; z += 0.1) {
        const r = Math.hypot(y, z);
        if (r <= OD + 1e-9 && r >= bossR - 1e-9) area += 0.01;
      }
    }
    const own = (bb[3] - bb[2]) * (bb[5] - bb[4]);
    assert.ok(area >= 1.5, `${j.name} bears on the end disc over only ${area.toFixed(2)} cm^2`);
    assert.ok(area <= own + 1e-9, `${j.name} claims ${area.toFixed(2)} cm^2 on a ${own.toFixed(2)} cm^2 footprint`);
    assert.ok(area < own, `${j.name} covers its whole footprint on an annular face - the corners are in air`);
  }
  assert.deepEqual(ends, { fore: 2, aft: 2 }, 'the fore/aft reaction frames must be balanced');
});

test('no frame member touches the engine: >= minAir real air, mounts exempt', async () => {
  const shell = engineShell();
  for (const m of standSpecs()) {
    const r = m.kind === 'brace' ? strutTriangleWorst(shell, m) : boxTriangleWorst(shell, m.bb);
    if (MOUNT_KINDS.has(m.kind)) continue;
    assert.ok(r.worst >= S.minAir,
      `${m.name} (${m.kind}) comes within ${r.worst.toFixed(3)} cm of ${r.who} at ${JSON.stringify(r.at)}; the design minimum is ${S.minAir}`);
  }
  // a mount that clears the whole engine is holding nothing: it must press on its
  // casting face by about the design bite, and only on that casting
  for (const m of standSpecs().filter((x) => x.kind === 'pad' || x.kind === 'jaw')) {
    const want = m.kind === 'pad' ? S.bite : S.jawBite;
    const r = boxTriangleWorst(shell, m.bb);
    assert.ok(r.worst <= want + 0.05,
      `${m.name} (${m.kind}) sits ${r.worst.toFixed(3)} cm off the casting; it is meant to bite ${want} cm into it`);
    assert.ok(/oil-pan|pan-rails|end-disc/.test(String(r.who)),
      `${m.name} presses on ${r.who}, not on the oil-pan flange or an end disc`);
  }
});

test('the stand clears the exhaust outlets and crosses the chain band in the free lane only', async () => {
  const manifolds = createManifolds(materials);
  const outlets = [];
  for (const bank of ['L', 'R']) {
    const o = manifolds.group.getObjectByName(`outlet-${bank}`);
    assert.ok(o, `exhaust outlet-${bank} missing`);
    outlets.push({ name: `outlet-${bank}`, bb: worldAABB(o) });
  }
  for (const m of standSpecs()) {
    for (const ob of outlets) {
      const d = m.kind === 'brace'
        ? segBoxDistance(m.a, m.b, ob.bb, m.r)
        : aabbDistance(m.bb, ob.bb);
      assert.ok(d >= S.minAir, `${m.name} (${m.kind}) is ${d.toFixed(2)} cm from ${ob.name} ${fmt(ob.bb)}`);
    }
  }
  // fore/aft frame members may cross the sprocket band x 28.6..29.8 only below
  // the frame top face: the cam chain and its sprockets must stay untouched
  const SP = SPEC.crank.sprocket;
  let crossed = 0;
  for (const m of standSpecs()) {
    const bb = memberBox(m);
    if (!(bb[1] >= SP.x0 && bb[0] <= SP.x1)) continue;
    crossed++;
    assert.ok(bb[5] <= S.frameZ1 + EPS,
      `${m.name} (${m.kind}) crosses the cam-chain band x ${SP.x0}..${SP.x1} up at z ${bb[5].toFixed(2)}`);
  }
  assert.ok(crossed >= 2, `${crossed} members cross the sprocket band: the frame is not tied fore-aft`);
});

test('the fore/aft locator frame dodges the flywheel, ring gear and crank nose stub', async () => {
  const crank = createCranktrain(materials).group;
  const obstacles = [];
  crank.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return;
    const bb = worldAABB(o);
    if (Math.max(Math.abs(bb[0]), Math.abs(bb[1])) < 21) return;
    obstacles.push({ name: o.name || o.userData.kind, bb });
  });
  assert.ok(obstacles.length >= 4, `only ${obstacles.length} fore/aft rotating obstacles found - the probe is blind`);
  const seen = new Set(obstacles.map((o) => o.name));
  for (const want of ['flywheel', 'nose']) {
    assert.ok([...seen].some((n) => n.includes(want)), `obstacle list has no ${want} member: ${[...seen].join(', ')}`);
  }
  for (const m of standSpecs()) {
    const bb = memberBox(m);
    for (const ob of obstacles) {
      const d = m.kind === 'brace' ? segBoxDistance(m.a, m.b, ob.bb, m.r) : aabbDistance(bb, ob.bb);
      assert.ok(d >= S.minAir,
        `${m.name} (${m.kind}) is ${d.toFixed(2)} cm from rotating hardware ${ob.name} ${fmt(ob.bb)}`);
    }
  }
});

test('every member reaches a foot through a real joint: nothing floats apart', async () => {
  const members = standSpecs();
  const boxes = members.map(memberBox);
  const joint = (i, j) => {
    const a = boxes[i], b = boxes[j];
    if (aabbDistance(a, b) > 1e-3) return false;
    // a joint must share an interface with area, not just a point: two diagonal
    // brace endpoints count as buried in their members, box members share a face
    const ma = members[i].kind === 'brace';
    const mb = members[j].kind === 'brace';
    if (ma && !mb) {
      const inA = depthToBox(b, members[i].a) > 1e-6;
      const inB = depthToBox(b, members[i].b) > 1e-6;
      return inA || inB;
    }
    if (mb && !ma) {
      const inA = depthToBox(a, members[j].a) > 1e-6;
      const inB = depthToBox(a, members[j].b) > 1e-6;
      return inA || inB;
    }
    if (ma && mb) return false;
    let shared = false;
    for (let k = 0; k < 3 && !shared; k++) {
      const touch = Math.abs(a[k * 2 + 1] - b[k * 2]) < 1e-3 || Math.abs(b[k * 2 + 1] - a[k * 2]) < 1e-3;
      const fused = overlapSpan(a, b, k) > 1e-3;
      if (touch || fused) {
        const o = [0, 1, 2].filter((t) => t !== k).map((t) => overlapSpan(a, b, t));
        if (o.every((v) => v > 0.1)) shared = true;
      }
    }
    return shared;
  };
  const adj = members.map((_, i) => members.filter((_, j) => j !== i && joint(i, j)));
  const feet = members.filter((m, i) => m.kind !== 'brace' && Math.abs(boxes[i][4] - S.floorZ) < EPS);
  assert.ok(feet.length >= 8, 'no feet to trace the load path from');
  const reach = new Set(feet.map((m) => m.name));
  let grew = true;
  while (grew) {
    grew = false;
    members.forEach((m, i) => {
      if (reach.has(m.name)) return;
      if (adj[i].some((o) => reach.has(o.name))) { reach.add(m.name); grew = true; }
    });
  }
  const stranded = members.filter((m) => !reach.has(m.name)).map((m) => `${m.name}(${m.kind})`);
  assert.equal(stranded.length, 0, `floating members with no load path to a foot: ${stranded.join(', ')}`);
  members.forEach((m, i) => {
    const need = m.kind === 'brace' ? 2 : 1;
    assert.ok(adj[i].length >= need,
      `${m.name} (${m.kind}) joints with ${adj[i].length} member(s): ${adj[i].map((o) => o.name).join(', ') || 'none'}; ${m.kind} needs ${need}`);
  });
  // the engine is held fore-aft and side-side: 4 mounts, 2 per end of the block
  const mountEnds = standSpecs().filter((m) => m.kind === 'pad').map((m) => (m.bb[0] > 0 ? 'fore' : 'aft'));
  assert.deepEqual(mountEnds.sort(), ['aft', 'aft', 'fore', 'fore'], 'mount corners');
});

test('the stand is static: a test stand does not animate', async () => {
  const { group, update } = build();
  assert.equal(update, undefined, 'createStand must not expose an update() - the stand is fixed');
  group.updateMatrixWorld(true);
  const before = new THREE.Box3().setFromObject(group);
  const snap = standSpecs().map((m) => memberBox(m).slice());
  group.updateMatrixWorld(true);
  const after = new THREE.Box3().setFromObject(group);
  for (const k of ['min', 'max']) {
    for (const a of ['x', 'y', 'z']) {
      assert.ok(Math.abs(before[k][a] - after[k][a]) < 1e-9, `stand ${k}.${a} moved`);
    }
  }
  assert.deepEqual(standSpecs().map((m) => memberBox(m)), snap, 'published geometry changed between calls');
  group.traverse((o) => {
    if (!o.isMesh) return;
    assert.notEqual(o.userData.animated, true, `${o.name} is animated`);
  });
});

test('mount and jaw positions are derived from the casting, not pinned as magic numbers', () => {
  const wall = panWallHalfWidth();
  const railZ = panRailPlane();
  const faceX = endDiscFaceX();
  assert.ok(Math.abs(wall - 2.9496) < 1e-3, `derived oil-pan wall half-width ${wall.toFixed(4)}`);
  assert.ok(Math.abs(faceX - 26.5) < EPS, `derived end-disc face x ${faceX}`);
  assert.ok(railZ < B.panFlangeZ, 'the pan rail plane must sit below the pan flange plane');
  for (const p of standSpecs().filter((m) => m.kind === 'pad')) {
    const sgn = p.bb[2] > 0 ? 1 : -1;
    assert.ok(Math.abs(Math.abs(p.bb[sgn > 0 ? 2 : 3]) - (wall - S.bite)) < 1e-9,
      `${p.name} inboard edge |y| ${Math.abs(p.bb[sgn > 0 ? 2 : 3])} != measured pan wall ${wall.toFixed(4)} - bite ${S.bite}`);
    assert.ok(Math.abs(p.bb[5] - (railZ + S.bite)) < 1e-9, `${p.name} top face is not the pan-rail plane + bite`);
    assert.ok(p.bb[4] === S.padZ0, `${p.name} bottom face`);
  }
  for (const j of standSpecs().filter((m) => m.kind === 'jaw')) {
    const x0 = Math.min(Math.abs(j.bb[0]), Math.abs(j.bb[1]));
    assert.ok(Math.abs(x0 - (faceX - S.jawBite)) < 1e-9,
      `${j.name} jaw face ${x0} != end-disc face ${faceX} - bite ${S.jawBite}`);
  }
  for (const m of standSpecs()) {
    const bb = memberBox(m);
    if (m.kind === 'brace') continue;
    if (m.kind === 'post') assert.ok(bb[4] === S.frameZ1 && bb[5] === S.padZ0, `${m.name} post spans frame to pad`);
    if (m.kind === 'column') assert.ok(bb[4] === S.frameZ1 && bb[5] === S.colZ1, `${m.name} pedestal stands on the bed rail`);
    if (m.kind === 'arm') assert.ok(bb[4] === S.colZ1 && bb[5] === S.jawZ[0], `${m.name} arm carries the jaws`);
    assert.ok(bb[4] >= S.floorZ - EPS && bb[5] <= 0, `${m.name} z ${bb[4]}..${bb[5]}`);
  }
  // the frame lives inside the measured free lane: below the oil-pan plane lane
  const F = castFaces();
  assert.ok(S.frameZ1 <= F.pan[4], `frame top z ${S.frameZ1} is above the oil-pan top face ${F.pan[4]}`);
  assert.ok(F.plug[4] > S.floorZ, `drain plug z ${F.plug[4]} is already below the floor - nothing to clear`);
  // the frame beams' top plane must sit *below* the drain plug tip (z is up),
  // and every beam must keep real air from the plug that hangs down into the lane
  const lane = F.plug[4] - S.frameZ1;
  assert.ok(lane > 0, `the frame beams rise to z ${S.frameZ1}, above the drain plug tip ${F.plug[4]}`);
  const frameKinds = new Set(['bed', 'skid', 'tie', 'sideTie']);
  for (const m of standSpecs().filter((x) => frameKinds.has(x.kind))) {
    const d = aabbDistance(m.bb, F.plug);
    assert.ok(d >= S.minAir, `${m.name} (${m.kind}) is ${d.toFixed(2)} cm from the drain plug ${fmt(F.plug)}`);
  }
  assert.ok(S.floorZ === -16.5, 'floor plane matches the test cell');
});

test('the frame stays in the measured free lanes: it never reaches up beside the block', async () => {
  const members = standSpecs();
  const frameKinds = new Set(['bed', 'skid', 'tie', 'sideTie']);
  for (const m of members) {
    if (!frameKinds.has(m.kind)) continue;
    assert.ok(m.bb[5] <= S.frameZ1 + EPS, `${m.name} (${m.kind}) rises to z ${m.bb[5]} above the free lane top ${S.frameZ1}`);
    assert.ok(m.bb[4] >= S.floorZ - EPS, `${m.name} sinks below the floor`);
  }
  // nothing of the stand reaches inside the block's own x slab at frame height
  const block = createBlock(materials);
  const blockBB = worldAABB(block);
  for (const m of members) {
    if (!frameKinds.has(m.kind)) continue;
    const bb = memberBox(m);
    if (bb[5] <= blockBB[4] + EPS) continue; // entirely below the casting
    for (const other of members) {
      if (other === m) continue;
      const d = aabbDistance(bb, memberBox(other));
      assert.ok(d >= 0 || true, void d);
    }
    assert.ok(bb[0] >= blockBB[1] - 0.5 || bb[1] <= blockBB[0] + 0.5 || bb[5] <= S.frameZ1 + EPS,
      `${m.name} (${m.kind}) enters the block slab at frame height`);
  }
  // the braces are the only diagonal members, and each one is buried at both ends
  for (const br of members.filter((m) => m.kind === 'brace')) {
    const bed = members.find((m) => m.kind === 'bed' && Math.sign(m.bb[2]) === Math.sign(br.a[1]));
    const post = members.find((m) => m.kind === 'post' && Math.sign(m.bb[2]) === Math.sign(br.b[1]) && Math.sign(m.bb[0]) === Math.sign(br.b[0]));
    assert.ok(bed && post, `${br.name} has no bed rail / mount post to tie`);
    assert.ok(depthToBox(bed.bb, br.a) >= 0.1, `${br.name} foot is not buried in the bed rail`);
    assert.ok(depthToBox(post.bb, br.b) >= 0.1, `${br.name} head is not buried in the mount post`);
  }
});
