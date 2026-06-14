# Caption-Junction Cut-line Quality — diagnosis + fix

> **Status: FIXED (2026-06-14).** Implemented as `cleanCaptionJunction()` in
> `utils/aiUtils.jsx`, wired into Step 6 (`_buildSeparableCutline`) and `reuniteCutline`
> (Step 8b), gated by `CONFIG.weldFilletRadiusPt` (set to `2.0` = ON in AI_BuildCutlines and
> AI_NormaliseCaptions). Validated in-app on the clean fixture: all 22 caption junctions now
> render smooth (densely-sampled curve turn ≤ 37°, was 115–179°), the 6 caption-junction
> slivers are gone, it's idempotent under the re-Unite, and the half-cut stays attached.
> The diagnosis below is retained for context; the **Implementation** section at the bottom
> records what shipped.

## Symptom (what the artist sees)

At the seam where a caption pill meets the element art, the fused cut line shows one of two
things depending on how sharp the local weld is:

- a **thin "open break"** in the inner edge (a near-180° spike renders as a hairline that
  looks like the outline doesn't close), or
- a **sharp "horn"/spike** poking off the junction.

They are the **same defect** at different sharpness. The artist's words: *"some elements have
gaps in the middle of the inner edge"* and *"I can still see some elements have horns."*

This is **cosmetic-to-mild**, not a mis-cut: every cut line is still one connected contour
(nesting is fine), the half-cut still lands on it, and stickers still cut/peel. But the
junction is not clean and the artist wants it soft and spike-free.

## Root cause

The cut line is `Unite(element_outline, caption_plate)` via Live Pathfinder Add in
`deriveCutline()` (`utils/aiUtils.jsx`, ~line 469). The element outline (a traced silhouette
*incl.* the white-edge band) and the plate (capsule/pill) overlap **shallowly** at the seam —
the pill's edge runs nearly **parallel** to the art's edge there. Pathfinder's boolean union
produces a **degenerate self-intersection sliver** at such a near-**tangential graze**. That
sliver is the spike/break.

This is a known-finicky Pathfinder failure mode — it is **not** a simple missing-overlap gap,
and it is **not** fixable by painting white in Photoshop (every raster fill tried in the
session produced a new spike at the fill boundary — see "What does NOT work").

### Evidence (measured on the clean cut lines, this fixture)

Junction-band path anchors (turn angle = how sharply the path bends at a vertex):

| Element | Junction vertices | Reads as |
|---|---|---|
| Michael's Gate | two **near-180° reversals** (178°, 171°), ~17px out-and-back | "open break" |
| Bojnice Castle | ~155°, ~158° corners | mild horn |
| Kraslice | ~83–144° corners | horn |

Degenerate sliver sub-paths on the union result (tiny enclosed area in pt²), **7 of 22**
captioned elements: Tram 188, Michael's 33, St Elizabeth 19, Carpathian 18, Tatra 1,
Čumil 0, Kroje 0. (`_cutline_inspect` / `_notes_slivers` checks.) These slivers are the
junction artifact; they are uncorrelated with the seat-review flag.

## What does NOT work (ruled out by adversarial review — don't repeat these)

1. **Raster white-fill in Photoshop (Step 3B `_whiteBridge`).** Closing the gap by growing
   the art's white edge in pixels works at the silhouette level, but the cut line is *traced*
   from those pixels, so **wherever the fill stops becomes a new sharp feature** in the trace.
   Three variants were tried live and all produced spikes/horns or reshaped the rounded ends:
   per-column comb fill, morphological close, and a surgical flat-inner-edge 1px lap. The 1px
   lap closed Michael's break but created a fresh spike on Kraslice (confirmed before/after).
   **Conclusion: do not fix this in raster.** It belongs in vector, on the cut line itself.

2. **"Extrude the plate's inner edge into the art" before the union.** Rejected: moving the
   capsule's inner-arc vertices **warps the rounded ends** (inner+outer vertices share the
   same end arc) — the exact thing the artist said to leave alone — and a near-tangential
   graze can still survive, and making the operand locally non-convex can *create* a new
   sliver.

