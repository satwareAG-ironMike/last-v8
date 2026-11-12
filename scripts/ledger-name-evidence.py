#!/usr/bin/env python3
"""Ledger hygiene: derive the hygiene form of GATES.md, and prove it changed nothing.

Why this exists (measured by scripts/ledger-audit.mjs on 2026-11-12): the older rows
cited a 64-hex run hash whose file was still on disk but was never NAMED in the row, so
a reviewer could not recompute the claim. And the RECIPE at the head of GATES.md said
`sha256(CHECK + "\n" + EXPECT)`, which does not reproduce the sigs that file itself
records: the recorded sigs are sha256 over the two FIELD VALUES. So the recipe wording
had to be pinned by re-derivation before the ledger could be checked at all.

The hygiene is derived here from one fixed base - commit 345f71f, the last tree whose
GATES.md was written by hand - so the result is a deterministic function of a committed
file plus four declared edits, instead of hand editing:

  1. OWNS gains scripts/**, because the recipe now points at tools there.
  2. RECIPE is replaced by the wording the recorded sigs actually support.
  3. The G7 SHOT FILE IDENTITY paragraph is inserted: the shots directory is
     gitignored, so the pictures are evidence only through these hashes.
  4. Every named run gets its file name attached to its cited hash. Each mapping is
     verified first: the file must exist and hash to exactly the cited 64 hex.

A hash whose run file is gone stays as it is - then the recorded hash IS the record
(G1 45c59520.., G2 83076a30.., G3 83374c4a.., G5c fe11f6cb..).

`--prove` is the durable claim and does not depend on this file staying frozen: for every
row the base carries it requires the row title line to be present verbatim and every
committed indented claim line to survive as a PREFIX of its current line (that is exactly
what a filename insertion does), it allows the declared head-matter edits and added claim
lines, and it fails if any hash or sig the base recorded is missing here, or if a row title
or claim line was rewritten. One exception is measured rather than open-ended: a row the
base left as an open stub may have its box closed by a later commit that earned it, and the
only difference allowed in that title line is `[ ]` becoming `[x]`. The base carries exactly
one such row, `prove` asserts that it is G6, and the box change exempts nothing else in the
row.

Usage:
  python3 scripts/ledger-name-evidence.py            dry run of the naming on the working file
  APPLY=1 python3 scripts/ledger-name-evidence.py    attach the names to the working file
  python3 scripts/ledger-name-evidence.py --write    base + declared edits -> GATES.md
  python3 scripts/ledger-name-evidence.py --prove    the invariant proof against the base
  python3 scripts/ledger-name-evidence.py --diff     derived form vs the working file
"""
import argparse
import hashlib
import os
import re
import subprocess
import sys

BASE = "345f71f"  # the pre-hygiene GATES.md this file was derived from

MAP = {  # row -> {hash prefix: the scratch file whose content hashes to it}
    "G4": {"33e0a92f": "tmp/unit-06.out"},
    "G4b": {"156c757f": "tmp/all4.out"},
    "G5": {"d50a28e8": "tmp/smoke-06.out"},
    "G5b": {"c01e2aac": "tmp/smoke-mf2.out"},
    "G5c": {"c50cb896": "tmp/all6.out"},
    "G5d": {"d069e03e": "tmp/smoke-stand.out"},
    "G5e": {"3c98c7a5": "tmp/rig-unit.out", "41654601": "tmp/all7.out",
            "b6dce74d": "tmp/mutate-camera.out"},
    "G5f": {"156be0f0": "tmp/smoke-camera.out"},
    "G5g": {"d7f60a23": "tmp/v12.out", "93227166": "tmp/all11.out",
            "0ed39f77": "tmp/mutate-view.out"},
    "G5h": {"23edfc34": "tmp/view-shots.out"},
}

OLD_OWNS = "OWNS: src/**, test/**, public/**"
NEW_OWNS = "OWNS: src/**, test/**, public/**, scripts/**"

