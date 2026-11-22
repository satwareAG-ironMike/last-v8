// The iron an oil drilling may be bored in, and the air it may not be bored in.
// Slice 8D-1 (issue #8 addendum item 5, GATES row A1-G4): this is the oracle
// test/oil.test.mjs law 7 measures against, and the same map tmp/8d-oilnet.mjs
// proves every planned route with before src/engine/oil.js exists.
//
// Why it is built this way:
//   Rings, lathes and half rings stay ANALYTIC. The bbox of a lathe ring contains
//   the air in its own bore, so a point test against such a bbox calls air iron.
//   Every radius here is the published one src/render/*.js draws the part at.
//   Plain rectangular drawn solids are measured LIVE off the tree, so the map
//   cannot drift away from the casting without warrant() throwing.
//   warrant() reads the drawn tree: the census, every derived part's bbox, and the
//   machined plane values of each merged cam housing. A gate whose oracle agrees
//   with the drawing is a gate; one that agrees with itself is decoration.
//
// Nothing here reads src/engine/oil.js: a gate that asks the thing it gates where
// the iron is has no teeth.

import * as THREE from 'three';
import {
  SPEC, DEG, MAIN_CAPS_X, bankUp, bankOut, camAxisBank, endDiscFaceX, HEAD_TOP_A,
  idHalfDepth, mainCapLug, supportColumn,
} from '../../src/engine/spec.js';
import { ohvBearings, ohvHousing, panPlanes } from '../../src/engine/layout.js';
import { bearingStack } from '../../src/engine/bearings.js';
import { createBlock } from '../../src/render/block.js';
import { createCranktrain } from '../../src/render/cranktrain.js';
import { createHeads } from '../../src/render/heads.js';

const B = SPEC.block;
const HH = SPEC.head;
const CAM = SPEC.cam;
const CR = SPEC.crank;
const ST = bearingStack();
const OHV = ohvHousing();
const OB = ohvBearings();

const OD = B.caseOuterRadius; // 11.6 the crankcase casting OD
const ID = B.crankcaseRadius; // 9.4 the crankcase void
const X_SLAB = B.stations[0] + B.pitch / 2; // 22 where the station slabs end
const X_FACE = endDiscFaceX(); // 26.5 the fore/aft end faces
const SHELL_IN = CR.mainRadius + 0.05; // 2.75 a main shell's inside
const SHELL_OUT = SHELL_IN + 0.7; // 3.45 its outside, pressed into the bush bore
const SHELL_HALF = 0.85; // a main shell ring spans the cap width
const LINER_OD = B.boreShellRadius + 0.15; // 5.45 the press fit the liners use
const LINER_IN = B.boreRadius; // 5.1 the bore the liner is machined to
const FILM = 0.005; // a face counts as iron, not as the solid it is the face of

// ---- head casting topology, read from the same published values heads.js uses --
const FACE = B.deckA + HH.gasketT; // 24.25 the head deck face
const RAIL = HH.railTopA; // 27.0 the machined clamping plane
const CAM_A = camAxisBank('L', 'intake')[0]; // cam axis `along`, identical both lines
const EDGE = 28.55; // fore/aft head faces
const DECK_X0 = B.stations[3] - B.pitch / 2; // -22 where the block deck ends
const DECK_X1 = B.stations[0] + B.pitch / 2; //  22
const STAY_TOP = HH.stayTopA; // 30.0 top plane of the deck ribs the bucket towers stand on
const PORT_TOP = CAM_A - 3.4; // 32.58 the port bulkhead plane heads.js casts, clear of every column
const PORT_SETBACK = 2.0; // src/render/heads.js: how far each bulkhead stands off its station
const PORT_OUT = 7.95; // its outboard face, and the mid webs' outboard face too
const PORT_MID_IN = 6.45; // the mid webs' inboard face: the header flange band stands on it
const MID_X = SPEC.manifold.exMergeX; // 11 the pair-merge plane each mid bulkhead is centred on
const STAY_HALF = 1.7; // the deck rib half width SPEC.manifold.exFlangeX names
const COL_W = CAM.bearingHalf; // a column spans exactly the bearing width
const HOUSING_W = COL_W + 0.4;
const HOUSING_FUSE = 0.10; // a housing web's top face into the column OD band
const HOUSING_IN = HH.gasketId + 0.1; // base inboard edge, clear of the gasket
const HOUSING_OUT = HH.gasketOd; // base outboard edge, the machined head face
const HOUSING_RIB0 = SPEC.manifold.exFlangeA1 + 0.2; // a tie rib starts above the flange
const WEB_TOP = CAM_A - ST.castOdR; // the tunnel tops the column out here
const HOUSING_TOP = WEB_TOP + HOUSING_FUSE;
const CAP_TOP = CAM_A + ST.castOdR; // machined split-cap plane, the cover seats on it
const COVER_INSET = 0.1; // a cover wall stands inset from the riser edge it sits on
const COVER_X = 28.05; // cover wall fore/aft extent
const COVER_IN = ST.housingInRel + COVER_INSET; // cover wall inner faces
const COVER_CEIL = HEAD_TOP_A - HH.coverPlate; // cover ceiling, clears the lobe sweep

/** A gallery leaves the published wall between itself and every machined face. */
export const oilWall = () => ({
  galleryR: (OD - ID) / 2 - ST.housingWall, // 0.50 bored at the wall mid radius
  wallMinCm: ST.housingWall, // 0.60, the thaviest published wall in this engine
  midR: (ID + OD) / 2, // 10.50
  feedDrillR: ST.oilHoleR, // 0.10 the published radial oil way in every shell
});

/* ------------------------------------------------------------------ frames -- */

const EPS = 1e-6;
const span = (a, b) => [Math.min(a, b), Math.max(a, b)];
const r2 = (y, z) => Math.hypot(y, z);
const clamp1 = (v) => Math.min(1, Math.max(-1, v));

