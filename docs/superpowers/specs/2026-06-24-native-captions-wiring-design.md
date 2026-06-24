# Native Captions — Pipeline Wiring Design (WC first)

**Date:** 2026-06-24
**Status:** Design — approved in brainstorming; pending spec review before plan.
**Branch:** `feature/illustrator-native-rewrite`
**Related:**
- `docs/superpowers/specs/2026-06-24-native-captions-design.md` (overall native-captions design; this
  doc supersedes its §7 wiring/§4 delete sections with the concrete, scoped decisions below).
- `docs/superpowers/plans/2026-06-24-native-captions-builder.md` (the builder — DONE + validated).
- memory `native_captions_build_progress` (resume point), `illustrator_rewrite` (reframe banner).

This is the **follow-on wiring plan** that puts the already-built, validated `buildCaption(...)`
(in `utils/aiUtils.jsx:654`) into the live pipeline and removes the now-dead WC reproduction code.
The builder is not re-done here.

---

## 1. Scope & guiding split

Wire native captions for **WC elements only**. GC-LM captions stay on the **current Photoshop path,
untouched**, this round. The decision is made **per element, by style code**:

- **WC** → no PS caption work; text authored + pilled natively in Illustrator (`buildCaption`).
- **GC-LM** → unchanged current path: PS Step 3A text → Step 3B plate + pill → caption PNG →
  Step 6 rebuild-from-sidecar → seat → unite.
- **ST (stamp)** → unchanged (no caption, no white edge, no half-cut).

**SKUs are single-style** (confirmed): a SKU is a WC SKU or a GC SKU (stamps may accompany either).
Therefore the artist reviews captions in exactly **one** place per SKU — Illustrator for a WC SKU,
Photoshop for a GC SKU — never both. The per-element style-code gate is still the implementation
mechanism (it is robust and ST coexists with either), but no SKU forces a two-place review.

GC-LM going native is an explicit **follow-up** (needs a vector L/C/R plate asset + its own
validation case); out of scope here.

## 2. Pipeline sequence — the artist caption-review stop moves to Illustrator

The printed WC caption changes from a **rasterized PNG** (rendered in Photoshop, placed at nest) to
**native vector text** authored in Illustrator. Two consequences drive the re-sequencing:

1. The artist's caption-review checkpoint moves **Photoshop → Illustrator** (for WC).
2. The pill is part of the fused cut and Deepnest nests that cut, so the WC caption must be
   **placed, reviewed, and pilled before nesting** — which moves the Deepnest export to *after* the
   caption build.

| Pipeline | Current | New (WC-native) |
|---|---|---|
| **PS_BuildElements** | combine → resize → white edge → caption text (3A) → STOP "review captions" | combine → resize → white edge → caption text (3A) **GC-LM only**. For a WC SKU there is no caption work and no caption stop. |
| **PSAI** | caption white (3B) → silhouette (5) → export art + caption PNGs → BridgeTalk → AI **Step 6 (rebuild caption) + 7A (Deepnest export)** → STOP "run Deepnest" | caption white (3B) **GC-LM only** → silhouette (5) → export art PNG for all; caption PNG **GC-LM only** → BridgeTalk → AI: **trace cut + GC rebuild/seat/unite + place WC point text (= name)** → **STOP "reshape/reposition WC captions in Illustrator, then run the caption-build pipeline"** |
| **(new) AI caption build** | — | per WC element: `buildCaption` (pill → seat → unite → half-cut) using the reviewed text + the traced outline → **then 7A Deepnest export** → STOP "run Deepnest". Re-runnable. |

Notes:
- **GC pills** are still built at Step 6 (their cut is complete there). **WC cuts** leave Step 6
  art-only and are completed by the new caption-build pipeline.
- **Deepnest export (7A)** runs at the end of the caption-build pipeline, once every pill
  (GC from Step 6, WC from the build pipeline) is united into its cut.
