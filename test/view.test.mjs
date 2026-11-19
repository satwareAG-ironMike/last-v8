// View-control unit: CUTAWAY, EXPLODED VIEW / ASSEMBLE, PART INSPECTION.
//
// Everything here is measured against the scene graph the renderer really builds
// (real meshes, real triangles, a real THREE.PerspectiveCamera driven by the real
// camera rig). Four claims carry the unit:
//
//  1. CUTAWAY is one plane containing the crank axis, derived from the published
//     home view - and the camera always stands on the side that gets removed,
//     which is what makes a section a section.
//  2. EXPLODED VIEW is a chain, not a scatter: along each family's own build axis
//     consecutive levels of the teardown are separated by at least `clearance`,
//     measured on the members' REAL triangles, in the exploded state, not in a
//     plan.
//  3. Nothing leaves the cell: no member sinks through the floor plate, none
//     comes to rest inside the stand hardware the assembled engine is clamped by,
//     and the whole exploded union is framed uncropped by the published rig.
//  4. ASSEMBLE is exactly reversible: the tree, every local transform and the
//     camera pose come back byte-for-byte.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

import { PLUG_BOSS_A, SPEC, bankOut, bankPoint, bankUp, wrap720 } from '../src/engine/spec.js';
import { bboxRadius, cutawaySpecs, explodeDirection, explodeOffsets, explodeRuleFor, explodeRules, explodeSpecs, framingRange, mountClearLift, partLabel, partBank } from '../src/engine/view.js';
import { sparkAngle, totalAdvance } from '../src/engine/ignition.js';
import { firingOrder, firingProgress } from '../src/engine/timing.js';
import { clampFocus, createCameraRig } from '../src/ui/cameraRig.js';
import { buildMembers, createViewControls, measureExtent, mountHardware } from '../src/ui/viewControls.js';
import { distToTriangle, engineTriangles, engineUnits, proxyMaterials, triDistance } from './support/engine-triangles.mjs';
import { createEngineState } from '../src/engine/animation.js';
import { plugStack, segRadius, stackRadius } from './support/plug-stack.mjs';
import { createCranktrain } from '../src/render/cranktrain.js';
import { createStand } from '../src/render/stand.js';
import { createValvetrain } from '../src/render/valvetrain.js';
import { camCapBoltSpecs } from '../src/render/heads.js';

const V = SPEC.view;
const FLOOR = SPEC.stand.floorZ;
const ASPECT = V.aspect;
const W = 1280;
const H = Math.round(W / ASPECT);
const EPS = 1e-9;
// The tolerance a law here may measure a DRAWN mesh at. three.js stores every
// position in a Float32Array: the storage step is 1.526e-6 cm at the top of the
// plug stack (36.1 cm), and the widest height error the drawn plug really shows
// against its published numbers is 1.247e-6 cm (tmp/c11-probe2.mjs). A tighter
// tolerance would gate binary noise instead of the part, so every drawn-vs-
// published comparison in section 13 uses 1e-5 cm - about seven storage steps,
// and still 15000x under the shortest published plug length (electrode 0.15 cm).
// Arithmetic between published numbers keeps EPS.
const GEO_EPS = 1e-5;

/** The world main.js builds: the casting, its assemblies and the stand. */
function buildWorld() {
  const materials = proxyMaterials();
  const units = engineUnits(materials);
  const engine = units.block;
  engine.name = 'v8-block';
  engine.add(units.cranktrain, units.valvetrain, units.heads, units.manifolds);
  // The plug assembly joins the engine as its own assembly, exactly like the
  // valvetrain does, so buildMembers sees the eight plugs as members and they
  // become inspectable, explodable and auditable by the same machinery. Guarded
  // because the laws in section 13 measure the assembly live: with no renderer
  // the world is the world of every other law, and the plug laws fail on their
  // own missing part rather than taking the other twelve down with them.
  if (units.plugs) engine.add(units.plugs.group);
  engine.updateMatrixWorld(true);
  const scene = new THREE.Scene();
  scene.add(engine);
  const { group: stand } = createStand(materials);
  stand.updateMatrixWorld(true);
  scene.add(stand);
  const camera = new THREE.PerspectiveCamera(V.fov, ASPECT, 0.5, 3000);
  const rig = createCameraRig(camera);
  rig.update(0);
  const view = createViewControls({ engine, materials, rig, camera, scene, stand });
  return { engine, materials, units, scene, stand, camera, rig, view };
}

const world = buildWorld();
const { engine, materials, units, scene, stand, camera, rig, view } = world;

/** Fingerprint of the whole engine tree: identity, parent, and local transforms. */
const fingerprint = () => {
  const rows = [];
  engine.traverse((o) => {
    rows.push(`${o.name}|${o.parent?.name ?? ''}|${o.position.toArray().map((n) => n.toFixed(9))}|${o.quaternion.toArray().map((n) => n.toFixed(9))}|${o.scale.toArray().map((n) => n.toFixed(9))}`);
  });
  return rows.join('\n');
};

// The pristine tree, captured before a single explode has ever run. Comparing an
// assembled state only against "whatever the previous teardown produced" cannot
// see a teardown that reorders deterministically: reversing the rebuilt child list
// is IDEMPOTENT, so pre- and post-state match and every assertion stays green
// (tmp/mutate-view.sh M18). The reference has to be the tree as built.
const PRISTINE = fingerprint();

// The stand hardware that grips the engine, measured ONCE on the pristine
// assembled world - before any test has exploded or hoisted anything. It has to
// be measured there: "mount hardware" is by definition the hardware the casting
// is clamped by, and the whole point of the hoist law is that the exploded
// chain has to clear it. Measuring it after a test has left the engine
// separated returns nothing (that is how the first run of this unit reported
// "0 mounts": an earlier subtest threw mid-explode and never collapsed back).
const MOUNTS = mountHardware(stand, engine);

/** Live world box of a member, ancestors included. */
const liveBox = (name) => {
  const obj = view.members.get(name);
  obj.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(obj);
};
const boxArray = (b) => ({ min: b.min.toArray(), max: b.max.toArray() });
const corners = (b) => {
  const out = [];
  for (const x of [b.min.x, b.max.x]) {
    for (const y of [b.min.y, b.max.y]) {
      for (const z of [b.min.z, b.max.z]) out.push(new THREE.Vector3(x, y, z));
    }
  }
  return out;
};
const ease = (frames = 400) => {
  for (let i = 0; i < frames; i++) view.update(1 / 60);
};
const screenOf = (p) => {
  const ndc = p.clone().project(camera);
  return { x: ((ndc.x + 1) / 2) * W, y: ((1 - ndc.y) / 2) * H, ndc };
};

// =========================================================== 1. cutaway plane ===
test('cutaway: one plane through the crank axis, derived from the home view', () => {
  const c = cutawaySpecs();
  // the crank axis IS the world X axis, so a plane containing it has no X term
  assert.ok(Math.abs(c.normal[0]) < EPS, 'cutaway normal must be perpendicular to the crank axis');
  const eye = new THREE.Vector3(...V.homePos);
  const focus = new THREE.Vector3(...V.homeTarget);
  const d = focus.clone().sub(eye);
  const want = new THREE.Vector3(0, d.y, d.z).normalize(); // lateral part of eye->focus
  const got = new THREE.Vector3(...c.normal);
  // the kept half is the far side: the normal IS the lateral view direction, so
  // the section face turns towards the camera that asked for the cutaway
  assert.ok(got.angleTo(want) < 1e-6, `normal must be the lateral view direction, angle ${got.angleTo(want).toFixed(4)}`);
  const plane = new THREE.Plane(got, c.constant);
  // the camera stands in the half that is removed - otherwise it is not a cutaway
  assert.ok(plane.distanceToPoint(eye) < 0, 'the home eye must be on the clipped side');
  // the plane contains the crank centreline: every point of the X axis lies on it
  for (const x of [-24, 0, 24]) assert.ok(Math.abs(plane.distanceToPoint(new THREE.Vector3(x, 0, 0))) < 1e-9, `plane misses the crank axis at x=${x}`);
  // azimuth is the same polar convention src/engine/spec.js uses for bore axes
  assert.ok(Math.abs(c.azimuthDeg - (Math.atan2(c.normal[1], c.normal[2]) * 180) / Math.PI) < 1e-9);
  // the section follows the hoist: constant = -normal . (0,0,lift)
  const lifted = cutawaySpecs({ lift: 34.25 });
  assert.ok(Math.abs(lifted.constant - -(lifted.normal[2] * 34.25)) < EPS);
  assert.ok(Math.abs(lifted.normal[2] - c.normal[2]) < EPS, 'the cut angle must not change with the hoist');
  // a live pose gives its own plane: the rig decides, not a memorised tuple
  const other = rig.state();
  const c2 = cutawaySpecs({ eye: other.eye.toArray(), target: other.focus.toArray() });
  assert.ok(new THREE.Plane(new THREE.Vector3(...c2.normal), c2.constant).distanceToPoint(other.eye) <= EPS);
});

// ================================================= 2. clipping stays in engine ===
test('cutaway: the section is private to the engine, and reversible', (t) => {
  // main.js shares ONE material set between every render module: measured, the
  // test stand genuinely uses two of the engine's material objects. Mutating
  // those would cut the stand in half too.
  const shared = new Set();
  engine.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) shared.add(m);
  });
  const standMats = new Set();
  stand.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) standMats.add(m);
  });
  const overlap = [...standMats].filter((m) => shared.has(m));
  assert.ok(overlap.length > 0, 'the world is only a fair test if engine and stand really share materials');

  const originals = new Map();
  engine.traverse((o) => {
    if (o.isMesh) originals.set(o, Array.isArray(o.material) ? o.material.slice() : [o.material]);
  });

  assert.equal(view.setCutaway(true), true);
  const st = view.state();
  assert.ok(st.cutawayPlane, 'cutaway must publish its plane');
  // every engine mesh is on a private, double-sided clone...
  let sectioned = 0;
  engine.traverse((o) => {
    if (!o.isMesh) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    if (list.some((m) => String(m.name).endsWith(':sectioned'))) sectioned += 1;
  });
  assert.equal(sectioned, originals.size, 'every engine mesh must be sectioned, not just some');
  let doubleSided = 0;
  engine.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (String(m.name).endsWith(':sectioned') && m.side === THREE.DoubleSide) doubleSided += 1;
    }
  });
  assert.equal(doubleSided, originals.size, 'a sectioned casting must render its inner wall too, or the cut reads as a hollow void');
  // ...and no material the stand renders carries the clip
  for (const m of overlap) assert.ok(!(m.clippingPlanes?.length > 0), `stand material "${m.name}" was clipped`);
  // the exemption rule of setClipping still applies to the clones it is given
  assert.equal(view.setCutaway(false), false);
  assert.equal(view.state().cutawayPlane, null, 'cutaway off must clear the plane');
  for (const m of overlap) assert.ok(!(m.clippingPlanes?.length > 0));
  let restored = 0;
  engine.traverse((o) => {
    if (!o.isMesh) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    const was = originals.get(o);
    if (list.length === was.length && list.every((m, i) => m === was[i])) restored += 1;
  });
  assert.equal(restored, originals.size, 'materials must come back as the original objects');
  t.diagnostic(`engine meshes ${originals.size}, shared-with-stand materials ${overlap.length}`);
});

