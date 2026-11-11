// Cross-plane 90 degree DOHC V8 - single source of truth for every dimension.
// Units: centimetres. Angles: degrees.
//
// World frame:  X = crankshaft axis (engine front at +X), Y = transverse, Z = up.
// Polar angle `az` is measured in the YZ plane from +Z toward +Y:
//   polarDir(az) = (0, sin az, cos az)
// A crank throw at az = 0 points straight up, az = 90 points to +Y (engine right).
//
// Bank R (cylinders 2,4,6,8) leans to +Y: bore axis az = +45.
// Bank L (cylinders 1,3,5,7) leans to -Y: bore axis az = -45.  -> 90 degree V.
// "outboard" of a bank = away from the V: +90 polar for bank R, -90 for bank L.
// Bank-local coordinates used throughout: `along` up the bore axis, `out` outboard.

export const DEG = Math.PI / 180;

export const polarDir = (azDeg) => [0, Math.sin(azDeg * DEG), Math.cos(azDeg * DEG)];

export const BANKS = {
  R: { az: 45, outSign: +1, cyls: [2, 4, 6, 8] },
  L: { az: -45, outSign: -1, cyls: [1, 3, 5, 7] },
};

export const SPEC = {
  banks: BANKS,

  stroke: 8.0,

  crank: {
    radius: 4.0, // half stroke
    mainRadius: 2.7,
    pinRadius: 2.4,
    pinWidth: 5.8, // pin ends s +/- 2.9; runs through both web slabs
    webIn: 1.4, // web slab occupies s +/- (1.4..2.5); rod gap is s +/- 1.4
    webOut: 2.5,
    webThickness: 1.1,
    webHalfU: 2.6, // web half-width perpendicular to the throw direction
    counterRadius: 6.3,
    counterLobeHalfX: 1.45, // one counter lobe per throw, s +/- 1.45, touches both webs
    counterInnerR: 2.2,
    counterArcDeg: 150,
    noseRadius: 3.0,
    flangeRadius: 5.2,
    flywheel: { radius: 9.4, x0: -30.0, x1: -27.8, ringRadius: 9.95 },
    // 18-tooth drive sprocket at the nose; cam sprockets have exactly 2x the
    // teeth AND 2x the pitch radius -> the 2:1 half-speed law is machined, not
    // faked, and both sprockets share one chain pitch (2 pi pitchR / teeth).
    sprocket: { radius: 3.15, teeth: 18, pitchR: 3.45, toothH: 0.55, x0: 28.6, x1: 29.8 },
    // Absolute throw azimuth per station, front -> rear.
    // Four throws 90 deg apart in azimuth -> cross-plane ("Chinese arm") crank.
    pinAz: [315, 225, 45, 135],
    // rotation: az(throw) = pinAz - crankAngle  -> crank turns toward -Y at the top
    sense: -1,
  },

  rod: { length: 14.5, bigEndRadius: 3.1, capRadius: 3.1, smallEndRadius: 1.7, beamWidth: 2.4 },

  // Skirt must clear the counterweight tips: at BDC the pin sits 10.5 up the
  // bore, the skirt bottom 10.5 - skirtLength = 6.5 > counterRadius + 0.15.
  piston: { radius: 4.95, compressionHeight: 3.9, crownThickness: 1.6, skirtLength: 4.0 },

  block: {
    deckA: 24.1, // crank centreline -> deck face, up the bore axis
    boreStartA: 5.5, // bottom of the bore tunnel
    boreRadius: 5.1,
    boreShellRadius: 5.3,
    stations: [16.5, 5.5, -5.5, -16.5], // front -> rear
    pitch: 11.0,
    crankcaseRadius: 9.4,
    caseOuterRadius: 11.6, // casting OD around the crankcase
    deckHalfWidth: 7.0,
    boreWallHalf: 5.35, // half width of the bore tunnel opening in the slab profile
    deckCornerR: 1.6, // deck corner radius (head bolt bosses)
    mainBossR: 4.6, // fore main bearing hole (nose journal passes it)
    aftMainBossR: 5.7, // aft main bearing hole (flywheel flange passes it)
    counterBayHalfX: 22.0, // all crank counterweights stay inside |x| < this, r <= counterRadius
    slabFront: 4.5, // accessory-drive slab, +X of the first station
    slabRear: 4.5, // rear main / bell housing slab, -X of the last station (symmetric)
  },

  head: {
    deckA: 24.1,
    seatA: 24.1, // valve seat face is the deck plane
    seatOffset: 2.2, // inboard(-) / outboard(+) of the bore axis
    valveAngle: 15, // valve axis tilt away from the bore axis, toward its cam
    stemToTip: 8.4, // seat -> valve tip along the axis, zero lift
    stemRadius: 0.34,
    headDia: { intake: 5.4, exhaust: 4.8 },
    headThickness: 0.7,
    guideLength: 3.0,
    bucketRadius: 1.9,
    bucketHeight: 1.6,
    shim: 0.3,
    camBaseRadius: 1.6,
    camJournalRadius: 1.75,
    camLobeWidth: 2.6, // extruded lobe thickness along the cam axis
    coverExtra: 3.4, // cam cover stand-off above the cam axis
    deckBoltRadius: 0.85,
    retainerGap: 0.4, // retainer thickness; spring top seat at stemToTip - retainerGap
    retainerRadius: 0.75,
    shimRadius: 1.75, // adjusting shim under the bucket
    bucketFlangeRadius: 2.15, // guide lip on the bucket skirt

    // ---- head casting topology (pinned by test/heads.test.mjs) ----
    gasketT: 0.15, // compressed head gasket between block deck and head face
    gasketId: 5.5, // gasket bore: outboard of the 5.3 bore shell, inboard of
    gasketOd: 7.0, // the deck rails the clamping load rides on
    railTopA: 27.0, // machined deck-rail top plane the head bolts stand on
    boltOut: 6.3, // bolt row |out|: mid of the gasket band 5.5..7.0
    boltXOff: 2.9, // bolt x offset from each cylinder station
    guideBoreR: 0.48, // valve-guide bore over the 0.34 stem
    floorT: 0.6, // spring-seat floor thickness; its top plane = guideLength
    bucketBoreR: 2.25, // bucket/guide bore: 0.10 over the 2.15 bucket flange,
    // 0.68 over the 1.57 spring coil OD - the spring rides inside this bore
    bossClr: 0.05, // cam-bearing running clearance inside each head boss
    coverPlate: 0.7, // cam-cover plate thickness; ceiling = top - coverPlate
  },

  // ---- intake + exhaust topology (pinned by test/manifolds.test.mjs) ----
  // All bank-local: `along` up the bore axis, `out` outboard away from the V.
  // The block body bulges to out 12.24 at mid-height (measured, tmp/block-envelope.mjs);
  // the head casting reaches out 7.95 at its port bulkheads and -8.13 at the cam bosses.
  // Clearance is not decoration here: the voxel shell test measures every tube
  // vertex against the real block/head/valvetrain/cranktrain meshes, and a 1 cm
  // shell inflates an obstacle by up to half a cell, so the design keeps
  // >= 1.2 cm of real air everywhere the pipework runs beside the engine.
  manifold: {
    // ---- exhaust: 4-into-1 header per bank, outboard ----
    exFlangeT: 0.7, // flange plate standing on the head outboard stay face (out 7.00)
    exFlangeX: 1.55, // flange half width in x (the stay is 1.7, so 0.15 all round)
    exFlangeA0: 24.4,
    exFlangeA1: 29.6, // the stay face spans 24.25..30: the flange lands inside it
    exFlangeR: 0.35, // cast corner radius of the flange plate
    exPortR: 0.95, // port bore through flange and neck, coaxial with the seat
    exNeckR: 1.35, // hollow port neck boss standing on the flange
    exNeckT: 1.9, // neck length along the port axis; the primary butts onto it
    // Flange bolt pattern, bank-local offsets in `along` from the port axis.
    // The renderer drills these holes and places exactly these bolts, so the
    // count and the spacing are load-bearing, not decoration.
    boltOffsetsAlong: [1.7, -1.7],
    boltHoleR: 0.36,
    exPrimaryR: 1.05, // 4-into-1 primary tube
    // Pair merge sits exactly midway between its two cylinder stations, so all
    // four primaries travel the same 5.5 cm in x and come out the same length:
    // (16.5 + 5.5) / 2 = 11, mirror -11.
    exMergeX: 11.0,
    exPairR: 1.5, // pair outlet: r^2 2.25 >= 2 primaries 2 x 1.1025 = 2.205
    // A merged collector has to pass the flow of ALL four primaries, so its
    // area is sized against 4 x the primary area, not against one of them:
    // 2.15^2 = 4.62 >= 4 x 1.05^2 = 4.41.
    exCollectorR: 2.15,
    exOutletR: 2.7, // bolt-on outlet flange disc at the collector end
    exOutletT: 0.9,
    shieldOut0: 17.6, // heat shield: outboard of every primary tube surface (15.25)
    shieldOut1: 18.2,
    shieldA0: 14.5, // shield span in along: starts outboard of the collector
    shieldA1: 30.0,
    shieldXFront: [9.5, 18.5], // wide enough to cover both primaries of its pair
    shieldXAft: [-18.5, -9.5],
    shieldStayR: 0.35, // stand-off bracket from the clamp band up to the shield
    // Grip points along the two primaries a shield covers: the outer cylinder's
    // tube passes under the shield early, the inner cylinder's only near its
    // merge end, where its blended x reaches the shield footprint.
    clampBandT: [0.35, 0.8],
    clampBandR: 1.15, // band ring radius around the 1.05 primary
    clampBandTube: 0.35,
    // ---- intake: 4 runners into one plenum hanging in the V ----
    inFlangeT: 0.7, // intake flange plate standing on the head inboard face
    inFlangeX: 1.55,
    inFlangeA0: 24.4,
    inFlangeA1: 29.6,
    inFlangeR: 0.35,
    inPortR: 1.0, // intake port bore: matches the 4.6 intake valve disc seat
    inNeckR: 1.45, // hollow intake port neck boss
    inNeckT: 1.9,
    inRunnerR: 1.2, // intake runner tube
    // The plenum hangs in the V, inboard of the cam bosses (the boss OD reaches
    // |out| = 5.28 + 2.85 = 8.13 measured), so its outboard wall sits at -12.5:
    // 4.4 cm of real air past the whole casting.
    plenumOut0: -19.5,
    plenumOut1: -12.5,
    plenumA0: 30.5,
    plenumA1: 37.5,
    plenumX: 22.0, // half length: 6.6 cm clear of the 28.6 sprocket band
    plenumR: 1.4, // cast fillet of the plenum bar
    railAlong: 28.0, // fuel rail rides below + inboard of the plenum, out of its way
    railOut: -20.5,
    railR: 0.62,
    railX: 20.0,
    injR: 0.5, // injector body from the rail up-outboard into its own runner
    bracketX: [18.0, 19.2], // rail brackets cast into the plenum bar, hugging the rail
    bracketA: 1.2,     // bracket reach beside the rail in `along`
    bracketDrop: 1.1,  // how far below the rail axis its lower face sits
    bracketBite: 0.9,  // how deep it is cast into the plenum bar / starts into it
  },

  valves: {
    maxLift: 1.2,
    // Cycle angles in CRANK degrees, c = 0 at power TDC:
    //   0..180 POWER | 180..360 EXHAUST | 360..540 INTAKE | 540..720 COMPRESSION
    // 240 deg duration, symmetric about the exhaust-stroke mid (270): the
    // 125..405 blowdown window leaves only ~0.75 mm between the exhaust valve
    // disc and the flat piston crown at overlap TDC - physically it would
    // clash. 145..385 keeps the same 265 deg event midpoint (the baked lobe
    // azimuth is unchanged) and restores >0.25 cm crown clearance.
    exhaustOpen: 145, // 35 deg before exhaust BDC
    exhaustClose: 385, // 25 deg after overlap TDC -> 240 deg duration
    intakeOpen: 340, // 20 deg before overlap TDC
    intakeClose: 580, // 40 deg after intake BDC    -> 240 deg duration
    // Overlap = 20 + 25 = 45 crank deg (the timing test window is 40..70).
    // Spring data. A compression spring is installed SHORTER than its free
    // length: freeLength - installed = the seat preload at zero lift.
    // Installed length = stemToTip - retainerGap - guideLength = 5.0 cm.
    springFreeLength: 5.2, // 0.2 cm seat preload
    springRadius: 1.35,
    springCoils: 7,
    springWireRadius: 0.22,
  },

  cam: {
    halfSpeedRatio: 2,
    journalAft: -28.7, // continuous journal: aft bearing ... through all 4 sprocket bands
    journalFore: 29.95,
    bearings: [-27.5, -22, -11, 0, 11, 22, 27.5], // 7 journals per camshaft
    bearingR: 2.05,
    bearingHalf: 1.1,
    // 36 teeth = 2x the 18-tooth crank sprocket; four flat chain bands on the
    // front face, each 0.3 cm wide, exactly filling the 28.6..29.8 sprocket stack.
    sprocket: { teeth: 36, pitchR: 6.9, toothH: 0.55, width: 0.3, bands: [28.6, 28.9, 29.2, 29.5] },
  },

  ignitionAdvance: 14, // crank degrees BTDC the spark fires

  // Firing pulses exactly 90 crank degrees apart: 1-8-7-3-6-5-4-2
  cylinders: [
    { num: 1, bank: 'L', station: 0, powerTDC: 0 },
    { num: 2, bank: 'R', station: 0, powerTDC: 630 },
    { num: 3, bank: 'L', station: 1, powerTDC: 270 },
    { num: 4, bank: 'R', station: 1, powerTDC: 540 },
    { num: 5, bank: 'L', station: 2, powerTDC: 450 },
    { num: 6, bank: 'R', station: 2, powerTDC: 360 },
    { num: 7, bank: 'L', station: 3, powerTDC: 180 },
    { num: 8, bank: 'R', station: 3, powerTDC: 90 },
  ],
};

