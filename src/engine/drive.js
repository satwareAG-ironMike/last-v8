// Cam drive: the chain path from the crank nose sprocket to each DOHC cam
// sprocket, computed from the published sprocket data and the measured axis
// distance - nothing here is typed in twice. (issue #4, GATES row A1-G2.)
//
// What the review rejected was a flat band riding at the sprocket tip circles:
// it never drives anything and it swallows the teeth. This module models a
// roller chain instead:
//
//   * One chain per DOHC camshaft, each in its own published 0.3 cm band, all
//     four wrapped from the crank nose.
//   * Every link is exactly the pitch derived from the published pitch circles
//     and tooth counts (2 pi * 3.45 / 18 = 2 pi * 6.9 / 36 = 1.20428 cm). A
//     chain is a whole number of links, so the wrap takes a whole number of
//     teeth and the leftover of each straight span is that span's closure -
//     measured, named, and bounded by the published tensioner travel.
//   * A sprocket's tooth spaces are machined as cutter arcs of radius
//     rollerR + gapClr centred ON the published pitch circle at the tooth
//     valleys - the way a chain sprocket gap is generated from the roller
//     profile. The chain's rollers therefore sit in the gaps with published air
//     around them, and no tooth vertex ever crosses a roller.
//   * A rigid-link chain does not seat on the arc-pitch circle: the roller
//     centres lie on the polygon through the gaps, radius p / (2 sin(180/teeth))
//     = 3.4676 / 6.9088 cm, which stands 0.0176 / 0.0088 cm outside the
//     published 3.45 / 6.9. That is the polygon action, and it is well inside
//     the 0.10 cm running clearance the gaps are cut with.
//   * The engagement walks: a chain drive has no slip, so the crank feeds one
//     link per tooth it turns and the cam - half the speed on double the pitch
//     circle - takes the same link rate. Each wrap therefore advances one whole
//     tooth per 20 degrees of crank, which keeps the wraps on the tangent side
//     of the two circles instead of sliding off them. That stepping is the same
//     polygon action that makes a real chain drive hum.
//   * The spans bow, because a whole-link chain is a hair longer than the
//     straight distance between the two valleys it joins. The bow is where the
//     fixed guide pad and the tensioner shoe ride.
//
// Pure math on the (y, z) plane: the crank axis is the origin, the cam axis is
// where src/engine/timing.js puts it. Units cm, angles degrees.
import { SPEC } from './spec.js';
import { camAxisPoint } from './timing.js';

const DEG = Math.PI / 180;
const C = SPEC.chain;
const CRANK_SP = SPEC.crank.sprocket;
const CAM_SP = SPEC.cam.sprocket;

/** The one chain pitch both sprockets share: the published pitch circle and tooth count. */
export const chainPitch = (sprocket = CAM_SP) => (2 * Math.PI * sprocket.pitchR) / sprocket.teeth;

/**
 * Radius of the circle the roller centres of a wrapped chain lie on: the
 * polygon's circumradius, derived from the pitch. This is where the chain seats.
 */
export const wrapRadius = (teeth, pitch = chainPitch()) => pitch / (2 * Math.sin(Math.PI / teeth));

/** Radius of the machined tooth-space cutter arc: it runs the roller with air. */
export const gapCutR = () => C.rollerR + C.gapClr;

/** Machined rim (tip) circle: half a pitch above the pitch circle, less the roller it carries. */
export const tipRadius = (pitchR) => pitchR + chainPitch() / 2 - C.rollerR;

/** Machined tooth-space floor: one cutter radius below the pitch circle. */
export const rootRadius = (pitchR) => pitchR - gapCutR();

/** The hub the teeth hang on, kept clear of every machined gap floor by hubClr. */
export const hubRadius = (pitchR) => rootRadius(pitchR) - C.hubClr;

/** Chain width across both side-plate layers, derived from the published profile. */
export const chainWidth = () => 2 * C.plate + C.channel;

