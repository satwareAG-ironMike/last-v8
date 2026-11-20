// ---------------------------------------------------------------------------
// src/engine/layout.js - the ONE helper the build switch is read through
// (P1-G5 / P1-G7, issue #8 addendum item 1, issue #16).
//
// A DOHC head and an OHV block are two builds of one engine. Every count
// (cams, lobes, lifters, pushrods, rockers, covers), the 2:1 OHV cam drive,
// the OHV cam placement, the outline a cam clearance law has to read, and
// the engine NAME printed in the HUD, on the id plate and in the README are
// generated here from SPEC.build.variant / SPEC.variants plus the geometry
// SPEC already publishes. A renderer, the HTML shell or the README may not
// type any of these facts beside it.
// ---------------------------------------------------------------------------
import { SPEC, panFlangeHalfWidth, endDiscFaceX } from './spec.js';
import { boreR as lineBoreR, castOdR, noseR, housingInRel, housingOutRel } from './bearings.js';
import { lobeProfileRadius } from './timing.js';
import { chainPitch } from './drive.js';

/** the variant entry a switch value selects - unpublished names are refused by name */
export function variantEntry(id = SPEC.build.variant) {
  const v = SPEC.variants[id];
  if (!v) {
    throw new Error(`unknown build variant "${id}": SPEC.variants publishes ${Object.keys(SPEC.variants).join(', ')}`);
  }
  return v;
}

/** camshafts the variant runs: DOHC one line per bank side, OHV one central cam */
export function cams(id = SPEC.build.variant) {
  const v = variantEntry(id);
  return v.centralCam ? 1 : Object.keys(SPEC.banks).length * 2;
}

/** lobes: every valve of the engine is cam-driven in either variant */
export function lobes(id = SPEC.build.variant) {
  variantEntry(id);
  return SPEC.cylinders.length * 2;
}

/** follower train the variant owes per valve: DOHC rides buckets, OHV owes lifters + pushrods + rockers */
export function followers(id = SPEC.build.variant) {
  const v = variantEntry(id);
  const valves = SPEC.cylinders.length * 2;
  if (!v.centralCam) return { lifters: 0, pushrods: 0, rockers: 0, covers: 0 };
  return { lifters: valves, pushrods: valves, rockers: valves, covers: Object.keys(SPEC.banks).length };
}

/** the camshaft group names the variant draws */
export function camGroupNames(id = SPEC.build.variant) {
  const v = variantEntry(id);
  if (v.centralCam) return ['cam-V-central'];
  const names = [];
  for (const bank of Object.keys(SPEC.banks)) {
    for (const valve of ['intake', 'exhaust']) names.push(`cam-${bank}-${valve}`);
  }
  return names;
}

/** the crank-to-cam drive: 2:1 on the two published sprockets and their shared chain pitch */
export function drive(id = SPEC.build.variant) {
  variantEntry(id);
  const CS = SPEC.crank.sprocket;
  const KS = SPEC.cam.sprocket;
  const ratio = SPEC.cam.halfSpeedRatio;
  return {
    ratio,
    crankTeeth: CS.teeth,
    crankPitchR: CS.pitchR,
    camTeeth: CS.teeth * ratio,
    camPitchR: CS.pitchR * ratio,
    camBore: KS.bore,
    pitch: chainPitch(),
  };
}

/** the published OHV cam axis position and the tunnel floor it implies (issue #16) */
export function ohvCam() {
  const v = variantEntry('ohv');
  const faceR = lineBoreR; // the machined bearing column face IS the line bore the shell presses into
  const C = v.belowCrankCm;
  return {
    belowCrankCm: C,
    tunnelFloorZ: -(C + faceR), // bored column bore; the lobe-passage boring goes deeper still
    lobeTunnelFloorZ: -(C + castOdR), // floor a tunnel bored wide enough for the noses needs
  };
}

/** the bored tunnel a variant's cam rides in, from the published bearing stack */
export function camTunnel(id = SPEC.build.variant) {
  variantEntry(id);
  const floorZ = id === 'ohv' ? ohvCam().tunnelFloorZ : null;
  return { boreR: lineBoreR, faceR: lineBoreR, lobeClearBoreR: castOdR, floorZ };
}

/** the ground nose the bearing stack already publishes: the widest outline the cam has */
export function noseMaxRadius() {
  return noseR;
}

/** the narrowest outline the cam presents: the base circle it is ground on */
export function bestOutlineR() {
  return SPEC.head.camBaseRadius;
}

/**
 * The widest outline a cam built from these lobes can present in ANY direction:
 * a lobe is rotationally symmetric about its own axis, so the maximum over all
 * follower directions is the maximum of the profile over cam angle - its nose.
 * A clearance law that reads the base circle instead saves exactly this much
 * centre distance the engine does not have.
 */
