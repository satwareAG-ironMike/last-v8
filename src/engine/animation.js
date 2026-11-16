// Engine running state - pure math, no Three.js. The crank angle theta (deg,
// wrapped to the 720 degree four-stroke cycle) is the ONLY animation clock;
// src/engine/timing.js converts it to every part pose, and src/render/*
// places meshes from it. The product surface is rpm 0..4000 and throttle
// 0..100 %; the live ignition advance comes from src/engine/ignition.js, so a
// spark target is always powerTDC - totalAdvance and never powerTDC itself.
import { SPEC, wrap720 } from './spec.js';
import { centrifugalAdvance, manifoldVacuum, vacuumAdvance, totalAdvance } from './ignition.js';

export const RPM_MIN = 0;
export const RPM_MAX = 4000;
export const THROTTLE_MIN = 0; // 0 % = closed throttle, the deep-vacuum corner
export const THROTTLE_MAX = 100; // 100 % = wide-open throttle, the load the model zeroes vacuum at
export const THROTTLE_DEFAULT = 50;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

/**
 * @param {object} opts  rpm (0..4000), slowmo (0.02..1), running (bool)
 */
export function createEngineState(opts = {}) {
  const state = {
    theta: 0, // crank degrees on the 720 cycle
    rpm: clamp(opts.rpm ?? 1600, RPM_MIN, RPM_MAX),
    throttle: clamp(opts.throttle ?? THROTTLE_DEFAULT, THROTTLE_MIN, THROTTLE_MAX),
    slowmo: clamp(opts.slowmo ?? 1, 0.02, 1),
    running: opts.running ?? false,
  };

  const fireListeners = [];
  // Monotone total angle plus a cycle INDEX per cylinder: cycle n of a cylinder
  // sparks exactly once at `powerTDC - advance_n`, so a throttle or rpm change
  // re-anchors the next target without ever doubling or skipping a spark, and
  // the index is immune to wrap720 float drift. Frame-dt clamping is the render
  // loop's job.
  let total = 0;
  const lastCycle = new Map(); // cylinder -> index of the last spark already emitted

  state.start = () => {
    state.running = true;
  };
  state.stop = () => {
    state.running = false;
  };
  state.setRpm = (v) => {
    state.rpm = clamp(v, RPM_MIN, RPM_MAX);
    return state.rpm;
  };
  /** Load: 0 % closed throttle .. 100 % wide open. Returns the clamped value. */
  state.setThrottle = (v) => {
    state.throttle = clamp(v, THROTTLE_MIN, THROTTLE_MAX);
    return state.throttle;
  };
  state.setSlowmo = (f) => {
    state.slowmo = clamp(f, 0.02, 1);
  };
  /** The live advance breakdown the HUD shows: every term named, in crank degrees. */
  state.advance = () => {
    const base = SPEC.ignition.baseDeg;
    const centrifugal = centrifugalAdvance(state.rpm);
    const vacuumKpa = manifoldVacuum(state.rpm, state.throttle);
    const vacuum = vacuumAdvance(vacuumKpa);
    return {
      rpm: state.rpm,
      throttle: state.throttle,
      vacuumKpa,
      base,
      centrifugal,
      vacuum,
      total: totalAdvance(state.rpm, state.throttle),
    };
  };
  /** fn(cyl, atCrankDeg) once per 720 per cylinder, at powerTDC - totalAdvance. */
  state.onFire = (fn) => {
    fireListeners.push(fn);
  };

  /** Advance one frame; returns degrees travelled. */
  state.step = (dt) => {
    if (!state.running || !(dt > 0)) return 0;
    const dTheta = state.rpm * 6 * state.slowmo * dt; // rpm*6 = deg/s
    if (dTheta <= 0) return 0;
    const before = total;
    total += dTheta;
    state.theta = wrap720(total);
    if (fireListeners.length) {
      const adv = totalAdvance(state.rpm, state.throttle);
      for (const cyl of SPEC.cylinders) {
        // Cycle n of this cylinder sparks at this absolute angle; n counts up
        // from the cycle that contains the start of the run.
        const phase = cyl.powerTDC - adv;
        let n = Math.ceil((before - 1e-9 - phase) / 720); // first target at or after `before`
        const last = lastCycle.get(cyl.num);
        if (last !== undefined && n <= last) n = last + 1; // an advance never walks a spark backwards
        for (let at = phase + 720 * n; at < total - 1e-9; at += 720, n++) {
          for (const fn of fireListeners) fn(cyl, wrap720(at));
          lastCycle.set(cyl.num, n);
        }
      }
    }
    return dTheta;
  };

  return state;
}
