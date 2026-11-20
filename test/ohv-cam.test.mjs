// Slice 8C-1 (issue #8 item 2 + item 4, GATES P1-G7 / A1-G1 / A1-G7): the cam an
// OHV block houses. One central 16-lobe cam turns on the V bisector below the
// crank, ground from the same lobe law the DOHC cams are ground from, riding the
// five front-insert rings slice 8B machined into this variant's casting.
//
// Written RED first: every law below measures a part that did not exist at the
// commit this file was committed at (tmp/v8-8c-red.out, tmp/v8-8c-red2.out).
//
// What this file does NOT draw and says so out loud: the follower train (16
// lifters, 16 pushrods, 16 rockers, 2 rocker covers - SPEC.variants.ohv.drawn is
// still false) and this variant's crank-to-cam chain (A1-G2's open half).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SPEC, wrap360, signedAngle } from '../src/engine/spec.js';
import { ohvBearings, ohvHousing, camGroupNames, lobes as lobeCount, cams as camCount } from '../src/engine/layout.js';
import {
  camAzimuth, crankEvent, eventMid, eventDuration, lobeProfileRadius, lobeHalfCamDeg, lobeMaxRadius,
} from '../src/engine/timing.js';
import { createBlock } from '../src/render/block.js';
import { createValvetrain } from '../src/render/valvetrain.js';
import { newShell, shellAdd, closestToShell, surfaceOf, REACH } from './support/surface-clearance.mjs';

// Imported inside every law, not at module scope: each law has to be proven red on
// its own evidence, and a top-level import that throws reds the file instead.
const eng = () => import('../src/engine/ohv.js');
const DEG = Math.PI / 180;
const FACET = 0.006; // the polygon step test/heads.test.mjs already bores its shells with
const CORNER = 1e-4; // a float32 vertex can only hold a float64 machined value this closely
const B = ohvBearings();
const H = ohvHousing();
const V = SPEC.valves;
const LAW = 'OHV-CAM';

const mats = () => new Proxy({}, { get: (t, k) => (t[k] ??= new THREE.MeshStandardMaterial({ name: String(k) })) });

function train(variantId) {
  const built = createValvetrain(mats(), variantId);
  built.group.updateMatrixWorld(true);
  return built;
}

function ohvTrain() {
  const built = train('ohv');
  const name = camGroupNames('ohv')[0];
  const cam = built.group.getObjectByName(name);
  assert.ok(cam, `the switch names the camshaft "${name}" and the OHV build draws no such part`);
  return { ...built, cam };
}

function ohvCasting() {
  const block = createBlock(mats(), 'ohv');
  block.updateMatrixWorld(true);
  return block;
}

const axisPoint = (E) => { const a = E.ohvCamAxis(); return new THREE.Vector3(a.y, 0, a.z); };
const radiusOf = (p, axis) => Math.hypot(p.y - axis.y, p.z - axis.z);
const azOf = (p, axis) => wrap360(Math.atan2(p.y - axis.y, p.z - axis.z) / DEG);
const angDiff = (a, b) => Math.abs(wrap360(a - b + 180) - 180);
const dirAz = (v) => wrap360(Math.atan2(v.y, v.z) / DEG);

/**
 * World surface points of the faces that run ALONG the cam axis, each tagged with
 * how it was measured. The end faces of an extruded solid are discs: their
 * interior points sit at any radius down to the axis, so a profile law that reads
 * them measures the machining allowance instead of the ground outline. A face
 * normal with no x component is a machined cylindrical face; |n.x| = 1 is an end
 * face. Corners are the grinder's sampled contour points; edge midpoints are the
 * straight chords between them, which cut INSIDE the machined curve by the contour
 * error ohv.js publishes.
 */
function bandPoints(o) {
  o.updateWorldMatrix(true, false);
  const pos = o.geometry.attributes.position, idx = o.geometry.index;
  const n = idx ? idx.count : pos.count;
  const at = (k) => new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(k) : k).applyMatrix4(o.matrixWorld);
  const out = [];
  for (let j = 0; j < n; j += 3) {
    const a = at(j), b = at(j + 1), c = at(j + 2);
    const nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
    const ax = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    if (Math.abs(nx) > 1e-9 && Math.abs(nx) > 0.05 * Math.abs(ax)) continue; // an end face
    out.push({ p: a, kind: 'c' }, { p: b, kind: 'c' }, { p: c, kind: 'c' },
      { p: a.clone().add(b).multiplyScalar(0.5), kind: 'm' },
      { p: b.clone().add(c).multiplyScalar(0.5), kind: 'm' },
      { p: c.clone().add(a).multiplyScalar(0.5), kind: 'm' });
  }
  return out;
}