export const wrap360 = (d) => ((d % 360) + 360) % 360;
export const wrap720 = (d) => ((d % 720) + 720) % 720;
/** Signed angle difference into (-180, 180]. */
export const signedAngle = (d) => {
  let a = wrap360(d);
  if (a > 180) a -= 360;
  return a;
};

export const bankUp = (bank) => polarDir(BANKS[bank].az);
export const bankOut = (bank) => polarDir(BANKS[bank].az + BANKS[bank].outSign * 90);

/** World point of a bank-local (along, out) position at crank-axis station x. */
export function bankPoint(bank, along, out, x = 0) {
  const u = bankUp(bank);
  const p = bankOut(bank);
  return {
    x: x + along * u[0] + out * p[0],
    y: along * u[1] + out * p[1],
    z: along * u[2] + out * p[2],
    along,
    out,
    stationX: x,
  };
}

export const valveSide = (valve) => (valve === 'exhaust' ? +1 : -1);

/** Valve axis azimuth: bore axis tilted by valveAngle toward that valve's cam. */
export function valveAxisAz(bank, valve) {
  const b = BANKS[bank];
  return b.az + b.outSign * valveSide(valve) * SPEC.head.valveAngle;
}

const H = SPEC.head;
/** Seat -> cam axis distance measured along the valve axis, at zero lift. */
export const camAxisStation = H.stemToTip + H.shim + H.bucketHeight + H.camBaseRadius;

