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
import { valveAxisDir, valveSeatPoint, valveAxisPoint } from '../src/engine/timing.js';
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

/** Drawn members of one family, by the name the DOHC row already uses. */
function family(group, re) {
  const out = [];
  group.traverse((o) => { if (o.isMesh && re.test(o.name)) out.push(o); });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function valveGroups(group) {
  const out = new Map();
  group.traverse((o) => {
    if (!o.isMesh) return;
    const m = /^(valve-cyl\d+-(?:intake|exhaust))/.exec(o.name);
    if (!m) return;
    if (!out.has(m[1])) out.set(m[1], []);
    out.get(m[1]).push(o);
  });
  return out;
}

const cylOf = (name) => SPEC.cylinders.find((c) => c.num === Number(/cyl(\d+)/.exec(name)[1]));
const valveOf = (name) => /-(intake|exhaust)$/.exec(name)[1];

/** World-space vertices of a drawn mesh. */
function worldPoints(o) {
  o.updateMatrixWorld(true);
  const p = o.geometry.attributes.position;
  const out = [];
  for (let i = 0; i < p.count; i++) {
    out.push(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld));
  }
  return out;
}

/** Distance of a world point from the valve axis line of its own cylinder. */
const axisRadius = (pt, seat, dir) => {
  const v = new THREE.Vector3().subVectors(pt, seat);
  return new THREE.Vector3().copy(v).addScaledVector(dir, -v.dot(dir)).length();
};

/** The plug silhouette radius at a bank `along` above the machined boss face. */
function plugAt(along) {
  const up = along - (H.stayTopA + P.bossOff);
  const segs = [
    ['thread', P.thread.r, 0, P.thread.len],
    ['hex', P.hex.r, P.hex.len, P.hex.len],
    ['boot', P.boot.r, P.hex.len + P.boot.len, P.boot.len],
    ['terminal', P.terminal.r, P.hex.len + P.boot.len + P.boot.len, P.terminal.len],
  ];
  let hit = { tag: 'above the terminal', r: 0 };
  for (const [tag, r, from, len] of segs) if (up >= from && up < from + len) hit = { tag, r };
  if (up < 0) hit = { tag: 'in the boss', r: P.thread.r };
  return hit;
}

test(`${LAW}: the OHV build draws 16 valves in the head iron that already machines their seats`, async () => {
  const { group } = ohvTrain();
  const groups = valveGroups(group);
  const owed = followers('ohv').valves;
  assert.equal(groups.size, owed, `the OHV build draws ${groups.size} valve groups for the ${owed} its own contract counts`);
  const want = SPEC.cylinders.flatMap((c) => valves.map((v) => `valve-cyl${c.num}-${v}`)).sort();
  assert.deepEqual([...groups.keys()].sort(), want, `the drawn valves ${[...groups.keys()].slice(0, 4).join(', ')}... are not the one-per-valve row the head seats`);
  for (const [name, meshes] of groups) {
    const parts = meshes.map((m) => m.userData.part).sort();
    assert.deepEqual(parts, ['valve head', 'valve retainer', 'valve stem'],
      `${name} carries ${JSON.stringify(parts)}; a valve is its disc, its stem and the retainer a rocker pad presses on`);
    for (const m of meshes) {
      assert.equal(m.userData.cyl, cylOf(name).num, `${name} carries cyl ${m.userData.cyl}, not ${cylOf(name).num}`);
      assert.ok(partLabel(m.name) !== m.name, `${name} is drawn but not on the inspection menu: partLabel answers its own name`);
    }
  }
  // the drawn metal against the published valve row
  const headR = [], stemR = [], retR = [], stemLen = [];
  for (const [name, meshes] of groups) {
    const valve = valveOf(name);
    const seat = new THREE.Vector3().fromArray(valveSeatPoint(cylOf(name), valve));
    const dir = new THREE.Vector3().fromArray(valveAxisDir(cylOf(name), valve));
    for (const m of meshes) {
      const pts = worldPoints(m);
      const rad = Math.max(...pts.map((p) => axisRadius(p, seat, dir)));
      const along = pts.map((p) => new THREE.Vector3().subVectors(p, seat).dot(dir));
      if (m.userData.part === 'valve head') headR.push(rad - H.headDia[valve] / 2);
      if (m.userData.part === 'valve stem') { stemR.push(rad - H.stemRadius); stemLen.push(Math.max(...along) - Math.min(...along)); }
      if (m.userData.part === 'valve retainer') retR.push(rad - H.retainerRadius);
    }
  }
  const worst = (a) => Math.max(...a.map(Math.abs));
  assert.ok(worst(headR) < EPS, `the drawn valve discs differ from the published headDia by ${worst(headR).toFixed(6)} cm`);
  assert.ok(worst(stemR) < EPS, `the drawn stems differ from the published stemRadius ${H.stemRadius} by ${worst(stemR).toFixed(6)} cm`);
  assert.ok(worst(retR) < EPS, `the drawn retainers differ from the published retainerRadius ${H.retainerRadius} by ${worst(retR).toFixed(6)} cm`);
  assert.ok(worst(stemLen.map((l) => l - H.stemToTip)) < 0.05, `the drawn stems measure ${Math.min(...stemLen).toFixed(4)}..${Math.max(...stemLen).toFixed(4)} cm against the published stemToTip ${H.stemToTip}`);
  console.log(`${LAW} drawn: ${groups.size} valves (head/stem/retainer each), disc r within ${worst(headR).toFixed(6)}, stem r within ${worst(stemR).toFixed(6)}, retainer r within ${worst(retR).toFixed(6)} cm of the published row`);
});