/** x of the middle of band i. */
export const bandCentreX = (i) => CAM_SP.bands[i] + CAM_SP.width / 2;

/** The chain axis of a cam, in the (y, z) plane the chain runs in. */
export function camPlane(bank, valve) {
  const ref = SPEC.cylinders.find((c) => c.bank === bank);
  const p = camAxisPoint(ref, valve);
  return { y: p.y, z: p.z, d: Math.hypot(p.y, p.z) };
}

/** Band index a cam's chain rides, in the published band order. */
export const bandIndexOf = (bank, valve) => ['L', 'R'].indexOf(bank) * 2 + (valve === 'intake' ? 0 : 1);

const add = (a, b) => ({ y: a.y + b.y, z: a.z + b.z });
const sub = (a, b) => ({ y: a.y - b.y, z: a.z - b.z });
const scale = (a, s) => ({ y: a.y * s, z: a.z * s });
const len = (a) => Math.sqrt(a.y * a.y + a.z * a.z);
const dir = (deg) => ({ y: Math.sin(deg * DEG), z: Math.cos(deg * DEG) });
export const azimuth = (a) => Math.atan2(a.y, a.z) / DEG;
const wrapDeg = (a) => ((a % 360) + 360) % 360;
const shortestDeg = (a) => wrapDeg(a + 180) - 180;

/**
 * Whole teeth the chain wraps on each sprocket. The smooth (friction belt)
 * solution is 180 -+ 2 asin((R2-R1)/D); the chain must take whole teeth, and the
 * two spans must leave the two wraps turning a total of exactly 360 degrees, so
 * z1*step1 + z2*step2 = 360 is the candidate set and the nearest pair wins.
 */
export function wrapTeeth(D) {
  const t1 = CRANK_SP.teeth, t2 = CAM_SP.teeth;
  const R1 = wrapRadius(t1), R2 = wrapRadius(t2);
  const step1 = 360 / t1, step2 = 360 / t2;
  const alpha = Math.asin((R2 - R1) / D) / DEG;
  const smooth1 = (180 - 2 * alpha) / step1;
  const smooth2 = (180 + 2 * alpha) / step2;
  let best = null;
  for (let z1 = 1; z1 < t1; z1++) {
    const rest = (360 - z1 * step1) / step2;
    if (!Number.isInteger(rest) || rest < 1 || rest > t2) continue;
    const score = Math.abs(z1 - smooth1) + Math.abs(rest - smooth2);
    if (!best || score < best.score) best = { z1, z2: rest, score };
  }
  return { crank: best.z1, cam: best.z2, smoothCrank: smooth1, smoothCam: smooth2, alpha };
}

/**
 * A run of `links` rigid links of exactly `pitch` between two fixed points `d`
 * apart: the classic circular-arc solution. The arc radius solves
 * d = 2 R sin(links * asin(pitch / 2R) / 2), so every link stays at the pitch
 * and the surplus links show up as the bow.
 */
export function bowedRun(d, pitch, links) {
  let lo = pitch / 2, hi = 1e7, r = hi;
  for (let i = 0; i < 200; i++) {
    r = (lo + hi) / 2;
    const half = Math.asin(Math.min(1, pitch / (2 * r)));
    const chord = 2 * r * Math.sin(links * half);
    if (chord < d) lo = r; else hi = r;
  }
  const half = Math.asin(Math.min(1, pitch / (2 * r)));
  const totalTurn = 2 * links * half; // the arc's own turn
  const rise = r * (1 - Math.cos(totalTurn / 2));
  return { R: r, rise, halfTurn: half * 2, totalTurn, arc: links * pitch, span: d };
}

const rot = (v, deg) => {
  const a = azimuth(v) + deg, r = len(v);
  return scale(dir(a), r);
};

/**
 * A bowed span from a to b: `links` rigid links, each exactly the pitch. The
 * slack bows away from the loop interior (the reference is the midpoint between
 * the two sprocket axes), so the guide pad and the tensioner shoe ride the bow.
 */