/** Angular facets a turned solid presents off its own axis: 360 / the facet gap. */
function turnedFacets(o, axis) {
  o.updateWorldMatrix(true, false);
  const pos = o.geometry.attributes.position;
  const seen = [];
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
    const az = wrap360(Math.atan2(v.y - axis.y, v.z - axis.z) / DEG);
    if (!seen.some((s) => Math.abs(s - az) < 1e-3)) seen.push(az);
  }
  seen.sort((p, q) => p - q);
  let gap = 360;
  for (let i = 1; i < seen.length; i++) gap = Math.min(gap, seen[i] - seen[i - 1]);
  return { segments: Math.round(360 / gap), gapDeg: gap };
}

/** Radius off the cam axis line of every drawn cam surface inside one bearing window. */
function windowBand(cam, axis, bx, half) {
  const who = new Set();
  let hi = 0;
  for (const o of cam.children) {
    for (const p of surfaceOf(o)) {
      if (p.x < bx - half || p.x > bx + half) continue;
      const r = radiusOf(p, axis);
      if (r > hi + 1e-9) { hi = r; who.clear(); who.add(o.name); }
      else if (Math.abs(r - hi) <= 1e-9) who.add(o.name);
    }
  }
  return { hi, who: [...who] };
}

test(`${LAW}: the switch builds exactly one central cam in the V, on the published axis, and leaves the DOHC build alone`, async () => {
  const { group, cam } = ohvTrain();
  assert.deepEqual(camGroupNames('ohv'), ['cam-V-central'], 'the OHV variant runs one central cam on the V bisector');
  assert.equal(camCount('ohv'), 1, 'the switch counts one cam for the OHV variant');
  assert.equal(lobeCount('ohv'), 16, '16 valves means 16 lobes on the one cam');
  assert.equal(cam.position.x, 0);
  assert.equal(cam.position.y, 0, 'the cam axis stands on the V bisector, not off to one bank');
  assert.ok(Math.abs(cam.position.z + SPEC.variants.ohv.belowCrankCm) < 1e-9,
    `the cam group stands at z ${cam.position.z} instead of the published -${SPEC.variants.ohv.belowCrankCm} cm below the crank centre`);
  const journals = cam.children.filter((o) => o.name.startsWith('cam-V-journal-'));
  const lobeMeshes = cam.children.filter((o) => o.name.startsWith('lobe-'));
  const necks = cam.children.filter((o) => o.name.startsWith('cam-V-neck-'));
  assert.equal(journals.length, B.stations.length,
    `the cam carries ${journals.length} journal stubs for the ${B.stations.length} front-insert rings this variant's block bores`);
  assert.equal(lobeMeshes.length, 16, `${lobeMeshes.length} lobes drawn on the central cam, not 16`);
  assert.ok(necks.length > 0, 'a cam of journals and lobes with nothing joining them is a set of discs, not a cam');
  for (const word of ['lifter', 'pushrod', 'push-rod', 'rocker', 'cover', 'bucket', 'shim', 'spring', 'valve-']) {
    let hits = 0;
    group.traverse((o) => { if (o.name.toLowerCase().includes(word)) hits += 1; });
    assert.equal(hits, 0, `the OHV build draws ${hits} part(s) for "${word}" while SPEC.variants.ohv.drawn is false: the follower train is owed, and drawing it here would put hardware in a block that has not machined its lifter bores`);
  }
  const dohc = train('dohc').group;
  assert.equal(camGroupNames('dohc').filter((n) => dohc.getObjectByName(n)).length, camCount('dohc'),
    'the DOHC build has to keep its four camshafts beside this variant');
  assert.ok(!dohc.getObjectByName('cam-V-central'), 'the central cam belongs to the OHV variant only');
  console.log(`${LAW} drawn: ${cam.name} at z ${cam.position.z.toFixed(4)}, ${journals.length} journals, ${lobeMeshes.length} lobes, ${necks.length} necks`);
});

