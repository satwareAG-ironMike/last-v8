// Rotating assembly: crankshaft (with web-integrated counterweights),
// 8 pistons with ring packs, 8 connecting rods, flywheel, nose sprocket.
// Static geometry is baked once in the theta = 0 pose; update(theta) drives
// every pose from src/engine/timing.js - the crank group turns at theta,
// pistons slide along their bore axes, rods re-aim between pin and piston.
// All clearances are pinned by test/cranktrain.test.mjs.
import * as THREE from 'three';
import { SPEC, DEG } from '../engine/spec.js';
import { crankPinPoint, pistonPinPoint, pistonAlong } from '../engine/timing.js';
import { latheX, latheBank, worldBox } from './parts.js';
import { extrude, alignX, sprocketGeometry } from './primitives.js';

const C = SPEC.crank;
const P = SPEC.piston;
const R = SPEC.rod;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** Closed solid cylinder about world X (outer-first winding). */
const solidX = (r, x0, x1) => [[r, x0], [r, x1], [0, x1], [0, x0], [r, x0]];
/** Closed annular ring about world X. */
const ringX = (rOut, rIn, x0, x1) => [[rOut, x0], [rOut, x1], [rIn, x1], [rIn, x0], [rOut, x0]];

const throwAz = (s) => C.pinAz[SPEC.block.stations.indexOf(s)];

/**
 * Web + counterweight as ONE cast profile in the throw frame:
 * v along the throw (pin at v = 4), u perpendicular. The outer arc is
 * sampled exactly at counterRadius; the pin-side edge wraps the pin boss.
 */
function webShape() {
  // The extrude bevel (0.15) expands the outline outward, and mitered corners
  // extend past a parallel offset (~0.165 measured). Inset accordingly: the
  // beveled edge lands under counterRadius, never past it.
  const AR = C.counterRadius - 0.17;
  const shape = new THREE.Shape();
  shape.moveTo(-C.webHalfU, 4.6);
  for (const [u, v] of [
    [C.webHalfU, 4.6],
    [C.webHalfU, -0.5],
    [4.3, -1.8],
    [AR * Math.sin(60 * DEG), -AR * Math.cos(60 * DEG)],
    [AR * Math.sin(45 * DEG), -AR * Math.cos(45 * DEG)],
    [AR * Math.sin(30 * DEG), -AR * Math.cos(30 * DEG)],
    [AR * Math.sin(15 * DEG), -AR * Math.cos(15 * DEG)],
    [0, -AR],
    [-AR * Math.sin(15 * DEG), -AR * Math.cos(15 * DEG)],
    [-AR * Math.sin(30 * DEG), -AR * Math.cos(30 * DEG)],
    [-AR * Math.sin(45 * DEG), -AR * Math.cos(45 * DEG)],
    [-AR * Math.sin(60 * DEG), -AR * Math.cos(60 * DEG)],
    [-4.3, -1.8],
    [-C.webHalfU, -0.5],
  ])
    shape.lineTo(u, v);
  shape.closePath();
  return shape;
}

/**
 * One web slab with its integrated counter arc. Baked into world coords:
 * shape (u,v) -> extrude along Z -> alignX -> slab x -> rotate to the throw.
 */
function webSolid(s, side /* +1 outboard, -1 inboard */) {
  const g = extrude(webShape(), C.webThickness, { bevel: 0.15, bevelSegments: 2 });
  alignX(g);
  // ExtrudeGeometry's bevels are not symmetric about the steps core; recentre
  // the slab from its own bbox so it lands exactly in the s +/- (1.4..2.5) window.
  g.computeBoundingBox();
  const measured = (g.boundingBox.min.x + g.boundingBox.max.x) / 2;
  const slabCenter = s + side * (C.webIn + C.webOut) * 0.5;
  g.translate(slabCenter - measured, 0, 0);
  g.rotateX((90 - throwAz(s)) * DEG); // throw frame v axis (+Y, az 90) -> pinAz
  return g;
}

function pinOffset(s) {
  const az = throwAz(s) * DEG;
  return { y: C.radius * Math.sin(az), z: C.radius * Math.cos(az) };
}