test(`${LAW}: every valve tip stands at the published stemToTip off its seat on its own valve axis`, async () => {
  const { group } = ohvTrain();
  const groups = valveGroups(group);
  assert.ok(groups.size, 'no valves drawn, so the tip law has nothing to measure');
  let worstTip = 0, worstSeat = 0;
  for (const [name, meshes] of groups) {
    const cyl = cylOf(name), valve = valveOf(name);
    const seat = new THREE.Vector3().fromArray(valveSeatPoint(cyl, valve));
    const dir = new THREE.Vector3().fromArray(valveAxisDir(cyl, valve));
    const retainer = meshes.find((m) => m.userData.part === 'valve retainer');
    assert.ok(retainer, `${name} has no retainer mesh to read the tip off`);
    const pts = worldPoints(retainer);
    const along = pts.map((p) => new THREE.Vector3().subVectors(p, seat).dot(dir));
    const top = Math.max(...along);
    worstTip = Math.max(worstTip, Math.abs(top - H.stemToTip));
    const head = meshes.find((m) => m.userData.part === 'valve head');
    worstSeat = Math.max(worstSeat, Math.abs(Math.max(...worldPoints(head).map((p) => new THREE.Vector3().subVectors(p, seat).dot(dir)))));
  }
  assert.ok(worstTip < 0.02, `the highest retainer vertex stands ${worstTip.toFixed(6)} cm off the published stemToTip ${H.stemToTip} plane`);
  assert.ok(worstSeat < EPS, `a valve head disc stands ${worstSeat.toFixed(6)} cm proud of its machined seat plane`);
  console.log(`${LAW} tip: every retainer top within ${worstTip.toFixed(6)} cm of the ${H.stemToTip} cm tip plane, every head disc within ${worstSeat.toFixed(6)} cm of its seat`);
});