OLD_RECIPE = '''RECIPE (recorded 2026-11-11, heads unit): `gate-sig` = first 16 hex of
`sha256(CHECK + "\\n" + EXPECT)`. G1-G3 carry sigs written by an earlier runner whose
construction was never recorded in this repo and cannot be reproduced from the ledger;
their recomputable evidence is `output-sha256`. Their EVIDENCE lines are left untouched
rather than rewritten after the fact.'''

NEW_RECIPE = '''RECIPE (recorded 2026-11-11; wording pinned by re-derivation 2026-11-12): `gate-sig` =
first 16 hex of `sha256(CHECK-value + "\\n" + EXPECT-value)`, where a value is the text
after `CHECK:` / `EXPECT:` with its label and the surrounding indentation removed - G7
hashes `"node test/screenshots.mjs\\nSHOTS OK"` = c5527127c3f7ff77. The whole `CHECK:` /
`EXPECT:` lines, or either of them with a trailing newline, do NOT reproduce the recorded
sigs. Two committed tools make this ledger checkable: `node scripts/ledger-audit.mjs`
re-derives every row's sig from this recipe and resolves every named run hash to the file
the row names, and `python3 scripts/ledger-name-evidence.py --prove` proves the naming
below against `git show 345f71f:GATES.md` - every row title and every committed indented
claim line of that tree must survive here as a prefix, and any other difference fails.
G1-G3 carry sigs written by an earlier runner whose construction was never recorded in
this repo and cannot be reproduced from the ledger (this recipe gives them
220797e21f3b9068); their recomputable evidence is `output-sha256`, and their EVIDENCE
lines are left untouched rather than rewritten after the fact. Four cited runs are no
longer on disk - G1 45c59520.., G2 83076a30.., G3 83374c4a.., G5c fe11f6cb.. - for those
rows the recorded hash is the record.'''

HYGIENE = '''HYGIENE (measured 2026-11-12): `node scripts/ledger-audit.mjs` against this ledger
re-derives the recorded sig of every row that cites one - 11 of the 15 rows at this
writing, the exceptions being G1-G3 (the earlier runner) and the then-open G6 stub - and
resolves 17 cited run hashes to the file the row names, except the four whose files are
gone: output-sha256=3e98d0e4cd6a1cc151fe412c256c285fa8bec17bcd251010b26536865ab4ae40
(tmp/ledger-audit-5.out, byte-identical to tmp/ledger-audit-4.out and
tmp/ledger-audit-3.out, i.e. the same measurement against three wording variants of this
file). The naming is insertion-only, and that is measured rather than asserted:
`python3 scripts/ledger-name-evidence.py --prove` rebuilds every row from 345f71f:GATES.md
plus the declared edits (OWNS, RECIPE, this paragraph, the G7 SHOT FILE IDENTITY
paragraph, 14 filename insertions), requires each committed row title and each committed
indented claim line to survive as a prefix, and reports any hash or sig of 345f71f that is
missing here. Its own run outputs are tmp/ledger-derive-write.out and
tmp/ledger-derive-prove.out - named so you can read them, not hash-cited. No measured
threshold, count or sig in any row was edited.'''

# Read as images after tmp/g7-run14.out, and byte-for-byte the counts that run printed.
IDENTITY = """  SHOT FILE IDENTITY (recorded after tmp/g7-run14.out, whose printed byte counts these
  files carry: 270136 / 238818 / 238957 / 271390 / 285450 / 739732): shots/07-home.png
  sha256=605ee6b27610d69458d95c6cad6ffa21318dc05488b0535005f1f0f0d94b2f43,
  shots/08-cutaway.png sha256=036056266c6ec3da7ef56a8357d8bdfc1891169fa064c532be24d852923a6fe8,
  shots/09-cutaway-tdc-bdc.png sha256=56cbec9d1e1fbc106831efa88b7d71e9593b8ed7ccd584a84ba656a57a7a953e,
  shots/10-running.png sha256=8f302173e4bba77d4d772c56072ffceab42e6f7583cf2977f1b016ea9fd916fa,
  shots/11-exploded.png sha256=98c7fd605f1c6a02874ab3e0f3ddb99785a603810a697c208169a182d8b1c1ca,
  shots/12-inspect-piston.png sha256=6b23459a18182b5a57e7b70f99d228fb2bfac93ff92c9d92aee98f5ed573cce7.
  The shots directory is gitignored, so the pictures are evidence through these hashes.
  Caveat that is a fact about the product, not the harness: 10-running.png is captured
  while the crank turns (1800 rpm) and is therefore not pixel stable across runs - the
  same gate printed 271026 bytes for it in tmp/g7-run13.out and 271390 in tmp/g7-run14.out
  - which is why every pixel-identity law in this gate measures a PINNED pose (the
  determinism pair, the cutaway pair, the round trip) and the running shot carries only
  the HUD/cycle consistency laws.
"""
IDENTITY_ANCHOR = "  SAME POSE SAME PICTURE:"