test(`${LAW}: every published bushing window carries the drawn journal at the published journal radius and nothing else`, async () => {
  const E = await eng();
  const { cam } = ohvTrain();
  const axis = axisPoint(E);
  const rows = [];
  for (const [i, bx] of B.stations.entries()) {
    const win = windowBand(cam, axis, bx, B.bearingHalf);
    assert.ok(win.hi > 0, `nothing drawn of the cam reaches the bearing window ${bx} +/- ${B.bearingHalf}`);
    assert.deepEqual(win.who, [`cam-V-journal-${i + 1}`],
      `window x${bx.toFixed(2)} of the ${B.boreR.toFixed(4)} cm front-insert bore holds ${win.who.join(', ')} at ${win.hi.toFixed(4)} cm off the cam axis; the ring there is bored ${B.shellIdR.toFixed(4)} and the journal is ground to ride it at ${B.journalR.toFixed(4)}`);
    assert.ok(Math.abs(win.hi - B.journalR) <= FACET,
      `window x${bx.toFixed(2)}: what the ring rides on stands ${win.hi.toFixed(4)} cm off the axis, not the published ${B.journalR.toFixed(4)} cm journal radius (bore ${B.boreR.toFixed(4)}, shell wall ${B.shellWall.toFixed(4)}, film ${B.oilFilm.toFixed(4)})`);
    assert.ok(win.hi <= B.shellIdR - B.oilFilm / 2,
      `window x${bx.toFixed(2)}: the journal at ${win.hi.toFixed(4)} reaches into the ${B.shellIdR.toFixed(4)} ring bore leaving less than half the published ${B.oilFilm.toFixed(4)} cm oil film`);
    rows.push(`ring ${i + 1} @ ${bx.toFixed(2)} -> ${win.hi.toFixed(4)}`);
  }
  console.log(`${LAW} windows: ${rows.join('; ')}; journal ${B.journalR.toFixed(4)} in ring bore ${B.shellIdR.toFixed(4)}`);
});

test(`${LAW}: the drawn journal rides the drawn front-insert rings on exactly the published oil film`, async () => {
  const E = await eng();
  const { cam } = ohvTrain();
  const block = ohvCasting();
  const rings = newShell();
  let drawn = 0;
  block.traverse((o) => {
    if (!/^cam-bushing-[1-5]$/.test(o.name)) return;
    shellAdd(rings, o);
    drawn += 1;
  });
  assert.equal(drawn, 5, `${drawn} front-insert rings drawn in the OHV casting, not 5`);
  // The film is only measurable because the pair is turned at the same angular
  // resolution: a facet-matched concentric pair, not a 40-step journal in a
  // 48-step bore. The count is measured off the drawn rings, not typed.
  const journalFacets = turnedFacets(cam.children.find((o) => o.name === 'cam-V-journal-1'), axisPoint(E));
  const ringFacets = turnedFacets(block.getObjectByName('cam-bushing-1'), axisPoint(E));
  assert.ok(Math.abs(ringFacets.segments - E.TURNED_SEGMENTS) <= 0.5,
    `the drawn ring reads ${ringFacets.segments} turned facets (${ringFacets.gapDeg.toFixed(4)} deg apart), not the ${E.TURNED_SEGMENTS} this tree's bores are machined at`);
  assert.equal(journalFacets.segments, ringFacets.segments,
    `the journal is turned at ${journalFacets.segments} facets against a ring bored at ${ringFacets.segments}: the two facets phase differently and the running clearance measures short of the published ${B.oilFilm} cm film`);
  const rows = [];
  for (const o of cam.children) {
    if (!o.name.startsWith('cam-V-journal-')) continue;
    const near = closestToShell(o, rings);
    assert.ok(Number.isFinite(near.d),
      `${o.name}: nothing of the drawn cam came within ${REACH} cm of a drawn ring - the cam does not meet its bearings where the casting says they sit`);
    assert.ok(/^cam-bushing-[1-5]$/.test(near.into), `${o.name}: the nearest drawn ring is "${near.into}"`);
    assert.ok(Math.abs(near.d - B.oilFilm) <= FACET,
      `${o.name} stands ${near.d.toFixed(4)} cm from ${near.into}; the published film is ${B.oilFilm.toFixed(4)} cm (${B.journalR.toFixed(4)} journal + ${B.oilFilm.toFixed(4)} film = ${B.shellIdR.toFixed(4)} ring bore). A bearing either has its film or it does not.`);
    rows.push(`${o.name} -> ${near.into} ${near.d.toFixed(4)}`);
  }
  assert.equal(rows.length, 5, `${rows.length} journal stubs measured against the rings`);
  console.log(`${LAW} film: ${rows.join('; ')}; published ${B.oilFilm.toFixed(4)} cm`);
});

