#!/usr/bin/env bash
# Oracle for gate row P1-G1 (and P2-G1 on the v12 branch): an engine branch that is
# branched from its release tag and protected against the four things that would make a
# release mutable - a direct push, a force push, a delete, and a merge that skips the
# `test` check.
#
# Why this is a script and not a transcript: a CHECK: line a reviewer cannot re-run is a
# screenshot. Run it through the run recorder so the hash the row cites is re-derivable:
#   bash scripts/ledger-run.sh tmp/v8-p1g1.out bash scripts/branch-gate.sh \
#       satwareAG-ironMike/last-v8 v8 v1.0.0 v12.0.0
# The recorder strips node's per-test duration stamps; this script prints no timestamps at
# all, so its own output is already stable, and it exits non-zero when any expectation
# below fails.
#
# What "protected" means here, measured from GitHub rather than asserted:
#  - branch flag protected = true;
#  - required_status_checks.contexts contains `test` with strict = true (up-to-date);
#  - required_approving_review_count >= 1 (require-PR);
#  - no force push and no delete. GitHub exposes those two as legacy per-setting endpoints
#    AND as ruleset rules. On this repo the legacy endpoints answer HTTP 404 "Branch not
#    found" for a setting that has no enabled entry - measured, and PUT to them 404 too -
#    so the enforceable source is the branch ruleset: rules `non_fast_forward` (a force
#    push is a non-fast-forward update) and `deletion`, with bypass_actors empty. This
#    script reads both and requires at least one of them to say "no".
#  - and a setting no read could answer counts as a FAILURE: `gh api` prints nothing at all on
#    stdout when an endpoint answers 404, so a read that answered nothing used to fall through
#    `case "$(...)" in <one bad value>) bad ;; *) <pass>` and print as a satisfied setting.
#    Every forge read now goes through read_setting, which refuses an empty or failed answer.
set -u -o pipefail

if [ "$#" -ne 4 ]; then
  echo "usage: scripts/branch-gate.sh <owner/repo> <branch> <from-tag> <not-from-tag>" >&2
  exit 2
fi
repo=$1; branch=$2; from=$3; notfrom=$4
fail=0
say() { printf '%s\n' "$*"; }
bad() { fail=1; printf 'FAIL: %s\n' "$*"; }

command -v gh >/dev/null || { say "FAIL: gh is not installed, so the forge half of this gate cannot be measured"; exit 1; }
command -v jq >/dev/null || { say "FAIL: jq is not installed, so the ruleset half of this gate cannot be measured"; exit 1; }

# Every forge read goes through here, and it is the only place a forge answer is judged.
# `gh api` prints NOTHING on stdout when an endpoint answers 404 - measured on this repo,
# whose legacy allow_force_pushes / allow_deletions endpoints 404 - and a `case "$(...)" in
# <one bad value>) bad ;; *) <pass>` reads an empty command substitution as the pass branch.
# That is how this script used to score a setting nobody read as satisfied. read_setting
# captures the answer first, refuses an exit code or an empty stdout, and prints the reason
# as a FAIL. It sets the globals read_out / read_rc instead of being called inside $( ),
# because a command substitution runs in a subshell and the `fail=1` of a bad() there would
# be thrown away.
read_setting() { # $1 = the fact being read, $2 = endpoint path, $3 = jq filter (empty = whole body)
  read_out=""; read_rc=0
  if [ -n "${3-}" ]; then read_out=$(gh api "repos/$repo/$2" --jq "$3"); read_rc=$?
  else read_out=$(gh api "repos/$repo/$2"); read_rc=$?; fi
  if [ "$read_rc" -ne 0 ] || [ -z "$read_out" ]; then
    bad "$1: gh api repos/$repo/$2 answered exit $read_rc and left nothing usable on stdout (got \"$read_out\") - a setting nobody read is not a satisfied setting"
    read_out=""
    return 1
  fi
  return 0
}

say "== ancestry (git) =="
if git merge-base --is-ancestor "$from" "$branch"; then
  say "$from is an ancestor of $branch: exit 0"
