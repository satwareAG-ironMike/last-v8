// Cylinder heads: two aluminium castings standing on the block deck through a
// compressed copper head gasket. The deck rails carry the 48 head bolts and the
// gasket clamping load; each casting carries the 36 cam bearing bosses (bore =
// bearing OD + 0.05 running clearance), the bearing caps and clamps, ten cam
// girder bridges, the bucket guide bores, the machined spring-seat floors, the
// spring tubes, the valve guides and the hardened seat inserts exactly on the
// timing.js seat/axis points, plus four bolt-on cam covers whose ceiling clears
// every rotating lobe nose. Every dimension derives from src/engine/spec.js and
// src/engine/timing.js: this is not decoration, it is the structure the
// valvetrain actually rides on. Pinned by test/heads.test.mjs.
//
// Bank-local frame: `along` up the bore axis, `out` outboard (away from the V),
// world X = crank axis. The head faces stay 0.05 inboard of the sprocket band
// so the cam journals can carry the four chain sprockets outside the casting.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SPEC, STATION_JOINTS_X, bankPoint, bankUp, camAxisBank, HEAD_TOP_A } from '../engine/spec.js';
import { camAxisPoint, valveAxisDir, valveSeatPoint } from '../engine/timing.js';
import { boxInBank, latheBank, latheX } from './parts.js';
import { alignYTo, boltGeometry, instancedBolts } from './primitives.js';

const H = SPEC.head;
const B = SPEC.block;
const CAM = SPEC.cam;

const FACE = B.deckA + H.gasketT; // 24.25 head deck face, above the compressed gasket
const RAIL = H.railTopA; // 27.0 machined clamping plane the head bolts stand on
const CAM_A = camAxisBank('L', 'intake')[0]; // cam axis `along`, identical for both lines
const BAND = SPEC.crank.sprocket.x0; // first cam chain sprocket plane
// fore/aft head faces: 0.05 inboard of the sprocket band, so the casting never
// enters the chain plane and the outermost bearing column still reaches it.
const EDGE = BAND - 0.05;
// The fore cam bearing (38.5 + 1.1) ends at the sprocket band, so the boss face
// IS the machined shoulder the sprocket locates against: only the bearing
// column may reach that plane, the rest of the casting stops at EDGE.
const SHOULDER = BAND;
const DECK_X0 = -B.stations[0] - B.pitch / 2; // block deck ends
const DECK_X1 = B.stations[0] + B.pitch / 2;
// The exhaust pair merges sit midway between the two stations of each pair.
// Mid bulkheads are cast there: the two primaries of a pair run in one runner.
const MERGE_X = B.stations.filter((_, i) => i % 2 === 1).map((s) => s + B.pitch / 2);
const valves = ['intake', 'exhaust'];
const ref = (bank) => SPEC.cylinders.find((c) => c.bank === bank); // the station-0 cylinder

// casting top planes, all derived from the cam axis rather than invented
const WEB_TOP = CAM_A - 2.55; // 33.045 cam column tops, just under the boss belt
const PORT_TOP = CAM_A - 3.4; // 32.195 exhaust port bulkheads, clear of every boss
const STAY_TOP = 30.0; // deck ribs under the bucket towers
const CAP_TOP = CAM_A + 3.095; // 38.69 machined cover bolt-on plane above each boss
const COVER_CEIL = HEAD_TOP_A - H.coverPlate; // 39.895 cover ceiling: clears the lobe sweep
// Bearing clamps sit below the cam line: their innermost corner stays outside
// the 2.10 machined boss bore and clears the 1.75 journal by more than 0.7.
const CLAMP_A0 = CAM_A - 3.2;
const CLAMP_A1 = CAM_A - 2.3;

const clampX = (x0, x1) => [Math.max(x0, -SHOULDER), Math.min(x1, SHOULDER)];

/** Solid of revolution about a timing.js valve axis, profile [radius, s along axis]. */
function latheValve(cyl, valve, pairs) {
  const dir = new THREE.Vector3().fromArray(valveAxisDir(cyl, valve));
  const seat = valveSeatPoint(cyl, valve);
  const g = new THREE.LatheGeometry(pairs.map(([r, s]) => new THREE.Vector2(r, s)), 40);
  g.applyQuaternion(alignYTo(dir));
  g.translate(seat.x, seat.y, seat.z);
  return g;
}

function mesh(name, geometry, material, kind, userData = {}) {
  const m = new THREE.Mesh(geometry, material);
  m.name = name;
  m.castShadow = true;
  m.receiveShadow = true;
  m.userData = { kind, ...userData };
  return m;
}

/** Four head bolts per cylinder, straddling the gasket band, on the rails. */
export function headBoltSpecs() {
  const specs = [];
  for (const bank of ['L', 'R']) {
    const u = bankUp(bank);
    for (const st of B.stations) {
      for (const xo of [-H.boltXOff, H.boltXOff]) {
        for (const o of [-H.boltOut, H.boltOut]) {
          const w = bankPoint(bank, RAIL, o, st + xo);
          specs.push({ bank, p: [w.x, w.y, w.z], dir: [-u[0], -u[1], -u[2]], s: 1 });
        }
      }
    }
  }
  return specs; // 4 * cylinders
}