function buildCrank(materials) {
  const crank = new THREE.Group();
  crank.name = 'crank';
  const put = (name, geo, mat) => {
    const m = new THREE.Mesh(geo, mat.crankShaft);
    m.name = name;
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.part = 'crankshaft';
    crank.add(m);
    return m;
  };

  // main journals: run through the web windows (overlap 0.05 for fusion)
  const mains = [
    ['main-x11', 7.95, 14.05],
    ['main-x0', -3.05, 3.05],
    ['main-x-11', -14.05, -7.95],
    ['main-fore', 18.95, 26.5],
    ['main-aft', -26.5, -18.95],
  ];
  for (const [name, x0, x1] of mains) put(name, latheX(solidX(C.mainRadius, x0, x1), 40), materials);
  put('nose-stub', latheX(solidX(C.noseRadius, 26.45, 28.65), 32), materials);

  // pins, webs, bosses per station
  for (const s of SPEC.block.stations) {
    const off = pinOffset(s);
    const pin = put(`pin-s${s}`, latheX(solidX(C.pinRadius, s - 2.9, s + 2.9), 40), materials);
    pin.geometry.translate(0, off.y, off.z);
    for (const side of [+1, -1]) {
      const w = new THREE.Mesh(webSolid(s, side), materials.crankShaft);
      w.name = `web-s${s}${side > 0 ? 'out' : 'in'}`;
      w.castShadow = true;
      w.receiveShadow = true;
      w.userData.part = 'crankshaft';
      crank.add(w);
      const boss = put(
        `boss-s${s}${side > 0 ? 'out' : 'in'}`,
        latheX(ringX(3.1, 2.3, s + (side > 0 ? C.webIn : -C.webOut), s + (side > 0 ? C.webOut : -C.webIn)), 32),
        materials
      );
      boss.geometry.translate(0, off.y, off.z);
    }
  }

  // flywheel: disc + bolt flange through the aft boss + ring gear band
  const flywheel = new THREE.Group();
  flywheel.name = 'flywheel';
  const fwDisc = new THREE.Mesh(latheX(solidX(C.flywheel.radius, C.flywheel.x0, C.flywheel.x1 + 0.05), 64), materials.crankShaft);
  fwDisc.name = 'flywheel-disc';
  const fwFlange = new THREE.Mesh(latheX(solidX(C.flangeRadius, C.flywheel.x1 - 0.1, -26.45), 40), materials.crankShaft);
  fwFlange.name = 'flywheel-flange';
  const fwRing = new THREE.Mesh(latheX(ringX(C.flywheel.ringRadius, C.flywheel.radius - 0.05, -29.5, -28.3), 48), materials.chainSteel);
  fwRing.name = 'flywheel-ring-gear';
  for (const m of [fwDisc, fwFlange, fwRing]) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.part = 'flywheel';
    flywheel.add(m);
  }
  crank.add(flywheel);

  // nose sprocket for the cam drive: 18 machined teeth; cam sprockets are 36
  const sprocket = new THREE.Group();
  sprocket.name = 'sprocket';
  const spDrum = new THREE.Mesh(latheX(solidX(C.sprocket.radius, C.sprocket.x0, C.sprocket.x1), 40), materials.crankShaft);
  spDrum.name = 'sprocket-drum';
  const spTeeth = new THREE.Mesh(
    sprocketGeometry(C.sprocket.teeth, C.sprocket.pitchR, C.sprocket.toothH, C.sprocket.x1 - C.sprocket.x0, 0),
    materials.chainSteel
  );
  // bevels are asymmetric along the extrusion axis: land the measured bbox on the band
  spTeeth.geometry.computeBoundingBox();
  spTeeth.geometry.translate(
    (C.sprocket.x0 + C.sprocket.x1) / 2 - (spTeeth.geometry.boundingBox.min.x + spTeeth.geometry.boundingBox.max.x) / 2,
    0, 0
  );
  spTeeth.name = 'sprocket-teeth';
  for (const m of [spDrum, spTeeth]) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.part = 'cam drive sprocket';
    sprocket.add(m);
  }
  crank.add(sprocket);

  return crank;
}

