// Heads unit - written RED first. Contract:
// - two head castings standing on the block deck through a copper head gasket
// - 16 valve guides + seat inserts exactly on the timing.js seat/axis points
// - machined spring seats exactly where the valvetrain springs actually sit
// - cam-cover ceiling derived from spec constants, clearing every rotating lobe
// - bucket bores that retain every bucket at every lift
// - 28 split, line-bored cam bearing columns (cradle half cast integral, cap half
//   bolted onto a drilled tab pair, a replaceable shell inside each half)
// - 32 head bolts at deckBoltRadius, clear of the bores
// - nothing pokes through the cover, nothing inside the sprocket band, every
//   casting solid connected, static/dynamic piston clearances proven.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  SPEC, DEG, bankUp, bankOut, bankPoint, camAxisBank, camAxisStation, HEAD_TOP_A, PLUG_BOSS_A,
} from '../src/engine/spec.js';
import {
  valveAxisDir, valveSeatPoint, camAxisPoint, pistonAlong, valveLift,
} from '../src/engine/timing.js';
import {
  engineTriangles, proxyMaterials, triDistance,
} from './support/engine-triangles.mjs';
import { plugStack, stackRadius, stackSamples } from './support/plug-stack.mjs';
import { trisOf, regionTris, raycast, coverage } from './support/ray-triangles.mjs';
import { bearingStack } from '../src/engine/bearings.js';

const H = SPEC.head;
const B = SPEC.block;
const C = SPEC.crank;
const CAM = SPEC.cam;
const V = SPEC.valves;
const valves = ['intake', 'exhaust'];

const mats = {};
for (const n of ['castAluminumHead', 'copperGasket', 'fastenerSteel', 'bearingShell',
  'valveIntake', 'valveExhaust', 'chainSteel']) { mats[n] = new THREE.MeshStandardMaterial({ name: n }); }

async function buildHeads() {
  const { createHeads } = await import('../src/render/heads.js');
  return createHeads(mats);
}
async function buildValvetrain() {
  const { createValvetrain } = await import('../src/render/valvetrain.js');
  return createValvetrain(mats);
}

const bankVectors = (bank) => ({
  up: new THREE.Vector3().fromArray(bankUp(bank)),
  out: new THREE.Vector3().fromArray(bankOut(bank)),
});
const alongOf = (v, bank, p) => p.dot(v.up);
const outOf = (v, bank, p) => p.dot(v.out);
// Tolerance for dimensions measured off a baked rotation (alignYTo quaternion +
// lathe trig): 0.0001 cm = 1 micron, far under anything machinable. Axis-aligned
// box faces are exact and keep their own 1e-6 checks.
const EPS = 1e-4;
const BAND = SPEC.crank.sprocket.x0; // 28.6: first cam chain sprocket plane
const camAlongA = (bank) => camAxisBank(bank, 'intake')[0];
const camOutA = (bank, valve) => camAxisBank(bank, valve)[1];
const seatVec = (cyl, valve) => {
  const s = valveSeatPoint(cyl, valve);
  return new THREE.Vector3(s.x, s.y, s.z);
};

/**
 * World-space vertex list of a baked single-level mesh. Each vertex must be a
 * distinct Vector3: aliasing one scratch vector made every measured span
 * collapse onto the last vertex.
 */
function verts(mesh) {
  mesh.updateWorldMatrix(true, false);
  const pos = mesh.geometry.attributes.position;
  const arr = [];
  for (let i = 0; i < pos.count; i++) {
    arr.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
  }
  return arr;
}
/** World vertices of every mesh under a group (covers, gaskets). */
function vertsOf(group) {
  const arr = [];
  group.traverse((o) => { if (o.isMesh) arr.push(...verts(o)); });
  return arr;
}
/** Axial (s) and radial (r) coordinates around a seat point along a valve axis. */
function axial(p, seat, d) {
  const s = p.clone().sub(seat).dot(d);
  const r = p.clone().sub(seat).addScaledVector(d, -s).length();
  return { s, r };
}

// Census of one head casting, derived from the same table the parts are built from -
// the build-contract law reads the numbers out of this table instead of typing them,
// and the A1-G7 column law gates every one of these kinds separately.
// One head casting's census, in kinds. The A1-G7 move: the closed 360-degree boss
// (14), its web (14), the old cast-integral cap row (14) and the bearing clamps (28)
// are replaced by 14 cradle halves, 14 bolt-on cap halves, 14 cam bearing housings
// (each a merged casting: deck-side web plus tie ribs plus one riser each side of the
// cam axis line, the riser top faces being the cam cover seating plane), 56 drilled
// tabs (the cap/cradle pair per column, mirrored to both sides of the cam axis line)
// and 28 replaceable shells. Measured 166 solids per bank before the move, 180 after it.
const KIND_COUNTS = {
  rail: 2, chimney: 4, stay: 8,
  seatRing: 8, guide: 8, floor: 8, springtube: 8, bucketbore: 8,
  // the cam girder bridges are gone with the closed boss: a crown-side girder anywhere
  // along the tunnel blocks either the cap lift path or the wrench at a cap bolt, so
  // the cap is held by its drilled tab pair and the cap bolt alone.
  bridge: 0,
  cradle: 14, cap: 14, housing: 14, tab: 56, shell: 28,
};
const PER_BANK = Object.values(KIND_COUNTS).reduce((a, b) => a + b, 0);

test(`heads build contract: 2 castings x ${PER_BANK} solids, 16 guides + seat inserts, 4 covers, 2 gaskets, 32 head bolts`, async () => {
  const { group } = await buildHeads();
  assert.equal(group.name, 'heads');
  let bolts = 0;
  for (const bank of ['L', 'R']) {
    const head = group.getObjectByName(`head-${bank}`);
    assert.ok(head, `head-${bank} missing`);
    const kinds = {};
    let partsTotal = 0;
    head.traverse((o) => {
      if (!o.isMesh) return;
      partsTotal += 1;
      kinds[o.userData.kind] = (kinds[o.userData.kind] ?? 0) + 1;
    });
    // the census table and the casting are one contract: any kind the casting carries
    // has to be named here, and every named kind has to stand in the casting
    for (const [kind, want] of Object.entries(KIND_COUNTS)) {
      assert.equal(kinds[kind] ?? 0, want, `head-${bank} ${kind}: got ${kinds[kind] ?? 0} want ${want}`);
    }
    for (const [kind, got] of Object.entries(kinds)) {
      assert.equal(KIND_COUNTS[kind], got, `head-${bank} carries ${got} part(s) of kind ${kind}, which the census table does not name this way`);
    }
    console.log(`head-${bank} census: ${Object.keys(kinds).length} kinds, ${partsTotal} solids (census table sums to ${PER_BANK})`);
    for (const kind of Object.keys(kinds)) {
      assert.ok(KIND_COUNTS[kind] !== undefined, `head-${bank} carries kind ${kind}, which no census row names`);
    }
    for (const valve of valves) {
      const cover = group.getObjectByName(`cam-cover-${bank}-${valve}`);
      assert.ok(cover, `cam-cover-${bank}-${valve} missing`);
      let meshes = 0;
      cover.traverse((o) => { if (o.isMesh) meshes += 1; });
      assert.equal(meshes, 5, `cam-cover-${bank}-${valve} meshes`);
    }
    const gasket = group.getObjectByName(`gasket-${bank}`);
    assert.ok(gasket, `gasket-${bank} missing`);
    let rings = 0;
    gasket.traverse((o) => {
      if (!o.isMesh) return;
      rings += 1;
      assert.equal(o.material.name, 'copperGasket');
    });
    assert.equal(rings, 4, `gasket-${bank} rings`);
  }
  let guides = 0;
  group.traverse((o) => {
    if (/^guide-cyl\d+-(intake|exhaust)$/.test(o.name)) guides += 1;
    if (o.isInstancedMesh && o.name === 'head-bolts') { assert.equal(o.count, 32); bolts = o.count; }
  });
  assert.equal(guides, 16, 'valve guides');
  assert.equal(bolts, 32, 'head bolt instances');
});

test('castings stand on the deck through the gasket; rails carry the full gasket footprint', async () => {
  const { group } = await buildHeads();
  const want = B.deckA + H.gasketT;
  for (const bank of ['L', 'R']) {
    const v = bankVectors(bank);
    const head = group.getObjectByName(`head-${bank}`);
    head.traverse((o) => {
      if (!o.isMesh) return;
      // chamber-side hardware legitimately hangs below the head deck face:
      // the seat insert IS the seat plane (deck level) and its outboard disc
      // edge droops into the machined liner pocket; the guide sits in it.
      if (o.userData.kind === 'seatRing' || o.userData.kind === 'guide') return;
      for (const p of verts(o)) {
        assert.ok(alongOf(v, bank, p) > want - 1e-6, `head-${bank} ${o.name} pokes below the gasket top`);
      }
    });
    let rails = 0;
    head.traverse((o) => {
      if (o.userData.kind !== 'rail') return;
      rails += 1;
      const vs = verts(o);
      const lo = Math.min(...vs.map((p) => alongOf(v, bank, p)));
      const oMin = Math.min(...vs.map((p) => outOf(v, bank, p)));
      const oMax = Math.max(...vs.map((p) => outOf(v, bank, p)));
      const xMin = Math.min(...vs.map((p) => p.x));
      const xMax = Math.max(...vs.map((p) => p.x));
      assert.ok(Math.abs(lo - want) < 1e-6, `rail bottom along ${lo} != deck + gasket ${want}`);
      // one rail per side of the bore row: each carries the gasket band on
      // its side, so the out span is +/-[gasketId..gasketOd] sign-normalised
      const sLo = Math.min(Math.abs(oMin), Math.abs(oMax));
      const sHi = Math.max(Math.abs(oMin), Math.abs(oMax));
      assert.ok(Math.abs(sLo - H.gasketId) < 1e-6 && Math.abs(sHi - H.gasketOd) < 1e-6,
        `rail out span ${oMin}..${oMax} != gasket footprint +-${H.gasketId}..${H.gasketOd}`);
      assert.ok(Math.abs(xMin - (B.stations[3] - B.pitch / 2)) < 1e-6 &&
        Math.abs(xMax - (B.stations[0] + B.pitch / 2)) < 1e-6, `rail x ${xMin}..${xMax} != deck ends`);
    });
    assert.equal(rails, 2);
    // A head gasket bore is a full ring about its bore axis, so its extent is
    // measured as a radius from that axis, not as an out span.
    const gasket = group.getObjectByName(`gasket-${bank}`);
    gasket.traverse((o) => {
      if (!o.isMesh) return;
      // head meshes bake their geometry (position stays at the origin), so the
      // station comes from the measured bbox centre, not from mesh.position
      const bb = new THREE.Box3().setFromObject(o);
      const cx = (bb.min.x + bb.max.x) / 2;
      const st = B.stations.reduce((a, s) => (Math.abs(cx - s) < Math.abs(cx - a) ? s : a), B.stations[0]);
      const rad = (p) => Math.hypot(outOf(v, bank, p), p.x - st);
      const vs = verts(o);
      const lo = Math.min(...vs.map((p) => alongOf(v, bank, p)));
      const hi = Math.max(...vs.map((p) => alongOf(v, bank, p)));
      const rMin = Math.min(...vs.map(rad));
      const rMax = Math.max(...vs.map(rad));
      assert.ok(Math.abs(lo - B.deckA) < EPS, `gasket bottom ${lo} != block deck ${B.deckA}`);
      assert.ok(Math.abs(hi - want) < EPS, `gasket top ${hi} != head face ${want}`);
      assert.ok(Math.abs(rMin - H.gasketId) < EPS && Math.abs(rMax - H.gasketOd) < EPS,
        `gasket bore radius ${rMin}..${rMax} != ${H.gasketId}..${H.gasketOd}`);
      assert.ok(rMin > SPEC.piston.radius, `gasket inner edge ${rMin} must clear the ${SPEC.piston.radius} piston at TDC`);
      assert.ok(rMax < H.gasketId + 2.0, `gasket ${rMax} must stay under the deck rails`);
    });
  }
});

