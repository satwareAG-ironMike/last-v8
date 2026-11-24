// Ledger tooling contract (issue #8): a ledger row a committed tool cannot read is a
// claim nobody checks. Both tools here must see EVERY row GATES.md declares - the bare
// G<id> ids up to G7 and the phase-prefixed ids issue #8 names (P1-G1, A1-G9, P2-G5,
// A2-G5) - and both must run in a tree that carries none of the gitignored scratch
// dirs, which is what a fresh checkout and every CI runner look like.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const ROW_TITLE = /^- \[( |x)\] (\S+): /;
const SPAN_PARAGRAPH = /(G\d+(?:-G\d+)?) carry sigs written by an earlier runner/;

/** Row ids in file order, read off any GATES.md text (the live file or a damaged copy). */
const declaredIds = (text) => text.split('\n').filter((l) => ROW_TITLE.test(l)).map((l) => ROW_TITLE.exec(l)[2]);

/** The rows the RECIPE paragraph's exception span excuses, read off the given text. Matched
 *  by id NUMBER, not as text: "G10" is not greater than "G3" (same 'G', then '1' < '3'), so a
 *  text range on "G1-G3" excuses G10 through G19 as well in any ledger grown past G9.
 *  scripts/ledger-audit.mjs matched this span by number once the fix series started; this
 *  harness reader had the same defect and a grown ledger shows where the two disagree. */
const excusedBy = (text, span) => {
  const [lo, hi] = span.split('-').map((s) => Number(s.trim().slice(1)));
  return declaredIds(text).filter((id) => /^G\d+$/.test(id) && Number(id.slice(1)) >= lo && Number(id.slice(1)) <= hi);
};
const gates = readFileSync('GATES.md', 'utf8');
const titles = gates.split('\n').filter((l) => ROW_TITLE.test(l));
const ids = titles.map((l) => ROW_TITLE.exec(l)[2]);
const prefixed = ids.filter((id) => /^[A-Z][0-9]+-/.test(id));
const bare = ids.filter((id) => !/^[A-Z][0-9]+-/.test(id));

const python = spawnSync('python3', ['-c', 'pass']);
const HAS_PY = python.status === 0;

// A nested `node --test` must not inherit this runner's markers: with NODE_TEST_CONTEXT
// set, node prints "node:test run() is being called recursively within a test file.
// skipping running files." and records nothing at all, which would make the
// scripts/ledger-run.sh gate below measure an empty file instead of a run.
const runnerEnv = () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_TEST_WORKER_ID;
  return env;
};

/** Run scripts/ledger-audit.mjs in a scratch tree holding ONLY GATES.md + the tool:
 *  no tmp/, no shots/, no .git. That is the honest reproduction of "fresh checkout". */
const freshAudit = () => {
  const dir = mkdtempSync(join(tmpdir(), 'last-v8-ledger-'));
  cpSync('GATES.md', join(dir, 'GATES.md'));
  cpSync('scripts/ledger-audit.mjs', join(dir, 'scripts/ledger-audit.mjs'));
  const r = spawnSync(process.execPath, ['scripts/ledger-audit.mjs'], { cwd: dir, encoding: 'utf8' });
  return { dir, ...r };
};

test(`the ledger declares ${titles.length} gate rows (${bare.length} bare, ${prefixed.length} phase-prefixed)`, () => {
  // The measured starting point of issue #8: this file carried 15 rows G1..G7.
  assert.ok(bare.length >= 15, `expected the G1..G7 rows to still be here, found ${bare.length}`);
  assert.ok(prefixed.length >= 28, `expected issue #8's P1-/A1-/P2-/A2- rows, found ${prefixed.length}`);
  for (const id of ['P1-G1', 'P1-G9', 'A1-G1', 'A1-G9', 'P2-G1', 'A2-G5']) {
    assert.ok(ids.includes(id), `row ${id} is not declared in GATES.md`);
  }
  assert.equal(new Set(ids).size, ids.length, 'two gate rows share an id, so evidence cannot be attributed');
});

test('scripts/ledger-audit.mjs indexes every declared row and survives a tree with no scratch dirs', () => {
  const r = freshAudit();
  assert.equal(r.status, 0, `the audit crashed on a tree without tmp/ and shots/:\n${r.stderr.slice(-800)}`);
  const out = `${r.stdout}${r.stderr}`;

  const seen = out.match(/gate rows indexed: (\d+)/);
  assert.ok(seen, `the audit does not publish how many rows it indexed:\n${out.slice(0, 600)}`);
  assert.equal(Number(seen[1]), titles.length,
    `the audit indexes ${seen[1]} rows but GATES.md declares ${titles.length}: an unread row is an unchecked row`);

  // Independent measurement of the same two numbers off the ledger text itself, so the
  // audit's own totals are compared against the file and not against a second copy of a
  // constant: rows that declare a gate-sig, and rows the issues declare manual.
  const blocks = new Map();
  let cur = null;
  for (const line of gates.split('\n')) {
    const t = ROW_TITLE.exec(line);
    if (t) { cur = t[2]; blocks.set(cur, []); continue; }
    if (cur) blocks.get(cur).push(line);
  }
  const withSig = [...blocks].filter(([, b]) => b.some((l) => l.includes('gate-sig='))).map(([id]) => id);
  const manual = [...blocks].filter(([, b]) => !b.some((l) => l.startsWith('  CHECK: '))).map(([id]) => id);

  const recipe = out.match(/recipe check on G7 \(([0-9a-f]{16})\): (.*)/);
  assert.ok(recipe, `the audit does not report the recipe check:\n${out.slice(0, 600)}`);
  assert.match(recipe[2], /confirmed/, `the recipe check on G7 reports "${recipe[2]}" - a misread row attributes the wrong CHECK/EXPECT`);

  const count = out.match(/gate-sig recomputes: (\d+)\/(\d+) rows that declare one \(of (\d+) indexed rows\)/);
  assert.ok(count, `the audit does not report its gate-sig recompute coverage:\n${out.slice(0, 600)}`);
  assert.equal(Number(count[3]), titles.length, `indexed rows says ${count[3]}, the file declares ${titles.length}`);
  assert.equal(Number(count[2]), withSig.length, `rows declaring a gate-sig: audit says ${count[2]}, the file has ${withSig.length}`);
  // The only rows whose recorded sig the published recipe cannot reproduce are the three
  // the RECIPE paragraph at the head of this ledger declares as written by an earlier,
  // unrecorded runner. The exception list is read from that paragraph, not typed here, so
  // a fourth broken row cannot hide behind it.
  const named = gates.match(SPAN_PARAGRAPH);
  assert.ok(named, 'the ledger does not name the rows whose recorded sig predates the recipe');
  const documented = excusedBy(gates, named[1]);
  assert.ok(documented.length >= 3, `the ledger's exception span "${named[1]}" reads as ${documented.join(', ')}`);
  const unrec = [...out.matchAll(/NOT RECOMPUTABLE: (\S+)(?: recorded|:)/g)].map((m) => m[1]).sort();
  assert.deepEqual(unrec, [...documented].sort(), `rows the recipe cannot recompute beyond the documented ones: ${unrec.join(', ')}`);
  for (const id of withSig.filter((x) => !documented.includes(x))) {
    assert.ok(!unrec.includes(id), `the audit cannot recompute ${id}'s recorded gate-sig from the published recipe`);
  }

  const manualLine = out.match(/rows declared without an oracle \(manual evidence\): (\d+) - (.*)/);
  assert.ok(manualLine, `the audit does not name the rows it treats as manual:\n${out.slice(0, 600)}`);
  assert.equal(Number(manualLine[1]), manual.length, `audit calls ${manualLine[1]} rows manual, the file declares ${manual.length}`);
  assert.deepEqual(manualLine[2].split(', ').sort(), manual.sort(), `manual rows disagree: audit "${manualLine[2]}" vs file ${manual.join(', ')}`);
  for (const id of manual) {
    const b = blocks.get(id).join('\n');
    assert.match(b, /manual/i, `row ${id} carries no oracle but its evidence does not name the human act that closes it`);
  }
});

test('scripts/ledger-run.sh records a gate run so its hash is re-derivable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'last-v8-ledger-run-'));
  const log = join(dir, 'run.out');
  const noisy = join(dir, 'noisy.mjs');
  // A stand-in for `node --test`: two passing tests, each stamped with a wall-clock
  // duration, plus the run total. Only the digits differ between two invocations.
  writeFileSync(noisy, "import test from 'node:test';\ntest('a', () => {});\ntest('b', () => {});\n");
  // The reporter is named out loud, not left to node's default: node 22 (the CI runner)
  // defaults to TAP and node 24 (this workstation) defaults to spec, so a record made by a
  // bare `node --test` hashes differently per node version. Measured on CI run 43917583366,
  // where exactly this made the recorded gate fail on its own record.
  const first = spawnSync('bash', ['scripts/ledger-run.sh', log, process.execPath, '--test', '--test-reporter=spec', noisy], { encoding: 'utf8', env: runnerEnv() });
  assert.equal(first.status, 0, `ledger-run.sh did not pass the recorded command's exit code through:\n${first.stderr}`);
  const text = readFileSync(log, 'utf8');
  assert.match(text, /^✔ a$/m, 'the record lost a passing test line');
  assert.match(text, /^ℹ pass 2$/m, "the record lost node's own summary");
  assert.ok(!/\([0-9.]+ms\)$/.test(text), 'the record still carries per-test wall-clock durations, so its hash cannot be re-derived');
  assert.ok(!/^ℹ duration_ms/m.test(text), 'the record still carries the run total, so its hash cannot be re-derived');
  assert.match(text, /^RECORD: command=.* exit=0 tests=2 pass=2 fail=0$/m, `the record does not name its own command, exit and counts:\n${text}`);

  const hashOf = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
  const second = join(dir, 'run2.out');
  spawnSync('bash', ['scripts/ledger-run.sh', second, process.execPath, '--test', '--test-reporter=spec', noisy], { encoding: 'utf8', env: runnerEnv() });
  assert.equal(hashOf(log), hashOf(second), 'two runs of the same CHECK hashed differently: the record is a stopwatch, not a measurement');

  // Cross-version re-derivability: the same CHECK recorded through node's TAP reporter -
  // what node 22 prints on the CI runner - must normalize to the same record. This is the
  // RED control CI already paid for: the first version of the recorder only stripped the
  // spec shape, so a CI-made record kept `duration_ms:` lines and hashed per run.
  const tap = join(dir, 'run-tap.out');
  const tapRun = spawnSync('bash', ['scripts/ledger-run.sh', tap, process.execPath, '--test', '--test-reporter=tap', noisy], { encoding: 'utf8', env: runnerEnv() });
  assert.equal(tapRun.status, 0, `the TAP-shaped run failed to record:\n${tapRun.stderr}`);
  const tapText = readFileSync(tap, 'utf8');
  assert.ok(!/duration_ms/.test(tapText), 'a TAP-shaped record kept node duration_ms lines, so its hash cannot be re-derived');
  assert.match(tapText, /^ok 1 - a$/m, 'the TAP-shaped record lost its test lines');
  assert.match(tapText, /^RECORD: command=.* exit=0 tests=2 pass=2 fail=0$/m, `the TAP-shaped record did not read node's own counts:\n${tapText}`);

  // The point of the tool: a failing gate must fail the tool, and must be recorded anyway.
  const bad = join(dir, 'bad.out');
  const r = spawnSync('bash', ['scripts/ledger-run.sh', bad, process.execPath, '-e', 'console.error("boom"); process.exit(3)'], { encoding: 'utf8', env: runnerEnv() });
  assert.equal(r.status, 3, 'ledger-run.sh swallowed the gate run\'s failure');
  assert.match(readFileSync(bad, 'utf8'), /RECORD: command=.* exit=3/, 'a failed run was recorded without its exit code');
  assert.ok(!existsSync(`${log}.raw`), 'the unnormalised scratch copy was left behind next to the record');
});