// ==================================================== 3. the teardown table ===
test('explode table: every rule lands on real parts, and no part is moved twice', () => {
  const rules = explodeRules();
  const names = [...view.members.keys()];
  for (const r of rules) {
    const familyOf = (n) => (typeof r.family === 'function' ? r.family(n) : r.family);
    const hit = names.filter((n) => r.re.test(n) && explodeRuleFor(n)?.family === familyOf(n) && explodeRuleFor(n)?.stage === r.stage);
    assert.ok(hit.length >= 1, `explode rule ${r.re} selects no real member`);
  }
  // one rule per member: the regexes must not overlap each other
  const claimed = new Map();
  for (const name of names) {
    const r = explodeRuleFor(name);
    if (!r) continue;
    const hits = rules.filter((x) => x.re.test(name));
    assert.equal(hits.length, 1, `"${name}" is claimed by ${hits.length} explode rules`);
    claimed.set(name, r);
    assert.ok(explodeDirection(r.family).length === 3);
  }
  assert.ok(claimed.size >= 100, `expected the teardown to cover the internals, got ${claimed.size} members`);
  // disjoint members: no moved part may be an ancestor of another moved part,
  // or an offset would be applied twice through the tree
  for (const [name, obj] of view.members) {
    let p = obj.parent;
    while (p && p !== engine) {
      assert.ok(!view.members.has(p.name) || p.name === name, `"${name}" is nested inside moved member "${p.name}"`);
      p = p.parent;
    }
  }
  // unlabelled castings that are not part of the table stay put on purpose
  for (const name of ['crankcase', 'pan-rails', 'liner-cyl1', 'column-L-16.5', 'web-L-16.5', 'main-neck-x0']) {
    assert.equal(explodeRuleFor(name), null, `${name} must stay with the reference casting`);
    assert.ok(view.members.has(name), `${name} is missing from the assembly`);
  }
  // the stand interfaces are a name's bank either explicitly or by cylinder
  assert.equal(partBank('head-L'), 'L');
  assert.equal(partBank('valve-cyl4-exhaust'), 'R');
  assert.equal(partBank('crankcase'), null);
  assert.ok(partLabel('crank').includes('crossplane'));
  assert.ok(partLabel('piston-cyl3').includes('cylinder 3'));
});

// ============================================ 4. the chain law, live measured ===
test('explode: the chain fans out along each build axis and never folds back', (t) => {
  view.explode();
  ease();
  assert.ok(view.state().fraction > 0.999, 'the easing must reach the fully exploded state');

  const byFamily = new Map();
  for (const [name, off] of view.offsets) {
    if (!byFamily.has(off.family)) byFamily.set(off.family, []);
    byFamily.get(off.family).push({ name, ...off });
  }
  const S = explodeSpecs();
  let tightest = Infinity;
  let where = null;
  for (const [family, list] of byFamily) {
    const dir = explodeDirection(family);
    // live triangles at the exploded spot: a Box3 projected on a diagonal axis
    // inflates the part (its corners project further than any of its triangles)
    const ranges = list.map((m) => ({ ...m, ext: measureExtent(view.members.get(m.name), dir) }));
    const stages = [...new Set(list.map((m) => m.stage))].sort((a, b) => a - b);
    assert.ok(stages.length >= 1);
    // monotone: a level installed further outboard never travels less
    let prevDist = -Infinity;
    for (const stage of stages) {
      const d = ranges.filter((m) => m.stage === stage).map((m) => view.offsets.get(m.name).dist);
      assert.equal(new Set(d).size, 1, `stage ${stage} of ${family} must travel as one level`);
      assert.ok(d[0] >= prevDist - EPS, `${family} stage ${stage} travels ${d[0]} after a level at ${prevDist}`);
      prevDist = d[0];
    }
    // separation: projections of consecutive levels along the build axis
    const levels = stages.map((stage) => {
      const at = ranges.filter((m) => m.stage === stage);
      return { stage, near: Math.min(...at.map((m) => m.ext.near)), far: Math.max(...at.map((m) => m.ext.far)) };
    });
    for (let i = 1; i < levels.length; i++) {
      const gap = levels[i].near - levels[i - 1].far;
      assert.ok(gap >= S.clearance - 1e-6, `${family} stage ${levels[i - 1].stage}->${levels[i].stage} gap ${gap.toFixed(2)} cm < clearance ${S.clearance}`);
      if (gap < tightest) {
        tightest = gap;
        where = `${family} ${levels[i - 1].stage}->${levels[i].stage}`;
      }
    }
    // every member must travel at least the stage ladder it was given
    for (const m of ranges) assert.ok(m.dist >= m.stage * S.gap - EPS, `${m.name} stage ${m.stage} moved ${m.dist}`);
    // siblings of one interface travel as ONE level: a stage never splits into
    // two different travels. It MAY share a travel with the stage before it -
    // the monotone carry below the chain law raises a level that would otherwise
    // fold back onto its neighbour, and when it does, two stages legitimately
    // arrive at the same distance (measured: `down` stage 2 and 3 both 21.90 cm,
    // `bank-L` stage 7 and 8 both 58.88 cm). What must never happen is a family
    // with more distinct travels than stages, i.e. a level torn apart.
    const distinct = new Set(list.map((m) => view.offsets.get(m.name).dist)).size;
    assert.ok(distinct <= stages.length, `${family}: ${stages.length} stages but ${distinct} different travels - the level grouping is broken`);
  }
  assert.ok(tightest >= S.clearance - 1e-6);
  // An absolute floor on top of the relative one, measured in SCREEN pixels. The
  // separation law and this test would otherwise read the SAME published constant:
  // poke clearance to 0 and every assertion still passes, which is exactly what
  // tmp/mutate-view.sh M01 measured on the first run (tightest gap -0.00 cm). A
  // teardown whose levels are not a few pixels apart on screen is not a teardown.
  const st4 = rig.state();
  const cmPerPx = (2 * st4.dist * Math.tan((V.fov / 2) * (Math.PI / 180))) / H;
  const tightestPx = tightest / cmPerPx;
  assert.ok(tightestPx >= 4, `tightest exploded gap ${tightest.toFixed(2)} cm is ${tightestPx.toFixed(2)} px at the published framing (${cmPerPx.toFixed(3)} cm/px): not legible`);
  t.diagnostic(`families ${byFamily.size}, tightest axis gap ${tightest.toFixed(2)} cm = ${tightestPx.toFixed(1)} px at ${tightestPx > 0 ? where : where}`);
  view.assemble();
  ease(600);
});

// ============================================ 5. the exploded assembly, in place ===
test('explode: the assembly stays inside the cell and clear of the stand', (t) => {
  const mounts = MOUNTS;
  assert.ok(mounts.length >= 5, `expected the stand hardware that grips the engine, got ${mounts.length}`);
  view.explode();
  ease();
  const S = explodeSpecs();
  const floor = FLOOR + S.floorMargin;
  let lowest = Infinity;
  for (const name of view.members.keys()) {
    const b = liveBox(name);
    lowest = Math.min(lowest, b.min.z);
  }
  assert.ok(lowest >= floor - EPS, `exploded member at z ${lowest.toFixed(2)} is under the floor guard ${floor}`);
  assert.ok(view.lift > 0, 'the down chain must force a hoist');

  // the hoist is derived, and the mount law is the reason it is what it is
  // directly: every member is separated from every mount box on at least one axis
  let worst = Infinity;
  let pair = null;
  for (const name of view.members.keys()) {
    const b = liveBox(name);
    for (const m of mounts) {
      const mb = new THREE.Box3(new THREE.Vector3(...m.min), new THREE.Vector3(...m.max));
      const gapX = Math.max(mb.min.x - b.max.x, b.min.x - mb.max.x);
      const gapY = Math.max(mb.min.y - b.max.y, b.min.y - mb.max.y);
      const gapZ = Math.max(mb.min.z - b.max.z, b.min.z - mb.max.z);
      const sep = Math.max(gapX, gapY, gapZ); // axes already clear read as a positive gap
      if (sep < worst) {
        worst = sep;
        pair = `${name} vs ${m.name}`;
      }
    }
  }
  assert.ok(worst >= SPEC.stand.minAir - EPS, `exploded member touches the stand mount: ${pair} at ${worst.toFixed(2)} cm`);

  // and nothing may sit below the floor plate at any point of the easing either
  view.assemble();
  for (let i = 0; i <= 400; i++) {
    view.update(1 / 60);
    for (const name of view.offsets.keys()) {
      const b = liveBox(name);
      assert.ok(b.min.z >= FLOOR - EPS, `mid-collapse "${name}" at z ${b.min.z.toFixed(2)} is under the floor plate`);
    }
  }
  t.diagnostic(`lift ${view.lift.toFixed(2)} cm from a floor guard at ${floor}, mount boxes ${mounts.length}, tightest member/mount separation ${worst.toFixed(2)} cm at ${pair}`);
});

// ==================================================== 6. framing and cropping ===
test('explode: the published rig frames the whole exploded union uncropped', () => {
  const bounds = view.explodedBounds();
  const law = framingRange(bounds.radius);
  assert.ok(law >= V.distMin - EPS && law <= V.distMax + EPS, `framing range ${law} outside the rig limits`);
  // the law's margin has to survive its own clamps: if the published distMax is
  // what limits the teardown, that is a coupling the contract must name rather
  // than a framing that quietly gives up its margin (tmp/mutate-view.sh M02:
  // clearance 10 drives radius 152.2 -> want 430.7 -> clamped to 420).
  const unclamped = framingRange(bounds.radius, { distMin: 0, distMax: Number.POSITIVE_INFINITY });
  assert.ok(Math.abs(law - unclamped) < 1e-6, `framing is clamped: the body wants ${unclamped.toFixed(1)} cm of range and distMax is ${V.distMax}`);
  // monotone and conservative: a bigger body needs a further camera
  assert.ok(framingRange(10) < framingRange(40) && framingRange(40) < framingRange(200));
  const view2 = view.explode();
  ease();
  assert.ok(Math.abs(view2.radius - bounds.radius) < 1e-6);
  const st = rig.state();
  assert.ok(Math.abs(st.dist - law) < 0.5, `rig framed at ${st.dist}, law says ${law}`);
  assert.ok(st.dist <= V.distMax + EPS && st.dist >= V.distMin - EPS);
  assert.ok(st.eye.z >= FLOOR + V.eyeMin - EPS, 'framing an exploded engine must not put the eye under the floor plate');
  let worst = 0;
  const b = new THREE.Box3(new THREE.Vector3(...bounds.min), new THREE.Vector3(...bounds.max));
  for (const c of corners(b)) {
    const p = c.project(camera);
    worst = Math.max(worst, Math.abs(p.x), Math.abs(p.y), Math.abs(p.z));
  }
  assert.ok(worst <= 1 - 1e-6, `exploded corners reach |ndc| ${worst.toFixed(3)} - something is cropped`);
  view.assemble();
  ease(600);
});

// ================================================= 7. ASSEMBLE is reversible ===
test('assemble: the tree, the transforms and the camera come back exactly', () => {
  rig.reset();
  rig.update(0);
  view.setCutaway(true); // the user had the section open
  const before = fingerprint();
  const pose = JSON.stringify(rig.state());
  const engineZ = engine.position.z;
  const matOf = new Map();
  engine.traverse((o) => {
    if (o.isMesh) matOf.set(o, o.material);
  });

  view.explode();
  ease();
  assert.equal(view.state().cutaway, false, 'EXPLODED VIEW must close the cutaway: measured, an open cut eats 38 exploded members');
  const moved = view.state().moved;
  assert.equal(moved, view.offsets.size);
  assert.ok(engine.position.z > engineZ, 'the hoist must lift the assembly');

  view.assemble();
  ease(600);
  const st = view.state();
  assert.equal(st.fraction, 0);
  assert.equal(st.moved, 0, 'the wrappers must be released, not left in the tree');
  assert.equal(engine.position.z, engineZ, 'the hoist must be given back exactly');
  assert.equal(before, PRISTINE, 'the tree was not pristine before the explode: an earlier teardown already permuted it');
  assert.equal(fingerprint(), before, 'ASSEMBLE must restore the tree byte-for-byte, in order');
  assert.equal(fingerprint(), PRISTINE, 'ASSEMBLE must come back to the tree as built, not to a reordered one');
  assert.equal(JSON.stringify(rig.state()), pose, 'the camera pose the user had must come back');
  assert.equal(view.state().cutaway, true, 'ASSEMBLE must restore the cutaway state the user had');
  let same = 0;
  engine.traverse((o) => {
    if (o.isMesh && matOf.get(o) === o.material) same += 1;
  });
  assert.equal(same, matOf.size);
  view.setCutaway(false);
});

