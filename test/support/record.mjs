// The recorded-stream formatter (issue #43).
//
// scripts/ledger-run.sh strips node's own duration stamps so a hash a GATES.md row
// cites is re-derivable. That reaches the runner's noise, not what a gate prints
// itself: test/screenshots.mjs printed the per-shot PNG byte count, the rasteriser's
// own pixel hash, the mean luminance and the draw-call count, and issue #43 measured
// all four moving between two runs of the same pose (307534 vs 307403 bytes, mean
// 34.523 vs 34.521, hash 2459187896 vs 382973736). A line carrying them hashes
// differently every run, so the row citing it cites a snapshot of a rasteriser.
//
// The split this module publishes: a recorded stream carries only what a law
// compares. The volatile numbers are not deleted - they belong in a human reading
// the pictures - they just stop living in the stream a hash is taken of.
import { format } from 'node:util';
import assert from 'node:assert/strict';

/** Fields a recorded run cannot carry. The first four are the shot fields issue #43
 *  measured moving (bytes, the rasteriser's pixel hash, mean luminance, draw calls).
 *  The last four are the pixel-comparison fields, measured moving between
 *  tmp/v8-8f-shots-fix3.out and tmp/v8-8f2-shots2.out: the crank 0 -> 180 pair printed
 *  `1619 of 101626 sampled pixels differ (1.5931%), mean delta 16.44` against `1663 ...
 *  (1.6364%) ... 16.1`, the round trip 1619 against 1763, and two reads of one pinned
 *  pose `0 differing, worst luminance delta 0` against `120 differing, worst luminance
 *  delta 23` - every one inside the published tolerances, so none of them is a fact
 *  about the pose. */
export const VOLATILE = ['bytes', 'hash', 'mean', 'drawCalls', 'differing', 'pct', 'maxDelta', 'meanDelta'];

/** Shots the gate captures at a live rpm instead of at a pinned crank angle. Their
 *  picture is a function of where the animation stood when the shutter opened, so
 *  even the luminance ceiling is a stopwatch reading: measured on two runs of the
 *  fixed gate, `shot running` printed `luminance 0..250.9 contrast 250.9` against
 *  `0..249.1 contrast 249.1` while every pinned-pose line was byte-identical.
 *  A line for one of these shots carries only what its laws compare. */
export const LIVE_POSE = ['running'];

/** A per-process handle the GL driver prints into a console warning: identical
 *  warning text, a different number in every process (issue #43 measured
 *  `[.WebGL-0xafc00379a00]` against `[.WebGL-0x134400e6de00]` for one run pair). */
const PROCESS_HANDLE = /0x[0-9a-f]{6,}/gi;

/**
 * The stable shot line: buffer, sample count, and for a pinned pose the lit coverage,
 * luminance floor/ceiling/contrast and lit span - the exact numbers the gate's own laws
 * compare.
 *
 * A shot taken at a live rpm has no pose, so none of those four measures anything a law
 * can re-derive: the shutter opens wherever the animation stood. The luminance trio was
 * dropped for that reason in 8F-1; a re-derived pair of the fixed gate then measured the
 * other two moving as well (tmp/nc8f3b-restored-a.out `lit 27.6%` against
 * tmp/nc8f3b-restored-b.out `lit 27.7%`). A live-rpm line therefore states the verdict its
 * laws reach against the published floors - the shape compareLine publishes - and nothing
 * else. The floors come from the caller, which is where the gate holds them.
 */
export const shotLine = (name, s, floors = {}) => {
  const base = `shot ${name.padEnd(9)} ${s.pixels.w}x${s.pixels.h} buffer, ${s.pixels.samples} samples`;
  if (LIVE_POSE.includes(name)) {
    const cleared = [];
    if (floors.samplesMin !== undefined) cleared.push(`at least ${floors.samplesMin} pixels sampled`);
    if (floors.litMin !== undefined) cleared.push(`at least ${(floors.litMin * 100).toFixed(0)}% lit`);
    assert(cleared.length, 'shotLine was given a live-rpm shot and no published floor to state');
    return `${base}, clears the published floors (${cleared.join(', ')}) (live rpm, pose not pinned)`;
  }
  return format('%s, lit %s%%, luminance %s..%s contrast %s, lit span %dx%d',
    base, (s.pixels.litFraction * 100).toFixed(1), s.pixels.min, s.pixels.max, s.pixels.contrast, s.pixels.litSpan.rows, s.pixels.litSpan.cols);
};

/** The volatile extras, for a human reading the gate rather than for a record. */
export const detailLine = (name, s) => format(
  'detail %s %d bytes, pixel hash %d, mean %s, draw calls %d',
  name.padEnd(9), s.bytes, s.pixels.hash, s.pixels.mean, s.pixels.drawCalls,
);

/** One pixel comparison of two renders, printed as the verdict its laws state against
 *  the published floors - never as the counts, which are stopwatch readings (see
 *  VOLATILE). The stable half (how many pixels the gate sampled) stays. */
export const compareLine = (label, cmp, floors) => {
  const cleared = [];
  if (floors.pctMin !== undefined) cleared.push(`at least ${floors.pctMin}% of the samples differing`);
  if (floors.maxDeltaMin !== undefined) cleared.push(`worst luminance delta at least ${floors.maxDeltaMin}`);
  if (floors.pctSlack !== undefined) cleared.push(`differing percentage within ${floors.pctSlack} points of the paired measurement`);
  if (floors.slack !== undefined) cleared.push(`worst luminance delta within ${floors.slack} of the paired measurement`);
  if (floors.pctMax !== undefined) cleared.push(`at most ${floors.pctMax}% of the samples differing`);
  if (floors.maxDeltaMax !== undefined) cleared.push(`worst luminance delta at most ${floors.maxDeltaMax}`);
  assert(cleared.length, 'compareLine was given no published floor to state');
  return `pixels ${label}: ${cmp.of} sampled, clears the published floors (${cleared.join(', ')})`;
};

/** The same comparison's measured numbers, for a human reading the gate. */
export const compareDetail = (label, cmp) => format(
  'detail pixels %s: %d of %d sampled differing (%s%%), worst luminance delta %s, mean delta %s where a pixel moved',
  label, cmp.differing, cmp.of, cmp.pct, cmp.maxDelta, cmp.meanDelta,
);

/** One warning as it may be recorded: same text every process, handle removed. */
export const normalizeWarning = (text) => String(text).replace(PROCESS_HANDLE, '0xHANDLE');