// --- scripts/ledger-run.sh and the package.json its npm guard reads (PR #10 review finding 13)
// Measured first: `npm test` resolves its script from the nearest package.json AT or ABOVE its
// cwd - run in an empty subdirectory of a tree whose package.json names the script, it runs
// that script and exits 0 - and it does NOT walk past a package.json that has no test script
// (measured: it stops there and reports "Missing script: test"). The recorder's guard asked
// the CWD for package.json, so in that same subdirectory it saw no reporter, pinned its own,
// and node then refused the reporter twice:
//   TypeError [ERR_INVALID_ARG_VALUE]: The argument '--test-reporter' must match the number of
//   specified '--test-reporter-destination'. Received [ 'spec', 'spec' ]
// with the recorder exiting 1 on a run that never started, its record carrying no counts at all.
const HAS_NPM = spawnSync('npm', ['--version'], { encoding: 'utf8' }).status === 0;

/** A tree whose root package.json names one test script, with an empty sub/ standing for the
 *  directory a reviewer or a CI step happens to invoke the recorder from. */
const npmRunTree = (rootScript, subPackage) => {
  const dir = mkdtempSync(join(tmpdir(), 'last-v8-run-cwd-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'rundir', private: true, type: 'module', scripts: { test: rootScript } }));
  writeFileSync(join(dir, 'g.test.mjs'), "import test from 'node:test';\ntest('a', () => {});\ntest('b', () => {});\n");
  const sub = join(dir, 'sub');
  mkdirSync(sub, { recursive: true });
  if (subPackage) writeFileSync(join(sub, 'package.json'), JSON.stringify(subPackage));
  return { dir, sub };
};

/** Record `npm test` from the subdirectory, which is what the guard has to survive. */
const recordFromSub = (tree, name) => {
  const rec = spawnSync('bash', [resolve('scripts/ledger-run.sh'), join(tree.dir, name), 'npm', 'test'], {
    cwd: tree.sub, encoding: 'utf8', env: runnerEnv(),
  });
  const body = existsSync(join(tree.dir, name)) ? readFileSync(join(tree.dir, name), 'utf8') : '';
  return { status: rec.status, out: `${rec.stdout}${rec.stderr}`, body };
};

test('scripts/ledger-run.sh reads the package.json the recorded npm run really uses, not the one in cwd', { skip: !HAS_NPM }, () => {
  const tree = npmRunTree('node --test --test-reporter=spec g.test.mjs');
  const r = recordFromSub(tree, 'spec-from-sub.out');
  assert.ok(!/ERR_INVALID_ARG_VALUE/.test(r.out),
    'the recorder pinned its own reporter because the cwd carried no package.json, while npm ran a\n' +
    `script that already names one, and node refused it twice:\n${r.out.slice(-700)}`);
  assert.equal(r.status, 0, `recording \`npm test\` from a subdirectory of the tree that names the script exited ` +
    `${r.status}, so a gate run made that way cannot be recorded at all:\n${r.out.slice(-700)}`);
  assert.match(r.body, /^RECORD: command=npm test exit=0 tests=2 pass=2 fail=0$/m,
    `the record of that run carries no counts, so it proves nothing about the run it names:\n${r.body}`);
  assert.match(r.body, /^ℹ pass 2$/m, 'the recorded run is not in the pinned spec shape');
});

test('scripts/ledger-run.sh: an outer script naming TAP is recorded as TAP from a subdirectory, not double-pinned', { skip: !HAS_NPM }, () => {
  // The same defect with the other reporter: reading the cwd instead of the resolved file
  // would pin spec on top of a script that names tap, and the recorded shape - which the
  // row's hash depends on - would be whatever survived, not what the run printed.
  const tree = npmRunTree('node --test --test-reporter=tap g.test.mjs');
  const r = recordFromSub(tree, 'tap-from-sub.out');
  assert.equal(r.status, 0, `the TAP-naming script recorded from a subdirectory exited ${r.status}:\n${r.out.slice(-700)}`);
  assert.match(r.body, /^ok 1 - a$/m, `the run npm resolved is a TAP run, but the record is not shaped like one:\n${r.body}`);
  assert.ok(!/^✔ /m.test(r.body), `the recorder pinned its own reporter over an explicit tap one:\n${r.body}`);
  assert.match(r.body, /^RECORD: command=npm test exit=0 tests=2 pass=2 fail=0$/m, `the TAP record lost its counts:\n${r.body}`);
});

test('scripts/ledger-run.sh does not read past the package.json npm stops at: a nested one naming no reporter still gets the pin', { skip: !HAS_NPM }, () => {
  const tree = npmRunTree('node --test --test-reporter=tap g.test.mjs', { name: 'inner', private: true, type: 'module', scripts: { test: 'node --test g.test.mjs' } });
  writeFileSync(join(tree.sub, 'g.test.mjs'), "import test from 'node:test';\ntest('a', () => {});\ntest('b', () => {});\ntest('c', () => {});\n");
  const r = recordFromSub(tree, 'nested.out');
  assert.equal(r.status, 0, `the nested run exited ${r.status}:\n${r.out.slice(-500)}`);
  // The resolved script names NO reporter, so the pin must apply: the record is spec-shaped,
  // and it counts the nested tree's three tests, not the outer two.
  assert.match(r.body, /^ℹ pass 3$/m, `the outer package.json's reporter was read for a run npm resolved \ninside the nested tree:\n${r.body}`);
  assert.match(r.body, /^RECORD: command=npm test exit=0 tests=3 pass=3 fail=0$/m, `the nested record lost its counts:\n${r.body}`);
});

test('scripts/ledger-name-evidence.py --prove runs without the gitignored scratch files and sees every row', { skip: !HAS_PY }, () => {
  const r = spawnSync('python3', ['scripts/ledger-name-evidence.py', '--prove'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `--prove aborted because a scratch file from an earlier tree is absent:\n${r.stderr.slice(-800)}`);
  const out = `${r.stdout}${r.stderr}`;
  assert.match(out, /PROOF OK/, `--prove did not report PROOF OK:\n${out.slice(0, 800)}`);
  const seen = out.match(/working GATES\.md: (\d+) gate rows/);
  assert.ok(seen, `--prove does not report how many rows it read:\n${out.slice(0, 600)}`);
  assert.equal(Number(seen[1]), titles.length,
    `--prove reads ${seen[1]} rows but GATES.md declares ${titles.length}: the phase-prefixed rows are invisible to it`);
  assert.match(out, /rows added since the base: \[[^\]]*'P1-G1'/, 'the proof does not list issue #8 rows as added since its base');
});

test('scripts/branch-gate.sh is the committed oracle of row P1-G1 and reads every setting that row names', () => {
  const sh = readFileSync('scripts/branch-gate.sh', 'utf8');
  const r = spawnSync('bash', ['-n', 'scripts/branch-gate.sh'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `the oracle of row P1-G1 does not parse:\n${r.stderr}`);
  // Every word the P1-G1 EXPECT names must be read by the tool that closes the row,
  // including the two GitHub calls that measure "no force push" and "no delete".
  for (const need of ['is-ancestor', 'branches/$branch', 'protection/required_status_checks',
    'protection/required_pull_request_reviews', 'allow_force_pushes', 'allow_deletions',
    'rulesets', 'non_fast_forward', 'deletion', 'bypass_actors']) {
    assert.ok(sh.includes(need), `scripts/branch-gate.sh never reads ${need}, so row P1-G1's EXPECT is not what the tool measures`);
  }
  // A ruleset LIST endpoint is a summary (conditions null, rules absent), so the tool
  // must read each ruleset object; the row's no-force-push claim lives in those rules.
  assert.match(sh, /rulesets\/\$id|rulesets\/\$\{id\}/, 'the tool filters the ruleset list instead of reading each ruleset object, where the rules actually live');
  assert.match(sh, /PROTECTION OK|PROTECTION GATE FAILED/, 'the tool does not publish its own verdict, so its run record would be a transcript instead of an oracle');
});

test('both tools read the same gate-id grammar (the row-id authority is the ledger, not a regex)', () => {
  const audit = readFileSync('scripts/ledger-audit.mjs', 'utf8');
  const prove = readFileSync('scripts/ledger-name-evidence.py', 'utf8');
  const grammar = /\(\?:\[A-Z\]\[0-9\]\+-\)\?G\[0-9a-z\]\+/;
  assert.ok(audit.match(grammar), 'scripts/ledger-audit.mjs does not carry the phase-prefixed row grammar');
  assert.ok(prove.match(grammar), 'scripts/ledger-name-evidence.py does not carry the phase-prefixed row grammar');
  assert.match(audit, /a row either tool cannot read|either tool/i,
    'the audit does not say why the id grammar is shared with the other tool');
});

// --- the audit's own failure path (PR #10 review finding 7) --------------------------------
// scripts/ledger-audit.mjs carried no process.exit, exitCode or throw anywhere, so every
// defect it printed was a count and the run still exited 0. These controls damage a COPY of
// this ledger in four named ways and require the tool to refuse each one. Cite-RESOLUTION
// stays reported-only on purpose: tmp/ and shots/ are gitignored, so a fresh checkout and
// every CI runner carry rows whose hashes cannot resolve (the four the RECIPE paragraph
// names as written before the tool existed), and hard-failing there is permanent red no
// commit can fix. What this tool can prove from the ledger text alone, in any tree, is what
// it must now refuse.
const damagedAudit = (mutate) => {
  const dir = mkdtempSync(join(tmpdir(), 'last-v8-ledger-damage-'));
  writeFileSync(join(dir, 'GATES.md'), mutate(gates));
  cpSync('scripts/ledger-audit.mjs', join(dir, 'scripts/ledger-audit.mjs'));
  const r = spawnSync(process.execPath, ['scripts/ledger-audit.mjs'], { cwd: dir, encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};

/** Edit one line inside one row's own block; nothing else in the copy moves. */
const editRow = (text, id, fn) => {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => ROW_TITLE.test(l) && ROW_TITLE.exec(l)[2] === id);
  assert.ok(at >= 0, `row ${id} is not declared in GATES.md`);
  const block = lines.slice(at + 1).findIndex((l) => ROW_TITLE.test(l));
  const end = block === -1 ? lines.length : at + 1 + block;
  fn(lines, at, end);
  return lines.join('\n');
};

test('the audit refuses a gate-sig that no longer recomputes and is not in the declared exception', () => {
  const r = damagedAudit((text) => editRow(text, 'P1-G5', (lines, at, end) => {
    for (let i = at + 1; i < end; i++) {
      if (lines[i].startsWith('  CHECK: ')) {
        lines[i] = `${lines[i]} --test-reporter=tap`;
        return;
      }
    }
    assert.fail(`row P1-G5 carries no CHECK line to damage`);
  }));
  assert.match(r.out, /P1-G5 recorded e366d4743b4be898 recomputed [0-9a-f]{16}/,
    `the audit did not name the sig it cannot recompute:\n${r.out.slice(0, 700)}`);
  assert.equal(r.status, 1, `a CHECK edit that breaks a recorded gate-sig still exited ${r.status}; ` +
    `the audit's green exit would prove nothing about the ledger:\n${r.out.slice(0, 700)}`);
  assert.match(r.out, /LEDGER AUDIT FAILED/, 'the audit prints counts but no verdict of its own');
});

test('the audit refuses a row id that is outside the published row grammar', () => {
  const r = damagedAudit((text) => `${text}\n- [ ] Z9-G99: a row neither committed tool can read\n` +
    `  CHECK: node --test test/zz.test.mjs\n  EXPECT: fail 0\n  EVIDENCE: pending\n`);
  assert.equal(r.status, 1, `an out-of-grammar row id still exited ${r.status}: its CHECK/EXPECT would ` +
    `be attributed to the previous row and both tools would report them as that row's:\n${r.out.slice(0, 700)}`);
  assert.match(r.out, /Z9-G99/, `the audit does not name the id it walked past:\n${r.out.slice(0, 700)}`);
});

test('the audit refuses two rows sharing one gate id', () => {
  const r = damagedAudit((text) => editRow(text, 'P1-G6', (lines, at) => {
    lines.splice(at, 0, lines[at].replace(/: .*/, ': a second row claiming the same id'));
  }));
  assert.equal(r.status, 1, `two rows sharing the id P1-G6 still exited ${r.status}, so evidence could ` +
    `not be attributed to a row:\n${r.out.slice(0, 700)}`);
  assert.match(r.out, /P1-G6/, `the duplicate id is not named:\n${r.out.slice(0, 700)}`);
});

// The damage here cannot assume the live row is uncited. It used to be true: P1-G5 was the
// ledger's example of an open row with nothing behind it, and the control only had to flip
// the box. Row P1-G5 has since been filled with the recorded runs that close its plug half,
// so flipping the box alone produced a row that DOES name runs, the audit correctly stayed
// silent, and this control turned red against a healthy ledger (tmp/v8-c11-suite4.out,
// tests 139 pass 138 fail 1). The damage is therefore the claim itself: close the box and
// delete every run citation in the row, which is exactly the defect the rule names - a
// checkmark resting on prose - and it no longer depends on which rows happen to be filled.
// Same citation grammar as scripts/ledger-audit.mjs and scripts/ledger-name-evidence.py:
// the labelled spellings and the bare `sha256=` (issue #13). This reader strips citations to
// damage a row, so it must see exactly what the audit sees or the damage is not the defect.
const CITED = /(?:tmp|shots)\/[\w./-]+?\.(?:out|png|sh|html|js|mjs)\b|(?:output-sha256|output|driver|sha256)=[0-9a-f]{64}/g;

test('the audit refuses a closed row that names no recorded run output', () => {
  const r = damagedAudit((text) => editRow(text, 'P1-G5', (lines, at, end) => {
    assert.match(lines[at], /^- \[ \] /, `row P1-G5 is not an open row to close in the copy`);
    // `.match` and not `.test` with a /g pattern: a global regex keeps lastIndex, and a
    // stateful test would report "still cited" on a line that names nothing.
    for (let i = at + 1; i < end; i++) lines[i] = lines[i].replace(CITED, '');
    const left = lines.slice(at + 1, end).filter((l) => l.match(CITED));
    assert.equal(left.length, 0, `the damaged copy still names a run output in P1-G5 ` +
      `(${left[0] && left[0].slice(0, 120)}), so closing the box there is not the defect ` +
      `this control claims to test`);
    lines[at] = lines[at].replace(/^- \[ \] /, '- [x] ');
  }));
  assert.equal(r.status, 1, `P1-G5 reads closed with every run citation stripped and the audit ` +
    `still exited ${r.status}:\n${r.out.slice(0, 700)}`);
  assert.match(r.out, /P1-G5/, `the closed row with no recorded run is not named:\n${r.out.slice(0, 700)}`);
  assert.match(r.out, /P1-G5: the box reads \[x\] while the row names no recorded run output/,
    `the audit exited 1 but not for the rule this control damages (it must refuse a checkmark ` +
    `resting on prose, not trip on some other defect):\n${r.out.slice(0, 700)}`);
});

test('the clean ledger passes every one of those four checks, so the failure path is not self-inflicted', () => {
  const r = damagedAudit((text) => text);
  assert.equal(r.status, 0, `the refusal path fires against this repo's own ledger:\n${r.out.slice(0, 900)}`);
  assert.match(r.out, /LEDGER AUDIT OK/, 'the audit publishes no verdict for a ledger it accepts');
});

// --- the citation spelling a row may use (issue #13) --------------------------------------
// scripts/ledger-audit.mjs:121 extracted a cited hash only when it was labelled
// `output=`, `driver=` or `output-sha256=`. This ledger also cites hashes bare, as
// `shots/07-home.png sha256=<64 hex>`, and the tool never extracted those at all: measured
// against this file, 107 of its 64-hex citations sit on lines the audit's claim grammar
// reads, 100 of them readable and 7 invisible (tmp/v8-c13-grammar.out). Two consequences,
// both measured here instead of asserted: a pinned picture written the bare way can age out
// of agreement with disk in total silence (row G7's two superseded screenshot generations
// are exactly that), and a row that DOES name its recorded run the bare way trips the
// closed-box rule as if it named nothing.
//
// The control runs a synthetic tree: a synthetic ledger plus the scratch files it cites.
// A synthetic ledger is the only honest way to measure this, because the real rows' bare
// citations name files that are gitignored and therefore absent from a fresh checkout and
// from every CI runner - their absence would be indistinguishable from the blindness.
const shaOf = (s) => createHash('sha256').update(s).digest('hex');
const SYNTH_FILES = { 'tmp/one.out': 'run one\n', 'shots/two.png': 'picture two\n' };
const SYNTH_HEX = Object.fromEntries(Object.entries(SYNTH_FILES).map(([p, body]) => [p, shaOf(body)]));

/** A scratch tree holding one synthetic open row per row text, plus the files it cites.
 *  No CHECK/EXPECT on those rows: they cite evidence, they declare no oracle, so the only
 *  variable left is the spelling of the citation itself. */
const synthAudit = (rows) => {
  const dir = mkdtempSync(join(tmpdir(), 'last-v8-cite-'));
  const check = 'node --test test/synthetic-anchor.test.mjs';
  const expect = 'fail 0';
  writeFileSync(join(dir, 'GATES.md'),
    `- [ ] G7: the synthetic anchor row the audit runs its recipe check on\n  CHECK: ${check}\n  EXPECT: ${expect}\n` +
    `  EVIDENCE: gate-sig=${shaOf(`${check}\n${expect}`).slice(0, 16)}\n${rows}`);
  for (const [name, body] of Object.entries(SYNTH_FILES)) {
    const p = join(dir, name);
    mkdirSync(join(dir, dirname(name)), { recursive: true });
    writeFileSync(p, body);
  }
  cpSync('scripts/ledger-audit.mjs', join(dir, 'scripts/ledger-audit.mjs'));
  const r = spawnSync(process.execPath, ['scripts/ledger-audit.mjs'], { cwd: dir, encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};
const synthResolved = (out) => Number((out.match(/cited output hashes resolved to a file the row names: (\d+)/) || [])[1]);
const rowCites = (id, path, label, hex) => `- [ ] ${id}: a synthetic row citing ${path} as ${label}=\n  EVIDENCE: ${path} ${label}=${hex}\n`;

test('every citation spelling this ledger writes is readable: the audit resolves all three', () => {
  const rows = [
    rowCites('P1-G90', 'tmp/one.out', 'output-sha256', SYNTH_HEX['tmp/one.out']),
    rowCites('P1-G91', 'tmp/one.out', 'sha256', SYNTH_HEX['tmp/one.out']),
    rowCites('P1-G92', 'shots/two.png', 'sha256', SYNTH_HEX['shots/two.png']),
  ].join('');
  const r = synthAudit(rows);
  const want = 3;
  assert.equal(synthResolved(r.out), want,
    `the audit resolved ${synthResolved(r.out)} of ${want} citations that name a file the row names and whose ` +
    `content hashes to exactly the cited value (${Object.entries(SYNTH_HEX).map(([p, h]) => `${p} ${h.slice(0, 12)}...`).join(', ')}); ` +
    `a citation the extractor cannot read is a citation nobody checks:\n${r.out.slice(0, 900)}`);
  const bad = (r.out.match(/CITE PROBLEM: P1-G9\d/g) || []);
  assert.equal(bad.length, 0, `the audit reports these synthetic citations as problems while naming the very file ` +
    `they cite and while that file hashes to the cited value: ${bad.join(', ')}\n${r.out.slice(0, 900)}`);
  assert.equal(r.status, 0, `a ledger whose every citation resolves still exited ${r.status}:\n${r.out.slice(0, 900)}`);
});

// The defect issue #13 was filed from: a pinned picture whose file on disk no longer matches
// the pinned hash. Arm 1 spells the stale citation the readable way (the tool already caught
// that, which is what makes arm 2 a measurement and not an assumption); arm 2 spells the
// identical stale citation the bare way the ledger's shot-identity paragraphs use.
test('a stale citation is named as a problem in either spelling, so a pinned picture cannot age out silently', () => {
  const stale = shaOf('a picture this ledger pinned at an older geometry\n');
  const readable = synthAudit(rowCites('P1-G93', 'shots/two.png', 'output-sha256', stale));
  assert.match(readable.out, /CITE PROBLEM: P1-G93: hash [0-9a-f]{16}\.\.\. matches no scratch file on disk/,
    `the readable arm of this control no longer reports a stale citation, so the bare arm below proves ` +
    `nothing about the tool and only about my pattern:\n${readable.out.slice(0, 700)}`);

  const bare = synthAudit(rowCites('P1-G94', 'shots/two.png', 'sha256', stale));
  assert.match(bare.out, /CITE PROBLEM: P1-G94: hash [0-9a-f]{16}\.\.\. matches no scratch file on disk/,
    `a citation of ${stale.slice(0, 16)}... against shots/two.png, which hashes ${SYNTH_HEX['shots/two.png'].slice(0, 16)}... ` +
    `instead, spelled \`sha256=\` instead of \`output-sha256=\`, is invisible to the audit: the two arms are the same ` +
    `defect and only one of them is reported. That is row G7's superseded screenshot identity today - its six ` +
    `pinned hashes are written this way and none of them match the files on disk any more:\n${bare.out.slice(0, 700)}`);
});

// The refusal side of the same gap: a closed row that really does name its recorded run,
// written the bare way, is refused as naming nothing.
test('a closed row citing its recorded run in the bare spelling is not refused as uncited', () => {
  const dir = mkdtempSync(join(tmpdir(), 'last-v8-cite-closed-'));
  const rows = `- [x] P1-G95: a synthetic closed row whose only run citation is spelled bare\n  CHECK: node --test test/synthetic.test.mjs\n  EXPECT: fail 0\n  EVIDENCE: tmp/one.out sha256=${SYNTH_HEX['tmp/one.out']}, gate-sig=${shaOf('node --test test/synthetic.test.mjs\nfail 0').slice(0, 16)}\n`;
  const check = 'node --test test/synthetic-anchor.test.mjs';
  writeFileSync(join(dir, 'GATES.md'),
    `- [ ] G7: the synthetic anchor row the audit runs its recipe check on\n  CHECK: ${check}\n  EXPECT: fail 0\n` +
    `  EVIDENCE: gate-sig=${shaOf(`${check}\nfail 0`).slice(0, 16)}\n${rows}`);
  mkdirSync(join(dir, 'tmp'), { recursive: true });
  writeFileSync(join(dir, 'tmp/one.out'), SYNTH_FILES['tmp/one.out']);
  cpSync('scripts/ledger-audit.mjs', join(dir, 'scripts/ledger-audit.mjs'));
  const r = spawnSync(process.execPath, ['scripts/ledger-audit.mjs'], { cwd: dir, encoding: 'utf8' });
  const out = `${r.stdout}${r.stderr}`;
  assert.ok(!/P1-G95: the box reads \[x\] while the row names no recorded run output/.test(out),
    `the audit calls a closed row uncited although the row names tmp/one.out and that file hashes to the ` +
    `cited ${SYNTH_HEX['tmp/one.out'].slice(0, 16)}... - the spelling is what the tool refuses, not the ` +
    `missing evidence:\n${out.slice(0, 900)}`);
  assert.equal(r.status, 0, `a properly evidenced closed row exited ${r.status}:\n${out.slice(0, 900)}`);
});

// One citation grammar across the tools that READ citations out of this ledger, measured the
// way the row-id grammar above is measured: the same alternation in each, so a row cannot
// become checkable in one tool and invisible in another. scripts/ledger-fill-g6.py is
// deliberately not in this list: it is a WRITER, it names the file before every hash it
// emits, it validates each one against disk, and its committed form is cited by the closed
// row G6 - a stricter grammar there is not a gap, and moving that file would move a hash a
// closed row already recorded. Row P1-G10 states the same scoping in the ledger.
const CITE_ALTERNATION = /\(\?:output-sha256\|output\|driver\|sha256\)=/;
test('every tool that reads citations out of the ledger, and this file, share one citation grammar', () => {
  for (const f of ['scripts/ledger-audit.mjs', 'scripts/ledger-name-evidence.py']) {
    assert.ok(readFileSync(f, 'utf8').match(CITE_ALTERNATION), `${f} reads citations without the shared spelling grammar`);
  }
  const writer = readFileSync('scripts/ledger-fill-g6.py', 'utf8');
  assert.ok(!writer.match(CITE_ALTERNATION),
    'the writer script was widened to the reader grammar: its committed form is cited by the closed row G6, so the ' +
    'shared-grammar law must not drag a closed row\'s recorded hash out of agreement with the file it names');
  assert.match(writer, /\) \+output-sha256=\(\[0-9a-f\]\+\)/,
    'scripts/ledger-fill-g6.py no longer requires a named file in front of the hash it writes, which is the ' +
    'stricter writer-side rule this scoping depends on');
  assert.ok(CITED.source.includes('output-sha256'), "this file's own citation reader lost the readable spelling");
  const bare = 'tmp/x.out sha256=' + 'a'.repeat(64);
  assert.ok(bare.match(CITED), `this file's citation reader does not match the bare spelling it claims to share:\n${CITED.source}`);
});

// --- issue #15: citations that name what a fresh checkout actually carries ------------------
// scripts/ledger-audit.mjs indexed only tmp/ and shots/ (its walk), and its name grammar knew
// only those two gitignored directories. Both measurements in issue #15 come from that: a
// 16-hex pin of a committed source file (row G6 cites scripts/ledger-fill-g6.py
// output-sha256=88128e08...) is invisible in every tree, a `git show <commit>:<path>` pin -
// this ledger's spelling for "the committed form of that tool" - is answered by the wrong file
// or by nothing, and in a git archive of this repo (every CI runner, every reviewer) the audit
// resolved 0 citations and reported 293 problems (tmp/v8-c15-fresh-rec.out). These laws run
// against a synthetic GIT tree, because "what a fresh checkout carries" is only measurable in
// a tree that knows what it tracks.
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
const GIT_USER = ['-c', 'user.name=ledger-synthetic', '-c', 'user.email=ledger@synthetic.invalid'];
const SYNTH_TRACKED = { 'src/cited.js': 'the tracked source a row pins\n', 'src/later.js': 'the committed form before it moved\n' };
const SYNTH_MOVED = 'the same file after a second commit moved it\n';
const HEX_CITED = shaOf(SYNTH_TRACKED['src/cited.js']);
const HEX_LATER1 = shaOf(SYNTH_TRACKED['src/later.js']);
const HEX_MOVED = shaOf(SYNTH_MOVED);

/** A synthetic git tree: two tracked commits, the second moving one pinned file, then the
 *  same synthetic-row run as synthAudit. @C1@ inside the rows is replaced with the first
 *  commit's id, so a row can name a commit that exists without anyone typing it. */
const synthGitAudit = (rows) => {
  const dir = mkdtempSync(join(tmpdir(), 'last-v8-cite-git-'));
  const put = (p, body) => { const f = join(dir, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, body); };
  const git = (...a) => spawnSync('git', ['-c', 'commit.gpgsign=false', ...a], { cwd: dir, encoding: 'utf8', env: GIT_ENV });
  put('src/cited.js', SYNTH_TRACKED['src/cited.js']);
  put('src/later.js', SYNTH_TRACKED['src/later.js']);
  git('init', '-q');
  git('add', '-A');
  git(...GIT_USER, 'commit', '-q', '-m', 'pinned forms');
  const c1 = git('rev-parse', 'HEAD').stdout.trim();
  put('src/later.js', SYNTH_MOVED);
  git('add', '-A');
  git(...GIT_USER, 'commit', '-q', '-m', 'the pinned file moved');
  const check = 'node --test test/synthetic-anchor.test.mjs';
  const expect = 'fail 0';
  put('GATES.md', `- [ ] G7: the synthetic anchor row the audit runs its recipe check on\n  CHECK: ${check}\n  EXPECT: ${expect}\n` +
    `  EVIDENCE: gate-sig=${shaOf(`${check}\n${expect}`).slice(0, 16)}\n${rows.replace(/@C1@/g, c1)}`);
  put('scripts/ledger-audit.mjs', readFileSync('scripts/ledger-audit.mjs', 'utf8'));
  const r = spawnSync(process.execPath, ['scripts/ledger-audit.mjs'], { cwd: dir, encoding: 'utf8', env: GIT_ENV });
  return { status: r.status, out: `${r.stdout}${r.stderr}`, c1 };
};
const citeProblems = (out, id) => out.split('\n').filter((l) => l.trim().startsWith(`CITE PROBLEM: ${id}:`));

test('a sound citation of a tracked file resolves, so a reviewer in a plain checkout can check it (issue #15)', () => {
  const r = synthGitAudit(`- [ ] P1-G80: a row citing a tracked file's content\n  EVIDENCE: src/cited.js output-sha256=${HEX_CITED}\n`);
  assert.equal(citeProblems(r.out, 'P1-G80').length, 0,
    `the row names src/cited.js, this tree carries it, its content hashes to exactly the cited value, and the ` +
    `audit still reports a problem: its index walks only tmp/ and shots/ and its name grammar knows only those ` +
    `gitignored dirs, so a citation a reviewer CAN check is answered as one nobody can (issue #15):\n` +
    `${citeProblems(r.out, 'P1-G80').join('\n')}\n${r.out.slice(0, 500)}`);
  assert.equal(synthResolved(r.out), 1,
    `the audit resolved ${synthResolved(r.out)} of 1 citations that name a tracked file whose content hashes to ` +
    `the cited value:\n${r.out.slice(0, 500)}`);
  assert.equal(r.status, 0, `a ledger whose only citation names a tracked file's real content exited ${r.status}:\n${r.out.slice(0, 500)}`);
});

test('a git show <commit>:<path> pin resolves against that commit; the same hash against the moved working file does not (issue #15)', () => {
  const r = synthGitAudit(
    `- [ ] P1-G81: a row pinning the committed form of src/later.js at the commit that form lives at\n  EVIDENCE: git show @C1@:src/later.js output-sha256=${HEX_LATER1}\n` +
    `- [ ] P1-G82: a row claiming that same hash for the file as this tree now carries it\n  EVIDENCE: src/later.js output-sha256=${HEX_LATER1}\n`);
  assert.equal(citeProblems(r.out, 'P1-G81').length, 0,
    `the row names git show @C1@:src/later.js as spelled with the real commit id, that object holds exactly the ` +
    `cited content, and the audit still refuses it - the tool's own comment (row P1-G11) reports this as ` +
    `hash ... is the content of ..., which the row does not name, a true statement about a scratch copy and a ` +
    `false statement about the row (issue #15 measurement A):\n${citeProblems(r.out, 'P1-G81').join('\n')}\n${r.out.slice(0, 500)}`);
  const stale = citeProblems(r.out, 'P1-G82');
  assert.equal(stale.length, 1,
    `src/later.js as this tree carries it hashes ${HEX_MOVED.slice(0, 16)}..., the row cites ${HEX_LATER1.slice(0, 16)}... ` +
    `against that name, and ${stale.length} problems were reported for it:\n${r.out.slice(0, 500)}`);
  assert.match(stale[0], /src\/later\.js/,
    `the stale-pin problem does not name the file whose content it contradicts - it can only say the hash matches ` +
    `no scratch file, because the name grammar never saw src/later.js at all:\n${stale[0]}`);
  assert.match(stale[0], new RegExp(`hashes ${HEX_MOVED.slice(0, 16)}`),
    `the stale-pin problem reports src/later.js but not what that file hashes to today (${HEX_MOVED.slice(0, 16)}... ` +
    `vs the cited ${HEX_LATER1.slice(0, 16)}...), so a reader cannot tell an aged pin from a typo:\n${stale[0]}`);
});

test('a 16-hex committed-form pin is read and checked against the file it names (issue #15)', () => {
  const r = synthGitAudit(
    `- [ ] P1-G83: a row pinning src/cited.js the 16-hex way row G6 uses for scripts/ledger-fill-g6.py\n  EVIDENCE: src/cited.js output-sha256=${HEX_CITED.slice(0, 16)}\n` +
    `- [ ] P1-G84: a row pinning src/cited.js at a 16-hex prefix no longer true of that file\n  EVIDENCE: src/cited.js output-sha256=${shaOf('an older pinned form\n').slice(0, 16)}\n`);
  assert.equal(citeProblems(r.out, 'P1-G83').length, 0,
    `a 16-hex pin of a tracked file that still matches the file is reported as a problem:\n${citeProblems(r.out, 'P1-G83').join('\n')}`);
  const aged = citeProblems(r.out, 'P1-G84');
  assert.equal(aged.length, 1,
    `this control's second arm is the case issue #15 was filed with: row G6 cites scripts/ledger-fill-g6.py ` +
    `output-sha256=88128e080a120116 - 16 hex, the style the closed rows use to pin a committed tool. Today the ` +
    `extractor requires 64 hex, so BOTH arms above are invisible: arm 1 passes only because the tool never saw ` +
    `the pin, and arm 2 reports 0 problems although the prefix contradicts the file named (${HEX_CITED.slice(0, 16)}... ` +
    `on disk). A pin nobody can read is a pin nobody can age out:\n${r.out.slice(0, 500)}`);
  assert.match(aged[0], /src\/cited\.js.*hashes [0-9a-f]{16}/s, `the aged 16-hex pin is not reported against the file it names:\n${aged[0]}`);
});

test('an unverifiable scratch citation is named as unverifiable, not as a hash that never existed (issue #15)', () => {
  const gone = shaOf('a recorded run this synthetic tree does not carry\n');
  const r = synthGitAudit(`- [ ] P1-G85: a row citing a scratch run output that git never tracked and this tree lacks\n  EVIDENCE: tmp/gone.out output-sha256=${gone}\n`);
  assert.match(r.out, /CITE PROBLEM: P1-G85: names tmp\/gone\.out which is not on disk/,
    `the existing wording this control supersedes additively must keep reporting the absence:\n${r.out.slice(0, 500)}`);
  assert.match(r.out, /names tmp\/gone\.out which is not on disk - untracked in git/,
    `the audit calls an absent scratch file and an absent committed file the same thing. Issue #15's whole ` +
    `finding is that a reviewer cannot tell them apart: a gitignored run output is unverifiable in every fresh ` +
    `checkout, while a tracked path that IS on disk is verifiable in every tree - and today the tool can name ` +
    `only the first kind at all:\n${citeProblems(r.out, 'P1-G85').join('\n')}`);
  assert.match(r.out, /hash [0-9a-f]{16}\.\.\. matches no scratch file on disk/,
    `the existing hash wording must survive as a prefix of the new one:\n${citeProblems(r.out, 'P1-G85').join('\n')}`);
  assert.match(r.out, /matches no scratch file on disk \(named tmp\/gone\.out, which this tree does not carry\)/,
    `the hash problem and the name problem are the same citation reported twice without either sentence ` +
    `referring to the other:\n${citeProblems(r.out, 'P1-G85').join('\n')}`);
});

// A guard, and the only law here that is green against the committed tool - stated as such
// because it gates the FIX's new extraction, not an old defect: the committed extractor cannot
// read 16-hex citations at all, so a closed row carrying only such a pin trips the closed-box
// rule today for the wrong reason (blindness). The naive fix (extract 16 hex, keep one hexes
// array) would let a source-file pin masquerade as a recorded run and close a box with no
// run behind it; that is exactly one of the pokes tmp/15-negctl.py drives red.
test('the closed-box rule still demands a 64-hex run output: a 16-hex pin alone does not close a row (guard on the issue #15 extraction)', () => {
  const r = synthGitAudit(`- [x] P1-G86: a closed row whose only citation is a 16-hex pin of a tracked file\n  CHECK: node --test test/synthetic.test.mjs\n  EXPECT: fail 0\n  EVIDENCE: src/cited.js output-sha256=${HEX_CITED.slice(0, 16)}\n`);
  assert.match(r.out, /DEFECT: P1-G86: the box reads \[x\] while the row names no recorded run output \(no 64-hex output citation\)/,
    `the row names src/cited.js and a 16-hex prefix of its content - a pin of source, not a record of a run. If ` +
    `the closed-box rule accepts that, widening the citation extractor to 16 hex (which issue #15 requires) ` +
    `would let any closed row pass by pinning a source file:\n${r.out.slice(0, 500)}`);
  assert.equal(r.status, 1, `a closed row with no 64-hex run citation exited ${r.status}:\n${r.out.slice(0, 500)}`);
});

test('the audit prints a cite census separating what resolved against disk, git content and a named commit, and which absences each problem is (issue #15)', () => {
  const gone = shaOf('a recorded run this synthetic tree does not carry\n');
  const r = synthGitAudit(
    `- [ ] P1-G87: tracked content citation\n  EVIDENCE: src/cited.js output-sha256=${HEX_CITED}\n` +
    `- [ ] P1-G88: commit-pin citation\n  EVIDENCE: git show @C1@:src/later.js output-sha256=${HEX_LATER1}\n` +
    `- [ ] P1-G89: absent scratch citation\n  EVIDENCE: tmp/gone.out output-sha256=${gone}\n`);
  const m = r.out.match(/cite census: resolved tracked (\d+), resolved commit (\d+), resolved scratch (\d+), names absent untracked (\d+), hashes matching nothing (\d+)/);
  assert.ok(m,
    `no census line: the audit's only citation output today is one resolved count plus a flat problem list, and ` +
    `the flat list is why issue #15 could not be sized - 135 problems in this harness tree and 293 in a git ` +
    `archive of the same commit, indistinguishable in kind:\n${r.out.slice(0, 700)}`);
  assert.deepEqual(m.slice(1).map(Number), [1, 1, 0, 1, 1],
    `the census for three citations that each resolve a different way (tracked content, a named commit object, ` +
    `and one scratch run output this tree lacks - its name and its hash are two reports of that one citation): ` +
    `got ${m.slice(1).join(', ')}\n${r.out.slice(0, 700)}`);
});

// --- the exception span read by NUMBER, not as text (the exception-span review finding) --
// This ledger's own exception span is `G1-G3`. Compared as text, "G10" is NOT greater than
// "G3": 'G'=='G', then '1' < '3'. So a ledger grown past G9 sweeps G10 through G19 into the
// exemption the RECIPE paragraph grants to three rows, and a fourth row whose recorded sig
// cannot be re-derived hides there. Measured: the audit read this span by number from the
// commit that first added the exemption (64adb69), and this file had carried the text
// comparison since its own first version (9dc51eb), so the two readers of one paragraph
// disagreed about which rows are exempt - which is why the control below measures BOTH.
const GROWN_ROWS = ['- [x] G10: a row a ledger grown past G9 adds', '- [x] G11: a second such row'].map((title) =>
  `${title}\n  CHECK: node --test test/zz.test.mjs\n  EXPECT: fail 0\n  EVIDENCE: exit 0, gate-sig=0000000000000000\n`).join('\n');

test('the exception span excuses rows by id NUMBER: "G1-G3" cannot reach a grown ledger G10', () => {
  const grown = `${gates}\n${GROWN_ROWS}\n`;
  const declared = declaredIds(grown);
  assert.ok(declared.includes('G10') && declared.includes('G11'),
    `the grown copy does not even carry the ids this control is about:\n${declared.join(', ')}`);
  assert.deepEqual(excusedBy(grown, 'G1-G3'), ['G1', 'G2', 'G3'],
    `the span "G1-G3" read as text excuses ${excusedBy(grown, 'G1-G3').join(', ')} of the grown copy's ` +
    `rows: text order puts G10 and G11 before G3, so a fourth row whose gate-sig cannot be ` +
    `re-derived would hide in an exemption the RECIPE paragraph never granted it`);
  // The other half of the same law: a span that really does reach past G9 excuses them, so the
  // fix is numbering the ids and not simply refusing everything with two digits. The expected
  // set is derived from the grown copy's own declared ids, not typed.
  const numeric = (id) => /^G\d+$/.test(id);
  const everyNumeric = declaredIds(grown).filter(numeric);
  assert.deepEqual(excusedBy(grown, 'G1-G11'), everyNumeric,
    `the span "G1-G11" excuses ${excusedBy(grown, 'G1-G11').join(', ')} while the grown copy declares ` +
    `these bare numeric ids: ${everyNumeric.join(', ')}`);
  const n = (id) => Number(id.slice(1));
  assert.ok(everyNumeric.some((id) => n(id) <= 3) && everyNumeric.some((id) => n(id) >= 4 && n(id) <= 9) &&
    everyNumeric.some((id) => n(id) >= 10),
    `the grown copy has no id on both sides of the G9 boundary this control is about ` +
    `(need one <=3, one in 4..9 and one >=10, it has ${everyNumeric.join(', ')})`);
});

test('the audit and this file agree on which grown rows the declared exception does NOT cover', () => {
  const grown = `${gates}\n${GROWN_ROWS}\n`;
  const r = damagedAudit(() => grown);
  assert.equal(r.status, 1, `two grown rows carrying a sig that cannot recompute still exited ${r.status}, ` +
    `although neither is inside the exception the RECIPE paragraph declares:\n${r.out.slice(0, 900)}`);
  for (const id of ['G10', 'G11']) {
    assert.match(r.out, new RegExp(`DEFECT: ${id}: its recorded gate-sig does not recompute[^\\n]*not covered by the exception "G1-G3"`),
      `the audit does not name ${id} as outside the declared exception:\n${r.out.slice(0, 900)}`);
  }
  for (const id of ['G1', 'G2', 'G3']) {
    assert.ok(!new RegExp(`DEFECT: ${id}:`).test(r.out), `the audit refuses ${id}, which the RECIPE paragraph ` +
      `declares as written by the earlier runner - the exemption stopped working:\n${r.out.slice(0, 900)}`);
  }
  const claimed = excusedBy(grown, SPAN_PARAGRAPH.exec(grown)[1]);
  assert.deepEqual(claimed, ['G1', 'G2', 'G3'],
    `one paragraph, two readers, two answers: the audit above refuses ${['G10', 'G11'].filter((id) => new RegExp(`DEFECT: ${id}:`).test(r.out)).join(', ')} ` +
    `as outside the exception while this file excuses ${claimed.join(', ')} - and an exemption the ` +
    `RECIPE paragraph never granted is how a fourth broken row hides`);
  for (const id of ['G1', 'G2', 'G3']) {
    assert.ok(claimed.includes(id), `this file no longer excuses ${id}, which the RECIPE paragraph declares as ` +
      `written by the earlier runner:\n${claimed.join(', ')}`);
  }
});

// --- scripts/branch-gate.sh measured against a stub forge (PR #10 review findings 9, 12) --
// The P1-G1 test above only parses the oracle and greps its text, so it cannot see the
// defect that test names: three of the tool's verdicts are `case "$(...)" in <one bad
// value>) bad ;; *) <pass>`, and `gh api --jq` prints NOTHING at all when an endpoint
// answers 404 (measured on this repo, whose legacy per-setting endpoints 404). An empty
// command substitution does not match the one bad value, so it fell into `*)` and printed
// as a satisfied setting. These controls run the real oracle, with a stub `gh` in PATH and
// a scratch git tree it can measure for real: no network, no token, no forge call.
// The scratch tree's clock is part of the recipe, not of the wall clock. Two recordings of
// the identical pre-fix RED run hashed differently - 98d41c241d2463f73785050db1ebebf8f87d83d5da8d8c56c7933ffb112a15bc
// against 6b96c0c0aa588d503e21843a7e20855cf71803b737a5eb0f793f50729e89c7a1 - because the
// failing assertion prints the oracle's transcript, and that transcript names the scratch
// tree's own commit hashes. Pinning these two dates is what makes a gate record quoted by a
// ledger row re-derivable, which is the whole reason scripts/ledger-run.sh exists.
const GATE_CLOCK = '2026-01-01T00:00:00 +0000';
const gateGitEnv = (blankConfig, clock = GATE_CLOCK) => ({
  ...runnerEnv(),
  GIT_AUTHOR_NAME: 'ledger', GIT_AUTHOR_EMAIL: 'ledger@invalid',
  GIT_COMMITTER_NAME: 'ledger', GIT_COMMITTER_EMAIL: 'ledger@invalid',
  GIT_AUTHOR_DATE: clock, GIT_COMMITTER_DATE: clock,
  GIT_CONFIG_GLOBAL: blankConfig, GIT_CONFIG_SYSTEM: blankConfig,
});

const gitIn = (cwd, args, env) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed in the scratch tree:\n${r.stderr}`);
};

/** Tag `rel` cut into branch `eng`, tag `other` on a commit eng does not carry, and a
 *  local bare remote standing in for origin so `git rev-parse origin/eng` resolves. */
const gateTree = (clock) => {
  const dir = mkdtempSync(join(tmpdir(), 'last-v8-gate-'));
  const blank = join(dir, 'empty.gitconfig');
  writeFileSync(blank, '');
  const env = gateGitEnv(blank, clock);
  const repo = join(dir, 'repo');
  mkdirSync(repo, { recursive: true });
  gitIn(dir, ['init', '--bare', '-q', '--initial-branch=main', join(dir, 'origin.git')], env);
  gitIn(repo, ['init', '-q', '--initial-branch=main'], env);
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  gitIn(repo, ['add', 'base.txt'], env);
  gitIn(repo, ['commit', '-q', '-m', 'base'], env);
  gitIn(repo, ['tag', 'rel'], env);
  gitIn(repo, ['branch', 'eng'], env);
  writeFileSync(join(repo, 'other.txt'), 'other\n');
  gitIn(repo, ['add', 'other.txt'], env);
  gitIn(repo, ['commit', '-q', '-m', 'other'], env);
  gitIn(repo, ['tag', 'other'], env);
  gitIn(repo, ['remote', 'add', 'origin', join(dir, 'origin.git')], env);
  gitIn(repo, ['push', '-q', 'origin', 'eng'], env);
  return { dir, repo, env };
};

// Response bodies shaped like the ones this repo's forge really answers (see the
// allow_force_pushes line tmp/v8-p1g1.out records: the key is ABSENT there, which is why the
// tool prints "key absent"), plus the ruleset objects the LIST endpoint does not carry.
const BRANCH_RULESET = '{"id":1,"name":"protect-engine-branch","target":"branch","enforcement":"active","conditions":{"ref_name":{"include":["refs/heads/eng"]}},"rules":[{"type":"deletion"},{"type":"non_fast_forward"}],"bypass_actors":[],"current_user_can_bypass":"never"}';
const TAG_RULESET = '{"id":3,"name":"immutable-release-tags","target":"tag","enforcement":"active","conditions":{"ref_name":{"include":["refs/tags/v*"]}},"rules":[{"type":"tag_deletion"},{"type":"tag_creation_non_fast_forward"}],"bypass_actors":[],"current_user_can_bypass":"never"}';
const RSC_BODY = '{"contexts":["test"],"strict":true,"checks":[]}';
const RPR_BODY = '{"required_approving_review_count":1,"require_last_push_approval":false}';
const PROTECTION_BODY = `{"required_status_checks":${RSC_BODY},"required_pull_request_reviews":${RPR_BODY}}`;
const ruleSetList = (ids) => `[${ids.map((id) => `{"id":${id},"name":"ruleset-${id}","enforcement":"active"}`).join(',')}]`;

// The stub is a stand-in for `gh api`, not for the answers: it models the endpoint bodies and
// then applies the caller's --jq filter with the real jq, exactly like gh does, so the same
// stub measures the tool whether the tool asks for the raw body or for one field of it. A
// 404 is modelled the way gh answers one - exit 1, reason on stderr, stdout EMPTY - and it
// fails every call to that endpoint, not one of them.
const ghStub = ({ context404 = false, missingRuleset = false }) => [
  '#!/usr/bin/env bash',
  'ep="$2"; jqf="$4"',
  'not_found() { echo "gh: Not Found: $1" >&2; exit 1; }',
  'body=""',
  'case "$ep" in',
  '  */branches/eng) body=\'{"name":"eng","protected":true}\' ;;',
  context404
    ? '  *required_status_checks) not_found "Branch not found" ;;'
    : `  *required_status_checks) body='${RSC_BODY}' ;;`,
  `  *required_pull_request_reviews) body='${RPR_BODY}' ;;`,
  `  */protection) body='${PROTECTION_BODY}' ;;`,
  `  */rulesets/1) body='${BRANCH_RULESET}' ;;`,
  missingRuleset ? '  */rulesets/2) not_found "Ruleset not found" ;;' : '',
  `  */rulesets/3) body='${TAG_RULESET}' ;;`,
  `  */rulesets) body='${ruleSetList(missingRuleset ? [1, 2, 3] : [1, 3])}' ;;`,
  '  *) not_found "unexpected endpoint" ;;',
  'esac',
  'if [ -n "$jqf" ]; then printf \'%s\' "$body" | jq -r "$jqf"; else printf \'%s\\n\' "$body"; fi',
].join('\n');

const runGate = (tree, stubBody) => {
  const bin = join(tree.dir, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'gh'), `${stubBody}\n`, { mode: 0o755 });
  const r = spawnSync('bash', [resolve('scripts/branch-gate.sh'), 'o/r', 'eng', 'rel', 'other'], {
    cwd: tree.repo,
    encoding: 'utf8',
    env: { ...tree.env, PATH: `${bin}:${process.env.PATH}` },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};

test('branch-gate.sh measured end to end: a protection that is actually there reads as PROTECTION OK', () => {
  const r = runGate(gateTree(), ghStub({}));
  assert.equal(r.status, 0, `the oracle does not pass a protection it was handed:\n${r.out}`);
  assert.match(r.out, /PROTECTION OK/, `no verdict line:\n${r.out}`);
});

// The clock the scratch tree commits with is part of what these controls print, so it is part
// of the recipe a gate record re-derives from. The transcript names the tree's own object ids
// (the "eng head", "rel tag commit" and "other tag commit" lines), and a commit object hashes
// its author and committer timestamps - so an unpinned clock makes every hash quoted from a
// failing run here unreproducible. Measured before the pin: two recordings of one identical
// pre-fix run hashed 98d41c241d2463f73785050db1ebebf8f87d83d5da8d8c56c7933ffb112a15bc against
// 6b96c0c0aa588d503e21843a7e20855cf71803b737a5eb0f793f50729e89c7a1, and `diff` between those two
// recordings showed the ONLY moved lines were those four object-id lines (tmp/v8-c2-red.out
// against tmp/v8-c2-red-recheck.out, 16 changed lines, 4 of them per failing test).
const GATE_HEADS = {
  eng: '33a276d4a74eb1d10c5199623bb16aa88bd1dce0',
  other: '62ffc2506c9d655d6be3c4c80bdbd5ee6c20978d',
};

test('the gate controls re-derive: two scratch trees built the same way print one identical transcript', () => {
  const a = runGate(gateTree(), ghStub({}));
  const b = runGate(gateTree(), ghStub({}));
  const ids = (a.out.match(/\b[0-9a-f]{40}\b/g)) || [];
  assert.ok(ids.length >= 4, `the healthy transcript names no git object id, so this control could not detect a clock that moves:\n${a.out}`);
  assert.equal(a.out, b.out, 'two scratch trees built by the same recipe printed different transcripts, so a hash quoted from ' +
    `a failing run of this tool cannot be re-derived:\n--- run A ---\n${a.out}--- run B ---\n${b.out}`);
  const named = (a.out.match(/\b[0-9a-f]{40}\b/g) || []).map((h) => h).sort();
  assert.ok(named.includes(GATE_HEADS.eng) && named.includes(GATE_HEADS.other),
    `the pinned recipe no longer produces the object ids its records name (${GATE_HEADS.eng} and ${GATE_HEADS.other}), ` +
    `so every hash this file's rows cite from a failing run has silently moved:\n${a.out}`);
});