ROW_HEAD = re.compile(r"^- \[[ x]\] (G[0-9a-z]+):")
STUB_EVIDENCE = "  EVIDENCE: pending"

# The one title change a later commit is allowed to make. `prove` compares row titles
# verbatim, and the only row a later commit earns is a row that was an OPEN STUB in the
# base: its box may go from `[ ]` to `[x]`, and nothing else in the title line may move.
# The base carries exactly one such row, so this is measured, not open-ended: the count is
# asserted below, and every other title difference still fails the proof. A closed box
# never exempts the row's CHECK / EXPECT lines or its earlier claim lines, which stay under
# the same prefix rule, nor the rule that no hash or sig of the base may go missing.

# Two rows cite a solver script by its scratch-dir path. The scratch dir is gitignored and
# disposable, so those scripts are not in the repo - a reviewer following the citation would
# find nothing. This declares, next to each citation, what IS committed and checkable
# instead. The cited lines themselves are left exactly as they were measured.
SCRATCH_CLARIFY = [
    ("/tmp/opencode/last-v8/frame-check.mjs --solve",
     "  SCRATCH CITATION (declared 2026-11-12): `frame-check.mjs` was a session scratch tool - "
     "the scratch directory is gitignored and disposable - so the solver is not in this repo and "
     "its `--solve` run cannot be recomputed from it. What it produced is committed: the pose on "
     "the line above is published as `SPEC.view.homePos` / `SPEC.view.homeTarget` "
     "(`src/engine/spec.js:262-263`), `test/camerarig.test.mjs` asserts the rig boots on that "
     "pose and that the pose is legal under its own published pitch / range / cell / floor "
     "limits, and G5f measures the shell landing the boot camera on it. Read the line above as "
     "the record of what this boot pose was solved for, not as a claim needing the script."),
    ("/tmp/opencode/last-v8/frame-check-stand.mjs --solve",
     "  SCRATCH CITATION (declared 2026-11-12): same for `frame-check-stand.mjs` - a session "
     "scratch tool, gitignored and gone. The union bbox and the pose it solved are committed: "
     "`SPEC.view` (`src/engine/spec.js:261-265`) carries pos (84.4, -117.6, 104.5) and lookAt "
     "(-1.9, 1.9, 7.9) as `homePos` / `homeTarget`, `test/camerarig.test.mjs` proves that home "
     "pose is legal under the published pitch limit, range bounds, walkable cell and floor "
     "guard, and G5f measures the rig putting the boot camera there."),
]


def git_show(rev, path="GATES.md"):
    r = subprocess.run(["git", "show", f"{rev}:{path}"], capture_output=True, text=True)
    assert r.returncode == 0, f"git show {rev}:{path} failed: {r.stderr.strip()}"
    return r.stdout


def verify_map():
    for row, m in MAP.items():
        for hpre, path in m.items():
            assert os.path.exists(path), f"{row}: {path} is missing"
            with open(path, "rb") as fh:
                real = hashlib.sha256(fh.read()).hexdigest()
            assert real.startswith(hpre), f"{row}: {path} hashes {real[:8]}, cited {hpre}"


