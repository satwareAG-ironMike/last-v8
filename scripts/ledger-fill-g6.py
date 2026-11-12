#!/usr/bin/env python3
"""Write the GATES.md G6 row from its draft, or refuse.

Committed on purpose: the G6 row names this file, so the row's own writer is checkable
from the repo and not only from gitignored scratch. The draft and the token file it reads
(tmp/g6-entry-update-draft.md, tmp/g6-tokens.txt) are scratch and disposable; what this
file claims is the set of checks it prints before it writes, plus the hash the row records
of it. Re-running it on a tree whose G6 row already carries earned evidence refuses.

The draft carries ⟪TOKENS⟫ that only a measured run or record can fill, and no token may
survive into the row.
"""

import hashlib
import os
import re
import sys

STUB = """- [ ] G6: every control (START/STOP, RPM, SLOW-MO, CUTAWAY, EXPLODED, ASSEMBLE, INSPECT, RESET CAMERA) is functional
  CHECK: node test/controls.smoke.mjs
  EXPECT: CONTROLS OK
  EVIDENCE: pending
"""

RECORD = "tmp/mutate-panel.out"
DRAFT = "tmp/g6-entry-update-draft.md"
TOKENS = "tmp/g6-tokens.txt"


def sha256(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def main():
    apply = "--apply" in sys.argv[1:]

    tok = {}
    for line in open(TOKENS):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        k, _, v = line.partition("=")
        tok[k.strip()] = v.strip()

    rec = open(RECORD).read()
    tl = re.search(r"== tally: surprises\+pattern-bad\+diffs (\d+)", rec)
    assert tl, "record: no tally line"
    assert tl.group(1) == "0", f"record tally is {tl.group(1)}, not 0"
    assert "MUTATE PANEL OK" in rec, "record does not end MUTATE PANEL OK"
    assert "MUTATE PANEL ABORT" not in rec, "record aborted"
    # a surprise is a VERDICT in the second column of a case row, never the tally label
    sur = re.findall(r"^\S+\s+surprise\b", rec, re.M)
    assert not sur, f"record contains {len(sur)} surprise row(s): {[s.split()[0] for s in sur]}"
    assert "PATTERN-BAD" not in rec, "record contains a PATTERN-BAD row"
    assert "SYNTAX-BAD" not in rec, "record contains a SYNTAX-BAD row"
    restored = re.findall(r"  identical: (\S+)", rec)
    assert len(restored) == 4, f"record restored {len(restored)} files, expected 4"
    rec_sha = sha256(RECORD)
    assert rec_sha == tok["RECORD-SHA"], f"record hashes {rec_sha}, tokens say {tok['RECORD-SHA']}"
    red = len(re.findall(r"^\S+\s+RED\s+findings=", rec, re.M))
    green = len(re.findall(r"^\S+\s+GREEN\s+findings=", rec, re.M))
    assert tok["RECORD-RED"] == str(red), f"record has {red} RED rows, token says {tok['RECORD-RED']}"
    assert tok["RECORD-GREEN"] == str(green), f"record has {green} GREEN rows, token says {tok['RECORD-GREEN']}"
    assert tok["RECORD-TALLY"] == tl.group(1), "record tally token does not match the record"

    run_file, run_sha = tok["RUN-FILE"], tok["RUN-SHA"]
    got = sha256(run_file)
    assert got == run_sha, f"{run_file} hashes {got}, token says {run_sha}"
    out = open(run_file).read()
    assert "CONTROLS OK" in out, f"{run_file} does not contain CONTROLS OK"
    assert "CONTROLS INCOMPLETE" not in out, f"{run_file} contains CONTROLS INCOMPLETE"
    assert "CONTROLS FAIL" not in out, f"{run_file} contains CONTROLS FAIL"

    shot_file, shot_sha = tok["SHOT-FILE"], tok["SHOT-SHA"]
    got = sha256(shot_file)
    assert got == shot_sha, f"{shot_file} hashes {got}, token says {shot_sha}"

    for name in ("REPLAY-FILE", "PROVE-FILE", "AUDIT-FILE"):
        if name in tok:
            sha256(tok[name])  # must exist on disk

    draft = open(DRAFT).read()
    # The draft's own prose quotes the string "- [x] G6:" while explaining what the writer
    # refuses, so a first-occurrence search picks the prose. Anchor on the row title line.
    m = re.search(r"(?m)^- \[x\] G6: ", draft)
    assert m, "the draft carries no G6 row title line"
    assert draft.rindex("- [x] G6: ") == m.start(), "the draft quotes the row title twice"
    row = draft[m.start():]
    if not row.endswith("\n"):
        row += "\n"
    for k, v in tok.items():
        row = row.replace(f"⟪{k}⟫", v)
    left = re.findall(r"⟪[A-Z0-9-]+⟫", row)
    assert not left, f"placeholders left: {left}"
    assert "⟪" not in row

    gates = open("GATES.md").read()
    assert gates.count(STUB) == 1, "the G6 stub block is not present exactly once"
    assert gates.count("- [x] G6:") == 0, "a G6 row is already written"
    new = gates.replace(STUB, row, 1)

    # (3) every citation this row makes must resolve against the file it names.
    CIT = re.compile(r"([A-Za-z0-9_./-]+\.(?:out|png|sh|py|mjs|js|html)) +output-sha256=([0-9a-f]+)")
    cites = CIT.findall(row)
    assert cites, "the filled row cites no evidence file at all"
    resolved, problems = 0, []
    for path, hexs in cites:
        if hexs.endswith("…"):
            hexs = hexs[:-1]  # an abbreviated citation is still a prefix claim
        if not re.fullmatch(r"[0-9a-f]{16}|[0-9a-f]{64}", hexs):
            problems.append(f"{path}: cited hash is {len(hexs)} hex, not 16 or 64")
            continue
        if not os.path.exists(path):
            problems.append(f"{path}: cited as evidence but not on disk")
            continue
        real = sha256(path)
        if not real.startswith(hexs):
            problems.append(f"{path}: disk hashes {real[:24]}..., the row names {hexs[:24]}...")
            continue
        resolved += 1
    print(f"evidence citations in the row: {len(cites)}, resolved against the file on disk: {resolved}")
    for p in problems:
        print(f"  CITE PROBLEM: {p}")
    assert not problems, f"{len(problems)} citation(s) in this row would not resolve"

    labeled = re.findall(r"^  ([A-Z][A-Z ()/,-]{1,70}):", row, re.M)
    print(f"label lines the audit can read: {len(labeled)} ({', '.join(labeled)})")
    unresolved = []
    for line in row.split("\n"):
        if not re.match(r"^  (CHECK|EXPECT|EVIDENCE|NOTE|[A-Z][A-Z ()/,-]{2,}):", line):
            for _ in CIT.finditer(line):
                unresolved.append(line.strip()[:60])
    assert not unresolved, [f"hash cited on a line the audit cannot read: {u}" for u in unresolved]

    a, b = gates.split("\n"), new.split("\n")
    stub_lines = STUB.rstrip("\n").split("\n")
    removed = [l for l in a if l not in b]
    kept_stub = [l for l in stub_lines if l in b]
    added = [l for l in b if l not in a]
    assert len(a) - len(b) == len(stub_lines) - len(row.rstrip("\n").split("\n")), \
        f"line count moved by {len(b) - len(a)}, expected {len(row.rstrip(chr(10)).split(chr(10))) - len(stub_lines)}"
    assert all(l in stub_lines for l in removed), "a line outside the G6 stub was removed"
    print(f"stub lines: {len(stub_lines)} - replaced by this row's {len(row.rstrip(chr(10)).split(chr(10)))} lines")
    for l in removed:
        print(f"  stub line dropped: {l[:90]}")
    for l in kept_stub:
        print(f"  stub line the row also carries, unchanged: {l[:60]}")
    print(f"lines net added: {len(b) - len(a)} (of {len(added)} distinct new lines)")
    print(f"record: {rec_sha[:16]}... {red} RED / {green} GREEN, tally {tl.group(1)}, restored {len(restored)} files")
    print(f"run: {run_file} {run_sha[:16]}... CONTROLS OK")
    print(f"shot: {shot_file} {shot_sha[:16]}...")
    if apply:
        open("GATES.md", "w").write(new)
        print("GATES.md written")
    else:
        print("dry run: pass --apply to write")
    return 0


if __name__ == "__main__":
    sys.exit(main())
