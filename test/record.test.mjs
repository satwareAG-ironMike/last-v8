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

import { LIVE_POSE, VOLATILE, compareDetail, compareLine, detailLine, normalizeWarning, shotLine } from './support/record.mjs';

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
  const shotField = { bytes: (s) => s.bytes, hash: (s) => s.pixels.hash, mean: (s) => s.pixels.mean, drawCalls: (s) => s.pixels.drawCalls };
  for (const field of Object.keys(shotField)) {
    assert.ok(VOLATILE.includes(field), `VOLATILE no longer names the shot field ${field}`);
    const raw = String(shotField[field](SHOT_A));
    assert.ok(!a.includes(raw), `the default shot line prints the volatile ${field} (${raw}):\n  ${a}`);
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

test('the screenshot gate carries a capture pass for the published fluid networks and the cam drive', () => {
  const src = readFileSync('test/screenshots.mjs', 'utf8');
  // row A1-G5's title names three things the gate must measure off the live page:
  // the coolant jackets and passages, the oil galleries and drillings, and the
  // working cam drive. A pass for them reads the published networks in the page
  // and compares them with the drawn members, so the gate must import them there.
  assert.ok(/import\('\/src\/engine\/coolant\.js'\)/.test(src), 'the gate never reads src/engine/coolant.js in the page, so no law measures the published coolant members');
  assert.ok(/import\('\/src\/engine\/oil\.js'\)/.test(src), 'the gate never reads src/engine/oil.js in the page, so no law measures the published oil members');
  assert.ok(/import\('\/src\/engine\/drive\.js'\)/.test(src), 'the gate never reads src/engine/drive.js in the page, so no law measures the drawn chain against its published pitch');
  for (const clause of ['coolant', 'oil', 'drive'])
    assert.ok(src.includes(`bad.push(\`${clause}: `), `the gate prints no verdict line for the ${clause} capture pass`);
  // the fluid picture frames on the bounds the published networks report, not on a
  // typed point a reader cannot trace to a module
  assert.ok(/fluidBounds/.test(src), 'the gate never reads where the published fluids actually are');
  assert.ok(/focusCameraOn\([^)]*fb\.center/.test(src), 'the fluid capture frames on a typed point instead of the bounds the fluid members report');
  // the volatile set stays behind the guard at every call site
  const lines = src.split('\n');
  const calls = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes('detailLine(')) continue;
    calls.push(i);
    const guarded = lines[i].includes("process.argv.includes('--detail')")
      || (i > 0 && lines[i - 1].includes("process.argv.includes('--detail')"));
    assert.ok(guarded, `detailLine is called without a --detail guard at line ${i + 1}:\n  ${lines[i - 1]}\n  ${lines[i]}`);
  }
  assert.ok(calls.length > 0, 'the gate never calls detailLine');
});

test('a page read the gate parses must be stringified in the page: the harness already decodes what evaluate returns', () => {
  const src = readFileSync('test/screenshots.mjs', 'utf8');
  // test/support/browser.mjs evaluates with returnByValue, so an object the page returns
  // arrives in Node already decoded. JSON.parse(await evalJs(...)) on such a read hands
  // JSON.parse the string "[object Object]": measured on this gate, it threw
  // `SyntaxError: "[object Object]" is not valid JSON` at the fluid census and the gate
  // died before it could print a verdict (tmp/v8-8f2-shots1.out, exit 1).
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.includes('JSON.parse(await evalJs(')) continue;
    assert.ok(l.includes('JSON.stringify('), `line ${i + 1} parses a page read the harness already decoded, and the page never stringifies it:\n  ${l.trim()}`);
  }
});

test('a page-read template that already invokes itself is never called a second time', () => {
  const src = readFileSync('test/screenshots.mjs', 'utf8');
  // Every page-read template in this gate is a self-invoking IIFE (`const X = `(() => {
  // ... })()`;`), so the harness composition must pass it through, not call it again.
  // Measured: `(async () => JSON.stringify(await (${FLUIDS})()))()` evaluated in the page
  // as `Promise(...)` and threw `TypeError: (intermediate value)(...) is not a function`
  // at test/screenshots.mjs:953 (tmp/v8-8f2-shots2.out, exit 1, no verdict printed).
  const templates = [];
  for (const m of src.matchAll(/^const ([A-Z][A-Z0-9_]+) = `/gm)) {
    const open = m.index + m[0].length;
    const close = src.indexOf('`', open);
    assert.ok(close > 0, `the page template ${m[1]} is never closed`);
    templates.push({ name: m[1], invoked: /\)\s*$/.test(src.slice(open, close).trimEnd()) });
  }
  assert.ok(templates.length >= 3, `the gate holds ${templates.length} page templates, expected at least MEASURE, PIXELS and FLUIDS`);
  const lineOf = (at) => src.slice(0, at).split('\n').length;
  for (const t of templates.filter((x) => x.invoked)) {
    const needle = '${' + t.name + '}';
    for (let at = src.indexOf(needle); at >= 0; at = src.indexOf(needle, at + 1)) {
      const after = src.slice(at + needle.length, at + needle.length + 6);
      assert.ok(
        !/^\)\(/.test(after),
        `line ${lineOf(at)} calls the already-invoked page template ${t.name} a second time: ` +
        `${needle}${after}\n  ${t.name} is defined as a self-invoking IIFE, so the composition ` +
        'must not append another call',
      );
    }
  }
});

