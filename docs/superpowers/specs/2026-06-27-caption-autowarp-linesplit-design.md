# Caption auto-warp + line-split at placement — design

**Date:** 2026-06-27
**Branch:** `feature/illustrator-native-rewrite`
**Status:** implemented + Illustrator-validated on the Slovakia fixture (commits `a039cdd` → `0813fc7`,
2026-06-28). Open: a warped caption through Pipeline 2's actual seat/half-cut (the full `run.sh`
end-to-end, blocked this session by Illustrator AppleEvent instability). See Component 2's LANDED note.

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
| How much to bend each caption? | **Measure each element's real bottom edge where the caption connects and arc to that radius exactly** (no offset; roundness judged size-relative — see Component 2). |
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

> **LANDED (2026-06-28).** This section is updated to the implemented design. Two things evolved
> during Illustrator validation vs. the original plan: (1) the warp is the live effect **`Adobe
> Deform`** (Effect → Warp), not `"Adobe Warp"` (an unknown name is a silent no-op); (2) roundness
> is decided **size-relative** (curve's circle ≤ the element width) rather than by a fixed radius
> range + bow deadband, and the caption arcs to the **base radius exactly** (no offset). Commits
> `a039cdd` → `0813fc7`.

The traced `outline` path already exists when text is placed, so we measure the element's real
bottom edge **where the caption connects** and bend the caption to **the same radius as that edge**
(an exact curvature match; no offset). Illustrator's Arc obeys `R = W / (2·sin(π·B/2))` (measured on
a clean line, <1.5% error), so the bend that yields radius `R` over a caption of width `W` is
`B = (2/π)·arcsin(W / (2·R))`.

### Decision ladder (default flat; warp only when every gate passes)

1. **Sample the bottom profile** = lower envelope of the traced outline polygon, evaluated per
   x-column over the **text's x-span only** (the caption is narrow + centered, so it should follow
   the *local* curve beneath it, not the whole silhouette). Reuse `samplePathToPolygons` + a
   per-column lowest-crossing scan (the bottom-edge analog of `_capColumnSpan`).
2. **Robust quadratic fit** with median/MAD inlier rejection — bumps, spikes, and a single notch
   become outliers, not data. Generalize the existing `_capRobustBaselineFit` core so the same
   proven machinery serves both the text baseline (today) and the art base (new).
3. **Gate A — arc-like:** residual RMS after inlier rejection must be small vs. text height. A wavy
   or notched bottom that isn't well-explained by an arc → **flat.** (Primary ragged-base guard;
   also what lets us drop any radius floor — a sharp notch fails here, not by being "too tight".)
4. **Gate B — symmetry:** the fitted arc's vertex sits near the span centre (a one-sided lump is not
   a round base) → else **flat.**
5. **Gate C — roundness, SIZE-RELATIVE:** warp when the curve's circle is **no bigger than the
   element** — `radius ≤ tightRadiusFactor × element width`. This is scale-invariant (a tiny egg and
   a big plate both pass) and, crucially, span-independent, so a **short** caption over a big round
   base still warps even though its bow is small. **OR** the edge **clearly dips** across the caption
   (`bow ≥ minBow`) — the wide-gently-round backup (e.g. a broad badge with a long caption whose
   circle is large vs. the element). Measured separation on the fixture: round bases ≤0.75× the
   width, flat buildings ≥1.5× → `tightRadiusFactor = 1.0` separates cleanly.
6. **Warp:** bend to the **base radius exactly** (`B = (2/π)·arcsin(W/(2·R_base))`, scaled by
   `captionWarpBendCalib`) and apply the live `Adobe Deform` Arc.

Multi-wave bottoms, central notches, and asymmetric lumps all fall through to flat. (The earlier
plan's bow-only "is it curved enough" deadband + a fixed radius range wrongly skipped a short-caption
round base like *Pirohy* and a small clean egg-bottom like *Kraslice*; the size-relative rule fixes
both — see commit `c749558`.)

### Applying the warp

- Apply a **live Arc Warp** to the text frame via `applyEffect`. **The effect is
  `<LiveEffect name="Adobe Deform">`** (Effect → Warp), NOT `"Adobe Warp"` — `applyEffect` silently
  ignores an unrecognised name, so the wrong name renders nothing. Dict: `Arc = DeformStyle 1`,
  `DeformValue` = the bend fraction (negated: Illustrator's Arc bends a *positive* value into an arch,
  and a round/convex base needs a ∪-valley), `Rotate 0` = horizontal. Live = the artist can still tune
  it in Effect → Warp Options. (Implemented + Illustrator-validated `a039cdd`, 2026-06-28; a no-op guard
  checks the visible bounds actually grew after `applyEffect`.)
- **Pill sampler change:** `_capSampleTextOutline` currently does `duplicate()` → `createOutline()`
  on the flat geometry. Add an appearance-expand (`expandStyle`) on the throwaway duplicate
  **before** outlining, so the warped baseline is actually captured. Contained, single-spot change;
  the real text keeps its live, editable warp.
- **Curved multi-line:** relax the `_capIsMultiLine` → flat shortcut so a caption whose baseline
  fit is genuinely curved uses the curved-spine branch even with ≥2 lines. The band sampler
  already reports the full two-line vertical span, so `radius = percentile(full-span heights)/2 +
  pad` and `spine = baseline + halfBody` extend naturally; only the gating changes.

### Bend ↔ radius calibration — SOLVED

Illustrator's Arc warp obeys `R = W / (2·sin(π·B/2))`, confirmed by direct measurement on a clean
horizontal line (<1.5% error across bend 0.1–0.6). So the bend for a target radius is the exact
inverse `B = (2/π)·arcsin(W / (2·R))` — no magic numbers. `captionWarpBendCalib` (default **1.0**)
scales it: 1.0 = the caption radius equals the base radius (exact match); <1.0 = gentler. A no-op
guard checks the visible bounds actually changed after `applyEffect`, so a future bad effect
name/dict can't silently render nothing again.

## CONFIG (knobs, in `AI_BuildCutlines.jsx`)

- `captionWarpEnabled` (bool) — master on/off.
- `captionWarpMaxResidFrac` — Gate A residual ceiling (fraction of text height).
- `captionWarpMinBowMm` — Gate C clear-dip backup (edge dips ≥ this → round).
- `captionWarpTightRadiusFactor` — Gate C roundness: warp when `radius ≤ factor × element width`
  (size-relative, default **1.0** = "circle no bigger than the sticker").
- `captionWarpMaxBend` — clamp on the applied Arc bend fraction.
- `captionWarpBendCalib` — bend magnitude scale (1.0 = caption radius matches the base exactly).

(Dropped from the original plan: `captionWarpRadiusRangeMm` — replaced by the size-relative factor;
and `captionWarpGapMm` — there is no radial offset, the caption matches the base radius directly.)

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