test('16 guides sit exactly on the valve axes and seats; spring seats sit exactly where the springs sit', async () => {
  const { group } = await buildHeads();
  const vt = await buildValvetrain();
  vt.update(0);
  for (const cyl of SPEC.cylinders) {
    for (const valve of valves) {
      const guide = group.getObjectByName(`guide-cyl${cyl.num}-${valve}`);
      const ring = group.getObjectByName(`seat-cyl${cyl.num}-${valve}`);
      const floor = group.getObjectByName(`springfloor-cyl${cyl.num}-${valve}`);
      assert.ok(guide && ring && floor, `guide/seat/floor cyl ${cyl.num} ${valve} missing`);
      const seat = seatVec(cyl, valve);
      const d = new THREE.Vector3().fromArray(valveAxisDir(cyl, valve));
      const g = { sMin: Infinity, sMax: -Infinity, rMin: Infinity, rMax: -Infinity };
      for (const p of verts(guide)) {
        const a = axial(p, seat, d);
        g.sMin = Math.min(g.sMin, a.s); g.sMax = Math.max(g.sMax, a.s);
        g.rMin = Math.min(g.rMin, a.r); g.rMax = Math.max(g.rMax, a.r);
      }
      assert.ok(Math.abs(g.sMin - 0.4) < EPS && Math.abs(g.sMax - (0.4 + H.guideLength)) < EPS,
        `guide cyl ${cyl.num} ${valve} spans s ${g.sMin}..${g.sMax}, want 0.4..${0.4 + H.guideLength}`);
      assert.ok(Math.abs(g.rMin - H.guideBoreR) < EPS, `guide bore r ${g.rMin} != ${H.guideBoreR}`);
      assert.ok(g.rMin > H.stemRadius + 0.05 && g.rMin - H.stemRadius < 0.25, `guide bore ${g.rMin} vs stem ${H.stemRadius}`);
      let fMin = Infinity, fMax = -Infinity;
      for (const p of verts(floor)) {
        const s = axial(p, seat, d).s;
        fMin = Math.min(fMin, s); fMax = Math.max(fMax, s);
      }
      assert.ok(Math.abs(fMax - H.guideLength) < EPS, `spring seat ${fMax} != guideLength ${H.guideLength}`);
      assert.ok(Math.abs(fMin - (H.guideLength - H.floorT)) < EPS, `floor bottom ${fMin}`);
      let ringBottom = Infinity;
      for (const p of verts(ring)) ringBottom = Math.min(ringBottom, axial(p, seat, d).s);
      assert.ok(Math.abs(ringBottom) < EPS, `seat insert bottom ${ringBottom} != valve seat plane 0`);
      const spring = vt.group.getObjectByName(`spring-cyl${cyl.num}-${valve}`);
      assert.ok(spring, 'matching spring missing');
      let springBottom = Infinity;
      for (const p of verts(spring)) springBottom = Math.min(springBottom, axial(p, seat, d).s);
      // the bottom coil wire dips slightly into its machined seat: that is the spring sitting on it
      assert.ok(springBottom > H.guideLength - V.springWireRadius - 0.05 &&
        springBottom < H.guideLength + 0.35,
        `spring bottom ${springBottom} not on the machined seat at ${H.guideLength}`);
    }
  }
});

test('cam covers: top face exactly at HEAD_TOP_A, ceiling clears every rotating lobe, nothing in the sprocket band', async () => {
  const vt = await buildValvetrain();
  const heads = await buildHeads();
  const noseR = H.camBaseRadius + V.maxLift;
  for (const bank of ['L', 'R']) {
    const v = bankVectors(bank);
    const camA = camAlongA(bank);
    for (const valve of valves) {
      const cover = heads.group.getObjectByName(`cam-cover-${bank}-${valve}`);
      assert.ok(cover, `cam-cover-${bank}-${valve} missing`);
      const oCam = camOutA(bank, valve);
      const vs = vertsOf(cover);
      const top = Math.max(...vs.map((p) => alongOf(v, bank, p)));
      assert.ok(Math.abs(top - HEAD_TOP_A) < 1e-3, `cover top ${top} != HEAD_TOP_A ${HEAD_TOP_A}`);
      const ceil = cover.userData.ceilingA;
      assert.ok(Math.abs(top - H.coverPlate - ceil) < 1e-3, `ceiling ${ceil} vs top ${top} - plate ${H.coverPlate}`);
      assert.ok(ceil > camA + H.camJournalRadius + 0.1, `ceiling ${ceil} does not clear the journal top`);
      for (const p of vs) {
        const r = Math.hypot(alongOf(v, bank, p) - camA, outOf(v, bank, p) - oCam);
        assert.ok(r >= noseR + 0.15, `cover ${cover.name} intrudes on the cam sweep (r ${r} < ${noseR + 0.15})`);
        assert.ok(Math.abs(p.x) <= 28.6 - 0.04, `cover ${cover.name} x ${p.x} inside the sprocket band`);
      }
      // every lobe nose stays under this cover's ceiling
      for (const cyl of SPEC.cylinders.filter((c) => c.bank === bank)) {
        const lobe = vt.group.getObjectByName(`lobe-cyl${cyl.num}-${valve}`);
        assert.ok(lobe, `lobe cyl ${cyl.num} ${valve} missing`);
        const lo = new THREE.Vector3();
        lobe.getWorldPosition(lo);
        if (Math.abs(alongOf(v, bank, lo) - camA) < 2.0) {
          for (const p of verts(lobe)) {
            assert.ok(alongOf(v, bank, p) < ceil - 0.3,
              `lobe cyl ${cyl.num} ${valve} pokes through the cover ceiling ${ceil}`);
          }
        }
      }
    }
  }
});

