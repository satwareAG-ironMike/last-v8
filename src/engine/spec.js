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
    // Four lanes, one per DOHC cam chain, all inside x 28.6..29.8. The bore is
    // the turned-down nose spigot the four bored sprocket hubs press onto;
    // src/engine/drive.js derives the hub, tip and gap-floor radii from
    // pitchR/teeth plus the chain profile, and the hub must clear every gap.
    sprocket: { radius: 3.15, bore: 2.4, teeth: 18, pitchR: 3.45, toothH: 0.55, x0: 28.6, x1: 29.8 },
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
    // the press-fit interference a cylinder liner slips into the bore wall columns
    // with: the liner's OD is the bore shell plus this (row A1-G6 slice 8E gates the
    // water jacket's cast land off this number, so it is published once here)
    linerWallCm: 0.15,
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

    // ---- the two faces the test stand is allowed to bolt onto ----
    // panFlangeZ: top plane of the cast pan rails; panRailZ: their bottom face,
    // which is also the oil-pan's top face - the only flat plane under the block.
    panFlangeZ: -11.15,
    panRailZ: -11.6,
    panInset: 0.25, // the pan wall stands this far inboard of the pan-rail edge
    // A1-G7 / issue #16: the OHV variant casts its pan rails on its own skirt, at
    // its own depth under its own drum. A sump therefore hangs a DEPTH below the
    // rail plane it is cast on - never at an absolute z - or the two builds would
    // share a plane neither of them has.
    oilPanDepthCm: 3.0, // rail plane down to the pan's bottom face
    oilPanPlugDropCm: 0.45, // pan bottom down to the drain plug's lowest face
  },

  head: {
    deckA: 24.1,
    seatA: 24.1, // valve seat face is the deck plane
    // Inboard(-) / outboard(+) of the bore axis. Issue #11 measured what 2.2 did:
    // the two seat inserts of one cylinder stood 0.0324 cm apart on the cylinder
    // axis and the two machined spring floors 0.0376 cm apart, so no spark plug
    // could stand there (0.0340 cm of air on the axis at the chamber roof, cyl 3;
    // 0.0045 cm at cyl 4). 2.85 with the 4.4/4.0 discs below opens the channel
    // that test/heads.test.mjs now gates; the outboard limit is the bore tunnel
    // (reach = seatOffset + headDia/2 x cos 15 must stay under block.boreRadius).
    seatOffset: 2.85,
    valveAngle: 15, // valve axis tilt away from the bore axis, toward its cam
    stemToTip: 8.4, // seat -> valve tip along the axis, zero lift
    stemRadius: 0.34,
    // Re-proportioned with seatOffset above: 5.4/4.8 discs are what crowded the
    // cylinder axis. 4.4/4.0 keeps the intake disc edge 0.125 cm inside the
    // 5.1 bore tunnel at the seat plane (test/heads.test.mjs measures the reach).
    headDia: { intake: 4.4, exhaust: 4.0 },
    headThickness: 0.7,
    guideLength: 3.0,
    bucketRadius: 1.9,
    bucketHeight: 1.6,
    shim: 0.3,
    camBaseRadius: 2.0, // ground base circle a flat follower can be cut against:
    // the machined outline stays convex only while camBaseRadius + maxLift stays
    // above 2 p maxLift / halfCamRad^2. 1.6 failed it outright - the lobe reached
    // 0.5005 cm past every bucket face it drove (#8 item 3) - and 1.9 could not
    // hold the disc edge 0.20 cm clear of the crown at the events below
    // (measured 0.1982 cm there against 0.2093 cm at 2.0 - both figures belong to
    // the 2.2 seatOffset / 5.4-4.8 disc valve row and are history from row
    // P1-G13 on, which re-proportioned that row; the live figure that row
    // measures is 0.3163 cm. The floor is enforced
    // by test/heads.test.mjs, the numbers generated by scripts/valve-train-audit.mjs).
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
    coverPlate: 0.7, // cam-cover plate thickness; ceiling = top - coverPlate
    stayTopA: 30.0, // top plane of the deck ribs the bucket towers stand on; the
    // plug boss face the spark plug's hex clamps against stands off this plane

    // ---- machined rings around each valve axis ----
    // Each ring is a published wall over the bore it surrounds, not an outside
    // diameter remembered from the last casting. src/render/heads.js builds every
    // one of them from these, so re-proportioning the valve row - the fix issue
    // #11 asks for before a spark plug can stand on a cylinder axis - moves the
    // rings with the centres instead of leaving stale casting literals behind.
    // Reading: the insert flange stands this far inboard of its own valve disc
    // edge, so the flange is smaller than the disc it seats and the plug bore
    // gains air between the two inserts of a cylinder.
    seatInsertInset: { intake: 0.33, exhaust: 0.3 },
    guideWall: 0.57,       // guide OD over its 0.48 bore: 0.48 + 0.57 = 1.05
    seatPilotClr: 0.55,    // the insert's pilot boss stands this much proud of the guide OD
    springFloorWall: 0.3,  // spring-seat floor OD over the 2.25 bucket/spring bore
    springTubeClr: 0.33,   // spring-tube bore over the 1.57 compressed-coil OD
    springTubeWall: 0.3,   // spring-tube OD over its own bore
    collarWall: 0.55,      // bucket-bore collar OD over its bore
  },

  // ---- spark plug: one published silhouette on every cylinder axis (issue #11) ----
  // The channel law in test/heads.test.mjs measures the machined void against these
  // radii, so the plug the repo renders and the bore it screws into are the same
  // published numbers. M14-class proportions: 14 mm threaded reach, a hex of corner
  // radius 1.05, so 2 x 1.05 x cos 30 = 1.819 cm across flats: an 18 mm AF plug.
  // The stack is measured from the plug's seat face at PLUG_BOSS_A: the segments
  // below it stand in the head and the chamber, the segments above it stand in
  // air beside the two cam covers.
  plug: {
    bossOff: 0.5,      // plug-boss face stands this far above head.stayTopA
    clr: 0.05,         // air the channel must keep around the whole silhouette
    wallCasting: 0.25, // aluminium the head keeps between the bore and its own rings
    crownAir: 0.5,     // the plug's lowest point stays this far above the TDC crown plane
    // The additive tip glow is a sphere of this radius standing on the spark gap
    // (the stack's lowest point) and faded by firingProgress. Its size comes from
    // the air the glow has WHILE IT IS LIT: the flash only exists inside its burn
    // window, so the poses that bind are the union of every legal window - cycle
    // 720-advance..720 plus 0..burnDeg over advance 14..40, i.e. cycle 680..720 and
    // 0..20 at 0.25 deg steps (tmp/plug-glow-window.mjs). There the plug's own metal
    // keeps 0.5000 cm of air against its piston crown at cycle 0, 1.1967 cm from its
    // valve heads at cycle 680 and 1.9812 cm from the seat inserts, so the sphere may
    // reach 0.5000 - clr = 0.4500. The published value is the largest rung that keeps
    // twice clr: 0.40 leaves 0.1000 cm, 0.45 would sit on the limit with no headroom
    // and 0.50 reads 0.0000 and FAILS clr. A whole-cycle version of this law is
    // impossible - the gap point's whole-cycle minimum is 0.0968 cm at valve max lift
    // (intake cycle 480), and every legal window stands 226..261 crank degrees from
    // that pose. Tightest animated plug-solid-to-valve-head air: 0.0819 cm (cyl 1,
    // its intake head at cycle 408, stable from 4 to 80 bins and 3 deg to 0.1 deg
    // steps, tmp/plug-solid-refine.mjs).
    glowR: 0.4,        // floor: electrode.rTip 0.15, the glow must cover the live end
    thread: { r: 0.7, len: 4.9 },   // screwed into the head from the boss face down
    shell: { r: 0.58, len: 1.0 },   // smooth metal shell below the threads
    // Insulator nose standing in the combustion chamber between the two valve
    // heads of its cylinder: widest where it enters the bore mouth, tapering to
    // the tip exactly the way a ground insulator does. The taper is what lets a
    // real M14 nose live between two valve discs - a straight 0.45 cylinder stood
    // 0.393 cm from cyl 7's intake head where it needs 0.50 (measured, row P1-G13).
    nose: { r: 0.45, rTip: 0.3, len: 1.2 },
    // Live end: the centre electrode and its insulator tip, tapering to the spark
    // gap. Real plugs taper here too - the 0.25 body is the insulator, the gap end
    // is the thin electrode - and this model's chamber is only 1.85 cm tall, so a
    // blunt 0.25 cylinder at the tip stood 0.288 cm from cyl 3's intake valve head
    // where the law wants 0.30 (measured, row P1-G13).
    electrode: { r: 0.25, rTip: 0.15, len: 0.5 },
    hex: { r: 1.05, len: 1.6 },     // corner radius 1.05 -> 1.819 across flats, seated on the boss face
    boot: { r: 0.7, len: 2.5 },     // insulator boot above the hex
    terminal: { r: 0.45, len: 1.5 },
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

  // ---- industrial test stand (routing solved against the measured casting
  // envelope: tmp/stand-lanes2.mjs, tmp/stand-faces.mjs, tmp/stand-candidate2.mjs)
  // The engine is carried on two real casting interfaces only:
  //   A. the oil-pan flange - the block's cast pan rails (flat pads,
  //      |y| <= panFlangeHalfWidth(panFlangeZ), z panRailZ..panFlangeZ) and the
  //      pan side wall at |y| = panWallHalfWidth(): 4 mounts, 2 clamp bolts each.
  //   B. the fore/aft end-disc flat x-faces at |x| = endDiscFaceX(): 4 locator
  //      jaws, one reaction frame per end, so crank torque has nowhere to go.
  // No cradle under the pan is possible: the pan bottom is z -14.6, its drain
  // plug reaches -15.05 and the floor is -16.5 - 1.45..1.90 cm of air. Every
  // frame member therefore travels the free lane floorZ..frameZ1 or the corridor
  // outside |x| > 22, and the fore/aft frame has to dodge the rotating hardware:
  // nose stub r 3.0, sprocket drum x 28.6..29.8 r 3.74, flywheel disc r 9.4 plus
  // ring gear r 9.95. Non-mount members keep >= minAir of real air; mounts mate.
  stand: {
    floorZ: -16.5, // test-cell floor plane: the stand's feet, nothing below
    frameZ1: -15.15, // top face of every frame beam (measured free lane ceiling)
    bedX: [-35.5, 35.5], // bed rails under the block, outboard of everything
    bedY: [13.2, 17.2],
    skidX: [-30.5, 30.5], // centre skid rails under the oil pan lane
    skidY: [4.4, 6.4],
    tieForeX: [33.0, 35.5], // fore/aft cross ties: the frame's torsion box
    tieAftX: [-35.5, -33.0],
    sideTieX: [22.4, 24.4], // ties from each bed rail down to its skid rail
    postX: [16.5, 19.5], // mount posts, one per corner, outboard of the pan
    postY: [4.4, 6.4], // its bottom face sits on frameZ1 (derived), its top on padZ0
    padInX: 15.5, // mount plate: its inboard edge and top face are DERIVED from
    padOutX: 20.5, // the pan wall and the pan-rail plane plus `bite`, not pinned
    padOutY: 6.4,
    padZ0: -12.6,
    colOutX: 27.6, // fore/aft locator pedestals, outboard of the flywheel ring gear
    colY: [13.2, 17.2],
    colZ1: -13.8, // their base is frameZ1 (derived), so they stand on the bed rails
    jawOutX: 27.0, // locator jaws clamping the end-disc faces; inboard face derived
    jawY: [6.0, 10.0],
    jawZ: [-12.6, -5.2],
    braceX: 18.0, // diagonal gussets: buried in the bed rail, buried in the mount post
    braceR: 0.55,
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
    // 1.1 cm net lift at the tappet (was 1.2). This head leaves 0.325 cm between
    // the 5.4 cm intake disc edge and the flat piston crown at overlap TDC, so a
    // 1.2 cm lift over any realistic event cannot be held out of the crown: the
    // best window found in a 419340-row sweep of realistic ground angles
    // (IVO 10..35, EVC 10..35, EVO 35..75, IVC 40..75, LSA 108..118, durations
    // 225..290 crank deg) measured 0.1875 cm, inside the 0.20 cm floor
    // test/heads.test.mjs now enforces. 1.1 cm at base circle 2.0 measures 0.2093 cm.
    maxLift: 1.1,
    // Ground nose arc radius of each lobe, the single machined value the lift
    // law is derived from in src/engine/timing.js (lobeNoseExponent). A flat
    // follower can only ride a profile whose outline curvature stays positive;
    // that curvature is exactly this radius at the nose and it holds 0.40 at
    // every point of the event at these values (GATES A1-G1 / A1-G3).
    lobeNoseRadius: 0.4,
    // Cycle angles in CRANK degrees, c = 0 at power TDC:
    //   0..180 POWER | 180..360 EXHAUST | 360..540 INTAKE | 540..720 COMPRESSION
    // Published as the four ground angles a cam grinder is given, and read back
    // as zero-lift durations: IVO 18 BTDC + IVC 76 ABDC -> 274 crank deg intake,
    // EVO 70 BBDC + EVC 26 ATDC -> 276 crank deg exhaust. Quoted at 0.050 in /
    // 0.127 cm of lift the same two lobes measure 230.54 and 231.36 crank deg
    // (test/timing.test.mjs A1-G3), i.e. 84 % of the zero-lift event, which is
    // how a 0.433 in lift flat-tappet cam is actually quoted.
    // Lobe separation 115.5 cam deg = half the 231 crank deg centre separation.
    exhaustOpen: 110, // 70 deg before exhaust BDC
    exhaustClose: 386, // 26 deg after overlap TDC -> 276 deg duration
    intakeOpen: 342, // 18 deg before overlap TDC
    intakeClose: 616, // 76 deg after intake BDC   -> 274 deg duration
    // Overlap = 18 + 26 = 44 crank deg, 43 whole crank degrees with both valves
    // off their seats (the timing test window is 40..70).
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
    bearingR: 2.05, // the LINE BORE: both halves of every tunnel are machined to this
    bearingHalf: 1.1,
    // ---- the cam bearing stack (A1-G7, issue #8 addendum item 4) ----
    // Only the walls are published. journalR -> +oilFilm -> shellIdR, +shellWall ->
    // bearingR (the line bore), +castWall -> casting OD, +tabStand -> the bolt tab:
    // every radius, the cap bolt line and the nose clearance derive in
    // src/engine/bearings.js. The running clearance is the oil film under a
    // replaceable shell, never a number typed between the cam and a cast bore.
    bearing: {
      oilFilm: 0.04, // hydrodynamic film the journal rides on
      shellWall: 0.26, // replaceable shell: 1.79 inside, 2.05 outside against the bore
      castWall: 0.75, // head casting wall outside the line bore
      tabStand: 0.60, // the cap tab stands this far off the casting
      tabH: 1.90, // tab height along the split-plane normal; a cap bolt is 2 x this
      tabInset: 0.15, // tab half width along the cam axis: bearing width minus this
      boltHoleR: 0.24, // cap bolt hole machined through both tabs
      boltAcrossR: 0.52, // cap bolt head across flats
      oilHoleR: 0.10, // radial oil way drilled through every shell
      oilAz: { cradle: [150, 210], cap: [60, 300] }, // psi 0 crown-ward, 180 deck-ward
      wrenchClr: 0.35, // socket body standing outside the cap bolt head: the cam
      // bearing housing wall has to stand this much past the hex or no cap bolt can
      // be turned under the cover, and the cover bolts onto that wall
      housingWall: 0.60, // the cast cam bearing housing wall each column stands on,
      // past the wrench line; its top face at CAP_TOP is the cam cover seating plane
      shellBandHalf: 0.55, // each shell half is bored full width at its end bands; the
      // middle band of this half width is where the radial oil way is drilled
      oilBandDeg: 13, // azimuth the drilled radial band covers around the published
      // oil azimuth: three radial cuts, the centre one drilled
    },
    // 36 teeth = 2x the 18-tooth crank sprocket; one chain per camshaft, each
    // running in its own published band on the front face: four bands 0.3 cm wide
    // exactly filling the 28.6..29.8 sprocket stack (src/engine/drive.js).
    // The bore is exactly SPEC.head.camJournalRadius: the continuous 1.75 cm
    // camshaft journal runs through all four sprockets, so each one is a bored
    // ring on the journal rather than a part that has to be keyed beside it.
    sprocket: { teeth: 36, bore: 1.75, pitchR: 6.9, toothH: 0.55, width: 0.3, bands: [28.6, 28.9, 29.2, 29.5] },
  },

  // ---- the cam chain: one published roller-chain profile the whole drive uses ----
  // A chain sprocket gap is machined from the roller profile, so the published
  // numbers here ARE the tooth spaces: every gap is a cutter arc of
  // rollerR + gapClr centred on the pitch circle at the tooth valley, and the
  // chain's rollers sit in those gaps with gapClr of air. The link pitch is NOT
  // typed here: src/engine/drive.js derives it from the published pitch circles
  // and tooth counts above, which test/valvetrain.test.mjs already pins shared
  // between the two sprockets (2 * 18 teeth, 2 * 3.45 = 6.9).
  chain: {
    rollerR: 0.3,        // chain roller riding in the machined tooth space
    gapClr: 0.1,         // air the machined gap keeps around every roller
    hubClr: 0.15,        // air between the machined gap floor and the web it hangs on
    band: 0.3,           // one band's width in x = the cam band spacing
    plate: 0.06,         // one chain side-plate layer; two run per band
    channel: 0.15,       // inner width of the band: the sprocket tooth rides here
    toothW: 0.13,        // sprocket tooth thickness in x = channel - 2 * plateClr
    plateClr: 0.01,      // air between a tooth flank and its side plate
    bandClr: 0.015,      // least air between a chain and what stands beside it in x
    guidePad: 0.9,       // fixed guide shoe riding the inside of one chain span
    shoePad: 0.9,        // tensioner shoe riding the outside of the other span
    tensionerR: 2.2,     // idler the tensioned span bows around
    tensionerTravel: 1.2, // the idler arm's take-up: it must exceed the measured closure
    // Scale note, stated because it is a compromise and not a measurement: a real
    // 12 mm-pitch engineering chain is ~10 mm wide across its plates, which will not
    // fit four side by side into the 1.2 cm sprocket stack this engine publishes.
    // The drawn profile is therefore narrower than the real part (0.27 cm across the
    // two plate layers); the pitch, the tooth counts, the wrap and the clearances
    // that test/valvetrain.test.mjs gates are the real numbers.
  },

  // ---- ignition timing: the base is one named value, the two advance curves
  // and the load model keep every breakpoint here (#8 items 1, 3, 4).
  // Sources: baseDeg 14 is this repo's own v1.0.0 value (the retired
  // SPEC.ignitionAdvance); the curve shapes are ordinary small-block
  // distributor behaviour - mechanical advance starts just above idle and
  // reaches its cap below mid-range, vacuum advance only lives at part throttle,
  // and a distributor carries a total-advance limit.
  ignition: {
    baseDeg: 14, // crank degrees BTDC the spark fires at idle
    burnDeg: 20, // crank degrees the spark flash stays visible after TDC
    maxTotalDeg: 40, // total-advance limit: base + centrifugal + vacuum is clamped here
    centri: { startRpm: 800, fullRpm: 3200, maxDeg: 18 },
    vacuum: { startKpa: 25, fullKpa: 60, maxDeg: 12 },
    // Manifold model: two documented corners, a linear blend between them.
    //   closed throttle - the deepest vacuum, falling away as rpm rises because
    //     the same charge must be pulled past the same plate more times a second.
    //   wide-open throttle - the manifold sits near atmospheric and only the
    //     induction pumping loss remains, which grows with rpm.
    vacuumModel: { atmKpa: 101.325, closedKpa: 88, closedFall: 0.25, wotLossKpa: 20 },
  },

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

  // ---------------------------------------------------------------------------
  // P1-G7 / P1-G5 (issue #8 addendum item 1, issue #16): THE BUILD SWITCH.
  // SPEC.build.variant selects which variant this tree draws. Every cam, lobe,
  // follower, drive, placement and naming reading derives from here through
  // the one helper src/engine/layout.js - no renderer, HTML or README may
  // type an engine name or count of its own.
  // The OHV placement is the band issue #16 sweeps against this casting: the
  // raw rod-big-end interference against the cam's widest outline starts at
  // crank.radius + rod.bigEndRadius + cam nose = 10.2 cm of centre distance,
  // and C = 10.8 is the smallest published band value where every crankcase
  // swing keeps >= 0.6 cm past the nose and >= 1.6 cm past the machined
  // bearing column (tmp/ohvband.mjs / tmp/v8-ohv-band.out).
  // drawn: false says the OHV geometry is a published contract, not a scene.
  // ---------------------------------------------------------------------------
  identity: { cell: 'SATWARE TEST CELL', serial: 'MULE 01', sn: 'S/N 0008-V8' },
  build: { variant: 'dohc' },
  variants: {
    dohc: { id: 'dohc', badgeWord: 'DOHC', centralCam: false, drawn: true },
    ohv: {
      id: 'ohv',
      badgeWord: 'OHV',
      centralCam: true,
      drawn: false,
      belowCrankCm: 10.8, // cam axis on the V bisector, below the crank centre
      // A1-G7 / issue #16: the walls this variant's cam rides in. The tunnel the
      // lobes swing in is BORED - its machined face is the swept outline plus this
      // much air - and the room between the crank-side swings and the cam is the
      // air those swings are owed, so no cast wall may stand in it (tmp/ohvdrum.mjs
      // proves the relieved drum + skirt section that follows from these three).
      tunnel: {
        lobeAirCm: 0.3, // machined bore = swept outline + this air
        crankSideAirCm: 0.4, // least air any crank-side swing keeps off cast iron
        arcStepDeg: 0.5, // sampling step of every bored/relief arc this casting machines
        // issue #8 item 4 / slice 8B: one central cam runs 16 lobes AND five
        // bearings down one 44 cm cylinder span, so this variant publishes the air
        // a lobe group keeps off a bearing - the DOHC published lobe width cannot
        // fit it (16 x 2.6 cm is 41.6 of the 44 cm span with no room for a bearing)
        // and the lobe width law derives the narrower one from this.
        lobeAxialAirCm: 1.1,
      },
    },
  },
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

/** Bank-local `along` of the machined plug-boss face the plug's hex seats on. */
export const PLUG_BOSS_A = H.stayTopA + SPEC.plug.bossOff;

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

/**
 * The oil system's published contract - issue #8 addendum item 5, slice 8D-1.
 * src/engine/oil.js derives every route from these values; test/oil.test.mjs gates
 * each one against the drawn iron through test/support/oil-iron.mjs. Radii and walls
 * are derived from the geometry above. The corridor waypoints are the heights and
 * offsets the sampled drills actually ran along (tmp/8d-published.mjs ->
 * tmp/8d-published5.out: 78 published routes, 78 clean, every one sampled at its own
 * drilling radius with only its own named terminus part and its own named oil space
 * allowed). They route the drills; they add no geometry of their own.
 */
SPEC.oil = {
  // the crankcase wall band the main gallery is bored in: at its mid radius, leaving
  // the published housing wall of iron between the bore and every machined face
  galleryMidR: (SPEC.block.crankcaseRadius + SPEC.block.caseOuterRadius) / 2,
  wallMinCm: SPEC.cam.bearing.housingWall,
  galleryR:
    (SPEC.block.caseOuterRadius - SPEC.block.crankcaseRadius) / 2 - SPEC.cam.bearing.housingWall,
  galleryFaceClrCm: 0.5, // the gallery stops this inside the block's own end faces
  feedDrillR: SPEC.cam.bearing.oilHoleR, // the published radial shell way, every feed
  pumpDrillR: 0.3, // the pump's own discharge way
  mainShell: { filmCm: 0.05, wallCm: 0.7 }, // the shell src/render/block.js presses in
  rodFilmMidCm: 0.025, // a through-crank way ends mid the film over the pin
  // the head deck rail the block->head legs and the cam galleries share, derived
  railOut: (SPEC.head.gasketId + SPEC.head.gasketOd) / 2,
  railBand: (SPEC.block.deckA + SPEC.head.gasketT + SPEC.head.railTopA) / 2,
  railTopCm: SPEC.head.railTopA,
  linkFloorCm: 9.25, // where a flank column leaves the wall-band arc, beside its liner
  deckFaceClrCm: 0.05, // a column breaks into the deck passage this below the deck face
  deckRiseCm: 0.8, // and stands this above it, into the rail
  camFeedCrossCm: SPEC.manifold.exFlangeA1 + 0.7, // the crossing over the housing tie rib
  camFeedOutRunCm: 3.0, // how far past the cam axis it crosses, clear of the riser
  camFeedStandCm: 4.4, // its approach stands off the line bore, at the cradle azimuth
  camFeedPsiDeg: SPEC.cam.bearing.oilAz.cradle[0],
  // the sump each variant bolts on: its pickup screen hangs this above its own floor
  pickupX: 18,
  pickupDropCm: 0.8,
  pump: {
    // Each variant stands its pump on the iron its own casting offers beside its own
    // pan wall. Both stands were fixed by classifying the drawn tree at the clearance
    // law 1 measures (tmp/8d-pumpbody.mjs -> tmp/8d-pumpbody.out).
    x: 18,
    r: 0.3,
    stand: {
      dohc: { y: 3.8, z: -10.5 }, // on the gallery plane, outboard of the pan wall
      ohv: { y: 4.05, z: -10.8 }, // on its drum skirt, below the tunnel crown plane
    },
  },
  // the OHV mid-main corridor its cast boot legs leave free (tmp/8d-ohvmain.out),
  // out of the crown gallery in and down to the journal, y/z off the crank axis
  ohvMainLeg: [
    [8.0006, -6.8], [6.75, -6.8], [5.75, -7.8], [5.5, -7.8], [5.0, -8.3], [4.75, -8.3],
    [4.5, -8.55], [4.25, -8.55], [4.0, -8.3], [4.0, -6.8], [3.75, -6.55], [3.25, -6.55],
    [0.0, -3.45],
  ],
  ohvMainStationsX: [11, 0, -11], // the three the drawn iron reaches (issue #28)
  ohvCamFeed: { inCm: 6.75, shelfZ: -9.55 }, // the run from the crown gallery to the wall
  bridgeStationsX: [MAIN_CAPS_X[0], MAIN_CAPS_X[MAIN_CAPS_X.length - 1]],
  counts: {
    dohc: {
      mains: MAIN_CAPS_X.length,
      rods: SPEC.cylinders.length,
      cams: Object.keys(SPEC.banks).length * 2 * SPEC.cam.bearings.length,
    },
    ohv: {
      mains: MAIN_CAPS_X.length,
      rods: SPEC.cylinders.length,
      // one bushing at each machined tunnel face plus one in each gap between the
      // published cylinder stations - the same window list src/engine/layout.js bores
      cams: SPEC.block.stations.length + 1,
    },
  },
  pendingIssues: ['#8', '#16', '#28'],
  pending: {
    drawnHoles: {
      // 8D-2a drew the oil assembly; 8D-2b drills the iron it feeds: main shells
      // and the OHV tunnel bushings are done (test/block.test.mjs), these two are not.
      issue: '#8',
      open: [
        'the 5 OHV tunnel bushings (their bore is measured at 48 turned facets by '
        + 'test/ohv-cam.test.mjs; the drilling collides with that grid, options on #8)',
        'the head gasket oil hole',
        'the crank throw way that feeds the rod bearings',
      ],
    },
    lifterGallery: '#16', // no lifter gallery is cast until 8C-3 picks an option
    ohvMains: '#28', // the OHV fore/aft mains stand off the wall band with no iron route
    ohvInboardGallery: '#28', // nothing bridges the banks at its crown plane
  },
};

/**
 * The cooling of both builds (issue #8 addendum item 1, GATES row A1-G6 slice 8E):
 * the walls a water jacket is cast in and the planes its passages are bored between.
 * Like SPEC.oil, this table routes and dimensions the cavities; it adds no geometry
 * of its own, and src/render/coolant.js draws exactly what src/engine/coolant.js
 * publishes from it.
 *
 * Every value below is either a published casting dimension read off this file or a
 * cast wall the row claims, and the geometry they place was proven against the drawn
 * iron before it was written: tmp/8e-warrant3.mjs samples every leg of every passage
 * in both variants (WARRANT OK, 394952 samples, 0 offender kinds, 0 leg-joint gaps).
 * The walls the row *claims* are the conservative ones (wallMinCm, floorWallCm); the
 * placement walls (skinCm, landCm, bayClrCm, deckBandCm, railClrCm) are where the
 * cavity sits, and test/support/coolant-iron.mjs measures both against the tree.
 */
SPEC.coolant = {
  // ---- the walls the jacket is closed by ----
  landCm: 0.4, // cast land between the press-fit liner OD and the water
  skinCm: 0.35, // cast skin between the water and the block's outer casting face
  webCm: 0.1, // cast web between the water and any bore the oil network drills
  tunnelWebCm: 0.2, // cast web between the water and the machined cylinder bore
  boltWebCm: 0.1, // cast web between the water and a head bolt shank
  bayClrCm: 0.3, // cast end wall between the jacket and a counter bay mouth
  deckBandCm: 2.6, // iron between the jacket crown and the machined deck face
  railClrCm: 0.125, // between the head's coolant roof and the cam feed gallery it passes under
  floorClrCm: 0.4, // between the jacket floor plane and the crankcase drum it stands over
  // the closure claims row A1-G6 measures: iron this thick must stand behind a face
  wallMinCm: 0.25,
  floorWallCm: 4.0,
  // the narrowest coolant way this row is willing to call a passage
  bandMinCm: 0.2,
  // ---- the planes the passages are bored between ----
  linerOdCm: SPEC.block.boreShellRadius + SPEC.block.linerWallCm, // 5.45
  waterInCm: SPEC.block.boreShellRadius + SPEC.block.linerWallCm + 0.4, // 5.85 off the bore axis
  waterOutCm: SPEC.block.deckHalfWidth - 0.35, // 6.65, under the casting skin
  feedLegInCm: SPEC.oil.railOut - SPEC.oil.feedDrillR, // 6.15: this build's outboard feed drilling
  feedLegOutCm: SPEC.oil.railOut + SPEC.oil.feedDrillR, // 6.35
  jacketFloorA: SPEC.block.caseOuterRadius + 0.4, // 12.0 up the bore axis
  jacketCrownA: SPEC.block.deckA - 2.6, // 21.5, below the deck band
  jacketXHalfCm: SPEC.block.counterBayHalfX - 0.3, // 21.7, inside the counter bays
  endPortWidthCm: 0.7, // the outermost slab of each jacket rises through the deck at each end
  deckA: SPEC.block.deckA, // 24.1: the block face a riser is bored up to
  headFloorA: SPEC.block.deckA + SPEC.head.gasketT, // 24.25: the head deck face
  headCrownA: SPEC.oil.railBand - SPEC.oil.feedDrillR - 0.125, // 25.4, under the cam feed gallery
  crossX0Cm: 23.0, // the head end cross gallery is bored from here...
  crossX1Cm: 27.0, // ...to here, outboard of the block's counter bay mouth
  linkIntoGalleryCm: 0.4, // how deep each end link is bored into that gallery, so the
  // two windows share water instead of just touching at a plane
  crossFloorClrCm: 0.35, // the cast floor this gallery stands on: out over the block's
  // end there is no deck under it, so it is bored as a bore in the head's end wall
  crossFloorA: SPEC.block.deckA + SPEC.head.gasketT + 0.35, // 24.6
  portHalfXcm: 1.7, // a deck riser is as wide as the head stay standing over it
  boltA0Cm: SPEC.block.deckA, // the drawn head bolts occupy a 24.1..28.0 along the bore axis
  boltA1Cm: 28.0,
  // ---- the bands each bank carries water in ----
  // the valley side of the wall band, then the two flanks the cast boss holding
  // this build's outboard feed drilling splits it into
  bands: [
    { id: 'in', o0: -(SPEC.block.deckHalfWidth - 0.35), o1: -(SPEC.block.boreShellRadius + SPEC.block.linerWallCm + 0.4) },
    { id: 'out-in', o0: SPEC.block.boreShellRadius + SPEC.block.linerWallCm + 0.4, o1: SPEC.oil.railOut - SPEC.oil.feedDrillR - 0.1 },
    { id: 'out-out', o0: SPEC.oil.railOut + SPEC.oil.feedDrillR + 0.1, o1: SPEC.block.deckHalfWidth - 0.35 },
  ],
  // what this row does NOT model, stated so the open gates are read for what they
  // are missing: nothing here moves water, and no external loop exists.
  pending: {
    drawnHoles: [],
    open: [
      'water pump', 'thermostat', 'radiator and hose routes', 'jacket drain',
      'coolant flow or pressure (nothing in SPEC models a pump drive or a temperature)',
    ],
    issues: { pump: '#8', externalLoop: '#8' },
  },
};