test(`${LAW}: the cam is insertable through its own retainer opening: its widest outline is the turned journal, and no ring it rides is bored smaller than a lobe nose`, async () => {
  const E = await eng();
  const { cam } = ohvTrain();
  const axis = axisPoint(E);
  let maxR = 0, maxAt = null, maxOn = null;
  for (const o of cam.children) {
    for (const p of surfaceOf(o)) {
      const r = radiusOf(p, axis);
      if (r > maxR) { maxR = r; maxAt = p; maxOn = o.name; }
    }
  }
  // Front-insert reading (A1-G7): the journal is ground to the cam's own widest
  // outline, so the nose that has to pass every ring on the way in IS the journal.
  assert.ok(Math.abs(maxR - B.noseR) <= FACET,
    `the widest thing this cam presents stands ${maxR.toFixed(4)} cm off the axis (${maxOn} at y ${maxAt ? maxAt.y.toFixed(3) : '?'} z ${maxAt ? maxAt.z.toFixed(3) : '?'}); the machined nose is ${B.noseR.toFixed(4)} and the turned journal is ${B.journalR.toFixed(4)}`);
  assert.equal(B.journalR, B.noseR, 'a front-insert cam is journal-equals-nose or it cannot be assembled through its own rings');
  assert.ok(maxR <= B.plateInR - FACET,
    `the cam at ${maxR.toFixed(4)} cm cannot slide through the retainer opening of ${B.plateInR.toFixed(4)} cm; published nose air ${B.noseAirCm.toFixed(4)} cm`);
  assert.ok(B.boreR >= B.noseR + H.lobeAirCm - 1e-9,
    `the ${B.boreR.toFixed(4)} cm through-bore is not wider than a ${B.noseR.toFixed(4)} cm nose plus the published ${H.lobeAirCm} cm of lobe air`);
  // The swept outline test/block.test.mjs clears this casting against: nothing drawn
  // of this cam may present more than it, or that law no longer covers the cam.
  assert.ok(maxR <= H.worstOutlineR + FACET,
    `the drawn cam presents ${maxR.toFixed(4)} cm against the swept outline ${H.worstOutlineR.toFixed(4)} the tunnel is bored around`);
  console.log(`${LAW} insert: widest ${maxR.toFixed(4)} on ${maxOn}, retainer opening ${B.plateInR.toFixed(4)}, nose air ${B.noseAirCm.toFixed(4)}, bore ${B.boreR.toFixed(4)}`);
});

