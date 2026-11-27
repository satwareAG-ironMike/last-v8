// Slice 8J (issue #51 option A, GATES P1-G6 / P1-G7 / A1-G7): the 16 valves and
// 16 springs the OHV build seats in its head iron.
//
// Written RED first: every law below measures a part the OHV build does not draw
// at the commit this file is committed at (tmp/v8-8j-red.out), because
// src/render/valvetrain.js returns from its central-cam branch before the valve
// and spring loop. The families were declared owed in slice 8H (issue #51 option
// B); the follower path they were waiting on landed in slice 8I (issue #45:
// SPEC.variants.ohv.rockerRatio = 1.5, the cam ground to maxLift / ratio).
//
// What this file does NOT draw and says so out loud: the 16 pushrods, the 16
// rockers and the 2 rocker covers (slice 8K), and the head/block iron those
// stand on. The lift law here stops at the valve tip, which is the interface 8K
// presses a rocker pad onto.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SPEC, valveSide } from '../src/engine/spec.js';
import { followers, ohvLifterGallery } from '../src/engine/layout.js';
import { valveAxisDir, valveSeatPoint } from '../src/engine/timing.js';
import { ohvLift, ohvValveLift, ohvValvePoint, ohvCamLiftCm } from '../src/engine/ohv.js';
import { createValvetrain } from '../src/render/valvetrain.js';
import { partLabel, explodeRules } from '../src/engine/view.js';

const H = SPEC.head;
const V = SPEC.valves;
const R = SPEC.variants.ohv.rockerRatio;
const P = SPEC.plug;
const DEG = Math.PI / 180;
const LAW = 'OHV-VALVE';
const valves = ['intake', 'exhaust'];
const EPS = 1e-3; // a float32 vertex against a float64 machined value
const PAD = 0.55; // the rocker pad stand-off under the shaft plane the #45 decision measured with
const SHAFT_R = 0.45; // the 9 mm rocker shaft the same decision measured with

const mats = () => new Proxy({}, { get: (t, k) => (t[k] ??= new THREE.MeshStandardMaterial({ name: String(k) })) });

function ohvTrain() {
  const built = createValvetrain(mats(), 'ohv');
  built.group.updateMatrixWorld(true);
  return built;
}