export function worstOutlineR() {
  const nose = Math.max(lobeProfileRadius('intake', 0), lobeProfileRadius('exhaust', 0));
  if (Math.abs(nose - noseR) > 1e-9) {
    throw new Error(`the lobes' own profile peaks at ${nose} cm, not at the published nose ${noseR} cm`);
  }
  return nose;
}

// ---------------------------------------------------------------------------
// A1-G7 / issue #16: the casting an OHV cam has to ride in
// ---------------------------------------------------------------------------

const clamp1 = (x) => Math.min(1, Math.max(-1, x));

/** every outline that can swing past the cam between it and the crank centre */
export function crankSwings() {
  const K = SPEC.crank;
  return [
    ['connecting-rod big end', K.radius + SPEC.rod.bigEndRadius],
    ['counterweight lobe tip', K.counterRadius],
    ['crank pin sweep', K.radius + K.pinRadius],
  ];
}

/**
 * What the block casting has to become for the OHV variant, all of it derived
 * from published walls (tmp/ohvdrum.mjs proves the section this describes is a
 * single closed casting):
 *
 * - the tunnel the lobes swing in is bored to the cam's widest outline plus the
 *   published lobe air: that bore IS the machined face, so the drawn casting can
 *   never stand closer than that air;
 * - the room between the crank-side swings and the cam outline is exactly the air
 *   the committed placement law demands, so no cast wall may live between them:
 *   the tunnel is open toward the crank, and the crankcase drum gives up the arc
 *   of its own wall the bore crosses;
 * - the floor the lobes swing over is the top face of a cast skirt hanging below
 *   the drum, one published cast wall thick; the skirt is as wide as the bearing
 *   stack's own housing wall outside the bolt/wrench line, and its bottom face is
 *   the plane this variant's pan rails and oil pan are cast on;
 * - a DOHC head bolts its cam cover onto a housing riser. The OHV block cannot
 *   carry that riser inside the crank-side room, so the variant refuses it by name
 *   and supports its bearings on columns stood on the tunnel floor instead.
 */
export function ohvHousing() {
  const v = variantEntry('ohv');
  const T = v.tunnel;
  const B = SPEC.block;
  const C = v.belowCrankCm;
  const OD = B.caseOuterRadius;
  const ID = B.crankcaseRadius;
  const worst = worstOutlineR();
  const wall = SPEC.cam.bearing.housingWall;
  const railThk = B.panFlangeZ - B.panRailZ;

  const tunnelBoreR = worst + T.lobeAirCm;
  const tunnelWallR = tunnelBoreR + wall;
  const floorZ = -(C + tunnelBoreR);
  const skirtZ = floorZ - wall;
  const skirtHalfY = housingOutRel;
  const skirtInboardY = housingInRel;

  // where the bored circle meets a circle about the crank centre: half angle off
  // straight down on the meeting circle, and the angle on the bored circle itself
  const offDown = (rr) => Math.acos(clamp1((rr * rr + C * C - tunnelBoreR ** 2) / (2 * rr * C)));
  const phiAt = (rr) => {
    const a = Math.asin(clamp1((C * C + tunnelBoreR ** 2 - rr * rr) / (2 * C * tunnelBoreR)));
    return [a, Math.PI - a];
  };
  const aOD = offDown(OD);
  const aID = offDown(ID);
  const aSkirt = Math.asin(clamp1(skirtHalfY / OD));
  const psiArc = (a) => [-Math.PI / 2 + a, -Math.PI / 2 - a + 2 * Math.PI]; // retained arc, CCW
  const [phiIDLo, phiIDHi] = phiAt(ID);
  const [phiODLo, phiODHi] = phiAt(OD);

  const swings = crankSwings();
  const maxSweep = Math.max(...swings.map((s) => s[1]));
  const crankRoomR = C - maxSweep;
  return {
    belowCrankCm: C,
    lobeAirCm: T.lobeAirCm,
    crankSideAirCm: T.crankSideAirCm,
    arcStepRad: (T.arcStepDeg * Math.PI) / 180,
    castWallCm: wall,
    worstOutlineR: worst,
    tunnelBoreR,
    tunnelWallR,
    floorZ,
    skirtZ,
    skirtHalfY,
    skirtInboardY,
    panRailZ: skirtZ,
    panFlangeZ: skirtZ + railThk,
    railThkCm: railThk,
    skirtCornerZ: -Math.sqrt(OD * OD - skirtHalfY ** 2),
    skirtVoidZ: -Math.sqrt(ID * ID - skirtHalfY ** 2),
    drumOpenDeg: (2 * aOD * 180) / Math.PI,
    drumNotchDeg: (2 * aID * 180) / Math.PI,
    // the arcs the relieved casting is machined along, in each circle's own frame
    arcs: {
      drumOuter: psiArc(aOD), // the drum wall that stays: OD arc outside the bored mouth
      voidWall: psiArc(aID), // the crankcase void wall that stays
      skirtSide: psiArc(aSkirt), // where the skirt sides tie into the OD circle
      boreLeft: [phiODHi, phiIDHi], // bored face inside the wall band, -y side
      boreRight: [phiODLo, phiIDLo], // bored face inside the wall band, +y side
      boreFloor: [phiIDHi, phiIDLo + 2 * Math.PI], // the tunnel floor, the long way past the bottom
    },
    swings,
    maxSweep,
    crankRoomR,
    castOdR,
    // a riser out here leaves less than the crank-side air the swings are owed
    riserRefused: housingOutRel > crankRoomR - T.crankSideAirCm,
  };
}

