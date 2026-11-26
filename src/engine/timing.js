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

const finite = (v, fallback) => (Number.isFinite(v) ? v : fallback);

/**
 * Position inside this cylinder's burn window: 0 at the instant the spark fires,
 * 1 at the end of the visible burn window, -1 outside it. The window opens at
 * `powerTDC - advance` (cycle position 720 - advance), runs through power TDC
 * (the 720 wrap) and closes `SPEC.ignition.burnDeg` crank degrees after TDC, so
 * it is a burn window and not 686 degrees of the cycle. `advance` is the live
 * total advance from src/engine/ignition.js; its caller is the spark flash.
 */
export function firingProgress(cyl, theta, advance = SPEC.ignition.baseDeg) {
  const adv = Math.max(0, finite(advance, SPEC.ignition.baseDeg));
  const burn = SPEC.ignition.burnDeg;
  const c = cycleAngle(cyl, theta);
  let since = null;
  if (c >= 720 - adv) since = c - (720 - adv);
  else if (c <= burn) since = c + adv;
  return since === null ? -1 : since / (adv + burn);
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

/**
 * The lift the grinder machines onto this variant's cam, at the follower.
 *
 * valves.maxLift is the lift at the VALVE, which is what the head's
 * crown-clearance law is measured at and what row A1-G3 closed. A DOHC bucket
 * sits between the lobe and the valve, so its cam is ground to that lift
 * directly. The OHV variant puts a rocker lever in that place (issue #45,
 * slice 8I): the lever multiplies the follower's travel by SPEC.variants.ohv
 * .rockerRatio, so its cam is ground to maxLift / ratio and no more. Every
 * lobe function below takes the grind as a parameter and defaults to the
 * committed one, so a variant's grind cannot leak into the other variant's
 * geometry by accident.
 */
export function camLiftCm(id = SPEC.build.variant) {
  const ratio = SPEC.variants[id]?.rockerRatio ?? 1;
  if (!(ratio >= 1)) throw new Error(`camLiftCm('${id}'): rockerRatio ${ratio} is not a lever ratio of at least 1`);
  return V.maxLift / ratio;
}

/**
 * Grinder exponent of this lobe's lift law, derived from the machined nose arc.
 * The law is lift(psi) = maxLift * (1 - x^2)^p with x = |psi| / lobeHalfCamDeg
 * (psi in CAM degrees, 0 = the nose). It opens and closes with zero slope onto
 * the base circle - a real closing ramp - and its support function is convex
 * (h + h'' > 0) exactly while the nose arc radius stays positive:
 * h(0) + h''(0) = camBaseRadius + maxLift - 2 p maxLift / halfCamRad^2 IS the
 * ground nose radius, so p follows from the one machined value named in SPEC.
 */
export function lobeNoseExponent(valve, liftCm = V.maxLift) {
  const halfRad = (lobeHalfCamDeg(valve) * Math.PI) / 180;
  return ((H.camBaseRadius + liftCm - V.lobeNoseRadius) * halfRad * halfRad) / (2 * liftCm);
}

/** p that would shrink the nose arc to zero: above this a flat face undercuts. */
export function lobeUndercutExponent(valve, liftCm = V.maxLift) {
  const halfRad = (lobeHalfCamDeg(valve) * Math.PI) / 180;
  return ((H.camBaseRadius + liftCm) * halfRad * halfRad) / (2 * liftCm);
}

const lawTerms = (valve, psiDeg, liftCm = V.maxLift) => {
  const hw = lobeHalfCamDeg(valve);
  const halfRad = (hw * Math.PI) / 180;
  const p = lobeNoseExponent(valve, liftCm);
  const a = Math.abs(signedAngle(psiDeg));
  if (a >= hw) return { lift: 0, dLift: 0, d2Lift: 0, x: 1 };
  const x = a / hw;
  const u = 1 - x * x;
  const lift = liftCm * u ** p;
  const dLift = -(liftCm / halfRad) * 2 * p * x * u ** (p - 1); // cm per cam radian
  const d2Lift = (liftCm / (halfRad * halfRad)) * 2 * p * u ** (p - 2) * ((2 * p - 1) * x * x - 1);
  return { lift, dLift, d2Lift, x };
};

/**
 * Distance from the cam axis to the lobe tangent plane whose normal sits psi
 * cam degrees from the nose: the plane a FLAT follower rides on (#8 item 3).
 * The old law used the radius along the follower ray - a knife-edge follower -
 * and that plane cut 0.5005 cm into every bucket it drove.
 */
export function lobeFaceDistance(valve, psiDeg, liftCm = V.maxLift) {
  return H.camBaseRadius + lawTerms(valve, psiDeg, liftCm).lift;
}

/** Contact law: the lift the follower actually rides on. */
export const lobeContactLift = (valve, psiDeg, liftCm = V.maxLift) => lobeFaceDistance(valve, psiDeg, liftCm) - H.camBaseRadius;

/** dh/dpsi in cm per cam radian = how far the contact point walks off the
 *  follower ray, measured across the flat face. */
export function lobeContactWalk(valve, psiDeg, liftCm = V.maxLift) {
  const t = lawTerms(valve, psiDeg, liftCm);
  return psiDeg < 0 ? -t.dLift : t.dLift;
}

/**
 * h + h'' in cm: radius of curvature of the machined outline at that contact
 * point. Zero or negative is an undercut - a flat face would intersect the
 * lobe instead of riding it. Equals the ground nose radius at psi = 0.
 */
export function lobeContactCurvature(valve, psiDeg, liftCm = V.maxLift) {
  const t = lawTerms(valve, psiDeg, liftCm);
  return H.camBaseRadius + t.lift + t.d2Lift;
}

const scanLobe = (valve, fn, pick, samples = 6000, liftCm = V.maxLift) => {
  const hw = lobeHalfCamDeg(valve);
  let out = null;
  for (let i = 0; i <= samples; i++) {
    const psi = (i / samples) * hw;
    const v = fn(valve, psi, liftCm);
    if (out === null || pick(v, out.v)) out = { v, psi };
  }
  return out;
};

const widest = (v, best) => Math.abs(v) > Math.abs(best);
const tightest = (v, best) => v < best;

/** Largest contact walk over the event, cm: must stay inside the tappet face. */
export const lobeMaxWalk = (valve, liftCm = V.maxLift) => Math.abs(scanLobe(valve, lobeContactWalk, widest, 6000, liftCm).v);

/** Tightest outline curvature over the event, cm: > 0 means no undercut. */
export const lobeMinCurvature = (valve, liftCm = V.maxLift) => scanLobe(valve, lobeContactCurvature, tightest, 6000, liftCm).v;

/** Polar angle (cam deg from the nose) of the outline point whose tangent plane
 *  has its normal at psi: beta = psi + atan2(h', h). Monotone while the law is
 *  convex, which is what makes the outline a single closed curve. */
function lobeContactAzimuth(valve, psiRad, liftCm = V.maxLift) {
  const h = lobeFaceDistance(valve, (psiRad * 180) / Math.PI, liftCm);
  const dh = lobeContactWalk(valve, (psiRad * 180) / Math.PI, liftCm);
  return psiRad + Math.atan2(dh, h);
}

/**
 * Radius of the machined lobe outline at polar angle alpha (cam deg from the
 * nose): the envelope of the flat-follower tangent planes, hypot(h, h'). This
 * is what the cam was cut to, and what the render extrudes.
 */
export function lobeProfileRadius(valve, alpha, liftCm = V.maxLift) {
  const hw = lobeHalfCamDeg(valve);
  const a = Math.abs(signedAngle(alpha));
  if (a >= hw) return H.camBaseRadius;
  const target = (a * Math.PI) / 180;
  let lo = 0, hi = (hw * Math.PI) / 180;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (lobeContactAzimuth(valve, mid, liftCm) < target) lo = mid; else hi = mid;
  }
  const psi = (lo + hi) / 2;
  const h = lobeFaceDistance(valve, (psi * 180) / Math.PI, liftCm);
  const dh = lobeContactWalk(valve, (psi * 180) / Math.PI, liftCm);
  return Math.hypot(h, dh);
}

/** Largest outline radius: the machined nose sits on the index azimuth. */
export const lobeMaxRadius = (valve, liftCm = V.maxLift) => lobeFaceDistance(valve, 0, liftCm);

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

/**
 * Lift the follower rides on = the lobe's tangent-plane distance along the
 * follower axis minus the base circle. The lobe outline is the envelope of
 * those planes, so the bucket face and the machined surface agree exactly and
 * nothing intersects anything (lobeProfileRadius is that envelope radius).
 */
export function valveLift(cyl, valve, theta) {
  const alpha = signedAngle(lobeAzimuth(cyl, valve, theta) - followerAzimuth(cyl, valve));
  return Math.max(0, lobeFaceDistance(valve, alpha) - H.camBaseRadius);
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
