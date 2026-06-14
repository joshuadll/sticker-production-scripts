# Caption Seating Redesign — design notes (Photoshop / Step3B)

> Working notes for replacing the current `seatCaptionConform` seating math
> (`photoshop/Step3B_CaptionWhite.jsx`). Captured durably because the remote
> container is ephemeral. This is REMOTE-lane work: design + new files +
> Step3B *helper bodies*. CONFIG values, `seatRotationSign` tuning, and golden
> regen stay on the LOCAL branch (Photoshop-validated). See
> "Branch / merge discipline" at the bottom.

## Why redesign

The current seater (`seatCaptionConform` = conform-rotate → kiss-translate) decides
everything from **9 raster columns** (`_edgeProfile`) sampled across a **bounding-box
band**, then fits a single **PCA** line and does a **worst-strip** translate. Problems:

- The band `[lo,hi]` is `max(art.left,pill.left) … min(art.right,pill.right)` — a
  *bounding-box* interval, evaluated against *ink*, so usable columns < 9 and are
  wasted at the ends (the pill's round caps and the art's taper hold no ink there).
- It **re-discovers the pill edge by sampling** when the pill is built from exact
  geometry we already have (`spine` + `radius`).
- **Worst-strip kiss** drives the *least*-overlapping column to the target overlap,
  so any overhang (see below) buries the pill's middle deep into the art.
- PCA confidently returns a tilt even for curved / 3-point / noisy edges.

## The pill is a capsule (four areas)

`_capsulePolygon` (WC) and `createPillFromRect` (GC) both build a **stadium/capsule =
a centerline (`spine`) swept by a disk of radius `r`**. Four areas:

1. **inner edge** — long side facing the art
2. **outer edge** — long side away from the art
3. **+** two **end caps** — semicircles of radius `r` at the spine endpoints

Cap centers = the spine endpoints (`_appendCap` is called around `spine[0]` and
`spine[n-1]`).

## Step 1 — inner edge is fully ANALYTIC (no sampling)

Inner edge = spine offset by the radius toward the art:

```
innerEdge[i] = spine[i] + s · r · normal[i]
```

- `normal[i]` = unit normal at spine point i (same `nx,ny` the builder uses)
- `s = ±1` chosen so the offset points toward the art (the `sign` from `_seatGeometry`)
- WC: `spine` is the (possibly quad-fit) polyline → inner edge is a **curve**
- GC: straight stadium; inner edge is the flat top segment `y = y1`, `x ∈ [x1+r, x2−r]`

Represent it as the **full polyline** (preserve curvature), not a collapsed line.

## Step 2 — inner-edge ENDPOINTS are exact

The endpoints = each **cap center pushed `r` toward the art** (junction where the
inner edge meets a cap):

- WC: `spine[0] + s·r·n[0]` and `spine[n-1] + s·r·n[n-1]`  (= `top[0]`, `top[n-1]`)
- GC: `(x1+r, y1)` and `(x2−r, y1)`

NOTE: these are the pill's GEOMETRIC inner-edge endpoints, NOT the contact/seam points
with the art (those need the art; `_computeBite` currently approximates them).

## Step 3 — project endpoints onto the art border (PROBE, targeted)

The art border (`refLayer` = `White Base_Cutline`) is raster, so we probe — but only
**two precise probes**, not a 9-column average:

- For each endpoint, cast a ray **toward the art** and take the first art-ink edge.
- Vertical travel (pill below art, normal case): scan a **1px-wide column** at
  `endpoint.x` of the art's transparency; take the facing extreme (art bottom at that x).
- Horizontal travel: a 1px-wide row at `endpoint.y`.

The line through the two border points = the art's **local tangent at exactly the
pill's span** — a better tilt reference than bbox-band PCA.

### Ray direction
Edge normal == global travel axis **only** for a flat, un-rotated, straight pill.
Curved (WC) or tilted (post-conform) edges have per-point normals off the global axis.
Global axis = OK first approximation for a fresh flat caption; the honest ray is the
**local inner-edge normal**.