function frames() {
  const F = {};
  for (const bank of ['L', 'R']) {
    const u = bankUp(bank);
    const v = bankOut(bank);
    if (Math.abs(r2(u[1], u[2]) - 1) > 1e-9 || Math.abs(r2(v[1], v[2]) - 1) > 1e-9) {
      throw new Error(`bank ${bank}: bankUp/bankOut is not a unit frame`);
    }
    if (Math.abs(u[1] * v[1] + u[2] * v[2]) > 1e-9) throw new Error(`bank ${bank}: frame not orthogonal`);
    F[bank] = {
      u, v,
      // world point -> (x, along up the bore axis, out outboard away from the V)
      of: (p) => ({ x: p[0], a: p[1] * u[1] + p[2] * u[2], o: p[1] * v[1] + p[2] * v[2] }),
    };
  }
  return F;
}

const F = frames();

/** psi: 0 crown-ward, 180 deck-ward, the convention bearings.js publishes. */
const psiOf = (aRel, oRel) => {
  const d = (Math.atan2(oRel, aRel) * 180) / Math.PI;
  return d > 180 ? d - 360 : d;
};
const psiIn = (psi, lo, hi, m = 0) => {
  let d = psi;
  while (d < lo + m) d += 360;
  return d <= hi - m;
};

/* ------------------------------------------------------- derived geometry --- */

/** The five rectangles every cam bearing housing is merged from. */
function housingRects(bank, valve, bx) {
  const O = camAxisBank(bank, valve)[1];
  const s = Math.sign(O); // which side of the bore axis this cam line stands on
  const baseOut = s * HOUSING_OUT; // the base web edge on the machined head face
  const baseIn = s * HOUSING_IN;
  const riserOut = [O + s * ST.housingInRel, O + s * ST.housingOutRel]; // past the wrench
  const riserIn = [O - s * ST.housingInRel, O - s * ST.housingOutRel];
  const x0 = Math.max(bx - HOUSING_W, -EDGE);
  const x1 = Math.min(bx + HOUSING_W, EDGE);
  const at = (a0, a1, o0, o1, tag) => {
    const [lo, hi] = span(o0, o1);
    return { tag, bx, bank, valve, a0, a1, o0: lo, o1: hi, x0, x1,
      rel: (o) => (o - O) * s }; // outboard positive, measured off the cam line
  };
  // a tie rib runs from the base web edge out to the FACE of its riser that lies
  // farthest off the cam line, so every riser stands on iron all the way down
  const outFar = O + s * ST.housingOutRel;
  const inFar = O - s * ST.housingOutRel;
  return [
    at(FACE, HOUSING_TOP, baseIn, baseOut, 'web'),
    at(HOUSING_RIB0, HOUSING_TOP, baseOut, outFar, 'rib-out'),
    at(HOUSING_RIB0, HOUSING_TOP, inFar, baseIn, 'rib-in'),
    at(HOUSING_TOP, CAP_TOP, ...riserOut, 'riser-out'),
    at(HOUSING_TOP, CAP_TOP, ...riserIn, 'riser-in'),
  ];
}

/** The internal corner between a housing top plane and the round column it fuses into. */
function cornerPocket(bank, valve, bx) {
  const [A, O] = camAxisBank(bank, valve);
  return {
    bank, valve, bx, A, O,
    aFrom: HOUSING_TOP,
    aTo: (oRel) => A - Math.sqrt(Math.max(0, ST.castOdR ** 2 - oRel ** 2)),
    oMax: ST.castOdR,
    x0: bx - HOUSING_W, x1: bx + HOUSING_W,
  };
}

/* ------------------------------------------------------------- the block ----- */

/**
 * The OHV section block.js casts: the drum with the bored tunnel cut through its
 * lower wall, plus the skirt that carries the machined tunnel floor. Same material
 * predicate tmp/ohvdrum.mjs proves against the drawn solid, from ohvHousing().
 */
function ohvMaterial(y, z) {
  const C = OHV.belowCrankCm;
  const strip = Math.abs(y) <= OHV.skirtHalfY && z >= OHV.skirtZ && z <= -Math.sqrt(OD * OD - y * y);
  const inCasting = r2(y, z) <= OD || strip;
  return inCasting && r2(y, z) >= ID && r2(y, z + C) >= OHV.tunnelBoreR;
}

const LUG = mainCapLug(); // 3.0..4.6 out, -8.9 top, -11.5 bottom
const SHELL_TOP = -SHELL_OUT + 0.1; // a neck/cap top face stands 0.1 into the shell ring

