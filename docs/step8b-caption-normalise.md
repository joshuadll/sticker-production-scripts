# Step 8b — Caption Normalisation

## What it does

During the manual nest the artist scales each element — **art + white edge +
caption + cutline** — as ONE unit to fit the artboard (the "Model B" workflow).
That uniform scale drags the caption and plate **off their absolute spec**: a
0.5 cm plate on a half-size sticker becomes 0.25 cm, and the caption text stops
being 8 pt. This step re-asserts the caption/plate spec and re-derives the fused
cutline around it.

It exploits the separable-caption architecture (see
`docs/caption-separability-architecture.md`): the cutline is a **derived**
`Unite(outline, plate)`, so normalisation is *rescale the plate+caption →
re-Unite*, never anchor-splice surgery.

## It is its own pipeline now (not part of AI_RefineCutlines)

Caption normalisation is a **standalone, re-runnable pipeline**:
`pipelines/AI_NormaliseCaptions.jsx`. `AI_RefineCutlines` is now **Step 8a
Simplify only**.

The artist loops **resize → normalise → resize → …** during the manual nest, the
same way `AI_LayoutQA` is run on demand. Run it **REPEATEDLY**; it is idempotent
(an already-spec layout is left untouched).

⚠ **Run it BEFORE the manual pencil refinements to the cutline.** It re-derives
the fused contour from `outline + plate`, so it would discard any hand edits to
the cutline.

## Why "rescale about the contact", not "reset to a fixed height"

The old Step 8b rebuilt the GC plate to a canonical absolute height and moved it.
The current step does something more general that works for **GC pills and WC
curved/tilted capsules alike**, and crucially **preserves the seating Photoshop
already designed**.

Photoshop's `snapCaptionToBorder` seated the caption against the art border with a
specific overlap depth and angle; Step 6 built the plate there; Model B's uniform
scale kept that seating intact — only the *size* is wrong. So instead of
re-seating from scratch (which risks floating / one-leg / too-deep failures on
irregular art), the step:

1. computes the undo factor `unscale = (72 / sourceDPI) / caption-matrix-scale`,
   the amount needed to return the caption to absolute spec;
2. scales **both the plate and the caption PNG** by `unscale` **about the
   plate∩art CONTACT centroid** — so the contact point stays fixed while the
   caption grows/shrinks *away* from the art. The overlap depth and the caption's
   angle against the art are preserved exactly (they just rescale to spec).

Because the pivot is *inside* the overlap, the Unite always re-fuses cleanly — the
caption can't float off into a disjoint second contour. A canonical-height GC
plate scaled by `unscale` under Model B lands back at its canonical height, so no
GC-specific absolute-height reset is needed.

The **element outline is left at the artist's scale** — a smaller sticker *should*
have a smaller cut. Only the caption and plate are spec-locked.

## The contact pivot — `_overlapCentroid`

The pivot is the centroid of the `plate ∩ outline` overlap region (the real
contact between pill and art):

- Grid-sample the plate∩outline bounding-box intersection, keeping points inside
  **both** shapes, **even-odd** so outline holes count as outside. Centroid of the
  kept points is the contact.
- If the grid finds no hit but the polygons still genuinely overlap (a thin
  contact band), fall back to the nearest-approach **witness midpoint** from
  `minPolygonSetDistanceEx`.
- If there is **no real overlap at all** (the caption was dragged off its art, or
  a degenerate trace), return `null` → the group is **skipped + warned**. Scaling
  about a guessed pivot would silently fling the caption.

## Per-group procedure

For each top-level GroupItem in the **Cutlines** layer:

1. Read `group.note` (`"{styleCode}|{lines}"`, set by Step 6). Missing note → skip
   + warn.
2. Find the hidden `{name} plate` and `{name} outline` members, and the placed
   `{name} caption` PNG on the **Sticker** layer (the caption carries the spec
   scale reference). Any missing → skip.