function headCasting(bank, materials) {
  const head = new THREE.Group();
  head.name = `head-${bank}`;
  const add = (name, geometry, material, kind, userData) =>
    head.add(mesh(name, geometry, material, kind, userData));
  const rib = materials.castAluminumHead;

  // 1. deck rails: machined clamping surfaces each side of the bore row
  add(`rail-${bank}-out`, boxInBank(bank, FACE, RAIL, H.gasketId, H.gasketOd, DECK_X0, DECK_X1, 0.3),
    rib, 'rail');
  add(`rail-${bank}-in`, boxInBank(bank, FACE, RAIL, -H.gasketOd, -H.gasketId, DECK_X0, DECK_X1, 0.3),
    rib, 'rail');

  // 2. bulkheads: the fore/aft end walls close the casting over the end cam
  //    bearings, the mid webs are the exhaust port runners where two primaries
  //    join - their outboard faces are the header flange planes.
  const chimneys = [
    [`chimney-${bank}-fore`, DECK_X1 - 2.0, EDGE, -7.95, 7.95],
    [`chimney-${bank}-aft`, -EDGE, -DECK_X1 + 2.0, -7.95, 7.95],
    ...MERGE_X.map((mx) => [`chimney-${bank}-m${mx}`, mx - 2.0, mx + 2.0, 6.45, 7.95]),
  ];
  for (const [name, x0, x1, o0, o1] of chimneys) {
    add(name, boxInBank(bank, FACE, PORT_TOP, o0, o1, x0, x1, 0.3), rib, 'chimney');
  }

  // 3. bucket-tower ribs: each cylinder stands on an outboard rail rib and a
  //    mirror rib on the V-centre side; these carry the cored bucket bores.
  for (const st of B.stations) {
    add(`stay-${bank}-out-${st}`, boxInBank(bank, FACE, STAY_TOP, H.gasketId, H.gasketOd,
      st - 1.7, st + 1.7, 0.2), rib, 'stay');
    add(`stay-${bank}-in-${st}`, boxInBank(bank, FACE, STAY_TOP, -H.gasketOd, -H.gasketId,
      st - 1.7, st + 1.7, 0.2), rib, 'stay');
  }

  // 4. cam bearing columns, one per cam bearing on the cam axis line: a merged web
  //    (crossbar + two legs straddling the bore), the machined boss, its cap
  //    and two bearing clamps.
  for (const valve of valves) {
    const O = camAxisBank(bank, valve)[1];
    const cap = camAxisPoint(ref(bank), valve);
    for (const bx of CAM.bearings) {
      const [x0, x1] = clampX(bx - 1.25, bx + 1.25);
      const leg = (o0, o1) => boxInBank(bank, 30.0, WEB_TOP, o0, o1, x0, x1, 0.2);
      add(`bossweb-${bank}-${valve}-${bx}`, mergeGeometries([
        boxInBank(bank, FACE, WEB_TOP, O - 1.25, O + 1.25, x0, x1, 0.25),
        leg(O + 0.6, O + 1.25),
        leg(O - 1.25, O - 0.6),
      ], false), rib, 'bossweb', { bx, valve });

      const r0 = CAM.bearingR + H.bossClr; // 2.10 machined bearing bore
      const r1 = r0 + 0.75; // 2.85 boss OD
      const boss = latheX([[r0, x0], [r1, x0], [r1, x1], [r0, x1], [r0, x0]]);
      boss.translate(0, cap.y, cap.z);
      add(`boss-${bank}-${valve}-${bx}`, boss, rib, 'boss', { bx, valve });

      add(`cap-${bank}-${valve}-${bx}`, boxInBank(bank, CAP_TOP - 0.95, CAP_TOP,
        O - 2.75, O + 2.75, x0, x1, 0.2), rib, 'cap', { bx, valve });

      for (const s of [1, -1]) {
        add(`clamp-${bank}-${valve}-${bx}-${s > 0 ? 'o' : 'i'}`,
          boxInBank(bank, CLAMP_A0, CLAMP_A1, s * (O + 1.1), s * (O + 2.7), x0, x1, 0.15),
          rib, 'clamp', { bx, valve });
      }
    }

    // 5. cam girder bridges tie adjacent bearing columns together at the cap
    //    row - the only belt high enough to clear the 1.75 journal, so it is
    //    kept strictly inside the lobe-free x window around each interior joint
    //    (test/heads.test.mjs proves no bridge box touches a lobe box).
    const bridgeHalf = B.pitch / 2 - H.camLobeWidth / 2 - 0.55;
    for (const [i, j] of STATION_JOINTS_X.entries()) {
      const s = Math.sign(O);
      add(`bridge-${bank}-${valve}-${i}`, boxInBank(bank, CAP_TOP - 0.95, CAP_TOP,
        O + s * 1.2, O + s * 2.4, j - bridgeHalf, j + bridgeHalf, 0.2), rib, 'bridge');
    }
  }

  // 6. valve-row hardware per cylinder: seat insert on the seat plane, guide,
  //    machined spring-seat floor exactly where the springs sit, spring tube,
  //    bucket bore collar. All coax with the timing.js valve axis. Every lathe
  //    profile is CLOSED by repeating its first point (parts.js convention) -
  //    an open profile would show as a hole in the bore under cutaway.
  const closed = (pairs) => [...pairs, pairs[0]];
  for (const cyl of SPEC.cylinders.filter((c) => c.bank === bank)) {
    for (const valve of valves) {
      // Hardened seat insert: a thin OD ring (its outboard edge must stay
      // inside the 5.1 bore tunnel where it droops below the deck) with a
      // pilot boss that presses into the guide bore.
      const seatOd = valve === 'intake' ? 2.85 : 2.6;
      add(`seat-cyl${cyl.num}-${valve}`, latheValve(cyl, valve, closed([
        [1.05, 0], [seatOd, 0], [seatOd, 0.18], [1.6, 0.35], [1.6, 0.7], [1.05, 0.7],
      ])), valve === 'intake' ? materials.valveIntake : materials.valveExhaust, 'seatRing');

      add(`guide-cyl${cyl.num}-${valve}`, latheValve(cyl, valve, closed([
        [H.guideBoreR, 0.4], [1.05, 0.4], [1.05, 3.4], [H.guideBoreR, 3.4],
      ])), materials.bearingShell, 'guide');

      add(`springfloor-cyl${cyl.num}-${valve}`, latheValve(cyl, valve, closed([
        [1.05, H.guideLength - H.floorT], [3.05, H.guideLength - H.floorT],
        [3.05, H.guideLength], [1.05, H.guideLength],
      ])), rib, 'floor');

      add(`springtube-cyl${cyl.num}-${valve}`, latheValve(cyl, valve, closed([
        [1.9, H.guideLength], [2.2, H.guideLength], [2.2, 5.75], [1.9, 5.75],
      ])), rib, 'springtube');

      // the bore is machined straight through from the spring seat to above the
      // bucket skirt at full lift; this mesh is the wall the flange rides in
      add(`bucketbore-cyl${cyl.num}-${valve}`, latheValve(cyl, valve, closed([
        [H.bucketBoreR, 5.75], [3.15, 5.75], [3.15, 6.95], [H.bucketBoreR, 6.95],
      ])), rib, 'bucketbore',
      { boreR: H.bucketBoreR, boreS0: H.guideLength, boreS1: 9.25 });
    }
  }
  return head;
}

