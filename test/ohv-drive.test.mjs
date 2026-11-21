// Slice 8C-2b (issue #8 item 3, issue #24, GATES row A1-G2 OHV half): the crank-
// to-cam chain of the central-cam variant. One 18-tooth lane on the crank nose
// and one bored 36-tooth sprocket on the cam, in one published 0.3 cm band, at
// the published 1.20428 cm pitch, on the published 10.8 cm centre distance.
//
// Written RED first: every law below measures a drive this tree does not draw
// yet. The contract numbers were probed before the laws were written
// (tmp/v8-8c2a-chain.out, tmp/ohvchain.mjs) and the laws gate them.
//
// What this file does NOT gate, and says so: the follower train (16 lifters,
// 16 pushrods, 16 rockers, 2 covers - SPEC.variants.ohv.drawn is still false,
// slice 8C-3) and the OHV head/cover hardware.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SPEC } from '../src/engine/spec.js';
import { ohvBearings } from '../src/engine/layout.js';
import { createBlock } from '../src/render/block.js';
import { createCranktrain } from '../src/render/cranktrain.js';
import { createStand } from '../src/render/stand.js';
import { createValvetrain } from '../src/render/valvetrain.js';
import { newShell, shellAdd, closestToShell, surfaceOf } from './support/surface-clearance.mjs';

// Imported inside each law, not at module scope: a top-level import of a name the
// tree does not export yet reds the whole file instead of the law. D is the
// measured chain law, R is the assembly it draws.
const D = () => import('../src/engine/drive.js');
const R = () => import('../src/render/drive.js');

const C = SPEC.chain;
const CS = SPEC.crank.sprocket;
const KS = SPEC.cam.sprocket;
const VAR = SPEC.variants.ohv;
const S = SPEC.stand;
const B = ohvBearings();
const LAW = 'OHV-DRIVE';
const DEG = Math.PI / 180;
const EPS = 1e-4; // a float32 drawn vertex holds a float64 machined value about this closely
const FACET = 0.006; // the polygon step a turned bore presents (test/heads.test.mjs uses this)

const mats = () => new Proxy({}, { get: (t, k) => (t[k] ??= new THREE.MeshStandardMaterial({ name: String(k) })) });

function posed(obj) {
  obj.updateMatrixWorld(true, true);
  return obj;
}

/** Meshes of one assembly, by name predicate. */
function meshes(root, pick) {
  const out = [];
  posed(root).traverse((o) => { if (o.isMesh && pick(o)) out.push(o); });
  return out;
}

/** The drive assembly of this variant: chains plus the cam-side drive hardware. */
async function ohvDrive() {
  const d = await R();
  const built = d.createDrive(mats(), 'ohv');
  return { ...built, group: posed(built.group) };
}

/** The DOHC drive, for the half of the laws that must prove this variant did not move it. */
async function dohcDrive() {
  const d = await R();
  const built = d.createDrive(mats(), 'dohc');
  return { ...built, group: posed(built.group) };
}

/** The OHV crank, drawn for this variant. */
function ohvCrank() {
  const built = createCranktrain(mats(), 'ohv');
  return posed(built.group);
}

function ohvCam() {
  const built = createValvetrain(mats(), 'ohv');
  const cam = posed(built.group).getObjectByName('cam-V-central');
  assert.ok(cam, 'the OHV build draws no cam to put a drive on');
  return cam;
}

/**
 * Iron and stand this drive must fit among: the variant's own casting, its
 * clamping frame, and the crank it takes its power from. The cam and its drive
 * hardware are left out on purpose - the pair is measured by law "the OHV cam
 * carries its drive on a turned pilot", which knows which faces are a press fit.
 */
async function surroundings() {
  const shell = newShell();
  const block = posed(createBlock(mats(), 'ohv'));
  block.traverse((o) => { if (o.isMesh) shellAdd(shell, o); });
  const stand = createStand(mats(), 'ohv');
  posed(stand.group).traverse((o) => { if (o.isMesh) shellAdd(shell, o); });
  ohvCrank().traverse((o) => { if (o.isMesh) shellAdd(shell, o); });
  return shell;
}

const camAxis = () => new THREE.Vector3(0, 0, -VAR.belowCrankCm);
const radiusOff = (o, axis) => Math.max(...surfaceOf(o).map((p) => Math.hypot(p.y - axis.y, p.z - axis.z)));
const box3 = (o) => new THREE.Box3().setFromObject(o);

// ---------------------------------------------------------------------------
test(`${LAW}: the OHV variant drives its central cam with a real 18/36-tooth roller chain on the published 3.45 and 6.9 pitch circles, at the published centre distance, wrapping whole teeth`, async () => {
  const d = await D();
  assert.equal(typeof d.ohvChainLayout, 'function', 'src/engine/drive.js publishes no ohvChainLayout: this variant has no computed chain path at all');
  const lay = d.ohvChainLayout();
  assert.equal(lay.teeth.crank, CS.teeth, `the crank end of this chain has ${lay.teeth.crank} teeth, not the published ${CS.teeth}`);
  assert.equal(lay.teeth.cam, KS.teeth, `the cam end of this chain has ${lay.teeth.cam} teeth, not the published ${KS.teeth}`);
  assert.equal(KS.teeth, 2 * CS.teeth, 'the 2:1 half-speed law is only machined when the cam carries exactly 2x the crank teeth');
  assert.ok(Math.abs(KS.pitchR - 2 * CS.pitchR) < 1e-9, 'and 2x the pitch circle: the two sprockets must share one chain pitch');
  assert.ok(Math.abs(d.chainPitch(KS) - d.chainPitch(CS)) < 1e-9,
    `the two sprockets give pitches ${d.chainPitch(KS).toFixed(6)} and ${d.chainPitch(CS).toFixed(6)}: one chain cannot run on both`);
  assert.ok(Math.abs(lay.pitch - 1.204277) < 1e-4, `this chain pitch is ${lay.pitch.toFixed(6)} cm, not the published 1.204 cm of issue #8 item 3`);
  assert.equal(lay.D, VAR.belowCrankCm, `the chain runs to a cam ${lay.D} cm under the crank, not the published ${VAR.belowCrankCm}`);
  const { crank, cam } = lay.wrap;
  assert.ok(Number.isInteger(crank) && Number.isInteger(cam),
    `a chain takes whole teeth: this path wraps ${crank} crank teeth and ${cam} cam teeth`);
  const turn = crank * (360 / CS.teeth) + cam * (360 / KS.teeth);
  assert.ok(Math.abs(turn - 360) < 1e-9,
    `the two wraps turn ${turn.toFixed(4)} crank degrees; a whole-link chain closes the loop only at exactly 360`);
  assert.equal(lay.bandIndex, d.ohvLaneIndex, `this chain was put in band ${lay.bandIndex}, not the published band ${d.ohvLaneIndex}`);
  const band = KS.bands[lay.bandIndex];
  assert.ok(Math.abs(lay.cam.y) < 1e-9, 'the central cam stands on the V bisector, so its chain runs in the y = 0 plane');
  console.log(`${LAW} contract: pitch ${lay.pitch.toFixed(6)} cm; teeth ${CS.teeth}/${KS.teeth}; pitchR ${CS.pitchR}/${KS.pitchR} sum ${(CS.pitchR + KS.pitchR).toFixed(4)}; centre ${lay.D.toFixed(4)}; wrap ${crank}+${cam} of ${CS.teeth}/${KS.teeth}; links ${lay.linkCount}; loop ${lay.loop.toFixed(4)}; band ${band.toFixed(4)}..${(band + KS.width).toFixed(4)}`);
});

