# Caption-Junction Sliver Removal — Design

**Date:** 2026-07-22
**Status:** Design — approved in brainstorm, pending spec review.
**Author:** Joshua + Claude

## Problem

The fused cutline is `Unite(outline, plate)` (`deriveCutline` in `utils/aiUtils.jsx`).
Where the caption pill grazes the art's wavy bottom edge near-tangentially, the boolean
leaves tiny degenerate closed loops — "blobs of holes" — at the caption junction. They are
separate leaf subpaths of the fused cut, not part of the real silhouette.

Confirmed live on the `resize-elements.ai` normalise fixture: the "Slovak Paradise National
Park" fused cut has **3 leaf subpaths** with bounding-box areas **16145, 49, 15 pt²** — the
16145 is the real sticker contour; the 49 and 15 are the two blobs. They cluster in the
submerged strip where the pill sits inside the art (mid-span, under the wavy edge — not at
the pill's left/right cap ends).

The artist wants these blobs gone so that between the two half-cut endpoints there is no
stray full-cut geometry — only the half-cut crosses that span.

### Why not just delete them by hand

`deriveCutline` re-Unites from the preserved `outline` + `plate` members on **every**
regeneration (Step 6 birth, Step 7B post-nest, Step 8b / normalise). The boolean re-creates
the blobs each time, so a manual deletion is blown away on the next normalise pass. The fix
must live inside the regeneration so it re-applies automatically. The un-merged `outline` and
`plate` are always intact, so nothing is lost by stripping the derived blobs — the shape is
recomputed from the sources each run.

## Prior art (why this was reverted before, and why it's safe to revive)

A broader routine `cleanCaptionJunction()` existed (commit `4bb0f6e`, 2026-06-14) and did two
things: (1) **sliver removal** and (2) **fillet** — rebuilding the junction corner as a smooth
circular arc. It was validated in-app ("all 22 junctions smooth, 6 slivers gone, idempotent")
then **reverted** (`3832988`, ~15h later) with **no bug cited**. The revert coincided with a
major caption-*seating* rewrite; the read is that a delicate multi-anchor junction-rebuild was
a maintenance liability while the geometry underneath it was in flux, so it was reverted to the
trivially-robust raw `Unite` and the sliver was declared "intentional" (accepted-for-now).

That churn is over — the seating stabilised (two-point contact merged to `main`, PR #27). This
design revives **only the sliver-removal half** (scope decision A). The fillet half is **not**
brought back: the artist did not report a spike/horn on the main contour, only the blobs.

Rejected alternatives recorded in `4bb0f6e` (do not re-attempt): raster white-fill / bridge on
the PS side ("every variant produced a new spike in the traced cut"), and the old
single-anchor `filletJunctionCorners` ("insufficient, fired on 9/22, invisible").

## Approach

A single function in `aiUtils.jsx`:

```
removeCaptionJunctionSlivers(cutline, outline) -> { removed: N }
```

### Rule — the "compare against the outline" test

Distinguish a junk sliver from a genuine art hole by asking: **did this loop already exist in
the art before the caption pill was welded on?** The plate `Unite` leaves real art holes
untouched (same position, same size); junction slivers are *invented* by the union at the
pill∩art seam and have no counterpart in the art-alone trace.

1. Enumerate the fused cut's **leaf** subpaths (a leaf = one closed loop; the fused cut is a
   GroupItem/CompoundPathItem holding several). Enumerate the `outline` (art-alone) subpaths
   the same way.
2. Keep the **largest** fused leaf always — it's the real sticker contour, never a candidate.
3. For every **other** fused leaf: keep it if some `outline` subpath **matches** it (centroids
   nearly coincident AND areas within a wide tolerance); otherwise it's a sliver → delete.

Match margins are deliberately **wide-margin, not tuned**: on the live Slovakia SKU real echoes
coincide exactly (centroid distance ~0 pt, area ratio ~1.00) while slivers miss by a mile
(distance 20–63 pt, area ratio 0.00–0.007). Defaults: centroid within **10 pt**, area within
**±25%**. Nothing in the real data lands between the two clusters.

### Why not the earlier candidates

- **Overlap test (centroid inside plate∩art), TRIED AND REJECTED 2026-07-22:** matched **zero**
  real slivers in live testing. The slivers straddle the seam boundary, so their centroids land
  inside-art-only, inside-plate-only, or outside-both — never cleanly inside both. Dead.
- **"Delete all non-largest leaves":** unsafe — some SKUs have genuine art holes (the **Tram**
  element's outline has 2 subpaths; its 299 pt² hole survives as a separate fused leaf and must
  be kept). The compare-to-outline test protects these by construction.
- **Old `bandPt` proximity (from `4bb0f6e`):** would work but needs a tuned junction-distance
  number and a plate∩art crossing computation. The compare-to-outline test is more principled
  (self-explaining) and needs neither.

### Evidence (live, `resize-elements.ai` fixture, 2026-07-22)

Per-element, comparing each non-largest fused leaf to the nearest `outline` subpath:

| Element | leaf | centroid dist to outline | area ratio | verdict |
|---|---|---|---|---|
| Slovak Paradise | 49 pt² | 55.6 pt | 0.003 | sliver → delete |
| Slovak Paradise | 15 pt² | 60.8 pt | 0.001 | sliver → delete |
| Kroje | 104 pt² | 61.2 pt | 0.007 | sliver → delete |
| Tram | 299 pt² | **0 pt** | **1.000** | real hole → **keep** |

Full-SKU scan: 16 slivers, 2 real holes, 0 ambiguous.

### Wiring

Called **inside `deriveCutline`**, after `expandStyle` bakes the union and before the result
is returned. `deriveCutline` already receives `outline`, so the art-alone trace is in hand.
Because every caption regeneration funnels through `deriveCutline` (Step 6 → 7B → 8b/normalise),
the cleanup re-applies on each one with no per-step wiring.

Always-on; no CONFIG gate.

### Idempotency

Each regeneration re-Unites (re-creating the blobs) then strips them, always landing at the
same clean state: fused leaf count == outline leaf count. Calling the cleanup on an
already-clean cut is a no-op (no unmatched non-largest leaves remain). Safe to loop, which
normalise requires.

### Reused helpers (all present in current `aiUtils.jsx`)

- `boundsCenter(bounds)` — leaf centroid from `geometricBounds` (returns `{x,y}`).
- A small local leaf-enumeration helper (PathItem / CompoundPathItem / GroupItem → leaf
  PathItems). No polygon sampling or point-in-polygon needed — the decision works purely on
  each leaf's centroid + bbox area.

### Logging

`log("[cutline] junction slivers removed | " + removed)` inside `deriveCutline` when
`removed > 0`. Name-less by design — `deriveCutline` is the DRY chokepoint and has no element
name. Deterministic (fixed element order), so it appears cleanly in goldens.

## Testing

- **Integration:** extend `tests/integration/ai-normalise-captions/run.sh` to assert, per
  captioned element, that **the fused cut's leaf count equals the `outline`'s leaf count** after
  normalise (slivers gone, real holes like Tram's kept). Then regenerate the golden
  (`expected.txt`). The assertion must return its result via the osascript **AppleScript return
  value**, NOT a `File.write` to `/tmp` — writing to `/tmp` from Illustrator under osascript is
  silently TCC-blocked on this machine.
- **Idempotency:** the runner's existing Run #2 pass must stay `reset=0`; the leaf-count-equals
  assertion must also hold on Run #2.
- **Unit:** the pure decision (`_junctionSliverLeaves(fusedLeaves, outlineLeaves)`) has a node
  test covering: a sliver (no outline match) deleted; a real hole (outline match) kept; the
  largest leaf never deleted; a clean cut (all matched) → no-op.
- **Live check:** osascript re-inspection confirming Slovak Paradise 3 → 1 leaves and Tram
  staying at 2 (its real hole intact), plus the artist's visual eyeball.

## Out of scope

- Junction filleting / spike smoothing (`_filletAtCrossing` and its bezier-arc machinery).
- Any PS-side / raster change.
- The default-tab (non-caption) cutline path — untouched.

## Risk / edge cases

- **Element with a genuine art hole (e.g. Tram):** kept, because that hole exists in the
  `outline` and the fused leaf matches it (centroid ~0, area ~1.0). Protected by construction.
- **Fused cut is a single PathItem (no extra leaves):** largest by definition, no candidates —
  no-op.
- **Match thresholds:** centroid ≤ 10 pt, area within ±25%. Wide-margin vs the live gap
  (real ~0 pt / ~1.0; sliver ≥20 pt / ≤0.007), so not fragile. If a future SKU shows an art
  hole whose `Unite` shifts its area/position beyond these margins, widen them (they only need
  to separate ~1.0 from ~0.01).