function spanRun(a, b, links, pitch, interior) {
  const d = len(sub(b, a));
  const geo = bowedRun(d, pitch, links);
  const mid = scale(add(a, b), 0.5);
  const u = scale(sub(b, a), 1 / d);
  const n = { y: -u.z, z: u.y };
  const inward = sub(interior, mid);
  const side = n.y * inward.y + n.z * inward.z > 0 ? 1 : -1;
  const centre = add(mid, scale(n, side * geo.R * Math.cos(geo.totalTurn / 2)));
  const toA = sub(a, centre);
  const sign = [1, -1]
    .map((s) => ({ s, err: len(sub(add(centre, rot(toA, (s * geo.totalTurn) / DEG)), b)) }))
    .sort((x, y) => x.err - y.err)[0].s;
  const pts = [a];
  for (let i = 1; i < links; i++) {
    const f = sign * (i / links) * geo.totalTurn / DEG;
    pts.push(add(centre, rot(toA, f)));
  }
  pts.push(b);
  const apex = links % 2 === 0 ? pts[links / 2] : mid;
  return { pts, geo, centre, sign, d, apex };
}

/** Azimuth of seat `i` of wrap `which` at crank angle theta, in the sprocket's own lattice. */
const seatAz = (frame, which, i, theta, h) =>
  which === 'crank'
    ? frame.phase.crank + (h + i) * frame.step.crank - theta
    : frame.phase.cam + (h + i) * frame.step.cam - theta / 2;

/** Plane position of seat `i` of wrap `which`: y/z world, rel from its own axis. */
function seatAt(frame, which, i, theta, h) {
  const rel = scale(dir(seatAz(frame, which, i, theta, h)), frame.wrapR[which]);
  return which === 'crank' ? { ...rel, rel } : { ...add(frame.cam, rel), rel };
}

/**
 * Which machined gap each end of each wrap sits in at this crank angle. A chain
 * drive has no slip: the crank feeds one link per tooth it turns, and the cam -
 * half the speed on double the pitch circle - takes the same link rate, so both
 * wraps advance one tooth per 20 degrees of crank. The candidate that keeps both
 * wraps nearest their tangent-side centre and both spans inside the published
 * tensioner travel wins.
 *
 * Measured, and it decided the design (tmp/drive-probe6.mjs): clocking the crank
 * nose as ONE common 18-gap tooth set for all four chains - the least-squares
 * clock leaves each chain 4.5-5.5 deg off its own tangent line - makes 72 of 360
 * sampled crank positions (L-intake) and 108 (R-intake) impossible for a rigid
 * 88-link chain inside the published tensioner travel. So the nose carries four
 * bored 18-tooth lanes on the turned-down spigot, each keyed to its own chain,
 * which is what a machinist does with four chains on one blank anyway.
 */
function engagement(frame, theta) {
  const { step, wrap, pitch, spansFixed } = frame;
  const base = Math.round(theta / step.crank);
  let best = null;
  for (let d1 = -1; d1 <= 1; d1++) {
    for (let d2 = -1; d2 <= 1; d2++) {
      const h1 = base + d1, h2 = base + d2;
      const drift = Math.max(
        Math.abs(shortestDeg(
          frame.phase.crank + (h1 + wrap.crank / 2) * step.crank - theta - frame.wrapCentre.crank)),
        Math.abs(shortestDeg(
          frame.phase.cam + (h2 + wrap.cam / 2) * step.cam - theta / 2 - frame.wrapCentre.cam)),
      );
      const A0 = seatAt(frame, 'crank', wrap.crank, theta, h1);
      const A1 = seatAt(frame, 'cam', 0, theta, h2);
      const B0 = seatAt(frame, 'cam', wrap.cam, theta, h2);
      const B1 = seatAt(frame, 'crank', 0, theta, h1);
      const tA = spansFixed.A * pitch - len(sub(A1, A0));
      const tB = spansFixed.B * pitch - len(sub(B1, B0));
      const ok = tA > 1e-9 && tB > 1e-9 && tA <= C.tensionerTravel && tB <= C.tensionerTravel;
      const score = ok ? drift + Math.max(tA, tB) * 10 : 1e6 + drift;
      if (!best || score < best.score) best = { h1, h2, drift, takeUp: Math.max(tA, tB), ok, score };
    }
  }
  return best;
}

