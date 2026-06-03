# Caption Separability — Cross-Step Architecture

**Status:** DESIGN — gated. Nothing is built until the Unite-fidelity validation
(below) passes. If it fails, fall back to *reorder + regenerate* (see end).

## Problem this solves

During nesting the artist resizes a whole sticker to fill space. Because the
caption (text + plate) is one piece with the element, it scales too — so the
caption drifts off its fixed spec (GC plate 0.5 / 0.8 cm; WC text 8 pt). The
refinement step ("adjust the cut lines to match the new caption size") then has
to pull the caption back to canonical size **and** fix the cutline around it.

Today that is hard because the cutline is a single fused path with the caption
welded in (Step 5 flattens everything to black → Step 6 traces one contour).
Welded paths can only be fixed by fragile anchor-splice surgery.

## The decision

Keep the caption **separable as a component** through the whole pipeline, while
still handing the nester **one fused closed contour per sticker**. These do not
conflict: Deepnest only consumes the cutline path (Step 7A), so any sibling
objects grouped with that path simply ride along with its transform.

The cutline becomes a **derived** object:

```
cutline = Unite(element_outline, plate)
```

held as an invariant up to the pencil step.

## Per-element group contract

Each sticker is an Illustrator GroupItem with these named members:

| Member | Type | Role | Visible? |
|---|---|---|---|
| `art` | placed raster | colored illustration (final placement) | yes |
| `element_outline` | PathItem | cut path of the illustration **without** caption | hidden/locked |
| `plate` | PathItem | caption pill (GC) / white-base rect (WC), regenerable from `caption_meta` | hidden/locked |
| `cutline` | PathItem | `Unite(element_outline, plate)` — **the only thing nesting packs** | yes |

Implemented as a GroupItem in the Cutlines layer whose members are named
`{displayName} outline` (hidden), `{displayName} plate` (hidden), and
`{displayName}` (the visible cutline). `element_outline` includes the element's
white edge (`White Base_Cutline`); only the caption layers (TEXT, `White` pill,
`Caption plate`) are excluded from it.

Plus non-geometry metadata travelling in the sidecar (`{name}_elements.txt`),
appended after the existing 6 fields **only when `separableCaptions` is on**:

| Field(s) | Use |
|---|---|
| `styleCode` | WC / GC / ST — selects plate treatment (existing field) |
| `caption_lines` | line count → plate height 0.5 / 0.8 cm (GC) |
| `capLeft\|capTop\|capRight\|capBottom` | caption region bounds (px) → plate position + size, transformed to AI like element bounds |

Elements with no caption (e.g. stamps) append `0|0|0|0|0` and are skipped by the
Unite path.

### The invariant and where it breaks

- **Holds** from Step 6 (creation) through Step 8a, up to the manual pencil pass.
- Any caption change (Step 8a normalization) must **re-derive** `cutline` via
  Unite — never edit `cutline` directly while the invariant holds.
- **Breaks (intentionally) at the pencil step.** Once the artist freehand-edits
  `cutline`, that hand-drawn path is the source of truth; `element_outline` and
  `plate` become vestigial and are ignored/dropped from there on.
- **Consequence — ordering is mandatory:** caption normalization + re-Unite must
  run in **Step 8a BEFORE the pencil stop**, not after.

## Step 5 changes (`photoshop/Step5_Silhouette.jsx`)

Today: loads the **whole** Elements group transparency → one black fill → one
`Silhouette` layer ([Step5_Silhouette.jsx:64-89](../photoshop/Step5_Silhouette.jsx)).

New: produce an **element-only** silhouette that **excludes** caption text, plate,
and white base — i.e. load transparency of just the image sub-layer of each
element group (Step 3B leaves each group as `image + caption + [plate] + white base`).

Outputs from `PS_FinaliseForAI.jsx` become:

| File | Change |
|---|---|
| `{name}_elements_silhouette.png` | flat black of **element art only**, captions removed |
| `{name}_elements.txt` | extend each line with `caption_lines` and `caption_anchor` |

The full fused silhouette PNG is **no longer the handoff geometry** — the fused
contour is rebuilt in Illustrator via Unite (so it can be rebuilt again after
caption normalization).

## Step 6 changes (`illustrator/Step6_CreateCutlines.jsx`)

Today: place fused PNG → Image Trace → one path per element
([Step6_CreateCutlines.jsx:80-89](../illustrator/Step6_CreateCutlines.jsx)).

New, per element:
1. Image Trace the element-only silhouette → `element_outline`.
2. Build `plate` parametrically from `caption_meta` (height locked to spec,
   width follows caption extent, positioned at `caption_anchor`).
3. `cutline = Unite(element_outline, plate)`.
4. Assemble the per-element group (contract above); name by positional match as
   today. Nesting (Step 7A) still exports `cutline` only.

Stamp (`[ST]`) elements keep the template-replacement path — no plate, no Unite.

## VALIDATION GATE (do this first, before any code)

The whole design rests on one assumption: that `Unite(element_outline, plate)`
reproduces the contour the **current single-pass trace** produces, especially at
the element↔plate junction.

**Test:** on a real production `.ai`,
1. take one GC element's existing (good) fused cutline as reference,
2. separately trace its element-only art and build its parametric plate,
3. `Unite` them,
4. overlay vs reference — measure max deviation at the junction.

- **Pass** (junction matches within cut tolerance) → build the separable
  architecture as specced.
- **Fail** (Unite junction diverges) → **do not** adopt this; fall back to
  *reorder + regenerate*: keep the fused trace, and in Step 8a (before pencil)
  reset the caption to canonical and re-run a per-element Image Trace to
  regenerate that one element's fused cutline. No Step 5/6 separability, no
  surgery — just a localized re-trace.

## Implementation status (Phases 0–3 built, flag default OFF)

Everything below is gated by `CONFIG.separableCaptions` (false by default) in both
`PS_FinaliseForAI.jsx` and `AI_BuildCutlines.jsx`. With the flag off, behaviour is
byte-for-byte the legacy path.

- **Phase 0 — seams** (`utils/aiUtils.jsx`): `buildPlate`, `deriveCutline`
  (the validation-gated boolean-union seam), `assembleElementGroup`,
  `strokeRecursive`.
- **Phase 1 — Step 5 + sidecar**: element-only silhouette via
  `hideCaptionSublayers`; `writeElementsFile`/`captionInfo` append caption metadata.
- **Phase 2 — Step 6**: extended sidecar reader; `_psBoundsToAi` (shared
  transform); `_buildSeparableCutline` → plate + Unite + bundle.
- **Phase 3 — tests**: `run-step5-separable.sh`, `run-step6-separable.sh`.

**Known follow-up (out of this round):** nesting (Step 7A) reads cutline paths
from the Cutlines layer. Once `separableCaptions` is enabled it must read the
`cutline` member from each per-element group. No-op while the flag is off.

## Scope of payoff

Value concentrates on **Gouache** (discrete pill plate, where caption drift is a
real geometric change and re-Unite is clean) and on **Step 9** (peeling-tab
caption detection, a separately-named manual blocker that an addressable `plate`
removes). **Watercolor** benefits little: its caption is text on a white base
inside a rounded rectangle, and resetting text to 8 pt barely moves the cutline.

## Downstream beneficiaries (why this is whole-project, not just Step 8)

| Step | Without separability | With separability |
|---|---|---|
| 8a caption adjust | anchor-splice surgery | reset plate → re-Unite |
| 9 peeling tab | "ambiguous caption detection" (manual) | caption is a known object |
| 10 asset export | per-element masks from fused path | `element_outline` available directly |
| 7 nesting | one fused contour | **unchanged** — still one fused contour |