- The **unmatched-trace STOP** in current `AI_BuildCutlines` (Step 6 can't name a path) is unchanged.

## 3. Where the printed WC text lives + nest binding

Today the printed caption is a **separate placed PNG** in the Stickers layer, decoupled so it stays
at spec while the art resizes; Step 7B re-binds it via a shared transform.

For native WC, the printed **text frame becomes a member of the element's cutline `GroupItem`**
(alongside `… outline`, `… plate`, and the visible `… ` cut). It then rides every nest / normalise
transform automatically as part of the group:
- **Step 7B** needs **no special WC caption binding** — the group already moves rigidly.
- **Step 8b** re-normalises the caption size anyway (see §5), so "text scales with the element" is
  fine; it is reset to spec on each normalise pass.
- The half-cut and seat already assume the bundle moves rigidly, so this is consistent.

This is simpler than today's separate-object-held-at-spec scheme and removes a binding code path.

## 4. Handoff slim & Photoshop changes

- **Sidecar `_elements.json`:**
  - Keep for **all** elements: `displayName`, `styleCode`, element bounds (`left/top/right/bottom`).
  - Keep the `caption` object **for GC-LM** (`lines` + bounds — Step 6's GC branch still needs it).
  - **Drop for WC:** the `caption` object and the WC-only `spine` / `radius` fields.
  - Delete the WC stashes + re-anchoring: `WC_CAPTION_SPINES`, `CAPTION_SEAT`, and `captionSpine()`
    (the bbox-relative → absolute-px spine re-anchor) in `PSAI_BuildAndExportCutlines.jsx`.
- **PS Step 3A / 3B:** gate caption work to **GC-LM only**; WC elements get white edge + silhouette
  only (no text layer, no white pill, no group caption sub-layers).
- **PNG export:** still export the per-element **art** PNG (raster watercolour) for all elements;
  export the **caption PNG for GC-LM only**.

## 5. Downstream touch-points (Illustrator)

- **Step 6 (`Step6_CreateCutlines.jsx`):** keep the **GC** branch (capsule/pill rebuild from sidecar
  → `seatPlateToOutline` → `deriveCutline`). For **WC**, replace the rebuild with **placing native
  point text** below each WC element's traced outline: Kalam-Regular 8 pt, tracking −20, centered,
  black, content = `displayName`. **No WC pill is built here** — that waits for the artist review.
  The text frame is **named `"<displayName> caption text"` and added as a member of that element's
  cutline `GroupItem`**, so (a) it rides the group if the artist nudges the whole element, and
  (b) the build pipeline re-associates each reviewed text frame with its element/outline by group
  membership (with the name as a fallback match), not by proximity.
- **New caption-build pipeline:** for each WC element, call
  `buildCaption(doc, layer, textFrame, outline, opts)` with the reviewed text frame and the element's
  traced outline. `buildCaption` already does pill → seat → unite → bundle → half-cut and tags
  `group.note = "WC|<lines>"`. Ensure the **text frame ends up as a member of the element bundle**
  (§3). Then run the existing Step 7A Deepnest export.
- **Step 8b normalise (`Step8b_CaptionNormalise.jsx`):** GC unchanged (placed-PNG matrix scale via
  `_matrixScale`). For **WC**, derive the scale factor from the **current caption size vs the
  canonical 8 pt spec** (the pill radius is deterministic = text height/2 + pad; compare current pill
  bounds / text cap-height to spec) → unscale → re-seat (`seatPlateToOutline`) → re-Unite
  (`deriveCutline`). Stateless — no stored factor.
- **Step 7B (`Step7B_NestingImport.jsx`):** GC caption PNG placement unchanged. WC needs no extra
  binding (text is a group member, §3).
- **Step 10 export (`Step10_AssetExport.jsx`):** GC caption PNG unchanged. WC native text renders
  directly; outline the text on export if required for print safety.

## 6. Deletion (WC-only code, after wiring is proven)

**Delete** (WC paths only):
- PS: `createWhiteFromText`, `seatCaptionConform` and the WC pill build in `Step3B_CaptionWhite.jsx`;
  the `_stashCaptionSpine` / `_stashCaptionSeat` calls + `WC_CAPTION_SPINES` / `CAPTION_SEAT`.
- Handoff: `captionSpine()` re-anchor + the WC `spine`/`radius`/`caption` sidecar fields.
- Step 6: the WC capsule-from-sidecar branch (`buildCapsuleFromSpine` from sidecar spine).
- WC caption-PNG export.

**Keep** (GC-LM still uses them): `elongateCaptionPlate` (PS), the GC Caption_Plate.psd flow
(`Step1` import), `buildPlate`, the GC sidecar fields, Step 6's GC branch, the GC caption PNG
export + placement (Step 7B) + Step 8b GC normalise.

## 7. Validation

ExtendScript geometry has no headless test → integration runner + inspection checklist, run **2×**
for determinism, goldens are **log lines (blind to pixels)**.

- Re-validate against the spike's real SKUs (the Slovakia 26-element set, including curved food
  captions) end-to-end: PS (WC SKU) → handoff → AI trace + WC text placement → (manual review
  surrogate) → caption build → Deepnest export.
- Inspection checklist per WC element: text default = name; **pill hugs the text** (straight →
  straight/tilted pill, curved → pill follows the arc, multi-line → tall flat stadium);
  **pill submerges into the white edge** (overlaps, not merely touches); **fused cut is one closed
  contour** with no junction gap; **half-cut present + attached at both ends**; the printed text
  rides the group through a test nest transform; Step 8b resets a manually-scaled caption to spec.
- Regenerate the affected goldens (caption seat + half-cut + handoff sidecar shape); review each diff
  before committing.

## 8. Sequencing / risk

The hard ordering constraint: **WC caption authoring in AI must work before PS WC caption work is
deleted.** Suggested task order — (a) AI: place WC text at Step 6 + new caption-build pipeline +
stop; (b) slim handoff (drop WC fields) + gate PS 3A/3B to GC-only; (c) Step 8b WC scale-ref +
confirm Step 7B/10 WC behavior; (d) delete dead WC code; (e) validation + goldens. One cohesive plan,
phased; not decomposed (the pieces are interdependent).

## 9. Out of scope (explicit)

- GC-LM native captions (needs a vector L/C/R plate asset + validation) — follow-up.
- Any change to: stamps, the white-edge raster recipe, nesting/NQI, the cut-derivation algorithm,
  the half-cut algorithm, BridgeTalk transport. All reused as-is.

## 10. Outcome

For WC SKUs, captions are authored, shaped, pilled, seated, cut, and half-cut **entirely in
Illustrator** — the caption never crosses the PS↔AI boundary, eliminating the reproduction bug class.
PS shrinks to combine/resize/white-edge/silhouette for WC SKUs; the handoff sidecar loses its WC
caption payload; the WC reproduction code is deleted. GC-LM is untouched and continues to work.