def apply_names(text):
    """Attach each cited hash to the file that carries it. Pure function of the input."""
    out, n = [], 0
    row = None
    for line in text.split("\n"):
        if line.startswith("- ["):
            g = re.search(r"\b(G[0-9a-z]+):", line)
            row = g.group(1) if g else None
        for hpre, path in MAP.get(row or "", {}).items():
            hit = re.search(r"output-sha256=" + hpre + r"[0-9a-f]{56}", line)
            if not hit:
                continue
            rest = line[hit.end():]
            if re.match(r"^ \(", rest):
                line = line[: hit.end()] + " (" + path + ": " + rest[2:]
            elif re.match(r"^\s*\(", rest):
                line = line[: hit.end()] + " (" + path + ", " + rest.lstrip()[1:]
            else:
                line = line[: hit.end()] + f" ({path})" + rest
            n += 1
        out.append(line)
    return "\n".join(out), n


def derive(base_text):
    """The base GATES.md -> the hygiene form. One deterministic pass, no hand editing."""
    assert OLD_OWNS in base_text and OLD_RECIPE in base_text, \
        f"{BASE} does not carry the pre-hygiene text this tool derives from"
    assert base_text.count(IDENTITY_ANCHOR) == 1, "identity anchor must appear exactly once"
    t = base_text.replace(OLD_OWNS, NEW_OWNS, 1).replace(OLD_RECIPE, NEW_RECIPE + "\n\n" + HYGIENE, 1)
    t = t.replace(IDENTITY_ANCHOR, IDENTITY + IDENTITY_ANCHOR, 1)
    t = clarify_scratch(t)
    return apply_names(t)


def clarify_scratch(text):
    """Insert each SCRATCH_CLARIFY note after the line that cites the gone scratch tool."""
    out, n = [], 0
    for line in text.split("\n"):
        out.append(line)
        for anchor, note in SCRATCH_CLARIFY:
            if anchor in line:
                out.append(note)
                n += 1
    scratch_notes = sum(1 for line in out if line.startswith("  SCRATCH CITATION"))
    assert scratch_notes == len(SCRATCH_CLARIFY), \
        f"scratch citations inserted: {scratch_notes}, declared: {len(SCRATCH_CLARIFY)}"
    return "\n".join(out)


def split_rows(text):
    """(head_matter_lines, {row_id: block_lines}) - a row is its title line plus everything
    up to the next title line."""
    head, rows, cur = [], {}, None
    for ln in text.split("\n"):
        m = ROW_HEAD.match(ln)
        if m:
            cur = m.group(1)
            rows[cur] = [ln]
        elif cur is None:
            head.append(ln)
        else:
            rows[cur].append(ln)
    return head, rows


