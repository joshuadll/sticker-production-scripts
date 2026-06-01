# NQI Checker — Nesting Quality Index

## What it does

Analyses a post-Deepnest Illustrator document and outputs a single 0–100 score
(the **NQI**) measuring how well the 27 cutline paths fill the sheet.

A high score means tight nesting with no room to grow the stickers. A low score
means a real empty pocket exists — one large enough that rotating or enlarging a
neighbouring sticker would benefit the customer.

The score gives artists and QA reviewers a shared, objective reference. A formal
pass/fail threshold (default NQI ≥ 90) can be enforced without relying on
individual judgement.

## When to run

After the artist imports Deepnest results back into the `.ai` file and manually
joins the regular + irregular groups onto the Cutlines layer, before continuing
to `AI_AfterDeepnest.jsx`.

**Workflow:**
```
AI_Deepnest.jsx
  → artist runs Deepnest externally on _regular.svg + _irregular.svg
  → artist imports nested results into the .ai file and joins them
  → run AI_NestingQA.jsx          ← this script
  → PASS: continue with AI_AfterDeepnest.jsx
  → FAIL: rework nesting in Illustrator, re-run AI_NestingQA.jsx
```

## Inputs

- Active Illustrator document with a **Cutlines** layer containing all nested
  `PathItem` and `CompoundPathItem` objects (post-Deepnest import).

## Outputs

- Alert showing the NQI score, PASS/FAIL verdict, utilization %, and a list of
  any flagged pockets with their location and size.
- **NQI Pockets** layer (if `showOverlay: true`) with red rectangles drawn over
  each flagged pocket. Delete this layer when done; it does not affect production
  paths.
- Log file `AI_NestingQA.log` written next to the script.

## Algorithm overview

1. **Scanline fill** — each path's bezier curves are sampled at 20 points per
   segment using de Casteljau interpolation, then rasterised onto a 1 mm/cell
   grid (265 × 194 cells) using a scanline fill with even-odd rule. This uses
   the actual path outline, not a bounding box, so concave notches and corner
   gaps are correctly identified as free space.

2. **Gap dilation** — occupied cells are expanded outward by `gapMm` (default
   2 mm) to account for the required inter-sticker spacing.

3. **Pocket detection** — free cells are grouped into connected components via
   DFS flood-fill. Each component's inscribed circle radius is approximated as
   half the shorter side of its bounding box.

4. **NQI** — `100 × (1 − recoverable_cells / total_cells)`, where a cell is
   "recoverable" if it belongs to a pocket with inscribed radius ≥
   `pocketThresholdMm`. Thin slivers (below the threshold) do not penalise the
   score.

## Accuracy note

The only approximation is bezier sampling at 20 points per segment (~1 sample
per mm of arc). Error is < 0.5 mm, acceptable at the 3 mm pocket threshold.

## Confirmed values

| Parameter           | Value  | Notes                                    |
|---------------------|--------|------------------------------------------|
| Sheet size          | 264.7 × 194.0 mm | A4 minus margins, landscape  |
| Grid resolution     | 1 mm/cell | 265 × 194 = ~51 K cells             |
| Gap (dilation)      | 2 mm   | ⚠️ confirm inter-sticker spacing with artist |
| Pocket threshold    | 3 mm   | min inscribed radius to count as reworkable |
| Default pass NQI    | 90     | tune after calibration run on real sheets |

## CONFIG reference

| Key                  | Default   | Description                                  |
|----------------------|-----------|----------------------------------------------|
| `cutlinesLayerName`  | "Cutlines"| Exact layer name — matches Production Template |
| `sheetWidthMm`       | 264.7     | Artboard width in mm                         |
| `sheetHeightMm`      | 194.0     | Artboard height in mm                        |
| `cellSizeMm`         | 1         | Grid resolution (mm per cell)                |
| `gapMm`              | 2         | Inter-sticker spacing for dilation           |
| `pocketThresholdMm`  | 3         | Min inscribed radius to flag a pocket        |
| `passingNqi`         | 90        | NQI ≥ this = PASS                            |
| `showOverlay`        | true      | Draw red rectangles on NQI Pockets layer     |
| `dryRun`             | false     | Skip overlay and file writes                 |
| `suppressAlerts`     | false     | Suppress alert() dialogs (testing only)      |

## Files

| File | Purpose |
|------|---------|
| `pipelines/AI_NestingQA.jsx`              | Pipeline entry point — run this |
| `illustrator/StepQA_NestingQuality.jsx`   | Phase function (algorithm)      |
| `utils/aiUtils.jsx`                       | Shared helpers (#included)      |

## Testing

See `tests/integration/run-stepQA.sh`.

Requires fixture: `tests/integration/fixtures/stepQA-working.ai` — a
post-Deepnest `.ai` file with paths on the Cutlines layer. Save any real
working file here to create the fixture.

Golden file workflow: run the test once without a golden file, verify the log
output, then commit it to `tests/integration/expected/stepQA-expected.txt`.