export const HEAD_TOP_A =
  H.seatA + Math.cos(H.valveAngle * DEG) * camAxisStation + H.camBaseRadius + H.coverExtra;

/** Cam axis bank coordinates: [along, out]. */
export function camAxisBank(bank, valve) {
  const s = valveSide(valve);
  const d = camAxisStation;
  return [
    H.seatA + d * Math.cos(H.valveAngle * DEG),
    s * (H.seatOffset + d * Math.sin(H.valveAngle * DEG)),
  ];
}

/** Intake / exhaust cam axis azimuths and their separation. */
export function camAzimuths(bank) {
  return {
    intake: camAxisBank(bank, 'intake'),
    exhaust: camAxisBank(bank, 'exhaust'),
  };
}

// ---- block solid topology -------------------------------------------------
// The block casting is decomposed into solids that are axis-aligned in one
// bank's (along, out) frame or in world (y,z). Because bank axes are
// orthonormal and centred on the crank axis, radius from the crank axis is
// hypot(along, out) in bank frames - every tangent/chord below guarantees
// each solid mates exactly with the crankcase cylinder (no floating parts).

const BLOCK = SPEC.block;
const OD2 = BLOCK.caseOuterRadius * BLOCK.caseOuterRadius;
const ID2 = BLOCK.crankcaseRadius * BLOCK.crankcaseRadius;

