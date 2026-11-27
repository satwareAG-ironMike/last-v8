// Slice 8L (issue #46): the OHV variant draws its 16 pushrods, and the iron that guides
// them is machined where the measurement says they stand.
//
// Written RED first. Today no pushrod is drawn (SPEC.variants.ohv.pendingHardware names
// "pushrods" and `grep -c pushrod src/render/valvetrain.js` -> 0 outside comments), no
// gallery is cast, and the corridor the rods have to run in is already occupied:
//   tmp/8l-fit.mjs -> tmp/v8-8l-fit.out: each rod is coax with its lifter bore (out
//     7.6368 in both banks, x at the lifter axes, 35.2170..37.2170 cm long, 1.9812 cm off
//     the 5.30 cm liner shell, 0.8500 cm of air rod to rod); the nearest drawn iron is
//     0.3023 cm (head gasket-cyl-R--16.5) and 0.1250 cm (block gallery-L-4-guide);
//   tmp/8l-flange.mjs -> tmp/v8-8l-flange.out: a gallery wall thick enough to hold a
//     0.55 cm bore with the published 0.30 cm cast wall (out 6.7868..8.4868, the deck
//     face up to ohvRockerLayout()'s castingTopA 31.3713) is cut by 2764 vertices of
//     drawn iron, all of it the exhaust runner;
//   tmp/8l-manifold.mjs -> tmp/v8-8l-manifold.out: the runner's bolt flange stands out
//     7.0000..7.7000 over along 24.4000..29.6000 and its neck out 7.7000..9.6000 over
//     along 25.6500..28.3500, both across every corridor x, while the rod surface is out
//     7.2368..8.0368. The head's own chimneys (out 7.6500..7.9500) stand at x 9..13 and
//     20.0..28.55, which is NOT a corridor x, so the gallery is clear of them.
// The slice therefore publishes the rod contract, draws the rods on the lifter axes,
// casts the gallery in the band the runner leaves free (along 29.9000..31.3713), and
// machines the runner and the block's gallery ribs so the rods pass with air.
import test from 'node:test';
import assert from 'assert/strict';
import * as THREE from 'three';
import { SPEC, bankUp, bankOut } from '../src/engine/spec.js';
import { createHeads } from '../src/render/heads.js';
import { createBlock } from '../src/render/block.js';
import { createManifolds } from '../src/render/manifolds.js';
import { createValvetrain } from '../src/render/valvetrain.js';
import { ohvLifterGallery, ohvLifters, ohvRockerLayout } from '../src/engine/layout.js';
import * as LAYOUT from '../src/engine/layout.js';

const H = SPEC.head;
const B = SPEC.block;
const IRON = SPEC.variants.ohv.rocker;
const FACE = B.deckA + H.gasketT; // 24.25 head deck face
const LAW = 'OHV-PUSHROD';
const EPS = 1e-3;
const sides = ['intake', 'exhaust'];
const banks = ['L', 'R'];

const mats = () => new Proxy({}, { get: (t, k) => (t[k] ??= new THREE.MeshStandardMaterial({ name: String(k) })) });
const grp = (built) => built.group ?? built;

const G = ohvLifterGallery();
const F = ohvLifters(G);
const L = ohvRockerLayout();

const local = (bank, v) => {
  const u = bankUp(bank), p = bankOut(bank);
  const d = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const w = [v.x, v.y, v.z];
  return { x: w[0], along: d(w, u), out: d(w, p) };
};

/** Signed distance from a bank-local point to a line running along bankUp at (x, out). */
const dAxis = (p, x, out) => Math.hypot(p.x - x, p.out - out);

/** Signed distance from a bank-local point to a finite rod segment along bankUp. */
const dRod = (p, x, out, from, to) => {
  const da = Math.max(from - p.along, p.along - to, 0);
  const dr = dAxis(p, x, out);
  return da === 0 ? dr : Math.hypot(da, dr);
};

/** The layout helper this slice owes, read the way every other law reads it. */
function published() {
  assert.equal(typeof LAYOUT.ohvPushrods, 'function',
    'src/engine/layout.js publishes no ohvPushrods(): the 16 rod lines are derived per call site instead of once in the layout helper every naming and valvetrain-count reading goes through');
  return LAYOUT.ohvPushrods();
}