test(`${LAW}: the OHV valve lift is the lifter's contact law times the published rocker lever, at every crank degree`, async () => {
  const E = await import('../src/engine/ohv.js');
  const { group, update } = ohvTrain();
  const groups = valveGroups(group);
  assert.ok(groups.size, 'no valves drawn, so the lift law has nothing to measure');
  let worst = 0, peak = 0, peakAt = null, liftOffSeat = 0;
  for (let theta = 0; theta < 720; theta++) {
    update(theta);
    group.updateMatrixWorld(true);
    for (const [name, meshes] of groups) {
      const cyl = cylOf(name), valve = valveOf(name);
      const lift = E.ohvLift(cyl, valve, theta) * R;
      const want = new THREE.Vector3().fromArray(valveAxisPoint(cyl, valve, 0, theta));
      const stem = meshes.find((m) => m.userData.part === 'valve stem');
      const got = new THREE.Vector3(stem.getWorldPosition(new THREE.Vector3()).x,
        stem.getWorldPosition(new THREE.Vector3()).y, stem.getWorldPosition(new THREE.Vector3()).z);
      // the stem's own centre stands stemToTip/2 up the axis from the group origin
      const dir = new THREE.Vector3().fromArray(valveAxisDir(cyl, valve));
      const seat = new THREE.Vector3().fromArray(valveSeatPoint(cyl, valve));
      const moved = new THREE.Vector3().subVectors(got, seat).dot(dir) - H.stemToTip / 2;
      worst = Math.max(worst, Math.abs(moved - lift));
      if (lift > peak) { peak = lift; peakAt = theta; }
      if (lift > 0) liftOffSeat = Math.max(liftOffSeat, Math.abs(new THREE.Vector3().subVectors(got, seat).dot(dir) - (H.stemToTip / 2 + lift)));
    }
  }
  assert.ok(worst < EPS, `the drawn valves differ from lifter lift x rocker ratio ${R} by ${worst.toFixed(6)} cm over the whole cycle`);
  assert.ok(Math.abs(peak - V.maxLift) < 1e-9, `the lever law peaks at ${peak.toFixed(6)} cm against the published maxLift ${V.maxLift}`);
  assert.ok(liftOffSeat > 0, 'no valve was ever measured off its seat, so the train does not move');
  const lifterPeak = SPEC.cylinders.reduce((a, c) => Math.max(a, ...Array.from({ length: 720 }, (_, th) => E.ohvLift(c, 'exhaust', th) * R)), 0);
  assert.ok(Math.abs(lifterPeak - peak) < 1e-9, 'the drawn peak is not the peak the lifter law gives it');
  console.log(`${LAW} lift: 16 valves posed within ${worst.toFixed(6)} cm of ohvLift x ${R} over 720 crank degrees, peak ${peak.toFixed(6)} cm at cyl 1 exhaust crank ${peakAt}, lifter grind ${E.ohvCamLiftCm().toFixed(6)}`);
});

test(`${LAW}: 16 springs stand on the machined spring seat and are compressed by the lever law, short of coil bind`, async () => {
  const { group, update } = ohvTrain();
  const springs = family(group, /^spring-cyl\d+-(intake|exhaust)$/);
  const owed = followers('ohv').springs;
  assert.equal(springs.length, owed, `the OHV build draws ${springs.length} springs for the ${owed} its own contract counts`);
  const installed = H.stemToTip - H.retainerGap - H.guideLength;
  const solid = 2 * V.springCoils * V.springWireRadius;
  const coilOD = 2 * (V.springRadius + V.springWireRadius);
  update(0);
  group.updateMatrixWorld(true);
  let worstSeat = 0, worstTop = 0, worstLen = 0, worstOD = 0;
  for (const s of springs) {
    const cyl = cylOf(s.name), valve = valveOf(s.name);
    const seat = new THREE.Vector3().fromArray(valveSeatPoint(cyl, valve));
    const dir = new THREE.Vector3().fromArray(valveAxisDir(cyl, valve));
    const pts = worldPoints(s);
    const along = pts.map((p) => new THREE.Vector3().subVectors(p, seat).dot(dir));
    const lo = Math.min(...along), hi = Math.max(...along);
    worstSeat = Math.max(worstSeat, Math.abs(lo - H.guideLength));
    worstTop = Math.max(worstTop, Math.abs(hi - (H.stemToTip - H.retainerGap)));
    worstLen = Math.max(worstLen, Math.abs((hi - lo) - installed));
    worstOD = Math.max(worstOD, Math.max(...pts.map((p) => axisRadius(p, seat, dir))) - coilOD / 2);
  }
  assert.ok(worstSeat < 0.35, `a spring's lower end stands ${worstSeat.toFixed(4)} cm off the machined spring seat at ${H.guideLength} cm along the axis`);
  assert.ok(worstTop < 0.35, `a spring's upper end stands ${worstTop.toFixed(4)} cm off the retainer underside at ${H.stemToTip - H.retainerGap} cm`);
  assert.ok(worstLen < 0.05, `the installed spring length differs from stemToTip - retainerGap - guideLength = ${installed} cm by ${worstLen.toFixed(6)} cm`);
  assert.ok(worstOD < EPS, `the drawn coil OD differs from 2 x (springRadius + springWireRadius) = ${coilOD} cm by ${worstOD.toFixed(6)} cm`);
  assert.ok(coilOD < 2 * H.bucketBoreR, `a ${coilOD} cm coil will not stand in the ${2 * H.bucketBoreR} cm machined spring bore`);
  update(360); // the pose where the exhaust of cyl 1 is not on its seat is measured below; 360 is a legal mid-cycle pose
  group.updateMatrixWorld(true);
  let peakLen = Infinity;
  for (let theta = 0; theta < 720; theta++) {
    update(theta);
    group.updateMatrixWorld(true);
    for (const s of springs) {
      const cyl = cylOf(s.name), valve = valveOf(s.name);
      const seat = new THREE.Vector3().fromArray(valveSeatPoint(cyl, valve));
      const dir = new THREE.Vector3().fromArray(valveAxisDir(cyl, valve));
      const along = worldPoints(s).map((p) => new THREE.Vector3().subVectors(p, seat).dot(dir));
      peakLen = Math.min(peakLen, Math.max(...along) - Math.min(...along));
    }
  }
  assert.ok(peakLen > solid, `the springs reach ${peakLen.toFixed(4)} cm at full lift against a ${solid} cm solid height of ${V.springCoils} coils at ${2 * V.springWireRadius} cm wire: coil bind`);
  assert.ok(peakLen - solid > 0.5, `only ${(peakLen - solid).toFixed(4)} cm of air is left before coil bind at full lift`);
  console.log(`${LAW} spring: ${springs.length} springs, seat within ${worstSeat.toFixed(4)} / top within ${worstTop.toFixed(4)} / length within ${worstLen.toFixed(6)} cm, coil OD ${coilOD} in the ${2 * H.bucketBoreR} cm bore, shortest read ${peakLen.toFixed(4)} cm against ${solid} cm solid`);
});

