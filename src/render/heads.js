// Cylinder heads: two aluminium castings standing on the block deck through a
// compressed copper head gasket. The deck rails carry the 32 head bolts and the
// gasket clamping load; each casting carries the 28 split, line-bored cam bearing
// columns (A1-G7): a cradle half cast integral with the head, a cap half bolted onto
// a drilled tab pair, and a replaceable bearing shell with an oil hole inside each
// half - all machined to the one published line bore from src/engine/bearings.js.
// The closed 360-degree boss, its web, its clamps and the cam girder bridges that
// used to carry the cam are gone: no crown-side girder stands along the tunnel,
// because one would block either the cap lift path or the wrench at a cap bolt.
// The bucket guide bores, the machined spring-seat floors, the
// spring tubes, the valve guides and the hardened seat inserts exactly on the
// timing.js seat/axis points, plus four bolt-on cam covers whose ceiling clears
// every rotating lobe nose. Every dimension derives from src/engine/spec.js and
// src/engine/timing.js: this is not decoration, it is the structure the
// valvetrain actually rides on. Pinned by test/heads.test.mjs.
//
// Bank-local frame: `along` up the bore axis, `out` outboard (away from the V),
// world X = crank axis. The head faces stay at |x| <= 28.55 so the cam journals
// carry the four chain sprockets (band starts at 28.6) outside the casting.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  SPEC, BANKS, DEG, bankPoint, bankOut, bankUp, camAxisBank, HEAD_TOP_A,
} from '../engine/spec.js';
import { bearingStack } from '../engine/bearings.js';
import { ohvPushrods, variantEntry, ohvRockerLayout } from '../engine/layout.js';
import { camAxisPoint, valveAxisDir, valveSeatPoint } from '../engine/timing.js';
import { boxInBank, latheBank, latheX } from './parts.js';
import {
  alignYTo, boltGeometry, circleHole, extrude, instancedBolts, roundedRectShape,
} from './primitives.js';

const H = SPEC.head;
const B = SPEC.block;
const CAM = SPEC.cam;
const V = SPEC.valves;

const FACE = B.deckA + H.gasketT; // 24.25 head deck face, above the compressed gasket
const RAIL = H.railTopA; // 27.0 machined clamping plane the head bolts stand on
const CAM_A = camAxisBank('L', 'intake')[0]; // cam axis `along`, identical for both lines
const EDGE = 28.55; // fore/aft head faces: inboard of the sprocket band
const BAND = SPEC.crank.sprocket.x0; // 28.6: first cam chain sprocket plane
// The fore cam bearing (27.5 + 1.1) ends exactly at the sprocket band, so the
// column face IS the machined shoulder the sprocket locates against: only the
// bearing column may reach that plane, the rest of the casting stops at EDGE.
const SHOULDER = BAND;
const DECK_X0 = B.stations[3] - B.pitch / 2; // -22: block deck ends
const DECK_X1 = B.stations[0] + B.pitch / 2; //  22
const valves = ['intake', 'exhaust'];
const ref = (bank) => SPEC.cylinders.find((c) => c.bank === bank); // the station-0 cylinder

// casting top planes, all derived from the cam axis and the published bearing stack
const ST = bearingStack(); // src/engine/bearings.js: journal -> film -> shell -> bore -> casting -> tab
const WEB_TOP = CAM_A - ST.castOdR; // 33.18 cam column tops: the casting tops out at the tunnel
const PORT_TOP = CAM_A - 3.4; // 32.195 exhaust port bulkheads, clear of every column
const STAY_TOP = H.stayTopA; // 30.0 deck ribs under the bucket towers
const CAP_TOP = CAM_A + ST.castOdR; // 38.78 machined plane at the top of the split caps
const COL_W = CAM.bearingHalf; // column width: the machined bore spans exactly the bearing
// Each column stands on its own cast cam bearing housing: a deck-side web whose top
// face is embedded HOUSING_FUSE into the column's casting OD (so the column is fused
// cast material, not a part resting on it), a tie rib running out from that web on the
// deck side of the split plane, and a housing riser each side of the cam axis line. A
// riser stands past the wrench swept around a cap bolt head (ST.housingInRel in
// src/engine/bearings.js), so a socket turns freely at every cap bolt, and its top face
// at CAP_TOP is the machined plane the cam cover bolts down onto. Nothing of a housing
// reaches inside the line bore: a column holding material inside its own bore is a
// bushing, not a bearing.
const HOUSING_FUSE = 0.10; // web top face embedded into the column OD band
const HOUSING_TOP = WEB_TOP + HOUSING_FUSE; // 33.28 top of the deck-side web under the tunnel
const HOUSING_IN = H.gasketId + 0.1; // base inboard edge: clear of the gasket inner band
const HOUSING_OUT = H.gasketOd; // base outboard edge: the machined head face the
// exhaust flanges stand on (SPEC.manifold.exFlangeT lands on exactly this plane)
const HOUSING_RIB0 = SPEC.manifold.exFlangeA1 + 0.2; // 29.8: a housing tie rib starts
// above the top edge of the exhaust flange it runs past, and clear of the port necks
const HOUSING_W = COL_W + 0.4; // half width of a housing along the cam axis
// The cover walls stand on the housing riser top faces, inset from the riser edges, so
// the cover is a bolt-on shroud seated on cast material and carries no load.
const COVER_INSET = 0.1;
const COVER_WALL_IN = ST.housingInRel + COVER_INSET;
const COVER_WALL_OUT = COVER_WALL_IN + 0.3;
const COVER_CEIL = HEAD_TOP_A - H.coverPlate; // cover ceiling: clears the lobe sweep
// Half-arc sampling: a 32-segment absarc at a 2.05 bore sags 0.0024 cm, and the A1-G7
// laws call two faces line-bored to one radius within 0.006 cm. These outlines are
// sampled at the same resolution, so the machined face IS the drawn face.
const ARC_SEGS = 32;