test(`${LAW}: every link of the OHV chain keeps the published pitch at every pose of the 720 deg cycle, and no link is stretched or shortened to make the path close`, async () => {
  const d = await D();
  const lay = d.ohvChainLayout();
  let worst = 0, worstAt = null, seats = new Set(), poses = 0;
  for (let theta = 0; theta < 720; theta++) {
    const pose = d.chainPose(lay, theta);
    poses += 1;
    for (const l of pose.links) {
      const err = Math.abs(l.chord - lay.pitch);
      if (err > worst) { worst = err; worstAt = { theta, on: `${l.a.on}->${l.b.on}`, chord: l.chord }; }
    }
    for (const r of pose.rollers) if (r.on !== 'span') seats.add(`${r.on}:${r.gap}`);
    assert.equal(pose.linkCount, lay.linkCount, `the loop changed link count at crank ${theta}: ${pose.linkCount} against ${lay.linkCount}`);
  }
  assert.ok(worst < 1e-9, `${worstAt.on} link measures ${worstAt.chord.toFixed(8)} cm at crank ${worstAt.theta} deg against the published pitch ${lay.pitch.toFixed(6)}: the path was made to close by bending a link`);
  assert.equal(poses, 720, `only ${poses} crank poses were sampled of the 720 deg cycle`);
  assert.equal(seats.size, CS.teeth + KS.teeth, `across the cycle this chain touched ${seats.size} machined tooth gaps, not all ${CS.teeth + KS.teeth}: part of a sprocket is never driven`);
  console.log(`${LAW} pitch: ${poses} poses, ${lay.links.length} links, worst chord error ${worst.toExponential(2)} cm, every gap of both sprockets engaged`);
});

test(`${LAW}: the OHV chain takes a whole number of links on each straight run, every pose of the 720 deg cycle is feasible, and the surplus each span leaves over stays inside the published tensioner travel`, async () => {
  const d = await D();
  const lay = d.ohvChainLayout();
  let infeasible = 0, worst = 0, worstAt = null;
  for (let theta = 0; theta < 720; theta++) {
    const pose = d.chainPose(lay, theta);
    const takeUp = Math.max(pose.spans.A.takeUp, pose.spans.B.takeUp);
    if (!pose.engagement.feasible) infeasible += 1;
    if (takeUp > worst) { worst = takeUp; worstAt = theta; }
    for (const key of ['A', 'B']) {
      assert.ok(Number.isInteger(pose.spans[key].links) && pose.spans[key].links >= lay.spansFixed[key],
        `span ${key} at crank ${theta} carries ${pose.spans[key].links} links against the design count ${lay.spansFixed[key]}: a run of a rigid chain is a whole number of links`);
      assert.ok(pose.spans[key].takeUp > 0, `span ${key} at crank ${theta} is ${pose.spans[key].takeUp.toFixed(6)} cm over: the span is straight or taut, which is what a tensioner exists to prevent`);
    }
  }
  assert.equal(infeasible, 0, `${infeasible} of 720 crank poses cannot be taken up by a rigid ${lay.linkCount}-link chain inside ${C.tensionerTravel} cm of tensioner travel: this path does not close`);
  assert.ok(worst <= C.tensionerTravel, `the worst measured closure ${worst.toFixed(4)} cm at crank ${worstAt} deg exceeds the published tensioner travel ${C.tensionerTravel} cm`);
  const links = { A: lay.spansFixed.A, B: lay.spansFixed.B };
  assert.ok(links.A + links.B + lay.wrap.crank + lay.wrap.cam === lay.linkCount,
    `the run counts ${links.A}+${links.B} links and the wraps ${lay.wrap.crank}+${lay.wrap.cam} teeth do not add up to a ${lay.linkCount}-link loop`);
  console.log(`${LAW} links: spans ${links.A} and ${links.B} whole links, ${lay.linkCount} links on ${lay.loop.toFixed(4)} cm, 0 infeasible of 720, worst take-up ${worst.toFixed(4)} cm at crank ${worstAt} deg against ${C.tensionerTravel} cm of travel`);
});

