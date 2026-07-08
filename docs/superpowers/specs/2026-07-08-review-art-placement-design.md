# Review-Art Placement — Design

**Date:** 2026-07-08
**Branch:** feature/resolution-aware-pipeline
**Status:** Design (awaiting review)

## Problem

At the end of Pipeline 1 the artist reviews and reshapes the native captions in
Illustrator, but the **element art is not visible** — only the cutline outlines and
caption text over the green Color Block. Without the art the artist can't judge whether
a caption is correctly placed, sized, or curved against the actual sticker.

### Root cause

Art placement lives only in **Step 7B** (`_nestPlaceArtUpright`), which runs in
Pipeline 3 *after* Deepnest nesting. During Pipeline 1's `buildDocAndImport` → Step 6:

1. PS exports per-element art PNGs into `{name}_elements/` and hands off.
2. Illustrator places the **silhouette** PNG, runs Image Trace, and `expandTracing`
   converts it to vector cutline paths — the raster is consumed.
3. Native caption text is placed.
4. The `Stickers` layer is left **empty**. The art PNGs sit on disk, unplaced.

So the review pose shows no art. This is a missing feature, not a corruption.

## Insight — Step 7B should transform, not re-import

Step 7B's job is fundamentally *translate + rotate each element to its nested pose*.
The native **caption already works this way**: Pipeline 2 makes it a member of the
cutline group, so Step 7B places no caption — it just transforms the cut and the caption
rides along (Step7B lines 452–454).

The only reason Step 7B re-imports art is **historical**: before this change Step 7B was
the first place art entered the document, so it had to import. Once Step 6 imports the
art, that re-import is redundant.

Re-importing also hides a **latent re-run bug**: `_nestComputeRotation` returns a rotation
*delta from the cutline's current orientation* (`svAngle - clAngle`), which converges to
~0 on re-run — that's why cutlines are re-run-safe. But Step 7B re-places art **upright**
every run while the cutline stays rotated, then applies the ~0 delta — so on a second run
the art would sit upright under a rotated cut. Binding the art to the cut once and moving
it in lockstep makes it converge like the cutline already does.

`_nestApplyPairTransform` applies **one matrix `m` to both cut and art** (same pivot, same
angle), so their relative position is preserved regardless of pivot. Art only needs to
start in the correct relative position — which Step 6 guarantees and every lockstep move
maintains.

## Design

### 1. New shared helpers — `utils/aiUtils.jsx`

- **`artFactorFromData(elementsData)`** — AI points per PSD pixel = `72 / sourceDPI`
  (falls back to `CONFIG.sourceDPI` when the sidecar lacks it; returns 0 when unusable).
  Promoted from Step 7B's private `_nestArtFactor` so Step 6 and Step 7B share one
  definition.
- **`placeArtEmbedded(doc, stickersLayer, artFolder, displayName, registerItem, artFactor)`**
  — the single art-placement routine. Builds `{displayName}.png` (sanitising the name for
  the filesystem as Step 7B does), adds it via `stickersLayer.placedItems.add()`, resizes
  by `artFactor × 100`, centres it on `registerItem`'s `geometricBounds`, **embeds** it,
  names it `displayName`, and returns the resulting raster item. Missing PNG → log a
  warning and return `null`. Logs an `ART-FIT` line (art vs register bbox) as Step 7B does.
  Called **only by Step 6**.
- **`findArtByName(stickersLayer, displayName)`** — returns the existing art item on the
  Stickers layer whose `name === displayName` (checks `rasterItems` then `placedItems`),
  or `null`.

### 2. Step 6 — `illustrator/Step6_CreateCutlines.jsx`

Add an art-placement pass at the **end** of `runCreateCutlines`, after all paths are
matched and named:

- During the naming loop, collect `{ name: matched.displayName, register: path }` for
  **every matched element** — captioned, uncaptioned, and stamp branches. At Pipeline 1
  the register target is the top-level `{displayName} outline` path (the `[Display Name]`
  group does not exist until Pipeline 2).
- After the loop: derive `artFolder` from `elementsFilePath` (`{base}_elements`), compute
  `artFactor = artFactorFromData(elementsData)`, find the `Stickers` layer, and call
  `placeArtEmbedded(...)` per collected element.
- **Missing PNG → warn + continue** (review aid, not a gate). Aborting the whole
  Pipeline-1 cutline+caption build over one missing review image would be too harsh, and
  the element still gets its cutline and caption.
- Log a summary line (`placed N art / M elements`).

Art embeds here so it survives the save → close → Deepnest → reopen gap independent of the
`_elements/` PNG folder (this also lands the previously-deferred embed-vs-link backlog for
this art path).

### 3. Step 7B — `illustrator/Step7B_NestingImport.jsx`

Stop importing art; ride the art placed at Step 6:

- **Remove** the entry clear of the Stickers layer (the `rasterItems`/`placedItems` wipe)
  — the art we ride lives there.
- **Replace** the `_nestPlaceArtUpright(...)` call with
  `findArtByName(stickersLayer, cutlineItem.name)`. The found art is already in the correct
  relative position to the cut (placed registered at Step 6, moved only *with* the cut
  since), so it pairs as-is and the shared matrix keeps them aligned and re-run-convergent.
- **Hard error when art is absent.** If `findArtByName` returns `null` for a matched
  cutline, abort the import **before any transform**, alerting the artist with the offending
  element name(s) — the same hard-gate pattern as `AI_ExportFinal`'s unseated-caption error.
  No fallback re-import.
- **Delete** `_nestPlaceArtUpright` (no longer any placement path in Step 7B) and the
  now-redundant **final embed pass** (§5d) — art is already embedded.
- Update the "art landed on Stickers" verification to count raster items.

The `pairs` array already carries `art` through both the per-part transform
(`_nestApplyPairTransform`) and the cluster-level `_nestRotatePairs` / `_nestTranslatePairs`,
so the ride-along needs no new plumbing — only the source of `art` changes from
"re-imported" to "found".

## Layer / rendering

Stack at review time (top→bottom): `Margin > Cutlines > Stickers > Grid > Color Block`.
Art on `Stickers` renders **beneath** the Cutlines layer, so cutline strokes and caption
text draw on top of the art over the green Color Block — the intended review pose. Art
stays on `Stickers` (not made a cutline-group member) because it is a separate deliverable
that Step 10/11 export expects there.

## Error handling

| Point | Missing art | Behaviour |
|-------|-------------|-----------|
| Step 6 | PNG not on disk | Warn + continue (review aid) |
| Step 7B | art not found on Stickers | **Hard error**, abort before transforms, name the element(s) |

## Testing

- Extend the Pipeline 1 two-phase integration test's AI half (`buildDocAndImport`) to
  assert the `Stickers` layer is **populated** — one embedded raster item per element that
  has an art PNG — alongside the existing cutline / unmatched=0 assertions.
- Pipeline 3 (Step 7B) test: assert no re-import occurs (art count unchanged across a
  re-run) and that a missing-art element triggers the hard error.

## Out of scope / flagged for real-SKU validation

- **Manual nest/scale loop interaction.** The Model-B manual-scale loop
  (`AI_NormaliseCaptions` / Step 8b) scales cut members together; art now lives on
  `Stickers` from Step 6, so a hand-*scale* of an element there won't drag the art unless
  it's selected with the cut. The Deepnest import path is pure rotate+translate and is
  unaffected. This can't be validated headless — carry it as a guard+log+checklist item to
  confirm on a real SKU.
- Embed-vs-link for other art paths beyond this one (Step 11 final file) remains as the
  existing backlog note.