function blockParts(id) {
  const P = panPlanes(id);
  const H = id === 'ohv';
  const railX = H ? X_FACE : X_SLAB; // the casting length each variant bolts its sump to
  const out = [];
  const push = (name, test, claim) => out.push({ name, drawn: name, test, claim, group: 'block' });
  const bossF = B.mainBossR + 0.1;
  const bossA = B.aftMainBossR + 0.1;
  const drumTop = OD; // the drum's own outer face
  const castBottom = Math.min(H ? OHV.skirtZ : -OD, -OD); // its lowest cast face

  push('crankcase', H
    ? (p) => Math.abs(p[0]) <= X_SLAB + EPS && ohvMaterial(p[1], p[2])
    : (p) => Math.abs(p[0]) <= X_SLAB + EPS && r2(p[1], p[2]) >= ID - EPS && r2(p[1], p[2]) <= OD + EPS,
    H ? claimWorld(-X_SLAB, X_SLAB, -OD, OD, OHV.skirtZ, drumTop) : claimLathe(-X_SLAB, X_SLAB, ID, OD));
  push('end-disc-fore', H
    ? (p) => p[0] >= X_SLAB - EPS && p[0] <= X_FACE + EPS && ohvMaterial(p[1], p[2])
      && r2(p[1], p[2]) >= B.mainBossR - EPS
    : (p) => p[0] >= X_SLAB - EPS && p[0] <= X_FACE + EPS && r2(p[1], p[2]) >= B.mainBossR - EPS
      && r2(p[1], p[2]) <= OD + EPS,
    H ? claimWorld(X_SLAB, X_FACE, -OD, OD, OHV.skirtZ, drumTop) : claimLathe(X_SLAB, X_FACE, B.mainBossR, OD));
  push('end-disc-aft', H
    ? (p) => p[0] <= -X_SLAB + EPS && p[0] >= -X_FACE - EPS && ohvMaterial(p[1], p[2])
      && r2(p[1], p[2]) >= B.aftMainBossR - EPS
    : (p) => p[0] <= -X_SLAB + EPS && p[0] >= -X_FACE - EPS && r2(p[1], p[2]) >= B.aftMainBossR - EPS
      && r2(p[1], p[2]) <= OD + EPS,
    H ? claimWorld(-X_FACE, -X_SLAB, -OD, OD, OHV.skirtZ, drumTop) : claimLathe(-X_FACE, -X_SLAB, B.aftMainBossR, OD));
  push('main-bush-fore', (p) => p[0] >= 23.4 - EPS && p[0] <= 25.6 + EPS
    && r2(p[1], p[2]) >= SHELL_OUT - 0.05 - EPS && r2(p[1], p[2]) <= bossF + EPS,
    claimLathe(23.4, 25.6, SHELL_OUT - 0.05, bossF));
  push('main-bush-aft', (p) => p[0] >= -25.6 - EPS && p[0] <= -23.4 + EPS
    && r2(p[1], p[2]) >= SHELL_OUT - 0.05 - EPS && r2(p[1], p[2]) <= bossA + EPS,
    claimLathe(-25.6, -23.4, SHELL_OUT - 0.05, bossA));

  for (const bank of ['L', 'R']) {
    const col = supportColumn(bank);
    const web = idHalfDepth(B.boreWallHalf);
    const f = F[bank];
    for (const s of B.stations) {
      push(`column-${bank}-${s}`, (p) => {
        const q = f.of(p);
        return q.a >= col.along0 - EPS && q.a <= B.deckA + EPS && q.o >= B.boreWallHalf - EPS
          && q.o <= B.deckHalfWidth + EPS && q.x >= s - 5.5 - EPS && q.x <= s + 5.5 + EPS;
      }, claimBank(bank, { a0: col.along0, a1: B.deckA, o0: B.boreWallHalf, o1: B.deckHalfWidth, x0: s - 5.5, x1: s + 5.5 }));
      push(`web-${bank}-${s}`, (p) => {
        const q = f.of(p);
        return q.a >= web - EPS && q.a <= B.deckA + EPS && q.o <= -B.boreWallHalf + EPS
          && q.o >= -B.deckHalfWidth - EPS && q.x >= s - 5.5 - EPS && q.x <= s + 5.5 + EPS;
      }, claimBank(bank, { a0: web, a1: B.deckA, o0: -B.deckHalfWidth, o1: -B.boreWallHalf, x0: s - 5.5, x1: s + 5.5 }));
    }
  }

  for (const c of MAIN_CAPS_X) {
    if (c === MAIN_CAPS_X[0] || c === MAIN_CAPS_X[4]) continue; // fore/aft ride the end discs
    if (H) {
      // two boot legs share the name, one standing on each side of the bored tunnel
      push(`main-neck-x${c}`, (p) => Math.abs(p[0] - c) <= 0.8 + EPS
        && Math.abs(p[1]) >= OHV.skirtInboardY - EPS && Math.abs(p[1]) <= OHV.skirtHalfY + EPS
        && p[2] >= OHV.skirtCornerZ - EPS && p[2] <= SHELL_TOP + EPS,
        claimWorld(c - 0.8, c + 0.8, -OHV.skirtHalfY, OHV.skirtHalfY, OHV.skirtCornerZ, SHELL_TOP));
      const crownZ = -(OHV.belowCrankCm - OHV.tunnelWallR); // the cast crown of the tunnel
      for (const sgn of [1, -1]) {
        const [y0, y1] = sgn > 0 ? [0, LUG.y1] : [-LUG.y1, 0]; // the cap bar reaches the full lug width
        push(`main-cap-${c}${sgn > 0 ? '+' : '-'}`, (p) => Math.abs(p[0] - c) <= 2.3 + EPS
          && p[1] >= y0 - EPS && p[1] <= y1 + EPS && p[2] >= crownZ - EPS && p[2] <= SHELL_TOP + EPS,
          claimWorld(c - 2.3, c + 2.3, y0, y1, crownZ, SHELL_TOP));
      }
    } else {
      push(`main-neck-x${c}`, (p) => Math.abs(p[0] - c) <= 0.8 + EPS
        && Math.abs(p[1]) <= 3.1 + EPS && p[2] >= LUG.zBottom - EPS && p[2] <= SHELL_TOP + EPS,
        claimWorld(c - 0.8, c + 0.8, -3.1, 3.1, LUG.zBottom, SHELL_TOP));
      push(`main-cap-${c}+`, (p) => Math.abs(p[0] - c) <= 2.3 + EPS
        && Math.abs(p[1]) >= LUG.y0 - EPS && Math.abs(p[1]) <= LUG.y1 + EPS
        && p[2] >= LUG.zBottom - EPS && p[2] <= LUG.zTop + EPS,
        claimWorld(c - 2.3, c + 2.3, LUG.y0, LUG.y1, LUG.zBottom, LUG.zTop));
      push(`main-cap-${c}-`, (p) => Math.abs(p[0] - c) <= 2.3 + EPS && Math.abs(p[1]) <= -LUG.y0 + EPS
        && Math.abs(p[1]) >= -LUG.y1 - EPS && p[2] >= LUG.zBottom - EPS && p[2] <= LUG.zTop + EPS,
        claimWorld(c - 2.3, c + 2.3, -LUG.y1, -LUG.y0, LUG.zBottom, LUG.zTop));
    }
  }

  push('pan-rails', (p) => Math.abs(p[0]) <= railX + EPS
    && Math.abs(p[1]) <= P.flangeHalfY + EPS && p[2] >= P.railZ - EPS && p[2] <= P.flangeZ + EPS,
    claimWorld(-railX, railX, -P.flangeHalfY, P.flangeHalfY, P.railZ, P.flangeZ));
  void castBottom;
  return out;
}

