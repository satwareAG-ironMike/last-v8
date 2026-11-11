// Manifolds unit - written RED first. Contract:
// - 4-into-1 exhaust headers per bank: 4 primaries + flanges that mate exactly
//   onto the head outboard port face, pair merges, one collector sized for the
//   flow of all four primaries, an outlet, weld beads at every joint
// - 4 intake runners per bank into one plenum sitting in the V, plus a fuel
//   rail with 4 injectors
// - every primary the same length within 3 % (a real equal-length header)
// - no manifold solid touches the block, heads, valvetrain or cranktrain:
//   clearance is measured against a 1 cm voxel shell of the real meshes, so
//   the assert is derived from the geometry that is actually rendered.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SPEC, bankPoint, bankUp, bankOut, camAxisBank } from '../src/engine/spec.js';
import { createBlock } from '../src/render/block.js';
import { createCranktrain } from '../src/render/cranktrain.js';
import { createValvetrain } from '../src/render/valvetrain.js';
import { createHeads } from '../src/render/heads.js';
import { createManifolds, manifoldSpecs } from '../src/render/manifolds.js';

const M = SPEC.manifold;
const B = SPEC.block;
const H = SPEC.head;
const valves = ['intake', 'exhaust'];
const EPS = 1e-4;

const materials = new Proxy({}, {
  get: (t, k) => (t[k] ??= new THREE.MeshStandardMaterial({ name: String(k) })),
});

const build = () => createManifolds(materials);

const bankVectors = (bank) => ({
  up: new THREE.Vector3().fromArray(bankUp(bank)),
  out: new THREE.Vector3().fromArray(bankOut(bank)),
});

/** World-space vertices of every mesh under an object, as distinct Vector3s. */
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

// Bolts are one InstancedMesh per manifold side: count the INSTANCES, not the
// mesh objects, or a single mesh would silently stand for a whole flange ring.
function kindCounts(group, bank) {
  const c = {};
  group.traverse((o) => {
    if (!o.isMesh || !o.name.includes(bank)) return;
    const k = o.userData.kind ?? 'unnamed';
    c[k] = (c[k] ?? 0) + (o.isInstancedMesh ? o.count : 1);
  });
  return c;
}

// ---------------------------------------------------------------------------
// voxel shell of the engine that is actually on screen: 1 cm cells in the bank
// frame holding every vertex of block, heads, cranktrain and valvetrain.
// Distance to the union of those cells is never greater than the true surface
// distance, so requiring >= 0.5 cm is the strict, honest direction.
// ---------------------------------------------------------------------------
const CELL = 1.0;
const shellCache = {};
function engineShell(bank) {
  if (shellCache[bank]) return shellCache[bank];
  const groups = {
    block: createBlock(materials),
    cranktrain: createCranktrain(materials).group,
    valvetrain: createValvetrain(materials).group,
    heads: createHeads(materials).group,
  };
  const v = bankVectors(bank);
  const cells = new Set();
  for (const g of Object.values(groups)) {
    for (const p of vertsOf(g)) {
      const key = `${Math.round(p.dot(v.up) / CELL)},${Math.round(p.dot(v.out) / CELL)},${Math.round(p.x / CELL)}`;
      cells.add(key);
    }
  }
  shellCache[bank] = cells;
  return cells;
}

/** Distance from a bank-frame point to the nearest occupied 1 cm cell AABB. */
function shellDistance(cells, along, out, x) {
  const ia = Math.round(along / CELL), io = Math.round(out / CELL), ix = Math.round(x / CELL);
  let best = Infinity;
  const half = CELL / 2;
  const gap = (v, c) => Math.max(0, Math.abs(v - c) - half);
  for (let da = -2; da <= 2; da++) {
    for (let dbo = -2; dbo <= 2; dbo++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (!cells.has(`${ia + da},${io + dbo},${ix + dx}`)) continue;
        best = Math.min(best, Math.hypot(
          gap(along, (ia + da) * CELL),
          gap(out, (io + dbo) * CELL),
          gap(x, (ix + dx) * CELL),
        ));
      }
    }
  }
  return best;
}

const localOf = (v, bank, p) => ({ along: p.dot(v.up), out: p.dot(v.out), x: p.x });

/** Bank-local [along,out,x] node list -> world points (what the renderer builds). */
const worldNodes = (v, bank, nodes) =>
  nodes.map(([a, o, x]) => new THREE.Vector3().copy(bankPoint(bank, a, o, x)));