function buildRod(cyl, materials) {
  const g = new THREE.Group();
  g.name = `rod-cyl${cyl.num}`;
  const put = (name, geo, mat) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.part = 'connecting rod';
    m.userData.cyl = cyl.num;
    g.add(m);
    return m;
  };
  // canonical: big end centre at origin (axis = world X = pin axis),
  // small end at (0, rod.length, 0); the group transform aims it per frame.
  put(`rod-cyl${cyl.num}-big`, latheX(ringX(R.bigEndRadius, C.pinRadius + 0.05, -0.65, 0.65), 36), materials.rodSteel);
  put(`rod-cyl${cyl.num}-parting`, latheX(ringX(R.bigEndRadius + 0.06, R.bigEndRadius - 0.05, -0.66, 0.66), 36), materials.fastenerDark);
  put(`rod-cyl${cyl.num}-bolt+`, worldBox(-0.3, 0.3, -2.6, -1.4, 2.1, 3.1, 0.12), materials.fastenerDark);
  put(`rod-cyl${cyl.num}-bolt-`, worldBox(-0.3, 0.3, -2.6, -1.4, -3.1, -2.1, 0.12), materials.fastenerDark);
  put(`rod-cyl${cyl.num}-beam`, worldBox(-0.65, 0.65, 2.9, 8.2, -1.2, 1.2, 0.3), materials.rodSteel);
  put(`rod-cyl${cyl.num}-beam2`, worldBox(-0.5, 0.5, 7.5, 13.0, -0.75, 0.75, 0.25), materials.rodSteel);
  const small = put(
    `rod-cyl${cyl.num}-small`,
    latheX(ringX(R.smallEndRadius + 0.45, R.smallEndRadius - 0.2, -0.55, 0.55), 32),
    materials.rodSteel
  );
  small.geometry.translate(0, R.length, 0);
  return g;
}

function buildPiston(cyl, materials) {
  const g = new THREE.Group();
  g.name = `piston-cyl${cyl.num}`;
  const s = SPEC.block.stations[cyl.station];
  const body = new THREE.Mesh(
    latheBank(
      cyl.bank,
      [
        [P.radius, -P.skirtLength],
        [P.radius, P.compressionHeight],
        [0, P.compressionHeight],
        [0, -P.skirtLength],
        [P.radius, -P.skirtLength],
      ],
      44,
      s
    ),
    materials.pistonAlloy
  );
  body.name = `piston-cyl${cyl.num}-body`;
  body.castShadow = true;
  body.receiveShadow = true;
  body.userData.part = 'piston';
  body.userData.cyl = cyl.num;
  g.add(body);
  // three ring bands pressed over the skirt
  let i = 0;
  for (const a of [3.0, 2.2, 1.4]) {
    const ring = new THREE.Mesh(
      latheBank(
        cyl.bank,
        [
          [P.radius + 0.08, a - 0.22],
          [P.radius + 0.08, a + 0.22],
          [P.radius - 0.07, a + 0.22],
          [P.radius - 0.07, a - 0.22],
          [P.radius + 0.08, a - 0.22],
        ],
        40,
        s
      ),
      materials.ringSteel
    );
    ring.name = `ring-cyl${cyl.num}-${++i}`;
    ring.castShadow = true;
    ring.userData.part = 'piston ring pack';
    ring.userData.cyl = cyl.num;
    g.add(ring);
  }
  return g;
}

/**
 * Build the whole rotating assembly. Returns { group, update(theta) }.
 * The group transform is identity; parts pose themselves from timing math.
 */
export function createCranktrain(materials) {
  const group = new THREE.Group();
  group.name = 'cranktrain';

  const crank = buildCrank(materials);
  group.add(crank);

  const rods = [];
  const pistons = [];
  for (const cyl of SPEC.cylinders) {
    const rod = buildRod(cyl, materials);
    const piston = buildPiston(cyl, materials);
    group.add(rod, piston);
    rods.push({ cyl, rod, off: cyl.bank === 'R' ? 0.7 : -0.7 });
    pistons.push({ cyl, piston });
  }

  const d = new THREE.Vector3();
  function update(theta) {
    crank.rotation.x = theta * DEG; // az(throw) = pinAz - theta  (sense -1)
    for (const { cyl, piston } of pistons) {
      const a = pistonAlong(cyl, theta);
      const az = SPEC.banks[cyl.bank].az * DEG;
      piston.position.set(0, a * Math.sin(az), a * Math.cos(az));
    }
    for (const { cyl, rod, off } of rods) {
      const cp = crankPinPoint(cyl, theta);
      const pp = pistonPinPoint(cyl, theta);
      d.set(pp.x - cp.x, pp.y - cp.y, pp.z - cp.z).normalize();
      rod.position.set(cp.x + off, cp.y, cp.z);
      rod.quaternion.setFromUnitVectors(Y_AXIS, d);
    }
  }
  update(0);

  group.userData.family = 'cranktrain';
  return { group, update, crank };
}