/* ------------------------------------------------------------- the heads ----- */

const VALVES = ['intake', 'exhaust'];

/**
 * Live polar witness of a drawn solid about an axis: its radial band, its extent
 * along the axis, and the azimuth range its surface actually covers. Rings, half
 * rings and lathes can only be proven this way: their WORLD bbox contains the air
 * of their own bore, so a bbox comparison proves nothing about the radius.
 *   'xline'     axis = world X through (cy, cz)         azimuth about that line
 *   'bankline'  axis = world X through the bank point (A, O)
 *   'bankUp'    axis = the bank bore axis through (station, 0)
 */
function polar(meshes, mode, p) {
  const out = { x0: Infinity, x1: -Infinity, a0: Infinity, a1: -Infinity, r0: Infinity, r1: -Infinity, psi0: Infinity, psi1: -Infinity };
  const push = (r, psi, ax) => {
    out.r0 = Math.min(out.r0, r); out.r1 = Math.max(out.r1, r);
    let d = (psi * 180) / Math.PI;
    // Wrap relative to the MIDDLE of the published window, not its start: an arc
    // endpoint machined at exactly +/-90 carries cos(90) = 6e-17 of numerical slop
    // past its own bound, and a start-anchored window reads that slop as a
    // 360-degree jump. Mid-anchored, the endpoint stays where it was machined.
    if (mode === 'bankline') {
      const mid = (p.psi0 + p.psi1) / 2;
      while (d - mid > 180) d -= 360;
      while (d - mid < -180) d += 360;
    }
    out.psi0 = Math.min(out.psi0, d); out.psi1 = Math.max(out.psi1, d);
    if (ax !== undefined) { out.x0 = Math.min(out.x0, ax); out.x1 = Math.max(out.x1, ax); }
  };
  const bank = p.bank;
  for (const mesh of meshes) {
    const pos = mesh.geometry.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      if (mode === 'xline') {
        push(Math.hypot(v.y - p.cy, v.z - p.cz), Math.atan2(v.z - p.cz, v.y - p.cy), v.x);
      } else if (mode === 'bankline') {
        const q = F[bank].of([v.x, v.y, v.z]);
        push(Math.hypot(q.a - p.A, q.o - p.O), Math.atan2(q.o - p.O, q.a - p.A), v.x);
      } else {
        const q = F[bank].of([v.x, v.y, v.z]);
        push(Math.hypot(q.x - p.s, q.o), Math.atan2(q.o, q.x - p.s), q.a);
      }
    }
  }
  if (mode === 'bankUp') { out.a0 = out.x0; out.a1 = out.x1; out.x0 = out.x1 = undefined; }
  return out;
}

/**
 * Live bank-frame extents of one drawn solid, over every mesh that name casts.
 * A boxInBank solid is exact in the frame it was cast in and only inset in the
 * world axes, because the cast fillet rounds corners INSIDE its own outline.
 */
function boxSpan(meshes, bank) {
  const u = F[bank].u;
  const v = F[bank].v;
  const o = { x0: Infinity, x1: -Infinity, a0: Infinity, a1: -Infinity, o0: Infinity, o1: -Infinity };
  const p = new THREE.Vector3();
  const eat = (q) => {
    o.x0 = Math.min(o.x0, q.x); o.x1 = Math.max(o.x1, q.x);
    o.a0 = Math.min(o.a0, q.a); o.a1 = Math.max(o.a1, q.a);
    o.o0 = Math.min(o.o0, q.o); o.o1 = Math.max(o.o1, q.o);
  };
  for (const mesh of meshes) {
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      eat({ x: p.x, a: p.y * u[1] + p.z * u[2], o: p.y * v[1] + p.z * v[2] });
    }
  }
  return o;
}

/** Live world AABB of one drawn solid, over every mesh that name casts. */
function worldSpan(meshes) {
  const b = new THREE.Box3();
  for (const mesh of meshes) b.expandByObject(mesh);
  return b;
}

/* ---------------------------------------------------------------- claims ----
 * A claim states the extents a drawn part must measure IN THE FRAME IT WAS CAST
 * IN. Comparing a bank-cast part to a world-axes box is not a check: it measures
 * the casting through a frame the casting was never built in. Every claim below
 * names its frame, and warrant() measures the tree in that same frame.
 *   world     a worldBox / machined extrusion: world x,y,z
 *   bank      a boxInBank solid: along, out, x in the bank frame
 *   lathe     a solid of revolution about a world-X line at (cy, cz): radial
 *             band + the axial window; its WORLD bbox is its own bore air
 *   latheBank a lathe about one bank bore axis at station s: band + along window
 *   arc       a half ring about the cam axis line: band, azimuth window, x window
 *   planes    a merged casting: the machined bank planes its faces stand on
 */
const claimWorld = (x0, x1, y0, y1, z0, z1) => ({ frame: 'world', x0, x1, y0, y1, z0, z1 });
const claimBank = (bank, r) => ({ frame: 'bank', bank, ...r });
const claimLathe = (x0, x1, r0, r1, cy = 0, cz = 0) => ({ frame: 'lathe', x0, x1, r0, r1, cy, cz });
const claimLatheBank = (bank, s, a0, a1, r0, r1) => ({ frame: 'latheBank', bank, s, a0, a1, r0, r1 });
const claimArc = (bank, A, O, psi0, psi1, r0, r1, x0, x1) => ({ frame: 'arc', bank, A, O, psi0, psi1, r0, r1, x0, x1 });

