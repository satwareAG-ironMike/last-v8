// Kinematics of the cross-plane 90 deg DOHC V8.
// Pure math, no Three.js: this module is the authority the renderer is driven from.
//
// Every valve event is DERIVED from the cam lobe profile that is machined in the
// geometry module: lift(theta) = lobe radius facing the follower - base circle.
// Cam angle = crank angle / 2 (belt/chain ratio 2:1).

import {
  SPEC,
  BANKS,
  DEG,
  polarDir,
  bankPoint,
  bankUp,
  camAxisBank,
  valveAxisAz,
  valveSide,
  wrap360,
  wrap720,
  signedAngle,
  camAxisStation,
} from './spec.js';

const CRANK = SPEC.crank;
const H = SPEC.head;
const V = SPEC.valves;

export const stationX = (cyl) => SPEC.block.stations[cyl.cyl ? cyl.station : cyl.station];

/** Absolute azimuth of a crank throw at crank angle theta (deg). */
export function pinAzimuth(cyl, theta) {
  return CRANK.pinAz[cyl.station] + CRANK.sense * theta;
}

/** Angle between the throw and that bank's bore axis, in (-180,180]. */
export function throwOffset(cyl, theta) {
  return signedAngle(pinAzimuth(cyl, theta) - BANKS[cyl.bank].az);
}

/** Distance from the crank centreline to the piston pin, measured up the bore axis. */
export function pistonAlong(cyl, theta) {
  const phi = throwOffset(cyl, theta) * DEG;
  const R = CRANK.radius;
  const L = SPEC.rod.length;
  const s = R * Math.sin(phi);
  return R * Math.cos(phi) + Math.sqrt(L * L - s * s);
}

export function crankPinPoint(cyl, theta) {
  const az = pinAzimuth(cyl, theta);
  const d = polarDir(az);
  const x = SPEC.block.stations[cyl.station];
  return { x, y: CRANK.radius * d[1], z: CRANK.radius * d[2], az };
}

export function pistonPinPoint(cyl, theta) {
  const x = SPEC.block.stations[cyl.station];
  const p = bankPoint(cyl.bank, pistonAlong(cyl, theta), 0, x);
  return { x: p.x, y: p.y, z: p.z, along: p.along };
}

/** Counter-throw direction (counterweights sit opposite their throw). */
export function counterAzimuth(cyl, theta) {
  return wrap360(pinAzimuth(cyl, theta) + 180);
}

// ---- four-stroke cycle ---------------------------------------------------

/** Cycle position of a cylinder at crank angle theta: 0 at power TDC. */
export function cycleAngle(cyl, theta) {
  return wrap720(theta - cyl.powerTDC);
}

export function strokeOf(cyl, theta) {
  const c = cycleAngle(cyl, theta);
  if (c < 180) return 'POWER';
  if (c < 360) return 'EXHAUST';
  if (c < 540) return 'INTAKE';
  return 'COMPRESSION';
}

/** True when the cylinder fires at the finest resolution step around its spark. */
export function firingProgress(cyl, theta) {
  const c = cycleAngle(cyl, theta);
  if (c < SPEC.ignitionAdvance || c > 700) return -1;
  return c;
}

/** Crank angle (0..720) at which a cylinder reaches a given cycle position. */
export const crankEvent = (cyl, cycle) => wrap720(cyl.powerTDC + cycle);

export const eventMid = (valve) => (valve === 'intake' ? (V.intakeOpen + V.intakeClose) / 2 : (V.exhaustOpen + V.exhaustClose) / 2);
export const eventDuration = (valve) => (valve === 'intake' ? V.intakeClose - V.intakeOpen : V.exhaustClose - V.exhaustOpen);

// ---- camshaft / lobes ----------------------------------------------------

/** Cam rotation azimuth at crank angle theta: half speed, same sense as the crank. */
export function camAzimuth(bank, theta) {
  return CRANK.sense * (theta / SPEC.cam.halfSpeedRatio);
}

/** Half width of a lobe nose, in CAM degrees. 1 cam deg = 2 crank deg. */
export const lobeHalfCamDeg = (valve) => eventDuration(valve) / 4;

/** Radius of the machined lobe at local angle alpha (deg, 0 = nose). */
export function lobeProfileRadius(valve, alpha) {
  const hw = lobeHalfCamDeg(valve);
  const a = signedAngle(alpha);
  if (Math.abs(a) > hw) return H.camBaseRadius;
  return H.camBaseRadius + (V.maxLift * (1 + Math.cos((Math.PI * a) / hw))) / 2;
}

/** Fixed angular position of a lobe on its camshaft. */
export function lobeIndexAngle(cyl, valve) {
  return wrap360(followerAzimuth(cyl, valve) - camAzimuth(cyl.bank, crankEvent(cyl, eventMid(valve))));
}