test('the gate controls move with the clock they commit with, which is what makes the control above non-vacuous', () => {
  const pinned = runGate(gateTree(), ghStub({}));
  const shifted = runGate(gateTree('2020-01-01T00:00:00 +0000'), ghStub({}));
  assert.equal(shifted.status, 0, `a tree committed at a different clock stopped working, which would make the comparison below meaningless:\n${shifted.out}`);
  const strip = (s) => s.replace(/\b[0-9a-f]{40}\b/g, '<object-id>');
  assert.equal(strip(pinned.out), strip(shifted.out), 'the two transcripts differ somewhere OTHER than the git object ids, so the ' +
    `identity of the pinned run is not about the clock:\n--- pinned ---\n${pinned.out}--- shifted ---\n${shifted.out}`);
  assert.notEqual(pinned.out, shifted.out, 'the transcript is identical at two different clocks, so it does not carry the scratch ' +
    `tree's object ids and the re-derivability control above proves nothing:\n${pinned.out}`);
});

test('branch-gate.sh: a 404 on required_status_checks cannot print as "required check names test"', () => {
  const r = runGate(gateTree(), ghStub({ context404: true }));
  assert.ok(!/required check names test/.test(r.out),
    'the contexts read answered nothing (exit 1, "Not Found: Branch not found") and the tool ' +
    `still printed the pass line - an empty answer is not a satisfied setting:\n${r.out}`);
  assert.notEqual(r.status, 0, `a setting nobody read was scored as satisfied, exit ${r.status}:\n${r.out}`);
  assert.match(r.out, /FAIL: required_status_checks: gh api repos\/o\/r\/branches\/eng\/protection\/required_status_checks answered exit 1/,
    `the tool does not name the endpoint whose read failed, only the fact it could not establish:\n${r.out}`);
  assert.match(r.out, /PROTECTION GATE FAILED/, `no verdict line:\n${r.out}`);
});