test(`${LAW}: 16 lobes stand at the 4 published cylinder stations at this variant's own lobe width, ground to the machined profile with base circle, ramps, flanks and nose`, async () => {
  const E = await eng();
  const { cam } = ohvTrain();
  const axis = axisPoint(E);
  const order = camGroupNames('dohc').map((n) => ({ bank: n.split('-')[1], valve: n.split('-')[2] }));
  const seen = new Set();
  const worst = { err: 0, who: null };
  for (const [si, st] of SPEC.block.stations.entries()) {
    const band = [st - B.groupHalfCm, st + B.groupHalfCm];
    for (const [i, [u, v]] of B.windows.entries()) {
      const air = Math.max(u - band[1], band[0] - v);
      if (air <= 0) assert.fail(`station ${st} lobe group ${band[0].toFixed(2)}..${band[1].toFixed(2)} overlaps ring window ${i + 1} ${u.toFixed(2)}..${v.toFixed(2)} on the cam axis`);
      assert.ok(air >= B.lobeAxialAirCm - 1e-9,
        `station ${st} lobe group leaves ${air.toFixed(4)} cm to ring window ${i + 1}, less than the published axial air ${B.lobeAxialAirCm.toFixed(4)}`);
    }
    for (const line of order) {
      const cyl = SPEC.cylinders.find((c) => c.bank === line.bank && c.station === si);
      assert.ok(cyl, `no cylinder of bank ${line.bank} stands at station ${si}`);
      const mesh = cam.getObjectByName(`lobe-cyl${cyl.num}-${line.valve}`);
      assert.ok(mesh, `lobe-cyl${cyl.num}-${line.valve} is not drawn on the central cam`);
      assert.ok(mesh.userData.noseDir instanceof THREE.Vector3, `${mesh.name}: the baked lobe carries no nose direction`);
      seen.add(mesh.name);
      const bb = new THREE.Box3().setFromObject(mesh);
      assert.ok(Math.abs((bb.max.x - bb.min.x) - B.lobeWidthCm) <= FACET,
        `${mesh.name}: ${(bb.max.x - bb.min.x).toFixed(4)} cm wide along the cam axis, not the ${B.lobeWidthCm.toFixed(4)} cm this variant's 16 lobes and 5 rings share out`);
      const centre = (bb.min.x + bb.max.x) / 2;
      assert.ok(centre >= band[0] - FACET && centre <= band[1] + FACET,
        `${mesh.name} centred at x ${centre.toFixed(3)} leaves the station band ${band[0].toFixed(3)}..${band[1].toFixed(3)}`);
      // The ground outline, measured off the drawn machined faces: the grinder's
      // contour corners land ON the machined profile, and the straight chords
      // between them cut inside it by no more than the contour error ohv.js
      // publishes for this cam's own derived contour step.
      const plan = E.ohvCamLayout();
      const idx = E.ohvLobeIndexAngle(cyl, line.valve);
      const pts = bandPoints(mesh);
      assert.ok(pts.length >= 360, `${mesh.name}: only ${pts.length / 6} machined outline facets to ground against`);
      let lo = Infinity, hi = 0, noseAz = 0, cornerErr = 0, chordErr = 0, past = 0, pastWho = null;
      for (const { p, kind } of pts) {
        const r = radiusOf(p, axis), az = azOf(p, axis);
        if (r < lo) lo = r;
        if (r > hi) { hi = r; noseAz = az; }
        const want = lobeProfileRadius(line.valve, signedAngle(az - idx));
        if (kind === 'c') {
          const err = Math.abs(r - want);
          if (err > cornerErr) cornerErr = err;
          if (err > worst.err) { worst.err = err; worst.who = `${mesh.name} corner at ${az.toFixed(2)} deg`; }
        } else {
          const sink = want - r; // a chord across a convex outline is always inside
          if (sink < -CORNER) { past += 1; if (pastWho === null) pastWho = `${mesh.name} at ${az.toFixed(2)} deg stands ${(-sink).toFixed(4)} past`; }
          if (sink > chordErr) chordErr = sink;
        }
      }
      assert.ok(cornerErr <= CORNER, `${mesh.name}: the drawn contour corners stand ${cornerErr.toFixed(6)} cm off the machined profile - the sampled points of a ground cam land on the outline, they are the outline (float32 vertex storage allows ${CORNER})`);
      assert.equal(past, 0, `${pastWho}: ${past} drawn contour points stand OUTSIDE the machined profile of the ${line.valve} lobe of cyl ${cyl.num} - a grinder's tool path cuts inside the curve, it never adds material`);
      assert.ok(chordErr <= plan.profileChordErrCm + CORNER,
        `${mesh.name}: the drawn chords between contour samples sink ${chordErr.toFixed(4)} cm inside the machined outline; this cam's published contour error is ${plan.profileChordErrCm.toFixed(4)} cm at ${plan.profileStepDeg.toFixed(4)} cam deg steps`);
      const base = SPEC.head.camBaseRadius, nose = lobeMaxRadius(line.valve);
      assert.ok(angDiff(noseAz, idx) <= 0.6, `${mesh.name}: machined nose at ${noseAz.toFixed(2)} deg, index angle ${idx.toFixed(2)} deg`);
      assert.ok(Math.abs(hi - nose) <= FACET, `${mesh.name}: outline max ${hi.toFixed(4)} instead of the machined nose ${nose.toFixed(4)}`);
      assert.ok(Math.abs(lo - base) <= FACET, `${mesh.name}: outline min ${lo.toFixed(4)} instead of the ground base circle ${base}`);
      assert.ok(hi - lo >= V.maxLift - FACET, `${mesh.name}: nose to base circle is ${(hi - lo).toFixed(4)} cm of lift, not the published ${V.maxLift}`);
      // Stepped the way a cam grinder machines it: nose, flank, opening and
      // closing ramp, base circle - the machined profile descends monotonically
      // from nose to base circle, and the drawn contour carries material in every
      // radius band that descent steps through. Gated on radii, not on azimuth
      // windows: the contour's own sample step (plan.profileStepDeg) is what fixes
      // where its corners may land, so an azimuth window would gate the sampling
      // instead of the outline.
      const half = lobeHalfCamDeg(line.valve);
      const descent = [0, 0.25, 0.5, 0.75, 0.9, 1].map((f) => lobeProfileRadius(line.valve, signedAngle(half * f)));
      assert.ok(descent.every((r, i) => i === 0 || r < descent[i - 1] - 1e-6),
        `${mesh.name}: the machined profile does not step down from nose through flank and ramp onto the base circle: ${descent.map((r) => r.toFixed(4)).join(' > ')}`);
      assert.ok(Math.abs(descent[5] - base) <= 1e-9, `${mesh.name}: the closing ramp does not land on the ground base circle ${base}, it lands at ${descent[5].toFixed(4)}`);
      const cornerR = pts.filter((q) => q.kind === 'c').map((q) => radiusOf(q.p, axis));
      const empty = [];
      for (let i = 0; i + 1 < descent.length; i++) {
        const n = cornerR.filter((r) => r > descent[i + 1] + CORNER && r < descent[i] - CORNER).length;
        if (n === 0) empty.push(`${descent[i + 1].toFixed(4)}..${descent[i].toFixed(4)}`);
      }
      assert.equal(empty.length, 0, `${mesh.name}: nothing drawn of this lobe's outline stands in the radius band(s) ${empty.join(', ')} that the machined profile steps through - a lobe with a hole in its flank is not a cam`);
    }
  }
  assert.equal(seen.size, 16, `${seen.size} distinct lobes drawn on the central cam, not 16`);
  console.log(`${LAW} lobes: 16 at stations ${SPEC.block.stations.map((s) => s.toFixed(2)).join(', ')}, width ${B.lobeWidthCm.toFixed(4)}, group half ${B.groupHalfCm.toFixed(4)}, axial air ${B.minAxialAir.toFixed(4)}; worst outline-vs-profile error ${worst.err.toFixed(5)} cm (${worst.who})`);
});

