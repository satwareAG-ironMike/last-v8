# How the Last V8 was built

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
