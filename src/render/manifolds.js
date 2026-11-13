// Manifolds: a 6-into-1 exhaust header per bank on the outboard head faces -
// six primaries, three pair merges and one collector that runs the length of the
// bank - and six intake runners per bank into one plenum bar hanging in the V,
// with a fuel rail and six injectors per bank. Every flange mates onto a real
// head face (out |out| = gasketOd), every tube end is buried in its mating
// solid, and the collector is sized for the flow of all six primaries. Routing
// comes from SPEC.manifold, which was solved against the measured casting
// envelope
// (tmp/block-envelope.mjs, tmp/head-faces.mjs): the block body reaches out 12.24
// at mid-height, the head casting 8.13, so the pipework runs in the corridors
// outside those with >= 1.2 cm of air. Pinned by test/manifolds.test.mjs.
//
// Bank-local frame: `along` up the bore axis, `out` outboard away from the V,
// world X = crank axis. Exhaust ports face outboard, intake ports face into the
// V, exactly where the head casting puts its port bulkheads.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SPEC, bankPoint, bankUp, bankOut } from '../engine/spec.js';
import { boxInBank } from './parts.js';
import {
  alignYTo, boltGeometry, circleHole, cylinderBetween, extrude, instancedBolts,
  lathe, pipe, pipeCurve, roundedRectShape, weldBead,
} from './primitives.js';

const M = SPEC.manifold;
const B = SPEC.block;
const H = SPEC.head;
const X = new THREE.Vector3(1, 0, 0);
const FACE_A = B.stations.map((st, i) => st); // primary order follows B.stations
const PORT_A = 27.0; // port axis station in `along`: mid of the flange span
const OUT = H.gasketOd; // 7.0: the head outboard / inboard port face plane

const bankAxes = (bank) => {
  const u = new THREE.Vector3().fromArray(bankUp(bank));
  const o = new THREE.Vector3().fromArray(bankOut(bank));
  // Extruded shapes must keep a right-handed basis or their normals invert:
  // (up x out) has to point along +X.
  const flip = new THREE.Vector3().crossVectors(u, o).x < 0 ? -1 : 1;
  return { up: u, out: o, upBasis: u.clone().multiplyScalar(flip) };
};

/** Bank-local [along, out, x] -> world Vector3. */
const P = (bank, [a, o, x]) => {
  const w = bankPoint(bank, a, o, x);
  return new THREE.Vector3(w.x, w.y, w.z);
};
/** Move a geometry / object to a bank-local position. */
const put = (obj, bank, a, o, x) => {
  const w = bankPoint(bank, a, o, x);
  obj.translate(w.x, w.y, w.z);
  return obj;
};

function mesh(name, geometry, material, kind, userData = {}) {
  const m = new THREE.Mesh(geometry, material);
  m.name = name;
  m.castShadow = true;
  m.receiveShadow = true;
  m.userData = { kind, ...userData };
  return m;
}

/**
 * Flange plate: a rounded rectangular plate with the port bore cut through its
 * centre and two bolt holes straddling the port axis. Built in a local frame
 * (x = world X, y = bank `along`, z = bank `out`) so it stands square on the
 * head face, then carried into the bank basis.
 */
function flangePlate(bank, ax, halfX, halfA, depth, portR, fillet) {
  const shape = roundedRectShape(2 * halfX, 2 * halfA, fillet);
  shape.holes.push(circleHole(0, 0, portR));
  for (const off of M.boltOffsetsAlong) shape.holes.push(circleHole(0, off, M.boltHoleR));
  // bevel 0: an extrude bevel adds its thickness ON TOP of `depth` and pushes
  // the outline outward by bevelSize, which would both mis-centre the plate on
  // the head face and grow it past the stay footprint it has to land inside.
  const g = extrude(shape, depth, { bevel: 0, curveSegments: 18 });
  g.computeBoundingBox();
  const bb = g.boundingBox;
  g.translate(0, 0, -(bb.min.z + bb.max.z) / 2);
  g.applyMatrix4(new THREE.Matrix4().makeBasis(X, ax.upBasis, ax.out));
  return g;
}

/** Hollow port neck boss: a closed annulus turned about the port axis. */
function portNeck(bank, ax, rOut, rIn, len, dir) {
  const closed = [[rIn, 0], [rOut, 0], [rOut, len], [rIn, len], [rIn, 0]];
  const g = lathe(closed, 34);
  g.applyQuaternion(alignYTo(dir));
  return g;
}

// ---------------------------------------------------------------------------
// Routing tables (bank-local). All bank-local node lists are [along, out, x].
// ---------------------------------------------------------------------------

