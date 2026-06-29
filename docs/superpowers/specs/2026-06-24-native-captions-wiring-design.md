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

## 2. Pipeline sequence — same two pipelines from the artist's view

**The artist still runs exactly two pipelines, same names, same order.** The only externally visible
change is that **Pipeline 1 now ends in Illustrator** (it BridgeTalks across and leaves the artist
there with caption text placed for review), and **Pipeline 2 is launched from Illustrator** (where the
artist already is). The printed caption changes from a rasterized PNG to native vector text, so the
review must happen in Illustrator — which is why the BridgeTalk moves earlier (from old Pipeline 2
into Pipeline 1). Because the pill is part of the fused cut that Deepnest nests, each caption must be
placed, reviewed, and pilled before nesting — so the pill build + Deepnest export sit in Pipeline 2.

**Pipeline 1 — "Build Elements"** (launched from Photoshop):
- **PS:** combine → resize → white edge → silhouette → export (per-element **art** PNGs for all; **one
  plate PNG** for a GC SKU; **slim sidecar** — no caption payload).
- **BridgeTalk → Illustrator:** build working doc → trace silhouette → art-only cut, match to element
  → **place native caption text (= element name)** below each captioned element, as a member of its
  cutline group.
- **Ends in Illustrator.** The artist reviews/reshapes the caption text (and sees the white edge in the
  traced cut), then runs Pipeline 2.
- *Change vs today:* Pipeline 1 absorbs the silhouette + export + BridgeTalk (old Pipeline 2's PS tail)
  and the AI trace; caption-text authoring moves from PS (old Step 3A) to AI; the old between-pipelines
  caption-review stop becomes the end-of-Pipeline-1 stop, in Illustrator. The artist no longer reviews
  the white edge in a separate PS stop — it's visible in the traced cut at the Illustrator review (a
  bad edge means re-run Pipeline 1, as today a bad resize did).

**Pipeline 2 — "Build and Export Cutlines"** (launched from Illustrator):
- For each captioned element: `buildCaption` (white pill → seat into the traced cut → unite → bundle →
  half-cut; **GC also places + scales the plate raster** behind the text).
- Step 7A Deepnest export.
- **Ends** with "run Deepnest" (downstream unchanged).
- *Change vs today:* runs in Illustrator instead of starting from Photoshop; builds native pills
  instead of rebuilding from the sidecar.

Notes:
- **No pills are built during the trace** (WC or GC). Pipeline 1's AI half produces the art-only traced
  cut + the native text; all pills/plates are built by Pipeline 2 after the review.
- **Deepnest export (7A)** runs at the end of Pipeline 2, once every pill is united.
- The **unmatched-trace STOP** (a traced path can't be named to an element) stays available as a direct
  re-run of Pipeline 1's Illustrator-side trace/place step — it does not re-run the Photoshop half.

### File / launch restructure (implementation note, detailed in the plan)
- `PS_BuildElements.jsx` (Pipeline 1) absorbs silhouette + export + BridgeTalk; loses Step 3A.
- The BridgeTalk target (today `AI_BuildCutlines.jsx`) changes job to **trace + place native text**
  (drops the caption rebuild + the 7A export); stays directly re-runnable for the unmatched case.
- `PSAI_BuildAndExportCutlines.jsx` (Pipeline 2) becomes an **Illustrator-launched** pipeline that runs
  `buildCaption` per element + 7A; its Photoshop tail (3B/silhouette/export/BridgeTalk) is gone.
- Installer: Pipeline 2's `File > Scripts` entry moves to Illustrator (it's now an AI script).

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

**Print representation (resolved 2026-06-24):** the cut group is the **single rigid printed-and-cut
unit**. Its **white pill stays VISIBLE** (it IS the printed white background behind the text — not
just a hidden cut-shaper), and the text + GC plate are visible members. So the printed caption = the
cut group's visible members (pill + text + plate); `assembleElementGroup`'s "hide the plate" behavior
is **not applied to native captions**. Because these live in the **Cutlines** group rather than the
Stickers layer, **Step 10 must be taught to include each cut group's visible caption members in that
element's export** (see §5) — they are already shaped/positioned, so they're *added* to the export
region, not clipped (only the art PNG clips to the cut).