// ================================================= 8. part inspection & picking ===
test('inspection: every menu entry is a real part, framed by a legal pose', (t) => {
  const entries = view.inspectables();
  assert.ok(entries.length > 100, `the inspection menu should cover the assembly, got ${entries.length}`);
  let bad = 0;
  for (const e of entries) {
    const r = view.focusPart(e.name);
    if (!r) {
      bad += 1;
      continue;
    }
    const st = rig.state();
    assert.ok(st.dist >= V.distMin - EPS && st.dist <= V.distMax + EPS, `${e.name} framed outside the rig limits: ${st.dist}`);
    assert.ok(st.eye.z >= FLOOR + V.eyeMin - EPS, `${e.name} framing puts the eye under the floor plate`);
    assert.ok(r.label && r.label !== e.name, `${e.name} has no human label`);
    assert.ok(r.meshes >= 1, `${e.name} resolves to no mesh`);
    const box = liveBox(e.name);
    const fit = bboxRadius(boxArray(box));
    assert.ok(Math.abs(fit.radius - r.radius) < 0.02, `${e.name} radius ${r.radius} vs measured ${fit.radius}`);
    // the range focusPart publishes is the framing law's own answer, so IT has to
    // be inside the rig limits. The rig clamps its goal as well, which is defence
    // in depth - but if the law hands back 5.7 cm for a drain plug, the part is
    // framed inside the castings and nothing in the unit would have noticed.
    assert.ok(r.range >= V.distMin - EPS, `${e.name}: framing law published range ${r.range} for radius ${r.radius}, under distMin ${V.distMin}`);
    assert.ok(r.range <= V.distMax + EPS, `${e.name}: framing law published range ${r.range} for radius ${r.radius}, over distMax ${V.distMax}`);
    // both published numbers are rounded to 2 dp, so re-deriving the range from
    // the rounded radius costs at most ~0.02 cm (measured: the whole 1..60 cm
    // radius sweep moves the law by at most 0.0141 under that rounding)
    assert.ok(Math.abs(r.range - framingRange(r.radius)) < 0.05, `${e.name}: range ${r.range} is not the framing law for radius ${r.radius}`);
  }
  assert.equal(bad, 0);
  rig.reset();
  rig.update(0);
  t.diagnostic(`inspectables ${entries.length}`);
});

// ---- A1-G7 the cap bolts as service items of their own bank ------------------
// 56 cam bearing cap bolts are the only thing holding the 28 split bearing caps
// onto their cradles (test/heads.test.mjs gates the castings). A bolt a builder
// has to undo is a service item, and the view only offers a part that
//   1. is a member of the assembly,
//   2. carries a human label naming which bank's caps it holds,
//   3. is ruled in the teardown table with the head it is screwed through,
// and all three need the bolts to be one mesh per bank: the name `cam-cap-bolts`
// carries no bank (partBank reads it as null), so partLabel cannot name a bank,
// and src/ui/viewControls.js drops every member it cannot label from the
// inspection menu. One bank-blind mesh for both banks is therefore not one bolt
// set the user can pick, it is no bolt set at all on the menu.
test('A1-G7 each bank carries its own cam bearing cap bolt set', (t) => {
  const specs = camCapBoltSpecs();
  const want = {};
  for (const bank of ['L', 'R']) want[bank] = specs.filter((s) => s.bank === bank).length;
  assert.equal(want.L + want.R, specs.length, 'camCapBoltSpecs must publish every bolt under one bank');
  assert.ok(want.L === want.R && want.L > 0, `expected the same number of cap bolts per bank, got ${want.L} / ${want.R}`);

  for (const bank of ['L', 'R']) {
    const name = `cam-cap-bolts-${bank}`;
    const obj = view.members.get(name);
    assert.ok(obj,
      `${name} is not a member of the assembly: all ${specs.length} cap bolts are one mesh named "cam-cap-bolts" for both banks, and a name no bank can be read out of is not a part of ${bank === 'L' ? 'left' : 'right'} bank anything`);
    assert.ok(obj.isInstancedMesh, `${name} is ${obj.type}, not the instanced bolt set the ${want[bank]} cap bolts render as`);
    assert.equal(obj.count, want[bank],
      `${name} carries ${obj.count} bolts, but ${want[bank]} cap bolts are published for ${bank === 'L' ? 'left' : 'right'} bank (${specs.length} for both banks at ${SPEC.cam.bearings.length} columns x 2 sides x 2 cam lines)`);
    assert.equal(obj.userData.kind, 'capBolt', `${name} is not marked as a cam bearing cap bolt`);
    assert.equal(partBank(name), bank, `partBank("${name}") reads ${partBank(name)} - the teardown table and every bank law read the bank out of the member name`);

    const label = partLabel(name);
    assert.notEqual(label, name, `${name} carries no human label, and an unlabelled member is dropped from the inspection menu`);
    assert.ok(/cam bearing cap bolt/i.test(label), `partLabel("${name}") reads "${label}" - it has to name a cam bearing cap bolt`);
    assert.ok(/left bank|right bank/.test(label) && label.includes(bank === 'L' ? 'left' : 'right'),
      `partLabel("${name}") reads "${label}" - the bolts hold the caps of one bank, so the label has to say which`);

    // the label is a teardown instruction a builder reads, so the number it states
    // has to be the number the mesh actually carries
    const labelBolts = Number((label.match(/(\d+)\s+bolts/) || [])[1]);
    assert.equal(labelBolts, obj.count,
      `partLabel("${name}") tells the builder ${labelBolts} bolts, the mesh carries ${obj.count}: "${label}"`);

    // the fastener leaves with the casting it is screwed into: same family, same
    // stage as its head (see the spark plug note in explodeRules for why a later
    // stage or a family of its own breaks the chain)
    const r = explodeRuleFor(name);
    const head = explodeRuleFor(`head-${bank}`);
    assert.ok(head, `head-${bank} carries no teardown rule, so a cap bolt cannot be required to travel with it`);
    assert.ok(r, `${name} is not ruled in the teardown table, so the ${want[bank]} cap bolts of ${bank === 'L' ? 'left' : 'right'} bank stay cast into the head instead of coming off with it`);
    assert.equal(r.family, head.family, `${name} leaves in family ${r.family}, its head leaves in ${head.family}`);
    assert.equal(r.stage, head.stage, `${name} leaves at stage ${r.stage}, its head at stage ${head.stage} - a bolt screwed into a head comes off with that head`);

    // and it is offered to the user: on the menu, framed by a legal pose
    const entry = view.inspectables().find((e) => e.name === name);
    assert.ok(entry, `${name} is not on the inspection menu`);
    const focus = view.focusPart(name);
    assert.ok(focus, `focusPart("${name}") returns nothing`);
    assert.ok(focus.meshes >= 1, `${name} resolves to no mesh`);
    const st = rig.state();
    assert.ok(st.dist >= V.distMin - 1e-6 && st.dist <= V.distMax + 1e-6,
      `${name} framed outside the rig limits: ${st.dist} (distMin ${V.distMin}, distMax ${V.distMax})`);
    assert.ok(st.eye.z >= FLOOR + V.eyeMin - 1e-6, `${name} framing puts the eye under the floor plate`);
  }

  // one mesh per bank, not both: a second mesh under the same 56 bolts would
  // double-count them in every census and in the exploded view
  assert.equal(view.members.has('cam-cap-bolts'), false,
    'a bank-blind "cam-cap-bolts" member is still there next to the per-bank sets');
  rig.reset();
  rig.update(0);
  t.diagnostic(`cap bolts per bank: L ${want.L}, R ${want.R}`);
});

test('inspection: picking a part reports the member the ray really hit', (t) => {
  rig.reset();
  rig.update(0);
  view.setCutaway(false);
  const rect = { left: 0, top: 0, width: W, height: H };
  // control: an outboard part at the home view must pick itself
  const target = 'headers-L';
  const centre = new THREE.Box3().setFromObject(view.members.get(target)).getCenter(new THREE.Vector3());
  const s = screenOf(centre);
  assert.ok(Math.abs(s.ndc.x) < 1 && Math.abs(s.ndc.y) < 1, `${target} is not in frame at the home pose`);
  const hit = view.pickAt(s.x, s.y, rect);
  assert.ok(hit, `nothing was picked at the centre of ${target}`);
  assert.equal(hit.name, target, `picking ${target} reported "${hit.name}"`);
  assert.equal(view.focusPart('no-such-part'), null, 'an unknown part must not fabricate a selection');

  // with the section open, a part the cut has removed must not stay clickable:
  // the raycaster knows nothing about clipping planes
  view.setCutaway(true);
  const st = view.state();
  const plane = new THREE.Plane(new THREE.Vector3(...st.cutawayPlane.normal), st.cutawayPlane.constant);
  let fullyClipped = 0;
  let picks = 0;
  for (const name of view.members.keys()) {
    const b = liveBox(name);
    if (!corners(b).every((c) => plane.distanceToPoint(c) < 0)) continue;
    fullyClipped += 1;
    const c = b.getCenter(new THREE.Vector3());
    const p = screenOf(c);
    if (Math.abs(p.ndc.x) > 0.97 || Math.abs(p.ndc.y) > 0.97) continue;
    const r = view.pickAt(p.x, p.y, rect);
    if (r) picks += 1;
    assert.ok(!r || r.name !== name, `"${name}" is on the removed side but is still selectable`);
  }
  assert.ok(fullyClipped >= 10, `expected the cut to remove parts, got ${fullyClipped}`);
  assert.ok(picks >= 1, 'the rejection must not be a blanket: some part must stay pickable');
  view.setCutaway(false);
  rig.reset();
  rig.update(0);
  t.diagnostic(`members the cut removes ${fullyClipped}, picks still resolving to a kept part ${picks}`);
});

// ============================================ 9. easing, and nothing left behind ===
test('the separation and the collapse are damped: monotone, frame-rate free, complete', () => {
  view.assemble();
  ease(600);
  assert.equal(view.state().fraction, 0);
  view.explode();
  const seen = [];
  for (let i = 0; i < 240; i++) {
    const f = view.update(1 / 60);
    seen.push(f);
  }
  assert.ok(seen.every((f, i) => i === 0 || f >= seen[i - 1] - EPS), 'the explode easing must not oscillate');
  assert.ok(seen[seen.length - 1] > 0.999);
  // half the frame rate, same destination: the damping is dt-scaled
  view.assemble();
  ease(600);
  view.explode();
  let coarse = 0;
  for (let i = 0; i < 120; i++) coarse = view.update(1 / 30);
  assert.ok(coarse > 0.999, 'a slower frame rate must not leave the assembly half separated');
  view.assemble();
  const trail = [];
  for (let i = 0; i < 600; i++) trail.push(view.update(1 / 60));
  assert.ok(trail.every((f, i) => i === 0 || f <= trail[i - 1] + EPS), 'the collapse easing must not overshoot');
  assert.equal(view.state().fraction, 0);
  assert.equal(view.state().moved, 0);
  assert.equal(engine.position.z, 0, 'the hoist is easing too: it must end at the installed height');
  assert.ok(explodeOffsets(new Map([[ 'crank', { near: 0, far: 1 }]])).offsets.get('crank').dist >= explodeSpecs().gap);
});

