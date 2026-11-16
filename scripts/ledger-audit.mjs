// Ledger audit: recompute every gate-sig the way the recipe at the head of GATES.md
// defines it, and check every evidence file the ledger names against the hash it cites.
// Written after the G7 entry, because a ledger a reviewer cannot recompute is a list of
// claims, not a ledger. Pure text + hashing: it measures nothing of the product and
// touches no source file, so it can run at any time.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

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

// (2) read the rows. One row-id grammar, shared with ROW_HEAD in
// scripts/ledger-name-evidence.py: the bare G<id> ids this ledger used up to G7, and the
// phase-prefixed ids issue #8 declares (P1-G1, A1-G9, P2-G5, A2-G5). A row either tool
// cannot read is a row nobody checks - its CHECK/EXPECT lines would be silently
// attributed to the previous row, which is what broke the recipe check on G7 once.
const ROW_ID = String.raw`(?:[A-Z][0-9]+-)?G[0-9a-z]+`;
const rows = [];
for (const line of readFileSync('GATES.md', 'utf8').split('\n')) {
  const m = line.match(new RegExp(`^- \\[( |x)\\] (${ROW_ID}): (.*)$`));
  if (m) rows.push({ done: m[1] === 'x', name: m[2], title: m[3], check: '', expect: '', ev: [] });
  else if (rows.length) {
    const f = line.match(/^  (CHECK|EXPECT|EVIDENCE|NOTE|[A-Z][A-Z ()/,-]{2,}): (.*)$/);
    if (f) {
      if (f[1] === 'CHECK') rows[rows.length - 1].check = f[2];
      else if (f[1] === 'EXPECT') rows[rows.length - 1].expect = f[2];
      else rows[rows.length - 1].ev.push(`${f[1]}: ${f[2]}`);
    }
  }
}

// Published so a reader can see the audit saw the whole ledger, not part of it: a row
// the tool walks past would otherwise still be counted in the totals below.
const phasePrefixed = rows.filter((r) => /^[A-Z][0-9]+-/.test(r.name)).length;
console.log(`gate rows indexed: ${rows.length} (${rows.length - phasePrefixed} bare G ids, ${phasePrefixed} phase-prefixed)`);

// (3) the recipe: the sig recorded for G7 is sha256(CHECK value + "\n" + EXPECT value)
const g7 = rows.find((r) => r.name === 'G7');
const wantG7 = (g7.ev.join(' ').match(/gate-sig=([0-9a-f]{16})/) || [])[1];
const build = (r) => `${r.check}\n${r.expect}`;
console.log(`recipe check on G7 (${wantG7}): ${sha(build(g7)).slice(0, 16) === wantG7 ? 'sha256(CHECK value + newline + EXPECT value) confirmed' : 'RECIPE DOES NOT REPRODUCE THE RECORDED SIG'}`);

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
    if (r.check || r.expect) sigBad.push(`${r.name}: carries a CHECK/EXPECT but no gate-sig`);
    else noOracle.push(r.name);
  } else if (want === sha(build(r)).slice(0, 16)) sigOk++;
  else sigBad.push(`${r.name} recorded ${want} recomputed ${sha(build(r)).slice(0, 16)}`);

  // every output hash cited anywhere in the row, resolved against the whole scratch index
  const names = [...blob.matchAll(/\b((?:tmp|shots)\/[\w./-]+?\.(?:out|png|sh|html|js|mjs))\b/g)].map((x) => x[1]);
  for (const h of [...blob.matchAll(/(?:output|driver|output-sha256)=([0-9a-f]{64})/g)].map((x) => x[1])) {
    const named = names.find((n) => byName.get(n) === h);
    if (named) { citeOk++; continue; }
    const global = byHash.get(h);
    citeBad.push(`${r.name}: hash ${h.slice(0, 16)}... ${global ? `is the content of ${global}, which the row does not name` : 'matches no scratch file on disk'}`);
  }
  // every scratch file the row names, present or not
  for (const n of names) {
    if (!byName.has(n) && !existsSync(n)) citeBad.push(`${r.name}: names ${n} which is not on disk`);
  }
}

const withSig = rows.length - noOracle.length;
console.log(`\ngate-sig recomputes: ${sigOk}/${withSig} rows that declare one (of ${rows.length} indexed rows)`);
console.log(`rows declared without an oracle (manual evidence): ${noOracle.length} - ${noOracle.join(', ') || 'none'}`);
for (const b of sigBad) console.log(`  NOT RECOMPUTABLE: ${b}`);
console.log(`cited output hashes resolved to a file the row names: ${citeOk}`);
for (const b of citeBad) console.log(`  CITE PROBLEM: ${b}`);
