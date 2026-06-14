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

## Step 4 — OVERHANG edge case (next to tackle)

If an endpoint sits **past the art silhouette**, the ray hits NO art ink — the inner
edge overhangs the art there. Today this reports a huge gap and the worst-strip kiss
buries the pill. Whether each endpoint lands on real border or overhangs is the
**diagnostic that should drive the seat.** → handling TBD.

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
