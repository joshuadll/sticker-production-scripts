# Spacing buffer → dedicated Cutlines sublayer

**Date:** 2026-07-15
**Branch:** `worktree-spacing-buffer-sublayer`
**Status:** approved, implementing

## Problem

The live 2 mm spacing-buffer halo (`aiUtils.syncSpacingBuffer`) is currently built as a
**child of each cutline `GroupItem`**. Artist feedback: the halos are hard to get out of the
way during manual nesting because there is no single control to hide them all — you would have
to select each halo inside each group. The artist asked to detach the halo from the cutline and
"put it at the top of the cutlines layer" so its visibility can be toggled in one click.

## Key insight — why detaching does NOT lose drag-tracking

Illustrator selection is **cross-layer**. During manual nesting the artist selects a whole piece
(marquee / shift-click) and drags it; the art (in the `Sticker` layer) and the cutline (in the
`Cutlines` layer) move together **because both are in the selection**, not because they are
grouped. Any item that is **visible and unlocked** and falls inside that selection rides the drag
regardless of its layer.

Therefore a halo moved to its own **unlocked, visible** sublayer still rides manual drag/scale
exactly like the art does — while also gaining a single Layers-panel eyeball to hide/show every
halo at once. Locking the sublayer would drop the halos from the selection, so the sublayer stays
**unlocked**.

## Design

### Structure
- A new sublayer **`Spacing Buffer`** at the **top of the Cutlines layer**, created lazily,
  **unlocked + visible**. One eyeball toggles all halos.
- Halos keep the name `{element} buffer`.
- Single source of truth for the name: a `spacingBufferLayerName()` helper in `aiUtils.jsx`,
  referenced by every consumer.

### `aiUtils.jsx`
- `syncSpacingBuffer(doc, item, opts)` — accepts either a captioned `GroupItem` (cutline resolved
  via `findGroupMember(group, "")`) **or** a bare stamp `PathItem` / `CompoundPathItem` (the item
  is its own cutline). Builds the halo into the `Spacing Buffer` sublayer (create-or-find) instead
  of `PLACEATEND` inside the group. Unchanged: band geometry, colour, `MULTIPLY`, live Offset-Path
  effect, `scaleLineWidth` off (2 mm stays true under manual scale). Idempotent — removes this
  element's prior `{name} buffer` from the sublayer first.
- `_removeSpacingBufferFor(doc, name)` — remove the `{name} buffer` item from the sublayer.
- `removeAllSpacingBuffers(doc)` — remove the whole `Spacing Buffer` sublayer (unlock first;
  `layer.remove()` throws on a locked layer). Idempotent.
- **Delete** `wrapStampsInGroups` / `unwrapStampGroups` — they existed **only** to wrap bare
  stamps so a halo could ride the drag as a group child. With halos in a sublayer they are no
  longer needed. Verified safe: Step 9A iterates `GroupItem`s only, so bare stamps were already
  skipped for the half-cut; export already unwrapped stamps to bare paths.

### `Step7B_NestingImport.jsx`
- Remove the `wrapStampsInGroups` call.
- The halo build loop walks top-level **captioned groups AND bare stamp paths**
  (`PathItem` / `CompoundPathItem` direct children of Cutlines with a name), calling
  `syncSpacingBuffer` on each. The half-cut loop is unchanged (still groups-only).

### `Step8b_CaptionNormalise.jsx`
- No signature change needed — it already passes the group to `syncSpacingBuffer`.

### `Step8c_OffsetPathQA.jsx` + `StepQA_NestingQuality.jsx`
- Both collectors recurse child sublayers. They MUST **skip the `Spacing Buffer` sublayer by
  name**, otherwise Step 8c reads the halos as real cutlines and throws **false spacing/margin
  failures** (halos are offset outward and overlap by design). StepQA keeps its existing
  `" buffer"` name-exclusion as belt-and-suspenders.

### Export strips — `Step10_AssetExport.jsx`, `Step11_FinalFile.jsx`, `AI_ExportFinal.jsx`
- Keep `removeAllSpacingBuffers`. **Remove** the now-gone `unwrapStampGroups` calls.

### Docs / memory
- Update the CLAUDE.md spacing-buffer banner and `memory/.../spacing_buffer_halo.md`: the buffer
  is now an unlocked top-of-Cutlines `Spacing Buffer` sublayer (one-click toggle) that still rides
  manual drags via cross-layer selection; stamp wrap/unwrap removed.

## Behaviour tradeoff (documented, not silent)
- Halos **still** ride manual drag/scale (via cross-layer marquee selection), same as the art.
- If the artist drags a piece by a selection that excludes the halo (e.g. selecting only the
  cutline), the halo is left behind — but the art would be left behind too, so this is not a new
  failure mode.

## Testing
- Adobe-only integration runners exercise this: `ai-import-nesting`, `ai-normalise-captions`,
  `ai-export-final`. Regenerate their goldens (buffer log lines + structure) and review each diff.
- Node unit tests do not cover the buffer code (Adobe APIs); they remain the sanity baseline.
- If the Adobe apps are unavailable in this environment, ship with a manual validation checklist.