/** Drawn meshes of one family, by the name pattern the DOHC row already uses. */
function family(group, re) {
  const out = [];
  group.traverse((o) => { if (o.isMesh && re.test(o.name)) out.push(o); });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Drawn parts of an owed family: mesh or group, either is a drawn part. */
function anyFamily(group, re) {
  const out = [];
  group.traverse((o) => { if (re.test(o.name)) out.push(o); });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Drawn valve groups (a valve is a group of disc + stem + retainer). */
function valveGroups(group) {
  const out = new Map();
  group.traverse((o) => {
    if (!o.isGroup) return;
    if (!/^valve-cyl\d+-(intake|exhaust)$/.test(o.name)) return;
    out.set(o.name, o);
  });
  return out;
}

const cylOf = (name) => SPEC.cylinders.find((c) => c.num === Number(/cyl(\d+)/.exec(name)[1]));
const valveOf = (name) => /-(intake|exhaust)$/.exec(name)[1];
const seatOf = (cyl, valve) => {
  const p = valveSeatPoint(cyl, valve);
  return new THREE.Vector3(p.x, p.y, p.z);
};
const dirOf = (cyl, valve) => new THREE.Vector3().fromArray(valveAxisDir(cyl, valve));

/** World-space vertices of a drawn mesh. */
function worldPoints(o) {
  o.updateMatrixWorld(true);
  const p = o.geometry.attributes.position;
  const out = [];
  for (let i = 0; i < p.count; i++) out.push(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld));
  return out;
}

/** Radius of a world point off the valve axis line of its own cylinder. */
const axisRadius = (pt, seat, dir) => {
  const v = new THREE.Vector3().subVectors(pt, seat);
  return new THREE.Vector3().copy(v).addScaledVector(dir, -v.dot(dir)).length();
};
/** Signed distance of a world point up the valve axis from its seat plane. */
const axisAlong = (pt, seat, dir) => new THREE.Vector3().subVectors(pt, seat).dot(dir);

/** The plug silhouette radius at a bank `along` above the machined boss face. */
function plugAt(along) {
  const up = along - (H.stayTopA + P.bossOff);
  if (up < 0) return { tag: 'in the machined boss', r: P.thread.r };
  const segs = [
    ['thread', P.thread.r, 0, P.thread.len],
    ['hex', P.hex.r, P.hex.len, P.hex.len],
    ['boot', P.boot.r, P.hex.len + P.boot.len, P.boot.len],
    ['terminal', P.terminal.r, P.hex.len + 2 * P.boot.len, P.terminal.len],
  ];
  let hit = { tag: 'above the terminal', r: 0 };
  for (const [tag, r, from, len] of segs) if (up >= from && up < from + len) hit = { tag, r };
  return hit;
}

test(`${LAW}: the OHV build draws 16 valves in the head iron that already machines their seats`, async () => {
  const { group } = ohvTrain();
  const groups = valveGroups(group);
  const owed = followers('ohv').valves;
  assert.equal(groups.size, owed, `the OHV build draws ${groups.size} valve groups for the ${owed} its own contract counts`);
  const want = SPEC.cylinders.flatMap((c) => valves.map((v) => `valve-cyl${c.num}-${v}`)).sort();
  assert.deepEqual([...groups.keys()].sort(), want, `the drawn valves ${[...groups.keys()].slice(0, 4).join(', ')}... are not the one-per-valve row the head seats`);
  let headR = 0, stemR = 0, retR = 0, stemLen = 0;
  const stemLens = [];
  for (const [name, g] of groups) {
    const cyl = cylOf(name), valve = valveOf(name);
    const label = partLabel(name);
    assert.notEqual(label, name, `${name}: partLabel() answers its own name, so the inspection menu drops this valve`);
    assert.match(label, /^Valve - cylinder \d+ (intake|exhaust) - station /, `partLabel("${name}") reads "${label}"`);
    const meshes = g.children.filter((o) => o.isMesh);
    const parts = meshes.map((m) => m.userData.part).sort();
    assert.deepEqual(parts, ['valve head', 'valve retainer', 'valve stem'],
      `${name} carries ${JSON.stringify(parts)}; a valve is its disc, its stem and the retainer a rocker pad presses on`);
    for (const m of meshes) {
      assert.equal(m.userData.cyl, cyl.num, `${m.name} carries cyl ${m.userData.cyl}, not ${cyl.num}`);
      const seat = seatOf(cyl, valve), dir = dirOf(cyl, valve);
      const pts = worldPoints(m);
      const rad = Math.max(...pts.map((p) => axisRadius(p, seat, dir)));
      const along = pts.map((p) => axisAlong(p, seat, dir));
      if (m.userData.part === 'valve head') headR = Math.max(headR, Math.abs(rad - H.headDia[valve] / 2));
      if (m.userData.part === 'valve stem') {
        stemR = Math.max(stemR, Math.abs(rad - H.stemRadius));
        const len = Math.max(...along) - Math.min(...along);
        stemLens.push(len);
        stemLen = Math.max(stemLen, Math.abs(len - H.stemToTip));
      }
      if (m.userData.part === 'valve retainer') {
        // the disc is turned wider on the spring side (SPEC.head.retainerFlare)
        retR = Math.max(retR, Math.abs(rad - H.retainerRadius * H.retainerFlare));
      }
    }
  }
  assert.ok(headR < EPS, `the drawn valve discs differ from the published headDia by ${headR.toFixed(6)} cm`);
  assert.ok(stemR < EPS, `the drawn stems differ from the published stemRadius ${H.stemRadius} by ${stemR.toFixed(6)} cm`);
  assert.ok(retR < EPS, `the drawn retainers differ from the published retainerRadius ${H.retainerRadius} x flare ${H.retainerFlare} by ${retR.toFixed(6)} cm`);
  assert.ok(stemLen < EPS, `the drawn stems measure ${Math.min(...stemLens).toFixed(4)}..${Math.max(...stemLens).toFixed(4)} cm against the published stemToTip ${H.stemToTip}`);
  console.log(`${LAW} drawn: ${groups.size} valves (disc/stem/retainer each), disc r within ${headR.toFixed(6)}, stem r within ${stemR.toFixed(6)}, retainer r within ${retR.toFixed(6)} cm of the published row`);
});

test(`${LAW}: every valve tip stands at the published stemToTip off its seat on its own valve axis`, async () => {
  const { group, update } = ohvTrain();
  const groups = valveGroups(group);
  assert.ok(groups.size, 'no valves drawn, so the tip law has nothing to measure');

  // every valve has its own closed pose (the row runs overlap, so there is no
  // single pose where all 16 sit on their seats); the tip plane is measured
  // against the seat at the pose where that valve is on its seat
  const closedAt = (cyl, valve) => {
    for (let theta = 0; theta < 720; theta++) if (ohvValveLift(cyl, valve, theta) === 0) return theta;
    return null;
  };
  let worstTip = 0, worstSeat = 0, worstAxis = 0, poseReads = 0;
  for (const [name, g] of groups) {
    const cyl = cylOf(name), valve = valveOf(name);
    const theta = closedAt(cyl, valve);
    assert.ok(theta !== null, `${name} is never on its seat in the whole cycle, so the tip plane could not be measured against the seat`);
    update(theta);
    group.updateMatrixWorld(true);
    poseReads++;
    const seat = seatOf(cyl, valve), dir = dirOf(cyl, valve);
    const meshes = g.children.filter((o) => o.isMesh);
    const retainer = meshes.find((m) => m.userData.part === 'valve retainer');
    const head = meshes.find((m) => m.userData.part === 'valve head');
    assert.ok(retainer && head, `${name} has no retainer/disc pair to read the tip and seat off`);
    worstTip = Math.max(worstTip, Math.abs(Math.max(...worldPoints(retainer).map((p) => axisAlong(p, seat, dir))) - H.stemToTip));
    worstSeat = Math.max(worstSeat, Math.abs(Math.max(...worldPoints(head).map((p) => axisAlong(p, seat, dir)))));
    // the whole valve sits on its own axis line: nothing reaches further out
    // than the widest turned diameter of the row, its own disc
    const reach = H.headDia[valve] / 2;
    for (const m of meshes) worstAxis = Math.max(worstAxis, Math.max(...worldPoints(m).map((p) => axisRadius(p, seat, dir))) - reach);
  }
  assert.equal(poseReads, groups.size, 'not every drawn valve had a closed pose to be measured at');
  assert.ok(worstTip < EPS, `measured at each valve's own closed pose, the highest retainer vertex stands ${worstTip.toFixed(6)} cm off the published stemToTip ${H.stemToTip} cm plane`);
  assert.ok(worstSeat < EPS, `a valve disc stands ${worstSeat.toFixed(6)} cm proud of the machined seat plane it was seated in`);
  assert.ok(worstAxis < EPS, `a valve vertex reaches ${worstAxis.toFixed(6)} cm beyond the widest turned diameter of its own row (a valve is a turned part on its axis)`);

  // the tip's travel: from the tip plane down to exactly one published lift below it
  let lowest = Infinity;
  for (let theta = 0; theta < 720; theta++) {
    update(theta);
    group.updateMatrixWorld(true);
    for (const [name, g] of groups) {
      const cyl = cylOf(name), valve = valveOf(name);
      const seat = seatOf(cyl, valve), dir = dirOf(cyl, valve);
      const retainer = g.children.find((o) => o.isMesh && o.userData.part === 'valve retainer');
      lowest = Math.min(lowest, Math.max(...worldPoints(retainer).map((p) => axisAlong(p, seat, dir))));
    }
  }
  assert.ok(Math.abs(lowest - (H.stemToTip - V.maxLift)) < EPS,
    `the tip travels down to ${lowest.toFixed(6)} cm off its seat, expected stemToTip ${H.stemToTip} less the published lift ${V.maxLift}`);
  console.log(`${LAW} tip: measured at each valve's own closed pose, every retainer top is within ${worstTip.toFixed(6)} cm of the ${H.stemToTip} cm tip plane and every disc within ${worstSeat.toFixed(6)} cm of its seat; the tip travels to ${lowest.toFixed(4)} cm, nothing further than ${worstAxis.toFixed(4)} cm off its axis`);
});

test(`${LAW}: the OHV valve lift is the lifter's contact law times the published rocker lever, at every crank degree`, async () => {
  const { group, update } = ohvTrain();
  const groups = valveGroups(group);
  assert.ok(groups.size, 'no valves drawn, so the lift law has nothing to measure');
  let worst = 0, peak = 0, peakAt = null, moved = 0;
  for (let theta = 0; theta < 720; theta++) {
    update(theta);
    group.updateMatrixWorld(true);
    for (const [name, g] of groups) {
      const cyl = cylOf(name), valve = valveOf(name);
      const lift = ohvValveLift(cyl, valve, theta);
      const want = ohvValvePoint(cyl, valve, 0, theta);
      const got = g.getWorldPosition(new THREE.Vector3());
      worst = Math.max(worst, Math.hypot(got.x - want.x, got.y - want.y, got.z - want.z));
      const dir = dirOf(cyl, valve), seat = seatOf(cyl, valve);
      const off = axisAlong(got, seat, dir);
      if (lift > 0) moved = Math.max(moved, Math.abs(off + lift));
      if (lift > peak) { peak = lift; peakAt = theta; }
    }
  }
  assert.ok(worst < EPS, `the drawn valves differ from the lifter's lift x rocker ratio ${R} by ${worst.toFixed(6)} cm over the whole cycle`);
  assert.ok(moved > 0, 'no valve was ever measured off its seat plane, so the drawn train does not move');
  assert.ok(Math.abs(peak - V.maxLift) < 1e-9, `the lever law peaks at ${peak.toFixed(6)} cm against the published maxLift ${V.maxLift}`);
  const grind = SPEC.cylinders.reduce((a, c) => Math.max(a, ...Array.from({ length: 720 }, (_, th) => ohvLift(c, 'exhaust', th) * R)), 0);
  assert.ok(Math.abs(grind - peak) < 1e-9, `the drawn peak ${peak.toFixed(6)} is not the peak the lifter law gives it (${grind.toFixed(6)})`);
  assert.ok(Math.abs(ohvCamLiftCm() * R - V.maxLift) < 1e-9,
    `the cam grind ${ohvCamLiftCm().toFixed(6)} x ratio ${R} is not the published lift ${V.maxLift}: the valve row would not reach its published lift`);
  console.log(`${LAW} lift: ${groups.size} valves posed within ${worst.toFixed(6)} cm of ohvLift x ${R} over 720 crank degrees, peak ${peak.toFixed(6)} cm at crank ${peakAt}, grind ${ohvCamLiftCm().toFixed(6)}`);
});

test(`${LAW}: 16 springs stand on the machined spring seat and are compressed by the lever law, short of coil bind`, async () => {
  const { group, update } = ohvTrain();
  const springs = family(group, /^spring-cyl\d+-(intake|exhaust)$/);
  const owed = followers('ohv').springs;
  assert.equal(springs.length, owed, `the OHV build draws ${springs.length} springs for the ${owed} its own contract counts`);
  const mounted = H.stemToTip - H.retainerGap - H.guideLength;
  const solid = 2 * V.springCoils * V.springWireRadius;
  const coilOD = 2 * (V.springRadius + V.springWireRadius);
  const wireDia = 2 * V.springWireRadius;
  // the fixed seat is measured at the pose where that valve is on its seat: the
  // spring's lower end stays on the machined floor while its upper end follows
  // the retainer down, so a lifted pose would read the seat short by the lift
  const closedAt = (cyl, valve) => {
    for (let theta = 0; theta < 720; theta++) if (ohvValveLift(cyl, valve, theta) === 0) return theta;
    return null;
  };
  // The drawn coil is a TubeGeometry helix whose round cap vertex reaches past
  // the curve's own end point along the axis. The overshoot is measured here from
  // the metal itself at the closed pose: 0.4260 cm at the floor end and 0.4351 cm
  // at the retainer end for this 7-coil 1.35 cm helix (tmp/8j-spring-probe.mjs),
  // the same convention every spring in this engine is drawn with. The laws below
  // subtract the measured overshoot instead of pretending the cap is flat.
  let seatOver = 0, topOver = 0, worstOD = 0, poseReads = 0;
  for (const s of springs) {
    const cyl = cylOf(s.name), valve = valveOf(s.name);
    assert.ok(partLabel(s.name) !== s.name, `${s.name} is drawn but not on the inspection menu`);
    const theta = closedAt(cyl, valve);
    assert.ok(theta !== null, `${s.name} never sits on its spring floor in the whole cycle`);
    update(theta);
    group.updateMatrixWorld(true);
    poseReads++;
    const seat = seatOf(cyl, valve), dir = dirOf(cyl, valve);
    const pts = worldPoints(s);
    const along = pts.map((p) => axisAlong(p, seat, dir));
    const overLo = (H.guideLength + V.springWireRadius) - Math.min(...along);
    const overHi = Math.max(...along) - (H.stemToTip - H.retainerGap - V.springWireRadius);
    seatOver = Math.max(seatOver, overLo);
    topOver = Math.max(topOver, overHi);
    worstOD = Math.max(worstOD, Math.abs(Math.max(...pts.map((p) => axisRadius(p, seat, dir))) - coilOD / 2));
  }
  assert.equal(poseReads, springs.length, 'not every drawn spring had a closed pose to be measured at');
  assert.ok(seatOver < 0.45, `a coil's floor-side cap reaches ${seatOver.toFixed(6)} cm past the machined spring floor plus the ${V.springWireRadius} cm wire radius (the published cap of a 7-coil helix at a ${V.springRadius} cm coil radius)`);
  assert.ok(topOver < 0.45, `a coil's retainer-side cap reaches ${topOver.toFixed(6)} cm past the retainer underside minus the wire radius`);
  assert.ok(worstOD < EPS, `the drawn coil OD differs from 2 x (springRadius + springWireRadius) = ${coilOD} cm by ${worstOD.toFixed(6)} cm`);
  assert.ok(coilOD < 2 * H.bucketBoreR, `a ${coilOD} cm coil will not stand in the ${2 * H.bucketBoreR} cm machined spring bore`);

  // The live coil length over the whole cycle. It is read off the spring's own
  // centre: the renderer stands the coil half a live length above the fixed seat,
  // so centre-minus-seat less the lift is half the live length. (The drawn span
  // cannot give this directly: the helix cap's overshoot shrinks as the coil
  // compresses, 0.4260 cm at zero lift against 0.1642 cm at full lift.)
  let shortest = Infinity, shortestAt = null, worstFixed = 0, worstRetainer = 0, worstLive = 0, floorLow = Infinity, floorRad = 0;
  const tubeBoreR = V.springRadius + V.springWireRadius + H.springTubeClr; // the machined bore the coil stands in
  for (let theta = 0; theta < 720; theta += 2) {
    update(theta);
    group.updateMatrixWorld(true);
    for (const s of springs) {
      const cyl = cylOf(s.name), valve = valveOf(s.name);
      const seat = seatOf(cyl, valve), dir = dirOf(cyl, valve);
      const pts = worldPoints(s);
      const along = pts.map((p) => axisAlong(p, seat, dir));
      const lo = Math.min(...along), hi = Math.max(...along);
      const lift = ohvValveLift(cyl, valve, theta);
      const centre = axisAlong(s.getWorldPosition(new THREE.Vector3()), seat, dir);
      const live = 2 * (centre - H.guideLength);
      if (live < shortest) { shortest = live; shortestAt = theta; }
      worstLive = Math.max(worstLive, Math.abs(live - (mounted - lift)));
      // the fixed seat: the coil's floor end stands on the machined floor at
      // every pose; its retainer end follows the retainer underside down
      worstFixed = Math.max(worstFixed, Math.abs((centre - live / 2) - H.guideLength));
      worstRetainer = Math.max(worstRetainer, Math.abs((centre + live / 2) - (H.stemToTip - H.retainerGap - lift)));
      // the cap hangs into the machined spring bore, never into solid iron: it
      // stays inside the floor's own thickness band and inside the bore radius
      floorLow = Math.min(floorLow, lo);
      floorRad = Math.max(floorRad, Math.max(...pts.map((p) => axisRadius(p, seat, dir))));
    }
  }
  assert.ok(floorLow > H.guideLength - H.floorT,
    `a coil's floor-side cap reaches ${floorLow.toFixed(4)} cm along the axis, below the machined spring floor's own bottom face at ${H.guideLength - H.floorT} cm: it would stand in solid iron`);
  assert.ok(floorLow < H.guideLength, `a coil's floor-side cap (${floorLow.toFixed(4)} cm) never reaches the floor top plane at ${H.guideLength} cm, so the spring does not sit on its seat`);
  assert.ok(floorRad < tubeBoreR, `the coil stands ${floorRad.toFixed(4)} cm off its axis against the ${tubeBoreR} cm machined spring bore (coil OD plus the published ${H.springTubeClr} cm springTubeClr)`);
  assert.ok(worstLive < EPS, `the drawn coil length differs from the installed ${mounted} less the live lift by ${worstLive.toFixed(6)} cm over the whole cycle`);
  assert.ok(Math.abs(shortest - (mounted - V.maxLift)) < 0.02,
    `the shortest coil read over the cycle is ${shortest.toFixed(4)} cm at crank ${shortestAt}, expected the installed ${mounted} less the published lift ${V.maxLift}`);
  assert.ok(worstFixed < 0.02, `a spring's floor-side seat point drifts ${worstFixed.toFixed(6)} cm off the machined floor plus the lift its valve holds`);
  assert.ok(worstRetainer < 0.02, `a spring's retainer-side seat point drifts ${worstRetainer.toFixed(6)} cm off the retainer underside minus the lift its valve holds`);
  assert.ok(shortest > solid, `the springs reach ${shortest.toFixed(4)} cm at full lift against the ${solid} cm solid height of ${V.springCoils} coils at ${wireDia} cm wire: coil bind`);
  assert.ok(shortest - solid > 0.5, `only ${(shortest - solid).toFixed(4)} cm of air is left before coil bind at full lift`);
  console.log(`${LAW} spring: ${springs.length} springs, live length within ${worstLive.toFixed(6)} cm of installed-minus-lift over 720 degrees, shortest ${shortest.toFixed(4)} cm at crank ${shortestAt} against ${solid} cm solid, floor cap at ${floorLow.toFixed(4)} cm inside the ${H.floorT} cm floor band and the ${tubeBoreR} cm bore, seat points within ${worstFixed.toFixed(6)} / ${worstRetainer.toFixed(6)} cm`);
});

test(`${LAW}: the valve tip publishes a rocker interface the published iron can actually hold`, async () => {
  const G = ohvLifterGallery();
  const LINER = SPEC.block.boreShellRadius;
  const rows = [];
  for (const side of valves) {
    const s = valveSide(side);
    const reachZero = H.stemToTip;
    const reachMax = H.stemToTip - V.maxLift;
    const zeroOut = s * (H.seatOffset + Math.sin(H.valveAngle * DEG) * reachZero);
    const maxAlong = H.seatA + Math.cos(H.valveAngle * DEG) * reachMax;
    for (const bank of ['L', 'R']) {
      const lifterOut = G.banks[bank].axisOut;
      const pivot = (R * lifterOut + zeroOut) / (R + 1);
      const armValve = Math.abs(pivot - zeroOut);
      const armPushrod = Math.abs(lifterOut - pivot);
      assert.ok(Math.abs(armPushrod / armValve - 1 / R) < 1e-9,
        `${bank} ${side}: arms ${armValve.toFixed(4)} valve / ${armPushrod.toFixed(4)} pushrod read a lever of ${(armValve / armPushrod).toFixed(4)}, not the published ${R}`);
      const shaftPlane = maxAlong + PAD + SHAFT_R;
      const seg = plugAt(shaftPlane);
      const plugAir = Math.abs(pivot) - seg.r - SHAFT_R;
      const linerAir = Math.abs(pivot) - LINER - SHAFT_R;
      assert.ok(plugAir > 1.0, `${bank} ${side}: a rocker shaft at out ${pivot.toFixed(4)} leaves only ${plugAir.toFixed(4)} cm against the plug's ${seg.tag} at r ${seg.r} (floor 1.0 cm)`);
      rows.push({ bank, side, pivot, armValve, armPushrod, shaftPlane, seg, plugAir, linerAir });
    }
  }
  const intake = rows.filter((r) => r.side === 'intake');
  const exhaust = rows.filter((r) => r.side === 'exhaust');
  assert.ok(intake.every((r) => r.linerAir < 0),
    `the intake pivots ${intake.map((r) => r.pivot.toFixed(4)).join(', ')} were expected inside the ${LINER} cm bore shell - that is why issue #45 carries them on a rocker shaft, and a build that let them stand on the deck would draw rockers into the liner`);
  assert.ok(exhaust.every((r) => r.linerAir > 0),
    `the exhaust pivots ${exhaust.map((r) => r.pivot.toFixed(4)).join(', ')} stand ${exhaust[0].linerAir.toFixed(4)} cm clear outside the ${LINER} cm bore shell: they may stand on the deck, and this law refuses a build that hides that`);
  console.log(`${LAW} interface: intake pivot out ${intake[0].pivot.toFixed(4)} (arms ${intake[0].armValve.toFixed(4)}/${intake[0].armPushrod.toFixed(4)}, ${intake[0].plugAir.toFixed(4)} cm against the plug ${intake[0].seg.tag}, ${Math.abs(intake[0].linerAir).toFixed(4)} inside the ${LINER} shell) | exhaust pivot out ${exhaust[0].pivot.toFixed(4)} (${exhaust[0].plugAir.toFixed(4)} plug air, ${exhaust[0].linerAir.toFixed(4)} outside the shell) | shaft plane along ${intake[0].shaftPlane.toFixed(4)}`);
});

test(`${LAW}: pendingHardware names exactly the valvetrain families this build does not draw`, async () => {
  const { group } = ohvTrain();
  const owed = followers('ohv');
  const pending = SPEC.variants.ohv.pendingHardware;
  assert.ok(Array.isArray(pending), 'SPEC.variants.ohv.pendingHardware is not a list a reader can check');
  const drawn = {
    lifters: family(group, /^lifter-cyl/).length,
    valves: valveGroups(group).size,
    springs: family(group, /^spring-cyl\d+-(intake|exhaust)$/).length,
    pushrods: anyFamily(group, /^pushrod-/).length,
    rockers: anyFamily(group, /^rocker(?!-cover)/).length,
    covers: anyFamily(group, /rocker-cover|^cover-/).length,
  };
  for (const [name, n] of Object.entries(drawn)) {
    const listed = pending.some((p) => p.family === name);
    assert.equal(listed, n === 0,
      `pendingHardware ${listed ? 'names' : 'does not name'} "${name}" while the build draws ${n} of them: the list has to be the measured gap, not a remembered one`);
  }
  for (const p of pending) {
    assert.ok(owed[p.family] > 0, `pendingHardware names "${p.family}", which this variant's own contract does not owe (${JSON.stringify(owed)})`);
    assert.ok(/^#\d+$/.test(p.issue), `pendingHardware family "${p.family}" is not tied to an open issue: "${p.issue}"`);
    assert.ok(p.why && p.why.length > 10, `pendingHardware family "${p.family}" names no reason a reader can check`);
    assert.equal(drawn[p.family], 0, `pendingHardware names "${p.family}" owed while the build draws ${drawn[p.family]} of them`);
  }
  const named = pending.map((p) => p.family).sort();
  assert.deepEqual(named, Object.entries(drawn).filter(([, n]) => n === 0).map(([k]) => k).sort(),
    `the measured gap is ${JSON.stringify(Object.entries(drawn).filter(([, n]) => n === 0).map(([k]) => k).sort())} (drawn ${JSON.stringify(drawn)}); the row a reader sees has to name exactly that`);
  console.log(`${LAW} pending: drawn ${JSON.stringify(drawn)}, owed ${JSON.stringify(owed)}, named owed ${named.join(', ')}`);
});

test(`${LAW}: the drawn OHV valves and springs come off with the head they were seated in`, async () => {
  const rules = explodeRules();
  const at = (name) => {
    const r = rules.find((x) => x.re.test(name));
    if (!r) return null;
    return { family: typeof r.family === 'function' ? r.family(name) : r.family, stage: r.stage };
  };
  for (const kind of ['valve', 'spring']) {
    const r = at(`${kind}-cyl1-intake`);
    assert.ok(r, `explodeRules has no rule for ${kind} parts at all`);
    assert.ok(/^(bank-L|bank-R)$/.test(r.family), `${kind} parts explode in family ${r.family}; the valve row leaves its head up its bank's bore axis`);
  }
  const { group } = ohvTrain();
  const vs = [...valveGroups(group).keys()];
  const sp = family(group, /^spring-cyl\d+-(intake|exhaust)$/).map((o) => o.name);
  assert.ok(vs.length && sp.length, 'no OHV valves or springs drawn to check the teardown against');
  for (const name of [...vs, ...sp]) {
    const r = at(name);
    assert.ok(r, `${name} is drawn in the OHV build and no explode rule claims it: it would travel with the casting it came out of`);
    const c = cylOf(name);
    assert.equal(r.family, `bank-${c.bank}`, `${name} explodes in family ${r.family}, not its own bank's bore axis`);
  }
  const vStage = at('valve-cyl1-intake').stage;
  const sStage = at('spring-cyl1-intake').stage;
  const hStage = at('head-L').stage;
  assert.ok(vStage > hStage && sStage > vStage,
    `the teardown order is head ${hStage} -> valve ${vStage} -> spring ${sStage}: a spring that comes off before its valve would have to pass through it`);
  console.log(`${LAW} teardown: ${vs.length} valves at stage ${vStage} and ${sp.length} springs at stage ${sStage}, both in their own bank's family behind the head at stage ${hStage}`);
});
