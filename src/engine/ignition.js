// Ignition advance model: base + centrifugal + vacuum, and the manifold load
// model the vacuum term is derived from. Pure math, no Three.js; every
// breakpoint is SPEC.ignition in src/engine/spec.js, so the curves are read
// from the same authority the renderer and the HUD read. Pinned by
// test/timing.test.mjs (#8 P1-G3, P1-G4).
//
// advance(rpm, throttle) = baseDeg
//                        + centrifugal(rpm)          clamped ramp startRpm..fullRpm
//                        + vacuum(vacuum(rpm,throttle)) clamped ramp startKpa..fullKpa
// clamped at ignition.maxTotalDeg.
import { SPEC, wrap720 } from './spec.js';

const IG = SPEC.ignition;

const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, num(v, lo)));

/** Linear ramp with hard clamps at both ends: 0 at x0, `max` at and past x1. */
const ramp = (x, x0, x1, max) => {
  if (x <= x0) return 0;
  if (x >= x1) return max;
  return (max * (x - x0)) / (x1 - x0);
};

/** Centrifugal (mechanical) advance in crank degrees: a distributor weight. */
export function centrifugalAdvance(rpm) {
  const C = IG.centri;
  return clamp(ramp(clamp(rpm, 0, Number.MAX_SAFE_INTEGER), C.startRpm, C.fullRpm, C.maxDeg), 0, C.maxDeg);
}

/**
 * Manifold vacuum in kPa below atmosphere, from throttle (%) and rpm.
 * Two corners, documented in SPEC.ignition.vacuumModel, blended linearly by the
 * throttle: closed throttle is the deep-vacuum corner (and it relaxes as rpm
 * climbs), wide-open throttle is the atmospheric corner plus its pumping loss.
 */
export function manifoldVacuum(rpm, throttlePct) {
  const M = IG.vacuumModel;
  const r = clamp(rpm, 0, Number.MAX_SAFE_INTEGER);
  const t = clamp(throttlePct, 0, 100) / 100;
  const closed = M.closedKpa * (1 - M.closedFall * (r / 4000));
  const wot = M.wotLossKpa * (r / 4000);
  return clamp(wot + (closed - wot) * (1 - t), 0, M.atmKpa);
}

/** Vacuum advance in crank degrees: high vacuum at part throttle, nothing at WOT. */
export function vacuumAdvance(vacuumKpa) {
  const VC = IG.vacuum;
  return clamp(ramp(clamp(vacuumKpa, 0, Number.MAX_SAFE_INTEGER), VC.startKpa, VC.fullKpa, VC.maxDeg), 0, VC.maxDeg);
}

/** The live total advance the distributor actually delivers at this operating point. */
export function totalAdvance(rpm, throttlePct) {
  const sum = IG.baseDeg + centrifugalAdvance(rpm) + vacuumAdvance(manifoldVacuum(rpm, throttlePct));
  return Math.min(sum, IG.maxTotalDeg);
}

/** Cycle position (0..720, 0 at power TDC) of this cylinder's spark. */
export const sparkCycle = (cyl, rpm, throttlePct) => wrap720(720 - totalAdvance(rpm, throttlePct));

/** Crank angle (0..720) at which this cylinder's spark fires. */
export const sparkAngle = (cyl, rpm, throttlePct) => wrap720(cyl.powerTDC - totalAdvance(rpm, throttlePct));
