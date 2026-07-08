# Upright per-element PNG export — design

Date: 2026-07-08
Status: approved (brainstorm), pending implementation
Scope: `illustrator/Step10_AssetExport.jsx` (per-element PNG path only) +
small shared helpers in `utils/aiUtils.jsx`.

## Problem

Step 10 exports one PNG per element (product/listing art). It duplicates the
placed art + cutline **exactly as they sit in the nested layout** — rotated by
the Deepnest transform (Step 7B) and by any **manual rotation the artist applied
during nesting** — then clips to the cutline and exports. Result: each PNG is
**tilted**, and because a PNG is always a rectangle cropped to the visible art's
axis-aligned bounding box, a tilted sticker sits in an oversized rectangle with
transparent corner padding ("looks rectangular").

Asks:
1. **Upright** — each element PNG in its design/birth orientation, not the nest
   orientation, **including after heavy manual per-piece rotation**.
2. **Border the cutline / not rectangular** — the file should hug the die-cut.

## Findings (current behavior)

- **Resolution already correct.** `AI_ExportFinal` reads `sourceDPI` from the
  sidecar and sets `CONFIG.pngExportScale = sourceDPI`; Step 10 exports PNG24 at
  that DPI. No change. (`AI_ExportFinal.jsx:103`, `Step10:265`)
- **Die-cut clipping already works** for GC/WC/ST — the "rectangle" is only the
  tilt's bbox padding, not a clipping failure.
- **Stamps are not a special case here.** An ST element gets a traced silhouette
  outline + default peel tab united into a normal group cutline (Step 6). The
  `PlacedItem` → white-rectangle branch in Step 10 is a **dormant** provision for
  the unused `stampTemplatePath` feature (no CONFIG sets it; the asset was
  deleted). Current runs never hit it. Left untouched.
- **Stored/matrix angles are NOT reliable sources for upright:**
  - The `u<deg>` note stamp (Step 7B reconcile) records the **nest-time** angle.
    It does NOT reflect manual per-piece rotation done after nesting — and the
    artist does a lot of that. Unsuitable as the primary source.
  - The embedded art raster's live matrix is corrupted for this purpose:
    `Step7B:602-606` documents that **`embed()` flips the raster matrix's sign**,
    so reading `_nestVisAngle` on the post-embed raster gives the wrong-signed
    angle. Unverifiable headless. Unsuitable.
- **The caption geometry IS a reliable, manual-rotation-proof reference.** Every
  real element carries a bottom feature authored **horizontal** at design time:
  - GC/WC captioned → `" plate"` member (the pill). (`aiUtils.jsx:1264`)
  - ST/uncaptioned (default peel tab) → **also** a `" plate"` member:
    `assembleElementGroup` renames the tab's cutline to `"<name> plate"`
    (`aiUtils.jsx:1252` passes it as the `plate` arg → `:1345` renames it). The
    bare `" tab cutline"` name is transient and does not survive assembly, so
    `" plate"` is the single reference for **every** element type at Step 10.
  These are vector paths whose coordinates bake in nesting **and every manual
  rotation**, so their current orientation is the element's true current
  orientation — independent of any matrix bookkeeping.

## Approach

Isolated change to `_s10ExportElementPng` (+ two shared helpers in aiUtils). The
sheet JPEG previews (`_s10ExportJpegs`) stay nested — they must show the real
layout. Nesting code (Step 7B) is NOT touched (avoids re-validating the nest).

For each element, after the temp clip group is assembled and before
`doc.exportFile`:

1. **Find the reference path** on the element's live cutline group
   (`entry.cutline`): `findGroupMember(cutline, " plate")` — this covers GC/WC
   pills AND ST/default-tab cutlines (both named `"<name> plate"` after
   assembly). A `findGroupMember(cutline, " tab cutline")` lookup is kept only as
   a defensive fallback and does not match an assembled group.
2. **Measure its long-axis angle φ** via the **farthest-apart anchor pair** of
   the reference path (sample anchors; O(n²) max-distance pair; `φ = atan2(dy,
   dx)` of that pair). The two ends of a pill/tab are its farthest points, so the
   pair direction is the long axis. Works on warped WC capsules (end tips define
   the chord ≈ horizontal at upright).
