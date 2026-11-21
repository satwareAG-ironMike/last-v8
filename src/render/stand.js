// Industrial engine test stand. It carries the V8 on two real casting interfaces
// only, both derived from src/engine/spec.js and measured off the block group in
// test/stand.test.mjs:
//
//   A. the oil-pan flange - the block's cast pan rails (flat pads at
//      z panRailZ..panFlangeZ, |y| <= panFlangeHalfWidth) plus the oil-pan side
//      wall at |y| = panWallHalfWidth(): 4 mount plates, 2 clamp bolts each.
//   B. the fore/aft end-disc flat x-faces at |x| = endDiscFaceX(): 4 locator
//      jaws on a pedestal per end, so crank torque has nowhere to go.
//
// No cradle under the oil pan is possible (measured): the pan bottom is z -14.6,
// its drain plug reaches -15.05 and the cell floor is -16.5, leaving 1.45..1.90
// cm of air. Every frame beam therefore travels the free lane floorZ..frameZ1,
// and the fore/aft pedestals stand outboard of the rotating hardware they pass
// (crank nose stub, cam-chain sprocket drum at x 28.6..29.8, flywheel disc and
// ring gear). Non-mount members keep SPEC.stand.minAir of real air, which
// test/stand.test.mjs verifies against a voxel shell of the engine that is
// actually rendered; mounts mate their faces by SPEC.stand.bite / jawBite.
//
// One frame, the casting it stands under: every plane above is read through
// `layout.js standDatums(id)`, so a variant whose skirt reaches deeper (the
// central-cam build, whose sump hangs 3.2 cm lower) moves the whole frame with
// its own sump instead of being hung in the DOHC frame's planes. Its 2:1 chain
// also reserves a volume across the frame lane - src/engine/drive.js
// `ohvDriveCorridor()` - and the centre skid rails stop short of it (issue #24).
import * as THREE from 'three';
import { SPEC } from '../engine/spec.js';
import { standDatums, variantEntry } from '../engine/layout.js';
import { ohvDriveCorridor } from '../engine/drive.js';
import { worldBox } from './parts.js';
import { boltGeometry, cylinderBetween, instancedBolts } from './primitives.js';

const S = SPEC.stand;

/** L = -y side, R = +y side (same convention as the banks). */
const sideSign = (side) => (side === 'R' ? 1 : -1);
/** fore = +x (crank nose, cam sprockets), aft = -x (flywheel). */
const endSign = (end) => (end === 'fore' ? 1 : -1);
const SIDES = ['L', 'R'];
const ENDS = ['fore', 'aft'];

/**
 * The mounting interfaces the stand is allowed to bolt onto, every one of them
 * a function of the block casting of the variant it is asked for: a stand member
 * can never claim a face the casting does not have. `layout.js standDatums(id)`
 * is the single source - it publishes the planes this variant machines (its pan
 * rail, flange and sump wall) plus every pinned frame plane shifted by exactly
 * the depth this variant's sump hangs below the DOHC one.
 *
 * `skidForeX` is the same discipline applied fore: a central-cam variant hangs
 * its crank-to-cam chain down into the frame beam lane, so its centre skid rails
 * stop `SPEC.stand.minAir` short of the drive corridor src/engine/drive.js
 * publishes (issue #24 symptom 3).
 */
