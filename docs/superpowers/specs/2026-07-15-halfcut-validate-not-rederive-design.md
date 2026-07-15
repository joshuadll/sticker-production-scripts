# Half-cut: validate at export, don't re-derive

**Date:** 2026-07-15
**Branch:** `worktree-investigate-halfcut-error`
**Status:** Design approved, pre-implementation

## Problem

An artist's export of `STK270_Slovakia.ai` halted with "Half-cut ERROR — 25 caption(s)
could not produce a half-cut … plate subpath not found in group." Investigation of the
actual file showed:

- Every flagged element **already has a valid half-cut** on the Halfcut layer (28 named
  `{name} halfcut` paths, one per element).
- The failure is not seating. The artist had moved each caption's visible printed members
  (`{name} plate` pill + `{name} caption text`) out of the Cutlines groups onto the
  Stickers layer, so `syncHalfcut` could not find the pill to **re-derive** the half-cut.

The caption-move itself is now legitimate and automated: `Step11_FinalFile.jsx`
(`_s11MoveCaptionsToStickers`, PR #20 on `main`) relocates the printed caption artwork to
the Stickers layer at final-file production, because the cutter cuts every visible path in
the Cutlines/Halfcut layers. So the artist no longer needs to move captions by hand.

The remaining defect is in the half-cut's lifecycle: **export re-derives the half-cut**
(`Step9A_Halfcut.jsx` → `syncHalfcut`), which

1. **hard-aborts** when it cannot re-derive (e.g. the pill is not where it was), even
   though a perfectly good half-cut already exists, and
2. **clobbers manual half-cut edits** — every re-derivation first calls
   `_removeHalfcutFor()` and redraws, so any hand-tuned peel tab is wiped.

## Half-cut lifecycle (agreed)

| Stage | Half-cut behavior | Rationale |
|---|---|---|
| Step 6 build / **Step 7B nest import** | **Derive** (`syncHalfcut`) | 7B produces the *initial automated* half-cut the artist first sees and then refines. |
| **Step 8b normalize** | **Derive** (`syncHalfcut`) — unchanged | Runs repeatedly in the nest loop, always **before** pencil refinements (existing CLAUDE.md contract), so there are no manual edits to protect yet; re-deriving keeps the half-cut glued to the cutline it just re-United. This is the *last automated* half-cut. |
| manual refine | artist edits half-cut / cutline, drags, scales | The half-cut is now the artist's. |
| **Step 9A export** | **Verify only — never derive, never modify** | After refinement the code cannot tell a hand-tuned half-cut from a stale one, so it must not touch it. |

The half-cut stays on its own dedicated **Halfcut layer** throughout — it is already
cut-safe there and needs no relocation (unlike the caption).

## Decisions

1. **Export verifies, it does not produce.** Nothing is auto-created at export. A problem
   becomes a **named, visible** thing the artist resolves deliberately — no hidden
   automation.
2. **Two defects, flagged at two places:**
   - **Missing** — an element that needs a peel tab (GC / WC / default-tab) has no
     `{name} halfcut` path.
   - **Undershoot** — a half-cut endpoint fails to reach its own element's cut contour
     with ≥ 1 mm of overlap (a gap that would leave the tab attached).
   - **Undershoot only** — a wild *overshoot* is not a defect (it matches the automated
     1 mm tail and is harmless).
3. **`halfcutExtendMm = 1.0`** is the existing "playbook spec" the automated half-cut
   already uses to attach itself (`_extendHalfcutEndsToCutline`). The validation reuses the
   same 1 mm, so a hand-drawn half-cut is held to the same standard as the machine's.
4. **Remedy is to draw.** The export error tells the artist to *draw* the half-cut; it does
   not mention deriving. (To regenerate one automatically, the artist re-runs normalize —
   the last derive step — but that is workflow, not part of the error text.)
5. **No file recovery.** The specific broken file is not repaired by this work.

## Components

### 1. `aiUtils.jsx` — shared validator

```
validateHalfcut(group) -> { ok, reason }   // reason: null | "missing" | "undershoot"
```

- `group` is a top-level Cutlines GroupItem in the peel-tab set (GC / WC / default-tab —
  the same set `_collectHalfcutItems` / `Step9A` already select).
- Resolve the element's cut contour via `findGroupMember(group, "")` → its clippable path
  (drill through the Unite group like `_s10GetCutlinePath` does).
- Resolve the half-cut by name: `{group.name} halfcut` on the Halfcut layer. Absent →
  `{ ok:false, reason:"missing" }`.
- Sample the cut contour to polygon(s) (`samplePathToPolygons`) and the half-cut to a
  polyline. For **each** of the half-cut's two endpoints, the end is *connected* when the
  half-cut crosses the cut contour with ≥ 1 mm of the terminal run on the outside of the
  contour (mirrors `_extendHalfcutEndsToCutline`; uses `segmentsIntersect` / `pointInPolygon`).
  Any end that falls short → `{ ok:false, reason:"undershoot" }`.
- The check needs **only** the half-cut and the cut contour — **no pill/plate** — so it is
  independent of where the caption lives.
- Pure geometry, side-effect free. Unit-testable in isolation.

### 2. `Step9A_Halfcut.jsx` — verify, don't derive

`runHalfcut(doc)` is rewritten from "re-derive every half-cut via `syncHalfcut`" to
"validate every element via `validateHalfcut`":

- Walk the peel-tab set. For each, call `validateHalfcut`.
- Collect flags `{ name, reason }`. **Never** call `syncHalfcut`, `_removeHalfcutFor`, or
  otherwise touch half-cut geometry.
- Return `{ checked, flagged, flags }`.

`AI_ExportFinal.jsx` gate (replacing the current half-cut block): if `flagged > 0`, halt
**before** Steps 10/11 with a message naming each element and its reason, e.g.:

> Half-cut check failed — export halted.
> 3 element(s) need attention:
>  - Pirohy: no half-cut line — draw it
>  - Map: half-cut doesn't reach the cut line — extend it
> Draw / fix the half-cut(s), then re-run export.

(No "fix the seating in Photoshop" text.)

### 3. Layout QA — advisory overlay flag

Add a half-cut pass to `AI_LayoutQA` (and/or `Step8c`'s QA producer) that draws onto the
existing toggleable **`"Layout QA"`** overlay layer, in a **blue** hue distinct from the
red (spacing) and amber (margin) flags and readable on the green Color Block:

- **Missing** → blue **dashed echo** of the element's cut contour + a small blue badge (the
  same "echo the offending element" grammar spacing/margin use).
- **Undershoot** → a blue **ring** on the short endpoint + a dashed blue **connector** from
  that endpoint to the nearest point on the element's cut contour (the "connector across the
  gap" grammar spacing already uses). Only the offending end is marked.

Advisory only — Layout QA never blocks (like NQI). It surfaces missing / short half-cuts
during the nest-refine loop; **export is the hard gate.** Marker sizes are in mm
(scale-invariant), added to the QA legend. Step 11 already strips `"layout qa"` by name, so
none of this reaches print.

## Data flow

```
7B / 8b  --derive-->  {name} halfcut on Halfcut layer  --artist refines-->  (unchanged path)
                                   |
                 validateHalfcut(group)  [geometry only, no pill]
                    /                         \
         Layout QA (advisory blue flag)     Export 9A (hard gate: halt + names)
```

## Edge cases

- **Element not in the peel-tab set** (bare stamp, uncaptioned no-tab): not checked.
- **Half-cut present, both ends cross ≥ 1 mm:** passes silently.
- **Cut contour is a spuriously-compound Unite result:** resolve to its largest sub-path
  (reuse `_s10LargestSubPath` convention) before sampling.
- **Caption already relocated to Stickers** (the reported file's state): irrelevant — the
  validator never reads the pill, so export proceeds on any file whose half-cuts are valid.
- **Half-cut open-path with < 2 points / degenerate:** treated as `undershoot` (cannot
  connect two ends).

## Out of scope

- Caption → Stickers relocation (done: Step 11 / PR #20).
- Repairing the specific broken `STK270_Slovakia.ai`.
- Changing Steps 6 / 7B / 8b derivation behavior.
- Overshoot detection.
- Making 8b preserve manual half-cut edits (the "normalize before pencil" contract already
  covers this; a future rigid-transform-instead-of-derive change is a separate effort).

## Testing

- **Unit** (`validateHalfcut`): synthetic cut contour + half-cut fixtures — both ends
  connected (ok), one end short (undershoot), no half-cut (missing), degenerate half-cut.
- **Integration** (`ai-export-final`): fixture with (a) all half-cuts valid → export
  proceeds; (b) one element's half-cut endpoint pulled short → export halts naming it.
  Regenerate the golden for the new verify-not-derive log lines.
- **Layout QA**: fixture asserting the blue overlay is produced for a missing and an
  undershooting half-cut, and that the real half-cut/cut geometry is untouched.