/**
 * Machined solid built from an outline in the bank frame. The outline points and holes
 * are given as (p, q) components along the two requested shape directions; the helper
 * picks the bank's right-handed basis and mirrors the outline with the basis when the
 * bank needs the other axis order - which is what keeps normals outward, the same
 * handedness rule parts.js bankFrame follows. No boolean geometry exists here: a hole
 * drawn in the outline is machined along the extrusion direction, so the direction is
 * chosen per part and never left to convenience.
 *
 * `place` is what puts the solid where the engine says it stands: the outline is drawn
 * around the cam axis LINE, so `place.axial` is the window along the extrusion direction
 * and `place.line` is where that line sits in the bank frame. Extrusion output is
 * centred on the local origin, so without this a bored ring would sit centred on the
 * world origin instead of on its bearing station.
 */
function machined(bank, dirP, dirQ, extrudeDir, pts, holes = [], place = {}, curveSegments = 1) {
  let basis = [dirP, dirQ, extrudeDir];
  let swapped = false;
  let m = new THREE.Matrix4().makeBasis(...basis);
  if (m.determinant() < 0) {
    basis = [dirQ, dirP, extrudeDir];
    swapped = true;
    m = new THREE.Matrix4().makeBasis(...basis);
  }
  if (m.determinant() < 0) throw new Error(`machined: no right-handed basis for bank ${bank}`);
  const at = (p, q) => (swapped ? [q, p] : [p, q]);
  const shape = new THREE.Shape();
  pts.forEach(([p, q], i) => {
    const [x, y] = at(p, q);
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  });
  shape.closePath();
  for (const [p, q, r] of holes) { const [x, y] = at(p, q); shape.holes.push(circleHole(x, y, r, false)); }
  const [a0, a1] = place.axial;
  const g = extrude(shape, a1 - a0, { bevel: 0, curveSegments });
  g.applyMatrix4(m);
  const off = extrudeDir.clone().multiplyScalar((a0 + a1) / 2);
  const [lx, ly] = at(...(place.offset ?? [0, 0]));
  off.addScaledVector(basis[0], lx).addScaledVector(basis[1], ly);
  if (place.line) {
    off.add(new THREE.Vector3().fromArray(bankUp(bank)).multiplyScalar(place.line.along)
      .addScaledVector(new THREE.Vector3().fromArray(bankOut(bank)), place.line.out));
  }
  g.translate(off.x, off.y, off.z);
  return g;
}

const XHAT = () => new THREE.Vector3(1, 0, 0);
const bankUpV = (bank) => new THREE.Vector3().fromArray(bankUp(bank));
const bankOutV = (bank) => new THREE.Vector3().fromArray(bankOut(bank));

const polar = (r, psiDeg) => [r * Math.cos(psiDeg * DEG), r * Math.sin(psiDeg * DEG)]; // [along, out]

/**
 * Machined half ring: one half of a split cam tunnel, from the line bore out to the
 * casting OD, bored along the crank axis. psi is measured the way the A1-G7 laws measure
 * it: psi = atan2(out, along), 0 crown-ward, 180 deck-ward, so the split plane through
 * the cam axis is exactly psi = +/-90 and the two halves cannot overlap. `line` is the
 * cam axis line this half ring is bored around.
 */