test('28 bearing columns: a cradle half in the casting, a cap half on its tab pair, both bored to the published line bore', async () => {
  const { group } = await buildHeads();
  const ST = bearingStack();
  for (const bank of ['L', 'R']) {
    const v = bankVectors(bank);
    const head = group.getObjectByName(`head-${bank}`);
    const lines = [];
    for (const kind of ['boss', 'bossweb', 'clamp', 'bridge']) {
      let n = 0;
      head.traverse((o) => { if (o.isMesh && o.userData.kind === kind) n += 1; });
      assert.equal(n, 0, `head-${bank} still carries ${n} part(s) of kind ${kind}: the closed 360-degree boss, its web and its bearing clamps are the casting A1-G7 replaces with a split, line-bored tunnel - the row's supersede line names the move`);
    }
    // the counts are read out of the census table the build-contract law uses:
    // one source for the part census, the column law gates the bearing kinds in it
    for (const kind of ['cradle', 'cap', 'housing', 'tab', 'shell']) {
      const want = KIND_COUNTS[kind];
      let n = 0;
      head.traverse((o) => { if (o.isMesh && o.userData.kind === kind) n += 1; });
      assert.equal(n, want, `head-${bank} ${kind}: got ${n} want ${want}`);
    }
    for (const valve of valves) {
      const camA = camAlongA(bank);
      const oCam = camOutA(bank, valve);
      for (const bx of CAM.bearings) {
        const cradle = head.children.find((o) => o.name === `cradle-${bank}-${valve}-${bx}`);
        const cap = head.children.find((o) => o.name === `cap-${bank}-${valve}-${bx}`);
        assert.ok(cradle && cap, `cradle/cap for ${bank} ${valve} x ${bx} missing`);
        for (const [part, name, boltOn] of [[cradle, 'cradle', false], [cap, 'cap', true]]) {
          assert.equal(part.material.name, 'castAluminumHead', `${name} ${bank} ${valve} x${bx} is not head casting`);
          assert.equal(part.userData.boltOn === true, boltOn, `${name} ${bank} ${valve} x${bx} boltOn=${part.userData.boltOn === true}`);
          const rel = columnFrameOf(v, bank, camA, oCam, verts(part), bx - CAM.bearingHalf, bx + CAM.bearingHalf);
          const r = rel.map((q) => q.r);
          const xLo = Math.min(...rel.map((q) => q.x));
          const xHi = Math.max(...rel.map((q) => q.x));
          // Both halves are bored to the published line bore - the A1-G7 laws gate the
          // split and the shell against it, this half of the row names the parts.
          assert.ok(Math.abs(Math.min(...r) - ST.boreR) <= 0.006,
            `${name} ${bank} ${valve} x${bx}: bore stands at ${Math.min(...r).toFixed(4)} cm, the published line bore is ${ST.boreR}`);
          assert.ok(Math.abs(Math.max(...r) - ST.castOdR) <= 0.006,
            `${name} ${bank} ${valve} x${bx}: casting outside stands at ${Math.max(...r).toFixed(4)} cm, the stack puts it at ${ST.castOdR}`);
          assert.ok(xLo <= bx - CAM.bearingHalf + 1e-6 && xHi >= bx + CAM.bearingHalf - 1e-6,
            `${name} ${bank} ${valve} x${bx}: x ${xLo}..${xHi} does not cover the ${2 * CAM.bearingHalf} cm bearing width at ${bx}`);
          assert.ok(xHi <= BAND + 1e-6 && xLo >= -BAND - 1e-6,
            `${name} ${bank} ${valve} x${bx}: x ${xLo}..${xHi} intrudes on the sprocket band (band ${-BAND}..${BAND})`);
          // Split-plane classification straight off the plane the two halves are machined
          // against: the signed distance of every vertex from the plane holding the crank
          // axis and the bank's out vector, through the cam axis line. Vertices standing
          // on that plane are the contact face - the two halves meet there.
          const dist = rel.map((q) => q.along);
          const crown = dist.filter((d) => d > ARC_TOL).length;
          const deck = dist.filter((d) => d < -ARC_TOL).length;
          const onPlane = rel.length - crown - deck;
          const ownSide = boltOn ? 'crown' : 'deck';
          const wrongSide = boltOn ? deck : crown;
          assert.ok((boltOn ? crown : deck) > 0 && onPlane > 0,
            `${name} ${bank} ${valve} x${bx}: ${crown} crown-side, ${deck} deck-side and ${onPlane} on-plane vertices - a ${name} half needs material on its own ${ownSide} side of the split plane AND a face standing on that plane, because that face is where the two halves meet`);
          assert.equal(wrongSide, 0,
            `${name} ${bank} ${valve} x${bx}: ${wrongSide} vertex/vertices reach past the split plane onto the ${boltOn ? 'deck' : 'crown'} side. The tunnel is split on one machined plane through the cam axis line; a half may not stand across it and still lift off along its normal.`);
          lines.push(`${bank} ${valve} x${bx}: ${name} bore ${Math.min(...r).toFixed(4)} od ${Math.max(...r).toFixed(4)} x ${xLo.toFixed(2)}..${xHi.toFixed(2)} ${ownSide} ${crown}/${deck} deck-side contact ${onPlane}`);
        }
        // the column's shells: one inside the cap half, one inside the cradle half
        for (const half of ['cap', 'cradle']) {
          const s = head.children.find((o) => o.name === `shell-${bank}-${valve}-${bx}-${half}`);
          assert.ok(s, `bearing shell ${half} ${bank} ${valve} x${bx} missing`);
          assert.equal(s.material.name, 'bearingShell', `shell ${half} ${bank} ${valve} x${bx} material ${s.material.name}`);
          assert.equal(s.userData.boltOn === true, half === 'cap', `shell ${half} boltOn=${s.userData.boltOn === true}`);
          const rel = columnFrameOf(v, bank, camA, oCam, verts(s), bx - CAM.bearingHalf, bx + CAM.bearingHalf);
          const r = rel.map((q) => q.r);
          assert.ok(Math.abs(Math.max(...r) - ST.boreR) <= 0.006,
            `shell ${half} ${bank} ${valve} x${bx}: outside stands at ${Math.max(...r).toFixed(4)} against the ${ST.boreR} line bore it is pressed into`);
          assert.ok(Math.abs(Math.min(...r) - ST.shellIdR) <= 0.006,
            `shell ${half} ${bank} ${valve} x${bx}: inside stands at ${Math.min(...r).toFixed(4)} against the ${ST.shellIdR} cm journal-plus-film it rides on`);
        }
        // tab pair: one on the cap half, one on the cradle half, each drilled, each
        // machined to the published tab height and standing tabInset off the split plane
        for (const [side, crown] of [[1, true], [-1, false]]) {
          const t = head.children.find((o) => o.name === `tab-${bank}-${valve}-${bx}-${crown ? 'cap' : 'cradle'}-${side > 0 ? 'o' : 'i'}`);
          assert.ok(t, `tab ${bank} ${valve} x${bx} side ${side} crown=${crown} missing`);
          assert.equal(t.userData.boltOn === true, crown, `tab ${t.name} boltOn=${t.userData.boltOn === true}`);
          const rel = columnFrameOf(v, bank, camA, oCam, verts(t), bx - CAM.bearingHalf - 0.3, bx + CAM.bearingHalf + 0.3);
          const a0 = Math.min(...rel.map((q) => q.along));
          const a1 = Math.max(...rel.map((q) => q.along));
          const o0 = Math.min(...rel.map((q) => Math.abs(q.out)));
          const o1 = Math.max(...rel.map((q) => Math.abs(q.out)));
          assert.ok(Math.abs((a1 - a0) - ST.tabH) <= 0.006, `tab ${t.name} is ${(a1 - a0).toFixed(4)} cm high against the published ${ST.tabH}`);
          const near = crown ? a0 : a1;
          assert.ok(Math.abs(Math.abs(near) - ST.tabInset) <= 0.006,
            `tab ${t.name} stands ${near.toFixed(4)} cm from the cam axis line; a tab has to stand ${ST.tabInset} clear of the split plane so the line-bore cutter machines the bore alone`);
          assert.ok(Math.abs(o0 - ST.boreR) <= 0.006 && Math.abs(o1 - ST.tabR) <= 0.006,
            `tab ${t.name} spans out ${o0.toFixed(4)}..${o1.toFixed(4)} against the published ${ST.boreR}..${ST.tabR} from the line bore out to the tab edge`);
          const xLo = Math.min(...rel.map((q) => q.x));
          const xHi = Math.max(...rel.map((q) => q.x));
          assert.ok(Math.abs((xHi - xLo) - 2 * ST.tabHalf) <= 0.006, `tab ${t.name} is ${(xHi - xLo).toFixed(4)} cm wide along the cam axis, the published tab width is ${2 * ST.tabHalf}`);
        }
        // The column's housing: the cast material the column stands on and the plane the
        // cam cover bolts onto. Measured over every vertex of the part, not just the ones
        // inside the column window.
        const housing = head.children.find((o) => o.name === `housing-${bank}-${valve}-${bx}`);
        assert.ok(housing, `cam bearing housing ${bank} ${valve} x${bx} missing: a split, line-bored column needs a housing to stand on and a machined plane for the cover to bolt onto`);
        assert.equal(housing.material.name, 'castAluminumHead', `housing ${bank} ${valve} x${bx} is not head casting: only the casting may carry a bearing column`);
        const hv = verts(housing).map((p) => {
          const along = alongOf(v, bank, p) - camA;
          const out = outOf(v, bank, p) - oCam;
          return { x: p.x, along, out, r: Math.hypot(along, out) };
        });
        const hNear = Math.min(...hv.map((q) => q.r));
        const hTop = Math.max(...hv.map((q) => q.along));
        const hLow = Math.min(...hv.map((q) => q.along));
        assert.ok(hNear >= ST.boreR,
          `housing ${bank} ${valve} x${bx} holds material ${hNear.toFixed(4)} cm from the cam axis line, inside the ${ST.boreR} cm line bore it machines: a column holding material in its own bore is a bushing cast into the head, not a bearing`);
        assert.ok(hNear <= ST.castOdR,
          `housing ${bank} ${valve} x${bx} nearest material stands ${hNear.toFixed(4)} cm off the cam axis line while the published casting outside of the tunnel is ${ST.castOdR} cm: the housing never reaches the column, so the column stands on nothing`);
        // Wrench access at a cap bolt is a distance along the head face, not a polar
        // radius off the cam line: a socket turns around the bolt axis, and a riser's
        // box corners sit CAP_TOP above the split plane, so their polar radius
        // (hypot(2.80, 3.675) = 4.62) is inflated by that height and cannot see a wall
        // standing in front of the bolt. Measured on the axis the socket moves on.
        const hCrown = hv.filter((q) => q.along > ARC_TOL);
        assert.ok(hCrown.length, `housing ${bank} ${valve} x${bx} carries no crown-side material: the column and the cover have nothing to stand on`);
        const hWrench = Math.min(...hCrown.map((q) => Math.abs(q.out)));
        const hWrenchR = Math.min(...hCrown.map((q) => q.r));
        assert.ok(hWrenchR >= ST.tabR - ARC_TOL,
          `housing ${bank} ${valve} x${bx} crown-side material stands ${hWrenchR.toFixed(4)} cm off the cam axis line while the bolt tab ring reaches ${ST.tabR} cm: a housing inside the tab ring blocks the cap lifting along its own split plane`);
        assert.ok(hWrench >= ST.housingInRel - ARC_TOL,
          `housing ${bank} ${valve} x${bx} crown-side wall stands ${hWrench.toFixed(4)} cm off the cam axis line on the bolt's own side axis; the published stack puts that wall at ${ST.housingInRel.toFixed(4)} cm - the cap bolt line ${ST.boltOutRel.toFixed(4)} cm plus its hex across the corners ${ST.boltCircumR.toFixed(4)} cm plus ${ST.wrenchClr} cm of socket - and a wall inside that line leaves no room to turn the ${CAM.bearings.length * 2 * 2} cap bolts of this cam line`);
        assert.ok(hWrench <= ST.housingOutRel + ARC_TOL,
          `housing ${bank} ${valve} x${bx} crown-side wall starts at ${hWrench.toFixed(4)} cm, past the published housing face at ${ST.housingOutRel.toFixed(4)} cm: the wall is thinner than the published ${ST.housingWall} cm it is derived from`);
        assert.ok(Math.abs(hTop - ST.castOdR) <= ARC_TOL,
          `housing ${bank} ${valve} ${bx} top face stands ${hTop.toFixed(4)} cm above the cam axis line; the cover has to bolt onto a machined plane at the cap split level, which the stack puts at ${ST.castOdR} cm above the line`);
        const stay = head.children.find((o) => o.name === `stay-${bank}-out-${B.stations[0]}`);
        const stayLow = Math.min(...verts(stay).map((p) => alongOf(v, bank, p))) - camA;
        assert.ok(Math.abs(hLow - stayLow) <= 0.01,
          `housing ${bank} ${valve} x${bx} reaches along ${hLow.toFixed(4)} while the deck ribs it stands beside reach along ${stayLow.toFixed(4)}: a bearing housing has to be carried to the same machined plane the rest of the casting stands on, otherwise it is a tower cantilevered off a bearing shell`);
        lines.push(`${bank} ${valve} x${bx}: housing ${hNear.toFixed(4)}..${Math.max(...hv.map((q) => q.r)).toFixed(4)} off the line, top face +${hTop.toFixed(4)}, riser wall ${hWrench.toFixed(4)} past the cam line (${hWrenchR.toFixed(4)} off it, against the ${ST.tabR} tab ring)`);
      }
    }
    console.log(`A1-G7 column contract, 4 of ${lines.length}:\n  ${lines.slice(0, 4).join('\n  ')}`);
  }
});

test('32 head bolts at deckBoltRadius stand on the rails and clear every bore', async () => {
  const { headBoltSpecs } = await import('../src/render/heads.js');
  const { group } = await buildHeads();
  const specs = headBoltSpecs();
  assert.equal(specs.length, 32);
  const bolts = group.getObjectByName('head-bolts');
  assert.ok(bolts && bolts.isInstancedMesh && bolts.count === 32, 'head-bolts instanced mesh missing');
  const hexR = H.deckBoltRadius / Math.cos(Math.PI / 6);
  for (const spec of specs) {
    const v = bankVectors(spec.bank);
    const p = new THREE.Vector3(spec.p[0], spec.p[1], spec.p[2]);
    const o = outOf(v, spec.bank, p);
    assert.ok(Math.abs(Math.abs(o) - H.boltOut) < 1e-6, `bolt out ${o} != ${H.boltOut}`);
    assert.ok(Math.abs(alongOf(v, spec.bank, p) - H.railTopA) < 1e-6,
      `bolt along ${alongOf(v, spec.bank, p)} != rail top ${H.railTopA}`);
    const st = B.stations.reduce((a, s) => (Math.abs(p.x - s) < Math.abs(p.x - a) ? s : a));
    assert.ok(Math.abs(Math.abs(p.x - st) - H.boltXOff) < 1e-6, `bolt x ${p.x} not at station ${st} +/- ${H.boltXOff}`);
    const radial = Math.hypot(p.x - st, o);
    assert.ok(radial - hexR > B.boreShellRadius + 0.4, `bolt radial ${radial} too close to bore ${B.boreShellRadius}`);
    assert.ok(Math.abs(spec.dir[0]) < 1e-9 &&
      Math.abs(spec.dir[1] + bankUp(spec.bank)[1]) < 1e-9 &&
      Math.abs(spec.dir[2] + bankUp(spec.bank)[2]) < 1e-9, `bolt dir ${spec.dir} != -bankUp`);
  }
});

test('bucket bores retain every bucket at every lift and clear the spring coils', async () => {
  const { group } = await buildHeads();
  const vt = await buildValvetrain();
  // flange bottom at lift 0 (from the closed chain in timing.js): cam face -> bucket -> shim
  const flangeBottom0 = camAxisStation - H.camBaseRadius - H.bucketHeight; // 8.7
  for (const cyl of SPEC.cylinders) {
    for (const valve of valves) {
      const collar = group.getObjectByName(`bucketbore-cyl${cyl.num}-${valve}`);
      const tube = group.getObjectByName(`springtube-cyl${cyl.num}-${valve}`);
      assert.ok(collar && tube, `bucket bore / spring tube cyl ${cyl.num} ${valve} missing`);
      const seat = seatVec(cyl, valve);
      const d = new THREE.Vector3().fromArray(valveAxisDir(cyl, valve));
      assert.ok(Math.abs(collar.userData.boreR - H.bucketBoreR) < 1e-6, `bore r ${collar.userData.boreR}`);
      assert.ok(collar.userData.boreS1 >= flangeBottom0 + 0.4 + 0.1,
        `bore top ${collar.userData.boreS1} does not retain the flange top ${flangeBottom0 + 0.4}`);
      assert.ok(collar.userData.boreS0 <= flangeBottom0 - V.maxLift - 0.1,
        `bore bottom ${collar.userData.boreS0} does not retain the flange at max lift`);
      assert.ok(H.bucketBoreR - H.bucketFlangeRadius >= 0.08 && H.bucketBoreR - H.bucketFlangeRadius <= 0.25,
        `bore clearance ${H.bucketBoreR - H.bucketFlangeRadius} out of 0.08..0.25`);
      assert.ok(H.bucketBoreR > V.springRadius + V.springWireRadius + 0.3, 'spring bore must clear the coil OD');
      for (const theta of [0, 90, 180, 265, 350, 470, 560, 700]) {
        vt.update(theta);
        const flange = vt.group.getObjectByName(`bucket-cyl${cyl.num}-${valve}-flange`);
        assert.ok(flange, 'matching bucket flange missing');
        for (const p of verts(flange)) {
          const a = axial(p, seat, d);
          assert.ok(a.r < H.bucketBoreR - 0.05, `bucket cyl ${cyl.num} ${valve} rubs the bore at theta ${theta} (r ${a.r})`);
          assert.ok(a.s > collar.userData.boreS0 - 1e-6 && a.s < collar.userData.boreS1 + 1e-6,
            `flange at s ${a.s} escapes the bore ${collar.userData.boreS0}..${collar.userData.boreS1} at theta ${theta}`);
        }
      }
    }
  }
});