/**
 * The bolt planes each variant casts, and the sump that hangs off them. The DOHC
 * build reads the published planes; the OHV build reads its own skirt.
 */
export function panPlanes(id = SPEC.build.variant) {
  const B = SPEC.block;
  const inset = B.panInset;
  if (variantEntry(id).centralCam) {
    const H = ohvHousing();
    return {
      id,
      railZ: H.panRailZ,
      flangeZ: H.panFlangeZ,
      flangeHalfY: H.skirtHalfY,
      // the sump wall stands on the skirt's INSIDE face: the skirt wall is the
      // published housing wall, and a sump wall inside that band would be cast
      // into the block instead of hanging off it
      wallHalfY: H.skirtInboardY,
      panBottomZ: H.panRailZ - B.oilPanDepthCm,
    };
  }
  const flangeHalfY = panFlangeHalfWidth(B.panFlangeZ);
  return {
    id,
    railZ: B.panRailZ,
    flangeZ: B.panFlangeZ,
    flangeHalfY,
    wallHalfY: flangeHalfY - inset,
    panBottomZ: B.panRailZ - B.oilPanDepthCm,
  };
}

/**
 * The stand is one object defined by its offsets from the casting it carries
 * (SPEC.stand publishes them against this tree's DOHC faces). A variant whose
 * casting reaches deeper moves the assembly's datum by exactly that much, so the
 * DOHC numbers stay as the closed rows record them and every clearance the stand
 * laws gate is reproduced for the other build.
 */
export function standDatums(id = SPEC.build.variant) {
  const S = SPEC.stand;
  const P = panPlanes(id);
  const dohcBottom = panPlanes('dohc').panBottomZ;
  const delta = P.panBottomZ - dohcBottom;
  const z = (v) => v + delta;
  return {
    id,
    delta,
    ...P,
    faceX: endDiscFaceX(),
    frameZ1: z(S.frameZ1),
    floorZ: z(S.floorZ),
    padZ0: z(S.padZ0),
    colZ1: z(S.colZ1),
    jawZ0: z(S.jawZ[0]),
    jawZ1: z(S.jawZ[1]),
    braceFootZ: z(S.braceFootZ),
    braceHeadZ: z(S.braceHeadZ),
    boltZ: z(S.boltZ),
  };
}

// ---------------------------------------------------------------------------
// naming (P1-G5): generated from SPEC, never typed
// ---------------------------------------------------------------------------

const bankAngleDeg = () => Math.abs(SPEC.banks.R.az - SPEC.banks.L.az);

/** cross-plane vs flat-plane read off the crank's own throw azimuths */
function planeWord(id = SPEC.build.variant) {
  variantEntry(id);
  const az = [...SPEC.crank.pinAz].sort((a, b) => a - b);
  const diffs = az.map((a, i) => (az[(i + 1) % az.length] - a + 360) % 360);
  if (diffs.every((d) => d === 90)) return 'CROSS-PLANE';
  if (diffs.every((d) => d === 180)) return 'FLAT-PLANE';
  throw new Error(`crank pin azimuths ${az.join(', ')} describe neither a cross-plane (90 deg apart) nor a flat-plane (180 deg apart) crank`);
}

export function displacementCm3() {
  return SPEC.cylinders.length * Math.PI * SPEC.block.boreRadius ** 2 * (2 * SPEC.crank.radius);
}

export function displacementLabel() {
  return `${(displacementCm3() / 1000).toFixed(1)} L`;
}

export function badge(id = SPEC.build.variant) {
  const v = variantEntry(id);
  return `V${SPEC.cylinders.length}-${bankAngleDeg()} ${v.badgeWord}`;
}

export function hudTitle(id = SPEC.build.variant) {
  const v = variantEntry(id);
  return `${planeWord(id)} V${SPEC.cylinders.length} - ${bankAngleDeg()} DEG ${v.badgeWord} - ${SPEC.identity.serial}`;
}

export function engineName(id = SPEC.build.variant) {
  const v = variantEntry(id);
  return `${planeWord(id).toLowerCase()} ${bankAngleDeg()} degree ${v.badgeWord} V${SPEC.cylinders.length}`;
}

/** the id plate lines the shell stamps - every one of them generated here */
export function plateLines(id = SPEC.build.variant) {
  return [
    { text: SPEC.identity.cell, bold: true, size: 44 },
    { text: `${badge(id)} ${displacementLabel()}`, size: 34 },
    { text: `${SPEC.identity.serial} ${SPEC.identity.sn}`, size: 24 },
  ];
}
