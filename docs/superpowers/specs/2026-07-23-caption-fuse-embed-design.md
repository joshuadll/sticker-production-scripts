# Caption Fuse-Embed (targeted join rescue) — Design

**Date:** 2026-07-23
**Status:** Design — approved in brainstorm, pending spec review.
**Author:** Joshua + Claude
**Branch:** `feature/caption-fuse-embed` (blob-removal work rebased onto `main`).

## Problem

The caption seat lands both inner-edge endpoints exactly on the art edge at **zero embed**
(two-point contact — `captionSeatOverlapMm = 0`, deliberately, to remove the old 0.1 mm junction
bump; commit `6a3f0f4`). For most elements the art edge curves toward the caption between those
two points, giving real overlap, so the boolean `deriveCutline` fuses art + caption into one
contour. But where the base is flat/concave, the two points touch with **no overlapping area**,
and the boolean leaves the caption as a **separate piece** — the cutline is two disconnected
shapes, and the peel-tab can't work.

Measured on the Slovakia fixture (boolean, zero embed): exactly **1 of 28** fails to fuse —
**Tatra chamois**. Tram and the other 26 fuse fine (Tram's shallow seat still overlaps; its
compound outline with an interior hole is preserved by Pathfinder). Tatra's measured gap between
its caption inner edge and the art is ~0.05 mm.

Rejected alternatives (this session):
- **Uniform embed** (`captionSeatOverlapMm = 0.1`): re-introduces the exact 0.1 mm bump commit
  `6a3f0f4` just removed, on all 28. No.
- **Stitched cutline** (trace the union by hand instead of the boolean): built and abandoned — it
  needed a tangent-touch fallback, an arc-selection tie-break, and it silently dropped compound
  outline holes (Tram). The boolean's virtue is that Pathfinder handles all topology (holes,
  overlaps, multi-crossings) for free.

## Approach

Keep the proven boolean `deriveCutline` untouched. Wrap the two sites that unite a caption with a
**targeted rescue**: unite; if the caption fused, done (zero movement, zero bump); if it did not
fuse, nudge the caption assembly a tiny step toward the art and re-unite, iterating until it
fuses. Only a caption that actually fails to fuse ever moves, and only by the minimum. The seat is
untouched, so the zero-bump two-point-contact behavior is preserved for every caption that
doesn't need rescuing.

### Shared helper

```
fuseCaptionCutline(outline, plate, moveItems, strokePt) -> { cut, embeddedMm, ok, reason }
```

1. `cut = deriveCutline(outline, plate)`; stroke it.
2. If the caption fused (Section "Detection") → return `{ cut, embeddedMm: 0, ok: true }`.
3. Else loop: translate every item in `moveItems` by `STEP` toward the art (direction from
   `_aiSeatGeometry(plate, outline)` — `geom.sign` along the travel axis), `cut.remove()`,
   rebuild `cut = deriveCutline(outline, plate)`, re-check. Stop when fused.
4. If total embed reaches `CAP` without fusing → `{ ok: false, reason: "caption won't fuse" }`
   (hard error, caller surfaces it — same rule as the existing unseated-caption error).

`moveItems` is supplied by each caller so the printed caption follows the pill:
- **`buildCaption`** (birth): the pill, the text frame, and the plate raster (if present).
- **`reuniteCutline`** (normalise / manual-nest loop): the group's `plate`, `caption-text`, and
  `caption plate` (raster) members — so a caption that detaches after the artist resizes is
  re-fused, not just at birth.

Both call sites currently call `deriveCutline` directly; they switch to `fuseCaptionCutline`.
`deriveCutline` itself is unchanged (still the boolean, still runs the blob-removal already on
this branch).

### Detection — "the caption didn't fuse"

The union result is one item holding ≥1 closed leaf. The caption is **detached** iff some leaf
**is the pill**: bbox-centroid within **10 pt** of the plate's centroid AND area ratio in
**0.75–1.25** of the plate's bbox area. These are the exact tolerances the join-scan used this
session (`/tmp/join-scan.jsx`). A single
contour, or extra leaves that are genuine art holes (Tram), are **not** flagged (they don't match
the plate's centroid+area). Pure geometry over leaf metrics (`boundsCenter` + bbox area + leaf
enumeration) — no new primitives.

### Parameters and errors

- **`STEP` = 0.02 mm** per iteration. 0.05 mm is not a floor — Illustrator is floating-point; a
  finer step overshoots the true minimum less. The real floor is how thin an overlap Pathfinder
  will fuse, discovered empirically at validation (Tatra may end up under 0.05 mm).
- **`CAP` = 0.3 mm** total (~15 steps) — comfortably above Tatra's ~0.05 mm need; a normal element
  fuses well within it. Reaching the cap = a genuinely unseatable caption → hard error.
- **`captionSeatOverlapMm` stays 0.** The seat is not modified; this is a post-seat rescue. The
  bump fix (`6a3f0f4`) is preserved for every non-rescued caption.
- Re-unite cost: ~1 element × a few steps × one `deriveCutline` each = a couple of seconds. Fine.
- STEP/CAP are CONFIG knobs (e.g. `captionFuseStepMm`, `captionFuseCapMm`) with the defaults
  above, in the pipelines that build/normalise captions (`AI_BuildAndExportCutlines`,
  `AI_NormaliseCaptions`, `AI_BuildCutlines`).

## Scope of change

- **New** `fuseCaptionCutline` + a detached-caption detector helper in `utils/aiUtils.jsx`.
- **`buildCaption`**: replace its `deriveCutline(outline, pill)` call with `fuseCaptionCutline`,
  passing the pill + text + raster; on `ok:false` un-nest and return `{ ok:false }` (as it already
  does for a failed seat).
- **`reuniteCutline`**: replace its `deriveCutline` call with `fuseCaptionCutline`, passing the
  group's caption members; propagate `ok:false`.
- **CONFIG:** add `captionFuseStepMm` (0.02) + `captionFuseCapMm` (0.3) to the three AI pipelines.
- **Unchanged:** `deriveCutline` (boolean + blob-removal), the seat, `captionSeatOverlapMm=0`,
  tabs (a tab is not a caption; `fuseCaptionCutline` is used only on the caption path — the tab
  path keeps calling `deriveCutline` directly).

## Testing

- **Node unit test (pure):** the detached-caption detector — given fused-cut leaf metrics
  `[{c,area}]` and the plate metrics `{c,area}`, it flags a plate-matching leaf as detached, and
  passes both a single contour and a real-hole leaf (a large non-matching leaf) as fused.
- **Live (Illustrator; build-export + normalise fixtures):**
  - build-export → join-scan reports **0 detached** (Tatra fuses); the other 27 log
    `embeddedMm=0`; a log line reports Tatra's actual embed (the empirical minimum);
  - classification (`step7a` counts) unchanged; Tram's hole preserved; pipeline reaches "done",
    0 failed;
  - normalise stays idempotent (re-running does not keep nudging a caption already fused);
  - regenerate the affected goldens.

## Out of scope

- The junction blob removal (already on this branch, validated separately).
- Any seat change; any embed for captions that already fuse.
- The default peel-tab path.
