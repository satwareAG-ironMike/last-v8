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
import { SPEC, DEG, panFlangeHalfWidth, endDiscFaceX } from './spec.js';
import {
  boreR as lineBoreR, boltCircumR, castOdR, noseR, housingInRel, housingOutRel,
} from './bearings.js';
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

/**
 * Every outline that can swing past the cam between it and the crank centre, as
 * [label, reach off the crank axis, x bands it sweeps]. The bands come from the
 * published crank widths: a rod big end is confined to the web gap, a counter
 * lobe is counterLobeHalfX wide at its throw, a pin runs pinWidth through both
 * webs - so a bearing may only stand in an x window no band reaches.
 */
export function crankSwings() {
  const K = SPEC.crank;
  const bands = (half) => SPEC.block.stations.map((s) => [s - half, s + half]);
  return [
    ['connecting-rod big end', K.radius + SPEC.rod.bigEndRadius, ...bands(K.webIn)],
    ['counterweight lobe tip', K.counterRadius, ...bands(K.counterLobeHalfX)],
    ['crank pin sweep', K.radius + K.pinRadius, ...bands(K.pinWidth / 2)],
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
 *   carry that riser inside the crank-side room, so the variant refuses it by
 *   name: this variant's bearings are the front-insert rings ohvBearings()
 *   derives from this bore and the retainer that holds them, not a riser.
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
 * A1-G7 / issue #8 addendum item 4 (slice 8B): the bearings this variant's cam
 * runs in, derived from the tunnel 8A already bored (tmp/ohvbrg.mjs,
 * tmp/ohvbrg3.mjs read every number below off the drawn casting and the drawn
 * crank hardware).
 *
 * The face 8A machined through the drum wall IS this variant's line bore, so the
 * stack reads outward-in from it rather than from the DOHC head's published
 * bore: the bore is the shell's outside, the shell is bought to the journal plus
 * a film, and the journal is ground to this cam's own widest outline so every
 * nose turns in its own bearing AND passes every other one on the way in - the
 * front-insert reading A1-G7 names, and the reason no load-bearing full-ring
 * boss here has a bore smaller than a lobe nose.
 *
 * The shells are installed before that bore is cut, so the cutter grips them:
 * the bore and the shell outside are the same cylinder, the same press fit this
 * tree's liners use. One retainer plate bolts to the machined fore face over the
 * mouth: it retains the fore shell and takes the cam's thrust, and its opening
 * is the shell inside, so the whole cam slides through it.
 */
export function ohvBearings() {
  const H = ohvHousing();
  const T = variantEntry('ohv').tunnel;
  const CAM = SPEC.cam;
  const P = CAM.bearing;
  const B = SPEC.block;
  const C = H.belowCrankCm;
  const BH = CAM.bearingHalf;

  // the stack, off the face the casting already has. The journal is ground to the
  // cam's own widest outline (front insert: the nose has to pass every ring on the
  // way in), so it is derived FROM the published nose, not back-computed off the
  // bore - the subtractions boreR - shellWall - oilFilm land on 3.0999999999999996
  // and the identity journalR === noseR then fails on float noise instead of on
  // geometry. The stack still has to close: shell inside minus journal IS film.
  const noseR = H.worstOutlineR;
  const boreR = H.tunnelBoreR;
  const shellIdR = boreR - P.shellWall;
  const journalR = noseR;
  const runningClearance = shellIdR - journalR;
  if (Math.abs(runningClearance - P.oilFilm) > 1e-9) {
    throw new Error(`the OHV journal ${journalR} inside the shell bore ${shellIdR} leaves ${runningClearance} cm of running clearance, not the published oil film ${P.oilFilm} cm (${boreR} bore less ${P.shellWall} shell wall less ${P.oilFilm} film)`);
  }
  const insertAirCm = shellIdR - noseR;

  // five stations: the two machined tunnel faces plus the three gaps between the
  // published cylinder stations. Every window is the published bearing width
  // wide and each one abuts a cast face, so the bushings are located: the fore
  // one by the retainer, the aft one by the aft end wall, the three mid ones by
  // the cam's own locating collars (the through-bore is the same cylinder the
  // bushings ride in, so only a cam-side collar can capture them - 8C draws that
  // cam and its journals, and this is the interface it owes).
  const foreFaceX = B.stations[0] + B.pitch / 2 + B.slabFront;
  const aftFaceX = B.stations[3] - B.pitch / 2 - B.slabRear;
  const mids = B.stations.slice(1).map((s, i) => (s + B.stations[i]) / 2);
  const stations = [foreFaceX - BH, ...mids, aftFaceX + BH];
  const windows = stations.map((s) => [s - BH, s + BH]);

  // this variant's own lobe width: 16 lobes and 5 bearings share one span
  const lobeWidthCm = (B.pitch / 2 - BH - T.lobeAxialAirCm) / 2;
  const groupHalfCm = 2 * lobeWidthCm;
  const spanCm = foreFaceX - aftFaceX;
  const fillCm = SPEC.cylinders.length * 2 * lobeWidthCm + stations.length * 2 * BH;
  const bands = [
    ...windows.map(([a, b]) => [a, b, 'bearing']),
    ...B.stations.map((s) => [s - groupHalfCm, s + groupHalfCm, 'lobes']),
  ].sort((p, q) => p[0] - q[0]);
  let minAxialAir = Infinity;
  for (let i = 1; i < bands.length; i++) minAxialAir = Math.min(minAxialAir, bands[i][0] - bands[i - 1][1]);

  // the loaded cradle is the retained bored arc's own mid: the tunnel floor
  const cradleArc = H.arcs.boreFloor;
  const cradleMidDeg = ((cradleArc[0] + cradleArc[1]) / 2) * 180 / Math.PI;
  const oilBand = [cradleMidDeg - P.oilBandDeg / 2, cradleMidDeg + P.oilBandDeg / 2];

  // the fore retainer plate (A1-G7: "front-insert cam tunnel ... caps"): a plate
  // standing proud of the machined fore face over the loaded half of the mouth,
  // from the published rail plane up to the cam axis - the split plane every
  // bearing cap of this tree splits at. Its opening is the shell inside, so the
  // whole cam slides through it, and its back face is what the fore bushing
  // abuts. Jane: the plate is as wide as its own bolt chain demands (mid-wall
  // bolt line + head + published wrench clearance); the skirt flange alone
  // (skirtHalfY) would put a bolt head outside the plate.
  const plateThkCm = P.housingWall;
  const plateInR = shellIdR;
  const plateBottomZ = H.skirtZ;
  const plateTopZ = -C;
  const plateForeX = foreFaceX + plateThkCm;

  // the bolt line stands in the skirt's own wall band, on the flanks of the
  // loaded cradle: its radius off the cam axis is the published chain outside
  // the line bore, and its depression below the axis follows from the published
  // skirt wall it threads into. The published DOHC chain (boltOutRel = the mean
  // of boreR and tabR) cannot be used here: this variant has no cap tab, and its
  // line bore is 3.4000, so a bolt on that mean would sit INSIDE the bore.
  const boltOutRel = boreR + boltCircumR + P.wrenchClr;
  const boltLocalY = (H.skirtInboardY + H.skirtHalfY) / 2;
  const boltDropCm = Math.sqrt(boltOutRel * boltOutRel - boltLocalY * boltLocalY);
  const boltSpreadDeg = (Math.asin(boltLocalY / boltOutRel) * 180) / Math.PI - (cradleMidDeg - 270);
  const boltAzDeg = [cradleMidDeg - boltSpreadDeg, cradleMidDeg + boltSpreadDeg];
  const plateHalfY = boltLocalY + boltCircumR + P.wrenchClr;
  // the plate's own corner: its widest point stands on the rail plane, so the
  // radius a law reads off the cam axis is the corner, not the half width
  const plateCornerR = Math.hypot(plateHalfY, plateBottomZ + C);
  // the bolt reaches tabStand deep into the machined fore face and its head
  // stands 2 x tabInset proud of the plate: both are published tab walls
  const boltEngageCm = P.tabStand;
  const boltHeadCm = 2 * P.tabInset;

  // what the bore and the plate keep off the drawn crank hardware
  const crownAirCm = H.crankRoomR - boreR;
  const noseAirCm = plateInR - noseR;
  // no bearing stands in a band any throw sweeps: every window sits in the gap
  // between two published stations, so the air off the nearest band is the half
  // pitch less the widest throw half, less the bearing half that reaches into it
  const swungIn = windows.map(([a, b]) =>
    H.swings.flatMap((sw) => sw.slice(2)).filter(([u, v]) => u < b && a < v));
  const throwAirCm = B.pitch / 2 - SPEC.crank.pinWidth / 2 - BH;

  return {
    boreR, shellWall: P.shellWall, shellIdR, oilFilm: P.oilFilm, journalR, noseR,
    insertAirCm, runningClearance: shellIdR - journalR,
    lobeWidthCm, groupHalfCm, lobeAxialAirCm: T.lobeAxialAirCm, bearingHalf: BH,
    foreFaceX, aftFaceX, stations, windows, spanCm, fillCm, minAxialAir,
    cradleArc, cradleMidDeg, oilBand, oilHoleR: P.oilHoleR,
    plateThkCm, plateInR, plateHalfY, plateBottomZ, plateTopZ, plateForeX,
    boltOutRel, boltLocalY, boltDropCm, boltAzDeg, boltSpreadDeg, boltEngageCm, boltHeadCm,
    plateCornerR, throwAirCm,
    boltHoleR: P.boltHoleR, boltAcrossR: P.boltAcrossR, boltCircumR,
    crownAirCm, noseAirCm, swungIn,
  };
}

/**
 * A1-G6 / issue #16 option B (slice 8C-3a): the gallery this variant's block
 * casts for its 16 lifters, and the bore each lifter runs in.
 *
 * Option B (issue #16): the gallery is cast per bank and the bore is machined
 * through that iron, so it is block geometry, not a sleeve pressed into a hole.
 * Nothing here is typed. Four published facts decide every number:
 *
 * 1. A lifter stands over the lobe that drives it, so the lifter pitch IS this
 *    variant's own lobe band width (ohvBearings derives it from
 *    tunnel.lobeAxialAirCm). The bands abut: 16 lobes fill each cylinder group
 *    edge to edge, so the pitch is one band wide and the bores come in pairs,
 *    one per valve of a cylinder, 3 bands apart between neighbouring cylinders.
 * 2. Two adjacent bores owe each other the published cast wall
 *    (SPEC.cam.bearing.housingWall), which caps the bore at
 *    (pitch - wall) / 2. The lifter body is that bore less the published oil
 *    film, so the running clearance of a lifter in its gallery is the same film
 *    every bearing shell of this tree runs on.
 * 3. lifterAzimuth(bank) = SPEC.banks[bank].az (src/engine/ohv.js), so a lifter
 *    bore runs PARALLEL to its own cylinder bore and THROUGH the cam axis: in
 *    bank-local terms the line out = C|sin az|, crossing the cam axis at
 *    along = -C cos az, for both banks. Distance off the crank axis along that
 *    line is hypot(along + t, out) and it varies with the travel t; the tangent
 *    minimum C|sin az| is not a clearance, and deriving a lifter size from it
 *    was withdrawn on issue #16.
 * 4. The room the crank-side swings are owed is measured off the CRANK axis:
 *    no cast iron nearer than maxSweep + tunnel.crankSideAirCm (the same law
 *    ohvHousing publishes off the cam axis as crankRoomR, and
 *    test/block.test.mjs gates as castOdR <= crankRoomR - crankSideAirCm).
 *    That room opens the gallery inboard at the bored tunnel face and closes it
 *    outboard where the bore surface meets it, and it is what limits how long a
 *    lifter body may be.
 *
 * The rib this leaves ties into the casting at its inboard end - the iron at
 * the bore mouth stands outside the crankcase void wall - and stands in the
 * open crankcase bay outboard, the precedent the interior main cap towers set.
 */
export function ohvLifterGallery() {
  const H = ohvHousing();
  const BR = ohvBearings();
  const T = variantEntry('ohv').tunnel;
  const P = SPEC.cam.bearing;
  const BL = SPEC.block;
  const C = H.belowCrankCm;
  const wall = H.castWallCm;
  const reliefR = H.maxSweep + T.crankSideAirCm; // off the CRANK axis
  const pitchCm = BR.lobeWidthCm;
  const boreRadius = (pitchCm - wall) / 2;
  const stemRadius = boreRadius - P.oilFilm;
  const lines = ['R', 'L'].flatMap((bank) => ['intake', 'exhaust'].map((valve) => ({ bank, valve })));
  const banks = {};
  for (const [bank, b] of Object.entries(SPEC.banks)) {
    const az = b.az * DEG;
    const axisOut = C * Math.abs(Math.sin(az));
    const axisAlong = -C * Math.cos(az);
    const rAxis = (t) => Math.hypot(axisAlong + t, axisOut);
    const guideFrom = H.tunnelBoreR; // the bore opens at the machined tunnel face
    const disc = (reliefR + boreRadius) ** 2 - axisOut ** 2;
    if (disc < 0) {
      throw new Error(`a lifter axis ${axisOut.toFixed(4)} cm outboard of the crank in bank ${bank} never comes clear of the ${reliefR.toFixed(4)} cm room the crank swings are owed, so this variant cannot bore a lifter gallery at all (cam ${C} cm under the crank, bore radius ${boreRadius.toFixed(4)})`);
    }
    const guideTo = axisOut - Math.sqrt(disc); // bore surface stands on the room
    const bodyTop = axisOut - Math.sqrt((reliefR + stemRadius) ** 2 - axisOut ** 2);
    const bodyLength = bodyTop - H.worstOutlineR; // from the swept nose to the room it stops at
    // The room does not stop at the bore: it also eats the iron the bore stands in.
    // The published cast wall outside the bore (ribIn) stays clear of the room only
    // up to the station where the room's own arc crosses it; past that the gallery
    // iron has to stand on the arc itself, which is where the rib's outboard guide
    // wall is machined. Both numbers derive from the same arc.
    const ribIn = axisOut - boreRadius - wall;
    const stepT = axisOut - Math.sqrt(reliefR ** 2 - ribIn ** 2);
    const wallIn = Math.sqrt(reliefR ** 2 - (axisAlong + guideTo) ** 2);
    const bores = [];
    BL.stations.forEach((st, si) => {
      const fore = st - BR.groupHalfCm;
      lines.forEach((line, k) => {
        if (line.bank !== bank) return;
        const cyl = SPEC.cylinders.find((c) => c.bank === line.bank && c.station === si);
        const x = fore + k * pitchCm + pitchCm / 2; // the lobe centre this lifter rides
        bores.push({ name: `lifter-cyl${cyl.num}-${line.valve}`, cyl: cyl.num, valve: line.valve, x });
      });
    });
    bores.sort((p, q) => p.x - q.x);
    const clusters = [];
    for (const bore of bores) {
      const last = clusters.at(-1);
      if (last && Math.abs(bore.x - last.at(-1) - pitchCm) < 1e-9) last.push(bore.x);
      else clusters.push([bore.x]);
    }
    banks[bank] = {
      bank, axisOut, axisAlong, guideFrom, guideTo, bodyTop, bodyLength, bores,
      clusters: clusters.map((xs) => [xs[0] - boreRadius - wall, xs.at(-1) + boreRadius + wall]),
      clusterBores: clusters,
      ribIn, stepT, wallIn,
      ribOut: axisOut + boreRadius + wall, // the rib's outboard machined face
      mouthIron: rAxis(guideFrom) - reliefR - boreRadius,
      tieR: rAxis(guideFrom) + boreRadius + wall,
      rAxis,
    };
  }
  return {
    pitchCm, boreRadius, stemRadius, oilFilm: P.oilFilm, castWallCm: wall,
    reliefR, maxSweep: H.maxSweep, crankSideAirCm: T.crankSideAirCm,
    tunnelBoreR: H.tunnelBoreR, worstOutlineR: H.worstOutlineR, belowCrankCm: C,
    arcStepRad: H.arcStepRad, banks,
  };
}

/**
 * The 16 followers the bores above hold (issue #16 option B, slice 8C-3b): one
 * flat-tappet lifter per valve, standing in its own bore, riding its own lobe.
 * Nothing here is a choice either - the body radius is the bore less the oil
 * film the bore is machined for, the length is the station where a body that
 * wide stops on the room the crank swings are owed, and the travel is the
 * ground base circle to the outline the cam sweeps.
 *
 * The contact face is a PLANE across the bore axis at the distance the lobe's
 * tangent plane stands from the cam axis (src/engine/timing.js lobeFaceDistance,
 * read through src/engine/ohv.js ohvLift), so a lifter face is never cut by the
 * profile it rides - the outline is the envelope of those planes.
 */
export function ohvLifters(G = ohvLifterGallery(), H = ohvHousing()) {
  const baseR = SPEC.head.camBaseRadius; // the circle a follower sits on at zero lift
  const liftMax = H.worstOutlineR - baseR; // the ground nose over that circle
  if (liftMax <= 0) {
    throw new Error(`the cam's widest outline ${H.worstOutlineR} cm is not wider than the ${baseR} cm base circle its followers ride, so this variant has no lift to give them`);
  }
  const lifters = [];
  for (const [bank, g] of Object.entries(G.banks)) {
    for (const bore of g.bores) {
      const faceMin = baseR; // at zero lift the face stands on the base circle
      const faceMax = baseR + liftMax; // at full lift it stands on the swept outline
      lifters.push({
        name: bore.name, cyl: bore.cyl, valve: bore.valve, bank, x: bore.x,
        radius: G.stemRadius, boreRadius: G.boreRadius, oilFilm: G.oilFilm,
        length: g.bodyLength,
        faceMin, faceMax,
        topMin: faceMin + g.bodyLength, topMax: faceMax + g.bodyLength,
        axisOut: g.axisOut, axisAlong: g.axisAlong,
        guideFrom: g.guideFrom, guideTo: g.guideTo,
        engagementMin: faceMin + g.bodyLength - g.guideFrom,
        engagementMax: g.guideTo - g.guideFrom,
        // the closest the body's own surface ever comes to the crank axis: the
        // outboard end, measured across the film the room is owed by
        crankClearR: Math.hypot(g.axisAlong + g.bodyTop, g.axisOut - G.stemRadius),
        linerClearR: g.axisOut - G.stemRadius, // off its own cylinder's bore axis line
      });
    }
  }
  return {
    lifters,
    baseRadius: baseR,
    liftMaxCm: liftMax,
    bodyRadius: G.stemRadius,
    boreRadius: G.boreRadius,
    oilFilm: G.oilFilm,
    bodyLengthCm: G.banks.L.bodyLength,
    engagementMinCm: Math.min(...lifters.map((l) => l.engagementMin)),
    engagementMaxCm: Math.max(...lifters.map((l) => l.engagementMax)),
    crankClearCm: Math.min(...lifters.map((l) => l.crankClearR)),
    reliefR: G.reliefR,
    crankSideAirCm: G.crankSideAirCm,
    maxSweep: G.maxSweep,
    tunnelBoreR: G.tunnelBoreR,
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
