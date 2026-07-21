# Caption seat — two-point contact redesign — design

**Date:** 2026-07-21
**Branch:** `fix/caption-seat-two-point-contact` (proposed)
**Status:** design — not yet implemented.

## Goal

Replace the caption-pill seating algorithm in `seatPlateToOutline` (`utils/aiUtils.jsx`) so that
the **two ends of the pill's inner (art-facing) edge land exactly on the traced art border**, with
no residual float or over-burial. This removes the visible "bump / step" at each end of the
caption↔art junction (most obvious on flat-bottomed bases like *Mount Otemanu*), where today the
fused cutline turns sharply because the pill only grazes the border a hair below the endpoint.

The end state the artist wants: **the caption top-edge endpoints are tangent to (sitting on) the
art border edge.**

## Scope

- **In scope:** the CAPTION (pill) branch of `seatPlateToOutline` — the `else` block at
  `aiUtils.jsx:1672`. This is the branch taken by `buildCaption` (Pipeline 2 birth, Step 6) and
  `reuniteCutline`/Step 8b (`AI_NormaliseCaptions`).
- **Out of scope:** the TAB branch (`opts.innerEndpoints`, `aiUtils.jsx:1653`) used by
  `buildDefaultTab` — untouched. The pill *shape* builder (`buildCaptionPill`), the auto-warp, the
  half-cut (`syncHalfcut`), and the Unite (`deriveCutline`) are all untouched.