/** Max |out| that still fits a bearing stripe of half-width halfOut on the OD arc. */
export const OD = BLOCK.caseOuterRadius;
export const ID = BLOCK.crankcaseRadius;

/** Along-frame chord depth where the OD cylinder crosses out = +/-halfOut. */
export function arcHalfDepth(halfOut) {
  return Math.sqrt(OD2 - halfOut * halfOut);
}

/** World half-width where the OD cylinder crosses z = -|halfZ|. */
export function arcHalfWidth(halfZ) {
  return Math.sqrt(OD2 - halfZ * halfZ);
}

/** Along-frame chord depth where the ID (void) cylinder crosses out = +/-halfOut. */
export function idHalfDepth(halfOut) {
  return Math.sqrt(ID2 - halfOut * halfOut);
}

/**
 * Deck corner support column of a bank: from the OD chord plane up to the
 * deck, outboard of the bore tunnel. Bottom corners land ON the OD cylinder
 * (out = deckHalfWidth) and outside the crankcase void (out = boreWallHalf).
 */
export function supportColumn(bank) {
  const out0 = BLOCK.boreWallHalf;
  const out1 = BLOCK.deckHalfWidth;
  const along0 = arcHalfDepth(out1);
  return {
    bank,
    along0,
    along1: BLOCK.deckA,
    out0,
    out1,
    // clearance checks in radius terms
    rInnerBottom: Math.hypot(along0, out0),
    rOuterBottom: Math.hypot(along0, out1),
  };
}

/** Main bearing cap lug: side plates whose top corners bear on the void edge. */
export function mainCapLug(halfOut0 = 3.0, halfOut1 = 4.6, zTop = -8.9, zBottom = -11.5) {
  return {
    y0: halfOut0,
    y1: halfOut1,
    zTop,
    zBottom,
    rCorner: Math.hypot(halfOut0, zTop), // must sit on the casting, not in the void
  };
}

/** X positions of the five main bearing caps (slab centres and slab joints). */
export const MAIN_CAPS_X = [24.25, 11, 0, -11, -24.25];

/** Oil pan flange half-width at its bolt plane z = flangeZ. */
export function panFlangeHalfWidth(flangeZ) {
  return arcHalfWidth(Math.abs(flangeZ));
}
