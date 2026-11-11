// Engine running state - pure math, no Three.js. The crank angle theta (deg,
// wrapped to the 720 degree four-stroke cycle) is the ONLY animation clock;
// src/engine/timing.js converts it to every part pose, and src/render/*
// places meshes from it. RPM limits are the product surface: 0..4000.
import { SPEC, wrap720 } from './spec.js';

export const RPM_MIN = 0;
export const RPM_MAX = 4000;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

/**
 * @param {object} opts  rpm (0..4000), slowmo (0.02..1), running (bool)
 */
export function createEngineState(opts = {}) {
  const state = {
    theta: 0, // crank degrees on the 720 cycle
    rpm: clamp(opts.rpm ?? 1600, RPM_MIN, RPM_MAX),
    slowmo: clamp(opts.slowmo ?? 1, 0.02, 1),
    running: opts.running ?? false,
  };

  const fireListeners = [];
  // monotone total angle -> firing targets stay exact multiples, immune to
  // wrap720 float drift; frame-dt clamping is the render loop's job.
  let total = 0;
  const nextFire = new Map(SPEC.cylinders.map((c) => [c.num, c.powerTDC]));

  state.start = () => {
    state.running = true;
  };
  state.stop = () => {
    state.running = false;
  };
  state.setRpm = (v) => {
    state.rpm = clamp(v, RPM_MIN, RPM_MAX);
  };
  state.setSlowmo = (f) => {
    state.slowmo = clamp(f, 0.02, 1);
  };
  /** fn(cyl, atCrankDeg) on every power-stroke TDC crossing. */
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
      for (const cyl of SPEC.cylinders) {
        let nf = nextFire.get(cyl.num);
        while (nf < before - 1e-9) nf += 720; // fast-forward huge frames
        while (nf < total - 1e-9 && nf >= before - 1e-9) {
          for (const fn of fireListeners) fn(cyl, cyl.powerTDC);
          nf += 720;
        }
        nextFire.set(cyl.num, nf);
      }
    }
    return dTheta;
  };

  return state;
}