test(`nothing floats and nothing intrudes: ${PER_BANK} connected solids per bank, envelope clear of the piston`, async () => {
  const { group } = await buildHeads();
  const tdcCrown = C.radius + SPEC.rod.length + SPEC.piston.compressionHeight; // 22.4
  for (const bank of ['L', 'R']) {
    const v = bankVectors(bank);
    const head = group.getObjectByName(`head-${bank}`);
    const parts = [];
    head.traverse((o) => { if (o.isMesh) parts.push(o); });
    assert.equal(parts.length, PER_BANK, `head-${bank} mesh count`);
    for (const o of parts) {
      const limit = o.userData.kind === 'seatRing' ? tdcCrown + 0.5 : tdcCrown + 1.5;
      for (const p of verts(o)) {
        assert.ok(alongOf(v, bank, p) > limit, `head-${bank} ${o.name} reaches into the piston TDC zone (${alongOf(v, bank, p)})`);
      }
      assert.ok(Math.abs(outOf(v, bank, new THREE.Vector3().setFromMatrixPosition(o.matrixWorld))) < 11.6);
      const bb = new THREE.Box3().setFromObject(o);
      assert.ok(Math.max(Math.abs(alongOf(v, bank, bb.min.clone())), Math.abs(alongOf(v, bank, bb.max.clone())),
        Math.abs(outOf(v, bank, bb.min.clone())), Math.abs(outOf(v, bank, bb.max.clone()))) < 45.0,
        `head-${bank} ${o.name} outside the engine envelope`);
    }
    // connectivity: BFS from the rails over touching (0.05-tolerant) bounding boxes
    const boxes = parts.map((o) => {
      const bb = new THREE.Box3().setFromObject(o);
      bb.min.addScalar(-0.05);
      bb.max.addScalar(0.05);
      return bb;
    });
    const seen = new Set();
    let frontier = [];
    parts.forEach((o, i) => { if (o.userData.kind === 'rail') { seen.add(i); frontier.push(i); } });
    while (frontier.length) {
      const next = [];
      for (const i of frontier) {
        for (let j = 0; j < boxes.length; j++) {
          if (!seen.has(j) && boxes[i].intersectsBox(boxes[j])) { seen.add(j); next.push(j); }
        }
      }
      frontier = next;
    }
    assert.equal(seen.size, parts.length, `head-${bank}: ${parts.length - seen.size} disconnected solids`);
  }
});

test('dynamic clearance: valve disc edges never enter the piston crown plane, overlap stays on the ramps', async () => {
  await buildHeads();
  const vt = await buildValvetrain();
  const tdcCrown = C.radius + SPEC.rod.length + SPEC.piston.compressionHeight;
  // Clearance is measured from the flat piston crown plane UP to the lowest
  // point of the valve disc: the disc must stay above the crown. The old form
  // (crown - edge > 0.25) asserted the opposite - it demanded the disc sit
  // inside the piston.
  let worst = Infinity, worstAt = null;
  let ramp = 0, rampAt = null;
  for (const cyl of SPEC.cylinders) {
    for (let theta = 0; theta < 720; theta += 1) {
      vt.update(theta);
      const crown = pistonAlong(cyl, theta) + SPEC.piston.compressionHeight;
      for (const valve of valves) {
        const lift = valveLift(cyl, valve, theta);
        // lowest point of the valve head disc: seat plane, down the axis by lift,
        // plus the disc thickness and the tilt-droop of the outboard disc edge
        const edge = B.deckA - (lift + H.headThickness) * Math.cos(H.valveAngle * DEG) -
          (H.headDia[valve] / 2) * Math.sin(H.valveAngle * DEG);
        if (edge - crown < worst) {
          worst = edge - crown;
          worstAt = [cyl.num, valve, theta, crown.toFixed(3), lift.toFixed(3)];
        }
        // A flat-crown piston with 44 crank deg of overlap never has the valves
        // shut at TDC: exhaust is still blowing down, intake already cracked
        // open. What has to hold is that both are on their ramps - a small
        // fraction of maxLift - and never deep into the stroke.
        if (crown > tdcCrown - 1.0 && lift > ramp) { ramp = lift; rampAt = [cyl.num, valve, theta]; }
      }
    }
  }
  // 0.20 cm, not the 0.15 cm this test asked for before #8 item 3 was fixed:
  // with the single-ray lift law the disc edge reached -0.0156 cm inside the
  // crown plane at cyl 1 intake 370, and the flat-follower contact law plus the
  // re-tuned events now hold 0.2093 cm (worst: cyl 1 intake at theta 366, crown
  // 22.372, lift 0.1488; the exhaust side 0.2128 at theta 353). Floor published
  // in src/engine/spec.js, numbers generated by scripts/valve-train-audit.mjs.
  // Printed so a GATES row can read the measured half out of the run record
  // instead of hand-copying it (AGENTS.md Honesty: generated, not hand-copied).
  console.log(`clearance audit: worst valve/piston ${worst.toFixed(6)} cm at ${JSON.stringify(worstAt)} (floor 0.2), ` +
    `near-TDC lift ${ramp.toFixed(4)} cm at ${JSON.stringify(rampAt)} (ceiling ${(V.maxLift * 0.75).toFixed(4)})`);
  assert.ok(worst > 0.2, `worst valve/piston clearance ${worst} at ${JSON.stringify(worstAt)}`);
  assert.ok(ramp < V.maxLift * 0.75,
    `near-TDC lift ${ramp} at ${JSON.stringify(rampAt)} is off the ramp (ceiling ${V.maxLift * 0.75})`);
});

// ---------------------------------------------------------------------------
// Issue #11 / row P1-G13: the head must leave a machined spark-plug channel on
// every cylinder axis. Written RED first against the casting issue #11 measured -
// two hardened seat inserts of one cylinder 0.0324 cm apart on the axis, two
// machined spring floors 0.0376 cm apart, 0.0340 cm of air on the axis at the
// chamber roof - and a candidate M14 silhouette that never cleared 0.05 cm.
// Oracle: the exact-distance triangle machinery the stand rows already use, so
// the gap this law asserts is the gap the assembled tree really has. Two shells:
// the whole engine (the plug must clear the moving valve heads beside its bore)
// and the castings alone (the bore has to leave real aluminium around itself).
const P = SPEC.plug;
const FACE_A = B.deckA + H.gasketT; // 24.25 head deck face: the mouth of the bore

let fullShell = null;
let castShell = null;
// The units are named, not defaulted, for two reasons. (1) A part measured against
// itself always reads zero: this law probes a point ON each cylinder's plug axis,
// and the plug now drawn there would become the nearest surface to its own probe.
// (2) The two shells are the ones row P1-G13 publishes, so the shell this gate
// measures stays the shell that record describes. The triangle counts are printed
// by the law itself rather than repeated here.
const MEASURED_UNITS = ['block', 'cranktrain', 'valvetrain', 'heads', 'manifolds'];
function plugShells() {
  if (!fullShell) {
    fullShell = engineTriangles(proxyMaterials(), { units: MEASURED_UNITS });
    castShell = engineTriangles(proxyMaterials(), { units: ['block', 'heads'] });
  }
  return { fullShell, castShell };
}

test('a plug channel is machined on every cylinder axis: the plug keeps its clearance end to end', async () => {
  const shells = plugShells();
  // vacuity guard: the casting-only shell must really carry the castings
  assert.ok(shells.castShell.tris.length > 20000,
    `the casting-only shell holds ${shells.castShell.tris.length} triangles - the law would measure nothing`);
  assert.ok(shells.fullShell.tris.length > shells.castShell.tris.length,
    'the whole-engine shell is not bigger than the casting-only shell');
  const st = plugStack();
  const samples = stackSamples(st, B.deckA + 1.6);
  // Margins, not raw distances: what the law gates is the air left OVER the
  // silhouette radius, so the tracker compares margins to margins.
  const worst = { air: { m: Infinity }, cast: { m: Infinity } };
  for (const cyl of SPEC.cylinders) { // one channel per cylinder, count read live
    const sx = B.stations[cyl.station];
    for (const along of samples) {
      const w = bankPoint(cyl.bank, along, 0, sx); // out 0: the cylinder bore axis
      const p = [w.x, w.y, w.z];
      const need = stackRadius(st.segs, along);
      const air = triDistance(shells.fullShell, p);
      if (air.d - need < worst.air.m) {
        worst.air = { m: air.d - need, d: air.d, need, at: [cyl.num, along, air.who] };
      }
      if (along >= FACE_A) {
        const c = triDistance(shells.castShell, p);
        if (c.d - need < worst.cast.m) {
          worst.cast = { m: c.d - need, d: c.d, need, at: [cyl.num, along, c.who] };
        }
      }
    }
  }
  console.log(`plug channel audit: ${SPEC.cylinders.length} cylinder axes x ${samples.length} heights; boss face along ${PLUG_BOSS_A}, silhouette ${st.bottom.toFixed(2)}..${st.top.toFixed(2)}; tightest air around the silhouette ${worst.air.m.toFixed(4)} cm against ${P.clr} (surface ${worst.air.d.toFixed(4)} from cyl ${worst.air.at[0]} along ${worst.air.at[1]} (${worst.air.at[2]}, silhouette radius ${worst.air.need.toFixed(2)})); tightest aluminium wall ${worst.cast.m.toFixed(4)} cm against ${P.wallCasting} (surface ${worst.cast.d.toFixed(4)} from cyl ${worst.cast.at[0]} along ${worst.cast.at[1]} (${worst.cast.at[2]}, ${worst.cast.need.toFixed(2)})); shells ${shells.castShell.tris.length} casting / ${shells.fullShell.tris.length} engine triangles`);
  assert.ok(worst.air.m >= P.clr,
    `the plug silhouette stands ${worst.air.d.toFixed(4)} cm from ${worst.air.at[2]} at cyl ${worst.air.at[0]} along ${worst.air.at[1]} and needs ${worst.air.need.toFixed(2)} of it, leaving ${worst.air.m.toFixed(4)} cm: the channel must keep ${P.clr} cm of air, and issue #11 measured this casting crowding the axis to 0.03 cm`);
  assert.ok(worst.cast.m >= P.wallCasting,
    `only ${worst.cast.m.toFixed(4)} cm between the plug bore and ${worst.cast.at[2]} at cyl ${worst.cast.at[0]} along ${worst.cast.at[1]} (surface ${worst.cast.d.toFixed(4)}, silhouette radius ${worst.cast.need.toFixed(2)}): the head must keep ${P.wallCasting} cm of aluminium around the bore it is machined into`);
});

