# DOX framework

- DOX is highly performant AGENTS.md hierarchy installed here
- Agent must follow DOX instructions across any edits

## Core Contract

- AGENTS.md files are binding work contracts for their subtrees
- Work products, source materials, instructions, records, assets, and durable docs must stay understandable from the nearest applicable AGENTS.md plus every parent AGENTS.md above it

## Read Before Editing

1. Read the root AGENTS.md
2. Identify every file or folder you expect to touch
3. Walk from the repository root to each target path
4. Read every AGENTS.md found along each route
5. If a parent AGENTS.md lists a child AGENTS.md whose scope contains the path, read that child and continue from there
6. Use the nearest AGENTS.md as the local contract and parent docs for repo-wide rules
7. If docs conflict, the closer doc controls local work details, but no child doc may weaken DOX

Do not rely on memory. Re-read the applicable DOX chain in the current session before editing.

## Update After Editing

Every meaningful change requires a DOX pass before the task is done.

Update the closest owning AGENTS.md when a change affects:

- purpose, scope, ownership, or responsibilities
- durable structure, contracts, workflows, or operating rules
- required inputs, outputs, permissions, constraints, side effects, or artifacts
- user preferences about behavior, communication, process, organization, or quality
- AGENTS.md creation, deletion, move, rename, or index contents

Update parent docs when parent-level structure, ownership, workflow, or child index changes. Update child docs when parent changes alter local rules. Remove stale or contradictory text immediately. Small edits that do not change behavior or contracts may leave docs unchanged, but the DOX pass still must happen.

## Hierarchy

- Root AGENTS.md is the DOX rail: project-wide instructions, global preferences, durable workflow rules, and the top-level Child DOX Index
- Child AGENTS.md files own domain-specific instructions and their own Child DOX Index
- Each parent explains what its direct children cover and what stays owned by the parent
- The closer a doc is to the work, the more specific and practical it must be

## Child Doc Shape

- Create a child AGENTS.md when a folder becomes a durable boundary with its own purpose, rules, responsibilities, workflow, materials, or quality standards
- Work Guidance must reflect the current standards of the project or user instructions; if there are no specific standards or instructions yet, leave it empty
- Verification must reflect an existing check; if no verification framework exists yet, leave it empty and update it when one exists

Default section order:
- Purpose
- Ownership
- Local Contracts
- Work Guidance
- Verification
- Child DOX Index

## Style

- Keep docs concise, current, and operational
- Document stable contracts, not diary entries
- Put broad rules in parent docs and concrete details in child docs
- Prefer direct bullets with explicit names
- Do not duplicate rules across many files unless each scope needs a local version
- Delete stale notes instead of explaining history
- Trim obvious statements, repeated rules, misplaced detail, and warnings for risks that no longer exist

## Closeout

1. Re-check changed paths against the DOX chain
2. Update nearest owning docs and any affected parents or children
3. Refresh every affected Child DOX Index
4. Remove stale or contradictory text
5. Run existing verification when relevant
6. Report any docs intentionally left unchanged and why

## User Preferences

When the user requests a durable behavior change, record it here or in the relevant child AGENTS.md

## Child DOX Index

No child AGENTS.md files exist yet (scanned 2026-11-12). Current durable docs at root: `README.md` (usage, structure, verification commands), `GATES.md` (evidence ledger, gate-sig discipline). Candidate child scopes if they ever grow their own rules: `src/` (engine/render/ui law), `test/` (gate harness), `scripts/` (serve + ledger audit tools). Create a child doc only when such a scope gains rules not already owned here.

## Honesty

Claims in all agent output (docs, posts, replies, reports) must be evidence-backed
and bounded by what the evidence supports:

| Rule | Detail |
|------|--------|
| No cross-domain comparisons | Never compare against a different class (datacenter vs home rig, home model vs frontier model) unless the comparison is backed by data. State "different problem" instead |
| Caveat in the same sentence | The limitation belongs next to the claim, not dropped or footnoted: "5.8 tok/s - slow, but zero marginal cost", never "fast, zero marginal cost" |
| Resolve conflicts before publishing | When numbers conflict across sources (transcript vs description vs post), resolve before publishing. Never ship both values |
| Concede in technical contexts | Admitting the limitation is what makes technical content read as genuine; promotion without concession reads as astroturf |
| Unverified is stated as unverified | A claim that cannot be checked against a primary source is labeled unverified or omitted |
| Artifact honesty | A shipped artifact that reports identity/version (stamps, `phpversion()`-style APIs) MUST tell the truth; placeholder or borrowed values are rejected at a release gate. Applies when the project ships versioned binaries |
| Generated drift | Repeated facts (versions, counts, inventories) derive from one named authority, generated not hand-copied; CI regen-diff enforces it - point at the generator or fixture, never duplicate the values |
