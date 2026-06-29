# Pipeline 2 integration test — design

**Date:** 2026-06-25
**Branch:** `feature/illustrator-native-rewrite`
**Status:** approved (pending spec review)

## Goal

Add the missing integration test for **Pipeline 2 — `AI_BuildAndExportCutlines.jsx`**
(Illustrator). Pipeline 2 takes the post-Step-6 working document (traced cut + native
caption text placed by Pipeline 1) and: builds each WC/GC caption (white pill → seat into
the traced cut → unite → bundle → half-cut; GC also places a scaled plate raster) → runs
Step 7A Deepnest export, producing **`{base}_regular.svg` + `{base}_irregular.svg`** — the
cutline SVGs the artist feeds to Deepnest for nesting.

No test currently exercises this pipeline.

## Folder structure (matches the per-pipeline convention)

```
tests/integration/ai-build-and-export-cutlines/
├── run.sh          # AI-only single-phase runner (mirrors ai-export-final/run.sh)
├── expected.txt    # golden log: AI_BuildAndExportCutlines.log, variable lines stripped
└── fixtures/
    ├── traced-cutlines.ai             # duplicated Pipeline 1 ending file (committed snapshot)
    └── traced-cutlines_elements.json  # its sidecar — must share the .ai base name, sit beside it
```

`run-all.sh` auto-discovers any `<pipeline>/run.sh`, so the new folder registers itself with
no edits to the runner index.

## Fixture: static committed snapshot

The Pipeline 1 ending artifact — the working `.ai` saved by `buildDocAndImport` after Step 6
(traced cut + `"{name} outline"` + `"{name} caption text"` members in the `Cutlines` layer) —
is **duplicated once** and committed, rather than regenerated per run:

- Source: `tests/integration/ps-build-elements/fixtures/source-psds/source-psds.ai`
  + `source-psds_elements.json` (already present from today's Pipeline 1 run; untracked).
- Destination: `fixtures/traced-cutlines.ai` + `fixtures/traced-cutlines_elements.json`.

This mirrors `ai-export-final` (committed `.ai` fixture), keeps Pipeline 2's test decoupled
from a live Pipeline 1 + Photoshop run, and is exactly the "duplicate the ending file, use it
as the starting file" request.

The fixture is the **Slovakia SKU**: 26 elements — 24 WC + 2 ST. **No GC**, so the GC
plate-raster branch of `buildCaption` is not exercised (known coverage gap; GC SKU validation
is tracked separately).

## Runner behaviour (mirrors `ai-export-final/run.sh`)

1. **Pre-flight / clean slate.** SKIP if the fixture `.ai` is missing. Close all Illustrator
   docs; remove `/tmp` log + temp script + temp fixture + stale `/tmp` `_regular.svg` /
   `_irregular.svg`.
2. **Copy fixture to `/tmp`.** Copy both `traced-cutlines.ai` and `traced-cutlines_elements.json`
   to `/tmp` under a shared base name so `_readSidecarBeside()` resolves the sidecar and Step 7A
   writes the SVGs into `/tmp` (committed fixtures dir stays clean).
3. **Prepare the temp script.** From `AI_BuildAndExportCutlines.jsx`, via `perl`:
   - `suppressAlerts: false → true`
   - `CONFIG.logPath = _root...` → fixed `/tmp/AI_BuildAndExportCutlines.log`
   - rewrite `#include "../..."` to absolute repo paths
   - inject `$.global.__p2Handoff = true;` after the `#target` line so the bottom dispatch
     does **not** auto-run `main()`
   - append: close all docs, `open` the `/tmp` fixture, then
     `var d = app.activeDocument; var r = runBuildAndExport(d);` (CONFIG already set by the file).
4. **Run** via `osascript … do javascript file` with a 600s AppleScript timeout.
5. **Wait** for the log (≤180s; SVG export over 24 elements is the slow part).
6. **Assert** (fail the run on any miss):
   - `[ai-pipeline] captions built: N | skipped: … | failed: 0` with **N > 0** and **failed = 0**
   - `[step7a] exported: …_regular.svg` and `…_irregular.svg` present in the log
   - both `/tmp/…_regular.svg` and `/tmp/…_irregular.svg` exist on disk and are non-empty
   - no `ERROR` / unhandled-exception line
7. **Golden diff.** Strip variable lines (the `=== start/done ===` banner, any absolute paths)
   and `diff -u` against `expected.txt`. First run with no golden → print the
   review-and-commit note and PASS (documented golden workflow).

## Validation plan

Drive Illustrator now via `osascript`:
1. Duplicate the fixture, commit the snapshot.
2. Run `run.sh`; confirm captions build (failed = 0) and both SVGs export non-empty.
3. Run a **second time** to confirm determinism (per test-fixture discipline) — the runner is
   idempotent because it works on a fresh `/tmp` copy each run.
4. Review the log, commit it as `expected.txt`.

## Out of scope

- GC plate-raster path (no GC element in the fixture).
- Re-baselining the other AI goldens.
- Any change to Pipeline 2's production script — this is test-only.