const layouts = new Map();

/**
 * Fixed frame of one chain: the axes, the wrap tooth counts, the machined gap
 * phases the renderer machines its sprockets from, and the whole-link counts of
 * the two straight spans. Pose-independent; memoized because the 720 deg laws
 * re-solve every frame.
 */
function frameOf(bank, valve) {
  const key = `${bank}-${valve}`;
  if (layouts.has(key)) return layouts.get(key);
  const cam = camPlane(bank, valve);
  const pitch = chainPitch();
  const t1 = CRANK_SP.teeth, t2 = CAM_SP.teeth;
  const step1 = 360 / t1, step2 = 360 / t2;
  const wrap = wrapTeeth(cam.d);
  const phi = azimuth(cam); // crank -> cam direction
  // Open-belt arrangement: the crank wrap is centred on the direction away from
  // the cam, the cam wrap on the direction away from the crank.
  const wrapCentre = { crank: phi + 180, cam: phi };
  const idx = bandIndexOf(bank, valve);
  // Gap 0 of each lane / sprocket is its chain's wrap entry seat: the crank nose
  // carries four bored 18-tooth lanes, each keyed to its own chain (see the
  // measurement in engagement() above), and each cam carries its own 36-tooth
  // sprocket clocked to its own chain.
  const phase = {
    crank: wrapCentre.crank - (wrap.crank * step1) / 2,
    cam: wrapCentre.cam - (wrap.cam * step2) / 2,
  };
  const frame = {
    bank, valve, pitch, D: cam.d, cam, phi, wrapCentre,
    teeth: { crank: t1, cam: t2 },
    wrapR: { crank: wrapRadius(t1), cam: wrapRadius(t2) },
    pitchR: { crank: CRANK_SP.pitchR, cam: CAM_SP.pitchR },
    bore: { crank: CRANK_SP.bore, cam: CAM_SP.bore },
    wrap, phase, step: { crank: step1, cam: step2 },
    bandIndex: idx,
  };
  // The design (crank 0) straight runs decide how many whole links each span
  // carries; every later frame re-bows those same counts.
  const dA = len(sub(seatAt(frame, 'cam', 0, 0, 0), seatAt(frame, 'crank', wrap.crank, 0, 0)));
  const dB = len(sub(seatAt(frame, 'crank', 0, 0, 0), seatAt(frame, 'cam', wrap.cam, 0, 0)));
  frame.spansFixed = {
    A: Math.ceil(dA / pitch - 1e-9),
    B: Math.ceil(dB / pitch - 1e-9),
  };
  layouts.set(key, frame);
  return frame;
}

/**
 * The chain at one crank angle. The wrap rollers stay locked to the machined
 * gaps of sprockets that turn at crank speed and half crank speed, so the whole
 * drive turns at exactly the 2:1 the 18 and 36 teeth realise; the two straight
 * runs keep their whole link counts and re-bow to take up whatever the polygon
 * action leaves over.
 */