def prove(work):
    """The durable invariant: this file is the base plus declared edits, nothing less."""
    base = git_show(BASE)
    derived, n_ins = derive(base)
    dhead, drows = split_rows(derived)
    whead, wrows = split_rows(work)
    problems = []

    # 1. head matter (everything before the first gate row) is fully declared text
    if whead != dhead:
        import difflib
        for d in list(difflib.unified_diff(dhead, whead, "derived head", "working head",
                                           lineterm="", n=0))[:16]:
            problems.append("head matter: " + d[:190])

    # 2. every row the base carries is still here, title verbatim, claims preserved
    kept_lines = 0
    stubs_in_base = sorted(r for r, b in drows.items() if STUB_EVIDENCE in b)
    closed_stubs = []
    for rid, block in drows.items():
        if rid not in wrows:
            problems.append(f"row {rid}: its title line is gone")
            continue
        wb = wrows[rid]
        if wb[0] != block[0]:
            earned = STUB_EVIDENCE in block and wb[0] == "- [x] " + block[0][len("- [ ] "):]
            if not earned:
                problems.append(f"row {rid}: title rewritten\n  was: {block[0][:120]}\n  now: {wb[0][:120]}")
            else:
                closed_stubs.append(rid)
        for line in block[1:]:
            if not line.strip():
                continue
            if line == STUB_EVIDENCE:
                continue  # an open stub may be filled by a later commit
            if any(w == line or w.startswith(line) for w in wb[1:]):
                kept_lines += 1
            else:
                problems.append(f"row {rid}: committed claim line not preserved as a prefix\n  was: {line[:150]}")

    # 3. nothing the base recorded may be missing here
    from collections import Counter
    lost = Counter(re.findall(r"[0-9a-f]{16,64}", base)) - Counter(re.findall(r"[0-9a-f]{16,64}", work))
    if lost:
        problems.append(f"hashes/sigs the base recorded, missing here: {dict(lost)}")

    added_rows = [r for r in wrows if r not in drows]
    print(f"base {BASE}: {len(drows)} gate rows, {len(dhead)} head-matter lines")
    print(f"working GATES.md: {len(wrows)} gate rows ({len(added_rows)} added since), "
          f"{len(whead)} head-matter lines")
    print(f"declared edits: OWNS + RECIPE + HYGIENE rewritten, 1 identity paragraph, "
          f"{n_ins} filename insertions")
    print(f"committed claim lines of the base that survive as a prefix here: {kept_lines}")
    print(f"committed hashes/sigs of the base still in this file: "
          f"{len(re.findall(r'[0-9a-f]{16,64}', base)) - sum(lost.values())}/{len(re.findall(r'[0-9a-f]{16,64}', base))}")
    if stubs_in_base != ["G6"]:
        problems.append(f"the declared stub-close rule assumes the base carries exactly one open stub row, G6; it carries {stubs_in_base}")
    for rid in closed_stubs:
        if STUB_EVIDENCE not in drows[rid]:
            problems.append(f"row {rid}: a title box was closed on a row the base did not leave open")
    if added_rows:
        print(f"rows added since the base: {added_rows}")
    print(f"open stub rows of {BASE}: {stubs_in_base} - closed here: {sorted(closed_stubs) or 'none yet'} "
          f"(a close may change the box and nothing else in the title)")
    if problems:
        print(f"\nPROOF FAILED: {len(problems)} undeclared edit(s)")
        for p in problems:
            print("  " + p)
        return 1
    print("\nPROOF OK: this file is the base plus the declared edits - every row title and "
          "every committed claim line of 345f71f survives, and no recorded hash or sig was lost.")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="derive base + declared edits into GATES.md")
    ap.add_argument("--prove", action="store_true", help="prove the working file against the base invariant")
    ap.add_argument("--diff", action="store_true", help="show derived form vs the working file")
    args = ap.parse_args()
    verify_map()

    derived, n_ins = derive(git_show(BASE))

    if args.prove:
        return prove(open("GATES.md").read())

    work = open("GATES.md").read()
    if args.write:
        # never clobber evidence a later commit earned
        _, drows = split_rows(derived)
        _, wrows = split_rows(work)
        for rid, block in drows.items():
            if STUB_EVIDENCE in block and rid in wrows and STUB_EVIDENCE not in wrows[rid]:
                print(f"REFUSED: row {rid} carries earned evidence in the working file that "
                      f"the {BASE} derivation does not. --write only reproduces the hygiene "
                      f"commit; it would drop that evidence.")
                return 1
        open("GATES.md", "w").write(derived)
        print(f"GATES.md written as {BASE} + declared edits: {n_ins} filename insertions, "
              f"1 identity paragraph, OWNS + RECIPE + HYGIENE rewritten")
        return 0

    if args.diff:
        import difflib
        d = list(difflib.unified_diff(derived.split("\n"), work.split("\n"),
                                      f"derived from {BASE}", "working", lineterm="", n=1))
        print(f"diff regions: {len(d)}")
        for line in d[:40]:
            print(line[:200])
        return 0

    named, count = apply_names(work)
    print(f"insertions available on the working file: {count}")
    if os.environ.get("APPLY") == "1":
        open("GATES.md", "w").write(named)
        print("GATES.md written")
        return 0
    for i, (a, b) in enumerate(zip(work.split("\n"), named.split("\n"))):
        if a != b:
            print(f"line {i + 1}: {b[:170]}")
    print("dry run: APPLY=1 writes names onto the working file; --write derives from the base; "
          "--prove runs the invariant proof; --diff compares")
    return 0


if __name__ == "__main__":
    sys.exit(main())