## 4. Handoff slim & Photoshop changes

- **Sidecar `_elements.json`:** the **caption payload dies completely**. Keep only `displayName`,
  `styleCode`, and element bounds (`left/top/right/bottom`) per element, plus the doc dimensions.
  Drop the `caption` object and the WC-only `spine`/`radius` for all elements. `styleCode` alone tells
  AI which elements get a caption (WC/GC) and which also get a plate (GC). Delete the
  `WC_CAPTION_SPINES` / `CAPTION_SEAT` stashes (Step 3B) and the `captionSpine()` re-anchor (the sidecar
  writer) wherever they land after the Pipeline-1 restructure.
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
- **Pipeline 2 (Build and Export Cutlines):** for each captioned element, call
  `buildCaption(doc, layer, textFrame, outline, opts)` with the reviewed text frame + the element's
  traced outline. `buildCaption` does white pill → seat → unite → bundle → half-cut and tags
  `group.note = "<style>|<lines>"`. For **GC**, `opts` carries the plate raster: `buildCaption` (via a
  small new raster path, §6) **places the plate PNG, scales it to the caption width at the plate's
  spec height, parks it behind the text**, and adds it as a ride-along + bundle member. Then run the
  existing Step 7A Deepnest export.
- **Step 8b normalise (`Step8b_CaptionNormalise.jsx`):** unified for both styles (no PNG-matrix path).
  The caption members now live **inside the cut group** (not as a Stickers PNG), so it stops using
  `_findCaption` (Stickers PNG) and instead reads the group's `" plate"` (visible pill) + `" caption
  text"` (+ `" caption plate"` raster for GC) members. Derive the scale factor from the **current pill
  height vs the note-stamped spec pill height** (`h<pt>`, written by `buildCaption` §6): `unscale =
  specPillH / curPillH`, idempotent guard `|unscale−1| < 0.005`. Then scale the caption members about
  the pill centre → re-seat (`seatPlateToOutline`) → re-Unite (`reuniteCutline`).
- **Step 7B (`Step7B_NestingImport.jsx`):** the caption-PNG placement + pair-binding is **removed** for
  both styles (text + plate ride the cutline group, §3). Art-PNG placement + the rigid {cut, art}
  transform are unchanged.
- **Step 10 export (`Step10_AssetExport.jsx`):** for each element, gather its cut group's **visible
  caption members** (white pill + text + GC plate) into that element's clip/export alongside the
  Stickers art PNG. They're already shaped and positioned in the cut's space, so they are *added* to
  the per-element export region (the art still clips to the cut). No caption-PNG compositing. Outline
  the text on export if required for print safety. (This is real Step-10 rework — DOM-bound, validated
  in-app.)

## 6. Small new builder code (in `aiUtils`)

The validated builder handles the white pill and the *vector* plate (`elongateCaptionPlateAI`). The
chosen **raster plate** needs one small addition:

- A raster-plate path in `buildCaption` (`opts.plateRasterFile` = the plate PNG `File`): place it,
  **scale to the caption (pill) width at the plate's spec height** (width-driven; height held at spec
  so the bar thickness is consistent — caps may distort under non-uniform scale, accepted as cosmetic
  + tunable), set it behind the text, and include it as a **visible** ride-along + bundle member.
  `elongateCaptionPlateAI` is left in place but unused.
- `buildCaption` must, for native captions, **keep the pill VISIBLE** (white-filled printed
  background, per §3) instead of letting `assembleElementGroup` hide it, and **add the seated text
  frame to the assembled group** as a member named `"<name> caption text"` (today `buildCaption`
  leaves the text frame as a seated sibling; `assembleElementGroup` only bundles outline/plate/cut).
- `buildCaption` **stamps the spec pill height** into `group.note` for Step 8b's scale-ref (§5):
  note = `"<style>|<lines>|h<pillHeightPt>"` (+ `"|R"` when the seat flags review). Step 8b reads
  `h<pt>` to recover the artist's scale factor.

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
