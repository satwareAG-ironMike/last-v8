// Valvetrain: four DOHC camshafts (machined lobes, 7 bearing journals, drive
// sprockets), 16 buckets with adjusting shims, 16 valves with retainers, 16
// valve springs. Static geometry is baked in the theta = 0 pose; update(theta)
// turns the cams at exactly half crank speed and poses buckets/valves/springs
// from src/engine/timing.js - the whole train is a closed kinematic chain
// cam -> bucket -> shim -> retainer -> spring -> fixed head seat.
// Pinned by test/valvetrain.test.mjs.
import * as THREE from 'three';
import { SPEC, DEG, signedAngle } from '../engine/spec.js';
import {
  lobeProfileRadius, lobeIndexAngle, valveLift, valveAxisDir, valveAxisPoint,
  valveSeatPoint, camAxisPoint,
} from '../engine/timing.js';
import { latheX } from './parts.js';
import { extrude, alignX, alignYTo, chainSprocketGeometry, springGeometry } from './primitives.js';
import { chainLayout, gapCutR, tipRadius } from '../engine/drive.js';

const H = SPEC.head;
const V = SPEC.valves;
const CAM = SPEC.cam;
const CH = SPEC.chain;
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const valves = ['intake', 'exhaust'];

/** Closed solid cylinder about the local X axis (the cam axis). */
const solidX = (r, x0, x1) => [[r, x0], [r, x1], [0, x1], [0, x0], [r, x0]];

/**
 * Disc centred on the local origin, axis along local +Z. Every follower part
 * keeps its geometry centred and carries the offset in mesh.position, so a
 * part's world position IS its centroid (needed for inspection and measurement).
 */
const disc = (rTop, rBot, h, seg = 32) =>
  new THREE.CylinderGeometry(rTop, rBot, h, seg, 1).rotateX(Math.PI / 2);

/**
 * Cam lobe outline sampled straight from the machined profile: radius(azimuth)
 * = lobeProfileRadius(valve, signedAngle(azimuth - index)). Shape plane (u,v)
 * maps through alignX to (y,z) = (v,-u), so the baked nose sits at the index
 * azimuth in the cam group's own frame.
 */
function lobeShape(valve, idx) {
  const shape = new THREE.Shape();
  // Sampling runs forward FROM the nose, so vertex 0 is the machined nose tip:
  // the outline's max-radius vertex lands exactly on the index azimuth.
  for (let i = 0; i < 180; i++) {
    const alpha = i * 2;
    const az = idx + alpha;
    const r = lobeProfileRadius(valve, signedAngle(alpha));
    const u = -r * Math.cos(az * DEG);
    const v = r * Math.sin(az * DEG);
    if (i === 0) shape.moveTo(u, v);
    else shape.lineTo(u, v);
  }
  shape.closePath();
  return shape;
}

/** Lobe solid baked in cam-group local coords, centred on its crank station. */
function lobeSolid(cyl, valve) {
  // bevel: 0 - the drawn lobe IS the machined profile, edge for edge. A bevelled
  // extrude offsets the outline as well as the extrusion ends: with 0.12 here the
  // chamfered nose measured 3.2210 cm against the 3.1000 cm the law machines, so
  // the drawn lobe stood 0.1210 cm past the face plane of all 16 buckets
  // (test/valvetrain.test.mjs A1-G1, GATES A1-G1). A cam lobe is ground, not
  // chamfered, so the profile keeps its full width and gets no bevel.
  const g = extrude(lobeShape(valve, lobeIndexAngle(cyl, valve)), H.camLobeWidth, { bevel: 0 });
  alignX(g);
  // same bbox-recentre discipline as the crank webs: land the measured centre on the station
  g.computeBoundingBox();
  const measured = (g.boundingBox.min.x + g.boundingBox.max.x) / 2;
  g.translate(SPEC.block.stations[cyl.station] - measured, 0, 0);
  return g;
}