/** Distance from a world point to a bank-local centre-line polyline. */
function distToPolyline(v, bank, nodes, p) {
  const ws = worldNodes(v, bank, nodes);
  let best = Infinity;
  for (let i = 0; i + 1 < ws.length; i++) {
    const ab = ws[i + 1].clone().sub(ws[i]);
    const t = Math.max(0, Math.min(1, p.clone().sub(ws[i]).dot(ab) / ab.lengthSq()));
    best = Math.min(best, ws[i].clone().add(ab.multiplyScalar(t)).distanceTo(p));
  }
  return best;
}

/**
 * Closest surface distance between two point clouds. Loops, never
 * Math.min(...spread): a tube mesh carries tens of thousands of vertices and a
 * spread of that size blows the call stack.
 */
function minDistance(as, bs) {
  let best = Infinity;
  for (const a of as) for (const b of bs) {
    const d = a.distanceTo(b);
    if (d < best) best = d;
  }
  return best;
}

/** Bank-local AABB of a set of world points. */
function localAABB(v, bank, pts) {
  const ls = pts.map((p) => localOf(v, bank, p));
  const at = ls.map((l) => l.along), ot = ls.map((l) => l.out), xt = ls.map((l) => l.x);
  return {
    a0: Math.min(...at), a1: Math.max(...at),
    o0: Math.min(...ot), o1: Math.max(...ot),
    x0: Math.min(...xt), x1: Math.max(...xt),
  };
}

/** Distance from a bank-local point to a bank-local AABB (0 when inside). */
function distToAABB(bb, l) {
  const d = (v, lo, hi) => (v < lo ? lo - v : v > hi ? v - hi : 0);
  return Math.hypot(d(l.along, bb.a0, bb.a1), d(l.out, bb.o0, bb.o1), d(l.x, bb.x0, bb.x1));
}

/**
 * Signed reach of a point into a bank-local AABB: positive when the point is
 * buried inside (how deep), negative when it is outside (how far short).
 */
function depthToAABB(bb, l) {
  const m = [l.along - bb.a0, bb.a1 - l.along, l.out - bb.o0, bb.o1 - l.out, l.x - bb.x0, bb.x1 - l.x];
  const outside = m.filter((c) => c < 0);
  return outside.length ? Math.max(...outside) : Math.min(...m);
}

test('manifold build contract: headers, plenums, runners, rail, injectors per bank', async () => {
  const { group } = build();
  for (const bank of ['L', 'R']) {
    const c = kindCounts(group, bank);
    assert.equal(c.exFlange, 4, `${bank} exhaust flanges`);
    assert.equal(c.exNeck, 4, `${bank} port necks`);
    assert.equal(c.exPrimary, 4, `${bank} primaries`);
    assert.equal(c.exPair, 2, `${bank} pair outlets`);
    assert.equal(c.exCollector, 1, `${bank} collector`);
    assert.equal(c.exOutletFlange, 1, `${bank} outlet flange`);
    assert.equal(c.exShield, 2, `${bank} heat shields`);
    assert.equal(c.clampBand, 4, `${bank} shield clamp bands`);
    assert.equal(c.shieldStay, 4, `${bank} shield stand-offs`);
    assert.equal(c.exBead, 11, `${bank} exhaust weld beads`);
    assert.equal(c.inFlange, 4, `${bank} intake flanges`);
    assert.equal(c.inNeck, 4, `${bank} intake necks`);
    assert.equal(c.inRunner, 4, `${bank} runners`);
    assert.equal(c.inPlenum, 1, `${bank} plenum`);
    assert.equal(c.inBead, 6, `${bank} intake weld/clamp beads`);
    assert.equal(c.rail, 1, `${bank} fuel rail`);
    assert.equal(c.injector, 4, `${bank} injectors`);
    assert.equal(c.bracket, 2, `${bank} rail brackets`);
    assert.equal(c.injectorCollar, 4, `${bank} injector clamp collars`);
    assert.equal(c.rail, 1, `${bank} fuel rail`);
    assert.equal(c.injector, 4, `${bank} injectors`);
    // Physical minimum, not a tautology against the spec: a flange held by a
    // single bolt pivots on that bolt about the port axis and leaks. Every port
    // needs its pair, on both sides of the head.
    assert.ok(M.boltOffsetsAlong.length >= 2,
      `${bank} flange bolt pattern has ${M.boltOffsetsAlong.length} hole(s): one bolt cannot hold a flange`);
    assert.equal(c.bolt, 2 * 4 * M.boltOffsetsAlong.length,
      `${bank} flange bolts: ${c.bolt} instances for ${4} ports x ${M.boltOffsetsAlong.length} holes x 2 sides`);
  }
});