function halfRing(bank, line, rIn, rOut, psi0, psi1, x0, x1) {
  const pts = [];
  for (let i = 0; i <= ARC_SEGS; i++) pts.push(polar(rOut, psi0 + (psi1 - psi0) * i / ARC_SEGS));
  for (let i = 0; i <= ARC_SEGS; i++) pts.push(polar(rIn, psi1 - (psi1 - psi0) * i / ARC_SEGS));
  // outline components are (out, along): the shape axes the bore is machined against
  const ordered = pts.map(([a, o]) => [o, a]);
  return machined(bank, bankOutV(bank), bankUpV(bank), XHAT(), ordered, [],
    { axial: [x0, x1], line });
}

/**
 * Bolt tab: a pad machined along the split-plane normal and drilled along that same
 * normal, so the cap bolt runs through a real drilling. Both tabs stand tabInset clear
 * of the split plane: the line bore is machined by its own cutter, the bolt holes are a
 * separate operation, exactly as a head is machined. Out is measured off the cam axis
 * line, x along the crank axis.
 */
function tabPad(bank, line, bx, side, crown) {
  const a0 = crown ? ST.tabInset : -(ST.tabInset + ST.tabH);
  const a1 = crown ? ST.tabInset + ST.tabH : -ST.tabInset;
  const x0 = bx - ST.tabHalf, x1 = bx + ST.tabHalf;
  const o0 = side * ST.boreR, o1 = side * ST.tabR;
  const pts = [[x0, o0], [x1, o0], [x1, o1], [x0, o1]];
  const holes = [[(x0 + x1) / 2, side * ST.boltOutRel, ST.boltHoleR]];
  return machined(bank, XHAT(), bankOutV(bank), bankUpV(bank), pts, holes,
    { axial: [a0, a1], line }, 14);
}

/**
 * One radial cut of a bearing shell: a slab extruded along the radial direction, so a
 * circle in its outline is a radial through-drill. An axially extruded shell cannot carry
 * one at all - a notch there would cut the shell in half instead of drilling it. The cut
 * spans cutDeg of azimuth each side of psi and halfAxial each side of the bearing centre,
 * and its outer face stands at rFace so its corner lands exactly on the line bore radius.
 */
function radialFacet(bank, line, bx, psi, cutDeg, halfAxial, rIn, rFace, drilled) {
  const halfTang = Math.sin(cutDeg * DEG) * ((rIn + rFace) / 2);
  const pts = [[-halfAxial, -halfTang], [halfAxial, -halfTang], [halfAxial, halfTang], [-halfAxial, halfTang]];
  const holes = drilled ? [[0, 0, ST.oilHoleR]] : [];
  const up = bankUpV(bank);
  const out = bankOutV(bank);
  const d = up.clone().multiplyScalar(Math.cos(psi * DEG)).addScaledVector(out, Math.sin(psi * DEG)).normalize();
  const tang = d.clone().cross(XHAT()); // (X-hat, d x X-hat, d) is right-handed for either bank
  return { geo: machined(bank, XHAT(), tang, d, pts, holes,
    { axial: [rIn, rFace], offset: [bx, 0], line }, 14), dir: d };
}

/** Solid of revolution about a timing.js valve axis, profile [radius, s along axis]. */
function latheValve(cyl, valve, pairs) {
  const dir = new THREE.Vector3().fromArray(valveAxisDir(cyl, valve));
  const seat = valveSeatPoint(cyl, valve);
  const g = new THREE.LatheGeometry(pairs.map(([r, s]) => new THREE.Vector2(r, s)), 40);
  g.applyQuaternion(alignYTo(dir));
  g.translate(seat.x, seat.y, seat.z);
  return g;
}

/**
 * mergeGeometries needs compatible attributes: the extruded outlines are indexed and
 * boxInBank is not, so everything that is merged into one machined part is converted
 * here first. A merged part is one machined solid, which is what the A1-G7 laws count.
 */
const forMerge = (g) => (g.index ? g.toNonIndexed() : g);

function mesh(name, geometry, material, kind, userData = {}) {
  const m = new THREE.Mesh(geometry, material);
  m.name = name;
  m.castShadow = true;
  m.receiveShadow = true;
  m.userData = { kind, ...userData };
  return m;
}

/** The 32 head bolts: four per cylinder, straddling the gasket band, on the rails. */
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
  return specs; // 32
}

/**
 * A bulkhead standing between the deck face and its top plane, bored at the given
 * port axes. Built as a profile in the (x, along) plane extruded along `out`, so
 * every hole is a tunnel through the web's own thickness.
 */
