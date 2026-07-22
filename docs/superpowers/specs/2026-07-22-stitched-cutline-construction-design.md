# Stitched Cutline Construction — Design

**Date:** 2026-07-22
**Status:** Design — approved in brainstorm, pending spec review.
**Author:** Joshua + Claude
**Supersedes:** the boolean `deriveCutline` + the caption-junction sliver-removal work
(`docs/superpowers/specs/2026-07-22-caption-junction-sliver-removal-design.md`).

## Problem

The fused cutline is built with a boolean union: `deriveCutline(outline, plate)` duplicates the
art outline and the caption plate, runs Live Pathfinder Add, and bakes it (`expandStyle`). Two
problems flow from the boolean:

1. **Touch-only seats don't fuse.** The caption seat is designed for exact *two-point contact*
   at zero embed (`captionSeatOverlapMm = 0`), so on a concave/flat base the caption touches the
   art at two points but shares no *area*. A boolean union of shapes that only touch at isolated
   points does not merge — the cutline comes out as two separate pieces (observed live on "Tatra
   chamois": caption is a separate leaf; 1 of 28). Measured: the seat lands both inner-edge
   endpoints exactly on the art edge (0.000–0.001 pt), so this is NOT a seat bug — two-point
   contact simply is not overlapping area.
2. **The boolean leaves junction slivers.** Where the caption's inner edge weaves across a wavy
   art edge, Pathfinder leaves tiny degenerate loops at the junction — the "blobs" that the
   (now-superseded) sliver-removal work was built to delete.

The prior fix direction — embed the caption a hair so it overlaps — was rejected: it deepens
every caption (a universal "junction bump") to solve a 1-in-28 case, and it fights the seat's
own two-point-contact design.

## Approach

Replace the boolean entirely. Build the cutline by **tracing the outer boundary of (art ∪
caption) directly** from the two junction points — the coherent version of the same idea the
seat already relies on. This is decision **A** from the brainstorm (always stitch, not a
fallback), so the boolean and the sliver machinery both retire.

### The construction (one topology: caption attached along one contiguous stretch of art edge)

1. **Find the junctions.** Sample both outlines to polygons and find where the caption outline
   crosses the art outline (reuse the crossing-finder already used by `plateSeamPath` /
   `_captionCrossings`). Refine each crossing to the true intersection by bisection
   (as `_segCrossArt` does).
2. **Take the two outermost crossings** — the pair farthest apart along the attach direction.
   They bound "the span": the stretch of art edge the caption attaches along.
3. **Stitch two arcs into one closed contour:**
   - the **art outline** everywhere *outside* the span (the full silhouette), plus
   - the caption's **outer arc** *across* the span — the grab edge + rounded caps, i.e. the
     plate arc that lies OUTSIDE the art. The caption's submerged inner edge is dropped entirely.

Because it uses only the two junction points (which the seat lands exactly on the art edge),
a touch-only seat joins with no embed. Because it never uses the caption's inner edge or the art
detail under the caption, no junction slivers can form. For deep-overlap captions the traced
boundary equals the boolean's union boundary (minus the sliver crumbs), so those cutlines are
unchanged.

### Curves and junctions (bezier-preserving)

Keep every bezier segment as-is EXCEPT the two segments that contain the junctions. Split each of
those at the exact crossing point (de Casteljau) so the junction becomes a clean anchor shared by
both arcs, then join the art's kept arc to the caption's kept arc there. The result stays smooth,
with two new corner anchors at the junctions (a corner is correct where art meets caption). Keep
the art's handle on the art side and the caption's handle on the caption side of each junction.

### Which arc to keep

- **Art:** of the two arcs the crossings split the art into, keep the one NOT under the caption —
  the longer/major arc (the silhouette). Determine "under the caption" by a midpoint-inside test
  against the caption polygon.
- **Caption:** of the two arcs the crossings split the caption into, keep the one OUTSIDE the art
  — the exposed grab arc. Determine "outside the art" by a midpoint-inside test against the art
  polygon (reuse `_pointInPolysEO` / `geom.sign`).

### Error handling — hard error, no fallback

The seat guarantees two-point contact, so there are always ≥ 2 crossings. If fewer than two
usable crossings are found (caption fully detached, fully inside, or degenerate), `deriveCutline`
returns a failure the caller surfaces and the pipeline aborts on — the same "unseated caption =
hard error" rule the half-cut already uses. There is no boolean fallback; the boolean is gone.

## Scope of change

- **`deriveCutline(outline, plate)`** — body replaced with the stitch. **Signature and return
  contract unchanged** (returns the fused cutline PathItem/CompoundPathItem; callers
  `buildCaption`, `buildDefaultTab`, `reuniteCutline` are untouched). On the degenerate case it
  must signal failure; today it always returns a shape, so the failure path is new — callers
  already handle a failed caption build (`buildCaption` un-nests and returns `{ok:false}`), so
  the failure must be surfaced in a way those callers already expect (see Open Questions).
- **Tabs** — default peel tabs call `deriveCutline`, so they use the stitch too. Validate.
- **Retire the sliver machinery** — remove `removeCaptionJunctionSlivers`, `_junctionSliverLeaves`,
  `_fusedCutLeaves`, and the normalise leaf-count assertion added for it. Remove the
  `[cutline] junction slivers removed` log line. Keep the sliver spec/plan docs as history.
- **`captionSeatOverlapMm` stays 0** — two-point contact honored; no embed, no bump.
- **Reused helpers:** `samplePathToPolygons`, `_largestPoly`, `_pointInPolysEO`, `pointInPolygon`,
  `_segCrossArt`, `_aiSeatGeometry`, and the crossing enumeration from `_captionCrossings` /
  `plateSeamPath`.

## Testing

- **Node unit tests (pure geometry, no Illustrator):**
  - pick the two outermost crossings from a set (including a multi-crossing / wavy input),
  - select the correct art arc (major, not-under-caption) and caption arc (outside-art),
  - splice the two arcs into one closed loop in the correct order and orientation.
  Inputs: a touch case (2 crossings at the endpoints), a deep-overlap case (2 crossings inside
  the inner edge), and a wavy case (several crossings → 2 outermost chosen).
- **Live validation (Illustrator; build-export + normalise fixtures):**
  - all 28 captions **join** (0 detached via the join-scan) — Tatra included — with
    `captionSeatOverlapMm` still 0,
  - default tabs and stamps still build; pipeline reaches "done", 0 failed,
  - the half-cut still lands on the cut line (halfcut-alignment regression green),
  - nesting classification (`step7a` regular/irregular counts) unchanged,
  - spot-check that 2–3 deep-overlap cutlines are visually the same shape as the boolean produced,
  - regenerate the affected goldens (build-export, normalise, and any other seat/cut goldens that
    shift), confirming diffs are the expected construction changes only.

## Out of scope

- Any change to the seat itself (`seatPlateToOutline`) — it already places endpoints correctly.
- Stamps (bare traced paths, no plate) — they never call `deriveCutline`.
- The half-cut seam algorithm — it reads the resulting cutline and is only re-validated, not changed.

## Open questions (resolve during planning)

1. **Failure signaling from `deriveCutline`.** Today it returns a shape unconditionally. The new
   degenerate-case failure needs a representation callers can detect. Options: return `null` and
   have each caller treat `null` as a failed build, or throw and let the existing per-phase
   try/catch surface it. **Leaning:** throw a descriptive error; `buildCaption`/`buildDefaultTab`
   wrap the call to un-nest and return `{ok:false}` (exactly as they already do for a failed
   seat), and `reuniteCutline` lets it propagate to the pipeline's per-phase catch. Confirm and
   apply consistently at all three call sites during planning.
2. **Bezier split robustness.** If de Casteljau splitting at the junction proves fragile in
   ExtendScript for some segment types, the bounded fallback is to sample only the two junction
   segments to short polylines while keeping all other segments as beziers — decided at
   implementation time against live output, not up front.
