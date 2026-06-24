# Native Captions — Pipeline Wiring Design

**Date:** 2026-06-24
**Status:** Design — approved in brainstorming (revised after GC clarification); pending spec review.
**Branch:** `feature/illustrator-native-rewrite`
**Related:**
- `docs/superpowers/specs/2026-06-24-native-captions-design.md` (overall native-captions design; this
  doc supersedes its §7 wiring / §4 delete sections with concrete decisions).
- `docs/superpowers/plans/2026-06-24-native-captions-builder.md` (the builder — DONE + validated).
- memory `native_captions_build_progress` (resume point), `illustrator_rewrite` (reframe banner).

This is the **follow-on wiring plan** that puts the already-built, validated `buildCaption(...)`
(`utils/aiUtils.jsx:654`) into the live pipeline, adds a small raster-plate path for GC-LM, and
removes the now-dead caption-reproduction code. The builder is not re-done here.

---

## 1. Scope & guiding principle

**All captions (WC and GC-LM) become native in Illustrator.** Photoshop exits caption authoring
completely — no caption text, no white pill, for either style. The only GC-specific addition is the
decorative **plate artwork**, which the artist designs in the source PSD and which is exported once
per SKU as a raster PNG and placed (scaled) behind the native text in Illustrator.

Per-element behavior (decided by `styleCode`):

- **WC** → native text + native white pill (`buildCaption`); pill united into the cut.
- **GC-LM** → native text + native white pill **+ a placed decorative plate raster** (scaled to the
  caption, printed-ink only — does **not** affect the cut). Pill united into the cut, same as WC.
- **ST (stamp)** → unchanged (no caption, no white edge, no half-cut).

**SKUs are single-style** (confirmed): a SKU is a WC SKU or a GC SKU (stamps may accompany either).
The artist therefore reviews **all** of a SKU's captions in **one** place — Illustrator — for both
styles.

**Out of scope (explicit):** a *vector* GC plate with crisp 3-slice (L/C/R) elongation via
`elongateCaptionPlateAI`. We use a single scaled raster this round; the vector path is a possible
future refinement (the function stays in `aiUtils` but is unused by the wiring).

## 2. Pipeline sequence — caption authoring + review move to Illustrator

The printed caption changes from a **rasterized PNG** (rendered in Photoshop, placed at nest) to
**native vector text** in Illustrator. Two consequences drive the re-sequencing:

1. The artist's caption-review checkpoint moves **Photoshop → Illustrator** (for both styles).
2. The pill is part of the fused cut and Deepnest nests that cut, so each caption must be
   **placed, reviewed, and pilled before nesting** — moving the Deepnest export to *after* the build.

| Pipeline | Current | New (all-native) |
|---|---|---|
| **PS_BuildElements** | combine → resize → white edge → caption text (3A) → STOP "review captions" | combine → resize → white edge → STOP. (Step 3A removed; the inter-pipeline stop **persists** but its purpose shifts to "review the white edge / resize, then run Noteworthie 2" — no caption review in PS.) |
| **PSAI** | caption white (3B) → silhouette (5) → export art + caption PNGs → BridgeTalk → AI **Step 6 (rebuild caption) + 7A (Deepnest export)** → STOP | silhouette (5) → export per-element **art** PNGs (all) + **one plate PNG for a GC SKU** → BridgeTalk → AI: **trace cut (art-only) + place native point text (= name) for every captioned element** → **STOP "reshape/reposition captions in Illustrator, then run the caption-build pipeline"**. (Step 3B caption work removed.) |
| **(new) AI caption build** | — | per captioned element: `buildCaption` (white pill → seat → unite → half-cut; **GC also places + scales the plate raster**) → **then 7A Deepnest export** → STOP "run Deepnest". Re-runnable. |

Notes:
- **No pills are built at Step 6** anymore (WC or GC). Step 6 produces the art-only traced cut and
  places the native text; all pills/plates are built by the caption-build pipeline after review.