// Exhaust primary centre-line: one shared (along, out) profile for all four
// cylinders, x blended from the cylinder station to its pair merge. Because the
// merge sits exactly midway between the two stations it joins, every primary
// travels the same 5.5 cm in x and the four tubes come out the same length.
const EX_PROFILE = [[27.0, 9.2], [25.5, 10.8], [23.0, 11.9], [20.0, 12.9], [17.0, 13.6], [14.5, 14.2]];
// Exhaust pair merges (midway between the two stations of each pair) and the
// collector axis they feed. The collector runs the length of the bank just
// outboard and below the primaries, passes through every pair outlet, and turns
// down at the aft end into the bolt-on outlet flange.
const MERGE = SPEC.manifold.exMergeX;
const COLLECTOR_END = [12.3, 15.5];
const EX_BLEND = [1, 0.78, 0.56, 0.36, 0.16, 0];

// Intake runner: straight in x at its own cylinder station, sweeping inboard and
// up from the head port face into the plenum bar. Last node is inside the bar.
const IN_PROFILE = [[27.0, -8.6], [29.2, -10.4], [31.6, -12.4], [35.6, -14.8]];

/** The collector centre-line: closed past the front merge, open at the aft end. */
function collectorNodes() {
  const f = MERGE[0];
  const l = MERGE[MERGE.length - 1];
  return [
    [13.9, 14.0, f + 7.5],
    [...COLLECTOR_END, f],
    [11.9, 16.0, f / 2],
    [11.7, 16.3, 0],
    [11.9, 16.0, -f / 2],
    [...COLLECTOR_END, l],
    [10.6, 15.2, l - 5.5],
  ];
}

function primaryNodes(st, mergeX) {
  return EX_PROFILE.map(([a, o], k) => [a, o, mergeX + (st - mergeX) * EX_BLEND[k]]);
}
/** Pair outlet: from the merge straight down-outboard into the collector. */
function pairNodes(mergeX) {
  return [
    [14.5, 14.2, mergeX],
    [13.7, 14.7, mergeX],
    [13.0, 15.15, mergeX],
    [...COLLECTOR_END, mergeX],
  ];
}
/** Injector: from the rail surface down-outboard, nozzle inside its own runner. */
function injectorNodes(st) {
  return [
    [M.railAlong, M.railOut + M.railR - 0.35, st],
    [M.railAlong - 0.3, M.railOut + 2.4, st],
    [M.railAlong - 0.6, M.railOut + 4.1, st],
  ];
}

