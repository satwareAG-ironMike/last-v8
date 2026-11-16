#!/usr/bin/env bash
# Record one gate run so that the hash a GATES.md row cites is re-derivable.
#
# Why this exists: `node --test` stamps every test line with that run's wall-clock
# duration and prints a total `duration_ms`, so a raw log hashes differently on every
# re-run. A row that cites such a hash cites a snapshot of a stopwatch, not a measurement:
# nobody can reproduce it, which is exactly the failure scripts/ledger-audit.mjs reports as
# "hash ... matches no scratch file on disk" for the older rows.
#
# This writes the run's own stdout+stderr with the per-test durations and the run total
# removed, plus one trailing RECORD line carrying the command, its exit code and the counts
# node's own summary printed. Everything the oracle asserts stays byte-for-byte.
#
# Usage: scripts/ledger-run.sh <record-file> <command> [args...]
# Exit code: the recorded command's exit code, so a gate run fails the same way the gate
# does. The record file is scratch (tmp/ is gitignored); its hash belongs in the row.
set -u -o pipefail

if [ "$#" -lt 3 ]; then
  echo "usage: scripts/ledger-run.sh <record-file> <command> [args...]" >&2
  exit 2
fi

out=$1
shift
mkdir -p "$(dirname "$out")"

# 3.11 keeps the captured stream out of a pipe buffer limit; the file is scratch space.
"$@" >"$out.raw" 2>&1
code=$?

{
  sed -E 's/ \([0-9]+\.?[0-9]*ms\)$//; /^ℹ duration_ms/d' "$out.raw"
  tests=$(grep -E '^ℹ tests [0-9]+$' "$out.raw" | tail -1 | awk '{print $3}')
  pass=$(grep -E '^ℹ pass [0-9]+$' "$out.raw" | tail -1 | awk '{print $3}')
  fail=$(grep -E '^ℹ fail [0-9]+$' "$out.raw" | tail -1 | awk '{print $3}')
  if [ -n "$fail" ]; then
    echo "RECORD: command=$* exit=$code tests=${tests:-0} pass=${pass:-0} fail=${fail:-0}"
  else
    echo "RECORD: command=$* exit=$code"
  fi
} >"$out"

rm -f "$out.raw"
cat "$out"
exit "$code"