- **Deepnest export (7A)** runs at the end of the caption-build pipeline, once every pill is united.
- The **unmatched-trace STOP** in current `AI_BuildCutlines` (Step 6 can't name a traced path) is
  unchanged.

## 3. Where printed caption items live + nest binding

Today the printed caption is a **separate placed PNG** in the Stickers layer, decoupled and re-bound
by Step 7B via a shared transform.

For native captions, the printed items become **members of the element's cutline `GroupItem`**:
- the **text frame** (named `"<displayName> caption text"`), and
- for GC, the **placed plate raster** (named `"<displayName> caption plate"`).

They ride every nest / normalise transform automatically as part of the group, so:
- **Step 7B** needs **no caption binding** — the group already moves rigidly.
- **Step 8b** re-normalises caption size each pass (see §5), so "items scale with the element" is
  fine; they are reset to spec on normalise.
- The half-cut and seat already assume the bundle moves rigidly, so this is consistent.

This removes the separate-PNG placement/binding path entirely.

## 4. Handoff slim & Photoshop changes

- **Sidecar `_elements.json`:** the **caption payload dies completely**. Keep only `displayName`,
  `styleCode`, and element bounds (`left/top/right/bottom`) per element, plus the doc dimensions.
  Drop the `caption` object and the WC-only `spine`/`radius` for all elements. `styleCode` alone tells
  AI which elements get a caption (WC/GC) and which also get a plate (GC). Delete `WC_CAPTION_SPINES`,
  `CAPTION_SEAT`, and `captionSpine()` from `PSAI_BuildAndExportCutlines.jsx`.
- **PS Step 3A:** removed (no caption text in PS).
- **PS Step 3B:** caption authoring removed (no white pill, no plate elongation, no caption grouping).
  Step 5's element-group finalize stays.
- **PNG export:** still export the per-element **art** PNG (raster watercolour) for all elements.
  For a **GC SKU**, also export **one transparent plate PNG** (from `Caption_Plate.psd`) bundled with
  the per-element art (sibling to the sidecar / in the elements export folder). No caption PNGs.

## 5. Downstream touch-points (Illustrator)

- **Step 6 (`Step6_CreateCutlines.jsx`):** trace the silhouette → art-only cut, match to element, then
  for every **captioned** element place **native point text** below its outline (Kalam-Regular 8 pt,
  tracking −20, centered, black, content = `displayName`), named `"<displayName> caption text"` and
  added as a member of that element's cutline group. **No pill, no plate, no rebuild branch here.**
- **New caption-build pipeline:** for each captioned element, call
  `buildCaption(doc, layer, textFrame, outline, opts)` with the reviewed text frame + the element's
  traced outline. `buildCaption` does white pill → seat → unite → bundle → half-cut and tags
  `group.note = "<style>|<lines>"`. For **GC**, `opts` carries the plate raster: `buildCaption` (via a
  small new raster path, §6) **places the plate PNG, scales it to the caption width at the plate's
  spec height, parks it behind the text**, and adds it as a ride-along + bundle member. Then run the
  existing Step 7A Deepnest export.
- **Step 8b normalise (`Step8b_CaptionNormalise.jsx`):** unified for both styles (no PNG-matrix path).
  Derive the scale factor from the **current caption size vs the canonical 8 pt spec** (the pill radius
  is deterministic = text height/2 + pad) → unscale text + pill (+ rescale the GC plate to the new pill
  width) → re-seat (`seatPlateToOutline`) → re-Unite (`deriveCutline`). Stateless.
- **Step 7B (`Step7B_NestingImport.jsx`):** the caption-PNG placement + pair-binding is **removed** for
  both styles (text + plate ride the cutline group, §3). Art-PNG placement + the rigid {cut, art}
  transform are unchanged.
- **Step 10 export (`Step10_AssetExport.jsx`):** native text + (GC) the placed plate raster render
  directly; no caption-PNG compositing. Outline the text on export if required for print safety.

## 6. Small new builder code (in `aiUtils`)

The validated builder handles the white pill and the *vector* plate (`elongateCaptionPlateAI`). The
chosen **raster plate** needs one small addition:

- A raster-plate path in `buildCaption` (`opts.plateRaster` = the plate PNG `File`, or a pre-placed
  item): place it, **scale to the caption (pill) width at the plate's spec height** (width-driven;
  height held at spec so the bar thickness is consistent — caps may distort under non-uniform scale,
  accepted as cosmetic + tunable), set it behind the text, and include it in the rigid ride-along +
  the assembled bundle. `elongateCaptionPlateAI` is left in place but unused.

