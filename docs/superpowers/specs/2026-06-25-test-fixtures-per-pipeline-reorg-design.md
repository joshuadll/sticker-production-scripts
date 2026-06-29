# Per-pipeline test reorg + Pipeline 1 golden refresh — design

**Date:** 2026-06-25
**Branch:** `feature/illustrator-native-rewrite`
**Status:** Approved (design), pending implementation plan

## Problem

Two issues, addressed together:

1. **The Pipeline 1 golden is stale.** `tests/integration/expected/ps-build-elements-expected.txt`
   ends at `--- Step 3A: Caption text ---` ("24 T layer(s) placed"), but after the native-caption
   rewrite `PS_BuildElements.jsx` no longer authors captions. It now runs
   Combine → Resize → White edge → **Group (Step 3B, grouping-only)** → **Silhouette finalize (Step 5)**
   → **Export handoff (Step5b: per-element PNGs + slim sidecar)** → **BridgeTalk → Illustrator
   (Step 6: trace cut + place native caption text)**. The runner also still hard-asserts the deleted
   Step 3A behavior.

2. **The test tree is flat and hard to track per pipeline.** Runners, goldens, and fixtures live in
   three separate top-level dirs (`tests/integration/run-*.sh`, `expected/`, `fixtures/`), so the
   assets for one pipeline are scattered.

## Goals

- Rewrite the Pipeline 1 integration test as a **two-phase** test (PS log golden + Illustrator
  outcome assertions) and **regenerate its golden** from a real run (never hand-authored).
- Reorganize `tests/integration/` so **each pipeline's runner + golden + fixtures are co-located**
  in one folder, with util/algorithm tests grouped under `unit/`.

## Non-goals (explicit)

- No regeneration or correctness fixes for the other pipelines' goldens — they only **move**.
- No deletion of obsolete files or cruft. `run-ps-build-elements-captions.sh` (tests the deleted
  Step 3A), the loose duplicate `fixtures/import-nesting_elements/`, `~ai-*.tmp`, and
  `elements-captioned-ungrouped.psd` are left untouched at their current locations. They become
  orphaned from `run-all.sh` (which will only discover the new `*/run.sh`), so they neither run
  nor fail.
- Pipeline 1's test scope ends at **Step 6** (trace + caption). Step 7A/Deepnest export belongs to
  Pipeline 2 (`AI_BuildAndExportCutlines`) and is out of scope here.

## Target structure

```
tests/integration/
  ps-build-elements/        # PS_BuildElements  (rewritten + regenerated)
    run.sh
    expected.txt
    fixtures/source-psds/                 (git mv — 3 Slovakia A4 PSDs)
  ai-import-nesting/        # AI_ImportNesting
    run.sh  expected.txt  fixtures/import-nesting/        (git mv)
  ai-normalise-captions/    # AI_NormaliseCaptions
    run.sh  expected.txt  fixtures/resize-elements.ai     (untracked → plain mv)
  ai-layout-qa/             # AI_LayoutQA
    run.sh  expected.txt  fixtures/quality-check.ai       (untracked → plain mv)
  ai-export-final/          # AI_ExportFinal
    run.sh  expected.txt  fixtures/step8c-cutlines.ai     (untracked → plain mv)
  unit/                     # util/algorithm tests (no whole pipeline)
    run-test-psUtils.sh + test-psUtils.jsx
    run-test-caption-seating.sh + test-caption-seating.jsx
    run-test-caption-linecount.sh + test-caption-linecount.jsx
    run-test-caption-linecount-live.sh + test-caption-linecount-live.jsx
    run-test-ai-caption-seat.sh + test-ai-caption-seat.jsx
    run-ai-halfcut-alignment.sh + test-halfcut-alignment.jsx + fixtures/import-nesting.ai
    test-caption-note.js  test-caption-spinefit.js
  run-all.sh                # discovers */run.sh + unit/run-*.sh
  # left untouched at root (orphaned cruft, per non-goals):
  #   run-ps-build-elements-captions.sh, fixtures/import-nesting_elements/,
  #   fixtures/import-nesting_elements.json, fixtures/import-nesting/~ai-*.tmp,
  #   fixtures/elements-captioned-ungrouped.psd
  # NOTE: the loose fixtures/import-nesting.ai (untracked) is NOT cruft — it is the halfcut
  #   test's fixture and moves into unit/fixtures/import-nesting.ai (plain mv).
```

