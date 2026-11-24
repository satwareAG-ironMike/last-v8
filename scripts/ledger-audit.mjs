// Ledger audit: recompute every gate-sig the way the recipe at the head of GATES.md
// defines it, and check every evidence file the ledger names against the hash it cites.
// Written after the G7 entry, because a ledger a reviewer cannot recompute is a list of
// claims, not a ledger. Pure text + hashing: it measures nothing of the product and
// touches no source file, so it can run at any time.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

// (1) index every scratch file the harness ever wrote, by content hash. Recursed, because
// the driver keeps its per-case outputs in tmp/mutate-panel/ and a row that cites one of
// those should resolve the same way a top-level citation does.
const byHash = new Map();
const byName = new Map();
const walk = (dir) => {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${ent.name}`;
    if (ent.isDirectory()) {
      walk(p);
      continue;
    }
    if (!ent.isFile()) continue;
    const h = sha(readFileSync(p));
    byHash.set(h, p);
    byName.set(p, h);
  }
};
// tmp/ and shots/ are gitignored: a fresh checkout, and every CI runner, carries
// neither. Index what is here; the rows that cite a run file no longer on disk are
// reported as cite problems rather than crashing the audit.
for (const dir of ['tmp', 'shots']) {
  if (existsSync(dir)) walk(dir);
}

// (1b) issue #15: index what a fresh checkout actually carries. tmp/ and shots/ are
// gitignored, so a citation naming a scratch file is unverifiable by a reviewer or a CI
// runner no matter how sound it is; a citation naming a tracked path is verifiable in every
// tree, and until this index existed the audit could not answer one. A row that pins a
// committed FORM writes `git show <ref>:<path>` - that commit object, not the file as it
// stands today, is what such a hash names, so readable commit objects are hashed too.
const tracked = new Set();
const gitFiles = spawnSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
const hasGitIndex = gitFiles.status === 0;
if (hasGitIndex) {
  for (const p of gitFiles.stdout.split('\0').filter(Boolean)) {
    tracked.add(p);
    if (!existsSync(p)) continue;
    let h;
    try {
      h = sha(readFileSync(p));
    } catch {
      continue;
    }
    byName.set(p, h);
    if (!byHash.has(h)) byHash.set(h, p);
  }
}
const refIndex = new Map();
const refOf = (ref, path) => {
  const key = `${ref}:${path}`;
  if (!refIndex.has(key)) {
    const g = spawnSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8' });
    refIndex.set(key, g.status === 0 ? sha(Buffer.from(g.stdout, 'utf8')) : null);
  }
  return refIndex.get(key);
};

// Cite kinds (issue #15): the flat cite-problem list is why the issue could not be sized -
// 135 problems in this harness tree and 293 in a git archive of the same commit, with no
// way to tell "names a gitignored scratch file" from "hash matches nothing anywhere".
const kinds = {};
const bump = (k) => { kinds[k] = (kinds[k] || 0) + 1 };

// Claim census (issue #12): a claim line the reader dropped used to be absent from every
// number this tool printed. claimLines is every line indented under a row, labelled those
// carrying `LABEL: value`, unlabelled the wrapped halves of a sentence.
let claimLines = 0;
let labelled = 0;

// (2) read the rows. One row-id grammar, shared with ROW_HEAD in
// scripts/ledger-name-evidence.py: the bare G<id> ids this ledger used up to G7, and the
// phase-prefixed ids issue #8 declares (P1-G1, A1-G9, P2-G5, A2-G5). A row either tool
// cannot read is a row nobody checks - its CHECK/EXPECT lines would be silently
// attributed to the previous row, which is what broke the recipe check on G7 once.
const ROW_ID = String.raw`(?:[A-Z][0-9]+-)?G[0-9a-z]+`;
const gatesText = readFileSync('GATES.md', 'utf8');
const ANY_ROW = /^- \[( |x)\] (\S+): /;
const rows = [];
const badIds = [];
for (const line of gatesText.split('\n')) {
  const m = line.match(new RegExp(`^- \\[( |x)\\] (${ROW_ID}): (.*)$`));
  if (m) rows.push({ done: m[1] === 'x', name: m[2], title: m[3], check: '', expect: '', ev: [] });
  else if (ANY_ROW.test(line)) {
    // A row heading whose id is outside the grammar is indexed anyway, so its CHECK/EXPECT
    // cannot be silently attributed to the previous row - that misattribution is what once
    // made this tool report "RECIPE DOES NOT REPRODUCE THE RECORDED SIG" on a sound G7. It
    // is named as a defect below: no committed tool reads such a row, so nothing checks it.
    const any = ANY_ROW.exec(line);
    badIds.push(any[2]);
    rows.push({ done: any[1] === 'x', name: any[2], title: line.slice(any[0].length), check: '', expect: '', ev: [] });
  } else if (rows.length && /^ {2,}\S/.test(line)) {
    // A CLAIM IS ANY LINE INDENTED UNDER A ROW (issue #12). The label grammar was the defect:
    // the strict shape read 316 of this ledger's 535 indented claim lines and dropped the
    // other 219 without reporting the drop - among them row G7's six pinned shot identities,
    // which sit on the wrapped half of a sentence and have therefore never been compared with
    // the files they name by any committed tool. scripts/ledger-name-evidence.py has no label
    // grammar at all (its prefix rule covers every line of a row block, 609 lines here), which
    // is the disagreement this fix closes: a line the proof demands survive cannot be invisible
    // to the audit that checks it.
    // The ORACLE grammar deliberately does not widen with the evidence grammar: the published
    // gate-sig recipe hashes the values of `  CHECK: ` and `  EXPECT: ` exactly, so reading
    // `CHECK (measured at this head):` as an oracle would move every sig in the ledger on a
    // wording edit. A labelled line that is not one of those two is evidence text; so is a
    // line with no label at all. Measured and pinned by test/ledger.test.mjs (issue #12 guard).
    claimLines++;
    const f = line.match(/^  ([A-Z][^:]*): (.*)$/);
    const row = rows[rows.length - 1];
    if (f && f[1] === 'CHECK') { row.check = f[2]; labelled++; }
    else if (f && f[1] === 'EXPECT') { row.expect = f[2]; labelled++; }
    else if (f) { row.ev.push(`${f[1]}: ${f[2]}`); labelled++; }
    else row.ev.push(line.trim());
  }
}

// Published so a reader can see the audit saw the whole ledger, not part of it: a row
// the tool walks past would otherwise still be counted in the totals below.
const phasePrefixed = rows.filter((r) => /^[A-Z][0-9]+-/.test(r.name)).length;
console.log(`gate rows indexed: ${rows.length} (${rows.length - phasePrefixed} bare G ids, ${phasePrefixed} phase-prefixed)`);
console.log(`claim census: claim lines read ${claimLines} (labelled ${labelled}, unlabelled ${claimLines - labelled})`);

// (3) the recipe: the sig recorded for G7 is sha256(CHECK value + "\n" + EXPECT value)
const defects = [];
const g7 = rows.find((r) => r.name === 'G7');
const wantG7 = (g7.ev.join(' ').match(/gate-sig=([0-9a-f]{16})/) || [])[1];
const build = (r) => `${r.check}\n${r.expect}`;
const recipeOk = sha(build(g7)).slice(0, 16) === wantG7;
console.log(`recipe check on G7 (${wantG7}): ${recipeOk ? 'sha256(CHECK value + newline + EXPECT value) confirmed' : 'RECIPE DOES NOT REPRODUCE THE RECORDED SIG'}`);
if (!recipeOk) {
  defects.push(`G7: this file's own recipe does not reproduce the gate-sig recorded on G7 (${sha(build(g7)).slice(0, 16)} against ${wantG7}), so either the published recipe or the row is wrong and no gate-sig in this ledger can be re-derived`);
}