test(`${LAW}: lift comes from the lifter's own contact law - published max lift, published duration, and every nose on its own lifter axis exactly at that valve's max lift`, async () => {
  const E = await eng();
  const { group, cam, update } = ohvTrain();
  const rows = [];
  for (const cyl of SPEC.cylinders) {
    for (const valve of ['intake', 'exhaust']) {
      let max = 0, atTheta = null, open = 0;
      for (let th = 0; th < 720; th += 1) {
        const l = E.ohvLift(cyl, valve, th);
        if (l > 1e-9) open += 1;
        if (l > max) { max = l; atTheta = th; }
      }
      assert.ok(Math.abs(max - V.maxLift) <= 1e-6,
        `cyl ${cyl.num} ${valve}: the lifter contact law peaks at ${max.toFixed(4)} cm, not the published ${V.maxLift} cm of lift`);
      const pub = eventDuration(valve);
      assert.ok(Math.abs(open - pub) <= 3, `cyl ${cyl.num} ${valve}: the lobe holds its lifter off the base circle for ${open} crank deg, not the published ${pub}`);
      const azFollower = E.lifterAzimuth(cyl.bank);
      assert.ok(angDiff(wrap360(camAzimuth(cyl.bank, atTheta) + E.ohvLobeIndexAngle(cyl, valve)), azFollower) <= 1.5,
        `cyl ${cyl.num} ${valve}: the baked lobe index does not bring the nose onto the lifter axis at max lift (crank ${atTheta})`);
      // The same gate on the drawn part, at the pose the cam actually turns to.
      update(atTheta);
      group.updateMatrixWorld(true);
      const mesh = cam.getObjectByName(`lobe-cyl${cyl.num}-${valve}`);
      const q = new THREE.Quaternion();
      mesh.getWorldQuaternion(q);
      const nose = mesh.userData.noseDir.clone().applyQuaternion(q);
      assert.ok(angDiff(dirAz(nose), azFollower) <= 0.6,
        `cyl ${cyl.num} ${valve} at crank ${atTheta}: the drawn nose stands at ${dirAz(nose).toFixed(2)} deg off the cam axis, its lifter axis is ${azFollower.toFixed(2)} deg`);
      rows.push(`cyl ${cyl.num} ${valve[0]} ${max.toFixed(3)} @ ${atTheta}`);
    }
  }
  console.log(`${LAW} lift from the contact law: ${rows.join('; ')}; lifter axes L ${E.lifterAzimuth('L')} deg, R ${E.lifterAzimuth('R')} deg`);
});

