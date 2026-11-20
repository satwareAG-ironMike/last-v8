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
import { SPEC } from './spec.js';
import { boreR as lineBoreR, castOdR, noseR } from './bearings.js';
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