3. `unscale = (72/sourceDPI) / _matrixScale(caption)`. If `|unscale − 1| < 0.005`
   the caption is already at spec → **at-spec no-op** (idempotent case).
4. `pivot = _overlapCentroid(plate, outline)`; null → skip + warn.
5. `_scaleAboutPoint(plate, unscale, pivot)` and the same for the caption PNG.
6. `reuniteCutline(group, outline, plate, cutlineStrokePt)` — re-derive the fused
   cutline, restroke 0.25 pt black, swap the visible member. `outline`/`plate`
   stay hidden and separable.

Returns `{ reset, atSpec, skipped }`:
- `reset` — captions that were off-spec and brought back,
- `atSpec` — captions already at spec (no-op),
- `skipped` — no note / no plate / no outline / no caption PNG / no real overlap.

## Scope

GC pills and WC curved capsules share the **same code path** — uniform scale
preserves shape and orientation for both. ST / uncaptioned elements have no plate
and are skipped.

> **No flush-rotation step.** The seating's *angle* is preserved as-is from
> Photoshop; the step only fixes size, it does not re-square the caption against a
> slanted art edge. (An automatic flush-rotate was prototyped but is **not** in the
> shipped code — the auto angle over-slants and there is no reliable auto-fix yet;
> see *Known limitations*.)

## CONFIG (in `AI_NormaliseCaptions.jsx`)

| Key | Default | Meaning |
|---|---|---|
| `dryRun` | `false` | log the intended rescale, change nothing |
| `cutlinesLayerName` | `"Cutlines"` | where the cutline groups live |
| `stickersLayerName` | `"Sticker"` | placed art + caption PNGs (Step 7B) |
| `cutlineStrokePt` | `0.25` | re-Unite stroke weight |
| `sourceDPI` | `300` | sets the spec matrix-scale `72/sourceDPI`; **must match the import pipeline** |
| `seatSampleSteps` | `12` | bezier→polygon sampling density for the contact pivot |
| `suppressAlerts` | `false` | testing only — headless runs |

## Files

- Step function: `illustrator/Step8b_CaptionNormalise.jsx` (`runCaptionNormalise`)
- Pipeline: `pipelines/AI_NormaliseCaptions.jsx`
- Utilities: `utils/aiUtils.jsx` (`reuniteCutline`, `findGroupMember`,
  `samplePathToPolygons`, `pointInPolygon`, `polygonsOverlap`,
  `minPolygonSetDistanceEx`, `findLayer`)
- Sets up the metadata: `illustrator/Step6_CreateCutlines.jsx` (`group.note`)

## Playbook mapping

Playbook step 6 (Refinements) — the *caption check / adjust cut lines* action,
run during the manual nest loop, before the manual Pencil.

## Testing

`tests/integration/run-ai-normalise-captions.sh` — opens the fixture and runs the
pipeline twice:

1. **Run #1** resets every off-spec caption to absolute spec (`reset > 0`, no
   errors).
2. **Run #2** on the now-normalised doc is a no-op (`reset = 0`, `atSpec > 0`) —
   proves idempotency / safe to loop.
3. Run #1 log is diffed against the golden
   `tests/integration/expected/ai-normalise-captions-expected.txt`.

Fixture: `tests/integration/fixtures/resize-elements.ai` (gitignored) — a clean
Step 7B import (Slovakia SKU, 6 elements) with the caption PNGs uniformly
perturbed off-spec, i.e. the post-manual-resize state this pipeline corrects.

## Known limitations

- **No GC coverage in the automated test.** The fixture SKU is **all-WC**, so the
  test exercises only the WC curved-capsule reset path. GC pills share the same
  code path but have no automated coverage yet.
- **"One side deeper" on slanted edges.** A rigid pill rescaled about the contact
  centroid against a *slanted* art edge can end up seated slightly deeper on one
  side than the other. There is no reliable automatic flush-rotation fix for this
  yet (the prototyped auto-rotate over-slants), so the angle is preserved as-is.
</content>
</invoke>