test('the plug stands clear of its own piston at TDC and its bore opens at the machined deck face', async () => {
  const st = plugStack();
  const tdcCrown = C.radius + SPEC.rod.length + SPEC.piston.compressionHeight; // 22.4 flat crown at TDC
  const mouth = B.deckA + H.gasketT;
  const thread = st.segs.find((s) => s.name === 'thread');
  const hex = st.segs.find((s) => s.name === 'hex');
  const live = st.segs.filter((s) => s.name === 'nose' || s.name === 'electrode');
  const crossed = st.segs.filter((s) => s.a0 < mouth && s.a1 > mouth);
  console.log(`plug reach audit: silhouette bottom ${st.bottom.toFixed(4)} cm, TDC crown plane ${tdcCrown.toFixed(4)} cm, air ${st.bottom - tdcCrown} cm against ${P.crownAir}; bore mouth at the head deck face ${mouth.toFixed(2)}, bore length to the boss face ${(PLUG_BOSS_A - mouth).toFixed(2)} cm; threaded part ${thread.a0.toFixed(2)}..${thread.a1.toFixed(2)}, segments crossing the mouth ${crossed.map((s) => s.name).join('+') || 'none'}, live end ${live.map((s) => s.name).join('+')} standing below it`);
  assert.ok(hex.a0 === PLUG_BOSS_A,
    `the hex must seat on the machined plug-boss face at ${PLUG_BOSS_A}, it starts at ${hex.a0}`);
  assert.ok(thread.a1 === PLUG_BOSS_A && thread.a0 > mouth,
    `the threaded part runs ${thread.a0.toFixed(2)}..${thread.a1.toFixed(2)} against the head material between the boss face ${PLUG_BOSS_A} and the machined mouth ${mouth}: it must be screwed into the casting and must not stand down inside the combustion chamber`);
  assert.ok(crossed.length > 0 && st.bottom < mouth,
    `the plug must pass through the mouth at ${mouth} with its live end below it (${st.bottom.toFixed(2)}): segments crossing ${crossed.map((s) => s.name).join('+') || 'none'}`);
  assert.ok(crossed.every((s) => live.includes(s) || s.name === 'shell'),
    `only the insulator nose, the electrode and the metal shell may stand inside the combustion chamber, not ${crossed.filter((s) => !live.includes(s) && s.name !== 'shell').map((s) => s.name).join('+')}`);
});




// ============ A1-G7: manufacturable cam bearings (issue #8 addendum item 4) ============
// Written RED against the casting that exists today, and measuring it instead of naming it:
//   - every one of the 28 columns is one closed 360-degree lathe ring (kind `boss`) with a
//     2.1000 cm bore, while the tallest thing a cam carries is a 3.1000 cm nose: a tunnel
//     that closes the circle around the cam line at under the nose cannot be assembled;
//   - nothing in the head is a bearing shell: that 2.1000 cm bore rides the cam's own
//     2.0500 cm collar, and the 0.05 between them is typed as SPEC.head.bossClr;
//   - the part named `cap` machines no bore at all - its nearest material stands 3.3322 cm
//     off the cam line - and it is fused into the casting instead of being the bolt-on half
//     of a split, line-bored tunnel;
//   - no shell anywhere carries an oil hole, because no shell exists.
// Tolerances. Machined faces here are drawn as THREE absarcs: the chord sag of a
// 32-segment absarc at a 2.05 cm bore is 0.0024 cm, so 0.006 cm - 2.5x that - is the floor
// under which two faces may honestly be called line-bored to one radius.
const NOSE_R = H.camBaseRadius + V.maxLift; // 3.1000: crown radius of the cam outline
const ARC_TOL = 0.006;
const CAST_HEAD = 'castAluminumHead'; // only the head casting machines a bore
const colWin = (bx) => [bx - CAM.bearingHalf - 0.3, bx + CAM.bearingHalf + 0.3];
// A bearing column, its tab pair, its shells and its own housing reach this far out from
// the cam axis line. The OTHER cam line of the same bank stands 2 * |out| = 12.07 cm away,
// so this window keeps a column model to one tunnel: without it the exhaust column at the
// same crank-axis station would read as part of the intake column.
const COL_RAD = bearingStack().housingOutRel + 0.5;
const camLine = (bank, valve) => ({ along: camAlongA(bank), out: camOutA(bank, valve) });

const headMeshes = (group, bank) => {
  const list = [];
  group.getObjectByName(`head-${bank}`).traverse((o) => { if (o.isMesh) list.push(o); });
  return list;
};

/** Bank-frame radial direction at azimuth psi: psi 0 = crown-ward, 90 = out, 180 = deck. */
function azDir(bank, psiDeg) {
  return new THREE.Vector3().fromArray(bankUp(bank)).multiplyScalar(Math.cos(psiDeg * DEG))
    .addScaledVector(new THREE.Vector3().fromArray(bankOut(bank)), Math.sin(psiDeg * DEG))
    .normalize();
}

/**
 * A vertex list inside one bearing column, in cam-line-relative bank frame: x is the
 * crank-axis station, along/out are measured from the cam axis line, r is the distance
 * from that line and psi = atan2(out, along) is the azimuth the A1-G7 laws split the
 * tunnel on (psi 0 crown-ward, 180 deck-ward, split plane at psi +/-90).
 */
function columnFrameOf(v, bank, camA, oCam, points, x0, x1) {
  const rel = [];
  for (const p of points) {
    if (p.x < x0 - 1e-6 || p.x > x1 + 1e-6) continue;
    const along = alongOf(v, bank, p) - camA;
    const out = outOf(v, bank, p) - oCam;
    const r = Math.hypot(along, out);
    if (r > COL_RAD) continue; // stands at another tunnel's line, not in this column
    rel.push({ x: p.x, along, out, r, psi: Math.atan2(out, along) / DEG });
  }
  return rel;
}

/** One part's vertices inside one bearing column, in cam-line-relative bank frame. */
function columnFrame(mesh, v, bank, line, win) {
  return columnFrameOf(v, bank, line.along, line.out, verts(mesh), win[0], win[1]);
}

const thinSample = (arr, n) => {
  const step = Math.max(1, Math.floor(arr.length / n));
  const out = [];
  for (let i = 0; i < arr.length; i += step) out.push(arr[i]);
  return out;
};

/**
 * One bearing column, measured. `removable` here is a geometric verdict and not a flag: a
 * part can come off the tunnel only if every one of its vertices stands on the crown side
 * of the split plane through the cam axis (the plane holding the crank axis and the bank's
 * out vector) AND a ray out of its footprint along that plane's normal stays clear of the
 * rest of the casting. That is the only motion a cap can take, it is the same motion the
 * cam needs to be laid into the tunnel, so what the cam sees is exactly the parts that are
 * NOT removable. userData.boltOn has to agree with the verdict: a part marked bolt-on whose
 * vertices span the split plane is a claim the casting does not support.
 */
function columnModel(group, bank, v, line, bx, headTris) {
  const win = colWin(bx);
  const mid = bankPoint(bank, line.along, line.out, bx);
  const region = regionTris(headTris,
    [win[0], mid.y - NOSE_R - 1.5, mid.z - NOSE_R - 1.5],
    [win[1], mid.y + NOSE_R + 1.5, mid.z + NOSE_R + 1.5]);
  const up = new THREE.Vector3().fromArray(bankUp(bank));
  const parts = [];
  for (const o of headMeshes(group, bank)) {
    const rel = columnFrame(o, v, bank, line, win);
    if (!rel.length) continue;
    const rMin = Math.min(...rel.map((q) => q.r));
    const crown = rel.filter((q) => q.along > ARC_TOL).length;
    const deck = rel.filter((q) => q.along < -ARC_TOL).length;
    const p = {
      mesh: o, name: o.name, kind: o.userData.kind, cast: o.material?.name === CAST_HEAD,
      flag: o.userData.boltOn === true, rel, rMin,
      rMax: Math.max(...rel.map((q) => q.r)),
      wall: Math.max(...rel.map((q) => q.r)) - rMin,
      arc: coverage(rel.filter((q) => Math.abs(q.r - rMin) <= ARC_TOL).map((q) => q.psi)).arc,
      crown, deck,
      crownOnly: crown > 0 && deck === 0, deckOnly: deck > 0 && crown === 0,
      blocked: [], removable: false, // a part that spans the split plane is cast integral
    };
    parts.push(p);
  }
  // A part that stands wholly on the crown side of the split plane is part of the
  // bolt-on assembly: it lifts with the cap, so it can never be the material holding a
  // crown-side part down. Only material that spans the split plane - material fused into
  // the casting - blocks a lift, and that is what a cap has to be measured against.
  const boltOnAssembly = new Set(parts.filter((p) => p.crownOnly).map((p) => p.name));
  for (const p of parts) {
    if (!p.crownOnly) continue;
    const others = region.filter((t) => t.label !== p.name && !boltOnAssembly.has(t.label));
    for (const q of thinSample(p.rel, 16)) {
      const from = bankPoint(bank, line.along + q.along, line.out + q.out, q.x);
      const hits = raycast(others, new THREE.Vector3(from.x, from.y, from.z), up, 0.05, 9.0);
      if (hits.length) p.blocked.push(`${hits[0].label} at ${hits[0].t.toFixed(4)} cm above a vertex at psi ${q.psi.toFixed(1)}`);
    }
    p.removable = p.crownOnly && p.blocked.length === 0;
  }
  const reach = parts.filter((p) => p.cast && p.rMin <= NOSE_R);
  const boreR = reach.length ? Math.min(...reach.map((p) => p.rMin)) : Infinity;
  // A part holds the bore only if it carries a real arc of it: the flat inner face of a
  // bolt tab happens to stand at the bore radius too, and a tab is not a bearing surface.
  const owners = reach.filter((p) => Math.abs(p.rMin - boreR) <= ARC_TOL && p.arc >= 90);
  const shells = parts.filter((p) => !p.cast && Math.abs(p.rMax - boreR) <= ARC_TOL && p.wall > ARC_TOL);
  // Only the casting can close the circle: a bearing shell is a replaceable part, and the
  // cam is laid in after the shells are pressed in, so the closure a cam has to pass is
  // the closure the head casting itself cannot take off.
  const permanent = new Set(parts.filter((p) => p.cast && !p.removable).map((p) => p.name));
  return {
    parts, reach, boreR, owners, shells,
    permanentTris: region.filter((t) => permanent.has(t.label)),
    allTris: region,
  };
}

const who = (list) => list.map((p) => `${p.kind}${p.removable ? '/bolt-on' : ''} ${p.rMin.toFixed(4)}`).join(', ');