function boredWeb(bank, a0, a1, o0, o1, x0, x1, holes) {
  const u = new THREE.Vector3().fromArray(bankUp(bank));
  const o = new THREE.Vector3().fromArray(bankOut(bank));
  const flip = new THREE.Vector3().crossVectors(u, o).x < 0 ? -1 : 1;
  const shape = roundedRectShape(x1 - x0, a1 - a0, 0.3);
  for (const h of holes)
    shape.holes.push(circleHole(h.x - (x0 + x1) / 2, h.along - (a0 + a1) / 2, h.r));
  const g = extrude(shape, o1 - o0, { bevel: 0, curveSegments: 24 });
  g.translate(0, 0, (o0 + o1) / 2);
  g.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), u.multiplyScalar(flip), o));
  g.computeVertexNormals();
  return g;
}

function headCasting(bank, materials, camCarrier) {
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
  //    bearings, the two centre webs are the exhaust port runners between the
  //    cylinder stations - their outboard faces are the header flange planes.
  //    Their top face is the DOHC port plane. The OHV build machines it down to the
  //    plane its rocker shafts need room in: tmp/8k-free.mjs measured the centre webs
  //    standing 0.3181 cm INSIDE the exhaust shaft line and the end walls 0.6162 cm of
  //    air against it, both under the 0.78 cm a 0.48 cm bore plus a 0.30 cm wall needs.
  const portTop = camCarrier ? PORT_TOP : ohvRockerLayout().castingTopA;
  // Slice 8L-a (issue #46): in the OHV head the 16 pushrods stand between the
  // exhaust seats and the outboard stay face (tmp/8l-flange.mjs measured 2764
  // vertices of DOHC runner iron cutting a gallery wall at that plane), so this
  // variant's exhaust leaves through its own centre webs instead. Each web the
  // measured route reaches is BORED at the published exit - the same port neck
  // the header bolts to, machined through the web rather than bolted onto it.
  const E = camCarrier ? null : SPEC.variants.ohv.exhaust;
  for (const [name, x0, x1, o0, o1, mergeX] of [
    [`chimney-${bank}-fore`, DECK_X1 - 2.0, EDGE, -H.webOut1, H.webOut1, null],
    [`chimney-${bank}-aft`, -EDGE, -DECK_X1 + 2.0, -H.webOut1, H.webOut1, null],
    [`chimney-${bank}-mid1`, 9.0, 13.0, H.webOut0, H.webOut1, SPEC.manifold.exMergeX],
    [`chimney-${bank}-mid2`, -13.0, -9.0, H.webOut0, H.webOut1, -SPEC.manifold.exMergeX],
  ]) {
    const web = camCarrier || mergeX === null
      ? boxInBank(bank, FACE, portTop, o0, o1, x0, x1, 0.3)
      : boredWeb(bank, FACE, portTop, o0, o1, x0, x1,
        [{ x: mergeX, along: E.topA, r: SPEC.manifold.exNeckR }]);
    add(name, web, rib, 'chimney');
  }

  // 3. bucket-tower ribs: each cylinder stands on an outboard rail rib and a
  //    mirror rib on the V-centre side; these carry the cored bucket bores.
  for (const st of B.stations) {
    add(`stay-${bank}-out-${st}`, boxInBank(bank, FACE, STAY_TOP, H.gasketId, H.gasketOd,
      st - 1.7, st + 1.7, 0.2), rib, 'stay');
    add(`stay-${bank}-in-${st}`, boxInBank(bank, FACE, STAY_TOP, -H.gasketOd, -H.gasketId,
      st - 1.7, st + 1.7, 0.2), rib, 'stay');
  }

  // 3b. the pushrod gallery (slice 8L-a, issue #46): the iron the 16 pushrods are
  //     guided in. It stands in the one band of this casting the measured exhaust
  //     runner leaves free - from the runner's crown (SPEC.variants.ohv.exhaust.topA
  //     plus the port bore and the published cast wall) up to castingTopA, the plane
  //     the rocker shaft bores are machined to - and is bored at the 16 published
  //     lifter axes ohvPushrods() derives. Each bore keeps the published cast wall to
  //     the band's inboard and outboard faces, and no part of the gallery holds
  //     material inside its own bore: that would be a bushing, not a guide.
  if (!camCarrier) {
    const P = variantEntry('ohv').pushrod;
    const R = ohvPushrods();
    const own = R.rods.filter((r) => r.bank === bank);
    const axisOut = own[0].out;
    const bandA0 = own[0].bandFrom - own[0].bandLen / 2;
    const bandA1 = own[0].bandFrom + own[0].bandLen / 2;
    const bossR = P.boreRadius + P.castWall; // the guide hub the bore is machined in
    const x0 = Math.min(...own.map((r) => r.x)) - bossR;
    const x1 = Math.max(...own.map((r) => r.x)) + bossR;
    const u = new THREE.Vector3().fromArray(bankUp(bank));
    const o = new THREE.Vector3().fromArray(bankOut(bank));
    // Extruded along the bore axis, so the profile plane is (x, out) and every hole
    // is a tunnel parallel to `along`. The basis has to stay right-handed or the
    // normals invert: (out x along) has to point along +X.
    const flip = new THREE.Vector3().crossVectors(o, u).x < 0 ? -1 : 1;
    const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), o, u.clone().multiplyScalar(flip));
    const parts = [];
    for (const r of own) {
      const boss = new THREE.Shape();
      boss.absarc(r.x, axisOut, bossR, 0, Math.PI * 2, false);
      boss.holes.push(circleHole(r.x, axisOut, P.boreRadius));
      const g = extrude(boss, bandA1 - bandA0, { bevel: 0, curveSegments: 24 });
      g.translate(0, 0, flip * (bandA0 + bandA1) / 2);
      g.applyMatrix4(basis);
      parts.push(g);
    }
    // the spine that joins the hubs into one casting: two bars standing on the
    // bores' own tangent planes, so no part of the spine reaches into a bore
    for (const [i0, i1] of [[axisOut - bossR, axisOut - P.boreRadius], [axisOut + P.boreRadius, axisOut + bossR]])
      // BoxGeometry is indexed, ExtrudeGeometry is not: merge them in one form.
      parts.push(boxInBank(bank, bandA0, bandA1, i0, i1, x0, x1, 0).toNonIndexed());
    add(`pushrod-gallery-${bank}`, mergeGeometries(parts, false), rib, 'gallery',
      { bandA0, bandA1, bored: own.length, bossR });
  }

  // 4. the 14 cam bearing columns per bank: a split, line-bored tunnel machined to
  //    the one published line bore (src/engine/bearings.js), standing on the cam axis
  //    line. The cradle half is cast integral and bored on the deck side of one plane
  //    through that line; the cap half stands on the crown side of the same plane and
  //    comes straight off along its normal; a replaceable shell with a radial oil hole
  //    lines each half. Each column is carried by its own housing - a deck-side web
  //    fused into the column OD, tie ribs and a housing riser each side of the line
  //    that the cam cover bolts onto - and a replaceable shell lines each half. No part
  //    of a column holds material inside its own bore: that would be a bushing, not a
  //    bearing. userData.boltOn states which halves come off, and the A1-G7 laws measure
  //    that claim against the casting.
  const span = (a, b) => [Math.min(a, b), Math.max(a, b)];
  for (const valve of camCarrier ? valves : []) {
    const O = camAxisBank(bank, valve)[1];
    const sgn = Math.sign(O);
    const line = { along: CAM_A, out: O };
    // riser faces, absolute in the bank frame: housingInRel/housingOutRel are measured
    // off the cam axis line, so a riser stands at the line plus its own offset
    const outR = span(O + sgn * ST.housingInRel, O + sgn * ST.housingOutRel); // outboard
    const inR = span(O - sgn * ST.housingInRel, O - sgn * ST.housingOutRel); // inboard
    const base = [sgn * HOUSING_IN, sgn * HOUSING_OUT]; // under the bore, on the band
    for (const bx of CAM.bearings) {
      const x0 = bx - COL_W, x1 = bx + COL_W;
      const hx0 = Math.max(bx - HOUSING_W, -EDGE), hx1 = Math.min(bx + HOUSING_W, EDGE);

      // the split tunnel: one machined half ring each side of the split plane through
      // the cam axis line, both bored to the published line bore and topped at the
      // published casting OD, each spanning exactly the published bearing width
      add(`cradle-${bank}-${valve}-${bx}`,
        halfRing(bank, line, ST.boreR, ST.castOdR, 90, 270, x0, x1), rib, 'cradle', { bx, valve });
      add(`cap-${bank}-${valve}-${bx}`,
        halfRing(bank, line, ST.boreR, ST.castOdR, -90, 90, x0, x1), rib, 'cap',
        { bx, valve, boltOn: true });

      // the column's housing, one merged casting: a deck-side web directly under the
      // tunnel with its top face embedded into the column OD band, a tie rib running
      // out to each housing riser, and the risers themselves standing past the wrench
      // line at a cap bolt with their top face at CAP_TOP for the cover to bolt onto.
      const housing = mergeGeometries([
        boxInBank(bank, FACE, HOUSING_TOP, ...span(base[0], base[1]), hx0, hx1, 0.2),
        boxInBank(bank, HOUSING_RIB0, HOUSING_TOP, ...span(base[1], outR[0]), hx0, hx1, 0.2),
        boxInBank(bank, HOUSING_RIB0, HOUSING_TOP, ...span(inR[1], base[0]), hx0, hx1, 0.2),
        boxInBank(bank, HOUSING_TOP, CAP_TOP, ...outR, hx0, hx1, 0.2),
        boxInBank(bank, HOUSING_TOP, CAP_TOP, ...inR, hx0, hx1, 0.2),
      ].map(forMerge), false);
      add(`housing-${bank}-${valve}-${bx}`, housing, rib, 'housing', { bx, valve });

      // the tab pair: one pad on the cap half, one on the cradle half, each drilled
      // through along the split-plane normal for its cap bolt, mirrored to both sides
      // of the cam axis line. The cradle tab is machined out of the cradle itself -
      // its own boss, exactly as a crankcase web carries a main cap tab.
      for (const s of [1, -1]) {
        for (const crown of [true, false]) {
          add(`tab-${bank}-${valve}-${bx}-${crown ? 'cap' : 'cradle'}-${s > 0 ? 'o' : 'i'}`,
            tabPad(bank, line, bx, s, crown), rib, 'tab', { bx, valve, boltOn: crown });
        }
      }

      // the shell: a replaceable half shell pressed into each half of the tunnel. Its
      // outside face IS the line bore and its inside face is the journal plus the oil
      // film. Each half is bored full bearing width at its two end bands; the middle
      // band (ST.shellBandHalf) is where the oil way is machined, and because no CSG
      // exists here it is built from three radial cuts - the centre one carries the
      // published oil-hole drilling ALONG its own extrusion direction, so the oil way
      // is a drilled hole and not a notch that would cut the shell in half. The cut
      // corners are compensated to land exactly on the line bore radius.
      const mid = ST.shellBandHalf;
      const endIn = COL_W - mid; // end band runs from the column face to the drilled band
      const cutDeg = 5; // azimuth half width of one radial cut, neighbours overlap
      const rMid = (ST.shellIdR + ST.boreR) / 2;
      const chord = Math.sin(cutDeg * DEG) * rMid; // its tangential half width
      const rFace = Math.sqrt(ST.boreR ** 2 - chord ** 2); // so the corner hits the bore
      for (const [crown, psi0, psi1] of [[true, -90, 90], [false, 90, 270]]) {
        const oilPsi = crown ? ST.oilAz.cap[0] : ST.oilAz.cradle[0];
        const parts = [
          halfRing(bank, line, ST.shellIdR, ST.boreR, psi0, psi1, bx - COL_W, bx - endIn),
          halfRing(bank, line, ST.shellIdR, ST.boreR, psi0, psi1, bx + endIn, bx + COL_W),
          halfRing(bank, line, ST.shellIdR, ST.boreR, psi0, oilPsi - (ST.oilBandDeg - 1), bx - mid, bx + mid),
          halfRing(bank, line, ST.shellIdR, ST.boreR, oilPsi + (ST.oilBandDeg - 1), psi1, bx - mid, bx + mid),
          radialFacet(bank, line, bx, oilPsi, cutDeg, mid, ST.shellIdR, rFace, true).geo,
          radialFacet(bank, line, bx, oilPsi - 8, cutDeg, mid, ST.shellIdR, rFace, false).geo,
          radialFacet(bank, line, bx, oilPsi + 8, cutDeg, mid, ST.shellIdR, rFace, false).geo,
        ].map(forMerge);
        add(`shell-${bank}-${valve}-${bx}-${crown ? 'cap' : 'cradle'}`,
          mergeGeometries(parts, false), materials.bearingShell, 'shell',
          { bx, valve, boltOn: crown, oilAz: crown ? ST.oilAz.cap : ST.oilAz.cradle });
      }
    }
  }

  // 6. valve-row hardware per cylinder: seat insert on the seat plane, guide,
  //    machined spring-seat floor exactly where the springs sit, spring tube,
  //    bucket bore collar. All coax with the timing.js valve axis. Every lathe
  //    profile is CLOSED by repeating its first point (parts.js convention) -
  //    an open profile would show as a hole in the bore under cutaway.
  const closed = (pairs) => [...pairs, pairs[0]];
  // Ring outside diameters, every one derived from the bore it surrounds
  // (SPEC.head wall fields): a re-proportioned valve row moves these with it.
  const guideOd = H.guideBoreR + H.guideWall; // 1.05
  const pilotOd = guideOd + H.seatPilotClr; // 1.60
  const tubeId = V.springRadius + V.springWireRadius + H.springTubeClr; // 1.90 over the 1.57 coil OD
  const tubeOd = tubeId + H.springTubeWall; // 2.20
  // The floor is machined around the bore the follower stands in, so it is a
  // variant fact: only the DOHC variant has a bucket bore in its head. Slice 8K
  // took the 16 bucket-bore collars out of the OHV head - its follower is a lifter
  // standing in the block - so an OHV floor machined around a bucket bore it does
  // not have is the same defect, one ring later. tmp/8l-route.mjs ->
  // tmp/v8-8l-rowmatrix.out measured what inheriting it costs: with the DOHC floor
  // (2.5500) the published 0.9500 cm exhaust port bore is a legal swept duct in 9 of
  // 24000 candidates at the thinnest floor tested, worst clearance 0.3168 cm over the
  // 0.3000 cm cast wall; with the floor standing on this variant's own 1.9000 cm
  // machined spring bore (2.2000) it is legal in 87 candidates at every floor
  // thickness, worst clearance 0.6075 cm.
  const floorOd = camCarrier ? H.bucketBoreR + H.springFloorWall : tubeId + H.springFloorWall; // 2.55 / 2.20
  const collarOd = H.bucketBoreR + H.collarWall; // 2.80
  for (const cyl of SPEC.cylinders.filter((c) => c.bank === bank)) {
    for (const valve of valves) {
      // Hardened seat insert: a thin OD ring (its outboard edge must stay
      // inside the 5.1 bore tunnel where it droops below the deck) with a
      // pilot boss that presses into the guide bore.
      const seatOd = H.headDia[valve] / 2 - H.seatInsertInset[valve]; // 1.87 / 1.70
      add(`seat-cyl${cyl.num}-${valve}`, latheValve(cyl, valve, closed([
        [guideOd, 0], [seatOd, 0], [seatOd, 0.18], [pilotOd, 0.35], [pilotOd, 0.7], [guideOd, 0.7],
      ])), valve === 'intake' ? materials.valveIntake : materials.valveExhaust, 'seatRing');

      add(`guide-cyl${cyl.num}-${valve}`, latheValve(cyl, valve, closed([
        [H.guideBoreR, 0.4], [guideOd, 0.4], [guideOd, 3.4], [H.guideBoreR, 3.4],
      ])), materials.bearingShell, 'guide');

      add(`springfloor-cyl${cyl.num}-${valve}`, latheValve(cyl, valve, closed([
        [guideOd, H.guideLength - H.floorT], [floorOd, H.guideLength - H.floorT],
        [floorOd, H.guideLength], [guideOd, H.guideLength],
      ])), rib, 'floor');

      add(`springtube-cyl${cyl.num}-${valve}`, latheValve(cyl, valve, closed([
        [tubeId, H.guideLength], [tubeOd, H.guideLength], [tubeOd, 5.75], [tubeId, 5.75],
      ])), rib, 'springtube');

      // the bore is machined straight through from the spring seat to above the
      // bucket skirt at full lift; this mesh is the wall the flange rides in. Only a
      // head whose cam sits above the buckets cores it: an OHV valve is held by a
      // rocker pad on the tip, and tmp/8k-free.mjs measured this collar 0.4232 cm
      // against an intake rocker lever.
      if (camCarrier) add(`bucketbore-cyl${cyl.num}-${valve}`, latheValve(cyl, valve, closed([
        [H.bucketBoreR, 5.75], [collarOd, 5.75], [collarOd, 6.95], [H.bucketBoreR, 6.95],
      ])), rib, 'bucketbore',
      { boreR: H.bucketBoreR, boreS0: H.guideLength, boreS1: 9.25 });
    }
  }
  return head;
}

