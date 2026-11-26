// Recorded-stream determinism (issue #43): a hash a GATES.md row cites has to be a
// measurement a reviewer can reproduce. scripts/ledger-run.sh already strips node's own
// duration stamps for exactly that reason; this file gates the two gates that stamp
// their own output. The wall-clock half is measured fixed (two back-to-back
// scripts/procedural-audit.mjs runs are byte-identical); the half this file lands is
// test/screenshots.mjs, which printed the per-shot PNG byte count, the rasteriser's own
// pixel hash, the mean luminance and the draw-call count - numbers issue #43 measured
// moving run to run (307534 vs 307403 bytes, mean 34.523 vs 34.521, hash 2459187896 vs
// 382973736) - and pasted raw per-process GL driver handles into its warnings line.
//
// The contract: the recorded stream carries only what a law compares. The volatile
// numbers stay available behind `--detail` for a human reading the pictures, and a
// per-process handle normalizes to one stable token.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { LIVE_POSE, VOLATILE, detailLine, normalizeWarning, shotLine } from './support/record.mjs';

/** The two real handles issue #43 measured in two runs of the same gate. */
const HANDLE_A = 'log[rendering]: [.WebGL-0xafc00379a00]GL Driver Message (OpenGL, Performance, GL_CLOSE_PATH_NV, High): GPU stall on vendor plugin';
const HANDLE_B = 'log[rendering]: [.WebGL-0x134400e6de00]GL Driver Message (OpenGL, Performance, GL_CLOSE_PATH_NV, High): GPU stall on vendor plugin';

/** One measured shot record (tmp/v8-8f-shots-run1.out / run2.out of issue #43's tool):
 *  the volatile fields are the ones that differ between the two runs. */
const SHOT_A = {
  bytes: 307534,
  pixels: { w: 1278, h: 798, samples: 339624, litFraction: 0.34523, min: 6.4, max: 244.1, contrast: 237.7, mean: 34.523, hash: 2459187896, litSpan: { rows: 640, cols: 1100 }, drawCalls: 412 },
};
const SHOT_B = {
  bytes: 307403,
  pixels: { w: 1278, h: 798, samples: 339624, litFraction: 0.34521, min: 6.4, max: 244.1, contrast: 237.7, mean: 34.521, hash: 382973736, litSpan: { rows: 640, cols: 1100 }, drawCalls: 407 },
};

test('test/support/record.mjs names the fields a recorded run cannot carry', () => {
  for (const field of ['bytes', 'hash', 'mean', 'drawCalls'])
    assert.ok(VOLATILE.includes(field), `VOLATILE does not name "${field}", which issue #43 measured moving run to run`);
});

test('the default shot line carries only what a law compares, and two runs of one shot print it identically', () => {
  const a = shotLine('cutaway', SHOT_A);
  const b = shotLine('cutaway', SHOT_B);
  assert.equal(a, b, `the recorded shot line moved between two runs of the same pose:\n  ${a}\n  ${b}`);
  for (const field of VOLATILE) {
    const raw = field === 'bytes' ? SHOT_A.bytes : field === 'hash' ? SHOT_A.pixels.hash : field === 'mean' ? SHOT_A.pixels.mean : SHOT_A.pixels.drawCalls;
    assert.ok(!a.includes(String(raw)), `the default shot line prints the volatile ${field} (${raw}):\n  ${a}`);
  }
  // the numbers the shot laws actually compare stay in the line
  for (const part of ['1278x798', '34.5%', '6.4', '244.1', '237.7', '640x1100', '339624'])
    assert.ok(a.includes(part), `the default shot line dropped the measured ${part}:\n  ${a}`);
});

test('the volatile numbers stay readable, behind detailLine only', () => {
  const d = detailLine('cutaway', SHOT_A);
  for (const part of ['307534', '2459187896', '34.523', '412'])
    assert.ok(d.includes(part), `detailLine dropped ${part}:\n  ${d}`);
});

test('a per-process GL driver handle normalizes to one stable token', () => {
  assert.equal(normalizeWarning(HANDLE_A), normalizeWarning(HANDLE_B), 'the two runs of the same driver warning printed different text');
  assert.ok(!/0x[0-9a-f]{6,}/.test(normalizeWarning(HANDLE_A)), `the per-process handle survived normalization: ${normalizeWarning(HANDLE_A)}`);
  assert.ok(normalizeWarning(HANDLE_A).includes('GL Driver Message'), `normalization threw the warning away: ${normalizeWarning(HANDLE_A)}`);
  assert.equal(normalizeWarning('console.warn: nothing volatile here'), 'console.warn: nothing volatile here', 'a plain warning was rewritten');
});

