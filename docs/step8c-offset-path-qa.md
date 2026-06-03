# Step 8c — Spacing + Margin QA

## What it does

After the manual pencil pass, check that every cut line is at least **2mm from its
neighbours** and doesn't **exceed the safe area**. The pipeline halts on any failure
so the artist can fix and re-run.

### Why no offset layer

The manual playbook uses 1mm offset paths as a measuring tool — a human needs
something visible to eyeball a gap. The automation measures inter-cutline distance
directly (pure geometry), so the intermediate visual layer is unnecessary. The check
is equivalent but simpler: fewer DOM operations, nothing to clean up, no unverified
Illustrator API calls.

## Two checks

| Check | Method | Violation |
|---|---|---|
| **Spacing** | Minimum sampled distance between every cut-line pair | < 2mm → both cut lines flagged red |
| **Margin** | `boundsWithin(cutlineBounds, safeAreaRect)` | Any edge outside the safe area → flagged red |

The safe area is read from a `"Margin"` layer rectangle if the template has one;
otherwise computed as a 190 × 267 mm rectangle (A4 minus 10mm top/left/right margins)
from the artboard top-left.

## Algorithm (`aiUtils.jsx`)

Spacing is a minimum-distance check, not an overlap check:

- `samplePathToPolygons(item, steps)` — bezier-samples each cut line into closed
  polygons (document points).
- `minPolygonSetDistance(polysA, polysB)` — minimum point-to-segment distance across
  all polygon pairs, with a containment precheck (`pointInPolygon`). Returns 0 if
  either polygon contains the other.
- `_bboxNear(g1, g2, threshPt)` — cheap bounding-box prefilter: skip pairs whose
  bboxes are more than 2mm apart in any axis.

Stamps (PlacedItem) are approximated by their `visibleBounds` rectangle — adequate
for 2mm spacing; no DOM objects created.

## Confirmed / tunable values

| CONFIG (in `AI_ExportFinal.jsx`) | Default | Notes |
|---|---|---|
| `spacingThresholdMm` | 2 | Confirmed from playbook ("2mm between elements"). |
| `qaSpacingSampleSteps` | 12 | Bezier samples/segment. 12 → ~0.4mm sample spacing at sticker scale — well under 2mm threshold. |
| `flagStrokePt` | 1.0 | Red stroke weight for flagged cut lines. |
| `workingAreaWidthMm` / `HeightMm` | 190 / 267 | Margin fallback dimensions. |
| `marginTopMm` / `marginLeftMm` | 10 / 10 | Margin fallback inset from artboard top-left. |
| `cutlinesLayerName` / `marginLayerName` | "Cutlines" / "Margin" | Must match the template. |

## Playbook mapping

Playbook step 6 (Refinements) — the *Offset Path* spacing check + the
*do-not-exceed-margin* check, after the manual Pencil pass.

## Files

- Step function: `illustrator/Step8c_OffsetPathQA.jsx` (`runOffsetPathQA`)
- Pipeline: `pipelines/AI_ExportFinal.jsx`
- Utilities: `utils/aiUtils.jsx` (`minPolygonSetDistance`, `_ptSegDist`,
  `samplePathToPolygons`, `pointInPolygon`, `boundsWithin`, `strokeRecursive`,
  `redCmyk`, `mmToPoints`, `findGroupMember`, `findLayer`)

## Testing

See `tests/integration/run-step8c.sh`. Use a post-pencil fixture with at least
one deliberately too-close pair (`flagged > 0` is asserted). After a run, verify:

1. Too-close cut lines are red; well-spaced cut lines are untouched.
2. Cut lines crossing the margin are red; others are not.
3. Log shows `FLAG | spacing Xmm` and `FLAG | cut line exceeds margin` entries.
4. `checked` matches the number of cut lines in the Cutlines layer.