export function standInterfaces(id = SPEC.build.variant) {
  const D = standDatums(id);
  const central = variantEntry(id).centralCam;
  const corridor = central ? ohvDriveCorridor() : null;
  return {
    ...D,
    centralCam: central,
    driveCorridor: corridor,
    panWall: D.wallHalfY, // |y| of the oil-pan side wall the mount plates clamp
    railZ: D.railZ, // z of the pan-rail bottom face: the mount bearing plane
    faceX: D.faceX, // |x| of the fore/aft end-disc faces the locator jaws press on
    padInY: D.wallHalfY - S.bite, // mount plate inboard edge (it bites by `bite`)
    padZ1: D.railZ + S.bite, // mount plate top face (it bites the flange by `bite`)
    jawInX: D.faceX - S.jawBite, // jaw face pressing the end disc (bites by `jawBite`)
    // A mount post may not stand in the flange band: the flange this variant
    // machines reaches flangeHalfY, and `SPEC.stand.minAir` of real air is owed
    // between the post and it. The pinned DOHC post edge (4.4) already clears
    // the DOHC flange (3.1996 + 0.5 = 3.6996), so DOHC reads its published
    // edge; a wider skirt moves the flange and the post with it (issue #24).
    postInY: Math.max(S.postY[0], D.flangeHalfY + S.minAir),
    shaftL: S.padOutY - S.boltTipY, // clamp bolt length: pad outboard face to tip
    skidForeX: corridor ? Math.min(S.skidX[1], corridor.x0 - S.minAir) : S.skidX[1],
  };
}

/**
 * Every stand member as a published spec, so the tests measure exactly what the
 * renderer builds. Boxes are world-axis-aligned [x0,x1,y0,y1,z0,z1]; a brace is
 * a diagonal strut with its foot buried in a bed rail and its head buried in a
 * mount post (nothing floats apart). The frame is the same load path for every
 * variant; the planes it stands on are the ones that variant's casting has.
 */
export function standSpecs(id = SPEC.build.variant) {
  const I = standInterfaces(id);
  const out = [];
  // mirror-safe: every pair is ordered min/max, so an -y or -x member ends up
  // with the same AABB its +y / +x twin has, never an inverted one
  const ord = (a, b) => (a <= b ? [a, b] : [b, a]);
  const put = (name, kind, x0, x1, y0, y1, z0, z1) => {
    const bb = [...ord(x0, x1), ...ord(y0, y1), ...ord(z0, z1)];
    out.push({ name, kind, bb });
    return bb;
  };

  // ---- 1. the bed: two longitudinal rails the whole stand stands on ----------
  for (const side of SIDES) {
    const s = sideSign(side);
    put(`bed-${side}`, 'bed', S.bedX[0], S.bedX[1], s * S.bedY[1], s * S.bedY[0], I.floorZ, I.frameZ1);
    // the centre skid rails stop where this variant's drive corridor begins
    put(`skid-${side}`, 'skid', S.skidX[0], I.skidForeX, s * S.skidY[1], s * S.skidY[0], I.floorZ, I.frameZ1);
  }
  // fore/aft cross ties close the torsion box; side ties carry each skid rail
  // into each bed rail (they share the frame's full beam depth, so they fuse)
  for (const end of ENDS) {
    const e = endSign(end);
    const tx = e > 0 ? S.tieForeX : S.tieAftX;
    put(`tie-${end}`, 'tie', tx[0], tx[1], -S.bedY[1], S.bedY[1], I.floorZ, I.frameZ1);
  }
  for (const end of ENDS) {
    const e = endSign(end);
    for (const side of SIDES) {
      const s = sideSign(side);
      put(`sideTie-${end[0]}${side}`, 'sideTie',
        e * S.sideTieX[0], e * S.sideTieX[1],
        s * S.bedY[1], s * S.skidY[0], I.floorZ, I.frameZ1);
    }
  }

  // ---- 2. engine mounts: post -> rubber mount plate -> oil-pan flange --------
  for (const end of ENDS) {
    const e = endSign(end);
    for (const side of SIDES) {
      const s = sideSign(side);
      const tag = `${end[0]}${side}`;
      put(`post-${tag}`, 'post',
        e * S.postX[0], e * S.postX[1], s * I.postInY, s * S.postY[1], I.frameZ1, I.padZ0);
      put(`pad-${tag}`, 'pad',
        e * S.padInX, e * S.padOutX, s * I.padInY, s * S.padOutY, I.padZ0, I.padZ1);
      // gusset from the bed rail into the mount post: both ends buried in the
      // member it ties, so the brace cannot pull out of the frame
      out.push({
        name: `brace-${tag}`,
        kind: 'brace',
        a: [e * S.braceX, s * S.braceFootY, I.braceFootZ],
        b: [e * S.braceX, s * S.braceHeadY, I.braceHeadZ],
        r: S.braceR,
      });
    }
  }

  // ---- 3. fore/aft reaction frames: pedestal -> cross arm -> locator jaw -----
  for (const end of ENDS) {
    const e = endSign(end);
    const x0 = e * I.jawInX;
    const x1 = e * S.colOutX;
    for (const side of SIDES) {
      const s = sideSign(side);
      put(`column-${end[0]}${side}`, 'column',
        Math.min(x0, x1), Math.max(x0, x1), s * S.colY[0], s * S.colY[1], I.frameZ1, I.colZ1);
    }
    put(`arm-${end}`, 'arm',
      Math.min(x0, x1), Math.max(x0, x1), -S.colY[1], S.colY[1], I.colZ1, I.jawZ0);
    for (const side of SIDES) {
      const s = sideSign(side);
      put(`jaw-${end[0]}${side}`, 'jaw',
        Math.min(x0, e * S.jawOutX), Math.max(x0, e * S.jawOutX),
        s * S.jawY[0], s * S.jawY[1], I.jawZ0, I.jawZ1);
    }
  }
  return out;
}