// ---------------------------------------------------------------------------
test(`${LAW}: the OHV chain seats a roller in every machined tooth space it engages, on that sprocket's own wrap polygon, and no roller stands on a tooth tip or rubs a gap flank`, async () => {
  const d = await D();
  const lay = d.ohvChainLayout();
  const cutR = d.gapCutR();
  const teeth = { crank: CS.teeth, cam: KS.teeth };
  const pitchR = { crank: CS.pitchR, cam: KS.pitchR };
  let leastInGap = Infinity, inGapAt = null, leastTip = Infinity, tipAt = null, shared = 0;
  for (let theta = 0; theta < 720; theta++) {
    const pose = d.chainPose(lay, theta);
    const used = { crank: new Set(), cam: new Set() };
    for (const r of pose.rollers) {
      if (r.on === 'span') continue;
      const which = r.on;
      if (used[which].has(r.gap)) shared += 1;
      used[which].add(r.gap);
      const at = Math.hypot(r.rel.y, r.rel.z);
      assert.ok(Math.abs(at - lay.wrapR[which]) < 1e-9,
        `at crank ${theta} deg the ${which} roller called gap ${r.gap} stands ${at.toFixed(6)} cm off the ${which} axis: a chain seats on the wrap polygon ${lay.wrapR[which].toFixed(6)}, which pitch ${pitchR[which]} and ${teeth[which]} teeth give from the pitch`);
      // The space was cut with a disc of radius rollerR + gapClr centred ON the
      // pitch circle: the roller is inside that disc by that much minus its own radius.
      const inGap = cutR - Math.abs(at - pitchR[which]) - C.rollerR;
      assert.ok(inGap > 0, `at crank ${theta} deg the ${which} roller in gap ${r.gap} is ${(-inGap).toFixed(6)} cm PAST the flank of the ${cutR.toFixed(4)} cm cutter arc that gap was machined with`);
      if (inGap < leastInGap) { leastInGap = inGap; inGapAt = { theta, which, gap: r.gap }; }
      // And the machined rim has to cross this roller's own disc: outboard of its
      // centre, so the gap flanks carry the load, and not past its crown, so the
      // link drops into the gap instead of standing on the tooth tip. Both bounds
      // are the pair test/valvetrain.test.mjs already pins for the four DOHC chains.
      const rimAir = d.tipRadius(pitchR[which]) - at;
      assert.ok(rimAir > 0,
        `at crank ${theta} deg the ${which} roller in gap ${r.gap} stands at radius ${at.toFixed(6)} cm, outside the machined rim circle ${d.tipRadius(pitchR[which]).toFixed(4)}: that roller rides over the teeth, which is the flat-band drive issue #4 rejected`);
      assert.ok(rimAir < C.rollerR,
        `at crank ${theta} deg the ${which} tip circle stands ${rimAir.toFixed(6)} cm outboard of the roller centre it drives, past the ${C.rollerR} cm roller radius: a tooth that overshoots its roller keeps the link from dropping into the gap ${r.gap} machined for it`);
      if (rimAir < leastTip) { leastTip = rimAir; tipAt = { theta, which, gap: r.gap }; }
      const floorAir = (at - C.rollerR) - d.rootRadius(pitchR[which]);
      assert.ok(floorAir >= C.gapClr - EPS,
        `at crank ${theta} deg the roller in the ${which} gap ${r.gap} leaves ${floorAir.toFixed(6)} cm to the gap floor; the published gap air is ${C.gapClr} cm`);
    }
    for (const which of ['crank', 'cam']) {
      assert.equal(used[which].size, lay.wrap[which] + 1,
        `at crank ${theta} deg only ${used[which].size} distinct ${which} tooth gaps carry a roller for a ${lay.wrap[which] + 1}-seat wrap: two rollers in one machined gap is an impossible chain`);
      for (const g of used[which]) assert.ok(g >= 0 && g < teeth[which], `a ${which} seat reported machined gap ${g} of ${teeth[which]}`);
    }
  }
  assert.equal(shared, 0, `${shared} poses put two rollers of this chain into one machined tooth gap`);
  console.log(`${LAW} seats: worst flank air ${leastInGap.toFixed(6)} cm (${inGapAt.which} gap ${inGapAt.gap} at crank ${inGapAt.theta}), least rim air past the roller centre ${leastTip.toFixed(6)} cm (${tipAt.which} gap ${tipAt.gap} at crank ${tipAt.theta}), cutter arc ${cutR.toFixed(4)}, wrap polygons ${lay.wrapR.crank.toFixed(4)}/${lay.wrapR.cam.toFixed(4)}`);
});

// ---------------------------------------------------------------------------
test(`${LAW}: the 36-tooth cam sprocket is turned down over the arc that faces the crank, because the published 10.8 cm centre distance holds no room for two full tip circles`, async () => {
  const d = await D();
  assert.equal(typeof d.ohvSprocketTipR, 'function', 'src/engine/drive.js publishes no OHV cam-sprocket tip radius: the drive was drawn without checking its tip circles against the centre distance');
  const lay = d.ohvChainLayout();
  const fullTip = d.tipRadius(KS.pitchR), crankTip = d.tipRadius(CS.pitchR);
  const crowding = fullTip + crankTip - VAR.belowCrankCm;
  assert.ok(crowding > 0,
    `the published tip circles ${fullTip.toFixed(4)} and ${crankTip.toFixed(4)} now sum to ${fullTip.toPrecision(6)} + ${crankTip.toFixed(4)} = ${(fullTip + crankTip).toFixed(4)} cm against a centre distance of ${VAR.belowCrankCm}: this row's rejection of interpenetrating teeth would not apply here`);
  const relief = VAR.belowCrankCm - crankTip - C.gapClr;
  assert.ok(Math.abs(d.ohvSprocketTipR() - relief) < 1e-6,
    `the OHV cam sprocket is turned to tip radius ${d.ohvSprocketTipR().toFixed(6)} cm; the published gap ${C.gapClr} cm off the ${crankTip.toFixed(4)} cm crank tip at ${VAR.belowCrankCm} cm centre distance gives ${relief.toFixed(6)}`);
  assert.ok(relief < fullTip, `the turn-down ${fullTip.toFixed(4)} -> ${relief.toFixed(4)} cm is not a turn-down at all`);
  assert.ok(relief > d.rootRadius(KS.pitchR),
    `a tip radius of ${relief.toFixed(4)} cm is at or under the gap floor ${d.rootRadius(KS.pitchR).toFixed(4)}: that is not a tooth left on the sprocket`);
  assert.ok(relief + C.rollerR >= d.wrapRadius(KS.teeth) - EPS,
    `the relieved rim ${relief.toFixed(4)} cm would not even reach the ${d.wrapRadius(KS.teeth).toFixed(4)} cm wrap polygon this chain seats on: the wrapped teeth could not drive it`);
  const nonWrapDeg = 360 - lay.wrap.cam * (360 / KS.teeth);
  const wrapArc = { teeth: lay.wrap.cam, deg: lay.wrap.cam * (360 / KS.teeth) };
  assert.equal(wrapArc.deg + nonWrapDeg, 360, 'the wrapped and unclad arcs of the cam sprocket must account for the whole circle');
  assert.equal(nonWrapDeg, (KS.teeth - lay.wrap.cam) * (360 / KS.teeth), 'the unclad arc is the teeth the chain does not engage');
  // The turn-down is metal on this sprocket, not a number in a spec sheet: the
  // 14 teeth the chain does not clad read the relieved tip, the 22 it clads read
  // the published rim, and the relieved run faces the crank it must clear.
  const built = await ohvDrive();
  const drawn = meshes(built.group, (o) => /cam-V-sprocket/.test(o.name))[0]
    ?? meshes(ohvCam(), (o) => /cam-V-sprocket/.test(o.name))[0];
  assert.ok(drawn, 'no drawn 36-tooth cam sprocket to measure the turn-down on');
  const tips = landTips(drawn, camAxis(), lay.phase.cam, KS.teeth);
  const turned = tips.filter((t) => Math.abs(t.tipR - relief) <= FACET);
  const rimmed = tips.filter((t) => Math.abs(t.tipR - fullTip) <= FACET);
  const step = 360 / KS.teeth;
  const facing = (lay.phi + 180) % 360; // the azimuth the crank stands at, seen from this cam
  assert.equal(tips.length, KS.teeth, `this sprocket presents ${tips.length} machined teeth, not ${KS.teeth}`);
  assert.equal(turned.length, KS.teeth - lay.wrap.cam,
    `${turned.length} of ${KS.teeth} teeth read the relieved tip ${relief.toFixed(4)} cm; the chain clads ${lay.wrap.cam} teeth (${wrapArc.deg.toFixed(0)} deg), so exactly ${KS.teeth - lay.wrap.cam} teeth over the ${nonWrapDeg.toFixed(0)} deg unclad arc may be turned down and no more`);
  assert.equal(rimmed.length, lay.wrap.cam,
    `${rimmed.length} teeth still read the full rim ${fullTip.toFixed(4)} cm against the ${lay.wrap.cam} teeth the chain runs on: a sprocket turned down where the chain seats cannot drive that chain`);
  assert.equal(turned.length + rimmed.length, KS.teeth,
    `${turned.length} turned + ${rimmed.length} rimmed of ${KS.teeth} teeth leaves ${KS.teeth - turned.length - rimmed.length} teeth at some other radius: a machined sprocket presents its relief circle or its rim circle, nothing between`);
  for (const t of turned) {
    const off = Math.abs(angDelta(t.az, facing));
    assert.ok(off <= nonWrapDeg / 2 - step / 2 + 0.5,
      `tooth ${t.k} at azimuth ${t.az.toFixed(2)} deg is turned down ${off.toFixed(2)} deg round from the crank-facing azimuth ${facing.toFixed(0)} deg, outside the ${nonWrapDeg.toFixed(0)} deg arc the chain leaves unclad (the widest tooth centre that arc holds is ${nonWrapDeg / 2 - step / 2} deg off it): the relief is where the ${fullTip.toFixed(4)} cm tip circle crowds the ${crankTip.toFixed(4)} cm crank tip, and nowhere else`);
  }
  for (const t of rimmed) {
    const off = Math.abs(angDelta(t.az, facing));
    assert.ok(off >= nonWrapDeg / 2 + step / 2 - 0.5,
      `tooth ${t.k} keeps the full ${fullTip.toFixed(4)} cm rim at ${off.toFixed(2)} deg from the crank-facing azimuth ${facing.toFixed(0)} deg; the unclad arc reaches ${nonWrapDeg / 2} deg, so this tooth stands in the room the two tip circles do not have (${(fullTip + crankTip).toFixed(4)} cm of tip against ${VAR.belowCrankCm} cm of centre distance)`);
  }
  const run = turned.map((t) => t.k).sort((a, b) => a - b);
  const spanned = (run[run.length - 1] - run[0] + 1);
  assert.equal(spanned, turned.length, `the turned-down teeth ${run.join(',')} are not one contiguous arc (${spanned} positions for ${turned.length} teeth): a machined relief is a run, not a scatter`);
  console.log(`${LAW} relief: tip circles ${fullTip.toFixed(4)}+${crankTip.toFixed(4)} = ${(fullTip + crankTip).toFixed(4)} cm crowd the ${VAR.belowCrankCm} cm centre distance by ${crowding.toFixed(4)} cm; ${turned.length} teeth turned to ${relief.toFixed(6)} cm over the unclad ${nonWrapDeg.toFixed(0)} deg arc facing azimuth ${facing.toFixed(0)}, ${rimmed.length} teeth kept at ${fullTip.toFixed(4)} cm over the clad ${wrapArc.deg.toFixed(0)} deg`);
});