/** Every vertex of a tree, in one bank's frame. */
function verts(group, bank, keep = () => true) {
  const out = [];
  const v = new THREE.Vector3();
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    if (!keep(o)) return;
    if (!o.isMesh) return;
    const g = o.geometry?.attributes?.position;
    if (!g) return;
    for (let i = 0; i < g.count; i++) {
      v.fromBufferAttribute(g, i).applyMatrix4(o.matrixWorld);
      const p = local(bank, v);
      p.name = String(o.name);
      out.push(p);
    }
  });
  return out;
}

const train = () => grp(createValvetrain(mats(), 'ohv'));
const head = () => grp(createHeads(mats(), 'ohv'));

test(`${LAW}: SPEC.variants.ohv publishes the pushrod contract the rod, its bore and its guide all read`, () => {
  const P = SPEC.variants.ohv.pushrod;
  assert.ok(P, 'SPEC.variants.ohv publishes no pushrod contract: the rod radius, the running clearance the bore is machined over it and the air it keeps against other iron are typed per call site instead of published');
  assert.ok(P.rodRadius > 0, `the published rod radius ${P.rodRadius} is not a positive length`);
  assert.ok(P.runningClear > 0, `the published running clearance ${P.runningClear} is not a positive length: a bore equal to the rod would be a press fit, not a guide`);
  assert.ok(Math.abs(P.boreRadius - (P.rodRadius + P.runningClear)) < EPS,
    `the published bore ${P.boreRadius} is not the ${P.rodRadius} cm rod plus the ${P.runningClear} cm running clearance it is machined over`);
  assert.ok(P.runnerAir >= IRON.castWall,
    `the pushrod keeps ${P.runnerAir} cm of air against runner iron, less than the ${IRON.castWall} cm cast wall this variant publishes around every machined bore`);
  assert.ok(!SPEC.variants.ohv.pendingHardware.some((p) => /pushrod/i.test(String(p.family ?? p))),
    `SPEC.variants.ohv.pendingHardware still names the pushrods as missing while this slice draws them`);
});

test(`${LAW}: src/engine/layout.js ohvPushrods() publishes one rod line per lifter bore, coax with it`, () => {
  const R = published();
  assert.ok(Array.isArray(R.rods), 'ohvPushrods() returns no rods array');
  assert.equal(R.rods.length, SPEC.cylinders.length * sides.length,
    `ohvPushrods() publishes ${R.rods.length} rods, expected ${SPEC.cylinders.length * sides.length} - one per lifter bore`);
  assert.ok(Math.abs(R.boreRadius - SPEC.variants.ohv.pushrod.boreRadius) < EPS,
    `ohvPushrods() machines a ${R.boreRadius} cm bore while SPEC publishes ${SPEC.variants.ohv.pushrod.boreRadius} cm`);
  for (const r of R.rods) {
    const cyl = SPEC.cylinders.find((c) => c.num === r.cyl);
    assert.ok(cyl, `a rod is published for cylinder ${r.cyl}, which this engine does not have`);
    const l = F.lifters.find((x) => x.cyl === r.cyl && x.valve === r.valve);
    assert.ok(l, `no rod is published for cyl ${r.cyl} ${r.valve}`);
    assert.ok(Math.abs(r.x - l.x) < EPS,
      `cyl ${r.cyl} ${r.valve}: the rod stands at x ${r.x.toFixed(4)} while its lifter bore stands at x ${l.x.toFixed(4)} - a pushrod that is not coax with its lifter bore binds the lifter in the bore`);
    assert.ok(Math.abs(r.out - G.banks[cyl.bank].axisOut) < EPS,
      `cyl ${r.cyl} ${r.valve}: the rod stands out ${r.out.toFixed(4)} while the bank's lifter axes stand out ${G.banks[cyl.bank].axisOut.toFixed(4)}`);
    const pad = L.sides[r.valve].along - IRON.pad;
    assert.ok(Math.abs(r.to - pad) < EPS,
      `cyl ${r.cyl} ${r.valve}: the rod ends at along ${r.to.toFixed(4)}; the rocker pad its arm presses on stands ${IRON.pad} cm under the ${r.valve} shaft plane ${L.sides[r.valve].along.toFixed(4)}`);
    assert.ok(Math.abs(r.from - (l.axisAlong + F.baseRadius + l.length)) < EPS,
      `cyl ${r.cyl} ${r.valve}: the rod starts at along ${r.from.toFixed(4)}, not at the top of the ${l.length.toFixed(4)} cm lifter body it pushes on`);
    assert.ok(r.length > 0, `cyl ${r.cyl} ${r.valve}: the published rod length ${r.length} is not positive`);
  }
  const lens = R.rods.map((r) => r.length);
  assert.ok(Math.min(...lens) > 30, `the shortest published rod is ${Math.min(...lens).toFixed(4)} cm; tmp/8l-fit.mjs measured this variant's rods at 35.2170..37.2170 cm across the ${FACE.toFixed(2)} cm deck face`);
});

