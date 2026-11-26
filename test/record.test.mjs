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
  // Measured on two runs of the restored gate (tmp/nc8f3b-restored-a.out against
  // tmp/nc8f3b-restored-b.out): the line that moved was
  //   shot running 1280x713 buffer, 101626 samples, lit 27.6%, lit span 672x1011 (live rpm, pose not pinned)
  //   shot running 1280x713 buffer, 101626 samples, lit 27.7%, lit span 672x1011 (live rpm, pose not pinned)
  // The earlier version of this law held litFraction and litSpan equal in its fixture and
  // then required them in the line, so it could not see the leak. At a live rpm the shutter
  // opens wherever the animation happened to be, so the lit coverage and the lit span are
  // stopwatch readings in exactly the sense the luminance trio already is.
  const floors = { litMin: 0.05, samplesMin: 1000 };
  const a = shotLine('running', { pixels: { w: 1280, h: 713, samples: 101626, litFraction: 0.276, min: 0, max: 250.9, contrast: 250.9, litSpan: { rows: 672, cols: 1011 } } }, floors);
  const b = shotLine('running', { pixels: { w: 1280, h: 713, samples: 101626, litFraction: 0.277, min: 0, max: 249.1, contrast: 249.1, litSpan: { rows: 673, cols: 1012 } } }, floors);
  assert.equal(a, b, `the live-rpm shot line moved between two runs of the gate:\n  ${a}\n  ${b}`);
  for (const part of ['250.9', '249.1', '250.9 contrast', '27.6%', '27.7%', '672x1011', '673x1012'])
    assert.ok(!a.includes(part), `the live-rpm shot line prints the pose-dependent ${part}:\n  ${a}`);
  for (const part of ['1280x713', '101626'])
    assert.ok(a.includes(part), `the live-rpm shot line dropped the measured ${part}:\n  ${a}`);
  assert.ok(/at least 5% lit/.test(a) && /at least 1000 pixels sampled/.test(a),
    `the live-rpm shot line states no published floor, so it records a number no law can re-derive and no verdict either:\n  ${a}`);
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

test('the screenshot gate boots the OHV build through the address, not only the default', () => {
  const src = readFileSync('test/screenshots.mjs', 'utf8');
  // Rows A1-G5 ("... in DOHC and in OHV") and P1-G6 ("the OHV valvetrain in CUTAWAY and
  // EXPLODED") name a build this gate has never booted. Its CHECK string is pinned by
  // gate-sig=c5527127c3f7ff77, so the pass has to live in this same file and reach the
  // other build the way a reader does: the address.
  assert.ok(/query:\s*'\?variant=ohv'/.test(src), 'the gate never boots /?variant=ohv, so row P1-G6\'s OHV clause and row A1-G5\'s "in DOHC and in OHV" are ungated by its own CHECK');
  assert.ok(/standDatums\('ohv'\)/.test(src), 'the OHV pass never reads this build\'s own floor datum from src/engine/layout.js, so nothing measures what the OHV stand is built on');
  for (const f of ['14-ohv.png', '15-ohv-cutaway.png', '16-ohv-exploded.png'])
    assert.ok(src.includes(f), `the gate writes no ${f}: the OHV build is never pictured in CUTAWAY or EXPLODED`);
  // every OHV count has to come from the module that publishes it, never from a number
  // typed into the gate: a typed 16 would keep passing while the engine changed underneath
  // The calls have to sit in the block that READS the published lists. Measured by the
  // control driver: a poke that replaced ohvLifters().lifters with a typed array still
  // passed this law, because the same name also appears in the refusal message - a law
  // that searches the whole file gates nothing.
  const at = src.indexOf('const published = {');
  assert.ok(at > 0, 'the OHV pass has no single block where the published lists are read, so a count can be typed anywhere and no law sees it');
  const read = src.slice(at, src.indexOf('};', at));
  for (const [call, what] of [['ohvLifters(', 'the 16 lifters and their bores'], ['ohvCamLayout(', 'the central cam\'s journals, lobes and necks'], ['ohvLifterGallery(', 'the cast gallery ribs']])
    assert.ok(read.includes(call), `the OHV pass never calls ${call} where it reads the published lists, so ${what} is a typed number in the gate rather than a published one:\n  ${read}`);
});

