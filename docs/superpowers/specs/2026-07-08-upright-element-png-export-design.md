# Upright per-element PNG export — design

Date: 2026-07-08
Status: approved (brainstorm), pending implementation
Scope: `illustrator/Step10_AssetExport.jsx` (per-element PNG path only)

## Problem

Step 10 exports one PNG per element (used as product/listing art). Today it
duplicates the placed art + cutline **exactly as they sit in the nested layout**
— i.e. rotated by the Deepnest transform baked in Step 7B — then clips to the
cutline and exports. Result: each PNG comes out **tilted**, and because a PNG is
always a rectangle cropped to the visible art's axis-aligned bounding box, a
tilted sticker sits inside an oversized rectangle with transparent corner
padding. That reads as "rectangular" and is not upright.

Two asks:
1. **Upright** — each element PNG should be in its design/birth orientation, not
   the nest orientation.
2. **Border the cutline / not rectangular** — the file should hug the die-cut
   shape.

## Findings (current behavior)

- **Resolution is already correct.** `AI_ExportFinal` reads `sourceDPI` from the
  sidecar and sets `CONFIG.pngExportScale = sourceDPI`; Step 10 exports PNG24 at
  that DPI. No change needed. (`AI_ExportFinal.jsx:103`, `Step10:265`)
- **Die-cut clipping already works.** For GC/WC/ST elements the cutline is a
  `GroupItem`; Step 10 builds `[cutline (mask) · art · white backing · caption]`
  and sets `group.clipped = true`, so the visible art is clipped to the cut and
  transparent outside. The "rectangle" is only the tilt's bounding-box padding —
  not a clipping failure.
- **Stamps are not a special case here.** An ST element gets a traced silhouette
  outline + default peel tab united into a normal group cutline (Step 6), so it
  clips like everything else. The `PlacedItem` → white-rectangle branch in
  Step 10 is a **dormant** provision for the unused `stampTemplatePath` feature
  (no pipeline CONFIG sets it; the `Stamp Cutline Template.ai` asset was deleted).
  Current runs never hit it.
- **The nest angle is recoverable from the art's matrix.** Art is placed upright
  (identity matrix) then rotated to nest, so the art raster's matrix rotation
  *is* its deviation from upright. `_nestVisAngle(item)` (`Step7B:609`) already
  computes it: `-atan2(mB, mA)`. Step 7B also persists this as a `u<deg>` stamp
  on the cutline note (`aiUtils.noteReadRotStamp`), which survives to Step 10
  (Step 8b does not rewrite the note).

## Approach

Isolated change to `_s10ExportElementPng` only. The sheet JPEG previews
(`_s10ExportJpegs`) stay nested — they must show the real layout.

After the temporary clip group is assembled and before `doc.exportFile`:

1. Determine the element's upright angle:
   - **Primary:** read the duplicated art's rotation live via `_nestVisAngle`
     (the art dupe carries the same matrix as the nested original). This captures
     any manual rotation the artist applied after nesting.
   - **Fallback 1:** if the art item's matrix isn't readable (unexpected
     typename), use the `u<deg>` note stamp via `noteReadRotStamp(entry.cutline.note)`.
   - **Fallback 2:** if neither is available, export as-is (angle 0) and log a
     WARN naming the element. Never silently guess an angle.
2. Rotate the **whole temp clip group** by `-angle` about its own center, using a
   pivot matrix + `Transformation.DOCUMENTORIGIN` (same convention as Step 7B's
   `_nestPivotMatrix`). Rotating the assembled group keeps art + cutline + white
   backing + caption locked in register.
3. Export as today. The upright orientation tightens the PNG bounding box
   automatically (Illustrator crops PNG24 to visible art bounds).

"Upright" means **undo the nest rotation**, restoring the Step-6 design
orientation. A WC piece designed on a curve is exported at its design angle — it
is not artificially straightened.

## What does NOT change

- JPEG sheet previews (nested layout preserved).
- Resolution / `pngExportScale`.
- Clipping, white backing, caption assembly.
- Stamp white-rectangle branch (dormant; left untouched).
- Step 11 / final file.

## Edge cases

- **Angle ≈ 0** (element already upright, e.g. regular-cluster pieces): rotate by
  a near-zero angle — no-op in practice. Guard with a small threshold (e.g. skip
  rotation when `|angle| < 0.5°`) to avoid needless transforms.
- **Stamp via white-rectangle branch** (dormant): if it ever fires, the art dupe
  still has a matrix, so the same rotation applies; the white rect is drawn from
  the *rotated* art's bounds, so build the rect after rotation (or rotate the art
  before computing `wb`). Keep this correct even though it's not currently
  exercised.
- **Missing/unreadable angle:** WARN + export as-is (see Fallback 2).

## Testing

- Regenerate the `ai-export-final` integration golden if its log lines change
  (new `[step10]` rotation/WARN lines). Geometry of the sheet is unchanged; only
  per-element PNG orientation changes, which the log golden should capture via
  any new log lines.
- Manual Adobe check (owed, can't validate headless-perfectly): open a nested
  fixture, run `AI_ExportFinal`, confirm each `{STK}_{name}.png` is upright and
  tightly cropped, die-cut and caption still registered.

## Preferences honored

- One isolated change, one concern.
- Native transform API + existing helpers (`_nestVisAngle`, `noteReadRotStamp`,
  pivot-matrix convention) — no reinvention.
- Scale/orientation derived from geometry, not a magic constant.
- Warn-on-all: a missing angle is logged, never silently dropped.
- Can't fully validate headless → guard + log + manual checklist.