export function chainPose(frame, theta) {
  const { pitch, cam, wrapR, step, wrap, teeth } = frame;
  const eng = engagement(frame, theta);
  const crankRollers = [];
  for (let i = 0; i <= wrap.crank; i++) {
    const p = seatAt(frame, 'crank', i, theta, eng.h1);
    crankRollers.push({ ...p, on: 'crank', gap: wrapDeg(eng.h1 + i) % teeth.crank, at: seatAz(frame, 'crank', i, theta, eng.h1) });
  }
  const camRollers = [];
  for (let j = 0; j <= wrap.cam; j++) {
    const p = seatAt(frame, 'cam', j, theta, eng.h2);
    camRollers.push({ ...p, on: 'cam', gap: wrapDeg(eng.h2 + j) % teeth.cam, at: seatAz(frame, 'cam', j, theta, eng.h2) });
  }
  const interior = scale(cam, 0.5);
  const solve = (a, b, fixed) => {
    const d = len(sub(b, a));
    const links = Math.max(fixed, Math.ceil(d / pitch - 1e-9));
    const run = spanRun(a, b, links, pitch, interior);
    return {
      from: a, to: b, distance: d, links,
      takeUp: links * pitch - d, bow: run.geo, centre: run.centre, apex: run.apex,
      pts: run.pts,
    };
  };
  const A = solve(crankRollers[crankRollers.length - 1], camRollers[0], frame.spansFixed.A);
  const B = solve(camRollers[camRollers.length - 1], crankRollers[0], frame.spansFixed.B);

  const rollers = [
    ...crankRollers,
    ...A.pts.slice(1, -1).map((p) => ({ ...p, on: 'span', span: 'A' })),
    ...camRollers,
    ...B.pts.slice(1, -1).map((p) => ({ ...p, on: 'span', span: 'B' })),
  ];
  const links = [];
  for (let i = 0; i < rollers.length; i++) {
    const a = rollers[i], b = rollers[(i + 1) % rollers.length];
    links.push({ a, b, chord: len(sub(b, a)) });
  }
  // Machined gap centres at this crank angle, relative to each sprocket's own
  // axis: the crank gap lattice turns with the crank, the cam gap lattice with
  // the cam at half that angle.
  const gaps = {
    crank: Array.from({ length: teeth.crank }, (_, k) => {
      const r = dir(frame.phase.crank + k * step.crank - theta);
      return { y: r.y * frame.pitchR.crank, z: r.z * frame.pitchR.crank };
    }),
    cam: Array.from({ length: teeth.cam }, (_, k) => {
      const r = dir(frame.phase.cam + k * step.cam - theta / 2);
      return { y: r.y * frame.pitchR.cam, z: r.z * frame.pitchR.cam };
    }),
  };
  return {
    theta, wrap, engagement: { h1: eng.h1, h2: eng.h2, feasible: eng.ok },
    rollers, links, gaps,
    linkCount: rollers.length,
    loop: rollers.length * pitch,
    spans: { A: { ...A, pts: undefined }, B: { ...B, pts: undefined } },
  };
}

/** Full layout of one chain: its frame plus the pose at crank angle 0. */
export function chainLayout(bank, valve) {
  const frame = frameOf(bank, valve);
  const pose = chainPose(frame, 0);
  return {
    ...frame,
    ...pose,
    spans: pose.spans,
    linkCounts: { crank: frame.wrap.crank, cam: frame.wrap.cam },
    tensioner: {
      radius: C.tensionerR,
      takeUp: Math.max(pose.spans.A.takeUp, pose.spans.B.takeUp),
      travel: C.tensionerTravel,
    },
  };
}

/** Every chain on this engine: one per DOHC camshaft, in its published band. */
export function driveContract() {
  const runs = ['L', 'R'].flatMap((bank) => ['intake', 'exhaust'].map((valve) => chainLayout(bank, valve)));
  const one = runs[0];
  return {
    pitch: one.pitch,
    chainCount: runs.length,
    bands: SPEC.cam.sprocket.bands,
    runs,
    linkCounts: runs.map((r) => r.linkCount),
    wrapCounts: runs.map((r) => `${r.wrap.crank}+${r.wrap.cam}`),
    takeUp: runs.map((r) => Math.max(r.spans.A.takeUp, r.spans.B.takeUp)),
  };
}
