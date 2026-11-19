// The cam chain drive as drawn geometry: four roller chains, one per DOHC
// camshaft, each wrapped from its own bored 18-tooth lane on the crank nose to
// its own 36-tooth cam sprocket (GATES row A1-G2, issue #4).
//
// Nothing here invents a path: every position comes from src/engine/drive.js,
// which derives the pitch from the two published sprockets, solves the whole-
// tooth wraps, keeps every link at exactly the pitch and lets each straight run
// bow by the measured closure the tensioner has to take up. The side plates are
// per-link instances, because a continuous plate ribbon would cross the cam
// sprocket's tooth lane in x - the x budget inside one 0.3 cm band is exactly
// plate / clearance / tooth / clearance / plate.
// Pinned by test/valvetrain.test.mjs (A1-G1 / A1-G2 laws).
import * as THREE from 'three';
import { SPEC } from '../engine/spec.js';
import { bandIndexOf, chainLayout, chainPitch, chainPose } from '../engine/drive.js';

const CH = SPEC.chain;
const CAM_SP = SPEC.cam.sprocket;
const KS = CAM_SP;
const DEG = Math.PI / 180;

/** x of the middle of one chain's band: its rollers, plates and shoes all share it. */
const bandMid = (i) => KS.bands[i] + KS.width / 2;

/** One chain roller: a sleeve over its pin, barrel axis along world X. */
function rollerGeometry() {
  const g = new THREE.CylinderGeometry(CH.rollerR, CH.rollerR, CH.toothW, 20);
  g.rotateZ(Math.PI / 2); // lathe axis +Y -> world +X
  return g;
}

/**
 * One side plate: a slab standing on the pin line, `CH.plate` thick in x, long
 * enough to bridge one pitch and tall enough to cover the roller it clamps.
 * Instances differ only in position and rotation about X, so the layer's x
 * extent is the published plate thickness everywhere along the loop.
 */
function plateGeometry() {
  const h = 2 * CH.rollerR; // the plate stands over its rollers
  const g = new THREE.BoxGeometry(CH.plate, chainPitch(), h);
  return g;
}

/**
 * Pad the chain rides on: `run` long along its local Y, `thick` deep along its
 * local Z, its mating face at the local plane z = -faceGap and the material
 * behind that face (z from -faceGap-thick to -faceGap). The pad group sits at
 * the span apex, so faceGap is measured straight off the pin line and the
 * rotation below decides which side of the chain the body stands on.
 */
function padGeometry(thick, run, faceGap) {
  const g = new THREE.BoxGeometry(KS.width - 2 * CH.bandClr, run, thick);
  g.translate(0, 0, -faceGap - thick / 2);
  return g;
}

/**
 * Rx(angle) that carries local +Z onto the world unit vector w in the (y, z)
 * plane: Rx(a) sends (0,0,1) to (y,z) = (-sin a, cos a), so a = atan2(-w.y, w.z).
 * The pad's local Y then lands on the span tangent and its local Z on the bow
 * normal, which is what keeps a guide face parallel to the run it guides.
 */
const aimZ = (w) => Math.atan2(-w.y, w.z);