/**
 * Bolt-on cam cover: plate + four walls standing on the machined split-cap plane. The
 * wall offset is not a round number: it is derived from the cap bolt line plus the
 * hex plus a wrench (COVER_WALL_IN), so every cap bolt is reachable under the cover
 * and no wall cuts through the tab ring. The 56 cap bolts themselves are the one thing
 * holding the 28 caps down, so they are drawn as their own instanced mesh.
 */
function camCover(bank, valve, materials) {
  const cover = new THREE.Group();
  cover.name = `cam-cover-${bank}-${valve}`;
  const O = camAxisBank(bank, valve)[1];
  const put = (name, geometry) => cover.add(mesh(name, geometry, materials.castAluminumHead, 'cover'));
  const [x0, x1] = [-28.05, 28.05];
  const wIn = COVER_WALL_IN, wOut = COVER_WALL_OUT;

  put('plate', boxInBank(bank, COVER_CEIL, HEAD_TOP_A, O - wOut, O + wOut, -EDGE, EDGE, 0.3));
  put('wall-out', boxInBank(bank, CAP_TOP, HEAD_TOP_A, O + wIn, O + wOut, x0, x1, 0.2));
  put('wall-in', boxInBank(bank, CAP_TOP, HEAD_TOP_A, O - wOut, O - wIn, x0, x1, 0.2));
  put('wall-fore', boxInBank(bank, CAP_TOP, HEAD_TOP_A, O - wOut, O + wOut, x1, EDGE, 0.2));
  put('wall-aft', boxInBank(bank, CAP_TOP, HEAD_TOP_A, O - wOut, O + wOut, -EDGE, -x1, 0.2));
  cover.userData.ceilingA = COVER_CEIL;
  return cover;
}