// ---------------------------------------------------------------------------
test(`${LAW}: the OHV cam carries its drive on a turned pilot standing in its own retainer opening at the published nose air, and the sprocket and its retaining collar keep clear of the stand arm that clamps this variant`, async () => {
  const d = await D();
  const cam = ohvCam();
  const built = await ohvDrive();
  const crank = ohvCrank();
  const stand = posed(createStand(mats(), 'ohv').group);
  const axis = camAxis();
  const band = KS.bands[0], bandEnd = band + KS.width;
  const pick = (root, re) => meshes(root, (o) => re.test(o.name));
  const pilots = pick(cam, /cam-V-pilot/).concat(pick(built.group, /cam-V-pilot/));
  const capture = pick(cam, /cam-V-(shoulder|collar)/).concat(pick(built.group, /cam-V-(shoulder|collar)/));
  const sprockets = pick(cam, /cam-V-sprocket/).concat(pick(built.group, /cam-V-sprocket/));
  assert.equal(pilots.length, 1, `the OHV cam carries ${pilots.length} drive pilots; issue #8 item 3 wants one crank-to-cam drive, located by one turned pilot`);
  assert.equal(capture.length, 2, `the OHV cam drive is located by ${capture.length} parts against its sprocket ([${capture.map((o) => o.name).join(', ')}]): a bored 36-tooth sprocket needs a machined shoulder on one side and a retaining collar on the other, or it walks off the pilot under chain load`);
  assert.equal(sprockets.length, 1, `the OHV cam carries ${sprockets.length} drive sprockets, and this variant has exactly one chain`);
  // The pilot is the published nose, and it passes the published retainer opening.
  const pilotR = Math.max(...surfaceOf(pilots[0]).map((p) => Math.hypot(p.y - axis.y, p.z - axis.z)));
  assert.ok(Math.abs(pilotR - B.noseR) <= FACET,
    `the drive pilot stands ${pilotR.toFixed(4)} cm off the cam axis; this cam's machined nose - the widest thing it presents, and the diameter its own rings are bored around - is ${B.noseR.toFixed(4)} cm (test/ohv-cam.test.mjs: the cam is insertable through its own retainer opening)`);
  assert.ok(Math.abs(B.plateInR - pilotR - B.noseAirCm) <= FACET,
    `the pilot of ${pilotR.toFixed(4)} in the retainer opening of ${B.plateInR.toFixed(4)} leaves ${(B.plateInR - pilotR).toFixed(4)} cm; this tree publishes the nose air as ${B.noseAirCm.toFixed(4)}`);
  // The plate only: this casting bolts that plate down with two named fasteners,
  // and a fastener is not the plate the pilot stands in.
  const plate = pick(createBlock(mats(), 'ohv'), /^cam-retainer$/);
  assert.equal(plate.length, 1, `the OHV casting draws ${plate.length} cam retainer plates for the pilot to stand in`);
  const pBox = box3(pilots[0]);
  assert.ok(pBox.max.x >= B.plateForeX - EPS, `the pilot ends at x ${pBox.max.x.toFixed(4)}, short of the retainer plate's fore face at ${B.plateForeX.toFixed(4)}: nothing stands outboard of the plate to locate the sprocket`);
  const plateAir = closestToShell(pilots[0], (() => { const s = newShell(); plate.forEach((o) => shellAdd(s, o)); return s; })());
  assert.ok(plateAir.d >= C.bandClr - EPS, `the pilot is ${plateAir.d.toFixed(4)} cm from ${plateAir.into}: it must run in the retainer opening, not through the plate beside it`);
  // The sprocket lives in the published band, on the pilot, fore of the plate.
  const sBox = box3(sprockets[0]);
  assert.ok(sBox.min.x >= band - EPS && sBox.max.x <= bandEnd + EPS,
    `the cam sprocket spans x ${sBox.min.x.toFixed(4)}..${sBox.max.x.toFixed(4)}; the only band this variant's chain runs in is ${band.toFixed(4)}..${bandEnd.toFixed(4)} (${d.ohvDriveCorridor().x0.toFixed(4)}..${d.ohvDriveCorridor().x1.toFixed(4)})`);
  assert.ok(Math.abs((sBox.min.x + sBox.max.x) / 2 - d.bandCentreX(0)) <= EPS,
    `the sprocket is centred at x ${((sBox.min.x + sBox.max.x) / 2).toFixed(4)}, not the middle of its band (${d.bandCentreX(0).toFixed(4)})`);
  assert.ok(Math.abs((sBox.max.x - sBox.min.x) - C.toothW) <= EPS, `the sprocket is ${(sBox.max.x - sBox.min.x).toFixed(4)} cm thick across the chain band; the machined tooth is ${C.toothW} cm (SPEC.chain.channel less 2 x SPEC.chain.plateClr)`);
  // The capture hardware is located against the cam, not against the frame: every
  // part of it keeps the published air off the clamped frame members.
  const frame = newShell();
  meshes(stand, (m) => /^(arm|column|jaw|skid|sideTie|tie|bed|post|pad|brace)-/.test(m.name)).forEach((m) => shellAdd(frame, m));
  let worstFrame = Infinity, frameWho = null;
  for (const o of [pilots[0], ...capture, sprockets[0]]) {
    const near = closestToShell(o, frame);
    if (near.d < worstFrame) { worstFrame = near.d; frameWho = `${o.name} -> ${near.into}`; }
    assert.ok(near.d >= S.minAir - EPS, `${o.name} stands ${near.d.toFixed(4)} cm of air off ${near.into}; the published air a part keeps off this stand is ${S.minAir} cm (SPEC.stand.minAir), and the corridor slice 8C-2a published is ${d.ohvDriveCorridor().x0.toFixed(4)}..${d.ohvDriveCorridor().x1.toFixed(4)} with that much air off the frame`);
  }
  // The sprocket is trapped between its shoulder and its collar along the pilot.
  const aft = capture.filter((o) => box3(o).max.x <= sBox.min.x + EPS);
  const fore = capture.filter((o) => box3(o).min.x >= sBox.max.x - EPS);
  assert.ok(aft.length === 1 && fore.length === 1, `the sprocket's own faces x ${sBox.min.x.toFixed(4)} / ${sBox.max.x.toFixed(4)} are bounded by ${aft.length} machined shoulder(s) aft and ${fore.length} collar(s) fore (band ${band.toFixed(4)}..${bandEnd.toFixed(4)}); a sprocket has to stand between two located faces or it walks out of its band under chain load`);
  for (const o of aft.concat(fore)) {
    const bb = box3(o);
    const land = aft.includes(o) ? sBox.min.x - bb.max.x : bb.min.x - sBox.max.x;
    assert.ok(Math.abs(land - C.bandClr) <= EPS, `${o.name} stands ${land.toFixed(4)} cm off the sprocket flank; the published clearance a locating face keeps off a machined tooth flank is ${C.bandClr} cm (SPEC.chain.bandClr), the same clearance the shoulder and collar on the crank nose are machined with`);
    const rr = Math.max(...surfaceOf(o).map((q) => Math.hypot(q.y - axis.y, q.z - axis.z)));
    assert.ok(Math.abs(rr - d.hubRadius(KS.pitchR)) <= FACET, `${o.name} is turned to ${rr.toFixed(4)} cm; the hub the ${KS.teeth}-tooth teeth hang on is ${d.hubRadius(KS.pitchR).toFixed(4)} cm (the gap floor ${d.rootRadius(KS.pitchR).toFixed(4)} less the published hub air ${C.hubClr}), so a locating face has to be turned to the hub it stands against`);
  }
  // The capture must actually stand against something machined: at least one part
  // sits aft of the corridor's fore x0, i.e. on the cam, not out in the chain band.
  const onTheCam = [pilots[0], ...capture, sprockets[0]].filter((o) => box3(o).min.x < d.ohvDriveCorridor().x0);
  assert.ok(onTheCam.length >= 1, `every part of this drive starts fore of the chain corridor at x ${d.ohvDriveCorridor().x0.toFixed(4)}: nothing of it is mounted on the cam it is supposed to drive`);
  console.log(`OHV-DRIVE capture: pilot ${pilotR.toFixed(4)} in plate opening ${B.plateInR.toFixed(4)} (nose air ${plateAir.d.toFixed(4)}), sprocket x ${sBox.min.x.toFixed(4)}..${sBox.max.x.toFixed(4)} in band ${band.toFixed(4)}..${bandEnd.toFixed(4)}, ${onTheCam.length} part(s) mounted on the cam, least frame air ${worstFrame.toFixed(4)} cm (${frameWho})`);
});

