// 60 degree DOHC V12 - single source of truth for every dimension.
// Units: centimetres. Angles: degrees.
//
// World frame:  X = crankshaft axis (engine front at +X), Y = transverse, Z = up.
// Polar angle `az` is measured in the YZ plane from +Z toward +Y:
//   polarDir(az) = (0, sin az, cos az)
// A crank throw at az = 0 points straight up, az = 90 points to +Y (engine right).
//
// Bank R (cylinders 2,4,6,8,10,12) leans to +Y: bore axis az = +30.
// Bank L (cylinders 1,3,5,7,9,11) leans to -Y: bore axis az = -30.  -> 60 degree V.
// "outboard" of a bank = away from the V: +90 polar for bank R, -90 for bank L.
// Bank-local coordinates used throughout: `along` up the bore axis, `out` outboard.
//
// Why 60 degrees: six pins 60 degrees apart in azimuth, each shared by one L and
// one R rod, put a power stroke every 60 crank degrees (test/v12.test.mjs). The
// primary and secondary shaking forces of a 60 degree V12 also cancel as a set,
// which is why the counterweights stay small.

export const DEG = Math.PI / 180;

export const polarDir = (azDeg) => [0, Math.sin(azDeg * DEG), Math.cos(azDeg * DEG)];

export const BANKS = {
  R: { az: 30, outSign: +1, cyls: [2, 4, 6, 8, 10, 12] },
  L: { az: -30, outSign: -1, cyls: [1, 3, 5, 7, 9, 11] },
};

// ---- the X layout, derived once -------------------------------------------
// Six cylinder stations at the published pitch. Every fore/aft plane downstream
// (deck ends, main journals, cam bearings, the sprocket stack, the flywheel) is a
// function of this row: lengthening or shortening the engine is one edit here and
// nothing else, which is what keeps a V8 and a V12 build from drifting apart.
const PITCH = 11.0;
const SLAB = 4.5; // accessory-drive / bell-housing slab, symmetric fore and aft
// Twin-rod pin geometry: each pin carries one L and one R big end side by side.
// A 1.3 cm big end at +/- ROD_OFF spans s +/- 1.43, the webs stand off at WEB_IN,
// and the pin runs through both slabs to +/- PIN_WIDTH/2 (test/v12.test.mjs).
const WEB_IN = 1.55;
const WEB_OUT = 2.65;
const PIN_WIDTH = 2 * WEB_OUT; // pin ends flush with the outer faces of both webs
const ROD_OFF = 0.78;
// The counterweight is integral with the web pair, so its fore/aft half extent
// is the web pair's own: nothing sticks out past WEB_OUT into the end discs.
const COUNTER_LOBE_HALF_X = WEB_OUT;
export const STATIONS = [27.5, 16.5, 5.5, -5.5, -16.5, -27.5]; // front -> rear
/** Slab joints between two cylinder stations: where the interior main caps stand. */
export const STATION_JOINTS_X = STATIONS.slice(0, -1).map((s, i) => (s + STATIONS[i + 1]) / 2);
/** |x| where the deck slab ends (half a pitch beyond the outermost station). */
export const DECK_END_X = Math.abs(STATIONS[0]) + PITCH / 2;
/** |x| of the fore/aft end-disc outer faces: the flat the stand's jaws clamp. */
const END_X = DECK_END_X + SLAB;
/** Nose sprocket plane; everything cam-driven hangs off this. */
const SPROCKET_X0 = END_X + 2.3;
const OUTER_CAM_BEARING = DECK_END_X + PITCH / 2; // on the head casting's overhang past the end disc
/** The seven main bearing journals, front -> rear: five on slab joints, two in the end discs. */
export const MAIN_JOURNALS = [
  [STATIONS[0] + WEB_OUT - 0.05, END_X],
  ...STATION_JOINTS_X.map((j) => [j - 3.05, j + 3.05]),
  [-END_X, -(STATIONS[0] + WEB_OUT - 0.05)],
];
/** Main cap centres, front -> rear: one per journal, the end ones inside their disc. */
export const MAIN_CAPS_X = [DECK_END_X + 2.25, ...STATION_JOINTS_X, -(DECK_END_X + 2.25)];
/** Free x windows between adjacent main cap lugs - the stand's mount stations. */
const CAP_GAPS = MAIN_CAPS_X.slice(0, -1).map((c, i) => (c + MAIN_CAPS_X[i + 1]) / 2);

