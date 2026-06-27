# Caption auto-warp + line-split at placement — design

**Date:** 2026-06-27
**Branch:** `feature/illustrator-native-rewrite`
**Status:** approved (design); not yet implemented

## Goal

Reduce the artist's manual caption work in the Pipeline 1 → Illustrator handoff by doing two
things automatically when caption text is first placed (Step 6):

1. **Auto-warp** — a caption sitting under a curved-bottom art element is warped to follow that
   curve, so when Pipeline 2 builds the white pill (and seats it into the art) the pill curves
   naturally and mates the art's bottom edge seamlessly. This is the artist's default manual
   action today for any element with a rounded base.
2. **Line split on `|`** — a display name containing `|` (e.g. `The Blue Church | Manila
   Cathedral`) is rendered as two stacked lines (`The Blue Church` / `Manila Cathedral`).

## Background — where captions live now

After the native-caption rewrite, caption text is **not** authored in Photoshop. It is placed
natively in Illustrator by `_placeCaptionText()` in `Step6_CreateCutlines.jsx`, which runs as the
final BridgeTalk phase of Pipeline 1 (`PS_BuildElements` → Illustrator). Today it drops a single
**flat** line of text (`tf.contents = displayName`) below each WC/GC element as the artist's
review pose. Both features land here, at caption birth.

The downstream pill builder already anticipates warped + multi-line text:

- `buildCaptionPill` (`aiUtils.jsx`) fits the white pill **spine to the text baseline** and
  auto-detects straight-vs-curved via `_capRobustBaselineFit` (median/MAD inlier rejection;
  curved decided by **chord bow**, not raw slope). So if Step 6 warps the text, the pill — and
  therefore the seated plate and half-cut — follow automatically with no further wiring.
- `_capIsMultiLine` already grows the pill to cover ≥2 lines (currently → a **flat** pill).
- Live effects are an established pattern here: the spacing-buffer halo applies an Offset Path
  **live effect** via `applyEffect` with a `<LiveEffect>` XML string (`aiUtils.jsx` ~1643).

No prior warp/envelope code exists in git history; this is greenfield.

## Decisions (from brainstorming)

| Question | Decision |
| --- | --- |
| How much to bend each caption? | **Measure each element's real bottom edge and fit per element** (concentric arc, uniform gap). |
| Multi-line **and** curved? | **Warp multi-line too** — extend the pill builder to allow a curved multi-line pill. |
| Which style codes warp? | **WC only.** GC's decorative plate is a rigid raster that can't follow an arc (and GC is unvalidated). The `\|` split still applies to **both** WC and GC. |
| Warp mechanism | **Live Arc Warp via `applyEffect`** (Approach A) — editable by the artist, consistent with existing code, sampler expands a throwaway duplicate to read the curve. |
| Disposition on wavy/ambiguous bases | **Conservative** — warp only on a confidently smooth, symmetric arc; everything wavy/ambiguous stays flat (status quo: artist warps by hand). Asymmetric cost: a missed warp is cheap, a wrong warp is annoying. |

## Component 1 — line split on `|` (WC + GC)

In `_placeCaptionText`:

- Split the display name on `|`, trim each segment, drop empties, join with hard returns (`\r`),
  and set that as `tf.contents`. `A | B | C` → three lines (split on every `|`).
- The text frame **name** stays `displayName + " caption text"` and the cutline **group name**
  stays the full `displayName` (with `|` intact) — cross-Deepnest matching is unchanged. Only the
  visible ink gets newlines.
- `NAME_REGEX` group 1 is `(.+)` (greedy, any char), so `|` already parses fine inside a display
  name; no parser change.

A flat two-line caption needs nothing downstream — `_capIsMultiLine` already covers it.

## Component 2 — auto-warp to the base curve (WC only)

The traced `outline` path already exists when text is placed, so we measure the element's real
bottom edge and fit the caption to it as a **concentric arc** (same center of curvature, radius =
art radius + gap → uniform gap → seamless when Pipeline 2 seats the pill up into the art).

### Decision ladder (default flat; warp only when every gate passes)

1. **Sample the bottom profile** = lower envelope of the traced outline polygon, evaluated per
   x-column over the **text's x-span only** (the caption is narrow + centered, so it should follow
   the *local* curve beneath it, not the whole silhouette). Reuse `samplePathToPolygons` + a
   per-column lowest-crossing scan (the bottom-edge analog of `_capColumnSpan`).