/** The 8 clamp bolts: 2 per mount plate, axis along Y, head outboard in free air. */
export function standBolts(id = SPEC.build.variant) {
  const I = standInterfaces(id);
  const specs = [];
  for (const end of ENDS) {
    const e = endSign(end);
    for (const side of SIDES) {
      const s = sideSign(side);
      const cx = e * (S.padInX + S.padOutX) / 2;
      for (let i = 0; i < S.boltsPerMount; i++) {
        const off = (i - (S.boltsPerMount - 1) / 2) * S.boltOffX;
        specs.push({
          name: `bolt-${end[0]}${side}-${i + 1}`,
          kind: 'bolt',
          p: [cx + off, s * S.padOutY, I.boltZ],
          dir: [0, s, 0], // instancedBolts turns local +Y (the hex head) onto dir
          s: 1,
          headH: S.boltHeadH,
          shaftR: S.boltShaftR,
          shaftL: I.shaftL,
        });
      }
    }
  }
  return specs;
}

const FILLET = {
  bed: 0.22, skid: 0.22, tie: 0.22, sideTie: 0.22,
  post: 0.18, column: 0.18, arm: 0.18, jaw: 0.15, pad: 0.12,
};
const MAT = {
  bed: 'paintedYellow', skid: 'paintedYellow', tie: 'paintedYellow', sideTie: 'paintedYellow',
  post: 'standSteel', brace: 'standSteel', jaw: 'standSteel',
  column: 'paintedOrange', arm: 'paintedOrange', pad: 'rubberMount',
};

/**
 * Build the frame of the variant `variantId` names: the same load path, standing
 * on that variant's own cast planes (issue #24). `update` is deliberately absent:
 * a test stand is fixed hardware, and test/stand.test.mjs asserts it (a moving
 * mount would make the measured clearances meaningless).
 */
export function createStand(materials, variantId = SPEC.build.variant) {
  const group = new THREE.Group();
  group.name = 'test-stand';
  for (const m of standSpecs(variantId)) {
    const geo = m.kind === 'brace'
      ? cylinderBetween(m.a, m.b, m.r, 24)
      : worldBox(m.bb[0], m.bb[1], m.bb[2], m.bb[3], m.bb[4], m.bb[5], FILLET[m.kind] ?? 0.1);
    const mesh = new THREE.Mesh(geo, materials[MAT[m.kind]]);
    mesh.name = m.name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.kind = m.kind;
    group.add(mesh);
  }
  const I = standInterfaces(variantId);
  const bolts = instancedBolts(
    standBolts(variantId),
    boltGeometry(S.boltAcross, S.boltHeadH, S.boltShaftR, I.shaftL),
    materials.fastenerSteel,
    null
  );
  bolts.name = 'stand-bolts';
  bolts.userData.kind = 'bolt';
  group.add(bolts);
  group.updateMatrixWorld(true);
  return { group };
}