function buildCam(bank, valve, bandX, materials) {
  const name = `cam-${bank}-${valve}`;
  const cam = new THREE.Group();
  cam.name = name;
  const ref = SPEC.cylinders.find((c) => c.bank === bank); // every station shares the cam axis y/z
  const cap = camAxisPoint(ref, valve);
  cam.position.set(0, cap.y, cap.z);

  const put = (partName, geo, mat, part) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = partName;
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.part = part;
    cam.add(m);
    return m;
  };

  // A1-G7 (issue #8 addendum item 4): the ground journal this cam runs on is the
  // camshaft itself - SPEC.head.camJournalRadius (1.75) continuous from the aft
  // bearing through every sprocket band. It used to carry a turned collar at
  // SPEC.cam.bearingR (2.05) at each of the 7 stations; 2.05 is the LINE BORE the
  // head machines for a 0.26 cm bearing shell, so a collar at 2.05 filled the
  // tunnel, pressed into the 1.79 cm shell bore and left no 0.04 cm oil film -
  // measured against the drawn shells it stood 0.0000 cm from the bearing.
  put(`camshaft-${bank}-${valve}`, latheX(solidX(H.camJournalRadius, CAM.journalAft, CAM.journalFore), 40), materials.camShaft, 'camshaft');

  for (const cyl of SPEC.cylinders.filter((c) => c.bank === bank)) {
    const idx = lobeIndexAngle(cyl, valve);
    const lobe = put(`lobe-cyl${cyl.num}-${valve}`, lobeSolid(cyl, valve), materials.camLobe, 'cam lobe');
    lobe.userData.cyl = cyl.num;
    lobe.userData.noseDir = new THREE.Vector3(0, Math.sin(idx * DEG), Math.cos(idx * DEG));
  }

  // 36-tooth cam sprocket: bored 1.75 so the continuous camshaft journal runs
  // straight through it, 0.13 cm thick sitting in the middle of its own
  // 0.3 cm chain band, and its gap lattice clocked to the chain it actually
  // rides (src/engine/drive.js) - not a decorative gear on the cam end.
  const spK = CAM.sprocket;
  const lay = chainLayout(bank, valve);
  const spGeo = chainSprocketGeometry(spK.teeth, spK.pitchR, tipRadius(spK.pitchR), gapCutR(),
    CH.toothW, spK.bore, lay.phase.cam);
  const sp = put(`cam-sprocket-${bank}-${valve}`, spGeo, materials.chainSteel, 'cam drive sprocket');
  sp.position.x = bandX + spK.width / 2;
  sp.userData.chain = `cam-chain-${bank}-${valve}`;
  return cam;
}

function buildBucket(cyl, valve, materials) {
  const g = new THREE.Group();
  g.name = `bucket-cyl${cyl.num}-${valve}`;
  const put = (partName, geo, mat, part, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = partName;
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.part = part;
    m.userData.cyl = cyl.num;
    m.position.z = z;
    g.add(m);
    return m;
  };
  put(`${g.name}-cup`, disc(H.bucketRadius, H.bucketRadius * 0.98, H.bucketHeight), materials.bucket, 'bucket lifter', 0);
  put(`${g.name}-flange`, disc(H.bucketFlangeRadius, H.bucketFlangeRadius, 0.4), materials.bucket, 'bucket guide lip', -H.bucketHeight / 2 + 0.2);
  // adjusting shim: top face bonded to the bucket floor, bottom face on the retainer
  put(`${g.name}-shim`, disc(H.shimRadius, H.shimRadius, H.shim), materials.camLobe, 'valve shim', -(H.bucketHeight / 2 + H.shim / 2));
  return g;
}

function buildValve(cyl, valve, materials) {
  const g = new THREE.Group();
  g.name = `valve-cyl${cyl.num}-${valve}`;
  const mat = valve === 'intake' ? materials.valveIntake : materials.valveExhaust;
  const headR = H.headDia[valve] / 2;
  const put = (partName, geo, m, part, z) => {
    const x = new THREE.Mesh(geo, m);
    x.name = partName;
    x.castShadow = true;
    x.receiveShadow = true;
    x.userData.part = part;
    x.userData.cyl = cyl.num;
    x.position.z = z;
    g.add(x);
    return x;
  };
  // head disc: top face at the group origin (the seat plane), wider toward the chamber
  put(`${g.name}-head`, disc(headR * 0.94, headR, H.headThickness, 30), mat, 'valve head', -H.headThickness / 2);
  put(`${g.name}-stem`, disc(H.stemRadius, H.stemRadius, H.stemToTip, 18), mat, 'valve stem', H.stemToTip / 2);
  // retainer: top face on the valve tip plane, underside is the moving spring seat
  put(`${g.name}-retainer`, disc(H.retainerRadius, H.retainerRadius * 1.12, H.retainerGap, 24), materials.springSteel, 'valve retainer', H.stemToTip - H.retainerGap / 2);
  return g;
}