// ============================ 11. inspection during an exploded view ===========
// PART INSPECTION has to work while the engine is taken apart: the panel offers
// both at once, and a click on an exploded part has to select that part. Two real
// defects showed up the moment this was measured: the framing was anchored on the
// member's own centre even when the walk volume clamps that centre elsewhere (the
// top of the valvetrain sits at z 95.6 cm against a focus ceiling of 70, which put
// the member at ndc.y 1.72 - clean off screen), and a pick is only meaningful if
// the camera pose it is measured against is the pose the inspection gave it,
// because picking re-frames.
test('inspection while exploded frames the part where the chain put it', (t) => {
  rig.reset();
  rig.update(0);
  view.explode();
  ease();
  assert.ok(view.state().fraction > 0.999, 'the inspection below runs on the fully separated assembly');
  const rect = { left: 0, top: 0, width: W, height: H };
  const asArray = (c) => (Array.isArray(c) ? c : c.toArray());
  const reframe = (anchor, range) => {
    rig.focusOn(anchor, range);
    rig.update(0);
  };
  let checked = 0;
  let picked = 0;
  let occluded = 0;
  for (const name of ['piston-cyl1', 'head-L', 'cam-R-exhaust', 'oil-pan', 'headers-L', 'crank', 'spring-cyl4-intake', 'bucket-cyl8-exhaust']) {
    const obj = view.members.get(name);
    assert.ok(obj, `${name} is not a member`);
    const pub = view.offsets.get(name);
    assert.ok(pub, `${name} has no explode rule`);
    // MEASUREMENT ORDER IS THE POINT: focusPart has to pull the member's own
    // ancestors. If the test refreshed the tree first, a ruler that forgot to do
    // so would be excused by the test's own call - so the inspection runs on the
    // tree exactly as the panel finds it, and the live box is measured afterwards.
    const r = view.focusPart(name);
    assert.ok(r, `${name} did not resolve to an inspection`);
    checked += 1;

    const live = liveBox(name); // live = where the wrapper has carried it
    const liveCentre = live.getCenter(new THREE.Vector3());
    const fit = bboxRadius(boxArray(live));
    const want = clampFocus(liveCentre);
    const anchorSphere = Math.max(...corners(live).map((c) => c.distanceTo(want)));

    // 1. the label point is the part, not the point the camera leans on
    const centre = asArray(r.centre);
    const drift = Math.hypot(liveCentre.x - centre[0], liveCentre.y - centre[1], liveCentre.z - centre[2]);
    assert.ok(drift < 1e-6, `${name}: inspection centre ${centre.map((n) => n.toFixed(2))} is ${drift.toFixed(2)} cm from the live centre ${liveCentre.toArray().map((n) => n.toFixed(2))}`);
    assert.ok(Math.abs(r.radius - fit.radius) < 0.02, `${name}: inspection radius ${r.radius} vs live bbox radius ${fit.radius.toFixed(2)}`);

    // 2. the anchor is the published walk volume applied to the part centre, and
    //    the rig really stands on it
    const got = asArray(r.anchor);
    assert.ok(Math.hypot(want.x - got[0], want.y - got[1], want.z - got[2]) < 1e-6, `${name}: anchor ${got.map((n) => n.toFixed(2))} is not clampFocus of the part centre ${liveCentre.toArray().map((n) => n.toFixed(2))}`);
    const st = rig.state();
    assert.ok(st.focus.distanceTo(want) < 1e-6, `${name}: rig focus ${st.focus.toArray().map((n) => n.toFixed(2))} vs anchor ${want.toArray().map((n) => n.toFixed(2))}`);

    // 3. the framing law runs on the ANCHOR sphere, and its answer is legal
    assert.ok(Math.abs(r.frameRadius - anchorSphere) < 0.02, `${name}: frameRadius ${r.frameRadius} vs anchor sphere ${anchorSphere.toFixed(2)}`);
    assert.ok(Math.abs(r.range - framingRange(anchorSphere)) < 0.05, `${name}: range ${r.range} is not the framing law for the anchor sphere ${anchorSphere.toFixed(2)}`);
    assert.ok(r.range >= V.distMin - EPS && r.range <= V.distMax + EPS, `${name}: range ${r.range} outside the rig limits`);
    // and it is PUBLISHED: the rig is aimed by a number the UI can read back, so a
    // control can be checked against what it commanded instead of against a guess
    assert.ok(Math.abs(view.state().frameRange - r.range) < 0.05, `${name}: state().frameRange ${view.state().frameRange} is not the range this inspection framed at (${r.range})`);
    rig.update(0);
    assert.ok(Math.abs(rig.state().dist - view.state().frameRange) < 0.05, `${name}: the rig stands at ${rig.state().dist}, the published framing range is ${view.state().frameRange}`);
    // the anchor sphere is what a frustum contains, so it is never smaller than
    // the part's own bounding sphere
    assert.ok(r.frameRadius >= r.radius - EPS, `${name}: anchor sphere ${r.frameRadius} smaller than the part radius ${r.radius}`);

    // 4. the member the inspection just framed is entirely inside the picture
    for (const c of corners(live)) {
      const n = c.project(camera);
      assert.ok(Math.abs(n.x) <= 1 && Math.abs(n.y) <= 1 && Math.abs(n.z) <= 1, `${name}: corner ${c.toArray().map((m) => m.toFixed(1))} projects to ndc ${n.x.toFixed(3)},${n.y.toFixed(3)} at range ${st.dist.toFixed(1)} - the part is not in frame`);
    }

    // 5. the panel gets the teardown information with the part
    assert.deepEqual(r.explode, { family: pub.family, stage: pub.stage, dir: pub.dir, dist: pub.dist }, `${name}: inspection does not report its explode rule`);

    // 6. picking: aim at the FACE the chain exposed (a centre is commonly behind
    //    another member, and returning the nearer member is correct raycasting,
    //    not a bug). Every pick has to be measured against the pose this part was
    //    given, because a successful pick re-frames the camera.
    const dir = new THREE.Vector3(...pub.dir);
    const out = Math.max(...corners(live).map((c) => c.clone().sub(liveCentre).dot(dir)));
    const probes = [
      liveCentre.clone().addScaledVector(dir, out * 0.5),
      new THREE.Vector3(
        Math.min(Math.max(st.eye.x, live.min.x), live.max.x),
        Math.min(Math.max(st.eye.y, live.min.y), live.max.y),
        Math.min(Math.max(st.eye.z, live.min.z), live.max.z)
      ),
      liveCentre.clone(),
    ];
    const shots = probes.map((pt) => ({ pt, ndc: pt.clone().project(camera) }));
    let mine = null;
    let other = null;
    for (const sh of shots) {
      if (Math.abs(sh.ndc.x) >= 1 || Math.abs(sh.ndc.y) >= 1) continue;
      reframe(want.toArray(), r.range);
      const hit = view.pickAt(((sh.ndc.x + 1) / 2) * W, ((1 - sh.ndc.y) / 2) * H, rect);
      if (hit?.name === name) {
        mine = hit.name;
        break;
      }
      if (hit) other = { hit: hit.name, at: sh.pt };
    }
    if (mine) {
      picked += 1;
    } else {
      assert.ok(other, `${name}: no probe point resolved to any member`);
      const eye = rig.state().eye;
      const dHit = liveBox(other.hit).distanceToPoint(eye);
      const dSelf = live.distanceToPoint(eye);
      assert.ok(dHit <= dSelf + 1e-6, `${name}: picking reported "${other.hit}" at ${dHit.toFixed(2)} cm from the eye, which is NOT in front of the part (${dSelf.toFixed(2)} cm)`);
      occluded += 1;
    }
  }
  assert.equal(checked, 8, `${checked} of 8 parts inspected`);
  assert.ok(picked >= 6, `only ${picked} of 8 exploded parts are pickable on their exposed side`);
  assert.equal(occluded, 8 - picked, 'the rest must each be an occlusion proved by distance, not a silent failure');

  view.assemble();
  ease(600);
  rig.reset();
  rig.update(0);
  assert.equal(view.state().moved, 0);
  assert.equal(fingerprint(), PRISTINE, 'inspecting an exploded assembly must not leave the tree changed');
  t.diagnostic(`exploded parts inspected ${checked}, picked on their exposed side ${picked}, honest occlusion ${occluded}`);
});

// ============================ 12. the outline stays on its part ==================
// PART INSPECTION draws an outline around the selected member. A selection box
// baked at the size and place the part had when it was picked ends up stranded
// beside the part the moment the teardown moves it - a wireframe hanging in the
// air next to the thing it labels, which is the "nothing floating apart" rule
// broken by the UI itself. So the outline is a unit box, and every frame it is
// re-fitted to the member's LIVE box.
test('inspection: the outline travels with the part through a separation and a collapse', (t) => {
  const outline = () => scene.children.find((o) => o.name === 'inspect-outline') ?? null;
  const name = 'piston-cyl1';
  const liveBoxOf = (n) => {
    const obj = view.members.get(n);
    obj.updateWorldMatrix(true, true);
    return new THREE.Box3().setFromObject(obj);
  };
  const outlineCount = () => scene.children.filter((o) => o.name === 'inspect-outline').length;
  const matched = (tag) => {
    const line = outline();
    assert.ok(line, `${tag}: PART INSPECTION has no selection outline in the scene`);
    const live = liveBoxOf(name);
    const size = live.getSize(new THREE.Vector3());
    const centre = live.getCenter(new THREE.Vector3());
    const want = [Math.max(size.x, 1e-3), Math.max(size.y, 1e-3), Math.max(size.z, 1e-3)];
    const dSize = Math.max(Math.abs(line.scale.x - want[0]), Math.abs(line.scale.y - want[1]), Math.abs(line.scale.z - want[2]));
    const dPos = Math.hypot(line.position.x - centre.x, line.position.y - centre.y, line.position.z - centre.z);
    assert.ok(dSize < 1e-6, `${tag}: outline scale ${line.scale.toArray().map((n) => n.toFixed(2))} vs live part size ${want.map((n) => n.toFixed(2))} (delta ${dSize.toFixed(3)} cm)`);
    assert.ok(dPos < 1e-6, `${tag}: outline sits ${dPos.toFixed(2)} cm from the part centre ${centre.toArray().map((n) => n.toFixed(2))}`);
    return { centre, size };
  };

  rig.reset();
  rig.update(0);
  view.assemble();
  ease(400);
  // Earlier subtests inspected parts and this unit shares ONE world, so the
  // selection has to be put away before "nobody is inspecting" is claimed.
  view.clearInspect();
  assert.equal(outlineCount(), 0, 'PART INSPECTION off left a selection outline in the scene');

  const r = view.focusPart(name);
  assert.ok(r, `${name} did not resolve to an inspection`);
  assert.equal(view.state().inspected, name);
  assert.ok(Number.isFinite(view.state().frameRange), 'an inspection framed without publishing its range');
  assert.ok(Math.abs(view.state().frameRange - r.range) < 0.05, `state().frameRange ${view.state().frameRange} vs the fit range ${r.range}`);
  const atSelect = matched('just selected, assembled engine');
  // ASSERTING SCENE OBJECTS AS SCALARS, on purpose. `assert.equal(outline(), null)`
  // or `assert.equal(outline().parent, scene)` looks harmless, but when such an
  // assertion FAILS node builds its diff with util.inspect, which walks the object's
  // .parent chain into the Scene and then the whole engine graph: measured on this
  // file, the test child ran 100+ seconds and was OOM-killed without printing one
  // subtest line, and the runner reported a bare "test failed". A count or a 0/1
  // cannot do that, so every claim about scene objects is written as one.
  assert.equal(outlineCount(), 1, 'exactly one selection outline');
  assert.equal(outline().parent === scene ? 1 : 0, 1, 'the outline belongs to the scene, never to the engine: a member of the engine would be cut by the section and picked as a part');
  assert.equal(outline().parent === engine ? 1 : 0, 0, 'the outline must not be a member of the engine');

  view.explode();
  // MID-easing, not only at the ends: an outline re-fitted only when the motion
  // settles shows up here as an outline left behind during the very motion it is
  // supposed to follow.
  let f = 0;
  for (let i = 0; i < 10; i++) {
    f = view.update(1 / 60);
    matched(`separating, fraction ${f.toFixed(3)}`);
  }
  assert.ok(f > 0.05 && f < 0.99, `the sample was not mid-motion: fraction ${f}`);
  ease(400);
  const atFull = matched('fully separated');
  const drift = atFull.centre.distanceTo(atSelect.centre);
  assert.ok(drift > 5, `the part did not actually travel (${drift.toFixed(2)} cm): the outline test would be vacuous`);
  assert.ok(Math.abs(atFull.size.x - atSelect.size.x) < 1e-6 && Math.abs(atFull.size.z - atSelect.size.z) < 1e-6, 'a member does not change size when it is moved');

  view.assemble();
  for (let i = 0; i < 10; i++) {
    f = view.update(1 / 60);
    matched(`collapsing, fraction ${f.toFixed(3)}`);
  }
  ease(400);
  const back = matched('assembled again');
  assert.ok(back.centre.distanceTo(atSelect.centre) < 1e-6, `the outline came back to ${back.centre.toArray().map((n) => n.toFixed(2))}, not to ${atSelect.centre.toArray().map((n) => n.toFixed(2))}`);
  assert.equal(outlineCount(), 1, 'following a part must not accumulate outlines');

  // CUTAWAY must not touch it either: it is not engine geometry
  view.setCutaway(true);
  matched('with the section open');
  assert.equal(outline().material.clippingPlanes === null ? 1 : 0, 1, 'the selection outline must not be sectioned with the engine');
  view.setCutaway(false);

  assert.equal(view.clearInspect(), null);
  assert.equal(outlineCount(), 0, 'PART INSPECTION off must remove the outline');
  assert.equal(view.state().inspected, null);
  assert.equal(view.state().frameRange, null, 'CLEAR left a framing range published after the inspection is gone');
  assert.equal(view.state().moved, 0, 'inspection must never leave explode wrappers behind');
  t.diagnostic(`outline followed ${name} from ${atSelect.centre.toArray().map((n) => n.toFixed(1))} to ${atFull.centre.toArray().map((n) => n.toFixed(1))} (${drift.toFixed(1)} cm) and back`);
});