/** Bolt-on cam cover: plate + four walls, feet machined onto the bearing caps. */
function camCover(bank, valve, materials) {
  const cover = new THREE.Group();
  cover.name = `cam-cover-${bank}-${valve}`;
  const O = camAxisBank(bank, valve)[1];
  const put = (name, geometry) => cover.add(mesh(name, geometry, materials.castAluminumHead, 'cover'));
  const [x0, x1] = [-(EDGE - 0.5), EDGE - 0.5]; // walls stand in from the end faces

  put('plate', boxInBank(bank, COVER_CEIL, HEAD_TOP_A, O - 2.75, O + 2.75, -EDGE, EDGE, 0.3));
  put('wall-out', boxInBank(bank, CAP_TOP, COVER_CEIL, O + 2.05, O + 2.75, x0, x1, 0.2));
  put('wall-in', boxInBank(bank, CAP_TOP, COVER_CEIL, O - 2.75, O - 2.05, x0, x1, 0.2));
  put('wall-fore', boxInBank(bank, CAP_TOP, COVER_CEIL, O - 2.75, O + 2.75, x1, EDGE, 0.2));
  put('wall-aft', boxInBank(bank, CAP_TOP, COVER_CEIL, O - 2.75, O + 2.75, -EDGE, -x1, 0.2));
  cover.userData.ceilingA = COVER_CEIL;
  return cover;
}

export function createHeads(materials) {
  const group = new THREE.Group();
  group.name = 'heads';

  for (const bank of ['L', 'R']) {
    group.add(headCasting(bank, materials));

    // copper head gaskets: four compression rings standing on the block deck,
    // bore ID clear of the piston at TDC, OD under the deck rails. Each ring is
    // a solid of revolution about its own bore axis at the cylinder station.
    const gasket = new THREE.Group();
    gasket.name = `gasket-${bank}`;
    for (const st of B.stations) {
      const ring = latheBank(bank, [
        [H.gasketId, B.deckA], [H.gasketOd, B.deckA],
        [H.gasketOd, FACE], [H.gasketId, FACE],
      ], 48, st);
      gasket.add(mesh(`gasket-cyl-${bank}-${st}`, ring, materials.copperGasket, 'gasket'));
    }
    group.add(gasket);

    for (const valve of valves) group.add(camCover(bank, valve, materials));
  }

  const bolts = instancedBolts(
    headBoltSpecs(),
    boltGeometry(2 * H.deckBoltRadius, 1.0, 0.58, 2.9),
    materials.fastenerSteel,
    group
  );
  bolts.name = 'head-bolts';
  bolts.userData.kind = 'bolt';

  group.updateMatrixWorld(true);
  return { group, update: () => {} };
}
