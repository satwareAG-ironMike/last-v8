// Ledger tooling contract (issue #8): a ledger row a committed tool cannot read is a
// claim nobody checks. Both tools here must see EVERY row GATES.md declares - the bare
// G<id> ids up to G7 and the phase-prefixed ids issue #8 names (P1-G1, A1-G9, P2-G5,
// A2-G5) - and both must run in a tree that carries none of the gitignored scratch
// dirs, which is what a fresh checkout and every CI runner look like.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROW_TITLE = /^- \[( |x)\] (\S+): /;
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
  const named = gates.match(/(G\d+(?:-G\d+)?) carry sigs written by an earlier runner/);
  assert.ok(named, 'the ledger does not name the rows whose recorded sig predates the recipe');
  const span = named[1].split('-').map((s) => s.trim());
  const documented = [...blocks.keys()].filter((id) => /^G\d+$/.test(id) && id >= span[0] && id <= span[1]);
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

test('the audit refuses a closed row that names no recorded run output', () => {
  const r = damagedAudit((text) => editRow(text, 'P1-G5', (lines, at) => {
    assert.match(lines[at], /^- \[ \] /, `row P1-G5 is not an open row to close in the copy`);
    lines[at] = lines[at].replace(/^- \[ \] /, '- [x] ');
  }));
  assert.equal(r.status, 1, `P1-G5 reads closed with no 64-hex run citation behind it and the audit ` +
    `still exited ${r.status}:\n${r.out.slice(0, 700)}`);
  assert.match(r.out, /P1-G5/, `the closed row with no recorded run is not named:\n${r.out.slice(0, 700)}`);
});

test('the clean ledger passes every one of those four checks, so the failure path is not self-inflicted', () => {
  const r = damagedAudit((text) => text);
  assert.equal(r.status, 0, `the refusal path fires against this repo's own ledger:\n${r.out.slice(0, 900)}`);
  assert.match(r.out, /LEDGER AUDIT OK/, 'the audit publishes no verdict for a ledger it accepts');
});