/** Bank-frame bbox of every up-facing/bot-facing machined plane of a merged solid. */
function planeWitness(mesh, bank) {
  const u = new THREE.Vector3().fromArray(bankUp(bank));
  const v = new THREE.Vector3().fromArray(bankOut(bank));
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const idx = geo.index;
  const count = idx ? idx.count : pos.count;
  const a = new THREE.Vector3();
  const n = new THREE.Vector3();
  const planes = new Map(); // plane `along` value -> out span seen on it
  for (let i = 0; i < count; i += 3) {
    const k = idx ? [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)] : [i, i + 1, i + 2];
    n.fromBufferAttribute(nrm, k[0]).transformDirection(mesh.matrixWorld);
    const face = (j) => {
      a.fromBufferAttribute(pos, k[j]).applyMatrix4(mesh.matrixWorld);
      return { along: a.dot(u), out: a.dot(v) };
    };
    const dots = [0, 1, 2].map((j) => {
      const m = new THREE.Vector3().fromBufferAttribute(nrm, k[j]).transformDirection(mesh.matrixWorld);
      return m.dot(u);
    });
    if (!dots.every((d) => d > 0.999) && !dots.every((d) => d < -0.999)) continue; // a side or chamfer
    const key = face(0).along.toFixed(3);
    for (const j of [0, 1, 2]) {
      const q = face(j);
      const got = planes.get(key) ?? planes.set(key, { o0: q.out, o1: q.out, up: dots[0] > 0 }).get(key);
      got.o0 = Math.min(got.o0, q.out);
      got.o1 = Math.max(got.o1, q.out);
    }
  }
  void v;
  return planes;
}

export const camGroups = (bank, valve) => CAM.bearings.map((bx) => ({
  key: `cam-${bank}-${valve}-${bx}`,
  bank, valve, bx,
  line: camAxisBank(bank, valve),
  rects: housingRects(bank, valve, bx),
  pocket: cornerPocket(bank, valve, bx),
}));

function headParts() {
  const out = [];
  const push = (name, test, claim) => out.push({ name, drawn: name, test, claim, group: 'head' });
  const rect = (bank, r) => ({ frame: 'bank', bank, ...r });
  const inRect = (bank, r) => (p) => {
    const q = F[bank].of(p);
    return q.a >= r.a0 - EPS && q.a <= r.a1 + EPS && q.o >= r.o0 - EPS && q.o <= r.o1 + EPS
      && q.x >= r.x0 - EPS && q.x <= r.x1 + EPS;
  };
  /** The bank-frame rect a boxInBank solid is cast to, published from SPEC. */
  const rib = (bank, tag, side) => {
    const [o0, o1] = side > 0 ? [HH.gasketId, HH.gasketOd] : [-HH.gasketOd, -HH.gasketId];
    return { a0: FACE, a1: tag === 'rail' ? RAIL : STAY_TOP, o0, o1 };
  };
  for (const bank of ['L', 'R']) {
    // 1. deck rails: the machined clamping band, standing on the compressed gasket
    for (const side of [1, -1]) {
      const r = { ...rib(bank, 'rail', side), x0: DECK_X0, x1: DECK_X1 };
      push(`rail-${bank}-${side > 0 ? 'out' : 'in'}`, inRect(bank, r), rect(bank, r));
    }
    // 2. bulkheads: the fore/aft end walls close the casting over the end cam
    //    bearings, the two centre webs are the exhaust port runners standing on
    //    the pair-merge plane. Their x windows are the planes heads.js casts at,
    //    every one of them derived from a published SPEC station or flange value.
    const ports = [
      ['fore', DECK_X1 - PORT_SETBACK, EDGE, -PORT_OUT, PORT_OUT],
      ['aft', -EDGE, -DECK_X1 + PORT_SETBACK, -PORT_OUT, PORT_OUT],
      ['mid1', MID_X - PORT_SETBACK, MID_X + PORT_SETBACK, PORT_MID_IN, PORT_OUT],
      ['mid2', -(MID_X + PORT_SETBACK), -(MID_X - PORT_SETBACK), PORT_MID_IN, PORT_OUT],
    ];
    for (const [tag, x0, x1, o0, o1] of ports) {
      const r = { a0: FACE, a1: PORT_TOP, o0, o1, x0, x1 };
      push(`chimney-${bank}-${tag}`, inRect(bank, r), rect(bank, r));
    }
    // 3. deck ribs: each cylinder stands on an outboard rib and its mirror
    for (const st of B.stations) {
      for (const side of [1, -1]) {
        const r = { ...rib(bank, 'stay', side), x0: st - STAY_HALF, x1: st + STAY_HALF };
        push(`stay-${bank}-${side > 0 ? 'out' : 'in'}-${st}`, inRect(bank, r), rect(bank, r));
      }
    }
  }
  for (const bank of ['L', 'R']) {
    for (const valve of VALVES) {
      const [A, O] = camAxisBank(bank, valve);
      for (const bx of CAM.bearings) {
        // the split tunnel: cradle iron on the deck side of the split plane, cap on
        // the crown side, both bored to the published line bore and topped at the OD
        for (const [tag, psi0, psi1] of [['cradle', 90, 270], ['cap', -90, 90]]) {
          const name = `${tag}-${bank}-${valve}-${bx}`;
          push(name, (p) => {
            const q = F[bank].of(p);
            const aRel = q.a - A;
            const oRel = q.o - O;
            const rr = Math.hypot(aRel, oRel);
            return rr >= ST.boreR - EPS && rr <= ST.castOdR + EPS && Math.abs(q.x - bx) <= COL_W + EPS
              && psiIn(psiOf(aRel, oRel), psi0, psi1);
          }, claimArc(bank, A, O, psi0, psi1, ST.boreR, ST.castOdR, bx - COL_W, bx + COL_W));
        }
        // The housing is ONE merged casting built from the five published rectangles:
        // one claimed solid, whose witness is the set of machined planes it machines.
        const rects = housingRects(bank, valve, bx);
        const name = `housing-${bank}-${valve}-${bx}`;
        push(name, (p) => rects.some((r) => inRect(bank, r)(p)),
          { frame: 'planes', bank, planes: [FACE, HOUSING_RIB0, HOUSING_TOP, CAP_TOP], rects });
      }
    }
  }
  return out;
}

/* ------------------------------------------- drawn solids a drill must miss -- */