// ---------------------------------------------------------------------------
/** Per-azimuth maximum radius of a drawn mesh around an axis, in 0.5 deg bins. */
function radiusBins(mesh, axis, bins = 720) {
  const out = new Array(bins).fill(-Infinity);
  for (const p of surfaceOf(mesh)) {
    const r = Math.hypot(p.y - axis.y, p.z - axis.z);
    const az = (Math.atan2(p.y - axis.y, p.z - axis.z) / DEG + 360) % 360; // src/engine/drive.js azimuth(y, z)
    const i = Math.floor((az * bins) / 360) % bins;
    if (r > out[i]) out[i] = r;
  }
  return out;
}

/**
 * How many teeth a drawn sprocket really carries: the number of machined gap
 * floors. src/engine/drive.js rootRadius() IS the innermost point of the cutter
 * arc that machines a gap, so every drawn gap presents an azimuth arc sitting ON
 * that radius circle and nothing else on the part does. The earlier instrument -
 * rise crossings of the tip/root midline - counted false lows (a cap-triangulation
 * chord stretched across a gap, or a bin that only caught the turned bore) and read
 * 54 crossings on a real 18-tooth lane; the gap floor is the machined fact.
 */
function drawnTeeth(mesh, axis, rootR, bins = 720) {
  const b = radiusBins(mesh, axis, bins);
  const on = (i) => {
    const v = b[((i % bins) + bins) % bins];
    return Number.isFinite(v) && Math.abs(v - rootR) <= FACET;
  };
  let n = 0;
  for (let i = 0; i < bins; i++) {
    if (!on(i) || on(i - 1)) continue;
    let width = 1;
    while (width < bins && on(i + width)) width += 1;
    if (width >= 2) n += 1; // a machined gap floor is an arc, not one stray sample
  }
  return n;
}