3. **"Delete the single spike anchor" post-union.** Rejected: the junction is a **multi-anchor
   cluster**, not one out-and-back poke. Deleting the worst vertex just **promotes its
   neighbour** to the new spike (Michael's 178° → 167°; Bojnice → 134°). Single-pass
   classify-then-delete never re-evaluates, so the break survives; and repeated application
   erodes the pill cap anchor-by-anchor (not idempotent).

## Recommended fix (vector, at the cut line)

A **localized junction rebuild** — replace each junction corner's spike *cluster* with a
clean fillet arc. Concretely:

1. **Locate the seam from the caption spine, not the bbox.** Use the sidecar `spine` +
   `radius` (WC capsule) / the plate geometry (GC pill) to find the two seam endpoints (the
   `bite` points are a starting hint but unreliable as a nearest-anchor target). The plate's
   *axis-aligned* `geometricBounds` is **wrong for tilted WC capsules** — use the real spine.

2. **Per junction corner, bracket the whole spike cluster.** Walk the cut-line path outward
   from the pill into the art on each side; find the last clean anchor on the pill edge and
   the first clean anchor on the art edge (turn below threshold), and treat everything between
   them as the cluster.

3. **Splice in a clean fillet arc** between those two clean points, tangent to both incoming
   directions. Use the correct circular-arc cubic-bezier handle length: for a corner turning
   by exterior angle θ, handle ≈ **(4/3)·tan(θ/4)·R** (the standard κ; the session's first
   attempt used `(π−θ)/4`, which over-bulges gentle horns and under-rounds sharp ones).
   `R` = a small fillet radius (artist wants *soft*; ~1–2 pt was the ballpark, tune in-app).

4. **Idempotent / re-runnable.** Only act where a sharp corner/sliver actually exists; a clean
   junction is a no-op. This must survive Step 8b's `reuniteCutline` (which re-derives the cut
   line, so the cleanup is re-applied each time) and converge, not drift.

5. **Keep one closed contour** (nesting requires it) and **don't move the seam** so far the
   half-cut (`syncHalfcut`, re-derived from the plate seam) no longer meets the cut line.

6. Works for **both** the WC curved/tilted capsule (`buildCapsuleFromSpine`) and the GC
   axis-aligned pill (`buildPlate`).

A complementary option worth a look: pre-clean the degenerate slivers with a tiny vector
offset round-trip (Offset Path −d then +d with round joins) on the union result — but that
rounds the *whole* outline, so it must be confined to the junction band.

## Where it lives in code