/**
 * The 56 cap bolts, two per split bearing column, one each side of the cam axis line.
 * Each stands on the published bolt line - mid of the tab span from the line bore out
 * to the tab edge - with its head on the machined top face of the cap tab and its
 * shaft down through both tabs, so it is the fastener the tab drillings were machined
 * for. Positions derive from the stack; nothing about a cap bolt is typed here.
 */
export function camCapBoltSpecs() {
  const specs = [];
  for (const bank of ['L', 'R']) {
    const u = bankUp(bank);
    for (const valve of valves) {
      const O = camAxisBank(bank, valve)[1];
      const aTop = CAM_A + ST.tabInset + ST.tabH; // machined top face of the cap tab
      for (const bx of CAM.bearings) {
        for (const s of [1, -1]) {
          const w = bankPoint(bank, aTop, O + s * ST.boltOutRel, bx);
          specs.push({ bank, p: [w.x, w.y, w.z], dir: [-u[0], -u[1], -u[2]], s: 1 });
        }
      }
    }
  }
  return specs; // 56
}

/**
 * The two heads this engine is built with (issue #46, slice 8K). A DOHC head carries
 * the cam: 28 split bearing columns, their caps, cradles, shells and retainer tabs,
 * the cap bolts and four cam covers. An OHV head does not - its cam turns in the
 * block's valley tunnel (src/engine/layout.js ohvHousing) and its valves are held by
 * rockers, so it casts none of that iron, cores no bucket bores, and machines its
 * bulkheads down to the plane the rocker shafts need room in
 * (src/engine/layout.js ohvRockerLayout). The valve row - seat insert, guide, spring
 * floor, spring tube - is the same in both.
 */