function drawnSolids(id) {
  const out = [];
  const push = (name, test) => out.push({ name, test });
  for (const c of MAIN_CAPS_X) {
    push(`main-shell-x${c}`, (p) => r2(p[1], p[2]) >= SHELL_IN + FILM && r2(p[1], p[2]) <= SHELL_OUT - FILM
      && Math.abs(p[0] - c) <= SHELL_HALF - FILM);
  }
  for (const cyl of SPEC.cylinders) {
    const s = B.stations[cyl.station];
    const f = F[cyl.bank];
    push(`liner-cyl${cyl.num}`, (p) => {
      const q = f.of(p);
      return Math.hypot(q.x - s, q.o) >= LINER_IN + FILM && Math.hypot(q.x - s, q.o) <= LINER_OD - FILM
        && q.a >= B.boreStartA - EPS && q.a <= B.deckA + EPS;
    });
  }
  if (id === 'ohv') {
    const C = OHV.belowCrankCm;
    OB.windows.forEach(([a, b], i) => push(`cam-bushing-${i + 1}`, (p) =>
      p[0] >= a - EPS && p[0] <= b + EPS && r2(p[1], p[2] + C) >= OB.shellIdR + FILM
      && r2(p[1], p[2] + C) <= OB.boreR - FILM));
  }
  for (const bank of ['L', 'R']) {
    for (const valve of VALVES) {
      const [A, O] = camAxisBank(bank, valve);
      const f = F[bank];
      for (const bx of CAM.bearings) {
        // the shells are the two halves of the split line bore, named as heads.js names them
        for (const [tag, psi0, psi1] of [['cap', -90, 90], ['cradle', 90, 270]]) {
          push(`shell-${bank}-${valve}-${bx}-${tag}`, (p) => {
            const q = f.of(p);
            const aRel = q.a - A;
            const oRel = q.o - O;
            return Math.hypot(aRel, oRel) >= ST.shellIdR + FILM && Math.hypot(aRel, oRel) <= ST.boreR - FILM
              && Math.abs(q.x - bx) <= COL_W - FILM && psiIn(psiOf(aRel, oRel), psi0 + FILM, psi1 - FILM);
          });
        }
        for (const crown of [true, false]) {
          const a0 = crown ? ST.tabInset : -(ST.tabInset + ST.tabH);
          const a1 = crown ? ST.tabInset + ST.tabH : -ST.tabInset;
          for (const side of [1, -1]) {
            const [o0, o1] = span(O + side * ST.boreR, O + side * ST.tabR);
            push(`tab-${bank}-${valve}-${bx}-${crown ? 'cap' : 'cradle'}-${side > 0 ? 'o' : 'i'}`, (p) => {
              const q = f.of(p);
              return q.a >= A + a0 - EPS && q.a <= A + a1 + EPS && q.o >= o0 + FILM && q.o <= o1 - FILM
                && Math.abs(q.x - bx) <= ST.tabHalf - FILM;
            });
            push(`bolt-hole-${bank}-${valve}-${bx}-${crown ? 'cap' : 'cradle'}-${side > 0 ? 'o' : 'i'}`,
              (p) => {
                const q = f.of(p);
                return r2(q.a - (A + (a0 + a1) / 2), q.o - (O + side * ST.boltOutRel)) <= ST.boltHoleR - FILM
                  && Math.abs(q.x - bx) <= ST.tabHalf - FILM;
              });
          }
        }
      }
    }
  }
  return out;
}

/* ---------------------------------------------------- named voids and oil ---- */

function voids(id) {
  const out = [];
  const push = (name, test) => out.push({ name, test });
  push('crankcase-void', (p) => Math.abs(p[0]) <= X_SLAB + EPS && r2(p[1], p[2]) < ID - EPS);
  push('main-bore-fore', (p) => p[0] > X_SLAB + EPS && p[0] <= X_FACE + EPS && r2(p[1], p[2]) < B.mainBossR - EPS);
  push('main-bore-aft', (p) => p[0] < -X_SLAB - EPS && p[0] >= -X_FACE - EPS && r2(p[1], p[2]) < B.aftMainBossR - EPS);
  if (id === 'ohv') {
    const C = OHV.belowCrankCm;
    push('ohv-cam-tunnel', (p) => Math.abs(p[0]) <= X_FACE + EPS && r2(p[1], p[2] + C) < OHV.tunnelBoreR - EPS);
  }
  for (const cyl of SPEC.cylinders) {
    const s = B.stations[cyl.station];
    const f = F[cyl.bank];
    push(`bore-cyl${cyl.num}`, (p) => {
      const q = f.of(p);
      return Math.hypot(q.x - s, q.o) < LINER_IN - EPS && q.a >= B.boreStartA - EPS && q.a <= CAM_A + EPS;
    });
  }
  for (const bank of ['L', 'R']) {
    for (const valve of VALVES) {
      const [A, O] = camAxisBank(bank, valve);
      for (const bx of CAM.bearings) {
        push(`cam-bore-${bank}-${valve}-${bx}`, (p) => {
          const q = F[bank].of(p);
          return Math.hypot(q.a - A, q.o - O) < ST.boreR - EPS && Math.abs(q.x - bx) <= COL_W + EPS;
        });
      }
    }
  }
  return out;
}