// issue #14: scripts/procedural-audit.mjs is a text scanner. It walks src/ and public/ and
// hashes them; it runs no browser and sees no scene. Line 84 nonetheless ENDED its scan with
// `-- live counts this file cannot see (see test/screenshots.mjs output): 847 texture maps
// over 790 meshes in 31 material families` - three numbers the tool never measured, printed
// in the same transcript row G7 cites. The eight spark plugs moved the live census to 854
// meshes / 40 families and the tool could not notice, because a restated number cannot drift
// in only one direction: it is wrong silently. The fix this law gates is that the tool names
// the gate owning the census and prints none of its numbers.
const CENSUS = /\b\d[\d,]*\s+(texture maps?|meshes|material families)\b/g;

test('scripts/procedural-audit.mjs prints only what it measures: the live mesh/map/family census is owned by test/screenshots.mjs and is not restated here', () => {
  const src = readFileSync('scripts/procedural-audit.mjs', 'utf8');
  const copied = [...src.matchAll(CENSUS)].map((m) => m[0]);
  assert.deepEqual(copied, [], `the tool carries a hand-copied live census it cannot measure: ${copied.join('; ')}`);

  const r = spawnSync(process.execPath, ['scripts/procedural-audit.mjs'], { encoding: 'utf8', env: runnerEnv() });
  assert.equal(r.status, 0, `the procedural audit exited ${r.status}: ${r.stderr.slice(0, 400)}`);
  const out = `${r.stdout}\n${r.stderr}`;
  const printed = [...out.matchAll(CENSUS)].map((m) => m[0]);
  assert.deepEqual(printed, [], `the audit printed a scene census it did not measure: ${printed.join('; ')}`);
  assert.match(out, /test\/screenshots\.mjs/,
    'the tool has to name which committed gate owns the live census instead of quoting numbers ' +
    `it cannot re-derive:\n${out.slice(-400)}`);
});