### Runner path-math changes (mechanical)

Each moved runner sits one directory deeper, so:
- `REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"` → `.../../..` (one more `..`).
- `FIXTURE_DIR` becomes the **co-located** `"$(dirname "$0")/fixtures"`; the fixture file/dir moves in.
- `EXPECTED` becomes the co-located single `"$(dirname "$0")/expected.txt"`.

### Fixture mapping (which fixture each runner consumes)

| Pipeline folder        | Runner script (pipelines/)   | Fixture                         | Tracked? |
|------------------------|------------------------------|---------------------------------|----------|
| ps-build-elements      | PS_BuildElements.jsx         | source-psds/ (3 PSDs)           | yes      |
| ai-import-nesting      | AI_ImportNesting.jsx         | import-nesting/ (+ _nested.svg) | yes      |
| ai-normalise-captions  | AI_NormaliseCaptions.jsx     | resize-elements.ai              | no       |
| ai-layout-qa           | AI_LayoutQA.jsx              | quality-check.ai                | no       |
| ai-export-final        | AI_ExportFinal.jsx           | step8c-cutlines.ai              | no       |
| unit/ (halfcut algo)   | test-halfcut-alignment.jsx   | import-nesting.ai (loose copy)  | no       |

## Pipeline 1 test — two-phase design

The handoff (`PS_BuildElements.handOffToIllustrator` → `AI_BuildCutlines.buildDocAndImport`) runs
**Step 6 only**: builds the working doc, traces + places native captions, saves `{base}.ai` beside
the sidecar, and returns `{ok, named, unmatched}`. It is synchronous but capped at
`bridgeTalkTimeout: 20s`; Step 6 on the 26-element fixture may exceed that, so Phase 2 polls the
**on-disk** artifacts rather than the BridgeTalk return value.

**Clean slate (start of run):**
- Close all docs in **both** Photoshop and Illustrator.
- Remove `/tmp/PS_BuildElements.log`, `pipelines/AI_BuildCutlines.log`, and stale generated
  artifacts in the fixture folder (`source-psds.psd`, `*_silhouette.png`, `*_elements.json`,
  `*_elements/`, `*.ai`, `*_regular.svg`, `*_irregular.svg`, `*_nested.svg`).

**Phase 1 — PS log golden:**
- Run `PS_BuildElements.jsx` (perl-injected `sourceFolderPath`, `suppressAlerts: true`, larger
  `bridgeTalkTimeout`, absolute `#include` paths). It auto-BridgeTalks into Illustrator.
- Diff the PS log against `expected.txt`. `strip_variable_lines` keeps only `^[` structural lines,
  drops the freeform alert copy and the variable `[pipeline] BridgeTalk …` lines (timing/state
  dependent — asserted separately, not diffed).
- Keep the existing white-edge-smoothing assertion (`[step2B] smooth radius |`).

**Phase 2 — Illustrator outcome (poll on disk):**
- Poll `pipelines/AI_BuildCutlines.log` (generous timeout) until it contains
  `[ai-pipeline] step 6 complete | named: N | unmatched: 0`. Assert `unmatched: 0`.
- Assert the saved working `.ai` (`source-psds.ai`) exists.

## Golden generation discipline

- Drive the **real** runner (both Adobe apps open). Run **twice**; require the PS log to be
  byte-identical before committing `expected.txt`. Never hand-author golden lines.

## Verification plan

- **Pipeline 1:** run the new `ps-build-elements/run.sh` → PASS; twice-stable golden.
- **Moved AI/unit runners:** not executed against Adobe (would require driving Illustrator through
  five fixtures). For each, `bash -n` (syntax) and a path probe that the resolved
  `$SCRIPT`/`$FIXTURE`/`$EXPECTED` exist after the move.
- **`run-all.sh`:** dry listing confirms it discovers the new `*/run.sh` and `unit/run-*.sh` and
  does not pick up the orphaned root runner.
