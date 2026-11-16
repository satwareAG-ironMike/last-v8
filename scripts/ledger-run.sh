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

# Pin the reporter the run is recorded in. node picks its reporter from its own version and
# from whether stdout is a terminal: node 24 on this workstation defaults to the spec shape
# (`✔ name (12ms)` / `ℹ pass 6`), node 22 on the GitHub runner defaults to TAP
# (`ok 1 - name` / `  duration_ms: 12.3` / `# pass 6`). Measured on CI run 43917583366: the
# same bare CHECK line therefore hashed differently per host, which broke this tool's own
# gate on the runner. A tool whose entire job is to make a hash reproducible has to fix the
# shape it records, so the reporter is pinned through NODE_OPTIONS - one mechanism, which
# also reaches a recorded `npm test`, whose own script this tree does not control. An
# explicit `--test-reporter` in the command still wins: node applies CLI args over
# NODE_OPTIONS, measured by recording the same file in both shapes.
argv=("$@")
has_test=0; has_reporter=0
for a in "${argv[@]}"; do
  case "$a" in
    --test) has_test=1 ;;
    --test-reporter*) has_reporter=1 ;;
  esac
done
# Exactly one source of the reporter, always. This recorder also runs inside
# test/ledger.test.mjs, which records a run of its own, so a pin set by an outer recorded run
# is already in NODE_OPTIONS when the inner one starts - and node refuses the same option
# twice (`ERR_INVALID_ARG_VALUE: item arg must not appear more than once in NODE_OPTIONS`),
# which showed up as the recorded command exiting 1 with no output at all. Measured, then
# fixed: any reporter token already in the environment is removed first, and the reporter is
# then supplied from whichever source the run actually names - the command's own argv if it
# has one (an explicit `--test-reporter=tap` control stays a tap control), otherwise the pin.
strip_reporter() {
  local rest="$1" token kept=""
  for token in $rest; do
    case "$token" in
      --test-reporter | --test-reporter=*) ;;
      *) kept="${kept:+$kept }$token" ;;
    esac
  done
  printf '%s' "$kept"
}
base_env=$(strip_reporter "${NODE_OPTIONS:-}")
if [ "$has_reporter" = 0 ] && [ "$has_test" = 1 ]; then
  export NODE_OPTIONS="${base_env:+$base_env }--test-reporter=spec"
elif [ -n "$base_env" ]; then
  export NODE_OPTIONS="$base_env"
else
  unset NODE_OPTIONS
fi

# 3.11 keeps the captured stream out of a pipe buffer limit; the file is scratch space.
"${argv[@]}" >"$out.raw" 2>&1
code=$?

{
  # node --test prints two shapes depending on whether stdout is a terminal: the spec
  # reporter (`✔ name (12ms)` / `ℹ pass 6`) locally, and the TAP reporter (`ok 1 - name`
  # / `  duration_ms: 12.3` / `# pass 6`) on a CI runner. Measured on run 43917583366:
  # the first version of this recorder only knew the spec shape, so a CI record kept the
  # TAP `duration_ms` lines and hashed differently on every re-run. Both are stripped.
  sed -E 's/ \([0-9]+\.?[0-9]*ms\)$//; /^ℹ duration_ms/d; /^# duration_ms /d; /^ *duration_ms: /d' "$out.raw"
  tests=$(grep -E '^(ℹ|#) tests [0-9]+$' "$out.raw" | tail -1 | awk '{print $NF}')
  pass=$(grep -E '^(ℹ|#) pass [0-9]+$' "$out.raw" | tail -1 | awk '{print $NF}')
  fail=$(grep -E '^(ℹ|#) fail [0-9]+$' "$out.raw" | tail -1 | awk '{print $NF}')
  # The RECORD line names the argv that ACTUALLY ran, which after the reporter pin above is
  # not always the argv this script was handed. A record that names a different command than
  # the one that produced it cannot be re-run by the reviewer it is addressed to.
  if [ -n "$fail" ]; then
    echo "RECORD: command=${argv[*]} exit=$code tests=${tests:-0} pass=${pass:-0} fail=${fail:-0}"
  else
    echo "RECORD: command=${argv[*]} exit=$code"
  fi
} >"$out"

rm -f "$out.raw"
cat "$out"
exit "$code"