// ============================== 13. spark plugs, and the spark one of them shows ===
// Row P1-G5 (issue #11): the eight spark plugs have to be real, inspectable parts
// standing on the eight published cylinder axes, and the spark they show has to be a
// LAW value - the additive tip flash is `1 - firingProgress(cyl, theta, advance)`.
// That is the product caller row P1-G3's REAL CALLER line says this tree was missing:
// the window law in src/engine/timing.js, read back through the meshes the renderer
// really builds rather than through another arithmetic test of the same function.
//
// Two silhouettes have to agree. test/support/plug-stack.mjs is the stack
// test/heads.test.mjs measures the machined channel against; the meshes this unit
// builds are what the page shows. These laws measure the DRAWN plug against the
// PUBLISHED stack, so a renderer that hand-copies a radius cannot pass - which is
// exactly the hard-coded-literal failure row P1-G5 names.
const IG = SPEC.ignition;
const P = SPEC.plug;

/** The plug unit src/main.js registers, or null in a tree that has no plug renderer. */
const plugUnit = () => units.plugs ?? null;
const plugMember = (num) => view.members.get(`plug-cyl${num}`) ?? null;
/** The additive tip glow of one plug. Named per plug, so it belongs to its member. */
const flashMesh = (num) => {
  let out = null;
  plugMember(num)?.traverse((o) => { if (o.isMesh && o.name === `plug-cyl${num}-flash`) out = o; });
  return out;
};
/** The plug's own metal and ceramic, excluding the glow: the silhouette proper. */
const plugBody = (num) => {
  const out = [];
  plugMember(num)?.traverse((o) => { if (o.isMesh && o.name !== `plug-cyl${num}-flash`) out.push(o); });
  return out;
};
/**
 * Bank-local coordinates of a world point read on one cylinder's axis frame:
 * `along` up the bore axis, `radial` off it. bankUp and bankOut both have x 0, so
 * the off-axis lateral is the world x minus the station x (see src/engine/spec.js).
 */
const plugLocal = (cyl, p) => {
  const up = new THREE.Vector3(...bankUp(cyl.bank));
  const out = new THREE.Vector3(...bankOut(cyl.bank));
  const o = bankPoint(cyl.bank, 0, 0, SPEC.block.stations[cyl.station]);
  const rel = new THREE.Vector3(p.x - o.x, p.y - o.y, p.z - o.z);
  return {
    along: rel.dot(up),
    radial: Math.hypot(rel.dot(out), p.x - SPEC.block.stations[cyl.station]),
  };
};
/**
 * Drive the flash the way the animation loop does - `update(theta, totalAdvance)` -
 * and read the opacity back off each plug's own material, never off the law.
 */
const drive = (theta, advance) => {
  units.plugs.update(theta, advance);
  return SPEC.cylinders.map((c) => flashMesh(c.num)?.material?.opacity ?? null);
};
/** The expected flash: 0 outside the burn window, 1 - progress inside it. */
const expectFlash = (cyl, theta, advance) => {
  const p = firingProgress(cyl, theta, advance);
  return p < 0 ? 0 : 1 - p;
};

test('plugs: eight inspectable parts on the eight cylinder axes, ruled in the teardown table', (t) => {
  const unit = plugUnit();
  assert.ok(unit, 'the engine has no spark-plug unit: src/render/plugs.js and its registration in src/main.js are the part of this row that has to be written');
  assert.equal(unit.group.name, 'plugs', 'the plug assembly needs a name, or buildMembers cannot see it as an assembly and its plugs are not members');
  const st = plugStack();
  for (const c of SPEC.cylinders) {
    const name = `plug-cyl${c.num}`;
    const m = plugMember(c.num);
    assert.ok(m, `${name} is not a member of the assembly, so it can be neither inspected nor exploded`);
    const body = plugBody(c.num);
    assert.ok(body.length >= st.segs.length, `${name} draws ${body.length} meshes for ${st.segs.length} published segments - every published segment has to be drawn`);
    const tris = body.reduce((n, o) => n + (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3, 0);
    assert.ok(tris >= 200, `${name} carries ${tris} triangles - a part with no real triangles is inspectable in name only`);
    const r = explodeRuleFor(name);
    assert.ok(r, `${name} is not ruled in the teardown table, so it cannot leave with the engine it is screwed into`);
    const lbl = partLabel(name);
    assert.notEqual(lbl, name, `${name} carries no human label, and an unlabelled member is dropped from the inspection menu`);
    assert.ok(/plug/i.test(lbl), `partLabel("${name}") reads "${lbl}" - it has to name a spark plug`);
    assert.ok(lbl.includes(`cylinder ${c.num}`), `partLabel("${name}") reads "${lbl}" - it has to name the cylinder it belongs to`);
  }
  const menu = view.inspectables().filter((i) => /^plug-cyl\d+$/.test(i.name));
  assert.equal(menu.length, SPEC.cylinders.length, `the inspection menu offers ${menu.length} spark plugs for ${SPEC.cylinders.length} cylinder axes`);
  // a menu entry has to resolve through the same path the user clicks
  for (const num of [1, 6]) {
    const r = view.focusPart(`plug-cyl${num}`);
    assert.ok(r, `plug-cyl${num} did not resolve to an inspection`);
    assert.equal(view.state().inspected, `plug-cyl${num}`);
  }
  view.clearInspect();
  t.diagnostic(`${menu.length} plugs inspectable; the drawn stack spans along ${st.bottom.toFixed(2)}..${st.top.toFixed(2)} cm on every one of the ${SPEC.cylinders.length} axes`);
});

test('plugs: the drawn plug stands inside the published silhouette and draws every published segment', (t) => {
  const unit = plugUnit();
  assert.ok(unit, 'no plug unit, so there is no drawn silhouette to compare with the published one');
  const st = plugStack();
  const reach = new Map(); // segment name -> widest radius the renderer really drew there
  let widest = 0;
  let worstHeight = 0, worstRadius = 0;
  for (const c of SPEC.cylinders) {
    const body = plugBody(c.num);
    assert.ok(body.length > 0, `plug-cyl${c.num} has no body meshes`);
    const v = new THREE.Vector3();
    for (const o of body) {
      // A drawn mesh is judged against the segment it publishes in userData,
      // never against whichever segment happens to cover its Float32 height: the
      // shell's published band ends at 25.600 and the thread's starts there, and
      // a vertex of the thread at that shared face reads 25.599999831614 in a
      // Float32Array (measured, tmp/c11-probe2.mjs). Judged by its own published
      // segment that vertex is 1.7e-7 cm off; judged by stackRadius it falls into
      // the neighbour's narrower 0.58 cm band and the law calls a correct thread
      // fatter than the bore. The mesh's own segment is the number the renderer
      // was given, so it is the number the drawing has to answer to.
      const name = /^plug-cyl\d+-(\w+)$/.exec(o.name)?.[1];
      assert.ok(name, `mesh "${o.name}" is not named after a plug segment`);
      const seg = st.segs.find((s) => s.name === name);
      assert.ok(seg, `mesh "${o.name}" is named after segment "${name}", which SPEC.plug does not publish`);
      assert.equal(o.userData.segment, seg.name, `mesh "${o.name}" publishes segment "${o.userData.segment}" while its name says "${seg.name}"; a law that measures a drawn part has to be told which published row it is reading`);
      o.updateWorldMatrix(true, false);
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        const { along, radial } = plugLocal(c, v);
        assert.ok(seg.a0 - GEO_EPS <= along && along <= seg.a1 + GEO_EPS, `plug-cyl${c.num} mesh "${o.name}" has a vertex at along ${along.toFixed(9)} cm outside the published band ${seg.a0}..${seg.a1} cm of segment "${seg.name}" (worst vertex ${worstHeight.toExponential(3)} cm off a band edge) - the plug is longer, shorter or placed elsewhere than the numbers the channel law measures`);
        const at = Math.min(Math.max(along, seg.a0), seg.a1);
        const need = segRadius(seg, at);
        assert.ok(radial <= need + GEO_EPS, `plug-cyl${c.num} mesh "${o.name}" stands ${radial.toFixed(9)} cm off the cylinder axis at along ${along.toFixed(9)} cm, where its own segment "${seg.name}" is published ${need.toFixed(4)} cm wide (worst vertex ${worstRadius.toExponential(3)} cm too fat) - the drawn plug is fatter than the bore the channel law measures`);
        worstHeight = Math.max(worstHeight, Math.max(seg.a0 - along, along - seg.a1));
        worstRadius = Math.max(worstRadius, radial - need);
        reach.set(seg.name, Math.max(reach.get(seg.name) ?? 0, radial));
        if (radial > widest) widest = radial;
      }
    }
  }
  // every published segment is actually there, at its published radius
  for (const s of st.segs) {
    const got = reach.get(s.name);
    assert.ok(got !== undefined, `segment "${s.name}" (${s.a0.toFixed(2)}..${s.a1.toFixed(2)} cm) is published but nothing was drawn in its height band`);
    assert.ok(got >= s.r - GEO_EPS, `segment "${s.name}" was drawn ${got.toFixed(9)} cm wide against its published ${s.r.toFixed(4)} cm`);
  }
  const hex = st.segs.find((s) => s.name === 'hex');
  assert.ok(Math.abs(widest - hex.r) <= GEO_EPS, `the widest point of the drawn plug is ${widest.toFixed(9)} cm; the published hex corner radius ${hex.r} has to be the widest part of a spark plug`);
  t.diagnostic(`drawn-vs-published worst vertex errors over ${st.segs.length * SPEC.cylinders.length} segment meshes: ${worstHeight.toExponential(3)} cm of height (Float32 buffer step at these radii), ${worstRadius.toExponential(3)} cm of radius, both inside the ${GEO_EPS} cm geometry tolerance`);
  t.diagnostic(`silhouette: ${st.segs.length} segments drawn on ${SPEC.cylinders.length} plugs, widest ${widest.toFixed(4)} cm (hex corner), stack ${st.bottom.toFixed(2)}..${st.top.toFixed(2)} cm off the ${PLUG_BOSS_A} cm boss face`);
});

/** All eight tip opacities after one drive of the plug unit at this pose. */
const flashMap = (theta, advance) => {
  const list = drive(theta, advance);
  const out = new Map();
  SPEC.cylinders.forEach((c, i) => {
    const v = list[i];
    assert.ok(typeof v === 'number', `plug-cyl${c.num} hands back ${v} instead of a tip opacity: there is no plug-cyl${c.num}-flash mesh with a material for update(theta, advance) to write, so no pose of this law can be read`);
    out.set(c.num, v);
  });
  return out;
};
/** One tip's opacity at `cyc` crank degrees off its own cylinder's power TDC. */
const tipAt = (cyl, cyc, advance) => flashMap(wrap720(cyl.powerTDC + cyc), advance).get(cyl.num);
const LIT = (v) => (v ?? 0) > 1e-12;
/** World point of one cylinder's spark gap: the published bottom of its stack. */
const gapPoint = (cyl) => {
  const p = bankPoint(cyl.bank, plugStack().bottom, 0, SPEC.block.stations[cyl.station]);
  return new THREE.Vector3(p.x, p.y, p.z);
};
/**
 * Bisection on the DRAWN flash: the cycle position where one tip crosses between
 * dark and lit. 60 halvings land far under a thousandth of a degree, so the arc
 * below is a measured crank width and not a counted number of samples.
 */