- **Middle of the edge stays unmanaged** (decision #4) — same as today. Only the two endpoints are
  guaranteed on the border.

## Background — how seating runs today

Current caption-branch order (`seatPlateToOutline`, `aiUtils.jsx:1672`–1776):

1. `_aiSeatGeometry` picks a **global travel axis** (X or Y) and sign from bbox-center delta
   (`aiUtils.jsx:1857`).
2. `_innerEdgeVerts` extracts the pill's art-facing inner edge; endpoints `E0`, `E1` are its two
   ends (`aiUtils.jsx:1677`–1689).
3. `_probeOutline` casts an **axis-parallel** ray from each endpoint and returns the nearest border
   point `B0`, `B1` (`aiUtils.jsx:1690`–1691, `1885`).
4. Overhang rescue: if a probe misses, inset both ends by `seatShrinkFrac=15%` once, else flag
   (`aiUtils.jsx:1696`–1708).
5. Convex-bulge guard: midpoint protrusion vs `captionMidProtrudeFrac·2r`; shrink once or flag
   (`aiUtils.jsx:1715`–1735).
6. **ROTATE** the whole pill about pivot `E0` by `chordAngle(B0,B1) − chordAngle(E0,E1)`
   (`aiUtils.jsx:1740`–1755).
7. **KISS** — translate along the travel axis so `E0` lands on `B0`, submerged by
   `depth = seatOverlapMm = 0.1mm` (`aiUtils.jsx:1757`–1762, `1911`).

### Root flaw

Rotation and depth are **computed independently, then composed, and composing invalidates the
inputs**:

- The kiss lands **only the pivot `E0`** at exactly depth `d`. `E1` is carried by the same rigid
  translation and lands at depth `d` **only if the border segment `B0→B1` is straight** — rotation
  guarantees the *chords* are parallel, not that the edge matches the real border between them.
- The probes `B0`/`B1` are cast **before** the rotation, along the fixed global axis. Rotation
  reorients the edge, so the border point `E1` actually meets is no longer the pre-rotation `B1`.

Result on non-flat / tilted bases: the far endpoint lands off — sometimes short (doesn't cross →
detached), sometimes buried too deep. Deepening `seatOverlapMm` only trades a shallow sharp bump
for a deeper one; it never makes the endpoints sit *on* the border.

## Decisions (from brainstorming)

| Question | Decision |
| --- | --- |
| Target depth of the two endpoints | **Contact — depth 0.** Both endpoints sit exactly on the border, no embed. (#1) |
| Keep overhang / 15% shrink handling? | **Yes, unchanged.** It carries over; the far-point "circle can't reach the border" case routes to the same shrink-or-flag. (#2) |
| Translation direction (step 1) | **Global travel axis, like today.** (#3) |
| Manage the middle of the edge? | **No, like today.** Only the two endpoints are pinned. (#4) |
| `seatOverlapMm` | **Kept as a knob, default 0.** Algorithm does true contact; if live validation on a concave base shows the Unite pinching, a hair of embed is a 1-line dial with no geometry change. |

## New algorithm — two-point contact

Replace steps 6–7 (rotate-then-kiss) with a **translate-to-first-contact, then rotate-about-pivot
until second-contact** construction. Steps 1–5 (geometry, inner edge, endpoints, overhang shrink,
bulge guard) are **kept as-is** — they still produce `E0`, `E1` and their border probes `B0`, `B1`.

```
   1) TRANSLATE the whole pill along the travel axis until the NEARER
      endpoint (P) sits exactly on the border.        P●──────Q   (Q still off the border)
                                                      ╱border╲
   2) ROTATE about P (now on the border) until the    P●
      FAR endpoint (Q) also lands on the border.        ╲    ╱
                                                         ●Q ← swings down its circle
```

### Step A — pick the near endpoint and translate it to contact (depth 0)

- Using the existing axis-parallel probes: the **nearer** endpoint is the one with the smaller
  signed gap to its border point along the travel axis. Call it `P` (its border point `Bp`), the
  other `Q` (border point `Bq`).
- Translate the whole rigid pill (pill + ride items) **along the travel axis** so `P` lands exactly
  on `Bp` — i.e. `_aiKissVector(P, Bp, geom, depth=0)`. No embed.
- After this, `P` is on the border; `Q` is generally off it (short or past).

### Step B — rotate about `P` until `Q` lands on the border (exact solve)

`Q` is rigidly tied to `P` at distance `L = |P − Q|`. It must end **on the border** while staying
at distance `L` from the (now fixed, on-border) pivot `P`. So:

- **Target = intersection of {circle of radius `L` centered at `P`} ∩ {border polygon}.**
- Compute all circle∩segment intersections against the sampled art border polygons
  (`artPolys`). This is a new pure-geometry helper (`_circlePolyIntersections(P, L, artPolys)`).
- **Rotation angle** = signed angle from the current `Q` (relative to `P`) to the chosen target
  (relative to `P`). Rotate pill + ride items about `P` by that angle (`_rotateItemsAbout`).

Because the rotation is *defined* to land `Q` on the border, there is no separate kiss distance for
it to invalidate. Both endpoints end exactly on the border.

### Solution selection & degenerate cases (reuse existing dispositions)

- **0 intersections** — the circle never reaches the border (chord `L` longer than the reachable
  border span, or `Q` fully outside). This is the **overhang** case → run the existing 15% shrink
  (decision #2) which shortens the inner edge (smaller `L`, endpoints pulled inward) and retry the
  whole seat once. Still 0 → `return { ok:false, needsReview:true, reason:"caption wider than art" }`
  (same contract as today, `aiUtils.jsx:1704`).
- **2 intersections** — pick the one giving the **smaller absolute rotation** (least disturbance to
  the pre-warped pose). Clamp to `maxSeatRotationDeg=75°`; if the smaller solution still exceeds it,
  flag `needsReview` and skip the rotation (mirror `aiUtils.jsx:1749`–1752).
- **≥3 intersections** (border re-enters the circle on a wavy base) — pick the smallest-rotation
  candidate as above; the wavy-base residual is caught by the existing bulge/`needsReview` flag.

### What is removed / changed

- **Removed:** the pre-rotation chord-alignment (`_aiChordAngleDeg(B0,B1) − _aiChordAngleDeg(E0,E1)`
  block) and the single-endpoint kiss-at-depth. These are the coupled steps that caused the bug.
- **Kept:** `_aiSeatGeometry`, `_innerEdgeVerts`, `_probeOutline`, the overhang shrink, the
  convex-bulge `needsReview` guard, `_rotateItemsAbout`, `_translateItems`, `_aiKissVector` (now
  called with `depth=0` for the near-point contact).
- **New helper:** `_circlePolyIntersections(P, L, artPolys)` → array of `{x,y}` points where the
  circle meets the border. Pure geometry (circle vs each polygon segment; standard quadratic per
  segment, clamped to the segment parameter `t∈[0,1]`).
- `seatPlateToOutline` return contract is **unchanged**: `{ ok, moved, rotDeg, needsReview,
  reason }`. `rotDeg` is now the Step-B rotation; `moved` is the Step-A translation magnitude.

## Why this solves the bump

- **Flat base (Mount Otemanu):** near endpoint on border, `L`-circle meets the flat border at the
  far endpoint with ~0 rotation → the whole straight top edge lies coincident on the border →
  Unite fuses with no protruding corner → **bump gone**.
- **Tilted/curved base:** both endpoints land exactly on the border (not "chord-parallel then hope")
  → the sharp near-vertical junction turn is replaced by the edge meeting the border at its actual
  crossing → junction reads clean at both ends.

## Idempotency & convergence

- Step 8b (`reuniteCutline` → re-seat) must converge like today. Once both endpoints are on the
  border, Step A translates by ~0 (near point already on border) and Step B's circle∩border target
  is the current `Q` → ~0 rotation. So an already-seated caption re-seats with negligible movement,
  matching the current fixed-point behavior (`aiUtils.jsx:1607`–1615).
- The `polyCache` for the outline sample is reused unchanged.

## Risks / validation

- **Depth-0 Unite fusion on a concave base:** endpoints touch at 2 points with a mid gap; Pathfinder
  Add can pinch. Mitigation: `seatOverlapMm` knob (default 0) — nudge to e.g. `0.1` if a concave
  fixture pinches. **Must be validated live in Illustrator** (per project practice) on: a flat base,
  a curved/round base, and a tilted base.
- **`_circlePolyIntersections` numerics:** border sampled at `seatSampleSteps=24`; a near-tangent
  circle can miss/double-count. Use a small epsilon on the discriminant and dedupe near-coincident
  hits.
- Half-cut (`syncHalfcut`) is derived downstream from the seated pose; re-run its integration test
  after the seat change to confirm endpoints still project onto the cut line.

## Testing

- **Unit (pure geometry):** `_circlePolyIntersections` — 0/1/2/≥3-hit cases against a square and a
  convex arc polygon; hand-checkable coordinates.
- **Unit (seat outcome):** given a synthetic flat outline polygon + a pill, assert both endpoints
  land within epsilon of the border after `seatPlateToOutline`; assert a tilted outline lands both
  endpoints on the border (the case that fails today).
- **Integration:** the existing `ai-build-and-export-cutlines` and `ai-normalise-captions` runners
  (log-goldens); regenerate goldens after live validation, reviewing each diff.
- **Live (authoritative):** run Pipeline 2 in Illustrator on a fixture with flat + curved + tilted
  bases; eyeball the junctions at high zoom; confirm no bump on the flat base and both endpoints on
  the border on the tilted base.

## Open items to confirm before/at implementation

- Confirm the flat-base depth-0 Unite fuses cleanly in-app (the core assumption).
- Decide whether Step-A translation being axis-aligned (decision #3) leaves the near endpoint
  *visibly* off a steeply tilted border enough to matter; if so, revisit "translate along border
  normal" as a follow-up (explicitly deferred now).
