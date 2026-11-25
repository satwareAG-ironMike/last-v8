// Issue #18 (slice 8C-3d): the drawn crank hardware against the drawn block casting.
// Until now nothing measured the casting the crank turns inside. test/cranktrain.test.mjs
// gates the crank against a published BOX (SPEC.block.counterBayHalfX), and the only
// published crank-side air in the tree (SPEC.variants.ohv.tunnel.crankSideAirCm) is a cam
// tunnel fact. These laws gate the iron instead: the main bearing seat the block machines
// for its own bearings, and the air every outline the crank swings keeps from that iron,
// in both builds.
//
// The measure is the (x, radius) band test issue #18 names exact here, over the real
// triangles (test/support/crankblock-iron.mjs). No ray-parity burial test is used: #18
// "Measurement tool defect" records one failing its own control points.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SPEC } from '../src/engine/spec.js';
import { crankSwings } from '../src/engine/layout.js';
import {
  CENTRAL_MAINS, SHELL_HALF, IRON_EPS, BEARING_SURFACE,
  castIron, seatIron, seatArcDeg, swingAir,
} from './support/crankblock-iron.mjs';

const B = SPEC.block;
const CR = SPEC.crank;
const OIL = SPEC.oil;
// Angular slack for the seat arc: the sampled arc's end triangles report their chord, half
// a 0.5 deg step inset at each end of the run.
const ARC_DEG_EPS = 1.5;

/** The published seat, or this law's own named failure. Read per law so a missing publish
 * reds the law that needs it, not the file at import. */
const seat = (law) => {
  const s = B.mainSeat;
  assert.ok(s, `${law}: SPEC.block.mainSeat is not published, so nothing in this tree states what bore the block machines for its own main bearings (issue #18 ask 1)`);
  assert.equal(typeof s.boreCm, 'number', `${law}: SPEC.block.mainSeat.boreCm is not a published radius`);
  return s;
};

// ---------------------------------------------------------------------------

test('the block publishes its main bearing seat and the air it keeps from the crank', async () => {
  const S = seat('the seat law');
  // One radius, not a second number: the seat bore IS the shell's outside face, and that
  // face is derived from the published oil film and shell wall (src/engine/oil.js).
  const shellOD = CR.mainRadius + OIL.mainShell.filmCm + OIL.mainShell.wallCm;
  assert.equal(S.boreCm, shellOD,
    `the seat bore reads ${S.boreCm}, not the ${shellOD} shell OD the published film ${OIL.mainShell.filmCm} and wall ${OIL.mainShell.wallCm} derive`);
  assert.equal(S.interferenceCm, 0,
    `the seat publishes ${S.interferenceCm} cm of interference: the decision recorded on issue #18 (2026-11-24) machines the overlap out and leaves the casting line-bored against the shell, not pressed into it`);
  assert.equal(typeof S.castTopCm, 'number', 'the plane the central main supports are cast on is not published');
  assert.ok(S.castTopCm < S.boreCm,
    `the supports are cast at ${S.castTopCm} cm below the crank axis, at or past the ${S.boreCm} bore: the seat bore would machine nothing`);
  assert.equal(typeof B.crankCastAirCm, 'number',
    'SPEC.block.crankCastAirCm is not published, so the crank-to-casting clearance is still only an OHV tunnel fact (issue #18 ask 1)');
  assert.ok(B.crankCastAirCm > 0, `the published crank-to-casting air is ${B.crankCastAirCm}, not a positive clearance`);
  console.log(`main seat: bore ${S.boreCm.toFixed(4)} cm at the shell OD, cast top ${S.castTopCm.toFixed(4)}, interference ${S.interferenceCm.toFixed(4)}, published crank air ${B.crankCastAirCm.toFixed(4)}`);
});

test('no cast iron stands inside a main bearing seat bore (both builds)', async () => {
  const S = seat('the seat bore law');
  const closest = [];
  for (const variant of ['dohc', 'ohv']) {
    const iron = castIron(variant);
    for (const c of CENTRAL_MAINS) {
      const rows = seatIron(iron, c);
      assert.ok(rows.length, `${variant} x ${c}: no cast iron at all stands in the main's own ${SHELL_HALF} cm shell band, so this main has no housing`);
      const bad = rows.filter((e) => !BEARING_SURFACE.test(e.part) && e.r < S.boreCm - IRON_EPS);
      assert.equal(bad.length, 0,
        `${variant} x ${c}: ${bad.length} cast-iron face(s) stand inside the ${S.boreCm.toFixed(4)} cm main seat bore, the closest ${bad[0].part} at ${bad[0].r.toFixed(4)} cm off the crank axis - that is ${(S.boreCm - bad[0].r).toFixed(4)} cm of bearing seat the casting occupies (issue #18 Measured 1)`);
      closest.push(`${variant} x ${c} ${rows[0].part} ${rows[0].r.toFixed(4)}`);
    }
  }
  console.log(`seat bore clear, closest cast iron per central main (cm off the crank axis): ${closest.join(', ')}`);
});