test('A1-G7: no cam column closes the circle around the cam line under the nose the cam carries', async () => {
  const { group } = await buildHeads();
  let worst = { arc: -1 };
  const rows = [];
  for (const bank of ['L', 'R']) {
    const v = bankVectors(bank);
    const headTris = trisOf(headMeshes(group, bank));
    for (const valve of valves) {
      const line = camLine(bank, valve);
      for (const bx of CAM.bearings) {
        const m = columnModel(group, bank, v, line, bx, headTris);
        const closed = [];
        let tightest = Infinity, who2 = null;
        for (let psi = 0; psi < 360; psi += 3) {
          const dir = azDir(bank, psi);
          let first = Infinity, label = null;
          for (const sx of [bx - CAM.bearingHalf, bx, bx + CAM.bearingHalf]) {
            const o = bankPoint(bank, line.along, line.out, sx);
            const hits = raycast(m.permanentTris, new THREE.Vector3(o.x, o.y, o.z), dir, 0.05, NOSE_R + 0.5);
            if (hits.length && hits[0].t < first) { first = hits[0].t; label = hits[0].label; }
          }
          if (first < NOSE_R) {
            closed.push(psi);
            if (first < tightest) { tightest = first; who2 = label; }
          }
        }
        const cov = coverage(closed);
        rows.push(`${bank} ${valve} x${bx}: ${cov.arc} of 360 deg closed under ${NOSE_R.toFixed(4)} cm, nearest standing face ${Number.isFinite(tightest) ? tightest.toFixed(4) : 'none'} (${who2 ?? 'nothing'})`);
        if (cov.arc > worst.arc) worst = { arc: cov.arc, at: `${bank}-${valve}-x${bx}`, tightest, who2 };
      }
    }
  }
  console.log(`A1-G7 assembly sweep, 3 of ${rows.length}:\n  ${rows.slice(0, 3).join('\n  ')}`);
  console.log(`A1-G7 worst column ${worst.at}: ${worst.arc} deg closed, nearest face ${worst.tightest.toFixed(4)} cm (${worst.who2}), cam nose ${NOSE_R.toFixed(4)} cm`);
  assert.ok(worst.arc <= 200,
    `${worst.at}: ${worst.arc} of 360 degrees of the cam line are closed by casting that cannot come off, standing at ${worst.tightest.toFixed(4)} cm (${worst.who2}), while a cam carries a ${NOSE_R.toFixed(4)} cm nose. A tunnel that closes the whole circle around the cam line under the nose cannot be assembled: a DOHC cam is laid in with the crown half open. The loaded half may stand at the line bore, the other half has to be a cap.`);
});

test('A1-G7: every cam line bore is split on one plane through the axis and line-bored to one published radius', async () => {
  const { group } = await buildHeads();
  const rows = [];
  for (const bank of ['L', 'R']) {
    const v = bankVectors(bank);
    const headTris = trisOf(headMeshes(group, bank));
    for (const valve of valves) {
      const line = camLine(bank, valve);
      for (const bx of CAM.bearings) {
        const m = columnModel(group, bank, v, line, bx, headTris);
        if (!m.owners.length) continue;
        rows.push(`${bank} ${valve} x${bx}: bore ${m.boreR.toFixed(4)} held by [${who(m.owners)}] | other cast parts in the column [${who(m.reach.filter((p) => !m.owners.includes(p)))}]`);
        assert.equal(m.owners.length, 2,
          `${bank} ${valve} bearing x${bx}: ${m.owners.length} cast part(s) machine the cam line bore [${who(m.reach)}]. A split, line-bored tunnel is machined by two halves against one cutter in one setting: a cradle in the head and a cap. One part holding the whole bore is a bushing cast into the head, not a bearing.`);
        assert.ok(Math.abs(m.boreR - CAM.bearingR) <= ARC_TOL,
          `${bank} ${valve} x${bx}: the head machines its cam bore at ${m.boreR.toFixed(4)} cm while the published bearing stands at ${CAM.bearingR} cm. The ${(m.boreR - CAM.bearingR).toFixed(4)} cm difference is the running clearance itself - a line-bore stands at the bearing's own radius, and the clearance is carried by a shell.`);
        const [a, b] = m.owners;
        assert.ok(Math.abs(a.rMin - b.rMin) <= ARC_TOL,
          `${bank} ${valve} x${bx}: the two halves of one line bore stand at ${a.rMin.toFixed(4)} (${a.name}) and ${b.rMin.toFixed(4)} (${b.name}), ${(a.rMin - b.rMin).toFixed(4)} cm apart. Line-boring machines both halves to one radius with the same cutter.`);
        assert.ok((a.crownOnly && b.deckOnly) || (b.crownOnly && a.deckOnly),
          `${bank} ${valve} x${bx}: ${a.name} holds ${a.crown} crown-side and ${a.deck} deck-side vertices, ${b.name} holds ${b.crown} and ${b.deck}. The two halves of a split bore must lie on opposite sides of one plane through the cam axis; a part holding both sides is not a split and nothing comes off.`);
        for (const o of m.owners) {
          assert.ok(o.arc >= 150 && o.arc <= 200,
            `${bank} ${valve} x${bx}: ${o.name} machines ${o.arc} deg of the bore face. One half of a split bore carries its own 180 degrees, within the 0.006 cm arc tolerance.`);
        }
      }
    }
  }
  console.log(`A1-G7 line-bore owners, 3 of ${rows.length}:\n  ${rows.slice(0, 3).join('\n  ')}`);
});

test('A1-G7: the half of every column that carries bore is a cap that lifts off along its split plane', async () => {
  const { group } = await buildHeads();
  for (const bank of ['L', 'R']) {
    const v = bankVectors(bank);
    const headTris = trisOf(headMeshes(group, bank));
    for (const valve of valves) {
      const line = camLine(bank, valve);
      for (const bx of CAM.bearings) {
        const m = columnModel(group, bank, v, line, bx, headTris);
        if (!m.reach.length) continue;
        const caps = m.owners.filter((p) => p.removable);
        // crownSide is every crown-side casting in the column, including the ones that
        // never reach the bore: that is what a cap has to be measured against.
        const crownSide = m.parts.filter((p) => p.crownOnly);
        const nearest = crownSide.slice().sort((a, b) => a.rMin - b.rMin)[0];
        assert.equal(caps.length, 1,
          `${bank} ${valve} x${bx}: ${caps.length} of the parts that machine the ${m.boreR.toFixed(4)} cm bore can be lifted off it. The half that has to come off has to carry half that bore; the nearest crown-side casting in this column is ${nearest ? `${nearest.name} at ${nearest.rMin.toFixed(4)} cm, ${(nearest.rMin - m.boreR).toFixed(4)} cm past the bore surface, so it carries no bearing surface at all` : 'nothing at all'}.`);
        for (const p of m.owners) {
          assert.equal(p.flag, p.removable,
            `${bank} ${valve} x${bx}: ${p.name} is marked boltOn=${p.flag} while its ${p.crown} crown-side and ${p.deck} deck-side vertices${p.crownOnly ? ' stand wholly on the crown side with a clear lift path' : ' span the split plane, so it is part of the casting'}. The bolt-on claim has to match the geometry.`);
        }
        for (const c of caps) {
          assert.equal(c.blocked.length, 0,
            `${bank} ${valve} x${bx}: ${c.blocked.length} lift rays out of ${c.name} are blocked by cast-integral material (first: ${c.blocked[0] ?? 'none'}). A cap has to lift straight along the normal of its split plane.`);
        }
      }
    }
  }
});

test('A1-G7: every column carries two bearing shells line-bored into its tunnel, each riding its own clearance', async () => {
  const { group } = await buildHeads();
  const rows = [];
  for (const bank of ['L', 'R']) {
    const v = bankVectors(bank);
    const headTris = trisOf(headMeshes(group, bank));
    for (const valve of valves) {
      const line = camLine(bank, valve);
      for (const bx of CAM.bearings) {
        const m = columnModel(group, bank, v, line, bx, headTris);
        if (!m.reach.length) continue;
        rows.push(`${bank} ${valve} x${bx}: ${m.shells.length} shell(s) [${who(m.shells)}] in a ${m.boreR.toFixed(4)} cm bore over a ${H.camJournalRadius} cm cam journal`);
        assert.equal(m.shells.length, 2,
          `${bank} ${valve} x${bx}: ${m.shells.length} part(s) in this column carry an outer face machined to the ${m.boreR.toFixed(4)} cm line bore with material inside it. A cam bearing is a replaceable shell: without one the bore wears into the head casting and the head is scrap. Today the ${m.boreR.toFixed(4)} cm bore rides the cam's own ${CAM.bearingR} cm collar and the ${(m.boreR - CAM.bearingR).toFixed(4)} cm left between them is typed into the spec.`);
        const [a, b] = m.shells;
        assert.ok((a.crownOnly && b.deckOnly) || (b.crownOnly && a.deckOnly),
          `${bank} ${valve} x${bx}: shells ${a.name} (${a.crown} crown / ${a.deck} deck vertices) and ${b.name} (${b.crown} crown / ${b.deck} deck) are not one crown half and one cradle half, so the tunnel cannot be opened and relined the way a split bore is.`);
        for (const s of m.shells) {
          const br = SPEC.cam.bearing;
          assert.ok(br, `${bank} ${valve} x${bx}: SPEC.cam.bearing is not published, so the shell wall and the running clearance it carries have no source.`);
          assert.ok(Math.abs(s.wall - br.shellWall) <= ARC_TOL,
            `${bank} ${valve} x${bx}: shell ${s.name} is ${s.wall.toFixed(4)} cm thick while SPEC.cam.bearing.shellWall publishes ${br.shellWall} cm.`);
          assert.ok(Math.abs(s.rMin - (H.camJournalRadius + br.oilFilm)) <= ARC_TOL,
            `${bank} ${valve} x${bx}: shell ${s.name} stands at ${s.rMin.toFixed(4)} cm while the ${H.camJournalRadius} cm cam journal plus the published ${br.oilFilm} cm oil film is ${(H.camJournalRadius + br.oilFilm).toFixed(4)} cm.`);
        }
      }
    }
  }
  console.log(`A1-G7 bearing shells, 3 of ${rows.length}:\n  ${rows.slice(0, 3).join('\n  ')}`);
});