else
  bad "$from is not an ancestor of $branch ($branch was not cut from the release it must carry)"
fi
if git merge-base --is-ancestor "$notfrom" "$branch"; then
  bad "$notfrom is an ancestor of $branch: the two engine lines would share history, so the work could not be independent"
else
  say "$notfrom is not an ancestor of $branch: exit 1 as expected"
fi
say "$branch head        $(git rev-parse "$branch")"
say "origin/$branch head  $(git rev-parse "origin/$branch")"
say "$from tag commit     $(git rev-parse "$from^{commit}")"
say "$notfrom tag commit  $(git rev-parse "$notfrom^{commit}")"

say "== branch flag (forge) =="
if read_setting "branch flag protected" "branches/$branch" '.protected'; then
  case "$read_out" in
    true) say "protected=true" ;;
    *) bad "branch $branch reports protected=$read_out" ;;
  esac
fi

say "== legacy branch protection, per setting =="
# The endpoint is read once and the three facts are then derived from the answered object with
# local jq, so one 404 cannot be mistaken for three satisfied settings - the old shape asked
# the same endpoint three times and each empty answer fell through its own case.
if read_setting "required_status_checks" "branches/$branch/protection/required_status_checks" ''; then
  printf '%s\n' "$(printf '%s' "$read_out" | jq -r '"contexts=" + ((.contexts // []) | join(",")) + " strict=" + (.strict | tostring)')"
  case "$(printf '%s' "$read_out" | jq -r '(.contexts // []) | index("test")')" in
    '' | null | false) bad "required_status_checks.contexts does not name the test check" ;;
    *) say "required check names test" ;;
  esac
  strict=$(printf '%s' "$read_out" | jq -r '.strict | tostring')
  case "$strict" in
    true) say "strict=true (an out-of-date branch may not merge)" ;;
    '' | null) bad "required_status_checks answered no strict key, so up-to-date-ness is not enforced" ;;
    *) bad "required_status_checks.strict=$strict, not true" ;;
  esac
fi
if read_setting "required_pull_request_reviews" "branches/$branch/protection/required_pull_request_reviews" '.required_approving_review_count'; then
  approvals=$read_out
  case "$approvals" in
    '' | null) bad "required_pull_request_reviews carries no approver count, so a PR could merge unreviewed" ;;
    *) [ "$approvals" -ge 1 ] && say "approvals_required=$approvals (require-PR)" \
       || bad "required_approving_review_count=$approvals, a PR could merge with no review" ;;
  esac
fi
if read_setting "legacy branch protection flags" "branches/$branch/protection" \
    '"allow_force_pushes=" + ((.allow_force_pushes.enabled // "key absent") | tostring) + " allow_deletions=" + ((.allow_deletions.enabled // "key absent") | tostring)'; then
  say "$read_out"
fi

say "== branch rulesets (the enforceable source on this repo) =="
# The ruleset LIST endpoint is a summary: measured on this repo it answers with
# conditions=null and rules absent for every entry, so filtering the list for a ref would
# report "no ruleset covers this branch" on a repo that has one. Each ruleset is therefore
# read as its own object, which is where conditions and rules actually live.
# The list is read as its raw body, not as --jq '.[].id': a repo with no ruleset answers []
# and a jq on it prints nothing, which is a fact to report ("no id came back") and not a
# read failure.
if read_setting "the ruleset list" "rulesets" ''; then
  listbody=$read_out
else
  listbody=""
fi
ids=""
if [ -n "$listbody" ]; then
  ids=$(printf '%s' "$listbody" | jq -r '.[].id')
  [ -n "$ids" ] || bad "the ruleset list answered $(printf '%s' "$listbody" | head -c 120) with no ruleset id, so nothing in this half can be measured against a ruleset"