/**
 * The tip radius each machined tooth actually presents: the maximum distance off
 * the axis over a window half a tooth wide centred on that tooth. A tooth's own
 * tip point is inside its window, and the flanks of the two gaps beside it rise
 * to that same tooth's tip - so a turned-down tooth reads its relief and its
 * neighbour reads the full rim, with no ambiguity.
 */
function landTips(mesh, axis, gapPhaseDeg, teeth, bins = 720) {
  const b = radiusBins(mesh, axis, bins);
  const step = 360 / teeth, half = step / 2;
  const per = bins / 360;
  return Array.from({ length: teeth }, (_, k) => {
    const centre = (gapPhaseDeg + k * step + half + 360) % 360;
    const span = Math.round(half * per) - 1;
    let max = -Infinity;
    for (let i = -span; i <= span; i++) max = Math.max(max, b[Math.round(centre * per) + i >= bins ? (Math.round(centre * per) + i) % bins : Math.round(centre * per) + i]);
    return { k, az: centre, tipR: max };
  });
}

/**
 * One rigid direction written by a machined pattern: the vector sum of every
 * surface point of this part that stands in a chosen radius band off its own
 * axis. A rotation about that axis preserves every point's radius, so the same
 * material points are selected at every pose and the sum turns with the part -
 * an angle that can be tracked continuously, with no tooth-grid quantization.
 */
function patternAngle(mesh, axis, lo, hi) {
  let sy = 0, sz = 0, n = 0;
  for (const p of surfaceOf(mesh)) {
    const y = p.y - axis.y, z = p.z - axis.z, r = Math.hypot(y, z);
    if (r < lo || r > hi) continue;
    sy += y; sz += z; n += 1;
  }
  return { az: (Math.atan2(sy, sz) / DEG + 360) % 360, mag: Math.hypot(sy, sz), n };
}

const angDelta = (a, b) => ((a - b + 540) % 360) - 180;

test(`${LAW}: the OHV build draws exactly one chain in exactly one published band, one 18-tooth lane on its crank, and keeps the DOHC build's four chains and four lanes untouched`, async () => {
  const d = await D();
  const ohv = await ohvDrive();
  const crank = ohvCrank();
  const dohcBuilt = await dohcDrive();
  const dohcCrank = posed(createCranktrain(mats(), 'dohc').group);
  const laneOf = (root) => meshes(root, (o) => /^sprocket-lane-/.test(o.name));
  const ohvLanes = laneOf(crank), dohcLanes = laneOf(dohcCrank);
  assert.equal(ohvLanes.length, 1, `the OHV crank carries ${ohvLanes.length} chain lanes; this variant has one cam to drive and issue #8 item 3 wants exactly one crank-to-cam chain, on one 18-tooth lane`);
  assert.equal(dohcLanes.length, 4, `the DOHC build now draws ${dohcLanes.length} crank lanes instead of its four driven cam sprockets - variant-aware rendering moved the DOHC drive`);
  const band = KS.bands[0], bandEnd = band + KS.width;
  const chainParts = meshes(ohv.group, (o) => /-(roller|plates-in|plates-out|guide|tensioner)/.test(o.name));
  assert.ok(chainParts.length > 0, 'the OHV build draws no chain: no rollers, no plates, no guide, no tensioner');
  const parents = new Set(chainParts.map((o) => o.parent?.name));
  assert.equal(parents.size, 1, `the OHV drive's chain parts sit in ${parents.size} chain groups (${[...parents].join(', ')}); this variant has one chain`);
  assert.equal(ohv.chains.length, 1, `createDrive(mats,'ohv') built ${ohv.chains.length} chains for a variant with one cam`);
  for (const o of chainParts) {
    const bb = box3(o);
    assert.ok(bb.min.x >= band - EPS && bb.max.x <= bandEnd + EPS, `${o.name} spans x ${bb.min.x.toFixed(4)}..${bb.max.x.toFixed(4)}; this variant's single chain runs in the band ${band.toFixed(4)}..${bandEnd.toFixed(4)} and in no other (${KS.bands.length} bands are published for the DOHC build)`);
  }
  const teeth = drawnTeeth(ohvLanes[0], new THREE.Vector3(0, 0, 0), d.rootRadius(CS.pitchR));
  assert.equal(teeth, CS.teeth, `the OHV crank lane ${ohvLanes[0].name} carries ${teeth} drawn teeth, not the published ${CS.teeth} of SPEC.crank.sprocket.teeth: a chain wrapped on the wrong tooth count is not a 2:1 drive`);
  const camSprocket = meshes((await ohvDrive()).group, (o) => /cam-V-sprocket/.test(o.name))[0]
    ?? meshes(ohvCam(), (o) => /cam-V-sprocket/.test(o.name))[0];
  assert.ok(camSprocket, 'no 36-tooth cam sprocket is drawn for this variant');
  const camTeeth = drawnTeeth(camSprocket, camAxis(), d.rootRadius(KS.pitchR));
  assert.equal(camTeeth, KS.teeth, `the drawn cam sprocket carries ${camTeeth} teeth, not the published ${KS.teeth}: the 2:1 half-speed law is machined in tooth counts, not asserted`);
  const dohcChains = meshes(dohcBuilt.group, (o) => /-roller-/.test(o.name));
  const dohcParents = new Set(dohcChains.map((o) => o.parent?.name));
  assert.equal(dohcParents.size, 4, `the DOHC build now draws ${dohcParents.size} chains instead of 4 (two banks x intake/exhaust) - the review's "all four DOHC sprockets driven from the crank" half must survive this slice`);
  console.log(`${LAW} drawn: OHV 1 chain (${parents.size} group, ${chainParts.length} parts) in band ${band.toFixed(4)}..${bandEnd.toFixed(4)}, ${ohvLanes.length} crank lane of ${teeth} teeth, cam sprocket of ${camTeeth} teeth; DOHC unchanged at ${dohcParents.size} chains / ${dohcLanes.length} lanes`);
});