test('A1-G7: every bearing shell is drilled through at its published oil azimuth with the published hole', async () => {
  const { group } = await buildHeads();
  const br = SPEC.cam.bearing;
  assert.ok(br, 'SPEC.cam.bearing is not published: the oil-hole radius, the oil film and the azimuth each half carries its hole at have no single source, so no oil way in the tunnel can be gated at all.');
  // A radial ray stays inside a straight drill of radius r - drilled along its own
  // radial axis - while offset * r stays under r_hole, and the last shell material the
  // ray meets sits at the line bore: so the widest offset that still reads as open
  // void implies the drilled radius, measured on the shell's own surface. The old form
  // of this law asked only for "a void with wall beside it" and passed a shell whose
  // oil band had no drilling at all, because the half of the shell that simply is not
  // there (the cradle side of a cap shell) reads as a void with wall 95 deg away
  // (tmp/oilprobe.mjs: void 91..269 deg).
  // The drilling is a straight cylinder along the radial direction, so a radial ray
  // stays inside it while its distance off the drill axis - r * sin(offset) - stays
  // under the hole radius, and the last shell material the ray can meet sits at the
  // line bore: bisecting the open/closed edge of the void around the published azimuth
  // therefore implies the drilled radius, measured on the shell's own surface. The old
  // form of this law asked only for "a void with wall beside it" and passed a shell
  // whose oil band carries no drilling at all, because the half of the shell that
  // simply is not there - the deck side of a cap shell - reads as a void with solid
  // wall 95 deg away (tmp/oilprobe.mjs: void 91..269 deg).
  const REACH_DEG = 12; // half the published oil band: past this a void is not a hole
  let withHole = 0;
  const detail = [];
  const offenders = [];
  for (const bank of ['L', 'R']) {
    const v = bankVectors(bank);
    const headTris = trisOf(headMeshes(group, bank));
    for (const valve of valves) {
      const line = camLine(bank, valve);
      for (const bx of CAM.bearings) {
        const m = columnModel(group, bank, v, line, bx, headTris);
        for (const s of m.shells) {
          const own = m.allTris.filter((t) => t.label === s.name);
          const azList = s.mesh.userData.oilAz;
          assert.ok(Array.isArray(azList) && azList.length >= 1,
            `${s.name}: the drawn shell names no oil azimuth of its own, so nothing says where its oil way has to be machined`);
          const az = azList[0];
          const at = bankPoint(bank, line.along, line.out, bx);
          const o = new THREE.Vector3(at.x, at.y, at.z);
          const hitsAt = (psi) => raycast(own, o, azDir(bank, psi), s.rMin - 0.02, s.rMax + 0.02).length;
          const open = (psi) => hitsAt(psi) === 0;
          const hits = hitsAt(az);
          assert.ok(hits === 0,
            `${s.name}: a ray along the published oil azimuth ${az} deg crosses the shell's own wall ${hits} times - the shell is not drilled through where its oil way is published`);
          assert.ok(!open(az + REACH_DEG) && !open(az - REACH_DEG),
            `${s.name}: the shell is still open ${REACH_DEG} deg either side of its oil azimuth - that is a region of the shell that is missing, not a drilled hole`);
          // bisect outward from the published azimuth: the last ray that still reads
          // as open void is the tangent of the drilled cylinder
          const edge = (sign) => {
            let near = az;
            for (let step = REACH_DEG / 2; step > 1e-4; step /= 2) {
              if (open(near + sign * step)) near += sign * step;
            }
            return Math.abs(near - az);
          };
          const halfL = edge(-1), halfR = edge(1);
          assert.ok(Math.abs(halfL - halfR) < 0.01,
            `${s.name}: the drilling runs -${halfL.toFixed(4)}..+${halfR.toFixed(4)} deg around its azimuth - a machined hole is centred on the axis it was drilled along`);
          const holeR = Math.sin(halfL * DEG) * s.rMax;
          detail.push(`${bank} ${valve} x${bx} ${s.name}: open -${halfL.toFixed(4)}..+${halfR.toFixed(4)} deg at ${az} deg, implied hole ${holeR.toFixed(4)} cm against the published ${br.oilHoleR} cm`);
          // The builder has no CSG: a drilled round is a curveFacet polygon, and a
          // 14-gon of a 0.1 cm hole presents 0.0975 cm to a ray at its flat side. The
          // gate is the published radius inside that discretisation - wide enough for
          // the polygon, narrow enough that a missing or half-size drilling fails.
          if (Math.abs(holeR - br.oilHoleR) > 0.01) offenders.push(`${s.name} measures ${holeR.toFixed(4)} cm of drilling against the published ${br.oilHoleR} cm`);
          withHole += 1;
        }
      }
    }
  }
  const needed = CAM.bearings.length * 4 * 2; // 7 journals x 4 DOHC camshafts x 2 halves per split bore
  console.log(`A1-G7 shell oil ways, 3 of ${detail.length}:\n  ${detail.slice(0, 3).join('\n  ')}`);
  console.log(`A1-G7 shells carrying a proved oil way: ${withHole} of ${needed}`);
  assert.equal(withHole, needed,
    `${withHole} of ${needed} bearing shells are proved open along the radial direction at the oil azimuth they themselves name, with solid wall on both sides. A shell without an oil hole has no oil in its running clearance: it runs metal-to-metal, which is the failure the review named for the whole bearing stack.`);
  assert.deepEqual(offenders, [],
    `${offenders.length} shell oil way(s) are not the published drilling: ${offenders.join('; ')}. SPEC.cam.bearing.oilHoleR publishes ${br.oilHoleR} cm - an oil way of any other width is not the hole the published stack calls for.`);
});

test('A1-G7: every cap and cradle stands on a drilled tab pair with a cap bolt through both', async () => {
  const { group } = await buildHeads();
  const br = SPEC.cam.bearing;
  assert.ok(br, 'SPEC.cam.bearing is not published: the tab stand-off, the tab height and the bolt-hole radius that say where a cap bolt may stand have no source, so the cap has nothing to stand on.');
  const capBoltSets = ['L', 'R'].map((b) => group.getObjectByName(`cam-cap-bolts-${b}`));
  let drilled = 0;
  const holes = [];
  for (const bank of ['L', 'R']) {
    const v = bankVectors(bank);
    const headTris = trisOf(headMeshes(group, bank));
    const up = new THREE.Vector3().fromArray(bankUp(bank));
    for (const valve of valves) {
      const line = camLine(bank, valve);
      for (const bx of CAM.bearings) {
        const m = columnModel(group, bank, v, line, bx, headTris);
        const tabs = m.parts.filter((p) => p.kind === 'tab');
        // derived, not typed: one cap tab and one cradle tab per side of the cam axis
        // line, and the bolt is measured at both sides
        const needTabs = 2 * 2;
        assert.equal(tabs.length, needTabs,
          `${bank} ${valve} x${bx}: ${tabs.length} tab(s) stand in this column, a cap/cradle pair each side of the cam axis line is ${needTabs}. A split bore is held by a bolt through a tab on the cap into a tab on the cradle: without the pair the cap is glued, not bolted.`);
        assert.equal(new Set(tabs.map((t) => t.crownOnly)).size, 2,
          `${bank} ${valve} x${bx}: the ${tabs.length} tabs in this column are not one crown half and one deck half (${tabs.map((t) => `${t.name} ${t.crownOnly ? 'crown' : 'deck'}`).join(', ')}); a cap bolt has to clamp a tab on each side of the split plane.`);
        // The published bolt line: mid of the tab span from the line bore out to the
        // tab's outer radius, exactly the line the tab law in A1-G7 derives from SPEC.
        const tabR = m.boreR + br.castWall + br.tabStand;
        const boltR = (m.boreR + tabR) / 2;
        for (const side of [-1, 1]) {
          for (const t of tabs) {
            const own = m.allTris.filter((q) => q.label === t.name);
            // The tab's own measured extent along the split-plane normal: the probe is
            // derived from the part being measured, never from the published numbers -
            // otherwise a tab machined to the wrong height would still pass.
            const aLo = Math.min(...t.rel.map((q) => q.along));
            const aHi = Math.max(...t.rel.map((q) => q.along));
            const probe = (offset) => {
              // Segment through the whole tab: it starts clear below the tab's own lower
              // face and ends clear above its upper face, so a solid tab is crossed twice
              // (entry + exit) and a drilled tab is crossed not at all.
              const foot = bankPoint(bank, line.along + aLo - 0.6, line.out + side * (boltR + offset), bx);
              return raycast(own, new THREE.Vector3(foot.x, foot.y, foot.z), up, 0.05, (aHi - aLo) + 1.15).length;
            };
            // Derived probe span, printed once per column so a wrong tab height is
            // visible in the record instead of silently accepted.
            if (side === 1 && t.kind === 'tab') holes.push(`${t.name}: tab along ${aLo.toFixed(4)}..${aHi.toFixed(4)} (published ${br.tabH} high), crossings at the bolt line ${probe(0)}, outboard ${probe(br.boltHoleR + 0.15)}, inboard ${probe(-(br.boltHoleR + 0.15))}`);
            // A solid tab is crossed twice by this segment (entry + exit faces). A
            // machined bolt hole is a through-void along the probe axis: zero crossings.
            if (probe(0) === 0 && probe(br.boltHoleR + 0.15) >= 2 && probe(-(br.boltHoleR + 0.15)) >= 2) drilled++;
          }
        }
      }
    }
  }
  const neededTabsHoles = CAM.bearings.length * 4 * 2 * 2; // 28 columns x 2 tabs x 2 bolt sides
  console.log(`A1-G7 tab machining, 3 of ${holes.length}:\n  ${holes.slice(0, 3).join('\n  ')}`);
  console.log(`A1-G7 drilled tab holes proved: ${drilled} of ${neededTabsHoles}`);
  assert.equal(drilled, neededTabsHoles,
    `${drilled} of ${neededTabsHoles} cap tabs are drilled through for their bolt: a ray along the split-plane normal through the tab at the published bolt line crosses nothing. A tab that is not drilled is a boss the bolt has to be cast into.`);
  const neededBolts = CAM.bearings.length * 4 * 2;
  assert.ok(capBoltSets.every((s) => s && s.isInstancedMesh),
    `no per-bank cam-cap-bolts-L / cam-cap-bolts-R instanced mesh exists: ${neededBolts} cap bolts are the only thing holding ${CAM.bearings.length * 4} split caps onto their cradles. Today the caps are cast integral with the head and nothing holds them down.`);
  const held = capBoltSets.reduce((a, s) => a + s.count, 0);
  assert.equal(held, neededBolts, `the two bank bolt sets hold ${held} instances, the split bore needs ${neededBolts} (two per column: one each side of the cam line)`);
  for (const [bank, s] of ['L', 'R'].map((b, i) => [b, capBoltSets[i]])) {
    assert.equal(s.count, CAM.bearings.length * 2 * 2,
      `cam-cap-bolts-${bank} holds ${s.count} bolts; ${bank} bank has ${CAM.bearings.length} columns x 2 cam lines x 2 sides of the split bore = ${CAM.bearings.length * 2 * 2} caps to hold down`);
  }
});

test('A1-G7: the whole bearing stack is published in SPEC.cam.bearing and every radius in it derives', async () => {
  const br = SPEC.cam.bearing;
  assert.ok(br, 'SPEC.cam.bearing is missing: the oil film, the shell wall, the casting wall, the tab stand-off, the bolt geometry and the oil-hole radius of the cam tunnel are not published at all, so the head cannot be built from one source and the review\'s "no load-bearing full 360 degree boss" has nothing to be measured against.');
  const shellIdR = H.camJournalRadius + br.oilFilm;
  const boreR = shellIdR + br.shellWall;
  assert.ok(Math.abs(boreR - CAM.bearingR) <= 1e-9,
    `the published stack puts the line bore at ${boreR.toFixed(6)} cm while SPEC.cam.bearingR says ${CAM.bearingR} cm: the two halves of the tunnel are bored against the bearing radius, so one of them is wrong.`);
  assert.ok(H.bossClr === undefined,
    `SPEC.head.bossClr still publishes ${H.bossClr} cm of clearance typed between the cam and a cast bore. That clearance is now carried by ${br.shellWall} cm of shell over a ${br.oilFilm} cm oil film; keeping both keys means two sources for one running clearance.`);
  const castOdR = boreR + br.castWall;
  const tabR = castOdR + br.tabStand;
  assert.ok(tabR > NOSE_R,
    `the cap tab outer radius ${tabR.toFixed(4)} cm has to stand outside the ${NOSE_R.toFixed(4)} cm nose the cam carries, or the bolt hole cannot be drilled without cutting into the cam's swept circle.`);
  const boltOut = (boreR + tabR) / 2;
  const hexCircumR = br.boltAcrossR / Math.cos(Math.PI / 6);
  assert.ok(hexCircumR <= (tabR - boreR) / 2,
    `the cap bolt's hex needs ${hexCircumR.toFixed(4)} cm across the corners while the tab span from the ${boreR.toFixed(4)} cm bore to the ${tabR.toFixed(4)} cm tab edge only has ${((tabR - boreR) / 2).toFixed(4)} cm half-width around the bolt line at ${boltOut.toFixed(4)} cm: the bolt head would overhang the tab.`);
  assert.ok(br.oilHoleR < br.shellWall,
    `the oil hole is ${br.oilHoleR} cm in radius and the shell it is drilled through is ${br.shellWall} cm thick: a hole wider than the wall it stands in is not a drilling.`);
  // Where a column's housing wall stands is derived from the fastener it has to clear:
  // the cap bolt line, its hex across the corners, the published socket clearance.
  // The drawn risers are measured against this in the column contract above.
  const st = bearingStack();
  const housingIn = boltOut + hexCircumR + br.wrenchClr;
  assert.ok(br.wrenchClr > 0 && br.housingWall > 0,
    `SPEC.cam.bearing has to publish the socket clearance and the housing wall it derives the column's housing from, got ${br.wrenchClr} and ${br.housingWall}.`);
  assert.ok(Math.abs(st.housingInRel - housingIn) <= 1e-9,
    `the drawn stack puts the housing wall at ${st.housingInRel.toFixed(6)} cm off the cam axis line; the published numbers put it at ${housingIn.toFixed(6)} cm (bolt line ${boltOut.toFixed(4)} + hex ${hexCircumR.toFixed(4)} + socket ${br.wrenchClr}).`);
  assert.ok(Math.abs(st.housingOutRel - (housingIn + br.housingWall)) <= 1e-9,
    `the drawn stack puts the housing's outer face at ${st.housingOutRel.toFixed(6)} cm, the published wall of ${br.housingWall} cm from ${housingIn.toFixed(4)} gives ${(housingIn + br.housingWall).toFixed(6)} cm.`);
  assert.ok(housingIn > tabR,
    `the housing wall at ${housingIn.toFixed(4)} cm has to stand outside the ${tabR.toFixed(4)} cm tab ring, or the column casting is where the cap has to lift off its split plane.`);
});