test('the OHV pass prints its valvetrain census and names the valve and spring gap it measures', () => {
  const src = readFileSync('test/screenshots.mjs', 'utf8');
  // The pass measured 0 valves and 0 springs in the OHV build while
  // SPEC.variants.ohv.pendingHardware names only pushrods, rockers and covers. The gap
  // belongs in the record a reader can re-derive, not in a comment.
  assert.ok(/ohv valvetrain: /.test(src), 'the gate writes no OHV valvetrain census line');
  const census = (src.match(/console\.log\(`ohv valvetrain: [^\n]*/g) || []);
  assert.equal(census.length, 1, `the gate prints ${census.length} OHV census lines, expected one`);
  for (const field of ['lifters', 'gallery', 'journals', 'lobes', 'necks', 'valves', 'springs'])
    assert.ok(census[0].includes(`\${ohv.counts.${field}}`), `the OHV census does not count ${field}`);
  // Same control finding as the published-read block: the name also stands in a comment and
  // in the printed label, so a law that only searches for it passes even when the read is
  // gone (measured: the poke ohv-pending-not-read replaced the read with ([])) .
  assert.ok(/const pendingOhv = \(SPEC\.variants\.ohv\.pendingHardware \|\| \[\]\)\.map\(\(p\) => p\.family\);/.test(src), 'the OHV pass never reads the pending hardware families this build publishes into a variable the gap clause can check:');
  assert.ok(/ohv undeclared gap/.test(src), 'the gate does not name the valve and spring gap it measured');
  assert.ok(/pendingOhv\.some\(\(f\) => \/valve\|spring\/i\.test\(f\)\)/.test(src), 'the gap clause does not check the published pending list for a valve or spring family');
});

test('every OHV shot follows a pinned crank pose, never a wall clock', () => {
  const src = readFileSync('test/screenshots.mjs', 'utf8');
  const at = src.indexOf("query: '?variant=ohv'");
  assert.ok(at > 0, 'there is no OHV page to check');
  const block = src.slice(at);
  // Measured: the OHV home shot printed `lit 27.7%` in tmp/v8-8f3-shots3.out and
  // `lit 27.2%` in tmp/v8-8f3-shots4.out - every other line byte-identical - because the
  // capture followed sleep(1400) on a page measured at 1.6 fps. A wall clock is not a pose.
  for (const f of ['14-ohv.png', '15-ohv-cutaway.png', '16-ohv-exploded.png']) {
    const i = block.indexOf(`'${f}'`);
    assert.ok(i > 0, `no ${f} shot to check`);
    const before = block.slice(Math.max(0, i - 90), i);
    assert.ok(/await pin\(0\);/.test(before), `${f} is captured without a pinned pose right before it:\n  ${before.slice(-120)}`);
    assert.equal(/await sleep\(\d+\);/.test(before), false, `${f} follows a wall-clock sleep instead of a measured frame count:\n  ${before.slice(-120)}`);
  }
  assert.ok(/const takePin = /.test(src), 'the frame-count pin guard is not a shared helper, so the two builds can drift apart');
  // The count is not typed: it is the number of page blocks this gate opens, so a block
  // added later has to take the guard too (slice 8F-4 opens a third block for the spark
  // pictures; the law used to name "both builds" and could not see a third one).
  const pages = (src.match(/await withPage\(/g) || []).length;
  const pinned = (src.match(/const pin = takePin\(evalJs\);/g) || []).length;
  assert.equal(pinned, pages, `the frame-count pin guard is taken by ${pinned} of ${pages} page blocks: every block that captures a picture has to take it from the shared helper`);
});

// issue #43, measured on slice 8F-3's own re-derivation pair at 500d800:
//   tmp/v8-8f3-shots5.out  shot ohv-cutaway 1280x713 buffer, 101626 samples, lit 26.7%, luminance 0..245.4 contrast 245.4, lit span 666x795
//   tmp/v8-8f3-shots6.out  shot ohv-cutaway 1280x713 buffer, 101626 samples, lit 26.8%, luminance 0..245.4 contrast 245.4, lit span 666x795
// (2bcd9a5c255536dce24154bde1ed5034252fb543beafc24366e095ac0aac3ca0 against
//  f0f97549a3b337a382f68e4943fc5e9af0f98e4f20753c05474b3a2eeceb2781, diff = 2 lines). The
// frame-count pin from the previous commit fixed the assembled shot; the CUTAWAY shot still
// moved. The cause is in the product's own view code, read from src/ui/viewControls.js:
// line 296 builds the section from `cutawaySpecs({ lift: lift * fraction })` and line 525
// re-derives `plane.constant` from `lift * fraction`, while line 511-513 approach
// `fraction` to its goal one frame at a time (`fraction += (goal - fraction) * k`). So a
// section built or captured while the transition is still in flight stands at a height that
// depends on how much wall clock elapsed - a different cut of the casting, a different lit
// fraction, the same buffer and the same lit span.
test('a view transition is settled before a pinned capture, and a pinned capture follows no wall clock', () => {
  const src = readFileSync('test/screenshots.mjs', 'utf8');
  assert.ok(/const takeSettle = /.test(src), 'there is no shared settle guard: the gate waits for a stopwatch instead of for the view transition to reach its published goal');
  const pagesSettle = (src.match(/await withPage\(/g) || []).length;
  const settled = (src.match(/const settle = takeSettle\(evalJs\);/g) || []).length;
  assert.equal(settled, pagesSettle, `the settle guard is taken by ${settled} of ${pagesSettle} page blocks: every block that captures a picture has to wait for the view transition from the shared helper`);

  // 1. every capture of a pinned pose is preceded by a pin and by nothing measured in ms
  for (const m of src.matchAll(/await pin\((?:[^)]*)\);\n\s*shots\.[^\n]*= \{[^\n]*\('(\d[^']+\.png)'/g)) {
    const file = m[1];
    const before = src.slice(Math.max(0, m.index - 260), m.index);
    assert.equal(/await sleep\(\d+\);/.test(before), false, `${file} is captured after a wall-clock sleep inside the pinned window:\n  ${before.slice(-160)}`);
  }

  // 2. every CUTAWAY switch is followed by the settle guard before the next capture
  for (const m of src.matchAll(/cutaway\(true\)/g)) {
    const after = src.slice(m.index, m.index + 700);
    assert.ok(/await settle\(\)/.test(after), `a cutaway switch at offset ${m.index} captures without settling the view transition first, and src/ui/viewControls.js:296 builds the section from lift * fraction:\n  ${after.slice(0, 220)}`);
    const untilCapture = after.slice(0, after.indexOf("await shot(") > 0 ? after.indexOf("await shot(") : after.length);
    assert.equal(/await sleep\(\d+\);/.test(untilCapture), false, `a cutaway switch waits on a wall clock before its capture:\n  ${untilCapture.slice(0, 220)}`);
  }
});

// Row P1-G6 names "the spark visible in CUTAWAY at 1/10 and 1/50". Measured gap: this gate
// has plug MATERIAL laws (the GLOW_SPECS exemption above) and never calls setSlowmo with
// either factor, so no picture at those speeds exists and no law reads a plug flash out of a
// rendered frame. The authorities this law names are the product's own: src/render/plugs.js:102
// names the tip mesh plug-cyl{N}-flash, :93-94 clones its material per plug, :119-120 writes
// opacity = progress < 0 ? 0 : 1 - progress, src/main.js:280 feeds it state.theta and
// state.advance().total, src/engine/ignition.js:62 publishes the crank angle the spark fires at,
// src/engine/timing.js:92 publishes the burn window, and src/engine/animation.js:54-56 clamps
// slowmo to 0.02..1 - so 1/50 is the slowest picture this product can render, not a speed
// chosen here.
test('the screenshot gate pictures the spark in CUTAWAY at the two slowmo factors row P1-G6 names, and reads the flash from the timing module', () => {
  const src = readFileSync('test/screenshots.mjs', 'utf8');
  for (const f of ['1 / 10', '1 / 50'])
    assert.ok(src.includes(`setSlowmo(${f})`), `the gate never calls setSlowmo(${f}), so row P1-G6's clause "the spark visible in CUTAWAY at 1/10 and 1/50" has no picture behind it`);
  for (const f of ['17-cutaway-spark-10.png', '18-cutaway-spark-50.png', '19-cutaway-spark-off.png'])
    assert.ok(src.includes(f), `the gate writes no ${f}: the lit frame, the same pose at the clamp floor, or the same tip past its burn window is never pictured`);
  // Every clause below is scoped to the CALL SITE, not to the bare name. Measured on the
  // first control pass (tmp/8f4-controls.mjs): a clause that greps the file for a name which
  // also sits in a comment or in the gate's own refusal text stays green after the call is
  // deleted - the same class of dead gate this file already names for the OHV reads, and here
  // `GLOW_TIP = /^plug-cyl(\d+)-flash$/` in the older glow audit satisfied the tip-name clause
  // while the spark read itself was gone.
  assert.ok(/const SPARK_READ = /.test(src), 'there is no spark read: the flash is asserted in the gate rather than measured off the live tree');
  assert.ok(/TIP_NAME\.test\(t\.name\)/.test(src), 'the gate never checks the mesh it read against the name src/render/plugs.js:102 gives the tip glow (plug-cyl{N}-flash), so the read could come from any object');
  assert.ok(/opacity: o\.material\.opacity/.test(src), 'the gate never reads a glow opacity off the live material, so the flash is typed rather than measured (src/render/plugs.js:119-120 writes it there)');
  assert.ok(/theta: v\.state\.theta,/.test(src), 'the gate truncates the crank angle it reads, so the pose is compared against a burn window the gate itself rounded (measured: a 6-decimal theta of 609.485714 sits outside the window src/engine/timing.js opens at 720 - totalAdvance, and the gate refused its own lit frame)');
  assert.ok(/slowmo: v\.state\.slowmo,/.test(src), 'the gate never reads the page live slowmo factor, so the speed in the record is a number typed here rather than the factor the animation is really running at (src/engine/animation.js:54)');
  assert.ok(/const progress = firingProgress\(cyl, t\.theta, adv\);/.test(src), 'the gate does not take the burn window from src/engine/timing.js for the angle it read, so the progress it expects is typed here');
  assert.ok(/const sparkAt = sparkAngle\(sparkCyl, SPARK_RPM, SPARK_THROTTLE\);/.test(src), 'the gate does not take the spark instant from src/engine/ignition.js for the cylinder it pictures, so the pose is a typed crank angle');
  assert.ok(/const adv = totalAdvance\(SPARK_RPM, SPARK_THROTTLE\);/.test(src), 'the gate does not take the advance from src/engine/ignition.js, so the window it checks is a typed number');
  assert.ok(/v\.SPEC\.plug\.glowR \* \(h \/ 2\)/.test(src), 'the region the flash is measured in is not the published glow sphere projected through the page camera (SPEC.plug.glowR), so a pixel box was invented here');
  assert.ok(/plane\.distanceToPoint\(p\)/.test(src) && /t\.planeDist > 0/.test(src), 'the gate types which plugs the CUTAWAY section keeps instead of measuring it off the published plane, so it could picture a flash on a side the section removes');
  // Amended after measuring (tmp/spark-probe20.mjs -> tmp/spark-probe20.out): two renders of ONE
  // pinned pose at ONE speed already differ on 21 of 101626 sampled pixels (worst luminance
  // delta 35) and two renders at 1/50 differ on 82, so demanding one hash for both spark frames
  // is not a claim this product's rasteriser can be held to - this gate's own determinism law
  // compares against published floors (0.5% of samples, delta 60) for exactly that reason. The
  // claim row P1-G6 makes is about the flash, and the flash is measured bit-exact: disc 187.92
  // against ring 41.42 at 1/10 and the same numbers at 1/50 (tmp/v8-8f4-shots1.out).
  assert.ok(src.includes('shots.sparkSlow.pixels.diff'), 'the gate does not compare the 1/10 picture with the 1/50 picture sample to sample, so a flash that depends on the wall clock instead of the crank angle would pass');
  assert.ok(/compareLine\('spark pair 1\/10 vs 1\/50/.test(src), 'the spark pair is compared without a published floor to state, so the record would print counts a reviewer cannot re-derive (issue #43)');
  assert.ok(/Math\.abs\(lit\.disc\.mean - slow\.disc\.mean\)/.test(src), "the gate never requires the flash's measured light to be the same number at 1/10 as at 1/50, which is the crank-not-wall-clock claim row P1-G6 makes");
  // Same scoping for the three comparisons that make "visible", "decays" and "the flash
  // changed the picture" measurements. Measured in the loose control phase: deleting the
  // ring comparison stayed green because `lit.disc.mean > off.disc.mean` still matched
  // `\.disc\.mean > `, and deleting the lit-against-off comparison stayed green because the
  // 1/50-against-off line still spelled `off.disc.mean`.
  assert.ok(/lit\.disc\.mean > lit\.disc\.ringMean/.test(src), 'the gate never compares the lit tip against the ring of pixels around it, so "visible in CUTAWAY" is never measured');
  assert.ok(/lit\.disc\.mean > off\.disc\.mean/.test(src), 'the gate never compares the lit tip against the same tip past its burn window, so a glow that simply stands there lit would pass');
  assert.ok(/slow\.disc\.mean > off\.disc\.mean/.test(src), 'the gate never requires the flash to read at the clamp floor 1/50 as well as at 1/10, so a flash that only survives at one frame rate would pass');
  assert.ok(/shots\.sparkLit\.pixels\.hash === shots\.sparkOff\.pixels\.hash/.test(src), 'the gate never compares the lit picture with the picture past the burn window, so a flash that changes nothing on screen would pass');
});

// src/ui/viewControls.js:477-490: explode() frames the camera on explodedBounds(), and
// explodedBounds() (:440-462) unions worldBox(engine) with every member's live worldBox -
// the pistons, rods and valves stand where the crank angle puts them. So a camera framing
// taken from those bounds is a measurement of the pose the crank is at. Measured: the gate
// ran the engine at 1800 rpm for 10-running.png, stopped, and called explode() with no pin
// in between, which set the whole 11-exploded.png picture by the angle the animation
// happened to stop at - tmp/nc8f3b-restored-a.out printed `shot exploded ... lit 17.1%`
// against tmp/nc8f3b-restored-b.out `lit 17.0%`, same buffer, same samples, same luminance
// ceiling 0..242.9, same lit span 567x1077.
test('a view framing taken from live part boxes is computed at a pinned pose, not at the angle a live run left the crank at', () => {
  const src = readFileSync('test/screenshots.mjs', 'utf8');
  for (const m of src.matchAll(/window\.__v8\.explode\(\)/g)) {
    const at = src.lastIndexOf('await pin(', m.index);
    assert.ok(at > 0, `explode() at offset ${m.index} has no pinned pose anywhere before it`);
    const between = src.slice(at, m.index);
    assert.equal(/window\.__v8\.setRpm\(|window\.__v8\.start\(\)/.test(between), false,
      `explode() at offset ${m.index} frames the camera on explodedBounds() - live world boxes of the pistons, rods and valves - after the gate ran the animation again, so the framing is set by the angle a live run left the crank at:\n  ${between.slice(0, 400)}`);
  }
});