// issue #14 measured this on the tool side. The same defect sits in a durable doc: a census
// number copied out of a gate's transcript into a file that never builds a scene cannot drift
// in only one direction, it is wrong silently. Measured at f2dd8e7: README.md wrote `31
// material families, 847 ... maps` and `212 members mapped, 119 moved, 205 inspectable`, while
// the gates that count the rendered tree and the live controls printed 43 families, 921 maps
// and 212 / 119 / 205 for that head - the surfaces had moved under the sentence, the sentence
// had not. A doc's job is to name the gate that owns a live count, not to keep the count.
const PART_CENSUS = /\b\d[\d,]*\s+(texture maps?|meshes|material families|inspectable members|members (?:mapped|ruled|moved|wrapped))/g;
const DOC_CENSUS_FILES = ['README.md', 'HISTORY.md'];

test('README.md and HISTORY.md name the gate that counts the live scene instead of restating its mesh/map/family census', () => {
  for (const f of DOC_CENSUS_FILES) {
    const text = readFileSync(f, 'utf8');
    const copied = [...text.matchAll(PART_CENSUS)].map((m) => m[0]);
    assert.deepEqual(copied, [], `${f} carries a hand-copied live census it cannot measure: ${copied.join('; ')}`);
  }
});

// issue #34: the same tool's last line is the only thing separating "the procedural claim
// holds" from "it does not", and the tool never sets an exit code, so BOTH states report
// success. Measured at d6949ef: one poke putting `fetch("https://example.com/a.png")` into a
// committed product file printed `PROBLEM: 3 forbidden hits` at exit 0 - three hits for one
// line, because the scan counts the same line under the network, the URL-literal and the
// asset-reference pattern - then reverted with git checkout. Row G7 carries
// `CHECK: node scripts/procedural-audit.mjs` / `EXPECT: PROCEDURAL ONLY`, so a forbidden hit
// cannot fail that gate; it can only be read off a transcript. The tool is not unable to exit
// non-zero (it does, on a missing file), only the verdict never uses the exit path.
const auditIn = (dir) => spawnSync(process.execPath, [resolve('scripts/procedural-audit.mjs')], { cwd: dir, encoding: 'utf8', env: runnerEnv() });