// ---------------------------------------------------------------------------
test(`${LAW}: the OHV chain keeps the published air off the casting and the frame it runs between, and the two sprockets keep the published gap off each other's tooth tips`, async () => {
  const d = await D();
  const built = await ohvDrive();
  const crank = ohvCrank();
  const stand = posed(createStand(mats(), 'ohv').group);
  const blockMeshes = meshes(posed(createBlock(mats(), 'ohv')), (o) => o.isMesh);
  const plate = blockMeshes.filter((o) => o.name === 'cam-retainer');
  assert.equal(plate.length, 1, 'the OHV casting draws no single cam retainer plate to measure the drive against');

  // Iron the drive must not touch: the casting except the bore the pilot runs in,
  // plus every frame member. The crank is measured separately: the chain wraps its
  // sprocket and the lane is mounted on its nose.
  const iron = newShell();
  blockMeshes.filter((o) => o.name !== 'cam-retainer').forEach((o) => shellAdd(iron, o));
  meshes(stand, (o) => !/^(mount|pad)-/.test(o.name)).forEach((o) => shellAdd(iron, o));

  const chainParts = meshes(built.group, (o) => /-(roller|plates-in|plates-out|guide|tensioner)/.test(o.name));
  const drawnIn = (re) => meshes(built.group, (o) => re.test(o.name)).concat(meshes(ohvCam(), (o) => re.test(o.name)));
  const pilot = drawnIn(/cam-V-pilot/);
  const capture = drawnIn(/cam-V-(shoulder|collar|sprocket)/);
  assert.equal(pilot.length, 1, `${pilot.length} cam-side pilots are drawn for this variant's one drive`);
  assert.equal(capture.length, 3, `${capture.length} cam-side sprocket/capture parts are drawn ([${capture.map((o) => o.name).join(', ')}]): a 36-tooth sprocket, its locating shoulder and its retaining collar`);

  // Free-running parts keep the frame/casting air the stand publishes. The pilot
  // is not one of them: it runs in the retainer bore this tree machines for it,
  // and the air it keeps there is the published nose air, not frame air.
  let worstIron = Infinity, ironWho = null;
  for (const o of chainParts.concat(capture)) {
    const near = closestToShell(o, iron);
    if (near.d < worstIron) { worstIron = near.d; ironWho = `${o.name} -> ${near.into}`; }
    assert.ok(near.d >= S.minAir - EPS, `${o.name} is ${near.d.toFixed(4)} cm from ${near.into}: a drive that runs through the casting or through the clamped frame is not a drive; the published clearance air is ${S.minAir} cm (SPEC.stand.minAir) and the free corridor slice 8C-2a published is ${d.ohvDriveCorridor().x0.toFixed(4)}..${d.ohvDriveCorridor().x1.toFixed(4)}`);
  }
  const noseAir = B.noseAirCm;
  let pilotAir = Infinity, pilotWho = null;
  for (const o of pilot) {
    const near = closestToShell(o, iron);
    if (near.d < pilotAir) { pilotAir = near.d; pilotWho = `${o.name} -> ${near.into}`; }
    assert.ok(near.d >= noseAir - EPS, `${o.name} is ${near.d.toFixed(4)} cm from ${near.into}: the pilot of a cam drive runs in the bore this casting machines for it, and the published running fit there is the ${noseAir.toFixed(4)} cm nose air (ohvBearings().noseAirCm) - closer than that and the pilot is inside the metal, not in its bore`);
  }
  // The crank it hangs from: the chain wraps the sprocket and the lane presses on
  // the nose, so the bar there is the published chain/tooth air, not frame air.
  const crankShell = newShell();
  meshes(crank, (o) => !/^sprocket-lane-/.test(o.name)).forEach((o) => shellAdd(crankShell, o));
  const lanes = meshes(crank, (o) => /^sprocket-lane-/.test(o.name));
  let worstCrank = Infinity, crankWho = null;
  for (const o of chainParts) {
    const near = closestToShell(o, crankShell);
    if (near.d < worstCrank) { worstCrank = near.d; crankWho = `${o.name} -> ${near.into}`; }
    assert.ok(near.d >= C.gapClr - EPS, `${o.name} is ${near.d.toFixed(4)} cm from ${near.into}: the chain has to reach the machined tooth, so ${C.gapClr} cm (SPEC.chain.gapClr) is the least air any link may keep off this crank`);
  }
  for (const o of lanes) {
    const near = closestToShell(o, crankShell);
    assert.equal(near.d, 0, `${o.name} is not mounted on the crank nose it is turned onto: ${near.d.toFixed(4)} cm of air to ${near.into}`);
  }
  // The cam-side hardware shares the crank's envelope two axes away: nothing of it
  // may come nearer to the drawn crank than the air the machined teeth run with.
  let worstDriveCrank = Infinity, driveCrankWho = null;
  for (const o of capture.concat(pilot)) {
    const near = closestToShell(o, crankShell);
    if (near.d < worstDriveCrank) { worstDriveCrank = near.d; driveCrankWho = `${o.name} -> ${near.into}`; }
    assert.ok(near.d >= C.gapClr - EPS, `${o.name} stands ${near.d.toFixed(4)} cm off ${near.into}: the ${KS.teeth}-tooth cam drive turns ${VAR.belowCrankCm} cm under this crank, and ${C.gapClr} cm (SPEC.chain.gapClr) is the least air anything in that envelope may keep off it`);
  }
  // The two sprockets: this is issue #8 item 3's "no interpenetrating teeth",
  // measured on the drawn rims rather than asserted from tip circles.
  const camSprocket = capture.find((o) => /cam-V-sprocket/.test(o.name));
  const crankSprocket = lanes[0];
  const s1 = newShell(); shellAdd(s1, crankSprocket);
  const rim = closestToShell(camSprocket, s1);
  const fullTipSum = d.tipRadius(KS.pitchR) + d.tipRadius(CS.pitchR);
  assert.ok(rim.d >= C.gapClr - EPS, `the drawn cam sprocket rim stands ${rim.d.toFixed(4)} cm off the drawn 18-tooth lane (${rim.into}): issue #8 item 3 rejects a drive with interpenetrating teeth, and the published tooth air is ${C.gapClr} cm; the unrelieved tip circles alone would sum to ${fullTipSum.toFixed(4)} cm against a ${VAR.belowCrankCm} cm centre distance`);
  console.log(`${LAW} air: least chain-or-capture air off casting+frame ${worstIron.toFixed(4)} cm (${ironWho}), pilot air in its bore ${pilotAir.toFixed(4)} cm against ${noseAir.toFixed(4)} published (${pilotWho}), least chain air off the crank ${worstCrank.toFixed(4)} cm (${crankWho}), least cam-drive air off the crank ${worstDriveCrank.toFixed(4)} cm (${driveCrankWho}), lanes press the nose at 0.0000, drawn tip-to-tip ${rim.d.toFixed(4)} cm against ${C.gapClr} published`);
});