- `utils/aiUtils.jsx`
  - `deriveCutline(outline, plate)` ~469 — the Live Pathfinder Add that creates the slivers.
  - `filletJunctionCorners()` / `_softenNearestCorner()` / `_softenAnchor()` /
    `_nearestAnchor()` / `_towardHandle()` ~1011–1080 — the **existing** (insufficient) hook.
    It rounds the bite-nearest anchor only; in validation it fired on only 9/22 (bite-nearest
    isn't always the sharp vertex), the default radius (0.35pt) was invisible, and rounding a
    near-180° reversal doesn't remove a cluster spike. Replace/extend with the cluster-removal
    + arc-splice above. `_turnAngle()` ~590.
  - `reuniteCutline()` ~551 — re-derives the cut line (Step 8b); the cleanup must run here too.
- `illustrator/Step6_CreateCutlines.jsx` ~360–386 — build plate → `deriveCutline` →
  `filletJunctionCorners` (gated by `CONFIG.weldFilletRadiusPt`, currently `null`/off).

## How to develop + test fast (no 12-min re-run)

The clean cut lines are built in a throwaway `/tmp/...fixture.ai`. Iterate by applying the
cleanup directly to the open doc and rendering before/after, then re-run the clean rebuild to
reset between attempts:

- Clean rebuild driver: `/tmp/run-clean-rebuild.sh` (Phase 1 → Phase 2 → reopen clean).
- Junction render helpers used in the session: `/tmp/render-sheet.jsx` + `/tmp/dump-coords.jsx`
  (render the Cutlines+Halfcut sheet, half-cut recoloured red, with the abL/abT/scale needed to
  PIL-crop any element), and `/tmp/inspect-junction-anchors.jsx` (dump junction-band anchors +
  turn angles). Validation crops live in `~/Desktop/caption-validation/`.
- The adversarial design proposals + critiques from the session are in `/tmp/junction_design/`
  (ephemeral — the key conclusions are captured above).

## Acceptance

For each captioned element: no near-180° reversal and no sub-90° spike at the junction; a
soft rounded transition where pill meets art; the rounded END POINTS of the pill unchanged;
one closed contour; half-cut endpoints still on the cut line; idempotent under re-Unite.

## Implementation (what shipped, 2026-06-14)

`cleanCaptionJunction(cutline, plate, outline, opts)` in `utils/aiUtils.jsx`. Per element,
after `deriveCutline`:

1. **Locate junctions from the real geometry.** `_captionCrossings` returns *every*
   plate∩art boundary crossing (each inside↔outside transition on the sampled pill polygon),
   not the axis-aligned bbox and not `plateSeamPath`'s single longest run — so it handles the
   tilted WC capsule, the GC pill, and partial/multi-island overlap (Michael's Gate has 4).
   Near-duplicate crossings are merged.

2. **Remove degenerate slivers.** `_removeJunctionSlivers` drops a non-largest cut-line
   sub-path that is tiny (bbox area < 400 pt²) *and* sits entirely within 30 pt of the
   crossings — the union's self-intersection sliver. A real hole, or a trace sliver elsewhere
   in the art (e.g. Tram's area-188 blob at mid-element), is left alone.

3. **Collapse zero-length folds.** `_collapseDuplicateAnchors` (tol 0.8 pt, well under the
   ~2 px pill-cap step) removes duplicate consecutive anchors the Unite leaves at some
   junctions — their noise-angle turns would otherwise survive the fillet (this is what was
   leaving Kroje at 96°).

4. **Fillet each junction.** `_filletAtCrossing` finds the spike apex (sharpest CORNER anchor
   nearest the crossing), then *brackets the whole cluster* — iteratively expanding each
   bracket while the bracket anchor is itself a reversal relative to the straight bridge, so
   it absorbs the near-tangential RETURN anchor instead of promoting it to a new spike (the
   failure mode of single-anchor deletion). It removes the in-between anchors and rebuilds the
   span as a smooth circular-arc cubic tangent to both clean edges (κ handle =
   `(4/3)·tan(θ/4)·R`, R implied by the bracket chord + turn). The handle is capped at
   0.42·chord so it can't dip the bridge.

5. **Idempotency.** A fresh Unite's spike is a CORNER anchor → fires. The fillet leaves SMOOTH
   bracket anchors → the re-trigger guard (sharpest CORNER within 8 pt of the crossing) finds
   nothing → re-running is a no-op. Step 8b's `reuniteCutline` re-derives the spike and
   re-cleans, converging. Verified: pass 2 = 0 fillets / 0 slivers.

6. **Half-cut attachment.** Smoothing the spike pulls the contour off the old plate∩art
   crossing the half-cut used to meet. `syncHalfcut` now builds the seam with raw ends and
   `_extendHalfcutEndsToCutline` re-projects each end onto the cleaned cut line — march the
   seam tangent to the nearest cut-line crossing (fallback: nearest outward cut-line point,
   for the mid-pill partial-seam case), then **+1 mm along the ART outline tangent** (the body
   cut, not the caption). Fixture half-cut endpoint gaps are now ≤ 2.9 pt (= the 1 mm
   overshoot), down from up to 14 pt.

**Tuning knobs** (`opts`, with defaults): `junctionSharpDeg` 50, `cornerCleanDeg` 35,
`maxSeedDistPt` 8, `reversalDeg` 95, `maxAbsorbEach` 8, `handleScale` 1.0 (softness),
`sliverMaxAreaPt2` 400, `sliverBandPt` 30, `dupTolPt` 0.8. `CONFIG.weldFilletRadiusPt` is the
on/off gate (any +value = ON); the fillet auto-sizes to each cluster, so the value is not a
literal radius — tune softness via `handleScale`.

**Known residual:** the partial-seam elements (St Elizabeth, Carpathian, etc.) get a clean
*cut line* but a trapezoidal half-cut (the seam is `plateSeamPath`'s mid-pill longest run,
extended to the contour) rather than a shoulder-to-shoulder run. It connects and peels; a
fuller fix would widen `plateSeamPath` to span the outermost crossings (separate follow-up).
