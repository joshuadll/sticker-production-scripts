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
removeCaptionJunctionSlivers(cutline, outline, plate) -> { removed: N }
```

### Rule (parameter-free — the "overlap" test)

1. Enumerate the fused cut's **leaf** subpaths (a leaf = one closed PathItem loop; the fused
   cut is a GroupItem / CompoundPathItem holding several).
2. Identify the **largest** leaf by bbox area — the real sticker contour. **Always keep it.**
   It is never a deletion candidate.
3. For every **other** leaf, delete it iff its **centroid lies inside the plate∩art overlap**
   — i.e. inside the pill polygon AND inside the art-outline polygon.

The overlap (the submerged lens where the pill is inside the art) is exactly where boolean
crumbs form. A legitimate hole in the art body lives up in the artwork, away from the
submerged strip, so it fails the "inside the pill" half of the test and is kept. Using the
leaf's **centroid** (which sits clearly down in the overlap) rather than "all anchors" avoids
on-edge point-in-polygon twitchiness, since the blob loops straddle the art boundary.

**No tunable parameters.** No `bandPt`, no area cap, no "two endpoints" assumption (the wavy
edge produces many crossings, and blobs form mid-span, so an endpoints-only rule would miss
them — the overlap test needs no crossing computation at all).

### Wiring

Called **inside `deriveCutline`**, after `expandStyle` bakes the union and before the result
is returned. `deriveCutline` already receives `outline` and `plate`, so both polygons are in
hand. Because every caption regeneration funnels through `deriveCutline`
(Step 6 → 7B → 8b/normalise), the cleanup re-applies on each one with no per-step wiring.

Always-on; no CONFIG gate.

### Idempotency

Each regeneration re-Unites (re-creating the blobs) then strips them, always landing at one
clean contour. Calling the cleanup on an already-single-leaf cut is a no-op (only the largest
leaf is present, and it's never a candidate). Safe to loop, which normalise requires.

### Reused helpers (all present in current `aiUtils.jsx`)

- `samplePathToPolygons(item, steps)` — polygonise plate + outline.
- `_largestPoly(polys)` — pick the dominant polygon of a sampled path.
- `_pointInPolysEO(pt, polys)` / `pointInPolygon(pt, poly)` — point-in-polygon.
- `boundsCenter(bounds)` — leaf centroid from `geometricBounds`.
- A small local leaf-enumeration helper (PathItem / CompoundPathItem / GroupItem → leaf
  PathItems), mirroring the old `_cjLeafPaths`.

### Logging

`log("[cutline] junction slivers removed | " + name + " | " + removed)` when `removed > 0`
(name resolved by the caller where available; `deriveCutline` may log a generic line and the
count).

## Testing

- **Integration:** extend `tests/integration/ai-normalise-captions/run.sh` to assert that
  after normalise **every fused cut has exactly one leaf subpath**, then regenerate the golden
  (`expected.txt`). This runner already opens the exact fixture that exhibits the blobs.
- **Idempotency:** the runner's existing Run #2 pass must stay `reset=0`; the new leaf-count
  assertion must also hold on Run #2 (still one leaf).
- **Live check:** osascript re-inspection of "Slovak Paradise National Park" (and 2–3 others)
  confirming leaves 3 → 1, plus the artist's visual eyeball in Illustrator that the blobs are
  gone and the half-cut span is clean.

## Out of scope

- Junction filleting / spike smoothing (`_filletAtCrossing` and its bezier-arc machinery).
- Any PS-side / raster change.
- The default-tab (non-caption) cutline path — untouched.

## Risk / edge cases

- **Element with a genuine small art hole near the caption:** kept, because its centroid is
  inside the art but NOT inside the pill (not in the overlap). This is the case scope-B safety
  was chosen to protect.
- **Fused cut is a single PathItem (no group):** one leaf, largest by definition, no
  candidates — no-op.
- **Overlap sampling resolution:** polygonise plate/outline with `CONFIG.halfcutSeamSteps`
  (the step count the rest of the caption seam geometry already uses), falling back to a
  small local default (e.g. 16) if `CONFIG` is not in scope — mirroring the old routine.
