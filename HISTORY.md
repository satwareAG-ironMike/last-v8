# How the Last V8 was built - and how it became a V12

The repo starts at the engine core; this file covers the story before commit one
and the discipline that produced `GATES.md`.

## Origin

Christian P.'s X challenge thread: <https://x.com/Bassmaster187/status/2120435922797748522> -
a bet that non-frontier models cannot build "a stunning, fully interactive 3D
simulation of a 90-degree V8". That prompt became this repo.

## The build

The prompt was run as an unattended `/goal` session with a local model -
**Qwen 3.8 Flash Next, IQ3_XXS quant, 12 GB GPU, 192k context window** - no
cloud tokens. The measured session statistics are in `README.md` (session
statistics), taken from the full opencode session database, not estimated.

## Gate discipline

`GATES.md` is the acceptance ledger: every row carries `CHECK`, `EXPECT`, and
`EVIDENCE` with a recomputable `gate-sig` (first 16 hex of
`sha256(CHECK value + "\n" + EXPECT value)`) plus the `output-sha256` of the run
that earned it. The work loop was four passes per gate, with negative controls:
each bugfix was reverted once to watch its check actually fail before re-applying.
Two audit tools are committed so the ledger's claims stay recomputable:
`scripts/ledger-audit.mjs` (recomputes every `gate-sig`, resolves every cited
`output-sha256`) and `scripts/procedural-audit.mjs` (procedural-only audit).

## Constraint-driven decisions

| Constraint | Decision |
|---|---|
| an fps claim needs real hardware | headless Chromium here renders through SwiftShader at 1.0-1.6 fps (measured, `tmp/hud-fps-probe.out`), so the fps lane runs headed on the GPU box and every automated gate stays hardware-independent |
| 192k context window | forced 38 context compactions across the session (measured, not estimated) |
| inference server ran `--vision off` | vision gating was unavailable; every visual gate was earned through DOM/CDP measurements and pinned screenshots instead |

## Acceptance follow-up

The live review found the honest weak spot: the lighting/camera defaults, not
the kinematic correctness. The defaults are taste calls; the math is gated.

## The V12 (2026-11, same repo, same discipline)

The follow-up goal: the same test stand, the same harness, a 60-degree V12 -
twelve cylinders in two banks of six, six crankpins each carrying a pair of
side-by-side rods, seven main bearings, twelve power pulses 60 crank degrees
apart. The repo slug stayed `last-v8` because the history is the point: the V8
won the challenge, and the V12 is what the same engine family becomes when you
stretch it.

What was kept on purpose and what changed is recorded in the G8 row of
`GATES.md`: every transverse V8 dimension (stroke 8.0, rod 14.5, bore tunnel,
head and valvetrain geometry, the pan and stand Z planes) survived; the bank
angle went to 60 degrees, the station row to six, the crank from four throws to
six pins carrying twin big ends. Everything fore/aft derives from the one
`STATIONS` row - deck ends, seven main journals and caps, cam bearings,
sprocket stack, flywheel, head faces - so the build cannot drift.

The upgrade also fixed a class of test bug that the V8 had smuggled through:
three control laws asserted numbers a specific engine had earned (133 menu
entries, 107 separated members, a remembered hoist height). Each now measures
its authority - the menu equals the inspectables the scene publishes, the
separated count equals the members the teardown table claims, the hoist is
checked by the floor law it exists to serve - so the same gates held the V8 and
hold the V12 without being edited. The firing order is re-derived from the
throws (`firingOrder()` -> 1-6-5-10-9-2-4-3-8-7-12-11, pulses 0..660 step 60),
never typed, and the id plate, HUD header and part labels all generate
themselves out of the spec, so an artifact that mislabels its own engine is
structurally impossible.

The V8 ledger rows G1..G7 stay verbatim - `scripts/ledger-name-evidence.py
--prove` pins them against commit `345f71f` - and the V12 work closed into the
same file as G8..G11, including the row that honestly declares which V8
screenshot hashes the browser-gate re-runs overwrote.