export function createHeads(materials, variant = SPEC.build.variant) {
  const camCarrier = variantEntry(variant).centralCam !== true; // DOHC: the cam turns in the head
  const group = new THREE.Group();
  group.name = 'heads';

  for (const bank of ['L', 'R']) {
    group.add(headCasting(bank, materials, camCarrier));

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

    // bolt-on cam covers close the split-cap plane the cam bearings stand under.
    // An OHV head has no cam boss to close: SPEC.variants.ohv.pendingHardware names
    // the rocker covers that replace them (issue #46, slice 8K).
    if (camCarrier) for (const valve of valves) group.add(camCover(bank, valve, materials));
  }

  const bolts = instancedBolts(
    headBoltSpecs(),
    boltGeometry(2 * H.deckBoltRadius, 1.0, 0.58, 2.9),
    materials.fastenerSteel,
    group
  );
  bolts.name = 'head-bolts';
  bolts.userData.kind = 'bolt';

  // Cap bolts: shaft long enough to run through the cap tab, the split gap and the
  // cradle tab (2 x tab height plus the inset pair), head on the cap tab's top face.
  // One instanced set per bank: the bolts hold that bank's caps onto that bank's
  // cradles, so the set has to carry the bank in its name or no label, no teardown
  // rule and no inspection menu entry can be built for it (A1-G7, test/view.test.mjs).
  const capBoltGeo = boltGeometry(2 * ST.boltAcrossR, ST.boltLen / 6, ST.boltHoleR, 2 * (ST.tabInset + ST.tabH) + 0.2);
  for (const bank of camCarrier ? ['L', 'R'] : []) {
    const capBolts = instancedBolts(
      camCapBoltSpecs().filter((s) => s.bank === bank),
      capBoltGeo,
      materials.fastenerSteel,
      group
    );
    capBolts.name = `cam-cap-bolts-${bank}`;
    capBolts.userData.kind = 'capBolt';
  }

  group.updateMatrixWorld(true);
  return { group, update: () => {} };
}
