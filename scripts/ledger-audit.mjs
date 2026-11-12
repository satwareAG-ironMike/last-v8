// Ledger audit: recompute every gate-sig the way the recipe at the head of GATES.md
// defines it, and check every evidence file the ledger names against the hash it cites.
// Written after the G7 entry, because a ledger a reviewer cannot recompute is a list of
// claims, not a ledger. Pure text + hashing: it measures nothing of the product and
// touches no source file, so it can run at any time.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

// (1) index every scratch file the harness ever wrote, by content hash
const byHash = new Map();
const byName = new Map();
for (const dir of ['tmp', 'shots']) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (!ent.isFile()) continue; // tmp/mutate-panel/ holds the driver's scratch copies
    const f = ent.name;
    const p = `${dir}/${f}`;
    const h = sha(readFileSync(p));
    byHash.set(h, p);
    byName.set(p, h);
  }
}

// (2) read the rows
const rows = [];
for (const line of readFileSync('GATES.md', 'utf8').split('\n')) {
  const m = line.match(/^- \[( |x)\] (G[0-9a-z]+): (.*)$/);
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

// (3) the recipe: the sig recorded for G7 is sha256(CHECK value + "\n" + EXPECT value)
const g7 = rows.find((r) => r.name === 'G7');
const wantG7 = (g7.ev.join(' ').match(/gate-sig=([0-9a-f]{16})/) || [])[1];
const build = (r) => `${r.check}\n${r.expect}`;
console.log(`recipe check on G7 (${wantG7}): ${sha(build(g7)).slice(0, 16) === wantG7 ? 'sha256(CHECK value + newline + EXPECT value) confirmed' : 'RECIPE DOES NOT REPRODUCE THE RECORDED SIG'}`);

let sigOk = 0;
const sigBad = [];
let citeOk = 0;
const citeBad = [];
for (const r of rows) {
  const blob = r.ev.join('\n');
  const want = (blob.match(/gate-sig=([0-9a-f]{16})/) || [])[1];
  if (want && want === sha(build(r)).slice(0, 16)) sigOk++;
  else sigBad.push(`${r.name} recorded ${want ?? 'none'} recomputed ${sha(build(r)).slice(0, 16)}`);

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

console.log(`\ngate-sig recomputes: ${sigOk}/${rows.length} rows`);
for (const b of sigBad) console.log(`  NOT RECOMPUTABLE: ${b}`);
console.log(`cited output hashes resolved to a file the row names: ${citeOk}`);
for (const b of citeBad) console.log(`  CITE PROBLEM: ${b}`);