// (4) the declared exception, read out of the RECIPE paragraph instead of typed here and
// matched by id NUMBER: a lexical range ("G1" <= id <= "G3") also sweeps G10..G19 into the
// exemption in a ledger grown past G9, which exempts rows nobody declares broken.
const exc = (gatesText.match(/(G\d+(?:-G\d+)?) carry sigs written by an earlier runner/) || [])[1];
const documented = new Set();
if (exc) {
  const [lo, hi] = exc.split('-').map((s) => Number(s.slice(1)));
  for (const r of rows) {
    if (/^G\d+$/.test(r.name) && Number(r.name.slice(1)) >= lo && Number(r.name.slice(1)) <= hi) documented.add(r.name);
  }
}

let sigOk = 0;
const sigBad = [];
const noOracle = [];
let citeOk = 0;
const citeBad = [];
for (const r of rows) {
  const blob = r.ev.join('\n');
  const want = (blob.match(/gate-sig=([0-9a-f]{16})/) || [])[1];
  if (!want) {
    // A row the issue declares manual carries no CHECK/EXPECT, so it has no sig and
    // hashing an empty pair would call it broken. A row that DOES carry an oracle but
    // no sig is a real defect - it cannot be re-checked - and stays in sigBad.
    if (r.check || r.expect) {
      sigBad.push(`${r.name}: carries a CHECK/EXPECT but no gate-sig`);
      defects.push(`${r.name}: declares a CHECK/EXPECT but carries no gate-sig, so the recipe has nothing to re-derive and the row is unchecked`);
    } else noOracle.push(r.name);
  } else if (want === sha(build(r)).slice(0, 16)) sigOk++;
  else {
    sigBad.push(`${r.name} recorded ${want} recomputed ${sha(build(r)).slice(0, 16)}`);
    if (!documented.has(r.name)) {
      defects.push(`${r.name}: its recorded gate-sig does not recompute from the published recipe and the row is not covered by the exception "${exc || 'no exception paragraph in this file'}" - the oracle this row claims was edited, or its sig was never derivable`);
    }
  }

  // Every output hash cited anywhere in the row, resolved against the scratch index, the
  // tracked tree and the commit objects the row names (issue #15).
  // ACCEPTED CITATION SPELLINGS (issue #13): `output-sha256=`, `output=`, `driver=` and the
  // bare `sha256=`. The bare form is what this ledger's pinned-identity paragraphs write -
  // row G7's shot identities are cited that way - and until now this extractor skipped it,
  // so a pinned picture could age out of agreement with the file it names in total silence
  // (measured: 107 of this file's 64-hex citations sit on lines this loop reads, 7 of them
  // spelled bare and none of them ever resolved or reported). The longer alternatives come
  // first so `output-sha256=` is read once, not twice. The same alternation is in
  // scripts/ledger-name-evidence.py's name insertion and in the CITED reader of
  // test/ledger.test.mjs, which measures that agreement (issue #13's fix direction 1).
  const names = [...blob.matchAll(/\b((?:tmp|shots)\/[\w./-]+?\.(?:out|png|sh|html|js|mjs))\b/g)].map((x) => x[1]);
  // TRACKED NAMES (issue #15): a citation may also name a path this repo's own index holds.
  // Matched as exact index paths rather than as a widened filename regex, so a prose
  // mention of a file that exists nowhere becomes no citation at all - the old grammar's
  // discipline, extended to what a reviewer can actually open, not dissolved into any
  // word ending in .js.
  for (const p of tracked) if (blob.includes(p) && !names.includes(p)) names.push(p);
  // SPELLINGS (issue #13) plus LENGTH (issue #15): 64 hex is a recorded run output; 16 hex
  // is what the closed rows write when they pin the committed form of a tool or source
  // file (row G6: scripts/ledger-fill-g6.py output-sha256=88128e080a120116). Both are read;
  // hex64 below keeps the closed-box rule on run records alone - a source pin is not a
  // proof that an oracle ran.
  // A citation is read WITH its line: the file named beside a hash on the same claim line is
  // what that hash claims (measured while filling this fix: row-wide names let a mention of
  // GATES.md answer a question about src/ui/panel.js, which is technically true and useless).
  const cites = [];
  for (const line of blob.split('\n')) {
    const lineNames = [...line.matchAll(/\b((?:tmp|shots)\/[\w./-]+?\.(?:out|png|sh|html|js|mjs))\b/g)].map((x) => x[1]);
    for (const p of tracked) if (line.includes(p) && !lineNames.includes(p)) lineNames.push(p);
    lineNames.sort((a, b) => line.indexOf(a) - line.indexOf(b));
    const lineRefs = [...line.matchAll(/git show ([0-9a-f]{7,40}):([\w./-]+)/g)].map((x) => ({ ref: x[1], path: x[2] }));
    for (const m of line.matchAll(/(?:output-sha256|output|driver|sha256)=([0-9a-f]{64}|[0-9a-f]{16})(?![0-9a-f])/g))
      cites.push({ h: m[1], line, at: m.index, lineNames, lineRefs });
  }
  const hexes = cites.map((c) => c.h);
  const hex64 = hexes.filter((h) => h.length === 64);
  const refs = [...blob.matchAll(/git show ([0-9a-f]{7,40}):([\w./-]+)/g)].map((x) => ({ ref: x[1], path: x[2] }));
  for (const c of cites) {
    const h = c.h;
    // A commit pin answers only where it is spelled: a `git show <ref>:<path>` on another line
    // of the same row is that line's claim, not an answer to this hash (measured while filling
    // this fix: row G7 pins scripts/procedural-audit.mjs at output-sha256=e1a9e447e8aa6015 on
    // one line and names a commit for that path on a later line; letting the later line answer
    // the earlier hash moved one citation from "aged pin" to "resolved" on a true statement
    // about a different sentence - 3 resolved commit against 2 with the line-local rule).
    const rowRefs = c.lineRefs;
    const hitTracked = names.find((n) => tracked.has(n) && byName.get(n) === h);
    const hitPinRepo = h.length === 16 ? names.find((n) => tracked.has(n) && (byName.get(n) || '').startsWith(h)) : null;
    const hitPinScratch = h.length === 16 ? names.find((n) => !tracked.has(n) && (byName.get(n) || '').startsWith(h)) : null;
    const hitRef = rowRefs.find((o) => { const hh = refOf(o.ref, o.path); return hh && (h.length === 16 ? hh.startsWith(h) : hh === h); });
    const hitScratch = names.find((n) => !tracked.has(n) && byName.get(n) === h);
    if (hitTracked || hitPinRepo) { bump('resolved tracked'); citeOk++; continue; }
    if (hitRef) { bump('resolved commit'); citeOk++; continue; }
    if (hitScratch || hitPinScratch) { bump('resolved scratch'); citeOk++; continue; }
    const global = byHash.get(h);
    if (global) {
      bump('hashes of unnamed files');
      citeBad.push(`${r.name}: hash ${h.slice(0, 16)}... is the content of ${global}, which the row does not name`);
      continue;
    }
    // One citation, two honest sentences: the hash report names the file the row cites it
    // beside, so a reader can tell an aged pin from a hash that never existed.
    // Pairing is positional AND by kind. Positional: a name standing in front of THIS hash on
    // THIS line, closest first - on a line citing four pins, panel.js is not an answer to a
    // question about main.js (measured against this file: pairing every hash with the whole row
    // instead of its line puts 36 of 50 aged-citation notes on the wrong record). By kind: a
    // 16-hex pin claims the committed form of a repo file and a 64-hex hash claims a recorded
    // run output, so a run hash is never matched to a source file on the line unless the line
    // names no scratch file at all - the shape a row writes when it pins a tracked file's full
    // content (measured: without the kind rule 24 of 28 repo-side notes name a file no
    // 64-hex run record ever claims).
    const before = c.lineNames.map((n) => [n, c.line.lastIndexOf(n, c.at)]).filter(([, i]) => i >= 0)
      .sort((a, b) => b[1] - a[1]).map(([n]) => n);
    const pair = before.length ? before : (c.lineNames.length ? c.lineNames : names);
    const present = pair.map((n) => [n, byName.get(n)]).filter(([, hh]) => hh);
    const repoOnLine = present.filter(([n]) => tracked.has(n));
    const scratchOnLine = present.filter(([n]) => !tracked.has(n));
    const namesScratchOnLine = pair.some((n) => !tracked.has(n));
    const aged64 = h.length === 64 && !namesScratchOnLine
      ? repoOnLine.find(([, hh]) => hh !== h) : null;
    const near = (h.length === 16 ? repoOnLine.find(([, hh]) => !hh.startsWith(h)) : scratchOnLine.find(([, hh]) => hh !== h))
      || aged64;
    const absent = pair.find((n) => !byName.has(n) && !existsSync(n));
    const unread = [...new Set(rowRefs.filter((o) => refOf(o.ref, o.path) === null).map((o) => o.ref))];
    const aged = near && tracked.has(near[0])
      ? `matches no content git tracks at ${near[0]}, whose content in this tree hashes ${near[1].slice(0, 16)}...`
      : near ? `matches no scratch file on disk (the row does name ${near[0]}, whose content hashes ${near[1].slice(0, 16)}... instead)`
        : null;
    const tail = aged ? '' : absent ? `(named ${absent}, which this tree does not carry)`
      : unread.length ? `(commit${unread.length > 1 ? 's' : ''} ${unread.join(', ')} not readable in this tree)`
        : '(and nothing git tracks or holds at a commit named here)';
    bump('hashes matching nothing');
    citeBad.push(`${r.name}: hash ${h.slice(0, 16)}... ${aged || `matches no scratch file on disk ${tail}`}`);
  }
  // every file the row names, present or not - and which kind of absence that is
  for (const n of names) {
    if (byName.has(n) || existsSync(n)) continue;
    if (refs.some((o) => o.path === n)) {
      bump('names absent elsewhere');
      citeBad.push(`${r.name}: names ${n}, which this tree carries at no commit it names either`);
    } else if (tracked.has(n)) {
      bump('names absent elsewhere');
      citeBad.push(`${r.name}: names ${n} which is not on disk although git tracks it in this index`);
    } else if (hasGitIndex) {
      bump('names absent untracked');
      citeBad.push(`${r.name}: names ${n} which is not on disk - untracked in git, so a fresh checkout of this repo carries nothing to verify it against`);
    } else {
      bump('names absent elsewhere');
      citeBad.push(`${r.name}: names ${n} which is not on disk (this tree carries no git index to locate it against)`);
    }
  }
  // A closed box is a claim that the row's oracle ran. Text cannot prove a run happened, but
  // text can prove the row points at no recorded run at all - no 64-hex citation anywhere -
  // which is a defect in every tree, gitignored scratch dirs present or not.
  if (r.done && hex64.length === 0) {
    defects.push(`${r.name}: the box reads [x] while the row names no recorded run output (no 64-hex output citation), so its checkmark rests on prose`);
  }
}

