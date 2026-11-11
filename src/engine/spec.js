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
    pinWidth: 4.6,
    counterRadius: 6.3,
    counterThickness: 2.2,
    noseRadius: 3.0,
    flangeRadius: 5.2,
    // Absolute throw azimuth per station, front -> rear.
    // Four throws 90 deg apart in azimuth -> cross-plane ("Chinese arm") crank.
    pinAz: [315, 225, 45, 135],
    // rotation: az(throw) = pinAz - crankAngle  -> crank turns toward -Y at the top
    sense: -1,
  },

  rod: { length: 14.5, bigEndRadius: 3.1, capRadius: 3.1, smallEndRadius: 1.7, beamWidth: 2.4 },

  piston: { radius: 4.95, compressionHeight: 3.9, crownThickness: 1.6, skirtLength: 4.6 },

  block: {
    deckA: 24.1, // crank centreline -> deck face, up the bore axis
    boreStartA: 5.5, // bottom of the bore tunnel
    boreRadius: 5.1,
    boreShellRadius: 5.3,
    stations: [16.5, 5.5, -5.5, -16.5], // front -> rear
    pitch: 11.0,
    crankcaseRadius: 9.4,
    deckHalfWidth: 7.0,
    slabFront: 4.5, // accessory-drive slab, +X of the first station
    slabRear: 4.0, // rear main / bell housing slab, -X of the last station
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
    coverExtra: 3.4, // cam cover stand-off above the cam axis
    deckBoltRadius: 0.85,
  },

  valves: {
    maxLift: 1.2,
    // Cycle angles in CRANK degrees, c = 0 at power TDC:
    //   0..180 POWER | 180..360 EXHAUST | 360..540 INTAKE | 540..720 COMPRESSION
    exhaustOpen: 125, // 55 deg before exhaust BDC
    exhaustClose: 405, // 45 deg after overlap TDC  -> 280 deg duration
    intakeOpen: 350, // 10 deg before overlap TDC
    intakeClose: 590, // 50 deg after intake BDC    -> 240 deg duration
    springFreeLength: 5.2,
    springRadius: 1.35,
    springCoils: 7,
    springWireRadius: 0.22,
  },

  cam: { halfSpeedRatio: 2 },

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