// ============ A1-G6 slice 8E: the coolant goes on through the heads =============
// Issue #8 addendum item 1: "Heads get the matching jacket and passage work so
// cooling does not stop at the gasket." These laws gate the head half of the
// published coolant network against the drawn head iron through
// test/support/coolant-iron.mjs. The geometry was proven before it was written
// (tmp/8e-warrant3.mjs: WARRANT OK in both variants, 0 offender kinds).

const netHeads = async (variant, why) => {
  let mod;
  try {
    mod = await import('../src/engine/coolant.js');
  } catch (e) {
    throw new Error(`A1-G6 8E: src/engine/coolant.js is not in the tree (${why}): ${e.message}`);
  }
  if (!SPEC.coolant) throw new Error(`A1-G6 8E: SPEC.coolant is not published (${why})`);
  return mod.coolantNetwork(variant);
};

test('A1-G6 8E: the head half of every coolant passage is bored in drawn head iron', async () => {
  const { coolantProber } = await import('./support/coolant-iron.mjs');
  for (const variant of ['dohc', 'ohv']) {
    const net = await netHeads(variant, `the ${variant} heads have no published coolant passages to probe`);
    const p = coolantProber(net, variant);
    const legs = [];
    for (const pt of net.ports) legs.push({ ...pt.legs[1].leg, name: pt.id, cast: 'head', bank: pt.bank });
    for (const l of net.links) legs.push({ ...l.leg, name: l.id, cast: l.cast, bank: l.bank });
    for (const g of net.galleries) legs.push({ ...g.leg, name: g.id, cast: g.cast, bank: g.bank });
    let samples = 0;
    const bad = [];
    for (const leg of legs) {
      const r = p.legIron(leg);
      samples += r.samples;
      bad.push(...r.offenders);
    }
    assert.ok(bad.length === 0,
      `${variant}: ${bad.length} of ${samples} samples of the ${legs.length} published head coolant legs do not stand in drawn head iron:\n  ${bad.slice(0, 12).join('\n  ')}`);
  }
});

test('A1-G6 8E: cooling does not stop at the gasket, block and head legs share one window', async () => {
  const C = SPEC.coolant;
  const net = await netHeads('dohc', 'no published passage tells the laws where the block hands its water to the head');
  assert.ok(net.ports.length > 0, 'A1-G6 8E: the network publishes no block-to-head passages at all');
  let checked = 0;
  for (const pt of net.ports) {
    assert.equal(pt.legs.length, 2, `${pt.id}: a block-to-head passage needs a leg in each casting, it has ${pt.legs.length}`);
    const [blk, head] = pt.legs;
    assert.equal(blk.cast, 'block', `${pt.id}: its first leg is bored in ${blk.cast}`);
    assert.equal(head.cast, 'head', `${pt.id}: its second leg is bored in ${head.cast}`);
    for (const k of ['o0', 'o1', 'x0', 'x1']) {
      assert.ok(Math.abs(blk.leg[k] - head.leg[k]) <= 1e-9,
        `${pt.id}: the block leg's ${k} window ${blk.leg[k]} is not the head leg's ${head.leg[k]}: the passage narrows or steps at the gasket instead of continuing`);
    }
    assert.ok(Math.abs(blk.leg.a1 - (head.leg.a0 - H.gasketT)) <= 1e-9,
      `${pt.id}: the block leg tops out at a ${blk.leg.a1} and the head leg starts at a ${head.leg.a0}, which is not a ${H.gasketT} cm gasket apart - the two legs do not meet`);
    assert.ok(blk.leg.a1 >= B.deckA - 1e-9 && head.leg.a0 <= B.deckA + H.gasketT + 1e-9,
      `${pt.id}: the joint between its legs is not at the compressed gasket band (${B.deckA}..${B.deckA + H.gasketT})`);
    assert.ok(head.leg.a1 > C.headFloorA + C.bandMinCm,
      `${pt.id}: the head leg only reaches a ${head.leg.a1}, ${head.leg.a1 - C.headFloorA} cm above the head deck face: the water is in the head by less than the ${C.bandMinCm} cm way the row claims as its narrowest coolant passage`);
    checked++;
  }
  const perBank = {};
  for (const pt of net.ports) perBank[pt.bank] = (perBank[pt.bank] ?? 0) + 1;
  assert.ok(checked === net.ports.length && perBank.L === perBank.R,
    `A1-G6 8E: ${checked} of ${net.ports.length} passages checked, per bank ${JSON.stringify(perBank)}`);
  // the head carries the water on past the risers: links at both ends of each
  // bank and a cross gallery across each end
  assert.ok(net.links.length >= 2 * 2 * C.bands.length,
    `A1-G6 8E: ${net.links.length} head links where the row publishes one per bank, per band and per end (${2 * 2 * C.bands.length})`);
  assert.ok(net.galleries.length >= 2 * 2,
    `A1-G6 8E: ${net.galleries.length} head cross galleries where the row publishes one per bank and per end (4)`);
  for (const g of net.galleries) {
    assert.ok(g.leg.a1 >= C.headCrownA - 1e-9, `${g.id}: the cross gallery tops out at a ${g.leg.a1} instead of the published coolant roof a ${C.headCrownA}`);
    assert.ok(Math.abs(g.leg.o1) >= C.waterOutCm - 1e-9 && Math.abs(g.leg.o0) <= C.waterInCm + 1e-9,
      `${g.id}: the gallery spans o ${g.leg.o0}..${g.leg.o1} instead of reaching from the valley side to the outboard flank (|o| ${C.waterInCm}..${C.waterOutCm})`);
    for (const l of net.links.filter((x) => x.bank === g.bank && x.side === g.side)) {
      const overlap = Math.min(l.leg.x1, g.leg.x1) - Math.max(l.leg.x0, g.leg.x0);
      assert.ok(overlap > 0, `${l.id} and ${g.id}: the link and the gallery it feeds share ${overlap.toFixed(3)} cm of x, so the water has no way between them`);
    }
  }
});

test('A1-G6 8E: the drawn coolant members measure at their published windows', async () => {
  const { createCoolant } = await import('../src/render/coolant.js')
    .catch((e) => { throw new Error(`A1-G6 8E: src/render/coolant.js is not in the tree (nothing draws the published passages): ${e.message}`); });
  const { coolantProber, legFrameBox } = await import('./support/coolant-iron.mjs');
  const net = await netHeads('dohc', 'the drawn coolant assembly has no published windows to be measured at');
  const { group } = createCoolant(proxyMaterials(), 'dohc');
  const p = coolantProber(net, 'dohc');
  const TOL = 1e-3;
  const want = [];
  for (const j of net.jackets) want.push([j.id, j.bank, j.leg]);
  for (const pt of net.ports) for (const L of pt.legs) want.push([pt.id, pt.bank, L.leg]);
  for (const l of net.links) want.push([l.id, l.bank, l.leg]);
  for (const g of net.galleries) want.push([g.id, g.bank, g.leg]);
  const bad = [];
  for (const [id, bank, leg] of want) {
    const mesh = group.getObjectByName(id);
    if (!mesh) { bad.push(`${id}: the drawn assembly has no member with that name`); continue; }
    const box = legFrameBox(bank, mesh);
    for (const [k, lo, hi] of [['a', leg.a0, leg.a1], ['o', leg.o0, leg.o1], ['x', leg.x0, leg.x1]]) {
      const dLo = Math.abs(box[`${k}0`] - lo), dHi = Math.abs(box[`${k}1`] - hi);
      if (dLo > TOL || dHi > TOL) {
        bad.push(`${id}: the drawn member spans ${k} ${box[`${k}0`].toFixed(3)}..${box[`${k}1`].toFixed(3)} against the published ${lo.toFixed(3)}..${hi.toFixed(3)} (off by ${Math.max(dLo, dHi).toFixed(4)} cm)`);
      }
    }
  }
  assert.ok(bad.length === 0, `${bad.length} drawn coolant members do not stand at their published window:\n  ${bad.slice(0, 12).join('\n  ')}`);
  assert.ok(p.legs().every((L) => L.cast === 'block' || L.cast === 'head'), 'a published coolant leg names no casting it is bored in');
});

test('A1-G6 8E: the coolant assembly census is measured from the tree and its names are its own', async () => {
  const { createCoolant } = await import('../src/render/coolant.js')
    .catch((e) => { throw new Error(`A1-G6 8E: src/render/coolant.js is not in the tree (the census has nothing to count): ${e.message}`); });
  const net = await netHeads(SPEC.build.variant, 'the census has no published member list to compare with');
  const { group } = createCoolant(proxyMaterials(), SPEC.build.variant);
  const drawn = [];
  group.traverse((o) => { if (o.isMesh) drawn.push(o.name); });
  assert.equal(new Set(drawn).size, drawn.length, `the drawn assembly repeats a name: ${drawn.filter((n, i) => drawn.indexOf(n) !== i).join(', ')}`);
  assert.equal(drawn.length, net.members.length,
    `the drawn coolant assembly holds ${drawn.length} meshes while the published network lists ${net.members.length} members - the census has to be one measured number, not two typed ones`);
  const missing = net.members.filter((n) => !drawn.includes(n));
  const extra = drawn.filter((n) => !net.members.includes(n));
  assert.ok(missing.length === 0 && extra.length === 0, `published but not drawn: ${missing.join(', ') || '-'} / drawn but not published: ${extra.join(', ') || '-'}`);
  // no coolant name may shadow a casting member: the inspection menu and the
  // teardown table key members by name
  const { createBlock } = await import('../src/render/block.js');
  const { createHeads } = await import('../src/render/heads.js');
  const casting = new Set();
  for (const g of [createBlock(proxyMaterials(), SPEC.build.variant), createHeads(proxyMaterials()).group]) {
    g.traverse((o) => { if (o.isMesh) casting.add(o.name); });
  }
  const clash = drawn.filter((n) => casting.has(n));
  assert.ok(clash.length === 0, `coolant members shadow casting members: ${clash.join(', ')}`);
  for (const n of drawn) {
    assert.ok(/^[a-z0-9-]+$/.test(n), `${n}: a member name has to be one the inspection menu and the teardown table can key on`);
    assert.ok(/coolant-/.test(n), `${n}: a coolant member has to name itself as coolant work, the way oil members name themselves oil work`);
  }
});