test(`${LAW}: the drawn cam keeps the published lobe air inside its own tunnel and never reaches a ring it rides in`, async () => {
  const E = await eng();
  const { cam } = ohvTrain();
  const axis = axisPoint(E);
  const limit = H.tunnelBoreR - H.lobeAirCm;
  let over = 0, worst = 0, who = null;
  for (const o of cam.children) {
    for (const p of surfaceOf(o)) {
      const r = radiusOf(p, axis);
      if (r > limit + FACET) { over += 1; if (r - limit > worst) { worst = r - limit; who = o.name; } }
    }
  }
  assert.equal(over, 0, `${over} drawn cam surfaces stand past the bored tunnel ${H.tunnelBoreR.toFixed(4)} less the published ${H.lobeAirCm} cm lobe air (worst ${worst.toFixed(4)} past on ${who})`);
  const block = ohvCasting();
  const rings = newShell();
  block.traverse((o) => { if (/^cam-bushing-[1-5]$/.test(o.name)) shellAdd(rings, o); });
  let least = Infinity, leastWho = null;
  for (const o of cam.children) {
    if (!o.name.startsWith('lobe-')) continue;
    const near = closestToShell(o, rings);
    assert.ok(Number.isFinite(near.d), `${o.name}: a lobe came within ${REACH} cm of no ring - the scan is not reaching this tunnel`);
    assert.ok(near.d >= B.minAxialAir - FACET,
      `${o.name} stands ${near.d.toFixed(4)} cm from ${near.into}; the published axial air between a lobe group and a ring is ${B.minAxialAir.toFixed(4)} cm`);
    if (near.d < least) { least = near.d; leastWho = `${o.name} -> ${near.into}`; }
  }
  console.log(`${LAW} tunnel: cam stands at most ${limit.toFixed(4)} off its axis against the ${H.tunnelBoreR.toFixed(4)} bore (air ${H.lobeAirCm}); lobe to ring least ${least.toFixed(4)} cm (${leastWho})`);
});

