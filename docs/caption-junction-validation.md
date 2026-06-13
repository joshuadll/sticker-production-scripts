# Caption-Junction / Half-Cut — Validation Checklist

**Branch:** `claude/step-9a-walkthrough-je9ipa`
**Status:** implemented + syntax-checked, but **NOT run against Photoshop/Illustrator yet.**
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

## Optional features — validate before enabling
- `whiteBridgeEnabled` (PSAI, default false): raster white-band growth closing end-gaps.
  Enable → confirm the white-on-white bridge is invisible in print and bounded by
  `maxWhiteBridgePx` (8).
- `weldFilletRadiusPt` (AI_BuildCutlines, default null): set ~0.35pt → confirm the plate∩art
  notch softens without distorting the cutline. Needs `bite` in the sidecar.

## Regenerate golden test logs (behavior changed — do NOT hand-edit)
Delete each `expected/*.txt` and let the runner rewrite it on a clean Adobe run; review diff:
- `tests/integration/run-psai-build-export-cutlines.sh` (PS Phase-1 golden)
- `tests/integration/run-ai-import-nesting.sh`
- `tests/integration/run-ai-normalise-captions.sh`
- `tests/integration/run-ai-export-final.sh`
- `tests/integration/run-ai-layout-qa.sh`

## CONFIG cheat-sheet
- **PSAI:** `seatConform:true`, `seatRotationSign:1`, `maxSeatRotationDeg:75`, `seatBandPx:4`,
  `whiteBridgeEnabled:false`, `maxWhiteBridgePx:8`, `captionBorderOverlapPx:3`, `snapColumns:9`.
- **AI (all pipelines):** `halfcutFollowSeam:true`, `halfcutSeamSteps:16`.
  **AI_BuildCutlines:** `weldFilletRadiusPt:null`.

## Open follow-ups
- Arc-conform rung (warp text to a border arc) — not built; too-curved borders flag instead.
- Add integration assertions: curved vs straight half-cut endpoints land on the cutline
  crossings; idempotent re-sync (one halfcut/element); flagged fixture gets `…|R` + badge.