/** Point on a bank-local node polyline at arc-length fraction t. */
function polyAt(nodes, t) {
  const seg = [];
  let total = 0;
  for (let i = 0; i + 1 < nodes.length; i++) {
    const d = Math.hypot(nodes[i + 1][0] - nodes[i][0], nodes[i + 1][1] - nodes[i][1], nodes[i + 1][2] - nodes[i][2]);
    seg.push(d);
    total += d;
  }
  let target = t * total, k = 0;
  while (k < seg.length - 1 && target > seg[k]) { target -= seg[k]; k++; }
  const f = seg[k] > 0 ? target / seg[k] : 0;
  const a = nodes[k], b = nodes[k + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** Direction of the polyline segment containing arc-length fraction t. */
function polyDirAt(nodes, t) {
  const seg = [];
  let total = 0;
  for (let i = 0; i + 1 < nodes.length; i++) {
    const d = Math.hypot(nodes[i + 1][0] - nodes[i][0], nodes[i + 1][1] - nodes[i][1], nodes[i + 1][2] - nodes[i][2]);
    seg.push(d);
    total += d;
  }
  let target = t * total, k = 0;
  while (k < seg.length - 1 && target > seg[k]) { target -= seg[k]; k++; }
  return nodes[k + 1].map((c, j) => c - nodes[k][j]);
}

/** The whole routing plan, bank-local: what the meshes are actually built from. */
export function manifoldSpecs() {
  const out = {};
  for (const bank of ['L', 'R']) {
    const sgn = bank === 'L' ? 1 : -1;
    out[bank] = {
      primary: FACE_A.map((st, i) => primaryNodes(st, MERGE[Math.floor(i / 2)])),
      pair: MERGE.map((mx) => pairNodes(mx)),
      collector: collectorNodes(),
      runner: FACE_A.map((st) => IN_PROFILE.map(([a, o]) => [a, o, st])),
      injector: FACE_A.map((st) => injectorNodes(st)),
      rail: [[M.railAlong, M.railOut, -M.railX], [M.railAlong, M.railOut, M.railX]],
      shields: MERGE.map((mx) => [
        M.shieldA0, M.shieldA1, M.shieldOut0, M.shieldOut1,
        mx - M.shieldHalfX, mx + M.shieldHalfX,
      ]),
      // Mounting hardware, derived from the primary routing so the test can
      // measure against exactly what the renderer builds. The outer cylinder of
      // a pair (|station| 16.5) passes under its shield early; the inner one
      // (|station| 5.5) only reaches the shield footprint near its merge end,
      // so each needs its own grip parameter.
      bands: MERGE.flatMap((mx, k) => [2 * k, 2 * k + 1].map((i) => {
        const nodes = primaryNodes(B.stations[i], mx);
        const t = Math.abs(B.stations[i]) > Math.abs(mx) ? M.clampBandT[0] : M.clampBandT[1];
        const at = polyAt(nodes, t);
        return { at, dir: polyDirAt(nodes, t), shield: k, cyl: i };
      })),
      stands: MERGE.flatMap((mx, k) => {
        const shInner = M.shieldOut0;
        return [2 * k, 2 * k + 1].map((i) => {
          const nodes = primaryNodes(B.stations[i], mx);
          const t = Math.abs(B.stations[i]) > Math.abs(mx) ? M.clampBandT[0] : M.clampBandT[1];
          const p = polyAt(nodes, t);
          return {
            root: [p[0], p[1] + M.exPrimaryR + 0.1, p[2]],
            tip: [p[0], shInner + 0.2, p[2]],
            shield: k, cyl: i,
          };
        });
      }),
      // Rail brackets: cast lugs hanging off the plenum bar's lower face, big
      // enough to embrace the rail where it passes under the bar. Bounds are
      // min/max ordered: the bracket reaches from below the rail (o0) up past
      // the plenum face (o1, buried by bracketBite) and from beside the rail out
      // into the bar (a1).
      brackets: [
        [M.railAlong - M.bracketA, M.plenumA0 + M.bracketBite,
          M.railOut - M.railR - M.bracketDrop, M.plenumOut0 + M.bracketBite,
          M.bracketX[0], M.bracketX[1]],
        [M.railAlong - M.bracketA, M.plenumA0 + M.bracketBite,
          M.railOut - M.railR - M.bracketDrop, M.plenumOut0 + M.bracketBite,
          -M.bracketX[1], -M.bracketX[0]],
      ],
      // Weld ring joining each bracket to the rail it grips: its hoop plane sits
      // just inside the bracket's outboard face, so it is buried in the bracket
      // and wrapped around the rail at the same time.
      railClamps: [M.bracketX[1] - 0.15, -(M.bracketX[1] - 0.15)].map((bx) =>
        [[M.railAlong, M.railOut, bx - 0.5], [M.railAlong, M.railOut, bx + 0.5]]),
      mergeSign: sgn,
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------
export function createManifolds(materials) {
  const group = new THREE.Group();
  group.name = 'manifolds';
  const specs = manifoldSpecs();

  for (const bank of ['L', 'R']) {
    const ax = bankAxes(bank);
    const s = specs[bank];
    const exSub = new THREE.Group();
    exSub.name = `headers-${bank}`;
    const inSub = new THREE.Group();
    inSub.name = `intake-${bank}`;

    const beadEx = [];
    const beadIn = [];
    const bolts = [];
    const primaryCurves = [];
    for (let i = 0; i < B.stations.length; i++) {
      const st = B.stations[i];
      // ---- exhaust: flange plate on the outboard stay face, neck boss, primary
      const flG = flangePlate(bank, ax, M.exFlangeX, (M.exFlangeA1 - M.exFlangeA0) / 2,
        M.exFlangeT, M.exPortR, M.exFlangeR);
      put(flG, bank, PORT_A, OUT + M.exFlangeT / 2, st);
      exSub.add(mesh(`ex-flange-${bank}-${st}`, flG, materials.headerSteel, 'exFlange'));

      const neckG = portNeck(bank, ax, M.exNeckR, M.exPortR, M.exNeckT, ax.out);
      put(neckG, bank, PORT_A, OUT + M.exFlangeT, st);
      exSub.add(mesh(`ex-neck-${bank}-${st}`, neckG, materials.headerSteel, 'exNeck'));

      const nodes = s.primary[i];
      const curve = pipeCurve(nodes.map((n) => P(bank, n)));
      primaryCurves.push(curve);
      exSub.add(mesh(`primary-${bank}-${st}`, new THREE.TubeGeometry(curve, 56, M.exPrimaryR, 20, false),
        materials.headerSteel, 'exPrimary'));

      // weld the neck to the flange, and the primary to the neck.
      // The neck collar sits at out 8.6 on the neck barrel, not at the flange
      // root: a ring there would come within 0.76 cm of the head stay rib behind
      // it, and the routing rule keeps >= 1.2 cm of real air beside the casting.
      const axis = pipeCurve([P(bank, [PORT_A, OUT + M.exFlangeT + 0.5, st]), P(bank, [PORT_A, OUT + M.exFlangeT + 1.3, st])]);
      beadEx.push(weldBead(axis, 0.5, M.exNeckR + 0.15, 0.22));
      beadEx.push(weldBead(curve, 0.045, M.exPrimaryR + 0.2, 0.22));

      // ---- intake: mirror plate on the inboard head face, neck, runner
      const iflG = flangePlate(bank, ax, M.inFlangeX, (M.inFlangeA1 - M.inFlangeA0) / 2,
        M.inFlangeT, M.inPortR, M.inFlangeR);
      put(iflG, bank, PORT_A, -(OUT + M.inFlangeT / 2), st);
      inSub.add(mesh(`in-flange-${bank}-${st}`, iflG, materials.castAluminumIntake, 'inFlange'));

      const inNeck = portNeck(bank, ax, M.inNeckR, M.inPortR, M.inNeckT, ax.out.clone().negate());
      put(inNeck, bank, PORT_A, -(OUT + M.inFlangeT), st);
      inSub.add(mesh(`in-neck-${bank}-${st}`, inNeck, materials.castAluminumIntake, 'inNeck'));

      const rn = s.runner[i];
      const rcurve = pipeCurve(rn.map((n) => P(bank, n)));
      inSub.add(mesh(`runner-${bank}-${st}`, new THREE.TubeGeometry(rcurve, 48, M.inRunnerR, 20, false),
        materials.castAluminumIntake, 'inRunner'));
      // the runner's weld bead sits where it enters the plenum bar: the root of
      // the runner is inside the port neck, a ring there would rub the head's
      // inboard stay face behind it
      beadIn.push(weldBead(rcurve, 0.9, M.inRunnerR + 0.2, 0.22));

      // ---- injectors: from the rail up-outboard, nozzle inside its own runner
      const inj = s.injector[i];
      inSub.add(mesh(`injector-${bank}-${st}`,
        cylinderBetween(P(bank, inj[0]), P(bank, inj[2]), M.injR, 22),
        materials.anodized, 'injector'));
      // The clamp collar sits where the injector leaves the rail: it grips the
      // injector body and bears on the rail itself, so it is bolted hardware,
      // not a ring floating in the corridor.
      const dir = P(bank, inj[2]).sub(P(bank, inj[0])).normalize();
      const clampAt = M.railOut + M.railR + 0.25;
      const collarCentre = P(bank, inj[0]).clone().lerp(P(bank, inj[2]),
        (clampAt - inj[0][1]) / (inj[2][1] - inj[0][1]));
      // bored clamp ring: its bore bites 0.05 into the injector body, its outer
      // face bears against the rail, so it is a real fitting, not a decoration
      const collarG = lathe([
        [M.injR - 0.05, 0], [M.injR + 0.3, 0], [M.injR + 0.3, 0.5],
        [M.injR - 0.05, 0.5], [M.injR - 0.05, 0],
      ], 22);
      collarG.applyQuaternion(alignYTo(dir));
      const base = collarCentre.clone().addScaledVector(dir, -0.25);
      collarG.translate(base.x, base.y, base.z);
      inSub.add(mesh(`injector-collar-${bank}-${st}`, collarG, materials.fastenerSteel, 'injectorCollar'));

      // ---- flange bolts: one per pattern offset, per port, per side
      for (const off of M.boltOffsetsAlong) {
        const we = bankPoint(bank, PORT_A + off, OUT + M.exFlangeT, st);
        const wi = bankPoint(bank, PORT_A + off, -(OUT + M.inFlangeT), st);
        bolts.push({ p: [we.x, we.y, we.z], dir: ax.out.clone().negate().toArray() });
        bolts.push({ p: [wi.x, wi.y, wi.z], dir: ax.out.toArray() });
      }
    }

    // ---- pair outlets and the merged collector
    for (let k = 0; k < MERGE.length; k++) {
      const mx = MERGE[k];
      const nodes = s.pair[k];
      const c = pipeCurve(nodes.map((n) => P(bank, n)));
      exSub.add(mesh(`pair-${bank}-${mx}`, new THREE.TubeGeometry(c, 40, M.exPairR, 22, false),
        materials.headerSteel, 'exPair'));
      beadEx.push(weldBead(c, 0.92, M.exPairR + 0.2, 0.22));
    }
    const cc = pipeCurve(s.collector.map((n) => P(bank, n)));
    exSub.add(mesh(`collector-${bank}`, new THREE.TubeGeometry(cc, 64, M.exCollectorR, 24, false),
      materials.headerSteel, 'exCollector'));
    beadEx.push(weldBead(cc, 0.985, M.exCollectorR + 0.22, 0.24));

    // bolt-on collector outlet: a disc plus its short stub, on the collector axis
    const end = P(bank, s.collector.at(-1));
    const tan = cc.getTangentAt(1).normalize();
    const disc = cylinderBetween(end, end.clone().add(tan.multiplyScalar(M.exOutletT)), M.exOutletR, 30);
    const stub = cylinderBetween(end.clone().add(tan.multiplyScalar(M.exOutletT)),
      end.clone().add(tan.clone().multiplyScalar(M.exOutletT + 1.6)), M.exCollectorR - 0.35, 26);
    exSub.add(mesh(`outlet-${bank}`, mergeGeometries([disc, stub], false), materials.headerSteel, 'exOutletFlange'));

    // ---- heat shields over the primaries, each gripped by clamp bands on the
    // pair of primaries it covers, each band carrying a stand-off bolted to the
    // shield face. A shield that bolts to nothing is a floating panel.
    s.shields.forEach((sh, k) => {
      const g = boxInBank(bank, sh[0], sh[1], sh[2], sh[3], sh[4], sh[5], 0.35);
      exSub.add(mesh(`ex-shield-${bank}-${k}`, g, materials.heatShield, 'exShield'));
    });
    s.bands.forEach((b) => {
      const p = P(bank, b.at);
      const d = ax.up.clone().multiplyScalar(b.dir[0])
        .addScaledVector(ax.out, b.dir[1])
        .addScaledVector(X, b.dir[2]);
      const grip = pipeCurve([p, p.clone().add(d)]);
      exSub.add(mesh(`clamp-band-${bank}-${b.shield}-${b.cyl}`,
        weldBead(grip, 0.5, M.clampBandR, M.clampBandTube), materials.standSteel, 'clampBand'));
    });
    s.stands.forEach((st) => {
      exSub.add(mesh(`shield-stand-${bank}-${st.shield}-${st.cyl}`,
        cylinderBetween(P(bank, st.root), P(bank, st.tip), M.shieldStayR, 18), materials.standSteel, 'shieldStay'));
    });

    beadEx.forEach((g, i) => exSub.add(mesh(`ex-bead-${bank}-${i}`, g, materials.weldBead, 'exBead')));
    beadIn.forEach((g, i) => inSub.add(mesh(`in-bead-${bank}-${i}`, g, materials.weldBead, 'inBead')));

    // ---- plenum bar in the V, fuel rail below it, brackets holding the rail
    inSub.add(mesh(`plenum-${bank}`, boxInBank(bank, M.plenumA0, M.plenumA1, M.plenumOut0, M.plenumOut1,
      -M.plenumX, M.plenumX, M.plenumR), materials.castAluminumIntake, 'inPlenum'));
    inSub.add(mesh(`rail-${bank}`, cylinderBetween(P(bank, s.rail[0]), P(bank, s.rail[1]), M.railR, 24),
      materials.aluTube, 'rail'));
    s.brackets.forEach((br) => {
      const key = br[4] > 0 ? br[4] : br[5];
      inSub.add(mesh(`rail-bracket-${bank}-${key}`,
        boxInBank(bank, br[0], br[1], br[2], br[3], br[4], br[5], 0.2),
        materials.castAluminumIntake, 'bracket'));
    });
    s.railClamps.forEach((c) => {
      const curve = pipeCurve(c.map((n) => P(bank, n)));
      inSub.add(mesh(`in-bead-${bank}-clamp-${c[0][2]}`, weldBead(curve, 0.5, M.railR + 0.24, 0.26),
        materials.weldBead, 'inBead'));
    });

    const bm = instancedBolts(bolts, boltGeometry(1.15 * 2, 0.62, 0.34, 1.3), materials.fastenerSteel, null);
    bm.name = `flange-bolts-${bank}`;
    bm.userData.kind = 'bolt';

    group.add(exSub, inSub, bm);
  }

  group.updateMatrixWorld(true);
  return { group, update: () => {} };
}