test(`${LAW}: the central cam turns at exactly half crank speed in the crank's own sense and stays on its axis through a 720 deg cycle`, async () => {
  const E = await eng();
  const { group, cam, update } = ohvTrain();
  const axis = axisPoint(E);
  const rows = [];
  for (const th of [0, 90, 270, 719, 720]) {
    update(th);
    group.updateMatrixWorld(true);
    // The TURN, in the crank's own sense: cranktrain.js turns the crank
    // rotation.x = theta, the valvetrain turns its cams at half that, and
    // timing.js camAzimuth is the polar-frame AZIMUTH (CRANK.sense = -1: an
    // increasing rotation.x takes a polar azimuth the other way). Both halves
    // are gated: the turn against the published ratio, the azimuth on the drawn
    // nose through ohvLobeAzimuth, which is where the two conventions meet.
    const turn = (th / SPEC.cam.halfSpeedRatio) * DEG;
    assert.ok(Math.abs(cam.rotation.x - turn) <= 1e-12,
      `at crank ${th} deg the cam has turned ${(cam.rotation.x / DEG).toFixed(4)} deg, not the half-crank ${(turn / DEG).toFixed(4)} deg the published ${SPEC.cam.halfSpeedRatio}:1 ratio gives it`);
    assert.ok(Math.sign(cam.rotation.x) === Math.sign(th) || th === 0,
      `at crank ${th} the cam turns ${(cam.rotation.x / DEG).toFixed(2)} deg, the opposite sense to the crank it is driven by`);
    assert.ok(angDiff(wrap360(cam.rotation.x / DEG), wrap360(-camAzimuth('L', th))) <= 1e-9,
      `at crank ${th} deg the cam has turned ${(cam.rotation.x / DEG).toFixed(4)} deg, which is not the polar-frame azimuth ${camAzimuth('L', th).toFixed(4)} deg the timing math reports for it (CRANK.sense ${SPEC.crank.sense})`);
    const mesh = cam.getObjectByName('lobe-cyl1-intake');
    const q = new THREE.Quaternion();
    mesh.getWorldQuaternion(q);
    const nose = mesh.userData.noseDir.clone().applyQuaternion(q);
    assert.ok(angDiff(dirAz(nose), E.ohvLobeAzimuth(SPEC.cylinders[0], 'intake', th)) <= 1e-6,
      `cyl 1 intake at crank ${th}: the drawn nose does not track ohvLobeAzimuth`);
    const bb = new THREE.Box3().setFromObject(cam);
    const cy = (bb.max.y + bb.min.y) / 2, cz = (bb.max.z + bb.min.z) / 2;
    assert.ok(Math.abs(cy - axis.y) <= 0.2 && Math.abs(cz - axis.z) <= 0.2,
      `at crank ${th} the cam's own box centre stands at (y ${cy.toFixed(3)}, z ${cz.toFixed(3)}) instead of on the axis (y ${axis.y}, z ${axis.z}) - a cam that wanders off its axis is not running in its bearings`);
    rows.push(`${th}->${camAzimuth('L', th).toFixed(1)}`);
  }
  assert.ok(Math.abs(SPEC.crank.sense) === 1, 'the crank has to publish the sense every rotating part is turned in');
  console.log(`${LAW} drive side: crank deg -> cam deg ${rows.join(', ')}; sense ${SPEC.crank.sense}, ratio ${SPEC.cam.halfSpeedRatio}:1`);
});

test(`${LAW}: a cam clearance law that reads the base circle instead of the swept outline reports air this cam does not have`, async () => {
  const { cam } = ohvTrain();
  const swept = H.worstOutlineR, base = SPEC.head.camBaseRadius, bore = H.tunnelBoreR;
  assert.ok(Math.abs(bore - (swept + H.lobeAirCm)) < 1e-9,
    `the tunnel is bored ${bore.toFixed(4)} cm: the swept nose ${swept.toFixed(4)} plus the published ${H.lobeAirCm} cm of lobe air`);
  const claimed = bore - base; // what a base-circle law says is free around the cam
  const owed = bore - swept; // what the swept nose actually leaves: the published lobe air
  assert.ok(claimed - owed > 0.5,
    `a law reading the ${base} cm base circle claims ${claimed.toFixed(4)} cm of air past the cam; the widest outline the cam actually presents is the swept nose ${swept.toFixed(4)}, so the air owed is ${owed.toFixed(4)} cm - the lie is ${(claimed - owed).toFixed(4)} cm of centre distance and clearance that does not exist`);
  // ...and the drawn cam really does present that outline, so the claim is measurable.
  const axis = axisPoint(await eng());
  let maxR = 0;
  for (const o of cam.children) for (const p of surfaceOf(o)) maxR = Math.max(maxR, radiusOf(p, axis));
  assert.ok(Math.abs(maxR - swept) <= FACET, `the drawn cam presents ${maxR.toFixed(4)} cm, not the swept outline ${swept.toFixed(4)} the bore is sized around`);
  console.log(`${LAW} oracle: a base-circle law claims ${claimed.toFixed(4)} cm past the cam, the drawn nose of ${maxR.toFixed(4)} leaves ${(bore - maxR).toFixed(4)}`);
});
