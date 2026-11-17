// Valve-train / cam-lobe audit: the generator every A1-G1 and A1-G3 number in
// src/engine/spec.js, test/heads.test.mjs, test/timing.test.mjs, GATES.md and
// README.md is read from. It never mutates the tree - it reads the published
// SPEC and measures it, so a re-tune re-measures instead of leaving a
// hand-copied figure behind (AGENTS.md Honesty: generated drift).
//
// Usage:
//   node scripts/valve-train-audit.mjs            full JSON dump
//   node scripts/valve-train-audit.mjs --check    compare the published claims
//                                                 below against the measurement
//                                                 and print AUDIT OK / AUDIT FAIL
// The claim table is the published half: every value the docs quote. `--check`
// is the regression that fires when a geometry change moves a quoted number,
// which is exactly how the single-ray law and the 1.2 cm lift were caught.
import { SPEC, wrap720 } from '../src/engine/spec.js';
import {
  valveLift, pistonAlong, eventMid, lobeSeparation,
  lobeHalfCamDeg, lobeNoseExponent, lobeUndercutExponent,
  lobeProfileRadius, lobeMaxRadius, lobeContactLift,
  lobeMaxWalk, lobeMinCurvature,
} from '../src/engine/timing.js';

const V = SPEC.valves, H = SPEC.head, B = SPEC.block, P = SPEC.piston, C = SPEC.crank;
const DEG = Math.PI / 180;
const QUOTE_CM = 0.127; // 0.050 in: the lift height a duration is quoted at
const valves = ['intake', 'exhaust'];
const COS = Math.cos(H.valveAngle * DEG), SIN = Math.sin(H.valveAngle * DEG);
const tdcCrown = C.radius + SPEC.rod.length + P.compressionHeight;
const crownAt = (cyl, cycle) => pistonAlong(cyl, wrap720(cyl.powerTDC + cycle)) + P.compressionHeight;
/** Lowest point of the valve head disc, in bore coordinates along the axis. */
const discEdge = (valve, lift) =>
  B.deckA - (lift + H.headThickness) * COS - (H.headDia[valve] / 2) * SIN;
const r4 = (x) => +x.toFixed(4);
const r2 = (x) => +x.toFixed(2);