test('exhaust flanges and necks mate exactly onto the head outboard port face', async () => {
  const { group } = build();
  for (const bank of ['L', 'R']) {
    const v = bankVectors(bank);
    for (const st of B.stations) {
      const flange = group.getObjectByName(`ex-flange-${bank}-${st}`);
      const neck = group.getObjectByName(`ex-neck-${bank}-${st}`);
      assert.ok(flange && neck, `ex flange/neck ${bank} station ${st} missing`);
      const vs = vertsOf(flange), ns = vertsOf(neck);
      const oMin = Math.min(...vs.map((p) => p.dot(v.out)));
      const oMax = Math.max(...vs.map((p) => p.dot(v.out)));
      // the head outboard stay face is exactly at out = gasketOd = 7.0
      assert.ok(Math.abs(oMin - H.gasketOd) < EPS, `flange inner face ${oMin} != head face ${H.gasketOd}`);
      assert.ok(Math.abs(oMax - (H.gasketOd + M.exFlangeT)) < EPS, `flange outer face ${oMax}`);
      const aMin = Math.min(...vs.map((p) => p.dot(v.up)));
      const aMax = Math.max(...vs.map((p) => p.dot(v.up)));
      assert.ok(aMin >= M.exFlangeA0 - EPS && aMax <= M.exFlangeA1 + EPS, `flange along ${aMin}..${aMax}`);
      // and it lands fully on the casting: the stay spans +-1.7 in x and up to STAY_TOP 30
      const xMin = Math.min(...vs.map((p) => p.x));
      const xMax = Math.max(...vs.map((p) => p.x));
      assert.ok(xMin >= st - 1.7 + EPS && xMax <= st + 1.7 - EPS, `flange x ${xMin}..${xMax} hangs off the stay`);
      assert.ok(aMax <= 30 - EPS, `flange top ${aMax} above the stay top 30`);
      const noMin = Math.min(...ns.map((p) => p.dot(v.out)));
      assert.ok(Math.abs(noMin - oMax) < EPS, `neck ${noMin} does not butt the flange ${oMax}`);
    }
  }
});

test('intake flanges mate onto the head inboard face and the plenum clears every cam boss', async () => {
  const { group } = build();
  // a cam boss is a sleeve around the 2.05 bearing: its outer surface sits at
  // cam-axis |out| + bearingR + 0.75 wall, measured 8.13 on the real casting
  const bossReach = Math.abs(camAxisBank('L', 'intake')[1]) + SPEC.cam.bearingR + 0.75;
  for (const bank of ['L', 'R']) {
    const v = bankVectors(bank);
    for (const st of B.stations) {
      const flange = group.getObjectByName(`in-flange-${bank}-${st}`);
      assert.ok(flange, `in flange ${bank} ${st} missing`);
      const vs = vertsOf(flange);
      const oMin = Math.min(...vs.map((p) => p.dot(v.out)));
      const oMax = Math.max(...vs.map((p) => p.dot(v.out)));
      assert.ok(Math.abs(oMax + H.gasketOd) < EPS, `intake flange inner face ${oMax} != -${H.gasketOd}`);
      assert.ok(Math.abs(oMin + (H.gasketOd + M.inFlangeT)) < EPS, `intake flange outer face ${oMin}`);
    }
    const plenum = group.getObjectByName(`plenum-${bank}`);
    const vs = vertsOf(plenum);
    const deepestOut = Math.max(...vs.map((p) => p.dot(v.out)));
    // plenum is inboard of the head: its outboard-most point must clear the cam
    // boss reach (boss OD 2.85 around the cam axis at |out| 5.28) by >= 1 cm
    assert.ok(deepestOut <= -bossReach - 1.0 + EPS,
      `plenum outboard face ${deepestOut} does not clear the cam boss at -${bossReach}`);
    const halfX = Math.max(...vs.map((p) => Math.abs(p.x)));
    assert.ok(halfX <= SPEC.crank.sprocket.x0 - 5.0, `plenum reaches x ${halfX}, too close to the ${SPEC.crank.sprocket.x0} sprocket band`);
    const aMin = Math.min(...vs.map((p) => p.dot(v.up)));
    assert.ok(aMin > B.deckA, `plenum bottom ${aMin} below the block deck ${B.deckA}`);
  }
});