2. **Robust quadratic fit** with median/MAD inlier rejection — bumps, spikes, and a single notch
   become outliers, not data. Generalize the existing `_capRobustBaselineFit` core so the same
   proven machinery serves both the text baseline (today) and the art base (new).
3. **Gate A — goodness of fit:** residual RMS after inlier rejection must be small vs. text height.
   A wavy bottom that isn't well-explained by an arc → "not a clean curve" → **flat.** (Primary
   wavy-base guard.)
4. **Gate B — chord-bow deadband:** the smooth trend's bow across the span must exceed a CONFIG
   threshold; a flat-on-average wavy base has ~zero bow → **flat.**
5. **Gate C — sane geometry:** fitted radius within a plausible range (reject tiny = sharp notch,
   huge = effectively flat) and the arc vertex roughly centered over the text (a real round base
   is symmetric; a one-sided lump is not) → else **flat.**
6. **Warp:** compute the bend from the fitted local radius and apply a live Arc Warp.

Multi-wave bottoms, central notches, and asymmetric lumps all fall through to flat.

### Applying the warp

- Apply a **live Arc Warp** to the text frame via `applyEffect` with a
  `<LiveEffect name="Adobe Warp">` XML string (Arc style, horizontal orientation, `bend` derived
  from the measured curvature). Live = the artist can still tune it in Effect → Warp Options.
- **Pill sampler change:** `_capSampleTextOutline` currently does `duplicate()` → `createOutline()`
  on the flat geometry. Add an appearance-expand (`expandStyle`) on the throwaway duplicate
  **before** outlining, so the warped baseline is actually captured. Contained, single-spot change;
  the real text keeps its live, editable warp.
- **Curved multi-line:** relax the `_capIsMultiLine` → flat shortcut so a caption whose baseline
  fit is genuinely curved uses the curved-spine branch even with ≥2 lines. The band sampler
  already reports the full two-line vertical span, so `radius = percentile(full-span heights)/2 +
  pad` and `spine = baseline + halfBody` extend naturally; only the gating changes.

### Bend ↔ curvature calibration (the main risk)

Illustrator's Arc-warp `bend` parameter is not a 1:1 map to real arc curvature. Plan: derive the
mapping analytically, expose it as a single CONFIG calibration constant, and **guard + log +
visual-checklist** it (cannot run Illustrator in this environment), to be tuned on a real round
SKU — consistent with how the seat/half-cut reworks were landed. The seater
(`seatPlateToOutline`) refines the final pose, so the warp only needs to land the text curvature
in the right ballpark, not pixel-perfect.

## CONFIG (new knobs, in `AI_BuildCutlines.jsx`)

- `captionWarpEnabled` (bool) — master on/off.
- `captionWarpMinBowMm` — Gate B chord-bow deadband.
- `captionWarpMaxResidualFrac` — Gate A residual ceiling (fraction of text height).
- `captionWarpRadiusRangeMm` — Gate C `[min, max]` plausible fitted radius.
- `captionWarpGapMm` — concentric gap (art radius → text radius).
- `captionWarpMaxBend` — clamp on the applied bend.
- `captionWarpBendCalib` — the bend↔curvature calibration constant.

## Testing

- **Unit (node-testable, pure geometry):** the base-contour robust fit + gate decisions —
  wavy-flat → flat; clean arc → warp with expected bend sign/magnitude; notch/asymmetric lump →
  flat; multi-wave → flat. Follows the existing `_cap*` node-test pattern (no Illustrator).
- **Line split:** `A | B` → two trimmed lines; name/group-name keep the full string; `A | B | C`
  → three lines; no `|` → unchanged.
- **Illustrator integration / visual checklist (manual, real SKU):** warp applied as a live
  effect; pill follows the warped baseline (single + multi-line); calibration produces a visually
  concentric fit; flat-bottomed and wavy elements stay flat. Tune CONFIG, then regenerate any
  affected goldens (review each diff).

## Out of scope

- GC warp (rigid raster plate would need raster warping).
- Changes to the seat or half-cut engines — they already consume the curved pill unchanged.
- Photoshop-side changes — captions are Illustrator-native now.
