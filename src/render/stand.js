// Industrial engine test stand. It carries the V12 on two real casting interfaces
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
import * as THREE from 'three';
import {
  SPEC,
  panWallHalfWidth,
  panRailPlane,
  endDiscFaceX,
} from '../engine/spec.js';
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
 * a function of the block topology: a stand member can never claim a face the
 * casting does not have.
 */
export function standInterfaces() {
  const panWall = panWallHalfWidth();
  const railZ = panRailPlane();
  const faceX = endDiscFaceX();
  return {
    panWall, // |y| of the oil-pan side wall the mount plates clamp
    railZ, // z of the pan-rail bottom face: the mount bearing plane
    faceX, // |x| of the fore/aft end-disc faces the locator jaws press on
    padInY: panWall - S.bite, // mount plate inboard edge (it bites by `bite`)
    padZ1: railZ + S.bite, // mount plate top face (it bites the flange by `bite`)
    jawInX: faceX - S.jawBite, // jaw face pressing the end disc (bites by `jawBite`)
    shaftL: S.padOutY - S.boltTipY, // clamp bolt length: pad outboard face to tip
  };
}

/**
 * Every stand member as a published spec, so the tests measure exactly what the
 * renderer builds. Boxes are world-axis-aligned [x0,x1,y0,y1,z0,z1]; a brace is
 * a diagonal strut with its foot buried in a bed rail and its head buried in a
 * mount post (nothing floats apart).
 */
export function standSpecs() {
  const I = standInterfaces();
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
    put(`bed-${side}`, 'bed', S.bedX[0], S.bedX[1], s * S.bedY[1], s * S.bedY[0], S.floorZ, S.frameZ1);
    put(`skid-${side}`, 'skid', S.skidX[0], S.skidX[1], s * S.skidY[1], s * S.skidY[0], S.floorZ, S.frameZ1);
  }
  // fore/aft cross ties close the torsion box; side ties carry each skid rail
  // into each bed rail (they share the frame's full beam depth, so they fuse)
  for (const end of ENDS) {
    const e = endSign(end);
    const tx = e > 0 ? S.tieForeX : S.tieAftX;
    put(`tie-${end}`, 'tie', tx[0], tx[1], -S.bedY[1], S.bedY[1], S.floorZ, S.frameZ1);
  }
  for (const end of ENDS) {
    const e = endSign(end);
    for (const side of SIDES) {
      const s = sideSign(side);
      put(`sideTie-${end[0]}${side}`, 'sideTie',
        e * S.sideTieX[0], e * S.sideTieX[1],
        s * S.bedY[1], s * S.skidY[0], S.floorZ, S.frameZ1);
    }
  }

  // ---- 2. engine mounts: post -> rubber mount plate -> oil-pan flange --------
  // One mount per station group per side: the outer pair sits under the end
  // cylinders, the middle one under the middle of the crankcase, so the pan
  // flange is supported along its whole length instead of at its corners only.
  for (const side of SIDES) {
    const s = sideSign(side);
    for (const mx of S.mountX) {
      const tag = `${side}${mx}`;
      put(`post-${tag}`, 'post',
        mx - S.postHalf, mx + S.postHalf, s * S.postY[0], s * S.postY[1], S.frameZ1, S.padZ0);
      put(`pad-${tag}`, 'pad',
        mx - S.padHalf, mx + S.padHalf, s * I.padInY, s * S.padOutY, S.padZ0, I.padZ1);
      // gusset from the bed rail into the mount post: both ends buried in the
      // member it ties, so the brace cannot pull out of the frame
      out.push({
        name: `brace-${tag}`,
        kind: 'brace',
        a: [mx, s * S.braceFootY, S.braceFootZ],
        b: [mx, s * S.braceHeadY, S.braceHeadZ],
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
        Math.min(x0, x1), Math.max(x0, x1), s * S.colY[0], s * S.colY[1], S.frameZ1, S.colZ1);
    }
    put(`arm-${end}`, 'arm',
      Math.min(x0, x1), Math.max(x0, x1), -S.colY[1], S.colY[1], S.colZ1, S.jawZ[0]);
    for (const side of SIDES) {
      const s = sideSign(side);
      put(`jaw-${end[0]}${side}`, 'jaw',
        Math.min(x0, e * S.jawOutX), Math.max(x0, e * S.jawOutX),
        s * S.jawY[0], s * S.jawY[1], S.jawZ[0], S.jawZ[1]);
    }
  }
  return out;
}

/** Two clamp bolts per mount plate, axis along Y, head outboard in free air. */
export function standBolts() {
  const I = standInterfaces();
  const specs = [];
  for (const side of SIDES) {
    const s = sideSign(side);
    for (const cx of S.mountX) {
      for (let i = 0; i < S.boltsPerMount; i++) {
        const off = (i - (S.boltsPerMount - 1) / 2) * S.boltOffX;
        specs.push({
          name: `bolt-${side}${cx}-${i + 1}`,
          kind: 'bolt',
          p: [cx + off, s * S.padOutY, S.boltZ],
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
 * Build the stand. `update` is deliberately absent: a test stand is fixed
 * hardware, and test/stand.test.mjs asserts it (a moving mount would make the
 * measured clearances meaningless).
 */
export function createStand(materials) {
  const group = new THREE.Group();
  group.name = 'test-stand';
  for (const m of standSpecs()) {
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
  const I = standInterfaces();
  const bolts = instancedBolts(
    standBolts(),
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
