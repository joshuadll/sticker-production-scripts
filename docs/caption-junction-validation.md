# Caption-Junction / Half-Cut — Validation Checklist

**Branch:** `claude/step-9a-walkthrough-je9ipa`
**Status:** first in-app validation run **2026-06-13** (Photoshop 2026 + Illustrator 2026).

## Results (2026-06-13)
- ✅ **PS rotation sign** — correct, `seatRotationSign=1`. Captions tilt as one rigid unit
  (text+pill+plate), no shear; flat borders ≈ unchanged. Checked on Kraslice (−6.8°), Bratislava
  (+2.5°), Michael's (+3.0°), Tram (+0.5° flat control). No flip needed.
- ✅ **Half-cut** — at Step 6 birth: 22 half-cuts, **zero duplicates**, curvature tracks the real
  seam (Tram curved because its seat is curved though barely rotated; Blue Church straight).
  Connected single contour; endpoints on the cut line. Re-sync through 7B/8b/9A not separately
  re-driven this session but the engine is `syncHalfcut` (idempotent, clears its own path first).
- ⚠ **Seat-review flag** — `needsReview` → `|R` note → blue Layout-QA badge works (advisory,
  doesn't gate). **Over-flags: 13/22** at `seatBandPx=4`; misses corner armpits; orthogonal to
  the junction defect. Tune `seatBandPx` up.
- ❌ **Caption-junction cut-line quality** — KNOWN ISSUE (artist-spotted "gaps"/"horns").
  Root cause = degenerate union slivers at the tangential seam graze. Diagnosed, **not fixed**;
  raster white-fill attempts all created new spikes and were reverted. See
  **`docs/caption-junction-cutline-quality.md`** for the vector fix plan.
- ⬜ **Golden logs** — pending regeneration (see bottom of this file). Review each diff first.

Original test plan (below) is unchanged.

---

**Original status:** implemented + syntax-checked, but **NOT run against Photoshop/Illustrator yet.**
This file is the test plan for the first local session that has both Adobe apps.

## What changed (5 commits)
1. **Half-cut engine** — `aiUtils.syncHalfcut`: single idempotent generator, traces the
   real plate∩art seam → **straight for a flat seat, curved for a tilted/curved seat**.
   Re-derived at every caption-touching step: Step 6 (birth) → 7B (nest) → 8b (normalise)
   → 9A (export). Each clears its own `{name} halfcut` first.
2. **PS conform-then-kiss seating** — `Step3B.seatCaptionConform` (**default ON**): rigidly
   rotate the caption so its inner edge is parallel to the local border tangent, then kiss
   to depth. Flat border → ~0° → legacy seat. Emits `bite` (seam endpoints) + `needsReview`.
3. **Flagging** — `needsReview` → sidecar → note `…|R` → advisory **blue seat-review badge**
   on the Layout QA overlay (does NOT gate export).
4. **Gated OFF:** white bridge (`whiteBridgeEnabled:false`), junction fillet
   (`weldFilletRadiusPt:null`). **Not implemented:** arc-conform rung (too-curved border →
   review flag instead).

## ⚠️ FIRST CHECK — Photoshop rotation sign
PS `layer.rotate()` sign convention is the one thing unverifiable without the app.
- Run `PSAI_BuildAndExportCutlines` on a captioned SKU (or fixture
  `tests/integration/fixtures/elements-captioned-ungrouped.psd`) with a tilted/irregular
  border (e.g. **Bratislava Castle**).
- **Expect:** caption tilts to follow the border (inner edge parallel); text + pill + plate
  move as ONE rigid unit; no shear. Flat-border captions ≈ unchanged.
- **If captions tilt the WRONG way OR the assembly shears apart:** set
  `CONFIG.seatRotationSign = -1` in `pipelines/PSAI_BuildAndExportCutlines.jsx`, re-run.
- Log to watch: `[step3B] conform | rotated X° to border tangent`.

## Half-cut correctness (Illustrator)
- After Step 6 (PSAI handoff): each GC/WC cutline group has a `{name} halfcut` on the
  Halfcut layer. Flat seat → straight; tilted/curved seat → curved (follows the seam).
- `AI_ImportNesting`: log `[step-nest] half-cut sync | N GC/WC element(s)`; half-cuts move
  with the nested cutlines.
- `AI_NormaliseCaptions` (run repeatedly): half-cut re-syncs to the rescaled seam; re-runs
  leave **exactly one** halfcut per element (no duplicates).
- `AI_ExportFinal` → Step 9A: `[step9a] placed | name (curved seam|straight)`.

## Seat-review flag
- Uneven seats → `needsReview` → note `…|R` → blue badge on Layout QA (AI_LayoutQA /
  AI_ExportFinal guard). Advisory only. Tune `seatBandPx` (default 4px) if over/under-flagged.

## Optional features — DO NOT enable as-is (2026-06-13)
- `whiteBridgeEnabled` (PSAI, default false): the raster white-fill was the WRONG layer for
  the caption gap — every variant tried (comb / morphological close / 1px surgical lap)
  produced a new spike/horn in the *traced* cut line. Leave OFF. The gap+spike are one
  cut-line-vector problem — see `docs/caption-junction-cutline-quality.md`.
- `weldFilletRadiusPt` (AI_BuildCutlines, default null): the existing fillet is insufficient
  (fired on 9/22, invisible at 0.35pt, can't kill a multi-anchor spike cluster). It's the hook
  to REPLACE with the junction-rebuild in `docs/caption-junction-cutline-quality.md`. Leave
  null until that lands.

## Regenerate golden test logs (behavior changed — do NOT hand-edit)
All 5 predate the 2026-06-13 conform + half-cut commits, so all are stale.
- ✅ `run-psai-build-export-cutlines.sh` (PS Phase-1 golden) — **regenerated 2026-06-13**
  (adds `conform | rotated` ×22 + `FLAG` ×13; same elements/bindings/counts; reviewed clean).
- ⬜ **TODO (focused follow-up)** — the 4 AI goldens below. Fixtures are present so each runs;
  each is ~1 Illustrator runner pass + diff review. They will ALSO shift when the caption-junction
  fix lands, so a single batch regen *after* that fix is the efficient sequencing:
  - `run-ai-import-nesting.sh`  (fixture `import-nesting.ai` + nested SVGs + `import-nesting_elements/`)
  - `run-ai-normalise-captions.sh`  (fixture `resize-elements.ai`)
  - `run-ai-export-final.sh`  (fixture `step8c-cutlines.ai`)
  - `run-ai-layout-qa.sh`  (fixture `quality-check.ai`)
  Workflow per golden: run the runner, review the new log vs committed `expected/*.txt`, then
  `cp` + commit.

## CONFIG cheat-sheet
- **PSAI:** `seatConform:true`, `seatRotationSign:1`, `maxSeatRotationDeg:75`, `seatBandPx:4`,
  `whiteBridgeEnabled:false`, `maxWhiteBridgePx:8`, `captionBorderOverlapPx:3`, `snapColumns:9`.
- **AI (all pipelines):** `halfcutFollowSeam:true`, `halfcutSeamSteps:16`.
  **AI_BuildCutlines:** `weldFilletRadiusPt:null`.

## Open follow-ups
- Arc-conform rung (warp text to a border arc) — not built; too-curved borders flag instead.
- Add integration assertions: curved vs straight half-cut endpoints land on the cutline
  crossings; idempotent re-sync (one halfcut/element); flagged fixture gets `…|R` + badge.