for (const id of badIds) {
  defects.push(`${id}: row id is outside the published grammar ${ROW_ID}, so neither scripts/ledger-audit.mjs nor scripts/ledger-name-evidence.py can read the row it heads, and its CHECK/EXPECT would be attributed to the row before it`);
}
const dupIds = [...new Set(rows.map((r) => r.name).filter((n, i, a) => a.indexOf(n) !== i))];
for (const id of dupIds) {
  defects.push(`${id}: declared ${rows.filter((r) => r.name === id).length} times, so a gate-sig or a cited run cannot be attributed to one row`);
}

const withSig = rows.length - noOracle.length;
console.log(`\ngate-sig recomputes: ${sigOk}/${withSig} rows that declare one (of ${rows.length} indexed rows)`);
console.log(`rows declared without an oracle (manual evidence): ${noOracle.length} - ${noOracle.join(', ') || 'none'}`);
for (const b of sigBad) console.log(`  NOT RECOMPUTABLE: ${b}`);
console.log(`cited output hashes resolved to a file the row names: ${citeOk}`);
console.log(`cite census: resolved tracked ${kinds['resolved tracked'] || 0}, resolved commit ${kinds['resolved commit'] || 0}, resolved scratch ${kinds['resolved scratch'] || 0}, names absent untracked ${kinds['names absent untracked'] || 0}, hashes matching nothing ${kinds['hashes matching nothing'] || 0}${kinds['hashes of unnamed files'] ? `, hashes of unnamed files ${kinds['hashes of unnamed files']}` : ''}${kinds['names absent elsewhere'] ? `, names absent elsewhere ${kinds['names absent elsewhere']}` : ''}`);
for (const b of citeBad) console.log(`  CITE PROBLEM: ${b}`);