test('each central main carries a machined seat arc at the published bore radius', async () => {
  const S = seat('the seat arc law');
  // The arc the bore leaves where it meets the cast top plane is set by the two published
  // numbers, so it is derived here and not pinned.
  const cross = Math.sqrt(S.boreCm ** 2 - S.castTopCm ** 2);
  const arcDeg = 2 * Math.asin(cross / S.boreCm) * 180 / Math.PI;
  const rows = [];
  for (const variant of ['dohc', 'ohv']) {
    const iron = castIron(variant);
    for (const c of CENTRAL_MAINS) {
      const a = seatArcDeg(iron, c, S.boreCm);
      assert.ok(a.faces > 0,
        `${variant} x ${c}: no drawn cast-iron face sits on the ${S.boreCm.toFixed(4)} cm seat bore at all, so this main bears on a flat plane and not on a machined seat (issue #18 ask 3)`);
      assert.ok(a.deg >= arcDeg - ARC_DEG_EPS,
        `${variant} x ${c}: the drawn iron covers ${a.deg.toFixed(2)} deg of the seat bore, less than the ${arcDeg.toFixed(2)} deg the ${S.boreCm.toFixed(4)} cm bore machines out of the ${S.castTopCm.toFixed(4)} cm cast top`);
      assert.ok(a.deg <= 180 + ARC_DEG_EPS,
        `${variant} x ${c}: the seat arc reads ${a.deg.toFixed(2)} deg, more than a half bore - nothing in this casting stands over the crank axis in a main's own band (issue #47)`);
      rows.push(`${variant} x ${c} ${a.deg.toFixed(2)}`);
    }
  }
  console.log(`machined seat arc: the bore/cast-top crossing at |y| <= ${cross.toFixed(4)} derives ${arcDeg.toFixed(2)} deg, drawn arc per central main (deg): ${rows.join(', ')}`);
});

test('the swept crank keeps the published air from the cast iron in both builds', async () => {
  assert.equal(typeof B.crankCastAirCm, 'number',
    'the swept law has no published air to gate against: SPEC.block.crankCastAirCm is not a build fact, so the crank-to-casting clearance is still only an OHV tunnel fact (issue #18 ask 1)');
  const swings = crankSwings();
  assert.equal(swings.length, 3, `crankSwings() publishes ${swings.length} swung outlines, not the rod big end, the counterweight lobe tip and the crank pin sweep`);
  const bad = [];
  const readings = [];
  for (const variant of ['dohc', 'ohv']) {
    const iron = castIron(variant);
    let exempt = 0;
    for (const e of iron) {
      const bearing = BEARING_SURFACE.test(e.part);
      if (bearing) exempt++;
      for (const [label, reach, ...bands] of swings) {
        for (const [b0, b1] of bands) {
          const { air, who } = swingAir(e, reach, b0, b1);
          if (air === Infinity) continue; // a solid with no drawn face at all
          if (bearing) continue; // a shell and a bushing are meant to touch
          if (air < B.crankCastAirCm - IRON_EPS) {
            bad.push(`${variant} ${e.part} vs ${label} (band ${b0.toFixed(2)}..${b1.toFixed(2)}): ${air.toFixed(4)} cm of air against the published ${B.crankCastAirCm.toFixed(4)}, iron at r ${who.r.toFixed(4)}`);
          }
          readings.push({ air, text: `${variant} ${e.part} vs ${label} ${air.toFixed(4)}` });
        }
      }
    }
    assert.ok(exempt > 0, `${variant}: no drawn part matched the named bearing surfaces ${BEARING_SURFACE}, so the exemption gates nothing`);
  }
  assert.equal(bad.length, 0, `${bad.length} cast-iron face(s) stand closer to a swung crank outline than the published air:\n  ${bad.slice(0, 8).join('\n  ')}`);
  readings.sort((a, b) => a.air - b.air);
  console.log(`swept crank air: ${readings.length} (solid, swung outline, band) readings, tightest ${readings.slice(0, 3).map((w) => w.text).join(', ')} cm against the published ${B.crankCastAirCm.toFixed(4)} cm`);
});
