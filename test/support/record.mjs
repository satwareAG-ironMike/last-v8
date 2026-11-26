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

/** Fields of one shot record that move run to run, measured in issue #43. */
export const VOLATILE = ['bytes', 'hash', 'mean', 'drawCalls'];

/** A per-process handle the GL driver prints into a console warning: identical
 *  warning text, a different number in every process (issue #43 measured
 *  `[.WebGL-0xafc00379a00]` against `[.WebGL-0x134400e6de00]` for one run pair). */
const PROCESS_HANDLE = /0x[0-9a-f]{6,}/gi;

/** The stable shot line: buffer, lit coverage, luminance floor/ceiling/contrast,
 *  lit span, sample count - the exact numbers the gate's own laws compare. */
export const shotLine = (name, s) => format(
  'shot %s %dx%d buffer, %d samples, lit %s%%, luminance %s..%s contrast %s, lit span %dx%d',
  name.padEnd(9), s.pixels.w, s.pixels.h, s.pixels.samples,
  (s.pixels.litFraction * 100).toFixed(1), s.pixels.min, s.pixels.max, s.pixels.contrast,
  s.pixels.litSpan.rows, s.pixels.litSpan.cols,
);

/** The volatile extras, for a human reading the gate rather than for a record. */
export const detailLine = (name, s) => format(
  'detail %s %d bytes, pixel hash %d, mean %s, draw calls %d',
  name.padEnd(9), s.bytes, s.pixels.hash, s.pixels.mean, s.pixels.drawCalls,
);

/** One warning as it may be recorded: same text every process, handle removed. */
export const normalizeWarning = (text) => String(text).replace(PROCESS_HANDLE, '0xHANDLE');