No other builder changes — `buildCaptionPill`, the spine sampler, seat/unite/half-cut are reused.

## 7. Deletion (after the native path is proven)

**Delete:**
- PS: `Step3A_CaptionText.jsx` caption authoring; `Step3B_CaptionWhite.jsx` caption authoring
  (`createWhiteFromText`, `seatCaptionConform`, white-pill build, plate elongation, caption grouping)
  + the `_stashCaptionSpine`/`_stashCaptionSeat` stashes.
- Handoff: `captionSpine()` re-anchor + the entire `caption` sidecar payload (both styles).
- Step 6: the entire caption rebuild branch (WC capsule-from-spine **and** GC `buildPlate`-from-bounds).
- Caption-PNG export + Step 7B caption placement/binding + Step 8b PNG-matrix scale path.

**Keep:** `Caption_Plate.psd` import path (now only to export the plate PNG for GC SKUs); the white
edge / silhouette / trace / nest / NQI / cut-derivation / half-cut / BridgeTalk machinery (all
reused); `elongateCaptionPlateAI` (dormant, for a future vector plate); `buildPlate`/
`buildCapsuleFromSpine` (still used by `buildCaptionPill` and any GC future).

## 8. Validation

ExtendScript geometry has no headless test → integration runner + inspection checklist, run **2×**
for determinism, goldens are **log lines (blind to pixels)**.

- Re-validate against the spike's real SKUs end-to-end for **both** styles:
  - a **WC SKU** (the Slovakia set, incl. curved food captions): PS → handoff → AI trace + text
    placement → (manual-review surrogate) → caption build → Deepnest export.
  - a **GC SKU**: same flow, plus the plate raster is placed, scaled to each caption, and rides the
    group.
- Inspection checklist per captioned element: text default = name; **pill hugs the text** (straight →
  straight/tilted, curved → follows the arc, multi-line → tall flat stadium); **pill submerges into
  the white edge** (overlaps, not touches); **fused cut is one closed contour**; **half-cut present +
  attached at both ends**; printed items ride the group through a test nest transform; Step 8b resets a
  manually-scaled caption to spec; (GC) plate sits behind the text and spans the caption width.
- Regenerate the affected goldens (caption seat + half-cut + handoff sidecar shape); review each diff.

## 9. Sequencing / risk

Hard ordering constraint: **native caption authoring in AI must work before the PS caption code +
sidecar payload are deleted.** Suggested task order — (a) AI: place native text at Step 6 + the new
caption-build pipeline (incl. the raster-plate path) + the artist stop; (b) slim the handoff (drop the
caption payload) + add the GC plate-PNG export + strip PS 3A/3B caption work; (c) Step 8b unified
scale-ref + confirm Step 7B/10 native behavior; (d) delete dead caption code; (e) validation +
goldens. One cohesive plan, phased; not decomposed (the pieces are interdependent).

## 10. Outcome

All captions are authored, shaped, pilled, seated, cut, and half-cut **entirely in Illustrator** — the
caption never crosses the PS↔AI boundary, eliminating the reproduction bug class. Photoshop shrinks to
combine/resize/white-edge/silhouette (+ a one-off plate-PNG export for GC SKUs); the handoff sidecar
loses its caption payload; the caption-reproduction code is deleted. WC and GC share one native path,
GC differing only by a placed, scaled decorative plate raster.
