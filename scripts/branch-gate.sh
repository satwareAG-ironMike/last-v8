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
protected=$(gh api "repos/$repo/branches/$branch" --jq '.protected')
[ "$protected" = "true" ] && say "protected=true" || bad "branch $branch reports protected=$protected"

say "== legacy branch protection, per setting =="
gh api "repos/$repo/branches/$branch/protection/required_status_checks" \
  --jq '"contexts=" + (.contexts // [] | join(",")) + " strict=" + (.strict | tostring)'
case "$(gh api "repos/$repo/branches/$branch/protection/required_status_checks" --jq '(.contexts // []) | index("test")')" in
  null) bad "required_status_checks does not name the test check" ;;
  *) say "required check names test" ;;
esac
case "$(gh api "repos/$repo/branches/$branch/protection/required_status_checks" --jq '.strict')" in
  true) say "strict=true (an out-of-date branch may not merge)" ;;
  *) bad "required_status_checks.strict is not true" ;;
esac
approvals=$(gh api "repos/$repo/branches/$branch/protection/required_pull_request_reviews" --jq '.required_approving_review_count')
case "$approvals" in
  '' | null) bad "required_pull_request_reviews carries no approver count, so a PR could merge unreviewed" ;;
  *) [ "$approvals" -ge 1 ] && say "approvals_required=$approvals (require-PR)" \
     || bad "required_approving_review_count=$approvals, a PR could merge with no review" ;;
esac
legacy=$(gh api "repos/$repo/branches/$branch/protection" \
  --jq '"allow_force_pushes=" + ((.allow_force_pushes.enabled // "key absent") | tostring) + " allow_deletions=" + ((.allow_deletions.enabled // "key absent") | tostring)')
say "$legacy"

say "== branch rulesets (the enforceable source on this repo) =="
# The ruleset LIST endpoint is a summary: measured on this repo it answers with
# conditions=null and rules absent for every entry, so filtering the list for a ref would
# report "no ruleset covers this branch" on a repo that has one. Each ruleset is therefore
# read as its own object, which is where conditions and rules actually live.
ids=$(gh api "repos/$repo/rulesets" --jq '.[].id')
rulesets="[]"
for id in $ids; do
  rulesets=$(jq -n --argjson acc "$rulesets" --argjson one "$(gh api "repos/$repo/rulesets/$id")" '$acc + [$one]')
  say "ruleset $id: $(printf '%s' "$rulesets" | jq -r '.[-1] | "\(.name) target=\(.target) enforcement=\(.enforcement) include=" + ((.conditions.ref_name.include // []) | join(","))')"
done
covered=$(printf '%s' "$rulesets" | jq -r --arg ref "refs/heads/$branch" \
  '.[] | select(.target == "branch") | select(((.conditions.ref_name.include // []) | index($ref)) != null)
   | "\(.name) enforcement=\(.enforcement) rules=" + ([.rules[]?.type] | join(",")) + " bypass_actors=\(.bypass_actors | length) can_bypass=\(.current_user_can_bypass)"')
[ -n "$covered" ] || bad "no branch ruleset includes refs/heads/$branch, so no ruleset enforces this branch"
printf '%s\n' "$covered"
for want in deletion non_fast_forward; do
  case "$(printf '%s' "$rulesets" | jq -r --arg ref "refs/heads/$branch" --arg w "$want" \
    '[.[] | select(.target == "branch") | select(((.conditions.ref_name.include // []) | index($ref)) != null)
      | select([.rules[]?.type] | index($w) != null)] | length')" in
    0) bad "no ruleset covering refs/heads/$branch carries a $want rule" ;;
    *) say "a ruleset covering refs/heads/$branch carries the $want rule" ;;
  esac
done
bypass=$(printf '%s' "$rulesets" | jq -r --arg ref "refs/heads/$branch" \
  '[.[] | select(.target == "branch") | select(((.conditions.ref_name.include // []) | index($ref)) != null)
    | select((.bypass_actors // []) | length > 0)] | length')
[ "$bypass" = "0" ] && say "no bypass_actors on the branch ruleset" || bad "$bypass ruleset(s) on refs/heads/$branch name bypass actors"

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