// ---------------------------------------------------------------------------
test(`${LAW}: the OHV cam drive turns at exactly half crank speed - a machined gap of the cam sprocket sweeps half the angle a crank gap sweeps over the same 20 deg of crank, and the drawn drive follows it over the whole 720 deg cycle`, async () => {
  const d = await D();
  const lay = d.ohvChainLayout();
  const built = await ohvDrive();
  assert.equal(typeof built.update, 'function', 'createDrive(mats,"ohv") returns no update(theta): this variant would have a drive that never turns');
  const sprocket = meshes(built.group, (o) => /cam-V-sprocket/.test(o.name))[0]
    ?? meshes(ohvCam(), (o) => /cam-V-sprocket/.test(o.name))[0];
  assert.ok(sprocket, 'no drawn 36-tooth cam sprocket to measure a rotation on');

  // The engine side first: a machined gap of each sprocket, tracked by its own
  // gap number, sweeps one tooth per 20 crank degrees on the crank and half that
  // on the cam. That is what no slip through 18 and 36 teeth means.
  const seatMap = (theta, which) => new Map(
    d.chainPose(lay, theta).rollers.filter((r) => r.on === which).map((r) => [r.gap, r.at]));
  const swept = (which, deg) => {
    const a = seatMap(0, which), b = seatMap(20, which);
    const out = [...a.keys()].filter((g) => b.has(g)).map((g) => ({ g, delta: angDelta(b.get(g), a.get(g)) }));
    assert.ok(out.length >= 2, `only ${out.length} machined ${which} gaps carried a roller at both crank 0 deg and crank 20 deg, so this chain slips instead of walking the sprocket`);
    return out;
  };
  for (const c of swept('crank', 20)) {
    assert.ok(Math.abs(angDelta(c.delta, -360 / CS.teeth)) <= 1e-9,
      `crank gap ${c.g} swept ${c.delta.toFixed(6)} deg over 20 crank degrees; the 18-tooth lane turns with the crank, presenting ${(-360 / CS.teeth).toFixed(2)} deg per 20 deg`);
  }
  const camSweeps = swept('cam', 20);
  for (const c of camSweeps) {
    assert.ok(Math.abs(angDelta(c.delta, -360 / KS.teeth)) <= 1e-9,
      `cam gap ${c.g} swept ${c.delta.toFixed(6)} deg over 20 crank degrees; a 2:1 drive on ${KS.teeth} teeth presents ${(-360 / KS.teeth).toFixed(2)} deg in that time - the cam turns once while the crank turns twice`);
  }
  const rate = angDelta(camSweeps[0].delta, 0) / 20; // degrees of cam turn per degree of crank
  assert.ok(Math.abs(rate + 1 / 2) <= 1e-9, `this drive turns the cam at ${rate.toFixed(6)} crank degrees: 18 driving 36 teeth is one half, and issue #8 item 3 is the drive that has to prove it`);

  // The drawn part has to follow that lattice. Its own machined band of turned
  // teeth is a rigid feature: a rotation about the cam axis leaves every point's
  // radius off that axis alone, so the same metal is selected at every pose and
  // the sum of those points is an angle that turns with the part, measured
  // continuously instead of on a 10 deg tooth grid.
  const reliefTip = d.ohvSprocketTipR();
  const band = [reliefTip - 0.01, reliefTip + 0.01];
  const first = patternAngle(sprocket, camAxis(), band[0], band[1]);
  assert.ok(first.n > 3, `only ${first.n} drawn vertices stand in the turned band ${band[0].toFixed(4)}..${band[1].toFixed(4)} cm: nothing here records a machined relief`);
  assert.ok(first.mag > 1e-3, `the drawn turn-down writes no direction (vector sum ${first.mag.toFixed(6)} cm over ${first.n} points): the relief is symmetric, so it cannot be tracked at all`);
  built.update(0);
  const start = d.chainPose(lay, 0).rollers.filter((r) => r.on === 'crank').map((r) => r.gap);
  let worst = 0, worstAt = 0;
  for (let theta = 10; theta <= 720; theta += 10) {
    built.update(theta);
    posed(built.group);
    const got = patternAngle(sprocket, camAxis(), band[0], band[1]);
    assert.equal(got.n, first.n, `at crank ${theta} deg the sprocket presents ${got.n} vertices in its own turned band, not ${first.n}: the part changed its own machined profile as it turned`);
    assert.ok(Math.abs(got.mag - first.mag) <= 1e-4 * first.mag,
      `the drawn drive's pattern magnitude is ${got.mag.toFixed(6)} cm at crank ${theta} deg against ${first.mag.toFixed(6)} at crank 0: a rigid machined pattern keeps its size as it turns`);
    const want = (first.az + rate * theta + 720) % 360;
    const err = Math.abs(angDelta(got.az, want));
    if (err > worst) { worst = err; worstAt = theta; }
    assert.ok(err <= 0.25, `at crank ${theta} deg the drawn cam drive has turned ${(got.az - first.az).toFixed(3)} deg, where the machined lattice puts it at ${(want - first.az).toFixed(3)} deg (${rate.toFixed(3)} deg of cam per crank degree, off by ${err.toFixed(3)}): issue #8 item 3 wants 2:1 - one cam tooth per two crank teeth`);
  }
  const walked = d.chainPose(lay, 20).rollers.filter((r) => r.on === 'crank').map((r) => r.gap);
  assert.notDeepEqual(walked, start, 'the chain sat on the same 18 machined crank gaps at crank 0 deg and crank 20 deg: a driven chain walks one gap per tooth it drives');
  built.update(0);
  posed(built.group);
  const back = patternAngle(sprocket, camAxis(), band[0], band[1]);
  assert.ok(Math.abs(angDelta(back.az, first.az)) <= 0.25, `after 720 crank degrees the drawn cam drive sits ${angDelta(back.az, first.az).toFixed(3)} deg from where it started: two crank turns must land this cam back on its own start`);
  console.log(`${LAW} half speed: crank gaps sweep ${(-360 / CS.teeth).toFixed(2)} deg and cam gaps ${(-360 / KS.teeth).toFixed(2)} deg per 20 crank degrees (rate ${rate.toFixed(4)}); the drawn pattern tracked that over 72 poses, worst error ${worst.toFixed(3)} deg at crank ${worstAt} deg, back on its start after 720`);
});
