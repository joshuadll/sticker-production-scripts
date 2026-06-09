# Layout QA Consolidation — Step 8c + Nesting QA

**Status:** implemented (branch `claude/step-8-discussion-y885qp`)
**Supersedes runtime placement of:** `docs/step8c-offset-path-qa.md`

## Problem

QA is not a stage the artist passes through once — it is a lens they point at
the *current* layout, repeatedly. The real workflow loops:

```
nest ⇄ pencil   (back and forth, many times)
```

After a pencil refinement the artist often has to nudge the nesting again; after
re-nesting they re-pencil. Any QA check pinned to a fixed pipeline slot fights
this loop. QA should be an **independent, on-demand, re-runnable** check the
artist can invoke at any point between nesting and pencil, in either direction,
as many times as needed — mutating nothing structural.

## Current state (precise)

Two checks today enforce overlapping layout constraints, but only one is built
the right way:

| Check | Lives in | Independent? | Re-run safe? |
|---|---|---|---|
| **Nesting Quality (NQI)** — `StepQA_NestingQuality.runNestingQA` | `pipelines/AI_NestingQA.jsx` (standalone) | ✅ yes — run on demand | ✅ yes — `_qa_drawOverlay` deletes the prior `"NQI Pockets"` layer before redrawing |
| **Spacing + Margin (8c)** — `Step8c_OffsetPathQA.runOffsetPathQA` | `pipelines/AI_ExportFinal.jsx`, phase 1 of 4 | ❌ no — welded to the front of export as a blocking gate (`AI_ExportFinal.jsx:84` `flagged > 0 → return`) | ❌ **no** — step 5 only *adds* red to failures; it never resets a now-fixed cut line back to 0.25pt black |

> The `// idempotent — no layer to rebuild` comment in `Step8c_OffsetPathQA.jsx`
> means "no layer to tear down," **not** "stale flags get cleared." Because 8c is
> currently a one-shot export gate, the stale-flag bug stays hidden: a cut line
> flagged red on run N stays red on run N+1 even after the artist fixes the
> geometry.

Both checks already share the right primitives:
- the safe-area boundary — both call `marginRect(doc)` (single-source
  `MARGIN_SPEC`);
- the 2 mm spacing constant — 8c as the pairwise fail threshold, StepQA as the
  `gapMm` occupancy dilation.

## Decision

1. Create one **independent QA pipeline** — `pipelines/AI_LayoutQA.jsx` — that
   runs *both* checks against the current `Cutlines` state and mutates nothing
   structural. The artist runs it whenever, in any order relative to pencil.
2. Make 8c's spacing+margin check **idempotent** (reset before re-flag) so it is
   safe to run repeatedly, and **extract its check** so both the QA pipeline and
   export can call it.
3. Reduce export to a **thin blocking guard**: `AI_ExportFinal` re-runs only the
   spacing+margin check at its top and halts on failure. This keeps the existing
   "can't export an un-cuttable file" guarantee while removing 8c as a hard-coded
   phase. *(Decision (a) from the discussion — keep the guard; it is a few ms and
   the failure it prevents is a wasted print run.)*
4. NQI is **advisory** and does **not** gate export — only spacing+margin does.

## Target design

### New: `pipelines/AI_LayoutQA.jsx`

Standalone, on-demand. `#include`s `aiUtils`, `Step8c_OffsetPathQA`, and
`StepQA_NestingQuality`. `main()` runs two phases with per-phase try/catch (the
pipeline convention), then a single combined alert:

```
--- Spacing + Margin QA ---     runOffsetPathQA(doc)   → { checked, flagged }
--- Nesting Quality (NQI) ---   runNestingQA(doc)      → { nqi, pass, pockets, utilization }
```

Neither phase halts the other — the artist wants to see *all* of it in one pass.
The alert reports flagged cut lines (red), the NQI score / utilization, and the
reworkable pockets (red `"NQI Pockets"` overlay). Both phases are re-run-safe, so
the artist can keep re-running as they iterate.

### Changed: `illustrator/Step8c_OffsetPathQA.jsx`

Make `runOffsetPathQA` idempotent by adding a **reset pass before flagging**:
after `_collectCutlines`, restroke every `kind === "path"` cut line to the
canonical **0.25 pt black** (`CONFIG.cutlineStrokePt`, `blackCmyk()`) via
`strokeRecursive`, *then* run the spacing/margin checks and apply red only to
fresh violations. (`PlacedItem` stamps are skipped for recolor as today.)

This is safe because every cut line in this layer is 0.25 pt black by
construction (Step 6 / 8a / 8b restroke), so the reset never clobbers a
legitimately different stroke. Result: running the check twice in a row converges
— fixed cut lines go back to black, only still-too-close pairs stay red.

Add `CONFIG.cutlineStrokePt` (0.25) to any pipeline that calls the check
(`AI_LayoutQA`, `AI_ExportFinal`). No rename of `runOffsetPathQA` — keeping the
name avoids churn; the "Offset Path" label is historical (playbook §6) and
documented.

### Changed: `pipelines/AI_ExportFinal.jsx`

Phase 1 ("Step 8c") stays in place **as a guard**, not a workflow step. Behaviour
is unchanged from the artist's view — it still halts on `flagged > 0` with the
same alert — but it now shares the idempotent check, so re-running export after a
fix clears the prior red flags instead of leaving them. No other phase changes.