/** A scratch tree holding exactly what the audit reads (src/, public/, package.json,
 *  src/render/materials.js) and nothing forbidden, plus one forbidden line on request. */
const auditScratch = (forbidden) => {
  const dir = mkdtempSync(join(tmpdir(), 'audit-exit-'));
  mkdirSync(join(dir, 'src', 'render'), { recursive: true });
  mkdirSync(join(dir, 'public'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'scratch', version: '0.0.0', dependencies: { three: '^0.187.0' } }));
  writeFileSync(join(dir, 'src', 'render', 'materials.js'), "const c = document.createElement('canvas');\nconst x = c.getContext('2d');\n");
  writeFileSync(join(dir, 'public', 'index.html'), '<html><body><script type="module" src="/src/main.js"></script></body></html>\n');
  if (forbidden) writeFileSync(join(dir, 'src', 'poke.js'), forbidden);
  return dir;
};

test('scripts/procedural-audit.mjs: its verdict is an exit code, so a forbidden hit can fail a gate instead of only being read', () => {
  const here = spawnSync(process.execPath, ['scripts/procedural-audit.mjs'], { encoding: 'utf8', env: runnerEnv() });
  assert.equal(here.status, 0, `the procedural audit exited ${here.status} on a clean tree: ${here.stderr.slice(0, 400)}`);
  assert.match(here.stdout, /^PROCEDURAL ONLY$/m, `row G7's EXPECT is PROCEDURAL ONLY and this run did not print it:\n${here.stdout.slice(-300)}`);

  const dirs = [];
  try {
    const clean = auditIn((dirs[0] = auditScratch(null)));
    assert.equal(clean.status, 0, `the tool failed on a scratch tree that holds nothing forbidden, exit ${clean.status}:\n${clean.stderr.slice(0, 400)}`);
    assert.match(clean.stdout, /PROCEDURAL ONLY/, `the benign tree did not read as procedural, so the fail clause below is vacuous:\n${clean.stdout.slice(-300)}`);

    const dirty = auditIn((dirs[1] = auditScratch('fetch("https://example.com/a.png");\n')));
    const verdict = (dirty.stdout.match(/PROBLEM: \d+ forbidden hits/) || [])[0];
    assert.ok(verdict, `the tool did not even report the forbidden line it was pointed at:\n${dirty.stdout.slice(-400)}${dirty.stderr.slice(0, 300)}`);
    assert.notEqual(dirty.status, 0, `the audit printed "${verdict}" and still exited ${dirty.status}: a CHECK that cannot fail is a comment, not a gate`);
  } finally {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  }
});

