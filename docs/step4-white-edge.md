# Step 4 (Step 2B) — White Edge

## What it does

Adds the white "sticker edge" around every element Smart Object, and smooths
that edge so the cut line traced from it is clean. Runs in Photoshop after
Step 2A (resize) and before Step 3A (caption text), so the artist reviews
captions against the final element shape.

Playbook 1 (White Edge + SO) → `photoshop/Step2B_WhiteEdge.jsx` (`runWhiteEdge`).

## Per element (`applyWhiteEdge`)

1. Load the SO's transparency as a selection (no rasterising).
2. **Expand** by `CONFIG.whiteEdgePx` → the border band.
3. **Smooth** the band's outer edge with `Select > Modify > Smooth`
   (`CONFIG.whiteEdgeSmoothRadiusPx`, via `smoothSelection()` in psUtils — the
   Selection DOM has no `smooth()`, so it's driven by Action Manager event
   `Smth`, radius key `Rds ` in pixels). `0` disables smoothing.
4. Fill a new pixel layer `White Base_Cutline` with white, below the SO.

Re-run guard: if a `White Base_Cutline` already sits directly below the SO, the
element is skipped (prevents double-application). To re-tune one element, delete
its band layer and re-run.

## Why smooth here (replaces the old Illustrator-side RDP)

The cut line does **not** travel from Photoshop to Illustrator. Step 5 flattens
the Elements group (art + white edge, captions hidden) into a black silhouette
PNG, and Step 6 **re-traces that raster** with Image Trace. So the cutline's
outer contour *is* the white-edge band's outer edge, born jagged at the
raster→vector trace.

Smoothing the band here means the silhouette — and therefore the trace and the
cutline — is clean from birth, and the **printed** white edge and the cutline
both derive from the same smoothed raster, so they stay consistent by
construction. This removes the need for the former Illustrator-side RDP pass
(old Step 8a / `AI_RefineCutlines`), which has been deleted.

## Confirmed / tunable values

| CONFIG (in `PS_BuildElements.jsx`) | Default | Notes |
|---|---|---|
| `whiteEdgePx` | 20 | Border width (px). ≈1.7mm at 300 DPI. Step 2A shrinks art by 2×this so finished size hits the category target. |
| `whiteEdgeSmoothRadiusPx` | 20 | Smooth Sample Radius (px). Landed at 20 on a real watercolor SKU (2026-06-12). ⚠️ Re-tune if cornered elements (stamps/buildings) soften; too large vs `whiteEdgePx` rounds away genuine corners and, acting after the expand, can marginally shift finished bounds at sharp corners. `0` disables. |
| `whiteEdgeLayerName` | `White Base_Cutline` | Created band layer name. |

## Files

- Step function: `photoshop/Step2B_WhiteEdge.jsx` (`runWhiteEdge`, `applyWhiteEdge`)
- Pipeline: `pipelines/PS_BuildElements.jsx`
- Utilities: `utils/psUtils.jsx` (`loadLayerTransparency`, `smoothSelection`, `solidWhite`)

## Testing

`tests/integration/run-ps-build-elements.sh`. After a run, verify:

1. Every captioned/uncaptioned element has a `White Base_Cutline` band below it.
2. The band's outer edge is visibly smooth (no stair-stepping) — confirm on a
   real trace that the resulting Step 6 cutline has far fewer anchors.
3. Re-running skips elements that still have their band (idempotent).