// (5) the verdict. What is refused here is what this tool can prove from the ledger text
// alone, in any tree: a recipe that does not reproduce its own anchor row, a sig that no
// longer recomputes beyond the declared exception, a row with an oracle but no sig, a closed
// row that names no recorded run, a row id outside the published grammar, a duplicated id.
// Cite RESOLUTION is reported and deliberately NOT refused: tmp/ and shots/ are gitignored,
// so a fresh checkout and every CI runner carry rows whose hashes cannot resolve - the four
// the RECIPE paragraph names as written before this tool existed. Hard-failing on that is
// permanent red no commit can repair, and it would make this audit runnable only in the one
// tree that still happens to hold its scratch files.
if (defects.length === 0) {
  console.log(`\nLEDGER AUDIT OK: ${sigOk} sigs recompute, the ${sigBad.length} that do not are the declared exception${exc ? ` (${exc})` : ''}, every closed row names a recorded run, and all ${rows.length} row ids are in the published grammar and unique`);
} else {
  console.log(`\nLEDGER AUDIT FAILED: ${defects.length} defect(s) provable from this file in any tree`);
  for (const d of defects) console.log(`  DEFECT: ${d}`);
  console.log('  (cite problems are reported, not refused - see the note above)');
  process.exitCode = 1;
}