function oilSpaces(id) {
  const P = panPlanes(id);
  const out = [];
  const push = (name, test) => out.push({ name, test });
  push('oil-pan', (p) => Math.abs(p[0]) <= (id === 'ohv' ? X_FACE - 1 : X_SLAB - 1) + EPS
    && Math.abs(p[1]) <= P.wallHalfY + EPS && p[2] >= P.panBottomZ - EPS && p[2] <= P.railZ + EPS);
  for (const c of MAIN_CAPS_X) {
    push(`film-main-x${c}`, (p) => r2(p[1], p[2]) >= CR.mainRadius - EPS && r2(p[1], p[2]) <= SHELL_IN + EPS
      && Math.abs(p[0] - c) <= SHELL_HALF + EPS);
  }
  for (const bank of ['L', 'R']) {
    for (const valve of VALVES) {
      const [A, O] = camAxisBank(bank, valve);
      const side = Math.sign(O);
      // the enclosed channel under the bolt-on cam cover: its floor is the machined
      // cap plane, its ceiling the cover plate, its sides the cover walls
      push(`oil-trough-cam-${bank}-${valve}`, (p) => {
        const q = F[bank].of(p);
        return q.a >= CAP_TOP - EPS && q.a <= COVER_CEIL + EPS && Math.abs(q.x) <= COVER_X + EPS
          && q.o >= O - COVER_IN + EPS && q.o <= O + COVER_IN + EPS;
      });
      for (const bx of CAM.bearings) {
        push(`film-cam-${bank}-${valve}-${bx}`, (p) => {
          const q = F[bank].of(p);
          const rr = Math.hypot(q.a - A, q.o - O);
          return rr >= ST.journalR - EPS && rr <= ST.shellIdR + EPS && Math.abs(q.x - bx) <= COL_W + EPS;
        });
        // the internal corner between a housing top plane and the round column
        push(`oil-corner-cam-${bank}-${valve}-${bx}`, (p) => {
          const q = F[bank].of(p);
          const oRel = (q.o - O) * side;
          const top = A - Math.sqrt(Math.max(0, ST.castOdR ** 2 - oRel ** 2));
          return q.a >= HOUSING_TOP - EPS && q.a <= top + EPS && Math.abs(oRel) <= ST.castOdR + EPS
            && q.x >= bx - HOUSING_W - EPS && q.x <= bx + HOUSING_W + EPS;
        });
        // the sump around a bearing column: bounded inboard by the column OD, outboard
        // by the housing riser leg's inner face, below by the tie rib top plane and
        // above by CAP_TOP where the cover seats. This is where oil stands around a
        // shell's own oil way, and it drains up into the cover trough.
        push(`oil-sump-cam-${bank}-${valve}-${bx}`, (p) => {
          const q = F[bank].of(p);
          const oRel = (q.o - O) * side;
          return q.a >= HOUSING_TOP - EPS && q.a <= CAP_TOP + EPS
            && Math.abs(oRel) >= ST.castOdR - EPS && Math.abs(oRel) <= ST.housingInRel + EPS
            && Math.abs(q.x - bx) <= HOUSING_W + EPS;
        });
      }
    }
  }
  if (id === 'ohv') {
    OB.stations.forEach((sx, i) => push(`film-ohv-cam-${i + 1}`, (p) => {
      const C = OHV.belowCrankCm;
      return r2(p[1], p[2] + C) >= OB.journalR - EPS && r2(p[1], p[2] + C) <= OB.shellIdR + EPS
        && Math.abs(p[0] - sx) <= (OB.windows[i][1] - OB.windows[i][0]) / 2 + EPS;
    }));
  }
  // the one plane every block-to-head oil passage must cross: the compressed gasket
  // band between the block deck and the head deck, outboard of the gasket bore
  for (const bank of ['L', 'R']) {
    for (const side of [1, -1]) {
      const s = side; // the name and the band agree: a route names the side it crosses
      push(`oil-deck-passage-${bank}-${s > 0 ? 'out' : 'in'}`, (p) => {
        const q = F[bank].of(p);
        return q.a >= B.deckA - EPS && q.a <= FACE + EPS && s * q.o >= HH.gasketId - EPS
          && s * q.o <= B.deckHalfWidth + EPS && Math.abs(q.x) <= X_SLAB + EPS;
      });
    }
  }
  return out;
}

/* ------------------------------------------------------- drawn tree helpers -- */

function treeMats() {
  const cache = new Map();
  return new Proxy({}, { get: (t, k) => (cache.get(k) ?? cache.set(k, new THREE.MeshStandardMaterial({ name: String(k) })).get(k)) });
}
function posedTree(root) {
  root.updateMatrixWorld(true, true);
  return root;
}
function cranktrainParts(id) {
  const root = posedTree(createCranktrain(treeMats(), id).group); // {group, update, crank}
  const list = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const b = new THREE.Box3().setFromObject(o);
    list.push({ name: o.name, min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] });
  });
  return list;
}

/* ----------------------------------------------------------------- oracle --- */