export const SPEC = {
  banks: BANKS,

  stroke: 8.0,

  crank: {
    radius: 4.0, // half stroke
    mainRadius: 2.7,
    pinRadius: 2.4,
    pinWidth: PIN_WIDTH, // pin ends s +/- 3.1; runs through both web slabs
    webIn: WEB_IN, // web slab occupies s +/- (1.55..2.65); rod gap is s +/- 1.55
    webOut: WEB_OUT,
    webThickness: 1.1,
    webHalfU: 2.6, // web half-width perpendicular to the throw direction
    // Each pin carries one L and one R big end side by side: the two 1.3 cm wide
    // big ends span s +/- 1.43 and the webs stand off at 1.55, so a pair fits a
    // pin with 0.13 cm of air per side and cannot rub a web (test/v12.test.mjs).
    rodOff: ROD_OFF,
    counterRadius: 6.3,
    counterLobeHalfX: COUNTER_LOBE_HALF_X, // one counter lobe per throw, keyed into both webs
    counterInnerR: 2.2,
    counterArcDeg: 150,
    noseRadius: 3.0,
    flangeRadius: 5.2,
    flywheel: { radius: 9.4, x0: -(END_X + 3.5), x1: -(END_X + 1.3), ringRadius: 9.95 },
    // 18-tooth drive sprocket at the nose; cam sprockets have exactly 2x the
    // teeth AND 2x the pitch radius -> the 2:1 half-speed law is machined, not
    // faked, and both sprockets share one chain pitch (2 pi pitchR / teeth).
    sprocket: { radius: 3.15, teeth: 18, pitchR: 3.45, toothH: 0.55, x0: SPROCKET_X0, x1: SPROCKET_X0 + 1.2 },
    // Absolute throw azimuth per station, front -> rear.
    // Six throws 60 deg apart in azimuth, one pin per station, both banks' rods
    // on it: with the 60 deg bank angle every power stroke lands 60 crank
    // degrees after the previous one, twelve to the cycle.
    pinAz: [330, 30, 90, 150, 210, 270],
    // rotation: az(throw) = pinAz - crankAngle  -> crank turns toward -Y at the top
    sense: -1,
  },

  rod: { length: 14.5, bigEndRadius: 3.1, bigEndWidth: 1.3, capRadius: 3.1, smallEndRadius: 1.7, beamWidth: 2.4 },

  // Skirt must clear the counterweight tips: at BDC the pin sits 10.5 up the
  // bore, the skirt bottom 10.5 - skirtLength = 6.5 > counterRadius + 0.15.
  piston: { radius: 4.95, compressionHeight: 3.9, crownThickness: 1.6, skirtLength: 4.0 },

  block: {
    deckA: 24.1, // crank centreline -> deck face, up the bore axis
    boreStartA: 5.5, // bottom of the bore tunnel
    boreRadius: 5.1,
    boreShellRadius: 5.3,
    stations: STATIONS, // front -> rear
    pitch: PITCH,
    crankcaseRadius: 9.4,
    caseOuterRadius: 11.6, // casting OD around the crankcase
    deckHalfWidth: 7.0,
    boreWallHalf: 5.35, // half width of the bore tunnel opening in the slab profile
    deckCornerR: 1.6, // deck corner radius (head bolt bosses)
    mainBossR: 4.6, // fore main bearing hole (nose journal passes it)
    aftMainBossR: 5.7, // aft main bearing hole (flywheel flange passes it)
    counterBayHalfX: STATIONS[0] + COUNTER_LOBE_HALF_X + 0.35, // every counterweight stays inside |x| < this, r <= counterRadius
    slabFront: SLAB, // accessory-drive slab, +X of the first station
    slabRear: SLAB, // rear main / bell housing slab, -X of the last station (symmetric)

    // ---- the two faces the test stand is allowed to bolt onto ----
    // panFlangeZ: top plane of the cast pan rails; panRailZ: their bottom face,
    // which is also the oil-pan's top face - the only flat plane under the block.
    panFlangeZ: -11.15,
    panRailZ: -11.6,
    panInset: 0.25, // the pan wall stands this far inboard of the pan-rail edge
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

  // ---- industrial test stand (routing re-solved for the six-station block;
  // tmp/stand-envelope-v12.mjs measures the frame against the rendered engine)
  // The engine is carried on two real casting interfaces only:
  //   A. the oil-pan flange - the block's cast pan rails (flat pads,
  //      |y| <= panFlangeHalfWidth(panFlangeZ), z panRailZ..panFlangeZ) and the
  //      pan side wall at |y| = panWallHalfWidth(): 6 mounts (3 per side under
  //      the longer pan), 2 clamp bolts each.
  //   B. the fore/aft end-disc flat x-faces at |x| = endDiscFaceX(): 4 locator
  //      jaws, one reaction frame per end, so crank torque has nowhere to go.
  // No cradle under the pan is possible: the pan bottom is z -14.6, its drain
  // plug reaches -15.05 and the floor is -16.5 - 1.45..1.90 cm of air. Every
  // frame member therefore travels the free lane floorZ..frameZ1 or the corridor
  // outside |x| > DECK_END_X, and the fore/aft frame has to dodge the rotating
  // hardware: nose stub r 3.0, sprocket drum r 4.0 beyond the end disc, flywheel
  // disc r 9.4 plus ring gear r 9.95. Non-mount members keep >= minAir of real
  // air; mounts mate. Every fore/aft number below derives from the station row.
  stand: {
    floorZ: -16.5, // test-cell floor plane: the stand's feet, nothing below
    frameZ1: -15.15, // top face of every frame beam (measured free lane ceiling)
    bedX: [-(END_X + 9.0), END_X + 9.0], // bed rails under the block, outboard of everything
    bedY: [13.2, 17.2],
    skidX: [-(DECK_END_X + 8.5), DECK_END_X + 8.5], // centre skid rails under the oil pan lane
    skidY: [4.4, 6.4],
    tieForeX: [END_X + 6.5, END_X + 9.0], // fore/aft cross ties: the frame's torsion box
    tieAftX: [-(END_X + 9.0), -(END_X + 6.5)],
    sideTieX: [DECK_END_X + 0.4, DECK_END_X + 2.4], // ties from each bed rail down to its skid rail
    // Mount stations along the pan flange: the midpoints between adjacent main
    // caps are the only x windows the cap lugs leave free (every cap lug reaches
    // exactly down to the pan-rail plane, so a mount may not share its x). Every
    // other gap is used, which keeps the row symmetric about the crank axis and
    // supports the longer casting at four points per side.
    mountX: [CAP_GAPS[0], CAP_GAPS[2], CAP_GAPS[3], CAP_GAPS[5]],
    postHalf: 1.5, // post: mx +/- postHalf
    padHalf: 2.5, // mount plate: mx +/- padHalf
    postY: [4.4, 6.4], // its bottom face sits on frameZ1 (derived), its top on padZ0
    padOutY: 6.4,
    padZ0: -12.6,
    colOutX: END_X + 1.1, // fore/aft locator pedestals, clear of the end disc
    colY: [13.2, 17.2],
    colZ1: -13.8, // their base is frameZ1 (derived), so they stand on the bed rails
    jawOutX: END_X + 0.5, // locator jaws clamping the end-disc faces; inboard face derived
    jawY: [6.0, 10.0],
    jawZ: [-12.6, -5.2],
    braceR: 0.55, // diagonal gusset per mount: buried in the bed rail, buried in the post
    braceFootY: 14.4,
    braceFootZ: -15.55,
    braceHeadY: 6.0,
    braceHeadZ: -13.2,
    bite: 0.1, // design engagement depth into the pan flange (both axes)
    jawBite: 0.05, // design engagement depth into the end-disc face
    minAir: 0.5, // real air every non-mount member keeps from the engine
    boltsPerMount: 2,
    boltTipY: 2.6, // clamp bolt tip, buried in the oil-pan wall: the shaft length
    // is DERIVED from padOutY - boltTipY in stand.js, so it can never be pinned wrong
    boltZ: -12.05,
    boltOffX: 2.0, // bolt offsets from the mount centre along x
    boltAcross: 1.3,
    boltHeadH: 0.9,
    boltShaftR: 0.42,
  },

  // Camera rig (src/ui/cameraRig.js). The home pose is the swept boot framing
  // recorded in G5d; every limit is published here, so the rig tests measure
  // what the rig actually does instead of what the author remembered.
  view: {
    homePos: [84.4, -117.6, 104.5], // solved against the engine+stand union bbox
    homeTarget: [-1.9, 1.9, 7.9],
    fov: 48,
    aspect: 1280 / 713, // the size the headless gates render at
    distMin: 42, // close enough to read a valve spring through the section
    distMax: 420, // inside the fog far plane (900) and the shadow camera (420)
    pitchLimit: 1.35, // rad, stays clear of the Z-up gimbal at 90 deg
    eyeMin: 2.0, // the camera never dips closer than this to the cell floor
    orbitSpeed: 0.0045, // rad per pixel of mouse travel
    zoomStep: 1.18, // per wheel notch, multiplicative: even zoom feel at any range
    walkSpeed: 45, // cm/s; Shift = walkBoost x
    walkBoost: 3.5,
    damping: 9, // 1/s, exponential: smooth orbit/zoom, frame-rate independent
    walkBounds: { x: 95, y: 95, zMax: 70 }, // its z floor is derived: floorZ + eyeMin
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
    journalAft: -(OUTER_CAM_BEARING + 1.2), // continuous journal: aft bearing ... through all 4 sprocket bands
    journalFore: SPROCKET_X0 + 1.35, // lands 0.15 past the sprocket stack
    bearings: [
      OUTER_CAM_BEARING,
      DECK_END_X,
      ...STATION_JOINTS_X,
      -DECK_END_X,
      -OUTER_CAM_BEARING,
    ], // 9 journals per camshaft: one per slab joint, one per deck end, one per drive end
    bearingR: 2.05,
    bearingHalf: 1.1,
    // 36 teeth = 2x the 18-tooth crank sprocket; four flat chain bands on the
    // front face, each 0.3 cm wide, exactly filling the sprocket stack.
    sprocket: {
      teeth: 36,
      pitchR: 6.9,
      toothH: 0.55,
      width: 0.3,
      bands: [0, 1, 2, 3].map((i) => SPROCKET_X0 + i * 0.3),
    },
  },

  ignitionAdvance: 14, // crank degrees BTDC the spark fires

  // Firing pulses exactly 60 crank degrees apart: 1-6-5-10-9-2-4-3-8-7-12-11.
  // The order is not typed in here: it is what timing.firingOrder() derives from
  // these power TDCs, and firingOrder() throws if any of them is not a physical
  // top dead centre of that cylinder's own crank throw. The per-column choice
  // (which rod of a pair fires in the first revolution, which in the second)
  // alternates banks, the closest a 6-pin 60 degree V can come to strict
  // alternation: two same-bank adjacencies are provably unavoidable, because the
  // two events of one pin are 360 degrees apart and therefore share a parity.
  cylinders: [
    { num: 1, bank: 'L', station: 0, powerTDC: 0 },
    { num: 2, bank: 'R', station: 0, powerTDC: 300 },
    { num: 3, bank: 'L', station: 1, powerTDC: 420 },
    { num: 4, bank: 'R', station: 1, powerTDC: 360 },
    { num: 5, bank: 'L', station: 2, powerTDC: 120 },
    { num: 6, bank: 'R', station: 2, powerTDC: 60 },
    { num: 7, bank: 'L', station: 3, powerTDC: 540 },
    { num: 8, bank: 'R', station: 3, powerTDC: 480 },
    { num: 9, bank: 'L', station: 4, powerTDC: 240 },
    { num: 10, bank: 'R', station: 4, powerTDC: 180 },
    { num: 11, bank: 'L', station: 5, powerTDC: 660 },
    { num: 12, bank: 'R', station: 5, powerTDC: 600 },
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

/** X positions of the main bearing caps are derived at the head of this file
 * (MAIN_CAPS_X): one cap per main journal, interior caps on the slab joints. */

/** Oil pan flange half-width at its bolt plane z = flangeZ. */
export function panFlangeHalfWidth(flangeZ) {
  return arcHalfWidth(Math.abs(flangeZ));
}

/**
 * The two flat casting faces the test stand is allowed to bolt onto, derived
 * from the block topology above so the stand can never claim a face the casting
 * does not actually have (test/stand.test.mjs measures them off the block group).
 */
/** |y| half-width of the oil-pan side wall the mount pads clamp against. */
export const panWallHalfWidth = () =>
  panFlangeHalfWidth(SPEC.block.panFlangeZ) - SPEC.block.panInset;

/** z of the pan-rail bottom face = the oil-pan top face: the mount bearing plane. */
export const panRailPlane = () => SPEC.block.panRailZ;

/** |x| of the fore/aft end-disc flat faces the locator jaws clamp against. */
export const endDiscFaceX = () =>
  SPEC.block.stations[0] + SPEC.block.pitch / 2 + SPEC.block.slabFront;
