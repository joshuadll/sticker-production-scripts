# Native Captions (Illustrator) — Design / Port Spec

**Date:** 2026-06-24
**Status:** Design — pending review. Implementation NOT started.
**Related:** memory `illustrator_rewrite` (reframe banner — incremental, not a rewrite),
`illustrator_rewrite_transfer` (the load-bearing relational rules). Supersedes the caption
assumptions in `2026-06-24-illustrator-spine-ingest-design.md` (itself superseded).

---

## 1. Context

The de-risk spike reframed the effort: **keep the structural spine** (PS raster white edge → AI
trace → cut) and replace **PS caption *reproduction*** with **AI-native captions**. This is the
one real change. It is a **port** of the proven PS caption-pill algorithm into Illustrator, plus
**deletion** of the PS→AI caption sidecar — not a new design. The straight/curved caption mix is
already handled by the existing algorithm (it samples the actual text shape); the goldens prove it.
The only thing that ever made curves fragile was *reproducing* them across the tool boundary, which
disappears when the text is authored and pilled in the same tool.

## 2. Where it lives (confirmed flow, Phase B)

- **B1** 🤖 trace silhouette → cut; place colour art. `[reuse]`
- **B2** 🤖 place caption **text** (= element name default) near each element. `[new, trivial]`
- **B3** ✋ **artist reviews/reshapes the text** — reposition, shorten, shape (straight or curved
  to follow the art). `[manual — moved PS→AI]`
- **B4** 🤖 build the **pill** around the text shape → **seat** into the white edge → **unite** into
  the cut → derive **half-cut**. `[port + reuse]`

## 3. Caption = two separable things (unchanged principle)

- **TEXT** (printed ink) — authored natively in AI, shaped by the artist. Default = element name;
  artist edits/shortens. Kalam-Regular 8pt, tracking −20, centered, black.
- **PILL** (structural white background + peel tab) — built around the text shape; united into the cut.

## 4. Reuse / Port / Delete map

**Reuse — already in `aiUtils`, validated:**
- `buildCapsuleFromSpine` + `_capsulePolygon` — the capsule sweep (already the AI port of PS `_capsulePolygon`).
- `buildPlate` — GC parametric pill.
- `seatPlateToOutline` (+ `_innerEdgeVerts`/`_probeOutline`/`_aiSeatGeometry`/`_aiKissVector`/`_rotateItemsAbout`) — seat into the white edge (authoritative).
- `deriveCutline` / `reuniteCutline` / `assembleElementGroup` / `findGroupMember` — cut + separable bundle.
- `syncHalfcut` / `plateSeamPath` — half-cut from the submerged pill arc.

**Port (PS → AI) — the new code:** the **spine-derivation** (today `_sampleTextSpine` +
`_quadFitSpine` + `_straightSpine` + `_percentile` + radius formula in `Step3B`). Same algorithm;
the *input* changes from PS rendered alpha to AI vector text outline (see §5).

**Delete:**
- `WC_CAPTION_SPINES` sidecar stash + the `spine`/`radius` fields in `_elements.json`.
- Step 6's caption-rebuild-from-sidecar (`_buildSeparableCutline`'s capsule-from-sidecar branch).
- PS `Step3A` (caption text) and `Step3B`'s caption building (`createWhiteFromText`,
  `seatCaptionConform`, pill/plate). PS keeps only combine/resize/white-edge/silhouette export.
- The PS rough seat — the AI seat (`seatPlateToOutline`) is now the only seat.

## 5. The one non-trivial port: AI spine-sampler

The artist's reshaped caption is a vector `TextFrame`. To get the spine + per-slice heights that
`buildCapsuleFromSpine` needs (matching PS `_sampleTextSpine`):

1. `createOutline()` the text → glyph outline geometry (compound paths with holes).
2. Sample it in **vertical columns** (step ≈ 1.0 mm). Per column, compute the **filled vertical
   span** via even-odd crossings of the outline edges along the column → center = spine point,
   span = height. (Vector analog of "intersect the alpha with a column.") Reuse the existing
   segment-intersection / sampling toolkit (`samplePathToPolygons`, `segmentsIntersect`).