export function oilOracle(id = SPEC.build.variant) {
  if (id !== 'dohc' && id !== 'ohv') throw new Error(`oilOracle: no variant ${id}`);
  const iron = [...blockParts(id), ...headParts()];
  const solids = drawnSolids(id);
  const holes = voids(id);
  const spaces = oilSpaces(id);
  const crank = cranktrainParts(id);

  const inAny = (list, p) => {
    for (const e of list) if (e.test(p)) return e;
    return null;
  };
  /** iron | solid | void | oil | rotating | air, in the order a drill cares about. */
  const classify = (p) => {
    const rot = crank.find((c) => p[0] >= c.min[0] && p[0] <= c.max[0] && p[1] >= c.min[1] && p[1] <= c.max[1]
      && p[2] >= c.min[2] && p[2] <= c.max[2]);
    if (rot) return { state: 'rotating', name: rot.name };
    const s = inAny(solids, p);
    if (s) return { state: 'solid', name: s.name };
    const o = inAny(spaces, p);
    if (o) return { state: 'oil', name: o.name };
    const i = inAny(iron, p);
    if (i) return { state: 'iron', name: i.name };
    const v = inAny(holes, p);
    if (v) return { state: 'void', name: v.name };
    return { state: 'air', name: null };
  };
  const at = (p) => classify(p);
  const ironAt = (p) => {
    const c = classify(p);
    return c.state === 'iron' ? c.name : null;
  };

  /* drawn warrant: the map above must be the casting the tree draws. */
  const warrant = () => {
    const problems = [];
    const block = posedTree(createBlock(treeMats(), id)); // createBlock returns the Group itself
    const heads = posedTree(createHeads(treeMats()).group);
    // name -> meshes. A name may legitimately stand for several solids: the OHV
    // block casts one boot leg per side, each cam cover casts its own walls.
    const drawn = new Map();
    for (const root of [block, heads]) {
      root.traverse((o) => {
        if (!o.isMesh) return;
        const at = drawn.get(o.name) ?? [];
        at.push(o);
        drawn.set(o.name, at);
      });
    }
    // 1. every drawn part is known to the map: as iron, as a solid a drill must
    //    miss, or as the boundary of a named oil space. Fasteners, gaskets,
    //    rings and sheet covers are listed instead: they are not cast iron.
    const known = new Set();
    for (const e of [...iron, ...solids, ...spaces]) {
      for (const n of String(e.drawn ?? e.name).split('/')) known.add(n);
    }
    const NOT_CAST_IRON = /^(main-bolt|cam-retainer|pan-plug|pan-lug|oil-pan|gasket|head-bolt|cam-cap-bolt|wall-|plate$|seat-|guide-|springfloor-|springtube-|bucketbore-|cam-cover|cover-|valve|spring|retainer|liftertunnel|lifter)/;
    const MULTI_OK = /^(main-neck-x|wall-|plate$|shell-|tab-|bolt-hole-)/;
    for (const [name, meshes] of drawn) {
      const fam = name.replace(/[-+][0-9.+-]+$/, '');
      if (!known.has(name) && !known.has(fam) && !NOT_CAST_IRON.test(name) && !/[+]/.test(name)) {
        problems.push(`the map does not know drawn part ${name}`);
      }
      const claimed = iron.filter((e) => (e.drawn ?? e.name) === name).length
        + solids.filter((e) => e.name === name).length;
      if (meshes.length > 1 && !MULTI_OK.test(name) && claimed === 1) {
        problems.push(`${name}: the tree draws it ${meshes.length} times, the map has one entry`);
      }
      if (claimed > 1 && !MULTI_OK.test(name)) {
        problems.push(`${name}: the map has ${claimed} entries, the tree draws it ${meshes.length} time(s)`);
      }
    }
    // 2. every claim matches the drawn part measured IN ITS OWN FRAME. tol is
    //    flat 0.005 cm: a part cast in its own frame measures exactly its published
    //    extents there (a fillet rounds corners inside the outline, it does not
    //    move a face), so a mismatch is a real disagreement, not a fudge.
    const TOL = 0.005;
    const near = (bad, what, got, want) => {
      if (Math.abs(got - want) > TOL) bad.push(`${what} ${got.toFixed(4)}.. against the map ${want.toFixed(4)}..`);
      return Math.abs(got - want) <= TOL;
    };
    for (const e of [...iron, ...solids]) {
      const c = e.claim;
      if (!c) continue;
      const name = e.drawn ?? e.name;
      const meshes = drawn.get(name);
      if (!meshes) continue; // an analytic family the tree draws under per-side names
      const bad = [];
      if (c.frame === 'world') {
        const b = worldSpan(meshes);
        near(bad, 'drawn x', b.min.x, c.x0); near(bad, 'x', b.max.x, c.x1);
        near(bad, 'drawn y', b.min.y, c.y0); near(bad, 'y', b.max.y, c.y1);
        near(bad, 'drawn z', b.min.z, c.z0); near(bad, 'z', b.max.z, c.z1);
      } else if (c.frame === 'bank') {
        const s = boxSpan(meshes, c.bank);
        near(bad, 'drawn along', s.a0, c.a0); near(bad, 'along', s.a1, c.a1);
        near(bad, 'drawn out', s.o0, c.o0); near(bad, 'out', s.o1, c.o1);
        near(bad, 'drawn x', s.x0, c.x0); near(bad, 'x', s.x1, c.x1);
      } else if (c.frame === 'lathe') {
        const w = polar(meshes, 'xline', { cy: c.cy, cz: c.cz });
        near(bad, 'drawn inner r', w.r0, c.r0); near(bad, 'outer r', w.r1, c.r1);
        near(bad, 'drawn x', w.x0, c.x0); near(bad, 'x', w.x1, c.x1);
      } else if (c.frame === 'latheBank') {
        const w = polar(meshes, 'bankUp', { bank: c.bank, s: c.s });
        near(bad, 'drawn inner r', w.r0, c.r0); near(bad, 'outer r', w.r1, c.r1);
        near(bad, 'drawn along', w.a0, c.a0); near(bad, 'along', w.a1, c.a1);
      } else if (c.frame === 'arc') {
        const w = polar(meshes, 'bankline', { bank: c.bank, A: c.A, O: c.O, psi0: c.psi0, psi1: c.psi1 });
        near(bad, 'drawn inner r', w.r0, c.r0); near(bad, 'outer r', w.r1, c.r1);
        near(bad, 'drawn psi', w.psi0, c.psi0); near(bad, 'psi', w.psi1, c.psi1);
        near(bad, 'drawn x', w.x0, c.x0); near(bad, 'x', w.x1, c.x1);
      } else if (c.frame === 'planes') {
        const want = c.planes.map((a) => a.toFixed(3));
        const got = [...planeWitness(meshes[0], c.bank).keys()];
        const stray = got.filter((a) => !want.includes(a));
        const missing = want.filter((a) => !got.includes(a));
        if (stray.length) bad.push(`machined planes the map does not have: ${stray.join(', ')}`);
        if (missing.length) bad.push(`published planes the casting does not machine: ${missing.join(', ')}`);
      } else {
        bad.push(`claim frame ${c.frame} is not a frame warrant() knows`);
      }
      for (const b of bad) problems.push(`${name}: ${b}`);
    }
    return { ok: problems.length === 0, problems, drawnCount: drawn.size };
  };

  return {
    variant: id,
    wall: oilWall(),
    published: { OD, ID, SHELL_IN, SHELL_OUT, SHELL_TOP, LINER_IN, LINER_OD, CAM_A, CAP_TOP, HOUSING_TOP, HOUSING_RIB0, FACE, RAIL, STAY_TOP, PORT_TOP, EDGE, DECK_X0, DECK_X1, ST, OHV, OB },
    iron, solids, holes, spaces, crank, groups: (bank, valve) => camGroups(bank, valve),
    classify, at, ironAt, warrant,
    frame: F,
  };
}
