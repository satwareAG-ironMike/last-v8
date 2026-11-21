// ---------------------------------------------------------------------------
// src/engine/ohv.js - the cam layout the OHV variant's own block houses
// (issue #8 item 2 + item 4, slice 8C, GATES P1-G7 / A1-G1 / A1-G7).
//
// One central 16-lobe cam turns on the V bisector below the crank. Every number
// here derives from SPEC.variants.ohv, the bearing stack layout.ohvBearings()
// publishes for this variant, the lobe law src/engine/timing.js machines and the
// bank azimuths SPEC.banks publishes - the renderer and the laws read these
// values and may not type a cam radius, station, width or angle of their own.
//
// The follower train (16 lifters, 16 pushrods, 16 rockers, 2 rocker covers) is
// NOT here yet: SPEC.variants.ohv.drawn is still false, because the block has
// not machined its lifter bores. This file publishes the cam and the axis a
// lifter of each bank stands on, which is what the cam's phasing needs.
// ---------------------------------------------------------------------------
import { SPEC, wrap360, signedAngle } from './spec.js';
import { ohvBearings, camGroupNames } from './layout.js';
import { camAzimuth, crankEvent, eventMid, lobeFaceDistance, lobeProfileRadius } from './timing.js';

const V = SPEC.variants.ohv;
const H = SPEC.head;
const DEG = Math.PI / 180;

/**
 * The angular resolution this tree's turned bores are machined at: every lathe in
 * src/render/block.js and src/render/cranktrain.js is turned at 48 segments, and
 * the rings this cam rides in are one of them (src/render/block.js section 2b).
 * A turned facet sinks r*(1 - cos(pi/segments)) off the tool path, so a lobe
 * contour sampled more coarsely than that would be a machined part finer than
 * the bores it runs in - which is not a thing. test/ohv-cam.test.mjs measures the
 * drawn rings' own segment count instead of trusting this number.
 */
export const TURNED_SEGMENTS = 48;
export const turnedChordError = (rCm, segments = TURNED_SEGMENTS) => rCm * (1 - Math.cos(Math.PI / segments));

/**
 * How far the CHORD POLYLINE of a lobe contour contour-sampled at `samples` steps
 * over 360 cam degrees sinks inside the machined outline: the grinder's tool path
 * is a chain of straight chords between the sampled points, and every chord cuts
 * inside the curve (the published profile is convex - timing.js lobeContactCurvature
 * is positive across the whole event). Max deviation over all chords, cm.
 */
export function lobeChordError(valve, samples) {
  const step = 360 / samples;
  let worst = 0, at = null;
  for (let i = 0; i < samples; i++) {
    const a0 = i * step, a1 = a0 + step;
    const r0 = lobeProfileRadius(valve, signedAngle(a0));
    const r1 = lobeProfileRadius(valve, signedAngle(a1));
    const my = (r0 * Math.sin(a0 * DEG) + r1 * Math.sin(a1 * DEG)) / 2;
    const mz = (r0 * Math.cos(a0 * DEG) + r1 * Math.cos(a1 * DEG)) / 2;
    const midR = Math.hypot(my, mz);
    const dev = lobeProfileRadius(valve, signedAngle(wrap360(Math.atan2(my, mz) / DEG))) - midR;
    if (dev > worst) { worst = dev; at = a0 + step / 2; }
  }
  return { err: worst, at };
}

/**
 * Contour steps over 360 cam degrees this variant's 16 lobes are ground at, and the
 * chord error that contour publishes. The tree already grinds its lobes at 2 cam
 * degrees (src/render/valvetrain.js lobeShape, 180 steps); measured through
 * lobeChordError that contour sinks 0.003289 cm (intake) / 0.003280 cm (exhaust)
 * inside its own machined outline, against the 0.007280 cm a 48-facet 3.4000 cm
 * turned bore presents - so 180 steps is already finer than the bores this cam
 * rides in and the answer here is 180 unchanged. The helper is the CHECK, not an
 * escalator: deviation scales as the square of the step, so if a re-ground lobe
 * ever needs a finer contour than the tree's own it is derived from that ratio,
 * verified against the published outline, and ohvCamLayout refuses to publish a
 * contour coarser than the bore. The same step is used for all 16 lobes.
 */
export function contourSamples(boundCm, valves = ['intake', 'exhaust']) {
  const base = 180; // 2 cam deg: the contour step the tree's lobes already use
  let samples = base;
  let worst = { err: 0, at: null, valve: null };
  const scan = () => {
    worst = { err: 0, at: null, valve: null };
    for (const valve of valves) {
      const r = lobeChordError(valve, samples);
      if (r.err > worst.err) worst = { ...r, valve };
    }
    return worst;
  };
  scan();
  if (worst.err > boundCm) {
    samples = Math.max(181, Math.ceil((360 * Math.sqrt(boundCm / worst.err)) / (360 / base)));
    for (let guard = 0; guard < 12 && scan().err > boundCm; guard++) samples = Math.ceil(samples * 1.2) + 1;
    if (worst.err > boundCm) {
      throw new Error(`a lobe contour of ${samples} steps still leaves ${worst.err.toFixed(6)} cm of chord error at ${worst.at} cam deg of the ${worst.valve} lobe, coarser than the ${boundCm.toFixed(6)} cm this engine's turned bores present`);
    }
  }
  return { samples, chordErrCm: worst.err, chordAtDeg: worst.at, chordValve: worst.valve, baseSamples: base };
}