test('equal-length 4-into-1: primaries run from their own port to the merge and match within 3 %', async () => {
  const specs = manifoldSpecs();
  const lens = [];
  for (const bank of ['L', 'R']) {
    const s = specs[bank];
    assert.equal(s.primary.length, 4, `${bank} primaries`);
    for (let i = 0; i < 4; i++) {
      const nodes = s.primary[i];
      // first node sits in that cylinder's own port neck, last node at the pair merge
      assert.ok(Math.abs(nodes[0][2] - B.stations[i]) < 0.35,
        `${bank} primary ${i} starts at x ${nodes[0][2]}, not its cylinder station ${B.stations[i]}`);
      assert.ok(Math.abs(nodes[0][1] - (H.gasketOd + M.exFlangeT + M.exNeckT)) < 0.6,
        `${bank} primary ${i} does not start inside the port neck (out ${nodes[0][1]})`);
      const mergeX = M.exMergeX * (i < 2 ? 1 : -1);
      const last = nodes[nodes.length - 1];
      assert.ok(Math.abs(last[2] - mergeX) < 0.4, `${bank} primary ${i} ends at x ${last[2]}, merge is ${mergeX}`);
      let len = 0;
      for (let k = 1; k < nodes.length; k++) len += Math.hypot(...nodes[k].map((c, j) => c - nodes[k - 1][j]));
      lens.push(len);
    }
  }
  const lo = Math.min(...lens), hi = Math.max(...lens);
  assert.ok((hi - lo) / lo < 0.03, `primary lengths ${lo.toFixed(2)}..${hi.toFixed(2)} cm differ by more than 3 %`);
});

test('collector and pair outlets are sized for the flow of the tubes they merge', async () => {
  const specs = manifoldSpecs();
  const area = (r) => Math.PI * r * r;
  for (const bank of ['L', 'R']) {
    assert.ok(area(M.exCollectorR) >= 4 * area(M.exPrimaryR),
      `${bank} collector ${M.exCollectorR} cannot pass 4 primaries of ${M.exPrimaryR}`);
    assert.ok(area(M.exPairR) >= 2 * area(M.exPrimaryR), `${bank} pair outlet undersized`);
    assert.ok(M.inRunnerR >= M.exPortR, `${bank} intake runner smaller than the exhaust port`);
    assert.ok(M.plenumOut1 < -H.gasketOd, 'plenum must sit inboard of the head face');
  }
});

test('nothing in the pipework touches the block, heads, valvetrain or cranktrain', async () => {
  const { group } = build();
  const exempt = new Set(['exFlange', 'exNeck', 'inFlange', 'inNeck']); // these mate by design
  let worst = Infinity, worstAt = null;
  for (const bank of ['L', 'R']) {
    const v = bankVectors(bank);
    const cells = engineShell(bank);
    group.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh) return;
      if (!o.name.includes(bank) || exempt.has(o.userData.kind)) return;
      for (const p of vertsOf(o)) {
        const l = localOf(v, bank, p);
        const d = shellDistance(cells, l.along, l.out, l.x);
        if (d < worst) { worst = d; worstAt = [o.name, l.along.toFixed(2), l.out.toFixed(2), l.x.toFixed(2)]; }
      }
    });
  }
  assert.ok(worst >= 0.5, `closest pipework-to-engine gap ${worst.toFixed(3)} cm at ${JSON.stringify(worstAt)}`);
});

test('pipework never enters the cam sweep, the crankcase rotating bay or a bore tunnel', async () => {
  const { group } = build();
  const OD = SPEC.block.caseOuterRadius; // 11.6: the crankcase barrel the counterweights swing inside
  const xBay = 26.5; // block casting x extent (measured): the rotating bay lives inside it
  const linerOD = SPEC.block.boreShellRadius + 0.15; // 5.45: the liner OD pressed into the wall columns
  const camNeed = SPEC.head.camJournalRadius + SPEC.valves.maxLift + 1.5; // journal + nose + air
  let minCam = Infinity, atCam = null, minCase = Infinity, atCase = Infinity, minBore = Infinity, atBore = null;
  let caseX = 0, boreOut = 0;
  for (const bank of ['L', 'R']) {
    const v = bankVectors(bank);
    const lines = valves.map((valve) => ({
      a: camAxisBank(bank, valve)[0], o: camAxisBank(bank, valve)[1],
    }));
    group.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || !o.name.includes(bank)) return;
      for (const p of vertsOf(o)) {
        const l = localOf(v, bank, p);
        for (const c of lines) {
          const d = Math.hypot(l.along - c.a, l.out - c.o); // perpendicular to a line parallel to X
          if (d < minCam) { minCam = d; atCam = [o.name, l.along.toFixed(2), l.out.toFixed(2)]; }
        }
        // rotating bay: nothing may come inside the crankcase barrel, where the
        // counterweights (r 6.3), the flywheel ring (r 9.95) and the chain run
        const r = Math.hypot(p.y, p.z);
        if (Math.abs(p.x) < xBay && r < minCase) {
          minCase = r; caseX = p.x; atCase = [o.name, l.along.toFixed(2), l.out.toFixed(2)];
        }
        // bore tunnel: no pipework may hang into a cylinder's bore corridor
        if (l.along >= SPEC.block.boreStartA && l.along <= B.deckA) {
          for (const st of B.stations) {
            if (Math.abs(l.x - st) > B.pitch / 2) continue;
            const d = Math.hypot(l.out, l.x - st);
            if (d < minBore) { minBore = d; boreOut = l.out; atBore = [o.name, l.along.toFixed(2), st]; }
          }
        }
      }
    });
  }
  assert.ok(minCam > camNeed,
    `pipework ${JSON.stringify(atCam)} comes within ${minCam.toFixed(2)} cm of a cam axis (needs ${camNeed})`);
  assert.ok(minCase > OD + 2.0,
    `pipework ${JSON.stringify(atCase)} at x ${caseX.toFixed(1)} is inside the ${OD} crankcase rotating bay (closest ${minCase.toFixed(2)})`);
  assert.ok(minBore > linerOD + 1.0,
    `pipework ${JSON.stringify(atBore)} (out ${boreOut.toFixed(2)}) hangs into a bore tunnel (closest ${minBore.toFixed(2)} vs liner ${linerOD})`);
});

