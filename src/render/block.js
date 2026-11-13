// The 60 degree V12 block casting as a union of primitives. Overlapping
// solids in the same material render as one casting; every junction is
// computed from src/engine/spec.js and pinned by test/block.test.mjs.
//
// Solids: crankcase drum shell, fore/aft end discs (with main bearing
// holes + bushes + shells), outboard deck support columns, inboard bridge
// webs, bore liners, interior main cap towers, pan rails, oil pan.
// Rule: crank counterweights swing only inside |x| < SPEC.block.counterBayHalfX
// at r <= SPEC.crank.counterRadius, so they clear the towers and end discs.
import * as THREE from 'three';
import {
  SPEC,
  OD,
  ID,
  supportColumn,
  mainCapLug,
  MAIN_CAPS_X,
  panFlangeHalfWidth,
  idHalfDepth,
} from '../engine/spec.js';
import { boxInBank, worldBox, latheX, latheBank } from './parts.js';

const B = SPEC.block;
const CR = SPEC.crank;
const LINER_OD = B.boreShellRadius + 0.15; // slips into the bore wall columns
const X_FRONT = B.stations[0] + B.pitch / 2; //  33: the deck slab ends here
const X_REAR = B.stations[B.stations.length - 1] - B.pitch / 2; // -33
const SHELL_IN = CR.mainRadius + 0.05; // bearing shell inner
const SHELL_OUT = SHELL_IN + 0.7;
const FLANGE_Z = B.panFlangeZ; // published: the test stand bolts onto these planes
const RAIL_Z = B.panRailZ;
// fore/aft bearing bushes: centred on the end caps, 1.1 cm of bearing each side
const BUSH_HALF = 1.1;
const BUSH_FORE = MAIN_CAPS_X[0];
const BUSH_AFT = MAIN_CAPS_X[MAIN_CAPS_X.length - 1];

/** Closed outer-first lathe profile for a ring about world X. */
function ringX(rOut, rIn, x0, x1) {
  return [
    [rOut, x0],
    [rOut, x1],
    [rIn, x1],
    [rIn, x0],
    [rOut, x0],
  ];
}

export function createBlock(materials) {
  const group = new THREE.Group();
  group.name = 'block';

  const put = (part, geo, mat) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = part;
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.part = part;
    m.userData.solid = true;
    group.add(m);
    return m;
  };

  // 1. crankcase drum shell: OD/ID annulus spanning the four station slabs
  put('crankcase', latheX(ringX(OD, ID, X_REAR, X_FRONT), 72), materials.castIronBlock);

  // 2. fore + aft end discs with main bearing holes, bushes and shells
  put(
    'end-disc-fore',
    latheX(ringX(OD, B.mainBossR, X_FRONT, X_FRONT + B.slabFront), 64),
    materials.castIronBlock
  );
  put(
    'end-disc-aft',
    latheX(ringX(OD, B.aftMainBossR, X_REAR - B.slabRear, X_REAR), 64),
    materials.castIronBlock
  );
  const foreBush = B.mainBossR + 0.1;
  const aftBush = B.aftMainBossR + 0.1;
  put('main-bush-fore', latheX(ringX(foreBush, SHELL_OUT - 0.05, BUSH_FORE - BUSH_HALF, BUSH_FORE + BUSH_HALF), 48), materials.castIronBlock);
  put('main-bush-aft', latheX(ringX(aftBush, SHELL_OUT - 0.05, BUSH_AFT - BUSH_HALF, BUSH_AFT + BUSH_HALF), 48), materials.castIronBlock);

  // 3. outboard deck support columns (bottom corners on the OD chord plane)
  //    + inboard bridge webs (inner corners tangent to the void wall),
  //    one pair per bank per station slab
  const aWeb = idHalfDepth(B.boreWallHalf);
  for (const bank of ['L', 'R']) {
    const col = supportColumn(bank);
    for (const s of B.stations) {
      put(
        `column-${bank}-${s}`,
        boxInBank(bank, col.along0, B.deckA, B.boreWallHalf, B.deckHalfWidth, s - 5.5, s + 5.5, 0.35),
        materials.castIronBlock
      );
      put(
        `web-${bank}-${s}`,
        boxInBank(bank, aWeb, B.deckA, -B.deckHalfWidth, -B.boreWallHalf, s - 5.5, s + 5.5, 0.35),
        materials.castIronBlock
      );
    }
  }

  // 4. bore liners: OD presses into the wall columns, top flush with the deck
  const liner = [
    [LINER_OD, B.boreStartA],
    [LINER_OD, B.deckA],
    [B.boreRadius, B.deckA],
    [B.boreRadius, B.boreStartA],
    [LINER_OD, B.boreStartA],
  ];
  for (const cyl of SPEC.cylinders) {
    put(`liner-cyl${cyl.num}`, latheBank(cyl.bank, liner, 48, B.stations[cyl.station]), materials.boreWall);
  }

  // 5. main bearing hardware.
  //    Interior mains (x 11, 0, -11): two cap lugs hugging the void wall plus a
  //    neck tower rising to the bearing shell, all outside the counterweight
  //    sweep (neck top stays at r >= SHELL_OUT, lugs stay at r > counterRadius).
  const lug = mainCapLug();
  for (const c of MAIN_CAPS_X) {
    const x0 = c - 0.9;
    const x1 = c + 0.9;
    put(`main-shell-x${c}`, latheX(ringX(SHELL_OUT, SHELL_IN, x0 + 0.05, x1 - 0.05), 40), materials.bearingShell);
    if (c !== MAIN_CAPS_X[0] && c !== MAIN_CAPS_X[MAIN_CAPS_X.length - 1]) {
      // neck stays inside the web gap (|x-c| <= 0.8 < 0.95) and never enters
      // the shell bore (top at r 3.35 > main radius 2.7) but overlaps the shell ring
      put(`main-neck-x${c}`, worldBox(c - 0.8, c + 0.8, -3.1, 3.1, lug.zBottom, -SHELL_OUT + 0.1, 0.2), materials.castIronBlock);
      put(`main-cap-${c}+`, worldBox(c - 2.3, c + 2.3, lug.y0, lug.y1, lug.zBottom, lug.zTop, 0.25), materials.castIronBlock);
      put(`main-cap-${c}-`, worldBox(c - 2.3, c + 2.3, -lug.y1, -lug.y0, lug.zBottom, lug.zTop, 0.25), materials.castIronBlock);
      put(`main-bolt-${c}+`, worldBox(c - 0.55, c + 0.55, lug.y1 - 0.1, lug.y1 + 0.75, lug.zBottom - 0.55, lug.zBottom + 0.1, 0.15), materials.fastenerDark);
      put(`main-bolt-${c}-`, worldBox(c - 0.55, c + 0.55, -lug.y1 - 0.75, -lug.y1 + 0.1, lug.zBottom - 0.55, lug.zBottom + 0.1, 0.15), materials.fastenerDark);
    }
  }

  // 6. pan rails: flat bolt pads cast across the drum bottom, then the pan
  const wRail = panFlangeHalfWidth(FLANGE_Z);
  put('pan-rails', worldBox(X_REAR, X_FRONT, -wRail, wRail, RAIL_Z, FLANGE_Z, 0.1), materials.castIronBlock);
  put('oil-pan', worldBox(X_REAR + 1, X_FRONT - 1, -(wRail - 0.25), wRail - 0.25, -14.6, RAIL_Z, 0.6), materials.paintedGraphite);
  put('pan-plug', worldBox(-18.5, -17.5, -0.5, 0.5, -15.05, -14.4, 0.2), materials.brass);

  group.userData.family = 'block';
  return group;
}