const tipEdge = (cyl, advance, lo, hi) => {
  let a = lo, b = hi;
  const la = LIT(tipAt(cyl, a, advance));
  assert.notEqual(la, LIT(tipAt(cyl, b, advance)), `cyl ${cyl.num} reads ${la ? 'lit' : 'dark'} at both ${lo} and ${hi} degrees off its power TDC, so its burn window does not cross this bracket`);
  for (let i = 0; i < 60; i++) {
    const m = (a + b) / 2;
    if (LIT(tipAt(cyl, m, advance)) === la) a = m;
    else b = m;
  }
  return (a + b) / 2;
};
/** The lit arc of one plug at one live advance, measured off its own tip. */
const tipArc = (cyl, advance) => {
  const open = tipEdge(cyl, advance, -advance - 1, -advance + 1);
  const close = tipEdge(cyl, advance, IG.burnDeg - 1, IG.burnDeg + 1);
  return { open, close, arc: close - open };
};
/** A crank pose where no tip is burning, so a law can hand the tree back clean. */
const darkPose = (advance) => {
  for (let theta = 0; theta < 720; theta++) {
    if (![...flashMap(theta, advance).values()].some(LIT)) return theta;
  }
  return null;
};
const resetFlash = (advance = IG.baseDeg) => {
  const theta = darkPose(advance);
  assert.ok(theta !== null, `no crank pose leaves every tip dark at advance ${advance}: ${SPEC.cylinders.length} burn windows would cover the whole 720 degree cycle`);
  units.plugs.update(theta, advance);
};

test('plugs: the tip flash is 1 - firingProgress over the published burn window, bracketed at both ends', (t) => {
  const unit = plugUnit();
  assert.ok(unit, 'the engine has no spark-plug unit, so no tip can flash: src/render/plugs.js and its registration in src/main.js are what this row still needs');
  assert.ok(typeof unit?.update === 'function', 'the plug unit has to hand back update(theta, advance): src/main.js is the product caller row P1-G5 names, and it poses the plugs through it');
  assert.ok(Number.isFinite(P.glowR), 'SPEC.plug.glowR is not published: a tip glow would then be a radius the renderer invented, which is the hard-coded literal this row exists to prevent');
  const rows = [];
  for (const [rpm, load] of [[100, 100], [3200, 100], [100, 0], [4000, 0]]) {
    const adv = totalAdvance(rpm, load);
    const want = adv + IG.burnDeg;
    for (const num of [1, 6]) { // one plug out of each bank: SPEC.banks.L.cyls and SPEC.banks.R.cyls
      const cyl = SPEC.cylinders.find((c) => c.num === num);
      const { open, close, arc } = tipArc(cyl, adv);
      assert.ok(Math.abs(arc - want) <= 1e-6, `cyl ${num} at rpm ${rpm} at ${load} % throttle keeps its tip lit for ${arc.toFixed(4)} crank degrees; the published window is total advance ${adv.toFixed(4)} + burn ${IG.burnDeg} = ${want.toFixed(4)}`);
      assert.ok(Math.abs(open + adv) <= 1e-6, `cyl ${num} opens its flash at ${open.toFixed(4)} degrees off power TDC; the window has to open at the spark instant, ${adv.toFixed(4)} degrees before TDC`);
      assert.ok(Math.abs(close - IG.burnDeg) <= 1e-6, `cyl ${num} closes its flash at ${close.toFixed(4)} degrees off power TDC; it has to close ${IG.burnDeg} crank degrees after power TDC`);
      // The grid stands on the PUBLISHED window, not on the bisected edges: a
      // bisection converges onto the flip from the dark side, so its `open` is a
      // hair before the spark and a sample sitting exactly there is legitimately
      // dark. open/close above are what gate where the tip really flips; this grid
      // gates what the tip reads at the poses the ignition law publishes.
      const seen = [];
      for (let i = 0; i <= 40; i++) {
        const f = i / 40;
        const cyc = -adv + f * arc;
        const got = tipAt(cyl, cyc, adv);
        const need = expectFlash(cyl, wrap720(cyl.powerTDC + cyc), adv);
        assert.ok(Math.abs(got - need) <= 1e-12, `cyl ${num} at ${Math.round(f * 100)} % of its window (${cyc.toFixed(4)} deg off power TDC): the material reads ${got} and firingProgress says ${need}; the contract is opacity = 1 - progress`);
        seen.push(got);
      }
      assert.ok(Math.abs(seen[0] - 1) <= 1e-9, `at the instant its spark fires cyl ${num} reads ${seen[0]} of flash; firingProgress is 0 there, so the tip owes full brightness`);
      assert.ok(seen[seen.length - 1] <= 1e-9, `at the end of its window cyl ${num} still reads ${seen[seen.length - 1]}; progress is 1 there, so the tip has to be dark again`);
      for (let i = 1; i < seen.length; i++) assert.ok(seen[i] <= seen[i - 1] + EPS, `cyl ${num} does not decay monotonically inside its window: ${seen[i - 1]} followed by ${seen[i]}`);
      for (const cyc of [open - 0.25, close + 0.25, 90, 180, 300, 450, 600]) {
        assert.equal(tipAt(cyl, cyc, adv), 0, `cyl ${num} shows flash at ${cyc.toFixed(2)} degrees off its power TDC, outside its window: firingProgress is -1 there, and a glow that never goes dark is not a spark`);
      }
      rows.push(`rpm ${rpm} at ${load} %: advance ${adv.toFixed(3)} -> ${arc.toFixed(3)} deg lit (cyl ${num})`);
    }
  }
  t.diagnostic(`burn window measured off the drawn tips: ${rows.join('; ')}; published burnDeg ${IG.burnDeg}, total-advance clamp ${IG.maxTotalDeg}`);
  resetFlash();
});

test('plugs: every cylinder sparks once per 720 in the published order 90 degrees apart, and never two tips at once', (t) => {
  const unit = plugUnit();
  assert.ok(unit, 'no spark-plug unit, so there is no tip whose firing can be read: src/render/plugs.js is still missing');
  assert.ok(typeof unit?.update === 'function', 'the plug unit needs update(theta, advance) before its flash can be swept pose by pose');
  const ORDER = firingOrder();
  const SPACING = 720 / SPEC.cylinders.length; // crank degrees between successive sparks
  const anchors = [];
  for (const [rpm, load] of [[1600, 50], [4000, 0], [100, 100]]) {
    const state = createEngineState({ rpm, throttle: load, running: true });
    const sparked = new Map(); // cyl -> {at, n, min, max}: the anchor src/engine/animation.js emits
    state.onFire((cyl, at) => {
      const s = sparked.get(cyl.num) ?? { at, n: 0, min: at, max: at };
      s.n += 1;
      s.min = Math.min(s.min, at);
      s.max = Math.max(s.max, at);
      sparked.set(cyl.num, s);
    });
    const degFrame = (rpm * 6) / 60; // the crank travel one 60 fps frame hands the state
    const frames = Math.ceil((2 * 720 + IG.maxTotalDeg) / degFrame) + 1;
    for (let i = 0; i < frames; i++) state.step(1 / 60);
    const travelled = frames * degFrame;
    assert.equal(sparked.size, SPEC.cylinders.length, `the run sparked ${sparked.size} distinct cylinders while ${SPEC.cylinders.length} axes stand on the block`);
    const counts = [];
    for (const c of SPEC.cylinders) {
      const s = sparked.get(c.num);
      assert.ok(s, `cyl ${c.num} never sparked in ${travelled.toFixed(0)} crank degrees at rpm ${rpm} - its plug would be decoration`);
      assert.ok(s.n >= 2, `cyl ${c.num} sparked ${s.n} time(s) in ${travelled.toFixed(0)} crank degrees: more than two cycles have to deliver more than one spark`);
      assert.ok(s.max - s.min <= 1e-9, `cyl ${c.num} is fired between ${s.min.toFixed(6)} and ${s.max.toFixed(6)}: a cylinder fired once per 720 has one fixed cycle position`);
      const want = sparkAngle(c, rpm, load);
      const err = Math.min(Math.abs(s.at - want), 720 - Math.abs(s.at - want));
      assert.ok(err <= 1e-9, `cyl ${c.num} is fired at crank ${s.at.toFixed(6)}; sparkAngle() publishes ${want.toFixed(6)} for rpm ${rpm} at ${load} %`);
      counts.push(s.n);
    }
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `sparks per cylinder read ${counts.join(' / ')} over ${travelled.toFixed(0)} crank degrees: the partial cycle a run starts in may cost one spark, never more`);
    const order = [...sparked.keys()].sort((a, b) => sparked.get(a).at - sparked.get(b).at);
    const gaps = order.map((num, i) => wrap720(sparked.get(order[(i + 1) % order.length]).at - sparked.get(num).at + 720));
    for (const g of gaps) assert.ok(Math.abs(g - SPACING) <= 1e-9, `successive sparks stand ${g.toFixed(6)} crank degrees apart; ${SPEC.cylinders.length} sparks in one 720 degree cycle stand ${SPACING} apart`);
    const published = [...ORDER.cyls];
    const shift = published.indexOf(order[0]);
    assert.ok(shift >= 0, `the cylinders fired in the order ${order.join('-')}, which is not a rotation of the published ${published.join('-')}`);
    const rotated = published.slice(shift).concat(published.slice(0, shift));
    assert.deepEqual(order, rotated, `the anchors come in ${order.join('-')} where the published order rotated to this run is ${rotated.join('-')}`);
    anchors.push(`rpm ${rpm} at ${load} %: ${order.join('-')} every ${SPACING} deg`);
  }
  // the arithmetic the mesh reading below is the control on
  const widestArc = IG.maxTotalDeg + IG.burnDeg;
  assert.ok(widestArc < SPACING, `the widest legal window is the total-advance clamp ${IG.maxTotalDeg} + burn ${IG.burnDeg} = ${widestArc} crank degrees against ${SPACING} degrees of spark spacing: two plugs would burn at the same time`);
  const sweeps = [];
  for (const [rpm, load] of [[4000, 0], [100, 100]]) {
    const adv = totalAdvance(rpm, load);
    const arc = adv + IG.burnDeg;
    // seeded one pose before the sweep so a window running across the 720 seam
    // counts as the one cyclic burn it is
    const seed = flashMap(719, adv);
    const was = new Map(SPEC.cylinders.map((c) => [c.num, LIT(seed.get(c.num))]));
    const runs = new Map(SPEC.cylinders.map((c) => [c.num, 0]));
    let maxLit = 0, minLit = SPEC.cylinders.length;
    for (let theta = 0; theta < 720; theta++) {
      const m = flashMap(theta, adv);
      let lit = 0;
      for (const c of SPEC.cylinders) {
        const on = LIT(m.get(c.num));
        if (on) {
          lit++;
          if (!was.get(c.num)) runs.set(c.num, runs.get(c.num) + 1);
        }
        was.set(c.num, on);
      }
      if (lit > maxLit) maxLit = lit;
      if (lit < minLit) minLit = lit;
    }
    assert.equal(maxLit, 1, `at rpm ${rpm} at ${load} % throttle ${maxLit} tips are lit at once somewhere in the cycle; a ${arc.toFixed(3)} degree window inside ${SPACING} degrees of spacing has to leave every pose to one plug`);
    assert.equal(minLit, 0, `every one of the 720 poses shows a lit tip at rpm ${rpm}: ${arc.toFixed(3)} deg x ${SPEC.cylinders.length} plugs would cover the whole cycle, which is the failure row P1-G3 was written to repair`);
    for (const c of SPEC.cylinders) assert.equal(runs.get(c.num), 1, `cyl ${c.num} lights ${runs.get(c.num)} separate times in one 720 degree cycle at rpm ${rpm}: it is fired once per cycle, so its tip burns exactly once`);
    sweeps.push(`rpm ${rpm} at ${load} %: ${maxLit} tip lit at most, ${minLit} poses dark, window ${arc.toFixed(3)}`);
  }
  t.diagnostic(`firing anchors read off state.onFire: ${anchors.join('; ')}; tip sweeps ${sweeps.join('; ')}; published order ${ORDER.cyls.join('-')} at ${ORDER.angles.join('-')}`);
  resetFlash();
});