test('every joint is fused: tubes butt their flanges, primaries their necks, runners the plenum', async () => {
  const { group } = build();
  const specs = manifoldSpecs();
  const joint = (a, b, name, maxGap = 0.35) => {
    assert.ok(a && b, `${name}: missing part`);
    const pa = vertsOf(a), pb = vertsOf(b);
    let gap = Infinity;
    for (const p of pa) for (const q of pb) gap = Math.min(gap, p.distanceTo(q));
    assert.ok(gap <= maxGap, `${name}: surfaces ${gap.toFixed(3)} cm apart - that part floats`);
    return gap;
  };
  const inside = (mesh, bb, name) => {
    const v = bankVectors(name.includes('L') ? 'L' : 'R');
    const n = vertsOf(mesh).filter((p) => distToAABB(bb, localOf(v, name.includes('L') ? 'L' : 'R', p)) <= 0.0).length;
    assert.ok(n > 0, `${name}: nothing of it reaches inside its mating solid - it does not connect`);
    return n;
  };
  for (const bank of ['L', 'R']) {
    const v = bankVectors(bank);
    for (let i = 0; i < 4; i++) {
      const st = B.stations[i];
      joint(group.getObjectByName(`ex-flange-${bank}-${st}`), group.getObjectByName(`ex-neck-${bank}-${st}`),
        `exhaust flange/neck ${bank} ${st}`);
      joint(group.getObjectByName(`in-flange-${bank}-${st}`), group.getObjectByName(`in-neck-${bank}-${st}`),
        `intake flange/neck ${bank} ${st}`);
      joint(group.getObjectByName(`primary-${bank}-${st}`), group.getObjectByName(`ex-neck-${bank}-${st}`),
        `primary/port ${bank} ${st}`, 1.1); // the primary centre-line sits on the neck face
      joint(group.getObjectByName(`runner-${bank}-${st}`), group.getObjectByName(`in-neck-${bank}-${st}`),
        `runner/port ${bank} ${st}`, 1.1);
      // fusion, not contact: the tube end is buried inside its mating solid
      const neckBB = localAABB(v, bank, vertsOf(group.getObjectByName(`ex-neck-${bank}-${st}`)));
      inside(group.getObjectByName(`primary-${bank}-${st}`), neckBB, `primary ${bank} ${st} vs its neck`);
      // and it is buried DEEP: the centre-line must run past the plenum face by
      // more than its own radius, otherwise the runner only grazes the bar
      const nodes = specs[bank].runner[i];
      const plenumSpec = {
        a0: M.plenumA0, a1: M.plenumA1, o0: M.plenumOut0, o1: M.plenumOut1,
        x0: -M.plenumX, x1: M.plenumX,
      };
      const tipNode = nodes[nodes.length - 1];
      const tip = localOf(v, bank, worldNodes(v, bank, [tipNode])[0]);
      const depth = Math.max(
        plenumSpec.a0 - tip.along, tip.along - plenumSpec.a1,
        plenumSpec.o0 - tip.out, tip.out - plenumSpec.o1,
        plenumSpec.x0 - tip.x, tip.x - plenumSpec.x1,
      );
      assert.ok(depth <= -(M.inRunnerR + 0.2),
        `runner ${bank} ${st} only reaches ${(-depth).toFixed(2)} cm into the plenum (tube r ${M.inRunnerR})`);
      const plenumBB = localAABB(v, bank, vertsOf(group.getObjectByName(`plenum-${bank}`)));
      inside(group.getObjectByName(`runner-${bank}-${st}`), plenumBB, `runner ${bank} ${st} vs the plenum`);
    }
    // each pair outlet is buried in the collector, and the collector in its outlet flange
    const coll = group.getObjectByName(`collector-${bank}`);
    for (const px of [M.exMergeX, -M.exMergeX]) {
      joint(group.getObjectByName(`pair-${bank}-${px}`), coll, `pair outlet ${bank} x ${px}`, 1.6);
      inside(group.getObjectByName(`pair-${bank}-${px}`),
        localAABB(v, bank, vertsOf(coll)), `pair outlet ${bank} x ${px} vs the collector`);
    }
    joint(coll, group.getObjectByName(`outlet-${bank}`), `collector/outlet ${bank}`, 1.2);
    // the injector nozzle reaches inside its own runner bore, measured against
    // the runner centre-line the mesh is built from, not against a loose box
    for (let i = 0; i < 4; i++) {
      const st = B.stations[i];
      const inj = group.getObjectByName(`injector-${bank}-${st}`);
      const nodes = specs[bank].runner[i];
      let best = Infinity;
      for (const p of vertsOf(inj)) best = Math.min(best, distToPolyline(v, bank, nodes, p));
      assert.ok(best < M.inRunnerR - 0.15,
        `injector ${bank} ${st} nozzle stops ${best.toFixed(2)} cm from the runner axis (bore r ${M.inRunnerR})`);
    }
  }
});