## Step 4 — OVERHANG edge case (DECIDED)

**Overhang** = a stretch of the inner edge with NO art border above it (ray toward the
art hits nothing). Happens when the inner edge is wider than the art's contact zone
(long caption under small/tapered art). Overhang is NORMAL — a caption sticking out
past a narrow element is fine. The bug is the worst-strip kiss treating overhang as a
gap to close, ramming the pill up until the overhang "reaches" absent art → buries the
real contact.

**Principle: seat against the real-contact ("live") span only; let overhangs float.**
Both the tilt and the kiss depth come ONLY from inner-edge points that have art border
above them. Overhang points contribute nothing.

Sub-cases:
- **A** ends overhang, middle lands (narrow centered art) → live span = middle.
- **B** one end overhangs → live span = from the landing region to the other end.
- **C** fully overhang — NO art border anywhere under the inner edge → **SKIP the seat
  + WARN** (`[step3B] WARN`). Leave the caption at its rough Step3A placement; do not
  force a seat. (Skip the *seat*, not the element — the element still groups/exports.)
  Local validation to confirm exact skip semantics.

Disjoint live spans (concave art with a mid-gap): use the union of all live points for
the fit and the kiss.

**PARKED (revisit later):** locating the live-span boundaries (overhang↔contact
transitions) is more involved than first thought — needs probing the inner edge at more
than the 2 endpoints (interval scan / bisection along the inner edge, distance cap `D`,
disjoint-span handling). Leading idea: extract the art-border facing-edge **profile** in
ONE PS pass (N probes along the inner edge, by spacing not fixed count), return
`[{c, edge}|null]`; then live span / tilt / kiss become PURE geometry (Node-testable).
Deferred — we first nail the NORMAL (no-overhang) path below.

## Step 5 — NORMAL path (no overhang): rotation from the two border points

Both inner-edge endpoints land on real border. Let:
- `E0, E1` = inner-edge endpoints (analytic; Step 2)
- `B0, B1` = their projections on the white border (probe; Step 3)