test(`${LAW}: the OHV build draws its 16 pushrods on the published lines`, () => {
  const R = published();
  const group = train();
  const drawn = [];
  group.traverse((o) => { if (/^pushrod-/.test(String(o.name))) drawn.push(o); });
  assert.equal(drawn.length, R.rods.length,
    `the OHV valvetrain draws ${drawn.length} pushrod solids, expected ${R.rods.length}: SPEC.variants.ohv.pendingHardware names the pushrods as the gap this variant still has`);
  for (const r of R.rods) {
    const mesh = drawn.find((o) => String(o.name).includes(`-${r.cyl}-${r.valve}`));
    assert.ok(mesh, `no drawn pushrod is named for cyl ${r.cyl} ${r.valve}`);
    const bank = SPEC.cylinders.find((c) => c.num === r.cyl).bank;
    const vs = verts(group, bank, (o) => o === mesh);
    const radial = Math.max(...vs.map((p) => dAxis(p, r.x, r.out)));
    const along = vs.map((p) => p.along);
    assert.ok(Math.abs(radial - SPEC.variants.ohv.pushrod.rodRadius) < 1e-2,
      `the drawn pushrod of cyl ${r.cyl} ${r.valve} stands ${radial.toFixed(4)} cm off its axis at its widest, not the published ${SPEC.variants.ohv.pushrod.rodRadius} cm rod radius`);
    assert.ok(Math.abs(Math.min(...along) - r.from) < 1e-2 && Math.abs(Math.max(...along) - r.to) < 1e-2,
      `the drawn pushrod of cyl ${r.cyl} ${r.valve} runs along ${Math.min(...along).toFixed(4)}..${Math.max(...along).toFixed(4)} while the published rod runs ${r.from.toFixed(4)}..${r.to.toFixed(4)}`);
  }
});