test('fuel rail rides the plenum and every injector aims at its own cylinder', async () => {
  const { group } = build();
  const specs = manifoldSpecs();
  for (const bank of ['L', 'R']) {
    const v = bankVectors(bank);
    const rail = group.getObjectByName(`rail-${bank}`);
    const plenum = group.getObjectByName(`plenum-${bank}`);
    assert.ok(rail && plenum, `rail/plenum ${bank} missing`);
    const pa = localAABB(v, bank, vertsOf(plenum));
    const railPts = vertsOf(rail);
    let railGap = Infinity;
    for (const p of railPts) railGap = Math.min(railGap, distToAABB(pa, localOf(v, bank, p)));
    // the rail is clamped beside the plenum bar, so it must clear it by a real
    // mounting distance rather than overlap it
    assert.ok(railGap >= 0.8, `rail ${bank} sits ${railGap.toFixed(3)} cm from the plenum bar`);
    assert.ok(railGap <= 4.0, `rail ${bank} floats ${railGap.toFixed(2)} cm off the plenum - nothing holds it`);
    for (let i = 0; i < 4; i++) {
      const st = B.stations[i];
      const inj = group.getObjectByName(`injector-${bank}-${st}`);
      assert.ok(inj, `injector ${bank} ${st} missing`);
      const iv = vertsOf(inj);
      assert.ok(Math.min(...iv.map((p) => Math.abs(p.x - st))) < 0.9, `injector ${bank} ${st} not at its cylinder`);
      // aim: the injector tip actually meets that cylinder's own runner
      const runner = group.getObjectByName(`runner-${bank}-${st}`);
      const near = minDistance(iv, vertsOf(runner));
      assert.ok(near <= 1.25, `injector ${bank} ${st} tip ${near.toFixed(3)} cm from its runner`);
      // and the injector is fed: its body reaches the fuel rail surface.
      // Measured against the rail as a tube (its axis polyline minus its radius),
      // because a cylinder mesh only carries vertices at its two end rings.
      const feed = Math.min(...iv.map((p) => distToPolyline(v, bank, specs[bank].rail, p) - M.railR));
      assert.ok(feed <= 0.05, `injector ${bank} ${st} stops ${feed.toFixed(2)} cm short of the fuel rail`);
      assert.ok(feed >= -1.5, `injector ${bank} ${st} drives ${(-feed).toFixed(2)} cm through the fuel rail`);
      // an injector must not be buried inside the plenum bar it feeds past
      const inPlenum = iv.filter((p) => distToAABB(pa, localOf(v, bank, p)) <= 0.001).length;
      assert.ok(inPlenum === 0, `injector ${bank} ${st}: ${inPlenum} vertices inside the plenum bar`);
    }
  }
});