/** Absolute azimuth of the lobe nose at crank angle theta. */
export function lobeAzimuth(cyl, valve, theta) {
  return wrap360(camAzimuth(cyl.bank, theta) + lobeIndexAngle(cyl, valve));
}

/** Direction from the cam axis down to the bucket follower (global polar). */
export function followerAzimuth(cyl, valve) {
  return wrap360(valveAxisAz(cyl.bank, valve) + 180);
}

/** Lift the follower rides on = lobe radius facing it minus the base circle. */
export function valveLift(cyl, valve, theta) {
  const alpha = signedAngle(lobeAzimuth(cyl, valve, theta) - followerAzimuth(cyl, valve));
  return Math.max(0, lobeProfileRadius(valve, alpha) - H.camBaseRadius);
}

// ---- fixed points --------------------------------------------------------

export const valveSeatPoint = (cyl, valve) =>
  bankPoint(cyl.bank, H.seatA, valveSide(valve) * H.seatOffset, SPEC.block.stations[cyl.station]);

export const camAxisPoint = (cyl, valve) => {
  const [along, out] = camAxisBank(cyl.bank, valve);
  return bankPoint(cyl.bank, along, out, SPEC.block.stations[cyl.station]);
};

export const valveAxisDir = (cyl, valve) => polarDir(valveAxisAz(cyl.bank, valve));

/**
 * Point on a valve, `s` cm from the seat along the axis at zero lift,
 * translated down the axis by the live lift.
 */
export function valveAxisPoint(cyl, valve, s, theta) {
  const seat = valveSeatPoint(cyl, valve);
  const d = valveAxisDir(cyl, valve);
  const off = s - valveLift(cyl, valve, theta);
  return {
    x: seat.x + off * d[0],
    y: seat.y + off * d[1],
    z: seat.z + off * d[2],
    along: seat.along + off * Math.cos(H.valveAngle * DEG) * 1,
    out:
      seat.out +
      off * Math.sin(H.valveAngle * DEG) * valveSide(valve),
  };
}

export const springSeatAlong = H.seatA + H.guideLength;

// ---- derived schedules ---------------------------------------------------

/**
 * The two crank angles (0..720) at which this cylinder is physically at TDC,
 * derived from its crank throw and bank axis.
 */
export function geometricTDCs(cyl) {
  const a = wrap360((BANKS[cyl.bank].az - CRANK.pinAz[cyl.station]) / CRANK.sense);
  return [wrap720(a), wrap720(a + 360)];
}

/** Firing order derived from the crank throws, sorted by crank angle. */
export function firingOrder() {
  const list = SPEC.cylinders.map((c) => {
    const tdc = geometricTDCs(c);
    if (!tdc.some((t) => Math.abs(wrap720(t - c.powerTDC)) < 1e-9)) {
      throw new Error(
        `cyl ${c.num}: power TDC ${c.powerTDC} is not a TDC of its crank throw (${tdc.join(' / ')})`
      );
    }
    return { cyl: c.num, angle: c.powerTDC };
  });
  list.sort((a, b) => a.angle - b.angle);
  return { cyls: list.map((e) => e.cyl), angles: list.map((e) => e.angle) };
}

/**
 * Lobe separation angle in CAM degrees, timing component only:
 * the geometric spread between the two follower directions (intake row vs exhaust
 * row sit 2*valveAngle apart around the bore) is removed, so this is the number
 * a cam grinder quotes.
 */
export function lobeSeparation(cyl) {
  const lobeSpread = signedAngle(
    lobeIndexAngle(cyl, 'intake') - lobeIndexAngle(cyl, 'exhaust')
  );
  const followerSpread = signedAngle(
    followerAzimuth(cyl, 'intake') - followerAzimuth(cyl, 'exhaust')
  );
  return Math.abs(signedAngle(lobeSpread - followerSpread));
}

/** Angular spread of the two follower directions around the bore axis (cam deg). */
export const followerSpread = (bank) =>
  Math.abs(signedAngle(followerAzimuth({ bank }, 'intake') - followerAzimuth({ bank }, 'exhaust')));

/** Cam-to-cam spacing for a bank (world yz distance). */
export function camSpacing(bank) {
  const [ai, ao] = camAxisBank(bank, 'intake');
  const [ae, eo] = camAxisBank(bank, 'exhaust');
  const up = bankUp(bank);
  void up;
  const i = bankPoint(bank, ai, ao, 0);
  const e = bankPoint(bank, ae, eo, 0);
  return Math.hypot(i.y - e.y, i.z - e.z);
}

export { SPEC, BANKS, camAxisStation };