/** The cam axis: on the V bisector, belowCrankCm under the crank centre. */
export function ohvCamAxis() {
  return { y: 0, z: -V.belowCrankCm };
}

/**
 * The axis a lifter of this bank stands on, in azimuth off the cam axis: the
 * bank's own up-and-out direction. SPEC.banks publishes each bank's azimuth in
 * the same polar frame src/engine/drive.js and src/engine/timing.js use
 * (0 = +z, toward +y), and a lifter bore runs parallel to its bank's deck
 * normal, which is that direction. Bank L at -45 deg, bank R at +45 deg.
 */
export const lifterAzimuth = (bank) => wrap360(SPEC.banks[bank].az);

/** Baked nose azimuth of one lobe in the cam group's own frame (cam degrees). */
export function ohvLobeIndexAngle(cyl, valve) {
  return wrap360(lifterAzimuth(cyl.bank) - camAzimuth(cyl.bank, crankEvent(cyl, eventMid(valve))));
}

/** Absolute azimuth of that lobe's nose at crank angle theta. */
export function ohvLobeAzimuth(cyl, valve, theta) {
  return wrap360(camAzimuth(cyl.bank, theta) + ohvLobeIndexAngle(cyl, valve));
}

/**
 * The lift a lifter rides: the lobe's tangent-plane distance along the lifter
 * axis less the ground base circle. The same contact law the DOHC buckets ride
 * (timing.js valveLift), on this variant's own follower direction - so no
 * lifter face is ever cut by a lobe, because the outline is the envelope of
 * those planes (issue #8 item 3).
 */
export function ohvLift(cyl, valve, theta) {
  const psi = signedAngle(ohvLobeAzimuth(cyl, valve, theta) - lifterAzimuth(cyl.bank));
  return Math.max(0, lobeFaceDistance(valve, psi) - H.camBaseRadius);
}

/**
 * The cam this variant's casting houses: five turned journals standing in the
 * five front-insert ring windows slice 8B machined, four lobe groups of four
 * (one lobe per valve of each bank at each cylinder station) at this variant's
 * own lobe width, and the necks that join them at the ground base circle.
 *
 * Front-insert reading (A1-G7): the journal is ground to the cam's own widest
 * outline, so every lobe nose turns in its own ring AND passes every other ring
 * on the way in through the retainer opening. That is why no load-bearing boss
 * in this tunnel is bored smaller than a nose.
 *
 * Axial capture (the interface 8B names for this slice): a collar that captures
 * a ring press-fit at the bore radius 3.4000 cannot pass the retainer opening of
 * 3.1400, so this variant's cam carries no collars. Its end play is taken where
 * the casting already stops it - the fore ring abuts the retainer plate, the aft
 * ring abuts the aft machined face - and the three mid rings stay where their
 * press fit holds them, the way this tree's cylinder liners do. Issue #23.
 */
export function ohvCamLayout(B = ohvBearings()) {
  const lines = camGroupNames('dohc').map((n) => ({ bank: n.split('-')[1], valve: n.split('-')[2] }));
  const w = B.lobeWidthCm;
  const journals = B.stations.map((s, i) => ({
    name: `cam-V-journal-${i + 1}`,
    x0: s - B.bearingHalf, x1: s + B.bearingHalf, r: B.journalR, ring: i + 1,
  }));
  const lobes = [];
  const groups = [];
  SPEC.block.stations.forEach((st, si) => {
    const fore = st - B.groupHalfCm;
    groups.push([fore, st + B.groupHalfCm]);
    lines.forEach((line, k) => {
      const cyl = SPEC.cylinders.find((c) => c.bank === line.bank && c.station === si);
      const x0 = fore + k * w;
      lobes.push({
        cyl, bank: line.bank, valve: line.valve, name: `lobe-cyl${cyl.num}-${line.valve}`,
        x0, x1: x0 + w, centre: x0 + w / 2, index: ohvLobeIndexAngle(cyl, line.valve),
      });
    });
  });
  const neckR = H.camBaseRadius;
  const filled = [...journals.map((j) => [j.x0, j.x1]), ...groups].sort((p, q) => p[0] - q[0]);
  const necks = [];
  let cur = filled[0][0];
  for (const [u, v] of filled) {
    if (u - cur > 1e-9) necks.push({ name: `cam-V-neck-${necks.length + 1}`, x0: cur, x1: u, r: neckR });
    cur = Math.max(cur, v);
  }
  const contour = contourSamples(turnedChordError(B.boreR));
  if (contour.chordErrCm > turnedChordError(B.boreR)) {
    throw new Error(`the OHV cam's ${contour.samples}-step lobe contour leaves ${contour.chordErrCm.toFixed(6)} cm of chord error at ${contour.chordAtDeg.toFixed(2)} cam deg of the ${contour.chordValve} lobe, coarser than the ${turnedChordError(B.boreR).toFixed(6)} cm the ${TURNED_SEGMENTS}-facet ${B.boreR.toFixed(4)} cm tunnel bore this cam rides in presents`);
  }
  return {
    axis: ohvCamAxis(), journals, lobes, necks,
    journalR: B.journalR, neckR, lobeWidthCm: w, groupHalfCm: B.groupHalfCm,
    span: [B.aftFaceX, B.foreFaceX], noseR: B.noseR,
    profileSamples: contour.samples, profileChordErrCm: contour.chordErrCm,
    profileStepDeg: 360 / contour.samples, turnedBoreChordErrCm: turnedChordError(B.boreR),
    contourAtDeg: contour.chordAtDeg, contourValve: contour.chordValve,
  };
}