test('plugs: the published tip glow keeps its clearance at every pose it can be lit at', (t) => {
  const unit = plugUnit();
  assert.ok(unit, 'no spark-plug unit: there is no tip glow to measure against the engine');
  assert.ok(Number.isFinite(P.glowR), 'SPEC.plug.glowR is not published: a clearance law needs a published radius, not a renderer literal');
  const glow = flashMesh(1);
  assert.ok(glow, 'plug-cyl1 draws no plug-cyl1-flash mesh: the additive tip glow row P1-G5 asks for is still undrawn');
  const st = plugStack();
  const cyl1 = SPEC.cylinders.find((c) => c.num === 1);
  const centre = gapPoint(cyl1);
  glow.updateWorldMatrix(true, false);
  const pos = glow.geometry.attributes.position;
  assert.ok(pos.count >= 40, `the glow mesh carries ${pos.count} vertices - a tip glow is a real surface or it is a sprite`);
  const v = new THREE.Vector3();
  let near = Infinity, far = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const d = v.fromBufferAttribute(pos, i).applyMatrix4(glow.matrixWorld).distanceTo(centre);
    if (d < near) near = d;
    if (d > far) far = d;
  }
  // Float32 buffers again: the drawn sphere really stands 0.399999991256..
  // 0.400000018442 cm off the gap (measured, tmp/c11-probe1.mjs) because the
  // geometry's positions are Float32 - the same 8.7e-9 and 1.8e-8 quantization
  // every other drawn mesh in this file carries. GEO_EPS covers it; the law still
  // refuses a glow that is not the published radius.
  assert.ok(Math.abs(near - P.glowR) <= GEO_EPS && Math.abs(far - P.glowR) <= GEO_EPS, `the drawn glow stands ${near.toFixed(12)}..${far.toFixed(12)} cm from cyl 1's spark gap at the stack bottom ${st.bottom.toFixed(2)} cm off the boss face, where SPEC.plug.glowR publishes ${P.glowR} cm`);
  // A glow only exists inside a burn window, so the poses that bind are the union of
  // every window the advance law can deliver: cycle 720-advance..720 plus 0..burnDeg
  // across advance base..maxTotalDeg, sampled every 0.25 crank degrees.
  const win = [];
  for (let c = 720 - IG.maxTotalDeg; c < 720; c += 0.25) win.push(c);
  for (let c = 0; c <= IG.burnDeg; c += 0.25) win.push(c);
  const ct = createCranktrain(materials);
  const vt = createValvetrain(materials);
  // Obstacles are named parts of the cranktrain and the valvetrain, and a named
  // casting shell: the plug's own triangles are never among them, because a part
  // measured against itself always reads zero.
  const named = (root, re) => {
    const out = [];
    root.traverse((o) => { if (o.isMesh && re.test(o.name)) out.push(o); });
    return out;
  };
  /**
   * Triangle records kept in the mesh's OWN space. The probe is carried into the
   * mesh instead of the triangles out into the world: a rigid transform preserves
   * distance, so each triangle's plane form is built once for the whole pose sweep
   * rather than once per pose.
   */
  const localTris = (mesh) => {
    const geo = mesh.geometry, p = geo.attributes.position, ix = geo.index, out = [];
    const at = (k) => new THREE.Vector3().fromBufferAttribute(p, k);
    const n = ix ? ix.count : p.count;
    for (let j = 0; j < n; j += 3) {
      const a = at(ix ? ix.getX(j) : j);
      const b = at(ix ? ix.getX(j + 1) : j + 1);
      const c = at(ix ? ix.getX(j + 2) : j + 2);
      const nn = b.clone().sub(a).cross(c.clone().sub(a));
      const len2 = nn.lengthSq();
      if (len2 < 1e-12) continue;
      out.push({ a, b, c, n: nn, len2, d0: nn.dot(a), label: mesh.name });
    }
    return out;
  };
  const castShell = engineTriangles(materials, { units: ['block', 'heads', 'manifolds'] });
  assert.ok(castShell.tris.length > 20000, `the casting-only shell holds ${castShell.tris.length} triangles - the law would measure nothing`);
  const inv = new THREE.Matrix4();
  const lp = new THREE.Vector3();
  let anim = { d: Infinity }, cast = { d: Infinity };
  for (const cyl of SPEC.cylinders) {
    const obstacles = [
      ...named(ct.group, new RegExp(`^piston-cyl${cyl.num}-body$`)),
      ...named(vt.group, new RegExp(`^valve-cyl${cyl.num}-(intake|exhaust)-head$`)),
    ];
    assert.equal(obstacles.length, 3, `cyl ${cyl.num} handed the glow ${obstacles.length} animated obstacles instead of its piston body plus its two valve heads`);
    const sets = obstacles.map((m) => ({ mesh: m, tris: localTris(m) }));
    const g = gapPoint(cyl);
    for (const cycle of win) {
      const theta = wrap720(cyl.powerTDC + cycle);
      ct.update(theta);
      vt.update(theta);
      for (const { mesh, tris } of sets) {
        mesh.updateWorldMatrix(true, false);
        inv.copy(mesh.matrixWorld).invert();
        lp.copy(g).applyMatrix4(inv);
        for (const tr of tris) {
          const d = distToTriangle(tr, lp);
          if (d < anim.d) anim = { d, cycle: +cycle.toFixed(2), who: tr.label, cyl: cyl.num };
        }
      }
    }
    const cc = triDistance(castShell, [g.x, g.y, g.z]);
    if (cc.d < cast.d) cast = { d: cc.d, who: cc.who, cyl: cyl.num };
  }
  assert.ok(anim.who && cast.who, 'the glow clearance sweep found no obstacle at all - it measured an empty obstacle set');
  const airAnim = anim.d - P.glowR;
  const airCast = cast.d - P.glowR;
  assert.ok(airAnim >= P.clr - 1e-9, `cyl ${anim.cyl}'s glow stands ${anim.d.toFixed(4)} cm from ${anim.who} at cycle ${anim.cycle} while it is lit: a sphere of radius ${P.glowR} leaves ${airAnim.toFixed(4)} cm and SPEC.plug.clr publishes ${P.clr}`);
  assert.ok(airCast >= P.clr - 1e-9, `cyl ${cast.cyl}'s glow stands ${cast.d.toFixed(4)} cm from the casting part ${cast.who}: a sphere of radius ${P.glowR} leaves ${airCast.toFixed(4)} cm against ${P.clr}`);
  const binding = Math.min(anim.d, cast.d);
  const ceiling = binding - P.clr;
  assert.ok(P.glowR >= P.electrode.rTip, `SPEC.plug.glowR ${P.glowR} is under the electrode tip radius ${P.electrode.rTip} it is meant to cover: a glow smaller than the live end does not show the spark`);
  assert.ok(P.glowR <= ceiling + 1e-9, `SPEC.plug.glowR ${P.glowR} is over the ceiling the lit poses allow: the binding air while lit is ${binding.toFixed(4)} cm minus clr ${P.clr} = ${ceiling.toFixed(4)} cm`);
  t.diagnostic(`glow ${P.glowR} cm on the gap point at ${st.bottom.toFixed(2)} cm off the boss face, over ${win.length} lit poses per cylinder; tightest while lit ${anim.d.toFixed(4)} cm to ${anim.who} (cyl ${anim.cyl}, cycle ${anim.cycle}) and ${cast.d.toFixed(4)} cm to ${cast.who} (cyl ${cast.cyl}); keeps ${airAnim.toFixed(4)} cm / ${airCast.toFixed(4)} cm against clr ${P.clr}; published band ${P.electrode.rTip}..${ceiling.toFixed(4)}`);
});