test('a pixel comparison records its verdict against the published floors, not the counts it measured', () => {
  // Two runs of this gate, one pinned pose each: the crank 0 -> 180 pair printed
  // `1619 of 101626 sampled pixels differ (1.5931%), mean delta 16.44` in
  // tmp/v8-8f-shots-fix3.out and `1663 ... (1.6364%) ... 16.1` in tmp/v8-8f2-shots2.out;
  // the round trip printed 1619 against 1763; two reads of one pinned pose printed
  // `0 differing, worst luminance delta 0` against `120 differing, worst luminance delta
  // 23`. Every one of those is inside the published tolerances, so none of them is a
  // fact about the pose - and a row citing a record carrying them cannot re-derive it.
  for (const field of ['differing', 'pct', 'maxDelta', 'meanDelta'])
    assert.ok(VOLATILE.includes(field), `VOLATILE does not name "${field}", which two runs of this gate measured moving`);

  const PAIR_A = { differing: 1619, of: 101626, pct: 1.5931, maxDelta: 201, meanDelta: 16.44 };
  const PAIR_B = { differing: 1663, of: 101626, pct: 1.6364, maxDelta: 201, meanDelta: 16.1 };
  const a = compareLine('cutaway pair 0deg->180deg', PAIR_A, { maxDeltaMin: 40 });
  const b = compareLine('cutaway pair 0deg->180deg', PAIR_B, { maxDeltaMin: 40 });
  assert.equal(a, b, `the recorded comparison line moved between two runs of one pose:\n  ${a}\n  ${b}`);
  for (const raw of ['1619', '1663', '1.5931', '1.6364', '16.44', '16.1', '201'])
    assert.ok(!a.includes(raw), `the recorded comparison line prints the measured ${raw}:\n  ${a}`);
  assert.ok(a.includes('101626'), `the recorded comparison line dropped the stable sample count:\n  ${a}`);
  assert.ok(a.includes('at least 40'), `the recorded comparison line does not name the floor it clears:\n  ${a}`);
  const held = compareLine('same pose twice', { differing: 0, of: 101626, pct: 0, maxDelta: 0, meanDelta: 0 }, { pctMax: 0.5, maxDeltaMax: 60 });
  assert.ok(held.includes('at most 0.5%') && held.includes('at most 60'), `the ceiling law's floors are not stated:\n  ${held}`);
  // the numbers stay readable behind compareDetail
  const d = compareDetail('cutaway pair 0deg->180deg', PAIR_A);
  for (const raw of ['1619', '1.5931', '201', '16.44'])
    assert.ok(d.includes(raw), `compareDetail dropped ${raw}:\n  ${d}`);

  // and the gate itself must not print a measured comparison number outside a --detail guard
  const src = readFileSync('test/screenshots.mjs', 'utf8');
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const guarded = l.includes("process.argv.includes('--detail')")
      || (i > 0 && lines[i - 1].includes("process.argv.includes('--detail')"));
    if (l.includes('console.log(') && /\.(differing|pct|maxDelta|meanDelta)\b/.test(l))
      assert.ok(guarded, `line ${i + 1} prints a measured pixel-comparison number into the recorded stream:\n  ${l.trim()}`);
    if (l.includes('compareDetail('))
      assert.ok(guarded, `line ${i + 1} prints the measured comparison detail without a --detail guard:\n  ${l.trim()}`);
  }
  assert.ok(src.includes('compareLine('), 'the gate prints no comparison verdict through the formatter');
});

test('a page eval names only what the page really has: THREE is not a global there', () => {
  const src = readFileSync('test/screenshots.mjs', 'utf8');
  // The gate's page reads run in the page's global scope, where the module import is not
  // visible: THREE lives as window.__v8.THREE. Measured: `evalJs('window.__v8.focusCameraOn(
  // new THREE.Vector3(0, 0, -10.5), 34)')` threw `ReferenceError: THREE is not defined` and
  // the gate died before printing a verdict (tmp/v8-8f2-shots3.out, exit 1, after the fluid
  // census had already printed 94 of 94 coolant members and 4 chains).
  for (const [i, l] of src.split('\n').entries())
    assert.ok(
      !l.includes('evalJs(') || !/\bnew THREE\./.test(l),
      `line ${i + 1} builds "new THREE." inside a page eval, where THREE is not a global: ${l.trim().slice(0, 140)}`,
    );
  // a page template may use THREE only when it aliases it from the app surface first
  for (const m of src.matchAll(/^const ([A-Z][A-Z0-9_]+) = `/gm)) {
    const open = m.index + m[0].length;
    const close = src.indexOf('`', open);
    const body = src.slice(open, close);
    if (!/\bTHREE\./.test(body)) continue;
    assert.ok(/=\s*(v|window\.__v8)\.THREE/.test(body), `${m[1]} uses THREE without aliasing it from window.__v8`);
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