test('branch-gate.sh: one unread ruleset is named as unread and cannot erase the rulesets already read', () => {
  const r = runGate(gateTree(), ghStub({ missingRuleset: true }));
  assert.ok(!r.out.includes('no branch ruleset includes refs/heads/eng'),
    'ruleset 1 was read and does cover refs/heads/eng, yet one failed read of ruleset 2 wiped ' +
    `the accumulator and the gate reported the wrong reason:\n${r.out}`);
  assert.match(r.out, /ruleset 2: gh api repos\/o\/r\/rulesets\/2 answered exit 1/,
    `the ruleset whose read failed is not named with the endpoint that failed:\n${r.out}`);
  assert.match(r.out, /ruleset id\(s\) 2 could not be read/,
    `the gate does not say which rulesets it could not conclude about:\n${r.out}`);
  assert.match(r.out, /a ruleset covering refs\/heads\/eng carries the deletion rule/,
    'the ruleset that WAS read must still be measured, and its rule-count query must not be ' +
    `answered by an empty accumulator:\n${r.out}`);
  assert.notEqual(r.status, 0, `an unread ruleset left the gate green:\n${r.out}`);
});

// --- issue #12: a claim line the label grammar cannot read is a claim nobody checks ---------
// scripts/ledger-audit.mjs read a row's claim line only when its label matched
// `CHECK|EXPECT|EVIDENCE|NOTE|[A-Z][A-Z ()/,-]{2,}`. Every other indented line under a row was
// dropped - not reported as unread, just absent. Measured against this file at the head issue
// #12 was filed at: 525 indented claim lines, 306 read. At the head this slice starts at, after
// issue #15 landed: 535 indented claim lines, 316 read, 219 invisible. What that costs is
// measurable rather than rhetorical: the pinned shot identities of row G7 (`shots/07-home.png
// sha256=605ee6b2...`) sit on a wrapped continuation line no grammar ever read, so six picture
// hashes this ledger publishes have never been checked by any tool; and a `NOTE (heads unit)`
// style label - the shape most of this ledger's evidence actually uses - hides the citation on
// it too. scripts/ledger-name-evidence.py has no label grammar at all: its prefix rule covers
// every indented line, which is why the two tools disagree about what a claim line is.
//
// The laws below run against the same synthetic trees as issue #15's, plus one measurement
// against this file itself.
const gatesIn = (text) => {
  const dir = mkdtempSync(join(tmpdir(), 'last-v8-claim-'));
  writeFileSync(join(dir, 'GATES.md'), text);
  cpSync('scripts/ledger-audit.mjs', join(dir, 'scripts/ledger-audit.mjs'));
  const r = spawnSync(process.execPath, ['scripts/ledger-audit.mjs'], { cwd: dir, encoding: 'utf8' });
  return { dir, status: r.status, out: `${r.stdout}${r.stderr}` };
};