test(`${LAW}: the valve tip publishes a rocker interface the published iron can actually hold`, async () => {
  const G = ohvLifterGallery();
  const LINER = SPEC.block.boreShellRadius;
  const rows = [];
  for (const side of valves) {
    const s = valveSide(side);
    const zero = { out: s * (H.seatOffset + Math.sin(H.valveAngle * DEG) * H.stemToTip) };
    const max = { out: s * (H.seatOffset + Math.sin(H.valveAngle * DEG) * (H.stemToTip - V.maxLift)), along: H.seatA + Math.cos(H.valveAngle * DEG) * (H.stemToTip - V.maxLift) };
    for (const bank of ['L', 'R']) {
      const lifterOut = G.banks[bank].axisOut;
      const pivot = (R * lifterOut + zero.out) / (R + 1);
      const armValve = Math.abs(pivot - zero.out);
      const armPushrod = Math.abs(lifterOut - pivot);
      assert.ok(Math.abs(armPushrod / armValve - 1 / R) < 1e-9,
        `${bank} ${side}: arms ${armValve.toFixed(4)} valve / ${armPushrod.toFixed(4)} pushrod read a lever of ${(armValve / armPushrod).toFixed(4)}, not the published ${R}`);
      const shaftPlane = max.along + PAD + SHAFT_R;
      const seg = plugAt(shaftPlane);
      const plugAir = Math.abs(pivot) - seg.r - SHAFT_R;
      const linerAir = Math.abs(pivot) - LINER - SHAFT_R;
      assert.ok(plugAir > 1.0, `${bank} ${side}: a rocker shaft at out ${pivot.toFixed(4)} leaves only ${plugAir.toFixed(4)} cm against the plug's ${seg.tag} at r ${seg.r} (floor 1.0)`);
      rows.push({ bank, side, pivot, armValve, armPushrod, shaftPlane, seg, plugAir, linerAir });
    }
  }
  const intake = rows.filter((r) => r.side === 'intake');
  const exhaust = rows.filter((r) => r.side === 'exhaust');
  assert.ok(intake.every((r) => r.linerAir < 0),
    `the intake pivots ${intake.map((r) => r.pivot.toFixed(4)).join(', ')} were expected inside the ${LINER} cm bore shell - that is why the #45 decision carries them on a shaft, and a law that let them stand on the deck would draw rockers into the liner`);
  assert.ok(exhaust.every((r) => r.linerAir > 0),
    `the exhaust pivots ${exhaust.map((r) => r.pivot.toFixed(4)).join(', ')} stand ${exhaust[0].linerAir.toFixed(4)} cm outside the bore shell: they may stand on the deck, and this law refuses a build that hides that`);
  console.log(`${LAW} interface: intake pivot out ${intake[0].pivot.toFixed(4)} (arms ${intake[0].armValve.toFixed(4)}/${intake[0].armPushrod.toFixed(4)}, plug air ${intake[0].plugAir.toFixed(4)} against ${intake[0].seg.tag}, ${Math.abs(intake[0].linerAir).toFixed(4)} inside the ${LINER} shell) | exhaust pivot out ${exhaust[0].pivot.toFixed(4)} (plug air ${exhaust[0].plugAir.toFixed(4)}, ${exhaust[0].linerAir.toFixed(4)} outside the shell) | shaft plane ${intake[0].shaftPlane.toFixed(4)}`);
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
    pushrods: family(group, /pushrod/).length,
    rockers: family(group, /rocker/).length,
    covers: family(group, /(^|-)cover/).length,
  };
  for (const [familyName, n] of Object.entries(drawn)) {
    const listed = pending.some((p) => p.family === familyName);
    assert.equal(listed, n === 0,
      `pendingHardware ${listed ? 'names' : 'does not name'} "${familyName}" while the build draws ${n} of them: the list has to be the measured gap, not a remembered one`);
  }
  for (const p of pending) {
    assert.ok(owed[p.family] > 0, `pendingHardware names "${p.family}", which this variant's own contract does not owe (${JSON.stringify(owed)})`);
    assert.ok(/^#\d+$/.test(p.issue), `pendingHardware family "${p.family}" is not tied to an open issue: "${p.issue}"`);
    assert.ok(p.why && p.why.length > 10, `pendingHardware family "${p.family}" names no reason a reader can check`);
    assert.equal(drawn[p.family], 0, `pendingHardware names "${p.family}" owed while the build draws ${drawn[p.family]} of them`);
  }
  const named = pending.map((p) => p.family).sort();
  assert.deepEqual(named, ['covers', 'pushrods', 'rockers'],
    `the measured gap is ${JSON.stringify(named)}; the row a reader sees has to name exactly that`);
  console.log(`${LAW} pending: drawn ${JSON.stringify(drawn)}, owed ${JSON.stringify(owed)}, named owed ${named.join(', ')}`);
});

