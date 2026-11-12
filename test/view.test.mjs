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
import * as THREE from 'three';

import { SPEC } from '../src/engine/spec.js';
import { bboxRadius, cutawaySpecs, explodeDirection, explodeOffsets, explodeRuleFor, explodeRules, explodeSpecs, framingRange, mountClearLift, partLabel, partBank } from '../src/engine/view.js';
import { clampFocus, createCameraRig } from '../src/ui/cameraRig.js';
import { buildMembers, createViewControls, measureExtent, mountHardware } from '../src/ui/viewControls.js';
import { engineUnits, proxyMaterials } from './support/engine-triangles.mjs';
import { createStand } from '../src/render/stand.js';

const V = SPEC.view;
const FLOOR = SPEC.stand.floorZ;
const ASPECT = V.aspect;
const W = 1280;
const H = Math.round(W / ASPECT);
const EPS = 1e-9;

/** The world main.js builds: the casting, the four assemblies and the stand. */
function buildWorld() {
  const materials = proxyMaterials();
  const units = engineUnits(materials);
  const engine = units.block;
  engine.name = 'v8-block';
  engine.add(units.cranktrain, units.valvetrain, units.heads, units.manifolds);
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
  return { engine, materials, scene, stand, camera, rig, view };
}

const world = buildWorld();
const { engine, materials, scene, stand, camera, rig, view } = world;

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
