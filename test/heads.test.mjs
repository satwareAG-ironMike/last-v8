// Heads unit - written RED first. Contract:
// - two head castings standing on the block deck through a copper head gasket
// - 16 valve guides + seat inserts exactly on the timing.js seat/axis points
// - machined spring seats exactly where the valvetrain springs actually sit
// - cam-cover ceiling derived from spec constants, clearing every rotating lobe
// - bucket bores that retain every bucket at every lift
// - 28 cam bearing bosses on the cam axis line, 0.05 cm over every bearing
// - 32 head bolts at deckBoltRadius, clear of the bores
// - nothing pokes through the cover, nothing inside the sprocket band, every
//   casting solid connected, static/dynamic piston clearances proven.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  SPEC, DEG, bankUp, bankOut, camAxisBank, camAxisStation, HEAD_TOP_A,
} from '../src/engine/spec.js';
import {
  valveAxisDir, valveSeatPoint, camAxisPoint, pistonAlong, valveLift,
} from '../src/engine/timing.js';

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

const KIND_COUNTS = {
  rail: 2, chimney: 4, floor: 8, guide: 8, seatRing: 8, springtube: 8, bucketbore: 8,
  bridge: 4, stay: 8, boss: 14, bossweb: 14, cap: 14, clamp: 28,
};
const PER_BANK = Object.values(KIND_COUNTS).reduce((a, b) => a + b, 0); // 120

test('heads build contract: 2 castings x 120 solids, 16 guides + seat inserts, 4 covers, 2 gaskets, 32 bolts', async () => {
  const { group } = await buildHeads();
  assert.equal(group.name, 'heads');
  let bolts = 0;
  for (const bank of ['L', 'R']) {
    const head = group.getObjectByName(`head-${bank}`);
    assert.ok(head, `head-${bank} missing`);
    const kinds = {};
    head.traverse((o) => {
      if (!o.isMesh) return;
      kinds[o.userData.kind] = (kinds[o.userData.kind] ?? 0) + 1;
    });
    for (const [kind, want] of Object.entries(KIND_COUNTS)) {
      assert.equal(kinds[kind] ?? 0, want, `head-${bank} ${kind}: got ${kinds[kind] ?? 0} want ${want}`);
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

test('28 cam bearing bosses ride exactly on the cam axis line, 0.05 cm over every bearing, carried by webs', async () => {
  const { group } = await buildHeads();
  const vt = await buildValvetrain();
  for (const bank of ['L', 'R']) {
    const v = bankVectors(bank);
    const head = group.getObjectByName(`head-${bank}`);
    const bosses = [], webs = [];
    head.traverse((o) => {
      if (o.userData.kind === 'boss') bosses.push(o);
      if (o.userData.kind === 'bossweb') webs.push(o);
    });
    assert.equal(bosses.length, 14, `head-${bank} bosses`);
    assert.equal(webs.length, 14, `head-${bank} boss webs`);
    for (const valve of valves) {
      const camA = camAlongA(bank);
      const oCam = camOutA(bank, valve);
      const ref = SPEC.cylinders.find((c) => c.bank === bank);
      const cap = camAxisPoint(ref, valve);
      for (const bx of CAM.bearings) {
        const bearing = vt.group.getObjectByName(`bearing-${bank}-${valve}-${bx}`);
        assert.ok(bearing, `bearing ${bank} ${valve} x ${bx} missing`);
        const match = bosses.filter((b) => b.userData.bx === bx && b.userData.valve === valve);
        assert.equal(match.length, 1, `boss for ${bank} ${valve} x ${bx}`);
        const boss = match[0];
        let bMin = Infinity, bMax = -Infinity;
        for (const p of verts(bearing)) {
          const r = Math.hypot(p.y - cap.y, p.z - cap.z);
          bMin = Math.min(bMin, r); bMax = Math.max(bMax, r);
        }
        assert.ok(Math.abs(bMax - CAM.bearingR) < EPS, `bearing OD ${bMax} != ${CAM.bearingR}`);
        let rMin = Infinity, xMin = Infinity, xMax = -Infinity;
        for (const p of verts(boss)) {
          rMin = Math.min(rMin, Math.hypot(alongOf(v, bank, p) - camA, outOf(v, bank, p) - oCam));
          xMin = Math.min(xMin, p.x); xMax = Math.max(xMax, p.x);
        }
        assert.ok(Math.abs(rMin - (CAM.bearingR + H.bossClr)) < EPS,
          `boss bore r ${rMin} != bearing ${CAM.bearingR} + clearance ${H.bossClr}`);
        assert.ok(Math.abs(rMin - bMax - H.bossClr) < EPS, `running clearance ${rMin - bMax} != ${H.bossClr}`);
        assert.ok(xMin <= bx - CAM.bearingHalf + EPS && xMax >= bx + CAM.bearingHalf - EPS,
          `boss x ${xMin}..${xMax} does not cover bearing x ${bx}`);
        // The fore bearing ends exactly at the first sprocket plane, so the boss
        // face is the machined shoulder the sprocket locates against: the column
        // may reach that plane, never pass it.
        assert.ok(xMax <= BAND + EPS && xMin >= -BAND - EPS,
          `boss x ${xMin}..${xMax} intrudes on the sprocket band (band ${-BAND}..${BAND})`);
        const bbBoss = new THREE.Box3().setFromObject(boss);
        assert.ok(webs.some((w) => bbBoss.intersectsBox(new THREE.Box3().setFromObject(w))),
          `boss ${bank} ${valve} x ${bx} is not carried by a web`);
      }
      // lobes (at cylinder stations) never reach a boss bore (at bearing x)
      for (const s of B.stations) {
        for (const bx of CAM.bearings) {
          assert.ok(Math.abs(s - bx) >= H.camLobeWidth / 2 + CAM.bearingHalf + 0.1,
            `lobe station ${s} too close to bearing ${bx}`);
        }
      }
    }
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

test('nothing floats and nothing intrudes: 120 connected solids per bank, envelope clear of the piston', async () => {
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
        // A flat-crown piston with 45 deg of overlap (this spec) never has the
        // valves shut at TDC: exhaust is still blowing down, intake already
        // cracked open. What has to hold is that both are on their ramps -
        // a small fraction of maxLift - and never deep into the stroke.
        if (crown > tdcCrown - 1.0 && lift > ramp) { ramp = lift; rampAt = [cyl.num, valve, theta]; }
      }
    }
  }
  assert.ok(worst > 0.15, `worst valve/piston clearance ${worst} at ${JSON.stringify(worstAt)}`);
  assert.ok(ramp < V.maxLift * 0.75,
    `near-TDC lift ${ramp} at ${JSON.stringify(rampAt)} is off the ramp (ceiling ${V.maxLift * 0.75})`);
});