test('heat shields cover the header tubes without swallowing them', async () => {
  const specs = manifoldSpecs();
  for (const bank of ['L', 'R']) {
    for (const sh of specs[bank].shields) {
      const inner = sh[2]; // shield inner (most inboard) face in `out`
      const tubes = [
        ...specs[bank].primary.map((n) => [n, M.exPrimaryR]),
        ...specs[bank].pair.map((n) => [n, M.exPairR]),
        [specs[bank].collector, M.exCollectorR],
      ];
      for (const [nodes, r] of tubes) {
        for (const [a, o] of nodes) {
          // only the tube runs that actually pass under the shield span matter
          if (a < sh[0] || a > sh[1]) continue;
          assert.ok(inner >= o + r + 0.5,
            `${bank} heat shield inner face ${inner} swallows a tube surface at ${o} + r ${r}`);
        }
      }
    }
  }
});

test('every mounting carries its part: shields, stands, bands, collars, brackets', async () => {
  const { group } = build();
  const specs = manifoldSpecs();
  for (const bank of ['L', 'R']) {
    const v = bankVectors(bank);
    const S = specs[bank];

    // Load path tube -> clamp band -> stand-off -> shield, all measured. A
    // shield is held only if at least two stand-off tips are buried in it: a
    // box mesh carries vertices only at its corners, so reach is measured
    // against the solid, not against sparse corner samples.
    S.shields.forEach((sh, k) => {
      const holds = S.stands.filter((s) => s.shield === k).filter((st) => {
        const bb = { a0: sh[0], a1: sh[1], o0: sh[2], o1: sh[3], x0: sh[4], x1: sh[5] };
        const tip = localOf(v, bank, worldNodes(v, bank, [st.tip])[0]);
        return depthToAABB(bb, tip) >= 0.15;
      });
      assert.ok(holds.length >= 2, `shield ${bank} ${k} is held by ${holds.length} stand-off(s); a panel needs 2`);
    });

    // stand-offs are rooted in their clamp band, and buried in the shield
    S.stands.forEach((st) => {
      const stay = group.getObjectByName(`shield-stand-${bank}-${st.shield}-${st.cyl}`);
      const band = group.getObjectByName(`clamp-band-${bank}-${st.shield}-${st.cyl}`);
      const vs = vertsOf(stay);
      // a ring is symmetric, so its bounding-box centre is the ring centre
      const ringCentre = new THREE.Box3().setFromObject(band).getCenter(new THREE.Vector3());
      const rootReach = Math.min(...vs.map((p) => p.distanceTo(ringCentre)));
      assert.ok(rootReach <= M.clampBandR + M.clampBandTube + 0.3,
        `shield stand ${bank} ${st.cyl} does not reach its clamp band (${rootReach.toFixed(2)} cm)`);
      const buried = Math.min(...vs.map((p) => distToAABB(localAABB(v, bank, vertsOf(band)), localOf(v, bank, p))));
      assert.ok(buried <= 0.4, `stand ${bank} ${st.cyl} does not fuse into its band (${buried.toFixed(2)} cm gap)`);
      const shieldBB = {
        a0: S.shields[st.shield][0], a1: S.shields[st.shield][1],
        o0: S.shields[st.shield][2], o1: S.shields[st.shield][3],
        x0: S.shields[st.shield][4], x1: S.shields[st.shield][5],
      };
      const tip = localOf(v, bank, worldNodes(v, bank, [st.tip])[0]);
      const inShield = depthToAABB(shieldBB, tip);
      assert.ok(inShield >= 0.15,
        `stand ${bank} ${st.cyl} tip only reaches ${inShield.toFixed(2)} cm into the shield face (needs 0.15)`);
    });

    // clamp bands grip the primary tube: the band ring must overlap the tube skin
    S.bands.forEach((b) => {
      const band = group.getObjectByName(`clamp-band-${bank}-${b.shield}-${b.cyl}`);
      const nodes = S.primary[b.cyl];
      const axisDist = Math.min(...vertsOf(band).map((p) => distToPolyline(v, bank, nodes, p)));
      const skin = M.exPrimaryR;
      assert.ok(axisDist <= skin + M.clampBandTube,
        `clamp band ${bank} ${b.cyl} floats off its tube: axis distance ${axisDist.toFixed(2)} cm vs skin ${skin}`);
      assert.ok(axisDist >= skin - M.clampBandTube - 0.05,
        `clamp band ${bank} ${b.cyl} swallows its tube: it collapses to ${axisDist.toFixed(2)} cm`);
    });

    // injectors are clamped to their runner and fed from the rail: the collar
    // grips the injector body and bears on the rail
    for (let i = 0; i < 4; i++) {
      const st = B.stations[i];
      const collar = group.getObjectByName(`injector-collar-${bank}-${st}`);
      const inj = S.injector[i];
      const onBody = Math.min(...vertsOf(collar).map((p) => distToPolyline(v, bank, inj, p)));
      assert.ok(onBody <= M.injR + 0.3 && onBody >= M.injR - 0.1,
        `injector collar ${bank} ${st} does not grip the injector body (${onBody.toFixed(2)} cm from its axis)`);
      const onRail = Math.min(...vertsOf(collar).map((p) => distToPolyline(v, bank, S.rail, p) - M.railR));
      assert.ok(onRail <= 0.35, `injector collar ${bank} ${st} floats off the fuel rail (${onRail.toFixed(2)} cm)`);
    }

    // the fuel rail rides its brackets and its clamp bands, and the brackets are
    // cast into the plenum bar they hang from
    const rail = group.getObjectByName(`rail-${bank}`);
    const rvs = vertsOf(rail);
    S.brackets.forEach((br) => {
      const bb = { a0: br[0], a1: br[1], o0: br[2], o1: br[3], x0: br[4], x1: br[5] };
      const gap = Math.min(...rvs.map((p) => distToAABB(bb, localOf(v, bank, p))));
      assert.ok(gap <= 0.0, `fuel rail ${bank} does not touch its bracket (${gap.toFixed(2)} cm)`);
      const m = group.getObjectByName(`rail-bracket-${bank}-${br[4] > 0 ? br[4] : br[5]}`);
      const plenumBB = {
        a0: M.plenumA0, a1: M.plenumA1, o0: M.plenumOut0, o1: M.plenumOut1, x0: -M.plenumX, x1: M.plenumX,
      };
      // the bracket is cast INTO the bar: its deepest vertex must bite past the
      // plenum face, otherwise it hangs off it by contact only
      const bite = Math.max(...vertsOf(m).map((p) => depthToAABB(plenumBB, localOf(v, bank, p))));
      assert.ok(bite >= 0.1, `rail bracket ${bank} only grazes the plenum (buries ${bite.toFixed(2)} cm)`);
    });
    S.railClamps.forEach((cl) => {
      const key = cl[0][2]; // the renderer names the hoop by its first node
      const bx = (cl[0][2] + cl[1][2]) / 2; // the hoop plane itself is the midpoint
      const bead = group.getObjectByName(`in-bead-${bank}-clamp-${key}`);
      const wrap = Math.min(...vertsOf(bead).map((p) => distToPolyline(v, bank, S.rail, p)));
      assert.ok(wrap <= M.railR, `rail clamp band ${bank} ${bx} does not wrap the rail (${wrap.toFixed(2)} cm)`);
      const br = S.brackets.find((b) => bx >= b[4] && bx <= b[5]);
      assert.ok(br, `rail clamp band ${bank} ${bx} sits outside every bracket`);
      const bb = { a0: br[0], a1: br[1], o0: br[2], o1: br[3], x0: br[4], x1: br[5] };
      const weld = Math.max(...vertsOf(bead).map((p) => depthToAABB(bb, localOf(v, bank, p))));
      assert.ok(weld >= 0.1, `rail clamp band ${bank} ${bx} is not welded into its bracket (${weld.toFixed(2)} cm)`);
    });
  }
});