test(`${LAW}: the drawn OHV valves and springs come off with the head they were seated in`, async () => {
  const rules = explodeRules();
  const at = (name) => {
    const r = rules.find((x) => x.re.test(name));
    return r ? { family: typeof r.family === 'function' ? r.family(name) : r.family, stage: r.stage } : null;
  };
  const dohcName = (kind) => `${kind}-cyl1-intake`;
  for (const kind of ['valve', 'spring']) {
    const r = at(dohcName(kind));
    assert.ok(r, `explodeRules has no rule for ${kind} parts at all`);
    assert.ok(/^(bank-L|bank-R)$/.test(r.family), `${kind} parts explode along ${r.family}; the valve row leaves its head up the bore axis`);
  }
  const { group } = ohvTrain();
  const vs = [...valveGroups(group).keys()];
  const sp = family(group, /^spring-cyl\d+-(intake|exhaust)$/).map((o) => o.name);
  assert.ok(vs.length && sp.length, 'no OHV valves or springs drawn to check the teardown against');
  for (const name of [...vs, ...sp]) {
    const r = at(name);
    assert.ok(r, `${name} is drawn in the OHV build and no explode rule claims it: it would travel with the casting it came out of`);
    const bank = /cyl(\d+)/.exec(name)[1];
    const c = SPEC.cylinders.find((k) => k.num === Number(bank));
    assert.equal(r.family, `bank-${c.bank}`, `${name} explodes in family ${r.family}, not its own bank's bore axis`);
  }
  const vStage = at('valve-cyl1-intake').stage;
  const sStage = at('spring-cyl1-intake').stage;
  const hStage = at('head-L').stage;
  assert.ok(vStage > hStage && sStage > vStage,
    `the teardown order is head ${hStage} -> valve ${vStage} -> spring ${sStage}: a spring that comes off before its valve would pass through it`);
  console.log(`${LAW} teardown: ${vs.length} valves at stage ${vStage} and ${sp.length} springs at stage ${sStage}, both in their own bank's family behind the head at stage ${hStage}`);
});