test(`${LAW}: the OHV head casts a pushrod gallery per bank and bores it at the published axes`, () => {
  const P = SPEC.variants.ohv.pushrod;
  const R = published();
  const group = head();
  const galleries = [];
  group.traverse((o) => { if (/^pushrod-gallery-/.test(String(o.name))) galleries.push(String(o.name)); });
  assert.equal(galleries.length, banks.length,
    `the OHV head casts ${galleries.length} pushrod gallery solids, expected ${banks.length} - one per bank. tmp/8l-manifold.mjs measured that the head's iron above the deck stops at out 7.0000 while a bore for the ${P.rodRadius} cm rod needs out ${(G.banks.L.axisOut - P.boreRadius).toFixed(4)}..${(G.banks.L.axisOut + P.boreRadius).toFixed(4)}`);
  for (const bank of banks) {
    const own = R.rods.filter((r) => SPEC.cylinders.find((c) => c.num === r.cyl).bank === bank);
    const vs = verts(group, bank, (o) => /^pushrod-gallery-/.test(String(o.name)));
    assert.ok(vs.length > 0, `bank ${bank}: no gallery vertices to measure`);
    for (const r of own) {
      const inBore = vs.filter((p) => Math.abs(p.along - r.bandFrom) < r.bandLen / 2 && dAxis(p, r.x, r.out) < P.boreRadius - EPS);
      assert.equal(inBore.length, 0,
        `bank ${bank} cyl ${r.cyl} ${r.valve}: ${inBore.length} vertices of the gallery's own iron stand inside its ${P.boreRadius} cm bore - a solid cast inside its own bore is a bushing, not a bored hole`);
      const near = vs.filter((p) => Math.abs(p.x - r.x) < P.boreRadius + P.castWall && Math.abs(p.along - r.bandFrom) < r.bandLen / 2);
      const inboard = Math.min(...near.map((p) => p.out));
      const outboard = Math.max(...near.map((p) => p.out));
      assert.ok(r.out - inboard >= P.boreRadius + P.castWall - EPS,
        `bank ${bank} cyl ${r.cyl} ${r.valve}: the gallery keeps only ${(r.out - inboard).toFixed(4)} cm of iron inboard of its bore, less than the bore radius plus the ${P.castWall} cm cast wall`);
      assert.ok(outboard - r.out >= P.boreRadius + P.castWall - EPS,
        `bank ${bank} cyl ${r.cyl} ${r.valve}: the gallery keeps only ${(outboard - r.out).toFixed(4)} cm of iron outboard of its bore, less than the bore radius plus the ${P.castWall} cm cast wall`);
    }
    const perBank = new Set(own.map((r) => r.x.toFixed(4))).size;
    assert.equal(perBank, SPEC.cylinders.filter((c) => c.bank === bank).length * sides.length,
      `bank ${bank}: the gallery is bored at ${perBank} axes, expected one per valve of the bank`);
  }
});

test(`${LAW}: no drawn pushrod cuts the runner iron it has to pass`, () => {
  const P = SPEC.variants.ohv.pushrod;
  const R = published();
  const group = grp(createManifolds(mats(), 'ohv'));
  let worst = { air: Infinity, at: '', rod: '' };
  for (const bank of banks) {
    const vs = verts(group, bank);
    for (const r of R.rods.filter((x) => SPEC.cylinders.find((c) => c.num === x.cyl).bank === bank)) {
      for (const p of vs) {
        const d = dRod(p, r.x, r.out, r.from, r.to) - P.rodRadius;
        if (d < worst.air) worst = { air: d, at: p.name, rod: `cyl ${r.cyl} ${r.valve}` };
      }
    }
  }
  assert.ok(worst.air >= P.runnerAir - EPS,
    `${worst.at} stands ${worst.air.toFixed(4)} cm against the pushrod of ${worst.rod}; tmp/8l-manifold.mjs measured the exhaust flange at out 7.0000..7.7000 over along 24.4000..29.6000 and the neck at 7.7000..9.6000 over along 25.6500..28.3500, both across every corridor, while the rod surface reaches out ${(G.banks.L.axisOut + P.rodRadius).toFixed(4)}. The runner has to be machined with a clearance the published ${P.runnerAir} cm`);
});

test(`${LAW}: no drawn pushrod cuts the block's lifter gallery iron`, () => {
  const P = SPEC.variants.ohv.pushrod;
  const R = published();
  const group = grp(createBlock(mats(), 'ohv'));
  let worst = { air: Infinity, at: '', rod: '' };
  for (const bank of banks) {
    const vs = verts(group, bank).filter((p) => /^gallery-/.test(p.name));
    for (const r of R.rods.filter((x) => SPEC.cylinders.find((c) => c.num === x.cyl).bank === bank)) {
      for (const p of vs) {
        const d = dRod(p, r.x, r.out, r.from, r.to) - P.rodRadius;
        if (d < worst.air) worst = { air: d, at: p.name, rod: `cyl ${r.cyl} ${r.valve}` };
      }
    }
  }
  assert.ok(worst.air >= P.runnerAir - EPS,
    `${worst.at} stands ${worst.air.toFixed(4)} cm against the pushrod of ${worst.rod}; tmp/8l-fit.mjs measured 0.1250 cm at block gallery-L-4-guide. The rib that guides the lifter bore has to be machined clear of the rod that leaves it`);
});