test('plugs: every tip owns its own material, and the flash reads correctly in CUTAWAY and in EXPLODED', (t) => {
  const unit = plugUnit();
  assert.ok(unit, 'no spark-plug unit, so CUTAWAY and EXPLODED have nothing to act on');
  const tips = SPEC.cylinders.map((c) => {
    const f = flashMesh(c.num);
    assert.ok(f, `plug-cyl${c.num} has no plug-cyl${c.num}-flash mesh`);
    return f;
  });
  const plain = new Set(tips.map((f) => f.material));
  assert.equal(plain.size, SPEC.cylinders.length, `${tips.length} tips share ${plain.size} material object: viewControls sections materials by NAME, so one shared spark material means one shared opacity and every plug lights when any one fires`);
  for (const f of tips) {
    assert.ok(String(f.material.name).startsWith('spark'), `the tip material is named "${f.material.name}"; the published flash family is M.spark in src/render/materials.js`);
    assert.equal(f.material.transparent, true, `tip material "${f.material.name}" is not transparent, so an opacity of 0 would not read as dark`);
    assert.equal(f.material.depthWrite, false, `tip material "${f.material.name}" writes depth: an additive glow must not occlude the parts it glows over`);
    assert.equal(f.material.blending, THREE.AdditiveBlending, `tip material "${f.material.name}" blends as ${f.material.blending} instead of AdditiveBlending`);
  }
  // one pose with cyl 1 comfortably inside its own window, in the middle of the burn
  const adv = totalAdvance(1600, 50);
  const cyl1 = SPEC.cylinders.find((c) => c.num === 1);
  const off = -adv / 2;
  const theta = wrap720(cyl1.powerTDC + off);
  const want1 = expectFlash(cyl1, theta, adv);
  assert.ok(LIT(want1), `the pose this law chose (${off.toFixed(3)} deg before cyl 1's power TDC at advance ${adv.toFixed(3)}) is not inside its window: the law says ${want1}`);
  // ---- assembled ----
  rig.reset();
  rig.update(0);
  view.assemble();
  ease(600);
  drive(theta, adv);
  // Names are per plug, not shared: viewControls' sectionClone keys its private
  // cutaway clone on the material NAME, so eight tips called "spark" would get one
  // clone and therefore one opacity. The law gates that each tip belongs to the
  // published spark family AND that no two tips carry the same name.
  const assembledNames = new Set();
  const builtWith = tips.map((f) => f.material); // the exact object each tip was built with
  for (const f of tips) {
    const nm = String(f.material.name);
    assert.ok(/^spark/.test(nm) && nm !== 'spark', `assembled, the tip material is named "${nm}"; it has to belong to the published spark family (M.spark in src/render/materials.js) and carry its own name, because a cutaway clone is keyed on that name`);
    assembledNames.add(nm);
  }
  assert.equal(assembledNames.size, tips.length, `the ${tips.length} assembled tips carry ${assembledNames.size} distinct names: tips sharing a name share one sectioned clone, and with it one opacity`);
  assert.ok(Math.abs(flashMesh(1).material.opacity - want1) <= 1e-12, `assembled cyl 1 reads ${flashMesh(1).material.opacity} at ${off.toFixed(3)} degrees before its power TDC, where firingProgress says ${want1}`);
  // ---- CUTAWAY ----
  assert.equal(view.setCutaway(true), true, 'the cutaway did not switch on');
  const plane = view.state().cutawayPlane;
  assert.ok(plane, 'a cutaway has to publish its plane before a plug can be sectioned by it');
  // The published plane is a snapshot (src/ui/viewControls.js state() hands back
  // {normal: [...], constant}), while a material carries the live THREE.Plane the
  // renderer clips with, so the gate is on the numbers: the tip has to be cut by a
  // plane whose normal and constant are the ones this view published, and an
  // identity test between a snapshot and a live object would never hold for any
  // part in the tree.
  const onPublishedPlane = (m) => {
    const cp = m.clippingPlanes?.[0];
    if (!cp) return false;
    const n = cp.normal.toArray();
    return n.every((k, i) => Math.abs(k - plane.normal[i]) <= EPS) && Math.abs(cp.constant - plane.constant) <= EPS;
  };
  let byThisPlane = 0;
  for (const f of tips) {
    const m = f.material;
    assert.ok(String(m.name).endsWith(':sectioned'), `in CUTAWAY the tip "${f.name}" is drawn with "${m.name}" instead of a sectioned clone of its own spark material: the glow would hang in the scene as an unsectioned blob`);
    assert.equal(m.side, THREE.DoubleSide, `the sectioned tip material "${m.name}" is single-sided; a cutaway has to render the inside of what it cuts`);
    assert.ok(m.clippingPlanes?.length >= 1, `sectioned tip material "${m.name}" carries no clipping plane, so the cutaway does not cut it`);
    if (onPublishedPlane(m)) byThisPlane++;
  }
  assert.equal(byThisPlane, tips.length, `${byThisPlane} of ${tips.length} sectioned tips are clipped by the plane the view published`);
  drive(theta, adv); // the frame src/main.js would paint after the material swap
  const cut = flashMesh(1).material;
  assert.ok(Math.abs(cut.opacity - want1) <= 1e-12, `in CUTAWAY cyl 1's tip reads ${cut.opacity} at the same pose, where firingProgress says ${want1}: a flash captured on a material reference instead of written through mesh.material stays dark in a section, and this is exactly the case the published contract names`);
  const sections = new Set(tips.map((f) => f.material));
  assert.equal(sections.size, tips.length, `CUTAWAY handed ${tips.length} tips ${sections.size} sectioned material: a sectionClone keyed on one shared name gives every tip the same opacity`);
  assert.equal(view.setCutaway(false), false, 'the cutaway did not switch off');
  for (const [i, f] of tips.entries()) {
    const nm = String(f.material.name);
    assert.ok(f.material === builtWith[i], `after the cutaway the tip "${f.name}" carries "${nm}" of a material this plug was not built with: the view has to restore the per-tip material it swapped, not another plug's`);
    assert.ok(/^spark/.test(nm), `after the cutaway the tip "${f.name}" is restored onto "${nm}", outside the published spark family`);
  }
  drive(theta, adv);
  assert.ok(Math.abs(flashMesh(1).material.opacity - want1) <= 1e-12, 'after the cutaway the flash has to follow firingProgress again on the restored material');
  // ---- EXPLODED ----
  view.explode();
  ease();
  assert.ok(view.state().fraction > 0.999, 'the fully separated state has to be reached before the glow is read in it');
  const dirs = new Map();
  for (const c of SPEC.cylinders) {
    const name = `plug-cyl${c.num}`;
    const o = view.offsets.get(name);
    assert.ok(o, `${name} carries no explode offset, so it cannot leave the head it is threaded into`);
    const rule = explodeRuleFor(name);
    const headName = `head-${partBank(name)}`;
    const headRule = explodeRuleFor(headName);
    assert.ok(headRule, `${headName} carries no rule, so a plug cannot be required to travel with it`);
    assert.equal(rule.family, headRule.family, `${name} leaves in family "${rule.family}" while the head it is screwed into, ${headName}, leaves in "${headRule.family}"`);
    assert.equal(rule.stage, headRule.stage, `${name} stands at stage ${rule.stage} of ${rule.family} where its head ${headName} stands at stage ${headRule.stage}: a plug threaded into a head has to come off with it`);
    assert.ok(o.dist > 0, `${name} is ruled but travelled ${o.dist} cm`);
    const dir = dirs.get(rule.family) ?? explodeDirection(rule.family);
    dirs.set(rule.family, dir);
    const f = flashMesh(c.num);
    assert.ok(f, `${name} lost its glow while exploded`);
    f.updateWorldMatrix(true, false);
    const p = f.geometry.attributes.position;
    const vv = new THREE.Vector3();
    const lo = { x: Infinity, y: Infinity, z: Infinity }, hi = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (let i = 0; i < p.count; i++) {
      vv.fromBufferAttribute(p, i).applyMatrix4(f.matrixWorld);
      for (const k of ['x', 'y', 'z']) {
        if (vv[k] < lo[k]) lo[k] = vv[k];
        if (vv[k] > hi[k]) hi[k] = vv[k];
      }
    }
    const mid = new THREE.Vector3((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, (lo.z + hi.z) / 2);
    // A teardown does two things at once: src/ui/viewControls.js apply() writes
    // dir * dist * fraction on each member wrapper AND engine.position.z =
    // engineHomeZ + lift * fraction on the root, because the whole separated
    // chain is hoisted clear of the stand mounts (row P1-G4's mount law). The
    // published spark gap is a point in the INSTALLED tree, so the exploded glow
    // has to answer to its own member offset plus the hoist the root carries, and
    // a law that credits only the member offset measures the plug 34.25 cm short
    // of where the view actually puts it.
    const vs = view.state();
    const moved = gapPoint(c)
      .addScaledVector(new THREE.Vector3(...dir), o.dist * vs.fraction)
      .addScaledVector(new THREE.Vector3(0, 0, 1), vs.lift * vs.fraction);
    assert.ok(mid.distanceTo(moved) <= GEO_EPS, `${name} carries its glow centre to ${mid.toArray().map((n) => n.toFixed(3)).join(', ')} while exploded; its published spark gap plus its own ${o.dist.toFixed(2)} cm along family ${rule.family} and the ${vs.lift.toFixed(2)} cm hoist the view publishes travel it to ${moved.toArray().map((n) => n.toFixed(3)).join(', ')}`);
    for (const k of ['x', 'y', 'z']) {
      const r = (hi[k] - lo[k]) / 2;
      assert.ok(Math.abs(r - P.glowR) <= GEO_EPS, `${name}'s glow is ${r.toFixed(9)} cm across along ${k} while exploded, against the published radius ${P.glowR}: a teardown moves a plug, it does not resize its glow`);
    }
  }
  drive(theta, adv); // the loop still poses the plugs in the exploded state
  for (const c of SPEC.cylinders) {
    const got = flashMesh(c.num).material.opacity;
    const need = expectFlash(c, theta, adv);
    assert.ok(Math.abs(got - need) <= 1e-12, `exploded cyl ${c.num} reads ${got} at crank ${theta.toFixed(2)} where firingProgress says ${need}: the flash is a law of crank pose, not of the assembled scene`);
  }
  view.assemble();
  ease(600);
  assert.equal(view.state().fraction, 0, 'ASSEMBLE has to bring the plugs back too, or the next law measures an exploded tree');
  const back = flashMesh(1);
  back.updateWorldMatrix(true, false);
  const pa = back.geometry.attributes.position;
  const va = new THREE.Vector3();
  const lo2 = { x: Infinity, y: Infinity, z: Infinity }, hi2 = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let i = 0; i < pa.count; i++) {
    va.fromBufferAttribute(pa, i).applyMatrix4(back.matrixWorld);
    for (const k of ['x', 'y', 'z']) {
      if (va[k] < lo2[k]) lo2[k] = va[k];
      if (va[k] > hi2[k]) hi2[k] = va[k];
    }
  }
  const mid2 = new THREE.Vector3((lo2.x + hi2.x) / 2, (lo2.y + hi2.y) / 2, (lo2.z + hi2.z) / 2);
  assert.ok(mid2.distanceTo(gapPoint(cyl1)) <= 1e-6, `after ASSEMBLE cyl 1's glow centre stands ${mid2.distanceTo(gapPoint(cyl1)).toFixed(6)} cm away from its published spark gap - the teardown is not exactly reversible for the plug assembly`);
  t.diagnostic(`tips ${tips.length} distinct materials assembled, ${sections.size} distinct in CUTAWAY; plugs leave in family/stage ${[...new Set(SPEC.cylinders.map((c) => `${explodeRuleFor(`plug-cyl${c.num}`).family}/${explodeRuleFor(`plug-cyl${c.num}`).stage}`))].join(', ')}`);
  resetFlash();
});

test('plugs: the flash is a map of crank pose, not of frame rate - 1x, 1/4, 1/10 and 1/50 agree', (t) => {
  const unit = plugUnit();
  assert.ok(unit, 'no spark-plug unit, so there is no flash to drive at any speed');
  assert.ok(typeof unit?.update === 'function', 'the plug unit needs update(theta, advance) before a frame rate can pose it');
  const RPM = 1600; // the rpm src/main.js boots the shell on
  const TARGETS = [160, 320, 480, 640]; // whole numbers of frames at every slowmo below
  const at = new Map(); // target -> Map(slowmo -> eight opacities)
  const steps = [];
  for (const slowmo of [1, 1 / 4, 1 / 10, 1 / 50]) {
    const state = createEngineState({ rpm: RPM, slowmo, running: true });
    assert.equal(state.slowmo, slowmo, `createEngineState clamped slowmo ${slowmo} to ${state.slowmo}: 1/50 has to sit on the published floor of its range, not under it`);
    const perFrame = (RPM * 6 * state.slowmo) / 60;
    steps.push(`slowmo ${slowmo}x -> ${perFrame.toFixed(2)} crank deg/frame`);
    let travelled = 0;
    for (const target of TARGETS) {
      let frames = 0;
      while (travelled + 1e-9 < target) {
        const d = state.step(1 / 60);
        assert.ok(Math.abs(d - perFrame) <= 1e-9, `at slowmo ${slowmo}x a 60 fps frame travels ${d.toFixed(6)} crank degrees; the published clock says ${perFrame.toFixed(6)} (rpm x 6 x slowmo)`);
        travelled += d;
        frames++;
      }
      assert.ok(Math.abs(travelled - target) <= 1e-9, `slowmo ${slowmo}x landed on ${travelled.toFixed(6)} deg after ${frames} frames instead of the pose ${target}`);
      assert.ok(Math.abs(state.theta - wrap720(target)) <= 1e-9, `slowmo ${slowmo}x reads state.theta ${state.theta.toFixed(6)} at a travel of ${travelled.toFixed(6)} deg`);
      const adv = state.advance().total;
      const m = flashMap(state.theta, adv);
      for (const c of SPEC.cylinders) {
        const need = expectFlash(c, state.theta, adv);
        assert.ok(Math.abs(m.get(c.num) - need) <= 1e-9, `slowmo ${slowmo}x at crank ${state.theta.toFixed(4)}: cyl ${c.num} reads ${m.get(c.num)} where firingProgress says ${need}`);
      }
      if (!at.has(target)) at.set(target, new Map());
      at.get(target).set(slowmo, SPEC.cylinders.map((c) => m.get(c.num)));
    }
  }
  for (const target of TARGETS) {
    const base = at.get(target).get(1);
    for (const [slowmo, values] of at.get(target)) {
      SPEC.cylinders.forEach((c, i) => assert.ok(Math.abs(values[i] - base[i]) <= 1e-9, `cyl ${c.num} reads ${base[i]} at crank ${target} deg driven 1x and ${values[i]} at the same crank angle driven at slowmo ${slowmo}x: the same pose has to give the same flash whatever frame rate fed it`));
    }
  }
  // coverage: a finer frame grid must show the burn window more often, and any
  // frame step finer than the window has to catch every plug
  const coverage = [];
  const mins = [];
  for (const slowmo of [1, 1 / 4, 1 / 10, 1 / 50]) {
    const state = createEngineState({ rpm: RPM, slowmo, running: true });
    const perFrame = (RPM * 6 * state.slowmo) / 60;
    const litByCyl = new Map(SPEC.cylinders.map((c) => [c.num, 0]));
    let frames = 0, litFrames = 0, adv = state.advance().total;
    while (frames * perFrame < 720) {
      state.step(1 / 60);
      frames++;
      adv = state.advance().total;
      const m = flashMap(state.theta, adv);
      let lit = 0;
      for (const c of SPEC.cylinders) {
        const need = expectFlash(c, state.theta, adv);
        assert.ok(Math.abs(m.get(c.num) - need) <= 1e-12, `slowmo ${slowmo}x frame ${frames} at crank ${state.theta.toFixed(3)}: cyl ${c.num} reads ${m.get(c.num)} where the law says ${need}`);
        if (LIT(m.get(c.num))) {
          lit++;
          litByCyl.set(c.num, litByCyl.get(c.num) + 1);
        }
      }
      if (lit) litFrames++;
    }
    const arc = adv + IG.burnDeg;
    const counts = SPEC.cylinders.map((c) => litByCyl.get(c.num));
    if (perFrame < arc) {
      for (const c of SPEC.cylinders) assert.ok(litByCyl.get(c.num) >= 1, `at slowmo ${slowmo}x the frame step ${perFrame.toFixed(2)} deg is finer than the ${arc.toFixed(3)} deg window and yet cyl ${c.num}'s tip was never lit across a whole 720 degree cycle`);
    }
    mins.push(Math.min(...counts));
    coverage.push(`slowmo ${slowmo}x: ${perFrame.toFixed(2)} deg/frame is ${(perFrame / arc).toFixed(2)}x the ${arc.toFixed(3)} deg window, ${frames} frames per cycle, ${litFrames} of them showing a flash, ${Math.min(...counts)}..${Math.max(...counts)} lit frames per plug`);
  }
  for (let i = 1; i < mins.length; i++) assert.ok(mins[i] > mins[i - 1], `slowmo ${[1, 1 / 4, 1 / 10, 1 / 50][i]}x shows a plug lit in ${mins[i]} frames, no more than the coarser ${[1, 1 / 4, 1 / 10, 1 / 50][i - 1]}x at ${mins[i - 1]}: a finer crank resolution has to resolve the burn window, not hide it`);
  t.diagnostic(`frame clock ${steps.join(', ')}; coverage ${coverage.join('; ')}; at 1x the crank moves ${1600 * 6 / 60} deg per frame, so a plug can cross a whole burn window between two painted frames - the flash is correct at every pose the shell is offered, and 1x rpm 1600 is 26.7 revolutions per second`);
  resetFlash();
});