fi
rulesets="[]"
unread=""
for id in $ids; do
  # Each ruleset object is validated before it is added. The old line reassigned the whole
  # accumulator from `jq -n --argjson acc "$rulesets" --argjson one "$(gh api ...)"`: when
  # that one read failed the substitution was empty, jq errored, the assignment wrote an
  # EMPTY string and every ruleset already collected was gone - so the gate went on to
  # report "no branch ruleset includes refs/heads/<branch>" for a branch a ruleset does
  # cover, and its empty rule-count queries fell into the pass branch of their case.
  if ! read_setting "ruleset $id" "rulesets/$id" ''; then unread="$unread $id"; continue; fi
  one=$(printf '%s' "$read_out" | jq -c .)
  if [ -z "$one" ]; then
    bad "ruleset $id answered text that is not JSON: $(printf '%s' "$read_out" | head -c 120)"
    unread="$unread $id"; continue
  fi
  if ! next=$(jq -n --argjson acc "$rulesets" --argjson one "$one" '$acc + [$one]'); then
    bad "ruleset $id could not be added to the collected rulesets, so the rest of this half cannot be trusted"
    unread="$unread $id"; continue
  fi
  rulesets=$next
  say "ruleset $id: $(printf '%s' "$rulesets" | jq -r '.[-1] | "\(.name) target=\(.target) enforcement=\(.enforcement) include=" + ((.conditions.ref_name.include // []) | join(","))')"
done
if [ -n "$unread" ]; then
  bad "ruleset id(s)$unread could not be read; the $(printf '%s' "$rulesets" | jq 'length') ruleset(s) that were read are kept and still checked below, but no conclusion here covers the unread ones"
fi

covered=$(printf '%s' "$rulesets" | jq -r --arg ref "refs/heads/$branch" \
  '.[] | select(.target == "branch") | select(((.conditions.ref_name.include // []) | index($ref)) != null)
   | "\(.name) enforcement=\(.enforcement) rules=" + ([.rules[]?.type] | join(",")) + " bypass_actors=\(.bypass_actors | length) can_bypass=\(.current_user_can_bypass)"')
[ -n "$covered" ] || bad "no branch ruleset includes refs/heads/$branch, so no ruleset enforces this branch"
printf '%s\n' "$covered"
for want in deletion non_fast_forward; do
  have=$(printf '%s' "$rulesets" | jq -r --arg ref "refs/heads/$branch" --arg w "$want" \
    '[.[] | select(.target == "branch") | select(((.conditions.ref_name.include // []) | index($ref)) != null)
      | select([.rules[]?.type] | index($w) != null)] | length')
  case "$have" in
    0) bad "no ruleset covering refs/heads/$branch carries a $want rule" ;;
    '' | null) bad "the $want-rule query on refs/heads/$branch answered nothing, so the $want rule was not measured (it is not a pass)" ;;
    *) say "a ruleset covering refs/heads/$branch carries the $want rule" ;;
  esac
done
bypass=$(printf '%s' "$rulesets" | jq -r --arg ref "refs/heads/$branch" \
  '[.[] | select(.target == "branch") | select(((.conditions.ref_name.include // []) | index($ref)) != null)
    | select((.bypass_actors // []) | length > 0)] | length')
case "$bypass" in
  0) say "no bypass_actors on the branch ruleset" ;;
  '' | null) bad "the bypass_actors query on refs/heads/$branch answered nothing, so bypass was not measured" ;;
  *) bad "$bypass ruleset(s) on refs/heads/$branch name bypass actors" ;;
esac

say "== release tag ruleset (refs/tags/v*) =="
tagrs=$(printf '%s' "$rulesets" | jq -r '.[] | select(.target == "tag")
  | select(((.conditions.ref_name.include // []) | index("refs/tags/v*")) != null)
  | "\(.name) enforcement=\(.enforcement) rules=" + ([.rules[]?.type] | join(",")) + " bypass_actors=\(.bypass_actors | length) can_bypass=\(.current_user_can_bypass)"')
[ -n "$tagrs" ] || bad "no tag ruleset includes refs/tags/v*, so a published release tag could be moved"
printf '%s\n' "$tagrs"

say "== verdict =="
if [ "$fail" = "0" ]; then say "PROTECTION OK: $branch is cut from $from, keeps $notfrom out of its history, and is protected against direct push, force push, delete and an unreviewed or out-of-date merge"; exit 0; fi
say "PROTECTION GATE FAILED"
exit 1