/**
 * Build the whole valvetrain. Returns { group, update(theta), cams }.
 * Cam group rotation.x = (theta / 2) rad: a baked nose at index azimuth maps
 * to index - theta/2 = lobeAzimuth(), because camAzimuth = sense * theta/2
 * and SPEC.crank.sense = -1 (same turning direction as the crank, half speed).
 */
export function createValvetrain(materials) {
  const group = new THREE.Group();
  group.name = 'valvetrain';

  const cams = [];
  const order = [
    ['L', 'intake', CAM.sprocket.bands[0]],
    ['L', 'exhaust', CAM.sprocket.bands[1]],
    ['R', 'intake', CAM.sprocket.bands[2]],
    ['R', 'exhaust', CAM.sprocket.bands[3]],
  ];
  for (const [bank, valve, bandX] of order) {
    const cam = buildCam(bank, valve, bandX, materials);
    group.add(cam);
    cams.push(cam);
  }

  const mounted = H.stemToTip - H.retainerGap - H.guideLength; // installed spring length at zero lift
  const followers = [];
  for (const cyl of SPEC.cylinders) {
    for (const valve of valves) {
      const bucket = buildBucket(cyl, valve, materials);
      const valveG = buildValve(cyl, valve, materials);
      const spring = new THREE.Mesh(springGeometry(V.springRadius, mounted, V.springCoils, V.springWireRadius), materials.springSteel);
      spring.name = `spring-cyl${cyl.num}-${valve}`;
      spring.castShadow = true;
      spring.receiveShadow = true;
      spring.userData.part = 'valve spring';
      spring.userData.cyl = cyl.num;
      group.add(bucket, valveG, spring);

      const capPt = camAxisPoint(cyl, valve);
      const seatPt = valveSeatPoint(cyl, valve);
      const d = new THREE.Vector3().fromArray(valveAxisDir(cyl, valve));
      const quat = new THREE.Quaternion().setFromUnitVectors(Z_AXIS, d);
      const qY = alignYTo(d);
      bucket.quaternion.copy(quat);
      valveG.quaternion.copy(quat);
      spring.quaternion.copy(qY);

      const seat = new THREE.Vector3(seatPt.x, seatPt.y, seatPt.z);
      followers.push({
        cyl,
        valve,
        bucket,
        valveG,
        spring,
        cap: new THREE.Vector3(capPt.x, capPt.y, capPt.z),
        seat,
        d,
        anchor: seat.clone().addScaledVector(d, H.guideLength), // fixed spring seat in the head
      });
    }
  }

  function update(theta) {
    for (const cam of cams) cam.rotation.x = (theta / CAM.halfSpeedRatio) * DEG;
    for (const f of followers) {
      const lift = valveLift(f.cyl, f.valve, theta);
      // valve: seat point translated down the axis by the live lift
      const p = valveAxisPoint(f.cyl, f.valve, 0, theta);
      f.valveG.position.set(p.x, p.y, p.z);
      // bucket top face rides the cam face at radius camBaseRadius + lift
      f.bucket.position.copy(f.cap).addScaledVector(f.d, -(H.camBaseRadius + H.bucketHeight / 2 + lift));
      // spring: fixed lower seat, retainer-side end compressed by the lift
      const live = mounted - lift;
      f.spring.scale.set(1, live / mounted, 1);
      f.spring.position.copy(f.anchor).addScaledVector(f.d, live / 2);
    }
  }
  update(0);

  group.userData.family = 'valvetrain';
  return { group, update, cams };
}