Then:
- **Border local tangent** = chord `B0 → B1`.
- **Inner-edge baseline** = chord `E0 → E1`.
- **Conform rotation** `φ` = signed angle from the inner-edge baseline to the border chord.
- Rotate the pill rigidly by `φ` about the **inner-edge midpoint** `M = (E0+E1)/2` (= the
  pill's horizontal center). **Pivot DECIDED = center**: a rotation leaves its pivot fixed,
  so `M` doesn't move → rotation is **lateral-neutral** (no sideways drift; the
  `φ·(P2−P1)` pivot term vanishes). It PRESERVES the existing center (Step 3A's job);
  it does not re-center. Parallelism is pivot-independent, so both endpoints still cross
  the border simultaneously on the kiss.

This REPLACES PCA-over-9-bbox-columns with a **2-point chord at the pill's actual
endpoints**: long, stable baseline, anchored to where the pill really is, no averaging,
no bbox band.

### The kiss (v1) — pin E0, rotate, translate onto B0  (REVISED — simplest)

```
θ = robust border angle (line fit over the live span — NOT 2 raw probe points)
φ = θ − angle(E0→E1)
rotate the pill by φ about E0                 // E0 is pivot AND target → stays put
translate (B0 − E0) + d  along the travel axis   // E0 → B0, submerged by depth d
```
Result: `E0` sits at depth `d` on its border point `B0`; the edge is parallel to `θ`;
`E1` lands on the border line at distance `W` from `B0` — i.e. BETWEEN `B0` and `B1`
(the edge is shorter than the chord: `W = |E0E1| < |B0B1| = √(W²+Δh²)`). Both endpoints
kiss; `E1` just falls short of `B1`, which is fine (any point on a straight border =
kissing).

WHY THIS IS CLEAN: `E0` is the pivot *and* the target, fixed at `B0` throughout → there's
nothing to re-project, no chicken-and-egg. Only `E1` is derived; we accept wherever it
lands on the border. `θ` comes from the fixed border (measured once), not re-derived.

PIVOT = E0 (revised from center M). Trade-off: a small SECOND-ORDER lateral drift
`≈ (W/2)(1−cos φ)` (~1px at typical tilts) — accepted for the simpler logic.

ANGLE stays robust: `θ` from a line fit over the live span, decoupled from the
pivot/translate. (2 raw points would let a groove at `B0/B1` tilt the whole caption.)

DEPTH `d` (the `+d` term) = overlap submersion. Set `d ≥ border sagitta over the span`
(+ small margin), so the always-present gentle curvature + pixel grooves are SWALLOWED by
the overlap (white-on-white, no gap, convex or concave). A straight pill can't hug a
curve, so we submerge instead. Upper bound: `d` can't push the border into the text (limited
by the pill's white padding) — sagitta beyond that = the "too deep to submerge" case that
needs the deferred profile-settle / arced pill. `d = max(captionBorderOverlapPx, s+margin)`.

### DECISIONS
- **v1 kiss = pin E0, rotate by `φ` about E0, translate `E0→B0 + d`** (see revised block
  above). Angle `θ` from a robust line fit over the live span (NOT 2 raw points). Depth
  `d` tied to sagitta so ubiquitous gentle curvature + grooves are submerged.
- **Curvature deferred** to a later phase via the **profile-settle** (extract the border
  facing-edge profile in ONE raster pass → settle the inner edge onto that polyline as
  PURE geometry → one physical transform). The flat chord is the degenerate case of this;
  the profile also subsumes the parked overhang/live-span work (overhang = missing
  profile samples). Node-testable.
- **Contact rule = PIN ENDPOINTS** (now and in the curve phase). Accept that on a real
  CONVEX border (rounded sticker bottom) pinned endpoints can leave a small **middle
  gap**; revisit only if validation shows it matters. (Alternative "natural support
  points" rejected.)

### v1 LIMITATION (accepted)
On a curved border the straight chord is an approximation: post-rotation real contact
lands at a different height than `B0/B1`, so the two endpoints won't kiss the *real*
curve perfectly. Fine for near-flat; the profile-settle is the fix when needed.

## Step 6 — overhang solution: SINGLE BALANCED SHRINK + ERROR (DECIDED)

GOAL: mask to the live span — seat where border exists, overhang floats.

METHOD (DECIDED — simplest, ONE attempt):
1. Try the full inner-edge endpoints `E0,E1` (normal v1 path).
2. If EITHER overhangs (its probe finds no border) → ONE balanced shrink: inset BOTH ends
   by **15% of the width** (→ a centered segment spanning 15%..85%, i.e. 70% width).
   Re-probe the two new endpoints.
3. Both now find border → run the **v1 kiss** on the 70% segment (pin one, rotate, translate
   + depth `d`); the pill's geometric ends just float past the contact.
4. Still no → **ERROR to the user** (caption too wide for the art); skip seating this caption.

ONE attempt only — no loop, no min-length/iteration knobs. Rationale: a caption much wider
than its art is a DESIGN problem, not something to silently rescue. Mild overhang (art ≥
~70% of caption width, ≤15%/side) is auto-corrected by the single nudge; anything wider
ERRORS for the operator to fix (resize caption or element).

BALANCED (both ends 15%): keeps the seat centered — consistent with Step 3A centering the
caption on the element.
ROBUST TO IRREGULAR ART: point probes at the two inset endpoints, never a bounding box.

SCOPE: rescues overhang ≤ ~15% per side only; beyond that = ERROR (by design).
ONE KNOB: shrink fraction = 15% (CONFIG; tune in validation).
TRADEOFF (accepted): the 70% segment is a fixed, slightly shorter angle baseline — fine.
REJECTED: multi-iteration shrink; endpoint-only (blind to interior); one-shot bounding-box
extent (fooled by irregular art); per-sample slice-trace (reserve for parked profile work).

## Open / UNRESOLVED edge cases

- **Short-baseline angle (RESOLVED — always rotate).** A short `E0→E1` baseline (very
  narrow caption, or the 70%-shrunk segment) makes the tilt noise-sensitive. DECISION:
  still rotate, NO seat-flat fallback — short captions are rare; accept the small risk.

- **Concave/convex border behavior under pin-endpoints (UNRESOLVED).** On a curved
  border, pinning the two endpoints leaves a CONCAVE middle gap (center bows toward art
  interior → overlap `d − s`; needs `d ≥ s`) or over-submerges a CONVEX middle (fine).
  The sagitta-submersion mitigation (`d ≥ s + margin`) is ASSUMED adequate but NOT
  validated, and it fails when `s` exceeds the submersion budget (border would reach the
  text). Couples to the deferred profile-settle. REVISIT.
- **WC arced caption (curved inner edge) — RESOLVED: no special case.** The WC arc is
  ARTIST-placed (Step 3A drops it straight; the artist warps it to follow the art before
  Step 3B), so it is already conformed to the art. DECISION: keep the unified chord-rotation
  (option 1). For a well-placed arc the chord runs ~parallel to the art → `φ` is naturally
  SMALL; the rigid transform PRESERVES the artist's curve and just seats it; overlap depth
  `d` submerges any residual curve-vs-border mismatch; `maxSeatRotationDeg` clamps outliers.
  No per-pill-type branching. (Curve-aware seat rejected as overkill.)
- **Live-span boundaries / disjoint spans (PARKED).** Finding where overhang starts/stops
  along the edge (vs just at the endpoints) — the profile-extraction work.
- **Degenerate/ambiguous travel direction.** Caption overlapping the art center, or
  contact wrapping an art corner (facing edge flips bottom→side).

## Additional edge cases (final sweep)

NEW — decided:
- **Near-zero baseline (circular / 1-char pill) — GUARD.** When the inner-edge length
  `|E0−E1|` is below an epsilon, the rotation angle is undefined → **skip rotation (θ=0),
  kiss only.** Distinct from the short-caption case (which still rotates); this is a true
  numerical degenerate.
- **Kiss is bidirectional — sets depth to EXACTLY `d`.** If Step 3A + rotation leaves the
  caption submerged deeper than `d`, the kiss translates **outward**; if short, inward.
  Signed translate. (Makes existing behaviour explicit.)
- **Artist pre-rotated the whole caption (a tilt, not an arc) — ACCEPT re-tilt.** The
  unified rotation re-tilts it to the border. Deliberate straight-caption tilts are rare;
  noted that it could fight artist intent (same risk family as WC, which we trust). Not
  special-cased.

ALREADY COVERED (recorded for completeness):
- Missing white border (WBC) → fall back to the SO art as the reference (existing code).
- Caption above / beside the art → travel axis is direction-agnostic (the `sign` logic).
- Notch in the middle of the contact → naturally bridged (only endpoints are pinned).
- Donut / hole in the art column → the probe takes nearest ink = the true facing edge.
- Multi-line caption → straight pill; inner edge = top of the stacked block.

MINOR / accept:
- Post-transform overhang (a large rotation nudges an endpoint off the art after we've
  already probed) → mitigated by `maxSeatRotationDeg`; we do not re-probe.
- Idempotency: re-seating an already-seated caption should converge (near-zero
  adjustment), not drift — verify in validation, not a design change.

## Data threading needed

`seatCaptionConform` currently receives `spine` only.

- Forward **`radius`** (WC) — exists as `whiteInfo.radius`, just not passed.
- Forward the **rect/stadium params** (GC) — `spine` is `null` on the plate path today;
  pass `(x1,y1,x2,y2)` or a synthesized 2-point spine + `r=h/2`.

## Branch / merge discipline

- Remote lane: this doc + new test files + Step3B helper-body internals.
- Local lane: CONFIG (`seatRotationSign`, `maxSeatRotationDeg`, `seatBandPx`, …),
  golden regen, Photoshop validation.
- Sync: local pushes `origin/step-9a-walkthrough` often; remote merges it in often.
- Do NOT rewrite shared commits `37a95bb…41b4ee1`. Merge (not rebase) into the
  seating branch at the end.