test('scripts/procedural-audit.mjs records byte-identically, the wall-clock half of issue #43', () => {
  const one = spawnSync(process.execPath, ['scripts/procedural-audit.mjs'], { encoding: 'utf8' });
  const two = spawnSync(process.execPath, ['scripts/procedural-audit.mjs'], { encoding: 'utf8' });
  assert.equal(one.status, 0, `the audit exited ${one.status}`);
  assert.equal(`${one.stdout}\n${one.stderr}`, `${two.stdout}\n${two.stderr}`, 'two runs of the static audit printed different text');
  assert.ok(!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(one.stdout), `the audit header still stamps a wall clock:\n${one.stdout.split('\n')[0]}`);
});

test('a shot taken at a live rpm prints only what its laws compare, because its pose is not pinned', () => {
  assert.ok(LIVE_POSE.includes('running'), 'the formatter does not name the gate\'s live-rpm shot');
  // the two real records of the fixed gate (tmp/v8-8f-shots-fix1.out / fix2.out):
  // the only line that still moved was the running shot's luminance ceiling
  const a = shotLine('running', { pixels: { w: 1280, h: 713, samples: 101626, litFraction: 0.276, min: 0, max: 250.9, contrast: 250.9, litSpan: { rows: 672, cols: 1011 } } });
  const b = shotLine('running', { pixels: { w: 1280, h: 713, samples: 101626, litFraction: 0.276, min: 0, max: 249.1, contrast: 249.1, litSpan: { rows: 672, cols: 1011 } } });
  assert.equal(a, b, `the live-rpm shot line moved between two runs of the gate:\n  ${a}\n  ${b}`);
  for (const part of ['250.9', '249.1', '250.9 contrast'])
    assert.ok(!a.includes(part), `the live-rpm shot line prints the pose-dependent ${part}:\n  ${a}`);
  for (const part of ['1280x713', '101626', '27.6%', '672x1011'])
    assert.ok(a.includes(part), `the live-rpm shot line dropped the measured ${part}:\n  ${a}`);
  // and a pinned pose keeps its full set
  const p = shotLine('cutaway', { pixels: { w: 1280, h: 713, samples: 101626, litFraction: 0.271, min: 0, max: 241.2, contrast: 241.2, litSpan: { rows: 672, cols: 1011 } } });
  assert.ok(p.includes('luminance 0..241.2 contrast 241.2'), `the pinned shot line dropped its luminance trio:\n  ${p}`);
  // the live-rpm set must be exactly the shots the gate takes with the animation
  // running: the nearest preceding pin() is followed by a start() for a live shot
  const src = readFileSync('test/screenshots.mjs', 'utf8');
  for (const name of LIVE_POSE) {
    const at = src.indexOf(`shots.${name} =`);
    assert.ok(at > 0, `the formatter names live shot "${name}", the gate never takes it`);
    const pinAt = src.lastIndexOf('await pin(', at);
    const between = src.slice(Math.max(0, pinAt), at);
    assert.ok(/start\(\)/.test(between), `the gate never starts the animation before shot "${name}", so it is not a live-rpm shot`);
    assert.ok(!/setSlowmo\((?!1\))/.test(between), `the gate slows the animation down before shot "${name}"`);
  }
});

test('test/screenshots.mjs prints its recorded stream through this formatter, the volatile set behind --detail', () => {
  const src = readFileSync('test/screenshots.mjs', 'utf8');
  assert.match(src, /import \{[^}]*shotLine[^}]*\} from '\.\/support\/record\.mjs'/, 'the gate does not print its shot lines through the formatter');
  assert.ok(src.includes('shotLine('), 'the gate prints no formatted shot line');
  const lines = src.split('\n');
  const at = lines.findIndex((l) => l.includes('detailLine('));
  assert.ok(at >= 0, 'the gate never calls detailLine');
  // the volatile set may only reach the printed stream on the line that calls it,
  // or the one guarding it: a wider window would let an unguarded call slip in
  const guarded = lines[at].includes("process.argv.includes('--detail')")
    || (at > 0 && lines[at - 1].includes("process.argv.includes('--detail')"));
  assert.ok(guarded, `detailLine is called without a --detail guard on its line or the one above it:\n  ${lines[at - 1]}\n  ${lines[at]}`);
  // the raw per-process handle must not reach the recorded stream
  assert.ok(!/warnings\.slice\(0, 3\)\.join/.test(src), 'the gate still pastes raw warnings into its output');
});