function buildChain(bank, valve, materials) {
  const lay = chainLayout(bank, valve);
  const name = `cam-chain-${bank}-${valve}`;
  const i = bandIndexOf(bank, valve);
  const x = bandMid(i);
  const group = new THREE.Group();
  group.name = name;
  group.userData.part = 'cam chain';
  group.userData.chain = name;

  const rGeo = rollerGeometry();
  const rollers = [];
  for (let k = 0; k < lay.linkCount; k++) {
    const m = new THREE.Mesh(rGeo, materials.chainSteel);
    m.name = `${name}-roller-${k}`;
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.part = 'chain roller';
    m.userData.on = null;
    m.userData.pitch = chainPitch();
    m.userData.axis = { y: lay.cam.y, z: lay.cam.z };
    m.userData.layout = lay;
    group.add(m);
    rollers.push(m);
  }

  // two side-plate layers per chain, one instance per link
  const pGeo = plateGeometry();
  const plates = [x - CH.toothW / 2 - CH.plateClr - CH.plate / 2, x + CH.toothW / 2 + CH.plateClr + CH.plate / 2]
    .map((px, side) => {
      const im = new THREE.InstancedMesh(pGeo, materials.chainSteel, lay.linkCount);
      im.name = `${name}-plates-${side === 0 ? 'in' : 'out'}`;
      im.castShadow = true;
      im.receiveShadow = true;
      im.userData.part = 'chain side plate';
      im.frustumCulled = false;
      group.add(im);
      return { im, px };
    });

  const guide = new THREE.Group();
  guide.name = `${name}-guide`;
  guide.userData.part = 'chain guide pad';
  const shoe = new THREE.Group();
  shoe.name = `${name}-tensioner`;
  shoe.userData.part = 'chain tensioner shoe';
  group.add(guide, shoe);

  const pose = chainPose(lay, 0);
  // The span whose closure the fixed geometry already holds taut carries the
  // guide; the span with the bigger measured closure is the one the tensioner
  // shoe has to stand on and push in.
  const fixedSpan = pose.spans.A.takeUp <= pose.spans.B.takeUp ? 'A' : 'B';
  const loadedSpan = fixedSpan === 'A' ? 'B' : 'A';
  const run = 3 * chainPitch();
  for (const [obj, spanKey, thick, outSign, part] of [
    [guide, fixedSpan, CH.guidePad, -1, 'chain guide pad'],
    [shoe, loadedSpan, CH.shoePad, +1, 'chain tensioner shoe'],
  ]) {
    const s = pose.spans[spanKey];
    obj.position.set(x, s.apex.y, s.apex.z);
    obj.userData.onSpan = spanKey;
    obj.userData.padRise = s.bow.rise;
    obj.userData.takeUp = s.takeUp;
    // Outward at the apex: the span bows away from the loop interior, so the
    // radius from the arc centre out to its apex IS the outward normal. The
    // guide body stands on the inside of the span, the tensioner shoe on the
    // outside, and aimZ(against that side) turns the pad so its depth runs
    // along the bow and its length along the span tangent.
    const n = { y: s.apex.y - s.centre.y, z: s.apex.z - s.centre.z };
    const L = Math.hypot(n.y, n.z) || 1;
    // A guide cradling the inside of the bow has to clear the arc it rides:
    // every roller inside its reach sags toward the arc centre by that arc's
    // own sag at the run half-length. R and the run are both drive numbers.
    const sag = outSign < 0 ? s.bow.R - Math.sqrt(s.bow.R * s.bow.R - (run / 2) * (run / 2)) : 0;
    const faceGap = CH.rollerR + CH.plateClr + sag;
    // the shoe that pushes is steel, the fixed guide is an anodised pad: both
    // families already exist and test/screenshots.mjs already rules each one
    const pad = new THREE.Mesh(
      padGeometry(thick, run, faceGap),
      outSign < 0 ? materials.anodized : materials.chainSteel
    );
    pad.castShadow = true;
    pad.receiveShadow = true;
    // local +Z is aimed against the side the body stands on, because the pad
    // geometry carries its material on the -Z side of its own face
    pad.rotation.x = aimZ({ y: -outSign * n.y / L, z: -outSign * n.z / L });
    pad.userData.part = part;
    pad.userData.padRise = s.bow.rise;
    pad.userData.faceGap = faceGap;
    obj.add(pad);
  }

  const set = (theta) => {
    const p = chainPose(lay, theta);
    const M = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const X_AXIS = new THREE.Vector3(1, 0, 0);
    p.rollers.forEach((r, k) => {
      const m = rollers[k];
      m.position.set(x, r.y, r.z);
      m.userData.on = r.on;
      m.userData.rel = r.rel ? { y: r.rel.y, z: r.rel.z } : null;
      m.userData.at = r.at;
      if (r.gap === undefined) delete m.userData.gap;
      else m.userData.gap = r.gap;
    });
    for (const { im, px } of plates) {
      p.links.forEach((l, k) => {
        const my = (l.a.y + l.b.y) / 2, mz = (l.a.z + l.b.z) / 2;
        // Rx(atan2(dz, dy)) stands the plate's own length axis (local +Y) along
        // its link in the (y, z) plane; its height axis then points along the bow
        const dy = l.b.y - l.a.y, dz = l.b.z - l.a.z;
        q.setFromAxisAngle(X_AXIS, Math.atan2(dz, dy));
        M.compose(new THREE.Vector3(px, my, mz), q, new THREE.Vector3(1, 1, 1));
        im.setMatrixAt(k, M);
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
    }
  };
  set(0);

  return { group, set, lay, name, x };
}

/**
 * The whole drive: four chains plus update(theta), which re-poses each chain at
 * the engagement the measured chain has at that crank angle. The sprockets
 * themselves turn with their groups (cranktrain: +theta, valvetrain: +theta/2),
 * and the chain follows the gaps they present.
 */
export function createDrive(materials) {
  const group = new THREE.Group();
  group.name = 'cam-drive';
  group.userData.part = 'cam chain drive';
  const chains = ['L', 'R'].flatMap((bank) => ['intake', 'exhaust'].map((valve) => buildChain(bank, valve, materials)));
  for (const ch of chains) group.add(ch.group);
  const update = (theta) => {
    for (const ch of chains) ch.set(theta);
  };
  update(0);
  return { group, update, chains };
}