3. **Rotate the clip group by `-φ`** about its own center, using a pivot matrix +
   `Transformation.DOCUMENTORIGIN` (same convention as Step 7B's
   `_nestPivotMatrix`; a raster's `.rotate()` counter-rotates, so an explicit
   matrix is required — `Step7B:566-568`). Rotating the assembled group keeps
   art + cutline + white backing + caption locked in register.
4. **Resolve up/down (180°):** compute the reference-feature centroid and the
   `" outline"` (art) centroid AFTER the `-φ` rotation. In upright the reference
   sits **below** the art (smaller y in Illustrator's y-up bounds). If the
   reference centroid is **above** the art centroid, rotate the group another
   180° (same pivot).
5. Export as today. Upright orientation tightens the PNG bbox automatically.

"Upright" = the reference feature horizontal and below the art = the Step-6
design orientation. A warped WC caption exports with its **end-chord horizontal**
(its natural design orientation), accepting a tiny residual bow-tilt.

## New shared helpers (aiUtils.jsx)

Added to aiUtils so Step 10 (which does not include Step 7B) can use them.
Mirror Step 7B's proven math verbatim; Step 7B keeps its private copies for now
(intentional short-term duplication — de-dup deferred to avoid re-validating the
nest).

```javascript
// Rotation-about-pivot matrix (mirrors _nestPivotMatrix).
function pivotRotationMatrix(angleDeg, px, py) {
    var m = app.getTranslationMatrix(-px, -py);
    m = app.concatenateRotationMatrix(m, angleDeg);
    m = app.concatenateTranslationMatrix(m, px, py);
    return m;
}

// Long-axis angle (deg, +CCW convention matching pivotRotationMatrix) of a
// PathItem/CompoundPathItem via its farthest-apart anchor pair. Returns null if
// fewer than 2 anchors. Robust to warp; independent of the item matrix.
function longAxisAngleDeg(pathItem) { ... }   // see plan for full body

// Centroid of a PathItem/CompoundPathItem's anchor points ({x, y}) or null.
function anchorCentroid(pathItem) { ... }      // see plan for full body
```

## What does NOT change

- JPEG sheet previews (nested layout preserved).
- Resolution / `pngExportScale`.
- Clipping, white backing, caption assembly.
- Stamp white-rectangle branch (dormant; left untouched).
- Step 7B nesting code, Step 11 / final file.

## Edge cases

- **No `" plate"` and no `" tab cutline"`** (shouldn't happen for a real
  element): fall back to the `u<deg>` note stamp (`noteReadRotStamp`); if absent,
  export as-is (angle 0) and log a WARN naming the element. Never silently guess.
- **Reference path with < 2 anchors** (degenerate): treat as "no angle" → same
  WARN + as-is fallback.
- **Angle ≈ 0** already upright: `pivotRotationMatrix` with |angle| < 0.05° is a
  no-op-ish; guard by skipping rotation below a small threshold.
- **Dormant stamp white-rectangle branch:** if it ever fires, rotate the art dupe
  first (matrix approach), THEN build the white rect from the rotated bounds so
  the rect stays axis-aligned to the upright art. Kept correct though not
  currently exercised.

## Testing

- **Integration golden:** regenerate `tests/integration/ai-export-final/expected.txt`
  after adding the new `[step10]` orientation log line (angle applied + fallback
  WARNs). Sheet geometry unchanged; only per-element PNG orientation changes.
- **Manual Adobe checklist** (owed — cannot render-verify headless): open a
  nested fixture, **manually rotate a few pieces**, run `AI_ExportFinal`, confirm
  each `{STK}_{name}.png` is upright, caption horizontal and right-side-up
  (verify the 180° up/down branch), die-cut + caption still registered, bbox
  tight.

## Preferences honored

- Isolated change; nesting code untouched.
- Native transform API + proven pivot-matrix convention — no reinvention.
- Orientation derived from geometry, not a magic constant, and robust to manual
  rotation (the stated real-world requirement).
- Warn-on-all: a missing/degenerate reference is logged, never silently dropped.
- Can't fully validate headless → guard + log + manual checklist.
