# Illustrator-native pipeline rewrite — Slice 1: Structural spine + ingest

> ⚠️ **SUPERSEDED 2026-06-24 (same day, after the de-risk spike).** The spike
> (`docs/superpowers/plans/2026-06-24-spine-recipe-derisk-spike.md`) showed the structural spine is
> **reusable as-is** — keep the white edge in Photoshop (raster expand) + AI trace (the existing
> Step 2B / Step 6); moving the white edge to an AI vector offset hit edge cases that raster
> dilation solves for free (26/26 clean). So this is **not** a rewrite of the spine, and the AI
> "ingest does the white-edge offset" design below does **not** apply. The real work is an
> **incremental native-captions change** on the current pipeline. This doc is kept for the de-risk
> record only; a separate "native captions" design supersedes it.

**Date:** 2026-06-24
**Status:** SUPERSEDED — de-risk record only. Do not implement from this doc.
**Related memory:** `illustrator_rewrite` (the pivot + de-risked trace/edge recipe),
`illustrator_rewrite_transfer` (PS→AI fidelity map, magic-number→mm table, relational rules).

---

## 1. Background & decision

The current pipeline runs Photoshop (Steps 1–5) → a fragile BridgeTalk handoff → Illustrator
(Steps 6–11). Almost every bug came not from *using Photoshop* but from the **reproduction
handoff**: PS rasterizes, writes a sidecar describing the captions/spine/seat, and AI *rebuilds*
them from that description — and the rebuild drifts (spine floats, upside-down text, detached
captions).

**Decision:** rewrite the structural pipeline **Illustrator-native**, and reduce Photoshop to a
**thin "silhouette exporter"** that does only the one thing it is uniquely good at — turning a soft
watercolour alpha into a clean hard-edged silhouette. The handoff becomes a **clean-asset** drop
(PNGs + a name lookup), never a reproduction sidecar, so the entire reproduction bug-class is gone.