3. Feed the points to a ported `_quadFitSpine` (least-squares quadratic; **snap to straight** if
   max deviation ≤ ~0.5 mm). Pure geometry → port verbatim.
4. `radius = penH/2 + pad/2`, where `penH` = bbox height (straight) or the 90th-percentile column
   height (curved, since an arc inflates the bbox); `pad = 1.69 mm`.
5. Feed `spine` + `radius` to `buildCapsuleFromSpine` → the pill.

**Multi-line:** read the `TextFrame` line count directly → force a flat spine at block center (as
PS does). Trivial.

**Constants** (mm, converted from PS px@300DPI): slice step 1.0 mm (12px), pen pad 1.69 mm (20px),
straight-snap 0.5 mm (6px), curved-height percentile 0.9.

**Possible simplification (note, not primary):** if the artist's reshape exposes a baseline/path
(e.g. text-on-path), that path can serve as the spine directly, skipping the column sampling. The
sampling approach is primary because it faithfully handles *any* reshape method (the PS approach
samples the rendered result regardless of how it was shaped).

## 6. Seat + unite (reuse — into the WHITE EDGE, not raw art)

- Seat the rigid `{text, pill}` unit **into the white-edge contour** (the traced cut) via
  `seatPlateToOutline`: inner-edge endpoints → rotate to the white-edge chord → kiss-submerge by
  `seatOverlapMm` (0.1) → overhang/convex-bulge balanced shrink. **The overlap IS the attachment** —
  it must submerge, not touch (see `illustrator_rewrite_transfer`).
- `plate = pill`; `cut = Unite(outline, plate)` where `outline` = the traced white-edged silhouette.
  `assembleElementGroup` bundle; `group.note = "{styleCode}|{lines}"`.
- Half-cut from the submerged pill arc; ends re-projected onto the cut + 1 mm tail.

## 7. Downstream touch-points (small adjustments)

- **Step 8b normalise** detects the artist's nest-scaling via the caption *PNG's placement matrix*.
  Native text has no placed-pixel baseline → replace with a native reference (compare rendered
  cap-height to the 8 pt spec, or track the bundle's scale factor). Re-spec → re-seat → re-Unite
  logic is otherwise unchanged.
- **Step 7B nest binding** binds `{cut, art, caption}` rigidly (identical matrices). The caption was
  a placed PNG; now it's a native text+pill group — bind that group instead. Rigid rule unchanged.
- **Step 10 export** — the caption was a placed PNG; native text renders directly. Outline at export
  if needed for print safety.

## 8. Stamps (ST)

Unchanged — no caption, no white edge, no half-cut, throughout.

## 9. Open / to confirm

- ✏️ **GC-LM decorative "Caption plate"** (the L/C/R bar): is it carried into AI as artwork and
  elongated natively (port `elongateCaptionPlate`), or already baked into the element art? Decides
  whether that elongate logic is ported or dropped.
- The AI spine-sampler's column-coverage method (§5 step 2) — the one piece to build + validate.
- The native-text scale reference for normalise (§7).

## 10. Validation

- The existing goldens implement the straight/curved mix → re-validate the AI port against the same
  SKUs (the spike's 26-element Slovakia set, including the curved food captions).
- ExtendScript geometry can't be validated headlessly → integration runner + an explicit inspection
  checklist (which elements, straight vs curved, pill hugs the text, pill submerges into the white
  edge, half-cut attached at both ends). Run 2× for determinism; goldens = log lines, blind to pixels.

## 11. Outcome

Captions are authored, shaped, pilled, seated, and cut **entirely in Illustrator** — the spine never
crosses a tool boundary, so the reproduction bug class is gone by construction. The work is: port one
sampler, reuse the capsule/seat/unite/half-cut already built, fix three small downstream touch-points,
and delete the PS caption steps + sidecar.