/** Every indented line a ledger text carries UNDER a row: from the first row title on, any
 *  line indented by two or more spaces that is not itself a row title. This is the count
 *  scripts/ledger-name-evidence.py's prefix rule applies to, and the count the audit's claim
 *  census must match. */
const claimLinesUnderRows = (text) => {
  const out = [];
  let seen = false;
  for (const l of text.split('\n')) {
    if (ROW_TITLE.test(l)) { seen = true; continue; }
    if (seen && /^ {2,}\S/.test(l)) out.push(l);
  }
  return out;
};

test('a claim line whose label carries prose is read, so the citation on it is checked (issue #12)', () => {
  const r = synthAudit('- [ ] P1-G90: a row whose evidence label carries a parenthetical sentence\n'
    + `  MEASURED (the probe, tmp/one.out -> run one): output-sha256=${SYNTH_HEX['tmp/one.out']}\n`);
  assert.equal(synthResolved(r.out), 1,
    `the row names tmp/one.out, this tree carries it, its content hashes to exactly the cited value, and the ` +
    `audit resolved ${synthResolved(r.out)}: the label ` + '`MEASURED (the probe, tmp/one.out -> run one)` ' +
    `is outside the strict shape, so the whole line - citation included - was dropped (issue #12):\n${r.out.slice(0, 600)}`);
  assert.equal(citeProblems(r.out, 'P1-G90').length, 0,
    `a citation this tree can answer was reported as a problem:\n${citeProblems(r.out, 'P1-G90').join('\n')}`);
});

test("a label carrying a digit, an apostrophe or a slash is read too (issue #12)", () => {
  const r = synthAudit('- [ ] P1-G91: a row written the way this ledger writes evidence\n'
    + `  PLUG 1's seat (of 8, overlap 0.1000 cm): measured in tmp/one.out output-sha256=${SYNTH_HEX['tmp/one.out']}\n`);
  assert.equal(synthResolved(r.out), 1,
    `the label "PLUG 1's seat (of 8, overlap 0.1000 cm)" is outside the strict shape (apostrophe, digits), so a ` +
    `citation pointing at a file this tree carries and hashes correctly was never extracted: resolved ` +
    `${synthResolved(r.out)} of 1\n${r.out.slice(0, 600)}`);
});

test('a citation on a wrapped continuation line is read, which is how row G7 pins its pictures (issue #12)', () => {
  const r = synthAudit('- [ ] P1-G92: a row whose claim wraps onto a continuation line\n'
    + '  SHOT FILE IDENTITY (recorded after tmp/one.out, whose printed byte count this\n'
    + `      line carries): shots/two.png sha256=${SYNTH_HEX['shots/two.png']}\n`);
  assert.equal(citeProblems(r.out, 'P1-G92').length, 0,
    `this row cites shots/two.png on the wrapped half of its sentence, the file is on disk and hashes to the ` +
    `cited value, and the audit still reports problems:\n${citeProblems(r.out, 'P1-G92').join('\n')}\n${r.out.slice(0, 600)}`);
  assert.equal(synthResolved(r.out), 1,
    `the six picture hashes row G7 publishes sit on continuation lines of exactly this shape; resolved ` +
    `${synthResolved(r.out)} of 1, so no tool has ever compared them with the files they name:\n${r.out.slice(0, 600)}`);
});

test('the audit prints a claim census, so a line with no label is counted and not skipped (issue #12)', () => {
  const r = synthAudit('- [ ] P1-G93: a row carrying one labelled claim and one wrapped half\n'
    + `  MEASURED (the probe): the run ended cleanly, recorded in tmp/one.out output-sha256=${SYNTH_HEX['tmp/one.out']}\n`
    + '      and this continuation of the same sentence\n');
  const m = r.out.match(/claim census: claim lines read (\d+) \(labelled (\d+), unlabelled (\d+)\)/);
  assert.ok(m, `the audit reported a citation census but never said how many claim lines it read at all, which ` +
    `is what made 219 of this ledger's 535 lines invisible in total silence:\n${r.out.slice(0, 700)}`);
  assert.equal(Number(m[1]), 2, `this synthetic row carries 2 indented claim lines and the census read ${m[1]}:\n${r.out.slice(0, 400)}`);
  assert.equal(Number(m[2]), 1, `one of those lines carries a label and the census calls ${m[2]} labelled:\n${r.out.slice(0, 400)}`);
  assert.equal(Number(m[3]), 1, `the wrapped half must be counted as unlabelled rather than absent:\n${r.out.slice(0, 400)}`);
});

test('the widening does not widen the oracle grammar: a parenthetical CHECK cannot move a recorded gate-sig (issue #12 guard)', () => {
  // The audit's recipe check is hardcoded on a row named G7, so this tree carries the same
  // anchor the other synthetic harnesses write. The row under test labels its oracle lines
  // with an aside and carries no gate-sig at all, so the correct reading is "declared without
  // an oracle": the published spelling of an oracle is `  CHECK: ` and `  EXPECT: `, and a
  // label with a parenthetical in it must not become one.
  const anchorCheck = 'node --test test/synthetic-anchor.test.mjs';
  const anchorExpect = 'fail 0';
  const r = gatesIn('- [ ] G7: the synthetic anchor row the audit runs its recipe check on\n'
    + `  CHECK: ${anchorCheck}\n  EXPECT: ${anchorExpect}\n`
    + `  EVIDENCE: gate-sig=${shaOf(`${anchorCheck}\n${anchorExpect}`).slice(0, 16)}\n`
    + '- [ ] P1-G94: a row that labels its oracle lines with a parenthetical\n'
    + '  CHECK (measured at this head): node --test test/x.test.mjs\n'
    + '  EXPECT (the printed tail): fail 0\n');
  assert.ok(!/P1-G94: carries a CHECK\/EXPECT but no gate-sig/.test(r.out),
    `the gate-sig recipe is sha256(CHECK value + newline + EXPECT value) on the exact published spelling. Reading ` +
    `"CHECK (measured at this head):" as that row's oracle makes the row look like it declares an oracle the ` +
    `recipe cannot re-derive, so a wording edit moves every sig in the ledger:\n${r.out.slice(0, 700)}`);
  assert.match(r.out, /gate-sig recomputes: 1\/1 rows that declare one/,
    `the widening must leave the sig count alone: only the anchor row declares an oracle in the published ` +
    `spelling, and only its sig is re-derived:\n${r.out.slice(0, 700)}`);
  assert.match(r.out, /rows declared without an oracle \(manual evidence\): 1 - P1-G94/,
    `a row whose oracle lines carry an aside is a row the audit reads no published oracle from - named as such, ` +
    `not dropped:\n${r.out.slice(0, 700)}`);
});

test('the audit reads every indented claim line this ledger declares (measured against GATES.md, issue #12)', () => {
  const declared = claimLinesUnderRows(gates);
  const a = freshAudit();
  const out = `${a.stdout}${a.stderr}`;
  const m = out.match(/claim census: claim lines read (\d+)/);
  assert.ok(m, `no claim census in the audit's output, so nothing in any tree says how many of this file's ` +
    `${declared.length} claim lines the tool read:\n${out.slice(0, 400)}`);
  assert.equal(Number(m[1]), declared.length,
    `this file declares ${declared.length} indented claim lines under its rows - the count ` +
    `scripts/ledger-name-evidence.py's prefix rule applies to - and the audit read ${m[1]}. A row the audit ` +
    `skips is a row whose citations, gate-sig and recorded run nobody checks:\n${out.slice(0, 400)}`);
});