### Disposition of `pipelines/AI_NestingQA.jsx`

Folded into `AI_LayoutQA`. Either:
- **(preferred)** delete `AI_NestingQA.jsx` and update the CLAUDE.md pipeline map
  + installer to register `AI_LayoutQA` in its place, or
- keep `AI_NestingQA.jsx` as a thin alias that calls only the NQI phase, if we
  want to preserve the existing Scripts-menu entry name during transition.

### CONFIG union for `AI_LayoutQA`

The new pipeline's CONFIG is the union of the two existing ones:

| From 8c (`AI_ExportFinal`) | From StepQA (`AI_NestingQA`) |
|---|---|
| `cutlinesLayerName`, `marginLayerName` | `cutlinesLayerName` (same) |
| `spacingThresholdMm` (2) | `gapMm` (2) — same physical constant |
| `qaSpacingSampleSteps` (12) | `cellSizeMm` (1) |
| `flagStrokePt` (1.0) | `pocketMinAreaMm2` (90) |
| `cutlineStrokePt` (0.25) **new** | `passingNqi` (90) |
| `workingAreaWidthMm/HeightMm`, `marginTop/LeftMm` (`MARGIN_SPEC`) | `showOverlay` (true), `sheetWidthMm/HeightMm` |

## Follow-ups (not blocking)

- **Shared geometry DRY → real bug fix.** ✅ Resolved, but not by merging. On
  close inspection the two collectors have *genuinely different semantics* and
  should NOT share a routine: 8c needs per-sticker **units** (it compares
  sticker-to-sticker for the 2 mm gate, with exact pairwise distance), while
  StepQA needs every **leaf** path (occupancy is a union). Forcing them together
  would add indirection, not remove duplication. What the comparison *did*
  surface was a real gap: 8c's `_collectCutlines` only walked top-level
  `pageItems`, so stamps/paths an artist tucked into a **Cutlines sublayer**
  evaded the spacing/margin gate entirely (StepQA already descends sublayers).
  Fix: `_collectCutlines` now recurses sublayers (mirroring StepQA's proven
  pattern) while keeping each GroupItem whole. Behaviour is identical for
  documents without sublayers — it only adds coverage. The collectors stay
  separate, by design.
- **Sheet-dim drift.** ✅ Resolved. `_qa_quadrantLabel` now takes the **measured**
  artboard size (`sheetW`/`sheetH` from `doc.artboards[0]`, already computed in
  `runNestingQA`) threaded through `_qa_findPockets`, instead of the stale
  `sheetWidthMm 264.7 / sheetHeightMm 194.0` constants (which referenced the
  retired template and didn't match the code-built A4 artboard). The two CONFIG
  keys are removed from `AI_LayoutQA`.

## Test plan

- New runner `tests/integration/run-ai-layout-qa.sh` — post-nest fixture with (a)
  one deliberately too-close pair and (b) one recoverable pocket. Assert
  `flagged > 0`, an NQI below `passingNqi`, and — critically — that a **second
  run after fixing the geometry clears the red flags** (the idempotency
  regression guard).
- Keep `run-ai-nesting-qa.sh` working (or rename) depending on the
  `AI_NestingQA` disposition chosen above.
- `AI_ExportFinal` test unchanged in behaviour; add an assertion that a fixed
  cut line is no longer red on the second export run.

## File change checklist

- [x] `pipelines/AI_LayoutQA.jsx` — new (two phases, combined alert)
- [x] `illustrator/Step8c_OffsetPathQA.jsx` — idempotent reset pass + `cutlineStrokePt`
- [x] `pipelines/AI_ExportFinal.jsx` — `cutlineStrokePt` in CONFIG; phase 1 reframed as a guard
- [x] `pipelines/AI_NestingQA.jsx` — **deleted** (folded into `AI_LayoutQA`)
- [x] `CLAUDE.md` — pipeline map (`AI_LayoutQA` replaces `AI_NestingQA`)
- [x] installer — `Noteworthie 6 - Layout QA` → `AI_LayoutQA.jsx`
- [x] `docs/step8c-offset-path-qa.md` — runtime-placement note added
- [x] `tests/integration/run-ai-layout-qa.sh` — renamed from `run-ai-nesting-qa.sh`, asserts both phases
- [x] `docs/nqi-checker.md` — references repointed to `AI_LayoutQA`

### Not regressed

- NQI algorithm (`StepQA_NestingQuality.jsx`) is unchanged — only its `#included by`
  header comment was updated. The NQI test coverage carries over: the old
  `run-ai-nesting-qa.sh` is renamed (not deleted), keeps the same
  `stepQA-working.ai` fixture, and still asserts the `[stepQA] NQI=/paths:/grid:`
  lines — now alongside the new `[step8c]` spacing/margin assertions.
- `run-all.sh` auto-discovers `run-ai-*.sh`, so the renamed runner is picked up
  with no change to the harness.

## Follow-up still open

- **Idempotency assertion in the test.** The renamed runner asserts both phases
  log, but does not yet assert that a *second* run clears a fixed cut line's red
  flag (the reset-pass regression guard). That needs a two-run fixture/harness
  tweak — deferred until there's a real `stepQA-working.ai` to calibrate against.