Why thin-PS rather than pure-AI: turning the alpha into a clean shape is the only step where
Illustrator is both harder to code (opacity masks / raster effects are AI's weakest scripting area)
*and* less-proven on quality (the AI blur→threshold→trace recipe is validated on one SKU; PS's
smooth+harden is production-proven across many). Keeping that one step in PS is the lower-risk path
to the same clean architecture, and the clean-PNG handoff does not reopen the reproduction problem.

**Pure-AI remains a future option** (drop PS entirely once AI alpha-extraction is proven across
messy SKUs). Every stage *downstream* of silhouette extraction is identical either way, so choosing
thin-PS now costs nothing if we later collapse to pure-AI.

## 2. Scope

**In scope (slice 1):** PSD → per-element clean cut line with a baked white edge, placed art, laid
out for review. This is the structural spine: the crux that de-risks the whole pivot.

**Out of scope (later slices, noted so the bundle leaves room):**
- Slice 2 — captions (text + white pill + seat + half-cut). *Gated on the caption-bending question.*
- Slice 3 — Deepnest export/import + nest layout.
- Slice 4 — normalize, spacing/margin QA, half-cut export pass, final file.

**Why this slice first:** it carries all the transfer risk (the alpha→cut recipe) and every
downstream slice depends on its output. Building it end-to-end on real SKUs *is* the validation that
the pivot holds.

## 3. Architecture

Two halves and a file-drop handoff.

### 3.1 Photoshop silhouette-exporter
Per source SKU, for each element group `[Display Name] [STYLE-CAT][+/-]`:
1. Import + (optionally) combine source elements — as today (Step 1).
2. Resize art to `categoryTarget − 2 × whiteEdge` (the white-edge pre-compensation: AI adds the edge,
   so the art must be pre-shrunk to land the finished element on the category target).
3. Extract a clean silhouette = `smoothSelection` + `hardenSelection` of the **art alpha only**
   (no caption, no white edge). This is PS's proven recipe, kept verbatim.

PS **no longer** adds the white edge (moves to AI as an offset) or builds captions.

### 3.2 The handoff (clean assets, no reproduction)
A folder containing, per element:
- `elem_NN_art.png` — colour art, trimmed, final art-size, transparent bg.
- `elem_NN_silhouette.png` — flat black art-only silhouette, **pixel-aligned to the art PNG**
  (same canvas/trim) so the trace registers to the art exactly.
- one thin `manifest.json`: `{ "elements": [ { "file": "elem_NN", "name": "<exact layer name>" } ] }`.
  Files use ASCII names; the exact (accented/apostrophe'd) name lives safely in JSON. AI derives
  style/category/size/default-caption from the name via `parseLayerName`. DPI is the fixed
  `sourceDPI` constant (SAVEFORWEB normalizes PNG DPI anyway), not passed.

### 3.3 Illustrator ingest — "Run 1 · Build" (captions deferred to slice 2)
- **Stage 0 — Read handoff** *(new, trivial)*: read JSON → `{file, name}`; parse name; pair the PNGs.
- **Stage 1 — Working doc** *(reuse `buildWorkingDocument`)*: A4/CMYK + Margin/Stickers/Grid/Color
  Block; add Cutlines layer.
- **Stage 2 — Place + trace** *(reuse Step6 trace recipe; new = per-element + registration)*: place
  `art.png` into Stickers at scale `72/sourceDPI` in a grid slot; place `silhouette.png` at the
  identical transform; Image Trace ("Silhouettes" + tuned) → `expandTracing` → ungroup → drop
  background/fragment by area → the **raw art outline**, registered to the art; discard the placed
  silhouette.
- **Stage 3 — White edge + cut** *(new use of the existing Offset Path effect)*: `outline =
  OffsetPath(art outline, +1.69 mm, round joins)` then **`expandStyle` to bake it into geometry**
  (see §4 — it must scale with the sticker, so it cannot stay a live effect). Printed white edge =
  that shape filled white, behind the art. Stamps (ST): no white edge — outline = the raw trace.
- **Stage 4 — Captions:** *deferred to slice 2* (text + white pill + seat + half-cut), gated on the
  caption-bending question. The bundle (§5) leaves room for it; the number is reserved so the full
  Run-1 sequence stays stable.
- **Stage 5 — Lay out + stop** *(reuse grid)*: arrange bundles + art in a review grid; stop. (No
  caption review in slice 1 — that arrives with slice 2.)

## 4. Per-element geometry (the structural recipe)

Build order (inverts today's order — the white edge comes *from* the trace, not before it):

1. Trace the art-alpha silhouette → **raw art outline**.
2. Offset outward by **1.69 mm** (round joins) → **white-edge / cut contour**.
3. **Bake** the offset (`expandStyle`) into real geometry — do **not** leave it a live effect.
   Rationale: under the manual nest the artist scales the whole element as one unit ("Model B"); the
   white edge must scale *with* the sticker, exactly as today (where it is baked into the traced
   raster). A live Offset Path with `scaleLineWidth` off would stay **absolute** — the opposite of
   today's behavior. (Open decision 7.2: confirm scale-with-sticker is desired.)

The baked offset contour is the element's **outline** component and the basis of the cut. In slice 1
(no caption) the cut line **is** that contour. In slice 2 the caption pill is united into it.

## 5. Bundle structure & output

Reuse the existing separable bundle so slices 2–4 plug in unchanged. Per element, a GroupItem
`[Display Name]` in the Cutlines layer:
- `[Display Name]` — visible cut line (in slice 1 = the baked white-edge contour).
- `[Display Name] outline` — the same contour, kept as a hidden separable component (so slice 2's
  `Unite(outline, plate)` and later re-Unites work).
- `group.note = "{styleCode}|{capLines}"` — set at birth; consumed by later slices.

The placed art sits in the Stickers layer, bound to the cutline so later slices can move them as a
rigid unit (identical matrices).

## 6. Rules carried from the current pipeline (the ones easy to lose)

From `illustrator_rewrite_transfer`, the rules that bear on slice 1:
- **Silhouette = art only**, captions excluded; the white edge is the offset, never part of the
  traced silhouette. Two distinct "whites": the pill (slice 2) vs the white *edge* (this slice).
- **White edge baked** so it scales with the sticker (§4).
- **White-edge pre-compensation**: PS resizes art to `target − 2 × edge` so the finished element hits
  the category target.
- **Seat/half-cut (slice 2) will reference this baked white-edge contour**, not the raw art — so the
  contour the cut is made from must be the same one captions later seat into.
- **Stamps**: no white edge, no caption, no half-cut; cut = raw traced silhouette.
- **Constants** (300 DPI → mm): white edge 1.69 mm; place factor `72/sourceDPI` (sourceDPI = 300);
  size table is finished size (art + edge) — TL 3″, LM 2.3/2.05/1.8″, MP/TR ≈1.9″, IC, FD, ST 1.5″.

## 7. Open decisions

1. **Alpha-step location** — *resolved: thin-PS exporter* (this design). Pure-AI is a future option,
   gated on the §8 validation showing AI extraction is rock-solid across messy SKUs.
2. **White edge: scale-with-sticker (baked, this design) or absolute?** — confirm with artist. If
   absolute is wanted, normalize (slice 4) must also re-spec the white edge.
3. **Cut = white-edge outer boundary, or boundary + a small die-cut bleed?** — a single value from
   the playbook/artist; affects whether Stage 3 is one offset or two.
4. **Caption bending** (slice 2 gate, recorded here): do the captions genuinely bend, or is it
   straight text in a (tilted) pill? Straight-tilted is strongly preferred (robust; the tilt comes
   free from the seat). To be sent to the artist before slice 2.

## 8. Validation & testing

- **De-risk run:** execute slice 1 on ~5 varied real SKUs (a flat-bottomed element, a wispy
  watercolour, a busy multi-element sheet) and compare the cut quality against today's PS output.
  This both validates the white-edge recipe and decides decision 7.1.
- **Headless limit:** ExtendScript geometry can't be validated without Illustrator, and `node
  --check` only catches syntax. So: ship happy-path-neutral changes, `log()` each new branch, and
  hand a precise inspection checklist (which elements, what "correct" looks like, which log line).
- **Integration runner:** add `run-ai-spine-ingest.sh` alongside the new pipeline (golden = log
  lines, blind to pixels; run 2× for determinism; fixtures set up manually, not as test side
  effects).

## 9. Risks

- **The white-edge recipe is not a 1:1 numeric port.** PS smooths the *expanded band's* corners; the
  AI recipe blurs the *silhouette* before any offset, and Offset Path rounds again. Same intent,
  different operations, validated on one SKU only. **Mitigation:** the §8 de-risk run is the gate
  before building further.
- **Document Raster Effects resolution** must be 300 DPI or the trace-feed blur quantizes coarsely
  (set defensively).