/** Crank degrees where a cam grinder first reaches `target` cm of lift, from the nose. */
function liftHalfWidthDeg(valve, target) {
  const hw = lobeHalfCamDeg(valve);
  let lo = 0, hi = hw;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (lobeContactLift(valve, mid) > target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

const perValve = {};
for (const valve of valves) {
  const halfCam = lobeHalfCamDeg(valve);
  const p = lobeNoseExponent(valve), pMax = lobeUndercutExponent(valve);
  const durZero = 4 * halfCam; // the law closes exactly at the half-width
  const durQuote = 4 * liftHalfWidthDeg(valve, QUOTE_CM);
  const noseBand = 4 * liftHalfWidthDeg(valve, V.maxLift - QUOTE_CM);
  const rampEach = (durZero - durQuote) / 2;
  perValve[valve] = {
    halfCamDeg: halfCam,
    durationZeroLiftCrankDeg: durZero,
    durationAtQuoteCrankDeg: r2(durQuote),
    quotedShare: r4(durQuote / durZero),
    rampEachCrankDeg: r2(rampEach),
    flankEachCrankDeg: r2((durZero - 2 * rampEach - noseBand) / 2),
    noseBandCrankDeg: r2(noseBand),
    noseExponent: +p.toFixed(6),
    noseExponentUndercutLimit: +pMax.toFixed(6),
    noseExponentHeadroom: +(pMax - p).toFixed(6),
    contactWalkCm: r4(lobeMaxWalk(valve)),
    outlineMinCurvatureCm: r4(lobeMinCurvature(valve)),
    outlineMaxRadiusCm: r4(lobeMaxRadius(valve)),
    baseCircleReadBackCm: r4(lobeProfileRadius(valve, halfCam + 1)),
    liftAtHalfFlankCm: r4(lobeContactLift(valve, halfCam * 0.5)),
    outlineRiseAtHalfFlankCm: r4(lobeProfileRadius(valve, halfCam * 0.5) - H.camBaseRadius),
  };
}

// valve/piston clearance over every cylinder and the whole 720 crank degrees
let worst = Infinity, worstAt = null, nearTdc = 0, nearTdcAt = null;
const perValveGap = {};
for (const cyl of SPEC.cylinders) {
  for (let cycle = 0; cycle < 720; cycle++) {
    const crown = crownAt(cyl, cycle);
    for (const valve of valves) {
      const lift = valveLift(cyl, valve, wrap720(cyl.powerTDC + cycle));
      const gap = discEdge(valve, lift) - crown;
      if (gap < worst) { worst = gap; worstAt = [cyl.num, valve, cycle, r4(crown), r4(lift)]; }
      if (!perValveGap[valve] || gap < perValveGap[valve].cm) {
        perValveGap[valve] = { cm: r4(gap), at: [cyl.num, valve, cycle, r4(lift)] };
      }
      if (crown > tdcCrown - 1.0 && lift > nearTdc) { nearTdc = lift; nearTdcAt = [cyl.num, valve, cycle]; }
    }
  }
}

// overlap counted on whole crank degrees, both valves off their seats. Counted
// per cylinder: every cylinder carries the same cam windows, so the per-cylinder
// number is what the docs quote and the total is 8 x it (measured, not asserted).
const overlapPerCyl = [];
let firstOverlap = null;
for (const cyl of SPEC.cylinders) {
  let n = 0;
  for (let cycle = 0; cycle < 720; cycle++) {
    const i = valveLift(cyl, 'intake', wrap720(cyl.powerTDC + cycle));
    const e = valveLift(cyl, 'exhaust', wrap720(cyl.powerTDC + cycle));
    if (i > 0 && e > 0) { n++; if (!firstOverlap) firstOverlap = [cyl.num, cycle, r4(i), r4(e)]; }
  }
  overlapPerCyl.push({ cyl: cyl.num, samples: n });
}
const overlapSamples = overlapPerCyl[0].samples;

const out = {
  published: {
    maxLiftCm: V.maxLift, camBaseRadiusCm: H.camBaseRadius, lobeNoseRadiusCm: V.lobeNoseRadius,
    tappetFaceRadiusCm: H.bucketRadius, tappetHeightCm: H.bucketHeight,
    valveAngleDeg: H.valveAngle, headDiaCm: H.headDia, headThicknessCm: H.headThickness, deckACm: B.deckA,
    windowsCrankDeg: { exhaust: [V.exhaustOpen, V.exhaustClose], intake: [V.intakeOpen, V.intakeClose] },
    groundAnglesCrankDeg: {
      EVO: 180 - V.exhaustOpen, EVC: V.exhaustClose - 360,
      IVO: 360 - V.intakeOpen, IVC: V.intakeClose - 540,
    },
    overlapNominalCrankDeg: V.exhaustClose - V.intakeOpen,
  },
  perValve,
  timing: {
    lobeSeparationCamDeg: r4(lobeSeparation(SPEC.cylinders[0])),
    centreSepCrankDeg: Math.abs(eventMid('intake') - eventMid('exhaust')),
    overlapWholeCycles: overlapSamples, firstOverlapSample: firstOverlap,
  },
  clearance: {
    tdcCrownPlaneCm: r4(tdcCrown),
    zeroLiftGapCm: valves.reduce((a, v) => ({ ...a, [v]: r4(discEdge(v, 0) - tdcCrown) }), {}),
    worstValveToPistonCm: r4(worst), worstAt,
    perValve: perValveGap,
    maxLiftNearTdcCm: { measured: r4(nearTdc), at: nearTdcAt, gateCeiling: r4(V.maxLift * 0.75) },
  },
};

// ---- the published claims (--check) -----------------------------------------
// Every entry is a number a durable doc quotes. A geometry change that moves
// one of them must be re-published in the same PR, or this check goes red.
const CLAIMS = [
  ['maxLift', out.published.maxLiftCm, 1.1, 1e-9],
  ['cam base circle', out.published.camBaseRadiusCm, 2.0, 1e-9],
  ['lobe nose radius', out.published.lobeNoseRadiusCm, 0.4, 1e-9],
  ['tappet face radius', out.published.tappetFaceRadiusCm, 1.9, 1e-9],
  ['exhaust window', JSON.stringify(out.published.windowsCrankDeg.exhaust), JSON.stringify([110, 386]), 0],
  ['intake window', JSON.stringify(out.published.windowsCrankDeg.intake), JSON.stringify([342, 616]), 0],
  ['overlap nominal', out.published.overlapNominalCrankDeg, 44, 1e-9],
  ['overlap whole cycles', out.timing.overlapWholeCycles, 43, 0],
  ['lobe separation cam deg', out.timing.lobeSeparationCamDeg, 115.5, 1e-3],
  ['centre sep crank deg', out.timing.centreSepCrankDeg, 231, 1e-9],
  ['exhaust zero-lift duration', out.perValve.exhaust.durationZeroLiftCrankDeg, 276, 1e-9],
  ['intake zero-lift duration', out.perValve.intake.durationZeroLiftCrankDeg, 274, 1e-9],
  ['exhaust quoted duration', out.perValve.exhaust.durationAtQuoteCrankDeg, 231.36, 5e-3],
  ['intake quoted duration', out.perValve.intake.durationAtQuoteCrankDeg, 230.54, 5e-3],
  ['exhaust nose band', out.perValve.exhaust.noseBandCrankDeg, 71.23, 5e-3],
  ['intake nose band', out.perValve.intake.noseBandCrankDeg, 71.21, 5e-3],
  ['exhaust ramp each side', out.perValve.exhaust.rampEachCrankDeg, 22.32, 5e-3],
  ['intake ramp each side', out.perValve.intake.rampEachCrankDeg, 21.73, 5e-3],
  ['exhaust flank each side', out.perValve.exhaust.flankEachCrankDeg, 80.06, 5e-3],
  ['intake flank each side', out.perValve.intake.flankEachCrankDeg, 79.66, 5e-3],
  ['exhaust nose exponent', out.perValve.exhaust.noseExponent, 1.779893, 1e-5],
  ['intake nose exponent', out.perValve.intake.noseExponent, 1.754191, 1e-5],
  ['exhaust undercut limit', out.perValve.exhaust.noseExponentUndercutLimit, 2.043581, 1e-5],
  ['intake undercut limit', out.perValve.intake.noseExponentUndercutLimit, 2.014072, 1e-5],
  ['exhaust contact walk cm', out.perValve.exhaust.contactWalkCm, 1.381, 5e-4],
  ['intake contact walk cm', out.perValve.intake.contactWalkCm, 1.3888, 5e-4],
  ['outline min curvature cm', out.perValve.exhaust.outlineMinCurvatureCm, 0.4, 5e-4],
  ['outline max radius cm', out.perValve.exhaust.outlineMaxRadiusCm, 3.1, 5e-4],
  ['base circle read back cm', out.perValve.exhaust.baseCircleReadBackCm, 2.0, 5e-4],
  ['worst valve/piston clearance cm', out.clearance.worstValveToPistonCm, 0.2093, 5e-4],
  ['near-TDC lift cm', out.clearance.maxLiftNearTdcCm.measured, 0.5781, 5e-4],
];

if (process.argv.includes('--check')) {
  const bad = [];
  for (const [name, got, want, tol] of CLAIMS) {
    const ok = tol === 0 ? got === want : Math.abs(got - want) <= tol;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(30)} published ${want} measured ${got}`);
    if (!ok) bad.push(name);
  }
  if (bad.length) {
    console.log(`AUDIT FAIL: ${bad.length} published claim(s) no longer match the measured geometry: ${bad.join(', ')}`);
    process.exit(1);
  }
  console.log(`AUDIT OK: ${CLAIMS.length} published claim(s) re-derived from src/engine/spec.js`);
  process.exit(0);
}
console.log(JSON.stringify(out, null, 2));