test('pipework is static, whole, and never reaches the cam chain band', async () => {
  const { group, update } = build();
  update(0);
  update(360);
  group.updateMatrixWorld(true);
  const before = new THREE.Box3().setFromObject(group);
  update(720);
  group.updateMatrixWorld(true);
  const after = new THREE.Box3().setFromObject(group);
  assert.ok(before.min.distanceTo(after.min) < EPS && before.max.distanceTo(after.max) < EPS,
    'pipework moved under update(): it must be static');
  const halfX = Math.max(Math.abs(before.min.x), Math.abs(before.max.x));
  assert.ok(halfX < SPEC.crank.sprocket.x0 - 1.5, `pipework reaches x ${halfX} into the chain band`);
  assert.ok(before.min.y > -45 && before.max.y < 45 && before.min.z > -30 && before.max.z < 45,
    `pipework envelope ${JSON.stringify(before.min.toArray())}..${JSON.stringify(before.max.toArray())}`);
  // every runner and primary is a connected tube whose ends butt their joints
  for (const bank of ['L', 'R']) {
    for (const st of B.stations) {
      const r = group.getObjectByName(`runner-${bank}-${st}`);
      const p = group.getObjectByName(`primary-${bank}-${st}`);
      for (const [name, mesh] of [['runner', r], ['primary', p]]) {
        assert.ok(mesh.geometry.attributes.position.count > 300, `${name} ${bank} ${st} is not a full tube`);
        assert.ok(mesh.geometry.index !== null, `${name} ${bank} ${st} has no closed surface`);
      }
    }
  }
});
